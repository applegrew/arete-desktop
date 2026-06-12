use axum::{extract::State, Json};
use serde_json::{json, Map, Value};

use crate::server::{db, state::AppState, AppError};

pub async fn get(State(st): State<AppState>) -> Result<Json<Value>, AppError> {
    let conn = st.db.lock().unwrap();
    Ok(Json(Value::Object(db::get_state(&conn)?)))
}

/// Shallow per-key upsert (NOT replace). `settings` shares this table under its own key.
pub async fn post(
    State(st): State<AppState>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, AppError> {
    let patch: Map<String, Value> = body.as_object().cloned().unwrap_or_default();
    let mut conn = st.db.lock().unwrap();
    db::set_state(&mut conn, &patch)?;
    Ok(Json(json!({ "ok": true })))
}
