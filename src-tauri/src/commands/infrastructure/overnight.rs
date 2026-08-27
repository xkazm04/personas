//! The Overnight Portfolio Engine — the mechanical nightly tick that turns a
//! project's `full` autopilot mode into a real scan → triage → dispatch loop
//! (moonshot batch-2 slice 1; `docs/harness/moonshot-2026-07-30/`).
//!
//! ## What one night run does (per `full`/`suggest` project, once per night)
//!
//! 1. **Incremental scan delta** — hash-walk the repo against the
//!    `dev_context_file_hashes` cache (mechanical, zero tokens) and record how
//!    much the surface drifted since the last real scan.
//! 2. **Triage rules** — [`super::dev_tools::run_triage_rules_core`]: the
//!    project's mechanical rules classify pending backlog ideas
//!    (first-matching-rule-wins; every verdict goes through the shared verdict
//!    core, so decision memory + adoption sync happen exactly as from a click).
//! 3. **Dispatch** (`full` only, `Capability::DispatchFixes`) — the ideas the
//!    rules auto-accepted are dispatched to unattended headless fleet sessions
//!    via [`super::dev_tools::dispatch_ideas_core`], capped by the fleet
//!    live-slot budget and a per-project nightly maximum. Every prompt carries
//!    the unattended guardrail block
//!    ([`personas_engine::unattended::UNATTENDED_DISPATCH_GUARDRAILS`]):
//!    **no default-branch writes, no push, no merge** — the morning human does
//!    that — and **finish, never ask**, because nothing can answer a question
//!    at 03:00. The sessions are tagged as an `overnight:` run so the fleet
//!    sweeper can terminate one that asked anyway. **Each one authors in its
//!    own `git worktree`** ([`personas_engine::unattended_worktree`]), on a
//!    branch prepared for it before spawn — never by switching the branch of
//!    the project's shared checkout, which is what sweep #23 (2026-08-26) left
//!    an operator's tree and dev server sitting on all night.
//! 4. **Morning digest** — one durable `autopilot_night_runs` ledger row +
//!    one `autopilot.night_digest` persona event per project per night (the
//!    webhook notifier delivers it to any matching `notification_subscriptions`
//!    row) + a desktop notification.
//!
//! ## The budget governor (hard PRE-dispatch)
//!
//! Before ANY session is spawned, the projected cost of the night's dispatch
//! is checked against the monthly USD ceiling (`monthly_cost_ceiling_usd`)
//! minus what the `dev_llm_spend` ledger says this month already cost. A
//! breach **refuses the dispatch and degrades the project `full` → `suggest`**
//! — durably, via the same `autopilot_mode:<pid>` setting the UI reads — and
//! says so loudly (tracing::warn + desktop notification + digest field).
//! Refuse-before-acting, never apologize after.
//!
//! ## What this deliberately is NOT
//!
//! No LLM planning, no guidance-answering (Night Shift / Athena's zone), no
//! Director verdict gate and no KPI loop (explicitly deferred). The v1 safety
//! story is branch-only writes + checkpoint-not-merge.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, State};
use ts_rs::TS;

use crate::db::repos::dev_tools as repo;
use crate::db::settings_keys;
use crate::db::DbPool;
use crate::engine::autopilot::{self, AutopilotMode, Capability};
use crate::error::AppError;
use crate::ipc_auth::{require_auth, require_auth_sync};
use crate::AppState;

use super::dev_tools::{dispatch_ideas_core, run_triage_rules_core};
use super::incremental_scan::{compute_delta, walk_project_files, ScanDelta};

// ============================================================================
// Tuning constants
// ============================================================================

/// Night window: [22:00, 06:00) local. Outside it the tick is a no-op.
const NIGHT_START_HOUR: u32 = 22;
const NIGHT_END_HOUR: u32 = 6;

/// Conservative projected cost per unattended fleet fix session, USD. Used
/// ONLY by the pre-dispatch governor (real spend lands in `dev_llm_spend`).
const EST_COST_PER_SESSION_USD: f64 = 1.5;

// The nightly caps and the capacity arithmetic live in
// `personas_engine::unattended` — pure, and therefore reachable by `cargo
// test` in a crate whose test binary actually launches. Re-exported here so
// every existing `overnight::dispatch_capacity` path resolves unchanged.
pub use personas_engine::unattended::dispatch_capacity;

/// Digest event type — matched by `notification_subscriptions` patterns
/// (`autopilot.*` or exact).
pub const NIGHT_DIGEST_EVENT_TYPE: &str = "autopilot.night_digest";

// ============================================================================
// Pure night-window / budget / capacity logic (unit-tested)
// ============================================================================

/// True when `hour` (local, 0-23) falls inside the night window.
pub fn in_night_window(hour: u32) -> bool {
    !(NIGHT_END_HOUR..NIGHT_START_HOUR).contains(&hour)
}

/// The identity of the night a local timestamp belongs to (`YYYY-MM-DD` of the
/// evening the night STARTED), or `None` outside the window. Hours before
/// 06:00 belong to the previous calendar day's night — that is what makes the
/// once-per-night ledger key stable across midnight.
pub fn night_key(local: chrono::NaiveDateTime) -> Option<String> {
    use chrono::Timelike;
    let hour = local.time().hour();
    if !in_night_window(hour) {
        return None;
    }
    let date = if hour < NIGHT_END_HOUR {
        local.date() - chrono::Duration::days(1)
    } else {
        local.date()
    };
    Some(date.format("%Y-%m-%d").to_string())
}

/// The budget governor's verdict. Pure — callers supply the three numbers.
#[derive(Debug, Clone, PartialEq)]
pub enum BudgetVerdict {
    /// Dispatch may proceed.
    Allow,
    /// Projected cost crosses the ceiling — refuse and degrade. Carries the
    /// overshoot in USD for the loud part.
    Block { overshoot_usd: f64 },
}

/// Hard pre-dispatch check: refuse when `month_spend + projected` crosses the
/// ceiling. `ceiling = None` (unset or `<= 0`) means no ceiling is configured
/// — dispatch is allowed (matching the app-wide "0 = no ceiling" convention).
pub fn budget_verdict(
    month_spend_usd: f64,
    ceiling_usd: Option<f64>,
    projected_usd: f64,
) -> BudgetVerdict {
    match ceiling_usd {
        None => BudgetVerdict::Allow,
        Some(ceiling) => {
            let after = month_spend_usd + projected_usd;
            if after > ceiling {
                BudgetVerdict::Block {
                    overshoot_usd: after - ceiling,
                }
            } else {
                BudgetVerdict::Allow
            }
        }
    }
}

// ============================================================================
// Ledger row (durable audit — the autonomy grammar's "audited" leg)
// ============================================================================

/// One project-night of the Overnight Portfolio Engine, as stored in
/// `autopilot_night_runs`. Also the morning-digest data shape.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct NightRun {
    pub id: String,
    pub project_id: String,
    /// `YYYY-MM-DD` of the evening the night started (manual runs append a
    /// `-manual-<hms>` suffix so they never collide with the nightly row).
    pub night: String,
    /// The autopilot mode the project had when the run started.
    pub mode: String,
    /// `running` | `done` | `failed`.
    pub status: String,
    pub scan_added: i64,
    pub scan_modified: i64,
    pub scan_deleted: i64,
    pub triage_applied: i64,
    pub ideas_accepted: i64,
    pub ideas_rejected: i64,
    pub dispatched_count: i64,
    pub skipped_count: i64,
    /// Why dispatch did not happen (budget breach, no free slots, mode without
    /// DispatchFixes, …). `None` when dispatch ran or nothing wanted it.
    pub blocked_reason: Option<String>,
    /// True when the budget governor degraded this project `full` → `suggest`.
    pub degraded: bool,
    pub projected_cost_usd: f64,
    pub month_spend_usd: f64,
    pub ceiling_usd: Option<f64>,
    /// JSON array of spawned fleet session ids (attribution — who acted).
    pub session_ids: Option<String>,
    pub started_at: String,
    pub finished_at: Option<String>,
}

fn row_to_night_run(r: &rusqlite::Row<'_>) -> rusqlite::Result<NightRun> {
    Ok(NightRun {
        id: r.get("id")?,
        project_id: r.get("project_id")?,
        night: r.get("night")?,
        mode: r.get("mode")?,
        status: r.get("status")?,
        scan_added: r.get("scan_added")?,
        scan_modified: r.get("scan_modified")?,
        scan_deleted: r.get("scan_deleted")?,
        triage_applied: r.get("triage_applied")?,
        ideas_accepted: r.get("ideas_accepted")?,
        ideas_rejected: r.get("ideas_rejected")?,
        dispatched_count: r.get("dispatched_count")?,
        skipped_count: r.get("skipped_count")?,
        blocked_reason: r.get("blocked_reason")?,
        degraded: r.get::<_, i64>("degraded")? != 0,
        projected_cost_usd: r.get("projected_cost_usd")?,
        month_spend_usd: r.get("month_spend_usd")?,
        ceiling_usd: r.get("ceiling_usd")?,
        session_ids: r.get("session_ids")?,
        started_at: r.get("started_at")?,
        finished_at: r.get("finished_at")?,
    })
}

/// Claim the (project, night) slot. Returns the new row id, or `None` when a
/// row already exists — the once-per-night dedupe (safe across concurrent
/// ticks because the UNIQUE constraint arbitrates).
fn claim_night_run(
    pool: &DbPool,
    project_id: &str,
    night: &str,
    mode: &str,
) -> Result<Option<String>, AppError> {
    let conn = pool.get()?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let changed = conn.execute(
        "INSERT OR IGNORE INTO autopilot_night_runs
           (id, project_id, night, mode, status, started_at)
         VALUES (?1, ?2, ?3, ?4, 'running', ?5)",
        rusqlite::params![id, project_id, night, mode, now],
    )?;
    Ok((changed > 0).then_some(id))
}

#[allow(clippy::too_many_arguments)]
fn finish_night_run(
    pool: &DbPool,
    run_id: &str,
    status: &str,
    scan: &ScanDelta,
    triage_applied: usize,
    ideas_accepted: usize,
    ideas_rejected: usize,
    dispatched: usize,
    skipped: usize,
    blocked_reason: Option<&str>,
    degraded: bool,
    projected_cost_usd: f64,
    month_spend_usd: f64,
    ceiling_usd: Option<f64>,
    session_ids: &[String],
) -> Result<(), AppError> {
    let conn = pool.get()?;
    let sessions_json = if session_ids.is_empty() {
        None
    } else {
        Some(serde_json::to_string(session_ids).unwrap_or_else(|_| "[]".into()))
    };
    conn.execute(
        "UPDATE autopilot_night_runs SET
           status = ?2, scan_added = ?3, scan_modified = ?4, scan_deleted = ?5,
           triage_applied = ?6, ideas_accepted = ?7, ideas_rejected = ?8,
           dispatched_count = ?9, skipped_count = ?10, blocked_reason = ?11,
           degraded = ?12, projected_cost_usd = ?13, month_spend_usd = ?14,
           ceiling_usd = ?15, session_ids = ?16, finished_at = ?17
         WHERE id = ?1",
        rusqlite::params![
            run_id,
            status,
            scan.added.len() as i64,
            scan.modified.len() as i64,
            scan.deleted.len() as i64,
            triage_applied as i64,
            ideas_accepted as i64,
            ideas_rejected as i64,
            dispatched as i64,
            skipped as i64,
            blocked_reason,
            degraded as i64,
            projected_cost_usd,
            month_spend_usd,
            ceiling_usd,
            sessions_json,
            chrono::Utc::now().to_rfc3339(),
        ],
    )?;
    Ok(())
}

fn get_night_run(pool: &DbPool, run_id: &str) -> Result<NightRun, AppError> {
    let conn = pool.get()?;
    conn.query_row(
        "SELECT * FROM autopilot_night_runs WHERE id = ?1",
        rusqlite::params![run_id],
        row_to_night_run,
    )
    .map_err(|_| AppError::NotFound(format!("NightRun {run_id}")))
}

// ============================================================================
// Budget inputs
// ============================================================================

/// Current-month spend from the `dev_llm_spend` ledger, USD. `datetime()`
/// normalizes the mixed 'T'/' ' timestamp formats (the recurring bug class).
fn month_spend_usd(pool: &DbPool) -> f64 {
    let Ok(conn) = pool.get() else { return 0.0 };
    conn.query_row(
        "SELECT COALESCE(SUM(cost_usd), 0.0) FROM dev_llm_spend
         WHERE datetime(created_at) >= datetime(strftime('%Y-%m-01 00:00:00', 'now'))",
        [],
        |r| r.get(0),
    )
    .unwrap_or(0.0)
}

/// The configured monthly USD ceiling; `None` when unset or `<= 0` (the
/// app-wide "0 = no ceiling" convention from `settings_keys`).
fn monthly_ceiling_usd(pool: &DbPool) -> Option<f64> {
    crate::db::repos::core::settings::get(pool, settings_keys::MONTHLY_COST_CEILING_USD)
        .ok()
        .flatten()
        .and_then(|v| v.trim().parse::<f64>().ok())
        .filter(|v| *v > 0.0)
}

/// Fleet sessions holding a live slot **against an unattended dispatch**.
///
/// This used to be "everything not `Exited`/`Hibernated`", borrowed from the
/// live-slot scheduler's notion of "live". That notion answers a different
/// question — *may I evict this to make room* — and its answer for
/// `AwaitingInput` is a deliberate **never**: a session a human may be
/// mid-answer on must not be slept. Reading that as "is doing live work" is
/// what refused an App-master dispatch on 2026-08-25 (bench sweep #18) with
/// "no free fleet live slots tonight" while the fleet was, in fact, idle: two
/// of the four slots were held by questions nobody was ever going to answer
/// (one of them days old, from another project), plus finished-but-not-exited
/// rows.
///
/// The eviction rule is untouched — production soft-cap semantics still hold
/// for everything else. Only the night's own arithmetic changed, per
/// [`personas_engine::unattended::holds_overnight_slot`]: `Running`/`Spawning`
/// occupy, an `AwaitingInput` older than the cutoff does not, and resting or
/// terminal rows never did real work to lose.
fn overnight_occupied_sessions() -> u64 {
    use crate::commands::fleet::types::state_to_token;
    let now = crate::commands::fleet::registry::now_ms();
    let cutoff_ms = crate::commands::fleet::stale::overnight_awaiting_cutoff_ms();
    let sessions = crate::commands::fleet::registry::registry().list_dto();
    personas_engine::unattended::overnight_live_occupancy(
        sessions.iter().map(|s| {
            (
                state_to_token(s.state),
                now.saturating_sub(s.last_activity_ms),
            )
        }),
        cutoff_ms,
    )
}

// ============================================================================
// The night run itself
// ============================================================================

struct NightRunTotals {
    run_id: String,
    dispatched: usize,
    blocked: bool,
    degraded: bool,
}

/// Write what a finished night taught the App master into the HOLDER's memory
/// (App master §8.2 — episodic capture).
///
/// Before this, the persona accumulated nothing across nights: a mandate
/// refusal or a budget cap was a log line and a ledger column, neither of which
/// the next night's prompt can read. The learned row is the night itself; the
/// constraint row (written only when a standing ceiling refused the dispatch)
/// is the one that stops tomorrow re-attempting a thing it was already refused.
///
/// Governance (registry memory-governance, stated in
/// [`personas_engine::app_master_memory`]'s module doc): these land in the
/// default working tier at importance 2–3 — **nothing here writes `core`**,
/// nothing writes a `preference` about a human, and nothing self-modifies a
/// rule. `batch_create` validates the category, dedups on normalized content
/// and reports per-row skips; the night key rides in the content precisely so
/// two consecutive nights are not collapsed as duplicates.
///
/// Best-effort and never fatal: the ledger row is the record of truth.
fn remember_night(
    pool: &DbPool,
    persona_id: &str,
    outcome: personas_engine::app_master_memory::NightOutcome<'_>,
) {
    let drafts = personas_engine::app_master_memory::night_memory_rows(&outcome);
    let inputs: Vec<crate::db::models::CreatePersonaMemoryInput> = drafts
        .into_iter()
        .map(|d| crate::db::models::CreatePersonaMemoryInput {
            persona_id: persona_id.to_string(),
            title: d.title,
            content: d.content,
            category: Some(d.category.to_string()),
            source_execution_id: None,
            importance: Some(d.importance),
            tags: Some(crate::db::models::Json(d.tags)),
            // Persona-wide, not capability-scoped: a night is about the app,
            // not about one use case the persona happens to hold.
            use_case_id: None,
        })
        .collect();
    match crate::db::repos::core::memories::batch_create(pool, inputs) {
        Ok(result) => {
            if !result.skipped.is_empty() {
                tracing::debug!(
                    persona_id,
                    inserted = result.inserted,
                    skipped = result.skipped.len(),
                    "overnight: some night memories were skipped (duplicate or invalid)"
                );
            }
        }
        Err(e) => tracing::warn!(
            persona_id, error = %e,
            "overnight: could not record the night in the App master's memory"
        ),
    }
}

/// Run one project's night: scan delta → triage rules → (maybe) dispatch →
/// ledger + digest. `night` is the ledger key (pre-claimed by the caller).
async fn run_project_night(
    pool: &DbPool,
    app: &AppHandle,
    project_id: &str,
    run_id: &str,
    mode: AutopilotMode,
) -> Result<NightRunTotals, AppError> {
    let project = repo::get_project_by_id(pool, project_id)?;

    // -- 1. Incremental scan delta (mechanical, zero tokens) -----------------
    let scan = {
        let root = PathBuf::from(&project.root_path);
        let cached: HashMap<String, String> =
            repo::get_file_hashes(pool, project_id).unwrap_or_default();
        tokio::task::spawn_blocking(move || -> ScanDelta {
            match walk_project_files(&root) {
                Ok(current) => compute_delta(&cached, &current),
                Err(e) => {
                    tracing::warn!(error = %e, "overnight: scan walk failed — recording empty delta");
                    compute_delta(&cached, &[])
                }
            }
        })
        .await
        .map_err(|e| AppError::Internal(format!("overnight scan join error: {e}")))?
    };

    // -- 1b. Retire finished authoring worktrees -----------------------------
    // Every unattended dispatch since sweep #23 authors in its own worktree
    // under the app data dir; without a sweeper they accumulate one working
    // copy per proposal forever. Merged ones, and old clean ones, are removed
    // here — before the night spawns more — and never their branches, which the
    // proposal ledger keys on. Best-effort: a night that cannot prune still
    // dispatches.
    if let Some(pruned) = super::dev_tools::prune_project_worktrees(app, &project).await {
        if !pruned.removed.is_empty() || !pruned.errors.is_empty() {
            tracing::info!(
                project_id,
                removed = pruned.removed.len(),
                kept = pruned.kept,
                errors = pruned.errors.len(),
                "overnight: authoring-worktree prune"
            );
        }
    }

    // -- 2. Mechanical triage rules ------------------------------------------
    let triage = run_triage_rules_core(pool, project_id)?;

    // -- 3. Budget-governed dispatch (full mode only) ------------------------
    let mut dispatched = 0usize;
    let mut skipped = 0usize;
    let mut session_ids: Vec<String> = Vec::new();
    // `{branch, path, sessionId}` per dispatched worker — the durable record of
    // where an unattended session authored, carried into the morning digest
    // event. The branch alone is repo-global and discoverable; the worktree
    // path is not, because it deliberately lives outside the checkout.
    let mut worktrees: Vec<serde_json::Value> = Vec::new();
    let mut blocked_reason: Option<String> = None;
    let mut degraded = false;
    let mut projected = 0.0f64;
    let month_spend = month_spend_usd(pool);
    let ceiling = monthly_ceiling_usd(pool);
    // The App master's OWN monthly budget (mandate `budget.monthlyUsd`), if the
    // project has a hire. First live tight-budget night (2026-08-25): a $5
    // mandate sailed straight past the governor because only the app-wide
    // ceiling was consulted — the ledger row showed `ceilingUsd: null` while
    // the project had $28 of month spend. The mandate ceiling is checked
    // against the HOLDER's settled month spend (per-persona rollup), never the
    // project aggregate — two ceilings, two denominators.
    // Read ONCE: the budget governor needs the ceiling, and the night's own
    // memory write-back needs the holder. Two reads of the same setting row
    // would be two chances to disagree about whether this project has a hire.
    let app_master_mandate = personas_engine::app_master::get_mandate(pool, project_id);
    let app_master_budget: Option<(String, f64)> = app_master_mandate.as_ref().and_then(|r| {
        r.budget_monthly_usd
            .filter(|b| *b > 0.0)
            .map(|b| (r.persona_id.clone(), b))
    });

    // App master mandate (P4) — the SECOND gate, independent of autopilot mode.
    // Dispatching authors a change, so it needs rung 2; a project whose App
    // master holds rung 0 or 1 is refused here even on `full` autopilot. The
    // refusal is typed and carries the owner to escalate to, so it lands in
    // `blocked_reason` as a sentence the operator can act on rather than as a
    // silent "0 dispatched" night.
    let mandate_refusal = personas_engine::autonomy::mandate_permits_for(
        pool,
        project_id,
        personas_engine::autonomy::Action::BacklogToGoal,
    )
    .err();

    if !triage.accepted_idea_ids.is_empty() {
        if let Some(refusal) = &mandate_refusal {
            blocked_reason = Some(format!(
                "{refusal} ({} accepted idea(s) left for the morning)",
                triage.accepted_idea_ids.len()
            ));
            tracing::warn!(
                project_id,
                "overnight: App master mandate refused dispatch: {refusal}"
            );
        } else if !mode.allows(Capability::DispatchFixes) {
            blocked_reason = Some(format!(
                "mode `{}` triages but does not dispatch ({} accepted idea(s) left for the morning)",
                mode.as_str(),
                triage.accepted_idea_ids.len()
            ));
        } else {
            let capacity = dispatch_capacity(
                crate::commands::fleet::stale::live_slot_cap(),
                overnight_occupied_sessions(),
                triage.accepted_idea_ids.len(),
            );
            if capacity == 0 {
                blocked_reason = Some("no free fleet live slots tonight".into());
            } else {
                projected = capacity as f64 * EST_COST_PER_SESSION_USD;
                let mandate_block = app_master_budget.as_ref().and_then(|(persona_id, budget)| {
                    let holder_spend = crate::db::repos::execution::executions::get_monthly_rollup(
                        pool, persona_id,
                    )
                    .map(|r| r.cost_usd)
                    .unwrap_or(0.0);
                    match budget_verdict(holder_spend, Some(*budget), projected) {
                        BudgetVerdict::Block { overshoot_usd } => {
                            Some((holder_spend, *budget, overshoot_usd))
                        }
                        _ => None,
                    }
                });
                if let Some((holder_spend, budget, overshoot_usd)) = mandate_block {
                    // Same degrade discipline as the app-wide ceiling below —
                    // HARD refusal + LOUD, durable full → suggest.
                    degraded = true;
                    let key = autopilot::setting_key(project_id);
                    if let Err(e) = crate::db::repos::core::settings::set(
                        pool,
                        &key,
                        AutopilotMode::Suggest.as_str(),
                    ) {
                        tracing::error!(error = %e, project_id, "overnight: failed to persist full→suggest degrade");
                    }
                    let msg = format!(
                        "App master budget refused tonight's dispatch for '{}': projected ${projected:.2}                          would cross the hire's monthly budget (${holder_spend:.2} settled by the holder,                          budget ${budget:.2}, overshoot ${overshoot_usd:.2}). Autopilot degraded full → suggest.",
                        project.name,
                    );
                    tracing::warn!(project_id, "overnight: {msg}");
                    crate::notifications::send(
                        app,
                        "Overnight engine: App master budget refused",
                        &msg,
                    );
                    blocked_reason = Some(msg);
                } else {
                    match budget_verdict(month_spend, ceiling, projected) {
                        BudgetVerdict::Block { overshoot_usd } => {
                            // HARD refusal + LOUD degrade full → suggest. Durable:
                            // the same setting the cockpit reads, so the UI shows it.
                            degraded = true;
                            let key = autopilot::setting_key(project_id);
                            if let Err(e) = crate::db::repos::core::settings::set(
                                pool,
                                &key,
                                AutopilotMode::Suggest.as_str(),
                            ) {
                                tracing::error!(error = %e, project_id, "overnight: failed to persist full→suggest degrade");
                            }
                            let msg = format!(
                            "Budget governor refused tonight's dispatch for '{}': projected ${projected:.2} \
                             would cross the monthly ceiling (${month_spend:.2} spent, ceiling ${:.2}, \
                             overshoot ${overshoot_usd:.2}). Autopilot degraded full → suggest.",
                            project.name,
                            ceiling.unwrap_or(0.0),
                        );
                            tracing::warn!(project_id, "overnight: {msg}");
                            crate::notifications::send(
                                app,
                                "Overnight engine: budget refused",
                                &msg,
                            );
                            blocked_reason = Some(msg);
                        }
                        BudgetVerdict::Allow => {
                            let ids: Vec<String> = triage
                                .accepted_idea_ids
                                .iter()
                                .take(capacity)
                                .cloned()
                                .collect();
                            // Tag every session this night spawns as machine-
                            // dispatched, using the run vocabulary the fleet
                            // already stamps at spawn (`run_id`/`run_label`,
                            // persisted with the row). That label is what lets the
                            // fleet sweeper finish an unanswered question instead
                            // of parking it forever — see
                            // `personas_engine::unattended::is_overnight_run`.
                            //
                            // The active run is process-global, so `begin_run`
                            // technically closes an operator's open run. At 03:00
                            // on an unattended tick there is nobody holding one,
                            // and `claim_run_for_spawn` would have opened an
                            // implicit run for this burst regardless — the only
                            // thing added is the label.
                            crate::commands::fleet::run::begin_run(Some(
                                personas_engine::unattended::overnight_run_label(&project.name),
                            ));
                            let outcome =
                                dispatch_ideas_core(pool, app, ids, "fleet", None, true).await;
                            crate::commands::fleet::run::end_run();
                            match outcome {
                                Ok(result) => {
                                    skipped = result.skipped.len();
                                    for d in &result.dispatched {
                                        if let Some(sid) = &d.session_id {
                                            session_ids.push(sid.clone());
                                        }
                                        // Where tonight's work is being
                                        // authored. The morning review needs
                                        // the path (the branch is repo-global
                                        // and the reconciler finds it either
                                        // way, but the working copy is not in
                                        // the checkout the operator is looking
                                        // at).
                                        if let (Some(branch), Some(path)) =
                                            (d.branch.clone(), d.worktree_path.clone())
                                        {
                                            worktrees.push(serde_json::json!({
                                                "branch": branch,
                                                "path": path,
                                                "sessionId": d.session_id,
                                            }));
                                            tracing::info!(
                                                project_id,
                                                branch = %branch,
                                                worktree = %path,
                                                "overnight: dispatched into an isolated authoring worktree"
                                            );
                                        }
                                    }
                                    dispatched = session_ids.len();
                                }
                                Err(e) => {
                                    blocked_reason = Some(format!("dispatch failed: {e}"));
                                    tracing::warn!(project_id, error = %e, "overnight: dispatch failed");
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // -- Ledger --------------------------------------------------------------
    finish_night_run(
        pool,
        run_id,
        "done",
        &scan,
        triage.applied,
        triage.accepted_idea_ids.len(),
        triage.rejected_count,
        dispatched,
        skipped,
        blocked_reason.as_deref(),
        degraded,
        projected,
        month_spend,
        // Effective ceiling for the ledger: the tighter of the app-wide
        // ceiling and the mandate budget, so the row never reads `null` while
        // a hire's budget was in force.
        match (ceiling, app_master_budget.as_ref().map(|(_, b)| *b)) {
            (Some(g), Some(m)) => Some(g.min(m)),
            (g, m) => g.or(m),
        },
        &session_ids,
    )?;

    // -- 3b. What tonight taught the holder (App master §8.2) ----------------
    //
    // Written from the FINAL ledger row, and only for a project that has a
    // hire: this is the persona's own experience, and there is no persona to
    // attribute it to otherwise. Best-effort — a night that cannot write its
    // memory is still a night that ran.
    let run = get_night_run(pool, run_id)?;
    if let Some(record) = app_master_mandate.as_ref() {
        remember_night(
            pool,
            &record.persona_id,
            personas_engine::app_master_memory::NightOutcome {
                project_name: &project.name,
                night: &run.night,
                dispatched,
                accepted: triage.accepted_idea_ids.len(),
                blocked_reason: blocked_reason.as_deref(),
                degraded,
                // Which standing refusal, if any, stopped tonight. Both are
                // operator-stated ceilings that do not move overnight, which is
                // exactly what makes them worth remembering: without this row
                // tomorrow's night re-attempts what it was already refused.
                refusal: if blocked_reason.is_some() && mandate_refusal.is_some() {
                    Some(personas_engine::app_master_memory::NightRefusal::Mandate)
                } else if degraded {
                    Some(personas_engine::app_master_memory::NightRefusal::Budget)
                } else {
                    None
                },
            },
        );
    }

    // -- 4. Morning digest (event → webhook notifier; + desktop toast) -------
    let payload = serde_json::json!({
        "runId": run.id,
        "night": run.night,
        "projectId": project_id,
        "projectName": project.name,
        "mode": run.mode,
        "scan": { "added": run.scan_added, "modified": run.scan_modified, "deleted": run.scan_deleted },
        "triage": { "rulesApplied": run.triage_applied, "accepted": run.ideas_accepted, "rejected": run.ideas_rejected },
        "dispatched": run.dispatched_count,
        "skipped": run.skipped_count,
        "blockedReason": run.blocked_reason,
        "degraded": run.degraded,
        "spend": { "monthUsd": run.month_spend_usd, "ceilingUsd": run.ceiling_usd, "projectedUsd": run.projected_cost_usd },
        "sessionIds": session_ids,
        "worktrees": worktrees,
    });
    if let Err(e) = crate::db::repos::communication::events::publish(
        pool,
        crate::db::models::CreatePersonaEventInput {
            event_type: NIGHT_DIGEST_EVENT_TYPE.to_string(),
            source_type: "autopilot".to_string(),
            project_id: Some(project_id.to_string()),
            source_id: Some(run.id.clone()),
            target_persona_id: None,
            payload: Some(payload.to_string()),
            use_case_id: None,
        },
    ) {
        tracing::warn!(error = %e, "overnight: failed to publish night digest event");
    }
    crate::notifications::send(
        app,
        "Overnight engine",
        &format!(
            "{}: {} dispatched, {} accepted, {} rejected{}",
            project.name,
            dispatched,
            triage.accepted_idea_ids.len(),
            triage.rejected_count,
            if blocked_reason.is_some() {
                " — dispatch blocked (see digest)"
            } else {
                ""
            },
        ),
    );

    Ok(NightRunTotals {
        run_id: run_id.to_string(),
        dispatched,
        blocked: blocked_reason.is_some(),
        degraded,
    })
}

// ============================================================================
// The subscription (registered in engine/background.rs)
// ============================================================================

/// Nightly per-project tick. Eligibility is EXPLICIT autopilot opt-in only
/// (`suggest`/`full` grant `ScanAndTriage`) — there is no legacy global flag
/// for the overnight loop, so the fallback `global` is hard-false: a project
/// no one switched on can never be worked on unattended.
pub struct OvernightEngineSubscription {
    pub pool: DbPool,
    pub app: AppHandle,
}

#[async_trait::async_trait]
impl crate::engine::subscription::ReactiveSubscription for OvernightEngineSubscription {
    fn name(&self) -> &'static str {
        "overnight_portfolio_engine"
    }
    fn interval(&self) -> Duration {
        Duration::from_secs(900)
    }
    // Night IS the idle period — do not slow down there.
    fn idle_interval(&self) -> Duration {
        Duration::from_secs(900)
    }
    fn initial_delay(&self) -> Duration {
        Duration::from_secs(300)
    }

    async fn tick(&self) {
        let modes = autopilot::load_modes(&self.pool);
        let eligible: Vec<(String, AutopilotMode)> = modes
            .into_iter()
            .filter(|(_, m)| m.allows(Capability::ScanAndTriage))
            .collect();
        if eligible.is_empty() {
            return;
        }
        let Some(night) = night_key(chrono::Local::now().naive_local()) else {
            return; // outside the night window
        };
        if crate::engine::subscription::quota_cooldown_active(&self.pool) {
            tracing::info!("overnight_portfolio_engine: quota cooldown active — skipping tick");
            return;
        }

        for (project_id, mode) in eligible {
            // Once per project per night — the UNIQUE(project_id, night) claim
            // arbitrates, so a crashed run does not re-fire until tomorrow
            // (deliberate: unattended retry loops are the cost failure mode).
            let claimed = match claim_night_run(&self.pool, &project_id, &night, mode.as_str()) {
                Ok(c) => c,
                Err(e) => {
                    tracing::warn!(project_id = %project_id, error = %e, "overnight: claim failed");
                    continue;
                }
            };
            let Some(run_id) = claimed else { continue };

            match run_project_night(&self.pool, &self.app, &project_id, &run_id, mode).await {
                Ok(t) => {
                    tracing::info!(
                        project_id = %project_id,
                        run_id = %t.run_id,
                        dispatched = t.dispatched,
                        blocked = t.blocked,
                        degraded = t.degraded,
                        "overnight: night run complete"
                    );
                }
                Err(e) => {
                    tracing::warn!(project_id = %project_id, error = %e, "overnight: night run failed");
                    let conn = self.pool.get().ok();
                    if let Some(conn) = conn {
                        let _ = conn.execute(
                            "UPDATE autopilot_night_runs SET status = 'failed', blocked_reason = ?2, finished_at = ?3 WHERE id = ?1",
                            rusqlite::params![run_id, e.to_string(), chrono::Utc::now().to_rfc3339()],
                        );
                    }
                }
            }
        }
    }
}

// ============================================================================
// Commands (AppError envelope)
// ============================================================================

/// Recent night runs, newest first — the morning-review read surface.
#[tauri::command]
pub fn dev_tools_list_night_runs(
    state: State<'_, Arc<AppState>>,
    project_id: Option<String>,
    limit: Option<i64>,
) -> Result<Vec<NightRun>, AppError> {
    require_auth_sync(&state)?;
    let limit = limit.unwrap_or(30).clamp(1, 200);
    let conn = state.db.get()?;
    let mut out = Vec::new();
    match project_id {
        Some(pid) => {
            let mut stmt = conn.prepare(
                "SELECT * FROM autopilot_night_runs WHERE project_id = ?1
                 ORDER BY started_at DESC LIMIT ?2",
            )?;
            let rows = stmt.query_map(rusqlite::params![pid, limit], row_to_night_run)?;
            for r in rows {
                out.push(r?);
            }
        }
        None => {
            let mut stmt = conn
                .prepare("SELECT * FROM autopilot_night_runs ORDER BY started_at DESC LIMIT ?1")?;
            let rows = stmt.query_map(rusqlite::params![limit], row_to_night_run)?;
            for r in rows {
                out.push(r?);
            }
        }
    }
    Ok(out)
}

/// Manually trigger one project's night run NOW (testing / demo). Bypasses
/// the night window and the once-per-night dedupe (unique manual key), but
/// honors everything that matters: capability gating, the budget governor,
/// slot caps, branch-only prompts, ledger + digest.
#[tauri::command]
pub async fn dev_tools_run_overnight_now(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    project_id: String,
) -> Result<NightRun, AppError> {
    require_auth(&state).await?;
    run_overnight_now_core(&state.db, &app, &project_id).await
}

/// The body of [`dev_tools_run_overnight_now`], without the IPC auth check and
/// without `AppState` — so a non-IPC caller can drive one night on demand.
///
/// The **only** thing the command adds over this is `require_auth`. Everything
/// that bounds a night run — the autopilot capability gate, the App master
/// mandate, the budget governor, the fleet slot cap, the branch-only dispatch
/// contract, the ledger row — lives inside `run_project_night` and applies
/// identically here. The headless bridge's tick endpoint
/// (`docs/architecture/cloud-integration-bridge.md` §13) calls this, so an
/// unattended loop cannot get a *different* night than a human would.
pub(crate) async fn run_overnight_now_core(
    pool: &DbPool,
    app: &AppHandle,
    project_id: &str,
) -> Result<NightRun, AppError> {
    let project_id = project_id.to_string();
    let modes = autopilot::load_modes(pool);
    let mode = modes
        .get(project_id.as_str())
        .copied()
        .unwrap_or(AutopilotMode::Off);
    if !mode.allows(Capability::ScanAndTriage) {
        return Err(AppError::Validation(format!(
            "project autopilot mode `{}` does not grant ScanAndTriage — set it to suggest or full first",
            mode.as_str()
        )));
    }
    let now = chrono::Local::now().naive_local();
    let key = format!("{}-manual-{}", now.format("%Y-%m-%d"), now.format("%H%M%S"));
    let run_id = claim_night_run(pool, &project_id, &key, mode.as_str())?
        .ok_or_else(|| AppError::Internal("could not claim a manual night-run slot".into()))?;
    run_project_night(pool, app, &project_id, &run_id, mode).await?;
    get_night_run(pool, &run_id)
}

/// Every project whose autopilot mode grants `ScanAndTriage` — the eligibility
/// the nightly subscription uses. Exposed so the headless tick can run "one
/// night for every eligible project" without inventing its own eligibility.
pub(crate) fn overnight_eligible_projects(pool: &DbPool) -> Vec<String> {
    autopilot::load_modes(pool)
        .into_iter()
        .filter(|(_, m)| m.allows(Capability::ScanAndTriage))
        .map(|(id, _)| id)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDate;

    fn at(y: i32, m: u32, d: u32, h: u32, min: u32) -> chrono::NaiveDateTime {
        NaiveDate::from_ymd_opt(y, m, d)
            .unwrap()
            .and_hms_opt(h, min, 0)
            .unwrap()
    }

    #[test]
    fn night_window_covers_22_to_06() {
        assert!(in_night_window(22));
        assert!(in_night_window(23));
        assert!(in_night_window(0));
        assert!(in_night_window(5));
        assert!(!in_night_window(6));
        assert!(!in_night_window(12));
        assert!(!in_night_window(21));
    }

    #[test]
    fn night_key_is_stable_across_midnight() {
        // 23:00 on the 15th and 02:00 on the 16th are the SAME night.
        assert_eq!(
            night_key(at(2026, 7, 15, 23, 0)).as_deref(),
            Some("2026-07-15")
        );
        assert_eq!(
            night_key(at(2026, 7, 16, 2, 0)).as_deref(),
            Some("2026-07-15")
        );
        // Daytime → no night.
        assert_eq!(night_key(at(2026, 7, 16, 12, 0)), None);
        // The next evening is a NEW night.
        assert_eq!(
            night_key(at(2026, 7, 16, 22, 30)).as_deref(),
            Some("2026-07-16")
        );
    }

    #[test]
    fn budget_verdict_refuses_before_acting() {
        // No ceiling configured → allowed (0-means-off convention).
        assert_eq!(budget_verdict(1000.0, None, 50.0), BudgetVerdict::Allow);
        // Under the ceiling → allowed.
        assert_eq!(budget_verdict(10.0, Some(100.0), 4.5), BudgetVerdict::Allow);
        // Exactly at the ceiling → still allowed (crossing, not reaching, blocks).
        assert_eq!(budget_verdict(95.5, Some(100.0), 4.5), BudgetVerdict::Allow);
        // Crossing → blocked with the overshoot.
        match budget_verdict(98.0, Some(100.0), 4.5) {
            BudgetVerdict::Block { overshoot_usd } => {
                assert!((overshoot_usd - 2.5).abs() < 1e-9);
            }
            BudgetVerdict::Allow => panic!("expected Block"),
        }
        // Already over budget → any projected dispatch is blocked.
        assert!(matches!(
            budget_verdict(150.0, Some(100.0), 1.5),
            BudgetVerdict::Block { .. }
        ));
    }

    /// The capacity arithmetic itself (including how a stale `awaiting_input`
    /// session stops holding a slot) is tested where it now lives and where a
    /// test binary actually launches: `personas_engine::unattended`.
    #[test]
    fn dispatch_capacity_reexport_still_resolves() {
        use personas_engine::unattended::{
            FALLBACK_NIGHT_LIVE_CAP, MAX_DISPATCH_PER_PROJECT_PER_NIGHT,
        };
        assert_eq!(dispatch_capacity(10, 9, 5), 1);
        assert_eq!(dispatch_capacity(0, FALLBACK_NIGHT_LIVE_CAP, 5), 0);
        assert_eq!(
            dispatch_capacity(100, 0, 50),
            MAX_DISPATCH_PER_PROJECT_PER_NIGHT
        );
    }
}
