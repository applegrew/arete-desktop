pub mod display_hints;
pub mod log;
pub mod mcp;
pub mod ollama;
pub mod prompt;
pub mod schema;
pub mod skills;
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
use futures::Stream;
use serde_json::{json, Value};
use std::io;
use std::pin::Pin;
use std::task::{Context, Poll};
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;

use super::{settings, state::AppState};
use ollama::Ollama;
use sse::Sink;
use turn::run_agent_turn;

/// Aborts the turn task when dropped. The response stream owns one of these, so a
/// client disconnect (which drops the body stream) cancels the in-flight turn —
/// dropping the Ollama / MCP request futures (true server-side cancel).
struct AbortOnDrop(tokio::task::JoinHandle<()>);
impl Drop for AbortOnDrop {
    fn drop(&mut self) {
        self.0.abort();
    }
}

/// Wraps the SSE stream, keeping an `AbortOnDrop` alive for the stream's lifetime.
struct GuardedStream<S> {
    inner: S,
    _guard: AbortOnDrop,
}
impl<S: Stream + Unpin> Stream for GuardedStream<S> {
    type Item = S::Item;
    fn poll_next(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<S::Item>> {
        Pin::new(&mut self.inner).poll_next(cx)
    }
}

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

/// GET /api/agui/mcp-status — per-server connection status (discovers if needed).
pub async fn mcp_status(State(st): State<AppState>) -> Json<Value> {
    Json(Value::Array(mcp::status(&st).await))
}

/// POST /api/agui/mcp-reconnect — drop connections, rediscover against live config.
pub async fn mcp_reconnect(State(st): State<AppState>) -> Json<Value> {
    mcp::reset(&st).await;
    Json(Value::Array(mcp::status(&st).await))
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

    let task = tokio::spawn(async move {
        let sink = Sink::new(tx);
        sink.run_started(&thread_id, &run_id).await;

        match run_agent_turn(&st, &body, &ollama, &sink).await {
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

    // The stream owns the task's AbortOnDrop: when the client disconnects, axum
    // drops the body → drops the guard → aborts the turn (cancelling Ollama/MCP).
    let stream = GuardedStream { inner: ReceiverStream::new(rx), _guard: AbortOnDrop(task) };
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "text/event-stream")
        .header(header::CACHE_CONTROL, "no-cache")
        .header(header::CONNECTION, "keep-alive")
        .body(Body::from_stream(stream))
        .unwrap()
}

/// POST /api/mcp-call — execute ONE MCP tool and return its result. Webview-run
/// widget handlers proxy their `tools.<name>(args)` calls here so auth, MCP
/// transport, and result parsing stay server-side. Body: `{ name, args }`.
/// Loopback-only; same trust level as `/api/agui`.
pub async fn mcp_call(State(st): State<AppState>, Json(body): Json<Value>) -> Json<Value> {
    let name = body.get("name").and_then(|n| n.as_str()).unwrap_or("");
    let args = body.get("args").cloned().unwrap_or_else(|| json!({}));
    if name.is_empty() {
        return Json(json!({ "text": "missing tool name", "isError": true }));
    }
    // Ensure MCP tools are discovered so the call resolves.
    mcp::ensure(&st).await;
    let outcome = mcp::call(&st, name, args).await;
    Json(json!({ "text": outcome.text, "isError": outcome.is_error }))
}
