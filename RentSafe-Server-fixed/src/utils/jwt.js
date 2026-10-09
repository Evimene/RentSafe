import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { config } from '../config.js';

export const signAccessToken = (payload) => 
  jwt.sign(payload, config.jwt.accessSecret, { expiresIn: config.jwt.accessTtl });

export const verifyAccessToken = (token) => 
  jwt.verify(token, config.jwt.accessSecret);

export function newRefreshToken() {
  const raw = crypto.randomBytes(48).toString('base64url');
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  return { raw, hash };
}

export const hashRefreshToken = (raw) => 
  crypto.createHash('sha256').update(raw).digest('hex');