CREATE TABLE IF NOT EXISTS booking_nights (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id  UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  date        DATE NOT NULL,
  price_kobo  BIGINT NOT NULL,
  is_override BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(booking_id, date)
);
CREATE INDEX IF NOT EXISTS idx_booking_nights_booking ON booking_nights(booking_id);