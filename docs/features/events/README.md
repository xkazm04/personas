# Events and Triggers

Events and Triggers are the routing layer that lets personas react to schedules, webhooks, filesystem changes, shared events, composite conditions, and other app activity.

## Page host

`src/features/triggers/TriggersPage.tsx` owns the Events section. It reads the active tab from `useSystemStore().eventBusTab`, loads all triggers through `listAllTriggers()`, reads trigger health through `getTriggerHealthMap()`, and lazily mounts heavier canvas tabs.

The Live Stream header includes a shortcut into `Overview -> Events` for the full event log.

## Tabs

| Tab | Behavior | Implementation |
| --- | --- | --- |
| Live Stream | Rolling 24h real-time event stream. The Type column shows the raw event type on a single line (e.g. `document.edited`); the Source column resolves `persona:<id-or-name>` values to the persona's icon + name (other sources keep their cloud/relay glyph). JSON highlighting + detail modal. **System operations surface here too** — e.g. `dev_tools.context_scan_started` / `dev_tools.context_scan_completed` are published to the bus by every context-map scan (manual or triggered) with no target persona, so they appear as observable lifecycle markers (icons in `sub_live_stream/eventTypeMeta.ts`). | `sub_live_stream` |
| Speed Limits | Rate-limit dashboard over trigger/event activity | `sub_speed_limits/RateLimitDashboard.tsx` |
| Test | Manual event test surface | `sub_test/TestTab.tsx` |
| Local Relay | Smee relay control and switch-back to live stream | `sub_smee_relay/SmeeRelayTab.tsx` |
| Cloud Events | Dev-only cloud webhook relay status | `sub_cloud_webhooks/CloudWebhooksTab.tsx` |
| Dead Letter Queue | Dev-only failed event review with checkbox multi-select, bulk retry/discard, event-type/source/error/age filters, and a Group-by-error view that clusters rows by Jaccard similarity so an operator can retry-or-discard an entire failure mode at once | `sub_dead_letter/DeadLetterTab.tsx` |
| Chain Studio | Switchboard for composing trigger chains without a canvas: a sources rail (9 signal types + persona completions), a targets rail, and a routes ledger in between. The targets rail has two tabs: **Personas** (compact name + description cards — persona routes stage into a localStorage draft) and **System events** (built-in operations: **Context Scan Update** and **Memory Reflection**). Arm a Schedule or Event Listener source + a System event target and a commit modal captures the op params (project for context scan; an agent-or-team scope for memory reflection) + trigger config (cadence cron, or the event type to listen for) and persists a real **`SystemOpAutomation`** — a trigger → built-in-op binding the backend scheduler runs (no persona involved). Committed automations show in an "Active system events" panel with enable / run-now / delete. Persona→persona routes carry a cyclable run condition and, via a per-route **Save** (or **Save all**), commit to a real `chain` trigger on the target persona (condition any / success / failure / output-match). Picking the **output match** condition reveals inline JSONPath + expected-value fields and commits as the backend `jsonpath` chain condition. Signal-source routes (schedule / webhook / polling / event listener / file watcher / clipboard / app focus / composite) save through a **configure-&-commit modal** that hosts the full trigger form locked to the source's type — same per-type config and validation as the classic form (cron preview, timezone, secrets) — and creates the trigger on the route's target persona. **Save all** covers direct-committable routes only (signal-source routes need the interactive config step). Below the switchboard, a collapsible **Existing routes** section embeds the live, event-centric inventory of all current routing with inline management (add-listener, disconnect, rename event) — the routing view under `sub_studio/routing/` (formerly the standalone Builder tab, then a "Routes" sub-tab; both retired). It's **one surface** now — no Compose/Routes sub-tab switcher — and committing a route in the switchboard refreshes the inventory immediately, with a live route-count shown in the section header. | `sub_studio/TriggerStudioCanvas.tsx`, `sub_studio/StudioPatchbay.tsx`, `sub_studio/StudioTriggerCommitModal.tsx`, `sub_studio/routing/`, `sub_studio/system_ops/`, `sub_studio/libs/` |
| — System operations | A `SystemOpAutomation` (`system_op_automations` table) binds a trigger to a registered backend op that is **not** a persona execution. The catalog + runner live in `engine/system_ops.rs` (`run_op`, `run_due_schedule_automations`, `dispatch_event_automations`); the background event-bus tick runs due **schedule** rows (cron) and matches **event** rows against live bus events. IPC: `system_ops_list_kinds` / `_list_automations` / `_create_automation` / `_set_enabled` / `_delete_automation` / `_run_now`. The first op, `context_scan`, calls the existing `launch_context_scan` (incremental). The second, `memory_reflection`, enqueues a `memory_reflection_run` / `team_memory_reflection_run` background job (params `personaId` or `teamId`) — the up-to-8-minute CLI pipeline runs asynchronously and its output is a proposal reviewed in Overview → Memories, so a scheduled reflection can never mutate memories unattended. | `commands/infrastructure/system_ops.rs`, `db/repos/system_ops.rs` |
| Marketplace | Curated shared-event catalog and subscriptions. Ships **curated connector API-update feeds** — one subscribable entry per connector with public API docs (e.g. *"ElevenLabs API updates"*). Browse/search/filter by category, subscribe, and the change fires into your triggers/chains as a `shared:<slug>` event. | `sub_shared/SharedEventsTab.tsx` |

> **Chain output forwarding.** A persona→persona route committed from Chain Studio sets `payload_forward: true` in the `chain` trigger config (`sub_studio/libs/studioCommit.ts`), so the target step receives the source step's output as `source_output`. The engine only injects it when the flag is true (`engine/chain.rs`); earlier Studio-built chains advanced control flow but dropped the upstream payload (UAT L1 F-CHAIN-NO-PAYLOAD-FORWARD). Intra-team handoff wiring (`engine/team_handoff.rs`) already set the flag.

> **Destructive-action gate (`unattended_mode`).** Each trigger has a
> `persona_triggers.unattended_mode` — `auto` (default), `dry_run`, or `approval`
> — controlling what happens when it fires UNATTENDED on schedule (UAT P5
> F-NO-DESTRUCTIVE-GATE; the gate is scoped to scheduler-fired schedule/polling
> triggers). **`dry_run`:** at the event-bus execution-creation point
> (`engine/background.rs`) the launched run is flagged `is_simulation`, so
> dispatch suppresses real outbound notification/connector delivery — the run is
> observable but inert. **`approval`:** at the scheduler fire
> (`engine/background.rs`) the event is NOT published; a `pending_trigger_fires`
> row is recorded and the fire is held until a human resolves it
> (`resolve_pending_trigger_fire` republishes the held event on approve, discards
> on reject). The trigger detail drawer exposes the mode
> (`UnattendedModeSection`), the trigger list surfaces held fires
> (`PendingTriggerApprovals`) + a per-row mode badge. Commands:
> `set_trigger_unattended_mode` / `list_pending_trigger_fires` /
> `resolve_pending_trigger_fire`.

> **Row blast-radius cues (`triggerArmState.ts`).** A trigger row reports a
> three-state arm status so an enabled trigger sitting outside its active window
> no longer reads identically to a disabled one (UAT P5 F-TRIGGER-BLAST-RADIUS):
> `disabled` (toggled off), `sleeping` (enabled but outside its `active_window`
> right now — shown with a Moon "Sleeping" badge), or `armed`. `getTriggerArmState`
> is a client-side mirror of Rust `ActiveWindow::is_active_at`. The unattended
> fire-mode is also surfaced on the row via the shared `TriggerModeBadge`
> (dry_run / approval), so both the global list and per-persona rows describe
> "armed to do what" identically.

## Curated connector-API-change events (local-first)

> **Wiring a subscribed feed into a persona (Chain Studio).** Once you subscribe
> to a Marketplace feed, it appears in Chain Studio's **Signals** source rail
> under a **Marketplace** category (`sub_studio/StudioRails.tsx`). Arm a feed +
> a target persona and commit — it creates an **`event_listener`** trigger on the
> persona with `listen_event_type: shared:<slug>`, so the persona runs whenever
> that feed reports a change. The mapping lives in `sub_studio/libs/studioCommit.ts`
> (`draftLinkToTriggerInput`, the `marketplace` `DraftSource` kind); it commits
> directly (no config form) because the subscription fully specifies the event.

> **Baseline + monthly cadence.** The pumper `connector-api-watch` app diffs each
> connector's docs against the snapshot in its change-detected `connector_docs`
> dataset. The **first** run is a baseline (every doc is *New*, so it emits **zero**
> firings — it just records what future runs diff against). Establish it once with
> `node scripts/events/run-connector-baseline.mjs` (needs the pumper server running);
> after that the app's monthly cron (`0 0 6 1 * *`) surfaces real changes as
> `changes.json`, which the bridge bakes into the next release.

The Marketplace ships **curated global events** for connector API changes,
distributed inside each release with **no cloud dependency**. Three stages:

1. **Detection (dev side, `pumper` repo).** A monthly `connector-api-watch`
   pumper app fetches each connector's public `docs_url` (watch list generated
   from `scripts/connectors/builtin/*.json`), converts to Markdown, and uses
   pumper's change-detected Datasets to flag docs that changed. A Claude pass
   diffs old-vs-new and produces a `{ summary, tags[], severity }`. Output:
   `pumper/data/artifacts/connector-api-watch/<job>/changes.json`.
2. **Distribution (dev side, this repo).**
   `node scripts/events/generate-connector-events.mjs [--changes changes.json]`
   emits the watch-list manifest (`scripts/events/connector-docs.manifest.json`,
   copied into `pumper/catalog/connector-docs.json`), merges detected changes
   into the durable ledger `scripts/events/connector-events.ledger.json`, and
   code-generates `src-tauri/src/db/builtin_shared_events.rs` (one catalog feed
   per public-docs connector + the baked firings). The dev reviews the ledger +
   `.rs` diff and commits → it ships in the next release.
3. **Consumption (shipped app).** On startup `db/mod.rs::seed_builtin_shared_events`
   seeds `shared_event_catalog` (feeds) + `shared_event_firings` (baked changes).
   A user subscribes to *"ElevenLabs API updates"* in the Marketplace;
   `engine/shared_event_local_relay.rs` delivers unseen firings (`seq` >
   subscription cursor) onto the bus as `shared:<slug>`, deduped by `source_id`.
   The subscription cursor is seeded at the current MAX(`seq`) so a new
   subscriber gets only *future-release* firings — no historical backfill flood.

The firing payload is `{ connector, label, docs_url, detected_at, summary,
tags[], severity, release_version }`. This is independent of the cloud relay
(`engine/shared_event_relay.rs`), which remains as a secondary path for
cloud-fed feeds. Full design: [`docs/plans/curated-connector-events.md`](../../plans/curated-connector-events.md).

## Scraper Signals (local scraper → Signals)

The **local scraper** (Plugins → Scraper) is an event *producer*, not a
connector: it never presents persona-invoked tools. Each saved scrape pipeline
emits two events on the bus per run (from `engine/scraper.rs::config_run`, which
both the cron scheduler and a manual "Run" flow through):

- `shared:scrape.<configId>.changed` — fired when a run detects **new or changed**
  records (silent on clean no-op runs). Payload: `{ pipelineId, name, dataset,
  new, changed, unchanged, sampleKeys[], status }`.
- `shared:scrape.<configId>.error` — fired when a run **fails** to fetch/extract.
  Payload: `{ pipelineId, name, dataset, error, status }`.

`<configId>` (a UUID) namespaces the events so pipelines never collide (canonical
matching preserves `:`). On **save**, each pipeline registers its two feeds in
`shared_event_catalog` (category `scraper`) and auto-subscribes them, so they
appear as **Signal cards in Chain Studio** exactly like Marketplace feeds — arm a
feed + target persona and the commit path writes an `event_listener` trigger on
`shared:scrape.<configId>.<polarity>`. On **delete** the feeds are removed;
`reconcile_signal_feeds` re-registers feeds for any pre-existing/seeded pipeline at
startup. A persona reacting to a scrape Signal pulls the records with the
`query_dataset` MCP tool (the one scraper tool kept after the connector pivot).
Design: [`docs/plans/pumper-inbuilt-feasibility.md`](../../plans/pumper-inbuilt-feasibility.md) (Phase 1c).

## Trigger editor mechanics

`sub_triggers` contains the reusable trigger list/detail/editing components:

- `TriggerAddForm`, `TriggerTypeSelector`, and config components create typed trigger configs.
- Config families include webhook, schedule, polling, file watcher, event listener, clipboard, app focus, and composite triggers.
- `NlTriggerInput` and `nlTriggerParser.ts` translate natural-language schedule text into structured trigger config.
- `TriggerSchedulePreview`, `RadialCountdownRing`, and `TriggerCountdown` make schedule timing visible before and after save.
- `TriggerExecutionHistory` links a trigger back to executions it caused.
- `DryRunResultView` displays backend dry-run feedback.

## Delivery & hygiene (2026-07)

- **Push dispatch:** a CDC insert on `persona_events` wakes the event→execution dispatch loop immediately (`engine/subscription.rs` wake signal); the 2s/10s poll remains only as a degraded-mode heartbeat, so trigger latency is sub-second and bursts drain without the old 50-events-per-tick ceiling. CDC delivery itself counts drops observably and replays rows written during the startup warm-up window (and now decrypts encrypted payloads before emitting).
- **Event-type vocabulary:** `publish_event` validates the free-form `event_type` against a known-type registry (`engine/event_vocabulary.rs`) — unknown types log a warning with the nearest canonical suggestion (never rejected), and the Events page type filter is fed from the registry (`list_known_event_types`) instead of only the loaded rows.
- **Retention & dead triggers:** cleanup is count-bounded (`event_retention_max_count`, default 10,000 — terminal rows only; DLQ and pending rows exempt) on top of the 30-day age sweep, and the Events header shows an "N skipped" pill (from `get_event_skipped_stats`) so events that fire with no matching subscriber — dead triggers — are visible instead of silently marked Skipped.
- **SLA breach events:** the reliability monitor (`engine/sla_breach.rs`) publishes `sla.breach.opened` / `sla.breach.recovered` onto the bus from the execution-completion path (`source_type = "sla_monitor"`, broadcast — not targeted at a persona). Zero-config, conservative fixed thresholds (≥ 5 consecutive failures, or < 50% success over ≥ 5 decided runs; recovery at 75% with hysteresis); durable per-persona episode dedup (`sla_breach_episodes`) means exactly one enter-event and one recovery per episode. See [overview → SLA breach events](../overview/README.md#sla-breach-events-zero-config). The payload (`SlaBreachEventPayload`) carries `personaId` + reason + streak/rate for healing.

- **Scheduler reliability events:** the scheduler emits two informational (never listener-matched, so they never spawn an execution) bus events, both registered in the vocabulary and given feed labels: `schedule.missed.offline` (scheduled slots discarded while the app was offline — carries `missed_count`) and `schedule.skipped.overlap` (a due fire skipped because a previous run from the same trigger was still active). See [execution → entry points](../execution/01-entry-points.md#schedule-cron) for the full schedule-reliability behaviour (missed-runs badge, overlap skip, lost-fire healing issues, invalid-timezone reason).

## Backend command surface

| Family | Commands |
| --- | --- |
| Event log | `list_events`, `list_events_in_range`, `search_events`, `publish_event`, `list_known_event_types`, `get_event_skipped_stats` |
| Subscriptions | `list_subscriptions`, `list_all_subscriptions`, `create_subscription`, `update_subscription`, `delete_subscription` |
| Testing | `test_event_flow`, `seed_mock_event` |
| Dead letters | `list_dead_letter_events`, `count_dead_letter_events`, `retry_dead_letter_event`, `discard_dead_letter_event`, `bulk_retry_dead_letter_events`, `bulk_discard_dead_letter_events`, `get_dead_letter_config` |
| Shared events | `shared_events_browse_catalog`, `shared_events_refresh_catalog`, `shared_events_subscribe`, `shared_events_unsubscribe`, `shared_events_list_subscriptions` |
| Outbound webhooks | `list_notification_subscriptions`, `get_notification_subscription`, `create_notification_subscription`, `update_notification_subscription`, `delete_notification_subscription`, `test_notification_subscription` |
| Scheduler/triggers | `src-tauri/src/commands/execution/scheduler.rs`, trigger APIs under `src/api/pipeline/triggers` |

## Data flow

1. A source publishes an event, either directly (`publish_event`) or through a domain side effect such as Drive file changes.
2. Communication repositories persist the event and expose it to logs/search.
3. The execution engine/scheduler evaluates trigger and subscription matches.
4. Matching persona triggers enqueue executions or route into chain/composite logic.
5. Failures move into dead-letter handling after retry limits. A **targeted handoff to a disabled persona** dead-letters *immediately* (no retries) with reason "target persona disabled — cascade stalled here", so a stalled team chain surfaces in the Dead Letter Queue (and is replayable once the persona is re-enabled) instead of looking delivered (UAT F-TEAM-STALL-INVISIBLE).

## Outbound webhook notifications

A separate dispatcher (`src-tauri/src/engine/webhook_notifier.rs`) routes the same `persona_events` stream out to user-configured HTTP endpoints — Slack incoming webhooks, Discord channel webhooks, Microsoft Teams incoming webhooks, or a generic JSON POST. Each subscription declares one or more event-type patterns (`execution.finished`, `healing.*`, or the wildcard `*`); the dispatcher polls events on a 5s tick, matches them against enabled subscriptions, renders a Mustache-style template against the event payload, and POSTs the provider-shaped body via `SSRF_SAFE_HTTP`. A single-row watermark in `notification_dispatch_watermark` keeps deliveries idempotent across restarts. The configuration UI lives under Settings → Notifications (`src/features/settings/sub_notifications/components/WebhookSubscriptionsPanel.tsx`); the four `*-webhook` connectors in the vault catalog hand-roll the URL credential for credential-backed subscriptions.

## Discord inbound polling

`src-tauri/src/engine/discord_poller.rs` is the mirror of `webhook_notifier` for the receive side. A 5s background tick scans every enabled persona whose `notification_channels` contains at least one `type: "discord"` entry with `config.pollInbound == true` and `config.channelId` set, then for each such (persona, channel) it:

1. Reads the per-(persona, channel) cursor from `discord_poll_state` (`last_message_id`).
2. Fetches `GET https://discord.com/api/v10/channels/{id}/messages?after={cursor}&limit=50` using the Bot token from the persona's Discord credential.
3. Skips messages from bots (`author.bot == true`) and messages we've already logged in `discord_inbound_messages` (PRIMARY KEY on `message_id`), then for each new message fires `commands::execution::executions::execute_persona_inner` with `input_data = { source: "discord", channelId, messageId, author, content, timestamp }` and `idempotency_key = "discord:{channel_id}:{message_id}"`.
4. Advances the cursor to the newest message id seen, even when the only new message was a bot's own — so the loop can't get stuck behind its own replies.

A second pass within the same tick scans `discord_inbound_messages` for rows whose execution is finished but `replied_message_id IS NULL`, extracts the user-facing reply from the execution's `output_data`, and POSTs it back to the same channel via `POST /channels/{id}/messages` with a `message_reference` to the originating message.

Reply extraction understands the **persona dispatch protocol**: a persona with notification channels emits standalone JSON blocks (`{"user_message": {...}}`, `{"agent_memory": {...}}`, `{"emit_event": {...}}`, `{"outcome_assessment": {...}}`) interleaved with prose. The poller walks every brace-delimited JSON object in the output and posts only `user_message.content` — the meta-narration and the other protocol blocks are dropped. It falls back to legacy envelope keys (`reply`/`message`/`text`/`content`) and finally the raw output, so a persona that just prints plain text still works. Replies are truncated to ~1990 chars with a `… (truncated)` marker so Claude's longer answers don't 400 the post. Failures land in the row's `error` column so a stuck delivery surfaces in inspection without blocking subsequent messages.

If the bot reads a channel but every user message comes back with empty `content`, the poller logs a warning naming the **Message Content Intent** — a privileged intent that must be enabled in the Discord Developer Portal (Application → Bot → Privileged Gateway Intents), without which Discord strips message text from REST responses.

Why polling, not Gateway WebSocket: Gateway is the right long-term answer, but polling is enough for the 1:1 test-channel use case the feature ships with, has no external dependency beyond the bot-token credential already in the vault, and survives restarts trivially via the persisted cursor. The upgrade path is to swap `fetch_new_messages` for a WSS consumer that pushes onto the same dispatch path.

## Slack inbound polling

`src-tauri/src/engine/slack_poller.rs` is the Slack analogue of the Discord poller above; both share the dispatch-protocol reply extractor in `src-tauri/src/engine/channel_reply.rs`. A 5s background tick scans every enabled persona whose `notification_channels` contains at least one `type: "slack"` entry with `config.pollInbound == true` and a channel id (`config.channel` — the key the messaging picker writes; `channelId`/`channel_id` are also accepted), then for each such (persona, channel) it:

1. Reads the per-(persona, channel) cursor from `slack_poll_state` (`last_ts`).
2. Fetches `GET https://slack.com/api/conversations.history?channel={id}&oldest={cursor}&inclusive=false&limit=50` using the Bot token from the persona's Slack credential. Slack returns HTTP 200 with `{"ok":false,"error":"..."}` for most failures, so the poller checks the `ok` field and surfaces `not_in_channel` / `missing_scope` with a hint to invite the bot and grant `channels:history` / `groups:history`.
3. Skips messages authored by a bot (any `bot_id` — which includes the persona's own replies) and Slack system events (any `subtype`), plus messages already logged in `slack_inbound_messages` (composite PRIMARY KEY on `(channel_id, message_ts)`), then for each new message fires `execute_persona_inner` with `input_data = { source: "slack", channelId, messageId, author, content, timestamp }` and `idempotency_key = "slack:{channel_id}:{message_ts}"`.
4. Advances the cursor to the newest `ts` seen (compared numerically, not lexically), even when the only new message was a bot's own — so the loop can't get stuck behind its own replies.

A second pass within the same tick scans `slack_inbound_messages` for rows whose execution is finished but `replied_message_ts IS NULL`, extracts the user-facing reply via the shared `channel_reply::build_reply_text`, and POSTs it back via `POST https://slack.com/api/chat.postMessage` with `thread_ts` set to the originating message's thread root — so replies land in-thread. Replies are truncated to ~39000 chars (Slack's `text` ceiling) with a `… (truncated)` marker; failures land in the row's `error` column so a stuck delivery surfaces in inspection without blocking subsequent messages.

The bot must be a **member of the channel** for `conversations.history` to return messages (otherwise `not_in_channel`). Real-Time Search of private channels and DMs (a later phase) needs a user token (`xoxp`) rather than the bot token — the Slack connector exposes an optional `user_token` field for that. Why polling, not the Events API / Socket Mode: same trade-off as Discord — polling needs no inbound HTTP endpoint, reuses the bot-token credential already in the vault, and survives restarts via the persisted cursor; the realtime upgrade swaps `fetch_new_messages` for an Events / Socket Mode consumer on the same dispatch path.

For deeper routing design details, see [event-routing.md](event-routing.md).
