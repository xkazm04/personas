---
layer: technique
subject: table
technique: sorting
status: forged
laws: [identity-survives-reuse]
shared_with: []
---

# Sorting

Sorting looks like a UI feature and is actually a contract about order: given
the same data and the same sort state, the table produces the same sequence,
every time, on every tier. Every defect in this area — rows that jump on
refresh, pagination that skips records, selection that lands on the wrong row
after a resort — is a violation of that contract, not a rendering bug.

## The order must be total and deterministic

A comparator that can return "equal" for distinct rows is an incomplete order,
and incomplete orders are where the bugs live: equal-keyed rows land in
whatever sequence the underlying machinery happened to produce, which differs
across runs, tiers, and refreshes.

**Always append an immutable unique tiebreaker** — the row identity — as the
final comparison term. This one rule buys three properties at once:

- **Refresh stability**: re-fetching identical data yields identical order, so
  nothing visually shuffles without cause.
- **Pagination correctness**: page boundaries and keyset cursors fall between
  well-defined neighbors; without the tiebreaker, ties spanning a boundary
  cause skipped and duplicated rows (see [pagination](pagination.md)).
- **Cross-tier agreement**: client and server produce the same sequence for
  the same state, so handing sorting from one tier to the other (see
  [client-server-split](client-server-split.md)) is invisible.

The tiebreaker must be the *identity*, not a timestamp (collides) and not the
display label (mutable, collides). Identity survives reordering and reuse;
that is what it is for.

## Sort state is a small, explicit model

Sort state is `(column id, direction)` — or an ordered list of such pairs if
multi-column sort is genuinely needed, which it rarely is; multi-sort serves
analyst-shaped work and confuses everyone else. Rules:

- **There is always a sort.** "Unsorted" is not a state; it is the storage
  order of the moment, which is an implementation accident the user will read
  as meaning. Define a default sort per table as a product decision (most
  recent first is the common right answer for operational surfaces).
- **Header interaction cycles predictably.** Click sorts by that column
  (choose the direction users expect for the type: descending for dates and
  magnitudes, ascending for names); click again reverses. If a third
  "clear" state exists, it returns to the *named default*, never to
  "unsorted".
- **Exactly one visible indicator** (per sort level). A table drawing arrows
  on multiple headers while single-sorting is displaying a state model it does
  not have.
- **The active sort is part of navigational state**, restored with the surface
  and reflected in anything shareable, because the sort changes what "page 2"
  or a cursor means.
- **A user's chosen sort is a preference worth keeping.** For long-lived work
  surfaces, persist the chosen column and direction per table (per user or per
  device) and let the restored preference win over the product default on the
  next visit. The persistence key is the table's identity, and the stored value
  is validated on read — a persisted column that no longer exists falls back to
  the default, never to a crash or a silent no-sort.

## Compare by type, not by string

Each column's comparator follows the column's *semantic* type, declared in the
column model:

- **Numbers compare numerically** — including when they arrive as formatted
  strings. `"9" > "10"` lexicographically; a column of identifiers sorted as
  text is the classic tell of a table without a column model.
- **Dates and times compare as instants**, never as display strings; display
  formats do not collate.
- **Text compares with locale-aware collation**, case-insensitive by default;
  byte-order comparison misfiles accented and non-Latin names.
- **Mixed alphanumerics** (versions, serials, hostnames) get natural ordering
  — numeric runs compared as numbers — or they interleave uselessly.
- **Absent values have one declared home** — conventionally last regardless of
  direction, so missing data never floats to the top of a descending sort and
  masquerades as the maximum. Whichever policy is chosen, it is per-table
  policy, not per-column accident.
- **Enumerated statuses sort by declared rank**, not alphabetically —
  alphabetical status order is meaningless everywhere except the vocabulary's
  own definition.

## What sorting must not disturb

Sorting is a *reordering* of the same records, and everything keyed to records
must survive it: selection follows identity (the same three records stay
selected, wherever they move), focus stays on the row it was on, expanded rows
stay expanded, and entrance animation does not replay for rows that merely
changed position. Any of these breaking is diagnostic of positional keys
somewhere in the row pipeline.

## Where the comparison runs

The tier that owns the full dataset owns the sort — sorting only the loaded
window reorders the window while claiming to reorder the set, which is a
falsehood with a UI. The decision procedure lives in
[client-server-split](client-server-split.md); the rule here is only: *the
sort and the pagination must live on the same tier*, because a cursor or page
boundary minted under one tier's order is meaningless under the other's.

## Announce it

The sorted header exposes its state to assistive technology (sorted,
ascending/descending) and is operable as a real button from the keyboard. A
sort that exists only as a pointer affordance and a tiny glyph excludes both
assistive users and anyone automating against the surface.
