import { Component, type ErrorInfo, type ReactNode } from 'react';

export interface SurfaceBoundaryProps {
  children: ReactNode;
  /** When this value changes, a caught error is cleared and children re-render. */
  resetKey?: unknown;
  /** Short label for the failing surface (e.g. its id), shown in the fallback. */
  label?: string;
}

interface SurfaceBoundaryState {
  error: Error | null;
}

/**
 * Error boundary around a single rendered A2UI surface.
 *
 * Agent- and handler-authored UI is untrusted: a malformed spec (e.g. a DataTable
 * whose `data` is undefined) throws during React render, and WITHOUT a boundary an
 * uncaught throw unmounts the WHOLE app to a blank screen. This contains the blast
 * radius to the one surface — the rest of the workspace keeps working — and offers
 * a Retry, plus auto-recovers when `resetKey` changes (e.g. the surface is replaced).
 */
export class SurfaceBoundary extends Component<SurfaceBoundaryProps, SurfaceBoundaryState> {
  state: SurfaceBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): SurfaceBoundaryState {
    return { error };
  }

  componentDidUpdate(prev: SurfaceBoundaryProps): void {
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Dev visibility; never rethrow.
    console.warn('[arete] surface render failed:', this.props.label ?? '', error.message, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            alignItems: 'flex-start',
            padding: 10,
            border: '1px solid #b45309',
            borderRadius: 6,
            background: 'rgba(180, 83, 9, 0.08)',
            color: 'var(--text-faint, #d1a36a)',
            fontSize: 12,
          }}
        >
          <span>⚠ This surface failed to render{this.props.label ? ` (${this.props.label})` : ''}.</span>
          <span style={{ opacity: 0.8 }}>{this.state.error.message}</span>
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            style={{
              background: 'transparent',
              color: 'inherit',
              border: '1px solid currentColor',
              borderRadius: 4,
              padding: '2px 10px',
              cursor: 'pointer',
              fontSize: 11,
            }}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
