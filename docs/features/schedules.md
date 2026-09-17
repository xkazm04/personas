# Schedules

Schedules is the user-facing surface for cron- and interval-driven personas: a week/month **calendar** of upcoming fire times and real past outcomes, with the scheduler engine's on/off switch and the active/paused counts in its header.

> **Consolidated 2026-09-17.** The overlay used to carry three tabs — a grouped "timeline" list, the calendar, and the Autopilot orchestration ledger. The grouped list (with its per-row run-now, frequency editor, skip-next-fire, delayed run, backfill modal, run-history peek and "last 24 hours" section) was retired in favour of the calendar, and the orchestration ledger moved to the Monitor (see [Orchestration moved to the Monitor](#orchestration-moved-to-the-monitor)). Per-schedule actions live in the Triggers UI.

## Page host

`src/features/schedules/components/SchedulesOverlay.tsx` (was `ScheduleTimeline.tsx`) is the title-bar overlay mounted by `src/features/shared/chrome/useTitleBarTray.tsx` under `headerOverlay === 'schedules'`, lazily, inside a `FullScreenOverlay` with a `RouteChunkSkeleton` fallback. The Command Palette opens the same overlay for the `schedules` section. The barrel `src/features/schedules/index.ts` re-exports `SchedulesOverlay` as the default. The root carries `data-testid="schedules-page"`, which the guided tour highlights.

## User surface

| Surface | Behavior | Implementation |
| --- | --- | --- |
| Header | The scheduler engine badge (green *running* / red *stopped*, click to toggle via `start_scheduler` / `stop_scheduler`), the **active** count badge and — when any exist — the **paused** count, and a refresh button. | `SchedulesOverlay.tsx` |
| Sidebar filter | Clicking a team (or the "No team" bucket) in the sidebar filters the calendar to those personas; a blue indicator names the filter with a *Clear* action. Delivered as a `window` `CustomEvent('schedules:filter')` rather than store state, since the filter is sidebar-scoped UI. | `SchedulesOverlay.tsx`, `chrome/sidebar/SidebarLevel2.tsx` |
| Calendar | Week/Month calendar of fire times with conflict detection. The legend (`Projected` / `Success` / `Failed` / `Unverified` / `Overlap`) doubles as click-to-toggle filters: clicking dims the chip and hides events of that kind from the grid; `Overlap` off additionally hides events in conflict groups so the user can isolate non-overlapping fires. A "Show all" reset chip appears whenever any filter is off. Conflict detection runs on the **unfiltered** event set so badge counts stay honest. Hover an event for the persona, its trigger config and the next fire. | `ScheduleCalendar.tsx`, `WeekView.tsx`, `MonthView.tsx`, `EventBlock.tsx`, `EventTooltip.tsx` |
| Loading / empty | While the first cron-agent read is in flight the header stays and a delayed ghost sits under it (never a spinner — loading pattern v2); with no scheduled agents at all, a `ScenarioEmptyState` explains where schedules come from. | `SchedulesOverlay.tsx` |

## State and helpers

| File | Role |
| --- | --- |
| `libs/scheduleHelpers.ts` | `ScheduleEntry`, `ScheduleHealth` (`healthy/degraded/failing/paused/idle`), `parseScheduleEntry(CronAgent)` |
| `libs/calendarHelpers.ts` | `CalendarView`, `CalendarEvent`, week/month range math, `agentColor`, `detectConflicts`, `matchPastSlotsToRuns` |
| `libs/useCronPreview.ts` | `useCalendarEvents(entries, start, end)` — fetches fire times from the backend so cron semantics (timezone, step parsing, DST) match what the engine actually fires |

`ScheduleEntry.health` is derived from `CronAgent.recent_failures / recent_executions`:

- `paused` — trigger or persona disabled
- `idle` — no recent executions
- `healthy` — failure rate `0`
- `degraded` — failure rate `<0.6`
- `failing` — failure rate `≥0.6`

The overlay caches one `ScheduleEntry` per trigger id and reuses it while the underlying `CronAgent` row is field-equal, so the 30-second poll (which always produces a new array) does not make the calendar re-derive its events when nothing changed.

## Backend command surface

This view does not own a dedicated backend module — it composes existing engine surfaces:

| API wrapper | Backend |
| --- | --- |
| `@/api/pipeline/scheduler` (`getSchedulerStatus`, `startScheduler`, `stopScheduler`) | `engine/scheduler.rs` |
| Calendar fire times | `cron_fire_times_in_range` IPC backed by `engine/cron.rs` |
| Past-run history | `list_recent_schedule_runs` IPC (168h / 200-row cap) — grounds past calendar slots in real executions |
| Cron agent list | `useOverviewStore().fetchCronAgents()` (overview store fetches the full cron-agent set used both here and in Overview) |

For cron parsing, DST handling, scheduler tick semantics, and incident-driven regression tests, see [execution/README.md](execution/README.md) and `engine/cron.rs`.

## Truthful preview & honest history

The calendar is engineered to show the minute the engine will *actually* fire, and to never assert a past outcome it can't back with a record:

- **Seeded preview.** Cron `H`-token spread is seeded on `seed_hash(trigger.id)` in the engine, so the calendar (`useCalendarEvents`) passes the trigger id as the seed — the previewed minute equals the fired minute. Without the seed the backend defaults to `0`, previewing a spread the engine never uses.
- **Engine-anchored intervals.** Interval fire times are projected from `next_trigger_at` (the same field `engine/scheduler.rs` anchors interval re-schedules on), not the drifting `last_triggered_at` tick stamp.
- **Real past outcomes.** Past cron slots are matched to real `list_recent_schedule_runs` records within a tolerance window (`matchPastSlotsToRuns` in `calendarHelpers.ts`); a slot with no matching run renders as a distinct **Unverified** kind (`past-unknown`) rather than a fabricated success — revealing skips, rate-limits, out-of-window, over-budget, or app-closed gaps. Interval triggers contribute their real runs directly (their past cadence can't be reconstructed after downtime drift).

## Live updates

`SchedulesOverlay` refreshes the cron-agent list and the engine status on mount, every 30 s while visible (`useElementVisible`), and on `OVERDUE_TRIGGERS_FIRED` (`typedListen`, `@/lib/eventRegistry`), with in-flight dedupe and 500 ms coalescing so a poll tick coinciding with an overdue event does not double-fetch. The calendar re-derives via `useCalendarEvents` whenever the visible range or entries change.

## Orchestration moved to the Monitor

The Autopilot **orchestration ledger** — the next-tick preview of what the attention loop would do with each persona (verdict, lane, interval floor, last served, wake) with its four counters, budget band and per-persona Active switch — is no longer a Schedules tab. It is a Monitor concern (it reads the same pacing the Activity board's Autopilot pill shows) and now lives at `src/features/fleet/monitor/grid/orchestration/` as the **Orchestration panel** opened from the Activity board; see [`monitor.md` § Orchestration panel](monitor.md#orchestration-panel). The dispatch-order editor that used to sit in the ledger (drag, ↑/↓, "order by need") was removed with the move: order editing is being replaced by the board queue.

## Failure-rate auto-pause

A schedule whose runs keep failing is a hot loop nobody chose. Since 2026-09-05 the
scheduler tick (`engine/background/scheduler.rs`, gate right after the budget check)
reads the trigger's own terminal outcomes in a rolling window
(`exec_repo::trigger_outcomes_in_window`: `completed` vs `failed`, per trigger — `incomplete`
and `cancelled` count on neither side) and, when at least **12** runs in the last **7 days**
are **≥ 90 %** failed, sets the trigger to `paused` instead of firing it. The pause leaves
a `schedule.paused.failure_rate` bus event (labelled "Schedule paused (too many failed
runs)" in the events list) and a `high` audit incident (`kind: trigger_auto_paused`) that
carries the counts, so the non-fire is explainable. It is per trigger, not per persona: a
persona's healthy daily digest is untouched by its broken five-minute poll. Re-enable the
trigger from the Triggers UI once the cause is fixed. This closes the gap where the
persona-level circuit breaker deliberately never disables team members, so a team
persona's failing schedule had no bound at all.

## Known gaps

- The calendar is read-only; creating, pausing, re-timing or backfilling a schedule happens in the Triggers UI under `src/features/triggers/sub_triggers/` (see [events/README.md](events/README.md)).
- Conflict detection in `calendarHelpers.detectConflicts` is purely visual; the scheduler does not gate firing on a UI-detected conflict.
