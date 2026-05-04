# Events and Triggers

Events and Triggers are the routing layer that lets personas react to schedules, webhooks, shared events, rate limits, dead letters, and composed chains.

## Sidebar tabs

| Tab | Purpose | Implementation |
| --- | --- | --- |
| Live Stream | Inspect incoming and internal events | `src/features/triggers/sub_live_stream` |
| Builder | Route event sources to personas | `src/features/triggers/sub_builder` |
| Speed Limits | Rate limit dashboard | `src/features/triggers/sub_speed_limits` |
| Test | Fire and inspect test events | `src/features/triggers/sub_test` |
| Local Relay | Smee relay management | `src/features/triggers/sub_smee_relay` |
| Cloud Events | Dev-only cloud webhook relay | `src/features/triggers/sub_cloud_webhooks` |
| Dead Letter Queue | Dev-only failed event queue | `src/features/triggers/sub_dead_letter` |
| Chain Studio | Dev-only visual trigger studio | `src/features/triggers/sub_studio` |
| Marketplace | Dev-only shared event subscriptions | `src/features/triggers/sub_shared` |

## Backend

Events use `src-tauri/src/commands/communication`, `src-tauri/src/commands/execution/scheduler.rs`, and event-bus logic in `src-tauri/src/engine`.

For the deeper routing design that has now shipped into the Events surface, see [event-routing.md](event-routing.md).

