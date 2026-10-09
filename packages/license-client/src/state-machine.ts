import { LICENSE, type LicenseStatus } from '@wootrico/config';
import type { LicenseState } from '@wootrico/db';
import { getLicenseState, updateLicenseState } from './store.js';

/**
 * Pure status computation from stored state + current time.
 *
 * A license blocks when: (a) the server EXPLICITLY answered "inactive"
 * (`status: 'blocked'`, sticky until re-validated), (b) a trial ran out by the
 * local clock, or (c) the server has been unreachable past the 48h offline grace
 * — this last one stops "validate once, then disconnect to run free" abuse. A
 * shorter outage only downgrades to a soft `warning`; the block in (c) is
 * RECOVERABLE the moment the server answers "active" again.
 */
export function computeStatus(state: LicenseState, now = new Date()): LicenseStatus {
  if (process.env.LICENSE_DEV_MODE === 'true') return 'active';
  if (state.status === 'blocked') return 'blocked'; // server said inactive — sticky until re-validated
  if (!state.licenseKey || !state.instanceId) return 'unactivated';

  const isPerpetual =
    state.plan === 'community' ||
    state.plan === 'developer' ||
    (state.plan === 'paid' && !state.expiresAt);

  // Key ran out by the local clock — trial (14d) OR paid (1y).
  // Perpetual keys (community / developer / perpetual paid) have no expiry restriction.
  if (!isPerpetual && state.expiresAt && now.getTime() >= state.expiresAt.getTime()) {
    return 'blocked';
  }

  // Perpetual licenses never degrade to warning or block on offline timeouts (air-gapped / dev safe)
  if (isPerpetual) return 'active';

  if (!state.lastValidatedAt) {
    // A key exists but was never confirmed online (fresh migration / mid-rollout).
    // Allow it as 'warning' until the next validation runs.
    return state.status === 'active' ? 'warning' : 'unactivated';
  }

  const since = now.getTime() - state.lastValidatedAt.getTime();
  if (since > LICENSE.offlineGraceMs) return 'blocked';
  if (since > LICENSE.staleWarningMs) return 'warning';
  return 'active';
}

/** Recompute, persist when it changes, and return the status. */
export async function evaluateLicense(now = new Date()): Promise<LicenseStatus> {
  const state = await getLicenseState();
  const status = computeStatus(state, now);
  if (status !== state.status) await updateLicenseState({ status });
  return status;
}

/**
 * Whether message processing is allowed for the given status. Licensing is
 * ALWAYS enforced (no opt-out): an unactivated or blocked instance cannot
 * process — only active/warning may (or when running in LICENSE_DEV_MODE).
 */
export function isProcessingAllowed(status: LicenseStatus): boolean {
  if (process.env.LICENSE_DEV_MODE === 'true') return true;
  return status === 'active' || status === 'warning';
}

/** Convenience gate used by ingress + worker. */
export async function assertLicenseActive(): Promise<{ allowed: boolean; status: LicenseStatus }> {
  const status = await evaluateLicense();
  return { allowed: isProcessingAllowed(status), status };
}
