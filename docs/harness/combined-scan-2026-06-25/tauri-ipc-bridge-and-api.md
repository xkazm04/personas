# Tauri IPC Bridge & API — Combined Scan (ambiguity-guardian + bug-hunter)
> Context: tauri-ipc-bridge-and-api | Group: Platform Foundation
> Total: 5 | Critical: 0 | High: 2 | Medium: 2 | Low: 1

## 1. TwinChannelKind enum drift: TS union is a superset Rust rejects at runtime
- **Severity**: High
- **Lens**: ambiguity-guardian
- **Category**: enum-drift / TS↔Rust contract
- **File**: src/api/enums.ts:40 (vs src-tauri/src/commands/infrastructure/twin.rs:508)
- **Scenario**: A UI built off `TWIN_CHANNEL_KINDS` offers the user `whatsapp` / `telegram` / `signal` / `teams` / `training` / `other` as valid channels. The user picks one; `twin_record_interaction` is invoked and the Rust handler rejects it with `AppError::Validation("Invalid channel 'whatsapp' (expected one of: discord, slack, email, sms, voice, generic)")`. Conversely, `generic` — which Rust *accepts* — is absent from the TS union, so it cannot be passed without a type error.
- **Root cause**: `enums.ts` declares 11 channels (`email|sms|slack|discord|telegram|signal|teams|whatsapp|voice|training|other`) and its own doc promises "Each union must stay in sync with its Rust-side counterpart … Rust handlers additionally validate." The Rust validator at `twin.rs:508` only allows `["discord","slack","email","sms","voice","generic"]`. 6 TS-valid values are runtime-rejected; 1 Rust-valid value (`generic`) is missing from TS. The compile-time set and the runtime set disagree, so passing the type checker no longer implies the call succeeds — defeating the stated purpose of the file.
- **Impact**: Guaranteed runtime failure for 6 of 11 documented-valid channels. Any twin-communication feature that surfaces the full enum silently mis-advertises capabilities; users hit opaque validation errors. `twin_list_communications`/`twin_create_channel` add no validation at all, so the "Rust validates" claim is only half-true.
- **Fix sketch**: Pick one source of truth. Either (a) trim the TS union to the 6 Rust-accepted values and add `generic`, or (b) extend `VALID_CHANNELS` in `twin.rs` to the full set. Ideally generate the union from a single Rust enum via ts-rs so drift can't recur. Add a sync test (one already exists for other enums) covering `TWIN_CHANNEL_KINDS`.
- **Value**: impact=6 effort=2

## 2. Orphaned mutation on timeout — no invoke cancellation; post-timeout retry double-executes
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: race / at-least-once IPC semantics
- **File**: src/lib/tauriInvoke.ts:401 (timeout reject) + 393 (uncancelled invocation)
- **Scenario**: `system_ops_run_now` is a *blocking* `pub fn` that runs the op inline (`ops::run_op`, e.g. a `context_scan` over a large repo). With the default 90s timeout, a long scan makes `invokeWithTimeout` reject with `InvokeTimeoutError` — but the underlying Tauri `invoke()` (line 393) keeps running, completes the scan, and even calls `repo::mark_run(..., "ok", ...)`. The user sees a timeout error and clicks "Run now" again → two scans execute. Same hazard for `remote_command_approve` (default 90s, "runs the persona locally") and any mutating command slower than its timeout.
- **Root cause**: The timeout is a `Promise.race` (correct: it rejects, it does *not* return a wrong default — that part is sound). But there is no cancellation token threaded to the backend, so the mutation orphans. The wrapper's `idempotencyKey`/auto-dedup only collapse *concurrent in-flight* calls; `inflightByKey` is deleted on settle (line 309), so a retry issued *after* the timeout is a brand-new backend call with no dedup.
- **Impact**: Double-applied mutations (duplicate scans, double persona runs/approvals, duplicate side effects) on any mutating command that can exceed its timeout. Silent because the first call's success is invisible to the frontend.
- **Fix sketch**: For mutating commands, either pass a backend idempotency token the Rust side honors across retries (dedupe on `(command, key)` server-side), or make long mutations fire-and-poll (return an id immediately, poll status) so the IPC call itself is short. At minimum, document that a timeout does NOT cancel the backend and that retrying mutating commands is unsafe without an idempotency key.
- **Value**: impact=7 effort=4

## 3. `_inflight` counter leaks on the token-wait early-return path → false IPC-stampede alarm
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: latent counter leak / false telemetry
- **File**: src/lib/tauriInvoke.ts:361 (increment) + 373 (early return) + 414 (decrement)
- **Scenario**: On cold start `__IPC_TOKEN` is briefly undefined. Every `_invokeCore` entry runs `_inflight++` (line 361). When `!token && _retryDepth < 2`, the function returns at line 374 (`waitForIpcToken().then(() => _invokeCore(... _retryDepth+1))`) *before* the `invocation` promise (and its `finally` decrement at line 414) is ever created. The recursive retry increments again. So each call that waits for the token increments twice but decrements only once — a permanent +1 leak per cold-start call.
- **Root cause**: The decrement lives only in `invocation.finally(...)`, which is unreachable on the token-wait branch. The increment is unconditional at the top of the function.
- **Impact**: `_inflight` never returns to its true baseline; it ratchets up by the number of calls made before the token lands. If ≥50 such calls occur (`IPC_STAMPEDE_THRESHOLD`), `_stampedWarned` fires a spurious `logger.error("IPC stampede …")` once and the inflated baseline makes a later real stampede detection unreliable. Not a crash, but corrupts a diagnostic signal.
- **Fix sketch**: Move `_inflight++` to just before `invoke()` (after the token-wait branch), or guard the increment/decrement so the early-return path doesn't count. Simplest: only `_inflight++` when `_retryDepth` reaches the branch that actually calls `invoke()`.
- **Value**: impact=4 effort=2

## 4. `recordIpcCall` double-counts on the auth-failure retry path
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: observability skew
- **File**: src/lib/tauriInvoke.ts:424 (records failure) + 431-438 (retry re-enters _invokeCore)
- **Scenario**: A privileged call fails with "IPC authentication failed". The rejection handler at line 424 records `recordIpcCall({ ok:false, ... })`, then (line 431-438) recurses into `_invokeCore` with `_retryDepth+1`, which on success records a second `recordIpcCall({ ok:true })`. One logical user action thus emits two metric rows — one false failure plus the success. (The Sentry breadcrumb is correctly gated on `_retryDepth === 0` at line 389, but the metrics call is not similarly gated.)
- **Root cause**: Metrics are recorded per `_invokeCore` attempt, while the auth-retry is an internal, caller-invisible attempt.
- **Impact**: IPC metrics ring buffer over-reports call volume and error rate during WebView2 cold-start auth races, skewing any dashboard/alert built on `ipcMetrics`. Cosmetic but misleading.
- **Fix sketch**: Record the metric once per logical call (e.g. gate `recordIpcCall` on `_retryDepth === 0`, or move recording into `invokeWithTimeout` around the whole `_invokeCore` result), or tag retried attempts so they can be excluded from rates.
- **Value**: impact=2 effort=1

## 5. 2s token-wait cap resolves token-less — magic constant + silent cold-start auth failure window
- **Severity**: Medium
- **Lens**: ambiguity-guardian
- **Category**: magic constant / undocumented timing contract
- **File**: src/lib/tauriInvoke.ts:55-64 (cap `++tries > 100`, ~2s) + 373 (re-check)
- **Scenario**: On a slow cold start the Rust init script sets `__IPC_TOKEN` after ~2s. `waitForIpcToken` resolves once `++tries > 100` (100 × 20ms ≈ 2s) **even though the token never arrived**, and caches that resolved promise in `_tokenReady`. `_invokeCore` re-reads the live global (line 371); if still unset at `_retryDepth === 2` it proceeds and invokes WITHOUT the `x-ipc-token` header → backend rejects with auth failure → the auth-retry path (line 431) re-reads `__IPC_TOKEN`, finds it still undefined, so `refreshedToken` is falsy and it does NOT retry → the error bubbles to the user.
- **Root cause**: The 2s cap (and the 20ms poll, the `>100` count, the 90s default timeout, the 50ms retry delay) are undocumented magic numbers chosen to avoid an OOM retry loop (per the comment), but the trade-off — "give up waiting and fire token-less" — is not surfaced as a contract. There is no recovery for calls that fall in the 2s→token-arrival window; the system only self-heals for calls issued after the token finally lands.
- **Impact**: On slow machines / large init, the first user-initiated privileged calls can fail with an opaque auth error and no automatic recovery. The binding assumption "the token is always ready within 2s" is tribal knowledge encoded only in a loop bound.
- **Fix sketch**: Either retry the auth-failure path with a short re-wait on the token (instead of giving up when the global is still unset), or extend/parameterize the cap with a documented rationale, and emit a one-time warning when the cap fires token-less so the failure mode is observable. Name the constants (`TOKEN_WAIT_MAX_MS`, `TOKEN_POLL_MS`).
- **Value**: impact=4 effort=3
