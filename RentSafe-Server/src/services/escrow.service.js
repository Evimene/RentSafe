import crypto from 'node:crypto';
import { query, withTransaction } from '../db.js';
import * as paystack from './paystack.service.js';
import { HttpError } from '../middleware/error.js';

const PLATFORM_FEE_PERCENT = 15; // 15% — your commission
const RELEASE_DELAY_HOURS = 24;  // hold 24h after check-in before payout

/* ============================================================
   CHARGE — Guest pays, escrow row created
   ============================================================ */

export async function initializeBookingCharge({ bookingId, guest }) {
  // 1. Load the booking
  const { rows: bRows } = await query(
    `SELECT b.*, l.title AS listing_title
     FROM bookings b
     JOIN listings l ON l.id = b.listing_id
     WHERE b.id = $1 AND b.guest_id = $2`,
    [bookingId, guest.id]
  );
  const booking = bRows[0];
  if (!booking) throw new HttpError(404, 'Booking not found');
  if (booking.status !== 'pending_payment')
    throw new HttpError(400, 'Booking is not awaiting payment');

  // 2. Idempotency: if escrow already exists, return the existing auth URL
  const { rows: existing } = await query(
    `SELECT * FROM escrow_holds WHERE booking_id = $1`,
    [bookingId]
  );
  if (existing[0]) {
    const ref = existing[0].paystack_reference;
    const verified = await paystack.verifyCharge(ref).catch(() => null);
    if (verified?.status === 'success') {
      return { alreadyPaid: true, reference: ref };
    }
  }

  // 3. Generate a unique reference
  const reference = `RS-BK-${bookingId.slice(0, 8)}-${Date.now()}`;

  // 4. Ensure Paystack customer exists for the guest
  const customerCode = await ensurePaystackCustomer(guest);

  // 5. Initialize the charge
  const init = await paystack.initializeCharge({
    email: guest.email || `${guest.phone}@placeholder.local`,
    amountKobo: Number(booking.total_kobo),
    reference,
    callbackUrl: `${process.env.APP_BASE_URL || 'http://localhost:4000'}/payment/callback`,
    metadata: {
      booking_id: bookingId,
      guest_id: guest.id,
      host_id: booking.host_id,
      listing_title: booking.listing_title,
      customer_code: customerCode,
    },
    channels: ['card', 'bank', 'ussd', 'bank_transfer'],
  });

  // 6. Create the escrow_hold row in `holding` state
  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO escrow_holds
         (booking_id, guest_id, host_id, amount_kobo, status, paystack_reference)
       VALUES ($1, $2, $3, $4, 'holding', $5)
       ON CONFLICT (booking_id) DO UPDATE
         SET paystack_reference = EXCLUDED.paystack_reference`,
      [bookingId, guest.id, booking.host_id, booking.total_kobo, reference]
    );

    await client.query(
      `INSERT INTO transactions
         (user_id, booking_id, transaction_type, direction, amount_kobo, reference, description)
       VALUES ($1, $2, 'charge', 'credit', $3, $4, 'Guest charge initiated')`,
      [guest.id, bookingId, booking.total_kobo, reference]
    );
  });

  return {
    authorizationUrl: init.authorization_url,
    accessCode: init.access_code,
    reference: init.reference,
  };
}

async function ensurePaystackCustomer(user) {
  const { rows } = await query(
    `SELECT customer_code FROM paystack_customers WHERE user_id = $1`,
    [user.id]
  );
  if (rows[0]?.customer_code) return rows[0].customer_code;

  const created = await paystack.createCustomer({
    email: user.email || `${user.phone}@placeholder.local`,
    firstName: user.first_name,
    lastName: user.last_name,
    phone: user.phone,
  });

  await query(
    `INSERT INTO paystack_customers (user_id, customer_code, email, paystack_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id) DO NOTHING`,
    [user.id, created.customer_code, created.email, created.id || null]
  );

  return created.customer_code;
}

/* ============================================================
   CHARGE CONFIRMED (from webhook or callback verify)
   ============================================================ */

export async function markChargeSuccessful({ reference, paystackData }) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM escrow_holds WHERE paystack_reference = $1 FOR UPDATE`,
      [reference]
    );
    const escrow = rows[0];
    if (!escrow) throw new HttpError(404, 'Escrow hold not found for reference');
    if (escrow.status !== 'holding')
      return { alreadyProcessed: true, escrow };

    // Confirm booking
    await client.query(
      `UPDATE bookings
       SET status = 'confirmed',
           check_in_code = $1,
           updated_at = NOW()
       WHERE id = $2 AND status = 'pending_payment'`,
      [generateCheckInCode(), escrow.booking_id]
    );

    // Compute release eligibility: check_in_date + RELEASE_DELAY_HOURS
    const { rows: bk } = await client.query(
      `SELECT check_in_date, check_out_date FROM bookings WHERE id = $1`,
      [escrow.booking_id]
    );
    const releaseEligibleAt = new Date(bk[0].check_in_date);
    releaseEligibleAt.setHours(releaseEligibleAt.getHours() + RELEASE_DELAY_HOURS);

    await client.query(
      `UPDATE escrow_holds
       SET charge_success_at = NOW(),
           release_eligible_at = $1,
           updated_at = NOW()
       WHERE id = $2`,
      [releaseEligibleAt, escrow.id]
    );

    await client.query(
      `INSERT INTO transactions
         (user_id, booking_id, escrow_hold_id, transaction_type, direction, amount_kobo, reference, description)
       VALUES ($1, $2, $3, 'escrow_hold', 'credit', $4, $5, 'Funds held in escrow')`,
      [escrow.guest_id, escrow.booking_id, escrow.id, escrow.amount_kobo, reference]
    );

    return { success: true, escrow: { ...escrow, status: 'holding' } };
  });
}

function generateCheckInCode() {
  return String(crypto.randomInt(100000, 999999));
}

/* ============================================================
   CHECK-IN CONFIRMATION
   ============================================================ */

export async function confirmCheckIn({ bookingId, userId, code, role }) {
  if (!['guest', 'host'].includes(role))
    throw new HttpError(403, 'Only guest or host can confirm check-in');

  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT b.*, e.id AS escrow_id, e.status AS escrow_status,
              e.release_eligible_at, e.amount_kobo
       FROM bookings b
       JOIN escrow_holds e ON e.booking_id = b.id
       WHERE b.id = $1
       FOR UPDATE`,
      [bookingId]
    );
    const booking = rows[0];
    if (!booking) throw new HttpError(404, 'Booking not found');
    if (booking.status !== 'confirmed')
      throw new HttpError(400, `Cannot confirm check-in: booking is ${booking.status}`);

    const isGuest = booking.guest_id === userId;
    const isHost  = booking.host_id === userId;
    if (!isGuest && !isHost) throw new HttpError(403, 'Not a party to this booking');

    // Guest must supply the code (proves they were given the check-in instructions)
    if (role === 'guest' && code) {
      const ok = String(code) === String(booking.check_in_code);
      if (!ok) throw new HttpError(400, 'Invalid check-in code');
    }

    const now = new Date();
    const patch = {};
    if (isGuest && !booking.guest_confirmed_at) patch.guest_confirmed_at = now;
    if (isHost  && !booking.host_confirmed_at)  patch.host_confirmed_at  = now;

    // Both sides must confirm OR the guest confirms (host silence = acceptance
    // after RELEASE_DELAY_HOURS; the release job handles that case)
    const bothConfirmed =
      (booking.guest_confirmed_at || isGuest) &&
      (booking.host_confirmed_at  || isHost);

    await client.query(
      `UPDATE bookings
       SET guest_confirmed_at = COALESCE(guest_confirmed_at, $1),
           host_confirmed_at  = COALESCE(host_confirmed_at,  $2),
           checked_in_at      = COALESCE(checked_in_at,      $3),
           status = CASE WHEN $4::boolean THEN 'checked_in' ELSE status END,
           updated_at = NOW()
       WHERE id = $5`,
      [
        isGuest ? now : null,
        isHost  ? now : null,
        now,
        bothConfirmed,
        bookingId,
      ]
    );

    return {
      bookingId,
      guestConfirmed: Boolean(booking.guest_confirmed_at || isGuest),
      hostConfirmed: Boolean(booking.host_confirmed_at  || isHost),
      bothConfirmed,
      releaseEligibleAt: booking.release_eligible_at,
    };
  });
}

/* ============================================================
   RELEASE — Called by scheduler or admin
   ============================================================ */

export async function releaseEscrow(escrowHoldId, { force = false, actorId = null } = {}) {
  const escrow = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT e.*, b.status AS booking_status
       FROM escrow_holds e
       JOIN bookings b ON b.id = e.booking_id
       WHERE e.id = $1
       FOR UPDATE`,
      [escrowHoldId]
    );
    const e = rows[0];
    if (!e) throw new HttpError(404, 'Escrow hold not found');
    if (e.status !== 'holding')
      throw new HttpError(400, `Escrow is ${e.status}, cannot release`);

    const due = e.release_eligible_at && new Date(e.release_eligible_at) <= new Date();
    if (!due && !force)
      throw new HttpError(400, 'Escrow is not yet eligible for release');

    // Compute platform fee and host payout
    const gross = Number(e.amount_kobo);
    const fee   = Math.round(gross * (PLATFORM_FEE_PERCENT / 100));
    const net   = gross - fee;

    // Mark as released
    await client.query(
      `UPDATE escrow_holds
       SET status = 'released',
           released_at = NOW(),
           released_amount_kobo = $1,
           platform_fee_kobo = $2,
           updated_at = NOW()
       WHERE id = $3`,
      [net, fee, escrowHoldId]
    );

    // Booking → completed
    await client.query(
      `UPDATE bookings SET status = 'completed', updated_at = NOW()
       WHERE id = $1 AND status IN ('checked_in', 'confirmed')`,
      [e.booking_id]
    );

    await client.query(
      `INSERT INTO transactions
         (user_id, booking_id, escrow_hold_id, transaction_type, direction, amount_kobo, description)
       VALUES ($1, $2, $3, 'escrow_release', 'debit', $4, 'Escrow released to host')`,
      [e.host_id, e.booking_id, e.id, net]
    );

    await client.query(
      `INSERT INTO transactions
         (booking_id, escrow_hold_id, transaction_type, direction, amount_kobo, description)
       VALUES ($1, $2, 'platform_fee', 'credit', $3, 'Platform commission')`,
      [e.booking_id, e.id, fee]
    );

    return { ...e, host_payout_kobo: net, platform_fee_kobo: fee };
  });

  // Outside the DB transaction — initiate the Paystack transfer
  const payout = await initiateHostPayout({
    escrowHoldId: escrow.id,
    hostId: escrow.host_id,
    bookingId: escrow.booking_id,
    amountKobo: escrow.host_payout_kobo,
  });

  return { escrow, payout };
}

/* ============================================================
   PAYOUT — Paystack Transfer to host
   ============================================================ */

async function initiateHostPayout({ escrowHoldId, hostId, bookingId, amountKobo }) {
  // Get host's default recipient
  const { rows } = await query(
    `SELECT * FROM transfer_recipients
     WHERE user_id = $1 AND is_active = TRUE
     ORDER BY created_at DESC LIMIT 1`,
    [hostId]
  );
  const recipient = rows[0];
  if (!recipient) throw new HttpError(400, 'Host has no payout account on file');

  // Idempotency: reuse an existing pending payout for this escrow
  const { rows: existing } = await query(
    `SELECT * FROM payouts WHERE escrow_hold_id = $1 AND status IN ('pending','processing','success')`,
    [escrowHoldId]
  );
  if (existing[0]) return existing[0];

  const transferReference = `RS-PO-${bookingId.slice(0, 8)}-${Date.now()}`;

  // Insert payout row BEFORE calling Paystack (so webhook can find it)
  const { rows: pRows } = await query(
    `INSERT INTO payouts
       (escrow_hold_id, booking_id, host_id, recipient_id,
        amount_kobo, status, transfer_reference, initiated_at)
     VALUES ($1, $2, $3, $4, $5, 'processing', $6, NOW())
     RETURNING *`,
    [escrowHoldId, bookingId, hostId, recipient.id, amountKobo, transferReference]
  );
  const payout = pRows[0];

  try {
    const transfer = await paystack.initiateTransfer({
      amountKobo,
      recipientCode: recipient.recipient_code,
      reason: `RentSafe payout for booking ${bookingId}`,
      reference: transferReference,
    });

    await query(
      `UPDATE payouts
       SET paystack_transfer_code = $1, paystack_transfer_id = $2, updated_at = NOW()
       WHERE id = $3`,
      [transfer.transfer_code, transfer.id, payout.id]
    );

    return { ...payout, paystack_transfer_code: transfer.transfer_code };
  } catch (err) {
    await query(
      `UPDATE payouts
       SET status = 'failed', failure_reason = $1, updated_at = NOW()
       WHERE id = $2`,
      [err.message, payout.id]
    );
    throw err;
  }
}

/* ============================================================
   REFUND (dispute or host cancel)
   ============================================================ */

export async function refundEscrow(escrowHoldId, { reason, actorId } = {}) {
  const { rows } = await query(
    `SELECT e.*, b.status AS booking_status
     FROM escrow_holds e JOIN bookings b ON b.id = e.booking_id
     WHERE e.id = $1`,
    [escrowHoldId]
  );
  const escrow = rows[0];
  if (!escrow) throw new HttpError(404, 'Escrow not found');
  if (escrow.status !== 'holding')
    throw new HttpError(400, `Cannot refund: escrow is ${escrow.status}`);

  const refund = await paystack.initiateRefund({
    transactionReference: escrow.paystack_reference,
    reason: reason || 'Booking cancelled',
  });

  await withTransaction(async (client) => {
    await client.query(
      `UPDATE escrow_holds
       SET status = 'refunded', refunded_at = NOW(),
           refunded_amount_kobo = $1, updated_at = NOW()
       WHERE id = $2`,
      [escrow.amount_kobo, escrowHoldId]
    );

    await client.query(
      `UPDATE bookings SET status = 'cancelled_by_host', cancelled_at = NOW()
       WHERE id = $1`,
      [escrow.booking_id]
    );

    await client.query(
      `INSERT INTO transactions
         (user_id, booking_id, escrow_hold_id, transaction_type, direction, amount_kobo, description)
       VALUES ($1, $2, $3, 'refund', 'debit', $4, $5)`,
      [escrow.guest_id, escrow.booking_id, escrow.id, escrow.amount_kobo, reason || 'Refund']
    );
  });

  return refund;
}