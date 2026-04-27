# Bug Hunt — Onboarding & Home

> Total: 14 | Critical: 1 | High: 6 | Medium: 5 | Low: 2

## 1. ToastContainer onDismiss callback recreated every store update causes RAF tick to call dismiss for *previous* render's toast, after which `requestAnimationFrame` exits without rescheduling
- **Severity**: high
- **Category**: race-condition
- **File**: `src/features/shared/components/feedback/ToastContainer.tsx:59-87, 268-271`
- **Scenario**: A toast is showing. A new toast is added (or any unrelated store update happens). `useToastStore((s) => s.dismiss)` returns a stable reference, but `handleDismiss` is recreated on every parent render anyway because `useCallback` re-evaluates each render of `ToastContainer`. `StandardToastItem` then sees `onDismiss` change and tears down + restarts the RAF effect. `elapsedRef.current` is module-private to the item but `lastTickRef.current = Date.now()` resets — so the elapsed clock is reset every time any new toast arrives. A pinned-but-not-dismissed toast never auto-dismisses if new toasts keep coming.
- **Root cause**: The countdown timer mixes two tickers (elapsed wall clock + tick delta) and depends on `onDismiss` identity. Because the effect deps include `onDismiss`, the RAF restarts and the dismiss countdown effectively resets whenever the parent re-renders.
- **Impact**: Toasts under churn (many notifications) never auto-dismiss → toast stack grows to MAX_TOASTS, oldest toasts silently fall off via `slice(-MAX_TOASTS)`, important error info lost.
- **Fix sketch**: Memoize `handleDismiss` by store-stable ref OR drop `onDismiss` from the effect deps and read it via ref.

## 2. CommandPalette ⌘K toggle conflicts with native ⌘K in editable contexts and double-fires on Enter when input is in IME composition
- **Severity**: medium
- **Category**: edge-case
- **File**: `src/features/shared/components/overlays/CommandPalette.tsx:62-71, 302-321`
- **Scenario**: User typing CJK/Korean/Japanese in the palette input presses Enter to confirm IME composition — `handleKeyDown` immediately fires `executeItem` selecting the first result, navigating away mid-composition. Separately, ⌘K pressed while focus is in any other text input (e.g., NL composing in a textarea) toggles the palette and steals focus.
- **Root cause**: No `e.isComposing` / `e.nativeEvent.isComposing` guard on Enter; global ⌘K listener doesn't check if focused element is a text input or has a composition active.
- **Impact**: Asian-language users cannot use the palette reliably; ⌘K disrupts text composition in any textarea (e.g., the GoalStep textarea, DraftPromptTab editor).
- **Fix sketch**: `if (e.nativeEvent.isComposing || e.keyCode === 229) return;` for Enter; guard the ⌘K listener against `document.activeElement` being a contenteditable/input mid-composition.

## 3. TourSpotlight auto-dismisses entire tour when target temporarily detaches during animation/lazy mount
- **Severity**: high
- **Category**: cleanup-gap
- **File**: `src/features/onboarding/components/TourSpotlight.tsx:60-117`
- **Scenario**: User starts the getting-started tour. Tour navigates to "credentials-intro" which triggers a `storeBus.emit('tour:navigate-credential-view')` after 150 ms (`GuidedTour.tsx:94`). The credential view re-renders and momentarily unmounts the prior anchor element. The MutationObserver fires `handleReposition`, sees `currentTarget.isConnected === false`, and immediately calls `dismissTour()`.
- **Root cause**: Spotlight treats any disconnected target as fatal — no debounce, no retry window, no reconciliation when the same `data-testid` re-mounts elsewhere. Async navigation between steps creates exactly this transient disconnect.
- **Impact**: Tour dies on legitimate step transitions; user is dropped out of guided experience with no explanation. Repeat-launch via TourLauncher just hits the same wall.
- **Fix sketch**: On disconnect, debounce 300-500 ms re-querying for `[data-testid="${highlightTestId}"]` before invoking `dismissTour`. Only dismiss after sustained absence.

## 4. Releases sessionStorage selection survives release version retirement, throwing user into the orphaned tab on session start
- **Severity**: medium
- **Category**: edge-case
- **File**: `src/features/home/components/releases/HomeReleases.tsx:26-35, 39, 43`
- **Scenario**: User selects release "v2.4". Next app version retires v2.4 from `getNavReleases()` but `getReleaseByVersion('v2.4')` still returns it (data-only retirement). The sessionStorage value passes the truthy check on line 30; `selectedVersion` is set to "v2.4", but `selected` falls back to `getActiveRelease()` because the selected version isn't in nav. The nav bar shows nothing as selected, the body shows the active release — out of sync.
- **Root cause**: `readInitialSelection` validates against `getReleaseByVersion` (data-table check), but rendering relies on nav-list membership for visual selection. Two different sources of truth.
- **Impact**: Confusing UI state — selected pill appears unselected; switching tabs becomes inconsistent until user manually clicks something.
- **Fix sketch**: In `readInitialSelection`, validate against `getNavReleases().some(r => r.version === stored)` instead of `getReleaseByVersion`.

## 5. useLiveRoadmap leaves status='loading' forever if first refresh() is called while initial fetch is in-flight
- **Severity**: medium
- **Category**: race-condition
- **File**: `src/features/home/components/releases/useLiveRoadmap.ts:41-53`
- **Scenario**: User mounts the roadmap view. Initial `run(false)` is in flight. User mashes Refresh; `run(true)` is called concurrently. Initial completes first with `result === null` → `setStatus(prev => prev === 'loading' ? 'unavailable' : prev)`. Force completes second with `result === null` → same prev-check → status stays 'unavailable' (correct), but if force completes FIRST and writes 'unavailable', then initial completes with a real result, the initial sets status to 'fresh' → false success theater, with `setRefreshing(false)` racing in unknown order.
- **Root cause**: No request cancellation/serialization. Two concurrent in-flight fetches can write `setStatus`/`setRoadmap` in either order. Force-mode `setRefreshing(false)` runs unconditionally even if a non-force response landed in between.
- **Impact**: Refreshing button stuck spinning if force resolves before non-force; or stale "fresh" state when force returned cached fallback. Plus duplicate network calls on disk-cache misses.
- **Fix sketch**: Track an `inflightId` ref; ignore stale completions; queue refresh while loading.

## 6. ExecutionStep handleRun re-enables button by setting started=false on failure, but execution may have actually started — clicking Run twice double-executes the persona
- **Severity**: high
- **Category**: race-condition
- **File**: `src/features/onboarding/components/ExecutionStep.tsx:86-94`
- **Scenario**: User clicks "Run Agent". `executePersona` returns `null` because the API responded with a non-fatal error (e.g., backend throws after queueing). `setStarted(false)` resets the UI but the persona may already be queued/running. User clicks Run again → second execution fires.
- **Root cause**: `executePersona` returning null is treated as "didn't start", but null doesn't necessarily mean the side effect was rolled back. No idempotency token.
- **Impact**: Double-execution of first onboarding agent; in pathological case (rate-limited model, charged credits), this costs the user money during onboarding — terrible first impression.
- **Fix sketch**: Keep the button disabled with a "Retry available in 10s" cooldown after any handleRun call regardless of success/failure; require explicit user gesture to clear started.

## 7. ExecutionStep listener never registered if execution-complete fires before listener attaches
- **Severity**: high
- **Category**: race-condition
- **File**: `src/features/onboarding/components/ExecutionStep.tsx:39-84, 86-94`
- **Scenario**: User clicks Run. `executePersona` resolves with execId, which sets `activeExecutionId` in store. The useEffect listener for `'execution-complete'` runs only after React commits the next render and Tauri's `listen()` returns asynchronously. For very fast executions (cached/local model), the `execution-complete` event can fire before `listen()` has registered. UI hangs forever showing the spinner; the onboarding flow can't advance.
- **Root cause**: No replay buffer or "did the event already fire?" check. `useEffect` registers listener post-commit, several event-loop ticks after the execution is queued.
- **Impact**: First-run onboarding silently stalls on the very last step. User has no recourse but to dismiss and reopen — losing tour completion progress.
- **Fix sketch**: Register the listener BEFORE calling `executePersona` (e.g., via a ref that retains the unlisten and is set up in handleRun synchronously), or poll `activeExecutionId` status in store, or add a 30s safety timeout that surfaces a "still running, view in dashboard" affordance.

## 8. FirstUseConsentModal accept handler can persist consent without applying telemetry preference if onAccept throws
- **Severity**: medium
- **Category**: state-corruption
- **File**: `src/features/shared/components/overlays/FirstUseConsentModal.tsx:123-127`
- **Scenario**: `handleAccept` calls `persistConsent()` first, then `setTelemetryEnabled(telemetryChecked)`, then `onAccept()`. If `setTelemetryEnabled` throws (e.g., backend bridge unavailable mid-init), consent is now persisted to localStorage but the user-chosen telemetry value never applied — defaulting to whatever the prior session had. User believes they chose "no telemetry" but the system silently keeps telemetry on.
- **Root cause**: Consent persistence happens before the side effect that depends on the user's choice. No try/catch around the side effects.
- **Impact**: Privacy disclosure violation: user selected opt-out, system reports opt-in. For users in GDPR/CCPA contexts this is a real legal risk for a desktop app touting "local-first."
- **Fix sketch**: Apply telemetry FIRST, then `persistConsent()` only if telemetry write succeeded. Surface failure with a banner.

## 9. ConsentSection "color" prop tries inline style with `var(--color-${color})` but the color tokens don't exist for arbitrary names
- **Severity**: low
- **Category**: edge-case
- **File**: `src/features/shared/components/overlays/FirstUseConsentModal.tsx:71-73`
- **Scenario**: ConsentSection is invoked with colors like `'rose'`, `'orange'`, `'teal'`. The Tailwind dynamic class `border-${color}/25 bg-${color}/5` does not work in JIT mode (these classes are not produced unless safelisted). Inline `var(--color-${color}, fallback)` falls back to the fallback because `--color-rose` etc. aren't defined.
- **Root cause**: Dynamic Tailwind class composition + non-existent CSS custom properties.
- **Impact**: Open accordion borders all render the same fallback gray instead of color-coded; degrades perceived polish but not functional.
- **Fix sketch**: Map color name → static class string at the call site (lookup table); drop the inline `var()`.

## 10. TourLauncher startTour timeout fires after component unmount if user navigates fast
- **Severity**: low
- **Category**: cleanup-gap
- **File**: `src/features/onboarding/components/TourLauncher.tsx:58-66`
- **Scenario**: User clicks the tour launcher; `setTimeout(50ms)` is queued to call `startTour`. User immediately switches sidebar section — TourLauncher unmounts. The timeout fires and starts a tour anyway, but TourLauncher (which renders only when `!tourActive && !tourCompleted`) on the new page may not be the right surface for the tour anchor. Tour launches with no obvious origin.
- **Root cause**: `setTimeout` is fire-and-forget; no cleanup on unmount.
- **Impact**: Tour spotlight may pin to nothing on the new page, which (per finding #3) auto-dismisses, leaving the user thinking the tour is broken.
- **Fix sketch**: Replace setTimeout with direct call (the 50ms delay rationale is unclear), or store handle and clear in cleanup.

## 11. useOnboardingState desktop discovery effect doesn't refire when user navigates away and back (depends only on `onboardingActive`)
- **Severity**: medium
- **Category**: latent-failure
- **File**: `src/features/onboarding/components/useOnboardingState.ts:76-93`
- **Scenario**: User opens onboarding, scan completes (`isScanning=false`, empty `discoveredApps`), user installs Docker in another window, user dismisses onboarding (`onboardingActive=false`), then reopens via `resumeOnboarding` (`onboardingActive=true` again). The effect re-fires because the dep flipped — but cancellation only protects state, not the freshness assumption that user's environment may have changed.
- Wait — actually this DOES refire. The bug is different: when `onboardingActive` was already true and the user revisits the discover step (e.g., next button takes them away then back via setOnboardingStep), `discoveredApps` never re-scans. There's no manual rescan button.
- **Root cause**: No way to re-scan once initial scan completes within a session.
- **Impact**: User installs an app to enable a connector during onboarding (per the empty-state hint); cannot get the discover step to find it without dismissing+resuming.
- **Fix sketch**: Add a "Rescan" button that bumps a nonce, like templates already do (`templateReloadNonce` pattern at line 60).

## 12. HeroHeader `Math.random()` background selection inside useMemo with stable deps causes background to "stick" but reshuffles on theme/tier toggle, looking glitchy
- **Severity**: low
- **Category**: edge-case
- **File**: `src/features/home/components/HeroHeader.tsx:19-24`
- **Scenario**: User toggles theme in Appearance step (or anywhere) → `isDark` flips → useMemo re-runs → `Math.random()` picks a different background → user sees their hero illustration suddenly change identity, disconnected from the theme switch. Repeating the toggle reshuffles each time.
- **Root cause**: `Math.random()` is inside useMemo whose only intentional inputs are environmental (theme, tier). It's effectively a random function that re-rolls on every theme change.
- **Impact**: Surprising/janky UX, breaks the "this is *my* dashboard" feeling. Also blocks A/B testing or screenshot reproducibility.
- **Fix sketch**: Pick the random index once on first mount (`useState(() => Math.random())`) and reuse, OR seed by user id for stable per-user art.

## 13. WelcomeLayout below-fold gating via single rAF defers full content by 1 frame but never re-checks if rAF was cancelled before commit (e.g., during Suspense boundary)
- **Severity**: low
- **Category**: cleanup-gap
- **File**: `src/features/home/components/WelcomeLayout.tsx:43-47`
- **Scenario**: WelcomeLayout mounts inside Suspense fallback during route transition. rAF is queued. Suspense unmounts WelcomeLayout before the rAF fires (effect cleanup runs, cancels rAF). When Suspense resolves and re-mounts WelcomeLayout, a *new* rAF is queued. This works but for users with `prefers-reduced-motion`, the comment says "WebView2 renderer hangs when too many nodes commit at once" — yet motion-reduce variants throughout the file fully bypass the fade-slide-in. The split-mount strategy still applies even when there's no animation cost, which is fine. The actual bug: `showBelowFold` defaults to false on EVERY mount, causing a guaranteed 1-frame flash of empty welcome screen on every navigation back to home.
- **Root cause**: State is local to the component; remounting resets it.
- **Impact**: Visible flicker each time user navigates back to home from another tab.
- **Fix sketch**: Lift `showBelowFold` to a session-level cache or a global `hasMountedOnce` ref so subsequent mounts render fully on first commit.

## 14. ErrorBoundary's "Go Home" handler uses require() which Vite cannot resolve at runtime in production builds
- **Severity**: critical
- **Category**: silent-failure
- **File**: `src/features/shared/components/feedback/ErrorBoundary.tsx:85-97`
- **Scenario**: A render error occurs anywhere in the app. User clicks "Go to Dashboard". `require("@/stores/systemStore")` throws ReferenceError in the Vite-built bundle (no CommonJS `require` exists in browser ESM). Caught by try/catch → falls into the destructive branch: `window.location.hash = '#/'; window.location.reload();` — full page reload, losing all unsaved work, all in-memory state, all running executions, the entire onboarding draft. The "seamless UX" first-try path NEVER works in production builds.
- **Root cause**: `require()` is a Node/Webpack pattern. The eslint-disable comment shows the author knew it was unusual, but Vite bundles this as an unresolved global; there's no fallback shimming `require`.
- **Impact**: Catastrophic — every error boundary fall-through loses the user's session state. For an onboarding flow, this means the user's connector approvals, template selection, and adopted persona-in-progress all evaporate. For a Tauri app, this also means the entire WebView reloads, which can take a noticeable second.
- **Fix sketch**: Replace with a static ESM import at the top of the file: `import { useSystemStore } from "@/stores/systemStore"`. Removes the try/catch entirely.
