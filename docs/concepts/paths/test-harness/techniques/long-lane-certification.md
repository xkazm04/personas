---
layer: technique
subject: test-harness
technique: long-lane-certification
status: forged
laws: [failure-not-empty-success, deletion-is-not-repair, count-carries-predicate]
shared_with: []
---

# Long-lane certification

Long lanes — load, soak, chaos, longitudinal — answer questions that only
time and pressure can ask: does memory grow across hours of operation, does
latency hold its shape at sustained concurrency, does the system return to
health after injected failure, does a week of scheduled activity accumulate
drift. They are **certifications, not gates**: they run on their own clock,
judge statistically, and their unit of value is the trend across runs, not
the verdict of one.

## Own clock, own criteria

A long lane is scheduled (nightly, weekly, pre-release), never attached to a
per-change gate — blocking a merge on an hours-long run destroys the merge
cadence without improving the certification, because the property being
certified (behavior over time) is not a property of any single change. The
lane's relationship to release decisions belongs to the quality-gates
subject; this technique owns the lane's internal design.

Pass criteria are **statistical and pre-declared**:

- **Percentile bounds, not averages** — an average hides exactly the tail the
  lane exists to see; declare the percentile and the bound together, and
  report every number with its predicate
  ([_laws: count-carries-predicate_](../../_laws.md#count-carries-predicate)):
  "ninety-fifth percentile under the declared ceiling at the declared
  concurrency for the declared duration."
- **Resource ceilings with trend, not just endpoint** — memory under X at
  finish is compatible with linear growth that clears X an hour later; the
  criterion is the slope over the run's second half, which distinguishes
  warm-up from leak.
- **Recovery deadlines for chaos** — an injected failure's pass criterion is
  time-to-restored-health and zero lost committed work, both declared before
  the run. When the injection itself is an action the harness cannot safely
  perform — killing and relaunching an interactively-run product, pulling a
  cable — split the run into a **mark phase** (snapshot the precise entity
  identities whose survival is claimed, persist them to an artifact, print the
  operator's instruction) and a **verify phase** (after the operator acts,
  assert those specific identities advanced). Marking identities beforehand is
  what separates "these ten queued items survived" from "some items exist
  afterwards" — the latter proves nothing about survival.
- **Declared before, judged after.** Criteria adjusted while looking at the
  results are not criteria; they are commentary.

Each run emits an artifact — the measured series, the criteria, the verdict —
and the lane's dashboard is the sequence of artifacts. A regression that
stays inside the bound is still a regression; the trend line catches what any
single verdict forgives.

## Lane health: earned green, planted red

A lane certifies nothing until two observations exist: it has been **green on
a known-good build**, and it has been **red on a known-bad one**. The second
is the one nobody schedules: plant a defect the lane claims to catch (a
deliberate leak, a latency injection, a dropped recovery path) and verify the
lane fires. A lane that has never been observed to fail for cause is
indistinguishable from a lane that cannot fail
([_laws: failure-not-empty-success_](../../_laws.md#failure-not-empty-success)
applied at lane granularity — a lane, like a scanner, must spell "found
nothing" differently from "cannot see").

The inverse pathology is deadlier because it hides in plain sight: **a lane
that has never passed**. A suite can be wired in, fail every run from its
first day — perhaps because it depends on a capability that was never
finished — and, if red is normal, nobody looks. Every failure after the first
is wallpaper. The harness must therefore track *first-green* as an explicit
lane event, and a standing rule must exist: a lane with a one-hundred-percent
historical failure rate is not a flaky lane, it is an **unbuilt lane wearing
a gate's clothes**, and the finding it reports is about the harness, not the
product. The cheapest implementation is a periodic report of each lane's
pass-rate history with "never green" called out as its own category.

## Flake discipline: quarantine loudly

Long lanes and live lanes breed flakes — timing, resources, and real
infrastructure see to that — and the response protocol decides whether the
harness keeps its authority:

1. **Quarantine, never delete.** A flaky test is moved into an explicitly
   named quarantine set that continues to run but stops blocking. Deleting it
   removes the only instrument pointed at whatever is intermittently wrong
   ([_laws: deletion-is-not-repair_](../../_laws.md#deletion-is-not-repair)).
2. **Quarantine is loud.** Each entry carries owner, entry date, and the
   failure signature. The set's size is reported wherever the lane's results
   are, and it is reviewed on a schedule with two exits: fixed and restored,
   or a documented decision that the claim is no longer worth carrying.
   Quarantine without scheduled review is deletion with a waiting period.
3. **Retries measure; they do not mask.** An automatic retry may salvage a
   run, but the first failure is recorded, attributed, and counted. The
   retried-test count per run is a lane health metric; a rising curve is the
   lane telling you something is destabilizing beneath the green.

## Load reality

A load lane certifies only the traffic it generates. Synthetic uniform
traffic certifies a synthetic uniform world; shape the generated load on
observed reality — the real mix of operations, the real skew of entity sizes,
the real burstiness — and state the shape in the artifact, because "holds at
N concurrent" is meaningless without the workload's description traveling
alongside it. When the real shape is unknown, say so in the criteria: an
honest lane certifying a declared-approximate workload beats a confident lane
certifying an unexamined one.
