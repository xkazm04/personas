---
layer: technique
subject: prompt-assembly
technique: layered-composition
status: forged
laws: [one-validation-door]
shared_with: []
---

# Layered composition

A prompt that matters is assembled, not written: a stack of sections —
identity, policy, capability, context, task — rendered by one program from
typed inputs. This technique is the structural half of the subject: who owns
each section, in what order they stand, and why exactly one assembler exists
per prompt family.

## Sections are owned units, not paragraphs

Each section has four properties fixed at design time:

- **An owner** — the role entitled to change it. Identity and policy belong
  to the product; capability belongs to the registry; context belongs to the
  pipelines that feed it; task belongs to the caller.
- **A change cadence** — and review stakes matched to it. The rarely-changed
  layers are the high-blast-radius ones; treating an identity edit like a
  copy tweak is how personality regressions ship.
- **A trust floor** — the lowest provenance class the section admits.
  Identity and policy admit only authored text; context admits
  machine-derived and (classified, safety-wrapped) untrusted spans.
- **A budget** — a floor for the must-never-degrade sections, an elastic
  allowance plus degradation ladder for the rest.

A section renders independently: given its typed inputs it produces its
text, or its explicit absence. That makes sections the natural unit of
testing — snapshot the section, not just the whole prompt — and the natural
unit of reuse across prompt families that share a layer but differ in
others.

**Absent means absent.** A section with nothing to say is omitted entirely,
heading included. A rendered-but-empty section is not neutral: a heading
over nothing is itself an instruction ("there is a category here, and it is
empty"), and models read it. Emptiness is a rendering decision, made once
in the assembler, not left to whether an input list happened to be empty.

## Order is a stability gradient

Sections stand in order of volatility: the layers that change across months
first, the layer that changes every call last. Three independent forces
pick the same order:

- **Primacy.** Models weight the opening of the prompt; identity and policy
  are what must win when instructions conflict, so they take the position
  of strength.
- **Prefix stability.** Everything upstream of the first volatile byte is
  cacheable — by the provider's prefix cache and by any local
  layer-fingerprint scheme. Interleaving one per-call value into the stable
  layers destroys the entire prefix downstream of it.
- **Readability as argument.** Who I am → what I must not do → what I can
  do → what I know → what you want is an order a reviewer can audit for
  contradiction top to bottom. Sediment order (whatever was appended when)
  cannot be audited at all.

The gradient also disciplines placement decisions: when a new piece of text
wants into the prompt, asking "how often does this change, and who owns it?"
assigns it a section — the question "where should I append this?" never
arises.

## One assembler per prompt family

Every call site that concatenates prompt text is an unvalidated writer to
the model's instruction store. The fix is structural, per
[one-validation-door](../../_laws.md#one-validation-door): all prompt text
for a family passes through one assembler, and the writers are enumerable —
they are the assembler's callers, and they hand it *data*, never prose.

The door is where every cross-cutting guarantee lives, because it is the
only place the whole artifact is visible: budget enforcement (a section
cannot know it is crowding another; the assembler can), trust
classification of incoming spans, delimiter and ordering policy, the
fingerprint (computed over the finished artifact — nothing may be appended
after), and the snapshot tests that make prompt changes diffable in review.

**A door that can be appended to after it closes is not a door.** The
subtlest sprawl does not bypass the assembler — it decorates its output:
call sites concatenating extra sections onto the *returned* prompt, where
the budget, the trust classifier, the fingerprint, and the tests have
already finished looking. One such append is indistinguishable from the
assembler's own work in the final text, which is exactly why it spreads:
each next author sees precedent, not violation. Structural prevention
beats review: give late-arriving layers (memory, collaboration context,
review history) first-class sections and pass them in as inputs; where the
language supports it, return the assembled prompt as a sealed type whose
only consumer is the send path.

A *family* is a prompt with its own layer stack and budget — the main agent
loop, a distillation pass, a report synthesizer are different families.
Families may share section renderers; they never share half an assembler.
The test for whether something is a new family or a variant: if it needs a
different layer set or a different budget allocation, it is a family; if it
only needs different inputs, it is a call.

## What decays without this

Sprawl is not a style problem; it is compounding. Each call-site fragment
is invisible to the budget (so the prompt grows monotonically), invisible
to review (no diffable artifact), invisible to the fingerprint (so cached
sessions go quietly stale), and invisible to the trust classifier (so an
untrusted span can ride into a policy position). Every downstream technique
in this subject assumes the door exists; none of them can be retrofitted
onto concatenation.
