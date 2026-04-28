# Ambiguity Audit — Recipes & Pipelines

> Total: 12 findings (2 critical, 4 high, 5 medium, 1 low)
> Files read: ~22
> Scope: Recipe CRUD/playground hooks, pipeline canvas reducer + handlers, dry-run debugger, store slices (recipe/team/group/trigger), team API wrappers.

## 1. Group color/role palette is duplicated string magic with no source-of-truth

- **Severity**: medium
- **Category**: magic-number
- **File**: src/stores/slices/pipeline/groupSlice.ts:48; src/features/pipeline/sub_canvas/libs/teamConstants.tsx:11-18, 31-36
- **Scenario**: `createGroup` falls back to `"#6B7280"` for color. `teamConstants.tsx` hard-codes a separate set of hex values for connection types and Tailwind class names per role. Nothing ties these palettes together or to a design token.
- **Root cause**: Color decisions are scattered string literals; there's no exported `DEFAULT_GROUP_COLOR` or `ROLE_PALETTE` constant referenced from one place.
- **Impact**: Theme/branding refresh requires hunting hex values across files; any drift between canvas vs. sidebar means the same role looks different in different views and erodes trust in the data model.
- **Fix sketch**:
  - Promote `DEFAULT_GROUP_COLOR` / `DEFAULT_PERSONA_COLOR` to `lib/utils/colors.ts` (or design tokens).
  - Reference from both `groupSlice.createGroup` and `useDerivedCanvasState` fallback (`#6366f1`).

## 2. `recordTriggerComplete` keeps `isThrottled=true` forever once tripped

- **Severity**: critical
- **Category**: edge-case
- **File**: src/stores/slices/pipeline/triggerSlice.ts:150-161
- **Scenario**: When a throttled trigger eventually drains the queue, the code computes `isThrottled = entry.queueDepth > 0 || prev.isThrottled`. `prev.isThrottled` is the value captured **before** the decrement and includes any prior `true`. This is a sticky-true: once set, the flag never returns to `false` here.
- **Root cause**: The intent was probably "stay throttled if queue still has work", but `prev.isThrottled` is OR'd in defensively without re-evaluating against window/cooldown/concurrency limits.
- **Impact**: `getRateLimitSummary().throttledTriggerIds` accumulates trigger IDs indefinitely; UI badges/banners show "throttled" forever. Auto-recovery indicators in the sidebar will be silently wrong, undermining the whole rate-limit feature.
- **Fix sketch**:
  - Re-evaluate against `firingTimestamps`/`cooldownUntil` at completion time, or at minimum drop the `|| prev.isThrottled` term.
  - Add a dedicated test: throttle → wait window → complete → expect `isThrottled === false`.

## 3. `recordTriggerFiring` resets `cooldownUntil` to 0 on the first un-throttled fire after cooldown

- **Severity**: high
- **Category**: undocumented-decision
- **File**: src/stores/slices/pipeline/triggerSlice.ts:132-140
- **Scenario**: When a fire is allowed and `rl.cooldown_seconds > 0`, the new state sets `cooldownUntil = now + cooldown_seconds*1000` — overwriting any longer cooldown that may have been set by a config previously. When `cooldown_seconds === 0`, `cooldownUntil` is forced to `0` even though the prior state's cooldown might still be in the future after a config change.
- **Root cause**: There is no comment defining whether cooldown is "set on every fire" or "set only when throttling boundary crossed". Behavior is just whatever the code does.
- **Impact**: Hot-swapping rate-limit config (e.g., increasing cooldown) silently shortens the next cooldown window; debugging this requires reading the slice. Ambiguous semantics make it impossible to write a correct integration test.
- **Fix sketch**:
  - Document the intended cooldown semantics in the `TriggerRateLimitState` JSDoc.
  - Decide: cooldown after every fire, or only after `max_per_window` exceeded? Pick one and assert in tests.

## 4. `addTeamMember` optimistic temp ID can collide under millisecond bursts

- **Severity**: medium
- **Category**: edge-case
- **File**: src/stores/slices/pipeline/teamSlice.ts:148; same pattern at :214
- **Scenario**: `tempId` uses `Date.now()` + 6 hex chars from `Math.random()`. The total entropy is ~24 bits within a single ms — a rapid loop (e.g. `useAutoTeam.apply` adding many members in tight sequence) can repeat IDs.
- **Root cause**: Implicit assumption that "Date.now() + random" is sufficiently unique without quantifying the collision space.
- **Impact**: A rare collision means the rollback `filter((m) => m.id !== tempId)` removes both attempts; one of the optimistic rows disappears even though only one IPC failed. With concurrent `addTeamMember` calls (the auto-team apply path adds members in series but a fast user could double-click), the temp swap on success could replace the wrong row.
- **Fix sketch**:
  - Use `crypto.randomUUID()` (already available in Tauri renderer) for temp IDs.
  - Or add an in-memory monotonic counter to guarantee uniqueness within the session.

## 5. `useAutoTeam.apply` partial-success leaves orphaned rows when memory seeding fails outside the inner try

- **Severity**: high
- **Category**: edge-case
- **File**: src/features/pipeline/components/useAutoTeam.ts:159-205
- **Scenario**: After connections are created, `setPhase('seeding')` runs in a swallow-everything `try { … } catch { /* best-effort */ }`. If `fetchTeams()` (line 206) throws, control jumps to the outer catch (line 211) which sets `error` and `phase='error'` — but the team + members + connections are already persisted. There is no cleanup, and the user is told "Failed to create team" while the team actually exists.
- **Root cause**: The phrase "Memory seeding is best-effort" sets one expectation, but the post-seed `fetchTeams()` is outside that try and inherits a different failure mode. Cleanup boundary is implicit, not documented.
- **Impact**: User sees an error and likely retries, creating duplicate teams. Trust eroded; orphaned topology is hard to find because the user doesn't know it exists.
- **Fix sketch**:
  - Move `fetchTeams()` inside its own try/catch (or after `setPhase('done')`).
  - Decide explicitly: at which step does "team is committed, errors are non-fatal" begin? Document the boundary.

## 6. Recipe + schema-field JSON parse silently drops malformed entries

- **Severity**: high
- **Category**: implicit-assumption
- **File**: src/features/recipes/shared/recipeParseUtils.ts:12-43; duplicated at src/features/recipes/sub_editor/components/RecipeEditor.tsx:20-44; src/features/recipes/sub_playground/tabs/recipeTestHelpers.ts:14-32
- **Scenario**: `parseTags`/`parseSchemaFields`/`parseInputSchema` all wrap `JSON.parse` in `try/catch` and return `[]` on error. A user-edited recipe with a typo loses all its tags/schema fields with no UI signal.
- **Root cause**: The "happy path returns parsed data, error path returns empty" pattern is duplicated 3× without a shared error-bubbling helper. There is one error variant in `parseInputSchema` that surfaces `parseError`, but the others don't — inconsistent.
- **Impact**: A recipe gets saved with valid `input_schema` JSON; a later DB migration or hand-edit corrupts one character; the editor opens, shows "no fields", user re-enters everything and saves — silently overwriting recoverable data.
- **Fix sketch**:
  - Consolidate to one parse helper that always returns `{ value, error }`.
  - In `RecipeEditor`, surface a `SchemaParseErrorBanner` when `error !== null` and **block save** until the user acknowledges they'd be overwriting unparseable data.

## 7. `useDerivedCanvasState` defaults missing positions using node array index — non-stable across reorderings

- **Severity**: medium
- **Category**: implicit-assumption
- **File**: src/features/pipeline/sub_canvas/libs/useDerivedCanvasState.ts:127-129
- **Scenario**: When `position_x`/`position_y` is null, the fallback uses `i` (the index in `teamMembers`) modulo 4. If a member is deleted or members are returned in a different order from the backend, every member with null position jumps to a new spot.
- **Root cause**: Implicit assumption that `teamMembers` array is stable across renders. The DB has no ORDER BY guarantee documented for `list_team_members`.
- **Impact**: After deleting a member that had `position_x = null`, every other null-position member visually relocates — looks like data corruption to the user. Auto-layout result depends on render order rather than a deterministic property.
- **Fix sketch**:
  - Sort members by `created_at` (or `id`) before deriving fallback positions; use the sorted index.
  - Even better: backfill `position_x`/`position_y` at create time so null is never reached.

## 8. `useDebugger.STEP_DELAY = 800` is hard-coded with no rationale

- **Severity**: low
- **Category**: magic-number
- **File**: src/features/pipeline/sub_canvas/libs/useDebugger.ts:11
- **Scenario**: 800 ms between auto-steps. No comment on why 800 vs. 500 vs. 1000.
- **Root cause**: Tribal knowledge — chosen by feel during initial build.
- **Impact**: Future demo/screen-recording code might need a different cadence; a teammate adjusting it has no anchor for the trade-off (smooth animation vs. wait-time per step).
- **Fix sketch**:
  - Comment: "// 800 ms felt readable while still progressing fast enough for ~10-node teams."
  - Make it a prop on `useDebugger` so a "fast/slow/pause" UI control becomes trivial.

## 9. Memory seeding cap (`seeded >= 10`) and importance threshold (`>= 7`, downshift `-1`, floor `5`) all undocumented

- **Severity**: medium
- **Category**: magic-number
- **File**: src/features/pipeline/components/useAutoTeam.ts:179, 190, 199
- **Scenario**: `if (mem.importance >= 7)` selects high-value memories; `Math.max(mem.importance - 1, 5)` reduces importance with a floor; `if (seeded >= 10) break` caps total seeded memories. Three different magic numbers, no comments.
- **Root cause**: These tune the "auto team" feature's quality but the ratios aren't tied to any tested heuristic.
- **Impact**: When a UX person says "auto-teams feel empty", a developer can't tell whether the bottleneck is the 5-memory `listTeamMemories(…, 5)` limit, the importance-7 threshold, or the 10-memory cap. Cannot tune without re-deriving intent.
- **Fix sketch**:
  - Hoist to named constants at top of file: `MIN_SEED_IMPORTANCE = 7`, `SEED_IMPORTANCE_DECAY = 1`, `SEED_IMPORTANCE_FLOOR = 5`, `MAX_SEEDED_MEMORIES = 10`, `MEMORIES_PER_SOURCE_TEAM = 5`.
  - Add 1-line comment for each on what's being traded off.

## 10. Pipeline status listener silently drops events when `team_id` doesn't match selectedTeamId — but events for other teams still pulse memories

- **Severity**: critical
- **Category**: edge-case
- **File**: src/features/pipeline/components/canvas/useCanvasPipelineActions.ts:54-69
- **Scenario**: `if (event.payload.team_id === selectedTeamId)` gates UI state updates. If a pipeline runs for team A while user views team B, user sees no indication. When user switches back to team A, the pipeline may already be done — but `pipelineRunning` is still `false` (RESET_ON_TEAM_SWITCH wiped it) and `pipelineNodeStatuses` is empty. The user has no way to discover the run completed.
- **Root cause**: The model assumes the user is always watching the actively-running team. There's no event buffering or "X runs in flight on other teams" indicator.
- **Impact**: Users who flip between teams during long pipeline runs lose all status feedback. They will re-trigger pipelines thinking nothing happened — silent duplicate execution, wasted tokens/$.
- **Fix sketch**:
  - Track `runningPipelinesByTeamId` in the store from these events regardless of selection.
  - On `selectTeam`, hydrate `pipelineNodeStatuses` from this cached state instead of resetting to `[]`.
  - Show a sidebar badge for teams with active pipelines.

## 11. Auto-save 1500 ms debounce is repeated as a literal in two places (handlers + auto-layout)

- **Severity**: medium
- **Category**: magic-number
- **File**: src/features/pipeline/components/canvas/useCanvasHandlers.ts:137, 152
- **Scenario**: The save debounce window appears twice as a bare `1500`. The thoughtful staleness-guard comment at :110-115 explicitly references "the 1500ms window" — but if the constant changes, the comment stays.
- **Root cause**: Copy-paste of timeout literal between auto-save trigger paths.
- **Impact**: Future developer changing the debounce to 800 ms in one place but not the other will create asymmetric behavior (drag-saves at 800 ms, auto-layout-saves at 1500 ms). The staleness comment will lie about the window size.
- **Fix sketch**:
  - Extract `const AUTOSAVE_DEBOUNCE_MS = 1500;` at module top.
  - Update the comment to reference the constant by name.

## 12. `useRecipeTestRunner` truncates history to 20 with no UI affordance for "older runs"

- **Severity**: medium
- **Category**: requirements-unclear
- **File**: src/features/recipes/sub_playground/libs/useRecipeTestRunner.ts:35, 56
- **Scenario**: Both `setHistory((prev) => [...prev].slice(0, 20))` calls clamp history at 20 entries. There is no comment, no setting, and no "history full" indicator. The 21st run silently evicts the 1st.
- **Root cause**: Implicit decision: "playground history is ephemeral, 20 is enough." But the playground tab has a `RecipeHistoryTab` that users may use as a working surface.
- **Impact**: A prompt engineer running 30 quick variations to compare — say across a workshop session — will lose the early ones and not realize. They will scroll to the bottom expecting "show more" and there will be nothing.
- **Fix sketch**:
  - Add a `HISTORY_LIMIT = 20` constant with a JSDoc explaining the rationale (memory? perf?).
  - Either expose a "clear history" + count UI (`12/20`), or persist beyond 20 via IndexedDB.
  - Document whether history is intended to survive page refresh — currently it does not.
