# Overview layered-fetch architecture

> Status: adopted 2026-05-21. Reference implementation: Manual Reviews
> (`sub_manual-review`). Rollout to the remaining Overview modules is
> tracked in the per-module table at the bottom.

## Context

The Overview feature (`src/features/overview/`, ~14 sub-modules) must stay
responsive at realistic data volumes — **thousands** of Messages, Reviews
and Memories, **hundreds** of agents. A 2026-05-21 audit of the fetch
strategy found the dominant anti-pattern is **fetch-all on mount**:

- `list_manual_reviews` → `SELECT * FROM persona_manual_reviews ORDER BY
  created_at DESC` with **no `LIMIT`**, rendered **unvirtualized**.
- The dashboard landing fires **5 concurrent full fetches** on mount *and
  on every filter toggle* — a "big bang" that blocks the IPC bus.
- Several sub-modules paginate the query but still render every loaded row
  without virtualization.

Fetch-all has three compounding costs: it blocks the Tauri IPC bus while
the whole table serializes, it balloons the Zustand store, and it forces
React to reconcile every row. All three scale with table size, not with
what the user looks at.

## Decision — the three-layer contract

Every Overview list adopts a **layered fetch**: cost scales with the
viewport, not the table.

### L0 — skeleton / counts (instant)

One cheap aggregate query — `COUNT(*)`, `GROUP BY status` — renders
headers, KPI tiles, filter-tab badges and the virtual-list total size
**before any row data exists**. A queue of 10 000 reviews still paints its
header in one fast query.

### L1 — first viewport (fast)

One **keyset-paginated** page — roughly the 40 rows the user can actually
see — rendered into a **virtualized** list (`useVirtualList` /
`@tanstack/react-virtual`).

Keyset, not `OFFSET`: the cursor is the `(created_at, id)` of the last row.
`WHERE created_at < ?cursor OR (created_at = ?cursor AND id < ?id)` is
O(page size) at any scroll depth and stable under concurrent inserts.
`LIMIT/OFFSET` walks and discards every skipped row and can skip/duplicate
rows when the table mutates mid-scroll.

### L2 — lazy continuation (on demand)

An `IntersectionObserver` sentinel near the list end pulls the next keyset
page as the user scrolls toward it. Heavy per-row detail (a review's
message thread, a memory's full body) loads only when a row is opened.

### Anti-"big-bang" — `enabled` gating

The dashboard landing fires **L0 for every tile** (cheap) but **L1 only
for the surface in view**. Off-screen tabs/sections pass `enabled: false`
to `useLayeredList` and flip it `true` when activated, so navigating to a
populated app does not detonate a dozen list fetches at once.

## Server convention (Rust)

Each paginated list gets two commands alongside (not replacing) any
existing fetch-all:

| Command | Shape | Layer |
| --- | --- | --- |
| `get_<entity>_counts(filters) -> <Entity>Counts` | one `GROUP BY` | L0 |
| `list_<entity>_page(filters, cursor?, limit?) -> <Entity>Page` | keyset page | L1/L2 |

- **`<Entity>Page`** = `{ rows, nextCursor: Option<String>, hasMore }`.
- **Cursor** is an opaque `"<created_at>|<id>"` string. `created_at` is
  RFC3339 and `id` a UUID — neither contains `|`, so a first-`|` split is
  unambiguous. A malformed cursor decodes to "page 1".
- The repo fetches `limit + 1` rows to derive `hasMore`, then truncates.
- `limit` is clamped server-side (reviews: `1..=200`, default `40`).
- The old fetch-all command stays registered for non-list callers and a
  graceful migration window; new list UIs must not use it.

Reference: `src-tauri/src/db/repos/communication/manual_reviews.rs`
(`list_page`, `counts`) and `src-tauri/src/commands/design/reviews.rs`
(`list_manual_reviews_page`, `get_manual_review_counts`).

## Client primitive — `useLayeredList`

`src/hooks/utility/data/useLayeredList.ts` is the shared hook implementing
the contract. A consumer supplies:

- `filterKey: string` — changing it resets the list and refetches L0 + L1.
- `fetchPage(cursor) -> { rows, nextCursor, hasMore }` — L1/L2.
- `fetchCounts?() -> Counts` — L0 (optional, failure non-fatal).
- `enabled?: boolean` — defer off-screen surfaces.

It returns `{ rows, counts, loading, loadingMore, hasMore, error,
sentinelRef, loadMore, reload }`. `sentinelRef` is a callback ref for the
L2 IntersectionObserver sentinel.

**Stale-response safety:** Tauri `invoke` cannot be aborted, so the hook
keeps an epoch counter — bumped on every filter change / reload — and
drops any response whose epoch is stale. This replaces ad-hoc
`fetchRequestId` guards scattered across the Overview slices.

## Reference implementation — Manual Reviews

`sub_manual-review` is the first adopter (it was the worst offender).

**Landed (data layer — verified compiling):**

1. Server: `manual_reviews::list_page` (keyset) + `manual_reviews::counts`
   (`GROUP BY`); commands `list_manual_reviews_page` +
   `get_manual_review_counts`, registered in `lib.rs`.
2. Client API: `listManualReviewsPage` + `getManualReviewCounts` in
   `src/api/overview/reviews.ts`; bindings `ManualReviewPage` /
   `ManualReviewCounts`.
3. `useManualReviewQueue` (`sub_manual-review/hooks/`) — the concrete,
   typed adapter that composes `useLayeredList` with the manual-review
   API. Status + persona filters fold into `filterKey`; L0 counts back
   the filter-tab badges. This is the copy-me template for every other
   module's adoption.

**Next step (component swap):** `ManualReviewList` still reads the
fetch-all `manualReviews` array from `overviewSlice`. Swapping it to
`useManualReviewQueue` means: status filter goes server-side, the inbox
list renders `rows` into a virtualized list with a `sentinelRef` at the
end, filter badges read `counts`, and bulk "select all" scopes to loaded
rows (see Consequences). This is a contained follow-up — the data layer
above is the hard, shared part and is done.

## Per-module rollout

Priority order from the 2026-05-21 audit. Each row is "convert the list to
the L0/L1/L2 contract"; tick when done.

| Module | Today | Action | Priority |
| --- | --- | --- | --- |
| `sub_manual-review` | fetch-all, unvirtualized | **done** — reference impl | — |
| `sub_incidents` | paginated 100, unvirtualized | virtualize L1; wire `useLayeredList` | high |
| `sub_memories` | paginated, transparent load-more | adopt L0 counts + sentinel L2 | high |
| dashboard landing | 5 concurrent full fetches | `enabled` gating per tile | high |
| `sub_health` | per-persona CPU scoring | incremental / memoized scoring | medium |
| `sub_messages` | already keyset + virtualized | align to `useLayeredList` | low |
| `sub_events` | cursor + sentinel already | align naming only | low |

## Consequences

- **+** List cost is bounded by the viewport, not the table. A 10 000-row
  queue costs the same first paint as a 40-row one.
- **+** One hook + one server convention — every module converts the same
  way; no per-module bespoke pagination.
- **−** Client-side "select all" / cross-page aggregates no longer have
  the full dataset in memory. Counts come from L0; bulk actions over a
  whole filter must move server-side or be capped to the loaded pages.
  (Manual Reviews keeps bulk actions scoped to loaded + selected rows.)
- **−** The old fetch-all commands linger until every caller migrates.
