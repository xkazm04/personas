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
    pub created_at: String,
    pub updated_at: String,
}

// ============================================================================
// Workspace Knowledge Center (docs/plans/workspace-knowledge-center.md)
// ============================================================================

/// A workspace: a named group of dev projects (the "org"). Container for the
/// cross-project knowledge/best-practice library. Grouping is via the nullable
/// `dev_projects.workspace_id` column (single workspace per project).
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
    pub created_at: String,
    pub updated_at: String,
}

/// A governed knowledge item (practice) in a workspace's library.
///
/// Lifecycle: `observed` (machine-harvested) → `proposed` (nominated) →
/// `adopted` | `rejected`, plus `deprecated` (with optional `superseded_by`).
/// Rejected rows are KEPT — extraction miners dedup against them (90-day
/// window on `dedup_key`) so a rejected idea is not re-proposed. Agents only
/// ever write `observed`/`proposed`; adoption is a human decision.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct WorkspaceKnowledge {
    pub id: String,
    pub workspace_id: String,
    /// 'pattern' | 'pitfall' | 'decision' | 'howto' | 'fact' (DB CHECK).
    pub kind: String,
    pub title: String,
    /// The distilled claim — the display/retrieval surface.
    pub statement: String,
    /// Evidence verbatim: code, config, before/after. Markdown.
    pub detail_md: Option<String>,
    /// Free-form slash-path taxonomy node ('ui/motion/reveals'), authored by
    /// harvest agents. The library derives its arbitrary-depth topic tree from
    /// this; None = uncategorized. Added 2026-07-24.
    pub topic: Option<String>,
    /// Altitude: 'macro' (system/architecture) | 'meso' (module/pattern) |
    /// 'micro' (lint-enforceable technique). Drives motivate-vs-avoid ranking.
    /// Added 2026-07-24.
    pub abstraction: Option<String>,
    /// Finding-type taxonomy (architecture | module-boundary | data-flow |
    /// extensibility | api-design | state-mgmt | error-strategy |
    /// concurrency-reliability | perf-strategy | testing-strategy |
    /// micro-technique). Orthogonal to `topic`.
    pub ftype: Option<String>,
    /// Scale-durability: 'durable' (worth being knowledge) | 'situational' |
    /// 'mechanical' (belongs in the linter, not the library).
    pub durability: Option<String>,
    /// Optional roll-up: id of the governing macro doctrine this is an instance
    /// of, nesting micro-cases under a doctrine.
    pub governing_id: Option<String>,
    /// Prevalence — how many raw sites/instances back this finding.
    pub evidence_count: Option<i64>,
    /// JSON `{ layers: [], languages: [], frameworks: [], conditions: [] }` —
    /// which member projects this practice can apply to. Opaque to the repo.
    pub applicability: Option<String>,
    /// 'observed' | 'proposed' | 'adopted' | 'deprecated' | 'rejected' (DB CHECK).
    pub status: String,
    /// Member project the item was harvested from. No FK by design —
    /// deleting a project leaves provenance readable as "(project removed)".
    pub origin_project_id: Option<String>,
    /// JSON `{ actor_kind: 'human'|'agent'|'miner', session_key?, scan_id?, model_ref? }`.
    pub provenance: Option<String>,
    /// Extractor confidence 0..1; None for human-authored items.
    pub confidence: Option<f64>,
    /// Miner idempotency key; checked against rejected rows within 90 days.
    pub dedup_key: Option<String>,
    /// Forward pointer set when this item is deprecated in favour of another.
    pub superseded_by: Option<String>,
    pub valid_from: Option<String>,
    pub valid_to: Option<String>,
    /// When the user adopted/rejected/deprecated the item.
    pub decided_at: Option<String>,
    /// Which harvest territory produced this practice
    /// (`group:execution-orchestration`, `repo-global`, …). NULL for
    /// hand-authored rows and for runs that predate scoping.
    pub harvest_scope: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// Per-project adoption state of an adopted practice — the scaling surface:
/// a project newly assigned to the workspace inherits every applicable
/// adopted practice as a `proposed` row (to-adopt queue).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct WorkspacePracticeAdoption {
    pub practice_id: String,
    pub project_id: String,
    /// 'na' | 'proposed' | 'to_process' | 'dispatched' | 'adopted' | 'diverged'
    /// (DB CHECK). `to_process` is the execution queue seeded when an
    /// ACTIONABLE practice (pitfall/pattern) is adopted.
    pub state: String,
    /// Dedup key of the adopt Fleet dispatch (`workspace:<practice>:<slug>`).
    pub fleet_key: Option<String>,
    pub note: Option<String>,
    pub last_verified_at: Option<String>,
    pub updated_at: String,
}

/// Per-scope harvest coverage for one member repo — the answer to "how much of
/// this codebase has the library actually read?".
///
/// Without this row a harvest run cannot tell where it has already been, so
/// every run re-reads the cheapest territory (root configs), finds it already
/// proposed via the dedup list, and returns less than the run before it. The
/// coverage table is what makes successive runs ADVANCE instead of decay, and
/// what lets the UI report an unread surface instead of implying completeness.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceHarvestCoverage {
    pub project_id: String,
    /// Stable scope slug (`group:execution-orchestration`, `repo-global`, …).
    pub scope_id: String,
    pub scope_label: String,
    /// 'group' | 'directory' | 'global'.
    pub kind: String,
    /// Files in the territory — the denominator behind a coverage claim.
    pub file_count: i64,
    /// NULL means never harvested. That is the point of the row existing.
    pub last_harvested_at: Option<String>,
    pub last_run_dir: Option<String>,
    /// Items the most recent run produced for this scope.
    pub items_found: i64,
    pub run_count: i64,
    /// How much of the territory the last run actually READ, self-reported by
    /// the harvest session. "Visited" and "covered" are different claims and
    /// the ledger must not conflate them: a scope read at 11% is a scope that
    /// still owes a pass, even though `last_harvested_at` is set.
    pub files_read: Option<i64>,
    pub files_total: Option<i64>,
    pub estimated_pct: Option<i64>,
    /// JSON array of paths the last run named as unread. Fed back into the
    /// next dispatch for this scope, which is what turns a re-run into a
    /// genuine second pass instead of a re-read of the same ground.
    pub unread_pockets: Option<String>,
    pub coverage_note: Option<String>,
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
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DevMilestone {
    pub id: String,
    pub project_id: String,
    pub name: String,
    /// The one-sentence core-value statement the cut converges on.
    pub goal: Option<String>,
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
///        | `undispatched_idea` | `stuck_task` | `stale_queued_task`.
///
/// The first four are goal signals and keep their original `rank` values; the
/// three record-widening kinds are APPENDED at ranks 4-6 rather than
/// interleaved, so the pre-existing ordering contract is untouched. Within a
/// rank the queue sorts by age, worst first.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct AttentionItem {
    pub kind: String,
    /// Which record type this row is about: `goal` | `idea` | `task`.
    pub entity_kind: String,
    /// Id of the record that needs attention — a goal, idea, or task id.
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

/// What produced a `DevMemory`. The loop has exactly three learning moments,
/// and each one is a source here:
///   `idea_decision` — a human or the Strategist accepted/rejected a backlog
///                     idea. Rejections become CONSTRAINTS.
///   `task_outcome`  — a dev-runner task reached a terminal state. What shipped,
///                     or what failed and why.
///   `scan_funnel`   — a scan-and-decide run's funnel summary (reserved for the
///                     Phase 4 flow; see docs/plans/backlog-memory-loop.md).
pub const DEV_MEMORY_SOURCES: &[&str] = &["idea_decision", "task_outcome", "scan_funnel"];

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
/// the Workspace Knowledge Center materializing an adopted practice as work each
/// member repo owes (`docs/plans/workspace-knowledge-center.md` + plan 1C). It
/// is deliberately EXCLUDED from cross-project mining — see
/// `dev_workspaces::mine_shared_findings` — because a practice that fans out to
/// N repos would otherwise be re-mined as a "shared finding" and re-proposed as
/// the very practice it came from.
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
