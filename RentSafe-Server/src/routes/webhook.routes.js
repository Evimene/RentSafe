import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { paystackWebhook } from '../controllers/webhook.controller.js';

const router = Router();
router.post('/paystack', asyncHandler(paystackWebhook));
export default router;