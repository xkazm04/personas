//! Execution event emission abstraction.
//!
//! `ExecutionEventEmitter` decouples the engine's execution pipeline from the
//! Tauri event system so that headless runtimes (the `personas-daemon` binary)
//! can reuse the same code paths without pulling in a windowed `AppHandle`.
//!
//! Two impls ship with the crate:
//! - [`TauriEmitter`] forwards events to `app.emit(...)` in the windowed app.
//! - [`NoOpEmitter`] silently drops events — used by the daemon, tests, or any
//!   context where no UI is listening.
//!
//! The trait is dyn-compatible via [`ExecutionEventEmitter::emit_json`], which
//! takes a pre-serialized `serde_json::Value`. A convenience generic
//! [`ExecutionEventEmitter::emit`] method is provided for concrete-type callers
//! (it has a `Self: Sized` bound and is not callable through
//! `&dyn ExecutionEventEmitter`).
//!
//! ## Threading status (2026-04-13, /research run on A2A-Kit video)
//!
//! As of 2026-04-13 the trait is wired into `runner.rs` for the four
//! `EXECUTION_STATUS` transition sites: early credential failure, post-spawn
//! failure, stream loop failure, and the final-status emission at the end of
//! `run_execution`. Other emit sites in `runner.rs` (circuit breaker, trace
//! spans, raw output lines) still call `app.emit(...)` directly because they
//! emit non-state-transition payloads and have no consumers in the daemon
//! path yet. Migrating those is a follow-up when daemon mode or test-time
//! event capture grows a real consumer.
//!
//! The first scaffolding pass landed 2026-04-08 (run 1, A2A gateway). The
//! "follow-up pass" referenced in that run's comment is this module's
//! current state — additive but no longer dead code.

use serde::Serialize;
use tauri::{AppHandle, Emitter};

/// Abstraction over persona-execution event emission.
///
/// Implementations forward each event to wherever the runtime wants to
/// deliver it: a Tauri webview (windowed app), stdout/logs (daemon),
/// a captured in-memory buffer (tests), or nowhere at all.
pub trait ExecutionEventEmitter: Send + Sync {
    /// Emit a pre-serialized JSON payload under the given event name.
    ///
    /// This is the dyn-compatible method that every impl must provide.
    /// Call sites with a typed payload can use [`Self::emit`] instead
    /// when they hold a concrete type.
    fn emit_json(&self, event: &str, payload: serde_json::Value);

    /// Emit a typed payload by serializing it and forwarding to `emit_json`.
    ///
    /// Has a `Self: Sized` bound, so it is only callable on concrete types
    /// — not through `&dyn ExecutionEventEmitter`. Use `emit_json` when you
    /// hold a trait object.
    fn emit<P: Serialize>(&self, event: &str, payload: &P)
    where
        Self: Sized,
    {
        let value = serde_json::to_value(payload).unwrap_or(serde_json::Value::Null);
        self.emit_json(event, value);
    }
}

/// Emitter that forwards events to a Tauri `AppHandle`.
///
/// Used by the windowed app. Construct one at the command-layer boundary
/// and pass `&TauriEmitter` (or `&dyn ExecutionEventEmitter`) down into
/// the engine.
pub struct TauriEmitter {
    app: AppHandle,
}

impl TauriEmitter {
    /// Wrap an `AppHandle` in an `ExecutionEventEmitter`.
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }
}

impl ExecutionEventEmitter for TauriEmitter {
    fn emit_json(&self, event: &str, payload: serde_json::Value) {
        // Tauri's emit() returns Result but historically all engine call sites
        // ignore the result with `let _ =`. Preserve that behavior — a failed
        // emit is not an error the engine can recover from.
        let _ = self.app.emit(event, payload);
    }
}

/// Emitter that drops every event on the floor.
///
/// Used by:
/// - The `personas-daemon` binary, which has no UI listening.
/// - Unit tests that want to exercise the execution pipeline without
///   caring about event output.
pub struct NoOpEmitter;

impl NoOpEmitter {
    pub fn new() -> Self {
        Self
    }
}

impl Default for NoOpEmitter {
    fn default() -> Self {
        Self::new()
    }
}

impl ExecutionEventEmitter for NoOpEmitter {
    fn emit_json(&self, _event: &str, _payload: serde_json::Value) {
        // intentional no-op
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn noop_emitter_accepts_any_payload() {
        let emitter = NoOpEmitter::new();
        emitter.emit_json("test-event", serde_json::json!({ "foo": 1 }));
        emitter.emit("typed-event", &serde_json::json!({ "bar": "baz" }));
    }

    #[test]
    fn noop_emitter_usable_through_trait_object() {
        let emitter: Box<dyn ExecutionEventEmitter> = Box::new(NoOpEmitter::new());
        emitter.emit_json("via-dyn", serde_json::Value::Null);
    }

    /// Capture-mode emitter used by tests that need to assert which events
    /// the engine emitted. Mirrors the tracing patterns used by other
    /// engine tests but stays event-shaped instead of log-shaped.
    struct CapturingEmitter {
        events: std::sync::Mutex<Vec<(String, serde_json::Value)>>,
    }

    impl CapturingEmitter {
        fn new() -> Self {
            Self {
                events: std::sync::Mutex::new(Vec::new()),
            }
        }

        fn snapshot(&self) -> Vec<(String, serde_json::Value)> {
            self.events.lock().unwrap().clone()
        }
    }

    impl ExecutionEventEmitter for CapturingEmitter {
        fn emit_json(&self, event: &str, payload: serde_json::Value) {
            self.events.lock().unwrap().push((event.to_string(), payload));
        }
    }

    #[test]
    fn capturing_emitter_records_typed_emit_calls() {
        let cap = CapturingEmitter::new();
        cap.emit("execution-status", &serde_json::json!({
            "execution_id": "exec-1",
            "status": "completed",
        }));
        cap.emit("execution-status", &serde_json::json!({
            "execution_id": "exec-1",
            "status": "failed",
            "error": "boom",
        }));
        let snap = cap.snapshot();
        assert_eq!(snap.len(), 2);
        assert_eq!(snap[0].0, "execution-status");
        assert_eq!(snap[0].1["status"], "completed");
        assert_eq!(snap[1].1["status"], "failed");
        assert_eq!(snap[1].1["error"], "boom");
    }

    #[test]
    fn engine_can_swap_emitters_at_runtime_via_trait_object() {
        // Proves the substitution contract that justifies the trait:
        // a single function can be parameterized over &dyn ExecutionEventEmitter
        // and called with either a real backing or a no-op without code change.
        fn emit_one(emitter: &dyn ExecutionEventEmitter) {
            emitter.emit_json("test", serde_json::json!({ "ok": true }));
        }

        let cap = CapturingEmitter::new();
        emit_one(&cap);
        emit_one(&NoOpEmitter::new());
        assert_eq!(cap.snapshot().len(), 1);
    }
}
