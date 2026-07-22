# agents/use_cases [2/2] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 3 findings (0 critical / 0 high / 2 medium / 1 low)
> Context group: Persona Authoring & Design | Files read: 5 | Missing: 0

## 1. `getUseCaseById` re-parses the full design_context JSON on every hook render
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/agents/sub_use_cases/libs/useCaseHelpers.ts:11 (call site: src/features/agents/sub_use_cases/libs/useUseCaseDetail.ts:32)
- **Scenario**: `useUseCaseDetail` calls `getUseCaseById(selectedPersona?.design_context, useCaseId)` inline (no memo). The hook subscribes to `isTestRunning` and `testRunProgress`, which tick repeatedly while a test run streams — every tick re-renders the hook and re-runs `JSON.parse` over the entire persona `design_context` string plus a linear scan of `useCases`.
- **Root cause**: The helper is a pure parse-and-find over a raw JSON string, and the one render-path consumer invokes it un-memoized instead of keying on `[design_context, useCaseId]`. (The other consumer, fleet `MonitorDrawer.tsx`, wraps `getUseCases` appropriately — the pattern exists but wasn't applied here.)
- **Impact**: For personas with a large design_context (many use cases, fixtures, sample inputs), a full JSON parse per progress tick is measurable wasted main-thread work during exactly the moment the UI is busiest (streaming test run). Every parse also produces fresh object identities, which defeats the downstream `useMemo`s keyed on `useCase?.test_fixtures` / `useCase?.model_override` — they recompute each render and hand new references to children, cascading re-renders through the detail panel.
- **Fix sketch**: In `useUseCaseDetail`, wrap the lookup: `const useCase = useMemo(() => getUseCaseById(selectedPersona?.design_context, useCaseId), [selectedPersona?.design_context, useCaseId]);`. Since `design_context` is a string, the memo key is a cheap compare and the parse runs only when the persona document actually changes; this single change also restores stable identities for the downstream memos. Optionally add a module-level last-string parse cache inside `parseDesignContext` so all helpers share one parse per distinct string.

## 2. `useCaseHelpers.ts` carries dead exports: `updateUseCaseInContext` plus two back-compat re-exports with zero importers
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/agents/sub_use_cases/libs/useCaseHelpers.ts:5
- **Scenario**: A repo-wide grep shows only two importers of this module (`useUseCaseDetail.ts`, fleet `MonitorDrawer.tsx`) and both import only `getUseCaseById` / `getUseCases`. The `applyDesignContextMutation` re-export (line 5), the `UseCaseItem` type re-export (line 8), and the entire `updateUseCaseInContext` function (lines 28–37) have no importers anywhere in src/.
- **Root cause**: Back-compat shims kept after the mutation queue moved to `@/hooks/design/core/useDesignContextMutator`; all call sites have since migrated to the canonical paths (`UseCaseItem` consumers import from `sub_lab/use-cases/UseCasesList` or `frontendTypes` directly), leaving the shims and the superseded `updateUseCaseInContext` orphaned.
- **Impact**: Beyond noise, `updateUseCaseInContext` is a maintenance hazard: it is a parallel, non-queued read-modify-write path sitting next to the queued `mutateSingleUseCase`. A future caller picking it by name would silently bypass the read-latest mutation queue and reintroduce the lost-update races the queue exists to prevent (the exact class of bug fixed in the 2026-07 races wave).
- **Fix sketch**: Delete `updateUseCaseInContext`, the `applyDesignContextMutation` re-export, and the `UseCaseItem` type re-export; keep `getUseCaseById`/`getUseCases`. Verify with a final grep for `from '.*useCaseHelpers'` (only the two known importers should remain). Dynamic use is implausible — these are static ES imports of a typed helper module.

## 3. `MiniSigil` shim has a single same-directory consumer and an unused export
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/agents/sub_use_cases/components/recipes-prototype/shared/MiniSigil.tsx:11
- **Scenario**: The file is a pure rename shim (`CapabilitySigil as MiniSigil`, `EmptyCapabilitySigil as EmptyMiniSigil`). Grep shows exactly one importer — `UseCaseDetailExpanded.tsx:20` in the same directory — and it imports only `MiniSigil`; `EmptyMiniSigil` has zero importers anywhere. (The `MiniSigil` in `sub_glyph/GlyphRowStrip.tsx` is an unrelated private local component, not this export.)
- **Root cause**: The shim's own docblock says it exists "for back-compat with existing scratch / recipes call sites"; those call sites have dwindled to one, and the empty-state alias was never adopted.
- **Impact**: An extra indirection file in a prototype tree that the shim itself tells new code not to use — small, but it keeps the deprecated names alive and the unused `EmptyMiniSigil` export is pure dead weight.
- **Fix sketch**: Update `UseCaseDetailExpanded.tsx` to import `CapabilitySigil` from `@/features/shared/glyph/CapabilitySigil` (renaming the JSX usage at line 230), then delete `MiniSigil.tsx`. One-line consumer change plus one file deletion; no dynamic-import risk since the names are statically imported.
