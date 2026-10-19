import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import * as c from '../controllers/adminInspection.controller.js';

const router = Router();
router.use(requireAuth, requireRole('admin', 'support'));

router.get('/',                asyncHandler(c.list));
router.get('/:id',             asyncHandler(c.detail));
router.post('/:id/assign',     asyncHandler(c.assign));
router.post('/:id/approve',    asyncHandler(c.approve));
router.post('/:id/reject',     asyncHandler(c.reject));

router.get('/inspectors',      asyncHandler(c.listInspectors));
router.post('/inspectors/:userId/grant',  asyncHandler(c.grantInspector));
router.post('/inspectors/:userId/revoke', asyncHandler(c.revokeInspector));

export default router;