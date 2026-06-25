use axum::{
    extract::{Query, State},
    Json,
};
use serde_json::{Map, Value};

use crate::server::{db, routes::WsQuery, settings, state::AppState, AppError};

pub async fn get(
    State(st): State<AppState>,
    Query(q): Query<WsQuery>,
) -> Result<Json<Value>, AppError> {
    let conn = st.db_lock();
    Ok(Json(settings::resolve_settings(&conn, &q.id())?))
}

/// PUT shallow-merges the patch into the workspace's stored settings, then returns
/// the resolved object.
pub async fn put(
    State(st): State<AppState>,
    Query(q): Query<WsQuery>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, AppError> {
    let patch: Map<String, Value> = body.as_object().cloned().unwrap_or_default();
    let conn = st.db_lock();
    db::save_settings(&conn, &q.id(), &patch)?;
    Ok(Json(settings::resolve_settings(&conn, &q.id())?))
}
