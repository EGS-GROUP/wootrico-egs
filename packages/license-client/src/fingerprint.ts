import { randomUUID } from 'node:crypto';
import { getLicenseState, updateLicenseState } from './store.js';

/**
 * Stable per-install instance id, persisted in license_state. DB-backed (not a
 * hardware fingerprint) so it survives container restarts but is unique per
 * install/volume — this is what binds a license to one instance.
 */
export async function getOrCreateInstanceId(): Promise<string> {
  const state = await getLicenseState();
  if (state.instanceId) return state.instanceId;
  const instanceId = randomUUID();
  await updateLicenseState({ instanceId });
  return instanceId;
}
