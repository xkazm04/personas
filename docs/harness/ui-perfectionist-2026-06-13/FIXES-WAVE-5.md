# UI Perfectionist — Fix Wave 5 — List / table reuse (`UnifiedTable`)

> 1 commit, 1 finding closed. The rest of this theme is **virtualized lists** that change scroll/perf
> behavior and are NOT safely verifiable without an app run — descoped with reasons below.
> Baseline preserved: changed file clean; eslint clean (pre-commit hook).

## Commits

| # | Commit | Finding | Sev | Files |
|---|---|---|---|---|
| 1 | `cae19216d` | recipes #5 — hand-built `<table>` | medium | RecipeOverviewTab.tsx |

## What was fixed

1. **Recipe input-schema → `UnifiedTable`.** The recipe-overview "Input Fields" panel hand-built a
   `<thead>/<tbody>` grid with bespoke border/padding. It's a small *static* table, so it converts cleanly
   to the catalog `UnifiedTable` (key/type/label columns, `getRowKey`), inheriting standard row/border/
   empty-state styling.

## Verification

| Gate | After |
|---|---|
| `tsc` errors in changed file | **0** (no RecipeOverviewTab/UnifiedTable errors) |
| eslint (changed file) | clean (pre-commit) |

## DESCOPED — the rest of this theme needs an app run

`UnifiedTable`/`GroupedVirtualList` conversions are the **highest-risk** reuse theme for a
`tsc`/`eslint`-only gate, because the remaining targets are **virtualized** lists where row height,
scroll, and windowing behavior matter and can't be confirmed without running the app:

- **events/messages #1 (high)** — `MessageList` hand-rolls a *virtualized* grid (vs the sibling Events
  list's `UnifiedTable`). Converting changes virtualization behavior → app-run session.
- **execution #9 (low)** — `ExecutionList` is a 12-column virtualized grid header+rows. Large surface,
  virtualized → app-run session.
- **recipes #3 leftover** — `SchemaFieldBuilder` type-select (different theme) left for row-alignment.

Recommendation: do the virtualized-list conversions in a dedicated session that launches the app and
visually confirms scroll/empty/loading parity against the sibling `UnifiedTable` instances.

## Pattern catalogue (item 11)

11. **`UnifiedTable` needs `columns` (`key`/`label`/`width`/`render`) + `data` + `getRowKey`.** A *static*
    hand-built `<table>` converts cleanly. A *virtualized* hand-rolled list does NOT convert safely without
    an app run — windowing/rowHeight behavior is invisible to `tsc`/`eslint`. Gate list conversions on a
    visual check.
