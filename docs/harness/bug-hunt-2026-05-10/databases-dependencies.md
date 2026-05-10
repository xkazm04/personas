# Bug Hunt — Databases & Dependencies

> Group: Vault & Credentials
> Files scanned: 18
> Total: 0C / 4H / 7M / 3L = 14 findings

> Note: the in-scope file list referenced `DatabasesPage.tsx`, `SavedQueriesPanel.tsx`,
> `SchemaTree.tsx`, `DependencyGraphPage.tsx`, `DependencyList.tsx` — none of these
> names exist in the repo. Used the closest analogues: `DatabaseListView`,
> `tabs/QueriesTab` + `QuerySidebar`, `SchemaManagerModal` + `introspectionQueries`,
> `CredentialRelationshipGraph` + `GraphCanvas`, and `credentialGraph.ts` for the
> dependency logic. Plus the `vault` zustand slice and `db_schema.rs` Tauri command.

---

## 1. `dbSchemaTables` is global state but used as per-credential cache, clobbering on every modal open

- **Severity**: high
- **Category**: stale-closure
- **File**: `src/stores/slices/vault/databaseSlice.ts:58`
- **Scenario**:
  1. `DatabaseListView` mounts → renders cards for credentials A, B, C with `tableCount` derived from `dbSchemaTables` (currently empty → all show 0).
  2. User opens credential A's `SchemaManagerModal`. `fetchDbSchemaTables(A)` runs → `set({ dbSchemaTables: tables_for_A })` REPLACES the whole array.
  3. `DatabaseListView` rebuilds `tableCountByCredential`: only A has counts; B and C still show 0 (correct only by coincidence).
  4. User closes the modal, opens credential B. Store now holds only B's tables. A's card silently shows 0 tables even though the modal had loaded them seconds ago.
- **Root cause**: `fetchDbSchemaTables` writes a flat global array keyed by nothing, instead of merging per credential id (e.g. `Map<credentialId, DbSchemaTable[]>` or `[...others, ...tables]`).
- **Impact**: the database grid's "tables" column is wrong almost always; users can't trust the counts and assume schema introspection broke.
- **Fix sketch**: Either (a) keep a per-credential map in the slice and have selectors filter, or (b) merge: replace only entries whose `credential_id === credentialId` and append the new ones — `set((state) => ({ dbSchemaTables: [...state.dbSchemaTables.filter(t => t.credential_id !== credentialId), ...tables] }))`.

## 2. `dbSavedQueries` has the same global-replacement bug — saved-query counts go stale across credentials

- **Severity**: high
- **Category**: stale-closure
- **File**: `src/stores/slices/vault/databaseSlice.ts:102`
- **Scenario**:
  1. Three database credentials each have 5 saved queries — never loaded yet, all cards show "0 queries".
  2. User opens credential B's modal → `fetchDbSavedQueries(B)` writes `dbSavedQueries: queries_for_B` (5 queries).
  3. User closes modal. `DatabaseListView` recomputes `queryCountByCredential`: B now correctly shows 5 but A and C still show 0 even though they each have 5 saved queries on disk.
  4. User opens A → store now holds A's 5; B's card flips back to 0.
- **Root cause**: same as #1, `set({ dbSavedQueries: queries })` discards every other credential's queries.
- **Impact**: query counts in the database list view oscillate based on which modal was opened last; users distrust the metadata layer.
- **Fix sketch**: merge by credential id like the fix proposed in #1, or migrate to a `Record<credentialId, DbSavedQuery[]>` shape.

## 3. Dangling event references silently disappear from blast-radius analysis

- **Severity**: high
- **Category**: dangling-reference
- **File**: `src/features/vault/sub_dependencies/credentialGraph.ts:427`
- **Scenario**:
  1. Credential X is deleted from the credentials table.
  2. The `credential_events` row for X is NOT cascade-cleaned (or is cleaned async / via a separate job that hasn't run).
  3. `buildCredentialGraph` runs: `if (!nodeIds.has(evt.credential_id)) continue;` skips the orphaned event without warning, log, or any UI surface.
  4. Operator looks at the dependency graph trying to track down a noisy event firing somewhere → it's invisible.
- **Root cause**: the graph builder treats orphaned event rows as silent garbage instead of surfacing them as cleanup work or zombie nodes.
- **Impact**: dangling events run forever (or until manual SQL cleanup), invisible to the audit UI that's supposed to surface exactly this kind of staleness.
- **Fix sketch**: emit a "dangling event" warning collection from `buildCredentialGraph`, render a small badge in `GraphControls`, and/or have `delete_credential` always cascade-delete dependent events server-side.

## 4. Redis `TYPE ${key}` command injection from user-clicked key

- **Severity**: high
- **Category**: sql-injection
- **File**: `src/features/vault/sub_databases/tabs/TablesTab.tsx:36`
- **Scenario**:
  1. Operator runs a sloppy populate script that creates a Redis key with a literal newline or space, e.g. `"foo\nFLUSHDB"` or `"foo bar"` (Redis allows arbitrary binary keys).
  2. SCAN returns it; the user clicks the key in the sidebar.
  3. `executeDbQuery(credentialId, ` + "`TYPE ${key}`" + `)` produces a multi-line / multi-arg command string.
  4. Depending on how the Redis transport parses the literal text — if it splits on whitespace or honors `\r\n` framing — the second part of the key becomes a separate command.
- **Root cause**: the key is interpolated as raw text into a command string; even though the value came from Redis itself, Redis keys are arbitrary bytes and can't be trusted as command tokens.
- **Impact**: a maliciously-named key (or even a clumsy one) can execute additional Redis commands as the credential's user; in the worst case `FLUSHDB`, `CONFIG SET`, or `MIGRATE` against the target.
- **Fix sketch**: send a structured/escaped Redis command (RESP-aware), or at minimum reject any key containing whitespace / `\r` / `\n` and use `escapeRedisGlob` semantics for the key bytes.

## 5. `estimatedDailyExecutionsLost` rounds each persona to zero before summing — small-but-many traffic looks like zero impact

- **Severity**: medium
- **Category**: silent-failure
- **File**: `src/features/vault/sub_dependencies/credentialGraph.ts:288`
- **Scenario**:
  1. Credential is shared by 12 personas, each running 3 executions per week (`recentExecutions = 3`).
  2. `Math.round(3 / 7) = 0` for each persona.
  3. `estimatedDailyExecutionsLost = sum of zeros = 0`.
  4. The simulation renders "0 daily executions lost" → operator concludes revoking is safe, revokes, then 12 personas start failing the next day.
- **Root cause**: rounding before summation. The correct math is `Math.round((sum of recentExecutions) / 7)`.
- **Impact**: the chaos-engineering simulator's headline number is structurally biased toward "no impact" for any credential serving low-frequency-but-numerous personas — exactly the scenario where blast radius is most surprising.
- **Fix sketch**: `const totalRecent = affectedPersonas.reduce((s, p) => s + p.recentExecutions, 0); const estimatedDailyExecutionsLost = Math.round(totalRecent / 7);`

## 6. `failoverSuggestions` only matches identical `service_type`, missing same-family alternatives

- **Severity**: medium
- **Category**: edge-case
- **File**: `src/features/vault/sub_dependencies/credentialGraph.ts:299`
- **Scenario**:
  1. User has one Supabase credential (production) and one Neon credential (staging) — both Postgres.
  2. Supabase credential is leaked; user simulates revocation.
  3. Suggestion list filters by `c.service_type === 'supabase'` → only itself; Neon (a perfectly valid Postgres failover at the protocol level) is hidden.
  4. The "Mitigation" panel then says "no failover credentials of type supabase exist" and recommends creating a new one — actionable but slow during incident response.
- **Root cause**: the failover query is exact-match on connector slug, not on `getConnectorFamily()`-derived family.
- **Impact**: cross-vendor failovers (supabase↔neon, upstash↔redis) are invisible exactly when an operator is in incident-response mode and needs them most.
- **Fix sketch**: `import { getConnectorFamily } from '@/features/vault/sub_databases/introspectionQueries'; const family = getConnectorFamily(serviceType); ...filter((c) => c.id !== credentialId && getConnectorFamily(c.service_type) === family)`.

## 7. Missing health signals appear as $0 / 0-execs in revocation simulation — false "safe to revoke"

- **Severity**: medium
- **Category**: silent-failure
- **File**: `src/features/vault/sub_dependencies/credentialGraph.ts:280-283`
- **Scenario**:
  1. A persona has been freshly created (no health-signal samples yet) but is bound to a credential.
  2. Simulating revocation: `health = healthMap.get(personaId)` returns `undefined`; `recentExecutions ?? 0`, `dailyBurnRate ?? 0`, `grade ?? 'unknown'`.
  3. UI renders "0/day, $0.00 lost" → severity bucket is computed from agent count, but the headline impact metrics still read zero.
- **Root cause**: missing health is encoded the same as zero usage. There's no distinction between "we know it does nothing" and "we don't know yet".
- **Impact**: success-theater for new or under-instrumented personas; users decide to revoke based on misleading metrics.
- **Fix sketch**: when `health` is missing, render the persona row with an explicit "health unknown — impact uncertain" badge and gate the simulation summary on having health data for at least one affected persona; otherwise show a yellow-state warning.

## 8. Dependency-graph effect re-fires N IPC calls on every `credentials` array reference change

- **Severity**: medium
- **Category**: retry-storm
- **File**: `src/features/vault/sub_dependencies/CredentialRelationshipGraph.tsx:38-58`
- **Scenario**:
  1. User has 60 credentials.
  2. Background sync (or the user editing a credential in another tab) causes the `credentials` array reference to update.
  3. The effect re-runs and issues `Promise.all(credentials.map(...))` — 60 fresh `getCredentialDependents` Tauri IPCs.
  4. Repeated CRUD edits cause 60-call bursts every few seconds; the `cancelled` flag prevents stale writes but doesn't cancel the in-flight IPCs.
- **Root cause**: the effect depends on the entire `credentials` array — any reference change refetches everything for everyone, instead of diffing added/removed credentials.
- **Impact**: bursts of IPC traffic; on a slow disk or a remote user_db, this stutters the UI and can starve `require_privileged` lock waiters. With 60+ creds and 5 edits/min, that's 300+ IPCs/min.
- **Fix sketch**: depend on `credentials.map((c) => c.id).join(',')` (membership-only), and only refetch the specific credential whose dependent set might have changed; cache per-credential results.

## 9. `useQuerySafeMode` clears pending mutation when `runQuery` identity changes — clicking "Save" re-renders the dialog away

- **Severity**: medium
- **Category**: race-condition
- **File**: `src/features/vault/sub_databases/hooks/useQuerySafeMode.ts:33-38`
- **Scenario**:
  1. User edits a query, clicks Run on a `DELETE FROM ...`. Safe-mode dialog appears.
  2. While the dialog is open, the user toggles Safe Mode off (deps of `runQuery` in `QueryEditorPane.tsx:65` are `[credentialId, executeDbQuery, selectedId]` — but in `ConsoleTab.tsx:34` deps don't include `safeMode`, so this is fine for ConsoleTab; for the editor pane, anything that re-memos `executeDbQuery` from the slice instance — e.g. zustand's selector creating a fresh stable reference after a `set` call elsewhere — flips the identity).
  3. Effect on lines 33-38 sees `pendingRunQueryRef.current !== runQuery` → silently clears the dialog without telling the user.
  4. User stares at an empty editor convinced their `Confirm` click was queued.
- **Root cause**: ref-based context guard fires on referential inequality without distinguishing "user changed credential" from "store rehydrated and produced a new function instance".
- **Impact**: pending mutation dialogs occasionally vanish on store-tick; users re-submit the same destructive query, doubling the risk window.
- **Fix sketch**: capture a stable context key (credentialId + queryId) instead of the function identity; only clear when the *key* changes, not the closure.

## 10. `SchemaManagerModal` `useEffect` fetch ignores credential change while modal is mounted-but-key-changed

- **Severity**: medium
- **Category**: stale-closure
- **File**: `src/features/vault/sub_databases/SchemaManagerModal.tsx:87-90`
- **Scenario**: the effect fetches by `credential.id`. Combined with bug #1 and #2, when a parent re-renders the modal with a new credential prop without unmounting (e.g. via routing re-use), the previous credential's tables/queries remain in the global store until the new fetch completes. During that window, the modal renders the wrong credential's data — there's no `loading` state gating the tabs.
- **Root cause**: no per-credential loading flag; the fetch is fire-and-forget and the UI reads the global store optimistically.
- **Impact**: brief but real period where the schema modal shows credential A's tables under credential B's title.
- **Fix sketch**: track a `loadingCredentialId` flag in the slice; gate `<TablesTab>` / `<QueriesTab>` rendering on `loadingCredentialId === null` for the active credential.

## 11. `db_schema.rs` saved-query stats update silently drops on failure

- **Severity**: medium
- **Category**: silent-failure
- **File**: `src-tauri/src/commands/credentials/db_schema.rs:197-203`
- **Scenario**:
  1. User runs a saved query 50 times. The `update_query_run` call after each successful execution intermittently fails (DB busy, write lock contention, schema mismatch).
  2. The `tracing::warn!` records it server-side, but the Tauri response carries `Ok(QueryResult)` to the frontend.
  3. The "last run ok" / "last run duration" / counter columns in `db_saved_queries` drift from reality; the sidebar status dot (red/green) freezes at whatever was committed last.
- **Root cause**: the run-stats write is best-effort and intentionally not surfaced; "intentionally" without any retry, observability hook, or staleness detection.
- **Impact**: the green/red dot in `QuerySidebar.tsx:91-93` becomes a silent lie over time, defeating its purpose as an at-a-glance health indicator.
- **Fix sketch**: write run stats inside the same SQLite transaction that records the execution audit log; if that's not possible, expose a `metrics_drift_count` table and surface it in the UI when non-zero.

## 12. `SimulationPanel` injects translation strings via `dangerouslySetInnerHTML`

- **Severity**: low
- **Category**: secret-leak
- **File**: `src/features/vault/sub_dependencies/SimulationPanel.tsx:62-79`
- **Scenario**:
  1. `tx(dep.sim_high, { credentialName: '<strong>X</strong>' })` is interpolated into innerHTML.
  2. `safeCredentialName = escapeHtml(simulation.credentialName)` is escaped, but the surrounding translation string `dep.sim_high` is trusted.
  3. If a future translation file (or user-configurable i18n override, or auto-translation via an external service) contains `<script>` or `<img onerror>`, it executes inside the credential dependency UI — a privileged surface.
- **Root cause**: pattern of mixing escaped user input with unescaped translation templates; relies on translation pipeline being trusted forever.
- **Impact**: opens an XSS hole if the i18n bundle is ever sourced from anything other than the static `en.ts` file; latent risk that compounds as i18n grows.
- **Fix sketch**: drop `dangerouslySetInnerHTML` and split the string on the credential-name placeholder, rendering with React: `<>{prefix}<strong className="text-red-400">{credentialName}</strong>{suffix}</>`.

## 13. `ChatTab` `nlq-${Date.now()}` query IDs collide on rapid resubmit and `cancelNlQuery` errors are swallowed

- **Severity**: low
- **Category**: silent-failure
- **File**: `src/features/vault/sub_databases/tabs/ChatTab.tsx:67, 119`
- **Scenario**:
  1. User submits an NL query, decides to cancel mid-poll, clicks Cancel.
  2. `cancelNlQuery(activeQueryId).catch(() => {})` swallows any backend error — if the backend never received the cancel (network blip, IPC race), the query keeps running and eventually writes results to a snapshot the frontend already abandoned.
  3. UI shows "Cancelled." but the next time the user opens chat, no new state appears (the snapshot for the cancelled id is still completed but unread).
- **Root cause**: cancellation is fire-and-forget without verifying the backend acknowledged it; the swallow-everything `catch` is overly permissive.
- **Impact**: ghost NL-query work continues consuming model tokens after user cancels; user has no visibility.
- **Fix sketch**: `await cancelNlQuery(...).catch(toastCatch('ChatTab:cancel'))` and only flip state to `failed` after acknowledgement; or include a server-side cancel confirmation in `getNlQuerySnapshot`.

## 14. Pin-table double-click race creates duplicate `db_schema_tables` rows

- **Severity**: low
- **Category**: race-condition
- **File**: `src/features/vault/sub_databases/tabs/TablesTab.tsx:62-67`
- **Scenario**:
  1. User double-clicks the Pin button rapidly (or hits Enter twice on a focused button).
  2. Both invocations of `handlePinTable` evaluate `alreadyPinned = pinnedTables.some(...)` synchronously; both see `false` because `createTable` hasn't returned yet, and the slice's `set((state) => ({ dbSchemaTables: [...state.dbSchemaTables, table] }))` hasn't run.
  3. Two `createTable` IPCs fire. Two `DbSchemaTable` rows are inserted (the backend has no unique constraint on `(credential_id, table_name)` based on `db_schema.rs:24-39`).
  4. `TablesTab` renders the same table twice in pinned section.
- **Root cause**: client-side dedupe based on stale state; no server-side uniqueness or optimistic-create lock.
- **Impact**: duplicate rows, confused UI, possibly compounding on every pin click.
- **Fix sketch**: add a `UNIQUE (credential_id, table_name)` index in the migration for `db_schema_tables`; in the slice, track an in-flight Set of `${credentialId}:${tableName}` to dedupe before issuing the IPC.
