---
layer: technique
subject: migrations
technique: schema-drift-detection
status: forged
laws: [one-authority-per-vocabulary, gate-sees-target, count-carries-predicate]
shared_with: []
---

# Schema drift detection

Migration correctness is not a property you establish once; it is a
property that decays. Code and schema evolve in different review lanes,
queries are strings no compiler checks against storage, and the fleet's
stores accumulate histories no test environment reproduces. Drift detection
is the family of sweeps that measure the decay before users do. Three drift
classes, three countermeasure shapes.

## Class 1: two authorities for one schema

The moment a system has both a fresh-install path (create at current shape)
and an upgrade path (replay steps), it has two definitions of "the current
schema" — a vocabulary with two hand-maintained authorities, which is a
race with a delay fuse
([one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary)).
Each path is exercised only by its own population — new users never test
the chain, veterans never test fresh creation — so divergence ships
silently and reproduces on exactly one cohort.

The structural fix is to *have one authority*: derive fresh installation by
replaying the full chain from zero. When boot-time cost forces a squashed
baseline ("create at version 40, chain from there"), the two texts are
legitimately separate — and then the arbiter must be mechanical:

**The convergence test.** Build one store fresh; build another by
migrating a fixture from the oldest supported version; dump both schemas
in normalized form (object definitions, column order-insensitive,
whitespace-insensitive, index and trigger sets included); diff. Any
difference fails the build. This single test retires the entire class,
including the guarded-step silent-skip disaster described in
[idempotent-steps](idempotent-steps.md) — the fork it creates is exactly a
fresh/upgraded schema difference, visible to this diff on the day it is
introduced instead of weeks after it ships.

Keep fixtures honest: the "oldest supported version" fixture is a real
artifact checked into the test corpus, not a synthetic built by today's
code pretending to be old — today's code carries today's assumptions, which
is the very contamination the test exists to catch.

## Class 2: queries outlive the schema

A query written three releases ago names a column; a migration renames or
drops the column; nothing complains until the query runs — at runtime, in
the field, possibly on a path exercised monthly. The gate that should have
caught it (the compiler) never saw the target (the store's schema)
([gate-sees-target](../../_laws.md#gate-sees-target)).

The countermeasure makes a gate that does see it: **compile every query
against the real current schema, before release**. Most engines will
prepare/plan a statement without executing it — preparation resolves every
named object and column, which is precisely the check needed. The work is
in the corpus: enumerate every query the code can issue (a chokepoint
module of named queries makes this enumeration trivial and is worth
adopting for this reason alone; string-built fragments scattered through
call sites make it heroic) and prepare each one against a store built at
the current version. Run it as a build gate. The residue — dynamically
assembled queries that cannot be enumerated — is a measured hole to
shrink, not a reason to skip the sweep that covers everything else.

## Class 3: the fleet forks from the version it reports

Everything above runs before shipping. But the fleet's stores have
histories the test matrix does not: interrupted migrations on engines with
non-transactional verbs, restored half-backups, disk corruption, a
hand-edited store from a support session. The version ledger says 45; the
actual schema is version 45 minus one column. No pre-release sweep can see
a machine it does not run on.

The countermeasure runs where the store is: **a boot-time fingerprint
assertion**. After the chain settles, compare the live schema — hashed
normalized dump, or object-by-object comparison against a manifest
generated at build time — with what the code expects for this version. On
mismatch, refuse or repair *now*, while the pre-migration snapshot is
fresh and the divergence is one boot old, instead of weeks later when the
symptom is an unexplained query failure attributed to the wrong release.
This assertion is the post-condition of the entire chain, in the same
sense that per-step post-conditions close the silent-no-op hole one level
down.

## The integrity sweeps: referential hygiene

Declared foreign keys only constrain *future* writes, and only while
enforcement is on. Rebuild-pattern migrations run with enforcement
relaxed; historical releases may have had it off entirely; cascades may
have been mis-declared for years. The orphans these windows created are
permanent residents no declaration will ever evict retroactively.

So sweep for them deliberately: run the engine's full referential check,
plus domain invariants the schema cannot express, as a recurring test
against migrated fixtures — and, cheaply sampled, as field diagnostics.
Report findings as counts with predicates
([count-carries-predicate](../../_laws.md#count-carries-predicate)):
"0 rows in the child set whose parent key resolves to nothing" is a
passing sweep; "integrity OK" is a sweep that cannot be interrogated when
it stops being true. And when the sweep finds orphans, the finding routes
to a *decision* — repair by reconstruction, quarantine, or documented
acceptance — never to a silent delete: a row the sweep can see is
evidence; deletion converts a visible inconsistency into an invisible loss
at the exact site where visibility existed.
