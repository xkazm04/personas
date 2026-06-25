# Onboarding Tour — Combined Scan (ambiguity-guardian + bug-hunter)
> Context: onboarding-tour | Group: Onboarding, Home & Settings
> Total: 5 | Critical: 0 | High: 1 | Medium: 3 | Low: 1

## 1. Stale scheduled side effects fire after a rapid step change (timeouts only cleared on tour-end, not on step change)
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: Race condition
- **File**: src/features/onboarding/components/GuidedTour.tsx:194 (navigate effect) + :74 (cleanup) + :101-189 (`navigateToStep`)
- **Scenario**: User is on `persona-creation` and clicks Next/Skip (or jumps in the resume list) within ~150–400 ms. `navigateToStep(currentIndex)` had already queued timeouts via `scheduleTourTimeout` — e.g. `useSystemStore.setState({ isCreatingPersona: true })` at +150 ms (line 146), `storeBus.emit('tour:navigate-credential-view')` at +150 ms (line 144), a sub-tab setter at +100 ms (line 111), and `setHighlightTestId(step.highlightTestId)` at +300 ms (line 186). After advancing, the effect re-runs for the new index but **never clears the previous index's pending timeouts**: `clearPendingTimeouts` is only invoked when `tourActive` flips false (line 74-76) or on unmount (line 78).
- **Root cause**: The only guard inside a scheduled callback is `if (!tourActiveRef.current) return` (line 62) — it checks "tour still running", not "still on the step that queued me". So every queued side effect from the abandoned step still fires.
- **Impact**: After moving on, the app can pop the persona builder open (`isCreatingPersona: true`), switch a sub-tab, fire a credential-view navigation, or set `tourHighlightTestId` back to the *previous* step's element — making the spotlight point at the wrong (or now-unmounted) target and flashing the "not on screen yet" note (`tourHighlightMissing`) until the new step's +300 ms timeout corrects it. Disruptive, intermittent, and hard to reproduce in QA.
- **Fix sketch**: Clear pending timeouts at the top of the navigate effect before calling `navigateToStep` (or return `clearPendingTimeouts` as the effect cleanup keyed on `currentIndex`). Optionally capture the entering index/stepId in a closure and bail in each callback if `get().tourCurrentStepIndex` no longer matches.
- **Value**: impact=7 effort=3

## 2. ExecutionStep can permanently miss the completion event if the run finishes before the listener registers
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: Race condition / silent failure
- **File**: src/features/onboarding/components/ExecutionStep.tsx:48-87 (listen effect) + :89-99 (`handleRun`)
- **Scenario**: `handleRun` awaits `executePersona(personaId)` to get `execId`, *then* `setStartedExecId(execId)` (line 97). Only after that state update does the `useEffect` register the Tauri `listen('execution-complete', …)` handler — and `listen()` itself resolves asynchronously. For a fast/trivial agent (or if `executePersona` resolves only after the backend already emitted the terminal event), `execution-complete` fires before the subscription is live and is lost.
- **Root cause**: Completion is delivered purely as a fire-and-forget event with no replay and no "is it already done?" reconciliation. There is a `cancelled` guard against late registration but no guard against an *early* (already-emitted) event.
- **Impact**: `finished`/`onComplete` never fire → `onboardingStepCompleted['execute']` stays false → the emerald **Done** button (OnboardingOverlay:225) never renders. The user is parked on the final onboarding step watching a spinner forever; the only escape is Skip/dismiss, which abandons onboarding.
- **Fix sketch**: After `setStartedExecId`, query the agent store / backend for the execution's current status and call `onComplete`/`setExecutionError` if it already reached a terminal state; or register the listener *before* calling `executePersona` and filter by the returned id.
- **Value**: impact=6 effort=4

## 3. Failed execution is a dead-end — no retry, no way to finish onboarding
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: Edge case / stuck state
- **File**: src/features/onboarding/components/ExecutionStep.tsx:60-64 (failure branch) + :112-127 (Run button gated on `!started`)
- **Scenario**: User clicks Run; the execution completes with a non-`completed` status. The listener sets `setFinished(true)` + `setExecutionError('Execution failed')` (lines 60-64) but leaves `started === true`. The "Run agent" button only renders while `!started` (line 112), so it's gone; `onComplete` was never called, so the **Done** button never appears either.
- **Root cause**: The failed-run branch surfaces an error string but provides no recovery affordance and never resets `started`. (Contrast the `!execId` branch at line 93-95, which *does* reset `started` so the user can retry.)
- **Impact**: A single failed first execution traps the user on the last onboarding step with a red error and no forward/retry control — they must Skip/dismiss the whole onboarding. First-run failures are exactly when retry matters most.
- **Fix sketch**: On the failure branch, render a "Try again" button (reset `started=false`, `finished=false`, `executionError=null`, `startedExecId=null`) and/or allow proceeding past a failed run (e.g. a "Continue anyway" that calls `onComplete`).
- **Value**: impact=6 effort=3

## 4. "Skip this step" on the final step silently ends the entire tour
- **Severity**: Medium
- **Lens**: ambiguity-guardian
- **Category**: Unclear semantics / silent dismissal
- **File**: src/stores/slices/system/tourSlice.ts:1396-1409 (`advanceTour`) + src/features/onboarding/components/GuidedTour.tsx:202-205 (`handleNext`) + TourPanelBody.tsx:258-265 (skip button)
- **Scenario**: On the last step, if it isn't completed, the footer renders the de-emphasized **"Skip this step"** button (`tour-btn-next`). Clicking it → `handleNext` → `advanceTour`; `nextIndex >= steps.length` and not all steps done, so the `else` branch runs `set({ tourActive: false, … })` and persists — the whole tour vanishes with no completion screen, no confirmation, no "you skipped the rest" notice.
- **Root cause**: The terminal-step skip is overloaded onto the same control as mid-list skip, and `advanceTour` treats "skip past the end" identically to closing. The button label promises a per-step skip but the action ends the tour.
- **Impact**: Users perceive the tour as having crashed/disappeared on the last step; completion stays (correctly) un-recorded, so they can't tell whether it finished. Erodes trust in the guided flow.
- **Fix sketch**: On the last incomplete step, relabel the control ("Finish without completing" / "End tour") or route it through the completion screen with an honest "X of Y done" recap instead of a cold close.
- **Value**: impact=5 effort=2

## 5. Sidebar onboarding progress bar disappears mid-onboarding as soon as the first persona exists
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: Logic / ordering bug
- **File**: src/features/onboarding/components/OnboardingProgressBar.tsx:26
- **Scenario**: The adopt step creates a persona and `handleAdoptionComplete` awaits `fetchPersonas()` (useOnboardingState.ts:273), so `personas.length > 0` becomes true while onboarding is still active on the **execute** step. The guard `if (onboardingCompleted || personas.length > 0) return null;` runs *before* the `onboardingActive` check (line 28), so the sidebar progress bar unmounts at 4/5 — exactly when the user reaches the final step.
- **Root cause**: The `personas.length > 0` heuristic (meant to hide the nudge from returning users who already have agents) isn't gated behind `!onboardingActive`, so it misfires during the live onboarding session.
- **Impact**: The persistent progress indicator vanishes right before the finish line, making it look like onboarding ended early. Cosmetic (the modal's own StepIndicator still shows), but a confusing inconsistency.
- **Fix sketch**: Check `onboardingActive` first and only apply the `personas.length > 0` short-circuit when onboarding is *not* active (returning-user case).
- **Value**: impact=3 effort=1
