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

## Chat transcript & message UI

The panel body (`CompanionPanel.tsx` → `Bubble.tsx`) is the primary reading surface and carries most of the chat-window polish:

- **Bubbles & grouping.** Assistant turns sit on a defined surface (tint + hairline border + faint elevation) with a small static Athena avatar in the gutter; user turns are right-aligned with a primary tint. Consecutive same-role messages **group** — only the first shows the avatar, the rest align under it with tightened spacing (`groupStart`/`groupEnd` computed in the panel map).
- **Per-message hover actions.** Hovering (or focusing) a message reveals a copy button (shared `CopyButton`, copies the clean markdown source) and a live relative timestamp (shared `RelativeTime`). The row uses a `grid-rows` 0fr→1fr collapse so it adds zero height when idle and never shifts layout.
- **Welcome hero.** An empty transcript shows `WelcomeHero` — Athena avatar + greeting + starter-prompt chips that fire real messages through `send()`. The chips reuse the translated slash-palette presets.
- **Guided empty states.** The Decisions panel and the Brain Viewer's per-kind list both render the shared `feedback/EmptyState` primitive (icon + title + hint) with an actionable CTA instead of a dead text block — mirroring the launchpad feel of `WelcomeHero`. Decisions offers **Ask Athena to log a decision** (seeds the chat with a first-person opener via `setPendingPrompt` + `autoSend` and opens the panel); a filtered-empty list shows the shared `NoResults` reset instead. The Brain Viewer's CTA is kind-aware: `reflection` runs `companion_run_reflection` and jumps to the new entry, fact kinds kick off `companion_run_consolidation` (toast points at the Memory-tab review), and every other kind opens the chat seeded with a "help me add the first entry" prompt.
- **Streaming state.** The streaming bubble shows the live phase label (e.g. "Searching the web…") paired with animated `TypingDots`; granular progress comes from the **narration timeline live log** (`NarrationThread.tsx` — the dimmed history of this turn's `PROGRESS:` beats + tool calls with durations, last 5 rows + "+N earlier"), the `OperationalThread` checklist (with a progress bar), and the slow-progress hint chip. Reduced motion holds the dots static.
- **Narration trail.** When a turn used 2+ tools (or any model-authored beat), a collapsed **"What I did — N steps · 48s"** disclosure persists under the completed bubble — the promoted narration timeline (`narrationByEpisodeId`, same promote-on-finish model as the recall strip). Session-scoped; trivial trails are dropped. See [`conversation-orchestration.md`](./conversation-orchestration.md) (D2).
- **Bottom-aware autoscroll.** `useChatScroll` keeps the transcript pinned to the bottom only while the user is already there; once they scroll up to read history, new content stays put and a floating **Jump to latest** pill appears. Soft top/bottom scroll-fade masks (`companion-scroll`) dissolve messages into the panel chrome at the edges.
- **Markdown rendering.** Athena's replies render through the shared `MarkdownRenderer` scoped to the chat via `className="athena-chat-md"` + the opt-in `codeBlockActions` prop (other call sites are unaffected). This gives: code blocks with a language-label header + copy + line-wrap toggle + collapse for blocks over 16 lines; a palette-tuned syntax-highlight theme (with a light-theme variant); styled GFM task-lists and zebra-striped tables; external-link affordances; and the inline `chart` bar block. The same treatment is reused inside `ConnectorCallCard` results and `ApprovalCard` params.
- **Day separators.** A centered date chip (Today / Yesterday / locale date) marks the first message of each new calendar day.
- **Header actions & search.** The header carries a **search** toggle (opens an in-transcript find bar — `ChatSearch` overlays matching messages with a live count, backed by `chatSearchOpen`/`chatSearchQuery` in the store) and a **copy-conversation** action (serializes the transcript to role-labeled markdown via the shared `CopyButton`).
- **Failed-turn retry.** When a send errors, the error chip offers a Retry that re-sends the last user message.
- **Autonomous mode** gives the panel a breathing primary border (`companion-autonomous`) and rings the header avatar so a self-driving Athena is unmistakable.

The connector/schedule/event pickers open through `ComposerPickerShell`, which portals to `document.body` so it's never clipped by the panel's blur/transform/overflow, and is viewport-responsive (grid scales 2→3→4 columns, panel up to 88vh).

## Floating dockable orb (`minimized` state)

Step 2 of [`athena-orb-overlay-plan.md`](./athena-orb-overlay-plan.md) promotes Athena out of the footer into a first-class overlay. A new `CompanionState` value `minimized` (between `collapsed` and `open`) shows `AthenaOrb` — her avatar as a draggable orb portal'd to `document.body` above all app content (`orb/AthenaOrbLayer.tsx`, `orb/AthenaOrb.tsx`).

- **One pointer surface, three gestures:** tap → open the full chat panel; hold (≥220ms) → dictate a voice turn (via the same `useHoldToTalk` → `voiceTurnRequest` path as the footer); drag past ~6px → relocate. A drag cancels an armed hold so moving never records. While listening, the interim transcript shows as a caption beside the orb.
- **Dock + persistence:** on drop the X position snaps to the nearest side edge; position is stored as viewport fractions (`companionOrbPos`) and resolved to pixels at render so it survives window resizes and restarts. A hover-revealed `×` dismisses the orb (→ `collapsed`).
- **Footer + panel wiring:** when the orb is enabled (`companionOrbEnabled`, default on, toggled in Companion → Setup → "Floating avatar"), the footer button summons/hides the orb (`minimized ↔ collapsed`) and the chat panel's close button returns to the orb instead of vanishing. `AthenaOrbLayer` promotes a dormant (`collapsed`) Athena to `minimized` once on mount so the presence is there from launch. With the orb disabled, the footer keeps its classic open/collapse behavior.

**Polish (Step 2b).** Opening from the orb morphs the panel out of the orb's position (it flies + scales from the orb's recorded center, anchored to the panel's bottom-left corner, and collapses back on close). A global **Cmd/Ctrl+Shift+A** summons Athena and starts a voice turn (press again to send, **Esc** to cancel — the shared `useHoldToTalk` instance lives in `AthenaOrbLayer` so the orb and the keyboard drive one session). All of it honors `prefers-reduced-motion`.

**Audio-reactive glow.** While Athena speaks, a bloom behind the orb pulses with her actual voice level. `voicePlayback.play()` routes every TTS `<audio>` through a single shared `AnalyserNode` (`audioLevel.ts`); the orb subscribes via `subscribeAudioLevel` and drives the glow's opacity + scale imperatively in a `rAF` callback (no per-frame React re-renders). The tap is best-effort — if Web Audio is unavailable it silently degrades and playback is unaffected. Under `prefers-reduced-motion` the glow is a static bloom (no subscription).

**Message reaction.** When a reply finishes (streaming `true → false`), the orb bumps a `messageNonce` that `AthenaAvatar` consumes to play a one-shot `athena_message_loop.mp4` clip: it crossfades in immediately, plays one loop (~10s, raises arms and back), then reverts to the sticky state. For that one loop the orb border glows in the theme `primary` colour (the avatar fires `onMessageActiveChange(true/false)` at clip start/end so the glow lasts exactly one loop). No-op under `prefers-reduced-motion`.

**Avatar resource discipline (`AthenaAvatar`).** The footer + orb videos are a nice-to-have in a tiny space, so: only one clip plays at a time (others paused at frame 0); **playback pauses whenever the document is hidden** (`visibilitychange`) and resumes on return — zero decode while backgrounded; and under `prefers-reduced-motion` **no `<video>` mounts at all** — just the static poster (`athena_baseline.jpg`), so reduced-motion users pay no decode and get no animation. Clips are 320×320 / 12fps / CRF 30 / no-audio ping-pong (~110–160 KB), hardware-decoded.

**Orb progress dots (async-UX phase 3).** While background tasks run, the minimized orb grows up to 5 pulsing dots arced across its top perimeter — one per in-flight task (queued + running, from `jobsById`). The orb also borrows the `thinking` avatar posture so a working Athena reads as active even with the panel minimized, and its `aria-label` announces the count ("2 tasks running"). The dots vanish as tasks complete. This is the minimized-state twin of the activity tray: tray when open, dots when minimized.

## Guided walkthroughs (orb choreography + element glow)

Athena can *show* the user how to do something instead of only telling them: her orb glides to each key area of the screen, the relevant element glows (a non-dimming accent ring — the rest of the UI stays visible and clickable), and she narrates each step in a caption beside the orb. This is driven by a reusable engine — a topic-keyed registry of declarative steps (`guidance/walkthroughs.ts`), a runner (`guidance/useGuidanceRunner.ts`) that walks them, the `AthenaGuideGlow` ring + `GuideCaption` (hosted by `AthenaGuideLayer`), and the orb's programmatic glide (an ephemeral `orbGuideTarget` in `companionStore`). The element-tracking core (`useTrackedElementRect`) is shared with the onboarding `TourSpotlight`.

When a user describes a persona they want, Athena offers both paths via `show_persona_creation_offer` — a card with **Build it for me** (the prefill / one-shot handoff) and **Show me how to build it** (`start_guided_walkthrough { topic: "persona_creation" }`). The first walkthrough rings the build studio, its sigil compose trigger, and the autonomous toggle. New ops are taught in constitution **v19**; topics are allow-listed in `dispatcher.rs` (`GUIDED_TOPICS`). Full design + the "how to add a walkthrough for any surface" recipe live in [`athena-guided-walkthroughs.md`](./athena-guided-walkthroughs.md).

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

Approval outcomes may include a client-side action such as `{ type: "navigate", route }`. One such action, `{ type: "open_external_url", url }`, backs the **open test environment** capability: when you ask Athena to open/launch a dev project's test environment (test env / staging), she proposes an `open_test_env` action; on approval the backend resolves the project and returns its configured test-environment URL, which the frontend opens in the browser via the validated `open_external_url` command. The project must have a test-environment URL set in Dev Tools first, or the action errors with a hint to set it.

## Recall preview strip

Each turn, after the prompt builder runs but before the CLI spawns, the backend emits `companion://recall-preview` carrying a `CompanionRecallPreview`: `episodeCount` plus titled entries for doctrine, facts, procedurals, goals, and backlog (capped at 60 chars per title, server-truncated with an ellipsis). A `synthesized` flag indicates the recall was over budget and was folded through `recall_synthesis` into a focused briefing.

The panel renders this as a thin `RecallStrip` collapsed above each assistant bubble: a single-line summary ("Athena replayed 5 recent turns and consulted 12 memories") that expands on click to show the actual titles grouped by kind. The strip persists on the bubble for the rest of the session; an app restart drops the strip (recall is ephemeral working memory).

Stage 2 wired: each chip is a button that calls `setBrainView({ open: true, kind, id })` to open the Brain Viewer as an overlay over the chat transcript, jumped straight to the detail view for that memory. Group→kind mapping matches the backend's parent kinds (`doctrine`, `fact`, `procedural`, `goal`, `backlog`) — `companion_get_brain_item` dispatches `fact` / `procedural` / `goal` / `backlog` to the scoped fetchers so the parent-kind lookup resolves whichever scoped variant owns the id. Closes the loop from "what did Athena consult this turn" to "what's actually in that memory."

**Detail-view linked memories.** Inside the BrainViewer's DetailView, the rendered markdown is also scanned for memory-id tokens (`goal_xyz`, `procedural_abc`, `design_decision_def`, etc. — see `parseBrainLinks.ts` for the full kind list). Each unique reference becomes a small chip in a "Linked memories" strip below the content (via the shared `BrainLinksStrip` component); click → opens that memory's DetailView in place. Lets the user traverse the brain as a graph instead of a flat list. Orchestration tokens (`op_xxxx`, `sess_yyyy`) are intentionally excluded — they don't have a BrainViewer destination.

**Chat-bubble linked memories.** The same scan runs against the body of every completed assistant bubble — when Athena's reply mentions one or more brain ids, a tighter `inline`-variant chip strip renders directly below the bubble with the same click → setBrainView wiring. Skipped during streaming (partial text would make the chip set flicker as tokens come and go mid-reply). The chat is where Athena names memories most often, so this closes the graph-traversal loop where it pays off most.

## Turn-summary chip

Below each assistant bubble, a tiny caption-sized chip (`TurnSummaryChip`) surfaces what Athena's reply *did* — distinct from what she *said*. The chip aggregates dispatcher outputs from the same turn (pending approvals, direct navigations, lab tab opens, dashboard / cockpit auto-fires, inline chat-cards) plus a flag for `continue_autonomously`. Total-zero turns render nothing.

Source: the backend emits one `companion://turn-summary` event per turn after the dispatcher block, already keyed by the persisted `assistant_episode_id` so the panel can attach the chip to the right bubble without correlating turn ids. Same session-scoped persistence model as the recall preview — lost on app restart.

The clickable parts — `approval`, `card`, `composed dashboard`, `composed cockpit` — are buttons that jump to the corresponding surface: `approval`/`card` smooth-scroll the panel to the approvals or chat-cards container; both `dashboard` and `cockpit` navigate to home → cockpit. (The dedicated companion **Dashboard tab was retired** — Cockpit is the dynamic dashboard surface now, so a `compose_dashboard` auto-fire and its turn-summary chip both route to Cockpit.) Parts without a meaningful destination — `navigated` (already happened), `lab` (no agent id carried in the event), `continuation` (informational) — stay as captions.

## Connector-call live status cards

Athena's `use_connector` op auto-fires (no approval, by design — see `src-tauri/src/commands/companion/approvals.rs:207-210`) and enqueues a background `connector_use` job. The job worker dispatches through `src-tauri/src/companion/jobs/connector_use.rs::dispatch_capability` (Sentry / GitHub / Slack / Gmail today, with a fallback echo for unwired capability slugs).

Previously the user only saw the result as a system episode after Athena ingested it on her next turn. Now the panel subscribes to the `companion://job` event channel and renders an inline `ConnectorCallCard` per in-flight or terminal `connector_use` job, pinned under the assistant bubble that produced it:

- **queued** — hourglass + neutral border
- **running** — spinning loader + blue border; shows the job's live `progressText` ("Calling Sentry…") when present, falling back to the static in-flight hint
- **completed** — check + green border, result-markdown collapsed until click
- **failed** — alert + rose border, error text collapsed until click; surfaces a `Retry` button (Cycle 5) that re-enqueues the same paramsJson via `companion_enqueue_job`. The retried job's live status (queued → running → completed / failed) renders inline below the original failed card, subscribed via the global `jobsById` map so the user doesn't have to scroll the panel hunting for the new card (Cycle 10).

The running handler reports intermediate progress through a `JobProgress` reporter (`src-tauri/src/companion/jobs/mod.rs`) that re-emits the job row with a transient `progressText` on the same `companion://job` channel — event-only, never persisted, so the terminal emit clears it. `connector_use` reports "Calling {service}…" before the HTTP call; `scan_codebase` reports "Scanned N files…" every 2,000 walked entries.

Cards correlate to turns via the same pending → episode-id promotion the recall strip uses (jobs queued during streaming live in `pendingConnectorJobIds`; at the `finished` stream event they move into `connectorJobIdsByEpisodeId[assistantEpisodeId]`). No new IPC — the existing `companion://job` event channel carries everything the card needs.

## Activity tray & generic task tags (async-UX phase 2)

The connector-call card is the rich, per-call detail surface. Alongside it, a persistent **activity tray** (`ActivityTray.tsx`) docks just above the composer and lists **every** in-flight task across the whole session — not turn-bound — so parallel work from different turns is glanceable in one place. It reads the same `jobsById` map, filters to `queued`/`running`, sorts running-first, is collapsible, and renders nothing when idle.

Each tray row (and any in-chat tag for a non-`connector_use` kind) is a compact `TaskTag.tsx`: status icon (queued hourglass / running spinner / done check / failed alert), the task's `short_title`, a determinate progress bar when the handler reported `progress_current`/`progress_total` (e.g. a codebase scan's "8/17"), otherwise the live `progress_text` note, and a status label. `connector_use` keeps its richer `ConnectorCallCard`; every other kind (`scan_codebase`, `memory_curation_run`, …) uses the lightweight tag.

In-chat pinning generalizes the connector mechanism: `connector_use` always pins under its spawning bubble (it only auto-fires mid-turn); any other kind enqueued **while a turn is streaming** also pins there. Tasks spawned from an approval click while Athena is idle don't squat on the transcript — they appear only in the tray. Strings: `plugins.companion.task_status_{queued,running,done,failed}` + `tasks_running_{one,other}`.

## Non-blocking conversation (async-UX phase 4)

The composer is **never disabled while a turn is streaming** — the user can always type. A mid-turn send is classified by `classifyMidTurnIntent` (`midTurnIntent.ts`):

- **Redirect** ("stop", "wait", "actually…", "instead…", "cancel", "no, …") → **interrupts** the in-flight turn (the existing `companion_interrupt_turn` path kills the CLI child and finalizes the partial reply as `[interrupted]`) and queues the new message.
- **Additive / ambiguous** ("and also…", "when you're done…", or anything that isn't a clear redirect) → **queues** behind the current turn. The default is queue: an ambiguous message never destroys running work (the user can hit Stop explicitly).

Queued messages live in `companionStore` (`queuedMessages` + `enqueue/shift/remove/clear`) and render as cancellable chips above the composer (`QueuedMessages.tsx`). A streaming-edge effect drains them **one per turn completion** (FIFO), so order is preserved and the drain never collides with the autonomous-continuation chain.

On the model side, an always-on **"delegate, don't inline"** prompt addendum (`prompt.rs` `delegation_addendum`) tells Athena to kick long work off as a background task and reply immediately ("I'm pulling that — back in a moment") rather than holding a silent turn open for minutes. The activity tray + orb dots are what make that delegation observable, so the three phases compose: Athena delegates → the task shows in the tray/orb → the user keeps talking while it runs.

**Long in-turn tool calls as tasks.** Some work happens *inside* Athena's CLI turn — a `WebFetch`, a `Bash` command, a `Task` subagent, any globally-configured MCP tool — which the backend can't offload (it runs in the opaque subprocess). To keep those from looking like a frozen turn, `extractToolEvents` parses `tool_use` / `tool_result` events from the CLI stream and `CompanionPanel` times each call; one that stays pending past a threshold (`IN_TURN_TOOL_THRESHOLD_MS`, 6s) is promoted to a synthetic task in `companionStore.inTurnToolJobs` (kept separate from `jobsById` so it never pins in-chat — the streaming-phase chip already shows the in-bubble view). It surfaces in the activity tray + as an orb dot, completes on its `tool_result`, and the map clears at turn end. Fast tools never reach the threshold, so they never flicker; `TodoWrite` is excluded (it has its own checklist UI).

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

## Project goals (dev direction) — read + propose + react

Athena is wired into the project [Goals](../goals/README.md) surface at the **read + propose, writes-gated** authority level:

- **Read** — `prompt.rs::format_project_goals(sys_db)` injects each dev project's active goals (id, progress, status, latest signal) into her system prompt (appended to the plugins block, in both the ml and non-ml builders), so she's aware of project direction and can reference a goal by id.
- **Propose (gated)** — the `update_dev_goal { goal_id, status?, progress?, note? }` op (`ALLOWED_ACTIONS` + `execute_update_dev_goal` in `approvals.rs`, constitution **v27**) lets her propose a status/progress change. It is **approval-gated and deliberately NOT in `AUTOAPPROVE_ALLOWLIST`** — goal writes never auto-resolve, even in autonomous mode. On approval it writes an `athena_update` `dev_goal_signal`.
- **React (proactive)** — `proactive::triggers::dev_goal_nudges(sys_db)` emits budget+dedupe-gated nudges (`dev_goal_target`, `dev_goal_stalled`) when a project goal is target-approaching/overdue or stalled (in-progress/blocked, untouched ≥ 7 days). Because `dev_goals` live in the main app DB, it's passed as `extra` candidates to `evaluate_with_extra_candidates` from the manual `companion_evaluate_proactive_now` (`state.db`) and the desktop tick (`app.state()`). On engage, the prompt context lets her reason and propose the gated update.

## Incidents (proactive blocker nudge)

Athena proactively surfaces OPEN high/critical [audit incidents](../overview/README.md) so the user is nudged about them even while away/unattended.

- **React (proactive)** — `proactive::incident_triggers::incident_blocker_nudges(sys_db)` emits a single budget+dedupe-gated nudge (`trigger_kind = incident_blocker`) when there are OPEN incidents at `severity in (high, critical)`. It reuses `audit_incidents::list` (filtered to `status=open`, severity high/critical), is priority-ordered (critical first), count-aware in the message, and anchors `trigger_ref` on the most-severe incident's id. Because `audit_incidents` live in the main app DB, it's passed as `extra` candidates to `evaluate_with_extra_candidates` from both the manual `companion_evaluate_proactive_now` (`state.db`) and the desktop tick (`app.state()`) — exactly like `dev_goal_nudges`.
- **Engage** — clicking Engage on the `ProactiveCard` (rose accent, "incident needs attention" label) navigates to the **Overview → Incidents** inbox (`setSidebarSection('overview')` + `setOverviewTab('incidents')`). Landing on the inbox is the goal; deep-linking to a specific incident detail is a deliberate follow-up.

## Fleet analysis (`analyze_fleet`)

The post-certification "are the teams on track?" review. When the user lets all teams run and risks losing the thread, Athena can review the fleet against the certification rubric and propose fixes.

- **Op (gated)** — `analyze_fleet { team_id?, days? }` (`ALLOWED_ACTIONS` in `dispatcher.rs` + `execute_analyze_fleet` in `approvals.rs`). Approval-gated because it spawns a CLI reasoning turn (cost), same rationale as `run_persona` / `assign_team`. Omit `team_id` to review the whole fleet; `days` defaults to 14.
- **What it does** — `spawn_fleet_analysis` first **pre-gathers** a compact per-team digest from the **operational store** (`state.db` = `personas.db`: exec counts, outcome distribution, failures, cost, avg `director_score`, **goal engagement** — `gather_fleet_digest`) — per team it reports whether a `team_assignment` is **ADVANCING** a goal vs the goal merely sitting on its pinned project (`has-goal/NOT-advancing`), each goal's **progress % + breakdown to-dos done/total** (`dev_goal_items`), **blocker count** (`dev_goal_dependencies`), the **last goal signal** (`team_*`/`athena_update` = the team/Athena working it), and the Director score **band** (excellent/healthy/at-risk/broken) and **embeds it in the directive**. This matters: Athena's `personas_database` connector points at the companion-brain DB (`personas_data.db`), not the execution store, so asking her to fetch the data fails — we supply it. The directive then names the rubric dimensions, and tells her to **recall her prior per-team note** for timeline continuity, **write an updated per-team note** via `write_fact`, and propose a few concrete improvements as gated ops. Spawned via `session::spawn_proactive_turn` (trigger kind `fleet_analysis`).
- **Trigger** — a **Radar** button in the companion toolbar's Assist group (`CompanionToolbar`, `data-testid="companion-analyze-fleet"`) calls the **`companion_analyze_fleet`** Tauri command **directly** (deterministic — it spawns the rubric-graded proactive turn itself). This is by design: routing the button through a chat message let Athena reasonably *shortcut* to an inline read from her observability digest and skip the dedicated turn + the per-team timeline-memory write, so the button bypasses the chat turn entirely. (Athena can *also* propose `analyze_fleet` in chat when asked — both paths share `spawn_fleet_analysis` in `approvals.rs`.)
- **Engine** — the deterministic read-only counterpart is `scripts/test/fleet-analyze.mjs` (per-team execution health, outcomes, Director verdicts, goal links, on-track flags); see [team-orchestration.md](../pipeline/team-orchestration.md). Athena reasons; the script measures.
- **"Ask Athena" from the dashboard (via the orb)** — the Mission Control **Fleet optimization** card (`overview/sub_missionControl/cards/FleetOptimizationCard.tsx`) carries a per-recommendation **Ask Athena** button. Unlike `analyze_fleet` (a gated rubric-graded turn), this is a lightweight forward through the **`useForwardToAthena`** hook (`plugins/companion/useForwardToAthena.ts`). It composes the recommendation (title / description / suggested action + a persona-or-general focus, from `t.overview.fleet_optimization.ask_athena_*`) and then: surfaces the floating **orb** (`state='minimized'`, not the full panel — falls back to `'open'` only if the orb feature is off), fires a one-shot amber "message received" ack glow on the orb (`companionStore.pulseForwardAck` → `forwardAckPulse` → `AthenaOrb`), sends the turn through the always-mounted `voiceTurnRequest` consumer (so it runs panel-closed), and — when voice is enabled + configured — speaks a short scripted, translated acknowledgement (`forward_ack_speech` = "Understood, processing the message.") for immediate feedback while the (often slow) turn spins up. The sibling **Open Lab** button skips Athena and navigates the user straight into the affected agent's Lab in matrix (model-comparison) mode. (Note: the older `pendingPrompt` forward — still used by `CockpitPanel` / `MessageDetailModal` / `GoalsPage` — opens the full panel instead; both consumers now claim their request atomically so StrictMode's dev double-invoke can't double-send.)

## Daily brief (`companion_daily_brief`)

The morning "what happened while I was away" summary. A **Sunrise** button in the
companion toolbar's Assist group (`CompanionToolbar`, `data-testid="companion-daily-brief"`)
calls the **`companion_daily_brief`** Tauri command **directly** — the same
deterministic, button-is-the-consent shape as the fleet-analysis Radar button, and
for the same reason: routing it through a chat message would let Athena shortcut to
an inline read, and her `personas_database` connector points at the companion-brain
DB (`personas_data.db`), not the execution store, so she can't fetch the inbox data
herself.

- **What it does** — `gather_daily_brief_digest` (`src-tauri/src/commands/companion/approvals.rs`)
  pre-gathers a compact digest from the **operational store** (`state.db` = `personas.db`)
  across the three operational inboxes over the last `hours` (default 24, clamped 1–168):
  **Messages** (`persona_messages` — count, unread, elevated-priority + recent titles),
  **Human Review** (`persona_manual_reviews` — new-in-window count plus the current
  all-ages `pending` backlog and its oldest titles, since an overdue review predates
  the window), and **Incidents** (`audit_incidents` — new-in-window plus current
  `open`/`acknowledged` backlog, severity-ordered, high/critical called out). The
  24h window uses `julianday()` math so it's correct across the tables' mixed
  `created_at` formats (RFC3339 for messages/reviews, datetime-text for incidents).
  `build_daily_brief_directive` embeds the digest and tells Athena to write a short,
  skimmable summary directly in chat — lead with the top thing to act on, one or two
  lines per inbox, flag overdue reviews + open high/critical incidents, and close with
  one concrete next action only if something needs it. Spawned via
  `session::spawn_proactive_turn` (trigger kind `daily_brief`), so the brief streams
  back into the panel like any proactive turn.
- **No approval, no new op** — unlike `analyze_fleet`, the daily brief is button-only:
  there is no `ALLOWED_ACTIONS` op and no constitution bump, because Athena never needs
  to *propose* it from chat. The click is the whole trigger.

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

The Companion plugin page exposes a **Decisions** sub-tab (`sub_decisions/DecisionsPanel.tsx`) with an "Atlas" layout (2026-06-10 redesign): a left rail lists every `persona_context` with its decision count ("All contexts" on top), and the reading pane renders the selected context as one spacious timeline thread — decision label as an uppercase kicker, the choice as a full-contrast headline, the rationale as body text. A filter input above the rail still server-side scopes the query; the data/filter/group contract lives in `sub_decisions/useDesignDecisions.ts`. Rows are immutable in the UI — to "correct" a decision the user asks Athena to re-emit a `show_decision_log` with the updated entry; the original stays put.

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

**Chat streaming.** The streaming bubble no longer renders the raw token-by-token text (it reflowed and leaked machine grammar). During a turn it shows a single status line plus the `OperationalThread` checklist; the full prose reply lands in one piece when the turn finishes. The status line is **event-driven** (`extractStreamPhase`): it names the real tool with its input detail ("Searching the web · climate data", "Reading files · runner.rs"), shows "Reviewing result…" on tool returns, and "Composing reply…" while the answer generates, falling back to "Thinking…". When voice is active, a short spoken **ack** (~2.5s in) and **heartbeat** (~30s in) fill dead air and are cut off the moment the real reply plays. Athena can also narrate long turns with her own `PROGRESS:` beats — each completed beat shows in the bubble (outranking the derived phase), is logged into the narration timeline, and is spoken live, suppressing the generic ack/heartbeat. The `PROGRESS:` grammar is **always-on** (its own `progress_addendum()` in `prompt.rs`, not voice-gated — text-only users and proactive turns narrate too; D1) and stripped from the persisted reply by `dispatcher.rs`. This is all three variants (A + B + C) plus the D1/D2 follow-ups from [`conversation-orchestration.md`](./conversation-orchestration.md).

**Voice controls popover.** The chat toolbar's audio button (`VoiceControlPopover`, shown when a voice engine is configured for either ElevenLabs or Piper) opens a popover with: enable/disable spoken summaries, a **volume** slider (`companionVoiceVolume`, default 0.5, applied to every TTS `<audio>` in `voicePlayback.play()` — and **live**: `play()` subscribes to the store so dragging the slider changes Athena mid-sentence; the same slider is mirrored in the Voice tab's engine card), and a **Test voice** button that synthesizes + plays a sample sentence so the user can hear the current engine/voice/volume on demand.

**Settings UX.** All Voice/Setup section headers use a themed (`text-primary`) `SectionCard` title and every dropdown uses the shared `ThemedSelect` (theme-aware) rather than a raw `<select>`. When an ElevenLabs credential scopes resources, both the **voice** and **model** dropdowns populate from the scope — the model dropdown narrows the curated allowlist to the scoped subset (and prefers the scope's live label). Default tuning is Stability 0.70 / Similarity 0.70 / Style 0.05 (`companionPluginSlice` defaults; speed + model inherit the engine default). Speech-to-text setup lives in the same tab via `SttPanel`.

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
