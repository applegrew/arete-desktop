import type { LayoutDescriptor } from '../../page/layout-descriptor';
import type { UnpinSurfaceOp } from '../../types/page-ops';
import type { PageMapping } from '../../types/diff';

export interface UnpinSurfaceInput {
  layout: LayoutDescriptor;
  mapping: PageMapping;
}

export interface UnpinSurfaceResult {
  layout: LayoutDescriptor;
  mapping: PageMapping;
}

export function applyUnpinSurface(
  input: UnpinSurfaceInput,
  op: UnpinSurfaceOp,
): UnpinSurfaceResult {
  const nextMapping = { ...input.mapping };
  delete nextMapping[op.surfaceId];
  return { layout: input.layout, mapping: nextMapping };
}
