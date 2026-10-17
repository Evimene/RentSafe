import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import * as host from '../controllers/host.controller.js';
import { upload } from '../services/media.service.js';

const router = Router();
router.use(requireAuth);

router.get('/listings',           asyncHandler(host.listMyListings));
router.post('/listings',          asyncHandler(host.createListing));
router.get('/listings/:id',       asyncHandler(host.getMyListing));
router.patch('/listings/:id',     asyncHandler(host.updateListing));
router.post('/listings/:id/submit', asyncHandler(host.submitForReview));
router.post('/listings/:id/archive', asyncHandler(host.archiveListing));
router.post('/listings/:id/availability', asyncHandler(host.setAvailability));

router.post('/listings/:id/media',
  upload.array('photos', 10),
  asyncHandler(host.uploadPhotos));
router.delete('/listings/:id/media/:mediaId',
  asyncHandler(host.deletePhoto));
router.post('/listings/:id/media/:mediaId/cover',
  asyncHandler(host.setCover));

export default router;