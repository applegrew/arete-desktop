import type { HookContextValue, OnUserAction, UserAction } from '../types/hooks';

const MAX_HISTORY = 50;

type Listener = () => void;

interface HarnessHooks {
  onUserAction?: OnUserAction;
}

/**
 * Records and routes user actions dispatched from interactive A2UI components.
 *
 * Pattern mirrors `PageOpsHarness`: subscribable for UI indicators,
 * hook-wired so consumers receive every dispatch, with a bounded recent-history
 * buffer that can be surfaced to an agent as per-turn context.
 */
export class ActionHarness {
  private history: UserAction[] = [];
  private listeners = new Set<Listener>();
  private hooks: HarnessHooks = {};

  setHooks(hooks: Partial<HookContextValue>): void {
    this.hooks = { onUserAction: hooks.onUserAction };
  }

  /**
   * Records an action. Appends to the bounded history (newest last),
   * fires the consumer hook, and notifies subscribers.
   */
  record(action: UserAction): void {
    this.history.push(action);
    if (this.history.length > MAX_HISTORY) {
      this.history.splice(0, this.history.length - MAX_HISTORY);
    }
    this.hooks.onUserAction?.(action);
    this.emit();
  }

  /** Returns the recent actions, newest first. */
  getRecent(limit = MAX_HISTORY): UserAction[] {
    const slice = this.history.slice(-limit);
    return slice.slice().reverse();
  }

  /** Clears all recorded actions. */
  clear(): void {
    if (this.history.length === 0) return;
    this.history = [];
    this.emit();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }
}
