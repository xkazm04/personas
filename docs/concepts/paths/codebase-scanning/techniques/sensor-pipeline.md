---
layer: technique
subject: codebase-scanning
technique: sensor-pipeline
status: forged
laws:
  - failure-not-empty-success
  - count-carries-predicate
shared_with: []
---

# Sensor pipeline

A scan that is written as one monolithic program fails as one monolithic
program: the first collector that hits an unreadable input takes the whole
sweep down, and the operator learns nothing about the eleven sensors that
would have succeeded. The technique is to structure every scan as a pipeline
of stages with different reliability contracts — **gather tolerantly, emit
purely, then dedup, rank, cap, and persist** — and to defend the stage
boundaries as interfaces, not as an implementation accident.

## Gather: every sensor optional, every skip reported

The gathering stage reads the world: source trees, dependency manifests,
configuration, the system's own stored records. Its contract is tolerance.

- **Per-sensor isolation.** Each sensor runs inside its own failure boundary
  — an exception, a crash, a timeout in one collector is caught at that
  sensor's edge and recorded, and the sweep continues. A pipeline whose
  sensors share a fate delivers all-or-nothing coverage, and "nothing"
  arrives precisely on the messiest codebases, which are the ones that need
  scanning most.
- **Skipped is a first-class result.** A sensor that did not run produces a
  skip record — which sensor, why, what coverage is therefore missing — and
  the final report prints it. A sensor that fails and contributes nothing is
  indistinguishable from a sensor that ran and found nothing *unless the
  pipeline spells them differently*
  ([failure-not-empty-success](../../_laws.md#failure-not-empty-success)).
  The report's headline is not "N findings" but "N findings from M of K
  sensors".
- **Snapshot semantics.** Gathering produces an immutable snapshot that the
  emission stage reads. Sensors that let rules reach back into the live
  world mid-scan produce findings that mix two moments in time, and those
  findings fail verification for reasons nobody can reproduce.

## Emit: rules are pure functions over the snapshot

The emission stage turns the snapshot into candidate findings, and its
contract is purity: **a rule takes gathered state and returns findings,
performing no reads and no writes of its own.** The payoff is threefold.
Rules become deterministic — the same snapshot always yields the same
findings, so a disagreement between two runs is always a world change, never
rule nondeterminism. Rules become testable — a fixture snapshot exercises a
rule in isolation, including the positive control the precision discipline
demands. And the cost profile becomes legible — all expensive input happens
in the gather stage where it can be measured, cached, and skipped, while
emission is cheap enough to re-run freely during rule development.

A rule that "just quickly checks one more thing" during emission has moved
input past the tolerance boundary: its read failures are no longer isolated,
no longer reported as skips, and no longer covered by the snapshot's single
point in time. Hold the line.

## Dedup, rank, cap — with the truncation disclosed

Raw emission over-produces by design; the shaping stages make the output
usable.

- **Dedup before rank.** Findings are keyed on stable identity (rule plus
  normalized location plus matched content — the full construction belongs
  to the finding lifecycle) and merged against both this sweep's duplicates
  and previously persisted findings, so a re-run refreshes what it re-found
  rather than filing it twice.
- **Rank by expected value.** Order by impact-per-effort or severity-then-
  age — the specific policy is domain-owned, but it must be deterministic
  and total, because the cap comes next and an unstable order under a cap
  means the *set* of surviving findings changes run to run.
- **Cap with disclosure.** Bounding output volume is correct — an unbounded
  dump defeats triage — but the truncation must be printed: "showing 15 of
  50; 35 withheld by cap." A silently clipped list is a false statement
  about backlog size, and every count the report emits carries what was
  counted and what was cut
  ([count-carries-predicate](../../_laws.md#count-carries-predicate)).

## Persist: the sweep converses with its predecessors

The final stage writes findings to durable storage under their stable
identity, together with the sweep's own metadata: when it ran, which sensors
ran, which were skipped, whether coverage was full or partial. Persistence is
what turns isolated sweeps into a longitudinal instrument — re-found findings
accumulate age, resolved findings can be checked for regression, and the
skip history reveals a sensor that has been quietly failing for a month. A
pipeline that only prints is a report; a pipeline that persists is a sensor.

## The acceptance test

Adding sensor N+1 means writing one collector and registering it in the
sensor roster — zero edits to emission, dedup, ranking, or persistence. And
killing any single sensor (unplug its input, make it throw) must degrade the
sweep to a *reported* partial result, never to a crash and never to a
silently smaller green report. If either test fails, the stage boundaries
have been breached.
