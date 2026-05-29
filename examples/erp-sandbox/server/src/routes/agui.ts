import { Router, type Request, type Response } from 'express';
import { EventType } from '@ag-ui/core';
import { randomUUID } from 'crypto';
import { runAgentTurn, type AgentTurnRequest } from './agent';

// AG-UI streaming endpoint. Wraps the shared agent turn and emits the result as
// an AG-UI (Agent-User Interaction) SSE event stream. arete UI mutations ride as
// CUSTOM events named "arete.emission" (decoded client-side by @arete-ui/agui);
// the assistant reply rides as native TEXT_MESSAGE_* events.
export const aguiRouter = Router();

/** CUSTOM event name carrying an arete Emission — must match @arete-ui/agui's ARETE_EMISSION_EVENT. */
const ARETE_EMISSION_EVENT = 'arete.emission';

aguiRouter.post('/', async (req: Request, res: Response) => {
  const threadId = (req.body?.threadId as string) || randomUUID();
  const runId = randomUUID();

  // SSE headers.
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
    const outcome = await runAgentTurn(req.body as AgentTurnRequest);

    if (!outcome.ok) {
      send({
        type: EventType.RUN_ERROR,
        message: String((outcome.body as { error?: string }).error ?? 'agent error'),
        code: String(outcome.status),
      });
      res.end();
      return;
    }

    // Thinking (rationale) + visible reply as native text messages.
    if (outcome.rationale) {
      emitText(send, `thinking:${runId}`, outcome.rationale, 'assistant');
    }
    if (outcome.reply) {
      emitText(send, `reply:${runId}`, outcome.reply, 'assistant');
    }

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

/** Emit a complete text message as START → CONTENT → END (non-streaming here; the
 *  loop produces the full reply at once, but the wire shape stays canonical AG-UI). */
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
