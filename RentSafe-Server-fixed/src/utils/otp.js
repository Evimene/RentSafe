import crypto from 'node:crypto';

export function generateOtp(length = 6) {
  const n = crypto.randomInt(0, 10 ** length);
  return String(n).padStart(length, '0');
}

export const hashOtp = (code) =>
  crypto.createHash('sha256').update(String(code)).digest('hex');
