export function deepEqual(a: unknown, b: unknown): boolean {
  return eq(a, b, new WeakMap());
}

function eq(a: unknown, b: unknown, seen: WeakMap<object, unknown>): boolean {
  // Use Object.is so NaN === NaN (avoids a spurious "changed" diff) and +0/-0
  // are distinguished consistently.
  if (Object.is(a, b)) return true;
  if (a == null || b == null) return false;
  if (typeof a !== typeof b) return false;

  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    // Cycle guard: if we've already paired `a` with `b`, treat as equal.
    if (seen.get(a) === b) return true;
    seen.set(a, b);
    for (let i = 0; i < a.length; i++) {
      if (!eq(a[i], b[i], seen)) return false;
    }
    return true;
  }

  if (typeof a === 'object') {
    if (Array.isArray(b)) return false;
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    if (seen.get(ao) === bo) return true;
    seen.set(ao, bo);
    const ak = Object.keys(ao);
    const bk = Object.keys(bo);
    if (ak.length !== bk.length) return false;
    for (const k of ak) {
      if (!Object.prototype.hasOwnProperty.call(bo, k)) return false;
      if (!eq(ao[k], bo[k], seen)) return false;
    }
    return true;
  }

  return false;
}
