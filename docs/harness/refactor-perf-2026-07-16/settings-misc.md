# settings (misc) — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 5 findings (0 critical / 0 high / 3 medium / 2 low)
> Context group: App Shell, Settings & Sharing | Files read: 24 | Missing: 0

## 1. Copy-with-timed-feedback re-implemented 3× despite the canonical `useCopyToClipboard` hook
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/settings/sub_api_keys/components/CreatedKeyDialog.tsx:68
- **Scenario**: `CreatedKeyDialog` (`copyKey` line 68, `copyConfig` line 76) and `McpServerInfoPanel` (`copyUrl` line 46) each hand-roll `copyText` + `setXCopied(true)` + bare `setTimeout(..., 2000)`. The hook file (`src/hooks/utility/interaction/useCopyToClipboard.ts`) explicitly documents "React components prefer `useCopyToClipboard()` (timed feedback)".
- **Root cause**: The components import only the low-level `copyText` export from the hook module and rebuild the feedback state machine locally instead of using the hook one file over.
- **Impact**: Three drifting copies of the same logic; unlike the hook, none of the inline timers is cleared on unmount, so a copy followed by closing the dialog fires `setState` on an unmounted component. Also duplicates the try/silentCatch that `copyText` already performs internally (it never throws — the local try/catch blocks are dead).
- **Fix sketch**: Replace each `const [xCopied, setXCopied] = useState(false)` + inline timeout with `const { copied, copy } = useCopyToClipboard()` (one instance per copy target). Delete the now-dead try/catch wrappers since `copyText` resolves `false` instead of throwing.

## 2. 3-second "click again to confirm" arm pattern duplicated three times, two copies leak the timer
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/settings/sub_api_keys/components/ApiKeysSettings.tsx:398
- **Scenario**: `ApiKeyRow` (delete, line 398), `PairedAppRow` (disconnect, line 491), and `AdminSettings` (consent reset, AdminSettings.tsx:55) all implement the identical confirm-arm-with-3s-auto-revert flow. AdminSettings does the careful ref-tracked version with unmount cleanup; the two rows in ApiKeysSettings use a bare `setTimeout(() => setConfirm(false), 3000)` that is never cleared.
- **Root cause**: The pattern was written inline per call site instead of being extracted after the second occurrence.
- **Impact**: Maintenance drift (one of three copies is correct, two are not); in the rows, confirming a delete unmounts the row while the revert timer is pending → setState on an unmounted component, and rapid re-clicks stack multiple timers.
- **Fix sketch**: Extract a `useConfirmClick(onConfirm, { revertMs = 3000 })` hook returning `{ armed, trigger }` that owns the timer in a ref and clears it on unmount/re-arm (AdminSettings' logic, generalized). Swap all three sites onto it; ApiKeysSettings loses ~40 lines and gains the cleanup for free.

## 3. `MCP_BASE_URL` literal defined independently in three modules
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/settings/sub_api_keys/components/McpServerInfoPanel.tsx:18
- **Scenario**: `'http://127.0.0.1:9420'` is declared as a private `MCP_BASE_URL` const in both McpServerInfoPanel.tsx:18 and CreatedKeyDialog.tsx:36, and appears again in `src/api/system/managementApiAuth.ts`. If the management-API port ever changes (it is configured in Rust, engine/webhook.rs), the copy-pasteable MCP config and the info panel can silently disagree.
- **Root cause**: Each component inlined the base URL when it needed to render/copy it.
- **Impact**: Bounded — three sites today — but this is user-facing copy-paste material (MCP config snippet), so drift produces configs pointing at the wrong port.
- **Fix sketch**: Export a single `MANAGEMENT_API_BASE_URL` from `src/api/system/managementApiAuth.ts` (it is the API-layer owner) and import it in both components. While in ApiKeysSettings.tsx, also hoist the imports at lines 67–70 (McpServerInfoPanel/CreateApiKeyDialog/CreatedKeyDialog/ApiKeyAuditDrawer) above the helper functions — imports currently sit mid-file after code.

## 4. `useAppSetting`'s per-render object identity defeats every memo built on it (Limits + Notifications)
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/settings/sub_limits/components/LimitsSettings.tsx:275
- **Scenario**: `LimitsSettings` wraps its entire `sections` array in `useMemo` with `concurrency` and `ceiling` (the objects returned by `useAppSetting`) in the dependency list. Per the codebase's own note (NotificationSettings.tsx:97 — "useAppSetting returns a fresh object every render"), those deps change identity on every render, so the memo recomputes unconditionally — three full JSX subtrees rebuilt per keystroke in the NumberStepper. `saveConcurrency` (line 121) is likewise re-created every render, and `NotificationSettings.toggle` (line 127) has the same defeated `useCallback([setting])`.
- **Root cause**: `useAppSetting` returns a new object literal each render; consumers were forced into scalar-deps workarounds (the eslint-disable comments in NotificationSettings) but LimitsSettings put the whole object into deps anyway.
- **Impact**: Zero-benefit memoization on a form that re-renders per keystroke, plus a standing footgun — this exact identity hazard already caused a documented infinite set_app_setting write loop once. Every future consumer must rediscover the workaround.
- **Fix sketch**: Fix at the source: have `useAppSetting` memoize its return (`useMemo` over `value/loaded/saved/error` with stable `setValue`/`save` callbacks). Then delete the two eslint-disable scalar-deps workarounds in NotificationSettings and let LimitsSettings' existing deps actually work. Verify no consumer relies on fresh identity (grep `useAppSetting(` call sites).

## 5. Settings polling keeps running while a tab is hidden-but-mounted
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: polling
- **File**: src/features/settings/shared/RecentChangeChip.tsx:42
- **Scenario**: SettingsPage deliberately keeps inactive tabs mounted for up to 30s (IDLE_UNMOUNT_MS). During that window every mounted `RecentChangeChip` (api-keys, limits, notifications headers) keeps its 30s audit-log poll alive, and `AmbientContextPanel` (inside EngineSettings) keeps its 5s snapshot+stream-stats interval firing — IPC round-trips + SQLite queries for UI nobody can see. With quick tab-hopping, 3–4 tabs poll concurrently.
- **Root cause**: The intervals are gated only on mount, not on tab visibility; the SettingsPage keep-mounted optimization multiplies them.
- **Impact**: Bounded by the 30s idle unmount, so waste is modest — but the 5s ambient poll is the hot one (two backend calls per tick while the user is on a different tab).
- **Fix sketch**: Pass an `isActive` flag down from SettingsPage (it already knows `tab === settingsTab`) via context, or gate the intervals on it — pause `setInterval` scheduling when inactive and do one refresh on reactivation. The chip alternatively could refresh on the audit-write event instead of polling.
