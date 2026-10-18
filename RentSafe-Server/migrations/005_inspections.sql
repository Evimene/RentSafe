-- ============================================================
-- INSPECTION TEMPLATES (versioned)
-- ============================================================

CREATE TABLE IF NOT EXISTS inspection_templates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version     INTEGER UNIQUE NOT NULL,
  name        VARCHAR(200) NOT NULL,
  definition  JSONB NOT NULL,
  is_active   BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_templates_active
  ON inspection_templates(is_active) WHERE is_active = TRUE;

-- ============================================================
-- INSPECTOR PROFILES
-- ============================================================

DO $$ BEGIN
  CREATE TYPE inspection_status AS ENUM (
    'requested','assigned','scheduled','in_progress',
    'submitted','approved','rejected','cancelled','expired'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS inspector_profiles (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_active           BOOLEAN DEFAULT TRUE,
  service_areas       TEXT[] DEFAULT '{}',             -- ['Lagos','Abuja']
  neighborhoods       TEXT[] DEFAULT '{}',             -- ['Lekki','Ikoyi']
  rate_per_inspection_kobo BIGINT DEFAULT 500000,      -- ₦5,000
  bio                 TEXT,
  rating              NUMERIC(3,2) DEFAULT 0,
  total_inspections   INTEGER DEFAULT 0,
  approved_count      INTEGER DEFAULT 0,
  rejected_count      INTEGER DEFAULT 0,
  avg_duration_minutes INTEGER,
  last_assigned_at    TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inspector_active
  ON inspector_profiles(is_active) WHERE is_active = TRUE;

-- ============================================================
-- INSPECTIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS inspections (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference           VARCHAR(20) UNIQUE NOT NULL,     -- INS-2026-XXXXX
  listing_id          UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  inspector_id        UUID REFERENCES users(id) ON DELETE SET NULL,
  requested_by        UUID NOT NULL REFERENCES users(id),
  requester_role      user_role NOT NULL,              -- 'host' | 'admin'
  template_id         UUID NOT NULL REFERENCES inspection_templates(id),

  status              inspection_status NOT NULL DEFAULT 'requested',
  is_re_inspection    BOOLEAN DEFAULT FALSE,
  previous_inspection_id UUID REFERENCES inspections(id),

  -- Scheduling
  scheduled_at        TIMESTAMPTZ,
  expires_at          TIMESTAMPTZ,                     -- assignment expiry

  -- Visit tracking (all server-verified)
  started_at          TIMESTAMPTZ,
  started_lat         NUMERIC(10,7),
  started_lng         NUMERIC(10,7),
  started_accuracy_m  NUMERIC(7,2),

  submitted_at        TIMESTAMPTZ,
  submitted_lat       NUMERIC(10,7),
  submitted_lng       NUMERIC(10,7),
  submitted_accuracy_m NUMERIC(7,2),

  distance_to_property_m NUMERIC(8,2),                 -- computed on submit
  duration_seconds    INTEGER,

  -- Selfie proof
  selfie_url          TEXT,
  selfie_lat          NUMERIC(10,7),
  selfie_lng          NUMERIC(10,7),

  -- Scoring
  score               NUMERIC(5,2),                    -- 0-100
  category_scores     JSONB DEFAULT '{}',              -- {"safety": 90, "utilities": 70, ...}
  checklist           JSONB DEFAULT '{}',              -- {"identity.exists": "pass", ...}
  answers_count       INTEGER DEFAULT 0,
  photos_count        INTEGER DEFAULT 0,

  -- Review
  reviewed_by         UUID REFERENCES users(id),
  reviewed_at         TIMESTAMPTZ,
  review_notes        TEXT,
  rejection_reason    TEXT,
  override_score      NUMERIC(5,2),                    -- admin override
  override_reason     TEXT,

  -- Flags
  flagged_reasons     TEXT[] DEFAULT '{}',             -- ['gps_far','too_fast','accuracy_low']
  device_info         JSONB DEFAULT '{}',

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inspections_listing ON inspections(listing_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inspections_inspector ON inspections(inspector_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inspections_status ON inspections(status);
CREATE INDEX IF NOT EXISTS idx_inspections_pending ON inspections(status, scheduled_at)
  WHERE status IN ('requested','assigned','scheduled');

-- ============================================================
-- CHECKLIST ITEMS (normalized for analytics)
-- ============================================================

CREATE TABLE IF NOT EXISTS inspection_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id   UUID NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  category_key    VARCHAR(50) NOT NULL,
  item_key        VARCHAR(80) NOT NULL,
  answer          VARCHAR(20) NOT NULL,                -- 'pass' | 'fail' | 'partial' | 'na'
  weight          SMALLINT NOT NULL,
  earned          NUMERIC(5,2) NOT NULL,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(inspection_id, item_key)
);

CREATE INDEX IF NOT EXISTS idx_inspection_items_inspection
  ON inspection_items(inspection_id);
CREATE INDEX IF NOT EXISTS idx_inspection_items_failures
  ON inspection_items(item_key, answer) WHERE answer = 'fail';

-- ============================================================
-- PHOTOS (geo-tagged)
-- ============================================================

CREATE TABLE IF NOT EXISTS inspection_photos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id   UUID NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  url             TEXT NOT NULL,
  thumbnail_url   TEXT,
  category        VARCHAR(50),                         -- 'exterior','bedroom','safety', etc.
  item_key        VARCHAR(80),                         -- links to checklist item, if any
  caption         VARCHAR(300),
  taken_lat       NUMERIC(10,7),
  taken_lng       NUMERIC(10,7),
  taken_accuracy_m NUMERIC(7,2),
  taken_at        TIMESTAMPTZ,
  distance_to_property_m NUMERIC(8,2),
  sort_order      SMALLINT DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inspection_photos_inspection
  ON inspection_photos(inspection_id, sort_order);

-- ============================================================
-- EARNINGS
-- ============================================================

CREATE TABLE IF NOT EXISTS inspection_earnings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id   UUID UNIQUE NOT NULL REFERENCES inspections(id),
  inspector_id    UUID NOT NULL REFERENCES users(id),
  amount_kobo     BIGINT NOT NULL,
  status          VARCHAR(20) NOT NULL DEFAULT 'pending',  -- pending | paid | reversed
  payout_id       UUID,                                    -- links to payouts table if you route via Paystack
  paid_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_earnings_inspector
  ON inspection_earnings(inspector_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_earnings_pending
  ON inspection_earnings(status) WHERE status = 'pending';

-- ============================================================
-- TRIGGERS
-- ============================================================

DROP TRIGGER IF EXISTS trg_inspections_updated_at ON inspections;
CREATE TRIGGER trg_inspections_updated_at
  BEFORE UPDATE ON inspections
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_inspector_profiles_updated_at ON inspector_profiles;
CREATE TRIGGER trg_inspector_profiles_updated_at
  BEFORE UPDATE ON inspector_profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();