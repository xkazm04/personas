//! Wire contract for the Contest plugin: the in-app home of the /contest method.
//!
//! Every type here is exported to TypeScript via `ts-rs` (`src/lib/bindings/Contest*.ts`).
//! Regenerate with `npm run test:rust -- export_bindings` after changing any of them.
//!
//! Conventions this file holds to:
//! - every struct is `#[serde(rename_all = "camelCase")]`;
//! - every integer is `#[ts(type = "number")]` (or `"number | null"` when optional),
//!   so no binding lands as `bigint`;
//! - an unknown value is `None` (`null` on the wire), never `0` or `""`. A cost the
//!   engine did not report is `null`, not `0`.
//!
//! The arena folders on disk (`<project root>/.contest/arena/<id>/`) are the single
//! truth shared with the CLI skill. These types are projections of those files plus
//! the app-owned sidecar (`app.json`) and review state (`review.json`).

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

// ---------------------------------------------------------------------------
// String unions
// ---------------------------------------------------------------------------

/// The CLI engine a seat runs on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "lowercase")]
pub enum ContestEngine {
    Claude,
    Codex,
    Grok,
}

/// Reasoning effort requested for a seat.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "lowercase")]
pub enum ContestEffort {
    Low,
    Medium,
    High,
    Xhigh,
    Max,
}

/// Whether a seat builds variants or judges them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "lowercase")]
pub enum ContestSeatKind {
    Participant,
    Judge,
}

/// Lifecycle of one seat. The last four are the outcomes of the Rust port of
/// the skill's `classifyOutcome`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "kebab-case")]
pub enum ContestSeatState {
    Idle,
    Queued,
    Running,
    Completed,
    SeatLimit,
    TimedOut,
    Errored,
}

/// Where a contest stands. Derived in ONE place (Rust `derive_phase`), never in
/// the UI.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "lowercase")]
pub enum ContestPhase {
    Draft,
    Queued,
    Running,
    Collecting,
    Judging,
    Review,
    Shortlisted,
    Decided,
    Failed,
}

/// The step the autopilot chain is on, as recorded in the app sidecar.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "lowercase")]
pub enum ContestChainStep {
    Idle,
    Collecting,
    Visual,
    Judging,
    Ready,
    Failed,
}

/// The review tray a variant has been sorted into.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "lowercase")]
pub enum ContestReviewBucket {
    /// Broken or empty. Its variant dir is deleted on decide, then collect re-runs.
    Failure,
    Impractical,
    Shortlist,
    Winner,
}

/// One retryable step of the autopilot chain (`contest_run_step`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "lowercase")]
pub enum ContestStep {
    Collect,
    Visual,
    Judge,
    Aggregate,
}

// ---------------------------------------------------------------------------
// Seats
// ---------------------------------------------------------------------------

/// A structured seat spec. Its canonical string form, shared with the CLI
/// skill, is `engine:model@effort[#label]`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ContestSeatSpec {
    pub engine: ContestEngine,
    pub model: String,
    pub effort: ContestEffort,
    pub label: Option<String>,
}

/// One seat of a contest (participant or judge) and how its run went.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ContestSeat {
    pub seat_id: String,
    /// The canonical spec string `engine:model@effort[#label]`, as the skill
    /// records it in `contest.json` and `runs/<seatId>/record.json`.
    pub spec: String,
    pub kind: ContestSeatKind,
    pub state: ContestSeatState,
    pub fleet_session_id: Option<String>,
    /// The blind letter assigned at collect; `None` before collect.
    pub letter: Option<String>,
    pub wall_s: Option<f64>,
    pub cost_usd: Option<f64>,
    #[ts(type = "number | null")]
    pub turns: Option<u32>,
    pub errors: Vec<String>,
}

// ---------------------------------------------------------------------------
// Contests
// ---------------------------------------------------------------------------

/// A contest as listed. Keyed by `(projectId, contestId)`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ContestSummary {
    pub project_id: String,
    pub project_name: String,
    pub contest_id: String,
    pub title: String,
    pub date: String,
    pub phase: ContestPhase,
    #[ts(type = "number")]
    pub seat_count: u32,
    #[ts(type = "number")]
    pub variants_per_seat: u32,
    /// The participant seat specs (`engine:model@effort[#label]`), in seat order.
    /// Keys the seat win-rate board across decided contests.
    pub seat_specs: Vec<String>,
    /// The winning variant key (`"A/2"`), once decided.
    pub winner: Option<String>,
    pub winner_seat_spec: Option<String>,
    /// Shortlisted variant keys.
    pub shortlist: Vec<String>,
    /// The contest this one refines (a refine round), if any.
    pub parent_id: Option<String>,
    #[ts(type = "number | null")]
    pub round: Option<u32>,
    #[ts(type = "number")]
    pub updated_at_ms: i64,
}

/// One built variant, as collected into `manifest.json`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ContestVariant {
    /// Blind key, `"<letter>/<n>"`, e.g. `"A/2"`.
    pub key: String,
    pub letter: String,
    pub seat_id: String,
    #[ts(type = "number")]
    pub n: u32,
    /// Whether the variant dir still exists on disk.
    pub present: bool,
    pub title: String,
    pub concept: String,
    #[ts(type = "number")]
    pub bytes: u64,
    pub has_notes: bool,
    /// Loopback preview URL of the variant's `index.html`; `None` when there is
    /// nothing to preview.
    pub preview_url: Option<String>,
    /// Preview URLs of the visual-pass screenshots.
    pub screenshots: Vec<String>,
}

/// A pinned annotation on a variant preview. Position is document-relative
/// (percent of the reported document size); `width`/`height` are the viewport
/// the pin was placed at.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ContestPin {
    pub x_pct: f64,
    pub y_pct: f64,
    #[ts(type = "number")]
    pub width: u32,
    #[ts(type = "number")]
    pub height: u32,
    pub note: String,
}

/// The owner's review of one variant.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ContestVariantReview {
    pub key: String,
    pub bucket: Option<ContestReviewBucket>,
    pub note: String,
    pub pins: Vec<ContestPin>,
}

/// Review state (`<arena>/<id>/review.json`). `REVIEW.md` is rendered from it.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ContestReview {
    /// The whole-field note: the `## All` section of `REVIEW.md`.
    pub field: String,
    pub variants: Vec<ContestVariantReview>,
}

/// Autopilot chain state, from the app sidecar.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ContestChain {
    pub step: ContestChainStep,
    /// Why the chain stopped or skipped a step (e.g. Playwright unresolved).
    pub reason: Option<String>,
    #[ts(type = "number | null")]
    pub updated_at_ms: Option<i64>,
}

/// One row of the judges' scoreboard.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ContestScoreRow {
    pub key: String,
    pub mean: Option<f64>,
    pub spread: Option<f64>,
    pub broken: bool,
    #[ts(type = "Record<string, number>")]
    pub dims: BTreeMap<String, f64>,
}

/// Projected from `judging/scoreboard.json`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ContestScoreboard {
    pub judges: Vec<String>,
    pub rows: Vec<ContestScoreRow>,
}

/// Everything the page needs about one contest.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ContestDetail {
    pub summary: ContestSummary,
    pub brief: String,
    pub arena_path: String,
    pub judges_enabled: bool,
    pub judges: Vec<ContestSeatSpec>,
    #[ts(type = "number | null")]
    pub not_before_ms: Option<i64>,
    pub seats: Vec<ContestSeat>,
    pub variants: Vec<ContestVariant>,
    pub scoreboard: Option<ContestScoreboard>,
    pub review: Option<ContestReview>,
    pub chain: ContestChain,
}

/// Input of `contest_create`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ContestCreateRequest {
    pub project_id: String,
    pub title: String,
    pub brief: String,
    pub seats: Vec<ContestSeatSpec>,
    #[ts(type = "number")]
    pub variants_per_seat: u32,
    #[ts(type = "number")]
    pub timeout_min: u32,
    pub judges_enabled: bool,
    pub judges: Vec<ContestSeatSpec>,
    /// A plain path to a data folder staged into the arena; `None` for none.
    pub data_dir: Option<String>,
    #[ts(type = "number | null")]
    pub not_before_ms: Option<i64>,
    /// Launch the participant seats right after creating.
    pub launch: bool,
}

/// The owner's decision on a contest, tagged on `kind`.
///
/// `shortlist` runs `verdict --shortlist`, then `refine --feedback REVIEW.md`,
/// and the returned summary is the child (next-round) contest.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ContestDecision {
    Winner {
        winner: String,
        runner_up: Option<String>,
        note: String,
    },
    Shortlist {
        keys: Vec<String>,
        note: String,
    },
}

/// Which engine CLIs resolve on this machine.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ContestEngineAvailability {
    pub claude: bool,
    pub codex: bool,
    pub grok: bool,
}

/// The readiness probe behind the page's readiness strip.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ContestEnvironment {
    pub node: bool,
    /// Resolved path of the instrument (`contest.mjs`); `None` when unresolved.
    pub instrument_path: Option<String>,
    pub engines: ContestEngineAvailability,
    pub playwright: bool,
    /// Stable problem CODES, never prose, so the UI can name each missing piece
    /// through i18n: `node-missing`, `instrument-missing`, `playwright-missing`,
    /// `claude-missing`, `codex-missing`, `grok-missing`. Empty when ready.
    pub problems: Vec<String>,
}

/// A saved seat line-up (app_settings key `contest.lineups`).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ContestLineup {
    pub name: String,
    /// Seat spec strings, `engine:model@effort[#label]`.
    pub seats: Vec<String>,
}

/// An Athena-drafted brief, for the owner to edit before create.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ContestBriefDraft {
    pub brief: String,
}

/// Payload of the `contest-changed` event (`event_name::CONTEST_CHANGED`),
/// emitted on every seat-state change and every chain step.
// WP0 ships the contract only; WP2's seat driver and chain construct this.
// Remove the allow once the first emit lands.
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ContestChangedPayload {
    pub project_id: String,
    pub contest_id: String,
}
