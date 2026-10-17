import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import * as listing from '../controllers/listing.controller.js';

const router = Router();
router.get('/search',   asyncHandler(listing.search));
router.get('/:id',      asyncHandler(listing.detail));
export default router;