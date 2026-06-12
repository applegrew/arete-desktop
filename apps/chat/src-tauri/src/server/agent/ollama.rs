use anyhow::Result;
use serde_json::{json, Value};
use std::time::Duration;

/// A chat message sent to Ollama (`/api/chat`).
#[derive(Clone)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

impl ChatMessage {
    pub fn system(s: impl Into<String>) -> Self {
        Self { role: "system".into(), content: s.into() }
    }
    pub fn user(s: impl Into<String>) -> Self {
        Self { role: "user".into(), content: s.into() }
    }
    pub fn assistant(s: impl Into<String>) -> Self {
        Self { role: "assistant".into(), content: s.into() }
    }
    fn to_json(&self) -> Value {
        json!({ "role": self.role, "content": self.content })
    }
}

/// Thin Ollama client mirroring what `ollama-ai-provider-v2` POSTs to `/api/chat`.
pub struct Ollama {
    base: String, // e.g. http://localhost:11434
    http: reqwest::Client,
    pub model: String,
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
    /// constrains decoding to the schema, then parse `message.content` as JSON.
    /// Returns the parsed object, or an error carrying the raw text on parse failure.
    pub async fn generate_object(
        &self,
        messages: &[ChatMessage],
        schema: Value,
    ) -> Result<Value, ParseError> {
        let body = json!({
            "model": self.model,
            "messages": messages.iter().map(|m| m.to_json()).collect::<Vec<_>>(),
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
            return Err(ParseError {
                message: format!("ollama returned {status}: {txt}"),
                raw: None,
            });
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

    /// Liveness/info probe used by `/api/agui/health` — GET `/api/tags`, 2s timeout.
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
