# hooks (misc 2) — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 4 findings (0 critical / 0 high / 2 medium / 2 low)
> Context group: Core Libraries & State | Files read: 7 | Missing: 0

## 1. useSliceError.ts is entirely dead code
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/hooks/useSliceError.ts:15
- **Scenario**: Both exports (`useSliceError`, `useAllSliceErrors`) have zero callers anywhere in `src/` — the only matches for either name are the definitions and the file's own JSDoc example. The file is also not re-exported from the `src/hooks/index.ts` barrel, so nothing can reach it that way either.
- **Root cause**: The hook was built as the read-side companion to the store `sliceErrors`/`reportError` pattern, but no UI surface was ever wired to it (or the callers were later removed).
- **Impact**: 37 lines of dead API that reads as a supported contract; future contributors may maintain or extend it for nothing, and it silently drifts from the actual store error-reporting shape.
- **Fix sketch**: Grep once more for dynamic access to `sliceErrors` in components to be sure the read pattern isn't hand-rolled elsewhere, then either delete `src/hooks/useSliceError.ts`, or — if the sliceErrors store pattern is still the intended error surface — wire the hook into the banners that currently select `sliceErrors` inline. Hooks cannot be invoked dynamically, so the zero-callers result is conclusive for this file.

## 2. useTauriEvent and useTypedTauriEvent duplicate the entire subscription-lifecycle body
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/hooks/useTauriEvent.ts:39
- **Scenario**: The two hooks' `useEffect` bodies (lines 39–58 vs 81–100) are byte-for-byte identical except for the `listen` vs `typedListen` call: same `cancelled` flag, same then/catch unlisten dance, same cleanup, same deps array. This hook pair is used from 20+ call sites, so both copies are load-bearing.
- **Root cause**: `useTypedTauriEvent` was added by copy-pasting `useTauriEvent` and swapping the subscribe function instead of extracting the shared async-cleanup mechanism.
- **Impact**: The subtle unmount-before-resolve race handling — the exact bug class the file's own comment says bit `ContextMapPage` — must now be fixed in two places; a future correction to one copy (e.g. re-run teardown ordering) can silently miss the other.
- **Fix sketch**: Extract a private `useSubscription(subscribe: () => Promise<UnlistenFn>, errorContext, deps)` (or a non-hook `subscribeWithCancel` helper returning `{cancel}`) containing the cancelled/unlisten logic once. `useTauriEvent` passes `() => listen(eventName, guarded)` and `useTypedTauriEvent` passes `() => typedListen(eventName, guarded)`. No call-site changes; behavior identical.

## 3. useWizardReducer requires a stepMeta option it never reads
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/hooks/useWizardReducer.ts:26
- **Scenario**: `WizardReducerOptions.stepMeta` is a required field, and the only caller (`useCreateTemplateReducer.ts:87`) dutifully passes `CREATE_TEMPLATE_STEP_META` — but the hook destructures only `initialState`, `canGoBack`, and `goBack`; `stepMeta` is silently dropped.
- **Root cause**: The option was presumably planned for step-index/label derivation inside the hook but the feature never landed; the type still demands it.
- **Impact**: Every future wizard built on this factory must invent a `Record<string, StepMeta>` just to satisfy the type, implying behavior (progress labels, ordering) that the hook does not provide. Also note the generic "wizard core" in `src/hooks/` is hard-coupled to the templates domain via the `N8nPersonaDraft` import in `WizardStateBase` — worth untangling in the same pass.
- **Fix sketch**: Delete `stepMeta` from `WizardReducerOptions` (and the `StepMeta` export if then unused) and drop the argument at the single call site; the caller keeps its own exported `CREATE_TEMPLATE_STEP_META` for its UI. Optionally make `draft` generic (`WizardStateBase<D>`) to remove the `N8nPersonaDraft` import from the shared hook.

## 4. usePersonaVibe re-derives the vibe on persona object-identity change, not content change
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/hooks/theming/usePersonaVibe.ts:21
- **Scenario**: The `useMemo` is keyed on the `selectedPersona` object reference. Any store update that replaces the persona object without changing its text (refetch of the personas list, save of an unrelated field, optimistic update round-trip) re-runs `deriveVibe`, which scans `name + description + system_prompt` (system prompts can be multi-KB).
- **Root cause**: Memo dependency is the whole object instead of the three string fields the derivation actually consumes.
- **Impact**: Bounded — one string scan per persona-object replacement in a single provider (`VibeThemeProvider` wraps the app). Cheap in isolation, but it runs on a hot store path and is a one-line fix.
- **Fix sketch**: Select the three fields (e.g. `useAgentStore(useShallow((s) => s.selectedPersona ? [s.selectedPersona.name, s.selectedPersona.description, s.selectedPersona.system_prompt] : null))`) and key the memo on them, or change the `useMemo` deps to `[selectedPersona?.name, selectedPersona?.description, selectedPersona?.system_prompt]`. Also stops the provider itself from re-rendering on identity-only persona swaps.
