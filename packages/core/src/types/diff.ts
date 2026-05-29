import type { LayoutDescriptor } from '../page/layout-descriptor';
import type { PageOp } from './page-ops';

export type DiffKind = 'added' | 'removed' | 'moved' | 'changed';

export interface ContentDiff {
  kind: 'content';
  surfaceId: string;
  added: string[];
  removed: string[];
  moved: string[];
  changed: string[];
}

export interface PageMapping {
  [surfaceId: string]: string;
}

export interface PageDiff {
  kind: 'page-op';
  pageId: string;
  op: PageOp;
  prev: {
    layout: LayoutDescriptor;
    mapping: PageMapping;
  };
  next: {
    layout: LayoutDescriptor;
    mapping: PageMapping;
  };
}

export function isContentDiff(d: ContentDiff | PageDiff): d is ContentDiff {
  return d.kind === 'content';
}

export function isPageDiff(d: ContentDiff | PageDiff): d is PageDiff {
  return d.kind === 'page-op';
}
