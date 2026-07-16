# agents/design — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 5 findings (0 critical / 2 high / 2 medium / 1 low)
> Context group: Persona Authoring & Design | Files read: 33 | Missing: 0

## 1. Auto-start design effect cancels itself — compile never fires, orphaned conversation row per attempt
- **Severity**: High
- **Lens**: perf-optimizer
- **Category**: wasted-work
- **File**: src/features/agents/sub_design/libs/useDesignTabState.ts:66-96
- **Scenario**: An external surface sets `autoStartDesignInstruction` (systemStore) to kick off a design run. Inside `startAutoDesign`, `setAutoStartDesignInstruction(null)` runs synchronously — but `autoStartDesignInstruction` is itself a dependency of this effect, so as soon as React commits that store change the effect's cleanup runs and sets `cancelled = true`. `startConversation()` is a real async IPC, so by the time it resolves, `if (cancelled) return` aborts before `compile()` is ever dispatched.
- **Root cause**: The effect nulls out one of its own dependencies mid-flight; the `cancelled` cleanup flag (added to guard persona switches) cannot distinguish "user navigated away" from "we consumed the trigger ourselves".
- **Impact**: The auto-start path silently no-ops (feature broken) while still burning the `mutateDesignFiles` + `startConversation` IPCs — leaving an orphaned, empty design-conversation row in the DB on every attempt.
- **Fix sketch**: Consume the trigger via a ref instead of a reactive dep: read `autoStartDesignInstruction` once, stash it in a `useRef`, and key the effect only on `selectedPersona?.id`/`phase`; or scope the cleanup flag to persona identity (`cancelled = startedForPersonaId !== currentPersonaIdRef.current`) rather than flipping on every dep change. Delete the orphaned conversation (or reuse it) when aborting after `startConversation` resolves.

## 2. Entire wizard + example-input surface is dead code (~850 LOC across 5 files)
- **Severity**: High
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/agents/sub_design/wizard/DesignWizard.tsx:18
- **Scenario**: Grep across `src/` shows `DesignWizard` is exported from `sub_design/index.ts` but never imported anywhere (the only external import of the barrel is `DesignHub` in EditorLazyTabs.tsx). `components/PhasePanelHeader.tsx` (`InputModeToggle`, `AnalyzeButton`) and `components/PairItem.tsx` are imported by no file at all. The `ExamplePairCollector` component is never rendered — only its `ExamplePair` type and `formatExamplePairsAsIntent` are consumed by `useDesignTabState`.
- **Root cause**: The design-input UI (mode toggle, wizard, example collector) was evidently moved/retired when the Design hub was rebuilt into sub-tabs, but the components were left behind. `PairItem.tsx` is additionally a verbatim copy of the pair markup ExamplePairCollector renders inline (lines 62-142) — an extraction that was never wired in.
- **Impact**: ~850 lines of maintained-looking but unreachable UI, including translation keys and a whole `wizardCompiler` (`compileWizardToAgentIR`) that will silently rot; `AnalyzeButton` even contains runtime-constructed Tailwind classes (`hover:from-${…}`) that would not compile, which future readers may copy.
- **Fix sketch**: Delete `PhasePanelHeader.tsx` and `PairItem.tsx` outright. If the wizard is intentionally shelved, delete `DesignWizard.tsx`, `WizardStepIndicator.tsx`, `WizardStepRenderer.tsx` and drop the `DesignWizard` barrel export (keep `wizardSteps`/`wizardCompiler` only if a product plan needs them; otherwise remove). Move `ExamplePair` + `formatExamplePairsAsIntent` into a small `examplePairs.ts` lib and delete the unrendered collector component. Verify no test files or Tauri-side references before deleting (grep covered `src/` only).

## 3. Seven props threaded through DesignTab → DesignTabPhaseContent → PhaseRenderProps are never used
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/agents/sub_design/components/PhaseContentRenderers.tsx:26-34
- **Scenario**: `PhaseRenderProps` declares `onInstructionChange`, `designContext`, `onDesignContextChange`, `inputMode`, `onInputModeChange`, `examplePairs`, `onExamplePairsChange`, yet `renderPhaseContent` references none of them. DesignTab.tsx dutifully wires all seven from `useDesignTabState`.
- **Root cause**: Leftover plumbing from the removed idle-phase input UI (see finding 2); since nothing can call `setInputMode`, the `intent`/`example` branches of `handleStartAnalysis` (useDesignTabState.ts:116-123) are unreachable from this UI as well.
- **Impact**: Misleading contract — readers assume the phase content supports mode switching and context editing; every render builds and passes state that cannot affect output, and `useDesignTabState` keeps `examplePairs`/`inputMode` state machinery alive for nothing.
- **Fix sketch**: Remove the seven fields from `PhaseRenderProps` and the corresponding props in DesignTab/DesignTabPhaseContent. Then either delete the `inputMode`/`examplePairs` state from `useDesignTabState` or (if example/intent input is meant to return) re-wire it deliberately in the idle phase.

## 4. Every single parameter commit triggers a full `fetchPersonas()` refetch
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: over-fetch
- **File**: src/features/agents/sub_design/components/parameterEditing.tsx:67
- **Scenario**: Releasing a slider, blurring a stepper, or toggling a boolean on the Parameters subtab commits via `updatePersonaParameters` and then awaits `fetchPersonas()` — re-fetching the entire persona list (with details) over IPC just to refresh one persona's `parameters` JSON string.
- **Root cause**: The hook has no targeted "refresh one persona" path, so it invalidates the whole store after each per-field write.
- **Impact**: Tuning 5 parameters = 5 full-list IPC round-trips plus store-wide updates that re-render every component subscribed to `personas`/`selectedPersona` (sidebar lists, editor chrome). Latency also delays the per-row "Saved" indicator.
- **Fix sketch**: Optimistically patch the selected persona in the agentStore (`setSelectedPersona({ ...selectedPersona, parameters: JSON.stringify(next) })` or a `patchPersona(id, fields)` store action) and drop the blanket `fetchPersonas()`; if a server-truth refresh is desired, fetch only that persona by id, or debounce a single list refresh after a burst of commits.

## 5. `useResultSelectionSync` computes an unused `resultId` and keys the effect on the object reference anyway
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: cleanup
- **File**: src/features/agents/sub_design/libs/designStateHelpers.ts:81-91
- **Scenario**: `resultId` (`${result.summary}-${result.suggested_tools.length}`) sits in the dependency array next to `result` itself; since any `result` reference change already re-runs the effect, the derived key adds nothing and never gates anything.
- **Root cause**: Looks like an attempt at value-identity keying that was left half-finished — the object reference dep supersedes it.
- **Impact**: Dead computation and a misleading hint that selection sync is value-keyed when it is actually reference-keyed; a future refactor trusting `resultId` semantics would be surprised.
- **Fix sketch**: Either delete `resultId` and depend on `result` alone, or finish the intent: depend on `resultId` only (with `result` read via ref) so re-emitting an identical result object doesn't clobber the user's manual selection tweaks.
