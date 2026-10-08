import { SignJWT, jwtVerify } from 'jose';
import { cfg } from './env.js';

const secret = new TextEncoder().encode(cfg.adminJwtSecret);

export interface AdminClaims {
  sub: string;
  email: string;
}

/** Issue a short-lived admin session token (HS256). */
export async function signAdminToken(email: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(email)
    .setIssuedAt()
    .setIssuer('wootrico-license-admin')
    .setExpirationTime('12h')
    .sign(secret);
}

/** Verify an admin session token; returns the email on success, null otherwise. */
export async function verifyAdminToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, secret, {
      issuer: 'wootrico-license-admin',
    });
    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}

/** Whether the panel login is configured (credentials present). */
export function adminLoginConfigured(): boolean {
  return Boolean(cfg.adminEmail && cfg.adminPassword);
}

/** Constant-ish credential check against env-configured admin credentials. */
export function checkAdminCredentials(email: string, password: string): boolean {
  if (!adminLoginConfigured()) return false;
  return email === cfg.adminEmail && password === cfg.adminPassword;
}
