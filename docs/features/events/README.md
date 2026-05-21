# Events and Triggers

Events and Triggers are the routing layer that lets personas react to schedules, webhooks, filesystem changes, shared events, composite conditions, and other app activity.

## Page host

`src/features/triggers/TriggersPage.tsx` owns the Events section. It reads the active tab from `useSystemStore().eventBusTab`, loads all triggers through `listAllTriggers()`, reads trigger health through `getTriggerHealthMap()`, and lazily mounts heavier canvas tabs.

The Live Stream header includes a shortcut into `Overview -> Events` for the full event log.

## Tabs

| Tab | Behavior | Implementation |
| --- | --- | --- |
| Live Stream | Real-time event stream with type chips, JSON highlighting, detail modal | `sub_live_stream` |
| Builder | Visual routing canvas from event sources to persona listeners | `sub_builder/EventCanvas.tsx`, `layouts/routing` |
| Speed Limits | Rate-limit dashboard over trigger/event activity | `sub_speed_limits/RateLimitDashboard.tsx` |
| Test | Manual event test surface | `sub_test/TestTab.tsx` |
| Local Relay | Smee relay control and switch-back to live stream | `sub_smee_relay/SmeeRelayTab.tsx` |
| Cloud Events | Dev-only cloud webhook relay status | `sub_cloud_webhooks/CloudWebhooksTab.tsx` |
| Dead Letter Queue | Dev-only failed event review, retry, discard | `sub_dead_letter/DeadLetterTab.tsx` |
| Chain Studio | Dev-only visual chain editor built on React Flow nodes/edges | `sub_studio/TriggerStudioCanvas.tsx` |
| Lineage | Cross-persona dependency graph derived from `listAllTriggers()`. Surfaces orphan triggers, chain cycles, and blast radius (click a persona to highlight every downstream trigger that would fire). Renders as a layered ReactFlow canvas with persona / trigger / event-hub node families. | `sub_lineage/TriggerLineageCanvas.tsx`, `sub_lineage/libs/deriveLineageGraph.ts` |
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
| Dead letters | `list_dead_letter_events`, `count_dead_letter_events`, `retry_dead_letter_event`, `discard_dead_letter_event` |
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

For deeper routing design details, see [event-routing.md](event-routing.md).
