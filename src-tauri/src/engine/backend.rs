//! Pluggable persona execution backend.
//!
//! Today the engine spawns the `claude` CLI as a subprocess for every
//! persona execution. The `ExecutionBackend` trait is the seam between
//! "trigger fires / user clicks run" and "model produces output," so that
//! future execution strategies (a local Anthropic daemon with a documented
//! integration surface, a direct Messages API client, a remote worker) can
//! be plugged in without touching the trigger scheduler, persona schema,
//! or credential layer.
//!
//! Phase 0 scaffolding (2026-04-08): only the trait shape and a stub
//! [`LocalSubprocessBackend`] exist. The stub is not wired into
//! `runner::run_execution` yet — that happens in a follow-up pass once the
//! `ExecutionEventEmitter` refactor has threaded through the engine.
//!
//! When Anthropic ships a local daemon with a documented public surface
//! (CLI flags, MCP server, or plugin API), we add a second impl here —
//! never by mining proprietary source.
//!
//! `#[allow(dead_code)]` is temporary and should come off once the
//! dispatch layer starts constructing `LocalSubprocessBackend`.

#![allow(dead_code)]

use async_trait::async_trait;
use serde::{Deserialize, Serialize};

use crate::error::AppError;

/// Input to a backend invocation.
///
/// All state the backend needs to run a single persona execution, already
/// resolved by the dispatch layer (prompt rendered, credentials injected
/// into env, timeouts computed).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackendExecutionRequest {
    /// Fully-rendered prompt ready for the model.
    pub prompt: String,
    /// Persona id — used for billing, logging, and tracing correlation.
    pub persona_id: String,
    /// Execution id minted by the dispatch layer. Backends MUST NOT mint
    /// their own.
    pub execution_id: String,
    /// Upper bound on wall-clock time for the run, in milliseconds.
    pub timeout_ms: u64,
}

/// Minimal result every backend must produce.
///
/// Backends that collect richer telemetry (trace spans, per-turn costs,
/// tool usage) should emit that through the `ExecutionEventEmitter`
/// passed separately, not stuff it into this struct. Keep the return
/// value small.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackendExecutionResult {
    pub success: bool,
    pub output: String,
    pub error: Option<String>,
    pub cost_usd: Option<f64>,
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
}

/// Pluggable persona execution backend.
///
/// Impls that exist today:
/// - [`LocalSubprocessBackend`] — spawns the `claude` CLI. The default
///   and only backend for Phase 0.
///
/// Impls that may exist later (placeholders, not committed):
/// - A daemon-delegating backend (when Anthropic ships a local daemon
///   with a documented integration surface).
/// - A direct Messages API backend that skips the CLI entirely.
///
/// Adding a new impl must NOT require touching the trigger scheduler or
/// persona schema — that's the whole point of the seam.
#[async_trait]
pub trait ExecutionBackend: Send + Sync {
    /// Execute the request and return a result when complete.
    ///
    /// Implementations are responsible for their own event emission (via
    /// an `ExecutionEventEmitter` supplied out-of-band) and trace span
    /// creation. The return value is the post-run summary only.
    async fn execute(
        &self,
        request: BackendExecutionRequest,
    ) -> Result<BackendExecutionResult, AppError>;

    /// Human-readable backend name, for logging and diagnostics.
    fn name(&self) -> &'static str;
}

/// Default backend — spawns the `claude` CLI as a subprocess.
///
/// Phase 0: stub. The real implementation will delegate to
/// `engine::runner::run_execution` once that function no longer requires
/// a `tauri::AppHandle` (pending the emitter refactor). The stub `execute`
/// method returns an `Internal` error so that accidentally wiring it up
/// early fails loudly instead of silently dropping executions.
pub struct LocalSubprocessBackend;

impl LocalSubprocessBackend {
    pub fn new() -> Self {
        Self
    }
}

impl Default for LocalSubprocessBackend {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl ExecutionBackend for LocalSubprocessBackend {
    async fn execute(
        &self,
        _request: BackendExecutionRequest,
    ) -> Result<BackendExecutionResult, AppError> {
        Err(AppError::Internal(
            "LocalSubprocessBackend::execute not yet wired to runner::run_execution \
             (awaiting ExecutionEventEmitter refactor — see .planning/research/2026-04-08-cloud-headless-personas.md)"
                .into(),
        ))
    }

    fn name(&self) -> &'static str {
        "local-subprocess"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn local_backend_stub_errors_loudly() {
        let backend = LocalSubprocessBackend::new();
        let req = BackendExecutionRequest {
            prompt: "hello".into(),
            persona_id: "p1".into(),
            execution_id: "e1".into(),
            timeout_ms: 1000,
        };
        let result = backend.execute(req).await;
        assert!(result.is_err(), "stub must error, not silently succeed");
        assert_eq!(backend.name(), "local-subprocess");
    }
}
