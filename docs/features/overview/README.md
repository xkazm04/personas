# Overview

Overview is the operational dashboard for the user's agents, executions, messages, knowledge, health, approvals, incidents, events, and leaderboard.

## Tabs

| Tab | Purpose | Implementation root |
| --- | --- | --- |
| Dashboard | Summary widgets and mission-control cards | `src/features/overview/components/dashboard` |
| Activity / Executions | Global execution metrics and rows | `src/features/overview/sub_activity` |
| Approvals | Manual review inbox and focus flow | `src/features/overview/sub_manual-review` |
| Messages | Agent/user messages | `src-tauri/src/commands/communication/messages.rs` and overview UI |
| Events | Event log and detail modal | `src/features/overview/sub_events` |
| Knowledge | Knowledge graph dashboard | `src/features/overview/sub_knowledge` |
| Health | Persona health/status page | `src/features/overview/sub_health` |
| Leaderboard | Persona scoring and rankings | `src/features/overview/sub_leaderboard` |
| Incidents | Incident inbox and filters | `src/features/overview/sub_incidents` |

Tabs are declared in `overviewItems` in `src/features/shared/components/layout/sidebar/sidebarData.ts`.

## Backend dependencies

Overview reads from execution, communication, health, and knowledge command surfaces. Keep dashboard docs high-level and link to feature-specific docs for exact execution, event, and approval contracts.

