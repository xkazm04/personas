---
layer: technique
subject: schema-driven-ui
technique: registry-mapping
status: forged
laws: [one-authority-per-vocabulary, failure-not-empty-success]
shared_with: []
---

# Registry mapping

The registry is the single table that maps each node kind to its realization.
It is where the closed vocabulary becomes concrete, and it is the *one
authority* from which everything else about a kind is derived — the renderer's
dispatch, the validator's per-kind schema, the emitter's documentation, the
diagnostic tooling's kind list. If a kind is not in the registry, it does not
exist; if it is, everything that needs to know about it reads it from here.

## The registration shape

A registry entry is more than a component pointer. The full shape a
principal-quality registry carries per kind:

- **The component** that realizes the kind — a blessed primitive or a thin
  composition of blessed primitives, never a bespoke rendering that bypasses
  the design system.
- **The config contract** — a validator (schema or equivalent) for the kind's
  configuration payload. Per-kind config validation lives *here*, keyed by
  kind, so the validation door can enforce it generically: the door walks the
  tree, looks up each node's kind, and applies that kind's validator. A new
  kind gets validation by being registered, not by someone remembering to
  extend a central switch.
- **Defaults** — the canonical values for optional config, applied in one
  place so every renderer variant agrees on what an omitted field means.
- **The degraded states** — what this kind renders when its data is empty,
  when its data fetch fails, and when a capability it needs was not injected.
  Designed per kind, because "empty metric" and "empty timeline" are
  different designs, and because a kind failing must degrade *itself*, never
  blank its siblings or the surface.
- **Emitter-facing description** — the one-paragraph account of when to use
  this kind and an example config, from which the emitter's vocabulary
  documentation is generated (see [emitter-registry-sync](emitter-registry-sync.md)).

## Dispatch is a lookup, not a conditional

The renderer's core is: resolve kind in registry, validate config against the
entry's contract, render the entry's component with the validated config plus
the host capabilities. There is no growing switch statement, no special-cased
kind, no "temporary" inline rendering for the kind someone needed on a Friday.
The moment dispatch has two paths, the registry stops being the authority and
the vocabulary has quietly forked.

A lookup miss — a kind absent from the registry — is not the registry's
decision to make. It routes to the unknown-kind policy decided in
[node-vocabulary-design](node-vocabulary-design.md) and is accounted for by the
repair pass's disclosure; the registry's job is only to make the miss
detectable, never to shrug it into an empty render (a missing kind that renders
as nothing is a failure spelled as empty success).

## Isolation: one node's failure is one node's problem

Each registered component renders inside a containment boundary. A kind whose
component throws, whose data resolves to garbage, or whose config passed
validation but still defeats the component must degrade to that kind's designed
failure state — inside its own slot, at its own geometry — while the rest of
the surface stays alive. A spec-driven surface without per-node containment
hands every emitter mistake a blast radius of the whole screen, and emitter
mistakes are not exceptional here; they are the operating condition the
pattern exists to absorb.

## The registry stays inside the design system

Registered components take their appearance entirely from the design system
and their content entirely from validated config. Two leaks to police:

- **Config leaking into appearance** — a kind whose config grows `width`,
  `color`, `columns` fields is the style pass-through returning through the
  side door. Variants, not values: the config may say `tone: "critical"`
  because the design system defines what critical looks like.
- **Registry entries importing application state** — a registered component
  that reaches into a global store for its data breaks the renderer's
  portability contract; data arrives through the capability object or
  through config, full stop
  ([host-capability-injection](host-capability-injection.md)).

## Growth discipline

Adding a kind touches the registry entry and nothing else: dispatch, validation
wiring, emitter docs, and diagnostics all pick it up derivationally. That
property — one edit site per new kind — is the measurable health check of the
whole subject. When adding a kind requires edits in three files that must
agree, the one-authority rule has already been lost and the drift clock is
running.
