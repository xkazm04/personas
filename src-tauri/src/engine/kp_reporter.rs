//! Outbound KP reporter — agent-candidate bridge, WP4 (final package).
//!
//! Personas hired through a KP hire request carry a typed
//! [`KpLink`](crate::db::models::KpLink) in `design_context.kpLink` (stamped by
//! the `kp_hire_request` approval executor, WP3). This module is the outbound
//! half: it pushes execution counters, monthly rollups, and lifecycle events to
//! `POST {base_url}/api/agents/report/{report_token}` on the KP app.
//!
//! Ground rules (shared with `approval_exec_core::notify_kp_lifecycle`):
//! - **Best-effort, always.** Every push is fire-and-forget or swallowed with a
//!   `tracing::warn` — a KP outage must never affect an execution, a promote,
//!   or a delete.
//! - **`crate::SHARED_HTTP`**, never `SSRF_SAFE_HTTP` — the KP app runs on
//!   localhost (precedent: `commands/tools/triggers.rs` webhook replay).
//! - **The URL embeds the report token (a capability): never log the URL or
//!   the token.** reqwest errors are logged via `without_url()` for the same
//!   reason.
//! - **Severed links.** ≥3 *consecutive* 404s from KP mean the token was
//!   revoked or the job is gone: stop reporting for that persona until app
//!   restart (in-memory registry). A 2xx resets the counter; transport errors
//!   and other statuses leave it unchanged (they prove nothing about the
//!   link).
//! - **Idempotency.** Per-execution events carry `Idempotency-Key:
//!   exec-<exec_id>` (KP dedupes durably on execId, so a double-fire is safe).
//!   Rollups carry no key: KP upserts a rollup by period, and re-sending the
//!   full current calendar month every tick is the self-healing design.
//!
//! The periodic [`KpReporterSubscription`] (300s tick) recomputes the current
//! calendar month per KP-linked persona with the same
//! `MONTHLY_SPEND_PREDICATE` discipline as `executions::get_monthly_spend`
//! (terminal statuses only, UTC month boundary, `_ops` chat excluded), so the
//! numbers KP shows always match the Personas budget UI — and it sweeps up the
//! accepted per-execution gaps (cancel/cloud/daemon/zombie terminal writes
//! don't push individually).

use std::collections::{BTreeMap, HashMap};
use std::sync::{LazyLock, Mutex as StdMutex};
use std::time::Duration;

use serde::Serialize;

use crate::db::models::KpLink;
use crate::db::repos::core::personas as persona_repo;
use crate::db::repos::execution::executions as exec_repo;
use crate::db::repos::execution::tool_usage as tool_usage_repo;
use crate::db::DbPool;

use super::subscription::ReactiveSubscription;

// ---------------------------------------------------------------------------
// Severed-link registry (consecutive-404 tracking)
// ---------------------------------------------------------------------------

/// Consecutive 404s after which a persona's KP link is considered severed.
const SEVER_THRESHOLD: u32 = 3;

/// Per-persona consecutive-404 counters. In-memory by design: a severed link
/// stays suppressed until app restart, at which point the next tick probes the
/// KP endpoint again (matching the wire contract's "stop reporting … until app
/// restart").
static CONSECUTIVE_404S: LazyLock<StdMutex<HashMap<String, u32>>> =
    LazyLock::new(|| StdMutex::new(HashMap::new()));

/// Is this persona's KP link severed (≥ [`SEVER_THRESHOLD`] consecutive 404s)?
pub(crate) fn is_severed(persona_id: &str) -> bool {
    CONSECUTIVE_404S
        .lock()
        .map(|m| m.get(persona_id).is_some_and(|c| *c >= SEVER_THRESHOLD))
        .unwrap_or(false)
}

/// Record a 2xx from KP: any consecutive-404 streak is broken.
fn record_success(persona_id: &str) {
    if let Ok(mut m) = CONSECUTIVE_404S.lock() {
        m.remove(persona_id);
    }
}

/// Record a 404 from KP. Returns `true` exactly when THIS call crossed the
/// sever threshold, so the caller can log the severing once (not every tick).
fn record_not_found(persona_id: &str) -> bool {
    let Ok(mut m) = CONSECUTIVE_404S.lock() else {
        return false;
    };
    let c = m.entry(persona_id.to_string()).or_insert(0);
    *c += 1;
    *c == SEVER_THRESHOLD
}

// ---------------------------------------------------------------------------
// Wire payloads (camelCase per the KP report contract)
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct KpConnectorUse {
    pub connector: String,
    pub calls: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct KpExecutionEvent<'a> {
    kind: &'static str,
    exec_id: &'a str,
    persona_id: &'a str,
    cost_usd: f64,
    tokens_in: i64,
    tokens_out: i64,
    status: &'a str,
    duration_ms: i64,
    connector_uses: Vec<KpConnectorUse>,
}

/// One objective's movement inside its window. `measured: false` means nobody
/// read the meter — a coverage gap, NOT a missed target and NOT a hit. kp's
/// `backbone_score()` refuses to read an unmeasured input as a good one, so
/// this flag is load-bearing on the far side, not decoration.
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct KpKpiDelta {
    pub kpi_key: String,
    pub baseline: Option<f64>,
    pub current: Option<f64>,
    pub target: Option<f64>,
    /// kp's vocabulary (`gte` / `lte`), not the Personas `up` / `down` — the
    /// mapping is undone here so kp never has to guess which side it is on.
    pub direction: &'static str,
    pub window_days: i64,
    pub measured: bool,
}

/// The App master extension of a rollup (P4, wire contract v2).
///
/// **Every field here is `Option` and every `None` is omitted from the wire.**
/// That is the whole design: kp's backbone treats an absent reading as a
/// coverage gap and a present `0` as a measurement, so a guessed zero would be
/// scored as a real, bad result. Where Personas has no ledger to read, it says
/// nothing rather than something convenient.
#[derive(Debug, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct KpAppMasterRollup {
    /// Unattended fix sessions dispatched for this project in the period. Each
    /// carries the branch-only guardrail contract (`autopilot/<slug>`, no push,
    /// no merge), so this is "proposals opened" as far as Personas can witness
    /// it: it counts sessions dispatched to author a branch, not branches
    /// confirmed to exist on a remote.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub proposals_opened: Option<i64>,
    /// Real since P5a: proposals observed on the project's main branch in the
    /// period, from the `app_master_proposals` ledger the reconciler
    /// (`engine::app_master_reconcile`) maintains. `merged_at` is set when
    /// `git merge-base --is-ancestor <branch> <main>` says the tip landed.
    ///
    /// `None` only when the project has **no proposal rows at all** — with no
    /// ledger there is nothing to be right about. Once one proposal exists a
    /// `0` is a real reading: work was authored and none of it landed.
    ///
    /// Under-reports a **squash** merge, which rewrites the commits and leaves
    /// no ancestor relationship. Stated rather than papered over: the error is
    /// in the direction of claiming less delivery, never more.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub proposals_merged: Option<i64>,
    /// Real since P5a: merged proposals later taken back, detected from the
    /// main branch's own log (`Revert "<subject>"` or `This reverts commit
    /// <sha>` naming one of the proposal's captured commits). Same `None`
    /// rule as `proposals_merged`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub proposals_reverted: Option<i64>,
    /// Real since P5a: passed / (passed + failed) over the runs of the
    /// repository's **own declared gate commands** against proposal branches
    /// in the period (`app_master_gate_runs`). The commands come from the App
    /// master mandate's `approvalGates` — kp's carrier for the dossier's
    /// `declaredGates` — and from nowhere else.
    ///
    /// A command that timed out or could not be spawned is recorded
    /// `did_not_run` and sits in **neither** half of the ratio. `None` when no
    /// gate command actually ran in the period — including the case where the
    /// mandate declares none, which is *not configured*, not a pass.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gate_pass_rate: Option<f64>,
    /// Real: a COUNT over `app_master.forbidden_class_violation` events for the
    /// project in the period. Zero here is a genuine reading — the ledger
    /// exists and was queried — not an absence.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub forbidden_class_violations: Option<i64>,
    /// Real: one entry per objective seeded at hire, read from the project's
    /// KPI rows.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kpi_deltas: Option<Vec<KpKpiDelta>>,
    /// Real: the overnight budget governor's pre-dispatch projection, summed
    /// over the period's night runs. That projection IS the reservation — it is
    /// taken before any session spawns and it is what the ceiling is checked
    /// against.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub budget_reserved_usd: Option<f64>,
    /// Real: the persona's settled month-to-date spend, the same number the
    /// Personas budget UI shows (`MONTHLY_SPEND_PREDICATE`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub budget_settled_usd: Option<f64>,
    /// True when the period has terminal runs but recorded **$0** — the
    /// subscription-auth case, where the engine genuinely cannot meter spend.
    /// A1/L3: an unmetered window is reported `unmeasured`, never as zero
    /// spend, because "it cost nothing" and "nobody was counting" are opposite
    /// findings that look identical in a number.
    pub budget_unmeasured: bool,
    /// Cross-ledger check (A3 · self-report honesty): every fleet session the
    /// night-run ledger claims to have dispatched should have a `dev_tasks` row
    /// written by the *other* writer on the dispatch path. `None` when the
    /// period recorded no dispatch at all — with nothing to compare, "true"
    /// would be a claim about an empty set dressed as a verification.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ledger_consistent: Option<bool>,
    /// Real: the project's current autopilot mode. `suggest` during probation.
    pub autopilot_mode: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct KpRollupEvent {
    kind: &'static str,
    period: String,
    runs: i64,
    successes: i64,
    failures: i64,
    cost_usd: f64,
    tokens_in: i64,
    tokens_out: i64,
    connector_uses: Vec<KpConnectorUse>,
    /// Flattened onto the rollup object so the v2 fields sit beside the v1
    /// ones exactly as the wire contract spells them. Absent entirely for a
    /// persona that is not an App master — the old shape, byte for byte.
    #[serde(flatten, skip_serializing_if = "Option::is_none")]
    app_master: Option<KpAppMasterRollup>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct KpLifecycleEvent<'a> {
    kind: &'static str,
    event: &'a str,
    persona_id: &'a str,
    persona_name: &'a str,
}

// ---------------------------------------------------------------------------
// The shared push core
// ---------------------------------------------------------------------------

/// POST one report event to the KP app and classify the response into the
/// severed-link registry (when `persona_id` is given).
///
/// This is THE single send path for every KP report push — the WP3 lifecycle
/// notifier (`approval_exec_core::notify_kp_lifecycle`) delegates here too.
/// SHARED_HTTP (localhost-capable), 5s timeout, warn-only failures; the URL
/// embeds the token and is never logged (`err.without_url()`).
pub(crate) async fn post_kp_report(
    base_url: &str,
    report_token: &str,
    body: &serde_json::Value,
    idempotency_key: Option<&str>,
    persona_id: Option<&str>,
    what: &'static str,
) {
    let url = format!(
        "{}/api/agents/report/{report_token}",
        base_url.trim_end_matches('/')
    );
    let mut req = crate::SHARED_HTTP
        .post(&url)
        .timeout(Duration::from_secs(5))
        .json(body);
    if let Some(key) = idempotency_key {
        req = req.header("Idempotency-Key", key);
    }
    match req.send().await {
        Ok(resp) if resp.status().is_success() => {
            if let Some(pid) = persona_id {
                record_success(pid);
            }
        }
        Ok(resp) if resp.status() == reqwest::StatusCode::NOT_FOUND => {
            if let Some(pid) = persona_id {
                if record_not_found(pid) {
                    tracing::warn!(
                        persona_id = %pid,
                        what,
                        "KP report link severed after {SEVER_THRESHOLD} consecutive 404s \
                         (token revoked or job gone); suppressing KP pushes for this \
                         persona until app restart"
                    );
                }
            }
        }
        Ok(resp) if resp.status() == reqwest::StatusCode::TOO_MANY_REQUESTS => {
            // Back off silently-ish; the next tick / execution retries.
            tracing::debug!(
                what,
                "KP report rate-limited (429); will retry on the next tick"
            );
        }
        Ok(resp) => {
            tracing::warn!(what, status = %resp.status(), "KP report push rejected by the KP app");
        }
        Err(e) => {
            // without_url(): a reqwest error Display can embed the request URL,
            // which carries the report token.
            tracing::warn!(what, error = %e.without_url(), "KP report push failed");
        }
    }
}

/// Fire-and-forget wrapper over [`post_kp_report`] for call sites on the hot
/// path (execution completion, promote, delete). Mirrors the WP3 idiom:
/// `tauri::async_runtime::spawn` + warn-on-failure inside.
fn spawn_kp_report(
    link: &KpLink,
    body: serde_json::Value,
    idempotency_key: Option<String>,
    persona_id: String,
    what: &'static str,
) {
    let base_url = link.base_url.clone();
    let token = link.report_token.clone();
    tauri::async_runtime::spawn(async move {
        post_kp_report(
            &base_url,
            &token,
            &body,
            idempotency_key.as_deref(),
            Some(&persona_id),
            what,
        )
        .await;
    });
}

// ---------------------------------------------------------------------------
// Hooks (execution completion / lifecycle)
// ---------------------------------------------------------------------------

/// Aggregate `persona_tool_usage` rows into deduped, name-sorted connector
/// counters (multiple `record` calls per tool sum up).
fn aggregate_connector_uses<I: IntoIterator<Item = (String, i64)>>(rows: I) -> Vec<KpConnectorUse> {
    let mut by_tool: BTreeMap<String, i64> = BTreeMap::new();
    for (tool, calls) in rows {
        *by_tool.entry(tool).or_insert(0) += calls;
    }
    by_tool
        .into_iter()
        .map(|(connector, calls)| KpConnectorUse { connector, calls })
        .collect()
}

/// Best-effort per-execution counters push, called from the engine's
/// `handle_execution_result` right after budget enforcement. No-op unless the
/// persona carries a `kp_link`; returns before any I/O for the overwhelmingly
/// common unlinked case (one persona row read).
///
/// `status` is the KP wire value: `"success"` or `"failure"` (the caller maps
/// the `ExecutionState` and skips Cancelled entirely).
#[allow(clippy::too_many_arguments)]
pub(crate) fn push_execution_event(
    pool: &DbPool,
    persona_id: &str,
    exec_id: &str,
    status: &'static str,
    cost_usd: f64,
    tokens_in: i64,
    tokens_out: i64,
    duration_ms: i64,
) {
    let Ok(persona) = persona_repo::get_by_id(pool, persona_id) else {
        return;
    };
    let Some(link) = persona.parsed_design_context().kp_link else {
        return;
    };
    if is_severed(persona_id) {
        return;
    }
    // Connector counters for this run, if the tool-usage writers populated any
    // (best-effort; an empty list is a valid payload).
    let connector_uses = aggregate_connector_uses(
        tool_usage_repo::get_by_execution(pool, exec_id)
            .unwrap_or_default()
            .into_iter()
            .map(|u| (u.tool_name, i64::from(u.invocation_count))),
    );
    let event = KpExecutionEvent {
        kind: "execution",
        exec_id,
        persona_id,
        cost_usd,
        tokens_in,
        tokens_out,
        status,
        duration_ms,
        connector_uses,
    };
    let Ok(body) = serde_json::to_value(&event) else {
        return;
    };
    spawn_kp_report(
        &link,
        body,
        Some(format!("exec-{exec_id}")),
        persona_id.to_string(),
        "execution",
    );
}

/// Best-effort lifecycle push (`activated` on promote, `retired` on delete)
/// for a persona whose `kp_link` the caller already holds.
pub(crate) fn push_lifecycle_event(
    link: &KpLink,
    event: &'static str,
    persona_id: &str,
    persona_name: &str,
) {
    if is_severed(persona_id) {
        return;
    }
    let payload = KpLifecycleEvent {
        kind: "lifecycle",
        event,
        persona_id,
        persona_name,
    };
    let Ok(body) = serde_json::to_value(&payload) else {
        return;
    };
    spawn_kp_report(link, body, None, persona_id.to_string(), event);
}

/// Push the App master probation verdict (wire contract v2:
/// `lifecycle` / `probation_review` with `{decision, note}`).
///
/// `decision` is kp's closed vocabulary — `activated` | `extended` | `retired`
/// — and is a `&'static str` so a call site cannot invent a fourth value that
/// kp would silently drop.
pub(crate) fn push_probation_review(
    link: &KpLink,
    persona_id: &str,
    persona_name: &str,
    decision: &'static str,
    note: &str,
) {
    debug_assert!(
        matches!(decision, "activated" | "extended" | "retired"),
        "probation_review decision outside kp's vocabulary: {decision}"
    );
    if is_severed(persona_id) {
        return;
    }
    let body = serde_json::json!({
        "kind": "lifecycle",
        "event": "probation_review",
        "personaId": persona_id,
        "personaName": persona_name,
        "decision": decision,
        "note": note,
    });
    spawn_kp_report(link, body, None, persona_id.to_string(), "probation_review");
}

// ---------------------------------------------------------------------------
// App master rollup extension (P4)
// ---------------------------------------------------------------------------

/// UTC start-of-month, RFC-3339 — the same boundary `MONTHLY_SPEND_PREDICATE`
/// uses, so the App master numbers and the v1 cost/run numbers cover exactly
/// the same window. Two periods in one payload would make every ratio kp
/// computes from them quietly wrong.
fn utc_month_start() -> String {
    let now = chrono::Utc::now();
    format!("{}-01T00:00:00+00:00", now.format("%Y-%m"))
}

/// Night-run aggregates for one project since `since`: dispatched sessions,
/// the governor's pre-dispatch reservation, and the recorded session ids (for
/// the cross-ledger check).
fn night_run_totals(
    pool: &DbPool,
    project_id: &str,
    since: &str,
) -> Option<(i64, f64, Vec<String>)> {
    let conn = pool.get().ok()?;
    let mut stmt = conn
        .prepare(
            "SELECT dispatched_count, projected_cost_usd, session_ids
             FROM autopilot_night_runs
             WHERE project_id = ?1 AND started_at >= ?2",
        )
        .ok()?;
    let rows = stmt
        .query_map(rusqlite::params![project_id, since], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, f64>(1)?,
                r.get::<_, Option<String>>(2)?,
            ))
        })
        .ok()?;
    let mut dispatched = 0i64;
    let mut reserved = 0.0f64;
    let mut sessions: Vec<String> = Vec::new();
    let mut any = false;
    for row in rows.flatten() {
        any = true;
        dispatched += row.0;
        reserved += row.1;
        if let Some(json) = row.2 {
            if let Ok(ids) = serde_json::from_str::<Vec<String>>(&json) {
                sessions.extend(ids);
            }
        }
    }
    any.then_some((dispatched, reserved, sessions))
}

/// Every session the night-run ledger claims to have dispatched should have a
/// `dev_tasks` row — written by a different function on the same path. `None`
/// when nothing was dispatched: there is no honest verdict on an empty set.
fn ledger_consistent(pool: &DbPool, sessions: &[String]) -> Option<bool> {
    if sessions.is_empty() {
        return None;
    }
    let conn = pool.get().ok()?;
    let mut stmt = conn
        .prepare("SELECT COUNT(*) FROM dev_tasks WHERE session_id = ?1")
        .ok()?;
    for sid in sessions {
        let n: i64 = stmt.query_row(rusqlite::params![sid], |r| r.get(0)).ok()?;
        if n == 0 {
            tracing::warn!(
                session_id = %sid,
                "kp_reporter: night-run ledger claims a dispatched session with no dev_tasks row"
            );
            return Some(false);
        }
    }
    Some(true)
}

/// Read the project's App-master-seeded KPIs back as `kpiDeltas`.
fn kpi_deltas(pool: &DbPool, project_id: &str) -> Vec<KpKpiDelta> {
    use crate::commands::companion::approvals::app_master_measure_config_kpi_key as kpi_key_of;

    crate::db::repos::dev_tools::list_kpis(pool, project_id, None)
        .unwrap_or_default()
        .into_iter()
        .filter_map(|k| {
            let key = kpi_key_of(&k.measure_config)?;
            let window_days = serde_json::from_str::<serde_json::Value>(&k.measure_config)
                .ok()
                .and_then(|v| v.pointer("/appMaster/windowDays")?.as_i64())
                .unwrap_or(30);
            Some(KpKpiDelta {
                kpi_key: key,
                baseline: k.baseline_value,
                current: k.current_value,
                target: k.target_value,
                // Undo the seed-time `gte→up` / `lte→down` mapping.
                direction: if k.direction == "down" { "lte" } else { "gte" },
                window_days,
                // A KPI is measured when a reading exists AND something recorded
                // when it was taken. A `current_value` with no `last_measured_at`
                // is a leftover, not a reading.
                measured: k.current_value.is_some() && k.last_measured_at.is_some(),
            })
        })
        .collect()
}

/// Compute the v2 App master block for `persona_id`, or `None` when the persona
/// is not an App master (the overwhelmingly common case: one design_context
/// parse and out).
pub(crate) fn app_master_rollup(
    pool: &DbPool,
    design_context: Option<&str>,
    monthly_runs: i64,
    monthly_cost_usd: f64,
) -> Option<KpAppMasterRollup> {
    let link = crate::db::models::parse_design_context(design_context).app_master?;
    let project_id = link.project_id;
    if project_id.trim().is_empty() {
        // A hire whose project binding failed. It is still an App master, and
        // saying so with everything unmeasured is more useful than silence.
        return Some(KpAppMasterRollup {
            budget_settled_usd: Some(monthly_cost_usd),
            budget_unmeasured: monthly_runs > 0 && monthly_cost_usd == 0.0,
            autopilot_mode: "off",
            ..Default::default()
        });
    }
    let since = utc_month_start();

    let (proposals_opened, budget_reserved_usd, sessions) =
        match night_run_totals(pool, &project_id, &since) {
            Some((d, r, s)) => (Some(d), Some(r), s),
            // No night run in the period: the engine has not run for this
            // project, so there is no reservation ledger to read. Not zero.
            None => (None, None, Vec::new()),
        };

    let autopilot_mode = crate::db::repos::core::settings::get(
        pool,
        &personas_engine::autopilot::setting_key(&project_id),
    )
    .ok()
    .flatten()
    .and_then(|v| personas_engine::autopilot::AutopilotMode::parse(&v))
    .map(|m| m.as_str())
    // No explicit row means the project follows the legacy global flags. `off`
    // is the honest floor to report: it is what the project grants with no
    // opt-in, and over-reporting the mode would over-claim the autonomy.
    .unwrap_or("off");

    // P5a: the two ledgers that closed the three structural nulls. Both hand
    // back `None` for "no record exists", never a convenient zero.
    let counts =
        personas_engine::app_master_gates::proposal_counts_since(pool, &project_id, &since);

    Some(KpAppMasterRollup {
        proposals_opened,
        proposals_merged: counts.map(|c| c.merged),
        proposals_reverted: counts.map(|c| c.reverted),
        gate_pass_rate: personas_engine::app_master_gates::gate_pass_rate_since(
            pool,
            &project_id,
            &since,
        ),
        forbidden_class_violations: personas_engine::app_master::count_violations_since(
            pool,
            &project_id,
            &since,
        ),
        kpi_deltas: Some(kpi_deltas(pool, &project_id)),
        budget_reserved_usd,
        budget_settled_usd: Some(monthly_cost_usd),
        budget_unmeasured: monthly_runs > 0 && monthly_cost_usd == 0.0,
        ledger_consistent: ledger_consistent(pool, &sessions),
        autopilot_mode,
    })
}

// ---------------------------------------------------------------------------
// Periodic rollup subscription
// ---------------------------------------------------------------------------

/// Periodic monthly-rollup reporter for KP-linked personas.
///
/// Every tick recomputes and re-sends the FULL current calendar month per
/// linked persona — KP upserts by period, so this is idempotent and
/// self-healing (it also covers the terminal paths that skip the
/// per-execution push: cancel, cloud, daemon, zombie sweeps).
pub struct KpReporterSubscription {
    pub pool: DbPool,
}

#[async_trait::async_trait]
impl ReactiveSubscription for KpReporterSubscription {
    fn name(&self) -> &'static str {
        "kp_reporter"
    }

    fn interval(&self) -> Duration {
        Duration::from_secs(300)
    }

    fn initial_delay(&self) -> Duration {
        // Let launch settle; the first rollup 2 min in is the startup catch-up.
        Duration::from_secs(120)
    }

    async fn tick(&self) {
        kp_rollup_tick(&self.pool).await;
    }
}

/// One rollup pass: find KP-linked personas, compute the current month, push.
///
/// Persona discovery: a SQL `LIKE '%"kpLink"%'` prefilter on the JSON column
/// (the typed field serializes camelCase on the wire), then a proper
/// `parse_design_context` on each hit — the LIKE only bounds the scan, the
/// typed parse decides.
async fn kp_rollup_tick(pool: &DbPool) {
    let _ = kp_rollup_tick_summary(pool, None).await;
}

/// What one rollup pass pushed. Returned so the headless bridge's on-demand
/// tick (`docs/architecture/cloud-integration-bridge.md` §13) can report the
/// push it actually made — including the pushes it *skipped*, which is the
/// difference between "kp has no numbers yet" and "kp was never told".
#[derive(Debug, Default, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RollupSummary {
    /// Personas carrying a `kpLink` that were considered.
    pub candidates: usize,
    /// Rollups posted to kp (fire-and-forget — a push is attempted, not
    /// confirmed; `post_kp_report` logs its own transport failures).
    pub pushed: usize,
    /// Considered but not pushed (severed link, unreadable rollup, a LIKE
    /// false-positive the typed parse rejected).
    pub skipped: usize,
    pub period: String,
    pub errors: Vec<String>,
}

/// [`kp_rollup_tick`], counted, and optionally scoped to one persona.
pub(crate) async fn kp_rollup_tick_summary(
    pool: &DbPool,
    only_persona: Option<&str>,
) -> RollupSummary {
    let mut summary = RollupSummary::default();
    let candidates: Vec<(String, Option<String>)> = {
        let conn = match pool.get() {
            Ok(c) => c,
            Err(e) => {
                tracing::warn!(error = %e, "kp_reporter: pool unavailable; skipping tick");
                summary.errors.push(format!("pool unavailable: {e}"));
                return summary;
            }
        };
        let mut stmt = match conn.prepare(
            "SELECT id, design_context FROM personas WHERE design_context LIKE '%\"kpLink\"%'",
        ) {
            Ok(s) => s,
            Err(e) => {
                tracing::warn!(error = %e, "kp_reporter: prefilter query failed; skipping tick");
                summary.errors.push(format!("prefilter query failed: {e}"));
                return summary;
            }
        };
        match stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .and_then(|rows| rows.collect::<Result<Vec<_>, _>>())
        {
            Ok(rows) => rows,
            Err(e) => {
                tracing::warn!(error = %e, "kp_reporter: prefilter scan failed; skipping tick");
                summary.errors.push(format!("prefilter scan failed: {e}"));
                return summary;
            }
        }
    };

    let period = chrono::Utc::now().format("%Y-%m").to_string();
    summary.period = period.clone();

    for (persona_id, design_context) in candidates {
        if only_persona.is_some_and(|want| want != persona_id) {
            continue;
        }
        summary.candidates += 1;
        let Some(link) = crate::db::models::parse_design_context(design_context.as_deref()).kp_link
        else {
            summary.skipped += 1;
            continue; // LIKE false-positive — the typed parse is authoritative.
        };
        if is_severed(&persona_id) {
            summary.skipped += 1;
            continue;
        }

        let rollup = match exec_repo::get_monthly_rollup(pool, &persona_id) {
            Ok(r) => r,
            Err(e) => {
                tracing::warn!(persona_id = %persona_id, error = %e, "kp_reporter: monthly rollup query failed");
                summary.skipped += 1;
                summary
                    .errors
                    .push(format!("{persona_id}: monthly rollup query failed: {e}"));
                continue;
            }
        };
        let connector_uses = aggregate_connector_uses(
            tool_usage_repo::get_monthly_totals_by_tool(pool, &persona_id).unwrap_or_default(),
        );

        let event = KpRollupEvent {
            kind: "rollup",
            period: period.clone(),
            runs: rollup.runs,
            successes: rollup.successes,
            failures: rollup.failures,
            cost_usd: rollup.cost_usd,
            tokens_in: rollup.tokens_in,
            tokens_out: rollup.tokens_out,
            connector_uses,
            app_master: app_master_rollup(
                pool,
                design_context.as_deref(),
                rollup.runs,
                rollup.cost_usd,
            ),
        };
        let Ok(body) = serde_json::to_value(&event) else {
            summary.skipped += 1;
            continue;
        };
        // No Idempotency-Key: a rollup is an authoritative upsert by period.
        post_kp_report(
            &link.base_url,
            &link.report_token,
            &body,
            None,
            Some(&persona_id),
            "rollup",
        )
        .await;
        summary.pushed += 1;
    }
    summary
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // -- payload serialization pins the KP wire contract exactly --------------

    #[test]
    fn execution_payload_matches_wire_contract() {
        let event = KpExecutionEvent {
            kind: "execution",
            exec_id: "exec-1",
            persona_id: "p-1",
            cost_usd: 0.12,
            tokens_in: 5200,
            tokens_out: 900,
            status: "success",
            duration_ms: 8300,
            connector_uses: vec![KpConnectorUse {
                connector: "gmail".into(),
                calls: 3,
            }],
        };
        assert_eq!(
            serde_json::to_value(&event).unwrap(),
            serde_json::json!({
                "kind": "execution",
                "execId": "exec-1",
                "personaId": "p-1",
                "costUsd": 0.12,
                "tokensIn": 5200,
                "tokensOut": 900,
                "status": "success",
                "durationMs": 8300,
                "connectorUses": [{"connector": "gmail", "calls": 3}],
            })
        );
    }

    #[test]
    fn rollup_payload_matches_wire_contract() {
        let event = KpRollupEvent {
            kind: "rollup",
            period: "2026-08".into(),
            runs: 41,
            successes: 39,
            failures: 2,
            cost_usd: 4.87,
            tokens_in: 210_000,
            tokens_out: 36_000,
            connector_uses: vec![],
            // v2 is additive: a non-App-master persona sends the v1 shape,
            // byte for byte, with no new keys at all.
            app_master: None,
        };
        assert_eq!(
            serde_json::to_value(&event).unwrap(),
            serde_json::json!({
                "kind": "rollup",
                "period": "2026-08",
                "runs": 41,
                "successes": 39,
                "failures": 2,
                "costUsd": 4.87,
                "tokensIn": 210000,
                "tokensOut": 36000,
                "connectorUses": [],
            })
        );
    }

    // -- App master rollup extension (wire contract v2) ------------------------

    #[test]
    fn app_master_rollup_payload_matches_wire_contract_v2() {
        let event = KpRollupEvent {
            kind: "rollup",
            period: "2026-08".into(),
            runs: 12,
            successes: 11,
            failures: 1,
            cost_usd: 3.5,
            tokens_in: 90_000,
            tokens_out: 12_000,
            connector_uses: vec![],
            app_master: Some(KpAppMasterRollup {
                proposals_opened: Some(7),
                // P5a: real readings now. A measured 0 must reach kp as a 0 —
                // it is the difference between "nothing landed" and "nobody
                // watched", and kp's backbone scores them differently.
                proposals_merged: Some(4),
                proposals_reverted: Some(0),
                gate_pass_rate: Some(0.75),
                forbidden_class_violations: Some(2),
                kpi_deltas: Some(vec![KpKpiDelta {
                    kpi_key: "gate_pass_rate".into(),
                    baseline: Some(0.82),
                    current: Some(0.9),
                    target: Some(0.95),
                    direction: "gte",
                    window_days: 30,
                    measured: true,
                }]),
                budget_reserved_usd: Some(6.0),
                budget_settled_usd: Some(3.5),
                budget_unmeasured: false,
                ledger_consistent: Some(true),
                autopilot_mode: "suggest",
            }),
        };
        assert_eq!(
            serde_json::to_value(&event).unwrap(),
            serde_json::json!({
                // v1 fields, unchanged and in place.
                "kind": "rollup",
                "period": "2026-08",
                "runs": 12,
                "successes": 11,
                "failures": 1,
                "costUsd": 3.5,
                "tokensIn": 90000,
                "tokensOut": 12000,
                "connectorUses": [],
                // v2 fields, FLATTENED onto the same object (not nested).
                "proposalsOpened": 7,
                "proposalsMerged": 4,
                "proposalsReverted": 0,
                "gatePassRate": 0.75,
                "forbiddenClassViolations": 2,
                "kpiDeltas": [{
                    "kpiKey": "gate_pass_rate",
                    "baseline": 0.82,
                    "current": 0.9,
                    "target": 0.95,
                    "direction": "gte",
                    "windowDays": 30,
                    "measured": true,
                }],
                "budgetReservedUsd": 6.0,
                "budgetSettledUsd": 3.5,
                "budgetUnmeasured": false,
                "ledgerConsistent": true,
                "autopilotMode": "suggest",
            })
        );
    }

    #[test]
    fn a_project_with_no_proposal_ledger_omits_the_three_p5a_fields() {
        // The other half of the P5a contract: real when there IS a record,
        // ABSENT when there is none. Never a zero standing in for silence.
        let v = serde_json::to_value(KpAppMasterRollup {
            proposals_opened: Some(3),
            proposals_merged: None,
            proposals_reverted: None,
            gate_pass_rate: None,
            budget_settled_usd: Some(1.0),
            autopilot_mode: "suggest",
            ..Default::default()
        })
        .unwrap();
        let obj = v.as_object().unwrap();
        for absent in ["proposalsMerged", "proposalsReverted", "gatePassRate"] {
            assert!(
                !obj.contains_key(absent),
                "{absent} must be omitted, got {v}"
            );
        }
        assert_eq!(obj.get("proposalsOpened"), Some(&serde_json::json!(3)));
    }

    #[test]
    fn a_measured_zero_is_sent_as_zero_not_omitted() {
        let v = serde_json::to_value(KpAppMasterRollup {
            proposals_opened: Some(3),
            proposals_merged: Some(0),
            proposals_reverted: Some(0),
            gate_pass_rate: Some(0.0),
            budget_settled_usd: Some(1.0),
            autopilot_mode: "suggest",
            ..Default::default()
        })
        .unwrap();
        let obj = v.as_object().unwrap();
        assert_eq!(obj.get("proposalsMerged"), Some(&serde_json::json!(0)));
        assert_eq!(obj.get("proposalsReverted"), Some(&serde_json::json!(0)));
        assert_eq!(obj.get("gatePassRate"), Some(&serde_json::json!(0.0)));
    }

    #[test]
    fn an_unmeasurable_field_is_omitted_and_never_sent_as_zero() {
        let v = serde_json::to_value(KpAppMasterRollup {
            proposals_opened: None,
            budget_settled_usd: Some(0.0),
            budget_unmeasured: true,
            autopilot_mode: "measure",
            ..Default::default()
        })
        .unwrap();
        let obj = v.as_object().unwrap();
        // Every optional field with no reading behind it must not appear at
        // all. An absent key is a coverage gap in kp's backbone; a `0` is a
        // measurement.
        for absent in [
            "proposalsOpened",
            "proposalsMerged",
            "proposalsReverted",
            "gatePassRate",
            "forbiddenClassViolations",
            "kpiDeltas",
            "budgetReservedUsd",
            "ledgerConsistent",
        ] {
            assert!(
                !obj.contains_key(absent),
                "{absent} must be omitted, got {v}"
            );
        }
        // $0 with runs recorded is `unmeasured`, not free.
        assert_eq!(obj.get("budgetSettledUsd"), Some(&serde_json::json!(0.0)));
        assert_eq!(obj.get("budgetUnmeasured"), Some(&serde_json::json!(true)));
        // These two are never optional: an App master always has a mode, and
        // "is the budget metered" always has an answer.
        assert!(obj.contains_key("autopilotMode"));
        assert!(obj.contains_key("budgetUnmeasured"));
    }

    #[test]
    fn an_unmeasured_kpi_is_not_a_missed_target() {
        let d = KpKpiDelta {
            kpi_key: "p95_build_s".into(),
            baseline: None,
            current: None,
            target: Some(120.0),
            direction: "lte",
            window_days: 14,
            measured: false,
        };
        let v = serde_json::to_value(&d).unwrap();
        // Nulls are SENT here (not omitted): kp's KpiDelta declares them
        // nullable, and an absent `current` would be indistinguishable from a
        // delta that was never included.
        assert_eq!(
            v,
            serde_json::json!({
                "kpiKey": "p95_build_s",
                "baseline": null,
                "current": null,
                "target": 120.0,
                "direction": "lte",
                "windowDays": 14,
                "measured": false,
            })
        );
    }

    #[test]
    fn lifecycle_payload_matches_wire_contract() {
        let event = KpLifecycleEvent {
            kind: "lifecycle",
            event: "activated",
            persona_id: "p-1",
            persona_name: "Invoice Chaser",
        };
        assert_eq!(
            serde_json::to_value(&event).unwrap(),
            serde_json::json!({
                "kind": "lifecycle",
                "event": "activated",
                "personaId": "p-1",
                "personaName": "Invoice Chaser",
            })
        );
    }

    // -- 404-severing state machine -------------------------------------------

    #[test]
    fn severing_takes_three_consecutive_404s_and_success_resets() {
        let pid = "sever-test-persona";
        assert!(!is_severed(pid));

        assert!(!record_not_found(pid)); // 1
        assert!(!record_not_found(pid)); // 2
        assert!(!is_severed(pid));

        // A success breaks the streak.
        record_success(pid);
        assert!(!record_not_found(pid)); // back to 1
        assert!(!is_severed(pid));

        assert!(!record_not_found(pid)); // 2
        assert!(record_not_found(pid)); // 3 — crossing returns true exactly once
        assert!(is_severed(pid));

        // Further 404s keep it severed but never re-report the crossing.
        assert!(!record_not_found(pid));
        assert!(is_severed(pid));

        // Cleanup so other tests never see this id as severed.
        record_success(pid);
        assert!(!is_severed(pid));
    }

    #[test]
    fn severing_is_per_persona() {
        let a = "sever-a";
        let b = "sever-b";
        record_not_found(a);
        record_not_found(a);
        record_not_found(a);
        assert!(is_severed(a));
        assert!(!is_severed(b));
        record_success(a);
    }

    // -- connector aggregation -------------------------------------------------

    #[test]
    fn connector_uses_aggregate_and_sort_by_name() {
        let uses = aggregate_connector_uses(vec![
            ("slack".to_string(), 1),
            ("gmail".to_string(), 3),
            ("gmail".to_string(), 2),
        ]);
        assert_eq!(
            uses,
            vec![
                KpConnectorUse {
                    connector: "gmail".into(),
                    calls: 5
                },
                KpConnectorUse {
                    connector: "slack".into(),
                    calls: 1
                },
            ]
        );
    }

    // -- no-kp_link personas: pinned no-op ------------------------------------

    #[tokio::test]
    async fn execution_push_is_a_no_op_without_kp_link() {
        let pool = crate::db::init_test_db().unwrap();
        let persona = crate::db::repos::core::personas::create(
            &pool,
            crate::db::models::CreatePersonaInput {
                name: "No KP Link".into(),
                system_prompt: "You are a test agent.".into(),
                project_id: None,
                description: None,
                structured_prompt: None,
                icon: None,
                color: None,
                enabled: Some(true),
                max_concurrent: None,
                timeout_ms: None,
                model_profile: None,
                max_budget_usd: None,
                max_turns: None,
                design_context: None,
                notification_channels: None,
                lifecycle: None,
            },
        )
        .unwrap();
        // Returns before any spawn/network (a spawn would panic here — no
        // tauri runtime in tests — so completing at all proves the early
        // return, i.e. zero behavior change for personas without kp_link).
        push_execution_event(&pool, &persona.id, "exec-x", "success", 0.1, 10, 5, 100);
        // Unknown persona: also a silent no-op.
        push_execution_event(&pool, "missing", "exec-x", "success", 0.1, 10, 5, 100);
    }
}
