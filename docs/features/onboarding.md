# Onboarding

Onboarding covers the guided tour, setup prompts, persona creation coaching, credential setup guidance, desktop discovery, and appearance selection.

## Current flow

| Step | Purpose | Implementation |
| --- | --- | --- |
| Launcher and overlay | Starts or resumes the guided tour | `src/features/onboarding/components/TourLauncher.tsx`, `OnboardingOverlay.tsx` |
| Step progress | Shows current step and progress | `StepProgress.tsx`, `StepIndicator.tsx`, `OnboardingProgressBar.tsx` |
| Persona creation | Coaches the first agent/persona setup | `steps/PersonaCreationCoach.tsx`, `TemplatePickerStep.tsx` |
| Credentials | Guides connection setup | `steps/CredentialsTourContent.tsx` |
| Desktop discovery | Explains desktop capability discovery | `DesktopDiscoveryStep.tsx` |
| Appearance | Theme and visual setup | `AppearanceStep.tsx`, `steps/TourAppearanceContent.tsx` |

## State

Onboarding state is managed by `useOnboardingState.ts` plus persisted system UI state where needed. The guided tour copy is localized through the root i18n system.

