> Context: home/cockpit
> Total: 9
> Critical: 0  High: 0  Medium: 5  Low: 4

## 1. Window-focus refetch flashes a full-panel spinner over a valid cockpit
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: edge-case
- **File**: src/features/home/sub_cockpit/CockpitPanel.tsx:62-75, 175-199
- **Scenario**: The user has a composed cockpit rendered. The window loses and regains focus (alt-tab, notification, opening the companion chat). The `focus` handler calls `load()`, which does `setLoading(true)` unconditionally. On the next render `!contextualCockpit && loading` is true, so the entire 12-widget grid is torn down and replaced by a centered `LoadingSpinner` for the whole IPC round-trip, then re-mounts when the fetch resolves.
- **Root cause**: `loading` is treated as "any fetch in flight" rather than "first load with no data yet". `setSpec` is only called on success, so the old spec is still available during a refetch, but the render doesn't use it.
- **Impact**: UX — every focus change flashes the cockpit to a blank spinner and remounts every data-fetching widget (Execution/LinkedDecisions/etc. re-run their IPC). Also loses scroll position / in-flight widget state.
- **Fix sketch**: Only show the spinner on the initial load: gate the spinner branch on `loading && !spec` (mirror the existing `error && !spec` guard). Keep rendering the existing grid while a background refetch is in flight.

## 2. ConnectedServicesWidget never fetches personas, so usage counts silently show "—"
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: silent-failure
- **File**: src/features/home/sub_cockpit/widgets/ConnectedServicesWidget.tsx:29-60
- **Scenario**: The cockpit is the landing surface and `agentStore.personas` hasn't been populated yet (no prior visit to the Personas/Overview tabs). The widget reads `personas` from the store but — unlike `PersonaOverviewWidget`, which calls `fetchPersonas()` in an effect — never triggers a fetch. `usageByCredentialId` is therefore empty and every credential row renders "—" instead of "N personas".
- **Root cause**: The widget consumes `personas` as if it were always hydrated, but there is no guaranteed app-shell fetch before the cockpit mounts (grep: only `PersonaOverviewWidget` calls `fetchPersonas` in this feature tree).
- **Impact**: UX / wrong data — the "how many personas use this credential" column, the widget's whole reason to exist beyond the Connections page, is blank until the user happens to visit another tab.
- **Fix sketch**: Add the same guarded effect as PersonaOverviewWidget: `useEffect(() => { if (!personas?.length) useAgentStore.getState().fetchPersonas().catch(silentCatch(...)); }, [personas])`.

## 3. DecisionDrawer action failure is an unhandled rejection with no user feedback
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: silent-failure
- **File**: src/features/home/sub_cockpit/widgets/DecisionDrawer.tsx:36-46, 99-127
- **Scenario**: The user clicks Approve/Reject/Resolve in the drawer. `run()` does `await action.run(...)` inside a `try/finally` with **no catch**, and is invoked as `void run('primary')`. If the underlying command rejects (IPC error, backend failure), the rejection escapes as an unhandled promise; `busy` resets so the button re-enables, but no toast fires and `onClose()` is skipped — the user just sees the button flip back with zero indication the approval failed.
- **Root cause**: Missing error handling. The sibling `LinkedDecisionsWidget.resolve` wraps the same class of call in `toastCatch('Failed to update review')`; the drawer diverged.
- **Impact**: Data/trust — an approval or rejection the user believes may have applied silently failed; they may assume success and move on.
- **Fix sketch**: Add a `catch` to `run()` that calls `toastCatch('DecisionDrawer:action')(e)` (and does not call `onClose`), matching LinkedDecisionsWidget.

## 4. BrowserTestReportWidget mutates goal UAT state as a render side effect
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: trust-boundary
- **File**: src/features/home/sub_cockpit/widgets/BrowserTestReportWidget.tsx:64-75
- **Scenario**: The widget's `kind` (`browser_test_report`) is registered in `cockpitWidgetRegistry` and, per the registry comment, is "also valid in `compose_cockpit`" (persistent spec). When `config.goal_id` is present and every step has `result === 'pass'`, an effect auto-calls `completeGoalUat(goalId)` — closing the goal's acceptance gate so the goal can reach `done`. This means merely rendering a report card advances goal lifecycle, and on a fresh mount (navigating back to the tab, or a spec recompose that remounts the cell) the guard ref resets and it fires again.
- **Root cause**: A read-only "verdict" widget performs a lifecycle-mutating write. The `closeAttempted` ref only dedupes within a single mount, not across remounts, and the write is gated on model-authored `steps`/`goal_id` rather than an explicit user action.
- **Impact**: Correctness/trust — a goal's human acceptance gate can be auto-closed by an LLM-composed cockpit widget without an explicit user click; relies entirely on `completeGoalUat` being idempotent.
- **Fix sketch**: Gate the UAT close on an explicit user affordance (a "Mark UAT passed" button) rather than an effect, or restrict this auto-close to the ephemeral contextual/browser-test turn (not `compose_cockpit`). At minimum, persist the "attempted" state so a remount can't re-fire.

## 5. StatGridWidget produces `repeat(NaN, …)` when `columns` isn't a number
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: edge-case
- **File**: src/features/home/sub_cockpit/widgets/StatGridWidget.tsx:47, 61-64
- **Scenario**: Athena emits `config.columns` as a non-numeric value (e.g. `"three"`, or omits it as `null`). `Math.min((config?.columns as number) ?? 3, 4)` → `Math.min(NaN, 4)` → `NaN`, `Math.max(2, NaN)` → `NaN`, so `gridTemplateColumns: repeat(NaN, minmax(0,1fr))` is an invalid grid template and the tiles collapse to a single unstyled column.
- **Root cause**: The `as number` cast trusts free-form LLM config without validating it's actually a finite number (the `?? 3` only guards null/undefined, not NaN).
- **Impact**: UX — degraded/broken grid layout on adversarial or sloppy config. Narrow blast radius (one widget).
- **Fix sketch**: `const raw = Number(config?.columns); const columns = Number.isFinite(raw) ? Math.max(2, Math.min(raw, 4)) : 3;`

## 6. personaStats: stale "shared" doc + dead TierAccent fields; single importer
- **Lens**: code-refactor
- **Severity**: medium
- **Category**: dead-code
- **File**: src/features/home/sub_cockpit/widgets/personaStats.ts:42-106
- **Scenario**: The header comment claims `modelTierAccent`'s `TierAccent` bundle is "used by Constellation nodes + Atelier hero cards", and the interface carries `fillClass`, `strokeClass`, `strokeHoverClass`, and `haloHex` "for inline SVG strokes". Grep shows `personaStats.ts` is imported by exactly one file (`PersonaOverviewWidget.tsx`), and `haloHex` / `strokeHoverClass` / `fillClass` appear in no other file — they are computed for all four tiers but never read. PersonaOverviewWidget only consumes `borderClass`, `bgSoftClass`, `textClass`, `btnClass`.
- **Root cause**: Prototype-phase "shared helpers" note (the file even says "Lives next to the variants during prototyping … inline before Phase 5 consolidation") never got the promised consolidation; the SVG-stroke fields for a Constellation consumer that doesn't (any longer) import this module are leftover.
- **Impact**: Maintainability — misleading comment implies cross-surface coupling that doesn't exist; four dead fields × four tiers of hardcoded hex/class strings to keep in sync for nothing.
- **Fix sketch**: Drop `fillClass`/`strokeClass`/`strokeHoverClass`/`haloHex` from `TierAccent` and the four returns, and correct the module + `modelTierAccent` comments to reflect the single real consumer (or genuinely re-share it if Constellation is meant to use it).

## 7. Three near-duplicate relative-time formatters
- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication
- **File**: src/features/home/sub_cockpit/CockpitPanel.tsx:268-276; widgets/personaStats.ts:136-145; widgets/DecisionLogWidget.tsx:121-143
- **Scenario**: `CockpitPanel.formatRelative` (just now / Nm / Nh / date) is a strict subset of `personaStats.relativeUpdated` (same plus a `Nd` branch). `DecisionLogWidget.prettyTime` is a third hand-rolled today-vs-date formatter. Meanwhile the same feature already imports a shared `RelativeTime` component (TimelineWidget) and `formatRelativeTime` util (MessageSummaryWidget/DecisionsPanelWidget).
- **Root cause**: Each widget grew its own timestamp helper instead of reusing the shared display utilities.
- **Impact**: Maintainability — inconsistent relative-time rendering across the same panel; multiple copies to fix if the format changes.
- **Fix sketch**: Delete `formatRelative`/`prettyTime` and route the cockpit header + decision-log timestamps through the shared `formatRelativeTime`/`RelativeTime`; keep a single `relativeUpdated` if a persona-specific variant is truly needed.

## 8. Repeated intent→text-color maps across five widgets
- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication
- **File**: widgets/MetricSparkWidget.tsx:32-46; StatGridWidget.tsx:36-41; ComparisonCardsWidget.tsx:36-41; VerdictWidget.tsx:40-47; TextCalloutWidget.tsx:53-86
- **Scenario**: The `good→emerald-400 / warn→amber-400 / bad→rose-400 / default→foreground|primary` mapping is re-implemented as an inline ternary or a `Record` in each of these widgets (and the trend up/down variant twice). Verified by reading each: same four colors, same intent keys.
- **Root cause**: No shared intent-tone helper for cockpit widgets; each widget re-declares it.
- **Impact**: Maintainability — a palette tweak (e.g. status-token migration, which BrowserTestReportWidget already adopted via `text-status-*`) must be applied in five places and is already drifting (raw `emerald/amber/rose` here vs `status-success/warning/error` in BrowserTestReportWidget).
- **Fix sketch**: Add one `intentTextClass(intent)` / `intentTrendClass(trend)` helper (or a shared `Record`) in the cockpit widgets dir and reuse; prefer the `text-status-*` tokens already used by BrowserTestReportWidget.

## 9. Duplicate inbox-kind → icon mapping in KindBadge and KindGlyph
- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication
- **File**: widgets/DecisionDrawer.tsx:134-147; widgets/DecisionsPanelWidget.tsx:73-92
- **Scenario**: `DecisionDrawer.KindBadge` and `DecisionsPanelWidget.KindGlyph` both switch `UnifiedInboxItem['kind']` (approval/message/health/output) onto the same four lucide icons (ShieldCheck/MessageSquare/Activity/FileText), differing only in wrapper styling.
- **Root cause**: The drawer and its parent list each grew their own kind→icon renderer.
- **Impact**: Maintainability — adding a new inbox kind requires editing both; icon/kind pairing can drift between the row and its opened drawer.
- **Fix sketch**: Extract a shared `inboxKindIcon(kind)` (returning the lucide component) in the inbox `_shared` dir (next to `toneForInboxItem`) and have both components consume it.
