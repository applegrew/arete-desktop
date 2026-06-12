use anyhow::Result;
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde_json::{json, Map, Value};
use std::path::Path;

use super::models::{ApiChatEntry, ApiPage, ApiSurface};

/// Open the DB (creating parent dirs), enable WAL, create tables, run the
/// icon/color migration, and seed default settings on first boot.
pub fn init(path: &Path) -> Result<Connection> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let conn = Connection::open(path)?;
    // execute_batch ignores the row PRAGMA journal_mode returns.
    conn.execute_batch("PRAGMA journal_mode = WAL;")?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS pages (
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
         CREATE TABLE IF NOT EXISTS app_state ( k TEXT PRIMARY KEY, v TEXT NOT NULL );",
    )?;

    // Migration: add icon + color columns for databases created before they existed.
    for col in ["icon", "color"] {
        if !page_has_column(&conn, col)? {
            conn.execute_batch(&format!("ALTER TABLE pages ADD COLUMN {col} TEXT"))?;
        }
    }
    // Migration: add surfaces.handlers_json (agent-authored widget action scripts).
    if !table_has_column(&conn, "surfaces", "handlers_json")? {
        conn.execute_batch("ALTER TABLE surfaces ADD COLUMN handlers_json TEXT")?;
    }

    // First-boot seed so partial settings saves still yield a complete object.
    if get_settings(&conn)?.is_none() {
        let defaults = super::settings::default_settings();
        if let Value::Object(map) = defaults {
            save_settings(&conn, &map)?;
        }
    }

    Ok(conn)
}

fn page_has_column(conn: &Connection, col: &str) -> Result<bool> {
    table_has_column(conn, "pages", col)
}

fn table_has_column(conn: &Connection, table: &str, col: &str) -> Result<bool> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let names = stmt.query_map([], |r| r.get::<_, String>(1))?;
    for n in names {
        if n? == col {
            return Ok(true);
        }
    }
    Ok(false)
}

fn safe_parse(s: &str, fallback: Value) -> Value {
    serde_json::from_str(s).unwrap_or(fallback)
}

// ---- pages ---------------------------------------------------------------

fn row_to_page(r: &Row) -> rusqlite::Result<ApiPage> {
    let layout_s: String = r.get(4)?;
    let mapping_s: String = r.get(5)?;
    Ok(ApiPage {
        id: r.get(0)?,
        title: r.get(1)?,
        icon: r.get(2)?,
        color: r.get(3)?,
        layout: safe_parse(&layout_s, Value::Null),
        mapping: safe_parse(&mapping_s, json!({})),
        position: r.get(6)?,
        created_at: r.get(7)?,
        updated_at: r.get(8)?,
    })
}

const PAGE_COLS: &str =
    "id, title, icon, color, layout_json, mapping_json, position, created_at, updated_at";

pub fn list_pages(conn: &Connection) -> Result<Vec<ApiPage>> {
    let sql = format!("SELECT {PAGE_COLS} FROM pages ORDER BY position ASC, created_at ASC");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], row_to_page)?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn get_page(conn: &Connection, id: &str) -> Result<Option<ApiPage>> {
    let sql = format!("SELECT {PAGE_COLS} FROM pages WHERE id = ?1");
    let mut stmt = conn.prepare(&sql)?;
    Ok(stmt.query_row([id], row_to_page).optional()?)
}

pub fn count_pages(conn: &Connection) -> Result<i64> {
    Ok(conn.query_row("SELECT COUNT(*) FROM pages", [], |r| r.get(0))?)
}

pub fn upsert_page(conn: &Connection, p: &ApiPage) -> Result<()> {
    let layout = serde_json::to_string(&p.layout)?;
    let mapping = serde_json::to_string(&p.mapping)?;
    conn.execute(
        "INSERT INTO pages (id, title, icon, color, layout_json, mapping_json, position, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(id) DO UPDATE SET title=excluded.title, icon=excluded.icon, color=excluded.color,
           layout_json=excluded.layout_json, mapping_json=excluded.mapping_json,
           position=excluded.position, updated_at=excluded.updated_at",
        params![p.id, p.title, p.icon, p.color, layout, mapping, p.position, p.created_at, p.updated_at],
    )?;
    Ok(())
}

pub fn delete_page(conn: &Connection, id: &str) -> Result<()> {
    conn.execute("DELETE FROM pages WHERE id = ?1", [id])?;
    Ok(())
}

// ---- surfaces ------------------------------------------------------------

pub fn list_surfaces(conn: &Connection) -> Result<Vec<ApiSurface>> {
    let mut stmt = conn.prepare(
        "SELECT surface_id, components_json, data_model_json, updated_at, handlers_json FROM surfaces",
    )?;
    let rows = stmt.query_map([], |r| {
        let comp: String = r.get(1)?;
        let dm: String = r.get(2)?;
        let handlers: Option<String> = r.get(4)?;
        Ok(ApiSurface {
            surface_id: r.get(0)?,
            components: safe_parse(&comp, json!([])),
            data_model: safe_parse(&dm, json!({})),
            updated_at: r.get(3)?,
            handlers: handlers.map(|h| safe_parse(&h, json!({}))).unwrap_or_else(|| json!({})),
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn replace_surfaces(conn: &mut Connection, surfaces: &[ApiSurface]) -> Result<()> {
    let now = now_ms();
    let tx = conn.transaction()?;
    tx.execute("DELETE FROM surfaces", [])?;
    {
        let mut stmt = tx.prepare(
            "INSERT OR REPLACE INTO surfaces (surface_id, components_json, data_model_json, updated_at, handlers_json)
             VALUES (?1, ?2, ?3, ?4, ?5)",
        )?;
        for s in surfaces {
            let comp = serde_json::to_string(&s.components)?;
            let dm = serde_json::to_string(&s.data_model)?;
            let handlers = serde_json::to_string(&s.handlers)?;
            let updated = if s.updated_at == 0 { now } else { s.updated_at };
            stmt.execute(params![s.surface_id, comp, dm, updated, handlers])?;
        }
    }
    tx.commit()?;
    Ok(())
}

// ---- chat ----------------------------------------------------------------

pub fn get_chat(conn: &Connection) -> Result<Vec<ApiChatEntry>> {
    let mut stmt = conn.prepare(
        "SELECT id, role, text, surface_id, created_at FROM chat_entries ORDER BY created_at ASC",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(ApiChatEntry {
            id: r.get(0)?,
            role: r.get(1)?,
            text: r.get(2)?,
            surface_id: r.get(3)?,
            created_at: r.get(4)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn save_chat(conn: &mut Connection, entries: &[ApiChatEntry]) -> Result<()> {
    let tx = conn.transaction()?;
    tx.execute("DELETE FROM chat_entries", [])?;
    {
        let mut stmt = tx.prepare(
            "INSERT OR REPLACE INTO chat_entries (id, role, text, surface_id, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
        )?;
        for e in entries {
            stmt.execute(params![e.id, e.role, e.text, e.surface_id, e.created_at])?;
        }
    }
    tx.commit()?;
    Ok(())
}

// ---- app_state -----------------------------------------------------------

pub fn get_state(conn: &Connection) -> Result<Map<String, Value>> {
    let mut stmt = conn.prepare("SELECT k, v FROM app_state")?;
    let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
    let mut out = Map::new();
    for row in rows {
        let (k, v) = row?;
        let parsed = serde_json::from_str(&v).unwrap_or(Value::String(v));
        out.insert(k, parsed);
    }
    Ok(out)
}

pub fn set_state(conn: &mut Connection, patch: &Map<String, Value>) -> Result<()> {
    let tx = conn.transaction()?;
    {
        let mut stmt = tx.prepare(
            "INSERT INTO app_state (k, v) VALUES (?1, ?2) ON CONFLICT(k) DO UPDATE SET v = excluded.v",
        )?;
        for (k, v) in patch {
            stmt.execute(params![k, serde_json::to_string(v)?])?;
        }
    }
    tx.commit()?;
    Ok(())
}

// ---- settings (stored in app_state under key 'settings') -----------------

pub fn get_settings(conn: &Connection) -> Result<Option<Map<String, Value>>> {
    let raw: Option<String> = conn
        .query_row("SELECT v FROM app_state WHERE k = 'settings'", [], |r| r.get(0))
        .optional()?;
    Ok(raw.and_then(|s| serde_json::from_str::<Map<String, Value>>(&s).ok()))
}

/// Shallow-merge `patch` over the raw stored settings JSON, then persist.
pub fn save_settings(conn: &Connection, patch: &Map<String, Value>) -> Result<()> {
    let mut next = get_settings(conn)?.unwrap_or_default();
    for (k, v) in patch {
        next.insert(k.clone(), v.clone());
    }
    let s = serde_json::to_string(&Value::Object(next))?;
    conn.execute(
        "INSERT INTO app_state (k, v) VALUES ('settings', ?1) ON CONFLICT(k) DO UPDATE SET v = excluded.v",
        params![s],
    )?;
    Ok(())
}

pub fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}
