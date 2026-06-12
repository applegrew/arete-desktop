use axum::{extract::State, Json};
use serde_json::{Map, Value};

use crate::server::{db, settings, state::AppState, AppError};

pub async fn get(State(st): State<AppState>) -> Result<Json<Value>, AppError> {
    let conn = st.db.lock().unwrap();
    Ok(Json(settings::resolve_settings(&conn)?))
}

/// PUT shallow-merges the patch into stored settings, then returns the resolved object.
pub async fn put(
    State(st): State<AppState>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, AppError> {
    let patch: Map<String, Value> = body.as_object().cloned().unwrap_or_default();
    let conn = st.db.lock().unwrap();
    db::save_settings(&conn, &patch)?;
    Ok(Json(settings::resolve_settings(&conn)?))
}
