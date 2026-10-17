-- migrations/002_admin_audit_extensions.sql

ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS subject_user_id UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS sensitive BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_audit_subject
  ON audit_logs(subject_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_sensitive
  ON audit_logs(sensitive, created_at DESC) WHERE sensitive = TRUE;

-- A view to make admin listing fast
CREATE OR REPLACE VIEW v_kyc_queue AS
SELECT
  k.id,
  k.user_id,
  u.phone,
  u.email,
  u.first_name,
  u.last_name,
  u.kyc_status AS user_kyc_status,
  u.is_banned,
  k.provider,
  k.verification_type,
  k.status,
  k.reference_id,
  k.rejection_reason,
  k.submitted_at,
  k.verified_at,
  k.created_at,
  (k.selfie_url IS NOT NULL) AS has_selfie
FROM kyc_verifications k
JOIN users u ON u.id = k.user_id
WHERE u.deleted_at IS NULL
ORDER BY k.created_at DESC;