import * as availability from '../services/availability.service.js';

export const getAvailability = asyncHandler(async (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) throw new HttpError(400, 'from and to required');
  res.json(await availability.getHostAvailability({
    host: req.user, listingId: req.params.id, from, to,
  }));
});

export const bulkUpdateAvailability = asyncHandler(async (req, res) => {
  res.json(await availability.bulkUpsertAvailability({
    host: req.user, listingId: req.params.id, updates: req.body?.updates,
  }));
});

export const clearAvailabilityOverrides = asyncHandler(async (req, res) => {
  res.json(await availability.clearOverrides({
    host: req.user, listingId: req.params.id, dates: req.body?.dates,
  }));
});