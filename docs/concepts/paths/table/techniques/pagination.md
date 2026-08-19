---
layer: technique
subject: table
technique: pagination
status: forged
laws: [identity-survives-reuse, count-carries-predicate, derivation-names-recomputation]
shared_with:
  - feed
---

# Pagination

Pagination bounds two costs at once: the system's (query, transfer, render) and
the user's (a window small enough to scan). A table without a bound on its row
window has decided to fail at some dataset size and merely not scheduled the
date. The technique has three decisions — window mechanics, cursor design, and
count honesty — and a fourth, *who executes the windowing*, which is owned by
[client-server-split](client-server-split.md).

## Decision 1: offset or keyset

**Offset** ("skip N, take M") and **keyset** ("take M after this key") are not
interchangeable; they fail differently.

Choose **offset** when all of these hold:

- the dataset is modest (the store can skip cheaply at the largest realistic N);
- mutation during browsing is rare or tolerable;
- the user genuinely needs random access — "jump to page 14", "go to last".

Choose **keyset** when any of these hold:

- the dataset is large or unbounded — offset cost grows with N because the
  store must produce and discard everything it skips;
- rows are inserted or deleted while the user browses — under offset, an insert
  before the current window shifts every subsequent page, so the user sees
  duplicated or skipped rows at each page boundary. Keyset anchors the window
  to a *row*, not a *position*, so mutation elsewhere cannot shift it;
- the consumption pattern is sequential — load-more, infinite scroll, export
  walking, background sync. These never need random access, which is the one
  capability keyset gives up.

The compromise position — offset for small admin surfaces where page-jumping is
a real requirement, keyset everywhere the data grows or moves — is the correct
default posture, not a cop-out. What is never correct is offset on a large,
mutating dataset "because it was easier"; that is the configuration where both
failure modes fire at once.

## Decision 2: cursor design (keyset)

A keyset cursor is a resumption point, and its design rules are strict:

1. **The cursor is the ordering-key tuple of the last delivered row** — the
   sort column's value *plus a unique immutable tiebreaker* (the row identity).
   Without the tiebreaker, equal sort values make the resumption point
   ambiguous and rows are skipped or repeated at exactly the boundaries where
   values collide. This is the row-identity invariant doing load-bearing work:
   a cursor built on a non-unique or mutable field does not survive reuse.
2. **The next-window predicate compares the whole tuple**, e.g. conceptually
   `(sort_value, id) < (cursor_value, cursor_id)` for a descending order — not
   the sort value alone.
3. **The cursor is opaque to the client and self-describing to the server.** It
   encodes (or is validated against) the ordering it belongs to, so a cursor
   minted under one sort cannot be replayed against another. Changing sort or
   filter invalidates the cursor; the client starts a fresh sequence. An opaque
   token also keeps clients from fabricating positions and lets the server
   evolve the encoding.
4. **The store must be able to seek the tuple.** Keyset pagination presumes an
   access path (an index) matching the order; adopting keyset commits the
   schema to supporting each offered sort order, which is a healthy forcing
   function on how many sorts you offer.
5. **A new consumer's cursor is seeded, not defaulted.** Keyset cursors also
   serve resumable feeds — pollers, bridges, exporters walking forward. A
   consumer attaching to an existing dataset seeds its cursor at the current
   head (the newest row's tuple) when its job is "everything from now on";
   defaulting to the beginning replays the entire history into a consumer that
   never asked for it. Which seed is right — head or origin — is part of the
   consumer's contract, decided explicitly.

## Decision 3: honest counts

Totals are where pagination quietly lies.

- **A count carries its predicate.** "1–50 of 312" means 312 *matching the
  current filter under the current visibility rules*. Recompute it when the
  predicate changes; never let a count minted under one filter render beside
  results of another.
- **Exact totals cost a full predicate scan.** On large datasets, prefer an
  honest bound: fetch `limit + 1` rows to learn `hasMore` for one extra row's
  cost, and render "500+" or "many" instead of a precise number nobody audits.
  A precise-looking stale number is worse than a vague true one.
- **A cached or denormalized total names its recomputation.** If the surface
  stores a total (for a footer, a badge, a tab count), the path that refreshes
  it must be identified and invokable, or the first drift has no arbiter.

## Window size

Default page size is a product decision bounded by engineering: large enough
that scanning is not interrupted every few rows (rarely below 25 for dense work
surfaces), small enough that the slowest realistic query and render stay inside
the interaction budget. Offer at most a few sizes; a free-form size input is an
invitation to self-inflicted denial of service. The chosen size caps every
downstream cost, which is why pagination is rung one of the
[performance](performance.md) ladder.

## Surface pattern: pager, load-more, infinite scroll

- **Numbered pager** — when position matters and users return to it ("the
  regression was on page 3"). Pairs with offset; requires a total.
- **Load-more button** — sequential consumption with user consent per window.
  Pairs with keyset; needs only `hasMore`. The safest default for tables.
- **Scroll-triggered load-more** (end-reached loading inside a bounded table
  region) — sequential consumption without the click. Two details separate a
  correct implementation from a flaky one: the trigger *detaches while a fetch
  is in flight and when nothing more exists* (otherwise it fires overlapping
  requests into the same window), and it *fires once immediately when the
  first window does not fill the viewport* — otherwise a short first page
  leaves nothing to scroll, the trigger never arms, and the surface strands
  itself half-loaded.
- **Infinite scroll** — sequential consumption where immersion beats
  orientation. In a *table* context it is usually wrong: it destroys the
  footer, makes position unshareable, and fights the "compare across rows"
  job by unbounding the comparison set. Reserve it for feed-shaped surfaces.

Whatever the pattern, the window state (page or cursor, size, sort, filter) is
part of navigational state: restoring the surface (back-navigation, refresh,
share) should restore the window, or deliberately reset it — chosen, not
accidental.
