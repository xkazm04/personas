//! System-operation runtime: the catalog of built-in operations, the runner
//! that executes one by `op_kind`, and the dispatch hooks the background loop
//! calls each tick (due schedule automations + event-listener automations).
//!
//! A "system operation" is a callable backend action that is NOT a persona
//! execution. The first one is `context_scan` — re-deriving a dev-tools
//! project's context map (incremental by default). The Chain Studio commits
//! these as `SystemOpAutomation` rows (trigger → system op); the Context Map
//! "Plan update" button creates a weekly schedule.

use serde_json::{json, Value};
use tauri::AppHandle;

use crate::db::models::{PersonaEvent, SystemOpKindMeta};
use crate::db::repos::communication::events as event_repo;
use crate::db::repos::dev_tools as dev_repo;
use crate::db::repos::system_ops as repo;
use crate::db::DbPool;
use crate::error::AppError;

use super::cron;
use super::event_registry::event_name;

/// Registered op kinds.
pub const OP_CONTEXT_SCAN: &str = "context_scan";

/// Catalog of available system operations (drives the Studio "System events" rail).
pub fn list_kinds() -> Vec<SystemOpKindMeta> {
    vec![SystemOpKindMeta {
        kind: OP_CONTEXT_SCAN.to_string(),
        label: "Context Scan Update".to_string(),
        description: "Re-derive a dev-tools project's context map (incremental).".to_string(),
        requires_project: true,
    }]
}

/// Whether `kind` is a registered operation.
pub fn is_known_kind(kind: &str) -> bool {
    list_kinds().iter().any(|k| k.kind == kind)
}

/// Compute the next fire time (RFC3339) for a cron, seeded by the automation id
/// so identical crons across automations don't thundering-herd.
pub fn compute_next_run_at(cron_expr: &str, id: &str, tz: Option<&str>) -> Option<String> {
    let schedule = cron::parse_cron_seeded(cron_expr, cron::seed_hash(id)).ok()?;
    let now = chrono::Utc::now();
    let next = match tz.and_then(|z| z.parse().ok()) {
        Some(z) => cron::next_fire_time_in_tz(&schedule, now, z)?,
        None => cron::next_fire_time_local(&schedule, now)?,
    };
    Some(next.to_rfc3339())
}

/// Run a system operation by kind + params. Launch ops return immediately (the
/// work runs in a spawned task); the returned string is a short status detail.
/// `source` is a free-form tag for diagnostics ("schedule" | "event" | "manual").
pub fn run_op(
    app: &AppHandle,
    pool: &DbPool,
    op_kind: &str,
    params: &Value,
    source: &str,
) -> Result<String, AppError> {
    match op_kind {
        OP_CONTEXT_SCAN => run_context_scan(app, pool, params, source),
        other => Err(AppError::Validation(format!("Unknown system op: {other}"))),
    }
}

fn run_context_scan(
    app: &AppHandle,
    pool: &DbPool,
    params: &Value,
    _source: &str,
) -> Result<String, AppError> {
    let project_id = params
        .get("projectId")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Validation("context_scan requires a projectId param".into()))?;
    let delta = params.get("deltaMode").and_then(|v| v.as_bool()).unwrap_or(true);
    let project = dev_repo::get_project_by_id(pool, project_id)?;
    let res = crate::commands::infrastructure::context_generation::launch_context_scan(
        app.clone(),
        pool,
        &project,
        &project.root_path,
        delta,
    )?;
    let scan_id = res
        .get("scan_id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    Ok(format!("scan_id={scan_id}"))
}

// ---------------------------------------------------------------------------
// Lifecycle events → bus (so any scan, manual or automated, shows in Live Stream)
// ---------------------------------------------------------------------------

/// Publish a context-scan lifecycle event onto the persona-event bus. `phase`
/// is `"started"` or `"completed"`. Has no `target_persona_id`, so it dispatches
/// to no persona — it just surfaces in the Live Stream / Event Log.
pub fn publish_context_scan_event(
    pool: &DbPool,
    phase: &str,
    project_id: &str,
    project_name: &str,
    extra: Value,
) {
    let event_type = match phase {
        "completed" => event_name::DEV_TOOLS_CONTEXT_SCAN_COMPLETED,
        _ => event_name::DEV_TOOLS_CONTEXT_SCAN_STARTED,
    };
    let mut payload = json!({ "project_id": project_id, "project_name": project_name, "phase": phase });
    if let (Some(obj), Some(ext)) = (payload.as_object_mut(), extra.as_object()) {
        for (k, v) in ext {
            obj.insert(k.clone(), v.clone());
        }
    }
    let input = crate::db::models::CreatePersonaEventInput {
        event_type: event_type.to_string(),
        source_type: "system_op".into(),
        source_id: Some(project_id.to_string()),
        target_persona_id: None,
        project_id: Some(project_id.to_string()),
        payload: Some(payload.to_string()),
        use_case_id: None,
    };
    if let Err(e) = event_repo::publish(pool, input) {
        tracing::warn!(error = %e, "failed to publish context_scan {phase} event");
    }
}

// ---------------------------------------------------------------------------
// Background dispatch (called from engine::background::event_bus_tick)
// ---------------------------------------------------------------------------

/// Run every schedule automation whose `next_run_at` has arrived, re-arming the
/// next fire time as we go. Cheap indexed query; safe to call every bus tick.
pub fn run_due_schedule_automations(app: &AppHandle, pool: &DbPool) {
    let now = chrono::Utc::now().to_rfc3339();
    let due = match repo::get_due_schedules(pool, &now) {
        Ok(d) => d,
        Err(e) => {
            tracing::error!(error = %e, "system_ops: due-schedule query failed");
            return;
        }
    };
    for a in due {
        let next = a
            .cron
            .as_deref()
            .and_then(|c| compute_next_run_at(c, &a.id, a.timezone.as_deref()));
        let params: Value = serde_json::from_str(&a.params_json).unwrap_or_else(|_| json!({}));
        let (status, detail) = match run_op(app, pool, &a.op_kind, &params, "schedule") {
            Ok(d) => ("ok", d),
            Err(e) => ("failed", e.to_string()),
        };
        let _ = repo::mark_run(pool, &a.id, status, Some(&detail), next.as_deref());
        tracing::info!(automation = %a.id, op = %a.op_kind, status, "system-op schedule fired");
    }
}

/// Match this tick's bus events against enabled event-listener automations and
/// run the ones that fire. Skips the scan lifecycle events themselves so an
/// automation listening broadly can't loop on its own output.
pub fn dispatch_event_automations(app: &AppHandle, pool: &DbPool, events: &[PersonaEvent]) {
    if events.is_empty() {
        return;
    }
    let autos = match repo::list_enabled_event_automations(pool) {
        Ok(a) => a,
        Err(e) => {
            tracing::error!(error = %e, "system_ops: event-automation fetch failed");
            return;
        }
    };
    if autos.is_empty() {
        return;
    }
    for ev in events {
        if ev.event_type.starts_with("dev_tools.context_scan_") {
            continue; // never react to our own lifecycle events (loop guard)
        }
        for a in &autos {
            if a.listen_event_type.as_deref() != Some(ev.event_type.as_str()) {
                continue;
            }
            if let Some(filter) = a.source_filter.as_deref() {
                if !source_matches(filter, ev.source_id.as_deref()) {
                    continue;
                }
            }
            let params: Value = serde_json::from_str(&a.params_json).unwrap_or_else(|_| json!({}));
            let (status, detail) = match run_op(app, pool, &a.op_kind, &params, "event") {
                Ok(d) => ("ok", d),
                Err(e) => ("failed", e.to_string()),
            };
            let _ = repo::mark_run(pool, &a.id, status, Some(&detail), None);
            tracing::info!(automation = %a.id, op = %a.op_kind, event = %ev.event_type, status, "system-op event fired");
        }
    }
}

/// Simple `prefix*` / exact wildcard match used by `source_filter`.
fn source_matches(filter: &str, source_id: Option<&str>) -> bool {
    let Some(src) = source_id else { return false };
    if let Some(prefix) = filter.strip_suffix('*') {
        src.starts_with(prefix)
    } else {
        src == filter
    }
}
