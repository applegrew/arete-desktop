import type React from 'react';
import { useState, useRef, useMemo, useEffect, useLayoutEffect } from 'react';
import { useChatEntries, type ChatStore } from './ChatStore';

export interface ChatSurfaceListProps {
  store: ChatStore;
  renderSurface?: (surfaceId: string, entryId: string) => React.ReactNode;
}

export function ChatSurfaceList({ store, renderSurface }: ChatSurfaceListProps) {
  const entries = useChatEntries(store);

  // Chat-app scroll: pin the most-recent *typed* user message to the top edge
  // (its reply streams below). Fires on a new user message and on initial load.
  const olRef = useRef<HTMLOListElement>(null);
  const spacerRef = useRef<HTMLLIElement>(null);
  const lastUserId = useMemo(() => {
    for (let i = entries.length - 1; i >= 0; i--) if (entries[i]!.role === 'user') return entries[i]!.id;
    return undefined;
  }, [entries]);
  const pinnedUserId = useRef<string | undefined>(undefined);

  // Keep the trailing spacer just tall enough that the pinned user message can
  // reach the top even when its reply is short (no extra gap once the reply fills it).
  const recomputeSpacer = () => {
    const ol = olRef.current;
    const spacer = spacerRef.current;
    if (!ol || !spacer || !lastUserId) return;
    const el = ol.querySelector<HTMLElement>(`[data-entry-id="${cssEscape(lastUserId)}"]`);
    if (!el) return;
    // Measure WITHOUT zeroing the spacer first — temporarily shrinking the
    // scrollHeight would make the browser clamp scrollTop (losing the pin).
    const spacerH = spacer.offsetHeight;
    const contentBelow = ol.scrollHeight - spacerH - el.offsetTop; // last user msg + everything after it
    spacer.style.height = `${Math.max(0, ol.clientHeight - contentBelow)}px`;
  };

  const scrollPinned = () => {
    const ol = olRef.current;
    if (!ol || !lastUserId) return;
    const el = ol.querySelector<HTMLElement>(`[data-entry-id="${cssEscape(lastUserId)}"]`);
    if (el) ol.scrollTop = Math.max(0, el.offsetTop - 8);
  };

  useLayoutEffect(() => {
    recomputeSpacer();
    if (pinnedUserId.current !== lastUserId) {
      pinnedUserId.current = lastUserId;
      scrollPinned();
      // Re-pin after async surface/image layout settles.
      requestAnimationFrame(() => {
        recomputeSpacer();
        scrollPinned();
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, lastUserId]);

  // Recompute the spacer as replies/surfaces grow or the panel resizes (no re-scroll).
  useEffect(() => {
    const ol = olRef.current;
    if (!ol || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => recomputeSpacer());
    ro.observe(ol);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastUserId]);

  if (entries.length === 0) {
    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#777',
          fontStyle: 'italic',
          fontSize: 14,
        }}
      >
        No messages yet. Type below.
      </div>
    );
  }

  return (
    <ol
      ref={olRef}
      style={{
        position: 'relative',
        flex: 1,
        listStyle: 'none',
        margin: 0,
        padding: '16px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        overflowY: 'auto',
        background: 'transparent',
        color: 'var(--text, #eee)',
      }}
    >
      {entries.map((entry) => {
        if (entry.role === 'system') {
          return (
            <li
              key={entry.id}
              data-entry-id={entry.id}
              style={{
                background: 'transparent',
                color: 'var(--text-faint, #888)',
                fontSize: 11.5,
                alignSelf: 'center',
                maxWidth: '90%',
                textAlign: 'center',
                padding: '2px 8px',
                letterSpacing: 0.2,
                animation: 'glass-rise 0.3s ease both',
              }}
            >
              {entry.pending ? <PendingIndicator text={entry.text ?? 'Working'} /> : entry.text}
            </li>
          );
        }
        if (entry.role === 'thought') {
          return (
            <li
              key={entry.id}
              style={{
                background: 'transparent',
                color: 'var(--text-dim, #6b7280)',
                fontStyle: 'italic',
                fontSize: 12.5,
                alignSelf: 'flex-start',
                maxWidth: '88%',
                padding: '2px 0 2px 12px',
                borderLeft: '2px solid rgba(124,131,255,0.45)',
                whiteSpace: 'pre-wrap',
                animation: 'glass-rise 0.3s ease both',
              }}
            >
              <div style={{ fontSize: 9.5, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 3, fontFamily: 'var(--font-display)' }}>
                thinking
              </div>
              {entry.text}
            </li>
          );
        }
        if (entry.role === 'tool') {
          return <ToolResultEntry key={entry.id} entry={entry} />;
        }
        if (entry.role === 'action') {
          return (
            <li
              key={entry.id}
              style={{
                alignSelf: 'flex-end',
                maxWidth: '85%',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '5px 11px',
                borderRadius: 999,
                fontSize: 12,
                color: 'var(--text-dim, #c7d2fe)',
                background: 'var(--glass, rgba(124,131,255,0.12))',
                border: '1px solid var(--glass-border, rgba(124,131,255,0.3))',
                animation: 'glass-rise 0.28s ease both',
              }}
              title={entry.text}
            >
              <span aria-hidden>⚡</span>
              <span style={{ fontWeight: 500 }}>{entry.actionLabel ?? 'action'}</span>
            </li>
          );
        }
        const isUser = entry.role === 'user';
        return (
          <li
            key={entry.id}
            data-entry-id={entry.id}
            style={{
              background: isUser
                ? 'linear-gradient(155deg, rgba(124,131,255,0.34), rgba(91,99,245,0.20))'
                : 'var(--glass-2, #1f2937)',
              backdropFilter: 'var(--blur)',
              WebkitBackdropFilter: 'var(--blur)',
              border: isUser ? '1px solid rgba(124,131,255,0.4)' : '1px solid var(--glass-border, transparent)',
              padding: '10px 14px',
              borderRadius: 16,
              borderBottomRightRadius: isUser ? 5 : 16,
              borderBottomLeftRadius: isUser ? 16 : 5,
              fontSize: 13.5,
              lineHeight: 1.5,
              color: 'var(--text)',
              alignSelf: isUser ? 'flex-end' : 'flex-start',
              maxWidth: '86%',
              boxShadow: isUser
                ? '0 8px 24px -10px rgba(124,131,255,0.6), inset 0 1px 0 rgba(255,255,255,0.18)'
                : 'var(--shadow), inset 0 1px 0 rgba(255,255,255,0.07)',
              animation: 'glass-rise 0.32s cubic-bezier(0.22,1,0.36,1) both',
            }}
          >
            {entry.text && <div>{entry.text}</div>}
            {entry.surfaceId !== undefined && renderSurface
              ? renderSurface(entry.surfaceId, entry.id)
              : null}
          </li>
        );
      })}
      {/* Trailing spacer so the pinned user message can reach the top edge. */}
      <li ref={spacerRef} aria-hidden style={{ flex: '0 0 auto', height: 0, listStyle: 'none' }} />
    </ol>
  );
}

/** Cheap CSS.escape fallback for entry ids (which are simple slugs, but be safe). */
function cssEscape(s: string): string {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s) : s.replace(/["\\]/g, '\\$&');
}

const THINKING_FRAMES = ['🤔', '💭', '✨', '🛰️', '🔮'];

/** Animated "working" indicator: a cycling emoji + animated dots. */
function PendingIndicator({ text }: { text: string }) {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setFrame((f) => f + 1), 430);
    return () => clearInterval(t);
  }, []);
  const dots = '.'.repeat((frame % 3) + 1);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontStyle: 'italic' }}>
      <span
        key={frame}
        aria-hidden
        style={{ display: 'inline-block', fontStyle: 'normal', animation: 'glass-rise 0.3s ease' }}
      >
        {THINKING_FRAMES[frame % THINKING_FRAMES.length]}
      </span>
      <span>{text}</span>
      <span style={{ width: 14, textAlign: 'left' }}>{dots}</span>
    </span>
  );
}

function ToolResultEntry({
  entry,
}: {
  entry: { id: string; toolName?: string; toolResult?: string; toolError?: boolean };
}) {
  // Errors expand by default so the failure is visible without a click.
  const [expanded, setExpanded] = useState(!!entry.toolError);

  return (
    <li
      style={{
        background: entry.toolError ? 'rgba(248,113,113,0.07)' : 'var(--glass, #1a1e2e)',
        backdropFilter: 'var(--blur)',
        WebkitBackdropFilter: 'var(--blur)',
        border: `1px solid ${entry.toolError ? 'rgba(248,113,113,0.32)' : 'var(--glass-border, #2d3350)'}`,
        borderRadius: 12,
        padding: '8px 12px',
        fontSize: 12,
        alignSelf: 'flex-start',
        maxWidth: '86%',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)',
        animation: 'glass-rise 0.3s ease both',
      }}
    >
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        style={{
          background: 'transparent',
          border: 'none',
          color: 'var(--text-dim, #8b9cc7)',
          cursor: 'pointer',
          fontSize: 12,
          padding: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          width: '100%',
          textAlign: 'left',
        }}
      >
        <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>{expanded ? '▼' : '▶'}</span>
        <span style={{ fontSize: 14, marginRight: 2 }}>🔧</span>
        <span style={{ fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>{entry.toolName ?? 'tool'}</span>
        {entry.toolError && <span style={{ color: '#f87171', fontWeight: 600 }}>· failed</span>}
      </button>
      {expanded && (
        <pre
          style={{
            margin: '8px 0 0 0',
            padding: '8px 10px',
            background: 'rgba(0,0,0,0.32)',
            border: '1px solid var(--hairline)',
            borderRadius: 8,
            fontSize: 11,
            fontFamily: 'var(--font-mono)',
            color: entry.toolError ? '#fca5a5' : '#7ee7b0',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            maxHeight: 200,
            overflowY: 'auto',
          }}
        >
          {entry.toolResult ?? '(no result)'}
        </pre>
      )}
    </li>
  );
}
