import { asyncHandler } from '../utils/asyncHandler.js';
import { HttpError } from '../middleware/error.js';
import * as service from '../services/inspection.service.js';
import * as inspectorService from '../services/inspector.service.js';

export const myProfile = asyncHandler(async (req, res) => {
  res.json(await inspectorService.getInspectorProfile({ userId: req.user.id }));
});

export const updateProfile = asyncHandler(async (req, res) => {
  res.json(await inspectorService.updateInspectorProfile({
    userId: req.user.id, patch: req.body || {},
  }));
});

export const myQueue = asyncHandler(async (req, res) => {
  const statuses = (req.query.status || 'assigned,scheduled,in_progress').split(',');
  res.json({ items: await service.getInspectorQueue({
    inspectorUserId: req.user.id, status: statuses,
  })});
});

export const myHistory = asyncHandler(async (req, res) => {
  res.json({ items: await service.getInspectorQueue({
    inspectorUserId: req.user.id, status: ['submitted','approved','rejected'],
  })});
});

export const detail = asyncHandler(async (req, res) => {
  res.json(await service.getInspectionDetail({
    inspectionId: req.params.id, userId: req.user.id, role: 'inspector',
  }));
});

export const accept = asyncHandler(async (req, res) => {
  res.json(await service.acceptInspection({
    inspectionId: req.params.id, inspectorUserId: req.user.id,
  }));
});

export const start = asyncHandler(async (req, res) => {
  const { lat, lng, accuracyM } = req.body || {};
  if (lat == null || lng == null) throw new HttpError(400, 'lat and lng required');
  res.json(await service.startInspection({
    inspectionId: req.params.id,
    inspectorUserId: req.user.id,
    lat, lng, accuracyM,
  }));
});

export const uploadPhoto = asyncHandler(async (req, res) => {
  if (!req.file) throw new HttpError(400, 'No file uploaded');
  const { category, itemKey, caption, lat, lng, accuracyM } = req.body || {};
  res.status(201).json(await service.attachInspectionPhoto({
    inspectionId: req.params.id,
    inspectorUserId: req.user.id,
    file: req.file,
    category, itemKey, caption,
    lat, lng, accuracyM,
  }));
});

export const submit = asyncHandler(async (req, res) => {
  const { answers, lat, lng, accuracyM, deviceInfo, selfieUrl } = req.body || {};
  res.json(await service.submitInspection({
    inspectionId: req.params.id,
    inspectorUserId: req.user.id,
    answers, lat, lng, accuracyM, deviceInfo, selfieUrl,
  }));
});

export const earnings = asyncHandler(async (req, res) => {
  res.json({ items: await inspectorService.listEarnings({ userId: req.user.id }) });
});