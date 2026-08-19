---
layer: technique
subject: delivery-guarantees
technique: stuck-reaping
status: forged
laws:
  - creation-names-reaper
  - failure-not-empty-success
shared_with: []
---

# Stuck reaping

A worker claims an event and dies — process killed, machine rebooted, deploy
mid-flight, panic swallowed by a supervisor. The event now sits in
*processing* with a holder that no longer exists, and nothing in the normal
flow will ever touch it again: it is invisible to claimers (not pending) and
invisible to completion (nobody is working on it). This is not an edge case;
at any real scale it is a scheduled certainty, and the only design question
is whether the system planned for it. **Stuck is a state you budget for, and
the reaper is the budget** — a supervised sweep that finds orphaned claims
and forces them back onto the state machine under a written policy. A
pipeline without a reaper leaks exactly the events someone cared enough to
accept, at a rate proportional to how often it deploys (law:
creation-names-reaper — the claim is a created resource, and the reaper is
its named destructor).

## Detection: evidence first, heuristics as the honest fallback

**Evidence-based reclamation** is available when claims carry evidence (see
atomic-claiming): a claim whose lease deadline has passed, or whose holder is
affirmatively known dead (the holder registry says that instance is gone), is
stuck by *proof*. Reclaim it the moment the evidence says so — no waiting for
a conservative global timeout. This is the design to build toward; every
other method below is compensation for claims that recorded too little.

**Age heuristics** apply when the claim has a timestamp but no lease: pick a
threshold well beyond the honest worst-case processing time and treat older
claims as stuck. Two failure modes, in tension: a threshold too short reaps
work that is alive but slow — creating the very duplicate the claim existed
to prevent — while a threshold too long is minutes or hours of limbo for
every crashed event. The tension is inherent to guessing; a lease dissolves
it, which is the argument for leases.

**The two-snapshot protocol** is the floor, for claims that recorded nothing
but the status itself: observe the set of in-processing items, wait one full
sweep interval, observe again. An item present in both snapshots has made no
observable state transition across the interval and becomes a stuck
*candidate*. This is honest about its weakness — it cannot distinguish
"crashed" from "legitimately still running," so its interval must exceed
worst-case processing time, and it degrades exactly like the age heuristic.
It exists because it needs zero schema: the first reaper a system gets is
usually this one, retrofitted during the incident that proved reaping was
needed. Treat its presence as a signal that the claim schema owes holder and
timestamp, not as the end state.

Whichever detector runs, **slow-but-alive must lose politely**: reclamation
revokes the claim, and the original worker's completion write — conditioned
on still holding the claim — fails cleanly instead of overwriting the
reaper's verdict. Detection can afford rare false positives only because the
completion protocol makes them harmless.

## The reap verdict: three outcomes, chosen by policy

Reaping is not "set it back to pending." Each reclaimed event gets a verdict:

- **Requeue** — return to pending *and increment the attempt counter*. The
  crashed attempt was an attempt; a reaper that requeues without counting
  creates the infinite crash loop: an event whose processing reliably kills
  the worker cycles claim → crash → reap → claim forever, taking a worker
  with it each round. Requeue-with-count lets retry-escalation see the
  pattern and route the event out (see retry-escalation).
- **Dead-letter** — when the counter says this event has crashed enough, the
  reap itself escalates. The reason recorded is "reaped after N attempts,"
  which is different from "handler returned failure N times" and triages
  differently — crashes point at poison payloads or resource exhaustion, not
  logic errors.
- **Discard** — for event classes whose staleness bound has passed (the
  reaction to a moment that is long over), reaping straight to a
  skipped-with-reason record is honest. Discard without the recorded reason
  is not a policy, it is the leak wearing a uniform (law:
  failure-not-empty-success — a reaper that quietly zeroes limbo and one
  that found nothing must not produce the same silence).

## Decision rules

- **The reaper is itself supervised background work** — it runs on the
  [background-jobs](../../background-jobs/background-jobs.md) discipline
  (owned loop, health telemetry, startup sweep). The startup sweep matters
  doubly here: a single-process system's restart is precisely the moment
  every claim held by the previous incarnation is orphaned, so reap-on-boot
  covers the dominant death mode before the periodic sweep ever ticks.
- **The reaper reports counts with predicates.** "Reaped 14 (lease-expired),
  requeued 12, dead-lettered 2" is an observability signal — a rising reap
  rate is the earliest indicator of a crashing handler. A silent reaper
  converts that signal into mystery duplicates.
- **Reaping is not repair.** A handler that keeps killing workers is a
  defect; the reaper contains the damage and routes the evidence to the
  dead-letter surface where a human sees the pattern. Tuning the reaper to
  hide a crash loop is deleting the smoke alarm.
- **One reaper owns the verdict.** Multiple sweeps with overlapping criteria
  race each other into double-requeues. The reaper is a single supervised
  loop, or a set of loops with disjoint criteria written down.
