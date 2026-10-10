import { query } from '../db.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { HttpError } from '../middleware/error.js';
import * as escrow from '../services/escrow.service.js';
import * as paystack from '../services/paystack.service.js';

/* ---------- Guest: start a charge for a booking ---------- */
export const startCharge = asyncHandler(async (req, res) => {
  const { bookingId } = req.params;
  const result = await escrow.initializeBookingCharge({
    bookingId,
    guest: req.user,
  });
  res.json(result);
});

/* ---------- Guest: confirm payment (callback from Paystack) ---------- */
export const confirmPayment = asyncHandler(async (req, res) => {
  const { reference } = req.query;
  if (!reference) throw new HttpError(400, 'reference required');

  const verified = await paystack.verifyCharge(reference);
  if (verified.status !== 'success')
    throw new HttpError(400, 'Payment not successful');

  await escrow.markChargeSuccessful({ reference, paystackData: verified });
  res.json({ status: 'confirmed' });
});

/* ---------- Guest or Host: confirm check-in ---------- */
export const checkIn = asyncHandler(async (req, res) => {
  const { bookingId } = req.params;
  const { code } = req.body || {};
  const role = req.body.role || (req.user.id === req.user.id ? 'guest' : 'guest');
  // Better: infer role from booking
  const { rows } = await query(
    `SELECT guest_id, host_id FROM bookings WHERE id = $1`,
    [bookingId]
  );
  if (!rows[0]) throw new HttpError(404, 'Booking not found');
  const inferred = rows[0].guest_id === req.user.id ? 'guest'
                 : rows[0].host_id  === req.user.id ? 'host'
                 : null;
  if (!inferred) throw new HttpError(403, 'Not a party to this booking');

  const result = await escrow.confirmCheckIn({
    bookingId,
    userId: req.user.id,
    code,
    role: inferred,
  });
  res.json(result);
});

/* ---------- Admin/ops: force release ---------- */
export const release = asyncHandler(async (req, res) => {
  const { escrowId } = req.params;
  const result = await escrow.releaseEscrow(escrowId, {
    force: true,
    actorId: req.user.id,
  });
  res.json(result);
});

/* ---------- Admin/ops: refund ---------- */
export const refund = asyncHandler(async (req, res) => {
  const { escrowId } = req.params;
  const { reason } = req.body || {};
  const result = await escrow.refundEscrow(escrowId, {
    reason,
    actorId: req.user.id,
  });
  res.json(result);
});

/* ---------- Host: add payout account ---------- */
export const addPayoutAccount = asyncHandler(async (req, res) => {
  const { accountNumber, bankCode } = req.body || {};
  if (!accountNumber || !bankCode)
    throw new HttpError(400, 'accountNumber and bankCode required');

  const resolved = await paystack.resolveBankAccount({
    accountNumber,
    bankCode,
  });

  const recipient = await paystack.createTransferRecipient({
    accountNumber,
    bankCode,
    accountName: resolved.account_name,
  });

  const { rows } = await query(
    `INSERT INTO transfer_recipients
       (user_id, recipient_code, bank_code, bank_name, account_number, account_name)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id, account_number, bank_code)
       DO UPDATE SET recipient_code = EXCLUDED.recipient_code,
                     account_name = EXCLUDED.account_name,
                     updated_at = NOW()
     RETURNING *`,
    [
      req.user.id,
      recipient.recipient_code,
      bankCode,
      resolved.bank_name || null,
      accountNumber,
      resolved.account_name,
    ]
  );

  res.json({ recipient: rows[0] });
});

/* ---------- Host: list payout accounts ---------- */
export const listPayoutAccounts = asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT id, bank_code, bank_name, account_number, account_name,
            recipient_code, is_active, created_at
     FROM transfer_recipients
     WHERE user_id = $1
     ORDER BY created_at DESC`,
    [req.user.id]
  );
  res.json({ accounts: rows });
});

/* ---------- Banks list (for dropdown) ---------- */
export const listBanks = asyncHandler(async (req, res) => {
  const banks = await paystack.listBanks();
  res.json({ banks });
});