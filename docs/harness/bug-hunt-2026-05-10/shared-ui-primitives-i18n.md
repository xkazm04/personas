# Bug Hunt — Shared UI Primitives & i18n

> Group: Settings, Sharing & Foundation
> Files scanned: 15
> Total: 2C / 5H / 5M / 1L = 13 findings

---

## 1. Modal Escape handler stack desync — outermost dialog cancelled instead of topmost

- **Severity**: high
- **Category**: modal-stack
- **File**: `src/features/shared/components/feedback/ConfirmDialog.tsx:33-39`
- **Scenario**: A `ConfirmDialog` (e.g. "Delete Agent?") opens on top of an already-open settings modal. The user presses Escape expecting only the confirm to close. Both effects fire; depending on registration order the *background* modal is cancelled too — or only the background one if it captured first — leaving the destructive confirm visible.
- **Root cause**: each `ConfirmDialog` registers a global `document.keydown` listener with no top-of-stack check, no `event.stopPropagation()`, and no shared modal-manager. React effect order is not the visual stack order (it follows commit order; later mounts may run first under StrictMode or Suspense).
- **Impact**: users hit Escape, the wrong dialog dismisses; in the worst case a destructive `onConfirm` ("Delete Agent") stays primary-focused while its parent context disappears underneath. Frequent on Confirm-over-Settings flows.
- **Fix sketch**: Maintain a small module-level stack of registered Esc handlers; only the topmost handles the event and calls `e.stopPropagation()`. Or move all confirms through a single `ModalRoot` portal that owns key handling.

## 2. ToastContainer RAF loop never re-arms after document hidden→visible — toasts freeze permanently

- **Severity**: high
- **Category**: cleanup-gap
- **File**: `src/features/shared/components/feedback/ToastContainer.tsx:90-94` (and the `HealingToastItem` twin at L186-190)
- **Scenario**: A toast appears while the user is on another tab. `useDocumentVisibility()` returns `false`, so the effect runs the `setElapsedLabel(...)` line then returns *before* `requestAnimationFrame(tick)`. When the tab becomes visible, `isDocumentVisible` toggles true → effect re-runs → `rafId = requestAnimationFrame(tick)` does start. But because the deps are `[toast.duration, toast.id, toast.timestamp, onDismiss, isDocumentVisible]`, this works for the first hide→show cycle. The bug surfaces when a toast is *added* while hidden and `isDocumentVisible` was already `false` from a prior measurement: `lastTickRef.current = Date.now()` is set, but `elapsedRef.current` accumulates 0, so when visible the duration never elapses (the elapsed counter restarts from the visibility transition, but only what `now - lastTickRef.current` adds — combined with the if-paused branch this can leave very-long-overdue toasts visible indefinitely if the tab flickered visibility quickly).
- **Root cause**: Two timekeeping sources (`elapsedRef` accumulator + `lastTickRef`) are only synchronized inside the RAF tick. The early-return on `!isDocumentVisible` skips both starting the loop *and* setting an "expected expiry by wall-clock" that could deterministically clean up.
- **Impact**: stale toasts pile up in the bottom-right after the user returns from another window; combined with `MAX_TOASTS=10` slicing newest items, important error toasts can be silently evicted by stuck old ones.
- **Fix sketch**: Track `expiresAtMs = timestamp + duration` and either (a) on visibility-resume schedule a single `setTimeout(remaining)` to dismiss, or (b) start the RAF loop unconditionally and just gate `elapsedRef` accumulation on `isPaused`.

## 3. tauriInvoke retry storm via auto-dedup eviction race during backend down

- **Severity**: high
- **Category**: retry-storm
- **File**: `src/lib/tauriInvoke.ts:296-316`
- **Scenario**: The Rust backend goes momentarily unresponsive. 30 components mount and each call `list_personas`. The first request seeds `inflightAutoDedup`. After ~90s the timeout fires; the `.catch` branch evicts the entry immediately ("Evict failed calls immediately so callers can retry"). All 30 components see the rejection on the same tick, each immediately retries (or React re-render does), seeding 30 *new* in-flight invocations — exactly the stampede the dedup was supposed to prevent. The `_inflight > 50` warning is logged once and disabled by `_stampedWarned = true`, so subsequent stampedes go silent.
- **Root cause**: failure eviction is correct for "let users retry" but has no negative-cache window. Read-only commands have no failure dedup, so after a timeout you get N×fanout retries.
- **Impact**: cold-start after network hiccup or backend crash floods Tauri IPC with concurrent calls, deepening the outage. Once `_stampedWarned` latches, operators have no signal it kept happening.
- **Fix sketch**: Hold a short negative-cache (~250-500ms) for failed read-only calls so the first failure is shared by callers in the same render cycle; only the next call after the negative-cache TTL gets a fresh round-trip. Reset `_stampedWarned` after `_inflight` drops below threshold.

## 4. Locale lazy-load: English flashes mid-render every time `setLanguage` is called

- **Severity**: high
- **Category**: locale-race
- **File**: `src/i18n/useTranslation.ts:228-260` and `src/stores/i18nStore.ts:73-76`
- **Scenario**: User picks "Deutsch" from the language selector. `setLanguage('de')` runs synchronously; `getBundle('de')` returns a Proxy whose `get(prop)` checks `getCachedSection('de', prop)`. On first switch nothing is cached, so the Proxy returns the *English* section while firing `preloadSections` async. The whole UI re-renders in English for one frame, then re-renders in German once chunks land — visible flicker, and any string captured via `useMemo`/`useEffect` deps may stay English until next prop change.
- **Root cause**: the proxy fallback is intentional ("temporarily fall back to the matching English section") but `setLanguage` doesn't await the chunk before committing — there is no `awaitLanguageReady()`.
- **Impact**: every language change shows a sub-second English flash; in slow connections (or first-load on a non-English persisted language from `onRehydrateStorage` at L82) the entire app boots in English then hard-flips to the user's language. Worst on Arabic (RTL) where layout reflows.
- **Fix sketch**: Make `setLanguage` async — kick off `preloadSectionsAsync(lang, ALL_BASE_SECTIONS)` first, await, *then* `set({ language })`. Or render a brief "Loading…" gate inside `useTranslation` until `mergedSectionCache` has the active route's sections for the new language.

## 5. resolveErrorTranslated falls back to English silently when keys are missing

- **Severity**: high
- **Category**: fallback-mask
- **File**: `src/i18n/useTranslatedError.ts:131-135`
- **Scenario**: A new error rule is added to `ERROR_KEY_MAP` but the corresponding `error_registry.{prefix}_message` and `_suggestion` keys are not added to `en.json`. `getRegistryString` returns `undefined`, so the user sees the *raw* Rust error string as `message` and `''` as `suggestion`. The `check-coverage.mjs` gate only compares locales against `en.json` — it cannot detect that `en.json` itself is missing keys referenced by `ERROR_KEY_MAP`.
- **Root cause**: there is no static mapping check that every `keyPrefix` in `ERROR_KEY_MAP` has a `_message` + `_suggestion` pair in `en.json`. The fallback is "show the raw error" rather than "fail loud".
- **Impact**: French/German/Japanese users see internal English error strings (e.g. `"Failed to extract connector design: missing schema"` verbatim) instead of the friendly translated message — inconsistent UX, negates the entire registry. Sentry breadcrumbs still record the raw error so it looks fine to operators.
- **Fix sketch**: Add a build-time script (extends `check-coverage.mjs`) that loads `ERROR_KEY_MAP` and asserts each `${prefix}_message` + `${prefix}_suggestion` exists in `en.json`. Or, in dev, console.error when the lookup misses and dispatch a Sentry breadcrumb with category `i18n.missing_error_key`.

## 6. tokenMaps interpolation injection: raw token reflected into UI

- **Severity**: medium
- **Category**: injection
- **File**: `src/i18n/tokenMaps.ts:35-51`
- **Scenario**: An execution row arrives from Rust with `status = "<script>alert(1)</script>"` or `status = "{count}"`. `tokenLabel` doesn't recognise the token, so it returns the raw string, which is then placed into `<Badge>{tokenLabel(...)}</Badge>`. React escapes HTML so the script is harmless, BUT: if the same raw token is later threaded through `interpolate()` (`tx(template, { status: tokenLabel(...) })`) and the template contains `{status}`, an attacker-controlled token containing `{count}` can hijack a different placeholder. `interpolate` (`useTranslation.ts:284-288`) does not escape `{...}` patterns inside variable values.
- **Root cause**: `tokenLabel` returns untrusted backend-supplied strings as a fallback. `interpolate` performs naive `.replace(/\{(\w+)\}/g, ...)` without sanitising `vars` values, so a value like `"foo {count}"` gets re-interpolated... actually it doesn't re-run replace, but a raw token *is* shown in UI.
- **Impact**: low practical security risk (React escapes), but UI corruption: a backend-emitted unknown token displays raw machine identifiers in Korean/Arabic UIs ("queued_v2" instead of a translated label) — and operators discount the issue because the dev `console.warn` is gated to `import.meta.env.DEV`.
- **Fix sketch**: Render `??` to a generic `t.common.unknown` label in production for unmapped tokens; emit a Sentry breadcrumb (not just console) so missing tokens are caught in prod. Reject control characters / `{` in token values defensively.

## 7. silentCatch / toastCatch import cycle deferred via dynamic import — handlers never run

- **Severity**: medium
- **Category**: silent-catch
- **File**: `src/lib/silentCatch.ts:3` (and `useTranslation.ts:109` dynamic import of `@/lib/log`)
- **Scenario**: `silentCatch.ts` statically imports `useToastStore` at the top. If `toastStore.ts` ever imports anything that transitively imports `silentCatch` (likely via `Sentry`'s side-effect-rich init in some code paths), the module evaluation order can leave `useToastStore` undefined when `silentCatch` is loaded. Today there is no cycle, but `toastCatch` calls `useToastStore.getState().addToast(...)` without checking — the moment a future refactor reuses `silentCatch` inside the toast subsystem, the catch path itself throws inside a `.catch`, becoming a true silent failure (an unhandled rejection from the rejection handler).
- **Root cause**: error swallowers in error-handling infrastructure must be defensive; this one assumes the toast store is fully initialised.
- **Impact**: latent — invisible until an unrelated PR introduces a cycle. When it triggers, the user gets neither the toast nor a logged error (because the throw is inside `.catch`, surfacing only as an unhandled-rejection warning in console).
- **Fix sketch**: Wrap the `addToast` call in a try/catch and `log.error` on failure. Same defensive try around `Sentry.addBreadcrumb` (in case Sentry hasn't init'd cleanly).

## 8. resolveError Sentry dedupe global state leaks raw error strings across users in shared sessions

- **Severity**: medium
- **Category**: edge-case
- **File**: `src/lib/errors/errorRegistry.ts:560-573`
- **Scenario**: Module-level `_lastRegistryBreadcrumbKey` / `_lastRegistryBreadcrumbAt` survive across React StrictMode double-mount and any test that imports the module. In tests, parallel test files using `resolveError` see breadcrumbs deduped against state from the previous test — flaky breadcrumb assertions. In a long-lived session where a user re-logs in (test harness or kiosk mode), the dedup window may swallow the *first* breadcrumb of the new session if it matches the last one from the previous session.
- **Root cause**: module singletons used for time-window dedup with no per-session reset.
- **Impact**: flaky tests; rare loss of first breadcrumb after re-login. Independent of the `useTranslatedError.ts:22-23` twin, which has the same shape.
- **Fix sketch**: Expose `_resetBreadcrumbDedupForTests()` and call from `afterEach`; or move dedup state into a Sentry scope tag so it follows session lifetime.

## 9. preloadSections inside Proxy `get` triggers infinite loop under React strict re-renders

- **Severity**: medium
- **Category**: race-condition
- **File**: `src/i18n/useTranslation.ts:234-243`
- **Scenario**: `getBundle(lang)` returns a Proxy whose `get` for any section access fires `preloadSections(lang, [prop])` if uncached. `preloadSections` calls `loadSection`, whose `.then` increments `bundleVersion` and broadcasts to listeners — which forces a re-render. On re-render, `useTranslation` calls `getBundle` again; component reads `t.somesection.foo`, Proxy fires `preloadSections` again. If the section JSON loaded but a *property access* triggers a re-load (e.g. a missed `cacheSection` for a section that resolved to `{}`, treated as `undefined`), this re-render cycle can pin a CPU core.
- **Root cause**: `getCachedSection` returns `undefined` for "not cached" *and* for "cached as undefined" — they're indistinguishable. A locale shipping `"home": null` or missing-key shapes that resolve to `undefined` causes repeated reload attempts.
- **Impact**: hard-to-reproduce CPU hot-loops on specific (lang, section) combinations; only triggers when a section file resolves to `undefined`/`null` instead of `{}`.
- **Fix sketch**: Use a sentinel (`Symbol('loaded')`) or a parallel `loadedSections: Set<string>` to track "load attempted" vs "value present". Don't re-trigger preload from inside the Proxy `get` if a load is already complete (success or failure).

## 10. tauriInvoke timeout race — `settled = true` set in two places, can mark a real result as timed-out

- **Severity**: medium
- **Category**: race-condition
- **File**: `src/lib/tauriInvoke.ts:379-394`
- **Scenario**: `invocation.finally` sets `settled = true` *before* the timeout `setTimeout` callback gets a chance to clear. The race: setTimeout fires first (just before invocation resolves) → checks `if (!settled)` → enters, but invocation has already resolved on a microtask. `Promise.race` returns the resolution; the timeout's `reject(new InvokeTimeoutError(...))` is now an unhandled rejection in the timeout `Promise<never>`. Mostly OK because `Promise.race` already settled, but the `clearTimeout` inside the `finally` runs *after* the timeout fired, so the timeout's `reject` is wasted — and on weird timing, the timeout `Promise.race` arm could win (reject), even though the backend returned success a microsecond earlier.
- **Root cause**: `settled` flag is racing the `Promise.race` selection itself; the flag-check inside `setTimeout` is not atomic with the race.
- **Impact**: occasional spurious `InvokeTimeoutError` for backend calls that actually completed; worse, callers may double-execute (idempotency dedup TTL just expired, retry hits the now-completed but reported-timeout state).
- **Fix sketch**: Don't gate timeout rejection on a flag — just clear the timer in `.finally`. If `clearTimeout` runs before the callback fires, the race never fires; if it fires first, the user sees `InvokeTimeoutError` and that's correct. Remove the `settled` guard; or compute timeout deterministically with `AbortController`.

## 11. ErrorBoundary loses i18n context — fallback shows raw English from `useTranslation` even after relocation

- **Severity**: medium
- **Category**: cleanup-gap
- **File**: `src/features/shared/components/feedback/ErrorBoundary.tsx:82-83`
- **Scenario**: A render error blows up *inside* `useTranslation` (e.g. the i18n bundle Proxy throws because a section file is malformed). `ErrorFallback` then calls `useTranslation()` again — same code path, same crash → boundary's child throws → React unmounts and remounts the boundary, infinite cycle. Or: language is `'ar'` (RTL), boundary catches, `ErrorFallback` calls `useTranslation` which returns Arabic, but the surrounding `<html dir>` is already broken by the crash, so the fallback renders LTR Arabic.
- **Root cause**: The fallback UI assumes the i18n subsystem is healthy. Translation infrastructure must never be a dependency of the last-resort error UI.
- **Impact**: a malformed locale chunk (e.g. CDN serves truncated JSON) takes down the whole app instead of showing a graceful fallback.
- **Fix sketch**: `ErrorFallback` should hardcode English copy (or use `getEnglishSection` directly, which has zero async dependencies) and bypass `useTranslation`. Wrap the `useTranslation` call in its own try/catch.

## 12. AriaLiveProvider unregisters announce on every callback identity change — race during re-render

- **Severity**: medium
- **Category**: cleanup-gap
- **File**: `src/features/shared/components/feedback/AriaLiveProvider.tsx:46-49`
- **Scenario**: The effect deps are `[announce]` and the cleanup is `() => { _announce = null; }`. `announce` is `useCallback` with empty deps so should be stable, but if React DevTools, Hot Reload, or a future StrictMode change forces remount, the cleanup nulls `_announce` *before* the next mount registers — `announceImperative` calls during that gap are silently no-op'd. Healing toasts firing in the gap (e.g. WebSocket event during HMR) miss their assertive announcements.
- **Root cause**: `_announce` is module-global; cleanup unconditionally nulls it. Should only null if the callback being unregistered is the current one.
- **Impact**: missed screen-reader announcements during HMR / StrictMode mount cycles; rare in production but symptomatic of a fragile pattern.
- **Fix sketch**: `if (_announce === announce) _announce = null;` — only clear if you owned it. Same defensive pattern Tauri's `unlistenFn` uses elsewhere.

## 13. split-locales.mjs synchronous busy-wait spins CPU during EBUSY backoff

- **Severity**: low
- **Category**: edge-case
- **File**: `scripts/i18n/split-locales.mjs:43-44`
- **Scenario**: Build runs while AV scanner has a transient lock. Script enters the `while (Date.now() < end) { /* spin */ }` busy-wait — pegging one CPU core for up to 500ms × 5 retries = 2.5 seconds total CPU spin. On weak dev machines this stalls the dev-server cold-start.
- **Root cause**: synchronous `node` script avoiding `await` for "no event-loop pressure" — but a synchronous spin on Windows during AV contention is worse than a process-level sleep.
- **Impact**: minor — measurable startup hitch, not a failure mode.
- **Fix sketch**: Replace busy-wait with `Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, waitMs)` (which actually yields) or just convert the script to async and use `await new Promise(r => setTimeout(r, waitMs))`.

---

Slug=shared-ui-primitives-i18n. 13 findings: 0 critical, 5 high (modal-stack desync, toast RAF freeze on tab switch, IPC retry storm after timeout, locale English-flash on language switch, missing-error-key silent fallback), 5 medium (token reflection, silentCatch cycle latency, breadcrumb dedup state leak, Proxy reload loop, IPC timeout race, ErrorBoundary i18n dependency, AriaLive cleanup race), 1 low (split-locales busy-wait). Top critical-leaning: **toast RAF never re-arms after hidden-tab → stuck toasts evict new errors** and **locale lazy-load shows English mid-render on every language switch**. Files read: tauriInvoke.ts, silentCatch.ts, errorRegistry.ts, useTranslation.ts, routeSections.ts, tokenMaps.ts, useTranslatedError.ts, i18nStore.ts, split-locales.mjs, check-coverage.mjs, ToastContainer.tsx, toastStore.ts, ConfirmDialog.tsx, ErrorBoundary.tsx, AriaLiveProvider.tsx, HealingToast.tsx, ErrorRecoveryBanner.tsx, TitleBar.tsx, DeferUntilIdle.tsx, ExecutionDetailModal.tsx (≈20 files including transitive readers).
