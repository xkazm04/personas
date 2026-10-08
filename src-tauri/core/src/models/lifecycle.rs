//! Lifecycle v2 - wire types for a project's development practice.
//!
//! A lifecycle document is an ordered set of steps before and after every dev
//! task (frame, recall, isolate, link, sync / gate, tests, docs, commit, land,
//! record). Each step names its bindings: injected by the app, installed in the
//! repo (managed CLAUDE.md block, lefthook, CI) or advisory. Versions are stored
//! append-only in `dev_lifecycle_versions` (migration `e54_dev_lifecycle`); an
//! absent row is the implicit Solo default (version 0, author `default`).
//!
//! The enum string values are the contract (see the Lifecycle v2 design brief)
//! and mirror the migration's CHECKs - keep them identical.
//!
//! Absent-value convention: unknown is `null`, never `0`; an unobservable step
//! outcome is `unknown`, never `done`.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// `solo` (lean trunk, the default) | `team` (branch per ticket, PR + CI).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum LifecyclePreset {
    Solo,
    Team,
}

impl LifecyclePreset {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Solo => "solo",
            Self::Team => "team",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "solo" => Some(Self::Solo),
            "team" => Some(Self::Team),
            _ => None,
        }
    }
}

/// Whether a step runs before the task's work or after it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum LifecyclePhase {
    Before,
    After,
}

/// Where a step is enforced.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum LifecycleBindingKind {
    /// Injected into every session the app starts.
    App,
    /// A line in the repo's managed CLAUDE.md block.
    ClaudeMd,
    /// A lefthook command `personas-lifecycle-<step>`.
    Hook,
    /// A job in `.github/workflows/personas-lifecycle.yml`.
    Ci,
    /// Stated, not enforced anywhere. Never drawn green.
    Advisory,
}

/// A binding's state as read from the repo (never from a session's word).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum LifecycleBindingState {
    /// The binding itself is in place.
    Live,
    /// An existing mechanism covers it (e.g. any pre-commit hook for Gate).
    Detected,
    /// The version's install task is not terminal yet.
    Pending,
    /// Neither in place nor being installed.
    Missing,
    /// The step is advisory by design.
    Advisory,
}

/// What git showed for one step of one task or commit.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum LifecycleOutcome {
    Done,
    Skipped,
    /// Not observable from git (Frame, Recall, Sync on manual commits).
    Unknown,
    Failed,
}

/// How finished work reaches the base branch.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum LifecycleLandMode {
    LocalMerge,
    PullRequest,
}

/// Where an evidence item came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum LifecycleSourceKind {
    /// A finished app task (stored in `dev_lifecycle_evidence`).
    Task,
    /// A commit on the base branch (derived on read).
    Commit,
    /// A PR merge commit on the base branch (derived on read, Team).
    Pr,
}

/// Who wrote the current version. `default` = no stored row (implicit Solo v0).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum LifecycleAuthor {
    Default,
    Operator,
    Athena,
    System,
}

impl LifecycleAuthor {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Default => "default",
            Self::Operator => "operator",
            Self::Athena => "athena",
            Self::System => "system",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "default" => Some(Self::Default),
            "operator" => Some(Self::Operator),
            "athena" => Some(Self::Athena),
            "system" => Some(Self::System),
            _ => None,
        }
    }
}

/// Per-step knobs. Every field is optional; a step reads only its own.
/// `prBase` / `automergeTarget` are branch selectors (`main` | `test`), the same
/// vocabulary as `standards_config.branching`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct LifecycleStepParams {
    #[serde(default)]
    pub lint: Option<bool>,
    #[serde(default)]
    pub code_quality: Option<bool>,
    #[serde(default)]
    pub docs_required: Option<bool>,
    #[serde(default)]
    pub land_mode: Option<LifecycleLandMode>,
    #[serde(default)]
    pub pr_base: Option<String>,
    #[serde(default)]
    pub automerge_enabled: Option<bool>,
    #[serde(default)]
    pub automerge_target: Option<String>,
    /// `gate` / `tests`: the commands Measure runs. `null` = auto-detect from
    /// the repo's manifests (package.json scripts, Cargo.toml).
    #[serde(default)]
    pub commands: Option<Vec<LifecycleGateCommand>>,
    /// `tests`: coverage at or above this is green (default 70; amber down to 50).
    #[serde(default)]
    pub coverage_green_pct: Option<u32>,
    /// `docs`: share of verifiable docs that must be clean (default 90).
    #[serde(default)]
    pub docs_clean_pct: Option<u32>,
    /// Evidence steps: done-rate at or above this is green (default 80).
    #[serde(default)]
    pub done_rate_pct: Option<u32>,
}

/// One step of the practice. Built-in ids: `frame, recall, isolate, link, sync,
/// gate, tests, docs, commit, land, record` (label `null`, the UI labels them
/// from i18n by id). A custom step's id is `x-<slug>` and it must carry `label`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct LifecycleStep {
    pub id: String,
    pub phase: LifecyclePhase,
    #[serde(default)]
    pub label: Option<String>,
    /// Agent-facing rule text, imperative English.
    pub rule: String,
    pub bindings: Vec<LifecycleBindingKind>,
    #[serde(default)]
    pub params: LifecycleStepParams,
}

/// The lifecycle document stored per version (`dev_lifecycle_versions.doc_json`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct LifecycleDoc {
    pub preset: LifecyclePreset,
    pub steps: Vec<LifecycleStep>,
}

/// One binding of one step, with its state read from the repo.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct LifecycleBindingView {
    pub kind: LifecycleBindingKind,
    pub state: LifecycleBindingState,
    /// What was found (e.g. the file that satisfied a `detected`), when known.
    pub detail: Option<String>,
}

/// Evidence tally for one step over the snapshot's evidence window.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct LifecycleStepTally {
    #[ts(type = "number")]
    pub done: i64,
    #[ts(type = "number")]
    pub skipped: i64,
    #[ts(type = "number")]
    pub unknown: i64,
    #[ts(type = "number")]
    pub failed: i64,
}

/// A step as the journey draws it: the step, its bindings' states, its tally.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct LifecycleStepView {
    pub step: LifecycleStep,
    pub binding_views: Vec<LifecycleBindingView>,
    pub evidence: LifecycleStepTally,
}

/// One step's outcome for one evidence item.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct LifecycleStepOutcome {
    pub step_id: String,
    pub outcome: LifecycleOutcome,
    pub detail: Option<String>,
}

/// A finished task, a base-branch commit or a PR merge, with per-step outcomes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct LifecycleEvidenceItem {
    pub source_kind: LifecycleSourceKind,
    /// Task id, commit sha or PR number.
    pub source_ref: String,
    pub title: String,
    pub occurred_at: String,
    pub outcomes: Vec<LifecycleStepOutcome>,
}

/// Everything the journey and Athena read about a project's lifecycle.
/// Not `Eq`: `health` carries `f64` metrics.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct LifecycleSnapshot {
    pub project_id: String,
    pub preset: LifecyclePreset,
    /// 0 = implicit default (no stored row).
    #[ts(type = "number")]
    pub version: i64,
    pub author: LifecycleAuthor,
    pub change_note: Option<String>,
    pub created_at: Option<String>,
    pub steps: Vec<LifecycleStepView>,
    pub install_task_id: Option<String>,
    /// The install dev task's status, when `installTaskId` is set.
    pub install_task_status: Option<String>,
    /// Newest first, at most 20.
    pub evidence: Vec<LifecycleEvidenceItem>,
    /// Measured health, one entry per step, in step order.
    pub health: Vec<LifecycleStepHealthView>,
    /// The Overseer's "All steps green" goal; `null` when none was ever sent.
    pub goal: Option<LifecycleGoalView>,
    /// The project is starred for the Overseer (auto-measured per base tip).
    pub watched: bool,
    /// A Measure is running for this project right now.
    pub measuring: bool,
}

// ---------------------------------------------------------------------------
// Measured health (spark lifecycle-health, 2026-10-08)
//
// Green means MEASURED AND PASSING, never "the hook file exists". A step with
// no sample is `unmeasured` (blocks the goal) unless its type is unobservable
// by design (`instructed`: frame, recall), which is excluded from the goal.
// A metric with no sample is `value: null, samples: 0` - never `0.0`.
// ---------------------------------------------------------------------------

/// One step's measured verdict.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum LifecycleHealth {
    Green,
    Amber,
    Red,
    /// Measurable, but no sample (or below the sample floor). Never green.
    Unmeasured,
    /// Unobservable by design (frame, recall); excluded from the goal.
    Instructed,
    /// The last measurement is on an older base tip.
    Stale,
}

/// What a gate command is, which picks its default time budget.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum LifecycleGateKind {
    Lint,
    Typecheck,
    Test,
    Check,
    Coverage,
    Other,
}

/// One command's result. `did_not_run` and `timeout` are never `failed`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum LifecycleRunOutcome {
    Passed,
    Failed,
    DidNotRun,
    Timeout,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum LifecycleMetricKey {
    MedianMs,
    PassRate,
    CoveragePct,
    DocsCleanPct,
    DoneRate,
}

/// A number drawn beside a step. `value` is `null` when `samples` is 0.
/// Every rate and share (`pass_rate`, `done_rate`, `coverage_pct`,
/// `docs_clean_pct`) is on a 0-100 scale; `median_ms` is milliseconds.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct LifecycleMetric {
    pub key: LifecycleMetricKey,
    pub value: Option<f64>,
    pub samples: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct LifecycleStepHealthView {
    pub step_id: String,
    pub health: LifecycleHealth,
    /// When `health` is `stale`, the verdict that older measurement gave;
    /// null otherwise.
    pub stale_of: Option<LifecycleHealth>,
    /// Why, in one line (e.g. "no coverage command", "tsc 74s over 60s budget").
    pub reason: Option<String>,
    pub metrics: Vec<LifecycleMetric>,
    pub measured_at: Option<String>,
    pub head_sha: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct LifecycleGoalView {
    pub goal_id: String,
    pub measurable_total: u32,
    pub measurable_green: u32,
    pub instructed: u32,
    pub open_items: u32,
}

/// A command Measure runs. `id` is a stable slug (dedup keys and history key on it).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct LifecycleGateCommand {
    pub id: String,
    pub command: String,
    pub kind: LifecycleGateKind,
    /// Overrides the kind's default budget.
    #[serde(default)]
    pub budget_ms: Option<u32>,
}

/// One `dev_lifecycle_runs` row (append-only). `startedAt` = child spawn,
/// `finishedAt` = child exit; `durationMs` is the wall clock between them, so
/// worktree setup and dependency linking are excluded.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct LifecycleRun {
    pub id: String,
    pub project_id: String,
    pub measure_id: String,
    pub command_id: String,
    pub command: String,
    pub kind: LifecycleGateKind,
    pub outcome: LifecycleRunOutcome,
    pub exit_code: Option<i32>,
    pub duration_ms: u32,
    pub value_pct: Option<f64>,
    pub first_error: Option<String>,
    pub head_sha: String,
    pub started_at: String,
    pub finished_at: String,
}

/// One doc's rot status (from `doc_status`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct LifecycleDocRow {
    pub doc_path: String,
    /// `broken` | `stale` | `unverifiable` | `clean`
    pub status: String,
    pub changed_sources: Vec<String>,
    pub broken_refs: Vec<String>,
    pub scanned_at: Option<String>,
}

/// Layer-2 data for one step: its run history (newest first, at most 30) and,
/// for `docs`, the per-doc rot rows.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct LifecycleStepDetail {
    pub step_id: String,
    pub runs: Vec<LifecycleRun>,
    pub docs: Vec<LifecycleDocRow>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct LifecycleMeasureStarted {
    pub measure_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct LifecycleSendResult {
    pub goal_id: String,
    pub filed: u32,
    pub already_open: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct LifecycleWatchedPipeline {
    pub project_id: String,
    pub project_name: String,
    pub goal: Option<LifecycleGoalView>,
    pub last_measured_at: Option<String>,
}
