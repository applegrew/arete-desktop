use axum::{
    extract::{Query, State},
    Json,
};
use serde_json::{json, Value};

use crate::server::{db, models::ApiChatEntry, routes::WsQuery, state::AppState, AppError};

pub async fn list(
    State(st): State<AppState>,
    Query(q): Query<WsQuery>,
) -> Result<Json<Vec<ApiChatEntry>>, AppError> {
    let conn = st.db_lock();
    Ok(Json(db::get_chat(&conn, &q.id())?))
}

pub async fn save(
    State(st): State<AppState>,
    Query(q): Query<WsQuery>,
    Json(entries): Json<Vec<ApiChatEntry>>,
) -> Result<Json<Value>, AppError> {
    let mut conn = st.db_lock();
    db::save_chat(&mut conn, &q.id(), &entries)?;
    Ok(Json(json!({ "ok": true })))
}
