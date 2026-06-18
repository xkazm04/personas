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
| Chain Studio | Switchboard for composing trigger chains without a canvas: a sources rail (9 signal types + persona completions), a targets rail, and a routes ledger in between. The targets rail has two tabs: **Personas** (compact name + description cards — persona routes stage into a localStorage draft) and **System events** (built-in operations, first one being **Context Scan Update**). Arm a Schedule or Event Listener source + a System event target and a commit modal captures the op params (project) + trigger config (cadence cron, or the event type to listen for) and persists a real **`SystemOpAutomation`** — a trigger → built-in-op binding the backend scheduler runs (no persona involved). Committed automations show in an "Active system events" panel with enable / run-now / delete. Persona→persona routes carry a cyclable run condition and, via a per-route **Save** (or **Save all**), commit to a real `chain` trigger on the target persona (condition any / success / failure); signal-source and output-match routes still stage in the draft but their Save is gated pending a config step. Below the switchboard, a collapsible **Existing routes** section embeds the live, event-centric inventory of all current routing with inline management (add-listener, disconnect, rename event) — the routing view under `sub_studio/routing/` (formerly the standalone Builder tab, then a "Routes" sub-tab; both retired). It's **one surface** now — no Compose/Routes sub-tab switcher — and committing a route in the switchboard refreshes the inventory immediately, with a live route-count shown in the section header. | `sub_studio/TriggerStudioCanvas.tsx`, `sub_studio/StudioSwitchboard.tsx`, `sub_studio/routing/`, `sub_studio/system_ops/`, `sub_studio/libs/` |
| — System operations | A `SystemOpAutomation` (`system_op_automations` table) binds a trigger to a registered backend op that is **not** a persona execution. The catalog + runner live in `engine/system_ops.rs` (`run_op`, `run_due_schedule_automations`, `dispatch_event_automations`); the background event-bus tick runs due **schedule** rows (cron) and matches **event** rows against live bus events. IPC: `system_ops_list_kinds` / `_list_automations` / `_create_automation` / `_set_enabled` / `_delete_automation` / `_run_now`. The first op, `context_scan`, calls the existing `launch_context_scan` (incremental). | `commands/infrastructure/system_ops.rs`, `db/repos/system_ops.rs` |
| Marketplace | Dev-only shared event catalog and subscriptions | `sub_shared/SharedEventsTab.tsx` |

## Trigger editor mechanics

`sub_triggers` contains the reusable trigger list/detail/editing components:

- `TriggerAddForm`, `TriggerTypeSelector`, and config components create typed trigger configs.
- Config families include webhook, schedule, polling, file watcher, event listener, clipboard, app focus, and composite triggers.
- `NlTriggerInput` and `nlTriggerParser.ts` translate natural-language schedule text into structured trigger config.
- `TriggerSchedulePreview`, `RadialCountdownRing`, and `TriggerCountdown` make schedule timing visible before and after save.
- `TriggerExecutionHistory` links a trigger back to executions it caused.
- `DryRunResultView` displays backend dry-run feedback.

## Backend command surface

| Family | Commands |
| --- | --- |
| Event log | `list_events`, `list_events_in_range`, `search_events`, `publish_event` |
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
5. Failures move into dead-letter handling after retry limits.

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
