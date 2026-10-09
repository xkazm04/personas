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
    /// Base branch freshness; `null` when no base branch resolves (not a repo).
    pub tip: Option<LifecycleTipView>,
    /// The judging rules in force (defaults; step params override).
    pub rules: LifecycleRulesView,
    /// The running Measure for this project, null when none.
    pub progress: Option<LifecycleMeasureProgress>,
}

/// Where the project's base branch stands against the newest Measure.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct LifecycleTipView {
    /// The base branch Measure runs on (e.g. "master").
    pub branch: String,
    /// The base branch tip sha now.
    pub sha: String,
    /// The sha the newest Measure ran on; `null` before the first Measure.
    pub measured_sha: Option<String>,
    /// Commits on the base branch since `measuredSha`; `null` when not measured or not computable.
    pub commits_behind: Option<u32>,
    /// When the newest Measure finished; `null` before the first Measure.
    pub measured_at: Option<String>,
}

/// A command kind's default time budget, used when the command sets none.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct LifecycleKindBudget {
    pub kind: LifecycleGateKind,
    pub budget_ms: u32,
}

/// The command kinds a command-running step is judged on.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct LifecycleStepKinds {
    pub step_id: String,
    pub kinds: Vec<LifecycleGateKind>,
}

/// The judging rules health.rs applies, shipped so the UI draws against the
/// real values instead of a copy. A step's own params override the defaults.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct LifecycleRulesView {
    pub default_budgets: Vec<LifecycleKindBudget>,
    /// Coverage green threshold, 0-100.
    pub coverage_green_pct: u32,
    /// Docs clean-share green threshold, 0-100.
    pub docs_clean_pct: u32,
    /// Done-rate green threshold, 0-100.
    pub done_rate_pct: u32,
    /// The amber floor shared by coverage and done rate, 0-100.
    pub amber_floor_pct: u32,
    /// Fewest samples before a rate is judged.
    pub min_samples: u32,
    pub step_kinds: Vec<LifecycleStepKinds>,
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
    /// The same step one measurement earlier (gate, tests: the Measure before
    /// the newest; evidence steps: the window without the newest change);
    /// null when there is no earlier measurement or the step has none.
    pub previous: Option<LifecyclePreviousView>,
}

/// The step as judged one measurement earlier, for deltas.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct LifecyclePreviousView {
    pub health: LifecycleHealth,
    pub metrics: Vec<LifecycleMetric>,
    /// Gate, tests: when that earlier Measure ran the step. Evidence steps:
    /// when the newest change still in the earlier window occurred; null when
    /// that window is empty.
    pub measured_at: Option<String>,
    /// The base tip that earlier Measure ran on; null for evidence steps.
    pub head_sha: Option<String>,
}

/// One command a past Measure ran, in the order it was planned.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct LifecycleHistoryRun {
    pub command_id: String,
    pub kind: LifecycleGateKind,
    pub outcome: LifecycleRunOutcome,
    pub duration_ms: u32,
    pub value_pct: Option<f64>,
}

/// One command step as judged at one past Measure.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct LifecycleHistoryCell {
    pub step_id: String,
    pub health: LifecycleHealth,
    pub reason: Option<String>,
    pub metrics: Vec<LifecycleMetric>,
}

/// One Measure: the command steps as judged at that measure (window ending at it), and its runs.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct LifecycleMeasureColumn {
    pub measure_id: String,
    pub head_sha: String,
    pub started_at: String,
    pub finished_at: String,
    /// The sum of its runs' durations.
    pub duration_ms: u32,
    /// One per `stepIds` entry, in that order.
    pub cells: Vec<LifecycleHistoryCell>,
    pub runs: Vec<LifecycleHistoryRun>,
}

/// The project's Measure history, judged by today's step settings.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct LifecycleHistory {
    /// Newest first, at most 20.
    pub measures: Vec<LifecycleMeasureColumn>,
    /// The command-running steps the document has (gate, tests), in step order.
    pub step_ids: Vec<String>,
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
    /// Backlog items about this step: slow-gate items for its commands, the
    /// Overseer's items for the step, doc-rot items (docs step). Newest first,
    /// open before closed, at most 20.
    pub related: Vec<LifecycleRelatedItem>,
}

/// Which producer filed a [`LifecycleRelatedItem`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum LifecycleRelatedSource {
    /// A gate/test command over its budget or regressing (`lifecycle:slow:<commandId>`).
    SlowGate,
    /// The Overseer's item for a non-green step (`lifecycle:goal:<goalId>:step:<stepId>`).
    Overseer,
    /// The doc-rot sensor's finding about one doc.
    DocRot,
}

/// One backlog item about a step, as the step screen lists it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct LifecycleRelatedItem {
    /// The `dev_ideas` id.
    pub id: String,
    pub title: String,
    /// The idea status token (`pending`, `accepted`, `rejected`, `archived`,
    /// `delivered`, `expired`).
    pub status: String,
    /// The finding verification state, when the item carries one.
    pub verify_state: Option<String>,
    pub source: LifecycleRelatedSource,
    /// The command a slow-gate item is about; null for other sources.
    pub command_id: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct LifecycleMeasureStarted {
    pub measure_id: String,
}

/// Where one planned command of a running Measure stands.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum LifecycleCommandState {
    Pending,
    Running,
    Done,
}

/// One planned command of the running Measure. `startedAt` is set once it
/// runs; `outcome`/`durationMs` once done; `medianMs` is its median over
/// recent complete measures (the ETA), null with no history.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct LifecycleCommandProgress {
    pub command_id: String,
    pub command: String,
    pub kind: LifecycleGateKind,
    pub state: LifecycleCommandState,
    pub started_at: Option<String>,
    pub outcome: Option<LifecycleRunOutcome>,
    pub duration_ms: Option<u32>,
    pub median_ms: Option<u32>,
}

/// The Measure running right now, command by command, in planned order.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct LifecycleMeasureProgress {
    pub measure_id: String,
    pub started_at: String,
    /// The base tip it runs on; empty when the tip could not be resolved.
    pub head_sha: String,
    pub commands: Vec<LifecycleCommandProgress>,
    /// A cancel was asked for and the Measure has not stopped yet.
    pub cancelling: bool,
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
