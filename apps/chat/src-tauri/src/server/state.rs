use anyhow::Result;
use rusqlite::Connection;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};

use super::agent::mcp::McpCache;
use super::db;

/// Shared axum state. A single SQLite connection guarded by a mutex — the
/// workload is one local desktop user, so serial access is fine (and the
/// `Store` seam means swapping to a pool later won't touch routes).
/// `data_dir` is the app-data dir (skills, llm-logs live alongside the DB).
/// `mcp` memoizes discovered MCP tools, rebuilt when the server config changes.
#[derive(Clone)]
pub struct AppState {
    pub db: Arc<Mutex<Connection>>,
    pub data_dir: PathBuf,
    pub mcp: Arc<tokio::sync::Mutex<McpCache>>,
}

impl AppState {
    pub fn new(db_path: &Path) -> Result<Self> {
        let conn = db::init(db_path)?;
        let data_dir = db_path
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| PathBuf::from("."));
        Ok(Self {
            db: Arc::new(Mutex::new(conn)),
            data_dir,
            mcp: Arc::new(tokio::sync::Mutex::new(McpCache::default())),
        })
    }

    pub fn skills_dir(&self) -> PathBuf {
        self.data_dir.join("skills")
    }

    /// Poison-tolerant DB lock. A panic while the guard is held would otherwise
    /// poison the mutex and turn every subsequent `lock().unwrap()` into a panic,
    /// permanently bricking all `/api` calls. The connection itself is unaffected
    /// by an unrelated panic, so recovering the guard is safe here.
    pub fn db_lock(&self) -> MutexGuard<'_, Connection> {
        self.db.lock().unwrap_or_else(|e| e.into_inner())
    }
}
