---
layer: technique
subject: status-vocabulary
technique: vocabulary-chain-integrity
status: forged
laws: [one-authority-per-vocabulary, gate-sees-target, failure-not-empty-success]
shared_with: []
---

# Vocabulary chain integrity

A closed display vocabulary is **one artifact with four obligations**, and
a change discharges all four in the same commit or it has shipped a bug.
The four layers — storage constraint, wire token, label catalog, rendered
presentation — are not four definitions of the vocabulary; they are one
definition and three derivations, and every defect in this area lives at a
joint where a derivation was hand-maintained instead.

## The authority is the typed definition at the source of writes

Define the member set **once**, as a closed type in the language that
writes the values — not as a free string guarded by a storage constraint.
The distinction is load-bearing:

- **A storage constraint is a write guard, not a contract.** It stops bad
  rows and teaches consumers *nothing*: no layer above it can enumerate
  the members, so nothing above it can be checked against them. A
  vocabulary that exists only as a constraint is safe in the database and
  broken on screen — measured in one repo at 49 of 66 storage-level
  vocabularies with **zero** label coverage, invisible because a member
  list embedded in a migration string is unreadable by every layer above.
- **A closed type is enumerable**, so the wire artifact can be generated
  from it, the label table can be keyed by it, and a missing case can be
  a compile error instead of a grey pill.

Mirror the authority into the storage constraint anyway (defense in
depth: the database rejects what the type forbids), and validate **at the
door** before the write, so a bad token from an external payload becomes
a structured validation error naming the allowed members — not a raw
constraint violation nobody can act on.

## The wire type is the chain's real contract

The generated wire artifact — a string-literal closed type derived from
the authority — is the only artifact producer and consumer can *both*
typecheck. Skipping the generation step is the root deviation from which
every downstream one grows: once the field crosses the boundary typed as
a bare string, `Record<string, …>` is the only lookup that compiles, the
exhaustiveness the union would have given is silently off, and the
runtime fallback (`?? token`) buys back what the type lost — which is
exactly how the tokens someone forgot become the tokens users see raw.
One repo measured 155 status-shaped fields crossing as bare strings
against 88 that crossed as closed types; a sibling with a full contract
generation pipeline defeated it identically by declaring the fields as
plain strings server-side, so its generated contract contained zero
enums. **The seam breaks at serialization in every stack measured; guard
that joint first.**

## Drift gates between the layers

Each adjacent pair of layers can drift, and each needs its own gate —
keyed on the authority, per
[gate-sees-target](../../_laws.md#gate-sees-target):

- **Authority ↔ storage constraint.** Mirrored by convention in every
  repo measured, verified by none. The gate is a test that parses the
  storage definition and diffs it against the type's members.
- **Authority ↔ label catalog.** The strongest form is a compile-time
  coverage check: a small conditional type asserting that the label
  table's key set covers the wire union, so the build error **names the
  missing members**. It fires at the keystroke that adds the variant —
  not in CI, not at test time — and one line per vocabulary is also the
  missing declaration of *which* catalog section labels *which* union,
  a link that otherwise exists nowhere and must be inferred by member
  overlap. Hand-maintained parity tests (a literal mirror of the member
  list inside a test) are the fallback where no type system spans the
  boundary — they work, and they do not scale, and they catch drift at
  test time rather than at the keystroke.
- **Catalog ↔ locales.** A label absent for a token is absent
  *identically in every locale*, so no locale-parity board can see it —
  the domain-coverage blind spot; see the owning subject's
  [completeness-gates](../../i18n/techniques/completeness-gates.md).
- **Presentation table ↔ union.** Key the table by the union and a new
  member is a compile error; key it by string and a new member is
  `undefined` at runtime — a badge with no classes and no label.

## Registries that do not see their writers

The chain's failure generalizes beyond status columns: any closed
vocabulary with a registry (event names, alert scopes, metric ids) drifts
the moment members can be **minted outside it**. Measured instances of
the class: an event vocabulary with six members created as literals in a
producer module, invisible to the registry's own checker, which scanned
only the registry files — a green gate over a proxy; and one alert
vocabulary consumed by two evaluators honoring different scope fields, so
the same rule fired differently depending on which consumer saw it first.
The rule: enumerate the writers, and point the gate at the population of
*written* members, not at the registry's self-description
([failure-not-empty-success](../../_laws.md#failure-not-empty-success) —
a registry check that finds nothing must be distinguishable from one
that looked at the wrong files).

## The unknown-token path runs in production

Version skew guarantees a consumer will eventually receive a member it
has no label for. The resolution function is total by policy — an honest
degradation, never a crash or an empty string — **and the miss is
reported in production**, not only in development builds, because skew is
a production phenomenon. A dev-only warning on the unknown path means the
one environment where the defect matters is the one environment where it
is silent. The reported miss names the category and token: a mapping gap
with a timestamp, fixable as a one-line catalog addition instead of a bug
hunt. (The display *direction* of the degradation belongs to
[status-color-mapping](status-color-mapping.md); the token/label boundary
itself to
[token-label-separation](../../i18n/techniques/token-label-separation.md).)
