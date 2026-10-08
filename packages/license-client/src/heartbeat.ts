import { env, LICENSE, logger, encrypt } from '@wootrico/config';
import { prisma } from '@wootrico/db';
import {
  decryptLicenseKey,
  encryptLicenseKey,
  getLicenseSecret,
  getLicenseState,
  updateLicenseState,
} from './store.js';
import { evaluateLicense } from './state-machine.js';

async function telemetry() {
  const integrationCount = await prisma.integration.count().catch(() => 0);
  return { appVersion: env.APP_VERSION, integrationCount };
}

/**
 * Return the per-license secret, fetching it on demand (a single validate) when
 * it's missing — e.g. an instance that was licensed before the secret feature
 * existed, before its next scheduled validation. Returns null if the instance
 * isn't actually licensed (the server won't hand a secret over).
 */
export async function ensureLicenseSecret(): Promise<string | null> {
  const existing = await getLicenseSecret();
  if (existing) return existing;
  await runHeartbeat().catch(() => undefined);
  return getLicenseSecret();
}

interface ValidateResponse {
  active?: boolean;
  plan?: string | null;
  expiresAt?: string | null;
  reason?: string;
  key?: string; // server delivers a newly minted key (e.g. paid upgrade) to swap in
  features?: Record<string, unknown>;
  secret?: string | null;
  secrets?: string[] | null;
  supportWhatsapp?: string | null;
  error?: string;
}

/** Apply ±jitter so instances don't all phone home at the same instant. */
function jittered(ms: number): number {
  const spread = ms * LICENSE.validateJitterRatio;
  return Math.round(ms - spread + Math.random() * spread * 2);
}

/** Backoff delay after N consecutive unreachable checks: 6h → 12h → 24h (capped). */
function backoffMs(failures: number): number {
  const ms = LICENSE.validateIntervalMs * 2 ** Math.max(0, failures - 1);
  return Math.min(ms, LICENSE.validateBackoffMaxMs);
}

/**
 * Periodic online validation. Asks the server "is my key still active?" and
 * caches the answer. Picks up a server-delivered key swap (paid upgrade after a
 * payment) automatically.
 *
 * Failure policy: an unreachable server or a non-OK response is non-fatal here —
 * we record the error, back off the next attempt, and leave `status`/
 * `lastValidatedAt` untouched. The state machine keeps serving the key through a
 * tolerated outage and only blocks once 48h pass with no successful validation
 * (recoverable). An explicit `active: false` from the server blocks immediately.
 */
export async function runHeartbeat(): Promise<{ status: string }> {
  const state = await getLicenseState();
  const key = decryptLicenseKey(state);
  if (!key || !state.instanceId) {
    return { status: state.status };
  }

  try {
    const res = await fetch(`${env.LICENSE_SERVER_URL}/validate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key, instanceId: state.instanceId, telemetry: await telemetry() }),
    });
    const data = (await res.json().catch(() => ({}))) as ValidateResponse;

    if (res.ok && data.active) {
      const now = new Date();
      await updateLicenseState({
        // Server delivered a new key (paid upgrade) → swap it in.
        ...(data.key ? { licenseKey: encryptLicenseKey(data.key) } : {}),
        ...(data.secret ? { dataKey: encrypt(data.secret) } : {}),
        ...(data.secrets?.length ? { dataKeys: encrypt(JSON.stringify(data.secrets)) } : {}),
        plan: data.plan ?? state.plan ?? null,
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
        status: 'active',
        lastHeartbeatAt: now,
        lastValidatedAt: now,
        nextHeartbeatAt: new Date(now.getTime() + jittered(LICENSE.validateIntervalMs)),
        heartbeatFailures: 0,
        features: (data.features ?? state.features ?? {}) as object,
        supportWhatsapp: data.supportWhatsapp ?? state.supportWhatsapp ?? null,
        lastError: null,
      });
      return { status: 'active' };
    }

    if (res.ok && data.active === false) {
      // Explicit, authoritative "no" from the server — the ONLY thing that blocks.
      // Capture the reason AND the server's plan/expiry so the panel can tell an
      // expired/revoked key apart from an offline outage and offer buy/renew.
      const now = new Date();
      await updateLicenseState({
        status: 'blocked',
        lastError: data.reason ?? 'inactive',
        ...(data.plan ? { plan: data.plan } : {}),
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
        lastHeartbeatAt: now,
        nextHeartbeatAt: new Date(now.getTime() + jittered(LICENSE.validateIntervalMs)),
        heartbeatFailures: 0,
      });
      logger.warn({ reason: data.reason }, 'license inactive per server');
      return { status: 'blocked' };
    }

    // Reachable but errored (5xx/garbage): treat like an outage — back off, don't block.
    await recordUnreachable(state, `validate_${res.status}`);
  } catch (err) {
    // Network failure / wrong URL / DNS — NON-FATAL. Back off, keep the key valid.
    await recordUnreachable(state, (err as Error).message);
    logger.warn({ err }, 'license validation failed (non-fatal; key stays valid)');
  }

  // Recompute for display only — this can move to 'warning' but never to 'blocked'.
  const status = await evaluateLicense();
  return { status };
}

/** Record a failed (unreachable) check: bump the failure counter and back off. */
async function recordUnreachable(state: { heartbeatFailures: number }, error: string): Promise<void> {
  const now = new Date();
  const failures = (state.heartbeatFailures ?? 0) + 1;
  await updateLicenseState({
    lastError: error,
    lastHeartbeatAt: now,
    heartbeatFailures: failures,
    nextHeartbeatAt: new Date(now.getTime() + jittered(backoffMs(failures))),
  });
}

/**
 * Run a heartbeat only if one is actually due (`nextHeartbeatAt` has passed).
 * The worker calls this on a cheap tick, so a recently-validated instance makes
 * no network call — and a backed-off one waits out its longer interval. Returns
 * null when nothing was due or there's no key yet.
 */
export async function maybeRunHeartbeat(now = new Date()): Promise<{ status: string } | null> {
  const state = await getLicenseState();
  if (!decryptLicenseKey(state) || !state.instanceId) return null;
  if (state.nextHeartbeatAt && now.getTime() < state.nextHeartbeatAt.getTime()) return null;
  return runHeartbeat();
}
