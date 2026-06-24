import { useEffect, useState } from 'react';
import { Dialog } from 'primereact/dialog';
import {
  getMcpStatus,
  reconnectMcp,
  type AgentSettings,
  type HttpServerConfig,
  type McpServerEntry,
  type McpServerSetting,
  type McpServerStatus,
} from './persistence';

/** Parse a "Key: Value" line-per-header textarea into a headers object (empty → undefined). */
function parseHeaders(text: string): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key) out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
  settings: AgentSettings;
  /** Models advertised by the Ollama backend (for the model dropdown). */
  availableModels: string[];
  /** Persist the edited settings (shallow-merged + applied live by the server). */
  onSave: (next: AgentSettings) => void;
}

const label: React.CSSProperties = { display: 'block', fontSize: 12, color: 'var(--text-dim)', marginBottom: 5 };
const input: React.CSSProperties = {
  width: '100%',
  background: 'var(--glass)',
  color: 'var(--text)',
  border: '1px solid var(--glass-border)',
  borderRadius: 10,
  padding: '9px 12px',
  fontSize: 13,
  boxSizing: 'border-box',
  outline: 'none',
};
const btn: React.CSSProperties = {
  background: 'var(--glass-2)',
  color: 'var(--text)',
  border: '1px solid var(--glass-border)',
  borderRadius: 999,
  padding: '8px 16px',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08)',
};
const sectionTitle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--text-dim)',
  textTransform: 'uppercase',
  letterSpacing: 1.2,
  fontFamily: 'var(--font-display)',
  margin: '22px 0 10px',
  borderBottom: '1px solid var(--hairline)',
  paddingBottom: 6,
};

function isHttp(e: McpServerEntry): e is HttpServerConfig {
  return 'url' in e;
}

function describeEntry(e: McpServerEntry): string {
  if (isHttp(e)) {
    const headerCount = e.headers ? Object.keys(e.headers).length : 0;
    const headerNote = headerCount > 0 ? ` · ${headerCount} header${headerCount === 1 ? '' : 's'}` : '';
    return `${e.transport ?? 'streamable-http'} · ${e.url}${headerNote}`;
  }
  return `stdio · ${e.command}${e.args?.length ? ' ' + e.args.join(' ') : ''}`;
}

export function SettingsPanel({ open, onClose, settings, availableModels, onSave }: SettingsPanelProps) {
  const [draft, setDraft] = useState<AgentSettings>(settings);
  const [status, setStatus] = useState<McpServerStatus[]>([]);
  const [reconnecting, setReconnecting] = useState(false);
  const [expandedErrors, setExpandedErrors] = useState<Set<string>>(new Set());

  const toggleError = (name: string) =>
    setExpandedErrors((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set());
  const toggleTools = (name: string) =>
    setExpandedTools((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  // Reset the draft + refresh live MCP status each time the panel opens.
  useEffect(() => {
    if (!open) return;
    setDraft(settings);
    getMcpStatus().then(setStatus);
  }, [open, settings]);

  const statusByName = (name: string): McpServerStatus | undefined => status.find((s) => s.name === name);

  const doReconnect = async () => {
    setReconnecting(true);
    try {
      setStatus(await reconnectMcp());
    } finally {
      setReconnecting(false);
    }
  };

  // Add-server form state.
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<'stdio' | 'http'>('stdio');
  const [newCommand, setNewCommand] = useState('');
  const [newArgs, setNewArgs] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [newTransport, setNewTransport] = useState<'streamable-http' | 'sse'>('streamable-http');
  const [newHeaders, setNewHeaders] = useState('');
  // Original name of the server being edited (null = adding a new one).
  const [editingName, setEditingName] = useState<string | null>(null);

  if (!open) return null;

  const set = (patch: Partial<AgentSettings>) => setDraft((d) => ({ ...d, ...patch }));

  const toggleServer = (name: string, enabled: boolean) =>
    set({ mcpServers: draft.mcpServers.map((s) => (s.name === name ? { ...s, enabled } : s)) });

  const removeServer = (name: string) => set({ mcpServers: draft.mcpServers.filter((s) => s.name !== name) });

  const resetForm = () => {
    setEditingName(null);
    setNewName('');
    setNewCommand('');
    setNewArgs('');
    setNewUrl('');
    setNewHeaders('');
    setNewTransport('streamable-http');
    setNewType('stdio');
  };

  // Load a server's details into the form for editing (triggered by clicking its title).
  const startEdit = (s: McpServerSetting) => {
    setEditingName(s.name);
    setNewName(s.name);
    if (isHttp(s.entry)) {
      setNewType('http');
      setNewUrl(s.entry.url);
      setNewTransport(s.entry.transport ?? 'streamable-http');
      setNewHeaders(
        s.entry.headers ? Object.entries(s.entry.headers).map(([k, v]) => `${k}: ${v}`).join('\n') : '',
      );
      setNewCommand('');
      setNewArgs('');
    } else {
      setNewType('stdio');
      setNewCommand(s.entry.command);
      setNewArgs(s.entry.args?.join(' ') ?? '');
      setNewUrl('');
      setNewHeaders('');
    }
  };

  // Add or update the form's server and persist immediately (panel stays open).
  // Status refreshes via the open-effect when `settings` updates.
  const saveServer = () => {
    const name = newName.trim();
    if (!name) return;
    // Name must be unique — except for the server currently being edited.
    if (draft.mcpServers.some((s) => s.name === name && s.name !== editingName)) return;
    if (newType === 'http' ? !newUrl.trim() : !newCommand.trim()) return;
    const headers = parseHeaders(newHeaders);
    const entry: McpServerEntry =
      newType === 'http'
        ? { url: newUrl.trim(), transport: newTransport, ...(headers ? { headers } : {}) }
        : { command: newCommand.trim(), args: newArgs.trim() ? newArgs.trim().split(/\s+/) : undefined };
    const nextServers = editingName
      ? draft.mcpServers.map((s) => (s.name === editingName ? { name, enabled: s.enabled, entry } : s))
      : [...draft.mcpServers, { name, enabled: true, entry }];
    const nextSettings: AgentSettings = { ...draft, mcpServers: nextServers };
    setDraft(nextSettings);
    onSave(nextSettings);
    resetForm();
  };

  const save = () => {
    onSave(draft);
    onClose();
  };

  return (
    <Dialog
      header="Settings"
      visible={true}
      onHide={onClose}
      style={{ width: 'min(560px, 92vw)' }}
      modal
      closable
      draggable={false}
      resizable={false}
    >
      <div style={{ fontSize: 12, color: '#777', marginBottom: 12 }}>
        Model &amp; MCP changes apply to the next agent turn — no restart.
      </div>
      <div style={{ overflowY: 'auto', maxHeight: '60vh', minHeight: 0, paddingRight: 4 }}>
        {/* Model & agent */}
        <div style={sectionTitle}>Model &amp; agent</div>
        <label style={label}>Model</label>
        <input
          style={input}
          list="arete-models"
          value={draft.model}
          onChange={(e) => set({ model: e.target.value })}
          placeholder="e.g. gemma4:31b-cloud"
        />
        <datalist id="arete-models">
          {availableModels.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
        <label style={{ ...label, marginTop: 12 }}>Ollama URL</label>
        <input
          style={input}
          value={draft.ollamaUrl}
          onChange={(e) => set({ ollamaUrl: e.target.value })}
          placeholder="http://localhost:11434"
        />

        {/* MCP servers */}
        <div style={{ ...sectionTitle, display: 'flex', alignItems: 'center' }}>
          <span style={{ flex: 1 }}>MCP servers</span>
          <button type="button" style={{ ...btn, padding: '2px 8px', fontWeight: 400 }} onClick={doReconnect} disabled={reconnecting}>
            {reconnecting ? 'Reconnecting…' : '⟳ Reconnect'}
          </button>
        </div>
        {draft.mcpServers.length === 0 && (
          <div style={{ fontSize: 12, color: '#777', marginBottom: 8 }}>No MCP servers configured.</div>
        )}
        {draft.mcpServers.map((s) => {
          const st = statusByName(s.name);
          const dotColor = !st ? '#555' : st.connected ? '#10b981' : '#ef4444';
          const failed = !!st && !st.connected;
          const statusText = !st
            ? 'status unknown — save, then Reconnect'
            : st.connected
              ? `Connected · ${st.toolCount} tool${st.toolCount === 1 ? '' : 's'}`
              : `failed: ${st.error ?? 'connection error'}`;
          const detail = st?.errorDetail ?? st?.error;
          const expanded = expandedErrors.has(s.name);
          const toolsExpanded = expandedTools.has(s.name);
          const isEditing = editingName === s.name;
          return (
            <div
              key={s.name}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
                padding: '6px 8px',
                background: '#0a0a0a',
                border: isEditing ? '1px solid #1e3a8a' : '1px solid #222',
                borderRadius: 4,
                marginBottom: 6,
              }}
            >
              <input type="checkbox" style={{ marginTop: 3 }} checked={s.enabled} onChange={(e) => toggleServer(s.name, e.target.checked)} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, color: '#eee', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span
                    title={statusText}
                    style={{ width: 8, height: 8, borderRadius: '50%', background: dotColor, flex: '0 0 auto' }}
                  />
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      startEdit(s);
                    }}
                    title="Edit this server"
                    style={{ cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dotted' }}
                  >
                    {s.name}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: '#777', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {describeEntry(s.entry)}
                </div>
                {failed ? (
                  <>
                    <div
                      onClick={() => toggleError(s.name)}
                      title="Show error detail"
                      style={{ fontSize: 11, color: '#ef4444', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
                    >
                      <span style={{ flex: '0 0 auto' }}>{expanded ? '▼' : '▶'}</span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{statusText}</span>
                    </div>
                    {expanded && detail && (
                      <pre
                        style={{
                          fontSize: 10,
                          color: '#f87171',
                          background: '#1a0d0d',
                          border: '1px solid #3a1f1f',
                          borderRadius: 4,
                          padding: 6,
                          margin: '4px 0 0',
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                          maxHeight: 160,
                          overflow: 'auto',
                        }}
                      >
                        {detail}
                      </pre>
                    )}
                  </>
                ) : (
                  <>
                    <div
                      onClick={() => (st && st.toolCount > 0 ? toggleTools(s.name) : undefined)}
                      title={st && st.toolCount > 0 ? 'Show tools' : undefined}
                      style={{
                        fontSize: 11,
                        color: !st ? '#777' : '#10b981',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        cursor: st && st.toolCount > 0 ? 'pointer' : 'default',
                      }}
                    >
                      {st && st.toolCount > 0 && (
                        <span style={{ flex: '0 0 auto' }}>{toolsExpanded ? '▼' : '▶'}</span>
                      )}
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {statusText}
                      </span>
                    </div>
                    {toolsExpanded && st && (
                      <ul
                        style={{
                          listStyle: 'none',
                          margin: '4px 0 0',
                          padding: '6px 8px',
                          background: '#0d0d0d',
                          border: '1px solid #1f2a1f',
                          borderRadius: 4,
                          maxHeight: 180,
                          overflow: 'auto',
                        }}
                      >
                        {(st.toolDetails ?? st.tools.map((n) => ({ name: n, description: undefined }))).map((t) => (
                          <li key={t.name} style={{ marginBottom: 5 }}>
                            <span style={{ color: '#d1fae5', fontFamily: 'monospace', fontSize: 11 }}>{t.name}</span>
                            {t.description && (
                              <div style={{ color: '#888', fontSize: 11, marginTop: 1 }}>{t.description}</div>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </div>
              <button type="button" style={{ ...btn, padding: '2px 8px' }} onClick={() => removeServer(s.name)} aria-label={`Remove ${s.name}`}>
                ✕
              </button>
            </div>
          );
        })}

        {/* Add / edit server */}
        <div
          style={{
            border: editingName ? '1px dashed #1e3a8a' : '1px dashed #333',
            borderRadius: 4,
            padding: 10,
            marginTop: 8,
          }}
        >
          {editingName && (
            <div style={{ fontSize: 12, color: '#aaa', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>
                Editing <strong style={{ color: '#eee' }}>{editingName}</strong>
              </span>
              <button
                type="button"
                onClick={resetForm}
                style={{ background: 'none', border: 'none', color: '#60a5fa', cursor: 'pointer', fontSize: 12, padding: 0 }}
              >
                cancel
              </button>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <input style={{ ...input, flex: 1 }} placeholder="server name" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <select style={{ ...input, width: 110 }} value={newType} onChange={(e) => setNewType(e.target.value as 'stdio' | 'http')}>
              <option value="stdio">stdio</option>
              <option value="http">http/sse</option>
            </select>
          </div>
          {newType === 'stdio' ? (
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <input style={{ ...input, flex: 1 }} placeholder="command (e.g. node)" value={newCommand} onChange={(e) => setNewCommand(e.target.value)} />
              <input style={{ ...input, flex: 1 }} placeholder="args (space-separated)" value={newArgs} onChange={(e) => setNewArgs(e.target.value)} />
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <input style={{ ...input, flex: 1 }} placeholder="https://host/mcp" value={newUrl} onChange={(e) => setNewUrl(e.target.value)} />
                <select
                  style={{ ...input, width: 160 }}
                  value={newTransport}
                  onChange={(e) => setNewTransport(e.target.value as 'streamable-http' | 'sse')}
                >
                  <option value="streamable-http">streamable-http</option>
                  <option value="sse">sse</option>
                </select>
              </div>
              <textarea
                style={{ ...input, marginBottom: 8, fontFamily: 'monospace', resize: 'vertical' }}
                rows={3}
                placeholder={'headers (one per line)\nAuthorization: Bearer <token>\nX-O11y-Tenant: <tenant>'}
                value={newHeaders}
                onChange={(e) => setNewHeaders(e.target.value)}
              />
            </>
          )}
          <button type="button" style={btn} onClick={saveServer}>
            {editingName ? 'Update server' : 'Save server'}
          </button>
        </div>

        {/* File system access */}
        <div style={sectionTitle}>File system access</div>
        <div style={{ fontSize: 12, color: 'var(--text-dim, #9aa4b8)', marginBottom: 8 }}>
          The agent&apos;s file tools (read, create, update, delete, mkdir, rmdir) may only operate
          inside these folders and their subdirectories. With none selected, the tools are disabled.
        </div>
        {(draft.allowedFolders ?? []).length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text-faint, #6b7280)', fontStyle: 'italic', marginBottom: 8 }}>
            No folders selected.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
            {(draft.allowedFolders ?? []).map((folder) => (
              <div key={folder} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span
                  style={{
                    flex: 1,
                    fontFamily: 'monospace',
                    fontSize: 12,
                    color: 'var(--text, #ddd)',
                    overflowWrap: 'anywhere',
                  }}
                >
                  {folder}
                </span>
                <button
                  type="button"
                  style={{ ...btn, color: '#ef4444' }}
                  onClick={() =>
                    set({ allowedFolders: (draft.allowedFolders ?? []).filter((f) => f !== folder) })
                  }
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
        <button
          type="button"
          style={btn}
          onClick={async () => {
            try {
              const { open } = await import('@tauri-apps/plugin-dialog');
              const picked = await open({
                directory: true,
                multiple: true,
                title: 'Authorize folder for agent file access',
              });
              if (!picked) return;
              const arr = Array.isArray(picked) ? picked : [picked];
              const merged = Array.from(new Set([...(draft.allowedFolders ?? []), ...arr]));
              set({ allowedFolders: merged });
            } catch (e) {
              console.error('Folder picker failed', e);
            }
          }}
        >
          Add folder…
        </button>

        {/* Appearance */}
        <div style={{ ...sectionTitle, marginTop: 18 }}>Appearance &amp; diffs</div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#ddd', cursor: 'pointer' }}>
          <input type="checkbox" checked={draft.gateDiffs} onChange={(e) => set({ gateDiffs: e.target.checked })} />
          Gate agent diffs (approve / reject before live state changes)
        </label>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 16, marginTop: 8, borderTop: '1px solid var(--hairline)' }}>
          <button type="button" style={btn} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            style={{
              ...btn,
              background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))',
              border: '1px solid rgba(124,131,255,0.5)',
              color: '#fff',
              fontWeight: 600,
              boxShadow: '0 6px 18px -8px rgba(124,131,255,0.7), inset 0 1px 0 rgba(255,255,255,0.3)',
            }}
            onClick={save}
          >
            Save
          </button>
        </div>
    </Dialog>
  );
}
