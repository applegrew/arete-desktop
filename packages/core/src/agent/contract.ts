/**
 * Agent ↔ arete-desktop emission contract.
 *
 * The shared shape a consumer's agent loop must produce. arete-desktop consumes
 * these emissions (routing a2ui messages through the diff engine, applying page
 * ops through the harness) but does NOT produce them — the loop is consumer-
 * owned. Hoisting the contract here lets both the client and the agent server
 * code against one definition instead of redefining it per consumer.
 */
import type { A2uiInboundMessage } from '../types/hooks';
import type { PageOp } from '../types/page-ops';

/** Create or mutate an A2UI surface. `targetSurfaceId` is the resolved surface. */
export interface A2uiEmission {
  kind: 'a2ui';
  targetSurfaceId: string;
  messages: A2uiInboundMessage[];
}

/** A structural page operation (pin/move/layout/region). */
export interface PageOpEmission {
  kind: 'pageOp';
  op: PageOp;
}

/** Attach a sandboxed JS handler to a surface for a user-action event, so future
 *  occurrences are handled by the Widget Manager (no LLM round-trip). */
export interface WidgetScriptEmission {
  kind: 'widgetScript';
  targetSurfaceId: string;
  event: string;
  runtime: 'server' | 'client';
  code: string;
}

/** One unit of agent output: A2UI content, a page op, or a widget handler script. */
export type Emission = A2uiEmission | PageOpEmission | WidgetScriptEmission;

/**
 * The full response envelope an agent turn returns.
 * - `reply`     — visible conversational text for the user.
 * - `rationale` — internal reasoning, shown muted as "thinking".
 * - `emissions` — UI surfaces and page ops to apply (may be empty).
 */
export interface AgentResponse {
  emissions: Emission[];
  rationale?: string;
  reply?: string;
}

/** Narrows an {@link Emission} to an {@link A2uiEmission}. */
export function isA2uiEmission(e: Emission): e is A2uiEmission {
  return e.kind === 'a2ui';
}

/** Narrows an {@link Emission} to a {@link PageOpEmission}. */
export function isPageOpEmission(e: Emission): e is PageOpEmission {
  return e.kind === 'pageOp';
}
