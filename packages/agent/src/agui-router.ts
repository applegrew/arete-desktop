import { Router, type Request, type Response } from 'express';
import { EventType } from '@ag-ui/core';
import { randomUUID } from 'node:crypto';
import { runAgentTurn, agentHealth, type AgentTurnRequest, type AgentRuntimeOptions } from './run-turn';

/** CUSTOM event name carrying an arete Emission — must match @arete-ui/agui's ARETE_EMISSION_EVENT. */
const ARETE_EMISSION_EVENT = 'arete.emission';

/**
 * Express Router for the AG-UI (Agent-User Interaction) endpoint. Mounts:
 *  - `POST /`        → runs one agent turn and streams the result as an AG-UI SSE
 *                      event stream (RUN_STARTED, TOOL_CALL_*, TEXT_MESSAGE_* for
 *                      rationale+reply, CUSTOM "arete.emission" per emission, RUN_FINISHED).
 *  - `GET /health`   → Ollama liveness/model info.
 * arete UI mutations ride as CUSTOM "arete.emission" events (decoded client-side
 * by `@arete-ui/agui`); assistant text rides as native TEXT_MESSAGE_* events.
 */
export function createAgentRouter(opts: AgentRuntimeOptions = {}): Router {
  const router = Router();

  router.get('/health', async (_req: Request, res: Response) => {
    res.json(await agentHealth(opts));
  });

  router.post('/', async (req: Request, res: Response) => {
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
      const outcome = await runAgentTurn(req.body as AgentTurnRequest, opts);

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
