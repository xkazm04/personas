# Bug Hunter — Error Handling, Hooks & Utilities

> Total: 5 findings (1 critical, 2 high, 1 medium, 1 low)
> Context: error-handling-hooks-utilities | Group: Platform Foundation

## 1. Auto-dedup returns a SHARED object/array reference to every concurrent caller — mutation by one corrupts the others
- **Severity**: Critical
- **Category**: 🕳️ Edge case / shared mutable state
- **File**: `src/lib/tauriInvoke.ts:279-318` (auto-dedup) and `:97` (`AUTO_DEDUP_TTL_MS = 250`)
- **Scenario**: Two components mount in the same tick and both call `listMemories(...)` / `getPersona(...)` with identical args. Auto-dedup folds them into one Rust round-trip and hands BOTH callers the *same resolved Promise*, i.e. the *same array/object instance*. The TTL even keeps that instance live for 250ms after settle, so a third caller landing slightly later also gets it. If any caller mutates the result in place — `.sort()`, `.push()`, assigning `obj.foo = ...`, or feeding it into a store reducer that mutates — every other caller (and any zustand slice that stored it) silently sees the mutation. Reads are assumed independent, so this is invisible until data is wrong.
- **Root cause**: Dedup deduplicates the *Promise*, but a Promise resolves to a reference, not a copy. There is no structural clone / freeze of the shared payload, and `list_/get_/fetch_` results are exactly the objects most likely to be sorted or normalized by callers.
- **Impact**: Cross-component state corruption that multiplies across the whole app — any two simultaneous reads of the same data can poison each other. Classic Heisenbug: only reproduces under concurrent mount (StrictMode double-mount, parallel panels), so it ships looking fine.
- **Fix sketch**: Either (a) freeze dev-mode results (`Object.freeze` deep) to surface accidental mutation, or (b) restrict auto-dedup to truly read-only consumers and document the shared-reference contract loudly, or (c) hand each extra caller a structured clone of the settled value. Cheapest safe option: clone on the dedup-hit path (`existing.then(v => structuredClone(v))`).

## 2. `silentCatch`/`extractMessage` drops the original Error cause and stack — every swallowed/logged failure loses its post-mortem trail
- **Severity**: High
- **Category**: 🔮 Latent failure / success theater in the foundation
- **File**: `src/lib/silentCatch.ts:19-58` (`extractMessage` returns `err.message` only; `silentCatch` logs only `{ error: msg }`)
- **Scenario**: A nested operation throws `new Error("boom", { cause: rootCause })` or any Error with a meaningful `.stack`. It propagates into `silentCatch("ctx")` (used app-wide) or `toastCatch`. Only `err.message` is extracted; the `.stack` and `.cause` are discarded before `log.warn` and the Sentry breadcrumb. Sentry gets a `category: silentCatch` breadcrumb string, not an `Sentry.captureException`, so there is no grouped exception, no stack frames, no cause chain.
- **Root cause**: `extractMessage` flattens any error to a single string at the earliest point; `silentCatch` never calls `Sentry.captureException(err)` for true Error instances — it only adds a breadcrumb. The richest diagnostic data is thrown away by the helper everyone funnels through.
- **Impact**: When a foundational call fails in production, operators see "ctx failed: boom" with no stack and no root cause. Because this helper is used everywhere, it systematically blinds the entire app's observability for the failures that matter most.
- **Fix sketch**: In `silentCatch`/`toastCatch`, when `err instanceof Error`, call `Sentry.captureException(err, { tags: { silentCatch: context } })` (so stack + cause are preserved and grouped) in addition to the breadcrumb. Keep the string breadcrumb for non-Error throws.

## 3. IPC timeout metric is detected by duration (`>= 29_000ms`) instead of by error type — short-timeout commands never count as timeouts; long ones miscount slow successes
- **Severity**: High
- **Category**: 💀 Silent failure / success theater (foundation)
- **File**: `src/lib/ipcMetrics.ts:75` & `:124` (`durationMs >= 29_000`) vs `src/lib/tauriInvoke.ts:37` (`DEFAULT_TIMEOUT_MS = 90_000`) and `InvokeTimeoutError` at `:67`
- **Scenario**: Callers pass custom timeouts all over the app (`import_persona_icon` 30s, several `timeoutMs: 30_000` KPI calls, and any future sub-29s timeout). The metrics layer classifies a call as a "timeout" purely by `!ok && durationMs >= 29_000`. (a) A command with `timeoutMs: 10_000` that actually times out rejects at ~10s → counted as a generic error, never a timeout, so the timeout dashboard underreports. (b) Conversely a *successful-but-slow* call cannot be a timeout (ok=true) — fine — but a non-timeout *failure* that happens to take 30s+ (e.g. backend error after a long CLI run) is mislabeled a timeout. The actual `InvokeTimeoutError` thrown at `tauriInvoke.ts:390` carries the precise signal and is ignored.
- **Root cause**: `recordIpcCall` only records `{ ok, durationMs }` and never the error kind, so `ipcMetrics` reverse-engineers "timeout" from a hardcoded 29s threshold that doesn't match the 90s default or any custom timeout.
- **Impact**: Timeout rate — a key reliability KPI surfaced in observability — is wrong in both directions. Operators chasing timeouts get a distorted picture; short-timeout regressions are invisible.
- **Fix sketch**: Add `timedOut: boolean` to `IpcCallRecord`, set it from `err instanceof InvokeTimeoutError` in `_invokeCore`'s rejection arm, and have `computeCommandStats`/`getGlobalSummary` count `r.timedOut` instead of the duration heuristic.

## 4. Registry rule ordering: generic `'timed out'` and `'Validation'` substrings can shadow more specific later rules
- **Severity**: Medium
- **Category**: 🔮 Latent failure / error code mismapping
- **File**: `src/lib/errors/errorRegistry.ts:54` (`'timed out'`) vs `:88` (`'OAuth authorization timed out'`); `:420` (`'Validation'`) vs later validators
- **Scenario**: `resolveError` returns the FIRST matching rule (line 559-567). The generic `'timed out'` rule sits at line 54, but the more specific `'OAuth authorization timed out'` rule is at line 88. A raw string `"OAuth authorization timed out"` contains the substring `"timed out"`, so it matches rule #54 first and yields the generic "request took too long / try again (recoverable)" copy instead of the intended OAuth-specific user_action guidance. The mirror file `useTranslatedError.ts` (ERROR_KEY_MAP) has the SAME ordering (`timed_out` at index 1, before `oauth_timeout`), so both code paths misclassify identically. The category even flips: `recoverable` (auto-retry, no action) vs the correct `user_action`.
- **Root cause**: The registry documents "ordered by specificity (most specific first)" but the generic timeout rule is placed above its specific variants; substring matching makes ordering load-bearing and it's violated.
- **Impact**: Users hitting an OAuth-window timeout are told to "just try again" (recoverable) when they actually need to act and complete sign-in promptly. Mis-categorized errors break the recovered/illustrated UI treatment that keys off `category`.
- **Fix sketch**: Move `'OAuth authorization timed out'` (and any specific `*timed out*` / specific `*Validation*` strings) ABOVE the generic `'timed out'` / `'Validation'` rules in BOTH `errorRegistry.ts` and `useTranslatedError.ts`. Better: make specific timeout rules regexes anchored to their full phrase.

## 5. `extractMessage` JSON-stringifies plain objects, leaking raw payloads (incl. PII) into toasts and logs
- **Severity**: Low
- **Category**: 🕳️ Edge case / trust boundary
- **File**: `src/lib/silentCatch.ts:30-37` (JSON.stringify fallback) → consumed by `toastCatch` at `:82` (`Failed to load data. ${msg}`)
- **Scenario**: A rejection reason is a plain object without `message`/`error`/`detail` — e.g. a fetch response body `{ user: "alice@x.com", token: "...", status: 500 }` or any structured value. `extractMessage` falls through to `JSON.stringify(obj)` and returns the entire serialized object. `toastCatch` then shows that JSON to the user verbatim ("Failed to load data. {\"user\":\"alice@x.com\",...}") and `silentCatch` logs it. Unlike Sentry breadcrumbs, these strings are NOT run through `before_breadcrumb` PII scrubbing.
- **Root cause**: The "never show [object Object]" goal is met by dumping the full object, but that overshoots — opaque JSON in a user toast is itself a UX/security regression, and the helper is the standard everyone funnels through.
- **Impact**: Confusing JSON blobs in user-facing toasts; potential leak of credentials/PII from arbitrary rejection payloads into UI and unscrubbed logs. Multiplies because `extractMessage`/`toastCatch` are app-wide.
- **Fix sketch**: Cap the JSON fallback length and/or whitelist known-safe keys; for unrecognized object shapes, return a stable generic like "Unexpected error (see details)" and route the full object only to `Sentry.captureException` where scrubbing applies. Never inline raw JSON into a toast string.
