import type { MessageProcessor, A2uiMessage, SurfaceModel } from '@a2ui/web_core/v0_9';
import type { ReactComponentImplementation } from '@a2ui/react/v0_9';
import type { ContentDiff } from '../types/diff';
import type {
  ApplyContext,
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

  /**
   * Serialize a live surface's component tree back into the flat A2UI
   * `updateComponents` shape (`{ id, component, ...props }[]`). Returns `undefined`
   * if the surface doesn't exist. Used both to seed the shadow and to let consumers
   * re-snapshot a surface after an approval commits buffered messages into live.
   */
  liveComponents(surfaceId: string): Array<Record<string, unknown>> | undefined {
    const liveSurface = this.live.model.getSurface(surfaceId);
    if (!liveSurface) return undefined;
    const components: Array<Record<string, unknown>> = [];
    for (const [id, comp] of liveSurface.componentsModel.entries) {
      components.push({ id, component: comp.type, ...(comp.properties as Record<string, unknown>) });
    }
    return components;
  }

  /** Mirror the current live surface into the shadow processor so a subsequent
   *  gated update diffs against real prior state (not an empty shadow). */
  private seedShadowFromLive(surfaceId: string): void {
    const liveSurface = this.live.model.getSurface(surfaceId);
    if (!liveSurface) return;
    const components = this.liveComponents(surfaceId) ?? [];
    const seed = [
      { version: 'v0.9', createSurface: { surfaceId, catalogId: liveSurface.catalog.id, sendDataModel: true } },
      { version: 'v0.9', updateComponents: { surfaceId, components } },
    ] as unknown as A2uiMessage[];
    this.shadow.processMessages(seed);
  }

  /**
   * Recompute a pending diff against the CURRENT live state. Called when a live
   * mutation drifts the baseline out from under a pending shadow diff, so the
   * preview the user sees keeps matching what approve() will commit (C3).
   */
  private rebasePending(surfaceId: string): void {
    const existing = this.pending.get(surfaceId);
    if (!existing) return;
    // Throw away the stale shadow, re-seed from the new live, replay the proposal.
    if (this.shadow.model.getSurface(surfaceId)) {
      this.shadow.model.deleteSurface(surfaceId);
    }
    const buffered = existing.bufferedMessages;
    const batchCreates = buffered.some((m) => 'createSurface' in m);
    if (!batchCreates && this.live.model.getSurface(surfaceId)) {
      this.seedShadowFromLive(surfaceId);
    }
    this.shadow.processMessages(buffered);
    const diff = computeContentDiff(
      surfaceId,
      this.live.model.getSurface(surfaceId),
      this.shadow.model.getSurface(surfaceId),
    );
    this.pending.set(surfaceId, { surfaceId, bufferedMessages: buffered, diff });
    this.hooks.onProposed?.(diff);
    this.emit();
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
  route(messages: A2uiMessage[], opts?: { bypassGate?: boolean }): void {
    // Build the RBAC/audit context the hook expects (was previously always empty).
    const surfaceIds: string[] = [];
    for (const m of messages) {
      const s = surfaceIdOf(m);
      if (s && !surfaceIds.includes(s)) surfaceIds.push(s);
    }
    const ctx: ApplyContext = {
      surfaceId: surfaceIds.length === 1 ? surfaceIds[0] : undefined,
      surfaceIds,
      bypassGate: opts?.bypassGate ?? false,
    };
    const filtered = this.hooks.onBeforeApply ? this.hooks.onBeforeApply(messages, ctx) : messages;
    if (!filtered || filtered.length === 0) return;

    const liveBatch: A2uiMessage[] = [];
    const shadowBatchBySurface = new Map<string, A2uiMessage[]>();

    for (const msg of filtered) {
      const sid = surfaceIdOf(msg);
      // `bypassGate` (user-action-driven edits) applies straight to live even for
      // surfaces in the gated set — those changes are the user's own doing.
      if (!opts?.bypassGate && sid && this.gated.has(sid)) {
        const list = shadowBatchBySurface.get(sid) ?? [];
        list.push(msg);
        shadowBatchBySurface.set(sid, list);
      } else {
        liveBatch.push(msg);
      }
    }

    if (liveBatch.length > 0) {
      this.live.processMessages(liveBatch);
      // If a live mutation (e.g. a `bypassGate` user edit) touched a surface that
      // already has a pending shadow diff, the diff baseline has drifted: the diff
      // was computed against the old live, but approve() will replay buffered
      // messages onto the new live — preview would no longer match applied. Re-base
      // the pending diff against the new live so the two stay in lockstep (C3).
      const liveTouched = new Set<string>();
      for (const m of liveBatch) {
        const s = surfaceIdOf(m);
        if (s && this.pending.has(s)) liveTouched.add(s);
      }
      for (const sid of liveTouched) this.rebasePending(sid);
    }

    for (const [sid, batch] of shadowBatchBySurface) {
      // Gating a MODIFICATION to a surface that exists only in `live` (created or
      // restored earlier): seed the shadow with the current live state first, so
      // the diff reflects live→proposed. Without this, an updateComponents would
      // apply to an empty shadow and produce no meaningful diff (so the change
      // would appear ungated).
      const batchCreates = batch.some((m) => 'createSurface' in m);
      if (!batchCreates && !this.shadow.model.getSurface(sid) && this.live.model.getSurface(sid)) {
        this.seedShadowFromLive(sid);
      }
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
    // NOTE: do NOT un-gate here. Gating is a property of the surface (the consumer
    // owns it via gate/ungateSurface); auto-ungating on resolve would let the next
    // agent message land straight on live, silently bypassing the diff engine.
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
    // Keep the surface gated (see approve()): the consumer owns gating lifetime.
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
