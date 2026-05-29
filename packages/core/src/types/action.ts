/**
 * Action types — the canonical A2UI v0.9 `action` spec (what the agent emits)
 * plus the resolved `UserAction` shape that arete-ui's runtime hands to consumers.
 */

/**
 * Spec-level action shape carried by interactive components.
 * Matches A2UI v0.9 `common_types.json` action schema.
 *
 * Example: `{ event: { name: "drillDown", context: { source: "tickets-chart" } } }`.
 */
export interface ActionSpec {
  event: {
    name: string;
    /**
     * Spec-declared context. Adapter components MAY merge their own
     * category-specific auto-context (e.g. Chart adds {label, value, index}).
     * Spec values win on key conflicts.
     */
    context?: Record<string, unknown>;
  };
}

/**
 * Resolved user action dispatched at runtime.
 * Mirrors the A2UI client→server `action` shape, with `context` already merged.
 */
export interface UserAction {
  /** Event name from the component's action spec, e.g. "drillDown". */
  name: string;
  /** Surface that generated the action (when known). */
  surfaceId?: string;
  /** Component id within that surface (when known). */
  sourceComponentId?: string;
  /** ISO timestamp at which the action fired. */
  timestamp: string;
  /** Merged context: spec-declared values merged over component auto-context. */
  context: Record<string, unknown>;
}

export type OnUserAction = (action: UserAction) => void;
