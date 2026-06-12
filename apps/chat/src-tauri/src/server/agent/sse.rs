use bytes::Bytes;
use serde_json::{json, Value};
use std::io;
use tokio::sync::mpsc;

// AG-UI event type wire strings (must match @ag-ui/core's EventType enum values).
pub const RUN_STARTED: &str = "RUN_STARTED";
pub const RUN_FINISHED: &str = "RUN_FINISHED";
pub const RUN_ERROR: &str = "RUN_ERROR";
pub const TEXT_MESSAGE_START: &str = "TEXT_MESSAGE_START";
pub const TEXT_MESSAGE_CONTENT: &str = "TEXT_MESSAGE_CONTENT";
pub const TEXT_MESSAGE_END: &str = "TEXT_MESSAGE_END";
#[allow(dead_code)]
pub const TOOL_CALL_START: &str = "TOOL_CALL_START";
#[allow(dead_code)]
pub const TOOL_CALL_END: &str = "TOOL_CALL_END";
#[allow(dead_code)]
pub const TOOL_CALL_RESULT: &str = "TOOL_CALL_RESULT";
pub const CUSTOM: &str = "CUSTOM";

/// CUSTOM event name carrying an arete Emission (matches @arete-desktop/agui's ARETE_EMISSION_EVENT).
pub const ARETE_EMISSION_EVENT: &str = "arete.emission";

/// Writes AG-UI SSE frames into an mpsc channel as raw `data: <json>\n\n` bytes —
/// byte-compatible with the old Node server (each payload gets a `timestamp`).
pub struct Sink {
    tx: mpsc::Sender<Result<Bytes, io::Error>>,
}

impl Sink {
    pub fn new(tx: mpsc::Sender<Result<Bytes, io::Error>>) -> Self {
        Self { tx }
    }

    /// Send one event. `event` is a JSON object; a `timestamp` (ms epoch) is appended.
    pub async fn send(&self, mut event: Value) {
        if let Value::Object(ref mut map) = event {
            map.insert("timestamp".into(), json!(chrono::Utc::now().timestamp_millis()));
        }
        let frame = format!("data: {}\n\n", event);
        let _ = self.tx.send(Ok(Bytes::from(frame))).await;
    }

    pub async fn run_started(&self, thread_id: &str, run_id: &str) {
        self.send(json!({ "type": RUN_STARTED, "threadId": thread_id, "runId": run_id })).await;
    }

    pub async fn run_finished(&self, thread_id: &str, run_id: &str) {
        self.send(json!({ "type": RUN_FINISHED, "threadId": thread_id, "runId": run_id })).await;
    }

    pub async fn run_error(&self, message: &str, code: Option<&str>) {
        let mut ev = json!({ "type": RUN_ERROR, "message": message });
        if let Some(c) = code {
            ev["code"] = json!(c);
        }
        self.send(ev).await;
    }

    /// Emit a complete text message as START → CONTENT → END (non-streaming).
    pub async fn emit_text(&self, message_id: &str, text: &str, role: &str) {
        self.send(json!({ "type": TEXT_MESSAGE_START, "messageId": message_id, "role": role })).await;
        self.send(json!({ "type": TEXT_MESSAGE_CONTENT, "messageId": message_id, "delta": text })).await;
        self.send(json!({ "type": TEXT_MESSAGE_END, "messageId": message_id })).await;
    }

    pub async fn emission(&self, value: &Value) {
        self.send(json!({ "type": CUSTOM, "name": ARETE_EMISSION_EVENT, "value": value })).await;
    }
}
