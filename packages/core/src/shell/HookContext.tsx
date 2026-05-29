import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { defaultHooks, type HookContextValue } from '../types/hooks';

const HookCtx = createContext<HookContextValue>(defaultHooks);

export interface HookProviderProps {
  hooks?: Partial<HookContextValue>;
  children: ReactNode;
}

export function HookProvider({ hooks, children }: HookProviderProps) {
  const merged = useMemo<HookContextValue>(
    () => ({ ...defaultHooks, ...(hooks ?? {}) }),
    [hooks],
  );
  return <HookCtx.Provider value={merged}>{children}</HookCtx.Provider>;
}

export function useHooks(): HookContextValue {
  return useContext(HookCtx);
}
