import { api } from './api-client';

export interface Binding {
  id: string;
  instanceId: string;
  appVersion: string | null;
  publicBaseUrl: string | null;
  firstIp: string | null;
  lastIp: string | null;
  boundAt: string;
  lastHeartbeatAt: string | null;
  revokedAt: string | null;
}

export interface LicenseKeyRow {
  id: string;
  plan: 'trial' | 'paid' | string;
  expiresAt: string | null;
  expired: boolean;
  statusReason: string | null;
  email: string | null;
  name: string | null;
  provisionedBy: string;
  revoked: boolean;
  activations: number;
  activeInstances: number;
  distinctIps: number;
  alerts: number;
  warning: boolean;
  lastIp: string | null;
  lastHeartbeatAt: string | null;
  createdAt: string;
  bindings: Binding[];
}

export interface WebhookKeyRow {
  id: string;
  name: string | null;
  revoked: boolean;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface LicenseEvent {
  id: string;
  licenseKeyId: string | null;
  instanceId: string | null;
  type: string;
  ip: string | null;
  appVersion: string | null;
  meta: Record<string, unknown> | null;
  createdAt: string;
}

export const login = (email: string, password: string) =>
  api<{ token: string; user: { email: string } }>('/admin/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });

export const getKeys = (
  params: {
    q?: string;
    from?: string;
    to?: string;
    plan?: 'trial' | 'paid';
    status?: 'active' | 'expired' | 'revoked';
  } = {},
) => {
  const sp = new URLSearchParams();
  if (params.q) sp.set('q', params.q);
  if (params.from) sp.set('from', params.from);
  if (params.to) sp.set('to', params.to);
  if (params.plan) sp.set('plan', params.plan);
  if (params.status) sp.set('status', params.status);
  const qs = sp.toString();
  return api<{ keys: LicenseKeyRow[] }>(`/admin/keys${qs ? `?${qs}` : ''}`);
};

export interface KeyDetail {
  key: {
    id: string;
    plan: string;
    status: 'active' | 'expired' | 'revoked';
    statusReason: string | null;
    expiresAt: string | null;
    revokedAt: string | null;
    email: string | null;
    name: string | null;
    provisionedBy: string;
    createdAt: string;
    activations: number;
    activeInstances: number;
    distinctIps: number;
    alerts: number;
  };
  bindings: Binding[];
}

export const getKey = (id: string) => api<KeyDetail>(`/admin/keys/${id}`);

export const expireKey = (id: string, reason?: string) =>
  api<{ ok: boolean }>(`/admin/keys/${id}/expire`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });

export const revokeKey = (id: string) =>
  api<{ ok: boolean }>(`/admin/keys/${id}/revoke`, { method: 'POST' });

/** Delete a key permanently — only allowed when it's not active (expired/revoked). */
export const deleteKey = (id: string) =>
  api<{ ok: boolean }>(`/admin/keys/${id}`, { method: 'DELETE' });

export const activateKey = (id: string) =>
  api<{ ok: boolean }>(`/admin/keys/${id}/activate`, { method: 'POST' });

/** Convert a key to paid — gets the standard paid window (1 year). */
export const upgradeKey = (id: string) =>
  api<{ ok: boolean }>(`/admin/keys/${id}/upgrade`, { method: 'POST' });

export const getWebhookKeys = () => api<{ keys: WebhookKeyRow[] }>('/admin/webhook-keys');

export const createWebhookKey = (name?: string) =>
  api<{ id: string; key: string }>('/admin/webhook-keys', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });

export const revokeWebhookKey = (id: string) =>
  api<{ ok: boolean }>(`/admin/webhook-keys/${id}/revoke`, { method: 'POST' });

export interface UserRow {
  email: string;
  name: string | null;
  keysTotal: number;
  trial: number;
  paid: number;
  active: number;
  expired: number;
  revoked: number;
  alerts: number;
  firstSeen: string;
  lastRequestAt: string | null;
}

export const getUsers = (params: { q?: string; from?: string; to?: string } = {}) => {
  const sp = new URLSearchParams();
  if (params.q) sp.set('q', params.q);
  if (params.from) sp.set('from', params.from);
  if (params.to) sp.set('to', params.to);
  const qs = sp.toString();
  return api<{ users: UserRow[] }>(`/admin/users${qs ? `?${qs}` : ''}`);
};

export interface UserKeyRow {
  id: string;
  plan: string;
  status: 'active' | 'expired' | 'revoked';
  statusReason: string | null;
  expiresAt: string | null;
  createdAt: string;
  activeInstances: number;
  lastHeartbeatAt: string | null;
  alerts: number;
}

export const getUser = (email: string) =>
  api<{ user: { email: string; name: string | null; keysTotal: number; firstSeen: string; lastRequestAt: string | null }; keys: UserKeyRow[] }>(
    `/admin/users/${encodeURIComponent(email)}`,
  );

/** Download the users CSV (auth header) and trigger a browser save. */
export async function downloadUsersCsv(params: { q?: string; from?: string; to?: string } = {}): Promise<void> {
  const sp = new URLSearchParams();
  if (params.q) sp.set('q', params.q);
  if (params.from) sp.set('from', params.from);
  if (params.to) sp.set('to', params.to);
  const qs = sp.toString();
  const token = localStorage.getItem('wootrico.license-admin.token') ?? '';
  const res = await fetch(`/admin/users/export.csv${qs ? `?${qs}` : ''}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`export_failed_${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'usuarios-wootrico.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export interface StatsReport {
  totals: {
    keys: number;
    active: number;
    trial: number;
    paid: number;
    expired: number;
    revoked: number;
    users: number;
    activeInstances: number;
    ipAlerts: number;
  };
  series: {
    keysPerDay: { day: string; count: number }[];
    validationsPerDay: { day: string; count: number }[];
    paymentsPerDay: { day: string; count: number }[];
  };
}

export const getStats = () => api<StatsReport>('/admin/stats');

export interface ServerLogEntry {
  at: string;
  level: number;
  levelLabel: string;
  msg: string;
  reqId?: string;
  meta?: Record<string, unknown>;
}

export const getServerLogs = (params: { limit?: number; level?: number } = {}) => {
  const sp = new URLSearchParams();
  if (params.limit) sp.set('limit', String(params.limit));
  if (params.level) sp.set('level', String(params.level));
  const qs = sp.toString();
  return api<{ entries: ServerLogEntry[] }>(`/admin/server-logs${qs ? `?${qs}` : ''}`);
};

export interface HealthReport {
  staleHours: number;
  summary: {
    staleInstances: number;
    keysWithIpAlerts: number;
    activeKeys: number;
    trialActive: number;
    paidActive: number;
  };
  stale: Array<{
    licenseKeyId: string;
    instanceId: string;
    email: string | null;
    name: string | null;
    plan: string;
    appVersion: string | null;
    lastIp: string | null;
    lastHeartbeatAt: string | null;
    boundAt: string;
  }>;
  ipAlerts: Array<{
    licenseKeyId: string | null;
    email: string | null;
    name: string | null;
    alerts: number;
    lastAlertAt: string | null;
  }>;
}

export const getHealth = (staleHours?: number) =>
  api<HealthReport>(`/admin/health${staleHours ? `?staleHours=${staleHours}` : ''}`);

// ── Admin-granted licenses (trial or paid, handed to a specific user by e-mail) ──
export interface GrantedLicenseRow {
  id: string;
  plan: 'trial' | 'paid' | string;
  email: string | null;
  name: string | null;
  revoked: boolean;
  expired: boolean;
  expiresAt: string | null;
  claimed: boolean;
  activeInstances: number;
  lastHeartbeatAt: string | null;
  lastIp: string | null;
  createdAt: string;
}

export const getGrantedLicenses = () =>
  api<{ licenses: GrantedLicenseRow[] }>('/admin/free-licenses');

export const grantLicense = (body: { email: string; name?: string; plan?: 'trial' | 'paid' }) =>
  api<{ id: string; email: string | null }>('/admin/free-licenses', {
    method: 'POST',
    body: JSON.stringify(body),
  });

/** Reactivate an expired/revoked trial with a fresh window (+trialDays). */
export const reactivateTrial = (id: string) =>
  api<{ ok: boolean }>(`/admin/keys/${id}/reactivate-trial`, { method: 'POST' });

/** Set/override a paid key's expiry (ISO string). A date is required (no lifetime). */
export const setKeyExpiry = (id: string, expiresAt: string) =>
  api<{ ok: boolean }>(`/admin/keys/${id}/set-expiry`, {
    method: 'POST',
    body: JSON.stringify({ expiresAt }),
  });

// ── Payments ──
export interface PaymentRow {
  id: string;
  transaction: string | null;
  provider: string;
  event: string | null;
  kind: 'purchase' | 'renewal' | 'refund' | 'chargeback' | 'cancel' | string;
  status: string | null;
  email: string | null;
  instanceId: string | null;
  licenseKeyId: string | null;
  amount: number | null;
  currency: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export const getPayments = (
  params: { q?: string; keyId?: string; kind?: string; from?: string; to?: string; before?: string } = {},
) => {
  const sp = new URLSearchParams();
  if (params.q) sp.set('q', params.q);
  if (params.keyId) sp.set('keyId', params.keyId);
  if (params.kind) sp.set('kind', params.kind);
  if (params.from) sp.set('from', params.from);
  if (params.to) sp.set('to', params.to);
  if (params.before) sp.set('before', params.before);
  const qs = sp.toString();
  return api<{ payments: PaymentRow[]; nextBefore: string | null }>(
    `/admin/payments${qs ? `?${qs}` : ''}`,
  );
};

export interface PaymentsSummary {
  totals: {
    revenue: number;
    payments: number;
    purchases: number;
    renewals: number;
    refunds: number;
    paidActive: number;
    expiringSoon: number;
  };
  series: { day: string; count: number; revenue: number }[];
}

export const getPaymentsSummary = () => api<PaymentsSummary>('/admin/payments/summary');

export const getEvents = (
  params: {
    before?: string;
    keyId?: string;
    type?: string;
    from?: string;
    to?: string;
    limit?: number;
  } = {},
) => {
  const q = new URLSearchParams();
  if (params.before) q.set('before', params.before);
  if (params.keyId) q.set('keyId', params.keyId);
  if (params.type) q.set('type', params.type);
  if (params.from) q.set('from', params.from);
  if (params.to) q.set('to', params.to);
  q.set('limit', String(params.limit ?? 50));
  return api<{ events: LicenseEvent[]; nextBefore: string | null }>(`/admin/events?${q.toString()}`);
};

export const getKeyEvents = (id: string) =>
  api<{ events: LicenseEvent[] }>(`/admin/keys/${id}/events`);

export interface ServerSettings {
  logRetentionDays: number | null;
  checkoutUrl: string | null;
  hotmartHottok: string | null;
  hotmartProductId: string | null;
  supportWhatsapp: string | null;
  envDefaults?: {
    checkoutUrl: string | null;
    hotmartHottokSet: boolean;
    hotmartProductId: string | null;
    supportWhatsapp: string | null;
  };
}

export const getSettings = () => api<ServerSettings>('/admin/settings');

export const updateSettings = (body: {
  logRetentionDays: number | null;
  checkoutUrl?: string | null;
  hotmartHottok?: string | null;
  hotmartProductId?: string | null;
  supportWhatsapp?: string | null;
}) => api<{ ok: boolean }>('/admin/settings', { method: 'PUT', body: JSON.stringify(body) });

// ── Support tickets ──
export interface SupportTicket {
  id: string;
  instanceId: string | null;
  licenseKeyId: string | null;
  email: string | null;
  plan: string | null;
  message: string;
  status: 'open' | 'resolved' | string;
  createdAt: string;
  resolvedAt: string | null;
}

export const getSupportTickets = (params: { q?: string; status?: 'open' | 'resolved'; before?: string } = {}) => {
  const sp = new URLSearchParams();
  if (params.q) sp.set('q', params.q);
  if (params.status) sp.set('status', params.status);
  if (params.before) sp.set('before', params.before);
  const qs = sp.toString();
  return api<{ tickets: SupportTicket[]; nextBefore: string | null }>(
    `/admin/support-tickets${qs ? `?${qs}` : ''}`,
  );
};

export const resolveTicket = (id: string) =>
  api<{ ok: boolean }>(`/admin/support-tickets/${id}/resolve`, { method: 'POST' });

export const reopenTicket = (id: string) =>
  api<{ ok: boolean }>(`/admin/support-tickets/${id}/reopen`, { method: 'POST' });
