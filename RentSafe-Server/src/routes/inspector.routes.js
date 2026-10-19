import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { config } from '../config.js';
import * as c from '../controllers/inspector.controller.js';

const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const dir = path.join(config.uploads.dir, 'inspections');
    await fs.mkdir(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ['image/jpeg','image/png','image/webp'].includes(file.mimetype);
    cb(ok ? null : new Error('Only JPEG/PNG/WebP allowed'), ok);
  },
});

const router = Router();
router.use(requireAuth, requireRole('inspector'));

router.get('/profile',        asyncHandler(c.myProfile));
router.patch('/profile',      asyncHandler(c.updateProfile));
router.get('/queue',          asyncHandler(c.myQueue));
router.get('/history',        asyncHandler(c.myHistory));
router.get('/earnings',       asyncHandler(c.earnings));

router.get('/inspections/:id',        asyncHandler(c.detail));
router.post('/inspections/:id/accept',asyncHandler(c.accept));
router.post('/inspections/:id/start', asyncHandler(c.start));
router.post('/inspections/:id/photos',
  rateLimit({ windowMs: 60_000, max: 60 }),
  upload.single('photo'),
  asyncHandler(c.uploadPhoto));
router.post('/inspections/:id/submit',asyncHandler(c.submit));

export default router;