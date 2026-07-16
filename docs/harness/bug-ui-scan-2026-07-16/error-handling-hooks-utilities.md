# Error Handling, Hooks & Utilities — bug-hunter + ui-perfectionist scan

> Total: 5 (Critical: 0, High: 1, Medium: 3, Low: 1)

## 1. Registry rewrites the do-not-retry timeout warning into "Try again" — coaching double-execution of mutations
- **Severity**: High
- **Category**: bug
- **File**: src/lib/errors/errorRegistry.ts:71 (rule) + src/lib/tauriInvoke.ts:126-128 (message it shadows)
- **Scenario**: A blocking mutating command not on `BLOCKING_MUTATION_TIMEOUTS` exceeds 90s (e.g. any newly added long mutation, or a slow disk). `InvokeTimeoutError`'s message — `"…timed out after 90000ms — the backend was NOT cancelled… do not blindly retry a mutating command (it could execute twice)"` — reaches `toastCatch`/`resolveError`. The substring rule `'timed out'` matches first and the user sees: "The request took too long to complete. Try again…", category `recoverable`.
- **Root cause**: The registry matches on the generic substring `'timed out'` and classifies it `recoverable` with an explicit "Try again" suggestion. `InvokeTimeoutError` deliberately encodes the at-least-once hazard in its message (`backendMayStillBeRunning`), but the friendly rewrite inverts that guidance. Additionally the ordering contract ("most specific first") is broken: `'OAuth authorization timed out'` (line 105) also contains "timed out", so its rule at line 105 is dead code and OAuth timeouts get the wrong copy and category (`recoverable` instead of `user_action`).
- **Impact**: User is told to retry a mutation whose first run is still committing → the command executes twice (duplicate scans, duplicate persona runs, duplicate writes). Plus a permanently unreachable OAuth-timeout rule.
- **Fix sketch**: Add a specific rule for the `Tauri invoke "…" timed out` shape BEFORE `'timed out'` with a "still working — do not retry; check status in a moment" suggestion (category `system` or a new non-retry hint), and move `'OAuth authorization timed out'` above the generic `'timed out'` rule. Add a unit test asserting first-match order for all rules whose match string contains another rule's match string.

## 2. `extractMessage` recurses the full `cause` chain — a 2-node cause cycle stack-overflows inside the error handler
- **Severity**: Medium
- **Category**: bug
- **File**: src/lib/silentCatch.ts:29-35
- **Scenario**: An error is constructed with a cyclic cause chain — `errA.cause = errB; errB.cause = errA` (easy to produce when two layers wrap each other's failures, e.g. a retry wrapper re-throwing with `{ cause: originalErr }` where `originalErr` was itself built from the wrapper's previous throw) — and lands in `silentCatch`/`toastCatch`.
- **Root cause**: The guard `cause !== err` only detects a direct self-cycle. For `A → B → A`, `extractMessage(A)` recurses into `B`, which recurses into `A`, indefinitely → `RangeError: Maximum call stack size exceeded` thrown out of the `.catch()` handler itself, becoming an unhandled rejection. The doc comment claims "One level deep keeps it readable," but the code has no depth limit at all — a 30-deep cause chain also produces a 30-fold nested `(caused by: …)` toast string.
- **Impact**: The error-handling path itself throws, converting a swallowed/toasted failure into an unhandled rejection with no log, no breadcrumb, no toast — the exact silent failure this module exists to prevent. Deep chains produce unreadable toast copy.
- **Fix sketch**: Thread a depth parameter (cap at 1-2 as documented) or a `Set` of visited errors through the recursion; return `err.message` once the cap/cycle is hit.

## 3. Auto-dedup clone protection is one-directional — the first caller's in-place mutation is baked into every follower's "independent" copy
- **Severity**: Medium
- **Category**: bug
- **File**: src/lib/tauriInvoke.ts:355-361, 377
- **Scenario**: Two components mount concurrently (or StrictMode double-mounts) and both call `list_x` with identical args within the 250ms TTL. Caller #1's `.then` runs first (it was attached first) and does `rows.sort(...)` or `rows.splice(...)` on the result. Caller #2's dedup branch then runs `structuredClone(v)` — on the already-mutated array.
- **Root cause**: Only *additional* callers are handed clones; the *first* caller receives the raw shared instance, and its continuation executes before the followers' clone step. The comment claims "one caller's in-place mutation silently corrupts the others" is prevented, but the fix only guards followers against each other, not against caller #1, whose mutation happens before any clone is taken.
- **Impact**: Within the dedup window, follower callers receive silently pre-mutated data (re-sorted, filtered, items removed) as if it were fresh backend state — classic hard-to-reproduce state corruption that only manifests under mount races.
- **Fix sketch**: Store the clone-wrapped promise in `inflightAutoDedup` and hand the raw result to nobody: `const shared = promise.then(v => v); return promise.then(clone)` for the first caller too — i.e. clone for every consumer, keeping the pristine value inside the map entry.

## 4. Error toasts have no dedup or coalescing — a failing poll loop floods the stack and spams assertive screen-reader announcements
- **Severity**: Medium
- **Category**: ui
- **File**: src/stores/toastStore.ts:108-124 (with src/lib/silentCatch.ts:126)
- **Scenario**: The user goes offline (or the backend wedges) while any recurring fetch wired through `toastCatch` is active — e.g. `remoteCommands:loadPending` (src/stores/remoteCommandStore.ts:35) on its refresh cadence, or a `usePolling`-driven view. Every cycle fails with the identical error.
- **Root cause**: `addToast` unconditionally appends a new toast per call. Healing toasts dedupe by `issueId` (line 147), but standard toasts — the path all 269 `toastCatch` call sites use — have no identity, so identical consecutive errors stack up to `MAX_TOASTS` (10), each also firing `announceImperative(message, 'assertive')`.
- **Impact**: A single root cause renders as a wall of identical 5s error toasts continuously replenished by the poll loop, and screen-reader users get an assertive interruption every few seconds — an accessibility regression during precisely the moment the app is degraded. Overflowed toasts (beyond 10) silently drop, which can also evict an unrelated, still-relevant toast.
- **Fix sketch**: In `addToast`, if the newest visible standard toast has the same `message`+`type`, refresh its timestamp/duration (optionally add an "×N" counter) instead of appending, and skip the repeat `announceImperative`. Mirrors the dedup pattern already proven by healing toasts.

## 5. `invokeWithTimeout` opts-shape sniffing misclassifies `{ options }`-only InvokeOpts as legacy positional form, silently dropping the caller's InvokeOptions
- **Severity**: Low
- **Category**: bug
- **File**: src/lib/tauriInvoke.ts:313-323
- **Scenario**: A caller uses the documented new opts-object form but sets only its `options` field: `invokeWithTimeout("cmd", args, { options: { headers: { "x-foo": "1" } } })`. The detection predicate checks only for `idempotencyKey`/`timeoutMs`/`noAutoDedup`, so this object falls into the legacy branch and is treated as the `InvokeOptions` itself.
- **Root cause**: Shape sniffing enumerates three of the four `InvokeOpts` fields; `options` — a legal, typed, documented field — is missing from the discriminator. The resulting `{ options: {...} }` has no `headers` property, so `new Headers(opts.headers)` yields an empty header set and the caller's headers/options vanish without any error (the type system permits the call, so nothing flags it).
- **Impact**: Latent trap on a public API: no current call site passes options-only (verified by grep), but the first one to do so will have its custom InvokeOptions silently ignored — likely surfacing as an inexplicable backend rejection far from the cause.
- **Fix sketch**: Add `"options" in opts` to the discriminator, or better, distinguish structurally: treat `opts` as `InvokeOpts` whenever it lacks every `InvokeOptions` key (`headers`). A one-line unit test locks the contract.
