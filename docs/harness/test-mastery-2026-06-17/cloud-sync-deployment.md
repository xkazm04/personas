# Test Mastery — Cloud Sync & Deployment
> Total: 8 findings (1 critical, 4 high, 2 medium, 1 low)

Scope note: the manifest lists `src-tauri/src/engine/workspace_sync/mod.rs`, but that file is a 36-line facade — the real logic lives in its `merge.rs` / `crypto.rs` / `snapshot.rs` submodules, all of which already carry strong, honest unit tests (LWW resolution, tombstone propagation, AES-GCM round-trip/tamper rejection, content-hash stability). `workspace_sync` is also explicitly Stage-1 with no production caller yet, so its risk-weight is low. The *live* cloud-sync data-write path that the in-scope `src/api/cloudSync.ts` actually drives is `src-tauri/src/cloud/sync/*` — that is where the real, unguarded business risk is, so the findings center there plus the in-scope deployment frontend.

## 1. Incremental sync cursor advancement (the data-loss watermark) is untested
- **Severity**: critical
- **Category**: coverage-gap
- **File**: src-tauri/src/cloud/sync/mod.rs:265-284 (`sync_table_inner`) + src-tauri/src/cloud/sync/cursor.rs:33-51
- **Current test state**: none (mod.rs tests only cover `SyncReport::is_clean`/`first_error` and the `SYNC_TABLES` length/key-uniqueness shape; cursor.rs has zero tests)
- **Scenario**: The cursor decides which local rows ever reach the user's cloud. The code comment (lines 272-283) documents a previously-shipped data-loss bug: setting the cursor to wall-clock `now()` permanently skipped any row committed after the SELECT snapshot but stamped before that instant. The fix is `let new_cursor = observed_max.unwrap_or(cursor_prev_fallback)`. Nothing asserts this invariant. A regression that reintroduces `now()`, or that advances the cursor on an empty result set instead of holding `cursor_prev`, silently drops persona/execution/memory rows from cloud sync forever — no error, no telemetry, a clean-looking pass.
- **Root cause**: The advancement logic depends on a live `DbPool` + `SyncClient.upsert`, so it was never extracted into a pure, testable unit; the watermark decision is inline in an async fn that also does network I/O.
- **Impact**: Silent, permanent cross-device data loss — the exact failure the comment says already happened once. Highest blast radius in this context.
- **Fix sketch**: Extract the watermark decision into a pure helper `fn next_cursor(observed_max: Option<&str>, cursor_prev: &str) -> String` and unit-test it: (a) `observed_max=Some(x)` → returns `x`; (b) `observed_max=None` (empty pass) → returns `cursor_prev` unchanged (never advances on no rows); (c) the returned cursor is never strictly greater than any row not read. Pair with an `#[ignore]` / in-memory-SQLite integration test on `sync_table_inner` asserting that two consecutive passes with a row inserted between them still sync that row. This is partially LLM-generatable once `next_cursor` is extracted — the invariant to assert is "cursor only ever moves to a watermark that was actually observed."

## 2. Tombstone (delete-propagation) cursor-hold-on-failure is untested
- **Severity**: high
- **Category**: coverage-gap
- **File**: src-tauri/src/cloud/sync/mod.rs:355-395 (`delete_persona_cascade`, `process_tombstones`)
- **Current test state**: none
- **Scenario**: When a persona is deleted locally, its cloud rows must be cascade-deleted in a fixed child-before-parent order, and the tombstone cursor must advance only if every delete succeeded (lines 384-393). Two business invariants ride on this: (1) a mid-cascade failure must NOT advance the cursor (so the failed + later tombstones are retried next pass, line 387-389), and (2) `synced_personas` must be deleted LAST so a partial failure leaves the persona present and retried rather than orphaning children cloud-side. Neither is asserted. A regression that advances the cursor on partial failure leaves deleted personas' child rows (executions, messages, memories) orphaned in the user's cloud forever — a privacy/correctness leak (user deleted it; it persists).
- **Root cause**: Logic is welded to a real `SyncClient`; no fake/mock client exists to drive the failure path.
- **Impact**: Orphaned cloud data after deletion (privacy + GDPR-shaped risk) and/or stalled delete propagation.
- **Fix sketch**: Introduce a trait/seam over `SyncClient.delete` (or a test double) and assert: delete order is child-tables → events(target_persona_id) → personas(last); on an injected mid-cascade error, the tombstone cursor is NOT advanced and the returned `LastTable` carries `error: Some(..)`; on full success the cursor advances to `tick_start`.

## 3. `cloud_sync_now` reports success-theater: "synced N rows" toast fires even when the pass had per-table errors
- **Severity**: high
- **Category**: missing-assertion
- **File**: src/features/settings/sub_account/components/CloudSyncCard.tsx:90-103 + src-tauri/src/commands/infrastructure/cloud_sync.rs:37-42
- **Current test state**: none (CloudSyncCard has no test)
- **Scenario**: `cloud_sync_now` calls `run_sync_once` (which swallows all per-table failures into the status snapshot) and then returns the status as `Ok(...)` regardless of outcome. The frontend `onSyncNow` treats any resolved promise as success and pops a green "Synced {count} rows" toast using `rowsSyncedLast` — even when `lastError`/per-table `error` is populated and the pass was *not* clean. The user is told sync succeeded while a table silently failed.
- **Root cause**: The IPC contract conflates "the command ran" with "the sync succeeded"; the UI never inspects `fresh.lastError` before deciding tone.
- **Impact**: Users trust a sync that partially failed; missing rows go unnoticed → silent divergence between devices.
- **Fix sketch**: Component test (vitest + RTL, mock `@/api/cloudSync`): `cloudSyncNow` resolves with `{ rowsSyncedLast: 5, lastError: "table X failed", tables: [{error: ...}] }` → assert the card surfaces an error/warning tone (not a plain success toast) and renders the per-table error row. Lock the invariant "a non-clean pass never renders as unqualified success." This also justifies a small product decision: decide whether `cloud_sync_now` should return an error tone or the UI should branch on `lastError`.

## 4. `compareValues` sort comparator (and `statusBadge`/`targetBadge`) untested — only the two status mappers are
- **Severity**: high
- **Category**: llm-generatable
- **File**: src/features/agents/sub_deployment/components/deploymentTypes.ts:113-124 (also 95-108)
- **Current test state**: exists-but-weak — `deploymentTypes.test.ts` covers `mapCloudStatus`/`mapGitlabStatus` honestly but stops there; `compareValues`, `statusBadge`, `targetBadge` are exported and unused by any test.
- **Scenario**: `compareValues` drives every column sort in the unified deployment table across heterogeneous Cloud+GitLab rows. The risky branches: `desc` negation, numeric `invocations` subtraction (NaN/overflow), and the null-coalescing on `lastActivity`/`createdAt` (`(a.lastActivity ?? '')` sorts nulls as the empty string — a real ordering contract). A regression flipping the `dir` sign, or comparing nulls inconsistently, silently mis-orders the operator's fleet view (they pause/undeploy the wrong row).
- **Root cause**: New helpers were added to the file after the test was written; no ratchet caught the gap.
- **Impact**: Wrong row targeted in destructive pause/undeploy actions; eroded trust in the dashboard.
- **Fix sketch**: LLM-generatable batch in the existing `deploymentTypes.test.ts`. Invariants to assert (not snapshots): for each `SortKey`, `compareValues(a,b,key,'asc') === -compareValues(a,b,key,'desc')` (antisymmetry); `invocations` sorts numerically (10 before 9 is wrong); null `lastActivity`/`createdAt` sort consistently (all nulls cluster, deterministic vs non-null); `statusBadge` returns a class for all 4 `DeployStatus` variants (exhaustiveness — a new variant must fail compile or test).

## 5. Cloud deployment slice optimistic-rollback on failure is untested
- **Severity**: high
- **Category**: coverage-gap
- **File**: src/stores/slices/system/cloudSlice.ts:304-345 (pause/resume/remove) + 349-413 (bulk)
- **Current test state**: none
- **Scenario**: Each single action snapshots `prevDeployments`, mutates state, and on error restores the snapshot via `reportError`. Bulk actions use `Promise.allSettled` and apply only fulfilled updates, mapping `results[i]` back to `deploymentIds[i]` by index. The index-correlation in bulk (lines 354-361/376-383/398-406) is exactly the kind of off-by-one that silently attributes one deployment's error to another, or applies an update to the wrong row. The rollback contract (state returns to `prevDeployments` on failure) is unverified.
- **Root cause**: Store actions wrap real IPC calls; no test harness mocks `@/api/system/cloud` to exercise success+failure interleavings.
- **Impact**: A failed pause/undeploy can leave the UI showing the wrong status (state not rolled back), or bulk results mis-attribute errors → operator acts on bad information for live, billable deployments.
- **Fix sketch**: vitest store test mocking `cloudPauseDeployment`/`cloudUndeploy` etc. Assert: single action failure restores `cloudDeployments` exactly to the pre-call array and sets `cloudError`; bulk with a mixed fulfilled/rejected set applies updates ONLY to the fulfilled ids, returns `BulkActionResult[]` with correct per-id status, and the `deploymentId` in each result matches the input index (correlation invariant).

## 6. `deployTarget` error translation + `isAuthError` classification untested
- **Severity**: medium
- **Category**: llm-generatable
- **File**: src/stores/slices/system/deployTarget.ts:43-127
- **Current test state**: none
- **Scenario**: `translateDeployError` is the single funnel every cloud/gitlab error passes through before the user sees it (used throughout cloudSlice). Rule precedence matters: target-specific rules win over shared rules, and the first matching pattern wins. `isAuthError` decides whether a reconnect failure notifies the user (auth/expired/revoked) or stays silent (network) — a wrong classification either spams users on transient blips or hides real credential expiry. Pure functions over strings; trivially testable; zero coverage.
- **Root cause**: Helper module added without accompanying tests; pure-function gap.
- **Impact**: Misclassified errors → either alarm fatigue or a silently-dead cloud connection the user never learns about.
- **Fix sketch**: LLM-generatable. Invariants: each shared/target pattern maps to its expected `en.deploy_errors.*` message; target-specific rule beats a shared rule on an overlapping input; unmatched input falls back to prefix-stripped raw; `isAuthError` returns true for `{kind:'auth'}` / `{kind:'forbidden'}` and for 401/403/unauthorized/forbidden/expired/revoked strings, false for "connection refused"/"timed out".

## 7. `value_looks_secret` base64/hex-density branch + `project_event_payload` decrypt-failure path under-tested
- **Severity**: medium
- **Category**: missing-assertion
- **File**: src-tauri/src/cloud/sync/rows.rs:52-70 (`value_looks_secret`) + 113-120 (`project_event_payload`)
- **Current test state**: exists-but-weak — tests cover known-prefix redaction (`sk-...`), non-JSON drop, size bound, and plaintext-without-IV passthrough, but NOT the "long dense high-entropy string under an innocuous key" branch (lines 60-67) nor the "encrypted-payload decrypt failure → None (never leak ciphertext)" path (line 115).
- **Scenario**: The density heuristic is the last line of defense against an un-prefixed credential (e.g. a raw base64 API token) leaking into a synced event payload that lands in the user's cloud. The decrypt-failure path guarantees ciphertext is never pushed when AES decryption fails. Both are credential-boundary guarantees with no assertion — a regression loosening the density threshold or returning `Some(ciphertext)` on decrypt error leaks secrets cloud-side.
- **Root cause**: Happy-path-biased test selection; the adversarial inputs (dense non-prefixed token, undecryptable ciphertext) were skipped.
- **Impact**: Credential/secret leak into the cloud projection — direct security consequence.
- **Fix sketch**: Add rust unit tests: a 60+ char whitespace-free base64-dense string under key `"note"` → redacted; a short/whitespaced string → kept; `project_event_payload(Some(garbage_ciphertext), Some(non_empty_iv))` → `None` (no ciphertext leaks). These are pure/near-pure and LLM-generatable; assert the *boundary* (redacted vs kept), not the exact density math.

## 8. Budget helpers (`budgetUtilization`, `budgetColor`) untested
- **Severity**: low
- **Category**: llm-generatable
- **File**: src/features/agents/sub_deployment/components/cloud/cloudDeploymentHelpers.ts:14-23
- **Current test state**: none
- **Scenario**: `budgetUtilization` clamps to 100 and returns null when budget/cost is falsy; `budgetColor` picks the red/amber/green band at the 80/50 thresholds. These drive the deployment budget-usage UI. Low blast radius (display-only), but the boundary conditions (exactly 80, exactly 50, cost > budget clamping, zero/undefined budget → null not Infinity) are easy to get subtly wrong and cheap to lock.
- **Root cause**: Small pure helpers shipped without tests.
- **Impact**: Mild — a mis-colored or mis-clamped budget bar; no data risk.
- **Fix sketch**: LLM-generatable batch. Invariants: `budgetUtilization` returns null when `maxMonthlyBudgetUsd` or `currentMonthCostUsd` is 0/undefined; clamps to 100 when cost exceeds budget; `budgetColor(80)`→red, `budgetColor(79)`→amber, `budgetColor(50)`→amber, `budgetColor(49)`→green. Assert thresholds, not arbitrary midpoints.
