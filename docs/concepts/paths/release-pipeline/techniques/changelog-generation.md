---
layer: technique
subject: release-pipeline
technique: changelog-generation
status: forged
laws: [derivation-names-recomputation, count-carries-predicate]
shared_with: []
---

# Changelog generation

A changelog answers one question for a stranger: *what changed for me?* The
author knows too much to answer it well by hand — they remember the hard
changes rather than the visible ones, they write at the deadline, and they
describe implementation when the reader wants effect. The standard removes
authorship at release time entirely: the changelog is **compiled from commit
history** written under a convention, filtered for audience, and assembled
by a tool. Release day edits nothing; it cuts what already accumulated.

## The convention is the data model

Generation only works if history carries structure: each change declares its
*kind* (feature, fix, performance, internal churn) and names its *area* in
terms a user could recognize. This is a writing tax paid at commit time, and
it is the correct time to pay it — the author still remembers what the
change does and who will notice. The convention needs three properties:

- **Closed kind vocabulary.** A fixed set of kinds, machine-checked at
  commit time. An open set degrades into free text and the compiler back
  into a formatter.
- **A breaking-change marker** that cannot be missed by the filter, because
  breaking changes are the one entry class that must *never* be dropped from
  any audience's view.
- **A subject line that survives extraction.** The generated entry is the
  subject line; a subject written for teammates ("fix the thing from
  review") becomes garbage in the compiled output. The bar: a sentence a
  user could read.

## Filtering is a rule, not a mood

The kinds split into user-facing (features, fixes, performance,
deprecations, breaking changes) and internal (refactors, tests, build
plumbing, documentation churn). The compiler **drops internal kinds by
rule**. This is the load-bearing decision of the whole technique: an
unfiltered generated changelog is worse than a hand-written one, because it
buries the four entries a user cares about under forty they cannot parse —
completeness without relevance. The filter belongs in the tool, versioned
with the code, so "what appears in the changelog" is a reviewable property
rather than a per-release editorial act.

The count that comes out of the filter carries its predicate
([count-carries-predicate](../../_laws.md#count-carries-predicate)): "12
changes" in a release announcement means *12 user-facing entries after
filtering*, and the tool should say so, because the unfiltered number will
otherwise be quoted as if it were the filtered one.

## The unreleased ledger

Between releases, compiled entries accumulate under an explicit *unreleased*
heading — a standing answer to "what will the next release contain?" that
costs nothing to maintain because the tool maintains it. Cutting a release
renames the heading to the new version and date and opens a fresh empty one.
Two disciplines keep the ledger honest:

- **A user-visible change must appear in it in the same change that ships
  the behavior** — enforced at review, so the ledger is complete by
  construction rather than reconstructed at the deadline.
- **An empty unreleased section at release time is a question, not a
  formatting state.** Either the release genuinely contains nothing
  user-visible (so why is it shipping?) or the convention broke upstream and
  the compiler is blind. Halt and find out which.

## Regeneration discipline

The changelog is a derived value, and every derived value names its
recomputation ([derivation-names-recomputation](../../_laws.md#derivation-names-recomputation)).
The corollary bites here more than anywhere: **hand edits to the generated
output are lost on the next compile.** Polish — better phrasing, grouping,
a highlight paragraph — must flow into the sources the compiler reads
(amendable history, a curated-entries sidecar the tool merges, a
release-notes preamble slot), never into the output file. A project that
edits the output has silently forked the changelog into two authorities:
the file says one thing, regeneration says another, and the next release
publishes whichever the operator happened to run last.

Generation gives completeness; it does not give voice. The mature shape is
layered: the compiled, filtered ledger is the floor every release gets for
free, and a human-written highlights section — clearly a distinct layer,
sourced from its own slot — sits above it for releases that warrant one.
