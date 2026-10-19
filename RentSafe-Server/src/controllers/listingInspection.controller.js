import { asyncHandler } from '../utils/asyncHandler.js';
import { getPublicInspectionSummary } from '../services/inspection.service.js';

export const summary = asyncHandler(async (req, res) => {
  res.json(await getPublicInspectionSummary({ listingId: req.params.id }));
});