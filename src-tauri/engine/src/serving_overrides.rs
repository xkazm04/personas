//! The ONE enumeration of **what can change what serves a run** — every
//! mechanism in this tree that can change the model, the effort, the prompt,
//! the persona or the session a persona execution actually gets.
//!
//! # Why this module exists
//!
//! personas has **one operator per install** (`.ai/manifest.yaml` →
//! `scope.does`), so one person carries the whole model of the system in their
//! head. Until this module there was no single place that said what could
//! change a run after it was decided — only **four partial lists**, each
//! covering a different subset:
//!
//! 1. [`crate::healing_orchestrator`] (module docs) — the most complete of the
//!    four. It names six mechanisms and covers the **failure-aftermath family
//!    only**: failover, rule-based retry, AI healing, auto-rollback, the
//!    persona-level breaker, the provider-level breaker. It does not know about
//!    the *second* persona breaker ([`Mechanism::NoDeliveryBreaker`]), nor about
//!    the manual rollback path ([`Mechanism::PromptLabVersionRestore`]) that
//!    writes the same two prompt columns its own mutual-exclusion argument is
//!    built on.
//! 2. `docs/concepts/golden-paths/model-and-effort-selection.md` — the
//!    model/effort override table. Covers the model axis; nothing about
//!    session, persona or durable prompt rewrites.
//! 3. `docs/concepts/golden-paths/failure-recovery-strategy.md` — the
//!    breaker/counter table. Covers suppression and retry.
//! 4. [`crate::autonomy`] — a *read-site* registry for a different question
//!    ("may this autonomous action run?"). It is the **pattern** this module
//!    copies, not a list of overrides: its `Action` variants are all settings-key
//!    gated, and none of the mechanisms below has a settings key. See
//!    "Relationship to [`crate::autonomy`]" below.
//!
//! Four partial lists is the condition this module retires. The registry is a
//! **consolidation, not a redesign**: nothing here changes which model serves
//! any run. It enumerates, and a census test refuses to let the enumeration go
//! quietly out of date.
//!
//! # What counts as a member
//!
//! A mechanism belongs here when it can change, for a **persona execution**
//! (`persona_executions` — the lane the runner spawns), any of:
//!
//! - [`Dimension::Model`] — the model id or the effort level that spawns
//! - [`Dimension::Prompt`] — the prompt text or system prompt the run receives
//! - [`Dimension::Persona`] — which persona the work is dispatched to
//! - [`Dimension::Session`] — whether the run is fresh or a `--resume`
//! - [`Dimension::Suppression`] — whether the run happens at all
//!
//! [`Reach`] separates a change that lasts for **this run** from one written
//! back to `personas` and therefore serving **every future run**.
//!
//! [`Trigger`] records who starts it. This matters and is deliberately *not* a
//! membership test: the operator's head-model problem is "what can change what
//! serves **without me asking**", but a list that dropped the operator-initiated
//! writes would be a list that silently shrinks — and three of them
//! ([`Mechanism::PromptLabVersionRestore`], [`Mechanism::ManagementApiDraftApply`],
//! [`Mechanism::EventHandlerWiring`]) write the very columns another mechanism's
//! safety argument depends on.
//!
//! # Deliberately absent, and why
//!
//! Recording *why* something is absent is the half that stops the list from
//! silently shrinking. Each of these was looked at and left out:
//!
//! - **The resolution cascade itself.** `runner::resolve_*` (six layers,
//!   `src/engine/runner/mod.rs`) *is* the decision. Its own effective-config
//!   merge writes `persona.model_profile` twice; that is the cascade producing
//!   its answer, not a mechanism overriding it. Both sites are recorded as
//!   census non-members below.
//! - **The companion / Athena lane.** `companion::model_routing` (turn-class
//!   tiers) and the `PERSONAS_ATHENA_MODEL` / `PERSONAS_ATHENA_EFFORT` escapes
//!   in `companion::session::model` do choose a model — for **companion turns**,
//!   which are not persona executions and do not write `persona_executions`.
//!   A second registry, if that lane ever needs one.
//! - **Lab / arena / eval lanes.** `commands::execution::lab` measurement runs,
//!   [`crate::test_runner::lab`]'s `LAB_MODEL`, [`crate::eval`] and
//!   [`crate::auto_triage`]'s pinned headless `--model` all spawn a real CLI but
//!   against an ephemeral persona built for measurement. They cannot change what
//!   an operator's persona serves. (`commands::execution::lab`'s three writes to
//!   the persona's stored prompt are a different thing and *are* members.)
//! - **One-off AI-helper prompts.** 27 sites push a bare `--model` for a
//!   single-turn helper (`engine::ai_helpers`, `commands::design::*`,
//!   `commands::infrastructure::*`, …). They are not persona executions; none of
//!   them reads or writes a persona's profile. Measured 2026-09-06.
//! - **`hooks_sidecar`.** Checked: it installs only `Stop` and `PreCompact`
//!   hooks whose command appends a payload to a queue file. There is no
//!   `UserPromptSubmit` hook and no `additionalContext` injection anywhere in
//!   the tree, so it cannot change a prompt. Env-gated on
//!   `PERSONAS_HOOKS_SIDECAR`, off by default.
//! - **`engine::background::event_bus`'s enabled gate** (`event_bus.rs`, the
//!   `personas.enabled` check on the cascade path). Not a mechanism — it is the
//!   **enforcement point** for the two breakers below. Both
//!   [`Mechanism::PersonaFailureBreaker`] and [`Mechanism::NoDeliveryBreaker`]
//!   are inert without it, which is worth knowing and is not worth a variant.
//! - **The provider-level circuit breaker** (`engine::failover`). It removes a
//!   provider from the failover chain; the chain's effect on what serves is
//!   already [`Mechanism::FailoverCandidateModel`]. Listing the breaker
//!   separately would double-count one substitution.
//!
//! # Relationship to [`crate::autonomy`]
//!
//! [`crate::autonomy`] is where the read-site-registry pattern in this repo
//! comes from, and this module is deliberately a **sibling** of it rather than
//! an extension of its `Action` enum. `Action` answers a configuration question
//! and every variant maps to an allow-listed `app_settings` key and an App
//! master rung; **none** of the mechanisms below has either. Folding them into
//! `Action` would break `Action::global_key()` and `Action::required_rung()`,
//! which are total matches by design. Same pattern, different question.
//!
//! # How the enumeration is kept complete
//!
//! An enumeration nobody checks is prose. [`Family`] defines five code shapes an
//! override takes, and the census in this module's tests walks the four crate
//! source roots, counts every occurrence, and requires each one to be **claimed
//! by a registered mechanism or listed as a non-member with a reason**. Adding a
//! thirteenth model substitution without registering it raises a count the
//! census pins, and the test fails.
//!
//! It is a bounded guarantee and this module states its bound: mechanisms whose
//! [`Site::family`] is `None` are asserted by marker only, so the census proves
//! *those* have not moved but cannot prove a brand-new one of that shape was
//! registered. The five families cover the model, durable-prompt, session,
//! suppression and per-run-prompt-prepend shapes; they do not cover, for
//! example, a future mechanism that pushes `--model` straight into argv.
//!
//! The fail-loud contract is the census runner's, in
//! `scripts/census/lib/engine.mjs` — *found nothing* and *looked at nothing* are
//! different outcomes. Every family must match at least once, every registered
//! marker must be found, every non-member exemption must be hit, and the walk
//! must visit at least [`WALK_FLOOR`] files.

/// What a mechanism can change about a run.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Dimension {
    /// The model id or the effort level the run spawns with.
    Model,
    /// The prompt text or system prompt the run receives.
    Prompt,
    /// Which persona the work is dispatched to.
    Persona,
    /// Whether the run is fresh or attaches to a prior CLI session.
    Session,
    /// Whether the run happens at all.
    Suppression,
}

/// How far a change reaches.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Reach {
    /// Affects the one run being launched, and nothing after it.
    ThisRun,
    /// Written back to `personas`, so it serves every future run too.
    AllFutureRuns,
}

/// Who starts a mechanism. Not a membership test — see the module docs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Trigger {
    /// Fires on its own: a tick, a failure, a queue drain, a policy row.
    Autonomous,
    /// The operator asked for it in the UI.
    Operator,
    /// A caller outside the desktop UI: the management HTTP API, an MCP client.
    RemoteCaller,
}

/// A code shape an override takes, which the census can count.
///
/// Each family is a set of literal needles rather than a regex: this crate has
/// no regex dependency and adding one to serve a test would be exactly the
/// unadopted-abstraction defect `.claude/rules/rust-backend.md` warns about.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Family {
    /// `persona.model_profile = Some(..)` — a caller substitutes the profile
    /// the runner will resolve from.
    ModelProfileSubstitution,
    /// An `UPDATE personas SET .. system_prompt/structured_prompt ..` — a
    /// rewrite of the prompt that serves every future run.
    DurablePromptRewrite,
    /// A `Continuation::SessionResume(..)` / `Continuation::PromptHint(..)` — a
    /// run's session or prompt continuation.
    ContinuationProduced,
    /// A write of `personas.enabled = false` — suppression.
    PersonaDisabled,
    /// A `prepend_ambient_to_system_prompt(..)` call — per-run prompt prefixing.
    AmbientPrepend,
}

/// Where a mechanism lives, and what the census looks for there.
#[derive(Debug, Clone, Copy)]
pub struct Site {
    /// Path relative to `src-tauri/`. Line numbers are deliberately absent —
    /// they rot; `marker` does not.
    pub file: &'static str,
    /// A literal substring present at the site. The census fails when it is
    /// gone, which is how a stale registry entry surfaces.
    pub marker: &'static str,
    /// The census family this site belongs to, and how many of that family's
    /// occurrences in `file` this mechanism claims. `None` = marker-only.
    pub family: Option<(Family, usize)>,
}

/// Every mechanism that can change what serves a persona execution.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mechanism {
    // ---- Model: inside the spawn path -------------------------------------
    /// A BYOM policy row replaces the resolved provider and/or model after the
    /// prompt is assembled (the policy reads prompt length, so it *must* run
    /// after assembly).
    ByomPolicySubstitution,
    /// The failover chain substitutes the next candidate's model before the
    /// spawn retry. Reachable only when `spawn` itself returns `Err`.
    FailoverCandidateModel,
    /// A remote-HTTP provider in the profile bypasses the CLI spawn entirely,
    /// so no `--model` / `--effort` argv is built at all.
    RemoteHttpEngineBypass,
    /// The resume argv builder pushes a hardcoded `--effort` and **no**
    /// `--model`, so every resume path discards the resolved model and the
    /// persona's effort. The comment above it claims the opposite.
    ResumeArgvDropsModelAndEffort,

    // ---- Model: substituted by a caller before the cascade ----------------
    /// A charter's or use-case's `model_override` replaces the persona profile
    /// before the execution is queued.
    CharterModelOverride,
    /// A profile-less capability execution is pinned to the sonnet default
    /// rather than riding the CLI account default.
    CapabilityModelFloor,
    /// The team orchestrator's own copy of the use-case `model_override`.
    TeamUseCaseModelOverride,
    /// The team orchestrator's own copy of the capability model floor.
    TeamCapabilityModelFloor,
    /// A pipeline node's `model_profile_override` replaces the member's profile
    /// for that node's run.
    PipelineNodeModelOverride,
    /// A dry-run preview applies a use-case `model_override` (never spawns, but
    /// it is what the operator is shown the run *would* use).
    DryRunUseCaseOverride,
    /// AI healing forces an Opus id, unbudgeted, for the healing run.
    HealingForcedOpus,

    // ---- Model: written back to the persona -------------------------------
    /// The Director seed backfills `model_profile` into the NULL/empty gap on
    /// every `ensure_director_persona`. Idempotent, never overrides a choice.
    DirectorModelBackfill,
    /// The `personas_set_model` MCP tool lets any MCP client — including another
    /// persona — repoint an arbitrary persona's `model_profile`.
    McpSetModelTool,
    /// Evolution promotion writes prompt **and** model in one statement: the
    /// only mechanism in the tree that changes both at once.
    EvolutionWinnerPromotion,

    // ---- Prompt: durable, all future runs ---------------------------------
    /// AI healing's `apply_db_fixes` rewrites the persona's stored prompt.
    AiHealingPromptFix,
    /// Auto-rollback restores a prompt version on a five-minute tick.
    AutoRollbackPromptRestore,
    /// The prompt lab restores a version by hand — the same two columns
    /// auto-rollback writes, and **not** inside the `healing_personas` slot the
    /// mutual-exclusion argument rests on.
    PromptLabVersionRestore,
    /// The persona lab accepts a matrix draft onto the live structured prompt.
    PersonaLabDraftAccept,
    /// The persona lab applies a stored version onto the live persona.
    PersonaLabVersionApply,
    /// The persona lab rolls a version back onto the live persona.
    PersonaLabVersionRollback,
    /// A build session materializes a persona, prompt columns included.
    BuildSessionMaterialize,
    /// The management HTTP API applies a lab draft onto the live prompt.
    ManagementApiDraftApply,
    /// Linking or unlinking a trigger patches
    /// `structured_prompt.eventHandlers`.
    EventHandlerWiring,
    /// Renaming an event type rewrites the handler across every persona.
    EventTypeRename,

    // ---- Prompt: this run only --------------------------------------------
    /// Ambient activity signals are prepended to the system prompt.
    AmbientActivityPrepend,
    /// The operator's live Claude CLI transcript is prepended to the system
    /// prompt.
    CliSessionAwarenessPrepend,
    /// The prepared-run cache serves a speculatively assembled prompt whose
    /// episodic tail is up to `PREPARED_RUN_TTL` stale.
    PreparedRunCacheStaleness,
    /// AI healing replaces the run's input with a healing brief.
    HealingInputReplacement,
    /// Rule-based retry re-reads the persona from the DB, so any edit between
    /// the failure and the retry serves the retry.
    RuleRetryFreshPersona,
    /// Rule-based retry passes no additional input — the original
    /// `input_data` is dropped.
    RuleRetryDropsInput,
    /// A QA bounce injects rework feedback and instructions into a re-run
    /// step's input.
    TeamReworkInputInjection,
    /// Incident continuation injects a `PromptHint`.
    IncidentContinuationHint,
    /// A session resume suppresses six blocks the fresh path appends — memory,
    /// the knowledge consult, prior human-review decisions, team shared
    /// knowledge, the delegate contract and the alignment ritual — on the
    /// assumption the session still holds them.
    ResumeSuppressesRecallBlocks,
    /// The skills sidecar writes SKILL.md files and removes the matching inline
    /// usage text from the assembled prompt. Default on.
    SkillsSidecarPromptTrim,
    /// CLAUDE.md projection writes a file the CLI prepends to every turn and
    /// re-reads after `/compact`. Env-gated, off by default.
    ClaudeMdProjection,
    /// The deliberation moderator rewrites the agenda and picks the next
    /// speaker for the following round.
    DeliberationModeratorAgenda,

    // ---- Persona ----------------------------------------------------------
    /// The operator reassigns a reviewed step to a different persona.
    TeamReviewReassign,
    /// An unassigned step's persona is chosen by embedding or LLM match and
    /// persisted onto the step.
    AutoAssigneeResolution,
    /// A QA bounce resets a completed predecessor step to pending, so the work
    /// is dispatched again.
    QaReworkBounce,

    // ---- Session ----------------------------------------------------------
    /// Warm-pool reuse converts a fresh run into a resume, with no caller
    /// intent at all.
    WarmPoolSessionReuse,
    /// The scheduled-retry drain resumes when the row's reason tag is
    /// `api_error_resume` and a session id was captured, else restarts fresh.
    ApiErrorResumeDrain,
    /// AI healing resumes the original CLI session.
    HealingSessionResume,

    // ---- Suppression ------------------------------------------------------
    /// The persona breaker disables a persona after five consecutive failures.
    PersonaFailureBreaker,
    /// A second, independent breaker disables a standalone persona after five
    /// consecutive non-delivering runs (`no_input_available` /
    /// `precondition_failed`). Skips team members. Not in any of the four lists.
    NoDeliveryBreaker,
    /// A knowledge-base hint can escalate straight to an issue with **no retry
    /// ever**, or replace the exponential backoff delay. Wired end to end;
    /// `healing_knowledge` measured 0 rows.
    KnowledgeHintOverridesRetry,
}

impl Mechanism {
    /// Every mechanism. [`Self::assert_all_covered`] proves this covers the
    /// enum at compile time.
    pub const ALL: [Mechanism; 45] = [
        Mechanism::ByomPolicySubstitution,
        Mechanism::FailoverCandidateModel,
        Mechanism::RemoteHttpEngineBypass,
        Mechanism::ResumeArgvDropsModelAndEffort,
        Mechanism::CharterModelOverride,
        Mechanism::CapabilityModelFloor,
        Mechanism::TeamUseCaseModelOverride,
        Mechanism::TeamCapabilityModelFloor,
        Mechanism::PipelineNodeModelOverride,
        Mechanism::DryRunUseCaseOverride,
        Mechanism::HealingForcedOpus,
        Mechanism::DirectorModelBackfill,
        Mechanism::McpSetModelTool,
        Mechanism::EvolutionWinnerPromotion,
        Mechanism::AiHealingPromptFix,
        Mechanism::AutoRollbackPromptRestore,
        Mechanism::PromptLabVersionRestore,
        Mechanism::PersonaLabDraftAccept,
        Mechanism::PersonaLabVersionApply,
        Mechanism::PersonaLabVersionRollback,
        Mechanism::BuildSessionMaterialize,
        Mechanism::ManagementApiDraftApply,
        Mechanism::EventHandlerWiring,
        Mechanism::EventTypeRename,
        Mechanism::AmbientActivityPrepend,
        Mechanism::CliSessionAwarenessPrepend,
        Mechanism::PreparedRunCacheStaleness,
        Mechanism::HealingInputReplacement,
        Mechanism::RuleRetryFreshPersona,
        Mechanism::RuleRetryDropsInput,
        Mechanism::TeamReworkInputInjection,
        Mechanism::IncidentContinuationHint,
        Mechanism::ResumeSuppressesRecallBlocks,
        Mechanism::SkillsSidecarPromptTrim,
        Mechanism::ClaudeMdProjection,
        Mechanism::DeliberationModeratorAgenda,
        Mechanism::TeamReviewReassign,
        Mechanism::AutoAssigneeResolution,
        Mechanism::QaReworkBounce,
        Mechanism::WarmPoolSessionReuse,
        Mechanism::ApiErrorResumeDrain,
        Mechanism::HealingSessionResume,
        Mechanism::PersonaFailureBreaker,
        Mechanism::NoDeliveryBreaker,
        Mechanism::KnowledgeHintOverridesRetry,
    ];

    /// Compile-time exhaustiveness guard for [`Self::ALL`], in the shape
    /// `personas_core::engine_kind::EngineKind::assert_all_covered` established:
    /// an exhaustive match with no wildcard, walked over `ALL`. Add a variant
    /// without adding it to `ALL` and this stops compiling.
    const fn assert_all_covered() {
        let mut i = 0;
        while i < Self::ALL.len() {
            match Self::ALL[i] {
                Mechanism::ByomPolicySubstitution => {}
                Mechanism::FailoverCandidateModel => {}
                Mechanism::RemoteHttpEngineBypass => {}
                Mechanism::ResumeArgvDropsModelAndEffort => {}
                Mechanism::CharterModelOverride => {}
                Mechanism::CapabilityModelFloor => {}
                Mechanism::TeamUseCaseModelOverride => {}
                Mechanism::TeamCapabilityModelFloor => {}
                Mechanism::PipelineNodeModelOverride => {}
                Mechanism::DryRunUseCaseOverride => {}
                Mechanism::HealingForcedOpus => {}
                Mechanism::DirectorModelBackfill => {}
                Mechanism::McpSetModelTool => {}
                Mechanism::EvolutionWinnerPromotion => {}
                Mechanism::AiHealingPromptFix => {}
                Mechanism::AutoRollbackPromptRestore => {}
                Mechanism::PromptLabVersionRestore => {}
                Mechanism::PersonaLabDraftAccept => {}
                Mechanism::PersonaLabVersionApply => {}
                Mechanism::PersonaLabVersionRollback => {}
                Mechanism::BuildSessionMaterialize => {}
                Mechanism::ManagementApiDraftApply => {}
                Mechanism::EventHandlerWiring => {}
                Mechanism::EventTypeRename => {}
                Mechanism::AmbientActivityPrepend => {}
                Mechanism::CliSessionAwarenessPrepend => {}
                Mechanism::PreparedRunCacheStaleness => {}
                Mechanism::HealingInputReplacement => {}
                Mechanism::RuleRetryFreshPersona => {}
                Mechanism::RuleRetryDropsInput => {}
                Mechanism::TeamReworkInputInjection => {}
                Mechanism::IncidentContinuationHint => {}
                Mechanism::ResumeSuppressesRecallBlocks => {}
                Mechanism::SkillsSidecarPromptTrim => {}
                Mechanism::ClaudeMdProjection => {}
                Mechanism::DeliberationModeratorAgenda => {}
                Mechanism::TeamReviewReassign => {}
                Mechanism::AutoAssigneeResolution => {}
                Mechanism::QaReworkBounce => {}
                Mechanism::WarmPoolSessionReuse => {}
                Mechanism::ApiErrorResumeDrain => {}
                Mechanism::HealingSessionResume => {}
                Mechanism::PersonaFailureBreaker => {}
                Mechanism::NoDeliveryBreaker => {}
                Mechanism::KnowledgeHintOverridesRetry => {}
            }
            i += 1;
        }
    }

    /// Human label, for a review packet or a log line.
    pub fn label(self) -> &'static str {
        match self {
            Self::ByomPolicySubstitution => "BYOM policy replaces the provider and model",
            Self::FailoverCandidateModel => "failover substitutes the next candidate's model",
            Self::RemoteHttpEngineBypass => "a remote-HTTP provider bypasses the CLI spawn",
            Self::ResumeArgvDropsModelAndEffort => "resume argv drops --model and pins --effort",
            Self::CharterModelOverride => "a charter's model_override replaces the profile",
            Self::CapabilityModelFloor => "a profile-less capability run is pinned to the default",
            Self::TeamUseCaseModelOverride => "the team orchestrator's use-case model override",
            Self::TeamCapabilityModelFloor => "the team orchestrator's capability model floor",
            Self::PipelineNodeModelOverride => "a pipeline node's model_profile_override",
            Self::DryRunUseCaseOverride => "a dry-run preview applies a use-case override",
            Self::HealingForcedOpus => "AI healing forces an Opus id, unbudgeted",
            Self::DirectorModelBackfill => "the Director seed backfills a model pin",
            Self::McpSetModelTool => "an MCP client repoints a persona's model",
            Self::EvolutionWinnerPromotion => "evolution promotes a winner's prompt and model",
            Self::AiHealingPromptFix => "AI healing rewrites the stored prompt",
            Self::AutoRollbackPromptRestore => "auto-rollback restores a prompt version",
            Self::PromptLabVersionRestore => "the prompt lab restores a version by hand",
            Self::PersonaLabDraftAccept => "the persona lab accepts a matrix draft",
            Self::PersonaLabVersionApply => "the persona lab applies a stored version",
            Self::PersonaLabVersionRollback => "the persona lab rolls a version back",
            Self::BuildSessionMaterialize => "a build session materializes the prompt columns",
            Self::ManagementApiDraftApply => "the management API applies a lab draft",
            Self::EventHandlerWiring => "trigger wiring patches structured_prompt.eventHandlers",
            Self::EventTypeRename => "an event-type rename rewrites every handler",
            Self::AmbientActivityPrepend => "ambient activity is prepended to the system prompt",
            Self::CliSessionAwarenessPrepend => "the live CLI transcript is prepended",
            Self::PreparedRunCacheStaleness => "the prepared-run cache serves a stale prompt",
            Self::HealingInputReplacement => "AI healing replaces the run's input",
            Self::RuleRetryFreshPersona => "rule-based retry re-reads the persona",
            Self::RuleRetryDropsInput => "rule-based retry drops the original input",
            Self::TeamReworkInputInjection => "a QA bounce injects rework instructions",
            Self::IncidentContinuationHint => "incident continuation injects a PromptHint",
            Self::ResumeSuppressesRecallBlocks => "a resume suppresses six appended recall blocks",
            Self::SkillsSidecarPromptTrim => "the skills sidecar trims inline usage text",
            Self::ClaudeMdProjection => "CLAUDE.md projection prepends to every turn",
            Self::DeliberationModeratorAgenda => "the moderator rewrites the agenda and speaker",
            Self::TeamReviewReassign => "the operator reassigns a reviewed step",
            Self::AutoAssigneeResolution => "an unassigned step's persona is auto-chosen",
            Self::QaReworkBounce => "a QA bounce re-dispatches a completed step",
            Self::WarmPoolSessionReuse => "warm-pool reuse converts a fresh run into a resume",
            Self::ApiErrorResumeDrain => "the scheduled-retry drain resumes the session",
            Self::HealingSessionResume => "AI healing resumes the original session",
            Self::PersonaFailureBreaker => "the failure breaker disables the persona",
            Self::NoDeliveryBreaker => "the no-delivery breaker disables the persona",
            Self::KnowledgeHintOverridesRetry => "a KB hint suppresses or re-times the retry",
        }
    }

    /// What this mechanism changes.
    pub fn dimension(self) -> Dimension {
        match self {
            Self::ByomPolicySubstitution
            | Self::FailoverCandidateModel
            | Self::RemoteHttpEngineBypass
            | Self::ResumeArgvDropsModelAndEffort
            | Self::CharterModelOverride
            | Self::CapabilityModelFloor
            | Self::TeamUseCaseModelOverride
            | Self::TeamCapabilityModelFloor
            | Self::PipelineNodeModelOverride
            | Self::DryRunUseCaseOverride
            | Self::HealingForcedOpus
            | Self::DirectorModelBackfill
            | Self::McpSetModelTool
            | Self::EvolutionWinnerPromotion => Dimension::Model,
            Self::AiHealingPromptFix
            | Self::AutoRollbackPromptRestore
            | Self::PromptLabVersionRestore
            | Self::PersonaLabDraftAccept
            | Self::PersonaLabVersionApply
            | Self::PersonaLabVersionRollback
            | Self::BuildSessionMaterialize
            | Self::ManagementApiDraftApply
            | Self::EventHandlerWiring
            | Self::EventTypeRename
            | Self::AmbientActivityPrepend
            | Self::CliSessionAwarenessPrepend
            | Self::PreparedRunCacheStaleness
            | Self::HealingInputReplacement
            | Self::RuleRetryFreshPersona
            | Self::RuleRetryDropsInput
            | Self::TeamReworkInputInjection
            | Self::IncidentContinuationHint
            | Self::ResumeSuppressesRecallBlocks
            | Self::SkillsSidecarPromptTrim
            | Self::ClaudeMdProjection
            | Self::DeliberationModeratorAgenda => Dimension::Prompt,
            Self::TeamReviewReassign | Self::AutoAssigneeResolution | Self::QaReworkBounce => {
                Dimension::Persona
            }
            Self::WarmPoolSessionReuse | Self::ApiErrorResumeDrain | Self::HealingSessionResume => {
                Dimension::Session
            }
            Self::PersonaFailureBreaker
            | Self::NoDeliveryBreaker
            | Self::KnowledgeHintOverridesRetry => Dimension::Suppression,
        }
    }

    /// Whether the change is written back to `personas` and therefore serves
    /// every future run, or only the run being launched.
    pub fn reach(self) -> Reach {
        match self {
            Self::DirectorModelBackfill
            | Self::McpSetModelTool
            | Self::EvolutionWinnerPromotion
            | Self::AiHealingPromptFix
            | Self::AutoRollbackPromptRestore
            | Self::PromptLabVersionRestore
            | Self::PersonaLabDraftAccept
            | Self::PersonaLabVersionApply
            | Self::PersonaLabVersionRollback
            | Self::BuildSessionMaterialize
            | Self::ManagementApiDraftApply
            | Self::EventHandlerWiring
            | Self::EventTypeRename
            | Self::AutoAssigneeResolution
            | Self::PersonaFailureBreaker
            | Self::NoDeliveryBreaker => Reach::AllFutureRuns,
            _ => Reach::ThisRun,
        }
    }

    /// Who starts it.
    pub fn trigger(self) -> Trigger {
        match self {
            Self::TeamReviewReassign
            | Self::PersonaLabDraftAccept
            | Self::PersonaLabVersionApply
            | Self::PersonaLabVersionRollback
            | Self::PromptLabVersionRestore
            | Self::BuildSessionMaterialize
            | Self::EventHandlerWiring
            | Self::EventTypeRename
            | Self::EvolutionWinnerPromotion
            | Self::DryRunUseCaseOverride => Trigger::Operator,
            Self::ManagementApiDraftApply | Self::McpSetModelTool => Trigger::RemoteCaller,
            _ => Trigger::Autonomous,
        }
    }

    /// Where it lives, and what the census looks for there. Most mechanisms
    /// have one site; the two prompt-prepend mechanisms have two each, because
    /// the in-process engine path and the daemon path each call the mutator.
    pub fn sites(self) -> &'static [Site] {
        match self {
            Self::ByomPolicySubstitution => &[Site {
                file: "src/engine/failover.rs",
                marker: "policy.preferred_model",
                family: None,
            }],
            Self::FailoverCandidateModel => &[Site {
                file: "src/engine/runner/mod.rs",
                marker: "// Build model profile override for this candidate",
                family: None,
            }],
            Self::RemoteHttpEngineBypass => &[Site {
                file: "src/engine/runner/mod.rs",
                marker: "run_http_execution",
                family: None,
            }],
            Self::ResumeArgvDropsModelAndEffort => &[Site {
                file: "engine/src/prompt/cli_args.rs",
                marker: "Pin effort on resume too",
                family: None,
            }],
            Self::CharterModelOverride => &[Site {
                file: "src/commands/execution/executions.rs",
                marker: "resolve_use_case_model_override(&mo)",
                family: Some((Family::ModelProfileSubstitution, 1)),
            }],
            Self::CapabilityModelFloor => &[Site {
                file: "src/commands/execution/executions.rs",
                marker: "Capability executions never ride the CLI account default",
                family: Some((Family::ModelProfileSubstitution, 1)),
            }],
            Self::TeamUseCaseModelOverride => &[Site {
                file: "src/engine/team_assignment_orchestrator.rs",
                marker: ".and_then(crate::engine::prompt::resolve_use_case_model_override)",
                family: Some((Family::ModelProfileSubstitution, 1)),
            }],
            Self::TeamCapabilityModelFloor => &[Site {
                file: "src/engine/team_assignment_orchestrator.rs",
                marker: "if persona.model_profile.is_none() {",
                family: Some((Family::ModelProfileSubstitution, 1)),
            }],
            Self::PipelineNodeModelOverride => &[Site {
                file: "src/engine/pipeline_executor.rs",
                marker: "node_config.model_profile_override",
                family: Some((Family::ModelProfileSubstitution, 1)),
            }],
            Self::DryRunUseCaseOverride => &[Site {
                file: "src/engine/dry_run.rs",
                marker: "uc.get(\"model_override\")",
                family: Some((Family::ModelProfileSubstitution, 1)),
            }],
            Self::HealingForcedOpus => &[Site {
                file: "src/engine/healing_retry.rs",
                marker: "// 2. Force Claude Opus model for healing",
                family: Some((Family::ModelProfileSubstitution, 1)),
            }],
            Self::DirectorModelBackfill => &[Site {
                file: "src/engine/director.rs",
                marker: "Pin the Director's model on installs",
                family: None,
            }],
            Self::McpSetModelTool => &[Site {
                file: "src/mcp_server/tools.rs",
                marker: "personas_set_model",
                family: None,
            }],
            Self::EvolutionWinnerPromotion => &[Site {
                file: "src/engine/evolution.rs",
                marker: "Provenance: field-level change-log rows commit atomically",
                family: Some((Family::DurablePromptRewrite, 1)),
            }],
            Self::AiHealingPromptFix => &[Site {
                file: "engine/src/ai_healing.rs",
                marker: "\"system_prompt\" | \"instructions\" => {",
                family: Some((Family::DurablePromptRewrite, 3)),
            }],
            Self::AutoRollbackPromptRestore => &[Site {
                file: "src/engine/auto_rollback.rs",
                marker: "// Restore both fields atomically from the version snapshot.",
                family: Some((Family::DurablePromptRewrite, 1)),
            }],
            Self::PromptLabVersionRestore => &[Site {
                file: "src/commands/communication/observability/prompt_lab.rs",
                marker: "if let Some(ref sys) = version.system_prompt {",
                family: Some((Family::DurablePromptRewrite, 2)),
            }],
            Self::PersonaLabDraftAccept => &[Site {
                file: "src/commands/execution/lab.rs",
                marker: "// Apply draft prompt to the persona",
                family: Some((Family::DurablePromptRewrite, 1)),
            }],
            Self::PersonaLabVersionApply => &[Site {
                file: "src/commands/execution/lab.rs",
                marker: "// The core prompt fields (structured_prompt, system_prompt) are always",
                family: Some((Family::DurablePromptRewrite, 1)),
            }],
            Self::PersonaLabVersionRollback => &[Site {
                file: "src/commands/execution/lab.rs",
                marker: "snapshot predates them (mirrors lab_rollback_version)",
                family: Some((Family::DurablePromptRewrite, 1)),
            }],
            Self::BuildSessionMaterialize => &[Site {
                file: "src/commands/design/build_sessions.rs",
                marker: "solo_use_case_model_profile(ir)",
                family: Some((Family::DurablePromptRewrite, 1)),
            }],
            Self::ManagementApiDraftApply => &[Site {
                file: "src/engine/management_api.rs",
                marker: "// Apply draft to persona",
                family: Some((Family::DurablePromptRewrite, 1)),
            }],
            Self::EventHandlerWiring => &[Site {
                file: "db/src/repos/resources/triggers/event_wiring.rs",
                marker: "fn patch_persona_event_handler_in_tx(",
                family: Some((Family::DurablePromptRewrite, 2)),
            }],
            Self::EventTypeRename => &[Site {
                file: "db/src/repos/resources/triggers/event_wiring.rs",
                marker: "pub fn rename_event_type(",
                family: Some((Family::DurablePromptRewrite, 1)),
            }],
            Self::AmbientActivityPrepend => &[
                Site {
                    file: "src/engine/execution.rs",
                    marker: "format_ambient_for_persona(&ambient_ctx, &persona.id)",
                    family: Some((Family::AmbientPrepend, 1)),
                },
                Site {
                    file: "src/daemon/runtime.rs",
                    marker: "format_signals_for_prompt(&filtered, None)",
                    family: Some((Family::AmbientPrepend, 1)),
                },
            ],
            Self::CliSessionAwarenessPrepend => &[
                Site {
                    file: "src/engine/execution.rs",
                    marker: "cli_session_awareness::render::render_cli_session_for_prompt(",
                    family: Some((Family::AmbientPrepend, 1)),
                },
                Site {
                    file: "src/daemon/runtime.rs",
                    marker: "render::render_cli_session_for_prompt(&active, &turns, now)",
                    family: Some((Family::AmbientPrepend, 1)),
                },
            ],
            Self::PreparedRunCacheStaleness => &[Site {
                file: "engine/src/prepared_run_cache.rs",
                marker: "Episodes are DELIBERATELY absent",
                family: None,
            }],
            Self::HealingInputReplacement => &[Site {
                file: "src/engine/healing_retry.rs",
                marker: "// 3. Build healing input data",
                family: None,
            }],
            Self::RuleRetryFreshPersona => &[Site {
                file: "src/engine/healing_retry.rs",
                marker: "// 2. Load persona fresh from DB",
                family: None,
            }],
            Self::RuleRetryDropsInput => &[Site {
                file: "src/engine/healing_retry.rs",
                marker: "None, // retry uses no additional input",
                family: None,
            }],
            Self::TeamReworkInputInjection => &[Site {
                file: "src/engine/team_assignment_orchestrator.rs",
                marker: "input[\"rework_instruction\"]",
                family: None,
            }],
            Self::IncidentContinuationHint => &[Site {
                file: "src/engine/incident_continuation.rs",
                marker: "Some(Continuation::PromptHint(hint))",
                family: Some((Family::ContinuationProduced, 1)),
            }],
            Self::ResumeSuppressesRecallBlocks => &[Site {
                file: "src/engine/runner/mod.rs",
                marker: "let is_session_resume = matches!(continuation,",
                family: Some((Family::ContinuationProduced, 1)),
            }],
            Self::SkillsSidecarPromptTrim => &[Site {
                file: "src/engine/runner/mod.rs",
                marker: "install_sidecar",
                family: None,
            }],
            Self::ClaudeMdProjection => &[Site {
                file: "src/engine/runner/mod.rs",
                marker: "claude_md_projection",
                family: None,
            }],
            Self::DeliberationModeratorAgenda => &[Site {
                file: "src/engine/deliberation.rs",
                marker: "decision.next_speakers = decision",
                family: None,
            }],
            Self::TeamReviewReassign => &[Site {
                file: "src/engine/team_assignment_orchestrator.rs",
                marker: "pub fn resolve_review_reassign(",
                family: None,
            }],
            Self::AutoAssigneeResolution => &[Site {
                file: "src/engine/team_assignment_orchestrator.rs",
                marker: "fn resolve_assignee",
                family: None,
            }],
            Self::QaReworkBounce => &[Site {
                file: "src/engine/team_assignment_orchestrator.rs",
                marker: "trigger_qa_rework",
                family: None,
            }],
            Self::WarmPoolSessionReuse => &[Site {
                file: "src/commands/execution/executions.rs",
                marker: "Continuation::SessionResume(",
                family: Some((Family::ContinuationProduced, 1)),
            }],
            Self::ApiErrorResumeDrain => &[Site {
                file: "src/engine/execution.rs",
                marker: "Some(sid) => Some(types::Continuation::SessionResume(sid))",
                family: Some((Family::ContinuationProduced, 1)),
            }],
            Self::HealingSessionResume => &[Site {
                file: "src/engine/healing_retry.rs",
                marker: "Some(types::Continuation::SessionResume(session_id))",
                family: Some((Family::ContinuationProduced, 1)),
            }],
            Self::PersonaFailureBreaker => &[Site {
                file: "src/engine/healing_retry.rs",
                marker: "Circuit breaker tripped: disabling persona after",
                family: Some((Family::PersonaDisabled, 1)),
            }],
            Self::NoDeliveryBreaker => &[Site {
                file: "src/engine/execution.rs",
                marker: "fn check_and_apply_circuit_breaker(",
                family: Some((Family::PersonaDisabled, 1)),
            }],
            Self::KnowledgeHintOverridesRetry => &[Site {
                file: "core/src/healing.rs",
                marker: "kb_escalate",
                family: None,
            }],
        }
    }
}

// Evaluated at compile time — zero runtime cost.
const _: () = Mechanism::assert_all_covered();

/// Occurrences of a census [`Family`] that are deliberately **not** a
/// mechanism, with the reason. A non-member whose count stops matching fails
/// the census the same way an unregistered mechanism does: this list is a
/// ratchet, not an ignore file.
///
/// `(family, file relative to src-tauri/, occurrences, why it is not a member)`
pub const NON_MEMBERS: [(Family, &str, usize, &str); 7] = [
    (
        Family::ModelProfileSubstitution,
        "src/engine/runner/mod.rs",
        2,
        "the resolution cascade's own effective-config merge — this IS the decision, \
         not a mechanism that overrides it",
    ),
    (
        Family::ContinuationProduced,
        "src/engine/runner/mod.rs",
        5,
        "read side: the runner matching on a continuation it was handed. The one \
         producing-shaped occurrence in this file is claimed by \
         Mechanism::ResumeSuppressesRecallBlocks",
    ),
    (
        Family::ModelProfileSubstitution,
        "db/src/repos/resources/persona_change_log.rs",
        1,
        "test fixture inside an inline #[cfg(test)] module",
    ),
    (
        Family::DurablePromptRewrite,
        "db/src/repos/core/personas.rs",
        1,
        "test setup inside an inline #[cfg(test)] module (a lifecycle-backfill replay)",
    ),
    (
        Family::PersonaDisabled,
        "db/src/repos/core/personas.rs",
        1,
        "test setup inside an inline #[cfg(test)] module",
    ),
    (
        Family::AmbientPrepend,
        "engine/src/ambient_signal_repo.rs",
        1,
        "assertion inside an inline #[cfg(test)] module",
    ),
    (
        Family::AmbientPrepend,
        "engine/src/cli_session_awareness/mod.rs",
        1,
        "assertion inside an inline #[cfg(test)] module — the production call sites are in \
         src/engine/execution.rs and src/daemon/runtime.rs",
    ),
];

/// Files the census walk must reach before its absences mean anything.
///
/// Measured 2026-09-06: the four roots hold 1,150 non-test `.rs` files. A walk
/// that sees materially fewer has lost a root, and "found nothing" would then be
/// indistinguishable from "looked at nothing" — the failure
/// `scripts/census/lib/engine.mjs` exists to make loud.
pub const WALK_FLOOR: usize = 1_050;

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;
    use std::path::{Path, PathBuf};

    /// `src-tauri/` — one level above this crate's manifest.
    fn src_tauri() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("engine crate lives under src-tauri/")
            .to_path_buf()
    }

    /// Paths whose contents are not production code. Kept coarse and
    /// path-based: an inline `#[cfg(test)]` module is NOT skipped, because
    /// truncating a file at its first test module would hide any production
    /// code that follows it — a gate going blind while reading green. The five
    /// inline-test occurrences that survive are pinned in [`NON_MEMBERS`].
    ///
    /// `serving_overrides.rs` skips itself, and that is this census's one
    /// declared blind spot: the registry quotes every family needle as a string
    /// literal, so reading itself would count each needle as a violation of
    /// itself. The trade is safe only because this module holds no runtime
    /// writes — it is an enumeration and its test. If it ever grows one, this
    /// exemption stops being free.
    const SKIP: [&str; 7] = [
        "/tests/",
        "/__tests__/",
        "/tests.rs",
        "_tests.rs",
        "/migrations/",
        "/fixtures/",
        "/serving_overrides.rs",
    ];

    /// The crate source roots, as `(dir relative to src-tauri/, path prefix)`.
    const ROOTS: [&str; 4] = ["src", "engine/src", "core/src", "db/src"];

    fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                walk(&path, out);
            } else if path.extension().and_then(|e| e.to_str()) == Some("rs") {
                out.push(path);
            }
        }
    }

    /// Every production `.rs` file under the four roots, keyed by its
    /// `src-tauri/`-relative path with forward slashes.
    ///
    /// The [`WALK_FLOOR`] guard lives **here**, at the enumerator, and not only
    /// in the test that reports it: every caller below reasons about absences,
    /// and an absence measured by a walk that lost a root is not evidence of
    /// anything. This is `gate-without-empty-input-guard`'s rule
    /// (`docs/concepts/golden-paths/cross-artifact-drift-gate.md`) applied to
    /// the census that enforces this module.
    fn sources() -> BTreeMap<String, String> {
        let root = src_tauri();
        let mut map = BTreeMap::new();
        for r in ROOTS {
            let mut files = Vec::new();
            walk(&root.join(r), &mut files);
            for f in files {
                let rel = f
                    .strip_prefix(&root)
                    .expect("walked under src-tauri")
                    .to_string_lossy()
                    .replace('\\', "/");
                if SKIP.iter().any(|s| format!("/{rel}").contains(s)) {
                    continue;
                }
                let text = std::fs::read_to_string(&f).unwrap_or_default();
                map.insert(rel, text);
            }
        }
        assert!(
            map.len() >= WALK_FLOOR,
            "the census walked {} files, floor is {WALK_FLOOR} — a source root is missing, so \
             'found nothing' and 'looked at nothing' are no longer different outcomes",
            map.len()
        );
        map
    }

    fn count(text: &str, needle: &str) -> usize {
        text.matches(needle).count()
    }

    /// Occurrences of `family` in `text`.
    ///
    /// Literal needles, not regexes — see [`Family`]. `DurablePromptRewrite`
    /// needs a window check because the column name follows the statement head.
    fn family_hits(family: Family, text: &str) -> usize {
        match family {
            Family::ModelProfileSubstitution => count(text, ".model_profile = Some("),
            Family::DurablePromptRewrite => {
                let mut n = 0;
                let mut from = 0;
                while let Some(off) = text[from..].find("UPDATE personas SET") {
                    let start = from + off;
                    // The statement head ends at whichever comes first: the end
                    // of the SQL string literal, or a statement separator.
                    let end = text[start..]
                        .find('"')
                        .into_iter()
                        .chain(text[start..].find(';'))
                        .min()
                        .map(|d| start + d)
                        .unwrap_or(text.len());
                    let window = &text[start..end];
                    if window.contains("system_prompt") || window.contains("structured_prompt") {
                        n += 1;
                    }
                    from = start + 1;
                }
                n
            }
            Family::ContinuationProduced => {
                count(text, "Continuation::SessionResume(")
                    + count(text, "Continuation::PromptHint(")
            }
            Family::PersonaDisabled => {
                let mut n = count(text, "UPDATE personas SET enabled");
                let mut from = 0;
                while let Some(off) = text[from..].find("enabled: Some(false)") {
                    let start = from + off;
                    let back = start.saturating_sub(300);
                    if text[back..start].contains("UpdatePersonaInput") {
                        n += 1;
                    }
                    from = start + 1;
                }
                n
            }
            Family::AmbientPrepend => {
                count(text, "prepend_ambient_to_system_prompt(persona,")
                    + count(text, "prepend_ambient_to_system_prompt(&mut persona,")
            }
        }
    }

    const ALL_FAMILIES: [Family; 5] = [
        Family::ModelProfileSubstitution,
        Family::DurablePromptRewrite,
        Family::ContinuationProduced,
        Family::PersonaDisabled,
        Family::AmbientPrepend,
    ];

    #[test]
    fn the_walk_reaches_the_tree_it_claims_to_read() {
        let files = sources();
        assert!(
            files.len() >= WALK_FLOOR,
            "the census walked {} files, floor is {WALK_FLOOR} — a root is missing, and an \
             absence measured by a broken walk is not evidence of anything",
            files.len()
        );
    }

    #[test]
    fn every_registered_site_still_exists() {
        let files = sources();
        for m in Mechanism::ALL {
            for site in m.sites() {
                let text = files.get(site.file).unwrap_or_else(|| {
                    panic!(
                        "{m:?} claims a site in {} — that file is not in the census walk \
                         (moved, deleted, or now matched by SKIP)",
                        site.file
                    )
                });
                assert!(
                    text.contains(site.marker),
                    "{m:?}: marker {:?} is gone from {}. Either the mechanism moved (update \
                     the marker) or it was removed (delete the variant) — a registry entry \
                     pointing at code that is not there is worse than no entry.",
                    site.marker,
                    site.file
                );
            }
        }
    }

    #[test]
    fn no_two_mechanisms_share_a_marker_in_one_file() {
        // Distinct markers per (file, marker) keep `every_registered_site_still_exists`
        // from passing two variants on one line of code.
        let mut seen: BTreeMap<(&str, &str), Mechanism> = BTreeMap::new();
        for m in Mechanism::ALL {
            for site in m.sites() {
                if let Some(prev) = seen.insert((site.file, site.marker), m) {
                    panic!(
                        "{m:?} and {prev:?} both claim marker {:?} in {} — one of them is not \
                         a distinct mechanism",
                        site.marker, site.file
                    );
                }
            }
        }
    }

    #[test]
    fn every_family_matches_something() {
        let files = sources();
        for family in ALL_FAMILIES {
            let total: usize = files.values().map(|t| family_hits(family, t)).sum();
            assert!(
                total > 0,
                "census family {family:?} matched nothing anywhere. A matcher that finds \
                 nothing is assumed broken, not the tree assumed clean."
            );
        }
    }

    /// The completeness gate: every occurrence of every family shape must be
    /// claimed by a registered mechanism or pinned as a non-member.
    ///
    /// This is the test that fails when a thirteenth override mechanism is
    /// added without registering it — which is worth more than a test asserting
    /// today's count, because today's count is already written down above.
    #[test]
    fn every_override_shaped_site_is_registered_or_explained() {
        let files = sources();

        // Claimed: (family, file) -> count.
        let mut claimed: BTreeMap<(Family, &str), usize> = BTreeMap::new();
        for m in Mechanism::ALL {
            for site in m.sites() {
                if let Some((family, hits)) = site.family {
                    *claimed.entry((family, site.file)).or_default() += hits;
                }
            }
        }
        for (family, file, hits, _why) in NON_MEMBERS {
            *claimed.entry((family, file)).or_default() += hits;
        }

        let mut problems: Vec<String> = Vec::new();
        for family in ALL_FAMILIES {
            for (file, text) in &files {
                let found = family_hits(family, text);
                let expected = claimed.remove(&(family, file.as_str())).unwrap_or_default();
                if found != expected {
                    problems.push(format!(
                        "  {family:?} in {file}: found {found}, registry accounts for {expected}"
                    ));
                }
            }
        }
        // Anything left in `claimed` names a file the walk never produced.
        for ((family, file), hits) in claimed {
            problems.push(format!(
                "  {family:?} in {file}: registry accounts for {hits}, but the walk never \
                 read that file (stale path?)"
            ));
        }

        assert!(
            problems.is_empty(),
            "the serving-override registry no longer accounts for the tree:\n{}\n\n\
             A count that ROSE means a new mechanism that can change what serves a run was \
             added without registering it — add a `Mechanism` variant with its site, or, if \
             it genuinely cannot change what serves, add it to NON_MEMBERS with the reason. \
             A count that DROPPED means a mechanism was removed or a matcher broke; never \
             clear it without deciding which.",
            problems.join("\n")
        );
    }

    #[test]
    fn every_mechanism_is_described() {
        for m in Mechanism::ALL {
            assert!(!m.label().is_empty(), "{m:?} has no label");
            assert!(!m.sites().is_empty(), "{m:?} names no site");
            // `reach` and `trigger` are total matches; calling them proves the
            // variant is classified rather than falling through a `_` arm that
            // was never considered.
            let _ = m.dimension();
            let _ = m.reach();
            let _ = m.trigger();
        }
    }

    #[test]
    fn a_durable_change_is_never_only_this_run() {
        // The three mechanisms that write `personas` prompt columns are the
        // pair `healing_orchestrator`'s mutual-exclusion argument rests on
        // plus the manual path it does not know about. If any of them ever
        // reads as ThisRun the registry has lost the fact that matters.
        for m in [
            Mechanism::AiHealingPromptFix,
            Mechanism::AutoRollbackPromptRestore,
            Mechanism::PromptLabVersionRestore,
        ] {
            assert_eq!(
                m.reach(),
                Reach::AllFutureRuns,
                "{m:?} writes a persona prompt column; its reach is every future run"
            );
        }
    }

    #[test]
    fn the_registry_is_wider_than_the_four_partial_lists() {
        // The comparison study asserted twelve mechanisms across four partial
        // lists (`.ai/directions/2026-09-04-weave-router-comparison.md` §4.1).
        // Re-measured against the tree on 2026-09-06 the count is higher, and
        // this assertion is here so a future edit that quietly deletes half the
        // registry has to argue with a number.
        assert!(
            Mechanism::ALL.len() > 12,
            "the enumeration has shrunk below the study's asserted twelve — that is a claim \
             about the tree, not a tidy-up"
        );
        let autonomous = Mechanism::ALL
            .iter()
            .filter(|m| m.trigger() == Trigger::Autonomous)
            .count();
        assert!(
            autonomous > 12,
            "more than twelve of these fire without the operator asking; if that stops being \
             true, say so with a measurement"
        );
    }
}
