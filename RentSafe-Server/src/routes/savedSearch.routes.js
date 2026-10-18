import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import * as s from '../controllers/savedSearch.controller.js';

const router = Router();
router.use(requireAuth);

router.get('/',        asyncHandler(s.list));
router.post('/',       asyncHandler(s.create));
router.patch('/:id',   asyncHandler(s.update));
router.delete('/:id',  asyncHandler(s.remove));

export default router;