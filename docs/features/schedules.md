# Schedules

Schedules is the user-facing surface for cron- and interval-driven personas. It renders the timeline/calendar of upcoming and recent runs, exposes scheduler-level actions (manual execute, pause, frequency edit), and surfaces scheduler health.

## Page host

`src/features/schedules/components/ScheduleTimeline.tsx` is the lazy-mounted page bound to `sidebarSection === 'schedules'` in `src/features/personas/PersonasPage.tsx`. The barrel `src/features/schedules/index.ts` re-exports `ScheduleTimeline` as the default.

## User surface

| Surface | Behavior | Implementation |
| --- | --- | --- |
| Timeline view | Grouped or flat list of cron-driven agents with next/last run, schedule expression, and health pill | `ScheduleTimeline.tsx`, `ScheduleRow.tsx` |
| Calendar view | Week/Month calendar of fire times with conflict detection | `ScheduleCalendar.tsx`, `WeekView.tsx`, `MonthView.tsx`, `EventBlock.tsx`, `EventTooltip.tsx` |
| Frequency editor | Inline editor for cron expression / interval | `FrequencyEditor.tsx` |
| Skip next fire | Bumps `next_trigger_at` forward by one fire. For cron we ask `cron_fire_times_in_range` for the next fire after the currently-scheduled one and write that; for interval we add `interval_seconds`. Pure `updateTrigger` write — no engine change. Surfaced as the first item in the advanced-actions dropdown next to Run-now. | `ScheduleRow.tsx`, `useScheduleActions.skipNextFire` |
| Delayed run ("Run in 5/15/30/60 min") | Replaces `next_trigger_at` with `now + Δ`. The scheduler fires once at the new time and recomputes the following fire from the cron / interval as usual. Lives on the trigger row, so it survives reload (unlike a JS timer). Surfaced as a 2×2 chip grid in the advanced-actions dropdown. | `ScheduleRow.tsx`, `useScheduleActions.runIn` |

The sidebar persona filter is delivered as a `window` `CustomEvent('schedules:filter')` rather than store state, since the filter is sidebar-scoped UI and shouldn't pollute the global store.

## State and helpers

| File | Role |
| --- | --- |
| `libs/scheduleHelpers.ts` | `ScheduleEntry`, `ScheduleHealth` (`healthy/degraded/failing/paused/idle`), `parseScheduleEntry(CronAgent)`, `sortByNextRun`, `groupByTimeWindow` |
| `libs/calendarHelpers.ts` | `CalendarView`, `CalendarEvent`, week/month range math, `agentColor`, `detectConflicts` |
| `libs/useCronPreview.ts` | `useCalendarEvents(entries, start, end)` — fetches fire times from the backend so cron semantics (timezone, step parsing, DST) match what the engine actually fires |
| `libs/useScheduleActions.ts` | Manual execute, pause/resume, update frequency, **skip next fire**, **delayed run** |

`ScheduleEntry.health` is derived from `CronAgent.recent_failures / recent_executions`:

- `paused` — trigger or persona disabled
- `idle` — no recent executions
- `healthy` — failure rate `0`
- `degraded` — failure rate `<0.6`
- `failing` — failure rate `≥0.6`

## Backend command surface

This view does not own a dedicated backend module — it composes existing engine surfaces:

| API wrapper | Backend |
| --- | --- |
| `@/api/pipeline/scheduler` (`getSchedulerStatus`, `startScheduler`, `stopScheduler`) | `engine/scheduler.rs` |
| `@/api/pipeline/triggers` (`seedMockCronAgent` for dev) | `engine/scheduler.rs`, `engine/cron.rs` |
| Calendar fire times | `cron_fire_times_in_range` IPC backed by `engine/cron.rs` |
| Cron agent list | `useOverviewStore().fetchCronAgents()` (overview store fetches the full cron-agent set used both here and in Overview) |

For cron parsing, DST handling, scheduler tick semantics, and incident-driven regression tests, see [execution/README.md](execution/README.md) and `engine/cron.rs`.

## Live updates

`ScheduleTimeline` listens via `typedListen` (`@/lib/eventRegistry`) for execution and trigger events that should refresh the visible data; the calendar re-derives via `useCalendarEvents` whenever the visible range or entries change.

## Known gaps

- The calendar is read-only; creating a schedule still happens in the Triggers UI under `src/features/triggers/sub_triggers/` (see [events/README.md](events/README.md)).
- Conflict detection in `calendarHelpers.detectConflicts` is purely visual; the scheduler does not gate firing on a UI-detected conflict.
