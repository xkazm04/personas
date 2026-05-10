# Onboarding

Onboarding covers guided tour state, first persona/template setup, credentials guidance, desktop discovery, execution intro, and appearance selection.

## Components

| Area | Behavior | Implementation |
| --- | --- | --- |
| Launcher | Starts/reopens guided tour | `TourLauncher.tsx` |
| Overlay | First-run modal: spotlight, panel body, progress bar, step indicator. Owns the screen while open (the Guided Tour panel early-returns null on `onboardingActive` to avoid two competing prompts). | `OnboardingOverlay.tsx`, `TourSpotlight.tsx`, `TourPanelBody.tsx`, `OnboardingProgressBar.tsx`, `StepProgress.tsx`, `StepIndicator.tsx` |
| Guided Tour panel | Post-modal left-rail coach-mark that runs alongside the app; resumes when the modal closes. Colored per-step via `tourConstants.getStepColors`. | `GuidedTour.tsx`, `tourConstants.ts` |
| Step state | Current step, completed steps, navigation actions | `useOnboardingState.ts`, `tourConstants.ts` |
| Persona/template | First persona coaching and template picker | `steps/PersonaCreationCoach.tsx`, `TemplatePickerStep.tsx` |
| Credentials | Connection setup guidance | `steps/CredentialsTourContent.tsx` |
| Desktop discovery | Desktop capability discovery intro | `DesktopDiscoveryStep.tsx` |
| Execution | Run/test intro | `ExecutionStep.tsx` |
| Appearance | Theme and visual setup | `AppearanceStep.tsx`, `steps/TourAppearanceContent.tsx` |
| Activation Quest | Persistent bottom-right pill tracking 7 first-run milestones (create persona, connect credential, run persona, save memory, schedule trigger, try recipe, share deployment). Auto-dismisses on completion; revivable from a Compass icon in the TitleBar. | `OnboardingQuestPill.tsx`, `stores/onboardingQuestStore.ts` |

## State and persistence

Tour/onboarding state is split between local hook state and system slices:

- `onboardingSlice.ts`: onboarding progress and completion.
- `tourSlice.ts`: guided tour visibility/current step.
- `uiSlice.ts`: shared UI state that onboarding may route into.
- `onboardingQuestStore.ts`: activation quest milestones + pill UI state, persisted to `app_settings.onboarding_quest_state` (JSON). Listeners on `persona-health-changed`, `credential-updated`, `memory-updated`, `trigger-updated` (CDC), `execution-status`, `recipe-execution-status`, and `share-link-received` mark milestones complete on first event.

Onboarding can route users into Templates, Connections, Appearance, and execution-related surfaces; docs for those features should remain authoritative for the target workflow.

## Persona-side onboarding affordances

A second cluster of onboarding pieces lives under `src/features/agents/components/onboarding/` rather than `src/features/onboarding/`. These are scoped to the persona/agent creation flow and are reused outside the first-run tour:

| Component | Behavior |
| --- | --- |
| `OnboardingChecklist.tsx` | Inline checklist with a SVG `ProgressRing` indicator and `useOnboardingChecklist.ts` driving completion state. |
| `OnboardingTemplateStep.tsx` | Persona-creation template picker (distinct from the same-named tour step in `src/features/onboarding/components/TemplatePickerStep.tsx`). Routes category ids to `t.agents.template_picker.*` keys. |
| `ConfigurationPopup.tsx` | `BaseModal`-based credential/config prompt surfaced when an agent step needs missing values; persists via `app_settings` through `getAppSetting`/`setAppSetting`. |
