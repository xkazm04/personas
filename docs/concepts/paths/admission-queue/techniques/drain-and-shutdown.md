---
layer: technique
subject: admission-queue
technique: drain-and-shutdown
status: forged
laws: [creation-names-reaper, failure-not-empty-success, identity-survives-reuse]
shared_with: []
---

# Drain and shutdown

A queue is a ledger of promises, and shutdown is the moment every promise
comes due at once. A design that has not decided what happens to queued
entries at shutdown has decided by default, and the default is one of two
bad shapes: entries vanish with the process (a silent broken promise to
every waiter), or shutdown blocks behind the backlog (a hang wearing a
queue's clothes, usually resolved by a kill that produces the first shape
anyway). Drain is the designed alternative: an explicit mode, entered
deliberately, with a stated disposition for every entry.

## Step one: close the door

Drain begins by refusing new admissions with the *draining* reason — a
verdict, not an error, so callers can distinguish "this system is going
away, resubmit elsewhere or later" from "this system is broken." Queueing
new work into a process that is shutting down converts each acceptance
into a promise made in bad faith: the acceptor already knows it will not
keep it. Closing the door first also gives drain a finite job — the
backlog only shrinks from here — which is what makes a drain deadline
meaningful at all.

The mode is **visible**: telemetry, status queries, and operators all see
"draining since T, N entries remaining." A drain that looks like normal
operation with mysteriously refused admissions will be diagnosed as an
outage.

## Step two: dispose of every entry, per class, by prior decision

Each waiting entry gets exactly one of three dispositions, chosen **per
class in advance** — during the incident is the worst time to invent
policy:

- **Finish** — keep promoting until done, under the drain deadline.
  Right for short, valuable, hard-to-reconstruct work. The deadline is
  non-negotiable: finish-without-deadline is the hang, because arrival
  stopped but service time did not become bounded.
- **Park** — persist the entry durably; the next incarnation decides its
  fate. Right for work that is valuable but not urgent, and the only
  disposition that survives *unplanned* death (below). Parking is a
  promise transfer, not a promise kept — the entry's owner is now the
  restart path, and that owner must exist in code, not intention.
- **Revoke** — notify the waiter that the promise is withdrawn, with the
  reason. Right for work that is cheap to resubmit or stale by
  definition after a restart. Revocation is a *message*, not an absence:
  a waiter who learns of revocation by timeout learned nothing except
  not to trust the queue
  ([failure-not-empty-success](../../_laws.md#failure-not-empty-success)).

Running work is the executor's drain problem (stop requests, deadlines,
and the termination ladder live at the process layer); the queue's duty
ends at not promoting into a closing system and reporting what remains.
Every entry leaves by a named exit
([creation-names-reaper](../../_laws.md#creation-names-reaper)): finish,
park, or revoke — "the process ended" is not one of the three.

## The restart is half the design

Parking without a recovery path is deletion with a delay. The next
incarnation, at startup, must:

- **Find** parked entries — which means the park record lives in durable
  storage the successor reads on its normal startup path, not in a file
  someone must remember exists.
- **Distinguish** parked from abandoned. A parked entry carries the
  drain's stamp: when parked, by which incarnation, under which policy
  version. An entry that merely *looks* queued in storage — no stamp,
  unknown provenance — is a different thing: possibly from a crash,
  possibly half-processed, and the recovery for "cleanly parked" must
  not be applied to "found in the wreckage" as if they were equal facts.
- **Re-admit or revoke, explicitly.** Re-admission is a new admission:
  the entry passes the gate again (capacity, quota, pressure — all may
  have changed) and receives a fresh queue identity while keeping its
  logical request identity for dedup and traceability
  ([identity-survives-reuse](../../_laws.md#identity-survives-reuse) —
  restart is one of the reuses identity must survive). Staleness is
  checked here: a parked entry whose trigger condition has passed, or
  whose requester is gone, is revoked at recovery, not executed into the
  void.

## Unplanned death: drain's dark twin

Crashes do not run drain. The design question is what the *successor*
finds: entries persisted at enqueue time survive and are recovered by the
same distinguish/re-admit/revoke path; entries held only in memory are
simply gone, and every waiter is owed a way to discover that (a status
query answering "unknown request" honestly beats a silence that reads as
"still waiting"). Which posture is right is a per-class durability
decision — paying a durable write per enqueue buys crash-surviving
promises; skipping it buys throughput and accepts that a crash voids the
line. Either is defensible; only the undecided version — memory-held
entries whose waiters were promised durability by the interface's
demeanor — is a defect. Waiter-side defense is idempotent resubmission
keyed by the logical request identity, which turns "did my request
survive?" from a mystery into a safe retry.

## Drain is rehearsed

Drain code runs rarely and matters most at the worst moment, which is the
profile of code that has silently rotted. Restarting under a non-empty
queue in a test environment — some entries finishing, some parked, some
revoked, then verifying the successor's recovery — is a cheap rehearsal
that catches the classic rots: the disposition switch missing a class
added last quarter, the park store the successor stopped reading after a
schema change, the revocation notice that renders as a blank error. A
drain path exercised only by production shutdowns is a promise ledger
audited only during fires.
