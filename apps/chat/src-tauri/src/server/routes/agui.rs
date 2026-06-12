use axum::Json;
use serde_json::{json, Value};

// Stubs until the Phase 2 Rust agent loop lands. The frontend `.catch()`es these,
// so returning "not ready" / empty keeps the UI functional without an agent.

pub async fn health() -> Json<Value> {
    Json(json!({ "ok": false }))
}

pub async fn mcp_status() -> Json<Value> {
    Json(json!([]))
}

pub async fn mcp_reconnect() -> Json<Value> {
    Json(json!([]))
}
