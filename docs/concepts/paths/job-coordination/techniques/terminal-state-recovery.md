---
layer: technique
subject: job-coordination
technique: terminal-state-recovery
status: forged
laws: [failure-not-empty-success, deletion-is-not-repair]
shared_with: []
---

# Terminal states and recovery

A state machine earns its keep at the ends: every job must finish in
exactly one member of a **closed terminal set**, and — the half that gets
skipped — every non-terminal state must name the mechanism that can move it
toward terminal **when the executor is gone**. The first half is vocabulary
design; the second is reachability, and reachability is what separates a
state machine from a diagram. A state with no mover-of-last-resort is a
black hole: jobs enter it, nothing is responsible for them again, and the
system's only remaining tool is a human with write access to the store.

The cost of a black hole is rarely confined to the job in it. Around every
job system grow **guards that key off the live states** — "refuse a new run
while one is running," "refuse deletion while work is in flight" — and each
guard converts an unreachable state into a deadlock: the orphaned *running*
row blocks new runs forever, blocks cleanup forever, and offers no in-app
remedy, because the cancel path talks to an in-memory registry whose entry
died with the process. The blast radius of one stranded row is every
feature that asks "is something live?" — which is why reachability is a
review item, not a polish item.

## The terminal set, closed and distinguished

Four verdicts cover the genre — **completed · failed · cancelled ·
expired** — and they are four different facts demanding different payloads
and different follow-ups
([failure-not-empty-success](../../_laws.md#failure-not-empty-success)):
completed carries its counts (with predicates); failed carries a typed
reason and the attempt lineage; cancelled carries who and when; expired
carries the policy that aged it out. Systems that collapse these — one
`done` flag, or `failed` doing quadruple duty — lose the distinctions
exactly when someone needs them: the retry logic that must not resurrect a
cancellation, the report that must not count expiries as failures.

An **interrupted** marker (the executor died; recovery noticed) is best
modeled as a *reason on the verdict*, not a fifth terminal state — because
interruption is how the job ended up needing a verdict, and the verdict
itself (requeued? failed? parked?) is still the recovery policy's to issue.

## Reachability: every non-terminal state names its mover

Walk the vocabulary state by state and demand an answer:

| State | Mover-of-last-resort when the executor is gone |
|---|---|
| queued | admission/claim machinery — plus an age policy for queues nobody drains |
| running | lease expiry → the reaper's verdict ([lease-renewal](lease-renewal.md)) |
| paused / awaiting-input | the awaited event — plus an age policy, because some questions are never answered |
| terminal | nobody; verdicts are final |

The age policies are the easy ones to forget. A paused job is healthy at
any age (the golden path's rule), but *healthy* and *immortal* are
different claims: a job awaiting an input that its requester abandoned two
release cycles ago deserves an **expired** verdict under a written policy —
a verdict with a reason, queryable, distinct from failure. What it does not
deserve is deletion: removing the row destroys the evidence that the limbo
class exists, at the exact site where its size was measurable
([deletion-is-not-repair](../../_laws.md#deletion-is-not-repair)).

Two pragmatics of expiry policies, both learned from systems that run them:

- **Age alone is a weak signal; corroborate it.** The strong expiry
  predicate pairs "no activity for N hours" with independent evidence that
  the work is orphaned — the parent entity already moved on, the requester
  is gone, the job's outputs were superseded. Age-only expiry is forever
  choosing between a threshold long enough to spare slow-but-live work and
  one short enough to matter.
- **Expiry may reuse an existing terminal verdict — as a recorded
  decision.** Minting a true `expired` state is the clean form, but where
  the terminal set's membership tests are scattered through the codebase
  as hand-maintained literals, extending the vocabulary means finding
  every copy — and a sweep that reuses `cancelled` with the expiry policy
  written into the reason field is an honest, legal-transition-path
  compromise. Note what the compromise measures, though: a vocabulary too
  expensive to extend is the
  [one-authority law](../../_laws.md#one-authority-per-vocabulary)'s bill
  arriving — the scattered `NOT IN (…)` copies, not the new state, are the
  defect.

## Recovery at boot: verdicts per class, never wholesale

The process starts; some jobs in the store say *running* under leases held
by a process that no longer exists; some say *queued*; some are paused. The
recovery sweep walks the survivors and issues **one of four verdicts, per
job, by class**:

- **Adopt** — the evidence says the work is genuinely still live (a lease
  still being renewed by another process instance that survived; a
  detached worker that can be re-attached). Verify the evidence, take over
  observation, change nothing.
- **Resume** — the job carries a position and its steps declared their
  re-run safety: re-enter through the normal path at the first incomplete
  step ([step-position-and-resumability](step-position-and-resumability.md)).
  This verdict is what the whole write-side discipline was *for*.
- **Park** — the job was not executing anyway (paused, awaiting input) or
  needs a decision the sweep cannot make (non-idempotent frontier step,
  ambiguous partial state). Leave it, or move it to an explicit
  needs-attention state; either way it surfaces on the operator's queue
  rather than silently changing fate.
- **Fail with reason** — no position, no re-run safety, or too old to
  matter: a terminal verdict whose reason records *interrupted at boot*,
  preserving lineage for the retry policy to consider.

The anti-pattern this table exists to displace is the **blanket wholesale
fail**: one sweep statement stamping *failed* onto everything non-terminal
at boot. It is seductive because it is one line and it makes the dashboard
clean. It is wrong three ways at once: it destroys paused jobs that were
perfectly healthy (they weren't even running — the restart proved nothing
about them); it discards resumable work the checkpoint discipline paid for;
and it stamps a single generic reason over N distinct fates, so the
post-incident question "what did the restart cost us?" has no answer. A
system that finds itself wholesale-failing has usually skipped the state-
class distinction — with live/paused/terminal classified, the per-class
sweep is barely more code than the blanket one.

## The sweep is a first-class citizen

Recovery runs inside the startup phase that
[background-jobs](../../background-jobs/techniques/startup-sweeps.md) owns,
and inherits its rules: bounded (it must not delay boot unboundedly),
idempotent (a crash *during* recovery re-runs it), and **distinct in the
record** — every verdict it issues goes through the state machine's one
door with actor = recovery-sweep, so the lineage forever distinguishes "the
executor failed this" from "the boot sweep failed this." A recovery that
edits status columns directly, outside the door, is the second-largest
source of informal states after crashes themselves.

One more obligation, easy to miss because it lives off the record: **the
sweep reconciles the executor-side registries, not just the rows.** Job
systems typically keep an in-memory layer next to the durable one —
cancellation tokens, status channels, "is one running?" guards — and a
verdict that updates the record while a stale registry entry survives (or
vice versa, at boot, a registry that starts empty over rows that say
*running*) reintroduces the deadlock class above from the other side. The
practical shape: the sweep returns the identities it re-verdicted, and the
caller clears the corresponding in-memory state in the same startup
sequence.

Mid-flight recovery — the lease reaper acting while the system runs — is
the same verdict table on a different trigger. Build one verdict function
and give it two callers, or watch the two policies drift until a job's
fate depends on *when* its executor died.
