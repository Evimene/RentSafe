import { query, withTransaction } from '../db.js';
import { HttpError } from '../middleware/error.js';
import { verifyIdentity } from '../services/kyc.service.js';
import { config } from '../config.js';

const ALLOWED = new Set([
  'nin', 'bvn', 'selfie', 'address',
  'drivers_license', 'passport', 'voters_card',
]);

export async function submitKyc(req, res) {
  const { type, number, firstName, lastName, dob } = req.body || {};
  if (!ALLOWED.has(type)) throw new HttpError(400, 'Unsupported KYC type');
  if (type !== 'selfie' && !number) throw new HttpError(400, 'Number required');

  const selfieUrl = req.file ? `/uploads/${req.file.filename}` : null;

  const { rows } = await query(
    `INSERT INTO kyc_verifications
       (user_id, provider, verification_type, status, submitted_at, selfie_url)
     VALUES ($1, $2, $3, 'submitted', NOW(), $4)
     RETURNING *`,
    [req.user.id, config.kyc.provider, type, selfieUrl]
  );
  const record = rows[0];

  let result;
  try {
    result = await verifyIdentity({
      type,
      payload: { number, firstName, lastName, dob, selfieUrl },
    });
  } catch (err) {
    await query(
      `UPDATE kyc_verifications SET status = 'rejected', rejection_reason = $1 WHERE id = $2`,
      [`Provider error: ${err.message}`, record.id]
    );
    throw new HttpError(502, 'KYC provider unavailable, try again later');
  }

  const finalStatus = result.success ? 'verified' : 'rejected';

  const updated = await withTransaction(async (client) => {
    const { rows: r } = await client.query(
      `UPDATE kyc_verifications
       SET status = $1, reference_id = $2, verified_data = $3,
           rejection_reason = $4,
           verified_at = CASE WHEN $1 = 'verified' THEN NOW() ELSE NULL END
       WHERE id = $5
       RETURNING *`,
      [
        finalStatus,
        result.reference,
        result.data || {},
        result.reason || null,
        record.id,
      ]
    );

    if (finalStatus === 'verified') {
      await client.query(
        `UPDATE users SET kyc_status = 'verified'
         WHERE id = $1 AND kyc_status <> 'verified'`,
        [req.user.id]
      );
    }

    await client.query(
      `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, after_state)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        req.user.id,
        `kyc.${finalStatus}`,
        'kyc_verification',
        record.id,
        { type, provider: result.provider },
      ]
    );

    return r[0];
  });

  res.json({
    status: updated.status,
    reference: updated.reference_id,
    reason: updated.rejection_reason,
    type: updated.verification_type,
    verifiedAt: updated.verified_at,
  });
}

export async function getKycStatus(req, res) {
  const { rows } = await query(
    `SELECT id, verification_type, status, reference_id, rejection_reason,
            submitted_at, verified_at, created_at
     FROM kyc_verifications
     WHERE user_id = $1
     ORDER BY created_at DESC`,
    [req.user.id]
  );

  res.json({
    overall: req.user.kyc_status,
    records: rows.map((r) => ({
      id: r.id,
      type: r.verification_type,
      status: r.status,
      reference: r.reference_id,
      reason: r.rejection_reason,
      submittedAt: r.submitted_at,
      verifiedAt: r.verified_at,
    })),
  });
}