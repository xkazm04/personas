# Onboarding & Guided Tours

This doc explains how to author and extend in-app guided tours. Tour logic lives in three places that must be kept in sync; adding a new step requires touches in each. Read this before editing.

## Where things live

| File | Role |
|---|---|
| `src/stores/slices/system/tourSlice.ts` | `TOUR_REGISTRY` (step definitions), state machine, persistence, event dispatch |
| `src/features/onboarding/components/tourConstants.ts` | Per-step icon map, per-tour / per-step color scheme |
| `src/features/onboarding/components/GuidedTour.tsx` | Panel UI, navigation driver, step-specific side effects (e.g. baseline capture, modal opening), timed auto-advance |
| `src/lib/storeBusWiring.ts` | Bridges app events (appearance change, execution complete, persona phase) → `emitTourEvent(...)` |

## Step schema (TourStepDef)

Each step is a row in one of the `*_STEPS` arrays in `tourSlice.ts`:

```ts
{
  id: 'appearance-setup',              // unique across all tours; used by icon/color maps and navigateToStep
  title: 'Make It Yours',
  description: '...',                  // shown in the tour panel body
  hint: 'Change at least one setting below to continue.',
  nav: {
    sidebarSection: 'settings',        // cast to SidebarSection
    subTab: 'appearance',              // optional; sub-tab value
    subTabSetter:                      // optional; MUST be one of the three supported setters:
      'setSettingsTab' | 'setOverviewTab' | 'setEventBusTab',
  },
  completeOn: 'tour:appearance-changed',  // event key (see below). The step is marked complete when emitTourEvent() is called with this key while the step is active.
  subSteps: [
    { id, label, hint, highlightTestId? } // optional inline guidance; advanceSubStep() walks these
  ],
  panelWidth?: 320,                     // override DEFAULT_PANEL_WIDTH (440)
  highlightTestId?: 'settings-appearance-panel',  // drives TourSpotlight overlay
}
```

## The nav + highlight contract

When a step becomes active, `GuidedTour.navigateToStep()` runs:

1. `setSidebarSection(nav.sidebarSection)` — immediate.
2. If `nav.subTab` + `nav.subTabSetter`, the matching setter is called after a 100ms timeout (to let the section mount). **Only these three setters are wired**: `setSettingsTab`, `setOverviewTab`, `setEventBusTab`. If you need a fourth, extend the `if/else` ladder in `GuidedTour.tsx`.
3. Step-specific side effects (hard-coded by `step.id`):
   - `appearance-setup` → captures current theme as `tourAppearanceBaseline` so subsequent appearance changes can be detected.
   - `credentials-intro` → emits `tour:navigate-credential-view` on storeBus so the credentials screen switches to the correct sub-view.
   - `persona-creation` → opens the persona creation modal.
4. Spotlight highlight: prefers `step.highlightTestId`, falls back to `subSteps[0].highlightTestId`. Set via `setHighlightTestId()` after 300ms.

> If your new step needs side effects beyond the three hard-coded cases, add another `else if (step.id === '<your-id>')` branch in `GuidedTour.tsx`. Do not hang logic off `completeOn` — that's for completion, not entry.

## Completion events (`tour:*`)

A step completes when `emitTourEvent(completeOn)` is called while that step is the current step. Three sources emit these events:

| Source | File | Emits |
|---|---|---|
| **storeBus wiring** (recommended for real app events) | `src/lib/storeBusWiring.ts` | `tour:appearance-changed`, `tour:execution-complete`, `tour:persona-draft-ready`, `tour:persona-promoted` |
| **Tour slice itself** (interaction counters) | `tourSlice.ts` `recordCredentialInteraction` | `tour:credentials-explored` |
| **Component-level** (inline triggers) | e.g. `PersonaCreationCoach.tsx` | `tour:persona-promoted` |
| **Explicit user acknowledgment** | `TourPanelBody.tsx` "I've explored this" button | any event listed in `EXPLORATION_TOUR_EVENTS` (`tourSlice.ts`) — used for observability/events stops where there's no meaningful user action to detect |

**Adding a new completion event:**
1. Pick an event key — convention `tour:<feature>-<verb>`.
2. Set it as `completeOn` on your step.
3. Wire an emitter:
   - If a storeBus event already fires at the right moment → add a listener in `storeBusWiring.ts`.
   - If it's a counter-style interaction → extend `recordCredentialInteraction` or mirror that pattern.
   - If the step is purely informational (look at the dashboard, watch a stream) → add the key to `EXPLORATION_TOUR_EVENTS` in `tourSlice.ts`. The panel will render an "I've explored this" button so the user advances when they're ready (no hidden timer).

## Icons & colors

`tourConstants.ts` holds two maps keyed by step id:

- `ICON_MAP`: lucide icon per step (falls back to `Sparkles`).
- `STEP_TO_COLOR`: per-step color scheme (bg/border/text/glow tailwind classes). `COLOR_BY_KEY` is the per-tour fallback matched against `TourDef.color` ("violet" | "blue" | "teal" | ...).

When you add a new step, add an entry to both maps. Missing entries fall back silently — the tour will render, but with generic styling.

## Checklist — adding a new tour step

1. **Define the step** in the appropriate `*_STEPS` array in `tourSlice.ts`. Pick a stable, kebab-case `id`.
2. **Pick a `completeOn` event** and wire an emitter (see Completion events above).
3. **Add icon** in `tourConstants.ts` → `ICON_MAP`.
4. **Add color** in `tourConstants.ts` → `STEP_TO_COLOR`.
5. **If entry requires side effects** (modal open, sub-view switch, baseline capture), add a branch in `GuidedTour.tsx` `navigateToStep`.
6. **If `nav.subTabSetter` is a new setter**, extend the setter ladder in `GuidedTour.tsx`.
7. **Add `data-testid`s** to the UI you want highlighted, matching `highlightTestId` in your step / sub-steps.
8. **Bump `TOUR_STATE_VERSION`** in `tourSlice.ts` if the new step changes completion semantics for an existing tour — otherwise returning users may skip past it with stale persisted state.
9. **Add i18n keys** for any new panel copy (titles/descriptions/hints currently live inline in `tourSlice.ts` but future extraction will move them to `en.ts`; don't block on this for now).

## Checklist — adding a whole new tour

1. Add a new `*_STEPS` array and a new `TourDef` entry to `TOUR_REGISTRY` in `tourSlice.ts`.
2. Add the tour id to the `TourId` union.
3. Extend the `completionMap` initializer in `createTourSlice` to include the new id.
4. Pick a tour-level `color` that exists in `COLOR_BY_KEY` (or add a new `ColorScheme` constant).
5. Follow the per-step checklist above for each step.

## State persistence

Tour progress is persisted to `localStorage` under key `guided-tour-state` at version `TOUR_STATE_VERSION`. Bumping the version wipes all tour progress for all users — use sparingly and only for genuinely breaking schema changes.

## Related but separate: the home Setup Cards stepper

Three slices in `src/stores/slices/system/` cover overlapping-but-distinct first-run concerns. Don't conflate them:

| Slice | Drives | Lives in |
|---|---|---|
| `onboardingSlice` | First-run **Onboarding Overlay** (`OnboardingOverlay.tsx`) — global welcome / step gating | `src/features/onboarding/` |
| `tourSlice` | **Guided spotlight tours** (`GuidedTour.tsx`) — coach-marks over the chrome (this README) | `src/features/onboarding/components/` |
| `setupSlice` | Home **"Role → Tool → Goal" Setup Cards** (`SetupCards.tsx`) — captures user profile and bridges into agent creation via `setupGoal` | `src/features/home/` |

`setupSlice` is owned by Home, not Onboarding, but the bridge into `UnifiedBuildEntry` (pre-fill build intent) only fires while `onboardingActive || tourActive`, which is why it's listed here. See the docstring at the top of `setupSlice.ts` for the full consumer map.

## Onboarding modal vs Guided Tour — precedence contract

`onboardingSlice` and `tourSlice` are two independent state machines that can both be `active` at the same time. Without explicit precedence, a fresh user could see the welcome modal AND the spotlight panel render simultaneously — the modal's scrim on top, the tour panel painting underneath, both asking for attention. This section pins the contract.

### Decision: **the onboarding modal wins.**

The reasoning:
- The modal is a **focused, blocking** welcome flow (5 steps: appearance → discover → pick-template → adopt → execute). It owns the screen by design.
- The tour is a **persistent, dismissible** left-rail panel. It can wait without losing context — `tourActive` and `tourCurrentStepIndex` are preserved while the modal is open and the panel reappears unchanged when the modal closes.
- One affordance at a time matches Design.md's "no double-prompting" rule.

### State diagram

```text
                          ┌──────────────┐
            cold start →  │ idle (no UI) │
                          └──────┬───────┘
            startOnboarding()    │       startTour()
                                 ▼
            ┌──────────────────────────────────┐  finishTour /
            │ onboardingActive=false           │  dismissTour
            │ tourActive=true                  │◀─────────────┐
            │ → GuidedTour panel renders       │              │
            └────────┬─────────────────────────┘              │
                     │ startOnboarding()                      │
                     ▼                                        │
            ┌──────────────────────────────────┐              │
            │ onboardingActive=true            │              │
            │ tourActive=true (preserved)      │              │
            │ → OnboardingOverlay only         │              │
            │   (GuidedTour returns null,      │              │
            │   TourLauncher returns null)     │              │
            └────────┬─────────────────────────┘              │
                     │ finishOnboarding /                     │
                     │ dismissOnboarding                      │
                     ▼                                        │
            ┌──────────────────────────────────┐              │
            │ onboardingActive=false           │              │
            │ tourActive=true (resumes panel)  │──────────────┘
            └──────────────────────────────────┘
```

### Encoding in code

The contract is enforced in three places, each with a comment pointing back to this README:

| File | Guard | Behavior when `onboardingActive` is true |
|---|---|---|
| `GuidedTour.tsx` | `if (onboardingActive) return null;` | Panel hidden; `tourActive` and step index untouched. |
| `TourLauncher.tsx` | `if (… || onboardingActive) return null;` | Launcher button hidden so the user can't trigger a parallel tour from the topbar. |
| `OnboardingOverlay.tsx` | `if (!onboardingActive) return null;` | (existing) Modal does not render until `startOnboarding()` flips the flag. |

### Who fires first

- **Cold-start path:** Simple-mode empty state's CTA → `startOnboarding()`. The tour does not auto-start; it is an opt-in via `TourLauncher`.
- **Power-mode path:** No automatic onboarding modal. `TourLauncher` is shown in the topbar so the user can opt into the guided tour at any time.
- **Re-entry path:** From a help/menu affordance, `reopenOnboarding()` brings the modal back even after `tourCompleted=true`. The tour is unchanged by this — it picks up from its persisted step.

### What happens when both are dismissed

- Onboarding dismissal → `onboardingActive=false`; `onboardingDismissedAtStep` remembers the step. Calling `resumeOnboarding()` later picks up where the user left off.
- Tour dismissal → `tourActive=false`, `tourDismissed=true`. Calling `startTour()` un-dismisses and resumes (or restarts if completed).
- Independent: dismissing one does not touch the other.

### What happens when one finishes

- `finishOnboarding()` → `onboardingCompleted=true`, the modal won't auto-show again. Tour state is untouched.
- `finishTour()` → `tourCompleted=true` for the active tour; the launcher disappears. Onboarding state is untouched.

### Tier-switch policy for the active tour

The Starter ↔ Team tier transition is a real customer journey (see `tourSlice.ts::startTour` for the encoded policy). When a user switches tier mid-tour for the getting-started family (`getting-started` ↔ `getting-started-simple`), the slice **auto-migrates progress via shared step ids**: `appearance-setup`, `credentials-intro`, `persona-creation` exist in both registries, and any step the user has already completed in one tour is marked complete in the other. The user sees the new tier's tour copy without losing context.

The migration is intentionally one-directional per call: each `startTour(newId)` migrates *into* `newId` from the most-recent state of the other family member. The "other" tour's persisted progress is left alone so a tier flip-flop doesn't lose work either way.
