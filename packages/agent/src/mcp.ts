import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { tool, jsonSchema, type Tool } from 'ai';
import { z } from 'zod';
import { AsyncLocalStorage } from 'node:async_hooks';
import { getMcpConfig, type McpServerEntry } from './mcp-config';

function isHttpConfig(e: McpServerEntry): e is { url: string; transport: 'streamable-http' | 'sse' } {
  return 'url' in e;
}

function transportLabel(e: McpServerEntry): 'stdio' | 'streamable-http' | 'sse' {
  return isHttpConfig(e) ? e.transport : 'stdio';
}

/** Per-server connection status, surfaced to the settings UI for health/diagnostics. */
export interface McpServerStatus {
  name: string;
  transport: 'stdio' | 'streamable-http' | 'sse';
  connected: boolean;
  toolCount: number;
  tools: string[];
  error?: string;
}

/** A UI resource emitted by an MCP tool (MCP-UI / MCP Apps), rendered in a surface. */
export interface McpUiResource {
  /** Tool that produced it (used as the surface title). */
  tool: string;
  /** Resource URI (e.g. ui://...). */
  uri?: string;
  mimeType?: string;
  /** Inline HTML → rendered via iframe `srcDoc`. */
  html?: string;
  /** External URL → rendered via iframe `src`. */
  url?: string;
}

async function connectServer(name: string, entry: McpServerEntry): Promise<Client> {
  const client = new Client({ name: `arete-${name}`, version: '0.0.1' });

  if (isHttpConfig(entry)) {
    if (entry.transport === 'streamable-http') {
      const transport = new StreamableHTTPClientTransport(new URL(entry.url));
      await client.connect(transport);
    } else {
      const transport = new SSEClientTransport(new URL(entry.url));
      await client.connect(transport);
    }
  } else {
    const transport = new StdioClientTransport({
      command: entry.command,
      args: entry.args,
      env: entry.env,
    });
    await client.connect(transport);
  }

  return client;
}

function isHtmlMime(m?: string): boolean {
  return !!m && m.startsWith('text/html');
}

/** Pull MCP-UI resources out of a tool result's content array (resource + resource_link). */
function extractUiResources(toolName: string, content: Array<Record<string, unknown>>): McpUiResource[] {
  const out: McpUiResource[] = [];
  for (const c of content) {
    if (c.type === 'resource' && c.resource && typeof c.resource === 'object') {
      const r = c.resource as { uri?: string; text?: string; mimeType?: string };
      const isUiUri = typeof r.uri === 'string' && r.uri.startsWith('ui://');
      if (typeof r.text === 'string' && (isHtmlMime(r.mimeType) || (isUiUri && !r.mimeType))) {
        out.push({ tool: toolName, uri: r.uri, mimeType: r.mimeType ?? 'text/html', html: r.text });
      } else if (r.mimeType === 'text/uri-list' && typeof r.text === 'string') {
        const url = r.text
          .split('\n')
          .map((s) => s.trim())
          .find((s) => s.length > 0 && !s.startsWith('#'));
        if (url) out.push({ tool: toolName, uri: r.uri, mimeType: r.mimeType, url });
      }
    } else if (c.type === 'resource_link') {
      const link = c as { uri?: string; mimeType?: string };
      if (typeof link.uri === 'string' && isHtmlMime(link.mimeType)) {
        out.push({ tool: toolName, uri: link.uri, mimeType: link.mimeType, url: link.uri });
      }
    }
  }
  return out;
}

/** Per-turn sink for UI resources captured during tool execution (see {@link collectMcpResources}). */
const resourceStore = new AsyncLocalStorage<McpUiResource[]>();

/**
 * Run `fn` (a tool-using agent step) with a UI-resource sink in scope. Any MCP-UI
 * resources returned by tools during `fn` are collected and returned alongside the
 * result, so the caller can render them as surfaces.
 */
export async function collectMcpResources<T>(fn: () => Promise<T>): Promise<{ result: T; resources: McpUiResource[] }> {
  const sink: McpUiResource[] = [];
  const result = await resourceStore.run(sink, fn);
  return { result, resources: sink };
}

function adaptTool(t: { name: string; description?: string; inputSchema: Record<string, unknown> }, client: Client): Tool {
  const hasParams = t.inputSchema && typeof t.inputSchema === 'object' && 'properties' in t.inputSchema;
  return tool({
    description: t.description ?? t.name,
    inputSchema: hasParams ? jsonSchema(t.inputSchema as Record<string, unknown>) : z.object({}),
    execute: async (args: unknown) => {
      const res = await client.callTool({
        name: t.name,
        arguments: (args as Record<string, unknown>) ?? {},
      });
      const content = (res.content ?? []) as Array<Record<string, unknown>>;

      // Capture any UI resources for separate rendering (MCP-UI / MCP Apps).
      const sink = resourceStore.getStore();
      if (sink) sink.push(...extractUiResources(t.name, content));

      const text = content
        .filter((c) => c.type === 'text')
        .map((c) => (c as { text?: string }).text ?? '')
        .join('\n');
      if (text) return text;
      const uiCount = content.filter((c) => c.type === 'resource' || c.type === 'resource_link').length;
      return uiCount > 0 ? `[Tool returned ${uiCount} UI resource(s), rendered in the workspace.]` : '';
    },
  });
}

let toolsPromise: Promise<Record<string, Tool>> | null = null;
let activeClients: Client[] = [];
let serverStatuses: McpServerStatus[] = [];

async function init(): Promise<Record<string, Tool>> {
  const config = getMcpConfig();
  const servers = Object.entries(config.mcpServers);
  serverStatuses = [];
  if (servers.length === 0) return {};

  const allTools: Record<string, Tool> = {};

  for (const [name, entry] of servers) {
    const status: McpServerStatus = {
      name,
      transport: transportLabel(entry),
      connected: false,
      toolCount: 0,
      tools: [],
    };
    try {
      const client = await connectServer(name, entry);
      activeClients.push(client);
      const { tools } = await client.listTools();
      const names: string[] = [];
      for (const t of tools) {
        allTools[t.name] = adaptTool(t, client);
        names.push(t.name);
      }
      status.connected = true;
      status.toolCount = names.length;
      status.tools = names;
    } catch (err) {
      status.error = err instanceof Error ? err.message : String(err);
      console.error(`[mcp] server "${name}" connection failed:`, err);
    }
    serverStatuses.push(status);
  }

  return allTools;
}

export function getMcpTools(): Promise<Record<string, Tool>> {
  if (!toolsPromise) {
    toolsPromise = init().catch((err) => {
      console.error('[mcp] init failed; continuing without tools:', err);
      return {};
    });
  }
  return toolsPromise;
}

/** Per-server connection status (ensures a connection attempt has run first). */
export async function getMcpStatus(): Promise<McpServerStatus[]> {
  await getMcpTools();
  return serverStatuses;
}

/**
 * Drop the memoized tool set and close open MCP client connections, so the next
 * {@link getMcpTools} call rediscovers tools against the *current* config. Call
 * after {@link setMcpConfig} when MCP servers change at runtime (e.g. via a
 * settings UI) — otherwise the first-turn cache would pin the old servers.
 */
export function resetMcpTools(): void {
  for (const client of activeClients) {
    void Promise.resolve(client.close()).catch(() => {});
  }
  activeClients = [];
  serverStatuses = [];
  toolsPromise = null;
}
