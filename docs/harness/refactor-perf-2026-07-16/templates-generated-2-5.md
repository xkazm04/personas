# templates/generated [2/5] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 5 findings (0 critical / 1 high / 3 medium / 1 low)
> Context group: Templates & Recipes | Files read: 34 | Missing: 0

## 1. Gallery difficulty/setup filters re-parse the full `design_result` JSON blob per template, per filter pass — up to 3× each
- **Severity**: High
- **Lens**: perf-optimizer
- **Category**: repeated-parse
- **File**: src/features/templates/sub_generated/shared/templateComplexity.ts:53
- **Scenario**: `useGalleryActions.ts:137/142` calls `computeDifficulty(item)` and `computeSetupLevel(item)` inside `.filter()` over the entire gallery list within the `displayItems` useMemo. Every call funnels into `extractSignals()`, which `JSON.parse`s four fields including `review.design_result` — the largest LLM-output blob on the row. Worse, `computeSetupLevel` calls `extractSignals` and then `estimateSetupMinutes` which calls `extractSignals` again, so setup filtering parses each blob twice. The memo re-runs on every filter, search, coverage, or readiness change.
- **Root cause**: `extractSignals` has no memoization even though the same module tree already has a purpose-built parse cache (`reviewParseCache.ts` — `getCachedDesignResult`/`getCachedLightFields` is used ten lines above in the same memo for the component filter); and `computeSetupLevel` doesn't share its signals object with `estimateSetupMinutes`.
- **Impact**: With a few hundred templates and both difficulty+setup filters active, each filter recomputation performs ~3 full JSON.parses of a multi-KB blob per template on the main thread — hundreds of redundant parses per keystroke-adjacent state change, exactly when the UI should feel snappy.
- **Fix sketch**: Cache `ComplexitySignals` per review keyed by identity (a `WeakMap<PersonaDesignReview, ComplexitySignals>` inside templateComplexity.ts, or extend `reviewParseCache`). Refactor `computeSetupLevel`/`estimateSetupMinutes` to share one internal `estimateFromSignals(s)` so signals are extracted once. `computeDifficulty`/`computeSetupLevel`/`estimateSetupMinutes` keep their signatures, so all five call sites (useGalleryActions, useTemplateCardData, TemplateDetailModal, buildComparison) benefit without changes.

## 2. Inert focus trap in useDesignRunnerState — `modalRef` is never attached to any DOM node
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/templates/sub_generated/generation/runner/useDesignRunnerState.ts:56
- **Scenario**: The hook creates `modalRef` (line 34) and installs a document-level keydown listener plus an initial-focus rAF that both query `modalRef.current` — but `DesignReviewRunner.tsx` never attaches `state.modalRef` to anything (it renders through `BaseModal`, which owns its own focus/Escape handling). `modalRef.current` is permanently null.
- **Root cause**: Leftover from a pre-BaseModal hand-rolled modal implementation; the migration to `BaseModal` moved the DOM but not the focus-management code out of the hook.
- **Impact**: ~35 lines of dead focus-trap/focus-restore logic that reads as if it works (a reviewer would assume Tab-trapping is handled here), plus a redundant document keydown listener firing on every keystroke while the modal is open, and Escape-close logic duplicated with `BaseModal`'s. If BaseModal's trap ever regresses, this code silently provides nothing.
- **Fix sketch**: Delete `modalRef`, `triggerRef`, the focus-management effect (lines 46-53) and the focus-trap effect (lines 56-86) from the hook, and drop `modalRef` from its return. Keep only what BaseModal doesn't already do — verify BaseModal handles Escape-with-`isRunning`-guard via the `onClose={() => { if (!isRunning) onClose(); }}` wrapper already present in DesignReviewRunner.tsx:48 (it does).

## 3. ConnectorFilterDropdown and ComponentFilterDropdown are ~160-line near-clones
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/templates/sub_generated/gallery/search/filters/ComponentFilterDropdown.tsx:15
- **Scenario**: The two dropdowns (ComponentFilterDropdown.tsx and ConnectorFilterDropdown.tsx:11) are structurally identical: same state (`isOpen`/`dropdownSearch`), same `useClickOutside` + `useViewportClampAbsolute` + focus-after-50ms effect, same debounced search + sort/filter memo pair, same trigger button with count badge, same popup with search input, item rows with icon tile + `highlightMatch` + count pill + checkbox, same clear-all footer. Only the meta lookup (`ARCH_CATEGORIES[key]` vs `getConnectorMeta(name)`), icon, and i18n keys differ.
- **Root cause**: The component dropdown was created by copy-pasting the connector dropdown and swapping the meta source.
- **Impact**: Every behavior tweak (keyboard nav, a11y roles, clamp fix, styling) must be applied twice; the two have already begun to drift only in trivia, which is the classic precursor to real divergence bugs.
- **Fix sketch**: Extract a generic `FilterDropdown<T>` taking `{ items: {key, count}[], getMeta(key) => {label, renderIcon, color}, labels: {trigger, searchPlaceholder, emptySearch, emptyNone}, TriggerIcon }` and reimplement both files as thin ~20-line wrappers. Pure UI consolidation, no behavior change.

## 4. MessagingPickerShared is a `@ts-nocheck` prototype whose mock data is wired into the ucPicker flow
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: cleanup
- **File**: src/features/templates/sub_generated/adoption/MessagingPickerShared.tsx:1
- **Scenario**: The file opens with `@ts-nocheck` and a header claiming it is "Not imported by the production adoption flow yet", but `ucPicker.tsx`, `ucCard.tsx`, and `useUcPickerState.ts` import `MOCK_EMIT_EVENTS_BY_UC`, `SAMPLE_MESSAGE_BY_UC`, and `mockTestDelivery` from it — `useUcPickerState.ts:245` even awaits `mockTestDelivery` (a `setTimeout`-based fake with a deliberate random 30% "flaky discord" failure) when the user hits Test.
- **Root cause**: The visual-review prototype won and its consumers shipped, but the mock-data module and its own 6-step cleanup checklist (lines 6-13) were never executed; the header comment is now stale/false.
- **Impact**: A whole module is exempt from type-checking while feeding live UI; any user reaching the ucPicker Test button gets fabricated delivery results (including random failures) against hardcoded stock-trading fixtures (`uc_signals`, `uc_congressional_scan`) that won't match real templates' UC ids — so real templates silently get empty `emits`. Verification needed on whether the ucPicker surface is reachable in release builds; if it is, this leans High.
- **Fix sketch**: Execute the file's own checklist: replace `MOCK_MESSAGING_CHANNELS` with the vault-store filter, source `SAMPLE_MESSAGE_BY_UC`/`MOCK_EMIT_EVENTS_BY_UC` from `template.use_cases[]`, wire `mockTestDelivery` to the real `test_channel_delivery` IPC, then drop `@ts-nocheck`. If the ucPicker surface is not yet reachable, gate it behind a dev flag instead and update the stale header.

## 5. TemplateCardBody puts the list `key` on the wrong element inside the connectors map
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/templates/sub_generated/gallery/cards/renderers/TemplateCardBody.tsx:97
- **Scenario**: In `connectors.map((c) => ...)` the returned root element is `<Tooltip content=... placement="bottom">` with no `key`; `key={c}` sits on the inner `<div>` where React ignores it for list reconciliation. React logs a missing-key warning for every card render and falls back to index-based reconciliation.
- **Root cause**: The Tooltip wrapper was added around the existing keyed div without moving the key up.
- **Impact**: Console-warning noise on every gallery card render, and when a card's connector list changes (e.g. after re-generation) React reconciles by index — remounting Tooltip subtrees unnecessarily. Bounded cost, but it is a one-line fix on a hot list surface.
- **Fix sketch**: Move `key={c}` from the inner div to the `<Tooltip>` element (the map's root). Same pattern is done correctly in CompareModal.tsx:60 — mirror it.
