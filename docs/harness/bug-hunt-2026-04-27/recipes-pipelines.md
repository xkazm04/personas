# Bug Hunt — Recipes & Pipelines

> Total: 14 | Critical: 2 | High: 6 | Medium: 5 | Low: 1

## 1. Auto-team apply crashes when first member fails to insert

- **Severity**: critical
- **Category**: silent-failure
- **File**: `src/features/pipeline/components/useAutoTeam.ts:113-122`
- **Scenario**: User clicks "Create team" in `AutoTeamModal`. `addTeamMember` resolves to `null` (the store action returns `null` on caught backend errors — see `teamSlice.ts:171`). The loop does `newMemberIds.push(added.id)` without a nullcheck, so accessing `.id` on `null` throws `TypeError: Cannot read properties of null`.
- **Root cause**: The store API contract returns `PersonaTeamMember | null`, but `useAutoTeam.apply` assumes a non-null result. The error is swallowed by the outer `try/catch` and surfaced as a generic "Failed to create team" — but by that point a half-built team exists in the database with a partial member set and no connections, plus the user just sees a generic error message.
- **Impact**: Orphaned half-created team rows (team + 0..N-1 members + 0 connections + 0 seeded memories), no user-facing recovery (no "delete partial team" cleanup). Repeated retries multiply orphaned teams.
- **Fix sketch**: Check `if (!added) throw new Error('Failed to add member')`, and on catch, call `deleteTeam(team.id)` to roll back the partial team.

## 2. RecipeTestRunner overwrites results when multiple recipes execute concurrently via shared `useRecipeExecution`

- **Severity**: critical
- **Category**: race-condition
- **File**: `src/features/recipes/sub_playground/libs/useRecipeTestRunner.ts:17-26`
- **Scenario**: User starts a recipe execution in the playground (run #1, takes 30s). Before it completes, they switch to a different recipe in the version tab via `setCurrentRecipe`, which re-instantiates `useRecipeTestRunner(currentRecipe)` with new state. The async `execution.start` from run #1 still completes; its `phase === 'done'` triggers the `useEffect` against the NEW hook instance whose `result` is `null`. The merged `{ ...result, llm_output: execution.output }` short-circuits because `result` is null — but if a new run is started before the previous one completes, `runCountRef` only protects the API call, not the `useEffect`. The effect mutates the NEW result with the OLD execution's output, conflating runs.
- **Root cause**: `useEffect` watches `execution.phase`/`execution.output` but has no run-id correlation. Stale closures over `result` mean a late-arriving completion can scribble onto the wrong run's data.
- **Impact**: User sees output from a previous run attributed to a new run; history entries become corrupted (wrong llm_output paired with wrong rendered_prompt).
- **Fix sketch**: Track `runId` in `execution` state and gate the merge effect by matching ids; reset `runCountRef` in the effect's cleanup when phase changes.

## 3. Optimistic team-member add/connection drops the real backend record on team switch

- **Severity**: high
- **Category**: race-condition
- **File**: `src/stores/slices/pipeline/teamSlice.ts:143-173, 198-227`
- **Scenario**: User adds a member (optimistic temp inserted), then immediately switches teams. `selectTeam` clears `teamMembers: []`. The pending `addTeamMember` API call resolves: `set((state) => ({ teamMembers: state.teamMembers.map(...) }))` — the temp is gone, so map produces `[]`. The real member exists in the DB but is invisible until `fetchTeamDetails` runs. If the user then switches BACK to the original team, `fetchTeamDetails` may race; meanwhile the member is created in the DB without any UI confirmation.
- **Root cause**: No staleness guard tying optimistic ops to `selectedTeamId`. The reconcile `set` updates `state.teamMembers` even when those members no longer belong to the visible team.
- **Impact**: User's added member appears to vanish (silent UX failure). Worse, if they re-add the same persona, two duplicate members exist in the DB.
- **Fix sketch**: Capture `teamId` at op start, then `if (get().selectedTeamId !== teamId) return;` before the reconcile set.

## 4. `recordTriggerComplete` makes throttling sticky forever

- **Severity**: high
- **Category**: latent-failure
- **File**: `src/stores/slices/pipeline/triggerSlice.ts:150-161`
- **Scenario**: A trigger gets throttled (`isThrottled: true`). When it eventually completes, `recordTriggerComplete` sets `entry.isThrottled = entry.queueDepth > 0 || prev.isThrottled`. Because `prev` was captured BEFORE the immer set ran and originally had `isThrottled: true`, the OR keeps it `true` even when queue is empty. Subsequent completions all see `prev.isThrottled === true` (read fresh from store via `get()`), so the trigger remains throttled forever in the UI summary.
- **Root cause**: Boolean OR with prior state plus reading from `get()` immediately before mutating creates a self-perpetuating sticky `true`. The condition should derive `isThrottled` from current rate-limit math, not OR with stale flags.
- **Impact**: `getRateLimitSummary` reports throttled triggers indefinitely; UI may show throttle warnings even after the cooldown elapses; users have no way to clear it without page refresh.
- **Fix sketch**: `entry.isThrottled = entry.queueDepth > 0` (drop the OR), or recompute against `cooldownUntil`/`firingTimestamps` window.

## 5. `useRecipeViewFSM` strands the user when the edited recipe is deleted from another tab

- **Severity**: high
- **Category**: edge-case
- **File**: `src/features/recipes/hooks/useRecipeViewFSM.ts:56-68` and `src/features/recipes/sub_manager/components/RecipeManager.tsx:136-147`
- **Scenario**: User opens recipe X for editing (`view: 'edit', recipeId: X`). In another tab (or via background fetch refresh), the recipe is deleted; `recipes` array no longer contains X. `editingRecipe` becomes `null`, so the conditional `{viewState.view === 'edit' && editingRecipe && ...}` renders nothing. The FSM remains stuck in `edit` state with no UI to escape — the toolbar with the Back button is INSIDE `RecipeEditor`, which never renders. Header `actions` only renders for `list` view. User must hard-reload.
- **Root cause**: View FSM and data are decoupled: the FSM trusts that `recipeId` resolves, but data fetches/deletes can render the lookup empty.
- **Impact**: Dead-end UI requiring app reload; same applies to `playground` view.
- **Fix sketch**: When `editingRecipe`/`playgroundRecipe` is null inside `edit`/`playground` state, auto-dispatch `GO_LIST` and toast "Recipe no longer exists".

## 6. RecipeEditor "saving" guard does not prevent stale-recipe save after delete

- **Severity**: high
- **Category**: state-corruption
- **File**: `src/features/recipes/sub_editor/components/RecipeEditor.tsx:79-114`
- **Scenario**: User edits recipe X. Recipe X is deleted in backend. User clicks Save. `updateRecipe(recipe.id, payload)` fires against a non-existent ID. Backend may either error (toast "Failed to save recipe" — user loses 5 minutes of edits), or worse, may treat update of non-existent row as no-op silently with success returned.
- **Root cause**: No precondition check that the recipe still exists; no draft-recovery UX when save fails.
- **Impact**: Silent data loss of unsaved edits (toast only says "Failed to save"); user has no way to rescue their work.
- **Fix sketch**: On save failure, retain the form state and surface a "Save as new" / "Copy to clipboard" recovery action; expose the actual error message in the toast.

## 7. TeamMemoryPanel resize listener captures stale `panelWidth` via `localStorage` write

- **Severity**: medium
- **Category**: cleanup-gap
- **File**: `src/features/pipeline/sub_teamMemory/components/panel/TeamMemoryPanel.tsx:63-83`
- **Scenario**: The mousemove/mouseup listeners are attached once on mount with `[]` deps, so they hold the closure's initial `widthRef`. While `widthRef` is updated by the separate effect, the writeback `localStorage.setItem(STORAGE_KEY, String(widthRef.current))` is fine. However the listeners are attached EVEN WHEN `draggingRef.current` is false, so any mouseup anywhere will run the storage write logic — it short-circuits, but every panel mount adds global window listeners that persist for the panel lifetime. If multiple `TeamMemoryPanel` instances exist (unlikely but possible during HMR / strict-mode double-mount), each adds its own listeners.
- **Root cause**: Always-on global event listeners; no `pointerdown`-scoped attach/detach.
- **Impact**: Minor — extra event handlers per HMR refresh; under React 19 strict mode double-invocation, side effects compound. Not catastrophic but a code smell.
- **Fix sketch**: Attach mousemove/mouseup only on the resize-handle `onMouseDown` and detach on `mouseup`; or use `pointer events` with capture.

## 8. Auto-save in `useCanvasHandlers` fires after team switch, persisting positions to wrong team

- **Severity**: high
- **Category**: race-condition
- **File**: `src/features/pipeline/components/canvas/useCanvasHandlers.ts:117-128, 107-114`
- **Scenario**: User drags nodes on team A; the 1500ms debounce starts. Before the timer fires, user clicks back and selects team B. `nodes` prop updates to team B's nodes via `setNodes`. The pending `setTimeout` invokes `saveRef.current()` which does `nodes.filter(...).map((n) => updateTeamMember(n.id, ...n.position.x, n.position.y))`. The `selectedTeamId` check inside `handleSave` only verifies a team is selected (B), not that it matches the team whose nodes were dragged. Thus team B's persistence call may include team-A node IDs that no longer belong to it, OR positions get persisted under team B even if the IDs are still A's (depending on backend tolerance).
- **Root cause**: The `nodes` array is read via stale closure at timer fire time and is checked only against "any team selected" instead of "same team as when drag occurred".
- **Impact**: Silent data corruption — a member's `position_x`/`position_y` may get overwritten with a position the user never set on that team; or `update_team_member` returns a 404 silently.
- **Fix sketch**: Capture `selectedTeamId` at debounce-start and abort save inside the timer if it changed; also clear `autoSaveTimer` in `selectTeam`.

## 9. Pipeline status listener races with team switch — wrong team's status displayed

- **Severity**: medium
- **Category**: race-condition
- **File**: `src/features/pipeline/components/canvas/useCanvasPipelineActions.ts:48-73`
- **Scenario**: The `listen<PipelineStatus>` is attached in a `useEffect` with `[selectedTeamId, ...]` deps. On team switch, the cleanup sets `cancelled = true` and calls `unlistenFn?.()`. BUT: `listen()` returns a Promise; if it hasn't resolved yet when cleanup runs, `unlistenFn` is null, the promise resolves, sees `cancelled`, and calls `fn()` — good. However the new effect with team B may attach a listener that ALSO receives a backend event with `team_id === A` (no filter at backend, only at UI). The check `event.payload.team_id === selectedTeamId` uses the closed-over `selectedTeamId` at attach time — but when team A → B switch happens, the OLD listener is properly torn down, so this is safer than it looks. However: a user who switches from A → B → A in rapid succession will have two pending listen() promises; the first's `unlistenFn` is captured before the second mounts. Both promises eventually resolve and both leak listeners until route unmount.
- **Root cause**: `listen()` returns a Promise but multiple invocations stack; the cancellation flag prevents storing the new fn, but the registered Tauri listener is still active — `cancelled = true` does not cancel `listen()` itself, only prevents the `then` from storing the unlisten.
- **Impact**: Listener leak under rapid team switches; in practice every switch leaks one listener if it happens before `listen()` resolves (typically <50ms but non-zero on cold load).
- **Fix sketch**: `listen()` resolution should always store the fn (e.g. `let fn = await listen(...)` then `if (cancelled) fn();`) — current code does this, BUT the wrapper returns synchronously not at await; current `.then` pattern is correct. Still, the LISTENER ITSELF runs from the moment the backend registers it; if it fires between resolve and cancel-check, the handler runs against the wrong team. Fix by also short-circuiting handler if `event.payload.team_id !== selectedTeamId` AT EVENT TIME (already does this — actually OK). Verify by also adding a cleanup-time `pipelineRunning: false` reset to prevent stale spinner.

## 10. `useDebugger` `onStateChange` infinite-loop risk via parent dispatching state into reducer that re-renders parent

- **Severity**: medium
- **Category**: timing-bug
- **File**: `src/features/pipeline/sub_canvas/libs/useDebugger.ts:51-53` + `useCanvasPipelineActions.ts:135-137`
- **Scenario**: The effect calls `onStateChange(...)` on every change to `breakpoints | nodeData | currentNodeId | completedEdges | activeEdge | executionOrder | stepIndex | paused | onStateChange`. Parent (`handleDryRunStateChange`) dispatches `SET_DRY_RUN_STATE`, which causes the canvas to re-render → which may pass a new `onStateChange` reference (it's wrapped in `useCallback` with `[dispatch]` so should be stable). If `dispatch` from `useReducer` is ever recreated (it is not in React, but a refactor could break this), this becomes an infinite render loop. Also: the effect synchronously fires during initial mount and EVERY subsequent render, posting a new object to parent reducer every step — even when nothing actually changed at the parent's level (e.g., re-creating `nodeData` Map identity on every step).
- **Root cause**: Pushing entire reducer state up via callback couples two reducers tightly; any reference instability in `onStateChange` breaks the loop guard.
- **Impact**: Performance — multiple unnecessary re-renders per debug step; latent infinite loop hazard.
- **Fix sketch**: Use a ref-based subscription model, or only push minimal deltas; memoize the state object via `useMemo` keyed on actual primitive values.

## 11. `parseInputSchema` shallow-trusts JSON: array-of-non-objects crashes downstream renderers

- **Severity**: medium
- **Category**: validation-gap
- **File**: `src/features/recipes/sub_playground/tabs/recipeTestHelpers.ts:14-22` and `src/features/recipes/sub_playground/tabs/RecipeInputSection.tsx:114-155`
- **Scenario**: `recipe.input_schema` is `'[1, 2, 3]'`. `parseInputSchema` returns `{ fields: [1,2,3] as any[], parseError: null }`. `RecipeInputSection` then iterates `fields.map(field => <div key={field.key}>{field.label || field.key}...`)` — `field.key` is undefined, React warns about missing keys, `field.options` is undefined causing select branch crash if `field.type === 'select'`.
- **Root cause**: Type coercion to `InputField[]` without validating each element shape (compare to `recipeParseUtils.parseSchemaFields` which DOES `String(f.key ?? '')` defensively — the playground helper does not).
- **Impact**: Recipe with malformed schema crashes the playground tab silently (white screen inside the tab), no user-facing error indicating "fix your schema".
- **Fix sketch**: Mirror `recipeParseUtils.parseSchemaFields` defensive coercion, OR validate via a schema check (zod) and surface validation errors in `SchemaParseErrorBanner`.

## 12. `RecipeList.handleQuickTest` uses stale `recipes.find` if recipes refetch mid-test

- **Severity**: low
- **Category**: edge-case
- **File**: `src/features/recipes/sub_list/components/RecipeList.tsx:27-48`
- **Scenario**: User clicks Quick Test on recipe X (sample_inputs is JSON-parsed). Concurrently, the recipe is deleted (e.g., from another tab) and `recipes` updates to remove it. The closure captured `recipes` at callback creation time, but `useCallback` deps include `[recipes]` — so the closure is fresh per render. If the user clicked DURING the fetch refresh, the in-flight `executeRecipe` call with `recipe_id: X` succeeds against backend (pre-delete) or fails (post-delete). On success, `setQuickTestResults((prev) => ({ ...prev, [id]: result }))` writes a result keyed by a now-deleted recipe — orphan in state forever (no cleanup since the corresponding `RecipeCard` is gone, no unmount cleanup).
- **Root cause**: No tie between transient quickTestResults state and the recipes array that owns the keys; result entries leak when their parent is removed.
- **Impact**: Memory leak (small) plus future sessions could see stale entries if `quickTestResults` ever serializes.
- **Fix sketch**: Prune `quickTestResults`/`quickTestLoading` when their key is no longer present in `recipes`.

## 13. AutoTeam `cancelledRef.current = false` is reset by `suggest`/`apply` — Reset during operation cannot abort the in-flight chain

- **Severity**: medium
- **Category**: cleanup-gap
- **File**: `src/features/pipeline/components/useAutoTeam.ts:50-66, 83-107, 203-213`
- **Scenario**: User clicks "Generate" → `suggest()` sets `cancelledRef.current = false`, awaits topology LLM. User immediately clicks the modal Close (X) → `AutoTeamModal.useEffect` calls `at.reset()` → `cancelledRef.current = true`. Good. BUT: in `apply()` (lines 85-87), the FIRST line resets `cancelledRef.current = false` before any await. If the user clicks Apply, then Cancel: `apply` set ref to false, started `createTeam`, user `reset` set ref to true; check on line 107 catches it. However if user clicks Apply, the modal closes via `handleDone` which also calls `reset()` — the cancel happens AFTER apply set the ref false. The team creation continues, members are added, BUT the `setTimeout(() => selectTeam(team.id), 600)` fires after the modal is gone, navigating the user against their will to a team they cancelled.
- **Root cause**: `apply()` shouldn't reset the cancel flag mid-flow; reset belongs only at user-initiated start.
- **Impact**: User cancels an auto-team build but still gets navigated into the half-done team after 600ms; confusing UX.
- **Fix sketch**: Don't reset `cancelledRef` inside `apply`; let `suggest` reset it. Always check `cancelledRef.current` immediately before `selectTeam`.

## 14. `buildTimeline` reverses array but `manualIdx` walk relies on chronological order — if memories share `created_at` to the millisecond, ordering is non-deterministic

- **Severity**: low
- **Category**: edge-case
- **File**: `src/features/pipeline/sub_teamMemory/components/timeline/MemoryTimeline.tsx:15-65`
- **Scenario**: A pipeline run creates 5 memories within the same millisecond. `Array.prototype.sort` is stable in modern JS, so they keep insertion order — but if memories are returned from SQLite in non-deterministic order (e.g., paged with no secondary sort), the timeline groups them inconsistently across re-renders. More critically, `manualMemories` interleaved with run memories at the same timestamp are placed BEFORE the run group via `<` comparison, even though the user created the manual memory after the run completed (if local clock skew or quick succession). The "before" placement misleads users about causality.
- **Root cause**: Single-millisecond timestamp granularity insufficient to disambiguate; no tiebreaker on ID or sequence.
- **Impact**: Misleading timeline ordering for fast operations; user confusion about whether memory came from run or manual.
- **Fix sketch**: Add `id` as tiebreaker in sort; document timestamp ordering caveats; consider using a sequence column from the backend.
