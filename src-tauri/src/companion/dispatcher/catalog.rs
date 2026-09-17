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
    // Ship layer (2026-08-20) — the two verbs the Ship tab gives a human, given
    // to Athena as well. `set_ship_scope` moves members between core/later/never
    // or drops them; `ship_milestone_lifecycle` cuts (freezing the scope) or
    // ships. Both are approval actions, so manual mode waits on a click — and
    // because autonomous mode fires everything, the SHIP transition carries its
    // own DB-checkable precondition in the executor rather than trusting a human
    // to be watching (`approval_exec_ship`). Creating a milestone stays the
    // editable `show_ship_milestone` card, which is not an ALLOWED_ACTIONS entry.
    // Neither is `show_ship_goals` (2026-08-25) — the third card op, and the
    // only one that can CREATE a goal rather than bind an existing one.
    "set_ship_scope",
    "ship_milestone_lifecycle",
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
    // Credentials that need the operator: a credential whose OAuth grant was
    // revoked or expired is flagged `needs_reauth` in its ledger, and only the
    // operator can re-consent — the re-auth opens THEIR browser at the
    // provider. So this op is a hand-off, not an action Athena performs:
    // approving it navigates to the Vault with the credential focused and the
    // reconnect armed (`ClientAction::ReconnectCredential`). It is approval-
    // gated and deliberately NEVER auto-fires (see the arm in
    // `approval_autopilot::auto_resolve_if_allowed`) — an autonomous mode that
    // could throw a browser window at an absent operator is a worse outcome
    // than a card that waits.
    "reconnect_credential",
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
    // Skills op (2026-08-10) — Athena operating over the skill fleet.
    // `skill_sync` moves ONE skill between the library and project copies
    // (adopt/sync/publish; pure file ops, guarded in approval_exec_knowledge.rs
    // — customized copies are never overwritten, publish must be a version
    // bump). The read half (`describe_skill_fleet`) is a READ_OP. The three
    // knowledge-library actions that sat here (`run_pattern_harvest`,
    // `apply_pattern`, `evaluate_pattern`) were retired with the in-app
    // Workspace Knowledge library.
    "skill_sync",
    // Browser control (spark browser-control, WP3). THREE ops, one rule: a
    // page WRITE is never Athena's to fire. Reads and navigation inside the
    // Whitelist auto-fire through the bridge's MCP surface and never become a
    // card at all, so the only browser traffic that reaches this list is the
    // traffic the operator must decide.
    //
    // `browser_act` carries ONE page write (`browser_click|type|select|submit|
    // call_page_tool` — the closed set in
    // `approval_exec_browser::BROWSER_WRITE_TOOLS`, validated at the dispatch
    // arm AND again at the executor, because the two doors stop different
    // things: a hallucinated tool never becomes a card, and a replayed payload
    // never reaches a backend). `browser_login` is executed BY Rust with the
    // vault credential the operator bound to the origin — the op carries no
    // value and its grammar has no field one could ride in
    // (browser-credential-boundary: the broker attaches the secret).
    // `browser_request_site` is the one move an agent has when a page is off
    // the list: it asks, and the operator's approval is what enables the row.
    //
    // None of the three is exempt from anything on the autonomous path.
    // `AUTOAPPROVE_ALLOWLIST` no longer exists (it was removed 2026-08-10 —
    // autonomous mode IS the standing consent), so "off the allowlist" is not
    // a thing that can be said about an op any more; what bounds these is the
    // gate itself — the Whitelist row, the tighten-only override, the
    // per-origin budget and the tab lease — which runs on both consent paths.
    "browser_act",
    "browser_login",
    "browser_request_site",
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
    // Skills op (2026-08-10): which skill sits at which version in which repo
    // (drift is what `skill_sync` acts on). The handler lives in
    // `companion::knowledge_ops`; it answers without a query (the digest) and
    // takes one for detail.
    "describe_skill_fleet",
    // Ship layer (2026-08-20). She could PROPOSE a whole milestone
    // (`show_ship_milestone`) long before she could read one, so her only move
    // in a conversation about the NEXT milestone was to propose a brand-new
    // cut. This is the other half: the live cut, its buckets, the operator's
    // own notes and ratings, and the bound goals. It deliberately does NOT
    // restate the exit-criteria verdicts — those derive client-side from
    // runtime signals the DB cannot see, and a second derivation here would
    // drift from the one on his screen. See `companion::ship_ops`.
    "describe_ship_milestone",
    // Her own memory pipeline (2026-08-26). When recall comes back empty she
    // had no way to tell a cold brain from a dark embedder from a build with
    // no vector lane, so the honest answer ("I don't know why I don't
    // remember") was unavailable and she guessed instead. Reads counters and
    // returns the single first blocking cause with its fix. Takes no query —
    // there is only one brain. See `companion::brain::health`.
    "describe_brain_health",
    // The Notepad (2026-09-05). A note is a scratch requirement the operator
    // writes in the pad; she can turn one into goals (`show_ship_goals` with a
    // `note_id`) and propose edits back into it (`show_note_suggestions`), and
    // both are decompositions of something she must have READ. Without this op
    // the only way to get a note in front of her was to paste the body into the
    // turn — stale the moment it is composed, and paid for every turn after.
    // The answer also carries the project's OPEN milestone, which is the
    // `milestone_id` the goals card needs. See `companion::note_ops`.
    "describe_note",
    // Browser control (WP3). The read half of the three browser ops above:
    // which backend is up, which tabs are leased and by whom, and the
    // Whitelist itself (enabled / tier / scan status / budget / whether a
    // credential is bound). She needs it BEFORE proposing a write, because
    // every refusal the gate can answer with — origin_not_allowed,
    // origin_disabled, budget_exhausted, tab_leased — is visible here first,
    // and a proposal that was always going to be refused costs the operator a
    // card for nothing.
    //
    // It reads process statics and the app DB, so it answers even when no
    // browser turn is running. What it deliberately does NOT carry is the
    // open-tab list: tabs live in Tauri managed state behind an `AppHandle`
    // the synchronous dispatcher does not have. That list reaches her through
    // the MCP `browser_status` TOOL inside a browser turn, which is the
    // surface that holds a session.
    "browser_status",
];

/// Read ops whose `query` param is optional (they answer for everything when
/// it is empty). Everything else is rejected without one, because a lookup
/// with no target is a model that forgot what it was asking about.
pub(super) const READ_OPS_QUERY_OPTIONAL: &[&str] = &[
    "list_teams",
    "describe_canvas_freshness",
    "list_runner_tasks",
    "describe_skill_fleet",
    "describe_brain_health",
    // There is one browser, one Whitelist and one lease table — a query
    // would have nothing to select.
    "browser_status",
];

/// Longest accepted lookup string. A name or a UUID; anything longer is a
/// model pasting prose into the param.
pub(super) const READ_OP_QUERY_MAX: usize = 200;

/// Hard cap on the System episode a read op writes back. Detail-on-demand
/// is only cheaper than a fat prompt if the answer is itself bounded.
pub(super) const READ_OP_DETAIL_CHARS: usize = 1600;

/// The one read op that answers with more than a lookup, and its own budget.
///
/// 1600 was sized for "what is this thing, exactly" — one persona, one context,
/// one skill. `describe_ship_milestone` is a different shape by design: it
/// REPLACED a ~100-line briefing that the Ship tab used to paste into the turn,
/// so it carries the objective's prose, the live exit-criteria verdicts, the cut
/// by bucket, the bound goals and the doctrine for acting on all of it.
///
/// Measured 2026-08-25 on a realistic milestone (a 430-character brief, five
/// criteria, an empty cut): **3,092 characters against a 1,600 cap**. What the
/// envelope was cutting was the entire tail — the `set_ship_scope` /
/// `ship_milestone_lifecycle` op list, the DECOMPOSING IT doctrine, and the
/// investigate-before-you-ask rule. That truncation was silent, it predates the
/// 2026-08-25 work, and it meant the op's closing guidance had likely never
/// reached a turn in its life.
///
/// This is still a bound, not an exemption. The op caps its own two unbounded
/// inputs (the brief and each member's note) so a realistic answer fits here
/// with room to spare; see `ship_ops::answer_fits_its_budget`.
pub(crate) const READ_OP_DETAIL_CHARS_SHIP: usize = 6000;

/// How many characters a given read op's answer may carry into the next turn.
///
/// A match rather than a constant because the answers are genuinely different
/// shapes, and a single number sized for the smallest one silently guillotines
/// the largest.
pub(crate) fn read_op_detail_budget(action: &str) -> usize {
    match action {
        "describe_ship_milestone" => READ_OP_DETAIL_CHARS_SHIP,
        "describe_note" => READ_OP_DETAIL_CHARS_NOTE,
        _ => READ_OP_DETAIL_CHARS,
    }
}

/// `describe_note`'s budget. Same reasoning as the Ship one above and the same
/// discipline: the op caps its ONE unbounded input (the note body, at
/// `note_ops::NOTE_BODY_CAP` = 4,000 characters) so a realistic answer plus its
/// project/milestone header and its closing doctrine fit here with room to
/// spare. 1,600 would guillotine the tail of any note longer than a paragraph
/// — and the tail is where the "body edits only apply while it is a DRAFT"
/// rule lives, which is the one line that stops her proposing edits that
/// cannot be applied.
pub(crate) const READ_OP_DETAIL_CHARS_NOTE: usize = 6000;

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

// ── The compact op reference (chat-class prompt family) ─────────────────
//
// The constitution teaches every op in prose, at ~147 KB. The chat-class
// prompt family (`prompt::chat_family`) cannot carry that, so it carries THIS:
// one line per op — name, intent, exact `params` shape, gate — generated from
// the same tables the dispatcher validates against, so the reference can
// never name an op the dispatcher would drop, and a new catalog entry without
// a doc row fails `every_catalog_op_has_a_reference_row_and_vice_versa`
// instead of silently going untaught.

/// How an op reaches the world once the dispatcher accepts it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum OpGate {
    /// Lands as an approval card; nothing runs until the user clicks.
    Approval,
    /// Fires immediately, no card (navigation, reads, compositions).
    Auto,
    /// Read-only lookup; auto-fires; the answer lands as a system note on
    /// the next turn.
    Read,
    /// Draws an editable card in the chat; the card IS the consent surface
    /// and nothing is written until the user confirms it.
    Card,
    /// Created by the system, never by Athena from chat.
    System,
}

impl OpGate {
    fn label(self) -> &'static str {
        match self {
            OpGate::Approval => "approval",
            OpGate::Auto => "auto",
            OpGate::Read => "read",
            OpGate::Card => "card",
            OpGate::System => "system-only",
        }
    }
}

/// One op's reference row. `params` is the exact JSON shape of the
/// envelope's `params` field, written the way the constitution writes it
/// (`<placeholder>` for values, `a|b` for enums, `?` suffix for optional).
pub(crate) struct OpDoc {
    pub(crate) name: &'static str,
    pub(crate) intent: &'static str,
    pub(crate) params: &'static str,
    pub(crate) gate: OpGate,
}

/// Auto-fire actions handled by their own dispatch arms — the ones that are
/// in NEITHER `ALLOWED_ACTIONS` (no approval card) nor `READ_OPS` (they are
/// not lookups). Enumerated here so the reference renderer and its
/// completeness test have one list to walk; the dispatch arms in
/// `dispatch.rs` remain the source of truth for behaviour.
#[cfg(test)]
pub(super) const AUTO_FIRE_ACTIONS: &[&str] = &[
    "open_route",
    "open_lab",
    "use_connector",
    "compose_dashboard",
    "compose_cockpit",
    "explain_in_cockpit",
    "compose_canvas_panel",
    "canvas_control",
    "continue_autonomously",
    "show_fleet_plan",
    "show_ship_milestone",
    "show_ship_goals",
    "show_note_suggestions",
    "show_persona_overview",
    "show_connected_services",
    "show_decisions",
    "show_recent_decisions",
    "show_design_capabilities",
    "show_persona_ready",
    "show_decision_log",
    "show_observability_plan",
    "show_model_tier_choice",
    "show_trigger_set",
    "show_use_case_set",
    "show_browser_test_report",
    "show_template_suggestions",
    "show_persona_walkthrough",
    "show_persona_creation_offer",
    "show_walkthrough_offer",
    "start_guided_walkthrough",
    "point_at",
    "compose_walkthrough",
    "compose_tour",
];

/// A reference section: a heading and the ops that belong under it, in the
/// order they are taught. Sections group by *what the user is doing*, not by
/// gate, because that is how a model looks an op up mid-reply.
struct OpSection {
    title: &'static str,
    /// The gate every op in this section has unless its row says otherwise;
    /// rows matching it print no label, which is most of the reference.
    gate: Option<OpGate>,
    /// Section-level doctrine printed once under the title: the shared
    /// enums and rules a compact section's rows lean on.
    note: &'static str,
    /// A compact section renders its ops as one paragraph of
    /// `name` `shape` pairs with no per-op intent: the families a chat
    /// turn reaches for rarely (fleet, canvas, browser, design cards), where
    /// a full row each would spend the family's budget on the long tail.
    compact: bool,
    ops: &'static [OpDoc],
}

macro_rules! op {
    ($name:literal, $gate:ident, $intent:literal, $params:literal) => {
        OpDoc {
            name: $name,
            intent: $intent,
            params: $params,
            gate: OpGate::$gate,
        }
    };
}

const OP_SECTIONS: &[OpSection] = &[
    OpSection {
        title: "Reads through wired sources, and navigation",
        gate: None,
        note: "",
        compact: false,
        ops: &[
            op!("use_connector", Auto, "a pinned connector or always-on builtin; reads run as a background job, writes become an approval card", r#"{"connector_name":"<slug>","capability":"<slug>","args":{...}}"#),
            op!("open_route", Auto, "navigate", r#"{"route":"home|overview|personas|events|credentials|design-reviews|plugins|schedules|settings|monitor|mastermind"}"#),
            op!("open_lab", Auto, "a persona's Lab", r#"{"persona_id":"<uuid>","mode":"arena|ab|matrix|breed|evolve|versions|regression"}"#),
            op!("open_test_env", Approval, "a project's test-environment URL", r#"{"project_name":"<name>"}"#),
        ],
    },
    OpSection {
        title: "Memory and self (all approval)",
        gate: Some(OpGate::Approval),
        note: "",
        compact: false,
        ops: &[
            op!("write_fact", Approval, "a durable fact; sources never empty", r#"{"scope":"user|project|world","key":"<slug>","value":"<one paragraph>","sources":["ep_<id>"],"importance":1-5,"confidence":0.0-1.0}"#),
            op!("delete_fact", Approval, "retire a fact", r#"{"id":"fact_<id>"}"#),
            op!("write_procedural", Approval, "a durable rule for yourself", r#"{"scope":"chat|action|memory|build","trigger":"<when>","behavior":"<what>","sources":["ep_<id>"],"importance":1-5,"confidence":0.0-1.0}"#),
            op!("delete_procedural", Approval, "retire a rule", r#"{"id":"proc_<id>"}"#),
            op!("write_goal", Approval, "a goal HE is working toward (his list, not a dev project's)", r#"{"title":"<short>","description":"<full>","priority":1-5,"target_date?":"<ISO8601>"}"#),
            op!("update_goal_status", Approval, "move one of HIS goals; a dev-project goal is `update_dev_goal`", r#"{"id":"goal_<id>","status":"active|paused|completed|abandoned"}"#),
            op!("delete_goal", Approval, "drop one of his goals", r#"{"id":"goal_<id>"}"#),
            op!("write_ritual", Approval, "a recurring pattern", r#"{"kind":"quiet_hours|cadence|focus_window","description":"<what>","schedule":{<DSL>}}"#),
            op!("set_ritual_active", Approval, "pause or resume", r#"{"id":"rit_<id>","active":true|false}"#),
            op!("delete_ritual", Approval, "remove a ritual", r#"{"id":"rit_<id>"}"#),
            op!("write_backlog_item", Approval, "a self-promise or capability gap", r#"{"kind":"self_promise|capability_gap","summary":"<one line>","source_episode_id":"ep_<id>"}"#),
            op!("resolve_backlog_item", Approval, "close one", r#"{"id":"blog_<id>","dropped":false}"#),
            op!("update_identity", Approval, "append to his identity file", r#"{"diffs":[{"section":"<heading>","op":"append","new_text":"<bullet (ep_id)>","rationale":"<why>"}]}"#),
            op!("schedule_proactive", Approval, "ping him at a time; a real ask, not a musing", r#"{"message":"<what you will say>","when_iso":"<ISO8601 UTC>"}"#),
        ],
    },
    OpSection {
        title: "Agents, reviews, teams (all approval)",
        gate: Some(OpGate::Approval),
        note: "",
        compact: false,
        ops: &[
            op!("run_persona", Approval, "run an agent now", r#"{"persona_id":"<uuid>","input?":"<text>"}"#),
            op!("resolve_human_review", Approval, "decide a pending review", r#"{"review_id":"<uuid>","decision":"approved|rejected","comment?":"<text>"}"#),
            op!("assign_team", Approval, "hand a goal to a team (`list_teams` first)", r#"{"team_id":"<uuid>","goal":"<one paragraph>","title?":"<short>"}"#),
            op!("run_arena", Approval, "compare models on a persona", r#"{"persona_id":"<uuid>","models":[{"id":"<model>"}]}"#),
            op!("companion_breed_personas", Approval, "cross-breed personas (heavy run)", r#"{"parent_ids":["<uuid>","<uuid>"],"fitness_objective":{"speed":0.2,"quality":0.6,"cost":0.2},"mutation_rate":0.15,"generations":1}"#),
            op!("companion_evolve_persona", Approval, "one evolve cycle", r#"{"persona_id":"<uuid>"}"#),
            op!("analyze_fleet", Approval, "rubric-graded review of the teams (propose it; no rubric needed in hand)", r#"{"team_id?":"<uuid>","days?":14}"#),
            op!("prefill_persona_create", Approval, "open the persona editor prefilled", r#"{"intent":"<one paragraph>","name?":"<short>","auto_launch":true|false,"mode":"interactive|one_shot"}"#),
            op!("build_oneshot", Approval, "build a persona unattended from a clear intent", r#"{"intent":"<one paragraph>","name?":"<short>"}"#),
        ],
    },
    OpSection {
        title: "Dev projects, jobs, goals, KPIs (all approval)",
        gate: Some(OpGate::Approval),
        note: "",
        compact: false,
        ops: &[
            op!("register_project", Approval, "track a repo", r#"{"name":"<short>","path":"<repo root>"}"#),
            op!("enqueue_dev_job", Approval, "background job on a project", r#"{"kind":"scan_codebase","project_name":"<name>"}"#),
            op!("enqueue_runner_task", Approval, "queue a Dev Runner task (`list_runner_tasks` first)", r#"{"title":"<short>","description":"<what>","goal_id?":"<dev goal id>"}"#),
            op!("update_dev_goal", Approval, "a DEV-PROJECT goal (ids like g_..., from Project goals)", r#"{"goal_id":"<id>","status?":"open|in-progress|blocked|done","progress?":0-100,"note?":"<one line>"}"#),
            op!("calibrate_kpi", Approval, "a KPI's target, date, tier, cadence, status, warn/crit", r#"{"kpi_id":"<id>","target_value?":<n>,"target_date?":"YYYY-MM-DD","tier?":"north_star|primary|supporting","cadence?":"manual|daily|weekly","status?":"active|paused|archived","warn_at?":<n>,"crit_at?":<n>}"#),
            op!("evaluate_kpi", Approval, "measure a KPI now", r#"{"kpi_id":"<id>"}"#),
            op!("scan_kpis", Approval, "propose KPI candidates (LLM scan)", r#"{"project_name":"<name>"}"#),
            op!("propose_kpi", Approval, "configure ONE KPI", r#"{"project_name":"<name>","name":"<KPI>","category":"technical|quality|traffic|value","direction":"up|down","measure_kind":"manual|codebase|connector|derived","cadence":"manual|daily|weekly"}"#),
            op!("run_browser_test", Approval, "live browser test of a project's test env", r#"{"project_name":"<name>","url?":"<URL>","scenario":"<what to test, what counts as pass>"}"#),
            op!("reconnect_credential", Approval, "hand a revoked credential back to him (id from your flagged list)", r#"{"credential_id":"<id>"}"#),
            op!("skill_sync", Approval, "move ONE skill between library and projects", r#"{"skill":"<name>","action":"adopt|sync|publish","source?":"<project>","targets":["<project>"]}"#),
            op!("dev_improve", Approval, "DEV MODE only: a coding session on the app's own repo", r#"{"request":"<what/where/acceptance>","context?":"<slug>","backend":true|false}"#),
            op!("dev_merge", Approval, "DEV MODE only: apply a finished backend run", r#"{"op_id":"<dev op id>","rationale":"<one line>"}"#),
            op!("backlog_apply_triage", System, "the Backlog's Send-to-Athena button creates it; never emit it", r#"(not yours)"#),
        ],
    },
    OpSection {
        title: "Read-only lookups (all read; the answer lands as a system note NEXT turn, so say you are checking)",
        gate: Some(OpGate::Read),
        note: "",
        compact: false,
        ops: &[
            op!("describe_persona", Read, "one agent", r#"{"query":"<name or id>"}"#),
            op!("describe_context", Read, "one dev context (which project owns a feature)", r#"{"query":"<name or id>"}"#),
            op!("describe_skill", Read, "one installed skill", r#"{"query":"<name>"}"#),
            op!("list_teams", Read, "teams and ids", r#"{"query?":"<filter>"}"#),
            op!("describe_canvas_project", Read, "one canvas island in full", r#"{"query":"<slug>"}"#),
            op!("describe_canvas_freshness", Read, "scan ages, ongoing goals, KPI standing", r#"{"query?":"<slug>"}"#),
            op!("list_runner_tasks", Read, "the Dev Runner queue (the OTHER lane; check before dispatching)", r#"{"query?":"<filter>"}"#),
            op!("describe_skill_fleet", Read, "skill versions across repos", r#"{"query?":"<name>"}"#),
            op!("describe_ship_milestone", Read, "a milestone's live cut (a project name resolves to its OPEN milestone)", r#"{"query":"<milestone|project>"}"#),
            op!("describe_brain_health", Read, "why recall came back empty", r#"{"query":""}"#),
            op!("describe_note", Read, "a Notepad note and its project's open milestone", r#"{"query":"<note id or title>"}"#),
            op!("browser_status", Read, "browser backend, leased tabs, Whitelist rows (read BEFORE a page write)", r#"{}"#),
        ],
    },
    OpSection {
        title: "Fleet (live CLI sessions) and other devices",
        gate: Some(OpGate::Approval),
        note: "Approval unless marked. `session_id` = the FULL fleet session id (never the cc: id); `confidence` high|medium|low; `decision_class` drive_forward|choice; `cwd` a REGISTERED project path. Start real work with `show_fleet_plan` (editable plan card, nothing spawns until he confirms), not bare spawns.",
        compact: true,
        ops: &[
            op!("show_fleet_plan", Card, "", r#"{operation_intent,rows:[{cwd,objective,skill?}]}"#),
            op!("fleet_send_input", Approval, "", r#"{session_id,text,press_enter:true,confidence,decision_class}"#),
            op!("fleet_intervene", Approval, "", r#"{session_id,message,confidence,decision_class} (max one per session)"#),
            op!("fleet_kill", Approval, "", r#"{session_id}"#),
            op!("fleet_broadcast", Approval, "", r#"{target:all_waiting|all|ids,ids?,text,press_enter:true}"#),
            op!("fleet_spawn", Approval, "", r#"{cwd,confidence,decision_class}"#),
            op!("fleet_dispatch", Approval, "", r#"{operation_intent,role_specs:[{role,cwd}],confidence,decision_class}"#),
            op!("fleet_redirect_op", Approval, "", r#"{op_id (FULL),new_intent}"#),
            op!("fleet_wake", Approval, "", r#"{session_id,confidence,decision_class}"#),
            op!("fleet_resume", Approval, "", r#"{pid,cwd,confidence,decision_class}"#),
            op!("remote_instruct", Approval, "", r#"{device?,instruction} (HIS other paired device; a complete self-contained request; omit device for home)"#),
            op!("continue_autonomously", Auto, "", r#"{rationale} (autonomous mode only)"#),
        ],
    },
    OpSection {
        title: "Mastermind canvas, Ship milestones, the Notepad",
        gate: Some(OpGate::Approval),
        note: "Approval unless marked. `slug` is a canvas slug exactly as printed in your Mastermind block; every `item_id` / `milestone_id` / `note_id` is a REAL id you READ (`describe_*` first), never a guess. A milestone `goal` is a TITLE under 72 chars.",
        compact: true,
        ops: &[
            op!("canvas_dispatch", Approval, "", r#"{slug,task,skill?}"#),
            op!("canvas_group_dispatch", Approval, "", r#"{slugs:[],task}"#),
            op!("canvas_run_idea_scan", Approval, "", r#"{slug}"#),
            op!("canvas_control", Auto, "", r#"{action:{kind:camera.focus|camera.zoom|camera.pan|camera.fit|camera.read|dim.open|category.open|island.menu,slug?,key?}}"#),
            op!("compose_canvas_panel", Auto, "", r#"{slug,spec:{surface:"v1",title,blocks:[{type:stat_row|table|decisions|markdown|gauge|progress|terminal,...}]}}"#),
            op!("show_ship_milestone", Card, "", r#"{project_slug,name,goal,description?,rows:[{item_kind:use_case|goal,item_id}]}"#),
            op!("set_ship_scope", Approval, "", r#"{milestone_id,items:[{item_kind,item_id,bucket:core|later|never|remove}]}"#),
            op!("ship_milestone_lifecycle", Approval, "", r#"{milestone_id,transition:cut|ship}"#),
            op!("show_ship_goals", Card, "", r#"{milestone_id,note_id?,goals:[{title,description?}]}"#),
            op!("show_note_suggestions", Card, "", r#"{note_id,rows:[{kind:section|edit|question,anchor:{after_heading},body_md}]} (draft notes only)"#),
        ],
    },
    OpSection {
        title: "Driving a web app (Browser > Whitelist; all approval)",
        gate: Some(OpGate::Approval),
        note: "Read `browser_status` first. One page write per op; the login credential is attached by Personas, you never see it.",
        compact: true,
        ops: &[
            op!("browser_act", Approval, "", r#"{tab_id,tool:browser_click|browser_type|browser_select|browser_submit|browser_call_page_tool,params:{}}"#),
            op!("browser_login", Approval, "", r#"{tab_id,origin}"#),
            op!("browser_request_site", Approval, "", r#"{origin,label}"#),
        ],
    },
    OpSection {
        title: "Inline cards and compositions (all auto; drawn under your message)",
        gate: Some(OpGate::Auto),
        note: "`show_template_suggestions` is the FIRST move when he wants a new agent. Widgets: `{id,kind,span:1-12,config:{}}`; `title?` accepted on every card.",
        compact: true,
        ops: &[
            op!("show_persona_overview", Auto, "", r#"{config:{limit,filter:active|all}}"#),
            op!("show_connected_services", Auto, "", r#"{config:{limit}}"#),
            op!("show_decisions", Auto, "", r#"{config:{limit}}"#),
            op!("show_recent_decisions", Auto, "", r#"{persona_context,limit:3}"#),
            op!("show_decision_log", Auto, "", r#"{intent,decisions:[{label,choice,rationale}]}"#),
            op!("show_design_capabilities", Auto, "", r#"{intro?}"#),
            op!("show_template_suggestions", Auto, "", r#"{intent,limit:3}"#),
            op!("show_persona_creation_offer", Auto, "", r#"{intent}"#),
            op!("show_persona_walkthrough", Auto, "", r#"{intent,content (markdown)}"#),
            op!("show_use_case_set", Auto, "", r#"{intent,use_cases:[{label,role:golden|variant|out_of_scope,description}]}"#),
            op!("show_trigger_set", Auto, "", r#"{intent,triggers:[{label,source,condition}]}"#),
            op!("show_model_tier_choice", Auto, "", r#"{intent,recommended:haiku|sonnet|opus,tiers:[{tier,rationale}]}"#),
            op!("show_observability_plan", Auto, "", r#"{intent,error_handling:{triggers:[],escalation},success_metric:{kind:count_by_status|cost_per_run|latency|custom,description}}"#),
            op!("show_persona_ready", Auto, "", r#"{intent,recommended_action:build_oneshot|interactive|use_template,summary:{intent_line}}"#),
            op!("show_browser_test_report", Auto, "", r#"{url,steps:[{label,result:pass|fail|warn,evidence}],defects:[{title,severity:high|medium|low,detail}],console_errors:[]}"#),
            op!("compose_dashboard", Auto, "", r#"{title,widgets:[kind:kpi_tile|executions_status_chart|cost_per_day_chart|top_personas_list|success_rate_gauge|activity_heatmap|recent_executions_table]}"#),
            op!("compose_cockpit", Auto, "", r#"{title,widgets:[kind:persona_overview|connected_services|decisions_panel|metric_spark|issue_list|text_callout|verdict|flow_steps|comparison_cards|timeline|stat_grid|log_excerpt]} (prefer over many items as prose)"#),
            op!("explain_in_cockpit", Auto, "", r#"{title,decision_id (verbatim),widgets:[kind:verdict|flow_steps|timeline|stat_grid|log_excerpt|text_callout]}"#),
            op!("show_walkthrough_offer", Auto, "", r#"{topic:persona_creation|connector_setup|trigger_creation|template_adoption|incident_triage|goal_kpi_setup,summary}"#),
            op!("start_guided_walkthrough", Auto, "", r#"{topic (same set)}"#),
            op!("point_at", Auto, "", r#"{anchor (catalog id, e.g. nav_settings|vault|overview_dashboard),narration}"#),
            op!("compose_walkthrough", Auto, "", r#"{steps:[{anchor,narration}]} (2-6 stops)"#),
            op!("compose_tour", Auto, "", r#"{topic,steps:[{anchor,narration}]}"#),
        ],
    },
];

/// Every documented op, in reference order.
#[cfg(test)]
fn op_docs() -> impl Iterator<Item = &'static OpDoc> {
    OP_SECTIONS.iter().flat_map(|s| s.ops.iter())
}

/// Ceiling on the rendered reference, so the chat family's static core keeps
/// room for the hand-written doctrine under its own 24k budget. Asserted by
/// `op_reference_stays_compact`.
pub(crate) const OP_REFERENCE_MAX_CHARS: usize = 12_500;

/// The compact markdown op reference the chat-class prompt family carries in
/// place of the constitution's per-op prose. One line per op: name, gate,
/// intent, exact `params` shape. The envelope is stated once at the top,
/// because `{"op":"<verb>"}` (the verb in the wrong field) was the dominant
/// v1 bench failure.
pub(crate) fn render_op_reference() -> String {
    let mut out = String::with_capacity(OP_REFERENCE_MAX_CHARS);
    out.push_str(
        "# Op reference (generated from the dispatcher catalog)\n\n\
         Envelope, ONE line of minified JSON: `OP: {\"op\":\"propose_action\",\"action\":\"<name>\",\
         \"params\":{...},\"rationale\":\"<one honest sentence>\"}`. `\"op\"` is ALWAYS \
         `\"propose_action\"`; the verb goes in `\"action\"` and is never `propose_action` \
         itself. `{\"op\":\"use_connector\",...}` and `\"action\":\"propose_action\"` are \
         malformed and silently dropped. Gates: **approval** = a card, nothing runs until he \
         clicks; **auto** = fires now, no card; **read** = lookup, answer arrives as a system \
         note next turn; **card** = an editable card he confirms. `?` marks an optional field. \
         A name not in this list does not exist.\n",
    );
    for section in OP_SECTIONS {
        out.push_str("\n## ");
        out.push_str(section.title);
        out.push('\n');
        if !section.note.is_empty() {
            out.push_str(section.note);
            out.push('\n');
        }
        if section.compact {
            let rows: Vec<String> = section
                .ops
                .iter()
                .map(|op| {
                    if section.gate == Some(op.gate) {
                        format!("`{}` `{}`", op.name, op.params)
                    } else {
                        format!("`{}` ({}) `{}`", op.name, op.gate.label(), op.params)
                    }
                })
                .collect();
            out.push_str(&rows.join("; "));
            out.push('\n');
            continue;
        }
        for op in section.ops {
            if section.gate == Some(op.gate) {
                out.push_str(&format!("- `{}`: {} `{}`\n", op.name, op.intent, op.params));
            } else {
                out.push_str(&format!(
                    "- `{}` ({}): {} `{}`\n",
                    op.name,
                    op.gate.label(),
                    op.intent,
                    op.params
                ));
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::companion::templates::CONSTITUTION_MD;

    /// An op is *taught* when the constitution names it verbatim, either as a
    /// backticked token in prose or inside a quoted JSON field on an `OP:`
    /// line. A bare substring search would be worthless here — half the op
    /// names contain a common English word, and `ab` (a lab mode) would match
    /// almost any paragraph. This asks the narrower question the gate is
    /// actually about: does the name appear where a reader would take it as a
    /// name.
    fn taught(name: &str) -> bool {
        CONSTITUTION_MD.contains(&format!("`{name}`"))
            || CONSTITUTION_MD.contains(&format!("\"{name}\""))
    }

    /// The allow-lists in this file decide what Athena is *permitted* to emit.
    /// The constitution decides what she has ever been *told about*. Nothing
    /// tied the two together, so an op could be wired end to end — allow-list,
    /// dispatcher arm, executor, approval card — and remain unreachable
    /// because the one document that teaches her the vocabulary never
    /// mentioned it. Measured 2026-09-03: eight of the sixty-six were in
    /// exactly that state (`delete_procedural`, `delete_goal`,
    /// `set_ritual_active`, `delete_ritual`, `list_runner_tasks`,
    /// `describe_brain_health`, `dev_improve`, `dev_merge`).
    ///
    /// If this fails, the fix is to teach the op in the section its family
    /// lives in — not to delete the entry here, unless the op is genuinely
    /// retired (in which case its dispatcher arm and executor go with it).
    #[test]
    fn every_catalog_op_is_taught_by_the_constitution() {
        let undocumented: Vec<&str> = ALLOWED_ACTIONS
            .iter()
            .chain(READ_OPS.iter())
            .copied()
            .filter(|op| !taught(op))
            .collect();
        assert!(
            undocumented.is_empty(),
            "these ops are in the dispatcher allow-list but appear nowhere in \
             the constitution, so Athena can never emit them: {undocumented:?}"
        );
    }

    /// Same contract for `open_route`'s destinations. A route Athena has not
    /// been told about is a route she navigates to by guessing, and a
    /// hallucinated one is rejected at the dispatcher — silently, from her
    /// point of view. `mastermind` sat here undocumented until 2026-09-03.
    #[test]
    fn every_allowed_route_is_taught_by_the_constitution() {
        let undocumented: Vec<&str> = ALLOWED_ROUTES
            .iter()
            .copied()
            .filter(|r| !taught(r))
            .collect();
        assert!(
            undocumented.is_empty(),
            "these `open_route` destinations are allowed but untaught: {undocumented:?}"
        );
    }

    /// The positive control for [`taught`]. `delete_fact` has been documented
    /// since the semantic layer shipped; if this ever goes red the matcher is
    /// broken, not the constitution — which is the failure mode that lets a
    /// gate run green while checking nothing.
    #[test]
    fn the_documentation_matcher_finds_a_known_documented_op() {
        assert!(taught("delete_fact"), "positive control failed: the matcher no longer finds an op the constitution demonstrably teaches");
        assert!(
            !taught("op_that_does_not_exist_anywhere"),
            "negative control failed: the matcher matches a name that is not in the document"
        );
    }

    /// The chat family teaches ops through `render_op_reference`, so the
    /// same contract the constitution carries applies to it: every op the
    /// dispatcher would accept must appear where a reader takes it as a name.
    fn taught_by(text: &str, name: &str) -> bool {
        text.contains(&format!("`{name}`")) || text.contains(&format!("\"{name}\""))
    }

    /// The doc table and the allow-lists must agree in BOTH directions: an
    /// op the dispatcher accepts without a reference row is untaught in the
    /// chat family (the constitution failure, repeated), and a row for an op
    /// no table names would teach a verb the dispatcher drops.
    #[test]
    fn every_catalog_op_has_a_reference_row_and_vice_versa() {
        let documented: Vec<&str> = op_docs().map(|d| d.name).collect();
        let missing: Vec<&str> = ALLOWED_ACTIONS
            .iter()
            .chain(READ_OPS.iter())
            .chain(AUTO_FIRE_ACTIONS.iter())
            .copied()
            .filter(|op| !documented.contains(op))
            .collect();
        assert!(
            missing.is_empty(),
            "catalog ops with no reference row: {missing:?}"
        );
        let phantom: Vec<&str> = documented
            .iter()
            .copied()
            .filter(|op| {
                !ALLOWED_ACTIONS.contains(op)
                    && !READ_OPS.contains(op)
                    && !AUTO_FIRE_ACTIONS.contains(op)
            })
            .collect();
        assert!(
            phantom.is_empty(),
            "reference rows for ops no table names: {phantom:?}"
        );
        let mut seen = std::collections::HashSet::new();
        let dupes: Vec<&str> = documented
            .iter()
            .copied()
            .filter(|n| !seen.insert(*n))
            .collect();
        assert!(dupes.is_empty(), "duplicate reference rows: {dupes:?}");
    }

    /// The gate column is derived from which table the op sits in, not from
    /// the author's memory: an `ALLOWED_ACTIONS` entry is approval-gated by
    /// definition, and a `READ_OPS` entry is a read. A row that says
    /// otherwise would teach the model to expect a card that never comes.
    #[test]
    fn reference_gates_agree_with_the_allow_lists() {
        for doc in op_docs() {
            if READ_OPS.contains(&doc.name) {
                assert_eq!(doc.gate, OpGate::Read, "{} is a READ_OP", doc.name);
            } else if ALLOWED_ACTIONS.contains(&doc.name) {
                assert!(
                    matches!(doc.gate, OpGate::Approval | OpGate::System),
                    "{} is in ALLOWED_ACTIONS and must be approval-gated",
                    doc.name
                );
            } else {
                assert!(
                    matches!(doc.gate, OpGate::Auto | OpGate::Card),
                    "{} is an auto-fire arm and must not claim a gate",
                    doc.name
                );
            }
        }
    }

    #[test]
    fn op_reference_names_every_op_and_the_envelope() {
        let text = render_op_reference();
        let untaught: Vec<&str> = ALLOWED_ACTIONS
            .iter()
            .chain(READ_OPS.iter())
            .chain(AUTO_FIRE_ACTIONS.iter())
            .copied()
            .filter(|op| !taught_by(&text, op))
            .collect();
        assert!(
            untaught.is_empty(),
            "op reference does not teach: {untaught:?}"
        );
        assert!(
            text.contains(
                r#"`OP: {"op":"propose_action","action":"<name>","params":{...},"rationale":"<one honest sentence>"}`"#
            ),
            "the propose_action envelope must be spelled out once, verbatim"
        );
        assert!(text.contains(
            r#"`{"op":"use_connector",...}` and `"action":"propose_action"` are malformed"#
        ));
        for route in ALLOWED_ROUTES {
            assert!(
                text.contains(route),
                "open_route destination {route} missing from the reference"
            );
        }
    }

    #[test]
    fn op_reference_stays_compact() {
        let text = render_op_reference();
        assert!(
            text.len() <= OP_REFERENCE_MAX_CHARS,
            "op reference is {} chars, ceiling {}",
            text.len(),
            OP_REFERENCE_MAX_CHARS
        );
        assert!(
            text.len() > 4_000,
            "an op reference this small is not teaching ~100 ops"
        );
    }

    /// The sibling of `every_catalog_op_is_taught_by_the_constitution` for
    /// the chat-class prompt family: the composed static core (chat core +
    /// generated op reference + builtins) must teach every op the dispatcher
    /// accepts, by the same "named where a reader takes it as a name" test.
    /// It passes by construction while the reference is generated from these
    /// tables; it is here so that construction is asserted, not assumed.
    #[test]
    fn every_catalog_op_is_taught_by_the_chat_family() {
        let core = crate::companion::prompt::chat_static_core();
        let undocumented: Vec<&str> = ALLOWED_ACTIONS
            .iter()
            .chain(READ_OPS.iter())
            .copied()
            .filter(|op| !taught_by(core, op))
            .collect();
        assert!(
            undocumented.is_empty(),
            "these ops are in the dispatcher allow-list but the chat family never \
             names them: {undocumented:?}"
        );
        let untaught_routes: Vec<&str> = ALLOWED_ROUTES
            .iter()
            .copied()
            .filter(|r| !core.contains(r))
            .collect();
        assert!(
            untaught_routes.is_empty(),
            "open_route destinations the chat family never names: {untaught_routes:?}"
        );
        // Positive + negative control for the matcher over THIS document.
        assert!(taught_by(core, "delete_fact"));
        assert!(!taught_by(core, "op_that_does_not_exist_anywhere"));
    }
}
