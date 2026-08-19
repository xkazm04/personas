---
layer: technique
subject: quality-gates
technique: ratchet-design
status: forged
laws: [count-carries-predicate, derivation-names-recomputation, failure-not-empty-success]
shared_with: []
---

# Ratchet design

A ratchet is a gate for a metric that cannot be zeroed today: legacy
violation counts, bundle weight, dependency counts, suppressed-warning
inventories, coverage gaps. Instead of gating on an absolute bar the code
cannot yet clear, the ratchet gates on **direction**: record the current
value as an explicit baseline, and refuse any change that makes it worse.
Done well, a ratchet converts a demoralizing backlog into a monotone slope.
Done badly, it becomes a number nobody trusts. The difference is a handful
of design decisions.

## The baseline is a committed, reviewed artifact

The baseline lives in the repository as a plain, diffable file — never in a
dashboard, a pipeline variable, or a tool's hidden cache. This buys three
properties at once:

- **Changes are diffs.** Raising or lowering the bar shows up in review
  like any other change, with an author and a justification.
- **History is the audit log.** The version history of the baseline file
  *is* the metric's trajectory, with every step attributable.
- **The gate is reproducible.** Anyone can run the counter locally against
  the committed baseline and get the pipeline's answer.

Granularity matters: a single global number ratchets the total while
allowing regressions in one area to hide behind progress in another.
Bucketed baselines — per rule, per directory, per package — refuse locally,
which is where the author who caused the rise is actually standing.

## The baseline names its counter

A recorded number with no recorded procedure is a future dispute
([derivation-names-recomputation](../../_laws.md#derivation-names-recomputation)).
The baseline artifact — in a comment, a header field, or an adjacent
manifest — names the exact command that recomputes it, and the count itself
carries its predicate
([count-carries-predicate](../../_laws.md#count-carries-predicate)): *what*
was counted, over *which* population, matched *how*. "1,135 findings" is
not a baseline; "findings from rule set R over production sources,
excluding generated code, counted by the standard counter" is. Counters
with unstated predicates get re-implemented slightly differently by the
next person, and the ratchet then compares two different measurements and
calls the difference progress.

## Fail on rise — and refuse silence on the drop

Fail-on-rise is the obvious half: measured value above baseline, red, with
a message that names the bucket, the delta, and the sanctioned responses.

The subtle half: **an unexplained drop is not automatically good news.** A
measured value far below baseline has two explanations — genuine
improvement, or a broken instrument. A counter whose glob stopped matching,
whose target directory moved, or whose parser now errors-and-skips walks a
smaller population and reports a smaller number; treating that as progress
buries an instrument failure inside a celebration
([failure-not-empty-success](../../_laws.md#failure-not-empty-success)).
Sound ratchets therefore treat a below-baseline reading as *actionable
divergence*, not silent pass: the gate demands the baseline be updated in
the same change, which forces a human to look at the drop and assert it is
real. The cheap implementation is symmetric comparison — fail on any
mismatch, either direction — plus instrument assertions inside the counter
itself (population walked must be nonzero and within expected bounds; see
gate-liveness).

Be honest about what the forced look can and cannot do. A drop has at
least three causes — the matcher broke, the counted defect was fixed, or
the code carrying the defect was *deleted* — and all three produce a
byte-identical baseline-update step. The ratchet cannot tell them apart;
its whole contribution is refusing to let the drop pass unexamined. The
classification burden lands on the human writing the re-baseline diff,
and the diff's message should therefore *name the cause*, because a
reviewer approving "update baseline −3" without a cause is approving all
three explanations at once, including the broken instrument.

## Re-baselining is deliberate, downward, and reviewed

- **Downward re-baselining** (the metric improved): update the baseline in
  the same change that improved it. Small, frequent, boring diffs — this is
  the ratchet clicking.
- **Upward re-baselining** (someone needs the bar raised): legitimate but
  exceptional — a vendored import, a measurement-method fix, an accepted
  trade. It must be its own reviewed diff with a stated reason, never a
  side effect. The moment upward re-baselines become routine, the ratchet
  has died socially while remaining green mechanically.
- **Never auto-update.** A pipeline that rewrites the baseline to whatever
  it measured has converted the gate into a recorder. The whole mechanism
  rests on the baseline changing only by human intent.

## The endgame: graduation

A ratchet is scaffolding, not architecture. When a bucket reaches zero,
delete its baseline entry and let the underlying rule stand at plain
blocking severity — a zero-baseline ratchet and a hard ban behave
identically, but the ban is simpler, and keeping the scaffolding invites
someone to re-baseline upward "just this once." The ratchet's purpose is to
make itself unnecessary, one bucket at a time.

## What not to ratchet

Ratchets suit metrics that are *counts of discrete, attributable findings*
or *sizes with stable measurement*. They suit poorly: flaky measurements
(time-based benchmarks on shared hardware — the noise floor generates
false rises), metrics the team does not actually intend to drive down
(a ratchet nobody wants is a bypass generator), and proxies so far from
the real goal that driving them down distorts behavior. A ratchet is a
promise of monotone effort; only make it where the effort is wanted.
