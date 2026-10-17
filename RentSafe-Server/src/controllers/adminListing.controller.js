import { asyncHandler } from '../utils/asyncHandler.js';
import { query, withTransaction } from '../db.js';
import { HttpError } from '../middleware/error.js';

const moneyOut = (n) => (n == null ? null : Number(n));

export const list = asyncHandler(async (req, res) => {
  const { status = 'pending_review', page = '1', pageSize = '20' } = req.query;
  const p = Math.max(1, Number(page));
  const ps = Math.min(100, Number(pageSize));
  const offset = (p - 1) * ps;

  const where = status === 'all' ? '' : 'WHERE l.status = $3';
  const countRes = await query(
    `SELECT COUNT(*)::int AS total FROM listings l ${where}`,
    status === 'all' ? [] : [status]
  );
  const params = status === 'all'
    ? [ps, offset]
    : [status, ps, offset];
  const orderIdx = params.length;

  const { rows } = await query(
    `SELECT l.id, l.title, l.status, l.listing_type, l.bedrooms, l.max_guests,
            l.base_price_kobo, l.cleaning_fee_kobo, l.currency,
            l.verification_score, l.rejection_reason,
            l.created_at, l.updated_at,
            p.city, p.neighborhood, p.state,
            u.first_name AS host_first_name, u.last_name AS host_last_name,
            u.phone AS host_phone,
            (SELECT url FROM listing_media WHERE listing_id = l.id AND is_cover = TRUE LIMIT 1) AS cover_url,
            (SELECT COUNT(*) FROM listing_media WHERE listing_id = l.id) AS media_count
     FROM listings l
     JOIN properties p ON p.id = l.property_id
     JOIN users u ON u.id = l.host_id
     ${where}
     ORDER BY l.created_at ASC
     LIMIT $${status === 'all' ? 1 : 2} OFFSET $${status === 'all' ? 2 : 3}`,
    params
  );

  res.json({
    data: rows.map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      listingType: r.listing_type,
      bedrooms: r.bedrooms,
      maxGuests: r.max_guests,
      basePriceKobo: moneyOut(r.base_price_kobo),
      currency: r.currency,
      verificationScore: r.verification_score,
      rejectionReason: r.rejection_reason,
      city: r.city,
      neighborhood: r.neighborhood,
      hostName: `${r.host_first_name || ''} ${r.host_last_name || ''}`.trim(),
      hostPhone: r.host_phone,
      coverUrl: r.cover_url,
      mediaCount: Number(r.media_count),
      createdAt: r.created_at,
    })),
    pagination: { page: p, pageSize: ps, total: countRes.rows[0].total },
  });
});

export const detail = asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT l.*, p.address_line1, p.address_line2, p.city, p.neighborhood,
            p.state, p.country, p.property_type, p.ownership_doc_url,
            ST_Y(p.location::geometry) AS lat, ST_X(p.location::geometry) AS lng,
            u.id AS host_user_id, u.first_name AS host_first_name,
            u.last_name AS host_last_name, u.phone AS host_phone,
            u.email AS host_email, u.kyc_status AS host_kyc_status
     FROM listings l
     JOIN properties p ON p.id = l.property_id
     JOIN users u ON u.id = l.host_id
     WHERE l.id = $1`,
    [req.params.id]
  );
  const l = rows[0];
  if (!l) throw new HttpError(404, 'Listing not found');

  const [photos, amenityRows] = await Promise.all([
    query(
      `SELECT id, url, thumbnail_url, is_cover, sort_order
       FROM listing_media WHERE listing_id = $1 ORDER BY sort_order`,
      [req.params.id]
    ),
    query(
      `SELECT a.slug, a.name FROM listing_amenities la
       JOIN amenities a ON a.id = la.amenity_id WHERE la.listing_id = $1`,
      [req.params.id]
    ),
  ]);

  res.json({
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
    basePriceKobo: moneyOut(l.base_price_kobo),
    cleaningFeeKobo: moneyOut(l.cleaning_fee_kobo),
    securityDepositKobo: moneyOut(l.security_deposit_kobo),
    currency: l.currency,
    status: l.status,
    verificationScore: l.verification_score,
    rejectionReason: l.rejection_reason,
    houseRules: l.house_rules,
    host: {
      id: l.host_user_id,
      firstName: l.host_first_name,
      lastName: l.host_last_name,
      phone: l.host_phone,
      email: l.host_email,
      kycStatus: l.host_kyc_status,
    },
    property: {
      addressLine1: l.address_line1,
      addressLine2: l.address_line2,
      city: l.city,
      neighborhood: l.neighborhood,
      state: l.state,
      country: l.country,
      propertyType: l.property_type,
      ownershipDocUrl: l.ownership_doc_url,
      lat: l.lat,
      lng: l.lng,
    },
    photos: photos.rows.map((p) => ({
      id: p.id, url: p.url, thumbnailUrl: p.thumbnail_url,
      isCover: p.is_cover, sortOrder: p.sort_order,
    })),
    amenities: amenityRows.rows,
  });
});

export const approve = asyncHandler(async (req, res) => {
  const { verificationScore = 70 } = req.body || {};
  if (!Number.isFinite(Number(verificationScore)))
    throw new HttpError(400, 'verificationScore must be a number');

  const result = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT id, status FROM listings WHERE id = $1 FOR UPDATE`,
      [req.params.id]
    );
    const l = rows[0];
    if (!l) throw new HttpError(404, 'Listing not found');
    if (l.status !== 'pending_review')
      throw new HttpError(409, `Cannot approve in status "${l.status}"`);

    await client.query(
      `UPDATE listings
       SET status = 'active',
           verification_score = $1,
           verified_at = NOW(),
           verified_by = $2,
           published_at = COALESCE(published_at, NOW()),
           rejection_reason = NULL,
           updated_at = NOW()
       WHERE id = $3`,
      [Math.max(0, Math.min(100, Number(verificationScore))), req.user.id, req.params.id]
    );

    await client.query(
      `INSERT INTO audit_logs
         (actor_id, actor_role, action, entity_type, entity_id, after_state)
       VALUES ($1, $2, 'listing.approve', 'listing', $3, $4)`,
      [req.user.id, req.user.roles[0] || 'admin', req.params.id,
       JSON.stringify({ verificationScore })]
    );

    return { id: req.params.id, status: 'active' };
  });

  res.json(result);
});

export const reject = asyncHandler(async (req, res) => {
  const { reason } = req.body || {};
  if (!reason || reason.trim().length < 5)
    throw new HttpError(400, 'Rejection reason required');

  const result = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT id, status FROM listings WHERE id = $1 FOR UPDATE`,
      [req.params.id]
    );
    const l = rows[0];
    if (!l) throw new HttpError(404, 'Listing not found');
    if (l.status !== 'pending_review')
      throw new HttpError(409, `Cannot reject in status "${l.status}"`);

    await client.query(
      `UPDATE listings
       SET status = 'rejected', rejection_reason = $1, updated_at = NOW()
       WHERE id = $2`,
      [reason, req.params.id]
    );

    await client.query(
      `INSERT INTO audit_logs
         (actor_id, actor_role, action, entity_type, entity_id, notes)
       VALUES ($1, $2, 'listing.reject', 'listing', $3, $4)`,
      [req.user.id, req.user.roles[0] || 'admin', req.params.id, reason]
    );

    return { id: req.params.id, status: 'rejected' };
  });

  res.json(result);
});

export const suspend = asyncHandler(async (req, res) => {
  const { reason } = req.body || {};
  if (!reason) throw new HttpError(400, 'Suspension reason required');
  await query(
    `UPDATE listings
     SET status = 'suspended', suspended_at = NOW(),
         suspension_reason = $1, updated_at = NOW()
     WHERE id = $2 AND status = 'active'`,
    [reason, req.params.id]
  );
  res.json({ ok: true });
});