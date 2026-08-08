//! Athena auditability — usage + health query commands (Phase A2 of
//! `docs/plans/athena-value-expansion.md`, direction 6).
//!
//! Reads the `companion_turn` ledger (written by `companion::turn_ledger`)
//! plus `companion_proactive_message` / `companion_proactive_budget` /
//! `companion_background_job` — all in the companion user DB — into two
//! dashboard payloads:
//!
//!   * `companion_get_usage_dashboard` → cost / turns / tokens over time and
//!     by action type (Overview → Activity "Athena lane", A3).
//!   * `companion_get_health` → triage funnel, proactive economy, job health
//!     (Overview → Observability "Athena health" panel, A4).
//!
//! Counts are typed `f64` (not `i64`) so the ts-rs bindings emit `number`
//! rather than `bigint` — matching the execution dashboard and keeping the
//! chart code free of bigint coercion. SQLite COUNT/SUM integers coerce to
//! f64 cleanly via rusqlite's `FromSql`.

use std::sync::Arc;

use serde::Serialize;
use tauri::State;
use ts_rs::TS;

use crate::error::AppError;
use crate::ipc_auth;
use crate::AppState;

// ── Usage dashboard ─────────────────────────────────────────────────────

#[derive(Debug, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct AthenaUsageDay {
    pub date: String,
    pub turns: f64,
    pub cost_usd: f64,
    pub input_tokens: f64,
    pub output_tokens: f64,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct AthenaOriginRollup {
    pub origin: String,
    pub trigger_kind: Option<String>,
    pub turns: f64,
    pub cost_usd: f64,
    pub avg_duration_ms: f64,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct AthenaUsageTotals {
    pub turns: f64,
    pub cost_usd: f64,
    pub input_tokens: f64,
    pub output_tokens: f64,
    pub avg_cost_per_turn: f64,
    pub voice_turns: f64,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct AthenaUsageDashboard {
    pub daily: Vec<AthenaUsageDay>,
    pub by_origin: Vec<AthenaOriginRollup>,
    pub totals: AthenaUsageTotals,
}

/// Usage rollup for the last `days` (clamped 1..=365). Cheap aggregation over
/// the indexed `companion_turn` table — no cache.
#[tauri::command]
pub fn companion_get_usage_dashboard(
    state: State<'_, Arc<AppState>>,
    days: u32,
) -> Result<AthenaUsageDashboard, AppError> {
    ipc_auth::require_auth_sync(&state)?;
    let days = days.clamp(1, 365);
    let modifier = format!("-{days} days");
    let conn = state.user_db.get()?;

    let daily = {
        let mut stmt = conn.prepare(
            "SELECT date(created_at) AS d,
                    COUNT(*) AS turns,
                    COALESCE(SUM(cost_usd), 0) AS cost,
                    COALESCE(SUM(input_tokens), 0) AS tin,
                    COALESCE(SUM(output_tokens), 0) AS tout
             FROM companion_turn
             WHERE created_at >= datetime('now', ?1)
             GROUP BY d
             ORDER BY d",
        )?;
        let rows = stmt.query_map([&modifier], |r| {
            Ok(AthenaUsageDay {
                date: r.get(0)?,
                turns: r.get(1)?,
                cost_usd: r.get(2)?,
                input_tokens: r.get(3)?,
                output_tokens: r.get(4)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>()?
    };

    let by_origin = {
        let mut stmt = conn.prepare(
            "SELECT origin, trigger_kind,
                    COUNT(*) AS turns,
                    COALESCE(SUM(cost_usd), 0) AS cost,
                    COALESCE(AVG(duration_ms), 0) AS avg_dur
             FROM companion_turn
             WHERE created_at >= datetime('now', ?1)
             GROUP BY origin, trigger_kind
             ORDER BY cost DESC",
        )?;
        let rows = stmt.query_map([&modifier], |r| {
            Ok(AthenaOriginRollup {
                origin: r.get(0)?,
                trigger_kind: r.get(1)?,
                turns: r.get(2)?,
                cost_usd: r.get(3)?,
                avg_duration_ms: r.get(4)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>()?
    };

    let totals = conn.query_row(
        "SELECT COUNT(*),
                COALESCE(SUM(cost_usd), 0),
                COALESCE(SUM(input_tokens), 0),
                COALESCE(SUM(output_tokens), 0),
                COALESCE(SUM(voice), 0)
         FROM companion_turn
         WHERE created_at >= datetime('now', ?1)",
        [&modifier],
        |r| {
            let turns: f64 = r.get(0)?;
            let cost: f64 = r.get(1)?;
            Ok(AthenaUsageTotals {
                turns,
                cost_usd: cost,
                input_tokens: r.get(2)?,
                output_tokens: r.get(3)?,
                avg_cost_per_turn: if turns > 0.0 { cost / turns } else { 0.0 },
                voice_turns: r.get(4)?,
            })
        },
    )?;

    Ok(AthenaUsageDashboard {
        daily,
        by_origin,
        totals,
    })
}

// ── Health ──────────────────────────────────────────────────────────────

#[derive(Debug, Default, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct AthenaTriageStats {
    /// Headless triage passes (exec_triage + msg_triage) in the window.
    pub passes: f64,
    pub parse_failures: f64,
    pub drop: f64,
    pub digest: f64,
    pub attention: f64,
    pub deep_dive: f64,
}

#[derive(Debug, Default, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct AthenaProactiveStats {
    /// Cards that ever surfaced (status != queued) in the window.
    pub delivered: f64,
    pub engaged: f64,
    pub dismissed: f64,
    pub expired: f64,
    pub budget_used_today: f64,
    pub budget_cap: f64,
}

#[derive(Debug, Default, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct AthenaJobStats {
    pub completed: f64,
    pub failed: f64,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct AthenaHealth {
    pub triage: AthenaTriageStats,
    pub proactive: AthenaProactiveStats,
    pub jobs: AthenaJobStats,
    /// companion_turn rows flagged `is_error` in the window.
    ///
    /// This was structurally 0 until failed turns were recorded at all: every
    /// error exit in `session::send_turn` returned before the ledger write, so
    /// the panel showed a flawless error rate no matter what actually
    /// happened. Read it together with `turns` — a bare count with no
    /// denominator is what made the old zero so easy to believe.
    pub errors: f64,
    /// Total companion_turn rows in the window — the denominator for `errors`.
    pub turns: f64,
}

/// Operational-quality snapshot for the last `days` (clamped 1..=365).
#[tauri::command]
pub fn companion_get_health(
    state: State<'_, Arc<AppState>>,
    days: u32,
) -> Result<AthenaHealth, AppError> {
    ipc_auth::require_auth_sync(&state)?;
    let days = days.clamp(1, 365);
    let modifier = format!("-{days} days");
    let conn = state.user_db.get()?;

    // Triage funnel — sum the verdict counts stored in each triage row's
    // outcome_json. Parsed in Rust (tolerant of shape drift) rather than via
    // json_extract; the row count is bounded by the window.
    let mut triage = AthenaTriageStats::default();
    {
        let mut stmt = conn.prepare(
            "SELECT outcome_json FROM companion_turn
             WHERE origin = 'headless'
               AND trigger_kind IN ('exec_triage', 'msg_triage')
               AND created_at >= datetime('now', ?1)",
        )?;
        let rows = stmt.query_map([&modifier], |r| r.get::<_, Option<String>>(0))?;
        for row in rows {
            triage.passes += 1.0;
            let Some(oj) = row? else { continue };
            let Ok(v) = serde_json::from_str::<serde_json::Value>(&oj) else {
                continue;
            };
            if v.get("parse_failure").and_then(|x| x.as_bool()).unwrap_or(false) {
                triage.parse_failures += 1.0;
            }
            let n = |key: &str| v.get(key).and_then(|x| x.as_i64()).unwrap_or(0) as f64;
            triage.drop += n("drop");
            triage.digest += n("digest");
            triage.attention += n("attention");
            triage.deep_dive += n("deep_dive");
        }
    }

    let mut proactive = conn.query_row(
        "SELECT
            COALESCE(SUM(CASE WHEN status != 'queued' THEN 1 ELSE 0 END), 0),
            COALESCE(SUM(CASE WHEN status = 'engaged'   THEN 1 ELSE 0 END), 0),
            COALESCE(SUM(CASE WHEN status = 'dismissed' THEN 1 ELSE 0 END), 0),
            COALESCE(SUM(CASE WHEN status = 'expired'   THEN 1 ELSE 0 END), 0)
         FROM companion_proactive_message
         WHERE created_at >= datetime('now', ?1)",
        [&modifier],
        |r| {
            Ok(AthenaProactiveStats {
                delivered: r.get(0)?,
                engaged: r.get(1)?,
                dismissed: r.get(2)?,
                expired: r.get(3)?,
                budget_used_today: 0.0,
                budget_cap: crate::companion::proactive::budget::GLOBAL_DAILY_CAP as f64,
            })
        },
    )?;
    proactive.budget_used_today = conn
        .query_row(
            "SELECT COALESCE(count, 0) FROM companion_proactive_budget WHERE date = date('now')",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0.0);

    let jobs = conn.query_row(
        "SELECT
            COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0),
            COALESCE(SUM(CASE WHEN status = 'failed'    THEN 1 ELSE 0 END), 0)
         FROM companion_background_job
         WHERE created_at >= datetime('now', ?1)",
        [&modifier],
        |r| {
            Ok(AthenaJobStats {
                completed: r.get(0)?,
                failed: r.get(1)?,
            })
        },
    )?;

    // Both halves of the error rate in one pass — the count is only readable
    // next to how many turns it is out of.
    let (errors, turns): (f64, f64) = conn.query_row(
        "SELECT COALESCE(SUM(is_error), 0), COUNT(*) FROM companion_turn
         WHERE created_at >= datetime('now', ?1)",
        [&modifier],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;

    Ok(AthenaHealth {
        triage,
        proactive,
        jobs,
        errors,
        turns,
    })
}

// ── Adaptations (F4 — "what Athena adapts") ──────────────────────────────

#[derive(Debug, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct AthenaAdaptation {
    pub kind: String,
    pub base_cap: f64,
    pub effective_cap: f64,
    pub engaged: f64,
    pub dismissed: f64,
}

/// The active engagement budget modulations (F4) — how Athena has adapted her
/// nudge frequency to the user's behavior. Empty when nothing's been adapted.
#[tauri::command]
pub fn companion_get_adaptations(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<AthenaAdaptation>, AppError> {
    ipc_auth::require_auth_sync(&state)?;
    Ok(
        crate::companion::proactive::budget::modulations_summary(&state.user_db)
            .into_iter()
            .map(|m| AthenaAdaptation {
                kind: m.kind,
                base_cap: m.base_cap as f64,
                effective_cap: m.effective_cap as f64,
                engaged: m.engaged as f64,
                dismissed: m.dismissed as f64,
            })
            .collect(),
    )
}

// ── Prompt-block size ledger ────────────────────────────────────────────

#[derive(Debug, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct AthenaPromptBlockStat {
    pub turn_id: String,
    pub origin: String,
    pub trigger_kind: Option<String>,
    pub created_at: String,
    /// Real `system_prompt.len()` for that turn.
    pub total_prompt_chars: f64,
    /// `{"constitution": 5123, "identity": 812, …}` — raw JSON, so a new
    /// block shows up here without a binding change.
    pub blocks_json: String,
}

/// The most recent per-block prompt size breakdowns, newest first.
///
/// The query surface for the size ledger `companion::prompt` writes on every
/// full turn (headless legs compose their own prompts and are skipped). No
/// panel consumes this yet — it exists so "which block grew?" is one IPC call
/// instead of an accidental discovery months later, which is exactly how the
/// ~30.6KB dev-mode context index was found.
#[tauri::command]
pub fn companion_prompt_block_stats(
    state: State<'_, Arc<AppState>>,
    limit: u32,
) -> Result<Vec<AthenaPromptBlockStat>, AppError> {
    ipc_auth::require_auth_sync(&state)?;
    let limit = limit.clamp(1, 200);
    let conn = state.user_db.get()?;
    let mut stmt = conn.prepare(
        "SELECT id, origin, trigger_kind, created_at,
                COALESCE(total_prompt_chars, 0), prompt_blocks_json
         FROM companion_turn
         WHERE prompt_blocks_json IS NOT NULL
         ORDER BY created_at DESC, rowid DESC
         LIMIT ?1",
    )?;
    let rows = stmt.query_map([limit], |r| {
        Ok(AthenaPromptBlockStat {
            turn_id: r.get(0)?,
            origin: r.get(1)?,
            trigger_kind: r.get(2)?,
            created_at: r.get(3)?,
            total_prompt_chars: r.get(4)?,
            blocks_json: r.get(5)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

// ── Unified spend rollup ────────────────────────────────────────────────
//
// "What does Athena cost per month" had no single answer, because Athena's
// spend was assumed to be split across two ledgers: `companion_turn` (the
// companion user DB) and `dev_llm_spend` (the app DB). Nothing unioned them.
//
// ## The audit (2026-08-08) — and what it actually found
//
// Grepping every `dev_llm_spend` writer in the tree turns up SIX distinct
// `source` tiers, and **not one of them is Athena**:
//
// | `source`     | write sites |
// |--------------|-------------|
// | `scanner`    | `infrastructure/idea_scanner.rs:807`, `kpi_scan.rs:759`, `standards_scan.rs:291`, `task_executor.rs:977`, `use_case_scan.rs:451`, `context_generation.rs:1304` |
// | `evaluator`  | `engine/genome_critique.rs:60`, `engine/src/auto_triage.rs:375`, `engine/src/eval.rs:652`, `engine/src/test_runner.rs:402` |
// | `design`     | `design/smart_search.rs:318`, `design/team_synthesis.rs:451`, `credentials/credential_design.rs:101` |
// | `kpi`        | `engine/kpi_binding.rs:488`, `engine/kpi_derivation.rs:319`, `infrastructure/kpi_compose.rs:476` |
// | `workspace`  | `infrastructure/workspace_divergence.rs:393`, `workspace_verify.rs:378` |
// | `image_gen`  | `core/persona_icon_gen.rs:68` |
//
// `grep -rn "llm_spend\|SpendCtx" src-tauri/src/companion/ src-tauri/src/commands/companion/`
// returns only two lines, both comments. Athena's headless legs do NOT land
// here: they all route through `athena_reaction::cli_text_tracked`, which
// writes `companion_turn` with `origin='headless'` (`athena_reaction.rs:480`;
// callers at `:406`, `:828`, `:1259`, `proactive/message_triage.rs:306`,
// `proactive/backlog_triage.rs:312`, `proactive/execution_review.rs:718`,
// `brain/profile_synthesis.rs:89`). The *untracked* `cli_text` variant has
// zero callers; `cli_text_with_usage` has two (`kpi_binding`,
// `kpi_derivation`) — engine KPI work that merely borrows Athena's CLI
// plumbing and is correctly metered as `source='kpi'`, NOT as Athena.
//
// So the honest allowlist below is **empty**, and this rollup returns only
// `companion_turn` rows today. That is the point: a rollup that summed the
// whole table would bill Athena for every idea scan and persona-lab eval on
// the machine, which is worse than no number. The union shape and the
// explicit `ledger` tag stay because they cost nothing and the moment an
// Athena path does meter into `dev_llm_spend`, it is one entry away.
//
// GAP CLOSED IN L1a (2026-08-08). `brain/oneshot.rs` — consolidation,
// reflection, recall synthesis, briefing, night-shift planner + unattended
// guidance, tours — used to spawn its own `claude -p`, collect only
// assistant-text deltas, and never parse the terminal `result` event, so its
// spend reached NEITHER ledger. It now parses `result` and writes
// `companion_turn` with `origin='maintenance'` and the leg name in
// `trigger_kind` (the pool is threaded through all seven call sites).
//
// Nothing below changed to accommodate it, and that was the point of choosing
// `companion_turn` over `dev_llm_spend`: this rollup groups by `origin`, so a
// new origin appears on its own. `maintenance_legs_reach_the_shipped_rollup_
// without_touching_it` is the proof, and it runs against the shipped
// (empty) `ATHENA_DEV_SPEND_SOURCES` so it cannot pass by fixture accident.

/// `dev_llm_spend.source` values attributable to Athena.
///
/// Empty as of the 2026-08-08 audit above — no companion code path writes that
/// table. Kept as a named const rather than inlined so the next Athena leg
/// that DOES meter there is one line, and so this list is a reviewable claim
/// instead of a buried SQL literal.
const ATHENA_DEV_SPEND_SOURCES: &[&str] = &[];

#[derive(Debug, Clone, Default, PartialEq, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct AthenaSpendRow {
    /// `YYYY-MM-DD`.
    pub day: String,
    /// `companion_turn.origin` (`chat` | `headless` | `autonomous` | …) for
    /// turn rows; `dev_llm_spend.trigger_kind` for dev-spend rows.
    pub origin: String,
    /// Which ledger the row came from: `turn` | `dev_spend`. Explicit rather
    /// than inferred, so a reader can never silently double-count a migration
    /// that moves a leg from one ledger to the other.
    pub ledger: String,
    pub cost_usd: f64,
    pub turn_count: f64,
}

/// Union both ledgers into per-day, per-origin spend rows.
///
/// Split from the command so it can be tested against two fixture databases
/// without a Tauri `State`. `athena_sources` is the `dev_llm_spend.source`
/// allowlist; an empty slice skips that ledger entirely (an empty SQL `IN ()`
/// is not valid).
///
/// Cost is `COALESCE(SUM(cost_usd), 0)` and the count is `COUNT(*)`: a turn
/// that failed before the CLI reported usage has a NULL cost but still
/// happened, and dropping it would quietly shrink the denominator of every
/// per-turn average built on this.
fn spend_rollup_rows(
    user_conn: &rusqlite::Connection,
    app_conn: &rusqlite::Connection,
    days: u32,
    athena_sources: &[&str],
) -> Result<Vec<AthenaSpendRow>, AppError> {
    let modifier = format!("-{days} days");
    let mut out: Vec<AthenaSpendRow> = Vec::new();

    {
        let mut stmt = user_conn.prepare(
            "SELECT date(created_at) AS d, origin,
                    COALESCE(SUM(cost_usd), 0), COUNT(*)
             FROM companion_turn
             WHERE created_at >= datetime('now', ?1)
             GROUP BY d, origin",
        )?;
        let rows = stmt.query_map([&modifier], |r| {
            Ok(AthenaSpendRow {
                day: r.get(0)?,
                origin: r.get(1)?,
                ledger: "turn".to_string(),
                cost_usd: r.get(2)?,
                turn_count: r.get(3)?,
            })
        })?;
        out.extend(rows.collect::<Result<Vec<_>, _>>()?);
    }

    if !athena_sources.is_empty() {
        let placeholders = (0..athena_sources.len())
            .map(|i| format!("?{}", i + 2))
            .collect::<Vec<_>>()
            .join(", ");
        let sql = format!(
            "SELECT date(created_at) AS d, trigger_kind,
                    COALESCE(SUM(cost_usd), 0), COUNT(*)
             FROM dev_llm_spend
             WHERE created_at >= datetime('now', ?1)
               AND source IN ({placeholders})
             GROUP BY d, trigger_kind"
        );
        let mut params: Vec<&dyn rusqlite::ToSql> = vec![&modifier];
        for s in athena_sources {
            params.push(s);
        }
        let mut stmt = app_conn.prepare(&sql)?;
        let rows = stmt.query_map(params.as_slice(), |r| {
            Ok(AthenaSpendRow {
                day: r.get(0)?,
                origin: r.get(1)?,
                ledger: "dev_spend".to_string(),
                cost_usd: r.get(2)?,
                turn_count: r.get(3)?,
            })
        })?;
        out.extend(rows.collect::<Result<Vec<_>, _>>()?);
    }

    // Newest day first, then a stable order within the day. Sorting here
    // rather than in SQL is what lets the two ledgers interleave correctly.
    out.sort_by(|a, b| {
        b.day
            .cmp(&a.day)
            .then(a.ledger.cmp(&b.ledger))
            .then(a.origin.cmp(&b.origin))
    });
    Ok(out)
}

/// Athena's total spend over the last `days`, per day and origin, with the
/// ledger each row came from stated explicitly.
///
/// This is the baseline every later longevity phase's savings claim is
/// measured against (`docs/plans/athena-longevity.md`, phase L0). Read the
/// module comment above for why the `dev_llm_spend` half is currently empty —
/// that is an audited finding, not an oversight.
#[tauri::command]
pub fn companion_get_spend_rollup(
    state: State<'_, Arc<AppState>>,
    days: u32,
) -> Result<Vec<AthenaSpendRow>, AppError> {
    ipc_auth::require_auth_sync(&state)?;
    let days = days.clamp(1, 365);
    let user_conn = state.user_db.get()?;
    let app_conn = state.db.get()?;
    spend_rollup_rows(&user_conn, &app_conn, days, ATHENA_DEV_SPEND_SOURCES)
}

#[cfg(test)]
mod spend_rollup_tests {
    use super::*;
    use rusqlite::Connection;

    fn user_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE companion_turn (
                id TEXT PRIMARY KEY, origin TEXT NOT NULL, cost_usd REAL,
                created_at TEXT NOT NULL
            );",
        )
        .unwrap();
        conn
    }

    fn app_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE dev_llm_spend (
                id TEXT PRIMARY KEY, source TEXT NOT NULL, trigger_kind TEXT NOT NULL,
                cost_usd REAL, created_at TEXT NOT NULL
            );",
        )
        .unwrap();
        conn
    }

    fn turn(conn: &Connection, id: &str, origin: &str, cost: Option<f64>, at: &str) {
        conn.execute(
            "INSERT INTO companion_turn (id, origin, cost_usd, created_at) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![id, origin, cost, at],
        )
        .unwrap();
    }

    fn spend(conn: &Connection, id: &str, source: &str, kind: &str, cost: f64, at: &str) {
        conn.execute(
            "INSERT INTO dev_llm_spend (id, source, trigger_kind, cost_usd, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![id, source, kind, cost, at],
        )
        .unwrap();
    }

    /// The union: rows from both ledgers, per-day totals correct on each side,
    /// and the ledger tag carried explicitly so the two can never be conflated.
    #[test]
    fn unions_both_ledgers_with_correct_per_day_totals() {
        let user = user_db();
        let app = app_db();
        let today = "-0 days";
        turn(&user, "t1", "chat", Some(1.50), &sql_now(today));
        turn(&user, "t2", "chat", Some(0.50), &sql_now(today));
        turn(&user, "t3", "headless", Some(0.06), &sql_now(today));
        spend(&app, "s1", "athena_test", "cycle", 0.25, &sql_now(today));
        spend(&app, "s2", "athena_test", "cycle", 0.75, &sql_now(today));

        let rows = spend_rollup_rows(&user, &app, 30, &["athena_test"]).unwrap();

        let chat = rows
            .iter()
            .find(|r| r.ledger == "turn" && r.origin == "chat")
            .expect("chat row");
        assert_eq!(chat.turn_count, 2.0);
        assert!((chat.cost_usd - 2.00).abs() < 1e-9);

        let headless = rows
            .iter()
            .find(|r| r.ledger == "turn" && r.origin == "headless")
            .expect("headless row");
        assert_eq!(headless.turn_count, 1.0);

        let dev = rows
            .iter()
            .find(|r| r.ledger == "dev_spend")
            .expect("dev_spend row — the union must reach the second ledger");
        assert_eq!(dev.origin, "cycle");
        assert_eq!(dev.turn_count, 2.0);
        assert!((dev.cost_usd - 1.00).abs() < 1e-9);
    }

    /// A rollup that summed the whole `dev_llm_spend` table would bill Athena
    /// for every idea scan and persona-lab eval on the machine. Only the
    /// allowlisted sources may cross over.
    #[test]
    fn foreign_dev_spend_sources_are_excluded() {
        let user = user_db();
        let app = app_db();
        spend(&app, "s1", "scanner", "idea_scan", 9.99, &sql_now("-0 days"));
        spend(&app, "s2", "evaluator", "eval_judge", 5.00, &sql_now("-0 days"));
        spend(&app, "s3", "athena_test", "cycle", 0.10, &sql_now("-0 days"));

        let rows = spend_rollup_rows(&user, &app, 30, &["athena_test"]).unwrap();
        assert_eq!(rows.len(), 1, "only the allowlisted source may cross over");
        assert_eq!(rows[0].origin, "cycle");
        assert!((rows[0].cost_usd - 0.10).abs() < 1e-9);
    }

    /// The shipped configuration. `ATHENA_DEV_SPEND_SOURCES` is empty (see the
    /// audit above), so the dev-spend lane contributes nothing and — crucially
    /// — an empty allowlist must not produce invalid SQL (`IN ()`).
    #[test]
    fn an_empty_allowlist_skips_the_dev_ledger_without_erroring() {
        let user = user_db();
        let app = app_db();
        turn(&user, "t1", "chat", Some(1.0), &sql_now("-0 days"));
        spend(&app, "s1", "scanner", "idea_scan", 9.99, &sql_now("-0 days"));

        let rows = spend_rollup_rows(&user, &app, 30, ATHENA_DEV_SPEND_SOURCES).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].ledger, "turn");
    }

    /// A turn that died before the CLI reported usage has a NULL cost. It
    /// still happened: dropping the row would shrink the denominator of every
    /// per-turn average built on this rollup, and the round-4 failure ledger
    /// exists precisely so failed turns stop being invisible.
    #[test]
    fn a_null_cost_turn_counts_as_a_zero_cost_row_not_a_missing_one() {
        let user = user_db();
        let app = app_db();
        turn(&user, "t1", "chat", Some(1.0), &sql_now("-0 days"));
        turn(&user, "t2", "chat", None, &sql_now("-0 days"));

        let rows = spend_rollup_rows(&user, &app, 30, &[]).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].turn_count, 2.0, "the failed turn must be counted");
        assert!((rows[0].cost_usd - 1.0).abs() < 1e-9);
    }

    /// The L1a maintenance legs (`brain::oneshot` — consolidation, reflection,
    /// briefing, night planner/guidance, tours) meter into `companion_turn`
    /// with `origin='maintenance'`, and this rollup groups by `origin`. So they
    /// surface here with **no change to any line of rollup code** — which is
    /// exactly why the Director chose `companion_turn` over `dev_llm_spend`
    /// (that lane would have needed an `ATHENA_DEV_SPEND_SOURCES` entry, a
    /// second write path, and a second definition of what a "turn" is).
    ///
    /// This test is the proof of that claim rather than an assertion of it: it
    /// runs against the SHIPPED `ATHENA_DEV_SPEND_SOURCES`, so if a future
    /// change ever makes `maintenance` conditional, it fails here.
    #[test]
    fn maintenance_legs_reach_the_shipped_rollup_without_touching_it() {
        let user = user_db();
        let app = app_db();
        let today = "-0 days";
        turn(&user, "t1", "chat", Some(1.50), &sql_now(today));
        turn(&user, "m1", "maintenance", Some(0.062), &sql_now(today));
        turn(&user, "m2", "maintenance", Some(0.041), &sql_now(today));
        // A failed leg: recorded, cost unknown. It must count, not vanish.
        turn(&user, "m3", "maintenance", None, &sql_now(today));

        let rows = spend_rollup_rows(&user, &app, 30, ATHENA_DEV_SPEND_SOURCES).unwrap();

        let maint = rows
            .iter()
            .find(|r| r.origin == "maintenance")
            .expect("the sleep cycle's own spend must be visible in the rollup");
        assert_eq!(maint.ledger, "turn");
        assert_eq!(maint.turn_count, 3.0, "the failed leg is still a leg");
        assert!((maint.cost_usd - 0.103).abs() < 1e-9);

        // And it stays a SEPARATE line from the headless/chat buckets — the
        // whole reason for a distinct origin is that the cycle's cost must be
        // readable on its own, not blended into 1,600 triage legs.
        let chat = rows.iter().find(|r| r.origin == "chat").expect("chat row");
        assert!((chat.cost_usd - 1.50).abs() < 1e-9);
    }

    /// The window is a real filter, not decoration.
    #[test]
    fn rows_outside_the_window_are_excluded_and_days_sort_newest_first() {
        let user = user_db();
        let app = app_db();
        turn(&user, "t1", "chat", Some(1.0), &sql_now("-0 days"));
        turn(&user, "t2", "chat", Some(2.0), &sql_now("-3 days"));
        turn(&user, "t3", "chat", Some(4.0), &sql_now("-90 days"));

        let rows = spend_rollup_rows(&user, &app, 7, &[]).unwrap();
        assert_eq!(rows.len(), 2, "the 90-day-old turn is outside a 7-day window");
        assert!(rows[0].day >= rows[1].day, "newest day first");
    }

    /// Resolve a SQLite datetime modifier (`"-0 days"`, `"-3 days"`, …) to the
    /// literal timestamp the fixtures store, so tests never depend on the
    /// host clock's formatting.
    fn sql_now(modifier: &str) -> String {
        let conn = Connection::open_in_memory().unwrap();
        conn.query_row("SELECT datetime('now', ?1)", [modifier], |r| r.get(0))
            .unwrap()
    }
}

// ── Prompt churn ────────────────────────────────────────────────────────
//
// The size ledger above answers "how big is each block". It cannot answer the
// question the cache bill asks. Athena's chat `cache_creation_tokens` climbed
// 239,852 → 305,401 turn over turn, which only happens when the prompt's
// stable prefix is not actually stable: a block above the volatile line is
// being rewritten and invalidating the cached prefix. A block can hold its
// char count to the byte and still churn (a reordered list, a re-rendered
// clock), so size is blind to exactly the failure that costs money.
//
// This lane reads the per-block content hashes `companion::prompt` writes
// beside the sizes and reports, per block, how often it changed. Phase L2 of
// `docs/plans/athena-longevity.md` reorders the prompt by volatility; this is
// the instrument that makes that reorder measurable rather than guessed —
// before/after on the same numbers.

#[derive(Debug, Clone, Default, PartialEq, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct AthenaPromptChurnBlock {
    /// Block name as `companion::prompt::compose` labels it.
    pub block: String,
    /// Turns in the window that carried this block at all. Less than the
    /// window size for a block introduced mid-window.
    pub turns_observed: f64,
    /// Times the block's hash differed from the previous turn that observed
    /// it. The first observation is a baseline, never a change — so the
    /// denominator for a change RATE is `turns_observed - 1`.
    pub changes: f64,
    /// Mean chars across the observed turns.
    pub avg_chars: f64,
    /// Chars on the most recent observed turn.
    pub last_chars: f64,
    /// The block's declared budget from `prompt::BLOCK_BUDGETS`, or null for
    /// a block that has none. A block that is both volatile and over budget
    /// is the worst case and now reads off one row.
    pub budget: Option<f64>,
}

/// One ledger row's prompt instrumentation, oldest-first when fed to
/// [`churn_from_turns`].
struct ChurnSample {
    blocks_json: String,
    hashes_json: String,
}

/// Fold chronologically-ordered turns into per-block churn stats.
///
/// Split from the command so the arithmetic is testable without a database or
/// a Tauri `State`. Rows whose JSON does not parse are skipped rather than
/// failing the call — an unparseable historical row must not blind the
/// instrument to the rows around it.
fn churn_from_turns(samples: &[ChurnSample]) -> Vec<AthenaPromptChurnBlock> {
    use std::collections::HashMap;

    struct Acc {
        observed: u64,
        changes: u64,
        sum_chars: u64,
        last_chars: u64,
        last_hash: Option<String>,
    }

    let mut acc: HashMap<String, Acc> = HashMap::new();

    for sample in samples {
        let sizes: serde_json::Map<String, serde_json::Value> =
            match serde_json::from_str(&sample.blocks_json) {
                Ok(m) => m,
                Err(_) => continue,
            };
        // Hashes are best-effort: every row written before the churn column
        // existed has sizes and no hashes. Those rows still contribute their
        // size statistics; they simply cannot report a change.
        let hashes: serde_json::Map<String, serde_json::Value> =
            serde_json::from_str(&sample.hashes_json).unwrap_or_default();

        for (name, chars) in &sizes {
            let chars = chars.as_u64().unwrap_or(0);
            let hash = hashes.get(name).and_then(|v| v.as_str()).map(str::to_string);
            let entry = acc.entry(name.clone()).or_insert_with(|| Acc {
                observed: 0,
                changes: 0,
                sum_chars: 0,
                last_chars: 0,
                last_hash: None,
            });
            // A change needs two hashes to compare. Two consecutive rows that
            // both lack one (pre-instrument history) are neither a change nor
            // evidence of stability — they are silence, and counting them as
            // "unchanged" would understate churn.
            if let (Some(prev), Some(cur)) = (entry.last_hash.as_deref(), hash.as_deref()) {
                if prev != cur {
                    entry.changes += 1;
                }
            }
            if hash.is_some() {
                entry.last_hash = hash;
            }
            entry.observed += 1;
            entry.sum_chars += chars;
            entry.last_chars = chars;
        }
    }

    let mut out: Vec<AthenaPromptChurnBlock> = acc
        .into_iter()
        .map(|(block, a)| AthenaPromptChurnBlock {
            turns_observed: a.observed as f64,
            changes: a.changes as f64,
            avg_chars: if a.observed > 0 {
                a.sum_chars as f64 / a.observed as f64
            } else {
                0.0
            },
            last_chars: a.last_chars as f64,
            budget: crate::companion::prompt::budget_for(&block).map(|b| b as f64),
            block,
        })
        .collect();
    // Most volatile first, then biggest — the read order for "what is costing
    // me cache". Stable tiebreak on name so the list does not shuffle between
    // calls (HashMap iteration order is not stable).
    out.sort_by(|a, b| {
        b.changes
            .partial_cmp(&a.changes)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(
                b.avg_chars
                    .partial_cmp(&a.avg_chars)
                    .unwrap_or(std::cmp::Ordering::Equal),
            )
            .then(a.block.cmp(&b.block))
    });
    out
}

/// Per-block prompt churn over the last `turns` tracked turns.
///
/// "Tracked" means a full assembled prompt — `prompt_blocks_json IS NOT NULL`,
/// the same predicate `companion_prompt_block_stats` uses. Headless legs
/// compose one-shot prompts and are correctly absent.
#[tauri::command]
pub fn companion_get_prompt_churn(
    state: State<'_, Arc<AppState>>,
    turns: u32,
) -> Result<Vec<AthenaPromptChurnBlock>, AppError> {
    ipc_auth::require_auth_sync(&state)?;
    let turns = turns.clamp(2, 500);
    let conn = state.user_db.get()?;
    let mut stmt = conn.prepare(
        "SELECT prompt_blocks_json, COALESCE(prompt_block_hashes_json, '{}')
         FROM companion_turn
         WHERE prompt_blocks_json IS NOT NULL
         ORDER BY created_at DESC, rowid DESC
         LIMIT ?1",
    )?;
    let rows = stmt.query_map([turns], |r| {
        Ok(ChurnSample {
            blocks_json: r.get(0)?,
            hashes_json: r.get(1)?,
        })
    })?;
    // The query is newest-first (that is how you take the last N); churn is a
    // walk forward in time, so reverse before folding.
    let mut samples = rows.collect::<Result<Vec<_>, _>>()?;
    samples.reverse();
    Ok(churn_from_turns(&samples))
}

#[cfg(test)]
mod churn_tests {
    use super::*;

    fn sample(blocks: &str, hashes: &str) -> ChurnSample {
        ChurnSample {
            blocks_json: blocks.into(),
            hashes_json: hashes.into(),
        }
    }

    fn find<'a>(v: &'a [AthenaPromptChurnBlock], name: &str) -> &'a AthenaPromptChurnBlock {
        v.iter()
            .find(|b| b.block == name)
            .unwrap_or_else(|| panic!("block {name} missing from {v:?}"))
    }

    /// The core claim: over a window where one block is rewritten every turn
    /// and another is byte-stable, the instrument separates them — even though
    /// BOTH hold a constant char count. Size alone cannot tell these apart,
    /// which is the entire reason the hash column exists.
    #[test]
    fn separates_a_churning_block_from_a_stable_one_of_identical_size() {
        let out = churn_from_turns(&[
            sample(
                r#"{"constitution":100,"observability":50}"#,
                r#"{"constitution":"aaaa","observability":"1111"}"#,
            ),
            sample(
                r#"{"constitution":100,"observability":50}"#,
                r#"{"constitution":"aaaa","observability":"2222"}"#,
            ),
            sample(
                r#"{"constitution":100,"observability":50}"#,
                r#"{"constitution":"aaaa","observability":"3333"}"#,
            ),
        ]);

        let constitution = find(&out, "constitution");
        assert_eq!(constitution.turns_observed, 3.0);
        assert_eq!(constitution.changes, 0.0, "stable block must not churn");
        assert_eq!(constitution.avg_chars, 100.0);
        assert_eq!(constitution.last_chars, 100.0);

        let observability = find(&out, "observability");
        assert_eq!(observability.turns_observed, 3.0);
        assert_eq!(
            observability.changes, 2.0,
            "3 observations with 3 distinct hashes = 2 transitions"
        );
        // Both blocks were a constant size the whole window — the size ledger
        // would have called them equally stable.
        assert_eq!(observability.avg_chars, 50.0);

        // Most volatile first.
        assert_eq!(out[0].block, "observability");
    }

    /// A block that appears partway through the window is observed fewer
    /// times than the window is long, and its first appearance is a baseline
    /// rather than a change. Reporting it as "changed on turn 1" would invent
    /// churn out of a block simply coming into existence.
    #[test]
    fn a_block_introduced_midwindow_counts_only_the_turns_it_appeared_in() {
        let out = churn_from_turns(&[
            sample(r#"{"constitution":10}"#, r#"{"constitution":"aaaa"}"#),
            sample(
                r#"{"constitution":10,"voice":7}"#,
                r#"{"constitution":"aaaa","voice":"bbbb"}"#,
            ),
            sample(
                r#"{"constitution":10,"voice":9}"#,
                r#"{"constitution":"aaaa","voice":"cccc"}"#,
            ),
        ]);
        let voice = find(&out, "voice");
        assert_eq!(voice.turns_observed, 2.0);
        assert_eq!(voice.changes, 1.0);
        assert_eq!(voice.avg_chars, 8.0);
        assert_eq!(voice.last_chars, 9.0);
    }

    /// Rows written before the hash column existed carry sizes and no hashes.
    /// They must still contribute size statistics, and must not be silently
    /// read as "unchanged" — a missing hash is silence, not stability.
    #[test]
    fn history_without_hashes_contributes_sizes_but_never_a_change() {
        let out = churn_from_turns(&[
            sample(r#"{"identity":30}"#, "{}"),
            sample(r#"{"identity":50}"#, "{}"),
            sample(r#"{"identity":70}"#, r#"{"identity":"aaaa"}"#),
            sample(r#"{"identity":90}"#, r#"{"identity":"bbbb"}"#),
        ]);
        let identity = find(&out, "identity");
        assert_eq!(identity.turns_observed, 4.0);
        assert_eq!(
            identity.changes, 1.0,
            "only the two hashed turns can be compared"
        );
        assert_eq!(identity.avg_chars, 60.0);
        assert_eq!(identity.last_chars, 90.0);
    }

    /// An unparseable historical row must not blind the instrument to the
    /// rows around it.
    #[test]
    fn a_corrupt_row_is_skipped_not_fatal() {
        let out = churn_from_turns(&[
            sample(r#"{"recall":10}"#, r#"{"recall":"aaaa"}"#),
            sample("not json", "also not json"),
            sample(r#"{"recall":20}"#, r#"{"recall":"bbbb"}"#),
        ]);
        let recall = find(&out, "recall");
        assert_eq!(recall.turns_observed, 2.0);
        assert_eq!(recall.changes, 1.0);
    }

    /// Budgets ride along so "volatile" and "oversized" read off one row.
    /// `constitution` has a declared budget; a name that isn't in
    /// `BLOCK_BUDGETS` reports null rather than a made-up number.
    #[test]
    fn budget_comes_from_the_prompt_modules_own_table() {
        let out = churn_from_turns(&[sample(
            r#"{"constitution":100,"not_a_real_block":5}"#,
            r#"{"constitution":"aaaa","not_a_real_block":"bbbb"}"#,
        )]);
        assert_eq!(find(&out, "constitution").budget, Some(24_000.0));
        assert_eq!(find(&out, "not_a_real_block").budget, None);
    }
}
