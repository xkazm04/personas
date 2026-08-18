---
layer: technique
subject: delivery-guarantees
technique: atomic-claiming
status: forged
laws:
  - identity-survives-reuse
  - creation-names-reaper
shared_with:
  - job-coordination
---

# Atomic claiming

Between "this event is pending" and "this worker is processing it" lies the
single most consequential transition in the pipeline. Done wrong, two workers
process the same event (a duplicate the guarantee analysis never budgeted
for), or a worker processes an event the system still shows as pending (a
ghost whose completion surprises everyone). The technique is one move —
**claim by conditional write, and make the claim carry evidence** — plus the
discipline of ordering everything else around it.

## The claim is a conditional write, not a read-then-write

The broken shape reads first: select a pending event, then mark it
processing. Between the read and the write, a second worker performs the same
read and both believe they won. The window is small, which is worse than
large — it opens exactly under load, when multiple workers drain the same
queue, and never in the test that checks one worker at a time.

The correct shape is a single atomic compare-and-set: *set status to
processing where id is this and status is still pending*, then check whether
the write affected anything. **The row count of the conditional write is the
election result.** One means this worker won; zero means someone else did,
and the loser walks away without touching the event. There is no verify step,
no lock acquired around the pair, no apology protocol — the store's own
atomicity on a single conditional update is the entire mechanism. (Locks,
leases, and multi-row arbitration in general are concurrency-guards'
subject; a work-item claim is the one-row special case that needs nothing
more.)

Two orderings follow from it:

- **Claim before compute.** All expensive or effectful work happens strictly
  after the claim is won. Work done before the claim is work potentially done
  twice — by the loser who hasn't found out yet.
- **Complete with the same conditionality.** The finishing write — done,
  failed, retry-scheduled — also conditions on "still processing, still held
  by me." A worker that was reaped while alive (slow, not dead) must discover
  at completion time that its claim was revoked, and must not overwrite the
  state the reaper assigned. Losing this race politely is part of the
  protocol.

## The claim carries evidence: holder and timestamp

A bare status flip — pending becomes processing, nothing else recorded — is
an anonymous claim, and anonymous claims bankrupt every downstream question:

- *Is this event stuck?* Unanswerable — there is no claimed-at to age
  against. The reaper is reduced to folklore thresholds and two-pass
  observation (see stuck-reaping for the degraded protocol this forces).
- *Which worker has it?* Unanswerable — no incident debugging, no "drain this
  worker's claims on shutdown," no per-holder stuck patterns.
- *Is the holder alive?* Unanswerable without a holder to check on.

The claim therefore writes, atomically with the status transition: the
**holder's identity** (a worker/process/instance id that is meaningful in
logs), the **claim timestamp**, and — where workers can renew — a **lease
deadline**. This is law creation-names-reaper applied at row granularity:
the claim is a created resource, and holder-plus-timestamp is precisely the
information its reaper will need. A claim without them creates work whose
cleanup criteria were never written down.

The lease variant strengthens the timestamp into a contract: the claim is
valid *until* the deadline, the holder renews it while making progress, and
expiry is affirmative evidence of death rather than a guess about slowness.
Renewal turns "how long is too long?" from a global constant into a per-item
heartbeat — the right answer wherever processing time varies widely.

## Decision rules

- **The event's identity and the claim's identity are different things.** The
  event id is minted at acceptance and survives everything (law:
  identity-survives-reuse); the claim is per-attempt and dies with the
  attempt. Conflating them — keying dedup on the claim, or letting a
  re-claim mint a new event id — quietly breaks the guarantee analysis one
  layer up.
- **Batch claims are the same write with a limit.** Claiming N pending items
  in one conditional update is fine; claiming them with a read-then-write
  loop reintroduces the race N times.
- **Claim scope is the unit of redelivery.** Whatever is claimed together is
  retried together and dead-lettered together. Claiming a batch but recording
  failure per item means inventing partial-claim semantics under pressure;
  decide the unit before the first incident, not during it.
- **A claim that cannot be written is a full queue, not an error to retry
  blindly.** If the conditional write itself fails (store down, contention
  storm), the worker backs off per the
  [retry-backoff](../../retry-backoff/retry-backoff.md) discipline rather
  than spinning on the claim — a claim stampede against a struggling store is
  the pipeline attacking its own foundation.
