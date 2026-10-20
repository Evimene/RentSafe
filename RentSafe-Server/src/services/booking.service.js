import crypto from 'node:crypto';
import { query, withTransaction } from '../db.js';
import { HttpError } from '../middleware/error.js';
import { config } from '../config.js';
import { priceRange } from './availability.service.js';

const DAY_MS = 86400_000;
const moneyOut = (n) => (n == null ? null : Number(n));
const kobo = (n) => Math.round(Number(n));

function makeBookingRef() {
  const y = new Date().getFullYear();
  return `BK-${y}-${crypto.randomInt(100000, 999999)}`;
}

function nightsBetween(checkIn, checkOut) {
  const out = [];
  let cur = new Date(checkIn + 'T00:00:00Z');
  const end = new Date(checkOut + 'T00:00:00Z');
  while (cur < end) {
    out.push(cur.toISOString().slice(0, 10));
    cur = new Date(cur.getTime() + DAY_MS);
  }
  return out;
}

/* ============================================================
   QUOTE — pure read, no DB writes. Called from the UI.
   ============================================================ */

export async function quote({ listingId, checkIn, checkOut, guests }) {
  // Reuse the availability module's pricing — it already checks
  // blocked dates, existing bookings, min-stay, and computes totals
  const pricing = await priceRange({ listingId, checkIn, checkOut });

  const { rows } = await query(
    `SELECT cancellation_policy, instant_book, max_guests, host_id
     FROM listings WHERE id = $1`,
    [listingId]
  );
  const l = rows[0];
  if (!l) throw new HttpError(404, 'Listing not found');
  if (Number(guests) > l.max_guests)
    throw new HttpError(400, `Maximum ${l.max_guests} guests`);

  return {
    ...pricing,
    guests: Number(guests || 1),
    instantBook: l.instant_book,
    cancellationPolicy: l.cancellation_policy,
  };
}

/* ============================================================
   CREATE — writes the pending_payment row + locks dates
   ============================================================ */

export async function createBooking({ guest, payload }) {
  const {
    listingId, checkIn, checkOut, guests = 1, specialRequests = null,
  } = payload || {};

  if (!listingId || !checkIn || !checkOut)
    throw new HttpError(400, 'listingId, checkIn, checkOut required');
  if (checkOut <= checkIn)
    throw new HttpError(400, 'checkOut must be after checkIn');
  const checkinDate = new Date(checkIn + 'T00:00:00Z');
  if (checkinDate < new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z'))
    throw new HttpError(400, 'Cannot book past dates');

  // Price is computed server-side. Never trust the client.
  const pricing = await quote({ listingId, checkIn, checkOut, guests });

  // Load listing for integrity
  const { rows: lRows } = await query(
    `SELECT l.id, l.host_id, l.status, l.instant_book, l.cancellation_policy
     FROM listings l
     WHERE l.id = $1 AND l.deleted_at IS NULL`,
    [listingId]
  );
  const listing = lRows[0];
  if (!listing) throw new HttpError(404, 'Listing not found');
  if (listing.status !== 'active')
    throw new HttpError(400, 'Listing is not available for booking');
  if (listing.host_id === guest.id)
    throw new HttpError(400, 'You cannot book your own listing');

  const total = kobo(pricing.totalKobo);
  const expiresAt = new Date(Date.now() + config.bookings.paymentWindowMinutes * 60_000);

  return withTransaction(async (client) => {
    // Insert — exclusion constraint rejects double-bookings atomically
    let booking;
    try {
      const { rows } = await client.query(
        `INSERT INTO bookings
           (reference, listing_id, guest_id, host_id,
            check_in_date, check_out_date, nights,
            adults, children, infants, pets,
            nightly_rate_kobo, subtotal_kobo, cleaning_fee_kobo,
            security_deposit_kobo, service_fee_kobo, tax_kobo, discount_kobo,
            total_kobo, currency, status, cancellation_policy,
            special_requests, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
                 'pending_payment',$21,$22,$23)
         RETURNING *`,
        [
          makeBookingRef(), listingId, guest.id, listing.host_id,
          checkIn, checkOut, pricing.nights,
          Number(guests), 0, 0, 0,
          pricing.basePriceKobo, pricing.subtotalKobo,
          pricing.cleaningFeeKobo, pricing.securityDepositKobo,
          pricing.platformFeeKobo, 0, 0,
          total, 'NGN',
          listing.cancellation_policy,
          specialRequests,
          expiresAt,
        ]
      );
      booking = rows[0];
    } catch (err) {
      // 23P01 = exclusion_violation
      if (err.code === '23P01')
        throw new HttpError(409, 'Those dates are no longer available. Choose different dates.');
      throw err;
    }

    // Store the per-night breakdown (for disputes + transparency)
    for (const b of pricing.priceBreakdown) {
      await client.query(
        `INSERT INTO booking_nights (booking_id, date, price_kobo, is_override)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT DO NOTHING`,
        [booking.id, b.date, b.priceKobo, b.isOverride]
      ).catch(() => { /* table optional */ });
    }

    // Audit
    await client.query(
      `INSERT INTO audit_logs
         (actor_id, actor_role, action, entity_type, entity_id, after_state)
       VALUES ($1, 'guest', 'booking.create', 'booking', $2, $3)`,
      [guest.id, booking.id, JSON.stringify({ listingId, total, expiresAt })]
    );

    return {
      bookingId: booking.id,
      reference: booking.reference,
      status: booking.status,
      totalKobo: Number(booking.total_kobo),
      expiresAt: booking.expires_at,
      checkIn, checkOut, nights: pricing.nights,
      currency: booking.currency,
    };
  });
}

/* ============================================================
   LIST — guest's bookings
   ============================================================ */

export async function listGuestBookings({ guestId, status = 'all', page = 1, pageSize = 20 }) {
  const p = Math.max(1, Number(page));
  const ps = Math.min(50, Number(pageSize));
  const offset = (p - 1) * ps;

  const params = [guestId];
  let where = `WHERE b.guest_id = $1`;
  if (status !== 'all') {
    params.push(status);
    where += ` AND b.status = $${params.length}::booking_status`;
  }

  const { rows } = await query(
    `SELECT
       b.*,
       l.title AS listing_title,
       p.city, p.neighborhood, p.state,
       p.address_line1,
       (SELECT url FROM listing_media WHERE listing_id = l.id AND is_cover = TRUE LIMIT 1) AS cover_url,
       (SELECT url FROM listing_media WHERE listing_id = l.id AND is_cover = TRUE LIMIT 1) AS cover_thumb,
       e.status AS escrow_status,
       e.release_eligible_at
     FROM bookings b
     JOIN listings l ON l.id = b.listing_id
     JOIN properties p ON p.id = l.property_id
     LEFT JOIN escrow_holds e ON e.booking_id = b.id
     ${where}
     ORDER BY b.created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, ps, offset]
  );

  const countRes = await query(
    `SELECT COUNT(*)::int AS total FROM bookings b ${where}`,
    params
  );

  return {
    data: rows.map(toBookingSummary),
    pagination: { page: p, pageSize: ps, total: countRes.rows[0].total },
  };
}

export async function listHostBookings({ hostId, status = 'all', page = 1, pageSize = 20 }) {
  const p = Math.max(1, Number(page));
  const ps = Math.min(50, Number(pageSize));
  const offset = (p - 1) * ps;

  const params = [hostId];
  let where = `WHERE b.host_id = $1`;
  if (status !== 'all') {
    params.push(status);
    where += ` AND b.status = $${params.length}::booking_status`;
  }

  const { rows } = await query(
    `SELECT
       b.*,
       l.title AS listing_title,
       p.city, p.neighborhood, p.state,
       p.address_line1,
       u.first_name AS guest_first_name, u.last_name AS guest_last_name,
       u.phone AS guest_phone, u.is_phone_verified AS guest_phone_verified,
       (SELECT url FROM listing_media WHERE listing_id = l.id AND is_cover = TRUE LIMIT 1) AS cover_url,
       e.status AS escrow_status, e.release_eligible_at
     FROM bookings b
     JOIN listings l ON l.id = b.listing_id
     JOIN properties p ON p.id = l.property_id
     JOIN users u ON u.id = b.guest_id
     LEFT JOIN escrow_holds e ON e.booking_id = b.id
     ${where}
     ORDER BY b.check_in_date ASC, b.created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, ps, offset]
  );

  const countRes = await query(
    `SELECT COUNT(*)::int AS total FROM bookings b ${where}`,
    params
  );

  return {
    data: rows.map((r) => ({
      ...toBookingSummary(r),
      guest: {
        firstName: r.guest_first_name,
        lastName: r.guest_last_name,
        phone: r.guest_phone,
        phoneVerified: r.guest_phone_verified,
      },
    })),
    pagination: { page: p, pageSize: ps, total: countRes.rows[0].total },
  };
}

function toBookingSummary(r) {
  return {
    id: r.id,
    reference: r.reference,
    status: r.status,
    checkIn: r.check_in_date,
    checkOut: r.check_out_date,
    nights: r.nights,
    guests: r.adults,
    totalKobo: Number(r.total_kobo),
    currency: r.currency,
    cancellationPolicy: r.cancellation_policy,
    expiresAt: r.expires_at,
    checkedInAt: r.checked_in_at,
    guestConfirmedAt: r.guest_confirmed_at,
    hostConfirmedAt: r.host_confirmed_at,
    listing: {
      id: r.listing_id,
      title: r.listing_title,
      city: r.city,
      neighborhood: r.neighborhood,
      state: r.state,
      addressLine1: r.address_line1,
      coverUrl: r.cover_url,
    },
    escrow: {
      status: r.escrow_status,
      releaseEligibleAt: r.release_eligible_at,
    },
    createdAt: r.created_at,
  };
}

/* ============================================================
   DETAIL — full view for the booking page
   ============================================================ */

export async function getBookingDetail({ bookingId, userId, role }) {
  const { rows } = await query(
    `SELECT
       b.*,
       l.id AS listing_id, l.title AS listing_title, l.check_in_time, l.check_out_time,
       l.house_rules, l.cancellation_policy AS listing_cancellation_policy,
       p.address_line1, p.address_line2, p.city, p.neighborhood, p.state,
       ST_Y(p.location::geometry) AS lat, ST_X(p.location::geometry) AS lng,
       u.id AS guest_user_id, u.first_name AS guest_first_name,
       u.last_name AS guest_last_name, u.phone AS guest_phone,
       hu.id AS host_user_id, hu.first_name AS host_first_name,
       hu.last_name AS host_last_name, hu.phone AS host_phone,
       e.id AS escrow_id, e.status AS escrow_status, e.release_eligible_at,
       e.released_at, e.refunded_at,
       (SELECT url FROM listing_media WHERE listing_id = l.id AND is_cover = TRUE LIMIT 1) AS cover_url
     FROM bookings b
     JOIN listings l ON l.id = b.listing_id
     JOIN properties p ON p.id = l.property_id
     JOIN users u ON u.id = b.guest_id
     JOIN users hu ON hu.id = b.host_id
     LEFT JOIN escrow_holds e ON e.booking_id = b.id
     WHERE b.id = $1`,
    [bookingId]
  );
  const b = rows[0];
  if (!b) throw new HttpError(404, 'Booking not found');

  // Authorization
  const isGuest = b.guest_user_id === userId;
  const isHost = b.host_user_id === userId;
  const isAdmin = role === 'admin' || role === 'support';
  if (!isGuest && !isHost && !isAdmin)
    throw new HttpError(403, 'Not a party to this booking');

  // Reveal full address + check-in code only after payment
  const isConfirmed = ['confirmed', 'checked_in', 'completed'].includes(b.status);

  return {
    id: b.id,
    reference: b.reference,
    status: b.status,
    checkIn: b.check_in_date,
    checkOut: b.check_out_date,
    nights: b.nights,
    checkInTime: b.check_in_time,
    checkOutTime: b.check_out_time,
    adults: b.adults,
    totalKobo: Number(b.total_kobo),
    subtotalKobo: Number(b.subtotal_kobo),
    cleaningFeeKobo: Number(b.cleaning_fee_kobo),
    securityDepositKobo: Number(b.security_deposit_kobo),
    platformFeeKobo: Number(b.service_fee_kobo),
    currency: b.currency,
    cancellationPolicy: b.cancellation_policy,
    houseRules: b.house_rules,
    specialRequests: b.special_requests,
    expiresAt: b.expires_at,
    checkedInAt: b.checked_in_at,
    guestConfirmedAt: b.guest_confirmed_at,
    hostConfirmedAt: b.host_confirmed_at,
    cancelledAt: b.cancelled_at,
    cancellationReason: b.cancellation_reason,
    refundAmountKobo: Number(b.refund_amount_kobo || 0),

    // Sensitive fields — gated on confirmation
    checkInCode: isConfirmed && isGuest ? b.check_in_code : null,
    checkInInstructions: isConfirmed ? b.check_in_instructions : null,
    address: {
      line1: isConfirmed ? b.address_line1 : null,
      line2: isConfirmed ? b.address_line2 : null,
      city: b.city,
      neighborhood: b.neighborhood,
      state: b.state,
      lat: b.lat != null ? Number(b.lat) : null,
      lng: b.lng != null ? Number(b.lng) : null,
    },

    listing: {
      id: b.listing_id,
      title: b.listing_title,
      coverUrl: b.cover_url,
    },
    guest: isHost || isAdmin ? {
      id: b.guest_user_id,
      firstName: b.guest_first_name,
      lastName: b.guest_last_name,
      phone: b.guest_phone,
    } : null,
    host: isGuest || isAdmin ? {
      id: b.host_user_id,
      firstName: b.host_first_name,
      lastName: b.host_last_name,
      phone: b.host_phone,
    } : null,
    escrow: b.escrow_id ? {
      status: b.escrow_status,
      releaseEligibleAt: b.release_eligible_at,
      releasedAt: b.released_at,
      refundedAt: b.refunded_at,
    } : null,
    viewerRole: isGuest ? 'guest' : isHost ? 'host' : 'admin',
  };
}

/* ============================================================
   CANCEL — policy-aware refund
   ============================================================ */

export async function cancelBooking({ bookingId, userId, reason = null, asHost = false }) {
  const result = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT b.*, e.id AS escrow_id, e.status AS escrow_status,
              e.amount_kobo AS escrow_amount,
              e.paystack_reference
       FROM bookings b
       LEFT JOIN escrow_holds e ON e.booking_id = b.id
       WHERE b.id = $1
       FOR UPDATE`,
      [bookingId]
    );
    const b = rows[0];
    if (!b) throw new HttpError(404, 'Booking not found');

    if (!asHost && b.guest_id !== userId)
      throw new HttpError(403, 'Not your booking');
    if (asHost && b.host_id !== userId)
      throw new HttpError(403, 'Not your listing');

    if (!['pending_payment', 'confirmed'].includes(b.status))
      throw new HttpError(409, `Cannot cancel a booking in status "${b.status}"`);

    // Refund computation
    let refundPct = 0;
    const policy = config.bookings.cancellationPolicies[b.cancellation_policy] || { refundBeforeHours: 24, refundPct: 100 };
    const hoursUntilCheckin = (new Date(b.check_in_date + 'T00:00:00Z').getTime() - Date.now()) / 3600_000;

    if (asHost) {
      // Host cancelling: guest gets 100% refund regardless of policy
      refundPct = 100;
    } else if (b.status === 'pending_payment') {
      // No payment yet — nothing to refund
      refundPct = 0;
    } else if (hoursUntilCheckin >= policy.refundBeforeHours) {
      refundPct = policy.refundPct;
    } else {
      refundPct = 0;
    }

    const refundAmountKobo = b.escrow_amount
      ? Math.round(Number(b.escrow_amount) * refundPct / 100)
      : 0;

    const newStatus = asHost ? 'cancelled_by_host' : 'cancelled_by_guest';

    await client.query(
      `UPDATE bookings
       SET status = $1, cancelled_at = NOW(), cancelled_by = $2,
           cancellation_reason = $3, refund_amount_kobo = $4,
           updated_at = NOW()
       WHERE id = $5`,
      [newStatus, userId, reason || (asHost ? 'Cancelled by host' : 'Cancelled by guest'),
       refundAmountKobo, bookingId]
    );

    // Update escrow
    if (b.escrow_id && b.escrow_status === 'holding') {
      if (refundPct === 100) {
        await client.query(
          `UPDATE escrow_holds SET status = 'refunded', refunded_at = NOW(),
             refunded_amount_kobo = amount_kobo, updated_at = NOW()
           WHERE id = $1`,
          [b.escrow_id]
        );
      } else if (refundPct > 0) {
        await client.query(
          `UPDATE escrow_holds SET status = 'partially_released',
             refunded_at = NOW(), refunded_amount_kobo = $1, updated_at = NOW()
           WHERE id = $2`,
          [refundAmountKobo, b.escrow_id]
        );
      } else {
        // No refund — host keeps it (harsh but per policy)
        await client.query(
          `UPDATE escrow_holds SET status = 'released',
             released_at = NOW(), released_amount_kobo = amount_kobo,
             updated_at = NOW()
           WHERE id = $1`,
          [b.escrow_id]
        );
      }
    }

    // Audit
    await client.query(
      `INSERT INTO audit_logs
         (actor_id, actor_role, action, entity_type, entity_id, after_state)
       VALUES ($1, $2, 'booking.cancel', 'booking', $3, $4)`,
      [userId, asHost ? 'host' : 'guest', bookingId,
       JSON.stringify({ refundPct, refundAmountKobo, reason })]
    );

    return {
      bookingId,
      status: newStatus,
      refundPct,
      refundAmountKobo,
      hadPayment: Boolean(b.escrow_id && b.escrow_status === 'holding'),
      paystackReference: b.paystack_reference || null,
    };
  });

  // Kick off the Paystack refund outside the DB transaction
  if (result.refundAmountKobo > 0 && result.paystackReference) {
    try {
      const { initiateRefund } = await import('./paystack.service.js');
      await initiateRefund({
        transactionReference: result.paystackReference,
        amountKobo: result.refundAmountKobo,
        reason: result.status === 'cancelled_by_host' ? 'Host cancelled' : 'Guest cancelled',
      });
    } catch (err) {
      console.error('[booking] refund initiation failed:', err.message);
      // Refund can be retried from the admin dashboard
    }
  }

  return result;
}