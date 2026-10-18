import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { rateLimit } from '../middleware/rateLimit.js';
import * as map from '../controllers/map.controller.js';

const router = Router();

router.get('/markers', asyncHandler(map.markers));
router.get('/nearby/:id', asyncHandler(map.nearby));

// Geocoder — stricter rate limit (Nominatim policy)
router.get('/geocode',  rateLimit({ windowMs: 60_000, max: 30 }), asyncHandler(map.forward));
router.get('/reverse',  rateLimit({ windowMs: 60_000, max: 30 }), asyncHandler(map.reverse));

export default router;  