---
layer: technique
subject: accessibility
technique: primitive-level-a11y
status: forged
laws: [one-validation-door, deletion-is-not-repair]
shared_with: []
---

# Primitive-level accessibility

Accessibility scales through whatever layer the codebase reuses. In a
component-composed interface that layer is the shared primitive catalog:
the button, toggle, listbox, tooltip, table, tab strip that hundreds of
call sites consume. Build the contract into those and every consumer
inherits it; leave it out and every consumer independently fails, each
one a separate finding in the next audit. This is
[one-validation-door](../../_laws.md#one-validation-door) applied to
interaction: the primitive is the single door all screens pass through,
and it is the only place enforcement survives the call site added next
quarter.

## The primitive contract

A component qualifies for the shared layer only when it carries all of:

- **Correct role** — the accessibility tree reports what the thing *is*
  (button, switch, listbox option), not what it is built from. A
  clickable container is not a button until it says so and behaves so.
- **Computable name** — the primitive's prop surface makes an accessible
  name *structurally hard to omit*: a required label prop, or an explicit
  escape hatch (an aria-label passthrough) that a reviewer can grep for.
  "The consumer will probably pass children with text" is hope, not a
  contract — icon-only usage is exactly the case that breaks it.
- **Keyboard operability** — activation via the keys native to the role
  (Enter and Space for buttons, Space for checkboxes, arrows within
  composites), delivered by the primitive, never left to consumers.
- **Visible focus** — a focus indicator meeting the contrast floor,
  designed as part of the component's visual spec rather than inherited
  by accident or stripped for aesthetics.
- **Announced state** — state the primitive owns (pressed, expanded,
  selected, busy, invalid) is exposed as ARIA state on the element, so
  assistive technology reads it without any consumer effort.
- **Honest disablement** — a disabled control communicates *disabled*,
  not *absent*; where discoverability matters, prefer focusable-but-
  inoperable with an explanation over vanishing from the tab order.

## Native-first

The cheapest way to satisfy the contract is to not reimplement it. A
native button, checkbox, select, or link ships with role, name plumbing,
keyboard behavior, and state announcements provided by the platform,
tested by decades of assistive-technology interop. A custom lookalike
built from generic containers starts at zero and must reimplement *all*
of it — and the reimplementation is never finished, because the platform
behaviors are more numerous than any checklist (form submission on Enter,
label-click activation, high-contrast rendering, voice-control grammar).

The rule: **a custom primitive wraps or visually restyles the native
element wherever one exists**; it replaces the native element only when
the required interaction genuinely has no native carrier — and then the
full ARIA authoring pattern for that widget, keyboard behavior included,
is the acceptance bar, not an aspiration. A switch is a restyled
checkbox or a real button with switch semantics; it is never a decorated
container with a click handler.

## The catalog audit

Because the primitive layer is where accessibility multiplies, the audit
of a product starts as an **inventory question, not a page tour**: list
the shared primitives, and for each one ask the contract's five
questions — role, name, keyboard, focus, announced state. The output is
a small table with outsized leverage: one row fixed repairs every
consumer at once, and one row failed *quantifies* debt precisely (the
number of consumers is the number of broken call sites).

The audit also surfaces the inverse defect: **near-primitives** — the
same control hand-rolled in multiple features because the shared one was
missing or unknown. Each hand-rolled copy is outside the door; the fix
is consolidation into the catalog, not N parallel repairs.

## Accessible primitives still compose into inaccessible screens

The contract at the primitive level is necessary, not sufficient. The
recurring composition failures:

- **Interactive nesting** — a button inside a clickable row inside a
  clickable card. Each element is individually fine; the composition
  yields ambiguous activation, doubled tab stops, and a garbled tree.
  Rule: one interactive ancestor per gesture; secondary actions are
  siblings, not descendants.
- **Meaning added outside the primitive** — a consumer wraps a compliant
  control in color, iconography, or position that carries meaning the
  control's ARIA state does not ("the red one is failing"). The state
  moved outside the contract; put it back on the element.
- **Chrome swallowing semantics** — layout wrappers that strip roles or
  intercept focus for styling reasons. Composition layers must be
  semantically transparent unless they are deliberately a widget.

Composition rules therefore ship *with* the catalog — a primitive's
documentation states what it may and may not be nested inside — because
the consumers, not the primitives, are where this class of failure lives.

## Regressions: repair the primitive, never mute the signal

When an audit or a user report lands on a primitive, the fix happens in
the primitive — and the anti-pattern to refuse is scoping the fix to the
reporting call site (patching one consumer with local ARIA overrides)
while the primitive keeps shipping the defect to everyone else. Equally
refused: suppressing the failing audit rule because the volume of
findings is embarrassing
([deletion-is-not-repair](../../_laws.md#deletion-is-not-repair)) — the
volume *is* the measurement of the primitive-level defect, and it drops
to zero at the same moment for every consumer when the primitive is
repaired.
