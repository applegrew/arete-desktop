import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { HookProvider } from './HookContext';
import { TabRail, type TabDef } from './TabRail';
import { Chat, type ChatMode } from '../chat/Chat';
import { ChatStore } from '../chat/ChatStore';
import { defaultShellState, type ShellState } from '../types/shell-state';
import type { HookContextValue } from '../types/hooks';
import { ActionHarnessProvider } from '../action/ActionHarnessContext';
import type { ActionHarness } from '../action/ActionHarness';
import type { PageOpsHarness } from '../harness/PageOpsHarness';

export interface ShellTab {
  id: string;
  label: string;
  icon: ReactNode;
  render: () => ReactNode;
  /**
   * Page ids hosted by this tab. Used to auto-switch tabs when a page op
   * targets a page on an inactive tab. Defaults to `[id]` (tab id === page id).
   */
  pageIds?: string[];
}

export interface ChatTabConfig {
  tab: Omit<ShellTab, 'render'>;
  renderSurface?: (surfaceId: string, entryId: string) => ReactNode;
}

export interface ShellProps {
  tabs: ShellTab[];
  chatTab?: ChatTabConfig;
  topBar?: ReactNode;
  hooks?: Partial<HookContextValue>;
  state?: ShellState;
  onStateChange?: (next: ShellState) => void;
  chatStore?: ChatStore;
  /** Per-tab pending-review indicator. Consumer computes from router + harness state. */
  pendingByTabId?: Record<string, boolean>;
  /** Optional action harness. When provided, components using `useAction()` route through it. */
  actionHarness?: ActionHarness;
  /**
   * Optional page-ops harness. When provided, the Shell auto-switches to the
   * tab hosting a page whenever a page op targets a page that isn't mounted —
   * so the op applies and its Approve/Reject preview is visible. Consumers just
   * call `harness.apply(op)`; the tab switch is handled here.
   */
  harness?: PageOpsHarness;
}

function pickInitialActive(tabs: ShellTab[], chat: ChatTabConfig | undefined): string | null {
  if (chat) return chat.tab.id;
  return tabs[0]?.id ?? null;
}

export function Shell({
  tabs,
  chatTab,
  topBar,
  hooks,
  state,
  onStateChange,
  chatStore,
  pendingByTabId,
  actionHarness,
  harness,
}: ShellProps) {
  const store = useMemo(() => chatStore ?? new ChatStore(), [chatStore]);

  const [internalState, setInternalState] = useState<ShellState>(() => ({
    ...defaultShellState,
    activeTabId: pickInitialActive(tabs, chatTab),
  }));
  const current = state ?? internalState;

  const setState = useCallback(
    (next: ShellState) => {
      if (state) {
        onStateChange?.(next);
      } else {
        setInternalState(next);
        onStateChange?.(next);
      }
    },
    [state, onStateChange],
  );

  // pageId → tabId index (explicit `pageIds`, else tab id by convention).
  const pageToTab = useMemo(() => {
    const m = new Map<string, string>();
    for (const tab of tabs) {
      for (const pid of tab.pageIds ?? [tab.id]) m.set(pid, tab.id);
    }
    return m;
  }, [tabs]);

  // Refs keep the long-lived activation subscription free of stale closures
  // (and avoid resubscribing on every controlled-state update).
  const currentRef = useRef(current);
  currentRef.current = current;
  const setStateRef = useRef(setState);
  setStateRef.current = setState;
  const pageToTabRef = useRef(pageToTab);
  pageToTabRef.current = pageToTab;

  // Auto-switch to the tab hosting a page when a page op targets it while
  // inactive. Switching mounts the <Page>, which registers and flushes the op.
  useEffect(() => {
    if (!harness) return;
    return harness.subscribeActivation((pageId) => {
      const tabId = pageToTabRef.current.get(pageId) ?? pageId;
      if (currentRef.current.activeTabId === tabId) return;
      setStateRef.current({ ...currentRef.current, activeTabId: tabId });
    });
  }, [harness]);

  const selectTab = (tabId: string) => setState({ ...current, activeTabId: tabId });
  const setChatMode = (mode: ChatMode) => setState({ ...current, chatDockState: mode });

  const allTabs: TabDef[] = useMemo(() => {
    const t: TabDef[] = [];
    if (chatTab) t.push({ id: chatTab.tab.id, label: chatTab.tab.label, icon: chatTab.tab.icon });
    for (const tab of tabs) t.push({ id: tab.id, label: tab.label, icon: tab.icon });
    return t;
  }, [tabs, chatTab]);

  const activeId = current.activeTabId;
  const isChatActive = chatTab != null && activeId === chatTab.tab.id;

  const mainContent: ReactNode = isChatActive
    ? null
    : (tabs.find((t) => t.id === activeId)?.render() ?? (
        <div style={{ padding: 24, color: '#888' }}>No tab selected</div>
      ));

  const chatMode: ChatMode = isChatActive ? 'page' : current.chatDockState;

  return (
    <HookProvider hooks={hooks}>
      <ActionHarnessProvider harness={actionHarness}>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100vh',
          width: '100vw',
          background: '#0a0a0a',
          color: '#eee',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        {topBar && (
          <header
            style={{
              flexShrink: 0,
              borderBottom: '1px solid #2a2a2a',
              background: '#111',
              padding: '8px 16px',
            }}
          >
            {topBar}
          </header>
        )}
        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          <TabRail
            tabs={allTabs}
            activeTabId={activeId}
            onSelect={selectTab}
            pendingByTabId={pendingByTabId}
          />
          <main style={{ flex: 1, display: 'flex', minWidth: 0 }}>
            {mainContent && (
              <div style={{ flex: 1, minWidth: 0, overflow: 'auto' }}>{mainContent}</div>
            )}
            {chatTab && (
              <Chat
                store={store}
                mode={chatMode}
                onModeChange={setChatMode}
                renderSurface={chatTab.renderSurface}
              />
            )}
          </main>
        </div>
      </div>
      </ActionHarnessProvider>
    </HookProvider>
  );
}
