import { useEffect, useRef, useState } from 'react';

/**
 * Local mirror of an A2UI-bound value that re-syncs when the agent pushes a new
 * value through `props`.
 *
 * Interactive PrimeReact components keep a local `useState` so typing/selecting
 * feels instant before the action round-trips. But seeding that state only at
 * mount means an agent `updateComponents` that changes the value on a *reused*
 * component instance is silently ignored — the dominant A2UI correctness gap.
 *
 * This adopts external (prop) changes while leaving local edits intact: it only
 * calls `setValue` when the incoming `propValue` identity actually differs from
 * the last prop we observed.
 *
 * @param propValue the raw bound value from props (may be undefined/null)
 * @param fallback  value to use when `propValue` is nullish
 */
export function useControlledValue<T>(
  propValue: T | undefined | null,
  fallback: T,
): [T, (v: T) => void] {
  const resolve = (v: T | undefined | null): T => (v === undefined || v === null ? fallback : v);
  const [value, setValue] = useState<T>(() => resolve(propValue));
  const prevProp = useRef(propValue);
  useEffect(() => {
    if (!Object.is(prevProp.current, propValue)) {
      prevProp.current = propValue;
      setValue(resolve(propValue));
    }
    // `fallback` is only consulted when propValue is nullish; intentionally not a dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propValue]);
  return [value, setValue];
}
