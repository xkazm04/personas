# Recipes & Pipelines — Dev Experience Scan

> Total: 13 · Critical: 1 · High: 5 · Medium: 5 · Low: 2
> Scope: client-side only
> Date: 2026-04-27

---

## 1. Zero test coverage across the entire feature

- **Severity**: Critical
- **Category**: testing
- **File**: `src/features/recipes/**`, `src/features/pipeline/**`, `src/api/pipeline/**`, `src/stores/slices/pipeline/**`
- **Scenario**: A developer touches `teamSlice.addTeamMember`'s optimistic-update path (lines 143–184), the `useRecipeTestRunner` run-id correlation guard (lines 27–37), `buildTeamGraph`'s Kahn cycle detection, or `computeMemoryDiff`. There is no automated way to verify behaviour beyond clicking through the app.
- **Root cause**: ~3,100 LOC across two complex domains (graph topology, optimistic CRUD, debounced auto-save with team-switch staleness guards, version history, dry-run engine, memory diffs) and not a single `*.test.ts(x)` file. Compare with `src/api/__tests__/triggers.test.ts` and `src/features/agents/components/matrix/__tests__/` which have rich coverage. The infrastructure is already wired (vitest), nobody wrote tests here.
- **Impact**: Subtle bugs already exist as defensive comments ("Without this guard, selectTeam would have cleared teamMembers to []…", "comparing against this so we don't scribble run #1's LLM output onto run #2's result"). Each change risks silent regressions; the only safety net is manual QA. Refactoring is high-friction — devs leave dead code and inline workarounds rather than restructure.
- **Fix sketch**: Bring the four highest-value pure modules under test first — they're already framework-free: `sub_canvas/libs/teamGraph.ts` (cycles, layers), `sub_teamMemory/libs/memoryDiff.ts`, `sub_canvas/libs/canvasActions.ts` (reducer), `shared/recipeParseUtils.ts` (parse round-trips). Then add slice tests modelled on `stores/__tests__/personaStore.test.ts` for the optimistic team-member/connection paths. Aim for 30–40 tests; ~1–2 days of work given the patterns are already established elsewhere.

---

## 2. `parseInputSchema` defined twice with conflicting return shapes

- **Severity**: High
- **Category**: convention-drift
- **File**: `src/features/recipes/shared/recipeParseUtils.ts:45` AND `src/features/recipes/sub_playground/tabs/recipeTestHelpers.ts:14`
- **Scenario**: Dev sees `parseInputSchema(recipe.input_schema)` in `RecipeOverviewTab.tsx` and `RecipeTestRunnerTab.tsx` and assumes both call the same function. They don't — `RecipeOverviewTab` imports from `shared/recipeParseUtils` (returns `InputSchemaField[]` with `key/type/label`), `RecipeTestRunnerTab` imports from `recipeTestHelpers` (returns `InputField[]` with `key/type/label/default/options`).
- **Root cause**: Two parallel "schema field" type chains: `InputSchemaField` (shared), `InputField` (test helpers), `SchemaField` (editor), `SchemaFieldParsed` (shared). Same JSON, four types.
- **Impact**: Editor saves a field with `default`, overview tab silently drops it (it's typed without `default`), test runner reads it. Adding `options` to one parser doesn't propagate. Devs must trace imports to know which variant they have.
- **Fix sketch**: Delete `recipeTestHelpers.parseInputSchema` and `parseMockValues`'s duplicate of `parseTags`-style logic. Promote `recipeParseUtils.SchemaFieldParsed` (with optional `default` and `options`) as the single source of truth. Make `RecipeEditor.parseTagsString`/`parseSchemaString` call `parseTags`/`parseSchemaFields`.

---

## 3. `RecipeEditor` reimplements `parseTags` / `parseSchemaFields` locally

- **Severity**: High
- **Category**: code-organization
- **File**: `src/features/recipes/sub_editor/components/RecipeEditor.tsx:20-44`
- **Scenario**: Dev fixes a bug in `recipeParseUtils.parseTags` (e.g. handle non-array JSON gracefully). The bug remains in `RecipeEditor` because `parseTagsString` is a private copy.
- **Root cause**: `parseTagsString` and `parseSchemaString` are byte-for-byte equivalents of the shared utils but with renamed exports and a slightly different `SchemaField` shape (drops the optional second `default` overload). Inverse pair `serializeTags`/`serializeSchema` lives only here — there's no shared serializer to round-trip.
- **Impact**: Round-trip bugs are guaranteed (parse with shared util, serialize with editor's local function — drift will accumulate). New devs grep for `parseTags`, find both, can't tell which is canonical.
- **Fix sketch**: Move `serializeTags`/`serializeSchema` into `shared/recipeParseUtils.ts` next to their parsers. Delete RecipeEditor's local copies. Add a single round-trip test covering parse → serialize → parse identity.

---

## 4. `CanvasOverlays` subscribes to 12 store slices individually — no `useShallow`

- **Severity**: High
- **Category**: dev-loop-friction
- **File**: `src/features/pipeline/components/canvas/CanvasOverlays.tsx:60-71` (and propagating across `TeamCanvas.tsx`, `useCanvasHandlers.ts`, `useCanvasPipelineActions.ts`)
- **Scenario**: A user drags a node on the canvas. Every keystroke in the unrelated team-memory search box triggers a re-render of `CanvasOverlays` and its entire subtree (NodeContextMenu, EdgeDeleteTooltip, OptimizerPanel, DryRunDebugger, TeamConfigPanel). The CLAUDE.md memory note explicitly recommends `useShallow` — it's used elsewhere in the codebase, but **zero usage in `features/pipeline` or `features/recipes`** (43 occurrences of `usePipelineStore((s) => s.X)` selectors instead).
- **Root cause**: When the slice was scaffolded, the team picked individual selectors per field. As the surface grew (12 selectors in `CanvasOverlays` alone), nobody refactored. With ReactFlow + a heavy node graph, this is a real perf foot-gun.
- **Impact**: Avoidable wasted renders; harder profiling sessions; new devs learn the wrong pattern by copy-pasting from these files. CanvasOverlays renders on *any* `pipelineStore` change.
- **Fix sketch**: For multi-field reads, switch to `usePipelineStore(useShallow((s) => ({ teamMemories: s.teamMemories, total: s.teamMemoriesTotal, … })))`. Add an ESLint rule (codebase has custom `eslint-rules/`) flagging >4 single-field selectors in one component as a hint to use `useShallow`.

---

## 5. Recipe API lives in `src/api/templates/recipes.ts`, not `src/api/pipeline/`

- **Severity**: High
- **Category**: convention-drift
- **File**: `src/api/templates/recipes.ts` (imported by `src/stores/slices/pipeline/recipeSlice.ts:7` and `src/features/recipes/**`)
- **Scenario**: Dev needs to add a recipe-related Tauri command. They look in `src/api/pipeline/` (the directory matching the slice's location), find `groups.ts`, `teams.ts`, `triggers.ts`, etc. — but no recipes file. They then notice the slice imports from `@/api/templates/recipes`, an unrelated subtree. Cognitive jolt every time.
- **Root cause**: Recipes are conceptually a "pipeline" sister-concept (the slice + UI + memory map confirms this), but the API module was originally placed under `templates`. Nobody moved it when the slice migrated to `slices/pipeline`.
- **Impact**: `recipeSlice` imports from `@/api/templates/recipes`, every other pipeline-domain slice imports from `@/api/pipeline/*`. Onboarding devs lose time tracing which module owns what. Renames across the recipe API have to remember to update the foreign path.
- **Fix sketch**: Move `src/api/templates/recipes.ts` → `src/api/pipeline/recipes.ts`. Run Find-References / `tsc --noEmit` to update imports. Same exercise for `src/hooks/design/template/useRecipeExecution.ts` and `useRecipeVersioning.ts` — they're recipe-specific but live under `hooks/design/template/` for historical reasons.

---

## 6. `teamSlice.ts` is 403 lines and mixes 4 unrelated concerns

- **Severity**: Medium
- **Category**: code-organization
- **File**: `src/stores/slices/pipeline/teamSlice.ts` (403 LOC)
- **Scenario**: Dev wants to change how team-member optimistic updates work. They open the slice and have to scroll past team CRUD, connections, memory pagination/filters, importance updates, batch deletes, and the run-id filter to find their function.
- **Root cause**: One slice owns: (a) team CRUD + counts, (b) team members + connections, (c) team memories + filters + stats, (d) memory edit/delete/bulk + run-id filtering. The "TeamMemory*" methods alone are ~9 actions and 5 state fields.
- **Impact**: Merge-conflict magnet (the 403-line file is high-traffic). Each concern's optimistic-update pattern is independently re-implemented; bugs in one path don't surface in tests of another. The `teamSlice` interface lists 26 actions, none grouped.
- **Fix sketch**: Split into `teamSlice.ts` (CRUD + members + connections, ~220 LOC), `teamMemorySlice.ts` (memories + filters + stats, ~180 LOC). Both compose into `PipelineStore` in `storeTypes.ts`. Mirrors the existing `MemorySlice` precedent in `slices/overview/`. Bonus: extract a `createOptimisticListAction` helper — there are now 5 near-identical optimistic insert/rollback pairs.

---

## 7. `parseManualReviews`-style optimistic patterns hand-rolled 5x in `teamSlice`

- **Severity**: Medium
- **Category**: code-organization
- **File**: `src/stores/slices/pipeline/teamSlice.ts:143-275, 331-372`
- **Scenario**: Add a 6th optimistic CRUD operation (e.g. `updateTeamMember`). Dev must reimplement: temp ID generation, prev-state capture, set-then-replace-on-success, set-then-rollback-on-error, plus the team-switch staleness guard.
- **Root cause**: `addTeamMember`, `removeTeamMember`, `createTeamConnection`, `deleteTeamConnection`, `updateTeamConnection`, `deleteTeamMemory`, `batchDeleteTeamMemories`, `updateTeamMemoryImportance`, `updateTeamMemory` each repeat this dance (with subtle variations — the staleness guard exists in some but not others).
- **Impact**: 9 places that *should* behave identically actually diverge. New ops cargo-cult the closest example and inevitably forget the staleness check (`updateTeamMemory` for instance has no staleness guard despite a network round-trip).
- **Fix sketch**: Extract `optimisticUpdate({ select, applyOptimistic, persist, reconcile, isStale })` helper. Each action becomes 6 lines instead of 25. Test the helper once, get the staleness guard for free everywhere.

---

## 8. Recipes have no view-state preservation when switching teams; pipeline canvas does

- **Severity**: Medium
- **Category**: convention-drift
- **File**: `src/features/recipes/hooks/useRecipeViewFSM.ts` vs `src/features/pipeline/sub_canvas/libs/canvasActions.ts:194-203` (`RESET_ON_TEAM_SWITCH`)
- **Scenario**: Dev expects recipe and pipeline UIs to behave consistently. Pipeline carefully resets its canvas state when a team is switched (`RESET_ON_TEAM_SWITCH` action, plus 3 staleness guards in `teamSlice` async paths). Recipe UI has no equivalent — the FSM `useRecipeViewFSM` doesn't react to `recipes` array shrinking or to `recipeId` no longer existing.
- **Root cause**: Sister concepts grew separately; team-canvas got the "concurrent-state" treatment, recipes did not.
- **Impact**: If `recipes` array changes underneath (e.g. another tab deletes a recipe), `editingRecipe` returns `null` from the hook (line 56-61) but the FSM remains in `view: 'edit'`. The `RecipeManager` then renders nothing for that branch (nothing matches `viewState.view === 'edit' && editingRecipe`). User sees a blank screen with no way to recover except clicking around.
- **Fix sketch**: In `useRecipeViewFSM`, add a `useEffect` that dispatches `GO_LIST` if `editingRecipe`/`playgroundRecipe` resolves to `null` while in those states. Or surface a "Recipe no longer exists" empty state. Document the pattern as the standard for any FSM tied to a list.

---

## 9. `triggerSlice`, `recipeSlice`, `groupSlice` re-fetch the entire list after every mutation

- **Severity**: Medium
- **Category**: dev-loop-friction
- **File**: `src/stores/slices/pipeline/recipeSlice.ts:40,52,63`, `groupSlice.ts:60-95` (partial), `triggerSlice` (no list state at all)
- **Scenario**: Dev creates a recipe; UI feels sluggish. The slice does `await createRecipe; await fetchRecipes()` — full round-trip even though the backend returned the new row.
- **Root cause**: `recipeSlice.createRecipe/updateRecipe/deleteRecipe` all `await get().fetchRecipes()` instead of optimistic insert/update. `teamSlice` *does* use proper optimistic patterns (item 7) — recipe slice was written without that template.
- **Impact**: Recipes list flashes empty during refetch. Two unnecessary IPC round-trips per mutation. Inconsistent with team/connection/memory paths in the same store.
- **Fix sketch**: Apply the optimistic helper from item 7. `createRecipe` returns the row; insert it into `recipes` immediately. Same for `updateRecipe` (replace by id) and `deleteRecipe` (filter by id). Drop the `await get().fetchRecipes()` calls.

---

## 10. `src/api/pipeline/workflows.ts` is dead code

- **Severity**: Low
- **Category**: code-organization
- **File**: `src/api/pipeline/workflows.ts`
- **Scenario**: Dev exploring the pipeline API surface assumes `getWorkflowsOverview` is meaningful. Grep shows zero callers in client-side code.
- **Root cause**: 3 exported functions, no consumers. Probably orphaned after a feature was removed.
- **Impact**: 16 LOC of false signal. Bundle bloat is negligible; mental load isn't.
- **Fix sketch**: Either delete `src/api/pipeline/workflows.ts` and the matching `WorkflowsOverview` binding, or document why it's preserved (e.g. "kept for upcoming feature X"). `git log` will show the original intent.

---

## 11. RecipeCard / TeamCard are visually parallel but share zero code

- **Severity**: Medium
- **Category**: code-organization
- **File**: `src/features/recipes/sub_list/components/RecipeCard.tsx:57-166` and `src/features/pipeline/components/TeamCard.tsx:18-136`
- **Scenario**: Designer asks for a shared "card hover state" tweak, or product asks for a consistent delete-confirmation UX across the two domains. Dev edits both files.
- **Root cause**: Both render a clickable card with: icon + color accent, name + description, action buttons revealed on hover, delete-confirmation flow with a 3–5s auto-revert timer. Both reimplement the auto-revert (`RecipeCard.tsx:63-68` vs `TeamList.tsx:39-44`). Confirm UI lives inline in `RecipeCard`, but is hoisted to `TeamList` for `TeamCard`. The hover-reveal opacity classes and rounded-modal styles diverge slightly.
- **Impact**: Cross-domain UX consistency relies on developer discipline. Auto-revert timers are duplicated 3 times in this scope (RecipeCard, TeamList, TeamConfigPanel). Bug fixes don't propagate.
- **Fix sketch**: Extract `<EntityCard>` (icon, name, description, onSelect, actions slot) and `<DeleteConfirmInline timeout={5000} onConfirm onCancel>` to `features/shared/components/`. Both Recipe and Team card become 30-line composition wrappers. Codify the 3-second delete-confirm timeout as a constant.

---

## 12. No JSDoc / module-level docs for the canvas data flow

- **Severity**: Low
- **Category**: documentation
- **File**: `src/features/pipeline/components/canvas/useCanvasHandlers.ts`, `useCanvasPipelineActions.ts`, `useCanvasDragDrop.ts`, `sub_canvas/libs/useCanvasReducer.ts`, `useDerivedCanvasState.ts`
- **Scenario**: New dev opens `TeamCanvas.tsx`. Six hooks compose a reducer, four `useEffect` listeners, ReactFlow node/edge state, ghost nodes, alignment lines, dry-run state. No diagram. No README. Each hook's relationship to the others has to be reverse-engineered.
- **Root cause**: The team did good work splitting the canvas into focused files (item 4 of `useDerivedCanvasState.ts`'s comment shows great refactoring discipline), but the *system view* lives only in heads.
- **Impact**: Onboarding dev needs ~half a day to internalise the data-flow. Refactors stall on "wait, who owns the React Flow `nodes` array vs. `cs.stickyNotes` vs. `derived.nodes`?" — the answer is non-obvious.
- **Fix sketch**: Add a `src/features/pipeline/sub_canvas/README.md` with a top-down sketch: Source data (store) → `useDerivedCanvasState` (derive) → React Flow `useNodesState` (positions persist locally) → `useEffect` merges → render. Note the autosave team-switch guard (it's a real-world fix worth documenting). 1 page, ~30 mins.

---

## 13. Hard-coded `'sequential' | 'parallel' | 'feedback' | 'conditional'` and roles as raw strings

- **Severity**: Medium
- **Category**: convention-drift
- **File**: Throughout `src/features/pipeline/**` (14 files for connection types, 7 for roles); type definitions in `sub_canvas/libs/teamConstants.tsx:13-29`
- **Scenario**: Dev adds a new connection type `'broadcast'`. Compiler doesn't help — every use site (`useDerivedCanvasState`, `useDebugger`, `MiniCanvas`, optimizer logic, `getConnectionStyle`) accepts `string`. Dev manually hunts down switch statements.
- **Root cause**: `CONNECTION_TYPE_STYLES` is `Record<string, …>` and `TEAM_ROLES` is exported as the array, but neither produces an exported union type. Functions take `connection_type: string`, `role: string` — including action types in `canvasReducer` (`UPDATE_SELECTED_MEMBER_ROLE` accepts any string).
- **Impact**: Stringly-typed APIs throughout a graph engine. Typo `'feeback'` only fails at runtime when the styling lookup falls back to `DEFAULT_CONNECTION_STYLE`. Adding a type means hunting through 14 files.
- **Fix sketch**: `export type ConnectionType = keyof typeof CONNECTION_TYPE_STYLES` and `export type TeamRole = (typeof TEAM_ROLES)[number]['value']`. Update function signatures in `useDerivedCanvasState`, `useDebugger`, `getConnectionStyle`, reducer actions, `pipelineTemplateTypes`. Compiler becomes the safety net for new variants.
