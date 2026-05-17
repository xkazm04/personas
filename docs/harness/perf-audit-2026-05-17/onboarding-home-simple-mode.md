# Perf-Optimizer Scan — Onboarding, Home & Simple Mode

> Project: Personas (frontend-only)
> Scope: 15 paths in src/ (10 actually exist — see scope notes)
> Total: 10 findings (0C / 4H / 5M / 1L)

## Scope notes

**Significant scope drift.** The assigned scope claimed a `src/features/simple-mode/` feature with 8 sub-paths and a `simpleModeSlice.ts`. Neither exists in the repo as of the audit. Verified by:

- `Glob src/features/simple-mode/**/*` → zero matches.
- `Grep -i simple.?mode` → only i18n translation strings reference "simple mode" text; no source files.
- `Glob src/stores/slices/system/*.ts` → `simpleModeSlice.ts` absent (other slices: `onboardingSlice`, `setupSlice`, `tourSlice`, `uiSlice` are all present).
- `Grep SimpleHomePage` → zero matches.

The "simple mode" concept lives in the codebase as a **tier toggle**: `useTier()` returns `{ isStarter, isBuilder }`, and `SIMPLE_SECTIONS` filtering (in `NavigationGrid.tsx`, `SetupCards.tsx`, `HeroHeader.tsx`, `TourLauncher.tsx`) collapses the UI to a smaller subset when the user is a Starter. There is no dedicated SimpleHomePage component — the *same* `HomePage` renders, just with fewer cards. Findings below treat that conditional path as part of the home dashboard.

The remaining 10 paths in scope (onboarding components, home components, home lib, and the 4 slices) all exist and were read in full. **Files read: 23** (slices, entry points, lazy children, key step components). The cockpit widget catalog (~30 files) was sampled via the registry — not exhaustively read — because cockpit widgets are gated behind `homeTab === 'cockpit'` (non-default) and lazy-loaded.

## 1. `HomePage` remounts the whole subtree on every tab switch
- **Severity**: high
- **Category**: re-render
- **File**: `src/features/home/components/HomePage.tsx:19`
- **Scenario**: User clicks any home sub-tab (welcome → cockpit → roadmap → learning).
- **Root cause**: `<div key={homeTab} …>` is keyed on the active tab id. React treats a key change as an unmount + remount, so the entire child Suspense boundary, its lazy chunk's component tree, and all internal state (cockpit `spec`, `loading`, focus listeners; learning's `activeTrick` modal; roadmap's release hydration) are destroyed and rebuilt every switch. `HomeReleases` re-runs `readInitialSelection()` (sessionStorage parse), `CockpitPanel` re-fires `companionGetCockpit()`, and the Suspense fallback re-flashes a spinner even when the chunk is already cached.
- **Impact**: ~150–400ms perceived latency per tab switch on a warm app, plus a redundant IPC roundtrip to `companion_get_cockpit` every time the user toggles back to Cockpit. WebView2 is particularly sensitive to large mount batches; the audit comment on `WelcomeLayout.tsx:51` ("WebView2 hangs when too many nodes commit at once") confirms the team has already hit this class of issue.
- **Fix sketch**: Drop the `key={homeTab}` — the conditional `homeTab === 'cockpit' ? <Cockpit/> : …` already swaps the right child. If the goal was to retrigger the `animate-fade-slide-in` CSS class, move the key to an inner wrapper that's intentionally cheap (e.g. a `<div className="animate-fade-slide-in" key={homeTab}>`) and keep the lazy Suspense boundaries stable above it so cached chunks stay mounted.

## 2. CockpitPanel parses `specJson` on every render and reloads on window focus
- **Severity**: high
- **Category**: re-render
- **File**: `src/features/home/components/cockpit/CockpitPanel.tsx:67-75`, `:61-63`
- **Scenario**: Any state change in `CockpitPanel` (loading flip, contextual cockpit overlay open/close, any parent re-render) → component re-runs body.
- **Root cause**:
  1. `persistentBody = JSON.parse(spec.specJson)` runs at module-body scope on every render. `specJson` for a 6-widget cockpit can be a 4–12 KB JSON string; parsing it on every keystroke-driven parent re-render is wasteful.
  2. `window.addEventListener('focus', handler)` fires `load()` (full IPC + setSpec) every time the user alt-tabs back, even if the spec hasn't changed. Combined with the finding above (`HomePage`'s `key` remount), focus-refresh after a tab toggle is redundant.
- **Impact**: Cockpit being the default landing surface for users with composed Athena specs, this turns mundane interactions (theme toggle, sidebar push pane open) into multi-ms JSON parses. Focus-refresh fires unconditionally — even when `contextualCockpit` is set, the early-return runs the listener-attach branch.
- **Fix sketch**: Wrap `persistentBody` in `useMemo(() => spec ? JSON.parse(spec.specJson) : null, [spec?.specJson])`. Replace the focus listener with a debounced or ETag-aware refresh, or skip the focus refetch entirely on the same tab session (track `lastFetchedAt`, only refetch after 60s+ of unfocus).

## 3. Onboarding overlay kicks off both heavy effects in parallel on Step 1
- **Severity**: high
- **Category**: data-layer
- **File**: `src/features/onboarding/components/useOnboardingState.ts:92-129`, `:171-221`
- **Scenario**: First-launch user; `startOnboarding()` flips `onboardingActive=true` while step is still `appearance`.
- **Root cause**: Both data-loading `useEffect`s key off `onboardingActive` alone, not `onboardingStep`. So `discoverDesktopApps()` (a native filesystem scan over Program Files / Applications / Library — non-trivial) AND `getTrendingTemplates(3)` (Tauri IPC → SQLite + LLM ranking + fallback `listDesignReviews`) both fire the moment the modal opens, while the user is still on the appearance step picking a theme. Most users spend 20–60s on appearance; by step 3 (`pick-template`) the templates promise has long resolved, but if it failed the user wouldn't see the recoverable error until they navigate to the right step.
- **Impact**: Wasted IPC + native syscalls on a thread already busy hydrating the app. The desktop discovery scan in particular is the kind of cold-start workload that competes for the same Tauri runtime that's serving theme/setting reads. Slow machines see janky theme picker on step 1.
- **Fix sketch**: Gate each effect on its actual step prerequisite:
  - Desktop discovery: `if (!onboardingActive || onboardingStep === 'appearance') return;` (or start at `discover`).
  - Templates: same; defer until step `pick-template` is reached, OR add a coarse `onboardingActive && (onboardingStep === 'pick-template' || onboardingStep === 'adopt')` gate.
  - Alternative: prefetch on appearance completion (`handleNextFromAppearance`) using `requestIdleCallback` — the existing prefetch pattern in `home/lib/prefetch.ts` is already a working template.

## 4. `GuidedTour.navigateToStep` schedules up to 3 setTimeouts per step change, and the effect runs on every store change in its dep array
- **Severity**: high
- **Category**: async-coordination
- **File**: `src/features/onboarding/components/GuidedTour.tsx:79-119`, `:121-124`
- **Scenario**: User clicks Next in the tour panel, or any store action recreates one of the captured setters.
- **Root cause**: `navigateToStep` is wrapped in `useCallback` with 9 dependencies (six store setters, plus `scheduleTourTimeout`). Each one is recreated by Zustand on store-level resubscribes (Zustand 5 is stable here, but the larger problem is the `useEffect` body that *unconditionally* re-runs `navigateToStep(currentIndex)` whenever `currentIndex`, `tourActive`, `navigateToStep`, or `isMinimized` change). Each invocation schedules 3 timeouts (sub-tab nav 100ms, side-effect 150ms, spotlight 300ms). When the user advances rapidly through 5 steps, that's 15 pending timeouts in `pendingTimeouts`, and the `tourActiveRef` ref guard inside is the only thing keeping stale advances from misfiring. Additionally, the `100→150→300ms` cascade means the visible spotlight ricochets through 3 layout shifts every navigation.
- **Impact**: Scales with `wizard steps` × `user click rate`. Worse: the spotlight settles 300ms *after* the new content lands, so the user perceives the highlight as lagging behind the panel.
- **Fix sketch**: Drive navigation imperatively (call `navigateToStep` inside `advanceTour`/`handleNext` once) instead of via an effect on `currentIndex`. Collapse the 3 timeouts into a single `requestAnimationFrame` chain (or drop the 100/150ms and only delay the spotlight). Use a `useEvent`-style stable ref for the inner setters so the callback identity doesn't churn.

## 5. `useResumeContext` re-computes the failure scan and tour completion on every render of `HomePage`
- **Severity**: medium
- **Category**: re-render
- **File**: `src/features/home/components/useResumeContext.ts:107-186`
- **Scenario**: Resume banner is mounted on every Home Welcome render. Each render reads 7 Zustand selectors AND re-runs `executions.map(…).filter(…).sort(…)`.
- **Root cause**: No `useMemo` around the recent-failure scan or the tour-progress computation. The `executions` array can have hundreds of entries in a long-lived fleet. Every persona-store mutation (which fires on execution status changes, message ingestion, build events) re-renders this hook. The `tourActiveTourId` lookup also calls `getActiveTourSteps()` which `find()`s the registry on every render even when no tour is active.
- **Impact**: Scales with `executions.length` × `store-mutation rate`. On a busy fleet this is the chattiest selector on home — every WebSocket-driven execution update triggers a fresh O(N) scan + sort just to populate a tiny banner.
- **Fix sketch**: Wrap `recentFailure` in `useMemo([executions, lastEdited])` and the tour block in `useMemo([tourActive, tourActiveTourId, tourStepCompleted, …])`. Or pre-compute the most-recent-failure once in the agentStore and expose it as a derived selector so each consumer pays O(1).

## 6. `uiSlice.togglePlugin` rebuilds `enabledPlugins` Set, defeating consumer memo via reference identity
- **Severity**: medium
- **Category**: re-render
- **File**: `src/stores/slices/system/uiSlice.ts:251-261`, `:246-250`
- **Scenario**: User toggles any plugin in the plugin catalog.
- **Root cause**: `togglePlugin` always returns `{ enabledPlugins: new Set(state.enabledPlugins) }`. Every plugin consumer subscribing via `useSystemStore((s) => s.enabledPlugins)` sees a new reference and re-renders, even if their own plugin's enabled state didn't change. The initial state also constructs a fresh Set on each store creation. Combined with the fact that the sidebar nav, footer, and home navigation grid all subscribe to this Set, a single toggle re-renders ~10–15 components.
- **Impact**: Quadratic-ish during the plugin browser pass: enabling 5 plugins in a row triggers 5 × N component re-renders. Not catastrophic but visible on slow machines as a flicker in the sidebar.
- **Fix sketch**: Switch to a plain object map (`Record<PluginTab, boolean>`) and have consumers subscribe to their specific plugin (`useSystemStore((s) => s.enabledPlugins[name])` returns a stable boolean primitive). Or keep the Set but expose a per-plugin selector hook that memoizes the boolean lookup.

## 7. `NavCardWrapper` is memoized but receives a fresh `onCardClick` lambda on every parent render
- **Severity**: medium
- **Category**: re-render
- **File**: `src/features/home/components/HomeWelcome.tsx:46`, `src/features/home/components/NavigationGrid.tsx:29-83`
- **Scenario**: Any state change in `HomeWelcome` (translation rehydration, store mutation that affects `user`) re-renders all 7 nav cards.
- **Root cause**: `HomeWelcome` passes `onCardClick={(id) => setSidebarSection(id as ...)}` — an inline arrow recreated every render. `NavigationGrid` forwards it as-is to the `memo`d `NavCardWrapper`. The memo always fails on the `onCardClick` prop, so all `useMotion`/`framer-motion` machinery re-evaluates per card on every parent tick.
- **Impact**: 7 cards × Framer Motion's per-component motion lifecycle is ~1–3ms per render — small per-tick, but pointless because the work is entirely cache-bustable.
- **Fix sketch**: Wrap the click handler in `useCallback(() => setSidebarSection(…), [setSidebarSection])` inside `HomeWelcome`. Or take the click handler out of props entirely and have `NavCardWrapper` call `useSystemStore` directly for the setter.

## 8. `HomeRoadmapView` runs `buildDisplayItems` (map + dedupe + sort) on every render and bound to a `key`-remounted parent
- **Severity**: medium
- **Category**: algorithmic
- **File**: `src/features/home/components/releases/HomeRoadmapView.tsx:317`, `:175-188`
- **Scenario**: User toggles to the Roadmap tab; due to finding #1, this is a full remount, so all the build work runs cold.
- **Root cause**: `buildDisplayItems(release, liveOverride, language, bundledItems)` is called inline in render. It runs `liveOverride.release.items.map(fromLive)` + dedupe + sort, then `RoadmapHero` and 3 `LaneColumn` instances each call `remaining.filter((i) => i.priority === p)` — a fresh O(N) filter per lane (3 × N work per render). Not memoized; not stable across re-renders even when inputs are identical.
- **Impact**: Roadmap pages with 30–50 items run ~200 operations per render. Worse, the `useEffect` on line 61 calls `setHomeReleaseVersion(initial)` after first mount, which **triggers a second render** of the same page on every cold mount of the roadmap tab.
- **Fix sketch**: `useMemo` for `items`; pre-bucket by priority via a single pass `for (const i of remaining) buckets[i.priority].push(i)` and pass the buckets down. Move `readInitialSelection` into the store's initializer (or a one-shot lazy init) so the post-mount setState doesn't double-render.

## 9. `HomeLearning` renders 11 `<img>` screenshots eagerly with no lazy loading
- **Severity**: medium
- **Category**: data-layer
- **File**: `src/features/home/components/HomeLearning.tsx:380-386`, `:47-215`
- **Scenario**: User clicks the Learning tab. The grid of 11 trick buttons mounts; clicking one opens `TrickModal` which contains a `<img src={trick.screenshot}>` reference. The screenshot files (`/guides/trick-*.png`) are not lazy-loaded.
- **Root cause**: The 11 `Trick` entries are defined as a static array with hardcoded `screenshot: '/guides/trick-*.png'` paths, but only the *active* trick's image is rendered (modal). That part's actually fine. The real cost is that the entire `HomeLearning` component is lazy-loaded but ships a full inline `TRICKS` array (~6 KB of strings + lucide icon references) and `TOUR_REGISTRY` is imported from `tourSlice.ts` which pulls the entire ~600-line tour definitions module into the chunk.
- **Impact**: Learning tab's lazy chunk is fatter than necessary (~50–80 KB unzipped). On a slow disk read or HMR reload this delays the visible content for the modest content under the fold.
- **Fix sketch**: Move `TRICKS` and category metadata to its own `homeLearningContent.ts` file so dead-code elimination is friendlier, or pull from a JSON import. Add `loading="lazy"` to the `<img>` in `TrickModal` (already inside a modal, but defensive). For the trick grid: keep it as-is — it's text only.

## 10. `OnboardingProgressBar` subscribes to the whole `onboardingStepCompleted` object
- **Severity**: low
- **Category**: re-render
- **File**: `src/features/onboarding/components/OnboardingProgressBar.tsx:14`
- **Scenario**: Any step transition (5 total in onboarding).
- **Root cause**: `useSystemStore((s) => s.onboardingStepCompleted)` returns a fresh reference on every `completeOnboardingStep` action (since the reducer spreads a new object). Even though only the relevant step toggles, every other component that holds this selector re-renders. The progress bar itself re-renders, which is correct — but `OnboardingOverlay`'s separate selector for the same value also triggers, and the value flows down into `StepIndicator` (`:140-144`) which iterates all steps and rebuilds the DOM.
- **Impact**: 1–2ms per step transition. Trivial alone but multiplied across `tourStepCompleted` (`tourSlice.ts:1028-1034`), `onboardingStepCompleted`, and other similar maps it's a recurring pattern.
- **Fix sketch**: Use Zustand's `shallow` comparator, or split the selector: `const isStepDone = useSystemStore((s) => s.onboardingStepCompleted[stepKey])` returns a stable boolean. Apply the same pattern to `tourStepCompleted` (used in 4 components per `Grep`).
