const BASE = '/api';

async function fetchJson<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

export interface PersistedChatEntry {
  id: string;
  role: string;
  text: string;
  surfaceId?: string;
  createdAt: number;
}

export async function loadState(): Promise<Record<string, unknown>> {
  try {
    return await fetchJson(`${BASE}/state`);
  } catch {
    return {};
  }
}

export async function saveState(state: Record<string, unknown>): Promise<void> {
  await fetchJson(`${BASE}/state`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(state),
  });
}

export async function loadChat(): Promise<PersistedChatEntry[]> {
  try {
    const rows = await fetchJson<Array<Record<string, unknown>>>(`${BASE}/chat`);
    return rows.map((r) => ({
      id: r.id as string,
      role: r.role as string,
      text: (r.text as string) ?? '',
      surfaceId: (r.surface_id ?? undefined) as string | undefined,
      createdAt: r.created_at as number,
    }));
  } catch {
    return [];
  }
}

export async function saveChat(entries: PersistedChatEntry[]): Promise<void> {
  await fetchJson(`${BASE}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entries),
  });
}

export async function appendApproval(entry: {
  kind?: string;
  surfaceId?: string;
  pageId?: string;
  opName?: string;
  decision: string;
  diffJson: unknown;
  createdAt?: number;
}): Promise<void> {
  await fetchJson(`${BASE}/approvals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entry),
  });
}
