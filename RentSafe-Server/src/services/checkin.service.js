import { query, withTransaction } from '../db.js';
import { HttpError } from '../middleware/error.js';

const MAX_ATTEMPTS_PER_HOUR = 5;

export async function confirmCheckIn({ bookingId, userId, role, code, ip, req }) {
  const { rows } = await query(
    `SELECT b.*, e.id AS escrow_id, e.status AS escrow_status,
            e.release_eligible_at, e.amount_kobo
     FROM bookings b
     LEFT JOIN escrow_holds e ON e.booking_id = b.id
     WHERE b.id = $1`,
    [bookingId]
  );
  const b = rows[0];
  if (!b) throw new HttpError(404, 'Booking not found');

  const isGuest = b.guest_id === userId;
  const isHost = b.host_id === userId;
  if (!isGuest && !isHost) throw new HttpError(403, 'Not a party to this booking');

  if (b.status !== 'confirmed')
    throw new HttpError(400, `Cannot check in a booking in status "${b.status}"`);

  // Brute-force guard: max attempts per hour
  const { rows: attempts } = await query(
    `SELECT COUNT(*)::int AS n FROM checkin_attempts
     WHERE booking_id = $1 AND created_at > NOW() - INTERVAL '1 hour'`,
    [bookingId]
  );
  if (attempts[0].n >= MAX_ATTEMPTS_PER_HOUR)
    throw new HttpError(429, 'Too many attempts. Try again in an hour.');

  // Host must supply the code (they're verifying the guest arrived)
  // Guest may self-confirm without a code only from 2 hours after check-in time
  let codeValid = false;
  const checkInStart = new Date(b.check_in_date + 'T00:00:00Z').getTime();
  const now = Date.now();
  const hoursSinceCheckin = (now - checkInStart) / 3600_000;

  if (isHost) {
    if (!code) throw new HttpError(400, 'Code required from host');
    codeValid = String(code) === String(b.check_in_code);
  } else {
    // Guest: can confirm with code, or self-confirm after 2h past check-in date
    if (code) {
      codeValid = String(code) === String(b.check_in_code);
    } else if (hoursSinceCheckin >= 2 && !b.guest_confirmed_at) {
      codeValid = true; // self-check-in grace
    } else {
      throw new HttpError(400, 'Enter the check-in code or wait until 2 hours after check-in time');
    }
  }

  // Record the attempt
  await query(
    `INSERT INTO checkin_attempts (booking_id, attempted_by, success, ip_address)
     VALUES ($1, $2, $3, $4)`,
    [bookingId, userId, codeValid, ip || null]
  );

  if (!codeValid) throw new HttpError(400, 'Invalid check-in code');

  // Update booking
  const result = await withTransaction(async (client) => {
    const { rows: locked } = await client.query(
      `SELECT * FROM bookings WHERE id = $1 FOR UPDATE`,
      [bookingId]
    );
    const l = locked[0];

    const now = new Date();
    const patch = {};
    if (isGuest && !l.guest_confirmed_at) patch.guest_confirmed_at = now;
    if (isHost && !l.host_confirmed_at) patch.host_confirmed_at = now;

    const bothConfirmed =
      (l.guest_confirmed_at || isGuest) && (l.host_confirmed_at || isHost);

    await client.query(
      `UPDATE bookings
       SET guest_confirmed_at = COALESCE(guest_confirmed_at, $1),
           host_confirmed_at = COALESCE(host_confirmed_at, $2),
           checked_in_at = COALESCE(checked_in_at, $3),
           status = CASE WHEN $4::boolean THEN 'checked_in' ELSE status END,
           updated_at = NOW()
       WHERE id = $5`,
      [
        isGuest ? now : null,
        isHost ? now : null,
        now,
        bothConfirmed,
        bookingId,
      ]
    );

    await client.query(
      `INSERT INTO audit_logs
         (actor_id, actor_role, action, entity_type, entity_id, after_state)
       VALUES ($1, $2, 'booking.checkin', 'booking', $3, $4)`,
      [userId, role, bookingId,
       JSON.stringify({ isGuest, isHost, bothConfirmed })]
    );

    return {
      bookingId,
      guestConfirmed: Boolean(l.guest_confirmed_at || isGuest),
      hostConfirmed: Boolean(l.host_confirmed_at || isHost),
      bothConfirmed,
      status: bothConfirmed ? 'checked_in' : 'confirmed',
      releaseEligibleAt: b.release_eligible_at,
    };
  });

  return result;
}

/* ============================================================
   STATUS — for the guest's booking page
   ============================================================ */

export async function getCheckInStatus({ bookingId, userId }) {
  const { rows } = await query(
    `SELECT b.check_in_code, b.status, b.check_in_date,
            b.guest_confirmed_at, b.host_confirmed_at, b.checked_in_at,
            b.guest_id, b.host_id, e.release_eligible_at
     FROM bookings b
     LEFT JOIN escrow_holds e ON e.booking_id = b.id
     WHERE b.id = $1`,
    [bookingId]
  );
  const b = rows[0];
  if (!b) throw new HttpError(404, 'Booking not found');

  const isGuest = b.guest_id === userId;
  const isHost = b.host_id === userId;
  if (!isGuest && !isHost) throw new HttpError(403, 'Forbidden');

  return {
    status: b.status,
    checkInDate: b.check_in_date,
    checkInCode: isGuest ? b.check_in_code : null,
    guestConfirmed: Boolean(b.guest_confirmed_at),
    hostConfirmed: Boolean(b.host_confirmed_at),
    checkedInAt: b.checked_in_at,
    releaseEligibleAt: b.release_eligible_at,
    canSelfCheckIn: isGuest && !b.guest_confirmed_at
      && Date.now() - new Date(b.check_in_date + 'T00:00:00Z').getTime() >= 2 * 3600_000,
  };
}