//! Typed Tauri event registry.
//!
//! Single source of truth for every event name emitted between Rust and React.
//! Each variant carries its event name as a `&'static str` via [`TauriEvent::NAME`],
//! and the payload type is enforced by the generic on [`emit_event`].
//!
//! ## Adding a new event
//! 1. Add a variant to [`TauriEventName`].
//! 2. Add a corresponding entry in the [`event_name!`] block.
//! 3. Define (or reuse) a payload struct that derives `Serialize`.
//! 4. Register the (name, payload) pair via [`impl TauriEvent for YourPayload`].
//! 5. The TypeScript side picks up the new name from `src/lib/eventRegistry.ts`.

use serde::Serialize;
use tauri::{AppHandle, Emitter};

// ---------------------------------------------------------------------------
// Event name constants
// Event-name constants live in `personas_core::events` — `db::cdc` and
// `db::repos` name events too, and they sit below this module. Only the typed
// `emit_event` helper stays here, because it is the part that needs tauri.
pub use personas_core::events::event_name;


// ---------------------------------------------------------------------------
// Typed emit helper
// ---------------------------------------------------------------------------

/// Emit a typed event to the frontend. The event name is derived from the
/// constant, ensuring compile-time correctness.
///
/// ```rust,ignore
/// use crate::event_registry::{emit_event, event_name};
/// emit_event(&app, event_name::EXECUTION_OUTPUT, &my_payload);
/// ```
pub fn emit_event<P: Serialize + Clone>(app: &AppHandle, event: &str, payload: &P) {
    let _ = app.emit(event, payload.clone());
}

/// Emit a [`PersonaEvent`] to the frontend event bus (`event-bus` channel).
///
/// Logs a warning if the emit fails. This is the canonical way to push events
/// to the React event-bus listener — prefer this over raw `app.emit()` calls.
pub fn emit_event_bus(app: &AppHandle, event: &personas_db::models::PersonaEvent) {
    if let Err(e) = app.emit(event_name::EVENT_BUS, event.clone()) {
        tracing::warn!(event_id = %event.id, error = %e, "Failed to emit event-bus event");
    }
}

/// Like [`emit_event`] but propagates the emit error instead of swallowing it.
#[allow(dead_code)]
pub fn try_emit_event<P: Serialize + Clone>(
    app: &AppHandle,
    event: &str,
    payload: &P,
) -> Result<(), tauri::Error> {
    app.emit(event, payload.clone())
}

// NOTE: this module used to re-export the event payload types for
// "convenient single-import". Every one of those re-exports was unused (they
// all carried `#[allow(unused_imports)]`), and they made the registry depend on
// `background`, `auto_rollback` and `failover` — 4k LOC of AppState/cloud/daemon
// wiring — which in turn contaminated 14 other engine modules for the crate
// split. Import payload types from the module that defines them.
