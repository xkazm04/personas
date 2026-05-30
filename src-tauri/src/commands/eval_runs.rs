//! Eval / Certification run reader — read-only viewer over the on-disk
//! evaluation bundles written by the `scripts/test/` harness.
//!
//! The team-autonomy evaluation framework runs AI-agent teams on "seeds" and
//! gathers immutable JSON bundles into `docs/test/runs/<runId>/`. The harness
//! (Node, host-side) stays the single writer — it needs git, `npm build/lint/
//! test`, and the test-automation bridge, none of which belong in the Tauri
//! process. This module is the **read-only** counterpart: it parses the
//! committed bundles so the in-app Certification Command Center (a dev-only
//! `overview` sub-tab) can render them. See the v2 plan and
//! `docs/features/overview/README.md`.
//!
//! **Auth:** these commands are unauthenticated, filesystem-only public reads
//! (no `State`, no credential access). That is acceptable here because the
//! surface is dev-only and reads nothing but local, already-committed JSON.
//! Flagged as a review decision — if this ever ships in a packaged build the
//! commands should be gated.
//!
//! **Parse robustness:** real bundles vary (8 dirs have `run.json` but no
//! `scorecard.json`; 2 are missing `run.json`; verdicts are sometimes
//! provisional; `code_track`/`judge`/`delivered_increment` may be absent).
//! Each file is parsed to a `serde_json::Value` once, then every subtree is
//! extracted with `from_value(...).unwrap_or_default()` so one malformed
//! subtree never sinks the whole read. A dir is skipped only if BOTH files are
//! absent/invalid; any per-file parse failure is `tracing::warn!`-logged and
//! treated as missing.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use ts_rs::TS;

use crate::error::AppError;

// ---------------------------------------------------------------------------
// Exported wire types (Rust → TS via ts-rs).
//
// Every struct is `rename_all = "camelCase"` so the frontend contract is
// uniform camelCase. The on-disk bundles, however, mix snake_case
// (`value_delivered`, `cascade_stalled`, `cost_usd`, all of `deterministic_dims`)
// and camelCase (`personasExecuted`, `masterHead`) keys — so every field whose
// source key is snake_case carries a `#[serde(alias = "...")]` to accept it on
// read. All optional fields are `Option<T>` + `#[serde(default)]` so a missing
// key never errors the parse.
// ---------------------------------------------------------------------------

/// Deterministic scoring dimensions (`scorecard.deterministic_dims`).
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DeterministicDims {
    #[serde(default, alias = "cascade_completion")]
    pub cascade_completion: Option<i32>,
    #[serde(default, alias = "work_density")]
    pub work_density: Option<i32>,
    #[serde(default, alias = "handoff_health")]
    pub handoff_health: Option<i32>,
    #[serde(default, alias = "learning_loop")]
    pub learning_loop: Option<i32>,
    /// `null` when the run produced no grounding-checkable docs.
    #[serde(default, alias = "grounding_pct")]
    pub grounding_pct: Option<i32>,
}

/// One build/lint/test step result (`scorecard.code_track.{build,lint,test}`).
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CodeTrackStep {
    #[serde(default)]
    pub status: Option<String>,
    /// Truncated stderr/stdout tail (present mainly on failures).
    #[serde(default)]
    pub tail: Option<String>,
}

/// Code-track gate results — `null` for doc-track-only runs.
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CodeTrack {
    #[serde(default)]
    pub build: Option<CodeTrackStep>,
    #[serde(default)]
    pub lint: Option<CodeTrackStep>,
    #[serde(default)]
    pub test: Option<CodeTrackStep>,
}

/// `scorecard.delivered_increment` — what the team actually merged to master.
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DeliveredIncrement {
    #[serde(default)]
    pub delivered: Option<bool>,
    #[serde(default, alias = "masterHead", alias = "master_head")]
    pub master_head: Option<String>,
    #[serde(default, alias = "sourceFiles", alias = "source_files")]
    pub source_files: Vec<String>,
}

/// One execution referenced by a self-veto.
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct SelfVetoExec {
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default, alias = "persona_id")]
    pub persona_id: Option<String>,
}

/// `scorecard.self_veto` — set when the team capped its own verdict (e.g. the
/// release manager held on a red lint). `null` when no self-veto fired.
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct SelfVeto {
    /// The verdict the team voluntarily capped to.
    #[serde(default)]
    pub capped: Option<String>,
    #[serde(default)]
    pub executions: Vec<SelfVetoExec>,
}

/// One row of `scorecard.grounding` — citation validity per produced doc.
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct GroundingEntry {
    #[serde(default)]
    pub file: Option<String>,
    #[serde(default)]
    pub total: Option<i32>,
    #[serde(default)]
    pub valid: Option<i32>,
    /// `null` when `total == 0`.
    #[serde(default)]
    pub pct: Option<i32>,
    #[serde(default)]
    pub invalid: Vec<String>,
}

/// `scorecard.facts` — raw counts from the gathered bundle.
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct Facts {
    #[serde(default)]
    pub executions: Option<i32>,
    #[serde(default)]
    pub completed: Option<i32>,
    #[serde(default)]
    pub failed: Option<i32>,
    #[serde(default, alias = "cascade_stalled")]
    pub cascade_stalled: Option<bool>,
    #[serde(default, alias = "value_delivered")]
    pub value_delivered: Option<i32>,
    #[serde(default, alias = "personas_executed")]
    pub personas_executed: Option<i32>,
    #[serde(default, alias = "member_count")]
    pub member_count: Option<i32>,
    #[serde(default, alias = "events_delivered")]
    pub events_delivered: Option<i32>,
    #[serde(default)]
    pub reviews: Option<i32>,
    #[serde(default, alias = "pending_reviews")]
    pub pending_reviews: Option<i32>,
    #[serde(default, alias = "learned_memories")]
    pub learned_memories: Option<i32>,
    #[serde(default, alias = "cost_usd")]
    pub cost_usd: Option<f64>,
    #[serde(default, alias = "repo_changed")]
    pub repo_changed: Option<bool>,
}

/// `scorecard.autonomy` — intervention counts.
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct Autonomy {
    #[serde(default)]
    pub interventions: Option<i32>,
    #[serde(default, alias = "pending_reviews")]
    pub pending_reviews: Option<i32>,
    #[serde(default)]
    pub note: Option<String>,
}

/// `scorecard.judge.dims` — aggregate judge scores.
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct JudgeDims {
    #[serde(default, alias = "per_persona_grades")]
    pub per_persona_grades: Vec<i32>,
    #[serde(default, alias = "min_persona_output")]
    pub min_persona_output: Option<i32>,
    #[serde(default, alias = "mean_judge")]
    pub mean_judge: Option<i32>,
    #[serde(default, alias = "portfolio_balance")]
    pub portfolio_balance: Option<i32>,
}

/// `scorecard.judge.portfolio_balance` — work-type diversity assessment.
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PortfolioBalance {
    #[serde(default, alias = "labels_histogram")]
    pub labels_histogram: BTreeMap<String, i32>,
    #[serde(default)]
    pub score: Option<i32>,
    #[serde(default)]
    pub note: Option<String>,
}

/// Per-persona judge dimensions (`scorecard.judge.personas[].dims`).
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PersonaDims {
    #[serde(default)]
    pub correctness: Option<i32>,
    #[serde(default)]
    pub actionability: Option<i32>,
    #[serde(default)]
    pub specificity: Option<i32>,
    #[serde(default, alias = "role_fidelity")]
    pub role_fidelity: Option<i32>,
}

/// One judged persona (`scorecard.judge.personas[]`).
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct JudgePersona {
    #[serde(default, alias = "persona_id")]
    pub persona_id: Option<String>,
    #[serde(default)]
    pub role: Option<String>,
    #[serde(default, alias = "work_labels")]
    pub work_labels: Vec<String>,
    #[serde(default)]
    pub dims: PersonaDims,
    #[serde(default)]
    pub evidence: Vec<String>,
    #[serde(default)]
    pub note: Option<String>,
}

/// `scorecard.judge` — the LLM-judge panel. `null` for deterministic-only
/// (first-cut / provisional) scorecards.
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct Judge {
    #[serde(default)]
    pub dims: JudgeDims,
    #[serde(default, alias = "portfolio_balance")]
    pub portfolio_balance: PortfolioBalance,
    #[serde(default)]
    pub personas: Vec<JudgePersona>,
    #[serde(default, alias = "judge_notes")]
    pub judge_notes: Option<String>,
}

/// One point on a team's score-over-time trajectory. Synthesized in Rust from
/// the cheap per-run summaries (NOT read from any single file).
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct TrajectoryPoint {
    pub run_id: String,
    pub started_at: Option<String>,
    pub team_score: Option<i32>,
    pub cost_usd: Option<f64>,
    pub verdict: Option<String>,
    pub provisional: bool,
}

/// Lightweight per-run row for the history list and cert grouping.
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct EvalRunSummary {
    pub run_id: String,
    pub team: Option<String>,
    pub team_id: Option<String>,
    pub seed: Option<String>,
    pub started_at: Option<String>,
    /// Resolved from `verdict` ?? `provisional_verdict`.
    pub verdict: Option<String>,
    /// `true` when `verdict` resolved from `provisional_verdict`.
    pub provisional: bool,
    pub team_score: Option<i32>,
    pub held_out: bool,
    pub has_scorecard: bool,
    pub has_code_track: bool,
    pub delivered: Option<bool>,
    pub self_vetoed: bool,
    pub cascade_stalled: Option<bool>,
    pub grounding_pct: Option<i32>,
    pub cost_usd: Option<f64>,
    pub rubric_version: Option<String>,
}

/// Full per-run detail. Reads ONLY `scorecard.json` + `run.json` (plus cheap
/// same-team summaries for `trajectory`); never `executions.json` /
/// `events.json` / `repo.patch`. Ships `heartbeat_len`, not the array.
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct EvalRunDetail {
    pub run_id: String,
    pub team: Option<String>,
    pub team_id: Option<String>,
    pub seed: Option<String>,
    pub goal: Option<String>,
    pub started_at: Option<String>,
    pub ended_at: Option<String>,
    pub window_min: Option<i32>,
    pub rubric_version: Option<String>,
    pub note: Option<String>,
    pub held_out: bool,
    pub verdict: Option<String>,
    pub provisional: bool,
    pub team_score: Option<i32>,
    pub deterministic_dims: DeterministicDims,
    pub code_track: Option<CodeTrack>,
    pub delivered_increment: Option<DeliveredIncrement>,
    pub self_veto: Option<SelfVeto>,
    /// `scorecard.resilience` (§6) — present only on resilience-track runs;
    /// surfaces the incident-escalation + auto-continuation facts to the
    /// in-app Certification dashboard. Tolerant `Value` (additive, optional).
    pub resilience: Option<serde_json::Value>,
    pub judge: Option<Judge>,
    pub facts: Option<Facts>,
    pub grounding: Vec<GroundingEntry>,
    pub autonomy: Option<Autonomy>,
    pub heartbeat_len: i32,
    pub repo_diff_bytes: Option<i32>,
    pub cost_usd: Option<f64>,
    pub trajectory: Vec<TrajectoryPoint>,
    pub has_scorecard: bool,
}

/// Certification status per team — the gate the dashboard headlines.
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct TeamCertStatus {
    pub team_id: String,
    /// Display label (falls back to `team_id` when no label is present).
    pub team: String,
    /// Trailing consecutive PRODUCTION verdicts over held-out runs, capped at 3.
    pub streak: i32,
    /// `streak >= 3`.
    pub certified: bool,
    pub held_out_runs: i32,
    pub latest_verdict: Option<String>,
    pub latest_run_id: Option<String>,
    /// Verdict distribution over the team's held-out runs.
    pub verdict_counts: BTreeMap<String, i32>,
}

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

/// Relative run-archive locations, in preference order. The framework relocated
/// its docs/runs from `docs/test/` to `docs/tests/autonomy-eval/`; the canonical
/// archive (with the certified cert-* bundles) is the former, so it wins. The
/// legacy path stays as a fallback for older checkouts.
const RUN_DIR_CANDIDATES: &[&[&str]] = &[
    &["docs", "tests", "autonomy-eval", "runs"],
    &["docs", "test", "runs"],
];

/// Resolve the run-archive directory. Candidate order:
/// 1. `PERSONAS_EVAL_RUNS_DIR` env override (if it exists),
/// 2. each `RUN_DIR_CANDIDATES` relative to cwd (dev: cwd = repo root),
/// 3. walk up from `current_exe()` (up to 6 levels) for each candidate.
///
/// First existing directory wins; `None` → the UI renders an empty state.
fn resolve_runs_dir() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("PERSONAS_EVAL_RUNS_DIR") {
        let pb = PathBuf::from(p);
        if pb.is_dir() {
            return Some(pb);
        }
    }

    let join_parts = |base: &Path, parts: &[&str]| {
        let mut p = base.to_path_buf();
        for c in parts {
            p.push(c);
        }
        p
    };

    for parts in RUN_DIR_CANDIDATES {
        let pb = join_parts(Path::new("."), parts);
        if pb.is_dir() {
            return Some(pb);
        }
    }

    if let Ok(exe) = std::env::current_exe() {
        let mut dir = exe.parent().map(Path::to_path_buf);
        for _ in 0..6 {
            let Some(d) = dir else { break };
            for parts in RUN_DIR_CANDIDATES {
                let cand = join_parts(&d, parts);
                if cand.is_dir() {
                    return Some(cand);
                }
            }
            dir = d.parent().map(Path::to_path_buf);
        }
    }

    None
}

// ---------------------------------------------------------------------------
// Reading helpers
// ---------------------------------------------------------------------------

/// A run directory's two parsed bundle files. `None` for a file means it was
/// absent or invalid JSON (already warn-logged).
struct Loaded {
    run_id: String,
    scorecard: Option<Value>,
    run: Option<Value>,
}

fn read_value(path: &Path) -> Option<Value> {
    let bytes = std::fs::read(path).ok()?;
    match serde_json::from_slice::<Value>(&bytes) {
        Ok(v) => Some(v),
        Err(e) => {
            tracing::warn!(path = %path.display(), error = %e, "eval_runs: invalid JSON, skipping file");
            None
        }
    }
}

/// Load one run directory. Returns `None` only when BOTH files are missing.
fn load_run(dir: &Path) -> Option<Loaded> {
    let run_id = dir.file_name()?.to_string_lossy().to_string();
    let scorecard = read_value(&dir.join("scorecard.json"));
    let run = read_value(&dir.join("run.json"));
    if scorecard.is_none() && run.is_none() {
        return None;
    }
    Some(Loaded {
        run_id,
        scorecard,
        run,
    })
}

/// Navigate a nested key path, returning the leaf `Value` if present.
fn nav<'a>(v: &'a Value, path: &[&str]) -> Option<&'a Value> {
    let mut cur = v;
    for k in path {
        cur = cur.get(k)?;
    }
    Some(cur)
}

fn nav_str(v: &Value, path: &[&str]) -> Option<String> {
    nav(v, path).and_then(Value::as_str).map(str::to_string)
}
fn nav_i32(v: &Value, path: &[&str]) -> Option<i32> {
    nav(v, path).and_then(Value::as_i64).map(|n| n as i32)
}
fn nav_f64(v: &Value, path: &[&str]) -> Option<f64> {
    nav(v, path).and_then(Value::as_f64)
}
fn nav_bool(v: &Value, path: &[&str]) -> Option<bool> {
    nav(v, path).and_then(Value::as_bool)
}

/// Extract one subtree by key, deserializing tolerantly: a missing key or a
/// malformed value yields `T::default()` rather than failing the whole read.
fn subtree<T: DeserializeOwned + Default>(v: &Value, key: &str) -> T {
    v.get(key)
        .cloned()
        .map(|x| serde_json::from_value(x).unwrap_or_default())
        .unwrap_or_default()
}

/// Resolve a verdict from a scorecard `Value`: prefer the final `verdict`, fall
/// back to `provisional_verdict` (and flag `provisional`).
fn resolve_verdict(sc: &Value) -> (Option<String>, bool) {
    if let Some(v) = sc.get("verdict").and_then(Value::as_str) {
        (Some(v.to_string()), false)
    } else if let Some(v) = sc.get("provisional_verdict").and_then(Value::as_str) {
        (Some(v.to_string()), true)
    } else {
        (None, false)
    }
}

fn build_summary(l: &Loaded) -> EvalRunSummary {
    let sc = l.scorecard.as_ref();
    let run = l.run.as_ref();
    let (verdict, provisional) = sc.map(resolve_verdict).unwrap_or((None, false));

    EvalRunSummary {
        run_id: l.run_id.clone(),
        team: sc
            .and_then(|s| nav_str(s, &["team"]))
            .or_else(|| run.and_then(|r| nav_str(r, &["summary", "team"])))
            .or_else(|| run.and_then(|r| nav_str(r, &["seed", "team"]))),
        team_id: run.and_then(|r| nav_str(r, &["summary", "teamId"])),
        seed: sc
            .and_then(|s| nav_str(s, &["seed"]))
            .or_else(|| run.and_then(|r| nav_str(r, &["seed", "id"]))),
        started_at: run.and_then(|r| nav_str(r, &["startedAt"])),
        verdict,
        provisional,
        team_score: sc.and_then(|s| nav_i32(s, &["team_score"])),
        held_out: run
            .and_then(|r| nav_bool(r, &["seed", "held_out"]))
            .unwrap_or(false),
        has_scorecard: sc.is_some(),
        has_code_track: sc
            .and_then(|s| s.get("code_track"))
            .map(|x| !x.is_null())
            .unwrap_or(false),
        delivered: sc.and_then(|s| nav_bool(s, &["delivered_increment", "delivered"])),
        self_vetoed: sc
            .and_then(|s| s.get("self_veto"))
            .map(|x| !x.is_null())
            .unwrap_or(false),
        cascade_stalled: sc.and_then(|s| nav_bool(s, &["facts", "cascade_stalled"])),
        grounding_pct: sc.and_then(|s| nav_i32(s, &["deterministic_dims", "grounding_pct"])),
        cost_usd: sc
            .and_then(|s| nav_f64(s, &["facts", "cost_usd"]))
            .or_else(|| run.and_then(|r| nav_f64(r, &["summary", "cost_usd"]))),
        rubric_version: sc.and_then(|s| nav_str(s, &["rubric_version"])),
    }
}

fn build_detail(l: &Loaded, trajectory: Vec<TrajectoryPoint>) -> EvalRunDetail {
    let null = Value::Null;
    let sc = l.scorecard.as_ref().unwrap_or(&null);
    let run = l.run.as_ref().unwrap_or(&null);
    let (verdict, provisional) = resolve_verdict(sc);

    EvalRunDetail {
        run_id: l.run_id.clone(),
        team: nav_str(sc, &["team"]).or_else(|| nav_str(run, &["summary", "team"])),
        team_id: nav_str(run, &["summary", "teamId"]),
        seed: nav_str(sc, &["seed"]).or_else(|| nav_str(run, &["seed", "id"])),
        goal: nav_str(run, &["seed", "goal"]),
        started_at: nav_str(run, &["startedAt"]),
        ended_at: nav_str(run, &["endedAt"]),
        window_min: nav_i32(run, &["windowMin"]),
        rubric_version: nav_str(sc, &["rubric_version"]),
        note: nav_str(sc, &["note"]),
        held_out: nav_bool(run, &["seed", "held_out"]).unwrap_or(false),
        verdict,
        provisional,
        team_score: nav_i32(sc, &["team_score"]),
        deterministic_dims: subtree(sc, "deterministic_dims"),
        code_track: subtree(sc, "code_track"),
        delivered_increment: subtree(sc, "delivered_increment"),
        self_veto: subtree(sc, "self_veto"),
        resilience: sc.get("resilience").cloned(),
        judge: subtree(sc, "judge"),
        facts: subtree(sc, "facts"),
        grounding: subtree(sc, "grounding"),
        autonomy: subtree(sc, "autonomy"),
        heartbeat_len: nav(run, &["heartbeat"])
            .and_then(Value::as_array)
            .map(|a| a.len() as i32)
            .unwrap_or(0),
        repo_diff_bytes: nav_i32(run, &["summary", "repoDiffBytes"]),
        cost_usd: nav_f64(sc, &["facts", "cost_usd"])
            .or_else(|| nav_f64(run, &["summary", "cost_usd"])),
        trajectory,
        has_scorecard: l.scorecard.is_some(),
    }
}

// ---------------------------------------------------------------------------
// Sync cores (also the unit-test entry points)
// ---------------------------------------------------------------------------

/// All run summaries, sorted by `started_at` descending (newest first).
pub fn list_summaries() -> Vec<EvalRunSummary> {
    let Some(dir) = resolve_runs_dir() else {
        return vec![];
    };
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return vec![];
    };

    let mut out: Vec<EvalRunSummary> = entries
        .filter_map(Result::ok)
        .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
        .filter_map(|e| load_run(&e.path()))
        .map(|l| build_summary(&l))
        .collect();

    // Newest first. `None` started_at sorts last.
    out.sort_by(|a, b| b.started_at.cmp(&a.started_at));
    out
}

/// Per-team certification status, grouped by `team_id`.
pub fn cert_status() -> Vec<TeamCertStatus> {
    let summaries = list_summaries();

    let mut groups: BTreeMap<String, Vec<&EvalRunSummary>> = BTreeMap::new();
    for s in &summaries {
        if let Some(tid) = &s.team_id {
            groups.entry(tid.clone()).or_default().push(s);
        }
    }

    let mut out: Vec<TeamCertStatus> = groups
        .into_iter()
        .map(|(team_id, runs)| {
            // Held-out runs only, oldest → newest, for the trailing streak.
            let mut held: Vec<&&EvalRunSummary> = runs.iter().filter(|r| r.held_out).collect();
            held.sort_by(|a, b| a.started_at.cmp(&b.started_at));

            let mut streak = 0i32;
            for r in held.iter().rev() {
                if r.verdict.as_deref() == Some("PRODUCTION") {
                    streak += 1;
                } else {
                    break;
                }
            }
            let streak = streak.min(3);

            let mut verdict_counts: BTreeMap<String, i32> = BTreeMap::new();
            for r in &held {
                if let Some(v) = &r.verdict {
                    *verdict_counts.entry(v.clone()).or_default() += 1;
                }
            }

            let latest = held.last();
            let team_label = runs
                .iter()
                .find_map(|r| r.team.clone())
                .unwrap_or_else(|| team_id.clone());

            TeamCertStatus {
                team_id,
                team: team_label,
                streak,
                certified: streak >= 3,
                held_out_runs: held.len() as i32,
                latest_verdict: latest.and_then(|r| r.verdict.clone()),
                latest_run_id: latest.map(|r| r.run_id.clone()),
                verdict_counts,
            }
        })
        .collect();

    out.sort_by(|a, b| a.team.cmp(&b.team));
    out
}

/// Full detail for one run id. `run_id` is a bare directory name — reject any
/// path-separator / traversal attempt.
pub fn eval_run_detail(run_id: &str) -> Result<EvalRunDetail, AppError> {
    if run_id.is_empty()
        || run_id.contains('/')
        || run_id.contains('\\')
        || run_id.contains("..")
    {
        return Err(AppError::Validation(format!("invalid run id: {run_id}")));
    }

    let dir = resolve_runs_dir()
        .ok_or_else(|| AppError::NotFound("eval runs directory not found".into()))?;
    let run_dir = dir.join(run_id);
    let loaded = load_run(&run_dir)
        .ok_or_else(|| AppError::NotFound(format!("eval run not found: {run_id}")))?;

    let team_id = loaded
        .run
        .as_ref()
        .and_then(|r| nav_str(r, &["summary", "teamId"]));

    let trajectory = match &team_id {
        Some(tid) => {
            let mut pts: Vec<TrajectoryPoint> = list_summaries()
                .into_iter()
                .filter(|s| s.team_id.as_deref() == Some(tid.as_str()))
                .map(|s| TrajectoryPoint {
                    run_id: s.run_id,
                    started_at: s.started_at,
                    team_score: s.team_score,
                    cost_usd: s.cost_usd,
                    verdict: s.verdict,
                    provisional: s.provisional,
                })
                .collect();
            pts.sort_by(|a, b| a.started_at.cmp(&b.started_at));
            pts
        }
        None => vec![],
    };

    Ok(build_detail(&loaded, trajectory))
}

// ---------------------------------------------------------------------------
// Tauri commands (thin async wrappers)
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn list_eval_runs() -> Result<Vec<EvalRunSummary>, AppError> {
    Ok(list_summaries())
}

#[tauri::command]
pub async fn get_cert_status() -> Result<Vec<TeamCertStatus>, AppError> {
    Ok(cert_status())
}

#[tauri::command]
pub async fn get_eval_run(run_id: String) -> Result<EvalRunDetail, AppError> {
    eval_run_detail(&run_id)
}

// ---------------------------------------------------------------------------
// Tests — assert against the keep-local run archive (docs/tests/autonomy-eval/
// runs/, or the legacy docs/test/runs/). Those bundles are git-ignored
// (keep-local policy), so they exist in a dev checkout but are ABSENT in a
// fresh CI checkout — every data assertion SKIPS gracefully when the archive
// is empty. Sync cores are exercised directly (no Tauri runtime); a
// guaranteed-runnable copy lives in tests/eval_runs_data.rs.
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    /// The keep-local bundles are present (dev checkout). False in CI → skip.
    fn archive_present() -> bool {
        !list_summaries().is_empty()
    }

    #[test]
    fn summaries_sorted_newest_first() {
        let runs = list_summaries();
        for w in runs.windows(2) {
            assert!(
                w[0].started_at >= w[1].started_at,
                "summaries not sorted desc by started_at"
            );
        }
    }

    #[test]
    fn sdlc2_ai_bookkeeper_is_certified() {
        if !archive_present() {
            return;
        }
        let cert = cert_status();
        // The SDLC2 cert team (distinct from the non-held-out "SDLC — ai-bookkeeper").
        let Some(bk) = cert
            .iter()
            .find(|c| c.team.contains("SDLC2") && c.team.contains("ai-bookkeeper"))
        else {
            return; // this team's bundles aren't in this checkout
        };
        assert!(
            bk.held_out_runs >= 3,
            "expected >=3 held-out cert runs, got {}",
            bk.held_out_runs
        );
        // master certified this team: cert-4/5/6 = PRODUCTION → trailing streak 3.
        assert_eq!(bk.streak, 3, "SDLC2 ai-bookkeeper streak should be 3 (certified)");
        assert!(bk.certified, "SDLC2 ai-bookkeeper should be CERTIFIED");
        assert_eq!(bk.latest_verdict.as_deref(), Some("PRODUCTION"));
    }

    #[test]
    fn detail_loads_and_resolves_verdict() {
        let Some(first) = list_summaries().into_iter().find(|r| r.has_scorecard) else {
            return;
        };
        let detail = eval_run_detail(&first.run_id).expect("detail loads for a real run id");
        assert!(
            detail.verdict.is_some(),
            "verdict resolves from verdict|provisional_verdict"
        );
        if detail.team_id.is_some() {
            assert!(detail.trajectory.iter().any(|p| p.run_id == detail.run_id));
        }
    }

    #[test]
    fn judge_panel_present_when_a_run_is_judged() {
        // The current canonical archive is deterministic-only (no judged runs);
        // this asserts the contract IF a judged run is ever present.
        for s in list_summaries() {
            let detail = eval_run_detail(&s.run_id).unwrap_or_default();
            if let Some(judge) = &detail.judge {
                assert!(!detail.provisional, "a judged run has a final verdict");
                assert!(!judge.personas.is_empty(), "judge panel has personas");
                return;
            }
        }
    }

    #[test]
    fn rejects_path_traversal_run_id() {
        assert!(eval_run_detail("../../etc/passwd").is_err());
        assert!(eval_run_detail("foo/bar").is_err());
        assert!(eval_run_detail("").is_err());
    }
}
