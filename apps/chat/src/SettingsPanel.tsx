import { useEffect, useState } from 'react';
import type { AgentSettings, McpServerEntry, McpServerSetting } from './persistence';

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
  settings: AgentSettings;
  /** Models advertised by the Ollama backend (for the model dropdown). */
  availableModels: string[];
  /** Persist the edited settings (shallow-merged + applied live by the server). */
  onSave: (next: AgentSettings) => void;
}

const overlay: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.55)',
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'center',
  paddingTop: '6vh',
  zIndex: 1000,
};
const panel: React.CSSProperties = {
  width: 'min(560px, 92vw)',
  maxHeight: '84vh',
  overflowY: 'auto',
  background: '#111',
  color: '#eee',
  border: '1px solid #333',
  borderRadius: 8,
  padding: 20,
  boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
};
const label: React.CSSProperties = { display: 'block', fontSize: 12, color: '#aaa', marginBottom: 4 };
const input: React.CSSProperties = {
  width: '100%',
  background: '#0a0a0a',
  color: '#eee',
  border: '1px solid #333',
  borderRadius: 4,
  padding: '6px 8px',
  fontSize: 13,
  boxSizing: 'border-box',
};
const btn: React.CSSProperties = {
  background: '#1f2937',
  color: '#eee',
  border: '1px solid #333',
  borderRadius: 4,
  padding: '6px 12px',
  fontSize: 13,
  cursor: 'pointer',
};
const sectionTitle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: '#ddd',
  margin: '20px 0 8px',
  borderBottom: '1px solid #222',
  paddingBottom: 4,
};

function isHttp(e: McpServerEntry): e is { url: string; transport: 'streamable-http' | 'sse' } {
  return 'url' in e;
}

function describeEntry(e: McpServerEntry): string {
  return isHttp(e) ? `${e.transport} · ${e.url}` : `stdio · ${e.command}${e.args?.length ? ' ' + e.args.join(' ') : ''}`;
}

export function SettingsPanel({ open, onClose, settings, availableModels, onSave }: SettingsPanelProps) {
  const [draft, setDraft] = useState<AgentSettings>(settings);
  // Reset the draft to the latest persisted settings each time the panel opens.
  useEffect(() => {
    if (open) setDraft(settings);
  }, [open, settings]);

  // Add-server form state.
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<'stdio' | 'http'>('stdio');
  const [newCommand, setNewCommand] = useState('');
  const [newArgs, setNewArgs] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [newTransport, setNewTransport] = useState<'streamable-http' | 'sse'>('streamable-http');

  if (!open) return null;

  const set = (patch: Partial<AgentSettings>) => setDraft((d) => ({ ...d, ...patch }));

  const toggleServer = (name: string, enabled: boolean) =>
    set({ mcpServers: draft.mcpServers.map((s) => (s.name === name ? { ...s, enabled } : s)) });

  const removeServer = (name: string) => set({ mcpServers: draft.mcpServers.filter((s) => s.name !== name) });

  const addServer = () => {
    const name = newName.trim();
    if (!name || draft.mcpServers.some((s) => s.name === name)) return;
    const entry: McpServerEntry =
      newType === 'http'
        ? { url: newUrl.trim(), transport: newTransport }
        : { command: newCommand.trim(), args: newArgs.trim() ? newArgs.trim().split(/\s+/) : undefined };
    if (newType === 'http' ? !newUrl.trim() : !newCommand.trim()) return;
    const next: McpServerSetting = { name, enabled: true, entry };
    set({ mcpServers: [...draft.mcpServers, next] });
    setNewName('');
    setNewCommand('');
    setNewArgs('');
    setNewUrl('');
  };

  const save = () => {
    onSave(draft);
    onClose();
  };

  return (
    <div style={overlay} onClick={onClose}>
      <div style={panel} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
          <strong style={{ fontSize: 16 }}>Settings</strong>
          <div style={{ flex: 1 }} />
          <button type="button" style={btn} onClick={onClose} aria-label="Close settings">
            ✕
          </button>
        </div>
        <div style={{ fontSize: 12, color: '#777' }}>Model &amp; MCP changes apply to the next agent turn — no restart.</div>

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
        <div style={sectionTitle}>MCP servers</div>
        {draft.mcpServers.length === 0 && (
          <div style={{ fontSize: 12, color: '#777', marginBottom: 8 }}>No MCP servers configured.</div>
        )}
        {draft.mcpServers.map((s) => (
          <div
            key={s.name}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 8px',
              background: '#0a0a0a',
              border: '1px solid #222',
              borderRadius: 4,
              marginBottom: 6,
            }}
          >
            <input type="checkbox" checked={s.enabled} onChange={(e) => toggleServer(s.name, e.target.checked)} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, color: '#eee' }}>{s.name}</div>
              <div style={{ fontSize: 11, color: '#777', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {describeEntry(s.entry)}
              </div>
            </div>
            <button type="button" style={{ ...btn, padding: '2px 8px' }} onClick={() => removeServer(s.name)} aria-label={`Remove ${s.name}`}>
              ✕
            </button>
          </div>
        ))}

        {/* Add server */}
        <div style={{ border: '1px dashed #333', borderRadius: 4, padding: 10, marginTop: 8 }}>
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
          )}
          <button type="button" style={btn} onClick={addServer}>
            + Add server
          </button>
        </div>

        {/* Appearance */}
        <div style={sectionTitle}>Appearance &amp; diffs</div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#ddd', cursor: 'pointer' }}>
          <input type="checkbox" checked={draft.gateDiffs} onChange={(e) => set({ gateDiffs: e.target.checked })} />
          Gate agent diffs (approve / reject before live state changes)
        </label>

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 24 }}>
          <button type="button" style={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" style={{ ...btn, background: '#1e3a8a' }} onClick={save}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
