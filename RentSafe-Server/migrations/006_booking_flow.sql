-- ============================================================
-- EXTEND BOOKING STATUS
-- ============================================================

ALTER TYPE booking_status ADD VALUE IF NOT EXISTS 'expired';

-- ============================================================
-- TIGHTEN THE NO-OVERLAP CONSTRAINT
-- Include pending_payment so concurrent bookings cannot race
-- for the same dates. Expiry cron frees abandoned holds.
-- ============================================================

ALTER TABLE bookings DROP CONSTRAINT IF EXISTS no_overlapping_bookings;

ALTER TABLE bookings ADD CONSTRAINT no_overlapping_bookings
  EXCLUDE USING GIST (
    listing_id WITH =,
    daterange(check_in_date, check_out_date, '[)') WITH &&
  )
  WHERE (status IN ('pending_payment', 'confirmed', 'checked_in'));

CREATE INDEX IF NOT EXISTS idx_bookings_pending_payment
  ON bookings(expires_at)
  WHERE status = 'pending_payment';

-- ============================================================
-- BOOKING REMINDERS (so we don't re-send)
-- ============================================================

CREATE TABLE IF NOT EXISTS booking_reminders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id      UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  reminder_type   VARCHAR(50) NOT NULL,          -- 'checkin_24h','checkin_1h','review_request'
  channel         VARCHAR(20) NOT NULL,          -- 'sms','email','push'
  sent_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(booking_id, reminder_type, channel)
);

CREATE INDEX IF NOT EXISTS idx_reminders_booking
  ON booking_reminders(booking_id);

-- ============================================================
-- CHECK-IN CODE BRUTE-FORCE TRACKING
-- ============================================================

CREATE TABLE IF NOT EXISTS checkin_attempts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id      UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  attempted_by    UUID NOT NULL REFERENCES users(id),
  success         BOOLEAN NOT NULL,
  ip_address      INET,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_checkin_attempts_booking
  ON checkin_attempts(booking_id, created_at DESC);

-- ============================================================
-- OPTIONAL: add idempotency support to the escrow_holds table
-- so retried charges don't create duplicates
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_escrow_booking_unique
  ON escrow_holds(booking_id) WHERE status <> 'refunded';