# Onboarding

Onboarding covers guided tour state, first persona/template setup, credentials guidance, desktop discovery, execution intro, and appearance selection.

## Components

| Area | Behavior | Implementation |
| --- | --- | --- |
| Launcher | Starts/reopens guided tour | `TourLauncher.tsx` |
| Overlay | First-run modal: spotlight, panel body, progress bar, step indicator. Owns the screen while open (the Guided Tour panel early-returns null on `onboardingActive` to avoid two competing prompts). | `OnboardingOverlay.tsx`, `TourSpotlight.tsx`, `TourPanelBody.tsx`, `OnboardingProgressBar.tsx`, `StepProgress.tsx`, `StepIndicator.tsx` |
| Guided Tour panel | Post-modal left-rail coach-mark that runs alongside the app; resumes when the modal closes. Colored per-step via `tourConstants.getStepColors`. | `GuidedTour.tsx`, `tourConstants.ts` |
| Step state | Current step, completed steps, navigation actions | `useOnboardingState.ts`, `tourConstants.ts` |
| Persona/template | First persona coaching and template picker. Apps approved in the desktop-discovery step are passed forward as `approvedApps`; templates whose connectors/service_flow tokens match the approved set float to the top of the picker, and a "Because you connected X" strip + per-card "Matches X" badge surface the recommendation signal. Matching is substring-tolerant (`desktop_obsidian` → "obsidian" hits "Obsidian Vault", "obsidian-memory", etc.). | `steps/PersonaCreationCoach.tsx`, `TemplatePickerStep.tsx`, `templateRecommendation.ts` |
| Credentials | Connection setup guidance | `steps/CredentialsTourContent.tsx` |
| Desktop discovery | Desktop capability discovery intro | `DesktopDiscoveryStep.tsx` |
| Execution | Run/test intro | `ExecutionStep.tsx` |
| Appearance | Theme and visual setup | `AppearanceStep.tsx`, `steps/TourAppearanceContent.tsx` |

## State and persistence

Tour/onboarding state is split between local hook state and system slices:

- `onboardingSlice.ts`: onboarding progress and completion.
- `tourSlice.ts`: guided tour visibility/current step.
- `uiSlice.ts`: shared UI state that onboarding may route into.

Onboarding can route users into Templates, Connections, Appearance, and execution-related surfaces; docs for those features should remain authoritative for the target workflow.

## Persona-side onboarding affordances

A second cluster of onboarding pieces lives under `src/features/agents/components/onboarding/` rather than `src/features/onboarding/`. These are scoped to the persona/agent creation flow and are reused outside the first-run tour:

| Component | Behavior |
| --- | --- |
| `OnboardingChecklist.tsx` | Inline checklist with a SVG `ProgressRing` indicator and `useOnboardingChecklist.ts` driving completion state. |
| `OnboardingTemplateStep.tsx` | Persona-creation template picker (distinct from the same-named tour step in `src/features/onboarding/components/TemplatePickerStep.tsx`). Routes category ids to `t.agents.template_picker.*` keys. |
| `ConfigurationPopup.tsx` | `BaseModal`-based credential/config prompt surfaced when an agent step needs missing values; persists via `app_settings` through `getAppSetting`/`setAppSetting`. |
