import { Router, type Request, type Response } from 'express';
import { generateObject, NoObjectGeneratedError, type ModelMessage } from 'ai';
import { createOllama } from 'ollama-ai-provider-v2';
import { z } from 'zod';
import type { AgentMessage } from '@arete-ui/core';
import { buildSystemPrompt, type AgentContext } from '../agent-prompt';

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'gemma4:latest';

// The agent loop is consumer-owned (arete-ui ships no transport). We use the
// Vercel AI SDK for the loop: structured output + retries replace the old
// hand-rolled JSON extraction, and `messages` threads real conversation
// history. Surface-id minting/injection, component-graph validation, and
// pageOp placeholder resolution stay here — they are arete-domain concerns.
const ollama = createOllama({ baseURL: `${OLLAMA_URL}/api` });

/** Zod mirror of @arete-ui/core's AgentResponse *envelope*. A2UI message
 *  internals stay loose (`z.any()`); they're validated by the domain checks. */
const emissionSchema = z.object({
  kind: z.enum(['a2ui', 'pageOp']),
  targetSurfaceId: z.string().optional(),
  messages: z.array(z.any()).optional(),
  op: z.record(z.string(), z.any()).optional(),
});
const envelopeSchema = z.object({
  reply: z.string().optional(),
  rationale: z.string().optional(),
  emissions: z.array(emissionSchema),
});
type Envelope = z.infer<typeof envelopeSchema>;

export const agentRouter = Router();

agentRouter.get('/health', async (_req: Request, res: Response) => {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const resp = await fetch(`${OLLAMA_URL}/api/tags`, { signal: controller.signal });
    clearTimeout(timeout);
    if (!resp.ok) throw new Error(`Ollama returned ${resp.status}`);
    const data = (await resp.json()) as { models?: Array<{ name: string }> };
    res.json({
      ok: true,
      model: OLLAMA_MODEL,
      available: data.models?.map((m) => m.name) ?? [],
    });
  } catch {
    res.json({ ok: false });
  }
});

agentRouter.post('/', async (req: Request, res: Response) => {
  try {
    const { prompt, messages, context } = req.body as {
      prompt: string;
      messages?: AgentMessage[];
      context?: AgentContext;
    };
    if (!prompt) {
      res.status(400).json({ error: 'Missing prompt' });
      return;
    }

    const ctx = context ?? getDefaultContext();
    const systemPrompt = buildSystemPrompt(ctx);

    // Thread prior conversation (history) + the current user prompt. The
    // canonical system prompt is passed separately, so drop any system turns
    // that leaked into the transcript.
    const history: ModelMessage[] = (messages ?? [])
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
    const convo: ModelMessage[] = [...history, { role: 'user', content: prompt }];

    const outcome = await runAgentWithCorrection(systemPrompt, convo, ctx);
    if (!outcome.ok) {
      res.status(outcome.status).json(outcome.body);
      return;
    }
    res.json({
      emissions: outcome.validated,
      rationale: outcome.rationale,
      reply: outcome.reply,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

/** Max corrective re-asks (shared budget across parse + domain failures). */
const MAX_CORRECTIONS = 2;

type AgentOutcome =
  | { ok: true; validated: Array<Record<string, unknown>>; rationale?: string; reply?: string }
  | { ok: false; status: number; body: Record<string, unknown> };

/**
 * Runs the model and self-corrects on BOTH failure modes by feeding the error
 * back to the agent and re-asking (bounded by MAX_CORRECTIONS):
 *  - parse/envelope failure (`NoObjectGeneratedError`) → resend the raw output
 *    + the parse error and ask for valid JSON;
 *  - domain failure (malformed component graph / unknown surface) → resend the
 *    rejected JSON + the specific issues and ask for a fix.
 */
async function runAgentWithCorrection(
  systemPrompt: string,
  baseConvo: ModelMessage[],
  ctx: AgentContext,
): Promise<AgentOutcome> {
  const convo: ModelMessage[] = [...baseConvo];
  let corrections = 0;

  while (true) {
    let envelope: Envelope;
    try {
      envelope = await generate(systemPrompt, convo);
    } catch (err) {
      // Parse / schema failure: feed the raw text + cause back for a re-ask.
      if (NoObjectGeneratedError.isInstance(err) && corrections < MAX_CORRECTIONS) {
        corrections++;
        const raw = err.text?.trim();
        const cause =
          err.cause instanceof Error
            ? err.cause.message
            : String(err.cause ?? 'output was not valid JSON for the required schema');
        convo.push({ role: 'assistant', content: raw || '(previous output was not valid JSON)' });
        convo.push({
          role: 'user',
          content: `Your previous response could not be parsed: ${cause}. Respond again with ONLY a single valid JSON object matching the schema { reply, rationale, emissions } — no markdown fences, no prose outside the JSON.`,
        });
        continue;
      }
      if (NoObjectGeneratedError.isInstance(err)) {
        return {
          ok: false,
          status: 502,
          body: { error: `Agent did not return valid JSON after ${MAX_CORRECTIONS} correction attempts: ${err.message}` },
        };
      }
      throw err; // non-parse error → outer 500 handler
    }

    const result = processEmissions(envelope.emissions ?? [], ctx);
    if (result.issues.length === 0) {
      return { ok: true, validated: result.validated, rationale: envelope.rationale, reply: envelope.reply };
    }

    // Domain failure: feed the specific issues back for a re-ask.
    if (corrections < MAX_CORRECTIONS) {
      corrections++;
      convo.push({ role: 'assistant', content: JSON.stringify(envelope) });
      convo.push({
        role: 'user',
        content: `Your previous response had these issues:\n- ${result.issues.join('\n- ')}\n\nFix every issue and resend the corrected JSON only. Same schema, no commentary.`,
      });
      continue;
    }

    return {
      ok: false,
      status: 422,
      body: { error: `Agent produced an invalid response after ${MAX_CORRECTIONS} correction attempts`, issues: result.issues },
    };
  }
}

async function generate(system: string, messages: ModelMessage[]): Promise<Envelope> {
  const { object } = await generateObject({
    model: ollama(OLLAMA_MODEL),
    schema: envelopeSchema,
    system,
    messages,
  });
  return object;
}

interface ProcessResult {
  validated: Array<Record<string, unknown>>;
  issues: string[];
}

/** Validates + normalizes raw emissions: mints/injects surfaceIds, checks the
 *  component graph, and resolves pageOp placeholders. */
function processEmissions(emissions: Array<Record<string, unknown>>, ctx: AgentContext): ProcessResult {
  const validated: Array<Record<string, unknown>> = [];
  const issues: string[] = [];
  let lastSurfaceId: string | null = null;

  const knownSurfaces = new Set(Object.keys(ctx.surfaces ?? {}));

  for (const em of emissions) {
    if (em.kind === 'a2ui') {
      const declared = typeof em.targetSurfaceId === 'string' ? em.targetSurfaceId : '';
      const isPlaceholder = declared === '' || declared === '<PLACEHOLDER>';
      const a2uiMsgs = (em.messages ?? []) as Array<Record<string, unknown>>;
      const hasCreate = a2uiMsgs.some((m) => 'createSurface' in m);

      if (!isPlaceholder && !hasCreate && !knownSurfaces.has(declared)) {
        const known = [...knownSurfaces].join(', ') || '(none)';
        issues.push(
          `Emission targets unknown surface "${declared}". Known surfaces: [${known}]. To create a new surface use targetSurfaceId="<PLACEHOLDER>" with a createSurface message; to modify an existing one use one of the known ids verbatim.`,
        );
        continue;
      }

      const targetId = isPlaceholder ? mintSurfaceId() : declared;
      lastSurfaceId = targetId;
      const processed = a2uiMsgs.map((msg) => injectSurfaceId(msg, targetId));
      issues.push(...validateComponentReferences(processed));
      validated.push({ kind: 'a2ui', targetSurfaceId: targetId, messages: processed });
    } else if (em.kind === 'pageOp') {
      const op = resolvePlaceholders((em.op ?? {}) as Record<string, unknown>, ctx, lastSurfaceId);
      validated.push({ kind: 'pageOp', op });
    }
  }

  return { validated, issues };
}

let surfaceCounter = 0;
function mintSurfaceId(): string {
  return `agent-sfc-${++surfaceCounter}`;
}

function validateComponentReferences(messages: Array<Record<string, unknown>>): string[] {
  const issues: string[] = [];
  for (const msg of messages) {
    const uc = msg.updateComponents as Record<string, unknown> | undefined;
    if (!uc) continue;
    const components = (uc.components ?? []) as Array<Record<string, unknown>>;
    const defined = new Set(components.map((c) => String(c.id ?? '')).filter(Boolean));
    if (!defined.has('root')) {
      issues.push(
        `Missing required component with id="root". Defined ids: [${[...defined].join(', ') || '(none)'}].`,
      );
    }
    for (const c of components) {
      const id = String(c.id ?? '');
      const child = c.child;
      if (typeof child === 'string' && !defined.has(child)) {
        issues.push(`Component "${id}" references child "${child}" but no component with that id is defined.`);
      }
      const children = c.children;
      if (Array.isArray(children)) {
        for (const ref of children) {
          if (typeof ref === 'string' && !defined.has(ref)) {
            issues.push(`Component "${id}" references child "${ref}" but no component with that id is defined.`);
          }
        }
      }
      const action = c.action;
      if (action !== undefined) {
        const a = action as Record<string, unknown> | null;
        const ev = a && typeof a === 'object' ? (a.event as Record<string, unknown> | undefined) : undefined;
        if (!ev || typeof ev.name !== 'string' || ev.name.length === 0) {
          issues.push(
            `Component "${id}" has malformed action. Expected { event: { name: string, context?: object } }; got ${JSON.stringify(action)}.`,
          );
        } else if (ev.context !== undefined && (typeof ev.context !== 'object' || ev.context === null || Array.isArray(ev.context))) {
          issues.push(
            `Component "${id}" action.event.context must be an object (got ${JSON.stringify(ev.context)}).`,
          );
        }
      }
    }
  }
  return issues;
}

function injectSurfaceId(msg: Record<string, unknown>, surfaceId: string): Record<string, unknown> {
  const m = { ...msg };
  if ('createSurface' in m) {
    const cs = (m.createSurface as Record<string, unknown>) ?? {};
    m.createSurface = {
      // Default sendDataModel: true so the renderer attaches data-model
      // snapshots on every client→server message (A2UI canonical).
      sendDataModel: true,
      ...cs,
      surfaceId,
    };
  }
  if ('updateComponents' in m) {
    m.updateComponents = { ...(m.updateComponents as Record<string, unknown>), surfaceId };
  }
  if ('deleteSurface' in m) {
    m.deleteSurface = { ...(m.deleteSurface as Record<string, unknown>), surfaceId };
  }
  if ('updateDataModel' in m) {
    m.updateDataModel = { ...(m.updateDataModel as Record<string, unknown>), surfaceId };
  }
  return m;
}

function getDefaultContext(): AgentContext {
  return {
    chatSurfaceIds: [],
    pages: {
      tickets: {
        layout: {
          kind: 'grid',
          rows: 2,
          cols: 2,
          regions: [{ id: 'top-left' }, { id: 'top-right' }, { id: 'bottom-left' }, { id: 'bottom-right' }],
        },
        mapping: {},
      },
      reports: {
        layout: { kind: 'grid', rows: 1, cols: 2, regions: [{ id: 'left' }, { id: 'right' }] },
        mapping: {},
      },
    },
    surfaces: {},
    recentSurfaceIds: [],
    recentActions: [],
    recentPinnedSurfaceId: null,
    mostRecentSurfaceId: null,
    activeTabId: 'tickets',
  };
}

function resolvePlaceholders(
  op: Record<string, unknown>,
  ctx: AgentContext,
  lastSurfaceId: string | null,
): Record<string, unknown> {
  const resolved = { ...op };
  if (resolved.surfaceId === '<PLACEHOLDER>' && lastSurfaceId) {
    resolved.surfaceId = lastSurfaceId;
  }
  if ((resolved.surfaceId === '<PLACEHOLDER>' || !resolved.surfaceId) && ctx.recentPinnedSurfaceId) {
    resolved.surfaceId = ctx.recentPinnedSurfaceId;
  }
  return resolved;
}
