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
