import { prisma, type LicenseState } from '@wootrico/db';
import { encrypt, decrypt } from '@wootrico/config';

export async function getLicenseState(): Promise<LicenseState> {
  return prisma.licenseState.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton' },
    update: {},
  });
}

export async function updateLicenseState(
  data: Parameters<typeof prisma.licenseState.update>[0]['data'],
): Promise<LicenseState> {
  return prisma.licenseState.update({ where: { id: 'singleton' }, data });
}

export function decryptLicenseKey(state: LicenseState): string | null {
  return state.licenseKey ? decrypt(state.licenseKey) : null;
}

export function encryptLicenseKey(key: string): string {
  return encrypt(key);
}

/** The primary per-license secret (decrypted) — used to SEAL new integration data. */
export async function getLicenseSecret(): Promise<string | null> {
  const state = await getLicenseState();
  return state.dataKey ? decrypt(state.dataKey) : null;
}

/**
 * All historical per-license secrets (decrypted) for this instance — used to
 * DECRYPT integration data that may have been sealed with any of them (the seal
 * secret rotates on reactivation). Primary first; falls back to [dataKey].
 */
export async function getLicenseSecrets(): Promise<string[]> {
  const state = await getLicenseState();
  const out: string[] = [];
  if (state.dataKeys) {
    try {
      const arr = JSON.parse(decrypt(state.dataKeys)) as unknown;
      if (Array.isArray(arr)) for (const s of arr) if (typeof s === 'string') out.push(s);
    } catch {
      /* ignore */
    }
  }
  if (state.dataKey) {
    const primary = decrypt(state.dataKey);
    if (!out.includes(primary)) out.unshift(primary);
  }
  return out;
}
