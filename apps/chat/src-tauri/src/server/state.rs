use anyhow::Result;
use rusqlite::Connection;
use std::path::Path;
use std::sync::{Arc, Mutex};

use super::db;

/// Shared axum state. A single SQLite connection guarded by a mutex — the
/// workload is one local desktop user, so serial access is fine (and the
/// `Store` seam means swapping to a pool later won't touch routes).
#[derive(Clone)]
pub struct AppState {
    pub db: Arc<Mutex<Connection>>,
}

impl AppState {
    pub fn new(db_path: &Path) -> Result<Self> {
        let conn = db::init(db_path)?;
        Ok(Self {
            db: Arc::new(Mutex::new(conn)),
        })
    }
}
