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
| **Timed auto-advance** | `GuidedTour.tsx` | any event in the `timedSteps` list (5s timeout) — used for observability/events tours where there's no meaningful user action |

**Adding a new completion event:**
1. Pick an event key — convention `tour:<feature>-<verb>`.
2. Set it as `completeOn` on your step.
3. Wire an emitter:
   - If a storeBus event already fires at the right moment → add a listener in `storeBusWiring.ts`.
   - If it's a counter-style interaction → extend `recordCredentialInteraction` or mirror that pattern.
   - If you just want to advance after the user has been on the page a while → add the key to `timedSteps` in `GuidedTour.tsx`.

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
