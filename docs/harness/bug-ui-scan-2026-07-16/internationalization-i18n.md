# Internationalization (i18n) — bug-hunter + ui-perfectionist scan

> Total: 5 (Critical: 0, High: 1, Medium: 3, Low: 1)

## 1. `oauth_timeout` rule is unreachable — generic `'timed out'` shadows it, so OAuth-timeout users get the wrong guidance
- **Severity**: High
- **Category**: bug
- **File**: src/i18n/useTranslatedError.ts:68 (vs. :72); mirrored in src/lib/errors/errorRegistry.ts:71 (vs. :105)
- **Scenario**: A user starts an OAuth connect flow, leaves the consent window open too long, and the backend returns "OAuth authorization timed out". `resolveErrorTranslated` iterates ERROR_KEY_MAP in order; `{ match: 'timed out' }` at index 1 matches via `raw.includes(...)` before the specific `{ match: 'OAuth authorization timed out' }` at index 6 is ever reached.
- **Root cause**: The file's own rule ("most specific patterns first") is violated for this pair — substring matching with a generic prefix rule placed above its specific superset. The comment says the ordering "mirrors errorRegistry.ts", and it does — errorRegistry.ts has the identical dead rule, so the English fallback chain can't rescue it either.
- **Impact**: The user sees "The request took too long to complete / Try again — check your connection" (category `recoverable`) instead of "The authorization window was open too long / Try connecting again and complete the sign-in promptly" (category `user_action`). Wrong mental model (blames network), wrong category for any toast styling/retry affordance keyed off it, and the Sentry breadcrumb is tagged `timed_out` so operators can't distinguish OAuth abandonment from network timeouts. The `oauth_timeout` i18n keys in all 14 locales are dead weight.
- **Fix sketch**: Move the `oauth_timeout` entry above the generic `timed_out` entry in both ERROR_KEY_MAP and errorRegistry's ERROR_RULES; add a unit test asserting `resolveErrorTranslated(t, 'OAuth authorization timed out').category === 'user_action'`. Consider a test that no rule's string match is a substring of a later rule's match.

## 2. Stable `t` identity across section-load broadcasts leaves `React.memo`/`useMemo` consumers stuck on English after the locale chunk resolves
- **Severity**: Medium
- **Category**: bug
- **File**: src/i18n/useTranslation.ts:355-368 (with bundleCache proxy at :233-263)
- **Scenario**: User on language `de` navigates to the Personas route. The `agents` section chunk hasn't loaded, so the proxy resolves English. The chunk resolves 200ms later: `bundleVersion++` fires listeners, the parent re-renders — but `getBundle('de')` returns the *same cached proxy*, so the `useMemo` deps `[bundle, language]` are unchanged and `t` keeps its identity. Any child wrapped in `React.memo` that receives `t` (or an object derived from it under `useMemo([t])`) sees identical props and skips its render.
- **Root cause**: The hook deliberately keeps `t` referentially stable per language (the JSDoc even recommends passing `t` into `React.memo`/context), but the re-render signal after an async section load is carried *only* by `bundleVersion` — which is not part of the returned value's identity. The two design goals (stable identity, lazy content mutation behind a proxy) contradict each other for memoized consumers.
- **Impact**: Memoized subtrees render the English fallback and never flip to the loaded locale until some unrelated prop changes — persistent mixed-language UI after every language switch or first route visit in a non-English locale.
- **Fix sketch**: Include the broadcast in the identity: `const version = useSyncExternalStore(subscribe, getSnapshot)` and add `version` to the `useMemo` deps (return a fresh wrapper object whose `t` is the same proxy). Memoized children then re-render exactly once per section arrival, which is the intended cost.

## 3. A section chunk that fails once (plus one fixed 1s retry) silently pins the route to English for the rest of the session
- **Severity**: Medium
- **Category**: bug
- **File**: src/i18n/useTranslation.ts:93-122, :346-348
- **Scenario**: User on `ja` opens the Events route during a brief network blip (Tauri dev-server hiccup or webview cache eviction of the lazy chunk). Both the initial `loader()` and the single 1s retry reject. The `.catch` only writes a log entry; nothing is cached, no listener broadcast fires, and the `useEffect` in `useTranslation` won't re-run `preloadSections` until `language` or `routeSections` changes.
- **Root cause**: Failure handling assumes the next preload attempt will come "soon" via navigation, but the preload trigger is edge-triggered (effect on route/language change), not level-triggered. There is exactly one retry, after a fixed 1s — if the outage lasts >1s, the section is dead for the session on that route.
- **Impact**: Silent failure: the whole route renders in English while the rest of the app is in the user's language, with no toast, no retry affordance, and in production not even a console warning (logger only). The user has no path to recover other than navigating away and back — which they won't know to do.
- **Fix sketch**: On final failure, record the key in a `failedSections` set and bump `bundleVersion` so the UI can know; retry with backoff on the next `preloadSections` call for that key (currently `loadingPromises` cleanup allows this, but nothing triggers the call). Cheapest robust fix: in the failure `.catch`, schedule one more re-attempt on `window` `online` event or after 30s.

## 4. Language switch has no pending state — the UI flashes a mixed-language blend with zero transition affordance
- **Severity**: Medium
- **Category**: ui
- **File**: src/i18n/useTranslation.ts:334-369 (hook returns no loading signal); src/i18n/routeSections.ts:6-36
- **Scenario**: User on the Overview route switches from English to Chinese. `common`/`sidebar` chunks for `zh` may already be cached (hover prefetch), but `overview`, `director`, `execution`, etc. arrive over the next few hundred ms, each landing in a separate `bundleVersion` broadcast. The screen repaints piecemeal: chrome in Chinese, panel headings in English, then panels flipping one-by-one — plus a CJK font swap on top (fontReady is handled elsewhere).
- **Root cause**: `useTranslation` exposes only `{ t, language, tx }`. There is no `isReady`/`pendingSections` signal, so no component — not even the language switcher itself — can render a spinner, hold the switch until `preloadSectionsAsync` resolves, or fade the transition. The fallback-to-English design guarantees no blank screen, but nothing owns the *visual* transition.
- **Impact**: Every language switch in a 14-locale product shows a janky multi-step mixed-language repaint; on slow disks/networks it can persist for seconds and reads as a bug ("half my app didn't translate"). This is the flagship-visible surface of the i18n system.
- **Fix sketch**: Expose readiness: e.g. `const ready = routeSections.every(s => getCachedSection(lang, s) !== undefined || lang === 'en')` returned from the hook, and have the language switcher await `preloadSectionsAsync(nextLang, sectionsForRoute(current))` (already exported, currently unused by any switch path) before committing the store change — switch becomes atomic with a brief spinner on the switcher only.

## 5. tokenMaps.ts documents a `useTokenLabel()` hook that does not exist, and its usage example throws if followed
- **Severity**: Low
- **Category**: bug
- **File**: src/i18n/tokenMaps.ts:53-61 (docstring and `export { tokenLabel as tToken }`)
- **Scenario**: A developer follows the file's own example: `const { tToken } = useTokenLabel(); tToken('execution', row.status)`. `useTokenLabel` is not exported anywhere (import fails); if they instead import the real `tToken` and call it with the documented two arguments, `t` binds to the string `'execution'`, so `t.status_tokens` is `undefined` and `t.status_tokens[category]` throws `TypeError: Cannot read properties of undefined` — a render crash in whatever component adopted the pattern.
- **Root cause**: `tToken` was re-pointed at the raw three-argument `tokenLabel` (no bound-to-language hook was ever written), but the docstring advertising the hook + two-arg call shape was left behind. The header example block (:19-21) also mixes shapes (`const { t } = useTranslation();` then calls `tokenLabel(t, ...)` correctly, while the lower block shows the phantom hook).
- **Impact**: Copy-paste of in-file documentation produces either a compile failure or a runtime render crash; today's 10+ call sites all use the three-arg form, so this is a loaded trap rather than a live fault — but in a file that is the designated pattern reference for the token contract.
- **Fix sketch**: Either implement the hook (`export function useTokenLabel() { const { t } = useTranslation(); return { tToken: (c, tok) => tokenLabel(t, c, tok) }; }`) or fix the docstring to show the real three-arg call and drop the `tToken` alias. Add a first-line guard in `tokenLabel` (`if (!t || typeof t !== 'object')`) so misuse degrades to the raw token instead of crashing.
