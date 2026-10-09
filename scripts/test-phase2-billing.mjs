// Phase 2 Billing & ERP Webhook Verification Test Suite
// Verifies Odoo v17 + IzyPay and iDempiere Standard Webhook integration.

import assert from 'node:assert';
import { createHmac } from 'node:crypto';

process.env.NODE_ENV = 'test';
process.env.ADMIN_TOKEN = 'test-admin-token-12345';
process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 'a').toString('base64');
process.env.LICENSE_DATABASE_URL = 'postgresql://dummy:dummy@localhost:5432/dummy';
process.env.BILLING_PROVIDER = 'odoo';
process.env.ODOO_WEBHOOK_SECRET = 'odoo-super-secret-token-123';
process.env.IDEMPIERE_WEBHOOK_SECRET = 'whsec_dGVzdHNlY3JldDEyMzQ1Njc4OTA=';

let passed = 0;
let total = 0;

async function test(name, fn) {
  total++;
  try {
    await fn();
    console.log(`✅ PASS: ${name}`);
    passed++;
  } catch (err) {
    console.error(`❌ FAIL: ${name}`);
    console.error(err);
  }
}

console.log('--- Testing Phase 2: ERP Webhooks (Odoo v17 + iDempiere) ---\n');

// 1. Helper functions for Standard Webhook signature generation
function computeStandardWebhookSignature(id, timestamp, payload, secret) {
  let secretBytes;
  if (secret.startsWith('whsec_')) {
    secretBytes = Buffer.from(secret.slice(6), 'base64');
  } else {
    secretBytes = Buffer.from(secret, 'utf8');
  }
  const toSign = `${id}.${timestamp}.${payload}`;
  return createHmac('sha256', secretBytes).update(toSign).digest('base64');
}

// 2. Intent extraction regex verification
function extractIntentIdFromText(text) {
  if (!text || typeof text !== 'string') return null;
  const trimmed = text.trim();
  const match = trimmed.match(/sck[=:\s]+([a-zA-Z0-9_-]+)/i);
  if (match) return match[1];
  if (/^[a-zA-Z0-9_-]{15,45}$/.test(trimmed)) return trimmed;
  return null;
}

await test('extractIntentIdFromText parses various ERP note formats', () => {
  assert.strictEqual(
    extractIntentIdFromText('sck=cuid_intent_123456789'),
    'cuid_intent_123456789',
  );
  assert.strictEqual(
    extractIntentIdFromText('Order completed with sck:cuid_intent_987654321 for renewal'),
    'cuid_intent_987654321',
  );
  assert.strictEqual(
    extractIntentIdFromText('Payment reference sck cuid_intent_555555555'),
    'cuid_intent_555555555',
  );
  assert.strictEqual(
    extractIntentIdFromText('cuid_intent_direct_123456789'),
    'cuid_intent_direct_123456789',
  );
  assert.strictEqual(extractIntentIdFromText('short'), null);
});

// 3. Import Fastify app and prisma from license-server
const { app, prisma } = await import('../apps/license-server/dist/server.cjs');

// In-memory mock storage for database calls during test
const paymentsStore = new Map();
const intentsStore = new Map();
let mockServerSettings = null;

prisma.serverSettings = {
  findUnique: async () => mockServerSettings,
  upsert: async ({ create, update }) => {
    mockServerSettings = { ...mockServerSettings, ...create, ...update };
    return mockServerSettings;
  },
};

prisma.payment = {
  findFirst: async ({ where }) => {
    for (const p of paymentsStore.values()) {
      if (where.transaction && p.transaction !== where.transaction) continue;
      if (where.provider && p.provider !== where.provider) continue;
      if (where.status && p.status !== where.status) continue;
      return p;
    }
    return null;
  },
  create: async ({ data }) => {
    const id = `pay_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const rec = { id, ...data };
    paymentsStore.set(id, rec);
    return rec;
  },
};

prisma.purchaseIntent = {
  findUnique: async ({ where }) => intentsStore.get(where.id) || null,
  findFirst: async ({ where }) => {
    for (const intent of intentsStore.values()) {
      if (where.email && intent.email?.toLowerCase() === where.email.toLowerCase()) return intent;
      if (where.instanceId && intent.instanceId === where.instanceId) return intent;
    }
    return null;
  },
  update: async ({ where, data }) => {
    const existing = intentsStore.get(where.id);
    const updated = { ...existing, ...data };
    intentsStore.set(where.id, updated);
    return updated;
  },
  updateMany: async () => ({ count: 1 }),
  create: async ({ data }) => {
    const id = `intent_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const rec = { id, ...data };
    intentsStore.set(id, rec);
    return rec;
  },
};

prisma.licenseKey = {
  findUnique: async () => null,
  findFirst: async () => null,
  create: async ({ data }) => ({
    id: `lk_${Date.now()}`,
    ...data,
  }),
  update: async ({ where, data }) => ({ id: where.id, ...data }),
};

prisma.activation = {
  findFirst: async () => null,
  upsert: async ({ create }) => ({ id: `act_${Date.now()}`, ...create }),
  update: async ({ where, data }) => ({ id: where.id, ...data }),
  updateMany: async () => ({ count: 1 }),
};

prisma.webhookKey = {
  findUnique: async () => null,
  update: async () => ({}),
};

prisma.licenseEvent = {
  create: async () => ({ id: `evt_${Date.now()}` }),
};

prisma.heartbeatLog = {
  create: async () => ({ id: `hb_${Date.now()}` }),
};

await test('GET /health responds with status ok', async () => {
  const res = await app.inject({
    method: 'GET',
    url: '/health',
  });
  assert.strictEqual(res.statusCode, 200);
  const data = JSON.parse(res.body);
  assert.strictEqual(data.status, 'ok');
});

await test('/webhook/odoo rejects unauthorized requests', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/webhook/odoo',
    payload: {
      order_id: 'SO1001',
      partner_email: 'test@empresa.com',
    },
  });
  assert.strictEqual(res.statusCode, 401);
});

await test('/webhook/idempiere rejects unauthorized requests without signature or token', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/webhook/idempiere',
    payload: {
      tableName: 'C_Order',
      recordId: 5001,
      data: { DocStatus: 'CO' },
    },
  });
  assert.strictEqual(res.statusCode, 401);
});

await test('/webhook/idempiere rejects invalid HMAC signature', async () => {
  const payloadStr = JSON.stringify({
    tableName: 'C_Order',
    recordId: 5002,
    data: { DocStatus: 'CO', GrandTotal: 100 },
  });
  const nowSec = Math.floor(Date.now() / 1000);
  const res = await app.inject({
    method: 'POST',
    url: '/webhook/idempiere',
    headers: {
      'content-type': 'application/json',
      'webhook-id': 'msg_test_001',
      'webhook-timestamp': String(nowSec),
      'webhook-signature': 'v1,invalid_signature_base64==',
    },
    payload: payloadStr,
  });
  assert.strictEqual(res.statusCode, 401);
});

await test('/webhook/idempiere accepts valid Standard Webhook HMAC signature and applies payment', async () => {
  const secret = process.env.IDEMPIERE_WEBHOOK_SECRET;
  const msgId = 'msg_idempiere_valid_1';
  const nowSec = Math.floor(Date.now() / 1000);
  const payloadObj = {
    event: 'record.completed',
    tableName: 'C_Order',
    recordId: 'IDEMP-99001',
    data: {
      DocumentNo: 'SO-IDEMP-99001',
      DocStatus: 'CO',
      GrandTotal: 250.0,
      C_Currency_ID: 'USD',
      EMail: 'finance@idempiere-test.com',
      POReference: 'sck=cuid_idempiere_intent_1',
    },
  };
  const rawBody = JSON.stringify(payloadObj);
  const sig = computeStandardWebhookSignature(msgId, nowSec, rawBody, secret);

  const res = await app.inject({
    method: 'POST',
    url: '/webhook/idempiere',
    headers: {
      'content-type': 'application/json',
      'webhook-id': msgId,
      'webhook-timestamp': String(nowSec),
      'webhook-signature': `v1,${sig}`,
    },
    payload: rawBody,
  });

  assert.strictEqual(res.statusCode, 200);
  const data = JSON.parse(res.body);
  assert.strictEqual(data.ok, true);
  assert.ok(data.expiresAt, 'Should return granted expiresAt');

  // Verify payment was recorded in ledger with provider = 'idempiere'
  const found = Array.from(paymentsStore.values()).find((p) => p.provider === 'idempiere');
  assert.ok(found, 'Should record payment in ledger for idempiere');
  assert.strictEqual(found.status, 'applied');
  assert.strictEqual(found.amount, 250.0);

  // Test idempotency
  const resRetry = await app.inject({
    method: 'POST',
    url: '/webhook/idempiere',
    headers: {
      'content-type': 'application/json',
      'webhook-id': msgId,
      'webhook-timestamp': String(nowSec),
      'webhook-signature': `v1,${sig}`,
    },
    payload: rawBody,
  });
  assert.strictEqual(resRetry.statusCode, 200);
  const dataRetry = JSON.parse(resRetry.body);
  assert.strictEqual(dataRetry.alreadyProcessed, true, 'Retry must be idempotent');
});

await test('/webhook/odoo accepts valid X-Odoo-Secret header and grants/renews 1 year', async () => {
  const secret = process.env.ODOO_WEBHOOK_SECRET;
  const orderId = `ODOO-SO-${Date.now()}`;
  const res = await app.inject({
    method: 'POST',
    url: '/webhook/odoo',
    headers: {
      'content-type': 'application/json',
      'x-odoo-secret': secret,
    },
    payload: {
      order_id: orderId,
      name: orderId,
      state: 'sale',
      amount_total: 199.99,
      currency: 'USD',
      partner_email: 'buyer@odoo-izypay-test.com',
      partner_name: 'Empresa Odoo S.A.C.',
      client_order_ref: 'sck=cuid_odoo_intent_456',
    },
  });

  assert.strictEqual(res.statusCode, 200);
  const data = JSON.parse(res.body);
  assert.strictEqual(data.ok, true);
  assert.ok(data.expiresAt, 'Should return expiration date');

  // Verify payment was recorded in ledger with provider = 'odoo'
  const found = Array.from(paymentsStore.values()).find((p) => p.transaction === orderId);
  assert.ok(found, 'Should record payment in ledger for odoo');
  assert.strictEqual(found.provider, 'odoo');
  assert.strictEqual(found.amount, 199.99);

  // Test idempotency
  const resRetry = await app.inject({
    method: 'POST',
    url: '/webhook/odoo',
    headers: {
      'content-type': 'application/json',
      'x-odoo-secret': secret,
    },
    payload: {
      order_id: orderId,
      name: orderId,
      state: 'sale',
      amount_total: 199.99,
      currency: 'USD',
      partner_email: 'buyer@odoo-izypay-test.com',
    },
  });
  assert.strictEqual(resRetry.statusCode, 200);
  const dataRetry = JSON.parse(resRetry.body);
  assert.strictEqual(dataRetry.alreadyProcessed, true);
});

await test('/admin/settings exposes billingProvider, odooSecret, and idempiereSecret', async () => {
  const res = await app.inject({
    method: 'GET',
    url: '/admin/settings',
    headers: {
      authorization: `Bearer ${process.env.ADMIN_TOKEN}`,
    },
  });
  assert.strictEqual(res.statusCode, 200);
  const data = JSON.parse(res.body);
  assert.ok('billingProvider' in data);
  assert.ok('odooSecret' in data);
  assert.ok('idempiereSecret' in data);
  assert.strictEqual(data.envDefaults.odooSecretSet, true);
  assert.strictEqual(data.envDefaults.idempiereSecretSet, true);
});

console.log(`\n========================================`);
console.log(`Phase 2 Tests completed: ${passed}/${total} passed`);
console.log(`========================================\n`);

if (passed !== total) {
  process.exit(1);
} else {
  process.exit(0);
}
