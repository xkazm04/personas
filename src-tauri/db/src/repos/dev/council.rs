//! `dev_council_subjects`, `dev_council_runs`, `dev_council_verdicts` and
//! `dev_council_decisions` - the council's verdict chain.
//!
//! **There is no state column.** [`derive_council_state`] is a pure function
//! over the latest run, the standing decision and the subject's drift, and
//! [`list_subject_states`] calls it on every read. A stored state would be a
//! second copy of a fact the verdicts already carry, and the two would
//! disagree the first time a run landed while the app was closed.
//!
//! **This module never decides anything.** It stores what the ingest door
//! validated and what the decide command resolved; every rule about WHAT may
//! be written (round numbering, recomputed arithmetic, the compare-and-swap on
//! a decision) lives at those two doors, where there is a caller to refuse.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::{Arc, Mutex, OnceLock};

use crate::models::{
    CouncilDecision, CouncilOverlay, CouncilOverlaySubject, CouncilRun, CouncilRunDetail,
    CouncilSubject, CouncilSubjectState, CouncilVerdict,
};
use crate::DbPool;
use personas_core::error::AppError;
use rusqlite::{params, Row};

const SUBJECT_COLUMNS: &str = "id, project_id, kind, use_case_id, slug, title, drift, \
     drift_checked_at, created_at, updated_at";
const RUN_COLUMNS: &str = "id, subject_id, round_no, supersedes_run_id, rubric_version, \
     trust_state, outcome, overall, coverage, head_sha, span_digest, spanned_paths_json, \
     hard_failures_json, must_address_json, summary, run_dir, started_at, finished_at, ingested_at";
const VERDICT_COLUMNS: &str = "id, run_id, dimension, kind, state, score, confidence, floor, \
     floor_hit, advisory, payload_json";
const DECISION_COLUMNS: &str = "id, subject_id, run_id, decision, reason, saw_digest, \
     supersedes_decision_id, decided_at";

fn row_to_subject(row: &Row) -> rusqlite::Result<CouncilSubject> {
    Ok(CouncilSubject {
        id: row.get("id")?,
        project_id: row.get("project_id")?,
        kind: row.get("kind")?,
        use_case_id: row.get("use_case_id")?,
        slug: row.get("slug")?,
        title: row.get("title")?,
        drift: row.get("drift")?,
        drift_checked_at: row.get("drift_checked_at")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

fn row_to_run(row: &Row) -> rusqlite::Result<CouncilRun> {
    Ok(CouncilRun {
        id: row.get("id")?,
        subject_id: row.get("subject_id")?,
        round_no: row.get("round_no")?,
        supersedes_run_id: row.get("supersedes_run_id")?,
        rubric_version: row.get("rubric_version")?,
        trust_state: row.get("trust_state")?,
        outcome: row.get("outcome")?,
        overall: row.get("overall")?,
        coverage: row.get("coverage")?,
        head_sha: row.get("head_sha")?,
        span_digest: row.get("span_digest")?,
        spanned_paths_json: row.get("spanned_paths_json")?,
        hard_failures_json: row.get("hard_failures_json")?,
        must_address_json: row.get("must_address_json")?,
        summary: row.get("summary")?,
        run_dir: row.get("run_dir")?,
        started_at: row.get("started_at")?,
        finished_at: row.get("finished_at")?,
        ingested_at: row.get("ingested_at")?,
    })
}

fn row_to_verdict(row: &Row) -> rusqlite::Result<CouncilVerdict> {
    Ok(CouncilVerdict {
        id: row.get("id")?,
        run_id: row.get("run_id")?,
        dimension: row.get("dimension")?,
        kind: row.get("kind")?,
        state: row.get("state")?,
        score: row.get("score")?,
        confidence: row.get("confidence")?,
        floor: row.get("floor")?,
        floor_hit: row.get::<_, i64>("floor_hit")? != 0,
        advisory: row.get::<_, i64>("advisory")? != 0,
        payload_json: row.get("payload_json")?,
    })
}

fn row_to_decision(row: &Row) -> rusqlite::Result<CouncilDecision> {
    Ok(CouncilDecision {
        id: row.get("id")?,
        subject_id: row.get("subject_id")?,
        run_id: row.get("run_id")?,
        decision: row.get("decision")?,
        reason: row.get("reason")?,
        saw_digest: row.get("saw_digest")?,
        supersedes_decision_id: row.get("supersedes_decision_id")?,
        decided_at: row.get("decided_at")?,
    })
}

// ---------------------------------------------------------------------------
// The derived state - pure, so it can be tested without a database
// ---------------------------------------------------------------------------

/// Everything the state derivation is allowed to look at. A struct rather than
/// six positional arguments, because five of the nine states differ by exactly
/// one of these and a transposed pair would be invisible at the call site.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct CouncilStateInputs<'a> {
    /// The latest run's outcome, or `None` when the subject has never been
    /// councilled.
    pub latest_outcome: Option<&'a str>,
    /// The latest run's id, used only to decide whether the standing decision
    /// still refers to what the decider saw.
    pub latest_run_id: Option<&'a str>,
    /// 'approved' | 'rejected' on the standing decision, if there is one.
    pub decision: Option<&'a str>,
    /// The run that decision was taken on.
    pub decision_run_id: Option<&'a str>,
    /// 'major' | 'standard'; `None` for an architecture subject, which has no
    /// tier and therefore never reads `machine_pass`.
    pub tier: Option<&'a str>,
    /// 'none' | 'grown' | 'changed' | 'unknown'
    pub drift: &'a str,
}

/// The nine states, derived. The ordering is the whole rule:
///
/// 1. No run at all is `none` - and `none` is not a failure, it is a subject
///    nobody has councilled yet.
/// 2. A standing decision wins, but ONLY while it still refers to the latest
///    run. A newer run supersedes the decision and returns the subject to that
///    run's own state, which is what makes "run the next round" a real answer
///    to a rejection rather than a decision a human must first undo.
/// 3. Otherwise the latest run's outcome, with the one refinement that
///    `machine_pass` exists for: a `ready` run on a STANDARD feature is a pass
///    the machine may record on its own, because a standard feature does not
///    reach the human gate at all.
pub fn derive_council_state(inputs: &CouncilStateInputs<'_>) -> String {
    let Some(outcome) = inputs.latest_outcome else {
        return "none".to_string();
    };

    if let (Some(decision), Some(decision_run), Some(latest_run)) = (
        inputs.decision,
        inputs.decision_run_id,
        inputs.latest_run_id,
    ) {
        if decision_run == latest_run {
            return match decision {
                "approved" if inputs.drift == "changed" => "approved_drifted".to_string(),
                "approved" => "approved".to_string(),
                "rejected" => "rejected".to_string(),
                // An unknown decision token cannot be stored (the CHECK
                // refuses it), so reaching here means the vocabulary grew and
                // this function was not updated. Fall through to the run's own
                // state rather than inventing a tenth one.
                _ => return run_state(outcome, inputs.tier),
            };
        }
    }
    run_state(outcome, inputs.tier)
}

fn run_state(outcome: &str, tier: Option<&str>) -> String {
    match outcome {
        "ready" if tier == Some("standard") => "machine_pass".to_string(),
        other => other.to_string(),
    }
}

// ---------------------------------------------------------------------------
// Subjects
// ---------------------------------------------------------------------------

/// Find or create the subject a run reports on, keyed by
/// `(project_id, kind, slug)` - the same key the UNIQUE index enforces.
///
/// The title is refreshed on every ingest: a feature renamed between rounds
/// should read under its new name, and the slug is what keeps identity.
pub fn upsert_subject(
    pool: &DbPool,
    project_id: &str,
    kind: &str,
    slug: &str,
    title: &str,
    use_case_id: Option<&str>,
) -> Result<(CouncilSubject, bool), AppError> {
    timed_query!("dev_council_subjects", "council::upsert_subject", {
        let conn = pool.get()?;
        let now = chrono::Utc::now().to_rfc3339();
        let existing: Option<String> = conn
            .query_row(
                "SELECT id FROM dev_council_subjects
                  WHERE project_id = ?1 AND kind = ?2 AND slug = ?3",
                params![project_id, kind, slug],
                |r| r.get("id"),
            )
            .ok();
        let (id, created) = match existing {
            Some(id) => {
                conn.execute(
                    "UPDATE dev_council_subjects
                        SET title = ?2, use_case_id = COALESCE(?3, use_case_id), updated_at = ?4
                      WHERE id = ?1",
                    params![id, title, use_case_id, now],
                )?;
                (id, false)
            }
            None => {
                let id = uuid::Uuid::new_v4().to_string();
                conn.execute(
                    "INSERT INTO dev_council_subjects
                        (id, project_id, kind, use_case_id, slug, title, drift,
                         drift_checked_at, created_at, updated_at)
                     VALUES (?1,?2,?3,?4,?5,?6,'unknown',NULL,?7,?7)",
                    params![id, project_id, kind, use_case_id, slug, title, now],
                )?;
                (id, true)
            }
        };
        let subject = conn.query_row(
            &format!("SELECT {SUBJECT_COLUMNS} FROM dev_council_subjects WHERE id = ?1"),
            params![id],
            row_to_subject,
        )?;
        Ok((subject, created))
    })
}

pub fn get_subject(pool: &DbPool, id: &str) -> Result<Option<CouncilSubject>, AppError> {
    timed_query!("dev_council_subjects", "council::get_subject", {
        let conn = pool.get()?;
        Ok(conn
            .query_row(
                &format!("SELECT {SUBJECT_COLUMNS} FROM dev_council_subjects WHERE id = ?1"),
                params![id],
                row_to_subject,
            )
            .ok())
    })
}

/// Record what a drift check found. `checked_at` is stamped here, so a subject
/// whose drift is `unknown` with a non-null timestamp is a state that cannot
/// be written - unknown means nobody has looked.
/// Returns the subject as it now stands, so "no such subject" is an error
/// rather than a silent success: this is a primary-key-targeted write, and
/// rusqlite's affected-row count is the only thing that can tell the two apart
/// (census `blind-identity-write`).
pub fn set_drift(pool: &DbPool, subject_id: &str, drift: &str) -> Result<CouncilSubject, AppError> {
    timed_query!("dev_council_subjects", "council::set_drift", {
        let conn = pool.get()?;
        let now = chrono::Utc::now().to_rfc3339();
        let n = conn.execute(
            "UPDATE dev_council_subjects SET drift = ?2, drift_checked_at = ?3, updated_at = ?3
              WHERE id = ?1",
            params![subject_id, drift, now],
        )?;
        if n == 0 {
            return Err(AppError::NotFound(format!(
                "Council subject {subject_id} not found"
            )));
        }
        conn.query_row(
            &format!("SELECT {SUBJECT_COLUMNS} FROM dev_council_subjects WHERE id = ?1"),
            params![subject_id],
            row_to_subject,
        )
        .map_err(AppError::Database)
    })
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

/// One verdict as the door resolved it, before it has an id.
#[derive(Debug, Clone, PartialEq)]
pub struct NewVerdict {
    pub dimension: String,
    pub kind: String,
    pub state: String,
    pub score: Option<f64>,
    pub confidence: String,
    pub floor: Option<f64>,
    pub floor_hit: bool,
    pub advisory: bool,
    pub payload_json: String,
}

/// One run as the door resolved it. Every number here has already been
/// RECOMPUTED from the verdicts - the judged party does not get to state its
/// own verdict, so nothing in this struct is taken on the file's word.
#[derive(Debug, Clone, PartialEq)]
pub struct NewRun {
    pub subject_id: String,
    pub round_no: i32,
    pub supersedes_run_id: Option<String>,
    pub rubric_version: String,
    pub trust_state: String,
    pub outcome: String,
    pub overall: Option<f64>,
    pub coverage: f64,
    pub head_sha: String,
    pub span_digest: String,
    pub spanned_paths_json: String,
    pub hard_failures_json: String,
    pub must_address_json: String,
    pub summary: String,
    pub run_dir: String,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
}

/// Insert a run and its verdicts in ONE transaction.
///
/// Atomic on purpose: a run row with half its verdicts would be recomputed as
/// a different verdict on the next read, and the derived-state design means
/// nothing would ever notice. `Immediate` because the round number the caller
/// resolved was read a moment ago and is about to be written.
pub fn insert_run(
    pool: &DbPool,
    run: &NewRun,
    verdicts: &[NewVerdict],
) -> Result<CouncilRun, AppError> {
    timed_query!("dev_council_runs", "council::insert_run", {
        let mut conn = pool.get()?;
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        tx.execute(
            "INSERT INTO dev_council_runs
                (id, subject_id, round_no, supersedes_run_id, rubric_version, trust_state,
                 outcome, overall, coverage, head_sha, span_digest, spanned_paths_json,
                 hard_failures_json, must_address_json, summary, run_dir, started_at,
                 finished_at, ingested_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19)",
            params![
                id,
                run.subject_id,
                run.round_no,
                run.supersedes_run_id,
                run.rubric_version,
                run.trust_state,
                run.outcome,
                run.overall,
                run.coverage,
                run.head_sha,
                run.span_digest,
                run.spanned_paths_json,
                run.hard_failures_json,
                run.must_address_json,
                run.summary,
                run.run_dir,
                run.started_at,
                run.finished_at,
                now
            ],
        )?;
        for v in verdicts {
            tx.execute(
                "INSERT INTO dev_council_verdicts
                    (id, run_id, dimension, kind, state, score, confidence, floor,
                     floor_hit, advisory, payload_json)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
                params![
                    uuid::Uuid::new_v4().to_string(),
                    id,
                    v.dimension,
                    v.kind,
                    v.state,
                    v.score,
                    v.confidence,
                    v.floor,
                    v.floor_hit as i64,
                    v.advisory as i64,
                    v.payload_json
                ],
            )?;
        }
        tx.commit()?;
        drop(conn);
        get_run(pool, &id)?.ok_or_else(|| AppError::NotFound(format!("Council run {id} not found")))
    })
}

pub fn get_run(pool: &DbPool, id: &str) -> Result<Option<CouncilRun>, AppError> {
    timed_query!("dev_council_runs", "council::get_run", {
        let conn = pool.get()?;
        Ok(conn
            .query_row(
                &format!("SELECT {RUN_COLUMNS} FROM dev_council_runs WHERE id = ?1"),
                params![id],
                row_to_run,
            )
            .ok())
    })
}

/// The run a given directory produced, if this door already consumed it. The
/// `run_dir` unique index is what makes a re-ingest a no-op rather than a
/// second round.
pub fn get_run_by_dir(pool: &DbPool, run_dir: &str) -> Result<Option<CouncilRun>, AppError> {
    timed_query!("dev_council_runs", "council::get_run_by_dir", {
        let conn = pool.get()?;
        Ok(conn
            .query_row(
                &format!("SELECT {RUN_COLUMNS} FROM dev_council_runs WHERE run_dir = ?1"),
                params![run_dir],
                row_to_run,
            )
            .ok())
    })
}

/// The subject's newest round. Ordered by `round_no`, not by time: the round
/// number is the sequence, and a re-ingest of an older run dir must not become
/// the latest simply because it landed last.
pub fn latest_run(pool: &DbPool, subject_id: &str) -> Result<Option<CouncilRun>, AppError> {
    timed_query!("dev_council_runs", "council::latest_run", {
        let conn = pool.get()?;
        Ok(conn
            .query_row(
                &format!(
                    "SELECT {RUN_COLUMNS} FROM dev_council_runs
                  WHERE subject_id = ?1 ORDER BY round_no DESC LIMIT 1"
                ),
                params![subject_id],
                row_to_run,
            )
            .ok())
    })
}

pub fn list_verdicts(pool: &DbPool, run_id: &str) -> Result<Vec<CouncilVerdict>, AppError> {
    timed_query!("dev_council_verdicts", "council::list_verdicts", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(&format!(
            "SELECT {VERDICT_COLUMNS} FROM dev_council_verdicts WHERE run_id = ?1 \
             ORDER BY dimension"
        ))?;
        let rows = stmt.query_map(params![run_id], row_to_verdict)?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    })
}

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

/// The decision standing on this subject right now: the newest row. Older rows
/// are kept - a decision supersedes, it never rewrites.
pub fn standing_decision(
    pool: &DbPool,
    subject_id: &str,
) -> Result<Option<CouncilDecision>, AppError> {
    timed_query!("dev_council_decisions", "council::standing_decision", {
        let conn = pool.get()?;
        Ok(conn
            .query_row(
                &format!(
                    "SELECT {DECISION_COLUMNS} FROM dev_council_decisions
                      WHERE subject_id = ?1 ORDER BY decided_at DESC, rowid DESC LIMIT 1"
                ),
                params![subject_id],
                row_to_decision,
            )
            .ok())
    })
}

/// Append a decision. The caller has already checked the compare-and-swap and
/// the reason rule; this function's whole contribution is that it APPENDS -
/// `supersedes_decision_id` points at whatever was standing, and that row is
/// left exactly as it was.
pub fn insert_decision(
    pool: &DbPool,
    subject_id: &str,
    run_id: &str,
    decision: &str,
    reason: Option<&str>,
    saw_digest: &str,
) -> Result<CouncilDecision, AppError> {
    timed_query!("dev_council_decisions", "council::insert_decision", {
        let previous = standing_decision(pool, subject_id)?.map(|d| d.id);
        let conn = pool.get()?;
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO dev_council_decisions
                (id, subject_id, run_id, decision, reason, saw_digest,
                 supersedes_decision_id, decided_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
            params![id, subject_id, run_id, decision, reason, saw_digest, previous, now],
        )?;
        conn.query_row(
            &format!("SELECT {DECISION_COLUMNS} FROM dev_council_decisions WHERE id = ?1"),
            params![id],
            row_to_decision,
        )
        .map_err(AppError::Database)
    })
}

/// Every decision ever taken on a subject, newest first. The ledger, for a
/// surface that wants to show what was decided before.
pub fn list_decisions(pool: &DbPool, subject_id: &str) -> Result<Vec<CouncilDecision>, AppError> {
    timed_query!("dev_council_decisions", "council::list_decisions", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(&format!(
            "SELECT {DECISION_COLUMNS} FROM dev_council_decisions
              WHERE subject_id = ?1 ORDER BY decided_at DESC, rowid DESC"
        ))?;
        let rows = stmt.query_map(params![subject_id], row_to_decision)?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    })
}

// ---------------------------------------------------------------------------
// Which registry subjects a council lands on
// ---------------------------------------------------------------------------
//
// Two sources, in order, and they are NOT the same claim:
//
// 1. What the council's own members named. A verdict payload carries
//    `techniques: [{ subject, technique, proof }]`; the `subject` of each
//    entry, at ANY proof grade, is a registry subject this council actually
//    reasoned about. That is evidence.
// 2. Failing that, what `.ai/registry-map.json` already pairs the feature's
//    contexts with. That is a MATCH, not a claim any member made - it is the
//    weaker source and is only consulted when the stronger one is silent.
//
// Neither yielding anything returns an empty vec. The UI says "no registry
// subjects named"; it never invents one.

/// Every `techniques[].subject` a run's verdicts name, distinct and sorted.
/// Any proof grade: naming a subject is reasoning about it, which is what the
/// galaxy's focus follows. (Proof grade decides `techniques_proven`, below.)
fn named_registry_subjects(verdicts: &[CouncilVerdict]) -> Vec<String> {
    let mut out: BTreeSet<String> = BTreeSet::new();
    for v in verdicts {
        for t in technique_entries(v) {
            if let Some(s) = t.get("subject").and_then(|x| x.as_str()) {
                if !s.trim().is_empty() {
                    out.insert(s.to_string());
                }
            }
        }
    }
    out.into_iter().collect()
}

/// `(subject, technique)` pairs a run's verdicts claim EXECUTION proof for.
/// A technique a member merely inspected or was told about is an opinion -
/// the same filter `append_registry_line` applies at the registry boundary.
fn proven_technique_pairs(verdicts: &[CouncilVerdict]) -> Vec<(String, String)> {
    let mut out: Vec<(String, String)> = Vec::new();
    for v in verdicts {
        for t in technique_entries(v) {
            if t.get("proof").and_then(|p| p.as_str()) != Some("execution") {
                continue;
            }
            let (Some(subject), Some(technique)) = (
                t.get("subject").and_then(|s| s.as_str()),
                t.get("technique").and_then(|s| s.as_str()),
            ) else {
                continue;
            };
            let pair = (subject.to_string(), technique.to_string());
            if !out.contains(&pair) {
                out.push(pair);
            }
        }
    }
    out
}

/// The `techniques[]` array of one verdict payload. A payload that does not
/// parse, or carries no such array, contributes nothing - a verdict is read as
/// a document and a malformed one is not a reason to fail the whole ledger.
fn technique_entries(v: &CouncilVerdict) -> Vec<serde_json::Value> {
    serde_json::from_str::<serde_json::Value>(&v.payload_json)
        .ok()
        .as_ref()
        .and_then(|p| p.get("techniques"))
        .and_then(|t| t.as_array())
        .cloned()
        .unwrap_or_default()
}

/// Consumer-side artifact: the knowledge join `/conform` writes back into.
const REGISTRY_MAP_REL: [&str; 2] = [".ai", "registry-map.json"];
/// Cap on the registry map read. Personas' own is ~1.5 MB; 16 MiB is the
/// refusal point, not the expectation (census `unbounded-foreign-decode`).
const MAX_REGISTRY_MAP_BYTES: u64 = 16 * 1024 * 1024;
/// The confidences `build-registry-map.mjs` emits. A pair below the map's own
/// threshold is never written to the file at all, so accepting both grades is
/// accepting everything the generator published - the ladder exists so a third,
/// weaker grade added upstream would be REFUSED here rather than silently
/// widening this fallback.
const ACCEPTED_MAP_CONFIDENCES: [&str; 2] = ["strong", "probable"];

/// `context id | context name` -> registry subject slugs, from one project's
/// `.ai/registry-map.json`. Both keys are inserted because the council's link
/// is to `dev_contexts` rows and the map keys on the context-map id; a project
/// whose map predates a rescan still joins by name.
type RegistryMapIndex = BTreeMap<String, Vec<String>>;

/// (map path, mtime) -> parsed index. One slot: a queue read walks one
/// project's map many times, and the file only moves when `/conform` or a
/// rescan rewrites it. Overwritten on the next distinct key, so it cannot grow.
type MapCacheSlot = Option<(String, Arc<RegistryMapIndex>)>;
static REGISTRY_MAP_CACHE: OnceLock<Mutex<MapCacheSlot>> = OnceLock::new();

fn registry_map_index(project_root: &str) -> Option<Arc<RegistryMapIndex>> {
    if project_root.trim().is_empty() {
        return None;
    }
    let path = REGISTRY_MAP_REL
        .iter()
        .fold(std::path::PathBuf::from(project_root), |p, seg| p.join(seg));
    let meta = std::fs::metadata(&path).ok()?;
    if !meta.is_file() {
        return None;
    }
    if meta.len() > MAX_REGISTRY_MAP_BYTES {
        tracing::warn!(
            path = %path.display(),
            bytes = meta.len(),
            cap = MAX_REGISTRY_MAP_BYTES,
            "council: registry-map.json is over the cap - the context fallback is skipped for this project"
        );
        return None;
    }
    let key = format!(
        "{}\u{0}{}",
        path.to_string_lossy(),
        meta.modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis())
            .unwrap_or_default()
    );

    let cache = REGISTRY_MAP_CACHE.get_or_init(|| Mutex::new(None));
    {
        let guard = cache.lock().unwrap_or_else(|p| p.into_inner());
        if let Some((k, v)) = guard.as_ref() {
            if *k == key {
                return Some(Arc::clone(v));
            }
        }
    }

    let raw = std::fs::read_to_string(&path).ok()?;
    let parsed: serde_json::Value = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!(path = %path.display(), error = %e, "council: registry-map.json could not be parsed - no context fallback");
            return None;
        }
    };
    let built = Arc::new(parse_registry_map(&parsed));
    let mut guard = cache.lock().unwrap_or_else(|p| p.into_inner());
    *guard = Some((key, Arc::clone(&built)));
    Some(built)
}

fn parse_registry_map(v: &serde_json::Value) -> RegistryMapIndex {
    let mut out: RegistryMapIndex = BTreeMap::new();
    for row in v
        .get("contexts")
        .and_then(|x| x.as_array())
        .into_iter()
        .flatten()
    {
        let mut subjects: Vec<String> = Vec::new();
        for pair in row
            .get("subjects")
            .and_then(|x| x.as_array())
            .into_iter()
            .flatten()
        {
            let confidence = pair
                .get("confidence")
                .and_then(|x| x.as_str())
                .unwrap_or_default();
            if !ACCEPTED_MAP_CONFIDENCES.contains(&confidence) {
                continue;
            }
            // `not-applicable` is a judged verdict that this subject does NOT
            // govern the context. Carrying it into a council's focus would fly
            // the camera to a star somebody already ruled out.
            if pair.get("state").and_then(|x| x.as_str()) == Some("not-applicable") {
                continue;
            }
            let Some(slug) = pair.get("subject").and_then(|x| x.as_str()) else {
                continue;
            };
            if !subjects.iter().any(|s| s == slug) {
                subjects.push(slug.to_string());
            }
        }
        if subjects.is_empty() {
            continue;
        }
        for key in ["context", "name"] {
            if let Some(k) = row.get(key).and_then(|x| x.as_str()) {
                out.entry(k.to_string())
                    .or_default()
                    .extend(subjects.iter().cloned());
            }
        }
    }
    for v in out.values_mut() {
        v.sort();
        v.dedup();
    }
    out
}

/// The context keys (ids AND names) one use case's slice covers.
fn use_case_context_keys(pool: &DbPool, use_case_id: &str) -> Result<Vec<String>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT c.id AS id, c.name AS name
           FROM dev_use_case_contexts ucc
           JOIN dev_contexts c ON c.id = ucc.context_id
          WHERE ucc.use_case_id = ?1",
    )?;
    let rows = stmt.query_map(params![use_case_id], |r| {
        Ok((r.get::<_, String>("id")?, r.get::<_, String>("name")?))
    })?;
    let mut out = Vec::new();
    for row in rows {
        let (id, name) = row?;
        out.push(id);
        out.push(name);
    }
    Ok(out)
}

/// Source 2: the map fallback. Empty whenever the map is missing, unreadable,
/// or pairs nothing with this feature's contexts.
fn mapped_registry_subjects(
    pool: &DbPool,
    project_root: &str,
    use_case_id: Option<&str>,
) -> Result<Vec<String>, AppError> {
    let Some(uc) = use_case_id else {
        return Ok(Vec::new());
    };
    let Some(index) = registry_map_index(project_root) else {
        return Ok(Vec::new());
    };
    let keys = use_case_context_keys(pool, uc)?;
    let mut out: BTreeSet<String> = BTreeSet::new();
    for k in keys {
        if let Some(subjects) = index.get(&k) {
            out.extend(subjects.iter().cloned());
        }
    }
    Ok(out.into_iter().collect())
}

/// One project's identity as the queue shows it.
#[derive(Debug, Clone, Default)]
struct ProjectIdentity {
    name: String,
    root_path: String,
}

/// The tier of the feature a subject reports on. `None` for an architecture
/// subject, which has no tier at all - not "standard".
fn use_case_tier(pool: &DbPool, use_case_id: Option<&str>) -> Result<Option<String>, AppError> {
    let Some(uc) = use_case_id else {
        return Ok(None);
    };
    let conn = pool.get()?;
    Ok(conn
        .query_row(
            "SELECT tier FROM dev_use_cases WHERE id = ?1",
            params![uc],
            |r| r.get::<_, String>("tier"),
        )
        .ok())
}

fn project_identities(pool: &DbPool) -> Result<BTreeMap<String, ProjectIdentity>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare("SELECT id, name, root_path FROM dev_projects")?;
    let rows = stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>("id")?,
            ProjectIdentity {
                name: r.get::<_, String>("name")?,
                root_path: r.get::<_, Option<String>>("root_path")?.unwrap_or_default(),
            },
        ))
    })?;
    Ok(rows.collect::<Result<BTreeMap<_, _>, _>>()?)
}

// ---------------------------------------------------------------------------
// Read models
// ---------------------------------------------------------------------------

/// Every council subject with its state derived, optionally scoped to one
/// project.
pub fn list_subject_states(
    pool: &DbPool,
    project_id: Option<&str>,
) -> Result<Vec<CouncilSubjectState>, AppError> {
    timed_query!("dev_council_subjects", "council::list_subject_states", {
        let conn = pool.get()?;
        let mut sql = format!("SELECT {SUBJECT_COLUMNS} FROM dev_council_subjects");
        if project_id.is_some() {
            sql.push_str(" WHERE project_id = ?1");
        }
        sql.push_str(" ORDER BY title COLLATE NOCASE ASC");
        let subjects: Vec<CouncilSubject> = {
            let mut stmt = conn.prepare(&sql)?;
            let rows = match project_id {
                Some(p) => stmt.query_map(params![p], row_to_subject)?,
                None => stmt.query_map([], row_to_subject)?,
            };
            rows.collect::<Result<Vec<_>, _>>()?
        };
        drop(conn);

        let projects = project_identities(pool)?;
        let mut out = Vec::with_capacity(subjects.len());
        for s in subjects {
            let run = latest_run(pool, &s.id)?;
            let decision = standing_decision(pool, &s.id)?;
            let tier = use_case_tier(pool, s.use_case_id.as_deref())?;
            // i32, not i64: the binding these reach is `number` on the TS
            // side, and a `bigint` field would break every arithmetic use of
            // it (census `bigint-binding-field`). A rubric has six dimensions
            // and a run a handful of hard failures, so the narrower type is
            // also the honest one.
            let verdicts = match run.as_ref() {
                Some(r) => list_verdicts(pool, &r.id)?,
                None => Vec::new(),
            };
            let (floor_hits, hard_failures): (i32, i32) = match run.as_ref() {
                Some(r) => {
                    let hits = verdicts
                        .iter()
                        // An ADVISORY floor hit is recorded but does not sink
                        // the run; counting it here anyway is deliberate -- the
                        // ledger shows what the members flagged, and the
                        // outcome beside it shows what it cost.
                        .filter(|v| v.floor_hit)
                        .count() as i32;
                    let fails = serde_json::from_str::<serde_json::Value>(&r.hard_failures_json)
                        .ok()
                        .and_then(|v| v.as_array().map(|a| a.len() as i32))
                        .unwrap_or(0);
                    (hits, fails)
                }
                None => (0, 0),
            };

            let identity = projects.get(&s.project_id).cloned().unwrap_or_default();
            // Named first, matched second - never both, so the stronger claim
            // is not diluted by the weaker one.
            let mut registry_subjects = named_registry_subjects(&verdicts);
            if registry_subjects.is_empty() {
                registry_subjects =
                    mapped_registry_subjects(pool, &identity.root_path, s.use_case_id.as_deref())?;
            }

            let state = derive_council_state(&CouncilStateInputs {
                latest_outcome: run.as_ref().map(|r| r.outcome.as_str()),
                latest_run_id: run.as_ref().map(|r| r.id.as_str()),
                decision: decision.as_ref().map(|d| d.decision.as_str()),
                decision_run_id: decision.as_ref().map(|d| d.run_id.as_str()),
                tier: tier.as_deref(),
                drift: &s.drift,
            });
            // The rejection's reason is shown only while the rejection is what
            // the subject is IN. Carrying it past a newer run would caption the
            // new round with the old verdict's complaint.
            let rejection_reason = if state == "rejected" {
                decision.as_ref().and_then(|d| d.reason.clone())
            } else {
                None
            };
            let decided_at =
                if matches!(state.as_str(), "approved" | "approved_drifted" | "rejected") {
                    decision.as_ref().map(|d| d.decided_at.clone())
                } else {
                    None
                };

            out.push(CouncilSubjectState {
                id: s.id.clone(),
                project_id: s.project_id.clone(),
                kind: s.kind.clone(),
                use_case_id: s.use_case_id.clone(),
                slug: s.slug.clone(),
                title: s.title.clone(),
                state,
                tier,
                round_no: run.as_ref().map(|r| r.round_no),
                latest_run_id: run.as_ref().map(|r| r.id.clone()),
                outcome: run.as_ref().map(|r| r.outcome.clone()),
                overall: run.as_ref().and_then(|r| r.overall),
                coverage: run.as_ref().map(|r| r.coverage),
                trust_state: run.as_ref().map(|r| r.trust_state.clone()),
                floor_hits,
                hard_failures,
                drift: s.drift.clone(),
                project_name: identity.name,
                registry_subjects,
                run_dir: run.as_ref().map(|r| r.run_dir.clone()),
                finished_at: run.as_ref().and_then(|r| r.finished_at.clone()),
                decided_at,
                rejection_reason,
            });
        }
        Ok(out)
    })
}

/// What one registry subject has accumulated across every council in the
/// store, before it becomes a row.
#[derive(Debug, Default)]
struct OverlayAcc {
    approved: i32,
    rejected: i32,
    pending: i32,
    proven: BTreeSet<(String, String)>,
    projects: BTreeSet<String>,
    last: Option<String>,
}

impl OverlayAcc {
    fn saw(&mut self, stamp: Option<&str>) {
        let Some(stamp) = stamp else { return };
        if self.last.as_deref().is_none_or(|l| stamp > l) {
            self.last = Some(stamp.to_string());
        }
    }
}

/// Council signal per REGISTRY SUBJECT, across every project in the store.
///
/// The join is the one the galaxy needs and nothing else has: a star in the
/// registry, and how many councils in this machine's projects have landed on
/// it. Three properties are load-bearing:
///
/// 1. **A subject with no council signal has NO row.** Not a zero row - zero
///    approvals and never-councilled are opposite facts and a row spells them
///    the same (census `unmeasured-honesty`, `absent-entity-count-as-zero`).
///    Only a subject some council's members actually NAMED is counted; the
///    `.ai/registry-map.json` fallback that fills a single subject's
///    `registry_subjects` is deliberately NOT consulted here, because a match
///    nobody made a claim about is not signal.
/// 2. **The counts are derived, never stored.** `approved`/`rejected` read
///    the same [`derive_council_state`] the ledger does, so a run landing
///    after a rejection returns the subject to pending here too - one
///    derivation, not two.
/// 3. **`techniques_proven` counts only EXECUTION proof inside APPROVED
///    councils.** A claim is an opinion, and an opinion inside a council a
///    human refused is not evidence of anything.
pub fn council_overlay(pool: &DbPool) -> Result<CouncilOverlay, AppError> {
    timed_query!("dev_council_subjects", "council::overlay", {
        let projects = project_identities(pool)?;
        let subjects: Vec<CouncilSubject> = {
            let conn = pool.get()?;
            let mut stmt = conn.prepare(&format!(
                "SELECT {SUBJECT_COLUMNS} FROM dev_council_subjects"
            ))?;
            let rows = stmt.query_map([], row_to_subject)?;
            rows.collect::<Result<Vec<_>, _>>()?
        };

        let mut acc: BTreeMap<String, OverlayAcc> = BTreeMap::new();
        for s in subjects {
            let Some(run) = latest_run(pool, &s.id)? else {
                continue;
            };
            let verdicts = list_verdicts(pool, &run.id)?;
            let named = named_registry_subjects(&verdicts);
            if named.is_empty() {
                continue;
            }
            let decision = standing_decision(pool, &s.id)?;
            let state = derive_council_state(&CouncilStateInputs {
                latest_outcome: Some(run.outcome.as_str()),
                latest_run_id: Some(run.id.as_str()),
                decision: decision.as_ref().map(|d| d.decision.as_str()),
                decision_run_id: decision.as_ref().map(|d| d.run_id.as_str()),
                tier: use_case_tier(pool, s.use_case_id.as_deref())?.as_deref(),
                drift: &s.drift,
            });
            let decided = matches!(state.as_str(), "approved" | "approved_drifted" | "rejected");
            let approved = matches!(state.as_str(), "approved" | "approved_drifted");
            let proven = if approved {
                proven_technique_pairs(&verdicts)
            } else {
                Vec::new()
            };
            let project_name = projects.get(&s.project_id).map(|p| p.name.clone());
            let decided_at = if decided {
                decision.as_ref().map(|d| d.decided_at.as_str())
            } else {
                None
            };

            for slug in named {
                let e = acc.entry(slug).or_default();
                if approved {
                    e.approved += 1;
                } else if state == "rejected" {
                    e.rejected += 1;
                } else if state == "ready" {
                    e.pending += 1;
                }
                if let Some(p) = project_name.as_deref() {
                    if !p.is_empty() {
                        e.projects.insert(p.to_string());
                    }
                }
                e.saw(decided_at);
                e.saw(run.finished_at.as_deref());
            }

            // A technique's own `subject` decides which star it lands on, so a
            // pair is credited only to the row it names - never to every
            // subject the same council happened to touch. Every such subject
            // was named by that entry, so this can create no orphan row.
            for (subject, technique) in proven {
                acc.entry(subject.clone())
                    .or_default()
                    .proven
                    .insert((subject, technique));
            }
        }

        Ok(CouncilOverlay {
            subjects: acc
                .into_iter()
                .map(|(slug, a)| CouncilOverlaySubject {
                    slug,
                    approved: a.approved,
                    rejected: a.rejected,
                    pending: a.pending,
                    techniques_proven: a.proven.len() as i32,
                    projects: a.projects.into_iter().collect(),
                    last: a.last,
                })
                .collect(),
        })
    })
}

/// One run with its subject, its verdicts, its compare-and-swap token and
/// whether it is still the subject's latest.
pub fn get_run_detail(pool: &DbPool, run_id: &str) -> Result<CouncilRunDetail, AppError> {
    let run = get_run(pool, run_id)?
        .ok_or_else(|| AppError::NotFound(format!("Council run {run_id} not found")))?;
    let subject = get_subject(pool, &run.subject_id)?.ok_or_else(|| {
        AppError::NotFound(format!("Council subject {} not found", run.subject_id))
    })?;
    let verdicts = list_verdicts(pool, run_id)?;
    let latest = latest_run(pool, &run.subject_id)?;
    let decision = standing_decision(pool, &run.subject_id)?;
    Ok(CouncilRunDetail {
        saw_digest: run_saw_digest(&run, &verdicts),
        is_latest: latest.as_ref().map(|r| r.id.as_str()) == Some(run_id),
        run,
        subject,
        verdicts,
        decision,
    })
}

/// The compare-and-swap token for a run, computed from the run and its
/// verdicts. One function so the value the gate SHOWS and the value the decide
/// command CHECKS can never be computed two ways.
pub fn run_saw_digest(run: &CouncilRun, verdicts: &[CouncilVerdict]) -> String {
    let dims: Vec<(String, String, Option<f64>, bool)> = verdicts
        .iter()
        .map(|v| (v.dimension.clone(), v.state.clone(), v.score, v.floor_hit))
        .collect();
    personas_core::models::saw_digest(&run.id, &run.outcome, run.overall, run.coverage, &dims)
}

/// Subjects whose standing decision is `approved` on their latest run, with
/// the run's receipt - the population the drift sweep walks.
///
/// Returns `(subject_id, project_root, head_sha, spanned_paths_json)`. The
/// sweep recomputes a digest only when the repo's HEAD differs from the
/// receipt's, which is what keeps a 30 second ticker from hashing every
/// approved feature's span forever.
pub fn approved_subjects_for_drift(
    pool: &DbPool,
) -> Result<Vec<(String, String, String, String)>, AppError> {
    timed_query!(
        "dev_council_subjects",
        "council::approved_subjects_for_drift",
        {
            let conn = pool.get()?;
            let mut stmt = conn.prepare(
                "SELECT s.id AS subject_id, p.root_path AS root_path,
                r.head_sha AS head_sha, r.spanned_paths_json AS spanned_paths_json
           FROM dev_council_subjects s
           JOIN dev_projects p ON p.id = s.project_id
           JOIN dev_council_decisions d ON d.subject_id = s.id
           JOIN dev_council_runs r ON r.id = d.run_id
          WHERE d.decision = 'approved'
            AND p.root_path IS NOT NULL AND p.root_path != ''
            AND d.decided_at = (SELECT MAX(d2.decided_at) FROM dev_council_decisions d2
                                 WHERE d2.subject_id = s.id)
            AND r.round_no = (SELECT MAX(r2.round_no) FROM dev_council_runs r2
                               WHERE r2.subject_id = s.id)",
            )?;
            let rows = stmt.query_map([], |r| {
                Ok((
                    r.get::<_, String>("subject_id")?,
                    r.get::<_, String>("root_path")?,
                    r.get::<_, String>("head_sha")?,
                    r.get::<_, String>("spanned_paths_json")?,
                ))
            })?;
            Ok(rows.collect::<Result<Vec<_>, _>>()?)
        }
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repos::dev::projects::create_project;
    use crate::repos::dev::use_cases::create_use_case;

    fn inputs<'a>(
        outcome: Option<&'a str>,
        decision: Option<&'a str>,
        tier: Option<&'a str>,
        drift: &'a str,
    ) -> CouncilStateInputs<'a> {
        CouncilStateInputs {
            latest_outcome: outcome,
            latest_run_id: outcome.map(|_| "run-latest"),
            decision,
            decision_run_id: decision.map(|_| "run-latest"),
            tier,
            drift,
        }
    }

    /// All nine states, in one table. `running` is deliberately absent - it is
    /// a frontend overlay from live fleet sessions and is never derived here.
    #[test]
    fn the_nine_derived_states() {
        assert_eq!(
            derive_council_state(&inputs(None, None, None, "unknown")),
            "none"
        );
        assert_eq!(
            derive_council_state(&inputs(Some("fail"), None, Some("major"), "unknown")),
            "fail"
        );
        assert_eq!(
            derive_council_state(&inputs(Some("incomplete"), None, Some("major"), "unknown")),
            "incomplete"
        );
        assert_eq!(
            derive_council_state(&inputs(Some("stalled"), None, Some("major"), "unknown")),
            "stalled"
        );
        assert_eq!(
            derive_council_state(&inputs(Some("ready"), None, Some("major"), "unknown")),
            "ready"
        );
        // machine_pass is what a STANDARD feature gets: it never reaches the
        // human gate, so a clean run is as far as it goes.
        assert_eq!(
            derive_council_state(&inputs(Some("ready"), None, Some("standard"), "unknown")),
            "machine_pass"
        );
        assert_eq!(
            derive_council_state(&inputs(
                Some("ready"),
                Some("approved"),
                Some("major"),
                "none"
            )),
            "approved"
        );
        assert_eq!(
            derive_council_state(&inputs(
                Some("ready"),
                Some("approved"),
                Some("major"),
                "changed"
            )),
            "approved_drifted"
        );
        assert_eq!(
            derive_council_state(&inputs(
                Some("ready"),
                Some("rejected"),
                Some("major"),
                "none"
            )),
            "rejected"
        );
    }

    /// An architecture subject has no tier, so a clean run is `ready` and
    /// reaches the gate - it is never machine-passed past a human.
    #[test]
    fn an_architecture_subject_never_machine_passes() {
        assert_eq!(
            derive_council_state(&inputs(Some("ready"), None, None, "unknown")),
            "ready"
        );
    }

    /// `grown` is not `changed`: a span that only gained files carries the
    /// verdict forward, and the checkmark stays.
    #[test]
    fn only_a_changed_span_marks_an_approval() {
        for drift in ["none", "grown", "unknown"] {
            assert_eq!(
                derive_council_state(&inputs(
                    Some("ready"),
                    Some("approved"),
                    Some("major"),
                    drift
                )),
                "approved",
                "drift {drift}"
            );
        }
    }

    /// The rule that makes "run the next round" a real answer to a rejection:
    /// a run NEWER than the decision returns the subject to that run's state,
    /// with no human action required to clear the old verdict.
    #[test]
    fn a_newer_run_supersedes_the_standing_decision() {
        let superseded = CouncilStateInputs {
            latest_outcome: Some("ready"),
            latest_run_id: Some("run-2"),
            decision: Some("rejected"),
            decision_run_id: Some("run-1"),
            tier: Some("major"),
            drift: "none",
        };
        assert_eq!(derive_council_state(&superseded), "ready");

        let approved_then_reworked = CouncilStateInputs {
            decision: Some("approved"),
            ..superseded.clone()
        };
        assert_eq!(derive_council_state(&approved_then_reworked), "ready");
    }

    // ----- store-level -----

    fn seeded() -> (DbPool, String, String) {
        let pool = crate::init_test_db().unwrap();
        let project = create_project(&pool, "P", "/tmp/p", None, None, None, None, None).unwrap();
        let uc = create_use_case(
            &pool,
            &project.id,
            "Checkout conversion",
            None,
            "capability",
            None,
            &[],
            Some("active"),
            "scan",
            None,
        )
        .unwrap();
        (pool, project.id, uc.id)
    }

    fn a_run(subject_id: &str, round: i32, outcome: &str, dir: &str) -> NewRun {
        NewRun {
            subject_id: subject_id.to_string(),
            round_no: round,
            supersedes_run_id: None,
            rubric_version: "feature-v1".into(),
            trust_state: "uncalibrated".into(),
            outcome: outcome.into(),
            overall: Some(0.72),
            coverage: 1.0,
            head_sha: "abc123".into(),
            span_digest: "dig".into(),
            spanned_paths_json: "[]".into(),
            hard_failures_json: "[]".into(),
            must_address_json: "[]".into(),
            summary: "s".into(),
            run_dir: dir.into(),
            started_at: None,
            finished_at: Some("2026-09-20T01:00:00Z".into()),
        }
    }

    fn a_verdict(dim: &str, score: Option<f64>, floor_hit: bool) -> NewVerdict {
        NewVerdict {
            dimension: dim.into(),
            kind: "judged".into(),
            state: if score.is_some() {
                "measured".into()
            } else {
                "unmeasured".into()
            },
            score,
            confidence: "med".into(),
            floor: Some(0.4),
            floor_hit,
            advisory: true,
            payload_json: "{}".into(),
        }
    }

    #[test]
    fn a_subject_is_keyed_by_project_kind_and_slug() {
        let (pool, project_id, uc_id) = seeded();
        let (first, created) = upsert_subject(
            &pool,
            &project_id,
            "use_case",
            "checkout-conversion",
            "Checkout conversion",
            Some(&uc_id),
        )
        .unwrap();
        assert!(created);
        let (again, created) = upsert_subject(
            &pool,
            &project_id,
            "use_case",
            "checkout-conversion",
            "Checkout conversion v2",
            None,
        )
        .unwrap();
        assert!(!created);
        assert_eq!(first.id, again.id, "the slug is the identity");
        assert_eq!(again.title, "Checkout conversion v2", "the title follows");
        assert_eq!(
            again.use_case_id.as_deref(),
            Some(uc_id.as_str()),
            "an upsert that names no use case must not unbind one"
        );

        // Same slug, different KIND is a different subject.
        let (arch, created) = upsert_subject(
            &pool,
            &project_id,
            "architecture",
            "checkout-conversion",
            "Redesign",
            None,
        )
        .unwrap();
        assert!(created);
        assert_ne!(arch.id, first.id);
    }

    #[test]
    fn a_run_and_its_verdicts_land_together_and_read_back() {
        let (pool, project_id, uc_id) = seeded();
        let (subject, _) = upsert_subject(
            &pool,
            &project_id,
            "use_case",
            "checkout",
            "Checkout",
            Some(&uc_id),
        )
        .unwrap();
        let run = insert_run(
            &pool,
            &a_run(&subject.id, 1, "ready", "/runs/r1"),
            &[
                a_verdict("value", Some(0.8), false),
                a_verdict("craft", None, false),
            ],
        )
        .unwrap();
        assert_eq!(run.round_no, 1);
        let verdicts = list_verdicts(&pool, &run.id).unwrap();
        assert_eq!(verdicts.len(), 2);
        // The absent-value convention survives the round trip.
        let craft = verdicts.iter().find(|v| v.dimension == "craft").unwrap();
        assert_eq!(craft.score, None, "unmeasured is null, never zero");
        assert_eq!(craft.state, "unmeasured");

        assert_eq!(
            get_run_by_dir(&pool, "/runs/r1").unwrap().map(|r| r.id),
            Some(run.id.clone())
        );
        assert_eq!(latest_run(&pool, &subject.id).unwrap().unwrap().id, run.id);
    }

    #[test]
    fn a_decision_supersedes_and_never_rewrites() {
        let (pool, project_id, uc_id) = seeded();
        let (subject, _) = upsert_subject(
            &pool,
            &project_id,
            "use_case",
            "checkout",
            "Checkout",
            Some(&uc_id),
        )
        .unwrap();
        let run = insert_run(&pool, &a_run(&subject.id, 1, "ready", "/runs/r1"), &[]).unwrap();

        let first = insert_decision(
            &pool,
            &subject.id,
            &run.id,
            "rejected",
            Some("the value case is not made"),
            "dig-1",
        )
        .unwrap();
        assert_eq!(first.supersedes_decision_id, None);

        let second =
            insert_decision(&pool, &subject.id, &run.id, "approved", None, "dig-1").unwrap();
        assert_eq!(
            second.supersedes_decision_id.as_deref(),
            Some(first.id.as_str())
        );

        let ledger = list_decisions(&pool, &subject.id).unwrap();
        assert_eq!(ledger.len(), 2, "both rows survive");
        assert_eq!(
            ledger[0].id, second.id,
            "the standing decision is the newest"
        );
        let old = ledger.iter().find(|d| d.id == first.id).unwrap();
        assert_eq!(
            old.reason.as_deref(),
            Some("the value case is not made"),
            "the superseded verdict is left exactly as it was"
        );
    }

    #[test]
    fn the_state_list_reads_the_tier_off_the_feature_row() {
        let (pool, project_id, uc_id) = seeded();
        let (subject, _) = upsert_subject(
            &pool,
            &project_id,
            "use_case",
            "checkout",
            "Checkout",
            Some(&uc_id),
        )
        .unwrap();
        insert_run(
            &pool,
            &a_run(&subject.id, 1, "ready", "/runs/r1"),
            &[a_verdict("value", Some(0.8), true)],
        )
        .unwrap();

        // A standard feature reads machine_pass...
        let states = list_subject_states(&pool, Some(&project_id)).unwrap();
        assert_eq!(states.len(), 1);
        assert_eq!(states[0].tier.as_deref(), Some("standard"));
        assert_eq!(states[0].state, "machine_pass");
        assert_eq!(states[0].floor_hits, 1);
        assert_eq!(states[0].hard_failures, 0);

        // ...and the same run on a major feature waits for a human. Through
        // the repo function rather than a hand-checked-out connection: a
        // fixture that panics on acquire hides the same saturation the product
        // would (census `pool-get-unwrapped`).
        crate::repos::dev::use_cases::set_use_case_tier(&pool, &uc_id, "major").unwrap();
        let states = list_subject_states(&pool, Some(&project_id)).unwrap();
        assert_eq!(states[0].state, "ready");
        assert_eq!(states[0].rejection_reason, None);
    }

    /// The digest the gate shows and the digest the decide command checks are
    /// the same function, and it moves when a verdict moves.
    #[test]
    fn the_run_detail_carries_a_digest_that_tracks_the_verdicts() {
        let (pool, project_id, uc_id) = seeded();
        let (subject, _) = upsert_subject(
            &pool,
            &project_id,
            "use_case",
            "checkout",
            "Checkout",
            Some(&uc_id),
        )
        .unwrap();
        let run = insert_run(
            &pool,
            &a_run(&subject.id, 1, "ready", "/runs/r1"),
            &[a_verdict("value", Some(0.8), false)],
        )
        .unwrap();
        let detail = get_run_detail(&pool, &run.id).unwrap();
        assert!(detail.is_latest);
        assert_eq!(detail.verdicts.len(), 1);
        assert_eq!(
            detail.saw_digest,
            run_saw_digest(&detail.run, &detail.verdicts)
        );

        // A second round makes the first no longer the latest.
        insert_run(&pool, &a_run(&subject.id, 2, "fail", "/runs/r2"), &[]).unwrap();
        assert!(!get_run_detail(&pool, &run.id).unwrap().is_latest);
    }

    #[test]
    fn the_drift_population_is_approvals_on_the_latest_run() {
        let (pool, project_id, uc_id) = seeded();
        let (subject, _) = upsert_subject(
            &pool,
            &project_id,
            "use_case",
            "checkout",
            "Checkout",
            Some(&uc_id),
        )
        .unwrap();
        let run = insert_run(&pool, &a_run(&subject.id, 1, "ready", "/runs/r1"), &[]).unwrap();
        assert!(
            approved_subjects_for_drift(&pool).unwrap().is_empty(),
            "an undecided subject is not in the drift population"
        );

        insert_decision(&pool, &subject.id, &run.id, "approved", None, "d").unwrap();
        let population = approved_subjects_for_drift(&pool).unwrap();
        assert_eq!(population.len(), 1);
        assert_eq!(population[0].0, subject.id);
        assert_eq!(population[0].2, "abc123");

        // A newer run supersedes the approval, so the subject leaves the
        // population rather than being drift-checked against a stale receipt.
        insert_run(&pool, &a_run(&subject.id, 2, "fail", "/runs/r2"), &[]).unwrap();
        assert!(
            approved_subjects_for_drift(&pool).unwrap().is_empty(),
            "an approval the next round superseded is not a standing approval"
        );
    }

    // ----- the galaxy overlay and the registry-subject join -----

    /// A verdict whose payload names registry techniques at the given proof
    /// grades. `(subject, technique, proof)`.
    fn a_verdict_naming(pairs: &[(&str, &str, &str)]) -> NewVerdict {
        let techniques: Vec<serde_json::Value> = pairs
            .iter()
            .map(|(s, t, p)| serde_json::json!({ "subject": s, "technique": t, "proof": p }))
            .collect();
        NewVerdict {
            payload_json: serde_json::json!({ "techniques": techniques }).to_string(),
            ..a_verdict("value", Some(0.8), false)
        }
    }

    /// Two projects, six councils, every state the overlay distinguishes.
    fn overlay_fixture() -> DbPool {
        let pool = crate::init_test_db().unwrap();
        let alpha =
            create_project(&pool, "Alpha", "/tmp/alpha", None, None, None, None, None).unwrap();
        let beta =
            create_project(&pool, "Beta", "/tmp/beta", None, None, None, None, None).unwrap();

        let major = |project: &str, slug: &str| {
            let uc = create_use_case(
                &pool,
                project,
                slug,
                None,
                "capability",
                None,
                &[],
                Some("active"),
                "scan",
                None,
            )
            .unwrap();
            crate::repos::dev::use_cases::set_use_case_tier(&pool, &uc.id, "major").unwrap();
            upsert_subject(&pool, project, "use_case", slug, slug, Some(&uc.id))
                .unwrap()
                .0
        };
        let arch = |project: &str, slug: &str| {
            upsert_subject(&pool, project, "architecture", slug, slug, None)
                .unwrap()
                .0
        };

        // Approved: two subjects named, two execution proofs, one mere claim.
        let s = major(&alpha.id, "approved-one");
        let r = insert_run(
            &pool,
            &a_run(&s.id, 1, "ready", "/runs/approved-one"),
            &[a_verdict_naming(&[
                ("quality-gates", "gating-floors", "execution"),
                ("quality-gates", "wishful-thinking", "claim"),
                ("retry-backoff", "jittered-backoff", "execution"),
            ])],
        )
        .unwrap();
        insert_decision(&pool, &s.id, &r.id, "approved", None, "d").unwrap();

        // Rejected, and still rejected: no newer run.
        let s = arch(&alpha.id, "rejected-one");
        let r = insert_run(
            &pool,
            &a_run(&s.id, 1, "ready", "/runs/rejected-one"),
            &[a_verdict_naming(&[(
                "quality-gates",
                "gating-floors",
                "execution",
            )])],
        )
        .unwrap();
        insert_decision(&pool, &s.id, &r.id, "rejected", Some("not yet"), "d").unwrap();

        // Rejected THEN re-run: the newer run returns it to pending.
        let s = arch(&alpha.id, "rerun-one");
        let r1 = insert_run(
            &pool,
            &a_run(&s.id, 1, "ready", "/runs/rerun-1"),
            &[a_verdict_naming(&[(
                "quality-gates",
                "gating-floors",
                "execution",
            )])],
        )
        .unwrap();
        insert_decision(&pool, &s.id, &r1.id, "rejected", Some("no"), "d").unwrap();
        insert_run(
            &pool,
            &a_run(&s.id, 2, "ready", "/runs/rerun-2"),
            &[a_verdict_naming(&[(
                "quality-gates",
                "gating-floors",
                "execution",
            )])],
        )
        .unwrap();

        // Ready, undecided.
        let s = arch(&beta.id, "ready-one");
        insert_run(
            &pool,
            &a_run(&s.id, 1, "ready", "/runs/ready-one"),
            &[a_verdict_naming(&[(
                "retry-backoff",
                "jittered-backoff",
                "execution",
            )])],
        )
        .unwrap();

        // machine_pass: a standard feature never reaches the gate, so it is
        // neither approved nor pending - but it IS signal on the subject.
        let uc = create_use_case(
            &pool,
            &beta.id,
            "machine-one",
            None,
            "capability",
            None,
            &[],
            Some("active"),
            "scan",
            None,
        )
        .unwrap();
        let (s, _) = upsert_subject(
            &pool,
            &beta.id,
            "use_case",
            "machine-one",
            "machine-one",
            Some(&uc.id),
        )
        .unwrap();
        insert_run(
            &pool,
            &a_run(&s.id, 1, "ready", "/runs/machine-one"),
            &[a_verdict_naming(&[(
                "retry-backoff",
                "jittered-backoff",
                "execution",
            )])],
        )
        .unwrap();

        // A council that named no registry subject at all contributes nothing.
        let s = arch(&alpha.id, "silent-one");
        insert_run(
            &pool,
            &a_run(&s.id, 1, "ready", "/runs/silent-one"),
            &[a_verdict("value", Some(0.9), false)],
        )
        .unwrap();

        pool
    }

    #[test]
    fn the_overlay_counts_derived_states_per_registry_subject() {
        let pool = overlay_fixture();
        let overlay = council_overlay(&pool).unwrap();
        let by_slug: BTreeMap<&str, &CouncilOverlaySubject> = overlay
            .subjects
            .iter()
            .map(|s| (s.slug.as_str(), s))
            .collect();

        assert_eq!(
            by_slug.keys().collect::<Vec<_>>(),
            vec![&"quality-gates", &"retry-backoff"],
            "a subject no council named has NO row - not a zero row"
        );

        let qg = by_slug["quality-gates"];
        assert_eq!(qg.approved, 1);
        assert_eq!(qg.rejected, 1);
        assert_eq!(
            qg.pending, 1,
            "a run newer than a rejection returns the subject to pending"
        );
        assert_eq!(
            qg.techniques_proven, 1,
            "only execution proof, and only inside an APPROVED council"
        );
        assert_eq!(qg.projects, vec!["Alpha".to_string()]);
        assert!(qg.last.is_some());

        let rb = by_slug["retry-backoff"];
        assert_eq!(rb.approved, 1);
        assert_eq!(rb.rejected, 0);
        assert_eq!(rb.pending, 1, "machine_pass is not pending - it is done");
        assert_eq!(rb.techniques_proven, 1);
        assert_eq!(
            rb.projects,
            vec!["Alpha".to_string(), "Beta".to_string()],
            "projects are distinct NAMES across the whole store"
        );
    }

    /// An empty store produces an empty overlay and no invented rows.
    #[test]
    fn an_uncouncilled_store_has_no_overlay_rows() {
        let pool = crate::init_test_db().unwrap();
        assert!(council_overlay(&pool).unwrap().subjects.is_empty());
    }

    #[test]
    fn registry_subjects_are_named_first_and_matched_second() {
        let pool = crate::init_test_db().unwrap();
        let root = std::env::temp_dir().join(format!(
            "council-map-{}-{}",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        std::fs::create_dir_all(root.join(".ai")).unwrap();
        let project = create_project(
            &pool,
            "Mapped",
            &root.to_string_lossy(),
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap();
        let context = crate::repos::dev::contexts::create_context(
            &pool,
            &project.id,
            "agent-health",
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap();
        std::fs::write(
            root.join(".ai").join("registry-map.json"),
            serde_json::json!({
                "contexts": [{
                    "context": context.id,
                    "name": "agent-health",
                    "subjects": [
                        { "subject": "health-checks", "confidence": "strong", "state": "unknown" },
                        { "subject": "quality-gates", "confidence": "probable", "state": "deviation" },
                        { "subject": "ruled-out", "confidence": "strong", "state": "not-applicable" },
                        { "subject": "too-weak", "confidence": "speculative", "state": "unknown" }
                    ]
                }]
            })
            .to_string(),
        )
        .unwrap();

        let uc = create_use_case(
            &pool,
            &project.id,
            "Health",
            None,
            "capability",
            None,
            &[context.id.clone()],
            Some("active"),
            "scan",
            None,
        )
        .unwrap();
        let (subject, _) = upsert_subject(
            &pool,
            &project.id,
            "use_case",
            "health",
            "Health",
            Some(&uc.id),
        )
        .unwrap();

        // No run at all: the map is the only source.
        let states = list_subject_states(&pool, Some(&project.id)).unwrap();
        assert_eq!(states[0].project_name, "Mapped");
        assert_eq!(
            states[0].registry_subjects,
            vec!["health-checks".to_string(), "quality-gates".to_string()],
            "a not-applicable verdict and a confidence below the map's own \
             grades are both left out"
        );

        // A run that names subjects wins outright - the map is not merged in.
        insert_run(
            &pool,
            &a_run(&subject.id, 1, "ready", "/runs/named"),
            &[a_verdict_naming(&[("retry-backoff", "jitter", "claim")])],
        )
        .unwrap();
        let states = list_subject_states(&pool, Some(&project.id)).unwrap();
        assert_eq!(
            states[0].registry_subjects,
            vec!["retry-backoff".to_string()],
            "what the members named is not diluted by what the map matched"
        );

        let _ = std::fs::remove_dir_all(&root);
    }

    /// No map, no run, no invention.
    #[test]
    fn a_subject_with_neither_source_names_nothing() {
        let (pool, project_id, uc_id) = seeded();
        let (_s, _) = upsert_subject(
            &pool,
            &project_id,
            "use_case",
            "checkout",
            "Checkout",
            Some(&uc_id),
        )
        .unwrap();
        let states = list_subject_states(&pool, Some(&project_id)).unwrap();
        assert!(states[0].registry_subjects.is_empty());
        assert_eq!(states[0].project_name, "P");
    }

    #[test]
    fn set_drift_stamps_when_it_looked() {
        let (pool, project_id, uc_id) = seeded();
        let (subject, _) = upsert_subject(
            &pool,
            &project_id,
            "use_case",
            "checkout",
            "Checkout",
            Some(&uc_id),
        )
        .unwrap();
        assert_eq!(subject.drift, "unknown");
        assert_eq!(subject.drift_checked_at, None);
        let after = set_drift(&pool, &subject.id, "changed").unwrap();
        assert_eq!(after.drift, "changed");
        assert!(after.drift_checked_at.is_some());
        assert_eq!(get_subject(&pool, &subject.id).unwrap().unwrap(), after);
        // A subject that is not there is an error, not a quiet success.
        assert!(set_drift(&pool, "no-such-subject", "none").is_err());
    }
}
