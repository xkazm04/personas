# Golden path — Long list rendering

> Situation node: `product-surfaces` › `lists-and-tables` › `long-list-rendering` ·
> [situation spine](../situation-spine.md) · recurrence 18 · risk **medium** ·
> sides: **client** (upheld with one qualification — §12.1) ·
> convergence: **mixed** (upheld: 2 physics / 2 Personas-alone / 2 silence — §12.2) ·
> dimensions: **performance · ui · function**
> Leaf definition: *"Thousands of rows: virtualize, paginate or load-more — and which, when."*
> `mergedFrom`: *Virtualized list* + *Long-list virtualization* + *List pagination strategy*
> Composed 2026-08-17 against `master` @ `e21dfeb0d` (**not** `2a874e692`, which is what the brief's
> primed leads were composed against and what this header said until §12.11 caught it — the census
> registry this path's §9 measures against **did not exist** at that commit).
>
> **Sweep.** All **4,829** `.ts`/`.tsx` under `src/` (**2,725** `.ts`, **2,104** `.tsx`). Every JSX
> `.map()` list render enumerated twice (**955** files / **1,555** sites). Every call site of the two
> shared table primitives extracted **three times** by three matchers — a hand-written brace-matching
> JSX scanner, a second scanner after its generic-type-argument bug was found, and the census engine —
> which is how the **22** call sites in **20** files were settled (§12.4 reports the two disagreements
> and their causes). Every windowing mechanism in the tree enumerated (**9** `useVirtualizer(` call
> sites, **6** `useVirtualList` consumers, **3** `useGroupedVirtualizer` consumers, **1** library).
> All **307** `invoke<T[]>` call sites in `src/api/**` classified for whether the client asks for a
> bound (**224**, 73%, do not). All **157** census rules run and intersected at **site** level.
> Read in full: `shared/components/display/{UnifiedTable,DataGrid,GroupedVirtualList,RevealItem,FacetedDecisionTable}.tsx`,
> `hooks/utility/interaction/{useVirtualList,useProgressiveReveal,useScrollRestoration,useEndReached}.ts`,
> `hooks/utility/data/useLayeredList.ts`, `overview/sub_events/components/EventLogList.tsx` +
> `libs/useEventLog.ts`, `overview/sub_activity/components/LlmCallsTable.tsx`,
> `overview/sub_memories/components/{MemoriesPage,MemoriesPageDense}.tsx`,
> `agents/sub_executions/components/list/ExecutionList.tsx`,
> `overview/sub_usage/components/ToolPerformancePanel.tsx`,
> `stores/slices/overview/{overviewSlice,memorySlice}.ts`,
> `vault/sub_databases/{DatabaseListView,QueryResultTable}.tsx`,
> `settings/sub_byom/components/ByomAuditLog.tsx`, `schedules/components/ScheduleGroupedList.tsx`.
>
> **Measured by EXECUTING, not by reading.** `UnifiedTable`'s **two body branches**
> (`UnifiedTable.tsx:638-694`) and its client-side sort (`:499-514`) were transcribed
> **statement for statement** into a **jsdom 29.1.1 + React 19.2.6** harness loaded through the repo's
> own `node_modules`, using the **real `@tanstack/react-virtual` 3.13.26** package and the repo's own
> `useVirtualList` verbatim — and driven over rows read from a **read-only copy** of the operator's
> live **347 MB `personas.db`** (+ the 17 MB `personas_data.db`), copied 2026-08-17 08:54 UTC with the
> app running. The live files were never opened for write; **nothing was written anywhere**; both
> copies were deleted afterwards. Real inputs: **6,535** memories, **9,803** credential-audit rows,
> **4,974** events, **2,942** traces holding **90,813** spans, **2,188** executions, **1,306**
> knowledge items, **253,752** practice-context-state rows. Four experiments; §0 is their output.
> Recorded substitutions: JSX → `React.createElement` (the harness has no build step), and jsdom's
> zero-height layout patched the way the repo's own `src/test/setup.ts:15-37` patches it. **The
> instrument was asserted before it was trusted** — the first run reported the virtual branch mounting
> **0** rows, which is a broken harness, not a fast one; §12.5.
>
> **`cargo` was not run.** Every Rust claim is static or replayed in SQL.
>
> Convergence oracle run against **`personas-web`, `brainiac`, `personas-cloud`, `vibeman`,
> `ascent`** — all five present, all five opened. **`personas-cloud` contains zero `.tsx` files** and
> is reported as *structurally absent*, not as a choice: it cannot converge or diverge on rendering.
> **Effective independent cohort: 4.** Lineage checked both ways — no component name from this repo's
> list stack (`UnifiedTable`, `DataGrid`, `GroupedVirtualList`, `VirtualizedTableBody`,
> `useVirtualList`, `FacetedDecisionTable`) appears in any sibling, and no comment, constant or error
> string is shared. Each sibling reached this leaf through a **different library or none at all**.
>
> **Settles:** how many rows are allowed into the DOM, who decides, and what the list is still allowed
> to claim about the corpus once it has stopped rendering all of it.

---

### Sibling boundaries, settled in prose

This leaf sits in the most crowded neighbourhood in the corpus. Eight published paths touch it and
one of them claims it outright. The seams, each checked against the neighbour's own text:

- [**`paginated-list-query`**](./paginated-list-query.md) **owns the fetch; this owns the DOM**, and it
  says so first: *"bounding the **DOM** (how many rows render) is `long-list-rendering` —
  `UnifiedTable`'s `rowHeight` virtualization. **This path bounds the fetch.**"* (`:44-46`). Its
  decision rule at `:281` is adopted verbatim into §2 rather than re-derived. Its numbers — 225 of
  384 list commands hard-unbounded, 64 of 99 limits unclamped — are **cited, not re-measured**. §12.3
  returns one correction to it.
- [**`tables.md`**](./tables.md) **is a pre-spine probe that claims this territory outright.** Its §2
  lists *"virtualization … scroll restoration, infinite scroll"* as `UnifiedTable` capabilities and
  names no neighbour; `REVIEW-wave1.md:128` already flagged it (*"`tables.md` claims virtualization
  jurisdiction outright"*). **The seam this path cuts: `tables.md` owns WHICH primitive and how to
  feed it columns. This path owns whether the primitive was told how many rows may render** — a
  question `tables.md` never asks, and whose answer is *no* at 12 of its own 22 adoption sites.
- [**`list-entrance-stagger`**](./list-entrance-stagger.md) **owns the cascade and its timing** —
  `RevealItem`, `useRevealTracker`, the 14-row first-viewport bound, `MAX_STAGGER = 8 × 35 ms`, and
  `useProgressiveReveal` as mount-batching. **Do not restate any of it.** This path owns only the
  *interaction*: a cascade keyed on an index inside a **window** is indexed on a scroll position, not
  an arrival (§5, and §6 clause 3 where the fleet's worst instance lives in `vibeman`).
- [**`page-loading`**](./page-loading.md) owns the ghost, the empty state and the warm remount. This
  path owns what is *behind* the ghost once it clears.
- [**`filtering-and-search`**](./filtering-and-search.md) owns **filter → page reset**
  (`<DataGrid key={filterKey}>`), facet counts and scope disclosure, and already ships
  `custom/require-filter-page-reset` as a proposal. **Not re-proposed.** §12.6 returns a correction to
  one of its six cited page sizes.
- [**`expandable-row`**](./expandable-row.md) owns `measureElement` for an *expanded panel* (its P8),
  and its §9-C5 **explicitly refuses** a gate on it. This path does not re-propose that gate and says
  why in §9.
- [**`live-log-stream-view`**](./live-log-stream-view.md) owns **tails** — stickiness, unseen counters,
  ring budgets, and the fact that a "line" is not a row. This path is scoped to **finite,
  addressable collections**; every clause below assumes the corpus has a size.
- [**`aggregate-count-display`**](./aggregate-count-display.md) owns the *number*; this owns the
  *rows*. Its headline (a dialog saying 100 that deletes 6,535) and this §0 are two readings of the
  same 100 — it owns where the number came from, this owns why the list stops at row 100 and offers
  no row 101.
- [**`bulk-selection-actions`**](./bulk-selection-actions.md) owns the **selection**; its §0 measures
  `DataGrid pageSize={25}` selecting 78. **This path owns the other half of that same sentence:** why
  the page is 25, what the other 53 rows cost if you render them, and what the page control claims.

---

## 0. The headline

**The repo's mandated table primitive decides whether a list is windowed from an optional number that
defaults to zero. Twelve of its twenty-two call sites never pass it. Executed against the operator's
own database, the branch they get renders every row: 6,535 memories became 52,281 DOM elements and
4.46 seconds; the windowed branch, same rows, same columns, mounted 23 rows in 28.7 ms.**

### A — `rowHeight = 0` is the default, and the default is "render everything"

`UnifiedTable.tsx:446` is `rowHeight = 0`. `:523` is the switch:

```ts
// Virtual list: enable whenever rowHeight is provided so rows are always in a
// bounded scroll container (important on small displays).
const useVirtual = rowHeight > 0;
```

`:674` is what you get when you don't: `sortedData.map((row, idx) => …)` — the whole array, into the
DOM, with no scroll container of its own. `DataGrid` is the same shape one door down: `pageSize = 0`
(`:155`), and `:227-231` reads `if (effectivePageSize <= 0) return data;`.

**Both shared list primitives default to unbounded, and the bound is an optional number whose absent
value is the dangerous one.** This is the contract's fifth §9 failure mode
([`golden-path-contract.md`](../golden-path-contract.md): *"a primitive with a mandatory-but-forgettable
argument does not concentrate a concern — it relocates it, and hides it behind a green check"*),
reproduced at a second primitive, and at a worse ratio than the `<Numeric>` case that earned it.

Harness, real rows, real columns, median of 5 after warm-up:

| what the rows are | N | branch | median ms | DOM elements | rows mounted | innerHTML bytes |
|---|---:|---|---:|---:|---:|---:|
| the Memories page as it ships (fetch limit 100) | 100 | **rowHeight omitted** | **99.1** | 801 | 100 | 72,231 |
| | | `rowHeight={40}` | 28.8 | 186 | 23 | 18,342 |
| the Memories page **while searching** (fetch limit 500) | 500 | **rowHeight omitted** | **509.5** | 4,001 | 500 | 366,112 |
| | | `rowHeight={40}` | 29.2 | 186 | 23 | 18,343 |
| the whole Knowledge library | 1,306 | **rowHeight omitted** | **1,324.3** | 10,449 | 1,306 | 953,162 |
| | | `rowHeight={40}` | 32.7 | 186 | 23 | 18,343 |
| every execution | 2,188 | **rowHeight omitted** | **1,878.0** | 17,505 | 2,188 | 1,600,868 |
| | | `rowHeight={40}` | 28.3 | 186 | 23 | 18,343 |
| every event | 4,974 | **rowHeight omitted** | **2,517.0** | 24,871 | 4,974 | 2,268,155 |
| | | `rowHeight={40}` | 20.9 | 117 | 23 | 11,952 |
| **every memory** | **6,535** | **rowHeight omitted** | **4,462.6** | **52,281** | **6,535** | 4,864,571 |
| | | `rowHeight={40}` | 28.7 | 186 | 23 | 18,344 |
| the whole credential audit log | 9,803 | **rowHeight omitted** | **4,517.2** | 49,016 | 9,803 | 4,300,593 |
| | | `rowHeight={40}` | 22.5 | 117 | 23 | 11,847 |

Ratios: **3× / 17× / 41× / 66× / 120× / 155× / 201×** wall time, and **4× / 22× / 56× / 94× / 213× /
281× / 419×** DOM elements. The windowed branch mounts **23 rows at every N** — that is the whole
point of it, and it is why its cost is flat while the other is linear.

> **What transfers and what does not.** The **DOM element counts are exact and stack-portable** — they
> are a property of the component tree, and a real engine builds the same nodes. The **wall times are
> jsdom's**, and jsdom performs *no layout and no paint*. They are therefore a **lower bound** on a
> browser engine, not an estimate of it: WebView2 must additionally lay out and style 52,281 nodes
> that jsdom merely allocated. Quote the ratios and the node counts; treat the milliseconds as the
> floor.

### B — the sort on a load-more list is a claim about the window, and it is false

`LlmCallsTable.tsx:305-320` is one of the six call sites that *does* pass `rowHeight` — and it is the
one carrying the leaf's second defect, which windowing does not touch. It declares **four sortable
columns** with real `sortFn`s (`:178`, `:231`, `:245`, `:259`), a `tableId="overview-llm-calls"` (so
the sort is **persisted to `localStorage`**, `UnifiedTable.tsx:479-487`), and
`onEndReached={globalExecutionsHasMore ? handleLoadMore : undefined}` (`:319`). `UnifiedTable` sorts
**client-side over `data`** (`:499-514`) — and `data` is the *loaded window*, paged 50 at a time by
`overviewSlice.ts:149` with a hard client ceiling of `MAX_GLOBAL_LIMIT = 500` (`:150`).

Replayed against the operator's real 2,188 executions, cost column sorted descending:

```
corpus: 2,188 executions.  most expensive in the corpus: $7.1604

| pages loaded | rows in the window | top row the table shows | the corpus max | true top-10 present |
|---:|---:|---:|---:|---:|
| 1  |  50 | $2.5254 | $7.1604 | 0/10 |
| 2  | 100 | $3.7568 | $7.1604 | 0/10 |
| 3  | 150 | $3.7568 | $7.1604 | 0/10 |
| 4  | 200 | $3.7568 | $7.1604 | 0/10 |
| 5  | 250 | $3.7646 | $7.1604 | 0/10 |
| 10 | 500 | $3.7646 | $7.1604 | 0/10 |   <- the client's own ceiling
```

**The most expensive LLM call in the product cost $7.16. The table sorted by cost, descending, with
every page the client is permitted to load, tops out at $3.76 and contains none of the ten most
expensive calls.** No number on that screen is wrong about the rows it names; the header just says
`Cost ▼` and means *of these 500*.

And the rows move while you read them. When page 2 lands, with cost sorted descending:

```
appended rows that land ABOVE the previous last row: 24/50
rows already on screen that change position:         50/50
largest single displacement:                         49 rows
the row that was at index 10 (mid-viewport) is now at index 23
the row that was #1 (most expensive) is now #2
CONTROL, no client sort: rows that change position: 0/50, appended landing above: 0/50
```

The control is the point: **the reshuffle is caused entirely by sorting a window that grows.** With
the server's own order the append is invisible; with a client sort every row on screen moves, and the
row under the cursor drops thirteen places. `EventLogList` has the same composition with one sortable
column (`:260`).

### C — one optional number silently gates four capabilities

`rowHeight` is not a styling hint. Executed, both branches mounted:

```
rowHeight=0 :  a scroll container exists: false -> scrollRestoreKey can bind: false
               · useEndReached has a node to watch: false · groupBy path reachable: false
               · rows in the DOM: 50/50
rowHeight=40:  a scroll container exists: true  -> scrollRestoreKey can bind: true
               · useEndReached has a node to watch: true  · groupBy path reachable: true
               · rows in the DOM: 23/50
```

The source says so itself, at `:529-531`: *"No-op when `scrollRestoreKey` is undefined **or the table
isn't virtualized**"*, and at `:527`: `grouped = !!groupBy && useVirtual`. So **`scrollRestoreKey`,
`onEndReached`, `groupBy` and windowing are one switch wearing four names**, and three of the four
fail *silently* — the prop is accepted, typed, and does nothing. No call site trips this today (all
three consumers of the gated props also pass `rowHeight`), which makes it a **loaded trap rather than
a live defect**, and the cheapest thing in this document to close.

### D — Memories lost its windowing to a design decision, and the repo wrote it down

`MemoriesPage.tsx:5-8`:

> *"'Dense' (the KPI strip + sortable matrix layout) is the production baseline as of 2026-06-17: **the
> earlier Baseline virtualized-list layout** and the prototype variant switcher **were retired**…"*

`MemoriesPageDense.tsx:356` is `{sortedMemories.map((memory, i) => <DenseRow …/>)}` inside an
`<AnimatePresence mode="popLayout">` (`:354`) — every row a framer-motion node, no window, no page.
The only bound left is `memorySlice.ts:111`: `const limit = hasSearch ? 500 : 100;` with `offset` a
literal `0` (`:118`) and **no second page anywhere**. So the surface over 6,535 memories renders 100
of them, has no way to reach row 101, and pays 509 ms and 4,001 nodes the moment you type in the
search box. **Windowing was not forgotten here — it was removed, by a layout change that had nothing
to do with it.** That is the strongest argument in the document for making the bound structural rather
than optional: a redesign will drop an optional prop and no gate will notice.

### E — the denominator, measured three ways, and the 6.9× spread

The brief warned that adoption would swing on the denominator, as it did 6.1× for `metric-tile` and 6×
for `tab-strip`. It does — but the swing is not where the brief expected it (§12.7).

| denominator | what it counts | files | bounded by any mechanism | rate |
|---|---|---:|---:|---:|
| **D1** — every file with a JSX `.map()` | includes 3-item chip rows and static option arrays | **955** (1,555 sites) | 63 | **6.6%** |
| **D2** — …that also reach `@/api/**` or a store | list surfaces whose length is data-determined | **398** (691 sites) | 44 | **11.1%** |
| **D3** — call sites of the two shared primitives | the only surfaces that *have* a bound to set | **20** (22 sites) | 10 | **45.5%** |

**D1 → D2 swings only 1.7×. D1 → D3 swings 6.9×.** Both are honest and they answer different
questions: *"how much of this app windows its lists"* (6.6%) versus *"of the surfaces that were handed
a bound and only had to name it, how many did"* (45.5%). Quote D3 for the prescription and D1 for the
scale of the problem, and never quote one as the other.

The fragmentation is real and matches the shape `metric-tile` found: **162 distinct list-container
component names across 175 definitions** (`*List`/`*Table`/`*Grid`/`*Rail`/`*Feed`/`*Rows`/`*Board`/
`*Ledger`/`*Queue`/`*Stream`/`*Timeline`/`*Inbox`), of which **22 call sites** go through a primitive
that even has a `rowHeight` or a `pageSize` to set. **Twelve point six percent of this app's list
containers can be told how many rows to render at all.**

### The rest of the inventory

| | count |
|---|---:|
| virtualization libraries in `package.json` | **1** (`@tanstack/react-virtual ^3.13.24`, resolved 3.13.26) |
| `useVirtualizer({` call sites | **9** |
| `useVirtualList(` consumers | **6** (incl. `UnifiedTable.tsx:528`) |
| `useGroupedVirtualizer` consumers | **3** (incl. `UnifiedTable.tsx:742`) |
| distinct **surfaces** that window their rows | **18** |
| hand-rolled `scrollTop`-derived windowing | **0** — every window in the tree goes through the one library |
| threshold-gated virtualization (below N, render plainly) | **4** — thresholds **50**, **25**, **24**, **40** |
| `<UnifiedTable>` call sites | **17** in 16 files — **6** pass `rowHeight` |
| `<DataGrid>` call sites | **5** — **4** pass `pageSize` (25, 25, 20, and one forwarded) |
| `useLayeredList` (the keyset + sentinel primitive) adopters | **1** |
| `onEndReached` / `useEndReached` wirings | **3** feature sites |
| `scrollRestoreKey` suppliers | **2** feature sites |
| `useProgressiveReveal` adopters | **6** |
| `.slice(0, N).map(` render caps | **66** sites in **54** files — **27 (50%) disclose nothing** |
| `invoke<T[]>` call sites in `src/api/**` | **307** |
| …that pass no `limit` / `offset` / `cursor` / `page` at all | **224 (73%)** |
| census rules in the registry | **157** — **0** key on windowing, paging, load-more or row counts |

---

## Principle (stack-free head)

Per the [portability test](../research/portability-test.md) the head carries no file path, primitive
name or count. Each clause names its warrant.

> **P1 — physics, and the leaf's centre.** **A list container must be told how many rows it may
> render, and "all of them" must not be what it assumes when nobody says.** The number of rows is a
> property of the data; the number of rows a surface can afford is a property of the surface. Where
> the second is left unstated, the first wins by default, and it wins silently — nothing errors,
> nothing warns, the list simply gets slower in proportion to how successful the product is.
> *Warrant: executed — the same component, the same rows, the same columns, differing only in whether
> one optional number was passed: 6,535 rows → 52,281 DOM nodes and 4.46 s versus 23 rows and 28.7 ms;
> and 12 of 22 call sites in this tree omit the number.*
>
> **P2 — physics.** **Bounding the fetch and bounding the render are two decisions and neither
> substitutes for the other.** A fetch limit stops the network and the memory; it does not stop the
> DOM, because a limit big enough to be useful is already big enough to hurt. A window stops the DOM;
> it does nothing about a query that read the whole table.
> *Warrant: adopted from the neighbouring path that owns the other half, which states the same seam
> from its own side; and executed here — a surface bounded only by a fetch limit of 500 pays 509 ms
> and 4,001 nodes, while the same 500 rows through a window pay 29 ms and 186.*
>
> **P3 — physics, and the one nobody expects.** **A sort applied to a window is a claim about the
> window, and a list that pages must never let a sort look like a claim about the corpus.** Either the
> ordering crosses the boundary with the query, or the surface must say what it is ordering. Ranking
> a growing prefix is the one composition where two individually-correct mechanisms — client sort and
> load-more — produce an answer that is not merely incomplete but *wrong*.
> *Warrant: executed on real data — a cost column sorted descending over every page the client can
> load tops out at $3.76 against a corpus maximum of $7.16 and contains 0 of the true top 10; the sort
> is persisted, so the wrong ranking is what the surface opens with next time.*
>
> **P4 — physics.** **Appending a page must not move the rows already on screen.** The reader's
> position is held by a row, not by an offset; any re-ordering that runs after an append breaks the
> only anchor they have.
> *Warrant: executed — with a client sort active, an appended page moves 50 of 50 rows already
> rendered, displaces one by 49 places, and moves the row at mid-viewport down 13; with no client sort
> the same append moves 0 of 50. And, from the other direction, two sibling repos independently
> preserve a scroll anchor when prepending, each with the reason in a comment.*
>
> **P5 — ergonomics.** **A surface that renders fewer rows than exist must say so, in the place where
> the rows stop.** "Showing 100 of 6,535" is not decoration; it is the difference between a list and
> a lie of omission. This is doubly true when the truncation is a *fetch* limit, because then there is
> no scrollbar to reveal it.
> *Warrant: 50% of this repo's render caps disclose nothing; the one repo in the cohort that prints a
> full range and denominator is also the only one that never needed a cap; and the sibling with the
> best affordance says not only how many are hidden but where to see them.*
>
> **P6 — ergonomics.** **A windowing threshold is a legitimate answer, and it must be the same
> threshold everywhere.** Below some N, a window costs more than it saves — measured, that crossing is
> around one to two viewports. Above it, plain rendering is a defect. What is not legitimate is four
> different numbers arrived at four times.
> *Warrant: four threshold gates in this tree at 50, 25, 24 and 40, none referencing another; two
> independent siblings arrived at the same construction with their own numbers (50 and 20). The
> practice is physics; the constant is nobody's.*
>
> **P7 — physics, and the reason this leaf keeps recurring.** **The bound must survive a redesign.**
> An optional prop is not a decision, it is a habit, and a habit does not transfer when the surface is
> rewritten. If windowing matters, it belongs in the primitive's *default* or its *signature* — never
> in a number each call site remembers.
> *Warrant: this repo's largest collection lost its virtualization in a layout change that had nothing
> to do with rendering cost, and the commit wrote the loss down as a feature; and in the cohort, one
> sibling installed a windowing library and imported it at zero sites.*
>
> **Scale condition.** P1 and P2 are wrong on day one and invisible until the corpus outgrows a
> viewport. P3 and P4 bite the first time anyone sorts a paged list — which is the first time the list
> is useful. P5 bites at the first truncation. P6 and P7 are what stop a correct implementation from
> silently becoming an incorrect one two refactors later.

---

## 1. Trigger

- "This table is slow / the tab takes a second to open."
- "Add pagination to this list." / "Add infinite scroll." / "Virtualize this."
- "Show the last N and a 'load more'."
- "It only shows 100 — where are the rest?"
- "I sorted by cost and the expensive one isn't there."
- "The row I was about to click jumped."

**If you are about to write** `.map()` over a collection whose length is decided by the data rather
than by you, **you are in this situation** — and specifically if you are about to render
`<UnifiedTable>` or `<DataGrid>` without naming a bound, or to add a sortable column to a list that
also has a "load more".

You are **not** in this situation for a collection whose length is a property of the *code*: a filter
chip row, a `FILTERS` constant, a form's field list, an enum rendered as options, a fixed 4-step
wizard. Nothing can make those long. Roughly 60% of this repo's 955 `.map()` files are that, which is
exactly why §0-E insists on naming the denominator.

---

## 2. The one way

**Decide the bound at the surface, name it at the call site, and never let the sort outrun it.**
Concretely: (a) **ask first whether the collection's length is data-determined**; if it is not, stop
here. (b) If it is, **bound the fetch first** — that is
[`paginated-list-query`](./paginated-list-query.md)'s job and it is upstream of everything below;
a window over an unbounded query fixes the DOM and leaves the query. (c) Then **bound the DOM**, and
pick by the neighbouring path's own decision rule, adopted here verbatim: *a set bounded by
construction → one clamped fetch plus `DataGrid`'s `pageSize`; a growing table with a short window →
keyset page plus `useLayeredList`; a growing table with a long scroll → keyset page plus
`UnifiedTable` with `rowHeight` **and** `onEndReached`.* **Virtualization never substitutes for a
bounded query; the rows are already in memory by the time it helps.** (d) **Always pass `rowHeight`
to `UnifiedTable`** — it is the master switch for windowing, scroll restoration, infinite scroll and
group headers, and the other three are inert without it; there is no case where omitting it is the
considered choice rather than the forgotten one. (e) **If the list can be sorted and can also grow,
the sort must go to the server** — or the column must not be sortable. A client sort over a growing
prefix ranks the prefix and says nothing about the corpus. (f) **Never re-order after an append**;
let the new page land at the end where the reader is not looking. (g) **Print what is shown against
what exists** wherever the two differ — `showing 100 of 6,535`, `+14 more`, `500+` — and put it where
the rows stop, not in a header the reader has already scrolled past. (h) **If you cap for display,
compute anything derived from the cap over the full set first**, then slice. (i) **Set
`scrollRestoreKey`** on any windowed table in a route that unmounts, keyed by route *and* filters, so
returning to the list returns to the row.

If you must get one right first: **(d)**. It is one prop, it is free, and it converts the four
silent-inert capabilities in §0-C into four working ones.

---

## 3. Mandated primitives

Every one of these exists today. The adopter counts are the finding.

| Primitive | What it gives you | Adopters |
|---|---|---|
| **`src/features/overview/sub_events/components/EventLogList.tsx:441-462`** | **The reference call site, and the only one in the tree that uses the whole contract at once:** `rowHeight={EVENT_ROW_HEIGHT}` + `groupBy` + `scrollRestoreKey` composed from route **and** every filter + `rowReveal={{ resetKey }}` + `onEndReached={hasMoreOlder && !isLoadingOlder ? loadOlder : undefined}`. Copy this block. | 1 |
| **`shared/components/display/UnifiedTable.tsx`** — `rowHeight` | Windows the body through `useVirtualList`, and *only then* arms `scrollRestoreKey` (`:532`), `useEndReached` (`:537`) and the `groupBy` sticky-header path (`:527`). **Pass it. Always.** | 6 of 17 |
| **`hooks/utility/interaction/useVirtualList.ts`** | Thirteen lines over `@tanstack/react-virtual`: `count`, `getScrollElement`, fixed `estimateSize`, `overscan: 5`. The single sanctioned way to window in this repo — there are **zero** hand-rolled scroll-derived windows in 4,829 files, which is a genuinely good state. | 6 |
| **`shared/components/display/GroupedVirtualList.tsx`** — `useGroupedVirtualizer` | Windowing **with sticky group headers**, via a `rangeExtractor` that always injects the pinned header index (`:50-64`). This is the piece a hand-roll gets wrong. | 3 |
| **`shared/components/display/DataGrid.tsx`** — `pageSize` | Page chrome over an in-memory array. Correct **only** when the set is bounded by construction; its footer total is `data.length`, so it cannot express a server total. `FacetedDecisionTable.tsx:105` defaults it to **25**, which is the right shape — a wrapper that makes the bound unforgettable. | 4 of 5 |
| **`hooks/utility/data/useLayeredList.ts`** | L0 counts → L1 keyset first page → L2 `IntersectionObserver` sentinel (`:185-198`), with `inFlightRef`/`hasMoreRef` guards. **The best answer in the repo to a growing table, and it has one adopter.** | 1 |
| **`hooks/utility/interaction/useEndReached.ts`** | Scroll-threshold continuation (`:43`), default threshold 240 px. The alternative to a sentinel when the scroll container is the table's own. **Do not wire both.** | 3 |
| **`hooks/utility/interaction/useScrollRestoration.ts`** | Callback-ref scroll memory in a `globalThis`-backed Map, unseen key → top, seen key → restore, `MAX_RESTORE_FRAMES = 40` (~0.66 s) so it keeps re-trying while virtual content streams in. **The single hardest thing in this leaf to get right, already written, used by two surfaces.** | 2 |
| **`hooks/utility/interaction/useProgressiveReveal.ts`** | Spreads the *mounting* of an already-fetched list over ~2 s so a big table does not big-bang. Owned by [`list-entrance-stagger`](./list-entrance-stagger.md) — named here only because it is **not** a substitute for a window: it delays the cost, it does not remove it. | 6 |

**Explicitly NOT primitives:**

- **`UnifiedTable`'s `rowHeight` as an API.** A bare optional `number` whose absent value silently
  selects the unbounded branch *and* disarms three unrelated props. §4 T1 is the edit.
- **`DataGrid`'s `pageSize = 0`.** Same defect, and worse in one way: `pageSize` reads like a display
  preference, so `0` reads like "no preference" rather than "no limit".
- **A `.slice(0, N)` in the render.** It is a cap, not a strategy: there is no page 2, and 27 of the
  54 files that do it tell the reader nothing.
- **A fetch `limit` as a rendering answer.** `memorySlice.ts:111`'s `hasSearch ? 500 : 100` with
  `offset: 0` and no continuation is not pagination; it is a truncation with a UI on top.

---

## 4. Steps

1. **Ask whether the length is data-determined.** If the array comes from a module constant, an enum,
   or a fixed schema, stop — you are not in this leaf, and adding a window is cost with no benefit.
2. **Bound the fetch.** [`paginated-list-query`](./paginated-list-query.md) owns this and it is
   upstream: a limit with no continuation is a truncation, and a truncation needs P5's disclosure
   whether or not you window.
3. **Choose the DOM bound by the decision rule in §2 (c).** Write the choice down in a comment beside
   the call site; the next redesign needs to know it was a decision (P7).
4. **Pass `rowHeight`.** Size it to the real row, not to the ghost. If the rows are variable-height,
   pass the common case and wrap the row body in `virtualizer.measureElement` — `ExecutionList.tsx:505`
   and `TemplateVirtualList.tsx:162` are the two sites that do this correctly.
5. **Wire the continuation, once.** `onEndReached` **or** a `useLayeredList` sentinel — never both.
   Guard it with an in-flight ref; the threshold fires repeatedly while the fetch is out.
6. **Set `scrollRestoreKey`** to route + entity + every filter that changes the row set. A key that
   omits a filter restores you to a scroll offset in someone else's list.
7. **Decide the ordering at the same time as the paging, not after.** If the list grows and a column
   is sortable, the sort belongs in the query. If you cannot page the sort server-side yet, remove
   `sortable` from the columns that would lie, or label the header with its scope. This is the step
   that is skipped, and it is the one §0-B measures.
8. **Print the scope where the rows stop.** `showing {loaded} of {total}` under the last row, and a
   `+{n} more` on any display cap. If your paging primitive cannot produce a total, that is a real
   limitation to disclose, not to hide (§8 Gap 4).
9. **And then stop.** Do not add a second page-size constant, do not stagger the entrance of a
   windowed row by its absolute index, do not `.slice()` before computing a denominator, and do not
   hand-roll a scroll-derived window — the repo has **zero** of those and that is worth keeping.

### Can the type make the wrong call impossible? — asked before §9

**Yes, and the strongest form of it is a default change, not a new type.** Held against the seven
qualifications in [the doctrine](../golden-path-doctrine.md):

**T1 — invert the default, and make omission mean "bounded".** The bad state is `rowHeight = 0` at
`UnifiedTable.tsx:446` and `pageSize = 0` at `DataGrid.tsx:155`. Both are numbers whose *absent* value
selects the dangerous branch. The minimal edit is one line per primitive: default `rowHeight` to the
density's real row height (44 comfortable / 36 compact — the numbers already exist in
`densityTokens`), and default `DataGrid`'s `pageSize` to 25 the way `FacetedDecisionTable.tsx:105`
already does.

- **Q3 (a type nobody constructs constrains nothing) — the qualification that decides it, and it
  passes overwhelmingly.** This is not a type anybody has to construct: it is a default, and it
  reaches **all 22 call sites at once, including the 12 that are wrong**, with no call-site edit. The
  contract's own rule applies exactly — *"one edit at the primitive corrected ~212 call sites here,
  and no ratchet would have moved a single one"*.
- **Q5/Q6 (withhold the dangerous freedom, not the answer).** The dangerous freedom is *rendering an
  unbounded body by saying nothing*. Withhold it by making the unbounded branch require the word
  `rowHeight={0}` — an explicit, greppable, reviewable statement — instead of being what silence buys.
- **Q1 (a type carries only what it encodes).** Honest limit, and it is large: this closes **§0-A and
  §0-C and nothing else.** It says nothing about the sort (§0-B), the disclosure (P5), or the fetch
  (P2). A default cannot reach a relation between two values, and §0-B is exactly such a relation.
- **Q7 (relaxing a requirement is inert where the caller supplies the bad value voluntarily).** It
  points the same way and is why the *default* is the right lever rather than a required prop: nothing
  forced these 12 authors to omit `rowHeight` — omission was simply the shape of least effort, and a
  required prop would be answered with `rowHeight={0}` by the first person in a hurry. Changing what
  silence *means* is cheaper than changing what silence *costs*.

**T1b — a stronger version, if the churn is acceptable.** Replace the two numbers with one closed
union the caller must name:

```ts
bound: { kind: 'window'; rowHeight: number } | { kind: 'page'; size: number } | { kind: 'all'; because: string };
```

`'all'` remains expressible — some lists genuinely are bounded by construction — but it costs a
sentence, which is what makes it a decision instead of a default. **22 construction sites**, well
inside Q3. Propose T1 first because it is one line and fixes 12 sites the same afternoon; propose T1b
if the leaf recurs.

**T2 — NO for the sort (§0-B), and the reason is the leaf's own finding.** No signature distinguishes
`data` that is the whole corpus from `data` that is a growing prefix; both are `T[]`. A branded
`Page<T>` would be forgeable by anyone with an array (Q4) and, worse, would encode nothing about
*whether the sort key is the paging key* — which is the actual property. **The soundness of a sort is
a relation between the ordering the client applies and the ordering the server paged by**, held at
two different layers, and no type spans it. That is why §9's rule cannot see §0-B either, and why §8
Gap 1 asks for a different instrument.

**And the destination must be fixed before a gate points at it.** Routing people to `UnifiedTable` is
worth little while `UnifiedTable`'s default is the failure mode. Change the default first; the census
rule below is the ratchet that holds the line until it lands, and it is a rule that should *drop* the
moment T1 ships.

---

## 5. Anti-patterns

| Anti-pattern | Failure mode |
|---|---|
| **`<UnifiedTable>` with no `rowHeight`** | Selects the `sortedData.map()` branch. Executed: 6,535 rows → 52,281 DOM nodes, 4.46 s, and no scroll container of its own. **12 of 22 shared-primitive call sites.** §7 D1. |
| **`scrollRestoreKey` / `onEndReached` / `groupBy` without `rowHeight`** | All three accepted, typed, and inert. The prop compiles and does nothing. `UnifiedTable.tsx:527`, `:532`, `:537`. §7 D2. |
| **A sortable column on a list that also loads more** | The sort ranks the loaded prefix and the header says otherwise. Executed: cost ▼ tops out at $3.76 against a corpus max of $7.16, 0 of the true top 10 present at every page. `LlmCallsTable.tsx:178,231,245,259` + `:319`. §7 D3. |
| **Persisting that sort by `tableId`** | The wrong ranking becomes the surface's opening state, forever, across sessions. `UnifiedTable.tsx:479-487`. §7 D3. |
| **Re-sorting after an append** | Executed: 50 of 50 rendered rows move, largest displacement 49, mid-viewport row drops 13. The control with no sort moves 0. §7 D3. |
| **A fetch `limit` with `offset: 0` and no continuation** | Not pagination — truncation with a UI. 100 of 6,535 memories, no row 101, no disclosure. `memorySlice.ts:111-118`. §7 D4. |
| **Retiring a layout and taking its window with it** | The repo's own comment records exactly this: *"the earlier Baseline virtualized-list layout … were retired"*. `MemoriesPage.tsx:5-8`. This is P7's warrant and the reason the bound must be structural. §7 D4. |
| **`.slice(0, N).map()` with nothing telling the reader** | 27 of 54 files. The list looks complete and is not. §7 D6. |
| **A per-row entrance delay keyed on the absolute index inside a window** | The delay becomes a function of scroll position, so a row scrolled to at index 150 waits for 150 rows that already rendered. Not present here — [`list-entrance-stagger`](./list-entrance-stagger.md) owns the fix and this repo caps at 14 rows — but live in a sibling, and named so it stays fixed. §6 clause 3. |
| **A threshold constant invented per surface** | Four gates at 50, 25, 24 and 40, none referencing another, so "when is a list long" has four answers in one app. §7 D5. |
| **A hand-rolled scroll-derived window** | Off-by-one at the boundary, wrong on resize, no `measureElement`. **0 occurrences — this repo already got it right**, recorded so it stays that way. |
| **Expanding a windowed row without `measureElement`** | `estimateSize` puts the next row on top of the detail. Both windowed surfaces that expand get it right ([`expandable-row`](./expandable-row.md) §7 owns this); named so a third does not. |

---

## 6. Evidence

**The ONE site to copy: `src/features/overview/sub_events/components/EventLogList.tsx:441-462`.**

```tsx
<UnifiedTable<PersonaEvent>
  columns={columns}
  data={displayedEvents}
  getRowKey={(e) => e.id}
  isLoading={isFetching}
  rowHeight={EVENT_ROW_HEIGHT}                                    // (1) the window, and the switch
  scrollRestoreKey={`overview/events|status=${statusFilter}|type=${typeFilter}` +
                    `|persona=${selectedPersonaId ?? 'all'}|trigger=${triggerFilter}`}  // (2)
  rowReveal={{ resetKey: `${statusFilter}|${typeFilter}|…` }}      // (3)
  groupBy={groupOf}                                               // (4)
  onEndReached={hasMoreOlder && !isLoadingOlder ? loadOlder : undefined}  // (5)
/>
```

Five decisions worth copying: **(1)** `rowHeight` is passed, so the other four props are live at all;
**(2)** the restore key names the route *and every filter*, so returning to a differently-filtered
list starts at the top instead of at a stranger's offset; **(3)** the reveal reset key is the same
composition, so the cascade replays on a scope change and not on a refetch; **(4)** grouping is on the
windowed path, where `GroupedTableBody` owns its own scroller and **re-arms `onEndReached` on it**
(`UnifiedTable.tsx:633` → `:739`); **(5)** the continuation is guarded by both `hasMore` and the
in-flight flag, and is `undefined` — not a no-op function — when there is nothing more, which is what
lets the primitive skip the listener entirely.

Its data side is `useEventLog.ts:20-21` (`INITIAL_LIMIT = 50`, `LOAD_MORE_LIMIT = 50`) with a
`serverHasMore` flag rendered as a `+` in the subtitle (`EventLogList.tsx:284`) — **the only place in
this repo that discloses server truncation in the list's own chrome**, and it costs one character.

**Secondary exemplars, each for one property:**

| Site | What to copy |
|---|---|
| `agents/sub_executions/components/list/ExecutionList.tsx:141-144`, `:499-505`, `:544` | **Window + variable height + explicit continuation.** The comment states the contract — *"Row virtualization — only visible rows mount. `estimateSize` is an initial guess; each row wraps its content with `virtualizer.measureElement` so the real (and expandable) height is measured dynamically"* — and the "Load more" button names its own page size, `tx(e.load_more, { count: PAGE_SIZE })`. |
| `shared/components/display/GroupedVirtualList.tsx:50-64` | **The `rangeExtractor` that keeps the pinned group header in the range.** The one part of windowed grouping a hand-roll always misses. |
| `hooks/utility/interaction/useScrollRestoration.ts:14-16`, `:46`, `:95`, `:110` | **The rule written down** — unseen key → top, seen key → restore — plus `MAX_RESTORE_FRAMES = 40`, which is what makes restoration work *into a window whose content is still streaming in*. |
| `hooks/utility/data/useLayeredList.ts:147-198` | **Keyset + counts + sentinel in one hook**, with `inFlightRef` and `hasMoreRef` guards. One adopter; deserves twenty. |
| `shared/components/display/FacetedDecisionTable.tsx:105` | **`pageSize = 25` as a wrapper default.** The shape T1 proposes, already shipped once: three consumers inherit a bound none of them had to remember. |
| `agents/sub_lab/components/shared/VirtualizedTableBody.tsx:5,19` · `settings/sub_byom/components/ByomAuditLog.tsx:9,78` · `schedules/libs/scheduleListItems.ts:93` | **The threshold gate**, three times — `> 50`, `> 25`, `>= 24`. The *practice* is right (P6) and independently reinvented in the cohort; the *numbers* are three unshared constants (§7 D5). |

### Convergence — 5 sibling repos, effective cohort 4

Swept read-only against `../personas-web`, `../brainiac`, `../personas-cloud`, `../vibeman`,
`../ascent`. **All five exist and all five were opened.** `personas-cloud` contains **zero `.tsx`
files** — its paging is server SQL only (`packages/orchestrator/src/db.ts:770`, `MAX_LIMIT = 1000` at
`httpApi.ts:2372`) — so it is **structurally absent** from this leaf, not silent about it. Effective
independent cohort: **4**.

**Lineage, checked in both directions and clean.** No component name from this repo's list stack
appears in any sibling (one false positive: the literal string `'DataGrid'` inside a fake-component
array in a vibeman test fixture). Every sibling arrived through a **different library** — vibeman
`react-window` v2, personas-web `react-virtuoso` (declared, never imported), brainiac and ascent none
— and no comment, constant or error string is shared. **Nothing below is a port agreeing with its
original.** Caveat worth stating: [`metric-tile`](./metric-tile.md) found `personas-web`
self-declaring as a re-implementation of this desktop app **41 times** and discounted it to a half
vote. On *this* leaf the discount does not apply, because its answer is a library this repo does not
use and a page size (10) matching none of ours.

| # | clause | verdict | evidence |
|---|---|---|---|
| 1 | **Window a long list at all** | **PERSONAS ALONE, and far ahead (1 of 4 has any, and its own is unwired)** | Personas: **18 windowed surfaces** over one library. vibeman: 2 real `react-window` sites (`CompactTerminal.tsx:5`, `ContextSection.tsx:5`), 1 **dead** wrapper (`ui/VirtualList.tsx`, zero importers, and mixing v1 props into the v2 `List`), 1 hand-rolled grid culler (`useVirtualizedGrid.ts`, `BUFFER_CELLS = 2`). **personas-web declares `react-virtuoso` in `package.json:45` and imports it at zero sites** — a windowing library bought and never wired. brainiac **0**, ascent **0**. The fleet has not converged on this; Personas is the only member with a real answer, and §0 measures how unevenly it is applied. |
| 2 | **Gate the window behind a threshold — below N, render plainly** | **PHYSICS (2 of 2 repos that window at all)** | vibeman `CompactTerminal.tsx:71` — `const VIRTUALIZATION_THRESHOLD = 50; // Start virtualizing after this many logs` — and `ContextSection.tsx:76` — `// Use threshold to decide virtualization` / `shouldVirtualize = context.ideas.length > 20`. Personas: `VIRTUALIZE_THRESHOLD = 50`, `= 25`, `SCHEDULE_WINDOWING_THRESHOLD = 24`, and a scroll-element gate at ~40. Two teams, no shared document, the same construction — **and five different constants between them.** P6 is physics; the number is nobody's. |
| 3 | **Never key an entrance delay on an absolute index inside a window** | **PERSONAS ALONE — and the fleet's worst violation is instructive** | Personas caps at `REVEAL_CASCADE_ROWS = 14` (`UnifiedTable.tsx:207`). vibeman's `ContextSection.tsx:84` renders `IdeaCard` with `index={startIdx + colIndex}` **inside the react-window row renderer**, at `delay: index * 0.03` uncapped — so a card scrolled to at row 50 gets `index ≈ 150` and a **4.5-second entrance on a card the user just scrolled to.** Virtualization and index-keyed stagger fighting each other, in production. Owned by [`list-entrance-stagger`](./list-entrance-stagger.md); recorded here because it is the *interaction* that only exists once a list is windowed. |
| 4 | **Restore a list's scroll position across navigation** | **SILENCE — 0 of 4 — and Personas is the only codebase in five with the mechanism** | Zero siblings save or restore a list `scrollTop`. What they have instead is stick-to-bottom on live logs (a different thing — `live-log-stream-view`'s), or the *opposite*: vibeman's `IdeaCard.tsx:50` and `DirectionCard.tsx:261` do `scrollTop = 0` on purpose. ascent has `sessionStorage` machinery in four places and points none of it at a list. Personas has `useScrollRestoration` **and uses it on 2 of 18 windowed surfaces.** Ahead of the fleet on having it; behind its own primitive on using it. |
| 5 | **An `IntersectionObserver` sentinel to page a list** | **SILENCE — 0 of 4, and Personas' own adoption is 1** | Nobody in the cohort uses one. brainiac ships explicit prev/next; ascent one "Load more" button; vibeman a scroll-offset threshold duplicated verbatim in two files (`ScanResultsModal.tsx:40-62`, `BuildErrorResults.tsx:66-88`, both opening `// Infinite scroll handler`, both batching 20, one carrying `// Simulate loading delay for smooth UX` on a 300 ms `setTimeout` over purely local data and the other keeping the delay and dropping the explanation). **The fleet's revealed preference is an explicit control, not a sentinel** — which is worth weighing before evangelising `useLayeredList`. |
| 6 | **Disclose that rows were hidden — `+N more`** | **PHYSICS (3 of 4, same template, independently)** | vibeman **8 of 19** capped lists disclose; ascent **8 of 15**; brainiac 1 of 4 (a denominator in the header, not a count of the hidden); personas-web **0 of 12**. vibeman and ascent independently landed on the identical string shape `+{arr.length - N} more`. **Personas: 27 of 54 (50%)** — mid-pack. The best affordance in six codebases is ascent's `TeamAdoption.tsx:10,54-56`: `const SHOW_LIMIT = 8` → *"+N more teams **on the Teams tab**"* — it says how many are hidden **and where to see them**. |
| 7 | **Print rendered against existing — "showing N of M"** | **`brainiac` ALONE (1 of 4), and it is what the practice looks like done properly** | `AuditLedger.tsx:159-161`: `showing ${offset + 1}–${offset + events.length} of ${total.toLocaleString()}`, with an explicit `showing 0 of ${total}` zero-state. Range, denominator, separators. vibeman has 4 real instances and 11 silent caps; ascent renders `{entries.length} shown` with **no denominator anywhere in the product** — the honest cost of choosing a keyset cursor, which it does not paper over. Personas has one (`EventLogList.tsx:284`'s `500+`) and it is a suffix, not a sentence. |
| 8 | **Which paging strategy** | **DIVERGED — no two agree, 4 of 4 different** | brainiac offset/`LIMIT … OFFSET` executed in Rust (`console.rs:548`, `:1681`) with page sizes 25/80/25/50 and a documented server clamp; ascent **keyset cursor**, the only one in six, with an n+1 probe (`scans-audit.test.ts:215`) and a `CSV_MAX_ROWS = 10000` cap carrying a comment headed **`// TRUNCATION HONESTY`**; vibeman client `.slice` (`ITEMS_PER_PAGE = 20`); personas-web client `.slice` on exactly one surface (`PAGE_SIZE = 10`), every other dashboard list unpaginated. The spine's `diverged` intuition holds for the *strategy* even though `mixed` holds for the leaf. |
| 9 | **A guard against a superseded page landing** | **`ascent` ALONE (1 of 4) — and it wrote the postmortem in place** | `AuditLogViewer.tsx:92-96`: *"Monotonic request token: every `load()` takes the next id; a response only applies if it's still the latest. Without it, rapidly changing the action filter raced two un-sequenced fetches and whichever resolved LAST won — landing rows that disagree with the selected filter, or **appending a 'Load more' page from a superseded filter** (duplicate / foreign `e.id` rows, possible React key collisions)."* Personas has the mechanism ([`stale-response-guard`](./stale-response-guard.md), 36 files) but no load-more path applies it to an *append*. §8 Gap 5. |

**Physics — keep as doctrine:** clauses 2 and 6.
**Personas alone / ahead:** clauses 1, 3, 4 (mechanism) — and behind its own primitive on 4's adoption.
**One-repo-alone, worth adopting:** clauses 7 (brainiac) and 9 (ascent).
**Silence:** clauses 4 and 5, plus `personas-cloud` having no UI at all.
**Diverged:** clause 8.

### Composition defects with the neighbouring paths — offered upward

**(i) with [`paginated-list-query`](./paginated-list-query.md).** Its step 10 says *"Add `rowHeight` if
the loaded window can exceed a few hundred rows"*, and its §2 says to reach for `DataGrid`'s
`pageSize` only for bounded sets. Both correct. **Composed with this repo's defaults they produce the
wrong outcome by silence**: a developer who follows both and simply *doesn't decide* gets the
unbounded branch, because "no bound named" and "bound named as unbounded" are the same source text.
The one-line clause both paths need: *a bound not named is not a bound not needed — say `rowHeight={0}`
if you mean it.*

**(ii) with [`filtering-and-search`](./filtering-and-search.md).** Its step 7 prescribes
`<DataGrid key={filterKey} …/>` to reset the page on a filter change. **That remount destroys the
window's scroll position and, in a windowed table, its restore key is doing the opposite job.** The
two are compatible only if the restore key *contains* the filter key — which is exactly what
`EventLogList.tsx:458` does and nothing else in the tree does. Offered upward as a shared clause:
*the filter key, the page-reset key, the reveal reset key and the scroll-restore key are one value;
name it once.* Its Gap 9 asks for precisely this from the other side.

**(iii) with [`aggregate-count-display`](./aggregate-count-display.md).** Its P4 is *an unknown count
is not zero*; this leaf's P5 is *a shown count is not a total*. **They are the same law against
different quantities**, and they compose into the concrete ask neither can make alone: `DataGrid`'s
footer reads `data.length` (`DataGrid.tsx:520-523`) — which is simultaneously the count that path polices
and the window this path bounds. A footer over a windowed or server-paged list must take the total as
a prop, because the array cannot know it.

**(iv) with [`list-entrance-stagger`](./list-entrance-stagger.md).** Its own §7-C already names
`TemplateVirtualList.tsx:165` and `PresetLibraryPage.tsx:84` as cascades inside unbounded lists with
no first-viewport bound, *"so every row fades the first time it is scrolled into view — a permanent
shimmer rather than an arrival"*. **That is this leaf's territory read from that path's side:** the
defect is not the delay, it is that *inside a window, "first mount" and "first arrival" stop being the
same event*. Its id-guard is the fix and this path endorses it without restating it; what this path
adds is the rule — **an entrance may be keyed on arrival order, never on an index into a windowed
array.**

---

## 7. Deviations

Every entry is live on `master` @ `e21dfeb0d`, verified by reading the file and — where a number is
quoted — by replay in the jsdom harness against a read-only copy of the operator's database.
**Nothing here was applied.** Per the campaign's standing rule, anything that changes what a live
surface renders is a note.

### D1 — 12 of 22 shared-primitive call sites name no bound · **executed**

`UnifiedTable.tsx:446` (`rowHeight = 0`) + `:523` + `:674`; `DataGrid.tsx:155` (`pageSize = 0`) +
`:227-231`.

The twelve, with what feeds each:

| site | data | real N today |
|---|---|---|
| `overview/sub_usage/components/ToolPerformancePanel.tsx:208` | `visibleRows` | bounded upstream at `DEFAULT_LIMIT = 8` (`:22`) |
| `recipes/sub_playground/tabs/RecipeOverviewTab.tsx:63` | `inputs` | a recipe's input schema — bounded by construction |
| `settings/sub_devices/components/PairedDevicesPanel.tsx:171` | `devices` | paired devices, single digits |
| `vault/sub_databases/DatabaseListView.tsx:116` | `displayRows` | db-kind credentials, 25 total |
| `plugins/dev-tools/sub_projects/ProjectManagerPage.tsx:490` | `projects` | 14 dev projects |
| `agents/sub_activity/ActivityList.tsx:174` | `items` | `listExecutions(personaId, 50)` merged with reviews + memories; the top persona holds 292 memories |
| `agents/sub_lab/components/versions_table/LabVersionsTable.tsx:325` | `rows` | prompt versions per persona |
| `overview/sub_certification/components/RunHistoryView.tsx:118` | `runs` | `list_eval_runs`, **no limit** |
| `overview/sub_certification/components/GroundingTable.tsx:73` | `grounding` | per-file citation grounding, scorecard-sized |
| `overview/sub_observability/components/AthenaSpendSection.tsx:141` | `rows` | ledger × day × origin |
| `settings/sub_devices/components/RemoteJobsPanel.tsx:122` | `jobs.jobs` | remote jobs |
| `shared/components/surface/SurfaceRenderer.tsx:312` | `rows` | **model-composed** — the row count is chosen by a language model |

Two honest classifications, and they should be read together. **On the rule's stated condition — the
call site names no bound — precision is 12/12.** On the stricter question *"can this render more rows
than a viewport today, on the operator's data"*, four are bounded by construction upstream
(`ToolPerformancePanel`, `RecipeOverviewTab`, `PairedDevicesPanel`, `DatabaseListView`) and the rest
are small **today**. **The last one is the interesting one:** `SurfaceRenderer` renders a table whose
row count comes out of a model's response, which is the one input in this app nobody bounds by
reviewing the code.

**Fix (note):** T1 — default `rowHeight` to the density's row height. One line, reaches all twelve.

### D2 — `scrollRestoreKey`, `onEndReached` and `groupBy` are silently inert without `rowHeight` · **executed**

`UnifiedTable.tsx:527` (`grouped = !!groupBy && useVirtual`), `:532` (the restore ref is attached only
on the virtual branch, at `:639`), `:537` (`useEndReached(parentRef, …)` watches a ref that stays
`null`).

Executed in §0-C: with `rowHeight` omitted the component renders no scroll container at all, so all
three props are accepted and do nothing. **No call site trips it today** — the three consumers of
those props all pass `rowHeight` — so this is a loaded trap, not a live defect. It is listed at D2
because it is one line from becoming live, invisible when it does, and the failure mode is "the
feature you added silently isn't there".

**Fix (note):** a dev-mode invariant in `UnifiedTable` — `if (!useVirtual && (scrollRestoreKey ||
onEndReached || groupBy)) logger.warn(…)` — or T1, which removes the branch these props fall off.

### D3 — a persisted client sort over a growing window, at the surface that reports spend · **executed, the leaf's second headline**

`LlmCallsTable.tsx:178`, `:231`, `:245`, `:259` (four `sortable` columns with `sortFn`s), `:313`
(`defaultSortKey="time"`), `:315` (`tableId="overview-llm-calls"` → the sort persists to
`localStorage` via `UnifiedTable.tsx:479-487`), `:319` (`onEndReached`), against
`overviewSlice.ts:149-150` (`GLOBAL_PAGE_SIZE = 50`, `MAX_GLOBAL_LIMIT = 500`) and
`UnifiedTable.tsx:499-514` (the sort, over `data`).

Measured in §0-B on the real 2,188 executions: top row `$2.5254` at page 1, `$3.7646` at the client's
own 500-row ceiling, corpus maximum `$7.1604`, **0 of the true top 10 present at every page**; and on
append, **50 of 50** rendered rows move against a control of **0 of 50**.

`EventLogList.tsx:260` has the same composition with one sortable column (`created`) — benign only
because that column *is* the paging key, which is precisely the discriminator §4 T2 says no type can
express.

**Fix (note):** either push the sort to the query (the `list_all_executions` door already takes
`sort_column`/`sort_direction` for memories, so the pattern exists in-repo), or drop `sortable` from
the three columns that are not the paging key, or label the header with its scope. **Do not fix this
by removing `onEndReached`** — the list would then be silently truncated instead of silently
misordered, which is worse.

### D4 — the Memories page: 100 of 6,535, no row 101, and the window was deliberately removed

`memorySlice.ts:111` (`const limit = hasSearch ? 500 : 100;`), `:118` (`offset` literal `0`),
`MemoriesPageDense.tsx:354-356` (unbounded `.map` inside `AnimatePresence mode="popLayout"`),
`MemoriesPage.tsx:5-8` (the provenance comment).

Executed: the shipped configuration costs **99.1 ms / 801 nodes**; the search configuration costs
**509.5 ms / 4,001 nodes** — and both are framer-motion nodes in production, which the harness's plain
`<div>` transcription *under*-counts. `memoriesTotal` is fetched and held in the slice
(`:126`) and never rendered beside the list.

This is [`aggregate-count-display`](./aggregate-count-display.md)'s dialog seen from the list side:
that path measured the *confirmation* saying 100 and deleting 6,535; this one measures why 100 is the
only number the surface has.

**Fix (note):** `rowHeight` on a `UnifiedTable` (this surface is hand-rolled, so it is a rewrite, not
a prop) or, minimally, `showing {memories.length} of {memoriesTotal}` under the last row — one line,
no behaviour change, and it converts a silent truncation into a stated one.

### D5 — four windowing thresholds, four constants, no shared home

`agents/sub_lab/.../VirtualizedTableBody.tsx:5` (`VIRTUALIZE_THRESHOLD = 50`),
`settings/sub_byom/components/ByomAuditLog.tsx:9` (`VIRTUALIZE_THRESHOLD = 25` — **same identifier,
different value, different file**), `schedules/libs/scheduleListItems.ts:93`
(`SCHEDULE_WINDOWING_THRESHOLD = 24`), `agents/quick-answer/triage/deck/DeckQueueRail.tsx:189-193`
(the scroll element is handed to the virtualizer only above ~40).

The practice is right and independently reinvented in `vibeman` (§6 clause 2). The constants are four
answers to one question, and two of them share a name. Row-height estimates fragment the same way:
**22, 32, 36, 40, 44, 52, 56, 64** across the tree, with `useVirtualList`'s own default at 56.

**Fix (note):** one exported `WINDOW_ABOVE_ROWS` beside `useVirtualList`, with the reason on the line.

### D6 — half the render caps disclose nothing · **measured, 54 files**

**66 `.slice(0, N).map(` sites in 54 files; 27 files (50%) contain no disclosure of any kind** — no
`+N more`, no show-all toggle, no denominator. The list simply ends. Among them:
`plugins/dev-tools/sub_projects/CrossProjectMetadataModal.tsx:181,209,405,429` (four caps in one
modal, at 8/8/30/10), `agents/sub_executions/components/CircuitBreakerIndicator.tsx:338` (20 recent
transitions), `fleet/monitor/channels/Stream.tsx:311` (12 callsign facets),
`shared/chrome/CommandPalette.tsx:235` (12 results — a search box that silently drops matches),
`overview/sub_health/.../insights/CascadePanel.tsx:68` (12).

Personas at 50% sits between `personas-web` (0 of 12) and `ascent` (8 of 15); the practice is physics
in the cohort (§6 clause 6) and half-adopted here.

**Fix (note):** the shared `+N more` affordance `filtering-and-search` Gap 6 already asked for
(`<ScopeNote loaded={n} corpus={m}/>`). One component closes both asks.

### D7 — `useLayeredList` has one adopter and `useScrollRestoration` has two

`hooks/utility/data/useLayeredList.ts` — L0 counts, L1 keyset page, L2 sentinel, in-flight and
has-more guards, 205 lines — is consumed by exactly one feature
(`overview/sub_manual-review/hooks/useManualReviewQueue.ts:40`), while **12** surfaces hand-roll a
continuation. `useScrollRestoration` is supplied a key by **2** feature sites
(`EventLogList.tsx:458`, `GlobalExecutionList.tsx:438`) out of 18 windowed surfaces — so **16 windowed
lists lose the reader's position on every navigation away**, which is the defect
[`tab-strip`](./tab-strip.md) measured from the other direction when it found `scrollTop = 640`
*surviving* an unkeyed swap. Both halves of that finding are this leaf's: a scroll offset survives
where it should not, and is discarded where it should not.

**Fix (note):** none applied — adoption, not a defect. Recorded so the primitives are not rewritten by
somebody who could not find them.

### D8 — `SurfaceRenderer` renders a model-chosen number of rows, unbounded

`shared/components/surface/SurfaceRenderer.tsx:285` (`const rows = useMemo<SurfaceTableRow[]>`) →
`:312` (`<UnifiedTable … data={rows}>` with no `rowHeight`). The row count originates in an LLM
response. Every other entry in D1 is bounded by something a reviewer can read; this one is bounded by
what a model decided to emit. [`model-composed-ui`](./model-composed-ui.md) owns the envelope; the
row cap is this leaf's.

**Fix (note):** `rowHeight` plus an explicit cap with disclosure — this is the one site where the cap
should be defensive rather than aesthetic.

### D9 — `credential_audit_log` holds 3,813 rows for a single credential behind a 500-row fetch and a 20-row page

`vault/sub_credentials/components/features/CredentialIntelligence.tsx:48`
(`getCredentialAuditLog(credentialId, 500)`) →
`vault/sub_credentials/components/features/AuditLogTable.tsx:23` (`AUDIT_PAGE_SIZE = 20`), `:36`
(`filtered.slice(auditPage * 20, …)`).

Measured on the live copy: the busiest credential has **3,813** audit rows of the table's 9,803. So
the page control is correct and honest about its 500 — and the 500 is **13% of what exists for that
credential**, with the tab label reading `{auditLog.length}` (`CredentialIntelligence.tsx:94`), i.e.
"500". **The DOM is properly bounded and the surface still misreports the corpus by 7.6×.** This is
the cleanest demonstration in the document that P2 and P5 are separate obligations: getting the render
right does not get the disclosure right.

**Fix (note):** the count door exists (`credential_audit_log_global` clamps at
`limit.unwrap_or(200)`); a `count` beside the list, or the `+` suffix `EventLogList` already uses.

---

## 8. Gaps

1. **No instrument can see D3.** Whether a client sort is sound depends on *whether the sort key is
   the key the server paged by* — a relation between two layers, one of which is a string in a column
   declaration and the other a Rust `ORDER BY`. No type spans it (§4 T2); no regex spans it; the
   census counts presences, and this is an agreement. **The instrument that would find it is a test
   that mounts the table over page 1, appends page 2, and asserts the rendered order is a prefix of
   the corpus order** — which the harness in this document does, and which nothing in the repo does.
2. **No primitive spans paging and windowing.** `UnifiedTable` windows and cannot paginate;
   `DataGrid` paginates and cannot window; `useLayeredList` pages and knows nothing about tables. A
   surface that is server-paged, windowed and needs an `N of M` footer assembles three pieces by hand
   — which is exactly the assembly `EventLogList` performs and nobody else repeats.
   [`paginated-list-query`](./paginated-list-query.md) Gap 1 states this from its side; it is
   restated here only to record that **the one surface that does it well is not reusable** — it is
   400 lines of feature code, not a primitive.
3. **`useVirtualList` fixes `estimateSize` and `overscan: 5` for every caller.** Thirteen lines, no
   variable-height support, no `measureElement` plumbing — so the two surfaces with variable rows
   (`ExecutionList`, `TemplateVirtualList`) reach past it to `useVirtualizer` directly, and
   `UnifiedTable` cannot support a variable-height row at all. That is why expandable rows and
   `UnifiedTable` do not compose ([`expandable-row`](./expandable-row.md) Gap 1, same wall from the
   other side).
4. **Nothing can render `N of M` from the paging primitives.** `useLayeredList` exposes no total;
   `DataGrid`'s footer computes `data.length`; `UnifiedTable` has no footer. P5's prescription
   therefore has no primitive behind it, which is a large part of why 27 of 54 caps are silent.
   `ascent` has the same gap and states it plainly rather than faking a denominator — the honest
   posture when a cursor genuinely cannot count.
5. **No append is guarded against a superseded page.** The repo has a stale-response mechanism
   ([`stale-response-guard`](./stale-response-guard.md), 36 files) and `overviewSlice` uses a sequence
   counter for *replacement* fetches (`:152`) — but the three `onEndReached` consumers guard only with
   an in-flight boolean, which prevents concurrency and not staleness: change the filter mid-fetch and
   the page that lands belongs to the previous filter. `ascent` hit this, fixed it, and wrote the
   postmortem in the file (§6 clause 9). **Not yet observed here** — recorded as the next defect this
   surface will produce.
6. **A window and a first-viewport cascade disagree about what "first" means.** `REVEAL_CASCADE_ROWS =
   14` bounds the cascade by *index*, which inside a window is a scroll position. The id-guard makes
   it one-shot so the damage is bounded, but the semantics are wrong: rows 15+ never animate even on
   their genuine first arrival. Owned by [`list-entrance-stagger`](./list-entrance-stagger.md);
   recorded because the fix needs a concept ("first arrival") that only exists once you are windowed.

---

## 9. The missing gate

**The condition, stated stack-free:** *a list container is handed a collection whose length is decided
by data, and is never told how many of those rows may enter the DOM — so the surface's cost is a
function of how successful the product has been, and nothing reports it.*

**The signal (a proxy, and stated as one):** a **render of one of the two shared table primitives
whose opening tag names no bound** — no `rowHeight`, no `pageSize`, no `simplified`. This keys on the
shape the condition wears **in this repo**, where a list container is a JSX element and a bound is a
prop on it. **An adopting repo must re-derive its own proxy** — a Vue `<n-data-table>`, a
server-rendered `{% for %}`, a `FlatList` without `windowSize`, a Blazor `<Virtualize>` — none of
which this pattern can see. What generalises is the *question*: **find the place where a container
meets a data-length collection, and check whether a bound is named there.**

**Why the primitive call site and not the 955 `.map()` files.** Measured: a rule anchored on "a JSX
`.map()` with no bounding mechanism in the file" matches **890 of 955 files** — and hand-reading a
sample shows the overwhelming majority are filter chips, option lists and fixed schema rows. That is
the same ≥84%-false-positive shape [`filtering-and-search`](./filtering-and-search.md) correctly
declined at, and it is declined here for the same reason. **The narrow anchor is the honest one: it
covers only the surfaces that were handed a bound and only had to name it.**

**The mechanism: a census rule.** The runner exists (`scripts/census/`) and implements the fail-loud
contract, so this path writes no script.

**Where it executes:** `npm run census:check` runs inside `npm run check` **and** as the
`golden-path-census` **pre-push** job (`lefthook.yml`). That matters: `ci.yml` is red on 10
pre-existing failures, so a gate that only runs in CI runs nowhere. This one fails the push.

**The population partitions exactly.** Anchor = every render of `UnifiedTable` or `DataGrid`:

| | files | matches |
|---|---:|---:|
| **anchor** — a render of either shared table primitive | **20** | **22** |
| ↳ **violating** — no `rowHeight` / `pageSize` / `simplified` named | **12** | **12** |
| ↳ **compliant** — a bound named (the positive control) | **9** | **10** |
| ↳ **excluded, by name and with reasons** | **2** | — (the two primitives themselves) |

12 + 10 = 22, exactly, and 20 files = 12 + 9 minus the one file carrying two compliant renders
(`IpcPerformancePanel.tsx:215,230`).

**Precision, hand-verified 12/12 on the stated condition** — every match opened, and the twelve are
tabulated with their data sources in §7 D1. On the stricter question *"can this exceed a viewport on
the operator's data today"* it is **8 of 12**: `ToolPerformancePanel` (fetch limit 8),
`RecipeOverviewTab` (a schema), `PairedDevicesPanel` (single digits) and `DatabaseListView` (25 rows)
are bounded upstream. **They are kept in deliberately**, because the rule's condition is *"the call
site names no bound"* and each of them is one product decision away from being long — the fourth,
`DatabaseListView`, is a `DataGrid` whose four siblings all pass a `pageSize` and which is
[`filtering-and-search`](./filtering-and-search.md) §7-B's own miscount (§12.6).

**Two independent implementations agreed on the anchor (22) and on the partition (12/10) — after
disagreeing twice, and both disagreements were bugs in a matcher, not facts.** Implementation #1 is a
standalone brace-matching JSX scanner; #2 is the census rule. §12.4 reports both causes.

**Existing rules checked for overlap first — at the SITE level, against the FINAL pattern, by
re-running every reachable rule's own pattern and intersecting.** All **157** registry rules were
read; the **76** whose roots and extensions can reach `src/**/*.tsx` were run:

| neighbour rule | its files | **site** overlap with my 12 | **file** overlap |
|---|---:|---:|---:|
| `typo-token-overpainted` (`design-token-usage`) | 824 | **0** | 5 |
| `native-title-tooltip` (`tooltip`) | 571 | **0** | 5 |
| `hand-rolled-disabled-state` · `hand-rolled-stale-token` · `bindingless-catch-on-io` | 361 / 36 / 84 | **0** | 1 each |
| `hand-assembled-currency` · `locale-blind-percent` · `host-locale-date-render` | 39 / 55 / 53 | **0** | 1 each |
| **`absent-entity-count-as-zero`** ([`aggregate-count-display`](./aggregate-count-display.md)) | 30 | **0** | 1 |
| **`unreconciled-selection-set`** ([`bulk-selection-actions`](./bulk-selection-actions.md)) | 9 | **0** | 1 |
| **`hand-rolled-row-stagger`** ([`list-entrance-stagger`](./list-entrance-stagger.md)) | 4 | **0** | **0** |
| **`call-site-text-match`** ([`filtering-and-search`](./filtering-and-search.md)) | 56 | **0** | **0** |
| **`stateless-disclosure-control`** ([`expandable-row`](./expandable-row.md)) | 56 | **0** | **0** |
| `unconsulted-tail-pin` ([`live-log-stream-view`](./live-log-stream-view.md)) · 65 others | 13 / — | **0** | **0** |

**Site overlap is 0 against every rule in the registry**, and **0 rules of 157 key on windowing,
paging, load-more, scroll restoration or row counts at all** — the territory is entirely ungated
today. The largest *file* overlap is 5 of 12 with two rules matching 824 and 571 files (17% and 12%
of the `.tsx` tree): co-location, not duplication. The nearest neighbours by subject are at **0 files
and 0 sites**, and the reason is structural — they key on a *class name*, a *string comparison*, a
*button*, an *`animationDelay`*; this keys on the **absence of a prop on a specific element**.

**Disclosed recall gap, and it contains this document's own second headline.** The pattern asks
*"is a bound named on this element"*, not *"is the list bounded"* and certainly not *"is what the list
claims true"*. So it **cannot see D3** — `LlmCallsTable` passes `rowHeight={52}` and scores
**compliant** while sorting a growing prefix and reporting `$3.76` for a `$7.16` corpus. It cannot see
D4 (`MemoriesPageDense` hand-rolls its list and is invisible to a rule anchored on the primitives),
D6 (`.slice(0, N)` caps), D7 (adoption of a primitive nobody calls), or any of the **162** other list
containers in the tree. **True recall over surfaces carrying this condition is roughly 12 of 30-plus,
and it misses the two worst** — which is the honest thing to say about a signal keyed on a **prop's
presence** when half the condition is a **relation between an ordering and a paging key** (§8 Gap 1).

**How it fails loudly if its own precondition is absent** — executed against the working tree in a
private scratch registry, exit codes captured directly, never through a pipe:

```
baseline (12 files / 12 matches; control 9/10)   -> exit 0
floor 3000 > 2104 .tsx walked                    -> exit 1   "THE MATCHER IS BROKEN, NOT THE CODEBASE CLEAN"
pattern -> a token appearing nowhere             -> exit 1   "matched zero files anywhere"
roots renamed away                               -> exit 1
extensions -> .svelte                            -> exit 1
exclude path renamed to a missing file           -> exit 1   "the exemption is stale"
exclude reason shortened to "x"                  -> exit 1   "needs a real reason"
goldenPath removed                               -> exit 1   "missing grounding"
baseline deflated (a rise)                       -> exit 1
baseline inflated (a silent drop)                -> exit 1
positive control given a baseline                -> exit 1   "must NOT carry a baseline"
GATE POINTED AT THE COMPLIANT FORM               -> exit 1   files 12 -> 9, matches 12 -> 10
```

The last row is the control's real job: **the two counts must move in opposite directions.** If
`unbounded-shared-table-render` falls while the control stays flat, a table was **deleted** or moved
off the shared primitive rather than bounded — and a ratchet would otherwise have recorded that as
progress. That failure mode is not hypothetical here: it is exactly what happened to the Memories page
(§7 D4), where a surface left the primitive and the tree got *worse* while every count that existed at
the time would have improved.

**Validated standalone** with
`node scripts/census/run-census.mjs --rules <scratchpad>/rules-long-list-rendering-llr7k.json --check`
— a filename unique to this composer, because siblings share the scratchpad — and **the full registry
was not run** (doctrine §4). **Re-extracted from this finished document and re-run: identical, 12/12
and 9 files / 10 matches over 4,208 file-visits against a floor of 1,500.**

```json
{
  "rules": [
    {
      "id": "unbounded-shared-table-render",
      "goldenPath": "docs/concepts/golden-paths/long-list-rendering.md",
      "title": "A shared table primitive is handed a data-length collection with no bound on how many rows may enter the DOM",
      "roots": ["src"],
      "extensions": [".tsx"],
      "signal": {
        "pattern": "<(?:UnifiedTable|DataGrid)(?:<(?:[^<>]|<[^<>]*>)*>)?(?:(?!\\browHeight\\b|\\bpageSize\\b|\\bsimplified\\b)(?:=>|>=|<=|[^<>])){0,4000}?/>",
        "flags": "g",
        "ignoreCommentLines": true,
        "description": "A render of one of the two shared table primitives whose opening tag names NO bound on how many rows enter the DOM - no rowHeight (UnifiedTable's windowing switch), no pageSize (DataGrid's page slice), no simplified (which forces DataGrid to 5). PROXY FOR the stack-free condition: a list container is handed a collection whose length is decided by data and is never told how many of those rows may render, so the surface's cost is a function of how successful the product has been. THE DEFAULTS ARE THE DEFECT: UnifiedTable.tsx:446 is `rowHeight = 0` and :523 is `const useVirtual = rowHeight > 0`, so silence selects the branch at :674 that maps EVERY row into the DOM with no scroll container of its own; DataGrid.tsx:155 is `pageSize = 0` and :227-231 is `if (effectivePageSize <= 0) return data`. This is the contract's fifth section-9 failure mode - a primitive with a mandatory-but-forgettable argument - reproduced at a second primitive. MEASURED 2026-08-17 at e21dfeb0d: 12 files / 12 matches across 2,104 .tsx files under src. THE POPULATION PARTITIONS EXACTLY: the anchor (any render of either primitive) matches 22 sites in 20 files = 12 violating + 10 compliant (the positive control, 9 files, one of which carries two renders) + the 2 primitives themselves, excluded below. MEASURED BY EXECUTION, not by reading: UnifiedTable's two body branches (:638-694) were transcribed statement-for-statement into a jsdom 29.1.1 + React 19.2.6 harness using the real @tanstack/react-virtual 3.13.26 and the repo's own useVirtualList verbatim, and driven over rows from a READ-ONLY COPY of the operator's live 347 MB personas.db (copied 2026-08-17 08:54 UTC with the app running, never opened for write, deleted after). Same rows, same columns, differing only in whether rowHeight was passed, median of 5 after warm-up: 100 rows -> 99.1 ms / 801 DOM elements vs 28.8 ms / 186; 500 -> 509.5 ms / 4,001 vs 29.2 / 186; 1,306 -> 1,324.3 ms / 10,449 vs 32.7 / 186; 2,188 -> 1,878.0 ms / 17,505 vs 28.3 / 186; 4,974 -> 2,517.0 ms / 24,871 vs 20.9 / 117; 6,535 (every memory the operator has) -> 4,462.6 ms and 52,281 DOM elements vs 28.7 ms and 186; 9,803 (the whole credential audit log) -> 4,517.2 ms / 49,016 vs 22.5 / 117. That is 3x to 201x wall time and 4x to 419x DOM elements, and the windowed branch mounts 23 rows at EVERY N. The DOM counts are exact and portable; the milliseconds are jsdom's, which performs no layout or paint, so they are a LOWER BOUND on a real engine. rowHeight ALSO SILENTLY GATES THREE UNRELATED PROPS - executed: with rowHeight omitted the component renders no scroll container, so scrollRestoreKey cannot bind (:532 attaches the ref only on the virtual branch at :639), useEndReached has no node to watch (:537), and the groupBy sticky-header path is unreachable (:527, `grouped = !!groupBy && useVirtual`). The source says so at :529-531: 'No-op when scrollRestoreKey is undefined or the table isn't virtualized'. No call site trips that today, so it is a loaded trap rather than a live defect. PRECISION hand-verified 12/12 on the stated condition, every match opened and tabulated with its data source in section 7 D1: ToolPerformancePanel.tsx:208 (bounded upstream at DEFAULT_LIMIT = 8), RecipeOverviewTab.tsx:63 (a recipe's input schema), PairedDevicesPanel.tsx:171, DatabaseListView.tsx:116 (25 db credentials - and the DataGrid whose four siblings all pass a pageSize), ProjectManagerPage.tsx:490 (14 projects), ActivityList.tsx:174 (listExecutions(personaId, 50) merged with reviews and memories; the top persona holds 292 memories), LabVersionsTable.tsx:325, RunHistoryView.tsx:118 (list_eval_runs takes NO limit), GroundingTable.tsx:73, AthenaSpendSection.tsx:141, RemoteJobsPanel.tsx:122, and SurfaceRenderer.tsx:312 - the last of which renders a table whose ROW COUNT COMES OUT OF A LANGUAGE MODEL, the one input in this app nobody bounds by reviewing the code. On the stricter question 'can this exceed a viewport on the operator's data today' it is 8 of 12; the four bounded-upstream sites are kept in deliberately, because the condition is that the CALL SITE names no bound and each is one product decision away from being long. TWO INDEPENDENT IMPLEMENTATIONS AGREED ON THE ANCHOR (22 sites in 20 files) AND ON THE PARTITION (12 violating / 10 compliant) - after disagreeing twice, and both disagreements were matcher bugs, not facts. Implementation #1, a standalone brace-matching JSX scanner, first reported only 2 of 17 UnifiedTable sites as virtualized because a TSX generic argument (`<UnifiedTable<PersonaEvent>`) closed the opening tag at its own `>` and truncated every prop list; and this census pattern first missed ToolPerformancePanel.tsx:208 entirely because a prop value contains `errPct >= 10` and the `>` in `>=` fell outside the `(?:=>|[^<>])` unit. Both were found by cross-checking the two counts, neither by reading. ZERO SITE OVERLAP with all 157 committed rules, re-measured by re-running each of the 76 rules whose roots and extensions can reach src/**/*.tsx and intersecting at file:line - not assumed. NO RULE IN THE REGISTRY KEYS ON WINDOWING, PAGING, LOAD-MORE, SCROLL RESTORATION OR ROW COUNTS AT ALL; this territory was entirely ungated. The largest FILE overlap is 5 of 12 with typo-token-overpainted (824 files) and native-title-tooltip (571 files), which reach 17% and 12% of the .tsx tree - co-location, not duplication. The nearest neighbours by subject are at 0 files AND 0 sites: hand-rolled-row-stagger (list-entrance-stagger.md) owns the cascade's timing, call-site-text-match (filtering-and-search.md) owns the predicate, stateless-disclosure-control (expandable-row.md) owns the disclosure control, absent-entity-count-as-zero (aggregate-count-display.md) owns the number. DISCLOSED RECALL GAP, and it contains this document's own second headline: the pattern asks whether a bound is NAMED ON THIS ELEMENT, not whether the list is bounded and certainly not whether what the list claims is true, so it CANNOT SEE LlmCallsTable.tsx, which passes rowHeight={52} and scores COMPLIANT while declaring four sortable columns (:178,:231,:245,:259) with a persisted tableId (:315) over a window paged 50 at a time to a client ceiling of 500 (overviewSlice.ts:149-150) and appended by onEndReached (:319). Replayed against the operator's real 2,188 executions with the cost column sorted descending: the top row reads $2.5254 at page 1 and $3.7646 at the client's own 500-row ceiling, against a corpus maximum of $7.1604, with 0 of the true top 10 present AT EVERY PAGE; and when page 2 lands, 50 of 50 rendered rows change position, the largest displacement is 49 rows, and the row at mid-viewport drops 13 - against a control with no client sort where 0 of 50 move. It equally cannot see MemoriesPageDense.tsx:356, which hand-rolls its list outside both primitives and renders 100 of 6,535 memories (500 while searching) from memorySlice.ts:111 with offset literal 0 and no row 101 - a surface whose windowing was DELIBERATELY REMOVED, per MemoriesPage.tsx:5-8: 'the earlier Baseline virtualized-list layout ... were retired'. True recall over surfaces carrying this condition is about 12 of 30-plus and it misses the two worst, which is the honest thing to say about a signal keyed on a PROP'S PRESENCE when half the condition is a RELATION between an ordering and a paging key (section 8 Gap 1). It also cannot see the 66 `.slice(0, N).map(` render caps in 54 files, half of which disclose nothing, nor the 162 distinct list-container component names across 175 definitions of which only these 22 call sites go through a primitive that HAS a bound to set - 12.6%. PRECONDITION (must be re-derived per repo): this repo expresses a list container as a JSX element and a bound as a prop on it. A repo whose list is a Vue <n-data-table>, a server-rendered template loop, a React Native FlatList without windowSize, or a Blazor <Virtualize> scores a structural zero here while carrying the condition at scale - measured in the sibling checkouts, where 3 of the 4 UI repos have NO virtualization at all and a fourth declares react-virtuoso in package.json and imports it at zero sites. Do NOT silence a match by passing `rowHeight={0}` or `pageSize={0}` to mean 'unbounded' without also writing down why, and do NOT silence it by moving the table off the shared primitive - that is what happened to Memories and it made the tree worse while every count would have improved. THE HONEST FIX IS THE DEFAULT, NOT THE CALL SITES: default rowHeight to the density's real row height (44 comfortable / 36 compact, values that already exist in densityTokens) and DataGrid's pageSize to 25 the way FacetedDecisionTable.tsx:105 already does for its three consumers - one line per primitive, reaching all 12 sites with no call-site edit. WHEN THAT LANDS THIS RULE SHOULD BE DELETED, not baselined at 0."
      },
      "exclude": [
        {
          "path": "src/features/shared/components/display/UnifiedTable.tsx",
          "reason": "the primitive itself - it defines rowHeight = 0 at :446 and branches on it at :523, so it necessarily contains the anchor without being a call site; excluding it is what keeps the rule counting consumers rather than the definition"
        },
        {
          "path": "src/features/shared/components/display/DataGrid.tsx",
          "reason": "the primitive itself - pageSize = 0 at :155 and the page slice at :227-231; same reason as UnifiedTable, and note that a third file, FacetedDecisionTable.tsx, is deliberately NOT excluded because it is a genuine consumer that forwards its own pageSize = 25 default and therefore belongs in the positive control"
        }
      ],
      "baseline": { "files": 12, "matches": 12 },
      "floor": 1500
    },
    {
      "id": "unbounded-shared-table-render-positive-control",
      "goldenPath": "docs/concepts/golden-paths/long-list-rendering.md",
      "title": "POSITIVE CONTROL - the same primitive told how many rows may render",
      "roots": ["src"],
      "extensions": [".tsx"],
      "signal": {
        "pattern": "<(?:UnifiedTable|DataGrid)(?:<(?:[^<>]|<[^<>]*>)*>)?(?:(?:=>|>=|<=|[^<>])){0,4000}?(?:\\browHeight\\b|\\bpageSize\\b|\\bsimplified\\b)(?:(?:=>|>=|<=|[^<>])){0,4000}?/>",
        "flags": "g",
        "ignoreCommentLines": true,
        "description": "POSITIVE CONTROL - the COMPLIANT form of the same condition, over the same roots and extensions and off the same anchor: a render of UnifiedTable or DataGrid whose opening tag DOES name a bound on how many rows may enter the DOM. Measured 2026-08-17 at e21dfeb0d: 10 matches in 9 files, against the violating rule's 12 files / 12 matches. THIS IS A PARTITION, NOT A RATIO: the shared anchor matches 22 sites in 20 files, and 12 violating + 10 compliant = 22 exactly (20 files because IpcPerformancePanel.tsx carries two compliant renders, at :215 and :230). THE REFERENCE MEMBER is EventLogList.tsx:441, the only site in the tree that uses the whole contract at once: rowHeight={EVENT_ROW_HEIGHT} (:448) - which is what arms the other three - plus groupBy (:460), scrollRestoreKey composed from the route AND every filter (:458), rowReveal with the same reset key (:459), and onEndReached={hasMoreOlder && !isLoadingOlder ? loadOlder : undefined} (:461) guarded by both a has-more flag and an in-flight flag, passed as undefined rather than a no-op so the primitive can skip the listener entirely. Its data side (useEventLog.ts:20-21, INITIAL_LIMIT = 50 / LOAD_MORE_LIMIT = 50) renders serverHasMore as a '+' in the subtitle (:284) - the only place in this repo that discloses server truncation in the list's own chrome, and it costs one character. Other members: LlmCallsTable.tsx:305 (rowHeight 52), SharedEventsTab.tsx:147 (52), LlmOverviewPage.tsx:410 (40), IpcPerformancePanel.tsx:215 (44) and :230 (36), PersonaOverviewPage.tsx:291 (pageSize 25), CredentialList.tsx:145 (25), LiveStreamTab.tsx:441 (20), and FacetedDecisionTable.tsx:190 - which forwards its own `pageSize = 25` default (:105) to three consumers that never had to remember it, and is therefore the shape this path's section 4 T1 proposes, already shipped once in this tree. A MATCH HERE IS NOT A CERTIFICATE: LlmCallsTable.tsx:305 sits in this control and is the document's second headline defect - it is correctly windowed and its cost column, sorted descending over every page the client can load, still reads $3.76 against a corpus maximum of $7.16 with 0 of the true top 10 present, because a client sort over a growing prefix ranks the prefix. Membership of this control means a bound was NAMED, never that the list tells the truth about the corpus; that relation is section 8 Gap 1 and no census rule can express it. Carries NO baseline by construction: a ratchet is monotone-downward and a rule counting compliant code would fail the build every time adoption improved (scripts/census/lib/engine.mjs exempts a -positive-control id; merge-published-rules.mjs skips it; verified by deliberately adding one, which exits 1). THE TWO COUNTS MUST MOVE IN OPPOSITE DIRECTIONS: if unbounded-shared-table-render falls while this stays flat, a table was DELETED or moved OFF the shared primitive rather than bounded - which is exactly what happened to the Memories page, where a layout change retired a virtualized list and every count that existed at the time would have recorded the loss as progress. Verified by pointing the violating rule's id at this pattern, which moves 12 -> 9 files and 12 -> 10 matches and exits 1."
      },
      "exclude": [
        {
          "path": "src/features/shared/components/display/UnifiedTable.tsx",
          "reason": "the primitive itself - must be excluded from the control on the same terms as from the gate, or the partition stops adding up"
        },
        {
          "path": "src/features/shared/components/display/DataGrid.tsx",
          "reason": "the primitive itself - same terms as UnifiedTable, so that anchor = violating + compliant + these two exclusions with no residue"
        }
      ],
      "floor": 1500
    }
  ]
}
```

### The type, alongside the ratchet

The gate counts **an absence on an element**. Three things it cannot reach, in descending importance:

- **Whether the list's claim is true** (§8 Gap 1) — D3, the second headline, scores *compliant* here.
  Only a test that mounts the table over page 1, appends page 2 and asserts the rendered order is a
  prefix of the corpus order can see it. That test is forty lines and does not exist.
- **Every list container that is not one of these two primitives** — 162 names, 175 definitions, of
  which 22 call sites are reachable. The rule sees **12.6%** of the tree's list containers by
  construction, and the surface with the largest live collection (Memories, 6,535 rows) is in the
  other 87.4%.
- **Fix the destination before ratcheting the callers** (contract: *a gate on reaching a destination
  is only as good as the destination's defaults*). Routing people to `UnifiedTable` is worth little
  while `UnifiedTable`'s own default is the failure mode. **Change the default first** (§4 T1, one
  line per primitive, reaching all 12 sites), and **delete this rule when it lands** — do not baseline
  it at 0.

---

## 12. Corrections to the brief

1. **`sides: "client"` is CORRECT, with one qualification the doctrine will want.** Every deviation is
   in `.tsx`; the exemplar is `.tsx`; the census rule's roots are `src/**` and its population is 100%
   client. **But the spine object also carries `twoSided: true` in the same node, and on that the
   spine contradicts itself in this leaf's favour twice over:** the *rendering* is one-sided, and the
   two defects that windowing cannot fix (D3's sort, D4's truncation) are both **relations to a
   server decision** — the paging key and the fetch limit. The honest reading is that the leaf is
   client-side and its two hardest problems are not; that is why §2 (b) hands the fetch upstream
   rather than absorbing it. The doctrine's record now reads: `sides: "client"` contradicted on six
   leaves, upheld on two (`bulk-selection-actions` and this one), and in both upholding cases the
   reason was structural and stated — there, *the server never sees a selection*; here, **the server
   never sees the DOM.**
2. **`convergence: mixed` is CORRECT, and it is the third spine label the corpus has upheld.**
   Measured over an effective cohort of 4: **2 clauses physics** (threshold-gating, `+N more`
   disclosure), **2 Personas-alone-and-ahead** (having a windowing answer at all; owning a scroll-
   restoration mechanism), **2 silences** (nobody restores list scroll, nobody uses a sentinel), **1
   one-repo-alone worth adopting** (brainiac's `showing N–M of T`), **1 diverged** (paging strategy,
   4 of 4 different). A single enum cannot carry that, but `mixed` is the closest true value and it
   is true.
3. **A correction to a published path.** [`paginated-list-query`](./paginated-list-query.md) `:251`
   Gap 8 states: *"`onEndReached` is silently ignored under `groupBy` (`UnifiedTable.tsx:532`)*. **It
   is not.** The outer `useEndReached` is disarmed at `:537` (`grouped ? undefined : onEndReached`)
   *precisely because* the grouped path owns a different scroll container — and `UnifiedTable.tsx:633`
   forwards `onEndReached` into `GroupedTableBody`, which re-arms it on its own `parentRef` at
   `:739`. `EventLogList` runs grouped **and** infinite-scrolled today and its continuation works. The
   conjunction the composer flagged is real (two scroll containers, one prop) and its conclusion was
   the opposite of the code.
4. **Two matcher bugs, both found only by cross-checking two implementations — the doctrine's rule
   earning itself twice in one leaf.** (a) My standalone JSX scanner reported **2 of 17**
   `<UnifiedTable>` sites as virtualized. The true answer is **6**. Cause: a TSX generic argument —
   `<UnifiedTable<PersonaEvent>` — closes the opening tag at its own `>`, truncating every prop list
   to nothing. The number *looked plausible* and would have made §0-A twice as dramatic and wrong.
   (b) The census pattern then missed `ToolPerformancePanel.tsx:208` because a prop value contains
   `errPct >= 10`, and the `>` in `>=` fell outside my `(?:=>|[^<>])` unit — so I shipped a draft
   reporting 11 where the truth is 12. **Neither was found by reading; both were found because the
   two counts disagreed and I opened the difference.** The sharpening to add: *when your matcher walks
   a syntax, enumerate the operators that contain its delimiters* — `=>`, `>=`, `<=` all contain a JSX
   tag terminator, and the first is the only one composers remember.
5. **The harness lied first, and the lie looked like the finding.** The initial run reported the
   virtual branch mounting **0 rows** and costing 2.8 ms at N = 1,306 — a 509× speedup, which is
   exactly the shape of the result I wanted. It was a broken instrument: `@tanstack/react-virtual`
   computes `getVirtualItems()` during render from a scroll element that is `null` until commit, so
   the first pass legitimately produces nothing and my measurement stopped there. The fix was a second
   `act(render)` plus jsdom `scrollHeight`/`offsetHeight` stubs, after which the branch mounts **23**
   rows and the honest ratio at that N is **41×**. **A measurement whose absurdity is in the right
   direction is the hardest kind to catch** — 509× and 41× both say "virtualization wins", and only
   one of them is a number.
6. **A second correction to a published path.** [`filtering-and-search`](./filtering-and-search.md)
   §7-B lists six `DataGrid` callers with their page sizes and gives `DatabaseListView.tsx:116` as
   **"25 (default)"**. That file passes **no `pageSize` at all** (verified by reading `:116-129`), and
   `DataGrid`'s default is **0**, not 25 — so it renders every row and has no pagination to reset.
   The path's own finding (0 of 6 callers reset the page on a filter change) survives; the arithmetic
   behind it is 5 callers and one unpaginated grid. The likely cause is generalising
   `FacetedDecisionTable.tsx:105`'s `pageSize = 25` — a *wrapper's* default — into the primitive's.
7. **The brief predicted a large denominator swing and named the wrong axis.** It cited
   `metric-tile`'s 6.1× and `tab-strip`'s 6× and told me to measure twice. Measuring twice the way
   those leaves did — all list files (955) versus data-backed list files (398) — gives a swing of only
   **1.7×**, because *both* denominators are dominated by surfaces that never had a bound to set. The
   6.9× swing is on a **third** axis the brief did not name: **all list files (6.6% bounded) versus
   the shared primitives' own call sites (45.5% bounded)**. The generalisable lesson is that the
   denominator that moves the number is the one that isolates *the population the prescription can
   reach* — not the one that isolates the population at risk.
8. **"A prior perf pass concluded `ExecutionList` virtualization was a false positive — do NOT redo
   it." Cited, and the current state is the opposite of what the instruction implies.**
   `ExecutionList.tsx:144` calls `useVirtualList(executions, 64)`, renders through
   `virtualizer.getVirtualItems()` at `:499`, wraps each row in `virtualizer.measureElement` at
   `:505`, and pages at `PAGE_SIZE = 50` with an explicit "Load more" at `:544`. **It is windowed
   today and it is one of the two best implementations in the tree** — the other being `EventLogList`.
   Nothing was redone; it is cited in §6 as an exemplar, which is the only correct use of that
   instruction now.
9. **"Row counts that actually exist here" — verified, with one addition and one shape correction.**
   6,535 memories, 4,974 events (the brief said 4,972 — the two events that arrived between two
   composers' copies), 9,803 audit rows, 2,942 traces, 1,306 knowledge items: all confirmed on the
   copy. **90,813 spans is right and they are not rows** — `execution_traces.spans` is a JSON `TEXT`
   column (schema read directly), max 169 spans in one trace, which is why no `*span*` table exists
   and why a span list is bounded by the trace rather than by the corpus. **And the biggest table in
   the database is none of these: `workspace_practice_context_state` holds 253,752 rows**, followed by
   `dev_context_file_hashes` at 15,078 and `credential_audit_log` at 9,803. The practice-context table
   is reached only through a rollup command and has no list surface — which is the answer to the
   brief's question *"find what renders those without a window"*: **the largest collections in this
   database are not rendered at all, and the damage is concentrated in the mid-sized ones that are.**
10. **"Name the worst real list in the app with its row count and what rendering it costs."**
    **`MemoriesPageDense.tsx:356` — Knowledge → Memories, over 6,535 rows.** It is the worst by three
    independent measures: it holds the largest user-facing collection in the database; it is the only
    surface in the tree whose windowing was *removed on purpose* and the removal written down as an
    improvement; and it renders every row it holds inside a framer-motion `AnimatePresence`, which the
    harness's plain-`div` transcription under-counts. What it costs today is **99.1 ms and 801 DOM
    elements** for the 100 rows it fetches, **509.5 ms and 4,001 elements** the moment you type in its
    search box, and it would cost **4,462.6 ms and 52,281 elements** if it ever fetched what it
    displays a count of. It is the only list in the app that is simultaneously the largest, the least
    bounded, and invisible to this path's own gate.

11. **I inherited the wrong commit from the brief's primed leads, and caught it only at the end.** This
    header read *"composed against `master` @ `2a874e692`"* through the entire draft, copied from
    [`bulk-selection-actions`](./bulk-selection-actions.md) which the brief handed me as a lead. Every
    measurement in this document was taken against the working tree, which was **`e21dfeb0d`** — 20
    commits and one full working day later. The tell was decisive and accidental: `git show
    2a874e692:scripts/census/rules.json` returns *"exists on disk, but not in `2a874e692`"* — **the
    entire census registry postdates the SHA four sibling documents claim to have been composed
    against.** Two of the four files this path cites most (`UnifiedTable.tsx`, `DataGrid.tsx`) also
    changed in that window; every line number cited here was re-verified against the current tree
    afterwards and all held. **A composer that copies a neighbour's numbers copies its clock too** —
    and a SHA is the one field where inheritance is indistinguishable from measurement.
12. **A third correction to a published path, found by that same re-verification.**
    [`paginated-list-query`](./paginated-list-query.md) Gap 1 cites `DataGrid.tsx:486` for the footer
    that reads `data.length`. That expression is now at **`:520-523`** — the file grew 42 lines when a
    `@catalog` docblock landed. The claim is still true; the coordinate is not. Recorded because this
    corpus's whole value proposition is that a reader can act on a `file:line`, and a line number is
    the fastest-decaying thing a golden path publishes.