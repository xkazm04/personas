//! The arena reader: the files `contest.mjs` writes, the app sidecar
//! (`app.json`), and the ONE phase derivation (`derive_phase`).
//!
//! Layout of one contest, `<project root>/.contest/arena/<contestId>/`:
//! - `contest.json` (the instrument's; never extended by the app)
//! - `BRIEF.md`, `entries/<seatId>/variant-<n>/`, `judging/`
//! - `runs/<seatKey>/record.json` + `final.md` (one per seat run; judges log
//!   under `runs/judge-<id>/`), `runs/blind-map.json`, `runs/visual/`
//! - `manifest.json` (collect), `judging/scoreboard.json` (aggregate)
//! - `app.json` (this app's sidecar) and `review.json` / `REVIEW.md` (the owner's review)
//!
//! Everything here reads leniently: a field the instrument did not write is a
//! default, and a malformed file is an error the caller logs and skips.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::types::{
    ContestChain, ContestChainStep, ContestEffort, ContestEngine, ContestLedger, ContestPhase,
    ContestScoreRow, ContestScoreboard, ContestSeatSpec, ContestSummary,
};
use crate::error::AppError;

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/// `<project root>/.contest/arena`, the instrument's default arena.
pub fn arena_root(project_root: &Path) -> PathBuf {
    project_root.join(".contest").join("arena")
}

/// A contest id or seat key is a filesystem slug: `[A-Za-z0-9._-]+`, never
/// `.`/`..`. Everything that turns an id into a path goes through this.
pub fn is_safe_slug(s: &str) -> bool {
    !s.is_empty()
        && s != "."
        && s != ".."
        && s.len() <= 200
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-')
}

pub fn require_slug(what: &str, s: &str) -> Result<(), AppError> {
    if is_safe_slug(s) {
        Ok(())
    } else {
        Err(AppError::Validation(format!(
            "{what} `{s}` is not a slug ([A-Za-z0-9._-])"
        )))
    }
}

/// The instrument's `slugify` (`lib/vault.mjs`): lower-case, runs of anything
/// but `[a-z0-9]` become `-`, trimmed, at most 60 chars.
pub fn slugify(s: &str) -> String {
    let mut out = String::new();
    let mut dash = false;
    for c in s.to_lowercase().chars() {
        if c.is_ascii_lowercase() || c.is_ascii_digit() {
            out.push(c);
            dash = false;
        } else if !dash {
            out.push('-');
            dash = true;
        }
    }
    let trimmed = out.trim_matches('-');
    trimmed.chars().take(60).collect()
}

/// One contest's directory and the files in it.
#[derive(Debug, Clone)]
pub struct ArenaPaths {
    pub project_root: PathBuf,
    pub arena_root: PathBuf,
    pub dir: PathBuf,
    pub contest_id: String,
}

impl ArenaPaths {
    pub fn new(project_root: &Path, contest_id: &str) -> Result<Self, AppError> {
        require_slug("contest id", contest_id)?;
        let arena_root = arena_root(project_root);
        Ok(Self {
            project_root: project_root.to_path_buf(),
            dir: arena_root.join(contest_id),
            arena_root,
            contest_id: contest_id.to_string(),
        })
    }
    pub fn contest_json(&self) -> PathBuf {
        self.dir.join("contest.json")
    }
    pub fn app_json(&self) -> PathBuf {
        self.dir.join("app.json")
    }
    pub fn review_json(&self) -> PathBuf {
        self.dir.join("review.json")
    }
    pub fn review_md(&self) -> PathBuf {
        self.dir.join("REVIEW.md")
    }
    pub fn manifest_json(&self) -> PathBuf {
        self.dir.join("manifest.json")
    }
    pub fn brief_md(&self) -> PathBuf {
        self.dir.join("BRIEF.md")
    }
    pub fn blind_map_json(&self) -> PathBuf {
        self.dir.join("runs").join("blind-map.json")
    }
    pub fn scoreboard_json(&self) -> PathBuf {
        self.dir.join("judging").join("scoreboard.json")
    }
    pub fn visual_dir(&self) -> PathBuf {
        self.dir.join("runs").join("visual")
    }
    /// `runs/<seatKey>/` — a participant's key is its id, a judge's `judge-<id>`.
    pub fn run_dir(&self, seat_key: &str) -> PathBuf {
        self.dir.join("runs").join(seat_key)
    }
    pub fn record_json(&self, seat_key: &str) -> PathBuf {
        self.run_dir(seat_key).join("record.json")
    }
}

// ---------------------------------------------------------------------------
// Seat specs — the instrument's `parseParticipant`, ported
// ---------------------------------------------------------------------------

/// A parsed `engine:model@effort[#label]`, with the instrument's stable id.
#[derive(Debug, Clone, PartialEq)]
pub struct ParsedSpec {
    pub engine: ContestEngine,
    pub model: String,
    pub effort: ContestEffort,
    pub label: Option<String>,
    /// `<engine>-<model>_<effort>[-<label>]`, filesystem-safe.
    pub id: String,
    /// The canonical spec string.
    pub spec: String,
}

fn spec_token_ok(s: &str) -> bool {
    !s.is_empty()
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-')
}

pub fn engine_str(e: ContestEngine) -> &'static str {
    match e {
        ContestEngine::Claude => "claude",
        ContestEngine::Codex => "codex",
        ContestEngine::Grok => "grok",
    }
}

pub fn effort_str(e: ContestEffort) -> &'static str {
    crate::commands::fleet::contest_seat::effort_token(e)
}

fn parse_engine(s: &str) -> Option<ContestEngine> {
    match s {
        "claude" => Some(ContestEngine::Claude),
        "codex" => Some(ContestEngine::Codex),
        "grok" => Some(ContestEngine::Grok),
        _ => None,
    }
}

fn parse_effort(s: &str) -> Option<ContestEffort> {
    match s {
        "low" => Some(ContestEffort::Low),
        "medium" => Some(ContestEffort::Medium),
        "high" => Some(ContestEffort::High),
        "xhigh" => Some(ContestEffort::Xhigh),
        "max" => Some(ContestEffort::Max),
        _ => None,
    }
}

/// `engine:model@effort[#label]` → [`ParsedSpec`], exactly the instrument's
/// grammar (`/^([a-z]+):([A-Za-z0-9._-]+)@([a-z]+)(?:#([A-Za-z0-9._-]+))?$/`).
pub fn parse_seat_spec(raw: &str) -> Result<ParsedSpec, AppError> {
    let bad = || AppError::Validation(format!("seat `{raw}` is not engine:model@effort[#label]"));
    let s = raw.trim();
    let (engine, rest) = s.split_once(':').ok_or_else(bad)?;
    if engine.is_empty() || !engine.chars().all(|c| c.is_ascii_lowercase()) {
        return Err(bad());
    }
    let (main, label) = match rest.split_once('#') {
        Some((m, l)) => (m, Some(l)),
        None => (rest, None),
    };
    let (model, effort) = main.split_once('@').ok_or_else(bad)?;
    if !spec_token_ok(model) || effort.is_empty() || !effort.chars().all(|c| c.is_ascii_lowercase())
    {
        return Err(bad());
    }
    if let Some(l) = label {
        if !spec_token_ok(l) {
            return Err(bad());
        }
    }
    let engine_v = parse_engine(engine)
        .ok_or_else(|| AppError::Validation(format!("seat `{raw}`: unknown engine `{engine}`")))?;
    let effort_v = parse_effort(effort)
        .ok_or_else(|| AppError::Validation(format!("seat `{raw}`: unknown effort `{effort}`")))?;
    let id_raw = format!(
        "{engine}-{model}_{effort}{}",
        label.map(|l| format!("-{l}")).unwrap_or_default()
    );
    let id: String = id_raw
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-' {
                c
            } else {
                '_'
            }
        })
        .collect();
    Ok(ParsedSpec {
        engine: engine_v,
        model: model.to_string(),
        effort: effort_v,
        label: label.map(str::to_string),
        id,
        spec: format!(
            "{engine}:{model}@{effort}{}",
            label.map(|l| format!("#{l}")).unwrap_or_default()
        ),
    })
}

/// The canonical string of a structured spec (validated through the parser).
pub fn spec_string(s: &ContestSeatSpec) -> Result<String, AppError> {
    let raw = format!(
        "{}:{}@{}{}",
        engine_str(s.engine),
        s.model.trim(),
        effort_str(s.effort),
        s.label
            .as_deref()
            .map(str::trim)
            .filter(|l| !l.is_empty())
            .map(|l| format!("#{l}"))
            .unwrap_or_default()
    );
    Ok(parse_seat_spec(&raw)?.spec)
}

pub fn spec_struct(p: &ParsedSpec) -> ContestSeatSpec {
    ContestSeatSpec {
        engine: p.engine,
        model: p.model.clone(),
        effort: p.effort,
        label: p.label.clone(),
    }
}

/// The run-dir key of a judge seat (`plan --kind judges` logs to `runs/judge-<id>`).
pub fn judge_seat_key(judge_id: &str) -> String {
    format!("judge-{judge_id}")
}

pub fn is_judge_key(seat_key: &str) -> bool {
    seat_key.starts_with("judge-")
}

// ---------------------------------------------------------------------------
// The instrument's files
// ---------------------------------------------------------------------------

/// One participant entry of `contest.json`.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct ContestParticipant {
    pub id: String,
    pub spec: String,
}

/// A decided pick (`c.winner`, `c.runner_up`, each `c.shortlist[]`).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct ContestPick {
    pub label: String,
    pub spec: String,
    pub concept: String,
}

/// `contest.json`, read leniently.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct ContestFile {
    pub id: String,
    pub title: String,
    pub date: String,
    pub project: String,
    pub variants: u32,
    pub timeout_min: u32,
    pub participants: Vec<ContestParticipant>,
    pub judges: Vec<String>,
    pub vault: Option<String>,
    pub vault_subdir: Option<String>,
    pub winner: Option<ContestPick>,
    pub shortlist: Vec<ContestPick>,
    /// `verdict --combine`: two or more variants kept and fused. The
    /// instrument deliberately leaves `winner` null for this outcome.
    pub combined: Vec<ContestPick>,
    /// `wrap --close`: the family ended on purpose with no winner.
    pub closed: Option<ContestClosed>,
    /// `"reveal"` for a round whose verdict lives on its parent.
    pub kind: Option<String>,
    pub parent: Option<String>,
    pub round: Option<u32>,
}

impl ContestFile {
    /// Is this contest's OWN verdict recorded?
    ///
    /// The instrument's canonical predicate, ported from the skill's
    /// `scripts/lib/wrap.mjs`: `!!c.winner || !!c.combined?.length ||
    /// !!c.closed`. Reading only `winner` is what made every `--combine` and
    /// every `wrap --close` invisible here, so a contest settled weeks ago sat
    /// in "Needs your verdict" forever.
    pub fn is_decided(&self) -> bool {
        self.winner.is_some() || !self.combined.is_empty() || self.closed.is_some()
    }

    /// A round the instrument created only to show the parent's winner; its
    /// verdict is the parent's and it never gets one of its own.
    pub fn is_reveal(&self) -> bool {
        self.kind.as_deref() == Some("reveal")
    }
}

/// `wrap --close`: why a family ended without a winner, and when.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct ContestClosed {
    pub reason: String,
    pub at: String,
}

/// `manifest.json` (written by `collect`).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct ManifestFile {
    pub entries: BTreeMap<String, ManifestEntry>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct ManifestEntry {
    pub letter: String,
    pub variants: Vec<ManifestVariant>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct ManifestVariant {
    pub n: u32,
    pub present: bool,
    pub bytes: u64,
    pub title: String,
    pub notes: bool,
    pub concept: Option<String>,
}

/// `judging/scoreboard.json` (written by `aggregate`), the fields the page shows.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct ScoreboardFile {
    pub judges: Vec<String>,
    pub rows: Vec<ScoreboardRow>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct ScoreboardRow {
    pub key: String,
    pub mean: Option<f64>,
    pub spread: Option<f64>,
    pub broken_by: Vec<String>,
    pub dims: BTreeMap<String, f64>,
}

pub fn project_scoreboard(sb: ScoreboardFile) -> ContestScoreboard {
    ContestScoreboard {
        judges: sb.judges,
        rows: sb
            .rows
            .into_iter()
            .map(|r| ContestScoreRow {
                key: r.key,
                mean: r.mean,
                spread: r.spread,
                broken: !r.broken_by.is_empty(),
                dims: r.dims,
            })
            .collect(),
    }
}

/// `runs/<seatKey>/record.json` — the SKILL's record schema (snake_case, exact
/// keys). This is a file format shared with `contest.mjs`, not a binding.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SeatRecord {
    pub id: String,
    pub spec: String,
    pub engine: String,
    pub model: String,
    pub effort: String,
    pub outcome: String,
    pub exit: Option<i32>,
    pub timed_out: bool,
    pub wall_s: Option<f64>,
    pub turns: Option<u32>,
    pub cost_usd: Option<f64>,
    pub usage: Option<serde_json::Value>,
    pub model_usage: Option<serde_json::Value>,
    pub errors: Vec<String>,
    pub finished: String,
}

/// The lenient read of a record (a record the CLI wrote carries `turns: 0`
/// and `usage: {}`; the fields the page shows are all that matter here).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct RecordView {
    pub outcome: String,
    pub wall_s: Option<f64>,
    pub turns: Option<u32>,
    pub cost_usd: Option<f64>,
    pub errors: Vec<String>,
}

// ---------------------------------------------------------------------------
// The app sidecar (`app.json`)
// ---------------------------------------------------------------------------

/// The chain state as stored in the sidecar.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SidecarChain {
    pub step: ContestChainStep,
    #[serde(default)]
    pub reason: Option<String>,
    #[serde(default)]
    pub updated_at_ms: Option<i64>,
}

impl Default for SidecarChain {
    fn default() -> Self {
        Self {
            step: ContestChainStep::Idle,
            reason: None,
            updated_at_ms: None,
        }
    }
}

/// `<arena>/<id>/app.json` — app-owned state. `contest.json` is never
/// extended by the app; everything the app needs to remember lives here.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Sidecar {
    pub judges_enabled: bool,
    /// Judge seat spec strings.
    pub judges: Vec<String>,
    pub not_before_ms: Option<i64>,
    pub chain: SidecarChain,
    /// seatKey → the fleet session id of its latest run.
    pub seat_sessions: BTreeMap<String, String>,
    /// seatKey → the fleet session id whose `record.json` has been written.
    /// Makes finalising a seat idempotent across watcher and restart paths.
    pub recorded_sessions: BTreeMap<String, String>,
    /// seatKey → when its latest run left the queue (epoch ms). Survives a
    /// restart, so a re-attached watcher keeps the ceiling it started with.
    pub seat_started_ms: BTreeMap<String, i64>,
}

impl Sidecar {
    pub fn chain_view(&self) -> ContestChain {
        ContestChain {
            step: self.chain.step,
            reason: self.chain.reason.clone(),
            updated_at_ms: self.chain.updated_at_ms,
        }
    }
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

pub fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Result<T, AppError> {
    let text = std::fs::read_to_string(path)
        .map_err(|e| AppError::Internal(format!("read {}: {e}", path.display())))?;
    serde_json::from_str(&text)
        .map_err(|e| AppError::Internal(format!("parse {}: {e}", path.display())))
}

/// `Ok(None)` when the file does not exist; an error when it exists but is unreadable.
pub fn read_json_opt<T: for<'de> Deserialize<'de>>(path: &Path) -> Result<Option<T>, AppError> {
    if !path.is_file() {
        return Ok(None);
    }
    read_json(path).map(Some)
}

/// Write JSON atomically (temp file + rename in the same directory).
pub fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<(), AppError> {
    let text = serde_json::to_string_pretty(value)
        .map_err(|e| AppError::Internal(format!("serialize {}: {e}", path.display())))?;
    write_text(path, &format!("{text}\n"))
}

pub fn write_text(path: &Path, text: &str) -> Result<(), AppError> {
    let parent = path
        .parent()
        .ok_or_else(|| AppError::Internal(format!("no parent dir for {}", path.display())))?;
    std::fs::create_dir_all(parent)
        .map_err(|e| AppError::Internal(format!("create {}: {e}", parent.display())))?;
    let tmp = parent.join(format!(
        ".{}.{}.tmp",
        path.file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default(),
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::write(&tmp, text)
        .map_err(|e| AppError::Internal(format!("write {}: {e}", tmp.display())))?;
    std::fs::rename(&tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        AppError::Internal(format!("replace {}: {e}", path.display()))
    })
}

/// The sidecar for a read-modify-write: a missing file is empty, an
/// unreadable one is an ERROR. Writing back defaults over a file this build
/// cannot parse (say an unknown chain step from a newer build) would drop
/// every seat session and the judge panel.
pub fn read_sidecar_for_update(paths: &ArenaPaths) -> Result<Sidecar, AppError> {
    read_json_opt::<Sidecar>(&paths.app_json()).map(Option::unwrap_or_default)
}

/// The sidecar for display and decisions: an unreadable file reads as empty
/// (logged). Never write the result back; use [`read_sidecar_for_update`].
pub fn read_sidecar(paths: &ArenaPaths) -> Sidecar {
    match read_json_opt::<Sidecar>(&paths.app_json()) {
        Ok(Some(s)) => s,
        Ok(None) => Sidecar::default(),
        Err(e) => {
            tracing::warn!(error = %e, "contest: app.json unreadable, treating as empty");
            Sidecar::default()
        }
    }
}

fn mtime_ms(path: &Path) -> Option<i64> {
    let modified = std::fs::metadata(path).ok()?.modified().ok()?;
    let d = modified.duration_since(std::time::UNIX_EPOCH).ok()?;
    i64::try_from(d.as_millis()).ok()
}

/// Newest mtime among contest.json, app.json, review.json, manifest.json and
/// every `runs/*/record.json`.
pub fn updated_at_ms(paths: &ArenaPaths) -> i64 {
    let mut candidates = vec![
        paths.contest_json(),
        paths.app_json(),
        paths.review_json(),
        paths.manifest_json(),
    ];
    if let Ok(rd) = std::fs::read_dir(paths.dir.join("runs")) {
        for e in rd.flatten() {
            candidates.push(e.path().join("record.json"));
        }
    }
    candidates
        .iter()
        .filter_map(|p| mtime_ms(p))
        .max()
        .unwrap_or(0)
}

// ---------------------------------------------------------------------------
// Phase — derived in ONE place
// ---------------------------------------------------------------------------

/// The live fleet state of one seat's latest session, as the driver reads it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SeatLive {
    /// Admitted, waiting in the fleet queue.
    Queued,
    /// Its process is running (or spawning).
    Running,
    /// Its session ended (finished / exited / gone).
    Settled,
}

/// Everything `derive_phase` looks at.
#[derive(Debug, Clone, Default)]
pub struct PhaseInputs {
    pub decided: bool,
    pub shortlisted: bool,
    pub chain: Option<ContestChainStep>,
    /// Live states of the participant seats' latest sessions.
    pub participant_live: Vec<SeatLive>,
    /// Live states of the judge seats' latest sessions.
    pub judge_live: Vec<SeatLive>,
    pub manifest_exists: bool,
    /// Seats with a `record.json` on disk — they ran to an end.
    pub records_ran: u32,
    /// How many of those records ended badly (errored / timed out / cut off).
    pub records_failed: u32,
}

/// The one phase derivation (never the UI):
/// decided > shortlisted > failed > judging > review > collecting > running >
/// queued > draft.
pub fn derive_phase(i: &PhaseInputs) -> ContestPhase {
    let chain = i.chain.unwrap_or(ContestChainStep::Idle);
    let live = |s: &SeatLive| matches!(s, SeatLive::Queued | SeatLive::Running);
    let any_seat_live = i.participant_live.iter().chain(&i.judge_live).any(live);
    if i.decided {
        return ContestPhase::Decided;
    }
    if i.shortlisted {
        return ContestPhase::Shortlisted;
    }
    // Every seat that ran ended badly and nothing was collected: the contest
    // is stalled, not waiting in a queue. Without this, a one-seat contest
    // whose seat errored read `queued` forever, because a record on disk used
    // to count as a settled seat regardless of its outcome.
    let all_records_failed = i.records_ran > 0
        && i.records_failed == i.records_ran
        && !any_seat_live
        && !i.manifest_exists;
    if chain == ContestChainStep::Failed || all_records_failed {
        return ContestPhase::Failed;
    }
    if chain == ContestChainStep::Judging || i.judge_live.iter().any(live) {
        return ContestPhase::Judging;
    }
    if i.manifest_exists
        && matches!(chain, ContestChainStep::Ready | ContestChainStep::Idle)
        && !any_seat_live
    {
        return ContestPhase::Review;
    }
    if matches!(
        chain,
        ContestChainStep::Collecting | ContestChainStep::Visual
    ) {
        return ContestPhase::Collecting;
    }
    if i.participant_live.contains(&SeatLive::Running) {
        return ContestPhase::Running;
    }
    if !i.participant_live.is_empty() {
        return ContestPhase::Queued;
    }
    ContestPhase::Draft
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

/// Build a summary from the files plus the live seat states (driver-supplied).
pub fn build_summary(
    project_id: &str,
    project_name: &str,
    paths: &ArenaPaths,
    c: &ContestFile,
    sidecar: &Sidecar,
    live_of: &dyn Fn(&str) -> Option<SeatLive>,
) -> ContestSummary {
    let mut inputs = PhaseInputs {
        // A reveal round carries no verdict of its own and never will: the
        // instrument only creates one once the parent has been decided, and
        // `wrap` treats it as covered by the parent. Reading it as `review`
        // parked it in "Needs your verdict" permanently.
        decided: c.is_decided() || c.is_reveal(),
        shortlisted: !c.shortlist.is_empty(),
        chain: Some(sidecar.chain.step),
        manifest_exists: paths.manifest_json().is_file(),
        ..PhaseInputs::default()
    };
    for (key, sid) in &sidecar.seat_sessions {
        let Some(live) = live_of(sid) else { continue };
        if is_judge_key(key) {
            inputs.judge_live.push(live);
        } else {
            inputs.participant_live.push(live);
        }
    }
    // A seat the app never launched but whose record is on disk (the CLI ran
    // it) has run: it counts as settled, so the contest is not a draft. The
    // record's OUTCOME is read too — an errored seat has ended, but it has
    // not delivered, and a contest where that is the whole story is stalled.
    for p in &c.participants {
        let record = paths.record_json(&p.id);
        if !record.is_file() {
            continue;
        }
        inputs.records_ran += 1;
        let outcome = read_json::<RecordView>(&record)
            .map(|r| r.outcome)
            .unwrap_or_default();
        if matches!(outcome.as_str(), "errored" | "timed-out" | "seat-limit") {
            inputs.records_failed += 1;
        }
        if !sidecar.seat_sessions.contains_key(&p.id) {
            inputs.participant_live.push(SeatLive::Settled);
        }
    }
    ContestSummary {
        project_id: project_id.to_string(),
        project_name: project_name.to_string(),
        contest_id: if c.id.is_empty() {
            paths.contest_id.clone()
        } else {
            c.id.clone()
        },
        title: c.title.clone(),
        date: c.date.clone(),
        phase: derive_phase(&inputs),
        seat_count: c.participants.len() as u32,
        variants_per_seat: c.variants,
        seat_specs: c.participants.iter().map(|p| p.spec.clone()).collect(),
        winner: c.winner.as_ref().map(|w| w.label.clone()),
        winner_seat_spec: c.winner.as_ref().map(|w| w.spec.clone()),
        shortlist: c.shortlist.iter().map(|p| p.label.clone()).collect(),
        parent_id: c.parent.clone(),
        round: c.round,
        updated_at_ms: updated_at_ms(paths),
        // The file-free half of the ledger; the view fills seats, variants
        // and the judges' lead from the records it reads anyway.
        ledger: ContestLedger {
            timeout_min: c.timeout_min,
            not_before_ms: sidecar.not_before_ms,
            judges_enabled: sidecar.judges_enabled,
            chain: sidecar.chain_view(),
            seats: Vec::new(),
            variants: Vec::new(),
            judges_lead: None,
        },
    }
}

/// Every contest id under a project's arena that has a `contest.json`.
pub fn list_contest_ids(project_root: &Path) -> Vec<String> {
    let Ok(rd) = std::fs::read_dir(arena_root(project_root)) else {
        return Vec::new();
    };
    let mut ids: Vec<String> = rd
        .flatten()
        .filter(|e| e.path().join("contest.json").is_file())
        .filter_map(|e| e.file_name().to_str().map(str::to_string))
        .filter(|id| is_safe_slug(id))
        .collect();
    ids.sort();
    ids
}

#[cfg(test)]
mod tests {
    use super::*;

    fn inputs() -> PhaseInputs {
        PhaseInputs::default()
    }

    #[test]
    fn derive_phase_covers_every_phase_in_precedence_order() {
        use ContestChainStep as C;
        use SeatLive as L;
        // draft: nothing launched
        assert_eq!(derive_phase(&inputs()), ContestPhase::Draft);
        // queued: sessions exist, none running
        let mut i = inputs();
        i.participant_live = vec![L::Queued, L::Queued];
        assert_eq!(derive_phase(&i), ContestPhase::Queued);
        // running: any participant running
        i.participant_live = vec![L::Queued, L::Running];
        assert_eq!(derive_phase(&i), ContestPhase::Running);
        // collecting: chain collecting or visual
        let mut i = inputs();
        i.participant_live = vec![L::Settled];
        i.chain = Some(C::Collecting);
        assert_eq!(derive_phase(&i), ContestPhase::Collecting);
        i.chain = Some(C::Visual);
        assert_eq!(derive_phase(&i), ContestPhase::Collecting);
        // review: manifest + chain ready/idle + no live seat
        let mut i = inputs();
        i.participant_live = vec![L::Settled];
        i.manifest_exists = true;
        i.chain = Some(C::Ready);
        assert_eq!(derive_phase(&i), ContestPhase::Review);
        i.chain = Some(C::Idle);
        assert_eq!(derive_phase(&i), ContestPhase::Review);
        // ... but a live seat (a retry) keeps it out of review
        i.participant_live = vec![L::Settled, L::Running];
        assert_eq!(derive_phase(&i), ContestPhase::Running);
        // judging: chain judging, or a judge seat live
        let mut i = inputs();
        i.manifest_exists = true;
        i.chain = Some(C::Judging);
        assert_eq!(derive_phase(&i), ContestPhase::Judging);
        i.chain = Some(C::Ready);
        i.judge_live = vec![L::Running];
        assert_eq!(derive_phase(&i), ContestPhase::Judging);
        // failed beats judging
        i.chain = Some(C::Failed);
        assert_eq!(derive_phase(&i), ContestPhase::Failed);
        // shortlisted beats failed; decided beats everything
        i.shortlisted = true;
        assert_eq!(derive_phase(&i), ContestPhase::Shortlisted);
        i.decided = true;
        assert_eq!(derive_phase(&i), ContestPhase::Decided);
    }

    #[test]
    fn a_settled_launch_with_no_manifest_and_an_idle_chain_reads_queued_not_draft() {
        // The instant between the last seat settling and the chain starting.
        let i = PhaseInputs {
            participant_live: vec![SeatLive::Settled],
            ..PhaseInputs::default()
        };
        assert_eq!(derive_phase(&i), ContestPhase::Queued);
    }

    /// A contest the CLI ran (records on disk, no app sessions) is not a
    /// draft: its seats have run.
    #[test]
    fn a_cli_run_arena_reads_its_recorded_seats_as_settled() {
        let tmp = tempfile::tempdir().unwrap();
        let paths = ArenaPaths::new(tmp.path(), "cli").unwrap();
        let c = ContestFile {
            participants: vec![
                ContestParticipant {
                    id: "claude-opus_high".into(),
                    spec: "claude:opus@high".into(),
                },
                ContestParticipant {
                    id: "grok-grok-4.6_low".into(),
                    spec: "grok:grok-4.6@low".into(),
                },
            ],
            ..ContestFile::default()
        };
        let none = |_: &str| None;
        let draft = build_summary("p", "P", &paths, &c, &Sidecar::default(), &none);
        assert_eq!(draft.phase, ContestPhase::Draft, "nothing ran yet");
        for p in &c.participants {
            write_text(&paths.record_json(&p.id), "{\"outcome\":\"completed\"}").unwrap();
        }
        let ran = build_summary("p", "P", &paths, &c, &Sidecar::default(), &none);
        assert_eq!(
            ran.phase,
            ContestPhase::Queued,
            "recorded, not yet collected"
        );
        write_text(&paths.manifest_json(), "{}").unwrap();
        let collected = build_summary("p", "P", &paths, &c, &Sidecar::default(), &none);
        assert_eq!(collected.phase, ContestPhase::Review);
    }

    /// Every verdict shape the instrument writes must settle the contest. The
    /// scanner used to read `winner` only, so `--combine` and `wrap --close`
    /// were invisible and the contest stayed in "Needs your verdict" forever.
    #[test]
    fn every_recorded_verdict_shape_reads_as_decided() {
        let pick = || ContestPick {
            label: "B/1".into(),
            spec: "claude:opus@high".into(),
            concept: "Signal Atlas".into(),
        };
        assert!(!ContestFile::default().is_decided(), "nothing recorded");
        assert!(ContestFile {
            winner: Some(pick()),
            ..ContestFile::default()
        }
        .is_decided());
        assert!(
            ContestFile {
                combined: vec![pick(), pick()],
                ..ContestFile::default()
            }
            .is_decided(),
            "`verdict --combine` leaves `winner` null on purpose"
        );
        assert!(
            ContestFile {
                closed: Some(ContestClosed {
                    reason: "superseded".into(),
                    at: "2026-10-06".into(),
                }),
                ..ContestFile::default()
            }
            .is_decided(),
            "`wrap --close` ends the family with no winner"
        );
        assert!(
            !ContestFile {
                shortlist: vec![pick()],
                ..ContestFile::default()
            }
            .is_decided(),
            "a shortlist defers the verdict to a later round"
        );
        // A reveal round never carries its own verdict; the parent has it.
        assert!(ContestFile {
            kind: Some("reveal".into()),
            ..ContestFile::default()
        }
        .is_reveal());
        assert!(!ContestFile::default().is_reveal());
    }

    /// A combine recorded on disk settles the contest even with a manifest
    /// present (which is what used to pin it to `review`), and a reveal round
    /// settles with no verdict of its own at all.
    #[test]
    fn a_combined_or_reveal_arena_does_not_read_review() {
        let tmp = tempfile::tempdir().unwrap();
        let paths = ArenaPaths::new(tmp.path(), "combined").unwrap();
        write_text(&paths.manifest_json(), "{}").unwrap();
        let none = |_: &str| None;
        let combined = ContestFile {
            combined: vec![ContestPick::default(), ContestPick::default()],
            ..ContestFile::default()
        };
        assert_eq!(
            build_summary("p", "P", &paths, &combined, &Sidecar::default(), &none).phase,
            ContestPhase::Decided
        );
        let reveal = ContestFile {
            kind: Some("reveal".into()),
            parent: Some("combined".into()),
            ..ContestFile::default()
        };
        assert_eq!(
            build_summary("p", "P", &paths, &reveal, &Sidecar::default(), &none).phase,
            ContestPhase::Decided
        );
    }

    /// An errored record is an ended seat that delivered nothing. A contest
    /// that is only that is stalled; it used to read `queued` forever.
    #[test]
    fn an_arena_whose_every_record_errored_reads_failed_not_queued() {
        let tmp = tempfile::tempdir().unwrap();
        let paths = ArenaPaths::new(tmp.path(), "stalled").unwrap();
        let c = ContestFile {
            participants: vec![ContestParticipant {
                id: "claude-opus_high".into(),
                spec: "claude:opus@high".into(),
            }],
            ..ContestFile::default()
        };
        let none = |_: &str| None;
        write_text(
            &paths.record_json("claude-opus_high"),
            "{\"outcome\":\"errored\",\"errors\":[\"no JSON envelope on stdout\"]}",
        )
        .unwrap();
        assert_eq!(
            build_summary("p", "P", &paths, &c, &Sidecar::default(), &none).phase,
            ContestPhase::Failed
        );
        // Once something WAS collected, the owner's review outranks the
        // failure: there is work on the bench to look at.
        write_text(&paths.manifest_json(), "{}").unwrap();
        assert_eq!(
            build_summary("p", "P", &paths, &c, &Sidecar::default(), &none).phase,
            ContestPhase::Review
        );
    }

    #[test]
    fn seat_spec_parse_matches_the_instrument() {
        let p = parse_seat_spec("claude:opus@xhigh").unwrap();
        assert_eq!(p.engine, ContestEngine::Claude);
        assert_eq!(p.id, "claude-opus_xhigh");
        assert_eq!(p.spec, "claude:opus@xhigh");
        let p = parse_seat_spec(" codex:gpt-6-sol@high#second ").unwrap();
        assert_eq!(p.id, "codex-gpt-6-sol_high-second");
        assert_eq!(p.label.as_deref(), Some("second"));
        assert_eq!(p.spec, "codex:gpt-6-sol@high#second");
        assert!(parse_seat_spec("claude:opus").is_err());
        assert!(parse_seat_spec("gemini:x@high").is_err());
        assert!(parse_seat_spec("claude:opus@turbo").is_err());
        assert!(parse_seat_spec("claude:op us@high").is_err());
        assert!(parse_seat_spec("claude:opus@high#a/b").is_err());
        let s = ContestSeatSpec {
            engine: ContestEngine::Grok,
            model: "grok-4.6".into(),
            effort: ContestEffort::High,
            label: Some("  ".into()),
        };
        assert_eq!(spec_string(&s).unwrap(), "grok:grok-4.6@high");
    }

    #[test]
    fn slugs_and_slugify() {
        assert!(is_safe_slug("my-contest_2.r2"));
        assert!(!is_safe_slug(".."));
        assert!(!is_safe_slug("a/b"));
        assert!(!is_safe_slug("a\\b"));
        assert!(!is_safe_slug(""));
        assert_eq!(
            slugify("  Mastermind: Holo NEXT-gen!! "),
            "mastermind-holo-next-gen"
        );
        assert_eq!(slugify("***"), "");
    }

    #[test]
    fn sidecar_roundtrips_camel_case_and_tolerates_missing_fields() {
        let s: Sidecar = serde_json::from_str(r#"{"judgesEnabled":true}"#).unwrap();
        assert!(s.judges_enabled);
        assert_eq!(s.chain.step, ContestChainStep::Idle);
        let v = serde_json::to_value(&s).unwrap();
        for k in [
            "judgesEnabled",
            "judges",
            "notBeforeMs",
            "chain",
            "seatSessions",
        ] {
            assert!(v.get(k).is_some(), "app.json carries {k}");
        }
    }
}
