import type { LayoutDescriptor } from '../page/layout-descriptor';

export interface PinSurfaceOp {
  name: 'pinSurface';
  surfaceId: string;
  pageId: string;
  region?: string;
}

export interface UnpinSurfaceOp {
  name: 'unpinSurface';
  surfaceId: string;
  pageId: string;
}

export interface SetPageLayoutOp {
  name: 'setPageLayout';
  pageId: string;
  layout: LayoutDescriptor;
}

export interface MoveSurfaceOp {
  name: 'moveSurface';
  surfaceId: string;
  pageId: string;
  targetRegion: string;
}

export interface SetPageRegionOp {
  name: 'setPageRegion';
  pageId: string;
  regionId: string;
  surfaceId: string | null;
}

export type PageOp =
  | PinSurfaceOp
  | UnpinSurfaceOp
  | SetPageLayoutOp
  | MoveSurfaceOp
  | SetPageRegionOp;

export type PageOpName = PageOp['name'];
