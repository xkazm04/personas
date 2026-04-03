use serde::Serialize;
use tauri::{AppHandle, Emitter};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessActivityEvent {
    pub domain: String,
    pub action: String,
    pub run_id: Option<String>,
    pub label: Option<String>,
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
            timestamp_ms,
        }
    }
}

pub fn emit_process_activity(app: &AppHandle, domain: &str, action: &str, run_id: Option<&str>, label: Option<&str>) {
    let event = ProcessActivityEvent::new(domain, action, run_id, label);
    let _ = app.emit(super::event_registry::event_name::PROCESS_ACTIVITY, event);
}
