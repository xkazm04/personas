# teams/teamMemory [1/2] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 5 findings (0 critical / 0 high / 2 medium / 3 low)
> Context group: Execution & Orchestration | Files read: 18 | Missing: 0

## 1. Dead barrel `index.ts` and orphaned `TeamMemoryBadge` component
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/teams/sub_teamMemory/index.ts:1 (and components/panel/TeamMemoryBadge.tsx:10)
- **Scenario**: A repo-wide grep shows zero imports from the `sub_teamMemory` barrel — the sole external consumer (`sub_teamWorkspace/teamStudio/TeamStudioSplitVariant.tsx:11`) imports `TeamMemoryPane` by direct path. `TeamMemoryBadge` is referenced only by that unused barrel, so the component is unreachable.
- **Root cause**: The barrel re-exports all 16 internal symbols "just in case"; when the DAG-canvas host was retired (per the `useTeamMemories` doc comment), the floating badge lost its only mount point but survived the dead-code passes because the barrel export kept it looking referenced.
- **Impact**: 27-line barrel + 32-line component of pure maintenance noise; the barrel also invites deep-coupling from other features and defeats the project's earlier barrel de-wiring effort. Anyone auditing "is X used?" has to chase the barrel indirection.
- **Fix sketch**: Delete `components/panel/TeamMemoryBadge.tsx` and either delete `index.ts` outright or shrink it to the two symbols with plausible external consumers (`TeamMemoryPane`, types). Verification needed only for dynamic import of the barrel path (none found via grep); tsc + next-build style gate (`npm run` checks) confirms.

## 2. Timeline diff summaries refetch up to 12 full run memory-sets on every remount, with no cache
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: n-plus-one
- **File**: src/features/teams/sub_teamMemory/libs/useRunDiffSummaries.ts:30
- **Scenario**: `MemoryTimeline` is conditionally rendered inside `TeamMemoryPanel` (TeamMemoryPanel.tsx:171-174), so every list↔timeline view toggle unmounts and remounts it. Each mount fires `Promise.all` of up to `MAX_RUNS = 12` `listTeamMemoriesByRun` Tauri IPC calls, each returning the run's complete memory set — only to reduce each pair to two integers. `RunDiffView` (diff mode) then fetches the same per-run sets again independently.
- **Root cause**: The hook derives summaries from full row payloads client-side and holds them in local `useState`, so the data dies with the component; there is no module-level or store-level cache keyed by run id, and no SQL-side aggregate (a `run_id`-grouped count/EXCEPT query could return the +/− numbers directly).
- **Impact**: 12 parallel IPC round-trips plus full-row serialization of every run's memories, repeated on each view toggle and whenever the run-id key changes (e.g. load-more paging in a new run id). Bounded by MAX_RUNS, so waste rather than unbounded growth — but it is the hottest data path in the timeline view.
- **Fix sketch**: Either (a) add a Rust command that computes per-run added/removed counts in SQLite (self-join or two grouped queries) and returns `Vec<(run_id, added, removed)>` in one IPC call, or (b) keep the client diff but memoize fetched run sets in a module-level `Map<runId, TeamMemory[]>` (run memory sets are immutable once the run finished) so remounts and `RunDiffView` reuse them. Option (a) also removes the duplicated diff logic vs `computeMemoryDiff`.

## 3. Run-id truncation logic triplicated across the feature
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/teams/sub_teamMemory/components/timeline/TimelineControls.tsx:15 (also diff/DiffHeader.tsx:12, panel/MemoryPanelList.tsx:83)
- **Scenario**: `shortRunId` (TimelineControls), `shortId` (DiffHeader), and an inline ternary in MemoryPanelList:83 all implement `id.length > 8 ? id.slice(0, 8) : id`.
- **Root cause**: Each component grew its own helper instead of the feature exposing one formatting utility next to `memoryConstants`.
- **Impact**: Three places to change if run-id display ever gains an ellipsis or different length; the inline copy in MemoryPanelList already drifted stylistically (no named helper).
- **Fix sketch**: Add `export function shortRunId(id: string): string` to `libs/memoryConstants.ts` (or a small `libs/format.ts`), import it in the three call sites, delete the local copies.

## 4. Category list and category color maps duplicated instead of living in memoryConstants
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/teams/sub_teamMemory/components/panel/AddTeamMemoryForm.tsx:8 (also panel/MemoryRowDetail.tsx:7, diff/DiffContent.tsx:8, timeline/TimelineItem.tsx:20, panel/MemoryPanelList.tsx:7)
- **Scenario**: `CATEGORIES = ['observation','decision','context','learning']` is declared identically in AddTeamMemoryForm and MemoryRowDetail; MemoryPanelList re-declares it as `CATEGORY_FILTERS` with `'all'` prepended; DiffContent's `CATEGORY_COLORS` (text-*) and TimelineItem's `CATEGORY_DOT` (bg-*) encode the same category→hue mapping (cyan/amber/violet/emerald) twice.
- **Root cause**: The feature already has a `libs/memoryConstants.ts` for importance constants, but category vocabulary and palette were never lifted into it.
- **Impact**: Adding a fifth category requires touching five files; a missed one silently renders the fallback color or omits the category from a form/filter — a drift bug waiting to happen.
- **Fix sketch**: In `libs/memoryConstants.ts` export `MEMORY_CATEGORIES` plus a single `CATEGORY_HUES: Record<string, { text: string; dot: string }>` (or two derived maps). Replace the five local declarations; MemoryPanelList builds `['all', ...MEMORY_CATEGORIES]`.

## 5. Per-row hover tracked in React state where CSS `group-hover` suffices
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/teams/sub_teamMemory/components/panel/TeamMemoryRow.tsx:34
- **Scenario**: Every `TeamMemoryRow` keeps a `hovered` boolean updated by `onMouseEnter`/`onMouseLeave` solely to conditionally mount `MemoryRowActions`. Sweeping the pointer down a 30-row page triggers two React re-renders per row (60 renders per pass), each re-running `parseRevisions` memo checks and re-rendering the revision list markup.
- **Root cause**: JS hover state used for pure presentation; the row container already carries the Tailwind `group` class (line 60), so the CSS mechanism is half-wired.
- **Impact**: Bounded per-page (30 rows) so cost is modest, but it is continuous work on the hottest interaction path of the list, and it prevents rows from ever being wrapped in `React.memo` effectively.
- **Fix sketch**: Render `MemoryRowActions` unconditionally inside a wrapper with `hidden group-hover:flex` (plus `group-focus-within:flex` for keyboard users), and drop the `hovered` state and both mouse handlers. Behavior is identical with zero re-renders on hover.
