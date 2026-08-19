---
layer: technique
subject: ui-controls
technique: composition-contracts
status: forged
laws: []
shared_with: []
---

# Composition contracts

A primitive's API is a boundary treaty: what the consumer configures, what
it fills, what it can attach to, and what it must never touch. Libraries
die at this boundary in both directions — too closed, and consumers fork
the primitive to get one seam it refused to expose; too open, and every
"reusable" control is a bag of parts whose guarantees no longer hold. The
treaty has four articles.

## State ownership is chosen per control, deliberately

Every stateful control answers: who owns the value — the control
(uncontrolled: it manages its own state, the consumer reads results) or the
consumer (controlled: the consumer holds the value, the control renders it
and requests changes)? The failure is not either choice; it is the
**half-controlled hybrid** that arises by accident: a control that keeps an
internal copy *and* accepts an external value, syncing them on some updates
and not others, so the two owners drift and the bug reports say "sometimes
it snaps back."

The rule: support one mode deliberately, or both *explicitly* — detected
once, at first render, with mode switches rejected loudly. And the events
the control emits describe **intent** ("value change requested, here is the
next value"), not internal mechanics, so a controlled consumer can decline
a change without the control fighting it.

## Seams are declared slots, not accidents

The places a consumer may inject content are named in the API: a leading
icon slot, a trailing adornment, a label, a description. Declared slots
keep the contract intact — the control still owns layout, spacing,
truncation, and the accessible relationship between the parts. The
alternatives both fail: free-form children on a control that needs
structure ("anything may be inside a button") quietly breaks geometry and
naming; and the opposite, prop-per-pixel configuration, recreates the open
styling channel that [variant-discipline](variant-discipline.md) closed.
Render-prop/asChild-style structural seams — where the consumer supplies
the element and the primitive contributes behavior — are the powerful,
expensive end of the spectrum: use them for genuinely structural needs
(the trigger of an overlay, a table row that must be a link), and document
that the consumer now co-owns the contract.

## Forwarding is a guarantee, not a courtesy

A primitive sits between its consumer and the platform, and it must not be
opaque in either direction:

- **Focus and element handles are forwarded**, so a parent can focus the
  control, measure it, or anchor an overlay to it.
- **Host attributes pass through** — accessibility attributes, test ids,
  data hooks — merged, not clobbered, with the primitive's own. A control
  that swallows these forces the fork it was built to prevent: the first
  consumer who needs to attach a tooltip or a test hook and cannot, copies
  the file.
- **Event handlers compose.** The consumer's handler runs alongside the
  control's internal one; supplying an on-press must not disarm the
  double-press guard or the analytics the primitive owns. One lesson from
  practice: when a guard keys on the handler's *return value* (a promise
  means "in flight"), the API has a silent trapdoor — a consumer wrapping
  the async call in a fire-and-forget arrow returns nothing and disarms
  the guard without an error. Either the guard must not depend on a
  convention the type system cannot enforce, or the convention is
  detected by a signature rule (see
  [adoption-enforcement](adoption-enforcement.md)).

## Internals are sealed

The other half of the treaty: what no consumer may override, because it
carries the contract —

- the **state machine** (a busy button's disable-while-pending, a
  stepper's clamp);
- the **accessibility wiring** (roles, relationships, announcements) —
  overridable wiring is wiring that will be overridden wrongly;
- the **contract-bearing geometry** (the busy state's size-holding, the
  focus ring), which the styling hatch must not reach.

Sealing is only legitimate alongside the forwarding guarantees above: a
control may be strict about *behavior* precisely because it is generous
about *attachment*.

## Wrap, don't fork

The healthy extension pattern is the **domain wrapper**: a thin component
in feature territory that presets variants, binds domain vocabulary, and
*still renders the primitive*. Wrappers are how a library meets a domain
without absorbing it — they inherit every contract fix the primitive ever
receives. The pathology is the **fork**: a copy that re-implements the
control, born the day some seam was missing, and frozen at the contract of
that day. The audit question for any look-alike found in feature code is
mechanical: *does the primitive still render underneath?* If yes, it is
composition working. If no, it is a defect in this treaty — find the seam
whose absence caused it, fix the seam, and route the fork back (see
[adoption-enforcement](adoption-enforcement.md)).
