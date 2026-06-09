# Bug Hunter — onboarding-home-welcome
> Total: 6
> Severity: 1 critical, 3 high, 2 medium

## 1. "Skip step" on the final step silently marks the entire tour 100% complete (success theater)
- **Severity**: high
- **Category**: success-theater
- **File**: src/features/onboarding/components/GuidedTour.tsx:162-165, src/stores/slices/system/tourSlice.ts:1140-1154,1193-1206
- **Scenario**: A first-run user opens "Getting Started", reads each coach-mark, and clicks the de-emphasized "Skip step" button (`tour-btn-next`) on every step without ever changing a setting, connecting a credential, or building/running an agent. On the last step, `handleNext()` sees `allCompleted === false`, so it calls `advanceTour()`. `advanceTour` computes `nextIndex >= steps.length` and calls `finishTour()`, which unconditionally writes `tourStepCompleted = Object.fromEntries(steps.map(st => [st.id, true]))` and `tourCompletionMap[id] = true`.
- **Root cause**: `finishTour()` treats "reached the end of the step list" as "completed every step," conflating navigation position with task completion. Skip is a navigation action, but it feeds the same terminal path as genuine completion.
- **Impact**: UX degradation / corrupted progress signal. The Learning center (HomeLearning.tsx:105) and the completion celebration screen show the tour as fully done with green checkmarks even though the user did zero of the onboarding actions. `getNextTourId` then skips it forever, and `useResumeContext` will never resurface it. The user is told they "completed" onboarding they never performed.
- **Fix sketch**: Separate "advanced past the last step" from "finished all steps." `finishTour()` should persist the actual `tourStepCompleted` map (only the steps truly completed) and set `tourCompleted=true` only as a "closed" flag; `tourCompletionMap` should be derived from `steps.every(s => completed[s.id])` rather than force-set to true. Render the Learning/celebration "Done" badge off real completion, and show "X of N done" when the user skipped to the end.

## 2. TourLauncher progress count is computed across the wrong tour's step map (Starter/Power mismatch)
- **Severity**: medium
- **Category**: state-corruption
- **File**: src/features/onboarding/components/TourLauncher.tsx:25-29
- **Scenario**: A Starter-tier user has `tourActiveTourId === "getting-started"` (the slice default, tourSlice.ts:1010) but `useTier()` makes the launcher choose `tourId = "getting-started-simple"`. `steps` is taken from the *simple* tour (3 steps), while `completedCount = Object.values(tourStepCompleted).filter(Boolean).length` counts completions from whatever tour's `tourStepCompleted` is currently live in the store — which is the Power tour's map (up to 4 steps, with `first-execution` only present there).
- **Root cause**: `completedCount` is derived from the raw live `tourStepCompleted` object instead of `steps.filter(s => tourStepCompleted[s.id])`. The live map is not guaranteed to belong to the launcher's chosen `tourId`, and it counts step ids that don't exist in the displayed tour.
- **Impact**: UX degradation. The launcher can render "Resume 4/3" (completed > total) or show progress for steps the simple tour will never present, feeding a nonsensical `TourProgressArc` (arc fill > 1) and a misleading resume label.
- **Fix sketch**: Count membership-scoped completions: `steps.filter(s => tourStepCompleted[s.id]).length`, and only when `tourActiveTourId === tourId`; otherwise read that tour's persisted completion from `tourCompletionMap`/persisted state. Clamp `TourProgressArc` inputs to `[0, total]`.

## 3. Spotlight `tourHighlightMissing` desyncs on manual navigation away from a step — stale "not on screen" / no recovery
- **Severity**: high
- **Category**: state-corruption
- **File**: src/features/onboarding/components/GuidedTour.tsx:154-160, src/features/onboarding/components/TourSpotlight.tsx:31-48
- **Scenario**: During a tour the navigate effect only re-runs on changes to `[currentIndex, tourActive, isMinimized, tourResumePending]`. If the user (the tour runs alongside the live app, by design) clicks a different sidebar section or the step's target unmounts on a resize/route change, `currentIndex` is unchanged so `navigateToStep` never re-fires and never re-routes back. `TourSpotlight`'s tracker fires `onMissing` → `setHighlightMissing(true)`, and the "not on screen yet" banner (TourPanelBody.tsx:187-195) shows. The flag is only cleared when the highlight testid changes or a rect is found — neither happens while the user is parked on the wrong screen.
- **Root cause**: The tour assumes the route it set at step-entry is stable for the life of the step. There is no re-anchor path and no "take me back to this step" affordance when the user navigates away mid-step; the spotlight degrades but offers no recovery.
- **Impact**: UX degradation bordering on stuck. The spotlight cut-out disappears, the panel shows a permanent "off screen" warning, and the only escape is "Skip step" (which then triggers finding #1's false-complete). The "Show me" button is a no-op here because the target element isn't mounted (TourPanelBody.tsx:62-66 guards on `document.querySelector`).
- **Fix sketch**: When `tourHighlightMissing` is true, surface a "Return to this step" action in the panel that calls `navigateToStep(currentIndex)` (re-runs sidebar/sub-tab nav + re-arms the spotlight). Alternatively subscribe the navigate effect to `sidebarSection`/route so leaving the step's surface re-routes or at least re-evaluates the anchor.

## 4. ExecutionFactsWidget renders a forever-pulsing skeleton (never errors, never empties) when its execution id is absent or stale on first run
- **Severity**: medium
- **Category**: silent-failure
- **File**: src/features/home/sub_cockpit/widgets/ExecutionFactsWidget.tsx:19-35,53-58
- **Scenario**: Athena composes a cockpit with an `execution_facts` widget but the config lacks `executionId`/`personaId` (or references an execution that no longer exists / hasn't run yet on a first-run install). The effect early-returns `if (!executionId || !personaId) return;`, leaving `exec === null` and `error === null`, so the render falls into the `!exec` branch — six animated skeleton tiles that pulse indefinitely with no message and no resolution.
- **Root cause**: The component has three states (loading skeleton / error / data) but treats "we will never load because we have no id" identically to "loading in progress." Empty/first-run input is not modeled.
- **Impact**: UX degradation. A brand-new user (zero executions) sees a cockpit tile that looks perpetually busy. The error path also depends on `getExecution` rejecting; if it resolves `null` for a missing row, the same infinite skeleton results.
- **Fix sketch**: Add an explicit empty state: if `!executionId || !personaId`, render a "no execution selected yet" placeholder instead of the skeleton. Treat a resolved-but-null `getExecution` result as empty rather than leaving `exec` null forever.

## 5. CockpitPanel parses Athena's `specJson` and silently swallows malformed specs — empty grid with no diagnosis
- **Severity**: high
- **Category**: silent-failure
- **File**: src/features/home/sub_cockpit/CockpitPanel.tsx:98-105,159-171
- **Scenario**: A spec exists server-side (so `spec` is truthy and the empty-state CTA is bypassed) but `spec.specJson` is malformed or doesn't match `CompanionCockpitSpecBody` (LLM produced invalid/old-shaped JSON, or a truncated write). `JSON.parse` throws, is caught by `silentCatch`, leaving `persistentBody = null` → `widgets = []`. The render hits the final branch (`spec` is truthy, not loading) and maps over zero widgets: a blank 12-col grid with a header that still says "Composed by Athena — updated Xm ago."
- **Root cause**: A parse/shape failure is swallowed and indistinguishable from "Athena composed an empty cockpit." There's no parse-error state, and the truthy-`spec` guard suppresses the empty-state CTA that would otherwise let the user recover by re-asking Athena.
- **Impact**: UX degradation / dead end. The user sees an empty workspace labeled as freshly composed, with no error, no retry, and no path back to the "Talk to Athena" empty state — the live channel is silently broken.
- **Fix sketch**: Track a parse-success flag alongside `spec`. When `spec` exists but `persistentBody` is null (parse/validation failed) or `widgets.length === 0`, render an explicit "couldn't read this cockpit — recompose" state that routes to `composePersonaCockpit()`, rather than a blank grid under a healthy header.

## 6. Onboarding flow state is never persisted — a mid-flow reload re-prompts first-run from scratch (or re-shows after a partial finish)
- **Severity**: critical
- **Category**: state-corruption
- **File**: src/stores/slices/system/onboardingSlice.ts:89-110,141-158
- **Scenario**: The onboarding slice holds `onboardingActive`, `onboardingCompleted`, `onboardingStep`, `onboardingDismissedAtStep`, and the created-persona id purely in in-memory Zustand state with no persistence (contrast tourSlice.ts:855-913 which persists to localStorage with a probe). A first-run user who adopts a template, creates a persona, then reloads/restarts the desktop app (Tauri webview reload, crash, or update) loses all of it: `onboardingCompleted` resets to `false` and `onboardingDismissedAtStep` to `null`. Whether onboarding re-launches depends entirely on the cold-start trigger re-evaluating `startOnboarding()`'s guard `onboardingCompleted || personas.length > 0` (onboardingSlice.ts:100) — and `resumeOnboarding()` (line 112-121) can never fire because the dismissed-step marker is gone.
- **Root cause**: First-run completion is treated as ephemeral session state. The design assumes the process never restarts mid-onboarding, so "have we onboarded this user?" has no durable answer. `finishOnboarding()` sets `onboardingCompleted=true` only in memory.
- **Impact**: Data loss (onboarding progress) and a first-run flag race: a user who completed onboarding can be re-prompted on the next launch (if their personas didn't load yet when the trigger evaluates the `personas.length > 0` guard — a real race against `fetchPersonas`), and a user who dismissed mid-flow can never "resume where they left off" after a restart. This is the classic "tour re-shows or never shows" first-run flag bug, made worse by the guard piggybacking on async persona-load timing.
- **Fix sketch**: Persist the onboarding completion/dismissal markers durably (localStorage with a probe, mirroring tourSlice, or a backend setting) and hydrate on slice construction. Make the cold-start "should we onboard?" decision read the durable flag, not a race-prone `personas.length` check evaluated before `fetchPersonas` resolves.
