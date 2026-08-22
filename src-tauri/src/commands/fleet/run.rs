//! Run harvest — "the fleet reports what it delivered".
//!
//! After every dispatch the operator (or the orchestrating agent) hand-compiled
//! the same report: each session's `FLEET:DONE` summary, the fleet-memory
//! lines, the per-area file counts. On 2026-07-24 that happened three times in
//! one day (16/16 delivered, 22 memory lines, 71 files). Every one of those
//! numbers already flows through the machine — this module groups sessions into
//! a RUN and aggregates what is already there.
//!
//! What it reuses rather than reinvents:
//! - **Grouping** rides the durable registry from the fleet-persistence lane:
//!   `fleet_sessions.run_id` / `run_label`, stamped once at spawn.
//! - **Outcomes** come from `registry::mark_finished`, which already parks a
//!   session in `Finished` with `state_reason = "Task complete: <summary>"`.
//! - **Stats** come from `transcript_read`'s incremental rollups — the same
//!   delta-read path the grid's token bar uses. No new polling, no new parser.

use serde::{Deserialize, Serialize};
use std::sync::{Mutex, OnceLock};
use ts_rs::TS;

use super::registry::now_ms;
use super::transcript_read::{FleetTokenTotals, FleetTranscriptSummary};

/// Spawns closer together than this belong to the same dispatch. Two minutes
/// comfortably covers a fan-out of a dozen sessions (each spawn is a process
/// start + an LLM naming call) while a session started later by hand clearly
/// reads as its own run.
pub const DISPATCH_WINDOW_MS: i64 = 2 * 60 * 1000;

/// Prefix `registry::mark_finished` writes into `state_reason`. The declared
/// `FLEET:DONE` summary is everything after it.
const FINISHED_PREFIX: &str = "Task complete: ";

struct ActiveRun {
    id: String,
    label: Option<String>,
    /// When the run's most recent spawn happened — the sliding window anchor.
    last_spawn_ms: i64,
    /// Explicitly opened via [`begin_run`]; survives the dispatch window until
    /// [`end_run`] (or a long idle) closes it.
    explicit: bool,
}

fn active() -> &'static Mutex<Option<ActiveRun>> {
    static ACTIVE: OnceLock<Mutex<Option<ActiveRun>>> = OnceLock::new();
    ACTIVE.get_or_init(|| Mutex::new(None))
}

/// An explicit run stays open this long without a spawn before it lapses, so a
/// forgotten `fleet_begin_run` can't swallow tomorrow's work.
const EXPLICIT_RUN_IDLE_MS: i64 = 60 * 60 * 1000;

/// Claim the run a spawn happening *now* belongs to, extending the window.
///
/// Called from the two spawn paths. Returns `(run_id, run_label)` — always
/// `Some` for the id: every session belongs to some run, even a run of one.
/// The UI calls a run with no label "ad hoc".
pub fn claim_run_for_spawn() -> (Option<String>, Option<String>) {
    let now = now_ms();
    let mut guard = active().lock().unwrap_or_else(|e| e.into_inner());
    let stale = match guard.as_ref() {
        None => true,
        Some(r) if r.explicit => now - r.last_spawn_ms > EXPLICIT_RUN_IDLE_MS,
        Some(r) => now - r.last_spawn_ms > DISPATCH_WINDOW_MS,
    };
    if stale {
        *guard = Some(ActiveRun {
            id: uuid::Uuid::new_v4().to_string(),
            label: None,
            last_spawn_ms: now,
            explicit: false,
        });
    } else if let Some(r) = guard.as_mut() {
        r.last_spawn_ms = now;
    }
    let r = guard.as_ref().expect("just populated");
    (Some(r.id.clone()), r.label.clone())
}

/// Open a named run — every subsequent spawn joins it until [`end_run`].
pub fn begin_run(label: Option<String>) -> String {
    let id = uuid::Uuid::new_v4().to_string();
    let mut guard = active().lock().unwrap_or_else(|e| e.into_inner());
    *guard = Some(ActiveRun {
        id: id.clone(),
        label: label.filter(|l| !l.trim().is_empty()),
        last_spawn_ms: now_ms(),
        explicit: true,
    });
    id
}

/// Close the active run; the next spawn opens a fresh implicit one.
pub fn end_run() {
    let mut guard = active().lock().unwrap_or_else(|e| e.into_inner());
    *guard = None;
}

/// One session's contribution to a run report.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct FleetRunSession {
    pub session_id: String,
    pub claude_session_id: String,
    /// Best available human label — the session's title, else its name, else
    /// the project it ran in.
    pub label: String,
    pub project_label: String,
    /// State token at harvest time (`finished`, `exited`, `stale`, …).
    pub state: String,
    /// The declared `FLEET:DONE` summary, when the session finished. `None`
    /// for sessions that never declared completion.
    pub summary: Option<String>,
    pub tokens: FleetTokenTotals,
    /// Distinct files the session edited/wrote (per the transcript rollup).
    pub files_touched: i32,
    pub user_messages: i32,
    pub assistant_messages: i32,
    pub created_at_ms: i64,
    pub last_activity_ms: i64,
}

/// Fleet-level totals for one run.
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct FleetRunTotals {
    pub session_count: i32,
    /// Sessions that declared `FLEET:DONE`.
    pub finished_count: i32,
    /// Sessions still live (anything not finished and not exited).
    pub active_count: i32,
    pub exited_count: i32,
    pub tokens: FleetTokenTotals,
    /// Distinct files across the whole run (deduped, not summed).
    pub files_touched: i32,
}

/// A whole run, ready to render or export.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct FleetRunReport {
    pub run_id: String,
    pub run_label: Option<String>,
    /// Earliest spawn in the run.
    pub started_at_ms: i64,
    pub sessions: Vec<FleetRunSession>,
    pub totals: FleetRunTotals,
}

/// Compact run entry for the run picker.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct FleetRunSummary {
    pub run_id: String,
    pub run_label: Option<String>,
    pub started_at_ms: i64,
    pub session_count: i32,
    pub finished_count: i32,
}

/// Pull the declared summary out of a `Finished` row's `state_reason`.
/// `None` for any other reason text — we only report what a session actually
/// declared, never a paraphrase of its last state.
pub fn summary_from_reason(state: &str, reason: Option<&str>) -> Option<String> {
    if state != "finished" {
        return None;
    }
    let reason = reason?;
    // The persistence lane appends a restore marker on rehydrated rows; the
    // declaration is still the leading part.
    let body = reason.strip_prefix(FINISHED_PREFIX)?;
    let body = body
        .split(" · restored after restart")
        .next()
        .unwrap_or(body)
        .trim();
    (!body.is_empty()).then(|| body.to_string())
}

/// Fold rows + their transcript rollups into a report. Pure — the IO
/// (DB read, transcript delta reads) happens in the command, so the shaping
/// rules are unit-testable.
pub fn build_report(
    run_id: &str,
    run_label: Option<String>,
    rows: &[crate::db::repos::fleet_sessions::FleetSessionRow],
    summaries: &std::collections::HashMap<String, FleetTranscriptSummary>,
) -> FleetRunReport {
    let mut sessions: Vec<FleetRunSession> = Vec::new();
    let mut totals = FleetRunTotals::default();
    let mut all_files: std::collections::HashSet<String> = std::collections::HashSet::new();

    for row in rows {
        let rollup = summaries.get(&row.claude_session_id);
        let files: Vec<String> = rollup.map(|s| s.files_touched.clone()).unwrap_or_default();
        for f in &files {
            all_files.insert(f.clone());
        }
        let tokens = rollup.map(|s| s.tokens.clone()).unwrap_or_default();
        totals.session_count += 1;
        match row.state.as_str() {
            "finished" => totals.finished_count += 1,
            "exited" => totals.exited_count += 1,
            _ => totals.active_count += 1,
        }
        totals.tokens.input += tokens.input;
        totals.tokens.output += tokens.output;
        totals.tokens.cache_creation += tokens.cache_creation;
        totals.tokens.cache_read += tokens.cache_read;

        sessions.push(FleetRunSession {
            session_id: row.id.clone(),
            claude_session_id: row.claude_session_id.clone(),
            label: row
                .title
                .clone()
                .or_else(|| row.name.clone())
                .unwrap_or_else(|| row.project_label.clone()),
            project_label: row.project_label.clone(),
            state: row.state.clone(),
            summary: summary_from_reason(&row.state, row.state_reason.as_deref()),
            tokens,
            files_touched: files.len() as i32,
            user_messages: rollup.map(|s| s.user_messages).unwrap_or(0),
            assistant_messages: rollup.map(|s| s.assistant_messages).unwrap_or(0),
            created_at_ms: row.created_at_ms,
            last_activity_ms: row.last_activity_ms,
        });
    }
    totals.files_touched = all_files.len() as i32;
    sessions.sort_by_key(|s| s.created_at_ms);
    let started_at_ms = sessions.first().map(|s| s.created_at_ms).unwrap_or(0);

    FleetRunReport {
        run_id: run_id.to_string(),
        run_label,
        started_at_ms,
        sessions,
        totals,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::repos::fleet_sessions::FleetSessionRow;
    use std::collections::HashMap;

    fn row(id: &str, state: &str, reason: Option<&str>, created: i64) -> FleetSessionRow {
        FleetSessionRow {
            id: id.to_string(),
            claude_session_id: format!("cc-{id}"),
            cwd: "C:/repo".into(),
            project_label: "repo".into(),
            name: None,
            title: Some(format!("task {id}")),
            args_json: "[]".into(),
            mode: "interactive".into(),
            state: state.into(),
            state_reason: reason.map(str::to_string),
            run_id: Some("run-1".into()),
            run_label: None,
            created_at_ms: created,
            last_activity_ms: created + 1000,
        }
    }

    #[test]
    fn only_finished_rows_yield_a_declared_summary() {
        assert_eq!(
            summary_from_reason("finished", Some("Task complete: shipped the parser")),
            Some("shipped the parser".to_string())
        );
        // A restored row keeps its declaration despite the persistence marker.
        assert_eq!(
            summary_from_reason(
                "finished",
                Some("Task complete: shipped the parser · restored after restart")
            ),
            Some("shipped the parser".to_string())
        );
        // Never invent an outcome from a non-declaration.
        assert_eq!(summary_from_reason("stale", Some("No log growth")), None);
        assert_eq!(summary_from_reason("finished", Some("Stop hook")), None);
        assert_eq!(summary_from_reason("finished", None), None);
    }

    #[test]
    fn report_counts_outcomes_and_dedupes_files() {
        let rows = vec![
            row("a", "finished", Some("Task complete: did A"), 100),
            row("b", "exited", None, 200),
            row("c", "stale", Some("No log growth"), 50),
        ];
        let mut summaries = HashMap::new();
        for (id, files, inp, out) in [
            ("cc-a", vec!["x.rs", "y.rs"], 10, 5),
            ("cc-b", vec!["y.rs"], 3, 1),
        ] {
            let mut s = FleetTranscriptSummary {
                claude_session_id: id.into(),
                path: String::new(),
                cwd: None,
                user_messages: 1,
                assistant_messages: 2,
                tokens: FleetTokenTotals {
                    input: inp,
                    output: out,
                    cache_creation: 0,
                    cache_read: 0,
                },
                last_context_tokens: 0,
                models: vec![],
                tools: vec![],
                bg_procs_launched: 0,
                files_touched: files.into_iter().map(String::from).collect(),
                first_timestamp: None,
                last_timestamp: None,
                parse_errors: 0,
                total_lines: 0,
            };
            s.files_touched.sort();
            summaries.insert(id.to_string(), s);
        }
        let rep = build_report("run-1", Some("round 9".into()), &rows, &summaries);

        assert_eq!(rep.totals.session_count, 3);
        assert_eq!(rep.totals.finished_count, 1);
        assert_eq!(rep.totals.exited_count, 1);
        assert_eq!(rep.totals.active_count, 1);
        assert_eq!(rep.totals.tokens.input, 13);
        assert_eq!(rep.totals.tokens.output, 6);
        // x.rs + y.rs — y.rs touched by two sessions counts ONCE at run level.
        assert_eq!(rep.totals.files_touched, 2);
        // Chronological, so the report reads in dispatch order.
        assert_eq!(
            rep.sessions
                .iter()
                .map(|s| s.session_id.as_str())
                .collect::<Vec<_>>(),
            vec!["c", "a", "b"]
        );
        assert_eq!(rep.started_at_ms, 50);
        assert_eq!(rep.sessions[1].summary.as_deref(), Some("did A"));
        assert_eq!(rep.sessions[1].files_touched, 2);
        // A session with no transcript rollup still reports, at zero.
        assert_eq!(rep.sessions[0].files_touched, 0);
        assert_eq!(rep.sessions[0].summary, None);
    }

    /// The active run is process-global by design, so the two tests that
    /// mutate it must not interleave under the default parallel harness.
    fn run_state_guard() -> std::sync::MutexGuard<'static, ()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
            .lock()
            .unwrap_or_else(|e| e.into_inner())
    }

    #[test]
    fn spawns_inside_the_window_share_a_run_and_a_new_one_starts_after_end() {
        let _guard = run_state_guard();
        end_run();
        let (first, _) = claim_run_for_spawn();
        let (second, _) = claim_run_for_spawn();
        assert_eq!(first, second, "a burst is one dispatch");
        end_run();
        let (third, _) = claim_run_for_spawn();
        assert_ne!(first, third, "a closed run never absorbs later work");
        end_run();
    }

    #[test]
    fn an_explicit_run_carries_its_label() {
        let _guard = run_state_guard();
        end_run();
        let id = begin_run(Some("perfect round 9".into()));
        let (run, label) = claim_run_for_spawn();
        assert_eq!(run.as_deref(), Some(id.as_str()));
        assert_eq!(label.as_deref(), Some("perfect round 9"));
        // Blank labels are not labels.
        end_run();
        begin_run(Some("   ".into()));
        assert_eq!(claim_run_for_spawn().1, None);
        end_run();
    }
}
