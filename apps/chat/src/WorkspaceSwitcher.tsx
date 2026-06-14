import { useEffect, useRef, useState } from 'react';
import type { ApiWorkspace } from './persistence';

export interface WorkspaceSwitcherProps {
  workspaces: ApiWorkspace[];
  activeWorkspaceId: string;
  onSwitch: (id: string) => void;
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}

const popBtn: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'var(--text-faint, #9aa)',
  cursor: 'pointer',
  fontSize: 12,
  padding: '2px 6px',
  borderRadius: 4,
};

/**
 * Top-bar workspace picker: shows the active workspace, opens a popover to switch,
 * rename, delete, or create. Inline editing (no window.prompt — unreliable in the
 * Tauri webview).
 */
export function WorkspaceSwitcher({
  workspaces,
  activeWorkspaceId,
  onSwitch,
  onCreate,
  onRename,
  onDelete,
}: WorkspaceSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setEditingId(null);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const active = workspaces.find((w) => w.id === activeWorkspaceId);
  const startRename = (w: ApiWorkspace) => {
    setEditingId(w.id);
    setDraft(w.name);
  };
  const commitRename = () => {
    const name = draft.trim();
    if (editingId && name) onRename(editingId, name);
    setEditingId(null);
  };
  const createWorkspace = () => {
    // One click → create immediately with a default name (rename via ✎). A two-step
    // inline input was easy to miss / lose focus before typing.
    onCreate(`Workspace ${workspaces.length + 1}`);
    setOpen(false);
  };

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid var(--glass-border, rgba(255,255,255,0.12))',
          borderRadius: 8,
          color: 'var(--text, #e5e7eb)',
          cursor: 'pointer',
          fontSize: 12.5,
          fontWeight: 600,
          padding: '4px 10px',
          maxWidth: 200,
        }}
        title="Switch workspace"
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {active?.name ?? 'Workspace'}
        </span>
        <span style={{ fontSize: 9, opacity: 0.7 }}>▼</span>
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            minWidth: 240,
            background: 'var(--surface, #161a22)',
            border: '1px solid var(--glass-border, rgba(255,255,255,0.14))',
            borderRadius: 10,
            boxShadow: '0 14px 40px -10px rgba(0,0,0,0.6)',
            padding: 6,
            zIndex: 1000,
          }}
        >
          {workspaces.map((w) => {
            const isActive = w.id === activeWorkspaceId;
            if (editingId === w.id) {
              return (
                <input
                  key={w.id}
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename();
                    if (e.key === 'Escape') setEditingId(null);
                  }}
                  onBlur={commitRename}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    background: 'rgba(255,255,255,0.06)',
                    border: '1px solid var(--accent, #7c83ff)',
                    borderRadius: 6,
                    color: 'var(--text, #e5e7eb)',
                    fontSize: 13,
                    padding: '6px 8px',
                    margin: '1px 0',
                  }}
                />
              );
            }
            return (
              <div
                key={w.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  borderRadius: 6,
                  padding: '2px 4px 2px 8px',
                  background: isActive ? 'rgba(124,131,255,0.16)' : 'transparent',
                }}
              >
                <button
                  type="button"
                  onClick={() => {
                    onSwitch(w.id);
                    setOpen(false);
                  }}
                  style={{
                    flex: 1,
                    textAlign: 'left',
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--text, #e5e7eb)',
                    cursor: 'pointer',
                    fontSize: 13,
                    fontWeight: isActive ? 600 : 400,
                    padding: '4px 0',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {isActive ? '● ' : ''}
                  {w.name}
                </button>
                <button type="button" style={popBtn} title="Rename" onClick={() => startRename(w)}>
                  ✎
                </button>
                <button
                  type="button"
                  style={{ ...popBtn, opacity: workspaces.length <= 1 ? 0.3 : 1 }}
                  title={workspaces.length <= 1 ? "Can't delete the last workspace" : 'Delete'}
                  disabled={workspaces.length <= 1}
                  onClick={() => onDelete(w.id)}
                >
                  🗑
                </button>
              </div>
            );
          })}

          <div style={{ height: 1, background: 'var(--glass-border, rgba(255,255,255,0.1))', margin: '6px 4px' }} />

          <button
            type="button"
            onClick={createWorkspace}
            style={{
              width: '100%',
              textAlign: 'left',
              background: 'transparent',
              border: 'none',
              color: 'var(--accent, #7c83ff)',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 600,
              padding: '6px 8px',
              borderRadius: 6,
            }}
          >
            + New workspace
          </button>
        </div>
      )}
    </div>
  );
}
