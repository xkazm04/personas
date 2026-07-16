# Self-Healing & Auto-Rollback — bug-hunter + ui-perfectionist scan

> Total: 5 (Critical: 0, High: 2, Medium: 2, Low: 1)

> Note: the context map lists `src/features/agents/sub_executions/detail/AiHealingCounters.tsx`, which no longer exists — the AI-healing UI now lives in `src/hooks/execution/useAiHealingStream.ts` + `src/features/agents/sub_executions/components/runner/*`. Context-map drift worth refreshing.

## 1. Healing slot leaked when manual AI heal hits an execution without a session ID — persona locked out of healing AND auto-rollback until app restart
- **Severity**: High
- **Category**: bug
- **File**: src-tauri/src/commands/execution/healing.rs:127
- **Scenario**: User clicks "AI heal" (`trigger_ai_healing`) on a failed execution whose `claude_session_id` is NULL (common: the CLI died before emitting a session id, or the run predates session capture). The command acquires the per-persona healing slot at line 127 (`state.engine.try_start_healing(...)`), then at line 133 `execution.claude_session_id.ok_or_else(...)?` returns `Err` — **without ever releasing the slot**. `healing_personas` is an in-memory `Arc<Mutex<HashSet<String>>>` released only by the spawned healing chain, which is never spawned on this path.
- **Root cause**: The acquire-then-validate ordering assumes every early exit after acquisition releases the slot; the `session_id` validation was placed after acquisition with a plain `?` return.
- **Impact**: From that point on, every `trigger_ai_healing` for the persona returns "A healing session is already in progress", and `auto_rollback_tick` permanently skips the persona too (`try_start_healing_blocking` fails at auto_rollback.rs:370) — both self-healing subsystems silently dead for that persona until the app restarts. One misclick disables the safety net the feature exists to provide.
- **Fix sketch**: Validate `claude_session_id` (and anything else fallible) *before* `try_start_healing`, or release the slot on the error path (RAII guard / explicit `finish_healing` before `return Err`).

## 2. Auto-rollback compares versions at calendar-day granularity — inert for same-day regressions and mis-attributes boundary-day executions
- **Severity**: High
- **Category**: bug
- **File**: src-tauri/src/engine/auto_rollback.rs:189-260
- **Scenario**: User promotes a new prompt version (or an AI heal auto-promotes one via `snapshot_healed_prompt`) and it immediately starts failing the same day. `current_date`/`previous_date` are the markers' `created_at` truncated to 10 chars (a date), and `daily_points` are per-day aggregates. `previous_points` is `date >= previous_date && date < current_date` — when both versions were deployed on the same calendar day this window is **always empty**, so the persona is skipped ("insufficient data points") on every tick until midnight, and even after midnight the shared boundary day mixes both versions' executions into `current_points`.
- **Root cause**: Version activity windows are derived from daily-aggregated performance points, but version promotions happen at sub-day (often sub-hour) cadence — especially with AI healing creating new production versions automatically. Day resolution cannot separate two versions that lived within one day.
- **Impact**: The headline scenario the feature advertises — "bad version ships, error rate spikes, roll back" — never fires on the day it ships (the most valuable window); error rates on the deploy day blend pre- and post-deploy executions, so comparisons that do run are skewed, risking both missed and spurious rollbacks.
- **Fix sketch**: Attribute executions to versions by comparing full execution timestamps against marker `created_at` (query executions per version window), or store `prompt_version_id` on executions and aggregate per version instead of per day.

## 3. Manual healing analysis marks every auto-fixable issue `auto_fix_pending` but schedules only one retry — the rest show "retrying" forever (until TTL sweep) and the auto-fixed count is inflated
- **Severity**: Medium
- **Category**: bug
- **File**: src-tauri/src/engine/healing_timeline.rs:269-287
- **Scenario**: User clicks "Run analysis" on a persona with several recent auto-fixable failures (e.g. 3 timeouts + 2 rate limits across different chains). For each one, `mark_auto_fix_pending` is called and `auto_fixed += 1`, but the `retry_scheduled` flag limits `retries` to the **first** failure only. Issues 2..N are persisted with status `auto_fix_pending` yet no retry is ever scheduled for them.
- **Root cause**: The one-retry-per-analysis throttle (reasonable) was not mirrored in the status/counter writes — pending status and the `auto_fixed` counter assume a retry will follow for every marked issue.
- **Impact**: Success theater: the panel banner reports "N auto-fixed" for fixes that will not happen; the timeline renders those issues as "Outcome: retrying" with a pulsing dot until the `AUTO_FIX_PENDING_TTL` sweep quietly reverts them. Users believe recovery is in flight when nothing is scheduled.
- **Fix sketch**: Only `mark_auto_fix_pending` (and increment `auto_fixed`) for the issue whose retry is actually pushed into `retries`; report the others as ordinary open issues, or schedule one retry per distinct chain.

## 4. Issue filter chips stay visible and interactive in timeline mode but have no effect on the timeline
- **Severity**: Medium
- **Category**: ui
- **File**: src/features/overview/sub_observability/components/HealingIssuesPanel.tsx:179-233
- **Scenario**: User switches the panel to timeline view, then clicks the "Open" or "Auto-fixed" chip expecting the timeline to filter. The chips update `issueFilter`, which only feeds `sortedFilteredIssues` consumed by `IssuesList`; `HealingTimeline` receives unfiltered `timelineEvents`, so the selected chip highlights but the content never changes.
- **Root cause**: The filter row is rendered whenever `healingIssues.length > 0`, independent of `viewMode`, while the filtering pipeline was only wired to the list view.
- **Impact**: An interactive control that silently does nothing — users mistrust the timeline data ("I filtered to Open, why do I still see resolved chains?") or think the app is broken.
- **Fix sketch**: Either hide the chip row when `viewMode === 'timeline'`, or filter timeline chains by the linked issue's status so the chips act consistently in both modes.

## 5. View-mode toggle exposes raw key strings as tooltips and lacks toggle-state semantics
- **Severity**: Low
- **Category**: ui
- **File**: src/features/overview/sub_observability/components/HealingIssuesPanel.tsx:108-123
- **Scenario**: User hovers the list/timeline toggle buttons: the browser tooltip shows the literal strings `list_view` / `timeline_view` (`title={"list_view"}`) — untranslated snake_case keys, in an app that is otherwise fully i18n'd (13 locales, `t.overview.*` used everywhere else in this file). Screen-reader users also get no pressed/selected state — the buttons are plain `<button>`s distinguished only by background color.
- **Root cause**: Placeholder key strings were committed instead of `t.…` lookups, and the segmented control has no `aria-pressed`/`role` semantics.
- **Impact**: Visible raw identifiers leak into the UI (looks unfinished, breaks localization), and the current view mode is not perceivable to assistive tech.
- **Fix sketch**: Replace the literals with translated labels (add keys next to the panel's existing `healing_issues_panel` strings) and add `aria-pressed={viewMode === 'list'}` (resp. `'timeline'`) or a proper radiogroup.
