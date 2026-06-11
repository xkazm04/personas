//! Browser-test surface (Athena × browser tester arc, Phase 3):
//! bridge pairing status/rotation for the Companion Setup panel, and the
//! "File as ideas" affordance on the `browser_test_report` chat-card.

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::State;
use ts_rs::TS;

use crate::db::repos::core::settings as settings_repo;
use crate::db::settings_keys;
use crate::error::AppError;
use crate::ipc_auth;
use crate::AppState;

/// Pairing/connection status for the Companion Setup → Browser panel.
#[derive(Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct BrowserBridgeStatus {
    /// local_http port the bridge is mounted on (None before server start).
    pub port: Option<u16>,
    /// The pairing token the extension must present. Vault-grade: only
    /// surfaced behind the privileged IPC gate.
    pub pairing_token: String,
    /// True while an extension holds the relay's WS connection.
    pub extension_connected: bool,
    /// True when the runtime token came from the env override (QA) — the
    /// panel shows a hint instead of the rotate button in that case.
    pub env_override: bool,
}

#[tauri::command]
pub fn browser_bridge_status(
    state: State<'_, Arc<AppState>>,
) -> Result<BrowserBridgeStatus, AppError> {
    ipc_auth::require_auth_sync(&state)?;
    Ok(BrowserBridgeStatus {
        port: crate::local_http::port(),
        pairing_token: crate::browser_bridge::pairing_token(),
        extension_connected: crate::browser_bridge::extension_connected(),
        env_override: std::env::var("PERSONAS_BROWSER_BRIDGE_TOKEN")
            .map(|t| !t.trim().is_empty())
            .unwrap_or(false),
    })
}

/// Rotate the pairing token: persist a fresh UUID and swap it live. The
/// currently-connected extension keeps its socket (token is handshake-only);
/// its next reconnect needs the new value from the panel.
#[tauri::command]
pub fn browser_bridge_regenerate_token(
    state: State<'_, Arc<AppState>>,
) -> Result<String, AppError> {
    ipc_auth::require_auth_sync(&state)?;
    let token = uuid::Uuid::new_v4().simple().to_string();
    settings_repo::set(
        &state.db,
        settings_keys::BROWSER_BRIDGE_PAIRING_TOKEN,
        &token,
    )?;
    crate::browser_bridge::set_pairing_token(&token);
    Ok(token)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserDefect {
    pub title: String,
    #[serde(default)]
    pub severity: Option<String>,
    #[serde(default)]
    pub detail: Option<String>,
    #[serde(default)]
    pub fix: Option<String>,
}

/// File browser-test defects into the Dev Tools idea inbox (status
/// `pending` → the normal Idea Triage flow takes over: accept → Build now →
/// task → agent fix). Project resolution: explicit name → test-env-URL
/// origin match against `url` → most recent project. One row per defect,
/// `scan_type = "browser_test"`.
#[tauri::command]
pub fn companion_file_browser_defects(
    state: State<'_, Arc<AppState>>,
    url: String,
    project_name: Option<String>,
    defects: Vec<BrowserDefect>,
) -> Result<usize, AppError> {
    ipc_auth::require_auth_sync(&state)?;
    if defects.is_empty() {
        return Ok(0);
    }
    if defects.len() > 8 {
        return Err(AppError::Validation(
            "cap defects at 8 per report".to_string(),
        ));
    }
    let conn = state.db.get()?;

    let origin = crate::browser_bridge::origin_of(&url).unwrap_or_default();
    let project_id: Option<String> = project_name
        .as_deref()
        .map(str::trim)
        .filter(|n| !n.is_empty())
        .and_then(|n| {
            conn.query_row(
                "SELECT id FROM dev_projects WHERE id = ?1 OR name = ?1 LIMIT 1",
                rusqlite::params![n],
                |r| r.get::<_, String>(0),
            )
            .ok()
        })
        .or_else(|| {
            // Match the tested origin against each project's test_env_url.
            let mut stmt = conn
                .prepare("SELECT id, test_env_url FROM dev_projects WHERE test_env_url IS NOT NULL")
                .ok()?;
            let rows: Vec<(String, String)> = stmt
                .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
                .ok()?
                .filter_map(Result::ok)
                .collect();
            rows.into_iter()
                .find(|(_, env_url)| {
                    crate::browser_bridge::origin_of(env_url)
                        .map(|o| !origin.is_empty() && o == origin)
                        .unwrap_or(false)
                })
                .map(|(id, _)| id)
        })
        .or_else(|| {
            conn.query_row(
                "SELECT id FROM dev_projects ORDER BY created_at DESC LIMIT 1",
                [],
                |r| r.get::<_, String>(0),
            )
            .ok()
        });
    let Some(project_id) = project_id else {
        return Err(AppError::Validation(
            "No Dev Tools project to file the defects against — register one first.".to_string(),
        ));
    };

    let mut filed = 0usize;
    for d in &defects {
        let title = d.title.trim();
        if title.is_empty() {
            continue;
        }
        let impact = match d.severity.as_deref() {
            Some("high") => 5,
            Some("medium") => 3,
            _ => 1,
        };
        let mut description = d.detail.clone().unwrap_or_default();
        if let Some(fix) = d.fix.as_deref().filter(|f| !f.trim().is_empty()) {
            description = format!("{description}\n\nSuggested fix: {fix}");
        }
        description = format!("{}\n\n(Found by Athena's live browser test of {url})", description.trim());
        conn.execute(
            "INSERT INTO dev_ideas (id, project_id, scan_type, category, title, description, status, impact, created_at, updated_at)
             VALUES (?1, ?2, 'browser_test', 'technical', ?3, ?4, 'pending', ?5, datetime('now'), datetime('now'))",
            rusqlite::params![
                uuid::Uuid::new_v4().to_string(),
                project_id,
                title,
                description,
                impact
            ],
        )?;
        filed += 1;
    }
    Ok(filed)
}
