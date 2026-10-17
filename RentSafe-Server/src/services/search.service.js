import { query } from '../db.js';

const moneyOut = (n) => (n == null ? null : Number(n));

/**
 * Public search for shortlet listings.
 *
 * Filters:
 *   q          – free text (title, city, neighborhood)
 *   city       – exact city
 *   lat/lng/r  – geo radius in meters
 *   checkIn    – YYYY-MM-DD (optional)
 *   checkOut   – YYYY-MM-DD (optional)
 *   guests     – min max_guests
 *   minPrice   – kobo
 *   maxPrice   – kobo
 *   type       – entire_place | private_room | shared_room
 *   amenities  – comma-separated slugs
 *   instant    – true|false
 *   sort       – price_asc | price_desc | rating | newest
 *   page, pageSize
 */
export async function searchListings(params) {
  const {
    q = '', city = '',
    lat, lng, r = 10000,
    checkIn, checkOut,
    guests, minPrice, maxPrice, type, amenities,
    instant, sort = 'rating',
    page = 1, pageSize = 20,
  } = params;

  const where = [`l.status = 'active'`, `l.deleted_at IS NULL`];
  const values = [];

  const add = (sql, val) => {
    values.push(val);
    where.push(sql.replace('?', `$${values.length}`));
  };

  if (q) {
    values.push(`%${q}%`);
    const i = values.length;
    where.push(`(l.title ILIKE $${i} OR p.city ILIKE $${i} OR p.neighborhood ILIKE $${i})`);
  }
  if (city) add(`p.city = ?`, city);
  if (guests) add(`l.max_guests >= ?`, Number(guests));
  if (minPrice) add(`l.base_price_kobo >= ?`, Number(minPrice));
  if (maxPrice) add(`l.base_price_kobo <= ?`, Number(maxPrice));
  if (type) add(`l.listing_type = ?::listing_type`, type);
  if (instant === 'true') where.push(`l.instant_book = TRUE`);

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

  if (lat != null && lng != null) {
    values.push(lng, lat, Number(r));
    const i = values.length;
    where.push(`ST_DWithin(p.location::geography,
                          ST_SetSRID(ST_MakePoint($${i - 1}, $${i - 2}), 4326)::geography,
                          $${i})`);
  }

  if (checkIn && checkOut) {
    values.push(checkIn, checkOut);
    const i = values.length;
    // Not blocked by host
    where.push(`NOT EXISTS (
      SELECT 1 FROM listing_availability a
      WHERE a.listing_id = l.id
        AND a.date >= $${i - 1}::date
        AND a.date <  $${i}::date
        AND a.is_available = FALSE
    )`);
    // Not overlapping a confirmed booking
    where.push(`NOT EXISTS (
      SELECT 1 FROM bookings b
      WHERE b.listing_id = l.id
        AND b.status IN ('confirmed', 'checked_in')
        AND daterange(b.check_in_date, b.check_out_date, '[)') &&
            daterange($${i - 1}::date, $${i}::date, '[)')
    )`);
  }

  const whereSql = `WHERE ${where.join(' AND ')}`;

  const sortSql = {
    price_asc:  'l.base_price_kobo ASC',
    price_desc: 'l.base_price_kobo DESC',
    rating:     'l.average_rating DESC, l.total_bookings DESC',
    newest:     'l.published_at DESC NULLS LAST, l.created_at DESC',
  }[sort] || 'l.average_rating DESC';

  // Count
  const countRes = await query(
    `SELECT COUNT(*)::int AS total
     FROM listings l JOIN properties p ON p.id = l.property_id
     ${whereSql}`,
    values
  );
  const total = countRes.rows[0].total;

  const p = Math.max(1, Number(page));
  const ps = Math.min(50, Math.max(5, Number(pageSize)));
  const offset = (p - 1) * ps;

  values.push(ps, offset);
  const { rows } = await query(
    `SELECT l.id, l.title, l.listing_type, l.bedrooms, l.beds, l.bathrooms,
            l.max_guests, l.base_price_kobo, l.cleaning_fee_kobo, l.currency,
            l.instant_book, l.verification_score, l.average_rating, l.total_bookings,
            p.city, p.neighborhood, p.state,
            ST_Y(p.location::geometry) AS lat, ST_X(p.location::geometry) AS lng,
            (SELECT url FROM listing_media WHERE listing_id = l.id AND is_cover = TRUE LIMIT 1) AS cover_url
     FROM listings l JOIN properties p ON p.id = l.property_id
     ${whereSql}
     ORDER BY ${sortSql}
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );

  return {
    results: rows.map((r) => ({
      id: r.id,
      title: r.title,
      listingType: r.listing_type,
      bedrooms: r.bedrooms,
      beds: r.beds,
      bathrooms: Number(r.bathrooms),
      maxGuests: r.max_guests,
      basePriceKobo: moneyOut(r.base_price_kobo),
      cleaningFeeKobo: moneyOut(r.cleaning_fee_kobo),
      currency: r.currency,
      instantBook: r.instant_book,
      verificationScore: r.verification_score,
      averageRating: r.average_rating ? Number(r.average_rating) : null,
      reviewCount: r.total_bookings,
      city: r.city,
      neighborhood: r.neighborhood,
      state: r.state,
      lat: r.lat,
      lng: r.lng,
      coverUrl: r.cover_url,
    })),
    pagination: { page: p, pageSize: ps, total, pages: Math.ceil(total / ps) },
  };
}

/* ============================================================
   PUBLIC DETAIL
   ============================================================ */

export async function getPublicListing(listingId) {
  const { rows } = await query(
    `SELECT l.*, p.city, p.neighborhood, p.state, p.country,
            ST_Y(p.location::geometry) AS lat, ST_X(p.location::geometry) AS lng,
            u.first_name AS host_first_name, u.last_name AS host_last_name,
            u.id AS host_user_id,
            hp.is_superhost, hp.average_rating AS host_rating,
            hp.total_bookings AS host_bookings
     FROM listings l
     JOIN properties p ON p.id = l.property_id
     JOIN users u ON u.id = l.host_id
     LEFT JOIN host_profiles hp ON hp.user_id = l.host_id
     WHERE l.id = $1 AND l.status = 'active' AND l.deleted_at IS NULL`,
    [listingId]
  );
  const l = rows[0];
  if (!l) return null;

  const [photos, amenityRows, availRows, reviewRows] = await Promise.all([
    query(
      `SELECT id, url, thumbnail_url, caption, sort_order, is_cover
       FROM listing_media WHERE listing_id = $1 ORDER BY sort_order`,
      [listingId]
    ),
    query(
      `SELECT a.slug, a.name, a.category, a.icon
       FROM listing_amenities la JOIN amenities a ON a.id = la.amenity_id
       WHERE la.listing_id = $1 ORDER BY a.sort_order`,
      [listingId]
    ),
    query(
      `SELECT date, price_override_kobo FROM listing_availability
       WHERE listing_id = $1 AND date BETWEEN CURRENT_DATE AND CURRENT_DATE + 90
         AND is_available = FALSE`,
      [listingId]
    ),
    query(
      `SELECT id, overall_rating, comment, created_at, author_id
       FROM reviews
       WHERE listing_id = $1 AND is_published = TRUE AND review_type = 'guest_to_host'
       ORDER BY created_at DESC LIMIT 10`,
      [listingId]
    ).catch(() => ({ rows: [] })), // tolerate missing reviews table
  ]);

  // Approximate location: don't reveal full address until booking
  const approxLat = l.lat ? Math.round(Number(l.lat) * 100) / 100 : null;
  const approxLng = l.lng ? Math.round(Number(l.lng) * 100) / 100 : null;

  return {
    id: l.id,
    title: l.title,
    description: l.description,
    listingType: l.listing_type,
    bedrooms: l.bedrooms,
    beds: l.beds,
    bathrooms: Number(l.bathrooms),
    maxGuests: l.max_guests,
    minNights: l.min_nights,
    maxNights: l.max_nights,
    checkInTime: l.check_in_time,
    checkOutTime: l.check_out_time,
    basePriceKobo: moneyOut(l.base_price_kobo),
    cleaningFeeKobo: moneyOut(l.cleaning_fee_kobo),
    securityDepositKobo: moneyOut(l.security_deposit_kobo),
    currency: l.currency,
    instantBook: l.instant_book,
    houseRules: l.house_rules,
    cancellationPolicy: l.cancellation_policy,
    verificationScore: l.verification_score,
    averageRating: l.average_rating ? Number(l.average_rating) : null,
    reviewCount: l.total_bookings,
    host: {
      id: l.host_user_id,
      firstName: l.host_first_name,
      lastName: l.host_last_name ? l.host_last_name[0] + '.' : '',
      isSuperhost: Boolean(l.is_superhost),
      rating: l.host_rating ? Number(l.host_rating) : null,
      bookings: l.host_bookings ? Number(l.host_bookings) : 0,
    },
    location: {
      city: l.city,
      neighborhood: l.neighborhood,
      state: l.state,
      country: l.country,
      lat: approxLat,
      lng: approxLng,
    },
    photos: photos.rows.map((p) => ({
      id: p.id,
      url: p.url,
      thumbnailUrl: p.thumbnail_url,
      caption: p.caption,
      isCover: p.is_cover,
    })),
    amenities: amenityRows.rows,
    unavailableDates: availRows.rows.map((a) => a.date),
    reviews: reviewRows.rows.map((r) => ({
      id: r.id,
      rating: r.overall_rating,
      comment: r.comment,
      createdAt: r.created_at,
    })),
  };
}