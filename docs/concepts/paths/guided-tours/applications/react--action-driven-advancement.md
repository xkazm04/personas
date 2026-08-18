---
layer: application
subject: guided-tours
technique: action-driven-advancement
stack: react
---

# Action-driven advancement — React implementation (Personas guided tours)

How this repo implements the
[action-driven-advancement](../techniques/action-driven-advancement.md)
technique: a typed completion-event vocabulary, real state-change observers,
an explicit acknowledge lane for unobservable steps — and a route
choreography that deviates from the technique by racing fixed timers.

## The completion vocabulary is one typed authority

`TOUR_EVENTS` (`src/stores/slices/system/tourSlice.ts:52-104`) is a single
`as const` union of every completion event key (`'tour:persona-promoted'`,
`'tour:execution-complete'`, …). Both the producer side (`emitTourEvent`
callers, `storeBusWiring.ts`) and the consumer side (`TourStepDef.completeOn`)
share the union, so a typo'd event key is a compile error. The header comment
records why: completion used to be an invisible cross-file string contract
that "failed open — the step just never completed."

Real observers emit the events: promoting a persona fires
`tour:persona-promoted`; a finished run fires `tour:execution-complete`; the
Obsidian step probes for the installed binary and self-completes via
`emitTourEvent('tour:obsidian-detected')` when found
(`GuidedTour.tsx:174-188`) — state observed, not clicks trusted.

## The acknowledge lane, and the timer that was retired

`EXPLORATION_TOUR_EVENTS` (`tourSlice.ts:122-166`) is the declared set of
steps with no code-detectable outcome ("look around the dashboard"). Its
comment is the technique's history lesson verbatim: these steps historically
auto-advanced on a hard-coded 5-second `setTimeout` — "too short for a slow
loader and too long for a power user" — and Sentry surfaced *"it said
complete but I never saw the page"* complaints. The timer is gone; the panel
now renders an explicit "I've explored this" button and the user decides.
Athena-composed steps all use the single `tour:composed-step-explored`
acknowledge event for the same reason: no detectable outcome exists for
generated content.

## Choreography: guarded, but timer-based (deviation)

`navigateToStep` (`GuidedTour.tsx:102-208`) choreographs cross-screen steps:
set the sidebar section, then queue sub-tab setters, modal opens, and the
spotlight on staggered `setTimeout`s of 100–400 ms. The staleness handling is
genuinely careful — every queued effect passes through `scheduleTourTimeout`,
which no-ops if the tour ended (`GuidedTour.tsx:60-68`); `scheduleStepTimeout`
additionally bails if the user moved off the scheduling step
(`:112-116`); and the navigate effect's cleanup clears all pending timeouts
on step change (`:210-224`), so a rapid Next/Skip cannot let an abandoned
step pop a modal or spotlight a stale element.

The deviation against the technique: arrival is *assumed from elapsed time*,
not observed from navigation state. The guards make stale effects inert, but
a slow route still means the spotlight fires before its anchor exists —
absorbed downstream by the missing-anchor degradation path rather than
prevented by observing arrival. Standard kept; reported, not patched.

## Exits for the waiting step

The panel is a non-modal left-rail coach mark: the user can operate the app,
jump to any step (`StepProgress` `onJump`), go back, minimize (Escape,
`GuidedTour.tsx:252`), or dismiss entirely — so an interactive step that
never completes never parks the user. `finishTour()` on the completion
screen force-marks steps and records completion in the persisted map, which
is where this implementation is weaker than the technique's ledger: a
skipped-past interactive step and a performed one are not distinguished in
what is stored (`tourStepCompleted` is a plain boolean map).
