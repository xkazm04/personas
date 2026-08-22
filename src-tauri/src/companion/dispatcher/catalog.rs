//! The allow-lists. Every op name, route, lab mode, guided topic and
//! guidance anchor Athena may propose is enumerated here — an op outside
//! these tables is rejected before it can reach a database write.
//!
//! Moved verbatim out of the former single-file `dispatcher.rs`.

/// Allowed approval-creating actions. `open_route` is *not* listed here
/// — it's handled specially below (auto-fires a navigation event, no
/// approval card). The user wants chat-driven navigation to be smooth,
/// not gated by an explicit click each time.
pub(super) const ALLOWED_ACTIONS: &[&str] = &[
    "run_persona",
    "resolve_human_review",
    "update_identity",
    "write_fact",
    "delete_fact",
    // Phase D — procedurals/goals/rituals/backlog.
    "write_procedural",
    "delete_procedural",
    "write_goal",
    "update_goal_status",
    "delete_goal",
    "write_ritual",
    "set_ritual_active",
    "delete_ritual",
    "write_backlog_item",
    "resolve_backlog_item",
    // Phase F — advanced UI control.
    "prefill_persona_create",
    // `build_oneshot` is the autonomous sibling of `prefill_persona_create`
    // (auto_launch=true, mode=one_shot). It MUST be here or the dispatcher
    // silently drops the OP — Athena emits it (the constitution teaches it and
    // approvals.rs::execute_build_oneshot handles it on approve), but without
    // this entry no approval card is ever created and nothing builds.
    "build_oneshot",
    "run_arena",
    // Headless genome capabilities — the Lab descoped Breed/Evolve from the UI
    // (the consolidated Versions & Ratings table replaced the tab switcher), so
    // Athena is now the only surface that can drive them. Both are approval-
    // gated: they spawn compute-heavy background runs the user should confirm.
    "companion_breed_personas",
    "companion_evolve_persona",
    // `compose_dashboard` is auto-fire — handled below alongside
    // `open_route` / `open_lab`. No approval card; the user already
    // asked for the dashboard, the click is friction.
    // `use_connector` is intentionally NOT in this always-approve list —
    // it is gated PER CAPABILITY in the special-case match arm below:
    // write/mutation capabilities (`ConnectorCapability::requires_approval`
    // = true — send_message, post_message, delete_page, write_text_file,
    // execute_mutation, …) route through an approval card; read-only ones
    // (list_*, get_*, count_*) auto-fire through the background-job worker so
    // they don't block the chat. (UAT F-MAJOR-7 mis-read the old "auto-fires,
    // no approval card" wording here as "writes fire unattended" — they do
    // not; the invariant is locked by `every_write_capability_requires_approval`
    // in connectors.rs.)
    // Cross-device link (WP3) — hand an instruction to another of the user's
    // OWN paired devices, where that device's Athena runs it as a real turn.
    // NOT `p2p`-gated here on purpose: the surface (this list, the lifecycle
    // arm, the constitution) is identical in a lite build so the parity tests
    // assert one shape, and the executor answers honestly when the transport
    // is absent. Its consent rule is mode-conditional and lives in
    // `approval_exec_devices::gate_remote_instruct`, NOT in
    // `AUTOAPPROVE_ALLOWLIST` (which has no conditional form).
    "remote_instruct",
    // Phase G — project registry + background jobs.
    "register_project",
    "enqueue_dev_job",
    // Dev Runner (Dev Tools → Run Desk) — the second execution lane. Same
    // grammar as the fleet ops: approval-gated, containment via the registered
    // dev project, never on the autoapprove allowlist.
    "enqueue_runner_task",
    // Open a registered dev project's configured test-environment URL in the
    // browser. Goes through approval (not auto-fire) so the user confirms the
    // launch; execute_open_test_env resolves the project and returns an
    // OpenExternalUrl client_action.
    "open_test_env",
    // Goals hub — propose a dev-goal progress/status update (approval-gated).
    "update_dev_goal",
    // KPI layer (the outcome steering above goals). All three go through
    // approval because they change what the autonomous loop optimizes for:
    //   - calibrate_kpi: adjust a KPI's target/date/tier/cadence/status or its
    //     warn/critical lines — the lever that decides when a goal gets derived.
    //   - evaluate_kpi: measure a KPI now (a codebase/connector run has cost).
    //   - scan_kpis: propose new KPIs for a project (an LLM scan, cost).
    //   - propose_kpi: configure ONE specific KPI from a guided conversation
    //     (create it as a proposal + background measurement setup).
    "calibrate_kpi",
    "evaluate_kpi",
    "scan_kpis",
    "propose_kpi",
    // Athena's future check-in commitments. Goes through approval
    // because it puts a future obligation on the user's attention —
    // unlike connector calls (real-world action that runs once on
    // pinned credentials the user already greenlit), scheduling a
    // proactive ping needs explicit "yes, ping me about this then"
    // consent.
    "schedule_proactive",
    // Phase C3 — Team-assignment dispatch. User says "have the X team
    // handle Y" → Athena emits propose_action{action:"assign_team",
    // params:{team_id,goal,title?}}. Goes through approval because the
    // operation spawns multiple persona executions in parallel (real
    // tool calls + LLM cost via subscription). Approval body is the
    // proposed step list the user can review before clicking Approve.
    "assign_team",
    // Phase J — Fleet integration (companion ↔ Claude Code workers).
    // All four go through approval because every one of them moves
    // a real subprocess (writing keystrokes, killing it, spawning
    // a new one). Single approval click is the user's "yes, do that"
    // for one batched fleet operation.
    "fleet_send_input",
    "fleet_broadcast",
    "fleet_kill",
    "fleet_spawn",
    // Direction 5 (v2) — multi-session dispatch under one Operation.
    // One ApprovalCard, N sessions, one wrap-up; the reconciler in
    // commands/companion/fleet_bridge.rs synthesizes the final
    // summary once every dispatched session has exited.
    "fleet_dispatch",
    // Direction 9 — mid-flight intervention. The proactive evaluator
    // proposes one of these when a session belonging to a
    // `dispatched_by_athena` op gets stuck (recent_failure set + no
    // checkpoint in N minutes). Cap of one intervention per session
    // is enforced in operative_memory::record_intervention.
    "fleet_intervene",
    "fleet_redirect_op",
    // Phase 4 — autonomous session recovery. `fleet_wake` revives a hibernated
    // session (resume via `--resume`); `fleet_resume` adopts an orphaned CLI
    // process the registry lost. Confidence-gated on the autonomous autoapprove
    // path (approvals::AUTOAPPROVE_ALLOWLIST); both fail closed on a bad target.
    "fleet_wake",
    "fleet_resume",
    // Fleet/team analysis — a manually-requested "how are the teams doing?"
    // review. Spawns a proactive Athena reasoning turn over the fleet
    // (executions, outcomes, Director verdicts, goal progress) using the
    // certification rubric, and asks her to write a per-team timeline note to
    // memory + propose improvements. Approval-gated because it spawns a CLI
    // reasoning turn (cost) — same rationale as run_persona / assign_team.
    "analyze_fleet",
    // Live browser test of a dev project's test environment. Approval-gated
    // twice over: it spawns a CLI reasoning turn (cost) AND that turn drives
    // a real browser via Playwright MCP (clicks, navigation, form input on
    // the user's machine). execute_run_browser_test resolves the target URL
    // and spawns the proactive browser_test turn.
    "run_browser_test",
    // DEV MODE (debug builds + companion_dev_mode only; executors refuse
    // otherwise) — Athena's self-development loop over the app's own repo
    // (docs/tests/athena/dev-mode-direction.md). `dev_improve` dispatches a
    // coding CLI fleet session at the source checkout (frontend → main
    // checkout/HMR, backend → isolated worktree); `dev_merge` is the
    // explicit handshake that applies a backend run's branch to the live
    // checkout. Both are DELIBERATELY absent from AUTOAPPROVE_ALLOWLIST —
    // per user policy dev-mode operations never auto-fire, every change is
    // click-approved, and each run ends in a reflection turn.
    "dev_improve",
    "dev_merge",
    // Workstream 2 — "Send to Athena". A batch of accept/reject verdicts over
    // selected `dev_ideas`, produced by `dev_tools_athena_triage_batch` (a
    // headless micro-tier turn) and persisted as a pending approval so the
    // verdicts are durable, expire through the consent-freshness window, and
    // still need a human click. Listed here so the row validates + renders like
    // every other approval; Athena does NOT emit this op from chat (the
    // Backlog's button is the only producer today — an Athena-proposable
    // `triage_backlog` op is a deliberate later step).
    "backlog_apply_triage",
    // WP2 — acting ON the Mastermind canvas. These three are thin
    // slug-resolving wrappers, NOT new privileged surface: each one turns the
    // canvas slugs Athena can actually see into the SAME `FleetPlanRow` shape
    // the chat plan card produces, then hands off to the existing
    // `execute_fleet_spawn` / `execute_fleet_dispatch` executors, whose
    // `validate_fleet_cwd` containment is unchanged and un-widened. What they
    // add over a bare `fleet_spawn` is the canvas-specific refusals: a
    // `demo-*` island resolves to nothing real, and a group dispatch is
    // sequential and capped.
    "canvas_dispatch",
    "canvas_group_dispatch",
    "canvas_run_idea_scan",
    // Skills + Knowledge ops (2026-08-10) — Athena operating over the skill
    // fleet and the workspace knowledge library. `skill_sync` moves ONE skill
    // between the library and project copies (adopt/sync/publish; pure file
    // ops, guarded in approval_exec_knowledge.rs — customized copies are
    // never overwritten, publish must be a version bump). The read halves
    // (`describe_skill_fleet`, `describe_knowledge`) are READ_OPS above.
    "skill_sync",
    // `run_pattern_harvest` dispatches per-territory Fleet harvest sessions
    // into a workspace member repo (same snapshot writer, same governed
    // ingest door as the Workspaces UI; results land `observed` for human
    // review). Starts terminals, so it is containment-checked through
    // `validate_fleet_cwd` like every other spawn.
    "run_pattern_harvest",
    // `apply_pattern` dispatches ONE session that implements ADOPTED patterns
    // (or an active playbook) in a target repo. The session changes code and
    // commits; adoption/adherence records only move through the verify lane —
    // applying observed proposals is refused so Athena can never become the
    // adopter.
    "apply_pattern",
    // `evaluate_pattern` starts the EXISTING adoption-verification pass over a
    // target project (headless session, verdicts + file citations through the
    // verify lane's evidence door; surface-never-auto-un-adopt). Approval-
    // gated because it spawns a reasoning session (cost).
    "evaluate_pattern",
];

/// Auto-fire, read-only detail lookups. Each one answers "what is this
/// thing, exactly" for an entity kind whose always-on prompt index is
/// deliberately truncated (personas, dev contexts, skills) or absent
/// entirely (teams — `assign_team` needs a `team_id` the index never
/// carries). Handled by their own dispatch arm; NOT in `ALLOWED_ACTIONS`,
/// because they need no executor and no approval card.
pub(super) const READ_OPS: &[&str] = &[
    "describe_persona",
    "describe_context",
    "describe_skill",
    "list_teams",
    // WP2 — the Mastermind canvas. The always-on scene digest lists only the
    // cells that are NOT fine and truncates for budget, so these two are its
    // other half: the full fifteen-cell detail for one island, and the
    // freshness / rollup layer (idea-scan age, ongoing goals, KPI standing)
    // the digest compresses into a single clause. Both read the published
    // scene snapshot; neither mutates anything.
    "describe_canvas_project",
    "describe_canvas_freshness",
    // Dev Runner (Dev Tools → Run Desk). The runner queue was invisible to
    // Athena — she could dispatch Fleet sessions all day and had no idea what
    // was already queued or running on the OTHER execution lane, which is how
    // duplicate work gets started. Read-only; the enqueue side is
    // approval-gated (`enqueue_runner_task`).
    "list_runner_tasks",
    // Skills + Knowledge ops (2026-08-10). The two cross-project surfaces
    // Athena orchestrates over: which skill sits at which version in which
    // repo (drift is what `skill_sync` acts on), and what the workspace
    // knowledge library holds (adopted patterns / playbooks / harvest
    // coverage debt — what `run_pattern_harvest` / `apply_pattern` act on).
    // Handlers live in `companion::knowledge_ops`; both answer without a
    // query (the digest) and take one for detail.
    "describe_skill_fleet",
    "describe_knowledge",
];

/// Read ops whose `query` param is optional (they answer for everything when
/// it is empty). Everything else is rejected without one, because a lookup
/// with no target is a model that forgot what it was asking about.
pub(super) const READ_OPS_QUERY_OPTIONAL: &[&str] = &[
    "list_teams",
    "describe_canvas_freshness",
    "list_runner_tasks",
    "describe_skill_fleet",
    "describe_knowledge",
];

/// Longest accepted lookup string. A name or a UUID; anything longer is a
/// model pasting prose into the param.
pub(super) const READ_OP_QUERY_MAX: usize = 200;

/// Hard cap on the System episode a read op writes back. Detail-on-demand
/// is only cheaper than a fat prompt if the answer is itself bounded.
pub(super) const READ_OP_DETAIL_CHARS: usize = 1600;

/// Rows a single `list_teams` answer may carry.
pub(super) const LIST_TEAMS_MAX_ROWS: usize = 25;

/// Characters held back from [`READ_OP_DETAIL_CHARS`] for the `list_teams`
/// "N of M" footer, so truncation can never eat the honesty line.
pub(super) const LIST_TEAMS_FOOTER_RESERVE: usize = 180;

/// Fuzzy-match candidates offered when a lookup misses. Shared with the
/// card-op validators (`approval_exec_ship`), so a rejection anywhere in the
/// op surface offers the same number of real alternatives.
pub(crate) const READ_OP_SUGGESTIONS: usize = 5;

/// Lab modes valid for `open_lab`. Mirrors the `lab-mode-*` testids in
/// `src/features/agents/sub_lab/components/shared/LabTab.tsx`.
pub(super) const ALLOWED_LAB_MODES: &[&str] = &[
    "arena",
    "ab",
    "matrix",
    "breed",
    "evolve",
    "versions",
    "regression",
];

/// Allowed sidebar routes for `open_route`. Mirrors the SidebarSection
/// type on the frontend; mismatches get rejected with a warning so a
/// hallucinated route doesn't crash the navigation handler.
///
/// `monitor` is a pseudo-route — not a sidebar section. The frontend
/// navigate handler special-cases it to open the full-screen Persona
/// Monitor overlay (fleet-wide review + activity grid).
pub(super) const ALLOWED_ROUTES: &[&str] = &[
    "home",
    "overview",
    "personas",
    "events",
    "credentials",
    "design-reviews",
    "plugins",
    "schedules",
    "settings",
    "monitor",
    // `mastermind` is a pseudo-route like `monitor` — it resolves to Teams →
    // Mastermind. It earns a route of its own because Athena can already
    // read, annotate, compose on and steer that canvas, and had no way to
    // simply take you there; and because arriving is what makes the canvas
    // publish its scene, which is the snapshot every one of those ops reads.
    "mastermind",
];

/// Topics Athena may trigger via `start_guided_walkthrough`. Mirrors the
/// frontend registry keys in `guidance/walkthroughs.ts` (`GUIDANCE_TOPICS`).
/// A topic not listed here is rejected with a warning so a hallucinated
/// walkthrough name can't drive the orb to nowhere.
pub(super) const GUIDED_TOPICS: &[&str] = &[
    "persona_creation",
    "connector_setup",
    "trigger_creation",
    "template_adoption",
    "incident_triage",
    "goal_kpi_setup",
];

/// Anchors Athena may target via `point_at` / `compose_walkthrough`. An anchor
/// not listed here is rejected so a hallucinated selector can't drive the orb to
/// an arbitrary or sensitive element. **Code-generated** from the frontend
/// catalog (`guidance/anchorCatalog.ts`) by `scripts/generate-guidance-anchors.mjs`
/// so the TS source of truth and this Rust allow-list can never drift.
pub(super) use crate::companion::generated_anchors::GUIDANCE_ANCHORS as ANCHOR_IDS;

/// A composed walkthrough should be a *short* tour. One stop is `point_at`'s
/// job; more than this reads as a slideshow the user won't sit through.
pub(super) const COMPOSE_MIN_STEPS: usize = 2;
pub(super) const COMPOSE_MAX_STEPS: usize = 6;
