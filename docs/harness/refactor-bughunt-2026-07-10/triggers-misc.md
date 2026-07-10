> Context: triggers (misc)
> Total: 10
> Critical: 0  High: 0  Medium: 4  Low: 6

## 1. Exhausted dead-letter events get force-selected, inflating the retry count and locking their checkboxes
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: edge-case / success-theater
- **File**: src/features/triggers/sub_dead_letter/DeadLetterTab.tsx:265-274, 242-248, 227-231, 547-553
- **Scenario**: `selectGroup` contains a tell-tale identical if/else — `if (evt.retry_count < maxManualRetries) next.add(evt.id); else next.add(evt.id);` — so it adds *every* event in the group including retry-exhausted ones. `selectVisible` (line 245) likewise adds all filtered ids with no `retry_count` guard. Because each row/group checkbox is rendered `disabled={exhausted}` (lines 633, 785), a user who selects a group/all then can no longer individually deselect the exhausted rows. `visibleSelectedCount` (227) counts them, so the toolbar says "Retry 10" but `runBulkRetry` silently filters exhausted (302-305) and retries fewer; the success toast's `total` is the filtered `target.length` (316), masking the drop.
- **Root cause**: the author intended to add only eligible ids (the `retry_count < maxManualRetries` predicate is written) but both branches do the same thing; the count/label pipeline assumes selection only ever holds retriable ids.
- **Impact**: UX — misleading selection count, un-clearable phantom selections, "retried N" that doesn't match reality.
- **Fix sketch**: In `selectGroup` drop the else branch (only add when `retry_count < maxManualRetries`). Guard `selectVisible` the same way (reuse `selectableFilteredIds`). Then `visibleSelectedCount`/labels naturally match what will actually be retried.

## 2. Clearing the live stream can be immediately undone by an in-flight rAF flush
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: race-condition
- **File**: src/features/triggers/sub_live_stream/LiveStreamTab.tsx:181-190, 112-140
- **Scenario**: An event arrives → it is pushed to `pendingEventsRef` and a `requestAnimationFrame` flush is scheduled (`flushScheduledRef=true`). Before the frame fires, the user clicks Clear. `handleClear` empties `events`, `eventIdIndex`, `newEventIds`, `pausedQueueRef` — but does NOT clear `pendingEventsRef` or reset `flushScheduledRef`. The pending rAF then runs, re-adds the buffered events to `setEvents` and re-populates `eventIdIndex`, so cleared rows reappear a frame later.
- **Root cause**: two independent event buffers (`pausedQueueRef` and `pendingEventsRef`); Clear resets one family of refs but forgets the per-frame ingest buffer.
- **Impact**: UX — "Clear" appears to not work / rows resurrect; buffer count jumps back up.
- **Fix sketch**: In `handleClear` also set `pendingEventsRef.current = []` (leaving `flushScheduledRef` is fine — the flush early-returns on empty batch), so a queued frame has nothing to re-insert.

## 3. Test-fire can end with no user feedback and stacks uncleared 8s timers
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: silent-failure
- **File**: src/features/triggers/hooks/useTriggerDetail.ts:47-65, 39-43
- **Scenario**: In `handleTestFire`, if `result.ok` is true but `result.data` carries neither `execution` nor `validationFailures` (both branches skipped), `testResult` stays `null` — the button spins, resolves, and shows nothing. Separately, the `finally` schedules `setTimeout(() => setTestResult(null), 8000)` on every fire; the cleanup effect (39-43) only clears `confirmTimerRef`, never these. Rapid re-fires stack multiple 8s timers, so an earlier timer can wipe a newer result early, and timers fire after unmount.
- **Root cause**: incomplete result branching + fire-and-forget timers with no ref/cleanup.
- **Impact**: UX — occasional silent test-fire; result banner clearing sooner than expected.
- **Fix sketch**: Add an `else` fallback that sets a generic "Trigger fired" result; hold the dismissal timer in a ref, clear it at the start of each fire and in the unmount cleanup.

## 4. Dead-letter age filter silently passes events with an unparseable created_at
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: edge-case
- **File**: src/features/triggers/sub_dead_letter/DeadLetterTab.tsx:202-208
- **Scenario**: `const age = now - new Date(e.created_at).getTime()`. If `created_at` is malformed, `getTime()` is `NaN`, so `age` is `NaN`; `age > cutoff` is `false` and `age <= 24h` is `false`, so the row is never filtered out under any age bucket. LiveStreamTab guards the analogous parse with `Number.isNaN(ts)` (LiveStreamTab.tsx:206-207); this path does not.
- **Root cause**: no NaN guard on date parsing before numeric comparison.
- **Impact**: UX — age filter is unreliable for records with bad timestamps (they leak into "15m"/"old" alike).
- **Fix sketch**: Compute `const t = new Date(e.created_at).getTime(); if (Number.isNaN(t)) return true;` (or `false`, per desired policy) before the cutoff comparisons.

## 5. Cloud-webhook create dropdown filter is neutered by `|| true`, allowing duplicate webhooks
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: dead-code / trust-boundary
- **File**: src/features/triggers/sub_cloud_webhooks/CloudWebhooksTab.tsx:200-205, 126
- **Scenario**: The create-form persona `<select>` is filtered with `.filter((p) => !deployedPersonaIds.has(p.id) || true)` — the `|| true` makes the predicate a constant `true`, so the "hide personas that already have a webhook deployed" logic never runs. `deployedPersonaIds` (line 126) is computed solely for this filter and is therefore effectively dead. A user can pick an already-deployed persona and `handleCreate` will `cloudCreateTrigger` a second webhook for it.
- **Root cause**: a debugging/temporary override (`|| true`) left in place; the guard it disabled was the only consumer of `deployedPersonaIds`.
- **Impact**: correctness/UX — duplicate cloud webhook triggers per persona; leftover dead `deployedPersonaIds`.
- **Fix sketch**: Decide the intent. If duplicates are undesired, drop `|| true`. If they are intentionally allowed, delete both the filter and the now-dead `deployedPersonaIds` to remove the misleading code.

## 6. Validation-failure message formatting duplicated across three call sites
- **Lens**: code-refactor
- **Severity**: medium
- **Category**: duplication
- **File**: src/features/triggers/hooks/useTriggerOperations.ts:99-103, 121-124; src/features/triggers/hooks/useTriggerHistory.ts:115-118
- **Scenario**: The exact `validation.checks.filter((c) => !c.passed).map((c) => \`${c.label}: ${c.message}\`).join('; ')` block appears verbatim in `useTriggerOperations.validate`, `useTriggerOperations.testFire`, and `useTriggerHistory.replay`. Verified by reading all three; identical logic and separators.
- **Root cause**: copy-paste of the failed-checks summariser instead of a shared helper.
- **Impact**: maintainability — a change to the summary format (separator, label order) must be made in three places or they drift.
- **Fix sketch**: Add `formatFailedChecks(validation)` (e.g. beside `validateTrigger` in `@/api/pipeline/triggers`) and call it from all three sites.

## 7. `COMMON_EVENT_TYPES` is an unused export
- **Lens**: code-refactor
- **Severity**: low
- **Category**: dead-code
- **File**: src/features/triggers/sub_live_stream/eventTypeMeta.ts:6-17
- **Scenario**: Grepped the whole `src/` tree for `COMMON_EVENT_TYPES`; the only hit is the definition here — no importers. `EVENT_TYPE_META`/`DEFAULT_EVENT_META` from the same file are used (EventTypeChip), but this array is not.
- **Root cause**: leftover from an earlier event-type picker that no longer consumes it.
- **Impact**: maintainability — dead constant that reads as if it drives something.
- **Fix sketch**: Delete `COMMON_EVENT_TYPES` (and any now-unused icon imports it alone required).

## 8. `toggleActivityLog` and `retryActivityLog` are near-identical
- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication
- **File**: src/features/triggers/hooks/useTriggerDetail.ts:91-124
- **Scenario**: `retryActivityLog` is the load half of `toggleActivityLog` verbatim (set loading, `ops.fetchActivity`, set log/error, error toast, finally set loading). Only the open/close guard differs.
- **Root cause**: duplicated fetch body rather than extracting a shared loader.
- **Impact**: maintainability — two copies of the same fetch/error/toast wiring.
- **Fix sketch**: Extract a `loadActivity()` callback; `toggleActivityLog` calls it after opening, `retryActivityLog` calls it directly.

## 9. `defaultStatus` fallback object duplicated between two live-stream components
- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication
- **File**: src/features/triggers/sub_live_stream/EventDetailModal.tsx:22; src/features/triggers/sub_live_stream/LiveStreamTab.tsx:21
- **Scenario**: Both files declare an identical `const defaultStatus = { bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/20' }` used as the `EVENT_STATUS_COLORS[status] ?? defaultStatus` fallback.
- **Root cause**: the fallback wasn't co-located with `EVENT_STATUS_COLORS` in `@/lib/utils/formatters`, so each consumer re-declares it.
- **Impact**: maintainability — the default event-status style can drift between the modal and the grid.
- **Fix sketch**: Export the default alongside `EVENT_STATUS_COLORS` (or a `getEventStatusColors(status)` helper) and import it in both places.

## 10. `EVENT_TYPE_META['smee_webhook']` appears to key on an event type nothing emits
- **Lens**: code-refactor
- **Severity**: low
- **Category**: dead-code
- **File**: src/features/triggers/sub_live_stream/eventTypeMeta.ts:43
- **Scenario**: `EVENT_TYPE_META` is keyed by `event_type`. Everywhere else in this feature the smee integration is identified as `smee_relay` (a `source_type`, e.g. EventDetailModal SOURCE_ICONS, LiveStreamTab column). Grep found no `smee_webhook` event_type emitted anywhere in `src/`, so this row likely never matches and the chip always falls through to `DEFAULT_EVENT_META`. (Flagged low because backend event_type strings aren't visible from the TS side — worth a quick confirm before removal.)
- **Root cause**: probable naming mismatch between the meta key and the actual emitted event type.
- **Impact**: maintainability — a mapping entry that silently never fires.
- **Fix sketch**: Confirm the real smee event_type against the Rust emitter; either rename the key to match or drop the entry.
