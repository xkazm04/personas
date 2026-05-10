# Bug Hunt — Home & Simple Mode

> Group: Templates, Onboarding & Home
> Files scanned: 7 (note: `SimpleModeRouter.tsx` does not exist; substituted closest peers `SimpleHomeShell.tsx`, `AmbientCockpit.tsx`, `InboxVariant.tsx`, `MosaicVariant.tsx` for context)
> Total: 1C / 4H / 5M / 2L = 12 findings

---

## 1. Ambient mode auto-rotation can flip surface mid-action when severity drops to zero between user keystrokes

- **Severity**: high
- **Category**: race-condition
- **File**: `src/features/simple-mode/components/AmbientCockpit.tsx:218-221`
- **Scenario**: User in ambient mode is interacting on the Inbox face. They press a button (counts as `pointerdown` → `setPaused(true)`, freezing `lastFaceRef.current = 'inbox'`). The action resolves the only critical item; `criticalCount`/`warningCount` both drop to 0. The user then moves the mouse but does not click again. After `INTERACTION_RESUME_MS` (30s) elapses since the LAST `pointerdown` (note: the resume timer key is `lastInteraction`, but the `pointerdown` listener only updates `lastInteraction` on a click, not on movement), `paused` flips to `false` and the very next render evaluates `if (!paused) lastFaceRef.current = desiredFace` → snaps to mosaic, yanking the user out of any open detail mid-read.
- **Root cause**: Pause-then-resume is computed against severity at resume time, not against severity at pause time, so resolving the very issue that triggered Inbox boots you off Inbox the moment the timer expires. There is no "stay on the face you paused on" grace.
- **Impact**: Read disrupted; if the user was about to use Esc to exit, they get a surprise face flip first. Especially bad on second-monitor ambient displays where mid-rotation is jarring.
- **Fix sketch**: When `paused` flips false, only adopt `desiredFace` if it differs from the current face by more than one render (e.g. require severity to be stable for `desiredFace !== face` for at least one tick). Or remember the face the user explicitly engaged with and stay there until severity rises again.

## 2. `pickHero` tiebreak compares `createdAt` against an empty string seed, so all-equal-severity inboxes always pick the first item even when its createdAt is empty

- **Severity**: medium
- **Category**: edge-case
- **File**: `src/features/simple-mode/components/variants/MosaicVariant.tsx:78-95`
- **Scenario**: Two info-severity items both have `createdAt = ''` (e.g. a synthesized inbox item where the timestamp wasn't populated — happens when persona row is missing per InboxList line 213). On the first iteration `rank > -1` is true, `best = item[0]`, `bestCreatedAt = ''`. On the second iteration `rank === bestRank && ''.localeCompare('') > 0` is false, so item[1] never wins — fine. BUT if item[0] has `createdAt = ''` and item[1] has `createdAt = '2026-05-10...'`, item[1] correctly wins. The trap is reversed: if item[0]'s createdAt is `'2026-05-10...'` and item[1]'s is empty (e.g. older fallback synthesized item), `''.localeCompare('2026-05-10') > 0` is false, item[0] stays — also fine. The actual bug is the comment says "useUnifiedInbox delivers items already sorted newest-first", relying on that for tiebreak; if any adapter ever emits items un-sorted (or with NaN-ish timestamps), the hero is non-deterministic across renders → pickHero re-runs in `useMemo` on every inbox identity change and can flip the hero behind the user's back.
- **Root cause**: Implicit dependency on upstream sort order is undocumented/un-asserted, and the localeCompare tiebreak is asymmetric to seed.
- **Impact**: User clicks "Review" on the hero; between mount and click, an unrelated severity-equal item bumps in and the hero swap routes their click to the wrong context. Subtle approval misroute.
- **Fix sketch**: Defensive secondary-sort by `id` after `createdAt` to make tie-break total. Or assert sorted invariant in dev with `console.warn`/Sentry breadcrumb if `items[i].createdAt > items[i-1].createdAt`.

## 3. SimpleHomeShell ambient-mode "enter" double-fires when window is already maximized AND user double-clicks the Maximize2 button

- **Severity**: high
- **Category**: double-fire
- **File**: `src/features/simple-mode/components/SimpleHomeShell.tsx:127-135` + `:43-55`
- **Scenario**: User rapidly clicks the Maximize2 (ambient pop-out) button twice. Each click invokes `void enterAmbientMode(setAmbient)`. Each promises does `setAmbient(true)` (idempotent for state), then dynamically imports `@tauri-apps/api/window` and calls `win.maximize()`. Two parallel imports compete; both call `getCurrentWindow()` and check `isMaximized()`. Order of resolution is non-deterministic. If the first call succeeds and maximizes, the second call sees `isMax === true` and skips — fine. But on Windows under Tauri, `win.maximize()` while maximized can toggle to "restore" depending on the Tauri version, leading to the user seeing the window unexpectedly restore size while ambient overlay also covers it.
- **Root cause**: No re-entrancy guard around the click handler; no debounce; no ref tracking in-flight maximize.
- **Impact**: User reports "ambient pop-out resized my window" — hard to repro because timing-dependent.
- **Fix sketch**: Disable the button while `setAmbientMode(true)` is pending, or short-circuit the second call with a `useRef<boolean>(false)` "ambient-entering" gate.

## 4. AmbientCockpit Esc handler unconditionally calls `history.replaceState` even when `window.location.hash !== '#ambient'`, racing the App router

- **Severity**: medium
- **Category**: silent-failure
- **File**: `src/features/simple-mode/components/AmbientCockpit.tsx:226-233`
- **Scenario**: Read carefully — the Esc handler does check `if (window.location.hash === '#ambient')` so this particular call is gated. BUT the `onExit` button handler at `:240-245` does the SAME guard, while the keyboard handler at line 229 ALSO calls `history.replaceState` always wrapped in the check. The bug is more subtle: when ambient was entered via the system store toggle (not via `#ambient` hash), the URL still contains some other hash like `#feature-flag-foo`. Esc currently leaves that hash alone — fine. But if the parent window also has a hash-based router or feature flag, the user's Esc keystroke does nothing visible to the URL, and any consumer who relied on `#ambient` being absent to mean "ambient off" still works. The real silent failure: `setAmbientMode(false)` is called BEFORE the hash check, so if the listener is somehow not attached (e.g. `ambientMode` was true on initial render, then app navigated away and re-rendered with stale listener — see #5), Esc fires `setAmbientMode(false)` once then nothing else.
- **Root cause**: Esc handler effect depends on `[ambientMode, setAmbientMode]`; on rapid toggle the new effect attaches before old one detaches → window briefly has two `keydown` listeners; one Esc keypress calls `setAmbientMode(false)` twice.
- **Impact**: State setters are idempotent so functionally harmless, but during a future migration to non-idempotent action (e.g. "decrement ambient session count") this duplication will silently double-charge.
- **Fix sketch**: Store the listener handle and detach precisely; or add a guard `if (!ambientMode) return` at the top of `onKey`.

## 5. AmbientCockpit hash-sync only fires once and silently desyncs from URL when user navigates back/forward

- **Severity**: high
- **Category**: mode-stale
- **File**: `src/features/simple-mode/components/AmbientCockpit.tsx:43-63`
- **Scenario**: User pops out a Tauri window with `#ambient` → ambient on. They navigate elsewhere (still in same window) clearing the hash. Then browser back-button restores `#ambient`. Effect at line 53 runs ONLY on first mount (`useEffect(..., [])`), so `ambientMode` stays at its current store value, NOT what the URL says. URL says "ambient" but UI says non-ambient — the user has to manually re-trigger.
- **Root cause**: Comment explicitly says "We deliberately do NOT depend on ambientMode — we only want this once" but ignores that hash can mutate without re-mounting AmbientCockpit. No `hashchange` listener.
- **Impact**: Linkable/bookmarkable ambient URLs don't survive in-app navigation; back/forward feels broken.
- **Fix sketch**: Add `window.addEventListener('hashchange', sync)` so URL is the source of truth on every change, or make ambient-mode purely store-driven and treat `#ambient` only as a boot hint.

## 6. `HomeRoadmapView.buildDisplayItems` re-runs on every render (no useMemo) and `dedupeById` emits a Sentry breadcrumb each time, flooding Sentry

- **Severity**: medium
- **Category**: silent-failure
- **File**: `src/features/home/components/releases/HomeRoadmapView.tsx:175-188` + `:157-173`
- **Scenario**: A live-roadmap payload contains one duplicate id. `dedupeById` calls `Sentry.addBreadcrumb({ level: 'warning', ... 'dropped duplicate id' })` every time the function runs. Function runs on every render of `HomeRoadmapView` (no memoization). If the parent re-renders 10×/sec during a fetch animation or live-pill refresh, that's 10 breadcrumbs/sec for the same content-author mistake.
- **Root cause**: Side-effect (Sentry breadcrumb) in pure transform that's called on every render.
- **Impact**: Sentry quota burn for a single content-author bug; the actual signal drowns in dupes.
- **Fix sketch**: Wrap `buildDisplayItems` in `useMemo([release, liveOverride, language, bundledItems])`. Or move the Sentry breadcrumb into a `useEffect` that fires once per unique payload.

## 7. `narrowStatus`/`narrowPriority` Sentry breadcrumbs fire on every render via the same uncached path

- **Severity**: medium
- **Category**: silent-failure
- **File**: `src/features/home/components/releases/HomeRoadmapView.tsx:84-114`
- **Scenario**: Same as #6 but per-unknown-value; one server-side `'archived'` status and the user sits on the page for 60s through 60 re-renders → 60 breadcrumbs.
- **Root cause**: No memoization barrier between live payload and the `fromLive`/`narrow*` calls.
- **Impact**: Sentry noise hides real schema drift signal.
- **Fix sketch**: Memoize as in #6, or hoist the narrowing into a layer that runs once per payload.

## 8. `useReleasesTranslation` returns a fresh object literal on every render, defeating downstream memoization and causing whole-tree re-render on any unrelated translation change

- **Severity**: high
- **Category**: silent-failure
- **File**: `src/features/home/components/releases/i18n/useReleasesTranslation.ts:44-140`
- **Scenario**: `HomeRoadmapView` (and `ReleaseDetailView`) call `useReleasesTranslation()` and pass `t` deep into `RoadmapHero`, `LaneCard`, etc. The hook builds a brand-new object on every call (no useMemo). Any state change in the parent (e.g. `liveRefreshing` toggling, ambient clock tick) re-renders the whole roadmap subtree because `t` reference identity changes. Worse: child components could legitimately memoize on `t`, but the memo is always invalidated.
- **Root cause**: Zero memoization. Comment says "no extra caching or casting" — that's the bug, not the goal.
- **Impact**: ~100 LaneCards re-rendering on every keystroke in a sibling component; perf regression and battery drain on always-on ambient displays.
- **Fix sketch**: Wrap the assembled `t` object in `useMemo(() => ({...}), [raw.releases.whats_new, language])`.

## 9. `releases['0.0.2'].items['10'..'20']` can collide with future bundled items if numeric ids are stringified inconsistently between releases.json and i18n

- **Severity**: medium
- **Category**: edge-case
- **File**: `src/features/home/components/releases/i18n/useReleasesTranslation.ts:104-124` + `ReleaseDetailView.tsx:35-42`
- **Scenario**: `releases.json` ships an item with `id: 10` (number) while the i18n object keys are all strings (`'10'`, `'11'`, ...). At lookup `items?.[itemId]` with `itemId = 10` (number), JS coerces to string `'10'` and works — but if `releases.json` contains `id: '10 '` (trailing whitespace from a manual edit) or the schema validator doesn't trim, lookup fails silently → user sees `[0.0.2.10 ]` placeholder.
- **Root cause**: No normalization or schema validation on item ids before lookup.
- **Impact**: Released changelog item shows debug placeholder in production for non-English users (where the i18n key path is the only source of the title).
- **Fix sketch**: `String(item.id).trim()` at lookup, plus a Zod check on releases.json that ids match `/^[a-z0-9_-]+$/`.

## 10. `simpleModeSlice` `activeSimpleTab` accepts only 'mosaic'|'console'|'inbox' but persistence layer can deliver any old persisted string after a build that adds/removes a tab

- **Severity**: critical
- **Category**: mode-stale
- **File**: `src/stores/slices/system/simpleModeSlice.ts:5-14` + `SimpleHomePage.tsx:32-41`
- **Scenario**: A future build removes the `'console'` tab. Existing user opens app; their persisted `activeSimpleTab` is `'console'`. `variantFor` switch has no `default` arm → returns `undefined`. `<Suspense fallback={null}>{undefined}</Suspense>` renders nothing — Cockpit page is BLANK. User has no recourse because the tab strip won't render an active state for an unknown tab and they may not realize their stored value is the problem.
- **Root cause**: No migration step in the persisted store; `variantFor` has exhaustive switch (TS-safe at compile time) but no runtime fallback for stale persisted values.
- **Impact**: Silent blank-screen wedge after upgrades; user thinks app is broken. Currently 3 tabs so not yet triggered, but the slice's persistence (note from the slice doc: "Survives Simple↔Power toggles and app reloads") guarantees this is a foot-gun.
- **Fix sketch**: Add a guard at the slice level (`setActiveSimpleTab` validates), and a `default: return <MosaicVariant />` arm in `variantFor`. Plus a Zustand `migrate` step that maps unknown values to `'mosaic'`.

## 11. HomePage uses `key={homeTab}` causing full remount/refetch every tab switch — ambient state in lazy-loaded subtrees gets torn down

- **Severity**: medium
- **Category**: cleanup-gap
- **File**: `src/features/home/components/HomePage.tsx:18-21`
- **Scenario**: User in `homeTab='cockpit'` triggers Cockpit lazy-load and does some interaction (e.g. selects an inbox item, types into notes). They click the "roadmap" Home sub-tab → `key={homeTab}` changes → React unmounts the Cockpit subtree entirely. They click back to "cockpit" → fresh mount → `useEffect` for image-preload re-runs, all in-flight `loadMosaic/loadConsole/loadInbox` promises that already resolved are re-invoked (cheap, but the side-effect of `new Image()` × 12 happens again). InboxVariant's `notes` state and `selectedId` are gone.
- **Root cause**: `key` reset is a sledgehammer for a problem (route transition animation) that could be solved with CSS or a parent transition wrapper.
- **Impact**: Lost edits on tab switch (notes typed in Inbox detail, ambient pause state). Hostile behavior the user can't predict.
- **Fix sketch**: Drop `key={homeTab}`; use an outer `AnimatePresence`-style wrapper if the entry animation is the goal.

## 12. ReleaseDetailView totalItems empty-state never localizes the missing release header copy when releaseI18n is undefined

- **Severity**: low
- **Category**: i18n-drift
- **File**: `src/features/home/components/releases/ReleaseDetailView.tsx:99-148`
- **Scenario**: Live-roadmap delivers a release with version `'0.0.3'` that ships before the desktop binary has the matching `releases.0_0_3_*` keys baked in. `releaseI18n = t.releases['0.0.3']` is `undefined`. `releaseLabel` falls back to the version string (`'0.0.3'`) — fine. `releaseSummary = ''` — fine, hidden by truthy check. But `getItemContent` falls back to `[0.0.3.{itemId}]` for every item. The user's locale is German, but the changelog reads in raw debug placeholder format — no German fallback to English copy. Per `ReleaseDetailView`'s comments the fallback is intentional, but it inverts the i18n golden rule (always-render-something-readable).
- **Root cause**: Hard-coded versioned objects in `useReleasesTranslation` cannot represent a forward-compat release.
- **Impact**: Changelog appears broken in non-English builds whenever live-roadmap pushes a new version ahead of the desktop binary.
- **Fix sketch**: Treat the live-roadmap `i18n` block as the i18n source for live-fetched releases instead of routing through `useReleasesTranslation`; or fall back to live-roadmap-supplied strings when versioned i18n is missing.
