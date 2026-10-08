// M2 end-to-end test with a mock Chatwoot + uazapi server.
// Verifies: inbound (customer->Chatwoot), outbound (Chatwoot->uazapi),
// and the dedup cases (api echo skip, phone-origin skip).
import http from 'node:http';

const API = 'http://127.0.0.1:3000';
const MOCK_PORT = 4545;
const MOCK = `http://127.0.0.1:${MOCK_PORT}`;

// ── recorders ──
const rec = {
  chatwootMessages: [], // {type, content}
  uazapiText: [],
  uazapiMedia: [],
  inboxCreated: 0,
  contactsCreated: 0,
  conversationsCreated: 0,
};
let msgId = 9000;

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data));
  });
}
function json(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(obj));
}

const server = http.createServer(async (req, res) => {
  const url = req.url || '';
  const body = await readBody(req);
  const ct = req.headers['content-type'] || '';
  const parsed = ct.includes('application/json') && body ? JSON.parse(body) : {};

  // ---- uazapi ----
  if (url === '/instance/status') return json(res, 200, { status: 'connected' });
  if (url === '/send/text') {
    rec.uazapiText.push({ number: parsed.number, text: parsed.text, replyid: parsed.replyid });
    return json(res, 200, { messageid: `wamid.OUT${rec.uazapiText.length}` });
  }
  if (url === '/send/media') {
    rec.uazapiMedia.push({ number: parsed.number, type: parsed.type });
    return json(res, 200, { messageid: `wamid.OUTM${rec.uazapiMedia.length}` });
  }

  // ---- chatwoot ----
  const inboxes = url.match(/\/api\/v1\/accounts\/[^/]+\/inboxes(\?.*)?$/);
  if (inboxes && req.method === 'GET') return json(res, 200, []);
  if (inboxes && req.method === 'POST') {
    rec.inboxCreated++;
    return json(res, 200, { id: 99, name: parsed.name });
  }
  if (url.match(/\/inboxes\/99$/)) return json(res, 200, { id: 99 });

  if (url.includes('/contacts/search')) return json(res, 200, { payload: [] });
  if (url.match(/\/contacts$/) && req.method === 'POST') {
    rec.contactsCreated++;
    return json(res, 200, { payload: { contact: { id: 1001 } } });
  }

  if (url.match(/\/conversations(\?.*)?$/) && req.method === 'GET')
    return json(res, 200, { data: { payload: [] } });
  if (url.match(/\/conversations$/) && req.method === 'POST') {
    rec.conversationsCreated++;
    return json(res, 200, { id: 5001 });
  }

  if (url.match(/\/messages$/) && req.method === 'POST') {
    let content = parsed.content;
    let mtype = parsed.message_type;
    if (ct.includes('multipart')) {
      const m = body.match(/name="message_type"\r?\n\r?\n([^\r]+)/);
      const c = body.match(/name="content"\r?\n\r?\n([^\r]+)/);
      mtype = m ? m[1] : 'unknown';
      content = c ? c[1] : '';
    }
    rec.chatwootMessages.push({ type: mtype, content });
    return json(res, 200, { id: ++msgId });
  }

  json(res, 404, { error: 'mock_not_found', url });
});

// ── helpers ──
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function apiFetch(path, opts = {}, token) {
  const headers = { ...(opts.headers || {}) };
  if (opts.body != null) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(API + path, { ...opts, headers });
  const txt = await res.text();
  const data = txt ? JSON.parse(txt) : {};
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${txt}`);
  return data;
}
async function waitFor(fn, label, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fn()) return true;
    await sleep(500);
  }
  throw new Error(`timeout waiting for: ${label}`);
}

const results = [];
function check(name, cond) {
  results.push({ name, ok: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
}

async function main() {
  await new Promise((r) => server.listen(MOCK_PORT, '127.0.0.1', r));
  console.log(`mock on ${MOCK}`);

  // login
  const { token } = await apiFetch('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'erico@wootrico.dev', password: 'supersecret123' }),
  });

  // create integration pointing at the mock
  const created = await apiFetch(
    '/api/integrations',
    {
      method: 'POST',
      body: JSON.stringify({
        name: 'E2E uazapi',
        providerType: 'uazapi',
        providerConfig: {
          provider: 'uazapi',
          baseUrl: MOCK,
          token: 'utok',
          whatsappNumber: '5541999990000',
        },
        chatwootBaseUrl: MOCK,
        chatwootApiToken: 'cwtok',
        chatwootAccountId: '1',
        chatwootInboxName: 'E2E',
      }),
    },
    token,
  );
  const integration = created.integration;
  check('integration created + inbox ensured (status ok)', integration.status === 'ok');
  check('mock inbox was created', rec.inboxCreated === 1);
  const webhookToken = integration.webhookUrls.provider.split('/webhook/')[1].split('/')[0];

  const provHook = `/webhook/${webhookToken}/provider`;
  const cwHook = `/webhook/${webhookToken}/chatwoot`;

  // CASE 1 — inbound customer message
  await fetch(API + provHook, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      message: {
        content: { text: 'ola mundo' },
        sender: '554188887777@s.whatsapp.net',
        messageid: 'wamid.IN1',
        fromMe: false,
        wasSentByApi: false,
      },
      chat: { name: 'Cliente Teste' },
    }),
  });
  await waitFor(
    () => rec.chatwootMessages.some((m) => m.content === 'ola mundo' && m.type === 'incoming'),
    'inbound message mirrored to Chatwoot (incoming)',
  );
  check('CASE1 inbound -> Chatwoot incoming', true);
  const afterCase1 = rec.chatwootMessages.length;

  // CASE 2 — agent replies in Chatwoot -> uazapi
  await fetch(API + cwHook, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      event: 'message_created',
      message_type: 'outgoing',
      private: false,
      id: 7001,
      content: 'resposta do agente',
      sender: { name: 'Agente' },
      conversation: {
        id: 5001,
        meta: { sender: { phone_number: '+554188887777', identifier: '554188887777' } },
      },
      attachments: [],
    }),
  });
  await waitFor(
    () => rec.uazapiText.some((m) => m.text?.includes('resposta do agente')),
    'outgoing Chatwoot message sent to uazapi',
  );
  check('CASE2 Chatwoot -> uazapi send', rec.uazapiText.length === 1);
  check('CASE2 signature applied', rec.uazapiText[0]?.text?.startsWith('*Agente:*'));

  // CASE 4 — provider echoes our own send (fromMe + fromApi) -> must SKIP
  await fetch(API + provHook, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      message: {
        content: { text: '*Agente:*\n\nresposta do agente' },
        sender: '554188887777@s.whatsapp.net',
        messageid: 'wamid.ECHO',
        fromMe: true,
        wasSentByApi: true,
      },
      chat: { name: 'Cliente Teste' },
    }),
  });
  await sleep(4000);
  check('CASE4 api echo skipped (no new Chatwoot msg)', rec.chatwootMessages.length === afterCase1);

  // CASE 3 — agent types on the phone (fromMe, not api) -> mirror outgoing to Chatwoot
  await fetch(API + provHook, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      message: {
        content: { text: 'digitei no celular' },
        sender: '554188887777@s.whatsapp.net',
        messageid: 'wamid.PHONE1',
        fromMe: true,
        wasSentByApi: false,
      },
      chat: { name: 'Cliente Teste' },
    }),
  });
  await waitFor(
    () => rec.chatwootMessages.some((m) => m.content === 'digitei no celular' && m.type === 'outgoing'),
    'phone-typed message mirrored to Chatwoot (outgoing)',
  );
  check('CASE3 phone -> Chatwoot outgoing', true);

  // CASE 3b — the Chatwoot callback for that mirrored message must NOT resend to uazapi
  await fetch(API + cwHook, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      event: 'message_created',
      message_type: 'outgoing',
      private: false,
      id: 7002,
      content: 'digitei no celular',
      sender: { name: 'Agente' },
      conversation: {
        id: 5001,
        meta: { sender: { phone_number: '+554188887777', identifier: '554188887777' } },
      },
      attachments: [],
    }),
  });
  await sleep(4000);
  check('CASE3b phone-origin callback skipped (uazapi unchanged)', rec.uazapiText.length === 1);

  // cleanup
  await apiFetch(`/api/integrations/${integration.id}`, { method: 'DELETE' }, token);

  console.log('\n--- summary ---');
  console.log(JSON.stringify(rec, null, 2));
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  server.close();
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error('E2E ERROR:', err.message);
  server.close();
  process.exit(1);
});
