import { verifyAccessToken } from '../utils/jwt.js';
import { query } from '../db.js';

export async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Missing access Token' });

    const payload = verifyAccessToken(token);

    const { rows } = await query(
      `SELECT u.id, u.phone, u.email, u.first_name, u.last_name, u.kyc_status,
      u.is_active, u.is_banned, u.is_phone_verified, COALESCE(array_agg(ur.role) FILTER (WHERE ur.revoked_at IS NULL), '{}') AS roles
      FROM users u
      LEFT JOIN user_roles ur ON ur.user_id = u.id
      WHERE u.id = $1 AND u.deleted_at IS NULL
      GROUP BY u.id`,
      [ payload.sub ]
    );


    const user = rows[0];
    if (!user) return res.status(401).json({ error: 'User not found' });
    if (user.is_banned) return res.status(403).json({ error: 'Account banned' });
    if (!user.is_active) return res.status(403).json({ error: 'Account inactive' });

    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}


export const requireRole = (...roles) => (req, res, next) => {
  const has = (req.user?.roles || []).some((r) => roles.includes(r));
  if (!has) return res.status(403).json({ error: 'Forbidden' });

  next();
};