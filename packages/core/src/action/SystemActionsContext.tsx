import { createContext, useContext, type ReactNode } from 'react';

/**
 * Options for creating a page via a trusted system action.
 * `pinSurfaceId`, when present, pins that surface into the new page on creation
 * (the "track this result" case).
 */
export interface CreatePageOptions {
  /** Well-known id for dedupe (e.g. the dashboard id). Omit to auto-generate. */
  id?: string;
  title?: string;
  icon?: string;
  color?: string;
  /** Surface to pin into the new page immediately (user-initiated, so not gated). */
  pinSurfaceId?: string;
}

/**
 * Privileged, user-initiated app actions that the agent is NOT allowed to perform
 * itself. Today this is page *creation* only — the agent cannot create pages (it
 * would let it silently mutate the workspace), so the trusted `CreatePageButton`
 * routes through here on a real user click, never through the LLM.
 */
export interface SystemActions {
  /** Create a page (optionally pinning a surface into it). Returns the new page id. */
  createPage(opts: CreatePageOptions): Promise<string> | string;
}

const SystemActionsContext = createContext<SystemActions | undefined>(undefined);

export interface SystemActionsProviderProps {
  value?: SystemActions;
  children: ReactNode;
}

export function SystemActionsProvider({ value, children }: SystemActionsProviderProps) {
  return <SystemActionsContext.Provider value={value}>{children}</SystemActionsContext.Provider>;
}

/**
 * Returns the active SystemActions, or undefined if the consumer mounted none.
 * Trusted components must fall back gracefully (render disabled) when absent.
 */
export function useSystemActions(): SystemActions | undefined {
  return useContext(SystemActionsContext);
}
