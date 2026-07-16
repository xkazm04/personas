# teams/teamMemory [2/2] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 2 findings (0 critical / 0 high / 0 medium / 2 low)
> Context group: Execution & Orchestration | Files read: 1 | Missing: 0

## 1. sub_teamMemory barrel re-exports memoryConstants (and everything else) with zero consumers
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/teams/sub_teamMemory/index.ts:21
- **Scenario**: Every consumer of this feature imports via direct paths (`TeamStudioSplitVariant.tsx` imports `../../sub_teamMemory/TeamMemoryPane`; `StreamMemoryViews.tsx` imports `.../components/timeline/MemoryTimeline` and `.../components/diff/RunDiffView`; all internal files use relative paths). A repo-wide grep finds no import resolving to the `sub_teamMemory` barrel itself, so the re-export block for `IMPORTANCE_MIN/MAX/DOTS`, `importanceToDots`, `dotsToImportance` (index.ts:21-27) — and the rest of the barrel — is dead.
- **Root cause**: The barrel was scaffolded as the module's public API, but consumers were wired with deep paths instead, leaving the barrel orphaned.
- **Impact**: Dead maintenance surface; every new export gets duplicated into a file nothing reads, and the aliasing in it (`MemoryEntry as TimelineItem`, `RunMarker as TimelineControls`) misleads readers about the actual component names. Barrels also defeat tree-shaking if someone later does import through it.
- **Fix sketch**: Delete `src/features/teams/sub_teamMemory/index.ts` after a final grep for `sub_teamMemory'` / `sub_teamMemory"` import specifiers (already done here, zero hits — re-verify at fix time in case of test files or dynamic imports). Alternatively, if the team wants barrels as convention, rewire the three external consumers to import from it and drop the misleading aliases.

## 2. IMPORTANCE_MIN/IMPORTANCE_MAX names collide with a different-scale twin in api/overview/memories.ts
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/teams/sub_teamMemory/libs/memoryConstants.ts:2
- **Scenario**: `src/api/overview/memories.ts:20-21` exports `IMPORTANCE_MIN = 1` / `IMPORTANCE_MAX = 5` (persona memories, matching Rust `validation/memory.rs` 1–5), while this file exports the same names with `IMPORTANCE_MAX = 10` (team memories, matching the Rust `clamp(1, 10)` in `data_portability.rs:1842`). The scales are genuinely different domains, but the identifiers are identical, so an auto-import or copy-paste that picks the wrong module silently validates/renders on the wrong scale (e.g. treating a team-memory importance of 8 as out-of-range, or capping a persona slider at 10).
- **Root cause**: Two independent memory features each named their scale constants with the same generic names and no domain qualifier or shared source.
- **Impact**: Bounded but real confusion hazard: reviewers and auto-import tooling cannot distinguish the two by name, and the 1-5 vs 1-10 mismatch is exactly the class of bug that only surfaces as subtly wrong UI (dots/sliders) rather than an error.
- **Fix sketch**: Rename to domain-qualified constants (`TEAM_MEMORY_IMPORTANCE_MAX = 10` here; `PERSONA_MEMORY_IMPORTANCE_MAX = 5` in api/overview/memories.ts), or keep local names but add a doc comment cross-referencing the other scale. Two files, mechanical rename; TypeScript will catch all call sites.

No perf-optimizer findings: the file is pure constants plus two O(1) arithmetic helpers used on click/render of a small dot row — nothing measurable to optimize.
