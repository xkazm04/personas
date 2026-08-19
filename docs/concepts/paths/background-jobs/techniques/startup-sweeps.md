---
layer: technique
subject: background-jobs
technique: startup-sweeps
status: forged
laws: [failure-not-empty-success, gate-sees-target]
shared_with: []
---

# Startup sweeps

A long-lived process is not actually long-lived: it is a sequence of runs
separated by gaps — crashes, upgrades, reboots, a laptop lid closing for the
weekend. Everything the background runtime was responsible for during a gap
simply did not happen. The startup sweep is the designed answer: **the
runtime's first act is to reconcile the world with what should have happened
while it was away**, before steady-state cadence resumes. A runtime without
this phase does not avoid the missed work; it redistributes it as a slow drip
of stale rows, stuck records, and never-fired follow-ups, each discovered
separately with no common explanation.

## Division of labor with scheduling

For work driven by recurrence rules, *whether* a missed occurrence should
fire late, fire once-for-many, or be skipped is a policy question owned by
[scheduling](../../scheduling/scheduling.md) — its missed-run treatment
decides what the catch-up set *is*. The sweep owns everything after that
decision: executing the catch-up set boundedly, repairing state that is not
schedule-shaped at all, and recording what it did. The interface is the same
one the steady state uses — "what is due (including everything overdue)?" —
which is exactly why sweep and steady state can share one code path (below).

## What a sweep looks for

Sweeps cover three families of gap damage, and an inventory of all three is
part of designing any new persistent workflow:

1. **Overdue recurring work** — occurrences that came due during the gap,
   filtered through scheduling's missed-run policy.
2. **Orphaned in-flight state** — records the previous run left mid-flight:
   items claimed but never finished, jobs marked running by a process that no
   longer exists, leases held by dead owners. The previous shutdown's record
   (what a graceful stop abandoned) is the first input; the sweep's own scan
   is the second, because the previous stop may not have been graceful at
   all. Repair means moving each item to an honest state — released for
   retry, or terminally failed with "interrupted by shutdown" as the recorded
   cause — never leaving it in a running state no live process backs
   ([failure ≠ empty success](../../_laws.md#failure-not-empty-success):
   a phantom "running" is an empty success lying about itself).
3. **Expired accumulations** — retention windows that lapsed during the gap:
   caches to evict, temp artifacts to reap, old snapshots to trim. Usually
   the gentlest family, since the steady-state loop would catch them anyway;
   the sweep merely front-loads it.

## Bounded, always

The gap may be an hour or a month, and the sweep must behave at both ends.
Unbounded catch-up after a long gap produces the resurrection storm: a
returning process saturating itself and every dependency with weeks of
backlog, at the exact moment (startup) when it is also doing everything else.
Bound the sweep on every axis that can grow:

- **Item caps** per category per sweep pass; the remainder is picked up by
  the steady-state loops, which is what they are for.
- **Time budget** for the sweep phase as a whole — startup latency is a
  product surface, and the sweep must not hold the rest of the system
  hostage. Run it concurrently with interactive startup where consistency
  allows, or in a first-tick position where it does not.
- **Order chosen per family, deliberately.** Repair orphans oldest-first
  (they only rot); apply missed recurring work per scheduling's policy
  (which frequently collapses N missed occurrences into one run); trim
  expirations in whatever order is cheapest.

## Idempotent, always

A sweep can itself be interrupted — the process may crash mid-sweep and sweep
again on the next start. Every sweep action must therefore be safe to repeat:
detection queries return only items still in the broken state, and repairs
are compare-and-set transitions ("release this item *if still claimed by the
dead owner*"), not blind writes. The test worth actually running: kill the
process mid-sweep, restart, and verify the second sweep completes the
remainder without double-applying the start.

Idempotence also resolves the sweep's relationship with its siblings: a sweep
that shares its detection queries with the steady-state loop is just that
loop's first, wider-windowed tick. That is the strongest available design —
one code path, exercised every interval rather than only at startup, with the
sweep differing only in its window and caps. A sweep that exists as separate
rarely-run code is a gate that sees a target nothing else looks at, and it
rots at the rate of everything around it
([gate-sees-target](../../_laws.md#gate-sees-target)).

## Attributed, always

Sweep-driven work is recorded as sweep-driven, distinct from live-driven work
— a flag or provenance field on whatever records the runs. The reasons are
practical: catch-up firings landing late look like scheduler bugs unless
labeled; sweep repairs of orphaned state look like mysterious status flips in
an audit trail unless attributed; and the sweep's own aggregate ("released 3
orphaned claims, ran 2 collapsed occurrences, trimmed 40 expired artifacts" —
counts with predicates) is the line an operator reads to trust that the gap
was handled. A silent sweep is indistinguishable from a sweep that did not
run, and after the third silent startup nobody can say whether the mechanism
still works.
