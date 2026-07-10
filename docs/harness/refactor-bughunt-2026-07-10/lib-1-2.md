> Context: lib [1/2]
> Total: 8
> Critical: 0  High: 0  Medium: 3  Low: 5

## 1. `text-md` is not a real Tailwind class — cozy/comfortable text sizing is a silent no-op
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: edge-case
- **File**: src/lib/density.ts:42, 53
- **Scenario**: `DENSITY_TOKENS.cozy.textClass` and `.comfortable.textClass` are both `'text-md'`. Tailwind v4's default font-size scale is `text-xs / -sm / -base / -lg / …` — there is no `md` tier, and `@theme` in `src/styles/globals.css` defines no `--text-md`. I grepped the whole repo for `text-md\b`: the only match is this file (no CSS/config defines it). Under Tailwind v4 an unknown utility emits **no CSS**, so a row rendered in cozy/comfortable density gets no font-size class at all and falls back to inherited size. Only `compact` (`text-xs`) actually applies.
- **Root cause**: `text-md` was assumed to exist (it's a common muscle-memory mistake); the two densities intended to be *larger*/normal than compact end up size-unspecified instead.
- **Impact**: UX — density text-size differentiation is broken for 2 of 3 modes; the "cozy vs comfortable" distinction on text is invisible.
- **Fix sketch**: Use `text-base` (cozy) and `text-sm` (comfortable), or add a `--text-md` token to the `@theme` block. Verify visually across a list view after the change.

## 2. Auto-dedup hands the *first* caller the shared, un-cloned result held in the map
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: state-corruption
- **File**: src/lib/tauriInvoke.ts:341-396
- **Scenario**: Read-only IPC results are cached in `inflightAutoDedup` for `AUTO_DEDUP_TTL_MS` (250 ms) after settle. Every *additional* concurrent caller gets an independent `structuredClone` (lines 355-361), but the **first** caller receives the raw `promise` (line 366/398) whose resolved value is the exact object stored in the map. If that first caller mutates the array/object in place within the TTL window (`.sort()`, `.push()`, a mutating store reducer — the very hazard the clone was added to prevent), a second caller arriving <250 ms later clones the *already-mutated* value. The comment claims clone-per-additional-caller protects everyone, but it does not protect against the first caller polluting the cached source.
- **Root cause**: The cache stores and returns the same reference the original caller owns; only fan-out copies are defended.
- **Impact**: Intermittent, hard-to-repro cross-component data corruption on list_/get_/fetch_ reads under mount races / StrictMode double-mount.
- **Fix sketch**: Clone on *every* hand-out, including the primary: cache the promise but always return `promise.then(v => structuredCloneSafe(v))`, or store a deep-frozen snapshot so in-place mutation throws instead of silently corrupting.

## 3. Bulk-wave batching runs every batch in parallel — `INIT_BATCH_SIZE_BULK` is an inert knob
- **Lens**: code-refactor
- **Severity**: medium
- **Category**: dead-code
- **File**: src/lib/eventBridge.ts:996-1002
- **Scenario**: `INIT_BATCH_SIZE_BULK` (16) is documented (lines 76-85) as trimming sequential IPC round-trips by grouping the remaining listeners into batches. But the batches are dispatched with `await Promise.all(bulkBatches.map(attachBatch))` — all batches run **concurrently**, and `attachBatch` itself already `Promise.all`s its members. Net effect: all ~30 normal listeners hit IPC simultaneously regardless of `bulkSize`. Changing 16 → 4 or 64 produces identical runtime behavior, so the elaborately-commented knob (and the slicing loop) does nothing.
- **Root cause**: The slicing predates a refactor to parallel dispatch; the loop + constant were left in place with a comment implying sequential waves.
- **Impact**: Maintainability — a load-bearing-looking tuning constant is a no-op; future perf tuners will "adjust" it and see no change, or add real serialization assuming it exists.
- **Fix sketch**: Either drop the batching (attach `normal` in one `Promise.all` and delete `INIT_BATCH_SIZE_BULK`), or make it real by awaiting batches sequentially (`for (const b of bulkBatches) await attachBatch(b)`).

## 4. `classifyError` maps generic "… not found" to `provider_not_found` (critical default severity)
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: edge-case
- **File**: src/lib/errorTaxonomy.ts:98-104, 218
- **Scenario**: The provider-not-found branch matches any message containing the substring `'not found'`. A domain error like `"persona not found"`, `"credential not found"`, or `"row not found"` is classified as `provider_not_found`, whose `defaultSeverity` is **`critical`** (line 218) and which is `isFailoverEligible`. So a benign 404-style lookup miss can be surfaced as a critical incident and can trigger provider failover.
- **Root cause**: Broad substring heuristic with no word-boundary/context guard; `provider_not_found` sits before the more specific credential/validation branches for this phrase.
- **Impact**: UX/observability — occasional over-escalation of ordinary not-found errors to critical + spurious failover attempts.
- **Fix sketch**: Tighten to provider-context phrases (e.g. `'command not found'`, `'executable not found'`, `enoent`, `'is not recognized'`) and let generic "not found" fall through to validation/unknown.

## 5. Share deep-link URL (may carry a share token) is logged at info level
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: trust-boundary
- **File**: src/lib/eventBridge.ts:757, 919-921
- **Scenario**: On `SHARE_LINK_RECEIVED`, `tracing("[share-link-received]", url)` forwards the full raw deep-link URL to `logger.info`, which `console.info`s it verbatim. Share/import deep links (`resolve_share_deep_link`, `import_from_share_link` exist as commands) can embed a capability token or slug in the URL; unlike the Sentry path (`sentry.ts` scrubs URLs to host-only), this console log keeps the whole string. Anyone with devtools/log access sees the token.
- **Root cause**: Convenience trace logs the untrimmed URL; no host-only redaction as done elsewhere.
- **Impact**: security (minor) — secret-bearing link leaked into console/log output.
- **Fix sketch**: Log only the host/path or a redacted form (reuse the URL-scrub logic from `sentry.ts::scrubPii`), not the raw query/token.

## 6. Dead timing constants in `EVENT_BRIDGE_TIMING`
- **Lens**: code-refactor
- **Severity**: low
- **Category**: dead-code
- **File**: src/lib/eventBridge.ts:74, 91
- **Scenario**: `AUTH_LOGIN_TIMEOUT_MS` (self-documented as "Defined here for reference; the actual timer lives in authStore") and `TITLEBAR_NOTIFICATION_DEBOUNCE_MS: 0` are never read in production code. Grep for both names returns only their definition site plus `eventBridge.test.ts` (a test that merely asserts the constant equals 0). The TITLEBAR listener (lines 818-839) does no debouncing and never references the constant.
- **Root cause**: Reference/aspirational constants left behind after the behaviors moved elsewhere (authStore) or were never implemented (titlebar coalescing).
- **Impact**: maintainability — a value asserted by a test but wired to nothing invites false confidence that titlebar debounce is configurable here.
- **Fix sketch**: Remove both constants (and the tautological test), or, if kept for documentation, move `AUTH_LOGIN_TIMEOUT_MS` next to the actual timer in authStore.

## 7. Triplicated log+breadcrumb boilerplate across `silentCatch` / `silentCatchNull` / `toastCatch`; misplaced JSDoc
- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication
- **File**: src/lib/silentCatch.ts:71-129
- **Scenario**: All three catch factories run the identical 6-line sequence (`extractMessage` → `stackOf` → `log.warn` → `Sentry.addBreadcrumb`) with only the trailing action differing (nothing / return null / add toast). Additionally the JSDoc block at lines 85-90 ("Same as silentCatch but returns `null`…") is stranded above `toastCatch` — detached from `silentCatchNull` (line 116) which it documents — and line 91 opens a second doc comment, so the two blocks are interleaved.
- **Root cause**: Copy-paste growth of the helper trio; a doc comment moved out of order during an edit.
- **Impact**: maintainability — any change to the diagnostic payload (e.g. adding a tag) must be made in three places; the mis-ordered doc misleads readers.
- **Fix sketch**: Extract `recordCaught(context, err): string` returning the message, and have the three factories call it then perform their tail action. Move the `silentCatchNull` JSDoc directly above its function.

## 8. `waitForIpcToken` caches a resolved promise even when the token never arrived
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: edge-case
- **File**: src/lib/tauriInvoke.ts:89-109
- **Scenario**: `_tokenReady` is memoized once and never reset. If the polling loop exhausts its 100 tries (~2 s) without `__IPC_TOKEN` ever being set, it still `resolve()`s and caches that resolved promise permanently. Every later `waitForIpcToken()` then returns instantly as "ready" even though the token is still absent, so subsequent cold calls skip the wait entirely. It's saved from being a real bug only because `_invokeCore` independently re-checks the token and caps retry depth — but the "wait for token" guarantee is silently void for the rest of the session after one timeout.
- **Root cause**: One-shot memoization of a *maybe-failed* wait, with no way to re-arm.
- **Impact**: reliability (minor) — a single early timeout removes the token-wait safety net for all later IPC in that session.
- **Fix sketch**: Only cache on success; on timeout, null out `_tokenReady` so a later call re-polls (or resolve with a boolean and let callers decide).
