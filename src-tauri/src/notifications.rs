use serde::Deserialize;
use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;

/// Per-persona notification preferences parsed from `notification_channels` JSON.
#[derive(Debug, Deserialize)]
struct NotificationPrefs {
    #[serde(default = "default_true")]
    execution_completed: bool,
    #[serde(default = "default_true")]
    manual_review: bool,
    #[serde(default = "default_true")]
    new_message: bool,
    #[serde(default = "default_true")]
    healing_issue: bool,
}

impl Default for NotificationPrefs {
    fn default() -> Self {
        Self {
            execution_completed: true,
            manual_review: true,
            new_message: true,
            healing_issue: true,
        }
    }
}

fn default_true() -> bool {
    true
}

fn parse_prefs(json: Option<&str>) -> NotificationPrefs {
    match json {
        Some(json_str) => {
            // If the JSON starts with '[', it's the new array format — return defaults
            if json_str.trim_start().starts_with('[') {
                return NotificationPrefs::default();
            }
            serde_json::from_str(json_str).unwrap_or_default()
        }
        None => NotificationPrefs::default(),
    }
}

// ---------------------------------------------------------------------------
// Public notification helpers
// ---------------------------------------------------------------------------

pub fn notify_execution_completed(
    app: &AppHandle,
    persona_name: &str,
    status: &str,
    duration_ms: u64,
    channels: Option<&str>,
) {
    if !parse_prefs(channels).execution_completed {
        return;
    }
    let duration_str = format!("{:.1}s", duration_ms as f64 / 1000.0);
    send(
        app,
        &format!("Execution {}", status),
        &format!("{} finished in {}", persona_name, duration_str),
    );
}

pub fn notify_manual_review(
    app: &AppHandle,
    persona_name: &str,
    title: &str,
    channels: Option<&str>,
) {
    if !parse_prefs(channels).manual_review {
        return;
    }
    send(
        app,
        "Manual Review Needed",
        &format!("{}: {}", persona_name, title),
    );
}

pub fn notify_new_message(
    app: &AppHandle,
    persona_name: &str,
    title: &str,
    channels: Option<&str>,
) {
    if !parse_prefs(channels).new_message {
        return;
    }
    send(
        app,
        &format!("Message from {}", persona_name),
        title,
    );
}

pub fn notify_healing_issue(
    app: &AppHandle,
    persona_name: &str,
    title: &str,
    channels: Option<&str>,
) {
    if !parse_prefs(channels).healing_issue {
        return;
    }
    send(
        app,
        "Healing Issue Detected",
        &format!("{}: {}", persona_name, title),
    );
}

pub fn notify_n8n_transform_completed(
    app: &AppHandle,
    workflow_name: &str,
    success: bool,
) {
    if success {
        send(
            app,
            "n8n Transform Complete",
            &format!("{} draft is ready for review.", workflow_name),
        );
    } else {
        send(
            app,
            "n8n Transform Failed",
            &format!("{} transformation failed. Re-open importer for details.", workflow_name),
        );
    }
}

// ---------------------------------------------------------------------------
// Low-level send
// ---------------------------------------------------------------------------

fn send(app: &AppHandle, title: &str, body: &str) {
    if let Err(e) = app.notification().builder().title(title).body(body).show() {
        tracing::warn!("Failed to send OS notification: {}", e);
    }
}
