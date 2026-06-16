//! Phase 2: approval-gated remote run requests.
//!
//! The web dashboard inserts a `pending_commands` row (a *request* to run a
//! persona). This module polls those rows for THIS device and surfaces each to
//! the desktop user as an explicit approval prompt — it NEVER auto-executes.
//! On approval the persona runs **locally** via `execute_persona_inner` (the
//! same path as a normal run), and the result syncs back up through the Phase-1a
//! writer. Credentials and execution never leave the device; the web only ever
//! sent a `persona_id` + prompt.

use std::collections::HashSet;
use std::sync::{Arc, LazyLock};
use std::time::Duration;

use personas_macros::requires;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::Mutex;
use ts_rs::TS;

use crate::cloud::sync::client::SyncClient;
use crate::cloud::sync::cursor;
use crate::db::DbPool;
use crate::error::AppError;
use crate::AppState;

/// Commands already surfaced to the UI this session, so the 15s poll doesn't
/// re-emit the same prompt every tick.
static SURFACED: LazyLock<Mutex<HashSet<String>>> = LazyLock::new(|| Mutex::new(HashSet::new()));

/// Requests older than this (without resolution) are auto-expired so a stale
/// prompt can't pop days later.
fn expiry_window() -> chrono::Duration {
    chrono::Duration::hours(1)
}

/// Raw `pending_commands` row (subset we select).
#[derive(Debug, Clone, Deserialize)]
struct CommandRow {
    id: String,
    persona_id: Option<String>,
    command_type: String,
    prompt: Option<String>,
    status: String,
    requested_at: String,
}

/// Approval-prompt payload sent to the frontend.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct RemoteCommand {
    pub id: String,
    pub persona_id: String,
    pub persona_name: Option<String>,
    pub command_type: String,
    pub prompt: Option<String>,
    pub requested_at: String,
}

const SELECT: &str = "select=id,persona_id,command_type,prompt,status,requested_at";

fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn is_expired(requested_at: &str) -> bool {
    match chrono::DateTime::parse_from_rfc3339(requested_at) {
        Ok(t) => {
            chrono::Utc::now().signed_duration_since(t.with_timezone(&chrono::Utc))
                > expiry_window()
        }
        Err(_) => false,
    }
}

async fn read_token(state: &Arc<AppState>) -> Option<String> {
    let auth = state.auth.read().await;
    auth.access_token
        .as_ref()
        .map(|s| s.expose_secret().to_string())
}

fn persona_name(pool: &DbPool, id: &str) -> Option<String> {
    crate::db::repos::core::personas::get_by_id(pool, id)
        .ok()
        .map(|p| p.name)
}

/// PATCH a command row's status (+ optional extra fields), best-effort.
async fn set_command_status(
    client: &SyncClient,
    id: &str,
    status: &str,
    extra: serde_json::Value,
) {
    let mut body = json!({ "status": status, "updated_at": now() });
    if let (Some(obj), Some(extra_obj)) = (body.as_object_mut(), extra.as_object()) {
        for (k, v) in extra_obj {
            obj.insert(k.clone(), v.clone());
        }
    }
    let _ = client
        .patch(&format!("pending_commands?id=eq.{id}"), &body)
        .await;
}

fn to_remote(c: CommandRow, pool: &DbPool) -> RemoteCommand {
    let persona_id = c.persona_id.unwrap_or_default();
    let name = if persona_id.is_empty() {
        None
    } else {
        persona_name(pool, &persona_id)
    };
    RemoteCommand {
        id: c.id,
        persona_id,
        persona_name: name,
        command_type: c.command_type,
        prompt: c.prompt,
        requested_at: c.requested_at,
    }
}

/// One poll pass: surface new pending run-requests for this device, expire stale ones.
async fn poll_once(app: &AppHandle, state: &Arc<AppState>) -> Result<(), AppError> {
    let jwt = match read_token(state).await {
        Some(t) => t,
        None => return Ok(()),
    };
    let client = SyncClient::new(jwt)?;
    let pool = state.db.clone();
    let device = cursor::resolve_device_id(&pool);

    let path = format!(
        "pending_commands?status=eq.pending&target_device_id=eq.{device}&order=requested_at.asc&{SELECT}"
    );
    let cmds: Vec<CommandRow> = client.get(&path).await?;

    let mut surfaced = SURFACED.lock().await;
    for c in cmds {
        if is_expired(&c.requested_at) {
            let _ = client
                .patch(
                    &format!("pending_commands?id=eq.{}", c.id),
                    &json!({ "status": "expired", "resolved_at": now(), "updated_at": now() }),
                )
                .await;
            continue;
        }
        // v1 only surfaces run_persona; other types are ignored until supported.
        if c.command_type != "run_persona" {
            continue;
        }
        if surfaced.contains(&c.id) {
            continue;
        }
        surfaced.insert(c.id.clone());
        let _ = app.emit("remote-command-pending", to_remote(c, &pool));
    }
    Ok(())
}

/// Spawn the 15s poll loop. Leader-gated + sync-enabled-gated, so it only runs
/// on one instance and only when the user has opted into cloud sync.
pub fn spawn_poll_loop(app: AppHandle, state: Arc<AppState>) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(12)).await;
        let mut ticker = tokio::time::interval(Duration::from_secs(15));
        loop {
            ticker.tick().await;
            if !state.leadership.is_leader() || !cursor::is_enabled(&state.db) {
                continue;
            }
            if let Err(e) = poll_once(&app, &state).await {
                tracing::warn!(error = %e, "remote-command poll failed");
            }
        }
    });
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// List the pending run-requests targeted at this device (for the approval UI
/// to render on mount / refresh). Returns empty when not signed in.
#[tauri::command]
#[requires(privileged)]
pub async fn remote_command_list_pending(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<RemoteCommand>, AppError> {
    let jwt = match read_token(&state).await {
        Some(t) => t,
        None => return Ok(vec![]),
    };
    let client = SyncClient::new(jwt)?;
    let pool = state.db.clone();
    let device = cursor::resolve_device_id(&pool);
    let path = format!(
        "pending_commands?status=eq.pending&command_type=eq.run_persona&target_device_id=eq.{device}&order=requested_at.asc&{SELECT}"
    );
    let cmds: Vec<CommandRow> = client.get(&path).await?;
    Ok(cmds
        .into_iter()
        .filter(|c| !is_expired(&c.requested_at))
        .map(|c| to_remote(c, &pool))
        .collect())
}

/// Validate that a remote-command `id` is a canonical UUID before it is
/// interpolated into a PostgREST query path. PostgREST treats `&`, `=`, and
/// `eq.` as structured query syntax, so an unvalidated `id` (e.g.
/// `x&status=eq.pending`) would let a caller widen the WHERE clause of a
/// tenant-scoped GET/PATCH under the user's own JWT — mass-reject, status
/// spoofing, or appending a permissive filter to defeat per-device scoping. A
/// parsed UUID contains only hex + hyphens, so it cannot carry that syntax.
fn validate_command_id(id: &str) -> Result<(), AppError> {
    uuid::Uuid::parse_str(id)
        .map(|_| ())
        .map_err(|_| AppError::Validation("Invalid remote command id".into()))
}

/// Approve a remote run-request: run the persona locally and write the result
/// (execution id) back to the command row. Requires a live Google session.
#[tauri::command]
#[requires(cloud)]
pub async fn remote_command_approve(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    id: String,
) -> Result<String, AppError> {
    validate_command_id(&id)?;
    let jwt = read_token(&state)
        .await
        .ok_or_else(|| AppError::Auth("Not signed in".into()))?;
    let client = SyncClient::new(jwt)?;

    // Scope the fetch to THIS device. The id is a listable UUID, not a per-device
    // capability token, and RLS only scopes rows to the tenant — not the device.
    // Without this filter a multi-device user could approve a run targeted at
    // device B and have it execute on device A (wrong sandbox / local creds /
    // working tree). A wrong-device row simply won't return → "not found".
    let device = cursor::resolve_device_id(&state.db);
    let cmds: Vec<CommandRow> = client
        .get(&format!(
            "pending_commands?id=eq.{id}&target_device_id=eq.{device}&{SELECT}"
        ))
        .await?;
    let cmd = cmds
        .into_iter()
        .next()
        .ok_or_else(|| AppError::Validation("Remote command not found".into()))?;
    if cmd.status != "pending" {
        return Err(AppError::Validation(
            "This request is no longer pending".into(),
        ));
    }
    if cmd.command_type != "run_persona" {
        return Err(AppError::Validation("Unsupported command type".into()));
    }
    let persona_id = cmd
        .persona_id
        .ok_or_else(|| AppError::Validation("Request is missing a persona".into()))?;

    set_command_status(&client, &id, "executing", json!({})).await;

    // Run locally — same path as a normal run; the engine enforces the persona's
    // own sandbox, setup gate, budget, and tool exposure.
    let result = crate::commands::execution::executions::execute_persona_inner(
        state.inner(),
        app,
        persona_id,
        None,
        cmd.prompt,
        None,
        None,
        None,
        false,
    )
    .await;

    match result {
        Ok(exec) => {
            set_command_status(
                &client,
                &id,
                "completed",
                json!({ "execution_id": exec.id, "resolved_at": now() }),
            )
            .await;
            Ok(exec.id)
        }
        Err(e) => {
            set_command_status(
                &client,
                &id,
                "failed",
                json!({ "error_message": e.to_string(), "resolved_at": now() }),
            )
            .await;
            Err(e)
        }
    }
}

/// Reject a remote run-request.
#[tauri::command]
#[requires(cloud)]
pub async fn remote_command_reject(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<(), AppError> {
    validate_command_id(&id)?;
    let jwt = read_token(&state)
        .await
        .ok_or_else(|| AppError::Auth("Not signed in".into()))?;
    let client = SyncClient::new(jwt)?;
    client
        .patch(
            &format!("pending_commands?id=eq.{id}"),
            &json!({ "status": "rejected", "resolved_at": now(), "updated_at": now() }),
        )
        .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expiry_window_classification() {
        let old = (chrono::Utc::now() - chrono::Duration::hours(2)).to_rfc3339();
        let recent = (chrono::Utc::now() - chrono::Duration::minutes(5)).to_rfc3339();
        assert!(is_expired(&old), "a 2h-old request should be expired");
        assert!(!is_expired(&recent), "a 5m-old request should not be expired");
        // Unparseable timestamps must NOT be treated as expired (fail-safe:
        // a malformed requested_at shouldn't silently drop a real request).
        assert!(!is_expired("not-a-timestamp"));
    }
}
