---
layer: technique
subject: templates-scaffolding
technique: template-anatomy
status: forged
laws: [one-validation-door, one-authority-per-vocabulary, identity-survives-reuse, derivation-names-recomputation]
shared_with: []
---

# Template anatomy

A template is the author's half of an interview they will not attend. Its
anatomy is therefore not "the fields we happened to need" but a contract with
three layers, each answering a different consumer:

1. **Identity and browse metadata** — stable id, name, purpose, category,
   author/provenance, version. Consumed by the gallery, the search index, the
   curation tooling. Nothing in this layer is needed to instantiate; all of
   it is needed to *choose*.
2. **The parameter surface** — the declared dimensions of variation. Each
   dimension carries: a question the adopter can understand, an **option
   list** (closed, enumerable, renderable), a **default**, and optionally
   constraints against other dimensions. This layer is what the adoption
   interview renders and what the preview recomputes from.
3. **The payload** — the material that becomes the instance: entity
   definitions, wiring, prompts, configuration. The payload consumes the
   answers; nothing else should.

Keeping the layers distinct is what makes every downstream surface cheap: a
gallery that renders layer 1 never parses payloads; an interview that renders
layer 2 never guesses at questions by introspecting layer 3; an instantiator
that consumes layer 3 receives answers as data instead of re-deriving them.
Collapse the layers into one blob and every surface grows its own partial
parser of the whole — three hand-maintained readings of one artifact, which
is the drift machine
([one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary)
applied to structure: the template's shape is a vocabulary, and it gets one
authoritative schema that every consumer derives from).

## The defaults-within-options invariant

The parameter surface has one invariant that outranks all others:

> **Every default is a member of its own dimension's option list.**

The reasoning is mechanical. The option list is the *entire* universe the
interview can display and the adopter can select. The default is the value
used when the adopter doesn't engage the dimension — which, for the most
common adoption path ("looks good, confirm"), is every dimension. A default
outside the option list therefore produces an instance configured with a
value that **no screen ever showed and no selection can reproduce**: the
preview and the interview describe A/B/C while the artifact means D; the
adopter who later opens the instance's settings finds a value the picker
cannot even represent. The artifact is not wrong about the world — it is
inconsistent *with itself*, which is worse, because no amount of user care
avoids it.

Two design consequences:

- **The invariant is machine-checked at the admission door, not stated in an
  authoring guide.** Nobody code-reviews for membership of a default in a
  list; it is exactly the class of defect that batch authorship produces at
  scale — a generator that drafts options and defaults in separate passes,
  or a bulk edit that touches one field and not its twin — and that a
  five-line structural check kills forever. The measured incident behind
  this rule: **ten choice questions across eight templates live in a
  catalog**, each defaulting to a value outside its own declared options.
  The defect was *introduced by a portability cleanup*: a pass that rewrote
  branded service names to generic roles edited the default strings but not
  the option lists. Caught by an audit, not by the door, because the door
  didn't check.
- **The check lives in one place all writers pass through**
  ([one-validation-door](../../_laws.md#one-validation-door)): the same gate
  whether the template arrives from a human author, a generator, an import,
  or a seed. A generator-side check plus an import-side check plus an
  author-side lint is validation minus the writer added next quarter.

The same door checks the invariant's siblings: every dimension referenced by
a constraint exists; every option referenced by a payload mapping exists;
option ids are unique within their dimension. All are membership checks; all
are trivially mechanical; all are catastrophic to render when violated.

## Options are closed vocabularies with stable identity

Each option carries an **id** distinct from its display label. The id is what
the payload mapping and the stored answers reference; the label is what the
interview renders (and what localization changes freely). Binding answers to
labels — or to option *positions* — breaks under exactly the operations
option lists undergo: relabeling for clarity, reordering for emphasis,
inserting a new middle option
([identity-survives-reuse](../../_laws.md#identity-survives-reuse)). A stored
answer must survive the template's next edit; only ids do. The measured
incident above is this rule failing in the wild: because defaults were bound
to option *label strings*, a mere re-wording pass was enough to orphan them —
under id binding, the same pass would have been a pure display change and the
invariant could not have broken.

Dimensions may constrain each other ("compact layout" removes the "detailed
panel" option). Declare constraints as data on the parameter surface —
dimension X's option x limits dimension Y to subset S — rather than encoding
them in interview logic. Data constraints are renderable (the interview can
grey out and explain), checkable at the admission door (S must be a subset of
Y's options — membership again), and portable across every surface that
renders the interview. Logic constraints are none of these.

## Templates version; instances remember

A template that is never edited is a template nobody maintains. The anatomy
must therefore include a **version** — bumped on any change to the parameter
surface or payload — because two artifacts downstream depend on knowing
*which* template they came from: the instance's provenance stamp (which
template, which version, which answers) and any future "this template has
improved since you adopted" offer. Versioning the whole template as one unit
is almost always right; per-dimension versioning buys nothing until templates
are edited collaboratively, which is a different subject.

What versioning does **not** license is mutation of adopted instances. The
version exists so the divorce can be forensic — see
[adoption-lifecycle](adoption-lifecycle.md) — not so the template can reach
into its offspring.

And one trap, measured twice in one reference system: **a version field
whose value is the same constant on every row cannot be compared, and fails
silently in the safe direction.** A catalog grew a version column, a version
chip, a comparator, and an "update available" badge — over a column holding
the same initial value on all of its hundreds of rows, so the comparison
reported "nothing to update" forever and survived every review. Adding the
field is not the work; making it *carry distinct values* — bumped by the
same door that admits the edit — is. A version apparatus over a constant is
the defaults-outside-options defect's quieter sibling: internally
consistent-looking, structurally unable to do its one job.

## What the anatomy deliberately excludes

- **Live environment references.** Credential ids, service accounts,
  machine paths — the payload declares *requirements* (see
  [readiness-prerequisites](readiness-prerequisites.md)) and *roles* (see
  [template-portability](template-portability.md)); it never embeds the
  author's bindings.
- **Behavioral escape hatches.** A payload field meaning "run this at
  adoption time" turns every template into an installer with the adopter's
  authority. Instantiation applies data; it does not execute the template.
- **Derived counts and summaries** stored in the metadata layer ("5 agents,
  3 triggers") without naming how they are recomputed from the payload
  ([derivation-names-recomputation](../../_laws.md#derivation-names-recomputation))
  — a gallery card that says 5 while the payload holds 6 is the smallest
  possible integrity failure, and it is the one every adopter sees.
