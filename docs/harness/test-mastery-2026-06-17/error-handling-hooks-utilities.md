# Test Mastery — Error Handling, Hooks & Utilities
> Total: 7 findings (1 critical, 4 high, 2 medium, 0 low)

## 1. `extractMessage` / `toastCatch` / `silentCatch` — zero tests on the app-wide error-surfacing helpers
- **Severity**: critical
- **Category**: coverage-gap
- **File**: src/lib/silentCatch.ts:19-129
- **Current test state**: none
- **Scenario**: `extractMessage` is the single normalizer that turns *any* caught value (Error, Tauri `{error}` / `{code,message,data}` envelope, plain string, null, nested `cause`) into text shown in toasts, logs and Sentry breadcrumbs. It is invoked from ~454 call sites via `silentCatch` / `toastCatch` / `silentCatchNull`. The file's own doc-comment names its core invariant: it must *never* return the literal `"[object Object]"`. Today there is no test asserting that. A regression that drops the `typeof object` branch (or reorders the `message`/`error`/`detail` precedence) would silently degrade every error toast in the app to `"[object Object]"` or `"undefined"` — the most common shipped-UX regression, and exactly the one this helper exists to prevent — with nothing failing CI.
- **Root cause**: helper was written defensively (per the comments) but never pinned with tests; its blast radius (454 callers) makes it the highest-leverage untested unit in the context.
- **Impact**: every user-facing failure message across the product can silently turn into opaque noise; on-call loses the breadcrumb trail (`stackOf` returning the wrong thing) with no signal.
- **Fix sketch**: pure-function unit suite (llm-generatable) for `extractMessage`, asserting the **business invariant "output is human-readable text, never `[object Object]`/`undefined`/`{}` for non-empty input"** across each input shape: `Error` with `.message`; `Error` with `.cause` (asserts the `"X (caused by: Y)"` format and that a cause === message is *not* duplicated); cause-equals-self guard (no infinite recurse); `{message}` / `{error}` / `{detail}` precedence order; empty-string fields falling through to JSON; plain object → sorted JSON not `[object Object]`; `null`/`undefined` → `""`; circular object hitting the `catch` → `String(err)`. Then mock `@/stores/toastStore` + `@sentry/react` and assert `toastCatch` calls `addToast(<text>, 'error', 5000)` with the resolved message (and `customMessage` override path), `silentCatch` adds a `warning` breadcrumb with `data.stack`, and `silentCatchNull` returns `null`.

## 2. `resolveError` error registry — 60+ user-facing rules, regexes and ordering, untested
- **Severity**: high
- **Category**: coverage-gap
- **File**: src/lib/errors/errorRegistry.ts:43-572
- **Current test state**: none
- **Scenario**: `resolveError` drives the friendly message + recovery suggestion + `FriendlyErrorCategory` (recoverable/user_action/system) for ~12+ error UIs (`ToastContainer`, `InlineErrorRecovery`, `ErrorPhase`, negotiator/foraging panels, etc.). Rule order is load-bearing and the file says so: `"weekly usage limit reached"` MUST match before `"usage limit reached"` (both substrings co-occur and resolve to *different categories* — `user_action` vs `recoverable`, i.e. "pause/upgrade" vs "auto-retries, no action"). Several rules are regexes (`interval_seconds must be >= \d+`, `Build session .* (?:not found|disappeared)`, `Webhook returned HTTP \d+`). A reorder, a broadened earlier `match`, or a regex typo would mis-categorize errors — e.g. tell a user a hard budget cap "retries automatically" — and nothing catches it.
- **Root cause**: large hand-ordered rule table with overlapping substrings; no characterization test locks the specificity ordering or the regex matches.
- **Impact**: users get wrong recovery advice on billing/usage/auth/build failures (act-vs-wait inverted), eroding trust; the `unclassified` fallback could silently swallow a category that should have been actionable.
- **Fix sketch**: llm-generatable table-driven test. **Invariant to assert: each representative raw string resolves to the expected `category` AND the most-specific rule wins.** Concretely: a `[raw, expectedCategory]` matrix covering the overlap traps (weekly-vs-window usage limit; `Budget limit exceeded` → user_action; `interval_seconds must be >= 60` regex; `Build session abc-123 not found` regex; a string matching only the generic `Validation` rule; an unmatched string → `GENERIC_FALLBACK`/`unclassified`). Add one guard test that every `ERROR_RULES[i]` whose `match` is a substring of a *later* rule's match is verified to be ordered first (catches future reorder regressions). Also test `friendlySeverity` maps known codes and passes unknown through unchanged.

## 3. `invokeWithTimeout` timeout + auth-retry + dedup behavior is untested (only `coerceArgs` is)
- **Severity**: high
- **Category**: coverage-gap
- **File**: src/lib/tauriInvoke.ts:244-462
- **Current test state**: exists-but-weak (`src/lib/__tests__/tauriInvoke.coerceArgs.test.ts` covers only the `coerceArgs` pure path; the wrapper's core control flow is untested)
- **Scenario**: this wrapper guards *every* React→Rust IPC call. Untested behaviors with real blast radius: (a) **timeout** — slow backend must reject with `InvokeTimeoutError` carrying `.command`; (b) **auto-dedup** for `list_*/get_*/fetch_*` must fold concurrent identical reads into one `invoke()` round-trip AND hand each extra caller a `structuredClone` (the comment warns a shared ref lets one caller's `.sort()`/`.push()` corrupt the others — a genuine data-corruption bug); (c) **idempotencyKey** dedup returns the same in-flight promise and evicts on settle; (d) **isIpcAuthFailure** one-shot retry on `"IPC authentication failed"`. A regression in (b) (e.g. returning the shared ref) corrupts list data across components with green tests.
- **Root cause**: the timeout/race/retry/dedup logic was added incrementally; only the extracted pure helper got a test. `_clearAutoDedupForTests` already exists (line 344), signalling tests were *intended* but never written.
- **Impact**: silent IPC data corruption (shared mutable arrays), hung calls that never time out, or a broken auth-retry that makes cold-start IPC calls fail on WebView2 — none visible in CI.
- **Fix sketch**: mock `@tauri-apps/api/core`'s `invoke` (already mocked in `src/test/setup.ts`) with `vi.fn`, set `globalThis.__IPC_TOKEN`, use fake timers. Assert: timeout rejects `InvokeTimeoutError` with correct `.command`/message; two concurrent `get_x` calls → `invoke` called once and the two resolved arrays are **not the same reference** (mutate one, assert the other unchanged — the structuredClone invariant); `noAutoDedup`/non-read-only/class-instance-arg (null hash) all bypass dedup; same `idempotencyKey` returns one promise and the map is cleared after settle (`inflightByKey.delete`); an `"IPC authentication failed"` rejection with a refreshed token retries exactly once then succeeds. Call `_clearAutoDedupForTests()` in `beforeEach`.

## 4. `usePolling` backoff + visibility gating has no test, despite a coordinator that *is* tested
- **Severity**: high
- **Category**: coverage-gap
- **File**: src/hooks/utility/timing/usePolling.ts:55-97
- **Current test state**: none (the underlying `pollingCoordinator` has `src/lib/__tests__/pollingCoordinator.test.ts`, but the hook's own backoff/gating logic is untested)
- **Scenario**: this hook backs every auto-refreshing panel (running executions, cloud reviews, dashboards, GitLab pipelines). Its business logic: on consecutive fetch failures it computes exponential backoff `min(interval * 2^errorCount, maxBackoff)` and gates re-runs via `shouldRun()`/`nextEligibleAt`; on success it resets `errorCount` to 0. A bug here either hammers a failing backend (DDoS-your-own-API + cost) or never recovers after an error. `isPolling` also must reflect `enabled && documentVisible`. None of this is asserted.
- **Root cause**: timing/ref-driven logic perceived as hard to test; the success-reset and the `2^n` cap are exactly the kind of off-by-one that hides until production load.
- **Impact**: runaway polling under sustained backend errors (cost + rate-limit cascades) or stalled dashboards that silently stop refreshing.
- **Fix sketch**: render the hook with `@testing-library/react` `renderHook` + fake timers, fetchFn that rejects N times then resolves. Assert the computed `nextEligibleAt` delay grows as `interval*2^n` and caps at `maxBackoff`; that a success resets `errorCountRef` to 0 (next failure starts from the base interval again); and that `isPolling` is false when `enabled=false` or the mocked `useDocumentVisibility` returns hidden. **Invariant: backoff is bounded and monotonic until success, then resets.**

## 5. `useDebouncedSave` unmount-flush — the data-loss fix it was written for has no regression test
- **Severity**: high
- **Category**: coverage-gap
- **File**: src/hooks/utility/timing/useDebouncedSave.ts:41-89
- **Current test state**: none
- **Scenario**: the file's comment documents a real prior data-loss bug: an edit made in the final debounce window before the editor closes (e.g. picking a persona icon) was silently lost because cleanup cleared the timer without firing. The fix is a mount-once unmount effect that *flushes* (`void saveFnRef.current()`) a pending save. There is no test, so a future refactor of the two effects (or moving the flush into the dep-driven cleanup) would silently reintroduce lost-edit-on-close — the worst class of UX bug (silent data loss) with green CI. Equally untested: the `catch` path that sets `lastError` and fires the "Auto-save failed… will retry" toast.
- **Root cause**: the dual-effect design (dep-driven cancel cleanup vs mount-once flush) is subtle and easy to break; no test pins the "flush on real unmount, but not double-save when `cancel()` was called first" contract the comment describes.
- **Impact**: silent loss of the user's last edit when closing an editor; or a double-save race if the guard regresses the other way.
- **Fix sketch**: `renderHook` with fake timers and a `vi.fn` saveFn. (a) Make `isDirty=true`, advance < delay, `unmount()`, assert saveFn was called exactly once (flush). (b) Same setup but call returned `cancel()` before unmount → assert saveFn is **not** called (no double-save). (c) saveFn rejects → advance past delay, assert `lastError` is set and `useToastStore.addToast` (mocked) fired with `'error'`. **Invariant: a dirty pending edit is never silently dropped on unmount, and a cancelled timer never fires.**

## 6. `useFilteredCollection` — pure filter reducer, ideal LLM-generatable batch, currently untested
- **Severity**: medium
- **Category**: llm-generatable
- **File**: src/hooks/utility/data/useFilteredCollection.ts:25-58
- **Current test state**: none (sibling `useLayeredList.test.ts` exists; this one doesn't)
- **Scenario**: a generic list-filter used to replace persona/status/date `useMemo` chains across many list views. Its semantics have edge rules that are easy to get subtly wrong: `exact` matchers **skip** when value is `null`/`undefined`/`''` (so an empty filter must return everything, not nothing), and the `fallback` substitution (`source ?? 'local'`) decides whether null-field rows match. A regression that stops skipping empty filters would make list views appear empty; one that drops `fallback` would hide local rows. This is pure, deterministic logic — cheap to lock down.
- **Root cause**: treated as trivial glue; but it gates what users see in every list it backs.
- **Impact**: list views silently show nothing (empty-filter regression) or hide a subset of rows (fallback regression) — looks like "my data disappeared".
- **Fix sketch**: llm-generatable pure test (call the inner filter logic / `renderHook`). **Invariants:** empty/null/`''` exact value ⇒ no filtering (returns all, `total` preserved); a matcher with `fallback` matches rows whose field is null against the fallback; multiple `exact` matchers compose (AND); a `null` entry in `custom[]` is skipped; `isEmpty` is true iff `filtered.length===0` while `total` always reflects the input length.

## 7. No quality gate / coverage ratchet on `src/lib/errors` and `src/lib/silentCatch.ts`
- **Severity**: medium
- **Category**: quality-gate
- **File**: vitest.config.ts (no `coverage.thresholds`); src/lib/errors/*, src/lib/silentCatch.ts
- **Current test state**: none (no coverage thresholds configured at all)
- **Scenario**: `vitest.config.ts` has `include` globs but no `coverage` block, so nothing prevents these cross-cutting error/IPC helpers from *staying* at 0% or regressing after findings #1–#3 are fixed. Given these files have the highest fan-in in the context (454 + 12+ call sites), they are precisely where a per-area threshold pays off; a repo-wide blanket threshold would be noisy and get bypassed.
- **Root cause**: coverage gating was never set up; backfilling everything at once would be heavy-handed.
- **Impact**: the error-surfacing layer can silently rot back to untested after this audit's tests land.
- **Fix sketch**: do **not** impose a global %. After #1–#3 land, add a narrowly-scoped `coverage.thresholds` entry (per-file glob) for `src/lib/silentCatch.ts` + `src/lib/errors/errorRegistry.ts` (e.g. 85% lines/branches) as a **new-code ratchet**, blocking only on regressions to these specific high-fan-in files. Keep it advisory elsewhere so the gate fires on real risk, not noise.
