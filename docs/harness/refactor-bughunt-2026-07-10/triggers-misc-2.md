> Context: triggers (misc 2)
> Total: 8
> Critical: 0  High: 1  Medium: 4  Low: 3

## 1. useSharedEvents.load has no stale-response guard — out-of-order loads clobber the catalog
- **Lens**: bug-hunter
- **Severity**: high
- **Category**: race-condition
- **File**: src/features/triggers/sub_shared/useSharedEvents.ts:25-45
- **Scenario**: The user types in the search box (`search` → 300ms debounce) or flips `category`. `load` is a `useCallback` keyed on `[category, debouncedSearch]`, and the `useEffect` fires it every time those change. Each call does `Promise.all([browseCatalog(...), listSubscriptions(), changeActivity()])` and unconditionally `setCatalog`/`setSubscriptions`/`setActivity` on resolution. There is no per-invocation cancellation token. If load #1 (query "a") is slower than load #2 (query "ab"), #1 resolves last and overwrites the catalog with results for the stale query "a" while the input shows "ab".
- **Root cause**: Missing `alive`/`stale` latch on the async body — the sibling hook `useSubscribedFeeds` (same folder) correctly uses `let alive = true` + cleanup, so the pattern was known but not applied here.
- **Impact**: UX / correctness — displayed catalog silently disagrees with the active filter; users see wrong/mismatched results with no error.
- **Fix sketch**: In `load`, capture a local `let alive = true` (or an incrementing ref/AbortController), and gate all three setters behind `if (!alive) return;`. Return a cleanup from the effect that flips `alive = false`, or compare a request-sequence ref before committing state.

## 2. refresh() silently drops the active category/search filter
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: edge-case
- **File**: src/features/triggers/sub_shared/useSharedEvents.ts:47-60
- **Scenario**: With a `search`/`category` filter active, the user hits refresh. `refresh` calls `api.refreshCatalog()` which takes no category/search arguments (see api/events/sharedEvents.ts:10-11) and returns the full unfiltered catalog, then `setCatalog(entries)`. The search box and category selector still display the old filter values, but the list now shows every entry.
- **Root cause**: `refreshCatalog` is a filter-less endpoint; `refresh` commits its result directly instead of re-applying the current `category`/`debouncedSearch` (or re-running `load` afterward).
- **Impact**: UX — refreshed view contradicts the visible filter controls until the next keystroke re-triggers `load`.
- **Fix sketch**: After `refreshCatalog()` completes, either re-run `load()` to re-apply filters, or client-side filter `entries` by the current `category`/`debouncedSearch` before `setCatalog`.

## 3. Failed relay delete leaves the confirm dialog stuck with no feedback
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: silent-failure
- **File**: src/features/triggers/sub_smee_relay/SmeeRelayTab.tsx:109-121
- **Scenario**: User clicks Trash → confirm. `handleDelete` awaits `smeeRelayDelete(id)`. If that rejects (backend error, relay in use), control jumps to the `catch` which only calls `silentCatch`. `setConfirmDeleteId(null)` sits in the try block *after* the await, so on failure it never runs: the inline confirm/cancel buttons stay rendered, no error is shown, and clicking Confirm again just repeats the swallowed failure.
- **Root cause**: Confirm-reset and error surfacing live only on the success path; the error path swallows silently.
- **Impact**: UX — delete appears frozen; the user has no signal the operation failed and no way to recover except Cancel.
- **Fix sketch**: In the `catch`, reset `setConfirmDeleteId(null)` and surface an inline error (a `deleteError` state or reuse the toast pattern) rather than only `silentCatch`.

## 4. RateLimitDashboard hides live concurrency when no rate limits are configured
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: edge-case
- **File**: src/features/triggers/sub_speed_limits/RateLimitDashboard.tsx:47-61
- **Scenario**: The empty-state guard returns when `rateLimitedCount === 0 && throttledCount === 0 && totalQueued === 0` — but it ignores `totalConcurrent`. A trigger with no configured rate limit can still accumulate `state.concurrentCount` (summed into `totalConcurrent` at line 37/74). So with, say, 5 executions running concurrently but zero configured limits/throttle/queue, the component renders the "no rate limits configured" empty state and the "5 running" stat (lines 79-85) is never shown.
- **Root cause**: The empty-state predicate omits `totalConcurrent` even though the body renders a concurrent-count stat.
- **Impact**: UX / observability — real in-flight concurrency is invisible in exactly the case (no limits) where a user might most want to notice it.
- **Fix sketch**: Add `&& stats.totalConcurrent === 0` to the empty-state condition so the compact dashboard renders whenever any live activity exists.

## 5. Post-fire prefill overwrites the user's edited payload
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: state-corruption
- **File**: src/features/triggers/sub_test/TestTab.tsx:149-152, 202-203
- **Scenario**: User selects a persona/event, edits the JSON payload by hand, then clicks Publish. `handleTestFire` prepends the returned event to `recentEvents` (line 203). The prefill effect (lines 149-152) lists `recentEvents` as a dep, so it re-runs `refreshPrefill`, which now finds the just-sent event as the newest history match and overwrites `payload`/`payloadSource` with the canonical re-stringified form — discarding any further manual tweaks the user intended to fire again.
- **Root cause**: The prefill effect treats every `recentEvents` change as a reason to reset the editor, but a fire-driven append is self-inflicted, not a fresh selection.
- **Impact**: UX — hand-edited payloads get replaced immediately after firing; iterative testing loses edits.
- **Fix sketch**: Skip the prefill reset when the `recentEvents` change originates from a local fire (e.g. track a `lastFiredId` ref and bail if the newest event matches), or only re-run prefill on `[selectedPersonaId, activeEventType]`.

## 6. useSubscribedFeeds duplicates the subscription+catalog fetch/join already in useSharedEvents
- **Lens**: code-refactor
- **Severity**: medium
- **Category**: duplication
- **File**: src/features/triggers/sub_shared/useSubscribedFeeds.ts:14-27
- **Scenario**: `useSubscribedFeeds` independently calls `api.listSubscriptions()` + `api.browseCatalog()` and joins them by slug to produce "catalog entries the user is subscribed to." `useSharedEvents` (same folder) already loads both lists and exposes `subscriptions`, `catalog`, and `subByEntryId`. The subscribed-feeds list is derivable from that hook's state (`catalog.filter(e => subByEntryId.has(e.id))` or a slug set), so the second network round-trip and join logic are redundant where both are used on the same surface.
- **Root cause**: Two hooks grew separately for two consumers (Marketplace vs Chain Studio) without a shared selector.
- **Impact**: maintainability — two copies of the subscribe→catalog join can drift (this one keys by `slug`, the other by `catalogEntryId`); double fetch of the same data.
- **Fix sketch**: If consumers share a tree, derive subscribed feeds from `useSharedEvents` via a memoized selector and drop the separate fetch; otherwise extract the join into one shared helper both hooks call.

## 7. Duplicated inline `openExternalUrl('https://smee.io/new')` handler
- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication
- **File**: src/features/triggers/sub_smee_relay/SmeeRelayTab.tsx:168, 309
- **Scenario**: The exact call `openExternalUrl('https://smee.io/new').catch(silentCatch("SmeeRelayTab:..."))` plus the `DebtText k="auto_smee_io_new_7ce5f637"` label appears twice (banner button and inline prompt). The literal URL and catch wiring are copy-pasted.
- **Root cause**: No shared handler/const for the "open smee.io/new" action.
- **Impact**: maintainability — URL or error-handling changes must be made in two spots.
- **Fix sketch**: Hoist a `const openSmeeNew = () => openExternalUrl('https://smee.io/new').catch(silentCatch('SmeeRelayTab:openSmeeNew'))` and reuse it in both onClicks.

## 8. Redundant identical render guard for EmptyState and SetupGuide
- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication
- **File**: src/features/triggers/sub_smee_relay/SmeeRelayTab.tsx:321-330, 467-469
- **Scenario**: The EmptyState block (`!isLoading && relays.length === 0 && !showAdd`) and the SetupGuide block (`relays.length === 0 && !showAdd && !isLoading`) evaluate the same three conditions in different order and render one after the other. They always appear/disappear together.
- **Root cause**: Two sibling conditionals with the same predicate instead of one wrapper.
- **Impact**: maintainability — future changes to the "empty" condition must be kept in sync across two spots.
- **Fix sketch**: Wrap both in a single `{isEmpty && (<><EmptyState/><SetupGuide/></>)}` computing `isEmpty` once.
