import { query, withTransaction } from '../db.js';
import { hashPassword, verifyPassword } from '../utils/password.js';
import { signAccessToken, newRefreshToken, hashRefreshToken } from '../utils/jwt.js';
import { generateOtp, hashOtp } from '../utils/otp.js';
import { sendSms, otpMessage } from '../services/sms.service.js';
import { createCustomer } from '../services/paystack.service.js';
import { config } from '../config.js';
import { HttpError } from '../middleware/error.js';
import { isPhone, isEmail, isStrongPassword } from '../utils/validate.js';

const PURPOSE = {
  PHONE_VERIFY: 'verify_phone',
  LOGIN: 'login',
  RESET: 'reset_password',
};

const publicUser = (u) => ({
  id: u.id,
  phone: u.phone,
  email: u.email,
  firstName: u.first_name,
  kycStatus: u.kyc_status,
  isPhoneVerified: u.is_phone_verified,
  isEmailVerified: u.is_email_verified,
  roles: u.roles || ['guest'],
});


async function issueOtp({ userId, identifier, purpose }) {
  const code = generateOtp(config.otp.length);
  const codeHash = hashOtp(code);
  const expiresAt = new Date(Date.now() + config.otp.ttlMinutes * 60_000);
  
  await query(
    `UPDATE otp_codes SET consumed_at = NOW()
    WHERE identifier = $1 AND purpose = $2 AND consumed_at is NULL`,
    [identifier, purpose]
  );

  await query(
    `INSERT INTO otp_codes (user_id, identifier, code_hash, purpose, expires_at, max_attempts)
    VALUES ($1, $2, $3, $4, $5, $6)`,
    [userId, identifier, codeHash, purpose, expiresAt, config.otp.maxAttempts]
  );

  await sendSms({ to: identifier, message: otpMessage(code) });
  return config.otp.devReturn ? code : undefined;

}


async function issueSession({ user, req }) {
  const accessToken = signAccessToken({ sub: user.id, roles: user.roles });
  const { raw, hash } = newRefreshToken();
  const expiresAt = new Date(Date.now() + config.jwt.refreshTtlDays * 86400_000);

  await query(
    `INSERT INTO sessions (user_id, refresh_token_hash, expires_at, ip_address, user_agent, device_info)
    VALUES ($1, $2, $3, $4, $5, $6)`,
    [user.id, hash, expiresAt, req.ip, req.headers['user-agent'] || null, {}]
  );

  return {
    accessToken,
    refreshToken: raw,
    refreshExpiresAt: expiresAt
  };
}




// ------------------> Register
export async function register(req, res) {
  const { phone, email, password, firstName, lastName, role } = req.body || {};

  if (!isPhone(phone)) throw new HttpError(400, 'Invalid Phone Number');
  if (email && !isEmail(email)) throw new HttpError(400, 'Invalid email');
  if (!isStrongPassword(password)) throw new HttpError(400, 'Paasword must be 8+ chars with letters and numbers');
  if (!firstName || !lastName) throw new HttpError(400, 'First and last name required');


  const requestedRole = role === 'host' ? 'host' : 'guest';

  const user = await withTransaction(async (client) => {
    const dup = await client.query(
      `SELECT id FROM users
      WHERE phone = $1 OR ($2::citext IS NOT NULL AND email = $2) LIMIT 1`,
      [phone, email || null]
    );

    if (dup.rows[0]) throw new HttpError(409, 'User with this phone or email already exists');

    const passwordHash = await hashPassword(password);
    const { rows } = await client.query(
      `INSERT INTO users (phone, email, password_hash, first_name, last_name, display_name)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *`,
      [phone, email || null, passwordHash, firstName, lastName, `${firstName} ${lastName}`]
    );

    const u = rows[0];

    await client.query(
      `INSERT INTO user_roles (user_id, role) VALUES ($1, 'guest')`, [u.id]
    );

    if (requestedRole === 'host') {
      await client.query(
        `INSERT INTO user_roles (user_id, role) VALUES ($1, 'host')
         ON CONFLICT DO NOTHING`,
        [u.id]
      );
    }
    return u;
  });

  const devCode = await issueOtp({
    userId: user.id,
    identifier: user.phone,
    purpose: PURPOSE.PHONE_VERIFY,
  });

  try {
    await createCustomer({
      email: user.email || `${user.phone}@placeholder.local`,
      firstName: user.first_name,
      lastName: user.last_name,
      phone: user.phone,
    });
  } catch (err) {
    console.warn('[paystack] customer create failed:', err.message);
  }

  res.status(201).json({
    message: 'Registered. Verify your phone with the OTP sent.',
    user: publicUser(user),
    ...(devCode ? { devCode } : {}),
  });
}



// ------------> Verify Phone
export async function verifyPhone(req, res) {
  const { phone, code } = req.body || {};
  if (!isPhone(phone) || !code) throw new HttpError(400, 'Phone and code required');

  const { rows } = await query(
    `SELECT * FROM otp_codes
     WHERE identifier = $1 AND purpose = $2 AND consumed_at IS NULL
     ORDER BY created_at DESC LIMIT 1`,
    [phone, PURPOSE.PHONE_VERIFY]
  );

  const otp = rows[0];
  if (!otp) throw new HttpError(400, 'No active OTP. Request a new one.');
  if (new Date(otp.expires_at) < new Date()) throw new HttpError(400, 'OTP expired');
  if (otp.attempts >= otp.max_attempts)
    throw new HttpError(429, 'Too many attempts. Request a new OTP.');

  const ok = hashOtp(String(code)) === otp.code_hash;
  if (!ok) {
    await query(`UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1`, [otp.id]);
    throw new HttpError(400, 'Invalid code');
  }

  await withTransaction(async (client) => {
    await client.query(`UPDATE otp_codes SET consumed_at = NOW() WHERE id = $1`, [otp.id]);
    await client.query(
      `UPDATE users
      SET is_phone_verified = TRUE,
          is_active = TRUE
      WHERE id = $1;`,
      [otp.user_id]
    );
  });

  res.json({ message: 'Phone verified' });
}


// --------------> Resent OTP
export async function resendOtp(req, res) {
  const { phone, purpose } = req.body || {};
  if (!isPhone(phone)) throw new HttpError(400, 'Invalid phone');

  const allowed = Object.values(PURPOSE);
  const p = allowed.includes(purpose) ? purpose : PURPOSE.PHONE_VERIFY;

  const { rows } = await query(
    `SELECT id FROM users WHERE phone = $1 AND deleted_at IS NULL`,
    [phone]
  );
  if (!rows[0]) throw new HttpError(404, 'User not found');

  const devCode = await issueOtp({
    userId: rows[0].id,
    identifier: phone,
    purpose: p,
  });

  res.json({ message: 'OTP sent', ...(devCode ? { devCode } : {}) });
}



// ------------------> Login
export async function login(req, res) {
  const { identifier, password } = req.body || {};
  if (!identifier || !password)
    throw new HttpError(400, 'Identifier and password required');

  const { rows } = await query(
    `SELECT u.*,
            COALESCE(array_agg(ur.role) FILTER (WHERE ur.revoked_at IS NULL), '{}') AS roles
     FROM users u
     LEFT JOIN user_roles ur ON ur.user_id = u.id
     WHERE (u.phone = $1 OR u.email = $1::citext) AND u.deleted_at IS NULL
     GROUP BY u.id
     LIMIT 1`,
    [identifier]
  );

  const user = rows[0];
  if (!user) throw new HttpError(401, 'Invalid credentials');
  if (user.is_banned) throw new HttpError(403, 'Account banned');

  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) throw new HttpError(401, 'Invalid credentials');
  if (!user.is_phone_verified) throw new HttpError(403, 'Phone not verified');

  const tokens = await issueSession({ user, req });
  await query(`UPDATE users SET last_login_at = NOW() WHERE id = $1`, [user.id]);

  res.json({ user: publicUser(user), ...tokens });
}




// ------------------------> Refresh
export async function refresh(req, res) {
  const { refreshToken } = req.body || {};
  if (!refreshToken) throw new HttpError(400, 'refreshToken required');

  const hash = hashRefreshToken(refreshToken);
  const { rows } = await query(
    `SELECT s.*, u.id AS uid, u.is_banned,
            COALESCE(array_agg(ur.role) FILTER (WHERE ur.revoked_at IS NULL), '{}') AS roles
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     LEFT JOIN user_roles ur ON ur.user_id = u.id
     WHERE s.refresh_token_hash = $1 AND s.revoked_at IS NULL
     GROUP BY s.id, u.id
     LIMIT 1`,
    [hash]
  );

  const session = rows[0];
  if (!session) throw new HttpError(401, 'Invalid refresh token');
  if (new Date(session.expires_at) < new Date())
    throw new HttpError(401, 'Refresh token expired');
  if (session.is_banned) throw new HttpError(403, 'Account banned');

  await query(`UPDATE sessions SET revoked_at = NOW() WHERE id = $1`, [session.id]);
  const tokens = await issueSession({
    user: { id: session.uid, roles: session.roles },
    req,
  });
  res.json(tokens);
}




// --------------------> Logout
export async function logout(req, res) {
  const { refreshToken } = req.body || {};
  if (refreshToken) {
    await query(
      `UPDATE sessions SET revoked_at = NOW() WHERE refresh_token_hash = $1`,
      [hashRefreshToken(refreshToken)]
    );
  }
  res.json({ message: 'Logged out' });
}



// ----------------> Me
export async function me(req, res) {
  res.json({ user: publicUser({ ...req.user, roles: req.user.roles }) });
}
