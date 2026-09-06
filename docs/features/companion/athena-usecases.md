# Athena — what she can do today

> **Currency: refreshed 2026-09-06 against constitution v61**
> (`templates/mod.rs:508`). The 2026-06-16 version claimed v41 and was
> written against a single-file `dispatcher.rs` / `prompt.rs` / `session.rs`
> that no longer exist - all three are now module directories. The
> allow-lists in `dispatcher/catalog.rs`, the chat-card arms in
> `dispatcher/dispatch.rs`, and `prompt/compose.rs` remain the ground
> truth - re-derive from them, not from prose, when in doubt.

## Status (verified 2026-09-06)

Counted against `dispatcher/catalog.rs` and the arms in
`dispatcher/dispatch.rs`:

- **55 approval-gated ops** in `ALLOWED_ACTIONS` (`catalog.rs:11-213`), plus
  three executor arms that are *not* Athena-emittable from chat
  (`kp_hire_request`, `post_team_message`, `night_shift_execute_plan` -
  `approvals/approval_lifecycle.rs:177,264,267`).
- **12 read-only ops** in `READ_OPS` (`catalog.rs:221-274`), auto-fire, no
  approval card, bounded answer written back as a System episode.
- **33 auto-fire ops** with their own dispatch arms in
  `dispatcher/dispatch.rs` (navigation, chat cards, canvas, guidance),
  one of which (`use_connector`) is conditionally approval-gated.
- Every entry in `ALLOWED_ACTIONS` and `READ_OPS` is gated by a test that it
  is also *taught* by the constitution (`catalog.rs:446`) - an op the
  document never names is one Athena can never emit.
- **Autopilot class is gone.** `AUTOAPPROVE_ALLOWLIST` was deleted 2026-08-10
  (`approvals/approval_autopilot.rs:13-49`): under autonomous mode **every**
  proposed action now fires, and with the mode off nothing auto-fires at all.
  The only actions still able to stay pending under autonomous mode are the
  two screen-driving fleet ops behind the boldness dial
  (`fleet_send_input`, `fleet_intervene` - `approval_autopilot.rs:106-121`)
  and `remote_instruct`'s home-device rule (`:73-76`).

Retired since the last pass: the `fleet_awaiting` and `fleet_stuck_dispatched`
proactive triggers and the ElevenLabs and Piper TTS engines. Details in the
sections below.

A concrete, honest inventory of Athena's capability surface as shipped
on `master`. The chat is **not** a fixed menu — what she can actually
do depends on what's pinned, what's enabled, and what's been wired
end-to-end. This doc tracks that delta so the answer to "what can you
do?" is grounded.

If you're reading this because you clicked the **❓ help** button in
the chat toolbar, Athena has the same answer pulled into her prompt
via doctrine retrieval.

## Conversation

- **Streaming chat** over a long-lived Claude CLI session at the repo
  root. Markdown reply + optional spoken summary + optional quick-reply
  chips in a single turn.
- **Quick-reply chips** (`QR:`) — Athena offers up to **6** follow-up
  prompts (hard cap at `dispatcher/dispatch.rs:146`; see A12); clicking sends one back
  through `send()` as the next user turn, and number keys 1–9 fire the
  matching chip (`QuickReplies.tsx`).
- **Mid-stream Stop** (A5) — the streaming bubble shows a hoverable
  Stop button (`Square` icon, top-right). Click → `companion_interrupt_turn`
  fires → backend's cooperative cancellation registry kills the CLI
  child process; whatever streamed so far is persisted with
  `[interrupted by user]` appended. The next turn picks up cleanly via
  `--resume`.
- **Autonomous mode toggle** (A2, ∞ icon in the header) — when ON,
  Athena may emit `OP: continue_autonomously { rationale }` at the
  end of a turn. Backend schedules the next turn ~15s later (synthetic
  prompt: "continue your autonomous work, this is continuation #N"),
  up to 20 consecutive chains per session (`session/origin.rs:29`,
  enforced at `session/turn.rs:997`). Persists across panel
  close/reopen via `systemStore`. The continuation turn renders as a
  slim divider in the transcript (`── autonomous continuation #N ──`)
  rather than a regular bubble — visual separation between user-driven
  and Athena-driven work. **Autonomous mode is also the standing consent
  for approvals**: since 2026-08-10 there is no allowlist and every
  proposed action auto-resolves through the same executor table as a
  user click (`approvals/approval_autopilot.rs:13-49`). With the mode
  off, nothing on that path runs and the manual card flow is unchanged.
- **Stop = type anything** — any user message cancels a pending
  autonomous tick via `companion_cancel_autonomy` (called from
  `companion_send_message`). If a tick is mid-stream, the A5 Stop
  button finishes the interrupt.
- **Reset** wipes the visible transcript and the CLI session pointer.
  The markdown episodes on disk remain — memory is preserved.
- **Dev mode** (debug builds; the 🔧 wrench toggle in the header) — the
  self-development loop: Athena resolves feature-talk to code via the
  context map and proposes `dev_improve` coding dispatches (approval-
  gated, never auto-fired) that run as visible Fleet sessions at the
  repo; each run ends in a reflection turn, and backend work applies
  only through the `dev_merge` handshake. Replaces the old wrench-send
  composer button. See `docs/tests/athena/dev-mode-direction.md`.

## UI control (auto-fire, no approval card)

Athena can navigate and reshape parts of the desktop app without
waiting for a click. Each of these emits a Tauri event the panel
consumes immediately, with a flash of the `shows` avatar clip:

- **`open_route`** — switch the sidebar to one of: `home`,
  `overview`, `personas`, `events`, `credentials`, `design-reviews`,
  `plugins`, `schedules`, `settings`, plus the two pseudo-routes
  `monitor` (full-screen Persona Monitor overlay) and `mastermind`
  (Teams → Mastermind canvas). Eleven in total; allowlist enforced
  server-side at `dispatcher/catalog.rs:371-392`.
- **`open_lab`** — jump to a persona's editor and pre-select a lab
  mode (`arena`, `ab`, `matrix`, `breed`, `evolve`, `versions`,
  `regression`). The persona is selected first; mode is stashed via
  `setCompanionLabJump` so the LabTab consumes it on mount.
- **`compose_dashboard`** — persists a real-time monitoring dashboard
  spec server-side, then navigates to **Plugins → Companion →
  Dashboard** so the user lands on what she just built.
- **`compose_cockpit`** — same shape as `compose_dashboard` but for a
  Cockpit (control-panel widget grid surfaced on the Home tab).
- **`use_connector`** — invoke a pinned connector's registered
  capability. **Gated per capability, not per op**: read-only slugs
  (`list_*` / `get_*` / `count_*`, `requires_approval: false`) auto-fire
  as a background job (`connector_use` kind); write / mutation slugs
  (`send_message`, `post_message`, `delete_page`, `write_text_file`,
  `execute_select`, `execute_mutation`, …) route through an approval
  card. The invariant is locked by the `every_write_capability_requires_approval`
  test at `companion/connectors.rs:435`. The job result lands as a system
  episode Athena reads on the next turn.
- **Guidance / tours** - `start_guided_walkthrough { topic }` (six topics,
  `catalog.rs:394-401`), `point_at { anchor }` and `compose_walkthrough`
  (2 to 6 steps, `catalog.rs:412-413`) drive the orb against a
  code-generated anchor allow-list (`generated_anchors.rs`); `compose_tour`
  persists a full generative tour validated against the tour-anchor
  manifest (`dispatcher/dispatch.rs:1952`).
- **Mastermind canvas** - `compose_canvas_panel` docks a composed surface
  onto a canvas island (`dispatch.rs:1055`) and `canvas_control` steers the
  view (bands, camera; capped per turn, `dispatch.rs:1128`). Both validate
  the slug against the published scene snapshot and refuse an invented or
  `demo-*` island.
- **`explain_in_cockpit`** - composes an ephemeral explanation overlay into
  the Cockpit rather than replying in prose (`dispatch.rs:981`).

## Read-only lookups (auto-fire, no approval card)

Detail-on-demand for entities whose always-on prompt index is truncated or
absent. Each answers into a bounded System episode Athena reads on her next
turn, so the prompt stays lean. Twelve ops, listed at
`dispatcher/catalog.rs:221-274`:

`describe_persona`, `describe_context`, `describe_skill`, `list_teams`,
`describe_canvas_project`, `describe_canvas_freshness`, `list_runner_tasks`,
`describe_skill_fleet`, `describe_knowledge`, `describe_ship_milestone`,
`describe_brain_health`, `describe_note`.

Budgets: 1,600 characters by default, 6,000 for `describe_ship_milestone` and
`describe_note` (`catalog.rs:read_op_detail_budget`). A `query` is required
except for the six listed in `READ_OPS_QUERY_OPTIONAL` (`catalog.rs:279-287`),
and is capped at 200 characters.

## Inline chat cards

Auto-fire widgets Athena drops mid-transcript via `propose_action`. No
approval. Cards render inline through `InlineChatCard`; the JSON config
Athena emits is forwarded verbatim as the widget's data. Three families.

**State-of-the-app cards** — surface live info from the app's own data:

- **`show_persona_overview`** — per-persona metadata grid.
- **`show_connected_services`** — pinned connector list with
  enable/disable badges.
- **`show_decisions`** — pending human-review / approvals card.
- **`show_recent_decisions`** — chip strip of 1–5 of Athena's most
  recent saved design decisions for a given `persona_context`. Widget
  fetches rows on mount via `companion_list_design_decisions`. Validates
  `persona_context` is non-empty; clamps `limit` to 1–5.

**Persona-design cards** — Athena composes structured guidance from
doctrine. Each validates required params at the dispatcher and rejects
malformed ops with a warning:

- **`show_design_capabilities`** — onboarding-style "what can I help you
  design?" menu. Hard-coded vocabulary in the widget; the op carries an
  optional `intro` line.
- **`show_persona_walkthrough`** — long-form markdown plan applied to a
  user intent, pulled from `concepts/persona-design-best-practices.md`.
  Requires non-empty `content`.
- **`show_template_suggestions`** — keyword-matched gallery hits via
  `companion_match_templates`. Requires non-empty `intent`; clamps
  `limit` to 1–5.
- **`show_use_case_set`** — 3–5 use cases tagged `golden | variant |
  out_of_scope`. Caps at 5; rejects invalid role slugs and oversize
  arrays (>8).
- **`show_trigger_set`** — 1–4 trigger configs (label / source /
  condition, optional grain + idempotency). Caps at 4; rejects missing
  fields and oversize arrays (>6).
- **`show_model_tier_choice`** — three-tier comparison (haiku / sonnet
  / opus) with one `recommended`. Rejects unknown recommended values
  and bad tier slugs / empty rationales.
- **`show_observability_plan`** — error-handling + success-metric pair.
  `success_metric.kind` must be `count_by_status | cost_per_run |
  latency | custom`.
- **`show_decision_log`** — audit-trail of label / choice / rationale
  triples (2–12 entries; widget caps display at 8). Best-effort
  **persists to `companion_design_decision`** so the log survives
  session reload; persist failures don't block the card render.
- **`show_persona_ready`** — end-of-design recap with primary
  "Commit to build" button. `recommended_action` must be
  `build_oneshot | interactive | use_template`; `summary.intent_line`
  is required.
- **`show_persona_creation_offer`** - inline "build it for me / show me
  how" offer when the user describes a persona in passing.
- **`show_walkthrough_offer`** - "show me / just tell me" offer for a
  guided walkthrough, rather than emitting the walkthrough unprompted.
- **`show_browser_test_report`** - per-step verdict card for a
  `run_browser_test` run (`dispatch.rs:791`); carries an optional
  defects / console-errors / security-notes payload and a "File as ideas"
  affordance.

**Editable proposal cards** - a third family, added after the 2026-06-16
pass. Each renders a card the user *corrects* before confirming, so the
validation is server-side and fails CLOSED (no database, no card):

- **`show_fleet_plan`** (`dispatch.rs:1420`) - an editable multi-session
  dispatch plan. Every row is checked against the same `validate_fleet_cwd`
  containment boundary `fleet_dispatch` enforces at fire time, so a plan
  that renders is a plan that can actually run.
- **`show_ship_milestone`** (`dispatch.rs:1496`) - propose a Ship milestone
  cut. Every member id is resolved against the real registry here, by the
  same validator the confirm path re-runs.
- **`show_ship_goals`** (`dispatch.rs:1613`) - decompose a milestone (or a
  note) into goals. The only card op that can CREATE a goal rather than
  bind an existing one; the project is read off the milestone row, never
  taken from the payload.
- **`show_note_suggestions`** (`dispatch.rs:1724`) - propose edits back into
  one Notepad note. Refuses without the app database rather than proposing
  edits into a note it could not prove exists.

## Approval-gated actions (cards)

Athena proposes; the user clicks **Approve** / **Reject**. Each inserts a
`companion_approval` row (`kind = 'op_execute'`, status `pending` -
`dispatcher/approvals.rs:68-70`); the chat surfaces a card with the action's
parameters until resolved. Under autonomous mode the same rows resolve
themselves through the shared executor table (see Conversation, above).
Surface:

- **Personas / builds** — `run_persona` (execute with given inputs),
  `prefill_persona_create` (pre-populate the create-persona form;
  default `mode: interactive`), `build_oneshot` (autonomous build
  shortcut — same effect as `prefill_persona_create` with
  `auto_launch=true, mode=one_shot`; OS notification on completion),
  `run_arena` (launch lab Arena mode with a list of model configs +
  optional use-case filter), `register_project` / `enqueue_dev_job`
  (project registry + background work).
- **Reviews** — `resolve_human_review` (decide on a pending design or
  execution review).
- **Identity & memory** — `update_identity` (edit identity.md);
  `write_fact` / `delete_fact` (semantic memory: facts about user,
  project, world); `write_procedural` / `delete_procedural`
  (behavioral rules: "when X, do Y"); `write_goal` /
  `update_goal_status` / `delete_goal`; `write_ritual` /
  `set_ritual_active` / `delete_ritual` (quiet hours, cadences,
  focus windows); `write_backlog_item` / `resolve_backlog_item`
  (commitments + capability gaps Athena has spotted in herself).
- **Future commitments** — `schedule_proactive` (Athena commits to a
  future check-in with `{ message, when_iso }`; the release sweep in
  `proactive::release_pending` — run on every 5-minute scheduler tick —
  delivers it through the same `companion://proactive` channel as
  trigger-driven nudges).
- **Fleet integration (Phase J — Claude Code workers)** — each moves a
  real subprocess, so all approval-gated:
  - `fleet_send_input` — write text (optional `press_enter`) to one
    fleet session's PTY stdin.
  - `fleet_broadcast` — same payload to multiple sessions, targeted by
    `all_waiting | all | ids`.
  - `fleet_kill` — soft kill (PTY EOF) one session.
  - `fleet_spawn` — start a new fleet session at `cwd` (tagged
    "athena" for visibility, so the user can see which were
    Athena-spawned).
  - `fleet_dispatch` (D5 v2) — one ApprovalCard launches N sessions
    (up to 8) under a single Operation. The reconciler in
    `commands::companion::fleet_bridge` synthesizes one cross-session
    wrap-up once every session exits.
  - `fleet_intervene` (D9) — write a guidance message into a stuck
    session's PTY stdin. Capped at **one intervention per session**
    via operative_memory tracking.
  - `fleet_redirect_op` (D9) — update an operation's `user_intent` +
    broadcast a redirection message to every active session in the
    op. Per-session intervention cap still applies.
  - `fleet_wake` / `fleet_resume` (Phase 4) - revive a hibernated session
    via `--resume`, or adopt an orphaned CLI process the registry lost.
    Both fail closed on a bad target.
- **Second execution lane** - `enqueue_runner_task` queues work on the Dev
  Tools Run Desk (the read half, `list_runner_tasks`, is a read op).
- **Cross-device** - `remote_instruct` hands an instruction to another of the
  user's own paired devices, where that device's Athena runs it as a real
  turn. Its consent rule is mode-conditional and lives in
  `approvals/approval_exec_devices.rs::gate_remote_instruct`, which is why
  it was never expressible as an allowlist entry.
- **Ship layer** - `set_ship_scope` (move members between core / later /
  never, or drop them) and `ship_milestone_lifecycle` (cut, freezing the
  scope, or ship). The SHIP transition carries its own DB-checkable
  precondition in `approvals/approval_exec_ship.rs` rather than trusting a
  human to be watching.
- **Skills + knowledge** - `skill_sync` (move ONE skill between the library
  and project copies; customized copies are never overwritten),
  `run_pattern_harvest`, `apply_pattern`, `evaluate_pattern`. All three
  pattern ops dispatch real sessions and are containment-checked through
  `validate_fleet_cwd`.
- **Mastermind canvas dispatch** - `canvas_dispatch`,
  `canvas_group_dispatch`, `canvas_run_idea_scan`. Thin slug-resolving
  wrappers that turn canvas slugs into the same `FleetPlanRow` shape the
  chat plan card produces, then hand off to the existing fleet executors;
  containment is unchanged and un-widened.
- **Dev mode** (debug builds + `companion_dev_mode` only) - `dev_improve`
  dispatches a coding fleet session at the source checkout; `dev_merge` is
  the explicit handshake that applies a backend run's branch to the live
  checkout.
- **Backlog** - `backlog_apply_triage` persists a batch of accept / reject
  verdicts over selected `dev_ideas`. Athena does not emit this from chat
  today; the Backlog's "Send to Athena" button is the only producer
  (`catalog.rs:167-176`). Rejected at parse time if `items` is empty.

Every memory write requires at least one source episode citation —
anti-hallucination contract enforced at parse time in
`dispatcher/dispatch.rs:2086-2103`, before an approval row is ever created.

## Background jobs

Worker polls SQLite every 3s. Terminal status (`completed`/`failed`)
emits a `companion://job` Tauri event the panel listens to (for
avatar flash + arrival-TTS) and appends a system episode so Athena
reads the result on the next turn. Registered kinds:

- **`scan_codebase`** — the real Dev Tools **context scan** of a project
  (`launch_context_scan`): Claude maps the repo into business-domain
  groups + per-feature contexts (`dev_context_groups` / `dev_contexts`),
  persisting per-file hashes for delta re-scans. Resolves the project by
  id / path / name. (Replaces the earlier shallow file-walk summary.)
- **`connector_use`** — see the **Connectors** section below.
- **`memory_curation_run`** — wraps the consolidation / reflection
  curators as a background-job kind so they don't block the IPC
  caller. `params.scope` is `consolidate` (calls
  `brain::consolidation::run_consolidation`) or `reflect` (calls
  `brain::reflection::run_reflection`). Optional `instructions`
  (≤4096 chars) steers the curator. Concept borrowed from Anthropic
  Managed Agents' dream pipeline; the shape is theirs, the
  implementation is personas's existing curators in a worker context.
- **`night_plan`** (`jobs/night_plan.rs:16`) - composes tonight's bounded
  night-shift plan and emits it as a `night_shift_execute_plan` approval
  card. Judgment-only: it reads goals + backlog + registered projects, makes
  ONE CLI call, bounds the result, and persists a `proposed` plan. **No
  session is spawned here** - dispatch happens only in the approval executor
  after the user confirms.
- **`session_review`** (`jobs/session_review.rs:16`) - the night-shift review
  station. Enqueued when a dispatched session reaches a terminal state;
  gathers read-only git facts, classifies ship-to-branch / park-for-human /
  retry-with-feedback, and lands a `review_verdict` ledger row plus a system
  episode. The morning report rolls the verdicts up into one card.

Orphan recovery: any job in `running` status at startup is marked
`failed` (process restart killed it mid-execution). Terminal rows are
pruned after a 30-day retention window so the queued-lookup query
stays fast as history grows.

## Connectors

Athena's awareness of third-party services is driven by the **pinned
connector list** (the icons at the bottom of the chat toolbar). Two
toggles per connector control what reaches her:

- **Pinned** = the connector is in the sidebar at all.
- **Enabled** = ON in green; OFF in grey. The prompt builder only
  surfaces `enabled = 1` rows.

If the user has *only* Sentry pinned-and-enabled, **only Sentry**
appears in the prompt, only Sentry's slugs are valid for `use_connector`,
and only Sentry's credential is decrypted at job time. The dispatcher
rejects (with a warning) any `use_connector` op pointing at a
not-pinned-or-not-enabled connector. End-to-end, the user's UI
preferences are authoritative — no leakage from disabled connectors.

**Capability registry** (`src-tauri/src/companion/connectors.rs::capabilities_for`,
`:72-251`) maps `service_type` → list of intent-shaped slugs, each carrying a
`requires_approval` flag. Real per-service handlers in
`src-tauri/src/companion/jobs/connector_use.rs`. **Ten service types are
registered as of 2026-09-06** (the 2026-06-16 pass listed four):

| Connector | Read capabilities (auto-fire) | Write capabilities (approval-gated) |
| --- | --- | --- |
| `sentry` | `list_issues` (limit?), `get_issue` (issue_id) | - |
| `github` | `list_repos` (limit?), `list_open_prs` (owner, repo) | - |
| `slack` | `list_channels` | - |
| `gmail` / `google_workspace` | `list_recent_threads` (limit?) | `mark_thread_read` (thread_id), `send_message` (to, subject, body) |
| `discord` | `list_recent_messages` (channel_id, limit?) | `post_message` (channel_id, content) |
| `notion` | `list_pages` (limit?, older_than_days?, query?), `get_page` (page_id) | `delete_page` (page_id) |
| `local_drive` | `list_files` (rel_path?), `count_files` (rel_path?) | `write_text_file` (rel_path, content) |
| `elevenlabs` | `list_voices` | `generate_tts` (voice_id, text, out_rel_path?) |
| `personas_database` (companion brain DB) | `list_tables`, `describe_table` (table_name) | `execute_select` (sql, limit?), `execute_mutation` (sql) |
| `operations_database` (operational store) | `query_operations` (view, days?, limit?, persona?, status?, unread_only?) | - |

`execute_select` is approval-gated despite being SELECT-only: the statement
runs against the whole companion brain and the row guard is a
`starts_with("select")` parse check, so an injected payload could otherwise
exfiltrate memory silently (`connectors.rs:212-227`).

`operations_database` exposes curated, parameterized, row-capped read-only
views over the *operational* store - `executions_recent`,
`cost_by_persona_day`, `messages_inbox`, `reviews_pending`, `incidents`,
`goals_active`, `kpis_latest` (`jobs/operations_views.rs`). No model input is
ever interpolated into SQL.

All handlers:

- Share a 20s HTTP timeout (`HTTP_TIMEOUT`).
- Read credential fields via `credentials::get_by_service_type` +
  `get_decrypted_fields`. The first credential of that service-type
  wins (one-credential-per-service-type is the v1 invariant the
  picker enforces).
- Return chat-friendly markdown, not raw JSON. Upstream errors are
  surfaced as a labeled section ("## Sentry — list_issues failed
  …") with the truncated response body, so Athena can speak to the
  failure on her next turn instead of looping on an opaque error.

Adding a new capability is one match arm in
`connector_use::dispatch_capability` — the credential decrypt + the
prompt-surface plumbing already exist.

> **Open finding (2026-09-06).** The prompt's connector block still teaches
> "**`use_connector` auto-fires** - no approval card, no click"
> (`prompt/capabilities.rs:213-220`), which stopped being true when
> per-capability gating landed. A write capability she proposes will park as
> an approval card, and nothing in her prompt says so. The *unregistered*
> half of the older wired-vs-stub gap is closed: a pinned connector with no
> entry in `capabilities_for` is now surfaced as "capability set isn't
> registered yet - don't propose a `use_connector` call"
> (`prompt/capabilities.rs:236-243`).

## Memory tiers

Five persistence surfaces all keyed off the same `companion_node`
schema; each tier owns a sidecar table for kind-specific fields and a
`companion_provenance` table linking back to source episodes.

- **Episodic** — append-only conversation turns + agent events. Source
  of truth on disk at
  `~/.personas/companion-brain/episodes/<YYYY>/<MM>/<DD>/<id>.md`.
  Never deleted; everything else points back.
- **Semantic** — facts about user, project, world (scoped). E.g.
  "Michal lives in Prague", "this repo's main branch is `master`".
- **Procedural** — behavioral rules (scoped: chat, action, memory,
  build). E.g. "when summarizing a long doc, lead with the
  one-sentence punchline".
- **Doctrine** - read-only allowlist of **24** architecture docs (this
  doc included), `include_str!`-compiled at
  `brain/doctrine.rs:103-201`. Chunked by H2 headings, embedded with
  `AllMiniLML6V2Q` (384-dim), retrieved per-turn into a separate
  context budget so Athena can quote the canon without needing it
  hard-coded in the prompt.
- **Identity** — `identity.md`. The single profile of "who is the user
  to Athena right now" that grows turn-over-turn.

Auxiliary: **goals** (active/paused/completed/abandoned, priority 1–5,
optional `target_date`), **rituals** (quiet_hours / cadence /
focus_window), **backlog** (self_promise commitments + capability_gap
items Athena spotted).

## Proactive nudges

Scheduler runs every 5 minutes. Trigger kinds:

**Brain-state triggers** (subject to daily budget):

- **`goal_target_approaching`** — active goal with `target_date`
  within 24h, not completed.
- **`backlog_aging`** — self_promise older than the current
  reminded-tier threshold (escalates: 1d → 3d → 7d).
- **`cadence_due`** — ritual with schedule matching "now" (firing
  window `[at, at+duration_min)`, no midnight wrap, optional
  day-of-week whitelist).
- **`on_this_day`** — episode/reflection from the same calendar day
  30 / 90 / 365 days ago, scored against active goal mentions for
  affinity.
- **`ambient_match`** (`desktop` feature) — reads the rolling ambient
  context window and runs each signal through the
  `ContextRuleEngine`. Each match becomes a Nudge keyed on `rule_id`,
  with the engine's per-rule cooldown layered on top of dedupe.
- **`dev_goal_target` / `dev_goal_stalled`** (`proactive/triggers.rs:262,279`)
  - a Dev Tools goal approaching its target date, or one that has stopped
  moving. The whole `dev_goal*` family shares a daily cap of 2
  (`proactive/budget.rs:38-40`).

**Fleet attention triggers** (read in-process fleet registry, no DB
hit, `proactive/fleet_triggers.rs`):

- **`fleet_failed`** - session exited with non-zero exit code (or died
  abnormally) within the last 10 minutes.
- **`fleet_stale`** — session reached `Stale` state (no activity for
  5+ min).

> `fleet_awaiting` and `fleet_stuck_dispatched` are **retired** - neither
> string exists anywhere in `src-tauri/src` as of 2026-09-06. `AwaitingInput`
> sessions are now owned by `fleet_bridge::orchestrate_on_awaiting`, which
> reads the session's real screen and answers or consults with a
> recommendation instead of asking permission to look
> (`proactive/fleet_triggers.rs:12-20`). `Finished` sessions are owned by
> `fleet_bridge::notify_completion`, which announces per operation.

**Other in-app triggers**:

- **`execution_review`** (`proactive/execution_review.rs:883`) - a finished
  persona execution turned into a review turn. Daily cap 4.
- **`incident_blocker`** (`proactive/incident_triggers.rs:78`) - daily cap 6.
- **`message_digest`** / **`message_attention`**
  (`proactive/message_triage.rs:45,50`) - the aggregated inbox card and the
  per-message escalation. Caps 4 and 8.
- **`night_shift_report`** (`night_shift/mod.rs:592`) - the morning rollup.
- **`dev_interrupted`** (`dev_mode.rs:575`) - a dev-mode run that stopped
  mid-flight.
- **`fleet_orchestration`** (`commands/companion/fleet_bridge.rs:2007`).

**Direct-source triggers** (bypass budget gate, still dedupe):

- **`fleet_op_completed`** (D6) — reconciler writes one of these per
  `dispatched_by_athena` op when every session has reached terminal
  state. Surfaces as the cross-session wrap-up.
- **`athena_scheduled`** — Athena's own `schedule_proactive`
  commitments held in `queued` until `scheduled_for` arrives, then
  released by the same `release_pending` sweep as everything else.

### Delivery lifecycle — noticing vs delivering

Evaluating triggers and delivering nudges are **two separate steps**, and
every tick runs both:

1. **Notice** (`evaluate_with_extra_candidates`) — trigger candidates are
   deduped against any unresolved row for the same `(trigger_kind,
   trigger_ref)` and inserted as `queued`. This spends no budget, so an
   observation made on a busy day is never simply lost.
2. **Deliver** (`release_pending`) — the one path from `queued` to
   `delivered`. It sweeps the lifecycle, then walks every deliverable
   `queued` row oldest-first (trigger-driven and `athena_scheduled`
   alike), claims a budget unit per row, marks it `delivered`, and hands
   the result to the caller to emit.

A `queued` row therefore always resolves one way or the other:

| Waiting for | Aged to `expired` after | Why |
| --- | --- | --- |
| A delivery slot (trigger-driven) | 1 day | A nudge describes *now*. Rather than replaying day-old text, the row is retired — which unblocks its dedupe, so the trigger restates the case with fresh data on the next pass, or stays silent if the condition resolved itself. |
| Its `scheduled_for` moment (`athena_scheduled`) | 7 days past due | An explicit commitment has no re-fire path, so it gets far more grace — but a months-late "I'll check back in 10 minutes" is still noise. |
| The user (`delivered`, never engaged/dismissed) | 7 days | Unblocks the dedupe and makes the row prune-eligible. |

Gating: **quiet_hours** blocks delivery during active windows (noticing
continues; the rows release when the window closes); the **daily budget**
is a global ceiling of 12 (`proactive/budget.rs:23`) plus a per-trigger-kind
cap - 2 for `dev_goal*`, 4 for `execution_review` / `message_digest`, 6 for
`incident_blocker`, 8 for `message_attention`, 3 for anything unlisted, and
uncapped for `athena_scheduled` (`budget.rs:31-48`) - so one noisy leg can't
crowd out the others; a kind at its cap only defers *its own* rows, never the
kinds behind it. Those per-kind caps are then modulated ±1 by how the user
actually responds to that kind over 30 days, with a five-sample floor
(`budget.rs:56-78`). **Dedupe** allows one nudge per
`(trigger_kind, trigger_ref)` until that row resolves.

Each delivery emits a `companion://proactive` Tauri event. If voice is
enabled, the panel speaks the nudge body immediately (arrival-TTS) —
regardless of whether the chat is open. Resolution: user clicks
through → `engaged` (engagement on a `backlog_aging` nudge bumps the
backlog item's `reminded_count` to ratchet future delivery cadence
down); user dismisses → `dismissed`.

## Voice

Two engines, picker in **Plugins → Companion → Voice**. Both are local
sherpa-onnx sidecar inference - no credential, no network at synth time
(`companion/tts/mod.rs:9-17`):

- **Kokoro** (primary) - a single ~310MB model with curated
  high-quality voices. Installed via the in-app catalog browser into
  `~/.personas/companion-tts/bin/`.
- **Pocket TTS** (experimental) - zero-shot voice cloning.

> **ElevenLabs and Piper were descoped 2026-07-10** (`tts/mod.rs:11-13`) -
> two local engines cover the quality × cloning space without a cloud bill
> or a per-voice download UX. ElevenLabs survives only as a *connector*
> (`list_voices` / `generate_tts`), not as Athena's own speech engine.
> Speech input is a separate stack: Whisper STT under `companion/stt/`.

**Two playback paths:**

1. **Send-flow TTS** — when the user sends a message and Athena emits
   a `TTS:` line in her reply, the panel synthesizes that spoken
   summary and auto-plays it. Footer "🔊 Play it again" replays.
2. **Arrival-TTS** — when a *new* message lands without the user
   asking (proactive nudge, background-job system episode), the
   always-mounted panel listener strips markdown and speaks the body.
   Works even when the chat is collapsed.

If voice is on, Athena is also instructed to write her **chat-bubble
text** in a tighter, skimmable format (short sentences, lean on QR
chips) — the assumption being that the spoken summary carries the
nuance, the visual is the scannable index.

## Athena as an MCP server (Direction 3)

Beyond the built-in tools Athena has *as a Claude session*, she
also **exposes** five tools to *other* Claude Code sessions (the
fleet workers) via MCP. Claude Code sessions discover Athena via
`--mcp-config <file>` at spawn time, pointing at her HTTP endpoint
(`/mcp/rpc`, JSON-RPC 2.0, same axum server that hosts
`/fleet/hooks/*`). Per-session tokens are minted at spawn time and
threaded via the `X-Athena-Session` header.

The five tools - definitions in
`src-tauri/src/companion/orchestration/mcp/handlers.rs::tool_descriptors`
(`:20`), dispatched at `:148-152`:

| Tool | Effect | Blocking |
| --- | --- | --- |
| **`athena.report_intent`** | Claim or join an Operation; set role + intent string. Replaces the auto-generated "user spawn in <project>" label in Athena's prompt digest. Optional `operation_id` joins an existing op. | No |
| **`athena.checkpoint`** | Append progress / optional blockers to operative memory. Athena uses this to decide whether to pre-empt with guidance. Don't call on every tool use — the hook layer covers that. | No |
| **`athena.request_guidance`** | Ask Athena a question and **block** until she answers. Surfaced in the chat panel as a pending request; Athena sees the session's intent/checkpoints/recent failures in context. | **Yes** |
| **`athena.request_approval`** | Propose a destructive / cost-bearing action and **block** until the user approves or denies via an ApprovalCard. | **Yes** |
| **`athena.report_tool_defect`** | The bug-report path for agents: report a tool whose schema was ambiguous, whose result contradicted its description, or that failed without explaining itself. Lands in the incidents inbox a human reads. Its `error_kind` enum is generated from `ToolErrorKind::ALL` so the advertised vocabulary cannot drift from what `tool_execution_audit_log.error_kind` stores. | No |

Blocking handlers register a pending request, emit a Tauri event, and
await a oneshot. Resolution comes back through the
`companion_mcp_resolve_request` Tauri command. The MCP layer is what
turns hooks (passive, one-way) into a real conversation between the
workers and Athena.

## Operative memory (orchestration digest)

A **live**, in-process working set of fleet operations — distinct
from `brain/` (long-term episodic + semantic memory). Tracks:

- **Operations** — a unit of intent with one or more sessions
  attached. Created by `fleet_dispatch` (Athena-dispatched) or by an
  ad-hoc spawn (session reports intent → auto-create).
- **Sessions per op** — each session's role, intent, checkpoints,
  recent failures, intervention status.
- **Mutations** - the frontend re-pulls the digest via
  `companion_get_operative_memory_digest`
  (`commands/companion/fleet_bridge.rs:2404`).

> **Change signal (verified 2026-09-06).** Every mutation of operative memory
> calls `orchestration::emit_digest_changed`
> (`src-tauri/src/companion/orchestration/mod.rs:35`), which emits
> `athena://orchestration/digest-changed` with no payload. Callers include
> `companion_record_fleet_event` (`commands/companion/fleet_bridge.rs:155,164`)
> and the fleet, dev, knowledge and night executors under
> `commands/companion/approvals/`. The frontend listener
> (`src/features/plugins/companion/orchestration/useOperativeMemoryBridge.ts:75`)
> debounces 250 ms and refetches the digest rather than applying a delta.

The digest is appended to Athena's prompt every turn under
observability. Empty string for users not using fleet.
Evaporates on app restart by design — long-term memory is in
`brain/`.

## Plugin toggles

A "plugin" here is a contextual capability the user toggles **on**
so Athena becomes aware of it and can lead the user through using
it. Distinct from connectors (external credentials).

- **`dev_tools`** — codebase scan / idea generation / task
  batching / projects state. Toggle on → prompt builder appends an
  awareness block; toggle off → Athena loses that awareness next
  turn. New plugin slugs slot into `plugins::PLUGIN_*` constants.

## Project registry

Repos/projects Athena's Dev Tools knows about. The Personas repo is
seeded on first run so "list projects" and "scan project X" work
out-of-the-box. Each row: `{ id, name, path, description,
last_scan_at, last_scan_summary }`.

Surface for Athena:

- **`register_project`** (approval-gated) — add a project by name + path.
  Creates the real Dev Tools project (`dev_projects` row), which makes the
  **codebase connector** available to any team adopted for that repo, and
  auto-launches a context scan for the new project. One action = repo ready
  for a team.
- **`enqueue_dev_job`** (approval-gated) — `kind:"scan_codebase"` runs the
  **real context scan** (`launch_context_scan` → Claude maps the repo into
  context groups + contexts), resolving the project by id / path / name. This
  is the precise "scan / map / index / analyze the codebase" operation.

**Scan ≠ build.** A scan request (even "scan repo X for bugs and tests") is a
context scan via `enqueue_dev_job`, NOT a `build_oneshot`. Athena's prompt
explicitly forbids answering a scan with an agent build; bug-and-test review is
the SDLC team's Code Reviewer / QA job, so she points at that team rather than
spinning up a new persona.

## Per-turn UI side-channel events

Beyond `STREAM_EVENT` (raw stream-json chunks), `APPROVALS_EVENT`,
and the navigation events (`NAVIGATE_EVENT`, `OPEN_LAB_EVENT`,
`COMPOSE_DASHBOARD_EVENT`, `COMPOSE_COCKPIT_EVENT`, `CHAT_CARDS_EVENT`,
plus the newer `GUIDE_EVENT`, `EXPLAIN_COCKPIT_EVENT`,
`COMPOSE_CANVAS_PANEL_EVENT`, `CANVAS_CONTROL_EVENT`,
`CLIENT_ACTION_EVENT` and `REMOTE_JOB_TURN_EVENT` - full list at
`session/events.rs:12-126`),
the session emits two glanceable rollups per turn that the panel uses
to render thin info strips:

- **`companion://recall-preview`** (`RECALL_PREVIEW_EVENT`) — fires
  once per turn, right after the prompt is built and right before
  the CLI spawn. Payload is `{ sessionId, turnId, preview }` where
  `preview` carries episode count + (id, title) entries for each
  consulted memory kind (doctrine, facts, procedurals, goals,
  backlog) plus a `synthesized` flag (was the synthesis layer hit?).
  Renders as "Athena consulted N memories" above the streaming
  bubble.
- **`companion://turn-summary`** (`TURN_SUMMARY_EVENT`) — fires once
  after the dispatcher block, keyed on the persisted assistant
  episode id. Carries counts of approvals filed, navigations,
  lab_opens, dashboards, cockpits, chat_cards, plus a `continuation`
  flag (Athena emitted `continue_autonomously`).

Both are session-scoped UI only — no persistence, no replay across
panel reload.

## Tools Athena has direct access to

Athena runs inside a Claude Code CLI session with
`--dangerously-skip-permissions`. Her prompt's tools-addendum tells
her she has these built-ins (replacement of the default Claude Code
prompt would otherwise hide them):

- **`WebSearch`** — live web search. Use when the answer needs
  post-2026 information, current library docs, or facts not in
  training data.
- **`WebFetch`** — pull a specific URL the user gave her.
- **`Task` (subagent dispatch)** — spawn one of the four
  Athena-specific subagents defined in `.claude/agents/`. Each is
  pre-scoped to a narrow job:
  - `athena-persona-auditor` — read a persona's runs/artifacts,
    return failure-pattern summary
  - `athena-backlog-scout` — surface candidate backlog items from
    recent episodes + executions, with provenance
  - `athena-doc-reader` — read a docs/code excerpt without polluting
    her own context
  - `athena-web-researcher` — synthesize WebSearch+WebFetch results
    with source URLs

Subagent dispatches use `CLAUDE_CODE_FORK_SUBAGENT=1` (set on the CLI
spawn) so they inherit Athena's full conversation history cheaply via
shared prompt cache.

## Cockpit composition (Athena leads operational explanations)

When Athena wants to explain something operational rather than reply
in prose, she composes a **cockpit** via `OP: compose_cockpit` —
auto-fire, persisted server-side, panel navigates to **Home →
Cockpit**. Widget kinds (frontend registry):

Registry: `src/features/home/sub_cockpit/widgetRegistry.ts` (the path in the
2026-06-16 pass, `home/components/cockpit/`, no longer exists).

| Kind | Use case |
| --- | --- |
| `persona_overview` | Roster grid — which personas exist, recent activity |
| `connected_services` | Pinned connector list with health pills |
| `decisions_panel` | Pending approvals + critical attention items |
| `metric_spark` | Single KPI tile with optional delta + trend |
| `issue_list` | Bulleted item rows with severity badge + external link |
| `text_callout` | Narrative panel with markdown body and intent accent |
| `verdict` | The answer card - headline + reasoning + caveat, with chips that resolve the pending orb decision |
| `flow_steps` | Causal / sequence chain with a drawing connector rail |
| `comparison_cards` | Options side by side with pros / cons / recommended |
| `timeline` | Chronological events with relative timestamps |
| `stat_grid` | 3 to 6 labeled figures in a tile grid |
| `log_excerpt` | Monospace evidence block with highlighted lines |

The six "Explain in Cockpit" kinds (2026-06-10) are emitted via
`explain_in_cockpit` as an ephemeral contextual overlay and are also valid in
`compose_cockpit`. Every chat-card kind in the section above
(`persona_walkthrough`, `template_suggestions`, `use_case_set`,
`trigger_set`, `model_tier_choice`, `observability_plan`, `decision_log`,
`persona_ready`, `design_capabilities`, `recent_decisions`,
`browser_test_report`, `persona_creation_offer`, `walkthrough_offer`) is
registered here too, since chat cards and cockpit widgets share one registry.
Four further kinds (`message_summary`, `execution_facts`, `linked_decisions`,
`linked_memories`) are composed programmatically by other surfaces and are
**not** Athena-emittable.

The nine generic kinds are populated from her own
reasoning (no per-widget data fetch). The constitution's
`compose_cockpit` section directs her to **prefer composing a cockpit
over dumping connector results into chat prose** when the result is
more than a few items.

## What Athena does *not* do (yet)

Honest negatives keep the prompt from claiming capabilities she can't
deliver. As of this session, the list is shorter:

- **Always-on / app-quit persistence** — the daemon binary
  (`personas-daemon`) scaffolding exists and its companion-jobs worker
  is now `AppHandle`-decoupled via `JobEventSink`, but the binary
  doesn't actually run the job worker yet - verified 2026-09-06, the word
  `companion` appears nowhere in `src-tauri/src/daemon_bin.rs`, which runs
  the trigger scheduler and headless persona executions only. When the
  desktop app quits,
  in-flight jobs are marked `failed` on next startup and scheduled
  proactive nudges don't fire.
- **Mid-stream continuation past 20 ticks** — autonomous chains hard-
  cap at 20 consecutive turns. Beyond that the chain stops and waits
  for fresh user input. Tunable, not infinite.
- **Persistent state across `companion_reset_conversation(true)`** —
  reset wipes the SQL transcript + CLI session pointer. The disk
  episodes survive (Markdown files), but the brain's index loses
  continuity until next ingest.
- **External APIs beyond the ten registered service types** - anything
  pinned whose `service_type` has no arm in `capabilities_for` returns the
  v1 stub. Her prompt now says so explicitly rather than promising a fetch
  (`prompt/capabilities.rs:236-243`). Adding one = one match arm in
  `connector_use::dispatch_capability`.

## Source map

Paths re-verified 2026-09-06. The former single-file `dispatcher.rs`,
`prompt.rs` and `session.rs` are all module directories now.

| Concern | File |
| --- | --- |
| Op allow-lists (`ALLOWED_ACTIONS`, `READ_OPS`, routes, lab modes, topics, anchors) | `src-tauri/src/companion/dispatcher/catalog.rs` |
| Op parsing + per-op dispatch arms (`continue_autonomously`, chat cards, canvas, guidance) | `src-tauri/src/companion/dispatcher/dispatch.rs` |
| Approval-row insert + rejection episodes | `src-tauri/src/companion/dispatcher/approvals.rs` |
| Read-op renderers + budgets | `src-tauri/src/companion/dispatcher/read_ops.rs` |
| Prompt builder (compose, addenda, recall, capabilities, budget) | `src-tauri/src/companion/prompt/` (`compose.rs`, `addenda.rs`, `capabilities.rs`, `recall.rs`, …) |
| Constitution (op grammar reference, v61) | `src-tauri/src/companion/templates/constitution.md` (version pin: `templates/mod.rs:508` `CONSTITUTION_VERSION`) |
| Session runtime (turn lifecycle, interrupt, continuation scheduler) | `src-tauri/src/companion/session/` (`turn.rs`, `autonomy.rs`, `interrupts.rs`, `origin.rs`, `events.rs`, `cli.rs`) |
| Approval executors (one file per family) | `src-tauri/src/commands/companion/approvals/` (`approval_lifecycle.rs` is the dispatch table; `approval_exec_{core,fleet,dev,ship,canvas,knowledge,devices,night}.rs`) |
| Autonomous auto-resolve (no allowlist; boldness dial + device rule) | `src-tauri/src/commands/companion/approvals/approval_autopilot.rs` |
| Background-job worker (`JobEventSink`, scan/connector/curation/night) | `src-tauri/src/companion/jobs/` |
| Connector capability registry + real handlers | `src-tauri/src/companion/connectors.rs`, `jobs/connector_use.rs`, `jobs/operations_views.rs` |
| Memory tiers | `src-tauri/src/companion/brain/{episodic,semantic,procedural,doctrine,identity}.rs` |
| Proactive scheduler | `src-tauri/src/companion/proactive/` |
| Night shift (plan / dispatch / review / morning report) | `src-tauri/src/companion/night_shift/` |
| MCP server (tool descriptors, blocking requests) | `src-tauri/src/companion/orchestration/mcp/` |
| Worker cadences (job worker 3s, proactive tick 5min) | `src-tauri/src/commands/companion/mod.rs:83-89` |
| Chat panel + arrival-TTS + Stop button + autonomous toggle | `src/features/plugins/companion/chat/AthenaChatPanel.tsx`, `CompanionSidePanel.tsx` |
| Avatar (5-clip state machine) | `src/features/plugins/companion/AthenaAvatar.tsx` |
| Cockpit + chat-card widget registry | `src/features/home/sub_cockpit/widgetRegistry.ts` |
| Subagent catalog (Task tool definitions) | `.claude/agents/athena-*.md` |

When in doubt: this doc gets out of date. `dispatcher/catalog.rs`, the
capability registry, and `prompt/compose.rs` are the ground truth.

## Capability inventory — for tests + optimization passes

A flat, grouped list of every Athena-driven capability shipping on
`master`. Use this as the test matrix; each row should have at least
one happy-path scenario and (where applicable) one rejection scenario.
Numbers in brackets indicate the constitution version that introduced
the op (current: **v61**, `templates/mod.rs:508`). Ops whose introducing
version isn't pinned in source are marked `[post-v18]`.

### A. Op grammar (chat-emitted JSON envelopes)

**A1. Auto-fire UI navigation** — no approval card, fires on parse:

- `open_route { route }` - sidebar nav. Allowlist of **11** routes
  (`catalog.rs:371-392`), including the pseudo-routes `monitor` and
  `mastermind`.
- `open_lab { persona_id, mode }` - persona editor + lab mode. 7 modes
  (`catalog.rs:354-362`).
- `compose_dashboard { title, widgets[] }` — persists + navigates to
  Companion → Dashboard. Rejects an empty `widgets` array.
- `compose_cockpit { title, widgets[] }` — persists + navigates to
  Home → Cockpit. See the widget table above.
- `explain_in_cockpit { ... }` [post-v18] - composes an ephemeral
  explanation overlay into the Cockpit (the "Explain-in-Cockpit" flow).
- `compose_canvas_panel { slug, spec }` [post-v18] - docks a composed
  SurfaceSpec onto a Mastermind canvas island. Rejects a `demo-*` or
  invented slug and any spec that is not a v1 envelope with blocks.
- `canvas_control { ... }` [post-v18] - reversible canvas VIEW state
  (band, camera). Capped per turn; the settled result comes back as a
  System episode via `companion_canvas_control_result`.
- `start_guided_walkthrough { topic }` - 6 topics (`catalog.rs:394-401`).
- `point_at { anchor }` / `compose_walkthrough { title?, steps[] }` -
  orb guidance against the code-generated anchor allow-list
  (`generated_anchors.rs`); 2 to 6 steps (`catalog.rs:412-413`).
- `compose_tour { ... }` [post-v18] - a full persisted generative tour;
  an unknown anchor / sidebar section / sub-tab setter rejects the WHOLE
  tour.
- `continue_autonomously { rationale }` — autonomous-mode only;
  schedules next tick.

**A2. Auto-fire chat cards** — `propose_action`, no approval card,
renders inline:

- `show_persona_overview { config }`
- `show_connected_services { config }`
- `show_decisions { config }`
- `show_recent_decisions { persona_context, limit }`
- `show_design_capabilities { intro? }` [v17]
- `show_persona_walkthrough { intent, content }` [v9]
- `show_template_suggestions { intent, limit }` [v10]
- `show_use_case_set { intent, use_cases[] }` [v11]
- `show_trigger_set { intent, triggers[] }` [v12]
- `show_model_tier_choice { intent, recommended, tiers[] }` [v13]
- `show_observability_plan { intent, error_handling, success_metric }` [v14]
- `show_decision_log { intent, decisions[] }` [v15] — also persists to
  `companion_design_decision`
- `show_persona_ready { intent, recommended_action, summary }` [v16]
- `show_browser_test_report { url, steps[] }` [post-v18] — renders the
  verdict card for a `run_browser_test` run (per-step pass/fail).
- `show_persona_creation_offer { intent }` [post-v18] — inline "want me
  to build this?" offer when the user describes a persona in passing.
- `show_walkthrough_offer { topic, summary? }` [post-v18] - offers to start
  the guided walkthrough rather than emitting it unprompted.
- `show_fleet_plan { operation_intent, rows[] }` [post-v18] - editable
  multi-session dispatch plan; every row is containment-checked with
  `validate_fleet_cwd` at render time. Fails closed without the system DB.
- `show_ship_milestone { project_slug, name, goal, ... }` [post-v18] -
  editable milestone-cut proposal; every member id resolved against the
  real registry here.
- `show_ship_goals { milestone_id, goals[], note_id? }` [2026-08-25] - the
  only card op that can CREATE a goal rather than bind an existing one.
- `show_note_suggestions { note_id, rows[] }` [2026-09-05] - proposed edits
  back into one Notepad note. Fails closed without the app database.

**A3. Connector calls** - gated per capability, not per op:

- `use_connector { connector_name, capability, args }` — validates
  (pinned + enabled) and (capability in registry) before proceeding.
  Read-only capabilities auto-fire as a background job; write / mutation
  capabilities (`requires_approval: true`) route through an approval card.
  A rejection writes a System episode telling Athena her op produced no
  job, so she surfaces the gap instead of silently re-emitting
  (`dispatcher/approvals.rs:14-39`).

**A4. Approval-gated — personas / build / lab**:

- `run_persona { persona_id, input? }`
- `prefill_persona_create { intent, name?, auto_launch, mode }`
- `build_oneshot { intent, name? }` [2026-05-06; server-side since 2026-05-26]
  — autonomous "decide everything for me" build. On approve, `execute_build_oneshot`
  now creates the draft persona and starts a **headless one-shot build session
  server-side** (`build_session_manager.start_session`, `mode="one_shot"`), then
  returns a `Navigate` client action so the user can watch. It no longer relies
  on the create screen being mounted to consume a prefill+`auto_launch` (which
  silently never built when the user was looking at the chat). The one-shot
  build runner also (a) auto-continues past any clarifying question instead of
  blocking on a human answer, and (b) ignores connector-credential ambiguity
  (no picker to answer), so the build reaches `promoted` unattended. Interactive
  `prefill_persona_create` is unchanged (still opens the screen for review).
- `run_arena { persona_id, models[], use_case_filter? }`
- `companion_breed_personas { ... }` [post-v18] — headless genome breed.
  The Lab descoped Breed/Evolve from the UI (consolidated Versions &
  Ratings table), so Athena is now the **only** surface that drives them.
- `companion_evolve_persona { ... }` [post-v18] — headless genome evolve.
- `run_browser_test { project_id?, scenario? }` [post-v18] — live browser
  test of a dev project's configured `test_env_url`. Doubly gated: spawns a
  CLI reasoning turn **and** drives a real browser via Playwright MCP
  (clicks/navigation/input on the user's machine). Emits
  `show_browser_test_report` on completion.

**A5. Approval-gated — reviews**:

- `resolve_human_review { review_id, decision, comment? }`

**A6. Approval-gated — memory & identity** (provenance contract: every
`write_fact`/`write_procedural` must have a non-empty `sources` array
or the dispatcher rejects at parse time):

- `update_identity { content }`
- `write_fact { scope, key, value, sources[], importance, confidence, supersedes_id? }`
- `delete_fact { id }`
- `write_procedural { scope, trigger, behavior, sources[], importance, confidence, supersedes_id? }`
- `delete_procedural { id }`
- `write_goal { title, description, priority, target_date? }`
- `update_goal_status { id, status }`
- `delete_goal { id }`
- `write_ritual { kind, description, schedule }`
- `set_ritual_active { id, active }`
- `delete_ritual { id }`
- `write_backlog_item { kind, summary, source_episode_id }`
- `resolve_backlog_item { id, dropped }`

**A7. Approval-gated — future commitments**:

- `schedule_proactive { message, when_iso }` [v8]

**A8. Approval-gated — projects, dev jobs, goals + KPIs**:

- `register_project { name, path, description? }`
- `enqueue_dev_job { kind, project_id?, params? }` — currently only
  supports `scan_codebase`. **Registry source-of-truth note (2026-06-16
  fix, still current):** the prompt's dev-tools registry is sourced from the
  real `dev_projects` table (via
  `prompt/capabilities.rs::dev_tools_registry_for_prompt`, `:21`),
  **not** the companion's drifted `companion_known_project` table — which
  previously caused Athena to name phantom worktrees/duplicates when
  asked to "rescan all Dev Tools projects." Job matching counts a
  normalized `root_path` match, not just id/name.
- `enqueue_runner_task { ... }` [post-v18] - queue work on the Dev Tools
  Run Desk, the second execution lane. Containment through the registered
  dev project.
- `open_test_env { project_id? }` [post-v18] — opens a registered
  project's configured test-environment URL (`OpenExternalUrl` action).
- `update_dev_goal { goal_id, progress?, status? }` [post-v18] — propose
  a dev-goal progress/status change against the Goals hub.
- `propose_kpi { ... }` / `scan_kpis { ... }` / `evaluate_kpi { ... }` /
  `calibrate_kpi { ... }` [post-v18] — the KPI layer (outcome steering
  above goals). All four are approval-gated because they change what the
  autonomous loop optimizes for or incur measurement cost: `propose_kpi`
  configures one KPI from a guided conversation; `scan_kpis` proposes a
  new set (an LLM scan); `evaluate_kpi` measures one now (a real run);
  `calibrate_kpi` adjusts a KPI's target/date/tier/cadence/warn-critical
  lines (the lever that decides when a goal gets derived).

**A9. Approval-gated — fleet + team orchestration (Phase J / C3)**:

- `fleet_send_input { session_id, text, press_enter? }`
- `fleet_broadcast { target, text, ids?, press_enter? }` (target ∈
  `all_waiting | all | ids`)
- `fleet_kill { session_id }`
- `fleet_spawn { cwd, args?, cols?, rows? }`
- `fleet_dispatch { operation_intent, role_specs[] }` — D5 v2; ≤8
  sessions per op
- `fleet_intervene { session_id, message }` — D9; capped at 1 per
  session
- `fleet_redirect_op { op_id, new_intent, message? }` — D9
- `fleet_wake { session_id }` [post-v18] - Phase 4; revive a hibernated
  session via `--resume`. Fails closed on a bad target.
- `fleet_resume { ... }` [post-v18] - Phase 4; adopt an orphaned CLI
  process the registry lost.
- `assign_team { team_id, goal, title? }` [post-v18] — C3 team-assignment
  dispatch ("have the X team handle Y"). Spawns multiple persona
  executions in parallel; approval body is the proposed step list.
- `analyze_fleet { ... }` [post-v18] — manually-requested "how are the
  teams doing?" review. Spawns a proactive Athena reasoning turn over the
  fleet (executions, outcomes, Director verdicts, goal progress) on the
  certification rubric; writes a per-team timeline note + proposes
  improvements.

**A10. Approval-gated - Ship, canvas, knowledge, devices, dev mode**
(all added after the 2026-06-16 pass; `catalog.rs`):

- `set_ship_scope { ... }` [2026-08-20] - move Ship milestone members
  between core / later / never, or drop them.
- `ship_milestone_lifecycle { ... }` [2026-08-20] - cut (freezing the
  scope) or ship. The SHIP transition carries its own DB-checkable
  precondition in `approval_exec_ship.rs`.
- `canvas_dispatch { ... }` / `canvas_group_dispatch { ... }` /
  `canvas_run_idea_scan { ... }` [post-v18] - WP2; slug-resolving wrappers
  onto the existing fleet executors. Group dispatch is sequential and
  capped; a `demo-*` island resolves to nothing real and is refused.
- `skill_sync { ... }` [2026-08-10] - move ONE skill between the workspace
  library and project copies (adopt / sync / publish). Customized copies
  are never overwritten; publish must be a version bump
  (`approval_exec_knowledge.rs`).
- `run_pattern_harvest { ... }` [2026-08-10] - per-territory Fleet harvest
  sessions into a workspace member repo; results land `observed` for human
  review.
- `apply_pattern { ... }` [2026-08-10] - one session that implements
  ADOPTED patterns (or an active playbook) in a target repo. Applying
  *observed* proposals is refused, so Athena can never become the adopter.
- `evaluate_pattern { ... }` [2026-08-10] - the existing
  adoption-verification pass over a target project; verdicts land through
  the verify lane's evidence door, and the surface never auto-un-adopts.
- `remote_instruct { ... }` [WP3] - hand an instruction to another paired
  device of the user's own, where that device's Athena runs it as a real
  turn. Consent rule is mode-conditional and lives in
  `approval_exec_devices.rs::gate_remote_instruct`; the executor answers
  honestly when the P2P transport is absent from the build.
- `dev_improve { ... }` / `dev_merge { ... }` - dev mode only (debug build
  **and** `companion_dev_mode`; the executors refuse otherwise). Never
  auto-fire per user policy.
- `backlog_apply_triage { items[] }` [WP2] - a durable batch of accept /
  reject verdicts over selected `dev_ideas`. Produced by the Backlog's
  "Send to Athena" button, not emitted by Athena from chat today. Rejected
  at parse time if `items` is empty.

**A11. Read ops** - auto-fire, read-only, bounded System-episode answer
(`catalog.rs:221-274`; see the Read-only lookups section):

- `describe_persona`, `describe_context`, `describe_skill` - detail for an
  entity whose always-on prompt index is truncated.
- `list_teams` - teams are absent from the index entirely, and
  `assign_team` needs a `team_id`.
- `describe_canvas_project`, `describe_canvas_freshness` - the full
  fifteen-cell detail for one Mastermind island, and the freshness /
  rollup layer the scene digest compresses away.
- `list_runner_tasks` - what is queued or running on the Dev Runner lane
  (the other execution lane, previously invisible to her).
- `describe_skill_fleet`, `describe_knowledge` - skill versions per repo
  (what `skill_sync` acts on) and the workspace knowledge library (what
  the pattern ops act on).
- `describe_ship_milestone` - the live cut, its buckets, the operator's
  notes and ratings, and the bound goals. 6,000-char budget; deliberately
  does not restate the exit-criteria verdicts, which derive client-side.
- `describe_brain_health` - counters plus the single first blocking cause
  of empty recall, with its fix, so "I don't know why I don't remember" is
  an available answer (`brain/health.rs`).
- `describe_note` [2026-09-05] - one Notepad note plus the project's OPEN
  milestone (the `milestone_id` `show_ship_goals` needs). 6,000-char budget.

**A12. Reply-shaping helpers** (stripped from display, transient):

- `TTS: "..."` — spoken summary line; first wins per turn
- `QR: ["..."]` — up to 6 quick-reply chips
- `PROGRESS: ...` [post-v18] — conversational in-turn beats. Each beat is
  persisted as its own slim "aside" assistant message (rendered dim,
  `data-testid="companion-bubble-aside"`) **before** the final reply, so a
  multi-step or long-composition turn streams progressively instead of
  landing as one silent block. Non-final cleaned CLI segments are also
  surfaced as interim messages (Phase B); the last segment is the reply.

### B. MCP server tools (Athena exposes to fleet workers)

| Tool | Blocking | Endpoint | Schema |
|---|---|---|---|
| `athena.report_intent { intent, role?, operation_id? }` | No | `/mcp/rpc` | `tool_descriptors()` |
| `athena.checkpoint { progress, blockers? }` | No | `/mcp/rpc` | same |
| `athena.request_guidance { question, context? }` | **Yes** | `/mcp/rpc` | same |
| `athena.request_approval { action, rationale, details? }` | **Yes** | `/mcp/rpc` | same |
| `athena.report_tool_defect { tool_name, defect, error_kind? }` | No | `/mcp/rpc` | `report_tool_defect_descriptor()` (enum generated from `ToolErrorKind::ALL`) |

### C. Connector capabilities (real handlers in `connector_use.rs`)

Gating column is the capability's `requires_approval` flag
(`connectors.rs:72-251`). Read-only slugs auto-fire through the background-job
worker; approval slugs file a card.

| Connector | Capability | Required args | Gating |
|---|---|---|---|
| `sentry` | `list_issues` | `limit?` (default 10) | read-only |
| `sentry` | `get_issue` | `issue_id` | read-only |
| `github` | `list_repos` | `limit?` (default 20) | read-only |
| `github` | `list_open_prs` | `owner, repo` | read-only |
| `slack` | `list_channels` | (none) | read-only |
| `gmail` / `google_workspace` | `list_recent_threads` | `limit?` (default 10) | read-only |
| `gmail` / `google_workspace` | `mark_thread_read` | `thread_id` | **approval** |
| `gmail` / `google_workspace` | `send_message` | `to, subject, body` | **approval** |
| `discord` | `list_recent_messages` | `channel_id, limit?` | read-only |
| `discord` | `post_message` | `channel_id, content` | **approval** |
| `notion` | `list_pages` | `limit?, older_than_days?, query?` | read-only |
| `notion` | `get_page` | `page_id` | read-only |
| `notion` | `delete_page` | `page_id` | **approval** |
| `local_drive` | `list_files` | `rel_path?` | read-only |
| `local_drive` | `count_files` | `rel_path?` | read-only |
| `local_drive` | `write_text_file` | `rel_path, content` | **approval** |
| `elevenlabs` | `list_voices` | (none) | read-only |
| `elevenlabs` | `generate_tts` | `voice_id, text, out_rel_path?` | **approval** |
| `personas_database` | `list_tables` | (none) | read-only |
| `personas_database` | `describe_table` | `table_name` | read-only |
| `personas_database` | `execute_select` | `sql, limit?` | **approval** |
| `personas_database` | `execute_mutation` | `sql` | **approval** |
| `operations_database` | `query_operations` | `view` (+ optional filters) | read-only |
| any other registered service-type | (any) | — | **stub markdown only** |

> **Update (2026-09-06).** The 2026-06-16 "wired-vs-stub gap" is half closed:
> six more service types gained real handlers, and a pinned connector with no
> `capabilities_for` arm is now explicitly surfaced to Athena as unregistered
> so she stops promising a fetch (`prompt/capabilities.rs:236-243`). What is
> still open is the opposite direction: the prompt block above it still tells
> her `use_connector` "auto-fires - no approval card, no click"
> (`prompt/capabilities.rs:213-220`), which is untrue for every approval row
> in this table.

### D. Background job kinds

| Kind | Params | Output |
|---|---|---|
| `scan_codebase` | `{ project_id? \| path? \| project_name? }` | real context map (groups + contexts) via `launch_context_scan` |
| `connector_use` | `{ connector_name, capability, args }` | per-handler markdown |
| `memory_curation_run` | `{ scope: "consolidate" \| "reflect", instructions? }` | run id + UI pointer |
| `night_plan` | night-shift planner inputs | a `proposed` plan + a `night_shift_execute_plan` approval card (no session spawned) |
| `session_review` | terminal dispatched session | `review_verdict` ledger row + system episode |

Registered at `jobs/mod.rs:468-486`. An unknown kind is an error, not a
silent no-op.

### E. Proactive trigger kinds

Per-kind daily caps from `proactive/budget.rs:31-48` (fallback 3).

| Kind | Source | Cap | Bypass quiet? |
|---|---|---|---|
| `goal_target_approaching` | brain (goals) | 3 | no |
| `backlog_aging` | brain (backlog) | 3 | no |
| `cadence_due` | brain (rituals) | 3 | no |
| `on_this_day` | brain (episodes) | 3 | no |
| `ambient_match` | engine (ambient_ctx + rules) | 3 | no |
| `dev_goal_target` / `dev_goal_stalled` | brain (dev goals) | 2 (shared) | no |
| `execution_review` | execution-review debouncer + 5-min tick | 4 | no |
| `incident_blocker` | incident triggers | 6 | no |
| `message_digest` | message triage (aggregate) | 4 | no |
| `message_attention` | message triage (per-message) | 8 | no |
| `fleet_failed` | in-proc fleet registry | 3 | no |
| `fleet_stale` | in-proc fleet registry | 3 | no |
| `fleet_orchestration` | fleet bridge | 3 | no |
| `night_shift_report` | night shift | 3 | no |
| `dev_interrupted` | dev mode | 3 | no |
| `fleet_op_completed` | D6 reconciler | bypasses | no |
| `athena_scheduled` | `schedule_proactive` approval | uncapped per-kind (global 12 still applies) | no |

**Retired:** `fleet_awaiting`, `fleet_stuck_dispatched` - neither literal
exists in `src-tauri/src` as of 2026-09-06.

### F. Subagent dispatches (Athena's `Task` tool)

| Subagent | Purpose | File |
|---|---|---|
| `athena-persona-auditor` | Read a persona's runs/artifacts, summarize failures | `.claude/agents/athena-persona-auditor.md` |
| `athena-backlog-scout` | Surface candidate backlog items with provenance | `.claude/agents/athena-backlog-scout.md` |
| `athena-doc-reader` | Read docs/code excerpts without polluting Athena's ctx | `.claude/agents/athena-doc-reader.md` |
| `athena-web-researcher` | Synthesize WebSearch+WebFetch results with source URLs | `.claude/agents/athena-web-researcher.md` |

All dispatch with `CLAUDE_CODE_FORK_SUBAGENT=1`.

### G. Voice playback paths

| Path | Engine | Triggers |
|---|---|---|
| Send-flow TTS | Kokoro or Pocket TTS | Athena emits `TTS:` in reply |
| Arrival-TTS | same | proactive nudge / background-job system episode |
| Replay | same | footer "🔊 Play it again" button |

ElevenLabs and Piper were descoped 2026-07-10 (`companion/tts/mod.rs:11-13`).

### H. Memory tiers (read by retrieval each turn)

| Tier | Storage | Provenance required? |
|---|---|---|
| Episodic | `episodes/<Y>/<M>/<D>/<id>.md` + `companion_node` | n/a (is the source) |
| Semantic (facts) | `companion_node` + `companion_fact` | yes — non-empty `sources[]` |
| Procedural | `companion_node` + `companion_procedural` | yes — non-empty `sources[]` |
| Doctrine | embedded MD chunks via `AllMiniLML6V2Q` | n/a (read-only allowlist) |
| Identity | `identity.md` | n/a (single file) |
| Goals | `companion_goal` | no |
| Rituals | `companion_ritual` | no |
| Backlog | `companion_backlog_item` | yes — `source_episode_id` for `self_promise` |

### I. Per-turn UI events (Tauri channels)

| Channel | Lifecycle | Payload shape |
|---|---|---|
| `companion://stream` | per CLI line | `StreamEvent { sessionId, turnId, kind, payload }` |
| `companion://approvals` | once per turn with approvals | approval list |
| `companion://navigate` | per `open_route` | `{ route }` |
| `companion://open-lab` | per `open_lab` | `{ personaId, mode }` |
| `companion://compose-dashboard` | per `compose_dashboard` | empty (spec already persisted) |
| `companion://compose-cockpit` | per `compose_cockpit` | empty (spec already persisted) |
| `companion://chat-cards` | per turn with cards | `ChatCard[]` |
| `companion://recall-preview` | once per turn (pre-CLI) | `RecallPreviewEvent` |
| `companion://turn-summary` | once per turn (post-dispatch) | `TurnSummaryEvent` |
| `companion://job` | job state transitions | `BackgroundJob` |
| `companion://proactive` | per nudge delivery | `ProactiveMessage` |
| `companion://client-action` | per executor-returned client action | `ClientAction` |
| `companion://guide` | per `start_guided_walkthrough` / `point_at` / `compose_walkthrough` | guidance payload |
| `companion://explain-cockpit` | per `explain_in_cockpit` | ephemeral cockpit spec |
| `companion://compose-canvas-panel` | per `compose_canvas_panel` | surface spec |
| `companion://canvas-control` | per `canvas_control` | steering action |
| `companion://remote-job-turn` | per `remote_instruct` arrival | remote turn payload |
| `companion://hotkey` | voice hotkey | - |
| `companion://kokoro-install`, `companion://pocket-install`, `companion://stt-download`, `companion://stt-install` | engine install progress | progress payload |
| `athena://orchestration/operation-completed` | fleet operation reaches terminal state | operation payload |

Event-name constants live in `session/events.rs:12-126`; the two
`athena://orchestration/*` names live in `src-tauri/core/src/events.rs:349-350`.
`athena://orchestration/digest-changed` is emitted by
`orchestration::emit_digest_changed` on every operative-memory mutation (see
Operative memory, above).

### J. Known stubs / not-wired-yet (test exclusions)

- Connectors registered without a real handler — `connector_use`
  returns a "registered but not wired" markdown block; no real API call.
- Daemon binary (`personas-daemon`) — scaffolding exists, job worker
  is `AppHandle`-decoupled, but the daemon doesn't actually run the
  worker. In-flight jobs marked `failed` on next desktop startup.
- Autonomous chain past 20 ticks — hard cap, by design.
- `companion_reset_conversation(true)` — wipes SQL transcript + CLI
  session pointer. Disk episodes survive; brain index loses continuity
  until next ingest.
- `backlog_apply_triage` - in `ALLOWED_ACTIONS` and fully wired, but Athena
  does not emit it from chat; the Backlog's "Send to Athena" button is the
  only producer today (`catalog.rs:167-176`).
- `kp_hire_request`, `post_team_message`, `night_shift_execute_plan` -
  approval rows created by other surfaces, executed through the same
  table, never emitted by Athena as an op.
