import { query } from '../db.js';
import { HttpError } from '../middleware/error.js';

const moneyOut = (n) => (n == null ? null : Number(n));

/* ============================================================
   BBOX PARSER
   Accepts: "west,south,east,north" (Leaflet's toBBoxString format)
   ============================================================ */

export function parseBBox(str) {
  if (!str) return null;
  const parts = String(str).split(',').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n)))
    throw new HttpError(400, 'bbox must be west,south,east,north');
  const [west, south, east, north] = parts;
  if (west < -180 || east > 180 || south < -90 || north > 90)
    throw new HttpError(400, 'bbox coordinates out of range');
  if (west >= east || south >= north)
    throw new HttpError(400, 'bbox has invalid ordering');
  return { west, south, east, north };
}

/* ============================================================
   MARKERS — lightweight listing pins for the map
   ============================================================ */

export async function searchMapMarkers(params) {
  const {
    bbox, zoom = 13,
    checkIn, checkOut,
    guests, minPrice, maxPrice, type, amenities, instant,
    hostId,
  } = params;

  const box = parseBBox(bbox);
  if (!box) throw new HttpError(400, 'bbox required');

  const where = [`l.status = 'active'`, `l.deleted_at IS NULL`, `p.location IS NOT NULL`];
  const values = [box.west, box.south, box.east, box.north];

  where.push(`p.location && ST_MakeEnvelope($1, $2, $3, $4, 4326)::geography`);

  if (guests) {
    values.push(Number(guests));
    where.push(`l.max_guests >= $${values.length}`);
  }
  if (minPrice) {
    values.push(Number(minPrice));
    where.push(`l.base_price_kobo >= $${values.length}`);
  }
  if (maxPrice) {
    values.push(Number(maxPrice));
    where.push(`l.base_price_kobo <= $${values.length}`);
  }
  if (type) {
    values.push(type);
    where.push(`l.listing_type = $${values.length}::listing_type`);
  }
  if (instant === 'true') where.push(`l.instant_book = TRUE`);
  if (hostId) {
    values.push(hostId);
    where.push(`l.host_id = $${values.length}`);
  }

  if (amenities) {
    const slugs = String(amenities).split(',').map((s) => s.trim()).filter(Boolean);
    if (slugs.length) {
      values.push(slugs);
      const i = values.length;
      where.push(`(
        SELECT COUNT(*) FROM listing_amenities la
        JOIN amenities a ON a.id = la.amenity_id
        WHERE la.listing_id = l.id AND a.slug = ANY($${i}::text[])
      ) = ${slugs.length}`);
    }
  }

  if (checkIn && checkOut) {
    values.push(checkIn, checkOut);
    const i = values.length;
    where.push(`NOT EXISTS (
      SELECT 1 FROM listing_availability a
      WHERE a.listing_id = l.id
        AND a.date >= $${i - 1}::date AND a.date < $${i}::date
        AND a.is_available = FALSE
    )`);
    where.push(`NOT EXISTS (
      SELECT 1 FROM bookings b
      WHERE b.listing_id = l.id
        AND b.status IN ('confirmed', 'checked_in')
        AND daterange(b.check_in_date, b.check_out_date, '[)') &&
            daterange($${i - 1}::date, $${i}::date, '[)')
    )`);
  }

  // Safety cap — even at max zoom we don't want >500 markers
  const LIMIT = 500;

  const { rows } = await query(
    `SELECT
       l.id,
       l.title,
       l.base_price_kobo,
       l.instant_book,
       ST_Y(p.location::geometry) AS lat,
       ST_X(p.location::geometry) AS lng,
       (SELECT url FROM listing_media
        WHERE listing_id = l.id AND is_cover = TRUE LIMIT 1) AS cover_url
     FROM listings l
     JOIN properties p ON p.id = l.property_id
     WHERE ${where.join(' AND ')}
     LIMIT ${LIMIT + 1}`,
    values
  );

  const truncated = rows.length > LIMIT;
  const markers = (truncated ? rows.slice(0, LIMIT) : rows).map((r) => ({
    id: r.id,
    title: r.title,
    lat: Number(r.lat),
    lng: Number(r.lng),
    priceKobo: moneyOut(r.base_price_kobo),
    instant: Boolean(r.instant_book),
    cover: r.cover_url,
  }));

  return {
    markers,
    total: markers.length,
    truncated,
    zoom: Number(zoom),
    bounds: { west: box.west, south: box.south, east: box.east, north: box.north },
  };
}

/* ============================================================
   NEARBY — used on the listing detail page
   ============================================================ */

export async function nearbyListings({ listingId, radiusMeters = 2000, limit = 6 }) {
  const { rows: origin } = await query(
    `SELECT p.location FROM listings l
     JOIN properties p ON p.id = l.property_id
     WHERE l.id = $1`,
    [listingId]
  );
  if (!origin[0]?.location) return { results: [] };

  const { rows } = await query(
    `SELECT
       l.id, l.title, l.base_price_kobo, l.listing_type, l.max_guests,
       l.average_rating,
       ST_Y(p.location::geometry) AS lat,
       ST_X(p.location::geometry) AS lng,
       ST_Distance(p.location, $1::geography)::int AS distance_m,
       (SELECT url FROM listing_media
        WHERE listing_id = l.id AND is_cover = TRUE LIMIT 1) AS cover_url
     FROM listings l
     JOIN properties p ON p.id = l.property_id
     WHERE l.id <> $2
       AND l.status = 'active'
       AND l.deleted_at IS NULL
       AND p.location IS NOT NULL
       AND ST_DWithin(p.location, $1::geography, $3)
     ORDER BY p.location <-> $1::geography
     LIMIT $4`,
    [origin[0].location, listingId, radiusMeters, limit]
  );

  return {
    results: rows.map((r) => ({
      id: r.id,
      title: r.title,
      basePriceKobo: moneyOut(r.base_price_kobo),
      listingType: r.listing_type,
      maxGuests: r.max_guests,
      averageRating: r.average_rating ? Number(r.average_rating) : null,
      lat: Number(r.lat),
      lng: Number(r.lng),
      distanceMeters: Number(r.distance_m),
      coverUrl: r.cover_url,
    })),
  };
}