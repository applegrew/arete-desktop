import type React from 'react';
import { useState } from 'react';
import { useChatEntries, type ChatStore } from './ChatStore';

export interface ChatSurfaceListProps {
  store: ChatStore;
  renderSurface?: (surfaceId: string, entryId: string) => React.ReactNode;
}

export function ChatSurfaceList({ store, renderSurface }: ChatSurfaceListProps) {
  const entries = useChatEntries(store);

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
      style={{
        flex: 1,
        listStyle: 'none',
        margin: 0,
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        overflowY: 'auto',
        background: '#0a0a0a',
        color: '#eee',
      }}
    >
      {entries.map((entry) => {
        if (entry.role === 'system') {
          return (
            <li
              key={entry.id}
              style={{
                background: 'transparent',
                color: '#888',
                fontStyle: 'italic',
                fontSize: 12,
                alignSelf: 'center',
                maxWidth: '90%',
                textAlign: 'center',
                padding: '2px 8px',
              }}
            >
              {entry.text}
            </li>
          );
        }
        if (entry.role === 'thought') {
          return (
            <li
              key={entry.id}
              style={{
                background: 'transparent',
                color: '#6b7280',
                fontStyle: 'italic',
                fontSize: 12,
                alignSelf: 'flex-start',
                maxWidth: '85%',
                padding: '2px 0 2px 10px',
                borderLeft: '2px solid #374151',
                whiteSpace: 'pre-wrap',
              }}
            >
              <div style={{ fontSize: 10, color: '#4b5563', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 }}>
                thinking
              </div>
              {entry.text}
            </li>
          );
        }
        if (entry.role === 'tool') {
          return <ToolResultEntry key={entry.id} entry={entry} />;
        }
        return (
          <li
            key={entry.id}
            style={{
              background: entry.role === 'user' ? '#1e3a8a' : '#1f2937',
              padding: '8px 12px',
              borderRadius: 8,
              fontSize: 13,
              alignSelf: entry.role === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '85%',
            }}
          >
            {entry.text && <div>{entry.text}</div>}
            {entry.surfaceId !== undefined && renderSurface
              ? renderSurface(entry.surfaceId, entry.id)
              : null}
          </li>
        );
      })}
    </ol>
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
        background: '#1a1e2e',
        border: '1px solid #2d3350',
        borderRadius: 6,
        padding: '6px 10px',
        fontSize: 12,
        alignSelf: 'flex-start',
        maxWidth: '85%',
      }}
    >
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        style={{
          background: 'transparent',
          border: 'none',
          color: '#8b9cc7',
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
        <span style={{ fontSize: 10 }}>{expanded ? '▼' : '▶'}</span>
        <span style={{ fontSize: 14, marginRight: 2 }}>🔧</span>
        <span style={{ fontWeight: 600 }}>{entry.toolName ?? 'tool'}</span>
        {entry.toolError && <span style={{ color: '#f87171', fontWeight: 600 }}>· failed</span>}
      </button>
      {expanded && (
        <pre
          style={{
            margin: '6px 0 0 0',
            padding: '4px 8px',
            background: '#0d1117',
            borderRadius: 4,
            fontSize: 11,
            color: entry.toolError ? '#f87171' : '#7ee787',
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
