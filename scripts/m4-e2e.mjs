// M4 e2e: license activation, revoke->blocked (processing gated), reactivate,
// and instance-binding (no key sharing).
import http from 'node:http';

const API = 'http://127.0.0.1:3000';
const LS = 'http://127.0.0.1:4000';
const ADMIN = 'devadmintoken';
const MOCK_PORT = 4547;
const MOCK = `http://127.0.0.1:${MOCK_PORT}`;

// quiet mock chatwoot so worker processing succeeds
let mid = 7000;
const json = (res, code, obj) => {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(obj));
};
const server = http.createServer((req, res) => {
  const url = req.url || '';
  if (/\/inboxes(\?.*)?$/.test(url) && req.method === 'GET') return json(res, 200, []);
  if (/\/inboxes$/.test(url)) return json(res, 200, { id: 1 });
  if (/\/inboxes\/1$/.test(url)) return json(res, 200, { id: 1 });
  if (url.includes('/contacts/search')) return json(res, 200, { payload: [] });
  if (/\/contacts$/.test(url)) return json(res, 200, { payload: { contact: { id: 1 } } });
  if (/\/conversations(\?.*)?$/.test(url) && req.method === 'GET')
    return json(res, 200, { data: { payload: [] } });
  if (/\/conversations$/.test(url)) return json(res, 200, { id: 1 });
  if (/\/messages$/.test(url)) return json(res, 200, { id: ++mid });
  json(res, 200, {});
});

const results = [];
const check = (name, cond) => {
  results.push(!!cond);
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
};

async function jsonReq(url, opts = {}) {
  const res = await fetch(url, opts);
  const t = await res.text();
  return { status: res.status, data: t ? JSON.parse(t) : {} };
}
const adminReq = (path, body) =>
  jsonReq(LS + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${ADMIN}` },
    body: body ? JSON.stringify(body) : undefined,
  });

let token;
const apiReq = (path, method = 'GET', body) =>
  jsonReq(API + path, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

async function postWebhook(tok) {
  const res = await fetch(`${API}/webhook/${tok}/provider`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      message: { content: { text: 'x' }, sender: '5541999990000', messageid: `m${Date.now()}`, fromMe: false },
    }),
  });
  return (await res.json()).accepted;
}

async function main() {
  await new Promise((r) => server.listen(MOCK_PORT, '127.0.0.1', r));

  // license server up?
  const h = await jsonReq(`${LS}/health`).catch(() => ({ status: 0 }));
  check('license-server health', h.status === 200);

  ({ data: { token } = {} } = await apiReq('/api/auth/login', 'POST', {
    email: 'erico@wootrico.dev',
    password: 'supersecret123',
  }));

  // create integration (for webhook gating)
  const created = await apiReq('/api/integrations', 'POST', {
    name: 'M4 lic',
    providerType: 'uazapi',
    providerConfig: { provider: 'uazapi', baseUrl: MOCK, token: 't', whatsappNumber: '5541999990000' },
    chatwootBaseUrl: MOCK,
    chatwootApiToken: 'c',
    chatwootAccountId: '1',
    chatwootInboxName: 'M4',
  });
  const tok = created.data.integration.webhookUrls.provider.split('/webhook/')[1].split('/')[0];

  // 1) create key + activate
  const k1 = await adminReq('/admin/keys', { plan: 'paid', features: { maxIntegrations: 5 } });
  check('admin created key K1', k1.status === 201 && !!k1.data.key);
  const act = await apiReq('/api/license/activate', 'POST', { licenseKey: k1.data.key });
  check('activate K1 -> active', act.status === 200 && act.data.status === 'active');

  const st1 = await apiReq('/api/license/status');
  check('status active', st1.data.status === 'active');
  check('webhook accepted while active', (await postWebhook(tok)) === true);

  // 2) revoke -> heartbeat -> blocked -> webhook gated
  await adminReq(`/admin/keys/${k1.data.id}/revoke`);
  const hb = await apiReq('/api/license/heartbeat', 'POST', {});
  check('heartbeat after revoke -> blocked', hb.data.status === 'blocked');
  check('webhook rejected while blocked', (await postWebhook(tok)) === false);

  // 3) reactivate with a fresh key -> active -> webhook accepted
  const k2 = await adminReq('/admin/keys', {});
  const re = await apiReq('/api/license/activate', 'POST', { licenseKey: k2.data.key });
  check('reactivate with K2 -> active', re.data.status === 'active');
  check('webhook accepted after reactivation', (await postWebhook(tok)) === true);

  // 4) multi-instance: K3 used from two instances is allowed (no hard block),
  //    but a different IP is flagged with an ip_alert for the admin.
  const k3 = await adminReq('/admin/keys', {});
  const a = await jsonReq(`${LS}/activate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.0.0.1' },
    body: JSON.stringify({ key: k3.data.key, instanceId: 'inst-A' }),
  });
  const b = await jsonReq(`${LS}/activate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.0.0.2' },
    body: JSON.stringify({ key: k3.data.key, instanceId: 'inst-B' }),
  });
  check('inst-A activates', a.status === 200 && a.data.active === true);
  check('inst-B also activates (sharing allowed, alerted)', b.status === 200 && b.data.active === true);
  const ev = await jsonReq(`${LS}/admin/keys/${k3.data.id}/events`, {
    headers: { authorization: `Bearer ${ADMIN}` },
  });
  check(
    'ip_alert recorded for multi-IP use',
    Array.isArray(ev.data.events) && ev.data.events.some((e) => e.type === 'ip_alert'),
  );

  // cleanup
  await apiReq(`/api/integrations/${created.data.integration.id}`, 'DELETE');
  await apiReq('/api/license/deactivate', 'POST', {});

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  server.close();
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((e) => {
  console.error('E2E ERROR:', e.message);
  server.close();
  process.exit(1);
});
