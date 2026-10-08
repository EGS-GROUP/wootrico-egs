import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM encryption for secrets-at-rest (Chatwoot tokens, provider
 * credentials, license key). The key comes from APP_ENCRYPTION_KEY (32 raw
 * bytes, base64-encoded).
 *
 * Ciphertext format (base64 of): [12-byte IV][16-byte auth tag][ciphertext]
 */

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;

let keyCache: Buffer | undefined;

function getKey(): Buffer {
  if (keyCache) return keyCache;
  const raw = process.env.APP_ENCRYPTION_KEY;
  if (!raw) throw new Error('APP_ENCRYPTION_KEY is not set');
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error(
      `APP_ENCRYPTION_KEY must decode to 32 bytes (got ${key.length}). Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
    );
  }
  keyCache = key;
  return key;
}

export function encrypt(plaintext: string): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, getKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

export function decrypt(payload: string): string {
  const buf = Buffer.from(payload, 'base64');
  if (buf.length < IV_LEN + TAG_LEN) throw new Error('Invalid ciphertext');
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const enc = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

/** Encrypt a JSON-serializable value. */
export function encryptJson(value: unknown): string {
  return encrypt(JSON.stringify(value));
}

/** Decrypt to a typed JSON value. */
export function decryptJson<T>(payload: string): T {
  return JSON.parse(decrypt(payload)) as T;
}

// ─────────────────────────────────────────────────────────────────────────────
// License-sealed secrets. Integration credentials (provider/Chatwoot tokens) are
// encrypted with a key derived from BOTH the local APP_ENCRYPTION_KEY and a
// per-license secret that only the vendor's license server knows and hands over
// the validated channel. Without that secret the data cannot be decrypted — so a
// fake "always-active" license server (or a patched boolean gate) does NOT
// unlock the product, because it can't produce the right key. Legacy ciphertext
// (no prefix) still decrypts with the local key for backward compatibility.
// ─────────────────────────────────────────────────────────────────────────────
const SEAL_PREFIX = 'L1:';

function sealKey(licenseSecret: string): Buffer {
  // HKDF-SHA256(ikm=APP_ENCRYPTION_KEY, salt=licenseSecret) → 32-byte AES key.
  return Buffer.from(
    hkdfSync('sha256', getKey(), Buffer.from(licenseSecret, 'utf8'), Buffer.from('wootrico-license-seal-v1'), 32),
  );
}

/** Whether a stored value is license-sealed (needs the per-license secret). */
export function isLicenseSealed(payload: string): boolean {
  return payload.startsWith(SEAL_PREFIX);
}

/** Encrypt a secret bound to the per-license secret (AES-256-GCM, L1: prefix). */
export function encryptSecret(plaintext: string, licenseSecret: string): string {
  if (!licenseSecret) throw new Error('license_secret_required');
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, sealKey(licenseSecret), iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return SEAL_PREFIX + Buffer.concat([iv, tag, enc]).toString('base64');
}

/**
 * Decrypt a (possibly license-sealed) secret. Sealed values require the
 * per-license secret; legacy values fall back to the local key. Throws
 * `license_secret_required` when a sealed value is read without the secret.
 */
export function decryptSecret(payload: string, licenseSecret: string | null): string {
  if (!isLicenseSealed(payload)) return decrypt(payload); // legacy (local key only)
  if (!licenseSecret) throw new Error('license_secret_required');
  const buf = Buffer.from(payload.slice(SEAL_PREFIX.length), 'base64');
  if (buf.length < IV_LEN + TAG_LEN) throw new Error('Invalid ciphertext');
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const enc = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, sealKey(licenseSecret), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

/**
 * Decrypt a sealed secret trying SEVERAL candidate license secrets — the data
 * may have been sealed with any of the instance's historical secrets (the seal
 * secret changes when a license is reactivated). Legacy (unsealed) values use
 * the local key. Throws if none of the candidates work.
 */
export function decryptSecretAny(payload: string, licenseSecrets: (string | null | undefined)[]): string {
  if (!isLicenseSealed(payload)) return decrypt(payload); // legacy (local key only)
  const candidates = licenseSecrets.filter((s): s is string => !!s);
  let lastErr: unknown;
  for (const s of candidates) {
    try {
      return decryptSecret(payload, s);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error('license_secret_required');
}

/** URL-safe random token (used for per-integration webhook tokens). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/**
 * Keyed HMAC-SHA256 hex digest. Used to pseudonymize PII (e.g. phone numbers in
 * dedup tickets / cache keys) — we only ever compare equality, never reverse it.
 */
export function hmac(value: string): string {
  return createHmac('sha256', getKey()).update(value).digest('hex');
}
