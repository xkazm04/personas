//! The ONE gated door a `/council` run comes back through.
//!
//! The `/council` skill writes files into the target repo and never touches
//! `personas.db`. This module is the only path from those files into SQLite,
//! and it is deliberately the strictest door in the tree, for a reason the
//! other doors do not have: **the thing being ingested is a verdict on work
//! the ingesting party produced.** A door that took a council's word for its
//! own outcome would be a self-graded exam with a database behind it.
//!
//! So the door does three things its siblings do not:
//!
//! 1. **It recomputes.** `overall`, `coverage` and `outcome` are derived here
//!    from the per-dimension verdicts and the named rubric's own weights, and a
//!    result whose stated numbers disagree beyond [`COUNCIL_NUMERIC_TOLERANCE`]
//!    is REFUSED rather than corrected. Refusing rather than silently fixing is
//!    the point: a disagreement means the skill and the app are running
//!    different arithmetic, and quietly storing the app's answer would hide
//!    that forever.
//! 2. **It derives the floors.** `floor`, `floor_hit` and `advisory` come from
//!    the rubric and the run's `trust_state`, never from the file. A member
//!    cannot mark its own floor advisory.
//! 3. **It refuses whole, never partially.** Everything is validated before a
//!    single row is written (same rule as `ship_ingest.rs`), because half a
//!    council is not a weaker verdict, it is a different one.
//!
//! Path confinement, the 1 MiB cap, the `schema_version` check and the
//! `ingested.json` marker are copied from `ship_ingest.rs`; the ticker sweep is
//! copied from `notepad_ingest.rs`, including its two rules - it never panics
//! and it never fails the tick.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::Deserialize;
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::db::repos::dev::council as council_repo;
use crate::db::repos::dev::scenarios as scenario_repo;
use crate::db::repos::dev_tools as repo;
use crate::error::AppError;
use crate::ipc_auth::require_auth;
use crate::AppState;
use personas_core::events::event_name;
use personas_core::models::{
    aggregate_scenarios, round4, rubric_for, CouncilIngestSummary, ScenarioAggregate,
    ScenarioDeclaration, ScenarioReport, COUNCIL_CONFIDENCES, COUNCIL_COVERAGE_FLOOR,
    COUNCIL_HARD_FAILURE_CODES, COUNCIL_MAX_ROUND, COUNCIL_NUMERIC_TOLERANCE, COUNCIL_OUTCOMES,
    COUNCIL_RUBRIC_VERSIONS, COUNCIL_SUBJECT_KINDS, COUNCIL_TRUSTED_OVERALL, COUNCIL_TRUST_STATES,
    COUNCIL_VERDICT_KINDS, COUNCIL_VERDICT_STATES, SCENARIO_PROOFS, SCENARIO_RESULT_STATES,
};
use personas_db::DbPool;

/// The only `schema_version` this door accepts. Bump ONLY together with the
/// skill's own contract; an unknown version is refused rather than best-effort
/// parsed, because a result written against a contract we do not know is not a
/// result we can trust dimension-wise.
pub const COUNCIL_RESULT_VERSION: u32 = 1;

/// Handshake directory (gitignored in managed repos) and the run tree under it.
const RUNS_REL: [&str; 3] = [".personas", "council", "runs"];

const MAX_RESULT_BYTES: u64 = 1_048_576;
/// Longest free-text field carried into a column (a summary, a must-address
/// line, a hard-failure detail).
const MAX_TEXT: usize = 4000;
/// Spanned paths. A council judges a feature's slice, not a repository.
const MAX_SPANNED_PATHS: usize = 500;
/// `must_address` lines. The value of this list is that a human reads it.
const MAX_MUST_ADDRESS: usize = 30;
/// Scenarios one run may report on. The value member may propose at most five
/// new ones per round; a result claiming fifty branches is a result that
/// enumerated its inputs rather than judging a feature.
const MAX_SCENARIOS: usize = 50;
/// Axes on one scenario, and the length of each key and value. An axis map is
/// a coordinate ("candidate_family: marketing"), not a document.
const MAX_SCENARIO_AXES: usize = 20;
const MAX_AXIS_TEXT: usize = 200;

// ── result.json shape ───────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct CouncilResult {
    #[serde(default)]
    schema_version: Option<u32>,
    #[serde(default)]
    run_id: String,
    subject: ResultSubject,
    #[serde(default)]
    rubric_version: String,
    #[serde(default)]
    round_no: i32,
    #[serde(default)]
    trust_state: String,
    receipt: ResultReceipt,
    #[serde(default)]
    hard_failures: Vec<ResultHardFailure>,
    #[serde(default)]
    dimensions: Vec<ResultDimension>,
    /// Optional, and optional TOGETHER with `envelope` - a raw `Value` rather
    /// than a typed `Option<Vec<_>>` because ABSENT and `null` are different
    /// answers here and serde spells them the same into an `Option`.
    #[serde(default)]
    scenarios: Option<serde_json::Value>,
    #[serde(default)]
    envelope: Option<serde_json::Value>,
    #[serde(default)]
    overall: Option<f64>,
    #[serde(default)]
    coverage: f64,
    #[serde(default)]
    outcome: String,
    #[serde(default)]
    must_address: Vec<String>,
    #[serde(default)]
    summary: String,
    #[serde(default)]
    started_at: Option<String>,
    #[serde(default)]
    finished_at: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ResultSubject {
    #[serde(default)]
    kind: String,
    #[serde(default)]
    slug: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    summary: String,
}

#[derive(Debug, Deserialize)]
struct ResultReceipt {
    #[serde(default)]
    head_sha: String,
    #[serde(default)]
    spanned_paths: Vec<String>,
    #[serde(default)]
    span_digest: String,
}

#[derive(Debug, Deserialize)]
struct ResultHardFailure {
    #[serde(default)]
    code: String,
    #[serde(default)]
    detail: String,
}

#[derive(Debug, Deserialize)]
struct ResultDimension {
    #[serde(default)]
    dimension: String,
    #[serde(default)]
    kind: String,
    #[serde(default)]
    state: String,
    #[serde(default)]
    score: Option<f64>,
    #[serde(default)]
    confidence: String,
    #[serde(default)]
    findings: serde_json::Value,
    #[serde(default)]
    evidence: serde_json::Value,
    #[serde(default)]
    techniques: serde_json::Value,
    #[serde(default)]
    unmeasured_reason: Option<String>,
    #[serde(default)]
    delta: Option<f64>,
}

// ── validation (pure - no DB, no filesystem) ────────────────────────────────

/// A result that has survived every structural check, with the numbers the
/// door recomputed rather than the ones the file stated.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct ValidatedCouncilRun {
    pub kind: String,
    pub slug: String,
    pub title: String,
    pub rubric_version: String,
    pub round_no: i32,
    pub trust_state: String,
    pub outcome: String,
    pub overall: Option<f64>,
    pub coverage: f64,
    pub head_sha: String,
    pub spanned_paths_json: String,
    pub span_digest: String,
    pub hard_failures_json: String,
    pub must_address_json: String,
    pub summary: String,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub verdicts: Vec<council_repo::NewVerdict>,
    /// The scenario fold, or `None` when the result carried no `scenarios`
    /// key at all. `None` is what keeps every result written before scenarios
    /// existed ingesting byte for byte as it did.
    pub scenarios: Option<ValidatedScenarios>,
}

/// The scenario half of a validated result: what the member REPORTED, and the
/// fold of that against what the product DECLARED.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct ValidatedScenarios {
    /// Slugs the member reported on, in reported order. Only these get a
    /// result row - a declared branch nobody looked at is unmeasured by
    /// absence, and writing a row to say so would be writing a measurement.
    pub reported: Vec<String>,
    /// Slugs the member reported that the product had not declared. The door
    /// creates each as `proposed` / source `council` before it writes.
    pub discovered: Vec<ScenarioReport>,
    pub fold: ScenarioAggregate,
}

fn bounded(s: &str, max: usize, what: &str) -> Result<String, AppError> {
    // Through the shared vocabulary rather than an inline refusal with a
    // sentence of its own: the emptiness rule already exists, is one line, and
    // is open-coded at 300-odd call sites in this tree (census
    // `hand-rolled-emptiness-refusal`). The length half below has no shared
    // equivalent, so it stays here.
    personas_core::validation::require_non_empty(what, s)?;
    let t = s.trim();
    if t.chars().count() > max {
        return Err(AppError::Validation(format!(
            "{what} is longer than {max} characters"
        )));
    }
    Ok(t.to_string())
}

fn one_of(value: &str, set: &[&str], what: &str) -> Result<String, AppError> {
    let v = value.trim();
    if !set.contains(&v) {
        return Err(AppError::Validation(format!(
            "{what} is `{v}`; expected one of {}",
            set.join(", ")
        )));
    }
    Ok(v.to_string())
}

/// A state whose verdict carries a number. `carried` is here beside `measured`
/// because the skill's `aggregate.mjs` says so (`SCORING_STATES`): drift
/// `none`/`grown` CARRIES a verdict forward from an earlier round, and a
/// carried verdict that contributed nothing to the arithmetic would make every
/// round after the first read as `incomplete`.
fn state_scores(state: &str) -> bool {
    matches!(state, "measured" | "carried")
}

/// Validate the result's `scenarios` array, exactly as the skill's
/// `schema.mjs` does - the same nine fields, the same refusals.
///
/// Returns the member's reports. `scope`, `floor`, `floor_hit` and `advisory`
/// are deliberately NOT read from the file: they are derived from what the
/// product DECLARED, because a judge that may also decide which branches count
/// can always pass by narrowing the question.
fn validate_scenario_reports(
    raw: &serde_json::Value,
    subject_kind: &str,
) -> Result<Vec<ScenarioReport>, AppError> {
    if subject_kind != "use_case" {
        return Err(AppError::Validation(
            "scenarios: only a use_case subject may carry scenarios - a redesign \
             has no user branches of its own"
                .into(),
        ));
    }
    let Some(entries) = raw.as_array() else {
        return Err(AppError::Validation(
            "scenarios must be an array when present".into(),
        ));
    };
    if entries.len() > MAX_SCENARIOS {
        return Err(AppError::Validation(format!(
            "scenarios carries {} entries (cap {MAX_SCENARIOS})",
            entries.len()
        )));
    }

    let mut out: Vec<ScenarioReport> = Vec::with_capacity(entries.len());
    for entry in entries {
        let slug = bounded(
            entry
                .get("slug")
                .and_then(|v| v.as_str())
                .unwrap_or_default(),
            200,
            "scenarios: slug",
        )?;
        if out.iter().any(|s| s.slug == slug) {
            return Err(AppError::Validation(format!(
                "scenarios: {slug} appears twice"
            )));
        }
        let title = bounded(
            entry
                .get("title")
                .and_then(|v| v.as_str())
                .unwrap_or_default(),
            300,
            &format!("scenarios: {slug}: title"),
        )?;

        let axes_raw = entry.get("axes");
        let Some(axes_obj) = axes_raw.and_then(|v| v.as_object()) else {
            return Err(AppError::Validation(format!(
                "scenarios: {slug}: axes must be a flat object"
            )));
        };
        if axes_obj.len() > MAX_SCENARIO_AXES {
            return Err(AppError::Validation(format!(
                "scenarios: {slug}: {} axes (cap {MAX_SCENARIO_AXES})",
                axes_obj.len()
            )));
        }
        let mut axes = BTreeMap::new();
        for (k, v) in axes_obj {
            let Some(value) = v.as_str() else {
                return Err(AppError::Validation(format!(
                    "scenarios: {slug}: axis {k} must be a string"
                )));
            };
            axes.insert(
                bounded(k, MAX_AXIS_TEXT, &format!("scenarios: {slug}: axis name"))?,
                bounded(
                    value,
                    MAX_AXIS_TEXT,
                    &format!("scenarios: {slug}: axis {k}"),
                )?,
            );
        }

        let state = one_of(
            entry
                .get("state")
                .and_then(|v| v.as_str())
                .unwrap_or_default(),
            &SCENARIO_RESULT_STATES,
            &format!("scenarios: {slug}: state"),
        )?;
        // The absent-value convention, both directions - the same pair the
        // dimensions above are held to, for the same reason.
        let score = entry.get("score").and_then(|v| v.as_f64());
        if state == "measured" {
            match score {
                Some(s) if (0.0..=1.0).contains(&s) && !s.is_nan() => {}
                _ => {
                    return Err(AppError::Validation(format!(
                        "scenarios: {slug}: a measured scenario needs a score in 0..1"
                    )))
                }
            }
        } else if !matches!(entry.get("score"), Some(serde_json::Value::Null)) {
            return Err(AppError::Validation(format!(
                "scenarios: {slug}: an unmeasured scenario must carry score null - never a zero"
            )));
        }

        let confidence = one_of(
            entry
                .get("confidence")
                .and_then(|v| v.as_str())
                .unwrap_or_default(),
            &COUNCIL_CONFIDENCES,
            &format!("scenarios: {slug}: confidence"),
        )?;
        // `n` is how many runs or turns the score rests on. Present and null,
        // or present and at least one - a zero would be a score resting on
        // nothing, which is a claim rather than a measurement.
        let n = match entry.get("n") {
            Some(serde_json::Value::Null) => None,
            Some(v) => match v.as_i64() {
                Some(i) if i >= 1 && i <= i32::MAX as i64 => Some(i as i32),
                _ => {
                    return Err(AppError::Validation(format!(
                        "scenarios: {slug}: n must be an integer >= 1 or null"
                    )))
                }
            },
            None => {
                return Err(AppError::Validation(format!(
                    "scenarios: {slug}: n must be an integer >= 1 or null"
                )))
            }
        };
        let proof = one_of(
            entry
                .get("proof")
                .and_then(|v| v.as_str())
                .unwrap_or_default(),
            &SCENARIO_PROOFS,
            &format!("scenarios: {slug}: proof"),
        )?;
        let Some(summary) = entry.get("summary").and_then(|v| v.as_str()) else {
            return Err(AppError::Validation(format!(
                "scenarios: {slug}: summary must be a string"
            )));
        };
        if summary.chars().count() > MAX_TEXT {
            return Err(AppError::Validation(format!(
                "scenarios: {slug}: summary is longer than {MAX_TEXT} characters"
            )));
        }

        out.push(ScenarioReport {
            slug,
            title: Some(title),
            axes: Some(axes),
            state,
            score,
            confidence,
            n,
            proof,
            summary: summary.trim().to_string(),
        });
    }
    Ok(out)
}

/// One envelope bucket, sorted - so the comparison is about CONTENT and not
/// about the order two implementations happened to walk their scenarios in.
fn sorted(slugs: &[String]) -> Vec<String> {
    let mut v = slugs.to_vec();
    v.sort();
    v
}

/// Read one bucket off the result's stated envelope, refusing anything that is
/// not an array of strings.
fn envelope_bucket(envelope: &serde_json::Value, key: &str) -> Result<Vec<String>, AppError> {
    let Some(array) = envelope.get(key).and_then(|v| v.as_array()) else {
        return Err(AppError::Validation(format!(
            "envelope.{key} must be an array of slugs"
        )));
    };
    let mut out = Vec::with_capacity(array.len());
    for item in array {
        let Some(s) = item.as_str() else {
            return Err(AppError::Validation(format!(
                "envelope.{key} must be an array of slugs"
            )));
        };
        out.push(s.to_string());
    }
    out.sort();
    Ok(out)
}

/// Parse and fully validate a result, recomputing every number it states.
///
/// `dir_name` is the run directory's own name; the file's `run_id` must match
/// it, so a result dropped into the wrong directory is caught rather than
/// filed under the wrong round. `prior_round` is the subject's current highest
/// round (`0` for a subject with no runs). `declared` is what the PRODUCT says
/// this feature's scenarios are - the scopes and floors the result is folded
/// against, which the result itself may not state.
pub(crate) fn validate_council_result(
    raw: &str,
    dir_name: &str,
    prior_round: i32,
    declared: &[ScenarioDeclaration],
) -> Result<ValidatedCouncilRun, AppError> {
    let result: CouncilResult = serde_json::from_str(raw)
        .map_err(|e| AppError::Validation(format!("result.json is not valid: {e}")))?;

    match result.schema_version {
        Some(v) if v == COUNCIL_RESULT_VERSION => {}
        Some(v) => {
            return Err(AppError::Validation(format!(
                "result.json declares schema_version {v}; this app understands \
                 {COUNCIL_RESULT_VERSION} - refusing to ingest"
            )))
        }
        None => {
            return Err(AppError::Validation(format!(
                "result.json has no schema_version (expected {COUNCIL_RESULT_VERSION}) \
                 - refusing to ingest"
            )))
        }
    }

    let run_id = bounded(&result.run_id, 200, "run_id")?;
    if run_id != dir_name {
        return Err(AppError::Validation(format!(
            "result.json reports run `{run_id}` but sits in directory `{dir_name}`"
        )));
    }

    let kind = one_of(&result.subject.kind, &COUNCIL_SUBJECT_KINDS, "subject.kind")?;
    let slug = bounded(&result.subject.slug, 200, "subject.slug")?;
    let title = bounded(&result.subject.title, 300, "subject.title")?;
    let rubric_version = one_of(
        &result.rubric_version,
        &COUNCIL_RUBRIC_VERSIONS,
        "rubric_version",
    )?;
    let trust_state = one_of(&result.trust_state, &COUNCIL_TRUST_STATES, "trust_state")?;
    // Validated, then RECOMPUTED below. Checking the vocabulary first means a
    // result carrying a token nobody defined is named as such rather than
    // being silently replaced by the door's own answer.
    one_of(&result.outcome, &COUNCIL_OUTCOMES, "outcome")?;

    if result.round_no < 1 {
        return Err(AppError::Validation(format!(
            "round_no is {}; rounds start at 1",
            result.round_no
        )));
    }
    if result.round_no != prior_round + 1 {
        return Err(AppError::Validation(format!(
            "round_no is {} but this subject's last round was {prior_round} - \
             a council round is the next one or it is not a round",
            result.round_no
        )));
    }

    let head_sha = bounded(&result.receipt.head_sha, 200, "receipt.head_sha")?;
    let span_digest = bounded(&result.receipt.span_digest, 200, "receipt.span_digest")?;
    if result.receipt.spanned_paths.len() > MAX_SPANNED_PATHS {
        return Err(AppError::Validation(format!(
            "receipt.spanned_paths carries {} entries (cap {MAX_SPANNED_PATHS})",
            result.receipt.spanned_paths.len()
        )));
    }
    let mut spanned: Vec<String> = Vec::with_capacity(result.receipt.spanned_paths.len());
    for (i, p) in result.receipt.spanned_paths.iter().enumerate() {
        let p = bounded(p, 500, &format!("receipt.spanned_paths[{i}]"))?;
        // Path confinement applies to the RECEIPT too, not only to the run
        // directory: the drift sweep reads every one of these off disk later.
        if Path::new(&p).is_absolute() || p.split(['/', '\\']).any(|seg| seg == "..") {
            return Err(AppError::Validation(format!(
                "receipt.spanned_paths[{i}] `{p}` escapes the project root"
            )));
        }
        spanned.push(p);
    }

    let mut hard_failures = Vec::new();
    for (i, hf) in result.hard_failures.iter().enumerate() {
        let code = one_of(
            &hf.code,
            &COUNCIL_HARD_FAILURE_CODES,
            &format!("hard_failures[{i}].code"),
        )?;
        let detail = bounded(&hf.detail, MAX_TEXT, &format!("hard_failures[{i}].detail"))?;
        hard_failures.push(json!({ "code": code, "detail": detail }));
    }

    if result.must_address.len() > MAX_MUST_ADDRESS {
        return Err(AppError::Validation(format!(
            "must_address carries {} lines (cap {MAX_MUST_ADDRESS})",
            result.must_address.len()
        )));
    }
    let mut must_address = Vec::new();
    for (i, line) in result.must_address.iter().enumerate() {
        must_address.push(bounded(line, MAX_TEXT, &format!("must_address[{i}]"))?);
    }

    // --- the rubric decides which dimensions this run must carry ------------
    let rubric = rubric_for(&rubric_version).ok_or_else(|| {
        AppError::Validation(format!("No rubric named `{rubric_version}` in this app"))
    })?;

    let mut verdicts: Vec<council_repo::NewVerdict> = Vec::with_capacity(rubric.len());
    let mut seen: Vec<String> = Vec::new();
    let mut measured_weight = 0.0f64;
    let mut applicable_weight = 0.0f64;
    let mut weighted_score = 0.0f64;
    let mut binding_floor_hit = false;

    for (i, d) in result.dimensions.iter().enumerate() {
        let dimension = d.dimension.trim().to_string();
        let Some(entry) = rubric.iter().find(|e| e.dimension == dimension) else {
            return Err(AppError::Validation(format!(
                "dimensions[{i}]: `{dimension}` is not part of rubric {rubric_version}"
            )));
        };
        if seen.contains(&dimension) {
            return Err(AppError::Validation(format!(
                "dimensions[{i}]: `{dimension}` appears twice"
            )));
        }
        seen.push(dimension.clone());

        let kind_v = one_of(
            &d.kind,
            &COUNCIL_VERDICT_KINDS,
            &format!("dimensions[{i}].kind"),
        )?;
        let state = one_of(
            &d.state,
            &COUNCIL_VERDICT_STATES,
            &format!("dimensions[{i}].state"),
        )?;
        let confidence = one_of(
            &d.confidence,
            &COUNCIL_CONFIDENCES,
            &format!("dimensions[{i}].confidence"),
        )?;

        // The absent-value convention, enforced in both directions. A score on
        // an unmeasured dimension is the shape that turns "we could not tell"
        // into a number, and a missing score on a measured one is the shape
        // that turns a real finding into a zero downstream.
        match (state_scores(&state), d.score) {
            (true, None) => {
                return Err(AppError::Validation(format!(
                    "dimensions[{i}]: state `{state}` carries no score"
                )))
            }
            (false, Some(s)) => {
                return Err(AppError::Validation(format!(
                    "dimensions[{i}]: state `{state}` must not carry a score (got {s})"
                )))
            }
            _ => {}
        }
        if let Some(s) = d.score {
            if !(0.0..=1.0).contains(&s) || s.is_nan() {
                return Err(AppError::Validation(format!(
                    "dimensions[{i}]: score {s} is outside 0..1"
                )));
            }
        }

        // Floors come from the RUBRIC, never from the file: a member marking
        // its own floor advisory would be a member deciding how much its own
        // objection counts. Mirrors `normalizeDimension` in the skill's
        // aggregate.mjs, including that `advisory` is only ever true on a
        // floor that was actually HIT.
        let floor = entry.floor;
        let floor_hit = match (floor, d.score) {
            (Some(f), Some(s)) => s < f,
            _ => false,
        };
        let advisory = floor_hit && entry.is_judged() && trust_state != "trusted";
        if floor_hit && !advisory {
            binding_floor_hit = true;
        }

        if state != "not_applicable" {
            applicable_weight += entry.weight;
        }
        if state_scores(&state) {
            measured_weight += entry.weight;
            weighted_score += entry.weight * d.score.unwrap_or(0.0);
        }

        verdicts.push(council_repo::NewVerdict {
            dimension,
            kind: kind_v,
            state,
            score: d.score,
            confidence,
            floor,
            floor_hit,
            advisory,
            payload_json: json!({
                "findings": d.findings,
                "evidence": d.evidence,
                "techniques": d.techniques,
                "unmeasuredReason": d.unmeasured_reason,
                "delta": d.delta,
            })
            .to_string(),
        });
    }

    // Every dimension of the rubric, exactly once. A run that simply omitted
    // the member it could not reach would shrink its own denominator, which is
    // the cheapest way to fake coverage.
    if verdicts.len() != rubric.len() {
        let missing: Vec<&str> = rubric
            .iter()
            .map(|e| e.dimension)
            .filter(|d| !seen.iter().any(|s| s == d))
            .collect();
        return Err(AppError::Validation(format!(
            "rubric {rubric_version} has {} dimensions; this result carries {} (missing: {})",
            rubric.len(),
            verdicts.len(),
            if missing.is_empty() {
                "none".to_string()
            } else {
                missing.join(", ")
            }
        )));
    }

    // --- the numbers, recomputed --------------------------------------------
    let overall = if measured_weight > 0.0 {
        // Rounded to 4 decimals, because that is what the skill stores and the
        // comparison below is at 1e-6: an unrounded quotient would be refused
        // for a formatting difference rather than an arithmetic one.
        Some(round4(weighted_score / measured_weight))
    } else {
        // Unmeasured, and that is NOT zero: a council that could not reach a
        // single member has no opinion, and spelling that `0.0` would order it
        // below a council that genuinely found nothing good.
        None
    };
    let coverage = if applicable_weight > 0.0 {
        round4(measured_weight / applicable_weight)
    } else {
        0.0
    };

    // --- scenarios, folded against what the PRODUCT declared ----------------
    //
    // Optional and optional TOGETHER: a per-scenario view with no envelope is
    // half an answer, and an envelope with no view behind it is a claim about
    // branches nobody listed. Absent on both sides is a result written before
    // scenarios existed, and it must ingest exactly as it always did.
    let scenarios = match (&result.scenarios, &result.envelope) {
        (None, None) => None,
        (Some(_), None) => {
            return Err(AppError::Validation(
                "scenarios without an envelope: the per-scenario view and the envelope \
                 are written together"
                    .into(),
            ))
        }
        (None, Some(_)) => {
            return Err(AppError::Validation(
                "envelope without scenarios: an envelope with nothing behind it is a \
                 claim about branches nobody listed"
                    .into(),
            ))
        }
        (Some(reported_raw), Some(envelope_raw)) => {
            let reported = validate_scenario_reports(reported_raw, &kind)?;
            let fold = aggregate_scenarios(declared, &reported, &trust_state);

            // The same posture the numbers above are held to: the envelope is
            // RECOMPUTED here and a disagreement is refused rather than
            // corrected, because a disagreement means the skill and the app
            // are folding differently and storing our answer would hide it.
            for (key, ours) in [
                ("holds", &fold.envelope.holds),
                ("weak", &fold.envelope.weak),
                ("unmeasured", &fold.envelope.unmeasured),
                ("out_of_scope", &fold.envelope.out_of_scope),
                ("proposed", &fold.envelope.proposed),
            ] {
                let theirs = envelope_bucket(envelope_raw, key)?;
                if theirs != sorted(ours) {
                    return Err(AppError::Validation(format!(
                        "result.json states envelope.{key} {theirs:?} but its own scenarios \
                         give {:?} - the council does not get to state its own envelope",
                        sorted(ours)
                    )));
                }
            }
            if let Some(object) = envelope_raw.as_object() {
                for key in object.keys() {
                    if !["holds", "weak", "unmeasured", "out_of_scope", "proposed"]
                        .contains(&key.as_str())
                    {
                        return Err(AppError::Validation(format!(
                            "envelope: unknown bucket {key}"
                        )));
                    }
                }
            }

            // S9: every floor hit owes exactly one line a person can read.
            // Presence, not position: the skill appends these among other
            // lines and de-duplicates the whole list, so an order check here
            // would be a check on the skill's line ordering rather than on
            // whether the objection reached the report.
            for line in &fold.must_address {
                if !must_address.iter().any(|m| m == line) {
                    return Err(AppError::Validation(format!(
                        "must_address is missing the line this scenario floor hit owes: `{line}`"
                    )));
                }
            }

            let discovered: Vec<ScenarioReport> = reported
                .iter()
                .filter(|r| !declared.iter().any(|d| d.slug == r.slug))
                .cloned()
                .collect();
            Some(ValidatedScenarios {
                reported: reported.iter().map(|r| r.slug.clone()).collect(),
                discovered,
                fold,
            })
        }
    };

    let outcome = recompute_outcome(
        hard_failures.len(),
        binding_floor_hit,
        scenarios
            .as_ref()
            .is_some_and(|s| !s.fold.binding_floor_hits.is_empty()),
        result.round_no,
        coverage,
        &trust_state,
        overall,
    );

    let disagrees = |a: Option<f64>, b: Option<f64>| match (a, b) {
        (Some(x), Some(y)) => (x - y).abs() > COUNCIL_NUMERIC_TOLERANCE,
        (None, None) => false,
        _ => true,
    };
    if disagrees(result.overall, overall) {
        return Err(AppError::Validation(format!(
            "result.json states overall {:?} but its own dimensions give {:?} \
             - the council does not get to state its own verdict",
            result.overall, overall
        )));
    }
    if disagrees(Some(result.coverage), Some(coverage)) {
        return Err(AppError::Validation(format!(
            "result.json states coverage {} but its own dimensions give {coverage}",
            result.coverage
        )));
    }
    if result.outcome.trim() != outcome {
        return Err(AppError::Validation(format!(
            "result.json states outcome `{}` but the pass rule gives `{outcome}`",
            result.outcome.trim()
        )));
    }

    Ok(ValidatedCouncilRun {
        kind,
        slug,
        title,
        rubric_version,
        round_no: result.round_no,
        trust_state,
        outcome,
        overall,
        coverage,
        head_sha,
        spanned_paths_json: serde_json::to_string(&spanned).unwrap_or_else(|_| "[]".into()),
        span_digest,
        hard_failures_json: serde_json::to_string(&hard_failures).unwrap_or_else(|_| "[]".into()),
        must_address_json: serde_json::to_string(&must_address).unwrap_or_else(|_| "[]".into()),
        summary: bounded(
            if result.summary.trim().is_empty() {
                &result.subject.summary
            } else {
                &result.summary
            },
            MAX_TEXT,
            "summary",
        )?,
        started_at: result.started_at.filter(|s| !s.trim().is_empty()),
        finished_at: result.finished_at.filter(|s| !s.trim().is_empty()),
        verdicts,
        scenarios,
    })
}

/// The pass rule, in one place. `ready` means "escort this to the human", and
/// the skill can never emit anything stronger.
pub(crate) fn recompute_outcome(
    hard_failures: usize,
    binding_floor_hit: bool,
    binding_scenario_floor_hit: bool,
    round_no: i32,
    coverage: f64,
    trust_state: &str,
    overall: Option<f64>,
) -> String {
    // The ORDER is doctrine, not taste, and it is the skill's
    // (`aggregate.mjs`): the round cap is a REFUSAL TO RUN, so it is read
    // before anything the run produced. A fourth round is `stalled` even when
    // it also carries a hard failure, because the honest statement about it is
    // that the method declined to judge it again.
    if round_no > COUNCIL_MAX_ROUND {
        return "stalled".to_string();
    }
    if hard_failures > 0 || binding_floor_hit {
        return "fail".to_string();
    }
    // A binding SCENARIO floor sits with the binding dimension floors and
    // ABOVE coverage: once the judges are trusted, a must-hold branch below
    // its floor fails the run however good the mean is, which is the whole
    // reason the per-scenario view exists. Scenarios never touch `overall` or
    // `coverage` - a branch is not a rubric dimension.
    if binding_scenario_floor_hit {
        return "fail".to_string();
    }
    if coverage + COUNCIL_NUMERIC_TOLERANCE < COUNCIL_COVERAGE_FLOOR {
        return "incomplete".to_string();
    }
    if trust_state == "trusted" {
        match overall {
            Some(v) if v + COUNCIL_NUMERIC_TOLERANCE >= COUNCIL_TRUSTED_OVERALL => {}
            _ => return "fail".to_string(),
        }
    }
    "ready".to_string()
}

// ── path confinement ────────────────────────────────────────────────────────

fn runs_root(root: &Path) -> PathBuf {
    RUNS_REL
        .iter()
        .fold(root.to_path_buf(), |p, seg| p.join(seg))
}

/// Resolve one run dir, refusing anything outside the project's own runs tree.
fn resolve_run_dir(root: &Path, run_dir: &str) -> Result<PathBuf, AppError> {
    let canon = PathBuf::from(run_dir)
        .canonicalize()
        .map_err(|e| AppError::Validation(format!("Run dir not readable: {e}")))?;
    let canon_root = runs_root(root).canonicalize().map_err(|_| {
        AppError::Validation("No .personas/council/runs directory in this repo yet".into())
    })?;
    if !canon.starts_with(&canon_root) {
        return Err(AppError::Validation(
            "Run dir must be inside the project's .personas/council/runs/".into(),
        ));
    }
    Ok(canon)
}

// ── the door ────────────────────────────────────────────────────────────────

/// Ingest finished `/council` runs for one project.
///
/// `run_dir` optional - without it every un-ingested run under the project's
/// council runs tree is visited, oldest first. Guards, in order: path
/// confinement · 1 MiB cap · `schema_version` match · full validation and
/// recomputation before any write · `ingested.json` marker.
///
/// A refused run leaves NO marker, so a corrected result can be re-ingested
/// without the operator having to find and delete anything.
#[tauri::command]
pub async fn dev_tools_council_ingest(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    project_id: String,
    run_dir: Option<String>,
) -> Result<CouncilIngestSummary, AppError> {
    require_auth(&state).await?;
    let summary = ingest_council_runs(&state.db, &project_id, run_dir)?;
    if summary.runs_ingested > 0 {
        emit_council_changed(&app, &project_id);
    }
    Ok(summary)
}

pub(crate) fn emit_council_changed(app: &AppHandle, project_id: &str) {
    if let Err(e) = app.emit(
        event_name::DEV_TOOLS_COUNCIL_CHANGED,
        json!({ "projectId": project_id }),
    ) {
        tracing::warn!(event = event_name::DEV_TOOLS_COUNCIL_CHANGED, error = %e, "council: change emit failed");
    }
}

/// Body of [`dev_tools_council_ingest`], minus the IPC envelope.
pub(crate) fn ingest_council_runs(
    pool: &DbPool,
    project_id: &str,
    run_dir: Option<String>,
) -> Result<CouncilIngestSummary, AppError> {
    let project = repo::get_project_by_id(pool, project_id)?;
    let root = PathBuf::from(&project.root_path);

    let dirs: Vec<PathBuf> = match run_dir {
        Some(d) => vec![resolve_run_dir(&root, &d)?],
        None => crate::commands::infrastructure::skill_runs::ingestable_runs_oldest_first(
            &runs_root(&root),
        ),
    };

    let mut summary = CouncilIngestSummary {
        project_id: project_id.to_string(),
        ..Default::default()
    };

    for dir in dirs {
        if dir.join("ingested.json").is_file() {
            summary.runs_skipped += 1;
            continue;
        }
        match ingest_one_run(pool, project_id, &dir) {
            Ok(created_subject) => {
                summary.runs_ingested += 1;
                if created_subject {
                    summary.subjects_created += 1;
                }
            }
            Err(e) => {
                // The whole reason is the message: a council refused for a
                // reason the operator cannot read is a council nobody can fix.
                summary.refused.push(format!("{}: {e}", dir.display()));
                tracing::warn!(run = %dir.display(), error = %e, "council ingest: refused a run");
            }
        }
    }
    Ok(summary)
}

/// Ingest exactly one run directory. Returns whether it created a new subject.
fn ingest_one_run(pool: &DbPool, project_id: &str, dir: &Path) -> Result<bool, AppError> {
    let result_path = dir.join("result.json");
    let meta = std::fs::metadata(&result_path)
        .map_err(|e| AppError::Validation(format!("result.json not readable: {e}")))?;
    if meta.len() > MAX_RESULT_BYTES {
        return Err(AppError::Validation(format!(
            "result.json is {} bytes (cap {MAX_RESULT_BYTES}) - refusing to ingest",
            meta.len()
        )));
    }
    let raw = std::fs::read_to_string(&result_path)
        .map_err(|e| AppError::Validation(format!("result.json not readable: {e}")))?;

    let dir_name = dir
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| AppError::Validation("Run dir has no readable name".into()))?;
    let run_dir_str = dir.to_string_lossy().into_owned();

    if council_repo::get_run_by_dir(pool, &run_dir_str)?.is_some() {
        return Err(AppError::Validation(format!(
            "Run {run_dir_str} is already in the ledger"
        )));
    }

    // The subject must be resolvable BEFORE the round number means anything,
    // and for a feature it must resolve to a use case that exists: a council
    // on a feature this project does not have is a council on nothing.
    let peek: CouncilResult = serde_json::from_str(&raw)
        .map_err(|e| AppError::Validation(format!("result.json is not valid: {e}")))?;
    let kind = one_of(&peek.subject.kind, &COUNCIL_SUBJECT_KINDS, "subject.kind")?;
    let slug = bounded(&peek.subject.slug, 200, "subject.slug")?;
    let use_case_id = if kind == "use_case" {
        Some(
            repo::list_use_cases(pool, project_id, None)?
                .into_iter()
                .find(|u| u.slug == slug)
                .map(|u| u.id)
                .ok_or_else(|| {
                    AppError::Validation(format!(
                        "No use case with slug `{slug}` in this project - a council \
                         judges a feature this project has, or it judges nothing"
                    ))
                })?,
        )
    } else {
        None
    };

    let existing = {
        let conn = pool.get()?;
        conn.query_row(
            "SELECT id FROM dev_council_subjects
              WHERE project_id = ?1 AND kind = ?2 AND slug = ?3",
            rusqlite::params![project_id, kind, slug],
            |r| r.get::<_, String>("id"),
        )
        .ok()
    };
    let prior_round = match existing.as_deref() {
        Some(id) => council_repo::latest_run(pool, id)?
            .map(|r| r.round_no)
            .unwrap_or(0),
        None => 0,
    };

    // What the PRODUCT declares this feature's branches are. The result is
    // folded against these, never against scopes it states itself.
    let declared_rows = match use_case_id.as_deref() {
        Some(uc) => scenario_repo::list_scenarios(pool, uc)?,
        None => Vec::new(),
    };
    let declared: Vec<ScenarioDeclaration> = declared_rows
        .iter()
        .map(scenario_repo::declaration_of)
        .collect();

    // Everything is checked before anything is written.
    let validated = validate_council_result(&raw, dir_name, prior_round, &declared)?;

    // The one write that happens before the run's own transaction: a
    // DISCOVERED branch needs a row to point at. Deliberate - a `proposed`
    // scenario with no result is a branch somebody named, which is worth
    // keeping even if the run it arrived with is then refused for some other
    // reason. It gates nothing until a person adopts it.
    let mut scenario_ids: BTreeMap<String, String> = declared_rows
        .iter()
        .map(|s| (s.slug.clone(), s.id.clone()))
        .collect();
    let mut scenario_results = Vec::new();
    if let (Some(sc), Some(uc)) = (validated.scenarios.as_ref(), use_case_id.as_deref()) {
        for d in &sc.discovered {
            let created = scenario_repo::create_discovered_scenario(
                pool,
                uc,
                &d.slug,
                d.title.as_deref().unwrap_or(&d.slug),
                &d.axes.clone().unwrap_or_default(),
            )?;
            scenario_ids.insert(created.slug, created.id);
        }
        for fold in &sc.fold.scenarios {
            // Only what the member actually REPORTED on gets a row: a declared
            // branch nobody looked at is unmeasured by absence, and writing a
            // row to say so would be recording a measurement that never
            // happened.
            if !sc.reported.iter().any(|s| s == &fold.slug) {
                continue;
            }
            let Some(scenario_id) = scenario_ids.get(&fold.slug) else {
                continue;
            };
            scenario_results.push(scenario_repo::NewScenarioResult {
                scenario_id: scenario_id.clone(),
                state: fold.state.clone(),
                score: fold.score,
                confidence: fold.confidence.clone(),
                n: fold.n,
                proof: fold.proof.clone(),
                floor_hit: fold.floor_hit,
                advisory: fold.advisory,
                summary: fold.summary.clone(),
            });
        }
    }

    let (subject, created) = council_repo::upsert_subject(
        pool,
        project_id,
        &validated.kind,
        &validated.slug,
        &validated.title,
        use_case_id.as_deref(),
    )?;
    let supersedes = council_repo::latest_run(pool, &subject.id)?.map(|r| r.id);

    let run = council_repo::insert_run_full(
        pool,
        &council_repo::NewRun {
            subject_id: subject.id.clone(),
            round_no: validated.round_no,
            // Taken from the LEDGER, not from the file: the file's
            // `supersedes_run_id` is the skill's own run id, which is not the
            // key this store uses, so honouring it would store a dangling one.
            supersedes_run_id: supersedes,
            rubric_version: validated.rubric_version.clone(),
            trust_state: validated.trust_state.clone(),
            outcome: validated.outcome.clone(),
            overall: validated.overall,
            coverage: validated.coverage,
            head_sha: validated.head_sha.clone(),
            span_digest: validated.span_digest.clone(),
            spanned_paths_json: validated.spanned_paths_json.clone(),
            hard_failures_json: validated.hard_failures_json.clone(),
            must_address_json: validated.must_address_json.clone(),
            summary: validated.summary.clone(),
            run_dir: run_dir_str.clone(),
            started_at: validated.started_at.clone(),
            finished_at: validated.finished_at.clone(),
        },
        &validated.verdicts,
        &scenario_results,
    )?;

    let marker = json!({
        "ingested_at": chrono::Utc::now().to_rfc3339(),
        "schema_version": COUNCIL_RESULT_VERSION,
        "subject_id": subject.id,
        "run_id": run.id,
        "round_no": run.round_no,
        "outcome": run.outcome,
    });
    if let Err(e) = std::fs::write(
        dir.join("ingested.json"),
        serde_json::to_vec_pretty(&marker).unwrap_or_default(),
    ) {
        // Loud, not fatal: the rows already landed, and the run_dir unique
        // index refuses a second insert anyway.
        tracing::warn!(run = %dir.display(), error = %e, "council: could not write ingest marker");
    }

    tracing::info!(
        subject = %subject.id,
        round = run.round_no,
        outcome = %run.outcome,
        "ingested a council run"
    );
    Ok(created)
}

// ── The ticker's half of the door ───────────────────────────────────────────

/// Called from the fleet stale ticker, beside the notepad and ship sweeps.
///
/// **Nothing here may fail the tick**: every project is independent and every
/// failure is a `warn`, so one bad file in one repo costs exactly that one
/// project. Two jobs, in order: ingest what the skill finished, then re-check
/// drift on the approvals.
pub fn sweep_pending_council_ingests(app: &AppHandle) {
    let Some(state) = app.try_state::<Arc<AppState>>() else {
        return;
    };
    let pool = state.db.clone();
    let changed = sweep_council_ingests_core(&pool);
    for project_id in changed {
        emit_council_changed(app, &project_id);
    }
    sweep_council_drift(&pool);
}

/// Body of [`sweep_pending_council_ingests`], minus the `AppHandle`, so the
/// whole sweep is testable. Returns the projects whose council state moved.
pub(crate) fn sweep_council_ingests_core(pool: &DbPool) -> Vec<String> {
    let projects = match repo::list_projects(pool, None) {
        Ok(p) => p,
        Err(e) => {
            tracing::warn!(error = %e, "council ingest: could not list projects");
            return Vec::new();
        }
    };
    let mut changed = Vec::new();
    for project in projects {
        if project.root_path.trim().is_empty() {
            continue;
        }
        // The idle case, and it is the overwhelmingly common one. Silent.
        let root = PathBuf::from(&project.root_path);
        if crate::commands::infrastructure::skill_runs::ingestable_runs_oldest_first(&runs_root(
            &root,
        ))
        .is_empty()
        {
            continue;
        }
        match ingest_council_runs(pool, &project.id, None) {
            Ok(summary) if summary.runs_ingested > 0 => changed.push(project.id.clone()),
            Ok(_) => {}
            Err(e) => {
                tracing::warn!(project = %project.id, error = %e, "council ingest: sweep failed for a project");
            }
        }
    }
    changed
}

/// Re-check drift on every standing approval whose repo HEAD has moved.
///
/// The HEAD comparison is the whole economy of this sweep: recomputing a span
/// digest means hashing every file a feature touches, and doing that every
/// thirty seconds for every approved feature forever would be the most
/// expensive thing in the ticker. A repo whose HEAD has not moved cannot have
/// changed a tracked file, so the digest is not recomputed at all.
pub(crate) fn sweep_council_drift(pool: &DbPool) {
    let population = match council_repo::approved_subjects_for_drift(pool) {
        Ok(p) => p,
        Err(e) => {
            tracing::warn!(error = %e, "council drift: could not read the approved population");
            return;
        }
    };
    for (subject_id, root_path, head_sha, spanned_paths_json) in population {
        let root = PathBuf::from(&root_path);
        // Through the context-map modules' one synchronous git door rather
        // than a second spawn site of this module's own.
        let Some(head) = crate::commands::infrastructure::context_map_export::git_capture(
            &root,
            &["rev-parse", "HEAD"],
        ) else {
            continue;
        };
        if head == head_sha {
            continue;
        }
        // Announced, never silent: an unreadable receipt and an empty span are
        // opposite facts, and `unwrap_or_default` spells them the same
        // (census `fabricated-json-on-parse-failure`). A subject whose
        // receipt cannot be read keeps the drift it had rather than being
        // marked clean.
        let paths: Vec<String> = match serde_json::from_str(&spanned_paths_json) {
            Ok(p) => p,
            Err(e) => {
                tracing::warn!(subject = %subject_id, error = %e, "council drift: the run's receipt is unreadable - leaving the drift mark alone");
                continue;
            }
        };
        if paths.is_empty() {
            continue;
        }
        let Ok(digest) = personas_core::models::span_digest_at(&root, &paths) else {
            continue;
        };
        // Recomputed against the receipt this subject was approved on. The
        // subject row holds the last verdict; the run holds the receipt.
        let receipt_digest = council_repo::latest_run(pool, &subject_id)
            .ok()
            .flatten()
            .map(|r| r.span_digest);
        let drift = match receipt_digest {
            Some(d) if d == digest => "none",
            Some(_) => "changed",
            None => continue,
        };
        if let Err(e) = council_repo::set_drift(pool, &subject_id, drift).map(|_| ()) {
            tracing::warn!(subject = %subject_id, error = %e, "council drift: could not record the check");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A well-formed feature-v1 result whose numbers are the ones the rubric
    /// gives: value .8, craft .6, rivalry .5, robustness .7, economics .9.
    pub(super) fn good_result() -> serde_json::Value {
        // overall = .30*.8 + .25*.6 + .20*.5 + .15*.7 + .10*.9 = .685
        json!({
            "schema_version": 1,
            "run_id": "2026-09-20-1200",
            "subject": { "kind": "use_case", "slug": "checkout", "title": "Checkout", "summary": "s" },
            "rubric_version": "feature-v1",
            "round_no": 1,
            "trust_state": "uncalibrated",
            "receipt": { "head_sha": "abc", "spanned_paths": ["src/a.ts"], "span_digest": "d" },
            "hard_failures": [],
            "dimensions": [
                dim("value", "judged", "measured", Some(0.8)),
                dim("craft", "mixed", "measured", Some(0.6)),
                dim("rivalry", "judged", "measured", Some(0.5)),
                dim("robustness", "mechanical", "measured", Some(0.7)),
                dim("economics", "mechanical", "measured", Some(0.9)),
            ],
            "overall": 0.685,
            "coverage": 1.0,
            "outcome": "ready",
            "must_address": [],
            "summary": "one clean round"
        })
    }

    pub(super) fn dim(
        name: &str,
        kind: &str,
        state: &str,
        score: Option<f64>,
    ) -> serde_json::Value {
        json!({
            "dimension": name, "kind": kind, "state": state, "score": score,
            "confidence": "med", "findings": [], "evidence": [], "techniques": []
        })
    }

    fn validate(v: &serde_json::Value) -> Result<ValidatedCouncilRun, AppError> {
        validate_council_result(&v.to_string(), "2026-09-20-1200", 0, &[])
    }

    #[test]
    fn a_clean_result_validates_and_carries_the_recomputed_numbers() {
        let run = validate(&good_result()).unwrap();
        assert_eq!(run.outcome, "ready");
        assert!(
            (run.overall.unwrap() - 0.685).abs() < 1e-9,
            "{:?}",
            run.overall
        );
        assert!((run.coverage - 1.0).abs() < 1e-9);
        assert_eq!(run.verdicts.len(), 5);
        // The floor came from the rubric, not from the file.
        let value = run
            .verdicts
            .iter()
            .find(|v| v.dimension == "value")
            .unwrap();
        assert_eq!(value.floor, Some(0.40));
        assert!(!value.floor_hit, "0.8 clears a floor of 0.4");
        // `advisory` describes a floor that WAS hit and is being held inert.
        // A floor nobody hit is not advisory, it is simply unmet - the skill's
        // `normalizeDimension` says the same, and a verdict that reported
        // `advisory: true` here would read as a suppressed objection.
        assert!(!value.advisory, "advisory only ever describes a HIT floor");
    }

    #[test]
    fn refuses_an_unknown_schema_version_and_a_missing_one() {
        let mut v = good_result();
        v["schema_version"] = json!(99);
        assert!(validate(&v).unwrap_err().to_string().contains("99"));
        let mut v = good_result();
        v.as_object_mut().unwrap().remove("schema_version");
        assert!(validate(&v).is_err());
    }

    #[test]
    fn refuses_a_result_sitting_in_the_wrong_directory() {
        let err = validate_council_result(&good_result().to_string(), "some-other-dir", 0, &[])
            .unwrap_err()
            .to_string();
        assert!(err.contains("sits in directory"), "{err}");
    }

    #[test]
    fn refuses_an_unknown_closed_set_value() {
        for (path, bad) in [
            ("/subject/kind", "feature"),
            ("/rubric_version", "feature-v2"),
            ("/trust_state", "vibes"),
            ("/outcome", "approved"),
        ] {
            let mut v = good_result();
            *v.pointer_mut(path).unwrap() = json!(bad);
            assert!(validate(&v).is_err(), "{path} = {bad} must be refused");
        }
        let mut v = good_result();
        v["dimensions"][0]["confidence"] = json!("certain");
        assert!(validate(&v).is_err());
        let mut v = good_result();
        v["dimensions"][0]["state"] = json!("guessed");
        assert!(validate(&v).is_err());
        let mut v = good_result();
        v["hard_failures"] = json!([{ "code": "bad_vibes", "detail": "x" }]);
        assert!(validate(&v).is_err());
    }

    /// The property this door exists for: the judged party does not get to
    /// state its own verdict. All three numbers are checked, and a
    /// disagreement REFUSES rather than being quietly corrected.
    #[test]
    fn refuses_a_result_whose_own_numbers_disagree() {
        let mut v = good_result();
        v["overall"] = json!(0.95);
        let err = validate(&v).unwrap_err().to_string();
        assert!(
            err.contains("does not get to state its own verdict"),
            "{err}"
        );

        let mut v = good_result();
        v["coverage"] = json!(0.5);
        assert!(validate(&v).unwrap_err().to_string().contains("coverage"));

        let mut v = good_result();
        v["outcome"] = json!("fail");
        let err = validate(&v).unwrap_err().to_string();
        assert!(err.contains("pass rule gives"), "{err}");
    }

    /// Within the tolerance, a rounded number is accepted - the check is about
    /// arithmetic, not about float formatting.
    #[test]
    fn a_difference_inside_the_tolerance_is_not_a_disagreement() {
        let mut v = good_result();
        v["overall"] = json!(0.685 + 5e-7);
        assert!(validate(&v).is_ok());
        v["overall"] = json!(0.685 + 1e-4);
        assert!(validate(&v).is_err());
    }

    #[test]
    fn the_absent_value_convention_is_enforced_in_both_directions() {
        let mut v = good_result();
        v["dimensions"][0]["score"] = json!(null);
        assert!(validate(&v)
            .unwrap_err()
            .to_string()
            .contains("carries no score"));

        let mut v = good_result();
        v["dimensions"][0]["state"] = json!("unmeasured");
        let err = validate(&v).unwrap_err().to_string();
        assert!(err.contains("must not carry a score"), "{err}");
    }

    #[test]
    fn refuses_a_score_outside_zero_to_one() {
        for bad in [-0.1, 1.5] {
            let mut v = good_result();
            v["dimensions"][0]["score"] = json!(bad);
            // The stated overall no longer matches either, but the range check
            // comes first and is what the message must name.
            let err = validate(&v).unwrap_err().to_string();
            assert!(err.contains("outside 0..1"), "{bad}: {err}");
        }
    }

    /// The cheapest way to fake coverage is to omit the member you could not
    /// reach, which shrinks your own denominator. The door counts instead.
    #[test]
    fn refuses_a_result_missing_a_dimension_of_its_rubric() {
        let mut v = good_result();
        v["dimensions"].as_array_mut().unwrap().pop();
        let err = validate(&v).unwrap_err().to_string();
        assert!(err.contains("missing: economics"), "{err}");
    }

    #[test]
    fn refuses_a_dimension_that_is_not_in_the_rubric() {
        let mut v = good_result();
        v["dimensions"].as_array_mut().unwrap().push(dim(
            "reversibility",
            "mechanical",
            "measured",
            Some(0.5),
        ));
        let err = validate(&v).unwrap_err().to_string();
        assert!(err.contains("not part of rubric feature-v1"), "{err}");
    }

    #[test]
    fn a_round_must_be_the_next_one() {
        let v = good_result();
        assert!(
            validate_council_result(&v.to_string(), "2026-09-20-1200", 1, &[])
                .unwrap_err()
                .to_string()
                .contains("last round was 1")
        );
        let mut v = good_result();
        v["round_no"] = json!(2);
        assert!(validate_council_result(&v.to_string(), "2026-09-20-1200", 1, &[]).is_ok());
    }

    #[test]
    fn a_spanned_path_may_not_escape_the_project() {
        let mut v = good_result();
        v["receipt"]["spanned_paths"] = json!(["../../etc/passwd"]);
        assert!(validate(&v).unwrap_err().to_string().contains("escapes"));
    }

    /// `not_applicable` leaves BOTH sums, so a rubric whose economics does not
    /// apply still reads full coverage.
    #[test]
    fn a_not_applicable_dimension_leaves_both_sums() {
        let mut v = good_result();
        v["dimensions"][4] = dim("economics", "mechanical", "not_applicable", None);
        // overall renormalises over .90 of weight: .595 / .90 = .6611 (4dp, the
        // skill's rounding - the raw quotient differs by more than the door's
        // tolerance, which is exactly why both sides round).
        let expected = 0.6611;
        v["overall"] = json!(expected);
        v["coverage"] = json!(1.0);
        let run = validate(&v).unwrap();
        assert!((run.coverage - 1.0).abs() < 1e-9, "{}", run.coverage);
        assert!((run.overall.unwrap() - expected).abs() < 1e-9);
    }

    /// An UNMEASURED dimension leaves the numerator but stays in the
    /// denominator of coverage - that is the whole difference from
    /// `not_applicable`, and it is what pushes a thin run to `incomplete`.
    #[test]
    fn unmeasured_weight_lowers_coverage_and_can_make_a_run_incomplete() {
        let mut v = good_result();
        v["dimensions"][0] = dim("value", "judged", "unmeasured", None);
        v["dimensions"][1] = dim("craft", "mixed", "unmeasured", None);
        // measured weight = .20 + .15 + .10 = .45; coverage .45 < .60
        let expected = round4((0.20 * 0.5 + 0.15 * 0.7 + 0.10 * 0.9) / 0.45);
        v["overall"] = json!(expected);
        v["coverage"] = json!(0.45);
        v["outcome"] = json!("incomplete");
        let run = validate(&v).unwrap();
        assert_eq!(run.outcome, "incomplete");
        assert!((run.coverage - 0.45).abs() < 1e-9);
    }

    /// A council that could reach NOTHING has no opinion, and that is `null`.
    #[test]
    fn a_council_that_measured_nothing_reports_null_not_zero() {
        let mut v = good_result();
        let dims: Vec<serde_json::Value> = ["value", "craft", "rivalry", "robustness", "economics"]
            .iter()
            .map(|d| dim(d, "judged", "unmeasured", None))
            .collect();
        v["dimensions"] = json!(dims);
        v["overall"] = json!(null);
        v["coverage"] = json!(0.0);
        v["outcome"] = json!("incomplete");
        let run = validate(&v).unwrap();
        assert_eq!(run.overall, None, "unmeasured is null, never zero");
    }

    /// A mechanical floor BINDS immediately; the judged one does not, until
    /// the judged members are trusted. This is the pair the pass rule turns on.
    #[test]
    fn a_mechanical_floor_sinks_a_run_and_a_judged_one_does_not_yet() {
        let mut v = good_result();
        // robustness .3 < .50 (mechanical floor) -> fail
        v["dimensions"][3] = dim("robustness", "mechanical", "measured", Some(0.3));
        v["overall"] = json!(round4(
            0.30 * 0.8 + 0.25 * 0.6 + 0.20 * 0.5 + 0.15 * 0.3 + 0.10 * 0.9
        ));
        v["outcome"] = json!("fail");
        let run = validate(&v).unwrap();
        assert_eq!(run.outcome, "fail");
        let r = run
            .verdicts
            .iter()
            .find(|x| x.dimension == "robustness")
            .unwrap();
        assert!(r.floor_hit && !r.advisory);

        // value .2 < .40 (judged floor) while uncalibrated -> recorded, advisory, still ready
        let mut v = good_result();
        v["dimensions"][0] = dim("value", "judged", "measured", Some(0.2));
        v["overall"] = json!(round4(
            0.30 * 0.2 + 0.25 * 0.6 + 0.20 * 0.5 + 0.15 * 0.7 + 0.10 * 0.9
        ));
        let run = validate(&v).unwrap();
        assert_eq!(run.outcome, "ready");
        let value = run
            .verdicts
            .iter()
            .find(|x| x.dimension == "value")
            .unwrap();
        assert!(value.floor_hit && value.advisory);
    }

    /// Once the judged members are trusted, the value floor binds AND the
    /// overall threshold applies.
    #[test]
    fn a_trusted_run_is_held_to_the_overall_threshold_and_the_value_floor() {
        let mut v = good_result();
        v["trust_state"] = json!("trusted");
        // .685 < .70 -> fail even though nothing hit a floor
        v["outcome"] = json!("fail");
        assert_eq!(validate(&v).unwrap().outcome, "fail");

        let mut v = good_result();
        v["trust_state"] = json!("trusted");
        v["dimensions"][2] = dim("rivalry", "judged", "measured", Some(0.95));
        v["overall"] = json!(round4(
            0.30 * 0.8 + 0.25 * 0.6 + 0.20 * 0.95 + 0.15 * 0.7 + 0.10 * 0.9
        ));
        assert_eq!(validate(&v).unwrap().outcome, "ready");

        let mut v = good_result();
        v["trust_state"] = json!("trusted");
        v["dimensions"][0] = dim("value", "judged", "measured", Some(0.2));
        v["overall"] = json!(round4(
            0.30 * 0.2 + 0.25 * 0.6 + 0.20 * 0.5 + 0.15 * 0.7 + 0.10 * 0.9
        ));
        v["outcome"] = json!("fail");
        let run = validate(&v).unwrap();
        assert_eq!(run.outcome, "fail");
        let value = run
            .verdicts
            .iter()
            .find(|x| x.dimension == "value")
            .unwrap();
        assert!(!value.advisory, "a trusted run's judged floor binds");
    }

    #[test]
    fn a_hard_failure_sinks_a_run_whatever_the_scores_say() {
        let mut v = good_result();
        v["hard_failures"] =
            json!([{ "code": "credential_outside_vault", "detail": "api key in source" }]);
        v["outcome"] = json!("fail");
        let run = validate(&v).unwrap();
        assert_eq!(run.outcome, "fail");
        assert!(run.hard_failures_json.contains("credential_outside_vault"));
    }

    /// Round 4 is refused as a ROUND by the caller's `prior_round` check; a
    /// run that somehow claims round 4 is `stalled`, never `ready`.
    #[test]
    fn a_fourth_round_is_stalled() {
        let mut v = good_result();
        v["round_no"] = json!(4);
        v["outcome"] = json!("stalled");
        let run = validate_council_result(&v.to_string(), "2026-09-20-1200", 3, &[]).unwrap();
        assert_eq!(run.outcome, "stalled");
    }

    #[test]
    fn refuses_malformed_json_rather_than_the_readable_part() {
        assert!(validate_council_result(
            r#"{ "schema_version": 1, "subject": { "#,
            "2026-09-20-1200",
            0,
            &[]
        )
        .is_err());
    }

    /// The outcome function alone, over the branch table - so the ordering of
    /// the rules is pinned independently of a whole result.
    #[test]
    fn the_pass_rule_branch_table() {
        // The round cap is read FIRST: a fourth round is `stalled` even when it
        // also carries a hard failure. "The method declined to judge this
        // again" is the true statement about it.
        assert_eq!(
            recompute_outcome(1, false, false, 5, 1.0, "trusted", Some(1.0)),
            "stalled"
        );
        assert_eq!(
            recompute_outcome(1, false, false, 1, 1.0, "trusted", Some(1.0)),
            "fail"
        );
        assert_eq!(
            recompute_outcome(0, true, false, 1, 1.0, "uncalibrated", Some(1.0)),
            "fail"
        );
        assert_eq!(
            recompute_outcome(0, false, false, 4, 1.0, "uncalibrated", Some(1.0)),
            "stalled"
        );
        assert_eq!(
            recompute_outcome(0, false, false, 1, 0.59, "uncalibrated", Some(1.0)),
            "incomplete"
        );
        // exactly at the coverage floor is enough
        assert_eq!(
            recompute_outcome(0, false, false, 1, 0.60, "uncalibrated", Some(0.1)),
            "ready"
        );
        // while uncalibrated the overall only orders the queue
        assert_eq!(
            recompute_outcome(0, false, false, 1, 1.0, "uncalibrated", None),
            "ready"
        );
        // once trusted an unmeasured overall cannot pass
        assert_eq!(
            recompute_outcome(0, false, false, 1, 1.0, "trusted", None),
            "fail"
        );
        assert_eq!(
            recompute_outcome(0, false, false, 1, 1.0, "trusted", Some(0.70)),
            "ready"
        );
        // A binding SCENARIO floor sits with the dimension floors and ABOVE
        // coverage: a must-hold branch under its floor outranks a thin run.
        assert_eq!(
            recompute_outcome(0, false, true, 1, 1.0, "trusted", Some(1.0)),
            "fail"
        );
        assert_eq!(
            recompute_outcome(0, false, true, 5, 1.0, "trusted", Some(1.0)),
            "stalled",
            "the round cap still outranks it"
        );
        assert_eq!(
            recompute_outcome(0, false, true, 1, 0.1, "uncalibrated", Some(1.0)),
            "fail",
            "a binding scenario floor is read before coverage"
        );
    }

    // ----- scenarios -----

    fn declare(slug: &str, scope: &str, floor: Option<f64>) -> ScenarioDeclaration {
        ScenarioDeclaration {
            slug: slug.to_string(),
            title: format!("{slug} candidates"),
            axes: [("family".to_string(), slug.to_string())]
                .into_iter()
                .collect(),
            scope: scope.to_string(),
            floor,
        }
    }

    fn scenario(slug: &str, state: &str, score: Option<f64>) -> serde_json::Value {
        json!({
            "slug": slug,
            "title": format!("{slug} candidates"),
            "axes": { "family": slug },
            "state": state,
            "score": score,
            "confidence": "med",
            "n": 4,
            "proof": "simulated",
            "summary": "a sentence a person can read"
        })
    }

    /// A result carrying scenarios, with the envelope the fold gives.
    fn with_scenarios(
        entries: Vec<serde_json::Value>,
        envelope: serde_json::Value,
    ) -> serde_json::Value {
        let mut v = good_result();
        v["scenarios"] = json!(entries);
        v["envelope"] = envelope;
        v
    }

    fn empty_envelope() -> serde_json::Value {
        json!({ "holds": [], "weak": [], "unmeasured": [],
                "out_of_scope": [], "proposed": [] })
    }

    fn validate_with(
        v: &serde_json::Value,
        declared: &[ScenarioDeclaration],
    ) -> Result<ValidatedCouncilRun, AppError> {
        validate_council_result(&v.to_string(), "2026-09-20-1200", 0, declared)
    }

    /// A result with no `scenarios` key ingests exactly as it did before the
    /// layer existed - no fold, no rows, nothing to compare.
    #[test]
    fn a_result_written_before_scenarios_existed_still_validates() {
        let run = validate(&good_result()).unwrap();
        assert_eq!(run.scenarios, None);
        // And it does so even when the PRODUCT has declared branches: an old
        // result is silent about them, not wrong about them.
        let run = validate_with(&good_result(), &[declare("it", "must_hold", None)]).unwrap();
        assert_eq!(run.scenarios, None);
        assert_eq!(run.outcome, "ready");
    }

    /// The two halves are written together or not at all.
    #[test]
    fn scenarios_and_the_envelope_are_optional_together() {
        let mut v = good_result();
        v["scenarios"] = json!([scenario("it", "measured", Some(0.9))]);
        let err = validate(&v).unwrap_err().to_string();
        assert!(err.contains("scenarios without an envelope"), "{err}");

        let mut v = good_result();
        v["envelope"] = empty_envelope();
        let err = validate(&v).unwrap_err().to_string();
        assert!(err.contains("envelope without scenarios"), "{err}");
    }

    /// A redesign has no user branches of its own.
    #[test]
    fn an_architecture_subject_may_not_carry_scenarios() {
        let mut v = with_scenarios(
            vec![scenario("it", "measured", Some(0.9))],
            json!({ "holds": ["it"], "weak": [], "unmeasured": [],
                    "out_of_scope": [], "proposed": [] }),
        );
        v["subject"]["kind"] = json!("architecture");
        // The rubric mismatch would also refuse this, so the message is what
        // matters: the door must name the scenarios, not the dimensions.
        let err = validate(&v).unwrap_err().to_string();
        assert!(err.contains("only a use_case subject"), "{err}");
    }

    /// The absent-value convention, one layer down.
    #[test]
    fn a_scenario_may_not_lie_about_whether_it_measured_anything() {
        let mut bad = scenario("it", "measured", None);
        bad["score"] = json!(null);
        let err = validate(&with_scenarios(vec![bad], empty_envelope()))
            .unwrap_err()
            .to_string();
        assert!(err.contains("needs a score in 0..1"), "{err}");

        let err = validate(&with_scenarios(
            vec![scenario("it", "unmeasured", Some(0.4))],
            empty_envelope(),
        ))
        .unwrap_err()
        .to_string();
        assert!(err.contains("must carry score null"), "{err}");

        let mut bad = scenario("it", "measured", Some(0.9));
        bad["n"] = json!(0);
        let err = validate(&with_scenarios(vec![bad], empty_envelope()))
            .unwrap_err()
            .to_string();
        assert!(err.contains("n must be an integer >= 1 or null"), "{err}");

        let mut bad = scenario("it", "measured", Some(0.9));
        bad["axes"] = json!({ "family": { "nested": "no" } });
        let err = validate(&with_scenarios(vec![bad], empty_envelope()))
            .unwrap_err()
            .to_string();
        assert!(err.contains("must be a string"), "{err}");

        let err = validate(&with_scenarios(
            vec![
                scenario("it", "measured", Some(0.9)),
                scenario("it", "measured", Some(0.8)),
            ],
            empty_envelope(),
        ))
        .unwrap_err()
        .to_string();
        assert!(err.contains("appears twice"), "{err}");
    }

    /// The door recomputes the envelope and refuses a disagreement, the same
    /// posture `overall` / `coverage` / `outcome` are held to.
    #[test]
    fn the_council_does_not_get_to_state_its_own_envelope() {
        let declared = [declare("it", "must_hold", None)];
        let v = with_scenarios(
            vec![scenario("it", "measured", Some(0.9))],
            json!({ "holds": ["it"], "weak": [], "unmeasured": [],
                    "out_of_scope": [], "proposed": [] }),
        );
        assert!(validate_with(&v, &declared).is_ok());

        let lying = with_scenarios(
            vec![scenario("it", "measured", Some(0.2))],
            json!({ "holds": ["it"], "weak": [], "unmeasured": [],
                    "out_of_scope": [], "proposed": [] }),
        );
        let err = validate_with(&lying, &declared).unwrap_err().to_string();
        assert!(err.contains("state its own envelope"), "{err}");

        let mut extra = v.clone();
        extra["envelope"]["invented"] = json!([]);
        let err = validate_with(&extra, &declared).unwrap_err().to_string();
        assert!(err.contains("unknown bucket invented"), "{err}");
    }

    /// A slug the product never declared is DISCOVERED: scope `proposed`,
    /// in the `proposed` bucket, gating nothing.
    #[test]
    fn an_undeclared_slug_is_discovered_and_gates_nothing() {
        let v = with_scenarios(
            vec![scenario("hr", "measured", Some(0.1))],
            json!({ "holds": [], "weak": [], "unmeasured": [],
                    "out_of_scope": [], "proposed": ["hr"] }),
        );
        let run = validate_with(&v, &[]).unwrap();
        let sc = run.scenarios.as_ref().unwrap();
        assert_eq!(sc.discovered.len(), 1);
        assert_eq!(sc.discovered[0].slug, "hr");
        assert_eq!(sc.fold.scenarios[0].scope, "proposed");
        assert!(sc.fold.binding_floor_hits.is_empty());
        assert_eq!(run.outcome, "ready", "a proposal cannot sink a run");
    }

    /// The branch this whole layer exists for: a must-hold scenario below its
    /// floor is loud and inert while the judges are uncalibrated, and sinks
    /// the run once they are trusted - with the same scores either way.
    #[test]
    fn a_must_hold_floor_hit_is_advisory_then_binding() {
        let declared = [declare("marketing", "must_hold", None)];
        let line = "Scenario marketing candidates is below its floor (0.3 < 0.5)";
        let entries = vec![scenario("marketing", "measured", Some(0.3))];
        let envelope = json!({ "holds": [], "weak": ["marketing"], "unmeasured": [],
                               "out_of_scope": [], "proposed": [] });

        let mut v = with_scenarios(entries.clone(), envelope.clone());
        v["must_address"] = json!([line]);
        let run = validate_with(&v, &declared).unwrap();
        assert_eq!(run.outcome, "ready", "advisory while uncalibrated");
        let sc = run.scenarios.as_ref().unwrap();
        assert_eq!(sc.fold.advisory_floor_hits, vec!["marketing".to_string()]);
        assert!(sc.fold.binding_floor_hits.is_empty());
        assert!(sc.fold.scenarios[0].floor_hit && sc.fold.scenarios[0].advisory);

        let mut v = with_scenarios(entries, envelope);
        v["trust_state"] = json!("trusted");
        v["must_address"] = json!([line]);
        v["outcome"] = json!("fail");
        let run = validate_with(&v, &declared).unwrap();
        assert_eq!(
            run.outcome, "fail",
            "a trusted judge's scenario floor binds"
        );
        let sc = run.scenarios.as_ref().unwrap();
        assert_eq!(sc.fold.binding_floor_hits, vec!["marketing".to_string()]);
        assert!(!sc.fold.scenarios[0].advisory);
    }

    /// S9: the objection owes a line a person can read, and a result that
    /// dropped it is refused rather than stored with the complaint missing.
    #[test]
    fn a_floor_hit_that_never_reached_must_address_is_refused() {
        let declared = [declare("marketing", "must_hold", None)];
        let v = with_scenarios(
            vec![scenario("marketing", "measured", Some(0.3))],
            json!({ "holds": [], "weak": ["marketing"], "unmeasured": [],
                    "out_of_scope": [], "proposed": [] }),
        );
        let err = validate_with(&v, &declared).unwrap_err().to_string();
        assert!(err.contains("must_address is missing the line"), "{err}");
    }

    /// S8, the case two implementations disagree about most easily: a
    /// `tracked` branch buckets at a FLAT 0.5 even when it declares its own
    /// floor, and never hits one.
    #[test]
    fn a_tracked_branch_buckets_at_a_flat_half_and_never_gates() {
        let declared = [declare("ops", "tracked", Some(0.9))];
        let v = with_scenarios(
            vec![scenario("ops", "measured", Some(0.7))],
            json!({ "holds": ["ops"], "weak": [], "unmeasured": [],
                    "out_of_scope": [], "proposed": [] }),
        );
        let mut trusted = v.clone();
        trusted["trust_state"] = json!("trusted");
        trusted["outcome"] = json!("fail"); // .685 < .70 once trusted
        let run = validate_with(&trusted, &declared).unwrap();
        assert!(
            run.scenarios
                .as_ref()
                .unwrap()
                .fold
                .binding_floor_hits
                .is_empty(),
            "tracked never gates, even at 0.7 against a declared 0.9"
        );
        assert_eq!(
            run.outcome, "fail",
            "for the overall threshold, not the branch"
        );
    }
}

/// End-to-end over a real pool and a real run directory: the properties that
/// only show up once the door actually writes.
#[cfg(test)]
mod door_tests {
    use super::*;
    use crate::db::repos::dev::use_cases::create_use_case;

    fn tmp_root(tag: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!(
            "council-door-{tag}-{}-{}",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    fn write_run(root: &Path, name: &str, body: &str) -> PathBuf {
        let dir = runs_root(root).join(name);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("result.json"), body).unwrap();
        dir
    }

    fn result_json(run_id: &str, slug: &str, round: i64) -> String {
        let mut v = super::tests::good_result();
        v["run_id"] = json!(run_id);
        v["subject"]["slug"] = json!(slug);
        v["round_no"] = json!(round);
        v.to_string()
    }

    fn seeded(tmp: &Path) -> (DbPool, String) {
        let pool = crate::db::init_test_db().expect("test db");
        let root = tmp.to_string_lossy().into_owned();
        let project =
            repo::create_project(&pool, "P", &root, None, None, None, None, None).unwrap();
        create_use_case(
            &pool,
            &project.id,
            "Checkout",
            None,
            "capability",
            None,
            &[],
            Some("active"),
            "scan",
            None,
        )
        .unwrap();
        (pool, project.id)
    }

    #[test]
    fn a_run_lands_once_and_the_second_sweep_does_nothing() {
        let tmp = tmp_root("ok");
        let (pool, project_id) = seeded(&tmp);
        let dir = write_run(&tmp, "r-1", &result_json("r-1", "checkout", 1));

        let summary = ingest_council_runs(&pool, &project_id, None).unwrap();
        assert_eq!(summary.runs_ingested, 1);
        assert_eq!(summary.subjects_created, 1);
        assert!(summary.refused.is_empty(), "{:?}", summary.refused);
        assert!(dir.join("ingested.json").is_file());

        let states = council_repo::list_subject_states(&pool, Some(&project_id)).unwrap();
        assert_eq!(states.len(), 1);
        assert_eq!(states[0].state, "machine_pass", "a standard feature");
        assert_eq!(states[0].round_no, Some(1));

        let again = ingest_council_runs(&pool, &project_id, None).unwrap();
        assert_eq!(
            again.runs_ingested, 0,
            "the marker is the idempotency spine"
        );

        let _ = std::fs::remove_dir_all(&tmp);
    }

    /// A refused run writes NOTHING - not a row, and not a marker, so a
    /// corrected result can simply be re-ingested.
    #[test]
    fn a_refused_run_changes_nothing_and_leaves_no_marker() {
        let tmp = tmp_root("bad");
        let (pool, project_id) = seeded(&tmp);
        let mut v: serde_json::Value =
            serde_json::from_str(&result_json("r-1", "checkout", 1)).unwrap();
        v["overall"] = json!(0.99);
        let dir = write_run(&tmp, "r-1", &v.to_string());

        let summary = ingest_council_runs(&pool, &project_id, None).unwrap();
        assert_eq!(summary.runs_ingested, 0);
        assert_eq!(summary.refused.len(), 1);
        assert!(
            summary.refused[0].contains("state its own verdict"),
            "{:?}",
            summary.refused
        );
        assert!(
            !dir.join("ingested.json").is_file(),
            "a refusal must leave the run re-ingestable"
        );
        assert!(council_repo::list_subject_states(&pool, Some(&project_id))
            .unwrap()
            .is_empty());

        let _ = std::fs::remove_dir_all(&tmp);
    }

    /// A council on a feature this project does not have judges nothing, and
    /// the door says so rather than minting an orphan subject.
    #[test]
    fn a_use_case_subject_must_resolve_to_a_real_feature() {
        let tmp = tmp_root("ghost");
        let (pool, project_id) = seeded(&tmp);
        write_run(&tmp, "r-1", &result_json("r-1", "no-such-feature", 1));

        let summary = ingest_council_runs(&pool, &project_id, None).unwrap();
        assert_eq!(summary.runs_ingested, 0);
        assert!(
            summary.refused[0].contains("No use case with slug"),
            "{:?}",
            summary.refused
        );

        let _ = std::fs::remove_dir_all(&tmp);
    }

    /// An architecture subject has no feature row to resolve against, and is
    /// created from the result's own title.
    #[test]
    fn an_architecture_subject_is_created_from_its_title() {
        let tmp = tmp_root("arch");
        let (pool, project_id) = seeded(&tmp);
        let body = json!({
            "schema_version": 1,
            "run_id": "r-arch",
            "subject": { "kind": "architecture", "slug": "council-store",
                          "title": "Council store redesign", "summary": "s" },
            "rubric_version": "architecture-v1",
            "round_no": 1,
            "trust_state": "uncalibrated",
            "receipt": { "head_sha": "abc", "spanned_paths": [], "span_digest": "d" },
            "hard_failures": [],
            "dimensions": [
                { "dimension": "craft", "kind": "mixed", "state": "measured", "score": 0.8,
                  "confidence": "med", "findings": [], "evidence": [], "techniques": [] },
                { "dimension": "robustness", "kind": "mechanical", "state": "measured", "score": 0.7,
                  "confidence": "med", "findings": [], "evidence": [], "techniques": [] },
                { "dimension": "reversibility", "kind": "mechanical", "state": "measured", "score": 0.9,
                  "confidence": "high", "findings": [], "evidence": [], "techniques": [] },
                { "dimension": "economics", "kind": "mechanical", "state": "not_applicable",
                  "confidence": "low", "findings": [], "evidence": [], "techniques": [] }
            ],
            "overall": round4((0.35 * 0.8 + 0.30 * 0.7 + 0.25 * 0.9) / 0.90),
            "coverage": 1.0,
            "outcome": "ready",
            "must_address": [],
            "summary": "clean"
        });
        write_run(&tmp, "r-arch", &body.to_string());

        let summary = ingest_council_runs(&pool, &project_id, None).unwrap();
        assert!(summary.refused.is_empty(), "{:?}", summary.refused);
        let states = council_repo::list_subject_states(&pool, Some(&project_id)).unwrap();
        assert_eq!(states[0].kind, "architecture");
        assert_eq!(states[0].title, "Council store redesign");
        assert_eq!(states[0].tier, None, "an architecture subject has no tier");
        assert_eq!(
            states[0].state, "ready",
            "with no tier it reaches the gate rather than machine-passing"
        );

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn a_second_round_supersedes_the_first_and_a_skipped_round_is_refused() {
        let tmp = tmp_root("rounds");
        let (pool, project_id) = seeded(&tmp);
        write_run(&tmp, "r-1", &result_json("r-1", "checkout", 1));
        ingest_council_runs(&pool, &project_id, None).unwrap();

        // Round 3 with no round 2 is not the next round.
        write_run(&tmp, "r-3", &result_json("r-3", "checkout", 3));
        let summary = ingest_council_runs(&pool, &project_id, None).unwrap();
        assert_eq!(summary.runs_ingested, 0);
        assert!(summary.refused[0].contains("last round was 1"));

        write_run(&tmp, "r-2", &result_json("r-2", "checkout", 2));
        let summary = ingest_council_runs(&pool, &project_id, None).unwrap();
        assert_eq!(summary.runs_ingested, 1);
        let states = council_repo::list_subject_states(&pool, Some(&project_id)).unwrap();
        assert_eq!(states[0].round_no, Some(2));
        assert_eq!(states.len(), 1, "a second round is not a second subject");

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn the_run_dir_must_be_inside_the_projects_council_runs_tree() {
        let tmp = tmp_root("confine");
        let (pool, project_id) = seeded(&tmp);
        write_run(&tmp, "r-1", &result_json("r-1", "checkout", 1));
        let outside = tmp.join("elsewhere");
        std::fs::create_dir_all(&outside).unwrap();

        let err = ingest_council_runs(
            &pool,
            &project_id,
            Some(outside.to_string_lossy().into_owned()),
        )
        .unwrap_err()
        .to_string();
        assert!(err.contains("must be inside"), "{err}");

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn a_result_over_the_size_cap_is_refused() {
        let tmp = tmp_root("big");
        let (pool, project_id) = seeded(&tmp);
        let mut v: serde_json::Value =
            serde_json::from_str(&result_json("r-1", "checkout", 1)).unwrap();
        v["summary"] = json!("x".repeat(1_200_000));
        write_run(&tmp, "r-1", &v.to_string());

        let summary = ingest_council_runs(&pool, &project_id, None).unwrap();
        assert_eq!(summary.runs_ingested, 0);
        assert!(summary.refused[0].contains("cap"), "{:?}", summary.refused);

        let _ = std::fs::remove_dir_all(&tmp);
    }

    /// The sweep's idle case - every tick, for every project, forever.
    #[test]
    fn the_sweep_is_silent_when_there_is_nothing_to_ingest() {
        let tmp = tmp_root("idle");
        let (pool, _project_id) = seeded(&tmp);
        assert!(sweep_council_ingests_core(&pool).is_empty());
        let _ = std::fs::remove_dir_all(&tmp);
    }

    /// End to end: a declared branch is scored against its own scope, an
    /// undeclared one is created `proposed`, and both land with the run.
    #[test]
    fn scenarios_land_with_the_run_and_a_discovery_enters_proposed() {
        use crate::db::repos::dev::scenarios as scenario_repo;

        let tmp = tmp_root("scenarios");
        let (pool, project_id) = seeded(&tmp);
        let use_case = repo::list_use_cases(&pool, &project_id, None).unwrap()[0]
            .id
            .clone();
        scenario_repo::upsert_scenario(
            &pool,
            &crate::db::models::UpsertScenarioInput {
                id: None,
                use_case_id: use_case.clone(),
                slug: None,
                title: "Marketing candidates".into(),
                axes: Default::default(),
                scope: "must_hold".into(),
                floor: None,
            },
            "marketing",
        )
        .unwrap();

        let mut v: serde_json::Value =
            serde_json::from_str(&result_json("r-1", "checkout", 1)).unwrap();
        v["scenarios"] = json!([
            {
                "slug": "marketing", "title": "Marketing candidates",
                "axes": { "family": "marketing" }, "state": "measured", "score": 0.3,
                "confidence": "low", "n": 4, "proof": "simulated",
                "summary": "the question bank is engineering-shaped"
            },
            {
                "slug": "hr", "title": "HR candidates", "axes": { "family": "hr" },
                "state": "unmeasured", "score": null, "confidence": "low",
                "n": null, "proof": "claimed", "summary": ""
            }
        ]);
        v["envelope"] = json!({
            "holds": [], "weak": ["marketing"], "unmeasured": [],
            "out_of_scope": [], "proposed": ["hr"]
        });
        v["must_address"] = json!(["Scenario Marketing candidates is below its floor (0.3 < 0.5)"]);
        write_run(&tmp, "r-1", &v.to_string());

        let summary = ingest_council_runs(&pool, &project_id, None).unwrap();
        assert!(summary.refused.is_empty(), "{:?}", summary.refused);
        assert_eq!(summary.runs_ingested, 1);

        let scenarios = scenario_repo::list_scenarios(&pool, &use_case).unwrap();
        assert_eq!(scenarios.len(), 2, "the discovery was created");
        let hr = scenarios.iter().find(|s| s.slug == "hr").unwrap();
        assert_eq!(hr.scope, "proposed");
        assert_eq!(hr.source, "council");

        let run_id = council_repo::list_subject_states(&pool, Some(&project_id)).unwrap()[0]
            .latest_run_id
            .clone()
            .unwrap();
        let results = scenario_repo::list_results_for_run(&pool, &run_id).unwrap();
        assert_eq!(results.len(), 2, "both reported branches have a row");
        let marketing_id = scenarios
            .iter()
            .find(|s| s.slug == "marketing")
            .unwrap()
            .id
            .clone();
        let marketing = results
            .iter()
            .find(|r| r.scenario_id == marketing_id)
            .unwrap();
        assert_eq!(marketing.score, Some(0.3));
        assert!(
            marketing.floor_hit && marketing.advisory,
            "hit, and held inert while the judges are uncalibrated"
        );
        let hr_result = results.iter().find(|r| r.scenario_id == hr.id).unwrap();
        assert_eq!(hr_result.state, "unmeasured");
        assert_eq!(hr_result.score, None, "unmeasured is null, never zero");

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn the_sweep_ingests_and_reports_the_project_that_moved() {
        let tmp = tmp_root("sweep");
        let (pool, project_id) = seeded(&tmp);
        write_run(&tmp, "r-1", &result_json("r-1", "checkout", 1));
        assert_eq!(sweep_council_ingests_core(&pool), vec![project_id.clone()]);
        assert!(sweep_council_ingests_core(&pool).is_empty(), "then nothing");
        let _ = std::fs::remove_dir_all(&tmp);
    }
}
