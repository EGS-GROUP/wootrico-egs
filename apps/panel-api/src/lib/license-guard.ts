import { assertLicenseActive } from '@wootrico/license-client';

/**
 * Whether the customer may currently create or activate integrations. Mirrors
 * the message-processing gate: when the license is not active, managing
 * integrations is blocked (the customer can still view existing data).
 */
export async function canManageIntegrations(): Promise<{ allowed: boolean; status: string }> {
  return assertLicenseActive();
}

/**
 * Whether the customer may use functional features that depend on an active
 * license (e.g. exporting captured conversations). Without an active license the
 * customer can still change settings, but cannot use these features.
 */
export async function requireActiveLicense(): Promise<{ allowed: boolean; status: string }> {
  return assertLicenseActive();
}
