import { api } from './api-client';

export interface IntegrationDTO {
  id: string;
  name: string;
  isEnabled: boolean;
  providerType: 'uazapi' | 'zapi' | 'evolution';
  status: 'unconfigured' | 'ok' | 'error';
  chatwoot: { baseUrl: string; accountId: string; inboxName: string; inboxId: string | null };
  flags: {
    conversationStatus: 'open' | 'resolved' | 'pending';
    reabrirConversa: boolean;
    desconsiderarGrupo: boolean;
    assinarMensagem: boolean;
    defaultCountry: string;
  };
  webhookUrls: { provider: string; chatwoot: string };
  createdAt: string;
  updatedAt: string;
}

export const listIntegrations = () =>
  api<{ integrations: IntegrationDTO[] }>('/api/integrations').then((r) => r.integrations);

export interface IntegrationSecrets {
  chatwootApiToken?: string;
  providerConfig?: {
    provider: 'uazapi' | 'zapi' | 'evolution';
    baseUrl?: string;
    token?: string;
    apiKey?: string;
    instance?: string;
    clientToken?: string;
    whatsappNumber?: string;
  } | null;
}

export const getIntegration = (id: string) =>
  api<{ integration: IntegrationDTO; secrets?: IntegrationSecrets }>(`/api/integrations/${id}`);

export interface InboxResult {
  action: 'created' | 'webhook_updated' | 'manual_required' | 'not_created' | 'unchanged' | 'error';
  channelType: string | null;
  error?: string;
}

export interface SaveResult {
  integration: IntegrationDTO;
  inbox: InboxResult;
}

export const createIntegration = (body: unknown) =>
  api<SaveResult>('/api/integrations', {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const updateIntegration = (id: string, body: unknown) =>
  api<SaveResult>(`/api/integrations/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });

export interface InboxCheck {
  exists: boolean;
  channelType: string | null;
  isApi: boolean;
  inboxId: string | null;
}

export const checkInbox = (body: unknown) =>
  api<InboxCheck>('/api/integrations/inbox/check', {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const deleteIntegration = (id: string) =>
  api<void>(`/api/integrations/${id}`, { method: 'DELETE' });

export const testChatwoot = (body: unknown) =>
  api<{ ok: boolean; detail?: string }>('/api/integrations/test/chatwoot', {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const testProvider = (body: unknown) =>
  api<{ ok: boolean; detail?: string }>('/api/integrations/test/provider', {
    method: 'POST',
    body: JSON.stringify(body),
  });
