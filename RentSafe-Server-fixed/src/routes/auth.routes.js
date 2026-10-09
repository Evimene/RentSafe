import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { requireAuth } from '../middleware/auth.js';
import * as auth from '../controllers/auth.controller.js';

const router = Router();

router.post('/register',
  rateLimit({ windowMs: 60_000, max: 5 }),
  asyncHandler(auth.register));

router.post('/verify-phone',
  rateLimit({ windowMs: 60_000, max: 10 }),
  asyncHandler(auth.verifyPhone));

router.post('/resend-otp',
  rateLimit({ windowMs: 60_000, max: 3 }),
  asyncHandler(auth.resendOtp));

router.post('/login',
  rateLimit({ windowMs: 60_000, max: 10 }),
  asyncHandler(auth.login));

router.post('/refresh', asyncHandler(auth.refresh));
router.post('/logout', asyncHandler(auth.logout));
router.get('/me', requireAuth, asyncHandler(auth.me));

export default router;