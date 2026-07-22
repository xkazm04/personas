# triggers/triggers [1/3] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 6 findings (0 critical / 2 high / 2 medium / 2 low)
> Context group: Execution & Orchestration | Files read: 18 | Missing: 0

## 1. Infinite refetch loop when a webhook trigger has zero request logs
- **Severity**: High
- **Lens**: perf-optimizer
- **Category**: refetch-loop
- **File**: src/features/triggers/sub_triggers/WebhookRequestInspector.tsx:198
- **Scenario**: User expands the Request Inspector on a webhook trigger that has never received a request (or after pressing "Clear all"). The effect `if (open && logs.length === 0 && !loading) void fetch()` with deps `[fetch, loading, logs.length, open]` fires; fetch sets `loading` true→false; the dep change re-runs the effect; the result is still empty, so it fetches again — a continuous IPC busy-loop for as long as the section is open.
- **Root cause**: `logs.length === 0` is used both as "not fetched yet" and as the guard condition, while `loading` is in the dependency array. An empty result is indistinguishable from "never fetched", so the effect keeps re-triggering after every completed fetch.
- **Impact**: Unbounded repeated `listWebhookRequestLogs` Tauri IPC calls (one per round-trip, effectively as fast as the backend answers) whenever the panel is open and empty — CPU/battery churn and backend query load on a UI-idle state. Also fires an immediate redundant refetch after `handleClear` sets `logs` to `[]`.
- **Fix sketch**: Track a `fetchedRef`/`hasFetched` state set to true after the first attempt, and gate the effect on `open && !hasFetched` (reset when `triggerId` changes). Alternatively fetch once in an effect keyed only on `[open, triggerId]` with a ref guard, dropping `loading`/`logs.length` from the deps entirely.

## 2. Same infinite refetch loop in TriggerExecutionHistory for triggers with no executions
- **Severity**: High
- **Lens**: perf-optimizer
- **Category**: refetch-loop
- **File**: src/features/triggers/sub_triggers/TriggerExecutionHistory.tsx:152
- **Scenario**: User opens Execution History on a trigger that has never fired. The auto-fetch effect `if (open && history.executions.length === 0 && !history.loading) void history.fetch()` re-runs whenever `history` changes (the hook returns a fresh object each render, and `loading` toggles true→false per fetch), so an empty result triggers a fetch on every completion — continuous polling while the empty section is open.
- **Root cause**: Identical anti-pattern to finding 1: empty-list-as-"unfetched" sentinel plus the loading flag (via the whole `history` object) in the dependency array.
- **Impact**: Continuous `get_trigger_executions` IPC + SQLite queries for every open-but-empty history section; the drawer renders this for every expanded trigger, so several loops can run concurrently.
- **Fix sketch**: Add a `hasFetched` flag inside `useTriggerHistory` (or a ref in this component) and change the guard to `open && !hasFetched`. Depend on `[open, triggerId]` rather than the whole `history` object. Fixing both call sites in the shared hook covers findings 1 and 2 uniformly.

## 3. Dead export: `formatRunTimeUTC` in TriggerSchedulePreview
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/triggers/sub_triggers/TriggerSchedulePreview.tsx:32
- **Scenario**: Repo-wide grep finds `formatRunTimeUTC` referenced only in its own file, a prior scan report, and lint-output.json — no runtime caller and no test.
- **Root cause**: Leftover from an earlier UTC-labelled preview; the component now renders local times via `formatRunTime` only.
- **Impact**: 8 lines of hand-rolled 12-hour formatting that must be maintained and misleads readers into thinking the preview has a UTC mode.
- **Fix sketch**: Delete the function. `computeNextRuns` and `formatRunTime` are exported too but are used within the file (and `formatRunTime` by `CronSchedulePreview`); consider dropping `export` from `computeNextRuns`/`formatRunTimeUTC` if no test imports them (none found).

## 4. Duplicated JSON payload block + ad-hoc relative-time formatter in WebhookRequestInspector
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/triggers/sub_triggers/WebhookRequestInspector.tsx:36
- **Scenario**: `JsonBlock` (WebhookRequestInspector.tsx:50) and `PayloadBlock` (TriggerExecutionHistory.tsx:16) are near-identical components (label + try-JSON.parse + pretty-printed `<pre>` with the same class soup). `formatTime` (WebhookRequestInspector.tsx:36) reimplements relative-time formatting that already exists as `formatRelativeTime` in `@/lib/utils/formatters` — which the sibling file already imports.
- **Root cause**: The webhook inspector was written by copying the execution-history row instead of extracting the shared pieces.
- **Impact**: Two copies of the same rendering logic drift independently (they already differ in typo class: `typo-label` vs `typo-body`); the local formatter also lacks `formatRelativeTime`'s timestamp normalization, so the two panels can disagree on "Xm ago" for the same instant.
- **Fix sketch**: Extract one `PayloadBlock`-style component into `sub_triggers/` (or shared/display) and use it in both files; replace `formatTime` with `formatRelativeTime(entry.receivedAt)` and delete the local helper plus its `statusColor`-adjacent try/catch date logic.

## 5. nlTriggerParser runs extract-and-label double-parse, then papers over it with warning dedup
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: structure
- **File**: src/features/triggers/sub_triggers/nlTriggerParser.ts:347
- **Scenario**: For schedule/polling rules, `rule.extract` and `rule.label` each independently call `parseCron`/`parseInterval` on the same input. Because `parseInterval` pushes a clamp warning into the shared `ctx` on every call, `parseNaturalLanguageTrigger` needs the `seen` Set dedup filter (lines 405–413) purely to hide the double emission, and a comment admits `ctx` is passed to `label` "only for symmetry".
- **Root cause**: `label` re-derives values that `extract` already computed instead of consuming the extracted `formOverrides`.
- **Impact**: Bounded (inputs are short, calls are debounced), but the warning-dedup workaround and symmetry comment add real cognitive load, and any future warning-emitting helper reintroduces the duplicate-warning bug.
- **Fix sketch**: Change `label` to take the already-computed `Partial<TriggerFormState>` (e.g. `label(input, overrides)`) and format from `overrides.cronExpression`/`overrides.interval`; drop `ctx` from `label` and delete the dedup filter.

## 6. NlTriggerInput debounce timeout not cleared on unmount
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: leak
- **File**: src/features/triggers/sub_triggers/NlTriggerInput.tsx:46
- **Scenario**: User types in the NL trigger box and immediately cancels the add form (or Chain Studio closes the modal) within the 250 ms debounce window; the pending `setTimeout` fires after unmount and calls `setResult`/`setNoMatch` on an unmounted component.
- **Root cause**: `doParse` stores the timer in `debounceRef` but no effect cleanup clears it on unmount (the placeholder-rotation interval nearby is cleaned up correctly).
- **Impact**: Harmless in React 18+ (no warning, no leak of note) but it runs the regex parser for a discarded result; trivial to close.
- **Fix sketch**: Add `useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, [])`.
