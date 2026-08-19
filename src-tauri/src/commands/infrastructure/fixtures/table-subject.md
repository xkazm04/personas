---
layer: golden-path
subject: table
status: forged
techniques:
  - pagination
  - sorting
  - performance
  - loading-and-empty-states
  - client-server-split
evidence:
  - src/features/shared/components/display/UnifiedTable.tsx   # canonical table primitive: chrome/body split, three-state body, identity keys, windowing
  - docs/design/overview-loading.md                           # the five loading laws this subject's state model matches
  - src-tauri/db/src/repos/orchestration/team_assignments.rs  # keyset pagination with composite (created_at, id) tiebreaker
counter_evidence:
  - src/features/settings/sub_byom/components/ByomAuditLog.tsx  # the canonical primitive retyped by hand — the drift the standard exists to prevent
deviations:
  - table-no-error-state              # anchors in docs/concepts/golden-path-deferred-fixes.md
  - table-default-sort-comparator
  - table-forbidden-split-unguarded
  - table-recent-slice-tiebreaker
---

# Table

A table is the surface you reach for when the user's job is **comparison across
uniform attributes**. Many records, the same fields on each, and the question the
user brings is relational: which of these is largest, newest, failing, mine,
overdue. The grid layout is not decoration — columns exist so the eye can travel
vertically down one attribute across every record, which is the one thing prose,
cards, and detail views cannot do.

That definition decides when *not* to use a table:

- **Cards** when records are identity-dominant and heterogeneous — the user
  recognizes each item as an individual (a person, a project, a document with a
  thumbnail) and rarely compares one field across many. Cards trade scan density
  for recognition.
- **A list** when there is effectively one attribute that matters plus a label —
  a ranking, a feed, a queue. A one-column table is a list wearing borrowed
  chrome; drop the chrome.
- **A detail view** when the user's question is about one record's depth, not
  many records' breadth. A table cell that keeps growing richer (nested
  sub-fields, expanding panels in every row) is a detail view trying to escape;
  let it.
- **A chart** when the question is about the shape of the whole (trend,
  distribution) rather than any individual record. Tables answer "which one";
  charts answer "what pattern".

The failure mode in both directions is real: tables forced onto
identity-dominant data feel like spreadsheets nobody asked for, and cards forced
onto comparison jobs make the user play memory games across a grid of rounded
rectangles.

## Anatomy: chrome and body

Every table divides into two regions with different stability guarantees.

**Chrome** is everything that describes or operates on the dataset: the column
header row, the toolbar (search, filters, density, column controls), the footer
(counts, pager). Chrome is derived from the *schema and the query*, which the
surface always knows — so chrome renders immediately, unconditionally, and never
disappears because data is in flight. A header that vanishes during a refetch is
the surface forgetting what it is.

**Body** is the rows: derived from the *data*, which arrives late, changes, and
sometimes fails. All volatility belongs to the body. The body has a state model
(below); the chrome does not.

This split is the single most consequential structural decision in a table
implementation. Almost every classic table defect — layout jumping when data
lands, filters that unmount mid-edit, a flash of "no results" before the first
response — traces to chrome that was accidentally made conditional on data.

## The column model is first-class

Columns are data, not markup. A principal-quality table is driven by a column
specification — id, header label, cell accessor, alignment, width policy,
sortability, visibility — and the rendering is a fold over that specification.
This is what makes sorting, column hiding, persistence of user column
preferences, and export all tractable; hand-written per-column markup makes each
of those a rewrite.

Column conventions that read as craft:

- **Numbers right-aligned, in tabular (fixed-width) numerals**, so magnitudes
  align vertically and the eye can compare lengths. Text left-aligned. Never
  center columns by default; centering destroys the shared edge scanning needs.
- **Units and precision decided per column, once** — not per cell. A column
  that mixes "1.2 GB" and "1240000000" has no owner.
- **Truncation with recourse.** Long values truncate to protect the grid, but
  the full value must remain reachable (expansion, tooltip-equivalent, or a
  detail affordance). Truncation without recourse is data loss with good
  typography.
- **One row height regime.** Either fixed-height rows (dense, fast, predictable
  — the default for data-dense work surfaces) or content-height rows, chosen
  deliberately; mixing regimes breaks scanning and, later, windowed rendering.

## Row identity

Every row carries a stable identity minted by the system of record — not its
array index, not its position on the current page, not a display field. Sorting,
paging, selection, focus, in-place updates, and entrance animation all perform
*reuse and reordering* on rows, and every one of them silently corrupts under
positional identity: selection sticks to the third slot instead of the third
record, an animation replays on a row that merely moved, an update lands on the
wrong entity. Identity is the invariant the interactive techniques stand on;
treat "what is this row's key" as a design decision made once, at the data
contract, not per rendering site.

## The body state model

The body is always in exactly one of these states, and the transitions are part
of the design:

| State | Meaning | Shows |
| --- | --- | --- |
| **empty-loading** | first fetch in flight, nothing to show yet | a calm placeholder *under* the chrome, geometry-matched to rows, delayed slightly so warm loads never flash it |
| **populated** | rows present, no fetch in flight | the rows |
| **populated-refreshing** | rows present, a fetch in flight | the *existing rows*, with at most a subtle inline indicator — never a placeholder over data |
| **empty-settled** | fetch complete, zero rows | an empty state that names *why* it is empty |
| **error** | fetch failed | a failure state, visually and semantically distinct from empty, with a retry path |

Three rules fall out of the table, and they are the ones implementations break:

1. **A fetch never hides rendered rows.** Once the user has data, refreshes are
   invisible or ambient. Replacing rows with a loader punishes the user for the
   system doing its job.
2. **Empty is asserted only after settling.** "No results" rendered while the
   first response is still in flight is a lie with a lifetime of 300
   milliseconds and a cost of trust.
3. **Error is not empty.** Zero-because-there-is-nothing and
   zero-because-the-fetch-died are different facts, must look different, and
   offer different actions (create/adjust-filter vs retry).

The full treatment — placeholder design, delay thresholds, entrance choreography,
empty-state taxonomy — is the [loading-and-empty-states](techniques/loading-and-empty-states.md)
technique.

## Counts tell the truth

A table's footer and toolbar traffic in numbers: "312 results", "1–50 of 312",
"12 selected". Every such number carries its predicate. "312" after a filter is
applied means 312 *matching the filter*, and the surface must say so — a count
that survives a filter change unqualified will be read as the universe size and
quoted somewhere it is false. When the exact total is expensive, an honest bound
("500+") beats a stale precise number. The pagination technique covers where
these numbers come from and what they cost.

## Accessibility posture

A table is one of the few surfaces with rich native semantics — use them.

- Real table semantics (or the equivalent grid role when cells are
  interactive): rows, column headers associated with their cells, a caption or
  accessible name stating what the table contains.
- **Sort state is announced, not just drawn.** The header cell carries the
  current sort direction in the accessibility layer, and the header is a real
  button — reachable, activatable, focus-visible.
- **Row actions are reachable without a pointer.** Hover-revealed action
  clusters must also appear on keyboard focus; anything reachable only by hover
  does not exist for keyboard and switch users.
- **Windowed rendering is an accessibility decision, not just a performance
  one** — removing off-screen rows removes them from find-in-page and from
  assistive traversal. The performance technique treats this as a cost to be
  paid knowingly, not a free win.
- Selection state, when present, lives on the row semantics, and bulk-action
  toolbars announce how many are selected.

## Responsiveness

A table does not shrink gracefully; it recomposes. Below the width where the
column set fits: drop or collapse low-priority columns (the column model makes
this a data change, not a rewrite), or let the *table region* scroll
horizontally under a sticky first column — never the page. If the surface is
routinely used narrow, that is evidence the job is not comparison-across-
attributes there, and the narrow rendering should be a list or cards fed by the
same data.

## The techniques

- [pagination](techniques/pagination.md) — bounding the window: offset vs
  keyset, cursor design, honest totals, pager vs infinite scroll.
- [sorting](techniques/sorting.md) — total deterministic order, tiebreakers,
  type-aware comparison, the sort-state contract.
- [performance](techniques/performance.md) — the optimization ladder from
  pagination through memoization to windowed rendering, and what each rung
  costs.
- [loading-and-empty-states](techniques/loading-and-empty-states.md) — the body
  state model realized: ghost-under-chrome, settle-before-empty, error ≠ empty,
  entrance choreography.
- [client-server-split](techniques/client-server-split.md) — which tier owns
  filtering, sorting, and paging, and why splitting one axis across tiers is
  the deadly variant.
