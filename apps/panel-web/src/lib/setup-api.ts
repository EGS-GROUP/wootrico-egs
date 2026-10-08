import { api } from './api-client';

export interface SetupStatus {
  hasAdmin: boolean;
  setupCompleted: boolean;
}

export const getSetupStatus = () => api<SetupStatus>('/api/setup/status');

export const setBaseUrl = (publicBaseUrl: string) =>
  api<{ publicBaseUrl: string }>('/api/setup/base-url', {
    method: 'POST',
    body: JSON.stringify({ publicBaseUrl }),
  });

export const completeSetup = () =>
  api<{ setupCompleted: boolean }>('/api/setup/complete', { method: 'POST' });
