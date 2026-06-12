use serde_json::{json, Value};
use std::time::Duration;

/// Thin Ollama client mirroring what `ollama-ai-provider-v2` POSTs to `/api/chat`.
/// Messages are raw JSON objects (`{role, content, ...}`) so tool-call and tool
/// result messages flow through the conversation unchanged.
pub struct Ollama {
    base: String, // e.g. http://localhost:11434
    http: reqwest::Client,
    pub model: String,
}

/// One tool call requested by the model in a tool-calling step.
pub struct RawToolCall {
    pub id: String,
    pub name: String,
    pub arguments: Value,
}

/// Result of a tool-calling chat step.
pub struct ChatStep {
    /// The assistant message verbatim (incl. any tool_calls) — pushed back into the convo.
    pub message: Value,
    pub tool_calls: Vec<RawToolCall>,
}

impl Ollama {
    pub fn new(ollama_url: &str, model: &str) -> Self {
        Self {
            base: ollama_url.trim_end_matches('/').to_string(),
            http: reqwest::Client::new(),
            model: model.to_string(),
        }
    }

    /// `generateObject` equivalent: POST `/api/chat` with `format = schema` so Ollama
    /// constrains decoding, then parse `message.content` as JSON.
    pub async fn generate_object(
        &self,
        messages: &[Value],
        schema: Value,
    ) -> Result<Value, ParseError> {
        let body = json!({
            "model": self.model,
            "messages": messages,
            "stream": false,
            "format": schema,
        });
        let resp = self
            .http
            .post(format!("{}/api/chat", self.base))
            .json(&body)
            .send()
            .await
            .map_err(|e| ParseError { message: format!("ollama request failed: {e}"), raw: None })?;
        if !resp.status().is_success() {
            let status = resp.status();
            let txt = resp.text().await.unwrap_or_default();
            return Err(ParseError { message: format!("ollama returned {status}: {txt}"), raw: None });
        }
        let v: Value = resp
            .json()
            .await
            .map_err(|e| ParseError { message: format!("ollama response not JSON: {e}"), raw: None })?;
        let content = v
            .get("message")
            .and_then(|m| m.get("content"))
            .and_then(|c| c.as_str())
            .unwrap_or("")
            .to_string();
        serde_json::from_str::<Value>(&content).map_err(|e| ParseError {
            message: format!("output was not valid JSON for the required schema: {e}"),
            raw: Some(content),
        })
    }

    /// A tool-calling step: POST `/api/chat` with `tools` (no `format`). Returns the
    /// assistant message and any requested tool calls. `tool_infos` are
    /// `[{name, description, parameters}]` (from MCP discovery).
    pub async fn chat_with_tools(
        &self,
        messages: &[Value],
        tool_infos: &[Value],
    ) -> Result<ChatStep, String> {
        let tools: Vec<Value> = tool_infos
            .iter()
            .map(|t| {
                json!({
                    "type": "function",
                    "function": {
                        "name": t.get("name").cloned().unwrap_or(Value::Null),
                        "description": t.get("description").cloned().unwrap_or(Value::Null),
                        "parameters": t.get("parameters").cloned().unwrap_or_else(|| json!({})),
                    }
                })
            })
            .collect();
        let body = json!({
            "model": self.model,
            "messages": messages,
            "stream": false,
            "tools": tools,
        });
        let resp = self
            .http
            .post(format!("{}/api/chat", self.base))
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("ollama request failed: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!("ollama returned {}", resp.status()));
        }
        let v: Value = resp.json().await.map_err(|e| format!("ollama response not JSON: {e}"))?;
        let message = v.get("message").cloned().unwrap_or_else(|| json!({ "role": "assistant", "content": "" }));

        let mut calls = Vec::new();
        if let Some(tcs) = message.get("tool_calls").and_then(|t| t.as_array()) {
            for (i, tc) in tcs.iter().enumerate() {
                let func = tc.get("function");
                let name = func
                    .and_then(|f| f.get("name"))
                    .and_then(|n| n.as_str())
                    .unwrap_or("")
                    .to_string();
                if name.is_empty() {
                    continue;
                }
                let arguments = func.and_then(|f| f.get("arguments")).cloned().unwrap_or_else(|| json!({}));
                // Ollama tool calls have no id; synthesize a stable one.
                let id = format!("call-{}-{}", i, &uuid::Uuid::new_v4().simple().to_string()[..6]);
                calls.push(RawToolCall { id, name, arguments });
            }
        }
        Ok(ChatStep { message, tool_calls: calls })
    }

    /// Liveness/info probe — GET `/api/tags`, 2s timeout.
    pub async fn health(&self) -> Value {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(2))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());
        match client.get(format!("{}/api/tags", self.base)).send().await {
            Ok(resp) if resp.status().is_success() => {
                let data: Value = resp.json().await.unwrap_or_else(|_| json!({}));
                let available: Vec<String> = data
                    .get("models")
                    .and_then(|m| m.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|m| m.get("name").and_then(|n| n.as_str()).map(String::from))
                            .collect()
                    })
                    .unwrap_or_default();
                json!({ "ok": true, "model": self.model, "available": available })
            }
            _ => json!({ "ok": false }),
        }
    }
}

/// A parse/transport failure from `generate_object`, carrying the raw model text
/// (when available) so the correction loop can feed it back.
pub struct ParseError {
    pub message: String,
    pub raw: Option<String>,
}
