# hooks/design [2/2] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 5 findings (0 critical / 0 high / 3 medium / 2 low)
> Context group: Core Libraries & State | Files read: 10 | Missing: 0

## 1. `useAiArtifactFlow` hook is dead code and the file's live helpers are structurally inverted
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/hooks/design/template/useAiArtifactFlow.ts:40
- **Scenario**: A repo-wide grep shows `useAiArtifactFlow()` is never called anywhere in `src/` — the only references are its definition, the barrel re-export in `src/hooks/index.ts:34`, and a doc-comment mention. Meanwhile `defaultGetLine` and `buildResolveStatus` from this file ARE live, imported by `src/hooks/design/core/useAiArtifactTask.ts:3` — a `core/` module importing from `template/`.
- **Root cause**: `useAiArtifactTask` superseded `useAiArtifactFlow` (its own doc comment at useAiArtifactTask.ts:12 says as much: "Unlike `useAiArtifactFlow`, this absorbs..."), but the old hook was never deleted; only its helper functions remained in use.
- **Impact**: ~60 lines of dead abstraction that new contributors will read and consider a valid extension point (the doc even points to `useCredentialDesign` / `useCredentialNegotiator` as "examples", which no longer use it). The core→template import direction misplaces shared plumbing under a domain folder.
- **Fix sketch**: Move `defaultGetLine` and `buildResolveStatus` into `src/hooks/design/core/useAiArtifactTask.ts` (or a small `core/streamHelpers.ts`), delete `useAiArtifactFlow.ts`, and remove the barrel line from `src/hooks/index.ts`. Verification needed only for barrel consumers importing `AiArtifactFlowConfig`/`defaultGetLine` via `@/hooks` — grep shows none.

## 2. `useRecipeGenerator` is never invoked — its only consumer (`RecipeCreateFlow`) is itself an unrendered component
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/hooks/design/template/useRecipeGenerator.ts:13
- **Scenario**: Repo-wide grep finds no call site of `useRecipeGenerator()`. The single non-barrel reference is a type-only import in `src/features/vault/shared/playground/tabs/RecipeCreateFlow.tsx:8` (`generator: ReturnType<typeof useRecipeGenerator>`), and `RecipeCreateFlow` is never imported or rendered by any other file.
- **Root cause**: The recipe-creation flow appears to have been rebuilt (live recipes UI is `features/recipes/sub_playground/*`, which uses `useRecipeExecution`/`useRecipeVersioning`), leaving the vault-side create flow and its hook orphaned.
- **Impact**: A dead hook plus a dead component chain (`RecipeCreateFlow.tsx` and whatever it renders) that keeps the `start_recipe_generation` frontend wiring looking active; misleads readers auditing the recipe pipeline.
- **Fix sketch**: Confirm `RecipeCreateFlow` has no dynamic/lazy import (none found), then delete `useRecipeGenerator.ts`, `RecipeCreateFlow.tsx`, and the barrel export at `src/hooks/index.ts:33`. If the Rust `start_recipe_generation` command then has no frontend caller, flag it for the Rust-side dead-code list rather than deleting cross-context.

## 3. `useRecipeGenerator` traces under the wrong operation name (`recipe_execution`)
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: copy-paste
- **File**: src/hooks/design/template/useRecipeGenerator.ts:22
- **Scenario**: When a recipe generation runs (currently dead, see finding 2, but the bug survives any revival), its system-trace spans are recorded as `recipe_execution`, indistinguishable from actual executions in the trace timeline.
- **Root cause**: Copy-paste from `useRecipeExecution.ts`; `SystemOperationType` in `src/lib/execution/pipeline.ts` only defines `recipe_execution` and `recipe_versioning`, so there was no `recipe_generation` value to use.
- **Impact**: Trace/observability data conflates two distinct operations; anyone measuring execution latency from traces gets polluted samples.
- **Fix sketch**: If the hook survives finding 2, add `'recipe_generation'` to the `SystemOperationType` union in pipeline.ts and use it here. If the hook is deleted, this goes with it.

## 4. Unmemoized default `resolveStatus` in `useAiArtifactTask` destabilizes `start`/`cancel` for every AI-task hook on every render
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/hooks/design/core/useAiArtifactTask.ts:113
- **Scenario**: `baseResolveStatus = userResolveStatus ?? buildResolveStatus<TResult>(errorMessage)` constructs a brand-new closure on every render whenever the caller doesn't pass a custom `resolveStatus` — which is every consumer in this context (`useAutomationDesign`, `useRecipeExecution`, `useRecipeVersioning`, `useRecipeGenerator`). That feeds `tracedResolveStatus`'s `useCallback` deps, which feeds `useTauriStream`'s `start` deps (useTauriStream.ts:164), so `start` and `cancel` get new identities on every render of the owning component.
- **Root cause**: The default is computed inline in the render body instead of being memoized; every downstream `useCallback`/`useMemo` keyed on it invalidates.
- **Impact**: The `useMemo` wrappers in `useRecipeExecution.ts:30` and `useRecipeVersioning.ts:25` are fully defeated (their deps include `task.start`, which changes each render), so those hooks return a fresh object each render anyway; any consumer `useEffect` depending on `start`/`cancel`/`reset` re-runs on every parent render. These hooks back streaming design panels that re-render on every streamed line (up to 500 buffered lines), so the churn happens on a hot path. No leak — listeners are registered only inside `start` — but memoization across the whole AI-task hook family is currently a no-op.
- **Fix sketch**: `const baseResolveStatus = useMemo(() => userResolveStatus ?? buildResolveStatus<TResult>(errorMessage), [userResolveStatus, errorMessage]);`. Config functions (`startFn`, `cancelFn`) are module-level API imports at all call sites, so this one change stabilizes `start`/`cancel` and makes the existing consumer `useMemo`s effective.

## 5. `useAutomationDesign` returns a fresh unmemoized object each render, unlike its sibling hooks
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/hooks/design/core/useAutomationDesign.ts:37
- **Scenario**: Every render of `useAutomationSetup` (features/agents/sub_connectors) gets a new object identity from `useAutomationDesign`, so anything depending on the hook result as a whole (memo deps, context values, props to memoized children) re-evaluates each render.
- **Root cause**: `useRecipeExecution`/`useRecipeVersioning` wrap their return in `useMemo`; `useAutomationDesign` builds the object literal inline. (Today the memo would be ineffective anyway per finding 4 — this is the follow-on once that is fixed.)
- **Impact**: Bounded — one consumer, and streaming renders dominate — but it silently negates memoization attempts downstream and diverges from the established pattern in this hook family.
- **Fix sketch**: After landing finding 4, wrap the return in `useMemo` keyed on `[task.phase, task.lines, task.result, task.error, task.start, task.cancel, task.reset, task.setResult, task.setPhase, task.setError]`, matching the recipe hooks.
