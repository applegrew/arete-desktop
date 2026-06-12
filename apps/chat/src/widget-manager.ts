import type { WidgetHandler } from './persistence';

/**
 * Holds the agent-authored action handlers per surface. When a user action fires,
 * App consults `handlerFor(surfaceId, event)`; a hit is run by the Widget Manager
 * (server endpoint or, later, a client sandbox) instead of routing to the LLM.
 *
 * The agent attaches handlers via `widgetScript` emissions; they're persisted on
 * the surface (`ApiSurface.handlers`) and reloaded on startup.
 */
export class WidgetManager {
  private bySurface = new Map<string, Map<string, WidgetHandler>>();

  set(surfaceId: string, event: string, handler: WidgetHandler): void {
    let m = this.bySurface.get(surfaceId);
    if (!m) {
      m = new Map();
      this.bySurface.set(surfaceId, m);
    }
    m.set(event, handler);
  }

  handlerFor(surfaceId: string | undefined, event: string): WidgetHandler | undefined {
    if (!surfaceId) return undefined;
    return this.bySurface.get(surfaceId)?.get(event);
  }

  /** Handlers for a surface as a plain object, for persistence. Undefined if none. */
  forSurface(surfaceId: string): Record<string, WidgetHandler> | undefined {
    const m = this.bySurface.get(surfaceId);
    if (!m || m.size === 0) return undefined;
    return Object.fromEntries(m);
  }

  /** Seed handlers loaded from a persisted surface. */
  loadSurface(surfaceId: string, handlers?: Record<string, WidgetHandler>): void {
    if (!handlers) return;
    for (const [event, h] of Object.entries(handlers)) {
      if (h && typeof h.code === 'string') this.set(surfaceId, event, h);
    }
  }

  removeSurface(surfaceId: string): void {
    this.bySurface.delete(surfaceId);
  }
}
