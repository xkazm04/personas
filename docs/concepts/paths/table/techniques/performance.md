---
layer: technique
subject: table
technique: performance
status: forged
laws: [identity-survives-reuse, derivation-names-recomputation]
shared_with: []
---

# Performance

A table's cost is multiplicative — rows × columns × (formatting + reactivity
+ layout) — which is why tables are where rendering budgets die first, and why
the fixes form a **ladder**: each rung is cheaper to build, cheaper to
maintain, and less damaging to correctness than the one after it. Climb only
as far as measurement forces you. The expensive sin in this technique is not
slowness; it is reaching for the last rung first.

## Rung 0 — measure the actual shape

Before optimizing, establish three numbers: realistic row count at the high
percentile (not the median demo dataset), cost of one row render, and what
actually re-renders on the common state changes (a selection toggle, a
refresh, a sort). Most "slow table" reports are one of two shapes with
opposite fixes: *too many rows mounted* (windowing territory) or *too much
re-rendering per interaction* (memoization territory). Fixing the one you
don't have makes the code worse and the table no faster.

## Rung 1 — don't materialize what wasn't asked for

[Pagination](pagination.md) is the first performance feature. A bounded window
caps every downstream cost — query, payload, mount, layout, memory — and it is
the only rung that also improves the *user's* performance, by keeping the
comparison set scannable. A table that windows its rendering but still fetches
the unbounded set has optimized the cheap half.

## Rung 2 — make the row cheap

- **Precompute the row's view model once per data change**, not per render:
  formatting (dates, magnitudes, derived labels) runs when data arrives,
  producing plain display values the render path only places. Formatting in
  the cell render path multiplies its cost by rows × repaints.
- **Derive, don't store, the presentation sequence** — the sorted/filtered
  sequence is a cached derivation of (data, sort state, filter state), and it
  must be recomputed exactly when one of those named inputs changes. Naming
  the inputs is the point: a derivation whose recomputation trigger is
  implicit ("whenever things re-run") either goes stale or runs constantly.
- **Stabilize layout**: fixed table layout with declared column widths lets
  the layout engine skip per-cell width negotiation, which is the hidden
  quadratic in wide tables. It also stops the grid re-flowing as data lands.

## Rung 3 — re-render only what changed

The common interactions — select a row, tick a status, receive one updated
record — change one row, and a naive table re-renders all of them. The fix is
memoizing row rendering on *row identity + row version*: a row re-renders when
its own data changes, not when a sibling does.

Two invariants make memoization safe instead of stale:

1. **Key by identity, never by index.** Under sort, filter, page, and
   insertion — reordering and reuse, precisely — an index-keyed row inherits a
   *different record's* prior state: stale memoized content, misapplied
   animation, selection sliding to whoever now occupies the slot. Identity
   keys are what make "this row didn't change" a meaningful statement.
2. **Rows read their own state; containers pass identity.** A row that
   subscribes to the whole table's state (full selection set, full data
   array) re-renders on every change by construction, and memoization cannot
   save it. Pass the row its record and its own booleans ("is this row
   selected"), derived outside.

Selection sets, hover state, and "last updated" markers are the classic
memoization-defeaters: model them so that a change touches only the rows it
names.

## Rung 4 — windowed rendering (virtualization)

Mount only the rows intersecting the viewport plus a small overscan margin;
recycle as the user scrolls. This is the only rung that changes the asymptotic
mounted-row count, and it is deliberately last, because it is the only rung
that *takes things away*:

- **Find-in-page breaks** — unmounted rows are unfindable by the platform's
  own search.
- **Assistive traversal breaks** unless total counts and row positions are
  re-declared semantically; even then the experience degrades.
- **Layout features get harder** — sticky headers/columns, row expansion, and
  variable row heights all interact with the scroll math; variable heights in
  particular demand measurement or estimation machinery that is a permanent
  maintenance surface.
- **Scroll anchoring and restoration** become your code's problem instead of
  the platform's.

Adopt it when the windowed row count at the high percentile is large enough
that rungs 1–3 leave the interaction budget broken — as an order of magnitude,
hundreds of mounted rows is usually fine after rung 3, thousands is not. When
you do adopt it: fixed row height if at all possible (it collapses the math),
overscan tuned small, and rows still keyed by identity — recycling is *reuse*,
the exact operation positional keys corrupt under.

**Prefer rung 1 to rung 4 when both would work.** Pagination delivers the same
bounded cost with none of the losses, and a product that "needs" tens of
thousands of rows mounted usually has an unexamined filtering or aggregation
question upstream of the rendering question.

## Anti-patterns worth naming

- Windowing the render while fetching the world (rung 4 wearing rung 1's
  problem).
- Formatting in the cell path, then memoizing harder to compensate.
- Index keys "because the list is static" — it stays static until the first
  sort ships.
- A monolithic state object threaded through every row, making every keystroke
  a full-table render.
- Optimizing before measuring, i.e. skipping rung 0 — the ladder read
  bottom-up as a checklist instead of climbed under load.
