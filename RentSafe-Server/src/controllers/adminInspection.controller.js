import { asyncHandler } from '../utils/asyncHandler.js';
import * as service from '../services/inspection.service.js';
import * as inspectorService from '../services/inspector.service.js';

export const list = asyncHandler(async (req, res) => {
  res.json(await service.listAdminInspections({
    status: req.query.status || 'submitted',
    page: req.query.page,
    pageSize: req.query.pageSize,
  }));
});

export const detail = asyncHandler(async (req, res) => {
  res.json(await service.getInspectionDetail({
    inspectionId: req.params.id, userId: req.user.id, role: 'admin',
  }));
});

export const approve = asyncHandler(async (req, res) => {
  res.json(await service.approveInspection({
    inspectionId: req.params.id,
    adminId: req.user.id,
    overrideScore: req.body?.overrideScore,
    notes: req.body?.notes,
  }));
});

export const reject = asyncHandler(async (req, res) => {
  res.json(await service.rejectInspection({
    inspectionId: req.params.id,
    adminId: req.user.id,
    reason: req.body?.reason,
  }));
});

export const assign = asyncHandler(async (req, res) => {
  res.json(await service.assignInspector({
    inspectionId: req.params.id,
    inspectorUserId: req.body?.inspectorUserId,
    scheduledAt: req.body?.scheduledAt || null,
    adminId: req.user.id,
  }));
});

export const listInspectors = asyncHandler(async (req, res) => {
  res.json({ items: await inspectorService.listInspectorsForAdmin() });
});

export const grantInspector = asyncHandler(async (req, res) => {
  res.json(await inspectorService.grantInspector({
    userId: req.params.userId,
    adminId: req.user.id,
    ratePerInspectionKobo: req.body?.ratePerInspectionKobo,
    serviceAreas: req.body?.serviceAreas || [],
    neighborhoods: req.body?.neighborhoods || [],
  }));
});

export const revokeInspector = asyncHandler(async (req, res) => {
  res.json(await inspectorService.revokeInspector({
    userId: req.params.userId, adminId: req.user.id,
  }));
});