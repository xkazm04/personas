# templates/generated [3/5] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 6 findings (0 critical / 0 high / 2 medium / 4 low)
> Context group: Templates & Recipes | Files read: 34 | Missing: 0

## 1. CatalogCredentialModal OAuth consent is a dead stub that locks the button in a spinner forever
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/templates/sub_generated/gallery/modals/CatalogCredentialModal.tsx:87
- **Scenario**: User opens the catalog credential modal for a Google OAuth connector and clicks the OAuth consent button. `handleOAuthConsent` sets `isAuthorizingOAuth = true` and does nothing else ("OAuth flow would be handled here"), and `oauthCompletedAt` is a `useState` with no setter destructured (line 41), so it is permanently `null`.
- **Root cause**: OAuth flow was stubbed and never implemented in this modal; the state plumbing (`isAuthorizingOAuth`, `oauthCompletedAt`) was copied from the working vault-side form without the completion path.
- **Impact**: For Google connectors, the consent action is a UI dead-end — the form stays in the "authorizing" state until the modal is closed. Also permanent dead state (`oauthCompletedAt`) obscures that the feature is absent.
- **Fix sketch**: Either wire the real OAuth flow (reuse whatever `ConnectorCredentialModal`/vault catalog uses to launch consent and set `oauthCompletedAt` on success), or remove `handleOAuthConsent`/`oauthCompletedAt` and hide the OAuth affordance in `CredentialTemplateForm` for this call site so the button cannot enter an unrecoverable state. Verify with the vault `CredentialTemplateForm` contract before deleting props.

## 2. TerminalOutput re-renders and re-classifies every line on each streamed append
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/templates/sub_generated/generation/runner/DesignReviewTerminal.tsx:71
- **Scenario**: During template generation/test runs the terminal receives a stream of lines; each new line changes the `lines` array, and the whole list re-renders — every prior line re-runs the 6-way `includes()` classifier chain and reconciles its DOM node (keyed by index, so all keys stay stable but all rows still re-render).
- **Root cause**: No memoization of per-line rendering; line color classification is recomputed inline in the map on every render.
- **Impact**: O(n) work per appended line → O(n²) total over a run. For long runs (hundreds of lines streaming several per second) this is measurable jank on a hot path, compounded by the fade-in animation logic re-evaluating per line.
- **Fix sketch**: Extract a `TerminalLine` component wrapped in `memo` taking `(line, index, animate)`, so appends only mount the new rows. Hoist the classifier into a small pure `lineColorClass(line)` function (it only depends on the line string). `animateFromRef.current` is a ref so memoized rows keep correct behavior — pass the resolved boolean instead of the ref.

## 3. TemplateSearchFilterRow requires props it never uses, forcing callers to thread dead data
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/templates/sub_generated/gallery/search/TemplateSearchFilterRow.tsx:81
- **Scenario**: `availableConnectors` is destructured as `_availableConnectors` and never used, yet is a required prop. `TemplateSearchFilterRow` also requires `sortBy/onSortByChange/sortDir/onSortDirChange/total/loadedCount` (non-optional in the interface) though only the sibling `TemplateSearchControls` uses them — so `TemplateSearchBar.tsx:88-100` passes the whole sort/count bundle twice.
- **Root cause**: `TemplateSearchControls` was split out of the filter row but the shared props interface was not split with it.
- **Impact**: Callers must supply six unused values; readers assume the filter row sorts/counts. Pure maintenance drag, no runtime cost.
- **Fix sketch**: Split the interface: keep sort/count fields only in the `Pick<>` used by `TemplateSearchControls`, drop them plus `availableConnectors` from `TemplateSearchFilterRowProps`, and delete the duplicate props at the `TemplateSearchBar` call site. Check other callers of `TemplateSearchFilterRow` across contexts before removing (grep for the component name).

## 4. displayFlows fallback does a JSON.stringify → parse round-trip on an already-parsed object
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: cleanup
- **File**: src/features/templates/sub_generated/gallery/cards/useTemplateCardData.ts:44
- **Scenario**: When `review.use_case_flows` is empty, the hook reads `raw.use_case_flows` off the cached parsed design result, then serializes it with `JSON.stringify` and immediately re-parses it via `parseJsonSafe` just to coerce the type.
- **Root cause**: `parseJsonSafe` was used as a type-coercion helper on data that is already a JS value, not a string.
- **Impact**: Wasted serialize/parse of a potentially large flows array per card (bounded — inside a `useMemo` keyed on `review`), and it obscures intent; a malformed-but-serializable value silently round-trips instead of being validated.
- **Fix sketch**: Replace with a direct guard: `Array.isArray(raw?.use_case_flows) ? (raw.use_case_flows as UseCaseFlow[]) : []`. Same result, no copy, clearer intent.

## 5. BatchSourceView recomputes per-category counts with filter() inside the render map
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/templates/sub_generated/generation/sources/BatchSourceView.tsx:69
- **Scenario**: The category chip row calls `templates.filter((t) => t.category === cat).length` inside `categories.map(...)` — O(categories × templates) on every render, including renders where only `categoryFilter` changed (each chip click).
- **Root cause**: The `categories` useMemo derives the unique set but discards the counts it could have accumulated in the same pass.
- **Impact**: Bounded (batch uploads are typically ≤ a few hundred templates × ~15 categories), but it is repeated wasted work on every interaction with the chips.
- **Fix sketch**: Change the `categories` memo to build a `Map<string, number>` of counts in one pass over `templates` and return sorted `[name, count]` entries; render chips from that. Removes the nested filter entirely.

## 6. TemplateCard hover-preview timer is not cleared on unmount
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: leak
- **File**: src/features/templates/sub_generated/gallery/cards/renderers/TemplateCard.tsx:26
- **Scenario**: Hover a card (starting the `PREVIEW_DELAY_MS` timer) and the card unmounts before mouseleave — e.g. the list re-filters from a keystroke, sort changes, or a modal replaces the grid. `hoverTimerRef` is only cleared in `handleMouseLeave`; there is no unmount cleanup.
- **Root cause**: The timer lifecycle is tied to mouse events rather than the component lifecycle — no `useEffect(() => () => clearTimeout(...), [])`.
- **Impact**: `setPreviewOpen(true)` fires on an unmounted component (harmless no-op in React 18+, but the timer and closure are retained until it fires). With rapid filter typing over a large gallery, many stray timers accumulate briefly. Polish-level, but a one-line fix.
- **Fix sketch**: Add `useEffect(() => () => { if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current); }, []);` next to the ref declaration.
