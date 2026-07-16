# Scheduler & Cron Agents — bug-hunter + ui-perfectionist scan

> Total: 5 (Critical: 0, High: 1, Medium: 3, Low: 1)

## 1. Interval-schedule backfill slots are anchored on the arbitrary user window start, defeating dedup and enqueuing duplicate catch-up runs
- **Severity**: High
- **Category**: bug
- **File**: src-tauri/src/engine/scheduler.rs:225-238 (with src-tauri/src/commands/execution/scheduler.rs:200-219)
- **Scenario**: A persona has an interval schedule (e.g. every 1h). The app was offline overnight. The user opens the Backfill modal, clicks "Last 24h" (start = now−24h), and enqueues 24 catch-up slots. Five minutes later — unsure it worked, or after a partial failure — they click "Last 24h" again. The new window start is 5 minutes later, so every computed slot is `start + k*interval` shifted by 5 minutes.
- **Root cause**: For cron triggers, slots are canonical wall-clock instants, so the `already_published.contains(slot_iso)` dedup in `backfill_schedule` works. For interval triggers, `compute_slots_in_range` synthesizes slots as `start + k*interval` from the *user-chosen* window start, not from the trigger's real cadence anchor (`next_trigger_at` / `last_triggered_at`). Slot identity is therefore not stable across requests: two overlapping windows with different starts (or a user window vs. the auto-backfill's `last_triggered_at`-anchored slots) never produce matching ISO strings.
- **Impact**: The Finding-#2 idempotency layer is a no-op for every interval schedule — re-clicking backfill (or backfilling after auto-backfill already caught up) multiplies the same missed period into 2× duplicate persona executions, burning LLM budget and re-running side-effectful personas. The `skipped_duplicate` counter stays 0, so nothing warns the user.
- **Fix sketch**: Anchor interval slot enumeration on the trigger's cadence (e.g. snap `start` down to the nearest `anchor + k*interval` using the same anchor logic as `next_interval_at`), so identical missed fires always serialize to identical slot ISO strings. Alternatively dedup interval slots with a tolerance window (± interval/2) against published `fired_at` values.

## 2. Cancelling a running persona job returns "true" but the job completes anyway and its side effects land
- **Severity**: Medium
- **Category**: bug
- **File**: src-tauri/src/engine/persona_jobs.rs:180-199, 230-240, 296-318
- **Scenario**: A user enqueues a memory-curation run; the worker pops it (status `running`, LLM call in flight, can take minutes). The user clicks Cancel. `cancel_persona_job` → `request_cancel` sets `cancel_requested = 1` and returns `true`, which the UI reasonably renders as "cancellation accepted".
- **Root cause**: `worker_tick` checks `cancel_requested` only *before* `dispatch_handler`; there are zero cooperative-cancel points during or after the dispatch. When the LLM call finishes, `mark_completed` runs an unguarded `UPDATE ... SET status='completed' WHERE id=?` — no `AND status='running'`, no `AND cancel_requested=0`.
- **Impact**: Success theater: the API contract ("returns true if ... had its cancel_requested flag set") lets the UI show a cancelled job that then flips to `completed`, and the `persona_memory_review_proposal` row is still written — the very work product the user tried to stop. The same unguarded UPDATE would also clobber a future mid-run `canceled` transition.
- **Fix sketch**: Add a post-dispatch check: if `cancel_requested` is set, call `mark_canceled` and discard/flag the proposal instead of `mark_completed`; guard `mark_completed`/`mark_failed` with `WHERE status = 'running'`. Longer term, check the flag between pipeline stages (before the proposal write is the cheapest cancel point).

## 3. Cron Agents page relative times ("next in 2m") are computed once and never refresh — an overdue fire renders as "next 5m ago"
- **Severity**: Medium
- **Category**: ui
- **File**: src/features/overview/sub_cron_agents/components/CronAgentCard.tsx:89-101 (with CronAgentsPage.tsx:23, libs/cronHelpers.ts:8)
- **Scenario**: A user opens the Cron Agents overview and leaves it visible (a natural monitoring use of this page). `fetchCronAgents()` runs once on mount; `formatRelative(agent.next_trigger_at)` is evaluated at render time only. Ten minutes pass; a trigger fires and its `next_trigger_at` advances in the DB.
- **Root cause**: The page assumes render-time freshness: no polling interval, no scheduler-event subscription, and no ticking clock for the relative formatter. `formatRelative` happily formats a now-past "next" timestamp with the past-tense branch.
- **Impact**: The monitoring surface goes stale and self-contradictory — rows read "next 5m ago" (an upcoming run in the past tense), last-run and success/failure counts freeze, and the health icon can show green while a persona is failing right now. Users lose trust in the one page meant to answer "are my cron agents alive?".
- **Fix sketch**: Add a 30–60s refetch interval (or subscribe to the scheduler's fire events) plus a 1-minute re-render tick for the relative labels; render a past `next_trigger_at` as "overdue" rather than "Xm ago".

## 4. BackfillModal is not an accessible dialog: no role/aria-modal, no focus trap, no Escape, unlabeled icon-only close button
- **Severity**: Medium
- **Category**: ui
- **File**: src/features/schedules/components/BackfillModal.tsx:68-86
- **Scenario**: A keyboard or screen-reader user opens Backfill from a schedule row. Focus stays on the trigger button behind the overlay; Tab cycles through the page underneath the fixed overlay; Escape does nothing; the only close affordance is an icon-only `<X>` button with no accessible name; a screen reader announces nothing about a dialog opening.
- **Root cause**: The modal is a hand-rolled `fixed inset-0` div rather than the app's shared dialog primitive (or `role="dialog"` + `aria-modal` + focus management), so every dialog behavior users expect is missing.
- **Impact**: The backfill flow — which enqueues real executions — is effectively unusable without a mouse and invisible to assistive tech; background content remains keyboard-reachable while visually blocked, so users can activate hidden controls.
- **Fix sketch**: Wrap in `role="dialog" aria-modal="true" aria-labelledby={titleId}`, trap focus and autofocus the first input, close on Escape (respecting `isRunning`), and give the close button `aria-label={t.common.close}`. Best: reuse whatever shared modal component the rest of the app uses.

## 5. Backfill result conflates three different outcomes: duplicates skipped, hourly-rate-limit halt, and window overflow all surface as the same "capped"/count UI
- **Severity**: Low
- **Category**: ui
- **File**: src-tauri/src/commands/execution/scheduler.rs:94-107, 186-240 (with src/features/schedules/libs/useScheduleActions.ts:290-300, BackfillModal.tsx:151-186)
- **Scenario**: (a) A user re-runs a backfill whose slots were already published: all slots hit `skipped_duplicate`, `BackfillResult` reports `slots_enqueued: 0`, and the toast says "No missed slots in that window" — indistinguishable from "nothing was ever missed", because `skipped_duplicate` is counted, logged, but never put on the wire. (b) The per-persona hourly ceiling halts the loop mid-window: the code sets `capped = true`, so the modal shows the `backfill_result_capped` copy written for "your window exceeded the 100-slot request cap; retry with a later start" — advice that cannot help, since retrying immediately re-hits the rate limit.
- **Root cause**: `BackfillResult` has a single boolean `capped` and omits `skipped_duplicate` entirely; two semantically different truncation causes and one non-truncation outcome are folded into fields that the UI renders with one-size-fits-all copy.
- **Impact**: Users either re-click (feeding finding #1's duplicate risk on interval schedules) or misdiagnose a rate-limit halt as a window-size problem; the honest telemetry exists in the backend but dies in tracing logs.
- **Fix sketch**: Add `skipped_duplicate: u32` and a `cap_reason: "request_limit" | "hourly_rate_limit" | null` to `BackfillResult` (ts-rs regenerates the binding), and branch the modal/toast copy: "N slots already backfilled — skipped" vs. "halted by the per-persona hourly execution cap; try again after HH:MM".
