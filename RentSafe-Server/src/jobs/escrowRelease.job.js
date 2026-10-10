import { query } from '../db.js';
import { releaseEscrow } from '../services/escrow.service.js';

const BATCH_SIZE = 20;

export async function runEscrowRelease() {
  const { rows } = await query(
    `SELECT e.id
     FROM escrow_holds e
     JOIN bookings b ON b.id = e.booking_id
     WHERE e.status = 'holding'
       AND e.release_eligible_at IS NOT NULL
       AND e.release_eligible_at <= NOW()
       AND b.status IN ('checked_in', 'confirmed', 'completed')
     ORDER BY e.release_eligible_at ASC
     LIMIT $1`,
    [BATCH_SIZE]
  );

  for (const row of rows) {
    try {
      await releaseEscrow(row.id, { force: false });
      console.log('[escrow-release] released', row.id);
    } catch (err) {
      console.error('[escrow-release] failed', row.id, err.message);
    }
  }

  return rows.length;
}