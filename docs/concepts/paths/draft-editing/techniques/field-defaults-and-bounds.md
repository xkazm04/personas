---
layer: technique
subject: draft-editing
technique: field-defaults-and-bounds
status: forged
laws: [one-validation-door, one-authority-per-vocabulary]
shared_with: []
---

# Field defaults and bounds

An editable field is more than a name and a type: it carries a default, a
range, sometimes a unit, and — for the interesting ones — a history. This
technique is the discipline of keeping all of that **in the field's
definition**, stated once, next to the field it governs, where the next
reader and the next tool will actually find it.

## Colocation: the definition is the authority

Defaults, bounds, and units scattered across the control that renders the
field, the handler that mutates it, and the mapping that persists it are
three authorities for one fact, and they drift the first time the fact
changes ([one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary)
— a field's operational envelope is a vocabulary with one definition). The
draft's construction step reads defaults from the definition; the patch
door reads clamps from the definition; the editor renders ranges from the
definition. One place changes, everything follows.

For enumerated fields, the option set is the same kind of authority: the
definition owns the values, and the control renders what the definition
declares — never a hand-copied list in the view.

## A default is a decision

Every default answers "what happens for the user who never thinks about
this" — which makes it a product and operations decision wearing a
constant's clothes. Two disciplines follow:

- **Defaults carry rationale.** A bare number invites "cleanup" by the next
  engineer who finds it oddly specific. One line of *why* — what the value
  balances, what it protects — converts the constant into knowledge.
- **Defaults with incidents carry the incident.** When a default was moved
  because of a real cost — an outage, a runaway bill, a data-loss window —
  the definition records that history at the value: what happened, what the
  old value was, why this one. This is the **documented-incident
  discipline**: the scar tissue lives on the wound, because a rationale
  filed anywhere else is a rationale the next editor of this line never
  sees. An oddly conservative timeout with its incident attached survives
  refactors that a bare `30` would not.

## Bounds: clamped at the door

Range constraints (minimum, maximum, step, length) are enforced **at the
patch door** ([one-validation-door](../../_laws.md#one-validation-door)) —
one clamp all writers pass through, whether the value arrived from a
slider, a numeric input, a paste, or a programmatic patch. Per-control
enforcement misses the writer added later; door enforcement cannot.

Two grades of bound, kept distinct:

- **Hard bounds** — values outside them are meaningless or dangerous; the
  door clamps or rejects, and the control's affordance (slider range,
  spinner limits) mirrors the same definition so users rarely meet the
  clamp.
- **Advisory bounds** — values outside them are legal but suspicious; the
  door admits them and the editor flags them (a warning, not a block).
  Collapsing advisory into hard silently forbids expert configurations;
  collapsing hard into advisory ships the meaningless value.

Silent clamping of *typed* input deserves care: a user who types a value
and sees a different one persisted, with no acknowledgement, files that as
corruption. Clamp visibly — show the applied value, note the limit.

## Units belong to the definition

A bare number in a definition is a misread waiting to happen — seconds
versus milliseconds is the canonical incident generator. The definition
names the canonical unit; presentation may localize or rescale, but the
draft stores canonical, and the boundary converts. A field whose unit
lives only in a label can be wired to the wrong scale without any check
noticing.

## Absent is not default

Distinguish "the user never set this" from "the user chose the value that
happens to equal the default" wherever the distinction has consequences:
inheritance chains (an unset value follows the parent; a set-equal value
does not), and default evolution (raising a default should lift only the
users who never chose). Collapsing the two at write time — persisting the
default into every record — freezes today's default into every entity and
forfeits both behaviors. Persist the sentinel for *unset*; resolve to the
default at read time, through the definition.

## Prohibitions

1. No default, bound, unit, or option set defined anywhere but the field's
   definition.
2. No bare oddly-specific default — rationale travels with the value, and
   incidents travel with the values they produced.
3. No range enforcement outside the patch door.
4. No silent clamping of typed input.
5. No unit that exists only in presentation.
6. No persisting resolved defaults where absent-versus-chosen matters.
