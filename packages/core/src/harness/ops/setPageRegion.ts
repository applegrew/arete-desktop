import type { LayoutDescriptor } from '../../page/layout-descriptor';
import type { SetPageRegionOp } from '../../types/page-ops';
import type { PageMapping } from '../../types/diff';

export interface SetPageRegionInput {
  layout: LayoutDescriptor;
  mapping: PageMapping;
}

export interface SetPageRegionResult {
  layout: LayoutDescriptor;
  mapping: PageMapping;
}

export function applySetPageRegion(
  input: SetPageRegionInput,
  op: SetPageRegionOp,
): SetPageRegionResult {
  const regionIds = new Set(input.layout.regions.map((r) => r.id));
  if (!regionIds.has(op.regionId)) {
    throw new Error(
      `Region "${op.regionId}" does not exist on page "${op.pageId}"`,
    );
  }

  const nextMapping: PageMapping = { ...input.mapping };

  if (op.surfaceId === null) {
    for (const [surfaceId, regionId] of Object.entries(nextMapping)) {
      if (regionId === op.regionId) {
        delete nextMapping[surfaceId];
      }
    }
    return { layout: input.layout, mapping: nextMapping };
  }

  for (const [surfaceId, regionId] of Object.entries(nextMapping)) {
    if (regionId === op.regionId || surfaceId === op.surfaceId) {
      delete nextMapping[surfaceId];
    }
  }
  nextMapping[op.surfaceId] = op.regionId;
  return { layout: input.layout, mapping: nextMapping };
}
