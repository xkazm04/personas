# teams/goals [1/2] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 6 findings (0 critical / 0 high / 4 medium / 2 low)
> Context group: Execution & Orchestration | Files read: 18 | Missing: 0

## 1. GoalDetailDrawer refetches everything (6 queries + N step queries) on every micro-mutation
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: over-fetching
- **File**: src/features/teams/sub_goals/GoalDetailDrawer.tsx:107
- **Scenario**: Toggling one checklist item, adding an item, or deleting one calls `refresh()`, which re-runs `resolveGoalProgress` + `listGoalItems` + `listChildGoals` + `listTeamAssignmentsForGoal` + `listGoalSignals` + `listGoalDependencies` in parallel, then a second waterfall of `listTeamAssignmentSteps` per assignment. Ticking 5 to-dos in a row issues 30+ IPC round-trips to the Rust/SQLite side.
- **Root cause**: Every mutation handler (`handleToggleItem`, `handleAddItem`, `handleDeleteItem`, `addDep`, `removeDep`, …) shares the single full-scope `refresh()` instead of refetching (or locally patching) only the slice it changed.
- **Impact**: Visible latency on rapid checklist interaction (each click also re-runs the LLM-free but non-trivial `resolve_goal_progress` aggregation) and a spinner flash (`setLoading(true)`) that repaints the whole drawer body. Bounded per drawer, but this is the hottest interactive surface in the Goals module.
- **Fix sketch**: For item toggle/add/delete, update `items` optimistically (or refetch only `listGoalItems` + `resolveGoalProgress`) instead of the full `refresh()`. Same for dep add/remove: refetch only `listGoalDependencies`. Keep the full `refresh()` for open, advance, abort, and step resolution where the whole picture genuinely changes. Optionally drop `setLoading` for these targeted refreshes to avoid the spinner flash.

## 2. "Accept all" fires N unawaited accept+refetch pairs — refetch storm with a stale-render race
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: n-plus-one
- **File**: src/features/teams/sub_goals/AcceptanceTriagePolished.tsx:76
- **Scenario**: The per-project "Accept all" button does `goals.forEach((g) => onAccept(g.id))`. Each `onAccept` (GoalAcceptanceView.tsx:39) is `await acceptGoal(id); await refetch()` — so a project with 8 pending goals launches 8 concurrent accept mutations plus 8 concurrent `listPendingAcceptance` full refetches, none awaited.
- **Root cause**: The batch action reuses the single-goal handler; there is no batch-aware callback, and the concurrent refetches have no last-write-wins guard (`setRows` applies whichever response resolves last).
- **Impact**: N× redundant queries on a primary CTA, and a race: a refetch that was issued before the last accept committed can resolve last and repaint already-accepted goals back into the queue until something else refreshes. `acceptGoal` also refreshes the TitleBar badge N times.
- **Fix sketch**: Add an `onAcceptMany(ids: string[])` prop; in GoalAcceptanceView implement it as `await Promise.all(ids.map(acceptGoal)); await refetch()` — one refetch, no interleaving. Alternatively add a monotonically-increasing request id in `refetch` and ignore stale responses.

## 3. Dead export `GOAL_PANEL` — its class string is duplicated inline where it should be used
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/teams/sub_goals/goalsTheme.tsx:19
- **Scenario**: `GOAL_PANEL` ("the shared panel treatment … so a tweak is a one-file edit") has zero importers anywhere in src/. Meanwhile GoalsTimeline.tsx:141 and GoalCard.tsx:42 hand-copy near-identical class strings (`rounded-modal border border-primary/10 bg-gradient-to-br from-card/60 to-card/20 … hover:border-primary/25 …`) with small drifts (GoalsTimeline omits `hover:shadow-elevation-2` and `motion-reduce:transition-none`).
- **Root cause**: The token was extracted but consumers were written (or rewritten) with inline copies, so the "one-file edit" contract is already broken.
- **Impact**: Dead export plus 2-way visual drift: the shared look the file promises can no longer be tweaked in one place, and the copies have already diverged on hover shadow / reduced-motion handling.
- **Fix sketch**: Either wire GoalsTimeline row buttons and GoalCard to compose `GOAL_PANEL` (adding the per-surface extras like `cursor-pointer` / `animate-fade-slide-in` alongside), or delete `GOAL_PANEL` and accept the inline styling. Wiring it is preferred — the duplication is exact enough that consolidation is mechanical.

## 4. GoalsTimeline `compact` + `allProjects` props (and the listAllGoals fetch path) have no caller
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/teams/sub_goals/GoalsTimeline.tsx:47
- **Scenario**: The only render site in the repo is GoalsPage.tsx:213 (`<GoalsTimeline showProject={crossProject} />`). `compact` and `allProjects` are never passed, so the `allGoals` state, the `useEffect` calling `devApi.listAllGoals()` + `fetchProjects`, and both `compact` branches are unreachable. The doc comment ("the multi-team channel sidebar") and GoalsEmptyGlyph's "two separate lazy chunks (GoalsPage and the fleet…)" refer to a caller that no longer exists.
- **Root cause**: The fleet/channel-sidebar consumer was removed (part of the earlier sidebar cleanup) but the component kept its dual-mode plumbing.
- **Impact**: ~25 lines of dead state/effect/branching in a hot view file, plus misleading comments claiming a second consumer; the dead effect also imports `devApi`/`silentCatch` paths that complicate reasoning about what the Timeline actually fetches. (Verify no dynamic/planned caller before deleting — grep found none outside sub_goals.)
- **Fix sketch**: Drop the `compact` and `allProjects` props, the `allGoals` state + effect, and the `goals = allProjects ? … : storeGoals` split; read `storeGoals` directly. Update the GoalsEmptyGlyph comment about two lazy chunks if it no longer holds.

## 5. GoalCard re-implements GoalProjectBadge inline
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/teams/sub_goals/GoalCard.tsx:54
- **Scenario**: The project-origin chip in GoalCard (FolderKanban icon + truncated name in a pill) is a near-verbatim copy of `GoalProjectBadge` in goalsTheme.tsx:53, differing only in `max-w` (92px vs 140px), `bg-background/40` vs `bg-primary/5`, `text-[11px]` vs `text-[10px]`, and a `hidden sm:inline-flex` guard.
- **Root cause**: The card was styled independently instead of parameterizing the existing shared badge.
- **Impact**: Two chips meant to be the same "which project is this goal from" affordance drift in size/contrast between the Board and the Timeline; a future tweak has to find both.
- **Fix sketch**: Extend `GoalProjectBadge` with the small deltas via its existing `className` prop (e.g. pass `hidden sm:inline-flex max-w-[92px]`) and use it in GoalCard, deleting the inline copy.

## 6. handleRunUat's 4s setTimeout is never cleared and captures a stale refresh
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: leak
- **File**: src/features/teams/sub_goals/GoalDetailDrawer.tsx:254
- **Scenario**: `handleRunUat` schedules `setTimeout(() => void refresh(), 4000)`. If the user closes the drawer or switches to another goal within 4s, the timer still fires: it runs the `refresh` closure captured at click time (old `goalId`), re-issuing the full 6-query fetch for a goal that is no longer displayed and writing its results into the drawer's state.
- **Root cause**: Fire-and-forget timeout with no ref/cleanup and no isOpen/goalId guard at fire time.
- **Impact**: A wasted multi-query fetch on a closed surface; if the user opened a different goal meanwhile, the late `setItems`/`setSignals`/... from the old goal can momentarily overwrite the new goal's freshly loaded data until its own fetch resolves. Bounded (one timer per UAT run) but avoidable.
- **Fix sketch**: Store the timer id in a ref, clear it in a `useEffect` cleanup keyed on `goalId`/`isOpen`, and guard the callback (`if (goalIdRef.current === goalId && isOpenRef.current) void refresh()`). Alternatively route the delayed refresh through the same cancelled-flag pattern GoalsTimeline already uses.
