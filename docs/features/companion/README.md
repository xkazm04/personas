# Companion

Companion is the Athena assistant plugin. It has two UI surfaces: a plugin settings page and the always-available companion panel/footer affordance.

## User surface

| Surface | Behavior | Main files |
| --- | --- | --- |
| Plugin page | Three-tab manager for Setup, Memory, Voice | `CompanionPluginPage.tsx` |
| Setup | Global toggles such as footer icon visibility, chime, and beta self-improve exposure | `sub_setup/SetupPanel.tsx`, `companionPluginSlice.ts` |
| Memory | Full-page brain viewer over episodes, doctrine, identity, and constitution | `sub_memory/MemoryPanel.tsx`, `BrainViewer.tsx` |
| Voice | ElevenLabs credential picker and voice-id binding | `sub_voice/VoicePanel.tsx`, `commands/companion/voice.rs` |
| Panel | Chat, streaming, quick replies, approvals, playback | `CompanionPanel.tsx`, `CompanionToolbar.tsx`, `ApprovalCard.tsx` |
| Avatar/footer | Athena's live video avatar **is** the footer button (right cluster) — tap opens/collapses the panel, **press-and-hold dictates a voice turn without opening the panel**. Avatar reflects state (idle/thinking/speaking); chime, pending playback, notice popover above icon ("Analysis completed" / proactive subject) with optional TTS announcement when voice is enabled | `AthenaAvatar.tsx`, `CompanionFooterIcon.tsx`, `chime.ts`, `voicePlayback.ts`, `useDictation.ts`, `companionStore.ts` (`FooterNotice`, `voiceTurnRequest`) |

## Footer avatar & hold-to-talk

The footer initiation control is Athena's actual animated avatar (`AthenaAvatar`), not a generic glyph — her idle/thinking/speaking video reflects what she's doing at a glance. The button has two gestures:

- **Tap** — opens/collapses the chat panel (the original behavior).
- **Press-and-hold** (≥220ms) — arms dictation; a mic badge + pulse appear on the avatar. On release, the final transcript is handed to the always-mounted `CompanionPanel` via the `voiceTurnRequest` store slot, which runs the standard `send()` pipeline. The reply streams and (when a voice engine is configured) auto-plays, surfacing through the existing notice popover + Play button — **all without the panel ever opening.** A hold's trailing synthetic `click` is suppressed so releasing doesn't also toggle the panel.

`voiceTurnRequest` is deliberately separate from `pendingPrompt`: `pendingPrompt` seeds the composer draft and is only consumed while the panel (and Composer) is mounted, whereas `voiceTurnRequest` is consumed by an always-mounted effect so a footer-initiated turn works with the panel closed.

**STT engine.** Both the footer and orb use the browser Web Speech engine (`useDictation`) via the shared `useHoldToTalk` hook; on WebView2 that forwards audio to the OS vendor's cloud STT. The mic is only ever armed by an explicit press, never on mount. A local, on-device Whisper STT engine (so audio never leaves the machine) is the separate workstream tracked in [`athena-orb-overlay-plan.md`](./athena-orb-overlay-plan.md) §4.

## Floating dockable orb (`minimized` state)

Step 2 of [`athena-orb-overlay-plan.md`](./athena-orb-overlay-plan.md) promotes Athena out of the footer into a first-class overlay. A new `CompanionState` value `minimized` (between `collapsed` and `open`) shows `AthenaOrb` — her avatar as a draggable orb portal'd to `document.body` above all app content (`orb/AthenaOrbLayer.tsx`, `orb/AthenaOrb.tsx`).

- **One pointer surface, three gestures:** tap → open the full chat panel; hold (≥220ms) → dictate a voice turn (via the same `useHoldToTalk` → `voiceTurnRequest` path as the footer); drag past ~6px → relocate. A drag cancels an armed hold so moving never records. While listening, the interim transcript shows as a caption beside the orb.
- **Dock + persistence:** on drop the X position snaps to the nearest side edge; position is stored as viewport fractions (`companionOrbPos`) and resolved to pixels at render so it survives window resizes and restarts. A hover-revealed `×` dismisses the orb (→ `collapsed`).
- **Footer + panel wiring:** when the orb is enabled (`companionOrbEnabled`, default on, toggled in Companion → Setup → "Floating avatar"), the footer button summons/hides the orb (`minimized ↔ collapsed`) and the chat panel's close button returns to the orb instead of vanishing. `AthenaOrbLayer` promotes a dormant (`collapsed`) Athena to `minimized` once on mount so the presence is there from launch. With the orb disabled, the footer keeps its classic open/collapse behavior.

**Polish (Step 2b).** Opening from the orb morphs the panel out of the orb's position (it flies + scales from the orb's recorded center, anchored to the panel's bottom-left corner, and collapses back on close). A global **Cmd/Ctrl+Shift+A** summons Athena and starts a voice turn (press again to send, **Esc** to cancel — the shared `useHoldToTalk` instance lives in `AthenaOrbLayer` so the orb and the keyboard drive one session). All of it honors `prefers-reduced-motion`.

**Audio-reactive glow.** While Athena speaks, a bloom behind the orb pulses with her actual voice level. `voicePlayback.play()` routes every TTS `<audio>` through a single shared `AnalyserNode` (`audioLevel.ts`); the orb subscribes via `subscribeAudioLevel` and drives the glow's opacity + scale imperatively in a `rAF` callback (no per-frame React re-renders). The tap is best-effort — if Web Audio is unavailable it silently degrades and playback is unaffected. Under `prefers-reduced-motion` the glow is a static bloom (no subscription).

## Athena desktop-aware lineage

Companion's awareness of the user's desktop activity ships in phases. The decision-gate audit lives at [`../../architecture/athena-phase1-audit.md`](../../architecture/athena-phase1-audit.md); the two shipped feature deliverables sit alongside this README:

- [`athena-daemon-bridge.md`](./athena-daemon-bridge.md) — Phase 3 c v3. Cross-process `ambient_signal` SQL projection so daemon-fired personas see the same in-memory ambient window the windowed app captures (clipboard, app focus, file changes).
- [`athena-cli-session-awareness.md`](./athena-cli-session-awareness.md) — Phase 5 v1. Read-only injection of the user's active interactive Claude CLI session into a persona's prompt, gated by per-persona toggle (Settings tab) AND global toggle (Companion → Setup → Sensory signals).

## Initialization and brain storage

`companionInit()` calls `companion_init` once per browser lifetime using a `globalThis` promise slot so StrictMode and Vite HMR cannot double-ingest doctrine. The backend initializes `~/.personas/companion-brain/` and starts doctrine ingestion in the background when the `ml` feature is available.

Manual re-ingest uses `companion_reingest_doctrine`. It is idempotent: unchanged chunks are skipped by content hash, and the frontend receives inserted/updated/unchanged/deleted counts.

## Conversation flow

1. Frontend sends `companion_send_message` with the user message and a `voiceEnabled` flag.
2. Backend drives the companion runtime and streams progress through `companion://stream`.
3. Final response returns user/assistant episode IDs, quick-reply labels, and optional `ttsText`.
4. The panel appends messages to `companionStore.ts`; pending playback is stored globally so the footer Play button and chat panel coordinate.
5. `companion_reset_conversation` clears the persistent Claude CLI session and can optionally wipe the SQL transcript. Markdown episodes remain on disk.

## Approvals and navigation

Athena actions can create pending approvals. The panel lists them through `companion_list_pending_approvals` and resolves them through `companion_approve_action` or `companion_reject_action`.

Events:

- `companion://approvals`: newly created approval rows.
- `companion://navigate`: direct route switch requested by Athena. The route `monitor` is a pseudo-route — it opens the full-screen [Persona Monitor](../monitor.md) overlay instead of switching a sidebar section. Athena fires it (after a short spoken/written summary) when the user asks for a fleet overview.
- `companion://stream`: streaming turn output from the backend. With `--include-partial-messages` (see "Token-level streaming" below) it carries `stream_event` lines with `text_delta` chunks so the reply renders token-by-token.
- `companion://recall-preview`: per-turn rollup of what the brain pulled into the system prompt (counts + titles per memory kind).
- `companion://turn-summary`: per-turn rollup of dispatcher side-effects keyed by assistant episode id (approvals / navigations / lab opens / dashboards / cockpits / chat cards / continuation flag).
- `companion://job`: background-job status transitions (queued → running → terminal). In-flight emits may carry a transient `progressText` so a running job reports what it's doing.

Approval outcomes may include a client-side action such as `{ type: "navigate", route }`.

## Recall preview strip

Each turn, after the prompt builder runs but before the CLI spawns, the backend emits `companion://recall-preview` carrying a `CompanionRecallPreview`: `episodeCount` plus titled entries for doctrine, facts, procedurals, goals, and backlog (capped at 60 chars per title, server-truncated with an ellipsis). A `synthesized` flag indicates the recall was over budget and was folded through `recall_synthesis` into a focused briefing.

The panel renders this as a thin `RecallStrip` collapsed above each assistant bubble: a single-line summary ("Athena replayed 5 recent turns and consulted 12 memories") that expands on click to show the actual titles grouped by kind. The strip persists on the bubble for the rest of the session; an app restart drops the strip (recall is ephemeral working memory).

Stage 2 wired: each chip is a button that calls `setBrainView({ open: true, kind, id })` to open the Brain Viewer as an overlay over the chat transcript, jumped straight to the detail view for that memory. Group→kind mapping matches the backend's parent kinds (`doctrine`, `fact`, `procedural`, `goal`, `backlog`) — `companion_get_brain_item` dispatches `fact` / `procedural` / `goal` / `backlog` to the scoped fetchers so the parent-kind lookup resolves whichever scoped variant owns the id. Closes the loop from "what did Athena consult this turn" to "what's actually in that memory."

**Detail-view linked memories.** Inside the BrainViewer's DetailView, the rendered markdown is also scanned for memory-id tokens (`goal_xyz`, `procedural_abc`, `design_decision_def`, etc. — see `parseBrainLinks.ts` for the full kind list). Each unique reference becomes a small chip in a "Linked memories" strip below the content (via the shared `BrainLinksStrip` component); click → opens that memory's DetailView in place. Lets the user traverse the brain as a graph instead of a flat list. Orchestration tokens (`op_xxxx`, `sess_yyyy`) are intentionally excluded — they don't have a BrainViewer destination.

**Chat-bubble linked memories.** The same scan runs against the body of every completed assistant bubble — when Athena's reply mentions one or more brain ids, a tighter `inline`-variant chip strip renders directly below the bubble with the same click → setBrainView wiring. Skipped during streaming (partial text would make the chip set flicker as tokens come and go mid-reply). The chat is where Athena names memories most often, so this closes the graph-traversal loop where it pays off most.

## Turn-summary chip

Below each assistant bubble, a tiny caption-sized chip (`TurnSummaryChip`) surfaces what Athena's reply *did* — distinct from what she *said*. The chip aggregates dispatcher outputs from the same turn (pending approvals, direct navigations, lab tab opens, dashboard / cockpit auto-fires, inline chat-cards) plus a flag for `continue_autonomously`. Total-zero turns render nothing.

Source: the backend emits one `companion://turn-summary` event per turn after the dispatcher block, already keyed by the persisted `assistant_episode_id` so the panel can attach the chip to the right bubble without correlating turn ids. Same session-scoped persistence model as the recall preview — lost on app restart.

The clickable parts — `approval`, `card`, `composed dashboard`, `composed cockpit` — are buttons that jump to the corresponding surface: `approval`/`card` smooth-scroll the panel to the approvals or chat-cards container; `dashboard` navigates to plugins → companion → dashboard; `cockpit` navigates to home → cockpit (mirroring the auto-fire targets in `compose_dashboard` / `compose_cockpit`). Parts without a meaningful destination — `navigated` (already happened), `lab` (no agent id carried in the event), `continuation` (informational) — stay as captions.

## Connector-call live status cards

Athena's `use_connector` op auto-fires (no approval, by design — see `src-tauri/src/commands/companion/approvals.rs:207-210`) and enqueues a background `connector_use` job. The job worker dispatches through `src-tauri/src/companion/jobs/connector_use.rs::dispatch_capability` (Sentry / GitHub / Slack / Gmail today, with a fallback echo for unwired capability slugs).

Previously the user only saw the result as a system episode after Athena ingested it on her next turn. Now the panel subscribes to the `companion://job` event channel and renders an inline `ConnectorCallCard` per in-flight or terminal `connector_use` job, pinned under the assistant bubble that produced it:

- **queued** — hourglass + neutral border
- **running** — spinning loader + blue border; shows the job's live `progressText` ("Calling Sentry…") when present, falling back to the static in-flight hint
- **completed** — check + green border, result-markdown collapsed until click
- **failed** — alert + rose border, error text collapsed until click; surfaces a `Retry` button (Cycle 5) that re-enqueues the same paramsJson via `companion_enqueue_job`. The retried job's live status (queued → running → completed / failed) renders inline below the original failed card, subscribed via the global `jobsById` map so the user doesn't have to scroll the panel hunting for the new card (Cycle 10).

The running handler reports intermediate progress through a `JobProgress` reporter (`src-tauri/src/companion/jobs/mod.rs`) that re-emits the job row with a transient `progressText` on the same `companion://job` channel — event-only, never persisted, so the terminal emit clears it. `connector_use` reports "Calling {service}…" before the HTTP call; `scan_codebase` reports "Scanned N files…" every 2,000 walked entries.

Cards correlate to turns via the same pending → episode-id promotion the recall strip uses (jobs queued during streaming live in `pendingConnectorJobIds`; at the `finished` stream event they move into `connectorJobIdsByEpisodeId[assistantEpisodeId]`). No new IPC — the existing `companion://job` event channel carries everything the card needs.

## Token-level streaming & the operational thread

Two surfaces keep a long or autonomous turn from going silent between the user's message and the final reply.

**Token-level streaming.** Athena's CLI spawn (`src-tauri/src/companion/session.rs`) passes `--include-partial-messages`, so the CLI emits `stream_event` lines with `content_block_delta` / `text_delta` chunks ahead of the whole `assistant` message. The panel extracts those deltas (`extractAssistantTextDelta`), appends them to the streaming bubble coalesced once per animation frame, and skips the duplicate trailing whole-message text once deltas have streamed. The reply now flows in token-by-token instead of appearing in whole-message jumps. The change is additive: on a CLI that doesn't emit partial messages the panel falls back to the whole-message path unchanged, and the backend's whole-message accumulation (which drives the persisted episode) is untouched.

**Operational thread (live plan).** When Athena calls TodoWrite during a turn, the panel parses the full checklist (`operationalSteps.extractTodoWrite`, latest call wins) and renders it inline under the bubble as an `OperationalThread` — each step shown as pending / in-progress / completed, updating in place. It uses the same `streamingSteps → stepsByEpisodeId` promote-on-`finished` model as the recall strip and connector cards, so the plan pins under the in-flight bubble while running and under the completed bubble afterward. Session-scoped; dropped on app restart.

## Athena-scheduled proactive check-ins (`schedule_proactive`)

Trigger-driven nudges (goal target approaching, backlog aging, cadence due, on-this-day) come from `proactive::triggers::collect_all` and fire whenever the evaluator finds something worth surfacing. The `schedule_proactive` op gives Athena a second path: she commits to a future ping with a specific message at a specific time.

Wire:

- Op: `propose_action: schedule_proactive { message, when_iso }` — created in `src-tauri/src/companion/dispatcher.rs` (`ALLOWED_ACTIONS` entry; same approval-card flow as `write_fact` / `write_goal`).
- Approval executor: `execute_schedule_proactive` in `src-tauri/src/commands/companion/approvals.rs` parses + validates the RFC3339 timestamp (rejects past times), then calls `proactive::insert_scheduled` to persist a row with `trigger_kind='athena_scheduled'` and `scheduled_for=when_iso`.
- Schema: `companion_proactive_message.scheduled_for` (TEXT, nullable). NULL = trigger-driven (delivered as soon as quiet/budget/dedupe pass). Non-NULL = scheduled (held in `queued` until the time arrives). Migration is a defensive `ALTER TABLE` in `db::init_user_db`.
- Delivery: `proactive::deliver_due_scheduled` sweeps for rows with `scheduled_for <= now()` and returns them; `companion_evaluate_proactive_now` calls it alongside `proactive::evaluate` so the same `companion://proactive` event channel surfaces both kinds.
- UI: the existing `ProactiveCard` renders the message — a sky-blue accent + "scheduled by Athena" label disambiguates the kind. Engage / Dismiss work identically.

Why approval-gated when `use_connector` isn't: a scheduled check-in puts a future obligation on the user's attention. Unlike connector calls (which run on pre-greenlit pinned credentials), the consent isn't already present — Athena's "I'll ping you about X in 3 days" needs the user to actually agree before the row lands.

## MCP request panel (D3 — batched approvals)

Pending MCP requests from fleet sessions land in `McpRequestPanel` above the chat transcript: one card per request, with guidance prompts taking text input and approvals taking ✓/✗ + an optional note. The panel groups by `fleetSessionId` so cards from the same session render together — and when a single session has 2+ pending `approval`-kind requests, the group header renders a primary "Approve all" button that fires `resolveMcpRequest(_, { approved: true, note: '' })` for every approval in that group in parallel (`Promise.allSettled` so one failure doesn't stall the rest). Guidance requests are never batched — they need typed answers.

Common case the batch unblocks: a fleet session pauses on 3-5 file-writes / shell commands / API calls in a row. Without batching, the user clicks Approve five times; with batching, one click clears the queue and the session resumes.

## Live ops strip (D7 — operative-memory view)

When orchestration is in flight, the strip above the chat transcript surfaces the same operative-memory digest Athena reads every turn. The frontend now parses the backend's markdown digest into structured rows (`parseDigest.ts`) and renders each in-flight operation as its own collapsible card: status badge, intent, duration, id, and a sessions count. Click an op → expand its sessions; each session shows its state, current tool, intent, latest checkpoint (with blockers if present), files touched, recent failure, and rolling summary — the same fields Athena sees, but navigable instead of one monospace blob.

Defensive: if the parser produces zero ops while the digest is non-empty (i.e. the Rust-side `OperativeMemory::digest_for_prompt` format drifts), the strip falls back to the original `<pre>` block so power users still see the raw view Athena consumes.

## Persona-design doctrine

When users ask "is my persona ready?" or "help me design a persona for X", Athena pulls from the doctrine corpus configured in `src-tauri/src/companion/brain/doctrine.rs`. In addition to the reference docs (`features/personas/01-data-model.md`, `02-capabilities.md`, `03-trust-and-governance.md`) and template docs, the corpus includes a prescriptive best-practices guide at `docs/concepts/persona-design-best-practices.md` covering: intent line shape, interactive vs one-shot build, system prompt structure, use case decomposition, capability scoping, tool definition discipline, trigger grain, credential hygiene, model tier selection, observability hooks, and a catalogue of anti-patterns to flag during review.

The guide is for the model's working context — it tells Athena *how* to evaluate or compose a persona, not just *what* the persona schema is. Edits go through the standard `companion_reingest_doctrine` flow (idempotent: only changed chunks re-embed).

## `show_persona_walkthrough` chat-card

The persona-design doctrine becomes actionable through a new auto-fire op: `show_persona_walkthrough { intent, content, title? }`. Athena emits it when a user asks "help me design a persona for X" — instead of replying in chat prose, she composes a long-form markdown plan and lands it as an inline card via the existing chat-cards event channel.

The card renders through a new `persona_walkthrough` widget in `cockpitWidgetRegistry`. Unlike the dashboard-style widgets (persona_overview, decisions_panel, etc.) it's not height-clamped to 260px — `InlineChatCard` recognizes `persona_walkthrough` as an unclamped kind so the markdown flows naturally and the chat scroll handles overflow. Header shows the intent + a sparkle accent; body is a `MarkdownRenderer` with prose-tight styles for nested lists, headings, and inline code.

Content shape is just `{ intent, content }` where `content` is the markdown blob Athena composed. The walkthrough typically includes: proposed intent line, system prompt outline, use case set, tools, triggers, model tier, observability hooks — the seven readiness items from the best-practices doctrine, applied to this user's specific intent. From there the user can act: pick a starter template, refine the intent, or commit to a build via `build_oneshot` / `prefill_persona_create`.

The walkthrough card carries a **"Build from this"** affordance — a primary button at the bottom that fires the same prefill (intent text, interactive mode) the approval-driven `prefill_persona_create` flow uses, then routes to the personas view. The user lands in `UnifiedBuildEntry` with the intent already filled in. No approval round-trip needed for this path — the walkthrough is itself a suggestion the user is reviewing, and the prefill commit just hands the conversation off to the standard build flow.

Constitution bumped to v9 so existing installs pick up the new op signature on next boot.

## `show_template_suggestions` chat-card

When a user describes a persona they want, Athena's first move shouldn't always be "let me design one from scratch" — often the gallery already has a near-match. The auto-fire op `show_template_suggestions { intent, limit? }` surfaces matching templates inline so the user can adopt instead of build.

Wire:

- Athena emits the op carrying the intent text only (no per-template knowledge required from her side).
- Dispatcher creates a chat-card `kind=template_suggestions` with `config={ intent, limit }`.
- The new `TemplateSuggestionsWidget` calls `companion_match_templates(intent, limit)` on mount (Tauri command in `src-tauri/src/commands/companion/templates.rs`). The command extracts keywords from the intent (3+ chars, stop-words filtered, cap 8) and runs them through the existing `search_reviews_compact` LIKE-match query — no LLM call, no async job.
- Results render as small cards with name, category, instruction snippet, connector chips. An "open gallery" affordance navigates to `design-reviews` so the user can follow through with the existing adoption flow (questionnaire + customization).

No direct adoption from chat by design — that would bypass the customization steps users expect from template adoption. Constitution bumped to v10.

## `show_use_case_set` chat-card

The walkthrough card (`show_persona_walkthrough`) sketches the whole design plan; this op zooms into the use-case-decomposition layer specifically. Athena emits `show_use_case_set { intent, use_cases }` carrying 3-5 use cases tagged by role:

- **golden** — the most common, most-valued input class. Airtight handling.
- **variant** — known input shapes needing different handling than the golden path.
- **out_of_scope** — inputs the persona should explicitly refuse.

The dispatcher validates the role enum and the array size (1-8, soft target 3-5). The widget sorts golden → variant → out_of_scope (most important to handle → must refuse cleanly) and renders each with a role-specific accent (emerald / violet / rose). Auto-fire, no approval — same suggestion shape as the walkthrough.

A persona with only golden cases breaks on its first edge-case input; the doctrine guidance flagged here pushes Athena to surface all three roles when she proposes a use-case set. Constitution bumped to v11.

## "Pin to cockpit" on inline chat-cards

Dashboard-shaped chat-cards (`persona_overview`, `connected_services`, `decisions_panel`, `metric_spark`, `issue_list`, `text_callout`) get a hover-revealed **Pin to cockpit** affordance in the top-right corner. Click → calls the new `companion_pin_widget_to_cockpit` Tauri command which loads the current cockpit spec, appends the widget with a fresh id and `span=4` default, and saves. Idempotent on the backend — pinning the same `{kind, config}` twice is a no-op.

Advisory cards (`persona_walkthrough`, `template_suggestions`, `use_case_set`) deliberately do NOT show the pin — they're read-once shapes, not persistent dashboard surfaces. Pinning them would dilute the cockpit's signal-to-noise.

Closes the loop between transient chat reasoning and the persistent cockpit surface: when Athena composes a useful widget inline (a status spark for a service, an issue rollup, a custom callout), the user can promote it to their dashboard with one click instead of asking Athena to compose a full cockpit from scratch.

## `show_trigger_set` chat-card (sibling of use_case_set)

Athena emits `show_trigger_set { intent, triggers }` to decompose a persona's input distribution from the trigger angle: 1-4 trigger configurations each with `label`, `source` (free-form: Slack webhook, scheduled cron, polling Sentry, manual), `condition` (what input shape fires this), and optional `grain` + `idempotency_note` to surface cycle-6 doctrine's right-grain test.

Together with `show_use_case_set` (the what-it-handles angle), the trigger card completes the persona-decomposition triangle. Widget renders each trigger with a source-aware icon hint (Bell for inbox/webhook, Clock for scheduled, Repeat for polling). Auto-fire — same suggestion shape as siblings; advisory not pinnable. Constitution bumped to v12.

## `show_model_tier_choice` chat-card

Picks up the model-tier-selection readiness item from cycle-6 doctrine. Athena emits `show_model_tier_choice { intent, recommended, tiers }` with the three Anthropic tiers (haiku / sonnet / opus), marking one as `recommended` and providing a 1-2 sentence rationale per tier. The widget sorts haiku → sonnet → opus and accents the recommended one (emerald border + star badge). Informational only — it doesn't write any selection; the user picks the tier when they reach the build flow.

Rationale shapes follow the doctrine heuristics: Haiku for high-volume routing/triage with structured output, Sonnet as the default for the majority of personas, Opus for long-context reasoning over large inputs or output where a single bad reply is expensive. Constitution bumped to v13.

## `show_observability_plan` chat-card

The 7th readiness item from cycle-6 doctrine: every persona needs an error path that doesn't black-hole AND at least one success metric tracked. Athena emits `show_observability_plan { intent, error_handling, success_metric }` to surface both.

`error_handling` is `{ triggers: [string], escalation: string }` — a list of named failure modes plus where they end up (typically the `manual_reviews` queue). `success_metric` is `{ kind, description, target? }` with `kind` in `count_by_status | cost_per_run | latency | custom`. The widget renders the two sections stacked: red-accented error path on top, emerald-accented success metric below, with a metric-kind-specific icon.

Auto-fire chat-card; informational only. Together with cycles 7-9 + 12-13, Athena now has structured chat-card surfaces for 5 of the 7 readiness items (intent overview, use cases, triggers, model tier, observability). The remaining gaps (system prompt structure, tools) were in-session sticky-dropped. Constitution bumped to v14.

## `show_decision_log` chat-card

Builds on top of the design-decomposition family rather than expanding it. After Athena has helped a user work through a design (across walkthroughs, use-case decompositions, trigger sets, tier choices), she can emit `show_decision_log { intent, decisions }` to surface the audit trail of choices made so far. Each decision has a `label` (what was decided), `choice` (what was picked), `rationale` (one sentence why), and optional `timestamp`.

The widget renders a vertical timeline (subtle fuchsia rail + node dots) where each row reads `<label>  →  <choice>` with the rationale below in a smaller caption. Same-day timestamps show as `HH:MM`; older entries collapse to `MMM D`. Auto-fire chat-card; advisory not pinnable.

Helps two cases: (1) the user wants to retrace reasoning without re-reading the whole conversation; (2) the user is reviewing a built persona later and wants to know why a specific choice was made. Constitution bumped to v15.

### Cross-session persistence

The dispatcher auto-persists every `show_decision_log` entry into a new `companion_design_decision` SQL table in the user db (additive schema, no migration of existing rows). One row per `{label, choice, rationale}` entry; `persona_context` defaults to the `intent` field of the card so future queries can filter to "decisions about persona X" or "decisions about this build session". Rows are immutable — to "correct" a decision, Athena emits a fresh `show_decision_log` with the updated entry; the original stays put so retrospective analysis sees the actual sequence of choices.

Retrieval surface: `companion_list_design_decisions(personaContext?, limit?)` Tauri command — frontend can list everything Athena's ever decided, or scope by context. The widget header shows a small "Saved" badge so users know persistence is active.

The Companion plugin page exposes a new **Decisions** sub-tab (`sub_decisions/DecisionsPanel.tsx`) that lists every saved decision grouped by `persona_context`, with a filter input that server-side scopes the query. Rows are immutable in the UI — to "correct" a decision the user asks Athena to re-emit a `show_decision_log` with the updated entry; the original stays put.

**Auto-scope to active build intent.** When the user is mid-build, `UnifiedBuildEntry` mirrors the intent textarea into the system store's `activeBuildIntent` slot. On first mount, the Decisions panel snapshots that slot and pre-fills its filter with it — and renders a fuchsia "Currently designing: …" banner above the filter input with a "Show all" affordance that clears the filter and the slice. Clears automatically on successful build launch (the slot resets to null in `handleLaunch`'s success branch). State is not persisted (session-scoped UI affordance — surprising to resume across app restarts).

## `show_persona_ready` chat-card — design → build closer

The end-of-design recap. Athena emits `show_persona_ready { intent, summary, recommended_action }` after she's worked the user through the design decomposition (walkthrough → use_cases → triggers → tier → observability) and there's enough decided to commit.

`summary` carries the refined intent line plus optional rollups of system prompt outline, use case labels, trigger labels, model tier, and observability plan one-liner. `recommended_action` picks the primary button shape:

- `interactive` (default) — fires the prefill flow with `autoLaunch=false`; user lands in `UnifiedBuildEntry` with the intent filled in and drives the build through the standard gate flow.
- `build_oneshot` — same prefill but `autoLaunch=true` + `mode=one_shot`; Athena will decide everything and ping when done.
- `use_template` — skip prefill, route to the template gallery; Athena should have already named the recommended starter in her chat reply.

Widget renders an emerald-accented card with a "Refined intent" lead-in box, optional rows for each summary field that's populated, a contextual hint string, and a primary button. Closes the design → build loop without requiring an explicit handoff message. Constitution bumped to v16.

## `show_design_capabilities` onboarding card

The design-family has eight chat-card ops (walkthrough, template suggestions, use_case_set, trigger_set, model_tier_choice, observability_plan, decision_log, persona_ready). For new users that's a lot of vocabulary to discover by accident. The `show_design_capabilities` op surfaces all of them as a single onboarding card with one-line descriptions and example "Try: …" prompts.

Op carries only an optional `intro` line Athena composes for context (e.g. "Here's what I can help you design today — pick whichever angle fits where you are."). The capability list itself is hardcoded in the widget so users get a true picture of what's available, not a model-generated (and potentially hallucinated) list.

When adding a new design-family op, mirror the addition in `DesignCapabilitiesWidget` so onboarding stays current. Constitution bumped to v17.

## `show_recent_decisions` compact recall chip strip

Lighter cousin of `show_decision_log`. Athena emits `show_recent_decisions { persona_context, limit? }` when she wants to remind the user of prior choices without derailing into a full audit-trail render. The widget fetches via `companion_list_design_decisions` on mount and renders 1-5 chips of the shape `<label> → <choice>` (no rationale, no timeline). Renders nothing if the fetch comes back empty — softer than the full DecisionLogWidget; shouldn't hold a slot with an empty state.

Constitution bumped to v18. With this, Athena has two complementary surfaces for recalling design decisions: heavy (`show_decision_log` for a deliberate audit-trail render) and light (`show_recent_decisions` for a glanceable "by the way…" reminder).

## Slash-command palette

Typing `/` as the first character of an empty draft opens a small popover above the composer with a set of preset prompts (`SlashPalette.tsx`): show goals, what's queued, recent decisions, live ops, memory recap, capabilities. Subsequent keystrokes filter the list by case-insensitive substring on label or key; ↑/↓ navigate; Enter picks; Esc clears the draft and closes. Click works the same as Enter. Preset messages are i18n'd so non-English users get prompts in their own locale — Athena handles all 14 supported languages in chat.

The Send button stays disabled while the palette is open so typing `/` then Enter goes through the palette path (pick the active preset) instead of submitting the literal `/` as a chat message.

## Refine chips

Below the latest completed assistant bubble only, `RefineChips` renders three small affordances — **Shorter**, **More detail**, **Code only** — that resend the prior user message with a localized steering suffix appended ("— much shorter, please.", "— go deeper, with examples.", "— code only, minimal prose."). Click feeds the modified prompt through the same `send()` path used by the composer, so the optimistic-bubble / streaming / TTS pipeline kicks in identically. Disabled while streaming or improving. Older bubbles in scrollback don't render chips — refining a mid-scrollback turn is a different, higher-effort UI that needs to model "which user message do I resend?" carefully.

## On-demand read-aloud (per assistant bubble)

When voice is configured for the user's chosen engine (ElevenLabs needs credential + voice id; Piper needs a piper voice id), a small `BubbleReadAloud` button renders below the latest completed assistant bubble. Click → synthesizes the message via the existing `companion_tts` IPC, plays through a transient `<audio>` element, swaps to a "Stop" affordance during playback, and reverts to idle on end so the user can replay. Independent of the main TTS pipeline (which fires automatically when `voiceEnabled` is on) — this is for the "I didn't have voice on, but I want to hear what Athena just said" path. Skipped when no engine is configured to avoid hitting the backend just to surface an error.

## Voice

Voice playback dispatches to one of two engines, picked by the user in the Voice tab's engine selector. The slice persists `companionVoiceEngine: 'elevenlabs' | 'piper'`; per-engine identity (credential, voice id) lives in dedicated slice fields so switching engines doesn't clobber the other side's last selection.

Backend code lives under `src-tauri/src/companion/tts/` with one submodule per engine; `commands/companion/voice.rs` is a thin dispatcher that validates input (text length, voice-id format) and routes to the right impl.

### ElevenLabs (cloud)

Backend proxy: the frontend sends text + credential id + voice id + tuning settings to `companion_tts`; the backend reads the decrypted Vault credential, calls ElevenLabs, and returns base64 MP3 (`audio/mpeg`) plus MIME metadata. API keys do not cross into the webview. Allowlist of model ids is server-side (`tts/elevenlabs.rs::TTS_ALLOWED_MODELS`).

### Piper (local)

Local synthesis via the official rhasspy/piper binary as a subprocess. No network at synth time; no credential needed. Two preconditions:

1. **Engine binary** at `~/.personas/companion-tts/bin/piper(.exe)` (or `PERSONAS_PIPER_BIN` override, or on PATH). The Voice tab surfaces an Installed/Not-installed badge plus the expected install path; users drop the official Piper release zip's `piper.exe` (Windows) or `piper` binary (mac/Linux) into that path. Status is reported by `companion_tts_piper_engine_status`.

2. **Voice model** under `~/.personas/companion-tts/piper/<voice-id>/` containing `<voice-id>.onnx` + `<voice-id>.onnx.json`. Voices are picked from a curated catalog (`tts/catalog.rs::PIPER_VOICES`, ~17 voices spanning 14 languages) and downloaded from `huggingface.co/rhasspy/piper-voices` via `companion_tts_download_piper_voice`. Atomic via `.partial` rename. Progress streams on the `companion://tts-download` event channel (throttled to 250ms / 1MB increments). `companion_tts_list_piper_voices` returns the catalog with each row's `isDownloaded` checked from disk; `companion_tts_delete_piper_voice` removes a voice's directory tree.

Synthesis spawns piper with `--model voice.onnx --config voice.onnx.json --output_file <tempfile>`, writes the text on stdin, and reads the resulting WAV from disk. Result: `audio/wav` base64 plus MIME metadata (note the difference from ElevenLabs' MP3 — both are HTML5 `<audio>`-decodable, no frontend sniffing needed).

**Why subprocess instead of in-process bindings?** The published `piper-rs` crate pins `ort = "=2.0.0-rc.11"` while we ship `2.0.0-rc.9` for fastembed. Two ORT versions in one process is a recipe for the same DLL-version-mismatch panic Cargo.toml warns about. Subprocess isolation gives us the official Piper Windows release (with its bundled `onnxruntime.dll`) without touching our ML stack. The cost is per-call subprocess overhead (~50–100ms), well under the synthesis time of even a one-sentence reply.

### Language coverage UX

The Piper voice browser groups voices by BCP-47 language. The user's current app locale is matched against voice prefixes (`en` matches `en-US` / `en-GB`, `cs` matches `cs-CZ`); matching groups are promoted to the top with a "Your language" badge. When no Piper voice covers the user's locale, the panel surfaces a fallback callout pointing them at ElevenLabs.

## Voice input (speech-to-text)

Athena's hold-to-talk (footer + orb) routes through `useSpeechInput`, which picks the engine from `companionSttEngine`:

- **`browser`** (default) — the Web Speech API in the renderer (`useDictation`). Zero setup, but on WebView2 the audio is forwarded to the OS vendor's cloud STT (disclosed in the Voice tab).
- **`whisper`** — on-device transcription via a sidecar `whisper-cli` binary (`useLocalDictation`). The mic is captured through an `AudioContext` pinned to 16 kHz mono, encoded as a WAV in the renderer, and sent to `companion_stt_transcribe` — audio never leaves the machine. It's batch (no live interim), so `listening` stays true through the transcription round-trip to preserve the hold-to-talk contract.

Backend lives under `src-tauri/src/companion/stt/` mirroring the Piper TTS layout: `whisper.rs` (sidecar lookup `PERSONAS_WHISPER_BIN` → `~/.personas/companion-stt/bin/` → PATH; spawns `whisper-cli -m model -f wav -nt -np [-l lang]`), `catalog.rs` (curated ggml model allowlist), `downloader.rs` (atomic `.partial` download from `ggerganov/whisper.cpp`, progress on `companion://stt-download`). Commands: `companion_stt_transcribe`, `companion_stt_list_models`, `companion_stt_download_model`, `companion_stt_delete_model`, `companion_stt_engine_status`. The Voice tab's `SttPanel` exposes the engine selector, install status, and model browser. **Two preconditions for the local engine** (same UX as Piper TTS): a `whisper-cli` binary at `~/.personas/companion-stt/bin/`, and a downloaded model.

**Why subprocess (same rationale as Piper):** users can swap newer whisper.cpp builds without recompiling, and the engine's ggml/BLAS stack stays in its own process.

## Self-improve loop

When beta self-improve is enabled, `companion_request_improvement` runs a coding CLI session against user feedback. The result reports success, summary, modified files, critical files, elapsed time, and any error. Startup recovery checks for orphaned runs after Tauri dev reloads.

## State

`src/features/plugins/companion/companionStore.ts` owns panel state, init status, messages, streaming text, approvals, quick replies, brain viewer cursor, self-improve state, and pending playback. `companionPluginSlice.ts` owns the plugin page tab and persistent plugin-level settings.
