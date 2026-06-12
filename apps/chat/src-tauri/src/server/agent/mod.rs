pub mod ollama;
pub mod prompt;
pub mod schema;
pub mod sse;
pub mod turn;

use axum::{
    body::Body,
    extract::State,
    http::{header, StatusCode},
    response::Response,
    Json,
};
use bytes::Bytes;
use serde_json::{json, Value};
use std::io;
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;

use super::{settings, state::AppState};
use ollama::Ollama;
use sse::Sink;
use turn::run_agent_turn;

/// Build an Ollama client from the live persisted settings (model + base URL).
fn resolve_ollama(st: &AppState) -> Ollama {
    let conn = st.db.lock().unwrap();
    let s = settings::resolve_settings(&conn).unwrap_or_else(|_| json!({}));
    let model = s.get("model").and_then(|m| m.as_str()).unwrap_or("gemma4:31b-cloud");
    let url = s.get("ollamaUrl").and_then(|u| u.as_str()).unwrap_or("http://localhost:11434");
    Ollama::new(url, model)
}

/// GET /api/agui/health — Ollama liveness + available models.
pub async fn health(State(st): State<AppState>) -> Json<Value> {
    let ollama = resolve_ollama(&st);
    Json(ollama.health().await)
}

// MCP is deferred (Phase 3) — no servers, empty status.
pub async fn mcp_status() -> Json<Value> {
    Json(json!([]))
}
pub async fn mcp_reconnect() -> Json<Value> {
    Json(json!([]))
}

/// POST /api/agui — run one agent turn and stream the result as an AG-UI SSE stream.
pub async fn run_turn(State(st): State<AppState>, Json(body): Json<Value>) -> Response {
    let ollama = resolve_ollama(&st);
    let thread_id = body
        .get("threadId")
        .and_then(|t| t.as_str())
        .map(String::from)
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let run_id = uuid::Uuid::new_v4().to_string();

    let (tx, rx) = mpsc::channel::<Result<Bytes, io::Error>>(64);

    tokio::spawn(async move {
        let sink = Sink::new(tx);
        sink.run_started(&thread_id, &run_id).await;

        match run_agent_turn(&body, &ollama).await {
            Ok(outcome) => {
                if let Some(rationale) = &outcome.rationale {
                    sink.emit_text(&format!("thinking:{run_id}"), rationale, "assistant").await;
                }
                if let Some(reply) = &outcome.reply {
                    sink.emit_text(&format!("reply:{run_id}"), reply, "assistant").await;
                }
                for emission in &outcome.validated {
                    sink.emission(emission).await;
                }
                sink.run_finished(&thread_id, &run_id).await;
            }
            Err((status, body)) => {
                let msg = body.get("error").and_then(|e| e.as_str()).unwrap_or("agent error");
                sink.run_error(msg, Some(&status.to_string())).await;
            }
        }
        // tx drops here → the response stream ends.
    });

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "text/event-stream")
        .header(header::CACHE_CONTROL, "no-cache")
        .header(header::CONNECTION, "keep-alive")
        .body(Body::from_stream(ReceiverStream::new(rx)))
        .unwrap()
}
