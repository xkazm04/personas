---
layer: application
subject: table
technique: client-server-split
stack: react
---

# UnifiedTable — how this repo's React side realizes the table standard

The canonical table primitive is `UnifiedTable<T>` at
`src/features/shared/components/display/UnifiedTable.tsx` (its `@catalog` header,
`:1-26`, is the component's own statement of the contract). It implements the
**all-client regime** of the client–server split: callers hand it the loaded
dataset and it owns sorting, per-column dropdown filters, inline search,
windowing, grouping, keyboard nav, and the entire cold-load choreography.
`DataGrid` (`display/DataGrid.tsx`) is the page-based sibling — reach for it only
when you need `pageSize` pagination or row selection with bulk actions, which
`UnifiedTable` deliberately lacks (see `docs/concepts/golden-paths/tables.md`
for the full capability matrix and adoption census).

## The props contract

```tsx
<UnifiedTable
  columns={columns}          // TableColumn<T>[] — the column model (:67-96)
  data={rows}
  getRowKey={(r) => r.id}    // row identity — REQUIRED, must be stable
  isLoading={isFetching}     // the real in-flight flag, nothing else
  rowHeight={44}             // >0 opts into the virtual list
  emptyTitle={t.section.no_rows_yet}   // ALWAYS translated + surface-specific
  emptyDescription={t.section.no_rows_hint}
  tableId="overview-activity"          // unlocks column resize + sort persistence
  scrollRestoreKey={`${route}|${personaId}|${filter}`}
/>
```

- **Column model first-class**: `TableColumn<T>` declares `key`, `label`,
  `width` (a CSS grid track), `render`, `sortable`/`sortFn`, `filterOptions`,
  `searchable`, `align`. Define columns in a sibling `useXColumns()` hook and
  translate every `label`.
- **Row identity**: `getRowKey` feeds the element key in *all* render paths —
  plain, virtualized (`:652`), and grouped (`:808`) — and the reveal tracker's
  id-guard (`useRowRevealEntrance`, `:226-244`). Pass a database id; never an
  index.
- **Sort**: internal `(sortKey, sortDir)` state, persisted to
  `localStorage` under `table-sort:<tableId>` (`:44-61`, `:479-486`), restored
  ahead of `defaultSortKey` on mount. The default comparator is
  string-`localeCompare` (`:508-514`) — pass a typed `sortFn` for numeric,
  date, or ranked-enum columns.

## Ghost-under-chrome, row reveal, empty-state rules

The body is the strict three-state machine of loading-pattern v2
(`docs/design/overview-loading.md`, the five laws):

1. `isLoading && data.length === 0` → `TableGhostRows` (`:275-302`): eight
   geometry-matched rows under the *always-rendered* column header, entering
   via `animate-fade-in` behind a staggered `≥120ms` `animation-delay` — the
   delay is the anti-flash; no `animate-pulse`, ever.
2. `!isLoading && data.length === 0` → the settled empty state (`:604-620`).
   Empty never flashes before the first fetch resolves because the ghost
   branch wins while in flight.
3. `data.length > 0` → rows, rippling in once via the id-guarded cascade.
   `resolveRowReveal` (`:253-263`) couples the cascade to `isLoading`, so the
   single flag buys ghost → ripple; `rowReveal={false}` opts out,
   `rowReveal={{ resetKey }}` re-ripples on a context switch. The entered-id
   set lives in `useRevealTracker`
   (`src/hooks/utility/interaction/useProgressiveReveal.ts:184-199`), a
   ref-backed Set that survives virtualized unmount/remount.

**The whole recipe for a list/table surface is `isLoading` + `data`.** No local
`*GhostRows`, no `*Skeleton`, no `RevealItem` wrapper, no `isLoading={false}`
in front of the primitive — `overview-loading.md` documents call sites that
did exactly that citing a stale version of its own recipe. The
counter-example on file is `ByomAuditLog.tsx` (hand-rolled `role="table"` divs
plus its own virtualizer): the primitive, retyped.

## Where the split sits today — and its edge

`UnifiedTable` assumes the client holds the working set: sort, filter, and
search all run in a `useMemo` over `data` (`:500-515`). That is the clean
all-client regime, correct for the app's local-first, modest-cardinality
surfaces.

The edge to respect: `onEndReached` (`:173-175`) wires **server-side
windowing** (load-older pages) into a table whose sort/filter remain
client-side. Used together with `sortable` columns, that is the forbidden
split — the client reorders the loaded window while the header claims to
reorder the set. When a surface needs server windowing, either make its
columns non-sortable, mirror the server's order in the default sort and leave
it fixed, or lift sorting to the request (which `UnifiedTable` cannot express
today — sort state has no controlled `sortKey`/`onSort` props; see the gap
list in `docs/concepts/golden-paths/tables.md` §"structural gaps"). The
`onEndReached` hook itself follows the standard: pass `undefined` to detach
while a page is in flight, and it self-fires when the first window doesn't
fill the viewport.

## Known shortfalls against the standard (kept, not hidden)

- **No error state**: the body machine has no failure branch; a failed fetch
  that settles with zero rows renders the *empty* state. Callers must catch
  failures upstream and render a distinct failure surface instead of letting
  the table assert "no data".
- **Untranslated fallback**: omitting `emptyTitle` falls back to the generic
  `shared.grid_no_data` — a last resort, not a default worth shipping.
- **Default comparator is stringly**: numeric and date columns sort wrong
  until a `sortFn` is supplied, and the default sort applies `reverse()` to a
  stable sort for `desc`, inverting tie order instead of tiebreaking on
  identity.
