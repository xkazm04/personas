# vault/databases [2/2] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 5 findings (0 critical / 1 high / 2 medium / 2 low)
> Context group: Credentials & Connectors | Files read: 10 | Missing: 0

## 1. Safe-mode execution block duplicated between ConsoleTab and QueryEditorPane — and the copies have already drifted
- **Severity**: High
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/vault/sub_databases/tabs/QueryEditorPane.tsx:66 (vs tabs/ConsoleTab.tsx:34)
- **Scenario**: Both tabs implement the same `runQuery` (setExecuting/setError/setResult around `executeDbQuery` + `extractErrorMessage`) and a ~30-line near-identical "Mutation confirmation dialog" JSX block (AlertTriangle, 200-char query preview, execute-anyway/cancel buttons — only the hint translation key differs). Any change to the destructive-confirm UX or error handling must be made twice.
- **Root cause**: The safe-mode flow was extracted into `useQuerySafeMode`, but the surrounding execution wrapper and the confirmation dialog markup were copy-pasted instead of extracted alongside it.
- **Impact**: The copies have already diverged in behavior: ConsoleTab's `runQuery` has a `queryGenRef` stale-response guard (ConsoleTab.tsx:32-52); QueryEditorPane's does not (see finding 3). This is exactly the drift hazard duplication creates, on the app's most destructive code path (confirmed SQL mutations).
- **Fix sketch**: Extract a `MutationConfirmBanner({ pendingMutation, hint, onConfirm, onCancel })` component next to `useQuerySafeMode`, parameterized by the hint string. Extract a `useDbQueryRunner(credentialId, queryId?)` hook that owns `executing/result/error` state, the generation guard, and `extractErrorMessage`, and use it in both tabs.

## 2. DatabaseCard.tsx is dead code — only its own test imports it
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/vault/sub_databases/DatabaseCard.tsx:12
- **Scenario**: Repo-wide grep finds exactly two importers of `DatabaseCard`: the file itself and `__tests__/DatabaseCard.test.tsx`. The database list UI is rendered by `DatabaseListView.tsx` + `DBGrid.tsx`, neither of which references it — the card was evidently superseded by the DataGrid-based list.
- **Root cause**: Component replaced by `DBGrid` but the old card and its 7-case test suite were left behind.
- **Impact**: ~63 lines of unused component plus a ~120-line test file that keeps passing and consumes CI time while asserting behavior no user can reach; misleads readers into thinking a card view exists.
- **Fix sketch**: Delete `DatabaseCard.tsx` and `__tests__/DatabaseCard.test.tsx`. Verification: repo-wide grep (done for src/) is clean; a final check for dynamic/lazy imports of the path before deleting is cheap.

## 3. QueryEditorPane runQuery lacks the stale-response guard — out-of-order results render against the wrong query
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: stale-async
- **File**: src/features/vault/sub_databases/tabs/QueryEditorPane.tsx:66-76
- **Scenario**: User runs a slow query, edits or switches the saved query, and runs again — or the component unmounts (tab switch) mid-flight. The first `executeDbQuery` promise resolves late and unconditionally calls `setResult`/`setError`/`setExecuting(false)`, so a stale result is displayed under the new query's title, or state is set on an unmounted component.
- **Root cause**: ConsoleTab guards this with `queryGenRef` (ConsoleTab.tsx:35,39,46,49); QueryEditorPane's otherwise-identical `runQuery` skipped the guard.
- **Impact**: User-visible wrong data (result table attributed to a different query text) and a spinner that flips off while a newer execution is still running; wasted renders from dead responses.
- **Fix sketch**: Port the generation-counter pattern from ConsoleTab: `const gen = ++genRef.current` at start, bail out of every `set*` when `gen !== genRef.current`, and bump the counter on `selectedId` change. Falls out for free if finding 1's shared `useDbQueryRunner` hook is extracted.

## 4. QueriesTab filters the store array in render, invalidating handleSelect's memoization every render
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/vault/sub_databases/tabs/QueriesTab.tsx:16-30
- **Scenario**: `useVaultStore((s) => s.dbSavedQueries).filter(...)` produces a new `queries` array identity on every render; `handleSelect` lists `queries` as a `useCallback` dep, so the callback is recreated each render and the memoization is a no-op, defeating any `memo` on `QuerySidebar` and re-running `queries.find` per render.
- **Root cause**: Filtering happens outside the selector and outside `useMemo`, then feeds a `useCallback` dependency.
- **Impact**: Bounded — saved-query lists are small — but the `useCallback` is pure ceremony as written, and every unrelated `vaultStore` update re-renders the whole tab subtree.
- **Fix sketch**: Wrap the filter in `useMemo(() => all.filter(...), [all, credentialId])` after selecting the raw array, or have `handleSelect` read the list via `useVaultStore.getState()` so its deps are just `credentialId`. Either restores a stable callback identity.

## 5. extractErrorMessage duplicated between safeModeUtils and lib/utils/apiError
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/vault/sub_databases/safeModeUtils.ts:71 (vs src/lib/utils/apiError.ts:140)
- **Scenario**: Two independent Tauri-IPC-error-to-string helpers exist: the exported one here (used by ConsoleTab, QueryEditorPane, ChatTab) and a private one in `lib/utils/apiError.ts` with a `fallback` parameter. New error shapes get handled in one and not the other.
- **Root cause**: Feature-local utility written without checking for the existing shared error extractor; the shared one is not exported.
- **Impact**: Drift in error-message normalization across features; minor, but it lives in a file (`safeModeUtils.ts`) whose stated purpose is SQL classification, not error formatting.
- **Fix sketch**: Export a single `extractErrorMessage(err, fallback?)` from `lib/utils/apiError.ts`, migrate the three sub_databases callers, and delete the local copy from safeModeUtils.ts. Cross-context callers of apiError.ts should be re-run through tsc to confirm the signature change is additive.
