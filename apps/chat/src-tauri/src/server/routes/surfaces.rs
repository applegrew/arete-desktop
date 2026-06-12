use axum::{extract::State, Json};
use serde_json::{json, Value};

use crate::server::{db, models::ApiSurface, state::AppState, AppError};

pub async fn list(State(st): State<AppState>) -> Result<Json<Vec<ApiSurface>>, AppError> {
    let conn = st.db.lock().unwrap();
    Ok(Json(db::list_surfaces(&conn)?))
}

/// Bulk replace — the client sends the full current surface set on each save.
pub async fn replace(
    State(st): State<AppState>,
    Json(surfaces): Json<Vec<ApiSurface>>,
) -> Result<Json<Value>, AppError> {
    let mut conn = st.db.lock().unwrap();
    db::replace_surfaces(&mut conn, &surfaces)?;
    Ok(Json(json!({ "ok": true })))
}
