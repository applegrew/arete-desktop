use serde_json::{json, Value};

/// JSON Schema mirror of @arete-desktop/agent's `envelopeSchema` (the zod schema in
/// run-turn.ts). Sent to Ollama as `format` so constrained decoding forces the model
/// to emit `{ reply?, rationale?, emissions: [...] }`. A2UI `messages` stay loose
/// (`{}` = any) — they're validated by the domain checks in turn.rs, not the schema.
pub fn envelope_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "reply": { "type": "string" },
            "rationale": { "type": "string" },
            // Optional discovery chips: clickable next-step suggestions shown in chat.
            // Each becomes a user message when clicked (pure prompt-injection).
            "discoveryChips": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "label": { "type": "string" },
                        "prompt": { "type": "string" }
                    },
                    "required": ["label", "prompt"],
                    "additionalProperties": false
                }
            },
            "emissions": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "kind": { "type": "string", "enum": ["a2ui", "pageOp", "widgetScript", "buildScript"] },
                        "targetSurfaceId": { "type": "string" },
                        "messages": { "type": "array", "items": {} },
                        "op": page_op_schema(),
                        // widgetScript: a JS handler attached to a surface for an action event.
                        // One runtime (the webview); no server/client flag.
                        "event": { "type": "string" },
                        "code": { "type": "string" }
                    },
                    "required": ["kind"],
                    "additionalProperties": false
                }
            }
        },
        "required": ["emissions"],
        "additionalProperties": false
    })
}

fn page_op_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "name": {
                "type": "string",
                "enum": [
                    "setPageProps", "setPageLayout",
                    "pinSurface", "unpinSurface", "moveSurface", "setPageRegion"
                ]
            },
            "pageId": { "type": "string" },
            "title": { "type": "string" },
            "icon": { "type": "string" },
            "color": { "type": "string" },
            "surfaceId": { "type": ["string", "null"] },
            "regionId": { "type": "string" },
            "targetRegion": { "type": "string" },
            "region": { "type": "string" },
            "layout": layout_schema()
        },
        "required": ["name"],
        "additionalProperties": false
    })
}

fn layout_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "kind": { "type": "string", "enum": ["grid", "row", "column", "dock"] },
            "rows": { "type": "number" },
            "cols": { "type": "number" },
            "regions": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "id": { "type": "string" },
                        "gridArea": { "type": "string" }
                    },
                    "required": ["id"],
                    "additionalProperties": false
                }
            }
        },
        "required": ["kind"],
        "additionalProperties": false
    })
}
