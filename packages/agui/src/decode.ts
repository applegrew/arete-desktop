/**
 * AG-UI → arete-desktop event decoder.
 *
 * AG-UI (Agent-User Interaction protocol) is the agent↔frontend transport. This
 * decoder is a *pure mapping* from an AG-UI event stream to arete-desktop-shaped
 * callbacks — it owns no transport (the consumer feeds events from `@ag-ui/client`,
 * SSE, WebSocket, …) and no UI. The consumer routes the decoded results through
 * arete-desktop's Diff Engine / Page Ops harness, keeping `@arete-desktop/core` lean.
 *
 * Convention for carrying arete UI mutations over AG-UI: the agent emits a
 * `CUSTOM` event named {@link ARETE_EMISSION_EVENT} whose `value` is an
 * `Emission` (`{ kind: 'a2ui', … }` | `{ kind: 'pageOp', … }`) from
 * `@arete-desktop/core`. A2UI surface mutations and page ops thus ride AG-UI as
 * first-class, typed custom events (text/tool/state use native AG-UI events).
 */
import { EventType, type BaseEvent } from '@ag-ui/core';
import type { Emission } from '@arete-desktop/core';

/** CUSTOM event name that carries an arete-desktop {@link Emission} as its `value`. */
export const ARETE_EMISSION_EVENT = 'arete.emission';

/** CUSTOM event name that carries discovery chips (`{ label, prompt }[]`) as its `value`. */
export const ARETE_DISCOVERY_CHIPS_EVENT = 'arete.discoveryChips';

/** A discovery chip: clicking it submits `prompt` as if the user typed it. */
export interface DiscoveryChip {
  label: string;
  prompt: string;
}

export interface TextStartInfo {
  messageId: string;
  role?: string;
}
export interface ToolCallInfo {
  toolCallId: string;
  toolCallName?: string;
}
export type StateUpdate =
  | { kind: 'snapshot'; snapshot: unknown }
  | { kind: 'delta'; delta: unknown[] };

export interface AgUiHandlers {
  onRunStarted?(info: { threadId?: string; runId?: string }): void;
  onRunFinished?(info: { result?: unknown }): void;
  onRunError?(info: { message: string; code?: string }): void;

  onTextStart?(info: TextStartInfo): void;
  /** Streaming text delta for an assistant message. */
  onTextDelta?(delta: string, info: { messageId: string }): void;
  /** Fired once a message completes, with the fully-accumulated text. */
  onTextEnd?(info: { messageId: string; text: string }): void;

  /** An arete emission (A2UI surface messages or a page op) to route via the Diff Engine / harness. */
  onEmission?(emission: Emission): void;

  /** Discovery chips the agent suggested for next steps (rendered as clickable pills). */
  onDiscoveryChips?(chips: DiscoveryChip[]): void;

  onToolCallStart?(info: ToolCallInfo): void;
  onToolCallEnd?(info: { toolCallId: string }): void;
  onToolResult?(info: { toolCallId: string; content: string; isError?: boolean }): void;

  /** Workspace/app state snapshot or RFC-6902 delta (future: route through diff). */
  onState?(update: StateUpdate): void;

  /** Any other CUSTOM event not recognized as an arete emission. */
  onCustom?(name: string, value: unknown): void;
}

/** Narrow a parsed CUSTOM `value` to an {@link Emission}. */
function asEmission(value: unknown): Emission | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (v.kind === 'a2ui' && Array.isArray(v.messages) && typeof v.targetSurfaceId === 'string') {
    return v as unknown as Emission;
  }
  if (v.kind === 'pageOp' && v.op && typeof v.op === 'object') {
    return v as unknown as Emission;
  }
  if (
    v.kind === 'widgetScript' &&
    typeof v.targetSurfaceId === 'string' &&
    typeof v.event === 'string' &&
    typeof v.code === 'string'
  ) {
    return v as unknown as Emission;
  }
  return null;
}

/** Narrow a parsed CUSTOM `value` to a list of well-formed {@link DiscoveryChip}. */
function asDiscoveryChips(value: unknown): DiscoveryChip[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((c) => {
    if (c && typeof c === 'object') {
      const o = c as Record<string, unknown>;
      if (typeof o.label === 'string' && o.label && typeof o.prompt === 'string' && o.prompt) {
        return [{ label: o.label, prompt: o.prompt }];
      }
    }
    return [];
  });
}

/**
 * Stateful decoder. Accumulates streaming text per `messageId`, and dispatches
 * each AG-UI event to the matching handler. Construct one per agent run (or
 * reuse — buffers are keyed by messageId and cleared on TEXT_MESSAGE_END).
 */
export class AgUiDecoder {
  private textBuffers = new Map<string, string>();

  constructor(private readonly handlers: AgUiHandlers = {}) {}

  /** Feed a single AG-UI event. Unknown event types are ignored. */
  handle(event: BaseEvent): void {
    const h = this.handlers;
    // `event` is a discriminated union on `type`; cast per-case to read fields.
    const e = event as unknown as Record<string, unknown>;

    switch (event.type) {
      case EventType.RUN_STARTED:
        h.onRunStarted?.({ threadId: e.threadId as string, runId: e.runId as string });
        break;
      case EventType.RUN_FINISHED:
        // Deliver any still-open assistant text BEFORE signalling completion — a
        // run can finish without a TEXT_MESSAGE_END, and onTextEnd is the only path
        // that surfaces the accumulated text, so otherwise it would be lost.
        this.flushOpenText();
        h.onRunFinished?.({ result: e.result });
        break;
      case EventType.RUN_ERROR:
        this.flushOpenText();
        h.onRunError?.({ message: String(e.message ?? 'agent run error'), code: e.code as string });
        break;

      case EventType.TEXT_MESSAGE_START: {
        const messageId = e.messageId as string;
        this.textBuffers.set(messageId, '');
        h.onTextStart?.({ messageId, role: e.role as string });
        break;
      }
      case EventType.TEXT_MESSAGE_CONTENT: {
        const messageId = e.messageId as string;
        const delta = String(e.delta ?? '');
        this.textBuffers.set(messageId, (this.textBuffers.get(messageId) ?? '') + delta);
        h.onTextDelta?.(delta, { messageId });
        break;
      }
      case EventType.TEXT_MESSAGE_END: {
        const messageId = e.messageId as string;
        const text = this.textBuffers.get(messageId) ?? '';
        this.textBuffers.delete(messageId);
        h.onTextEnd?.({ messageId, text });
        break;
      }

      case EventType.TOOL_CALL_START:
        h.onToolCallStart?.({
          toolCallId: e.toolCallId as string,
          toolCallName: e.toolCallName as string,
        });
        break;
      case EventType.TOOL_CALL_END:
        h.onToolCallEnd?.({ toolCallId: e.toolCallId as string });
        break;
      case EventType.TOOL_CALL_RESULT:
        h.onToolResult?.({
          toolCallId: e.toolCallId as string,
          content: String(e.content ?? ''),
          isError: !!e.isError,
        });
        break;

      case EventType.STATE_SNAPSHOT:
        h.onState?.({ kind: 'snapshot', snapshot: e.snapshot });
        break;
      case EventType.STATE_DELTA:
        h.onState?.({ kind: 'delta', delta: (e.delta as unknown[]) ?? [] });
        break;

      case EventType.CUSTOM: {
        const name = e.name as string;
        if (name === ARETE_EMISSION_EVENT) {
          const emission = asEmission(e.value);
          if (emission) {
            h.onEmission?.(emission);
            break;
          }
        }
        if (name === ARETE_DISCOVERY_CHIPS_EVENT) {
          const chips = asDiscoveryChips(e.value);
          if (chips.length > 0) {
            h.onDiscoveryChips?.(chips);
            break;
          }
        }
        h.onCustom?.(name, e.value);
        break;
      }

      // TEXT_MESSAGE_CHUNK / TOOL_CALL_ARGS / TOOL_CALL_CHUNK / STEP_* / RAW /
      // MESSAGES_SNAPSHOT: not needed for the v1 seam — ignored for now.
      default:
        break;
    }
  }

  /** Feed many events in order. */
  handleAll(events: BaseEvent[]): void {
    for (const event of events) this.handle(event);
  }

  /**
   * Deliver and clear any assistant text buffers that never received a
   * TEXT_MESSAGE_END. Idempotent. Call on run completion or when the underlying
   * stream closes so streamed text is never silently dropped.
   */
  flushOpenText(): void {
    if (this.textBuffers.size === 0) return;
    const pending = [...this.textBuffers.entries()];
    this.textBuffers.clear();
    for (const [messageId, text] of pending) {
      if (text.length > 0) this.handlers.onTextEnd?.({ messageId, text });
    }
  }

  /** Signal the stream has closed: flush any open text so nothing is lost. */
  end(): void {
    this.flushOpenText();
  }
}
