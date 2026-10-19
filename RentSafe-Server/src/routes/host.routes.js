import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import * as host from '../controllers/host.controller.js';
import { upload } from '../services/media.service.js';
import * as hostInspection from '../controllers/hostInspection.controller.js';

const router = Router();
router.use(requireAuth);

router.get('/listings', asyncHandler(host.listMyListings));
router.post('/listings', asyncHandler(host.createListing));
router.get('/listings/:id', asyncHandler(host.getMyListing));
router.patch('/listings/:id', asyncHandler(host.updateListing));
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

router.get('/listings/:id/availability', asyncHandler(host.getAvailability));
router.post('/listings/:id/availability/bulk', asyncHandler(host.bulkUpdateAvailability));
router.post('/listings/:id/availability/clear-overrides', asyncHandler(host.clearAvailabilityOverrides));

router.post('/listings/:listingId/request-inspection', asyncHandler(hostInspection.request));
router.get('/listings/:listingId/inspections',         asyncHandler(hostInspection.listForListing));
router.get('/inspections/:id',                          asyncHandler(hostInspection.detail));

export default router;