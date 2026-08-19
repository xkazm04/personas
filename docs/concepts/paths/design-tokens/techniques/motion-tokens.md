---
layer: technique
subject: design-tokens
technique: motion-tokens
status: forged
laws:
  - one-authority-per-vocabulary
---

# Motion tokens

Motion is the axis teams tokenize last and regret last-tokenizing most. Raw
durations and easings scattered across a product produce interfaces where
every surface moves with a different accent — 150ms here, 220ms there, a
bounce nobody chose — and where honoring a reduced-motion preference means
finding every one of them. The fix is the same indirection as color and
spacing: a closed motion vocabulary, one authority, consumed everywhere.

## The duration ladder

Durations are a ladder of named steps, not a continuum. A workable ladder is
small — four or five steps — because the reader's question is always
categorical, never numeric:

| Step | Scale of change | Typical use |
| --- | --- | --- |
| **instant** | state flip with no travel | hover tints, focus rings, pressed states |
| **fast** | small element, short travel | toggles, icon swaps, tooltip entry |
| **base** | element-level enter/exit | list rows, popovers, panel content |
| **slow** | container-level change | modals, drawers, route-level transitions |
| **deliberate** | attention choreography | onboarding reveals, success settles |

Two rules give the ladder its meaning:

1. **Duration follows size and distance.** Bigger things and longer travel
   sit higher on the ladder; a modal animating at hover-tint speed feels
   violent, a hover tint at modal speed feels broken. The ladder encodes this
   so authors pick by *what is moving*, not by taste.
2. **In-between values are vocabulary violations.** A surface that needs
   187ms is either wrong about which step it is, or the ladder needs a step
   — an argument to have with the vocabulary's owner, not a number to inline.
   This is [one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary)
   on the time axis.

## The easing vocabulary

Easings are named by *role in the choreography*, not by curve shape:

- **enter** — decelerating; arriving elements land softly.
- **exit** — accelerating; departing elements get out of the way (and exits
  run a step *faster* than enters — the user asked for the dismissal).
- **move** — standard in-place transitions; symmetric, unobtrusive.
- **expressive** — the one deliberately characterful curve (an overshoot, a
  spring) reserved for moments that earn it.

Naming by role keeps the door open to retuning the curves product-wide —
the same rebinding-vs-fork logic as themes. A component that inlines its own
cubic curve has forked the motion system exactly the way a hardcoded color
forks the palette.

## Reduced motion is a token-layer decision

The strongest argument for motion tokens is the accessibility one. Vestibular
and attention sensitivities make large or repeated motion genuinely harmful
to some users, and every platform exposes a reduced-motion preference. The
honoring strategy determines the cost:

- **Per-component honoring** — each animated surface individually checks the
  preference — costs one conditional per call site, is forgotten at roughly
  the rate anything per-call-site is forgotten, and is unauditable.
- **Token-layer honoring** — the preference rebinds the motion vocabulary
  itself: travel-heavy durations collapse to near-zero, expressive easings
  flatten, and every consumer of the vocabulary complies without knowing it.
  One door, all writers through it.

The near-zero matters: collapsing durations to *exactly* zero breaks
consumers that await a transition's completion event (it may never fire when
the transition never runs); a couple of milliseconds preserves the event
contract while removing the motion. And "reduced" is not "none" — opacity
fades are generally safe and may survive; it is *travel, scaling, and
parallax* that the preference exists to suppress. A reduced-motion story that
simply deletes all feedback replaces one accessibility problem with another.

## Choreography constants live in the same vocabulary

Entrance staggers (per-item delay in a cascade), completion waits, and
debounce-before-reveal thresholds are motion vocabulary too, and they are
disproportionately consumed from the scripting layer — which makes them the
motion axis's contribution to
[cross-language-token-parity](cross-language-token-parity.md). The stagger
that scripts compute and the duration that styles declare compose into one
perceived choreography; when they come from different authorities, retuning
one desynchronizes the other and the cascade tears. Prefer completion events
over derived waits where the platform offers them; where a wait is
unavoidable, it derives from the ladder, never from a local constant.

## What motion tokens do not cover

Semantics stay with the surface: *what* animates, *whether* an entrance is
staggered, which state transitions animate at all — those are owned by the
consuming pattern (tables, async surfaces, modals each carry their own
motion contracts). The vocabulary owns *how long* and *with what character*.
Keeping that boundary is what lets a product retune its entire feel in one
file without touching a single surface's choreography logic.
