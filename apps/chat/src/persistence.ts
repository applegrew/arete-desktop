import type { LayoutDescriptor } from '@arete-desktop/core';

// The desktop shell binds the backend to a free port at runtime and injects the
// origin (e.g. "http://127.0.0.1:53124") as window.__ARETE_API_BASE__ before load.
// Falls back to a same-origin relative base (e.g. plain web/dev-server use).
const API_ORIGIN =
  (typeof window !== 'undefined' && (window as { __ARETE_API_BASE__?: string }).__ARETE_API_BASE__) || '';
const BASE = `${API_ORIGIN}/api`;
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

export interface WidgetHandler {
  /** JS handler body. Runs in the webview's native engine (one runtime). A legacy
   *  persisted `runtime` field may still be present; it is ignored. */
  code: string;
}

/** One captured state of a surface in its generic timeline (see surfaceTimelineRef). */
export interface TimelineEntry {
  /** Monotonic, globally-ordered sequence number across all surfaces. */
  seq: number;
  ts: number;
  /** What produced this state: "agent" | "user-action:<name>" | "handler:<event>" | "restore". */
  trigger: string;
  components: unknown[];
  dataModel?: Record<string, unknown>;
}

export interface ApiSurface {
  surfaceId: string;
  components: unknown[];
  dataModel: Record<string, unknown>;
  updatedAt: number;
  /** Agent-authored action handlers keyed by event name. */
  handlers?: Record<string, WidgetHandler>;
  /** Generic per-surface state timeline (oldest→newest), capped. */
  history?: TimelineEntry[];
}

export interface ApiChatEntry {
  id: string;
  role: string;
  text?: string;
  surfaceId?: string;
  createdAt: number;
}

// Content is scoped per workspace via a `?ws=<id>` query param.
const ws = (workspaceId: string) => `?ws=${encodeURIComponent(workspaceId)}`;

// Pages (the dynamic tab roster) — per workspace
export const loadPages = (workspaceId: string): Promise<ApiPage[]> =>
  jfetch<ApiPage[]>(`${BASE}/pages${ws(workspaceId)}`).catch(() => []);

export const createPage = (workspaceId: string, page: Partial<ApiPage>): Promise<ApiPage> =>
  jfetch<ApiPage>(`${BASE}/pages${ws(workspaceId)}`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(page) });

export const updatePage = (id: string, patch: Partial<ApiPage>): Promise<void> =>
  jfetch(`${BASE}/pages/${id}`, { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(patch) }).then(() => {});

export const deletePage = (id: string): Promise<void> =>
  jfetch(`${BASE}/pages/${id}`, { method: 'DELETE' }).then(() => {});

// Surfaces (rendered-surface store, for restore on reload) — per workspace
export const loadSurfaces = (workspaceId: string): Promise<ApiSurface[]> =>
  jfetch<ApiSurface[]>(`${BASE}/surfaces${ws(workspaceId)}`).catch(() => []);

export const saveSurfaces = (workspaceId: string, surfaces: ApiSurface[]): Promise<void> =>
  jfetch(`${BASE}/surfaces${ws(workspaceId)}`, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(surfaces) }).then(() => {});

// Chat transcript — per workspace
export const loadChat = (workspaceId: string): Promise<ApiChatEntry[]> =>
  jfetch<ApiChatEntry[]>(`${BASE}/chat${ws(workspaceId)}`).catch(() => []);

export const saveChat = (workspaceId: string, entries: ApiChatEntry[]): Promise<void> =>
  jfetch(`${BASE}/chat${ws(workspaceId)}`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(entries) }).then(() => {});

// --- Workspaces (multiple independent chat threads) -----------------------
export interface ApiWorkspace {
  id: string;
  name: string;
  position: number;
  createdAt: number;
  updatedAt: number;
  /** Per-workspace UI state (which tab is active, chat dock state). */
  activeTabId?: string;
  chatDockState?: string;
}

export const loadWorkspaces = (): Promise<{ workspaces: ApiWorkspace[]; activeWorkspaceId: string | null }> =>
  jfetch<{ workspaces: ApiWorkspace[]; activeWorkspaceId: string | null }>(`${BASE}/workspaces`).catch(() => ({
    workspaces: [],
    activeWorkspaceId: null,
  }));

export const createWorkspace = (name?: string): Promise<ApiWorkspace> =>
  jfetch<ApiWorkspace>(`${BASE}/workspaces`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ name }) });

export const updateWorkspace = (
  id: string,
  patch: { name?: string; activeTabId?: string; chatDockState?: string },
): Promise<ApiWorkspace> =>
  jfetch<ApiWorkspace>(`${BASE}/workspaces/${id}`, { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(patch) });

export const deleteWorkspace = (id: string): Promise<{ ok: boolean; activeWorkspaceId: string | null }> =>
  jfetch(`${BASE}/workspaces/${id}`, { method: 'DELETE' });

export const activateWorkspace = (id: string): Promise<{ ok: boolean; activeWorkspaceId: string }> =>
  jfetch(`${BASE}/workspaces/${id}/activate`, { method: 'POST' });

export async function getAgentHealth(): Promise<{ ok: boolean; model?: string; available?: string[] }> {
  try {
    return await jfetch(`${BASE}/agui/health`);
  } catch {
    return { ok: false };
  }
}

// --- Settings (model, Ollama URL, MCP servers, gate-diffs) ----------------
export interface StdioServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}
export interface HttpServerConfig {
  url: string;
  /** Defaults to 'streamable-http' when omitted. */
  transport?: 'streamable-http' | 'sse';
  /** Extra HTTP headers sent on every request (e.g. Authorization, tenant headers). */
  headers?: Record<string, string>;
}
export type McpServerEntry = StdioServerConfig | HttpServerConfig;

export interface McpServerSetting {
  name: string;
  enabled: boolean;
  entry: McpServerEntry;
}

export interface AgentSettings {
  model: string;
  ollamaUrl: string;
  mcpServers: McpServerSetting[];
  gateDiffs: boolean;
}

export const loadSettings = (): Promise<AgentSettings | null> =>
  jfetch<AgentSettings>(`${BASE}/settings`).catch(() => null);

/** Shallow-merge a patch server-side; returns the full merged settings. */
export const saveSettings = (patch: Partial<AgentSettings>): Promise<AgentSettings | null> =>
  jfetch<AgentSettings>(`${BASE}/settings`, {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify(patch),
  }).catch(() => null);

// --- MCP connection status / health ---------------------------------------
export interface McpServerStatus {
  name: string;
  transport: 'stdio' | 'streamable-http' | 'sse';
  connected: boolean;
  toolCount: number;
  tools: string[];
  /** Tool name + description, shown in the expandable connected view. */
  toolDetails?: { name: string; description?: string }[];
  error?: string;
  /** Full failure detail incl. cause chain — shown in the expandable error view. */
  errorDetail?: string;
}

export const getMcpStatus = (): Promise<McpServerStatus[]> =>
  jfetch<McpServerStatus[]>(`${BASE}/agui/mcp-status`).catch(() => []);

/** Force a reconnect of all MCP servers against the live config; returns fresh status. */
export const reconnectMcp = (): Promise<McpServerStatus[]> =>
  jfetch<McpServerStatus[]>(`${BASE}/agui/mcp-reconnect`, { method: 'POST' }).catch(() => []);
