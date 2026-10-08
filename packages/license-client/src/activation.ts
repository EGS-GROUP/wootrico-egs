import { env, LICENSE, encrypt } from '@wootrico/config';
import { prisma } from '@wootrico/db';
import { getOrCreateInstanceId } from './fingerprint.js';
import { encryptLicenseKey, getLicenseState, updateLicenseState, decryptLicenseKey } from './store.js';

export class LicenseError extends Error {}

async function resolvePublicBaseUrl(): Promise<string> {
  const s = await prisma.appSettings.findUnique({ where: { id: 'singleton' } });
  return s?.publicBaseUrl ?? env.PUBLIC_BASE_URL;
}

export interface ActivationResult {
  status: 'active';
  plan: string | null;
  expiresAt: Date | null;
  features: Record<string, unknown>;
  instanceId: string;
}

interface LicenseResponse {
  key?: string;
  active?: boolean;
  plan?: string | null;
  expiresAt?: string | null;
  reason?: string;
  error?: string;
  features?: Record<string, unknown>;
  secret?: string | null;
  secrets?: string[] | null;
  reused?: boolean;
}

/** Persist a successful provision/activate response and return the result. */
async function applyLicenseResponse(
  data: LicenseResponse,
  instanceId: string,
  opts: { storeKey?: string },
): Promise<ActivationResult> {
  const now = new Date();
  const expiresAt = data.expiresAt ? new Date(data.expiresAt) : null;
  await updateLicenseState({
    ...(opts.storeKey ? { licenseKey: encryptLicenseKey(opts.storeKey) } : {}),
    ...(data.secret ? { dataKey: encrypt(data.secret) } : {}),
    ...(data.secrets?.length ? { dataKeys: encrypt(JSON.stringify(data.secrets)) } : {}),
    instanceId,
    plan: data.plan ?? null,
    expiresAt,
    status: 'active',
    features: (data.features ?? {}) as object,
    lastHeartbeatAt: now,
    lastValidatedAt: now,
    nextHeartbeatAt: new Date(now.getTime() + LICENSE.validateIntervalMs),
    heartbeatFailures: 0,
    lastError: null,
  });
  return {
    status: 'active',
    plan: data.plan ?? null,
    expiresAt,
    features: (data.features ?? {}) as Record<string, unknown>,
    instanceId,
  };
}

/**
 * Self-service provisioning: ask the license server to mint AND bind a key for
 * this instance in one online call, identified by the user's name/email. The
 * raw key is returned once (omitted on reuse) and stored encrypted locally.
 * A trial is granted only ONCE per instance — after it expires the server
 * refuses (reason `trial_expired`) and the user must buy a definitive license.
 */
export async function provisionLicense(owner: {
  name?: string | null;
  email?: string | null;
}): Promise<ActivationResult> {
  const instanceId = await getOrCreateInstanceId();

  let res: Response;
  try {
    res = await fetch(`${env.LICENSE_SERVER_URL}/provision`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: owner.name ?? undefined,
        email: owner.email ?? undefined,
        instanceId,
        appVersion: env.APP_VERSION,
        publicBaseUrl: await resolvePublicBaseUrl(),
      }),
    });
  } catch (err) {
    throw new LicenseError(`license server unreachable: ${(err as Error).message}`);
  }

  const data = (await res.json().catch(() => ({}))) as LicenseResponse;
  if (!res.ok || !data.active) {
    throw new LicenseError(data.error ?? data.reason ?? `provision_failed_${res.status}`);
  }
  // On reuse the server omits `key`; keep whatever is already stored.
  return applyLicenseResponse(data, instanceId, { storeKey: data.key });
}

/** Activate an existing license key against the central server (online, once). */
export async function activateLicense(licenseKey: string): Promise<ActivationResult> {
  const instanceId = await getOrCreateInstanceId();

  let res: Response;
  try {
    res = await fetch(`${env.LICENSE_SERVER_URL}/activate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        key: licenseKey,
        instanceId,
        appVersion: env.APP_VERSION,
        publicBaseUrl: await resolvePublicBaseUrl(),
      }),
    });
  } catch (err) {
    throw new LicenseError(`license server unreachable: ${(err as Error).message}`);
  }

  const data = (await res.json().catch(() => ({}))) as LicenseResponse;
  if (!res.ok || !data.active) {
    throw new LicenseError(data.error ?? data.reason ?? `activation_failed_${res.status}`);
  }
  return applyLicenseResponse(data, instanceId, { storeKey: licenseKey });
}

/**
 * Register a purchase intent for this installation and return the external
 * checkout URL (if configured). The payment webhook later settles the most
 * recent pending intent for the buyer's email and delivers a paid key.
 */
export async function requestPurchase(email?: string | null): Promise<{ checkoutUrl: string | null }> {
  const state = await getLicenseState();
  const key = decryptLicenseKey(state);
  if (!key || !state.instanceId) throw new LicenseError('no_license_to_upgrade');

  let res: Response;
  try {
    res = await fetch(`${env.LICENSE_SERVER_URL}/purchase-intent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key, instanceId: state.instanceId, email: email ?? undefined }),
    });
  } catch (err) {
    throw new LicenseError(`license server unreachable: ${(err as Error).message}`);
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string; checkoutUrl?: string };
  if (!res.ok) {
    throw new LicenseError(data.error ?? `purchase_intent_failed_${res.status}`);
  }
  // The license server returns the checkout URL (Hotmart link + intent as `sck`),
  // so the vendor controls it centrally. Fall back to the local env if absent.
  return { checkoutUrl: data.checkoutUrl ?? env.LICENSE_CHECKOUT_URL ?? null };
}

/**
 * Open a support ticket on the license server (registered regardless of license
 * status). Returns the support WhatsApp number so the panel can redirect a
 * paid-active customer to it.
 */
export async function submitSupportTicket(
  message: string,
  email?: string | null,
): Promise<{ ok: boolean; supportWhatsapp: string | null }> {
  const state = await getLicenseState();
  const key = decryptLicenseKey(state);
  if (!key || !state.instanceId) throw new LicenseError('not_activated');

  let res: Response;
  try {
    res = await fetch(`${env.LICENSE_SERVER_URL}/support-ticket`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key, instanceId: state.instanceId, email: email ?? undefined, message }),
    });
  } catch (err) {
    throw new LicenseError(`license server unreachable: ${(err as Error).message}`);
  }
  const data = (await res.json().catch(() => ({}))) as {
    error?: string;
    supportWhatsapp?: string | null;
  };
  if (!res.ok) throw new LicenseError(data.error ?? `support_failed_${res.status}`);
  return { ok: true, supportWhatsapp: data.supportWhatsapp ?? state.supportWhatsapp ?? null };
}

/** Release the binding so the key can be moved to another instance. */
export async function deactivateLicense(): Promise<void> {
  const state = await getLicenseState();
  const key = decryptLicenseKey(state);
  if (key && state.instanceId) {
    await fetch(`${env.LICENSE_SERVER_URL}/deactivate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key, instanceId: state.instanceId }),
    }).catch(() => undefined);
  }
  await updateLicenseState({
    licenseKey: null,
    plan: null,
    expiresAt: null,
    status: 'unactivated',
    lastValidatedAt: null,
    lastError: null,
  });
}
