import type { ReactNode } from 'react';
import { toGridStyle, type LayoutDescriptor } from './layout-descriptor';

export interface RegionLayoutProps {
  layout: LayoutDescriptor;
  renderRegion: (regionId: string) => ReactNode;
}

export function RegionLayout({ layout, renderRegion }: RegionLayoutProps) {
  return (
    <div style={toGridStyle(layout)}>
      {layout.regions.map((region) => (
        <div
          key={region.id}
          data-region-id={region.id}
          style={{
            gridArea: layout.kind === 'grid' ? (region.gridArea ?? region.id) : undefined,
            background: '#0f0f0f',
            border: '1px solid #2a2a2a',
            borderRadius: 6,
            padding: 8,
            minHeight: 0,
            minWidth: 0,
            overflow: 'auto',
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            style={{
              fontSize: 10,
              color: '#666',
              textTransform: 'uppercase',
              letterSpacing: 1,
              marginBottom: 4,
            }}
          >
            {region.id}
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>{renderRegion(region.id)}</div>
        </div>
      ))}
    </div>
  );
}
