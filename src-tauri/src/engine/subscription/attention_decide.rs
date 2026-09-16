//! The **decision lane** — what an App Master does on every wake.
//!
//! The other four attention lanes answer *"is there a thing to do"* and pick it
//! by a fixed rule. `advance` in particular rotates: least-recently-advanced
//! charter, one dispatch, every tick, forever. That is a schedule, not a
//! judgment — it cannot notice that three of a project's five charters are
//! irrelevant this week, cannot use two free slots when it has them, and
//! cannot remember between wakes what it already covered.
//!
//! This module is the judgment. For a persona holding at least one
//! **project-bound** charter (the App Master shape), the loop gathers what it
//! owns and what the project looks like right now, asks the persona's OWN model
//! one bounded question — *which of my responsibilities moves this project this
//! wake, and why* — and dispatches the answer, up to the persona's free
//! concurrency.
//!
//! Everything here except [`gather`] is a **pure function** over owned data, so
//! the contract (prompt shape, JSON parse, capacity cap, priority order) is
//! testable without a database, a model, or a clock. The impure halves live in
//! [`super::attention`]: `gather` reads, and the executor calls and dispatches.
//!
//! Behind `autonomous_attention_loop` like the rest of the loop — this module
//! runs only from a tick that already passed that gate.

use personas_core::models::ResponsibilityPacing;

/// Hard bound on one dispatch reason echoed back into the ledger.
const MAX_REASON_CHARS: usize = 400;
/// Hard bound on one dispatch brief appended to the charter's task text.
const MAX_BRIEF_CHARS: usize = 1200;
/// Hard bound on the coverage note carried to the next wake. Stated in the
/// prompt AND enforced here — a model that ignores the limit must not be able
/// to grow a charter's `spec` without bound, one wake at a time.
pub(crate) const MAX_NOTE_CHARS: usize = 300;
/// How many undispatched ideas are named in the prompt. The COUNT is always
/// stated; the titles are a sample, and the prompt says so.
pub(crate) const MAX_NAMED_IDEAS: usize = 10;

/// How many asks ONE wake may put to the operator.
///
/// A wake that raises four questions has not decided anything; it has forwarded
/// its whole situation. Three is already generous for a loop that wakes every
/// few hours, and the cap is what stops a blocked persona from filling the
/// review queue one wake at a time.
pub(crate) const MAX_ASKS: usize = 3;
/// Hard bound on one ask's title — it becomes a manual review's title.
pub(crate) const MAX_ASK_TITLE_CHARS: usize = 120;
/// Hard bound on one ask's `why` — it becomes the review's description.
pub(crate) const MAX_ASK_WHY_CHARS: usize = 400;
/// How many backlog ideas one ask may name.
pub(crate) const MAX_ASK_IDEA_IDS: usize = 10;
/// How many options one ask may offer, and how long each may be. Not stated in
/// the brief that asked for this field, but an unbounded option list is an
/// unbounded `suggested_actions` blob, and every other string on this wire is
/// bounded.
pub(crate) const MAX_ASK_OPTIONS: usize = 6;
pub(crate) const MAX_ASK_OPTION_CHARS: usize = 120;

/// How many roles ONE wake may ask kp for.
///
/// One. A hire is not a task: it spends real money at kp, it mints a persona
/// that counts against the app-wide active cap, and the need that justifies it
/// has to be argued in prose. A wake that names two roles has not decided which
/// one is missing — and unlike a dispatch, a hire the persona gets wrong cannot
/// be un-run by waiting for the next wake.
pub(crate) const MAX_HIRES: usize = 1;
/// Hard bound on one hire's `need` — the whole brief kp composes a role from.
/// The same ceiling as [`MAX_BRIEF_CHARS`]: a need is a brief addressed to
/// another product rather than to a worker, and it crosses an HTTP boundary
/// into a text field kp bounds again on its own side.
pub(crate) const MAX_HIRE_NEED_CHARS: usize = 1200;

// ── The authority verbs (Grand Simulation G13) ────────────────────────────
//
// Three verbs that exist for ONE shape of persona: the holder of a charter
// carrying `spec.authority`. The Architect's manifest Mandate has always read
// "You create projects, adopt App Masters, set goals" and until now the
// decision plan had no verb for any of the three — the mandate named powers
// with no door, so the only way the Architect could act on them was to ask the
// operator to do it by hand.
//
// Licensed by [`may_command`], parsed here and executed by
// `attention::run_plan_projects` / `run_plan_adoptions` / `run_plan_goals`,
// which follow `run_plan_hires` exactly: after the dispatches, every outcome
// recorded as data, never an early return, and never a failed wake.

/// How many repositories ONE wake may create.
///
/// Three, not one: unlike a hire, a project costs nothing outside this machine
/// and a portfolio is designed as a set — an Architect that has decided on a
/// ledger service, a payments service and a gateway should not need three wakes
/// to say so. It is still a cap, because a plan naming ten has stopped designing
/// and started enumerating.
pub(crate) const MAX_CREATE_PROJECTS: usize = 3;
/// How many App Masters ONE wake may adopt. Same reasoning, and the second
/// ceiling — the app-wide active-persona cap — is enforced at the executor,
/// which is where the live count is.
pub(crate) const MAX_ADOPT_APP_MASTERS: usize = 3;
/// How many goals ONE wake may set. Higher than the other two because a goal is
/// a row, not a repository or a persona: the cost of a wrong one is an edit.
pub(crate) const MAX_SET_GOALS: usize = 5;

/// Hard bound on a new project's name. It becomes ONE directory component; the
/// scaffold door validates the characters and this bounds the length before the
/// path is built.
pub(crate) const MAX_PROJECT_NAME_CHARS: usize = 80;
/// Hard bound on a new project's description — it lands in the README and the
/// `dev_projects` row.
pub(crate) const MAX_PROJECT_DESCRIPTION_CHARS: usize = 600;
/// Hard bound on a declared tech stack.
pub(crate) const MAX_TECH_STACK_CHARS: usize = 120;
/// Hard bound on a project reference (an id or a name) in any of the three
/// verbs. Long enough for a uuid and a generous display name.
pub(crate) const MAX_PROJECT_REF_CHARS: usize = 120;
/// Hard bound on one recipe slug named in an adoption.
pub(crate) const MAX_RECIPE_SLUG_CHARS: usize = 80;
/// How many recipes ONE adoption may name. The App Master door accepts a list
/// and suspends what a later call drops; this bounds the list a model may write
/// in one go.
pub(crate) const MAX_ADOPTION_RECIPES: usize = 10;
/// Hard bound on a goal's title — it is the row's display text.
pub(crate) const MAX_GOAL_TITLE_CHARS: usize = 160;
/// Hard bound on a goal's description.
pub(crate) const MAX_GOAL_DESCRIPTION_CHARS: usize = 600;
/// A goal reference in an amendment: a uuid is 36 characters; anything much
/// longer is a title pasted into the wrong field.
pub(crate) const MAX_GOAL_ID_CHARS: usize = 64;
pub(crate) const MAX_GOAL_STATUS_CHARS: usize = 32;

/// The model every App Master this loop adopts runs on.
///
/// Fixed here rather than left to the plan: the model is a cost and reliability
/// decision the operator owns, and a decision lane that could name its
/// subordinates' model could spend the operator's subscription on a choice
/// nobody reviewed.
///
/// The TIER, not a dated id. `resolve_model_id` in the adoption door accepts
/// either, and a literal `claude-opus-<n>` here would be a vendor-scheduled
/// fact spelled at a call site — the `bare-model-id-literal` census rule's
/// whole subject, and the reason the retired `*-20250514` ids outlived their
/// retirement in the failover ladder. Naming the tier lets the one door that
/// owns model ids decide which opus that is today.
pub(crate) const ADOPTED_APP_MASTER_MODEL: &str = personas_core::model_ids::ALIAS_OPUS;

/// Does this roster license the three authority verbs?
///
/// One door, not three: `spec.authority` is the operator's statement that this
/// persona directs the organisation, and creating a project, giving it an owner
/// and setting its goals are the same act at three grains. Splitting them into
/// separate grants would mean an Architect could create a project it may not
/// staff.
///
/// Deliberately NARROWER than [`may_hire`], which `spec.canHire` and the
/// `workforce-planning` provenance also open: those two say "this persona may
/// ask kp for a role", which is a request to another product. These verbs write
/// this machine's own portfolio, and only the authority grant licenses them.
pub(crate) fn may_command(charters: &[DecisionCharter]) -> bool {
    charters.iter().any(|c| c.authority)
}

/// The recipe a charter is adopted from when hiring IS its job.
///
/// A charter minted from this recipe may use the `hires` verb without the
/// operator setting `spec.canHire` by hand — the provenance is the permission,
/// the same way [`ACCEPTED_IDEA_DELIVERY_SLUG`] is what licenses a dispatch to
/// mint a task row.
pub(crate) const WORKFORCE_PLANNING_SLUG: &str = "workforce-planning";
// ── The channel (Grand Simulation G3 / G11) ───────────────────────────────

/// How many channel lines one wake is shown.
pub(crate) const MAX_CHANNEL_LINES: i64 = 10;
/// Hard bound on one rendered channel body. Long enough for a real directive,
/// short enough that ten of them cannot crowd out the charters.
pub(crate) const MAX_CHANNEL_BODY_CHARS: usize = 400;

/// How many messages ONE wake may post into its channel.
///
/// Same reasoning as [`MAX_ASKS`]: a wake that writes five messages has not
/// decided anything, it has held a meeting. Three is enough to answer the
/// authority that spoke, ask one sibling, and tell the team one thing.
pub(crate) const MAX_SAY: usize = 3;
/// Hard bound on one posted message.
pub(crate) const MAX_SAY_BODY_CHARS: usize = 600;
/// `Say::to` for "the whole team", as opposed to a persona id.
pub(crate) const SAY_TO_TEAM: &str = "team";

/// The three authorities a channel message may carry. Mirrors
/// `personas_db::repos::resources::team_channel::AUTHORITIES` — the repo
/// validates the same vocabulary at its own door, and this module never
/// produces a word that one would refuse.
pub(crate) const AUTHORITY_DIRECTIVE: &str = "directive";
pub(crate) const AUTHORITY_REQUEST: &str = "request";
pub(crate) const AUTHORITY_NOTE: &str = "note";

/// The operator is asked to accept (or reject) named backlog items.
pub(crate) const ASK_ACCEPT_IDEAS: &str = "accept_ideas";
/// The operator is asked to choose between options only they can choose between.
pub(crate) const ASK_DECISION: &str = "decision";
/// The operator is asked to remove an obstacle (access, a credential, a gate).
pub(crate) const ASK_UNBLOCK: &str = "unblock";

/// `context_data.source` on every review an ask mints.
///
/// The Director stamps `"director"` here and `manual_reviews::update_status`
/// branches on it, so an ask needs its own marker rather than borrowing that
/// one: these rows must reach the operator's queue without being treated as
/// coaching to synthesize into a memory.
pub(crate) const ASK_SOURCE: &str = "app_master_ask";

/// The three actions an `accept_ideas` ask always offers. The resolve path keys
/// on these exact strings, so they are a contract, not copy.
pub(crate) const ASK_ACCEPT_ACTION: &str = "Accept the listed ideas";
pub(crate) const ASK_REJECT_ACTION: &str = "Reject them";
pub(crate) const ASK_LATER_ACTION: &str = "Decide later";

/// Floor on the sleep a plan may choose for itself, in minutes.
///
/// A persona that asks to wake in one minute is not pacing itself, it is
/// spinning: every wake costs a model call, and the work it dispatched cannot
/// have finished. The bound is a CLAMP rather than a rejection — a plan whose
/// only fault is an over-eager number is still a plan, and throwing away its
/// dispatch list over its sleep would be a worse answer than pacing it.
pub(crate) const MIN_NEXT_WAKE_MINUTES: u32 = 10;
/// Ceiling on the same choice. Four hours is already long enough that the
/// operator would rather switch the persona off than wait; beyond it the
/// persona has effectively resigned without saying so.
pub(crate) const MAX_NEXT_WAKE_MINUTES: u32 = 240;

// ── Inputs ────────────────────────────────────────────────────────────────

/// How far the charter's LAST dispatch actually got.
///
/// The ledger row for a dispatch closes at SPAWN, with verdict `dispatched` —
/// which is a statement about starting, not about finishing. Cycle 1 measured
/// what that costs: at 01:33 UTC CandiDate deferred its KPI charter as "still
/// in flight" when the fleet session had reported `FLEET:DONE` twenty-five
/// minutes earlier. The ledger was not wrong, it was just silent about the
/// half the decision needed. This carries the worker's own end state back.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct LastDispatch {
    /// When the dispatch was opened (the ledger row's `started_at`).
    pub at: String,
    /// `fleet` (a headless session in an authoring worktree) or `execution`.
    pub worker: String,
    /// [`DISPATCH_RUNNING`] | [`DISPATCH_FINISHED`] | [`DISPATCH_FAILED`] |
    /// [`DISPATCH_UNKNOWN`]. `unknown` is a real answer — the row may have been
    /// pruned — and must never be read as "still running".
    pub state: String,
    /// What the worker declared, when it declared anything. Bounded.
    pub summary: Option<String>,
}

/// The worker has not reported an end yet.
pub(crate) const DISPATCH_RUNNING: &str = "running";
/// The worker declared it was done.
pub(crate) const DISPATCH_FINISHED: &str = "finished";
/// The worker stopped without declaring done.
pub(crate) const DISPATCH_FAILED: &str = "failed";
/// The worker's row could not be found — pruned, or never persisted.
pub(crate) const DISPATCH_UNKNOWN: &str = "unknown";

/// Hard bound on a last-dispatch summary carried into the prompt.
pub(crate) const MAX_DISPATCH_SUMMARY_CHARS: usize = 200;

/// One charter as the decision sees it — flattened out of
/// `PersonaResponsibility` + the ledger so the prompt renderer and the parser
/// share one shape and neither needs a database.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct DecisionCharter {
    pub id: String,
    pub title: String,
    /// 1 (highest) .. 5. `None` means the operator declared no order and the
    /// persona should use its judgment — NOT "middling".
    pub priority: Option<u8>,
    pub recipe_slug: Option<String>,
    /// The recipe description's `need` — why the charter exists.
    pub need: Option<String>,
    /// The recipe description's `core_action` — the judgment at its centre.
    pub core_action: Option<String>,
    pub interval_minutes: Option<i64>,
    pub max_runs_per_day: Option<i64>,
    pub quiet_hours: Option<String>,
    pub pacing: Option<ResponsibilityPacing>,
    /// Newest non-refused ledger `started_at` for this charter, any lane.
    pub last_started_at: Option<String>,
    /// The verdict that row closed with (`dispatched` / `failed` / …).
    pub last_verdict: Option<String>,
    /// Where the last DECIDED dispatch of this charter actually got to.
    /// `None` = it has never been dispatched by the decision lane.
    pub last_dispatch: Option<LastDispatch>,
    /// This charter's runs author code in a real repository, so a dispatch
    /// must go to an isolated worktree rather than the operator's checkout.
    pub writes_code: bool,
    /// The charter's autonomy rung (`persona_responsibilities.scope_rung`) —
    /// `0` read, `1` retry, `2` open branch/PR
    /// (`personas_engine::app_master::RUNG_*`).
    ///
    /// Carried here for the DISPATCHER, not for the prompt: the worktree task
    /// text a code charter is seeded with states what the worker may ship, and
    /// until 2026-09-07 it stated the Overnight engine's never-ship rule at
    /// every rung — so a rung-2 App Master was told not to open the pull
    /// request its own mandate permits. Not rendered into the decision prompt:
    /// the mandate is already in the persona's Core sections, and repeating it
    /// as a per-charter line would invite the model to reason about its own
    /// ceiling.
    pub scope_rung: u8,
    /// The model a dispatch of THIS charter must run on, resolved through the
    /// same chain the execution path walks (`spec.modelOverride` → the
    /// persona's `model_profile` → the capability default). Never empty.
    ///
    /// Carried per charter rather than taken from [`DecisionContext::model`]
    /// because that one is the roster-wide answer for the DECISION call, and
    /// the fleet lane has no `execute_persona_inner` to resolve it later: it
    /// spawns a CLI, and a CLI with no `--model` rides the operator's account
    /// default. Measured in cycles 2-3 (2026-09-07): every App Master worker
    /// ran on the account default instead of its charter's Opus, and three of
    /// them burned the operator's own subscription to a limit.
    ///
    /// Not rendered into the prompt — it is an instruction to the dispatcher,
    /// not a fact the decision reasons about.
    pub dispatch_model: String,
    /// `claude` or `codex` — which CLI a code dispatch of this charter is
    /// spawned on (G48). The prompt names the codex lane so the owner writes a
    /// scope for it rather than a brief; the dispatcher routes on it.
    pub worker_engine: String,
    /// The project this charter is bound to, when it is bound to one.
    pub project_id: Option<String>,
    /// May a wake holding this charter ask kp for a new role?
    ///
    /// `spec.canHire == true`, or the charter was adopted from
    /// [`WORKFORCE_PLANNING_SLUG`]. Read by [`may_hire`] over the whole roster,
    /// not per charter: hiring is a property of the PERSONA's mandate, and the
    /// need a hire names is about a responsibility that has no holder — which
    /// by definition is not one of the charters in front of it.
    pub can_hire: bool,
    /// `spec.authority` — this charter directs a team (the Architect's shape).
    ///
    /// Carried here so [`may_hire`] can read it: the persona that designs the
    /// organisation is the one that may staff it, and requiring the operator to
    /// ALSO tick `canHire` on an authority charter would be a second switch for
    /// a decision already made once.
    pub authority: bool,
}

/// Does this roster license the `hires` verb?
///
/// The permission is deliberately a roster-level OR rather than a per-item gate
/// on the hire itself: a hire's `need` describes work NOBODY holds, so there is
/// no charter for it to name and nothing to attach the permission to. One
/// hiring charter is what makes the persona a hiring persona.
///
/// Three doors, any one of which grants it:
/// 1. `spec.canHire` — the operator ticked it on this charter;
/// 2. the `workforce-planning` provenance — hiring IS the charter's job;
/// 3. `spec.authority` — the Architect. A persona trusted to direct a team is
///    trusted to say the team is short a role; splitting those into two
///    switches would mean an Architect could design an org it may not staff.
///
/// This is the LICENCE only. Whether a licensed hire actually goes out is a
/// second question the executor asks — see the active-persona cap in
/// `engine::kp_hire_request`.
pub(crate) fn may_hire(charters: &[DecisionCharter]) -> bool {
    charters.iter().any(|c| {
        c.can_hire || c.authority || c.recipe_slug.as_deref() == Some(WORKFORCE_PLANNING_SLUG)
    })
}

/// How many in-flight tasks are named in the prompt.
pub(crate) const MAX_NAMED_IN_FLIGHT: usize = 10;

/// One `running`/`queued` task the project already has under way.
///
/// The undispatched-idea sensor goes quiet the moment a task row exists, which
/// tells the decision that something WAS dispatched but nothing about whether
/// it is still going. Without this the same charter looks equally dispatchable
/// on the next wake, and the loop's own worker becomes invisible to it.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct InFlightTask {
    /// The backlog idea this task was promoted from, when it was promoted from
    /// one. `None` for a task somebody created directly.
    pub idea_id: Option<String>,
    pub title: String,
    /// When the run actually started; `None` for a task still `queued`.
    pub started_at: Option<String>,
}

/// What one of the persona's projects looks like right now — the facts a
/// decision needs that the charter list cannot supply.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct ProjectSnapshot {
    pub project_id: String,
    pub project_name: Option<String>,
    /// Accepted ideas with no `dev_tasks` row — decisions nobody acted on.
    pub undispatched_idea_count: usize,
    /// Up to [`MAX_NAMED_IDEAS`] of them, as `(id, title)`.
    pub undispatched_ideas: Vec<(String, String)>,
    /// Up to [`MAX_NAMED_IN_FLIGHT`] tasks already `running` or `queued`.
    pub in_flight_tasks: Vec<InFlightTask>,
    pub pending_idea_count: usize,
    /// How many of those pending ideas carry no `risk` score. The mechanical
    /// triage rule cannot see an unrated row, so this is the share of the
    /// backlog that can only ever move by a human reading it.
    pub unrated_pending_idea_count: usize,
    /// Ideas filed and tasks completed on this project in the last
    /// [`FLOW_WINDOW_HOURS`]. The stock above says how deep the backlog is;
    /// this says which way it is moving, which is the half an owner can act on.
    pub filed_recently: usize,
    pub delivered_recently: usize,
    /// Tasks that reached `failed` in the same window (G41, AC-FLOW-2). A
    /// project failing more tasks than it completes has a pipeline finding
    /// to make before any filing-versus-delivery ratio means anything.
    pub failed_recently: usize,
    /// The part of `failed_recently` that a sweep wrote, not a run: the worker
    /// was gone (an app restart mid tool call, a closed console, a reaped
    /// session) and its ideas are back in the backlog. Named separately so the
    /// prompt can say "these were not your briefs" instead of sending six App
    /// Masters to diagnose one platform event (2026-09-14: 49 of 87 in a day).
    pub swept_recently: usize,
    pub context_count: usize,
    /// Newest `dev_contexts.updated_at` — how fresh the context map is.
    pub context_newest_at: Option<String>,
    /// Contexts carrying zero ACTIVE KPI. `None` = not measured (say so in
    /// the prompt rather than printing a 0 nobody computed).
    pub kpi_coverage_gap: Option<usize>,
    /// The project's goals with the work attached to each (G41), up to
    /// [`MAX_PROJECT_GOALS`]. Empty = no goal is set on the project.
    pub goals: Vec<ProjectGoalLine>,
    /// `autopilot/*` branches carrying work that main does not have, up to
    /// [`MAX_UNMERGED_BRANCHES`] (733b83b5). Empty means either nothing is
    /// waiting or the repository could not be read — the prompt says
    /// "none waiting" only for a project whose branches WERE read, and the
    /// gatherer is what knows the difference.
    pub unmerged_branches: Vec<UnmergedBranch>,
}

/// One branch of the persona's own authored work that is waiting on a person.
///
/// The decision could not see these at all until 733b83b5: a rung-2 App Master
/// pushes a branch, the merge is the operator's, and nothing in the prompt said
/// so — so the same charter was re-dispatched, cutting `<charter>-N+1` beside
/// the `-N` still open. `ahead`/`behind` are the two numbers that say whether
/// the branch is landable or has drifted behind main.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct UnmergedBranch {
    pub branch: String,
    /// The branch it is measured against, named so the line cannot be read
    /// against the wrong trunk.
    pub main: String,
    pub ahead: usize,
    pub behind: usize,
    /// The tip's commit date, ISO-8601. `None` when git did not report one.
    pub tip_at: Option<String>,
    /// The charter whose dispatch cut it, when a ledger row names the branch.
    /// `None` for a branch the persona did not cut this rotation — still its
    /// own work, just older than the ledger window.
    pub charter_title: Option<String>,
}

/// How many waiting branches one project's block names. A project with more
/// has them counted, not listed — the same rule the idea and goal lists keep.
pub(crate) const MAX_UNMERGED_BRANCHES: usize = 10;

/// One goal of a project, with the work that names it (G41).
///
/// Measured 2026-09-10: 0 of 432 tasks in the Bank workspace carried a
/// `goal_id`, so every goal sat at 0–20 % for a reason no App Master could
/// see — nothing could reach it. The counts here are read from the rows that
/// name the goal, never typed by anyone.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct ProjectGoalLine {
    pub id: String,
    pub title: String,
    pub status: String,
    /// Ideas naming this goal, in any status.
    pub ideas: usize,
    /// Tasks naming this goal, in any status.
    pub tasks: usize,
    /// Of those, the tasks that reached `completed`.
    pub completed_tasks: usize,
}

/// How many of a project's goals the prompt names. A project with more has
/// them counted, not listed — the Architect's workspace view already caps
/// at [`MAX_WORKSPACE_GOALS`] for the same reason.
pub(crate) const MAX_PROJECT_GOALS: usize = 12;

// ── The workspace the Architect holds ──────────────────────────────────────
//
// Everything from here to `WorkspaceView` exists for ONE shape of persona: a
// holder of workspace-bound charters (Grand Simulation G1). A project-bound App
// Master never carries it, and `DecisionContext::workspace` stays `None` for
// every persona that has held a charter until now.

/// How many goals across the whole workspace are named in the prompt.
///
/// A portfolio of six projects with a dozen goals each would otherwise put a
/// hundred lines of backlog in front of a decision that has to fit beside the
/// charter roster and every project snapshot. The COUNT is always stated; the
/// list is a sample, and the prompt says which.
pub(crate) const MAX_WORKSPACE_GOALS: usize = 30;

/// What one project in the workspace looks like TO THE ARCHITECT — not the
/// same question [`ProjectSnapshot`] answers.
///
/// The Architect does not dispatch a project's backlog; it decides whether the
/// project has an owner, whether that owner is stuck, and whether it is waiting
/// on a person. So this carries the App Master's state, and the ideas/contexts/
/// KPI figures stay in the per-project snapshot beside it.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct WorkspaceProject {
    pub id: String,
    pub name: String,
    /// The project's App Master, when one has been adopted. `None` is the fact
    /// the Architect exists to notice: a project standing with no owner.
    pub app_master: Option<WorkspaceAppMaster>,
}

/// One project's App Master as the Architect sees it.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct WorkspaceAppMaster {
    pub persona_id: String,
    /// The newest coverage note its own decision lane wrote — the App Master's
    /// last word about where it stands. `None` when it has never decided.
    pub last_note: Option<String>,
    /// The sleep it chose for itself, in minutes.
    pub next_wake_minutes: Option<u32>,
    /// How many questions it has put to the operator that nobody has answered.
    pub open_asks: usize,
}

/// One goal anywhere in the workspace.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct WorkspaceGoal {
    /// The goal's id — printed so the plan's `goals[].id` can name it (G41).
    pub id: String,
    pub project_id: String,
    pub title: String,
    pub status: String,
    pub progress: i32,
    /// Work naming this goal (G41): tasks in any status, and of those the
    /// completed ones. Both zero = nothing has ever been attached.
    pub tasks: usize,
    pub completed_tasks: usize,
}

/// How many personas the machine is RUNNING right now, against the ceiling on
/// that.
///
/// The Architect plans a workforce, so the one number it cannot decide without
/// is how much of the machine is already busy (Grand Simulation gap G17). Until
/// 2026-09-08 this was a roster count and the prompt read as a headcount limit;
/// it is a concurrency figure now, and the roster is unbounded.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct ActivePersonas {
    /// Personas holding a queued or running execution right now, app-wide.
    pub running: usize,
    /// The ceiling those are counted against (`max_active_personas`).
    pub cap: usize,
}

/// Everything a WORKSPACE-bound decision is allowed to know beyond its own
/// charters: the portfolio, who owns each project, what the goals are doing,
/// and how many personas the machine is already running.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct WorkspaceView {
    pub id: String,
    pub name: String,
    pub projects: Vec<WorkspaceProject>,
    /// Up to [`MAX_WORKSPACE_GOALS`] goals across every project.
    pub goals: Vec<WorkspaceGoal>,
    /// How many goals there are in total, so a trimmed list never reads as the
    /// whole portfolio.
    pub goal_count: usize,
    pub active_personas: ActivePersonas,
}

/// The project a workspace-bound persona calls home — where its documents go.
///
/// `design_context.homeProjectId`, resolved to a row. Carried into the prompt
/// so the Architect is told the actual path its solution design belongs at
/// rather than being left to guess a directory on a machine it cannot list.
/// `None` when the persona has no home pin, and the prompt then says so
/// literally instead of naming a path nobody resolved.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct HomeProject {
    pub id: String,
    pub name: String,
    /// `dev_projects.root_path` — the repository the run's working directory is
    /// set to.
    pub root_path: String,
}

/// An ask this persona already put to the operator that nobody has answered.
///
/// Carried into the prompt so a blocked persona does not re-ask the same
/// question every wake, and re-used by the executor as the duplicate-suppression
/// key — one shape, so the rule the prompt states and the rule the code enforces
/// cannot drift apart.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct OpenAsk {
    /// The `persona_manual_reviews` row this ask is waiting in.
    pub review_id: String,
    pub kind: String,
    pub title: String,
    /// How long it has been waiting. Computed by the gatherer against the same
    /// clock stamped on [`DecisionContext::now_utc`], so the renderer stays a
    /// pure function and never reads a clock of its own. `None` = the row's
    /// timestamp could not be parsed; the prompt then prints no age at all.
    pub age_minutes: Option<i64>,
}

/// One thing that was said in a channel this persona can hear.
///
/// The gap this closes, measured 2026-09-07: a persona heard a channel in
/// exactly two ways — injected at a team-assignment step boundary, or through
/// the arrivals lane, whose predicate was `author_kind = 'user'`. Neither
/// reaches the App Master's standing decision, so a persona that had just been
/// told what to build by the workspace's Architect made its plan without
/// knowing it had been told anything.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct ChannelLine {
    /// The message id — what a reply stamps as `replyTo`.
    pub id: String,
    /// Who spoke, as `Label (kind)`. The label is the row's `author_label` or
    /// the author persona's name; the operator has neither and renders as
    /// `the operator (user)`.
    pub from: String,
    /// The author's persona id when a persona spoke — what a reply addressed
    /// back to them is `to`. `None` for the operator and for Athena, neither
    /// of which is addressable as a channel destination.
    pub from_id: Option<String>,
    /// [`AUTHORITY_DIRECTIVE`] | [`AUTHORITY_REQUEST`] | [`AUTHORITY_NOTE`],
    /// or `None` for "declared none" — which is NOT `note`, and the prompt
    /// prints it as `unranked` rather than inventing a rank.
    pub authority: Option<String>,
    /// Bounded to [`MAX_CHANNEL_BODY_CHARS`] by the gatherer.
    pub body: String,
    /// How long ago it was said. `None` = the timestamp could not be parsed,
    /// and the prompt then prints no age rather than a fabricated one.
    pub age_minutes: Option<i64>,
    /// It named this persona in `addressed_to`, rather than reaching it as a
    /// directive to the whole team.
    pub addressed_to_me: bool,
}

/// A review of this persona's that somebody — or the unattended triage policy
/// — has answered since its last decide pass.
///
/// The half of the ask channel that did not exist until 9ef19a00: a persona
/// raised a question, the operator approved it, and nothing carried the answer
/// back. The row left `open_asks` and appeared nowhere else, so an approval
/// that needed an action (merge this, amend that goal, dispatch this) was
/// answered into silence and the persona re-raised it on a later wake.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct AnsweredReview {
    pub title: String,
    /// `approved` | `rejected` | `resolved`, as the row spells it.
    pub status: String,
    /// The reviewer's own words, bounded — usually the whole answer.
    pub notes: Option<String>,
    /// It was this persona's own ask to the operator, rather than a review
    /// somebody filed about its work.
    pub was_ask: bool,
    /// The unattended triage policy approved it, not a person. Rendered
    /// explicitly because reading a policy's approval as a human decision is
    /// the specific mistake this block exists to prevent.
    pub auto_triaged: bool,
    pub resolved_at: Option<String>,
}

/// How many answered reviews one wake is shown. Newest first; the rest are
/// counted, like every other capped list in this prompt.
pub(crate) const MAX_ANSWERED_REVIEWS: usize = 8;

/// A window in which the LOOP ITSELF was stopped, as a prompt is told it.
///
/// The App Master's own reading of a silent stretch is "nothing happened", and
/// it is wrong in the one way that matters: nothing happened BECAUSE the
/// platform held every persona (fed0339f). Carried into the prompt so a wake
/// after a multi-day stop does not read its empty episode list as evidence
/// about its charters.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct LoopHoldNote {
    pub kind: String,
    pub started_at: String,
    /// `None` = the hold is still on as this prompt is written.
    pub ended_at: Option<String>,
    pub detail: String,
}

/// How long ago `then` was, measured from `now` — "3d 4h ago", "45m ago".
/// `None` when either instant is unparseable, and the caller then prints no
/// age rather than a fabricated one.
///
/// Pure, and shared by every brief that has a clock: the decision prompt's
/// coverage lines, the advance and improve briefs. Seconds are never printed —
/// this answers "how stale is this", not "when exactly".
pub(crate) fn age_phrase(now: &str, then: &str) -> Option<String> {
    // A stamp in the future is a clock the loop does not trust enough to do
    // arithmetic on — `minutes_between` refuses it.
    Some(format!(
        "{} ago",
        duration_phrase(minutes_between(now, then)?)
    ))
}

/// `minutes` as the coarsest honest phrase: `3d 4h`, `5h 20m`, `45m`, `just now`.
pub(crate) fn duration_phrase(minutes: i64) -> String {
    let (days, hours, mins) = (minutes / 1440, (minutes % 1440) / 60, minutes % 60);
    if days > 0 {
        return format!("{days}d {hours}h");
    }
    if hours > 0 {
        return format!("{hours}h {mins}m");
    }
    if mins > 0 {
        return format!("{mins}m");
    }
    "just now".to_string()
}

/// A persona this one shares a team with — the set `say.to` may name.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct ChannelPeer {
    pub id: String,
    pub name: String,
}

/// Everything the decision is allowed to know.
#[derive(Debug, Clone, Default)]
pub(crate) struct DecisionContext {
    pub persona_id: String,
    pub persona_name: String,
    /// `personas.max_concurrent` (`<= 0` = unlimited, the queue's convention).
    pub max_concurrent: i32,
    /// The model this persona thinks with, resolved at plan time through the
    /// SAME chain a dispatched run uses (charter `spec.modelOverride` → the
    /// persona's own `model_profile` → the capability default), so the
    /// decision and the work it orders never run on different models by
    /// accident. Not rendered into the prompt — it IS the call.
    pub model: String,
    /// Slots this persona may fill RIGHT NOW — already the minimum of its own
    /// remaining concurrency and the engine's global capacity. Filled by the
    /// executor immediately before the call, never at plan time: a figure
    /// measured minutes earlier is not capacity, it is a guess.
    pub free_capacity: usize,
    /// This persona's own executions running right now, out of the live
    /// tracker. Printed beside [`Self::free_capacity`] so the persona is told
    /// WHY it has the capacity it has.
    pub running_executions: usize,
    /// This persona's own fleet workers still holding a slot. The half that was
    /// invisible until 2026-09-07 — a code charter dispatches a headless fleet
    /// session and no execution, so a persona reading only the tracker saw two
    /// workers in the fleet grid and "2 free" in its own prompt.
    pub running_fleet: usize,
    /// The app-wide active-persona population and its cap (G4), or `None` when
    /// the count could not be read.
    ///
    /// Rendered into the CAPACITY line, one field away from this persona's own
    /// free slots, because they are two different ceilings and a loop that
    /// confuses them asks for a hire it cannot have: `free_capacity` is how much
    /// work THIS persona may start right now; this is how many personas the app
    /// will let exist in the on state at all.
    pub active_personas: Option<personas_engine::active_persona_cap::ActivePersonaHeadroom>,
    /// The wall clock at gather time, RFC-3339 UTC. Carried rather than read
    /// inside the renderer so [`render_decision_prompt`] stays a pure function
    /// of its context — and so a prompt in a ledger can be reproduced exactly.
    /// Empty means the clock was not read; the prompt then prints no time at
    /// all rather than a fabricated one.
    pub now_utc: String,
    pub charters: Vec<DecisionCharter>,
    pub projects: Vec<ProjectSnapshot>,
    /// Asks this persona has already put to the operator and nobody has
    /// answered yet.
    pub open_asks: Vec<OpenAsk>,
    /// Reviews of this persona's that were ANSWERED since its last decide pass
    /// (9ef19a00), newest first, at most [`MAX_ANSWERED_REVIEWS`].
    pub answered_reviews: Vec<AnsweredReview>,
    /// The loop-wide hold that overlapped the time since this persona's last
    /// decide, when there was one (fed0339f). `None` is the ordinary case and
    /// renders nothing.
    pub loop_hold: Option<LoopHoldNote>,
    /// What was said in the channels this persona can hear, newest first, at
    /// most [`MAX_CHANNEL_LINES`].
    pub channel: Vec<ChannelLine>,
    /// The personas this one shares a team with — the only ids `say.to` may
    /// name. Empty means it can still speak to `team`, and every named id is
    /// dropped.
    pub peers: Vec<ChannelPeer>,
    /// This persona holds a charter with `spec.authority = true`, so it may
    /// write [`AUTHORITY_DIRECTIVE`]. Everyone else is downgraded to
    /// [`AUTHORITY_REQUEST`] — rank is what the operator granted, not what the
    /// model claimed.
    pub may_direct: bool,
    /// The workspace this persona holds, when its charters are workspace-bound
    /// (the Architect). `None` for every project-bound App Master, and the
    /// prompt then renders no workspace section at all rather than an empty
    /// one — the loop's own rule about figures it did not measure.
    pub workspace: Option<WorkspaceView>,
    /// The project this persona writes into when it has no codebase of its own.
    /// `None` for every project-bound App Master (which has a codebase) and for
    /// a workspace whose Architect was adopted before it held any project.
    pub home_project: Option<HomeProject>,
}

// ── Output ────────────────────────────────────────────────────────────────

/// One charter the plan wants run this wake.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DecisionItem {
    pub charter_id: String,
    /// Why this one, this wake — echoed into the ledger so a human reading the
    /// ledger sees the persona's own argument, not just an id.
    pub reason: String,
    /// What specifically to do, appended to the charter's standing task text.
    pub brief: String,
}

/// One charter the plan deliberately left for later.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DecisionDeferral {
    pub charter_id: String,
    pub reason: String,
}

/// One question the plan puts to the operator, because it is the operator's to
/// answer.
///
/// The loop's own ceiling, measured 2026-09-07: an App Master whose delivery
/// charter is starved by an un-triaged backlog can dispatch nothing useful and
/// has, until now, had exactly one way to say so — a 300-character coverage note
/// addressed to its own next wake. This is the other direction of that channel.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct OperatorAsk {
    /// [`ASK_ACCEPT_IDEAS`] | [`ASK_DECISION`] | [`ASK_UNBLOCK`]. Anything else
    /// the model writes is read as [`ASK_DECISION`] — see [`normalize_ask_kind`].
    pub kind: String,
    pub title: String,
    /// Why the loop cannot move without this. Becomes the review's description.
    pub why: String,
    /// Backlog idea ids the ask is about, as the model wrote them: full uuids or
    /// the 8-char prefixes the app prints. Resolved against `dev_ideas` by the
    /// caller, which drops what does not resolve.
    pub idea_ids: Vec<String>,
    /// The choices the operator is being offered, when the ask offers choices.
    pub options: Vec<String>,
}

/// One role the plan wants kp to compose and send back as a persona.
///
/// The counterpart of [`OperatorAsk`] pointed at the other product rather than
/// at a person: an ask waits for a human, a hire does not. Both exist for the
/// same reason — a wake that can neither dispatch nor explain itself has only
/// its own coverage note to write into.
///
/// No `Eq`: `budget_usd` is an `f64`, and the plan types this one is nested in
/// drop `Eq` with it. Nothing compares plans for total equality; the tests use
/// `assert_eq!`, which needs only `PartialEq`.
#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct HireRequest {
    /// The work, the evidence and the acceptance in prose, bounded to
    /// [`MAX_HIRE_NEED_CHARS`]. kp composes the whole role from this.
    pub need: String,
    /// The project the hired role would belong to. `None` = the persona's own
    /// project, resolved by the executor from the decision context.
    pub project_id: Option<String>,
    /// A monthly ceiling in USD the asker proposes. Advisory: kp's composer
    /// decides the budget block, and this is the asker's own estimate of what
    /// the work is worth.
    pub budget_usd: Option<f64>,
}

/// One repository the plan wants created in its workspace.
///
/// Executed through `project_scaffold::create_in_root`, the same door
/// `POST /dev-tools/projects/create` runs. Nothing here names a path: the root
/// is derived at the executor from where the workspace's existing projects
/// already live, so the Architect never has to know — or be able to name — a
/// directory on this machine.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct NewProject {
    /// The repository's folder name and the project's display name, bounded to
    /// [`MAX_PROJECT_NAME_CHARS`]. The scaffold door validates the characters.
    pub name: String,
    pub description: Option<String>,
    pub tech_stack: Option<String>,
    /// The skeleton to scaffold, as the model wrote it. Matched against
    /// `ProjectTemplate`'s kebab-case wire names by the executor; an
    /// unrecognised word falls back to `empty` rather than costing the project.
    pub template: Option<String>,
}

/// One App Master the plan wants adopted onto a project.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct NewAppMaster {
    /// A project id or name. Resolved by the executor against THIS workspace
    /// only — including the projects this same wake created.
    pub project: String,
    /// The recipes the adopted App Master holds, with the Architect's ordering.
    pub recipes: Vec<AdoptionRecipe>,
    /// Whether to switch the adopted persona on. Honoured only within the
    /// app-wide active-persona cap: at the cap the adoption still happens, the
    /// persona stays off, and the refusal text is recorded.
    pub enabled: bool,
}

/// One recipe named in an adoption.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct AdoptionRecipe {
    pub slug: String,
    /// 1 (highest) .. 5. `None` lets the adopted persona use its judgment.
    pub priority: Option<u8>,
}

/// One goal the plan wants set on a project in its workspace.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct NewGoal {
    /// Set to AMEND an existing goal (G41): a goal id or an id prefix of at
    /// least eight characters, resolved across the workspace's projects.
    /// `None` creates. An amendment leaves `project` empty and `title` empty
    /// when the wording does not change.
    pub id: Option<String>,
    /// A project id or name, resolved the same way [`NewAppMaster::project`] is.
    pub project: String,
    pub title: String,
    pub description: Option<String>,
    /// For an amendment only: a new status, one of the canonical goal
    /// statuses. Anything else is refused by the repo with the list.
    pub status: Option<String>,
}

/// One message the plan posts into its channel.
///
/// The other direction of [`ChannelLine`]: until this existed an App Master
/// could read nothing from a channel and write nothing into one, so a
/// directive from an authority had no possible answer and a question for a
/// sibling had to be routed through the operator's review queue.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct Say {
    /// [`SAY_TO_TEAM`] or a peer persona id. An id outside
    /// [`DecisionContext::peers`] is dropped by the parser.
    pub to: String,
    /// [`AUTHORITY_REQUEST`] or [`AUTHORITY_NOTE`].
    /// [`AUTHORITY_DIRECTIVE`] is downgraded to `request` unless the persona
    /// holds an authority charter.
    pub authority: String,
    /// Bounded to [`MAX_SAY_BODY_CHARS`].
    pub body: String,
    /// The channel message being answered, when this is an answer.
    pub reply_to: Option<String>,
}

/// Who a plan may address, and with what rank. Derived from the context, so
/// the rule the prompt states and the rule the parser enforces come from one
/// place.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct SayPolicy {
    /// Peer persona ids `say.to` may name.
    pub peer_ids: Vec<String>,
    /// Whether [`AUTHORITY_DIRECTIVE`] survives the parse.
    pub may_direct: bool,
}

impl SayPolicy {
    pub(crate) fn from_context(ctx: &DecisionContext) -> Self {
        Self {
            peer_ids: ctx.peers.iter().map(|p| p.id.clone()).collect(),
            may_direct: ctx.may_direct,
        }
    }
}

/// A parsed, bounded, capacity-capped plan.
///
/// `Eq` was dropped when `hires` arrived — see [`HireRequest`].
#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct DecisionPlan {
    pub dispatch: Vec<DecisionItem>,
    pub defer: Vec<DecisionDeferral>,
    /// What this wake needs a person to decide. At most [`MAX_ASKS`].
    pub asks: Vec<OperatorAsk>,
    /// Roles this wake wants kp to compose. At most [`MAX_HIRES`], and empty
    /// unless the roster licenses hiring ([`may_hire`]).
    pub hires: Vec<HireRequest>,
    /// How many hires were dropped because the roster does not license the
    /// verb. Kept rather than silently discarded, for the same reason
    /// [`DecisionPlan::dropped_unknown`] is: a plan that reaches for a
    /// capability it does not hold is a fact the ledger should carry.
    pub dropped_unlicensed_hires: usize,
    /// Repositories this wake wants created. At most [`MAX_CREATE_PROJECTS`],
    /// and empty unless the roster licenses the authority verbs
    /// ([`may_command`]).
    pub create_projects: Vec<NewProject>,
    /// App Masters this wake wants adopted. At most [`MAX_ADOPT_APP_MASTERS`],
    /// same licence.
    pub adopt_app_masters: Vec<NewAppMaster>,
    /// Goals this wake wants set. At most [`MAX_SET_GOALS`], same licence.
    pub goals: Vec<NewGoal>,
    /// How many entries across the three authority verbs were dropped because
    /// the roster does not license them. One count for the three, for the same
    /// reason [`may_command`] is one door: they are one grant, so a plan that
    /// reached for any of them reached past the same boundary.
    pub dropped_unlicensed_commands: usize,
    /// What this wake says in its channel. At most [`MAX_SAY`].
    pub say: Vec<Say>,
    /// `say.to` values naming a persona this one shares no team with. Kept
    /// rather than silently discarded, for the same reason
    /// [`Self::dropped_unknown`] is: a plan that invents a colleague is a plan
    /// that did not read its roster, and the ledger should show it happened.
    pub dropped_unknown_say: Vec<String>,
    /// How many `say` entries asked for `directive` and were downgraded.
    pub say_downgraded: usize,
    /// The plan's message to its own next wake.
    pub note: Option<String>,
    /// How long the persona chose to sleep before waking again, in minutes,
    /// already clamped to [`MIN_NEXT_WAKE_MINUTES`]..=[`MAX_NEXT_WAKE_MINUTES`].
    /// `None` = the plan said nothing, so the previous choice stands.
    pub next_wake_minutes: Option<u32>,
    /// Charter ids the model named that do not exist on this persona. Kept
    /// rather than silently discarded: a plan that invents ids is a plan that
    /// did not read the roster, and the ledger should show that it happened.
    pub dropped_unknown: Vec<String>,
    /// How many dispatch entries were cut by the capacity cap.
    pub trimmed_for_capacity: usize,
}

/// Why a model reply could not become a plan. Every variant is a reason to
/// fall back to the deterministic single dispatch, never to dispatch nothing.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum DecisionError {
    /// The model returned nothing (or only whitespace).
    Empty,
    /// No JSON object could be found in the reply.
    NoJson(String),
    /// A JSON object was found but did not deserialize.
    Malformed(String),
    /// The model asked for work, but EVERY charter it named is unknown — it
    /// was not reading the roster, so nothing it said can be trusted.
    NoKnownCharters(Vec<String>),
}

impl std::fmt::Display for DecisionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Empty => f.write_str("the decision call returned no text"),
            Self::NoJson(p) => write!(f, "no JSON object in the decision reply: {p}"),
            Self::Malformed(e) => write!(f, "decision reply did not parse: {e}"),
            Self::NoKnownCharters(ids) => write!(
                f,
                "the decision named only charters this persona does not hold: {}",
                ids.join(", ")
            ),
        }
    }
}

// ── The wire shape (deserialize only) ─────────────────────────────────────

#[derive(serde::Deserialize)]
struct WireItem {
    /// The prompt asks for `charterId`; `charter_id` is accepted too because a
    /// model that reads the surrounding Rust-ish vocabulary sometimes reaches
    /// for snake_case, and rejecting a plan over a separator would be a
    /// needless fallback.
    #[serde(rename = "charterId", alias = "charter_id")]
    charter_id: Option<String>,
    #[serde(default)]
    reason: Option<String>,
    #[serde(default)]
    brief: Option<String>,
}

#[derive(serde::Deserialize)]
struct WireAsk {
    #[serde(default)]
    kind: Option<String>,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    why: Option<String>,
    /// `ideaIds` is what the prompt asks for; `idea_ids` is accepted for the
    /// same reason `charter_id` is.
    #[serde(rename = "ideaIds", alias = "idea_ids", default)]
    idea_ids: Vec<String>,
    #[serde(default)]
    options: Vec<String>,
}

#[derive(serde::Deserialize)]
struct WireHire {
    #[serde(default)]
    need: Option<String>,
    #[serde(rename = "projectId", alias = "project_id", default)]
    project_id: Option<String>,
    /// `serde_json::Value` for the same reason `next_wake_minutes` is: a model
    /// that writes `"$200"` or `"200/mo"` must lose only its budget suggestion
    /// — which kp overrides with its own composer anyway — and not the hire.
    #[serde(rename = "budgetUsd", alias = "budget_usd", default)]
    budget_usd: Option<serde_json::Value>,
}

#[derive(serde::Deserialize)]
struct WireNewProject {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    description: Option<String>,
    #[serde(rename = "techStack", alias = "tech_stack", default)]
    tech_stack: Option<String>,
    #[serde(default)]
    template: Option<String>,
}

#[derive(serde::Deserialize)]
struct WireAdoptionRecipe {
    #[serde(default)]
    slug: Option<String>,
    /// `serde_json::Value` for the same reason `next_wake_minutes` is: a model
    /// that writes `"1"` or `1.0` must lose only its ordering suggestion, not
    /// the recipe — and not the whole adoption.
    #[serde(default)]
    priority: Option<serde_json::Value>,
}

#[derive(serde::Deserialize)]
struct WireAdoptAppMaster {
    #[serde(default)]
    project: Option<String>,
    #[serde(default)]
    recipes: Vec<WireAdoptionRecipe>,
    #[serde(default)]
    enabled: Option<bool>,
}

#[derive(serde::Deserialize)]
struct WireNewGoal {
    #[serde(default, alias = "goalId", alias = "goal_id")]
    id: Option<String>,
    #[serde(default)]
    project: Option<String>,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    status: Option<String>,
}

#[derive(serde::Deserialize)]
struct WireSay {
    #[serde(default)]
    to: Option<String>,
    #[serde(default)]
    authority: Option<String>,
    #[serde(default)]
    body: Option<String>,
    /// `replyTo` is what the prompt asks for; `reply_to` is accepted for the
    /// same reason `charter_id` is.
    #[serde(rename = "replyTo", alias = "reply_to", default)]
    reply_to: Option<String>,
}

#[derive(serde::Deserialize)]
struct WirePlan {
    #[serde(default)]
    dispatch: Vec<WireItem>,
    #[serde(default)]
    defer: Vec<WireItem>,
    /// Absent is an empty list, never a parse failure: a wake with nothing to
    /// say is the normal wake.
    #[serde(default)]
    say: Vec<WireSay>,
    /// Absent (the common case) is an empty list, never a parse failure: a plan
    /// with nothing to ask is the normal plan.
    #[serde(default)]
    asks: Vec<WireAsk>,
    /// Absent is an empty list, like `asks`. Dropped entirely unless the roster
    /// licenses hiring — see [`may_hire`].
    #[serde(default)]
    hires: Vec<WireHire>,
    /// The three authority verbs. Absent is an empty list, like `asks`, and
    /// dropped entirely unless the roster licenses them — see [`may_command`].
    #[serde(rename = "createProjects", alias = "create_projects", default)]
    create_projects: Vec<WireNewProject>,
    #[serde(rename = "adoptAppMasters", alias = "adopt_app_masters", default)]
    adopt_app_masters: Vec<WireAdoptAppMaster>,
    #[serde(default)]
    goals: Vec<WireNewGoal>,
    #[serde(default)]
    note: Option<String>,
    /// Deliberately `serde_json::Value` rather than `Option<u32>`: a model that
    /// answers `"30 minutes"` or `22.5` must lose only its sleep choice, not
    /// the whole plan. A typed field would make the entire reply Malformed and
    /// send a perfectly good dispatch list to the deterministic fallback.
    #[serde(rename = "nextWakeMinutes", alias = "next_wake_minutes", default)]
    next_wake_minutes: Option<serde_json::Value>,
}

// ── Parse ─────────────────────────────────────────────────────────────────

/// Turn a model reply into a plan this loop is willing to act on.
///
/// In order: find the JSON (fences tolerated), deserialize, drop entries naming
/// a charter this persona does not hold, dedupe by charter id keeping the first
/// mention, stable-sort so charters carrying an explicit `priority` lead (by
/// priority ascending) while the rest keep the model's own order, bound every
/// string, and finally cut the dispatch list to `free_capacity`.
///
/// `charters` supplies both the id allowlist and the priorities — one argument
/// instead of two that could disagree.
/// `say_policy` decides who this persona may address and whether it may write
/// a directive; [`SayPolicy::from_context`] derives it from the same context
/// the prompt was rendered from, so the rule the model is told and the rule
/// enforced here cannot drift apart.
pub(crate) fn parse_decision_with(
    raw: &str,
    charters: &[DecisionCharter],
    free_capacity: usize,
    say_policy: &SayPolicy,
) -> Result<DecisionPlan, DecisionError> {
    if raw.trim().is_empty() {
        return Err(DecisionError::Empty);
    }
    let span = crate::companion::brain::oneshot::extract_json_span(raw, "app-master decision")
        .map_err(|e| DecisionError::NoJson(e.to_string()))?;
    let wire: WirePlan =
        serde_json::from_str(span).map_err(|e| DecisionError::Malformed(e.to_string()))?;

    let priority_of = |id: &str| -> Option<u8> {
        charters
            .iter()
            .find(|c| c.id == id)
            .and_then(|c| c.priority)
    };
    let known = |id: &str| charters.iter().any(|c| c.id == id);

    let mut dropped_unknown: Vec<String> = Vec::new();
    let mut seen: Vec<String> = Vec::new();
    let mut dispatch: Vec<DecisionItem> = Vec::new();
    let mut named_any = false;

    for item in wire.dispatch {
        let Some(id) = item.charter_id.map(|s| s.trim().to_string()) else {
            continue;
        };
        if id.is_empty() {
            continue;
        }
        named_any = true;
        if !known(&id) {
            if !dropped_unknown.contains(&id) {
                dropped_unknown.push(id);
            }
            continue;
        }
        if seen.contains(&id) {
            continue; // first mention wins
        }
        seen.push(id.clone());
        dispatch.push(DecisionItem {
            reason: bound(item.reason.unwrap_or_default().trim(), MAX_REASON_CHARS),
            brief: bound(item.brief.unwrap_or_default().trim(), MAX_BRIEF_CHARS),
            charter_id: id,
        });
    }

    // A plan that named work and got every id wrong is not a plan.
    if named_any && dispatch.is_empty() && !dropped_unknown.is_empty() {
        return Err(DecisionError::NoKnownCharters(dropped_unknown));
    }

    // Stable: explicit priorities lead in ascending order; absent priorities
    // keep the order the model gave them. `sort_by_key` is stable, so a charter
    // with no declared priority never overtakes one that has it, and two
    // charters at the same priority stay in the model's order.
    dispatch.sort_by_key(|i| match priority_of(&i.charter_id) {
        Some(p) => (0u8, p),
        None => (1u8, 0),
    });

    let trimmed_for_capacity = dispatch.len().saturating_sub(free_capacity);
    dispatch.truncate(free_capacity);

    let mut deferred_seen: Vec<String> = Vec::new();
    let mut defer: Vec<DecisionDeferral> = Vec::new();
    for item in wire.defer {
        let Some(id) = item.charter_id.map(|s| s.trim().to_string()) else {
            continue;
        };
        if id.is_empty() || !known(&id) || deferred_seen.contains(&id) {
            if !id.is_empty() && !known(&id) && !dropped_unknown.contains(&id) {
                dropped_unknown.push(id);
            }
            continue;
        }
        deferred_seen.push(id.clone());
        defer.push(DecisionDeferral {
            reason: bound(item.reason.unwrap_or_default().trim(), MAX_REASON_CHARS),
            charter_id: id,
        });
    }

    let note = wire
        .note
        .map(|n| bound(n.trim(), MAX_NOTE_CHARS))
        .filter(|n| !n.is_empty());

    let next_wake_minutes = wire.next_wake_minutes.as_ref().and_then(clamp_next_wake);

    let asks = parse_asks(wire.asks);
    let (say, dropped_unknown_say, say_downgraded) = parse_say(wire.say, say_policy);

    // The licence is checked HERE rather than at execution so that a plan from
    // an unlicensed roster carries the count it lost, and the ledger can show
    // that the model reached for a capability the persona does not hold.
    let (hires, dropped_unlicensed_hires) = if may_hire(charters) {
        (parse_hires(wire.hires), 0)
    } else {
        (Vec::new(), wire.hires.len())
    };

    // The three authority verbs, gated HERE and for the same reason the hire is:
    // an unlicensed plan keeps its dispatches, and the ledger carries the count
    // it lost rather than a silence indistinguishable from "it never asked".
    let (create_projects, adopt_app_masters, goals, dropped_unlicensed_commands) =
        if may_command(charters) {
            (
                parse_new_projects(wire.create_projects),
                parse_adoptions(wire.adopt_app_masters),
                parse_goals(wire.goals),
                0,
            )
        } else {
            (
                Vec::new(),
                Vec::new(),
                Vec::new(),
                wire.create_projects.len() + wire.adopt_app_masters.len() + wire.goals.len(),
            )
        };

    Ok(DecisionPlan {
        dispatch,
        defer,
        asks,
        hires,
        dropped_unlicensed_hires,
        create_projects,
        adopt_app_masters,
        goals,
        dropped_unlicensed_commands,
        say,
        dropped_unknown_say,
        say_downgraded,
        note,
        next_wake_minutes,
        dropped_unknown,
        trimmed_for_capacity,
    })
}

/// Read the hire list: bound the need, cap the list at [`MAX_HIRES`], drop what
/// says nothing.
///
/// A hire with no `need` is dropped without ceremony — the need IS the request;
/// kp composes the entire role from that prose and has nothing to work from
/// without it. Unlike an ask, there is no title to fall back on.
///
/// `projectId` is NOT validated against the persona's projects here: this module
/// is DB-free by construction, and the executor resolves an unnamed or unknown
/// project to the persona's own. `budgetUsd` is read leniently and dropped when
/// it is not a finite positive number — kp's composer owns the budget block, so
/// a fumbled suggestion must not cost the persona its hire.
fn parse_hires(wire: Vec<WireHire>) -> Vec<HireRequest> {
    let mut hires: Vec<HireRequest> = Vec::new();
    for h in wire {
        if hires.len() >= MAX_HIRES {
            break;
        }
        let need = bound(h.need.unwrap_or_default().trim(), MAX_HIRE_NEED_CHARS);
        if need.is_empty() {
            continue;
        }
        let project_id = h
            .project_id
            .map(|p| p.trim().to_string())
            .filter(|p| !p.is_empty());
        let budget_usd = h
            .budget_usd
            .as_ref()
            .and_then(|v| v.as_f64())
            .filter(|n| n.is_finite() && *n > 0.0);
        hires.push(HireRequest {
            need,
            project_id,
            budget_usd,
        });
    }
    hires
}

// ── The authority verbs, parsed ────────────────────────────────────────────
//
// All three follow `parse_hires`: bound every string, cap the list, drop an
// entry whose ONE indispensable field is missing, and keep everything else.
// None of them resolves a project id — this module is DB-free by construction,
// so a `project` the model wrote stays a string until the executor, which is
// also the only place that knows which projects this wake just created.

/// Read the project list: bound the strings, cap at [`MAX_CREATE_PROJECTS`],
/// drop what has no name.
///
/// A project with no `name` is dropped without ceremony — the name is both the
/// directory and the display, and the scaffold has nothing to make without it.
/// The `template` is carried as the model's own word rather than parsed into an
/// enum here: an unrecognised skeleton must cost the project its scaffold
/// choice, not its existence, and the executor is where the enum lives.
fn parse_new_projects(wire: Vec<WireNewProject>) -> Vec<NewProject> {
    let mut out: Vec<NewProject> = Vec::new();
    for p in wire {
        if out.len() >= MAX_CREATE_PROJECTS {
            break;
        }
        let name = bound(p.name.unwrap_or_default().trim(), MAX_PROJECT_NAME_CHARS);
        if name.is_empty() {
            continue;
        }
        // A wake that names the same project twice asked once. Deduped here so
        // the second mention never consumes a slot the cap would have given a
        // different project.
        if out.iter().any(|x| x.name.eq_ignore_ascii_case(&name)) {
            continue;
        }
        out.push(NewProject {
            name,
            description: bounded_option(p.description, MAX_PROJECT_DESCRIPTION_CHARS),
            tech_stack: bounded_option(p.tech_stack, MAX_TECH_STACK_CHARS),
            template: bounded_option(p.template, MAX_PROJECT_NAME_CHARS),
        });
    }
    out
}

/// Read the adoption list: bound the strings, cap at [`MAX_ADOPT_APP_MASTERS`],
/// drop what names no project.
///
/// An adoption with NO recipes is kept, not dropped: the adoption door accepts
/// an empty list and reads it as "suspend everything this persona holds", which
/// is a legitimate thing for an Architect to decide about a project whose owner
/// should stand down. `enabled` defaults to true — an App Master adopted by the
/// Architect's own decision and left switched off would need a second act
/// nobody scheduled, and the active-persona cap is the real ceiling, enforced
/// at the executor where the live count is.
fn parse_adoptions(wire: Vec<WireAdoptAppMaster>) -> Vec<NewAppMaster> {
    let mut out: Vec<NewAppMaster> = Vec::new();
    for a in wire {
        if out.len() >= MAX_ADOPT_APP_MASTERS {
            break;
        }
        let project = bound(a.project.unwrap_or_default().trim(), MAX_PROJECT_REF_CHARS);
        if project.is_empty() {
            continue;
        }
        if out.iter().any(|x| x.project.eq_ignore_ascii_case(&project)) {
            continue;
        }
        let mut recipes: Vec<AdoptionRecipe> = Vec::new();
        for r in a.recipes {
            if recipes.len() >= MAX_ADOPTION_RECIPES {
                break;
            }
            let slug = bound(r.slug.unwrap_or_default().trim(), MAX_RECIPE_SLUG_CHARS);
            if slug.is_empty() || recipes.iter().any(|x| x.slug == slug) {
                continue;
            }
            recipes.push(AdoptionRecipe {
                slug,
                priority: r.priority.as_ref().and_then(clamp_priority),
            });
        }
        out.push(NewAppMaster {
            project,
            recipes,
            enabled: a.enabled.unwrap_or(true),
        });
    }
    out
}

/// Read the goal list: bound the strings, cap at [`MAX_SET_GOALS`], drop what
/// names no project or has no title.
///
/// Both fields are indispensable here, unlike the other two verbs: a goal with
/// no title is a row nobody can read, and a goal with no project has nowhere to
/// live — `dev_goals.project_id` is not nullable and there is no "the
/// workspace's goals" table to fall back to.
fn parse_goals(wire: Vec<WireNewGoal>) -> Vec<NewGoal> {
    let mut out: Vec<NewGoal> = Vec::new();
    for g in wire {
        if out.len() >= MAX_SET_GOALS {
            break;
        }
        let project = bound(g.project.unwrap_or_default().trim(), MAX_PROJECT_REF_CHARS);
        let title = bound(g.title.unwrap_or_default().trim(), MAX_GOAL_TITLE_CHARS);
        let description = bounded_option(g.description, MAX_GOAL_DESCRIPTION_CHARS);
        // An AMENDMENT (G41): names an existing goal by id. It needs no
        // project (the goal already lives somewhere) and no title (the
        // wording may stand), but it must change SOMETHING — an amendment
        // that touches nothing is dropped rather than written as a no-op
        // the ledger would read as an act.
        if let Some(id) = bounded_option(g.id, MAX_GOAL_ID_CHARS) {
            let status = bounded_option(g.status, MAX_GOAL_STATUS_CHARS);
            if title.is_empty() && description.is_none() && status.is_none() {
                continue;
            }
            if out.iter().any(|x| x.id.as_deref() == Some(id.as_str())) {
                continue;
            }
            out.push(NewGoal {
                id: Some(id),
                project,
                title,
                description,
                status,
            });
            continue;
        }
        if project.is_empty() || title.is_empty() {
            continue;
        }
        // Same title on the same project, twice in one wake, is one goal.
        if out
            .iter()
            .any(|x| x.project.eq_ignore_ascii_case(&project) && same_ask_title(&x.title, &title))
        {
            continue;
        }
        out.push(NewGoal {
            id: None,
            project,
            title,
            description,
            status: None,
        });
    }
    out
}

/// Bound an optional string and turn a blank one into `None` — a field the
/// model wrote as `""` said nothing, and carrying it forward would put an empty
/// description on a row.
fn bounded_option(raw: Option<String>, max: usize) -> Option<String> {
    raw.map(|s| bound(s.trim(), max)).filter(|s| !s.is_empty())
}

/// Read a charter priority leniently: 1..=5, anything else ignored.
///
/// Ignored rather than clamped, unlike `nextWakeMinutes`: `None` means "nobody
/// ranked it and the judgment is the persona's", which is a real answer the
/// roster already prints, so a fumbled number becomes the honest absence rather
/// than a rank the Architect did not choose.
fn clamp_priority(raw: &serde_json::Value) -> Option<u8> {
    let n = raw.as_i64().or_else(|| raw.as_str()?.trim().parse().ok())?;
    (1..=5).contains(&n).then_some(n as u8)
}

/// Read the channel list: cap it, bound the bodies, resolve the destination
/// against the peer allowlist, and clamp the authority to what this persona
/// was actually granted.
///
/// Returns `(kept, dropped destination ids, downgrade count)`. Pure — the
/// caller logs, because a pure function that writes to `tracing` cannot be
/// tested for what it decided, only for what it returned.
fn parse_say(wire: Vec<WireSay>, policy: &SayPolicy) -> (Vec<Say>, Vec<String>, usize) {
    let mut kept: Vec<Say> = Vec::new();
    let mut dropped: Vec<String> = Vec::new();
    let mut downgraded = 0usize;

    for s in wire {
        if kept.len() >= MAX_SAY {
            break;
        }
        // A message with nothing in it is not a message. Dropped before the
        // destination is resolved so an empty body never fills a slot.
        let body = bound(s.body.unwrap_or_default().trim(), MAX_SAY_BODY_CHARS);
        if body.is_empty() {
            continue;
        }
        // An absent or blank destination is the whole team: the persona said
        // something without naming anybody, which is exactly what a team
        // channel is for. Only a NAMED id can be wrong.
        let raw_to = s.to.unwrap_or_default().trim().to_string();
        let to = if raw_to.is_empty() || raw_to.eq_ignore_ascii_case(SAY_TO_TEAM) {
            SAY_TO_TEAM.to_string()
        } else if policy.peer_ids.iter().any(|p| p == &raw_to) {
            raw_to
        } else {
            if !dropped.contains(&raw_to) {
                dropped.push(raw_to);
            }
            continue;
        };

        let asked = s
            .authority
            .unwrap_or_default()
            .trim()
            .to_ascii_lowercase()
            .to_string();
        let authority = match asked.as_str() {
            AUTHORITY_DIRECTIVE if policy.may_direct => AUTHORITY_DIRECTIVE,
            AUTHORITY_DIRECTIVE => {
                downgraded += 1;
                AUTHORITY_REQUEST
            }
            AUTHORITY_REQUEST => AUTHORITY_REQUEST,
            // Absent or unrecognised is `note`, not a dropped message: the
            // safe direction is the one that wakes nobody. `request` and
            // `directive` are claims about other personas' attention, and a
            // model that did not state one has not made that claim.
            _ => AUTHORITY_NOTE,
        };

        kept.push(Say {
            to,
            authority: authority.to_string(),
            body,
            reply_to: s
                .reply_to
                .map(|r| r.trim().to_string())
                .filter(|r| !r.is_empty()),
        });
    }

    (kept, dropped, downgraded)
}

/// Read the ask list: bound every string, cap every list, drop what says
/// nothing.
///
/// An ask with no title is dropped — a review with no title is a row nobody can
/// read, and there is nothing left to ask about. Everything else is kept and
/// trimmed to size: this channel exists because the persona had no way to speak
/// at all, so the bar for keeping what it said is low and the bar for what it
/// may write into the operator's queue is fixed.
fn parse_asks(wire: Vec<WireAsk>) -> Vec<OperatorAsk> {
    let mut asks: Vec<OperatorAsk> = Vec::new();
    for a in wire {
        if asks.len() >= MAX_ASKS {
            break;
        }
        let title = bound(a.title.unwrap_or_default().trim(), MAX_ASK_TITLE_CHARS);
        if title.is_empty() {
            continue;
        }
        let kind = normalize_ask_kind(a.kind.as_deref());
        // Dedupe within the wake as well as against what is already open: a
        // model that names the same question twice asked once.
        if asks
            .iter()
            .any(|x| x.kind == kind && same_ask_title(&x.title, &title))
        {
            continue;
        }
        let mut idea_ids: Vec<String> = Vec::new();
        for raw in a.idea_ids {
            if idea_ids.len() >= MAX_ASK_IDEA_IDS {
                break;
            }
            let id = raw.trim().to_ascii_lowercase();
            if id.is_empty() || idea_ids.contains(&id) {
                continue;
            }
            idea_ids.push(id);
        }
        let options: Vec<String> = a
            .options
            .into_iter()
            .map(|o| bound(o.trim(), MAX_ASK_OPTION_CHARS))
            .filter(|o| !o.is_empty())
            .take(MAX_ASK_OPTIONS)
            .collect();
        asks.push(OperatorAsk {
            kind,
            title,
            why: bound(a.why.unwrap_or_default().trim(), MAX_ASK_WHY_CHARS),
            idea_ids,
            options,
        });
    }
    asks
}

/// Read an ask's `kind`, leniently.
///
/// An unrecognised (or absent) kind becomes [`ASK_DECISION`] rather than
/// dropping the ask: `decision` is the generic "a person must choose", so the
/// operator still sees the question and only the automatic verdict-application
/// of [`ASK_ACCEPT_IDEAS`] is withheld — which is the safe direction to err.
fn normalize_ask_kind(raw: Option<&str>) -> String {
    match raw.unwrap_or_default().trim().to_ascii_lowercase().as_str() {
        ASK_ACCEPT_IDEAS => ASK_ACCEPT_IDEAS.to_string(),
        ASK_UNBLOCK => ASK_UNBLOCK.to_string(),
        _ => ASK_DECISION.to_string(),
    }
}

/// Whether two ask titles name the same question. Case- and whitespace-
/// insensitive, because a model re-asking a question rarely reproduces its own
/// punctuation exactly and an operator would read both rows as one.
pub(crate) fn same_ask_title(a: &str, b: &str) -> bool {
    a.trim().eq_ignore_ascii_case(b.trim())
}

/// Whether this ask is already sitting unanswered in the operator's queue.
///
/// Keyed on `kind` + `title`, which is what the operator actually sees; the
/// `why` and the idea list may legitimately be re-worded between wakes without
/// making it a different question.
pub(crate) fn ask_is_open(ask: &OperatorAsk, open: &[OpenAsk]) -> bool {
    open.iter()
        .any(|o| o.kind == ask.kind && same_ask_title(&o.title, &ask.title))
}

/// Read the plan's sleep choice, clamped into the bounds the prompt states.
///
/// Anything that is not a JSON integer — a string, a float, `null`, an object —
/// is IGNORED (returns `None`, "the plan said nothing"), never coerced: a model
/// that answered `"soon"` did not choose 0 minutes, and a value invented here
/// would be indistinguishable downstream from one the persona meant.
fn clamp_next_wake(raw: &serde_json::Value) -> Option<u32> {
    let n = raw.as_i64()?;
    Some(n.clamp(
        i64::from(MIN_NEXT_WAKE_MINUTES),
        i64::from(MAX_NEXT_WAKE_MINUTES),
    ) as u32)
}

/// The persona's most recent sleep choice, across the charters it holds.
///
/// `write_back_pacing` stamps the SAME value on every charter the decision
/// considered — it is the persona's choice, not the charter's — so in practice
/// they agree. They can still disagree after a charter is added, retired, or
/// edited between wakes, and "newest" is the only defensible tiebreak: the
/// stamp carrying the latest `lastDecidedAt` is the one the persona meant last.
/// A charter with a choice but no stamp sorts oldest rather than being dropped.
///
/// Takes `(last_decided_at, next_wake_minutes)` pairs instead of a charter type
/// so the admission ladder (which holds `PersonaResponsibility`) and the prompt
/// (which holds [`DecisionCharter`]) read the same rule from one place.
pub(crate) fn newest_next_wake_minutes<'a>(
    pacings: impl IntoIterator<Item = (Option<&'a str>, Option<u32>)>,
) -> Option<u32> {
    pacings
        .into_iter()
        .filter_map(|(decided_at, minutes)| minutes.map(|m| (decided_at.unwrap_or(""), m)))
        .max_by(|a, b| a.0.cmp(b.0))
        .map(|(_, m)| m)
}

/// The same read over a decision context's own charters.
pub(crate) fn context_next_wake_minutes(charters: &[DecisionCharter]) -> Option<u32> {
    newest_next_wake_minutes(charters.iter().map(|c| {
        (
            c.pacing.as_ref().and_then(|p| p.last_decided_at.as_deref()),
            c.pacing.as_ref().and_then(|p| p.next_wake_minutes),
        )
    }))
}

/// The persona's most recent coverage note, across the charters it holds.
///
/// Same newest-wins rule as [`newest_next_wake_minutes`], and for the same
/// reason: `write_back_pacing` stamps ONE note on every charter the decision
/// considered, so in practice they agree, and the only case where they disagree
/// — a charter added or retired between wakes — is settled by whichever stamp
/// carries the latest `lastDecidedAt`.
///
/// Takes `(last_decided_at, coverage_note)` pairs rather than a charter type so
/// the state route (which holds `PersonaResponsibility`) and this module read
/// one rule from one place. A blank note is not a note.
pub(crate) fn newest_coverage_note<'a>(
    pacings: impl IntoIterator<Item = (Option<&'a str>, Option<&'a str>)>,
) -> Option<String> {
    pacings
        .into_iter()
        .filter_map(|(decided_at, note)| {
            note.map(str::trim)
                .filter(|n| !n.is_empty())
                .map(|n| (decided_at.unwrap_or(""), n))
        })
        .max_by(|a, b| a.0.cmp(b.0))
        .map(|(_, n)| n.to_string())
}

/// The window the backlog flow is measured over. A day: long enough that one
/// quiet wake or one long delivery run does not swing the ratio, short enough
/// that it describes what the project is doing now rather than what it did
/// last week.
pub(crate) const FLOW_WINDOW_HOURS: u32 = 24;

/// The fill:drain ratio above which the prompt says the imbalance out loud.
///
/// Two is not a crisis — a project that files twice what it delivers is
/// usually finding real work faster than it can do it, which is what a
/// certification pass is FOR. It is named at 2 so the owner sees the trend
/// while it is still cheap to correct, rather than at the 4.4:1 the portfolio
/// was measured at on 2026-09-09 with 553 accepted ideas carrying no task.
const FLOW_IMBALANCE_RATIO: f64 = 2.0;

/// One line naming what the project's backlog did over [`FLOW_WINDOW_HOURS`].
///
/// The judgement stays the App Master's: this states the measurement and what
/// it implies, and never refuses a charter or reorders a queue. Balancing
/// generation against execution is the owner's own responsibility — the
/// platform's job is to make sure the number is in front of it when it
/// decides, which until now it was not.
fn flow_line(p: &ProjectSnapshot) -> String {
    if p.filed_recently == 0 && p.delivered_recently == 0 && p.failed_recently == 0 {
        return format!(
            "  backlog flow (last {FLOW_WINDOW_HOURS}h): nothing filed, nothing delivered\n"
        );
    }
    let mut s = format!(
        "  backlog flow (last {FLOW_WINDOW_HOURS}h): {} filed · {} delivered · {} failed",
        p.filed_recently, p.delivered_recently, p.failed_recently
    );
    // A swept failure is the platform's event, not the project's: the worker
    // was gone (an app restart mid tool call, a closed console, a reaped
    // session) and the sweep that released the row put its ideas back in the
    // backlog. Said before the failure finding below so that a project does
    // not spend a wake diagnosing briefs that were never at fault — six App
    // Masters did exactly that on 2026-09-14 for one restart storm.
    let swept = p.swept_recently.min(p.failed_recently);
    if swept > 0 {
        s.push_str(&format!(
            " — {swept} of the {} failed were SWEPT, not run: their worker was gone \
             (the app restarted mid tool call, a console closed, a session reaped) and \
             the sweep returned their ideas to your backlog. That is the platform's \
             event, not your briefs; re-take those ideas, do not diagnose them.",
            p.failed_recently
        ));
    }
    // AC-FLOW-2 (the Architect, 2026-09-10): a wave that produces a failed
    // task has not delivered, and a project failing more tasks than it
    // completes owes the failure cause BEFORE the ratio below means anything.
    // bank-platform sat at 7 completed / 21 failed and the ratio alone would
    // have told it to deliver harder into a pipeline failing three in four.
    // The finding is owed for the failures a RUN produced; the swept ones were
    // named just above and are not a cause to hunt.
    let run_failures = p.failed_recently - swept;
    if run_failures > p.delivered_recently {
        s.push_str(&format!(
            " — MORE TASKS FAILED THAN COMPLETED in the window ({} of {}). That is the \
             finding you owe first: read the failed task rows by id and say whether \
             the cause is the pipeline, the briefs or the worktree. A project failing \
             three tasks in four is not short of delivery intent.",
            run_failures,
            run_failures + p.delivered_recently
        ));
    }
    if p.delivered_recently == 0 {
        s.push_str(
            " — NOTHING DELIVERED. Filing more findings does not move this project; \
             delivering one does.\n",
        );
        return s;
    }
    let ratio = p.filed_recently as f64 / p.delivered_recently as f64;
    s.push_str(&format!(" ({ratio:.1}:1)"));
    if ratio >= FLOW_IMBALANCE_RATIO {
        s.push_str(&format!(
            " — your backlog is growing {ratio:.1}x faster than it drains. \
             Balancing that is YOUR call and nobody else's: a wave that files more \
             findings than it can deliver spends the project's capacity on describing \
             work rather than doing it. Prefer the charter that DELIVERS until the \
             ratio comes back under {FLOW_IMBALANCE_RATIO:.0}:1, and file only what you \
             would still file knowing nobody may reach it for a week.\n"
        ));
    } else {
        s.push_str(" — draining as fast as it fills or faster.\n");
    }
    s
}

/// The project's goals, each with the work that names it (G41).
///
/// A goal with nothing attached is printed as exactly that. Until 2026-09-10
/// no idea could name a goal and no task ever did, so every goal read as a
/// percentage of an edge that did not exist; the counts here are the edge.
fn goal_lines(p: &ProjectSnapshot) -> String {
    if p.goals.is_empty() {
        return "  goals: (none set on this project)\n".to_string();
    }
    let mut s = format!(
        "  goals ({}) — when a finding you file serves one, name it in \
         `propose_backlog.goal` by the id in brackets; the task delivered from it \
         inherits the goal, and a goal's progress is read from the work attached to \
         it. A goal with no work attached is a document, not a target:\n",
        p.goals.len()
    );
    for g in &p.goals {
        let short = &g.id[..g.id.len().min(8)];
        if g.ideas == 0 && g.tasks == 0 {
            s.push_str(&format!(
                "    - [{short}] {} — {} · no work attached\n",
                g.title, g.status
            ));
        } else {
            s.push_str(&format!(
                "    - [{short}] {} — {} · {} idea(s), {} task(s), {} completed\n",
                g.title, g.status, g.ideas, g.tasks, g.completed_tasks
            ));
        }
    }
    s
}

/// `<stamp> (3d 4h ago)` when both instants parse, the bare stamp when they do
/// not, and `never` for an absent one. Never invents an age.
fn stamp_with_age(now: &str, stamp: Option<&str>) -> String {
    let Some(stamp) = stamp.map(str::trim).filter(|s| !s.is_empty()) else {
        return "never".to_string();
    };
    match age_phrase(now, stamp) {
        Some(age) => format!("{stamp} ({age})"),
        None => stamp.to_string(),
    }
}

/// The charter that has gone longest without a dispatch, as one line.
///
/// Never-dispatched outranks any age — a charter nobody has ever run is the
/// most starved thing on the roster — and ties keep roster order. `None` for a
/// roster of one (there is nothing to compare) or when no charter carries a
/// readable stamp, because a "longest unserved" nobody measured is exactly the
/// kind of figure this loop refuses to print.
fn longest_unserved_line(now: &str, charters: &[DecisionCharter]) -> Option<String> {
    if charters.len() < 2 {
        return None;
    }
    // (rank, minutes) — rank 0 = never dispatched, rank 1 = dispatched once.
    let mut best: Option<(&DecisionCharter, u8, i64)> = None;
    for c in charters {
        let stamp = c
            .pacing
            .as_ref()
            .and_then(|p| p.last_dispatched_at.as_deref())
            .map(str::trim)
            .filter(|s| !s.is_empty());
        let scored = match stamp {
            None => Some((0u8, 0i64)),
            Some(stamp) => minutes_between(now, stamp).map(|m| (1u8, m)),
        };
        let Some((rank, minutes)) = scored else {
            continue; // unreadable stamp: not evidence either way
        };
        let better = match best {
            None => true,
            Some((_, best_rank, best_minutes)) => {
                rank < best_rank || (rank == best_rank && minutes > best_minutes)
            }
        };
        if better {
            best = Some((c, rank, minutes));
        }
    }
    let (charter, rank, minutes) = best?;
    Some(if rank == 0 {
        format!(
            "LONGEST UNSERVED: \"{}\" has NEVER been dispatched.\n",
            charter.title
        )
    } else {
        format!(
            "LONGEST UNSERVED: \"{}\" — last dispatched {} ago.\n",
            charter.title,
            duration_phrase(minutes)
        )
    })
}

/// Whole minutes between two RFC-3339 instants; `None` when either is
/// unparseable or `then` is in the future.
fn minutes_between(now: &str, then: &str) -> Option<i64> {
    let now = chrono::DateTime::parse_from_rfc3339(now.trim()).ok()?;
    let then = chrono::DateTime::parse_from_rfc3339(then.trim()).ok()?;
    let minutes = (now - then).num_minutes();
    (minutes >= 0).then_some(minutes)
}

/// The branches of this project's own authored work that a person still has to
/// merge, and what to do about them.
///
/// Empty renders nothing at all rather than "none waiting": the gatherer leaves
/// the list empty both for a project with nothing outstanding and for one whose
/// repository could not be read, and printing a reassurance for the second case
/// would be the loop asserting a figure it never measured.
fn unmerged_branch_lines(p: &ProjectSnapshot) -> String {
    if p.unmerged_branches.is_empty() {
        return String::new();
    }
    let mut s = format!(
        "  AWAITING A HUMAN MERGE ({}) — your own workers authored these and \
         nobody has landed them. Reconcile a branch before cutting another one \
         beside it for the same charter:\n",
        p.unmerged_branches.len()
    );
    for b in &p.unmerged_branches {
        s.push_str(&format!(
            "    - {} — {} ahead, {} behind {}{}{}\n",
            b.branch,
            b.ahead,
            b.behind,
            b.main,
            b.tip_at
                .as_deref()
                .map(|t| format!(", tip {t}"))
                .unwrap_or_default(),
            b.charter_title
                .as_deref()
                .map(|t| format!(" [your charter \"{t}\"]"))
                .unwrap_or_default(),
        ));
    }
    s.push_str(
        "  While these wait, prefer landing readiness — rebase onto the trunk, \
         green the gates, answer review — over starting new delivery, raise ONE \
         decision ask naming them if no ask about them is open, and choose a LONG \
         nextWakeMinutes if the merge is the only thing blocking you. The \
         judgement is yours: nothing here refuses a dispatch.\n",
    );
    s
}

/// The recipe whose runs deliver accepted backlog ideas. A dispatch of this
/// charter is the only one that has ideas to write back about, which is why it
/// is the only one that mints `dev_tasks` rows at dispatch time.
pub(crate) const ACCEPTED_IDEA_DELIVERY_SLUG: &str = "accepted-idea-delivery";

/// How many accepted ideas ONE delivery dispatch may carry.
///
/// A brief that names several ids is the App Master batching work of one shape
/// onto one branch — the case two projects asked for on 2026-09-09. A brief
/// that names twenty is a plan that has stopped choosing, and minting twenty
/// task rows against one worker would put the same lie in the ledger from the
/// other direction: work marked in hand that nobody is on. Six is the largest
/// batch either project proposed.
pub(crate) const MAX_DISPATCH_IDEAS: usize = 6;

/// Pull EVERY idea id a decision's own words name: full uuids in the order
/// they appear, then bare prefixes in the order they appear.
///
/// The decision prompt lists undispatched ideas as `- <id>: <title>`, so a plan
/// that picked some of them echoes their ids — sometimes the full uuid,
/// sometimes the 8-char prefix the app prints everywhere.
///
/// The plural form exists because a delivery brief may batch several ideas of
/// one shape onto one branch. Reading only the first was correct while a
/// dispatch could carry one idea and became a silent lie the moment it could
/// carry six: the work would be done and five ideas would still read
/// "accepted, no task", so the sensor that tells an App Master it is starving
/// would keep counting work it had already finished.
///
/// Full uuids and bare 8..32-char hex prefixes are both accepted, and a full
/// uuid still wins over a bare prefix — but only over the SAME id's prefix, so
/// the winner is decided per token rather than for the whole brief. Duplicates
/// collapse: naming an id twice is emphasis, not two ideas.
///
/// Pure and deliberately permissive: these are CANDIDATES. The caller resolves
/// each against `dev_ideas` scoped to the project, so a hex-looking word that
/// is not an id — a commit sha, most often — simply fails to resolve and costs
/// nothing.
pub(crate) fn extract_idea_id_tokens(text: &str) -> Vec<String> {
    let is_hex = |c: char| c.is_ascii_hexdigit();
    let looks_like_uuid = |t: &str| {
        t.len() == 36
            && t.char_indices().all(|(i, c)| {
                if [8, 13, 18, 23].contains(&i) {
                    c == '-'
                } else {
                    is_hex(c)
                }
            })
    };

    let mut uuids: Vec<String> = Vec::new();
    let mut prefixes: Vec<String> = Vec::new();
    for raw in text.split(|c: char| !(is_hex(c) || c == '-')) {
        let tok = raw.trim_matches('-');
        if tok.is_empty() {
            continue;
        }
        if looks_like_uuid(tok) {
            let t = tok.to_ascii_lowercase();
            if !uuids.contains(&t) {
                uuids.push(t);
            }
            continue;
        }
        // A bare prefix: 8..32 hex chars, no dashes. Shorter than 8 is not
        // something anybody printed, and longer than 32 is not a uuid's hex.
        if (8..=32).contains(&tok.len()) && tok.chars().all(is_hex) {
            let t = tok.to_ascii_lowercase();
            if !prefixes.contains(&t) {
                prefixes.push(t);
            }
        }
    }

    // A uuid and its own prefix name one idea, so the prefix is dropped. A
    // prefix of some OTHER id is a second idea and survives — which is the
    // whole reason the two lists are merged rather than one shadowing the
    // other.
    let mut out = uuids;
    for p in prefixes {
        if !out.iter().any(|u| u.starts_with(&p)) {
            out.push(p);
        }
    }
    out
}

// ── An ask, as a review row ───────────────────────────────────────────────

/// The `persona_manual_reviews` row an ask becomes, computed without a
/// database so the mapping is testable on its own.
///
/// Deliberately NOT `CreateManualReviewInput`: that type also carries the
/// execution/persona anchors and the team-step links, which are the caller's
/// facts, not the ask's. This is only the part the ask decides.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct AskReview {
    pub title: String,
    pub description: String,
    pub severity: String,
    /// A JSON object string, ready for `context_data`.
    pub context_data: String,
    /// A JSON array string, ready for `suggested_actions` — the shape
    /// `engine::dispatch` writes for a runtime review, which is what the review
    /// UI reads.
    pub suggested_actions: String,
}

/// Turn one ask into the review row the operator will read.
///
/// `resolved_ideas` are `(full id, title)` pairs the caller has already looked
/// up; ids that did not resolve are simply absent, so the description never
/// promises an item nobody can find. Pure — the caller owns every lookup.
pub(crate) fn ask_to_review(
    ask: &OperatorAsk,
    persona_id: &str,
    project_id: Option<&str>,
    project_name: Option<&str>,
    resolved_ideas: &[(String, String)],
) -> AskReview {
    let project_label = project_name
        .map(str::trim)
        .filter(|n| !n.is_empty())
        .or_else(|| project_id.map(str::trim).filter(|p| !p.is_empty()));
    let title = match project_label {
        Some(label) => format!("App Master {label}: {}", ask.title),
        // No project to name is not a reason to drop the prefix — the operator
        // still needs to know which surface is speaking.
        None => format!("App Master: {}", ask.title),
    };

    let mut description = ask.why.trim().to_string();
    if !resolved_ideas.is_empty() {
        if !description.is_empty() {
            description.push_str("\n\n");
        }
        description.push_str("Ideas:\n");
        for (id, idea_title) in resolved_ideas {
            // The 8-char prefix is what the app prints everywhere else, so it
            // is what the operator can match against the backlog.
            let short: String = id.chars().take(8).collect();
            description.push_str(&format!("- {short}: {}\n", idea_title.trim()));
        }
        // One trailing newline is noise in a description field.
        while description.ends_with('\n') {
            description.pop();
        }
    }

    let actions: Vec<String> = if ask.kind == ASK_ACCEPT_IDEAS {
        // Fixed, because the resolve path keys on these exact strings. A model
        // wording its own options here would silently disarm the verdicts.
        vec![
            ASK_ACCEPT_ACTION.to_string(),
            ASK_REJECT_ACTION.to_string(),
            ASK_LATER_ACTION.to_string(),
        ]
    } else {
        ask.options.clone()
    };

    let context_data = serde_json::json!({
        "source": ASK_SOURCE,
        "personaId": persona_id,
        "projectId": project_id,
        "kind": ask.kind,
        "ideaIds": resolved_ideas.iter().map(|(id, _)| id.as_str()).collect::<Vec<_>>(),
        // The ask's OWN title, unprefixed. The duplicate check compares this
        // rather than the row's title so it never has to un-build the
        // `App Master <project>: ` prefix — and so a project rename between
        // wakes does not turn one open question into two.
        "askTitle": ask.title,
    })
    .to_string();

    AskReview {
        title,
        description,
        severity: "info".to_string(),
        context_data,
        suggested_actions: serde_json::json!(actions).to_string(),
    }
}

/// Char-bounded truncation on a char boundary (the loop's existing helper is
/// byte-budgeted; this one counts characters because the limits above are
/// stated to the model in characters).
fn bound(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    s.chars().take(max).collect()
}

// ── Prompt ────────────────────────────────────────────────────────────────

/// Render the persona's standing question. Pure: same context, same string.
///
/// The prompt states four things the parser then enforces, so the model is
/// never surprised by a rule it was not told: the priority rule, the capacity,
/// the exact charter ids it may name, and the one-JSON-object output contract.
pub(crate) fn render_decision_prompt(ctx: &DecisionContext) -> String {
    let mut s = String::new();
    s.push_str(&format!(
        "You are {}, and this is your wake. You hold standing responsibilities \
         (charters) over the project(s) below.\n\n\
         YOUR STANDING QUESTION: which of my responsibilities moves this project \
         forward this wake, and why?\n\n",
        ctx.persona_name
    ));

    // --- Where in time this wake sits ---
    //
    // Every other instant in this prompt is an absolute timestamp, so without
    // a "now" the persona cannot tell a dispatch that started four minutes ago
    // from one that started four hours ago — and elapsed time is exactly what
    // its own pacing choice is about. Printed only when the clock was actually
    // read (the loop's own rule about figures it did not measure).
    let now = ctx.now_utc.trim();
    let chosen_sleep = context_next_wake_minutes(&ctx.charters);
    if !now.is_empty() {
        s.push_str(&format!("RIGHT NOW (UTC): {now}\n"));
    }
    if let Some(minutes) = chosen_sleep {
        s.push_str(&format!(
            "You chose to sleep {minutes} minutes after your last wake.\n"
        ));
    }
    // The silence, named (fed0339f). Without this a persona reads a multi-day
    // gap in its own episodes as a quiet period on its charters, when what
    // actually happened is that the platform stopped every persona in the app.
    if let Some(h) = &ctx.loop_hold {
        s.push_str(&format!(
            "LOOP HELD: the whole attention loop was stopped ({}) from {} {} — {}. \
             No charter of yours could be dispatched in that window, by anybody. \
             Read the quiet stretch behind you as UNOBSERVED, not as evidence that \
             your charters had nothing to do.\n",
            h.kind,
            h.started_at,
            match h.ended_at.as_deref() {
                Some(end) => format!("to {end}"),
                None => "and it is STILL HELD as you read this".to_string(),
            },
            h.detail,
        ));
    }
    if !now.is_empty() || chosen_sleep.is_some() || ctx.loop_hold.is_some() {
        s.push('\n');
    }

    // --- The rules, before the data ---
    s.push_str("HOW TO DECIDE\n");
    s.push_str(
        "- PRIORITY: a charter with an explicit priority (1 = highest .. 5 = lowest) \
         is ordered ahead of one without. A charter with NO priority is not \
         low-priority — it means nobody ranked it and the judgment is yours.\n",
    );
    s.push_str(
        "- COVERAGE: read each charter's `lastDecidedAt` / `lastDispatchedAt` / \
         `coverageNote`. That is your own memory from previous wakes. Do not \
         re-run what you just ran, and do not starve what you keep deferring.\n",
    );
    s.push_str(&format!(
        "- CAPACITY: you may dispatch AT MOST {} charter(s) this wake ({}; {} \
         execution(s) and {} fleet worker(s) of yours are running). \
         Naming more is not an error — anything past the limit is dropped, \
         highest priority first — but it wastes the slot you actually have. \
         Dispatching FEWER, or none, is a legitimate answer.\n",
        ctx.free_capacity,
        if ctx.max_concurrent > 0 {
            format!("your parallel capacity is {}", ctx.max_concurrent)
        } else {
            "your parallel capacity is unlimited; this is the engine's free slots".to_string()
        },
        // The breakdown, not just the total: a persona that is told only "1
        // free" has to guess which of its workers is holding the other slot,
        // and until 2026-09-07 the honest answer was that the engine did not
        // know either — a code charter's fleet worker was in nobody's count.
        ctx.running_executions,
        ctx.running_fleet,
    ));
    if let Some(h) = ctx.active_personas {
        // A SECOND ceiling, and a different KIND of ceiling: the one above is
        // this persona's own parallel capacity, this one is the machine's.
        // Since 2026-09-08 it bounds how many personas RUN at once and no
        // longer how many exist — hiring and adopting are never refused by it,
        // so the useful thing to say is what a full machine costs (waiting),
        // not what it forbids.
        s.push_str(&format!(
            "- MACHINE: {} of {} personas are running work right now ({} slot(s) free). \
             This limits CONCURRENCY, never the size of the organisation: hiring and \
             adopting are never refused by it. At 0 free, a persona you start simply \
             waits for a slot instead of running now — so prefer finishing what is in \
             flight over widening the front.\n",
            h.running,
            h.cap,
            h.free(),
        ));
    }
    s.push_str(
        "- MAINTENANCE LANE: a charter whose engine is `codex` is carried by the codex CLI on a \
         coding model — cheaper and less able than you. Dispatch it ONLY with a scope you write \
         in the brief: which files or module family, what kind of work (a behaviour-preserving \
         refactor, a structural rebalance, a toolchain move, a coverage or build-time repair), \
         and what must not change. Never scope behaviour, money-path semantics, gates, migrations \
         or public contracts to it. One such worker at a time; it hands you a branch and never \
         merges — you run the gates from the main checkout and merge under your rung. Refusing to \
         dispatch it is the normal outcome of most wakes.\n\
         - IN FLIGHT: a charter whose `last dispatch` is `finished` or `failed` is NOT in \
         flight — read its summary before deciding. Only `running` means a worker of \
         yours is still going; `unknown` means its record is gone, not that it is alive. \
         The same goes for a project's `in flight` tasks: those are already under way, \
         so do not re-dispatch them.\n",
    );
    s.push_str(&format!(
        "- YOUR NEXT WAKE: `nextWakeMinutes` chooses how long you sleep before \
         you are asked this question again. Sleep SHORT ({MIN_NEXT_WAKE_MINUTES}-20) \
         when you dispatched work you must check on, or when work is waiting that \
         you could not start this wake. Sleep LONG (60-{MAX_NEXT_WAKE_MINUTES}) \
         when everything you own is already in flight, or nothing is due yet. \
         Omit the field to keep your current pacing. Anything outside \
         {MIN_NEXT_WAKE_MINUTES}-{MAX_NEXT_WAKE_MINUTES} is pulled back into it.\n"
    ));
    s.push_str(&format!(
        "- ASK WHEN BLOCKED: if what would move the project is a decision only the \
         operator can take (accepting backlog items, choosing between options, \
         granting access), put ONE ask in `asks` naming the exact items or \
         options, instead of sleeping on it. Do not ask for what you can decide \
         yourself. Do not repeat an ask that is still open. At most {MAX_ASKS} \
         asks; `kind` is `{ASK_ACCEPT_IDEAS}`, `{ASK_DECISION}` or \
         `{ASK_UNBLOCK}`.\n"
    ));
    // Rendered ONLY for a roster that licenses hiring. A rule describing a verb
    // the parser will drop is worse than no rule: it invites the model to spend
    // its answer on a request that cannot land, and then says nothing about why
    // the request vanished.
    if may_hire(&ctx.charters) {
        s.push_str(&format!(
            "- HIRE: when a responsibility of yours has no holder and the work is \
             real, name the need once; a hire is a request to kp, and the role \
             arrives as a persona within the active cap. Put it in `hires` with \
             the work, the evidence that it is needed, and what you would accept \
             as done — in prose, at most {MAX_HIRE_NEED_CHARS} characters, \
             because kp composes the whole role from that text and nothing else. \
             At most {MAX_HIRES} per wake. Hire for work NOBODY holds; a \
             responsibility you already hold and cannot get to is a capacity \
             problem, not a hiring one.\n"
        ));
    }
    s.push_str(&format!(
        "- ANSWER THE CHANNEL: a `{AUTHORITY_DIRECTIVE}` from the operator or an \
         authority persona is an instruction you must reflect in this plan — \
         dispatch, defer or ask accordingly, and answer it. A \
         `{AUTHORITY_REQUEST}` deserves an answer. A `{AUTHORITY_NOTE}` is \
         context. Speak with `say` (at most {MAX_SAY} messages); `to` is \
         `{SAY_TO_TEAM}` or one of the persona ids listed under WHO YOU CAN \
         ADDRESS, and `replyTo` is the channel message id you are answering.\n"
    ));
    if !ctx.may_direct {
        s.push_str(&format!(
            "  You may write `{AUTHORITY_REQUEST}` or `{AUTHORITY_NOTE}`. You do \
             NOT hold an authority charter, so a `{AUTHORITY_DIRECTIVE}` you \
             write is recorded as a `{AUTHORITY_REQUEST}`.\n"
        ));
    } else {
        s.push_str(&format!(
            "  You hold an AUTHORITY charter: a `{AUTHORITY_DIRECTIVE}` you write \
             reaches every member of your team and each of them must reflect it. \
             Use it for what the whole team must do, not for a question.\n"
        ));
    }
    s.push_str(
        "- EVERY charter must appear exactly once, in `dispatch` or in `defer`. \
         A deferral with a reason is a decision; silence is not.\n\n",
    );

    // --- What is already with the operator ---
    //
    // Printed before the charters because it is a CONSTRAINT on the answer, not
    // a fact to reason from: an ask the operator has not answered yet must not
    // be asked again, and a persona that cannot see its open asks will re-raise
    // one every wake for as long as it stays blocked.
    if !ctx.open_asks.is_empty() {
        s.push_str("ALREADY WITH THE OPERATOR (do not ask these again)\n");
        for a in &ctx.open_asks {
            s.push_str(&format!(
                "- [{}] {}{}\n",
                a.kind,
                a.title,
                match a.age_minutes {
                    Some(m) => format!(" — waiting {m} minute(s)"),
                    None => String::new(),
                }
            ));
        }
        s.push('\n');
    }

    // --- What came BACK from the operator ---
    //
    // Beside the open asks, and for the mirror of their reason: an answered
    // ask is an instruction this wake may be holding and the row that carried
    // it is gone from every other list. An approval is not self-executing —
    // the verbs that could act on one (dispatch, the goal verbs, a merge) live
    // in this lane and nowhere else, so if this wake does not carry it out,
    // nothing ever will.
    if !ctx.answered_reviews.is_empty() {
        s.push_str("ANSWERED SINCE YOUR LAST WAKE\n");
        for r in &ctx.answered_reviews {
            s.push_str(&format!(
                "- [{}{}] {}{}\n",
                r.status,
                if r.auto_triaged {
                    " · auto-triaged"
                } else {
                    ""
                },
                r.title,
                r.resolved_at
                    .as_deref()
                    .map(|t| format!(" — {t}"))
                    .unwrap_or_default(),
            ));
            if r.was_ask {
                s.push_str("    this was YOUR ask\n");
            }
            if let Some(notes) = r.notes.as_deref().filter(|n| !n.trim().is_empty()) {
                s.push_str(&format!("    answer: {}\n", notes.replace('\n', " ")));
            }
        }
        s.push_str(
            "An approval that names an ACTION — dispatch this, amend that goal, merge \
             that branch — is yours to carry out THIS wake, through the verbs below; \
             nothing else will. An approval marked `auto-triaged` is the unattended \
             policy clearing a routine queue: it is not a person's decision and it \
             answers no question you asked. A rejection is a constraint, not a \
             failure — do not re-raise the same ask.\n\n",
        );
    }

    // --- What the channel says ---
    //
    // Before the charters, like the open asks and for the same reason: a
    // directive is a CONSTRAINT on the plan, not a fact to reason from. A
    // persona that reads its roster first and the channel afterwards has
    // already decided by the time it is told what it was asked to do.
    if !ctx.channel.is_empty() {
        s.push_str("WHAT THE CHANNEL SAYS (newest first)\n");
        for line in &ctx.channel {
            s.push_str(&format!(
                "- [{}] {}{}{}\n",
                line.authority.as_deref().unwrap_or("unranked"),
                line.from,
                if line.addressed_to_me {
                    " — TO YOU"
                } else {
                    ""
                },
                match line.age_minutes {
                    Some(m) => format!(" — {m} minute(s) ago"),
                    None => String::new(),
                }
            ));
            s.push_str(&format!("    id: {}\n", line.id));
            s.push_str(&format!("    {}\n", line.body.replace('\n', " ")));
        }
        s.push('\n');
    }
    if !ctx.peers.is_empty() {
        s.push_str("WHO YOU CAN ADDRESS (say.to)\n");
        for p in &ctx.peers {
            s.push_str(&format!("- {}: {}\n", p.id, p.name));
        }
        s.push_str(&format!("- {SAY_TO_TEAM}: everyone on your team\n\n"));
    }

    // --- The charters ---
    s.push_str("YOUR CHARTERS\n");
    if ctx.charters.is_empty() {
        s.push_str("(none — dispatch nothing)\n");
    }
    for c in &ctx.charters {
        s.push_str(&format!("- id: {}\n  title: {}\n", c.id, c.title));
        s.push_str(&format!(
            "  priority: {}\n",
            match c.priority {
                Some(p) => p.to_string(),
                None => "none declared — your judgment".to_string(),
            }
        ));
        if let Some(slug) = &c.recipe_slug {
            s.push_str(&format!("  recipe: {slug}\n"));
        }
        if let Some(need) = c.need.as_deref().filter(|n| !n.trim().is_empty()) {
            s.push_str(&format!("  need: {need}\n"));
        }
        if let Some(action) = c.core_action.as_deref().filter(|a| !a.trim().is_empty()) {
            s.push_str(&format!("  core action: {action}\n"));
        }
        let cadence = [
            c.interval_minutes.map(|m| format!("every {m}m at most")),
            c.max_runs_per_day.map(|n| format!("{n} runs/day cap")),
            c.quiet_hours.clone().map(|q| format!("quiet {q}")),
        ]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>();
        if !cadence.is_empty() {
            s.push_str(&format!("  cadence: {}\n", cadence.join(", ")));
        }
        match &c.pacing {
            Some(p) => {
                // The AGE beside the stamp, not instead of it. An absolute
                // instant answers "when"; only the age answers "is this
                // starved", and starvation is the thing the COVERAGE rule
                // above asks the persona to judge (fed0339f).
                s.push_str(&format!(
                    "  coverage: last decided {}, last dispatched {}\n",
                    stamp_with_age(now, p.last_decided_at.as_deref()),
                    stamp_with_age(now, p.last_dispatched_at.as_deref()),
                ));
                if let Some(note) = p.coverage_note.as_deref().filter(|n| !n.trim().is_empty()) {
                    s.push_str(&format!("  your note from last wake: {note}\n"));
                }
            }
            None => s.push_str("  coverage: never decided on\n"),
        }
        s.push_str(&format!(
            "  last run: {}{}\n",
            c.last_started_at.as_deref().unwrap_or("never"),
            c.last_verdict
                .as_deref()
                .map(|v| format!(" ({v})"))
                .unwrap_or_default(),
        ));
        if let Some(d) = &c.last_dispatch {
            s.push_str(&format!(
                "  last dispatch: {} {}{}\n",
                d.at,
                d.state,
                d.summary
                    .as_deref()
                    .filter(|x| !x.trim().is_empty())
                    .map(|x| format!(" — {x}"))
                    .unwrap_or_default(),
            ));
        }
        if c.writes_code {
            s.push_str(
                "  note: this charter authors code. Its run is dispatched into an \
                 ISOLATED git worktree on its own branch — never the operator's \
                 checkout — so say what to change, not where to stand.\n",
            );
        }
    }
    // One line naming the charter that has waited longest, so "do not starve
    // what you keep deferring" is a measurement rather than an instruction to
    // go and measure (fed0339f).
    if let Some(line) = longest_unserved_line(now, &ctx.charters) {
        s.push_str(&line);
    }
    s.push('\n');

    // --- The workspace, for a cross-project holder ---
    //
    // Rendered ONLY for a persona whose charters bind to a workspace (the
    // Architect). Placed before the per-project snapshots because it is the
    // scope those snapshots sit inside: which projects exist, who owns each,
    // what the goals are doing, and how much workforce headroom is left. An
    // App Master carries `workspace: None` and sees this section not at all.
    if let Some(w) = &ctx.workspace {
        s.push_str(&render_workspace_section(
            w,
            may_command(&ctx.charters),
            ctx.home_project.as_ref(),
        ));
    }

    // --- The project(s) ---
    s.push_str("PROJECT STATE\n");
    if ctx.projects.is_empty() {
        s.push_str("(no project state could be read this wake)\n");
    }
    for p in &ctx.projects {
        s.push_str(&format!(
            "- {} ({})\n",
            p.project_name.as_deref().unwrap_or("unnamed project"),
            p.project_id
        ));
        s.push_str(&format!(
            "  accepted ideas with no task: {} · pending ideas: {} (unrated: {})\n",
            p.undispatched_idea_count, p.pending_idea_count, p.unrated_pending_idea_count
        ));
        // The flow, beside the stock. A depth alone tells an owner nothing
        // about whether it is winning: 60 items draining is a healthy project
        // and 12 items filling five times faster is a project about to have
        // 60. This is the number an App Master derived by hand and called its
        // most useful, so the loop now measures it for every project.
        s.push_str(&flow_line(p));
        s.push_str(&goal_lines(p));
        if p.unrated_pending_idea_count > 0 {
            s.push_str(
                "  unrated ideas are never auto-accepted; re-file them with all three scales, \
                 effort, impact and a risk score \
                 (1 documentation or a reversible local change · 2 code behind a test · \
                 3 touches a route, a contract or a schema · 4 touches ledger, settlement \
                 or security semantics · 5 irreversible or external) — risk 1-2 is then \
                 accepted by the project's rule without a human. The filer scores.\n",
            );
        }
        if !p.undispatched_ideas.is_empty() {
            let shown = p.undispatched_ideas.len();
            s.push_str(&format!(
                "  oldest {} of them:\n",
                if shown < p.undispatched_idea_count {
                    format!("{shown} (of {})", p.undispatched_idea_count)
                } else {
                    shown.to_string()
                }
            ));
            for (id, title) in &p.undispatched_ideas {
                s.push_str(&format!("    - {id}: {title}\n"));
            }
            // Unconditional, and it used to hang off the unrated branch above —
            // so a project that did the right thing and scored its whole
            // backlog lost the sentence telling it that the order was its own
            // to choose, and went back to asking a human which item to deliver.
            // Two projects did exactly that within five minutes on 2026-09-09.
            // Authority a persona is only told about while it is behind is not
            // authority.
            s.push_str(&format!(
                "  The order is YOURS: there is no priority key and none is coming — \
                 you group and drain this backlog by your own judgement of effort, \
                 impact and risk, and you do not need to ask which to take next. \
                 A delivery brief may name up to {MAX_DISPATCH_IDEAS} of these ids \
                 when they are one shape and belong on one branch; each id you name \
                 gets its own task row and its own outcome to report, so a batch \
                 leaves nothing behind reading \"accepted, no task\". Name only what \
                 the run will really finish.\n"
            ));
        }
        if p.in_flight_tasks.is_empty() {
            s.push_str("  in flight: nothing\n");
        } else {
            s.push_str(&format!(
                "  in flight ({} task(s) — DO NOT RE-DISPATCH these):\n",
                p.in_flight_tasks.len()
            ));
            for t in &p.in_flight_tasks {
                s.push_str(&format!(
                    "    - {}{} (started {})\n",
                    t.title,
                    t.idea_id
                        .as_deref()
                        .map(|i| format!(" [idea {i}]"))
                        .unwrap_or_default(),
                    t.started_at.as_deref().unwrap_or("not yet — queued"),
                ));
            }
        }
        s.push_str(&unmerged_branch_lines(p));
        s.push_str(&format!(
            "  context map: {} context(s), newest {}\n",
            p.context_count,
            p.context_newest_at.as_deref().unwrap_or("unknown")
        ));
        match p.kpi_coverage_gap {
            Some(n) => s.push_str(&format!("  contexts with no active KPI: {n}\n")),
            None => s.push_str("  KPI coverage: not measured this wake\n"),
        }
    }
    s.push('\n');

    // --- The output contract ---
    s.push_str(&format!(
        "ANSWER WITH ONE JSON OBJECT AND NOTHING ELSE — no prose before or after, \
         no code fence:\n\
         {{\"dispatch\":[{{\"charterId\":\"<one of the ids above>\",\
         \"reason\":\"why this one, this wake\",\
         \"brief\":\"what specifically to do\"}}],\
         \"defer\":[{{\"charterId\":\"...\",\"reason\":\"why it waits\"}}],\
         \"asks\":[{{\"kind\":\"{ASK_ACCEPT_IDEAS}\",\
         \"title\":\"<the question, at most {MAX_ASK_TITLE_CHARS} characters>\",\
         \"why\":\"<why the loop cannot move without it, at most \
         {MAX_ASK_WHY_CHARS} characters>\",\
         \"ideaIds\":[\"<ids copied from the list above>\"],\
         \"options\":[\"<what the operator may choose>\"]}}],\
         \"say\":[{{\"to\":\"{SAY_TO_TEAM}|<a persona id from the list above>\",\
         \"authority\":\"{AUTHORITY_REQUEST}|{AUTHORITY_NOTE}\",\
         \"body\":\"<what you are saying, at most {MAX_SAY_BODY_CHARS} characters>\",\
         \"replyTo\":\"<the channel message id you are answering, or omit>\"}}],\
         \"note\":\"<what your next wake should know about coverage, \
         at most {MAX_NOTE_CHARS} characters>\",\
         \"nextWakeMinutes\":<integer {MIN_NEXT_WAKE_MINUTES}-{MAX_NEXT_WAKE_MINUTES}, \
         or omit this field>}}\n\
         `dispatch` may be empty, and so may `asks` — omit `asks` entirely when \
         nothing needs a person, and `say` when nothing needs saying. \
         Charter ids must be copied exactly from the list above; an invented id \
         is dropped, and so is a `say.to` naming somebody you share no team \
         with.\n"
    ));
    // Appended rather than folded into the object literal above, because the
    // key exists only for a roster that may hire and the literal is shared.
    if may_hire(&ctx.charters) {
        s.push_str(&format!(
            "The same object may carry ONE more optional key, \
             `\"hires\":[{{\"need\":\"<the work, the evidence, and what you would \
             accept as done, at most {MAX_HIRE_NEED_CHARS} characters>\",\
             \"projectId\":\"<omit for your own project>\",\
             \"budgetUsd\":<a number, or omit>}}]`. \
             Omit `hires` entirely — which is the normal answer — unless a \
             responsibility genuinely has no holder.\n"
        ));
    }
    s
}

/// The `YOUR WORKSPACE` block — the Architect's half of the prompt. Pure, and
/// split out of [`render_decision_prompt`] so the section can be asserted on
/// its own and so the App Master's prompt is byte-identical to what it was
/// before this existed.
///
/// Every "not measured" here is literal rather than a zero: a project whose App
/// Master has never decided prints `never decided`, and a workspace with no
/// goals prints `(none)` — not `0% progress`, which would read as a measurement
/// nobody took.
///
/// `may_command` adds the three authority verbs at the end of the section, with
/// their exact JSON shapes and the headroom each is capped by. Rendered only
/// for a roster that holds them, for the reason the HIRE rule is: describing a
/// verb the parser will drop invites the model to spend its answer on a request
/// that cannot land, and then says nothing about why it vanished.
fn render_workspace_section(
    w: &WorkspaceView,
    may_command: bool,
    home: Option<&HomeProject>,
) -> String {
    let mut s = String::new();
    s.push_str(&format!("YOUR WORKSPACE: {} ({})\n", w.name, w.id));
    s.push_str(&format!(
        "- {} of {} personas are running work right now. That ceiling limits how many \
         run AT ONCE; it does not limit how many you may hire or adopt.\n",
        w.active_personas.running, w.active_personas.cap
    ));

    s.push_str(&format!("- projects ({}):\n", w.projects.len()));
    if w.projects.is_empty() {
        s.push_str("    (none — this workspace holds no project yet)\n");
    }
    for p in &w.projects {
        s.push_str(&format!("    - {} ({})\n", p.name, p.id));
        match &p.app_master {
            Some(am) => {
                s.push_str(&format!(
                    "      App Master: {} · next wake {} · {} open ask(s)\n",
                    am.persona_id,
                    am.next_wake_minutes
                        .map(|m| format!("{m}m"))
                        .unwrap_or_else(|| "unset".to_string()),
                    am.open_asks,
                ));
                match am.last_note.as_deref().filter(|n| !n.trim().is_empty()) {
                    Some(note) => s.push_str(&format!("      its last word: {note}\n")),
                    None => s.push_str("      its last word: never decided\n"),
                }
            }
            None => s.push_str("      App Master: NONE — this project has no accountable owner\n"),
        }
    }

    s.push_str(&format!("- goals ({} in the workspace):\n", w.goal_count));
    if w.goals.is_empty() {
        s.push_str("    (none)\n");
    } else {
        if w.goals.len() < w.goal_count {
            s.push_str(&format!(
                "    showing {} of {}:\n",
                w.goals.len(),
                w.goal_count
            ));
        }
        for g in &w.goals {
            let short = &g.id[..g.id.len().min(8)];
            let work = if g.tasks == 0 {
                "no work attached".to_string()
            } else {
                format!("{} task(s), {} completed", g.tasks, g.completed_tasks)
            };
            s.push_str(&format!(
                "    - [{short}] [{}] {} — {} ({}%) · {work}\n",
                g.project_id, g.title, g.status, g.progress
            ));
        }
    }

    // Where the Architect's own output goes. Printed for every workspace holder,
    // licensed or not: a persona that writes documents needs to know where they
    // land, and that is true whether or not it may also create projects.
    match home {
        Some(h) => {
            s.push_str(&format!(
                "- your home: {} ({}) at {}\n",
                h.name, h.id, h.root_path
            ));
            s.push_str(&format!(
                "    Your solution design belongs at {}/docs/solution-design.md. Your run's \
                 working directory IS that repository, so write the file — a design you only \
                 describe in this answer is not a document anybody can read.\n",
                h.root_path
            ));
        }
        None => s.push_str(
            "- your home: NONE — no project is pinned as your home, so a document you write \
             this wake lands in a scratch directory nobody reads. Creating the workspace's \
             first project is what closes that.\n",
        ),
    }

    if may_command {
        s.push_str(&format!(
            "\nWHAT YOU MAY DO TO THE WORKSPACE (you hold an AUTHORITY charter)\n\
             Three more verbs, in the SAME JSON object as `dispatch`. Each is optional; omit \
             the key entirely — which is the normal answer — unless the portfolio needs it.\n\
             - CREATE A PROJECT: \
             `\"createProjects\":[{{\"name\":\"<one directory name, at most \
             {MAX_PROJECT_NAME_CHARS} characters>\",\"description\":\"<what it is for>\",\
             \"techStack\":\"<optional>\",\
             \"template\":\"empty|rust-service|node-service|python-service\"}}]`. \
             At most {MAX_CREATE_PROJECTS} per wake. ONE step does BOTH halves: the repository \
             is git-initialised as a sibling of the projects listed above AND registered as a \
             project of this workspace, so it appears in the list above on your next wake and \
             can be given an owner and goals. It is never a bare folder on disk with no row \
             behind it — that orphan is not a thing this verb can produce. You never name a \
             path.\n\
             - ADOPT AN APP MASTER: \
             `\"adoptAppMasters\":[{{\"project\":\"<an id or a name from the list above>\",\
             \"recipes\":[{{\"slug\":\"<recipe slug>\",\"priority\":1}}],\"enabled\":true}}]`. \
             At most {MAX_ADOPT_APP_MASTERS} per wake, each on {ADOPTED_APP_MASTER_MODEL}. A \
             project above reading `App Master: NONE` is the case this verb exists for. \
             An adoption is never refused for capacity: {free} of {cap} machine slot(s) are \
             free right now, and an App Master adopted onto a full machine is switched ON as \
             asked and waits its turn to wake.\n\
             - SET A GOAL: \
             `\"goals\":[{{\"project\":\"<an id or a name from the list above>\",\
             \"title\":\"<what is to be true, at most {MAX_GOAL_TITLE_CHARS} characters>\",\
             \"description\":\"<optional>\"}}]`. At most {MAX_SET_GOALS} per wake.\n\
             - AMEND A GOAL: `\"goals\":[{{\"id\":\"<a goal id from the list above, or its \
             first eight or more characters>\",\"title\":\"<new wording, optional>\",\
             \"description\":\"<optional>\",\"status\":\"<optional: open · in-progress · \
             awaiting_acceptance · blocked · done>\"}}]`. A goal whose design moved is amended \
             in place, never re-created beside the old one; a goal whose work is done is set \
             `done`. An amendment needs no `project`. Counts against the same {MAX_SET_GOALS}.\n\
             Every `project` is resolved inside THIS workspace, by id or by name, including a \
             project you create in this same answer. A project you cannot name here is one you \
             do not hold.\n",
            free = w
                .active_personas
                .cap
                .saturating_sub(w.active_personas.running),
            cap = w.active_personas.cap,
        ));
    }

    s.push('\n');
    s
}

// ── Tests ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    /// The parse under the CLOSED channel policy: no peer ids known, no
    /// authority granted. Every test written before the channel existed
    /// exercises exactly this, and it is also the honest default for a caller
    /// with no channel — a named `say.to` is dropped and a `directive` is
    /// downgraded. The channel's own behaviour is tested through
    /// [`parse_decision_with`] with a policy that grants something.
    fn parse_decision(
        raw: &str,
        charters: &[DecisionCharter],
        free_capacity: usize,
    ) -> Result<DecisionPlan, DecisionError> {
        parse_decision_with(raw, charters, free_capacity, &SayPolicy::default())
    }

    fn charter(id: &str, priority: Option<u8>) -> DecisionCharter {
        DecisionCharter {
            id: id.into(),
            title: format!("Charter {id}"),
            priority,
            ..Default::default()
        }
    }

    fn roster() -> Vec<DecisionCharter> {
        vec![
            charter("r1", None),
            charter("r2", Some(1)),
            charter("r3", Some(3)),
            charter("r4", None),
        ]
    }

    // -- parse: fences and JSON extraction ---------------------------------

    #[test]
    fn parse_strips_fences_and_surrounding_prose() {
        let raw = "Here is my plan.\n```json\n{\"dispatch\":[{\"charterId\":\"r1\",\
                   \"reason\":\"because\",\"brief\":\"do it\"}],\"defer\":[],\
                   \"note\":\"covered r1\"}\n```\nThat's all.";
        let plan = parse_decision(raw, &roster(), 3).expect("parses");
        assert_eq!(plan.dispatch.len(), 1);
        assert_eq!(plan.dispatch[0].charter_id, "r1");
        assert_eq!(plan.dispatch[0].reason, "because");
        assert_eq!(plan.dispatch[0].brief, "do it");
        assert_eq!(plan.note.as_deref(), Some("covered r1"));

        // Bare object, no fence, no prose.
        let bare = "{\"dispatch\":[{\"charterId\":\"r2\"}]}";
        let plan = parse_decision(bare, &roster(), 3).expect("parses");
        assert_eq!(plan.dispatch.len(), 1);
        // snake_case is accepted as well as the camelCase the prompt asks for.
        let snake = "{\"dispatch\":[{\"charter_id\":\"r2\"}]}";
        assert_eq!(
            parse_decision(snake, &roster(), 3)
                .expect("parses")
                .dispatch[0]
                .charter_id,
            "r2"
        );
        // Absent reason/brief are empty strings, not a parse failure — the
        // dispatch still carries the charter's own standing task text.
        assert_eq!(plan.dispatch[0].reason, "");
        assert_eq!(plan.dispatch[0].brief, "");
    }

    #[test]
    fn parse_rejects_empty_and_unparseable_replies() {
        assert_eq!(parse_decision("", &roster(), 3), Err(DecisionError::Empty));
        assert_eq!(
            parse_decision("   \n  ", &roster(), 3),
            Err(DecisionError::Empty)
        );
        assert!(matches!(
            parse_decision("I could not decide, sorry.", &roster(), 3),
            Err(DecisionError::NoJson(_))
        ));
        assert!(matches!(
            parse_decision("{\"dispatch\": \"not an array\"}", &roster(), 3),
            Err(DecisionError::Malformed(_))
        ));
    }

    // -- parse: unknown ids -------------------------------------------------

    #[test]
    fn parse_drops_unknown_charter_ids_but_keeps_the_known_ones() {
        let raw = "{\"dispatch\":[{\"charterId\":\"nope\"},{\"charterId\":\"r1\"}],\
                   \"defer\":[{\"charterId\":\"ghost\",\"reason\":\"x\"},\
                   {\"charterId\":\"r3\",\"reason\":\"later\"}]}";
        let plan = parse_decision(raw, &roster(), 5).expect("parses");
        assert_eq!(plan.dispatch.len(), 1);
        assert_eq!(plan.dispatch[0].charter_id, "r1");
        assert_eq!(plan.defer.len(), 1);
        assert_eq!(plan.defer[0].charter_id, "r3");
        // Both invented ids are recorded so the ledger shows it happened.
        assert_eq!(plan.dropped_unknown, vec!["nope", "ghost"]);
    }

    #[test]
    fn parse_refuses_a_plan_whose_every_dispatch_id_is_invented() {
        let raw = "{\"dispatch\":[{\"charterId\":\"nope\"},{\"charterId\":\"also-nope\"}]}";
        assert_eq!(
            parse_decision(raw, &roster(), 5),
            Err(DecisionError::NoKnownCharters(vec![
                "nope".into(),
                "also-nope".into()
            ])),
            "a plan that named work and got every id wrong was not reading the roster"
        );
        // …but an EMPTY dispatch list is a legitimate answer, not a failure.
        let plan = parse_decision(
            "{\"dispatch\":[],\"note\":\"nothing worth a slot\"}",
            &roster(),
            5,
        )
        .expect("empty dispatch is a decision");
        assert!(plan.dispatch.is_empty());
        assert_eq!(plan.note.as_deref(), Some("nothing worth a slot"));
    }

    // -- parse: dedupe ------------------------------------------------------

    #[test]
    fn parse_dedupes_by_charter_id_keeping_the_first_mention() {
        let raw = "{\"dispatch\":[{\"charterId\":\"r1\",\"reason\":\"first\"},\
                   {\"charterId\":\"r1\",\"reason\":\"second\"},\
                   {\"charterId\":\" r1 \",\"reason\":\"third, padded\"}]}";
        let plan = parse_decision(raw, &roster(), 5).expect("parses");
        assert_eq!(plan.dispatch.len(), 1);
        assert_eq!(plan.dispatch[0].reason, "first");
    }

    // -- parse: capacity ----------------------------------------------------

    #[test]
    fn parse_caps_dispatch_to_free_capacity_and_reports_the_trim() {
        let raw = "{\"dispatch\":[{\"charterId\":\"r1\"},{\"charterId\":\"r4\"},\
                   {\"charterId\":\"r3\"}]}";
        let plan = parse_decision(raw, &roster(), 2).expect("parses");
        assert_eq!(plan.dispatch.len(), 2);
        assert_eq!(plan.trimmed_for_capacity, 1);

        // Zero capacity dispatches nothing but still parses — the deferrals and
        // the coverage note are still worth writing back.
        let plan = parse_decision(raw, &roster(), 0).expect("parses");
        assert!(plan.dispatch.is_empty());
        assert_eq!(plan.trimmed_for_capacity, 3);
    }

    /// The operator's rule is "at most 2 parallel sessions per project", and a
    /// wake with one fleet worker already in the air has ONE slot left — no
    /// matter how many charters the model names. The dispatch is bounded twice
    /// (the prompt states the number, the parser enforces it) and this is the
    /// half that does not depend on the model reading its instructions.
    #[test]
    fn a_plan_naming_four_charters_dispatches_one_when_a_fleet_worker_holds_a_slot() {
        // max_concurrent = 2, one active fleet worker, no executions
        // → `decide_capacity_from` yields free = 1.
        let free_capacity = 1;
        let raw = "{\"dispatch\":[{\"charterId\":\"r1\"},{\"charterId\":\"r2\"},\
                   {\"charterId\":\"r3\"},{\"charterId\":\"r4\"}]}";
        let plan = parse_decision(raw, &roster(), free_capacity).expect("parses");
        assert_eq!(plan.dispatch.len(), 1, "one slot, one dispatch");
        assert_eq!(plan.trimmed_for_capacity, 3);
        // …and the one it keeps is the highest priority named, not the first.
        assert_eq!(plan.dispatch[0].charter_id, "r2", "priority 1");
    }

    // -- parse: priority ordering -------------------------------------------

    #[test]
    fn parse_puts_explicit_priorities_first_and_leaves_the_rest_in_model_order() {
        // Model order: r1 (none), r3 (prio 3), r4 (none), r2 (prio 1).
        let raw = "{\"dispatch\":[{\"charterId\":\"r1\"},{\"charterId\":\"r3\"},\
                   {\"charterId\":\"r4\"},{\"charterId\":\"r2\"}]}";
        let plan = parse_decision(raw, &roster(), 10).expect("parses");
        let ids: Vec<&str> = plan
            .dispatch
            .iter()
            .map(|i| i.charter_id.as_str())
            .collect();
        assert_eq!(
            ids,
            vec!["r2", "r3", "r1", "r4"],
            "priority 1 then 3, then the unranked pair in the order the model gave them"
        );

        // And the cap is applied AFTER the sort, so a capacity of 1 keeps the
        // highest-priority charter rather than whichever the model listed first.
        let plan = parse_decision(raw, &roster(), 1).expect("parses");
        assert_eq!(plan.dispatch.len(), 1);
        assert_eq!(plan.dispatch[0].charter_id, "r2");
    }

    // -- parse: bounds ------------------------------------------------------

    #[test]
    fn parse_bounds_every_string_it_carries_forward() {
        let long = "x".repeat(5_000);
        let raw = serde_json::json!({
            "dispatch": [{ "charterId": "r1", "reason": long, "brief": long }],
            "defer": [{ "charterId": "r2", "reason": long }],
            "note": long,
        })
        .to_string();
        let plan = parse_decision(&raw, &roster(), 5).expect("parses");
        assert_eq!(plan.dispatch[0].reason.chars().count(), MAX_REASON_CHARS);
        assert_eq!(plan.dispatch[0].brief.chars().count(), MAX_BRIEF_CHARS);
        assert_eq!(plan.defer[0].reason.chars().count(), MAX_REASON_CHARS);
        assert_eq!(
            plan.note.as_ref().unwrap().chars().count(),
            MAX_NOTE_CHARS,
            "an unbounded note would grow the charter's spec one wake at a time"
        );
    }

    // -- parse: the plan's own next wake -----------------------------------

    #[test]
    fn parse_reads_and_clamps_the_plans_chosen_next_wake() {
        let plan_for = |v: &str| {
            parse_decision(
                &format!("{{\"dispatch\":[{{\"charterId\":\"r1\"}}],\"nextWakeMinutes\":{v}}}"),
                &roster(),
                3,
            )
            .expect("parses")
            .next_wake_minutes
        };

        // In range: taken as given.
        assert_eq!(plan_for("15"), Some(15));
        assert_eq!(plan_for("240"), Some(MAX_NEXT_WAKE_MINUTES));
        assert_eq!(plan_for("10"), Some(MIN_NEXT_WAKE_MINUTES));

        // Out of range: CLAMPED, never rejected — the dispatch list survives.
        assert_eq!(plan_for("1"), Some(MIN_NEXT_WAKE_MINUTES));
        assert_eq!(plan_for("0"), Some(MIN_NEXT_WAKE_MINUTES));
        assert_eq!(plan_for("-30"), Some(MIN_NEXT_WAKE_MINUTES));
        assert_eq!(plan_for("100000"), Some(MAX_NEXT_WAKE_MINUTES));

        // The clamp never costs the plan its work.
        let plan = parse_decision(
            "{\"dispatch\":[{\"charterId\":\"r1\"}],\"nextWakeMinutes\":100000}",
            &roster(),
            3,
        )
        .expect("parses");
        assert_eq!(plan.dispatch.len(), 1, "a silly sleep is not a bad plan");

        // snake_case is accepted here too, same as `charter_id`.
        assert_eq!(
            parse_decision("{\"dispatch\":[],\"next_wake_minutes\":90}", &roster(), 3)
                .expect("parses")
                .next_wake_minutes,
            Some(90)
        );
    }

    #[test]
    fn parse_ignores_a_next_wake_that_is_not_an_integer() {
        for v in [
            "\"30 minutes\"",
            "\"30\"",
            "22.5",
            "null",
            "{\"minutes\":30}",
            "[30]",
            "true",
        ] {
            let plan = parse_decision(
                &format!("{{\"dispatch\":[{{\"charterId\":\"r1\"}}],\"nextWakeMinutes\":{v}}}"),
                &roster(),
                3,
            )
            .expect("a bad sleep value must not cost the plan its dispatch");
            assert_eq!(
                plan.next_wake_minutes, None,
                "{v} is not a choice — the previous pacing stands"
            );
            assert_eq!(plan.dispatch.len(), 1, "for {v}");
        }

        // An absent field is the same: silence, not zero.
        assert_eq!(
            parse_decision("{\"dispatch\":[]}", &roster(), 3)
                .expect("parses")
                .next_wake_minutes,
            None
        );
    }

    #[test]
    fn newest_next_wake_takes_the_most_recent_stamp() {
        // The newest stamp wins even when it is not the largest number.
        assert_eq!(
            newest_next_wake_minutes([
                (Some("2026-09-06T10:00:00Z"), Some(200)),
                (Some("2026-09-07T02:00:00Z"), Some(15)),
                (Some("2026-09-05T10:00:00Z"), Some(90)),
            ]),
            Some(15)
        );
        // A charter carrying no choice at all is skipped, not counted as zero.
        assert_eq!(
            newest_next_wake_minutes([
                (Some("2026-09-07T02:00:00Z"), None),
                (Some("2026-09-06T10:00:00Z"), Some(60)),
            ]),
            Some(60)
        );
        // A choice with no stamp sorts oldest but is still an answer.
        assert_eq!(newest_next_wake_minutes([(None, Some(45))]), Some(45));
        assert_eq!(
            newest_next_wake_minutes([(None, Some(45)), (Some("2026-01-01T00:00:00Z"), Some(20))]),
            Some(20)
        );
        // Nothing anywhere is None, never a default.
        assert_eq!(newest_next_wake_minutes([(Some("x"), None)]), None);
        assert_eq!(newest_next_wake_minutes([]), None);
    }

    // -- parse: the asks ----------------------------------------------------

    /// The whole point of the channel: a plan that dispatched nothing still
    /// carries a question, and every field survives the parse intact.
    #[test]
    fn parse_reads_an_ask_beside_an_empty_dispatch() {
        let raw = serde_json::json!({
            "dispatch": [],
            "asks": [{
                "kind": "accept_ideas",
                "title": "27 ideas are waiting on your triage",
                "why": "delivery starves without accepts",
                "ideaIds": ["297f6ba4", "DEADBEEF12"],
                "options": ["Accept all", "Let me pick"],
            }],
            "note": "operator-blocked",
        })
        .to_string();
        let plan = parse_decision(&raw, &roster(), 3).expect("parses");
        assert!(plan.dispatch.is_empty());
        assert_eq!(plan.asks.len(), 1);
        let a = &plan.asks[0];
        assert_eq!(a.kind, ASK_ACCEPT_IDEAS);
        assert_eq!(a.title, "27 ideas are waiting on your triage");
        assert_eq!(a.why, "delivery starves without accepts");
        // Ids are normalised to lower case so the DB prefix match is not
        // case-dependent — the same rule `extract_idea_id_tokens` follows.
        assert_eq!(a.idea_ids, vec!["297f6ba4", "deadbeef12"]);
        assert_eq!(a.options, vec!["Accept all", "Let me pick"]);

        // snake_case rides too, and an absent `asks` is an empty list, never a
        // parse failure.
        let snake = "{\"dispatch\":[],\"asks\":[{\"kind\":\"unblock\",\"title\":\"t\",\
                     \"idea_ids\":[\"aabbccdd\"]}]}";
        assert_eq!(
            parse_decision(snake, &roster(), 3).expect("parses").asks[0].idea_ids,
            vec!["aabbccdd"]
        );
        assert!(parse_decision("{\"dispatch\":[]}", &roster(), 3)
            .expect("parses")
            .asks
            .is_empty());
    }

    #[test]
    fn parse_bounds_every_part_of_an_ask() {
        let long = "x".repeat(5_000);
        let raw = serde_json::json!({
            "dispatch": [],
            "asks": [{
                "kind": "accept_ideas",
                "title": long,
                "why": long,
                // 14 ids, one blank, one repeated, one padded.
                "ideaIds": ["a1", "", "  b2  ", "b2", "c3", "d4", "e5", "f6",
                            "g7", "h8", "i9", "j10", "k11", "l12"],
                "options": (0..12).map(|i| format!("option {i}")).collect::<Vec<_>>(),
            }],
        })
        .to_string();
        let plan = parse_decision(&raw, &roster(), 3).expect("parses");
        let a = &plan.asks[0];
        assert_eq!(a.title.chars().count(), MAX_ASK_TITLE_CHARS);
        assert_eq!(a.why.chars().count(), MAX_ASK_WHY_CHARS);
        assert_eq!(
            a.idea_ids.len(),
            MAX_ASK_IDEA_IDS,
            "an unbounded id list is an unbounded lookup fan-out"
        );
        assert!(!a.idea_ids.iter().any(|i| i.is_empty()));
        assert_eq!(
            a.idea_ids.iter().filter(|i| *i == "b2").count(),
            1,
            "a repeated id is one id"
        );
        assert_eq!(a.options.len(), MAX_ASK_OPTIONS);

        // And a wake may raise at most MAX_ASKS questions.
        let many = serde_json::json!({
            "dispatch": [],
            "asks": (0..9).map(|i| serde_json::json!({ "title": format!("q{i}") }))
                .collect::<Vec<_>>(),
        })
        .to_string();
        assert_eq!(
            parse_decision(&many, &roster(), 3)
                .expect("parses")
                .asks
                .len(),
            MAX_ASKS
        );
    }

    /// An ask with no title is nothing to show a person; an unrecognised kind
    /// is still a question and must not cost the operator the question.
    #[test]
    fn parse_drops_titleless_asks_and_reads_an_unknown_kind_as_a_decision() {
        let raw = serde_json::json!({
            "dispatch": [],
            "asks": [
                { "kind": "accept_ideas", "title": "   ", "why": "no title" },
                { "kind": "escalate", "title": "Which vendor?" },
                { "title": "And this one has no kind at all" },
                // A same kind+title repeat inside one wake asked once.
                { "kind": "decision", "title": "which vendor?" },
            ],
        })
        .to_string();
        let plan = parse_decision(&raw, &roster(), 3).expect("parses");
        assert_eq!(plan.asks.len(), 2, "{:?}", plan.asks);
        assert_eq!(plan.asks[0].kind, ASK_DECISION);
        assert_eq!(plan.asks[0].title, "Which vendor?");
        assert_eq!(plan.asks[1].kind, ASK_DECISION);
    }

    #[test]
    fn an_open_ask_is_recognised_across_case_and_padding() {
        let open = vec![OpenAsk {
            review_id: "rev1".into(),
            kind: ASK_ACCEPT_IDEAS.into(),
            title: "27 ideas are waiting".into(),
            age_minutes: Some(120),
        }];
        assert!(ask_is_open(
            &ask(ASK_ACCEPT_IDEAS, "  27 IDEAS are waiting "),
            &open
        ));
        // A different kind is a different question, even under the same title.
        assert!(!ask_is_open(
            &ask(ASK_UNBLOCK, "27 ideas are waiting"),
            &open
        ));
        assert!(!ask_is_open(
            &ask(ASK_ACCEPT_IDEAS, "something else"),
            &open
        ));
        assert!(!ask_is_open(&ask(ASK_ACCEPT_IDEAS, "anything"), &[]));
    }

    // -- the ask → review mapping ------------------------------------------

    #[test]
    fn an_accept_ideas_ask_becomes_a_review_the_operator_can_act_on() {
        let a = OperatorAsk {
            kind: ASK_ACCEPT_IDEAS.into(),
            title: "27 ideas are waiting on your triage".into(),
            why: "Delivery starves without accepts.".into(),
            idea_ids: vec!["297f6ba4".into()],
            // Options the model wrote are DELIBERATELY ignored for this kind.
            options: vec!["Sure, whatever".into()],
        };
        let ideas = vec![
            (
                "297f6ba4-1c2d-4e5f-8a9b-0c1d2e3f4a5b".to_string(),
                "Retire the legacy shim".to_string(),
            ),
            (
                "aabbccdd-0000-0000-0000-000000000000".to_string(),
                "Ship the retry helper".to_string(),
            ),
        ];
        let r = ask_to_review(&a, "p1", Some("proj_1"), Some("Ascent"), &ideas);

        assert_eq!(
            r.title, "App Master Ascent: 27 ideas are waiting on your triage",
            "the operator must see which surface is speaking"
        );
        assert_eq!(r.severity, "info");
        assert!(r
            .description
            .starts_with("Delivery starves without accepts."));
        assert!(
            r.description.contains("- 297f6ba4: Retire the legacy shim"),
            "the ideas are named by the prefix the app prints: {}",
            r.description
        );
        assert!(r.description.contains("- aabbccdd: Ship the retry helper"));
        assert!(!r.description.ends_with('\n'));

        // The three actions the resolve path keys on — not the model's wording.
        let actions: Vec<String> = serde_json::from_str(&r.suggested_actions).expect("json array");
        assert_eq!(
            actions,
            vec![ASK_ACCEPT_ACTION, ASK_REJECT_ACTION, ASK_LATER_ACTION]
        );

        let ctx: serde_json::Value = serde_json::from_str(&r.context_data).expect("json object");
        assert_eq!(ctx["source"], ASK_SOURCE);
        assert_eq!(ctx["personaId"], "p1");
        assert_eq!(ctx["projectId"], "proj_1");
        assert_eq!(ctx["kind"], ASK_ACCEPT_IDEAS);
        assert_eq!(
            ctx["askTitle"], "27 ideas are waiting on your triage",
            "the unprefixed title is what the duplicate check compares"
        );
        assert_eq!(
            ctx["ideaIds"],
            serde_json::json!([
                "297f6ba4-1c2d-4e5f-8a9b-0c1d2e3f4a5b",
                "aabbccdd-0000-0000-0000-000000000000"
            ]),
            "context_data carries the RESOLVED ids — the resolve path acts on \
             these, so an unresolved id must never reach it"
        );
    }

    #[test]
    fn a_decision_ask_offers_the_options_it_was_given() {
        let a = OperatorAsk {
            kind: ASK_DECISION.into(),
            title: "Postgres or SQLite?".into(),
            why: "Both work; the cost profile differs.".into(),
            idea_ids: vec![],
            options: vec!["Postgres".into(), "SQLite".into()],
        };
        let r = ask_to_review(&a, "p1", Some("proj_1"), None, &[]);
        // No project NAME falls back to the id rather than dropping the prefix.
        assert_eq!(r.title, "App Master proj_1: Postgres or SQLite?");
        assert_eq!(r.description, "Both work; the cost profile differs.");
        let actions: Vec<String> = serde_json::from_str(&r.suggested_actions).expect("json array");
        assert_eq!(actions, vec!["Postgres", "SQLite"]);

        // …and with no project at all the prefix still names the speaker.
        let r = ask_to_review(&a, "p1", None, None, &[]);
        assert_eq!(r.title, "App Master: Postgres or SQLite?");
    }

    // -- the newest coverage note ------------------------------------------

    #[test]
    fn newest_coverage_note_takes_the_most_recent_non_blank_stamp() {
        assert_eq!(
            newest_coverage_note([
                (Some("2026-09-06T10:00:00Z"), Some("older")),
                (Some("2026-09-07T02:00:00Z"), Some("newest")),
                (Some("2026-09-05T10:00:00Z"), Some("oldest")),
            ])
            .as_deref(),
            Some("newest")
        );
        // A blank note is not a note, so it never wins by being newest.
        assert_eq!(
            newest_coverage_note([
                (Some("2026-09-07T02:00:00Z"), Some("   ")),
                (Some("2026-09-06T10:00:00Z"), Some("the real one")),
            ])
            .as_deref(),
            Some("the real one")
        );
        assert_eq!(newest_coverage_note([(Some("x"), None)]), None);
        assert_eq!(newest_coverage_note([]), None);
    }

    #[test]
    fn bound_cuts_on_a_char_boundary() {
        // 4 multi-byte chars; cutting at 2 must not split a code point.
        assert_eq!(bound("äöüß", 2), "äö");
        assert_eq!(bound("äöüß", 9), "äöüß");
    }

    // -- prompt -------------------------------------------------------------

    fn ctx_fixture() -> DecisionContext {
        DecisionContext {
            persona_id: "p1".into(),
            persona_name: "Ascent Master".into(),
            max_concurrent: 3,
            free_capacity: 2,
            running_executions: 0,
            running_fleet: 1,
            // G17: the machine's concurrency ceiling, well below the cap so the
            // fixture's other assertions read the ordinary case. The
            // machine-line tests below vary it.
            active_personas: Some(personas_engine::active_persona_cap::ActivePersonaHeadroom {
                running: 4,
                cap: 10,
            }),
            now_utc: "2026-09-07T02:30:00+00:00".into(),
            // Through the one door for model ids — a dated literal here would
            // rot the fixture the day the id retires.
            model: personas_core::model_ids::DEFAULT_STRONG.into(),
            // The App Master fixture: project-bound, so no workspace section.
            workspace: None,
            charters: vec![
                DecisionCharter {
                    priority: Some(1),
                    recipe_slug: Some("keep-docs-honest".into()),
                    need: Some("docs drift from shipped behaviour".into()),
                    core_action: Some("compare docs to code".into()),
                    interval_minutes: Some(60),
                    pacing: Some(ResponsibilityPacing {
                        last_decided_at: Some("2026-09-06T10:00:00Z".into()),
                        last_dispatched_at: None,
                        coverage_note: Some("docs charter deferred twice".into()),
                        next_wake_minutes: Some(45),
                    }),
                    writes_code: true,
                    last_dispatch: Some(LastDispatch {
                        at: "2026-09-06T10:00:00Z".into(),
                        worker: "fleet".into(),
                        state: DISPATCH_FINISHED.into(),
                        summary: Some("shipped the parser".into()),
                    }),
                    ..charter("r2", Some(1))
                },
                charter("r1", None),
            ],
            projects: vec![ProjectSnapshot {
                project_id: "proj_1".into(),
                project_name: Some("Ascent".into()),
                undispatched_idea_count: 12,
                undispatched_ideas: vec![("idea_a".into(), "Retire the legacy shim".into())],
                in_flight_tasks: vec![InFlightTask {
                    idea_id: Some("idea_b".into()),
                    title: "Wire the connector".into(),
                    started_at: Some("2026-09-07T01:00:00Z".into()),
                }],
                pending_idea_count: 4,
                unrated_pending_idea_count: 0,
                // A quiet project by default, so each flow test states the
                // numbers it is actually about.
                filed_recently: 0,
                delivered_recently: 0,
                failed_recently: 0,
                swept_recently: 0,
                context_count: 208,
                context_newest_at: Some("2026-09-01T00:00:00Z".into()),
                kpi_coverage_gap: Some(41),
                goals: Vec::new(),
                // Nothing waiting on the operator by default: the merge tests
                // below supply their own branches.
                unmerged_branches: Vec::new(),
            }],
            open_asks: Vec::new(),
            // Nothing came back since the last wake either: the 9ef19a00 test
            // supplies its own answers.
            answered_reviews: Vec::new(),
            // The channel is empty in the base fixture on purpose: every
            // prompt assertion written before G3 must keep holding for a
            // persona nobody has spoken to.
            channel: Vec::new(),
            peers: Vec::new(),
            may_direct: false,
            // Project-bound, so it writes into its own codebase and has no home
            // pin. The G13 tests below supply one.
            home_project: None,
        }
    }

    fn ask(kind: &str, title: &str) -> OperatorAsk {
        OperatorAsk {
            kind: kind.into(),
            title: title.into(),
            why: "because".into(),
            ..Default::default()
        }
    }

    #[test]
    fn prompt_shows_in_flight_work_and_the_last_dispatch_outcome() {
        let p = render_decision_prompt(&ctx_fixture());

        // The rule, stated before the data — the same discipline the priority
        // and capacity rules follow.
        assert!(p.contains("is NOT in flight"));
        assert!(p.contains("do not re-dispatch them"));

        // The charter's last dispatch, with the state and what it declared.
        assert!(
            p.contains("last dispatch: 2026-09-06T10:00:00Z finished — shipped the parser"),
            "cycle 1 deferred a charter as in-flight 25 minutes after its \
             session reported done; the prompt must carry the end state:\n{p}"
        );
        // A charter never dispatched by the decide lane says nothing at all,
        // rather than an invented "unknown".
        assert_eq!(
            p.matches("last dispatch:").count(),
            1,
            "only the charter that HAS one reports one"
        );

        // The project's own in-flight work.
        assert!(p.contains("in flight (1 task(s)"));
        assert!(p.contains("Wire the connector [idea idea_b] (started 2026-09-07T01:00:00Z)"));
    }

    #[test]
    fn a_project_with_nothing_running_says_so_explicitly() {
        let mut ctx = ctx_fixture();
        ctx.projects[0].in_flight_tasks.clear();
        let p = render_decision_prompt(&ctx);
        assert!(
            p.contains("in flight: nothing"),
            "a measured empty is not the same as an absent line"
        );
    }

    #[test]
    fn a_queued_in_flight_task_says_it_has_not_started() {
        let mut ctx = ctx_fixture();
        ctx.projects[0].in_flight_tasks = vec![InFlightTask {
            idea_id: None,
            title: "Sweep the census".into(),
            started_at: None,
        }];
        let p = render_decision_prompt(&ctx);
        assert!(p.contains("Sweep the census (started not yet — queued)"));
        assert!(!p.contains("[idea "), "no idea id means no bracket at all");
    }

    // -- idea-id extraction (pure) ------------------------------------------

    /// The first candidate only. Production reads every id a brief names; these
    /// cases are about which one comes FIRST, which is the property the
    /// single-idea era depended on and the batch era must not break.
    fn first_idea_id_token(text: &str) -> Option<String> {
        extract_idea_id_tokens(text).into_iter().next()
    }

    #[test]
    fn extract_idea_id_prefers_a_full_uuid_and_accepts_a_printed_prefix() {
        let uuid = "297f6ba4-1c2d-4e5f-8a9b-0c1d2e3f4a5b";
        assert_eq!(
            first_idea_id_token(&format!("Deliver idea {uuid} on its own branch.")),
            Some(uuid.to_string())
        );
        // The 8-char prefix the app prints everywhere.
        assert_eq!(
            first_idea_id_token("Deliver the accepted idea 297f6ba4 (the retry helper)."),
            Some("297f6ba4".into())
        );
        // A full uuid beats a bare prefix even when the prefix comes first.
        assert_eq!(
            first_idea_id_token(&format!("deadbeef … but really {uuid}")),
            Some(uuid.to_string())
        );
        // Case is normalised so the DB prefix match is not case-dependent.
        assert_eq!(
            first_idea_id_token("idea 297F6BA4"),
            Some("297f6ba4".into())
        );
    }

    #[test]
    fn extract_idea_id_returns_nothing_when_the_brief_names_no_id() {
        assert_eq!(first_idea_id_token(""), None);
        assert_eq!(
            first_idea_id_token("Review the overview dashboard and tighten its loading states."),
            None
        );
        // Too short to be anything anybody printed.
        assert_eq!(first_idea_id_token("see face and bad"), None);
        assert!(extract_idea_id_tokens("see face and bad").is_empty());
    }

    #[test]
    fn extract_idea_id_tokens_reads_a_whole_batch_and_collapses_repeats() {
        let uuid = "297f6ba4-1c2d-4e5f-8a9b-0c1d2e3f4a5b";

        // The shape an App Master actually writes when it batches.
        assert_eq!(
            extract_idea_id_tokens(
                "Batch c285ef9f, 9b85968e and d394346a onto one branch (base 1ed7e43c)."
            ),
            vec!["c285ef9f", "9b85968e", "d394346a", "1ed7e43c"],
            "every hex-shaped token is a CANDIDATE; the sha is dropped by failing \
             to resolve, not by being guessed at here"
        );

        // A uuid and its own prefix are one idea written twice, not two.
        assert_eq!(
            extract_idea_id_tokens(&format!("{uuid} — that is 297f6ba4")),
            vec![uuid.to_string()]
        );

        // A prefix of a DIFFERENT id survives beside a full uuid.
        assert_eq!(
            extract_idea_id_tokens(&format!("{uuid} and also deadbeef")),
            vec![uuid.to_string(), "deadbeef".to_string()]
        );

        // Naming one id twice is emphasis.
        assert_eq!(
            extract_idea_id_tokens("297f6ba4 … and again 297F6BA4"),
            vec!["297f6ba4".to_string()]
        );

        // The singular reader keeps its old answer in every case above.
        assert_eq!(
            first_idea_id_token(&format!("deadbeef … but really {uuid}")),
            Some(uuid.to_string())
        );
    }

    #[test]
    fn prompt_states_the_priority_rule_capacity_and_every_charter_id() {
        let p = render_decision_prompt(&ctx_fixture());

        // The standing question and the persona's own name.
        assert!(p.contains("which of my responsibilities moves this project"));
        assert!(p.contains("Ascent Master"));

        // The priority rule, including what an ABSENT priority means — the
        // half a model gets wrong if you only tell it "1 is highest".
        assert!(p.contains("1 = highest"));
        assert!(p.contains("nobody ranked it and the judgment is yours"));
        assert!(p.contains("none declared — your judgment"), "for r1");
        assert!(p.contains("priority: 1"), "for r2");

        // Capacity, as a number the parser will actually enforce.
        assert!(p.contains("AT MOST 2 charter(s)"));
        assert!(p.contains("your parallel capacity is 3"));

        // Every charter id is present and copyable.
        assert!(p.contains("id: r1"));
        assert!(p.contains("id: r2"));

        // Coverage memory from the previous wake.
        assert!(p.contains("docs charter deferred twice"));
        assert!(p.contains("last decided 2026-09-06T10:00:00Z"));
        assert!(p.contains("last dispatched never"));
        assert!(p.contains("coverage: never decided on"), "for r1");

        // Project state, including the numbers.
        assert!(p.contains("accepted ideas with no task: 12"));
        assert!(p.contains("pending ideas: 4"));
        assert!(p.contains("idea_a: Retire the legacy shim"));
        assert!(p.contains("208 context(s)"));
        assert!(p.contains("contexts with no active KPI: 41"));

        // The code-authoring charter is told where its run will stand.
        assert!(p.contains("ISOLATED git worktree"));

        // The output contract, matching what `parse_decision` reads.
        assert!(p.contains("ONE JSON OBJECT"));
        assert!(p.contains("\"charterId\""));
        assert!(p.contains("\"dispatch\""));
        assert!(p.contains("\"defer\""));
        assert!(p.contains(&MAX_NOTE_CHARS.to_string()));
    }

    /// G27: an unrated pending idea is invisible to `dev_triage_rules`
    /// (`risk >= 1 AND risk < 3`), so it can only move by a human reading the
    /// backlog. The decide lane has to SHOW that number, or the persona reads
    /// "93 pending" and opens an ask instead of re-filing with a score.
    #[test]
    fn prompt_names_the_unrated_share_of_the_backlog() {
        let mut ctx = ctx_fixture();
        ctx.projects[0].unrated_pending_idea_count = 3;
        let p = render_decision_prompt(&ctx);
        assert!(p.contains("pending ideas: 4 (unrated: 3)"), "{p}");
        assert!(
            p.contains("unrated ideas are never auto-accepted; re-file them with all three scales"),
            "{p}"
        );

        // Nothing unrated — the advice is absent rather than a standing 0.
        let clean = render_decision_prompt(&ctx_fixture());
        assert!(clean.contains("pending ideas: 4 (unrated: 0)"));
        assert!(!clean.contains("unrated ideas are never auto-accepted"));
    }

    /// The stock said how deep the pile was and nothing said which way it was
    /// moving. Measured 2026-09-09 across the six bank projects: 386 ideas
    /// filed in a day against 88 tasks completed, 553 accepted with no task —
    /// and every App Master could see its depth while none could see its rate.
    #[test]
    fn the_prompt_states_the_backlog_flow_and_names_the_imbalance() {
        let mut ctx = ctx_fixture();
        ctx.projects[0].filed_recently = 40;
        ctx.projects[0].delivered_recently = 8;
        let p = render_decision_prompt(&ctx);
        assert!(
            p.contains("backlog flow (last 24h): 40 filed · 8 delivered · 0 failed (5.0:1)"),
            "{p}"
        );
        assert!(p.contains("growing 5.0x faster than it drains"));
        // The duty is named as the owner's, not enforced by the platform.
        assert!(p.contains("YOUR call and nobody else's"));
        assert!(p.contains("Prefer the charter that DELIVERS"));
    }

    /// fed0339f: the prompt says how STALE each coverage stamp is, names the
    /// charter nobody has served longest, and — when the platform stopped the
    /// whole loop — says so, so the silence is not read as evidence.
    #[test]
    fn staleness_and_a_held_loop_are_stated_not_left_to_arithmetic() {
        let mut ctx = ctx_fixture();
        let p = render_decision_prompt(&ctx);
        assert!(
            p.contains("last decided 2026-09-06T10:00:00Z (16h 30m ago)"),
            "{p}"
        );
        assert!(p.contains("last dispatched never"), "{p}");
        assert!(
            p.contains("LONGEST UNSERVED: \"Charter r2\" has NEVER been dispatched."),
            "{p}"
        );
        assert!(!p.contains("LOOP HELD"), "nothing was held: {p}");

        // The loop was stopped for three days and is still stopped.
        ctx.loop_hold = Some(LoopHoldNote {
            kind: "usage_quota".into(),
            started_at: "2026-09-04T00:00:00Z".into(),
            ended_at: None,
            detail: "7d window at 95% of a 90% stop".into(),
        });
        let p = render_decision_prompt(&ctx);
        assert!(
            p.contains(
                "LOOP HELD: the whole attention loop was stopped (usage_quota) from \
                 2026-09-04T00:00:00Z and it is STILL HELD as you read this"
            ),
            "{p}"
        );
        assert!(p.contains("UNOBSERVED, not as evidence"), "{p}");

        // Never-dispatched outranks any age: once r2 has been served, the
        // charter that never has is the starved one.
        ctx.charters[0].pacing = Some(ResponsibilityPacing {
            last_dispatched_at: Some("2026-09-05T02:30:00Z".into()),
            ..Default::default()
        });
        let p = render_decision_prompt(&ctx);
        assert!(
            p.contains("LONGEST UNSERVED: \"Charter r1\" has NEVER been dispatched."),
            "{p}"
        );
        assert!(
            p.contains("last dispatched 2026-09-05T02:30:00Z (2d 0h ago)"),
            "{p}"
        );
    }

    #[test]
    fn a_duration_is_phrased_at_the_coarsest_honest_unit() {
        assert_eq!(duration_phrase(0), "just now");
        assert_eq!(duration_phrase(45), "45m");
        assert_eq!(duration_phrase(320), "5h 20m");
        assert_eq!(duration_phrase(4560), "3d 4h");
        assert_eq!(
            age_phrase("2026-09-07T02:30:00+00:00", "2026-09-07T01:30:00+00:00").as_deref(),
            Some("1h 0m ago")
        );
        // Unparseable, and a stamp in the future: no age rather than a wrong one.
        assert_eq!(age_phrase("2026-09-07T02:30:00+00:00", "yesterday"), None);
        assert_eq!(
            age_phrase("2026-09-07T02:30:00+00:00", "2026-09-08T02:30:00+00:00"),
            None
        );
    }

    /// 9ef19a00: an answered review is rendered where the wake that can act on
    /// it will read it, and a policy's approval is never dressed as a person's.
    #[test]
    fn answered_reviews_are_rendered_with_who_answered_them() {
        let mut ctx = ctx_fixture();
        ctx.answered_reviews = vec![
            AnsweredReview {
                title: "May I merge autopilot/deliver-parser?".into(),
                status: "approved".into(),
                notes: Some("Yes — rebase first".into()),
                was_ask: true,
                auto_triaged: false,
                resolved_at: Some("2026-09-15T09:00:00+00:00".into()),
            },
            AnsweredReview {
                title: "Check the output".into(),
                status: "approved".into(),
                notes: None,
                was_ask: false,
                auto_triaged: true,
                resolved_at: None,
            },
        ];
        let p = render_decision_prompt(&ctx);
        assert!(p.contains("ANSWERED SINCE YOUR LAST WAKE"), "{p}");
        assert!(
            p.contains(
                "- [approved] May I merge autopilot/deliver-parser? — 2026-09-15T09:00:00+00:00"
            ),
            "{p}"
        );
        assert!(p.contains("this was YOUR ask"), "{p}");
        assert!(p.contains("answer: Yes — rebase first"), "{p}");
        assert!(
            p.contains("- [approved · auto-triaged] Check the output"),
            "{p}"
        );
        assert!(p.contains("yours to carry out THIS wake"), "{p}");
        assert!(p.contains("not a person's decision"), "{p}");

        // Nothing came back: no block at all.
        ctx.answered_reviews.clear();
        let p = render_decision_prompt(&ctx);
        assert!(!p.contains("ANSWERED SINCE YOUR LAST WAKE"), "{p}");
    }

    /// 733b83b5: branches the persona's own workers authored and nobody merged
    /// are named, with the drift both ways and the charter that cut each — and
    /// the rule that says what to do while they wait.
    #[test]
    fn branches_awaiting_a_human_merge_are_named_with_the_charter_that_cut_them() {
        let mut ctx = ctx_fixture();
        ctx.projects[0].unmerged_branches = vec![
            UnmergedBranch {
                branch: "autopilot/deliver-parser".into(),
                main: "main".into(),
                ahead: 3,
                behind: 12,
                tip_at: Some("2026-09-14T08:00:00+00:00".into()),
                charter_title: Some("Deliver an accepted idea".into()),
            },
            UnmergedBranch {
                branch: "autopilot/older".into(),
                main: "main".into(),
                ahead: 1,
                behind: 0,
                tip_at: None,
                charter_title: None,
            },
        ];
        let p = render_decision_prompt(&ctx);
        assert!(p.contains("AWAITING A HUMAN MERGE (2)"), "{p}");
        assert!(
            p.contains(
                "autopilot/deliver-parser — 3 ahead, 12 behind main, tip \
                 2026-09-14T08:00:00+00:00 [your charter \"Deliver an accepted idea\"]"
            ),
            "{p}"
        );
        // A branch no ledger row names still prints — without a charter and
        // without a tip it does not have.
        assert!(
            p.contains("autopilot/older — 1 ahead, 0 behind main\n"),
            "{p}"
        );
        assert!(
            p.contains("Reconcile a branch before cutting another one"),
            "{p}"
        );
        assert!(p.contains("prefer landing readiness"), "{p}");

        // Nothing waiting: no block, and above all no reassurance the loop
        // never measured (an unreadable repository lands here too).
        ctx.projects[0].unmerged_branches.clear();
        let p = render_decision_prompt(&ctx);
        assert!(!p.contains("AWAITING A HUMAN MERGE"), "{p}");
        assert!(!p.contains("landing readiness"), "{p}");
    }

    /// A project that keeps up is told so, without advice it does not need.
    #[test]
    fn a_balanced_project_is_not_lectured() {
        let mut ctx = ctx_fixture();
        ctx.projects[0].filed_recently = 6;
        ctx.projects[0].delivered_recently = 9;
        let p = render_decision_prompt(&ctx);
        assert!(
            p.contains("6 filed · 9 delivered · 0 failed (0.7:1)"),
            "{p}"
        );
        assert!(p.contains("draining as fast as it fills or faster"));
        assert!(!p.contains("YOUR call and nobody else's"));
    }

    /// 2026-09-15: failures a SWEEP wrote (the worker was gone) are named as
    /// the platform's event with the ideas already back in the backlog, and
    /// they do not count toward the failure finding a run's failures owe.
    /// bank-edge read 26 failed / 20 delivered on 2026-09-14 — 21 of the 26
    /// were swept after app restarts, and the prompt sent it hunting its briefs.
    #[test]
    fn swept_failures_are_named_as_the_platforms_event_and_do_not_owe_a_cause() {
        let mut ctx = ctx_fixture();
        ctx.projects[0].filed_recently = 10;
        ctx.projects[0].delivered_recently = 20;
        ctx.projects[0].failed_recently = 26;
        ctx.projects[0].swept_recently = 21;
        let p = render_decision_prompt(&ctx);
        assert!(p.contains("10 filed · 20 delivered · 26 failed"), "{p}");
        assert!(p.contains("21 of the 26 failed were SWEPT, not run"), "{p}");
        assert!(
            p.contains("re-take those ideas, do not diagnose them"),
            "{p}"
        );
        // 5 run failures against 20 delivered: no failure finding is owed.
        assert!(!p.contains("MORE TASKS FAILED THAN COMPLETED"), "{p}");

        // …and when the run failures alone still outnumber deliveries, the
        // finding is owed for THOSE, counted without the swept rows.
        ctx.projects[0].delivered_recently = 3;
        let p = render_decision_prompt(&ctx);
        assert!(
            p.contains("MORE TASKS FAILED THAN COMPLETED in the window (5 of 8)"),
            "{p}"
        );
    }

    /// AC-FLOW-2 (G41): a project failing more tasks than it completes is
    /// told the failure cause is the finding it owes, BEFORE the ratio.
    /// bank-platform sat at 7 completed / 21 failed on 2026-09-10 and the
    /// ratio alone would have told it to deliver harder.
    #[test]
    fn a_project_failing_more_than_it_completes_is_told_so_before_the_ratio() {
        let mut ctx = ctx_fixture();
        ctx.projects[0].filed_recently = 35;
        ctx.projects[0].delivered_recently = 7;
        ctx.projects[0].failed_recently = 21;
        let p = render_decision_prompt(&ctx);
        assert!(p.contains("35 filed · 7 delivered · 21 failed"), "{p}");
        let failed_at = p
            .find("MORE TASKS FAILED THAN COMPLETED")
            .expect("the sentence");
        let ratio_at = p
            .find("growing 5.0x faster")
            .expect("the ratio still prints");
        assert!(failed_at < ratio_at, "the failure finding comes first");
        assert!(p.contains("(21 of 28)"), "{p}");

        // Fewer failed than completed: no such sentence.
        ctx.projects[0].failed_recently = 3;
        let p = render_decision_prompt(&ctx);
        assert!(!p.contains("MORE TASKS FAILED"), "{p}");
    }

    /// G41: the project's goals print with the work naming each, and a goal
    /// nothing names says so — the state the Architect measured on
    /// 2026-09-10 (0 of 432 tasks carrying a goal) is printed as a fact.
    #[test]
    fn the_prompt_prints_each_goal_with_the_work_attached_to_it() {
        let mut ctx = ctx_fixture();
        let p = render_decision_prompt(&ctx);
        assert!(p.contains("goals: (none set on this project)"), "{p}");

        ctx.projects[0].goals = vec![
            ProjectGoalLine {
                id: "4a585854-2f5f-44ed-9072-be60f1cdf7b1".into(),
                title: "A signature is an AdES over the contract digest".into(),
                status: "in-progress".into(),
                ideas: 0,
                tasks: 0,
                completed_tasks: 0,
            },
            ProjectGoalLine {
                id: "2a05a351-b801-4be4-b770-5b2d5fe97804".into(),
                title: "A gate manifest declares every gate".into(),
                status: "open".into(),
                ideas: 4,
                tasks: 3,
                completed_tasks: 1,
            },
        ];
        let p = render_decision_prompt(&ctx);
        assert!(p.contains("goals (2)"), "{p}");
        assert!(
            p.contains("[4a585854] A signature is an AdES over the contract digest — in-progress · no work attached"),
            "{p}"
        );
        assert!(
            p.contains("[2a05a351] A gate manifest declares every gate — open · 4 idea(s), 3 task(s), 1 completed"),
            "{p}"
        );
        assert!(
            p.contains("propose_backlog.goal"),
            "the filer is told how to name one"
        );
    }

    /// G41: the `goals` verb reads an amendment — a goal id with any of a
    /// new title, description or status — beside the create form, and drops
    /// an amendment that changes nothing.
    #[test]
    fn parse_reads_a_goal_amendment_beside_a_creation() {
        let reply = serde_json::json!({
            "goals": [
                { "id": "4a585854", "status": "done" },
                { "goalId": "2a05a351-b801", "title": "A gate manifest declares every gate" },
                { "id": "deadbeef" },
                { "project": "ledger-service", "title": "Every movement reconciles" },
                { "id": "4a585854", "description": "twice in one wake is once" },
            ],
        })
        .to_string();
        let plan = parse_decision(&reply, &authority_roster(), 3).expect("parses");
        assert_eq!(plan.goals.len(), 3, "{:?}", plan.goals);
        assert_eq!(plan.goals[0].id.as_deref(), Some("4a585854"));
        assert_eq!(plan.goals[0].status.as_deref(), Some("done"));
        assert!(plan.goals[0].title.is_empty(), "the wording stands");
        assert_eq!(
            plan.goals[1].id.as_deref(),
            Some("2a05a351-b801"),
            "goalId is accepted"
        );
        assert_eq!(plan.goals[1].title, "A gate manifest declares every gate");
        assert!(plan.goals[2].id.is_none(), "the create form is untouched");
        assert_eq!(plan.goals[2].project, "ledger-service");
    }

    /// Delivering nothing is not a ratio — dividing by it would be — and it is
    /// the one case that most needs saying plainly.
    #[test]
    fn delivering_nothing_is_said_plainly_rather_than_divided_by() {
        let mut ctx = ctx_fixture();
        ctx.projects[0].filed_recently = 17;
        ctx.projects[0].delivered_recently = 0;
        let p = render_decision_prompt(&ctx);
        assert!(
            p.contains("17 filed · 0 delivered · 0 failed — NOTHING DELIVERED"),
            "{p}"
        );
        assert!(
            !p.contains(":1)"),
            "no ratio is printed when the divisor is zero"
        );
    }

    /// A silent project reads as silent, not as a project that filed nothing
    /// against a delivery it also did not make.
    #[test]
    fn a_project_with_no_movement_says_so() {
        let p = render_decision_prompt(&ctx_fixture());
        assert!(p.contains("nothing filed, nothing delivered"), "{p}");
    }

    /// The owner decided on 2026-09-09 that the App Master groups and drains
    /// its own backlog, and the sentence saying so hung off the UNRATED
    /// branch — so a project that scored its whole backlog lost the only
    /// place it was told the order was its own, and went back to asking a
    /// human which item to take next. Two did, five minutes apart. This is
    /// the regression test for authority that only appears while a persona
    /// is behind.
    #[test]
    fn prompt_grants_the_backlog_order_whether_or_not_anything_is_unrated() {
        for unrated in [0_usize, 3] {
            let mut ctx = ctx_fixture();
            ctx.projects[0].unrated_pending_idea_count = unrated;
            let p = render_decision_prompt(&ctx);
            assert!(
                p.contains("The order is YOURS"),
                "unrated={unrated}: the standing grant must not depend on the backlog's state"
            );
            assert!(p.contains("you do not need to ask which to take next"));
            // And the batching allowance travels with it, since a batch is how
            // the order gets drained faster than one item per wake.
            assert!(p.contains(&format!("may name up to {MAX_DISPATCH_IDEAS} of these ids")));
        }
    }

    /// The CAPACITY line must show the persona WHERE its missing slots went.
    /// Before 2026-09-07 a fleet worker was in nobody's count, so a persona
    /// could read "2 free" while two of its own workers were on screen in the
    /// fleet grid — and the only thing keeping it to its limit was its own
    /// reading of the ledger.
    #[test]
    fn prompt_breaks_capacity_down_into_executions_and_fleet_workers() {
        let mut ctx = ctx_fixture();
        ctx.max_concurrent = 2;
        ctx.free_capacity = 1;
        ctx.running_executions = 0;
        ctx.running_fleet = 1;
        let p = render_decision_prompt(&ctx);
        assert!(
            p.contains(
                "AT MOST 1 charter(s) this wake (your parallel capacity is 2; 0 \
                 execution(s) and 1 fleet worker(s) of yours are running)"
            ),
            "{p}"
        );

        // Both halves are printed, including an idle one — "0 of each" is the
        // statement that nothing is holding a slot, which is not the same as
        // saying nothing.
        let mut ctx = ctx_fixture();
        ctx.running_executions = 2;
        ctx.running_fleet = 0;
        let p = render_decision_prompt(&ctx);
        assert!(
            p.contains("2 execution(s) and 0 fleet worker(s) of yours are running"),
            "{p}"
        );
    }

    /// G17: the SECOND ceiling, and a different KIND. `free_capacity` is how
    /// much work THIS persona may start; the machine line is how many personas
    /// may be running at once app-wide. It must not read as a headcount limit —
    /// it did until 2026-09-08 and that is what stalled the simulation.
    #[test]
    fn prompt_states_the_app_wide_concurrency_ceiling() {
        let ctx = ctx_fixture();
        let p = render_decision_prompt(&ctx);
        assert!(
            p.contains("- MACHINE: 4 of 10 personas are running work right now (6 slot(s) free)"),
            "{p}"
        );
        assert!(
            p.contains("never the size of the organisation"),
            "the line must say what it does NOT limit: {p}"
        );

        // At the cap the line says zero free and names the real consequence —
        // waiting, not refusal.
        let mut full = ctx_fixture();
        full.active_personas = Some(personas_engine::active_persona_cap::ActivePersonaHeadroom {
            running: 10,
            cap: 10,
        });
        let p = render_decision_prompt(&full);
        assert!(
            p.contains("10 of 10 personas are running work right now (0 slot(s) free)"),
            "{p}"
        );
        assert!(
            p.contains("waits for a slot instead of running now"),
            "a full machine costs waiting, not refusal: {p}"
        );
        assert!(
            !p.contains("refused at adoption"),
            "adoption is never refused for capacity any more: {p}"
        );
    }

    /// A count that could not be read prints NOTHING rather than a fabricated
    /// "0 of 10" — the prompt's own standing rule for the clock and for
    /// `lastDecidedAt`, applied to the machine line.
    #[test]
    fn an_unreadable_running_count_omits_the_line_entirely() {
        let mut ctx = ctx_fixture();
        ctx.active_personas = None;
        let p = render_decision_prompt(&ctx);
        assert!(!p.contains("- MACHINE:"), "{p}");
        // The capacity line it sits under is untouched.
        assert!(p.contains("- CAPACITY:"), "{p}");
    }

    #[test]
    fn prompt_never_prints_a_figure_it_did_not_measure() {
        let mut ctx = ctx_fixture();
        ctx.projects[0].kpi_coverage_gap = None;
        ctx.projects[0].context_newest_at = None;
        let p = render_decision_prompt(&ctx);
        assert!(p.contains("KPI coverage: not measured this wake"));
        assert!(!p.contains("contexts with no active KPI: 0"));
        assert!(p.contains("newest unknown"));
    }

    #[test]
    fn prompt_is_honest_about_unlimited_concurrency_and_an_empty_roster() {
        let mut ctx = ctx_fixture();
        ctx.max_concurrent = 0;
        ctx.charters.clear();
        ctx.projects.clear();
        let p = render_decision_prompt(&ctx);
        assert!(p.contains("parallel capacity is unlimited"));
        assert!(p.contains("(none — dispatch nothing)"));
        assert!(p.contains("(no project state could be read this wake)"));
    }

    /// The persona cannot reason about elapsed time without a "now", and it
    /// cannot pace itself without seeing what it last chose.
    #[test]
    fn prompt_shows_the_clock_and_the_sleep_the_persona_last_chose() {
        let p = render_decision_prompt(&ctx_fixture());
        assert!(
            p.contains("RIGHT NOW (UTC): 2026-09-07T02:30:00+00:00"),
            "{p}"
        );
        assert!(
            p.contains("You chose to sleep 45 minutes after your last wake."),
            "{p}"
        );

        // The rule and the field are both stated, with the same bounds the
        // parser enforces.
        assert!(p.contains("`nextWakeMinutes`"));
        assert!(p.contains("Omit the field to keep your current pacing"));
        assert!(
            p.contains("\"nextWakeMinutes\""),
            "the JSON skeleton carries it"
        );
        assert!(p.contains(&MIN_NEXT_WAKE_MINUTES.to_string()));
        assert!(p.contains(&MAX_NEXT_WAKE_MINUTES.to_string()));
    }

    #[test]
    fn prompt_prints_no_clock_and_no_sleep_it_was_not_given() {
        let mut ctx = ctx_fixture();
        ctx.now_utc = String::new();
        for c in &mut ctx.charters {
            if let Some(p) = c.pacing.as_mut() {
                p.next_wake_minutes = None;
            }
        }
        let p = render_decision_prompt(&ctx);
        assert!(!p.contains("RIGHT NOW"), "an unread clock prints nothing");
        assert!(
            !p.contains("You chose to sleep"),
            "no previous choice is not a choice of zero"
        );
        // The RULE still stands — it is what asks for the next one.
        assert!(p.contains("YOUR NEXT WAKE"));
    }

    /// The rule and the field must both be stated, or a persona that is blocked
    /// on a person has been told to ask and given nowhere to put the ask.
    #[test]
    fn prompt_states_the_ask_rule_and_the_ask_field() {
        let p = render_decision_prompt(&ctx_fixture());
        assert!(p.contains("ASK WHEN BLOCKED"), "{p}");
        assert!(p.contains("Do not ask for what you can decide yourself"));
        assert!(p.contains("Do not repeat an ask that is still open"));
        assert!(p.contains(ASK_ACCEPT_IDEAS));
        assert!(p.contains(ASK_UNBLOCK));
        // The JSON skeleton the parser actually reads.
        assert!(p.contains("\"asks\""));
        assert!(p.contains("\"ideaIds\""));
        assert!(p.contains("omit `asks` entirely when nothing needs a person"));
    }

    /// "Do not repeat an ask that is still open" is only actionable if the
    /// persona can see which asks ARE still open.
    #[test]
    fn prompt_lists_the_asks_already_with_the_operator() {
        let mut ctx = ctx_fixture();
        ctx.open_asks = vec![
            OpenAsk {
                review_id: "rev1".into(),
                kind: ASK_ACCEPT_IDEAS.into(),
                title: "27 ideas are waiting on your triage".into(),
                age_minutes: Some(310),
            },
            OpenAsk {
                review_id: "rev2".into(),
                kind: ASK_UNBLOCK.into(),
                title: "Grant push access to origin".into(),
                age_minutes: None,
            },
        ];
        let p = render_decision_prompt(&ctx);
        assert!(p.contains("ALREADY WITH THE OPERATOR (do not ask these again)"));
        assert!(
            p.contains(
                "- [accept_ideas] 27 ideas are waiting on your triage — waiting 310 minute(s)"
            ),
            "{p}"
        );
        // An age nobody could compute prints no age, not a fabricated zero.
        assert!(
            p.contains("- [unblock] Grant push access to origin\n"),
            "{p}"
        );
        assert!(!p.contains("waiting 0 minute(s)"));

        // With nothing open the section is absent entirely rather than an
        // empty heading the model has to interpret.
        assert!(!render_decision_prompt(&ctx_fixture()).contains("ALREADY WITH THE OPERATOR"));
    }

    // -- G3/G11: the channel ------------------------------------------------

    fn open_policy() -> SayPolicy {
        SayPolicy {
            peer_ids: vec!["architect".into(), "sibling".into()],
            may_direct: false,
        }
    }

    fn say_reply(raw: &str, policy: &SayPolicy) -> DecisionPlan {
        parse_decision_with(raw, &roster(), 3, policy).expect("parses")
    }

    #[test]
    fn parse_say_bounds_the_list_the_body_and_the_vocabulary() {
        let long = "x".repeat(MAX_SAY_BODY_CHARS + 50);
        let raw = serde_json::json!({
            "dispatch": [],
            "say": [
                { "to": "team", "authority": "note", "body": "starting on the ledger" },
                { "to": "architect", "authority": "request", "body": "which queue?",
                  "replyTo": "tcm-1" },
                // Unrecognised authority is context, not a dropped message.
                { "to": "sibling", "authority": "shouting", "body": long },
                // Past the cap — never written.
                { "to": "team", "authority": "note", "body": "and another thing" },
            ],
        })
        .to_string();
        let plan = say_reply(&raw, &open_policy());
        assert_eq!(plan.say.len(), MAX_SAY, "at most three per wake");
        assert_eq!(plan.say[0].to, SAY_TO_TEAM);
        assert_eq!(plan.say[0].authority, AUTHORITY_NOTE);
        assert_eq!(plan.say[1].to, "architect");
        assert_eq!(plan.say[1].authority, AUTHORITY_REQUEST);
        assert_eq!(plan.say[1].reply_to.as_deref(), Some("tcm-1"));
        assert_eq!(plan.say[2].authority, AUTHORITY_NOTE, "unknown rank = note");
        assert_eq!(plan.say[2].body.chars().count(), MAX_SAY_BODY_CHARS);
        assert!(plan.dropped_unknown_say.is_empty());
        assert_eq!(plan.say_downgraded, 0);

        // A blank body is not a message and must not consume a slot.
        let plan = say_reply(
            &serde_json::json!({
                "dispatch": [],
                "say": [
                    { "to": "team", "body": "   " },
                    { "to": "team", "body": "the real one" },
                ],
            })
            .to_string(),
            &open_policy(),
        );
        assert_eq!(plan.say.len(), 1);
        assert_eq!(plan.say[0].body, "the real one");
    }

    #[test]
    fn parse_say_drops_a_destination_the_persona_shares_no_team_with() {
        let raw = serde_json::json!({
            "dispatch": [],
            "say": [
                { "to": "ghost", "authority": "request", "body": "are you there" },
                { "to": "ghost", "authority": "note", "body": "again" },
                { "to": "architect", "authority": "note", "body": "on it" },
                // An absent or blank destination is the whole team — only a
                // NAMED id can be wrong.
                { "authority": "note", "body": "no destination named" },
            ],
        })
        .to_string();
        let plan = say_reply(&raw, &open_policy());
        assert_eq!(plan.say.len(), 2);
        assert_eq!(plan.say[0].to, "architect");
        assert_eq!(plan.say[1].to, SAY_TO_TEAM);
        assert_eq!(
            plan.dropped_unknown_say,
            vec!["ghost".to_string()],
            "recorded once, not once per attempt"
        );

        // The closed default policy knows no peers at all: `team` still works,
        // every named id is dropped.
        let plan = say_reply(&raw, &SayPolicy::default());
        assert_eq!(plan.say.len(), 1);
        assert_eq!(plan.say[0].to, SAY_TO_TEAM);
        assert_eq!(
            plan.dropped_unknown_say,
            vec!["ghost".to_string(), "architect".to_string()]
        );
    }

    #[test]
    fn parse_say_downgrades_a_directive_without_an_authority_charter() {
        let raw = serde_json::json!({
            "dispatch": [],
            "say": [
                { "to": "team", "authority": "DIRECTIVE", "body": "everyone ship a health check" },
                { "to": "architect", "authority": "directive", "body": "and you too" },
            ],
        })
        .to_string();

        let plan = say_reply(&raw, &open_policy());
        assert_eq!(plan.say[0].authority, AUTHORITY_REQUEST);
        assert_eq!(plan.say[1].authority, AUTHORITY_REQUEST);
        assert_eq!(plan.say_downgraded, 2, "both downgrades are counted");

        // The same plan from a persona the operator DID grant authority.
        let granted = SayPolicy {
            may_direct: true,
            ..open_policy()
        };
        let plan = say_reply(&raw, &granted);
        assert_eq!(plan.say[0].authority, AUTHORITY_DIRECTIVE);
        assert_eq!(plan.say_downgraded, 0);
    }

    #[test]
    fn a_plan_that_says_nothing_is_the_normal_plan() {
        let plan = say_reply(
            "{\"dispatch\":[{\"charterId\":\"r1\"}],\"defer\":[]}",
            &open_policy(),
        );
        assert!(plan.say.is_empty());
        assert!(plan.dropped_unknown_say.is_empty());
        assert_eq!(plan.say_downgraded, 0);
    }

    fn ctx_with_channel() -> DecisionContext {
        DecisionContext {
            channel: vec![
                ChannelLine {
                    id: "tcm-1".into(),
                    from: "Architect (persona)".into(),
                    from_id: Some("architect".into()),
                    authority: Some(AUTHORITY_DIRECTIVE.into()),
                    body: "every service exposes /health".into(),
                    age_minutes: Some(42),
                    addressed_to_me: false,
                },
                ChannelLine {
                    id: "tcm-2".into(),
                    from: "the operator (user)".into(),
                    from_id: None,
                    authority: None,
                    body: "line one\nline two".into(),
                    age_minutes: None,
                    addressed_to_me: true,
                },
            ],
            peers: vec![ChannelPeer {
                id: "architect".into(),
                name: "Architect".into(),
            }],
            ..ctx_fixture()
        }
    }

    #[test]
    fn prompt_renders_the_channel_with_the_rule_that_governs_it() {
        let p = render_decision_prompt(&ctx_with_channel());

        // The rule, stated before the data.
        assert!(p.contains("- ANSWER THE CHANNEL:"), "{p}");
        assert!(p.contains("a `directive` from the operator or an authority persona is an instruction you must reflect in this plan"), "{p}");
        assert!(p.contains("dispatch, defer or ask accordingly, and answer it"));
        assert!(p.contains("A `request` deserves an answer"));
        assert!(p.contains("A `note` is context"));

        // The data.
        assert!(p.contains("WHAT THE CHANNEL SAYS (newest first)"));
        assert!(
            p.contains("- [directive] Architect (persona) — 42 minute(s) ago"),
            "{p}"
        );
        assert!(p.contains("    id: tcm-1"));
        assert!(p.contains("every service exposes /health"));
        // A message that named this persona says so; one that reached it by
        // rank does not.
        assert!(
            p.contains("- [unranked] the operator (user) — TO YOU\n"),
            "{p}"
        );
        // No authority declared prints `unranked`, never a fabricated `note`.
        assert!(!p.contains("- [note] the operator"));
        // An age nobody could compute prints no age.
        assert!(!p.contains("0 minute(s) ago"));
        // A body's newlines are flattened so one message stays one line.
        assert!(p.contains("    line one line two\n"), "{p}");

        // Who it may address, and the ceiling on its own rank.
        assert!(p.contains("WHO YOU CAN ADDRESS (say.to)"));
        assert!(p.contains("- architect: Architect"));
        assert!(p.contains("- team: everyone on your team"));
        assert!(p.contains("You do NOT hold an authority charter"), "{p}");

        // And the wire the parser reads.
        assert!(p.contains("\"say\":[{\"to\":\"team|<a persona id from the list above>\""));
        assert!(p.contains("\"replyTo\":\"<the channel message id you are answering, or omit>\""));
    }

    #[test]
    fn prompt_states_the_authority_ceiling_it_actually_has() {
        let mut ctx = ctx_with_channel();
        ctx.may_direct = true;
        let p = render_decision_prompt(&ctx);
        assert!(p.contains("You hold an AUTHORITY charter"), "{p}");
        assert!(!p.contains("You do NOT hold an authority charter"));

        // A persona with no channel and no peers gets neither section — an
        // empty heading is something the model has to interpret.
        let p = render_decision_prompt(&ctx_fixture());
        assert!(!p.contains("WHAT THE CHANNEL SAYS (newest first)"));
        // The HEADING is absent; the RULE above still names the section, which
        // is why this asserts on the heading's own form rather than the phrase.
        assert!(!p.contains("WHO YOU CAN ADDRESS (say.to)"));
        // …but it is still told the rule, because it can still speak to its
        // team even when nobody has spoken to it.
        assert!(p.contains("- ANSWER THE CHANNEL:"));
    }

    #[test]
    fn the_channel_prompt_and_the_say_parser_agree() {
        let ctx = ctx_with_channel();
        let _ = render_decision_prompt(&ctx);
        let reply = serde_json::json!({
            "dispatch": [],
            "defer": [],
            "say": [{
                "to": "architect",
                "authority": AUTHORITY_REQUEST,
                "body": "health checks land with the gateway next wake",
                "replyTo": "tcm-1",
            }],
        })
        .to_string();
        let plan = parse_decision_with(
            &reply,
            &ctx.charters,
            ctx.free_capacity,
            &SayPolicy::from_context(&ctx),
        )
        .expect("parses");
        assert_eq!(plan.say.len(), 1);
        assert_eq!(plan.say[0].to, "architect");
        assert_eq!(plan.say[0].reply_to.as_deref(), Some("tcm-1"));
        assert!(plan.dropped_unknown_say.is_empty());
    }

    #[test]
    fn prompt_is_pure() {
        let ctx = ctx_fixture();
        assert_eq!(render_decision_prompt(&ctx), render_decision_prompt(&ctx));
    }

    /// The prompt and the parser must agree about the id vocabulary: every id
    /// the prompt shows is one the parser accepts, and the JSON skeleton the
    /// prompt prints is one the parser reads.
    #[test]
    fn prompt_and_parser_agree_on_the_contract() {
        let ctx = ctx_fixture();
        let _ = render_decision_prompt(&ctx);
        let reply = serde_json::json!({
            "dispatch": [{ "charterId": "r2", "reason": "highest priority", "brief": "sweep docs" }],
            "defer": [{ "charterId": "r1", "reason": "covered last wake" }],
            "note": "r1 deferred once",
        })
        .to_string();
        let plan = parse_decision(&reply, &ctx.charters, ctx.free_capacity).expect("parses");
        assert_eq!(plan.dispatch.len(), 1);
        assert_eq!(plan.dispatch[0].charter_id, "r2");
        assert_eq!(plan.defer.len(), 1);
        assert!(plan.dropped_unknown.is_empty());
    }

    // -- parse: the `hires` verb -------------------------------------------

    /// A roster that licenses hiring, two ways: an explicit `spec.canHire` and
    /// the `workforce-planning` provenance.
    fn hiring_roster() -> Vec<DecisionCharter> {
        let mut rs = roster();
        rs[0].can_hire = true;
        rs
    }

    fn planner_roster() -> Vec<DecisionCharter> {
        let mut rs = roster();
        rs[0].recipe_slug = Some(WORKFORCE_PLANNING_SLUG.to_string());
        rs
    }

    fn authority_roster() -> Vec<DecisionCharter> {
        let mut rs = roster();
        rs[0].authority = true;
        rs
    }

    #[test]
    fn a_roster_licenses_hiring_by_flag_provenance_or_authority() {
        assert!(!may_hire(&roster()), "a plain roster may not hire");
        assert!(may_hire(&hiring_roster()), "spec.canHire licenses it");
        assert!(
            may_hire(&planner_roster()),
            "the workforce-planning recipe licenses it without the flag"
        );
        assert!(
            may_hire(&authority_roster()),
            "the Architect designs the org, so it may staff it — without a second switch"
        );
    }

    #[test]
    fn parse_reads_a_hire_beside_an_empty_dispatch() {
        let raw = serde_json::json!({
            "dispatch": [],
            "hires": [{
                "need": "Nobody owns the payment ledger's reconciliation. Three \
                         nights of settlement runs ended with an unexplained \
                         delta. Done = a nightly job that reconciles and files a \
                         discrepancy report.",
                "projectId": "proj-bank-core",
                "budgetUsd": 40.0,
            }],
            "note": "asked kp for a reconciliation role",
        })
        .to_string();
        let plan = parse_decision(&raw, &hiring_roster(), 3).expect("parses");
        assert_eq!(plan.hires.len(), 1);
        let h = &plan.hires[0];
        assert!(h.need.starts_with("Nobody owns the payment ledger"));
        assert_eq!(h.project_id.as_deref(), Some("proj-bank-core"));
        assert_eq!(h.budget_usd, Some(40.0));
        assert_eq!(plan.dropped_unlicensed_hires, 0);

        // snake_case rides too, and an absent `hires` is an empty list.
        let snake = "{\"dispatch\":[],\"hires\":[{\"need\":\"n\",\
                     \"project_id\":\"p1\",\"budget_usd\":12}]}";
        let s = parse_decision(snake, &hiring_roster(), 3).expect("parses");
        assert_eq!(s.hires[0].project_id.as_deref(), Some("p1"));
        assert_eq!(s.hires[0].budget_usd, Some(12.0));
        assert!(parse_decision("{\"dispatch\":[]}", &hiring_roster(), 3)
            .expect("parses")
            .hires
            .is_empty());
    }

    // -- parse + licence: the three AUTHORITY verbs (G13) -------------------

    /// A wake that creates a project, gives it an owner and sets its goal — the
    /// Architect's whole opening move, in one answer.
    fn commanding_plan() -> String {
        serde_json::json!({
            "dispatch": [{ "charterId": "r2", "reason": "due", "brief": "go" }],
            "createProjects": [{
                "name": "ledger-service",
                "description": "Double-entry ledger for every account movement.",
                "techStack": "Rust, SQLite",
                "template": "rust-service",
            }],
            "adoptAppMasters": [{
                "project": "ledger-service",
                "recipes": [{ "slug": "accepted-idea-delivery", "priority": 1 }],
                "enabled": true,
            }],
            "goals": [{
                "project": "ledger-service",
                "title": "Every movement reconciles to the cent, nightly.",
                "description": "No unexplained delta survives a settlement run.",
            }],
        })
        .to_string()
    }

    #[test]
    fn only_an_authority_charter_licenses_the_workspace_verbs() {
        assert!(!may_command(&roster()), "a plain roster commands nothing");
        assert!(
            !may_command(&hiring_roster()),
            "canHire is a licence to ASK kp, not to write this machine's portfolio"
        );
        assert!(
            !may_command(&planner_roster()),
            "and neither is the workforce-planning provenance"
        );
        assert!(may_command(&authority_roster()), "spec.authority does");
    }

    #[test]
    fn parse_reads_the_three_workspace_verbs_from_an_authority_roster() {
        let plan = parse_decision(&commanding_plan(), &authority_roster(), 3).expect("parses");
        assert_eq!(plan.dropped_unlicensed_commands, 0);

        assert_eq!(plan.create_projects.len(), 1);
        let p = &plan.create_projects[0];
        assert_eq!(p.name, "ledger-service");
        assert_eq!(p.tech_stack.as_deref(), Some("Rust, SQLite"));
        assert_eq!(p.template.as_deref(), Some("rust-service"));
        assert!(p
            .description
            .as_deref()
            .unwrap()
            .starts_with("Double-entry"));

        assert_eq!(plan.adopt_app_masters.len(), 1);
        let a = &plan.adopt_app_masters[0];
        assert_eq!(a.project, "ledger-service");
        assert!(a.enabled);
        assert_eq!(a.recipes.len(), 1);
        assert_eq!(a.recipes[0].slug, "accepted-idea-delivery");
        assert_eq!(a.recipes[0].priority, Some(1));

        assert_eq!(plan.goals.len(), 1);
        assert_eq!(plan.goals[0].project, "ledger-service");
        assert!(plan.goals[0].title.starts_with("Every movement"));

        // The dispatch it also carried is untouched by any of it.
        assert_eq!(plan.dispatch.len(), 1);
        assert_eq!(plan.dispatch[0].charter_id, "r2");
    }

    /// snake_case rides on the two camelCase keys, and an absent key is an
    /// empty list rather than a parse failure — the same contract `hires` has.
    #[test]
    fn the_workspace_verbs_accept_snake_case_and_are_optional() {
        let snake = serde_json::json!({
            "dispatch": [],
            "create_projects": [{ "name": "gateway", "tech_stack": "Go" }],
            "adopt_app_masters": [{ "project": "gateway" }],
        })
        .to_string();
        let plan = parse_decision(&snake, &authority_roster(), 3).expect("parses");
        assert_eq!(plan.create_projects[0].name, "gateway");
        assert_eq!(plan.create_projects[0].tech_stack.as_deref(), Some("Go"));
        // No recipes named is a legitimate adoption (the door reads it as
        // "suspend what this persona holds"), and `enabled` defaults to on.
        assert_eq!(plan.adopt_app_masters[0].recipes.len(), 0);
        assert!(plan.adopt_app_masters[0].enabled);

        let bare = parse_decision("{\"dispatch\":[]}", &authority_roster(), 3).expect("parses");
        assert!(bare.create_projects.is_empty());
        assert!(bare.adopt_app_masters.is_empty());
        assert!(bare.goals.is_empty());
        assert_eq!(bare.dropped_unlicensed_commands, 0);
    }

    /// The licence is the whole gate, exactly as it is for a hire: an
    /// unlicensed roster keeps its dispatches, loses all three verbs, and the
    /// ledger carries ONE count of what it lost.
    #[test]
    fn an_unlicensed_roster_drops_all_three_workspace_verbs_and_counts_them() {
        let plan = parse_decision(&commanding_plan(), &roster(), 3).expect("parses");
        assert!(plan.create_projects.is_empty());
        assert!(plan.adopt_app_masters.is_empty());
        assert!(plan.goals.is_empty());
        assert_eq!(
            plan.dropped_unlicensed_commands, 3,
            "one count across the three verbs — they are one grant"
        );
        assert_eq!(
            plan.dispatch.len(),
            1,
            "the rest of the plan survives the dropped verbs"
        );
        // And a canHire roster is unlicensed for THESE, while still hiring.
        let hiring = parse_decision(&commanding_plan(), &hiring_roster(), 3).expect("parses");
        assert_eq!(hiring.dropped_unlicensed_commands, 3);
    }

    #[test]
    fn the_workspace_verbs_are_capped_bounded_and_deduped() {
        let raw = serde_json::json!({
            "dispatch": [],
            "createProjects": (0..6)
                .map(|i| serde_json::json!({
                    "name": format!("svc-{i}"),
                    "description": "d".repeat(MAX_PROJECT_DESCRIPTION_CHARS + 50),
                }))
                .collect::<Vec<_>>(),
            "adoptAppMasters": (0..6)
                .map(|i| serde_json::json!({ "project": format!("svc-{i}") }))
                .collect::<Vec<_>>(),
            "goals": (0..9)
                .map(|i| serde_json::json!({ "project": "svc-0", "title": format!("g{i}") }))
                .collect::<Vec<_>>(),
        })
        .to_string();
        let plan = parse_decision(&raw, &authority_roster(), 3).expect("parses");
        assert_eq!(plan.create_projects.len(), MAX_CREATE_PROJECTS);
        assert_eq!(plan.adopt_app_masters.len(), MAX_ADOPT_APP_MASTERS);
        assert_eq!(plan.goals.len(), MAX_SET_GOALS);
        assert_eq!(
            plan.create_projects[0]
                .description
                .as_deref()
                .unwrap()
                .len(),
            MAX_PROJECT_DESCRIPTION_CHARS
        );

        // What says nothing is dropped, and a repeat is not a second slot.
        let sparse = serde_json::json!({
            "dispatch": [],
            "createProjects": [
                { "description": "no name at all" },
                { "name": "ledger" },
                { "name": "LEDGER", "description": "the same project, shouted" },
            ],
            "adoptAppMasters": [{ "recipes": [{ "slug": "x" }] }],
            "goals": [
                { "project": "ledger" },
                { "title": "no project" },
                { "project": "ledger", "title": "Reconcile nightly" },
                { "project": "ledger", "title": "  reconcile NIGHTLY " },
            ],
        })
        .to_string();
        let plan = parse_decision(&sparse, &authority_roster(), 3).expect("parses");
        assert_eq!(
            plan.create_projects.len(),
            1,
            "a nameless project, and a repeat, are dropped"
        );
        assert_eq!(plan.create_projects[0].name, "ledger");
        assert!(
            plan.adopt_app_masters.is_empty(),
            "an adoption with no project is dropped"
        );
        assert_eq!(
            plan.goals.len(),
            1,
            "a goal needs both a project and a title, once"
        );
        assert_eq!(plan.goals[0].title, "Reconcile nightly");
    }

    /// A fumbled priority costs the recipe its ordering, never the adoption —
    /// and it becomes the honest "nobody ranked it", not a rank the Architect
    /// did not choose.
    #[test]
    fn an_unusable_adoption_priority_becomes_no_priority() {
        let raw = serde_json::json!({
            "dispatch": [],
            "adoptAppMasters": [{
                "project": "ledger",
                "recipes": [
                    { "slug": "a", "priority": 2 },
                    { "slug": "b", "priority": "3" },
                    { "slug": "c", "priority": 9 },
                    { "slug": "d", "priority": "highest" },
                    { "slug": "e" },
                ],
            }],
        })
        .to_string();
        let plan = parse_decision(&raw, &authority_roster(), 3).expect("parses");
        let rs = &plan.adopt_app_masters[0].recipes;
        assert_eq!(rs.len(), 5, "every recipe survives its own priority");
        assert_eq!(rs[0].priority, Some(2));
        assert_eq!(rs[1].priority, Some(3), "a numeric string is read");
        assert_eq!(rs[2].priority, None, "9 is outside 1..=5");
        assert_eq!(rs[3].priority, None);
        assert_eq!(rs[4].priority, None);
    }

    /// The licence is the whole gate: an unlicensed roster keeps the plan, drops
    /// the hire, and COUNTS the drop so the ledger can show it happened.
    #[test]
    fn an_unlicensed_roster_drops_the_hire_and_counts_it() {
        let raw = serde_json::json!({
            "dispatch": [{ "charterId": "r2", "reason": "due", "brief": "go" }],
            "hires": [{ "need": "someone to do the thing" }],
        })
        .to_string();
        let plan = parse_decision(&raw, &roster(), 3).expect("parses");
        assert!(plan.hires.is_empty(), "an unlicensed roster may not hire");
        assert_eq!(plan.dropped_unlicensed_hires, 1);
        assert_eq!(
            plan.dispatch.len(),
            1,
            "the rest of the plan survives the dropped verb"
        );
    }

    #[test]
    fn parse_bounds_and_caps_the_hire_list() {
        let raw = serde_json::json!({
            "dispatch": [],
            "hires": (0..4)
                .map(|i| serde_json::json!({ "need": format!("{} need {i}", "x".repeat(5_000)) }))
                .collect::<Vec<_>>(),
        })
        .to_string();
        let plan = parse_decision(&raw, &hiring_roster(), 3).expect("parses");
        assert_eq!(plan.hires.len(), MAX_HIRES, "one hire per wake");
        assert_eq!(
            plan.hires[0].need.chars().count(),
            MAX_HIRE_NEED_CHARS,
            "the need is bounded in CHARACTERS"
        );
    }

    /// A need is the whole request, so a hire without one is nothing. A fumbled
    /// budget costs only the budget — kp's composer owns that block anyway.
    #[test]
    fn a_hire_without_a_need_is_dropped_and_a_fumbled_budget_is_not_fatal() {
        let raw = serde_json::json!({
            "dispatch": [],
            "hires": [{ "need": "   ", "budgetUsd": 10 }],
        })
        .to_string();
        assert!(parse_decision(&raw, &hiring_roster(), 3)
            .expect("parses")
            .hires
            .is_empty());

        for bad in [
            serde_json::json!("$200/mo"),
            serde_json::json!(-5),
            serde_json::json!(0),
        ] {
            let raw = serde_json::json!({
                "dispatch": [],
                "hires": [{ "need": "a real need", "budgetUsd": bad }],
            })
            .to_string();
            let plan = parse_decision(&raw, &hiring_roster(), 3).expect("parses");
            assert_eq!(plan.hires.len(), 1, "the hire survives its own bad budget");
            assert_eq!(plan.hires[0].budget_usd, None);
        }
    }

    /// The rule and the contract clause are rendered together, and only for a
    /// roster that may hire — a rule for a verb the parser drops is worse than
    /// no rule at all.
    #[test]
    fn the_hire_rule_is_rendered_only_for_a_licensed_roster() {
        let mut ctx = ctx_fixture();
        assert!(
            !render_decision_prompt(&ctx).contains("- HIRE:"),
            "a plain roster is not told about a verb it cannot use"
        );

        ctx.charters = hiring_roster();
        let p = render_decision_prompt(&ctx);
        assert!(p.contains("- HIRE:"), "the rule appears");
        assert!(p.contains("\"hires\""), "and so does the contract clause");
    }

    // -- prompt: the workspace section (G13) --------------------------------

    /// The Architect's context: a workspace with one owned project and one
    /// unowned one, and a home project to write into.
    fn architect_ctx() -> DecisionContext {
        let mut ctx = ctx_fixture();
        ctx.persona_name = "Architect Bank".into();
        ctx.charters = authority_roster();
        ctx.may_direct = true;
        ctx.workspace = Some(WorkspaceView {
            id: "ws1".into(),
            name: "Bank".into(),
            projects: vec![
                WorkspaceProject {
                    id: "proj_platform".into(),
                    name: "platform".into(),
                    app_master: Some(WorkspaceAppMaster {
                        persona_id: "am1".into(),
                        last_note: Some("waiting on the ledger schema".into()),
                        next_wake_minutes: Some(30),
                        open_asks: 1,
                    }),
                },
                WorkspaceProject {
                    id: "proj_ledger".into(),
                    name: "ledger-service".into(),
                    app_master: None,
                },
            ],
            goals: Vec::new(),
            goal_count: 0,
            active_personas: ActivePersonas {
                running: 4,
                cap: 10,
            },
        });
        ctx.home_project = Some(HomeProject {
            id: "proj_platform".into(),
            name: "platform".into(),
            root_path: "/sim/bank/platform".into(),
        });
        ctx
    }

    #[test]
    fn the_workspace_section_teaches_an_authority_holder_the_three_verbs() {
        let p = render_decision_prompt(&architect_ctx());

        assert!(p.contains("WHAT YOU MAY DO TO THE WORKSPACE"));
        // The exact JSON shapes, not a paraphrase — the model copies these.
        assert!(p.contains("\"createProjects\":[{\"name\":"));
        assert!(p.contains("\"adoptAppMasters\":[{\"project\":"));
        assert!(p.contains("\"goals\":[{\"project\":"));
        assert!(p.contains("\"template\":\"empty|rust-service|node-service|python-service\""));
        // The caps, per verb.
        assert!(p.contains(&format!("At most {MAX_CREATE_PROJECTS} per wake")));
        assert!(p.contains(&format!("At most {MAX_ADOPT_APP_MASTERS} per wake")));
        assert!(p.contains(&format!("At most {MAX_SET_GOALS} per wake")));
        // The headroom the adoption verb is really capped by — the number, not
        // just the existence of a cap.
        assert!(
            p.contains("6 of 10 machine slot(s) are free right now"),
            "the machine headroom is stated: {p}"
        );
        assert!(
            p.contains("An adoption is never refused for capacity"),
            "and it is stated as a pacing fact, not a limit on the roster: {p}"
        );
        assert!(p.contains(ADOPTED_APP_MASTER_MODEL));
        // And where the design goes, as a path it can actually write.
        assert!(p.contains("/sim/bank/platform/docs/solution-design.md"));
        assert!(p.contains("- your home: platform (proj_platform) at /sim/bank/platform"));
        // The unowned project is still named as the case the verb exists for.
        assert!(p.contains("App Master: NONE"));
    }

    /// A workspace holder WITHOUT authority sees the portfolio and nothing new:
    /// a rule describing a verb the parser will drop is worse than no rule.
    #[test]
    fn a_workspace_holder_without_authority_is_told_none_of_it() {
        let mut ctx = architect_ctx();
        ctx.charters = roster();
        ctx.may_direct = false;
        let p = render_decision_prompt(&ctx);

        assert!(
            p.contains("YOUR WORKSPACE: Bank"),
            "it still sees the portfolio"
        );
        assert!(!p.contains("WHAT YOU MAY DO TO THE WORKSPACE"));
        assert!(!p.contains("createProjects"));
        assert!(!p.contains("adoptAppMasters"));
        assert!(!p.contains("persona slot(s) are free right now"));
        // But it is still told where it writes — that is true with or without
        // the verbs.
        assert!(p.contains("- your home: platform"));
    }

    /// The App Master's prompt is byte-identical to what it was before any of
    /// this existed: no workspace section, no verbs, no home line.
    #[test]
    fn an_app_master_sees_no_workspace_section_at_all() {
        let p = render_decision_prompt(&ctx_fixture());
        assert!(!p.contains("YOUR WORKSPACE"));
        assert!(!p.contains("WHAT YOU MAY DO TO THE WORKSPACE"));
        assert!(!p.contains("your home:"));
    }

    /// A home nobody resolved is said plainly, never invented as a path.
    #[test]
    fn a_workspace_with_no_home_says_so_rather_than_naming_a_path() {
        let mut ctx = architect_ctx();
        ctx.home_project = None;
        let p = render_decision_prompt(&ctx);
        assert!(p.contains("- your home: NONE"));
        assert!(
            !p.contains("solution-design.md"),
            "no path is promised when none resolved: {p}"
        );
        // The verbs are still there — creating that first project is exactly
        // what closes the gap the line just named.
        assert!(p.contains("WHAT YOU MAY DO TO THE WORKSPACE"));
    }
}
