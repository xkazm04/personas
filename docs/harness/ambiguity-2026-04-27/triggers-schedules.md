# Ambiguity Audit — Triggers & Schedules

> Total: 11 findings (1 critical, 4 high, 5 medium, 1 low)
> Files read: ~16
> Scope: Event-driven triggers + cron schedules (TS/React side: nl parser, schedule helpers, calendar projection, frequency editor, event bridge timing, dry-run, dead-letter)

## 1. `useTriggerHistory.replay` ignores trigger validation gate

- **Severity**: critical
- **Category**: edge-case
- **File**: src/features/triggers/hooks/useTriggerHistory.ts:101-132
- **Scenario**: `replay` calls `api.executePersona(...)` directly with no `validateTrigger` step. `useTriggerOperations.testFire` (the canonical "fire this trigger" path) explicitly validates first and surfaces failures. The replay path bypasses this entirely.
- **Root cause**: The flow was likely added to mirror `testFire` for past executions but skipped the validation step. Nothing in code or comments documents that "replay is intentionally validation-less because we trust historical inputs"; it just isn't there.
- **Impact**: A user can replay a webhook execution whose secret was rotated, a polling trigger whose endpoint is now 404, or a file-watcher whose path no longer exists — silently spawning a doomed execution instead of getting the inline failure message they'd see from a normal test fire. Worst case, replay re-fires a trigger whose `enabled=false`, defeating the pause.
- **Fix sketch**:
  - Decide and document explicitly: does replay validate? If yes, route through `ops.testFire` or duplicate the `validateTrigger` check.
  - If replay should bypass validation by design, add a comment explaining why (e.g. "replay reproduces a historical execution; current config drift is expected").
  - Either way, check `agent.trigger_enabled` before firing.

## 2. `detectSkippedExecutions` recovery may double-fire on freshly enabled triggers

- **Severity**: high
- **Category**: edge-case
- **File**: src/features/schedules/libs/scheduleHelpers.ts:129-168
- **Scenario**: When a trigger is paused for >24h, then re-enabled, `last_triggered_at` is still old. The 24h `SKIPPED_LOOKBACK_MS` cap clamps `effectiveLastRun` and the function reports `floor(elapsed / interval) - 1` "missed" runs. The user is then prompted to "Recover All", which fires real executions for runs that were intentionally paused.
- **Root cause**: The detector has no way to distinguish "app was offline" from "trigger was deliberately paused". The 24h cap was added to limit damage, not to fix the conceptual ambiguity. Comment at line 121-127 acknowledges the import case but not the pause case.
- **Impact**: A user pausing a 5-minute trigger overnight and re-enabling it in the morning sees up to 287 "missed runs" they're invited to recover. Clicking Recover blasts ~287 executions through the queue, costing tokens and potentially flooding downstream personas with stale events.
- **Fix sketch**:
  - Skip detection when `agent.trigger_enabled` was recently toggled (need a `last_enabled_at` field, or just gate on whether the enabled transition happened within `SKIPPED_LOOKBACK_MS`).
  - Or surface the same warning the import case implies: "We don't know if these were missed or paused — recover at your own risk."
  - At minimum, drop the cap from 100 (line 161) for display; the underlying decision to invite recovery is the bug.

## 3. `parseCron` defaults arbitrary times when phrase is ambiguous

- **Severity**: high
- **Category**: undocumented-decision
- **File**: src/features/triggers/sub_triggers/nlTriggerParser.ts:80-107
- **Scenario**: For "daily" / "weekly" / "monthly" with no time specified, the parser invents `0 9 * * *`, `0 9 * * 1`, `0 9 1 * *` (i.e. 9am, Monday, 1st of month). For "every week" the parser hardcodes Monday. None of these defaults are surfaced to the user before the trigger is created.
- **Root cause**: The `9am` and `Monday` defaults are not documented anywhere — not in code comments, not in the UI label (the label just says "Schedule: 0 9 * * *"). A user typing "run weekly" assumes "weekly" without realizing the parser picked a specific time and weekday.
- **Impact**: A user saying "summarize my inbox weekly" gets a trigger that fires only Monday 9am UTC. If they're in PST that's 1am Sunday local — they may never see it fire and assume the system is broken. The decision is also impossible to surface because `confidence: 'medium'` doesn't flag *which* parts were guessed.
- **Fix sketch**:
  - Emit a parser warning when defaults are inserted (`code: 'time_inferred'`, e.g. "Defaulted to 9am UTC since no time was specified — edit if you meant a different time").
  - Show the resolved cron in plain English in the label (`Schedule: every Monday at 9am UTC`).
  - Or downgrade confidence to `low` whenever a default fired so the UI prompts confirmation.

## 4. `parseCronField` accepts cron, calendar projection differs from backend

- **Severity**: high
- **Category**: implicit-assumption
- **File**: src/features/schedules/libs/calendarHelpers.ts:194-252, 92-159
- **Scenario**: The frontend re-implements cron parsing to project fire times for the calendar view. The comment at line 199-201 says it "matches the backend's stricter parser", but no test enforces this and there's no shared parser. Edge cases like `L`, `W`, `#`, day-name aliases, month-name aliases, and 6/7-field cron (with seconds or year) are silently rejected → the calendar shows no events for an actively-firing trigger.
- **Root cause**: Two sources of truth for cron evaluation: Rust backend runs the actual schedule, JS reimplements it for projection. The "matches backend" claim is aspirational and untestable as written.
- **Impact**: A backend-supported cron like `0 0 1 * MON#1` (first Monday of month) executes correctly but shows zero events in week/month view, making the user think the trigger is broken. Conversely, JS could plausibly parse a cron the backend rejects, projecting phantom events.
- **Fix sketch**:
  - Pin the parser-equivalence assumption in a snapshot test that fuzzes cron strings against `previewCronSchedule` (the backend) and asserts the JS projector produces matching fire times.
  - Or stop reimplementing — call the backend `previewCronSchedule` per visible trigger when the calendar opens (cache by cron string, since results are deterministic).
  - Document in line 92 comment exactly which cron features the JS projector supports/rejects.

## 5. `PERSONA_HEALTH_DEBOUNCE_MS` and 30s scheduler poll have no shared budget

- **Severity**: medium
- **Category**: trade-off-hidden
- **File**: src/lib/eventBridge.ts:46-49 (constant), src/features/schedules/components/ScheduleTimeline.tsx:112 (poll), src/features/schedules/components/ScheduleTimeline.tsx:69-117 (coalesce)
- **Scenario**: The Schedule timeline runs three independent triggers for refresh: a 30-second `setInterval`, an `OVERDUE_TRIGGERS_FIRED` event listener, and the page-mount initial fetch — coalesced through one 500ms debounce (line 101-107). Separately, `eventBridge.ts` debounces `PERSONA_HEALTH_CHANGED` at 300ms with a global single fetch (`fetchPersonaSummaries`). These two debounce strategies are unrelated, but both ultimately drive UI freshness for schedules.
- **Root cause**: Each subsystem chose a debounce knob in isolation. The 500ms in ScheduleTimeline and the 300ms in eventBridge both have justifications ("avoid double-fetch when overdue coincides with poll", "coalesce chain triggers"), but no doc explains why 500 ≠ 300, or what would change if they unified.
- **Impact**: A future dev tuning one number won't realize they need to tune the other. If `PERSONA_HEALTH_DEBOUNCE_MS` is shortened for snappier dashboard updates, the schedule view's coalesce window may now under-coalesce. The "right" relationship is undocumented.
- **Fix sketch**:
  - Move all global refresh-coalesce constants into `EVENT_BRIDGE_TIMING` (or a parallel object) with a single comment explaining the relationship: "schedules coalesce > healing debounce because schedules drive a heavier query."
  - Or add a "What breaks if these drift" note matching the pattern already established at line 32-33.

## 6. `previewConflicts` quadratic time, no upper bound on entries

- **Severity**: medium
- **Category**: edge-case
- **File**: src/features/schedules/libs/calendarHelpers.ts:470-517
- **Scenario**: `previewConflicts` runs in `O(C × E)` where C = candidate fire times and E = existing fire times in the next 7 days. For a 5-minute candidate × 100 existing 5-minute triggers, that's ~2,016 × ~201,600 ≈ 400M comparisons inside `useMemo` on every keystroke in `FrequencyEditor.cronInput` (line 41-53).
- **Root cause**: No early termination, no bucketing, no cap on `existingTimes`. The `generateCronFireTimes` cap of 200 per trigger is the only ceiling — multiply by N triggers and the inner loop blows up. Memoization helps re-renders but each new keystroke triggers fresh compute via the 400ms `useEffect` debounce.
- **Impact**: With ~50 5-minute schedules already configured, opening FrequencyEditor and typing a custom cron locks the UI thread for visible jank on each character. The `400ms` debounce in `FrequencyEditor.useEffect` (line 56-67) hides the cost behind a delay, but it doesn't eliminate it.
- **Fix sketch**:
  - Sort `existingTimes` once (already done) and use binary search per candidate to find any time within `CONFLICT_WINDOW_MS` — drops to `O(C log E)`.
  - Or cap `existingEntries.length` for preview (e.g. only check the 20 most-recent / nearest-firing).
  - At minimum, document the perf assumption: "Designed for ≤20 triggers per persona." If the cap is intentional, fail loud at higher counts instead of silently slow.

## 7. Webhook test-fire silently uses `triggerPersonaId ?? personaId`

- **Severity**: medium
- **Category**: requirements-unclear
- **File**: src/features/triggers/hooks/useTriggerOperations.ts:110-129
- **Scenario**: `testFire` accepts an optional `triggerPersonaId` and falls back to the hook's bound `personaId` if absent. There's no comment explaining when the override is needed or what it means for the override to differ from the bound id.
- **Root cause**: This signature emerged because some callers (specifically chained/shared triggers) own personaId at a different scope. Without docs, a future dev passing the wrong id would not get any signal.
- **Impact**: A trigger could be validated against persona A's config but executed against persona B. Validation passes but execution fails, or worse — succeeds against the wrong persona, charging the wrong budget. The bug would manifest as "test fire works inconsistently."
- **Fix sketch**:
  - Document the override: "Use when the trigger is owned by a different persona than this hook is bound to (e.g. shared event subscriptions)."
  - Or remove the parameter and require callers to instantiate the hook with the correct personaId — fail fast at construction.
  - Add an invariant check: if `triggerPersonaId !== personaId`, log a warning so divergence is observable.

## 8. `parseInterval` is called twice per parse to populate label, with deduplication afterthought

- **Severity**: medium
- **Category**: implicit-assumption
- **File**: src/features/triggers/sub_triggers/nlTriggerParser.ts:341-374, 418-426
- **Scenario**: The schedule rule's `extract` and `label` callbacks both call `parseInterval(input, ctx)`, each pushing a `interval_clamped` warning to `ctx.warnings`. The `parseNaturalLanguageTrigger` outer function then deduplicates by `code|message` (line 420-426). Future warning codes that legitimately need multiple instances will be silently collapsed.
- **Root cause**: The dedup is a band-aid for the double-call rather than calling `parseInterval` once. The comment at line 360-365 notes "passes ctx here only for symmetry and future extensions" — but the future extension path is broken by the outer dedup.
- **Impact**: A future warning like `code: 'unsupported_keyword'` that wants to fire once per offending keyword would be deduped to one instance, hiding count from the user.
- **Fix sketch**:
  - Compute `parseInterval` once in `extract`, cache the result on `ctx`, reuse in `label`.
  - Or remove the dedup and fix the root cause (double-call).
  - At minimum, document that warning codes must be globally unique per parse, not per-occurrence.

## 9. `LAYOUT_VERSION` bump silently discards saved canvas layouts

- **Severity**: medium
- **Category**: undocumented-decision
- **File**: src/features/triggers/sub_builder/libs/eventCanvasConstants.ts:103, src/features/triggers/sub_studio/TriggerStudioCanvas.tsx:73
- **Scenario**: `loadStudioLayout()` (and the analogous EventCanvas loader) returns `null` when `parsed.version !== STUDIO_LAYOUT_VERSION`. No migration, no user notice. After a version bump the user's manually-arranged canvas resets to default position with no warning or undo.
- **Root cause**: The version field exists for breaking changes but no migration path is implemented. Comment at line 103 (`bumped for sticky notes support`) shows the team treats version bumps as cheap, but they cause user-visible state loss.
- **Impact**: A user who spent 20 minutes arranging a complex flow loses the layout when they next update — no toast, no localStorage backup, no offer to re-import. The bug is silent because layout simply "doesn't load" and the auto-layout algorithm runs as if first-time.
- **Fix sketch**:
  - When `parsed.version` mismatches, attempt a simple migration (preserve x/y at minimum) and toast "Canvas layout migrated to new format."
  - Or backup the old layout key before discarding (`event_canvas_layout_v1` → `event_canvas_layout_v1_backup`) so the user can recover.
  - Document in the file header: "Bumping LAYOUT_VERSION discards user layouts. Use only for incompatible schema changes."

## 10. `MAX_MANUAL_RETRIES` magic number duplicated across boundaries

- **Severity**: medium
- **Category**: magic-number
- **File**: src/features/triggers/sub_dead_letter/DeadLetterTab.tsx:10-11
- **Scenario**: The frontend hardcodes `MAX_MANUAL_RETRIES = 5` and the comment says "Must match MAX_MANUAL_RETRIES in events.rs". There is no compile-time check, no shared binding, no test.
- **Root cause**: Two sources of truth, with the alignment maintained by hand. The same pattern appears for trigger interval minimums (`60` in `nlTriggerParser.MIN_INTERVAL_SECONDS`, `60` in `buildTriggerConfig` line 44/49, `2` for clipboard, `2` for app focus, `5` for composite window).
- **Impact**: If the Rust side bumps the limit to 7 and nobody updates this constant, the UI will incorrectly disable the retry button after 5 attempts, leaving the dead-letter event un-retriable from the UI even though backend would accept it.
- **Fix sketch**:
  - Generate a TS binding from Rust (via `ts-rs` or similar), so `MAX_MANUAL_RETRIES` is imported, not redeclared.
  - Or assert the constant in an integration test that calls a `get_trigger_constants` IPC and fails the build on mismatch.

## 11. Hardcoded clipboard / app-focus polling intervals never surfaced to the user

- **Severity**: low
- **Category**: magic-number
- **File**: src/features/triggers/sub_triggers/configs/buildTriggerConfig.ts:65-75, src/features/triggers/sub_triggers/nlTriggerParser.ts:253, 281
- **Scenario**: Clipboard trigger silently defaults to a 5-second polling interval (clamped to ≥2s), app-focus to 3s. The NL parser hardcodes `'3'` for clipboard and `'3'` for app focus when extracting from natural language. The user typing "watch clipboard for URLs" gets a 3-second polling interval they never asked for and never see.
- **Root cause**: Defaults moved into the form-builder for convenience but no UI hint shows the chosen value, no documentation explains why 3s vs 2s vs 5s. Probably tuned empirically.
- **Impact**: A user expecting "real-time" clipboard detection will see up to 3-5s latency and assume bug. A user concerned about battery drain has no idea their app-focus trigger polls every 3 seconds. Tuning these later is hard because no doc explains why each value was chosen.
- **Fix sketch**:
  - Surface the polling interval in the form (read-only or editable) so the user can see it.
  - Move the constants out of inline literals into a named export with a sentence each: "Clipboard at 3s balances detection latency vs CPU; below 2s starts hitting Win32 API rate limits."
  - Even just renaming the literal to `DEFAULT_CLIPBOARD_INTERVAL_S = 3` and adding a one-line comment would be a meaningful improvement.
