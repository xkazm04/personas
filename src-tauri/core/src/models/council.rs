//! Council - the verdict chain for one major feature or architecture redesign.
//!
//! A council judges ONE subject across bounded members and **never admits on
//! its own**: a clean run is escorted to a human gate. Three things follow from
//! that, and every type here exists to keep one of them true.
//!
//! 1. **An unmeasured number is `None`, never `0`.** `overall` is a weighted
//!    mean over the MEASURED dimensions only; a dimension that was not measured
//!    carries `state != measured` and `score: None`. Rendering an unmeasured
//!    dimension as zero would make a council that could not reach a member look
//!    like a council that found nothing there.
//! 2. **State is DERIVED, never stored.** [`CouncilSubjectState::state`] is
//!    recomputed from the run and decision chains on every read, so it cannot
//!    drift away from the verdicts it summarises. There is no state column.
//! 3. **Supersede, never rewrite.** A new round is a new run row; a changed
//!    human decision is a new decision row pointing at the one it replaces.
//!
//! The digest helpers at the bottom are the drift spine: the `/council` skill
//! computes a span digest over the files it judged, and the app recomputes the
//! SAME digest later to answer "is the approved thing still the thing that was
//! approved". Both sides must agree byte for byte, so the algorithm is stated
//! once, here, and pinned by a shared test vector.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use ts_rs::TS;

// ---------------------------------------------------------------------------
// Closed sets. Every one of these is a CHECK constraint in e40 as well - the
// list here is what the ingest door validates against BEFORE any write, so a
// refusal names the field rather than surfacing a SQLite constraint error.
// ---------------------------------------------------------------------------

/// `dev_council_subjects.kind`.
pub const COUNCIL_SUBJECT_KINDS: [&str; 2] = ["use_case", "architecture"];
/// `dev_council_subjects.drift`. `unknown` is the state before anything has
/// been checked, and is deliberately distinct from `none` (checked, unchanged).
pub const COUNCIL_DRIFTS: [&str; 4] = ["none", "grown", "changed", "unknown"];
/// `dev_council_runs.outcome`. The skill never emits an admitting value beyond
/// `ready`, and `ready` means "escort this to the human", not "approved".
pub const COUNCIL_OUTCOMES: [&str; 4] = ["ready", "fail", "incomplete", "stalled"];
/// `dev_council_runs.trust_state` - how much the judged members have earned.
pub const COUNCIL_TRUST_STATES: [&str; 3] = ["uncalibrated", "untrusted", "trusted"];
/// `dev_council_runs.rubric_version`.
pub const COUNCIL_RUBRIC_VERSIONS: [&str; 2] = ["feature-v1", "architecture-v1"];
/// `dev_council_verdicts.dimension`.
pub const COUNCIL_DIMENSIONS: [&str; 6] = [
    "value",
    "craft",
    "rivalry",
    "robustness",
    "economics",
    "reversibility",
];
/// `dev_council_verdicts.kind` - how the dimension was arrived at.
pub const COUNCIL_VERDICT_KINDS: [&str; 3] = ["mechanical", "judged", "mixed"];
/// `dev_council_verdicts.state`. `carried` is a verdict brought forward from an
/// earlier round because the span did not change.
pub const COUNCIL_VERDICT_STATES: [&str; 4] =
    ["measured", "unmeasured", "not_applicable", "carried"];
/// `dev_council_verdicts.confidence`.
pub const COUNCIL_CONFIDENCES: [&str; 3] = ["low", "med", "high"];
/// `dev_council_decisions.decision`.
pub const COUNCIL_DECISIONS: [&str; 2] = ["approved", "rejected"];
/// `dev_use_cases.tier`. Only a `major` feature reaches the human gate.
pub const USE_CASE_TIERS: [&str; 2] = ["major", "standard"];
/// The hard-failure codes a run may declare. A hard failure sinks a run
/// whatever the scores say.
pub const COUNCIL_HARD_FAILURE_CODES: [&str; 3] = [
    "credential_outside_vault",
    "write_outside_door",
    "unbounded_foreign_decode",
];

/// The derived states a subject can be in. `running` is deliberately absent:
/// it is a frontend overlay read from live fleet sessions and is never stored
/// or derived here.
pub const COUNCIL_STATES: [&str; 9] = [
    "none",
    "fail",
    "incomplete",
    "stalled",
    "ready",
    "machine_pass",
    "approved",
    "approved_drifted",
    "rejected",
];

// ---------------------------------------------------------------------------
// The rubrics, as numbers rather than prose.
// ---------------------------------------------------------------------------

/// One dimension's place in a rubric: its member kind, its weight and its
/// floor. Mirrors one row of the skill's `rubric/<version>.json`, which is the
/// authority; these constants exist so the app can RECOMPUTE what a run claims
/// without reading the skill's files.
///
/// `kind` is what decides whether a floor binds. A MECHANICAL floor is a
/// measurement and fails the run immediately; a JUDGED one (kind `judged` or
/// `mixed`) is a model's opinion and is recorded `advisory` until the judges
/// have been shown to repeat themselves.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RubricEntry {
    pub dimension: &'static str,
    /// 'mechanical' | 'judged' | 'mixed'
    pub kind: &'static str,
    pub weight: f64,
    pub floor: Option<f64>,
}

impl RubricEntry {
    /// Anything that is not mechanical is somebody's judgment, and a judgment
    /// does not gate until it has been calibrated.
    pub fn is_judged(&self) -> bool {
        self.kind != "mechanical"
    }
}

/// `feature-v1`: value .30 (floor .40, judged) / craft .25 / rivalry .20 /
/// robustness .15 (floor .50, mechanical) / economics .10.
pub const RUBRIC_FEATURE_V1: [RubricEntry; 5] = [
    RubricEntry {
        dimension: "value",
        kind: "judged",
        weight: 0.30,
        floor: Some(0.40),
    },
    RubricEntry {
        dimension: "craft",
        kind: "mixed",
        weight: 0.25,
        floor: None,
    },
    RubricEntry {
        dimension: "rivalry",
        kind: "judged",
        weight: 0.20,
        floor: None,
    },
    RubricEntry {
        dimension: "robustness",
        kind: "mechanical",
        weight: 0.15,
        floor: Some(0.50),
    },
    RubricEntry {
        dimension: "economics",
        kind: "mechanical",
        weight: 0.10,
        floor: None,
    },
];

/// `architecture-v1`: craft .35 / robustness .30 (floor .50) / reversibility
/// .25 (floor .50) / economics .10. No value, no rivalry - a redesign is not
/// judged on market position, and its value is the feature it carries.
pub const RUBRIC_ARCHITECTURE_V1: [RubricEntry; 4] = [
    RubricEntry {
        dimension: "craft",
        kind: "mixed",
        weight: 0.35,
        floor: None,
    },
    RubricEntry {
        dimension: "robustness",
        kind: "mechanical",
        weight: 0.30,
        floor: Some(0.50),
    },
    RubricEntry {
        dimension: "reversibility",
        kind: "mechanical",
        weight: 0.25,
        floor: Some(0.50),
    },
    RubricEntry {
        dimension: "economics",
        kind: "mechanical",
        weight: 0.10,
        floor: None,
    },
];

/// The coverage floor: below this much measured weight a run is `incomplete`
/// however good the measured part looks.
pub const COUNCIL_COVERAGE_FLOOR: f64 = 0.60;
/// Round 4 is refused. Three rounds is the budget; past it the subject is
/// `stalled` and wants a human, not another council.
pub const COUNCIL_MAX_ROUND: i32 = 3;
/// The `overall` threshold that binds only once the judged members are
/// `trusted`. Stated here so the door and the skill cannot disagree about it.
pub const COUNCIL_TRUSTED_OVERALL: f64 = 0.70;
/// How far the door lets a run's own arithmetic differ from its recomputation
/// before it refuses. Floating point, not opinion.
pub const COUNCIL_NUMERIC_TOLERANCE: f64 = 1e-6;

/// Four decimal places, the way the skill's `aggregate.mjs` rounds.
///
/// Load-bearing, not cosmetic: the door compares the run's stated numbers
/// against its own recomputation at [`COUNCIL_NUMERIC_TOLERANCE`], and a raw
/// quotient like `0.595 / 0.90` differs from the skill's `0.6611` by 1.1e-5 -
/// a hundred times the tolerance. Rounding the same way on both sides is what
/// keeps the comparison a check on ARITHMETIC rather than on formatting.
pub fn round4(n: f64) -> f64 {
    (n * 10000.0).round() / 10000.0
}

/// The rubric a `rubric_version` names, or `None` for a version this app does
/// not know - which the door turns into a refusal rather than a default.
pub fn rubric_for(version: &str) -> Option<&'static [RubricEntry]> {
    match version {
        "feature-v1" => Some(&RUBRIC_FEATURE_V1),
        "architecture-v1" => Some(&RUBRIC_ARCHITECTURE_V1),
        _ => None,
    }
}

// ---------------------------------------------------------------------------
// Row models
// ---------------------------------------------------------------------------

/// One thing a council judges. A `use_case` subject is bound to a
/// `dev_use_cases` row; an `architecture` subject is free-standing and carries
/// its own title (its ADR lives in the vault, not here).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CouncilSubject {
    pub id: String,
    pub project_id: String,
    /// 'use_case' | 'architecture'
    pub kind: String,
    /// Set only for kind `use_case`. `ON DELETE SET NULL`: the verdict chain
    /// outlives the feature row it judged.
    pub use_case_id: Option<String>,
    pub slug: String,
    pub title: String,
    /// 'none' | 'grown' | 'changed' | 'unknown'
    pub drift: String,
    pub drift_checked_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// One council round over one subject. Runs supersede, never rewrite.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CouncilRun {
    pub id: String,
    pub subject_id: String,
    pub round_no: i32,
    pub supersedes_run_id: Option<String>,
    /// 'feature-v1' | 'architecture-v1'
    pub rubric_version: String,
    /// 'uncalibrated' | 'untrusted' | 'trusted'
    pub trust_state: String,
    /// 'ready' | 'fail' | 'incomplete' | 'stalled'
    pub outcome: String,
    /// Weighted mean over MEASURED dimensions. `None` when nothing was
    /// measured - never `0.0`.
    pub overall: Option<f64>,
    /// Measured weight over applicable weight. Always known, so not optional.
    pub coverage: f64,
    pub head_sha: String,
    pub span_digest: String,
    /// JSON array of repo-relative paths the run judged.
    pub spanned_paths_json: String,
    /// JSON array of `{code, detail}`.
    pub hard_failures_json: String,
    /// JSON array of strings.
    pub must_address_json: String,
    pub summary: String,
    pub run_dir: String,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub ingested_at: String,
}

/// One member's verdict inside a run.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CouncilVerdict {
    pub id: String,
    pub run_id: String,
    /// 'value' | 'craft' | 'rivalry' | 'robustness' | 'economics' | 'reversibility'
    pub dimension: String,
    /// 'mechanical' | 'judged' | 'mixed'
    pub kind: String,
    /// 'measured' | 'unmeasured' | 'not_applicable' | 'carried'
    pub state: String,
    /// `None` unless `state` is `measured` or `carried`. Never `0.0` as a
    /// stand-in for "we could not tell".
    pub score: Option<f64>,
    /// 'low' | 'med' | 'high'
    pub confidence: String,
    pub floor: Option<f64>,
    pub floor_hit: bool,
    /// A floor hit that is RECORDED but does not sink the run, because the
    /// member that raised it has not earned the authority yet.
    pub advisory: bool,
    /// The member's findings, evidence, techniques and delta, verbatim from
    /// result.json. Read as a document; never queried column-wise.
    pub payload_json: String,
}

/// A human's verdict on a run. The ONLY row in this whole chain a person
/// writes, and the only one that can admit anything.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CouncilDecision {
    pub id: String,
    pub subject_id: String,
    /// `ON DELETE RESTRICT`: the run a person looked at cannot be deleted out
    /// from under the decision that cites it.
    pub run_id: String,
    /// 'approved' | 'rejected'
    pub decision: String,
    /// Mandatory and non-blank when `decision` is `rejected`.
    pub reason: Option<String>,
    /// The digest of what the decider was looking at, captured at the moment
    /// they decided. The decide command compares it against the run's current
    /// digest and refuses on a mismatch, so a decision can never be recorded
    /// against a page that had already moved.
    pub saw_digest: String,
    pub supersedes_decision_id: Option<String>,
    pub decided_at: String,
}

// ---------------------------------------------------------------------------
// Read models
// ---------------------------------------------------------------------------

/// One council subject with its state DERIVED from the run and decision
/// chains. Nothing here is a stored state column: `state` is recomputed on
/// every read so it cannot drift from the verdicts it summarises.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CouncilSubjectState {
    pub id: String,
    pub project_id: String,
    /// 'use_case' | 'architecture'
    pub kind: String,
    pub use_case_id: Option<String>,
    pub slug: String,
    pub title: String,
    /// 'none' | 'fail' | 'incomplete' | 'stalled' | 'ready' | 'machine_pass' |
    /// 'approved' | 'approved_drifted' | 'rejected'
    pub state: String,
    /// 'major' | 'standard' for a use case; null for an architecture subject.
    pub tier: Option<String>,
    pub round_no: Option<i32>,
    pub latest_run_id: Option<String>,
    /// 'ready' | 'fail' | 'incomplete' | 'stalled' - the latest run's own outcome.
    pub outcome: Option<String>,
    /// Weighted mean over MEASURED dimensions. Null means unmeasured, never zero.
    pub overall: Option<f64>,
    pub coverage: Option<f64>,
    /// 'uncalibrated' | 'untrusted' | 'trusted'
    pub trust_state: Option<String>,
    pub floor_hits: i32,
    pub hard_failures: i32,
    /// 'none' | 'grown' | 'changed' | 'unknown'
    pub drift: String,
    /// The project's display name, for a queue that spans every project.
    pub project_name: String,
    /// Registry subject slugs this council lands on: named by its members, else
    /// matched from the feature's contexts. This is what council focus flies to.
    pub registry_subjects: Vec<String>,
    pub run_dir: Option<String>,
    pub finished_at: Option<String>,
    pub decided_at: Option<String>,
    pub rejection_reason: Option<String>,
}

/// Council signal on ONE registry subject, across every project in the local
/// store. A subject with no row has never been councilled, which is NOT the
/// same as zero.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CouncilOverlaySubject {
    pub slug: String,
    pub approved: i32,
    pub rejected: i32,
    pub pending: i32,
    /// Distinct techniques named with execution-grade proof in approved councils.
    pub techniques_proven: i32,
    pub projects: Vec<String>,
    pub last: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CouncilOverlay {
    pub subjects: Vec<CouncilOverlaySubject>,
}

/// One evidence file read from inside a run directory. Path-confined by the
/// door; the frontend turns the bytes into an object URL.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CouncilMedia {
    pub mime: String,
    pub bytes: Vec<u8>,
}

/// One run with everything the human gate needs to look at, including the
/// `saw_digest` it must hand back when it decides.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CouncilRunDetail {
    pub run: CouncilRun,
    pub subject: CouncilSubject,
    pub verdicts: Vec<CouncilVerdict>,
    /// The compare-and-swap token. A decision quoting a stale digest is
    /// refused rather than recorded.
    pub saw_digest: String,
    /// Whether this run is still the subject's latest. A decision may only be
    /// taken on the latest run.
    pub is_latest: bool,
    /// The decision standing on this subject right now, if any.
    pub decision: Option<CouncilDecision>,
}

/// What one pass through the council ingest door did. The door refuses rather
/// than partially applies, so `refused` carries the whole reason per run dir.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CouncilIngestSummary {
    pub project_id: String,
    pub runs_ingested: u32,
    pub runs_skipped: u32,
    pub subjects_created: u32,
    /// `<run dir>: <reason>` for every result the door refused. Nothing was
    /// written for these.
    pub refused: Vec<String>,
}

/// What one relink pass did. Counts rather than a bare bool, because
/// "nothing needed relinking" and "nothing could be relinked" are opposite
/// answers and a bool spells them the same.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct UseCaseRelinkSummary {
    pub project_id: String,
    pub scan_id: String,
    /// Use cases the model was given.
    pub considered: u32,
    /// Use cases whose slice was rewritten.
    pub relinked: u32,
    /// Slugs the model answered for that this project does not have.
    pub unknown_slugs: Vec<String>,
    /// Context names the model answered with that the map does not have.
    pub unknown_contexts: Vec<String>,
    /// Use cases kept but left UNLINKED because fewer than two contexts
    /// resolved: a use case is a slice THROUGH contexts, and one context is a
    /// module. Counted rather than rejected - the row stays, the link does not.
    pub under_spanned: Vec<String>,
}

// ---------------------------------------------------------------------------
// The span digest - the drift spine
// ---------------------------------------------------------------------------

/// Directories that are never part of a span: build or tool state, not work.
/// Byte-for-byte the skill's `SPAN_SKIP_DIRS` (`receipt.mjs`).
pub const SPAN_SKIP_DIRS: [&str; 7] = [
    ".git",
    "node_modules",
    "target",
    "dist",
    ".next",
    ".venv",
    "__pycache__",
];

fn file_digest(bytes: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(bytes);
    hex::encode(h.finalize())
}

/// The cross-language content digest, stated once so the skill and the app
/// cannot disagree about what "the same tree" means.
///
/// Steps 3-5 of the contract at the head of the skill's
/// `scripts/lib/receipt.mjs`: per file the line `<path>\0<sha256 hex of the
/// file bytes>`, paths POSIX and repo-relative, lines sorted by BYTE order,
/// joined with a newline and **no trailing newline**, then sha256 of that UTF-8
/// string as lowercase hex.
///
/// The `\0` separator is load-bearing: with a plain concatenation the pairs
/// (`a`, `bc...`) and (`ab`, `c...`) produce the same line.
///
/// Takes the per-file hashes rather than the bytes, so the caller decides
/// which files exist - see [`span_digest_at`] for the rule.
pub fn span_digest(entries: &[(String, String)]) -> String {
    let mut lines: Vec<String> = entries
        .iter()
        .map(|(path, digest)| format!("{path}\0{digest}"))
        .collect();
    lines.sort();
    let mut h = Sha256::new();
    h.update(lines.join("\n").as_bytes());
    hex::encode(h.finalize())
}

/// Expand one declared span entry into the repo-relative POSIX paths of the
/// regular files under it, the way the skill's `expandSpan` does: a file is
/// itself, a directory is every regular file beneath it minus
/// [`SPAN_SKIP_DIRS`], and **a path that is not there expands to nothing**.
///
/// That last rule is the one a port gets wrong. A missing file is not hashed
/// as some sentinel value - its LINE DISAPPEARS, which changes the digest just
/// as surely and keeps the two implementations agreeing about a deleted file.
fn expand_span(root: &std::path::Path, rel: &str) -> Vec<String> {
    let abs = root.join(rel.replace('/', std::path::MAIN_SEPARATOR_STR));
    let Ok(meta) = std::fs::metadata(&abs) else {
        return Vec::new();
    };
    if meta.is_file() {
        return vec![rel.to_string()];
    }
    if !meta.is_dir() {
        return Vec::new();
    }
    let mut out = Vec::new();
    let mut stack = vec![(abs, rel.to_string())];
    while let Some((dir_abs, dir_rel)) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir_abs) else {
            continue;
        };
        for e in entries.flatten() {
            let name = e.file_name().to_string_lossy().into_owned();
            let Ok(ft) = e.file_type() else { continue };
            if ft.is_dir() {
                if SPAN_SKIP_DIRS.contains(&name.as_str()) {
                    continue;
                }
                stack.push((e.path(), format!("{dir_rel}/{name}")));
            } else if ft.is_file() {
                out.push(format!("{dir_rel}/{name}"));
            }
        }
    }
    out.sort();
    out
}

/// Normalise one declared span entry: POSIX separators, no leading `./`, no
/// trailing slash, never absolute, never escaping the root. A path the council
/// cannot name is a path it must not read, so this refuses rather than
/// sanitising.
pub fn normalize_span_path(p: &str) -> Result<String, String> {
    let raw = p.trim();
    if raw.is_empty() {
        return Err("empty spanned path".to_string());
    }
    // Three spellings of "absolute", because the platform's own answer is not
    // enough: `Path::is_absolute` on Windows says `/etc/passwd` is RELATIVE
    // (no drive), and a span that reads as relative on one host and absolute
    // on another is a confinement check that depends on where it runs. Node's
    // `path.isAbsolute` on win32 accepts a bare leading separator, so matching
    // it here is also what keeps the two implementations agreeing.
    let bytes = raw.as_bytes();
    let drive_qualified = bytes
        .get(1)
        .is_some_and(|c| *c == b':' && bytes[0].is_ascii_alphabetic());
    if std::path::Path::new(raw).is_absolute()
        || matches!(bytes.first(), Some(b'/') | Some(b'\\'))
        || drive_qualified
    {
        return Err(format!("spanned path must be repo-relative: {raw}"));
    }
    let posix = raw
        .replace('\\', "/")
        .trim_start_matches("./")
        .trim_end_matches('/')
        .to_string();
    if posix.is_empty() || posix == "." {
        return Err(format!("spanned path resolves to the root: {raw}"));
    }
    if posix.split('/').any(|seg| seg == "..") {
        return Err(format!("spanned path escapes the root: {raw}"));
    }
    Ok(posix)
}

/// Read a declared span off disk under `root` and digest it, exactly as the
/// skill's `buildReceipt` does. Returns `Err` only when a declared path could
/// not be normalised; a path that is simply not there contributes nothing,
/// which is what makes a deletion visible as a digest change.
pub fn span_digest_at(root: &std::path::Path, paths: &[String]) -> Result<String, String> {
    let mut declared: Vec<String> = Vec::with_capacity(paths.len());
    for p in paths {
        let norm = normalize_span_path(p)?;
        if !declared.contains(&norm) {
            declared.push(norm);
        }
    }
    declared.sort();

    let mut seen: Vec<String> = Vec::new();
    let mut entries: Vec<(String, String)> = Vec::new();
    for rel in &declared {
        for file in expand_span(root, rel) {
            if seen.contains(&file) {
                continue;
            }
            let Ok(bytes) =
                std::fs::read(root.join(file.replace('/', std::path::MAIN_SEPARATOR_STR)))
            else {
                continue;
            };
            seen.push(file.clone());
            entries.push((file, file_digest(&bytes)));
        }
    }
    Ok(span_digest(&entries))
}

/// The stable digest of a run AS THE DECIDER SAW IT: its id, its outcome, its
/// two numbers, and each dimension's state, score and floor hit.
///
/// Deliberately NOT the whole run row - `ingested_at` and the free-text summary
/// would make the token churn for reasons a decider never saw, and a token that
/// changes without the verdict changing is a compare-and-swap that refuses
/// honest work.
pub fn saw_digest(
    run_id: &str,
    outcome: &str,
    overall: Option<f64>,
    coverage: f64,
    dimensions: &[(String, String, Option<f64>, bool)],
) -> String {
    // Fixed precision rather than `{:?}`: a float's debug form is not a stable
    // contract, and the whole point of this token is that both sides compute
    // the same bytes.
    let num = |v: Option<f64>| match v {
        Some(x) => format!("{x:.6}"),
        None => "null".to_string(),
    };
    let mut dims: Vec<String> = dimensions
        .iter()
        .map(|(dim, state, score, floor_hit)| {
            format!("{dim}\0{state}\0{}\0{}", num(*score), *floor_hit as u8)
        })
        .collect();
    dims.sort();
    let body = format!(
        "{run_id}\n{outcome}\n{}\n{}\n{}",
        num(overall),
        num(Some(coverage)),
        dims.join("\n")
    );
    let mut h = Sha256::new();
    h.update(body.as_bytes());
    hex::encode(h.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The shared test vector, taken verbatim from the head of the skill's
    /// `scripts/lib/receipt.mjs` (ai-registry `ba72f273`). Two implementations
    /// of a digest are two digests until something pins them to one number;
    /// this is that pin, and if the Rust side ever disagrees the Rust side is
    /// the one that changes.
    #[test]
    fn the_shared_span_digest_vector_holds() {
        let a = "b6a98d9ce9a2d9149288fa3df42d377c3e42737afdcdaf714e33c0a100b51060";
        let b = "f2c82decdd7181cf98945929a62598db7e6b477e11f6e0eb0ae97020eff151ad";
        assert_eq!(file_digest(b"alpha\n"), a);
        assert_eq!(file_digest(b"beta\n"), b);
        let d = span_digest(&[
            ("a.txt".to_string(), a.to_string()),
            ("b/c.txt".to_string(), b.to_string()),
        ]);
        assert_eq!(
            d, "5af9f997a477dcc29084a755099b65288e13751fa3436d69482e6dacb00f4081",
            "the digest of the shared vector changed - the skill and the app \
             have stopped agreeing about drift"
        );
    }

    /// The same vector through the FILESYSTEM door, so the walk, the POSIX
    /// normalisation and the sort are pinned too and not only the arithmetic.
    #[test]
    fn the_shared_vector_also_holds_when_read_off_disk() {
        let root = std::env::temp_dir().join(format!("council-span-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("b")).unwrap();
        std::fs::write(root.join("a.txt"), b"alpha\n").unwrap();
        std::fs::write(root.join("b").join("c.txt"), b"beta\n").unwrap();

        // Declared as two files...
        assert_eq!(
            span_digest_at(&root, &["a.txt".into(), "b/c.txt".into()]).unwrap(),
            "5af9f997a477dcc29084a755099b65288e13751fa3436d69482e6dacb00f4081"
        );
        // ...and as a file plus the directory that holds the other: the
        // declaration is not part of the digest, the file list is.
        assert_eq!(
            span_digest_at(&root, &["a.txt".into(), "b".into()]).unwrap(),
            "5af9f997a477dcc29084a755099b65288e13751fa3436d69482e6dacb00f4081"
        );

        let _ = std::fs::remove_dir_all(&root);
    }

    /// Order of the input must not matter; order of the LINES must.
    #[test]
    fn the_digest_is_order_independent_over_its_input() {
        let a = vec![
            ("a.txt".to_string(), "aa".to_string()),
            ("b/c.txt".to_string(), "bb".to_string()),
        ];
        let mut b = a.clone();
        b.reverse();
        assert_eq!(span_digest(&a), span_digest(&b));
    }

    /// A deleted file is a CHANGE. The skill's `expandSpan` returns nothing for
    /// a path that is not there, so the file's LINE DISAPPEARS rather than
    /// being hashed as some sentinel - and the digest moves either way. This is
    /// the rule a port is most likely to get wrong by inventing a placeholder.
    #[test]
    fn a_missing_file_drops_its_line_and_moves_the_digest() {
        let root = std::env::temp_dir().join(format!("council-gone-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("a.txt"), b"alpha\n").unwrap();
        let span = vec!["a.txt".to_string(), "b.txt".to_string()];

        // b.txt does not exist, so the digest is the one-file digest.
        let before = span_digest_at(&root, &span).unwrap();
        assert_eq!(
            before,
            span_digest(&[("a.txt".to_string(), file_digest(b"alpha\n"))])
        );

        std::fs::write(root.join("b.txt"), b"beta\n").unwrap();
        assert_ne!(before, span_digest_at(&root, &span).unwrap());

        std::fs::remove_file(root.join("a.txt")).unwrap();
        assert_ne!(before, span_digest_at(&root, &span).unwrap());
        let _ = std::fs::remove_dir_all(&root);
    }

    /// Build and tool state is never part of a span, whatever the declaration
    /// says - the same seven names the skill skips.
    #[test]
    fn the_walk_skips_build_and_tool_state() {
        let root = std::env::temp_dir().join(format!("council-skip-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("src").join("node_modules")).unwrap();
        std::fs::write(root.join("src").join("a.ts"), b"x").unwrap();
        std::fs::write(root.join("src").join("node_modules").join("junk.js"), b"y").unwrap();

        assert_eq!(
            span_digest_at(&root, &["src".into()]).unwrap(),
            span_digest(&[("src/a.ts".to_string(), file_digest(b"x"))])
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    /// The NUL separator: without it these two spans collide.
    #[test]
    fn the_separator_keeps_path_and_digest_apart() {
        let one = vec![("ab".to_string(), "cd".to_string())];
        let two = vec![("a".to_string(), "bcd".to_string())];
        assert_ne!(span_digest(&one), span_digest(&two));
    }

    #[test]
    fn a_span_path_may_not_escape_the_root() {
        let root = std::path::Path::new("/tmp/whatever");
        assert!(span_digest_at(root, &["../secrets".to_string()]).is_err());
        assert!(span_digest_at(root, &["".to_string()]).is_err());
        assert!(span_digest_at(root, &["/etc/passwd".to_string()]).is_err());
        // A path that simply is not there is not an error - it contributes
        // nothing, which is exactly how a deletion reads.
        assert!(span_digest_at(root, &["a/b.rs".to_string()]).is_ok());
    }

    #[test]
    fn normalisation_matches_the_skills_rules() {
        assert_eq!(normalize_span_path("./src/a.ts").unwrap(), "src/a.ts");
        assert_eq!(normalize_span_path("src\\a.ts").unwrap(), "src/a.ts");
        assert_eq!(normalize_span_path("src/").unwrap(), "src");
        assert!(normalize_span_path(".").is_err());
        assert!(normalize_span_path("C:/x").is_err());
    }

    /// The same rounding as the skill's `aggregate.mjs`. Without it the door's
    /// 1e-6 comparison would refuse arithmetic that agrees, because a raw
    /// quotient and a 4-decimal one differ by more than the tolerance.
    #[test]
    fn round4_matches_the_skills_rounding() {
        assert_eq!(round4(0.595 / 0.90), 0.6611);
        assert_eq!(round4(0.685), 0.685);
        assert_eq!(round4(1.0), 1.0);
        assert!((0.595_f64 / 0.90 - 0.6611).abs() > COUNCIL_NUMERIC_TOLERANCE);
    }

    /// The rubric numbers ARE the contract - a silent edit here changes every
    /// verdict the app recomputes. Pinned to the values in the design brief.
    #[test]
    fn the_rubric_weights_are_the_contract_values() {
        let f: Vec<(&str, f64, Option<f64>)> = RUBRIC_FEATURE_V1
            .iter()
            .map(|e| (e.dimension, e.weight, e.floor))
            .collect();
        assert_eq!(
            f,
            vec![
                ("value", 0.30, Some(0.40)),
                ("craft", 0.25, None),
                ("rivalry", 0.20, None),
                ("robustness", 0.15, Some(0.50)),
                ("economics", 0.10, None),
            ]
        );
        let a: Vec<(&str, f64, Option<f64>)> = RUBRIC_ARCHITECTURE_V1
            .iter()
            .map(|e| (e.dimension, e.weight, e.floor))
            .collect();
        assert_eq!(
            a,
            vec![
                ("craft", 0.35, None),
                ("robustness", 0.30, Some(0.50)),
                ("reversibility", 0.25, Some(0.50)),
                ("economics", 0.10, None),
            ]
        );
        for rubric in [&RUBRIC_FEATURE_V1[..], &RUBRIC_ARCHITECTURE_V1[..]] {
            let sum: f64 = rubric.iter().map(|e| e.weight).sum();
            assert!((sum - 1.0).abs() < COUNCIL_NUMERIC_TOLERANCE, "{sum}");
        }
        // Only `value` carries a floor a JUDGED member raised, and it is the
        // one the pass rule holds advisory until the judges are trusted. Every
        // floor in architecture-v1 is mechanical and binds immediately.
        assert!(RUBRIC_FEATURE_V1[0].is_judged());
        assert!(RUBRIC_FEATURE_V1[0].floor.is_some());
        assert!(RUBRIC_ARCHITECTURE_V1
            .iter()
            .all(|e| e.floor.is_none() || !e.is_judged()));
    }

    #[test]
    fn an_unknown_rubric_version_resolves_to_nothing() {
        assert!(rubric_for("feature-v1").is_some());
        assert!(rubric_for("architecture-v1").is_some());
        assert!(rubric_for("feature-v2").is_none());
    }

    /// The token must move when a verdict moves and stay put when nothing a
    /// decider saw moved.
    #[test]
    fn the_saw_digest_tracks_the_verdict_and_nothing_else() {
        let dims = vec![
            (
                "value".to_string(),
                "measured".to_string(),
                Some(0.8),
                false,
            ),
            (
                "robustness".to_string(),
                "measured".to_string(),
                Some(0.6),
                false,
            ),
        ];
        let base = saw_digest("run-1", "ready", Some(0.74), 1.0, &dims);
        // Same facts, dimensions given in the other order.
        let mut swapped = dims.clone();
        swapped.reverse();
        assert_eq!(
            base,
            saw_digest("run-1", "ready", Some(0.74), 1.0, &swapped)
        );

        let mut moved = dims.clone();
        moved[1].2 = Some(0.4);
        moved[1].3 = true;
        assert_ne!(base, saw_digest("run-1", "ready", Some(0.74), 1.0, &moved));
        assert_ne!(base, saw_digest("run-1", "fail", Some(0.74), 1.0, &dims));
        assert_ne!(base, saw_digest("run-2", "ready", Some(0.74), 1.0, &dims));
    }

    /// An unmeasured overall is `null` in the token, never the string `0` -
    /// the same rule the rest of this module keeps.
    #[test]
    fn an_unmeasured_overall_is_not_a_zero_in_the_token() {
        let dims = vec![("value".to_string(), "unmeasured".to_string(), None, false)];
        assert_ne!(
            saw_digest("r", "incomplete", None, 0.0, &dims),
            saw_digest("r", "incomplete", Some(0.0), 0.0, &dims)
        );
    }
}
