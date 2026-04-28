# Triggers & Schedules — Dev Experience Scan

> Total: 11 · Critical: 1 · High: 4 · Medium: 4 · Low: 2
> Scope: client-side only
> Date: 2026-04-27

---

## 1. `ScheduleTimeline` bypasses `typedListen` and lies about the payload shape

- **Severity**: Critical
- **Category**: convention-drift
- **File**: `src/features/schedules/components/ScheduleTimeline.tsx:114-117`
- **Scenario**: Engineer reads `OVERDUE_TRIGGERS_FIRED` and assumes the inline annotation `listen<{ recovered: number; timestamp: string }>` reflects what the backend emits. They write code against `payload.recovered` (it's `undefined`) and the bug only shows at runtime.
- **Root cause**: `ScheduleTimeline` imports raw `listen` from `@tauri-apps/api/event` and supplies its own generic argument. The actual payload registered in `src/lib/eventRegistry.ts:702` is `{ trigger_ids: string[] }`. There is zero mechanism preventing this drift; this is the only consumer of `OVERDUE_TRIGGERS_FIRED` in the client and it disagrees with both Rust and `eventRegistry`.
- **Impact**: Type system actively misleads. Future code reading this listener will reach for fields that do not exist. The same pattern (raw `listen<>`) can be repeated anywhere because nothing forbids it.
- **Fix sketch**: (1) Replace with `typedListen(EventName.OVERDUE_TRIGGERS_FIRED, ...)` so the payload comes from the registry. (2) Add an ESLint rule (custom in `eslint-rules/`) that bans `import { listen } from '@tauri-apps/api/event'` outside `src/lib/eventRegistry.ts` and `src/lib/eventBridge.ts`. (3) Reconcile the registered payload with whatever Rust actually emits if `recovered`/`timestamp` are real.

---

## 2. `EventName` is a const-object, not a string-literal union — keys are stringly-typed at most call sites

- **Severity**: High
- **Category**: convention-drift
- **File**: `src/lib/eventRegistry.ts:26-202`
- **Scenario**: Engineer typos `EventName.OVERDUE_TRIGGER_FIRED` (missing `S`). TypeScript catches it. Same engineer types the literal string `'overdue-triggers-fired'` directly into `listen('overdue-triggers-fired', ...)` (or copy-pastes from Rust source). TS happily accepts it; if the Rust name later changes, only one side breaks.
- **Root cause**: `EventName` is `as const` but `typedListen<K extends keyof EventPayloadMap>` only enforces typing when callers go through the typed wrapper. The exhaustiveness checks (`_AssertAllNamesHavePayloads`) ensure registry/payload alignment, but nothing pulls the string literal into the type system at the boundary.
- **Impact**: Easy escape hatch — every raw `listen('...')` defeats the registry. We already see this in finding #1.
- **Fix sketch**: Either (a) ban raw `listen` via lint rule (preferred — see #1), or (b) export a `type EventLiteral = (typeof EventName)[keyof typeof EventName]` and re-export a typed `listen` so even the literal-string form goes through the registry.

---

## 3. Three sources of truth for `CRON_PRESETS`, none aware of the others

- **Severity**: High
- **Category**: code-organization
- **File**: `src/features/schedules/libs/scheduleHelpers.ts:207-217`, `src/features/triggers/sub_triggers/TriggerScheduleConfig.tsx:116-125`, `src/features/deployment/components/cloud/cloudSchedulesHelpers.tsx:27`
- **Scenario**: Product asks for "Every 10 min" preset across the app. Engineer adds it to `scheduleHelpers.ts`. The trigger-add form (different file, different list, different label format — `'Every 5 min'` vs `'Every 5 minutes'` vs `'Every 5 minutes (high frequency)'`) doesn't get it. Cloud trigger form also doesn't get it. Bug ships.
- **Root cause**: Each surface evolved its own preset list. Labels are inconsistent (`'Every 5 min'`, `'Every 5 minutes'`, `'Every minute'` vs `'*/5 * * * *'`), as is the property name (`cron` vs `value`). No shared module.
- **Impact**: Drift is inevitable. Translations fragment (each list has its own i18n approach). New preset = three PRs.
- **Fix sketch**: Create `src/lib/cron/presets.ts` with one `CRON_PRESETS` constant typed as `{ id: string; cron: string; labelKey: string }[]`, import from all three. Migrate i18n keys under `t.cron.preset_*`.

---

## 4. `TriggerAddForm` is a 207-line god-component with 22 `useState` hooks

- **Severity**: High
- **Category**: code-organization
- **File**: `src/features/triggers/sub_triggers/TriggerAddForm.tsx:30-148`
- **Scenario**: Engineer adds a new trigger type (e.g. `mqtt`). They must add ~5 useState hooks, threading them through `applyNlResult`, `applyTemplate`, and `buildTriggerConfig`. Forgetting any of the four sites (state init, NL parser apply, template apply, build config) silently breaks one feature.
- **Root cause**: Form state is a flat bag of 22 sibling `useState` calls instead of a single discriminated-union `useReducer` keyed by `triggerType`. `TriggerFormState` (in `buildTriggerConfig.ts:4`) already exists as a single type — it just isn't used to drive the component.
- **Impact**: Each new trigger type forces edits in ≥4 files; the connections are implicit. Onboarding cost for someone touching triggers is unusually high.
- **Fix sketch**: Replace the 22 `useState`s with `useReducer<TriggerFormState, TriggerFormAction>` driven by the existing `TriggerFormState` type. NL parser and template applier become pure `(state, override) => state` reducers. Bonus: tests become possible (state machine is now isolated from JSX).

---

## 5. No tests for triggers or schedules — entire surface is untested at the unit level

- **Severity**: High
- **Category**: testing
- **File**: `src/features/triggers/**`, `src/features/schedules/**`
- **Scenario**: Engineer refactors `parseScheduleEntry` health logic. Existing `'idle' | 'healthy' | 'degraded' | 'failing' | 'paused'` boundary at `failureRate < 0.6` silently flips to `<= 0.6`. CI passes. Production sees agents flicker between states.
- **Root cause**: `find tests in src/features/{triggers,schedules}` returns 0 results. `nlTriggerParser.ts` (441 lines of regex), `scheduleHelpers.ts` (`detectSkippedExecutions`, `groupByTimeWindow`, `estimateIntervalFromCron`), and `buildTriggerConfig.ts` (every trigger type's validation) are pure functions with non-trivial logic and no tests.
- **Impact**: Regressions land silently; bug reports from users are the regression detector. Estimating refactor risk requires reading every call-site.
- **Fix sketch**: Three files of vitest: `nlTriggerParser.test.ts` (table of input → expected `{triggerType, formOverrides, warnings}`), `scheduleHelpers.test.ts` (boundary tests for `groupByTimeWindow` time windows, `detectSkippedExecutions` lookback cap, cron-pattern estimation), `buildTriggerConfig.test.ts` (one test per trigger type happy-path + each validation error). All are pure functions — no mocks needed.

---

## 6. `ScheduleTimeline.tsx` is 414 lines with refresh orchestration, view rendering, and tab logic interleaved

- **Severity**: Medium
- **Category**: code-organization
- **File**: `src/features/schedules/components/ScheduleTimeline.tsx:36-313`
- **Scenario**: Engineer wants to add a "filter by use_case_id" feature. The refresh effect (lines 72-125) is non-trivial (in-flight dedupe, 500ms coalesce, 30s poll, OVERDUE_TRIGGERS_FIRED listener — all in one `useEffect`). They have to mentally page-fault through it before they can edit the rendering code.
- **Root cause**: A single component owns: (1) data fetching with bespoke coalescing scheduler, (2) overdue-event listener, (3) sidebar-filter event listener, (4) view-mode tablist with keyboard nav, (5) grouped/timeline/calendar render branching, (6) skipped-recovery panel placement. The refresh logic is good — it's just not extractable.
- **Impact**: Every change to the page reads like archaeology. Refresh logic is impossible to reuse for the trigger pages, which would benefit from the same dedupe.
- **Fix sketch**: Extract `useScheduleRefresh({ visible, fetchCronAgents })` to `libs/useScheduleRefresh.ts` (return `{ refresh, schedulerStats }`). Move `ScheduleViewTabs` and `GroupedView` to their own files. Target: `ScheduleTimeline.tsx` < 200 lines.

---

## 7. CSS-class duplication for "preset chip" pattern across 5+ files

- **Severity**: Medium
- **Category**: convention-drift
- **File**: `src/features/triggers/sub_triggers/TriggerScheduleConfig.tsx:42-46`, `:153-167`, `src/features/schedules/components/FrequencyEditor.tsx:122-128`
- **Scenario**: Designer asks to bump preset-chip padding from `py-1.5` to `py-2`. Engineer greps and finds five copies of nearly identical Tailwind classes (`px-3 py-1.5 rounded-modal typo-body font-medium transition-all border bg-primary/15 text-primary border-primary/30` vs the unselected variant). Updates four; misses the fifth.
- **Root cause**: No shared `<PresetChip selected onClick label />` component despite the pattern being identical (button + selected/unselected branches + a single label). Each surface inlines its own copy.
- **Impact**: UI drift is inevitable; "fix the spacing" PRs are ~4× larger than they should be.
- **Fix sketch**: `src/features/shared/components/forms/PresetChip.tsx` — accept `{ selected, label, onClick, accent?: 'primary'|'amber'|'blue' }`. Migrate trigger interval, cron preset, schedule frequency, NL trigger templates.

---

## 8. `useScheduleActions.updateFrequency` re-fetches and re-parses raw JSON on every save instead of using a typed config helper

- **Severity**: Medium
- **Category**: dev-loop-friction
- **File**: `src/features/schedules/libs/useScheduleActions.ts:53-105`
- **Scenario**: Engineer adds a new trigger config field (e.g. `priority`). They forget that `updateFrequency` does a read-modify-write on stringified JSON; now `priority` may or may not survive a frequency edit depending on whether the read succeeded.
- **Root cause**: Trigger `config` is stored as `string` (JSON-encoded). The code parses → spreads → re-encodes inline, with a try/catch around the parse and a comment explaining "if existing config is malformed, fall back to empty merge — schedule fields below still take effect; we don't want to block the user's edit because the prior write was corrupt." Reasonable in isolation but the parse/merge dance is duplicated implicitly elsewhere (any read-modify-write on a trigger).
- **Impact**: Every contributor touching trigger config has to rediscover the read-modify-write pattern. Easy to forget, easy to silently destroy fields.
- **Fix sketch**: Add `src/lib/triggers/configMerge.ts` exporting `mergeTriggerConfig(existingJson, partial): string` with the malformed-JSON fallback policy documented. Use everywhere that mutates a single field.

---

## 9. `EventName` exhaustiveness check uses runtime constants — error type is unhelpful at the failure site

- **Severity**: Medium
- **Category**: tooling
- **File**: `src/lib/eventRegistry.ts:813-822`
- **Scenario**: Engineer adds `MY_NEW_EVENT` to `EventName` but forgets the payload entry. They see `Type 'true' is not assignable to type '{ error: 'EventName has values missing from EventPayloadMap'; missing: 'my-new-event' }'.` on line 820 — but `Tooltips` and "Go to definition" point them to a `const _exhaustiveCheck1: ... = true as const` line that doesn't tell them what to do.
- **Root cause**: The clever phantom-type trick works but the assignment to a `true as const` is opaque without reading the comment. Newcomers think the assertion file itself is broken.
- **Impact**: Onboarding tax for what should be a self-explaining failure.
- **Fix sketch**: Replace runtime constants with `type _Check = AssertEqual<keyof EventPayloadMap, EventNameValue>` and a clearer assertEqual helper, *or* add a JSDoc above the assertion that says "If you see an error here, add an entry to `EventPayloadMap` for the missing event."

---

## 10. `applyTemplate`/`applyNlResult` walk 22 setters by hand — one missed override = silently dropped field

- **Severity**: Medium
- **Category**: convention-drift
- **File**: `src/features/triggers/sub_triggers/TriggerAddForm.tsx:82-131`
- **Scenario**: Engineer adds `clipboardPriority` to `TriggerFormState`. They update `buildTriggerConfig` and the JSX. They forget `applyTemplate`. Result: NL parser and templates can't set the new field, but the bug only manifests when a template that uses it is applied.
- **Root cause**: `applyNlResult` and `applyTemplate` enumerate every form field by hand (~20 `if (o.X !== undefined) setX(o.X)` lines). Nothing in TypeScript catches a missing branch.
- **Impact**: New fields are silently dropped from templates/NL parsing. Couples directly to finding #4 (collapse to reducer = bug disappears).
- **Fix sketch**: Once form state is a reducer (#4), `applyTemplate(action: { type: 'apply'; partial: Partial<TriggerFormState> })` becomes `return { ...state, ...partial }`. No enumeration. No miss-able branches.

---

## 11. Schedules and triggers each rebuild "filter-by-persona via window CustomEvent" instead of using a shared filter store

- **Severity**: Low
- **Category**: convention-drift
- **File**: `src/features/schedules/components/ScheduleTimeline.tsx:49-56`
- **Scenario**: A second tab needs the same persona-filter sidebar. Engineer searches for `schedules:filter`, finds the DOM-event pattern, and copy-pastes it (now `triggers:filter`, `executions:filter`, etc.). Each surface adds its own listener + dispatcher + state init.
- **Root cause**: The component uses `window.dispatchEvent(new CustomEvent('schedules:filter', { detail: { personaId } }))` and a matching listener. Works, but it's a private channel between sidebar and page that bypasses zustand.
- **Impact**: Cross-surface sync (e.g. "if I filter by persona X in triggers, also filter schedules") becomes impossible without coordinating two more DOM events. Each new "filter-aware" page adds a new global event name.
- **Fix sketch**: Add `useFilterStore` (zustand) with `{ personaIdFilter, setPersonaIdFilter }`. Replace `window.addEventListener('schedules:filter', ...)` with `useFilterStore((s) => s.personaIdFilter)`. Sidebars set, pages read.
