---
layer: technique
subject: schema-driven-ui
technique: node-vocabulary-design
status: forged
laws: [one-authority-per-vocabulary, failure-not-empty-success]
shared_with: []
---

# Node vocabulary design

The node vocabulary is the set of things a spec is allowed to say. Everything
downstream — the registry, the validator, the emitter's documentation, the
injection analysis — is only as sound as this set is closed and deliberate.

## Closed means closed

A closed vocabulary is a finite list of kinds, each with a typed configuration,
and **no escape hatch**. The escape hatches to refuse, by name, because each is
proposed in every design review:

- **A raw-markup kind** ("just let it emit a fragment for the odd case") —
  this single kind converts the entire spec channel into a markup injection
  surface and makes every other rule in the subject decorative.
- **A style pass-through** (arbitrary style attributes, class names, color
  values on any node) — visual injection: the emitter can now produce
  surfaces that violate the design system, impersonate other surfaces, or
  hide content. The spec selects among designed variants (`emphasis:
  "warning"`), it never carries appearance (`color: "#ff0000"`).
- **A generic container with arbitrary layout parameters** — a layout engine
  smuggled in as a node. Composition is expressed through a small set of
  designed structural kinds (section, group, columns-of-N) with designed
  behavior at every width, not through free coordinates or spacing values.

The test for closure: an adversary who fully controls the spec document must be
unable to render anything the design system could not have rendered on its own.

## Granularity: kinds are semantic, not typographic

Choose kinds at the level of *what the content is*, not *how it is drawn*:
`metric`, `status-list`, `timeline`, `key-value`, `alert`, `text-block` — not
`box`, `row`, `span`, `heading-3`. Semantic kinds keep three parties honest:

- the **emitter** describes meaning, which models do well, instead of layout,
  which they do badly;
- the **renderer** retains freedom to re-realize a kind (denser variant,
  narrow-host variant) without any spec changing;
- the **reviewer** can read a spec and know what the surface claims, which is
  what makes consent over actions meaningful.

A vocabulary that grows typographic kinds is drifting toward being a markup
language; each addition should be challenged as "what content is this, that no
existing kind can carry?"

## Composition rules are part of the vocabulary

Which kinds may contain children, which are leaves, and how deep nesting may go
are declared, not emergent. An unconstrained tree invites two failures: emitters
building baroque nestings no design reviewed, and pathological documents (a
thousand nested groups) that are resource attacks on the renderer. Declare the
containment matrix and a hard depth cap; the validator enforces both.

## Versioning: the vocabulary is an interface

Every stored or transmitted spec names the vocabulary version it was written
against. Growth discipline:

- **Additive changes** (new kind, new optional field) bump the minor version;
  old specs render unchanged.
- **Breaking changes** (removing a kind, retyping a field) require either a
  migration applied at the validation door or an explicit downlevel policy —
  and are worth resisting, because stored specs are long-lived documents,
  emitted by models whose instructions also lag (see
  [emitter-registry-sync](emitter-registry-sync.md)).
- A spec claiming a *newer* version than the renderer knows is treated as
  containing unknown kinds: salvage what is recognized, disclose the rest.

There is exactly one definition of the vocabulary, and the validator, the
registry, and the emitter documentation all derive from it. Two hand-maintained
copies of the kind list is the canonical
one-authority-per-vocabulary violation, and it fails in the standard way: the
copies diverge on the day someone adds a kind and finds only one of them.

## The unknown-kind policy — decided here, once

When the renderer meets a kind it does not know, there are three candidate
behaviors, and a vocabulary design is not finished until it has picked one and
written it down:

1. **Silently skip.** Never acceptable. The surface claims completeness it
   does not have; a scanner that finds nothing and a scanner that could not
   run have been given the same output.
2. **Render a per-node placeholder.** Honest but exploitable: an emitter (or
   whatever is steering it) can fill the surface with junk geometry, and a
   grid of "unsupported node" boxes is a broken-looking surface the user
   cannot act on.
3. **Drop the node and disclose in aggregate.** The node joins the repair
   pass's dropped set; the surface renders everything valid plus one calm
   line — "2 items could not be displayed" — and the drop is recorded with
   its reason for the emitter-improvement loop.

**The standard is (3) for production surfaces**, with (2) as an explicitly
diagnostic mode for spec authors and emitter debugging — a mode a host enables,
never a default. One legitimate exception to note: on an operator-facing
composition surface — where the viewer *is* the person steering the emitter and
can immediately re-ask or reconfigure — a per-node placeholder naming the
unknown kind is actionable feedback rather than junk geometry, and hosts of
that shape may choose (2) deliberately. What no surface may choose is (1). Whichever variant renders, the count and reasons flow through
the same disclosure machinery as validation drops
([spec-validation-and-repair](spec-validation-and-repair.md)); unknown-kind is
just one more drop reason, not a separate code path.
