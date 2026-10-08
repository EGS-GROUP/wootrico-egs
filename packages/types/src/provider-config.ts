import { z } from 'zod';

/** Provider-specific credential schemas (stored encrypted in provider_configs.config). */

export const UazapiConfigSchema = z.object({
  provider: z.literal('uazapi'),
  baseUrl: z.string().url(),
  token: z.string().min(1),
  whatsappNumber: z.string().min(5), // digits, used as routing identifier
});
export type UazapiConfig = z.infer<typeof UazapiConfigSchema>;

export const ZapiConfigSchema = z.object({
  provider: z.literal('zapi'),
  instance: z.string().min(1),
  token: z.string().min(1),
  clientToken: z.string().min(1),
  /** Override the API host (defaults to https://api.z-api.io). Useful for proxies. */
  baseUrl: z.string().url().optional(),
});
export type ZapiConfig = z.infer<typeof ZapiConfigSchema>;

export const EvolutionConfigSchema = z.object({
  provider: z.literal('evolution'),
  baseUrl: z.string().url(),
  apiKey: z.string().min(1),
  // Evolution GO identifies the instance by the API key, so the instance name is
  // optional (kept only for backward compatibility / display).
  instance: z.string().optional(),
});
export type EvolutionConfig = z.infer<typeof EvolutionConfigSchema>;

export const ProviderConfigSchema = z.discriminatedUnion('provider', [
  UazapiConfigSchema,
  ZapiConfigSchema,
  EvolutionConfigSchema,
]);
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

/** The plaintext, indexed routing identifier derived from a provider config. */
export function providerIdentifier(config: ProviderConfig): string {
  switch (config.provider) {
    case 'uazapi':
      return config.whatsappNumber.replace(/\D/g, '');
    case 'zapi':
      return config.instance;
    case 'evolution':
      // The API key is the real instance identifier in Evolution GO.
      return config.instance || config.apiKey;
  }
}
