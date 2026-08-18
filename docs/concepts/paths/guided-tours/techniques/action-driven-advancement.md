---
layer: technique
subject: guided-tours
technique: action-driven-advancement
status: forged
laws: [gate-sees-target]
shared_with: []
---

# Action-driven advancement

A tour step that says "click here to open the panel" and then advances on its
own next-button has taught nothing and verified less. The strong form of the
medium completes the step **when the user actually performs the action** —
the tour observes the product's real signals and moves because reality moved.
This is the gate-sees-target law applied to pedagogy: the step's completion
gate observes the thing the step claims happened, not a proxy that takes the
user's word for it.

## Completion conditions are declared, observable facts

Each interactive step declares what completes it, chosen from a small closed
set of observable conditions:

- **The anchored control was activated** — the user clicked or keyed the
  element the spotlight points at.
- **A product state changed** — a panel opened, a mode engaged, an item was
  created. Observed through the product's own state, not inferred from the
  click that usually causes it: the click can fail, be intercepted, or
  succeed through a path the tour did not anchor.
- **A route was reached** — the user arrived at the screen the step was
  guiding toward, by whatever path they chose.
- **Explicit acknowledgment** — a plain next-affordance, reserved for steps
  that only explain. Explanatory steps are legitimate; the defect is a tour
  made of nothing else, and the inverted form — an interactive step that
  *also* offers next, letting the user advance while believing they
  performed an action they did not — teaches a false memory of the product.

Preferring state-change over click-observation is the technique's sharpest
edge. A step that watches for "the panel is open" is robust to every way the
panel can open and every way the click can fail; a step that watches for "the
button was pressed" is a proxy gate, and proxy gates pass precisely when
target and proxy diverge.

## Mid-tour navigation is choreographed, not raced

Steps that span screens are where action-driven tours die. The user activates
a navigation control; the current screen — including the tour's anchor —
tears down; a new screen builds up on its own schedule; and the next step's
anchor does not exist for some hundreds of milliseconds that are different on
every machine. The naive implementation races the transition and loses
unpredictably: spotlights on stale geometry, missing-anchor degradations
firing on anchors that are two frames from existing.

The choreography discipline:

- **The step sequence declares the route change** as part of the transition,
  so the tour knows it is crossing screens rather than discovering it from a
  failed resolution.
- **Between screens, the tour holds a neutral posture** — dimming without a
  spotlight, or a brief re-centered "heading to X" — never a spotlight on a
  dying element.
- **The next step's activation waits for arrival**, then runs anchor
  resolution with its normal bounded patience. Arrival is observed from the
  product's navigation state (the same source of truth the shell itself
  uses), not assumed from elapsed time.
- **The user may navigate wrong.** Wandering off-route is not an error; the
  tour either waits where it is, or pauses and offers to resume when the
  user returns. Yanking the user back is the tour asserting authority over
  the product it decorates.

## Every waiting step names its exit

An action-driven step is a wait, and waits need exits. The user who does not
perform the action — cannot find it, cannot do it, or chooses not to — must
not be parked forever behind a step that only reality can complete:

- **Skip is always present**, on the step itself, advancing without the
  action. Skipping an interactive step records that the action was not
  performed — the completion ledger distinguishes did from skipped-past.
- **A stuck step may offer a timed assist**, softening after a patience
  window: revealing a hint, or surfacing the manual advance more
  prominently. The window softens the step; it never auto-completes it —
  advancement that fires because time passed is the next-button wearing a
  stopwatch, and it poisons the ledger's claim that completed means done.
- **Exit-the-tour remains one gesture away** at all times, per the subject's
  skippability rule.

## What this technique refuses

- Advancement gated on a proxy when the real state change is observable.
- Auto-advancing on a timer, for any step that claims an action happened.
- Racing a route transition — any anchor resolution attempted before arrival
  is observed.
- A waiting step with no skip affordance.
- A completion record that cannot distinguish performed from skipped from
  degraded.
