---
layer: technique
subject: test-harness
technique: fixture-economics
status: forged
laws: [derivation-names-recomputation, creation-names-reaper, one-validation-door, one-authority-per-vocabulary]
shared_with: []
---

# Fixture economics

A fixture is capital: an environment built so that tests can spend it. The
technique is to make the **build** expensive exactly once and the **spend**
nearly free per test, then to keep the capital honest — fresh, representative,
and reaped.

## Build once, copy per test

The pattern has three parts:

1. **A template build** runs once per suite invocation (or less — see
   freshness): apply the full schema, run every migration, seed the baseline
   dataset, warm whatever caches the product would have. This step is allowed
   to be slow because it happens once.
2. **A cheap copy** hands each test its own instance of the template — a file
   copy, a snapshot restore, a cloned directory. The copy must do no logic:
   its cost is bytes, not computation, which is what makes it one to two
   orders of magnitude cheaper than the build. If your copy step re-runs
   migrations, it is a second build wearing a copy's name.
3. **Per-test ownership**: each test gets a private copy, mutates it freely,
   and never cleans up *inside* it — the copy is discarded whole
   ([_laws: creation-names-reaper_](../../_laws.md#creation-names-reaper): the
   copy's reaper is the suite teardown that deletes the scratch directory, and
   it is named in the harness, not left to each test's diligence). Discard-
   whole is not just cheaper than cleaning — it is *safer*, because the
   alternative (each test truncating "the relevant tables" back to empty) makes
   every test file hand-maintain its own private copy of the schema's table
   list, and hand-maintained copies of a vocabulary drift: a sibling system
   audited for exactly this held twenty-five distinct cleanup lists across
   forty-three files, with five real tables named in none of them — and a
   documented cross-test-contamination bug rooted in one of the gaps. The
   template hands tests the tables; nothing hands them the *list* of tables.

Two hardening details, both earned by torn-fixture incidents: the builder's
handle is fully released before the first copy is taken (an open handle can
leave journal residue that tears the copy), and **each copy is proved usable
before it reaches a test** — one trivial probe query at handoff. A torn copy
otherwise surfaces as a baffling assertion failure deep inside whichever test
touched the data first, which is the most expensive possible place to
diagnose a setup problem. Likewise, a template left behind by a crashed run
is removed before building anew — the stale-capital case of the reaper rule.

The economics are decisive. With N tests, rebuild-per-test costs N × build;
build-once-copy costs build + N × copy. When build is seconds and copy is
milliseconds, the suite's setup cost drops from minutes to a rounding error —
the difference between a suite that runs at the commit tier and one exiled to
nightly. Measure both numbers; the ratio is the technique's health metric.

The seductive false economy is the **shared mutable fixture**: one instance,
all tests. It is even cheaper — and it couples every test to every other
test's writes, converts test order into a hidden input, and forbids
parallelism. The cheap copy exists precisely so that isolation costs almost
nothing; sharing to save the almost-nothing buys the whole coupled-suite
disease back.

## Freshness: the template names its rebuild

A cached template is a stored derivation, and
[_laws: derivation-names-recomputation_](../../_laws.md#derivation-names-recomputation)
applies with teeth: the template must carry **what it was derived from** and
the harness must check it. Fingerprint the inputs — the schema definition, the
migration list, the seed data, the version of the builder itself — and rebuild
when the fingerprint changes. The failure mode this kills is vicious because
it is green: a template built before yesterday's schema change lets every test
pass against yesterday's world, and the discrepancy surfaces in production,
which is the one place the fixture existed to protect.

Staleness has a second face: a template that is *too* fresh. Rebuilding on
every invocation because "cache invalidation is hard" silently returns the
suite to rebuild-per-run economics. The fingerprint is the arbiter; trust it
in both directions.

## Seeded-data honesty

Seed data defines which world the suite certifies, and three dishonesties
recur:

- **Seeds that bypass the product's write path.** Rows inserted directly into
  the store skip the validation, defaulting, and invariant-enforcement the
  product applies to real writes
  ([_laws: one-validation-door_](../../_laws.md#one-validation-door)) — the
  fixture then contains states the product could never produce, and tests
  pass against phantoms or fail against ghosts. Prefer seeding through the
  product's own creation paths; where raw insertion is required for speed,
  assert afterwards that the seeded state satisfies the same invariants the
  door enforces.
- **Seeds shaped like the demo, not the population.** Ten tidy rows certify
  nothing about a thousand ragged ones. The baseline seed should include the
  known awkward cases — empty collections, maximal lengths, the optional
  fields absent, the legacy shapes still present in real data — because the
  fixture is the only population most tests will ever meet.
- **Seeds that encode today's bugs as fixtures.** Data copied from a live
  system imports its corruptions as expectations. Curate copied seeds against
  the *intended* invariants, and record provenance so a future maintainer can
  distinguish "deliberately awkward" from "accidentally wrong."

## Fixture tiers

Not every suite spends the same capital. A workable ladder: **in-memory
construction** for unit tests (no fixture at all — builders and factories),
**the copied template** for integration tests, and **a full product profile**
(the template plus configuration, credentials-shaped stubs, and workspace
state) for end-to-end and live lanes — see
[isolation-lanes](isolation-lanes.md) for how the profile is created clean.
The rule connecting the tiers: a test uses the cheapest fixture that can
witness its claim, and a test found using a richer fixture than its claim
needs is a candidate for demotion down the ladder.
