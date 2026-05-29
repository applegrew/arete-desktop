import type { LayoutDescriptor } from '../../page/layout-descriptor';
import type { MoveSurfaceOp } from '../../types/page-ops';
import type { PageMapping } from '../../types/diff';

export interface MoveSurfaceInput {
  layout: LayoutDescriptor;
  mapping: PageMapping;
}

export interface MoveSurfaceResult {
  layout: LayoutDescriptor;
  mapping: PageMapping;
}

export function applyMoveSurface(
  input: MoveSurfaceInput,
  op: MoveSurfaceOp,
): MoveSurfaceResult {
  if (!(op.surfaceId in input.mapping)) {
    throw new Error(
      `Surface "${op.surfaceId}" is not pinned on page "${op.pageId}"`,
    );
  }
  const regionIds = new Set(input.layout.regions.map((r) => r.id));
  if (!regionIds.has(op.targetRegion)) {
    throw new Error(
      `Target region "${op.targetRegion}" does not exist on page "${op.pageId}"`,
    );
  }
  const currentRegion = input.mapping[op.surfaceId];
  if (op.targetRegion === currentRegion) {
    return { layout: input.layout, mapping: input.mapping };
  }
  const used = new Set(Object.values(input.mapping));
  if (used.has(op.targetRegion)) {
    throw new Error(
      `Target region "${op.targetRegion}" is already occupied on page "${op.pageId}"`,
    );
  }
  const nextMapping: PageMapping = { ...input.mapping };
  delete nextMapping[op.surfaceId];
  nextMapping[op.surfaceId] = op.targetRegion;
  return { layout: input.layout, mapping: nextMapping };
}
