import { generateObject, generateText, stepCountIs, NoObjectGeneratedError, type ModelMessage } from 'ai';
import { createOllama } from 'ollama-ai-provider-v2';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { deepEqual, type AgentMessage } from '@arete-ui/core';
import { buildSystemPrompt, type AgentContext, type McpToolInfo } from './prompt';
import { getMcpTools, collectMcpResources, type McpUiResource } from './mcp';
import { loadSkills, renderSkillsForPrompt } from './skills';
import { logLlm } from './llm-log';

/** A tool the agent called during a turn (surfaced to the UI as AG-UI TOOL_CALL events). */
export interface ToolCallRecord {
  toolCallId: string;
  toolCallName: string;
  result?: string;
  /** True when the tool call failed — `result` holds the error detail. */
  isError?: boolean;
}

/** Flatten a tool-execution error (and its cause) into a readable string. */
function formatToolError(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as { cause?: unknown }).cause;
    const causeStr =
      cause instanceof Error
        ? `\ncaused by: ${cause.name}: ${cause.message}`
        : cause !== undefined
          ? `\ncaused by: ${String(cause)}`
          : '';
    return `${error.name}: ${error.message}${causeStr}`;
  }
  return String(error);
}

/** Record a tool result/error against its call (matched by id), or add a new record. */
function attachToolResult(calls: ToolCallRecord[], id: string, name: string, result: string, isError: boolean): void {
  const rec = calls.find((c) => c.toolCallId === id);
  if (rec) {
    rec.result = result;
    if (isError) rec.isError = true;
  } else {
    calls.push({ toolCallId: id, toolCallName: name, result, isError: isError || undefined });
  }
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
/** Page layout descriptor (kept loose on region shape, strict on `kind`). */
const layoutSchema = z.object({
  kind: z.enum(['grid', 'row', 'column', 'dock']),
  rows: z.number().optional(),
  cols: z.number().optional(),
  regions: z.array(z.object({ id: z.string(), gridArea: z.string().optional() })).optional(),
});

/**
 * Page op with a REQUIRED `name` enum + the per-op fields. Giving the op real
 * structure (vs a free `z.record`) lets constrained decoding force the model to
 * fill it — a loose record let weak models satisfy the schema with an empty {}.
 */
const pageOpSchema = z.object({
  name: z.enum([
    'createPage',
    'deletePage',
    'setPageProps',
    'setPageLayout',
    'pinSurface',
    'unpinSurface',
    'moveSurface',
    'setPageRegion',
  ]),
  pageId: z.string().optional(),
  title: z.string().optional(),
  icon: z.string().optional(),
  color: z.string().optional(),
  surfaceId: z.string().nullable().optional(),
  regionId: z.string().optional(),
  targetRegion: z.string().optional(),
  region: z.string().optional(),
  layout: layoutSchema.optional(),
});

const emissionSchema = z.object({
  kind: z.enum(['a2ui', 'pageOp']),
  targetSurfaceId: z.string().optional(),
  messages: z.array(z.any()).optional(),
  op: pageOpSchema.optional(),
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
  const turnId = randomUUID().slice(0, 8);
  logLlm({ turnId, phase: 'turn.start', model: modelName(opts), promptChars: prompt.length, historyLen: messages?.length ?? 0, prompt });

  // Discover MCP tools and extract their metadata for the prompt BEFORE building
  // the system prompt — so the model knows what tools are available during the
  // pre-step tool-calling phase.
  const tools = await getMcpTools();
  const toolInfos: McpToolInfo[] = Object.entries(tools).map(([name, t]) => ({
    name,
    description: t.description ?? name,
    parameters: (t as { inputSchema?: Record<string, unknown> }).inputSchema,
  }));

  // Skills (SKILL.md instruction bundles) are appended to the system prompt.
  const systemPrompt = buildSystemPrompt(ctx, toolInfos.length > 0 ? toolInfos : undefined) + renderSkillsForPrompt(loadSkills(opts?.skillsDir));

  // Thread prior conversation (history) + current prompt. The canonical system
  // prompt is passed separately, so drop any system turns from the transcript.
  const history: ModelMessage[] = (messages ?? [])
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
  let convo: ModelMessage[] = [...history, { role: 'user', content: prompt }];

  // MCP tool pre-step: let the model gather live data via MCP tools (multi-step),
  // then feed the tool conversation into the envelope step. Additive + failure-
  // tolerant — when no tools (or the model can't call them) this is skipped.
  // UI resources (MCP-UI / MCP Apps) returned by tools are captured here and
  // rendered as surfaces, independent of what the model writes.
  const toolCalls: ToolCallRecord[] = [];
  let uiResources: McpUiResource[] = [];
  if (Object.keys(tools).length > 0) {
    try {
      logLlm({ turnId, phase: 'prestep.request', tools: Object.keys(tools), system: systemPrompt, messages: convo });
      const { resources } = await collectMcpResources(async () => {
        const pre = await generateText({ model, system: systemPrompt, messages: convo, tools, stopWhen: stepCountIs(4) });
        logLlm({
          turnId,
          phase: 'prestep.response',
          finishReason: pre.finishReason,
          text: pre.text,
          steps: pre.steps.map((s) => ({
            text: s.text,
            toolCalls: (s.toolCalls ?? []).map((t) => ({ name: t.toolName, input: t.input })),
            toolResults: ((s.content ?? []) as ReadonlyArray<Record<string, unknown>>)
              .filter((p) => p.type === 'tool-result' || p.type === 'tool-error')
              .map((p) => ({ type: p.type, name: p.toolName, output: p.output ?? p.error })),
          })),
        });
        // Walk each step's content parts — the authoritative source for tool
        // names, results, AND errors (tool-error parts are NOT in `toolResults`).
        for (const step of pre.steps) {
          for (const part of (step.content ?? []) as ReadonlyArray<Record<string, unknown>>) {
            const id = part.toolCallId as string;
            const name = part.toolName as string;
            if (part.type === 'tool-call') {
              if (!toolCalls.some((c) => c.toolCallId === id)) toolCalls.push({ toolCallId: id, toolCallName: name });
            } else if (part.type === 'tool-result') {
              const out = part.output;
              attachToolResult(toolCalls, id, name, typeof out === 'string' ? out : JSON.stringify(out), false);
            } else if (part.type === 'tool-error') {
              attachToolResult(toolCalls, id, name, formatToolError(part.error), true);
            }
          }
        }
        if (pre.response?.messages?.length) {
          convo = [...convo, ...(pre.response.messages as ModelMessage[])];
        }
      });
      uiResources = resources;
    } catch (err) {
      logLlm({ turnId, phase: 'prestep.error', error: err instanceof Error ? err.message : String(err) });
      console.error('[mcp] tool pre-step skipped:', err);
    }
  }

  const outcome = await runAgentWithCorrection(model, systemPrompt, convo, ctx, turnId);
  if (outcome.ok) {
    logLlm({ turnId, phase: 'turn.ok', emissions: outcome.validated.length, reply: outcome.reply, toolCalls: toolCalls.length, uiResources: uiResources.length });
  } else {
    logLlm({ turnId, phase: 'turn.failed', status: outcome.status, body: outcome.body });
  }
  if (outcome.ok) {
    if (toolCalls.length > 0) outcome.toolCalls = toolCalls;
    // Render each captured MCP-UI resource as its own surface (framework-driven,
    // not model-driven) so tool-served UI lands in the workspace like any surface.
    for (const r of uiResources) outcome.validated.push(buildEmbedEmission(r));
  }
  return outcome;
}

/** Catalog id the chat client renders against (matches the agent's createSurface examples). */
const BASIC_CATALOG_ID = 'https://a2ui.org/specification/v0_9/basic_catalog.json';

/** Wrap an MCP-UI resource into an A2UI emission rendering a sandboxed Embed surface. */
function buildEmbedEmission(r: McpUiResource): Record<string, unknown> {
  const surfaceId = mintSurfaceId();
  const embed: Record<string, unknown> = { id: 'root', component: 'Embed', title: r.tool };
  if (r.html) embed.html = r.html;
  if (r.url) embed.url = r.url;
  if (r.mimeType) embed.mimeType = r.mimeType;
  if (r.uri) embed.uri = r.uri;
  return {
    kind: 'a2ui',
    targetSurfaceId: surfaceId,
    messages: [
      { version: 'v0.9', createSurface: { surfaceId, catalogId: BASIC_CATALOG_ID, sendDataModel: true } },
      { version: 'v0.9', updateComponents: { surfaceId, components: [embed] } },
    ],
  };
}

async function runAgentWithCorrection(
  model: ReturnType<typeof resolveModel>,
  systemPrompt: string,
  baseConvo: ModelMessage[],
  ctx: AgentContext,
  turnId = '-',
): Promise<AgentOutcome> {
  const convo: ModelMessage[] = [...baseConvo];
  let corrections = 0;

  while (true) {
    let envelope: Envelope;
    try {
      logLlm({ turnId, phase: 'envelope.request', attempt: corrections, messages: convo });
      const { object } = await generateObject({ model, schema: envelopeSchema, system: systemPrompt, messages: convo });
      envelope = object;
      logLlm({ turnId, phase: 'envelope.response', attempt: corrections, envelope });
    } catch (err) {
      if (NoObjectGeneratedError.isInstance(err) && corrections < MAX_CORRECTIONS) {
        corrections++;
        const raw = err.text?.trim();
        const cause =
          err.cause instanceof Error
            ? err.cause.message
            : String(err.cause ?? 'output was not valid JSON for the required schema');
        logLlm({ turnId, phase: 'envelope.parse_error', attempt: corrections - 1, cause, rawText: raw });
        convo.push({ role: 'assistant', content: raw || '(previous output was not valid JSON)' });
        convo.push({
          role: 'user',
          content: `Your previous response could not be parsed: ${cause}. Respond again with ONLY a single valid JSON object matching the schema { reply, rationale, emissions } — no markdown fences, no prose outside the JSON.`,
        });
        continue;
      }
      if (NoObjectGeneratedError.isInstance(err)) {
        logLlm({ turnId, phase: 'envelope.parse_error_final', message: err.message, rawText: err.text });
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
      logLlm({ turnId, phase: 'validation.issues', attempt: corrections, issues: result.issues, envelope });
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
      logLlm({ turnId, phase: 'validation.noops', attempt: corrections, noops: result.noops });
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
      const rawOp = (em.op ?? {}) as Record<string, unknown>;
      const opIssues = validatePageOp(rawOp, ctx);
      if (opIssues.length > 0) {
        issues.push(...opIssues);
        continue;
      }
      const op = resolvePlaceholders(rawOp, ctx, lastSurfaceId);
      validated.push({ kind: 'pageOp', op });
    }
  }

  return { validated, issues, noops };
}

/** Required fields per page op (beyond `name`). */
const PAGE_OP_REQUIRED: Record<string, string[]> = {
  createPage: ['pageId', 'title'],
  deletePage: ['pageId'],
  setPageProps: ['pageId'],
  setPageLayout: ['pageId', 'layout'],
  pinSurface: ['surfaceId', 'pageId'],
  unpinSurface: ['surfaceId', 'pageId'],
  moveSurface: ['surfaceId', 'pageId', 'targetRegion'],
  setPageRegion: ['pageId', 'regionId'],
};

/** Validate a pageOp's name + required fields so a malformed op (e.g. empty {})
 *  triggers a correction instead of slipping through and breaking the workspace. */
function validatePageOp(op: Record<string, unknown>, ctx: AgentContext): string[] {
  const name = typeof op.name === 'string' ? op.name : '';
  const known = Object.keys(PAGE_OP_REQUIRED);
  if (!known.includes(name)) {
    const active = ctx.activeTabId && ctx.activeTabId !== 'chat' ? ` The active page is "${ctx.activeTabId}".` : '';
    return [
      `pageOp is missing a valid "name" — use one of [${known.join(', ')}].${active} ` +
        `For "change the layout", emit {"kind":"pageOp","op":{"name":"setPageLayout","pageId":"<activePageId>","layout":{"kind":"row","regions":[{"id":"left"},{"id":"right"}]}}}. Got: ${JSON.stringify(op)}.`,
    ];
  }
  const missing = (PAGE_OP_REQUIRED[name] ?? []).filter((f) => op[f] === undefined || op[f] === null || op[f] === '');
  // setPageRegion.surfaceId may legitimately be null (clear a region).
  if (name === 'setPageRegion' && !('surfaceId' in op)) missing.push('surfaceId');
  if (missing.length > 0) {
    return [`pageOp "${name}" is missing required field(s): ${missing.join(', ')}. Got: ${JSON.stringify(op)}.`];
  }
  return [];
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
