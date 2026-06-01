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
            background: 'var(--glass, #0f0f0f)',
            backdropFilter: 'var(--blur)',
            WebkitBackdropFilter: 'var(--blur)',
            border: '1px solid var(--glass-border, #2a2a2a)',
            borderRadius: 'var(--radius, 14px)',
            padding: 12,
            minHeight: 0,
            minWidth: 0,
            overflow: 'auto',
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05)',
          }}
        >
          <div
            style={{
              fontSize: 10,
              color: 'var(--text-faint, #666)',
              textTransform: 'uppercase',
              letterSpacing: 1.4,
              marginBottom: 6,
              fontFamily: 'var(--font-display)',
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
