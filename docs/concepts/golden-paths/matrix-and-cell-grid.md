# Golden path — Matrix and cell grid

> Situation node: `product-surfaces/lists-and-tables/matrix-and-cell-grid` (recurrence 14, risk medium) ·
> [situation spine](../situation-spine.md)
> Composed 2026-08-17 at `de274d14d`. Sweep: **2,083 `.tsx`** files walked twice by two
> purpose-built scanners with *different anchors* — (A) a brace/paren-matched nested-`.map`
> walker that finds a `.map` whose callback body contains another `.map` emitting JSX, and
> (B) a CSS-signal walker keyed on `gridTemplateColumns` / `repeat(${…})` / per-cell ink
> functions — plus full reads of `RegistryHeatmap` + both its model hooks, `ExecutionHeatmap`,
> `ContextMatrix`, `ContextLedger`, `ContextPickerCrossTab`, `StatusPageView` +
> `compositeHealthScore` + `useStatusPageData`, `LeaderboardMatrixView`, `WallCompareTable`,
> `TraceOverview`, `MonthView`/`WeekView`, `ArenaResultsView`, `SLACard`, `MessageList`,
> `UnifiedTable`, `DataGrid`, `FacetedDecisionTable`; an ARIA-role census of all 2,083 `.tsx`;
> a census-runner validation of two candidate rules and their controls; and a read-only
> replay against the **2026-08-17 purge backup** (`purge-backup-2026-08-17/personas.db`).
> Dimensions: **ui · performance · function**.
> **Settles:** how a dense N×M grid of cells gets its rows, its columns, its per-cell ink and
> its per-cell identity — and what a cell must carry so that the thing under the cursor is the
> thing the user thinks it is.
>
> **Denominator note.** [`shared-facts.json`](../shared-facts.json) records
> `frontend.tsxFiles = 2,104` and `frontend.tsFiles = 4,829` at `2ee130c3e`. At HEAD
> (`de274d14d`, 27 commits later) four independent instruments — this composer's walker, the
> census engine's own walk, `find`, and `git ls-files` — all return **2,083** and **4,801**.
> `git ls-tree -r 2ee130c3e` reproduces 2,104/4,829 exactly, and
> `git diff --diff-filter=D 2ee130c3e..HEAD` shows **21 `.tsx` deleted and 0 added** (29
> `.ts`/`.tsx` deleted, 1 added). The fact was right when taken; it is 21/28 files stale now,
> **and the denominator moved by deletion, not by work** — the same shape
> [`expandable-row.md`](./expandable-row.md)'s post-publication note warns about. Every count
> below uses HEAD's 2,083.

---

## §0 — The headline

**The most common way this repo loses a cell's identity is not at the `key=`. It is one layer
up, in a projection that maps a record carrying a date onto an array element that cannot hold
one.**

`compositeHealthScore.ts:312-316` declares its input as *"30 entries, most recent last. Each
has **date** + per-persona success info."* Twenty-two lines later, `:375-379` projects those
entries to `dailyStatuses: DayStatus[]` — a bare array of a 4-variant enum. **The date is
dropped at the type.** The pad at `:382-384` then does `unshift('no-data')` until the array is
30 long, which is correct only if the missing days are the oldest ones and the series has no
interior gap.

By the time `StatusPageView.tsx:144-145` renders the strip, there is nothing left to key by,
so it keys by position — `<UptimeBar key={i} status={status} index={i} …/>` — and it hands the
component the index *as content*: the cell's entire human-readable label is
`title={`Day ${index + 1}: …`}` (`:190`). **A status page whose only subject is which day
something broke names its cells "Day 1", "Day 17", "Day 30", and cannot say which dates those
are.** No `key={…}` edit fixes that. The identity was destroyed before the renderer saw it.

The corpus's rule follows: **a cell must arrive at the renderer already carrying the coordinate
that identifies it.** Not derivable, not implied by position in an array — carried, in the
element's own type.

Two supporting measurements, both from this sweep:

- **This repo already knows how to do it.** `ExecutionHeatmap.tsx` — the calendar heatmap, same
  visual family, same "one cell per day" job — projects to `FilledDay { date, count, … }` and
  keys `key={day.date}` (`:368`), then derives *one* readout function
  (`dayLabelText`, `:405`) used by both the hover tooltip and the cell's `aria-label`, so a
  keyboard user is told exactly what a mouse user is told. The difference between the two
  surfaces is **not care at the render site**; it is one type declaration, 200 lines upstream.
- **Position-keying is otherwise rare in real grids.** Of the sixteen genuine N×M cell grids
  enumerated below, **fourteen key their cells by an id** — including composite ids
  (`` `${s.name}|${c.id}` ``, `RegistryHeatmap.tsx:111`) and coordinate objects
  (`{ scenario, model }`, `ArenaResultsView.tsx:126`). The two that do not are
  `StatusPageView.tsx:145` and `QueryResultTable.tsx:131,154`, and in both cases the reason is
  the same: **the model handed the view an array of scalars.**

---

## §0.1 — Corrections to the brief, stated first

The brief supplied three leads. **One was right, one was inverted, and one is unmeasurable as
stated.**

**1. "Do not re-propose virtualization without measuring" — upheld, and sharpened.**
The brief cited `project_monitor_perf_heap_hardening`'s finding that `ExecutionList`
virtualization was a false positive. It is upheld here for a different reason than the brief
gives: a cell grid's cost is **rows × columns**, and the repo's own answer is not
virtualization but **progressive mounting**. `RegistryHeatmap.tsx:45-48` calls
`useProgressiveReveal(skills.length, { initialCount: 10, resetKey: `${mode}:${columns.length}` })`
with the reasoning written down at `:41-44`: *"a workspace of 20 skills × 10 projects
big-banged 200+ interactive cells onto one frame."* That is the correct instrument for a grid,
because a windowed *row* list still mounts every column of every visible row, and the column
count is the axis that grows. Virtualization is row-shaped; the problem is area-shaped.

**2. "A grid that recomputes its column set every render" — inverted.**
Measured across the sixteen grids: **thirteen memoize or module-freeze their column set**
(`useSkillsRegistry.ts:157`, `useProjectRegistry.ts:125`, `ProjectsPassportWall.tsx:91`,
`leaderboardRanking.ts:26`, `factoryModel.ts:266`, `scanAgents.ts:21`, `ArenaResultsView.tsx:122`,
`ExecutionHeatmap.tsx:210`, …). **Three build it in the render body**, and two of those three
build a *string* (`RegistryHeatmap.tsx:60`, `ContextPickerCrossTab.tsx:32`) whose cost is a
template interpolation. **Only one rebuilds an array of closures per render**:
`CompareModal.tsx:30`, `const dimensions: {…; signature: (col) => string; render: (col) => ReactNode}[] = […]`.
So the brief's hazard exists exactly once in sixteen, and reporting it as a class would have
been wrong. It is filed as [§7-E](#e-comparemodaltsx30--the-only-grid-that-rebuilds-its-column-closures-every-render).

**3. "A selection model stored by position rather than by id" — does not exist here.**
Measured: of the sixteen grids, **eight hold no selection/hover state at all**, **seven hold it
as an id, a composite id string, or a coordinate object**, and **one holds a per-row boolean**
(`StatusPageView.tsx:129`). **Zero store a row/column number.** The nearest thing in the tree is
`UnifiedTable.tsx:544`'s `focusedIndex`, which [`expandable-row.md`](./expandable-row.md)
already owns and already published; it is a keyboard cursor in a *table*, not a grid selection,
and re-reporting it here would be a second document on one defect. The brief's third lead is a
**cleared claim**, reported as such rather than softened.

**4. The brief's `UnifiedTable` lead contains a question that cannot be asked.**
It asked "how many pass `isLoading` but not `data`, or vice versa." `data: T[]` is a
**required** prop (`UnifiedTable.tsx:100`; likewise `columns` `:99` and `getRowKey` `:101`),
so *"`isLoading` without `data`"* is a compile error — the state is unrepresentable and the
count is necessarily zero. The answerable half is the other direction, and it is worth having:
**8 of 17 `<UnifiedTable>` call sites omit `isLoading`**, and `resolveRowReveal`
(`:253-263`) returns `undefined` when both `rowReveal` and `isLoading` are absent — so
**7 of 17 get neither the ghost branch (`:598`) nor the row cascade**, i.e. the three-state body
the primitive exists to provide is inert at 41% of its call sites. Two independent
implementations (the `matchJsxTags` instrument and a bespoke brace/quote parser) agreed
exactly on 17 / 6 / 3 sites and on every prop flag. **Both were also wrong the same way**:
both counted `Numeric.tsx:24`, which is `<DataGrid>` inside a **JSDoc comment**. Hand-opening
it is what found it, and [`long-list-rendering.md`](./long-list-rendering.md)'s "22 call sites"
(= 17 UnifiedTable + 5 DataGrid) independently confirms the exclusion. Its `17 in 16 files —
6 pass rowHeight` reproduces here **exactly**. This belongs to `tables.md` /
`long-list-rendering.md`, not to this leaf; it is recorded because the brief asked.

---

## §1 — Principle (stack-free head)

Per the [portability test](../research/portability-test.md), the head carries no file path,
primitive name or count, and each clause carries the warrant that lets an adopting repo tell
physics from local taste.

> **P1 — physics.** *A cell's coordinate is data, not geometry.* Whatever identifies a cell to
> a human — a date, a (row-entity, column-entity) pair, a bucket boundary — must be a field on
> the value handed to the renderer. Warrant: every projection that reduces a record to a scalar
> forces the renderer to reconstruct identity from position, and position is the one property
> that changes when the collection is filtered, sorted, padded, or windowed. Independently
> rediscovered in this repo by `ExecutionHeatmap` and `RegistryHeatmap`, which reached the same
> shape (`{date, …}` / `{skill, column}`) by different routes.
>
> **P2 — physics.** *Padding a sparse series to a fixed width is a lie unless the pad carries a
> coordinate.* A gap-filler inserted at one end silently shifts every cell on the other side of
> an interior gap. Warrant: the failure is invisible — the strip still has the right number of
> cells and the right colours — and it is only detectable by comparing a cell to a calendar,
> which is exactly what the missing coordinate would have let you do.
>
> **P3 — physics.** *Ink encodes a quantity; the quantity must also be readable.* A colour ramp
> is a summary, not a value. Warrant: colour is unavailable to a screen reader, unreliable
> under colour-vision deficiency, and unmeasurable by eye beyond ~4 steps — so a grid whose
> only channel is ink has no accessible content at all.
>
> **P4 — physics.** *A dense grid must not put every cell in the sequential tab order.* An
> N×M grid of focusable cells costs N×M tab presses to traverse and to escape. Warrant: this is
> arithmetic, not convention — the cost grows with the product of both axes while the user's
> patience does not. The published answer everywhere is two-dimensional arrow-key navigation
> with a single roving tab stop.
>
> **P5 — local calibration (house convention).** *Mount a large grid progressively rather than
> windowing its rows.* Warrant: a grid's cost is area, and row windowing only bounds one factor.
> This clause has **no trace in any sibling repo** — no sibling has a grid of this density at
> all — so it is labelled a house convention rather than doctrine, per the doctrine's silence
> rule.

---

## §2 — The one way

Build the grid as **two id-bearing axis arrays and one O(1) cell lookup**, and never as a
nested loop over raw data. Concretely: memoize `rows: RowT[]` and `columns: ColT[]` where each
element carries its own stable id; memoize a `cell(rowId, colId) => CellT` closure over
pre-built `Map`s so the render is O(rows × cols) map lookups and not O(rows × cols × n) scans;
give every cell a `key` composed from the two axis ids (`key={col.id}` inside a row keyed by
`row.id` is sufficient and is what the exemplar does); store hover/selection as **the same
composite identity you keyed by**, never as a row or column number; render each cell's value as
**text as well as ink**, and derive the cell's `aria-label` and its tooltip from **one**
function so the keyboard and the mouse are told the same thing; and if the grid is interactive,
make the whole grid **one tab stop** with arrow-key movement rather than N×M tab stops. When
the grid exceeds a few hundred cells, stagger the *mounting* of rows with
`useProgressiveReveal` rather than reaching for row virtualization — the axis that grows is
usually columns, which windowing does not bound. **And before any of that: check that the value
you are about to map over still carries the coordinate that names it.** If the projection
upstream turned records into scalars, fix the projection; nothing you do in the renderer can
recover what the type no longer holds.

---

## §3 — Mandated primitives

| Use | What it gives you |
|---|---|
| `hooks/utility/interaction/useProgressiveReveal` | Hands rows to the renderer across a short window instead of mounting the whole area on one frame; takes a `resetKey` so an axis change restarts the reveal. The grid answer to density. Reference use: `RegistryHeatmap.tsx:45-48`. |
| `features/shared/components/display/Tooltip` | The cell readout. **Not `title=`** — a native tooltip is unreachable by keyboard, unstyleable, and delayed by the OS. `RegistryHeatmap.tsx:69` uses it on column headers; the deviations below are the cells that use `title=` instead. |
| `features/shared/components/display/Numeric` | The *readable* half of P3 when the cell's value is a number. Never `.toFixed()` in a cell. |
| `features/shared/components/display/StatusShape` / `StatusDot` | Encodes status by **shape as well as colour**, which is P3's answer for a categorical ramp. |
| `features/shared/components/display/UnifiedTable` (`columns` + `data` + `getRowKey` + `isLoading`) | When the "matrix" is really a table whose columns are fixed and whose cells are values — i.e. `LeaderboardMatrixView`, `SensorScoreboard`, `SlaMatrixTable`. It owns sorting, the ghost-under-header load state, the settled empty state and the id-guarded row cascade from two props. Reach for a hand-built grid **only** when the column set is data-derived. |
| `features/shared/components/display/IllustratedEmptyState` (`variant="heatmap"`) | The settled empty state for a grid with no data. `TraceOverview.tsx:145-149` and `ExecutionHeatmap.tsx:251` both use it. |
| `features/shared/components/display/grouping.ts` (`timeGroupKey`) | When the column axis is time buckets, use the shared bucketer — it is local-time-correct. (See [`chronological-feed.md`](./chronological-feed.md) §7 for the one place a local re-implementation got this wrong.) |

There is no `Grid` primitive in `shared/components/`, and this path does **not** invent one —
see [§8 Gaps](#8--gaps).

---

## §4 — Steps

1. **Name the two axes as data, and give each element an id.** Rows and columns are both
   arrays of records. If either axis is currently "an array of strings" or "an array of
   numbers", stop and widen it — that is the §0 defect, caught early.
2. **Ask whether the primitive's signature can make the wrong call impossible** (contract,
   "prefer a type over a gate"). For this leaf the answer is usually yes and the edit is one
   line: a cell array typed `Array<{ id: string; … }>` instead of `Array<Scalar>` removes the
   whole position-keying class at every consumer at once. See §9-T1.
3. **Memoize both axes and the lookup.** `columns` and `rows` in `useMemo`; a `cell(rowId,
   colId)` closure over `Map`s, also in `useMemo`. The exemplar builds five `Map`s in one
   effect (`useSkillsRegistry.ts:91-138`) so the render does no scanning at all.
4. **Compute the CSS track from the memoized column count**, not from raw data:
   `` `minmax(11rem,1fr) repeat(${columns.length}, ${COL})` ``. A template string per render is
   fine; an array of closures per render is not.
5. **Render the header row with the column axis, keyed by column id.** If the column labels are
   long, rotate them (`writingMode: 'vertical-rl'`) rather than widening the track —
   `RegistryHeatmap.tsx:30,77`.
6. **Render each row keyed by row id, and each cell keyed by column id.** The pair
   `key={row.id}` × `key={col.id}` is a composite key by construction. Where a cell component
   is hoisted out of its row, key it by the composite string explicitly.
7. **Put the value in the cell as text, and the ink as background.** `pct}%` on a tinted
   button, not a tint alone (`RegistryHeatmap.tsx:121,126`).
8. **Write ONE readout function** returning the cell's human sentence, and use it for both the
   tooltip and `aria-label`. `ExecutionHeatmap.tsx:405-…` (`dayLabelText`) is the model; it is
   called at `:387` for the label and by the tooltip renderer for the hover card.
9. **Decide the focus model before adding interactivity.** One tab stop + arrow keys if the
   grid is larger than roughly one screen; per-cell focus only for genuinely small grids. Then
   **stop** — do not also add per-cell `title=`, and do not re-implement hover as focus.
10. **Add the empty state and the load state at the grid, not at the page.** `isLoading &&
    rows.length === 0` → ghost with the same track; `!isLoading && rows.length === 0` →
    `IllustratedEmptyState`. Five of the sixteen grids have neither (§7-D).
11. **If the area exceeds ~200 interactive cells, add `useProgressiveReveal` with a `resetKey`
    that encodes both axes** — and then stop. Do not reach for virtualization.

---

## §5 — Anti-patterns

| Anti-pattern | The failure mode |
|---|---|
| **Projecting a record to a scalar before the renderer sees it** (`pt => DayStatus`) | Destroys the cell's identity at the type. The renderer then *has* to key by position, and no review of the render site can find the cause. This is the §0 defect. |
| **Padding a fixed-width series at one end** (`while (a.length < 30) a.unshift(x)`) | Correct only if the series is dense and only its oldest entries are missing. With an interior gap every cell after the gap is off by one, and the strip still looks perfectly plausible. |
| **`key={i}` on a cell whose data is real** | Reorder/filter/pad → the DOM node under the cursor keeps its animation, focus and hover while its content changes. In a grid this is worse than in a list, because the user is navigating by *position* and has no label to check against. |
| **Handing the index to the cell as content** (`index={i}` → `"Day 1"`) | Promotes a rendering artifact to a user-facing fact. The number means "offset in an array we happened to build", which no user can act on. |
| **`title=` as the cell readout** | Native tooltips are keyboard-unreachable and screen-reader-inconsistent; a grid whose only readout is `title=` has no readout for half its users. Use `display/Tooltip` + a matching `aria-label`. |
| **Ink as the only channel** | A colour ramp with 4+ steps is not readable by eye, is invisible to a screen reader, and collapses under CVD. Always print the number too. |
| **Every cell a `<button>` in the tab order** | An N×M grid becomes N×M tab stops. `RegistryHeatmap` at 22 skills × 8 projects is 176 stops between the grid and the next control. |
| **A grid-shaped `<div>` stack with no grid semantics** | Assistive tech sees an undifferentiated pile of buttons: no row, no column, no header association. Measured below — this is the near-universal state. |
| **`animate-pulse` on a busy cell** | The repo's loading doctrine bans `animate-pulse` for surfaces and requires a real spinner on an action; a pulsing cell is neither. `RegistryHeatmap.tsx:144,161`. |
| **Reaching for row virtualization on a wide grid** | Windows one axis of a two-axis cost. The measured answer here is progressive mounting. |

---

## §6 — Evidence

**The one site to copy: `src/features/plugins/dev-tools/sub_skills/registry/RegistryHeatmap.tsx`**
(189 lines) together with its two model hooks. It is the only surface in the tree that does the
whole contract at once:

- both axes are id-bearing records, memoized in the hook (`useSkillsRegistry.ts:157`,
  `useProjectRegistry.ts:125`);
- the cell lookup is a memoized closure over `Map`s — `covByKey`, `usageByKey`,
  `installedByProject`, `ctxByProject`, `coveredByKey` — so the render performs **no scans**
  (`useSkillsRegistry.ts:197`, `useProjectRegistry.ts:179`);
- cells are keyed by column id inside rows keyed by skill name (`:116`, `:139`, `:155`, `:89`);
- hover state is the composite identity, not a position: `` const key = `${s.name}|${c.id}` ``
  (`:111-112`) against `useState<string | null>(null)` (`:38`);
- ink is proportional and **the number is printed inside it**:
  `backgroundColor: withAlpha(hue, 0.15 + (pct / 100) * 0.55)` (`:121`) with `{pct}%` (`:126`);
- there is a **legend** mapping four ink steps to coverage (`:175-186`) — the only grid in the
  tree that has one;
- density is handled by progressive mounting with a two-axis `resetKey` (`:45-48`);
- and the file's header comment states the model in two sentences before any code, including
  what an empty cell *means* on each of its two axes (`:1-12`).

Copy this block. What it is missing — grid semantics, a roving tab stop, `Tooltip` on the cells
themselves, and the two `animate-pulse` busy states — is in §7 and §8, and none of it is
structural.

Secondary exemplars, each for one clause:

| Site | What to take |
|---|---|
| `overview/sub_analytics/components/ExecutionHeatmap.tsx:359-400` | **P1 done right in the calendar family.** `key={day.date}`; `role` switches from `img` to `group` when cells become interactive (`:341-344`, with the reason written down); one `dayLabelText` feeds both the tooltip and `aria-label`; reduced-motion honoured (`:389`). |
| `agents/sub_lab/components/arena/ArenaResultsView.tsx:126` | **The selection model.** `useState<{ scenario: string; model: string } | null>(null)` — a coordinate *object of ids*, compared field-wise at `:319`. This is what "keyed by identity" looks like when a cell is selectable. |
| `overview/sub_messages/components/MessageList.tsx:347-372` | **The only grid semantics in the repo.** `role="grid"` + `aria-rowcount` + `aria-colcount` + five `role="gridcell"`s. It is 1 file of 2,083. |
| `plugins/dev-tools/sub_context/ContextLedger.tsx:171` + `contextMapPerf.tsx:216-240` | **The only cell grid with a real three-state body**: `ContextLedgerGhost` while loading, a filtered-empty state (`:262`), and a no-columns state (`:271`). |
| `plugins/dev-tools/sub_skills/trace/TraceOverview.tsx:41-44,65-66,145-149` | Memoized column totals, `TraceGhosts` sized to the column count, and `IllustratedEmptyState variant="heatmap"` on settle. |

---

## §7 — Deviations

Sixteen genuine N×M cell grids plus two 1-D bucket strips were enumerated. Counts are
site-level and were reproduced by both scanners unless noted.

### A — `StatusPageView` / `compositeHealthScore`: the cell's date is destroyed at the type

**`src/features/overview/sub_health/libs/compositeHealthScore.ts:375-384`** projects
`dailyPoints` (which the same file's own doc comment at `:312` says *"Each has date + …"*, and
whose element type declares `date: string` at `:314`) onto `dailyStatuses: DayStatus[]` — and
then pads with `unshift('no-data')`.

**`src/features/overview/sub_health/components/StatusPageView.tsx:144-145,182-191`** therefore
keys by index and labels by index: `key={i}`, `index={i}`, `` title={`Day ${index + 1}: …`} ``.
Consequences, in order of severity:

1. **The strip cannot say which date any cell is** — for a 30-day status page, the only fact a
   user wants.
2. **An interior gap in `dailyPoints` shifts every cell after it**, because the pad is applied
   at the front regardless of where the missing day was.
3. `title=` is the only readout (banned; keyboard-unreachable), the strip has **no
   `aria-label`** and the cells are `<div>`s, so a screen reader gets nothing at all.
4. Hardcoded English throughout the expanded panel — `"Success Rate"`, `"Latency (p95)"`,
   `"Cost Anomalies"`, `` `${entry.costAnomalyCount} detected` ``, `` `Day ${index + 1}` ``
   (`:166-170`, `:190`) — plus a `DebtText` marker at `:175`. In a 14-locale app.

**Fix:** widen the element — `dailyStatuses: Array<{ date: string; status: DayStatus }>` — pad
with the real missing dates, key `key={d.date}`, and route the readout through `Tooltip` +
`aria-label`. One type edit removes items 1–3 at once. Filed as a deferred fix (§10) because it
changes what a live surface shows.

### B — Grid semantics are absent from 15 of 16 grids

ARIA census over all 2,083 `.tsx` (both implementations agree):

| role / attribute | files | occurrences |
|---|---:|---:|
| `role="grid"` | **1** | 1 |
| `role="gridcell"` | **1** | 5 |
| `role="rowheader"` | **0** | 0 |
| `aria-rowindex` / `aria-colindex` | **0** | 0 |
| `aria-rowcount` / `aria-colcount` | 1 | 1 each |
| `role="columnheader"` | 6 | 25 |
| `role="row"` | 8 | 12 |

The single file with grid semantics is `MessageList.tsx`, which is a **list**, not a matrix.
**Every one of the sixteen cell grids in this leaf has zero.** They are `<div className="grid">`
stacks: the CSS knows there are columns and the accessibility tree does not. `RegistryHeatmap`
at 22 skills × N projects presents as an unstructured run of N×22 buttons whose only
distinguishing content is an `aria-label` built per cell (`:119`) — which is the best possible
outcome *without* grid roles, and still leaves no way to move by row or column.

### C — Every interactive cell is a sequential tab stop; nothing implements a roving tab index

`RegistryHeatmap` renders each cell as a `<button>` (`:116`, `:139`, `:155`). `ExecutionHeatmap`
sets `tabIndex={interactive ? 0 : undefined}` on every `<rect>` with a non-zero count
(`:383`). `ContextPickerCrossTab`, `ContextLedger` and `WallCompareTable` are the same shape.

Measured against the **2026-08-17 purge backup** — the only source of a real workload, since the
live database now holds 0 executions — `persona_executions` had **2,188** rows. A 365-day
`ExecutionHeatmap` over that data puts one tab stop on every day with at least one run;
`RegistryHeatmap` at the workspace's 8 teams × the skill library is on the order of 10²
stops. Nothing in the tree implements the standard answer (`tabIndex={0}` on the active cell,
`-1` on the rest, arrow keys to move). `UnifiedTable.tsx:544-563` has the *keyboard cursor* half
of it for rows and is a table, not a grid; it is owned by `expandable-row.md`.

### D — Five of sixteen grids have neither a loading state nor an empty state

| Grid | loading | empty |
|---|---|---|
| `teams/sub_factory/ContextMatrix.tsx` | — | cell-level `·` only (`:90`) |
| `teams/sub_factory/passport/WallCompareTable.tsx` | — | — |
| `schedules/components/MonthView.tsx` | — | — |
| `schedules/components/WeekView.tsx` | — | — |
| `templates/…/gallery/modals/CompareModal.tsx` | — | — |
| `plugins/…/registry/RegistryHeatmap.tsx` | **—** (the model exposes `loading` at `registryTypes.ts:68`; neither the heatmap nor `RegistryTab` renders anything for it) | at the host, `RegistryTab.tsx:114` |

The exemplar is in this table: `RegistryHeatmap` reads a `loading` flag that no one renders, so
its cold load is a bare frame. This is the one clause the reference site does not satisfy.

### E — `CompareModal.tsx:30` — the only grid that rebuilds its column closures every render

```
const dimensions: { label: string; signature: (col: CompareColumn) => string; render: (col: CompareColumn) => ReactNode }[] = [
```

A fresh array of fresh closures per render, then consumed at `:178` by
`new Set(columns.map(dim.signature)).size > 1` for every row. It is the sole instance of the
brief's predicted hazard (1 of 16), and it is also the smallest grid, so the cost is
theoretical. Recorded for completeness and because the *shape* is the one to avoid at scale.

### F — Position-keyed cells outside the headline case

- `vault/sub_databases/QueryResultTable.tsx:131,154` — **both axes** index-keyed
  (`key={rowIdx}`, `key={colIdx}`), plus `:72` and `:90`. Defensible: a SQL result set has no
  primary key the viewer knows about, and the columns are positional by definition. **This is
  the one place where index keys are correct**, and it is recorded so a future ratchet does not
  "fix" it.
- `schedules/components/MonthView.tsx:42` — week rows keyed `key={wi}` while the day cells
  inside are keyed `key={day.date.toISOString()}`. The weeks array is rebuilt in the render body
  unmemoized (`:24-27`) from a memoized `days` (`:22`). Low severity, wrong shape.
- `teams/sub_factory/passport/WallCompareTable.tsx:188` — blockers list `key={i}`.
- `shared/chrome/FleetActivityStrip.tsx:159,169,178` — the concurrency strip; every bar
  `key={i}`. Defensible (a slot *is* its index) and listed so the ratchet knows.

### G — `title=` as the cell readout

`StatusPageView.tsx:190`, `ContextMatrix.tsx:107,116,128` (`title={label}` on all three cell
variants), `ScheduleRowHistoryPanel.tsx:117`, `boardShared.tsx:95`. `display/Tooltip` exists and
`RegistryHeatmap.tsx:69` proves it composes with a grid cell.

### H — `ContextMatrix.tsx` is a prototype wired to mock data, with hardcoded English

`import { … type MockKpi, type MockProject } from './factoryModel'` (`:9-20`); header labels
`"Context"` (`:45`) and `"Score"` (`:49`) are raw English; the file's own comment calls it
*"the sophisticated context × KPI matrix (round-4) … Parameterised by `cell` so the three
round-4 variants explore the cell look"*. It is a design-exploration variant that shipped. Not a
defect in the grid contract; a scope question for whoever owns Factory L2.

### I — Two `animate-pulse` busy cells

`RegistryHeatmap.tsx:144` (`cell.running`) and `:161` (`status === 'adopting'`). The repo's
loading doctrine bans `animate-pulse` as a surface state and requires a **real** spinner on a
control the user pressed. A cell that is adopting is the second case: it is an action.
`buttons/Button loading={…}` renders the real spinner and takes the `disabled` + `aria-busy`
wiring with it.

---

## §8 — Gaps

1. **There is no grid primitive.** `shared/components/display/` has `UnifiedTable`, `DataGrid`,
   `FacetedDecisionTable` and `GroupedVirtualList` — all **row**-shaped, all requiring a static
   `columns` array supplied by the caller. None accepts a *data-derived* column axis, which is
   the defining property of this leaf. So all sixteen grids are hand-built, and every clause in
   §2 has to be re-satisfied by hand sixteen times. That is the upstream cause of §7-B, §7-C
   and §7-D: they are not sixteen independent oversights, they are one missing component.
2. **No roving-tabindex helper exists**, so P4 has no cheap implementation. The nearest thing
   (`UnifiedTable`'s `focusedIndex`) is coupled to a table body and is itself index-keyed.
3. **`useProgressiveReveal` bounds mount cost, not scroll cost.** Once revealed, every cell
   stays mounted. For the grids measured that is correct — none exceeds ~10³ cells — but there
   is no windowing answer if one ever does, and row windowing would not be it.
4. **The census cannot express this leaf's condition.** See §9. The defect is a *type* one layer
   above the render, and a text matcher standing at the render site sees only the symptom,
   which is shared with a dozen legitimate constructs.
5. **`ExecutionHeatmap`'s `role="group"` switch is right and undiscoverable.** `:341-344`
   documents why `role="img"` would hide interactive children. Nothing else in the tree knows
   this, and there is no shared helper carrying it.

---

## §9 — The missing gate

**Both candidate rules were built, validated against the real runner in a private registry, and
DECLINED on measured precision.** The numbers are below, because a refusal without numbers is
an opinion.

### Declined rule 1 — `grid-cell-keyed-by-its-position`

Anchor: a `.map` whose body contains another `.map` whose inner cell is keyed by the inner
callback's own index parameter.

```
\.map\((?:(?!\.map\()[^;]){0,500}\.map\(\s*\(\s*[A-Za-z_$][\w$]*\s*,\s*(i|idx|index|ci|ri|wi|j|c|r)\s*\)\s*=>(?:(?!\.map\()[^;]){0,400}?key=\{\s*\1\s*\}
```

Runner result over 2,083 `.tsx`: **18 matches in 16 files**, against a positive control
(same anchor, inner cell keyed by the callback's *value* parameter) of **41 matches in 41
files** — a 31% violating share, which looked publishable. Total runtime 2.8 s.

**Hand-verified precision: 4/18 (22%). I opened all eighteen.** The breakdown is what kills it:

| verdict | n | sites |
|---|---:|---|
| true positive (real data keyed by position) | 4 | `ShortcutCheatSheet.tsx:82`, `ComparisonCardsWidget.tsx:89`, `TableSkeleton.tsx:61,73` (the *columns* array is real data even inside a skeleton) |
| false positive — the index **is** the identity | 8 | `ProfilesAtelier.tsx:674,703`, `LabResultsSkeleton.tsx:108`, `decorations.tsx:105`, `KnowledgeAtelier.tsx:213`, `ProjectsLayer.tsx:210`, `KnowledgeMotif.tsx:24`, `DimAuras.tsx:139` — `Array.from({length:N})` ghosts and static SVG decoration |
| **false positive — the matcher fired on the COMPLIANT form** | 5 | `GoalsPage.tsx:347` (`key={lane}`), `CreativeStudioPanel.tsx:376` (`key={example}`), `JudgePanel.tsx:43` (`key={label}`), `SLADashboard.tsx:237` (`key={d}`), `EventListenerConfig.tsx:71` (`key={r.pattern}`) |
| borderline | 1 | `TestReportModal.tsx:372` (markdown lines from a `split('\n')` — no id exists) |

The third row is the disqualifying one, and its cause is worth recording as doctrine:
**`[^;]` is not a statement bound in JSX.** A React render body between two semicolons is
routinely 300+ lines, so the "outer map" and the "inner map" the matcher pairs are frequently
**not nested at all** — the pattern walked past the real nesting boundary and paired an
unrelated later `.map` that happened to sit inside the same `return (…)`. Five of the fourteen
false positives are the gate reporting a *correct* construct as a violation. Per the contract,
that is worse than no gate.

The broader form (`cell-keyed-by-its-own-index`, no nesting requirement) was measured first and
is worse still: **246 matches in 196 files** against a 77-match control, i.e. the "violation" is
the majority shape of ordinary list rendering across the whole app. That is a lint rule about
React keys, not a golden path about grids, and it is not this leaf's to ship.

**Overlap check.** Measured against the 184 committed rules by re-reading each pattern:
`unbounded-shared-table-render` (`long-list-rendering.md`) anchors on `<UnifiedTable|<DataGrid`
tags and shares **zero** sites; `unfocusable-click-target` anchors on `onClick` +
`cursor-pointer` on a non-interactive element and shares zero; `stateless-disclosure-control`
(`expandable-row.md`) anchors on `<button>` tags carrying toggle-shaped attributes and shares
zero. No committed rule covers this leaf, and after this measurement none should.

### Declined rule 2 — grid ARIA semantics

The tempting rule is *"a `gridTemplateColumns` computed from data, with no `role="grid"` in the
file."* The census **cannot express it**: it ratchets a count of something **present**, and this
condition is an **absence** — and the absence is at 15 of 16, so the "rule" would be a rule that
matches almost every grid in the app and can only ever be silenced by an edit no one has agreed
to. It is exactly the class the doctrine names as un-gateable ("the census cannot assert an
ABSENCE"). What it needs instead is a *specification*, and that specification is §9-T2 below.

### T1 — Prefer a type over a gate (the actual fix)

The defect this leaf is really about is **unrepresentable in a well-typed model**, which puts it
squarely in the contract's "prefer a type" bucket. Held against the doctrine's seven
qualifications:

- **Q1 (a required prop carries only what it encodes):** satisfied — the field being added
  (`date`) *is* the missing information, not a tag beside it.
- **Q2 (requiredness ≠ closedness):** the edit is neither; it is a **widening** of the element
  from a scalar to a record. That is the third operation and it is the right one here.
- **Q3 (a type nobody constructs constrains nothing):** `dailyStatuses` has **1 producer**
  (`compositeHealthScore.ts:375`) and **1 consumer** (`StatusPageView.tsx:144`), plus 2 test
  references. A two-site type is exactly where a widening is cheap and total.
- **Q4 (anyone-can-construct authenticates nothing):** not applicable — this is not an
  authentication boundary.
- **Q5/Q6 (withholding beats requiring; withhold the dangerous freedom):** the dangerous freedom
  here is *the renderer's access to the index*. `dailyStatuses.map((status, i) => …)` hands it
  over; `dailyStatuses.map((d) => …)` with `d.date` does not.
- **Q7:** not applicable.

**Where the type does not reach:** the pad. `unshift('no-data')` is arithmetic on array length,
and no element type prevents padding at the wrong end — it only makes the wrong end *visible*,
because a padded element would have to be given a date and the author would have to decide
which one. That is the whole value: the type does not fix the pad, it makes the pad's question
unavoidable.

### T2 — The instrument this leaf actually needs (specified, not built)

A **grid conformance test**, not a text matcher. For each surface registered as a grid, assert
in a jsdom test that: (a) every cell's accessible name is non-empty and differs from its
neighbours; (b) the number of elements with `tabIndex >= 0` inside the grid is **1**, not
rows × columns; (c) the grid container carries `role="grid"` with `aria-rowcount`/`aria-colcount`
matching the data; and (d) each cell's accessible name and its tooltip come from the same
string. **It must fail loudly when its own precondition is absent** — exit non-zero if the grid
registry is empty or if a registered surface renders zero cells, so a broken selector cannot
read as a clean pass. This cannot live in the census and should not be sixteen bespoke tests;
it is one test helper plus a registry, and it becomes cheap the moment Gap 1 (a real grid
primitive) is closed.

---

## §10 — Deferred fixes (no destructive applies)

Appended to [`golden-path-deferred-fixes.md`](../golden-path-deferred-fixes.md); each changes
what a live surface shows and is therefore a note, not an apply:

- **Widen `dailyStatuses` to carry its date** (`compositeHealthScore.ts:44,375-384`) and key
  `StatusPageView.tsx:145` by it; pad with the real missing dates; replace
  `` title={`Day ${index+1}`} `` with `Tooltip` + `aria-label`; extract the six hardcoded
  English strings in `StatusPageView.tsx:166-175,190`.
- **Render `RegistryHeatmap`'s `loading`** — the model exposes it (`registryTypes.ts:68`) and
  nothing consumes it, so the workspace matrix cold-loads as a bare frame.
- **Replace the two `animate-pulse` busy cells** (`RegistryHeatmap.tsx:144,161`) with
  `Button loading`.

---

## §11 — The convergence oracle

**Cohort established per leaf, at the time of measurement**, per the doctrine. Swept read-only:
`../personas-web`, `../brainiac`, `../personas-cloud`, `../vibeman`, `../ascent`.

> **Process note, kept because it is the useful part.** This section was first drafted
> *before* the sweep returned, and the draft asserted **"Result: silence — no sibling renders a
> dense N×M cell grid"** with the confident supporting prose to match. That was a prediction
> wearing a measurement's clothes, and it was **wrong on four of five repos**. It was deleted
> rather than hedged. Recorded here because the doctrine's warning that *"a measurement which
> supports a conclusion you already believe is when to re-run it"* has a sharper cousin: **a
> measurement you have not taken yet is the easiest of all to agree with you.**

**Cohort, established for this leaf: 3 independent, not 5.**

- **`personas-cloud` — no UI layer at all.** 32 TypeScript files, all backend
  (`packages/orchestrator`, `packages/worker`, `packages/shared`), **zero `.tsx`**. It cannot
  answer this leaf's question and is excluded, not counted as a silence.
- **`personas-web` — a self-declared PORT of the exact component this leaf is about**, so it is
  disqualified as a witness and reinstated as something better (below).
  `ExecutionHeatmapCard.tsx:11-12` reads *"Violet intensity ramp (0 = no activity … 4 = peak),
  **mirroring the desktop ExecutionHeatmap colour scale**"*, and its `FILL` array (`:13-19`) is
  the desktop's `INTENSITY_FILL` (`ExecutionHeatmap.tsx:33-39`) with **four of five values
  byte-identical** after whitespace normalisation and index 3 drifted `0.75 → 0.78`. The tell is
  textual, exactly as the doctrine says: structure can converge, prose and magic constants
  cannot.
- Independent: **`brainiac`, `vibeman`, `ascent`.**

**Result: the leaf is common, not rare — and the fleet converged on the disease.**

| repo | grid | cell `key=` | cell a tab stop? | grid semantics |
|---|---|---|---|---|
| `ascent` `RepoDimensionHeatmap.tsx:99-133` | repos × dimensions | **`key={d}`** (dimension id) | **yes** — `<button>` per cell (`:118`) | none; real `<table>`, `scope="col"` `:79`, `scope="row"` `:103`, `aria-sort` `:81` |
| `ascent` `TeamsMatrix.tsx:139-160` | teams × dimensions | **`key={d}`** | no | none; `<table>` + `<caption>` `:99`, `scope="col"` |
| `brainiac` `StandardsVariantMatrix.tsx:369-447` | practices × teams | **`key={t}`** (team name) | **yes** when filled (`:436`) | none; `<table>`, `<caption>` `:317`, `scope="col"` `:324,338,357`, `scope="row"` `:376` |
| `brainiac` `Observatory.tsx:389-411` | kinds × teams/projects | **`key={t}`** | no | none; `<table>`, `<th>` at `:382` carries **no `scope`** |
| `vibeman` `MatrixGrid.tsx:298-338` | projects × projects | ``key={`cell-${source.id}-${target.id}`}`` | **conditionally** — `tabIndex={cellData ? 0 : undefined}` (`:104`) | **`role="grid"` (`:221`) + `role="gridcell"` (`:105`)** — and **no `role="row"`**, so the gridcells are orphaned from any row |
| `vibeman` `TemporalHeatmap.tsx:688-729` | weeks × weekdays | **`key={i}`** | no; `onClick` on a `<rect>` with no `tabIndex` | none at all |
| `personas-web` (PORT) `ExecutionHeatmapCard.tsx:76-96` | personas × 7 days | **`key={i}`** (`:88`) — where the original keys `key={day.date}` | no | none |

Reading it per the doctrine:

**1. P1 is convergent, and by different mechanisms — the strongest form the oracle produces.**
`ascent` keys by dimension id, `brainiac` by team-name string, `vibeman` by a composite
`` `cell-${sourceId}-${targetId}` ``. Three repos, three idioms, one principle, no shared code.
Per the doctrine that counts for more than three copies of one idiom — though it is still one
author, so it is reported as convergence and not promoted to physics on count alone. P1 stands
on its warrant.

**2. The port dropped the identity, and that is the single best piece of evidence in this
document.** `personas-web` copied the ramp, the comment and the concept — and rendered the cell
`key={i}` where the original renders `key={day.date}`. The safety mechanism lives in a `key`
prop that reads like boilerplate, so a careful engineer did not carry it across. This is the
same shape the doctrine records for `personas-cloud` dropping the scheduler's compare-and-set,
and it is a **cost/failure** result, which survives the shared-authorship confound that
agreement does not. It is also the argument for §9-T1: the desktop's `FilledDay` **type** is
what made `key={day.date}` available, and the port's hand-rolled `HeatmapRow` (which flattens
days to `days: number[]`) is what made `key={i}` the only option. **The port reproduced §0's
defect by reproducing §0's projection.**

**3. Grid semantics: the fleet converged on the disease.** Across all six repos there is
**one** `role="grid"` + `role="gridcell"` implementation (`vibeman`), it is **incomplete** (no
`role="row"`), and there are **zero** occurrences of `aria-rowindex`, `aria-colindex` or
`aria-rowcount` anywhere in the five siblings. Personas' single `role="grid"` is on a *message
list*, not a matrix. Six codebases, eight matrices, **zero complete grid implementations.** Per
the doctrine, perfect agreement on an omission is evidence the situation is universal and
evidence **against** an answer existing to adopt — an oracle that only counts agreement would
read this as maximal confirmation that grid roles are unnecessary. §7-B stands on P3/P4's
warrants, not on the count.

**4. Roving tab stops: converged on the disease again.** Zero of six repos implement one.
`vibeman:104` and Personas' `ExecutionHeatmap.tsx:383` independently arrived at the *same
partial answer* — `tabIndex` on non-empty cells only, which reduces the tab-stop count by the
sparsity of the data and not by the shape of the grid. Two repos reaching the same
half-measure is itself informative: the full answer is known in the WAI-ARIA literature and
absent from the fleet, so this is a **transfer** gap, not an ignorance gap.

**5. Personas is BEHIND the fleet on table semantics, and this is the finding to act on.**
`ascent` and `brainiac` build their matrices as real `<table>`s with `scope="col"` /
`scope="row"` / `<caption>` — which buys the header-to-cell association that `role="grid"` would
have, for free, from HTML. Counted across each repo's source tree: **`ascent` has `scope="col"`
in 5 files, `scope="row"` in 5, and `<caption>` in 6.** **Personas has `scope="col"` in 0 files
and `scope="row"` in 1, and `<caption>` in 0** — and all sixteen of its grids are
`<div className="grid">` stacks. That inverts §7-B's prescription in the cheapest possible
direction: the fix for fifteen of sixteen Personas grids is not to add ARIA, it is to **use the
element that already carries the semantics**, which is what two independent siblings did without
being told. "Personas is ahead of the fleet" is the self-flattering shape a finding can take;
this is the other one, and it is worth more.

**6. `vibeman`'s `MatrixGrid` is dated `2026-06-16`** and is the only sibling grid that
virtualizes, keys compositely, and carries grid roles — three of this path's clauses at once. Per
the doctrine's default (`vibeman` is this repo's ancestor until proven otherwise), it is not
counted as an independent peer for anything Personas also does; it is counted where it does
something Personas does not, which is the `role="grid"` half.

Per the doctrine's rules for reading the oracle:

- **P1 — convergent** (3 independent repos, 3 different mechanisms) **and independently
  falsified by a port that dropped it.** The strongest support this instrument can give.
- **P3 — silence.** No sibling prints the cell's value alongside its ink except `ascent`
  (`RepoDimensionHeatmap.tsx:127` renders `{v}` inside the tinted button) and `brainiac`'s
  `Observatory` (which prints `·` for empty). Two of three. Reported as a partial silence, not
  as a verdict.
- **P4 and grid semantics — converged on the disease.** Zero complete implementations in six
  codebases. Held on their warrants, which are arithmetic and assistive-technology semantics,
  not on a vote.
- **P5 remains labelled a house convention** (§1): `vibeman` virtualizes its matrix rather than
  progressively mounting it, so the fleet does not corroborate the progressive-mount choice, and
  a single dissenting mechanism in an *ancestor* repo is exactly the case the doctrine says to
  report as local calibration.
- **P2 — not tested.** No sibling pads a fixed-width series, so the sweep has nothing to say
  about it either way. Recorded as *unswept*, which is not the same as silent: the sweep did not
  look for padding, so its absence from the report is a property of the question I asked, not of
  the sibling code. Named so a later composer does not read this row as evidence.

---

## §12 — Corrections owed

**To this document's brief** (all four in §0.1): the virtualization warning is upheld on
different grounds; the recomputed-column-set hazard is **1 of 16**, not a class; the
selection-by-position hazard is **0 of 16** — a cleared claim; and the `isLoading`-without-`data`
question is **unrepresentable**, because `data` is a required prop.

**To [`shared-facts.json`](../shared-facts.json)** — `frontend.tsxFiles` and
`frontend.tsFiles`. Recorded as 2,104 / 4,829 at `2ee130c3e` (2026-08-17). At HEAD
`de274d14d` the values are **2,083 / 4,801**, confirmed by four independent instruments; the
recorded values reproduce exactly at `2ee130c3e` via `git ls-tree`, and
`git diff --diff-filter=D 2ee130c3e..HEAD` accounts for the whole gap: **21 `.tsx` deleted, 0
added; 29 `.ts`/`.tsx` deleted, 1 added, over 27 commits.** The fact was correct when taken.
Two consequences worth carrying: (1) a composer citing 4,829 today is ~0.6% high, which changes
no conclusion but is not the number their own walk will produce — expect the mismatch and do
not chase it; (2) **the denominator moved by deletion**, so any *ratio* measured against the
old denominator and re-measured against the new one will appear to improve without a line of
code being written. That is `expandable-row.md`'s post-publication lesson recurring in the
denominator rather than in the numerator.

**To [`long-list-rendering.md`](./long-list-rendering.md)** — no correction; a **confirmation**,
recorded because confirmations are rarer than corrections. Its `<UnifiedTable> call sites: 17 in
16 files — 6 pass rowHeight` reproduces byte-for-byte under two independent scanners here, and
its "22 call sites" is recoverable as 17 UnifiedTable + 5 DataGrid, which means it correctly
excluded the `Numeric.tsx:24` JSDoc mention that **both** of this composer's implementations
counted. Two agreeing implementations were wrong and a neighbouring document was right; the
doctrine's "agreement is not soundness" earned a fresh instance.

**To the doctrine, offered upward** — a new census-matcher failure mode, from §9's decline:
**`[^;]` is not a statement bound in TSX.** The doctrine already records "enumerate the
operators that contain your delimiters" for `<`/`>`. This is the same class for `;`: a JSX
render body routinely runs hundreds of lines between semicolons, so a lazy `[^;]{0,N}` span
intended to mean "within this statement" instead means "anywhere in this component", and it
will happily pair an outer construct with an unrelated later one. The measured cost was **5 of
14 false positives being the gate firing on the compliant form** — the same signature as the
positive-control contamination the doctrine records for vocabulary lists, reached by a
completely different route. When a pattern needs a nesting relationship, bound it by
brace-matching, not by a punctuation character that the language in question barely uses.
