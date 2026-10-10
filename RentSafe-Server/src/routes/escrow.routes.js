import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import * as escrow from '../controllers/escrow.controller.js';

const router = Router();

// Banks (public — needed before login on the bank dropdown)
router.get('/banks', asyncHandler(escrow.listBanks));

router.use(requireAuth);

// Guest flow
router.post('/bookings/:bookingId/charge',   asyncHandler(escrow.startCharge));
router.get('/payment/callback',              asyncHandler(escrow.confirmPayment));
router.post('/bookings/:bookingId/check-in', asyncHandler(escrow.checkIn));

// Host payout accounts
router.get('/payout-accounts',  asyncHandler(escrow.listPayoutAccounts));
router.post('/payout-accounts', asyncHandler(escrow.addPayoutAccount));

// Admin/ops
router.post('/escrow/:escrowId/release', asyncHandler(escrow.release));
router.post('/escrow/:escrowId/refund',  asyncHandler(escrow.refund));

export default router;