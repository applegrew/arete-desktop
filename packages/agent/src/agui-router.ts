import { Router, type Request, type Response } from 'express';
import { EventType } from '@ag-ui/core';
import { randomUUID } from 'node:crypto';
import { runAgentTurn, agentHealth, type AgentTurnRequest, type AgentRuntimeOptions } from './run-turn';
import { setMcpConfig, type McpConfig } from './mcp-config';
import { resetMcpTools, getMcpStatus } from './mcp';

/** CUSTOM event name carrying an arete Emission — must match @arete-desktop/agui's ARETE_EMISSION_EVENT. */
const ARETE_EMISSION_EVENT = 'arete.emission';

/** Options for {@link createAgentRouter}. Static `model`/`ollamaUrl`/`mcp` set the
 *  baseline; `resolveOptions` (if given) is consulted *per turn* for live overrides
 *  — e.g. a settings UI that persists the model + enabled MCP servers. */
export interface AgentRouterOptions extends AgentRuntimeOptions {
  /** Initial MCP server configuration. */
  mcp?: McpConfig;
  /** Resolve current runtime options per turn (live settings). When the returned
   *  `mcp` config differs from the last applied one, MCP tools are reconnected. */
  resolveOptions?: () => (Partial<AgentRuntimeOptions> & { mcp?: McpConfig });
}

/**
 * Express Router for the AG-UI (Agent-User Interaction) endpoint. Mounts:
 *  - `POST /`        → runs one agent turn and streams the result as an AG-UI SSE
 *                      event stream (RUN_STARTED, TOOL_CALL_*, TEXT_MESSAGE_* for
 *                      rationale+reply, CUSTOM "arete.emission" per emission, RUN_FINISHED).
 *  - `GET /health`   → Ollama liveness/model info.
 * arete UI mutations ride as CUSTOM "arete.emission" events (decoded client-side
 * by `@arete-desktop/agui`); assistant text rides as native TEXT_MESSAGE_* events.
 */
export function createAgentRouter(opts: AgentRouterOptions = {}): Router {
  const router = Router();

  let lastMcpKey = '';
  if (opts.mcp) {
    setMcpConfig(opts.mcp);
    lastMcpKey = JSON.stringify(opts.mcp);
  }

  /** Merge static opts with per-turn live overrides; re-apply MCP config on change. */
  function resolveTurnOptions(): AgentRuntimeOptions {
    const dyn = opts.resolveOptions?.() ?? {};
    if (dyn.mcp) {
      const key = JSON.stringify(dyn.mcp);
      if (key !== lastMcpKey) {
        setMcpConfig(dyn.mcp);
        resetMcpTools();
        lastMcpKey = key;
      }
    }
    return {
      model: dyn.model ?? opts.model,
      ollamaUrl: dyn.ollamaUrl ?? opts.ollamaUrl,
      skillsDir: dyn.skillsDir ?? opts.skillsDir,
    };
  }

  router.get('/health', async (_req: Request, res: Response) => {
    res.json(await agentHealth(resolveTurnOptions()));
  });

  // Per-server MCP connection status (applies live config first, reconnecting if it changed).
  router.get('/mcp-status', async (_req: Request, res: Response) => {
    resolveTurnOptions();
    res.json(await getMcpStatus());
  });

  // Force a reconnect of all MCP servers against the current (live) config.
  router.post('/mcp-reconnect', async (_req: Request, res: Response) => {
    resolveTurnOptions();
    resetMcpTools();
    res.json(await getMcpStatus());
  });

  router.post('/', async (req: Request, res: Response) => {
    const turnOpts = resolveTurnOptions();
    const threadId = (req.body?.threadId as string) || randomUUID();
    const runId = randomUUID();

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    const send = (event: Record<string, unknown>) => {
      res.write(`data: ${JSON.stringify({ ...event, timestamp: Date.now() })}\n\n`);
    };

    send({ type: EventType.RUN_STARTED, threadId, runId });

    try {
      const outcome = await runAgentTurn(req.body as AgentTurnRequest, turnOpts);

      if (!outcome.ok) {
        send({
          type: EventType.RUN_ERROR,
          message: String((outcome.body as { error?: string }).error ?? 'agent error'),
          code: String(outcome.status),
        });
        res.end();
        return;
      }

      // Tool calls the agent made (via MCP) → native AG-UI tool-call events.
      for (const tc of outcome.toolCalls ?? []) {
        send({ type: EventType.TOOL_CALL_START, toolCallId: tc.toolCallId, toolCallName: tc.toolCallName });
        if (tc.result !== undefined) {
          send({
            type: EventType.TOOL_CALL_RESULT,
            toolCallId: tc.toolCallId,
            messageId: `tool:${tc.toolCallId}`,
            content: tc.result,
            isError: tc.isError ?? false,
          });
        }
        send({ type: EventType.TOOL_CALL_END, toolCallId: tc.toolCallId });
      }

      // Thinking (rationale) + visible reply as native text messages.
      if (outcome.rationale) emitText(send, `thinking:${runId}`, outcome.rationale, 'assistant');
      if (outcome.reply) emitText(send, `reply:${runId}`, outcome.reply, 'assistant');

      // UI mutations (A2UI surfaces + page ops) as CUSTOM arete emissions.
      for (const emission of outcome.validated) {
        send({ type: EventType.CUSTOM, name: ARETE_EMISSION_EVENT, value: emission });
      }

      send({ type: EventType.RUN_FINISHED, threadId, runId });
    } catch (err) {
      send({ type: EventType.RUN_ERROR, message: String(err) });
    } finally {
      res.end();
    }
  });

  return router;
}

/** Emit a complete text message as START → CONTENT → END (non-streaming; the loop
 *  produces the full reply at once, but the wire shape stays canonical AG-UI). */
function emitText(
  send: (event: Record<string, unknown>) => void,
  messageId: string,
  text: string,
  role: string,
): void {
  send({ type: EventType.TEXT_MESSAGE_START, messageId, role });
  send({ type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta: text });
  send({ type: EventType.TEXT_MESSAGE_END, messageId });
}
