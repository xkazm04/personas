---
layer: application
subject: async-ui-states
technique: state-model
stack: react
---

# React application — the state model

How this repo derives the content-region state model, and where it packages
the whole thing behind two props.

## The doctrine document

`docs/design/overview-loading.md` is the repo's own statement of the model —
"the five laws": data on screen is sacred; content is never held; the delay
lives on the placeholder; life comes from item-level cascade; static chrome
always renders. Its flag semantics are the technique's derivation in three
lines:

```tsx
const [isFetching, setIsFetching] = useState(true);   // in-flight, nothing more
const showGhost = isFetching && rows.length === 0;    // ghosts ONLY into emptiness
{showGhost ? <Ghosts/> : rows.length === 0 ? <EmptyState/> : <Rows/>}
```

The `&& rows.length === 0` conjunct is the "data presence dominates" rule
made mechanical: a poll or refetch with rows on screen can never reach the
ghost branch. Reference implementation:
`src/features/overview/sub_activity/components/GlobalExecutionList.tsx`.

## The packaged form: `UnifiedTable`

`src/features/shared/components/display/UnifiedTable.tsx` bakes the model
into the shared table primitive so a page gets it from `isLoading` + `data`
(header doc, `UnifiedTable.tsx:10-26`):

1. `isLoading && data.length === 0` → delayed, geometry-matched
   `TableGhostRows` under the permanent column header;
2. `!isLoading && data.length === 0` → the settled empty state — unreachable
   before the first fetch resolves, which is the sticky-settled guard
   realized as a branch ordering;
3. `data.length > 0` → rows, with the one-shot id-guarded entrance cascade
   **coupled to the load cycle** by `resolveRowReveal`
   (`UnifiedTable.tsx:253-263`): passing `isLoading` at all turns the ripple
   on, `rowReveal={false}` opts out, and `DataGrid` shares the exact same
   resolution.

The seen-set behind the cascade is `useRevealTracker`
(`src/hooks/utility/interaction/useProgressiveReveal.ts:184`) — a ref-backed
per-id set that survives virtualized unmount and clears only on `resetKey`,
the technique's "seen-set outlives the items" clause.

## Warm remount

For views that fully unmount on navigation and hold data in local state, the
repo's pattern is a module-scoped cache keyed by entity: seed state from it
on mount and start `isFetching` **false** on a warm hit
(`docs/concepts/golden-paths/page-loading.md`, step 10), so a return visit
paints `settled-data`/`refreshing` rather than re-entering `loading`.

## Known deviations (measured, registered upstream)

- The table primitive's own model has **no failure branch** — a failed fetch
  with an empty array renders the settled empty state. Registered as
  `table-no-error-state` on the table subject; the general rule lives in
  this subject's failure-states technique.
- Call sites suppressing the primitive's ghost with `isLoading={false}` to
  hand-roll their own (e.g. `EventLogList.tsx:453-478`), citing a doctrine
  section that was corrected in 2026-08-13 — stale-license drift, documented
  inside `overview-loading.md` itself.
