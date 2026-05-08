# Onboarding

Onboarding covers guided tour state, first persona/template setup, credentials guidance, desktop discovery, execution intro, and appearance selection.

## Components

| Area | Behavior | Implementation |
| --- | --- | --- |
| Launcher | Starts/reopens guided tour | `TourLauncher.tsx` |
| Overlay | Spotlight, panel body, progress bar, step indicator | `OnboardingOverlay.tsx`, `TourSpotlight.tsx`, `TourPanelBody.tsx`, `OnboardingProgressBar.tsx`, `StepIndicator.tsx` |
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
