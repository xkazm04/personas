use serde::Serialize;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Serialize)]
// Fields serialize as snake_case ON THE WIRE — deliberately NO `rename_all`.
// The frontend payload type and the eventBridge handler both read `run_id`
// (src/lib/eventRegistry.ts `PROCESS_ACTIVITY`, src/lib/eventBridge.ts), and
// this matches the sibling `QueueStatusEvent`. Re-adding
// `#[serde(rename_all = "camelCase")]` would emit `runId`, so the bridge would
// read `payload.run_id === undefined` and store every run under the bare
// "execution" key — collapsing concurrent/team runs into one and clearing the
// shared key on the first completion. That breaks FleetActivityStrip + the
// Monitor's `activeProcesses['execution:'+id]` lookup. Keep snake_case.
pub struct ProcessActivityEvent {
    pub domain: String,
    pub action: String,
    pub run_id: Option<String>,
    pub label: Option<String>,
    /// The persona that owns this run, when there is one. The Monitor used to
    /// tie a run to its persona through `label == persona.name`, which put two
    /// same-named personas' runs in the System band. Set it with
    /// [`ProcessActivityEvent::with_persona`]; persona-less work leaves it None.
    pub persona_id: Option<String>,
    pub timestamp_ms: u64,
}

impl ProcessActivityEvent {
    pub fn new(domain: &str, action: &str, run_id: Option<&str>, label: Option<&str>) -> Self {
        let timestamp_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;
        Self {
            domain: domain.to_string(),
            action: action.to_string(),
            run_id: run_id.map(|s| s.to_string()),
            label: label.map(|s| s.to_string()),
            persona_id: None,
            timestamp_ms,
        }
    }

    /// Attach the owning persona's id (see `persona_id`).
    pub fn with_persona(mut self, persona_id: &str) -> Self {
        self.persona_id = Some(persona_id.to_string());
        self
    }
}

pub fn emit_process_activity(
    app: &AppHandle,
    domain: &str,
    action: &str,
    run_id: Option<&str>,
    label: Option<&str>,
) {
    emit_event(
        app,
        ProcessActivityEvent::new(domain, action, run_id, label),
    );
}

/// [`emit_process_activity`] for a persona's run: the label is the persona's
/// name and the event carries its id, so the Monitor ties the run to the right
/// persona even when two share a name.
pub fn emit_persona_process_activity(
    app: &AppHandle,
    domain: &str,
    action: &str,
    run_id: Option<&str>,
    persona_name: &str,
    persona_id: &str,
) {
    emit_event(
        app,
        ProcessActivityEvent::new(domain, action, run_id, Some(persona_name))
            .with_persona(persona_id),
    );
}

fn emit_event(app: &AppHandle, event: ProcessActivityEvent) {
    if let Err(e) = app.emit(super::event_registry::event_name::PROCESS_ACTIVITY, &event) {
        tracing::warn!(
            domain = %event.domain,
            action = %event.action,
            run_id = ?event.run_id,
            "Failed to emit process activity event: {e}"
        );
    }
}

/// Like [`emit_process_activity`] but accepts an [`ExecutionEventEmitter`] trait
/// object instead of an `AppHandle`. Used by `runner.rs` after the emitter
/// refactor so the runner no longer needs a concrete `AppHandle`.
#[allow(dead_code)] // pending: runner currently calls emit_process_activity directly with an AppHandle
pub fn emit_process_activity_via(
    emitter: &dyn super::events::ExecutionEventEmitter,
    domain: &str,
    action: &str,
    run_id: Option<&str>,
    label: Option<&str>,
) {
    let event = ProcessActivityEvent::new(domain, action, run_id, label);
    super::events::emit_to(
        emitter,
        super::event_registry::event_name::PROCESS_ACTIVITY,
        &event,
    );
}
