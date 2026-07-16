# Onboarding Tour — bug-hunter + ui-perfectionist scan

> Total: 5 (Critical: 0, High: 3, Medium: 2, Low: 0)

## 1. Resume-after-restart at 'adopt' or 'execute' soft-locks the onboarding modal
- **Severity**: High
- **Category**: bug
- **File**: src/stores/slices/system/onboardingSlice.ts:231 (with src/features/onboarding/components/OnboardingOverlay.tsx:167-180)
- **Scenario**: User adopts a template (reaching the 'adopt' or 'execute' step), dismisses the modal ("I'll finish later"), quits the app, relaunches, and clicks the resume affordance. `dismissOnboarding` persists only `{completed, dismissedAtStep, tourHandoffOffered}`; `onboardingCreatedPersonaId`, `onboardingSelectedReviewId`, and `onboardingStepCompleted` are in-memory only. `resumeOnboarding` restores `onboardingStep: 'execute'` (or `'adopt'`) with all three reset.
- **Root cause**: Persistence was added for the resume *point* but not for the mid-flow state the later steps require; the overlay assumes `onboardingStep === 'execute'` implies `onboardingCreatedPersonaId != null` and `'adopt'` implies `showAdoptionWizard` will become true — both only hold within one session.
- **Impact**: Resumed at 'execute': content area renders nothing (`onboardingStep === 'execute' && onboardingCreatedPersonaId` is false) and the footer has no action button — a blank modal whose only exits are Skip/X. Resumed at 'adopt': an eternal "opening wizard" spinner with no footer CTA. Skip→resume loops the same dead-end; only the Help-menu `reopenOnboarding` (full restart from scratch) escapes.
- **Fix sketch**: Either persist `onboardingCreatedPersonaId`/`onboardingStepCompleted` alongside `dismissedAtStep`, or clamp the resume step: in `resumeOnboarding`, if `dismissedAtStep` is 'adopt'/'execute' and `onboardingCreatedPersonaId` is null, resume at 'pick-template' instead. Also render a fallback CTA on the 'execute' step when the persona id is missing.

## 2. ExecutionStep can miss the completion event of a fast execution — spinner never resolves
- **Severity**: High
- **Category**: bug
- **File**: src/features/onboarding/components/ExecutionStep.tsx:48-99
- **Scenario**: User clicks "Run agent". `handleRun` awaits `executePersona` to get the exec id, then `setStartedExecId` triggers the effect, which calls the *async* Tauri `listen()`. If the execution reaches a terminal state quickly — e.g. it fails immediately on missing credentials, or is a trivial zero-connector starter template — the backend emits `execution-complete` in the window between process start (inside `executePersona`) and listener registration (a state update + effect run + async `listen()` resolution later).
- **Root cause**: The subscription is created *after* the work it observes has already started; there is no catch-up read of the execution's current status after the listener attaches, so a terminal event emitted during the registration gap is lost forever.
- **Impact**: The step shows "Executing…" with a spinner indefinitely even though the run finished; `onComplete` never fires, so the footer Done button never appears and the user cannot finish onboarding except by Skip. Silent failure — nothing errors.
- **Fix sketch**: After the listener resolves (and `!cancelled`), fetch the execution's current status once (e.g. via the executions API or `activeExecutionId`/store status) and synthesize completion if it's already terminal. Alternatively subscribe before calling `executePersona` and filter by the id once known.

## 3. Failed first execution is a dead end — no retry, no way to proceed
- **Severity**: High
- **Category**: ui
- **File**: src/features/onboarding/components/ExecutionStep.tsx:60-64,112,128 (with OnboardingOverlay.tsx:225)
- **Scenario**: User clicks "Run agent" and the execution ends with status `failed`/`cancelled` (or `executePersona` returns null — e.g. budget block, whose store-level error message is discarded in favor of a generic string). The step shows a red "Execution failed" line above the terminal.
- **Root cause**: The UI models execution as start→success only. On failure, `started` stays true so the pre-run panel (with the Run button) never returns, no retry affordance is rendered in the error branch, and the footer Done button is gated on `onboardingStepCompleted['execute']`, which only a `completed` status sets.
- **Impact**: A first-run user whose very first agent run fails — the population most likely to hit a config problem — is stuck on a dead screen; the only exits are Skip or X, both of which abandon onboarding at 4/5 steps. Terrible first-run recovery exactly where it matters most.
- **Fix sketch**: In the `finished && executionError` branch render a "Run again" button that resets `started/finished/executionError/startedExecId`, plus a secondary "Finish anyway" (or show the footer Done) so a failed run doesn't hold onboarding completion hostage. Surface the store's real error message instead of the generic `Execution ${status}`.

## 4. Sidebar progress checklist vanishes mid-onboarding the moment the first persona is created
- **Severity**: Medium
- **Category**: bug
- **File**: src/features/onboarding/components/OnboardingProgressBar.tsx:26
- **Scenario**: User completes the adoption wizard on step 4 ('adopt'). `handleAdoptionComplete` awaits `fetchPersonas()`, so `personas.length` becomes ≥ 1 while onboarding is still active on the 'execute' step.
- **Root cause**: `if (onboardingCompleted || personas.length > 0) return null;` uses "user already has personas" as a proxy for "onboarding is not needed" — but the onboarding flow itself creates a persona two steps before it ends, so the guard fires against the flow's own success.
- **Impact**: The progress bar disappears at exactly 3/5 (or 4/5), before the user ever sees the 'adopt' and 'execute' items get checked or the bar reach 100% — the checklist silently evaporates instead of celebrating completion, reading like a glitch.
- **Fix sketch**: Only apply the `personas.length > 0` suppression when onboarding is *not* active (it already returns null when inactive, so the guard can simply drop the personas check, or change it to `!onboardingActive && personas.length > 0` if the component is ever rendered outside the active flow).

## 5. Onboarding terminal streams an unrelated execution's output when one is already running
- **Severity**: Medium
- **Category**: bug
- **File**: src/features/onboarding/components/ExecutionStep.tsx:24,165-169 (with src/stores/slices/agents/executionSlice.ts:350-370)
- **Scenario**: An execution is already in flight when the user clicks "Run agent" in the onboarding execute step (the exact scenario the `startedExecId` comment defends against for *completion*; reachable via reopened onboarding, a tour-triggered run, or a scheduled/background run). `executePersona` sees `isExecuting` and routes the new run to the background with *no terminal buffering*.
- **Root cause**: The status line is correctly keyed to `startedExecId`, but the terminal renders the global `executionOutput` buffer, which belongs to whichever execution holds terminal focus — not necessarily the one this step started.
- **Impact**: The panel says "Executing <new agent>" while the terminal live-streams the pre-existing, unrelated execution's stdout — misattributed output presented as the new agent's work; the onboarding run itself produces no visible output at all. Confusing/false success theater for a first-run teaching moment.
- **Fix sketch**: Gate the terminal on the onboarding run being the focused execution (e.g. compare `startedExecId` to the store's active execution id) and otherwise show a "running in background — output unavailable" note; or block/queue the onboarding run with an explicit "another execution is running" message before starting.
