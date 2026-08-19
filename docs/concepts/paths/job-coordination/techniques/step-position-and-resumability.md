---
layer: technique
subject: job-coordination
technique: step-position-and-resumability
status: forged
laws: [identity-survives-reuse, failure-not-empty-success]
shared_with: []
---

# Step position and resumability

A single-step job has two recovery options: finished or not. A multi-step
job that records nothing about its progress has the same two — which means
an interruption at step nine of ten costs nine steps of work, or worse,
nine steps of *side effects re-applied*. The technique is to make the job's
**position** a persisted fact with the same durability as the job itself,
so that recovery re-enters at the first incomplete step; and to make each
step declare, in advance, what a re-run of itself does — because the
checkpoint protocol guarantees that exactly one step *will* eventually be
re-run.

## The checkpoint ordering, and the guarantee it buys

Position advances in a fixed order: **the step's effects become durable
first; the position write follows.** A crash between the two leaves a
completed step behind an unadvanced position — so recovery re-runs the last
step, and the protocol's whole safety burden lands there: **at-least-once
per step**. The reverse ordering (advance position, then apply effects) is
strictly worse — it converts a crash into a *skipped* step, and a skipped
step is silent corruption, unfindable later, while a re-run step is a
defined event the step was designed for.

This is why "steps declare idempotency" is not optional annotation but the
protocol's other half. Each step declares one of:

- **Naturally idempotent** — re-running converges to the same result
  (overwrite-by-key, recompute-and-replace). Nothing extra needed.
- **Keyed** — the step's effect carries a deterministic dedup identity
  (derived from job id + step id, never minted fresh per attempt), and the
  effect's target refuses duplicates. The re-run becomes a no-op at the
  destination.
- **Marker-guarded** — the step writes a completion marker **atomically
  with its effect** (same transaction, same store), and the step's body
  checks the marker first. This is the pattern for effects with no natural
  key. The marker written in a *different* store than the effect is the
  trap: the pair can then straddle a crash, which re-creates the exact
  ambiguity it was meant to remove.
- **Honestly non-idempotent** — an external charge, an irrevocable send.
  The declaration forces the decision into the open: wrap the effect behind
  an idempotency key the far side honors, restructure so the irrevocable
  part is the final smallest step, or accept duplicate cost *in writing*
  for this job class. What is not acceptable is the default: undeclared,
  and discovered by the first duplicate invoice.

## Position is step identity, not step index

The persisted position names a **stable step id**, never "step 4"
([identity-survives-reuse](../../_laws.md#identity-survives-reuse)).
Ordinals break under precisely the operations plans actually undergo:
inserting a step renumbers everything after it, so a checkpoint written by
last month's plan silently points at the wrong step in this month's. The
plan — the ordered list of step ids — is itself versioned, and the record
stores which plan version the job started under. On resume, same version
means re-enter directly; a changed version is a *migration decision*
(map old position into the new plan, or restart), made explicitly, never
by assuming the ordinals still line up.

Position also records **outcome per completed step**, not just the frontier
— "completed, produced 0 items" and "not yet run" must be distinguishable
facts ([failure-not-empty-success](../../_laws.md#failure-not-empty-success)),
both for resume correctness and because a later step's emptiness question
("why did step seven have nothing to do?") is answered by step four's
recorded count.

## Resume needs no witnesses

The test for a resumable design: **could a fresh executor, holding only the
record, continue the job?** Everything the remaining steps need — resolved
inputs, intermediate outputs (or durable references to them), accumulated
decisions — lives in the record or in storage the record points to, not in
the memory of the executor that ran steps one through four. In-memory
context is the subtle resume-killer: the position says "resume at five,"
step five needs a value computed at step two, and the value died with the
old process. The discipline is that each step's contract names its inputs
as *record fields*, so the dependency is visible at design time instead of
at the first real recovery.

A paused job is this same machinery at rest: **awaiting-input is a
checkpoint with a question attached.** The position is durable, the needed
input is named, and the job resumes through the identical re-entry path
when the answer arrives — which is why systems that build resumability get
pause/resume nearly free, and systems that bolt on pause discover they
were missing resumability. The human-facing shape of that pause — the step
UX, validation, navigation — is
[wizard-flows](../../wizard-flows/wizard-flows.md)' subject; the record
underneath is this one's.

## When restart beats resume

Resume is the default, not a dogma. Restart-from-zero is the *correct*
verdict when: the partial state is suspect (the interruption was the step
itself crashing deterministically — resuming replays the crash); the plan
version changed and no honest migration of position exists; or the work is
cheap enough that resume machinery costs more than it saves — a job of one
idempotent step is its own checkpoint. The requirement is only that restart
be a **recorded decision with a reason** on the job's lineage, not a silent
fallback a recovery sweep takes because nobody wrote the resume path. And
the restart attempt is the same job record — new attempt, same identity —
so the lineage shows one job restarted twice, not three unrelated jobs.

Steps that fan out, join, and retry per-node have outgrown this linear
spine; that shape is [pipeline-dag](../../pipeline-dag/pipeline-dag.md)'s
subject, which inherits the same checkpoint ordering per node.
