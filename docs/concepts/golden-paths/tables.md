# Golden path — Tables & list surfaces

> **Corrections pass — 2026-08-13.** This path was written as a probe BEFORE
> discovery replaced the top-down 56-topic tree with the 247-leaf spine, and
> its topic path was never re-pointed. Old address `frontend/surfaces/tables` names a domain that
> no longer exists. Corrected above. The document's content was not affected.

> Situation node: `product-surfaces/lists-and-tables/data-table` · [situation spine](../situation-spine.md)
> Hand-authored 2026-08-13 from a repo-wide ground-truth sweep (51 tool calls),
> against `master` @ `2a874e692`. `.claude/worktrees/**` excluded from all counts.
> The **Deviations** section is a fix backlog; it migrates to `violating` cells
> in `workspace_practice_context_state` when this path is ingested.

## Trigger

- "Add a table for X" / "list the Y with columns for Z"
- "Make this list sortable / filterable / paginated"
- "This grid needs a loading skeleton" / "the empty state flashes before data arrives"
- "Show N rows without janking" (virtualization, infinite scroll, load-more)
- "Group these rows by day / by project / by category"
- "Let the user select rows and bulk-act on them"

If you are about to type `<table>`, `<thead>`, `role="columnheader"`, `const GRID = 'grid grid-cols-[...]'`, `gridTemplateColumns`, `animate-pulse`, or `useState` holding a `sortKey` — you are in this situation.

## The one way

Do not build a table. Pick one of exactly three shared primitives and feed it a `columns` array. Use **`UnifiedTable`** by default — it owns sorting, per-column dropdown filters and search, virtualization, sticky group headers, column resize and sort persistence, keyboard row nav, scroll restoration, infinite scroll, and the entire loading-pattern-v2 cold-load contract (delayed calm ghost rows under the permanent header → settled-only empty state → id-guarded one-shot row cascade), all derived from just `isLoading` + `data`. Use **`DataGrid`** only when you need page-based pagination, row selection with a bulk-action toolbar, or HTML5 row drag — `UnifiedTable` has none of those, and `DataGrid` has none of `UnifiedTable`'s. Use **`FacetedDecisionTable`** when rows carry a slash-path taxonomy that should become a left group-rail. Define columns in a `useXColumns()` hook in a sibling `*Columns.tsx`, translate every `label`/`emptyTitle`/`emptyDescription`, and pass a **stable** `getRowKey`. Then stop: no skeleton, no empty state, no sort handler, no stagger, no pagination bar. And do **not** reach for `layout/ListSkeleton` or `layout/TableSkeleton` — they default to the banned `animate-pulse` and are the single largest manufacturer of deviations in this repo.

## Mandated primitives

- **`shared/components/display/UnifiedTable.tsx`** — `UnifiedTable<T>` + `TableColumn<T>`, the canonical list primitive (817 lines). Sort persisted per `tableId`, per-column dropdown filter / inline search / custom `filterComponent`, virtualization via `rowHeight`, `groupBy` sticky group headers, `rowAccent`, keyboard row nav when `onRowClick` is set, `scrollRestoreKey`, `onEndReached`, three-state body at `:593-612`.
- **`.../display/DataGrid.tsx`** — `DataGrid<T>` + `DataGridColumn<T>` + `DataGridBulkAction`. Pagination with page-size selector, `selectAll`/`isRowSelected`/`selectedCount`/`bulkActions` + floating bulk toolbar (Esc clears), `getRowProps`/`draggingRowKey` for HTML5 drag, `simplified` tier mode. **Sorting is caller-owned** — pass `sortKey` + `sortDirection` + `onSort`.
- **`.../display/FacetedDecisionTable.tsx`** — derived slash-path group rail + search + `DataGrid`. Domain-agnostic; labels injected via `FacetedDecisionTableLabels`.
- **`.../display/facetedTableModel.ts`** — `buildGroupTree` / `itemsUnderGroup` / `searchItems`. React-free, unit-tested.
- **`.../display/grouping.ts`** — `timeGroupKey(ts)` + `timeGroupLabels(t)` for `groupBy`.
- **`.../display/SortableHeader.tsx`** — `aria-sort` + 150ms caret; used internally by `DataGrid`. Use directly only inside a genuinely legitimate `<table>`.
- **`useRowRevealEntrance` / `resolveRowReveal`** (`UnifiedTable.tsx:221` / `:248`) — the id-guarded one-shot cascade, shared by both primitives (`DataGrid.tsx:204`).
- **`.../display/RevealItem.tsx` + `useRevealTracker`** — **only** for genuinely non-tabular lists. The tracker lives in a `useRef`, so a remount wipes it and replays the cascade.
- **`.../layout/RouteChunkSkeleton`** — the `Suspense` fallback for a lazy route containing a table. Never `fallback={null}`, never a spinner.

## Steps

1. **Pick the primitive.** Pagination / checkbox selection / bulk actions → `DataGrid`. Slash-path taxonomy → `FacetedDecisionTable`. Everything else → `UnifiedTable`.
2. **Write the row type**, not a `<tr>` (e.g. `CredentialListColumns.tsx:13`).
3. **Put columns in a `useXColumns()` hook in a sibling `*Columns.tsx`** — the established convention (`useCredentialColumns` at `CredentialListColumns.tsx:52`, `PersonaOverviewColumns.tsx:74`). Return `useMemo<TableColumn<T>[]>`; call `useTranslation()` **inside the hook**.
4. **Per column supply exactly** `key`, `label` (translated), `width` as a CSS grid track (`'minmax(180px, 2fr)'`, `'96px'`, `'1fr'`), `render: (row, index) => ReactNode`. Add `sortable: true` + `sortFn` for anything non-lexicographic; `align: 'right'` for numerics. Render numerics via `display/Numeric`, timestamps via `display/RelativeTime`, statuses via `display/StatusBadge` + `tokenLabel()`.
5. **Wire filters into the column, not above the table** — `filterOptions` + `filterValue` + `onFilterChange`, or `filterComponent` for bespoke controls (`EventLogList.tsx:152-159`).
6. **Render in this prop order:** `columns → data → getRowKey → onRowClick → isLoading → rowHeight / density / borderless / stickyHeader / className → defaultSortKey / defaultSortDir` (DataGrid: `sortKey / sortDirection / onSort / pageSize`) `→ tableId / scrollRestoreKey → emptyTitle / emptyDescription / emptyGlyph → ariaLabel → rowAccent / rowReveal → groupBy / onEndReached`.
7. **Pass `isLoading` as the real in-flight flag, nothing else.** `isLoading && data.length === 0` → ghost; `!isLoading && data.length === 0` → empty state; else rows. Passing it also auto-enables the cascade via `resolveRowReveal`. Never `isLoading={false}`; never dim or remount the table while loading.
8. **`getRowKey` must be stable and data-derived** — it drives reconciliation *and* the reveal id-guard.
9. **Set `tableId`** on any long-lived user-facing table (unlocks column resize + sort persistence free). Set `scrollRestoreKey` (route + entity + filters) on virtualized tables in routes that unmount.
10. **Stop.** No skeleton component, no `EmptyState` wrapper, no `.sort()`, no `.slice()`, no `RevealItem`, no `animate-pulse`, no `<thead>`.

## Anti-patterns

- **Reaching for `layout/ListSkeleton` or `layout/TableSkeleton`** — both default to the banned pulse (`ListSkeleton.tsx:34`, `TableSkeleton.tsx:53`). `ListSkeleton`'s own `@catalog` line advertises "**shimmer** placeholder rows for a list/table body" while its JSDoc five lines later says pattern v2 forbids exactly that. A developer following the catalog gets the banned treatment by default.
- **Writing `<table>` for a flat list of records** — 23 of the 27 non-markdown `<table>`s in `src/features/**` are flat lists with fixed columns. The grid model expresses all of them and deletes the header/body alignment hacks `<table>` forces.
- **The `const GRID = 'grid grid-cols-[...]'` idiom** — `UnifiedTable`'s column model retyped as a string, no type safety, two places to drift. At least 8 instances.
- **Hand-writing `role="table"` / `role="row"` / `role="columnheader"` divs** — `UnifiedTable` gives you `role="table"` from `ariaLabel`. Exactly 6 files contain `role="columnheader"`; 4 are hand-rolled div-tables and 2 are `SortableHeader` + its test, making this the cleanest possible lint signal.
- **Hand-rolling a ghost/skeleton for a list** — 110 local `*Skeleton`/`*Ghost`/`*GhostRows` components in `src/features/**` (40 of them `*GhostRows`). Three sit in files that *already render the primitive*.
- **`animate-pulse` anywhere near data** — banned by law 3. 223 matching lines across 174 files; ~107 are live `className` applications.
- **Hand-rolling sort state** — 16 files carry their own sort state alongside a `.sort(`; at least five reimplement the identical "same field → flip dir, else reset to desc" logic the primitives encode.
- **Hand-rolling pagination** — 17 files. `DataGrid`'s `pageSize` includes the clamp-don't-reset behaviour (`DataGrid.tsx:168-174`) that hand-rolls get wrong.
- **Hand-rolling the row cascade** — `useRowRevealEntrance` is exported from `UnifiedTable.tsx:221` precisely so siblings share it; inside either primitive you get it from `isLoading` alone.
- **Remounting or dimming the table while loading** — `ActivityList.tsx:170-171` does `key={isLoading ? 'loading' : 'ready'}` + `opacity-60`. The remount wipes the reveal tracker's ref so the cascade replays every fetch; the dim violates law 1.
- **A non-deterministic `getRowKey`** — `GroundingTable.tsx:76` uses `row.file ?? Math.random().toString(36)`.
- **Sort chrome wired to nothing** — `LiveStreamTab.tsx:455` has `onSort={() => {}}` beside `sortKey="created"`.
- **Omitting `emptyTitle`** — both primitives default to hardcoded English `'No data'`; `DataGrid.loadingLabel` defaults to `'Loading...'`. Five call sites ship untranslated English this way.
- **Returning `null` instead of an empty state** — `SensorScoreboard.tsx:46`, `RevitalizeHistoryTable.tsx:48`: the section vanishes mid-fetch, violating law 5.
- **Replacing the header with a spinner while loading** — `ColumnList.tsx:25-32`. Ghosts go *under* permanent chrome.
- **Defining a parallel column type** — `LabHistoryTable.tsx:8-13` exports a weaker `TableColumn<T>`.

## Evidence

**Adoption:** 24 canonical surfaces — 17 `<UnifiedTable>` renders across 16 files, 4 direct `<DataGrid>` feature sites (+1 internal), 3 `<FacetedDecisionTable>` sites.

- `UnifiedTable.tsx:1-26` — the primitive's own contract: "*don't build a table skeleton or an entrance animation — pass `isLoading` and `data` and get all five laws.*"
- `UnifiedTable.tsx:593-612` — the three-state body in ~20 lines. This is what every hand-roll reimplements.
- `UnifiedTable.tsx:248-258` — `resolveRowReveal`: passing `isLoading` implies the cascade; `rowReveal={false}` opts out.
- `triggers/sub_shared/SharedEventsTab.tsx:147` — **the most complete call site; copy this one.** Every prop wired and ordered.
- `overview/sub_observability/components/AthenaSpendSection.tsx:141` — clean, minimal, fully translated.
- `agents/sub_lab/components/versions_table/LabVersionsTable.tsx:325` — correct `isLoading={loading && rows.length === 0}` plus semantic `rowAccent`.
- `overview/sub_events/components/EventLogList.tsx:147-267` — richest column defs in the repo, with `groupBy` (`:138-145`) and `onEndReached` (`:480`).
- `vault/sub_credentials/components/list/CredentialList.tsx:145` — **the exemplary `DataGrid` site**, with a correctly settled-gated rich empty state at `:127`.
- `vault/sub_credentials/components/list/CredentialListColumns.tsx:52` — the `useXColumns()` convention.
- `overview/sub_manual-review/components/backlog/BacklogTable.tsx:194` — exemplary `FacetedDecisionTable`, fully translated labels with interpolating `summary` functions.
- `overview/sub_patterns/KnowledgeTree.tsx:355` — the bulk-action path through to `DataGrid`'s floating toolbar.

## Deviations found

### P0 — the shared-layer root cause (fix first; upstream of ~100 files)

| Path | What's wrong |
|---|---|
| `shared/components/layout/ListSkeleton.tsx:34` | `calm` defaults to `false`, so the shared list skeleton emits `bg-primary/10 animate-pulse` by default — the treatment law 3 bans. Its `@catalog` line sells "shimmer" as house style. **Invert the default.** |
| `shared/components/layout/TableSkeleton.tsx:53` | Same inverted default. Both are cited by local skeletons as the pattern to copy. |

### Hand-rolled `<table>` — migrate (23)

| Path | What's wrong |
|---|---|
| `agents/components/allPersonas/PersonaConfigPanel.tsx:445` | **Top priority.** Per-cell `animate-pulse` at `:508`, three hand-rolled `<td colSpan>` states (`:458`/`:465`/`:472`), hand-rolled search + filter chrome. |
| `vault/sub_databases/QueryResultTable.tsx:82,:123` | **Biggest structural win.** Two `<table>`s + shared `<colgroup>` + `tableLayout:'fixed'` purely to align a virtualized body to a fixed header — a hack that exists *only* because it is a `<table>`. |
| `agents/sub_deployment/components/DeploymentTable.tsx:81` | Uses shared `SortableHeader` yet still hand-rolls `DeploymentGhostRows` (`:282`), the cascade, and select-all — all `DataGrid` props. |
| `vault/sub_credentials/components/features/AuditLogTable.tsx:86` | Pagination rebuilt end to end (`:36` slice, `:119-141` prev/next, `:41-43` clamp effect). No loading state. |
| `overview/sub_leaderboard/components/LeaderboardMatrixView.tsx:140` | Not a pivot. Hand-rolled sort (`:105`) and a line-by-line re-implementation of `useRowRevealEntrance` at `:172-183`. Only blocker: the dashed fleet-average footer (`:218`). |
| `templates/sub_recipes/components/RecipesTableResults.tsx:96` | Hand-rolled sort + 25-line comparator + local `Th`. **No empty state at all** — blank `<tbody>` at zero rows. |
| `templates/sub_explore/level2/DomainTable.tsx:98` | Hand-rolled sort, local `Th`, ghost rows whose geometry doesn't match, hardcoded English. |
| `plugins/fleet/sub_monitor/MonitorLedger.tsx:58` | Lane headers via `<td colSpan>` — exactly `groupBy`. Doc promises sortable columns; **no sort exists**. |
| `teams/sub_kpis/KPIProposalsQueue.tsx:77` | Hand-rolled ghost rows and cascade; both free from `isLoading` + `data`. |
| `overview/sub_sla/components/SLACard.tsx:60` | Nine hardcoded columns. No loading, empty, or sort on a fleet-comparison surface. |
| `agents/sub_lab/components/shared/LabHistoryTable.tsx:60` | Exports a parallel column primitive. Migrate **and delete the type**. |
| `vault/sub_databases/tabs/ColumnList.tsx:53` | Loading replaces the whole table *including the header* with a spinner (`:25-32`). |
| `agents/sub_lab/components/versions_table/LabEconomicsPanel.tsx:44` | **No loading state** despite async `fetchEconomics`. |
| `plugins/obsidian-brain/sub_revitalize/RevitalizeHistoryTable.tsx:63` | `:48` `if (runs === null) return null` — the section disappears during fetch. |
| `plugins/dev-tools/sub_triage/findings/SensorScoreboard.tsx:58` | `:46` returns `null` instead of an empty state. No sort, no loading. |
| `vault/shared/vector/extract/EntityTable.tsx:23` · `agents/sub_model_config/components/compare/CompareResultsTable.tsx:75` · `settings/sub_engine/components/PolicyProposalsSection.tsx:181` | Textbook fixed-column tables; no loading/empty/sort. |
| `teams/sub_factory/l2/FactoryOverviewTab.tsx:151` | Duplicates `KPIProposalsQueue`'s exact columns with a **second** set of hardcoded English strings. |
| `vault/shared/playground/ResponseViewer.tsx:113` | Two-column key/value list wearing a table; should be `<dl>`. |
| `scraper/PreviewResults.tsx:25` | `<table>` with a `<tbody>` and **no `<thead>`**. The `<table>` itself is the bug. |
| `scraper/ScraperControlRoom.tsx:70` · `plugins/twin/sub_tone/ToneConsole.tsx:125` | **Blocked** on expand-row panels (see Gaps #2); `ToneMatrixGhostRows` (`:276`) is a verbatim copy of `TableGhostRows` down to the `120 + i*35` delay. |

### Div-grid surfaces that reimplement the primitive

| Path | What's wrong |
|---|---|
| `settings/sub_byom/components/ByomAuditLog.tsx:105-118` | The purest case: hand-written `role="table"`/`role="row"`/six `role="columnheader"` divs over a `GRID_COLS` const **plus its own `@tanstack/react-virtual` virtualizer** (`:80`). This is `UnifiedTable`, retyped. |
| `overview/sub_activity/components/GlobalExecutionList.tsx` | **The loading doc's own reference implementation is a 608-line hand-rolled div table** — manual `EXEC_COLUMNS` (`:43`), six `role="columnheader"` divs, tri-state sort toggle, `RevealItem` cascade, `ActivityGhostRows`. Only genuine blocker: the mobile-card / desktop-row dual layout (Gaps #4). |
| `overview/sub_incidents/components/IncidentTableHeader.tsx:52-54` | An entire separate header component exists solely to reimplement the column header band, plus own tracker and ghost rows. |
| `overview/sub_messages/components/MessageList.tsx:212,:362` | Own header row, own virtualizer, own ghost rows, own reveal slice — next to an adopting sibling (`EventLogList`). |
| `overview/sub_memories/components/MemoriesPageDense.tsx:75-76,:135,:335` | A **third** parallel column model: local `COL_WIDTHS` + local `SortHeader` + own sort state + own ghost rows. |
| `plugins/dev-tools/sub_skills/analytics/SkillScoreboard.tsx:136,:152` · `SkillHistoryTable.tsx:13` · `SkillsManagerBoard.tsx:35,:37` | The `const GRID` idiom; `SkillHistoryTable` adds a homegrown reveal-paging scheme; `SkillsManagerBoard` carries *two* grid consts for two hand-built tables in one file. |
| `overview/sub_director/components/PersonaCoachingTable.tsx:17,:86,:143` · `teams/sub_factory/KpiTable.tsx:63,:85` · `ContextMatrix.tsx:44,:72` · `plugins/dev-tools/sub_context/ContextLedger.tsx:100,:194` · `teams/sub_goals/GoalTaskTable.tsx:39,:54` · `teams/sub_factory/passport/improve/QuickDispatchLedger.tsx:58` | Column model hand-computed and re-applied per row; header and rows can silently drift. `GoalTaskTable` re-sorts inline in render on every unrelated re-render. |
| `overview/sub_manual-review/components/ManualReviewList.tsx:537` | Own ghost rows — while sibling `BacklogTable.tsx` in the same feature correctly uses `FacetedDecisionTable`. |

### Hand-rolled pagination

- `vault/sub_credentials/components/features/AuditLogTable.tsx:23,:28,:35-36,:119-141` — `DataGrid`'s `pageSize` rebuilt from scratch, clamp effect included.
- `overview/sub_patterns/graph/ClusterPatternsModal.tsx:234,:239,:261,:326-338` — `PAGE = 8` + page state + slice + clamp + prev/next, **plus** a sort dropdown and search that each reset the page. A full `DataGrid` reimplemented inside a modal. *(Already slated for deletion in the pattern-fabric v2 UI phase.)*

### Stale-doctrine surfaces — the primitive caught up, the call site didn't

`889a5204a feat(shared): UnifiedTable bakes in the full cold-load contract` landed **2026-07-30**. These were touched *after* it and still hand-roll what it provides, with comments asserting limitations that no longer exist:

- `overview/sub_events/components/EventLogList.tsx:465` — passes `isLoading={false}` and renders its own ghost rows; the comment at `:453-459` claims "*UnifiedTable doesn't expose a row-level entrance cascade hook*" **on the very element that passes `rowReveal={{ resetKey }}`**.
- `overview/sub_activity/components/LlmCallsTable.tsx:332-338` — module doc (`:36-41`) claims no prop exists "*to inject a per-row `RevealItem` cascade*"; `:344` passes `rowReveal`. Its ghost rows duplicate `TableGhostRows`.
- **`docs/design/overview-loading.md:99-106`** — the "Lists & tables" recipe still instructs authors to build a module-local `<XyzGhostRows>` and to "*report the cascade gap*". **Obsolete and actively producing new deviations.** Rewrite to: pass `isLoading` + `data`.

### Correctness defects at otherwise-canonical call sites

- `overview/sub_certification/components/GroundingTable.tsx:76` — `getRowKey` using `Math.random()`.
- `agents/sub_activity/ActivityList.tsx:170-171` — loading `key` remount + `opacity-60` dim.
- `triggers/sub_live_stream/LiveStreamTab.tsx:455` — clickable, inert sort chrome.
- Untranslated default `'No data'`: `GroundingTable`, `LlmOverviewPage`, `ProjectManagerPage`, `RecipeOverviewTab`, `PersonaOverviewPage`.
- Missing `isLoading` on fetching surfaces: `RunHistoryView`, `PersonaOverviewPage`, `ProjectManagerPage` — no ghost, and the empty state can flash before the first fetch resolves.

### Legitimate `<table>` — leave them (4)

`templates/sub_generated/gallery/modals/CompareModal.tsx:139` (transposed: rows are the schema, columns are runtime-N templates) · `settings/sub_engine/components/EngineSettings.tsx:60` (frozen first column in a horizontally scrolling matrix) · `plugins/dev-tools/sub_skills/trace/TraceOverview.tsx:50` (runtime-N project columns + a genuine `<tfoot>` of 30-day totals) · `agents/sub_lab/components/arena/ArenaResultsView.tsx:290` (scenario × model pivot where columns *are* data; still fix its hand-rolled empty state at `:134-138`).

## Gaps in the primitive

1. **No primitive does both feature sets — the headline gap.** `UnifiedTable` has zero of `pageSize`/`selectAll`/`isRowSelected`/`bulkActions`/`getRowProps`. `DataGrid` has zero of virtualization/`useColumnWidths`/`groupBy`/`scrollRestoreKey`/keyboard nav/`tableId`/`onEndReached`. Both verified by grep returning empty. A surface needing pagination *and* virtualization, or grouping *and* bulk selection, has **no correct choice** — `ByomAuditLog` and `MessageList` both fell into this hole and reimplemented virtualization by hand.
2. **No expand-row / detail-row slot.** Direct cause of two blocked migrations (`ScraperControlRoom.tsx:225`, `ToneConsole.tsx:201`). A `renderExpandedRow?: (row: T) => ReactNode` + `expandedKeys` unblocks both.
3. **No footer / aggregate row.** Blocks `LeaderboardMatrixView.tsx:218`; the one legitimate part of `TraceOverview.tsx:133`.
4. **No responsive card mode** — only per-column `hideOnMobile`. `GlobalExecutionList` stays hand-rolled largely for this.
5. **`FacetedDecisionTable` has no `isLoading` pass-through.** It never forwards a loading flag to the `DataGrid` at `:181`, so `KnowledgeTree`, `BacklogTable` and `DispatchTable` are *structurally incapable* of showing the cold-load ghost. **One-line fix.**
6. **`UnifiedTable` sorting cannot be controlled or lifted.** Sort state is internal (`:470-471`); no `sortKey`/`onSort` prop. Server-side sort, URL-synced sort, or sort shared with sibling chrome forces `DataGrid` (losing virtualization) or a hand-roll.
7. **English defaults leak** — `emptyTitle = 'No data'` (`UnifiedTable.tsx:442`, `DataGrid.tsx:127`) and `loadingLabel = 'Loading...'` (`DataGrid.tsx:125`). These should have no default, forcing the caller to translate.
8. **Transposed / pivot layouts are out of scope** — correctly, but undocumented, so authors reach for `<table>` and keep reaching for it for the flat table next door.
9. **Zero enforcement.** 21 custom ESLint rules exist, including `custom/enforce-base-modal` for modals — **none** covers tables. Highest-leverage fix: `custom/prefer-unified-table` flagging `<table>`+`<thead>` and `role="columnheader"` in `src/features/**`, with an allowlist for the 4 legitimate pivots. The `role="columnheader"` signal is near-perfect — 6 files, 4 true positives.
10. **Zero tests.** `display/__tests__/` covers `facetedTableModel`, `grouping`, `SortableHeader`, `Numeric` — but neither `UnifiedTable` nor `DataGrid`. The three-state loading body, sort persistence and the id-guard have no regression coverage.
11. **Documentation gaps that cause the drift.** (a) `DataGrid` has **no `@catalog` JSDoc tag**, so its generated row in `CATALOG.md:45` reads `"CSS grid fraction, e."` — a truncated fragment of an unrelated prop comment. The catalog CLAUDE.md mandates consulting describes the pagination/selection primitive as gibberish. (b) `docs/refactor/shared-component-reuse.md` §5 has families for empty states, badges, errors, counts, headers, time and pickers — **no table family row**, despite three primitives with disjoint capabilities. (c) `.claude/Design.md:295`'s don't-hand-roll table omits tables entirely.

> **Corrections pass — 2026-08-13 · catalog mechanism.** An earlier version of
> this document said the `LoadingSpinner` row in `CATALOG.md` comes from the
> component's missing `@catalog` tag. **That is wrong.**
> `scripts/docs/gen-shared-catalog.mjs:92-96` — `describe()` returns
> `CURATED[name]` and only falls through to a `@catalog` tag when the name is
> absent from that map. `LoadingSpinner` IS in `CURATED`, so adding a tag to the
> component would appear to work and change nothing. The row was fixed at its
> real source (the `CURATED` map) and the catalog regenerated.
