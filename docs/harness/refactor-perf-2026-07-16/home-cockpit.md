# home/cockpit — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 6 findings (0 critical / 1 high / 4 medium / 1 low)
> Context group: App Shell, Settings & Sharing | Files read: 33 | Missing: 0

## 1. Unconditional metrics refetch on every `personas` change + potential IPC refetch loop on empty fleet
- **Severity**: High
- **Lens**: perf-optimizer
- **Category**: refetch-loop
- **File**: src/features/home/sub_cockpit/CockpitPanel.tsx:65
- **Scenario**: The mount effect `useEffect(..., [personas, fetchPersonas])` calls `getMetricsSummary(7)` unconditionally on every run — so any change to the `personas` array identity (a rename, a trust update, a background refresh) re-issues the metrics IPC call even though metrics only feed the never-composed default cockpit. Worse: on a zero-persona install, `fetchPersonas()` resolves and (if the store writes a fresh `[]` array) the identity change re-triggers the effect, which calls `fetchPersonas()` again — an unbounded IPC fetch loop while the panel is open. The same "fetch-if-empty with the array in deps" pattern repeats in PersonaOverviewWidget.tsx:53 and ConnectedServicesWidget.tsx:31.
- **Root cause**: One effect couples two unrelated fetches, and the guard condition (`personas.length === 0`) is also the state the fetch can re-produce, with the guarded value in the dependency array.
- **Impact**: Redundant SQLite/IPC round-trips on every store update; potential continuous polling on a fresh install (CPU + backend load while idle on the Home tab). Needs verification that `agentStore.fetchPersonas` doesn't preserve array identity on empty results — if it does, the loop half downgrades but the redundant metrics refetch stands.
- **Fix sketch**: Split into two effects. Fetch metrics once on mount (`[]` deps). For the fetch-if-empty pattern, gate on a `useRef` "already requested" flag (or depend on `personas === undefined` vs empty), so an empty fleet fetches exactly once. Apply the same fix in PersonaOverviewWidget and ConnectedServicesWidget.

## 2. Triplicated companion-prefill commit logic across three offer/recap widgets
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/home/sub_cockpit/widgets/PersonaWalkthroughWidget.tsx:82
- **Scenario**: `PersonaWalkthroughWidget.commitWalkthroughToBuild`, `PersonaCreationOfferWidget.buildItForMe` (PersonaCreationOfferWidget.tsx:24), and `PersonaReadyWidget.handleCommit` (PersonaReadyWidget.tsx:81) all hand-build the same `setCompanionPrefill({ intent, name: null, autoLaunch, mode, companionSessionId: null })` + `setSidebarSection('personas')` sequence.
- **Root cause**: Each widget was added in a separate "design-family op" wave and copied the prefill handoff inline instead of extracting it.
- **Impact**: The prefill contract (5 fields + navigation) exists in 3 places; adding a field (e.g. carrying `companionSessionId` through, which all three currently null out) requires 3 synchronized edits — the docstrings already note they "mirror" each other, which is the maintenance hazard in writing.
- **Fix sketch**: Extract `commitPrefillToBuild(intent: string, opts?: { oneShot?: boolean })` into a small module (e.g. `sub_cockpit/widgets/prefill.ts` or next to companionStore) and call it from all three widgets. PersonaReadyWidget keeps its `use_template` branch locally.

## 3. Intent→color mapping duplicated across six widgets
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/home/sub_cockpit/widgets/StatGridWidget.tsx:36
- **Scenario**: The same `good/warn/bad/info(default)` → `emerald/amber/rose/primary-or-foreground` text/border/bg mapping is re-declared per widget: `VALUE_TEXT` (StatGridWidget:36), `INTENT_TEXT` (ComparisonCardsWidget:36), `intentClass` ternary (MetricSparkWidget:32, VerdictWidget:40), `DOT` (TimelineWidget:32), `INTENT_STYLES` (TextCalloutWidget:53), plus the trend ternaries in MetricSpark/StatGrid.
- **Root cause**: Each "explainer" widget shipped with a private copy of the intent palette instead of a shared token map.
- **Impact**: Six independent definitions of the same semantic palette drift easily (Timeline already uses `primary/60` for info while MetricSpark uses `text-foreground`); any design-system color change is a 6-file edit. This matches the repo's known design-system backlog (centralize status colors).
- **Fix sketch**: Add `sub_cockpit/widgets/intentTokens.ts` exporting `INTENT_TEXT`, `INTENT_SURFACE` (border+bg), and `TREND_TEXT` records; replace the per-widget copies. Keep widget-specific extras (e.g. FlowSteps' status ring map) local.

## 4. DecisionDrawer hardcodes English action labels despite loaded i18n
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: hardcoded-strings
- **File**: src/features/home/sub_cockpit/widgets/DecisionDrawer.tsx:149
- **Scenario**: `actionLabel()` maps `labelKey` values like `action_approve` to hardcoded English (`'Approve'`, `'Reject'`, …), and the busy state renders literal `'Working…'` (line 125) — while the component already calls `useTranslation()` and the keys are literally named as translation keys. The close button's `aria-label="Close"` (line 71) is also raw English.
- **Root cause**: The label mapping was stubbed during prototyping and never wired to the catalog; the surrounding files use the `DebtText` escape hatch for the same problem, but this switch bypasses even that.
- **Impact**: Non-English locales show mixed-language action buttons in a decision-critical modal; the dead `labelKey → string` indirection adds a function that exists only to un-translate keys.
- **Fix sketch**: Replace `actionLabel(key)` with `t.<namespace>[key]` lookups (the inbox feature these actions come from very likely already has catalog entries for approve/reject/defer/resolve/dismiss/mark-read — verify in `useInboxActions`' home feature), translate `Working…` and the aria-label, and delete `actionLabel`.

## 5. `spec.specJson` is JSON.parsed on every CockpitPanel render
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/home/sub_cockpit/CockpitPanel.tsx:128
- **Scenario**: `persistentBody` is computed inline in the render body (`JSON.parse(spec.specJson)` inside a try/catch), so every re-render — personas store updates, metrics arriving, companion-state changes, loading toggles — re-parses the full spec JSON and allocates a fresh widgets array, even though `spec` only changes on load/compose events.
- **Root cause**: The parse sits in straight-line render code instead of a `useMemo` keyed on `spec` (unlike `defaultBody`, which is correctly memoized two lines below).
- **Impact**: Bounded but repeated waste on the Home tab's default panel: an LLM-composed spec can be tens of KB, and each parse also produces new `widget.config` object identities, defeating any future memoization of widget cells.
- **Fix sketch**: `const persistentBody = useMemo(() => { if (!spec) return null; try { return JSON.parse(spec.specJson) as CompanionCockpitSpecBody; } catch (err) { silentCatch(...)(err); return null; } }, [spec]);`.

## 6. LinkedDecisionsWidget fetches all pending reviews and filters client-side
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: over-fetch
- **File**: src/features/home/sub_cockpit/widgets/LinkedDecisionsWidget.tsx:39
- **Scenario**: To show reviews for one execution, the widget calls `listManualReviews(personaId, 'pending')` and filters `r.execution_id === executionId` in JS — so a persona with a long pending-review backlog ships the whole set over IPC to render the 0–2 rows tied to this execution, on every mount and after every approve/reject (`reload()`).
- **Root cause**: No execution-scoped query variant existed when the widget was written, so it reuses the persona-wide list endpoint.
- **Impact**: Bounded (pending queues are usually small), but it's a needless full-list transfer repeated after each resolve action, and it makes the widget's cost scale with fleet-wide review volume instead of the execution's.
- **Fix sketch**: Add an `execution_id` filter to the Rust `list_manual_reviews` command (or a `listManualReviewsByExecution` sibling, mirroring `listMemoriesByExecution` which already exists for memories) and pass the id through; drop the client-side filter.
