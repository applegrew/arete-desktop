import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MessageProcessor } from '@a2ui/web_core/v0_9';
import {
  A2uiSurface,
  MarkdownContext,
  type ReactComponentImplementation,
} from '@a2ui/react/v0_9';
import { renderMarkdown } from '@a2ui/markdown-it';
import {
  Shell,
  Page,
  ChatStore,
  DiffRouter,
  DiffOverlay,
  PageOpsHarness,
  ActionHarness,
  RenderDiagnosticsStore,
  withComponentIds,
  buildAgentContext,
  type ShellTab,
  type ShellState,
  type LayoutDescriptor,
  type Diff,
  type UserAction,
  type SurfaceSnapshot,
} from '@arete-ui/core';
import { primeReactCatalog, componentAgentHints } from '@arete-ui/adapter-primereact';
import { fixtures, findFixture, type Emission, type FixtureContext } from './mock-agent';
import {
  loadState,
  loadChat,
  saveChat,
  appendApproval,
} from './persistence';
import { getAgentHealth } from './agent-client';
import { streamAgent } from './agui-client';

const TICKETS_LAYOUT: LayoutDescriptor = {
  kind: 'grid',
  rows: 2,
  cols: 2,
  regions: [
    { id: 'top-left' },
    { id: 'top-right' },
    { id: 'bottom-left' },
    { id: 'bottom-right' },
  ],
};

const REPORTS_LAYOUT: LayoutDescriptor = {
  kind: 'grid',
  rows: 1,
  cols: 2,
  regions: [{ id: 'left' }, { id: 'right' }],
};

const REGION_ORDER: Record<string, string[]> = {
  tickets: ['top-left', 'top-right', 'bottom-left', 'bottom-right'],
  reports: ['left', 'right'],
};

function describeContentCounts(d: {
  added: ReadonlyArray<unknown>;
  changed: ReadonlyArray<unknown>;
  removed: ReadonlyArray<unknown>;
}): string {
  const parts: string[] = [];
  if (d.added.length) parts.push(`${d.added.length} added`);
  if (d.changed.length) parts.push(`${d.changed.length} updated`);
  if (d.removed.length) parts.push(`${d.removed.length} removed`);
  return parts.length ? parts.join(', ') : 'no changes';
}

export function App() {
  const [agentMode, setAgentMode] = useState<'fixtures' | 'ollama'>('fixtures');
  const [agentAvailable, setAgentAvailable] = useState(false);

  const currentCatalog = useMemo(() => withComponentIds(primeReactCatalog), []);

  const liveProcessor = useMemo(
    () => new MessageProcessor<ReactComponentImplementation>([currentCatalog]),
    [currentCatalog],
  );
  const shadowProcessor = useMemo(
    () => new MessageProcessor<ReactComponentImplementation>([currentCatalog]),
    [currentCatalog],
  );
  const router = useMemo(
    () => new DiffRouter(liveProcessor, shadowProcessor),
    [liveProcessor, shadowProcessor],
  );
  const harness = useMemo(() => new PageOpsHarness(), []);
  const actionHarness = useMemo(() => new ActionHarness(), []);
  const renderDiagnostics = useMemo(() => new RenderDiagnosticsStore(), []);
  const chatStore = useMemo(() => new ChatStore(), []);
  const [ticketsMapping, setTicketsMapping] = useState<Record<string, string>>({});
  const [reportsMapping, setReportsMapping] = useState<Record<string, string>>({});
  const [reportsLayout, setReportsLayout] = useState<LayoutDescriptor>(REPORTS_LAYOUT);
  const [ticketsLayout, setTicketsLayout] = useState<LayoutDescriptor>(TICKETS_LAYOUT);
  const [diffsGated, setDiffsGated] = useState(true);

  const pinnedSurfaceIdsRef = useRef<Set<string>>(new Set());
  const surfaceContentsRef = useRef<Record<string, unknown[]>>({});
  const recentSurfaceIdsRef = useRef<string[]>([]);
  const handlePromptRef = useRef<(text: string) => void>(() => {});
  const [shellState, setShellState] = useState<ShellState>({
    activeTabId: 'chat',
    chatDockState: 'dock',
  });

  const captureSurfaceContents = useCallback((messages: unknown[]) => {
    for (const msg of messages) {
      if (!msg || typeof msg !== 'object') continue;
      const m = msg as Record<string, unknown>;
      if (m.updateComponents && typeof m.updateComponents === 'object') {
        const uc = m.updateComponents as Record<string, unknown>;
        const sid = typeof uc.surfaceId === 'string' ? uc.surfaceId : null;
        const comps = Array.isArray(uc.components) ? uc.components : null;
        if (sid && comps) {
          surfaceContentsRef.current[sid] = comps;
          recentSurfaceIdsRef.current = [
            sid,
            ...recentSurfaceIdsRef.current.filter((x) => x !== sid),
          ].slice(0, 10);
        }
      }
      if (m.deleteSurface && typeof m.deleteSurface === 'object') {
        const ds = m.deleteSurface as Record<string, unknown>;
        const sid = typeof ds.surfaceId === 'string' ? ds.surfaceId : null;
        if (sid) {
          delete surfaceContentsRef.current[sid];
          recentSurfaceIdsRef.current = recentSurfaceIdsRef.current.filter((x) => x !== sid);
        }
      }
    }
  }, []);

  const [routerTick, setRouterTick] = useState(0);
  const [harnessTick, setHarnessTick] = useState(0);

  useEffect(() => {
    const unsubRouter = router.subscribe(() => setRouterTick((n) => n + 1));
    const unsubHarness = harness.subscribe(() => setHarnessTick((n) => n + 1));
    return () => {
      unsubRouter();
      unsubHarness();
    };
  }, [router, harness]);

  const pendingByTabId = useMemo<Record<string, boolean>>(() => {
    const p: Record<string, boolean> = {};

    for (const sid of router.pendingSurfaceIds()) {
      if (ticketsMapping[sid]) p['tickets'] = true;
      else if (reportsMapping[sid]) p['reports'] = true;
      else p['chat'] = true;
    }

    if (harness.hasPending('tickets')) p['tickets'] = true;
    if (harness.hasPending('reports')) p['reports'] = true;

    return p;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routerTick, harnessTick, ticketsMapping, reportsMapping]);

  const inMotionSurfaceIds = useMemo<Set<string>>(() => {
    const ids = new Set<string>();
    for (const pageId of ['tickets', 'reports']) {
      const pending = harness.getPending(pageId);
      if (pending?.op.name === 'pinSurface') {
        ids.add(pending.op.surfaceId);
      }
    }
    return ids;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [harnessTick]);

  useEffect(() => {
    const sharedHooks = {
      onProposed: (d: Diff) =>
        chatStore.push({
          role: 'system',
          text:
            d.kind === 'content'
              ? `Agent proposed changes to ${d.surfaceId}: ${describeContentCounts(d)}. Review below.`
              : `Agent proposed ${d.op.name} on page ${d.pageId}. Review below.`,
        }),
      onApprove: (d: Diff) => {
        chatStore.push({
          role: 'agent',
          text: d.kind === 'content' ? `approved ${d.surfaceId}` : `approved ${d.op.name}`,
        });
        if (d.kind === 'page-op' && d.op.name === 'pinSurface') {
          pinnedSurfaceIdsRef.current.add(d.op.surfaceId);
          chatStore.removeBySurfaceId(d.op.surfaceId);
          if (diffsGated) router.gateSurface(d.op.surfaceId);
        }
        appendApproval({
          kind: d.kind,
          surfaceId: d.kind === 'content' ? d.surfaceId : undefined,
          pageId: d.kind === 'page-op' ? d.pageId : undefined,
          opName: d.kind === 'page-op' ? d.op.name : undefined,
          decision: 'approved',
          diffJson: d,
        }).catch(() => {});
      },
      onReject: (d: Diff) => {
        chatStore.push({
          role: 'system',
          text:
            d.kind === 'content'
              ? `Changes to '${d.surfaceId}' rejected.`
              : `Layout changes rejected by user. Resetting to previous state.`,
        });
        appendApproval({
          kind: d.kind,
          surfaceId: d.kind === 'content' ? d.surfaceId : undefined,
          pageId: d.kind === 'page-op' ? d.pageId : undefined,
          opName: d.kind === 'page-op' ? d.op.name : undefined,
          decision: 'rejected',
          diffJson: d,
        }).catch(() => {});
      },
      onBeforeApply: (messages: unknown[]) => {
        console.info('[arete-ui] onBeforeApply', messages);
        return messages as never;
      },
      onPageOp: (op: unknown) => {
        console.info('[arete-ui] onPageOp', op);
        return op as never;
      },
      onUserAction: (action: UserAction) => {
        const contextStr = JSON.stringify(action.context);
        const surfaceClause = action.surfaceId ? ` on surface ${action.surfaceId}` : '';
        const componentClause = action.sourceComponentId
          ? ` (component ${action.sourceComponentId})`
          : '';
        const synth = `[USER ACTION] event "${action.name}"${surfaceClause}${componentClause}; context: ${contextStr}`;
        chatStore.push({ role: 'user', text: synth });
        handlePromptRef.current(synth);
      },
    };
    router.setHooks(sharedHooks);
    harness.setHooks(sharedHooks);
    actionHarness.setHooks(sharedHooks);
     
  }, [router, harness, actionHarness, chatStore, diffsGated]);

  useEffect(() => {
    loadChat().then((entries) => {
      if (entries.length > 0) {
        for (const e of entries) {
          chatStore.push({
            role: e.role as 'user' | 'agent' | 'system',
            text: e.text,
            surfaceId: e.surfaceId,
            id: e.id,
          });
        }
      }
    }).catch(() => {});
    loadState().catch(() => {});
    getAgentHealth().then((h) => {
      if (h.ok) {
        setAgentAvailable(true);
        setAgentMode('ollama');
      }
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const saveTimer = setTimeout(() => {
      const entries = chatStore.getSnapshot().map((e) => ({
        id: e.id,
        role: e.role,
        text: e.text ?? '',
        surfaceId: e.surfaceId,
        createdAt: e.createdAt,
      }));
      saveChat(entries).catch(() => {});
    }, 2000);
    return () => clearTimeout(saveTimer);
  }, [chatStore]);

  const buildCtx = useCallback(
    (): FixtureContext => ({
      chatSurfaceIds: chatStore
        .getSnapshot()
        .filter((e) => e.surfaceId != null)
        .map((e) => e.surfaceId!),
      recentPinnedSurfaceId: [...pinnedSurfaceIdsRef.current].pop() ?? null,
    }),
    [chatStore],
  );

  const handleEmission = useCallback(
    (em: Emission) => {
      if (em.kind === 'a2ui') {
        const isPinned = pinnedSurfaceIdsRef.current.has(em.targetSurfaceId);
        if (diffsGated && isPinned) router.gateSurface(em.targetSurfaceId);
        captureSurfaceContents(em.messages);
        router.route(em.messages);
        chatStore.push({
          role: 'agent',
          surfaceId: em.targetSurfaceId,
        });
      } else if (em.kind === 'pageOp') {
        harness.apply(em.op as never);
      }
    },
    [router, harness, diffsGated, chatStore, captureSurfaceContents],
  );

  const handlePrompt = useCallback(
    async (text: string) => {
      if (agentMode === 'fixtures') {
        const fx = findFixture(text);
        if (!fx) {
          chatStore.push({ role: 'agent', text: `(no fixture matched "${text}")` });
          return;
        }
        for (const em of fx.build(buildCtx())) handleEmission(em);
        return;
      }
      const activeMapping =
        shellState.activeTabId === 'tickets'
          ? ticketsMapping
          : shellState.activeTabId === 'reports'
            ? reportsMapping
            : {};
      const surfacesPayload: Record<string, SurfaceSnapshot> = {};
      for (const [sid, components] of Object.entries(surfaceContentsRef.current)) {
        const liveSurface = liveProcessor.model.getSurface(sid);
        let dataModel: Record<string, unknown> = {};
        try {
          const dm = liveSurface?.dataModel?.get('/');
          if (dm && typeof dm === 'object') dataModel = dm as Record<string, unknown>;
        } catch {
          /* surface might be deleted or processor lacks the surface */
        }
        const region = activeMapping[sid];
        surfacesPayload[sid] = {
          components,
          dataModel,
          visibleOnActivePage: region != null,
          region,
        };
      }

      // arete-ui core assembles the per-turn context — including the
      // conversation transcript and recent actions — so the consumer's agent
      // loop can thread it as history. The loop itself lives server-side.
      const { messages: allMessages, ...agentContext } = buildAgentContext({
        chatStore,
        actionHarness,
        renderDiagnostics,
        componentHints: componentAgentHints,
        surfaces: surfacesPayload,
        pages: {
          tickets: { layout: ticketsLayout, mapping: ticketsMapping },
          reports: { layout: reportsLayout, mapping: reportsMapping },
        },
        activeTabId: shellState.activeTabId,
        recentSurfaceIds: recentSurfaceIdsRef.current,
        recentPinnedSurfaceId: buildCtx().recentPinnedSurfaceId,
        chatSurfaceIds: buildCtx().chatSurfaceIds,
      });
      // The just-submitted prompt is the last transcript entry; send it as
      // `prompt` and the rest as prior conversation history.
      const last = allMessages[allMessages.length - 1];
      const priorMessages =
        last && last.role === 'user' && last.content === text
          ? allMessages.slice(0, -1)
          : allMessages;

      const askingEntry = chatStore.push({ role: 'system', text: 'Asking agent...' });
      let clearedAsking = false;
      const clearAsking = () => {
        if (clearedAsking) return;
        clearedAsking = true;
        chatStore.remove(askingEntry.id);
      };
      try {
        // Stream the turn over AG-UI; the decoder hands us normalized results,
        // which we route through the SAME Diff pipeline as before.
        await streamAgent(text, priorMessages, agentContext, {
          onTextEnd: ({ messageId, text: msgText }) => {
            clearAsking();
            if (!msgText) return;
            // The backend tags rationale with a "thinking:" messageId prefix.
            chatStore.push({ role: messageId.startsWith('thinking:') ? 'thought' : 'agent', text: msgText });
          },
          onEmission: (emission) => {
            clearAsking();
            if (emission.kind === 'a2ui') {
              const targetId = emission.targetSurfaceId;
              const messages = emission.messages as unknown[];
              const isPinned = targetId && pinnedSurfaceIdsRef.current.has(targetId);
              if (diffsGated && isPinned) router.gateSurface(targetId);
              captureSurfaceContents(messages);
              router.route(messages as never);
              chatStore.push({ role: 'agent', surfaceId: targetId });
            } else if (emission.kind === 'pageOp') {
              harness.apply(emission.op as never);
            }
          },
          onRunError: ({ message }) => {
            clearAsking();
            chatStore.push({ role: 'system', text: `Agent error: ${message}` });
          },
        });
        clearAsking();
      } catch (err) {
        clearAsking();
        chatStore.push({
          role: 'system',
          text: `Agent error: ${(err as Error).message}`,
        });
      }
    },
    [agentMode, chatStore, handleEmission, buildCtx, diffsGated, router, harness, ticketsLayout, ticketsMapping, reportsLayout, reportsMapping, shellState.activeTabId, actionHarness, renderDiagnostics, liveProcessor, captureSurfaceContents],
  );

  // Keep the ref in sync so the action-harness hook can call handlePrompt without re-binding.
  useEffect(() => {
    handlePromptRef.current = handlePrompt;
  }, [handlePrompt]);

  const renderChatSurface = useCallback(
    (surfaceId: string) => {
      const liveSurface = liveProcessor.model.getSurface(surfaceId);
      const inMotion = inMotionSurfaceIds.has(surfaceId);
      return (
        <div
          style={{
            marginTop: 8,
            background: '#0a0a0a',
            padding: 6,
            borderRadius: 4,
            border: inMotion ? '2px solid #D97706' : undefined,
          }}
        >
          <DiffOverlay router={router} surfaceId={surfaceId} placement="inline">
            {liveSurface ? <A2uiSurface surface={liveSurface} /> : null}
          </DiffOverlay>
        </div>
      );
    },
    [router, liveProcessor, inMotionSurfaceIds],
  );

  const tabs: ShellTab[] = [
    {
      id: 'tickets',
      label: 'Tickets',
      icon: <span>🎫</span>,
      render: () => (
        <Page
          pageId="tickets"
          layout={ticketsLayout}
          mapping={ticketsMapping}
          externalLayout={ticketsLayout}
          onLayoutChange={setTicketsLayout}
          onMappingChange={setTicketsMapping}
          router={router}
          harness={harness}
        />
      ),
    },
    {
      id: 'reports',
      label: 'Reports',
      icon: <span>📊</span>,
      render: () => (
        <Page
          pageId="reports"
          layout={reportsLayout}
          mapping={reportsMapping}
          externalLayout={reportsLayout}
          onLayoutChange={setReportsLayout}
          onMappingChange={setReportsMapping}
          router={router}
          harness={harness}
        />
      ),
    },
  ];

  const handleFixtureClick = useCallback(
    (fxId: string) => {
      const fx = fixtures.find((f) => f.id === fxId);
      if (!fx) return;
      for (const em of fx.build(buildCtx())) handleEmission(em);
    },
    [handleEmission, buildCtx],
  );

  return (
    <MarkdownContext.Provider value={renderMarkdown}>
      <Shell
        tabs={tabs}
        state={shellState}
        onStateChange={setShellState}
        harness={harness}
        renderDiagnostics={renderDiagnostics}
        chatTab={{
          tab: { id: 'chat', label: 'Chat', icon: <span>💬</span> },
          renderSurface: renderChatSurface,
        }}
        topBar={
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <strong>arete-ui</strong>
            <span style={{ color: '#777', fontSize: 12 }}>ERP sandbox · chat-first routing</span>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                color: '#aaa',
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={diffsGated}
                onChange={(e) => setDiffsGated(e.target.checked)}
              />
              Gate content diffs
            </label>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                color: '#aaa',
                fontSize: 12,
              }}
            >
              Agent:
              <select
                value={agentMode}
                onChange={(e) => setAgentMode(e.target.value as 'fixtures' | 'ollama')}
                style={{
                  background: '#1f2937',
                  color: '#eee',
                  border: '1px solid #333',
                  borderRadius: 4,
                  padding: '2px 6px',
                  fontSize: 12,
                }}
                title={
                  agentAvailable
                    ? 'Ollama agent available'
                    : 'Ollama not reachable — start Ollama on :11434'
                }
              >
                <option value="fixtures">Fixtures</option>
                <option value="ollama" disabled={!agentAvailable}>
                  Ollama{!agentAvailable ? ' (offline)' : ''}
                </option>
              </select>
            </label>
            <div style={{ flex: 1 }} />
            {fixtures.map((fx) => (
              <button
                key={fx.id}
                type="button"
                onClick={() => handleFixtureClick(fx.id)}
                style={{
                  background: '#1f2937',
                  color: '#eee',
                  border: '1px solid #333',
                  borderRadius: 4,
                  padding: '4px 10px',
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                {fx.prompt}
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                const first = chatStore
                  .getSnapshot()
                  .find((e) => e.surfaceId != null)?.surfaceId;
                if (!first) return;
                const used = new Set(Object.values(ticketsMapping));
                const free = REGION_ORDER.tickets!.find((r) => !used.has(r));
                if (!free) return;
                harness.apply({
                  name: 'pinSurface',
                  surfaceId: first,
                  pageId: 'tickets',
                  region: free,
                });
              }}
              style={{
                background: '#1e3a8a',
                color: '#eee',
                border: '1px solid #333',
                borderRadius: 4,
                padding: '4px 10px',
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              Pin first chat surface → Tickets
            </button>
          </div>
        }
        hooks={{ onPrompt: handlePrompt }}
        chatStore={chatStore}
        pendingByTabId={pendingByTabId}
        actionHarness={actionHarness}
      />
    </MarkdownContext.Provider>
  );
}
