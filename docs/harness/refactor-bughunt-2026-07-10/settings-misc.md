> Context: settings (misc)
> Total: 8
> Critical: 0  High: 0  Medium: 3  Low: 5

## 1. Cloud-sync "poll until it settles" stops after a single tick
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: race-condition
- **File**: src/features/settings/sub_account/components/CloudSyncCard.tsx:58-66
- **Scenario**: A sync pass that takes longer than 1.5s keeps `status.syncing === true` and (until it finishes) a constant `status.lastSyncAt`. The polling effect's dependency array is `[status?.syncing, status?.lastSyncAt, refresh]`. It arms ONE `setTimeout(refresh, 1500)`. `refresh()` calls `setStatus(...)` with a *new object* whose primitive `syncing`/`lastSyncAt` values are unchanged, so React sees identical deps and never re-runs the effect → the timeout never re-arms. Result: the live UI refreshes exactly once, then freezes mid-sync until some other state change nudges it.
- **Root cause**: A one-shot `setTimeout` was used to express "keep polling", but the re-arm is gated on dep changes that don't occur while a pass is in flight.
- **Impact**: UX — sync progress/spinner appears to hang for long passes; row counts and per-table breakdown stop updating until settle. No data loss.
- **Fix sketch**: Use a recurring `setInterval` while `status?.syncing` (clear on settle), or add a monotonically-changing tick (e.g. a counter incremented in `refresh`) to the dep array so the effect re-arms after each poll.

## 2. Sensory-policy writes are fire-and-forget; optimistic UI silently diverges on backend failure
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: silent-failure
- **File**: src/features/settings/components/AmbientContextPanel.tsx:86-118
- **Scenario**: `handlePolicyChange`, `handleAddFilter`, and `handleRemoveFilter` call `setLocalPolicy(updated)` and then `updateSensoryPolicy(selectedPersonaId, updated)` with no `await` and no `.catch`. If the Tauri command rejects (invalid persona, DB locked, backend error), the local UI shows the toggled/added state while the backend never persisted it. On next `fetchSensoryPolicy` the change silently reverts, and any rejection is an unhandled promise.
- **Root cause**: Optimistic local state with no reconciliation or error surface for the async persistence call.
- **Impact**: UX / data-trust — user believes a sensory-policy change stuck when it didn't; no toast on failure.
- **Fix sketch**: `await` the update inside the handler (or `.catch(toastCatch(...))`), and roll `localPolicy` back to the prior value on failure, mirroring the pattern already used in `CloudSyncCard.onToggle`.

## 3. `handleAddRule` awaits with no catch — a failed create leaves the form stuck and unhandled
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: silent-failure
- **File**: src/features/settings/components/AmbientContextPanel.tsx:126-151
- **Scenario**: `await addContextRule(rule)` is followed by the form-reset calls. If `addContextRule` rejects, execution stops before the resets, the "Create rule" form stays populated with no error shown, and the rejection is unhandled (no `try/catch`).
- **Root cause**: No error branch around the persistence await.
- **Impact**: UX — silent failure creating a context rule; user re-clicks, potentially double-submitting once the backend recovers.
- **Fix sketch**: Wrap in `try/catch` with `toastCatch('AmbientContextPanel:addRule')`, and only reset the form inside the success path.

## 4. Confirm-then-act `setTimeout` has no cleanup → setState after unmount
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: edge-case
- **File**: src/features/settings/sub_api_keys/components/ApiKeysSettings.tsx:397-406, 490-498
- **Scenario**: The delete (`ApiKeyRow`) and disconnect (`PairedAppRow`) buttons do `setConfirmDelete(true); setTimeout(() => setConfirmDelete(false), 3000)`. The timeout is never stored or cleared. If the row unmounts within 3s (e.g. the list reloads after a sibling revoke/delete, or the audit drawer replaces the view), the timer fires `setState` on an unmounted component. Same pattern, no cleanup.
- **Root cause**: Fire-and-forget timer instead of a ref-tracked, unmount-cleared timer (contrast `AdminSettings.tsx:17-20`, which does it correctly).
- **Impact**: Maintainability / dev-noise (React warning), harmless in prod but indicative of a leak.
- **Fix sketch**: Store the handle in a `useRef` and clear on unmount, or extract a shared `useConfirmClick` hook (see finding #6) that owns the timer lifecycle.

## 5. Monthly spend keyed by local-time months vs server-bucketed dates
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: edge-case
- **File**: src/features/settings/sub_limits/components/LimitsSettings.tsx:56-73
- **Scenario**: `chart_points` are bucketed server-side (`pt.date`, sliced to `YYYY-MM`). The 5 display buckets are generated from `new Date(now.getFullYear(), now.getMonth() - i, 1)` in the client's *local* timezone. Near a month boundary a user well behind/ahead of the server's clock can land the "current month" label on a different month than the server's date buckets, so the head row's spend (used for `isOverBudget`/`isApproaching`) can under- or over-count for a few hours around the 1st.
- **Root cause**: Mixed clock domains — server date strings vs `new Date()` local month arithmetic.
- **Impact**: UX — brief mislabeled/misattributed spend at month rollover; can flip the over-budget banner. Narrow window.
- **Fix sketch**: Derive the current-month key from the server data domain (e.g. the max `pt.date.slice(0,7)`), or explicitly compute month keys in UTC to match the server bucketing.

## 6. Triplicated "confirm-on-second-click" button pattern
- **Lens**: code-refactor
- **Severity**: medium
- **Category**: duplication
- **File**: src/features/settings/sub_api_keys/components/ApiKeysSettings.tsx:396-426, 489-519; src/features/settings/sub_admin/components/AdminSettings.tsx:54-90
- **Scenario**: Three copies of the same two-click-confirm dance (first click arms + 3s auto-revert, second click commits): API-key delete, paired-app disconnect, and consent-reset. `AdminSettings` implements it correctly with a cleared ref-timer; the two `ApiKeysSettings` copies omit cleanup (finding #4). Verified by reading all three; the state shape (`confirmX` boolean + timer) and render branches are identical.
- **Root cause**: Pattern was copy-pasted rather than extracted, so the leak fix in `AdminSettings` never propagated.
- **Impact**: Maintainability — three divergent copies, one class of unmount bug baked into two of them.
- **Fix sketch**: Extract a `useConfirmClick(onConfirm, { timeoutMs })` hook returning `{ armed, trigger }` that owns a ref-tracked, unmount-cleared timer; replace all three sites.

## 7. `MCP_BASE_URL` constant duplicated across two API-key components
- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication
- **File**: src/features/settings/sub_api_keys/components/CreatedKeyDialog.tsx:36; src/features/settings/sub_api_keys/components/McpServerInfoPanel.tsx:18
- **Scenario**: `const MCP_BASE_URL = 'http://127.0.0.1:9420'` is declared identically in both files (grep confirms these are the only two definitions). The port also appears in the doc comments. If the management-API port ever changes, both must be edited in lockstep.
- **Root cause**: No shared source of truth for the local MCP server base URL within the `sub_api_keys` module.
- **Impact**: Maintainability — drift risk on a security-relevant endpoint constant.
- **Fix sketch**: Hoist to a shared module constant (e.g. `sub_api_keys/libs/mcpServer.ts`) and import in both.

## 8. `RecentChangeChip` constant `NO_REFRESH_INTERVAL` is misnamed — it IS the refresh interval
- **Lens**: code-refactor
- **Severity**: low
- **Category**: dead-code
- **File**: src/features/settings/shared/RecentChangeChip.tsx:9,42-44
- **Scenario**: `const NO_REFRESH_INTERVAL = 30_000;` is used as the `setInterval` period that DOES refresh the chip every 30s (the comment even says "self-refresh… within 30s"). The name reads as "no refresh" and directly contradicts behavior.
- **Root cause**: Leftover/typo'd identifier (likely meant `AUTO_REFRESH_INTERVAL_MS`).
- **Impact**: Maintainability — a future reader may "fix" the poll thinking it's disabled.
- **Fix sketch**: Rename to `AUTO_REFRESH_INTERVAL_MS`.
