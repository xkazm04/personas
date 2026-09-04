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
use personas_core::types::ExecutionConfig;

/// Execute a persona via the remote HTTP provider. Resolves the key + endpoint,
/// then dispatches to the tool-calling loop (tool-enabled) or the streaming text
/// path. Emits live events + a terminal status and returns the `ExecutionResult`
/// for the caller to persist. Never writes terminal DB status itself.
///
/// `declared_roster` is the persona's positively-declared tool allowlist, or
/// `None` when it has not declared one. It narrows the assembled tool array; it
/// can never widen it past `config::tool_allowed`, whose exclusions are a
/// security boundary rather than a latency lever.
///
/// `execution_config` is the run's frozen config snapshot. It is returned on
/// the `ExecutionResult` with the roster measurement stamped into it, so a
/// remote run's roster size lands on the same DB row as its duration and cost.
/// Before this parameter existed the HTTP branch returned above the only site
/// that persisted a snapshot, so every remote run stored `execution_config`
/// NULL.
#[allow(clippy::too_many_arguments)]
pub async fn run_http_execution(
    emitter: &dyn ExecutionEventEmitter,
    execution_id: &str,
    persona_name: &str,
    model_profile: &ModelProfile,
    prompt_text: &str,
    tools_enabled: bool,
    declared_roster: Option<Vec<String>>,
    execution_config: ExecutionConfig,
    cancelled: &Arc<AtomicBool>,
    start_time: Instant,
) -> ExecutionResult {
    let provider = model_profile.provider.as_deref().unwrap_or("qwen");
    let model = model_profile
        .model
        .as_deref()
        .unwrap_or(DEFAULT_MODEL)
        .to_string();

    let base_url = model_profile
        .base_url
        .as_deref()
        .filter(|s| !s.is_empty())
        .unwrap_or(DEFAULT_BASE_URL)
        .trim_end_matches('/')
        .to_string();

    // Key resolution is endpoint-scoped: `base_url` owns the scheme and the
    // authority of every request below, and it is not always the user's (it is
    // copied verbatim out of imported bundles and adopted templates). See
    // `secrets::stored_key_allowed_for`.
    let api_key = match secrets::resolve_api_key(model_profile, &base_url) {
        Ok(k) => k,
        Err(reason) => {
            return events::fail(
                emitter,
                execution_id,
                &format!("Remote provider '{provider}': {reason}"),
                start_time,
            );
        }
    };

    tracing::info!(execution_id, provider, model, persona = persona_name, %base_url, tools_enabled, "[http_engine] starting remote inference");

    if tools_enabled {
        tools::run_tool_loop(
            emitter,
            execution_id,
            provider,
            &model,
            &base_url,
            &api_key,
            prompt_text,
            declared_roster,
            execution_config,
            cancelled,
            start_time,
        )
        .await
    } else {
        let mut result = openai::run_streaming(
            emitter,
            execution_id,
            provider,
            &model,
            &base_url,
            &api_key,
            prompt_text,
            cancelled,
            start_time,
        )
        .await;
        // The streaming path posts no `tools` key at all. That is a roster of
        // zero, which is a measurement and not an absence — it is the floor the
        // tool-loop runs are compared against.
        result.execution_config =
            config::stamp_roster(execution_config, Some(0), Some(0), "http_engine_no_tools");
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A frozen config snapshot for the tests, matching what `runner` hands in.
    /// The roster fields start unset — the engine is what fills them.
    fn test_config() -> ExecutionConfig {
        ExecutionConfig {
            model_profile: None,
            engine: "qwen".into(),
            max_budget_usd: None,
            max_turns: None,
            timeout_ms: 60_000,
            has_workspace_instructions: false,
            workspace_id: None,
            tool_names: vec![],
            tool_roster_size: None,
            tool_roster_bytes: None,
            tool_roster_source: String::new(),
            credential_connectors: vec![],
            routing_rule: None,
            compliance_rule: None,
            continuation_mode: "none".into(),
            assembled_at: "2026-09-04T00:00:00Z".into(),
        }
    }
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

    /// **The regression test for the Vuln-3 fix.**
    ///
    /// A local inference server (Ollama / LM Studio / vLLM) at a loopback
    /// `base_url` the user configured, with the API key coming from the keyring
    /// or the environment rather than the profile, must still execute
    /// end-to-end. This is the case an SSRF-safe resolver or a
    /// `validate_url_safety` pre-flight would have broken — which is why the
    /// Vuln-3 fix is credential-scoping, not URL-blocking.
    #[tokio::test]
    async fn loopback_byom_endpoint_still_executes() {
        // A stored (non-profile) key, so this exercises the keyring/env branch.
        std::env::set_var("QWEN_API_KEY", "sk-local-dev");

        let (addr, _srv) = fake_openai_server().await;
        let profile = ModelProfile {
            model: Some("local-model".to_string()),
            provider: Some("qwen".to_string()),
            base_url: Some(format!("http://127.0.0.1:{}/v1", addr.port())),
            auth_token: None,
            prompt_cache_policy: None,
            effort: None,
        };

        let emitter = NoOpEmitter::new();
        let cancelled = Arc::new(AtomicBool::new(false));
        let result = run_http_execution(
            &emitter,
            "local-byom-exec",
            "Local BYOM",
            &profile,
            "ping",
            false,
            None,
            test_config(),
            &cancelled,
            Instant::now(),
        )
        .await;

        assert!(
            result.success,
            "a user-configured loopback BYOM endpoint must still work; got: {:?}",
            result.error
        );
        assert_eq!(result.output.as_deref(), Some("PONG"));
    }

    /// The mirror: the SAME profile pointed at a host the user never configured
    /// must NOT get the stored key, and must fail before any request is made.
    #[tokio::test]
    async fn imported_foreign_endpoint_never_receives_the_stored_key() {
        std::env::set_var("QWEN_API_KEY", "sk-local-dev");

        let profile = ModelProfile {
            model: Some("qwen3-max".to_string()),
            provider: Some("qwen".to_string()),
            // What an imported bundle / adopted template can set today.
            base_url: Some("https://attacker.tld/v1".to_string()),
            auth_token: None,
            prompt_cache_policy: None,
            effort: None,
        };

        let emitter = NoOpEmitter::new();
        let cancelled = Arc::new(AtomicBool::new(false));
        let result = run_http_execution(
            &emitter,
            "foreign-endpoint-exec",
            "Imported",
            &profile,
            "the entire assembled prompt, team memory and goals",
            false,
            None,
            test_config(),
            &cancelled,
            Instant::now(),
        )
        .await;

        assert!(!result.success, "must refuse, not execute");
        let err = result.error.unwrap_or_default();
        // The specific phrase matters: PRE-FIX this call also failed, but with
        // "Cannot reach qwen at https://attacker.tld/... : dns error" — i.e. it
        // failed only because the attacker's host happened not to resolve on
        // this box, AFTER building a request carrying the user's real key. An
        // assertion on the hostname alone would have passed against the bug.
        assert!(
            err.contains("Refusing to send the stored provider API key"),
            "must refuse before building the request; got: {err}"
        );
        assert!(err.contains("attacker.tld"), "{err}");
        assert!(
            !err.contains("sk-local-dev"),
            "must not echo the key: {err}"
        );
    }

    /// Minimal OpenAI-compatible SSE endpoint on loopback: one content delta
    /// ("PONG") then `[DONE]`. One task, connections served sequentially, and
    /// the handle is bound rather than detached.
    async fn fake_openai_server() -> (std::net::SocketAddr, tokio::task::JoinHandle<()>) {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind");
        let addr = listener.local_addr().expect("addr");
        let handle = tokio::spawn(async move {
            loop {
                let Ok((mut sock, _)) = listener.accept().await else {
                    return;
                };
                let mut buf = [0u8; 4096];
                let _ = sock.read(&mut buf).await;
                let body =
                    "data: {\"choices\":[{\"delta\":{\"content\":\"PONG\"}}]}\n\ndata: [DONE]\n\n";
                let resp = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = sock.write_all(resp.as_bytes()).await;
                let _ = sock.flush().await;
            }
        });
        (addr, handle)
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
            None,
            test_config(),
            &cancelled,
            Instant::now(),
        )
        .await;
        assert!(
            result.success,
            "expected success, got error: {:?}",
            result.error
        );
        assert!(
            !result.output.unwrap_or_default().trim().is_empty(),
            "expected non-empty output"
        );
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
            None,
            test_config(),
            &cancelled,
            Instant::now(),
        )
        .await;
        assert!(
            result.success,
            "expected success, got error: {:?}",
            result.error
        );
        assert!(
            !result.output.unwrap_or_default().trim().is_empty(),
            "expected non-empty output"
        );
    }

    /// Capturing emitter so the MCP test can assert which tool actually fired.
    struct CapturingEmitter {
        events: std::sync::Mutex<Vec<(String, serde_json::Value)>>,
    }
    impl CapturingEmitter {
        fn new() -> Self {
            Self {
                events: std::sync::Mutex::new(Vec::new()),
            }
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
            self.events
                .lock()
                .unwrap()
                .push((event.to_string(), payload));
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
            None,
            test_config(),
            &cancelled,
            Instant::now(),
        )
        .await;
        let lines = cap.output_lines();
        eprintln!(
            "[live_qwen_mcp_tool] success={} output:\n{}",
            result.success,
            lines.join("\n")
        );
        assert!(
            result.success,
            "expected success, got error: {:?}",
            result.error
        );
        assert!(
            lines.iter().any(|l| l.contains("personas_health")),
            "expected a personas_health tool call to fire; got lines: {lines:?}"
        );
    }
}
