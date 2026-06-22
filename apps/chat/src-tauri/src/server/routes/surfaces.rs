use axum::{
    extract::{Query, State},
    Json,
};
use serde_json::{json, Value};

use crate::server::{db, models::ApiSurface, routes::WsQuery, state::AppState, AppError};

pub async fn list(
    State(st): State<AppState>,
    Query(q): Query<WsQuery>,
) -> Result<Json<Vec<ApiSurface>>, AppError> {
    let conn = st.db_lock();
    Ok(Json(db::list_surfaces(&conn, &q.id())?))
}

/// Bulk replace — the client sends the full current surface set for the workspace.
pub async fn replace(
    State(st): State<AppState>,
    Query(q): Query<WsQuery>,
    Json(surfaces): Json<Vec<ApiSurface>>,
) -> Result<Json<Value>, AppError> {
    let mut conn = st.db_lock();
    db::replace_surfaces(&mut conn, &q.id(), &surfaces)?;
    Ok(Json(json!({ "ok": true })))
}
