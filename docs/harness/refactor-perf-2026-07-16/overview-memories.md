# overview/memories — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 5 findings (0 critical / 2 high / 2 medium / 1 low)
> Context group: Observability & Monitoring | Files read: 22 | Missing: 0

## 1. Entire `hooks/` directory is a dead, stale duplicate of `libs/`
- **Severity**: High
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/overview/sub_memories/hooks/memoryConflicts.ts:1 (also hooks/memoryActions.ts, hooks/mergeMemories.ts, hooks/conflictBadges.tsx)
- **Scenario**: A repo-wide grep finds zero imports of `sub_memories/hooks/*` — every consumer (ConflictCard, MemoryConflictReview, the `index.ts` barrel, `stores/slices/overview/memorySlice.ts`) imports the `libs/` copies. The only reference left is a stale comment in `src/lib/memoryLimits.ts:7-14` claiming both copies must stay "in lockstep".
- **Root cause**: The conflict/action logic was moved from `hooks/` to `libs/` but the originals were never deleted; comments in both `libs/memoryConflicts.ts` ("the parallel hook copy") were even written to justify keeping them synchronized.
- **Impact**: ~430 LOC of dead code across 4 files. Worse than inert: `hooks/memoryActions.ts` is a STALE copy missing the localStorage corruption-recovery/session-backup logic that `libs/memoryActions.ts` gained — anyone editing the wrong file silently loses their change, and the "keep both in lockstep" comments actively invite double-maintenance.
- **Fix sketch**: Delete the four `hooks/` files (`memoryConflicts.ts`, `memoryActions.ts`, `mergeMemories.ts`, `conflictBadges.tsx`). Update the comment in `src/lib/memoryLimits.ts` and the "legacy hook copy" comments in `libs/memoryConflicts.ts:73,82` to drop the dual-copy story. `tsc` confirms nothing breaks.

## 2. Retired "Baseline" list-view components survive with no consumers
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/overview/sub_memories/components/MemoryTableHeader.tsx:13 (also MemoryFilterBar.tsx, MemoryEmptyState.tsx, MemoryHeaderActions.tsx, MemoryRow in MemoryCard.tsx)
- **Scenario**: `MemoriesPage.tsx` documents that the Baseline virtualized-list layout was retired 2026-06-17 in favor of Dense. Grep across `src/` shows `MemoryTableHeader`, `MemoryEmptyState`, and `MemoryHeaderActions` have zero importers; `MemoryFilterBar` and `MemoryRow` are only re-exported from the `sub_memories/index.ts` barrel with no actual consumer. `MemoryCard.tsx`'s comment "kept in sync with MEMORY_COLUMNS in MemoriesPage" refers to a constant that no longer exists.
- **Root cause**: The layout retirement removed the page that composed these pieces but not the pieces themselves, and the barrel kept exporting them so they look alive.
- **Impact**: ~380 LOC of orphaned UI (MemoryRow alone is ~140 LOC of delete-confirm timer logic) that will drift from the live Dense table and mislead future edits. Note `ImportanceBar` inside MemoryCard.tsx IS live (MemoryDetailModal imports it) — only `MemoryRow` and the deprecated `ImportanceDots` alias are dead there.
- **Fix sketch**: Delete `MemoryTableHeader.tsx`, `MemoryEmptyState.tsx`, `MemoryHeaderActions.tsx`, `MemoryFilterBar.tsx`; in `MemoryCard.tsx` keep only `ImportanceBar` (drop `MemoryRow`, `CapabilityScopeBadge`, `ImportanceDots`) and consider renaming the file `ImportanceBar.tsx`. Prune the corresponding barrel exports in `index.ts`. Barrel exports mean a final repo-wide grep (done here for `src/`) should be re-run at fix time to be safe.

## 3. O(n²) conflict detection with per-pair bigram sets runs on the main thread
- **Severity**: High
- **Lens**: perf-optimizer
- **Category**: quadratic-algorithm
- **File**: src/features/overview/sub_memories/libs/memoryConflicts.ts:84
- **Scenario**: Opening the Conflicts tab (MemoryConflictReview) runs `detectConflicts(memories)` in a `useMemo` — and re-runs it after every single conflict resolution because each resolution calls `fetchMemories()`. For n memories it evaluates n(n-1)/2 pairs, and each pair builds fresh character-bigram Sets and token Sets over the full `title + content` of both memories.
- **Root cause**: `textSimilarity` and `topicOverlap` both re-tokenize/re-bigram each memory for every pair, so each memory's text is processed ~3·(n-1) times; at 1,000 memories that is ~500k pairwise Jaccard computations over potentially KB-sized contents, synchronously on the render path.
- **Impact**: The Conflicts tab freezes the UI for seconds once the memory pool reaches high hundreds/thousands (this is an agent app where memories accumulate automatically), and the freeze repeats after every resolution click.
- **Fix sketch**: Precompute per-memory token Sets and bigram Sets once in an O(n) pass and pass them into the pair loop (removes the dominant constant). Add a cheap pre-filter (skip pairs whose token-set sizes differ by >3x or share zero tokens via an inverted index) to prune most of the n² space. If pools genuinely reach many thousands, move detection to the Rust side or a web worker; also consider caching the result keyed on the memories array identity so a dismiss-only resolution doesn't recompute.

## 4. Dense table renders every memory as a layout-animated motion row with no virtualization
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/overview/sub_memories/components/MemoriesPageDense.tsx:325
- **Scenario**: `sortedMemories.map` renders one non-memoized `DenseRow` (`motion.button` with `layout` + `AnimatePresence mode="popLayout"`) per memory. Selecting a row, toggling a sort, or any store update re-renders all rows, and framer-motion's `layout` prop makes every row measure its bounding box on each pass.
- **Root cause**: No `React.memo` on `DenseRow`, no windowing, and `layout` measurement cost is paid per row per render even when nothing moved; `onSelect` is also recreated inline per row so memoization alone wouldn't stick without stabilizing it.
- **Impact**: With a few hundred memories each click costs hundreds of row re-renders plus layout measurements — noticeable input lag on the very surface built for "information density"; grows linearly with the pool.
- **Fix sketch**: Wrap `DenseRow` in `React.memo`, pass `selectedId` comparison props and a stable `onSelect(memory)` callback (single handler + id argument). Drop the `layout` prop (rows only reorder on sort; a simple fade is enough) or gate it behind list length. For large pools add windowing (e.g. `@tanstack/react-virtual`) on the scroll container.

## 5. KpiMetric/KpiDivider duplicated verbatim between Dense and Graph pages
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/overview/sub_memories/components/MemoriesPageDense.tsx:459 (and MemoriesPageGraph.tsx:459)
- **Scenario**: Both memory views define byte-identical `KpiMetric` and `KpiDivider` components at the bottom of the file; a styling tweak to the KPI strip must be made twice or the two views drift.
- **Root cause**: The Graph view was cloned from the Dense scaffold and the tiny helpers were copied instead of extracted.
- **Impact**: Bounded (2 copies, ~15 LOC), but this is exactly the drift pattern `memoryVisualTokens.ts` was created to kill for colors.
- **Fix sketch**: Extract both into a small shared file (e.g. `sub_memories/components/KpiStrip.tsx` or the shared display components folder) and import it from both pages.
