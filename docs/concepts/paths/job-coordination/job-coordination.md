---
layer: golden-path
subject: job-coordination
status: forged
techniques:
  - job-state-machines
  - lease-renewal
  - step-position-and-resumability
  - terminal-state-recovery
  - job-observability
  - atomic-claiming@delivery-guarantees
  - job-progress-and-cancellation@background-jobs
evidence:
  - src-tauri/core/src/models/build_session.rs            # closed phase vocabulary, strict parse, validate_transition table, is_terminal classifier, AwaitingInput paused state
  - src-tauri/db/src/repos/core/build_sessions.rs         # append-only phase-timing history; expire_stale_non_terminal: corroborated age expiry w/ recorded vocabulary-reuse rationale
  - src-tauri/src/engine/mod.rs                           # recover_stale_executions + requeue_persisted_executions: per-class boot verdicts (fail mid-run w/ reason; preserve+re-admit queued through the normal door)
  - src-tauri/db/src/repos/resources/n8n_sessions.rs      # recover_interrupted_sessions: parks awaiting_answers, fails live classes w/ actionable reason, returns ids so in-memory registries get purged
  - src-tauri/src/daemon/lock.rs                          # heartbeat lease: 90s stale = 3 missed 30s heartbeats — TTL sized to detection latency, not job duration
  - src-tauri/src/engine/leadership.rs                    # two-way renewal (relinquish on heartbeat write failure), follower takeover tick, explicit release on clean shutdown
counter_evidence:
  - src-tauri/db/src/repos/resources/teams.rs             # recover_interrupted_pipeline_runs: blanket wholesale fail of running AND awaiting_approval — the paused-destroying form
deviations:
  - w11-job-coordination   # anchor in docs/concepts/golden-path-deferred-fixes.md
  - w8-pipeline-dag      # boot recovery wholesale-fails awaiting_approval (paused) alongside running — anchor in docs/concepts/golden-path-deferred-fixes.md
  - w2-background-jobs   # event-pipeline claims carry no holder/timestamp/lease, forcing the heuristic two-snapshot reaper — anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Job coordination

Some work outlives everything around it. The request that started it returns
long before it finishes; the viewer watching it closes the window; the process
executing it is deployed over, crashes, or has its laptop lid shut. An
hour-long import, a build that pauses mid-flight to ask a question, a
migration that spans a restart — call these **jobs**, and notice what defines
them: a job's lifetime is longer than the lifetime of any single process,
connection, or observer involved with it. That one property invalidates the
default mental model, in which the work *is* the running code and its status
*is* a variable in memory. For a job, every in-memory representation is a
cache, and every cache of it will be lost mid-flight at least once.

This subject owns the job's lifecycle as **one discipline**: how a job exists,
how it is owned, how it knows where it is, how it ends, and how it survives
the death of its executor. These five concerns are usually implemented by four
different people in four different quarters — a status column here, a timeout
there, a "resume" feature bolted on after the first angry bug report about
lost work — and the seams between them are exactly where jobs get stuck
forever, run twice, or vanish. Treating them as one lifecycle is the path.

## The core stance: the record is the job; the process is its executor

> **A job is a durable record first and a running process second. The record
> is created in storage — with minted identity and a closed status vocabulary
> — before any execution begins, and everything a future reader needs
> (ownership, position, verdict, reasons) is written into it as it happens,
> because the executor that writes the record will not always be the one that
> reads it.**

The naive inversion is to let the process be the job: spawn the work, hold a
task handle, keep status in a variable, report progress over a channel. It
works in every demo, because in a demo nothing dies. In production the
inversion produces the genre's three signature mysteries: jobs shown
*running* forever because the process that would have updated them is gone;
work silently restarted from zero because nothing recorded how far it got;
and a support question — "what happened to my export?" — that no surviving
component can answer. All three are the same defect: the truth lived in
memory, and memory is not where jobs live.

The consequences of the stance form the spine:

1. **The record precedes the process.** Creation writes identity and an
   initial state from a closed vocabulary; the set of states, the legal
   transitions between them, and the single authority that defines both are
   the machine everything else hangs on (see
   [job-state-machines](techniques/job-state-machines.md)).
2. **Ownership is won atomically and kept honestly.** The transition into
   *running* is a conditional write exactly one executor can win — that
   mechanism is owned by
   [atomic-claiming](../delivery-guarantees/techniques/atomic-claiming.md) —
   and on hours-long work the claim's timestamp is strengthened into a
   **renewed lease**, so that an expired lease is affirmative evidence of a
   dead executor, never a guess about a slow one (see
   [lease-renewal](techniques/lease-renewal.md)).
3. **Position is a persisted fact.** A multi-step job records which step
   completed, at the step boundary, with each step declaring how a re-run of
   itself is made safe — so recovery *resumes* instead of restarting, and a
   re-run of the boundary step is a defined event rather than a gamble (see
   [step-position-and-resumability](techniques/step-position-and-resumability.md)).
4. **Every job ends in exactly one of a declared terminal set, and every
   non-terminal state names the mechanism that can move it there** even when
   the executor is gone. Recovery at boot walks the survivors and issues a
   verdict *per class* — adopt, resume, park, or fail-with-reason — never a
   blanket sweep that stamps one fate on every non-terminal row (see
   [terminal-state-recovery](techniques/terminal-state-recovery.md)).
5. **The record tells operators the truth.** Position, lease holder, age
   against expectation, and the next action are queryable from storage alone
   — the surface must stay honest with every executor dead, because that is
   precisely when it is needed (see
   [job-observability](techniques/job-observability.md)).
6. **The watching contract is a shared clause.** Progress reporting,
   cooperative cancellation, and snapshot re-attach belong to
   [job-progress-and-cancellation](../background-jobs/techniques/job-progress-and-cancellation.md);
   this path supplies the durable record that contract reads from and
   survives by.

## The lifecycle spine

The state vocabulary varies by system; the shape does not:

| State class | Meaning | Who can move it |
|---|---|---|
| **created / queued** | the record exists; no executor owns it | admission + claim |
| **running** | owned under a live lease; position advances | the executor (renewing) |
| **paused / awaiting-input** | deliberately not executing; waiting on something named | the thing it waits for |
| **terminal** | completed · failed · cancelled · expired — one verdict, with payload | nobody (verdicts are final) |

Three rules govern the spine. First, **paused is not stuck**: a job waiting
on a named input is healthy at any age, while a *running* job whose lease
evidence has gone stale is a casualty at any age — collapsing the two states
into one produces both false alarms and unnoticed corpses. Second, **there
are no informal states**: "the row is old and nobody touched it" is not a
state, it is a hole in the machine's coverage, and the recovery and expiry
machinery exists to force such limbo back onto the spine. Third, **terminal
requires a verdict**: a job leaves the system as completed, as failed with a
reason, as cancelled by someone, or as expired under a policy — never by
aging quietly out of everyone's attention.

## Restart is a design input, not a disaster

Executors die for boring reasons — a deploy, an update, a crash in unrelated
code, a machine going to sleep. A job discipline that treats executor death
as exceptional will handle it exceptionally badly. The design posture is the
reverse: **assume every job will be orphaned at least once**, and make the
write-side discipline (record first, lease renewed, position checkpointed,
reasons attached) exactly the information the recovery side will need. The
two halves mirror each other precisely — the quality of recovery at the next
boot equals the quality of what was written while the executor was alive.
Recovery itself is then a small, legible procedure instead of a heroic one:
enumerate the non-terminal survivors, and apply the per-class verdict table.

One subtlety the mirror imposes: real job systems keep an in-memory layer
beside the durable one — cancellation tokens, live-status channels,
"something is already running" guards — and restart severs the two. Recovery
therefore reconciles **both stores**: verdicts onto the records, and a purge
of executor-side registry state for every record it re-verdicted. A system
that repairs only the rows leaves guards keyed to ghosts; one that repairs
only the memory leaves rows that lie. Either half alone re-creates the
stuck-forever class the discipline exists to kill.

## Where this path meets its neighbors

- **Whether the job may start now** — capacity, depth bounds, and the
  admit/queue/refuse verdict belong to
  [admission-queue](../admission-queue/admission-queue.md). This path begins
  at the durable record; admission decides when the record may acquire an
  executor.
- **The room the work runs in** — the supervised loops, panic isolation, and
  host-runtime health are
  [background-jobs](../background-jobs/background-jobs.md). That subject
  distinguishes ticks from jobs and owns the watching UX; this path owns the
  job's own record and its survival. A loop's tick often *drives* this
  path's machinery (claiming due jobs, reaping expired leases).
- **Claim mechanics** — the conditional-write election and its evidence
  requirements are
  [delivery-guarantees](../delivery-guarantees/delivery-guarantees.md)'
  atomic-claiming, shared into this path unchanged. Delivery-guarantees
  applies it to short-lived event processing; this path's contribution is
  what the claim becomes when the hold lasts hours: a lease.
- **Only one at a time** — "at most one live job of this kind" is
  single-flight arbitration and belongs to
  [concurrency-guards](../concurrency-guards/concurrency-guards.md). This
  path assumes some executor legitimately won and governs the winner's
  lifecycle.
- **Human-paced flows** —
  [wizard-flows](../wizard-flows/wizard-flows.md) shares the resumable-
  position spine for flows where the "executor" is a person who walks away;
  it owns the human-facing step UX, while this path owns the record
  discipline both lean on.
- **Steps that form a graph** — when the work is a DAG with fan-out, joins,
  and per-node retry, orchestration belongs to
  [pipeline-dag](../pipeline-dag/pipeline-dag.md); this path covers the
  linear checkpointed spine and lends its terminal-and-recovery discipline
  to both shapes.
- **Waiting between attempts** — when a failed job is retried, the delay
  policy is [retry-backoff](../retry-backoff/retry-backoff.md)'s; the fact
  that a retry is a *new attempt against the same record*, with the attempt
  counter and lineage preserved, is this path's.

## What "done" looks like for this subject

A job system meets the bar when: every job exists as a durable record with
minted identity before its executor starts, and the status vocabulary is
closed, single-sourced, and transition-checked at one door; the claim into
*running* is a conditional write carrying holder and timestamp, and any hold
longer than minutes renews a lease whose expiry is treated as evidence, with
stale-holder writes fenced off; multi-step jobs persist position at step
boundaries and every step declares its re-run safety, so recovery resumes at
the first incomplete step instead of restarting from zero; the terminal set
is closed, every non-terminal state names its mover-of-last-resort, and boot
recovery issues per-class verdicts — adopt, resume, park, fail-with-reason —
with the blanket wholesale fail recognized as the anti-pattern it is; and an
operator can read position, holder, age, and next action for every live job
from storage alone, with the anomalies sorted to the top, so that "what
happened to my job?" is a query, not an archaeology project.
