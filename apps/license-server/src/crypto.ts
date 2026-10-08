import { createHash, randomBytes } from 'node:crypto';

/** SHA256 hex — used to store license keys and webhook keys at rest. */
export function hashKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/** Customer-facing license key. */
export function generateKey(): string {
  return `WTR-${randomBytes(20).toString('base64url')}`;
}

/** Webhook authentication key (payment provider → license server). */
export function generateWebhookKey(): string {
  return `WHK-${randomBytes(24).toString('base64url')}`;
}

/** Per-license secret handed to active instances (seals integration credentials). */
export function generateSecret(): string {
  return randomBytes(32).toString('base64url');
}
