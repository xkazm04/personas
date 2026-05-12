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

Three widget kinds Athena can drop mid-transcript via `propose_action`
(also auto-fire, no approval):

- **`show_persona_overview`** — per-persona metadata card.
- **`show_connected_services`** — pinned connector list with
  enable/disable badges.
- **`show_decisions`** — pending human-review / approvals card.

Cards render inline through `InlineChatCard`; the JSON config Athena
emits is forwarded verbatim as the widget's data.

## Approval-gated actions (cards)

Athena proposes; the user clicks **Approve** / **Reject**. Each
creates a `pending_approval` row; the chat surfaces a card with the
action's parameters until resolved. Surface:

- **Personas** — `run_persona` (execute with given inputs),
  `prefill_persona_create` (pre-populate the create-persona form),
  `run_arena` (launch lab Arena mode), `register_project` /
  `enqueue_dev_job` (project registry + background work).
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
- **`curation_run`** — placeholder for the curation/synthesis pass.

Orphan recovery: any job in `running` status at startup is marked
`failed` (process restart killed it mid-execution).

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

Scheduler runs every 5 minutes. Four trigger kinds:

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

Gating: **quiet_hours** blocks all delivery during active windows;
**daily budget cap** defaults to 3 nudges/day; **dedupe window**
allows one nudge per `(trigger_kind, trigger_ref)` until resolved.

Each delivery emits a `companion://proactive` Tauri event. If voice is
enabled, the panel speaks the nudge body immediately (arrival-TTS) —
regardless of whether the chat is open.

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
