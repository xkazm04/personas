# triggers (misc) — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 6 findings (0 critical / 1 high / 4 medium / 1 low)
> Context group: Execution & Orchestration | Files read: 18 | Missing: 0

## 1. Per-event setState defeats the rAF ingest batching in LiveStreamTab
- **Severity**: High
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/triggers/sub_live_stream/LiveStreamTab.tsx:99-100
- **Scenario**: Under the very CDC throughput the file's own comment cites (50–200 evt/s), every incoming event calls `setTotalReceived` and `setEventsPerMin` synchronously in the listener, triggering a full component render (200-row DataGrid + stats bar) per event — even while paused, and even though event *ingestion* was carefully batched into one `setEvents` per animation frame.
- **Root cause**: The stats counters were left outside the `pendingEventsRef`/rAF flush path, so the expensive part of the optimization (one render per frame) is undone by the cheap counters (one render per event).
- **Impact**: At 100 evt/s the tab renders ~100×/s instead of ~60×/s max — and each render re-runs `filteredEvents`, `availableTypes`, rebuilds `columns`, and re-renders the grid. CPU burn and dropped frames on the hottest UI path in this feature.
- **Fix sketch**: Move `setTotalReceived`/`setEventsPerMin` into the rAF flush: accumulate a `pendingReceivedRef` count in the listener, then in the existing `requestAnimationFrame` callback do `setTotalReceived(c => c + pendingCount)` and `setEventsPerMin(recvTimestamps.current.length)` once per frame. The paused branch needs the same treatment (it currently returns early but has already fired both setters).

## 2. Dead `_busHealth` state and dead `tabHeaderExtra` slot in TriggersPage
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/triggers/TriggersPage.tsx:85-86
- **Scenario**: `_busHealth` is computed (including its underscore-prefixed name admitting it's unread) and never rendered; `tabHeaderExtra` is rendered in `ContentHeader` but `setTabHeaderExtra` is never passed to any child, so the only write is the reset-to-`null` effect — the slot can never hold content.
- **Root cause**: Leftovers from a removed header-status/decoration design; the state, the reset effect (lines 88-90), and the `getTriggerHealthMap()` half of the mount fetch all serve no reader.
- **Impact**: ~20 lines of misleading plumbing, plus a real backend call (`getTriggerHealthMap`) issued on every `personas` change purely to feed dead state. Future readers will assume tabs can inject header content; they can't.
- **Fix sketch**: Delete `_busHealth`/`setBusHealth`, the `BusHealth` type, the health-aggregation branch, and drop `getTriggerHealthMap` from the `Promise.all`. Delete `tabHeaderExtra` state, its reset effect, and the `{tabHeaderExtra}` child. Verify no cross-context caller passes a header-extra setter (none is exported, so this is local-only).

## 3. Trigger list + health map refetched on every persona roster mutation
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: n-plus-one
- **File**: src/features/triggers/TriggersPage.tsx:92-110
- **Scenario**: The load effect is keyed on `personas`. As LiveStreamTab's own comment documents, the roster object churns on health-score refreshes and status polls — so `listAllTriggers()` + `getTriggerHealthMap()` re-fire on a timer-ish cadence while the page is open, even though the fetch body never reads `personas`.
- **Root cause**: Same over-keying bug that was already fixed for LiveStreamTab's backfill (see its lines 62-68 comment) but left in the parent page.
- **Impact**: Periodic redundant IPC/DB round-trips (two calls per roster poll), half of which feed the dead `_busHealth` state (finding #2). `allTriggers` only feeds the rate-limits tab, so most tabs pay the cost for nothing.
- **Fix sketch**: Change the dependency array to `[]` (run-once backfill, matching LiveStreamTab's fix), or better, fetch `listAllTriggers` lazily when `eventBusTab === 'rate-limits'`. Combined with finding #2, the effect shrinks to a single conditional fetch.

## 4. Sequential per-deployment `cloudListTriggers` calls (serial N+1)
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: n-plus-one
- **File**: src/features/triggers/sub_cloud_webhooks/CloudWebhooksTab.tsx:60-77
- **Scenario**: `fetchWebhookTriggers` awaits `cloudListTriggers(dep.personaId)` inside a `for` loop over active deployments — each iteration is a full network round-trip to the cloud API, run one after another. With 8 deployments at ~300ms RTT the tab spinner sits for ~2.4s instead of ~300ms.
- **Root cause**: Loop written with `await` per iteration instead of fanning the independent requests out concurrently.
- **Impact**: Tab load time scales linearly with deployment count; also re-runs in full on every `personas` roster mutation (the callback is keyed on `personas`), multiplying the serial latency.
- **Fix sketch**: `const results = await Promise.allSettled(webhookEnabled.map(dep => cloudListTriggers(dep.personaId).then(triggers => ({ dep, triggers }))))`, then build rows from fulfilled entries — this preserves the current per-deployment silent-catch semantics while making total latency ≈ the slowest single call.

## 5. Validation-failure formatting duplicated three times; retry/toggle activity-log bodies duplicated
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/triggers/hooks/useTriggerOperations.ts:99-103
- **Scenario**: The exact `validation.checks.filter(c => !c.passed).map(c => \`${c.label}: ${c.message}\`).join('; ')` block appears in `useTriggerOperations.validate` (99-103), `useTriggerOperations.testFire` (121-124), and again in `useTriggerHistory.replay` (115-118) — the latter also bypassing the `ops.validate` wrapper and calling `validateTrigger` directly. Separately, `useTriggerDetail`'s `toggleActivityLog` and `retryActivityLog` (lines 91-124) share an identical fetch body.
- **Root cause**: Each call site re-derived the failure string instead of the operations hook exposing it once; `useTriggerHistory.replay` reached past its own ops layer.
- **Impact**: Three places to keep in sync when the failure-message format changes; `replay` already drifted (custom "Replay blocked" wrapping around a hand-rolled copy). The activity-log twin functions double the surface for the loading/error/toast wiring.
- **Fix sketch**: Extract `formatValidationFailures(checks): string` next to `validateTrigger` (or have `validate` return `{ valid, failures }` and make `testFire`/`replay` call it). In `useTriggerDetail`, implement `loadActivity` once and have `toggleActivityLog` call it after flipping `activityOpen`; `retryActivityLog` becomes an alias.

## 6. No-op `|| true` persona filter in CloudWebhooksTab create form
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: cleanup
- **File**: src/features/triggers/sub_cloud_webhooks/CloudWebhooksTab.tsx:201
- **Scenario**: `.filter((p) => !deployedPersonaIds.has(p.id) || true)` always returns true, so the filter — and the `deployedPersonaIds` Set computed at line 126 solely to feed it — do nothing.
- **Root cause**: A restriction ("only personas without an existing webhook") was disabled by tacking `|| true` on rather than removing the code, leaving dead intent in place.
- **Impact**: Misleading: a reader (or lint rule) assumes deployed personas are excluded from the dropdown when they aren't; a per-render Set allocation feeds nothing.
- **Fix sketch**: Decide the product intent. If all personas should be selectable, delete the `.filter(...)` and the `deployedPersonaIds` computation. If duplicates should be prevented, drop the `|| true`. Also note `selectGroup` in DeadLetterTab.tsx:265-271 has a sibling smell — both `if`/`else` branches do `next.add(evt.id)` — worth folding in the same cleanup pass.
