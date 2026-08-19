---
layer: technique
subject: motion
technique: preset-vocabulary
status: forged
laws:
  - one-authority-per-vocabulary
shared_with: []
---

# Preset vocabulary

The unit of a motion system is the **named preset**: one complete, reusable
gesture, defined once in the vocabulary's single home and referenced by name
everywhere it plays. This is
[one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary)
applied to movement — and like every closed vocabulary, its value comes from
what a preset is *required to declare*, not merely from being shared.

## What a preset declares

A preset is not a keyframe block with a name on it. Each entry in the
vocabulary carries four things, designed together:

1. **An intent.** One sentence naming the *communicative job*: "this element
   is being drawn into existence", "this action just succeeded", "this
   surface is idle but alive". The intent is the lookup key in practice —
   authors arrive with a job, not a curve — and it is the test for misuse: a
   success gesture on a neutral state change is wrong even if it looks fine.
2. **A duration class, not a duration.** The preset names a step on the
   token ladder (fast, base, deliberate…), so retuning the ladder retunes
   every preset. A preset that inlines its own milliseconds has forked the
   time axis of the design system.
3. **An easing role.** Enter, exit, move, or the one expressive curve —
   again by reference, so the families stay families.
4. **Its own reduced-motion fallback.** Designed at the same moment as the
   motion, by the same author, preserving the preset's information while
   removing its travel. A vocabulary where fallbacks are someone else's
   later problem produces a product where reduced motion means broken
   feedback (the mechanics and failure modes live in
   [reduced-motion-mechanics](reduced-motion-mechanics.md)).

The library also fixes its **taste constants** — stagger steps, ambient
travel bounds, entrance caps — as named values beside the presets, so the
budgets (see [taste-budgets](taste-budgets.md)) are enforced where the
gestures are defined, not remembered at call sites.

## The vocabulary is small on purpose

A working motion vocabulary is startlingly short — typically well under a
dozen presets covering entrance, emphasis, ambient life, success, and a
hover/press response. Brevity is a feature with teeth: a vocabulary an
author can hold in their head gets *used*; a fifty-preset catalog gets
skimmed once and bypassed, and bypassing is how per-component keyframes
return. When the list starts feeling long, the right response is merging
near-duplicates, not better documentation.

## When a new preset earns existence

The bar for a new word in the language:

- **No existing intent covers the job.** Not "no existing preset looks
  right" — presets are retunable; if the *intent* matches, tune the preset
  for everyone rather than forking it for one surface.
- **At least a second consumer is plausible.** A gesture needed by exactly
  one surface, ever, is that surface's private choreography, and may live
  with the surface — the vocabulary is for the product's shared language,
  not for every animation that exists.
- **It arrives complete.** Intent, duration class, easing role, and fallback
  on day one. A preset admitted without its fallback is a debt the whole
  vocabulary co-signs.
- **It fits the budgets.** A candidate that needs an exemption from the
  entrance cap or the ambient bound is not a new preset; it is a proposal to
  change the budgets, which is a different, bigger conversation.

## Private choreography is allowed — outside the vocabulary

Not all motion is vocabulary. A one-off signature moment (an onboarding
flourish, a celebration) may be bespoke, owned by its surface, budgeted
individually. The rule is not "all motion is presets"; it is "shared motion
is presets, and bespoke motion is *visibly* bespoke" — declared as an
exception where it lives, never a copy-paste of a preset with the numbers
nudged, which is the worst of both: unshared *and* pretending to be the
vocabulary.
