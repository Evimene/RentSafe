import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import * as listing from '../controllers/listing.controller.js';
import * as listingInspection from '../controllers/listingInspection.controller.js';

const router = Router();
router.get('/search',   asyncHandler(listing.search));
router.get('/:id',      asyncHandler(listing.detail));

router.get('/:id/availability', asyncHandler(listing.getAvailability));
router.get('/:id/price',        asyncHandler(listing.price));

router.get('/:id/inspection-summary', asyncHandler(listingInspection.summary));

export default router;