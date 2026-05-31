import Database from 'better-sqlite3';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'arete-chat.db');

/** A workspace page (tab): an arete `<Page>` with a region layout + surface mapping. */
export interface PageRecord {
  id: string;
  title: string;
  icon?: string;
  color?: string;
  layout: unknown;
  mapping: Record<string, string>;
  position: number;
  createdAt: number;
  updatedAt: number;
}

/** A rendered A2UI surface, stored globally so chat-scroll AND pinned surfaces
 *  re-render on reload (chat rows hold only text+surfaceId, not the A2UI graph). */
export interface SurfaceRecord {
  surfaceId: string;
  components: unknown[];
  dataModel: Record<string, unknown>;
  updatedAt: number;
}

export interface ChatEntryRecord {
  id: string;
  role: string;
  text?: string;
  surfaceId?: string;
  createdAt: number;
}

/**
 * Persistence boundary. Swap this implementation (e.g. another RDBMS) without
 * touching the routes. v1 ships {@link SqliteStore}.
 */
export interface Store {
  listPages(): PageRecord[];
  getPage(id: string): PageRecord | undefined;
  upsertPage(page: PageRecord): void;
  deletePage(id: string): void;
  listSurfaces(): SurfaceRecord[];
  replaceSurfaces(surfaces: SurfaceRecord[]): void;
  getChat(): ChatEntryRecord[];
  saveChat(entries: ChatEntryRecord[]): void;
  getState(): Record<string, unknown>;
  setState(patch: Record<string, unknown>): void;
}

class SqliteStore implements Store {
  private db: Database.Database;

  constructor(dbPath: string) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS pages (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, icon TEXT, color TEXT,
        layout_json TEXT NOT NULL,
        mapping_json TEXT NOT NULL, position INTEGER NOT NULL,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS surfaces (
        surface_id TEXT PRIMARY KEY, components_json TEXT NOT NULL,
        data_model_json TEXT NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS chat_entries (
        id TEXT PRIMARY KEY, role TEXT NOT NULL, text TEXT, surface_id TEXT, created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS app_state ( k TEXT PRIMARY KEY, v TEXT NOT NULL );
    `);
    // Migration: add icon + color columns for existing databases.
    for (const col of ['icon', 'color']) {
      const has = this.db.prepare(`PRAGMA table_info(pages)`).all() as Array<{ name: string }>;
      if (!has.some((c) => c.name === col)) {
        this.db.exec(`ALTER TABLE pages ADD COLUMN ${col} TEXT`);
      }
    }
  }

  listPages(): PageRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM pages ORDER BY position ASC, created_at ASC')
      .all() as Array<Record<string, unknown>>;
    return rows.map(rowToPage);
  }

  getPage(id: string): PageRecord | undefined {
    const row = this.db.prepare('SELECT * FROM pages WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? rowToPage(row) : undefined;
  }

  upsertPage(p: PageRecord): void {
    this.db
      .prepare(
        `INSERT INTO pages (id, title, icon, color, layout_json, mapping_json, position, created_at, updated_at)
         VALUES (@id, @title, @icon, @color, @layout, @mapping, @position, @createdAt, @updatedAt)
         ON CONFLICT(id) DO UPDATE SET title=excluded.title, icon=excluded.icon, color=excluded.color,
           layout_json=excluded.layout_json,
           mapping_json=excluded.mapping_json, position=excluded.position, updated_at=excluded.updated_at`,
      )
      .run({
        id: p.id,
        title: p.title,
        icon: p.icon ?? null,
        color: p.color ?? null,
        layout: JSON.stringify(p.layout),
        mapping: JSON.stringify(p.mapping ?? {}),
        position: p.position,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      });
  }

  deletePage(id: string): void {
    this.db.prepare('DELETE FROM pages WHERE id = ?').run(id);
  }

  listSurfaces(): SurfaceRecord[] {
    const rows = this.db.prepare('SELECT * FROM surfaces').all() as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      surfaceId: r.surface_id as string,
      components: safeParse(r.components_json as string, []),
      dataModel: safeParse(r.data_model_json as string, {}),
      updatedAt: r.updated_at as number,
    }));
  }

  replaceSurfaces(surfaces: SurfaceRecord[]): void {
    const insert = this.db.prepare(
      'INSERT OR REPLACE INTO surfaces (surface_id, components_json, data_model_json, updated_at) VALUES (?, ?, ?, ?)',
    );
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM surfaces').run();
      for (const s of surfaces) {
        insert.run(s.surfaceId, JSON.stringify(s.components ?? []), JSON.stringify(s.dataModel ?? {}), s.updatedAt ?? Date.now());
      }
    });
    tx();
  }

  getChat(): ChatEntryRecord[] {
    const rows = this.db
      .prepare('SELECT id, role, text, surface_id, created_at FROM chat_entries ORDER BY created_at ASC')
      .all() as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: r.id as string,
      role: r.role as string,
      text: (r.text as string) ?? undefined,
      surfaceId: (r.surface_id as string) ?? undefined,
      createdAt: r.created_at as number,
    }));
  }

  saveChat(entries: ChatEntryRecord[]): void {
    const insert = this.db.prepare(
      'INSERT OR REPLACE INTO chat_entries (id, role, text, surface_id, created_at) VALUES (?, ?, ?, ?, ?)',
    );
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM chat_entries').run();
      for (const e of entries) insert.run(e.id, e.role, e.text ?? null, e.surfaceId ?? null, e.createdAt);
    });
    tx();
  }

  getState(): Record<string, unknown> {
    const rows = this.db.prepare('SELECT k, v FROM app_state').all() as Array<{ k: string; v: string }>;
    const out: Record<string, unknown> = {};
    for (const r of rows) out[r.k] = safeParse(r.v, r.v);
    return out;
  }

  setState(patch: Record<string, unknown>): void {
    const upsert = this.db.prepare(
      'INSERT INTO app_state (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v',
    );
    const tx = this.db.transaction((obj: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(obj)) upsert.run(k, JSON.stringify(v));
    });
    tx(patch);
  }
}

function rowToPage(r: Record<string, unknown>): PageRecord {
  return {
    id: r.id as string,
    title: r.title as string,
    icon: (r.icon as string) ?? undefined,
    color: (r.color as string) ?? undefined,
    layout: safeParse(r.layout_json as string, null),
    mapping: safeParse(r.mapping_json as string, {}),
    position: r.position as number,
    createdAt: r.created_at as number,
    updatedAt: r.updated_at as number,
  };
}

function safeParse<T>(s: string, fallback: T): T {
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

let store: Store | undefined;
export function getStore(): Store {
  if (!store) store = new SqliteStore(DB_PATH);
  return store;
}
