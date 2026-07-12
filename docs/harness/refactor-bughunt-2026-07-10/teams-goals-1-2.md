> Context: teams/goals [1/2]
> Total: 8
> Critical: 0  High: 0  Medium: 4  Low: 4

## 1. Dependency picker offers cross-project goals despite "same project" contract
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: edge-case
- **File**: src/features/teams/sub_goals/GoalDetailDrawer.tsx:312-318
- **Scenario**: The board defaults to cross-project scope (`GoalsPage` calls `fetchAllGoals()`), so `useSystemStore(s => s.goals)` holds every project's goals. In the drawer, `candidates = allGoals.filter(g => g.id !== goalId && !linkedIds.has(g.id))` has NO project filter, yet the comment on line 316 says "Candidate goals to link: same project". A user linking a "Depends on" dependency is offered goals from unrelated projects and can create a cross-project dependency. Conversely, in single-project scope `goalById` only holds the active project, so a `depends_on_id` pointing at another project renders as a raw UUID (`linked?.title ?? d.depends_on_id`).
- **Root cause**: The candidate list was never scoped to `goal.project_id`; the store array silently widened from one project to all when cross-project scope shipped.
- **Impact**: Unintended cross-project dependency graph + degraded UX (raw UUIDs). Backend cycle-check is only documented for `blocks`, so cross-project cycles may go unchecked.
- **Fix sketch**: Filter `candidates` (and ideally the `goalById` map used for row titles) by `g.project_id === goal.project_id`, or make the cross-project intent explicit and drop the misleading comment.

## 2. "Accept all" fires N concurrent accept+refetch cycles with no confirmation
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: race-condition
- **File**: src/features/teams/sub_goals/AcceptanceTriagePolished.tsx:74-80
- **Scenario**: The per-project "Accept all" button does `pg.kpiGroups.flatMap(kg => kg.goals).forEach(g => onAccept(g.id))`. `onAccept` (GoalAcceptanceView.tsx:39) is `async () => { await acceptGoal(id); await refetch(); }`. `forEach` does not await, so for M goals it launches M concurrent `acceptGoal` mutations AND M concurrent `refetch()` calls that all race to `setRows`. Interleaved refetches can momentarily re-add a goal that a sibling call is about to accept, and the final list depends on which refetch lands last.
- **Root cause**: Bulk action reuses the single-item async handler in a fire-and-forget loop; no batching and no bulk confirm for a queue-clearing action.
- **Impact**: Redundant network/DB churn, flicker, and a bulk state-change (irreversible acceptance → done) with zero confirmation.
- **Fix sketch**: `await Promise.all(goals.map(g => acceptGoal(g.id)))` then a single `refetch()`; gate behind a confirm when count is large.

## 3. UAT auto-refresh timer is never cancelled on unmount/goal-switch
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: silent-failure
- **File**: src/features/teams/sub_goals/GoalDetailDrawer.tsx:246-260
- **Scenario**: `handleRunUat` schedules `setTimeout(() => void refresh(), 4000)` but keeps no handle and no `clearTimeout`. If the user closes the drawer or opens a different goal within 4s, the timer still fires; `refresh` only guards on `goalId` being truthy, so it re-fetches against whatever goal is now current (or a closed modal), causing a stray state update / wasted round-trip.
- **Root cause**: One-shot timer created in an event handler outside React's effect-cleanup lifecycle.
- **Impact**: Minor wasted work / possible React state-update-after-close warning; not data-corrupting.
- **Fix sketch**: Store the id in a ref and clear it in the `useEffect` cleanup and at the top of `handleRunUat`, or capture `goalId` in the closure and no-op if it changed.

## 4. Task de-dupe hides an unrelated ad-hoc to-do that shares a step title
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: edge-case
- **File**: src/features/teams/sub_goals/GoalTaskTable.tsx:47-55
- **Scenario**: `partitionGoalTasks` builds `stepTitles = new Set(steps.map(s => s.title))` and drops every ad-hoc item whose title is in that set. If a user's hand-added to-do happens to have the exact same title as a team step (e.g. "Write tests"), the user's checkbox item silently disappears from the table with no indication — it's neither shown as a step nor as a to-do.
- **Root cause**: De-dupe keyed purely on exact title equality, assuming a title collision always means "same unit of work" (true for the backend mirror, false for a coincidental user entry).
- **Impact**: A user's to-do vanishes from the list; low likelihood, non-destructive (the row still exists in DB).
- **Fix sketch**: Only drop items that carry the mirror provenance (e.g. a source flag) rather than any title match, or surface a merged indicator.

## 5. Dead export: `KpiMiniGauge` is defined but never imported
- **Lens**: code-refactor
- **Severity**: medium
- **Category**: dead-code
- **File**: src/features/teams/sub_goals/acceptancePrimitives.tsx:39-64
- **Scenario**: The only consumer of this module is `AcceptanceTriagePolished.tsx`, which imports `{ AcceptRejectControls, KpiDivider, TeamMonogram, EmptyQueue }`. A repo-wide grep for `KpiMiniGauge` returns only its definition — no import anywhere. It is a leftover from the removed acceptance prototype variants (the file header describes multiple variants; only "Polished" survived).
- **Root cause**: Prototype consolidation removed the variant that used the gauge but left the shared primitive behind.
- **Impact**: Maintainability — ~25 lines of unused UI plus the `PendingKpi` coupling it keeps alive.
- **Fix sketch**: Delete `KpiMiniGauge` (and its now-unneeded `kpiPct` import if nothing else uses it in this file). `wash` stays — `TeamMonogram` still uses it.

## 6. Dead export: `GOAL_PANEL` constant is never referenced
- **Lens**: code-refactor
- **Severity**: medium
- **Category**: dead-code
- **File**: src/features/teams/sub_goals/goalsTheme.tsx:19-23
- **Scenario**: `GOAL_PANEL` is an exported class-string constant. A repo-wide grep finds only its declaration — no usage. The Timeline/Card surfaces inline their own `rounded-modal border ... hover:-translate-y-0.5` strings (e.g. GoalsTimeline.tsx:136, GoalCard.tsx:42) instead of consuming it, so the "one-file edit" intent in the file header is unrealized and the constant is orphaned.
- **Root cause**: Shared token was authored but the surfaces were written (or rewritten) with hand-inlined equivalents.
- **Impact**: Maintainability — dead constant plus divergent copies of the panel treatment it was meant to unify.
- **Fix sketch**: Either delete `GOAL_PANEL`, or (better) point GoalsTimeline row and GoalCard at it so the treatment has one source.

## 7. Duplicated project-origin chip: GoalCard reimplements `GoalProjectBadge`
- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication
- **File**: src/features/teams/sub_goals/GoalCard.tsx:54-62 (vs goalsTheme.tsx:53-63)
- **Scenario**: `goalsTheme` exports `GoalProjectBadge` (FolderKanban + truncated name pill), used by GoalsTimeline. GoalCard renders a near-identical chip inline (same icon, truncate, rounded-full pill, `title={projectName}`) instead of importing the shared component — the two will drift.
- **Root cause**: Chip copy-pasted into the card rather than reusing the extracted primitive.
- **Impact**: Maintainability — two copies of the same cross-project badge.
- **Fix sketch**: Import `GoalProjectBadge` in GoalCard; pass a `className` for the card-specific `hidden sm:inline-flex`/max-width tweak.

## 8. Misnamed module: `goalAcceptanceMock.ts` contains no mocks
- **Lens**: code-refactor
- **Severity**: low
- **Category**: misplaced-file
- **File**: src/features/teams/sub_goals/goalAcceptanceMock.ts:1-6
- **Scenario**: The file's own header states the `MOCK_*` fixtures were removed when the view went live and the "filename is retained only to avoid churn on the importers." It now holds the live domain model + `adaptPendingAcceptance` adapter — the opposite of a mock. The name actively misleads readers into thinking acceptance runs on fake data.
- **Root cause**: Fixtures deleted in place without renaming to avoid touching the 3 importers.
- **Impact**: Maintainability / comprehension — a core live adapter hides behind a "mock" filename.
- **Fix sketch**: Rename to `goalAcceptanceModel.ts` (or `acceptanceAdapter.ts`) and update the 3 importers (GoalAcceptanceView, AcceptanceTriagePolished, acceptancePrimitives) — a mechanical, low-risk rename.
