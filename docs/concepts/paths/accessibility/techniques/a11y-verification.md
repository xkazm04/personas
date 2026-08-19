---
layer: technique
subject: accessibility
technique: a11y-verification
status: forged
laws: [gate-sees-target, failure-not-empty-success, deletion-is-not-repair, count-carries-predicate]
shared_with: []
---

# Accessibility verification

"Accessible" is a decaying claim. Every new surface, refactor, and
visual polish pass is an opportunity to drop a name, strip a focus
indicator, add a hover-only affordance, or mount a live region too late
— and none of these regressions announce themselves to the sighted,
mouse-driven developer who ships them, because the product they
personally experience did not change. A domain whose defects are
invisible to its authors cannot be held by review culture; it is held by
**gates**, layered so that each catches what the cheaper one below it
cannot see.

## Layer 1 — automated audits, with an honest ceiling

Rule-based audit engines walk rendered surfaces and flag mechanical
violations: missing names, broken reference chains, contrast failures on
computed styles, invalid role/state combinations, duplicate ids in
labeling wires. Run them in continuous integration against real rendered
states, and treat findings as build failures, not dashboard entries.

Two honesty requirements:

- **The ceiling is real and stated.** Rule engines detect roughly a
  third of the defects a human audit finds — they cannot judge whether
  a name is *meaningful*, whether focus order is *sensible*, whether an
  announcement fires at the right moment. A green audit is a floor
  cleared, and any report that presents it as "accessible: yes" is
  laundering a partial measurement into a total claim
  ([count-carries-predicate](../../_laws.md#count-carries-predicate):
  "0 violations" always carries *which rules, over which surfaces, in
  which states*).
- **Zero findings must be distinguishable from zero coverage**
  ([failure-not-empty-success](../../_laws.md#failure-not-empty-success)).
  An audit pointed at a route that failed to render, a selector that
  matched no elements, or a scan of the empty shell before content
  mounted reports a perfect score. Assert the instrument first — the
  audit output includes the count of surfaces and elements examined,
  and a count of zero is a failed run, never a pass.

And when a rule fails loudly across many files, the volume is the
measurement — usually of a shared-primitive defect
([primitive-level-a11y](primitive-level-a11y.md)). Disabling the rule to
quiet the report is
[deletion-is-not-repair](../../_laws.md#deletion-is-not-repair)
verbatim: the finding count was the only place the defect was visible.

## Layer 2 — assert the screen-reader-visible output

The highest-value tests in this domain assert **what assistive
technology would receive**, not what the pixels show. They live in the
ordinary unit and component test suites and run on every change:

- **Computed names and descriptions.** Query by role and accessible
  name, not by test ids or text nodes — a test that finds the button
  by its role and name *is* the assertion that a screen-reader user
  can, and it fails the moment a refactor breaks the naming chain.
- **Announcement sequences.** Because the announcer is a provider with
  a queue ([live-region-architecture](live-region-architecture.md)),
  it is testable pure logic: drive a burst of events, assert the exact
  utterance sequence — order, politeness, coalescing, deliberate
  repeats. The channel whose production failure mode is silence becomes
  the best-instrumented one in the suite.
- **State transitions on the element.** Invalid fields gain their
  marking and their described-by wire; toggles flip their state
  property; busy controls expose busy. Screen-reader-only text
  (visually hidden, tree-visible) is asserted as content like any
  other — it is content, for the population it serves.
- **Focus destinations.** After the modal closes, after the row is
  deleted, after the wizard advances: assert where focus *is*. Focus
  handoffs are the least visible behavior in the product and among the
  most commonly broken.

## Layer 3 — the keyboard walk

A scripted traversal that drives the product the way a keyboard user
does: tab through each major surface, asserting that every interactive
control is reached, that order matches reading order, that activation
does the thing (the false-affordance check: every stop must respond),
that no stop is a dead end, and that Escape unwinds what it should. The
walk is slower than unit tests and belongs at the integration tier, on
the main flows rather than every screen — its unique value is catching
*composition* failures (a wrapper that swallowed a tab stop, a portal
that broke the sequence) that element-level tests structurally cannot
see.

## Layer 4 — the contrast gate at the definition site

Where colors are tokenized, every sanctioned foreground/background
pairing is computable, and the AA floor becomes a build gate at the
place pairings are *defined* rather than a sampling problem where they
are used ([token-enforcement](../../design-tokens/techniques/token-enforcement.md),
and the contract in [preference-respect](preference-respect.md)). The
definition-site gate and the rendered-output audit (layer 1) overlap on
purpose: the former is exhaustive over the sanctioned palette, the
latter catches composition that escaped the palette.

## The gate must see the target

The discipline that keeps all four layers honest is
[gate-sees-target](../../_laws.md#gate-sees-target): **assert the
behavior, not the attribute that correlates with it.** The canonical
traps, all real and all green under attribute-checking:

- A live-region attribute present on a node that mounts *with* its text
  — the audit sees the attribute; the user hears nothing.
- A name present in the markup but overridden by a higher-precedence
  source the checker did not compute.
- A focus-indicator style defined in the sheet but suppressed by a
  later reset.
- A skip link that exists, is first in the order, and scrolls the view
  without moving focus — every static check passes; the keyboard user
  presses it and Tab resumes from the top.

In each case the cheap check observed a proxy. The fix is to move the
assertion to the layer that observes the behavior: the announcer test
asserts the *sequence of voiced writes*, the walk asserts where focus
*went*, the name assertion queries the *computed* name.

## Layer 5 — the pass no automation replaces

Once per meaningful release surface, a human drives the main journeys
with an actual screen reader (at least one per platform the product
ships on) and with the screen off or dimmed, plus one pass at 200% text
scale and one under reduced motion (forced through the single preference
signal). This layer is not a formality appended to the pipeline; it is
the only layer that experiences *journeys* — whether the product makes
sense, not whether its elements are individually compliant. Its findings
feed backward: every defect the human pass catches becomes, where
possible, a new layer-2 or layer-3 assertion, so the expensive layer
converges toward confirming rather than discovering.

## Cadence

Layers 1–4 run on every change; they are the regression floor. Layer 5
runs per release surface and after any change to the primitives or the
shell. The asymmetry is deliberate: the automated layers exist so that
the scarce human passes are spent on judgment, and the human passes
exist so the automated layers are never mistaken for the claim itself.
