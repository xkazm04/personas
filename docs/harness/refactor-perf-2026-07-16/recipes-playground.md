# recipes/playground — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 5 findings (1 critical / 1 high / 2 medium / 1 low)
> Context group: Templates & Recipes | Files read: 9 | Missing: 0

## 1. Infinite setState loop in useRecipeTestRunner merge effect after LLM completion
- **Severity**: Critical
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/recipes/sub_playground/libs/useRecipeTestRunner.ts:27
- **Scenario**: Run any recipe test to completion. When `execution.phase === 'done'`, the effect merges `execution.output` into `result` via `setResult(updated)` where `updated` is a fresh object. `result` is in the effect's dependency array, so the state change re-fires the effect; the guard condition (`phase === 'done' && output && result && resultRunIdRef === runCountRef`) is still true, so it merges again with another fresh object — forever. React throws "Maximum update depth exceeded" and the playground breaks on its hottest path (every successful test run).
- **Root cause**: The effect never marks the merge as done. Nothing invalidates the condition after the first merge: phase stays 'done', output is unchanged, and the run-id refs still match, while `result` identity changes on every pass.
- **Impact**: User-visible crash/error after every completed LLM execution in the test runner; before React aborts, `setHistory` also re-executes its "remove preliminary entry, prepend updated" shuffle on each pass.
- **Fix sketch**: Add an idempotency guard: early-return when `result.llm_output === execution.output` (or track a `mergedRunIdRef` set to the run id after merging and require `mergedRunIdRef.current !== runCountRef.current` before merging). Alternatively drop `result` from deps and read it via a ref, keying the effect on `execution.phase`/`execution.output` only.

## 2. RecipeVersionsTab cleanup effect resets the active versioning stream on every progress line
- **Severity**: High
- **Lens**: perf-optimizer
- **Category**: unstable-effect-dep
- **File**: src/features/recipes/sub_playground/tabs/RecipeVersionsTab.tsx:55
- **Scenario**: `useEffect(() => () => versioning.reset(), [recipe.id, versioning])` is meant to reset on unmount/recipe change. But `useRecipeVersioning` returns a `useMemo` object whose deps include `task.phase` and `task.lines` (useRecipeVersioning.ts:25-33), so `versioning` gets a new identity on every phase transition and every streamed progress line. Each identity change fires the cleanup, calling `reset()` — which (useTauriStream.ts:175-182) bumps the stream generation, unsubscribes listeners, sets phase back to 'idle', and clears lines/result.
- **Root cause**: An intentionally unstable memoized object (recomputed per state change so consumers re-render) is used as an effect dependency where only its stable `reset` function was needed.
- **Impact**: The first state change after `versioning.start()` (idle → 'versioning') triggers a self-reset, tearing down the event subscription and orphaning the in-flight generation; at best the Versions tab churns subscribe/unsubscribe on every line, at worst "Generate new version" never shows progress or a draft.
- **Fix sketch**: Depend on the stable function instead of the object: `useEffect(() => () => versioning.reset(), [recipe.id, versioning.reset])` (task.reset = stream.reset is a stable useCallback), or capture `reset` in a ref and key the effect on `[recipe.id]` alone.

## 3. RecipeHistoryTab inlines a duplicate of formatOutputForMarkdown, re-parsing JSON every render
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/recipes/sub_playground/tabs/RecipeHistoryTab.tsx:79
- **Scenario**: The history entry's execution-result block contains an IIFE that trims the output, detects `{...}`/`[...]`, and pretty-prints via `JSON.parse` + `JSON.stringify` inside a try/silentCatch — logic byte-for-byte equivalent to `formatOutputForMarkdown` in `recipeTestHelpers.ts:35-44`, which lives in the same folder and is already used by RecipeOutputSection.
- **Root cause**: Copy-paste instead of importing the existing helper.
- **Impact**: Two copies of the same formatting rule will drift (they already have separate silentCatch tags), and the inline IIFE re-runs JSON.parse/stringify on potentially large LLM outputs for up to 20 history entries on every render of the tab (each keystroke-free re-render of the modal included).
- **Fix sketch**: Replace the IIFE with `<MarkdownRenderer content={formatOutputForMarkdown(run.llm_output)} />` importing from `./recipeTestHelpers`. If render cost on large histories matters, extract the entry into a small memoized `HistoryEntry` component so formatting runs once per entry.

## 4. parseInputSchema duplicated between recipeTestHelpers and recipes/shared/recipeParseUtils
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/recipes/sub_playground/tabs/recipeTestHelpers.ts:15
- **Scenario**: `parseInputSchema` in recipeTestHelpers.ts:15-23 is line-for-line identical to `parseInputSchema` in src/features/recipes/shared/recipeParseUtils.ts:45-53. Within this very context the two are mixed: RecipeOverviewTab imports the shared one, RecipeTestRunnerTab imports the local one — so the Overview and Test Runner tabs parse the same `recipe.input_schema` through two separate implementations.
- **Root cause**: A shared recipe-parsing module exists but the playground grew its own copy (with a slightly richer `InputField` type adding `default`/`options`).
- **Impact**: Any schema-parsing fix (validation, field coercion) must be applied twice or the tabs diverge on what fields they show; the near-identical `InputField` vs `InputSchemaField` types add confusion.
- **Fix sketch**: Extend `recipeParseUtils.InputSchemaField` with the optional `default`/`options` members (or reuse `SchemaFieldParsed`), delete `parseInputSchema` from recipeTestHelpers, and re-point RecipeTestRunnerTab/RecipeInputSection imports at the shared module. `parseMockValues` and `formatOutputForMarkdown` can stay local (playground-specific).

## 5. Commented-out heading token left in RecipeVersionsTab
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: cleanup
- **File**: src/features/recipes/sub_playground/tabs/RecipeVersionsTab.tsx:226
- **Scenario**: `{/* {t.recipes.version_history} */}` sits directly above the section that actually renders `t.recipes.version_history` two lines later — a leftover from moving the heading.
- **Root cause**: Dead JSX comment not removed after refactor.
- **Impact**: Noise only; misleads readers into thinking something was disabled there.
- **Fix sketch**: Delete the comment line (or replace with a plain `{/* Version History */}` section label if a marker is wanted).
