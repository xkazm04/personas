//! Remote HTTP inference path — the split engine (Qwen/DashScope).
//!
//! Runs a persona's inference against a remote, OpenAI-compatible HTTP LLM
//! provider instead of spawning the local Claude CLI. Orchestration (Mode A/B,
//! team memory, goals) stays local; only the model call is remote.
//!
//! Dispatched from `runner::run_execution` when the per-capability
//! `ModelProfile.provider` is a remote HTTP provider ([`is_remote_http_provider`]).
//! Routing on the provider string avoids touching the `EngineKind` enum.
//!
//! Like the CLI path, this only emits `EXECUTION_OUTPUT` / `EXECUTION_STATUS`
//! events and returns an [`ExecutionResult`]; the caller persists the terminal
//! DB row.
//!
//! Module layout:
//! - [`config`]  — endpoints, pricing, remote-safe tool allowlists
//! - [`secrets`] — API-key resolution + OS-keyring storage
//! - [`events`]  — Tauri event helpers
//! - [`openai`]  — streaming text path (no tools)
//! - [`tools`]   — tool-calling loop + built-ins + in-process MCP bridge

mod config;
mod events;
mod openai;
mod secrets;
mod tools;

pub use config::{is_remote_http_provider, DEFAULT_BASE_URL, DEFAULT_MODEL};
pub use secrets::{clear_qwen_api_key, qwen_key_configured, store_qwen_api_key};

use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::Instant;

use crate::engine::events::ExecutionEventEmitter;
use crate::engine::types::{ExecutionResult, ModelProfile};

/// Execute a persona via the remote HTTP provider. Resolves the key + endpoint,
/// then dispatches to the tool-calling loop (tool-enabled) or the streaming text
/// path. Emits live events + a terminal status and returns the `ExecutionResult`
/// for the caller to persist. Never writes terminal DB status itself.
#[allow(clippy::too_many_arguments)]
pub async fn run_http_execution(
    emitter: &dyn ExecutionEventEmitter,
    execution_id: &str,
    persona_name: &str,
    model_profile: &ModelProfile,
    prompt_text: &str,
    tools_enabled: bool,
    cancelled: &Arc<AtomicBool>,
    start_time: Instant,
) -> ExecutionResult {
    let provider = model_profile.provider.as_deref().unwrap_or("qwen");
    let model = model_profile.model.as_deref().unwrap_or(DEFAULT_MODEL).to_string();

    let api_key = match secrets::resolve_api_key(model_profile) {
        Some(k) => k,
        None => {
            return events::fail(
                emitter,
                execution_id,
                &format!(
                    "No API key for remote provider '{provider}'. Set it in the keyring \
                     (qwen-api-key) or QWEN_API_KEY/DASHSCOPE_API_KEY."
                ),
                start_time,
            );
        }
    };

    let base_url = model_profile
        .base_url
        .as_deref()
        .filter(|s| !s.is_empty())
        .unwrap_or(DEFAULT_BASE_URL)
        .trim_end_matches('/')
        .to_string();

    tracing::info!(execution_id, provider, model, persona = persona_name, %base_url, tools_enabled, "[http_engine] starting remote inference");

    if tools_enabled {
        tools::run_tool_loop(
            emitter, execution_id, provider, &model, &base_url, &api_key, prompt_text, cancelled, start_time,
        )
        .await
    } else {
        openai::run_streaming(
            emitter, execution_id, provider, &model, &base_url, &api_key, prompt_text, cancelled, start_time,
        )
        .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::events::{ExecutionEventEmitter, NoOpEmitter};
    use crate::engine::types::ModelProfile;
    use std::sync::atomic::AtomicBool;
    use std::sync::Arc;
    use std::time::Instant;

    fn qwen_profile() -> ModelProfile {
        ModelProfile {
            model: Some(DEFAULT_MODEL.to_string()),
            provider: Some("qwen".to_string()),
            base_url: None,
            auth_token: None,
            prompt_cache_policy: None,
            effort: None,
        }
    }

    /// Live text round-trip. Ignored by default (needs a key + network):
    ///   QWEN_API_KEY=... cargo test --features desktop --lib http_engine -- --ignored
    #[tokio::test]
    #[ignore = "hits the live Qwen API; set QWEN_API_KEY/DASHSCOPE_API_KEY and run with --ignored"]
    async fn live_qwen_roundtrip() {
        let emitter = NoOpEmitter::new();
        let cancelled = Arc::new(AtomicBool::new(false));
        let result = run_http_execution(
            &emitter,
            "live-test-exec",
            "Live Test",
            &qwen_profile(),
            "Reply with exactly the single word: PONG",
            false,
            &cancelled,
            Instant::now(),
        )
        .await;
        assert!(result.success, "expected success, got error: {:?}", result.error);
        assert!(!result.output.unwrap_or_default().trim().is_empty(), "expected non-empty output");
    }

    /// Live tool-calling loop: the model must call the built-in `get_current_time`.
    #[tokio::test]
    #[ignore = "hits the live Qwen API + does a tool-calling round-trip; run with --ignored"]
    async fn live_qwen_tool_loop() {
        let emitter = NoOpEmitter::new();
        let cancelled = Arc::new(AtomicBool::new(false));
        let result = run_http_execution(
            &emitter,
            "live-tool-exec",
            "Tool Test",
            &qwen_profile(),
            "What is the current UTC time? You MUST call the get_current_time tool, then state the time you got.",
            true,
            &cancelled,
            Instant::now(),
        )
        .await;
        assert!(result.success, "expected success, got error: {:?}", result.error);
        assert!(!result.output.unwrap_or_default().trim().is_empty(), "expected non-empty output");
    }

    /// Capturing emitter so the MCP test can assert which tool actually fired.
    struct CapturingEmitter {
        events: std::sync::Mutex<Vec<(String, serde_json::Value)>>,
    }
    impl CapturingEmitter {
        fn new() -> Self {
            Self { events: std::sync::Mutex::new(Vec::new()) }
        }
        fn output_lines(&self) -> Vec<String> {
            self.events
                .lock()
                .unwrap()
                .iter()
                .filter_map(|(_, p)| p.get("line").and_then(|v| v.as_str()).map(String::from))
                .collect()
        }
    }
    impl ExecutionEventEmitter for CapturingEmitter {
        fn emit_json(&self, event: &str, payload: serde_json::Value) {
            self.events.lock().unwrap().push((event.to_string(), payload));
        }
    }

    /// Live Phase-3b bridge: the model calls the in-process MCP tool
    /// `personas_health`; the desktop executes it against the local DB.
    #[tokio::test]
    #[ignore = "hits live Qwen + calls an in-process MCP tool against the local DB; run with --ignored"]
    async fn live_qwen_mcp_tool() {
        let cap = CapturingEmitter::new();
        let cancelled = Arc::new(AtomicBool::new(false));
        let result = run_http_execution(
            &cap,
            "live-mcp-exec",
            "MCP Test",
            &qwen_profile(),
            "Call the personas_health tool and report how many personas exist. You MUST use the tool.",
            true,
            &cancelled,
            Instant::now(),
        )
        .await;
        let lines = cap.output_lines();
        eprintln!("[live_qwen_mcp_tool] success={} output:\n{}", result.success, lines.join("\n"));
        assert!(result.success, "expected success, got error: {:?}", result.error);
        assert!(
            lines.iter().any(|l| l.contains("personas_health")),
            "expected a personas_health tool call to fire; got lines: {lines:?}"
        );
    }
}
