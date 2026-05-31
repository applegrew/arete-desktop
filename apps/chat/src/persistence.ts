import type { LayoutDescriptor } from '@arete-ui/core';

const BASE = '/api';
const JSON_HEADERS = { 'Content-Type': 'application/json' };

async function jfetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export interface ApiPage {
  id: string;
  title: string;
  /** Emoji or text icon displayed on the tab. Defaults to 📄. */
  icon?: string;
  /** Accent color shown as a left-edge strip on the tab button. */
  color?: string;
  layout: LayoutDescriptor;
  mapping: Record<string, string>;
  position: number;
  createdAt: number;
  updatedAt: number;
}

export interface ApiSurface {
  surfaceId: string;
  components: unknown[];
  dataModel: Record<string, unknown>;
  updatedAt: number;
}

export interface ApiChatEntry {
  id: string;
  role: string;
  text?: string;
  surfaceId?: string;
  createdAt: number;
}

// Pages (the dynamic tab roster)
export const loadPages = (): Promise<ApiPage[]> =>
  jfetch<ApiPage[]>(`${BASE}/pages`).catch(() => []);

export const createPage = (page: Partial<ApiPage>): Promise<ApiPage> =>
  jfetch<ApiPage>(`${BASE}/pages`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(page) });

export const updatePage = (id: string, patch: Partial<ApiPage>): Promise<void> =>
  jfetch(`${BASE}/pages/${id}`, { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(patch) }).then(() => {});

export const deletePage = (id: string): Promise<void> =>
  jfetch(`${BASE}/pages/${id}`, { method: 'DELETE' }).then(() => {});

// Surfaces (global rendered-surface store, for restore on reload)
export const loadSurfaces = (): Promise<ApiSurface[]> =>
  jfetch<ApiSurface[]>(`${BASE}/surfaces`).catch(() => []);

export const saveSurfaces = (surfaces: ApiSurface[]): Promise<void> =>
  jfetch(`${BASE}/surfaces`, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(surfaces) }).then(() => {});

// Chat transcript
export const loadChat = (): Promise<ApiChatEntry[]> =>
  jfetch<ApiChatEntry[]>(`${BASE}/chat`).catch(() => []);

export const saveChat = (entries: ApiChatEntry[]): Promise<void> =>
  jfetch(`${BASE}/chat`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(entries) }).then(() => {});

// App state (active tab, chat dock)
export const loadState = (): Promise<Record<string, unknown>> =>
  jfetch<Record<string, unknown>>(`${BASE}/state`).catch(() => ({}));

export const saveState = (state: Record<string, unknown>): Promise<void> =>
  jfetch(`${BASE}/state`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(state) }).then(() => {});

export async function getAgentHealth(): Promise<{ ok: boolean; model?: string }> {
  try {
    return await jfetch(`${BASE}/agui/health`);
  } catch {
    return { ok: false };
  }
}
