import { asyncHandler } from '../utils/asyncHandler.js';
import * as service from '../services/savedSearch.service.js';

export const list = asyncHandler(async (req, res) => {
  res.json({ items: await service.listSavedSearches({ userId: req.user.id }) });
});

export const create = asyncHandler(async (req, res) => {
  res.status(201).json(await service.createSavedSearch({
    userId: req.user.id,
    name: req.body?.name,
    params: req.body?.params,
    notify: req.body?.notify,
  }));
});

export const update = asyncHandler(async (req, res) => {
  res.json(await service.updateSavedSearch({
    userId: req.user.id, id: req.params.id, patch: req.body || {},
  }));
});

export const remove = asyncHandler(async (req, res) => {
  res.json(await service.deleteSavedSearch({
    userId: req.user.id, id: req.params.id,
  }));
});