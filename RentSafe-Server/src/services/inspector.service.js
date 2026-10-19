import { query, withTransaction } from '../db.js';
import { HttpError } from '../middleware/error.js';

export async function grantInspector({ userId, adminId, ratePerInspectionKobo, serviceAreas = [], neighborhoods = [] }) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT id, is_banned FROM users WHERE id = $1 AND deleted_at IS NULL`,
      [userId]
    );
    if (!rows[0]) throw new HttpError(404, 'User not found');
    if (rows[0].is_banned) throw new HttpError(400, 'User is banned');

    await client.query(
      `INSERT INTO user_roles (user_id, role)
       VALUES ($1, 'inspector')
       ON CONFLICT (user_id, role) DO NOTHING`,
      [userId]
    );

    await client.query(
      `INSERT INTO inspector_profiles
         (user_id, rate_per_inspection_kobo, service_areas, neighborhoods)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id) DO UPDATE
         SET rate_per_inspection_kobo = EXCLUDED.rate_per_inspection_kobo,
             service_areas = EXCLUDED.service_areas,
             neighborhoods = EXCLUDED.neighborhoods,
             is_active = TRUE,
             updated_at = NOW()`,
      [userId, ratePerInspectionKobo || 500000, serviceAreas, neighborhoods]
    );

    await client.query(
      `INSERT INTO audit_logs
         (actor_id, actor_role, action, entity_type, entity_id)
       VALUES ($1, 'admin', 'inspector.grant', 'user', $2)`,
      [adminId, userId]
    );

    return { ok: true };
  });
}

export async function revokeInspector({ userId, adminId }) {
  return withTransaction(async (client) => {
    await client.query(
      `UPDATE user_roles
       SET revoked_at = NOW()
       WHERE user_id = $1 AND role = 'inspector' AND revoked_at IS NULL`,
      [userId]
    );
    await client.query(
      `UPDATE inspector_profiles SET is_active = FALSE WHERE user_id = $1`,
      [userId]
    );
    await client.query(
      `INSERT INTO audit_logs
         (actor_id, actor_role, action, entity_type, entity_id)
       VALUES ($1, 'admin', 'inspector.revoke', 'user', $2)`,
      [adminId, userId]
    );
    return { ok: true };
  });
}

export async function getInspectorProfile({ userId }) {
  const { rows } = await query(
    `SELECT ip.*, u.first_name, u.last_name, u.phone, u.email, u.kyc_status
     FROM inspector_profiles ip JOIN users u ON u.id = ip.user_id
     WHERE ip.user_id = $1`,
    [userId]
  );
  const p = rows[0];
  if (!p) throw new HttpError(404, 'Inspector profile not found');

  const { rows: earnings } = await query(
    `SELECT
       COALESCE(SUM(amount_kobo) FILTER (WHERE status = 'paid'), 0)::bigint AS paid,
       COALESCE(SUM(amount_kobo) FILTER (WHERE status = 'pending'), 0)::bigint AS pending,
       COUNT(*) FILTER (WHERE status = 'paid') AS paid_count,
       COUNT(*) FILTER (WHERE status = 'pending') AS pending_count
     FROM inspection_earnings WHERE inspector_id = $1`,
    [userId]
  );

  return {
    userId: p.user_id,
    firstName: p.first_name,
    lastName: p.last_name,
    phone: p.phone,
    email: p.email,
    kycStatus: p.kyc_status,
    isActive: p.is_active,
    serviceAreas: p.service_areas,
    neighborhoods: p.neighborhoods,
    ratePerInspectionKobo: Number(p.rate_per_inspection_kobo),
    bio: p.bio,
    rating: p.rating ? Number(p.rating) : null,
    stats: {
      total: p.total_inspections,
      approved: p.approved_count,
      rejected: p.rejected_count,
      avgDurationMinutes: p.avg_duration_minutes ? Number(p.avg_duration_minutes) : null,
    },
    earnings: {
      paidKobo: Number(earnings[0].paid),
      pendingKobo: Number(earnings[0].pending),
      paidCount: Number(earnings[0].paid_count),
      pendingCount: Number(earnings[0].pending_count),
    },
  };
}

export async function updateInspectorProfile({ userId, patch }) {
  const fields = [];
  const values = [];
  const add = (col, val) => {
    if (val === undefined) return;
    values.push(val);
    fields.push(`${col} = $${values.length}`);
  };
  add('service_areas', patch.serviceAreas);
  add('neighborhoods', patch.neighborhoods);
  add('bio', patch.bio);

  if (!fields.length) return { ok: true };

  values.push(userId);
  await query(
    `UPDATE inspector_profiles SET ${fields.join(', ')}, updated_at = NOW()
     WHERE user_id = $${values.length}`,
    values
  );
  return { ok: true };
}

export async function listInspectorsForAdmin() {
  const { rows } = await query(
    `SELECT ip.*, u.first_name, u.last_name, u.phone, u.kyc_status
     FROM inspector_profiles ip JOIN users u ON u.id = ip.user_id
     ORDER BY ip.is_active DESC, ip.last_assigned_at DESC NULLS LAST
     LIMIT 200`
  );
  return rows.map((r) => ({
    userId: r.user_id,
    firstName: r.first_name,
    lastName: r.last_name,
    phone: r.phone,
    kycStatus: r.kyc_status,
    isActive: r.is_active,
    serviceAreas: r.service_areas,
    neighborhoods: r.neighborhoods,
    totalInspections: r.total_inspections,
    approved: r.approved_count,
    rejected: r.rejected_count,
    avgDurationMinutes: r.avg_duration_minutes ? Number(r.avg_duration_minutes) : null,
    lastAssignedAt: r.last_assigned_at,
  }));
}

export async function listEarnings({ userId }) {
  const { rows } = await query(
    `SELECT e.id, e.amount_kobo, e.status, e.paid_at, e.created_at,
            i.reference, i.score, i.submitted_at,
            l.title AS listing_title
     FROM inspection_earnings e
     JOIN inspections i ON i.id = e.inspection_id
     JOIN listings l ON l.id = i.listing_id
     WHERE e.inspector_id = $1
     ORDER BY e.created_at DESC
     LIMIT 100`,
    [userId]
  );
  return rows.map((r) => ({
    id: r.id,
    amountKobo: Number(r.amount_kobo),
    status: r.status,
    paidAt: r.paid_at,
    createdAt: r.created_at,
    inspectionReference: r.reference,
    score: r.score != null ? Number(r.score) : null,
    listingTitle: r.listing_title,
  }));
}