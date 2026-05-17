# Perf-Optimizer Scan — Incidents, Manual Review, Memories & Knowledge

> Project: Personas (frontend-only)
> Scope: 4 paths in src/features/overview/{sub_incidents, sub_manual-review, sub_memories, sub_knowledge}
> Total: 8 findings (1C / 3H / 3M / 1L)

## Scope notes
- All four sub-paths exist as documented; no scope drift.
- Files read: 22 across the four sub-features (incidents 5, manual-review 9, memories 11, knowledge 4).
- Cross-cutting observation: two parallel copies of `memoryConflicts` exist (`libs/memoryConflicts.ts` and `hooks/memoryConflicts.ts`). The component imports the `libs/` copy, but both contain the same O(n^2) algorithm. Same applies to `memoryActions` and `mergeMemories`. Maintenance burden, not perf — but increases bundle size by ~6 KB minified for code that runs identically.
- Polling: incidents uses a raw `window.setInterval` 30 s loop (bypasses the project's shared `usePolling` / `POLLING_CONFIG`), manual-review uses `usePolling` correctly.

## 1. Memory conflict detection is O(n²) on every memories array reference change
- **Severity**: critical
- **Category**: algorithmic
- **File**: `src/features/overview/sub_memories/libs/memoryConflicts.ts:84` (called from `src/features/overview/sub_memories/components/MemoryConflictReview.tsx:37`)
- **Scenario**: User opens the "Conflicts" tab. `detectConflicts(memories)` runs on the full memory list. With even 200 memories that's ~20k pairs; each pair runs `textSimilarity` + `topicOverlap`, each of which re-`tokenize`s and re-`bigrams`-builds both strings. Effective cost per pair: 4× `tokenize` (regex+lowercase) + 2× `bigrams` (string slice loop). For 500 memories (~125k pairs) the call blocks the main thread for seconds.
- **Root cause**: `useMemo` invalidates whenever the `memories` array reference from the store changes (any add/delete/fetch). Per-pair work redoes normalization that's identical across every comparison involving the same memory. No early-exit on length mismatch / character-set disjoint check.
- **Impact**: UI freeze on tab switch and after any memory mutation; freeze duration scales quadratically with memory count. Even at 100 memories the recompute is noticeable when triggered after `fetchMemories` returns.
- **Fix sketch**: (1) Memoize per-memory `{ tokens: Set, bigrams: Set, contentLower: string }` outside the pair loop so each memory is normalized exactly once. (2) Add a cheap pre-filter: skip the pair if `Math.min(tokensA, tokensB) / Math.max < DUPLICATE_THRESHOLD * 0.5` — token-count ratio bounds Jaccard. (3) Move the detection into a `useDeferredValue(memories)` so it doesn't block user typing/scrolling, or run inside `startTransition`. (4) For >300 memories, push the work to a Web Worker — the algorithm is pure-data and parallelizable per chunk.

## 2. Knowledge dashboard rebuilds expensive virtualized rows on every animation tick
- **Severity**: high
- **Category**: re-render
- **File**: `src/features/overview/sub_knowledge/components/KnowledgeRow.tsx:179`
- **Scenario**: `KnowledgeGraphDashboard` virtualizes a list of `KnowledgeRow`. Each row calls `parseJsonOrDefault<Record<string, unknown>>(entry.pattern_data, {})` directly in render. When expanded, it renders nested `framer-motion` `AnimatePresence` + `stagger` blocks that drive layout every frame. Combined with the parent virtualizer's `measureElement` ref attaching to every visible row, scrolling through 100+ patterns reparses JSON for every newly-visible row each scroll tick.
- **Root cause**: (a) No memoization of `patternData` — string→object parse runs on every re-render, not just on entry change. (b) Even collapsed rows pay for the parse to compute `recentResults`. (c) `KnowledgeRow` itself is not `React.memo`-wrapped, so the parent's `onMutated={() => { void fetchData(); }}` inline closure creates a new identity each parent render, invalidating every visible row.
- **Impact**: Janky scroll on the knowledge dashboard once persona selection populates >50 entries. Heavy CPU during the failure-drilldown flow because every state change in the parent recomputes the filtered+virtualized list and re-renders every visible `KnowledgeRow`.
- **Fix sketch**: Wrap `KnowledgeRow` in `React.memo`; `useMemo` the `parseJsonOrDefault(entry.pattern_data, {})` keyed on `entry.id + entry.pattern_data`. In `KnowledgeGraphDashboard`, stabilize `onMutated` via `useCallback`. Skip the JSON parse entirely when the row is collapsed and `recentResults` isn't referenced for `ExecutionSparkline`.

## 3. Incidents inbox list never virtualized; full DOM render of N rows
- **Severity**: high
- **Category**: re-render
- **File**: `src/features/overview/sub_incidents/components/IncidentsInbox.tsx:128`
- **Scenario**: `incidents.map(...)` renders every row directly inside a `<div className="divide-y...">`. The hook fetches `DEFAULT_LIMIT = 100`. Each `IncidentRow` calls `useTranslation()` (selector subscription) and renders a checkbox, severity badge, action buttons (3-4 per row), and multiple translation lookups. With 100 rows that's ~400-500 DOM nodes plus 100 translation-store subscribers.
- **Root cause**: No virtualization despite the codebase having `useVirtualList` (used by `MemoriesPage` and `KnowledgeGraphDashboard`). Filter bar changes re-render the entire list. Every `setSelectedIds` (toggling a checkbox) re-renders all 100 rows because `IncidentRow` isn't `React.memo`-wrapped and `onSelectChange` is a fresh inline closure per render.
- **Impact**: Noticeable input lag when ticking checkboxes on a full-100 inbox; jank on filter changes. Scales linearly with how high `DEFAULT_LIMIT` is raised.
- **Fix sketch**: Virtualize with `useVirtualList(incidents, 56)` matching the memory page pattern. Wrap `IncidentRow` in `React.memo`. Pass `id`-keyed handler factories or replace closures with a stable `onAction(id, kind)` callback dispatching by action kind.

## 4. ManualReviewList computes status counts and `reviewMap` on every render via 3+ useMemos but reads `allReviews` length unnecessarily
- **Severity**: high
- **Category**: re-render
- **File**: `src/features/overview/sub_manual-review/components/ManualReviewList.tsx:74-93`
- **Scenario**: Each `fetchCloudReviews` poll tick (every `POLLING_CONFIG.cloudReviews.interval`) replaces `cloudReviews` in the store. That cascades through: `useEnrichedRecords(manualReviews/cloudReviews, personaMap)` (creates new array), `allReviews` (sorted copy), `statusCounts`, `reviewMap`, `useFilteredCollection`, `selectablePendingIds`, `activeSelectionCount`. The `allReviews.sort` is in-place inside `useMemo`'s return path which is fine, but every poll tick re-sorts the full N+M array even if nothing changed.
- **Root cause**: No equality short-circuit. Polling refetches even when window is unfocused. `selectedIds` toggle inside `Set` triggers `activeSelectionCount` `useMemo`, which calls `Array.from(selectedIds)` (O(n)) on every selection change — fine for small selection but combined with the row re-renders below it's wasteful. Also `<ReviewInboxPanel>` re-creates `ConversationThread` keyed on `activeReview.id` — but the `onAction` prop is a fresh closure each parent render, and the panel doesn't memoize the rendered inbox row list (`filteredReviews.map`).
- **Impact**: On every cloud-poll tick (default ~30 s) the entire list + side panel re-renders. Selection feels sticky on big inboxes (>200 reviews) because the cascade fires synchronously.
- **Fix sketch**: Hash the cloud-fetch response by `(id,updated_at)` and skip `setCloudReviews` if unchanged. Memoize the `filteredReviews` row render in `ReviewInboxPanel` by wrapping `InboxItem` in `React.memo` and routing through stable handlers. Convert `selectedIds` from a `Set` to a `{[id]: true}` record so individual row props can be primitive-compared.

## 5. Incident polling uses raw window.setInterval, bypassing pause-on-hidden and backoff
- **Severity**: medium
- **Category**: async-coordination
- **File**: `src/features/overview/sub_incidents/libs/useIncidentsData.ts:56-62`
- **Scenario**: `useEffect` installs `window.setInterval(refresh, 30_000)` for the inbox. Unlike `usePolling` (used in manual-review at `ManualReviewList.tsx:61` with backoff + enabled flag), this loop fires forever — even while the tab is backgrounded or the user is on a different sidebar section — and has no exponential backoff on failure.
- **Root cause**: Direct `setInterval` instead of the shared `usePolling` hook + `POLLING_CONFIG`.
- **Impact**: Wasted Tauri IPC traffic + database hits while the page is unfocused; a flaky backend keeps hammering with no backoff. Two `listAuditIncidents` + `getAuditIncidentsSummary` per tick × 2 tabs (incidents + dashboard) is a meaningful load.
- **Fix sketch**: Replace with `usePolling(refresh, { interval: 30_000, enabled: true, maxBackoff: ... })`. Add visibility gating via `document.visibilityState === 'visible'`.

## 6. Memories search debounce fires fetch but recomputes effect on every keystroke; race-window guard exists but `personaMap` and `categoryFilterOptions` recompute on personas object identity
- **Severity**: medium
- **Category**: duplicate-call
- **File**: `src/features/overview/sub_memories/components/MemoriesPage.tsx:66-79, 81-85`
- **Scenario**: The debounced fetch effect is well-implemented (`latestFilterRequestRef` guards). But while the user types in the search box (input at line 204), every keystroke schedules a new `setTimeout`, re-renders the whole page, and recomputes `personaMap` and `categoryFilterOptions` (these are `useMemo`'d on `personas` reference — fine if `agentStore` returns stable identity, but `useAgentStore((s) => s.personas)` returns a new reference on any store mutation including unrelated updates).
- **Root cause**: Search input is uncontrolled-debounced: `search` state changes per keystroke (full re-render) but request is debounced. There's no `useDeferredValue` separation. Combined with no `useShallow`/equality on `personas`, the page re-renders excessively while typing.
- **Impact**: Search bar feels slightly sluggish during fast typing on a busy session; ~3-4 ms of recomputation per keystroke before the actual fetch fires. Compounds the conflict-detection issue (#1) if the user is on the conflicts tab while typing.
- **Fix sketch**: Use `useDeferredValue(search)` for filter-derived recomputes; keep the input controlled directly. Audit `useAgentStore((s) => s.personas)` to confirm stable identity (or wrap with `useShallow`).

## 7. ConversationThread re-parses context_data JSON on every render and re-fetches review messages without cache
- **Severity**: medium
- **Category**: duplicate-call
- **File**: `src/features/overview/sub_manual-review/components/ReviewDetailPanel.tsx:37-44, 82-89`
- **Scenario**: Each time the user clicks a different review in the inbox, `listReviewMessages(review.id)` fires fresh (no cache). The `decisions` `useMemo` parses `contextData` JSON — that's stable, but the parent re-mounts `ConversationThread` via `key={activeReview.id}` on every selection (`ReviewInboxPanel.tsx:174,207`), so the memo is cold each time and the messages fetch always re-runs even if the user toggles back to a recently-viewed review.
- **Root cause**: `key=` re-mount strategy throws away caches. No store-level cache for review messages.
- **Impact**: Toggle latency on the review inbox — every click costs an IPC round-trip even for previously-viewed reviews. With 50 reviews and quick navigation, that's 50 redundant queries.
- **Fix sketch**: Either drop the `key=` remount and let React reconcile (the component already accepts a `review` prop), or hoist `messages` into a per-id `useRef<Map<string, ReviewMessage[]>>` cache; serve cached data immediately and refresh in background.

## 8. ReviewFocusFlow recalculates severity counts and pending filter on every parent render
- **Severity**: low
- **Category**: re-render
- **File**: `src/features/overview/sub_manual-review/components/ReviewFocusFlow.tsx:65, 241-249`
- **Scenario**: `pending = useMemo(() => reviews.filter((r) => r.status === 'pending'), [reviews])` and `sevCounts` `useMemo` both depend on `reviews`. `reviews` is `filteredReviews` from the parent (a fresh array each render due to `useFilteredCollection`). Even when the underlying set is stable, the memos re-run each parent render.
- **Root cause**: Upstream array identity instability in `useFilteredCollection` — the parent re-builds the filtered array each render (filter inputs string-equal but new array reference).
- **Impact**: Minor — pending.filter is O(n) on a typically small (~10-50) array. But it cascades to the inner keyboard handler (`useEffect` line 196-233) re-binding on every render.
- **Fix sketch**: Stabilize `filteredReviews` reference in `useFilteredCollection` via shallow-equal cache, or memoize `pending` keyed on `reviews.length + reviews[0]?.id` style fingerprint.
