import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { useSurfaceId } from '../action/ActionHarnessContext';
import {
  RenderDiagnosticsStore,
  type DiagnosticInput,
  type RenderDiagnostic,
} from './RenderDiagnosticsStore';

const RenderDiagnosticsContext = createContext<RenderDiagnosticsStore | undefined>(undefined);

export interface RenderDiagnosticsProviderProps {
  store?: RenderDiagnosticsStore;
  children: ReactNode;
}

export function RenderDiagnosticsProvider({ store, children }: RenderDiagnosticsProviderProps) {
  return (
    <RenderDiagnosticsContext.Provider value={store}>{children}</RenderDiagnosticsContext.Provider>
  );
}

/** The active store, or undefined if no Shell mounted one. */
export function useRenderDiagnosticsStore(): RenderDiagnosticsStore | undefined {
  return useContext(RenderDiagnosticsContext);
}

/**
 * Declaratively publish an adapter component's render diagnostics.
 *
 * Adapter components compute their current diagnostics each render and pass
 * them here; the hook reports them (tagged with the surface + component id) and
 * clears them on unmount. No-op when no store is mounted. Example:
 *
 * ```ts
 * useReportDiagnostics(context.componentModel.id,
 *   labels.length !== data.length
 *     ? [{ severity: 'warning', code: 'chart.labels-data-mismatch', message: '…' }]
 *     : []);
 * ```
 */
export function useReportDiagnostics(
  componentId: string | undefined,
  diagnostics: DiagnosticInput[],
): void {
  const store = useRenderDiagnosticsStore();
  const surfaceId = useSurfaceId();
  // Stable signature so we only re-report when the diagnostics actually change.
  const signature = JSON.stringify(diagnostics);

  useEffect(() => {
    if (!store) return;
    const tagged: RenderDiagnostic[] = diagnostics.map((d) => ({ ...d, surfaceId, componentId }));
    store.report(surfaceId, componentId, tagged);
    return () => store.clear(surfaceId, componentId);
    // `signature` captures the diagnostics' contents; surfaceId/componentId/store identity also matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, surfaceId, componentId, signature]);
}
