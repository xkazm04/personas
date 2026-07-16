# lib [2/2] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 2 findings (0 critical / 0 high / 2 medium / 0 low)
> Context group: Core Libraries & State | Files read: 7 | Missing: 0

## 1. memoryLimits.ts mandates lockstep maintenance of a dead legacy copy of memoryConflicts
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/lib/memoryLimits.ts:12 (dead files: src/features/overview/sub_memories/hooks/memoryConflicts.ts, src/features/overview/sub_memories/hooks/conflictBadges.tsx)
- **Scenario**: The module header instructs every future threshold change to be mirrored into "the legacy hook copy at `hooks/memoryConflicts.ts`". But that copy's only importer is `hooks/conflictBadges.tsx`, which itself has zero importers anywhere in `src/` (grep for `conflictBadges` returns no matches). All live consumers (index.ts barrel, MemoryConflictReview, ConflictCard, conflictHelpers) use `libs/memoryConflicts.ts`.
- **Root cause**: The conflict-detection logic was migrated from `hooks/` to `libs/` but the original copy was never deleted; the memoryLimits docs then codified the duplication as a maintenance contract instead of removing it.
- **Impact**: ~230 LOC of duplicated similarity/conflict logic that must be edited twice per the documented contract, doubling the chance of drift between "copies" of an algorithm only one of which actually runs. It also inflates every future audit/scan of this area.
- **Fix sketch**: Delete `sub_memories/hooks/memoryConflicts.ts` and `sub_memories/hooks/conflictBadges.tsx` (verify no dynamic imports — none found statically; also confirm `hooks/memoryActions.ts` / `mergeMemories.ts` don't reach them — they don't per grep). Then rewrite the memoryLimits.ts header (lines 5–14) to name only `libs/memoryConflicts.ts` as the consumer to keep in sync.

## 2. commandNames.overrides.ts carries entries with zero frontend references, violating its own contract
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/lib/commandNames.overrides.ts:24
- **Scenario**: The header defines this list as "commands referenced in the frontend that are NOT yet registered in the Rust invoke_handler". Grepping `src/` shows `create_chat_session` (line 24) and `lab_create_version_snapshot` (line 28) are referenced nowhere outside this file — the other 18 entries each have exactly one call site.
- **Root cause**: The frontend call sites for these two commands were removed (or never landed), but the manually-maintained override list was not pruned; only registration on the Rust side triggers the documented cleanup step.
- **Impact**: Each stale entry widens the `CommandName` union in `tauriInvoke.ts`, so a future `invoke("create_chat_session", …)` typechecks cleanly yet is guaranteed to fail at runtime — the exact hazard the typed command-name system exists to prevent. It also misrepresents the backlog of "planned commands".
- **Fix sketch**: Remove `"create_chat_session"` and `"lab_create_version_snapshot"` from the union. Optionally extend `scripts/generate-command-names.mjs` (or add a small CI check) to grep for each override entry in `src/` and fail on unreferenced ones, so the list self-prunes in both directions.

## Perf-optimizer lens: no findings

The seven files are constant tables, localStorage accessors, a slugifier, and a visibility pub/sub singleton. All three `subscribeDocumentVisibility` consumers (pollingCoordinator, executionSink, useDocumentVisibility via useSyncExternalStore) hold and invoke their unsubscribe functions correctly; the single module-level `visibilitychange` listener is an intentional app-lifetime singleton, not a leak. Nothing here runs on a hot path or scales with data size.
