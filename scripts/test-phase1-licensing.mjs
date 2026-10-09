// Phase 1 Licensing Verification Test Suite
// Verifies dev mode bypass, community/developer perpetual handling, and crypto fallback.

import assert from 'node:assert';
import { computeStatus, isProcessingAllowed } from '../packages/license-client/src/state-machine.js';
import { encryptSecret, decryptSecret } from '../packages/config/src/crypto.js';

process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 'a').toString('base64');

let passed = 0;
let total = 0;

function test(name, fn) {
  total++;
  try {
    fn();
    console.log(`✅ PASS: ${name}`);
    passed++;
  } catch (err) {
    console.error(`❌ FAIL: ${name}`);
    console.error(err);
  }
}

console.log('--- Testing Phase 1: License Flexibilization & Perpetual Rules ---\n');

// 1. Unactivated state in normal mode
test('Unactivated state is blocked in normal mode', () => {
  delete process.env.LICENSE_DEV_MODE;
  const state = {
    licenseKey: null,
    instanceId: null,
    plan: null,
    expiresAt: null,
    lastValidatedAt: null,
    status: 'unactivated',
  };
  const status = computeStatus(state);
  assert.strictEqual(status, 'unactivated');
  assert.strictEqual(isProcessingAllowed(status), false);
});

// 2. Unactivated state in DEV mode
test('LICENSE_DEV_MODE=true bypasses unactivated state and allows processing', () => {
  process.env.LICENSE_DEV_MODE = 'true';
  const state = {
    licenseKey: null,
    instanceId: null,
    plan: null,
    expiresAt: null,
    lastValidatedAt: null,
    status: 'unactivated',
  };
  const status = computeStatus(state);
  assert.strictEqual(status, 'active');
  assert.strictEqual(isProcessingAllowed(status), true);
  delete process.env.LICENSE_DEV_MODE;
});

// 3. Expired trial in normal mode
test('Expired trial in normal mode is blocked', () => {
  delete process.env.LICENSE_DEV_MODE;
  const now = new Date();
  const past = new Date(now.getTime() - 24 * 3600 * 1000); // 1 day ago
  const state = {
    licenseKey: 'WTR-TRIAL-123',
    instanceId: 'inst-1',
    plan: 'trial',
    expiresAt: past,
    lastValidatedAt: past,
    status: 'active',
  };
  const status = computeStatus(state, now);
  assert.strictEqual(status, 'blocked');
  assert.strictEqual(isProcessingAllowed(status), false);
});

// 4. Community plan with past expiry and stale validation
test('Community plan is never expired and ignores offline grace period', () => {
  delete process.env.LICENSE_DEV_MODE;
  const now = new Date();
  const ancient = new Date(now.getTime() - 365 * 24 * 3600 * 1000); // 1 year ago
  const state = {
    licenseKey: 'WTR-COMMUNITY-999',
    instanceId: 'inst-community',
    plan: 'community',
    expiresAt: ancient,
    lastValidatedAt: ancient,
    status: 'active',
  };
  const status = computeStatus(state, now);
  assert.strictEqual(status, 'active');
  assert.strictEqual(isProcessingAllowed(status), true);
});

// 5. Developer plan with past expiry and stale validation
test('Developer plan is never expired and ignores offline grace period', () => {
  delete process.env.LICENSE_DEV_MODE;
  const now = new Date();
  const ancient = new Date(now.getTime() - 30 * 24 * 3600 * 1000); // 30 days ago
  const state = {
    licenseKey: 'WTR-DEV-999',
    instanceId: 'inst-dev',
    plan: 'developer',
    expiresAt: ancient,
    lastValidatedAt: ancient,
    status: 'active',
  };
  const status = computeStatus(state, now);
  assert.strictEqual(status, 'active');
  assert.strictEqual(isProcessingAllowed(status), true);
});

// 6. Paid plan with null expiresAt (perpetual paid)
test('Paid plan with null expiresAt is perpetual and active', () => {
  delete process.env.LICENSE_DEV_MODE;
  const now = new Date();
  const state = {
    licenseKey: 'WTR-PAID-LIFETIME',
    instanceId: 'inst-paid-lifetime',
    plan: 'paid',
    expiresAt: null,
    lastValidatedAt: now,
    status: 'active',
  };
  const status = computeStatus(state, now);
  assert.strictEqual(status, 'active');
  assert.strictEqual(isProcessingAllowed(status), true);
});

// 7. Deterministic Dev Secret Cryptographic Sealing
test('Cryptographic HKDF L1: sealing works with deterministic dev secret', () => {
  const devSecret = 'wootrico-dev-community-seal-secret';
  const testPayload = 'uazapi-api-token-secret-12345';
  
  // Encrypt with dev secret
  const ciphertext = encryptSecret(testPayload, devSecret);
  assert.ok(ciphertext.startsWith('L1:'), 'Ciphertext must start with L1: prefix');
  
  // Decrypt with same dev secret
  const decrypted = decryptSecret(ciphertext, devSecret);
  assert.strictEqual(decrypted, testPayload, 'Decrypted text must match original payload');
});

console.log(`\n========================================`);
console.log(`Summary: ${passed}/${total} tests passed.`);
console.log(`========================================\n`);

if (passed !== total) {
  process.exit(1);
}
