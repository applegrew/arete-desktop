import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', 'data', 'arete-sandbox.db');

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    initSchema();
  }
  return db;
}

function initSchema(): void {
  const d = getDb();
  d.exec(`
    CREATE TABLE IF NOT EXISTS shell_state (
      k TEXT PRIMARY KEY,
      v TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chat_entries (
      id TEXT PRIMARY KEY,
      role TEXT NOT NULL,
      text TEXT,
      surface_id TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS approvals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT,
      surface_id TEXT,
      page_id TEXT,
      op_name TEXT,
      decision TEXT NOT NULL,
      diff_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
}
