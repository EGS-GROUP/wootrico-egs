import type { ProviderConfig } from '@wootrico/types';
import type { WhatsAppProvider } from './provider.interface.js';
import { UazapiProvider } from './uazapi/client.js';
import { ZapiProvider } from './zapi/client.js';
import { EvolutionProvider } from './evolution/client.js';

/** Build a provider instance from a decrypted provider config. */
export function createProvider(config: ProviderConfig): WhatsAppProvider {
  switch (config.provider) {
    case 'uazapi':
      return new UazapiProvider(config);
    case 'zapi':
      return new ZapiProvider(config);
    case 'evolution':
      return new EvolutionProvider(config);
  }
}
