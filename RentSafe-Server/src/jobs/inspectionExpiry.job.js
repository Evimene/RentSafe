import { query } from '../db.js';
import { requestInspection } from '../services/inspection.service.js';

const RE_VERIFY_AFTER_DAYS = 355; // ~12 months minus a 10-day buffer

export async function runInspectionExpiry() {
  // Listings due for re-verification
  const { rows } = await query(
    `SELECT l.id, l.host_id
     FROM listings l
     WHERE l.status = 'active'
       AND l.verified_at IS NOT NULL
       AND l.verified_at < NOW() - ($1 || ' days')::interval
       AND NOT EXISTS (
         SELECT 1 FROM inspections i
         WHERE i.listing_id = l.id
           AND i.status IN ('requested','assigned','scheduled','in_progress','submitted')
       )
     LIMIT 20`,
    [RE_VERIFY_AFTER_DAYS]
  );

  for (const l of rows) {
    try {
      const { rows: prev } = await query(
        `SELECT id FROM inspections
         WHERE listing_id = $1 AND status = 'approved'
         ORDER BY reviewed_at DESC LIMIT 1`,
        [l.id]
      );
      await requestInspection({
        listingId: l.id,
        requestedBy: l.host_id,
        requesterRole: 'host',
        previousInspectionId: prev[0]?.id || null,
      });
      console.log('[inspection-expiry] requested re-inspection for', l.id);
    } catch (err) {
      console.error('[inspection-expiry] failed', l.id, err.message);
    }
  }
  return rows.length;
}
