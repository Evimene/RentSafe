import axios from 'axios';
import { query } from '../db.js';

const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org';
const USER_AGENT = 'RentSafe/1.0 (support@rentsafe.local)';
const CACHE_TTL_DAYS = 30;

/* ============================================================
   In-memory LRU (per-process). Backed by geocode_cache in DB.
   ============================================================ */

const memCache = new Map();
const MEM_TTL_MS = 60 * 60 * 1000; // 1 hour

function memGet(key) {
  const hit = memCache.get(key);
  if (!hit) return null;
  if (hit.expiresAt < Date.now()) { memCache.delete(key); return null; }
  return hit.value;
}
function memSet(key, value) {
  if (memCache.size > 1000) {
    // drop oldest
    const firstKey = memCache.keys().next().value;
    memCache.delete(firstKey);
  }
  memCache.set(key, { value, expiresAt: Date.now() + MEM_TTL_MS });
}

/* ============================================================
   Nominatim call (rate-limited: 1 req/sec globally)
   ============================================================ */

let lastNominatimCall = 0;
const NOMINATIM_MIN_INTERVAL_MS = 1100;

async function rateLimitedNominatim(path, params) {
  const now = Date.now();
  const wait = Math.max(0, NOMINATIM_MIN_INTERVAL_MS - (now - lastNominatimCall));
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastNominatimCall = Date.now();

  const { data } = await axios.get(`${NOMINATIM_BASE}${path}`, {
    params,
    headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en' },
    timeout: 8000,
  });
  return data;
}

/* ============================================================
   Forward geocode: query string → list of {name, lat, lng, type}
   ============================================================ */

export async function geocode(queryText) {
  if (!queryText || queryText.trim().length < 2) return { results: [] };

  const key = `fwd:${queryText.trim().toLowerCase()}`;

  const mem = memGet(key);
  if (mem) return { results: mem, cached: 'memory' };

  const { rows } = await query(
    `SELECT response FROM geocode_cache WHERE query_key = $1 AND expires_at > NOW()`,
    [key]
  );
  if (rows[0]) {
    const results = rows[0].response;
    memSet(key, results);
    return { results, cached: 'db' };
  }

  let raw;
  try {
    raw = await rateLimitedNominatim('/search', {
      q: queryText,
      format: 'jsonv2',
      limit: 8,
      countrycodes: 'ng',
      addressdetails: 1,
      'accept-language': 'en',
    });
  } catch (err) {
    // Don't cache errors
    return { results: [], error: 'Geocoder unavailable' };
  }

  const results = (raw || []).map((r) => ({
    displayName: r.display_name,
    shortName: r.name,
    lat: Number(r.lat),
    lng: Number(r.lon),
    type: r.type,
    category: r.category,
    bbox: r.boundingbox ? r.boundingbox.map(Number) : null,
  }));

  memSet(key, results);

  // Cache to DB (best-effort)
  query(
    `INSERT INTO geocode_cache (query_key, response, expires_at)
     VALUES ($1, $2, NOW() + ($3 || ' days')::interval)
     ON CONFLICT (query_key) DO UPDATE
       SET response = EXCLUDED.response,
           expires_at = EXCLUDED.expires_at`,
    [key, JSON.stringify(results), CACHE_TTL_DAYS]
  ).catch(() => {});

  return { results };
}

/* ============================================================
   Reverse geocode: lat/lng → address
   ============================================================ */

export async function reverseGeocode(lat, lng) {
  const la = Number(lat), ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln))
    return { result: null };

  // Round to 4 decimals (~11m) so nearby clicks share cache
  const key = `rev:${la.toFixed(4)}:${ln.toFixed(4)}`;

  const mem = memGet(key);
  if (mem) return { result: mem, cached: 'memory' };

  const { rows } = await query(
    `SELECT response FROM geocode_cache WHERE query_key = $1 AND expires_at > NOW()`,
    [key]
  );
  if (rows[0]) {
    memSet(key, rows[0].response);
    return { result: rows[0].response, cached: 'db' };
  }

  let raw;
  try {
    raw = await rateLimitedNominatim('/reverse', {
      lat: la, lon: ln, format: 'jsonv2', addressdetails: 1,
      'accept-language': 'en',
    });
  } catch {
    return { result: null };
  }

  const result = raw ? {
    displayName: raw.display_name,
    city: raw.address?.city || raw.address?.town || raw.address?.village || null,
    state: raw.address?.state || null,
    country: raw.address?.country || null,
    neighborhood: raw.address?.suburb || raw.address?.neighbourhood || null,
  } : null;

  if (result) {
    memSet(key, result);
    query(
      `INSERT INTO geocode_cache (query_key, response, expires_at)
       VALUES ($1, $2, NOW() + ($3 || ' days')::interval)
       ON CONFLICT (query_key) DO UPDATE
         SET response = EXCLUDED.response,
             expires_at = EXCLUDED.expires_at`,
      [key, JSON.stringify(result), CACHE_TTL_DAYS]
    ).catch(() => {});
  }

  return { result };
}