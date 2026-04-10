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
//! Phase 0 scaffolding (2026-04-08): this module is additive — no existing
//! engine code calls it yet. The emitter is threaded through `runner.rs` and
//! related files in a follow-up pass. `#[allow(dead_code)]` is temporary
//! and should come off once the threading is complete.

#![allow(dead_code)]

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

/// Serialize a typed payload and emit through a trait object.
///
/// This is the workhorse helper for call sites that hold
/// `Arc<dyn ExecutionEventEmitter>` or `&dyn ExecutionEventEmitter`
/// (where the generic `emit()` method is not callable due to the
/// `Self: Sized` bound).
///
/// ```ignore
/// emit_to(&*emitter, event_name::EXECUTION_STATUS, &status_event);
/// ```
pub fn emit_to<P: Serialize>(emitter: &dyn ExecutionEventEmitter, event: &str, payload: &P) {
    emitter.emit_json(event, serde_json::to_value(payload).unwrap_or(serde_json::Value::Null));
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
}
