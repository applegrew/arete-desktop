import type React from 'react';

export interface RegionSpec {
  id: string;
  gridArea?: string;
}

export interface GridLayout {
  kind: 'grid';
  rows: number;
  cols: number;
  regions: RegionSpec[];
}

export interface SplitLayout {
  kind: 'split';
  direction: 'row' | 'column';
  regions: RegionSpec[];
}

export interface DockLayout {
  kind: 'dock';
  regions: RegionSpec[];
}

export type LayoutDescriptor = GridLayout | SplitLayout | DockLayout;

export function regionIds(layout: LayoutDescriptor): string[] {
  return layout.regions.map((r) => r.id);
}

export function toGridStyle(layout: LayoutDescriptor): React.CSSProperties {
  switch (layout.kind) {
    case 'grid': {
      const areas: string[][] = Array.from({ length: layout.rows }, () =>
        Array.from({ length: layout.cols }, () => '.'),
      );
      layout.regions.forEach((r, idx) => {
        if (r.gridArea) return;
        const row = Math.floor(idx / layout.cols);
        const col = idx % layout.cols;
        if (row < layout.rows && col < layout.cols) {
          areas[row]![col] = r.id;
        }
      });
      return {
        display: 'grid',
        gridTemplateRows: `repeat(${layout.rows}, 1fr)`,
        gridTemplateColumns: `repeat(${layout.cols}, 1fr)`,
        gridTemplateAreas: areas.map((row) => `"${row.join(' ')}"`).join(' '),
        gap: 8,
        width: '100%',
        height: '100%',
      };
    }
    case 'split':
      return {
        display: 'flex',
        flexDirection: layout.direction,
        gap: 8,
        width: '100%',
        height: '100%',
      };
    case 'dock':
      return {
        display: 'grid',
        gridTemplateAreas: '"main"',
        width: '100%',
        height: '100%',
      };
  }
}
