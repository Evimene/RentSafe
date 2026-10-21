import { query, withTransaction } from '../db.js';
import { HttpError } from '../middleware/error.js';
import * as paystack from './paystack.service.js';
import { config } from '../config.js';

/* ============================================================
   INITIATE CHARGE — guest pays a pending_payment booking
   ============================================================ */

export async function initiateCharge({ bookingId, guest }) {
  // Load + validate
  const { rows } = await query(
    `SELECT b.*, e.id AS escrow_id, e.paystack_reference AS existing_ref,
            e.charge_success_at
     FROM bookings b
     LEFT JOIN escrow_holds e ON e.booking_id = b.id
     WHERE b.id = $1`,
    [bookingId]
  );
  const b = rows[0];
  if (!b) throw new HttpError(404, 'Booking not found');
  if (b.guest_id !== guest.id) throw new HttpError(403, 'Not your booking');
  if (b.status !== 'pending_payment')
    throw new HttpError(409, `Booking is ${b.status}, cannot charge`);

  if (new Date(b.expires_at) < new Date())
    throw new HttpError(410, 'Payment window expired. Please create a new booking.');

  // Already paid? (webhook may have landed but user retried)
  if (b.charge_success_at) {
    return { alreadyPaid: true, bookingId, status: 'confirmed' };
  }

  // Reuse an existing pending reference if it's still valid
  if (b.existing_ref) {
    try {
      const verified = await paystack.verifyCharge(b.existing_ref);
      if (verified.status === 'success') {
        return { alreadyPaid: true, reference: b.existing_ref };
      }
      if (verified.status === 'pending' || verified.status === 'ongoing') {
        return {
          authorizationUrl: verified.authorization_url || null,
          reference: b.existing_ref,
          resumed: true,
        };
      }
    } catch {
      // fall through — create new reference
    }
  }

  // Fresh reference
  const reference = `RS-BK-${bookingId.slice(0, 8)}-${Date.now()}`;

  // Ensure customer record exists (for Paystack dashboard visibility)
  let customerCode = null;
  const { rows: pc } = await query(
    `SELECT customer_code FROM paystack_customers WHERE user_id = $1`,
    [guest.id]
  );
  if (pc[0]?.customer_code) {
    customerCode = pc[0].customer_code;
  } else {
    try {
      const created = await paystack.createCustomer({
        email: guest.email || `${guest.phone}@placeholder.local`,
        firstName: guest.first_name,
        lastName: guest.last_name,
        phone: guest.phone,
      });
      customerCode = created.customer_code;
      await query(
        `INSERT INTO paystack_customers (user_id, customer_code, email, paystack_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id) DO NOTHING`,
        [guest.id, customerCode, created.email, created.id || null]
      );
    } catch (err) {
      console.warn('[charge] customer create failed:', err.message);
    }
  }

  // Initialize with Paystack
  const init = await paystack.initializeCharge({
    email: guest.email || `${guest.phone}@placeholder.local`,
    amountKobo: Number(b.total_kobo),
    reference,
    callbackUrl: `${process.env.APP_BASE_URL || 'http://localhost:4000'}/payment/callback`,
    metadata: {
      booking_id: bookingId,
      booking_reference: b.reference,
      guest_id: guest.id,
      host_id: b.host_id,
      listing_id: b.listing_id,
      customer_code: customerCode,
    },
    channels: ['card', 'bank', 'ussd', 'bank_transfer'],
  });

  // Create escrow hold (upsert on booking_id)
  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO escrow_holds
         (booking_id, guest_id, host_id, amount_kobo, status, paystack_reference)
       VALUES ($1, $2, $3, $4, 'holding', $5)
       ON CONFLICT (booking_id) DO UPDATE
         SET paystack_reference = EXCLUDED.paystack_reference,
             updated_at = NOW()
         WHERE escrow_holds.status = 'holding'`,
      [bookingId, guest.id, b.host_id, b.total_kobo, reference]
    );

    await client.query(
      `INSERT INTO transactions
         (user_id, booking_id, transaction_type, direction, amount_kobo, reference, description)
       VALUES ($1, $2, 'charge', 'credit', $3, $4, 'Guest charge initiated')`,
      [guest.id, bookingId, b.total_kobo, reference]
    );

    await client.query(
      `INSERT INTO audit_logs
         (actor_id, actor_role, action, entity_type, entity_id, after_state)
       VALUES ($1, 'guest', 'booking.charge.initiate', 'booking', $2, $3)`,
      [guest.id, bookingId, JSON.stringify({ reference, amount: Number(b.total_kobo) })]
    );
  });

  return {
    authorizationUrl: init.authorization_url,
    accessCode: init.access_code,
    reference: init.reference,
    amountKobo: Number(b.total_kobo),
    bookingReference: b.reference,
  };
}

/* ============================================================
   CONFIRM — called by webhook + callback after Paystack
   ============================================================ */

export async function confirmBookingCharge({ reference, verifiedData }) {
  // Load escrow by reference
  const { rows } = await query(
    `SELECT e.*, b.status AS booking_status, b.check_in_date, b.check_out_date,
            b.total_kobo, b.cancellation_policy
     FROM escrow_holds e
     JOIN bookings b ON b.id = e.booking_id
     WHERE e.paystack_reference = $1`,
    [reference]
  );
  const escrow = rows[0];
  if (!escrow) throw new HttpError(404, 'Escrow hold not found for reference');

  // Idempotency — already confirmed
  if (escrow.charge_success_at) {
    return { alreadyConfirmed: true, bookingId: escrow.booking_id };
  }

  // Amount integrity — MUST match
  const paid = Number(verifiedData.amount);
  const expected = Number(escrow.amount_kobo);
  if (paid !== expected) {
    // Log mismatch, do not confirm
    await query(
      `INSERT INTO audit_logs
         (actor_id, actor_role, action, entity_type, entity_id, notes, after_state)
       VALUES (NULL, NULL, 'booking.charge.amount_mismatch', 'escrow_hold', $1, $2, $3)`,
      [escrow.id, `paid ${paid} vs expected ${expected}`,
       JSON.stringify({ reference, verifiedData })]
    );
    throw new HttpError(400,
      `Amount mismatch: paid ₦${(paid / 100).toLocaleString()}, expected ₦${(expected / 100).toLocaleString()}`);
  }

  // Confirm in one transaction
  const result = await withTransaction(async (client) => {
    const { rows: lockRows } = await client.query(
      `SELECT e.*, b.status AS booking_status
       FROM escrow_holds e
       JOIN bookings b ON b.id = e.booking_id
       WHERE e.id = $1 FOR UPDATE`,
      [escrow.id]
    );
    const e = lockRows[0];
    if (e.status !== 'holding' || e.charge_success_at) {
      return { alreadyConfirmed: true, bookingId: e.booking_id };
    }

    // Compute release eligibility = check-in + N hours
    const releaseEligible = new Date(e.check_in_date + 'T00:00:00Z');
    releaseEligible.setUTCHours(releaseEligible.getUTCHours() + config.bookings.releaseDelayHours);

    // Generate check-in code
    const checkInCode = String(Math.floor(100000 + Math.random() * 900000));

    // Confirm booking
    await client.query(
      `UPDATE bookings
       SET status = 'confirmed',
           check_in_code = $1,
           updated_at = NOW()
       WHERE id = $2 AND status = 'pending_payment'`,
      [checkInCode, e.booking_id]
    );

    // Confirm escrow
    await client.query(
      `UPDATE escrow_holds
       SET charge_success_at = NOW(),
           release_eligible_at = $1,
           updated_at = NOW()
       WHERE id = $2`,
      [releaseEligible, e.id]
    );

    // Ledger
    await client.query(
      `INSERT INTO transactions
         (user_id, booking_id, escrow_hold_id, transaction_type, direction, amount_kobo, reference, description)
       VALUES ($1, $2, $3, 'escrow_hold', 'credit', $4, $5, 'Funds held in escrow')`,
      [e.guest_id, e.booking_id, e.id, e.amount_kobo, reference]
    );

    // Audit
    await client.query(
      `INSERT INTO audit_logs
         (actor_id, actor_role, action, entity_type, entity_id, after_state)
       VALUES (NULL, NULL, 'booking.confirm', 'booking', $1, $2)`,
      [e.booking_id, JSON.stringify({
        reference, amount: Number(e.amount_kobo), releaseEligibleAt: releaseEligible,
      })]
    );

    return {
      bookingId: e.booking_id,
      status: 'confirmed',
      checkInCode,
      releaseEligibleAt: releaseEligible,
    };
  });

  return result;
}