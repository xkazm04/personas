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

For deeper routing design details, see [event-routing.md](event-routing.md).
