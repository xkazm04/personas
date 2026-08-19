---
layer: technique
subject: job-coordination
technique: job-observability
status: forged
laws: [count-carries-predicate, failure-not-empty-success]
shared_with: []
---

# Job observability

Two different audiences watch jobs, and conflating their needs builds the
wrong surface for both. The **requester** watches one job they care about —
progress bar, ETA, cancel button, re-attach after navigating away; that
contract belongs to
[job-progress-and-cancellation](../../background-jobs/techniques/job-progress-and-cancellation.md).
This technique is the **operator's** lens: all jobs at once, read from the
durable records, answering the fleet questions — what is live, who holds
what, what is aging badly, and what needs a human. The requester's surface
can afford to lean on a live event stream; the operator's surface cannot,
because the operator shows up precisely when things died.

## The acid test: kill every executor

The design test for this surface: stop every executor process, then open
the operator view. **It must still tell the truth** — every job's state,
position, holder-of-record, lease age, and history, rendered from storage
alone. This is not an edge case to tolerate but the primary scenario to
design for: an operator debugging a healthy system is rare; an operator
debugging a system whose executors just died is the job description. A
surface that goes blank without its event stream fails the test, and its
failure is invisible until the first real incident — every demo has live
executors.

The test doubles as an audit of the write-side discipline: any question
the dead-executor view cannot answer is a fact the executors were holding
in memory instead of writing to the record. The surface is downstream of
the golden path's core stance; it cannot out-report what was never
persisted.

## The columns that answer operator questions

Per live job, four facts beyond identity and state:

- **Position** — step m of n, by name, with the plan version. "Running" is
  not a position; "running, step `transform` (3/7), 41k items into step"
  is.
- **Holder and lease** — which executor owns it, since when, lease deadline,
  time since last renewal. This is the column that separates *slow* from
  *dead* at a glance.
- **Age against expectation** — not just started-at, but started-at
  relative to this job *class's* typical duration. Twenty minutes is
  routine for an export and alarming for a token refresh; a surface that
  shows raw age makes the operator carry the baseline in their head.
- **Next action** — what the system will do without intervention, and
  when: "lease expires in 90s, then requeue," "awaiting input since
  Tuesday, expires under policy in 6d," "retry 3/5 scheduled at 14:02."
  This one column converts the surface from a status report into a
  decision aid: the operator's real question is never "what state is this
  in?" but "do I need to act, or will the machine?"

**Anomalies sort first.** A running job whose last renewal is older than
the renewal cadence is a corpse-in-progress and belongs at the top,
visually distinct, *because* of its silence — silence is a signal only if
the surface treats it as one
([failure-not-empty-success](../../_laws.md#failure-not-empty-success):
"renewing on schedule" and "no renewal seen for 4 minutes" are different
facts and must not render as the same calm row).

## History is the debugging spine

The transition trail the state machine's door records — state, actor,
reason, timestamp per transition — is the operator's primary forensic
object, rendered per job as a timeline: claimed by A, lease expired,
requeued by reaper, claimed by B, completed. Attempt lineage (this is
attempt 3; attempts 1–2 ended in lease expiry) lives here too. When the
trail is complete, "what happened to job X?" is a read; when it is not,
it is an interview with whoever was on call.

Aggregates over the records obey the counting law
([count-carries-predicate](../../_laws.md#count-carries-predicate)): a
tile that says "14 failed" says failed *by what predicate over what
window* — failed-terminal today, or failed-attempts-including-retried
this week? The two differ by design, and a dashboard number without its
predicate will be quoted in an incident summary it does not support.

## Triage verbs live on the surface, and go through the door

An operator surface that only *shows* stuck jobs teaches operators to fix
them in the store directly — which bypasses the transition table, skips
the lineage, and manufactures informal states under pressure, the exact
moment the machine most needs its invariants. So the surface carries the
legal verbs — cancel, expire, requeue, force-fail — each implemented as a
call through the state machine's one door, each recorded with actor =
operator and a reason. The door's transition table also scopes the verbs:
the UI offers only transitions the table allows from the row's current
state, which makes the legal action set discoverable and the illegal ones
unrepresentable.

Bulk forms of the verbs report partial failure per item — a bulk requeue
that says "done" while three rows silently lost their conditional write
is the surface lying about the store it fronts.
