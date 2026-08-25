//! Feed-impact pipeline — the autonomous half of the shared-events Watchtower
//! (spark: fleet dispatch UX, WP4).
//!
//! A `shared:<slug>` firing (curated connector-API-change event) can be bound
//! to the `feed_impact_dispatch` system op in Chain Studio. When it fires, the
//! op looks up the feed's routed dev projects (`shared_event_project_routes`)
//! and dispatches one Fleet Claude Code session per routed project (cap
//! [`FEED_IMPACT_MAX_PROJECTS`]) to assess — and where warranted implement —
//! the change's impact on that repo. Like kpi-sim / practice-harvest, this
//! module owns the app-side ends:
//!
//! - the dispatch itself ([`run_feed_impact_dispatch`], called from
//!   `engine::system_ops::run_op`),
//! - the prompt contract ([`build_feed_impact_prompt`]),
//! - the ONE gated ingest door ([`dev_tools_feed_impact_ingest`]) that parses
//!   `<root>/feed-impact/runs/<id>/result.json` into
//!   `shared_event_impact_runs` — the CLI session NEVER writes personas.db,
//! - the pending-ingest watcher ([`sweep_pending_feed_impact_ingests`], riding
//!   the fleet stale ticker like the harvest watcher) that ingests a finished
//!   wave with no UI open and raises one wave-complete notification.

use std::path::PathBuf;
use std::sync::Arc;

use serde::Deserialize;
use serde_json::Value;
use tauri::State;
use ts_rs::TS;

use crate::db::repos::communication::shared_event_impact_runs as impact_repo;
use crate::db::repos::communication::shared_event_routes as routes_repo;
use crate::db::repos::communication::shared_events as feeds_repo;
use crate::db::repos::dev_tools as dev_repo;
use crate::db::DbPool;
use crate::error::AppError;
use crate::ipc_auth::require_auth;
use crate::AppState;

/// Projects one firing wave may dispatch into — same posture as the
/// fleet-dispatch cap: parallel spawns beyond this stall the machine.
pub const FEED_IMPACT_MAX_PROJECTS: usize = 8;

const MAX_RESULT_BYTES: u64 = 1_048_576;

const VERDICTS: &[&str] = &["no_impact", "assessed", "committed", "gates_red", "failed"];

/// Fleet dedup key for a per-project impact session. Lives inside the session
/// display name; both the dispatch dedup check and the sweeper find sessions
/// by this substring.
pub(crate) fn feed_impact_dispatch_key(catalog_entry_id: &str, project_id: &str) -> String {
    format!("feed:{catalog_entry_id}:{project_id}")
}

// ── the triggering change, parsed from the op's `_event` params ─────────────

/// The change context one firing carries, joined to its catalog entry.
#[derive(Debug, Clone)]
pub(crate) struct FeedChange {
    pub slug: String,
    pub firing_id: String,
    pub connector: String,
    pub summary: String,
    pub tags: Vec<String>,
    pub severity: String,
    pub docs_url: Option<String>,
    pub release_version: Option<String>,
}

/// Parse the triggering event out of the op params (`_event`, threaded by
/// `dispatch_event_automations`). Pure so the contract is testable without an
/// AppHandle: event_type must be `shared:<slug>`, `source_id` is the firing
/// id, and `payload` is the firing's JSON payload string.
pub(crate) fn parse_feed_event(params: &Value) -> Result<FeedChange, AppError> {
    let ev = params.get("_event").ok_or_else(|| {
        AppError::Validation(
            "feed_impact_dispatch needs a triggering event: bind this op to a `shared:<slug>` event"
                .into(),
        )
    })?;
    let event_type = ev
        .get("event_type")
        .and_then(|v| v.as_str())
        .unwrap_or_default();
    let slug = event_type.strip_prefix("shared:").ok_or_else(|| {
        AppError::Validation(format!(
            "feed_impact_dispatch fired by `{event_type}` — it only handles `shared:<slug>` events"
        ))
    })?;
    if slug.trim().is_empty() {
        return Err(AppError::Validation(
            "feed_impact_dispatch: event carries an empty feed slug".into(),
        ));
    }
    let firing_id = ev
        .get("source_id")
        .and_then(|v| v.as_str())
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| {
            AppError::Validation("feed_impact_dispatch: event has no source_id (firing id)".into())
        })?;

    // Firing payload: `{connector, label, docs_url, detected_at, summary,
    // tags[], severity, release_version}` as a JSON string. Lenient — a
    // malformed payload still dispatches with whatever fields parse.
    let payload: Value = ev
        .get("payload")
        .and_then(|v| v.as_str())
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_else(|| serde_json::json!({}));
    let str_field = |k: &str| -> Option<String> {
        payload
            .get(k)
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
    };
    Ok(FeedChange {
        slug: slug.to_string(),
        firing_id: firing_id.to_string(),
        connector: str_field("connector").unwrap_or_else(|| slug.to_string()),
        summary: str_field("summary")
            .or_else(|| str_field("label"))
            .unwrap_or_else(|| "API change detected".to_string()),
        tags: payload
            .get("tags")
            .and_then(|v| v.as_array())
            .map(|a| {
                a.iter()
                    .filter_map(|x| x.as_str())
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default(),
        severity: str_field("severity").unwrap_or_else(|| "minor".to_string()),
        docs_url: str_field("docs_url"),
        release_version: str_field("release_version"),
    })
}

// ── prompt contract ─────────────────────────────────────────────────────────

/// Build the session brief for one routed project. The result.json shape below
/// is pinned by [`ImpactResult`]'s deserializer — change both in one commit.
pub(crate) fn build_feed_impact_prompt(
    change: &FeedChange,
    project_name: &str,
    main_branch: Option<&str>,
) -> String {
    let branch = main_branch.unwrap_or("the repo's default branch (main or master — detect it)");
    let docs = change
        .docs_url
        .as_deref()
        .map(|u| format!("\n  docs:        {u}"))
        .unwrap_or_default();
    let release = change
        .release_version
        .as_deref()
        .map(|v| format!("\n  release:     {v}"))
        .unwrap_or_default();
    let tags = if change.tags.is_empty() {
        String::new()
    } else {
        format!("\n  tags:        {}", change.tags.join(", "))
    };
    format!(
        r#"You are assessing the impact of an upstream connector API change on the "{project_name}" repository, and implementing the adaptation when it is warranted.

THE CHANGE:
  connector:   {connector}
  feed slug:   {slug}
  severity:    {severity}
  summary:     {summary}{tags}{docs}{release}

PROCEDURE:
1. ASSESS — determine whether THIS repo is affected. Grep for real usage of the connector (imports, API calls, SDK versions in manifests/lockfiles, endpoint paths, config). Read the docs URL if provided. If the repo does not use this connector at all, the verdict is `no_impact` — say so honestly and stop after writing result.json.
2. IMPLEMENT — if the change genuinely affects this repo, implement the adaptation/upgrade (version bump, endpoint/parameter migration, deprecation fix). Keep the diff minimal and single-purpose. If the change is relevant but needs a human decision, stop at `assessed` and explain in the summary.
3. VERIFY — run this repo's OWN gates: read its CLAUDE.md / package manifest scripts and run the checks it declares (typecheck, lint, tests, build — whatever the repo itself uses). Never invent gates; never skip declared ones.
4. COMMIT — commit to `{branch}` ONLY if every gate is green (verdict `committed`, with the commit sha). If gates are red and you cannot fix them within this session, revert your working-tree changes and report `gates_red`. A worktree may be used only if it is merged back AND cleaned up before you finish — never leave a branch, a worktree, or uncommitted work behind.

RESULT CONTRACT — ALWAYS write `feed-impact/runs/<run-id>/result.json` at the repo root before you finish (pick a fresh `<run-id>` like `<YYYY-MM-DD-HHmm>-{connector_kebab}`). EXACTLY this shape:
{{
  "feed_slug": "{slug}",
  "firing_id": "{firing_id}",
  "project_id": "{{PROJECT_ID}}",
  "verdict": "no_impact" | "assessed" | "committed" | "gates_red" | "failed",
  "summary": "one-paragraph honest account of what you found and did",
  "commit_sha": "<sha>" | null,
  "details_md": "<optional markdown detail: evidence, files touched, gate output>" | null
}}

HARD RULES:
- Write ONLY under `feed-impact/runs/<run-id>/` plus the code changes themselves. Never touch any database.
- Commit only with green gates; `commit_sha` is null for every verdict except `committed`.
- If anything goes irrecoverably wrong, still write result.json with verdict `failed` and what happened.

End your final recap with exactly one line:
FLEET:DONE — <one-line summary of the verdict>"#,
        connector = change.connector,
        slug = change.slug,
        severity = change.severity,
        summary = change.summary,
        firing_id = change.firing_id,
        connector_kebab = change
            .connector
            .chars()
            .map(|c| {
                if c.is_ascii_alphanumeric() {
                    c.to_ascii_lowercase()
                } else {
                    '-'
                }
            })
            .collect::<String>(),
    )
}

// ── dispatch (the system op body) ───────────────────────────────────────────

/// Body of the `feed_impact_dispatch` system op: parse the firing, resolve the
/// feed's routed projects, and spawn one impact session per routed project
/// under a single dispatched Operation. Returns the run-detail string recorded
/// on the automation row.
pub(crate) fn run_feed_impact_dispatch(
    app: &tauri::AppHandle,
    pool: &DbPool,
    params: &Value,
) -> Result<String, AppError> {
    use crate::commands::companion::approvals::validate_fleet_cwd_in_db;

    let mut change = parse_feed_event(params)?;
    let entry = feeds_repo::get_catalog_entry_by_slug(pool, &change.slug)?.ok_or_else(|| {
        AppError::NotFound(format!(
            "feed_impact_dispatch: no catalog entry for feed slug `{}`",
            change.slug
        ))
    })?;
    // Prefer the catalog's display identity when the payload lacked one.
    if change.connector == change.slug {
        change.connector = entry.name.clone();
    }

    let routes = routes_repo::list_routes_for_entry(pool, &entry.id)?;
    if routes.is_empty() {
        return Ok(format!(
            "no projects routed for `{}` — nothing to dispatch",
            entry.name
        ));
    }

    let sessions = crate::commands::fleet::registry::registry().list_dto();
    let is_active = |state: crate::commands::fleet::types::FleetSessionState| {
        use crate::commands::fleet::types::FleetSessionState as S;
        matches!(state, S::Spawning | S::Running | S::AwaitingInput)
    };

    let mut skipped: Vec<String> = Vec::new();
    let mut dispatchable: Vec<(String, crate::db::models::DevProject)> = Vec::new(); // (key, project)
    for route in routes.iter().take(FEED_IMPACT_MAX_PROJECTS) {
        let key = feed_impact_dispatch_key(&entry.id, &route.project_id);
        let live = sessions
            .iter()
            .any(|s| s.name.as_deref().is_some_and(|n| n.contains(&key)) && is_active(s.state));
        if live {
            skipped.push(format!(
                "{}: an impact session is already working here",
                route.project_id
            ));
            continue;
        }
        let project = match dev_repo::get_project_by_id(pool, &route.project_id) {
            Ok(p) => p,
            Err(e) => {
                skipped.push(format!("{}: {e}", route.project_id));
                continue;
            }
        };
        if let Err(e) = validate_fleet_cwd_in_db(pool, &project.root_path) {
            skipped.push(format!("{}: {e}", project.name));
            continue;
        }
        dispatchable.push((key, project));
    }
    if dispatchable.is_empty() {
        return Ok(format!(
            "nothing dispatched for `{}` — {}",
            entry.name,
            if skipped.is_empty() {
                "no reachable routed project".to_string()
            } else {
                skipped.join("; ")
            }
        ));
    }

    // One Operation per firing wave — the reconciler + live-ops strip see it
    // the same way a fleet_dispatch / harvest wave is seen.
    let intent = format!(
        "Feed impact: {} {}",
        entry.name,
        change.release_version.as_deref().unwrap_or("(update)")
    );
    let op_id = crate::companion::orchestration::operative_memory::memory()
        .begin_dispatched_operation(intent);

    let base_label =
        crate::commands::fleet::naming::cli_safe_label(&format!("feed-{}", change.connector));
    let mut spawned: Vec<String> = Vec::new();
    let mut failures: Vec<String> = Vec::new();
    let mut pending_projects: Vec<String> = Vec::new();
    for (key, project) in &dispatchable {
        let prompt =
            build_feed_impact_prompt(&change, &project.name, project.main_branch.as_deref())
                .replace("{PROJECT_ID}", &project.id);
        match crate::commands::fleet::pty::spawn_session_named(
            app.clone(),
            PathBuf::from(&project.root_path),
            vec![prompt],
            120,
            32,
            Some(base_label.clone()),
        ) {
            Ok((id, cli_name)) => {
                let _ = crate::companion::orchestration::operative_memory::memory()
                    .attach_session_to_operation(&op_id, &id, &project.name, &project.root_path);
                // The display name must carry BOTH the athena sentinel (the
                // resolved CLI name starts with it — ownership guards) and the
                // dedup key (dispatch dedup + the sweeper find sessions by it).
                let display = format!("{} · {key}", cli_name.as_deref().unwrap_or(&base_label));
                let _ = crate::commands::fleet::registry::registry().rename(&id, Some(display));
                spawned.push(project.name.clone());
                pending_projects.push(project.id.clone());
            }
            Err(e) => failures.push(format!("{}: spawn failed: {e}", project.name)),
        }
    }
    if spawned.is_empty() {
        return Err(AppError::ProcessSpawn(format!(
            "feed_impact_dispatch: every spawn failed. {}",
            failures.join("; ")
        )));
    }
    note_pending_feed_impact(&entry.id, &entry.name, pending_projects);

    let mut detail = format!(
        "dispatched {} impact session(s) for `{}`: {}",
        spawned.len(),
        entry.name,
        spawned.join(", ")
    );
    if !skipped.is_empty() {
        detail.push_str(&format!("; skipped: {}", skipped.join("; ")));
    }
    if !failures.is_empty() {
        detail.push_str(&format!("; failures: {}", failures.join("; ")));
    }
    Ok(detail)
}

// ── ingest ──────────────────────────────────────────────────────────────────

/// result.json shape a session writes (strict on the fields the DB needs).
#[derive(Debug, Deserialize)]
struct ImpactResult {
    feed_slug: String,
    firing_id: String,
    project_id: String,
    verdict: String,
    summary: String,
    #[serde(default)]
    commit_sha: Option<String>,
    #[serde(default)]
    details_md: Option<String>,
}

/// What one ingest pass recorded — returned by the command and rolled into the
/// wave-complete notification by the sweeper.
#[derive(Debug, Default, serde::Serialize, TS)]
#[ts(export)]
pub struct FeedImpactIngestSummary {
    pub ingested: u32,
    /// The verdicts recorded, in ingest order (drives the notification body).
    pub verdicts: Vec<String>,
    /// Per-run reasons for anything the validator refused — never silent.
    pub skipped: Vec<String>,
}

/// Ingest every finished, un-ingested feed-impact run for a project. Path
/// containment is by construction: runs are only ever read under the
/// registered project's own `feed-impact/runs/`. Idempotent via the
/// `ingested.json` marker; 1 MiB cap per result.json.
#[tauri::command]
pub async fn dev_tools_feed_impact_ingest(
    state: State<'_, Arc<AppState>>,
    project_id: String,
) -> Result<FeedImpactIngestSummary, AppError> {
    require_auth(&state).await?;
    ingest_feed_impact_core(&state.db, &project_id)
}

/// Body of [`dev_tools_feed_impact_ingest`], minus the IPC envelope — shared
/// with the sweeper so a dispatched wave lands with no UI open.
pub(crate) fn ingest_feed_impact_core(
    pool: &DbPool,
    project_id: &str,
) -> Result<FeedImpactIngestSummary, AppError> {
    let project = dev_repo::get_project_by_id(pool, project_id)?;
    let runs_root = PathBuf::from(&project.root_path)
        .join("feed-impact")
        .join("runs");
    let runs =
        crate::commands::infrastructure::skill_runs::ingestable_runs_oldest_first(&runs_root);

    let mut summary = FeedImpactIngestSummary::default();
    for dir in runs {
        let name = dir
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        let result_path = dir.join("result.json");
        let meta = match std::fs::metadata(&result_path) {
            Ok(m) => m,
            Err(e) => {
                summary
                    .skipped
                    .push(format!("{name}: result.json not readable: {e}"));
                continue;
            }
        };
        if meta.len() > MAX_RESULT_BYTES {
            summary.skipped.push(format!(
                "{name}: result.json is {} bytes (cap {MAX_RESULT_BYTES})",
                meta.len()
            ));
            continue;
        }
        let raw = match std::fs::read_to_string(&result_path) {
            Ok(r) => r,
            Err(e) => {
                summary
                    .skipped
                    .push(format!("{name}: result.json not readable: {e}"));
                continue;
            }
        };
        let result: ImpactResult = match serde_json::from_str(&raw) {
            Ok(r) => r,
            Err(e) => {
                summary
                    .skipped
                    .push(format!("{name}: result.json is not valid: {e}"));
                continue;
            }
        };
        if !VERDICTS.contains(&result.verdict.as_str()) {
            summary.skipped.push(format!(
                "{name}: unknown verdict `{}` (expected {})",
                result.verdict,
                VERDICTS.join(" | ")
            ));
            continue;
        }
        if result.project_id != project_id {
            summary.skipped.push(format!(
                "{name}: result claims project `{}` but was found under `{project_id}` — refused",
                result.project_id
            ));
            continue;
        }
        let entry = match feeds_repo::get_catalog_entry_by_slug(pool, &result.feed_slug)? {
            Some(e) => e,
            None => {
                summary
                    .skipped
                    .push(format!("{name}: unknown feed slug `{}`", result.feed_slug));
                continue;
            }
        };
        // A committed verdict must carry a sha; anything else must not.
        let commit_sha = result
            .commit_sha
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty() && result.verdict == "committed");
        match impact_repo::insert_impact_run(
            pool,
            impact_repo::NewImpactRun {
                firing_id: &result.firing_id,
                catalog_entry_id: &entry.id,
                project_id,
                verdict: &result.verdict,
                summary: &result.summary,
                commit_sha,
                details_md: result.details_md.as_deref(),
            },
        ) {
            Ok(_) => {
                summary.ingested += 1;
                summary.verdicts.push(result.verdict.clone());
                let marker = serde_json::json!({
                    "ingested_at": chrono::Utc::now().to_rfc3339(),
                    "verdict": result.verdict,
                });
                if let Err(e) = std::fs::write(
                    dir.join("ingested.json"),
                    serde_json::to_vec_pretty(&marker).unwrap_or_default(),
                ) {
                    summary.skipped.push(format!(
                        "{name}: could not write ingested marker (a re-ingest will duplicate this row): {e}"
                    ));
                }
            }
            Err(e) => summary.skipped.push(format!("{name}: {e}")),
        }
    }
    Ok(summary)
}

// ── pending-ingest watcher ──────────────────────────────────────────────────
//
// Mirror of the harvest watcher (`workspace_harvest::sweep_pending_harvest_ingests`):
// the dispatch registers its wave here, and the fleet stale ticker calls the
// sweep. Once no session named with the wave's `feed:<entry>:` key is still
// working, every finished run is ingested through the same idempotent door the
// command uses, and ONE wave-complete notification fires. In-memory by design:
// an app restart drops the watch; the runs are then picked up by the next
// manual ingest, never lost.

struct PendingImpactWave {
    entry_id: String,
    feed_name: String,
    project_ids: Vec<String>,
}

fn pending_impact_waves() -> &'static std::sync::Mutex<Vec<PendingImpactWave>> {
    static P: std::sync::OnceLock<std::sync::Mutex<Vec<PendingImpactWave>>> =
        std::sync::OnceLock::new();
    P.get_or_init(|| std::sync::Mutex::new(Vec::new()))
}

/// Register a dispatched wave for post-completion ingest. A second firing on
/// the same entry while a wave is pending merges its projects into that wave.
pub(crate) fn note_pending_feed_impact(entry_id: &str, feed_name: &str, project_ids: Vec<String>) {
    let mut p = pending_impact_waves()
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    if let Some(w) = p.iter_mut().find(|w| w.entry_id == entry_id) {
        for id in project_ids {
            if !w.project_ids.contains(&id) {
                w.project_ids.push(id);
            }
        }
        return;
    }
    p.push(PendingImpactWave {
        entry_id: entry_id.to_string(),
        feed_name: feed_name.to_string(),
        project_ids,
    });
}

/// Human summary of a wave's verdicts: "2 committed, 1 no impact".
fn verdict_summary(verdicts: &[String]) -> String {
    let mut counts: Vec<(String, u32)> = Vec::new();
    for v in verdicts {
        let l = match v.as_str() {
            "no_impact" => "no impact".to_string(),
            "gates_red" => "gates red".to_string(),
            other => other.to_string(),
        };
        match counts.iter_mut().find(|(k, _)| *k == l) {
            Some((_, n)) => *n += 1,
            None => counts.push((l, 1)),
        }
    }
    counts
        .into_iter()
        .map(|(k, n)| format!("{n} {k}"))
        .collect::<Vec<_>>()
        .join(", ")
}

/// Called from the fleet stale ticker. For each registered wave whose sessions
/// have all settled, ingest the finished runs and raise one notification.
pub fn sweep_pending_feed_impact_ingests(app: &tauri::AppHandle) {
    use tauri::Manager;
    let snapshot: Vec<(String, String, Vec<String>)> = {
        let p = pending_impact_waves()
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        p.iter()
            .map(|w| {
                (
                    w.entry_id.clone(),
                    w.feed_name.clone(),
                    w.project_ids.clone(),
                )
            })
            .collect()
    };
    if snapshot.is_empty() {
        return;
    }
    let Some(state) = app.try_state::<Arc<AppState>>() else {
        return;
    };
    let sessions = crate::commands::fleet::registry::registry().list_dto();
    let is_active = |s: crate::commands::fleet::types::FleetSessionState| {
        use crate::commands::fleet::types::FleetSessionState as S;
        matches!(s, S::Spawning | S::Running | S::AwaitingInput)
    };
    for (entry_id, feed_name, project_ids) in snapshot {
        let key_prefix = format!("feed:{entry_id}:");
        let still_working = sessions.iter().any(|s| {
            s.name.as_deref().is_some_and(|n| n.contains(&key_prefix)) && is_active(s.state)
        });
        if still_working {
            continue;
        }
        let mut verdicts: Vec<String> = Vec::new();
        let mut ingested_total = 0u32;
        for project_id in &project_ids {
            match ingest_feed_impact_core(&state.db, project_id) {
                Ok(summary) => {
                    ingested_total += summary.ingested;
                    verdicts.extend(summary.verdicts);
                    if !summary.skipped.is_empty() {
                        tracing::warn!(
                            entry = %entry_id,
                            project = %project_id,
                            skipped = ?summary.skipped,
                            "feed-impact watcher: some runs were refused"
                        );
                    }
                }
                Err(e) => {
                    tracing::debug!(
                        entry = %entry_id,
                        project = %project_id,
                        error = %e,
                        "feed-impact watcher: ingest not ready"
                    );
                }
            }
        }
        let any_session_left = sessions
            .iter()
            .any(|s| s.name.as_deref().is_some_and(|n| n.contains(&key_prefix)));
        if ingested_total == 0 && any_session_left {
            // Sessions settled but idle ones may still write their run on a
            // later turn — keep watching until they disappear or runs land.
            continue;
        }
        {
            let mut p = pending_impact_waves()
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            p.retain(|w| w.entry_id != entry_id);
        }
        if ingested_total > 0 {
            tracing::info!(
                entry = %entry_id,
                ingested = ingested_total,
                "feed-impact watcher: ingested dispatched wave"
            );
            crate::notifications::notify_feed_impact_wave(
                app,
                &feed_name,
                &verdict_summary(&verdicts),
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn event_params(event_type: &str, source_id: Option<&str>, payload: Option<Value>) -> Value {
        json!({
            "_event": {
                "event_type": event_type,
                "source_id": source_id,
                "payload": payload.map(|p| p.to_string()),
            }
        })
    }

    #[test]
    fn parse_feed_event_reads_slug_firing_and_payload() {
        let params = event_params(
            "shared:connector.elevenlabs.api",
            Some("firing-1"),
            Some(json!({
                "connector": "ElevenLabs",
                "summary": "v2 voices endpoint",
                "tags": ["voices", "breaking"],
                "severity": "major",
                "docs_url": "https://docs.example",
                "release_version": "2.1.0",
            })),
        );
        let c = parse_feed_event(&params).unwrap();
        assert_eq!(c.slug, "connector.elevenlabs.api");
        assert_eq!(c.firing_id, "firing-1");
        assert_eq!(c.connector, "ElevenLabs");
        assert_eq!(c.severity, "major");
        assert_eq!(c.tags, vec!["voices", "breaking"]);
        assert_eq!(c.release_version.as_deref(), Some("2.1.0"));
    }

    #[test]
    fn parse_feed_event_rejects_non_shared_events_and_missing_pieces() {
        // Wrong event family.
        let err = parse_feed_event(&event_params("signal.raised", Some("x"), None)).unwrap_err();
        assert!(err.to_string().contains("shared:<slug>"));
        // No _event at all.
        assert!(parse_feed_event(&json!({})).is_err());
        // No firing id.
        assert!(parse_feed_event(&event_params("shared:foo", None, None)).is_err());
        // Malformed payload still parses with defaults.
        let c = parse_feed_event(&json!({
            "_event": { "event_type": "shared:foo", "source_id": "f1", "payload": "not json" }
        }))
        .unwrap();
        assert_eq!(c.connector, "foo");
        assert_eq!(c.severity, "minor");
    }

    /// The prompt and [`ImpactResult`] are two ends of one contract — the
    /// prompt's literal example must deserialize into the ingest shape.
    #[test]
    fn prompt_carries_the_result_contract_and_fleet_done() {
        let c = parse_feed_event(&event_params(
            "shared:connector.stripe.api",
            Some("firing-9"),
            Some(json!({"connector": "Stripe", "summary": "s", "severity": "minor"})),
        ))
        .unwrap();
        let p = build_feed_impact_prompt(&c, "pumper", Some("master"));
        assert!(p.contains("feed-impact/runs/"));
        assert!(p.contains("\"feed_slug\": \"connector.stripe.api\""));
        assert!(p.contains("\"firing_id\": \"firing-9\""));
        assert!(p.contains("FLEET:DONE"));
        assert!(p.contains("`master`"));
        // Every verdict named in the prompt is one the ingest accepts.
        for v in VERDICTS {
            assert!(p.contains(v), "prompt must name verdict {v}");
        }
        // The result example round-trips into the deserializer once the
        // placeholders are substituted.
        let example = r#"{"feed_slug":"connector.stripe.api","firing_id":"firing-9","project_id":"p1","verdict":"committed","summary":"done","commit_sha":"abc","details_md":null}"#;
        let parsed: ImpactResult = serde_json::from_str(example).unwrap();
        assert_eq!(parsed.verdict, "committed");
    }

    #[test]
    fn verdict_summary_counts_in_first_seen_order() {
        let v = vec![
            "committed".to_string(),
            "no_impact".to_string(),
            "committed".to_string(),
        ];
        assert_eq!(verdict_summary(&v), "2 committed, 1 no impact");
        assert_eq!(verdict_summary(&[]), "");
    }
}
