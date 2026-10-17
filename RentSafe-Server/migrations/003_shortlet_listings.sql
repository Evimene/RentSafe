-- ============================================================
-- PROPERTIES (the physical building)
-- ============================================================

DO $$ BEGIN
  CREATE TYPE listing_type AS ENUM ('entire_place', 'private_room', 'shared_room');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE listing_status AS ENUM ('draft', 'pending_review', 'active', 'suspended', 'rejected', 'archived');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE property_type AS ENUM ('apartment', 'duplex', 'bungalow', 'studio', 'penthouse', 'villa', 'cottage', 'other');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS properties (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id             UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  name                VARCHAR(200),
  property_type       property_type NOT NULL DEFAULT 'apartment',
  address_line1       VARCHAR(300) NOT NULL,
  address_line2       VARCHAR(300),
  city                VARCHAR(100) NOT NULL,
  neighborhood        VARCHAR(100),
  state               VARCHAR(100) NOT NULL,
  country             VARCHAR(100) NOT NULL DEFAULT 'Nigeria',
  postal_code         VARCHAR(20),
  location            GEOGRAPHY(POINT, 4326),
  ownership_type      VARCHAR(50) DEFAULT 'owned',
  ownership_doc_url   TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ
);

CREATE INDEX idx_properties_host ON properties(host_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_properties_location ON properties USING GIST(location);
CREATE INDEX idx_properties_city ON properties(city, state) WHERE deleted_at IS NULL;

-- ============================================================
-- LISTINGS (the rentable unit)
-- ============================================================

CREATE TABLE IF NOT EXISTS listings (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id           UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  host_id               UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  title                 VARCHAR(200) NOT NULL,
  description           TEXT,
  listing_type          listing_type NOT NULL DEFAULT 'entire_place',
  bedrooms              SMALLINT DEFAULT 1 CHECK (bedrooms >= 0),
  beds                  SMALLINT DEFAULT 1 CHECK (beds >= 1),
  bathrooms             NUMERIC(3,1) DEFAULT 1 CHECK (bathrooms >= 0),
  max_guests            SMALLINT NOT NULL DEFAULT 2 CHECK (max_guests >= 1),
  min_nights            SMALLINT DEFAULT 1 CHECK (min_nights >= 1),
  max_nights            SMALLINT DEFAULT 30 CHECK (max_nights >= 1),
  check_in_time         TIME DEFAULT '15:00',
  check_out_time        TIME DEFAULT '11:00',
  base_price_kobo       BIGINT NOT NULL CHECK (base_price_kobo > 0),
  cleaning_fee_kobo     BIGINT DEFAULT 0 CHECK (cleaning_fee_kobo >= 0),
  security_deposit_kobo BIGINT DEFAULT 0 CHECK (security_deposit_kobo >= 0),
  currency              VARCHAR(3) DEFAULT 'NGN',
  status                listing_status NOT NULL DEFAULT 'draft',
  instant_book          BOOLEAN DEFAULT FALSE,
  house_rules           TEXT,
  cancellation_policy   VARCHAR(50) DEFAULT 'moderate',
  verification_score    SMALLINT DEFAULT 0 CHECK (verification_score BETWEEN 0 AND 100),
  verified_at           TIMESTAMPTZ,
  verified_by           UUID REFERENCES users(id),
  published_at          TIMESTAMPTZ,
  suspended_at          TIMESTAMPTZ,
  suspension_reason     TEXT,
  rejection_reason      TEXT,
  total_bookings        INTEGER DEFAULT 0,
  average_rating        NUMERIC(3,2) DEFAULT 0,
  metadata              JSONB DEFAULT '{}',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at            TIMESTAMPTZ
);

CREATE INDEX idx_listings_host ON listings(host_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_listings_property ON listings(property_id);
CREATE INDEX idx_listings_status ON listings(status) WHERE deleted_at IS NULL;
CREATE INDEX idx_listings_price ON listings(base_price_kobo) WHERE status = 'active';

-- ============================================================
-- MEDIA
-- ============================================================

CREATE TABLE IF NOT EXISTS listing_media (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id      UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  media_type      VARCHAR(20) NOT NULL DEFAULT 'image',
  url             TEXT NOT NULL,
  thumbnail_url   TEXT,
  caption         VARCHAR(300),
  sort_order      SMALLINT DEFAULT 0,
  is_cover        BOOLEAN DEFAULT FALSE,
  width           INTEGER,
  height          INTEGER,
  file_size_bytes BIGINT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_listing_media_listing ON listing_media(listing_id, sort_order);

-- One cover per listing
CREATE UNIQUE INDEX idx_listing_cover
  ON listing_media(listing_id) WHERE is_cover = TRUE;

-- ============================================================
-- AMENITIES (master list + join)
-- ============================================================

CREATE TABLE IF NOT EXISTS amenities (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        VARCHAR(80) UNIQUE NOT NULL,
  name        VARCHAR(100) NOT NULL,
  category    VARCHAR(50) NOT NULL,
  icon        VARCHAR(100),
  sort_order  SMALLINT DEFAULT 0
);

CREATE TABLE IF NOT EXISTS listing_amenities (
  listing_id  UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  amenity_id  UUID NOT NULL REFERENCES amenities(id) ON DELETE CASCADE,
  PRIMARY KEY (listing_id, amenity_id)
);

-- Seed the master list
INSERT INTO amenities (slug, name, category, icon, sort_order) VALUES
  ('wifi',          'WiFi',                    'tech',     'wifi',          10),
  ('ac',            'Air conditioning',        'comfort',  'snowflake',     20),
  ('generator',     'Backup generator',        'utilities','bolt',          30),
  ('kitchen',       'Full kitchen',            'kitchen',  'chef-hat',      40),
  ('washer',        'Washing machine',         'kitchen',  'washing-machine',50),
  ('dryer',         'Dryer',                   'kitchen',  'wind',          60),
  ('tv',            'TV',                      'tech',     'tv',            70),
  ('streaming',     'Streaming services',      'tech',     'monitor-play',  80),
  ('pool',          'Swimming pool',           'outdoor',  'waves',         90),
  ('gym',           'Gym',                     'building', 'dumbbell',      100),
  ('security',      '24/7 security',           'building', 'shield',        110),
  ('parking',       'Free parking',            'building', 'car',           120),
  ('balcony',       'Balcony',                 'outdoor',  'fence',         130),
  ('workspace',     'Dedicated workspace',     'tech',     'laptop',        140),
  ('hot_water',     'Hot water',               'comfort',  'droplet',       150),
  ('elevator',      'Elevator',                'building', 'move-vertical', 160),
  ('housekeeping',  'Housekeeping',            'services', 'sparkles',      170),
  ('breakfast',     'Breakfast included',      'services', 'coffee',        180),
  ('ocean_view',    'Ocean view',              'outdoor',  'sun',           190),
  ('pets_allowed',  'Pets allowed',            'rules',    'paw-print',     200)
ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- AVAILABILITY (host-blocked dates + price overrides)
-- ============================================================

CREATE TABLE IF NOT EXISTS listing_availability (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id          UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  date                DATE NOT NULL,
  is_available        BOOLEAN DEFAULT TRUE,
  price_override_kobo BIGINT,
  min_nights_override SMALLINT,
  note                VARCHAR(200),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(listing_id, date)
);

CREATE INDEX idx_availability_listing_date ON listing_availability(listing_id, date);
CREATE INDEX idx_availability_blocked ON listing_availability(listing_id, date)
  WHERE is_available = FALSE;

-- ============================================================
-- TRIGGERS
-- ============================================================

DROP TRIGGER IF EXISTS trg_properties_updated_at ON properties;
CREATE TRIGGER trg_properties_updated_at BEFORE UPDATE ON properties
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_listings_updated_at ON listings;
CREATE TRIGGER trg_listings_updated_at BEFORE UPDATE ON listings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();