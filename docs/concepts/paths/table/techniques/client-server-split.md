---
layer: technique
subject: table
technique: client-server-split
status: forged
laws: [count-carries-predicate]
shared_with: []
---

# Client–server split

Every table sits on three query axes — **filter**, **sort**, **window** — and
each axis is executed either where the data lives (the server, the store) or
where the pixels live (the client, over whatever it has loaded). This
technique is the decision procedure for placing them, and one prohibition that
outranks the whole procedure.

## The governing rule

**An axis is owned by a tier that can see every row the axis's answer depends
on.** Sorting, filtering, and counting are total functions over the dataset;
executed over a partial copy they return answers *about the copy* while the UI
presents them as answers *about the data*. A client that holds page 3 and
sorts it has reordered fifty rows and labeled the result "sorted by date" — a
true statement about the window dressed as a true statement about the set.

From this rule, the prohibition: **never split one axis across tiers, and
never place an axis's executor below an axis that truncates.** Concretely:
window on the server + sort on the client is broken by construction (the
client sorts inside a window whose boundaries the old order defined). The
safe orderings are: everything on the server, or everything on the client
over a *complete* dataset.

## The two clean regimes

**All-client.** The client loads the complete dataset once, then filters,
sorts, and windows locally.

- Choose when the complete set is small enough to transfer and hold — as an
  order of magnitude, up to a few thousand rows of modest width — and when a
  point-in-time snapshot is acceptable for the session.
- What it buys: zero-latency interaction (instant sort, keystroke filtering),
  trivially consistent counts, offline tolerance, and a far simpler server
  contract (one "give me all of X" endpoint).
- What it costs: startup transfer, memory, and staleness — the client owns
  refresh policy now. And it silently expires: the tenant that grows from 400
  rows to 80,000 turns the snappy table into the tab that dies. **All-client
  is a bet about dataset growth; write the bet down** (an upper bound, and
  ideally a guard that flips or warns past it).

**All-server.** Every change to filter, sort, or window becomes a request;
the client is a viewport over state it never fully holds.

- Choose when data is large, growing, or hot (mutating while browsed), when
  the authoritative predicate matters (permissions, tenancy — filters that
  are *policy* must be applied where they cannot be skipped), or when
  multiple consumers need the same query semantics.
- What it costs: round-trip latency on every interaction — so the loading
  technique's refresh rules do real work here — plus debounced inputs,
  request cancellation (a stale response arriving late must not overwrite a
  newer one), and cache/invalidation questions.

The decision is per-table, not per-application: an app correctly serves a
5,000-row reference list all-client and a million-row event log all-server.

## The request/response contract (all-server regime)

The request names the full query state; the response **echoes the query state
it actually answered** alongside the rows and the total (or `hasMore`). The
echo is what lets the client match responses to the current UI state and
discard stale ones — and it is the count law in structural form: the total
arrives bound to the predicate that produced it, so the surface can never
render a number beside a filter it does not belong to.

```
request:  { filter, sort: (column, direction), window: cursor|page + size }
response: { rows, window_info: total|has_more, echo: { filter, sort, cursor } }
```

Server-side validation of `sort` and `filter` against an allowlist of
supported columns is part of the contract — the sortable-column set is a
capability the server declares, not whatever identifier the client sends
(which otherwise becomes an injection surface and an accidental API).

## The legitimate hybrid — different axes, labeled

Splitting *different* axes deliberately can be sound: the server owns filter
+ sort + window (the truthful axes), and the client adds a **quick-find
within the loaded window** — instant, keystroke-level narrowing of what is
already on screen. This does not violate the governing rule *if the UI tells
the truth about scope*: the affordance reads "find in these results", not
"search", and the footer keeps the server's predicate-bound counts. The
moment within-window narrowing is presented as dataset search, it is the
broken split again with better latency.

The other legitimate hybrid is **promotion over time**: start all-client
(cheapest to build, best feel), with the contract shape above already in
place, and move axes to the server together when the written-down growth bet
expires. Because the safe regimes are "all here or all there", the promotion
is a move of the whole axis group, not a per-axis drift — per-axis drift is
exactly how codebases arrive at the forbidden configuration one reasonable
commit at a time.

## Decision procedure, compressed

1. Is any filter *policy* (permissions, tenancy)? → that filter is
   server-side regardless of everything else.
2. Complete dataset comfortably transferable and holdable, now and at the
   written-down growth bound? → all-client; snapshot semantics; done.
3. Otherwise → all-server for filter + sort + window together; contract with
   echo; cancellation; optional labeled within-window quick-find.
4. Never: sort or filter on the client below a server-truncated window;
   counts computed on a tier that cannot see the whole predicate's extent.
