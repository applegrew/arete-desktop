use serde_json::{json, Value};
use std::time::Duration;

/// Which backend an [`LlmClient`] talks to.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Provider {
    /// Ollama native API (`/api/chat`, `format`-constrained JSON).
    Ollama,
    /// DeepSeek's OpenAI-compatible API (`/chat/completions`, Bearer auth).
    Deepseek,
}

/// Multi-provider chat client. Both providers expose the same two operations the
/// turn loop needs — constrained JSON-object generation and a tool-calling step —
/// over different wire formats:
///
/// - **Ollama**: POST `/api/chat`; structured output via `format = <schema>`;
///   tool-call arguments arrive as JSON objects; tool calls have no id.
/// - **DeepSeek**: POST `/chat/completions` with `Authorization: Bearer`; structured
///   output via `response_format = {type: json_object}` (the envelope shape is
///   described in the prompt); tool-call arguments arrive as JSON *strings* and tool
///   calls carry their own ids. Thinking mode is disabled for speed/clean output.
pub struct LlmClient {
    provider: Provider,
    base: String,
    http: reqwest::Client,
    api_key: Option<String>,
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

impl LlmClient {
    pub fn ollama(ollama_url: &str, model: &str) -> Self {
        Self {
            provider: Provider::Ollama,
            base: ollama_url.trim_end_matches('/').to_string(),
            http: reqwest::Client::new(),
            api_key: None,
            model: model.to_string(),
        }
    }

    pub fn deepseek(api_key: &str, model: &str) -> Self {
        Self {
            provider: Provider::Deepseek,
            base: "https://api.deepseek.com".to_string(),
            http: reqwest::Client::new(),
            api_key: Some(api_key.to_string()),
            model: model.to_string(),
        }
    }

    fn chat_url(&self) -> String {
        match self.provider {
            Provider::Ollama => format!("{}/api/chat", self.base),
            Provider::Deepseek => format!("{}/chat/completions", self.base),
        }
    }

    /// A POST builder with Bearer auth attached when the provider needs it.
    fn post(&self, url: String) -> reqwest::RequestBuilder {
        let req = self.http.post(url);
        match &self.api_key {
            Some(key) => req.bearer_auth(key),
            None => req,
        }
    }

    /// The assistant message from a chat response (provider-shaped).
    fn extract_message(&self, v: &Value) -> Value {
        let msg = match self.provider {
            Provider::Ollama => v.get("message").cloned(),
            Provider::Deepseek => {
                v.get("choices").and_then(|c| c.get(0)).and_then(|c| c.get("message")).cloned()
            }
        };
        msg.unwrap_or_else(|| json!({ "role": "assistant", "content": "" }))
    }

    /// `generateObject` equivalent: ask for a single JSON object and parse it.
    pub async fn generate_object(
        &self,
        messages: &[Value],
        schema: Value,
    ) -> Result<Value, ParseError> {
        let body = match self.provider {
            Provider::Ollama => json!({
                "model": self.model,
                "messages": messages,
                "stream": false,
                "format": schema,
            }),
            Provider::Deepseek => json!({
                "model": self.model,
                "messages": messages,
                "stream": false,
                "response_format": { "type": "json_object" },
                "thinking": { "type": "disabled" },
            }),
        };
        let resp = self
            .post(self.chat_url())
            .json(&body)
            .send()
            .await
            .map_err(|e| ParseError { message: format!("llm request failed: {e}"), raw: None })?;
        if !resp.status().is_success() {
            let status = resp.status();
            let txt = resp.text().await.unwrap_or_default();
            return Err(ParseError { message: format!("llm returned {status}: {txt}"), raw: None });
        }
        let v: Value = resp
            .json()
            .await
            .map_err(|e| ParseError { message: format!("llm response not JSON: {e}"), raw: None })?;
        let content = self
            .extract_message(&v)
            .get("content")
            .and_then(|c| c.as_str())
            .unwrap_or("")
            .to_string();
        serde_json::from_str::<Value>(&content).map_err(|e| ParseError {
            message: format!("output was not valid JSON for the required schema: {e}"),
            raw: Some(content),
        })
    }

    /// A tool-calling step. Returns the assistant message and any requested tool
    /// calls. `tool_infos` are `[{name, description, parameters}]`.
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
        let body = match self.provider {
            Provider::Ollama => json!({
                "model": self.model,
                "messages": messages,
                "stream": false,
                "tools": tools,
            }),
            Provider::Deepseek => json!({
                "model": self.model,
                "messages": messages,
                "stream": false,
                "tools": tools,
                "thinking": { "type": "disabled" },
            }),
        };
        let resp = self
            .post(self.chat_url())
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("llm request failed: {e}"))?;
        if !resp.status().is_success() {
            let status = resp.status();
            let txt = resp.text().await.unwrap_or_default();
            return Err(format!("llm returned {status}: {txt}"));
        }
        let v: Value = resp.json().await.map_err(|e| format!("llm response not JSON: {e}"))?;
        let message = self.extract_message(&v);

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
                // Ollama returns arguments as a JSON object; OpenAI/DeepSeek as a
                // JSON string. Normalize both to a Value.
                let raw_args = func.and_then(|f| f.get("arguments")).cloned().unwrap_or_else(|| json!({}));
                let arguments = match raw_args {
                    Value::String(s) => serde_json::from_str(&s).unwrap_or_else(|_| json!({})),
                    other => other,
                };
                // Use the provider's tool-call id when present (DeepSeek needs it
                // echoed back on the tool result); synthesize one for Ollama.
                let id = tc
                    .get("id")
                    .and_then(|x| x.as_str())
                    .map(String::from)
                    .unwrap_or_else(|| format!("call-{}-{}", i, &uuid::Uuid::new_v4().simple().to_string()[..6]));
                calls.push(RawToolCall { id, name, arguments });
            }
        }
        Ok(ChatStep { message, tool_calls: calls })
    }

    /// Liveness/info probe. Ollama: GET `/api/tags`. DeepSeek: GET `/models`.
    pub async fn health(&self) -> Value {
        let timeout = if self.provider == Provider::Deepseek { 8 } else { 2 };
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(timeout))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());
        match self.provider {
            Provider::Ollama => match client.get(format!("{}/api/tags", self.base)).send().await {
                Ok(resp) if resp.status().is_success() => {
                    let data: Value = resp.json().await.unwrap_or_else(|_| json!({}));
                    let available = name_list(&data, "models", "name");
                    json!({ "ok": true, "model": self.model, "available": available })
                }
                _ => json!({ "ok": false }),
            },
            Provider::Deepseek => {
                let mut req = client.get(format!("{}/models", self.base));
                if let Some(key) = &self.api_key {
                    req = req.bearer_auth(key);
                }
                match req.send().await {
                    Ok(resp) if resp.status().is_success() => {
                        let data: Value = resp.json().await.unwrap_or_else(|_| json!({}));
                        let available = name_list(&data, "data", "id");
                        json!({ "ok": true, "model": self.model, "available": available })
                    }
                    _ => json!({ "ok": false }),
                }
            }
        }
    }
}

/// Pull `[<arr_key>][].<name_key>` into a `Vec<String>`.
fn name_list(data: &Value, arr_key: &str, name_key: &str) -> Vec<String> {
    data.get(arr_key)
        .and_then(|m| m.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|m| m.get(name_key).and_then(|n| n.as_str()).map(String::from))
                .collect()
        })
        .unwrap_or_default()
}

/// A parse/transport failure from `generate_object`, carrying the raw model text
/// (when available) so the correction loop can feed it back.
pub struct ParseError {
    pub message: String,
    pub raw: Option<String>,
}
