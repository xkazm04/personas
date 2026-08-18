---
layer: technique
subject: dead-code
technique: carrying-cost-economics
status: forged
laws:
  - count-carries-predicate
  - derivation-names-recomputation
---

# Carrying-cost economics

"Dead code is harmless — it doesn't run" is the sentence that lets corpses
accumulate, and it is wrong in every direction that can be measured. Dead code
runs at build time, at read time, at search time, at translation time, and in the
head of the next engineer who mistakes it for precedent. The technique is to make
those costs *concrete and stated* — because an unpriced backlog is triaged by
annoyance, while a priced one is triaged by value — and to price the elimination
work honestly against them, so the answer can legitimately be "not worth it" for
some corpses.

## The cost classes

- **Per-edit build tax.** The most underestimated, because it is invisible per
  instance and enormous in aggregate. A cross-boundary registry — every registered
  handler, every generated dispatch arm — is compiled on *every* incremental check,
  not only when the registry changes. Measured in one repo at roughly eleven
  milliseconds per registered entry, slightly superlinear, with the registry
  accounting for more than half of every incremental compile: a thousand
  never-invoked registrations cost every developer eleven seconds per edit,
  forever. That figure is repo-specific and travels with its measurement; the
  shape — *per-edit, proportional to registry size, paid by everyone* — is
  general. The wider ledger of what compilation costs and how it is measured is
  [build-economics](../../build-economics/build-economics.md).
- **Catalog multipliers.** A dead catalog key is not one dead line — it is one
  line times every locale, mirror, or generated section that must carry it, plus
  a translation someone will eventually be asked to produce for a string that
  renders nowhere. Catalog dead code scales with the catalog's fan-out.
- **False affordances.** A dead exemplar poisons search-driven development. The
  next reader — increasingly, the next code-writing agent — greps for the pattern,
  finds the corpse, reads it as precedent, and copies it. A zero-adopter "standard"
  is the extreme case: documentation points at it, so it is not merely found but
  *recommended*, and its zero adopters become the evidence that the standard is
  ignorable. Dead code that looks authoritative costs more than dead code that
  looks abandoned.
- **Grep noise and review drag.** Every search over the tree returns the corpses;
  every reviewer of adjacent code reads them to decide whether they matter; every
  onboarding traverses them. This cost is real and unmeasurable per instance,
  which is why it should be stated qualitatively rather than invented numerically.
- **Dependency retention.** A dead island can be the last importer of an entire
  third-party dependency — its install time, its audit surface, its upgrade
  churn, its license review. The deletion that drops an importer count from
  eleven to three does not remove the dependency; the one that drops it to zero
  removes a supply-chain liability. Knowing which is which is part of the
  deletion record.
- **Gate rot.** Dead code inflates the baselines of every convention gate that
  counts it — so a ratcheting gate stops ratcheting, and the "allowed" count for
  a bad pattern is held high by files nobody will ever fix because nobody runs
  them.

## Elimination has costs too

Review attention is finite; a large deletion competes with feature work for the
same reviewer hours. The verification stages of the deletion protocol take real
time. And there is outage risk proportional to the uncertainty the quarantine
technique prices. So the elimination backlog is ranked, not drained: **carrying
cost × confidence** puts the never-invoked registry entries with a measured
per-edit tax at the top and the low-fan-out utility module of uncertain
reachability at the bottom, and it is legitimate — recorded, not silent — for the
bottom of the list to never be reached.

## Costs travel with their predicates and their recomputation

Every cost figure that leaves the measurement — into a document, a decision, a
commit message — carries what was measured and how
([count-carries-predicate](../../_laws.md#count-carries-predicate)): "eleven
milliseconds per entry, incremental check after touching one deep file, three
sample sizes" is a finding; "the registry is slow" is a mood, and "dead code
costs us X hours a year" without a derivation is a number that will be quoted
for years after it stops being true. And because carrying costs *change* — the
registry grows, the catalog gains locales, the compiler gets faster — a stored
cost names its recomputation
([derivation-names-recomputation](../../_laws.md#derivation-names-recomputation)):
the script, the command, the sample protocol that produced it, so the next
person deciding whether a deletion is worth it can refresh the price instead of
inheriting a stale one.

## The economics as a design input

Priced carrying costs feed back into how things are built. A registry whose
per-entry cost is known gets an inventory instrument installed *early*, because
the tax is now visible; a catalog whose fan-out is measured gets a dead-key
scanner in the same change that adds the tenth locale; a shared-primitive tier
whose zero-adopter count is tracked stops shipping standards without a first
adopter. The subject's ultimate economy is not the deletion sweep but the
prevention: an artifact family whose carrying cost is priced and whose corpses
are instrumented rarely needs a funeral, because nothing gets to lie in state.
