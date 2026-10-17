import { query, withTransaction } from '../db.js';
import { HttpError } from '../middleware/error.js';

const LISTING_COLS = `
  l.id, l.property_id, l.host_id, l.title, l.description, l.listing_type,
  l.bedrooms, l.beds, l.bathrooms, l.max_guests, l.min_nights, l.max_nights,
  l.check_in_time, l.check_out_time, l.base_price_kobo, l.cleaning_fee_kobo,
  l.security_deposit_kobo, l.currency, l.status, l.instant_book, l.house_rules,
  l.cancellation_policy, l.verification_score, l.verified_at, l.published_at,
  l.suspended_at, l.suspension_reason, l.rejection_reason,
  l.total_bookings, l.average_rating, l.created_at, l.updated_at
`;

const PROPERTY_COLS = `
  p.id AS property_id, p.address_line1, p.address_line2, p.city,
  p.neighborhood, p.state, p.country, p.postal_code, p.property_type,
  p.ownership_type, p.ownership_doc_url,
  ST_Y(p.location::geometry) AS lat, ST_X(p.location::geometry) AS lng
`;

const moneyOut = (n) => (n == null ? null : Number(n));
const moneyIn  = (n) => (n == null ? null : Math.round(Number(n)));

/* ============================================================
   CREATE (Property + Listing in one call)
   ============================================================ */

export async function createPropertyWithListing({ host, payload }) {
  const {
    property = {},
    listing = {},
  } = payload;

  if (!property.addressLine1 || !property.city || !property.state)
    throw new HttpError(400, 'Property address, city, and state are required');

  if (!listing.title || listing.title.trim().length < 5)
    throw new HttpError(400, 'Listing title must be at least 5 characters');

  if (!listing.basePriceKobo || listing.basePriceKobo <= 0)
    throw new HttpError(400, 'Base price must be greater than 0');

  return withTransaction(async (client) => {
    // Build PostGIS point if coords provided
    let locationExpr = 'NULL';
    const params = [
      host.id,
      property.name || null,
      property.propertyType || 'apartment',
      property.addressLine1,
      property.addressLine2 || null,
      property.city,
      property.neighborhood || null,
      property.state,
      property.country || 'Nigeria',
      property.postalCode || null,
      property.ownershipType || 'owned',
      property.ownershipDocUrl || null,
    ];
    if (property.lat != null && property.lng != null) {
      params.push(property.lng, property.lat);
      locationExpr = `ST_SetSRID(ST_MakePoint($${params.length - 1}, $${params.length}), 4326)::geography`;
    }

    const { rows: propRows } = await client.query(
      `INSERT INTO properties
         (host_id, name, property_type, address_line1, address_line2, city,
          neighborhood, state, country, postal_code, ownership_type,
          ownership_doc_url, location)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, ${locationExpr})
       RETURNING id`,
      params
    );
    const propertyId = propRows[0].id;

    const { rows: listRows } = await client.query(
      `INSERT INTO listings
         (property_id, host_id, title, description, listing_type,
          bedrooms, beds, bathrooms, max_guests, min_nights, max_nights,
          check_in_time, check_out_time, base_price_kobo, cleaning_fee_kobo,
          security_deposit_kobo, currency, instant_book, house_rules,
          cancellation_policy, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,'draft')
       RETURNING id`,
      [
        propertyId,
        host.id,
        listing.title,
        listing.description || null,
        listing.listingType || 'entire_place',
        listing.bedrooms ?? 1,
        listing.beds ?? 1,
        listing.bathrooms ?? 1,
        listing.maxGuests ?? 2,
        listing.minNights ?? 1,
        listing.maxNights ?? 30,
        listing.checkInTime || '15:00',
        listing.checkOutTime || '11:00',
        moneyIn(listing.basePriceKobo),
        moneyIn(listing.cleaningFeeKobo) || 0,
        moneyIn(listing.securityDepositKobo) || 0,
        'NGN',
        Boolean(listing.instantBook),
        listing.houseRules || null,
        listing.cancellationPolicy || 'moderate',
      ]
    );
    const listingId = listRows[0].id;

    // Amenities
    if (Array.isArray(listing.amenities) && listing.amenities.length) {
      await client.query(
        `INSERT INTO listing_amenities (listing_id, amenity_id)
         SELECT $1, id FROM amenities WHERE slug = ANY($2::text[])`,
        [listingId, listing.amenities]
      );
    }

    return { propertyId, listingId };
  });
}

/* ============================================================
   UPDATE
   ============================================================ */

export async function updateListing({ host, listingId, patch }) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT l.id, l.host_id, l.status FROM listings l WHERE l.id = $1`,
      [listingId]
    );
    const listing = rows[0];
    if (!listing) throw new HttpError(404, 'Listing not found');
    if (listing.host_id !== host.id) throw new HttpError(403, 'Not your listing');
    if (!['draft', 'rejected'].includes(listing.status))
      throw new HttpError(409, `Cannot edit a listing in status "${listing.status}"`);

    const fields = [];
    const values = [];
    const add = (col, val) => {
      if (val === undefined) return;
      values.push(val);
      fields.push(`${col} = $${values.length}`);
    };

    add('title', patch.title);
    add('description', patch.description);
    add('listing_type', patch.listingType);
    add('bedrooms', patch.bedrooms);
    add('beds', patch.beds);
    add('bathrooms', patch.bathrooms);
    add('max_guests', patch.maxGuests);
    add('min_nights', patch.minNights);
    add('max_nights', patch.maxNights);
    add('check_in_time', patch.checkInTime);
    add('check_out_time', patch.checkOutTime);
    add('base_price_kobo', patch.basePriceKobo != null ? moneyIn(patch.basePriceKobo) : undefined);
    add('cleaning_fee_kobo', patch.cleaningFeeKobo != null ? moneyIn(patch.cleaningFeeKobo) : undefined);
    add('security_deposit_kobo', patch.securityDepositKobo != null ? moneyIn(patch.securityDepositKobo) : undefined);
    add('instant_book', patch.instantBook);
    add('house_rules', patch.houseRules);
    add('cancellation_policy', patch.cancellationPolicy);

    if (fields.length) {
      values.push(listingId);
      await client.query(
        `UPDATE listings SET ${fields.join(', ')}, updated_at = NOW() WHERE id = $${values.length}`,
        values
      );
    }

    if (Array.isArray(patch.amenities)) {
      await client.query(`DELETE FROM listing_amenities WHERE listing_id = $1`, [listingId]);
      if (patch.amenities.length) {
        await client.query(
          `INSERT INTO listing_amenities (listing_id, amenity_id)
           SELECT $1, id FROM amenities WHERE slug = ANY($2::text[])`,
          [listingId, patch.amenities]
        );
      }
    }

    return { id: listingId };
  });
}

/* ============================================================
   SUBMIT FOR REVIEW
   ============================================================ */

export async function submitForReview({ host, listingId }) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT l.id, l.host_id, l.status, l.title,
              (SELECT COUNT(*) FROM listing_media WHERE listing_id = l.id) AS media_count,
              (SELECT COUNT(*) FROM listing_media WHERE listing_id = l.id AND is_cover = TRUE) AS cover_count
       FROM listings l WHERE l.id = $1`,
      [listingId]
    );
    const l = rows[0];
    if (!l) throw new HttpError(404, 'Listing not found');
    if (l.host_id !== host.id) throw new HttpError(403, 'Not your listing');
    if (!['draft', 'rejected'].includes(l.status))
      throw new HttpError(409, `Cannot submit in status "${l.status}"`);

    if (Number(l.media_count) < 3)
      throw new HttpError(400, 'Upload at least 3 photos before submitting');
    if (Number(l.cover_count) === 0)
      throw new HttpError(400, 'Set a cover photo before submitting');

    await client.query(
      `UPDATE listings
       SET status = 'pending_review', rejection_reason = NULL, updated_at = NOW()
       WHERE id = $1`,
      [listingId]
    );

    return { id: listingId, status: 'pending_review' };
  });
}

/* ============================================================
   LIST HOST'S LISTINGS
   ============================================================ */

export async function listHostListings({ host, status }) {
  const params = [host.id];
  let where = `WHERE l.host_id = $1 AND l.deleted_at IS NULL`;
  if (status && status !== 'all') {
    params.push(status);
    where += ` AND l.status = $${params.length}`;
  }

  const { rows } = await query(
    `SELECT ${LISTING_COLS},
            ${PROPERTY_COLS},
            (SELECT url FROM listing_media WHERE listing_id = l.id AND is_cover = TRUE LIMIT 1) AS cover_url,
            (SELECT COUNT(*) FROM listing_media WHERE listing_id = l.id) AS media_count,
            (SELECT COUNT(*) FROM bookings WHERE listing_id = l.id AND status = 'completed') AS completed_bookings
     FROM listings l
     JOIN properties p ON p.id = l.property_id
     ${where}
     ORDER BY l.created_at DESC`,
    params
  );

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    status: r.status,
    listingType: r.listing_type,
    bedrooms: r.bedrooms,
    maxGuests: r.max_guests,
    basePriceKobo: moneyOut(r.base_price_kobo),
    currency: r.currency,
    coverUrl: r.cover_url,
    mediaCount: Number(r.media_count),
    completedBookings: Number(r.completed_bookings),
    verificationScore: r.verification_score,
    city: r.city,
    neighborhood: r.neighborhood,
    rejectionReason: r.rejection_reason,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

/* ============================================================
   GET ONE (host edit view)
   ============================================================ */

export async function getHostListing({ host, listingId }) {
  const { rows } = await query(
    `SELECT ${LISTING_COLS}, ${PROPERTY_COLS}
     FROM listings l JOIN properties p ON p.id = l.property_id
     WHERE l.id = $1`,
    [listingId]
  );
  const l = rows[0];
  if (!l) throw new HttpError(404, 'Listing not found');
  if (l.host_id !== host.id) throw new HttpError(403, 'Not your listing');

  const [photos, amenityRows, availabilityRows] = await Promise.all([
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
      `SELECT date, is_available, price_override_kobo, note
       FROM listing_availability WHERE listing_id = $1 AND date >= CURRENT_DATE
       ORDER BY date`,
      [listingId]
    ),
  ]);

  return {
    id: l.id,
    propertyId: l.property_id,
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
    status: l.status,
    instantBook: l.instant_book,
    houseRules: l.house_rules,
    cancellationPolicy: l.cancellation_policy,
    verificationScore: l.verification_score,
    rejectionReason: l.rejection_reason,
    property: {
      id: l.property_id,
      addressLine1: l.address_line1,
      addressLine2: l.address_line2,
      city: l.city,
      neighborhood: l.neighborhood,
      state: l.state,
      country: l.country,
      postalCode: l.postal_code,
      propertyType: l.property_type,
      ownershipType: l.ownership_type,
      ownershipDocUrl: l.ownership_doc_url,
      lat: l.lat,
      lng: l.lng,
    },
    photos: photos.rows.map((p) => ({
      id: p.id,
      url: p.url,
      thumbnailUrl: p.thumbnail_url,
      caption: p.caption,
      sortOrder: p.sort_order,
      isCover: p.is_cover,
    })),
    amenities: amenityRows.rows,
    availability: availabilityRows.rows.map((a) => ({
      date: a.date,
      isAvailable: a.is_available,
      priceOverrideKobo: moneyOut(a.price_override_kobo),
      note: a.note,
    })),
  };
}

/* ============================================================
   AVAILABILITY — Block/unblock a range
   ============================================================ */

export async function setAvailabilityRange({
  host, listingId, startDate, endDate, isAvailable, priceOverrideKobo, note,
}) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT host_id, status FROM listings WHERE id = $1`,
      [listingId]
    );
    if (!rows[0]) throw new HttpError(404, 'Listing not found');
    if (rows[0].host_id !== host.id) throw new HttpError(403, 'Not your listing');

    await client.query(
      `INSERT INTO listing_availability
         (listing_id, date, is_available, price_override_kobo, note)
       SELECT $1, d::date, $2, $3, $4
       FROM generate_series($5::date, $6::date, '1 day') d
       ON CONFLICT (listing_id, date) DO UPDATE
         SET is_available = EXCLUDED.is_available,
             price_override_kobo = EXCLUDED.price_override_kobo,
             note = EXCLUDED.note`,
      [listingId, isAvailable, priceOverrideKobo || null, note || null, startDate, endDate]
    );

    return { ok: true };
  });
}

/* ============================================================
   DELETE
   ============================================================ */

export async function archiveListing({ host, listingId }) {
  const { rows } = await query(
    `UPDATE listings
     SET status = 'archived', updated_at = NOW()
     WHERE id = $1 AND host_id = $2 AND status IN ('draft','active','rejected','suspended')
     RETURNING id`,
    [listingId, host.id]
  );
  if (!rows[0]) throw new HttpError(404, 'Listing not found or cannot be archived');
  return { ok: true };
}