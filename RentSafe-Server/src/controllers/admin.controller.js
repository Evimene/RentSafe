import { query, withTransaction } from '../db.js';
import { HttpError } from '../middleware/error.js';
import { config } from '../config.js';

/* ============================================================
   Helpers
   ============================================================ */

const KYC_LISTABLE_STATUSES = new Set([
  'pending', 'submitted', 'verified', 'rejected', 'expired',
]);

const REJECTION_REASONS = [
  'blurry_image',
  'info_mismatch',
  'document_expired',
  'suspected_fraud',
  'duplicate_account',
  'underage',
  'sanctioned',
  'other',
];

/**
 * Mask a sensitive string: keep first 2 and last 2 chars.
 */
function mask(value) {
  if (!value) return null;
  const s = String(value);
  if (s.length <= 4) return '*'.repeat(s.length);
  return `${s.slice(0, 2)}${'*'.repeat(Math.max(0, s.length - 4))}${s.slice(-2)}`;
}

/**
 * Redact a verified_data JSONB blob for safe display.
 * Providers often return full name, DOB, address, photo URL.
 * We keep the non-sensitive bits and mask the IDs.
 */
function redactVerifiedData(data, reveal = false) {
  if (!data || typeof data !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === 'string' && /(nin|bvn|phone|email|account|address)/i.test(k)) {
      out[k] = reveal ? v : mask(v);
    } else if (typeof v === 'string' && /(photo|image|url|selfie)/i.test(k)) {
      out[k] = reveal ? v : '[redacted-url]';
    } else {
      out[k] = v;
    }
  }
  return out;
}

async function writeAudit(client, {
  actorId, actorRole, action, entityType, entityId,
  beforeState, afterState, subjectUserId, notes, sensitive,
  req,
}) {
  await client.query(
    `INSERT INTO audit_logs
       (actor_id, actor_role, action, entity_type, entity_id,
        before_state, after_state, subject_user_id, notes, sensitive,
        ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      actorId, actorRole, action, entityType, entityId,
      beforeState || null, afterState || null,
      subjectUserId || null, notes || null, sensitive || false,
      req.ip, req.headers['user-agent'] || null,
    ]
  );
}

/* ============================================================
   GET /api/admin/stats
   ============================================================ */

export async function getStats(req, res) {
  const { rows } = await query(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'submitted')  AS pending,
       COUNT(*) FILTER (WHERE status = 'verified')   AS verified,
       COUNT(*) FILTER (WHERE status = 'rejected')   AS rejected,
       COUNT(*) FILTER (WHERE status = 'expired')    AS expired,
       COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') AS last_24h,
       COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days')   AS last_7d
     FROM kyc_verifications`
  );
  res.json(rows[0]);
}

/* ============================================================
   GET /api/admin/kyc
   ============================================================ */

export async function listKyc(req, res) {
  const {
    status = 'submitted',
    type = '',
    search = '',
    page = '1',
    pageSize = '20',
  } = req.query;

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const size = Math.min(100, Math.max(5, parseInt(pageSize, 10) || 20));
  const offset = (pageNum - 1) * size;

  const where = [];
  const params = [];

  if (status && status !== 'all') {
    if (!KYC_LISTABLE_STATUSES.has(status))
      throw new HttpError(400, 'Invalid status filter');
    params.push(status);
    where.push(`k.status = $${params.length}`);
  }

  if (type) {
    params.push(type);
    where.push(`k.verification_type = $${params.length}`);
  }

  if (search) {
    params.push(`%${search}%`);
    const i = params.length;
    where.push(`(u.phone ILIKE $${i} OR u.email ILIKE $${i} OR u.first_name ILIKE $${i} OR u.last_name ILIKE $${i})`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const countRes = await query(
    `SELECT COUNT(*)::int AS total
     FROM kyc_verifications k
     JOIN users u ON u.id = k.user_id
     ${whereSql}`,
    params
  );
  const total = countRes.rows[0].total;

  params.push(size, offset);
  const { rows } = await query(
    `SELECT
       k.id, k.user_id, k.verification_type, k.status,
       k.provider, k.reference_id, k.rejection_reason,
       k.submitted_at, k.verified_at, k.created_at,
       (k.selfie_url IS NOT NULL) AS has_selfie,
       u.phone, u.email, u.first_name, u.last_name,
       u.kyc_status AS user_kyc_status, u.is_banned
     FROM kyc_verifications k
     JOIN users u ON u.id = k.user_id
     ${whereSql}
     ORDER BY
       CASE k.status WHEN 'submitted' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
       k.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  res.json({
    data: rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      type: r.verification_type,
      status: r.status,
      provider: r.provider,
      reference: r.reference_id,
      rejectionReason: r.rejection_reason,
      submittedAt: r.submitted_at,
      verifiedAt: r.verified_at,
      createdAt: r.created_at,
      hasSelfie: r.has_selfie,
      user: {
        phone: r.phone,
        email: r.email,
        firstName: r.first_name,
        lastName: r.last_name,
        kycStatus: r.user_kyc_status,
        isBanned: r.is_banned,
      },
    })),
    pagination: { page: pageNum, pageSize: size, total, pages: Math.ceil(total / size) },
    filters: { status, type, search },
  });
}

/* ============================================================
   GET /api/admin/kyc/:id
   ============================================================ */

export async function getKycDetail(req, res) {
  const { id } = req.params;

  const { rows } = await query(
    `SELECT
       k.*,
       u.phone, u.email, u.first_name, u.last_name,
       u.kyc_status AS user_kyc_status, u.is_banned,
       u.is_phone_verified, u.is_email_verified,
       u.created_at AS user_created_at, u.last_login_at
     FROM kyc_verifications k
     JOIN users u ON u.id = k.user_id
     WHERE k.id = $1`,
    [id]
  );

  const kyc = rows[0];
  if (!kyc) throw new HttpError(404, 'KYC record not found');

  const auditRes = await query(
    `SELECT id, action, actor_id, actor_role, notes, created_at
     FROM audit_logs
     WHERE entity_type = 'kyc_verification' AND entity_id = $1
     ORDER BY created_at DESC
     LIMIT 50`,
    [id]
  );

  // Log the view (non-sensitive)
  await withTransaction(async (client) => {
    await writeAudit(client, {
      actorId: req.user.id,
      actorRole: req.user.roles[0] || 'admin',
      action: 'kyc.view',
      entityType: 'kyc_verification',
      entityId: id,
      subjectUserId: kyc.user_id,
      req,
    });
  });

  res.json({
    id: kyc.id,
    userId: kyc.user_id,
    type: kyc.verification_type,
    status: kyc.status,
    provider: kyc.provider,
    reference: kyc.reference_id,
    rejectionReason: kyc.rejection_reason,
    submittedAt: kyc.submitted_at,
    verifiedAt: kyc.verified_at,
    createdAt: kyc.created_at,
    selfieUrl: kyc.selfie_url,
    documentUrl: kyc.document_url,
    verifiedData: redactVerifiedData(kyc.verified_data, false),
    hasSensitiveData: Boolean(kyc.verified_data && Object.keys(kyc.verified_data).length),
    user: {
      id: kyc.user_id,
      phone: kyc.phone,
      email: kyc.email,
      firstName: kyc.first_name,
      lastName: kyc.last_name,
      kycStatus: kyc.user_kyc_status,
      isBanned: kyc.is_banned,
      isPhoneVerified: kyc.is_phone_verified,
      isEmailVerified: kyc.is_email_verified,
      createdAt: kyc.user_created_at,
      lastLoginAt: kyc.last_login_at,
    },
    auditTrail: auditRes.rows,
  });
}

/* ============================================================
   POST /api/admin/kyc/:id/reveal
   ============================================================ */

export async function revealKycFields(req, res) {
  const { id } = req.params;
  const { field = 'verified_data' } = req.body || {};

  const { rows } = await query(
    `SELECT k.*, k.user_id FROM kyc_verifications k WHERE k.id = $1`,
    [id]
  );
  const kyc = rows[0];
  if (!kyc) throw new HttpError(404, 'KYC record not found');
  if (kyc.user_id === req.user.id)
    throw new HttpError(403, 'You cannot reveal data on your own record');

  await withTransaction(async (client) => {
    await writeAudit(client, {
      actorId: req.user.id,
      actorRole: req.user.roles[0] || 'admin',
      action: 'kyc.reveal_field',
      entityType: 'kyc_verification',
      entityId: id,
      subjectUserId: kyc.user_id,
      notes: `Revealed: ${field}`,
      sensitive: true,
      req,
    });
  });

  if (field === 'selfie_url' && kyc.selfie_url) {
    return res.json({ field, value: kyc.selfie_url });
  }
  if (field === 'document_url' && kyc.document_url) {
    return res.json({ field, value: kyc.document_url });
  }
  if (field === 'verified_data') {
    return res.json({
      field,
      value: redactVerifiedData(kyc.verified_data, true),
    });
  }

  res.json({ field, value: null });
}

/* ============================================================
   POST /api/admin/kyc/:id/review
   body: { action: 'approve' | 'reject', reason?: string, notes?: string }
   ============================================================ */

export async function reviewKyc(req, res) {
  const { id } = req.params;
  const { action, reason, notes } = req.body || {};

  if (!['approve', 'reject'].includes(action))
    throw new HttpError(400, 'action must be "approve" or "reject"');

  if (action === 'reject') {
    if (!reason) throw new HttpError(400, 'Rejection reason required');
    if (!REJECTION_REASONS.includes(reason))
      throw new HttpError(400, 'Invalid rejection reason');
    if (reason === 'other' && (!notes || notes.trim().length < 5))
      throw new HttpError(400, 'Please provide notes when using "other"');
  }

  const result = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT k.*, u.id AS uid, u.is_banned
       FROM kyc_verifications k
       JOIN users u ON u.id = k.user_id
       WHERE k.id = $1
       FOR UPDATE`,
      [id]
    );
    const kyc = rows[0];
    if (!kyc) throw new HttpError(404, 'KYC record not found');

    if (kyc.user_id === req.user.id)
      throw new HttpError(403, 'You cannot review your own KYC');

    if (!['submitted', 'pending'].includes(kyc.status))
      throw new HttpError(409, `Cannot review a record in status "${kyc.status}"`);

    const newStatus = action === 'approve' ? 'verified' : 'rejected';
    const rejectionReason = action === 'reject' ? reason : null;

    await client.query(
      `UPDATE kyc_verifications
       SET status = $1,
           rejection_reason = $2,
           verified_at = CASE WHEN $1 = 'verified' THEN NOW() ELSE verified_at END,
           updated_at = NOW()
       WHERE id = $3`,
      [newStatus, rejectionReason, id]
    );

    if (action === 'approve') {
      await client.query(
        `UPDATE users SET kyc_status = 'verified', updated_at = NOW()
         WHERE id = $1 AND kyc_status <> 'verified'`,
        [kyc.user_id]
      );
    } else {
      // Only demote the user if this was their most recent submission
      const { rows: latest } = await client.query(
        `SELECT id FROM kyc_verifications
         WHERE user_id = $1
         ORDER BY created_at DESC LIMIT 1`,
        [kyc.user_id]
      );
      if (latest[0]?.id === id) {
        await client.query(
          `UPDATE users SET kyc_status = 'rejected', updated_at = NOW()
           WHERE id = $1`,
          [kyc.user_id]
        );
      }
    }

    await writeAudit(client, {
      actorId: req.user.id,
      actorRole: req.user.roles[0] || 'admin',
      action: `kyc.${action}`,
      entityType: 'kyc_verification',
      entityId: id,
      subjectUserId: kyc.user_id,
      beforeState: { status: kyc.status, rejection_reason: kyc.rejection_reason },
      afterState: { status: newStatus, rejection_reason: rejectionReason },
      notes: notes || null,
      sensitive: true,
      req,
    });

    return { id, status: newStatus, rejectionReason, userId: kyc.user_id };
  });

  res.json({ ok: true, ...result });
}

/* ============================================================
   GET /api/admin/audit
   ============================================================ */

export async function listAudit(req, res) {
  const {
    entityType = '',
    entityId = '',
    actorId = '',
    sensitive = '',
    page = '1',
    pageSize = '50',
  } = req.query;

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const size = Math.min(200, Math.max(5, parseInt(pageSize, 10) || 50));
  const offset = (pageNum - 1) * size;

  const where = [];
  const params = [];

  if (entityType) { params.push(entityType); where.push(`entity_type = $${params.length}`); }
  if (entityId)   { params.push(entityId);   where.push(`entity_id = $${params.length}`); }
  if (actorId)    { params.push(actorId);    where.push(`actor_id = $${params.length}`); }
  if (sensitive === 'true') where.push(`sensitive = TRUE`);

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const countRes = await query(
    `SELECT COUNT(*)::int AS total FROM audit_logs ${whereSql}`,
    params
  );

  params.push(size, offset);
  const { rows } = await query(
    `SELECT id, actor_id, actor_role, action, entity_type, entity_id,
            subject_user_id, notes, sensitive, ip_address, created_at
     FROM audit_logs
     ${whereSql}
     ORDER BY created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  res.json({
    data: rows,
    pagination: { page: pageNum, pageSize: size, total: countRes.rows[0].total },
  });
}

/* ============================================================
   GET /api/admin/rejection-reasons
   ============================================================ */

export function getRejectionReasons(req, res) {
  const labels = {
    blurry_image: 'Blurry or unreadable image',
    info_mismatch: 'Information does not match submitted ID',
    document_expired: 'Document is expired',
    suspected_fraud: 'Suspected fraud or forgery',
    duplicate_account: 'Duplicate account detected',
    underage: 'User is under 18',
    sanctioned: 'Matches sanctions/watchlist',
    other: 'Other (specify in notes)',
  };
  res.json(
    REJECTION_REASONS.map((value) => ({ value, label: labels[value] || value }))
  );
}