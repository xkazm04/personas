---
layer: technique
subject: test-harness
technique: suite-partitioning
status: forged
laws: [count-carries-predicate, gate-sees-target]
shared_with: []
---

# Suite partitioning

Partitioning decides which tests form a machine together. The decision inputs
are **cost** (how long, how much infrastructure) and **isolation need** (what
the tests touch that others must not), and the output is a set of suites, each
with its own configuration, budget, environment, and schedule. Tags inside a
single configuration are not a partition — they are a query over an unpartitioned
population, and queries drift.

## One configuration per suite

Each suite owns a real configuration file. Not a flag, not a tag filter, not an
environment variable that flips behavior inside one shared config — a file. The
reasons are structural:

1. **Budgets differ and must be enforceable.** A unit suite's per-test timeout
   is measured in milliseconds; an end-to-end suite's in minutes. One shared
   timeout is wrong for both, and per-tag overrides inside one config are the
   drift machine that per-suite files exist to avoid.
2. **Environments differ and must not leak.** The integration suite boots
   containerized services; the unit suite must never pay that boot, not even
   accidentally. Separate configs make the environment a property of the suite
   rather than a conditional inside setup code. And the environment is itself
   a per-file tax: a heavyweight simulated environment applied by default can
   cost an order of magnitude more per file than the tests inside it — a suite
   was measured spending ninety-four percent of a file's wall time on
   environment, import, and setup, with the assertions in the remainder. When
   the fixed per-file cost dominates, the fix is partitioning (a lighter
   environment for the files that never needed the heavy one), not a longer
   timeout.
3. **Parallelism differs.** Pure suites run wide; suites against a shared
   resource run per-worker-isolated; the live lane runs serial. Parallelism is
   per-suite policy (see [isolation-lanes](isolation-lanes.md)), and policy
   needs a place to live.
4. **The partition becomes legible.** A newcomer answers "what runs where" by
   listing configuration files. When the answer requires simulating a filter
   expression, the answer is effectively unavailable — and unavailable answers
   get replaced by folklore.

## Membership by location, not annotation

A test belongs to exactly one suite, and the belonging is expressed by **where
the file lives or what the file is named** — a directory boundary or a naming
convention the configs key on. Annotation-based membership (decorators, tags,
inline markers) fails in both directions: a forgotten annotation silently
drops a test into the wrong machine (usually the default one, usually the fast
one, where its slow setup now taxes everyone), and nothing structural prevents
one test from claiming two suites and running twice with different semantics.
Location-based membership makes misfiling visible in review as a file in the
wrong place — the cheapest possible detection.

## The cost-tier table

Every suite declares its tier; the tier fixes budget and schedule. A workable
default ladder:

| Tier | Budget (whole suite) | Runs | May touch |
| --- | --- | --- | --- |
| editor | under ~10 s | on save, watch mode | memory only |
| commit | under ~1 min | pre-commit | memory + local disk |
| push | a few minutes | pre-push / merge request | containerized services, build artifacts |
| pipeline | tens of minutes | merge pipeline | everything below the live product |
| scheduled | hours | nightly / weekly | the live product, long lanes |

Two rules keep the table honest. **A suite that outgrows its tier moves down a
tier or gets faster — it never quietly stretches the tier's budget**, because
the budget is the contract every other suite in the tier depends on. And **the
tier a suite gates at is a separate decision from the tier it can run at** —
what blocks a merge is the quality-gates subject's territory; partitioning only
guarantees each suite *could* gate at its tier without wrecking the tier's
latency.

## Counts travel with their suite

"All tests pass" is not a statement; "the commit-tier suites pass" is. Every
reported total — in a pipeline summary, a readiness review, a document —
names the suite and tier it was measured over
([_laws: count-carries-predicate_](../../_laws.md#count-carries-predicate)).
This matters most at the top of the ladder, where the expensive suites run
least often: a green badge earned by the fast tiers is routinely misread as
covering the lanes that have not run since last night.

## The degenerate partitions

- **Everything in one suite** — the fast tests pay the slow tests' costs,
  watch mode dies, and the suite's schedule collapses to its slowest member's
  schedule.
- **A suite per feature** — partitioning by product area instead of by cost
  and isolation produces dozens of machines with identical budgets and no
  legible answer to "what runs on commit"; product-area grouping belongs
  *inside* a suite as directory structure, not *between* suites.
- **The implicit default suite** — whatever the runner discovers when no
  config narrows it. If the default discovery pattern can see files from more
  than one intended suite, every misfiled test lands there silently. Make the
  default suite's discovery boundary as explicit as every other suite's, and
  verify the partition is exhaustive and disjoint: each test file matched by
  exactly one configuration
  ([_laws: gate-sees-target_](../../_laws.md#gate-sees-target) — a suite that
  silently fails to discover its tests gates nothing).

## The report reconciles its own denominator

Discovery failing loudly is not enough; it must also fail *arithmetically*.
A run report that says "3,737 of 3,738 passed" while eleven discovered files
never started — their workers starved before the framework awoke, their
absence mentioned nowhere in the output — is reporting over a denominator
that silently shrank, and no pass rate computed on it means anything. The
harness must reconcile **files matched by the suite's discovery pattern**
against **files that actually reported results**, and treat a shortfall as a
suite failure with the missing files named. "Everything passed" and "some of
everything never ran" are different facts; a report that cannot distinguish
them is a regression detector in name only.
