-- ============================================================
-- SAVED SEARCHES
-- ============================================================

CREATE TABLE IF NOT EXISTS saved_searches (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            VARCHAR(100) NOT NULL,
  params          JSONB NOT NULL DEFAULT '{}',
  notify          BOOLEAN DEFAULT FALSE,
  last_checked_at TIMESTAMPTZ,
  last_seen_total INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_saved_searches_user
  ON saved_searches(user_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_saved_searches_updated_at ON saved_searches;
CREATE TRIGGER trg_saved_searches_updated_at
  BEFORE UPDATE ON saved_searches
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- GEOCODE CACHE (Nominatim responses)
-- ============================================================

CREATE TABLE IF NOT EXISTS geocode_cache (
  query_key   TEXT PRIMARY KEY,
  response    JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days')
);

CREATE INDEX IF NOT EXISTS idx_geocode_cache_expires
  ON geocode_cache(expires_at);

-- ============================================================
-- OPTIONAL: fast geo box lookup for map markers
-- The GIST index on properties.location already handles
-- ST_MakeEnvelope queries efficiently. This partial index
-- is for active listings only (very common query path).
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_listings_active_location
  ON properties USING GIST(location)
  WHERE location IS NOT NULL;