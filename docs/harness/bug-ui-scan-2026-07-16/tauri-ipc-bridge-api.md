# Tauri IPC Bridge & API — bug-hunter + ui-perfectionist scan

> Total: 5 (Critical: 0, High: 1, Medium: 4, Low: 0)

## 1. Zapier automation UI calls unregistered IPC commands — feature is dead but renders as an innocent empty state
- **Severity**: High
- **Category**: bug
- **File**: src/lib/commandNames.overrides.ts:26-27 (with src/features/agents/sub_connectors/libs/useAutomationSetup.ts:159 and src/stores/slices/vault/automationSlice.ts:144)
- **Scenario**: User opens the automation setup flow, selects the `zapier` platform with a Zapier credential configured. The effect at useAutomationSetup.ts:155-163 calls `zapierListZaps` → `invoke("zapier_list_zaps", …)`. That command is on the `UnregisteredCommand` list (not in the Rust `invoke_handler`), so Tauri rejects every call with "command not found". The `.catch(() => setZapierZaps([]))` swallows it and turns off the spinner.
- **Root cause**: `CommandName = RegisteredCommand | UnregisteredCommand` (tauriInvoke.ts:11) deliberately lets forward-referenced commands compile, but nothing prevents *reachable UI paths* from shipping against them. `zapier_list_zaps`, `zapier_trigger_webhook`, and `zapier_create_zap` are all invoked from live code (`automationSlice.zapierTestWebhook`, `useAutomationSetup`) while sitting on the "planned or dead" list — the type system's safety valve became a silent-failure license.
- **Impact**: The entire Zapier integration is non-functional: the zap list always renders empty (indistinguishable from "your account has no zaps"), and "test webhook" always errors. No signal reaches the user or telemetry that the command doesn't exist — classic success theater at a trust boundary.
- **Fix sketch**: Either register the zapier commands in `lib.rs`'s invoke_handler, or gate the Zapier platform option out of the UI until they exist. Additionally, make `invokeWithTimeout` log/Sentry-tag any invocation whose name is in `UnregisteredCommand` so dead-command calls are loud, and distinguish "command not found" from "no zaps" in `useAutomationSetup` (error state, not empty state).

## 2. `idempotencyKey` cleanup chain creates a guaranteed unhandled promise rejection on every failed keyed call
- **Severity**: Medium
- **Category**: bug
- **File**: src/lib/tauriInvoke.ts:372
- **Scenario**: Any caller that passes `opts.idempotencyKey` (e.g. `executePersona`) invokes a command that rejects — backend error, validation failure, or an `InvokeTimeoutError`. The caller's own `.catch` handles the promise returned by `invokeWithTimeout`, but line 372's `promise.finally(() => inflightByKey.delete(key));` creates a *second* derived promise that re-throws the same rejection with no handler attached.
- **Root cause**: `.finally()` returns a new promise that propagates rejection. The auto-dedup path handles this correctly with the two-argument `promise.then(onOk, onErr)` (lines 378-395), and `_invokeCore` even appends `.catch(() => {})` to its own `invocation.finally(...)` chain (line 489) — but the idempotency-key branch missed the same treatment.
- **Impact**: Every failed keyed invocation fires a global `unhandledrejection` event: WebView console errors, duplicated Sentry noise (the error is reported once by the real handler and again as unhandled), and any app-level unhandled-rejection watchdog (crash dialog / error boundary toast) triggers for an error that was in fact handled.
- **Fix sketch**: Replace with the same pattern used elsewhere in the file: `promise.then(() => inflightByKey.delete(key), () => inflightByKey.delete(key));` or append `.catch(() => {})` to the `.finally()` chain.

## 3. `_inflight` counter leaks +1 for every pre-token call — false "IPC stampede" and permanently skewed concurrency diagnostics
- **Severity**: Medium
- **Category**: bug
- **File**: src/lib/tauriInvoke.ts:424, 436-440
- **Scenario**: On cold start (especially Windows WebView2, where the init-script race is expected — that's why `waitForIpcToken` exists), dozens of slice-init reads fire before `__IPC_TOKEN` is set. Each call enters `_invokeCore`, executes `_inflight++` (line 424), then hits the `!token && _retryDepth < 2` branch (line 436) and returns early via `waitForIpcToken().then(...)` — without ever reaching the `invocation.finally()` (line 485) that performs the matching decrement. The recursive retry call balances only its *own* increment.
- **Root cause**: The increment happens before the early-return token-wait guard, and the decrement lives on the invocation promise that this code path never creates. The design assumes every `_invokeCore` entry produces an `invoke()` whose settle decrements the counter.
- **Impact**: `_inflight` is permanently inflated by the number of pre-token entries (a busy startup can add 20-50+). The one-shot stampede detector (threshold 50, `_stampedWarned` never resets) can fire a spurious "IPC stampede" error on a healthy app — and because it is one-shot, the diagnostic is then burned for the session, so a *real* stampede later goes unreported. All subsequent inflight-based observability reads high forever.
- **Fix sketch**: Move `_inflight++` (and the stampede check) below the token-wait early return, or decrement before returning from the retry branch: `_inflight = Math.max(0, _inflight - 1); return waitForIpcToken().then(...)`.

## 4. Read auto-dedup's 250 ms post-settle TTL serves stale data to refetch-after-write, with no invalidation on mutations
- **Severity**: Medium
- **Category**: bug
- **File**: src/lib/tauriInvoke.ts:154, 375-396
- **Scenario**: A component mounts and its `list_*` read settles at t=0. At t=100 ms the user's action completes a fast mutation (`create_*`/`update_*` — SQLite writes are single-digit ms) and the store does the canonical `await create(); await refetch()`. The refetch lands inside the 250 ms TTL with identical args, so `invokeWithTimeout` returns a `structuredClone` of the *pre-mutation* response instead of hitting Rust.
- **Root cause**: The dedup cache keys only on `${cmd}:${stableStringify(args)}` and holds *resolved* entries for `AUTO_DEDUP_TTL_MS` after settle to absorb StrictMode/mount races. But mutations never invalidate the map, so the TTL window converts "fold concurrent duplicate reads" (safe) into "serve a recently-cached read after the world changed" (unsafe). The 250 ms window is short but sits exactly where write-then-refetch patterns live.
- **Impact**: Freshly created/updated/deleted entities intermittently fail to appear in the UI after a successful mutation — a timing-dependent ghost bug that reproduces on fast machines and vanishes under devtools. Stores that trust the refetch as source of truth persist the stale list until the next poll or navigation.
- **Fix sketch**: Delete matching `inflightAutoDedup` entries when any non-read-only command resolves (cheap: clear the whole map — it holds at most a few entries), or keep the TTL only for *in-flight sharing* and evict immediately on settle (`AUTO_DEDUP_TTL_MS = 0`) unless a call is provably part of a mount race.

## 5. Remote-command Approve pins a spinner modal for up to 30 minutes with no progress, no execution link, and an escape hatch that loses the run
- **Severity**: Medium
- **Category**: ui
- **File**: src/features/cloud/RemoteApprovalPrompt.tsx:146-155 (with src/stores/remoteCommandStore.ts:42-51, src/lib/tauriInvoke.ts:77)
- **Scenario**: User clicks Approve on a dashboard run-request. `remote_command_approve` executes the persona *locally to completion* and is on `BLOCKING_MUTATION_TIMEOUTS` (30-minute ceiling, by design — retrying would double-run). For the entire run the root-mounted `BaseModal` stays open showing a spinning "Approving…" button with Later/Reject disabled; there is no progress indication, no elapsed time, and the returned execution id is discarded by the store (`await approveRemoteCommand(id)` ignores the result). If the user escapes the modal (ESC/backdrop → `onClose` → `dismiss` is NOT gated by `busy`), the item leaves the queue while the run continues invisibly — the user gets no way to find or observe it; a multi-minute run looks like a hang either way.
- **Root cause**: The UI treats a deliberately long-blocking IPC call as a short request/response: `busyId` was designed to debounce buttons, not to represent a minutes-long local execution with an observable artifact (the execution id).
- **Impact**: For any persona that runs longer than a few seconds, approving a remote command freezes the primary interaction surface behind a modal; users will assume a hang, force-quit, or dismiss — after which the still-running execution has no UI representation at all.
- **Fix sketch**: On approve, optimistically close the modal (or swap to a compact "running" toast/queue chip), keep the promise in the store, and when it resolves surface the execution id as a link into the executions view; disable `onClose` dismissal while `busy` or make dismissal explicitly hand off to the background-running indicator.
