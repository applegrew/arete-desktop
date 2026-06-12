import { createContext, useContext, type ReactNode } from 'react';
import type { ActionHarness } from './ActionHarness';

const ActionHarnessContext = createContext<ActionHarness | undefined>(undefined);

export interface ActionHarnessProviderProps {
  harness?: ActionHarness;
  children: ReactNode;
}

export function ActionHarnessProvider({ harness, children }: ActionHarnessProviderProps) {
  return (
    <ActionHarnessContext.Provider value={harness}>
      {children}
    </ActionHarnessContext.Provider>
  );
}

/**
 * Returns the active ActionHarness, or undefined if no Shell mounted one.
 * Components that depend on the harness should fall back gracefully.
 */
export function useActionHarness(): ActionHarness | undefined {
  return useContext(ActionHarnessContext);
}

/**
 * Tracks the surface id of the currently-rendered A2UI surface so that
 * actions dispatched from inside it can be tagged with provenance.
 *
 * Populated by `<DiffOverlay>` and `<Page>` render call sites — anywhere
 * arete-desktop wraps an A2UI surface for rendering.
 */
const SurfaceIdContext = createContext<string | undefined>(undefined);

export interface SurfaceIdProviderProps {
  surfaceId: string;
  children: ReactNode;
}

export function SurfaceIdProvider({ surfaceId, children }: SurfaceIdProviderProps) {
  return <SurfaceIdContext.Provider value={surfaceId}>{children}</SurfaceIdContext.Provider>;
}

export function useSurfaceId(): string | undefined {
  return useContext(SurfaceIdContext);
}
