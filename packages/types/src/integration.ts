import { z } from 'zod';
import { CONVERSATION_STATUSES, PROVIDER_TYPES } from '@wootrico/config';
import { ProviderConfigSchema } from './provider-config.js';

const chatwootBase = {
  chatwootBaseUrl: z.string().url(),
  chatwootApiToken: z.string().min(1),
  chatwootAccountId: z.string().min(1),
  chatwootInboxName: z.string().min(1),
  conversationStatus: z.enum(CONVERSATION_STATUSES).default('open'),
  reabrirConversa: z.boolean().default(true),
  desconsiderarGrupo: z.boolean().default(true),
  assinarMensagem: z.boolean().default(true),
  defaultCountry: z.string().length(2).default('BR'),
  /** When the named inbox does not exist, create it (API channel) automatically. */
  createInboxIfMissing: z.boolean().default(true),
};

/** Check whether a Chatwoot inbox already exists (before saving). */
export const CheckInboxSchema = z.object({
  chatwootBaseUrl: z.string().url(),
  chatwootApiToken: z.string().min(1),
  chatwootAccountId: z.string().min(1),
  chatwootInboxName: z.string().min(1),
});
export type CheckInboxInput = z.infer<typeof CheckInboxSchema>;

/** Create-integration DTO from the panel. */
export const CreateIntegrationSchema = z.object({
  name: z.string().min(1),
  isEnabled: z.boolean().default(true),
  providerType: z.enum(PROVIDER_TYPES),
  providerConfig: ProviderConfigSchema,
  ...chatwootBase,
});
export type CreateIntegrationInput = z.infer<typeof CreateIntegrationSchema>;

/** Update DTO — everything optional except identity is via URL param. */
export const UpdateIntegrationSchema = CreateIntegrationSchema.partial();
export type UpdateIntegrationInput = z.infer<typeof UpdateIntegrationSchema>;

/** Connection-test request (Chatwoot side, before saving). */
export const TestChatwootSchema = z.object({
  chatwootBaseUrl: z.string().url(),
  chatwootApiToken: z.string().min(1),
  chatwootAccountId: z.string().min(1),
});
export type TestChatwootInput = z.infer<typeof TestChatwootSchema>;

/** Connection-test request (provider side, before saving). */
export const TestProviderSchema = ProviderConfigSchema;
export type TestProviderInput = z.infer<typeof TestProviderSchema>;
