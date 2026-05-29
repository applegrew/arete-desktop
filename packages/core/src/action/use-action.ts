import { useCallback } from 'react';
import { useHooks } from '../shell/HookContext';
import type { UserAction } from '../types/hooks';
import { useActionHarness, useSurfaceId } from './ActionHarnessContext';

export interface UseActionOpts {
  /**
   * Component id within the surface. Adapter components should pass
   * `context.componentModel.id` from the A2UI renderer.
   */
  sourceComponentId?: string;
  /**
   * Override the surfaceId from context. Normally inferred from `useSurfaceId()`
   * which is populated by the surface wrapper (DiffOverlay / Page).
   */
  surfaceId?: string;
}

export interface DispatchActionInput {
  /** Event name from the spec (action.event.name). */
  name: string;
  /**
   * Merged context to dispatch. Adapter component is responsible for merging
   * its category-specific auto-context (e.g. Chart `{label,value,index}`) with
   * the spec-declared context before calling.
   */
  context?: Record<string, unknown>;
}

export type DispatchAction = (input: DispatchActionInput) => void;

/**
 * Hook for adapter components to dispatch a user action.
 *
 * Routes the action through both the central `ActionHarness` (when mounted)
 * for history + subscribers, and the per-Shell `onUserAction` hook for
 * application-level handling. The consumer wires `onUserAction` to forward
 * actions to the agent (or wherever the application needs them).
 */
export function useAction(opts: UseActionOpts = {}): DispatchAction {
  const hooks = useHooks();
  const harness = useActionHarness();
  const contextSurfaceId = useSurfaceId();
  const surfaceId = opts.surfaceId ?? contextSurfaceId;

  return useCallback(
    (input: DispatchActionInput) => {
      const action: UserAction = {
        name: input.name,
        surfaceId,
        sourceComponentId: opts.sourceComponentId,
        timestamp: new Date().toISOString(),
        context: input.context ?? {},
      };
      if (harness) {
        harness.record(action);
      } else {
        hooks.onUserAction(action);
      }
    },
    [hooks, harness, surfaceId, opts.sourceComponentId],
  );
}
