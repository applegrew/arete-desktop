/**
 * Render-diagnostics channel.
 *
 * Closes the agent's perception gap: the agent only ever sees the spec it
 * emitted, never what actually rendered. Adapter components report structured
 * diagnostics about how a given spec renders (e.g. "labels and data lengths
 * differ"), keyed by surface + component. A consumer's agent loop folds the
 * recent diagnostics into the next turn's context (see {@link buildAgentContext}),
 * so the agent can self-correct spec-level rendering problems — or recognise it
 * cannot, and say so honestly. This is the cheap, structured alternative to a
 * full screenshot/vision feedback loop.
 */
export type DiagnosticSeverity = 'info' | 'warning' | 'error';

export interface RenderDiagnostic {
  /** Surface the diagnostic belongs to (when known). */
  surfaceId?: string;
  /** Component id within the surface (when known). */
  componentId?: string;
  severity: DiagnosticSeverity;
  /** Stable machine code, e.g. "chart.labels-data-mismatch". */
  code: string;
  /** Human/agent-readable explanation, ideally with the fix. */
  message: string;
}

/** A diagnostic as reported by a component, before surface/component tagging. */
export type DiagnosticInput = Pick<RenderDiagnostic, 'severity' | 'code' | 'message'>;

type Listener = () => void;

function keyOf(surfaceId: string | undefined, componentId: string | undefined): string {
  return `${surfaceId ?? '?'}::${componentId ?? '?'}`;
}

/**
 * Collects per-component render diagnostics. Mirrors the ActionHarness pattern:
 * subscribable for UI, and surfaced to the agent via the context builder.
 */
export class RenderDiagnosticsStore {
  private byKey = new Map<string, RenderDiagnostic[]>();
  private listeners = new Set<Listener>();

  /**
   * Replace the diagnostics for one component instance. An empty array clears
   * them. Components call this from a render effect (and on unmount).
   */
  report(surfaceId: string | undefined, componentId: string | undefined, diagnostics: RenderDiagnostic[]): void {
    const key = keyOf(surfaceId, componentId);
    if (diagnostics.length === 0) {
      if (!this.byKey.delete(key)) return;
    } else {
      this.byKey.set(key, diagnostics);
    }
    this.emit();
  }

  /** Clear diagnostics for one component instance (e.g. on unmount). */
  clear(surfaceId: string | undefined, componentId: string | undefined): void {
    if (this.byKey.delete(keyOf(surfaceId, componentId))) this.emit();
  }

  /** All current diagnostics, flattened. */
  getAll(): RenderDiagnostic[] {
    const out: RenderDiagnostic[] = [];
    for (const list of this.byKey.values()) out.push(...list);
    return out;
  }

  /** Diagnostics for a single surface. */
  getBySurface(surfaceId: string): RenderDiagnostic[] {
    return this.getAll().filter((d) => d.surfaceId === surfaceId);
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
