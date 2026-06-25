use anyhow::Result;
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde_json::{json, Map, Value};
use std::path::Path;

use super::models::{ApiChatEntry, ApiPage, ApiSurface, ApiWorkspace};

/// Key in `app_state` holding the globally-active workspace id.
const ACTIVE_WS_KEY: &str = "activeWorkspaceId";
/// Id of the default workspace existing data migrates into.
pub const DEFAULT_WS: &str = "default";

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
         CREATE TABLE IF NOT EXISTS app_state ( k TEXT PRIMARY KEY, v TEXT NOT NULL );
         CREATE TABLE IF NOT EXISTS workspaces (
            id TEXT PRIMARY KEY, name TEXT NOT NULL, position INTEGER NOT NULL,
            created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
            active_tab_id TEXT, chat_dock_state TEXT
         );",
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
    // Migration: add surfaces.history_json (generic per-surface state timeline).
    if !table_has_column(&conn, "surfaces", "history_json")? {
        conn.execute_batch("ALTER TABLE surfaces ADD COLUMN history_json TEXT")?;
    }
    // Migration: scope content by workspace. Existing rows default into the default
    // workspace, so the whole current thread becomes "Workspace 1" with no data loss.
    for tbl in ["pages", "surfaces", "chat_entries"] {
        if !table_has_column(&conn, tbl, "workspace_id")? {
            conn.execute_batch(&format!(
                "ALTER TABLE {tbl} ADD COLUMN workspace_id TEXT NOT NULL DEFAULT '{DEFAULT_WS}'"
            ))?;
        }
    }
    // Migration: persist the under-review state of a script-diff chat entry (a
    // widget handler awaiting approval) so it survives a restart and the diff card
    // can be regenerated.
    for col in ["script_event", "old_code", "new_code"] {
        if !table_has_column(&conn, "chat_entries", col)? {
            conn.execute_batch(&format!("ALTER TABLE chat_entries ADD COLUMN {col} TEXT"))?;
        }
    }

    // Seed a default workspace (existing data already defaults into it) + an active id.
    if count_workspaces(&conn)? == 0 {
        let now = now_ms();
        conn.execute(
            "INSERT INTO workspaces (id, name, position, created_at, updated_at, active_tab_id, chat_dock_state)
             VALUES (?1, 'Workspace 1', 0, ?2, ?2, 'chat', 'dock')",
            params![DEFAULT_WS, now],
        )?;
    }

    // Settings are per-workspace (key 'settings:<ws>'). Migrate the legacy single
    // global 'settings' row into every existing workspace that lacks its own (so the
    // user's current settings are preserved across all workspaces), then drop it.
    // Any workspace still without settings is seeded with defaults.
    {
        let legacy: Option<String> = conn
            .query_row("SELECT v FROM app_state WHERE k = 'settings'", [], |r| r.get(0))
            .optional()?;
        let seed = legacy
            .clone()
            .unwrap_or_else(|| serde_json::to_string(&super::settings::default_settings()).unwrap_or_default());
        let ws_ids: Vec<String> = {
            let mut stmt = conn.prepare("SELECT id FROM workspaces")?;
            let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
            rows.filter_map(|r| r.ok()).collect()
        };
        for ws in ws_ids {
            let key = settings_key(&ws);
            let exists: Option<i64> = conn
                .query_row("SELECT 1 FROM app_state WHERE k = ?1", [&key], |r| r.get(0))
                .optional()?;
            if exists.is_none() {
                conn.execute("INSERT INTO app_state (k, v) VALUES (?1, ?2)", params![key, seed])?;
            }
        }
        if legacy.is_some() {
            conn.execute("DELETE FROM app_state WHERE k = 'settings'", [])?;
        }
    }
    if get_active_workspace_id(&conn)?.is_none() {
        let first = list_workspaces(&conn)?.first().map(|w| w.id.clone());
        if let Some(id) = first {
            set_active_workspace_id(&conn, &id)?;
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
        workspace_id: r.get(9)?,
    })
}

const PAGE_COLS: &str =
    "id, title, icon, color, layout_json, mapping_json, position, created_at, updated_at, workspace_id";

pub fn list_pages(conn: &Connection, ws: &str) -> Result<Vec<ApiPage>> {
    let sql = format!(
        "SELECT {PAGE_COLS} FROM pages WHERE workspace_id = ?1 ORDER BY position ASC, created_at ASC"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([ws], row_to_page)?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn get_page(conn: &Connection, id: &str) -> Result<Option<ApiPage>> {
    let sql = format!("SELECT {PAGE_COLS} FROM pages WHERE id = ?1");
    let mut stmt = conn.prepare(&sql)?;
    Ok(stmt.query_row([id], row_to_page).optional()?)
}

pub fn count_pages(conn: &Connection, ws: &str) -> Result<i64> {
    Ok(conn.query_row("SELECT COUNT(*) FROM pages WHERE workspace_id = ?1", [ws], |r| r.get(0))?)
}

pub fn upsert_page(conn: &Connection, p: &ApiPage) -> Result<()> {
    let layout = serde_json::to_string(&p.layout)?;
    let mapping = serde_json::to_string(&p.mapping)?;
    conn.execute(
        "INSERT INTO pages (id, title, icon, color, layout_json, mapping_json, position, created_at, updated_at, workspace_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
         ON CONFLICT(id) DO UPDATE SET title=excluded.title, icon=excluded.icon, color=excluded.color,
           layout_json=excluded.layout_json, mapping_json=excluded.mapping_json,
           position=excluded.position, updated_at=excluded.updated_at",
        params![p.id, p.title, p.icon, p.color, layout, mapping, p.position, p.created_at, p.updated_at, p.workspace_id],
    )?;
    Ok(())
}

pub fn delete_page(conn: &Connection, id: &str) -> Result<()> {
    conn.execute("DELETE FROM pages WHERE id = ?1", [id])?;
    Ok(())
}

// ---- surfaces ------------------------------------------------------------

pub fn list_surfaces(conn: &Connection, ws: &str) -> Result<Vec<ApiSurface>> {
    let mut stmt = conn.prepare(
        "SELECT surface_id, components_json, data_model_json, updated_at, handlers_json, history_json FROM surfaces WHERE workspace_id = ?1",
    )?;
    let rows = stmt.query_map([ws], |r| {
        let comp: String = r.get(1)?;
        let dm: String = r.get(2)?;
        let handlers: Option<String> = r.get(4)?;
        let history: Option<String> = r.get(5)?;
        Ok(ApiSurface {
            surface_id: r.get(0)?,
            components: safe_parse(&comp, json!([])),
            data_model: safe_parse(&dm, json!({})),
            updated_at: r.get(3)?,
            handlers: handlers.map(|h| safe_parse(&h, json!({}))).unwrap_or_else(|| json!({})),
            history: history.map(|h| safe_parse(&h, json!([]))).unwrap_or_else(|| json!([])),
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn replace_surfaces(conn: &mut Connection, ws: &str, surfaces: &[ApiSurface]) -> Result<()> {
    let now = now_ms();
    let tx = conn.transaction()?;
    tx.execute("DELETE FROM surfaces WHERE workspace_id = ?1", [ws])?;
    {
        let mut stmt = tx.prepare(
            "INSERT OR REPLACE INTO surfaces (surface_id, components_json, data_model_json, updated_at, handlers_json, history_json, workspace_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        )?;
        for s in surfaces {
            let comp = serde_json::to_string(&s.components)?;
            let dm = serde_json::to_string(&s.data_model)?;
            let handlers = serde_json::to_string(&s.handlers)?;
            let history = serde_json::to_string(&s.history)?;
            let updated = if s.updated_at == 0 { now } else { s.updated_at };
            stmt.execute(params![s.surface_id, comp, dm, updated, handlers, history, ws])?;
        }
    }
    tx.commit()?;
    Ok(())
}

// ---- chat ----------------------------------------------------------------

pub fn get_chat(conn: &Connection, ws: &str) -> Result<Vec<ApiChatEntry>> {
    let mut stmt = conn.prepare(
        "SELECT id, role, text, surface_id, created_at, script_event, old_code, new_code FROM chat_entries WHERE workspace_id = ?1 ORDER BY created_at ASC",
    )?;
    let rows = stmt.query_map([ws], |r| {
        Ok(ApiChatEntry {
            id: r.get(0)?,
            role: r.get(1)?,
            text: r.get(2)?,
            surface_id: r.get(3)?,
            created_at: r.get(4)?,
            script_event: r.get(5)?,
            old_code: r.get(6)?,
            new_code: r.get(7)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn save_chat(conn: &mut Connection, ws: &str, entries: &[ApiChatEntry]) -> Result<()> {
    let tx = conn.transaction()?;
    tx.execute("DELETE FROM chat_entries WHERE workspace_id = ?1", [ws])?;
    {
        let mut stmt = tx.prepare(
            "INSERT OR REPLACE INTO chat_entries (id, role, text, surface_id, created_at, workspace_id, script_event, old_code, new_code)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        )?;
        for e in entries {
            stmt.execute(params![
                e.id, e.role, e.text, e.surface_id, e.created_at, ws,
                e.script_event, e.old_code, e.new_code
            ])?;
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

// ---- settings (stored per-workspace in app_state under key 'settings:<ws>') ----

/// app_state key holding a given workspace's settings JSON.
pub fn settings_key(ws: &str) -> String {
    format!("settings:{ws}")
}

pub fn get_settings(conn: &Connection, ws: &str) -> Result<Option<Map<String, Value>>> {
    let raw: Option<String> = conn
        .query_row("SELECT v FROM app_state WHERE k = ?1", [settings_key(ws)], |r| r.get(0))
        .optional()?;
    Ok(raw.and_then(|s| serde_json::from_str::<Map<String, Value>>(&s).ok()))
}

/// Shallow-merge `patch` over the workspace's raw stored settings JSON, then persist.
pub fn save_settings(conn: &Connection, ws: &str, patch: &Map<String, Value>) -> Result<()> {
    let mut next = get_settings(conn, ws)?.unwrap_or_default();
    for (k, v) in patch {
        next.insert(k.clone(), v.clone());
    }
    let s = serde_json::to_string(&Value::Object(next))?;
    conn.execute(
        "INSERT INTO app_state (k, v) VALUES (?1, ?2) ON CONFLICT(k) DO UPDATE SET v = excluded.v",
        params![settings_key(ws), s],
    )?;
    Ok(())
}

// ---- workspaces ----------------------------------------------------------

const WS_COLS: &str =
    "id, name, position, created_at, updated_at, active_tab_id, chat_dock_state";

fn row_to_workspace(r: &Row) -> rusqlite::Result<ApiWorkspace> {
    Ok(ApiWorkspace {
        id: r.get(0)?,
        name: r.get(1)?,
        position: r.get(2)?,
        created_at: r.get(3)?,
        updated_at: r.get(4)?,
        active_tab_id: r.get(5)?,
        chat_dock_state: r.get(6)?,
    })
}

pub fn list_workspaces(conn: &Connection) -> Result<Vec<ApiWorkspace>> {
    let sql = format!("SELECT {WS_COLS} FROM workspaces ORDER BY position ASC, created_at ASC");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], row_to_workspace)?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn get_workspace(conn: &Connection, id: &str) -> Result<Option<ApiWorkspace>> {
    let sql = format!("SELECT {WS_COLS} FROM workspaces WHERE id = ?1");
    let mut stmt = conn.prepare(&sql)?;
    Ok(stmt.query_row([id], row_to_workspace).optional()?)
}

pub fn count_workspaces(conn: &Connection) -> Result<i64> {
    Ok(conn.query_row("SELECT COUNT(*) FROM workspaces", [], |r| r.get(0))?)
}

/// Create a workspace (empty: no pages/surfaces/chat). `id` is caller-supplied.
pub fn create_workspace(conn: &Connection, id: &str, name: &str) -> Result<ApiWorkspace> {
    let now = now_ms();
    let position = count_workspaces(conn)?;
    conn.execute(
        "INSERT INTO workspaces (id, name, position, created_at, updated_at, active_tab_id, chat_dock_state)
         VALUES (?1, ?2, ?3, ?4, ?4, 'chat', 'dock')",
        params![id, name, position, now],
    )?;
    Ok(get_workspace(conn, id)?.expect("just inserted"))
}

/// Patch present fields (rename / persist per-workspace UI state). Returns the updated row.
pub fn update_workspace(
    conn: &Connection,
    id: &str,
    name: Option<&str>,
    active_tab_id: Option<&str>,
    chat_dock_state: Option<&str>,
) -> Result<Option<ApiWorkspace>> {
    let mut cur = match get_workspace(conn, id)? {
        Some(w) => w,
        None => return Ok(None),
    };
    if let Some(n) = name {
        cur.name = n.to_string();
    }
    if let Some(t) = active_tab_id {
        cur.active_tab_id = Some(t.to_string());
    }
    if let Some(d) = chat_dock_state {
        cur.chat_dock_state = Some(d.to_string());
    }
    conn.execute(
        "UPDATE workspaces SET name=?2, active_tab_id=?3, chat_dock_state=?4, updated_at=?5 WHERE id=?1",
        params![id, cur.name, cur.active_tab_id, cur.chat_dock_state, now_ms()],
    )?;
    get_workspace(conn, id)
}

/// Delete a workspace and ALL its content (pages, surfaces, chat).
pub fn delete_workspace(conn: &mut Connection, id: &str) -> Result<()> {
    let tx = conn.transaction()?;
    tx.execute("DELETE FROM pages WHERE workspace_id = ?1", [id])?;
    tx.execute("DELETE FROM surfaces WHERE workspace_id = ?1", [id])?;
    tx.execute("DELETE FROM chat_entries WHERE workspace_id = ?1", [id])?;
    tx.execute("DELETE FROM app_state WHERE k = ?1", [settings_key(id)])?;
    tx.execute("DELETE FROM workspaces WHERE id = ?1", [id])?;
    tx.commit()?;
    Ok(())
}

pub fn get_active_workspace_id(conn: &Connection) -> Result<Option<String>> {
    let raw: Option<String> = conn
        .query_row("SELECT v FROM app_state WHERE k = ?1", [ACTIVE_WS_KEY], |r| r.get(0))
        .optional()?;
    // Stored as a JSON string; fall back to the raw value.
    Ok(raw.map(|s| serde_json::from_str::<String>(&s).unwrap_or(s)))
}

pub fn set_active_workspace_id(conn: &Connection, id: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO app_state (k, v) VALUES (?1, ?2) ON CONFLICT(k) DO UPDATE SET v = excluded.v",
        params![ACTIVE_WS_KEY, serde_json::to_string(id)?],
    )?;
    Ok(())
}

pub fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}
