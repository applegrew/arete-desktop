import type { ReactNode } from 'react';

export interface TabDef {
  id: string;
  label: string;
  icon: ReactNode;
  color?: string;
}

export interface TabRailProps {
  tabs: TabDef[];
  activeTabId: string | null;
  onSelect: (tabId: string) => void;
  /** Per-tab pending-diff indicator. When true, a small amber dot is shown on the tab. */
  pendingByTabId?: Record<string, boolean>;
}

export function TabRail({ tabs, activeTabId, onSelect, pendingByTabId }: TabRailProps) {
  return (
    <nav
      aria-label="Application tabs"
      style={{
        width: 64,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '12px 0',
        gap: 8,
        background: 'var(--glass, #1a1a1a)',
        backdropFilter: 'var(--blur)',
        WebkitBackdropFilter: 'var(--blur)',
        color: 'var(--text, #fff)',
        flexShrink: 0,
        borderRight: '1px solid var(--hairline, #2a2a2a)',
      }}
    >
      {tabs.map((tab) => {
        const active = tab.id === activeTabId;
        const pending = !!pendingByTabId?.[tab.id];
        return (
          <button
            key={tab.id}
            type="button"
            title={pending ? `${tab.label} (pending review)` : tab.label}
            aria-label={tab.label}
            aria-current={active ? 'page' : undefined}
            onClick={() => onSelect(tab.id)}
            style={{
              position: 'relative',
              width: 46,
              height: 46,
              border: active ? '1px solid var(--glass-border-2, #3b82f6)' : '1px solid transparent',
              borderRadius: 14,
              background: active
                ? 'linear-gradient(160deg, rgba(124,131,255,0.42), rgba(34,211,238,0.22))'
                : 'var(--glass, transparent)',
              color: 'inherit',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 19,
              transition: 'transform 0.18s ease, background 0.2s ease, box-shadow 0.2s ease',
              boxShadow: active
                ? '0 6px 20px -4px rgba(124,131,255,0.55), inset 0 1px 0 rgba(255,255,255,0.25)'
                : 'inset 0 1px 0 rgba(255,255,255,0.06)',
              outline: tab.color ? `2px solid ${tab.color}` : undefined,
              outlineOffset: tab.color ? '-46px' : undefined,
            }}
            onMouseEnter={(e) => {
              if (!active) e.currentTarget.style.background = 'var(--glass-2, rgba(255,255,255,0.09))';
              e.currentTarget.style.transform = 'translateY(-1px)';
            }}
            onMouseLeave={(e) => {
              if (!active) e.currentTarget.style.background = 'var(--glass, transparent)';
              e.currentTarget.style.transform = 'translateY(0)';
            }}
          >
            {tab.color && (
              <span
                aria-hidden
                style={{
                  position: 'absolute',
                  left: 5,
                  top: 11,
                  bottom: 11,
                  width: 3,
                  borderRadius: 3,
                  background: tab.color,
                }}
              />
            )}
            {tab.icon}
            {pending && (
              <span
                aria-hidden
                style={{
                  position: 'absolute',
                  top: 4,
                  right: 4,
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: '#fbbf24',
                  boxShadow: '0 0 0 2px rgba(7,7,16,0.7), 0 0 10px rgba(251,191,36,0.7)',
                }}
              />
            )}
          </button>
        );
      })}
    </nav>
  );
}
