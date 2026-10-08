// M3 e2e: zapi + evolution round trips, unknown-token 404, evolution echo skip.
import http from 'node:http';

const API = 'http://127.0.0.1:3000';
const MOCK_PORT = 4546;
const MOCK = `http://127.0.0.1:${MOCK_PORT}`;

const rec = { chatwoot: [], zapiText: [], evoText: [] };
let mid = 6000;

const readBody = (req) =>
  new Promise((res) => {
    let d = '';
    req.on('data', (c) => (d += c));
    req.on('end', () => res(d));
  });
const json = (res, code, obj) => {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(obj));
};

const server = http.createServer(async (req, res) => {
  const url = req.url || '';
  const body = await readBody(req);
  const ct = req.headers['content-type'] || '';
  const p = ct.includes('application/json') && body ? JSON.parse(body) : {};

  // zapi
  if (url.endsWith('/status')) return json(res, 200, { connected: true });
  if (url.endsWith('/send-text')) {
    rec.zapiText.push({ phone: p.phone, message: p.message });
    return json(res, 200, { messageId: `zOUT${rec.zapiText.length}` });
  }
  // evolution
  if (url.includes('/instance/connectionState/'))
    return json(res, 200, { instance: { state: 'open' } });
  if (url.includes('/message/sendText/')) {
    rec.evoText.push({ number: p.number, text: p.text });
    return json(res, 200, { key: { id: `eOUT${rec.evoText.length}` } });
  }

  // chatwoot
  if (/\/inboxes(\?.*)?$/.test(url) && req.method === 'GET') return json(res, 200, []);
  if (/\/inboxes$/.test(url) && req.method === 'POST') return json(res, 200, { id: 99 });
  if (/\/inboxes\/99$/.test(url)) return json(res, 200, { id: 99 });
  if (url.includes('/contacts/search')) return json(res, 200, { payload: [] });
  if (/\/contacts$/.test(url) && req.method === 'POST')
    return json(res, 200, { payload: { contact: { id: 2002 } } });
  if (/\/conversations(\?.*)?$/.test(url) && req.method === 'GET')
    return json(res, 200, { data: { payload: [] } });
  if (/\/conversations$/.test(url) && req.method === 'POST') return json(res, 200, { id: 6001 });
  if (/\/messages$/.test(url) && req.method === 'POST') {
    rec.chatwoot.push({ type: p.message_type, content: p.content });
    return json(res, 200, { id: ++mid });
  }

  json(res, 404, { error: 'mock_not_found', url });
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function apiFetch(path, opts = {}, token) {
  const headers = { ...(opts.headers || {}) };
  if (opts.body != null) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(API + path, { ...opts, headers });
  const t = await res.text();
  const d = t ? JSON.parse(t) : {};
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${t}`);
  return d;
}
async function waitFor(fn, label, ms = 20000) {
  const s = Date.now();
  while (Date.now() - s < ms) {
    if (fn()) return;
    await sleep(500);
  }
  throw new Error(`timeout: ${label}`);
}
const results = [];
const check = (name, cond) => {
  results.push(!!cond);
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
};
const tokenOf = (it) => it.webhookUrls.provider.split('/webhook/')[1].split('/')[0];

async function makeIntegration(token, name, providerType, providerConfig) {
  const { integration } = await apiFetch(
    '/api/integrations',
    {
      method: 'POST',
      body: JSON.stringify({
        name,
        providerType,
        providerConfig,
        chatwootBaseUrl: MOCK,
        chatwootApiToken: 'cw',
        chatwootAccountId: '1',
        chatwootInboxName: name,
      }),
    },
    token,
  );
  return integration;
}

async function main() {
  await new Promise((r) => server.listen(MOCK_PORT, '127.0.0.1', r));
  const { token } = await apiFetch('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'erico@wootrico.dev', password: 'supersecret123' }),
  });

  // ── zapi integration ──
  const z = await makeIntegration(token, 'M3 zapi', 'zapi', {
    provider: 'zapi',
    instance: 'INST',
    token: 'TOK',
    clientToken: 'CTOK',
    baseUrl: MOCK,
  });
  const zt = tokenOf(z);
  await fetch(`${API}/webhook/${zt}/provider`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      phone: '554199998888',
      momment: 1,
      messageId: 'zIN1',
      fromMe: false,
      fromApi: false,
      senderName: 'Cliente Z',
      text: { message: 'oi do zapi' },
    }),
  });
  await waitFor(() => rec.chatwoot.some((m) => m.content === 'oi do zapi'), 'zapi inbound');
  check('zapi inbound -> Chatwoot', true);

  await fetch(`${API}/webhook/${zt}/chatwoot`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      event: 'message_created',
      message_type: 'outgoing',
      private: false,
      id: 8001,
      content: 'resposta z',
      sender: { name: 'Ag' },
      conversation: { id: 6001, meta: { sender: { phone_number: '+554199998888' } } },
      attachments: [],
    }),
  });
  await waitFor(() => rec.zapiText.some((m) => m.message?.includes('resposta z')), 'zapi outbound');
  check('zapi outbound -> zapi send', rec.zapiText.length === 1);

  // ── evolution integration ──
  const e = await makeIntegration(token, 'M3 evo', 'evolution', {
    provider: 'evolution',
    baseUrl: MOCK,
    apiKey: 'AK',
    instance: 'evoinst',
  });
  const et = tokenOf(e);
  await fetch(`${API}/webhook/${et}/provider`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      event: 'messages.upsert',
      instance: 'evoinst',
      data: {
        key: { remoteJid: '554177776666@s.whatsapp.net', fromMe: false, id: 'eIN1' },
        pushName: 'Cliente E',
        message: { conversation: 'oi do evolution' },
      },
    }),
  });
  await waitFor(() => rec.chatwoot.some((m) => m.content === 'oi do evolution'), 'evo inbound');
  check('evolution inbound -> Chatwoot', true);

  await fetch(`${API}/webhook/${et}/chatwoot`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      event: 'message_created',
      message_type: 'outgoing',
      private: false,
      id: 8002,
      content: 'resposta e',
      sender: { name: 'Ag' },
      conversation: { id: 6001, meta: { sender: { phone_number: '+554177776666' } } },
      attachments: [],
    }),
  });
  await waitFor(() => rec.evoText.some((m) => m.text?.includes('resposta e')), 'evo outbound');
  check('evolution outbound -> evolution send', rec.evoText.length === 1);

  // ── evolution echo skip (our own send id eOUT1 echoes back) ──
  const chatwootBefore = rec.chatwoot.length;
  await fetch(`${API}/webhook/${et}/provider`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      event: 'messages.upsert',
      instance: 'evoinst',
      data: {
        key: { remoteJid: '554177776666@s.whatsapp.net', fromMe: true, id: 'eOUT1' },
        pushName: 'Cliente E',
        message: { conversation: 'resposta e' },
      },
    }),
  });
  await sleep(4000);
  check('evolution echo skipped (mapping-based)', rec.chatwoot.length === chatwootBefore);

  // ── unknown token 404 ──
  const r404 = await fetch(`${API}/webhook/nope-token/provider`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  check('unknown webhook token -> 404', r404.status === 404);

  // cleanup
  await apiFetch(`/api/integrations/${z.id}`, { method: 'DELETE' }, token);
  await apiFetch(`/api/integrations/${e.id}`, { method: 'DELETE' }, token);

  console.log('\n' + JSON.stringify(rec, null, 2));
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  server.close();
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((err) => {
  console.error('E2E ERROR:', err.message);
  server.close();
  process.exit(1);
});
