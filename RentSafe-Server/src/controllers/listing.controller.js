import { asyncHandler } from '../utils/asyncHandler.js';
import { HttpError } from '../middleware/error.js';
import { searchListings, getPublicListing } from '../services/search.service.js';
import * as availability from '../services/availability.service.js';

export const search = asyncHandler(async (req, res) => {
  const result = await searchListings(req.query);
  res.json(result);
});

export const detail = asyncHandler(async (req, res) => {
  const listing = await getPublicListing(req.params.id);
  if (!listing) throw new HttpError(404, 'Listing not found');
  res.json(listing);
});


export const getAvailability = asyncHandler(async (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) throw new HttpError(400, 'from and to required');
  res.json(await availability.getPublicAvailability({
    listingId: req.params.id, from, to,
  }));
});

export const price = asyncHandler(async (req, res) => {
  const { checkIn, checkOut } = req.query;
  if (!checkIn || !checkOut) throw new HttpError(400, 'checkIn and checkOut required');
  res.json(await availability.priceRange({
    listingId: req.params.id, checkIn, checkOut,
  }));
});