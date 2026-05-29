import type { LayoutDescriptor } from '../../page/layout-descriptor';
import type { PinSurfaceOp } from '../../types/page-ops';
import type { PageMapping } from '../../types/diff';

export interface PinSurfaceInput {
  layout: LayoutDescriptor;
  mapping: PageMapping;
}

export interface PinSurfaceResult {
  layout: LayoutDescriptor;
  mapping: PageMapping;
}

/**
 * Pure reducer. Returns the next mapping with the surface placed at:
 *   1. `op.region` if explicitly provided and not currently occupied
 *   2. otherwise the first empty region in `layout.regions` order
 *
 * Throws if no region is available. Layout is unchanged.
 */
export function applyPinSurface(input: PinSurfaceInput, op: PinSurfaceOp): PinSurfaceResult {
  const used = new Set(Object.values(input.mapping));
  let target = op.region;
  if (target && used.has(target)) {
    throw new Error(`Region "${target}" is already occupied on page "${op.pageId}"`);
  }
  if (!target) {
    target = input.layout.regions.find((r) => !used.has(r.id))?.id;
  }
  if (!target) {
    throw new Error(`No empty region available on page "${op.pageId}"`);
  }
  const nextMapping: PageMapping = { ...input.mapping };
  // If this surface was already pinned somewhere, remove its old entry.
  delete nextMapping[op.surfaceId];
  nextMapping[op.surfaceId] = target;
  return { layout: input.layout, mapping: nextMapping };
}
