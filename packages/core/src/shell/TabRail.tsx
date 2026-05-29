import type { ReactNode } from 'react';

export interface TabDef {
  id: string;
  label: string;
  icon: ReactNode;
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
        width: 56,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '8px 0',
        gap: 4,
        background: '#1a1a1a',
        color: '#fff',
        flexShrink: 0,
        borderRight: '1px solid #2a2a2a',
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
              width: 40,
              height: 40,
              border: 'none',
              borderRadius: 8,
              background: active ? '#3b82f6' : 'transparent',
              color: 'inherit',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 18,
            }}
          >
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
                  background: '#D97706',
                  boxShadow: '0 0 0 1.5px #1a1a1a',
                }}
              />
            )}
          </button>
        );
      })}
    </nav>
  );
}
