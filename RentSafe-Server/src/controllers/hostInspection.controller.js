import { asyncHandler } from '../utils/asyncHandler.js';
import * as service from '../services/inspection.service.js';

export const request = asyncHandler(async (req, res) => {
  res.status(201).json(await service.requestInspection({
    listingId: req.params.listingId,
    requestedBy: req.user.id,
    requesterRole: 'host',
  }));
});

export const listForListing = asyncHandler(async (req, res) => {
  // Reuse inspector detail but with host role (strips inspector PII)
  const { rows } = await import('../db.js').then((m) => m.query(
    `SELECT id FROM inspections
     WHERE listing_id = $1 AND requested_by IN (
       SELECT id FROM users WHERE id = $2
     ) OR listing_id = $1
     ORDER BY created_at DESC LIMIT 20`,
    [req.params.listingId, req.user.id]
  ).catch(() => ({ rows: [] })));
  // Simpler: just call detail on each id
  const out = [];
  for (const r of rows) {
    try {
      out.push(await service.getInspectionDetail({
        inspectionId: r.id, userId: req.user.id, role: 'host',
      }));
    } catch { /* skip unauthorized */ }
  }
  res.json({ items: out });
});

export const detail = asyncHandler(async (req, res) => {
  res.json(await service.getInspectionDetail({
    inspectionId: req.params.id, userId: req.user.id, role: 'host',
  }));
});