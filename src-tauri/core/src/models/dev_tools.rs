use serde::{Deserialize, Serialize};
use ts_rs::TS;

// ============================================================================
// Dev Ideas: canonical category vocabulary
// ============================================================================
//
// The `dev_ideas.category` column historically carried two clashing
// vocabularies depending on the row's origin:
//
//   - LLM scanner (`commands/infrastructure/idea_scanner.rs`) emits
//     {technical, user, business, mastermind} keyed off scan-agent groups.
//   - DB default + early-prototype frontend constants used
//     {functionality, performance, maintenance, ui, code_quality, user_benefit}.
//
// `IdeaTriagePage` filters on the first set, so a row with
// `category='functionality'` was silently dropped from every category facet.
// `IdeaCategory` below is the single canonical vocabulary going forward; the
// scanner prompt is pinned to it, the DB default is migrated to it (see
// `helpers::reconcile_idea_category_vocabulary`), and ts-rs exports it for
// the frontend triage UI.
//
// Mapping legacy → canonical (one-shot, idempotent):
//   functionality → technical
//   performance   → technical
//   maintenance   → technical
//   code_quality  → technical
//   ui            → user
//   user_benefit  → user
//
// Anything outside both vocabularies is left untouched and logged at startup
// for forensic review.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum IdeaCategory {
    Technical,
    User,
    Business,
    Mastermind,
}

impl IdeaCategory {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Technical => "technical",
            Self::User => "user",
            Self::Business => "business",
            Self::Mastermind => "mastermind",
        }
    }

    /// Parse a token from any vocabulary. Legacy values map to the canonical
    /// equivalent; canonical values pass through; anything else returns None.
    pub fn from_token(s: &str) -> Option<Self> {
        match s {
            // Canonical
            "technical" => Some(Self::Technical),
            "user" => Some(Self::User),
            "business" => Some(Self::Business),
            "mastermind" => Some(Self::Mastermind),
            // Legacy → canonical (one-way, written down here so future readers
            // see the mapping without diffing migrations).
            "functionality" | "performance" | "maintenance" | "code_quality" => {
                Some(Self::Technical)
            }
            "ui" | "user_benefit" => Some(Self::User),
            _ => None,
        }
    }
}

/// Default canonical category for ideas with no explicit category. Mirrors
/// the DB column default: keeps generic ideas in the "technical" bucket
/// so they remain visible in the triage UI's default filter.
pub const DEFAULT_IDEA_CATEGORY: IdeaCategory = IdeaCategory::Technical;

// ============================================================================
// Dev Projects
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DevProject {
    pub id: String,
    pub name: String,
    pub root_path: String,
    pub description: Option<String>,
    pub status: String,
    pub tech_stack: Option<String>,
    pub github_url: Option<String>,
    pub monitoring_credential_id: Option<String>,
    pub monitoring_project_slug: Option<String>,
    /// JSON envelope `{ tool, command }` configuring the static-analysis CLI
    /// the `static_scan` runner spawns for this project. None disables the
    /// per-project sweep; the runner falls back to package-manager detection.
    pub static_scan_config: Option<String>,
    /// When true and the task ran inside a worktree, `task_executor` pushes
    /// the worktree branch and opens a PR after the task succeeds. Failures
    /// are surfaced in the task log but do NOT mark the task as failed.
    pub auto_pr_on_success: bool,
    /// GitHub credential row id used to authorise the auto-PR call. Nullable;
    /// when None and `auto_pr_on_success` is true the wiring emits a warning
    /// and skips PR creation.
    pub pr_credential_id: Option<String>,
    /// Credential row id for the LLM-observability connector (Langfuse, Helicone,
    /// LangSmith, …). Distinct from `monitoring_credential_id` (app monitoring);
    /// nullable, set via `dev_tools_update_project`. Added 2026-06-23.
    pub llm_tracking_credential_id: Option<String>,
    /// Credential row id for the incoming customer-support channel (Discord /
    /// Gmail / Outlook …) — the passport's Support dimension. Nullable; set via
    /// `dev_tools_update_project`. Added 2026-07-23.
    pub support_credential_id: Option<String>,
    /// JSON array of related dev_project ids whose codebase post-processes this
    /// project's data (the passport's Data-analysis dimension). User-declared
    /// for now; nullable. Added 2026-07-23.
    pub data_links: Option<String>,
    /// URL of the living test environment this team delivers into (e.g. a
    /// staging/preview deployment). Nullable; set once the env exists.
    pub test_env_url: Option<String>,
    /// Branch deployed to the living test environment (e.g. `staging`). Nullable.
    pub test_env_branch: Option<String>,
    /// The project's primary/default branch (e.g. `main` or `master`). The
    /// source-control pipeline stage's baseline; nullable, auto-prefilled from
    /// the repo's default branch when known. Added 2026-05-31.
    pub main_branch: Option<String>,
    /// Standards & branching policy (Pipeline Stage 3). Opaque JSON envelope
    /// `{ precommit:{lint,docs_required,code_quality}, branching:{pr_base,automerge} }`
    /// the connected team's personas must respect (injected into member
    /// executions via team_context + CODEBASE_* env). Set via
    /// `dev_tools_set_standards_config`. Added 2026-05-31.
    pub standards_config: Option<String>,
    /// Optional binding to a `PersonaTeam` (PipelineTeam). When set, the
    /// project's surface in `ProjectManagerPage` shows the bound team's name
    /// inline so the developer can see at a glance which pipeline owns the
    /// work. No FK constraint by design — deleting a team leaves the project
    /// orphan-bound; UI treats unresolved team_ids as "(team removed)" and
    /// the user can re-bind. Added 2026-05-22.
    pub team_id: Option<String>,
    /// Workspace this project belongs to (single workspace per project,
    /// nullable = unassigned). Promotes the sub_workspaces localStorage
    /// prototype; see docs/plans/workspace-knowledge-center.md. Added 2026-07-24.
    pub workspace_id: Option<String>,
    /// Project switch. `false` overrules every persona homed in the project's
    /// team: none of them may start a run from any trigger (schedule, event,
    /// attention loop, chain, manual). Persona-level `enabled` is untouched,
    /// so switching the project back on restores each persona's own choice.
    /// Added 2026-09-16 (migration e32).
    pub enabled: bool,
    pub created_at: String,
    pub updated_at: String,
}

// ============================================================================
// Workspaces
// ============================================================================

/// A workspace: a named group of dev projects (the "org"). Grouping is via the
/// nullable `dev_projects.workspace_id` column (single workspace per project).
/// (It was also the container for the in-app knowledge library until that
/// library was retired in favour of the external ai-registry.)
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DevWorkspace {
    pub id: String,
    pub name: String,
    /// Swatch colour — the workspace's identity at a glance in switchers.
    pub color: Option<String>,
    pub description: Option<String>,
    /// Consent (set at creation) to populate the app's preset scan skills
    /// into member projects when they are assigned to this workspace.
    pub adopt_default_skills: bool,
    /// The never-delete tag (Grand Simulation rule 10,
    /// `docs/architecture/grand-simulation.md`). When set, every delete door
    /// that would remove this workspace, one of its projects, that project's
    /// team, or that team's personas' charters refuses with
    /// `AppError::Validation`. Default `false`. Added 2026-09-07.
    pub last_working_version: bool,
    pub created_at: String,
    pub updated_at: String,
}

/// One workspace from the retired localStorage prototype
/// (`devtools.workspaces.v1`) — payload of the one-time import command.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct WorkspaceImportItem {
    pub name: String,
    pub color: Option<String>,
    pub project_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DirectoryScanResult {
    pub root_path: String,
    pub file_count: i32,
    pub dir_count: i32,
    pub detected_tech: String,
    pub has_git: bool,
}

// ============================================================================
// Dev Goals
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DevGoal {
    pub id: String,
    pub project_id: String,
    pub parent_goal_id: Option<String>,
    pub context_id: Option<String>,
    /// KPI this goal was derived from / serves (outcome layer, P4).
    pub kpi_id: Option<String>,
    pub order_index: i32,
    pub title: String,
    pub description: Option<String>,
    pub status: String,
    pub progress: i32,
    pub target_date: Option<String>,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

// ============================================================================
// Dev Goal Dependencies
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DevGoalDependency {
    pub id: String,
    pub goal_id: String,
    pub depends_on_id: String,
    pub dependency_type: String,
    pub created_at: String,
}

// ============================================================================
// Dev Goal Signals
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DevGoalSignal {
    pub id: String,
    pub goal_id: String,
    pub signal_type: String,
    pub source_id: Option<String>,
    pub delta: Option<i32>,
    pub message: Option<String>,
    pub created_at: String,
}

// ============================================================================
// Dev Goal Items (lightweight ad-hoc checklist on a goal)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DevGoalItem {
    pub id: String,
    pub goal_id: String,
    pub title: String,
    pub done: bool,
    pub order_index: i32,
    /// Verification-gate kind. `None` = ordinary manual to-do. `Some("browser_test")`
    /// = a UAT gate ticked only by a passing browser test (never manually).
    pub verify_kind: Option<String>,
    /// JSON config for a verification gate (`{scenario, url?}`); `None` for to-dos.
    pub verify_config: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

// ============================================================================
// Use cases (behavioral slice layer — docs/plans/use-case-slice-layer.md)
// ============================================================================

/// The tier an import or an older row that predates the column gets. Stated as
/// a function rather than left to `Default` so the value a deserializer
/// supplies is the same one the DDL's DEFAULT supplies, in one place.
fn default_use_case_tier() -> String {
    "standard".to_string()
}

/// A **use case** is a behavioral unit that slices *through* contexts rather
/// than subdividing one: "checkout conversion" spans a UI context, an API
/// context and a data context. It is the narrowest scope a KPI can own, and the
/// join point between the codebase map and observed telemetry.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DevUseCase {
    pub id: String,
    pub project_id: String,
    /// Human display name ("Checkout conversion").
    pub name: String,
    /// Normalized join key (`checkout-conversion`). Unique per project, and the
    /// key an LLM-observability pinpoint's use-case name is matched against.
    pub slug: String,
    pub description: Option<String>,
    /// 'user_flow' | 'capability' | 'integration' | 'ops'
    pub kind: String,
    /// Placement convenience: which of the sliced contexts most owns this use
    /// case. Keeps the Factory matrix's group → context row model intact.
    pub primary_context_id: Option<String>,
    /// 'proposed' | 'active' | 'archived' — proposals are triage-gated, so a
    /// finer scope never floods the review queue.
    pub status: String,
    /// 'user' | 'scan' | 'backfill'
    pub created_by: String,
    /// Human-curated: a use-case scan must not re-propose or replace it.
    #[serde(default)]
    pub pinned: bool,
    /// 'major' | 'standard' - only a major feature reaches the council's human gate.
    #[serde(default = "default_use_case_tier")]
    pub tier: String,
    pub rationale: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    /// The slice: context ids this use case spans. Hydrated from
    /// `dev_use_case_contexts`, not a column on this table.
    #[serde(default)]
    pub context_ids: Vec<String>,
}

// ============================================================================
// Milestones (Ship layer — the convergence cut between passport scaffolding
// and post-ship KPI operation; Factory L2 → Ship tab)
// ============================================================================

/// A **milestone** is a convergence cut: a named deliverable ("v1 — First
/// Ship") whose scope is a bucketed selection of use cases plus bound goals.
/// Progress and exit criteria DERIVE from the members' states, KPI coverage
/// and context health — the schema stores decisions, never percentages.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DevMilestone {
    pub id: String,
    pub project_id: String,
    pub name: String,
    /// The objective as a SHORT TITLE — a handful of words, not a sentence and
    /// never a paragraph. The Ship tab renders this as the milestone's heading,
    /// so prose here does not read as an explanation, it reads as a broken
    /// layout. Anything longer belongs in [`Self::description`], and both the
    /// UI and the companion's `show_ship_milestone` validator enforce the split
    /// rather than trusting the writer.
    pub goal: Option<String>,
    /// What shipping this milestone actually means, in prose. Optional: a
    /// milestone whose title is self-explanatory needs nothing here.
    pub description: Option<String>,
    /// 'planned' | 'active' | 'shipped'
    pub status: String,
    pub order_index: i32,
    pub target_date: Option<String>,
    /// When the scope was cut (certified) — members added after this stamp
    /// carry `added_after_cut` and surface as scope creep.
    pub cut_at: Option<String>,
    pub shipped_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// Scope membership: one row per (milestone, item). `item_kind` 'use_case'
/// rows are the work (bucketed core/later/never); 'goal' rows are bound
/// objectives. Contexts are never members — they derive from the bound use
/// cases' slices at read time.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DevMilestoneItem {
    pub milestone_id: String,
    /// 'use_case' | 'goal'
    pub item_kind: String,
    pub item_id: String,
    /// 'core' | 'later' | 'never'
    pub bucket: String,
    /// Proposed after the cut — scope creep awaiting triage.
    #[serde(default)]
    pub added_after_cut: bool,
    pub order_index: i32,
    pub created_at: String,
    /// Why this member sits in this bucket. Free text, operator-authored.
    pub description: Option<String>,
    /// Operator's own read on the member, 1..5. NULL means UNRATED, which is
    /// deliberately distinct from a rating of 1.
    pub rating: Option<i32>,
}

// ============================================================================
// KPIs (outcome layer above goals — docs/plans/kpi-driven-orchestration.md)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DevKpi {
    pub id: String,
    pub project_id: String,
    /// NULL = project-level KPI; otherwise attached to a context group.
    pub context_group_id: Option<String>,
    /// NULL unless the KPI is scoped to a single context. When set,
    /// `context_group_id` is expected to be that context's parent group —
    /// see context_taxonomy / Part 3 context-level KPIs.
    pub context_id: Option<String>,
    /// NULL unless the KPI is scoped to one use case — the NARROWEST scope,
    /// narrower than a single context because a use case is a behavioral slice
    /// *through* contexts. Precedence: use_case > context > group > project.
    /// See docs/plans/use-case-slice-layer.md.
    pub use_case_id: Option<String>,
    pub name: String,
    pub description: Option<String>,
    /// 'technical' | 'traffic' | 'value' | 'quality'
    pub category: String,
    /// 'codebase' | 'connector' | 'manual' | 'derived'
    pub measure_kind: String,
    /// JSON measurement procedure, shape per measure_kind.
    pub measure_config: String,
    pub unit: String,
    /// 'up' | 'down' — which way is better.
    pub direction: String,
    pub baseline_value: Option<f64>,
    pub target_value: Option<f64>,
    pub target_date: Option<String>,
    pub current_value: Option<f64>,
    pub last_measured_at: Option<String>,
    /// 'manual' | 'daily' | 'weekly'
    pub cadence: String,
    /// 'proposed' | 'active' | 'paused' | 'archived'
    pub status: String,
    /// 'user' | 'scan'
    pub created_by: String,
    pub rationale: Option<String>,
    /// Connector this KPI needs to be measurable — drives the
    /// "Connect <service>" vault-catalog CTA on parked KPIs.
    pub needed_connector: Option<String>,
    /// Semantic measurement capability (P6 type-bound connectors) — e.g.
    /// `unique_visitors`, `llm_tokens`. The tool is a swappable binding.
    pub metric_type: Option<String>,
    /// `north_star` | `primary` | `supporting` — derivation precedence
    /// ("0 users beats 100% coverage").
    pub tier: String,
    /// Factory KPI console — persisted calibration thresholds + assessment.
    pub warn_at: Option<f64>,
    pub crit_at: Option<f64>,
    pub manual_rating: Option<i32>,
    pub assessment_pros: Option<String>,
    pub assessment_cons: Option<String>,
    /// Derivation looked at this off-track KPI and judged no team work would
    /// move it (needs humans / marketing / an external dependency). Set on a
    /// `skip` verdict; becomes stale (and re-derivable) once `last_measured_at`
    /// advances past it. Surfaced as the honest "over to you" state.
    pub last_skip_at: Option<String>,
    pub last_skip_rationale: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DevKpiBinding {
    pub id: String,
    pub kpi_id: String,
    pub credential_id: String,
    pub service_type: String,
    /// Frozen retrieval procedure JSON (engine::kpi_binding::Procedure).
    pub procedure: String,
    /// 'recipe' | 'llm'
    pub composed_by: String,
    /// 'active' | 'archived' | 'degraded'
    pub status: String,
    pub verified_at: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DevKpiMeasurement {
    pub id: String,
    pub kpi_id: String,
    pub value: f64,
    pub measured_at: String,
    /// 'evaluator' | 'manual' | 'scan' | 'health_snapshot' | 'simulation'
    /// | 'ai-compose'
    ///
    /// `ai-compose` was widened into the CHECK in 2026-08. Before that the
    /// compose path wrote it anyway and SQLite rejected every insert, silently
    /// — no AI-composed reading had ever reached this table.
    pub source: String,
    /// Observation environment: 'local' | 'test' | 'production'. Real
    /// (connector/manual/evaluator-in-prod) measurements default to
    /// 'production'; simulation rows are 'local'/'test' ONLY — a simulated
    /// value never claims the production channel.
    pub env: String,
    pub evidence: Option<String>,
    pub note: Option<String>,
}

/// One enriched row for the Goal Acceptance view — a goal in
/// `awaiting_acceptance` joined to its project, the project's owning team, and
/// (if linked) the KPI it serves. Flat so the frontend can group it by project
/// → KPI without N round-trips; `current/target/baseline/direction` let the UI
/// render the KPI gauge + a simple "met vs not" tint.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct PendingAcceptanceGoal {
    pub goal_id: String,
    pub title: String,
    /// First paragraph of the goal description (provenance footer stripped).
    pub summary: Option<String>,
    pub project_id: String,
    pub project_name: String,
    pub team_id: Option<String>,
    pub team_name: Option<String>,
    pub kpi_id: Option<String>,
    pub kpi_name: Option<String>,
    pub kpi_unit: Option<String>,
    pub kpi_current: Option<f64>,
    pub kpi_target: Option<f64>,
    pub kpi_baseline: Option<f64>,
    /// 'up' | 'down' — which way is better.
    pub kpi_direction: Option<String>,
    pub completed_at: Option<String>,
}

// ============================================================================
// Goal progress suggestion (hybrid auto-suggest, computed on read)
// ============================================================================

/// Result of `resolve_goal_progress` — the goal's stored progress alongside a
/// progress value DERIVED from its composed checklist (ad-hoc items + sub-goals
/// + linked team-assignment steps). The UI surfaces `suggested != current` as an
/// accept/edit nudge; a manual override always wins (we never silently write).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct GoalProgressSuggestion {
    pub goal_id: String,
    pub current: i32,
    pub suggested: i32,
    pub done_count: i32,
    pub total_count: i32,
    pub reason: String,
}

// ============================================================================
// Goals v2 — cross-project rollups (Portfolio) + needs-action queue (Attention)
// ============================================================================

/// Per-project health rollup for the Portfolio surface. Counts use the canonical
/// goal-status buckets (see `normalize_goal_status`); `at_risk` = ongoing goals
/// that are overdue or stalled. Computed in one pass over all goals — no N+1.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PortfolioProjectSummary {
    pub project_id: String,
    pub project_name: String,
    pub team_id: Option<String>,
    pub total: i32,
    pub open: i32,
    pub in_progress: i32,
    pub blocked: i32,
    pub done: i32,
    /// Ongoing (not done) goals that are overdue or stalled.
    pub at_risk: i32,
    /// Ongoing goals whose target_date is in the past.
    pub overdue: i32,
    /// Mean progress (0-100) across the project's goals (0 when none).
    pub avg_progress: i32,
}

/// The whole portfolio: per-project rollups + a grand total row.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PortfolioSummary {
    pub projects: Vec<PortfolioProjectSummary>,
    pub total_goals: i32,
    pub total_open: i32,
    pub total_in_progress: i32,
    pub total_blocked: i32,
    pub total_done: i32,
    pub total_at_risk: i32,
    pub avg_progress: i32,
}

/// How long a record may sit before the attention queue calls it stale.
///
/// Parameters, not constants. The engine used to hard-code `Duration::days(7)`,
/// which is a defensible number for a GOAL and a nonsense one for a `running`
/// task; and "stuck" means different things to a nightly sweep and to a panel a
/// human is staring at. Every field has a shipped default (see `Default`), so a
/// caller that has no opinion passes none.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct AttentionThresholds {
    /// Ongoing goal with no write for this many days → `stalled`.
    pub stale_goal_days: u32,
    /// `accepted` idea with no `dev_tasks` row for this many days →
    /// `undispatched_idea`.
    pub idea_dispatch_days: u32,
    /// `running` task with no write for this many hours → `stuck_task`.
    /// This is a HEARTBEAT, not a runtime: `task_executor` writes a progress
    /// update on every milestone and every 10 output lines, so silence for
    /// this long means the run is gone, not that the work is big.
    pub task_running_hours: u32,
    /// `queued` task untouched for this many hours → `stale_queued_task`.
    pub task_queued_hours: u32,
}

impl Default for AttentionThresholds {
    fn default() -> Self {
        Self {
            // 7 — preserved verbatim from the engine's previous hard-coded cutoff.
            stale_goal_days: 7,
            // 3 — accepting an idea IS the decision to do it, and the intended
            // flow dispatches in the same sitting. Three days is past "I'll get
            // to it today" and short of "nobody remembers agreeing to this".
            idea_dispatch_days: 3,
            // 4 — well past any healthy heartbeat gap (milestones land minutes
            // apart) while still clearing a long, genuinely-chatty deep_build.
            task_running_hours: 4,
            // 24 — a queued task is waiting on a runner; one day covers an
            // overnight gap without flagging a wave that is simply working
            // through its backlog.
            task_queued_hours: 24,
        }
    }
}

/// One row in the cross-project Attention queue — a goal, an idea, or a task
/// that needs the user.
///
/// `kind` ∈ `awaiting_review` | `overdue` | `stalled` | `unstaffed`
///        | `undispatched_idea` | `stuck_task` | `stale_queued_task`
///        | `kpi_gone_dark` | `kpi_never_measured`.
///
/// The first four are goal signals and keep their original `rank` values; every
/// later kind is APPENDED at the next free rank rather than interleaved, so the
/// pre-existing ordering contract is untouched (record-widening at 4-6, the two
/// KPI-freshness kinds at 7-8). Within a rank the queue sorts by age, worst
/// first.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct AttentionItem {
    pub kind: String,
    /// Which record type this row is about: `goal` | `idea` | `task` | `kpi`.
    pub entity_kind: String,
    /// Id of the record that needs attention — a goal, idea, task or KPI id.
    /// Always the thing the UI should open.
    pub entity_id: String,
    pub entity_title: String,
    /// The goal in play. A `goal` row always carries it; an idea or task row
    /// carries its linked goal when it has one and `None` when it does not.
    /// (These were non-optional while the queue was goal-only; an idea with no
    /// goal would have had to be given an empty id that reads as a real link.)
    pub goal_id: Option<String>,
    pub goal_title: Option<String>,
    /// Ideas and tasks may be project-less (`dev_tasks.project_id` and
    /// `dev_ideas.project_id` are both nullable); goal rows always have one.
    pub project_id: Option<String>,
    pub project_name: Option<String>,
    pub status: String,
    /// 0-100 where the record tracks it (goals, tasks). `None` for ideas, which
    /// have no progress — a `0` there would read as "started, got nowhere".
    pub progress: Option<i32>,
    /// Human-meaningful context: e.g. "8d overdue", "stalled 11d", step title.
    pub detail: String,
    /// Present for `awaiting_review` rows so the UI can resolve the step inline.
    pub assignment_id: Option<String>,
    pub step_id: Option<String>,
    /// Age of the SIGNAL in whole hours — days overdue, hours since the last
    /// heartbeat, hours since acceptance. Hours (not days) because a task
    /// signal lives at hour resolution and a goal signal at day resolution, and
    /// one unit that can express both beats two fields that disagree.
    /// `None` when the underlying timestamp could not be parsed — never 0.
    pub age_hours: Option<u32>,
    /// 0 = highest urgency; drives ranking in the queue.
    pub rank: i32,
}

/// The cross-project "needs you" queue: one flat, ranked `items` list plus a
/// count per signal so a caller can render a summary without walking the list.
///
/// One list rather than per-kind groups, deliberately: the queue's job is to
/// answer "what should I look at next" across three record types, and grouping
/// would push that decision onto every consumer.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct AttentionQueue {
    pub items: Vec<AttentionItem>,
    // -- goal signals (unchanged) --
    pub awaiting_review: u32,
    pub overdue: u32,
    pub stalled: u32,
    /// Goal-only by design: an ongoing goal nobody is staffed against. Ideas
    /// and tasks have no equivalent — an idea's "nobody is on this" signal is
    /// `undispatched_ideas`, and a task IS the staffing.
    pub unstaffed: u32,
    // -- record-widening signals --
    /// `accepted` ideas with no task, past `thresholds.idea_dispatch_days`.
    /// The unfiltered list lives behind `dev_tools_undispatched_ideas`.
    pub undispatched_ideas: u32,
    /// `running` tasks whose heartbeat has gone quiet.
    pub stuck_tasks: u32,
    /// `queued` tasks nothing has picked up.
    pub stale_queued_tasks: u32,
    /// The thresholds this queue was actually computed with, echoed back so a
    /// UI can label a row ("no heartbeat in 4h") without hardcoding a number
    /// the backend may not have used.
    pub thresholds: AttentionThresholds,
}

/// An idea a human said YES to that never became work.
///
/// Nothing in the app could answer this before. `archive_stale_ideas` has the
/// same `NOT EXISTS (SELECT 1 FROM dev_tasks WHERE source_idea_id = …)` shape,
/// but it is scoped to `pending` ideas — so an ACCEPTED idea with no task, a
/// decision made and then dropped, was invisible in every surface.
///
/// Unfiltered by age on purpose: the age is returned so the caller decides what
/// counts as "too long". The attention queue applies a threshold; a dispatch
/// panel wants the whole list.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct UndispatchedIdea {
    pub id: String,
    pub title: String,
    pub project_id: Option<String>,
    pub project_name: Option<String>,
    pub category: Option<String>,
    /// `None` = a classic Idea-Scanner idea; `Some` = a sensor finding.
    pub origin: Option<String>,
    /// Strategist triage rank, 1 = do next. `None` = unranked.
    pub priority: Option<i32>,
    pub impact: Option<i32>,
    pub effort: Option<i32>,
    /// When it was accepted, as far as the row knows: `updated_at` (the stamp
    /// the acceptance write set), falling back to `created_at`.
    pub accepted_at: String,
    /// Whole hours since `accepted_at`. `None` when that stamp is unparseable —
    /// never 0, which would read as "accepted just now".
    pub age_hours: Option<u32>,
}

// ============================================================================
// Per-environment connector bindings
// ============================================================================

/// One connector bound to a (dimension, environment) pair on a project.
///
/// `dev_projects` carries four SINGULAR credential pointers, which cannot
/// express what the passport's env-split dimensions need: a different database
/// behind local vs test vs production, or a different monitoring backend per
/// capability. This row type is that axis.
///
/// `dimension` is the passport row key, optionally suffixed with a capability
/// (`"persistence"`, `"monitoring"`, `"monitoring.logs"`); `env` is one of
/// `local` | `test` | `production`. A `credential_id` of `None` means the pair
/// was explicitly cleared — the row is deleted rather than kept as a tombstone.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DevProjectEnvConnector {
    pub project_id: String,
    pub dimension: String,
    pub env: String,
    pub credential_id: String,
    pub created_at: String,
    pub updated_at: String,
}

// ============================================================================
// Dev Context Groups
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DevContextGroup {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub color: String,
    pub icon: Option<String>,
    pub group_type: Option<String>,
    /// Business domain (feature|infrastructure|shared|integration|data) — see context_taxonomy.
    pub domain: Option<String>,
    pub position: i32,
    pub health_score: Option<i32>,
    pub last_scan_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

// ============================================================================
// Dev Contexts
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DevContext {
    pub id: String,
    pub project_id: String,
    pub group_id: Option<String>,
    pub name: String,
    pub description: Option<String>,
    pub file_paths: String,
    pub entry_points: Option<String>,
    pub db_tables: Option<String>,
    pub keywords: Option<String>,
    pub api_surface: Option<String>,
    pub cross_refs: Option<String>,
    pub tech_stack: Option<String>,
    /// Technical category (ui|api|lib|data|test|config) — see context_taxonomy.
    pub category: Option<String>,
    /// Human-readable business feature name (often equals the context name).
    pub business_feature: Option<String>,
    /// Canonical pin: when true, a full rescan preserves this hand-curated
    /// context instead of DELETE-and-recreate. See dev_contexts.pinned migration.
    #[serde(default)]
    pub pinned: bool,
    pub created_at: String,
    pub updated_at: String,
}

// ============================================================================
// Dev Context Fingerprints — the cached, deterministic structural facts
// ============================================================================

/// One row of `dev_context_fingerprints`: cheap, deterministic, LLM-free facts
/// about a context's files, cached so repeat questions become SQL instead of
/// file reads.
///
/// `content_hash` covers the context's file LIST *and* each file's sha256, so
/// any membership or content change invalidates the row. A refresh that finds
/// an unchanged hash skips reading the context's files entirely.
///
/// Everything here is a FACT, not a verdict — see
/// `personas_core::context_fingerprint` for what each counter does and does not
/// mean (notably `set_state_after_await_count`, which is a coarse proxy).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DevContextFingerprint {
    pub project_id: String,
    pub context_id: String,
    pub content_hash: String,
    pub file_count: i32,
    /// Mapped `file_paths` entries that no longer exist on disk. Non-zero means
    /// the fingerprint is derived from a partially stale map — surfaced rather
    /// than silently skipped.
    pub missing_file_count: i32,
    /// JSON array of detected third-party/framework dependencies.
    pub imports: Option<String>,
    /// JSON array of in-repo primitives present.
    pub primitives: Option<String>,
    pub promise_all_count: i32,
    pub join_all_count: i32,
    pub await_count: i32,
    pub sql_write_count: i32,
    pub spawn_count: i32,
    pub use_effect_count: i32,
    pub set_state_after_await_count: i32,
    pub exports_components: bool,
    pub exports_hooks: bool,
    pub exports_commands: bool,
    pub exports_repo_fns: bool,
    pub computed_at: String,
}

// ============================================================================
// Dev Context Group Relationships
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DevContextGroupRelationship {
    pub id: String,
    pub project_id: String,
    pub source_group_id: String,
    pub target_group_id: String,
    pub created_at: String,
}

// ============================================================================
// Dev Memories — the project-scoped memory of the development loop
// ============================================================================

/// What produced a `DevMemory`. Each learning moment in the loop is a source
/// here:
///   `idea_decision` — a human or the Strategist accepted/rejected a backlog
///                     idea. Rejections become CONSTRAINTS.
///   `task_outcome`  — a dev-runner task reached a terminal state. What shipped,
///                     or what failed and why.
///   `scan_funnel`   — a scan-and-decide run's funnel summary (reserved for the
///                     Phase 4 flow; see docs/plans/backlog-memory-loop.md).
///   `kp_dossier`    — what the kp repo dossier said about this repository at
///                     hire time (declared gates, hot spots, risk areas),
///                     seeded once per field by the App-master hire path. The
///                     `source_id` is the dossier FIELD NAME, so a re-hire on
///                     the same project re-states the same facts and writes
///                     nothing: repo knowledge outlives tenure, and a second
///                     tenure should inherit it rather than duplicate it.
///   `app_master_proposal`
///                   — an App master proposal branch's observed fate (opened /
///                     gated / merged / reverted), written by the reconciler.
///                     The `source_id` is `<branch>:<event>`, so the 30-minute
///                     reconcile that re-walks every known proposal forever
///                     costs one row per fate and never inflates the record.
///                     Project-scoped on purpose: what a repository accepted or
///                     took back outlives any one tenure.
pub const DEV_MEMORY_SOURCES: &[&str] = &[
    "idea_decision",
    "task_outcome",
    "scan_funnel",
    "kp_dossier",
    "app_master_proposal",
    // A role this project asked kp for. The project remembers what it hired and
    // why, so the next wake that considers hiring can read that the gap was
    // already named — the partial unique index on
    // (project_id, source_kind, source_id) makes a repeated ask idempotent.
    "hire_request",
];

/// Project-scoped memory for the development loop (scan → triage → execute).
///
/// WHY A SEPARATE STORE: decisions were only ever written to `team_memories`,
/// which is keyed on a team — so a project without a team learned NOTHING, and
/// the task executor (which has a project, not a team) had nothing to read.
/// This is the loop's own canonical store, anchored on the one id every
/// participant in the loop shares: the project. Team memory stays the
/// cross-persona workspace ledger; the two are written in parallel, never
/// instead of each other.
// NOTE: `#[ts(export)]` is deliberately withheld until a UI actually reads dev
// memories (Phase 4 at the earliest). Phase 2 is a backend-only loop — exporting
// a binding no frontend imports would only add drift surface to the
// binding-drift CI job. Add `#[ts(export)]` and run
// `cargo test export_bindings` in the same change that first displays these.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct DevMemory {
    pub id: String,
    pub project_id: String,
    /// Memory kind, mirroring the persona memory vocabulary so both stores read
    /// the same way: `constraint` (a durable "don't"), `decision` (a settled
    /// "do"), `learned` (an outcome observation), `context`.
    pub category: String,
    pub title: String,
    pub content: String,
    /// 1–10. Constraints outrank decisions outrank observations, so the
    /// injection budget spends itself on the memories that change behaviour.
    pub importance: i32,
    /// One of `DEV_MEMORY_SOURCES`.
    pub source_kind: String,
    /// Provenance: the idea / task id this memory was derived from. No FK by
    /// design (mirrors MEMORY CONTRACT (2)) — deleting the source must not
    /// erase what the loop learned from it.
    pub source_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

// ============================================================================
// Dev Ideas
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DevIdea {
    pub id: String,
    pub project_id: Option<String>,
    pub context_id: Option<String>,
    pub scan_type: String,
    pub category: String,
    pub title: String,
    pub description: Option<String>,
    pub reasoning: Option<String>,
    pub status: String,
    pub effort: Option<i32>,
    pub impact: Option<i32>,
    pub risk: Option<i32>,
    /// Strategist triage rank (1 = do next). Set by the backlog-triage job;
    /// promotion prefers ranked ideas. None = unranked.
    pub priority: Option<i32>,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub rejection_reason: Option<String>,
    /// Which sensor raised this (the findings spine — see
    /// `docs/plans/dev-findings-loop.md`). `None` = a classic Idea-Scanner idea.
    /// One of: `standards_finding` | `passport_gap` | `llm_cost` | `sentry_spike`
    /// | `kpi_offtrack` | `skill_dormant` | `doc_rot` | `kpi_sim` | `memory_disputed`.
    pub origin: Option<String>,
    /// The use case the emitting signal belongs to. Orphan-tolerant (no FK).
    pub use_case_id: Option<String>,
    /// JSON blob of the raw numbers that justified emission. Phase 3's
    /// verification probe re-measures against these — keep them comparable.
    pub evidence: Option<String>,
    /// Stable key per underlying signal (`sentry:<shortId>`, …). A sweep never
    /// re-raises a finding already present in ANY status, `rejected` included.
    pub dedup_key: Option<String>,
    /// The goal this finding serves (G41). Named by the filer
    /// (`propose_backlog.goal`), inherited by the task minted from the idea,
    /// so a goal's progress can be read from the work attached to it. No FK:
    /// a goal deleted later leaves its ideas standing.
    pub goal_id: Option<String>,
    /// Did shipping this actually move the signal? One of `VERIFY_STATES`.
    /// `None`/`pending` = not judged yet. `unchanged` / `regressed` are real
    /// outcomes, not errors — "merged" is not the same as "fixed".
    pub verify_state: Option<String>,
    pub verify_checked_at: Option<String>,
    /// The RE-MEASURED reading (same shape as `evidence`) — lets a verdict be
    /// audited before-vs-after rather than taken on trust.
    pub verify_evidence: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// The verdicts a verification pass can reach.
pub const VERIFY_STATES: [&str; 5] = ["pending", "cleared", "moved", "unchanged", "regressed"];

/// The sensors that can raise a finding. Kept as a validated allowlist so a typo
/// in an emitter can't quietly create a new origin the triage UI won't render.
///
/// `workspace_practice` is the odd one out: it is not a *measurement* sensor but
/// the retired Workspace Knowledge Center's origin for an adopted practice
/// materialized as work a member repo owed. Nothing emits it any more; it stays
/// in the allowlist so ideas already filed under it keep rendering.
pub const FINDING_ORIGINS: [&str; 11] = [
    "standards_finding",
    "passport_gap",
    "llm_cost",
    "sentry_spike",
    "kpi_offtrack",
    "skill_dormant",
    "doc_rot",
    "kpi_sim",
    "memory_disputed",
    "workspace_practice",
    // scan-sweep skill findings + deep-scan escalations arriving through the
    // memory-outbox door (memory_ledger.rs).
    "scan_sweep",
];

// ----------------------------------------------------------------------------
// The backlog contract — one door, one source vocabulary, one plan
// ----------------------------------------------------------------------------
//
// Measured 2026-09-21 on the operator's live database, which is what this
// contract exists to repair. `dev_ideas` held 2,093 rows filed through THREE
// write doors with three different field sets:
//
//   `create_idea` / `create_idea_deduped`  — 15 positional arguments whose
//       INSERT has no column for `origin`, `use_case_id`, `evidence`,
//       `goal_id` or `verify_state`. ~96% of every row ever filed.
//   `create_finding` — the only door that carries those columns, validated
//       against `FINDING_ORIGINS`. ~4% of rows.
//
// The split is documented on `create_finding` itself as deliberate ("so the
// scanner's 14-arg signature and every existing call site stay untouched"),
// and the cost is exactly what a split vocabulary always costs: `origin` NULL
// on 96% of rows, `priority` and `use_case_id` populated on zero, and
// `provider`/`model` NULL on 2,038 of 2,093 — so the App Master's 1,208
// Opus-authored items are anonymous in their own table.
//
// `origin` is therefore promoted to THE source vocabulary rather than replaced
// by a new column: it already had the closed allowlist and the validator, it
// was merely unreachable from the doors that carried the traffic.

/// Every producer that may file a backlog item.
///
/// A CLOSED vocabulary, deliberately — `scan_type` was free text and grew 14
/// values with no authority deciding them, which is the drift
/// `one-authority-per-vocabulary` names. The first eleven variants are
/// [`FINDING_ORIGINS`] verbatim, so every row already filed keeps parsing; the
/// rest are the producers that used to identify themselves only through
/// `scan_type`.
///
/// `scan_type` SURVIVES as the producer's own sub-key — the Idea Scanner's
/// eight agent lenses (`architecture-analyst`, `security-auditor`, …) live
/// there and are not sources in their own right.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum BacklogSource {
    // --- the eleven historical `FINDING_ORIGINS`, unchanged ---
    StandardsFinding,
    PassportGap,
    LlmCost,
    SentrySpike,
    KpiOfftrack,
    SkillDormant,
    DocRot,
    KpiSim,
    MemoryDisputed,
    /// Retired producer; kept so rows already filed under it keep rendering.
    WorkspacePractice,
    ScanSweep,
    // --- producers that previously identified themselves via `scan_type` ---
    /// An App Master's write-back over the loopback bridge. The single largest
    /// producer (1,208 of 2,093 rows measured 2026-09-21).
    AppMaster,
    /// The `propose_backlog` protocol verb, available to EVERY persona run —
    /// the name says "team" for historical reasons only.
    TeamProposed,
    /// A `propose_backlog` filing reclassified as being about this app rather
    /// than the filer's own project.
    PlatformEscalation,
    /// The Idea Scanner's agent lenses; the lens key stays in `scan_type`.
    IdeaScanner,
    /// The App-Master bench harness's synthetic seed work.
    HeadlessBenchSeed,
    /// Deterministic CLI tools (Fallow / Knip / Jscpd / Impeccable). No model.
    StaticScan,
    /// Product findings surfaced as a side-channel of a memory-consolidation run.
    MemoryReflection,
    /// A human typing an item into the backlog form.
    Manual,
}

impl BacklogSource {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::StandardsFinding => "standards_finding",
            Self::PassportGap => "passport_gap",
            Self::LlmCost => "llm_cost",
            Self::SentrySpike => "sentry_spike",
            Self::KpiOfftrack => "kpi_offtrack",
            Self::SkillDormant => "skill_dormant",
            Self::DocRot => "doc_rot",
            Self::KpiSim => "kpi_sim",
            Self::MemoryDisputed => "memory_disputed",
            Self::WorkspacePractice => "workspace_practice",
            Self::ScanSweep => "scan_sweep",
            Self::AppMaster => "app_master",
            Self::TeamProposed => "team_proposed",
            Self::PlatformEscalation => "platform_escalation",
            Self::IdeaScanner => "idea_scanner",
            Self::HeadlessBenchSeed => "headless_bench_seed",
            Self::StaticScan => "static_scan",
            Self::MemoryReflection => "memory_reflection",
            Self::Manual => "manual",
        }
    }

    /// Parse a stored token.
    ///
    /// Accepts the historical `scan_type` spellings alongside the canonical
    /// ones, because the backfill reads `scan_type` for the 96% of rows whose
    /// `origin` is NULL and those rows spell two of the names with a hyphen.
    pub fn from_token(s: &str) -> Option<Self> {
        match s {
            "standards_finding" => Some(Self::StandardsFinding),
            "passport_gap" => Some(Self::PassportGap),
            "llm_cost" => Some(Self::LlmCost),
            "sentry_spike" => Some(Self::SentrySpike),
            "kpi_offtrack" => Some(Self::KpiOfftrack),
            "skill_dormant" => Some(Self::SkillDormant),
            "doc_rot" => Some(Self::DocRot),
            "kpi_sim" => Some(Self::KpiSim),
            "memory_disputed" => Some(Self::MemoryDisputed),
            "workspace_practice" => Some(Self::WorkspacePractice),
            "scan_sweep" => Some(Self::ScanSweep),
            // `scan_type` spells this one with a hyphen; both are accepted and
            // only the underscore form is ever written.
            "app_master" | "app-master" => Some(Self::AppMaster),
            "team_proposed" => Some(Self::TeamProposed),
            "platform_escalation" => Some(Self::PlatformEscalation),
            "idea_scanner" => Some(Self::IdeaScanner),
            "headless_bench_seed" => Some(Self::HeadlessBenchSeed),
            "static_scan" => Some(Self::StaticScan),
            "memory_reflection" => Some(Self::MemoryReflection),
            "manual" | "cross-impact" => Some(Self::Manual),
            // Every Idea-Scanner lens is that one source; the lens itself stays
            // in `scan_type`. Derived from `scan_agents.toml`, not invented.
            "architecture-analyst"
            | "security-auditor"
            | "accessibility-checker"
            | "business-strategist"
            | "onboarding-designer"
            | "error-handler"
            | "test-strategist"
            | "ux-reviewer" => Some(Self::IdeaScanner),
            _ => None,
        }
    }

    /// True for a source whose items a static tool produced, so no model
    /// attribution is owed and `Draft` completeness is expected.
    pub fn is_mechanical(&self) -> bool {
        matches!(self, Self::StaticScan | Self::HeadlessBenchSeed)
    }

    /// The scale this producer's prompt actually asks for.
    ///
    /// **Two scales live in one column and this is where the exchange rate is
    /// declared.** Measured on the live table 2026-09-21: `team_proposed`
    /// scored 1-5 across 502 rows (its prompt documents a MEANING per band —
    /// "3 = touches a route, a contract or a schema", "5 = unblocks a goal or a
    /// money path"), while `idea_scanner.rs:192` asks the model for
    /// `"effort": <1-10>, "impact": <1-10>, "risk": <1-10>` and the scan-sweep
    /// skill emits up to 10. 75 rows exceeded 5.
    ///
    /// Left unconverted, a rank that compares producers compares unlike things:
    /// a scanner's 5 is the middle of its range and a persona's 5 is the top of
    /// its own. So the door converts INTO the queue's scale
    /// ([`IDEA_SCALE_MAX`]) rather than passing the producer's number through,
    /// and this function is the only place the difference is stated.
    pub fn native_scale_max(&self) -> i32 {
        match self {
            // The Idea Scanner's prompt and the scan-sweep skill's JSONL both
            // grade out of ten.
            Self::IdeaScanner | Self::ScanSweep => 10,
            // Everything else is filed against a 1-5 contract: the
            // `propose_backlog` verb, the App Master write-back (which refuses
            // a filing outside 1-5 at its own door), and the sensors.
            _ => IDEA_SCALE_MAX,
        }
    }
}

/// The one scale `effort`, `impact` and `risk` are ranked on.
///
/// Chosen over the wider alternative because it is the only one whose bands
/// carry documented MEANINGS: the `propose_backlog` contract spells out what
/// each number claims ("1 = documentation or a reversible local change … 4 =
/// touches ledger, settlement or security semantics … 5 = irreversible or
/// external"), and a project's mechanical triage rules accept or hold an item
/// by reading them. A number that means something is worth more to a ranker
/// than a number with more room in it.
///
/// A producer grading out of ten is converted here rather than stored raw —
/// see [`BacklogSource::native_scale_max`] and [`normalize_scale`].
pub const IDEA_SCALE_MAX: i32 = 5;

/// Convert a producer's score into [`IDEA_SCALE_MAX`].
///
/// Monotone and total: `ceil(v * IDEA_SCALE_MAX / from_max)`, so a 1-10 score
/// folds 1,2 → 1 · 3,4 → 2 · 5,6 → 3 · 7,8 → 4 · 9,10 → 5. Order is preserved,
/// the top of one range maps to the top of the other, and nothing collapses to
/// zero — which matters because `0` is the value the absent-value convention
/// exists to refuse.
///
/// `None` in, `None` out: absent is absent, and a producer that omitted a score
/// must not acquire one by passing through a conversion.
pub fn normalize_scale(value: Option<i32>, from_max: i32) -> Option<i32> {
    let v = value?;
    if from_max <= IDEA_SCALE_MAX || v <= 0 {
        // Already on the queue's scale, or a value the door is about to refuse
        // anyway — converting it would disguise the thing worth refusing.
        return Some(v);
    }
    // Ceiling division written out: `i32::div_ceil` is still unstable on this
    // toolchain, and both operands are small positive integers here.
    let scaled = (v * IDEA_SCALE_MAX + from_max - 1) / from_max;
    Some(scaled.clamp(1, IDEA_SCALE_MAX))
}

/// The states a backlog item may hold.
///
/// Closed as of this contract. The column carries no CHECK constraint and
/// `decide_idea_cas` took a bare `&str`, so the vocabulary was open in the
/// database, in Rust and in TypeScript simultaneously — and the two states
/// this enum adds are the ones whose absence let 518 completed items sit in
/// `Accepted` forever.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum IdeaStatus {
    /// Filed, no verdict passed.
    Pending,
    /// A human or a triage rule said yes. NOT a terminal state — it means
    /// "decided to build", and until this contract it was where items died.
    Accepted,
    Rejected,
    /// Aged out of `Pending` without ever being decided. Reversible.
    Archived,
    /// The work exists in the repository, evidenced by the commit recorded in
    /// `verify_evidence`. Reached from the write-back's own outcome, never
    /// from an executor's say-so.
    Delivered,
    /// Aged out of `Accepted` without ever becoming work. A DISTINCT terminal
    /// state on purpose: an automated sweep must never write the same token a
    /// human verdict writes, or every downstream reading of "who decided this"
    /// becomes unanswerable.
    Expired,
}

impl IdeaStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Accepted => "accepted",
            Self::Rejected => "rejected",
            Self::Archived => "archived",
            Self::Delivered => "delivered",
            Self::Expired => "expired",
        }
    }

    pub fn from_token(s: &str) -> Option<Self> {
        match s {
            "pending" => Some(Self::Pending),
            "accepted" => Some(Self::Accepted),
            "rejected" => Some(Self::Rejected),
            "archived" => Some(Self::Archived),
            "delivered" => Some(Self::Delivered),
            "expired" => Some(Self::Expired),
            _ => None,
        }
    }

    /// True once the item needs nothing further from anyone.
    pub fn is_terminal(&self) -> bool {
        matches!(self, Self::Rejected | Self::Delivered | Self::Expired)
    }
}

/// Whether an item carries everything a dispatch needs.
///
/// `Draft` is deliberately STORED rather than refused: the dominant producer
/// files over loopback HTTP from a detached worktree and never retries, so a
/// refusal at the door is lost work. A `Draft` item is visible, countable and
/// reviewable — it simply cannot become a task until something completes it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum IdeaCompleteness {
    Full,
    Draft,
}

impl IdeaCompleteness {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Full => "full",
            Self::Draft => "draft",
        }
    }

    pub fn from_token(s: &str) -> Option<Self> {
        match s {
            "full" => Some(Self::Full),
            "draft" => Some(Self::Draft),
            _ => None,
        }
    }
}

/// One numbered step of an item's execution plan.
///
/// `files` is what makes a wave computable: two items may run in parallel
/// exactly when their plans' file sets do not intersect, which is a property
/// to be CHECKED rather than a grouping to be guessed.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PlanStep {
    /// 1-based position. Steps are ordered and the order is the execution order.
    pub n: u32,
    /// One imperative line naming the change, at the altitude a competent
    /// engineer would write a commit subject at.
    pub action: String,
    /// The paths this step touches, repo-relative. Never empty for a step that
    /// changes code.
    pub files: Vec<String>,
    /// The observable condition that makes this step finished — a test that
    /// passes, a command that exits clean, a value the UI shows.
    pub done_when: String,
}

/// The execution plan an analysing model leaves for an executing model.
///
/// The asymmetry this exists to fix, measured 2026-09-21: the item's prose was
/// pasted into the worker's prompt under a heading literally named
/// `## Background`, and the plan was then demanded FROM the worker by a depth
/// switch ("Research phase … Planning phase … write a detailed plan"). So the
/// expensive model analysed and the cheap model planned, which is backwards,
/// and only ~8% of the largest producer's items contained so much as a
/// numbered list.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct IdeaPlan {
    pub steps: Vec<PlanStep>,
}

impl IdeaPlan {
    /// Every path any step touches, de-duplicated. The wave computation's input.
    pub fn file_scope(&self) -> Vec<String> {
        let mut seen: Vec<String> = Vec::new();
        for step in &self.steps {
            for f in &step.files {
                if !seen.iter().any(|s| s == f) {
                    seen.push(f.clone());
                }
            }
        }
        seen
    }

    /// A plan is usable when it has at least one step and every step names a
    /// path. A plan whose steps touch nothing cannot be scheduled against
    /// anything, so it is not a plan.
    pub fn is_actionable(&self) -> bool {
        !self.steps.is_empty() && self.steps.iter().all(|s| !s.files.is_empty())
    }
}

/// The ONE input every producer builds to file a backlog item.
///
/// Replaces three positional signatures. Absent-value convention, stated once
/// and applying to every field: a producer OMITS what it has no value for and
/// the door writes SQL NULL. Never `0`, never `""` — the three scales run 1-5,
/// so a `0` is a validation error and not a missing value.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct IdeaDraft {
    /// Nullable, because the column is: `dev_tools_create_idea` files an
    /// unassigned idea with no project, and `dev_ideas.project_id` has always
    /// allowed NULL. An empty string is NOT how absence is spelled here — that
    /// is exactly the shape the absent-value convention below refuses.
    pub project_id: Option<String>,
    /// The producer. Written to `dev_ideas.origin`.
    pub source: BacklogSource,
    /// The producer's own sub-key (an Idea-Scanner lens, a static tool name).
    /// Written to `dev_ideas.scan_type`; defaults to `source.as_str()`.
    pub scan_type: Option<String>,
    pub context_id: Option<String>,
    pub category: Option<String>,
    pub title: String,
    pub description: Option<String>,
    pub reasoning: Option<String>,
    pub evidence: Option<String>,
    pub effort: Option<i32>,
    pub impact: Option<i32>,
    pub risk: Option<i32>,
    pub goal_id: Option<String>,
    pub use_case_id: Option<String>,
    pub plan: Option<IdeaPlan>,
    /// Attribution. The door STAMPS these from the caller's dispatch context
    /// rather than trusting a producer's claim about itself; a producer that
    /// genuinely knows (the Idea Scanner spawns its own CLI) may pass them.
    pub provider: Option<String>,
    pub model: Option<String>,
    pub dedup_key: Option<String>,
    /// Only a producer with a standing auto-accept arrangement passes this.
    /// Omitted means `pending`.
    pub status: Option<String>,
}

impl IdeaDraft {
    /// A draft belonging to no project.
    ///
    /// The human form behind dev_tools_create_idea files one, and the column
    /// has always allowed it. Spelled as its own constructor so no caller has
    /// to reach for an empty string to mean absence.
    pub fn unassigned(source: BacklogSource, title: impl Into<String>) -> Self {
        let mut draft = Self::new(String::new(), source, title);
        draft.project_id = None;
        draft
    }

    /// Minimal draft; every optional field stays absent.
    pub fn new(
        project_id: impl Into<String>,
        source: BacklogSource,
        title: impl Into<String>,
    ) -> Self {
        Self {
            project_id: Some(project_id.into()),
            source,
            scan_type: None,
            context_id: None,
            category: None,
            title: title.into(),
            description: None,
            reasoning: None,
            evidence: None,
            effort: None,
            impact: None,
            risk: None,
            goal_id: None,
            use_case_id: None,
            plan: None,
            provider: None,
            model: None,
            dedup_key: None,
            status: None,
        }
    }

    /// What the door will record.
    ///
    /// `Full` requires the three scales AND a description AND an actionable
    /// plan. The scales because an unrated item can never be ranked or
    /// auto-accepted; the plan because without one the executing model is
    /// asked to do the analysis the filing model was supposed to have done.
    pub fn completeness(&self) -> IdeaCompleteness {
        let rated = self.effort.is_some() && self.impact.is_some() && self.risk.is_some();
        let described = self
            .description
            .as_deref()
            .is_some_and(|d| !d.trim().is_empty());
        let planned = self.plan.as_ref().is_some_and(|p| p.is_actionable());
        if rated && described && planned {
            IdeaCompleteness::Full
        } else {
            IdeaCompleteness::Draft
        }
    }
}

/// A status word a producer wrote into a TITLE instead of into the status
/// column.
///
/// Not hypothetical: on 2026-09-17 a scan-sweep run filed fifteen items whose
/// titles began `[ACCEPTED]`, all of them `status = 'pending'`. The acceptance
/// existed only as characters, so the state machine never saw it and no reaper
/// could reach them either — `archive_stale_ideas` skips a row whose `origin`
/// is set. The door refuses the shape rather than storing a lie.
pub const TITLE_STATUS_TAGS: [&str; 8] = [
    "[accepted]",
    "[rejected]",
    "[approved]",
    "[declined]",
    "[done]",
    "[wip]",
    "[todo]",
    "[blocked]",
];

/// The leading bracketed status tag in `title`, if any, lowercased.
pub fn title_status_tag(title: &str) -> Option<&'static str> {
    let lowered = title.trim().to_ascii_lowercase();
    TITLE_STATUS_TAGS
        .iter()
        .find(|tag| lowered.starts_with(*tag))
        .copied()
}

// ============================================================================
// Dev Scans
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DevScan {
    pub id: String,
    pub project_id: Option<String>,
    pub scan_type: String,
    pub status: String,
    pub idea_count: i32,
    pub input_tokens: Option<i64>,
    pub output_tokens: Option<i64>,
    pub duration_ms: Option<i64>,
    pub error: Option<String>,
    pub created_at: String,
}

// ============================================================================
// Dev Standards (Pipeline Stage 3 — golden-standard scan findings)
// ============================================================================

/// One per-rule compliance finding from the golden-standard LLM scan
/// (`standards_scan.rs`). The scan adapts the shipped golden ruleset to the
/// repo's character and reports each rule's status to this table.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DevStandard {
    pub id: String,
    pub project_id: String,
    pub scan_id: Option<String>,
    /// Stable rule identifier, e.g. `lint.config`, `docs.readme`, `tests.coverage`, `branching.naming`.
    pub rule_key: String,
    /// `precommit` | `docs` | `code_quality` | `branching` | `testing`.
    pub category: String,
    pub title: String,
    /// `present` | `partial` | `missing`.
    pub status: String,
    /// `info` | `warn` | `critical`.
    pub severity: String,
    pub evidence: Option<String>,
    pub recommendation: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

// ============================================================================
// Dev Tasks
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DevTask {
    pub id: String,
    pub project_id: Option<String>,
    pub title: String,
    pub description: Option<String>,
    pub source_idea_id: Option<String>,
    pub goal_id: Option<String>,
    pub status: String,
    pub session_id: Option<String>,
    pub progress_pct: i32,
    pub output_lines: i32,
    pub error: Option<String>,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub created_at: String,
    /// Last mutation stamp — RFC3339, written by every repo path that changes a
    /// task. `None` only for a row that predates the `dev_tasks_updated_at`
    /// migration on a database that has not run it yet; the migration backfills
    /// `COALESCE(completed_at, started_at, created_at)`. Because the task
    /// executor writes a progress update on every milestone, this doubles as a
    /// heartbeat: a `running` task whose `updated_at` has gone quiet is stuck,
    /// not merely long-running.
    pub updated_at: Option<String>,
    /// Task depth: "quick" (immediate execution), "campaign" (subtask breakdown),
    /// or "deep_build" (full planning + implementation phases).
    pub depth: String,
    /// Retry lineage: the task this one was created as a re-attempt of.
    /// `None` = an original task. The chain is flat by construction — a retry
    /// of a retry points at its immediate parent, and `attempt` counts depth.
    pub parent_task_id: Option<String>,
    /// 1 for an original task; `parent.attempt + 1` for each re-attempt.
    pub attempt: i32,
    /// The directory this run's CLI was actually spawned in — the isolated
    /// authoring worktree, or the project root when isolation was refused.
    /// `None` until the task starts running (and for every task written before
    /// the runner isolated its work, G12).
    pub worktree_path: Option<String>,
    /// `autopilot/<slug>` — the branch `worktree_path` is checked out on.
    /// `None` ⟺ the run was NOT isolated; this is the branch a reviewer merges.
    pub worktree_branch: Option<String>,
    /// Why isolation was refused, when it was. `None` ⟺ the run WAS isolated.
    /// The mirror of `worktree_branch`, so a fallback into the operator's own
    /// checkout is recorded on the row rather than only in a log line.
    pub worktree_fallback_reason: Option<String>,
}

/// The task status vocabulary. `pending` is NOT in it — a legacy writer used it
/// and the Run Desk rendered nothing for it; `run_incremental` normalizes those
/// rows to `queued`. Unknown values are warned about, never rejected: refusing
/// a status write would strand a task mid-run.
pub const TASK_STATUSES: [&str; 5] = ["queued", "running", "completed", "failed", "cancelled"];

// ============================================================================
// Dev Competitions (multi-clone parallel task execution)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DevCompetition {
    pub id: String,
    pub project_id: String,
    pub task_title: String,
    pub task_description: Option<String>,
    pub source_idea_id: Option<String>,
    pub source_goal_id: Option<String>,
    pub slot_count: i32,
    pub status: String, // 'running' | 'awaiting_review' | 'resolved' | 'cancelled'
    pub winner_task_id: Option<String>,
    pub winner_insight: Option<String>,
    pub baseline_json: Option<String>,
    pub reviewer_notes: Option<String>,
    pub worktree_base_ref: Option<String>,
    pub created_at: String,
    pub resolved_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DevCompetitionSlot {
    pub id: String,
    pub competition_id: String,
    pub task_id: String,
    pub strategy_label: String,
    pub strategy_prompt: Option<String>,
    pub worktree_name: String,
    pub branch_name: Option<String>,
    pub slot_index: i32,
    pub disqualified: bool,
    pub disqualify_reason: Option<String>,
    pub diff_hash: Option<String>,
    pub diff_stats_json: Option<String>,
    pub diff_analyzed_at: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DevStrategyStats {
    pub label: String,
    pub wins: i32,
    pub total: i32,
    pub disqualified_count: i32,
    pub win_rate: f64,
    pub last_win_at: Option<String>,
}

// ============================================================================
// Scan Agent Meta
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ScanAgentMeta {
    pub key: String,
    pub label: String,
    pub emoji: String,
    pub abbreviation: String,
    pub color: String,
    pub category_group: String,
    pub description: String,
    pub examples: String,
}

// ============================================================================
// Triage Rules
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TriageRule {
    pub id: String,
    pub project_id: Option<String>,
    pub name: String,
    pub conditions: String,
    pub action: String,
    pub enabled: bool,
    pub times_fired: i32,
    pub created_at: String,
}

// ============================================================================
// Dev Pipelines (Idea-to-Execution)
// ============================================================================

/// Pipeline stages: triaged -> task_created -> executing -> verifying -> completed | failed
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DevPipeline {
    pub id: String,
    pub project_id: String,
    pub idea_id: String,
    pub task_id: Option<String>,
    pub stage: String,
    pub auto_execute: bool,
    pub verify_after: bool,
    pub verification_scan_id: Option<String>,
    pub error: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

// ============================================================================
// Cross-Project Relationships (Codebases connector)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CrossProjectRelation {
    pub id: String,
    pub source_project_id: String,
    pub target_project_id: String,
    pub relation_type: String, // "shared_dependency" | "api_consumer" | "shared_types" | "monorepo_sibling"
    pub details: Option<String>, // JSON: extra data about the relation
    pub created_at: String,
    pub updated_at: String,
}

/// Summary returned by the portfolio health tool.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PortfolioHealthSummary {
    pub total_projects: i32,
    pub active_projects: i32,
    pub total_ideas: i32,
    pub pending_ideas: i32,
    pub total_tasks: i32,
    pub running_tasks: i32,
    pub avg_health_score: Option<f64>,
    pub projects: Vec<ProjectHealthEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ProjectHealthEntry {
    pub project_id: String,
    pub project_name: String,
    pub status: String,
    pub tech_stack: Option<String>,
    pub context_count: i32,
    pub idea_count: i32,
    pub task_count: i32,
    pub latest_health_score: Option<i32>,
    pub open_risk_count: i32,
}

/// Entry in the tech radar aggregation.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TechRadarEntry {
    pub technology: String,
    pub category: String, // "language" | "framework" | "database" | "tool" | "library"
    pub project_count: i32,
    pub project_names: Vec<String>,
    pub status: String, // "adopt" | "trial" | "assess" | "hold"
}

/// Entry in the risk matrix aggregation.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct RiskMatrixEntry {
    pub project_id: String,
    pub project_name: String,
    pub risk_category: String, // "dependency_drift" | "stale_project" | "no_tests" | "security" | "single_maintainer" | "tech_debt"
    pub severity: String,      // "low" | "medium" | "high" | "critical"
    pub description: String,
    pub affected_contexts: Vec<String>,
}

/// Result from running tests on a project.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TestRunResult {
    pub project_id: String,
    pub success: bool,
    pub total_tests: i32,
    pub passed: i32,
    pub failed: i32,
    pub skipped: i32,
    pub duration_ms: i64,
    pub output: String,
    pub error: Option<String>,
}

/// Result from a git operation.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct GitOperationResult {
    pub success: bool,
    pub message: String,
    pub branch_name: Option<String>,
    pub commit_hash: Option<String>,
    pub files_changed: Option<i32>,
}

// ============================================================================
// Context Health Snapshots
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ContextHealthSnapshot {
    pub id: String,
    pub project_id: String,
    pub group_id: Option<String>,
    pub group_name: String,
    pub overall_score: i32,
    pub security_score: Option<i32>,
    pub quality_score: Option<i32>,
    pub coverage_score: Option<i32>,
    pub debt_score: Option<i32>,
    pub issues_found: i32,
    pub issues_json: Option<String>,
    pub recommendations: Option<String>,
    pub scanned_at: String,
}

// ============================================================================
// Passport-wall summary (Factory L1)
// ============================================================================

/// Everything the L1 passport wall needs to draw ONE project cover: the
/// statband's volume numbers and the minimized roadmap strip.
///
/// The wall used to fan three per-project IPC calls out (`list_contexts` +
/// `list_kpis` + `list_milestones`) — 3N round trips to draw N covers. This is
/// the batched answer for the whole wall: `project_wall_summaries` reads one
/// grouped query per table with a single `WHERE project_id IN (…)`.
///
/// `active_kpis` carries the RAW active KPI rows rather than a precomputed
/// pass/total pair on purpose. "Passed" is `kpiTrack()` in
/// `sub_kpis/kpiMath.ts`, which is time-dependent (linear pace against
/// `target_date` evaluated at `Date.now()`) and already has one Rust twin in
/// `engine/kpi_derivation.rs`. A third implementation here would be a third
/// thing to keep in sync, and a server-computed verdict would additionally go
/// stale in the client's cache. `milestones` likewise carries full
/// `DevMilestone` rows so the roadmap builder keeps its existing input shape.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DevProjectWallSummary {
    pub project_id: String,
    /// Rows in `dev_contexts` for this project — the statband's volume stat.
    pub contexts_count: i32,
    /// KPI rows with `status = 'active'`; the client folds these through
    /// `kpiTrack()` for the pass/total pair.
    pub active_kpis: Vec<DevKpi>,
    /// Full milestone rows, ordered exactly as `list_milestones_by_project`
    /// returns them (order_index, created_at).
    pub milestones: Vec<DevMilestone>,
}

// ============================================================================
// Notepad (dev_notes — the scratch-requirement pad and its dispatch handshake)
// ============================================================================

/// The eight states a note can be in.
///
/// This is a **lifecycle**, not a label set: the pad, the dispatcher and the
/// `/note-task` run's `result.json` all key off it, and the legal moves between
/// states are the contract that keeps those three honest. The transition table
/// lives in [`NoteStatus::can_transition_to`] and is enforced server-side by
/// `notepad_set_status` — never in the UI, which is free to grey out a button
/// but is never the thing that makes an illegal move impossible.
///
/// The first five are the PAD's lane (a scratch requirement handed to a run and
/// reported back on). The last three are the SHIP lane: once a note is the
/// living brief of a milestone it tracks the milestone's own life, and the two
/// lanes meet at `scoped` — the state a note enters the moment it acquires a
/// `milestone_id`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum NoteStatus {
    /// Being written. The ONLY status in which `body_md` and `project_id` are
    /// editable — once a note is published, a CLI session may already be
    /// reading `note.md` off disk, and editing the requirement underneath a
    /// running agent is how a run silently answers a question nobody asked.
    Draft,
    /// Handed over: `note.md` is on disk and a dispatch is (or is about to be)
    /// in flight.
    Published,
    /// A run has claimed it — the sweeper saw `started.json`.
    InProgress,
    /// A run reported back. `result_json` holds the report.
    Completed,
    /// Off the pad. Does not count against the note cap, and can be restored to
    /// `Draft` (unlinked) or `Scoped` (linked) when there is room.
    Archived,
    /// The note IS a milestone's brief. `milestone_id` is set, and editing the
    /// body is allowed again — the brief of an uncut milestone is still being
    /// written, and there is no run reading it off disk.
    Scoped,
    /// The milestone was cut (`cut_at` stamped). The brief still takes edits —
    /// a cut freezes scope, not the prose describing it.
    Cut,
    /// The milestone shipped. Terminal except for archiving.
    Shipped,
}

impl NoteStatus {
    /// The wire/column token. Must stay identical to the `serde` rename and to
    /// the `dev_notes.status` CHECK.
    pub fn as_str(&self) -> &'static str {
        match self {
            NoteStatus::Draft => "draft",
            NoteStatus::Published => "published",
            NoteStatus::InProgress => "in_progress",
            NoteStatus::Completed => "completed",
            NoteStatus::Archived => "archived",
            NoteStatus::Scoped => "scoped",
            NoteStatus::Cut => "cut",
            NoteStatus::Shipped => "shipped",
        }
    }

    /// Parse a column/wire token. `None` for anything outside the vocabulary —
    /// callers decide whether that is a validation error or a skipped row.
    pub fn parse(raw: &str) -> Option<NoteStatus> {
        match raw {
            "draft" => Some(NoteStatus::Draft),
            "published" => Some(NoteStatus::Published),
            "in_progress" => Some(NoteStatus::InProgress),
            "completed" => Some(NoteStatus::Completed),
            "archived" => Some(NoteStatus::Archived),
            "scoped" => Some(NoteStatus::Scoped),
            "cut" => Some(NoteStatus::Cut),
            "shipped" => Some(NoteStatus::Shipped),
            _ => None,
        }
    }

    /// The transition table, verbatim from the notepad contract:
    ///
    /// | from | to |
    /// |---|---|
    /// | draft | published, scoped, archived |
    /// | published | in_progress, completed, scoped, archived |
    /// | in_progress | completed, scoped, archived |
    /// | completed | archived |
    /// | scoped | cut, draft (unlink), archived |
    /// | cut | shipped, archived |
    /// | shipped | archived |
    /// | archived | draft (restore, unlinked), scoped (restore, linked) |
    ///
    /// The ship lane is entered from any live pad state — a note can become a
    /// milestone's brief before it was ever dispatched, while a run is out, or
    /// after one came back. It is NOT entered from `completed`: a note that
    /// already reported a finished run is history, and re-opening it as a live
    /// brief would make `completed_at` describe something that is still moving.
    ///
    /// `scoped → draft` is the unlink, and it is the one exit from the ship
    /// lane. There is deliberately none from `cut` or `shipped`: a milestone
    /// that has been cut has scope hanging off this brief, and unlinking it
    /// would leave that scope describing nothing.
    ///
    /// A no-op move (`x` to the same `x`) is NOT legal: `notepad_set_status`
    /// stamps timestamps, and re-stamping `started_at` on a second
    /// `in_progress` write would quietly rewrite when the run began.
    pub fn can_transition_to(&self, next: NoteStatus) -> bool {
        use NoteStatus::*;
        matches!(
            (self, next),
            (Draft, Published)
                | (Draft, Archived)
                | (Published, InProgress)
                | (Published, Completed)
                | (Published, Archived)
                | (InProgress, Completed)
                | (InProgress, Archived)
                | (Completed, Archived)
                | (Archived, Draft)
                // ── the ship lane ──────────────────────────────────────────
                | (Draft, Scoped)
                | (Published, Scoped)
                | (InProgress, Scoped)
                | (Scoped, Cut)
                | (Cut, Shipped)
                | (Scoped, Draft)
                | (Scoped, Archived)
                | (Cut, Archived)
                | (Shipped, Archived)
                | (Archived, Scoped)
        )
    }
}

/// One note. Mirrors `dev_notes` column-for-column.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DevNote {
    pub id: String,
    /// The repo this note is about. NULL until the operator picks one — and
    /// NULL again if that project is deleted (`ON DELETE SET NULL`), because
    /// the thinking outlives the row it pointed at.
    pub project_id: Option<String>,
    /// The milestone this note is the living brief of. NULL for a brainstorm
    /// note; set by promotion / linking (`ON DELETE SET NULL`).
    pub milestone_id: Option<String>,
    pub title: String,
    pub body_md: String,
    pub status: NoteStatus,
    pub order_index: i32,
    /// 'fleet' | 'athena_goals' — where this note was handed to. NULL until a
    /// dispatch happens.
    pub dispatch_target: Option<String>,
    /// `note:<id>` — the address the dispatcher stamps on the session name so
    /// the sweeper can find the run that belongs to this note.
    pub dispatch_key: Option<String>,
    pub fleet_session_id: Option<String>,
    /// Reserved for a future per-note agent binding; always NULL in v1.
    pub agent_id: Option<String>,
    /// JSON text. Fleet runs store the `result.json` body
    /// (`{schema_version,status,summary,artifacts[]}`); an Athena goals
    /// dispatch stores `{goal_ids: [...]}`.
    pub result_json: Option<String>,
    pub published_at: Option<String>,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub archived_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// One run a note went through. Mirrors `dev_note_runs` column-for-column;
/// append-only history that outlives the surfaces that started it.
///
/// `kind` and `status` are plain `String` rather than enums on purpose: the
/// vocabulary is enforced by the column CHECK and by the one command that
/// writes a start, and every consumer is a display surface. An enum here would
/// make an unknown token a mapping FAILURE for a history row, which is the one
/// place a strict read buys nothing.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DevNoteRun {
    pub id: String,
    pub note_id: String,
    /// 'note_task' | 'ship_milestone' | 'athena_goals'
    pub kind: String,
    /// 'running' | 'completed' | 'failed'
    pub status: String,
    pub dispatch_key: Option<String>,
    pub fleet_session_id: Option<String>,
    pub run_dir: Option<String>,
    /// JSON text — the run's report (`result.json` body, a
    /// `ShipMilestoneIngestSummary`, or `{goal_ids}`).
    pub summary_json: Option<String>,
    pub started_at: String,
    pub completed_at: Option<String>,
    pub created_at: String,
}

/// The desk's one-query view of a linked note's milestone: enough to draw a
/// progress bar and the cut/shipped chips without loading the plan.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct NotePlanSummary {
    pub note_id: String,
    pub milestone_id: String,
    /// 'planned' | 'active' | 'shipped'
    pub milestone_status: String,
    pub goal: Option<String>,
    pub target_date: Option<String>,
    pub cut_at: Option<String>,
    pub shipped_at: Option<String>,
    pub goals_total: u32,
    pub goals_done: u32,
}

/// What `notepad_promote_note` hands back: the note (now linked) and the
/// milestone it is the brief of; `created` says whether the milestone was
/// minted from the note or was the project's already-open one.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct NotePromotion {
    pub note: DevNote,
    pub milestone: DevMilestone,
    pub created: bool,
}

/// What one sweeper pass did. Returned by `notepad_ingest_runs` so the pad can
/// tell the operator something happened without a full refetch.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct NotepadIngestReport {
    /// Notes flipped `published` to `in_progress` (a `started.json` appeared).
    pub started: u32,
    /// Notes flipped to `completed` by a `result.json` reporting success.
    pub completed: u32,
    /// Runs whose `result.json` reported `"failed"`. The note KEEPS its status
    /// and gains `result_json` — a failed run is a report, not a completion.
    pub failed: u32,
}

#[cfg(test)]
mod notepad_tests {
    use super::NoteStatus;

    const ALL: [NoteStatus; 8] = [
        NoteStatus::Draft,
        NoteStatus::Published,
        NoteStatus::InProgress,
        NoteStatus::Completed,
        NoteStatus::Archived,
        NoteStatus::Scoped,
        NoteStatus::Cut,
        NoteStatus::Shipped,
    ];

    #[test]
    fn as_str_and_parse_round_trip_every_variant() {
        for s in ALL {
            assert_eq!(NoteStatus::parse(s.as_str()), Some(s), "round trip {s:?}");
        }
        assert_eq!(NoteStatus::parse("published "), None);
        assert_eq!(NoteStatus::parse("inProgress"), None);
        assert_eq!(NoteStatus::parse(""), None);
    }

    /// The wire token IS the column token IS the serde rename. A drift here is
    /// a CHECK-constraint failure at runtime, not a compile error.
    #[test]
    fn serde_token_matches_as_str() {
        for s in ALL {
            let json = serde_json::to_string(&s).unwrap();
            assert_eq!(json, format!("\"{}\"", s.as_str()));
        }
    }

    /// The WHOLE 8x8 table, asserted cell by cell — the nineteen legal moves
    /// and the forty-five illegal ones, self-loops included.
    #[test]
    fn transition_table_is_exactly_the_contract() {
        use NoteStatus::*;
        let legal: [(NoteStatus, NoteStatus); 19] = [
            (Draft, Published),
            (Draft, Archived),
            (Published, InProgress),
            (Published, Completed),
            (Published, Archived),
            (InProgress, Completed),
            (InProgress, Archived),
            (Completed, Archived),
            (Archived, Draft),
            (Draft, Scoped),
            (Published, Scoped),
            (InProgress, Scoped),
            (Scoped, Cut),
            (Cut, Shipped),
            (Scoped, Draft),
            (Scoped, Archived),
            (Cut, Archived),
            (Shipped, Archived),
            (Archived, Scoped),
        ];
        let mut legal_seen = 0;
        for from in ALL {
            for to in ALL {
                let expected = legal.contains(&(from, to));
                assert_eq!(
                    from.can_transition_to(to),
                    expected,
                    "{from:?} to {to:?} should be {}",
                    if expected { "legal" } else { "illegal" }
                );
                if expected {
                    legal_seen += 1;
                }
            }
        }
        assert_eq!(
            legal_seen, 19,
            "the table must have exactly nineteen legal moves"
        );
    }

    /// Self-loops are illegal on purpose — see `can_transition_to`'s note on
    /// timestamp re-stamping.
    #[test]
    fn no_status_can_transition_to_itself() {
        for s in ALL {
            assert!(!s.can_transition_to(s), "{s:?} to itself must be refused");
        }
    }

    /// `archived` is the only sink: every other status can reach it, and it
    /// can reach nothing but the two restore targets.
    #[test]
    fn archived_is_the_only_sink() {
        for s in ALL {
            if s != NoteStatus::Archived {
                assert!(
                    s.can_transition_to(NoteStatus::Archived),
                    "{s:?} must be able to archive"
                );
            }
        }
        for s in ALL {
            assert_eq!(
                NoteStatus::Archived.can_transition_to(s),
                matches!(s, NoteStatus::Draft | NoteStatus::Scoped),
                "archived restores only to draft (unlinked) or scoped (linked); saw {s:?}"
            );
        }
    }

    /// `draft` has exactly two ways in — the archive restore and the UNLINK
    /// from `scoped`. Anything else reaching `draft` would be a note going
    /// backwards out of a lane it cannot leave.
    #[test]
    fn only_archived_and_scoped_reach_draft() {
        for s in ALL {
            assert_eq!(
                s.can_transition_to(NoteStatus::Draft),
                matches!(s, NoteStatus::Archived | NoteStatus::Scoped),
                "{s:?} must not reach draft"
            );
        }
    }

    /// The ship lane is entered from the live pad states and NEVER from
    /// `completed` — a note that already reported a finished run is history.
    #[test]
    fn the_ship_lane_is_entered_from_live_states_only() {
        use NoteStatus::*;
        for s in [Draft, Published, InProgress, Archived] {
            assert!(s.can_transition_to(Scoped), "{s:?} → scoped must be legal");
        }
        assert!(
            !Completed.can_transition_to(Scoped),
            "completed → scoped must be refused"
        );
        assert!(
            !Cut.can_transition_to(Scoped),
            "cut → scoped must be refused — a cut does not un-cut"
        );
        assert!(
            !Shipped.can_transition_to(Cut),
            "shipped → cut must be refused"
        );
    }
}
