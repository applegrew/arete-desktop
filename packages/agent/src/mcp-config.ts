import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface StdioServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface HttpServerConfig {
  url: string;
  transport: 'streamable-http' | 'sse';
}

export type McpServerEntry = StdioServerConfig | HttpServerConfig;

export interface McpConfig {
  mcpServers: Record<string, McpServerEntry>;
}

function isHttpConfig(e: McpServerEntry): e is HttpServerConfig {
  return 'url' in e;
}

/**
 * Load MCP configuration in priority order:
 * 1. ARETE_MCP_CONFIG env var → path to a JSON config file
 * 2. mcp.json in cwd
 * 3. Fallback hermetic demo server (backward compat)
 *
 * Per-server env overrides: ARETE_MCP_<UPPER_NAME>_ENV_KEY=VALUE
 * maps to env: { KEY: 'VALUE' } for that server.
 */
export function loadMcpConfig(opts?: { configPath?: string; skillsDir?: string }): McpConfig {
  const path = opts?.configPath || process.env.ARETE_MCP_CONFIG;
  if (path) {
    const resolved = resolve(path);
    if (existsSync(resolved)) {
      return applyEnvOverrides(parseConfig(readFileSync(resolved, 'utf-8')));
    }
    console.warn(`[mcp] config file not found: ${resolved}`);
  }

  const cwdPath = resolve(process.cwd(), 'mcp.json');
  if (existsSync(cwdPath)) {
    return applyEnvOverrides(parseConfig(readFileSync(cwdPath, 'utf-8')));
  }

  return getFallbackConfig();
}

/** Current config state, lazily populated so skills can register built-in tools too. */
let currentConfig: McpConfig | null = null;

export function setMcpConfig(config: McpConfig): void {
  currentConfig = config;
}

export function getMcpConfig(): McpConfig {
  if (!currentConfig) {
    currentConfig = loadMcpConfig();
  }
  return currentConfig;
}

function parseConfig(raw: string): McpConfig {
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  if (!parsed.mcpServers || typeof parsed.mcpServers !== 'object') {
    throw new Error('Invalid mcp.json: expected { mcpServers: { ... } }');
  }
  for (const [name, entry] of Object.entries(parsed.mcpServers as Record<string, unknown>)) {
    if (!entry || typeof entry !== 'object') {
      throw new Error(`Invalid mcp.json: server "${name}" must be an object`);
    }
    const e = entry as Record<string, unknown>;
    if (!isHttpConfig(e as unknown as McpServerEntry) && typeof e.command !== 'string') {
      throw new Error(
        `Invalid mcp.json: server "${name}" must have "command" (stdio) or "url" (http/sse)`,
      );
    }
  }
  return parsed as unknown as McpConfig;
}

function applyEnvOverrides(config: McpConfig): McpConfig {
  const overridden: Record<string, McpServerEntry> = {};
  for (const [name, entry] of Object.entries(config.mcpServers)) {
    if (!isHttpConfig(entry)) {
      const envOverride = resolveEnvOverrides(name);
      overridden[name] = {
        ...entry,
        env: { ...entry.env, ...envOverride },
      };
    } else {
      overridden[name] = entry;
    }
  }
  return { mcpServers: overridden };
}

function resolveEnvOverrides(serverName: string): Record<string, string> {
  const prefix = `ARETE_MCP_${serverName.toUpperCase()}_ENV_`;
  const overrides: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith(prefix) && value !== undefined) {
      overrides[key.slice(prefix.length)] = value;
    }
  }
  return overrides;
}

function getFallbackConfig(): McpConfig {
  return { mcpServers: {} };
}
