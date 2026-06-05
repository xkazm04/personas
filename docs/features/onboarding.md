# Onboarding

Onboarding covers guided tour state, first persona/template setup, credentials guidance, desktop discovery, execution intro, and appearance selection.

## Components

| Area | Behavior | Implementation |
| --- | --- | --- |
| Launcher | Starts/reopens guided tour | `TourLauncher.tsx` |
| Overlay | First-run modal: spotlight, panel body, progress bar, step indicator. Owns the screen while open (the Guided Tour panel early-returns null on `onboardingActive` to avoid two competing prompts). | `OnboardingOverlay.tsx`, `TourSpotlight.tsx`, `TourPanelBody.tsx`, `OnboardingProgressBar.tsx`, `StepProgress.tsx`, `StepIndicator.tsx` |
| Guided Tour panel | Post-modal left-rail coach-mark that runs alongside the app; resumes when the modal closes. Colored per-step via `tourConstants.getStepColors`. Speaks each step in Athena's voice when the companion's voice is configured (see "Athena-narrated tour" below). | `GuidedTour.tsx`, `tourConstants.ts`, `useTourNarration.ts`, `TourNarrationButton.tsx` |
| Step state | Current step, completed steps, navigation actions | `useOnboardingState.ts`, `tourConstants.ts` |
| Persona/template | First persona coaching and template picker. Apps approved in the desktop-discovery step are passed forward as `approvedApps`; templates whose connectors/service_flow tokens match the approved set float to the top of the picker, and a "Because you connected X" strip + per-card "Matches X" badge surface the recommendation signal. Matching is substring-tolerant (`desktop_obsidian` → "obsidian" hits "Obsidian Vault", "obsidian-memory", etc.). | `steps/PersonaCreationCoach.tsx`, `TemplatePickerStep.tsx`, `templateRecommendation.ts` |
| Credentials | Connection setup guidance | `steps/CredentialsTourContent.tsx` |
| Desktop discovery | Desktop capability discovery intro | `DesktopDiscoveryStep.tsx` |
| Execution | Run/test intro | `ExecutionStep.tsx` |
| Appearance | Theme and visual setup | `AppearanceStep.tsx`, `steps/TourAppearanceContent.tsx` |

## Tour catalog

Seven tours are registered in `TOUR_REGISTRY` (`src/stores/slices/system/tourSlice.ts`) and all of them surface in Home > Learning. Each tour follows the same step schema described in [`src/features/onboarding/README.md`](../../src/features/onboarding/README.md).

| Tour id | Surface color | Purpose |
| --- | --- | --- |
| `getting-started` | violet | First-run for Power tier: appearance → credentials → build first agent on the Glyph → run it manually (4 steps). |
| `getting-started-simple` | violet | First-run for Starter tier: same arc, simpler language (3 steps). Tier-partner of `getting-started` — completed step ids migrate when tier flips. |
| `execution-observability` | blue | Overview dashboard, activity, messages, health monitoring, Lab (5 steps). |
| `orchestration-events` | teal | Event bus log, trigger types, chaining via the event canvas, live-stream + dead-letter (4 steps). |
| `plugins-explorer` | amber | Catalog → Companion → Twin → Dev Tools → the supporting cast (5 steps). |
| `schedules-mastery` | emerald | Schedules dashboard, timeline vs calendar views, attaching a schedule to an agent (3 steps). |
| `templates-recipes` | indigo | Templates gallery, adoption flow, Recipes tab (3 steps). |

Tour copy currently lives inline in `tourSlice.ts` (`*_STEPS` arrays). The 2026-04-19 retire pass folded the onboarding section back into the main i18n bundle, but the tour titles/descriptions/hints (and the spoken `narration` field below) have not been extracted yet — they remain English-only until the planned extraction. Don't block tour additions on that migration.

## Athena-narrated tour (prototype)

The guided tour can speak each step in Athena's voice while keeping the existing text coach-mark unchanged. The split of responsibility is deliberate:

- **The tour engine still drives everything visible** — step order, route navigation, the spotlight, and `completeOn` advancement (the user must still perform the real action to move on). Narration is purely additive audio; it never advances or blocks a step.
- **Per-step `narration`** (optional field on `TourStepDef`, `tourSlice.ts`) holds spoken copy written for the ear — conversational, 1–3 sentences, distinct from the on-screen `description`. A step with no `narration` is silent. The `getting-started` and `getting-started-simple` tours carry narration today; other tours fall back to silent text.
- **`useTourNarration`** (`src/features/onboarding/components/useTourNarration.ts`) speaks the current step's narration via the companion's live TTS (`companion_tts` → ElevenLabs or local Piper), reusing the same `synthesize`/`play` pipeline as Athena's chat replies. Because `play()` routes through the shared analyser, the companion orb's glow reacts to the narration automatically.
- **Voice gate**: narration plays only when the companion's voice is configured — the `companionVoiceEnabled` master switch is on **and** the selected engine has a usable voice (ElevenLabs credential + voice id, or a downloaded Piper voice). With no voice set up, the control is hidden and the tour behaves exactly as before. TTS is best-effort: any synth/playback failure is swallowed and never breaks the tour.
- **`TourNarrationButton`** (panel header) exposes a replay button and a session-scoped mute toggle; the speaker icon pulses while Athena speaks. It renders nothing when narration is unavailable.

Keeping narration as per-step metadata (rather than baked audio clips, as the marketing-site tour does) is what will let Athena later answer free-form questions mid-tour through the same synthesis path.

## Panel UX

- The tour panel (and its minimized rail) is fully opaque (`bg-background`, no backdrop blur) for readability over busy app surfaces.
- `StepProgress` renders steps as a vertical **number + name** list (not icon-only), with a thin divider between each row; the panel's header and sub-step sections are separated by thin dividers too.
- The **spotlight** (`TourSpotlight.tsx`) haloes the step's `highlightTestId`. If that target is anchored and later vanishes (the user navigated away), the spotlight dismisses the tour rather than leaving a stale cut-out over nothing clickable. But if the target is simply **never present** when the step activates (e.g. the Plugins Explorer "companion" step on a fresh install, where the companion surface isn't open), the spotlight is abandoned quietly — no halo, and the tour keeps going on its coach-mark panel. An initial anchor-miss must never kill the tour; only an anchored-then-gone target does.
- **Re-summoning the spotlight.** A **Show me** control in the step header (`data-testid="tour-btn-show-me"`) re-points the spotlight at the current step's (or active sub-step's) target after it fades or the user scrolls/clicks away. Sub-steps that carry a `highlightTestId` are also individually locatable — the indicator chips become clickable and the generic-content checklist rows gain a locate button (`data-testid="tour-locate-<subStepId>"`). All of these route through one `focusHighlight` helper in `TourPanelBody` that **only acts when the target is currently mounted** (`document.querySelector` guard) — re-firing at a missing testid would trip the spotlight's auto-dismiss, so an off-screen target is a deliberate no-op. It scrolls the element into view and clears-then-re-sets `tourHighlightTestId` (a same-value set is a Zustand no-op) to force a re-measure + pulse.
- A **Resume tour** action appears in the desktop footer (`TourResumeFooterIcon`, `data-testid="footer-resume-tour"`) when a tour was started, made partial progress, and then dismissed without completing. Clicking it un-dismisses and resumes from the last unfinished step. Rather than jumping the route immediately, resuming sets `tourResumePending`: `GuidedTour` first shows a "Pick up where you left off" interstitial (`data-testid="tour-resume-interstitial"`) and only navigates after the user acts. The interstitial renders the full `StepProgress` list (done / current / pending) with an `{completed} of {total} done` summary; clicking any step resumes **directly there**, while **Continue** (`data-testid="tour-resume-continue"`) resumes at the saved step. Both paths clear `tourResumePending` in the same state set so the navigate effect runs before any spotlight fires (an off-screen highlight would otherwise auto-dismiss). The footer label/tooltip interpolates progress via `tx(t.onboarding.resume_tour, { completed, total })`.

## Getting Started flow (4 steps)

1. **Make It Yours** — appearance (`tour:appearance-changed`).
2. **Your Integration Hub** — credentials. The in-panel content (`CredentialsTourContent`) shows the connector categories, a **Built-in tooling** section (Messaging, Database, Vector, Filesystem, Schedule, Memory — local tooling wired up with no credential), and the connection types. Completes on `tour:credentials-explored`.
3. **Build Your First Agent** — the Glyph build. `PersonaCreationCoach` mirrors the live build phases and the eight sigils (trigger/task/connector/message/review/memory/event/error, keyed to `buildCellStates`). Completes only on an actual **promote** (`tour:persona-promoted` now fires on `promoted`, not `test_complete`), which also records the new persona via `setTourCreatedPersona`.
4. **Run Your Agent** — opens the new agent's Use Cases tab and completes when the user runs it (`tour:execution-complete`).

## End-to-end test

`tests/playwright/getting-started-tour.spec.ts` drives the whole flow against a real running app (`npm run tauri:dev:test`, then `npm run test:playwright:tour`). It performs a **real** Opus build → smoke test → promote → execution. Tour control + assertions go through `window.__TEST__` helpers (`tourStart`/`tourReset`/`tourEmit`/`tourState`) exposed in `src/test/automation/bridge.ts` and wrapped in `tests/playwright/companion-bridge.ts`.

`tests/playwright/tours-explore.spec.ts` (`npm run test:playwright:tours`) covers the five exploration tours (execution-observability, orchestration-events, plugins-explorer, schedules-mastery, templates-recipes) **read-only** — navigate + acknowledge each step start→finish, asserting structural validity. No builds, no mutation, so it's safe to run alongside other read-only smoke. Both specs share the single test shell — only one CLI runs Playwright at a time (see `docs/tests/strategy/parallel-cli-workflow.md`).

The five exploration tours' copy was reviewed against the current app (2026-05-25). Notable corrections: Lab now lists the AI optimization modes (Improve/Breed/Evolve) + Regression; trigger setup happens on the Glyph build (the "When"/Trigger sigil) and is visualized on the Events Builder canvas, not in the placeholder Design→Triggers tab; schedules attach **per use-case** via the Use Cases tab (`UseCaseSubscriptions`); Fleet is a Dev Tools sub-tab (not a plugin), and Artist + Research Lab are dev-build-only.

## State and persistence

Tour/onboarding state is split between local hook state and system slices:

- `onboardingSlice.ts`: onboarding progress and completion.
- `tourSlice.ts`: guided tour visibility/current step. Persisted to `localStorage` under `guided-tour-state` at `TOUR_STATE_VERSION = 4`. Bumping the version wipes all tour progress for all users — use sparingly.
- `uiSlice.ts`: shared UI state that onboarding may route into.

Onboarding can route users into Templates, Connections, Appearance, and execution-related surfaces; docs for those features should remain authoritative for the target workflow.

## Persona-side onboarding affordances

A second cluster of onboarding pieces lives under `src/features/agents/components/onboarding/` rather than `src/features/onboarding/`. These are scoped to the persona/agent creation flow and are reused outside the first-run tour:

| Component | Behavior |
| --- | --- |
| `OnboardingChecklist.tsx` | Inline checklist with a SVG `ProgressRing` indicator and `useOnboardingChecklist.ts` driving completion state. |
| `OnboardingTemplateStep.tsx` | Persona-creation template picker (distinct from the same-named tour step in `src/features/onboarding/components/TemplatePickerStep.tsx`). Routes category ids to `t.agents.template_picker.*` keys. |
| `ConfigurationPopup.tsx` | `BaseModal`-based credential/config prompt surfaced when an agent step needs missing values; persists via `app_settings` through `getAppSetting`/`setAppSetting`. |
