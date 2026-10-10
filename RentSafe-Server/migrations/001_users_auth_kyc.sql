CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "citext";
-- PostGIS is intentionally installed in a later property/location migration.


-- Enums
DO $$ BEGIN CREATE TYPE user_role AS ENUM ('guest', 'host', 'inspector', 'admin', 'support');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE kyc_status AS ENUM ('pending', 'submitted', 'verified', 'rejected', 'expired');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE kyc_type AS ENUM ('nin', 'bvn', 'selfie', 'address', 'drivers_license', 'passport', 'voters_card');
EXCEPTION WHEN duplicate_object THEN null; END $$;



-- ==============================================================
-- USER AUTHENTICATION
-- ==============================================================

-- Users
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email CITEXT UNIQUE,
  phone VARCHAR(20) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  first_name VARCHAR(100),
  last_name VARCHAR(100),
  display_name VARCHAR(150),
  avatar_url TEXT,
  date_of_birth DATE,
  gender VARCHAR(20),

  is_email_verified BOOLEAN DEFAULT FALSE,
  is_phone_verified BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT FALSE,
  is_banned BOOLEAN DEFAULT FALSE,
  ban_reason TEXT,
  kyc_status kyc_status DEFAULT 'pending',
  last_login_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_users_kyc_status ON users(kyc_status);


CREATE TABLE IF NOT EXISTS user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role user_role NOT NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  UNIQUE(user_id, role)
);
CREATE INDEX IF NOT EXISTS idx_user_roles_user ON user_roles(user_id);


-- Sessions / refresh tokens
CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_hash TEXT UNIQUE NOT NULL,
  device_info JSONB DEFAULT '{}',
  ip_address INET,
  user_agent TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(refresh_token_hash) WHERE revoked_at IS NULL;


-- OTPs
CREATE TABLE IF NOT EXISTS otp_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  identifier VARCHAR(150) NOT NULL,
  code_hash TEXT NOT NULL,
  purpose VARCHAR(50) NOT NULL,
  attempts SMALLINT DEFAULT 0,
  max_attempts SMALLINT DEFAULT 5,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_otp_identifier ON otp_codes(identifier, purpose) WHERE consumed_at IS NULL;

-- KYC records
CREATE TABLE IF NOT EXISTS kyc_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider VARCHAR(50) NOT NULL,
  verification_type kyc_type NOT NULL,
  status kyc_status NOT NULL DEFAULT 'pending',
  reference_id VARCHAR(150),
  document_url TEXT,
  selfie_url TEXT,
  verified_data JSONB DEFAULT '{}',
  rejection_reason TEXT,
  submitted_at TIMESTAMPTZ,
  verified_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_kyc_user ON kyc_verifications(user_id, verification_type);
CREATE INDEX IF NOT EXISTS idx_kyc_status ON kyc_verifications(status) WHERE status IN ('pending','submitted');



-- Audit trail
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID REFERENCES users(id),
  actor_role user_role,
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(50) NOT NULL,
  entity_id UUID,
  before_state JSONB,
  after_state JSONB,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id, created_at DESC);



-- updated_at triggers
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_kyc_updated_at ON kyc_verifications;
CREATE TRIGGER trg_kyc_updated_at BEFORE UPDATE ON kyc_verifications
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();







-- ============================================================
-- ESCROW & PAYOUT TABLES
-- ============================================================

-- Paystack customer records (one per user)
CREATE TABLE IF NOT EXISTS paystack_customers (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  customer_code       VARCHAR(100) UNIQUE,        -- CUS_xxxxx from Paystack
  email               CITEXT,
  paystack_id         BIGINT,                     -- Paystack's internal customer ID
  metadata            JSONB DEFAULT '{}',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Paystack transfer recipients (host bank accounts)
CREATE TABLE IF NOT EXISTS transfer_recipients (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_code      VARCHAR(100) UNIQUE NOT NULL,  -- RCP_xxxxx
  recipient_type      VARCHAR(20) NOT NULL DEFAULT 'nuban',
  bank_code           VARCHAR(10) NOT NULL,
  bank_name           VARCHAR(100),
  account_number      VARCHAR(20) NOT NULL,
  account_name        VARCHAR(200) NOT NULL,
  currency            VARCHAR(3) DEFAULT 'NGN',
  is_active           BOOLEAN DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, account_number, bank_code)
);

CREATE INDEX idx_recipients_user ON transfer_recipients(user_id) WHERE is_active = TRUE;

-- The main escrow ledger (one row per booking)
CREATE TABLE IF NOT EXISTS escrow_holds (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id              UUID UNIQUE NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
  guest_id                UUID NOT NULL REFERENCES users(id),
  host_id                 UUID NOT NULL REFERENCES users(id),
  amount_kobo             BIGINT NOT NULL,           -- total held
  currency                VARCHAR(3) DEFAULT 'NGN',
  status                  VARCHAR(20) NOT NULL DEFAULT 'holding',
    -- holding | released | refunded | partially_released | disputed
  paystack_reference      VARCHAR(200),              -- charge reference
  charge_success_at       TIMESTAMPTZ,
  release_eligible_at     TIMESTAMPTZ,               -- check_in + 24h
  released_at             TIMESTAMPTZ,
  refunded_at             TIMESTAMPTZ,
  released_amount_kobo    BIGINT DEFAULT 0,
  refunded_amount_kobo    BIGINT DEFAULT 0,
  platform_fee_kobo       BIGINT DEFAULT 0,
  notes                   TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_escrow_booking ON escrow_holds(booking_id);
CREATE INDEX idx_escrow_status ON escrow_holds(status);
CREATE INDEX idx_escrow_release_due ON escrow_holds(release_eligible_at)
  WHERE status = 'holding';

-- Payout records (one per escrow release)
CREATE TABLE IF NOT EXISTS payouts (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  escrow_hold_id          UUID NOT NULL REFERENCES escrow_holds(id),
  booking_id              UUID NOT NULL REFERENCES bookings(id),
  host_id                 UUID NOT NULL REFERENCES users(id),
  recipient_id            UUID NOT NULL REFERENCES transfer_recipients(id),
  amount_kobo             BIGINT NOT NULL,
  currency                VARCHAR(3) DEFAULT 'NGN',
  status                  VARCHAR(20) NOT NULL DEFAULT 'pending',
    -- pending | processing | success | failed | reversed
  transfer_reference      VARCHAR(200) UNIQUE,       -- your idempotency key
  paystack_transfer_code  VARCHAR(100),              -- TRF_xxxxx
  paystack_transfer_id    BIGINT,
  initiated_at            TIMESTAMPTZ,
  completed_at            TIMESTAMPTZ,
  failure_reason          TEXT,
  webhook_payload         JSONB DEFAULT '{}',
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_payouts_host ON payouts(host_id, created_at DESC);
CREATE INDEX idx_payouts_status ON payouts(status);
CREATE INDEX idx_payouts_reference ON payouts(transfer_reference);

-- Webhook event log (idempotency)
CREATE TABLE IF NOT EXISTS paystack_webhook_events (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type          VARCHAR(100) NOT NULL,         -- charge.success, transfer.success
  paystack_event_id   VARCHAR(200),                  -- Paystack's event ID (if provided)
  reference           VARCHAR(200),                  -- charge or transfer reference
  payload             JSONB NOT NULL,
  signature_valid     BOOLEAN DEFAULT FALSE,
  processed           BOOLEAN DEFAULT FALSE,
  processed_at        TIMESTAMPTZ,
  error               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_webhook_dedup
  ON paystack_webhook_events(event_type, reference)
  WHERE reference IS NOT NULL;
CREATE INDEX idx_webhook_unprocessed
  ON paystack_webhook_events(processed) WHERE processed = FALSE;

-- Immutable ledger (every money movement)
CREATE TABLE IF NOT EXISTS transactions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID REFERENCES users(id),
  booking_id          UUID REFERENCES bookings(id),
  escrow_hold_id      UUID REFERENCES escrow_holds(id),
  transaction_type    VARCHAR(50) NOT NULL,
    -- charge | escrow_hold | escrow_release | payout | refund | platform_fee
  direction           VARCHAR(10) NOT NULL,          -- credit | debit
  amount_kobo         BIGINT NOT NULL,
  currency            VARCHAR(3) DEFAULT 'NGN',
  reference           VARCHAR(200),
  description         TEXT,
  metadata            JSONB DEFAULT '{}',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tx_user ON transactions(user_id, created_at DESC);
CREATE INDEX idx_tx_booking ON transactions(booking_id);
CREATE INDEX idx_tx_escrow ON transactions(escrow_hold_id);

-- Add check-in confirmation columns to bookings (if not already present)
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS check_in_code VARCHAR(10),
  ADD COLUMN IF NOT EXISTS checked_in_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS guest_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS host_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS escrow_hold_id UUID REFERENCES escrow_holds(id);