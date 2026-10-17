import { query, withTransaction } from '../db.js';
import { HttpError } from '../middleware/error.js';

const DAY_MS = 86400_000;
const MAX_RANGE_DAYS = 365;

const isoDate = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d);
const today = () => isoDate(new Date());

function daysInclusive(from, to) {
  const out = [];
  let cur = new Date(from + 'T00:00:00Z');
  const last = new Date(to + 'T00:00:00Z');
  while (cur <= last) {
    out.push(isoDate(cur));
    cur = new Date(cur.getTime() + DAY_MS);
  }
  return out;
}

function nightsBetween(checkIn, checkOut) {
  const out = [];
  let cur = new Date(checkIn + 'T00:00:00Z');
  const end = new Date(checkOut + 'T00:00:00Z');
  while (cur < end) {
    out.push(isoDate(cur));
    cur = new Date(cur.getTime() + DAY_MS);
  }
  return out;
}

function validateRange(from, to) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(to || ''))
    throw new HttpError(400, 'Dates must be YYYY-MM-DD');
  if (from > to) throw new HttpError(400, 'from must be before to');
  const days = Math.round((new Date(to) - new Date(from)) / DAY_MS) + 1;
  if (days > MAX_RANGE_DAYS)
    throw new HttpError(400, `Range cannot exceed ${MAX_RANGE_DAYS} days`);
}

async function assertHostOwnsListing(client, listingId, hostId) {
  const { rows } = await client.query(
    `SELECT id, host_id, base_price_kobo, min_nights, currency, title
     FROM listings WHERE id = $1 AND deleted_at IS NULL`,
    [listingId]
  );
  const l = rows[0];
  if (!l) throw new HttpError(404, 'Listing not found');
  if (l.host_id !== hostId) throw new HttpError(403, 'Not your listing');
  return l;
}

/* ============================================================
   HOST — full availability view for a month
   ============================================================ */

export async function getHostAvailability({ host, listingId, from, to }) {
  validateRange(from, to);

  const { rows: lRows } = await query(
    `SELECT id, host_id, base_price_kobo, min_nights, currency, title
     FROM listings WHERE id = $1 AND deleted_at IS NULL`,
    [listingId]
  );
  const listing = lRows[0];
  if (!listing) throw new HttpError(404, 'Listing not found');
  if (listing.host_id !== host.id) throw new HttpError(403, 'Not your listing');

  const [availRows, bookingRows] = await Promise.all([
    query(
      `SELECT date, is_available, price_override_kobo, min_nights_override, note
       FROM listing_availability
       WHERE listing_id = $1 AND date BETWEEN $2 AND $3
       ORDER BY date`,
      [listingId, from, to]
    ),
    query(
      `SELECT check_in_date, check_out_date, status
       FROM bookings
       WHERE listing_id = $1
         AND status IN ('confirmed', 'checked_in')
         AND daterange(check_in_date, check_out_date, '[)') &&
             daterange($2::date, $3::date, '[)')
       ORDER BY check_in_date`,
      [listingId, from, to]
    ),
  ]);

  return {
    listingId,
    listingTitle: listing.title,
    basePriceKobo: Number(listing.base_price_kobo),
    defaultMinNights: listing.min_nights,
    currency: listing.currency,
    days: availRows.rows.map((r) => ({
      date: isoDate(r.date),
      isAvailable: r.is_available,
      priceOverrideKobo: r.price_override_kobo == null ? null : Number(r.price_override_kobo),
      minNightsOverride: r.min_nights_override,
      note: r.note,
    })),
    bookings: bookingRows.rows.map((r) => ({
      checkIn: isoDate(r.check_in_date),
      checkOut: isoDate(r.check_out_date),
      status: r.status,
    })),
  };
}

/* ============================================================
   GUEST — public availability, fully resolved per date
   ============================================================ */

export async function getPublicAvailability({ listingId, from, to }) {
  validateRange(from, to);

  const { rows: lRows } = await query(
    `SELECT id, base_price_kobo, min_nights, currency, status
     FROM listings WHERE id = $1 AND deleted_at IS NULL`,
    [listingId]
  );
  const listing = lRows[0];
  if (!listing || listing.status !== 'active')
    throw new HttpError(404, 'Listing not found');

  const [availRows, bookingRows] = await Promise.all([
    query(
      `SELECT date, is_available, price_override_kobo, min_nights_override
       FROM listing_availability
       WHERE listing_id = $1 AND date BETWEEN $2 AND $3`,
      [listingId, from, to]
    ),
    query(
      `SELECT check_in_date, check_out_date
       FROM bookings
       WHERE listing_id = $1
         AND status IN ('confirmed', 'checked_in')
         AND daterange(check_in_date, check_out_date, '[)') &&
             daterange($2::date, $3::date, '[)')`,
      [listingId, from, to]
    ),
  ]);

  const overrideMap = new Map();
  for (const r of availRows.rows) {
    overrideMap.set(isoDate(r.date), {
      priceOverride: r.price_override_kobo == null ? null : Number(r.price_override_kobo),
      minNightsOverride: r.min_nights_override,
      available: r.is_available,
    });
  }

  const bookedSet = new Set();
  for (const b of bookingRows.rows) {
    for (const n of nightsBetween(isoDate(b.check_in_date), isoDate(b.check_out_date))) {
      bookedSet.add(n);
    }
  }

  const days = daysInclusive(from, to).map((d) => {
    const ov = overrideMap.get(d);
    const isBooked = bookedSet.has(d);
    const isBlocked = ov && ov.available === false;
    return {
      date: d,
      available: !isBooked && !isBlocked,
      booked: isBooked,
      priceKobo: ov?.priceOverride ?? Number(listing.base_price_kobo),
      hasOverride: ov?.priceOverride != null,
      minNights: ov?.minNightsOverride ?? listing.min_nights,
    };
  });

  return {
    listingId,
    basePriceKobo: Number(listing.base_price_kobo),
    defaultMinNights: listing.min_nights,
    currency: listing.currency,
    days,
  };
}

/* ============================================================
   HOST — bulk upsert (preserves unspecified fields)
   ============================================================ */

export async function bulkUpsertAvailability({ host, listingId, updates }) {
  if (!Array.isArray(updates) || !updates.length)
    throw new HttpError(400, 'updates array required');
  if (updates.length > MAX_RANGE_DAYS)
    throw new HttpError(400, `Cannot update more than ${MAX_RANGE_DAYS} days at once`);

  // Validate individual fields
  for (const u of updates) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(u.date || ''))
      throw new HttpError(400, `Invalid date: ${u.date}`);
    if (u.date < today())
      throw new HttpError(400, `Cannot modify past date: ${u.date}`);
    if (u.priceOverrideKobo != null && (!Number.isInteger(u.priceOverrideKobo) || u.priceOverrideKobo <= 0))
      throw new HttpError(400, 'priceOverrideKobo must be a positive integer (kobo)');
    if (u.minNightsOverride != null && (!Number.isInteger(u.minNightsOverride) || u.minNightsOverride < 1))
      throw new HttpError(400, 'minNightsOverride must be >= 1');
  }

  const dates = updates.map((u) => u.date);

  return withTransaction(async (client) => {
    await assertHostOwnsListing(client, listingId, host.id);

    // Merge with existing rows so partial updates don't clobber other fields
    const { rows: existing } = await client.query(
      `SELECT date, is_available, price_override_kobo, min_nights_override, note
       FROM listing_availability
       WHERE listing_id = $1 AND date = ANY($2::date[])`,
      [listingId, dates]
    );
    const exMap = new Map(existing.map((r) => [isoDate(r.date), r]));

    const final = updates.map((u) => {
      const ex = exMap.get(u.date);
      return {
        date: u.date,
        isAvailable: u.isAvailable === undefined
          ? (ex?.is_available ?? true)
          : Boolean(u.isAvailable),
        priceOverrideKobo: u.priceOverrideKobo === undefined
          ? (ex?.price_override_kobo ?? null)
          : u.priceOverrideKobo,
        minNightsOverride: u.minNightsOverride === undefined
          ? (ex?.min_nights_override ?? null)
          : u.minNightsOverride,
        note: u.note === undefined ? (ex?.note ?? null) : u.note,
      };
    });

    // Blocking validation against active bookings
    const toBlock = final.filter((f) => !f.isAvailable).map((f) => f.date);
    if (toBlock.length) {
      const { rows: conflicts } = await client.query(
        `SELECT check_in_date, check_out_date
         FROM bookings
         WHERE listing_id = $1
           AND status IN ('confirmed', 'checked_in')
           AND daterange(check_in_date, check_out_date, '[)') &&
               daterange($2::date, $3::date, '[)')`,
        [listingId, toBlock.reduce((a, b) => (a < b ? a : b)),
                     toBlock.reduce((a, b) => (a > b ? a : b))]
      );
      const bookedSet = new Set();
      for (const b of conflicts) {
        for (const n of nightsBetween(isoDate(b.check_in_date), isoDate(b.check_out_date))) {
          bookedSet.add(n);
        }
      }
      const bad = toBlock.filter((d) => bookedSet.has(d));
      if (bad.length)
        throw new HttpError(409,
          `Cannot block dates covered by an active booking: ${bad.slice(0, 5).join(', ')}${bad.length > 5 ? '…' : ''}`);
    }

    await client.query(
      `INSERT INTO listing_availability
         (listing_id, date, is_available, price_override_kobo, min_nights_override, note)
       SELECT $1, d::date, a, p, m, n
       FROM unnest($2::text[], $3::boolean[], $4::bigint[], $5::smallint[], $6::text[])
         AS x(d, a, p, m, n)
       ON CONFLICT (listing_id, date) DO UPDATE
         SET is_available = EXCLUDED.is_available,
             price_override_kobo = EXCLUDED.price_override_kobo,
             min_nights_override = EXCLUDED.min_nights_override,
             note = EXCLUDED.note`,
      [
        listingId,
        final.map((f) => f.date),
        final.map((f) => f.isAvailable),
        final.map((f) => f.priceOverrideKobo),
        final.map((f) => f.minNightsOverride),
        final.map((f) => f.note),
      ]
    );

    const { rows: updated } = await client.query(
      `SELECT date, is_available, price_override_kobo, min_nights_override, note
       FROM listing_availability
       WHERE listing_id = $1 AND date = ANY($2::date[])
       ORDER BY date`,
      [listingId, dates]
    );

    return {
      updated: updated.map((r) => ({
        date: isoDate(r.date),
        isAvailable: r.is_available,
        priceOverrideKobo: r.price_override_kobo == null ? null : Number(r.price_override_kobo),
        minNightsOverride: r.min_nights_override,
        note: r.note,
      })),
    };
  });
}

/* ============================================================
   HOST — clear price/min-nights overrides for a set of dates
   ============================================================ */

export async function clearOverrides({ host, listingId, dates }) {
  if (!Array.isArray(dates) || !dates.length)
    throw new HttpError(400, 'dates array required');

  return withTransaction(async (client) => {
    await assertHostOwnsListing(client, listingId, host.id);

    await client.query(
      `UPDATE listing_availability
       SET price_override_kobo = NULL, min_nights_override = NULL
       WHERE listing_id = $1 AND date = ANY($2::date[])`,
      [listingId, dates]
    );

    // Rows that no longer carry information can be dropped
    await client.query(
      `DELETE FROM listing_availability
       WHERE listing_id = $1 AND date = ANY($2::date[])
         AND is_available = TRUE
         AND price_override_kobo IS NULL
         AND min_nights_override IS NULL
         AND note IS NULL`,
      [listingId, dates]
    );

    return { ok: true };
  });
}

/* ============================================================
   GUEST — price calculation for a proposed range
   ============================================================ */

export async function priceRange({ listingId, checkIn, checkOut }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(checkIn || '') || !/^\d{4}-\d{2}-\d{2}$/.test(checkOut || ''))
    throw new HttpError(400, 'Invalid dates');
  if (checkOut <= checkIn)
    throw new HttpError(400, 'checkOut must be after checkIn');

  const { rows: lRows } = await query(
    `SELECT id, base_price_kobo, cleaning_fee_kobo, security_deposit_kobo,
            min_nights, currency, status
     FROM listings WHERE id = $1`,
    [listingId]
  );
  const listing = lRows[0];
  if (!listing || listing.status !== 'active')
    throw new HttpError(404, 'Listing not found');

  const nights = nightsBetween(checkIn, checkOut);
  if (nights.length < listing.min_nights)
    throw new HttpError(400, `Minimum stay is ${listing.min_nights} nights`);

  const [availRows, bookingRows] = await Promise.all([
    query(
      `SELECT date, is_available, price_override_kobo
       FROM listing_availability
       WHERE listing_id = $1 AND date = ANY($2::date[])`,
      [listingId, nights]
    ),
    query(
      `SELECT check_in_date, check_out_date
       FROM bookings
       WHERE listing_id = $1
         AND status IN ('confirmed', 'checked_in')
         AND daterange(check_in_date, check_out_date, '[)') &&
             daterange($2::date, $3::date, '[)')`,
      [listingId, checkIn, checkOut]
    ),
  ]);

  const overrideMap = new Map();
  for (const r of availRows.rows) {
    overrideMap.set(isoDate(r.date), {
      available: r.is_available,
      priceOverride: r.price_override_kobo == null ? null : Number(r.price_override_kobo),
    });
  }

  const blockedSet = new Set();
  for (const r of availRows.rows) if (!r.is_available) blockedSet.add(isoDate(r.date));
  for (const b of bookingRows.rows) {
    for (const n of nightsBetween(isoDate(b.check_in_date), isoDate(b.check_out_date))) {
      blockedSet.add(n);
    }
  }

  const unavailable = nights.filter((d) => blockedSet.has(d));
  if (unavailable.length) {
    throw new HttpError(409,
      `Dates unavailable: ${unavailable.slice(0, 5).join(', ')}${unavailable.length > 5 ? '…' : ''}`);
  }

  let subtotal = 0;
  const breakdown = nights.map((d) => {
    const ov = overrideMap.get(d);
    const price = ov?.priceOverride ?? Number(listing.base_price_kobo);
    subtotal += price;
    return { date: d, priceKobo: price, isOverride: ov?.priceOverride != null };
  });

  const cleaningFee = Number(listing.cleaning_fee_kobo) || 0;
  const securityDeposit = Number(listing.security_deposit_kobo) || 0;
  const platformFee = Math.round(subtotal * 0.155);

  return {
    listingId,
    checkIn,
    checkOut,
    nights: nights.length,
    currency: listing.currency,
    basePriceKobo: Number(listing.base_price_kobo),
    subtotalKobo: subtotal,
    cleaningFeeKobo: cleaningFee,
    securityDepositKobo: securityDeposit,
    platformFeeKobo: platformFee,
    totalKobo: subtotal + cleaningFee + securityDeposit + platformFee,
    priceBreakdown: breakdown,
  };
}