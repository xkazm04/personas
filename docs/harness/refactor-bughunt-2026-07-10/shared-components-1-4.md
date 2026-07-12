> Context: shared/components [1/4]
> Total: 10
> Critical: 0  High: 0  Medium: 6  Low: 4

## 1. Hold-to-repeat timer leaks forever when a step reaches min/max mid-hold
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: race-condition
- **File**: src/features/shared/components/forms/NumberStepper.tsx:130-149, 173-207
- **Scenario**: User presses and holds the `+` button. `startRepeat(1)` schedules an accelerating `setTimeout` loop. The value climbs to `max`, so `atMax` becomes true and the button is re-rendered with `disabled`. The user then releases the pointer — but a **disabled** `<button>` does not dispatch `pointerup` / `pointerleave` / `pointercancel`, so `endStep()` (the only caller of `stopRepeat`) never runs. The `tick` loop keeps re-scheduling itself every ~40ms indefinitely (each `doStep` is now a no-op because `next === valueRef.current`).
- **Root cause**: The repeat loop is stopped only through pointer events on the same button that gets `disabled` when the boundary is hit; a disabled control swallows those events.
- **Impact**: A runaway ~25Hz timer runs for the rest of the component's mounted lifetime (until the unmount cleanup `useEffect(() => stopRepeat, …)` fires) — wasted CPU/wakeups on a desktop app, and it recurs every time a user "holds to max".
- **Fix sketch**: Stop the repeat when the boundary is reached inside `doStep`/`startRepeat` (e.g. if `next === valueRef.current` twice, call `stopRepeat()` + `fireCommit`), and/or attach `onPointerUp`/`onPointerLeave` to a wrapping element rather than the button so release is always observed.

## 2. KeyValueEditor wipes a value typed before its key
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: state-corruption
- **File**: src/features/shared/components/forms/KeyValueEditor.tsx:37-44, 52-61
- **Scenario**: A row is `{ key: '', value: 'hello' }` (user filled the value before the key). `updateRow` → `syncToJson` calls `onChange(rowsToJson(rows))`, but `rowsToJson` drops any row whose trimmed key is empty, so it emits `'{}'`. The parent echoes `value='{}'` back; the `useEffect([value, isAdvanced])` runs `jsonToRows('{}')` → `[]` → `setRows([{ key:'', value:'' }])`, discarding the just-typed `'hello'`.
- **Root cause**: The component round-trips local row state through a JSON string that cannot represent a keyless-but-valued row, and a controlled-value effect overwrites local edits.
- **Impact**: Silent data loss of user input on a normal editing path (value-first entry); the field appears to clear itself as you type.
- **Fix sketch**: Don't re-derive `rows` from `value` while the user is actively editing the simple view (guard on a focus/dirty ref), or preserve keyless rows in `rowsToJson` round-trips (keep them in local state and only strip on final serialize).

## 3. Consent-section colored backgrounds never render (dynamic Tailwind classes)
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: silent-failure
- **File**: src/features/shared/components/overlays/FirstUseConsentModal.tsx:70-108
- **Scenario**: `ConsentSection` builds classes with runtime interpolation: ``border-${color}/25 bg-${color}/5``. Tailwind only emits classes it can see statically at build time, so `bg-violet/5`, `border-emerald/25`, etc. are purged and never exist. The open-state border is partially rescued via an inline `style={{ borderColor: 'var(--color-${color}, rgba(100,100,100,0.25))' }}`, but there is no CSS variable named `--color-violet`/`--color-emerald` (those are Tailwind palette names, not custom props), so the fallback gray is always used, and the `bg-${color}/5` tint is applied nowhere.
- **Root cause**: Tailwind's static-extraction constraint violated by template-literal class names.
- **Impact**: Every expanded consent accordion shows a flat gray border and no colored surface tint — the intended per-topic color coding is dead. Purely visual, but on the app's first-run legal/consent screen.
- **Fix sketch**: Replace with a static lookup map (as `ContentLayout.tsx`'s `ICON_COLOR_MAP` and `Button.tsx`'s `ACCENT_CLASSES` already do): `const TONE = { violet: { border: 'border-violet-500/25', bg: 'bg-violet-500/5' }, … }` keyed by `color`.

## 4. Tooltip open-timer is not cleared before scheduling a new one → ghost tooltip
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: race-condition
- **File**: src/features/shared/components/display/Tooltip.tsx:216-228
- **Scenario**: `show()` assigns `timerRef.current = setTimeout(...)` without clearing any existing timer. If both `onMouseEnter` and `onFocus` fire (e.g. a click that also hovers), two timers exist but `timerRef` only tracks the second. A quick `onMouseLeave`/`onBlur` → `hide()` clears the tracked timer and sets `visible=false`, but the first orphaned timer still fires `setVisible(true)`, showing a tooltip after the pointer/focus has left.
- **Root cause**: Single-slot timer ref with a setter that can be invoked twice before the matching cleanup.
- **Impact**: Occasional stuck/ghost tooltip; minor visual glitch.
- **Fix sketch**: At the top of `show()`, `if (timerRef.current) clearTimeout(timerRef.current);` before scheduling.

## 5. DataGrid resets to page 1 whenever the row count changes
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: edge-case
- **File**: src/features/shared/components/display/DataGrid.tsx:174-175
- **Scenario**: `useEffect(() => { setPage(1); }, [data.length])`. Deleting/actioning a single row on page 4 changes `data.length` and snaps the user back to page 1. Same for any incremental append/removal — the intent is "reset when filters change" but the trigger is length, which also changes on ordinary row mutations.
- **Root cause**: Using `data.length` as a proxy for "filters changed" conflates it with routine add/remove.
- **Impact**: Disorienting pagination jumps after edits/deletes on later pages.
- **Fix sketch**: Clamp instead of reset — `setPage(p => Math.min(p, totalPages))` — or key the reset to an explicit filter-identity prop rather than `data.length`.

## 6. Two overlapping generic table components (DataGrid vs UnifiedTable)
- **Lens**: code-refactor
- **Severity**: medium
- **Category**: duplication
- **File**: src/features/shared/components/display/DataGrid.tsx:1-507; src/features/shared/components/display/UnifiedTable.tsx:1-636
- **Scenario**: Both are generic `<T>` grid components sharing the same column model (`{ key, label, width, render, sortable, filterOptions, align }`), the same CSS-grid `gridTemplateColumns` layout, striping (`idx % 2`), row-accent border, `onRowClick`, empty state, and header filter/sort chrome. DataGrid adds pagination + bulk toolbar + drag; UnifiedTable adds virtualization + grouping + column resize. Verified both are widely imported (DataGrid ~14 sites, UnifiedTable ~45), so they've diverged rather than one superseding the other.
- **Root cause**: Two parallel "golden standard table" efforts that never merged; column-type and row-render logic duplicated.
- **Impact**: Maintainability — bug/UX fixes (e.g. accent precedence, a11y row nav, striping) must be made twice and drift.
- **Fix sketch**: Extract the shared column type + row/cell renderer + grid-template helper into one module both consume; keep pagination vs virtualization as composable behaviors. Large blast radius — stage behind the shared column type first.

## 7. Duplicated portal-dropdown positioning logic (ThemedSelect vs Listbox)
- **Lens**: code-refactor
- **Severity**: medium
- **Category**: duplication
- **File**: src/features/shared/components/forms/ThemedSelect.tsx:99-133; src/features/shared/components/forms/Listbox.tsx:92-121
- **Scenario**: Both re-implement the same pattern: an `open` dropdown portalled to `document.body`, a `getBoundingClientRect()`-based position recomputed on `scroll` (capture) + `resize`, and a mousedown click-outside guard that must check both the trigger container and the portalled menu. ThemedSelect's `FilterableSelect` and `Listbox` carry near-identical effects.
- **Root cause**: Anchored-portal-menu mechanics copied per component instead of shared.
- **Impact**: Maintainability — flip-up logic, z-index clearance vs modals, and scroll-tracking fixes get made independently.
- **Fix sketch**: Extract a `useAnchoredPortal(triggerRef, open)` hook returning `{ pos, menuRef }` (with optional flip) and have both components consume it.

## 8. Two different components both named EmptyState, both exporting an EmptyStateVariant type
- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication
- **File**: src/features/shared/components/display/EmptyState.tsx:192-266; src/features/shared/components/feedback/EmptyState.tsx:8-172
- **Scenario**: `display/EmptyState` is an illustration/variant component (`chart|activity|alerts|…`, named export `EmptyState`); `feedback/EmptyState` is a scenario/icon+steps component (`credentials-need-agents|…`, `default` export `EmptyState`). Both additionally export a **type** `EmptyStateVariant` with entirely different members. Verified both are used across the app.
- **Root cause**: Naming collision from two independent empty-state systems.
- **Impact**: Import confusion and easy mis-imports (default vs named, wrong `EmptyStateVariant`); IDE auto-import can pick the wrong one.
- **Fix sketch**: Rename to intent-revealing names (e.g. `IllustratedEmptyState` / `ScenarioEmptyState`) and distinct variant type names; keep both, just disambiguate.

## 9. TransformStatusPanels ships hardcoded English amid an otherwise i18n'd surface
- **Lens**: code-refactor
- **Severity**: low
- **Category**: i18n-inconsistency
- **File**: src/features/shared/components/progress/TransformStatusPanels.tsx:59-131
- **Scenario**: The component pulls most copy from `t.shared.progress_extra.*`, but several user-visible strings are raw literals: `'Starting transformation...'` (l.62), `` `Step ${…} of ${…}` `` and `'Starting...'` (l.65), the `Cancel` button label (l.86), `'Check the output below for details.'` error fallback (l.122), and the `Retry` button label (l.131).
- **Root cause**: Untranslated fallbacks left in during buildout.
- **Impact**: These render as English in every locale; inconsistent with the rest of the panel.
- **Fix sketch**: Move each literal into `t.shared.progress_extra` and interpolate `step`/`total` via the existing `replace('{…}', …)` convention.

## 10. SectionCard.CollapsibleBody accepts a `blur` prop it never uses
- **Lens**: code-refactor
- **Severity**: low
- **Category**: dead-code
- **File**: src/features/shared/components/layout/SectionCard.tsx:140-178
- **Scenario**: `CollapsibleBody`'s prop type declares `blur: boolean` and the parent passes `blur={blur}`, but the body only ever reads `blurClass` (the precomputed string). `blur` is inert inside the child.
- **Root cause**: Leftover prop after `blurClass` was hoisted to the parent.
- **Impact**: Minor — dead prop that misleads readers into thinking the child re-derives blur.
- **Fix sketch**: Drop `blur` from `CollapsibleBody`'s props and the call site; keep only `blurClass`.
