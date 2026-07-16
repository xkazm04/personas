# templates/generated [5/5] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 4 findings (0 critical / 0 high / 2 medium / 2 low)
> Context group: Templates & Recipes | Files read: 23 | Missing: 0

## 1. `aiCliLog` is a fully dead data path — state built, threaded through 4 layers, never rendered
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/templates/sub_generated/gallery/search/suggestions/AiSearchStatusBar.tsx:15
- **Scenario**: `AiSearchStatusBar` declares `aiCliLog?: string[]` (and `total: number`) in its props type but never destructures or renders either. Upstream, `useAiSearch.ts:34` maintains `aiCliLog` state, `useTemplateGallery.ts:110` re-exports it, `GeneratedReviewsTab.tsx:207` and `TemplateSearchBar.tsx:70-71` thread it down — all terminating at a component that ignores it.
- **Root cause**: The CLI-log display was presumably removed (or never shipped) from the status bar, but the entire producer/plumbing chain was left in place, including the prop slots on `TemplateSearchBarTypes.ts:42`.
- **Impact**: Dead state accumulation in `useAiSearch` (string array grows during AI search with no consumer), four files of pointless prop drilling, and a props interface that lies about what the component needs. Anyone extending the status bar must first discover the props are inert.
- **Fix sketch**: Either render the log (if the feature is wanted) or delete the chain: remove `aiCliLog`/`total` from `AiSearchStatusBar` props, drop `aiCliLog` from `TemplateSearchBarProps`, stop passing it in `TemplateSearchBar.tsx` and `GeneratedReviewsTab.tsx`, and remove the `aiCliLog` state + setter from `useAiSearch.ts` / `useTemplateGallery.ts` after confirming no other consumer (grep shows none).

## 2. `userHasCategoryCredential` does a 174-entry linear scan per category, per card, per render
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: algorithm
- **File**: src/features/templates/sub_generated/shared/architecturalCategories.ts:211
- **Scenario**: The template gallery re-renders on every search keystroke / filter change. Each visible card renders `ArchCategoryIcons` (and `CompactRow` in dense mode), which calls unmemoized `deriveArchCategories(connectors)` plus `userHasCategoryCredential(cat.key, ...)` per category. The latter iterates `Object.entries(CONNECTOR_TO_CATEGORY)` — 174 entries in `connector-categories.json` — allocating a fresh entries array each call. `computeCategoryReadiness` compounds the same scan.
- **Root cause**: The connector→category map is only indexed in the forward direction; the readiness check inverts it by brute force at call time instead of using a precomputed reverse index.
- **Impact**: For a gallery of N cards with ~3-5 categories each, that is N × 5 × 174 iterations plus N × 5 `Object.entries` allocations on every keystroke — measurable GC/CPU churn on the hottest browse path, and it grows with both catalog and gallery size.
- **Fix sketch**: Build a module-level reverse index once: `const CATEGORY_TO_CONNECTORS = new Map<string, string[]>()` populated from `CONNECTOR_TO_CATEGORY` at load. `userHasCategoryCredential` becomes a short loop over that category's own connectors (typically <20). Optionally wrap `deriveArchCategories(connectors)` results in `useMemo([connectors])` inside `ArchCategoryIcons`/`CompactRow` since connector lists are stable per card.

## 3. Duplicated readiness-tile markup in ConnectorIconButton and ArchCategoryIcons
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/templates/sub_generated/gallery/cards/ArchCategoryIcons.tsx:17
- **Scenario**: Both components render the identical visual: a `w-7 h-7 rounded-card` icon tile with `backgroundColor: ${color}18`, grayscale treatment when not ready, and an absolutely-positioned `w-2 h-2` status dot (`bg-emerald-500` vs `bg-amber-500/60 border-dashed`). They differ only in icon source and click behavior (ConnectorIconButton.tsx:24-48 vs ArchCategoryIcons.tsx:16-37).
- **Root cause**: The arch-category variant was written by copying the connector-dot tile instead of extracting the shared frame.
- **Impact**: The "ready/not-ready tile with status dot" visual language now has two masters; a styling change (dot size, ring, grayscale rules) must be made twice and will drift.
- **Fix sketch**: Extract a small `ReadinessTile` presentational component in `gallery/cards/` taking `{ icon: ReactNode, color: string, isReady: boolean, title: string, onClick? }`; have both components render it. ~30 LOC removed, one source of truth for the dot/grayscale rules.

## 4. `Panel`'s `square` prop is a documented no-op still passed at 4 call sites
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/templates/sub_generated/adoption/ucPicker/ucPanel.tsx:11
- **Scenario**: `Panel` accepts `square?: boolean` and immediately discards it (`square: _square`) with a comment saying it is kept "for back-compat"; `ucTimeCard.tsx` (3×) and `ucDeliverCard.tsx` (1×) still pass `square`. All callers are in the same directory — there is no external compatibility to preserve.
- **Root cause**: The three-card layout was unified to a fixed 220px height but the obsolete prop and its call sites were left behind.
- **Impact**: Misleading API — a reader of the card files reasonably assumes `square` does something. Pure noise, zero runtime cost.
- **Fix sketch**: Delete the `square` prop from `Panel`'s props type and remove the four `square` attributes in `ucTimeCard.tsx` / `ucDeliverCard.tsx`. Update the stale `ucCockpitView.tsx` header comment mentioning "square, 220×220" if desired.
