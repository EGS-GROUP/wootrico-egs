import { api, getToken } from './api-client';

export interface ContactDTO {
  /** Derived WhatsApp JID (phone-based, or LID address when only the LID is known). */
  jid: string | null;
  /** LID number, without the @lid suffix. */
  lid: string | null;
  /** Phone number digits, without the @s.whatsapp.net suffix. */
  pn: string | null;
  /** WhatsApp display (push) name. */
  pushName: string | null;
  /** True when the avatar bytes are stored (served by the panel; never expires). */
  hasAvatar: boolean;
  /** Stored-at epoch ms — used to cache-bust the avatar when it changes. */
  avatarVersion: number | null;
  /** Raw WhatsApp URL — fallback while bytes aren't stored yet (may expire). */
  avatarUrl: string | null;
  /** Observed in a direct (1:1) conversation. */
  seenInDm: boolean;
  /** Observed as a participant of a group (sender or seeded from the roster). */
  seenInGroup: boolean;
  /** Name of the most recent group this contact was seen in (null for DM-only). */
  groupName: string | null;
  createdAt: string;
  updatedAt: string;
  lastSeenAt: string | null;
}

export interface ContactsPage {
  contacts: ContactDTO[];
  total: number;
  page: number;
  pageSize: number;
}

export const listContacts = (opts: { search?: string; page?: number; pageSize?: number } = {}) => {
  const p = new URLSearchParams();
  if (opts.search) p.set('search', opts.search);
  if (opts.page) p.set('page', String(opts.page));
  if (opts.pageSize) p.set('pageSize', String(opts.pageSize));
  const qs = p.toString();
  return api<ContactsPage>(`/api/contacts${qs ? `?${qs}` : ''}`);
};

/**
 * Fetch a contact's avatar (auth-aware) and return a blob URL — the endpoint
 * needs the Bearer token, so a plain <img src> won't do. Keyed by lid/pn.
 * Returns null when there's no avatar (404). Caller should revoke the URL.
 */
export async function fetchContactAvatarUrl(
  lid: string | null,
  pn: string | null,
): Promise<string | null> {
  const p = new URLSearchParams();
  if (lid) p.set('lid', lid);
  else if (pn) p.set('pn', pn);
  else return null;
  const token = getToken();
  const res = await fetch(`/api/contacts/avatar?${p.toString()}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    cache: 'no-store',
  });
  if (!res.ok) return null;
  return URL.createObjectURL(await res.blob());
}

/**
 * Download the full directory as CSV (honours the search filter). Uses fetch +
 * blob because the endpoint needs the Bearer token, so a plain <a href> won't do.
 */
export async function exportContacts(search?: string): Promise<void> {
  const p = new URLSearchParams();
  if (search) p.set('search', search);
  const qs = p.toString();
  const token = getToken();
  const res = await fetch(`/api/contacts/export${qs ? `?${qs}` : ''}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    cache: 'no-store',
  });
  if (!res.ok) throw new Error('export_failed');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'contatos.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
