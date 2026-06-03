import { appendFileSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Size-rotating JSON-lines logger for every LLM interaction (requests, raw
 * responses, parse/validation failures). Each file is capped at {@link MAX_BYTES};
 * once exceeded a new file is started, and at most {@link MAX_FILES} are kept —
 * older files are pruned. Never throws: logging must not break an agent turn.
 *
 * Log dir resolution: explicit {@link setLlmLogDir} → `$ARETE_LLM_LOG_DIR` →
 * `<cwd>/llm-logs`. Disable entirely with `ARETE_LLM_LOG=0`.
 */
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB per file
const MAX_FILES = 10;
const PREFIX = 'llm-';
const EXT = '.log';

let configuredDir: string | null = null;
let logDir: string | null = null;
let currentFile: string | null = null;
let currentBytes = 0;
let seq = 0;
let disabled = process.env.ARETE_LLM_LOG === '0';

/** Point the logger at a specific directory (call once at startup). */
export function setLlmLogDir(dir: string): void {
  configuredDir = dir;
  logDir = null; // force re-init on next write
}

function resolveDir(): string {
  return configuredDir || process.env.ARETE_LLM_LOG_DIR || join(process.cwd(), 'llm-logs');
}

function listLogs(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((f) => f.startsWith(PREFIX) && f.endsWith(EXT))
      .sort(); // timestamped names sort chronologically
  } catch {
    return [];
  }
}

/** Keep the `keep` newest log files; delete the rest. A freshly-rotated current
 *  file doesn't exist on disk yet, so callers pass `MAX_FILES - 1` to reserve its
 *  slot — guaranteeing the on-disk total never exceeds MAX_FILES. */
function prune(dir: string, keep: number): void {
  const files = listLogs(dir);
  if (files.length <= keep) return;
  for (const f of files.slice(0, files.length - keep)) {
    try {
      unlinkSync(join(dir, f));
    } catch {
      /* ignore */
    }
  }
}

function newFileName(): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  seq = (seq + 1) % 1000;
  return `${PREFIX}${ts}-${String(seq).padStart(3, '0')}${EXT}`;
}

function init(): void {
  logDir = resolveDir();
  try {
    mkdirSync(logDir, { recursive: true });
  } catch {
    disabled = true;
    return;
  }
  // Resume the newest file if it's still under the cap; else start fresh.
  const files = listLogs(logDir);
  const newest = files[files.length - 1];
  if (newest) {
    const p = join(logDir, newest);
    try {
      const size = statSync(p).size;
      if (size < MAX_BYTES) {
        currentFile = p;
        currentBytes = size;
      }
    } catch {
      /* ignore */
    }
  }
  if (!currentFile) {
    // Brand-new current file (doesn't exist yet) → reserve its slot.
    currentFile = join(logDir, newFileName());
    currentBytes = 0;
    prune(logDir, MAX_FILES - 1);
  } else {
    // Resuming an existing file (already on disk and counted).
    prune(logDir, MAX_FILES);
  }
}

function rotate(): void {
  if (!logDir) return;
  // The new current file isn't written yet → keep one fewer so it fits.
  currentFile = join(logDir, newFileName());
  currentBytes = 0;
  prune(logDir, MAX_FILES - 1);
}

/** Append one structured log entry (`ts` is added automatically). */
export function logLlm(entry: Record<string, unknown>): void {
  if (disabled) return;
  try {
    if (!logDir) init();
    if (disabled || !currentFile) return;
    const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n';
    const bytes = Buffer.byteLength(line);
    if (currentBytes > 0 && currentBytes + bytes > MAX_BYTES) rotate();
    appendFileSync(currentFile, line);
    currentBytes += bytes;
  } catch {
    /* logging must never break a turn */
  }
}
