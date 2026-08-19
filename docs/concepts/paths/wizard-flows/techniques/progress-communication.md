---
layer: technique
subject: wizard-flows
technique: progress-communication
status: forged
laws: [count-carries-predicate, derivation-names-recomputation]
shared_with: []
---

# Progress communication

A wizard asks for sustained investment toward an end the user cannot see.
What it owes in exchange is a standing, truthful answer to four questions —
where am I, what remains, what is blocked and why, what have I already
said — visible at every step. Progress display is not decoration on a
wizard; it is the contract that makes starting one rational.

## Everything displayed is a derivation

The indicator renders **from the state model and the step registry** —
current position, the currently-relevant step sequence, each step's
computed validity and visited status
([derivation-names-recomputation](../../_laws.md#derivation-names-recomputation)).
The moment the progress surface keeps its own bookkeeping — its own step
list, its own completion flags, ticked by hand as the user moves — it
becomes a second authority that drifts from the first, and the user sees a
checkmark on a step the model knows is invalid. Every completion marker,
count, and percentage must be recomputable from the model alone; if it
cannot be, it is a claim, not a display.

## Honest counting

"Step 3 of 7" is a count, and a count carries its predicate
([count-carries-predicate](../../_laws.md#count-carries-predicate)): seven
*of what*? In a branching flow the total is a function of answers not yet
given. The honest options:

- **Count currently-relevant steps** and accept that the total moves when a
  branch changes it. Movement is fine; what breaks trust is a total that
  moves *without the user having changed anything*, which indicates the
  display is counting a different set than the flow is walking.
- **Count stages, not steps**, when steps are volatile: group into a few
  named categories (a *category rail*) whose set is stable across branches,
  and show fine-grained position only within the current category. Long
  flows want this regardless — a rail of six named stages orients better
  than a strip of twenty-three dots.
- **Decline to count** and show only named position plus "what's next",
  when the flow is genuinely open-ended (a generated interview has no
  honest denominator until its coverage rubric supplies one).

The dishonest option is the one commonly shipped: a fixed total chosen at
design time that the branching silently falsifies, training users that the
number is an ornament.

Percentages inherit the same rule and add a distortion of their own: percent
implies uniform step weight, which is almost never true (the last step of an
elicitation flow may be half the work). Prefer position-in-sequence to
percent unless the steps genuinely are uniform.

## Markers distinguish three states, not two

For each step in the indicator: **complete** (visited and valid),
**needs attention** (visited and invalid — the user was here and something
is wrong or was invalidated by a later edit), and **not yet reached**. The
common two-state rendering (done / not done) has no way to represent the
most decision-relevant condition — a step the user believes finished that
no longer is, typically after a revisit invalidated downstream answers (see
[branching-and-skipping](branching-and-skipping.md)). That state is exactly
the one the user cannot discover by memory, so it is exactly the one the
rail must show.

The current step is a position, not a fourth completion state — it overlays
whichever of the three states the step is actually in.

## Blocked steps name their blocker

A step the user cannot enter states its prerequisite, in terms of what the
user must *do*: "complete the connection details first", not a disabled
element with no voice. This is the wizard-scale form of the rule the form
standard applies to submit buttons — an unexplained disabled affordance
converts a guided flow into a hunt. The blocker text derives from the same
navigability predicate that disabled the step; two sources here means the
explanation will eventually describe a different rule than the one
enforcing.

The same courtesy applies to the primary action: when "next" is gated on
the current step's validity, the gate's reason must be one action away —
pressing the gated control runs validation and surfaces the errors, rather
than sitting inert and unexplained.

## Announce what changed

Progress that only paints is progress half-communicated. On step change,
the new position and name are announced to assistive technology; on
invalidation of a previously-complete step, the state change is announced,
not just recolored. A flow's most important transitions — entered review,
commit succeeded, a step got blocked — are events in the model, and every
one of them has both a visual and an announced rendering. Color alone is
never the signal, on a rail least of all: complete-green versus
needs-attention-amber is invisible to exactly the users who most need the
rail's memory.
