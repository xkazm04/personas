---
layer: golden-path
subject: ui-controls
status: forged
techniques:
  - control-inventory-and-discovery
  - micro-interaction-contracts
  - variant-discipline
  - composition-contracts
  - adoption-enforcement
  - action-busy-states@async-ui-states
evidence:
  - src/features/shared/components/CATALOG.md                    # the generated catalog — 128 primitives, header names its generator, entries warn about traps
  - scripts/docs/gen-shared-catalog.mjs                          # the generator: walks the tree, reads @catalog tags, CURATED overrides for load-bearing warnings
  - src/features/shared/components/buttons/Button.tsx            # closed variant/size enums → token bundles; promise-sniffing double-press guard; width lock while busy; disabledReason tooltip
  - src/features/shared/components/buttons/AsyncButton.tsx       # wrapper-not-fork over Button; synchronous in-flight ref; reduced-motion fallback path
  - src/features/shared/components/buttons/CopyButton.tsx        # copy feedback window with managed/unmanaged duality; refuses to flash success for an empty or failed write
  - src/hooks/utility/interaction/useCopyToClipboard.ts          # the ONE clipboard door (copyText); timed feedback with unmount-safe timer
  - src/features/shared/components/display/Tooltip.tsx           # open delay from the motion token ladder; aria-describedby; Escape dismiss; flip+clamp positioning
  - src/features/shared/components/forms/NumberStepper.tsx       # bounds clamped at every door; live onChange vs settled onCommit; empty-as-state via allowEmpty; hold-to-repeat acceleration
  - src/features/shared/components/forms/AccessibleToggle.tsx    # switch role/state/keyboard minted once inside the primitive
  - src/features/shared/components/layout/PanelTabBar.tsx        # id-keyed tabs, tablist role, arrow-key roving added when its absence was measured
  - .claude/CLAUDE.md                                            # the don't-hand-roll table — temptation-keyed routing in the instructions every session reads
counter_evidence:
  - src/features/shared/components/feedback/LoadingSpinner.tsx   # control-shaped shim that renders nothing — the catalog entry now carries the warning
  - src/hooks/utility/interaction/useRovingTabIndex.ts           # zero-adopter primitive: built, never routed to — a standard nobody ratified
deviations:
  - w12-ui-controls   # anchor in docs/concepts/golden-path-deferred-fixes.md
  - w1-form            # adoption inversion: 4 field-primitive adopters vs 19 shadow wrappers — the library pathology, measured
  - w10-accessibility  # zero-adopter roving-focus hook — a primitive that exists but routes nobody
---

# UI controls & primitives

A control is the smallest interactive unit a product ships — a button, a
toggle, a tooltip, a copy affordance, a tab strip, a numeric stepper. This
subject is not about any one of them. It is about the **shared control
library as a system**: the set of primitives every feature draws from, the
contracts each primitive keeps, and — the part most libraries omit and the
part that decides whether the library is real — the machinery that gets the
primitives *adopted*.

The defining observation, measured rather than assumed: **the failure mode of
a control library is not bad components, it is unused ones.** The right
primitive exists, is well built, is even documented — and shadow copies bloom
beside it, one per feature team, each missing a different third of the
contract. A field primitive with four adopters and nineteen hand-rolled
look-alikes is not a library with a gap; it is a folder of good intentions.
The library's job therefore includes **routing**: catalogs that answer "does
this exist?" in seconds, nudges at the moment of temptation, and a ratchet
that converts the shadow copies one touched file at a time. Half the
techniques of this subject are about that, on purpose.

## Every control is a contract, not a style

What makes a primitive worth centralizing is never its appearance — visuals
are a thin layer over the token vocabulary, owned by
[design-tokens](../design-tokens/design-tokens.md). What is worth
centralizing is **behavior**: the state machine, the timing, the semantics,
the accessibility wiring. Each control has a contract precise enough to test:

- The **busy button**'s affordance is tied to the lifetime of the promise it
  triggered — acknowledgment in place, structural double-press immunity,
  geometry held. That doctrine is owned by
  [async-ui-states](../async-ui-states/async-ui-states.md) as the shared
  [action-busy-states](../async-ui-states/techniques/action-busy-states.md)
  technique; the library's job is to make the compliant button the *easiest*
  button to reach for.
- The **copy affordance** owes the user a confirmation window: the press
  succeeded, here is the proof, and in two seconds the control is ready
  again — announced, not just painted.
- The **toggle** carries switch-vs-checkbox semantics: a switch acts *now*, a
  checkbox is a deferred assertion collected at submit. Picking the wrong one
  is a semantic lie the styling cannot repair.
- The **tab strip** has a selection model (which tab is active, whether
  selection follows focus) and an identity rule (tabs keyed by what they are,
  not where they sit).
- The **stepper** has bounds, a clamp policy, and a reconciliation story for
  typed input.

These micro-contracts — the state machines and timing windows behind the
small controls — are the
[micro-interaction-contracts](techniques/micro-interaction-contracts.md)
technique. The accessibility half of each contract (name, role, keyboard
model, announcement) is minted **once, inside the primitive**, so that every
adopter inherits it; the standard for that layer is owned by
[accessibility](../accessibility/accessibility.md) and its
[primitive-level-a11y](../accessibility/techniques/primitive-level-a11y.md)
technique. The division of labor is the point: a feature
that hand-rolls a control re-answers questions the library already answered,
and usually answers at least one of them wrong.

## Variants are closed sets

A primitive's variant axes — size, tone, emphasis — are **enumerated, few,
and drawn from the token vocabulary**, never free-form styling props. An
open-ended style channel on a shared control is a fork in disguise: every
call site that reaches through it creates a private variant the library
cannot see, name, or migrate. The discipline — orthogonal axes, enum over
boolean flags, variant names as a governed vocabulary — is the
[variant-discipline](techniques/variant-discipline.md) technique.

## Composition seams are declared, not discovered

What a consumer may override, what it may fill, and what it must never touch
is part of the primitive's public contract: controlled/uncontrolled behavior
chosen deliberately, slots for adornments declared by name, host-element
attributes and focus handles forwarded so wrappers and tests can attach —
and the state machine and accessibility wiring sealed. The healthy growth
pattern is the **domain wrapper** (a thin preset over the primitive, which
still renders it); the pathology is the fork (a copy that re-implements it).
The line between them, and the API decisions that keep consumers on the
right side of it, are the
[composition-contracts](techniques/composition-contracts.md) technique.

## The library is only as real as its adoption

Two techniques carry the system half of the subject:

- **Discovery** — a primitive nobody can find does not exist. The catalog is
  **generated from annotations in the source**, never hand-curated into
  staleness; the routing artifact is organized by *temptation* ("about to
  write a clipboard call?") rather than by component name; and placement
  rules keep the primitives tree domain-free so the catalog stays trustable.
  [control-inventory-and-discovery](techniques/control-inventory-and-discovery.md).
- **Enforcement** — discovery routes the willing; the ratchet handles the
  rest. Shadow copies are detected by their *signature* (the raw platform
  call, the hand-painted overlay) rather than by name; nudges fire at
  authoring time; gates that must hold are wired to fail the build, because
  a warn-level rule enforces nothing at any gate, by construction; and
  migration advances fix-as-you-touch, tracked as an adoption ratio whose
  numerator and denominator are both defined by a stated detector.
  [adoption-enforcement](techniques/adoption-enforcement.md).

The two are one loop: every shadow copy the detector finds is also evidence
about routing — either the primitive was undiscoverable at the moment of
temptation, or it exists but demands more than the hand-roll (a signature
mismatch, a missing variant), which is product feedback for the library. A
primitive with **zero adopters** is the loop's loudest signal, and it points
at the library, not at the consumers.

## What this subject does not own

- **Field composition** — label + control + error as a unit, validation
  timing, submit lifecycles — is [form](../form/form.md). The control
  library supplies the raw input controls; the form subject owns their
  assembly into fields.
- **Busy, loading, empty, and failed states** — the async state doctrine —
  is [async-ui-states](../async-ui-states/async-ui-states.md); this library
  references its action-busy-states technique rather than restating it.
- **Primitive-level accessibility standards** (naming, keyboard models, live
  regions) are [accessibility](../accessibility/accessibility.md); the
  library is where those standards get *implemented once*.
- **The visual vocabulary** — color, spacing, radius, type, motion tokens —
  is [design-tokens](../design-tokens/design-tokens.md); controls consume
  tokens and add no colors of their own.

## The techniques

- [control-inventory-and-discovery](techniques/control-inventory-and-discovery.md) —
  the generated catalog, annotation tags, temptation-keyed routing tables,
  and placement rules; the answer to "does this exist and where?"
- [micro-interaction-contracts](techniques/micro-interaction-contracts.md) —
  the behavioral contracts of the small controls: copy feedback windows,
  tooltip timing, toggle semantics, stepper bounds, tab selection models.
- [variant-discipline](techniques/variant-discipline.md) — closed variant
  sets: enumerated axes bound to tokens, enums over boolean flags, and the
  governed lifecycle of adding or retiring a variant.
- [composition-contracts](techniques/composition-contracts.md) —
  controlled/uncontrolled policy, declared slots, forwarding guarantees,
  sealed internals, and the wrapper-not-fork rule.
- [adoption-enforcement](techniques/adoption-enforcement.md) — shadow-copy
  detection by signature, nudge and gate tiers, the fix-as-you-touch
  ratchet, and adoption ratios with stated predicates.
- [action-busy-states](../async-ui-states/techniques/action-busy-states.md)
  *(shared, owned by async-ui-states)* — the pressed control's busy
  contract; referenced here because the button primitive is its natural
  carrier.
