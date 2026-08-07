//! Op dispatcher — extracts `{"op": ...}` JSON proposals from Athena's
//! reply text, validates them against the allowed set, and creates rows
//! in `companion_approval` for the UI to render as approval cards.
//!
//! Phase 3 op set (write-only proposals; read-only inspection comes from
//! the observability digest):
//!   - propose_action { action: "run_persona", params: { persona_id, input? }, rationale }
//!   - propose_action { action: "resolve_human_review", params: { review_id, decision, comment? }, rationale }
//!
//! Discipline: ops are message-level. The dispatcher scans the finalized
//! assistant text after the turn ends — no agentic mid-turn loop. The
//! assistant text Athena renders is the *cleaned* text with the JSON
//! lines stripped; approval cards render in their place.

use rusqlite::params;
use serde::{Deserialize, Serialize};

use crate::db::UserDbPool;
use crate::error::AppError;

/// Outcome of dispatching one assistant message.
#[derive(Debug, Default)]
pub struct Dispatched {
    /// Assistant text with op JSON lines stripped, safe to display.
    pub cleaned_text: String,
    /// Newly-created approval rows. The UI listens for these and renders
    /// inline cards per turn.
    pub approvals: Vec<CreatedApproval>,
    /// UI-only navigations Athena fired this turn (`open_route`). These
    /// bypass the approval pipeline by design — the user wants direct,
    /// chat-driven navigation that doesn't interrupt the conversation.
    /// Each entry is the validated sidebar route name.
    pub navigations: Vec<String>,
    /// UI-only "open this persona's lab tab" requests Athena fired
    /// (`open_lab`). Bypasses approval like `open_route`. Each entry
    /// is `(persona_id, mode)` where mode is one of the lab modes
    /// (`arena`, `ab`, `versions`, etc.).
    pub lab_opens: Vec<(String, String)>,
    /// `compose_dashboard` payloads — already-serialized JSON spec
    /// strings, one per op. session.rs persists each via
    /// `dashboard::save_dashboard` and emits a navigate event. Auto-fire
    /// (no approval) because the user already asked for the dashboard;
    /// the click would just be friction.
    pub dashboards: Vec<String>,
    /// `compose_cockpit` payloads — same shape as `dashboards`. session.rs
    /// persists each via `cockpit::save_cockpit` and emits a navigate
    /// event to Home → Cockpit. Auto-fire for the same reason as dashboards:
    /// the user already asked for the surface.
    pub cockpits: Vec<String>,
    /// `explain_in_cockpit` payloads — the ephemeral sibling of `cockpits`.
    /// Each entry is a serialized spec (title + widgets + decision_id) that
    /// session.rs emits VERBATIM in the event payload and never persists:
    /// the frontend renders it as a contextual overlay over the user's
    /// cockpit and it dies with dismissal. Auto-fire — the user pressed the
    /// decision bubble's `0` (explain) to ask for exactly this surface.
    pub explain_cockpits: Vec<String>,
    /// `compose_canvas_panel` compositions — WP3's counterpart to `cockpits`,
    /// aimed at the Mastermind canvas instead of Home. Each entry carries the
    /// slug (already validated against the PUBLISHED scene, so a demo island or
    /// an invented name never reaches the frontend) and the serialized
    /// SurfaceSpec. session.rs emits one event per entry; persistence happens
    /// frontend-side, inside the canvas layout document, because that is where
    /// a per-project panel lives (`athenaPanels[slug]`) and where its reset
    /// control can reach it. Auto-fire: a panel proposes, it never runs
    /// anything — every action inside it is still consent-gated on render.
    pub canvas_panels: Vec<CanvasPanelCompose>,
    /// `canvas_control` steering actions (WP4 — the v2 door onto the
    /// frontend's canvas action grammar, `canvasActionStore`). Auto-fire:
    /// every accepted kind is reversible VIEW state — the camera moves or a
    /// popover opens; nothing mutates. Slugs inside were resolved against the
    /// published scene here, so the frontend can trust them exactly like a
    /// composed panel's slug. session.rs emits one event per entry carrying
    /// the session id; the frontend bridge answers through
    /// `companion_canvas_control_result`, which lands as a System episode
    /// Athena reads on her next turn.
    pub canvas_controls: Vec<CanvasControlDispatch>,
    /// Inline chat cards from `show_persona_overview` / `show_connected_services`
    /// / `show_decisions`. Auto-fire (no approval) — companion uses these to
    /// surface contextual info inside the chat transcript when she judges it
    /// useful for the current turn. Each entry is `(kind, config_json)`.
    pub chat_cards: Vec<ChatCard>,
    /// `start_guided_walkthrough` topics Athena triggered this turn. Auto-fire
    /// (no approval) — session.rs emits a `companion://guide` event per topic
    /// and the frontend runner walks the registry-defined steps (orb glide +
    /// element glow + narration). Each entry is a validated topic id.
    pub guide_walkthroughs: Vec<String>,
    /// `point_at` requests Athena triggered this turn. Auto-fire — session.rs
    /// emits a `companion://guide` event carrying `{ pointAt }` and the frontend
    /// rings one allow-listed anchor + narrates it as a single-step ad-hoc
    /// walkthrough (non-scripted pointing). Anchor validated against `ANCHOR_IDS`.
    pub point_ats: Vec<PointAt>,
    /// `compose_walkthrough` requests Athena triggered this turn. Auto-fire —
    /// session.rs emits `companion://guide` `{ composeWalkthrough }` and the
    /// frontend runs the runtime-assembled multi-step tour. Each step's anchor
    /// validated against `ANCHOR_IDS`; step count clamped to a sane range.
    pub composed_walkthroughs: Vec<ComposedWalkthrough>,
    /// `compose_tour` payloads (Generative Tours) — serialized
    /// `{topic, title, description, steps}` specs whose every step already
    /// passed `companion::tours::validate_tour_spec` against the generated
    /// anchor manifest (unknown anchors reject the whole tour). session.rs
    /// persists each via `tours::save_tour`; the tour then appears in the
    /// Home → Learning timeline with the composed-by-Athena badge.
    pub composed_tours: Vec<String>,
    /// Quick-reply option labels Athena offered for this turn. Each entry
    /// is the literal user message that gets sent on click. Not persisted
    /// — the UI shows them on the latest assistant bubble until the next
    /// turn fires, then clears.
    pub quick_replies: Vec<String>,
    /// Spoken-version of the reply Athena emitted via a `TTS:` line —
    /// short (1-3 sentences), conversational, suited for ElevenLabs
    /// playback. None when Athena didn't emit one (voice off, or she
    /// chose to skip it for this turn). Frontend sets it as the latest
    /// `pendingPlayback` if voice playback is on.
    pub tts_text: Option<String>,
    /// True iff Athena emitted at least one `continue_autonomously` op
    /// in this turn. When the session is in autonomous mode AND this is
    /// set, the caller schedules a continuation tick. The op carries no
    /// payload beyond a `rationale` string — the dispatcher logs it but
    /// otherwise ignores the body.
    pub requests_continuation: bool,
    /// Any malformed op blocks we encountered. Logged but otherwise
    /// silent — never block the turn for a syntax error.
    pub warnings: Vec<String>,
    /// `PROGRESS:` conversational asides Athena emitted mid-turn, in order.
    /// Stripped from the final reply (above) and persisted by session.rs as
    /// their own lightweight assistant episodes so the chat reads as a
    /// progressive back-and-forth, not one silent block then a wall of text.
    pub progress_beats: Vec<String>,
}

/// One inline chat-card request. `config` is widget-specific JSON the
/// frontend forwards to the matching cockpit widget component.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatCard {
    /// Widget kind: `persona_overview` | `connected_services` | `decisions_panel`.
    pub kind: String,
    /// Optional title override.
    pub title: Option<String>,
    /// Free-form config block — serialized verbatim for the frontend.
    pub config: serde_json::Value,
}

/// One `compose_canvas_panel` composition (WP3). The slug is already resolved
/// against the published canvas snapshot; `spec` is the serialized SurfaceSpec
/// the frontend parses (salvage-repaired there — a hallucinated block is
/// dropped rather than taking the panel down).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvasPanelCompose {
    /// Canvas slug, exactly as the published scene spells it.
    pub slug: String,
    /// Envelope version. Must stay in step with the frontend's
    /// `SUPPORTED_PANEL_SPEC_VERSIONS` in `sub_mastermind/lib/layoutStore.ts`;
    /// an entry carrying anything else is dropped on the way into the doc.
    pub spec_version: u32,
    /// Serialized SurfaceSpec JSON (`{"surface":"v1","blocks":[…]}`).
    pub spec: String,
}

/// Panel-envelope version this build emits.
pub const CANVAS_PANEL_SPEC_VERSION: u32 = 1;

/// Blocks one composed panel may carry — mirrors `surfaceSpecSchema`'s `.max(12)`
/// so an over-long composition is refused here rather than silently truncated
/// by the renderer.
const CANVAS_PANEL_MAX_BLOCKS: usize = 12;

/// One validated `canvas_control` steering action (WP4). `action` is the
/// re-serialized, validated grammar object — only the fields the validator
/// accepted survive, so a stray `travel:false` or an invented field never
/// reaches the frontend.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvasControlDispatch {
    /// Serialized `CanvasActionRequest` JSON (`{"kind":"camera.focus",…}`),
    /// matching `sub_mastermind/lib/canvasActionStore.ts` exactly.
    pub action: String,
}

/// Steering actions one turn may emit. More is camera thrash, not guidance —
/// the user is watching the view she's driving.
const CANVAS_CONTROL_MAX_PER_TURN: usize = 4;

/// Action kinds `canvas_control` accepts — the STEERING half of the frontend
/// grammar. The read kinds (`island.read` / `dim.read`) are deliberately
/// absent: `describe_canvas_project` already answers those synchronously from
/// the published scene, without a frontend round-trip.
const CANVAS_CONTROL_KINDS: &[&str] = &[
    "camera.read",
    "camera.pan",
    "camera.zoom",
    "camera.focus",
    "camera.fit",
    "dim.open",
    "category.open",
    "island.menu",
];

/// Zoom bands the grammar speaks (`types.ts::ZoomBand`).
const CANVAS_CONTROL_BANDS: &[&str] = &["far", "mid", "near", "close"];

/// Category keys the far/mid rollup cells use (`dimCategories.ts`).
const CANVAS_CONTROL_CATEGORIES: &[&str] = &["runtime", "delivery", "agentic", "product"];

/// An ad-hoc `point_at` request: Athena rings one allow-listed UI anchor and
/// narrates it, with no pre-authored walkthrough topic. `anchor` is validated
/// against `ANCHOR_IDS`; `narration` is the line she authored for this turn.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PointAt {
    pub anchor: String,
    pub narration: String,
}

/// A `compose_walkthrough` request: Athena assembles a short multi-step tour at
/// runtime from anchor-catalog entries (vs the static registry). Each step is a
/// `PointAt` (anchor + narration); the orb glides through them in order.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComposedWalkthrough {
    pub title: Option<String>,
    pub steps: Vec<PointAt>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatedApproval {
    pub id: String,
    pub action: String,
    pub params_json: String,
    pub rationale: String,
}

/// Allowed approval-creating actions. `open_route` is *not* listed here
/// — it's handled specially below (auto-fires a navigation event, no
/// approval card). The user wants chat-driven navigation to be smooth,
/// not gated by an explicit click each time.
const ALLOWED_ACTIONS: &[&str] = &[
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
];

/// True when `action` has an [`ALLOWED_ACTIONS`] entry, i.e. a proposal
/// carrying it becomes an approval row instead of being dropped as unknown.
/// Exposed so the approval side can assert the two lists agree without
/// publishing the list itself.
pub fn action_is_allowed(action: &str) -> bool {
    ALLOWED_ACTIONS.contains(&action)
}

/// Auto-fire, read-only detail lookups. Each one answers "what is this
/// thing, exactly" for an entity kind whose always-on prompt index is
/// deliberately truncated (personas, dev contexts, skills) or absent
/// entirely (teams — `assign_team` needs a `team_id` the index never
/// carries). Handled by their own dispatch arm; NOT in `ALLOWED_ACTIONS`,
/// because they need no executor and no approval card.
const READ_OPS: &[&str] = &[
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
];

/// Read ops whose `query` param is optional (they answer for everything when
/// it is empty). Everything else is rejected without one, because a lookup
/// with no target is a model that forgot what it was asking about.
const READ_OPS_QUERY_OPTIONAL: &[&str] =
    &["list_teams", "describe_canvas_freshness", "list_runner_tasks"];

/// Longest accepted lookup string. A name or a UUID; anything longer is a
/// model pasting prose into the param.
const READ_OP_QUERY_MAX: usize = 200;

/// Hard cap on the System episode a read op writes back. Detail-on-demand
/// is only cheaper than a fat prompt if the answer is itself bounded.
const READ_OP_DETAIL_CHARS: usize = 1600;

/// Rows a single `list_teams` answer may carry.
const LIST_TEAMS_MAX_ROWS: usize = 25;

/// Characters held back from [`READ_OP_DETAIL_CHARS`] for the `list_teams`
/// "N of M" footer, so truncation can never eat the honesty line.
const LIST_TEAMS_FOOTER_RESERVE: usize = 180;

/// Fuzzy-match candidates offered when a lookup misses. Shared with the
/// card-op validators (`approval_exec_ship`), so a rejection anywhere in the
/// op surface offers the same number of real alternatives.
pub(crate) const READ_OP_SUGGESTIONS: usize = 5;

/// Lab modes valid for `open_lab`. Mirrors the `lab-mode-*` testids in
/// `src/features/agents/sub_lab/components/shared/LabTab.tsx`.
const ALLOWED_LAB_MODES: &[&str] = &[
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
const ALLOWED_ROUTES: &[&str] = &[
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
const GUIDED_TOPICS: &[&str] = &[
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
use crate::companion::generated_anchors::GUIDANCE_ANCHORS as ANCHOR_IDS;

/// A composed walkthrough should be a *short* tour. One stop is `point_at`'s
/// job; more than this reads as a slideshow the user won't sit through.
const COMPOSE_MIN_STEPS: usize = 2;
const COMPOSE_MAX_STEPS: usize = 6;

/// Scan assistant text for op JSON blocks, persist them as approval rows,
/// and return cleaned text + the list of created approvals.
///
/// We accept two formats:
///   - One JSON object per line, prefixed with `OP:` for readability:
///       `OP: {"op": "propose_action", ...}`
///   - Bare lines that start with `{"op":` are also accepted.
/// Both forms get stripped from the cleaned text. Markdown code fences
/// containing JSON are not parsed (those are display-only).
pub fn dispatch(
    pool: &UserDbPool,
    session_id: &str,
    assistant_text: &str,
) -> Result<Dispatched, AppError> {
    dispatch_with_sys(pool, None, session_id, assistant_text)
}

/// Same as [`dispatch`], plus a handle on the *system* DB so the read-only
/// `describe_*` / `list_teams` ops can answer from the tables that actually
/// hold personas, dev contexts and teams. `sys_db: None` keeps every other
/// arm working exactly as before and makes the four read ops report that
/// the lookup surface is unavailable (the bench harness path, which builds
/// only a user DB).
pub fn dispatch_with_sys(
    pool: &UserDbPool,
    sys_db: Option<&crate::db::DbPool>,
    session_id: &str,
    assistant_text: &str,
) -> Result<Dispatched, AppError> {
    let mut out = Dispatched::default();
    let mut cleaned_lines: Vec<&str> = Vec::with_capacity(assistant_text.lines().count());

    for line in assistant_text.lines() {
        let trimmed = line.trim_start();

        // PROGRESS line: `PROGRESS: <short update>` — a live narration beat
        // Athena emits mid-turn (Variant B in
        // docs/features/companion/conversation-orchestration.md). The
        // frontend detects + speaks these the instant their line completes
        // in the stream; here we only strip them from the persisted reply so
        // they never appear in the final bubble.
        if let Some(beat) = trimmed.strip_prefix("PROGRESS:") {
            let beat = beat.trim();
            if !beat.is_empty() {
                out.progress_beats.push(beat.to_string());
            }
            continue;
        }

        // TTS line: `TTS: "..."` — a short, spoken-friendly version of
        // this turn's reply. We accept either a JSON-quoted string or
        // a bare-text rest (more forgiving for short lines). Stripped
        // from display so the user sees only the visual reply.
        if let Some(rest) = trimmed.strip_prefix("TTS:") {
            let rest = rest.trim();
            // Try JSON-string parse first (handles escapes); fall back
            // to surrounding-quote strip; otherwise take rest as-is.
            let candidate = serde_json::from_str::<String>(rest)
                .ok()
                .unwrap_or_else(|| {
                    rest.trim_matches(|c: char| c == '"' || c == '\'')
                        .to_string()
                });
            let trimmed_text = candidate.trim().to_string();
            if !trimmed_text.is_empty() {
                // First TTS line wins; ignore subsequent ones to keep
                // the spoken version a single coherent utterance.
                if out.tts_text.is_none() {
                    out.tts_text = Some(trimmed_text);
                } else {
                    out.warnings
                        .push("multiple TTS lines, keeping first".into());
                }
            }
            continue;
        }

        // Quick-reply line: `QR: [...]` — list of preset user-message
        // labels Athena offers. Stripped from display, surfaced as
        // chip buttons on the assistant bubble.
        if let Some(rest) = trimmed.strip_prefix("QR:") {
            match serde_json::from_str::<Vec<String>>(rest.trim()) {
                Ok(opts) => {
                    for opt in opts {
                        let opt = opt.trim().to_string();
                        if !opt.is_empty() && out.quick_replies.len() < 6 {
                            out.quick_replies.push(opt);
                        }
                    }
                }
                Err(e) => {
                    out.warnings.push(format!("QR parse error: {e}"));
                    cleaned_lines.push(line);
                }
            }
            continue;
        }

        // Extract an op payload. Accept `OP:` at line start, a bare `{"op"` line,
        // OR an `OP: {…}` marker that appears mid-line — Athena sometimes prefixes
        // a word on the same line ("Building it. OP: {…}"), which would otherwise be
        // silently dropped. In the mid-line case the prose before the marker is kept
        // for display so only the op JSON is stripped.
        let payload = if let Some(rest) = trimmed.strip_prefix("OP:") {
            rest.trim()
        } else if trimmed.starts_with("{\"op\"") {
            trimmed
        } else if let Some(idx) = trimmed.find("OP:") {
            let after = trimmed[idx + 3..].trim_start();
            if after.starts_with('{') {
                let before = trimmed[..idx].trim_end();
                if !before.is_empty() {
                    cleaned_lines.push(before);
                }
                after
            } else {
                cleaned_lines.push(line);
                continue;
            }
        } else {
            cleaned_lines.push(line);
            continue;
        };

        // Parse the op JSON — with a bounded brace-completion fallback.
        // LLMs occasionally drop trailing `}`s on long single-line op JSON
        // (observed live 2026-07-04: an 1100-char `dev_improve` op missing
        // exactly its final envelope brace — the assistant prose claimed a
        // dispatch that never landed, the op vanished as a parse warning).
        // `repair_op_json` appends only the missing closing braces, only
        // when the line doesn't end inside a string literal — a syntactic
        // completion, never a semantic guess. Anything unrepairable keeps
        // the original parse error.
        let parsed = serde_json::from_str::<OpEnvelope>(payload).or_else(|orig_err| {
            match repair_op_json(payload) {
                Some(fixed) => serde_json::from_str::<OpEnvelope>(&fixed).map_err(|_| orig_err),
                None => Err(orig_err),
            }
        });
        match parsed {
            // open_route bypasses the approval flow: validate the route
            // and queue a navigation event. No card, no click. The chat
            // panel stays open; the sidebar switches behind it.
            // open_lab also bypasses approval — pure UI navigation
            // (jump to a persona's editor + select a lab mode).
            // compose_dashboard auto-fires too: validate the widgets
            // array, build a JSON spec body, queue it for session.rs
            // to persist + emit a navigate event. The dashboard write
            // is a small idempotent overwrite — friction-free.
            Ok(env) if env.op == "propose_action" && env.action == "compose_dashboard" => {
                let widgets = env.params.get("widgets");
                let widgets_arr = widgets.and_then(|v| v.as_array());
                if widgets_arr.is_none() || widgets_arr.unwrap().is_empty() {
                    out.warnings
                        .push("compose_dashboard: `widgets` must be a non-empty array".into());
                    cleaned_lines.push(line);
                    continue;
                }
                let title = env
                    .params
                    .get("title")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Athena dashboard");
                let now = chrono::Utc::now().to_rfc3339();
                let spec = serde_json::json!({
                    "title": title,
                    "widgets": widgets,
                    "updated_at": now,
                });
                out.dashboards.push(spec.to_string());
            }
            Ok(env)
                if env.op == "propose_action"
                    && matches!(
                        env.action.as_str(),
                        "show_persona_overview" | "show_connected_services" | "show_decisions"
                    ) =>
            {
                // Inline chat-cards. Map the action name to a cockpit widget kind
                // and forward the params blob as `config`. Auto-fire; no approval.
                let kind = match env.action.as_str() {
                    "show_persona_overview" => "persona_overview",
                    "show_connected_services" => "connected_services",
                    "show_decisions" => "decisions_panel",
                    _ => unreachable!(),
                };
                let title = env
                    .params
                    .get("title")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                let config = env
                    .params
                    .get("config")
                    .cloned()
                    .unwrap_or_else(|| serde_json::json!({}));
                out.chat_cards.push(ChatCard {
                    kind: kind.to_string(),
                    title,
                    config,
                });
            }
            Ok(env)
                if env.op == "propose_action" && env.action == "show_recent_decisions" =>
            {
                // Compact recall card — surfaces 1-5 of the most recent
                // saved decisions for a given persona_context as small
                // chips. Lighter than a full show_decision_log card;
                // intended for "by the way, you decided..." inline
                // reminders. Widget fetches the actual rows on mount
                // via companion_list_design_decisions.
                let persona_context = env
                    .params
                    .get("persona_context")
                    .and_then(|v| v.as_str())
                    .map(str::trim)
                    .unwrap_or("");
                if persona_context.is_empty() {
                    out.warnings.push(
                        "show_recent_decisions: `persona_context` (persona id, build session id, or intent string) is required so the widget knows what to fetch"
                            .into(),
                    );
                    cleaned_lines.push(line);
                    continue;
                }
                let limit = env
                    .params
                    .get("limit")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(3)
                    .clamp(1, 5);
                let title = env
                    .params
                    .get("title")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                out.chat_cards.push(ChatCard {
                    kind: "recent_decisions".to_string(),
                    title,
                    config: serde_json::json!({
                        "persona_context": persona_context,
                        "limit": limit,
                    }),
                });
            }
            Ok(env)
                if env.op == "propose_action" && env.action == "show_design_capabilities" =>
            {
                // Onboarding-style card for the design-family. Athena
                // emits this when a user asks "what can you help me
                // design?" — surfaces her vocabulary (walkthrough, use
                // cases, triggers, model tier, observability, ready
                // recap) so the user knows what to ask for. Content is
                // mostly hardcoded in the widget; the op carries just an
                // optional intro line Athena composes for context.
                let intro = env
                    .params
                    .get("intro")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
                    .unwrap_or_default();
                let title = env
                    .params
                    .get("title")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                out.chat_cards.push(ChatCard {
                    kind: "design_capabilities".to_string(),
                    title,
                    config: serde_json::json!({ "intro": intro }),
                });
            }
            Ok(env)
                if env.op == "propose_action" && env.action == "show_persona_ready" =>
            {
                // End-of-design recap. Athena rolls up all the design
                // decisions (intent line, use cases, triggers, model
                // tier, observability) into one build-ready card with a
                // primary "Commit to build" button that fires the same
                // prefill flow as the walkthrough's build button.
                let intent_line = env
                    .params
                    .get("summary")
                    .and_then(|s| s.get("intent_line"))
                    .and_then(|v| v.as_str())
                    .map(str::trim)
                    .unwrap_or("");
                if intent_line.is_empty() {
                    out.warnings.push(
                        "show_persona_ready: summary.intent_line is required (the refined one-sentence persona purpose used for prefill)".into(),
                    );
                    cleaned_lines.push(line);
                    continue;
                }
                let recommended = env
                    .params
                    .get("recommended_action")
                    .and_then(|v| v.as_str())
                    .map(str::trim)
                    .unwrap_or("interactive");
                if !matches!(
                    recommended,
                    "build_oneshot" | "interactive" | "use_template"
                ) {
                    out.warnings.push(format!(
                        "show_persona_ready: recommended_action must be build_oneshot|interactive|use_template, got `{recommended}`"
                    ));
                    cleaned_lines.push(line);
                    continue;
                }
                let summary = env
                    .params
                    .get("summary")
                    .cloned()
                    .unwrap_or(serde_json::Value::Null);
                let intent = env
                    .params
                    .get("intent")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let title = env
                    .params
                    .get("title")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                out.chat_cards.push(ChatCard {
                    kind: "persona_ready".to_string(),
                    title,
                    config: serde_json::json!({
                        "intent": intent,
                        "summary": summary,
                        "recommended_action": recommended,
                    }),
                });
            }
            Ok(env)
                if env.op == "propose_action" && env.action == "show_decision_log" =>
            {
                // Decision-log card — audit trail of design choices Athena
                // made during the current conversation. Each entry has a
                // label (what was decided), choice (what was picked), and
                // rationale (one sentence why). Helps the user retrace
                // reasoning later — "why did we pick Sonnet?" — without
                // re-running the conversation.
                let intent = env
                    .params
                    .get("intent")
                    .and_then(|v| v.as_str())
                    .map(str::trim)
                    .unwrap_or("");
                let decisions = env
                    .params
                    .get("decisions")
                    .and_then(|v| v.as_array())
                    .cloned()
                    .unwrap_or_default();
                if decisions.is_empty() {
                    out.warnings.push(
                        "show_decision_log: `decisions` must be a non-empty array of {label, choice, rationale} objects"
                            .into(),
                    );
                    cleaned_lines.push(line);
                    continue;
                }
                if decisions.len() > 12 {
                    out.warnings.push(format!(
                        "show_decision_log: {} decisions is too many — cap at 8 per card; split into multiple ops if needed",
                        decisions.len()
                    ));
                    cleaned_lines.push(line);
                    continue;
                }
                let mut missing_field: Option<&'static str> = None;
                for d in &decisions {
                    for field in ["label", "choice", "rationale"] {
                        if d
                            .get(field)
                            .and_then(|v| v.as_str())
                            .map(str::trim)
                            .filter(|s| !s.is_empty())
                            .is_none()
                        {
                            missing_field = Some(field);
                            break;
                        }
                    }
                    if missing_field.is_some() {
                        break;
                    }
                }
                if let Some(field) = missing_field {
                    out.warnings.push(format!(
                        "show_decision_log: every decision needs a non-empty `{field}`"
                    ));
                    cleaned_lines.push(line);
                    continue;
                }
                let title = env
                    .params
                    .get("title")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());

                // Best-effort persist to companion_design_decision so
                // the audit trail survives session reloads. Errors are
                // logged but don't fail the dispatch — the chat-card
                // still renders even if the write doesn't land.
                let inputs: Vec<crate::companion::brain::decisions::DecisionInput<'_>> =
                    decisions
                        .iter()
                        .filter_map(|d| {
                            let label = d.get("label").and_then(|v| v.as_str())?;
                            let choice = d.get("choice").and_then(|v| v.as_str())?;
                            let rationale = d.get("rationale").and_then(|v| v.as_str())?;
                            let decision_timestamp =
                                d.get("timestamp").and_then(|v| v.as_str());
                            Some(crate::companion::brain::decisions::DecisionInput {
                                label,
                                choice,
                                rationale,
                                decision_timestamp,
                            })
                        })
                        .collect();
                // `intent` doubles as `persona_context` for now — it's
                // either a persona id, build session id, or the intent
                // string itself; all queryable for "decisions about X".
                let persona_context: Option<&str> = if intent.is_empty() {
                    None
                } else {
                    Some(intent)
                };
                if let Err(e) = crate::companion::brain::decisions::save_batch(
                    pool,
                    session_id,
                    persona_context,
                    &inputs,
                ) {
                    tracing::warn!(error = %e, "design-decision persist failed (chat-card still rendered)");
                }

                out.chat_cards.push(ChatCard {
                    kind: "decision_log".to_string(),
                    title,
                    config: serde_json::json!({
                        "intent": intent,
                        "decisions": decisions,
                    }),
                });
            }
            Ok(env)
                if env.op == "propose_action" && env.action == "show_observability_plan" =>
            {
                // Observability plan card — the 7th readiness item from
                // cycle-6 doctrine. Two sections: error handling (what
                // escalates to manual review + how) and success metric
                // (which signal is tracked + target).
                let intent = env
                    .params
                    .get("intent")
                    .and_then(|v| v.as_str())
                    .map(str::trim)
                    .unwrap_or("");
                let error_handling = env
                    .params
                    .get("error_handling")
                    .cloned()
                    .unwrap_or(serde_json::Value::Null);
                if !error_handling.is_object() {
                    out.warnings.push(
                        "show_observability_plan: `error_handling` must be an object {triggers: [string], escalation: string}"
                            .into(),
                    );
                    cleaned_lines.push(line);
                    continue;
                }
                let success_metric = env
                    .params
                    .get("success_metric")
                    .cloned()
                    .unwrap_or(serde_json::Value::Null);
                if !success_metric.is_object() {
                    out.warnings.push(
                        "show_observability_plan: `success_metric` must be an object {kind, description, target?}"
                            .into(),
                    );
                    cleaned_lines.push(line);
                    continue;
                }
                let metric_kind = success_metric
                    .get("kind")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                if !matches!(
                    metric_kind,
                    "count_by_status" | "cost_per_run" | "latency" | "custom"
                ) {
                    out.warnings.push(format!(
                        "show_observability_plan: success_metric.kind must be count_by_status|cost_per_run|latency|custom, got `{metric_kind}`"
                    ));
                    cleaned_lines.push(line);
                    continue;
                }
                let title = env
                    .params
                    .get("title")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                out.chat_cards.push(ChatCard {
                    kind: "observability_plan".to_string(),
                    title,
                    config: serde_json::json!({
                        "intent": intent,
                        "error_handling": error_handling,
                        "success_metric": success_metric,
                    }),
                });
            }
            Ok(env)
                if env.op == "propose_action" && env.action == "show_model_tier_choice" =>
            {
                // Model-tier recommendation card. Athena compares the
                // three tiers (haiku / sonnet / opus) for a specific
                // persona intent, marking one as recommended with the
                // rationale from cycle-6 doctrine's tier-selection
                // heuristics. Auto-fire (no approval) — it's an
                // explanation, not a write.
                let intent = env
                    .params
                    .get("intent")
                    .and_then(|v| v.as_str())
                    .map(str::trim)
                    .unwrap_or("");
                let recommended = env
                    .params
                    .get("recommended")
                    .and_then(|v| v.as_str())
                    .map(str::trim)
                    .unwrap_or("");
                if !matches!(recommended, "haiku" | "sonnet" | "opus") {
                    out.warnings.push(format!(
                        "show_model_tier_choice: `recommended` must be haiku|sonnet|opus, got `{recommended}`"
                    ));
                    cleaned_lines.push(line);
                    continue;
                }
                let tiers = env
                    .params
                    .get("tiers")
                    .and_then(|v| v.as_array())
                    .cloned()
                    .unwrap_or_default();
                if tiers.is_empty() {
                    out.warnings.push(
                        "show_model_tier_choice: `tiers` must be a non-empty array of {tier, rationale}"
                            .into(),
                    );
                    cleaned_lines.push(line);
                    continue;
                }
                // Each tier entry needs a valid tier slug and a non-
                // empty rationale; the recommended one is identified
                // by matching `tier` against the top-level `recommended`
                // field (we don't trust per-row `recommended` booleans
                // to be self-consistent).
                let mut bad_tier: Option<String> = None;
                for t in &tiers {
                    let slug = t.get("tier").and_then(|v| v.as_str()).unwrap_or("");
                    if !matches!(slug, "haiku" | "sonnet" | "opus") {
                        bad_tier = Some(slug.to_string());
                        break;
                    }
                    let rationale = t
                        .get("rationale")
                        .and_then(|v| v.as_str())
                        .map(str::trim)
                        .unwrap_or("");
                    if rationale.is_empty() {
                        bad_tier = Some(format!("{slug} (empty rationale)"));
                        break;
                    }
                }
                if let Some(bad) = bad_tier {
                    out.warnings.push(format!(
                        "show_model_tier_choice: invalid tier entry `{bad}`"
                    ));
                    cleaned_lines.push(line);
                    continue;
                }
                let title = env
                    .params
                    .get("title")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                out.chat_cards.push(ChatCard {
                    kind: "model_tier_choice".to_string(),
                    title,
                    config: serde_json::json!({
                        "intent": intent,
                        "recommended": recommended,
                        "tiers": tiers,
                    }),
                });
            }
            Ok(env)
                if env.op == "propose_action" && env.action == "show_trigger_set" =>
            {
                // Trigger-decomposition card. Same family as use_case_set:
                // Athena composes 1-4 trigger configurations applying
                // cycle-6 doctrine's "one trigger condition → one persona
                // response shape" grain test. Each entry has label,
                // source, condition; optional grain + idempotency notes.
                let intent = env
                    .params
                    .get("intent")
                    .and_then(|v| v.as_str())
                    .map(str::trim)
                    .unwrap_or("");
                let triggers = env
                    .params
                    .get("triggers")
                    .and_then(|v| v.as_array())
                    .cloned()
                    .unwrap_or_default();
                if triggers.is_empty() {
                    out.warnings.push(
                        "show_trigger_set: `triggers` must be a non-empty array of {label, source, condition} objects"
                            .into(),
                    );
                    cleaned_lines.push(line);
                    continue;
                }
                if triggers.len() > 6 {
                    out.warnings.push(format!(
                        "show_trigger_set: {} triggers is too many — cap at 4 per card; split into multiple ops if needed",
                        triggers.len()
                    ));
                    cleaned_lines.push(line);
                    continue;
                }
                // Validate each trigger has the required fields up front
                // so the widget renders cleanly.
                let mut missing: Option<&'static str> = None;
                for tr in &triggers {
                    for field in ["label", "source", "condition"] {
                        if tr
                            .get(field)
                            .and_then(|v| v.as_str())
                            .map(str::trim)
                            .filter(|s| !s.is_empty())
                            .is_none()
                        {
                            missing = Some(field);
                            break;
                        }
                    }
                    if missing.is_some() {
                        break;
                    }
                }
                if let Some(field) = missing {
                    out.warnings.push(format!(
                        "show_trigger_set: every trigger needs a non-empty `{field}`"
                    ));
                    cleaned_lines.push(line);
                    continue;
                }
                let title = env
                    .params
                    .get("title")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                out.chat_cards.push(ChatCard {
                    kind: "trigger_set".to_string(),
                    title,
                    config: serde_json::json!({
                        "intent": intent,
                        "triggers": triggers,
                    }),
                });
            }
            Ok(env)
                if env.op == "propose_action" && env.action == "show_use_case_set" =>
            {
                // Use-case decomposition card. Athena supplies an intent
                // + a list of 3-5 use cases tagged golden / variant /
                // out_of_scope, applying the use-case coverage rules
                // from the persona-design best-practices doctrine.
                // Auto-fire (no approval) — it's a structured suggestion
                // for the user to review.
                let intent = env
                    .params
                    .get("intent")
                    .and_then(|v| v.as_str())
                    .map(str::trim)
                    .unwrap_or("");
                let use_cases = env
                    .params
                    .get("use_cases")
                    .and_then(|v| v.as_array())
                    .cloned()
                    .unwrap_or_default();
                if use_cases.is_empty() {
                    out.warnings.push(
                        "show_use_case_set: `use_cases` must be a non-empty array of {label, role, description} objects"
                            .into(),
                    );
                    cleaned_lines.push(line);
                    continue;
                }
                if use_cases.len() > 8 {
                    out.warnings.push(format!(
                        "show_use_case_set: {} use cases is too many — cap at 5 per card; split into multiple ops if needed",
                        use_cases.len()
                    ));
                    cleaned_lines.push(line);
                    continue;
                }
                // Validate role enum on every entry up front so a single
                // bad row doesn't slip through and confuse the widget.
                let mut bad_role: Option<String> = None;
                for uc in &use_cases {
                    let role = uc.get("role").and_then(|v| v.as_str()).unwrap_or("");
                    if !matches!(role, "golden" | "variant" | "out_of_scope") {
                        bad_role = Some(role.to_string());
                        break;
                    }
                }
                if let Some(role) = bad_role {
                    out.warnings.push(format!(
                        "show_use_case_set: `role` must be golden|variant|out_of_scope, got `{role}`"
                    ));
                    cleaned_lines.push(line);
                    continue;
                }
                let title = env
                    .params
                    .get("title")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                out.chat_cards.push(ChatCard {
                    kind: "use_case_set".to_string(),
                    title,
                    config: serde_json::json!({
                        "intent": intent,
                        "use_cases": use_cases,
                    }),
                });
            }
            Ok(env)
                if env.op == "propose_action" && env.action == "show_browser_test_report" =>
            {
                // Browser-test verdict card (Athena × browser tester arc,
                // Phase 3). Emitted at the END of a browser-test turn so the
                // result lands as a structured, scannable artifact instead of
                // prose-only. Auto-fire — the test itself was the gated act;
                // the report is just its output.
                let url = env
                    .params
                    .get("url")
                    .and_then(|v| v.as_str())
                    .map(str::trim)
                    .unwrap_or("");
                let steps = env
                    .params
                    .get("steps")
                    .and_then(|v| v.as_array())
                    .cloned()
                    .unwrap_or_default();
                if steps.is_empty() || steps.len() > 12 {
                    out.warnings.push(format!(
                        "show_browser_test_report: `steps` must be 1-12 {{label, result, evidence?}} rows, got {}",
                        steps.len()
                    ));
                    cleaned_lines.push(line);
                    continue;
                }
                let mut bad_result: Option<String> = None;
                for s in &steps {
                    let r = s.get("result").and_then(|v| v.as_str()).unwrap_or("");
                    if !matches!(r, "pass" | "fail" | "warn") {
                        bad_result = Some(r.to_string());
                        break;
                    }
                }
                if let Some(r) = bad_result {
                    out.warnings.push(format!(
                        "show_browser_test_report: `result` must be pass|fail|warn, got `{r}`"
                    ));
                    cleaned_lines.push(line);
                    continue;
                }
                let defects = env
                    .params
                    .get("defects")
                    .and_then(|v| v.as_array())
                    .cloned()
                    .unwrap_or_default();
                if defects.len() > 8 {
                    out.warnings.push(format!(
                        "show_browser_test_report: cap `defects` at 8, got {}",
                        defects.len()
                    ));
                    cleaned_lines.push(line);
                    continue;
                }
                let console_errors = env
                    .params
                    .get("console_errors")
                    .and_then(|v| v.as_array())
                    .map(|a| a.iter().take(20).cloned().collect::<Vec<_>>())
                    .unwrap_or_default();
                let security_notes = env
                    .params
                    .get("security_notes")
                    .and_then(|v| v.as_array())
                    .map(|a| a.iter().take(5).cloned().collect::<Vec<_>>())
                    .unwrap_or_default();
                let title = env
                    .params
                    .get("title")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                out.chat_cards.push(ChatCard {
                    kind: "browser_test_report".to_string(),
                    title,
                    config: serde_json::json!({
                        "url": url,
                        "project_name": env.params.get("project_name").and_then(|v| v.as_str()).unwrap_or(""),
                        // Goal-UAT linkage: when this report is a goal's acceptance
                        // gate, the directive injects goal_id so the card can close
                        // the gate on a clean pass.
                        "goal_id": env.params.get("goal_id").and_then(|v| v.as_str()).unwrap_or(""),
                        "steps": steps,
                        "defects": defects,
                        "console_errors": console_errors,
                        "security_notes": security_notes,
                    }),
                });
            }
            Ok(env)
                if env.op == "propose_action" && env.action == "show_template_suggestions" =>
            {
                // Template-match card. Athena supplies the intent text; the
                // widget calls `companion_match_templates` on mount to
                // fetch the actual matches (we don't query the system DB
                // from here — dispatcher only has UserDbPool). Auto-fire,
                // no approval — the suggestions are a pointer, not an
                // action.
                let intent = env
                    .params
                    .get("intent")
                    .and_then(|v| v.as_str())
                    .map(str::trim)
                    .unwrap_or("");
                if intent.is_empty() {
                    out.warnings.push(
                        "show_template_suggestions: `intent` (the user's described persona purpose) is required"
                            .into(),
                    );
                    cleaned_lines.push(line);
                    continue;
                }
                let limit = env
                    .params
                    .get("limit")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(3)
                    .clamp(1, 5);
                let title = env
                    .params
                    .get("title")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                out.chat_cards.push(ChatCard {
                    kind: "template_suggestions".to_string(),
                    title,
                    config: serde_json::json!({
                        "intent": intent,
                        "limit": limit,
                    }),
                });
            }
            Ok(env)
                if env.op == "propose_action" && env.action == "show_persona_walkthrough" =>
            {
                // Persona-design walkthrough — long-form markdown plan
                // Athena composes for a specific intent, pulling from the
                // `concepts/persona-design-best-practices.md` doctrine.
                // Auto-fire (no approval); it's a suggestion to read, not
                // an action to commit. Config is just `{ intent, content }`
                // — the widget renders the markdown as-is.
                let content = env
                    .params
                    .get("content")
                    .and_then(|v| v.as_str())
                    .map(str::trim)
                    .unwrap_or("");
                if content.is_empty() {
                    out.warnings
                        .push("show_persona_walkthrough: `content` (markdown) is required".into());
                    cleaned_lines.push(line);
                    continue;
                }
                let intent = env
                    .params
                    .get("intent")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let title = env
                    .params
                    .get("title")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                out.chat_cards.push(ChatCard {
                    kind: "persona_walkthrough".to_string(),
                    title,
                    config: serde_json::json!({
                        "intent": intent,
                        "content": content,
                    }),
                });
            }
            Ok(env) if env.op == "propose_action" && env.action == "compose_cockpit" => {
                let widgets = env.params.get("widgets");
                let widgets_arr = widgets.and_then(|v| v.as_array());
                if widgets_arr.is_none() || widgets_arr.unwrap().is_empty() {
                    out.warnings
                        .push("compose_cockpit: `widgets` must be a non-empty array".into());
                    cleaned_lines.push(line);
                    continue;
                }
                let title = env
                    .params
                    .get("title")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Cockpit");
                let now = chrono::Utc::now().to_rfc3339();
                let spec = serde_json::json!({
                    "title": title,
                    "widgets": widgets,
                    "updated_at": now,
                });
                out.cockpits.push(spec.to_string());
            }
            Ok(env) if env.op == "propose_action" && env.action == "explain_in_cockpit" => {
                // Ephemeral explanation overlay (orb decision `0` flow). Unlike
                // compose_cockpit, widget kinds are validated here: an
                // explanation with a hallucinated kind renders as an error box
                // at the worst possible moment (the user just asked for help),
                // so unknown kinds are dropped with a warning instead.
                const EXPLAIN_KINDS: &[&str] = &[
                    "verdict",
                    "flow_steps",
                    "comparison_cards",
                    "timeline",
                    "stat_grid",
                    "log_excerpt",
                    "text_callout",
                    "metric_spark",
                    "issue_list",
                ];
                let widgets_arr = env
                    .params
                    .get("widgets")
                    .and_then(|v| v.as_array())
                    .cloned()
                    .unwrap_or_default();
                let mut kept: Vec<serde_json::Value> = Vec::new();
                for w in widgets_arr {
                    let kind = w.get("kind").and_then(|k| k.as_str()).unwrap_or("");
                    if EXPLAIN_KINDS.contains(&kind) {
                        kept.push(w);
                    } else {
                        out.warnings.push(format!(
                            "explain_in_cockpit: dropped unknown widget kind `{kind}`"
                        ));
                    }
                }
                if kept.is_empty() {
                    out.warnings.push(
                        "explain_in_cockpit: `widgets` must be a non-empty array of known kinds"
                            .into(),
                    );
                    cleaned_lines.push(line);
                    continue;
                }
                let title = env
                    .params
                    .get("title")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Explanation");
                let decision_id = env
                    .params
                    .get("decision_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let now = chrono::Utc::now().to_rfc3339();
                let spec = serde_json::json!({
                    "title": title,
                    "decision_id": decision_id,
                    "widgets": kept,
                    "updated_at": now,
                });
                out.explain_cockpits.push(spec.to_string());
            }
            // ─────────────────────────────────────────────────────────────
            // WP3 — composing a panel beside the Mastermind canvas.
            //
            // The canvas is the artifact she acts IN, so a composed surface
            // docks there rather than becoming another chat card. Auto-fire,
            // no approval: a SurfaceSpec renders information and PROPOSES
            // actions, and every one of those is consent-gated at click time
            // by SurfaceRenderer. What gets validated here is the two things
            // the frontend cannot re-check: that the slug is an island she
            // actually read out of the published scene (not a demo island,
            // not an invention), and that the spec is a v1 envelope with
            // blocks in it.
            // ─────────────────────────────────────────────────────────────
            Ok(env) if env.op == "propose_action" && env.action == "compose_canvas_panel" => {
                let slug = env
                    .params
                    .get("slug")
                    .or_else(|| env.params.get("project"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                // Without the system DB there is no published scene to check
                // the slug against, and an unvalidated slug is exactly what
                // this op exists to prevent. Fail closed.
                let Some(db) = sys_db else {
                    out.warnings.push(
                        "compose_canvas_panel could not be validated: the canvas snapshot is \
                         not reachable from this turn. Tell the user rather than composing."
                            .into(),
                    );
                    cleaned_lines.push(line);
                    continue;
                };
                let slug = match crate::companion::canvas::resolve_scene_slug(db, slug) {
                    Ok(s) => s,
                    Err(reason) => {
                        out.warnings.push(format!("compose_canvas_panel: {reason}"));
                        cleaned_lines.push(line);
                        continue;
                    }
                };
                let spec = env.params.get("spec");
                let blocks = spec
                    .and_then(|s| s.get("blocks"))
                    .and_then(|v| v.as_array());
                let envelope_ok = spec
                    .and_then(|s| s.get("surface"))
                    .and_then(|v| v.as_str())
                    == Some("v1");
                match (envelope_ok, blocks) {
                    (true, Some(b)) if !b.is_empty() && b.len() <= CANVAS_PANEL_MAX_BLOCKS => {
                        out.canvas_panels.push(CanvasPanelCompose {
                            slug,
                            spec_version: CANVAS_PANEL_SPEC_VERSION,
                            spec: spec.map(|s| s.to_string()).unwrap_or_default(),
                        });
                    }
                    (_, Some(b)) if b.len() > CANVAS_PANEL_MAX_BLOCKS => {
                        out.warnings.push(format!(
                            "compose_canvas_panel: {} blocks exceeds the cap of \
                             {CANVAS_PANEL_MAX_BLOCKS}. Compose the ones that matter.",
                            b.len()
                        ));
                        cleaned_lines.push(line);
                    }
                    _ => {
                        out.warnings.push(
                            "compose_canvas_panel: `spec` must be a SurfaceSpec v1 envelope — \
                             {\"surface\":\"v1\",\"title\":…,\"blocks\":[…]} with at least one block."
                                .into(),
                        );
                        cleaned_lines.push(line);
                    }
                }
            }
            // ─────────────────────────────────────────────────────────────
            // WP4 — steering the Mastermind canvas (`canvas_control`).
            //
            // The v2 door onto the frontend's canvas action grammar
            // (`canvasActionStore`): camera verbs plus the zoom-gated popover
            // opens. Auto-fire, no approval: every accepted kind is
            // reversible VIEW state and mutates nothing — the same consent
            // posture as compose. Rust validates what the frontend cannot:
            // that any slug names an island in the PUBLISHED scene, that the
            // kind is one the grammar speaks, and that bands / numbers are
            // well-formed. The settled result (band, camera, refusal) comes
            // back through `companion_canvas_control_result` as a System
            // episode on the next turn.
            // ─────────────────────────────────────────────────────────────
            Ok(env) if env.op == "propose_action" && env.action == "canvas_control" => {
                if out.canvas_controls.len() >= CANVAS_CONTROL_MAX_PER_TURN {
                    out.warnings.push(format!(
                        "canvas_control: more than {CANVAS_CONTROL_MAX_PER_TURN} steering \
                         actions in one turn is camera thrash; the extras were dropped."
                    ));
                    cleaned_lines.push(line);
                    continue;
                }
                let Some(db) = sys_db else {
                    out.warnings.push(
                        "canvas_control could not be validated: the canvas snapshot is not \
                         reachable from this turn. Tell the user rather than steering blind."
                            .into(),
                    );
                    cleaned_lines.push(line);
                    continue;
                };
                match validate_canvas_control(db, &env.params) {
                    Ok(action_json) => out
                        .canvas_controls
                        .push(CanvasControlDispatch { action: action_json }),
                    Err(reason) => {
                        out.warnings.push(format!("canvas_control: {reason}"));
                        cleaned_lines.push(line);
                    }
                }
            }
            Ok(env) if env.op == "propose_action" && env.action == "open_lab" => {
                let persona_id = env
                    .params
                    .get("persona_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let mode = env
                    .params
                    .get("mode")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                if persona_id.is_empty() || mode.is_empty() {
                    out.warnings
                        .push("open_lab: missing `persona_id` or `mode`".into());
                    cleaned_lines.push(line);
                    continue;
                }
                if !ALLOWED_LAB_MODES.contains(&mode) {
                    out.warnings.push(format!(
                        "rejected lab mode `{mode}` (expected one of {ALLOWED_LAB_MODES:?})"
                    ));
                    cleaned_lines.push(line);
                    continue;
                }
                out.lab_opens
                    .push((persona_id.to_string(), mode.to_string()));
            }
            // Phase F/G: `use_connector` is gated PER CAPABILITY (see the
            // `cap.requires_approval` branch near the end of this arm):
            // read-only capabilities auto-fire through the background-job
            // worker (no approval card — friction the user explicitly
            // rejected for list/get calls); write/mutation capabilities route
            // through an approval card instead. Validation happens here so a
            // hallucinated connector/capability surfaces as a system episode
            // (Athena reads it next turn) instead of a wasted job queue slot.
            //
            // Rejection visibility: every rejection path below also
            // writes a System episode via `note_dispatcher_rejection`
            // so Athena's *next* turn knows her last `use_connector`
            // got dropped — closes the silent-prod-no-op pattern the
            // 2026-05-27 stress run surfaced (5 turns claimed action
            // but produced no job because the dispatcher silently
            // stripped the OP).
            Ok(env) if env.op == "propose_action" && env.action == "use_connector" => {
                let connector_name = env
                    .params
                    .get("connector_name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let capability = env
                    .params
                    .get("capability")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                if connector_name.is_empty() || capability.is_empty() {
                    note_dispatcher_rejection(
                        pool,
                        session_id,
                        connector_name,
                        capability,
                        "missing `connector_name` or `capability` field",
                    );
                    out.warnings
                        .push("use_connector: missing `connector_name` or `capability`".into());
                    cleaned_lines.push(line);
                    continue;
                }
                // Verify the connector is pinned + enabled in the
                // sidebar before queuing — saves the worker from
                // running with no credentials accessible. Always-active
                // builtins (local_drive, personas_database, codebase,
                // …) bypass this check: they have no credentials to
                // pin and the user doesn't need to opt in.
                let bypass_pin_gate =
                    crate::companion::connectors::is_always_active_builtin(connector_name);
                if !bypass_pin_gate {
                    match crate::companion::connectors::list(pool) {
                        Ok(active) => {
                            let row =
                                active.iter().find(|c| c.connector_name == connector_name);
                            match row {
                                Some(r) if !r.enabled => {
                                    let reason = format!(
                                        "`{connector_name}` is pinned but disabled — ask the user to toggle it on, or pivot to a wired+enabled connector"
                                    );
                                    note_dispatcher_rejection(
                                        pool,
                                        session_id,
                                        connector_name,
                                        capability,
                                        &reason,
                                    );
                                    out.warnings
                                        .push(format!("use_connector: {reason}"));
                                    cleaned_lines.push(line);
                                    continue;
                                }
                                None => {
                                    let reason = format!(
                                        "`{connector_name}` is not pinned in the sidebar — ask the user to pin it via the vault, or pivot to a wired connector"
                                    );
                                    note_dispatcher_rejection(
                                        pool,
                                        session_id,
                                        connector_name,
                                        capability,
                                        &reason,
                                    );
                                    out.warnings
                                        .push(format!("use_connector: {reason}"));
                                    cleaned_lines.push(line);
                                    continue;
                                }
                                _ => {} // pinned + enabled — proceed.
                            }
                        }
                        Err(e) => {
                            let reason =
                                format!("connector list query failed ({e}) — internal DB issue");
                            note_dispatcher_rejection(
                                pool,
                                session_id,
                                connector_name,
                                capability,
                                &reason,
                            );
                            out.warnings
                                .push(format!("use_connector: connector list failed: {e}"));
                            cleaned_lines.push(line);
                            continue;
                        }
                    }
                }
                // Validate capability against the registry.
                let caps = crate::companion::connectors::capabilities_for(connector_name);
                let cap_match = caps.and_then(|cs| cs.iter().find(|c| c.slug == capability));
                let Some(cap) = cap_match else {
                    let known_list: Vec<&str> = caps
                        .map(|cs| cs.iter().map(|c| c.slug).collect())
                        .unwrap_or_default();
                    let reason = format!(
                        "capability `{capability}` not in `{connector_name}` registry; known capabilities: {known_list:?}"
                    );
                    note_dispatcher_rejection(
                        pool,
                        session_id,
                        connector_name,
                        capability,
                        &reason,
                    );
                    out.warnings.push(format!("use_connector: {reason}"));
                    cleaned_lines.push(line);
                    continue;
                };

                // Approval-gated capabilities (writes to user-visible
                // external surfaces — post a message, send an email,
                // run a mutation) route through the approval card path
                // instead of auto-firing. Read-only capabilities
                // (list_*, get_*) auto-fire as before. The flag is
                // declared on `ConnectorCapability::requires_approval`.
                if cap.requires_approval {
                    match insert_approval(pool, session_id, &env) {
                        Ok(created) => out.approvals.push(created),
                        Err(e) => {
                            let reason = format!(
                                "approval-card insert for `{connector_name}.{capability}` failed: {e}"
                            );
                            note_dispatcher_rejection(
                                pool,
                                session_id,
                                connector_name,
                                capability,
                                &reason,
                            );
                            out.warnings.push(format!("use_connector: {reason}"));
                        }
                    }
                    // Strip the OP line from display; the approval
                    // card now carries the action.
                    continue;
                }

                // Auto-fire path: enqueue. Job worker picks it up within
                // seconds and appends a system episode with the result;
                // chat is never blocked.
                let job_params = serde_json::json!({
                    "connector_name": connector_name,
                    "capability": capability,
                    "args": env.params.get("args").cloned().unwrap_or(serde_json::json!({})),
                });
                let task_title = format!("Calling {connector_name}");
                if let Err(e) = crate::companion::jobs::enqueue_task(
                    pool,
                    "connector_use",
                    &job_params,
                    None,
                    Some(&task_title),
                    None, // parent_turn_id threaded in phase 2 (episode id not yet known here)
                    Some(session_id), // owning conversation (multiconv P1)
                ) {
                    let reason =
                        format!("background-job enqueue failed for `{connector_name}.{capability}`: {e}");
                    note_dispatcher_rejection(
                        pool,
                        session_id,
                        connector_name,
                        capability,
                        &reason,
                    );
                    out.warnings.push(format!("use_connector: {reason}"));
                    cleaned_lines.push(line);
                    continue;
                }
                // Strip the OP line from display — Athena's prose
                // around it remains. Don't push to cleaned_lines.
            }
            // A2: autonomous continuation. Athena emits this when she
            // wants the system to give her another turn (after a short
            // delay) so she can keep working without user input. Only
            // honored when the session is in autonomous mode — session.rs
            // gates the actual schedule. We strip the line from display
            // either way so the user never sees the directive verbatim.
            Ok(env)
                if env.op == "propose_action" && env.action == "continue_autonomously" =>
            {
                let rationale = env
                    .params
                    .get("rationale")
                    .and_then(|v| v.as_str())
                    .unwrap_or("(no rationale)");
                tracing::debug!(rationale = %rationale, "athena: continue_autonomously requested");
                out.requests_continuation = true;
                // Don't push to cleaned_lines — strip the directive.
            }
            Ok(env) if env.op == "propose_action" && env.action == "open_route" => {
                let route = env
                    .params
                    .get("route")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                if route.is_empty() {
                    out.warnings.push("open_route: missing `route`".into());
                    cleaned_lines.push(line);
                    continue;
                }
                if !ALLOWED_ROUTES.contains(&route) {
                    out.warnings.push(format!("rejected route `{route}`"));
                    cleaned_lines.push(line);
                    continue;
                }
                out.navigations.push(route.to_string());
            }
            // ─────────────────────────────────────────────────────────────
            // WP2 — the editable multi-session fleet plan.
            //
            // Athena drafts what she would start (typed turn or spoken turn —
            // voice reaches the same `send()` path, so nothing here may assume
            // a typed origin), the CHAT card lets the user edit and confirm,
            // and only then does anything spawn. Auto-fire, no approval card:
            // the card itself IS the consent surface.
            //
            // Everything is validated HERE, at the door, against the same
            // boundaries `fleet_dispatch` enforces at fire time — so a plan
            // that renders is a plan that can actually run. Rejection follows
            // the arm convention: a warning Athena reads next turn, and the op
            // line stripped from the visible reply.
            // ─────────────────────────────────────────────────────────────
            Ok(env) if env.op == "propose_action" && env.action == "show_fleet_plan" => {
                let intent = env
                    .params
                    .get("operation_intent")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let rows = env
                    .params
                    .get("rows")
                    .and_then(|v| v.as_array())
                    .cloned()
                    .unwrap_or_default();
                // The cwd rule needs the system DB (`dev_projects`). Without it
                // we cannot prove containment, so we fail CLOSED rather than
                // render an unvalidated plan whose Confirm button spawns
                // permission-skipping terminals.
                let Some(db) = sys_db else {
                    out.warnings.push(
                        "show_fleet_plan could not be validated: the project registry is not \
                         reachable from this turn. Tell the user rather than proposing a plan."
                            .into(),
                    );
                    continue;
                };
                match crate::commands::companion::approvals::validate_fleet_plan(
                    db, intent, &rows,
                ) {
                    Ok((intent, plan)) => {
                        let rows_json: Vec<serde_json::Value> = plan
                            .iter()
                            .map(|r| {
                                serde_json::json!({
                                    "cwd": r.cwd,
                                    "objective": r.objective,
                                    "skill": r.skill,
                                    "label": r.label,
                                    "model": r.model,
                                    "effort": r.effort,
                                })
                            })
                            .collect();
                        out.chat_cards.push(ChatCard {
                            kind: "fleet_plan".to_string(),
                            title: env
                                .params
                                .get("title")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string()),
                            config: serde_json::json!({
                                "operation_intent": intent,
                                "rows": rows_json,
                            }),
                        });
                    }
                    Err(reason) => {
                        out.warnings
                            .push(format!("rejected show_fleet_plan: {reason}"));
                        cleaned_lines.push(line);
                        continue;
                    }
                }
            }
            // ─────────────────────────────────────────────────────────────
            // WP3 — the editable ship milestone.
            //
            // The same contract as `show_fleet_plan` one arm up, aimed at the
            // Ship layer instead of the fleet: Athena proposes a WHOLE
            // milestone (name, goal, scope members), the chat card is where
            // the operator edits and drops rows, and nothing is written until
            // Confirm. Auto-fire, no approval card — the card IS the consent
            // surface — and NOT an `ALLOWED_ACTIONS` entry, so there is no
            // executor arm and no second list to drift.
            //
            // Every id is resolved HERE against the real registry, by the same
            // validator the confirm path re-runs. A milestone whose members
            // do not exist is not a milestone.
            // ─────────────────────────────────────────────────────────────
            Ok(env) if env.op == "propose_action" && env.action == "show_ship_milestone" => {
                let project_slug = env
                    .params
                    .get("project_slug")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let name = env.params.get("name").and_then(|v| v.as_str()).unwrap_or("");
                let goal = env.params.get("goal").and_then(|v| v.as_str()).unwrap_or("");
                let rows = env
                    .params
                    .get("rows")
                    .and_then(|v| v.as_array())
                    .cloned()
                    .unwrap_or_default();
                // Resolving a project, its use cases and its goals all need the
                // system DB. Without it there is no way to tell a real id from
                // an invented one, so we fail CLOSED rather than render a card
                // whose Confirm button would write a milestone full of
                // hallucinated members.
                let Some(db) = sys_db else {
                    out.warnings.push(
                        "show_ship_milestone could not be validated: the project registry is \
                         not reachable from this turn. Tell the user rather than proposing a \
                         milestone."
                            .into(),
                    );
                    continue;
                };
                match crate::commands::companion::approvals::validate_ship_milestone(
                    db,
                    project_slug,
                    name,
                    goal,
                    &rows,
                ) {
                    Ok(plan) => {
                        let rows_json: Vec<serde_json::Value> = plan
                            .rows
                            .iter()
                            .map(|r| {
                                serde_json::json!({
                                    "item_kind": r.item_kind,
                                    "item_id": r.item_id,
                                    "description": r.description,
                                })
                            })
                            .collect();
                        out.chat_cards.push(ChatCard {
                            kind: "ship_milestone".to_string(),
                            title: env
                                .params
                                .get("title")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string()),
                            config: serde_json::json!({
                                "project_id": plan.project_id,
                                "name": plan.name,
                                "goal": plan.goal,
                                "rows": rows_json,
                            }),
                        });
                    }
                    Err(reason) => {
                        out.warnings
                            .push(format!("rejected show_ship_milestone: {reason}"));
                        cleaned_lines.push(line);
                        continue;
                    }
                }
            }
            Ok(env)
                if env.op == "propose_action"
                    && env.action == "show_persona_creation_offer" =>
            {
                // Offer card: "Build it for me" vs "Show me how to build it".
                // Athena emits this when a user describes a persona they want.
                // Auto-fire — the user picks from the two buttons; the widget
                // owns the build-prefill / walkthrough-trigger wiring on click.
                let intent = env
                    .params
                    .get("intent")
                    .and_then(|v| v.as_str())
                    .map(str::trim)
                    .unwrap_or("");
                if intent.is_empty() {
                    out.warnings
                        .push("show_persona_creation_offer: missing `intent`".into());
                    cleaned_lines.push(line);
                    continue;
                }
                out.chat_cards.push(ChatCard {
                    kind: "persona_creation_offer".to_string(),
                    title: None,
                    config: serde_json::json!({ "intent": intent }),
                });
            }
            Ok(env)
                if env.op == "propose_action" && env.action == "show_walkthrough_offer" =>
            {
                // Generalized "Show me / Just tell me" offer for any guided
                // walkthrough (E3). Auto-fire; the widget owns the click wiring.
                // `topic` must be a real, allow-listed walkthrough.
                let topic = env
                    .params
                    .get("topic")
                    .and_then(|v| v.as_str())
                    .map(str::trim)
                    .unwrap_or("");
                let summary = env
                    .params
                    .get("summary")
                    .and_then(|v| v.as_str())
                    .map(str::trim)
                    .unwrap_or("");
                if topic.is_empty() {
                    out.warnings
                        .push("show_walkthrough_offer: missing `topic`".into());
                    cleaned_lines.push(line);
                    continue;
                }
                // Generative Tours: a topic OUTSIDE the static registry is no
                // longer rejected — it is offered as a *generative* walkthrough
                // ("Show me" composes a tour via `compose_tour` instead of
                // playing a registry script). Sanitize free-text topics hard:
                // they render in the widget and seed the compose prompt.
                let is_static = GUIDED_TOPICS.contains(&topic);
                if !is_static && topic.len() > 120 {
                    out.warnings.push(format!(
                        "rejected walkthrough offer topic (too long: {} chars)",
                        topic.len()
                    ));
                    cleaned_lines.push(line);
                    continue;
                }
                out.chat_cards.push(ChatCard {
                    kind: "walkthrough_offer".to_string(),
                    title: None,
                    config: serde_json::json!({
                        "topic": topic,
                        "summary": summary,
                        "generative": !is_static,
                    }),
                });
            }
            Ok(env)
                if env.op == "propose_action"
                    && env.action == "start_guided_walkthrough" =>
            {
                // Auto-fire: launch a registry-defined guided walkthrough (orb
                // glides + element glow + narration). The step content lives in
                // the frontend registry (`guidance/walkthroughs.ts`); Athena
                // only names a topic, which we validate against the allow-list.
                let topic = env
                    .params
                    .get("topic")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                if topic.is_empty() {
                    out.warnings
                        .push("start_guided_walkthrough: missing `topic`".into());
                    cleaned_lines.push(line);
                    continue;
                }
                if !GUIDED_TOPICS.contains(&topic) {
                    out.warnings.push(format!(
                        "rejected guided walkthrough topic `{topic}` (expected one of {GUIDED_TOPICS:?})"
                    ));
                    cleaned_lines.push(line);
                    continue;
                }
                out.guide_walkthroughs.push(topic.to_string());
            }
            Ok(env) if env.op == "propose_action" && env.action == "point_at" => {
                // Auto-fire: ring one allow-listed UI anchor + narrate it (no
                // pre-authored topic). The anchor names a stable target from the
                // shared catalog; narration is the line Athena wrote this turn.
                let anchor = env.params.get("anchor").and_then(|v| v.as_str()).unwrap_or("");
                let narration = env
                    .params
                    .get("narration")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .trim();
                if anchor.is_empty() || narration.is_empty() {
                    out.warnings
                        .push("point_at: missing `anchor` or `narration`".into());
                    cleaned_lines.push(line);
                    continue;
                }
                if !ANCHOR_IDS.contains(&anchor) {
                    out.warnings.push(format!(
                        "rejected point_at anchor `{anchor}` (expected one of {ANCHOR_IDS:?})"
                    ));
                    cleaned_lines.push(line);
                    continue;
                }
                out.point_ats.push(PointAt {
                    anchor: anchor.to_string(),
                    narration: narration.to_string(),
                });
            }
            Ok(env) if env.op == "propose_action" && env.action == "compose_walkthrough" => {
                // Auto-fire: a runtime-assembled multi-step tour over catalog
                // anchors. Validate every step (anchor in catalog + non-empty
                // narration) and the overall length; reject the whole tour on
                // any bad step so a half-broken walkthrough never runs.
                let raw_steps = env.params.get("steps").and_then(|v| v.as_array());
                let Some(raw_steps) = raw_steps else {
                    out.warnings
                        .push("compose_walkthrough: missing `steps` array".into());
                    cleaned_lines.push(line);
                    continue;
                };
                if raw_steps.len() < COMPOSE_MIN_STEPS || raw_steps.len() > COMPOSE_MAX_STEPS {
                    out.warnings.push(format!(
                        "rejected compose_walkthrough: {} steps (expected {COMPOSE_MIN_STEPS}-{COMPOSE_MAX_STEPS})",
                        raw_steps.len()
                    ));
                    cleaned_lines.push(line);
                    continue;
                }
                let mut steps = Vec::with_capacity(raw_steps.len());
                let mut bad: Option<String> = None;
                for s in raw_steps {
                    let anchor = s.get("anchor").and_then(|v| v.as_str()).unwrap_or("");
                    let narration = s
                        .get("narration")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .trim();
                    if anchor.is_empty() || narration.is_empty() {
                        bad = Some("a step is missing `anchor` or `narration`".into());
                        break;
                    }
                    if !ANCHOR_IDS.contains(&anchor) {
                        bad = Some(format!("unknown anchor `{anchor}`"));
                        break;
                    }
                    steps.push(PointAt {
                        anchor: anchor.to_string(),
                        narration: narration.to_string(),
                    });
                }
                if let Some(reason) = bad {
                    out.warnings
                        .push(format!("rejected compose_walkthrough: {reason}"));
                    cleaned_lines.push(line);
                    continue;
                }
                let title = env
                    .params
                    .get("title")
                    .and_then(|v| v.as_str())
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty());
                out.composed_walkthroughs
                    .push(ComposedWalkthrough { title, steps });
            }
            Ok(env) if env.op == "propose_action" && env.action == "compose_tour" => {
                // Generative Tours: a full persisted tour (vs the ephemeral
                // `compose_walkthrough` above). Every step is proven against
                // the generated tour-anchor manifest — an unknown spotlight
                // anchor, sidebar section, or sub-tab setter rejects the
                // WHOLE tour with a warning Athena sees next turn. Valid
                // specs are persisted by session.rs via `tours::save_tour`
                // and surface in the Learning timeline with the
                // composed-by-Athena badge.
                let topic = env
                    .params
                    .get("topic")
                    .and_then(|v| v.as_str())
                    .map(str::trim)
                    .filter(|s| !s.is_empty() && s.len() <= 120)
                    .unwrap_or("walkthrough");
                match crate::companion::tours::validate_tour_spec(&env.params) {
                    Ok((title, description, steps)) => {
                        out.composed_tours.push(
                            serde_json::json!({
                                "topic": topic,
                                "title": title,
                                "description": description,
                                "steps": steps,
                            })
                            .to_string(),
                        );
                    }
                    Err(reason) => {
                        out.warnings
                            .push(format!("rejected compose_tour: {reason}"));
                        cleaned_lines.push(line);
                        continue;
                    }
                }
            }
            // ─────────────────────────────────────────────────────────────
            // Detail-on-demand read ops (auto-fire, read-only, no approval).
            //
            // The prompt carries a BOUNDED index of personas / dev contexts
            // / skills (see `prompt::format_persona_index` and friends).
            // These four ops are the other half of that contract: the index
            // is deliberately truncated, so Athena needs a cheap way to pull
            // one full record — and `assign_team` needs a `team_id` that the
            // always-on index does not carry at all.
            //
            // They are special-case arms rather than ALLOWED_ACTIONS entries
            // on purpose: an entry there requires a matching executor, and
            // the two lists have diverged before. An arm that does the whole
            // job here cannot diverge from anything. Nothing mutates; the
            // result is appended as a System episode so it lands in the next
            // turn's recall, the same channel `note_dispatcher_rejection`
            // uses.
            // ─────────────────────────────────────────────────────────────
            Ok(env) if env.op == "propose_action" && READ_OPS.contains(&env.action.as_str()) => {
                let query = env
                    .params
                    .get("query")
                    .and_then(|v| v.as_str())
                    .or_else(|| env.params.get("persona_id").and_then(|v| v.as_str()))
                    .or_else(|| env.params.get("context_id").and_then(|v| v.as_str()))
                    .or_else(|| env.params.get("name").and_then(|v| v.as_str()))
                    .or_else(|| env.params.get("slug").and_then(|v| v.as_str()))
                    .map(str::trim)
                    .unwrap_or("");
                let action = env.action.as_str();
                if query.is_empty() && !READ_OPS_QUERY_OPTIONAL.contains(&action) {
                    let reason = format!(
                        "`{action}` needs a `query` param (the name or id to look up)"
                    );
                    note_read_op_result(pool, session_id, action, query, &reason);
                    out.warnings.push(format!("{action}: missing `query`"));
                    continue;
                }
                if query.len() > READ_OP_QUERY_MAX {
                    let reason = format!(
                        "`{action}` query was {} chars; keep it to a name or id (max {READ_OP_QUERY_MAX})",
                        query.len()
                    );
                    note_read_op_result(pool, session_id, action, "", &reason);
                    out.warnings.push(format!("{action}: query too long"));
                    continue;
                }
                let body = match action {
                    "describe_skill" => describe_skill(sys_db, query),
                    _ => match sys_db {
                        Some(db) => match action {
                            "describe_persona" => describe_persona(db, query),
                            "describe_context" => describe_context(db, query),
                            "describe_canvas_project" => {
                                crate::companion::canvas::describe_canvas_project(db, query)
                            }
                            "describe_canvas_freshness" => {
                                crate::companion::canvas::describe_canvas_freshness(db, query)
                            }
                            "list_runner_tasks" => list_runner_tasks(db, query),
                            _ => list_teams(db, query),
                        },
                        None => format!(
                            "`{action}` could not run: the app database is not \
                             reachable from this turn. Tell the user rather \
                             than guessing an id."
                        ),
                    },
                };
                note_read_op_result(pool, session_id, action, query, &body);
            }
            Ok(mut env) if env.op == "propose_action" => {
                if !ALLOWED_ACTIONS.contains(&env.action.as_str()) {
                    out.warnings
                        .push(format!("rejected unknown action `{}`", env.action));
                    cleaned_lines.push(line);
                    continue;
                }
                // Anti-hallucination guard: a write_fact proposal without
                // any source episodes is rejected at parse time. Athena
                // sees the warning in the next turn's system context and
                // can re-propose with proper provenance.
                if env.action == "write_fact" || env.action == "write_procedural" {
                    let has_sources = env
                        .params
                        .get("sources")
                        .and_then(|v| v.as_array())
                        .is_some_and(|arr| {
                            arr.iter()
                                .any(|x| x.as_str().is_some_and(|s| !s.is_empty()))
                        });
                    if !has_sources {
                        out.warnings.push(format!(
                            "rejected {action}: `sources` (episode_id list) must be non-empty",
                            action = env.action
                        ));
                        cleaned_lines.push(line);
                        continue;
                    }
                }
                // A backlog-triage batch with no items would render an
                // actionable card whose Approve button applies nothing. Reject
                // it at parse time rather than persisting a no-op consent
                // surface (same reasoning as the blank-action skip in
                // `companion_list_pending_approvals`).
                if env.action == "backlog_apply_triage" {
                    let has_items = env
                        .params
                        .get("items")
                        .and_then(|v| v.as_array())
                        .is_some_and(|arr| !arr.is_empty());
                    if !has_items {
                        out.warnings.push(
                            "rejected backlog_apply_triage: `items` must be a non-empty array"
                                .to_string(),
                        );
                        cleaned_lines.push(line);
                        continue;
                    }
                }
                // Identity diffs (F1): structurally validate the anchored-diff
                // batch before it becomes an approval card. The full
                // anchor-exists check happens at execute time (partial-failure
                // reporting). `content`-mode (intake first draft) is unchecked.
                if env.action == "update_identity" {
                    if let Some(arr) = env.params.get("diffs").and_then(|v| v.as_array()) {
                        use crate::companion::brain::identity::{IdentityDiff, MAX_DIFFS_PER_OP};
                        if arr.is_empty() || arr.len() > MAX_DIFFS_PER_OP {
                            out.warnings.push(format!(
                                "rejected update_identity: 1..={MAX_DIFFS_PER_OP} diffs required, got {}",
                                arr.len()
                            ));
                            cleaned_lines.push(line);
                            continue;
                        }
                        if let Some(err) = arr.iter().find_map(|d| IdentityDiff::from_json(d).err()) {
                            out.warnings
                                .push(format!("rejected update_identity: {err}"));
                            cleaned_lines.push(line);
                            continue;
                        }
                    }
                }
                // Session-targeting fleet actions: resolve the target (Athena
                // may hold the claude_session_id rather than the fleet id —
                // either form resolves), normalize `session_id` to the fleet
                // id, and stamp the session's human label into the params and
                // the rationale — the approval card renders both, so the user
                // sees WHICH session is being typed into / closed instead of
                // a bare UUID.
                if matches!(
                    env.action.as_str(),
                    "fleet_send_input" | "fleet_intervene" | "fleet_kill"
                ) {
                    let raw = env
                        .params
                        .get("session_id")
                        .and_then(|v| v.as_str())
                        .map(str::to_string);
                    if let Some(raw) = raw {
                        let registry = crate::commands::fleet::registry::registry();
                        if let Some(fleet_id) = registry.resolve_session_id(&raw) {
                            let label = registry.try_lookup_label(&fleet_id);
                            if let Some(obj) = env.params.as_object_mut() {
                                if fleet_id != raw {
                                    obj.insert(
                                        "session_id".into(),
                                        serde_json::Value::String(fleet_id.clone()),
                                    );
                                }
                                if let Some(label) = label.as_deref() {
                                    obj.insert(
                                        "session_label".into(),
                                        serde_json::Value::String(label.to_string()),
                                    );
                                }
                            }
                            if let Some(label) = label {
                                if !env.rationale.contains(&label) {
                                    env.rationale = if env.rationale.trim().is_empty() {
                                        format!("Session: {label}")
                                    } else {
                                        format!("{} — session: {label}", env.rationale.trim())
                                    };
                                }
                            }
                        }
                    }
                }
                match insert_approval(pool, session_id, &env) {
                    Ok(created) => out.approvals.push(created),
                    Err(e) => {
                        out.warnings.push(format!("approval insert failed: {e}"));
                        cleaned_lines.push(line);
                    }
                }
            }
            Ok(env) => {
                // The line was op-shaped (matched the OP:/`{"op"` grammar)
                // but names an op we don't handle. It's machine grammar,
                // not prose — drop it from display so the user never sees
                // a raw directive. The warning records it for Athena's
                // next-turn context and for dev logs. (Any prose that
                // preceded a mid-line `OP:` was already pushed separately.)
                out.warnings
                    .push(format!("ignored op `{}` (not in v1)", env.op));
            }
            Err(e) => {
                // Malformed op JSON (e.g. Athena pretty-printed it across
                // lines, or a typo). Still op-shaped — drop it from display
                // rather than leaking raw/broken JSON into the bubble and
                // the persisted episode. The warning carries the parse
                // error for diagnosis.
                out.warnings.push(format!("op parse error: {e}"));
            }
        }
    }

    out.cleaned_text = cleaned_lines.join("\n");

    // Residual machine-grammar safety net. Per-op rejection paths above
    // (connector not pinned, capability not in registry, approval-insert
    // failure, …) push the original `line` back onto `cleaned_lines` so
    // the surrounding prose survives — but that also re-admits the raw
    // `OP:` / `{"op"` directive into the persisted episode, which then
    // renders to the user and pollutes future-turn recall. Strip any
    // line that is still an op directive here, regardless of which
    // branch kept it. Prose virtually never starts with `OP:` or `{"op"`,
    // so this is safe; the frontend `stripModelDirectives` mirrors it as
    // a display-layer backstop.
    if out.cleaned_text.contains("OP:") || out.cleaned_text.contains("{\"op\"") {
        let kept: Vec<&str> = out
            .cleaned_text
            .lines()
            .filter(|l| {
                let t = l.trim_start();
                !(t.starts_with("OP:") || t.starts_with("{\"op\""))
            })
            .collect();
        out.cleaned_text = kept.join("\n");
    }

    // Trim the trailing whitespace introduced by stripped lines.
    while out.cleaned_text.ends_with(['\n', ' ']) {
        out.cleaned_text.pop();
    }
    Ok(out)
}

#[derive(Debug, Deserialize)]
struct OpEnvelope {
    op: String,
    #[serde(default)]
    action: String,
    #[serde(default)]
    params: serde_json::Value,
    #[serde(default)]
    rationale: String,
}

/// Write a System episode recording that this turn's `use_connector`
/// op was rejected at dispatch time. The episode lands in the brain
/// before Athena's next turn assembles its prompt, so she sees it in
/// recall and can self-correct ("my last use_connector got dropped
/// because X — let me acknowledge that to the user or propose an
/// alternative") instead of doubling down on the silent failure.
///
/// Best-effort: if the insert itself fails, we swallow the error so
/// the dispatcher path isn't blocked. A failed insert turns this back
/// into the pre-fix silent-drop, which is no worse than what we had.
/// Validate a `canvas_control` op's params into the exact action JSON the
/// frontend grammar (`canvasActionStore.ts`) accepts. Fail-closed and
/// specific: every error string lands in Athena's next-turn context, so it
/// names what to fix. Only validated fields survive into the output — an
/// invented param never reaches the frontend.
fn validate_canvas_control(
    db: &crate::db::DbPool,
    params: &serde_json::Value,
) -> Result<String, String> {
    let action = params.get("action").ok_or(
        "missing `action` — pass the grammar object, e.g. \
         {\"kind\":\"camera.focus\",\"slug\":\"<canvas slug>\",\"band\":\"close\"}",
    )?;
    let kind = action.get("kind").and_then(|v| v.as_str()).unwrap_or("");
    if kind == "island.read" || kind == "dim.read" {
        return Err(format!(
            "`{kind}` has a faster path: `describe_canvas_project` answers from the \
             published scene without a frontend round-trip. Use that instead."
        ));
    }
    if !CANVAS_CONTROL_KINDS.contains(&kind) {
        return Err(format!(
            "unknown kind `{kind}` (expected one of {CANVAS_CONTROL_KINDS:?})"
        ));
    }
    let mut clean = serde_json::Map::new();
    clean.insert("kind".into(), serde_json::json!(kind));
    if let Some(band) = action.get("band") {
        let b = band.as_str().unwrap_or("");
        if !CANVAS_CONTROL_BANDS.contains(&b) {
            return Err(format!(
                "`band` must be one of {CANVAS_CONTROL_BANDS:?}, got `{b}`"
            ));
        }
        clean.insert("band".into(), band.clone());
    }
    match kind {
        "camera.pan" => {
            for axis in ["dx", "dy"] {
                let v = action
                    .get(axis)
                    .and_then(|v| v.as_f64())
                    .filter(|v| v.is_finite())
                    .ok_or_else(|| format!("`camera.pan` needs a finite numeric `{axis}`"))?;
                clean.insert(axis.into(), serde_json::json!(v));
            }
            if let Some(u) = action.get("unit").and_then(|v| v.as_str()) {
                if u != "world" && u != "screen" {
                    return Err("`unit` must be `world` or `screen`".into());
                }
                clean.insert("unit".into(), serde_json::json!(u));
            }
        }
        "camera.zoom" => {
            let has_band = clean.contains_key("band");
            match action.get("factor").and_then(|v| v.as_f64()) {
                Some(f) if f.is_finite() && f > 0.0 => {
                    clean.insert("factor".into(), serde_json::json!(f));
                }
                Some(_) => return Err("`factor` must be a positive finite number".into()),
                None if has_band => {}
                None => return Err("`camera.zoom` needs `factor` or `band`".into()),
            }
        }
        "camera.focus" | "dim.open" | "category.open" | "island.menu" => {
            let slug = action.get("slug").and_then(|v| v.as_str()).unwrap_or("");
            let resolved = crate::companion::canvas::resolve_scene_slug(db, slug)?;
            clean.insert("slug".into(), serde_json::json!(resolved));
            if kind == "dim.open" {
                let key = action.get("key").and_then(|v| v.as_str()).unwrap_or("");
                if key.is_empty() || key.len() > 40 {
                    return Err(
                        "`dim.open` needs `key` — a dimension key you read from \
                         `describe_canvas_project` (db, monitoring, ci, …)"
                            .into(),
                    );
                }
                clean.insert("key".into(), serde_json::json!(key));
                // `travel` stays at the grammar's default (true): steering the
                // view there is the point of opening the cell for the user.
            }
            if kind == "category.open" {
                let cat = action.get("category").and_then(|v| v.as_str()).unwrap_or("");
                if !CANVAS_CONTROL_CATEGORIES.contains(&cat) {
                    return Err(format!(
                        "`category.open` needs `category` ∈ {CANVAS_CONTROL_CATEGORIES:?}"
                    ));
                }
                clean.insert("category".into(), serde_json::json!(cat));
            }
        }
        "camera.fit" => {
            if let Some(slugs) = action.get("slugs") {
                let arr = slugs
                    .as_array()
                    .ok_or("`slugs` must be an array of canvas slugs")?;
                if arr.is_empty() || arr.len() > 12 {
                    return Err(
                        "`slugs` must carry 1-12 canvas slugs (omit it entirely to \
                         frame the whole portfolio)"
                            .into(),
                    );
                }
                let mut resolved_list = Vec::with_capacity(arr.len());
                for s in arr {
                    let resolved = crate::companion::canvas::resolve_scene_slug(
                        db,
                        s.as_str().unwrap_or(""),
                    )?;
                    resolved_list.push(serde_json::json!(resolved));
                }
                clean.insert("slugs".into(), serde_json::Value::Array(resolved_list));
            }
        }
        // camera.read carries nothing else.
        _ => {}
    }
    Ok(serde_json::Value::Object(clean).to_string())
}

fn note_dispatcher_rejection(
    pool: &UserDbPool,
    session_id: &str,
    connector_name: &str,
    capability: &str,
    reason: &str,
) {
    let body = format!(
        "[dispatcher] Your last `OP: use_connector{{{connector_name}, {capability}}}` was rejected and produced no background job. Reason: {reason}. On your next turn, surface this to the user honestly — either propose pinning/enabling the connector, pivot to a wired alternative, or acknowledge the gap. Do NOT silently re-emit the same op.",
        connector_name = connector_name,
        capability = capability,
        reason = reason,
    );
    if let Err(e) = crate::companion::brain::episodic::append_episode(
        pool,
        session_id,
        crate::companion::brain::episodic::EpisodeRole::System,
        &body,
    ) {
        tracing::warn!(
            connector = connector_name,
            capability = capability,
            error = %e,
            "note_dispatcher_rejection: failed to append system episode (silent-drop pattern returns for this turn only)"
        );
    }
}

// ─────────────────────────────────────────────────────────────────────────
// Read ops: bounded, read-only detail lookups (see `READ_OPS`)
// ─────────────────────────────────────────────────────────────────────────

/// Truncate on a char boundary with an ellipsis. Every read-op renderer
/// runs its final body through the cap so no single lookup can blow up the
/// next turn's context.
fn clip(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    format!(
        "{}\u{2026}",
        crate::utils::text::truncate_on_char_boundary(s, max)
    )
}

/// Collapse to one short line (first non-empty line, truncated).
fn one_line(s: &str, max: usize) -> String {
    let first = s
        .split(['\n', '\r'])
        .map(str::trim)
        .find(|t| !t.is_empty())
        .unwrap_or("");
    clip(first, max)
}

/// Append the result of a read op as a System episode, so Athena reads it
/// at the top of her next turn. Same channel and same best-effort posture
/// as `note_dispatcher_rejection`: a failed insert degrades to "the op did
/// nothing", never to a broken turn.
fn note_read_op_result(
    pool: &UserDbPool,
    session_id: &str,
    action: &str,
    query: &str,
    body: &str,
) {
    let target = if query.is_empty() {
        String::new()
    } else {
        format!(" for `{query}`")
    };
    let content = format!(
        "[lookup] Result of your `{action}`{target}:\n\n{body}\n\nUse these \
         exact values. If the answer says nothing was found, say so to the \
         user instead of guessing an id.",
        action = action,
        target = target,
        body = clip(body, READ_OP_DETAIL_CHARS),
    );
    if let Err(e) = crate::companion::brain::episodic::append_episode(
        pool,
        session_id,
        crate::companion::brain::episodic::EpisodeRole::System,
        &content,
    ) {
        tracing::warn!(
            action = action,
            error = %e,
            "note_read_op_result: failed to append system episode"
        );
    }
}

/// Full detail for one persona, resolved by exact id, then exact
/// (case-insensitive) name, then a substring match on name.
fn describe_persona(sys_db: &crate::db::DbPool, query: &str) -> String {
    let Ok(conn) = sys_db.get() else {
        return "database unavailable".to_string();
    };
    let like = format!("%{query}%");
    let row = conn.query_row(
        "SELECT p.id, p.name, COALESCE(p.description, ''), COALESCE(p.system_prompt, ''),
                COALESCE(p.model_profile, ''), p.enabled, COALESCE(t.name, '')
         FROM personas p
         LEFT JOIN persona_teams t ON t.id = p.home_team_id
         WHERE p.id = ?1 COLLATE NOCASE
            OR p.name = ?1 COLLATE NOCASE
            OR p.name LIKE ?2 COLLATE NOCASE
         ORDER BY CASE WHEN p.id = ?1 THEN 0 WHEN p.name = ?1 COLLATE NOCASE THEN 1 ELSE 2 END,
                  p.enabled DESC, p.updated_at DESC
         LIMIT 1",
        params![query, like],
        |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, i64>(5)? != 0,
                r.get::<_, String>(6)?,
            ))
        },
    );
    let Ok((id, name, description, system_prompt, model_profile, enabled, team)) = row else {
        return not_found(
            &conn,
            "agent",
            query,
            "SELECT name FROM personas ORDER BY enabled DESC, updated_at DESC LIMIT ?1",
        );
    };
    let model = serde_json::from_str::<serde_json::Value>(&model_profile)
        .ok()
        .and_then(|v| {
            v.get("model")
                .and_then(|m| m.as_str())
                .map(str::to_string)
        })
        .unwrap_or_else(|| "default".to_string());
    format!(
        "**{name}**\n- persona_id: `{id}`  (use this verbatim)\n- enabled: {enabled}\n\
         - model: {model}\n- home team: {team}\n- description: {description}\n\
         - system prompt (excerpt): {prompt}",
        name = name,
        id = id,
        enabled = enabled,
        model = model,
        team = if team.is_empty() { "none" } else { &team },
        description = one_line(&description, 200),
        prompt = clip(system_prompt.trim(), 500),
    )
}

/// Full detail for one dev context, resolved the same way as a persona.
fn describe_context(sys_db: &crate::db::DbPool, query: &str) -> String {
    let Ok(conn) = sys_db.get() else {
        return "database unavailable".to_string();
    };
    let like = format!("%{query}%");
    let row = conn.query_row(
        "SELECT c.id, c.name, COALESCE(c.description, ''), COALESCE(c.file_paths, '[]'),
                COALESCE(c.keywords, ''), COALESCE(g.name, ''), COALESCE(p.name, '')
         FROM dev_contexts c
         LEFT JOIN dev_context_groups g ON g.id = c.group_id
         LEFT JOIN dev_projects p ON p.id = c.project_id
         WHERE c.id = ?1 COLLATE NOCASE
            OR c.name = ?1 COLLATE NOCASE
            OR c.name LIKE ?2 COLLATE NOCASE
         ORDER BY CASE WHEN c.id = ?1 THEN 0 WHEN c.name = ?1 COLLATE NOCASE THEN 1 ELSE 2 END,
                  c.pinned DESC, c.updated_at DESC
         LIMIT 1",
        params![query, like],
        |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, String>(5)?,
                r.get::<_, String>(6)?,
            ))
        },
    );
    let Ok((id, name, description, file_paths, keywords, group, project)) = row else {
        return not_found(
            &conn,
            "dev context",
            query,
            "SELECT name FROM dev_contexts ORDER BY pinned DESC, updated_at DESC LIMIT ?1",
        );
    };
    let files: Vec<String> = serde_json::from_str::<Vec<String>>(&file_paths).unwrap_or_default();
    let file_count = files.len();
    let sample = files
        .iter()
        .take(8)
        .map(String::as_str)
        .collect::<Vec<_>>()
        .join(", ");
    format!(
        "**{name}**\n- context_id: `{id}`\n- project: {project}\n- group: {group}\n\
         - description: {description}\n- files: {file_count} ({sample})\n- keywords: {keywords}",
        name = name,
        id = id,
        project = if project.is_empty() { "unknown" } else { &project },
        group = if group.is_empty() { "ungrouped" } else { &group },
        description = one_line(&description, 260),
        file_count = file_count,
        sample = clip(&sample, 400),
        keywords = one_line(&keywords, 160),
    )
}

/// Full when-to-use for one installed skill. Disk-only, so this is the one
/// read op that still answers without the system DB (it just loses the
/// per-project skill directories).
fn describe_skill(sys_db: Option<&crate::db::DbPool>, query: &str) -> String {
    let entries = match sys_db {
        Some(db) => crate::companion::prompt::scan_skill_index(db),
        None => Vec::new(),
    };
    let needle = query.to_lowercase();
    let hit = entries
        .iter()
        .find(|e| e.name.to_lowercase() == needle)
        .or_else(|| entries.iter().find(|e| e.name.to_lowercase().contains(&needle)));
    let Some(hit) = hit else {
        let names: Vec<&str> = entries
            .iter()
            .take(READ_OP_SUGGESTIONS)
            .map(|e| e.name.as_str())
            .collect();
        return format!(
            "No installed skill matches `{query}`. Installed skills include: {}. \
             Do not invent a skill name.",
            if names.is_empty() {
                "none found on disk".to_string()
            } else {
                names.join(", ")
            }
        );
    };
    let content = std::fs::read_to_string(&hit.path).unwrap_or_default();
    format!(
        "**{name}** ({scope})\n- invoke as: `/{name}`\n- description: {desc}\n\n{body}",
        name = hit.name,
        scope = hit.scope,
        desc = one_line(&hit.description, 240),
        body = clip(content.trim(), 900),
    )
}

/// The team roster: `assign_team` needs a `team_id`, and teams were
/// deliberately left out of the always-on prompt index, so this op is the
/// only path to one. An empty query lists everything (bounded); a
/// non-empty one filters by name substring.
/// `list_runner_tasks` — what is already on the Dev Runner queue.
///
/// The runner is the OTHER execution lane. Athena could dispatch Fleet
/// sessions all day while a task for the same work sat queued on the Run Desk,
/// because she had no way to see it. `query` optionally filters by project
/// name/id substring. Read-only, bounded, and it names the empty case rather
/// than returning a blank body a model would read as an error.
fn list_runner_tasks(sys_db: &crate::db::DbPool, query: &str) -> String {
    let tasks = match crate::db::repos::dev_tools::list_tasks(sys_db, None, None) {
        Ok(t) => t,
        Err(e) => return format!("Run Desk unavailable: {e}"),
    };
    // Only the live half of the queue is decision-relevant — a completed task
    // is history, and history is what the ledger is for.
    let want = query.to_ascii_lowercase();
    let live: Vec<_> = tasks
        .iter()
        .filter(|t| matches!(t.status.as_str(), "queued" | "running"))
        .filter(|t| {
            want.is_empty()
                || t.title.to_ascii_lowercase().contains(&want)
                || t.project_id
                    .as_deref()
                    .is_some_and(|p| p.to_ascii_lowercase().contains(&want))
        })
        .take(20)
        .collect();
    if live.is_empty() {
        return "Dev Runner queue: nothing queued or running.".to_string();
    }
    let mut out = format!("Dev Runner queue — {} live task(s):\n", live.len());
    for t in live {
        out.push_str(&format!(
            "- [{}] {} ({}%{})\n",
            t.status,
            t.title,
            t.progress_pct,
            t.project_id
                .as_deref()
                .map(|p| format!(", project {}", &p[..p.len().min(8)]))
                .unwrap_or_default(),
        ));
    }
    out
}

fn list_teams(sys_db: &crate::db::DbPool, query: &str) -> String {
    let Ok(conn) = sys_db.get() else {
        return "database unavailable".to_string();
    };
    let like = if query.is_empty() {
        "%".to_string()
    } else {
        format!("%{query}%")
    };
    let Ok(mut stmt) = conn.prepare(
        "SELECT t.id, t.name, COALESCE(t.description, ''), t.enabled,
                (SELECT COUNT(*) FROM persona_team_members m WHERE m.team_id = t.id)
         FROM persona_teams t
         WHERE t.name LIKE ?1 COLLATE NOCASE
         ORDER BY t.enabled DESC, t.updated_at DESC",
    ) else {
        return "team lookup failed".to_string();
    };
    let Ok(rows) = stmt.query_map(params![like], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, i64>(3)? != 0,
            r.get::<_, i64>(4)?,
        ))
    }) else {
        return "team lookup failed".to_string();
    };
    let all: Vec<_> = rows.flatten().collect();
    if all.is_empty() {
        return if query.is_empty() {
            "No teams exist yet. `assign_team` has no valid target; suggest \
             creating a team first."
                .to_string()
        } else {
            format!("No team matches `{query}`. Re-run `list_teams` with no query to see them all.")
        };
    }
    let total = all.len();
    // Bounded twice over: a row cap AND a character cap. The row cap alone
    // is not enough — 25 teams with long names and descriptions still blow
    // the detail budget, and a body clipped after the fact would lose the
    // "N of M" line that keeps the answer honest.
    let mut body = String::new();
    let mut shown = 0usize;
    for (id, name, description, enabled, members) in all.iter().take(LIST_TEAMS_MAX_ROWS) {
        let row = format!(
            "- **{name}** `{id}` · {members} members{off} · {desc}\n",
            name = name.trim(),
            id = id,
            members = members,
            off = if *enabled { "" } else { " · DISABLED" },
            desc = one_line(description, 70),
        );
        if body.len() + row.len() + LIST_TEAMS_FOOTER_RESERVE > READ_OP_DETAIL_CHARS {
            break;
        }
        body.push_str(&row);
        shown += 1;
    }
    format!(
        "{body}\n_{shown} of {total} teams. The `id` is the `team_id` \
         `assign_team` expects; re-run `list_teams` with a name filter to \
         narrow it._",
        body = body,
        shown = shown,
        total = total,
    )
}

/// Shared miss path: say plainly that nothing matched, then offer a few
/// real names so the next attempt is grounded instead of invented.
///
/// Takes the caller's live `Connection` rather than the pool on purpose:
/// the miss path runs while the caller still holds its connection, and
/// asking a size-1 pool for a second one just stalls until the checkout
/// timeout and then silently produces no suggestions at all.
fn not_found(
    conn: &rusqlite::Connection,
    kind: &str,
    query: &str,
    suggest_sql: &str,
) -> String {
    let names: Vec<String> = (|| {
        let mut stmt = conn.prepare(suggest_sql).ok()?;
        let rows = stmt
            .query_map(params![READ_OP_SUGGESTIONS as i64], |r| {
                r.get::<_, String>(0)
            })
            .ok()?;
        Some(rows.flatten().collect::<Vec<String>>())
    })()
    .unwrap_or_default();
    if names.is_empty() {
        format!("No {kind} matches `{query}`, and none exist yet.")
    } else {
        format!(
            "No {kind} matches `{query}`. Existing ones include: {}. Ask the \
             user which they meant; do not invent an id.",
            names.join(", ")
        )
    }
}

/// Bounded repair for op-shaped lines that fail JSON parsing: append the
/// missing closing braces when (a) the line doesn't end inside a string
/// literal and (b) the brace deficit is 1..=3. Returns `None` for anything
/// else — a truncated string value, balanced-but-invalid JSON, or a large
/// deficit are not safely completable and keep their original parse error.
fn repair_op_json(raw: &str) -> Option<String> {
    let mut depth: i32 = 0;
    let mut in_str = false;
    let mut esc = false;
    for c in raw.chars() {
        if esc {
            esc = false;
            continue;
        }
        match c {
            '\\' if in_str => esc = true,
            '"' => in_str = !in_str,
            '{' if !in_str => depth += 1,
            '}' if !in_str => depth -= 1,
            _ => {}
        }
    }
    if in_str || !(1..=3).contains(&depth) {
        return None;
    }
    let mut fixed = raw.to_string();
    for _ in 0..depth {
        fixed.push('}');
    }
    Some(fixed)
}

fn insert_approval(
    pool: &UserDbPool,
    session_id: &str,
    env: &OpEnvelope,
) -> Result<CreatedApproval, AppError> {
    let id = format!("appr_{}", crate::companion::util::short_id(12));
    let params_json = env.params.to_string();
    let payload = serde_json::json!({
        "action": env.action,
        "params": env.params,
        "rationale": env.rationale,
    })
    .to_string();
    // For resolve_human_review, surface the review_id at the top level
    // for cross-link queries (Overview panel can find approvals attached
    // to a specific review without parsing the payload JSON).
    let human_review_id: Option<String> = if env.action == "resolve_human_review" {
        env.params
            .get("review_id")
            .and_then(|v| v.as_str())
            .map(String::from)
    } else {
        None
    };

    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO companion_approval (id, session_id, kind, payload, status, human_review_id, created_at)
         VALUES (?1, ?2, 'op_execute', ?3, 'pending', ?4, datetime('now'))",
        params![id, session_id, payload, human_review_id],
    )?;

    Ok(CreatedApproval {
        id,
        action: env.action.clone(),
        params_json,
        rationale: env.rationale.clone(),
    })
}

// ─────────────────────────────────────────────────────────────────────────
// Tests
//
// Coverage focuses on the new chat-card op variants added by /friend
// 2026-05-16 session 2: show_persona_walkthrough, show_template_suggestions,
// show_use_case_set, show_trigger_set, show_model_tier_choice,
// show_observability_plan, show_decision_log, show_persona_ready,
// show_design_capabilities, show_recent_decisions. All are auto-fire
// chat-card emitters that push to `out.chat_cards` on valid input and to
// `out.warnings` on bad input — no DB writes for any of them except
// show_decision_log (which best-effort persists to companion_design_decision).
//
// Tests build a small in-memory UserDbPool with the COMPANION_SCHEMA
// applied so the show_decision_log persist path doesn't fail; the rest
// of the dispatch surface doesn't touch the pool.
// ─────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::UserDbPool;
    use r2d2::Pool;
    use r2d2_sqlite::SqliteConnectionManager;

    /// Build an in-memory user db pool with the companion schema applied.
    /// Uses a file::memory: URI with shared cache so all pool connections
    /// see the same tables (per the pattern in db/repos/resources/
    /// db_schema.rs's in-memory comment).
    fn test_pool() -> UserDbPool {
        let manager = SqliteConnectionManager::file(
            "file::memory:?cache=shared",
        )
        .with_flags(
            rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE
                | rusqlite::OpenFlags::SQLITE_OPEN_CREATE
                | rusqlite::OpenFlags::SQLITE_OPEN_URI,
        );
        let pool = Pool::builder()
            .max_size(2)
            .build(manager)
            .expect("build in-memory pool");
        // Minimal schema — just the tables the dispatcher arms exercise.
        let conn = pool.get().expect("get conn");
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS companion_approval (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                kind TEXT NOT NULL,
                payload TEXT NOT NULL,
                status TEXT NOT NULL,
                human_review_id TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS companion_design_decision (
                id                  TEXT PRIMARY KEY,
                session_id          TEXT NOT NULL,
                persona_context     TEXT,
                label               TEXT NOT NULL,
                choice              TEXT NOT NULL,
                rationale           TEXT NOT NULL,
                decision_timestamp  TEXT,
                created_at          TEXT NOT NULL DEFAULT (datetime('now'))
            );",
        )
        .expect("apply schema");
        pool
    }

    fn dispatch_op(op_json: &str) -> Dispatched {
        let pool = test_pool();
        let text = format!("Some prose.\nOP: {op_json}\nMore prose.");
        dispatch(&pool, "default", &text).expect("dispatch ok")
    }

    // ── PROGRESS beats (Variant B) ──────────────────────────────────────

    #[test]
    fn progress_lines_are_stripped_from_cleaned_text() {
        let pool = test_pool();
        let text = "PROGRESS: Pulling up your recent runs…\n\
                    Here are your three failing personas.\n\
                    PROGRESS: Checking the logs…";
        let out = dispatch(&pool, "default", text).expect("dispatch ok");
        assert!(
            !out.cleaned_text.contains("PROGRESS:"),
            "PROGRESS beats must not survive into the persisted reply: {:?}",
            out.cleaned_text
        );
        assert!(
            out.cleaned_text.contains("three failing personas"),
            "real prose must survive the strip: {:?}",
            out.cleaned_text
        );
        // Beats are now CAPTURED (persisted by session.rs as aside messages),
        // not merely discarded — in emission order.
        assert_eq!(
            out.progress_beats,
            vec![
                "Pulling up your recent runs…".to_string(),
                "Checking the logs…".to_string()
            ],
            "PROGRESS beats must be captured in order"
        );
    }

    // ── show_fleet_plan ─────────────────────────────────────────────────

    /// The plan card's Confirm button starts real `--dangerously-skip-permissions`
    /// terminals, and the ONLY thing standing between a proposed `cwd` and that
    /// is the registered-dev-project check — which needs the system DB. When the
    /// registry is unreachable the arm must fail CLOSED: no card, a warning
    /// Athena reads next turn. `dispatch_op` builds a user pool only, so this is
    /// exactly that path.
    #[test]
    fn show_fleet_plan_fails_closed_without_the_project_registry() {
        let op = r###"{"op":"propose_action","action":"show_fleet_plan","params":{"operation_intent":"do work","rows":[{"cwd":"C:/anywhere","objective":"go"}]}}"###;
        let out = dispatch_op(op);
        assert!(out.chat_cards.is_empty(), "no card without containment proof");
        assert!(out
            .warnings
            .iter()
            .any(|w| w.contains("show_fleet_plan") || w.contains("project registry")));
    }

    // ── show_ship_milestone ─────────────────────────────────────────────

    /// Same doctrine as the plan card: the ONLY thing separating a proposed
    /// `item_id` from a `dev_milestone_items` row full of invented members is
    /// the registry lookup, which needs the system DB. `dispatch_op` builds a
    /// user pool only, so this is exactly the unreachable-registry path.
    #[test]
    fn show_ship_milestone_fails_closed_without_the_project_registry() {
        let op = r###"{"op":"propose_action","action":"show_ship_milestone","params":{"project_slug":"personas","name":"M1","goal":"cut it","rows":[{"item_kind":"use_case","item_id":"uc_1"}]}}"###;
        let out = dispatch_op(op);
        assert!(
            out.chat_cards.is_empty(),
            "no card without a way to prove the ids are real"
        );
        assert!(out
            .warnings
            .iter()
            .any(|w| w.contains("show_ship_milestone") || w.contains("project registry")));
    }

    /// A card op sits OUTSIDE both lists by design: no executor arm, no
    /// auto-fired read. The invariant test below asserts the two lists never
    /// overlap; this asserts the new op joined neither.
    #[test]
    fn show_ship_milestone_is_a_card_op_not_an_action_or_a_read_op() {
        assert!(!ALLOWED_ACTIONS.contains(&"show_ship_milestone"));
        assert!(!READ_OPS.contains(&"show_ship_milestone"));
    }

    // ── show_persona_walkthrough ────────────────────────────────────────

    #[test]
    fn show_persona_walkthrough_emits_chat_card() {
        let op = r###"{"op":"propose_action","action":"show_persona_walkthrough","params":{"intent":"triage tickets","content":"## Plan\n\nbody"}}"###;
        let out = dispatch_op(op);
        assert_eq!(out.chat_cards.len(), 1);
        assert_eq!(out.chat_cards[0].kind, "persona_walkthrough");
        assert!(out.warnings.is_empty());
    }

    #[test]
    fn show_persona_walkthrough_rejects_empty_content() {
        let op = r###"{"op":"propose_action","action":"show_persona_walkthrough","params":{"intent":"x","content":""}}"###;
        let out = dispatch_op(op);
        assert!(out.chat_cards.is_empty());
        assert!(out.warnings.iter().any(|w| w.contains("content")));
    }

    // ── show_template_suggestions ───────────────────────────────────────

    #[test]
    fn show_template_suggestions_emits_chat_card() {
        let op = r###"{"op":"propose_action","action":"show_template_suggestions","params":{"intent":"triage support tickets","limit":3}}"###;
        let out = dispatch_op(op);
        assert_eq!(out.chat_cards.len(), 1);
        assert_eq!(out.chat_cards[0].kind, "template_suggestions");
        assert!(out.warnings.is_empty());
    }

    #[test]
    fn show_template_suggestions_rejects_empty_intent() {
        let op = r###"{"op":"propose_action","action":"show_template_suggestions","params":{"intent":""}}"###;
        let out = dispatch_op(op);
        assert!(out.chat_cards.is_empty());
        assert!(out.warnings.iter().any(|w| w.contains("intent")));
    }

    #[test]
    fn show_template_suggestions_clamps_limit_into_1_to_5() {
        let op = r###"{"op":"propose_action","action":"show_template_suggestions","params":{"intent":"x","limit":99}}"###;
        let out = dispatch_op(op);
        assert_eq!(out.chat_cards.len(), 1);
        let limit = out.chat_cards[0]
            .config
            .get("limit")
            .and_then(|v| v.as_u64())
            .expect("limit field");
        assert!((1..=5).contains(&limit), "limit clamped to 1..=5, got {limit}");
    }

    // ── show_browser_test_report ────────────────────────────────────────

    #[test]
    fn show_browser_test_report_emits_chat_card() {
        let op = r###"{"op":"propose_action","action":"show_browser_test_report","params":{"url":"http://localhost:8765","steps":[{"label":"Add todo","result":"pass","evidence":"item in #list"},{"label":"Clear completed","result":"fail","evidence":"item remains"}],"defects":[{"title":"Clear broken","severity":"high","detail":"ReferenceError","fix":"define completedItems"}],"console_errors":["ReferenceError: completedItems is not defined"],"security_notes":["prompt injection found in page"]}}"###;
        let out = dispatch_op(op);
        assert_eq!(out.chat_cards.len(), 1);
        assert_eq!(out.chat_cards[0].kind, "browser_test_report");
        let cfg = &out.chat_cards[0].config;
        assert_eq!(cfg["steps"].as_array().unwrap().len(), 2);
        assert_eq!(cfg["defects"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn show_browser_test_report_rejects_bad_result() {
        let op = r###"{"op":"propose_action","action":"show_browser_test_report","params":{"url":"x","steps":[{"label":"a","result":"maybe"}]}}"###;
        let out = dispatch_op(op);
        assert!(out.chat_cards.is_empty());
        assert!(out.warnings.iter().any(|w| w.contains("pass|fail|warn")));
    }

    #[test]
    fn show_browser_test_report_rejects_empty_steps() {
        let op = r###"{"op":"propose_action","action":"show_browser_test_report","params":{"url":"x","steps":[]}}"###;
        let out = dispatch_op(op);
        assert!(out.chat_cards.is_empty());
        assert!(out.warnings.iter().any(|w| w.contains("steps")));
    }

    // ── show_use_case_set ───────────────────────────────────────────────

    #[test]
    fn show_use_case_set_emits_chat_card() {
        let op = r###"{"op":"propose_action","action":"show_use_case_set","params":{"intent":"x","use_cases":[{"label":"Golden","role":"golden","description":"d"},{"label":"Variant","role":"variant","description":"d"},{"label":"Outscope","role":"out_of_scope","description":"d"}]}}"###;
        let out = dispatch_op(op);
        assert_eq!(out.chat_cards.len(), 1);
        assert_eq!(out.chat_cards[0].kind, "use_case_set");
    }

    #[test]
    fn show_use_case_set_rejects_empty_array() {
        let op = r###"{"op":"propose_action","action":"show_use_case_set","params":{"use_cases":[]}}"###;
        let out = dispatch_op(op);
        assert!(out.chat_cards.is_empty());
        assert!(out.warnings.iter().any(|w| w.contains("use_cases")));
    }

    #[test]
    fn show_use_case_set_rejects_invalid_role() {
        let op = r###"{"op":"propose_action","action":"show_use_case_set","params":{"use_cases":[{"label":"X","role":"surprise","description":"d"}]}}"###;
        let out = dispatch_op(op);
        assert!(out.chat_cards.is_empty());
        assert!(out.warnings.iter().any(|w| w.contains("role")));
    }

    #[test]
    fn show_use_case_set_rejects_oversize_array() {
        let mut entries = Vec::new();
        for i in 0..9 {
            entries.push(format!(
                r###"{{"label":"L{i}","role":"variant","description":"d"}}"###
            ));
        }
        let op = format!(
            r###"{{"op":"propose_action","action":"show_use_case_set","params":{{"use_cases":[{}]}}}}"###,
            entries.join(",")
        );
        let out = dispatch_op(&op);
        assert!(out.chat_cards.is_empty());
        assert!(out.warnings.iter().any(|w| w.contains("too many")));
    }

    // ── show_trigger_set ────────────────────────────────────────────────

    #[test]
    fn show_trigger_set_emits_chat_card() {
        let op = r###"{"op":"propose_action","action":"show_trigger_set","params":{"intent":"x","triggers":[{"label":"L","source":"S","condition":"C"}]}}"###;
        let out = dispatch_op(op);
        assert_eq!(out.chat_cards.len(), 1);
        assert_eq!(out.chat_cards[0].kind, "trigger_set");
    }

    #[test]
    fn show_trigger_set_rejects_missing_field() {
        let op = r###"{"op":"propose_action","action":"show_trigger_set","params":{"triggers":[{"label":"L","source":"","condition":"C"}]}}"###;
        let out = dispatch_op(op);
        assert!(out.chat_cards.is_empty());
        assert!(out.warnings.iter().any(|w| w.contains("source")));
    }

    // ── show_model_tier_choice ──────────────────────────────────────────

    #[test]
    fn show_model_tier_choice_emits_chat_card() {
        let op = r###"{"op":"propose_action","action":"show_model_tier_choice","params":{"recommended":"sonnet","tiers":[{"tier":"haiku","rationale":"a"},{"tier":"sonnet","rationale":"b"},{"tier":"opus","rationale":"c"}]}}"###;
        let out = dispatch_op(op);
        assert_eq!(out.chat_cards.len(), 1);
        assert_eq!(out.chat_cards[0].kind, "model_tier_choice");
    }

    #[test]
    fn show_model_tier_choice_rejects_unknown_recommended() {
        let op = r###"{"op":"propose_action","action":"show_model_tier_choice","params":{"recommended":"galactus","tiers":[{"tier":"sonnet","rationale":"x"}]}}"###;
        let out = dispatch_op(op);
        assert!(out.chat_cards.is_empty());
        assert!(out.warnings.iter().any(|w| w.contains("recommended")));
    }

    #[test]
    fn show_model_tier_choice_rejects_bad_tier_slug() {
        let op = r###"{"op":"propose_action","action":"show_model_tier_choice","params":{"recommended":"sonnet","tiers":[{"tier":"haiku","rationale":"a"},{"tier":"jellyfish","rationale":"b"}]}}"###;
        let out = dispatch_op(op);
        assert!(out.chat_cards.is_empty());
        assert!(out.warnings.iter().any(|w| w.contains("invalid tier")));
    }

    // ── show_observability_plan ─────────────────────────────────────────

    #[test]
    fn show_observability_plan_emits_chat_card() {
        let op = r###"{"op":"propose_action","action":"show_observability_plan","params":{"error_handling":{"triggers":["tool timeout"],"escalation":"manual_reviews"},"success_metric":{"kind":"count_by_status","description":"weekly rollup"}}}"###;
        let out = dispatch_op(op);
        assert_eq!(out.chat_cards.len(), 1);
        assert_eq!(out.chat_cards[0].kind, "observability_plan");
    }

    #[test]
    fn show_observability_plan_rejects_missing_error_handling() {
        let op = r###"{"op":"propose_action","action":"show_observability_plan","params":{"success_metric":{"kind":"latency","description":"x"}}}"###;
        let out = dispatch_op(op);
        assert!(out.chat_cards.is_empty());
        assert!(out.warnings.iter().any(|w| w.contains("error_handling")));
    }

    #[test]
    fn show_observability_plan_rejects_unknown_metric_kind() {
        let op = r###"{"op":"propose_action","action":"show_observability_plan","params":{"error_handling":{"triggers":["a"],"escalation":"e"},"success_metric":{"kind":"vibes","description":"x"}}}"###;
        let out = dispatch_op(op);
        assert!(out.chat_cards.is_empty());
        assert!(out.warnings.iter().any(|w| w.contains("kind")));
    }

    // ── show_decision_log ───────────────────────────────────────────────

    #[test]
    fn show_decision_log_emits_chat_card_and_persists() {
        let pool = test_pool();
        let op = r###"{"op":"propose_action","action":"show_decision_log","params":{"intent":"persona_abc","decisions":[{"label":"Model tier","choice":"Sonnet","rationale":"right balance"},{"label":"Triggers","choice":"Slack only","rationale":"scope"}]}}"###;
        let text = format!("Some prose.\nOP: {op}");
        let out = dispatch(&pool, "default", &text).expect("dispatch ok");
        assert_eq!(out.chat_cards.len(), 1);
        assert_eq!(out.chat_cards[0].kind, "decision_log");

        // Verify rows landed in companion_design_decision.
        let conn = pool.get().expect("get conn");
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM companion_design_decision WHERE persona_context = 'persona_abc'",
                [],
                |r| r.get(0),
            )
            .expect("count");
        assert_eq!(count, 2);
    }

    #[test]
    fn show_decision_log_rejects_missing_rationale() {
        let op = r###"{"op":"propose_action","action":"show_decision_log","params":{"decisions":[{"label":"X","choice":"Y","rationale":""}]}}"###;
        let out = dispatch_op(op);
        assert!(out.chat_cards.is_empty());
        assert!(out.warnings.iter().any(|w| w.contains("rationale")));
    }

    // ── show_persona_ready ──────────────────────────────────────────────

    #[test]
    fn show_persona_ready_emits_chat_card() {
        let op = r###"{"op":"propose_action","action":"show_persona_ready","params":{"recommended_action":"interactive","summary":{"intent_line":"Triage tickets","model_tier":"sonnet"}}}"###;
        let out = dispatch_op(op);
        assert_eq!(out.chat_cards.len(), 1);
        assert_eq!(out.chat_cards[0].kind, "persona_ready");
    }

    #[test]
    fn show_persona_ready_rejects_missing_intent_line() {
        let op = r###"{"op":"propose_action","action":"show_persona_ready","params":{"recommended_action":"interactive","summary":{}}}"###;
        let out = dispatch_op(op);
        assert!(out.chat_cards.is_empty());
        assert!(out.warnings.iter().any(|w| w.contains("intent_line")));
    }

    #[test]
    fn show_persona_ready_rejects_unknown_recommended_action() {
        let op = r###"{"op":"propose_action","action":"show_persona_ready","params":{"recommended_action":"explode","summary":{"intent_line":"x"}}}"###;
        let out = dispatch_op(op);
        assert!(out.chat_cards.is_empty());
        assert!(out.warnings.iter().any(|w| w.contains("recommended_action")));
    }

    // ── show_design_capabilities ────────────────────────────────────────

    #[test]
    fn show_design_capabilities_emits_chat_card() {
        let op = r###"{"op":"propose_action","action":"show_design_capabilities","params":{"intro":"Here's the menu."}}"###;
        let out = dispatch_op(op);
        assert_eq!(out.chat_cards.len(), 1);
        assert_eq!(out.chat_cards[0].kind, "design_capabilities");
    }

    #[test]
    fn show_design_capabilities_tolerates_empty_intro() {
        let op = r###"{"op":"propose_action","action":"show_design_capabilities","params":{}}"###;
        let out = dispatch_op(op);
        assert_eq!(out.chat_cards.len(), 1);
    }

    // ── show_recent_decisions ───────────────────────────────────────────

    #[test]
    fn show_recent_decisions_emits_chat_card() {
        let op = r###"{"op":"propose_action","action":"show_recent_decisions","params":{"persona_context":"persona_abc","limit":3}}"###;
        let out = dispatch_op(op);
        assert_eq!(out.chat_cards.len(), 1);
        assert_eq!(out.chat_cards[0].kind, "recent_decisions");
    }

    #[test]
    fn show_recent_decisions_rejects_missing_context() {
        let op = r###"{"op":"propose_action","action":"show_recent_decisions","params":{}}"###;
        let out = dispatch_op(op);
        assert!(out.chat_cards.is_empty());
        assert!(out.warnings.iter().any(|w| w.contains("persona_context")));
    }

    #[test]
    fn show_recent_decisions_clamps_limit() {
        let op = r###"{"op":"propose_action","action":"show_recent_decisions","params":{"persona_context":"x","limit":42}}"###;
        let out = dispatch_op(op);
        assert_eq!(out.chat_cards.len(), 1);
        let limit = out.chat_cards[0]
            .config
            .get("limit")
            .and_then(|v| v.as_u64())
            .expect("limit field");
        assert!((1..=5).contains(&limit));
    }

    // ── show_persona_creation_offer / start_guided_walkthrough ──────────

    #[test]
    fn persona_creation_offer_emits_chat_card() {
        let op = r###"{"op":"propose_action","action":"show_persona_creation_offer","params":{"intent":"a Slack triager"},"rationale":"user described a persona"}"###;
        let out = dispatch_op(op);
        assert_eq!(out.chat_cards.len(), 1);
        assert_eq!(out.chat_cards[0].kind, "persona_creation_offer");
        assert_eq!(
            out.chat_cards[0].config.get("intent").and_then(|v| v.as_str()),
            Some("a Slack triager"),
        );
        // OP line stripped from the displayed reply.
        assert!(!out.cleaned_text.contains("show_persona_creation_offer"));
    }

    #[test]
    fn persona_creation_offer_rejects_missing_intent() {
        let op = r###"{"op":"propose_action","action":"show_persona_creation_offer","params":{}}"###;
        let out = dispatch_op(op);
        assert!(out.chat_cards.is_empty());
        assert!(!out.warnings.is_empty());
    }

    #[test]
    fn start_guided_walkthrough_collects_valid_topic() {
        let op = r###"{"op":"propose_action","action":"start_guided_walkthrough","params":{"topic":"persona_creation"},"rationale":"show me how"}"###;
        let out = dispatch_op(op);
        assert_eq!(out.guide_walkthroughs, vec!["persona_creation".to_string()]);
        assert!(!out.cleaned_text.contains("start_guided_walkthrough"));
    }

    #[test]
    fn start_guided_walkthrough_accepts_e2_topics() {
        // The four E2 coverage topics must be allow-listed (mirrors the frontend
        // registry); a regression that drops one would silently reject the tour.
        for topic in [
            "trigger_creation",
            "template_adoption",
            "incident_triage",
            "goal_kpi_setup",
        ] {
            let op = format!(
                r###"{{"op":"propose_action","action":"start_guided_walkthrough","params":{{"topic":"{topic}"}},"rationale":"show me"}}"###
            );
            let out = dispatch_op(&op);
            assert_eq!(out.guide_walkthroughs, vec![topic.to_string()], "topic {topic} should be accepted");
            assert!(out.warnings.is_empty(), "topic {topic} should not warn");
        }
    }

    #[test]
    fn start_guided_walkthrough_rejects_unknown_topic() {
        let op = r###"{"op":"propose_action","action":"start_guided_walkthrough","params":{"topic":"nuke_everything"}}"###;
        let out = dispatch_op(op);
        assert!(out.guide_walkthroughs.is_empty());
        assert!(!out.warnings.is_empty());
    }

    #[test]
    fn start_guided_walkthrough_rejects_missing_topic() {
        let op = r###"{"op":"propose_action","action":"start_guided_walkthrough","params":{}}"###;
        let out = dispatch_op(op);
        assert!(out.guide_walkthroughs.is_empty());
        assert!(!out.warnings.is_empty());
    }

    #[test]
    fn point_at_collects_valid_anchor() {
        let op = r###"{"op":"propose_action","action":"point_at","params":{"anchor":"nav_agents","narration":"Your agents live right here."},"rationale":"show where"}"###;
        let out = dispatch_op(op);
        assert_eq!(out.point_ats.len(), 1);
        assert_eq!(out.point_ats[0].anchor, "nav_agents");
        assert_eq!(out.point_ats[0].narration, "Your agents live right here.");
        assert!(!out.cleaned_text.contains("point_at"));
    }

    #[test]
    fn point_at_rejects_unknown_anchor() {
        let op = r###"{"op":"propose_action","action":"point_at","params":{"anchor":"window.localStorage","narration":"hi"}}"###;
        let out = dispatch_op(op);
        assert!(out.point_ats.is_empty());
        assert!(!out.warnings.is_empty());
    }

    #[test]
    fn point_at_rejects_missing_fields() {
        let op = r###"{"op":"propose_action","action":"point_at","params":{"anchor":"vault"}}"###;
        let out = dispatch_op(op);
        assert!(out.point_ats.is_empty());
        assert!(!out.warnings.is_empty());
    }

    #[test]
    fn compose_walkthrough_collects_valid_steps() {
        let op = r###"{"op":"propose_action","action":"compose_walkthrough","params":{"title":"Quick tour","steps":[{"anchor":"nav_agents","narration":"Your agents."},{"anchor":"vault","narration":"Your connections."}]},"rationale":"orient the user"}"###;
        let out = dispatch_op(op);
        assert_eq!(out.composed_walkthroughs.len(), 1);
        assert_eq!(out.composed_walkthroughs[0].steps.len(), 2);
        assert_eq!(out.composed_walkthroughs[0].title.as_deref(), Some("Quick tour"));
        assert!(!out.cleaned_text.contains("compose_walkthrough"));
    }

    #[test]
    fn compose_walkthrough_rejects_bad_anchor_in_any_step() {
        let op = r###"{"op":"propose_action","action":"compose_walkthrough","params":{"steps":[{"anchor":"nav_agents","narration":"ok"},{"anchor":"window.localStorage","narration":"bad"}]}}"###;
        let out = dispatch_op(op);
        assert!(out.composed_walkthroughs.is_empty());
        assert!(!out.warnings.is_empty());
    }

    #[test]
    fn compose_walkthrough_rejects_too_few_steps() {
        let op = r###"{"op":"propose_action","action":"compose_walkthrough","params":{"steps":[{"anchor":"vault","narration":"only one"}]}}"###;
        let out = dispatch_op(op);
        assert!(out.composed_walkthroughs.is_empty());
        assert!(!out.warnings.is_empty());
    }

    // ── op-JSON brace repair (observed live 2026-07-04) ────────────────

    #[test]
    fn repair_op_json_completes_small_brace_deficits() {
        assert_eq!(
            repair_op_json(r#"{"op":"x","params":{"a":"b"}"#).as_deref(),
            Some(r#"{"op":"x","params":{"a":"b"}}"#)
        );
        assert_eq!(
            repair_op_json(r#"{"op":"x","params":{"a":{"b":"c"}"#).as_deref(),
            Some(r#"{"op":"x","params":{"a":{"b":"c"}}}"#)
        );
        // Balanced JSON → nothing to repair.
        assert!(repair_op_json(r#"{"op":"x"}"#).is_none());
        // Ends inside a string literal → unrecoverable, keep the error.
        assert!(repair_op_json(r#"{"op":"x","params":{"a":"trunc"#).is_none());
        // Escaped quotes inside a string must not flip the in-string
        // state — the note string here IS closed, so the single missing
        // envelope brace is completable. (Escaped regular literals on
        // purpose: a raw-string literal ending in `\""#` terminates at
        // the embedded `"#` and silently truncates the test input.)
        assert_eq!(
            repair_op_json("{\"op\":\"x\",\"note\":\"say \\\"hi\\\"\"").as_deref(),
            Some("{\"op\":\"x\",\"note\":\"say \\\"hi\\\"\"}")
        );
        // And a genuinely unterminated string stays unrepairable.
        assert!(repair_op_json("{\"op\":\"x\",\"note\":\"say \\\"hi\\\"").is_none());
    }

    #[test]
    fn truncated_dev_improve_op_still_lands_an_approval() {
        // The exact live failure shape: a long single-line dev_improve op
        // missing its final envelope brace. The prose around it must
        // survive; the repaired op must create a pending approval, with
        // no parse warning.
        let op = r#"{"op": "propose_action", "action": "dev_improve", "params": {"request": "Give the wrench a subtle amber hover tint in its off state", "context": "companion-chat", "backend": false, "confidence": "high", "rationale": "self-contained styling fix"}"#;
        let out = dispatch_op(op);
        assert_eq!(out.approvals.len(), 1, "warnings: {:?}", out.warnings);
        assert_eq!(out.approvals[0].action, "dev_improve");
        assert!(out.warnings.is_empty(), "warnings: {:?}", out.warnings);
        assert!(!out.cleaned_text.contains("OP:"));
    }

    // ── compose_tour (Generative Tours) ─────────────────────────────────

    #[test]
    fn compose_tour_collects_manifest_valid_spec() {
        let op = r###"{"op":"propose_action","action":"compose_tour","params":{"topic":"scheduling","title":"Meet Schedules","description":"Timed triggers.","steps":[{"id":"open-schedules","title":"Open Schedules","description":"Every timed trigger lives here.","hint":"Look around.","nav":{"sidebarSection":"schedules"}}]},"rationale":"user asked to be shown"}"###;
        let out = dispatch_op(op);
        assert_eq!(out.composed_tours.len(), 1, "warnings: {:?}", out.warnings);
        assert!(!out.cleaned_text.contains("compose_tour"));
        let spec: serde_json::Value = serde_json::from_str(&out.composed_tours[0]).unwrap();
        assert_eq!(spec["topic"], "scheduling");
        assert_eq!(
            spec["steps"][0]["completeOn"], "tour:composed-step-explored",
            "composed steps must advance on the acknowledge event"
        );
    }

    // ── Detail-on-demand read ops ───────────────────────────────────────

    /// In-memory system pool with just the tables the read ops query.
    fn read_op_sys_pool() -> crate::db::DbPool {
        let manager = SqliteConnectionManager::memory();
        let pool = Pool::builder().max_size(1).build(manager).expect("sys pool");
        pool.get()
            .unwrap()
            .execute_batch(
                "CREATE TABLE personas (id TEXT PRIMARY KEY, name TEXT NOT NULL,
                    description TEXT, system_prompt TEXT NOT NULL DEFAULT '',
                    model_profile TEXT, enabled INTEGER NOT NULL DEFAULT 1,
                    home_team_id TEXT, updated_at TEXT NOT NULL);
                 CREATE TABLE persona_teams (id TEXT PRIMARY KEY, name TEXT NOT NULL,
                    description TEXT, enabled INTEGER NOT NULL DEFAULT 1,
                    updated_at TEXT NOT NULL);
                 CREATE TABLE persona_team_members (id TEXT PRIMARY KEY,
                    team_id TEXT NOT NULL, persona_id TEXT NOT NULL);
                 CREATE TABLE dev_projects (id TEXT PRIMARY KEY, name TEXT NOT NULL,
                    root_path TEXT NOT NULL);
                 CREATE TABLE dev_context_groups (id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL, name TEXT NOT NULL);
                 CREATE TABLE dev_contexts (id TEXT PRIMARY KEY, project_id TEXT,
                    group_id TEXT, name TEXT NOT NULL, description TEXT,
                    file_paths TEXT NOT NULL DEFAULT '[]', keywords TEXT,
                    pinned INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL);",
            )
            .unwrap();
        pool
    }

    fn seed_read_op_rows(pool: &crate::db::DbPool) {
        let conn = pool.get().unwrap();
        conn.execute_batch(
            "INSERT INTO persona_teams (id, name, description, enabled, updated_at)
                VALUES ('team_abc', 'SDLC', 'Ships the product', 1, '2026-01-01');
             INSERT INTO persona_team_members (id, team_id, persona_id)
                VALUES ('m1', 'team_abc', 'p_scout');
             INSERT INTO personas (id, name, description, system_prompt, model_profile,
                    enabled, home_team_id, updated_at)
                VALUES ('p_scout', 'Scout', 'Finds things', 'You are Scout. ',
                    '{\"model\":\"claude-opus-4-5\"}', 1, 'team_abc', '2026-01-02');
             INSERT INTO dev_projects (id, name, root_path)
                VALUES ('proj_1', 'Personas', 'C:/repo');
             INSERT INTO dev_context_groups (id, project_id, name)
                VALUES ('grp_1', 'proj_1', 'AI Companion');
             INSERT INTO dev_contexts (id, project_id, group_id, name, description,
                    file_paths, keywords, pinned, updated_at)
                VALUES ('ctx_1', 'proj_1', 'grp_1', 'Companion Prompt',
                    'System prompt assembly', '[\"src/companion/prompt.rs\"]',
                    'prompt, athena', 1, '2026-01-03');",
        )
        .unwrap();
    }

    #[test]
    fn every_read_op_has_a_dispatch_arm() {
        // Cheap guard against the divergence class these ops were shaped to
        // avoid: a read op that is neither handled here nor in
        // ALLOWED_ACTIONS falls through to "rejected unknown action" and
        // silently does nothing.
        let pool = test_pool();
        for action in READ_OPS {
            let text = format!(
                r#"Prose.
OP: {{"op": "propose_action", "action": "{action}", "params": {{"query": "anything"}}}}"#
            );
            let out = dispatch(&pool, "default", &text).expect("dispatch ok");
            assert!(
                !out.warnings
                    .iter()
                    .any(|w| w.contains("rejected unknown action")),
                "`{action}` has no dispatch arm: {:?}",
                out.warnings
            );
            assert!(
                out.approvals.is_empty(),
                "`{action}` must not create an approval card"
            );
            assert!(
                !out.cleaned_text.contains("OP:"),
                "`{action}` must be stripped from the reply"
            );
        }
    }

    /// A system pool carrying `app_settings`, where the canvas publishes its
    /// scene snapshot.
    fn canvas_sys_pool(scene_json: Option<&str>) -> crate::db::DbPool {
        let manager = SqliteConnectionManager::memory();
        let pool = Pool::builder().max_size(1).build(manager).expect("sys pool");
        {
            let conn = pool.get().unwrap();
            conn.execute_batch(
                "CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL,
                    updated_at TEXT NOT NULL DEFAULT '2026-08-04');",
            )
            .unwrap();
            if let Some(json) = scene_json {
                conn.execute(
                    "INSERT INTO app_settings (key, value) VALUES (?1, ?2)",
                    params![crate::db::settings_keys::MASTERMIND_SCENE, json],
                )
                .unwrap();
            }
        }
        pool
    }

    const CANVAS_FIXTURE: &str = r#"{"version":1,"publishedAt":"2026-08-04T09:00:00Z",
        "families":{"scans":"failed"},
        "projects":[
          {"slug":"proj_1","name":"Personas","state":"warning","attention":true,
           "blockers":3,"fleet":2,"ideasDays":42,"goalsOngoing":3,
           "kpiTotal":6,"kpiOff":2,
           "dims":[{"key":"tests","label":"Tests","status":"risk","detail":"41% cov"},
                   {"key":"ci","label":"CI","status":"solid"}]},
          {"slug":"proj_2","name":"Vibeman","state":"healthy","dims":[]}
        ]}"#;

    #[test]
    fn canvas_read_ops_are_bounded_and_name_the_real_numbers() {
        let sys = canvas_sys_pool(Some(CANVAS_FIXTURE));
        let detail = crate::companion::canvas::describe_canvas_project(&sys, "proj_1");
        assert!(detail.contains("`proj_1`"), "{detail}");
        assert!(detail.contains("Tests risk (41% cov)"), "{detail}");
        assert!(detail.contains("NEEDS THE USER"), "{detail}");
        assert!(detail.contains("scans (failed)"), "must flag bad data: {detail}");
        assert!(detail.len() <= READ_OP_DETAIL_CHARS, "unbounded: {}", detail.len());

        let fresh = crate::companion::canvas::describe_canvas_freshness(&sys, "proj_1");
        assert!(fresh.contains("42d old"), "{fresh}");
        assert!(fresh.contains("3 ongoing"), "{fresh}");
        assert!(fresh.contains("2 of 6 OFF TRACK"), "{fresh}");
        assert!(fresh.len() <= READ_OP_DETAIL_CHARS, "unbounded: {}", fresh.len());

        // Empty query answers for the whole canvas, worst-first and bounded.
        let all = crate::companion::canvas::describe_canvas_freshness(&sys, "");
        assert!(all.contains("2 of 2 projects"), "{all}");
        assert!(all.find("proj_1").unwrap() < all.find("proj_2").unwrap(), "{all}");
        assert!(all.len() <= READ_OP_DETAIL_CHARS, "unbounded: {}", all.len());
    }

    #[test]
    fn canvas_project_detail_stays_bounded_with_all_fifteen_cells() {
        // Fifteen cells with pathological detail strings must not sail past
        // the dispatcher's own clip, which would take the caveats footer with
        // it and turn a hedged answer into a confident one.
        let dims: Vec<String> = (0..15)
            .map(|d| {
                format!(
                    r#"{{"key":"dim{d}","label":"Dimension {d}","status":"risk","detail":"{}"}}"#,
                    "x".repeat(4000)
                )
            })
            .collect();
        let sys = canvas_sys_pool(Some(&format!(
            r#"{{"version":1,"projects":[{{"slug":"p","name":"P","state":"critical","dims":[{}]}}]}}"#,
            dims.join(",")
        )));
        let out = crate::companion::canvas::describe_canvas_project(&sys, "p");
        assert!(out.len() <= READ_OP_DETAIL_CHARS, "unbounded: {}", out.len());
        assert!(
            out.contains("of 15"),
            "must say how many of the fifteen it printed: {out}"
        );
        assert!(out.contains("publish"), "footer must survive: {out}");
    }

    #[test]
    fn canvas_read_ops_are_graceful_on_an_unknown_slug() {
        let sys = canvas_sys_pool(Some(CANVAS_FIXTURE));
        for out in [
            crate::companion::canvas::describe_canvas_project(&sys, "not-a-project"),
            crate::companion::canvas::describe_canvas_freshness(&sys, "not-a-project"),
        ] {
            assert!(out.contains("No project matches"), "{out}");
            assert!(out.contains("`proj_1`"), "must name a real slug: {out}");
            assert!(out.contains("do not invent a slug"), "{out}");
        }
    }

    #[test]
    fn canvas_read_ops_refuse_demo_islands_rather_than_answering_about_them() {
        let sys = canvas_sys_pool(Some(CANVAS_FIXTURE));
        for out in [
            crate::companion::canvas::describe_canvas_project(&sys, "demo-codex"),
            crate::companion::canvas::describe_canvas_freshness(&sys, "demo-web"),
        ] {
            assert!(out.contains("demo islands"), "{out}");
        }
    }

    #[test]
    fn canvas_read_ops_say_so_when_no_scene_has_been_published() {
        let sys = canvas_sys_pool(None);
        let out = crate::companion::canvas::describe_canvas_project(&sys, "proj_1");
        assert!(out.contains("has not published a scene"), "{out}");
        assert!(out.contains("rather than describing one"), "{out}");
    }

    /// One `compose_canvas_panel` op line with the given slug + spec JSON.
    fn panel_line(slug: &str, spec: &str) -> String {
        format!(
            r#"Composing.
OP: {{"op":"propose_action","action":"compose_canvas_panel","params":{{"slug":"{slug}","spec":{spec}}},"rationale":"why"}}"#
        )
    }

    const GOOD_SPEC: &str =
        r#"{"surface":"v1","title":"Tests","blocks":[{"type":"markdown","content":"hi"}]}"#;

    #[test]
    fn compose_canvas_panel_emits_a_panel_for_a_slug_in_the_published_scene() {
        let pool = test_pool();
        let sys = canvas_sys_pool(Some(CANVAS_FIXTURE));
        let out = dispatch_with_sys(&pool, Some(&sys), "default", &panel_line("proj_1", GOOD_SPEC))
            .expect("dispatch ok");
        assert_eq!(out.canvas_panels.len(), 1, "warnings: {:?}", out.warnings);
        let panel = &out.canvas_panels[0];
        assert_eq!(panel.slug, "proj_1");
        assert_eq!(panel.spec_version, CANVAS_PANEL_SPEC_VERSION);
        assert!(panel.spec.contains("\"surface\":\"v1\""), "{}", panel.spec);
        // Auto-fire: no approval card, and the op line never reaches the user.
        assert!(out.approvals.is_empty());
        assert!(!out.cleaned_text.contains("OP:"), "{}", out.cleaned_text);
        // Auto-fire arm, like compose_cockpit: neither an approval action nor
        // a read op, so listing it in either would create a dead card.
        assert!(!ALLOWED_ACTIONS.contains(&"compose_canvas_panel"));
        assert!(!READ_OPS.contains(&"compose_canvas_panel"));
        // Resolved by NAME lands on the canonical slug, so the frontend keys
        // the panel the same way the canvas does.
        let by_name =
            dispatch_with_sys(&pool, Some(&sys), "default", &panel_line("Personas", GOOD_SPEC))
                .expect("dispatch ok");
        assert_eq!(by_name.canvas_panels[0].slug, "proj_1");
    }

    #[test]
    fn compose_canvas_panel_refuses_a_demo_island_and_an_invented_slug() {
        let pool = test_pool();
        let sys = canvas_sys_pool(Some(CANVAS_FIXTURE));

        let demo = dispatch_with_sys(&pool, Some(&sys), "default", &panel_line("demo-web", GOOD_SPEC))
            .expect("dispatch ok");
        assert!(demo.canvas_panels.is_empty());
        assert!(
            demo.warnings.iter().any(|w| w.contains("demo islands")),
            "{:?}",
            demo.warnings
        );

        let unknown =
            dispatch_with_sys(&pool, Some(&sys), "default", &panel_line("not-a-project", GOOD_SPEC))
                .expect("dispatch ok");
        assert!(unknown.canvas_panels.is_empty());
        // A refusal must name real slugs, or the next attempt is another guess.
        assert!(
            unknown.warnings.iter().any(|w| w.contains("`proj_1`")),
            "{:?}",
            unknown.warnings
        );
    }

    #[test]
    fn compose_canvas_panel_refuses_a_spec_that_is_not_a_surface_envelope() {
        let pool = test_pool();
        let sys = canvas_sys_pool(Some(CANVAS_FIXTURE));
        let too_many: String = format!(
            r#"{{"surface":"v1","blocks":[{}]}}"#,
            std::iter::repeat(r#"{"type":"markdown","content":"x"}"#)
                .take(CANVAS_PANEL_MAX_BLOCKS + 1)
                .collect::<Vec<_>>()
                .join(",")
        );
        for spec in [
            r#"{"blocks":[{"type":"markdown","content":"x"}]}"#, // no envelope tag
            r#"{"surface":"v2","blocks":[{"type":"markdown","content":"x"}]}"#, // wrong version
            r#"{"surface":"v1","blocks":[]}"#,                   // nothing to render
            r#"{"surface":"v1"}"#,                               // no blocks at all
            &too_many,
        ] {
            let out = dispatch_with_sys(&pool, Some(&sys), "default", &panel_line("proj_1", spec))
                .expect("dispatch ok");
            assert!(out.canvas_panels.is_empty(), "accepted a bad spec: {spec}");
            assert!(
                out.warnings.iter().any(|w| w.contains("compose_canvas_panel")),
                "{spec}: {:?}",
                out.warnings
            );
        }
    }

    #[test]
    fn compose_canvas_panel_fails_closed_when_no_scene_is_reachable() {
        let pool = test_pool();
        // No system DB at all — the slug cannot be checked against anything.
        let blind = dispatch(&pool, "default", &panel_line("proj_1", GOOD_SPEC)).expect("ok");
        assert!(blind.canvas_panels.is_empty());
        assert!(
            blind.warnings.iter().any(|w| w.contains("not reachable")),
            "{:?}",
            blind.warnings
        );

        // System DB present, but the canvas has never published.
        let sys = canvas_sys_pool(None);
        let unpublished =
            dispatch_with_sys(&pool, Some(&sys), "default", &panel_line("proj_1", GOOD_SPEC))
                .expect("ok");
        assert!(unpublished.canvas_panels.is_empty());
        assert!(
            unpublished
                .warnings
                .iter()
                .any(|w| w.contains("has not published a scene")),
            "{:?}",
            unpublished.warnings
        );
    }

    /// One `canvas_control` op line with the given grammar action JSON.
    fn control_line(action: &str) -> String {
        format!(
            r#"Steering.
OP: {{"op":"propose_action","action":"canvas_control","params":{{"action":{action}}},"rationale":"why"}}"#
        )
    }

    #[test]
    fn canvas_control_validates_and_emits_steering_actions() {
        let pool = test_pool();
        let sys = canvas_sys_pool(Some(CANVAS_FIXTURE));
        // Focus by NAME resolves to the canonical slug; the band survives.
        let out = dispatch_with_sys(
            &pool,
            Some(&sys),
            "default",
            &control_line(r#"{"kind":"camera.focus","slug":"Personas","band":"close"}"#),
        )
        .expect("dispatch ok");
        assert_eq!(out.canvas_controls.len(), 1, "warnings: {:?}", out.warnings);
        let action: serde_json::Value =
            serde_json::from_str(&out.canvas_controls[0].action).expect("valid JSON");
        assert_eq!(action["kind"], "camera.focus");
        assert_eq!(action["slug"], "proj_1");
        assert_eq!(action["band"], "close");
        // Auto-fire arm: no approval card, the op line is stripped, and it
        // lives in neither op list (an entry there would be a dead card).
        assert!(out.approvals.is_empty());
        assert!(!out.cleaned_text.contains("OP:"), "{}", out.cleaned_text);
        assert!(!ALLOWED_ACTIONS.contains(&"canvas_control"));
        assert!(!READ_OPS.contains(&"canvas_control"));

        // dim.open carries slug + key; pan carries validated numbers only.
        let dim = dispatch_with_sys(
            &pool,
            Some(&sys),
            "default",
            &control_line(r#"{"kind":"dim.open","slug":"proj_1","key":"tests","invented":"x"}"#),
        )
        .expect("dispatch ok");
        assert_eq!(dim.canvas_controls.len(), 1, "warnings: {:?}", dim.warnings);
        let dim_action: serde_json::Value =
            serde_json::from_str(&dim.canvas_controls[0].action).expect("valid JSON");
        assert_eq!(dim_action["key"], "tests");
        // Only validated fields survive re-serialization.
        assert!(dim_action.get("invented").is_none());

        let pan = dispatch_with_sys(
            &pool,
            Some(&sys),
            "default",
            &control_line(r#"{"kind":"camera.pan","dx":500,"dy":-120,"unit":"world"}"#),
        )
        .expect("dispatch ok");
        assert_eq!(pan.canvas_controls.len(), 1, "warnings: {:?}", pan.warnings);
    }

    #[test]
    fn canvas_control_refuses_bad_kinds_slugs_and_params() {
        let pool = test_pool();
        let sys = canvas_sys_pool(Some(CANVAS_FIXTURE));
        for (action, needle) in [
            // Reads have a synchronous op already — point her at it.
            (r#"{"kind":"island.read","slug":"proj_1"}"#, "describe_canvas_project"),
            (r#"{"kind":"dim.read","slug":"proj_1","key":"ci"}"#, "describe_canvas_project"),
            (r#"{"kind":"island.move","slug":"proj_1"}"#, "unknown kind"),
            (r#"{"kind":"camera.focus","slug":"demo-web"}"#, "demo islands"),
            (r#"{"kind":"camera.focus","slug":"not-a-project"}"#, "No project matches"),
            (r#"{"kind":"camera.zoom"}"#, "needs `factor` or `band`"),
            (r#"{"kind":"camera.zoom","factor":-2}"#, "positive finite"),
            (r#"{"kind":"camera.zoom","band":"orbit"}"#, "`band` must be one of"),
            (r#"{"kind":"camera.pan","dx":1}"#, "finite numeric `dy`"),
            (r#"{"kind":"dim.open","slug":"proj_1"}"#, "needs `key`"),
            (r#"{"kind":"category.open","slug":"proj_1","category":"vibes"}"#, "category"),
            (r#"{"kind":"camera.fit","slugs":[]}"#, "1-12"),
        ] {
            let out = dispatch_with_sys(&pool, Some(&sys), "default", &control_line(action))
                .expect("dispatch ok");
            assert!(out.canvas_controls.is_empty(), "{action} should refuse");
            assert!(
                out.warnings.iter().any(|w| w.contains(needle)),
                "{action}: wanted `{needle}` in {:?}",
                out.warnings
            );
        }
        // Fail closed when no system DB is reachable — even for slug-less kinds.
        let blind = dispatch(&pool, "default", &control_line(r#"{"kind":"camera.read"}"#))
            .expect("dispatch ok");
        assert!(blind.canvas_controls.is_empty());
        assert!(
            blind.warnings.iter().any(|w| w.contains("not reachable")),
            "{:?}",
            blind.warnings
        );
    }

    #[test]
    fn canvas_control_resolves_fit_slugs_and_caps_actions_per_turn() {
        let pool = test_pool();
        let sys = canvas_sys_pool(Some(CANVAS_FIXTURE));
        // fit with names → canonical slugs.
        let fit = dispatch_with_sys(
            &pool,
            Some(&sys),
            "default",
            &control_line(r#"{"kind":"camera.fit","slugs":["Personas","Vibeman"]}"#),
        )
        .expect("dispatch ok");
        assert_eq!(fit.canvas_controls.len(), 1, "warnings: {:?}", fit.warnings);
        let fit_action: serde_json::Value =
            serde_json::from_str(&fit.canvas_controls[0].action).expect("valid JSON");
        assert_eq!(fit_action["slugs"], serde_json::json!(["proj_1", "proj_2"]));

        // Six steering ops in one turn → first four kept, the rest warned away.
        let line = r#"OP: {"op":"propose_action","action":"canvas_control","params":{"action":{"kind":"camera.read"}},"rationale":"w"}"#;
        let burst = std::iter::repeat(line).take(6).collect::<Vec<_>>().join("\n");
        let out = dispatch_with_sys(&pool, Some(&sys), "default", &burst).expect("dispatch ok");
        assert_eq!(out.canvas_controls.len(), CANVAS_CONTROL_MAX_PER_TURN);
        assert!(
            out.warnings.iter().any(|w| w.contains("camera thrash")),
            "{:?}",
            out.warnings
        );
    }

    #[test]
    fn canvas_actions_are_allowed_actions_not_read_ops() {
        // The two lists must not overlap: an action in READ_OPS would auto-fire
        // with no approval card and no executor, silently doing nothing.
        for action in ["canvas_dispatch", "canvas_group_dispatch", "canvas_run_idea_scan"] {
            assert!(ALLOWED_ACTIONS.contains(&action), "{action} needs an executor arm");
            assert!(!READ_OPS.contains(&action), "{action} must not auto-fire");
        }
        for action in ["describe_canvas_project", "describe_canvas_freshness"] {
            assert!(READ_OPS.contains(&action));
            assert!(
                !ALLOWED_ACTIONS.contains(&action),
                "{action} has no executor; listing it would create a dead approval card"
            );
        }
    }

    #[test]
    fn read_op_without_a_query_is_rejected_except_list_teams() {
        let pool = test_pool();
        for action in READ_OPS {
            if READ_OPS_QUERY_OPTIONAL.contains(action) {
                continue;
            }
            let text =
                format!(r#"OP: {{"op":"propose_action","action":"{action}","params":{{}}}}"#);
            let out = dispatch(&pool, "default", &text).expect("dispatch ok");
            assert!(
                out.warnings.iter().any(|w| w.contains("missing `query`")),
                "{action}: {:?}",
                out.warnings
            );
        }
        for action in READ_OPS_QUERY_OPTIONAL {
            let text =
                format!(r#"OP: {{"op":"propose_action","action":"{action}","params":{{}}}}"#);
            let out = dispatch(&pool, "default", &text).expect("dispatch ok");
            assert!(out.warnings.is_empty(), "{action}: {:?}", out.warnings);
        }
    }

    #[test]
    fn describe_persona_returns_bounded_detail_and_the_real_id() {
        let sys = read_op_sys_pool();
        seed_read_op_rows(&sys);
        let out = describe_persona(&sys, "Scout");
        assert!(out.contains("`p_scout`"), "{out}");
        assert!(out.contains("opus") || out.contains("claude-opus-4-5"), "{out}");
        assert!(out.contains("SDLC"), "{out}");
        assert!(out.len() <= READ_OP_DETAIL_CHARS, "unbounded: {}", out.len());

        // A pathological system prompt must not blow the bound.
        sys.get()
            .unwrap()
            .execute(
                "UPDATE personas SET system_prompt = ?1 WHERE id = 'p_scout'",
                params!["x".repeat(200_000)],
            )
            .unwrap();
        let big = describe_persona(&sys, "p_scout");
        assert!(big.len() <= READ_OP_DETAIL_CHARS, "unbounded: {}", big.len());
    }

    #[test]
    fn describe_persona_handles_an_unknown_id_gracefully() {
        let sys = read_op_sys_pool();
        seed_read_op_rows(&sys);
        let out = describe_persona(&sys, "00000000-0000-0000-0000-000000000000");
        assert!(out.contains("No agent matches"), "{out}");
        assert!(out.contains("Scout"), "should name a real alternative: {out}");
        assert!(out.contains("do not invent an id"), "{out}");
    }

    #[test]
    fn describe_context_resolves_by_name_and_by_id() {
        let sys = read_op_sys_pool();
        seed_read_op_rows(&sys);
        for q in ["Companion Prompt", "ctx_1", "companion"] {
            let out = describe_context(&sys, q);
            assert!(out.contains("`ctx_1`"), "query {q}: {out}");
            assert!(out.contains("AI Companion"), "query {q}: {out}");
            assert!(out.len() <= READ_OP_DETAIL_CHARS);
        }
        let miss = describe_context(&sys, "no-such-context");
        assert!(miss.contains("No dev context matches"), "{miss}");
    }

    #[test]
    fn list_teams_returns_the_team_id_assign_team_needs() {
        let sys = read_op_sys_pool();
        seed_read_op_rows(&sys);
        let out = list_teams(&sys, "");
        assert!(out.contains("`team_abc`"), "{out}");
        assert!(out.contains("1 members"), "{out}");
        assert!(out.contains("1 of 1 teams"), "{out}");
        assert!(out.len() <= READ_OP_DETAIL_CHARS);

        assert!(list_teams(&sys, "SDL").contains("`team_abc`"));
        assert!(list_teams(&sys, "nope").contains("No team matches"));
    }

    #[test]
    fn list_teams_is_bounded_and_honest_at_scale() {
        let sys = read_op_sys_pool();
        {
            let conn = sys.get().unwrap();
            for n in 0..200 {
                conn.execute(
                    "INSERT INTO persona_teams (id, name, description, enabled, updated_at)
                     VALUES (?1, ?2, ?3, 1, '2026-01-01')",
                    params![
                        format!("team_{n:04}"),
                        format!("Team {n}"),
                        "A team with a fairly long description to pad the row out."
                    ],
                )
                .unwrap();
            }
        }
        let out = list_teams(&sys, "");
        assert!(out.len() <= READ_OP_DETAIL_CHARS, "unbounded: {}", out.len());
        // Truncated by the char budget before the row cap, and it says so.
        assert!(out.contains(" of 200 teams"), "{out}");
        assert!(!out.contains("200 of 200 teams"), "{out}");
    }

    #[test]
    fn describe_skill_without_a_match_names_real_alternatives() {
        // No sys pool → project skill dirs are unavailable; the op must
        // still answer honestly instead of inventing a skill.
        let out = describe_skill(None, "totally-made-up-skill");
        assert!(out.contains("No installed skill matches"), "{out}");
        assert!(out.contains("Do not invent a skill name"), "{out}");
    }

    #[test]
    fn compose_tour_rejects_unknown_anchor_wholesale() {
        let op = r###"{"op":"propose_action","action":"compose_tour","params":{"topic":"x","title":"T","steps":[{"title":"S","description":"D","nav":{"sidebarSection":"schedules"},"highlightTestId":"totally-hallucinated-anchor-xyz"}]}}"###;
        let out = dispatch_op(op);
        assert!(out.composed_tours.is_empty());
        assert!(
            out.warnings.iter().any(|w| w.contains("unknown anchor")),
            "warnings: {:?}",
            out.warnings
        );
    }
}

