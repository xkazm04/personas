//! Push accelerator — out-of-cadence consolidator trigger.
//!
//! Hosts the `POST /project-tracking/cli-event` route under `local_http`.
//! A CLI/skill that just shipped something interesting can POST to it,
//! optionally inject a Note event, and ask the consolidator to run NOW
//! instead of waiting for the next scheduled tick. Per-project debounce
//! caps out-of-cadence runs at one per 5 minutes so a hot session can't
//! starve the LLM budget.
//!
//! Loopback-only by virtue of `local_http` binding to 127.0.0.1; no
//! nonce gate in v1 because no remote actor can reach the endpoint.
//! A future hardening pass can layer per-app tokens on top.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, OnceLock, RwLock};
use std::time::{Duration, Instant};

use axum::{
    extract::Json as JsonExtractor, http::StatusCode, response::IntoResponse,
    response::Json, routing::post, Router,
};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tokio::task::JoinHandle;
use tracing::{debug, warn};

use crate::db::UserDbPool;
use crate::engine::project_tracking::consolidator::{self, TickSnapshot};
use crate::engine::project_tracking::events::{self, EventPayload};
use crate::engine::project_tracking::subscription;

/// Per-project debounce window — at most one out-of-cadence consolidator
/// run per project per this interval.
const DEBOUNCE_INTERVAL: Duration = Duration::from_secs(300);

/// Process-global push handle. Filled by [`init`] after `AppState` is
/// built; the route handler reads it. Pre-init the handler returns 503.
static PUSH_HANDLE: OnceLock<Arc<PushHandle>> = OnceLock::new();

/// Wraps the runtime state the route handler needs.
pub struct PushHandle {
    pool: UserDbPool,
    app_handle: AppHandle,
    /// Per-project last successful consolidator run timestamp. Used to
    /// enforce [`DEBOUNCE_INTERVAL`].
    debounce: RwLock<HashMap<String, Instant>>,
}

/// Build the axum router. Mounted under prefix `project-tracking` in
/// `lib.rs` setup, so the resolved path is `/project-tracking/cli-event`.
pub fn router() -> Router {
    Router::new().route("/cli-event", post(cli_event_handler))
}

/// Set the process-global push handle. Idempotent. Safe to call before
/// or after the route registers; the route reads the handle on each
/// request.
pub fn init(pool: UserDbPool, app_handle: AppHandle) {
    let handle = Arc::new(PushHandle {
        pool,
        app_handle,
        debounce: RwLock::new(HashMap::new()),
    });
    let _ = PUSH_HANDLE.set(handle);
}

/// In-process helper for skill/CLI hooks that already run inside the
/// Tauri process and don't want to round-trip through HTTP. Same
/// behavior: optional event insert + debounced consolidator trigger.
/// Returns the resolved project_id (None if unknown).
pub async fn push_cli_event(
    project_path: &str,
    summary: Option<&str>,
    title: Option<&str>,
) -> Option<String> {
    let handle = PUSH_HANDLE.get()?;
    do_push(handle, project_path, summary, title).await.ok()?
}

#[derive(Debug, Deserialize)]
struct CliEventBody {
    project_path: String,
    #[serde(default)]
    summary: Option<String>,
    #[serde(default)]
    title: Option<String>,
}

#[derive(Debug, Serialize)]
struct CliEventResponse {
    status: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    project_id: Option<String>,
    triggered_consolidator: bool,
}

async fn cli_event_handler(JsonExtractor(body): JsonExtractor<CliEventBody>) -> impl IntoResponse {
    let Some(handle) = PUSH_HANDLE.get() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(CliEventResponse {
                status: "tracker_not_initialized",
                project_id: None,
                triggered_consolidator: false,
            }),
        );
    };

    match do_push(
        handle,
        &body.project_path,
        body.summary.as_deref(),
        body.title.as_deref(),
    )
    .await
    {
        Ok(Some(project_id)) => {
            let triggered = check_and_record_debounce(handle, &project_id);
            if triggered {
                spawn_out_of_cadence_consolidator(handle.clone(), project_id.clone());
            }
            (
                StatusCode::OK,
                Json(CliEventResponse {
                    status: "ok",
                    project_id: Some(project_id),
                    triggered_consolidator: triggered,
                }),
            )
        }
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(CliEventResponse {
                status: "unknown_project",
                project_id: None,
                triggered_consolidator: false,
            }),
        ),
        Err(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(CliEventResponse {
                status: "db_error",
                project_id: None,
                triggered_consolidator: false,
            }),
        ),
    }
}

/// Resolve the project, optionally insert a Note event, return the
/// project_id (or None if path didn't match a registered project).
async fn do_push(
    handle: &PushHandle,
    project_path: &str,
    summary: Option<&str>,
    title: Option<&str>,
) -> Result<Option<String>, crate::error::AppError> {
    let project_id = resolve_project(&handle.pool, project_path)?;
    let Some(project_id) = project_id else {
        return Ok(None);
    };

    if let Some(summary_text) = summary {
        let payload = EventPayload::Note {
            path: project_path.to_string(),
            title: title.map(|t| t.to_string()),
            summary: Some(summary_text.to_string()),
        };
        if let Err(e) = events::insert_event(&handle.pool, &project_id, &payload) {
            warn!(
                project_id = %project_id,
                error = %e,
                "push: event insert failed",
            );
        }
    }

    Ok(Some(project_id))
}

fn resolve_project(
    pool: &UserDbPool,
    project_path: &str,
) -> Result<Option<String>, crate::error::AppError> {
    // Normalize to absolute path (best-effort) and compare against the
    // path stored in companion_known_project. The registry's `path`
    // column is canonical-on-write; we accept exact matches and
    // case-insensitive matches on Windows where casing of the same
    // drive can drift between sessions.
    let normalized = canonicalize_path(project_path);
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT id FROM companion_known_project
         WHERE path = ?1 OR LOWER(path) = LOWER(?1)",
    )?;
    let id = stmt
        .query_row(params![normalized], |row| row.get::<_, String>(0))
        .optional()?;
    Ok(id)
}

fn canonicalize_path(raw: &str) -> String {
    PathBuf::from(raw)
        .canonicalize()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|_| raw.to_string())
}

fn check_and_record_debounce(handle: &PushHandle, project_id: &str) -> bool {
    let now = Instant::now();
    let mut store = match handle.debounce.write() {
        Ok(g) => g,
        Err(p) => p.into_inner(),
    };
    if let Some(last) = store.get(project_id) {
        if now.duration_since(*last) < DEBOUNCE_INTERVAL {
            debug!(
                project_id,
                "push: within debounce window; skipping out-of-cadence consolidator",
            );
            return false;
        }
    }
    store.insert(project_id.to_string(), now);
    true
}

fn spawn_out_of_cadence_consolidator(
    handle: Arc<PushHandle>,
    project_id: String,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        if let Err(e) = run_out_of_cadence_for_project(&handle, &project_id).await {
            warn!(
                project_id,
                error = %e,
                "push: out-of-cadence consolidator failed",
            );
        }
    })
}

async fn run_out_of_cadence_for_project(
    handle: &PushHandle,
    project_id: &str,
) -> Result<(), crate::error::AppError> {
    let Some(sub) = subscription::get(&handle.pool, project_id)? else {
        return Ok(());
    };
    if !sub.enabled {
        return Ok(());
    }

    // Pull recent events from the raw log to feed the consolidator. The
    // out-of-cadence path doesn't run watchers (the user already
    // signaled they have something to add and the next scheduled tick
    // will sweep up anything else). Using the events_since cutoff at
    // 24h — the consolidator's job is to pick the relevant slice.
    //
    // SQLite Statement is !Send so we drop the conn + stmt before the
    // first await point on the consolidator call.
    let events: Vec<EventPayload> = {
        let since = chrono::Utc::now() - chrono::Duration::hours(24);
        let conn = handle.pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT payload_json FROM engine_cli_event
             WHERE project_id = ?1 AND created_at >= ?2
             ORDER BY created_at",
        )?;
        let rows: Vec<String> = stmt
            .query_map(
                params![project_id, since.to_rfc3339()],
                |row| row.get::<_, String>(0),
            )?
            .collect::<Result<Vec<_>, _>>()?;
        rows.into_iter()
            .filter_map(|json| serde_json::from_str(&json).ok())
            .collect()
    };

    if events.is_empty() {
        return Ok(());
    }

    let project_name = sub
        .project_path
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(&sub.project_path)
        .to_string();
    let snapshot = TickSnapshot::from_events(project_name, &events);

    consolidator::run_for_project(&handle.pool, &sub, snapshot, Some(&handle.app_handle))
        .await
}
