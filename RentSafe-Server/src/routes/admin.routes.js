import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/admin.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import * as admin from '../controllers/admin.controller.js';

const router = Router();

router.use(requireAuth, requireAdmin);

router.get('/stats',               asyncHandler(admin.getStats));
router.get('/kyc',                 asyncHandler(admin.listKyc));
router.get('/kyc/:id',             asyncHandler(admin.getKycDetail));
router.post('/kyc/:id/reveal',
  rateLimit({ windowMs: 60_000, max: 20 }),
  asyncHandler(admin.revealKycFields));
router.post('/kyc/:id/review',
  rateLimit({ windowMs: 60_000, max: 30 }),
  asyncHandler(admin.reviewKyc));
router.get('/audit',               asyncHandler(admin.listAudit));
router.get('/rejection-reasons',   asyncHandler(admin.getRejectionReasons));

export default router;