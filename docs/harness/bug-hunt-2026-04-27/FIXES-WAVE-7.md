# Bug Hunt Fix Wave 7 — Optimistic Update Without Rollback Theme

> 5 commits, 4 findings closed (one commit bundled the canvas fix with a TS-scope amendment to the prior RecipeEditor commit).
> Baseline preserved: 0 TS errors → 0 TS errors, 870/870 tests pass → 870/870 tests pass.

---

## Commits

| # | Commit | Finding closed | Severity | Files |
|---:|---|---|---|---|
| 1 | `f13c7109` fix(recipes): RecipeTestRunner gates merge effect by run-id correlation | recipes-pipelines #2 | critical | 1 |
| 2 | `5975d73d` fix(pipeline): team-member/connection optimistic add guards against team-switch race | recipes-pipelines #3 | high | 1 |
| 3 | `ff4be46e` fix(recipes): RecipeEditor save failure copies draft to clipboard + shows real error | recipes-pipelines #6 | high | 1 |
| 4 | `c8004356` fix(canvas): auto-save bails when team switched during 1500ms debounce + RecipeEditor scope amend | recipes-pipelines #8 | high | 2 |

---

## What was fixed

### Run-id correlation for async merge effects (1)

1. **RecipeTestRunner** — The merge `useEffect` watched only `execution.phase`/`execution.output`. A late-arriving completion from run #1 (when the user switched recipes mid-flight or started a second run) would scribble onto run #2's result, corrupting history with mismatched `rendered_prompt` + `llm_output` pairs. Now: `resultRunIdRef` tracks which run produced the current result; the merge short-circuits unless it matches `runCountRef.current`.

### Optimistic-write team-switch staleness guards (2)

2. **`teamSlice.addTeamMember` / `createTeamConnection`** — Optimistic temp inserted; backend create awaited; map-replaced. If the user switched teams mid-await, `selectTeam` had cleared the array — the map produced `[]` and the real DB record became invisible (re-adding caused a duplicate). Now: capture `teamId` at op start; abort the reconcile `set` if `selectedTeamId` changed.

3. **`useCanvasHandlers` 1500ms debounced auto-save** — `setTimeout` fired `saveRef.current()` without verifying the team was still the one whose nodes were dragged. Mid-debounce team switch caused team-A node ids to be persisted under team-B's selection — silent corruption or silent 404. Now: capture `selectedTeamId` at debounce-start and pass to `handleSave`; the handler aborts if the captured id no longer matches.

### Recovery from data-loss-on-save (1)

4. **RecipeEditor stale-recipe save** — When the recipe was deleted in another tab, `updateRecipe(deletedId, ...)` either errored with a generic toast or silently 404'd; either way the user lost 5+ minutes of edits with no rescue path. Now: catch surfaces the real error message AND copies the serialised draft payload to the clipboard so the user can paste their work into a new recipe instead of losing it.

---

## Verification

| Gate | Before wave 7 | After wave 7 |
|---|---|---|
| TypeScript errors | 0 | **0** |
| Tests passing | 870 / 870 | **870 / 870** |
| Files modified | — | 4 unique |
| Cumulative findings closed (waves 1-7) | 45 | **49** |

---

## Cumulative status (waves 1-7)

**49 findings closed in 49 atomic commits across 7 themed waves.**

| Wave | Theme | Findings |
|---|---|---:|
| 1 | Security & data-loss criticals | 12 |
| 2 | Stream lifecycle + persona-switch staleness | 6 |
| 3 | Misc criticals (orchestration, recovery, React 19 hazards) | 7 |
| 4 | Cleanup-gap | 7 |
| 5 | Silent-success theater | 7 |
| 6 | Time / timezone / DST / polling | 6 |
| 7 | Optimistic update without rollback | 4 |
| | **Total** | **49** |

All 25 critical-rated findings remain closed (waves 1-3, plus #2 from this wave). Waves 4-7 closed the highest-impact items in all four major themed clusters identified in the original INDEX.md.

---

## Patterns established (additions to the catalogue, now 24-26)

24. **Run-id correlation for late-arriving async merges** — Effects that merge async results into a current state must verify the result still belongs to the same "run" that produced the state. A simple incrementing ref (compared against the result's captured run-id) catches the case where a slower run #1 fires after a faster run #2 has already started.

25. **Optimistic temp + reconcile must verify the context still matches** — Patterns of `setOptimistic(temp); await ipc(); set(state => state.map(replace temp))` silently break when the user switches the parent context (team, persona, project) during the await. Capture the context id at op start; abort the reconcile when it no longer matches.

26. **Save-failure recovery must surface the actual error AND retain user work** — Generic "Failed to save" toasts that swallow the error message and discard the form payload force users to redo work after every transient failure. At minimum: surface the error message; ideally: copy the serialised draft to the clipboard or persist to IndexedDB.

---

## What remains

After 7 waves the remaining backlog is dominated by lower-severity tail items spread across many files:

- **Race-window tail** (~10 after waves 2-3, 7 closed many) — overview seq-counter inconsistency, etc.
- **Empty-set / divide-by-zero / NaN** (~15) — overview/leaderboard math.
- **Tail items per context** (~140) — predominantly low-severity instances of the patterns now codified in the 26-item catalogue.

The pattern catalogue is now the most valuable artefact for future audits. New code reviewers should grep for these shapes proactively rather than wait for another bug-hunt scan.
