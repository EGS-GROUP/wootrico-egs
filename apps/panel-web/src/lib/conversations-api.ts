import { api, getToken } from './api-client';

export interface ConversationDTO {
  id: string;
  name: string | null;
  number: string | null;
  isGroup: boolean;
  /** Latest-message gist (truncated) — to know what the conversation is about. */
  preview: string | null;
  integration: string | null;
  messageCount: number;
  startedAt: string;
  lastMessageAt: string;
}

export interface ConversationMessage {
  at: string;
  direction: 'incoming' | 'outgoing';
  sender: string | null;
  type: string;
  /** Truncated for display (the full text is only in the export). */
  text: string;
}

export interface ConversationDetail {
  id: string;
  name: string | null;
  number: string | null;
  isGroup: boolean;
  integration: string | null;
  startedAt: string;
  messages: ConversationMessage[];
}

export interface ConversationsPage {
  conversations: ConversationDTO[];
  total: number;
  page: number;
  pageSize: number;
}

export const listConversations = (
  opts: { search?: string; from?: string; to?: string; page?: number; pageSize?: number } = {},
) => {
  const p = new URLSearchParams();
  if (opts.search) p.set('search', opts.search);
  if (opts.from) p.set('from', opts.from);
  if (opts.to) p.set('to', opts.to);
  if (opts.page) p.set('page', String(opts.page));
  if (opts.pageSize) p.set('pageSize', String(opts.pageSize));
  const qs = p.toString();
  return api<ConversationsPage>(`/api/conversations${qs ? `?${qs}` : ''}`);
};

/** Partial history of one conversation (clicked in the list). */
export const getConversation = (id: string) =>
  api<ConversationDetail>(`/api/conversations/${id}`);

/** Download the export as JSON or TXT — selected ids, or all matching the filter. */
export async function exportConversations(
  format: 'json' | 'txt',
  opts: { ids?: string[]; search?: string; from?: string; to?: string } = {},
): Promise<void> {
  const p = new URLSearchParams();
  p.set('format', format);
  if (opts.ids && opts.ids.length) p.set('ids', opts.ids.join(','));
  else {
    if (opts.search) p.set('search', opts.search);
    if (opts.from) p.set('from', opts.from);
    if (opts.to) p.set('to', opts.to);
  }
  const token = getToken();
  const res = await fetch(`/api/conversations/export?${p.toString()}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    cache: 'no-store',
  });
  if (!res.ok) throw new Error('export_failed');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `conversas-${new Date().toISOString().slice(0, 10)}.${format}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
