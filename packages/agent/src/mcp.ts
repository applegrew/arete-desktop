import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { tool, type Tool } from 'ai';
import { z } from 'zod';

/**
 * Hermetic MCP demo for the Phase-0 PoC: a real Model Context Protocol server +
 * client wired over an in-memory transport (no child process, no network), with
 * its tools adapted to Vercel AI SDK tools the agent loop can call. Proves "MCP
 * support" end-to-end without external setup. A real deployment would point the
 * MCP client at remote/stdio servers instead.
 */
function buildServer(): McpServer {
  const server = new McpServer({ name: 'erp-mcp', version: '0.0.1' });
  // One tool: live ticket counts. Distinct numbers so we can SEE the agent used
  // the tool result (vs. inventing its own) in the rendered chart.
  server.registerTool(
    'get_ticket_stats',
    {
      description:
        'Returns the current ticket counts by status (open, pending, resolved, closed) from the ERP system. Use this before building any ticket chart so the numbers are real.',
    },
    async () => ({
      content: [
        { type: 'text', text: JSON.stringify({ open: 17, pending: 6, resolved: 25, closed: 41 }) },
      ],
    }),
  );
  return server;
}

let toolsPromise: Promise<Record<string, Tool>> | null = null;

async function init(): Promise<Record<string, Tool>> {
  const server = buildServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const client = new Client({ name: 'erp-mcp-client', version: '0.0.1' });
  await client.connect(clientTransport);

  const { tools } = await client.listTools();
  const adapted: Record<string, Tool> = {};
  for (const t of tools) {
    adapted[t.name] = tool({
      description: t.description ?? t.name,
      // The demo tool takes no args; general JSON-Schema→zod mapping is future scope.
      inputSchema: z.object({}),
      execute: async () => {
        const res = await client.callTool({ name: t.name, arguments: {} });
        const content = (res.content ?? []) as Array<{ type?: string; text?: string }>;
        return content
          .filter((c) => c.type === 'text')
          .map((c) => c.text ?? '')
          .join('\n');
      },
    });
  }
  return adapted;
}

/** Lazily initialized, failure-tolerant MCP toolset (empty if init fails). */
export function getMcpTools(): Promise<Record<string, Tool>> {
  if (!toolsPromise) {
    toolsPromise = init().catch((err) => {
      console.error('[mcp] init failed; continuing without tools:', err);
      return {};
    });
  }
  return toolsPromise;
}
