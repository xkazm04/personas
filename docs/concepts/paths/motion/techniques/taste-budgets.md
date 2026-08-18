---
layer: technique
subject: motion
technique: taste-budgets
status: forged
laws: []
shared_with: []
---

# Taste budgets

Motion systems do not degrade through bad taste; they degrade through
unbudgeted good taste. Every individual addition — a slightly longer
entrance, a livelier idle state, one more staggered reveal — looks better
than its absence in isolation. The aggregate is a product that never sits
still. The countermeasure is to convert taste into **numbers with owners**:
caps and bounds fixed centrally, beside the presets they govern, so
restraint is a property of the vocabulary rather than a virtue expected of
every author.

## The motion class hierarchy

Budgets attach to *classes* of motion, not to individual gestures. Ordered
by how much motion they are entitled to:

1. **Feedback** — response to the user's own act (press, hover, drag).
   Entitled to immediacy above all: it starts within a frame or two and
   stays small. Feedback is the one class that must never be cut, because
   it answers a question the user just asked.
2. **Transition** — the interface changing state (panel opening, view
   switching). Entitled to enough duration to preserve continuity of place,
   and no more.
3. **Entrance** — content arriving for the first time. Entitled to play
   *once* per identity (the guard is
   [one-shot-guarding](one-shot-guarding.md)) and to a hard total cap.
4. **Ambient** — idle life on a resting surface. Entitled to almost
   nothing: tiny travel, slow period, few instances. The first class to
   cut when a surface feels busy. Ambient motion is also bound by an
   honesty rule: it may imply *presence*, never *progress*. A sweep, a
   spinner-shaped loop, or a working-style shimmer on a surface where no
   work is happening is a lie about system state — a user reads it as
   "loading" and waits for a completion that will never come. Motion that
   implies activity is reserved for states where the activity is real.
5. **Celebratory** — success flourishes. Entitled to expressiveness
   precisely because they are rare; a celebration that plays hourly is
   reclassified ambient and re-budgeted accordingly.

The hierarchy resolves disputes: when two motions compete for the same
moment, the lower class yields. Ambient life pauses while an entrance
plays; nothing preempts feedback.

## The numeric budgets

The specific values are the vocabulary owner's to set; that they are *set,
named, and single-sourced* is the technique. A defensible starting frame:

- **Entrance cap: about a second, total.** The whole choreography —
  per-item motion plus accumulated stagger — completes in roughly a second,
  hard-capped. Per-item motion stays a few hundred milliseconds; stagger
  steps stay in the tens of milliseconds; and stagger accumulation is
  capped by count, so a long list ripples its first screenful and the rest
  arrive plainly. An entrance the user can outrun with their eyes is
  delaying data for theater.
- **Ambient travel bound: a few pixels.** Idle motion moves a handful of
  pixels at most, over seconds, not hundreds of milliseconds. The test:
  from reading distance, a resting surface should feel alive only when the
  user looks *for* the motion, never when they are reading past it.
- **Concurrent ambient instances: countable on one hand.** Ten independent
  idle animations is a screen that shimmers. The budget is per-view, and
  ambient presets should be cheap to disable wholesale.
- **One expressive easing.** Enters decelerate; exits accelerate — and run
  a step faster than enters, because the user asked for the dismissal;
  in-place moves stay symmetric. Exactly one characterful curve (an
  overshoot, a spring) exists in the vocabulary, reserved for the
  celebratory class. Character used everywhere is character nowhere.

Durations and easings themselves come from the token ladder — the budget
layer references those tokens, it does not mint new numbers (ownership per
the design-tokens vocabulary).

## Attention must be deserved

The qualitative rule that outranks every number: **motion is the strongest
attention signal an interface commands, and it must point at something
worth the user's eyes.** Movement toward the periphery of the user's task
is taxation. The concrete tests:

- If a gesture draws attention to something the user cannot act on, cut it.
- If a gesture plays more than once per session for a typical user and is
  not feedback, it needs a guard or it needs to go.
- If removing a gesture entirely would not be noticed by a returning user,
  the gesture was decoration — acceptable only within the ambient budget,
  which is nearly zero.

## Budgets are enforced where presets live

A budget documented in a style guide is a wish. The budgets bind when they
are **constants in the vocabulary's own home**: the stagger step, the
ambient travel bound, the entrance cap, the stagger-count cutoff — named
values the presets are built from. Then a preset cannot exceed the entrance
cap without editing the cap itself, in the file where the whole vocabulary
watches — which converts a silent drift into a reviewed decision. That is
the entire trick: restraint as code review, not as memory.
