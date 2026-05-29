import type React from 'react';
import type { ReactNode } from 'react';
import { useHooks } from '../shell/HookContext';
import { ChatSurfaceList } from './ChatSurfaceList';
import { ChatInput } from './ChatInput';
import type { ChatStore } from './ChatStore';

export type ChatMode = 'page' | 'dock' | 'rail';

export interface ChatProps {
  store: ChatStore;
  mode: ChatMode;
  onModeChange?: (next: ChatMode) => void;
  renderSurface?: (surfaceId: string, entryId: string) => ReactNode;
}

const DOCK_WIDTH = 380;
const RAIL_WIDTH = 32;

export function Chat({ store, mode, onModeChange, renderSurface }: ChatProps) {
  const hooks = useHooks();

  const handleSubmit = (text: string) => {
    store.push({ role: 'user', text });
    hooks.onPrompt(text);
  };

  if (mode === 'rail') {
    return (
      <aside
        style={{
          width: RAIL_WIDTH,
          flexShrink: 0,
          background: '#1a1a1a',
          color: '#fff',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          borderLeft: '1px solid #2a2a2a',
        }}
      >
        <button
          type="button"
          aria-label="Expand chat"
          title="Expand chat"
          onClick={() => onModeChange?.('dock')}
          style={{
            width: '100%',
            border: 'none',
            background: 'transparent',
            color: 'inherit',
            cursor: 'pointer',
            padding: '8px 0',
            fontSize: 14,
          }}
        >
          ◀
        </button>
        <div
          style={{
            writingMode: 'vertical-rl',
            transform: 'rotate(180deg)',
            marginTop: 16,
            fontSize: 12,
            letterSpacing: 1,
            color: '#888',
          }}
        >
          Chat
        </div>
      </aside>
    );
  }

  const containerStyle: React.CSSProperties =
    mode === 'page'
      ? { flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }
      : {
          width: DOCK_WIDTH,
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          borderLeft: '1px solid #2a2a2a',
        };

  return (
    <section style={containerStyle} aria-label="Chat">
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 10px',
          background: '#111',
          color: '#fff',
          borderBottom: '1px solid #2a2a2a',
          fontSize: 13,
        }}
      >
        <span>Chat {mode === 'page' ? '(full)' : '(docked)'}</span>
        {mode === 'dock' && (
          <button
            type="button"
            aria-label="Collapse chat"
            title="Collapse chat"
            onClick={() => onModeChange?.('rail')}
            style={{
              border: 'none',
              background: 'transparent',
              color: '#888',
              cursor: 'pointer',
              fontSize: 14,
            }}
          >
            ▶
          </button>
        )}
      </header>
      <ChatSurfaceList store={store} renderSurface={renderSurface} />
      <ChatInput onSubmit={handleSubmit} />
    </section>
  );
}
