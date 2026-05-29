import type { MessageProcessor, A2uiMessage, SurfaceModel } from '@a2ui/web_core/v0_9';
import type { ReactComponentImplementation } from '@a2ui/react/v0_9';
import type { ContentDiff } from '../types/diff';
import type {
  HookContextValue,
  OnApprove,
  OnBeforeApply,
  OnProposed,
  OnReject,
} from '../types/hooks';
import { computeContentDiff, diffIsEmpty } from './diff-engine';

type Listener = () => void;

interface PendingEntry {
  surfaceId: string;
  bufferedMessages: A2uiMessage[];
  diff: ContentDiff;
}

interface RouterHooks {
  onBeforeApply?: OnBeforeApply;
  onProposed?: OnProposed;
  onApprove?: OnApprove;
  onReject?: OnReject;
}

function surfaceIdOf(msg: A2uiMessage): string | undefined {
  if ('createSurface' in msg) return msg.createSurface.surfaceId;
  if ('updateComponents' in msg) return msg.updateComponents.surfaceId;
  if ('deleteSurface' in msg) return msg.deleteSurface.surfaceId;
  if ('updateDataModel' in msg) return msg.updateDataModel.surfaceId;
  return undefined;
}

/**
 * Holds a live MessageProcessor and a shadow MessageProcessor. Surfaces marked as "gated"
 * have their incoming messages routed to shadow first; consumers approve/reject to commit
 * the buffered messages into live.
 *
 * Per-surface state is fully isolated.
 */
export class DiffRouter {
  private gated = new Set<string>();
  private pending = new Map<string, PendingEntry>();
  private listeners = new Set<Listener>();

  constructor(
    public readonly live: MessageProcessor<ReactComponentImplementation>,
    public readonly shadow: MessageProcessor<ReactComponentImplementation>,
    private hooks: RouterHooks = {},
  ) {}

  setHooks(hooks: Partial<HookContextValue>): void {
    this.hooks = {
      onBeforeApply: hooks.onBeforeApply,
      onProposed: hooks.onProposed,
      onApprove: hooks.onApprove,
      onReject: hooks.onReject,
    };
  }

  gateSurface(surfaceId: string): void {
    this.gated.add(surfaceId);
  }

  ungateSurface(surfaceId: string): void {
    this.gated.delete(surfaceId);
  }

  isGated(surfaceId: string): boolean {
    return this.gated.has(surfaceId);
  }

  getPending(surfaceId: string): PendingEntry | undefined {
    return this.pending.get(surfaceId);
  }

  hasPending(surfaceId: string): boolean {
    return this.pending.has(surfaceId);
  }

  getLiveSurface(surfaceId: string): SurfaceModel<ReactComponentImplementation> | undefined {
    return this.live.model.getSurface(surfaceId);
  }

  getShadowSurface(surfaceId: string): SurfaceModel<ReactComponentImplementation> | undefined {
    return this.shadow.model.getSurface(surfaceId);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Route a batch of messages. Each message goes to live or shadow depending on
   * whether its surfaceId is in the gated set. After routing, recomputes the diff
   * for every surface that received shadow messages.
   */
  route(messages: A2uiMessage[]): void {
    const filtered = this.hooks.onBeforeApply
      ? this.hooks.onBeforeApply(messages, {})
      : messages;
    if (!filtered || filtered.length === 0) return;

    const liveBatch: A2uiMessage[] = [];
    const shadowBatchBySurface = new Map<string, A2uiMessage[]>();

    for (const msg of filtered) {
      const sid = surfaceIdOf(msg);
      if (sid && this.gated.has(sid)) {
        const list = shadowBatchBySurface.get(sid) ?? [];
        list.push(msg);
        shadowBatchBySurface.set(sid, list);
      } else {
        liveBatch.push(msg);
      }
    }

    if (liveBatch.length > 0) this.live.processMessages(liveBatch);

    for (const [sid, batch] of shadowBatchBySurface) {
      this.shadow.processMessages(batch);
      const existing = this.pending.get(sid);
      const bufferedMessages = existing ? [...existing.bufferedMessages, ...batch] : batch;
      const diff = computeContentDiff(
        sid,
        this.live.model.getSurface(sid),
        this.shadow.model.getSurface(sid),
      );
      const entry: PendingEntry = { surfaceId: sid, bufferedMessages, diff };
      this.pending.set(sid, entry);
      this.hooks.onProposed?.(diff);
    }

    if (shadowBatchBySurface.size > 0) this.emit();
  }

  /**
   * Approve the pending diff for a surface: replay buffered messages into live,
   * clear the pending entry, and remove the shadow surface.
   */
  approve(surfaceId: string): void {
    const entry = this.pending.get(surfaceId);
    if (!entry) return;
    this.live.processMessages(entry.bufferedMessages);
    this.pending.delete(surfaceId);
    // Drop the shadow surface so subsequent runs start clean.
    if (this.shadow.model.getSurface(surfaceId)) {
      this.shadow.model.deleteSurface(surfaceId);
    }
    this.gated.delete(surfaceId);
    if (!diffIsEmpty(entry.diff)) this.hooks.onApprove?.(entry.diff);
    this.emit();
  }

  /**
   * Reject the pending diff: discard buffered messages, drop the shadow surface,
   * fire onReject.
   */
  reject(surfaceId: string): void {
    const entry = this.pending.get(surfaceId);
    if (!entry) return;
    this.pending.delete(surfaceId);
    if (this.shadow.model.getSurface(surfaceId)) {
      this.shadow.model.deleteSurface(surfaceId);
    }
    this.gated.delete(surfaceId);
    if (!diffIsEmpty(entry.diff)) this.hooks.onReject?.(entry.diff);
    this.emit();
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }

  pendingSurfaceIds(): string[] {
    return [...this.pending.keys()];
  }
}
