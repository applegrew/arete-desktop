/**
 * Workspace context-snapshot builder.
 *
 * Assembles the per-turn context an agent loop needs — conversation transcript,
 * recent user actions, currently-rendered surfaces, and page layout/mapping —
 * into one typed, transport-agnostic object. The consumer supplies the live
 * primitives it holds (surface contents, page layouts/mappings); core pulls the
 * transcript from {@link ChatStore} and recent actions from {@link ActionHarness},
 * and applies windowing. This keeps core free of any A2UI processor internals
 * while giving both client and agent a single context contract.
 */
import type { ChatStore } from '../chat/ChatStore';
import type { ActionHarness } from '../action/ActionHarness';
import type { UserAction } from '../types/hooks';
import type { LayoutDescriptor } from '../page/layout-descriptor';
import type { RenderDiagnostic, RenderDiagnosticsStore } from '../diagnostics/RenderDiagnosticsStore';
import type { AgentMessage } from './transcript';

/** A snapshot of one rendered surface for the agent to inspect. */
export interface SurfaceSnapshot {
  /** The surface's A2UI component tree. */
  components: unknown[];
  /** Live data-model values bound in the surface (form state, selections, …). */
  dataModel: Record<string, unknown>;
  /** Whether this surface is currently pinned/visible on the active page. */
  visibleOnActivePage: boolean;
  /** The region id it occupies on the active page, if pinned. */
  region?: string;
  /**
   * Generic per-surface state timeline (oldest→newest): each entry is
   * `{ seq, ts, trigger, components, dataModel? }`. Consumed by the agent's
   * getSurfaceHistory tool so the LLM can study prior states (e.g. to restore a
   * previous view). Not rendered into the prompt body.
   */
  history?: unknown[];
}

/** A page's current layout + surfaceId→regionId mapping. */
export interface PageContextEntry {
  layout: LayoutDescriptor;
  mapping: Record<string, string>;
}

/** The assembled per-turn context handed to the agent loop. */
export interface AgentContextSnapshot {
  /** Prior conversation turns (windowed), oldest-first. */
  messages: AgentMessage[];
  /** Tab the user is currently looking at: 'chat' | 'tickets' | 'reports' | … */
  activeTabId?: string | null;
  /** Per-page layout + mapping, keyed by pageId. */
  pages: Record<string, PageContextEntry>;
  /** Currently-rendered surfaces, keyed by surfaceId. */
  surfaces: Record<string, SurfaceSnapshot>;
  /** Most-recently emitted/updated surface (resolves "it" / "the chart"). */
  mostRecentSurfaceId?: string | null;
  /** Recent surfaceIds, newest first. */
  recentSurfaceIds: string[];
  /** Recent user actions, newest first. */
  recentActions: UserAction[];
  /** Most-recently pinned surface, for pageOp placeholder resolution. */
  recentPinnedSurfaceId?: string | null;
  /** SurfaceIds that live in the chat scroll. */
  chatSurfaceIds: string[];
  /** Structured render diagnostics reported by adapter components. */
  diagnostics: RenderDiagnostic[];
  /** Per-component agent-facing rendering notes from the catalog (componentName → note). */
  componentHints?: Record<string, string>;
}

export interface BuildAgentContextInput {
  /** Source of the conversation transcript. */
  chatStore: ChatStore;
  /** Source of recent user-action history. */
  actionHarness: ActionHarness;
  /** Optional source of render diagnostics to surface to the agent. */
  renderDiagnostics?: RenderDiagnosticsStore;
  /** Currently-rendered surfaces (consumer-assembled), keyed by surfaceId. */
  surfaces: Record<string, SurfaceSnapshot>;
  /** Per-page layout + mapping, keyed by pageId. */
  pages: Record<string, PageContextEntry>;
  activeTabId?: string | null;
  /** Recent surfaceIds, newest first. */
  recentSurfaceIds?: string[];
  recentPinnedSurfaceId?: string | null;
  chatSurfaceIds?: string[];
  /** Keep only the last N transcript messages (default 20). */
  transcriptLimit?: number;
  /** Include the agent's internal thoughts in the transcript (default false). */
  includeThoughts?: boolean;
  /** Keep only the last N user actions (default 10). */
  actionLimit?: number;
  /** Per-component agent-facing rendering notes (componentName → note). */
  componentHints?: Record<string, string>;
}

/**
 * Builds an {@link AgentContextSnapshot} from the live workspace primitives.
 * `mostRecentSurfaceId` is derived as the head of `recentSurfaceIds`.
 */
export function buildAgentContext(input: BuildAgentContextInput): AgentContextSnapshot {
  const {
    chatStore,
    actionHarness,
    renderDiagnostics,
    surfaces,
    pages,
    activeTabId = null,
    recentSurfaceIds = [],
    recentPinnedSurfaceId = null,
    chatSurfaceIds = [],
    transcriptLimit = 20,
    includeThoughts = false,
    actionLimit = 10,
    componentHints,
  } = input;

  return {
    messages: chatStore.toTranscript({ limit: transcriptLimit, includeThoughts }),
    activeTabId,
    pages,
    surfaces,
    mostRecentSurfaceId: recentSurfaceIds[0] ?? null,
    recentSurfaceIds,
    recentActions: actionHarness.getRecent(actionLimit),
    recentPinnedSurfaceId,
    chatSurfaceIds,
    diagnostics: renderDiagnostics?.getAll() ?? [],
    componentHints,
  };
}
