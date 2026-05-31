import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { tool, jsonSchema, type Tool } from 'ai';
import { z } from 'zod';
import { getMcpConfig, type McpServerEntry } from './mcp-config';

function isHttpConfig(e: McpServerEntry): e is { url: string; transport: 'streamable-http' | 'sse' } {
  return 'url' in e;
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
      const content = (res.content ?? []) as Array<{ type?: string; text?: string }>;
      return content
        .filter((c) => c.type === 'text')
        .map((c) => c.text ?? '')
        .join('\n');
    },
  });
}

let toolsPromise: Promise<Record<string, Tool>> | null = null;

async function init(): Promise<Record<string, Tool>> {
  const config = getMcpConfig();
  const servers = Object.entries(config.mcpServers);
  if (servers.length === 0) return {};

  const allTools: Record<string, Tool> = {};

  for (const [name, entry] of servers) {
    try {
      const client = await connectServer(name, entry);
      const { tools } = await client.listTools();
      for (const t of tools) {
        allTools[t.name] = adaptTool(t, client);
      }
    } catch (err) {
      console.error(`[mcp] server "${name}" connection failed:`, err);
    }
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
