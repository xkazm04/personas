# Athena — what she can do today

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
- **Quick-reply chips** (`QR:`) — Athena offers 2–5 follow-up prompts;
  clicking sends them back through `send()` as the next user turn.
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
  up to 20 consecutive chains per session. Persists across panel
  close/reopen via `systemStore`. The continuation turn renders as a
  slim divider in the transcript (`── autonomous continuation #N ──`)
  rather than a regular bubble — visual separation between user-driven
  and Athena-driven work.
- **Stop = type anything** — any user message cancels a pending
  autonomous tick via `companion_cancel_autonomy` (called from
  `companion_send_message`). If a tick is mid-stream, the A5 Stop
  button finishes the interrupt.
- **Reset** wipes the visible transcript and the CLI session pointer.
  The markdown episodes on disk remain — memory is preserved.
- **Self-improve loop** (beta, gated by `selfImproveEnabled`) — the 🔧
  wrench-send button forwards the textbox content to a separate coding
  CLI session that edits Athena's own files (templates, doctrine
  doc-set, prompt builder). Logs the outcome as a system episode so
  Athena reads what changed on the next turn.

## UI control (auto-fire — no approval card)

Athena can navigate and reshape parts of the desktop app without
waiting for a click. Each of these emits a Tauri event the panel
consumes immediately, with a flash of the `shows` avatar clip:

- **`open_route`** — switch the sidebar to one of: `home`,
  `overview`, `personas`, `events`, `credentials`, `design-reviews`,
  `plugins`, `schedules`, `settings`. Route allowlist enforced
  server-side.
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
  capability. Approval-free; runs as a background job (`connector_use`
  kind). The job result lands as a system episode Athena reads on the
  next turn.

## Inline chat cards

Auto-fire widgets Athena drops mid-transcript via `propose_action`. No
approval. Cards render inline through `InlineChatCard`; the JSON config
Athena emits is forwarded verbatim as the widget's data. Two families.

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

## Approval-gated actions (cards)

Athena proposes; the user clicks **Approve** / **Reject**. Each creates
a `pending_approval` row; the chat surfaces a card with the action's
parameters until resolved. Surface:

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
  future check-in with `{ message, when_iso }`; the deliver-due sweep
  in `proactive::deliver_due_scheduled` releases it through the same
  `companion://proactive` channel as trigger-driven nudges).
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

Every memory write requires at least one source episode citation —
anti-hallucination contract enforced at the repo layer.

## Background jobs

Worker polls SQLite every 3s. Terminal status (`completed`/`failed`)
emits a `companion://job` Tauri event the panel listens to (for
avatar flash + arrival-TTS) and appends a system episode so Athena
reads the result on the next turn. Registered kinds:

- **`scan_codebase`** — full-tree semantic analysis of a project on
  disk. Walks files with caps (`MAX_FILES_WALKED=25_000`,
  `WALK_TIMEOUT_SECS=60`), skips `node_modules`/`.git`/build outputs,
  emits a markdown summary.
- **`connector_use`** — see the **Connectors** section below.
- **`memory_curation_run`** — wraps the consolidation / reflection
  curators as a background-job kind so they don't block the IPC
  caller. `params.scope` is `consolidate` (calls
  `brain::consolidation::run_consolidation`) or `reflect` (calls
  `brain::reflection::run_reflection`). Optional `instructions`
  (≤4096 chars) steers the curator. Concept borrowed from Anthropic
  Managed Agents' dream pipeline; the shape is theirs, the
  implementation is personas's existing curators in a worker context.

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

**Capability registry** (`src-tauri/src/companion/connectors.rs::capabilities_for`)
maps `service_type` → list of intent-shaped slugs. Real per-service
handlers in `src-tauri/src/companion/jobs/connector_use.rs`:

| Connector | Capabilities | Status |
| --- | --- | --- |
| `sentry` | `list_issues` (limit?), `get_issue` (issue_id) | **Wired** — `sentry.io/api/0/...` with Bearer `auth_token` |
| `github` | `list_repos` (limit?), `list_open_prs` (owner, repo, limit?) | **Wired** — `api.github.com` with Bearer PAT + User-Agent |
| `slack` | `list_channels` (limit?) | **Wired** — `slack.com/api/conversations.list` with `xoxb-` Bearer; checks `ok` field |
| `gmail` / `google_workspace` | `list_recent_threads` (limit?) | **Wired** — `gmail.googleapis.com/gmail/v1/users/me/threads`; expired-token 401 surfaces as re-auth nudge |

All four handlers:

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
- **Doctrine** — read-only allowlist of ~25 architecture docs (this
  doc included). Chunked by H2 headings, embedded with
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

**Fleet attention triggers** (read in-process fleet registry, no DB
hit):

- **`fleet_failed`** — session exited with non-zero exit code within
  the last 10 minutes.
- **`fleet_awaiting`** — session in `AwaitingInput` for >2 minutes.
- **`fleet_stale`** — session reached `Stale` state (no activity for
  5+ min).
- **`fleet_stuck_dispatched`** (D9) — session inside a
  `dispatched_by_athena` op that's stuck (recent failure + no
  checkpoint), surfacing a candidate `fleet_intervene` proposal. Cap
  of one intervention per session is enforced server-side.

**Direct-source triggers** (bypass budget gate, still dedupe):

- **`fleet_op_completed`** (D6) — reconciler writes one of these per
  `dispatched_by_athena` op when every session has reached terminal
  state. Surfaces as the cross-session wrap-up.
- **`athena_scheduled`** — Athena's own `schedule_proactive`
  commitments held in `queued` until `scheduled_for` arrives, then
  released via `deliver_due_scheduled`.

Gating: **quiet_hours** blocks all delivery during active windows;
**daily budget cap** defaults to 3 nudges/day (direct-source triggers
bypass); **dedupe window** allows one nudge per `(trigger_kind,
trigger_ref)` until resolved.

Each delivery emits a `companion://proactive` Tauri event. If voice is
enabled, the panel speaks the nudge body immediately (arrival-TTS) —
regardless of whether the chat is open. Resolution: user clicks
through → `engaged` (engagement on a `backlog_aging` nudge bumps the
backlog item's `reminded_count` to ratchet future delivery cadence
down); user dismisses → `dismissed`.

## Voice

Two engines, picker in **Plugins → Companion → Voice**:

- **ElevenLabs** (cloud) — needs a Vault credential + voice ID. Per-
  voice tuning: model, stability, similarityBoost, style, speed.
- **Piper** (local ONNX) — no credential, no network at synth time.
  Voices downloaded via the in-app catalog browser; ~17 voices
  spanning 14 languages.

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

Beyond the four built-in tools Athena has *as a Claude session*, she
also **exposes** four tools to *other* Claude Code sessions (the
fleet workers) via MCP. Claude Code sessions discover Athena via
`--mcp-config <file>` at spawn time, pointing at her HTTP endpoint
(`/mcp/rpc`, JSON-RPC 2.0, same axum server that hosts
`/fleet/hooks/*`). Per-session tokens are minted at spawn time and
threaded via the `X-Athena-Session` header.

The four tools — definitions in
`src-tauri/src/companion/orchestration/mcp/handlers.rs`:

| Tool | Effect | Blocking |
| --- | --- | --- |
| **`athena.report_intent`** | Claim or join an Operation; set role + intent string. Replaces the auto-generated "user spawn in <project>" label in Athena's prompt digest. Optional `operation_id` joins an existing op. | No |
| **`athena.checkpoint`** | Append progress / optional blockers to operative memory. Athena uses this to decide whether to pre-empt with guidance. Don't call on every tool use — the hook layer covers that. | No |
| **`athena.request_guidance`** | Ask Athena a question and **block** until she answers. Surfaced in the chat panel as a pending request; Athena sees the session's intent/checkpoints/recent failures in context. | **Yes** |
| **`athena.request_approval`** | Propose a destructive / cost-bearing action and **block** until the user approves or denies via an ApprovalCard. | **Yes** |

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
- **Mutations** — every change emits `athena://orchestration/digest-changed`
  so the frontend re-pulls the digest via
  `companion_get_operative_memory_digest`.

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

- **`register_project`** (approval-gated) — add a new project by
  name + path.
- **`enqueue_dev_job`** (approval-gated) — currently supports
  `scan_codebase`; passes `project_id` to the worker so the scan
  outcome rolls up under that project's `last_scan_summary`.

## Per-turn UI side-channel events

Beyond `STREAM_EVENT` (raw stream-json chunks), `APPROVALS_EVENT`,
and the navigation events (`NAVIGATE_EVENT`, `OPEN_LAB_EVENT`,
`COMPOSE_DASHBOARD_EVENT`, `COMPOSE_COCKPIT_EVENT`, `CHAT_CARDS_EVENT`),
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

| Kind | Use case |
| --- | --- |
| `persona_overview` | Roster grid — which personas exist, recent activity |
| `connected_services` | Pinned connector list with health pills |
| `decisions_panel` | Pending approvals + critical attention items |
| `metric_spark` | Single KPI tile with optional delta + trend |
| `issue_list` | Bulleted item rows with severity badge + external link |
| `text_callout` | Narrative panel with markdown body and intent accent |

The last three are generic — Athena populates them from her own
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
  doesn't actually run the job worker yet. When the desktop app quits,
  in-flight jobs are marked `failed` on next startup and scheduled
  proactive nudges don't fire.
- **Mid-stream continuation past 20 ticks** — autonomous chains hard-
  cap at 20 consecutive turns. Beyond that the chain stops and waits
  for fresh user input. Tunable, not infinite.
- **Persistent state across `companion_reset_conversation(true)`** —
  reset wipes the SQL transcript + CLI session pointer. The disk
  episodes survive (Markdown files), but the brain's index loses
  continuity until next ingest.
- **External APIs beyond the four wired connectors** — Sentry, GitHub,
  Slack, Gmail are real. Other connectors in the registry
  (`capabilities_for`) return the v1 stub. Adding one = one match arm
  in `connector_use::dispatch_capability`.

## Source map

| Concern | File |
| --- | --- |
| Op dispatcher (grammar, allowlists, parse, `continue_autonomously`) | `src-tauri/src/companion/dispatcher.rs` |
| Prompt builder (compose, addenda, recall, tools, autonomous) | `src-tauri/src/companion/prompt.rs` |
| Constitution (op grammar reference, v7) | `src-tauri/src/companion/templates/constitution.md` |
| Session runtime (turn lifecycle, A5 interrupt, A2 continuation scheduler) | `src-tauri/src/companion/session.rs` |
| Background-job worker (`JobEventSink`, scan/connector/curation) | `src-tauri/src/companion/jobs/` |
| Connector capability registry + real handlers | `src-tauri/src/companion/connectors.rs`, `jobs/connector_use.rs` |
| Memory tiers | `src-tauri/src/companion/brain/{episodic,semantic,procedural,doctrine,identity}.rs` |
| Proactive scheduler | `src-tauri/src/companion/proactive/` |
| Chat panel + arrival-TTS + Stop button + autonomous toggle | `src/features/plugins/companion/CompanionPanel.tsx` |
| Avatar (5-clip state machine) | `src/features/plugins/companion/AthenaAvatar.tsx` |
| Cockpit widget registry | `src/features/home/components/cockpit/widgetRegistry.ts` |
| Subagent catalog (Task tool definitions) | `.claude/agents/athena-*.md` |

When in doubt: this doc gets out of date. The dispatcher, the
capability registry, and `prompt.rs::compose` are the ground truth.

## Capability inventory — for tests + optimization passes

A flat, grouped list of every Athena-driven capability shipping on
`master`. Use this as the test matrix; each row should have at least
one happy-path scenario and (where applicable) one rejection scenario.
Numbers in brackets indicate the constitution version that introduced
the op (current: **v18**).

### A. Op grammar (chat-emitted JSON envelopes)

**A1. Auto-fire UI navigation** — no approval card, fires on parse:

- `open_route { route }` — sidebar nav. Allowlist of 9 routes.
- `open_lab { persona_id, mode }` — persona editor + lab mode. 7 modes.
- `compose_dashboard { title, widgets[] }` — persists + navigates to
  Companion → Dashboard. 9 widget kinds.
- `compose_cockpit { title, widgets[] }` — persists + navigates to
  Home → Cockpit. 6 widget kinds.
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

**A3. Auto-fire background job** — no approval card, enqueues:

- `use_connector { connector_name, capability, args }` — validates
  (pinned + enabled) and (capability in registry) before enqueue.

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

**A8. Approval-gated — projects + dev jobs**:

- `register_project { name, path, description? }`
- `enqueue_dev_job { kind, project_id?, params? }` — currently only
  supports `scan_codebase`.

**A9. Approval-gated — fleet (Phase J)**:

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

**A10. Reply-shaping helpers** (stripped from display, transient):

- `TTS: "..."` — spoken summary line; first wins per turn
- `QR: ["..."]` — up to 6 quick-reply chips

### B. MCP server tools (Athena exposes to fleet workers)

| Tool | Blocking | Endpoint | Schema |
|---|---|---|---|
| `athena.report_intent { intent, role?, operation_id? }` | No | `/mcp/rpc` | `tool_descriptors()` |
| `athena.checkpoint { progress, blockers? }` | No | `/mcp/rpc` | same |
| `athena.request_guidance { question, context? }` | **Yes** | `/mcp/rpc` | same |
| `athena.request_approval { action, rationale, details? }` | **Yes** | `/mcp/rpc` | same |

### C. Connector capabilities (real handlers in `connector_use.rs`)

| Connector | Capability | Required args | Status |
|---|---|---|---|
| `sentry` | `list_issues` | `limit?` (≤100) | wired |
| `sentry` | `get_issue` | `issue_id` | wired |
| `github` | `list_repos` | `limit?` (≤100) | wired |
| `github` | `list_open_prs` | `owner, repo, limit?` (≤100) | wired |
| `slack` | `list_channels` | `limit?` (≤200) | wired |
| `gmail` / `google_workspace` | `list_recent_threads` | `limit?` (≤50) | wired |
| any other registered service-type | (any) | — | stub markdown only |

### D. Background job kinds

| Kind | Params | Output |
|---|---|---|
| `scan_codebase` | `{ project_id? }` | markdown summary (file walk) |
| `connector_use` | `{ connector_name, capability, args }` | per-handler markdown |
| `memory_curation_run` | `{ scope: "consolidate" \| "reflect", instructions? }` | run id + UI pointer |

### E. Proactive trigger kinds

| Kind | Source | Budget | Bypass quiet? |
|---|---|---|---|
| `goal_target_approaching` | brain (goals) | counts | no |
| `backlog_aging` | brain (backlog) | counts | no |
| `cadence_due` | brain (rituals) | counts | no |
| `on_this_day` | brain (episodes) | counts | no |
| `ambient_match` | engine (ambient_ctx + rules) | counts | no |
| `fleet_failed` | in-proc fleet registry | counts | no |
| `fleet_awaiting` | in-proc fleet registry | counts | no |
| `fleet_stale` | in-proc fleet registry | counts | no |
| `fleet_stuck_dispatched` | operative memory + registry | counts | no |
| `fleet_op_completed` | D6 reconciler | bypasses | no |
| `athena_scheduled` | `schedule_proactive` approval | counts at delivery | no |

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
| Send-flow TTS | ElevenLabs or Piper | Athena emits `TTS:` in reply |
| Arrival-TTS | same | proactive nudge / background-job system episode |
| Replay | same | footer "🔊 Play it again" button |

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
| `athena://orchestration/digest-changed` | operative memory mutation | empty (re-pull) |

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
