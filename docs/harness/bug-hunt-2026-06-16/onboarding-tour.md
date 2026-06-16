# Bug Hunter — Onboarding Tour

> Total: 5 findings (1 critical, 2 high, 1 medium, 1 low)
> Context: onboarding-tour | Group: Onboarding, Home & Settings

## 1. Skipping the last step silently marks the WHOLE tour complete
- **Severity**: Critical
- **Category**: 💀 Silent failure / off-by-one boundary
- **File**: `src/features/onboarding/components/GuidedTour.tsx:202` (and `src/stores/slices/system/tourSlice.ts:1382`)
- **Scenario**: User is on the final step (`currentIndex === visibleSteps.length - 1`) and that step is NOT completed. The footer renders the de-emphasized "Skip" button (`tour-btn-next`, `TourPanelBody.tsx:254`), which calls `onNext` → `handleNext`. Because `allCompleted` is false, `handleNext` calls `advanceTour()`.
- **Root cause**: `advanceTour()` computes `nextIndex = currentIndex + 1`; when `nextIndex >= steps.length` it unconditionally calls `finishTour()`. `finishTour()` sets `tourStepCompleted` to **all-true** (`Object.fromEntries(steps.map((st) => [st.id, true]))`, line 1438) and `tourCompletionMap[tourId] = true`. So a single "skip" on the last step is indistinguishable from genuinely finishing every step. There is no "skipped vs done" distinction and no confirmation.
- **Impact**: The user skips one informational step and the tour is permanently recorded as 100% complete; the completion celebration may not even show (advanceTour bypasses the `showCompletion` screen path that `handleNext`'s `allCompleted` branch uses). It will never re-offer, and the per-tour completion badge lies. Progress integrity is corrupted on the most common "I'm done here" gesture.
- **Fix sketch**: In `advanceTour`, when `nextIndex >= steps.length`, do NOT mark all steps complete — either clamp/stay, or route to the completion screen only when steps are genuinely all complete. Keep `finishTour` (which force-completes) reserved for the explicit "Complete tour" / completion-screen path. Alternatively have `handleNext` on the last incomplete step show the completion screen instead of calling `advanceTour`.

## 2. Persisted `currentStepIndex` is hydrated unclamped — tour can vanish
- **Severity**: High
- **Category**: 🕳️ Edge case / 🔮 latent failure
- **File**: `src/stores/slices/system/tourSlice.ts:1293`
- **Scenario**: Initial slice state takes `tourCurrentStepIndex: ps?.currentStepIndex ?? 0` straight from localStorage, with no bound check against the current step count. If the active tour's step list is ever shorter than the persisted index (a tour definition edit that removes steps without bumping `TOUR_STATE_VERSION`, or the default-tour `getting-started` list changing length between builds while `version` stays 4), the hydrated index points past the end.
- **Root cause**: Hydration trusts the persisted index. `getActiveTourSteps(tourId)[currentIndex]` then returns `undefined`, and `GuidedTour` early-returns `null` at line 231 (`if (!tourActive || !currentStep || !tourDef) return null`). The navigate effect (line 199) also no-ops because `navigateToStep` bails on `if (!step) return`. The tour is "active" in state but renders nothing and never recovers without a manual reset.
- **Impact**: After a tour-content change ships, returning users with saved mid-tour progress get a silently dead tour (active flag set, panel invisible, no error). `advanceTour`/`goToTourStep` guard their inputs but the hydrated seed value is never validated.
- **Fix sketch**: Clamp on hydrate: `tourCurrentStepIndex: Math.min(ps?.currentStepIndex ?? 0, Math.max(0, getActiveTourSteps(defaultTourId).length - 1))`. Better: validate the full persisted record against the live step list in `loadPersistedState` and reset out-of-range tours.

## 3. ExecutionStep can auto-complete on a pre-existing, unrelated execution
- **Severity**: High
- **Category**: ⚡ Race condition / stale state
- **File**: `src/features/onboarding/components/ExecutionStep.tsx:45`
- **Scenario**: The completion-listener effect runs whenever `activeExecutionId` is truthy — including an `activeExecutionId` left over in `agentStore` from an execution the user (or a prior onboarding attempt) ran before reaching this step. The user never clicks "Run agent", but if an `execution-complete` event arrives for that pre-existing id, the handler fires `setFinished(true)` and `onComplete()`.
- **Root cause**: The effect keys off `activeExecutionId` rather than off the execution this step actually started. `handleRun` awaits `executePersona(personaId)` and gets an `execId`, but that returned id is never stored/compared — the listener matches against the store's `activeExecutionId`, which may belong to a different (earlier) run. There's also no gate on `started`.
- **Impact**: The Execute onboarding step can mark itself complete (and the modal footer flips to "Done") for a run the user never initiated in onboarding — confusing, and it lets the flow finish without the intended hands-on execution. Conversely, if `executePersona` swaps `activeExecutionId` mid-flight, the registered listener is for a stale id and the real completion is missed (step hangs in "executing" forever).
- **Fix sketch**: Capture the id returned by `handleRun`'s `executePersona` into a ref/state and only `listen` + match against *that* id, gated on `started`. Don't derive the matched id from the global `activeExecutionId`.

## 4. Restoring the minimized panel re-fires every step side effect
- **Severity**: Medium
- **Category**: 🔮 Latent failure / unintended side effects
- **File**: `src/features/onboarding/components/GuidedTour.tsx:397`
- **Scenario**: User minimizes the tour panel mid-step, does work in the app, then clicks the minimized pill to restore. The onClick calls `navigateToStep(currentIndex)` directly (in addition to the navigate `useEffect` which also runs).
- **Root cause**: `navigateToStep` is not idempotent — it performs imperative side effects: `setState({ isCreatingPersona: true })` (persona-creation step), `selectPersona` + `setEditorTab('use-cases')` (first-execution), `storeBus.emit('tour:navigate-credential-view')`, obsidian binary probes, and `setSidebarSection`/sub-tab setters. Re-invoking it forces the route/sidebar back to the step's prescribed location and re-flips `isCreatingPersona`, clobbering whatever the user navigated to or was editing while minimized.
- **Impact**: Minimize→restore yanks the user out of their current context and can re-open the persona creation wizard or re-select a persona, discarding in-progress work. The minimize affordance is meant to be non-destructive but isn't.
- **Fix sketch**: On restore, only un-minimize (`setIsMinimized(false)`); let the existing navigate effect decide whether re-navigation is needed, or split `navigateToStep` into a pure spotlight refresh vs. the one-time entry side effects (run the latter only on actual step index changes).

## 5. Appearance baseline is captured but never compared — step completes on a no-op
- **Severity**: Low
- **Category**: 💀 Silent failure / dead defensive code
- **File**: `src/features/onboarding/components/GuidedTour.tsx:140` + `src/lib/storeBusWiring.ts:104`
- **Scenario**: The `appearance-setup` step says "Change at least one setting to continue." `captureAppearanceBaseline({themeId, textScale, brightness})` snapshots the starting values, but the completion path (`storeBus.on('appearance:changed') → emitTourEvent('tour:appearance-changed')`) fires on *any* appearance store write and never consults the baseline.
- **Root cause**: `tourAppearanceBaseline` is written (slice line 1529) and read nowhere. The "did the user actually change something" check the baseline exists for was never wired into the emit path; the baseline also isn't captured at all for the `getting-started-simple` variant (the `step.id === 'appearance-setup'` branch only runs, but baseline is still unused either way).
- **Impact**: The step completes when the appearance store emits for reasons unrelated to a deliberate user change (e.g. a programmatic theme re-apply, density default settle, or toggling a value and immediately reverting it), so the "change one setting" gate is effectively cosmetic. Minor — it errs toward letting users proceed — but it's silent dead code that misrepresents intent and could let the step complete with zero real interaction.
- **Fix sketch**: Either compare current theme/textScale/brightness against `tourAppearanceBaseline` inside the `appearance:changed` handler before emitting, or remove the unused baseline machinery so the gate's behavior matches its code.
