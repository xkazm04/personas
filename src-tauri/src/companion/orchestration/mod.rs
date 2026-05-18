//! Orchestration layer between Athena (conversational agent) and the
//! Fleet (parallel Claude Code workers).
//!
//! In-process "operative memory" — the working set Athena reasons over
//! during live orchestration. Distinct from `brain/` (episodic +
//! semantic memory, persisted, long-term) by design:
//!
//!   - `brain/` is a permanent record of what *happened* (and why).
//!   - `orchestration/` is a live record of what's *happening now* (and
//!     who's doing what for whom). It evaporates on app restart.
//!
//! Splitting these tiers keeps the long-term memory clean (we don't
//! pollute episodic with every tool-call) while giving Athena a
//! prompt-friendly digest of live work.

pub mod mcp;
pub mod operative_memory;

/// Tauri event fired when operative memory mutates. Frontend
/// subscribes to invalidate its cached digest and re-pull. Payload is
/// `{}` — recipients re-fetch the full digest via the existing
/// `companion_get_operative_memory_digest` command rather than
/// reconstruct from a delta, so the wire format stays stable as the
/// digest text evolves.
pub const DIGEST_CHANGED_EVENT: &str = "athena://orchestration/digest-changed";

/// Notify the frontend that operative memory just changed. Called from
/// every entry point that mutates: `companion_record_fleet_event`, MCP
/// tool handlers (`report_intent` / `checkpoint`), the dispatcher
/// (`execute_fleet_dispatch`), the PTY reaper's
/// `rust_reconcile_after_exit`, and `reconcile_if_dispatched`.
///
/// Cheap, no payload. The frontend debounces and re-fetches.
pub fn emit_digest_changed(app: &tauri::AppHandle) {
    use tauri::Emitter;
    if let Err(e) = app.emit(DIGEST_CHANGED_EVENT, ()) {
        tracing::debug!(error = %e, "emit_digest_changed: emit failed");
    }
}
