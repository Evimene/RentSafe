import { asyncHandler } from '../utils/asyncHandler.js';
import { HttpError } from '../middleware/error.js';
import { searchListings, getPublicListing } from '../services/search.service.js';

export const search = asyncHandler(async (req, res) => {
  const result = await searchListings(req.query);
  res.json(result);
});

export const detail = asyncHandler(async (req, res) => {
  const listing = await getPublicListing(req.params.id);
  if (!listing) throw new HttpError(404, 'Listing not found');
  res.json(listing);
});