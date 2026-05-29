import { generateObject, generateText, stepCountIs, NoObjectGeneratedError, type ModelMessage } from 'ai';
import { createOllama } from 'ollama-ai-provider-v2';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { deepEqual, type AgentMessage } from '@arete-ui/core';
import { buildSystemPrompt, type AgentContext } from './prompt';
import { getMcpTools } from './mcp';
import { loadSkills, renderSkillsForPrompt } from './skills';

/** A tool the agent called during a turn (surfaced to the UI as AG-UI TOOL_CALL events). */
export interface ToolCallRecord {
  toolCallId: string;
  toolCallName: string;
  result?: string;
}

/** Runtime configuration for an agent turn (overrides env defaults). */
export interface AgentRuntimeOptions {
  /** Ollama model name (default: $OLLAMA_MODEL or gemma4:latest). */
  model?: string;
  /** Ollama base URL (default: $OLLAMA_URL or http://localhost:11434). */
  ollamaUrl?: string;
  /** Directory of SKILL.md skill folders to load (default: $ARETE_SKILLS_DIR or <cwd>/skills). */
  skillsDir?: string;
}

function ollamaBaseUrl(opts?: AgentRuntimeOptions): string {
  return opts?.ollamaUrl || process.env.OLLAMA_URL || 'http://localhost:11434';
}
function modelName(opts?: AgentRuntimeOptions): string {
  return opts?.model || process.env.OLLAMA_MODEL || 'gemma4:latest';
}
function resolveModel(opts?: AgentRuntimeOptions) {
  return createOllama({ baseURL: `${ollamaBaseUrl(opts)}/api` })(modelName(opts));
}

/** Liveness/info probe used by the AG-UI router's /health. */
export async function agentHealth(
  opts?: AgentRuntimeOptions,
): Promise<{ ok: boolean; model?: string; available?: string[] }> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const resp = await fetch(`${ollamaBaseUrl(opts)}/api/tags`, { signal: controller.signal });
    clearTimeout(timeout);
    if (!resp.ok) throw new Error(`Ollama returned ${resp.status}`);
    const data = (await resp.json()) as { models?: Array<{ name: string }> };
    return { ok: true, model: modelName(opts), available: data.models?.map((m) => m.name) ?? [] };
  } catch {
    return { ok: false };
  }
}

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

export interface AgentTurnRequest {
  prompt: string;
  messages?: AgentMessage[];
  context?: AgentContext;
}

export type AgentOutcome =
  | {
      ok: true;
      validated: Array<Record<string, unknown>>;
      rationale?: string;
      reply?: string;
      toolCalls?: ToolCallRecord[];
    }
  | { ok: false; status: number; body: Record<string, unknown> };

/** Max corrective re-asks (shared budget across parse + domain failures). */
const MAX_CORRECTIONS = 2;

/**
 * Runs one agent turn end-to-end (skills → system prompt → history → MCP tool
 * pre-step → structured emission + correction loop). Stateless: no persistence,
 * no transport. Surface-id minting/injection, component-graph validation, no-op
 * detection, and pageOp placeholder resolution are arete-domain concerns kept here.
 */
export async function runAgentTurn(body: AgentTurnRequest, opts?: AgentRuntimeOptions): Promise<AgentOutcome> {
  const { prompt, messages, context } = body;
  if (!prompt) {
    return { ok: false, status: 400, body: { error: 'Missing prompt' } };
  }
  const model = resolveModel(opts);
  const ctx = context ?? getDefaultContext();
  // Skills (SKILL.md instruction bundles) are appended to the system prompt.
  const systemPrompt = buildSystemPrompt(ctx) + renderSkillsForPrompt(loadSkills(opts?.skillsDir));

  // Thread prior conversation (history) + current prompt. The canonical system
  // prompt is passed separately, so drop any system turns from the transcript.
  const history: ModelMessage[] = (messages ?? [])
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
  let convo: ModelMessage[] = [...history, { role: 'user', content: prompt }];

  // MCP tool pre-step: let the model gather live data via MCP tools (multi-step),
  // then feed the tool conversation into the envelope step. Additive + failure-
  // tolerant — when no tools (or the model can't call them) this is skipped.
  const toolCalls: ToolCallRecord[] = [];
  const tools = await getMcpTools();
  if (Object.keys(tools).length > 0) {
    try {
      const pre = await generateText({ model, system: systemPrompt, messages: convo, tools, stopWhen: stepCountIs(4) });
      for (const step of pre.steps) {
        const results = new Map<string, string>();
        for (const tr of step.toolResults ?? []) {
          results.set(tr.toolCallId, typeof tr.output === 'string' ? tr.output : JSON.stringify(tr.output));
        }
        for (const tc of step.toolCalls ?? []) {
          toolCalls.push({ toolCallId: tc.toolCallId, toolCallName: tc.toolName, result: results.get(tc.toolCallId) });
        }
      }
      if (pre.response?.messages?.length) {
        convo = [...convo, ...(pre.response.messages as ModelMessage[])];
      }
    } catch (err) {
      console.error('[mcp] tool pre-step skipped:', err);
    }
  }

  const outcome = await runAgentWithCorrection(model, systemPrompt, convo, ctx);
  if (outcome.ok && toolCalls.length > 0) outcome.toolCalls = toolCalls;
  return outcome;
}

async function runAgentWithCorrection(
  model: ReturnType<typeof resolveModel>,
  systemPrompt: string,
  baseConvo: ModelMessage[],
  ctx: AgentContext,
): Promise<AgentOutcome> {
  const convo: ModelMessage[] = [...baseConvo];
  let corrections = 0;

  while (true) {
    let envelope: Envelope;
    try {
      const { object } = await generateObject({ model, schema: envelopeSchema, system: systemPrompt, messages: convo });
      envelope = object;
    } catch (err) {
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
      throw err;
    }

    const result = processEmissions(envelope.emissions ?? [], ctx);

    if (result.issues.length > 0) {
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

    if (result.noops.length > 0) {
      if (corrections < MAX_CORRECTIONS) {
        corrections++;
        convo.push({ role: 'assistant', content: JSON.stringify(envelope) });
        convo.push({
          role: 'user',
          content:
            `Your updateComponents for surface(s) [${result.noops.join(', ')}] is identical to what is ` +
            `already rendered — it changes nothing. Do NOT claim you changed or fixed it. If the user's ` +
            `request cannot be satisfied by changing the component spec (e.g. it concerns how the component ` +
            `renders, which you do not control), say so briefly and honestly in "reply" and return an empty ` +
            `emissions array. Otherwise, emit a genuinely different spec that addresses the request.`,
        });
        continue;
      }
      const noopSet = new Set(result.noops);
      const cleaned = result.validated.filter(
        (v) => !(v.kind === 'a2ui' && noopSet.has(v.targetSurfaceId as string)),
      );
      return { ok: true, validated: cleaned, rationale: envelope.rationale, reply: envelope.reply };
    }

    return { ok: true, validated: result.validated, rationale: envelope.rationale, reply: envelope.reply };
  }
}

interface ProcessResult {
  validated: Array<Record<string, unknown>>;
  issues: string[];
  noops: string[];
}

/** Validates + normalizes raw emissions: mints/injects surfaceIds, checks the
 *  component graph, detects no-ops, and resolves pageOp placeholders. */
export function processEmissions(emissions: Array<Record<string, unknown>>, ctx: AgentContext): ProcessResult {
  const validated: Array<Record<string, unknown>> = [];
  const issues: string[] = [];
  const noops: string[] = [];
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

      if (!isPlaceholder && !hasCreate && knownSurfaces.has(declared)) {
        const live = ctx.surfaces?.[declared]?.components;
        const updates = processed.filter((m) => 'updateComponents' in m);
        const allNoop =
          updates.length > 0 &&
          updates.every((m) => sameComponentSet(live, (m.updateComponents as Record<string, unknown>).components));
        if (allNoop) noops.push(declared);
      }
    } else if (em.kind === 'pageOp') {
      const op = resolvePlaceholders((em.op ?? {}) as Record<string, unknown>, ctx, lastSurfaceId);
      validated.push({ kind: 'pageOp', op });
    }
  }

  return { validated, issues, noops };
}

/** Id-keyed deep comparison of two A2UI component arrays (order-independent). */
function sameComponentSet(prev: unknown, next: unknown): boolean {
  if (!Array.isArray(prev) || !Array.isArray(next)) return false;
  const byId = (arr: unknown[]): Map<string, unknown> => {
    const m = new Map<string, unknown>();
    for (const c of arr) {
      if (c && typeof c === 'object' && 'id' in c) m.set(String((c as { id: unknown }).id), c);
    }
    return m;
  };
  const a = byId(prev);
  const b = byId(next);
  if (a.size !== b.size) return false;
  for (const [id, comp] of a) {
    if (!b.has(id) || !deepEqual(comp, b.get(id))) return false;
  }
  return true;
}

/** Unique surface id (UUID-based) — never collides across pages/conversations/restarts. */
function mintSurfaceId(): string {
  return `agent-sfc-${randomUUID().slice(0, 8)}`;
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
          issues.push(`Component "${id}" action.event.context must be an object (got ${JSON.stringify(ev.context)}).`);
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
    m.createSurface = { sendDataModel: true, ...cs, surfaceId };
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
    pages: {},
    surfaces: {},
    recentSurfaceIds: [],
    recentActions: [],
    recentPinnedSurfaceId: null,
    mostRecentSurfaceId: null,
    activeTabId: 'chat',
    diagnostics: [],
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
