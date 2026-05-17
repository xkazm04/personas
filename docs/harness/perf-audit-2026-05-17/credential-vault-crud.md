# Perf-Optimizer Scan — Credential Vault & CRUD

> Project: Personas (frontend-only)
> Scope: 8 paths in src/
> Total: 10 findings (1 critical / 4 high / 4 medium / 1 low)

## Scope notes

In-scope paths examined: `src/features/vault/sub_credentials/components/{list,manager,features,forms,picker,gateway,workspace,import,card}`, `src/features/vault/sub_credentials/manager/*`, `src/features/vault/shared/{hooks,playground,utils,vector}`, `src/features/vault/sub_dependencies/*`, `src/api/vault/credentials.ts`, `src/api/vault/rotation.ts`, `src/api/vault/database/*`, `src/stores/slices/vault/{credentialSlice,rotationSlice,databaseSlice,catalogPrefsSlice,automationSlice}.ts`. Drift: a handful of read-only Grep call-site checks reached outside the scope (e.g. `src/features/home/.../ConnectedServicesWidget.tsx`, `src/features/templates/sub_n8n/edit/useConnectorStatuses.ts`) — purely to count duplicate `fetchCredentials()` callers; nothing outside scope is implicated in findings.

## 1. `CredentialList` re-renders every row on each global credentials/connectors mutation (no row memoization, no virtualization)

- **Severity**: critical
- **Category**: re-render
- **File**: `src/features/vault/sub_credentials/components/list/CredentialList.tsx:130`, `src/features/vault/sub_credentials/components/list/CredentialListColumns.tsx:175`, `src/features/vault/sub_credentials/components/list/useCredentialListFilters.ts:80`
- **Scenario**: User on the vault list with 50+ credentials while bulk healthcheck runs (`useBulkHealthcheck` patches credentials in batches of 5 via `useVaultStore.setState`), or while typing in the search box (re-runs `filterAndSortCredentials` from scratch every keystroke), or while the rotation ticker subscribes a card.
- **Root cause**: `filteredCredentials` and the derived `displayRows` are recomputed on every change to `credentials`/`connectorDefinitions`. `useCredentialColumns` re-creates each column array when `pendingDeleteIds` (a `Set`) changes — but more importantly, every call to `fetchCredentials()` produces a new `credentials` array, every `setState` map() in `useBulkHealthcheck` returns a brand-new array, and `DataGrid` then re-renders all rows because `data={displayRows}` is a new reference. No `React.memo` on the row content. With `pageSize={25}` the grid is not virtualized (just paginated), but the render cost on each filter/health-tick is O(filteredCredentials), which dominates at 50+ creds.
- **Impact**: Vault list jank during bulk healthcheck (visible 200–400 ms stalls on rotation ticks). Search input feels laggy >50 creds because every keystroke triggers a full filter + sort + connector-lookup + map.
- **Fix sketch**: (a) Memoize a `CredentialRow` component with `React.memo` comparing `row.credential.id`, `healthcheck_last_success`, `healthcheck_last_tested_at`, and `pendingDeleteIds.has(id)`. (b) Pre-compute `connectorByName` once at the vault-store level (or via `useShallow`) so `getConnectorForType` is stable. (c) Either replace `DataGrid` pagination with `react-virtual` row windowing for the common dense view, or debounce the `searchTerm` input by 120 ms before pushing it into `filterAndSortCredentials`. (d) `pendingDeleteCredentialIds` should be a plain object map instead of `Set` so equality checks can be field-level — currently every add/delete spawns a new `Set` and rebuilds all columns.

## 2. `fetchCredentials` is called from 35+ components with no in-flight dedup or staleness window

- **Severity**: high
- **Category**: duplicate-call
- **File**: `src/stores/slices/vault/credentialSlice.ts:61`, callers across `src/features/vault/sub_credentials/manager/{useCredentialManagerState.ts:95, useCatalogHandlers.ts:92, useCatalogHandlers.ts:106, useRotateAll.ts:49, CredentialManagerViews.tsx:93, CredentialAddViews.tsx:51,61}`, `src/features/vault/sub_credentials/components/features/CredentialScopeSection.tsx:39`, plus 28+ out-of-scope callers (matrix, observability, templates, home cockpit).
- **Scenario**: Open the vault manager — `useCredentialManagerState` runs `Promise.all([fetchCredentials(), fetchConnectorDefinitions()])`. While that's pending, `ConnectedServicesWidget`, `useObservabilityData`, and other widgets each fire their own `fetchCredentials()` in mount-time `useEffect`s. After credential save, `useCatalogHandlers.handleCreateCredential` calls `fetchCredentials()` then `CredentialAddViews` `onComplete` callbacks call it again. `useRotateAll.handleRotateAll` issues a final `fetchCredentials()` after rotating each cred sequentially.
- **Root cause**: `fetchCredentials` in `credentialSlice.ts` has no in-flight promise cache and no min-interval guard — every call hits `list_credentials` IPC and replaces the `credentials` array, triggering every subscriber. The store also has no `__lastFetchedAt` to short-circuit redundant fetches from independent mount-time effects.
- **Impact**: 4–8 redundant IPC list_credentials per route load (~30–80 ms each, but they overlap and triple the Zustand notifications). Worst-case during a manager mount with widgets visible: 6 concurrent fetches each producing a new `credentials` array, each triggering full vault re-render (combined with finding #1, this is the dominant cause of the open-vault jank).
- **Fix sketch**: Wrap `fetchCredentials` with an in-flight dedup (`pendingFetchPromise`) and a 2-second staleness window: callers within 2 s of a successful fetch reuse the cached array. Add a forced-bypass option for post-mutation refresh paths. The same pattern should also apply to `fetchConnectorDefinitions` and `fetchCredentialEvents`. (See also #6.)

## 3. `CredentialRelationshipGraph` re-fetches all credential dependents on every credentials mutation (N+1 IPC, O(N) work in render)

- **Severity**: high
- **Category**: duplicate-call
- **File**: `src/features/vault/sub_dependencies/CredentialRelationshipGraph.tsx:38-58`
- **Scenario**: User opens the Dependencies graph view; bulk healthcheck or `Rotate All` runs in parallel from the manager — the `credentials` zustand state mutates after each store batch, retriggering the load effect.
- **Root cause**: The load effect depends on `credentials` (full array reference). Every credentials mutation (~every 5 healthchecks in `useBulkHealthcheck` flush, or every individual rotation in `useRotateAll`'s for-loop) re-fires `Promise.all(credentials.map(getCredentialDependents))` — N IPCs per cred. Additionally, `buildCredentialGraph`, `analyzeBlastRadius`, and `simulateRevocation` are O(N·E) and re-run on every memo invalidation; `GraphCanvas` then does `nodes.find(...)` per edge per render (`GraphCanvas.tsx:97–98`) which is O(E·N).
- **Impact**: On a vault with 50 creds while `Test All` is running, the graph triggers ~50 dependents IPCs every batch flush (10×N IPCs across the run), each followed by full graph rebuild + filter recompute. Tab freezes for hundreds of ms repeatedly.
- **Fix sketch**: (a) Replace the `credentials` array dep with a stable list of credential IDs (`useMemo(() => credentials.map(c => c.id).join(','), [credentials])`). (b) Move `dependentsMap` into a module cache keyed by credential-set hash with a ~30 s TTL, so transient credentials mutations don't refetch. (c) In `GraphCanvas`, build a `Map<string, GraphNode>` once via `useMemo` and replace `nodes.find` with `map.get(id)`. (d) Memoize the costly `simulateRevocation` independently of `graph` reference equality.

## 4. `useRotateAll` rotates credentials sequentially, blocking on each IPC

- **Severity**: high
- **Category**: async-coordination
- **File**: `src/features/vault/sub_credentials/manager/useRotateAll.ts:32-51`
- **Scenario**: User clicks "Rotate All" with 10 OAuth credentials. Each `rotateCredentialNow` is awaited one-by-one in a for-loop.
- **Root cause**: Sequential `for (const cred of rotatable) { await rotateCredentialNow(cred.id); }`. Each OAuth refresh takes 0.5–3 s; 10 creds → up to 30 s of wall-clock during which the "Rotating" button stays in flight and no progress is shown. The full `fetchCredentials()` only runs at the end — users see no progressive feedback.
- **Impact**: 5–30 s freeze of the rotate-all button for typical OAuth-heavy vaults; UI cannot show interim results. Compare to `useBulkHealthcheck` which correctly parallelizes with CONCURRENCY=3.
- **Fix sketch**: Mirror `useBulkHealthcheck`'s worker pool: cap at 3–5 concurrent rotations, set per-cred status into a `Map<string, 'pending'|'ok'|'failed'>`, and call `fetchCredentials()` once at the end. Surface progress (`{done}/{total}`) in the button label.

## 5. `CredentialIntelligence` modal triple-fetches on every `credentialId` change with no shared cache

- **Severity**: high
- **Category**: duplicate-call
- **File**: `src/features/vault/sub_credentials/components/features/CredentialIntelligence.tsx:43-64`
- **Scenario**: User clicks through 5 credentials in the list to inspect Intelligence tabs. Each open issues 3 IPCs (`getCredentialUsageStats`, `getCredentialDependents`, `getCredentialAuditLog`) with no caching. Re-opening the same credential re-runs all three.
- **Root cause**: `useEffect` calls `Promise.all([...])` keyed only on `credentialId` with no module-level cache or in-flight dedup. `getCredentialAuditLog` is called with `limit: 500` — a full audit dump on every reopen.
- **Impact**: 3 IPCs × N modal opens; the 500-row audit log is consistently the slowest IPC (~80–200 ms). Same data is fetched again when `CredentialRelationshipGraph` calls `getCredentialDependents` for the same cred.
- **Fix sketch**: Build a `useCredentialIntelligence(credentialId)` hook backed by `createModuleCache` (same pattern as `useCredentialHealth`'s `resultCache`) with a 60 s TTL. Have `CredentialRelationshipGraph` consume the same cache so dependents aren't fetched twice for the same cred. Drop default audit limit to 100 and paginate further on demand.

## 6. `useCredentialManagerState` daily-bulk-healthcheck effect rebuilds `healthcheckCredentials` on every credentials mutation, causing redundant idle-callback churn

- **Severity**: medium
- **Category**: re-render
- **File**: `src/features/vault/sub_credentials/manager/useCredentialManagerState.ts:34-120`
- **Scenario**: During `useBulkHealthcheck.run`, the store flushes patches every 5 results. Each flush invalidates `credentials` reference, re-deriving `healthcheckCredentials`, but its `.length` happens to stay the same, so the effect at line 106 sees `healthcheckCredentials.length` unchanged and re-runs only when length changes — however the `healthcheckCredentials` memo itself recomputes every flush (new Set, new filter), and is also passed to `TestAllButton` via `credentials` prop, breaking `bulk.run`'s argument identity on retries.
- **Root cause**: `healthcheckCredentials` memo depends on whole `credentials` and `connectorDefinitions` arrays. The daily-run effect dep array `[loading, healthcheckCredentials.length]` papers over part of the problem but does not stop the memo recompute itself, and the bulk-summary cache subscription causes additional re-renders.
- **Impact**: Mid-level — extra GC pressure during long bulk runs; subtle UI flicker on `TestAllButton`.
- **Fix sketch**: Replace the memo with a stable lookup function based on connector names (memoize the Set, not the filtered array); pass `() => healthcheckCredentialsRef.current` into `bulk.run` instead of a new array each render.

## 7. `RotationActivePolicy` re-issues N+1 IPCs to delete/update a single rotation policy

- **Severity**: medium
- **Category**: algorithmic
- **File**: `src/features/vault/sub_credentials/components/features/RotationActivePolicy.tsx:91-104,143-148`
- **Scenario**: User clicks "Remove policy" — code calls `listRotationPolicies(credentialId)` then `deleteRotationPolicy(p.id)` in a sequential for-loop. Similarly "Save period" calls `listRotationPolicies` then `updateRotationPolicy(allPolicies[0].id, ...)`.
- **Root cause**: The active-policy panel already has access to `rotationStatus.has_policy` and the policy interval, but it does not know the policy ID — so it round-trips through `listRotationPolicies` to discover IDs every time. For credentials with multiple policies the delete is sequential.
- **Impact**: Every save/delete is 2 IPCs minimum and grows with policy count. Latency-visible: ~150–300 ms instead of ~80 ms.
- **Fix sketch**: Have the backend's `getRotationStatus` return the active policy IDs (or the full policy record), eliminating the discovery `list` call. Run policy deletes via `Promise.all`. If schema change is too invasive, cache `listRotationPolicies` results in the rotation slice keyed by `credentialId`.

## 8. `useUndoDelete` adds a synchronous `listCredentialEvents` IPC into the delete-confirm UX, blocking the dialog open

- **Severity**: medium
- **Category**: async-coordination
- **File**: `src/features/vault/shared/hooks/useUndoDelete.ts:22-30`
- **Scenario**: User clicks the trash icon on any credential row. `requestDelete` awaits `listCredentialEvents(cred.id)` before opening the confirm dialog.
- **Root cause**: The delete confirm dialog wants to show `eventCount`, so it serially fetches events first. There is no cached lookup against the already-loaded `credentialEvents` array in the vault store (which holds *all* events from `fetchCredentialEvents`).
- **Impact**: 80–250 ms delay before the confirm dialog appears every time the user clicks Delete. Feels unresponsive on slower IPC roundtrips.
- **Fix sketch**: Filter `useVaultStore.getState().credentialEvents` by `credential_id` to compute `eventCount` synchronously and open the dialog immediately. Optionally refresh in the background and update the dialog count post-open.

## 9. `useRemediationEvaluator` calls `JSON.parse(credential.metadata)` per cred per evaluation tick, no memoization

- **Severity**: medium
- **Category**: algorithmic
- **File**: `src/features/vault/shared/hooks/health/useRemediationEvaluator.ts:42-51,65-129`
- **Scenario**: Every 30 minutes (or forced via `forceEvaluate`), the evaluator iterates *all* credentials and `JSON.parse`-es each `metadata` string. Re-runs on every credentials mutation due to `useCallback` dep `[credentials]` rebuilding `evaluate` and thus retriggering the `[evaluate]` effect at line 155.
- **Root cause**: (a) `[evaluate]` in the start-evaluation effect makes the interval re-bind on every credentials change — `setInterval` is cleared and re-armed, leaking the previous timer's pending tick and resetting the cadence. (b) No memo on the parsed metadata; `parseAnomalyFromMetadata` re-parses on every cred per tick. (c) `parseAnomalyFromMetadata` has no schema validation — accepts any JSON shape, silently swallows parse errors (low-severity, no observability).
- **Impact**: Low CPU but high re-arming churn — the 30-minute timer is reset whenever the vault list mutates, so the evaluation may never actually trigger on a busy vault. Bigger correctness bug than perf, but the JSON-parse hot-path matters at 100+ creds.
- **Fix sketch**: Drop `[evaluate]` from the interval effect's deps (use a ref), parse metadata once per credential into a memoized map keyed by `cred.metadata` string identity. Have `credentialSlice` materialize `anomaly_score` into a typed field when ingesting credentials so the JSON parse is one-shot.

## 10. `getCredentialAuditLog(credentialId, 500)` is unbounded by default for the intelligence audit tab

- **Severity**: low
- **Category**: data-layer
- **File**: `src/features/vault/sub_credentials/components/features/CredentialIntelligence.tsx:50`, `src/api/vault/credentials.ts:103`
- **Scenario**: Heavy credential with months of usage. Audit tab fetches up to 500 entries on every modal open, all rendered through `AuditLogTable` (paginated client-side by 20 but loaded in memory).
- **Root cause**: Hard-coded `limit: 500`; `AuditLogTable` does in-render filter/slice without virtualization. With repeated `decrypt`/`healthcheck` calls a single credential can produce 500 entries in days.
- **Impact**: ~80–200 ms IPC + 1–2 MB of JSON serialized through Tauri's bridge on every open; trivial on cold open, but stacks with finding #5's duplicate-fetch pattern.
- **Fix sketch**: Default `limit` to 50, fetch more on "Load more" clicks. Add a server-side pagination token if backend supports it. Combine with the cache in #5.
