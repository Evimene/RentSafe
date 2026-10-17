import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/admin.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import * as admin from '../controllers/adminListing.controller.js';

const router = Router();
router.use(requireAuth, requireAdmin);

router.get('/',                  asyncHandler(admin.list));
router.get('/:id',               asyncHandler(admin.detail));
router.post('/:id/approve',      asyncHandler(admin.approve));
router.post('/:id/reject',       asyncHandler(admin.reject));
router.post('/:id/suspend',      asyncHandler(admin.suspend));

export default router;