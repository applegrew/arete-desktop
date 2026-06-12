import type { McpConfig, McpServerEntry, AgentRuntimeOptions } from '@arete-desktop/agent';
import type { Store } from './db';

/** One configurable MCP server: its connection entry plus an enable toggle. */
export interface McpServerSetting {
  name: string;
  enabled: boolean;
  entry: McpServerEntry;
}

/** User-editable agent + workspace settings, persisted in SQLite and read live per turn. */
export interface AgentSettings {
  /** Ollama model name. */
  model: string;
  /** Ollama base URL. */
  ollamaUrl: string;
  /** Configured MCP servers (only `enabled` ones are wired into the agent). */
  mcpServers: McpServerSetting[];
  /** Whether agent diffs are gated (approve/reject) before touching live state. Client-owned. */
  gateDiffs: boolean;
}

/** Baseline settings, seeded from env + the boot-time mcp.json so first run matches prior behavior. */
export function defaultSettings(seedMcp: McpConfig): AgentSettings {
  return {
    model: process.env.OLLAMA_MODEL || 'gemma4:31b-cloud',
    ollamaUrl: process.env.OLLAMA_URL || 'http://localhost:11434',
    mcpServers: Object.entries(seedMcp.mcpServers).map(([name, entry]) => ({ name, enabled: true, entry })),
    gateDiffs: true,
  };
}

/** Stored settings merged over defaults — guarantees a complete object even after partial saves. */
export function resolveSettings(store: Store, seedMcp: McpConfig): AgentSettings {
  const base = defaultSettings(seedMcp);
  const stored = store.getSettings();
  if (!stored) return base;
  return {
    model: typeof stored.model === 'string' ? stored.model : base.model,
    ollamaUrl: typeof stored.ollamaUrl === 'string' ? stored.ollamaUrl : base.ollamaUrl,
    mcpServers: Array.isArray(stored.mcpServers) ? (stored.mcpServers as McpServerSetting[]) : base.mcpServers,
    gateDiffs: typeof stored.gateDiffs === 'boolean' ? stored.gateDiffs : base.gateDiffs,
  };
}

/** Map settings → agent runtime options, keeping only enabled MCP servers. */
export function settingsToRuntimeOptions(s: AgentSettings): Partial<AgentRuntimeOptions> & { mcp: McpConfig } {
  const mcpServers: Record<string, McpServerEntry> = {};
  for (const srv of s.mcpServers) {
    if (srv.enabled) mcpServers[srv.name] = srv.entry;
  }
  return { model: s.model, ollamaUrl: s.ollamaUrl, mcp: { mcpServers } };
}
