use axum::{extract::State, Json};
use serde_json::{json, Value};

use crate::server::{db, models::ApiChatEntry, state::AppState, AppError};

pub async fn list(State(st): State<AppState>) -> Result<Json<Vec<ApiChatEntry>>, AppError> {
    let conn = st.db.lock().unwrap();
    Ok(Json(db::get_chat(&conn)?))
}

pub async fn save(
    State(st): State<AppState>,
    Json(entries): Json<Vec<ApiChatEntry>>,
) -> Result<Json<Value>, AppError> {
    let mut conn = st.db.lock().unwrap();
    db::save_chat(&mut conn, &entries)?;
    Ok(Json(json!({ "ok": true })))
}
