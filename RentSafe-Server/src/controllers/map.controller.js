import { asyncHandler } from '../utils/asyncHandler.js';
import { HttpError } from '../middleware/error.js';
import { searchMapMarkers, nearbyListings } from '../services/map.service.js';
import { geocode, reverseGeocode } from '../services/geocode.service.js';

export const markers = asyncHandler(async (req, res) => {
  res.json(await searchMapMarkers(req.query));
});

export const nearby = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const radius = Number(req.query.radius || 2000);
  res.json(await nearbyListings({
    listingId: id,
    radiusMeters: Math.min(20_000, Math.max(500, radius)),
    limit: Math.min(12, Number(req.query.limit || 6)),
  }));
});

export const forward = asyncHandler(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) throw new HttpError(400, 'q required');
  res.json(await geocode(q));
});

export const reverse = asyncHandler(async (req, res) => {
  const { lat, lng } = req.query;
  if (!lat || !lng) throw new HttpError(400, 'lat and lng required');
  res.json(await reverseGeocode(lat, lng));
});