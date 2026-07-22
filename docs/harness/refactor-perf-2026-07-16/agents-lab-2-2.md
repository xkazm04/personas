# agents/lab [2/2] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 5 findings (0 critical / 1 high / 3 medium / 1 low)
> Context group: Agent Lab & Evolution | Files read: 10 | Missing: 0

## 1. VirtualizedTableBody virtualization is wired to the wrong scroll element and breaks table layout when it kicks in
- **Severity**: High
- **Lens**: perf-optimizer
- **Category**: broken-virtualization
- **File**: src/features/agents/sub_lab/components/shared/VirtualizedTableBody.tsx:23
- **Scenario**: An Arena run with >50 scenarios crosses `VIRTUALIZE_THRESHOLD` in `ArenaResultsView.tsx:304`. `getScrollElement` returns `closest('.overflow-x-auto')` — the horizontal-scroll wrapper (`ArenaResultsView.tsx:289`), which has no height cap and never scrolls vertically (the page/ancestor scrolls instead). The virtualizer therefore sees `scrollTop === 0` forever and only materializes the first ~viewport of rows; scrolling the page never triggers re-measurement, so rows past the initial window render as blank space.
- **Root cause**: Three compounding issues: (1) the scroll element is the horizontal container, not the actual vertical scroller; (2) virtual rows are `<tr style="position:absolute; width:100%">` inside the tbody, which takes them out of table layout so `<td>` widths no longer align with the `<thead>` columns; (3) `estimateSize: () => 44` with no `measureElement`, while ArenaResultsView cells render 3 stacked lines (~70px+), so even correctly-scrolled rows would overlap.
- **Impact**: The component's entire purpose (perf on large result sets) is the exact case where it visibly breaks — missing rows and misaligned columns on any arena run with 50+ scenarios. Below the threshold it is dead weight (the hook is still instantiated, just `enabled: false`).
- **Fix sketch**: Give the wrapper a `max-h-*` + `overflow-y-auto` and target it explicitly via a ref passed from the caller (or `closest('[data-virtual-scroll]')`). Keep `<tr>` in normal flow using the standard tanstack table pattern: pad with `paddingTop`/`paddingBottom` spacer rows (`<tr><td style={{height}}/></tr>`) instead of absolute positioning, and add `measureElement` (or a realistic `estimateSize`) for the multi-line rows. Alternatively, if lists realistically stay under a few hundred rows, delete the virtualized branch entirely — the simple branch is the only one that works today.

## 2. `labUtils.ts` is a dead re-export barrel with zero importers
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/agents/sub_lab/shared/labUtils.ts:1
- **Scenario**: Repo-wide grep finds no `import ... from '.../labUtils'` anywhere; the only remaining mention is a historical comment in `src/lib/eval/evalFramework.ts:6`. Every symbol it forwards is already exported by `shared/index.ts` (labPrimitives set) or imported directly from `@/lib/eval/evalFramework` by all consumers (ArenaResultsView, ArenaHistory, ScenarioDetailPanel, CompareMetrics, etc.).
- **Root cause**: Leftover shim from the eval-framework consolidation — consumers were migrated to direct imports but the compatibility barrel was never removed.
- **Impact**: Dead file that advertises a second "single source of truth" path for scoring utilities; a future import through it would recreate the indirection the consolidation removed.
- **Fix sketch**: Delete `src/features/agents/sub_lab/shared/labUtils.ts`. No call sites to update (verify with a final grep for `labUtils` before removal; only the evalFramework comment remains and can stay as history).

## 3. VersionRatingCell re-implements `scoreColor` with thresholds that contradict the canonical eval-framework version
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/agents/sub_lab/components/versions_table/VersionRatingCell.tsx:6
- **Scenario**: A composite score of 55 renders amber in ArenaResultsView / ArenaHistory / ScenarioDetailPanel (canonical `scoreColor` from `@/lib/eval/evalFramework`: warning at >=50) but red in the Lab versions table (local copy: red below 60). The same measurement shows two different verdict colors depending on which Lab surface displays it.
- **Root cause**: A private `scoreColor(c)` was added locally instead of importing the canonical, unit-tested one (`evalFramework.ts:168`, thresholds 80/50, token-based `text-status-*` classes). The local copy also hardcodes raw palette classes (`text-emerald-400`/`text-amber-300`) instead of status tokens.
- **Impact**: Inconsistent score semantics across the Lab plus a second implementation to keep in sync; the canonical one has tests, this one silently drifts.
- **Fix sketch**: Delete the local function and `import { scoreColor } from '@/lib/eval/evalFramework'` (it accepts `number | null`, so the `c` guard still works). If the 60-threshold was intentional product behavior for the versions table, change the canonical function (and its tests) instead — one source of truth either way.

## 4. Staggered row entrance animation delays the last table rows by up to ~3 seconds
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: render-latency
- **File**: src/features/agents/sub_lab/components/shared/VirtualizedTableBody.tsx:34
- **Scenario**: The non-virtualized branch (anything up to 50 rows) applies `animationDelay: idx * 60ms` per row. With 50 scenarios the last row does not appear until ~2.94s after mount, and the whole stagger replays every time the tbody remounts (tab switch back to results, panel reopen).
- **Root cause**: Unbounded per-index stagger with no cap; the delay grows linearly with row count.
- **Impact**: Users scanning results perceive the table as slow/incomplete for seconds even though data is already client-side; data below the fold pops in late while they're reading.
- **Fix sketch**: Cap the effective delay (`Math.min(idx, 10) * 40ms`) or stagger only the first N rows; also honor `prefers-reduced-motion`. Keep the 300ms fade itself.

## 5. `ArenaPanel` is a one-line passthrough wrapper around `ArenaPanelColosseum`
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: needless-indirection
- **File**: src/features/agents/sub_lab/components/arena/ArenaPanel.tsx:10
- **Scenario**: `ArenaPanel` renders `<ArenaPanelColosseum versionScope={versionScope} />` and nothing else. Its exported `ArenaVersionScope` type has no importers outside this file (ArenaPanelColosseum types its prop independently), and the "directional prototype variant" note in ArenaPanelColosseum suggests the A/B fork this wrapper enabled is over.
- **Root cause**: Leftover seam from when ArenaPanelColosseum was one of multiple ArenaPanel variants being trialed.
- **Impact**: Extra file and hop on every read of the arena entry point; two names for one component; a stranded exported type.
- **Fix sketch**: Rename `ArenaPanelColosseum` to `ArenaPanel` (or re-export it directly), move/export `ArenaVersionScope` from the surviving file, and update the two import sites (`sub_lab/index.ts:5`, `LabVersionsTable.tsx:11`). Verification needed only for external `ArenaPanel` imports via the barrel — grep shows none beyond those two.
