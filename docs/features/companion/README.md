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
| Avatar/footer | Athena visual state, footer icon, chime, pending playback | `AthenaAvatar.tsx`, `CompanionFooterIcon.tsx`, `chime.ts`, `voicePlayback.ts` |

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
- `companion://navigate`: direct route switch requested by Athena.
- `companion://stream`: streaming turn output from the backend.
- `companion://recall-preview`: per-turn rollup of what the brain pulled into the system prompt (counts + titles per memory kind).
- `companion://turn-summary`: per-turn rollup of dispatcher side-effects keyed by assistant episode id (approvals / navigations / lab opens / dashboards / cockpits / chat cards / continuation flag).

Approval outcomes may include a client-side action such as `{ type: "navigate", route }`.

## Recall preview strip

Each turn, after the prompt builder runs but before the CLI spawns, the backend emits `companion://recall-preview` carrying a `CompanionRecallPreview`: `episodeCount` plus titled entries for doctrine, facts, procedurals, goals, and backlog (capped at 60 chars per title, server-truncated with an ellipsis). A `synthesized` flag indicates the recall was over budget and was folded through `recall_synthesis` into a focused briefing.

The panel renders this as a thin `RecallStrip` collapsed above each assistant bubble: a single-line summary ("Athena replayed 5 recent turns and consulted 12 memories") that expands on click to show the actual titles grouped by kind. The strip persists on the bubble for the rest of the session; an app restart drops the strip (recall is ephemeral working memory).

Stage 1 of 2 — chips are read-only. Stage 2 will wire each chip to open the Brain Viewer scoped to that entry.

## Turn-summary chip

Below each assistant bubble, a tiny caption-sized chip (`TurnSummaryChip`) surfaces what Athena's reply *did* — distinct from what she *said*. The chip aggregates dispatcher outputs from the same turn (pending approvals, direct navigations, lab tab opens, dashboard / cockpit auto-fires, inline chat-cards) plus a flag for `continue_autonomously`. Total-zero turns render nothing.

Source: the backend emits one `companion://turn-summary` event per turn after the dispatcher block, already keyed by the persisted `assistant_episode_id` so the panel can attach the chip to the right bubble without correlating turn ids. Same session-scoped persistence model as the recall preview — lost on app restart.

## Connector-call live status cards

Athena's `use_connector` op auto-fires (no approval, by design — see `src-tauri/src/commands/companion/approvals.rs:207-210`) and enqueues a background `connector_use` job. The job worker dispatches through `src-tauri/src/companion/jobs/connector_use.rs::dispatch_capability` (Sentry / GitHub / Slack / Gmail today, with a fallback echo for unwired capability slugs).

Previously the user only saw the result as a system episode after Athena ingested it on her next turn. Now the panel subscribes to the `companion://job` event channel and renders an inline `ConnectorCallCard` per in-flight or terminal `connector_use` job, pinned under the assistant bubble that produced it:

- **queued** — hourglass + neutral border
- **running** — spinning loader + blue border
- **completed** — check + green border, result-markdown collapsed until click
- **failed** — alert + rose border, error text collapsed until click

Cards correlate to turns via the same pending → episode-id promotion the recall strip uses (jobs queued during streaming live in `pendingConnectorJobIds`; at the `finished` stream event they move into `connectorJobIdsByEpisodeId[assistantEpisodeId]`). No new IPC — the existing `companion://job` event channel carries everything the card needs.

## Athena-scheduled proactive check-ins (`schedule_proactive`)

Trigger-driven nudges (goal target approaching, backlog aging, cadence due, on-this-day) come from `proactive::triggers::collect_all` and fire whenever the evaluator finds something worth surfacing. The `schedule_proactive` op gives Athena a second path: she commits to a future ping with a specific message at a specific time.

Wire:

- Op: `propose_action: schedule_proactive { message, when_iso }` — created in `src-tauri/src/companion/dispatcher.rs` (`ALLOWED_ACTIONS` entry; same approval-card flow as `write_fact` / `write_goal`).
- Approval executor: `execute_schedule_proactive` in `src-tauri/src/commands/companion/approvals.rs` parses + validates the RFC3339 timestamp (rejects past times), then calls `proactive::insert_scheduled` to persist a row with `trigger_kind='athena_scheduled'` and `scheduled_for=when_iso`.
- Schema: `companion_proactive_message.scheduled_for` (TEXT, nullable). NULL = trigger-driven (delivered as soon as quiet/budget/dedupe pass). Non-NULL = scheduled (held in `queued` until the time arrives). Migration is a defensive `ALTER TABLE` in `db::init_user_db`.
- Delivery: `proactive::deliver_due_scheduled` sweeps for rows with `scheduled_for <= now()` and returns them; `companion_evaluate_proactive_now` calls it alongside `proactive::evaluate` so the same `companion://proactive` event channel surfaces both kinds.
- UI: the existing `ProactiveCard` renders the message — a sky-blue accent + "scheduled by Athena" label disambiguates the kind. Engage / Dismiss work identically.

Why approval-gated when `use_connector` isn't: a scheduled check-in puts a future obligation on the user's attention. Unlike connector calls (which run on pre-greenlit pinned credentials), the consent isn't already present — Athena's "I'll ping you about X in 3 days" needs the user to actually agree before the row lands.

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

## Refine chips

Below the latest completed assistant bubble only, `RefineChips` renders three small affordances — **Shorter**, **More detail**, **Code only** — that resend the prior user message with a localized steering suffix appended ("— much shorter, please.", "— go deeper, with examples.", "— code only, minimal prose."). Click feeds the modified prompt through the same `send()` path used by the composer, so the optimistic-bubble / streaming / TTS pipeline kicks in identically. Disabled while streaming or improving. Older bubbles in scrollback don't render chips — refining a mid-scrollback turn is a different, higher-effort UI that needs to model "which user message do I resend?" carefully.

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

## Self-improve loop

When beta self-improve is enabled, `companion_request_improvement` runs a coding CLI session against user feedback. The result reports success, summary, modified files, critical files, elapsed time, and any error. Startup recovery checks for orphaned runs after Tauri dev reloads.

## State

`src/features/plugins/companion/companionStore.ts` owns panel state, init status, messages, streaming text, approvals, quick replies, brain viewer cursor, self-improve state, and pending playback. `companionPluginSlice.ts` owns the plugin page tab and persistent plugin-level settings.
