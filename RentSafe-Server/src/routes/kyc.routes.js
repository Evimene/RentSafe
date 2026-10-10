import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import crypto from 'node:crypto';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import * as kyc from '../controllers/kyc.controller.js';
import { config } from '../config.js';

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, config.uploads.dir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: config.uploads.maxBytes },
  fileFilter: (req, file, cb) => {
    const ok = ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype);
    cb(ok ? null : new Error('Only JPEG/PNG/WebP allowed'), ok);
  },
});

const router = Router();
router.use(requireAuth);

router.post('/submit',
  rateLimit({ windowMs: 60_000, max: 5 }),
  upload.single('selfie'),
  asyncHandler(kyc.submitKyc));

router.get('/status', asyncHandler(kyc.getKycStatus));

export default router;