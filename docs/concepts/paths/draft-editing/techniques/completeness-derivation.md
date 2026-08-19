---
layer: technique
subject: draft-editing
technique: completeness-derivation
status: forged
laws: [derivation-names-recomputation, count-carries-predicate]
shared_with: []
---

# Completeness derivation

A long-lived draft usually feeds a promotion gate — publish, activate,
deploy, submit for review. *Completeness* is the draft's readiness for that
gate, and this technique holds it to three commitments: it is **derived,
never stored**; it is **an enumerable checklist, never a bare score**; and
it **gates promotion, never saving**.

## Derived, never stored

A persisted "complete" flag is a cached derivation with no recomputation
story: it goes stale the moment a requirement changes, an edit invalidates
a previously-met condition, or a migration reshapes the entity — and a
stale *true* waves an unready draft through the gate. Compute readiness
from the draft on demand
([derivation-names-recomputation](../../_laws.md#derivation-names-recomputation));
if a snapshot must be persisted for query purposes (listing "ready"
entities cheaply), it is a cache that names the derivation that refreshes
it, and the gate itself always re-derives.

Recomputation is cheap by construction when requirements are grouped by
region: a patch invalidates only the touched region's requirement results,
mirroring the dirty-tracking cost discipline.

## A checklist of named requirements

Completeness is a set of requirements, each carrying:

- **a name** — stable identity, usable in messaging and telemetry;
- **a predicate** — evaluated against the draft, pure, no side effects;
- **a pointer** — which region (and ideally which field) satisfies it;
- **a severity** — required for promotion, or advisory (recommended but
  not blocking). The two must not blur: advisory items inflating the
  blocking count teaches users the gate exaggerates; blocking items
  demoted to advice ship unready work.

The pointer is what turns the gate from a bouncer into a guide: "2 of 6
remaining" is a wall, "add at least one capability — Capabilities tab" is a
path. Every unmet requirement is a navigable instruction, and the
promotion surface renders them as such.

Any aggregate that travels — a percentage, a fraction, a progress ring —
carries its requirement set
([count-carries-predicate](../../_laws.md#count-carries-predicate)): "80%
ready" is 80% *of a named checklist*, or it will be quoted against a
different checklist next quarter. When the requirement set changes,
historical figures are not comparable, and surfaces that trend readiness
over time must say so.

## Completeness is not validity

The [form](../../form/form.md) standard owns field validity — is each value
well-formed within its own constraints. Completeness is a different
question at a different altitude: are the *right things present and
coherent for promotion*. A draft can be perfectly valid field-by-field and
nowhere near publishable (nothing configured yet), and a draft can be
complete by checklist while one field holds an invalid value (which the
save door, not the promotion gate, is responsible for stopping). Keep the
two vocabularies apart in code and copy; "invalid" points at a field,
"incomplete" points at a requirement.

## Gates promotion, never persistence

The defining rule: **an incomplete draft saves freely**. Drafts exist
precisely to hold unfinished work durably; a save door that demands
completeness converts every interruption into data loss and every partial
idea into an untracked scratch file somewhere else. The requirement
checklist gates the *transition* — draft to published, inactive to active —
and only that transition.

The corollary for the promotion control: prefer an enabled control whose
activation surfaces the unmet checklist (each item a link to its region)
over a disabled control with a tooltip. The disabled-with-no-explanation
promotion button is the draft-scale version of the disabled submit the
form standard prohibits, and it fails the same way — the user hunts for
the blocker the system already knows.

## Prohibitions

1. No stored completeness the gate trusts without re-deriving.
2. No requirement without a name, a predicate, and a region pointer.
3. No blurring of blocking and advisory requirements.
4. No bare percentage — the figure travels with its checklist.
5. No completeness precondition on saving.
6. No disabled promotion control as the sole explanation of unreadiness.
