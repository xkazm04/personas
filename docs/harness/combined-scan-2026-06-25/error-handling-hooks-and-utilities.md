# Error Handling, Hooks & Utilities — Combined Scan (ambiguity-guardian + bug-hunter)
> Context: error-handling-hooks-and-utilities | Group: Platform Foundation
> Total: 5 | Critical: 0 | High: 0 | Medium: 4 | Low: 1

## 1. OAuth-timeout rule is dead code — shadowed by the generic `timed out` rule AND never matches the real backend string
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: error-classification / unreachable-rule
- **File**: src/lib/errors/errorRegistry.ts:88 (shadowed by :54); mirrored in src/i18n/useTranslatedError.ts:65 (shadowed by :61)
- **Scenario**: An OAuth connect flow times out. The backend emits `"OAuth callback timed out"` (src-tauri/src/commands/credentials/oauth.rs:1291). `resolveError()` / `resolveErrorTranslated()` walk the rules top-to-bottom and return the FIRST substring hit. `'timed out'` (line 54) matches first, so the OAuth-specific rule at line 88 can never fire.
- **Root cause**: Two compounding defects. (a) Ordering: the generic `'timed out'` rule precedes the specific `'OAuth authorization timed out'` rule, so any string containing "timed out" short-circuits it — the specific rule is unreachable by construction. (b) String mismatch: the specific rule's literal `'OAuth authorization timed out'` doesn't even match the actual emitted text `'OAuth callback timed out'`, so it would be dead even if reordered. Both the legacy registry and the "preferred" translated map carry the identical defect (manual sync propagated the bug to both).
- **Impact**: Every OAuth timeout is classified as `recoverable` with copy "The request took too long… Try again" instead of `user_action` "The authorization window was open too long — complete the sign-in promptly." Wrong category drives wrong UI affordance: the recovered/auto-retry treatment invites a futile retry when the OAuth window has actually closed and the user must restart the connection.
- **Fix sketch**: Move the OAuth rule above the generic `'timed out'` rule (in both files) and change its matcher to a regex that matches the live string, e.g. `/OAuth (?:authorization|callback) timed out/`. Add a unit test asserting `resolveError('OAuth callback timed out').category === 'user_action'`.
- **Value**: impact=5 effort=1

## 2. `_inflight` counter leaks on the token-wait early-return, permanently disabling IPC stampede detection
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: accounting-bug / observability
- **File**: src/lib/tauriInvoke.ts:373 (increment at :361, decrement only at :414)
- **Scenario**: On cold start `window.__IPC_TOKEN` is not yet set by the Rust init script, so bootstrap reads (`get_app_settings`, `list_personas`, …) hit the `!token && _retryDepth < 2` branch.
- **Root cause**: `_invokeCore` does `_inflight++` unconditionally at the top (line 361), then `return waitForIpcToken().then(() => _invokeCore(... _retryDepth+1))` at lines 373-377 — returning BEFORE `invocation` is created. The only decrement lives in `invocation.finally` (line 414), which this path never reaches. Each token-wait early-return leaks +1 (up to +2 across the two retry depths). The recursive call increments/decrements normally, so the leaked count is never reclaimed.
- **Impact**: `_inflight` drifts upward by several counts every launch. Because the stampede warning is gated by a one-shot latch (`_stampedWarned`, line 350-351), the inflated baseline trips a false "IPC stampede" error log early in the session, and the latch then suppresses the warning forever — so a genuine later stampede goes unreported. No functional/user impact (the counter gates nothing), but it silently defeats the safety signal.
- **Fix sketch**: Decrement before the early return — e.g. wrap the body so `_inflight--` runs on every exit path, or move `_inflight++`/`--` to bracket only the real `invoke()` call (after the token gate). Add a test that fires N calls with no token present and asserts `_inflight` returns to 0 once they settle.
- **Value**: impact=4 effort=2

## 3. `toastCatch` shows the raw technical error and a hard-coded "Failed to load data" prefix, bypassing the friendly-error registry
- **Severity**: Medium
- **Lens**: bug-hunter / ambiguity-guardian
- **Category**: error-UX / humanization-gap
- **File**: src/lib/silentCatch.ts:108-112
- **Scenario**: A store/promise chain calls `.catch(toastCatch("X:saveThing"))` (no `customMessage`). A backend op fails with a raw string like `"agent_ir parse error"`, `"Failed to build HTTP client: certificate verify failed"`, or a Rust panic message. The user sees a toast reading `Failed to load data. agent_ir parse error`.
- **Root cause**: `toastCatch` builds the toast text directly from `extractMessage(err)` and never routes it through `resolveError()` — the very layer built to convert raw technical strings into friendly message + recovery suggestion (its own docstring says it produces "user-facing message + suggestion (toasts)"). Two consequences: (a) raw internal strings leak verbatim into the UI app-wide; (b) the default prefix is always "Failed to load data." even though the docstring endorses `toastCatch` for actions (saves, deletes), so a failed delete is mislabeled as a failed load.
- **Impact**: App-wide degraded error UX and a mild internal-detail leak (backend symbol names, file paths, panic text) on every `toastCatch` call site that omits `customMessage`. Users get jargon instead of actionable guidance, and action failures are described as load failures.
- **Fix sketch**: In `toastCatch`, compute `const friendly = resolveError(msg)` and show `customMessage ?? \`${friendly.message} ${friendly.suggestion}\``. Replace the fixed "Failed to load data." default, or split into `toastCatchLoad` / `toastCatchAction`. Keep the raw `msg` only in the log/breadcrumb (already done).
- **Value**: impact=5 effort=3

## 4. 90s default IPC timeout is an undocumented magic constant with no abort — long ops that forget to override fail spuriously and duplicate backend work on retry
- **Severity**: Medium
- **Lens**: ambiguity-guardian
- **Category**: magic-constant / timeout-contract
- **File**: src/lib/tauriInvoke.ts:37 (`DEFAULT_TIMEOUT_MS = 90_000`; applied at :259/:265)
- **Scenario**: A new API wrapper invokes a slow backend command (AI generation, OCR, a build/deliberation step) without passing `timeoutMs`. The op legitimately runs >90s. `Promise.race` rejects with `InvokeTimeoutError`, but the Rust side is NOT cancelled and keeps running to completion. If the caller retries (common on timeout), a SECOND backend run starts.
- **Root cause**: The correct timeout is per-command tribal knowledge — long commands must each remember to override (kpis.ts uses 360_000/900_000; teamDeliberations.ts 120-300k; adoption 660k), and there is no central per-command timeout registry or lint enforcing it. The 90s value is justified only by a code comment, and the race-without-abort contract means a "timeout" is a client-side give-up, not a cancellation. The gap is silent: forgetting the override compiles and works until an input is large/slow.
- **Impact**: Spurious user-facing failures on slow-but-healthy operations, plus duplicate non-idempotent backend work on retry (auto-dedup/idempotency don't help: the timed-out promise rejects and the auto-dedup entry is evicted immediately on rejection, so a retry is a fresh round-trip). Wasted tokens/compute and possible double writes.
- **Fix sketch**: Introduce a per-command default-timeout map (or a `slow: true` flag) so long commands inherit a correct ceiling without each caller remembering. Document the "timeout = client give-up, backend keeps running" contract on `invokeWithTimeout`, and where possible thread a Tauri cancellation/abort token so a timeout actually stops the work.
- **Value**: impact=6 effort=3

## 5. `useDebouncedSave` passes the caller's `deps` array as a single effect dependency — an inline array re-arms the timer every render and can starve the auto-save
- **Severity**: Medium
- **Lens**: bug-hunter / ambiguity-guardian
- **Category**: hook-contract / silent-data-loss
- **File**: src/hooks/utility/timing/useDebouncedSave.ts:68 (`}, [isDirty, cancel, delay, deps]);`)
- **Scenario**: A component uses `useDebouncedSave(save, dirty, [name, value], 800)` (a fresh array literal each render — the documented usage). Some unrelated source re-renders the component faster than 800ms (an elapsed-timer tick, an animated number, a parent passing changing props). On every render React sees a new `deps` reference, re-runs the effect, which clears and re-arms the 800ms timer (lines 46-47). The timer never reaches its delay, so `save` never fires.
- **Root cause**: The effect depends on `deps` as one element compared by reference (`Object.is`). A new array literal each render is always "changed," so frequent unrelated re-renders perpetually reset the debounce instead of letting it elapse. The doc says deps have "same semantics as useEffect deps," but they don't — useEffect would spread them as individual, value-compared elements.
- **Impact**: Silent loss of auto-saved edits in long-lived editors that don't unmount (the unmount-flush at lines 77-87 only rescues the unmount case). The user keeps typing, the "Saving…" never resolves, and changes are dropped — exactly the failure auto-save exists to prevent.
- **Fix sketch**: Spread the caller deps into the dependency array (`[isDirty, cancel, delay, ...deps]`) so elements are value-compared, or hash them (`JSON.stringify(deps)`) into a single stable string dep. At minimum, document that callers MUST pass a memoized/stable `deps` reference and warn in dev when length changes.
- **Value**: impact=6 effort=3
