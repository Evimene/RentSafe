import { asyncHandler } from '../utils/asyncHandler.js';
import * as listing from '../services/listing.service.js';
import * as media from '../services/media.service.js';
import { HttpError } from '../middleware/error.js';

export const createListing = asyncHandler(async (req, res) => {
  const result = await listing.createPropertyWithListing({
    host: req.user,
    payload: req.body,
  });
  res.status(201).json(result);
});

export const updateListing = asyncHandler(async (req, res) => {
  const result = await listing.updateListing({
    host: req.user,
    listingId: req.params.id,
    patch: req.body,
  });
  res.json(result);
});

export const submitForReview = asyncHandler(async (req, res) => {
  const result = await listing.submitForReview({
    host: req.user,
    listingId: req.params.id,
  });
  res.json(result);
});

export const listMyListings = asyncHandler(async (req, res) => {
  const items = await listing.listHostListings({
    host: req.user,
    status: req.query.status,
  });
  res.json({ items });
});

export const getMyListing = asyncHandler(async (req, res) => {
  const data = await listing.getHostListing({
    host: req.user,
    listingId: req.params.id,
  });
  res.json(data);
});

export const archiveListing = asyncHandler(async (req, res) => {
  const result = await listing.archiveListing({
    host: req.user,
    listingId: req.params.id,
  });
  res.json(result);
});

export const setAvailability = asyncHandler(async (req, res) => {
  const { startDate, endDate, isAvailable, priceOverrideKobo, note } = req.body || {};
  if (!startDate || !endDate)
    throw new HttpError(400, 'startDate and endDate required');
  const result = await listing.setAvailabilityRange({
    host: req.user,
    listingId: req.params.id,
    startDate, endDate,
    isAvailable: isAvailable !== false,
    priceOverrideKobo,
    note,
  });
  res.json(result);
});

export const uploadPhotos = asyncHandler(async (req, res) => {
  if (!req.files || !req.files.length)
    throw new HttpError(400, 'No files uploaded');
  const created = await media.attachPhotos({
    host: req.user,
    listingId: req.params.id,
    files: req.files,
  });
  res.status(201).json({ photos: created });
});

export const deletePhoto = asyncHandler(async (req, res) => {
  const result = await media.deletePhoto({
    host: req.user,
    listingId: req.params.id,
    mediaId: req.params.mediaId,
  });
  res.json(result);
});

export const setCover = asyncHandler(async (req, res) => {
  const result = await media.setCoverPhoto({
    host: req.user,
    listingId: req.params.id,
    mediaId: req.params.mediaId,
  });
  res.json(result);
});