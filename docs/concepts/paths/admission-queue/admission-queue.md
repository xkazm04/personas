---
layer: golden-path
subject: admission-queue
status: forged
techniques:
  - admission-vocabulary
  - depth-bounds-and-shed
  - priority-and-fairness
  - load-aware-admission
  - wait-telemetry
  - drain-and-shutdown
evidence:
  - src-tauri/engine/src/queue.rs                        # AdmitResult closed 3-way verdict; priority levels; per-tenant + global caps; bounded depth with refuse-newest shed; wait_ms stamped at promotion; quota + resource gates composed into one verdict
  - src-tauri/src/engine/resource_governor.rs            # host CPU/memory admission gate: asymmetric per-signal watermarks, hysteresis, first-sample skip, logged transitions
  - src-tauri/src/engine/mod.rs                          # verdict handling per outcome; queue status events on queued/promoted; durable queue rows — restart re-admits queued through the normal gate, revokes running with an explicit reason
  - src-tauri/engine/src/test_runner.rs                  # bounded fan-out cap on parallel cells — the permit-based admission posture (wait, never refuse), documented and bounds-tested
counter_evidence:
  - src-tauri/src/commands/infrastructure/task_executor.rs   # durable "running" marker written BEFORE the admission door — refusal strands the row in running forever
deviations:
  - w8-admission-queue   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Execution queue & admission control

This is the subject you own when requests to do expensive work arrive faster,
or lumpier, than the system can execute them — and something must decide, for
each request, one of three things: **run it now, hold it for later, or refuse
it**. That decision layer is the admission queue. It sits between "work was
requested" and "work is running", and it is a real component with its own
state, its own policies, and its own failure modes — not a buffer that
happened to grow a waiting line.

The boundary with neighboring subjects is precise. This subject owns the
**decision discipline**: the verdict vocabulary, the bounds, the ordering, the
fairness rules, the wait accounting, and the drain. What happens to an
admitted request *after* it becomes a running child process — spawn hardening,
liveness, termination, reaping — is
[subprocess-lifecycle](../subprocess-lifecycle/subprocess-lifecycle.md)'s
subject; its
[concurrency-and-slots](../subprocess-lifecycle/techniques/concurrency-and-slots.md)
technique is the process-level view of the same gate (the slot that must exist
before a child does), and the two meet at the moment a queued request is
promoted: this subject decides *who is next*, that one decides *what a slot
commits*. Limiting the **rate** of requests against a keyed external budget —
requests per minute against a provider, per API key — is rate-limiting's
subject; a rate limit shapes a flow over time, an admission queue arbitrates
occupancy of finite capacity, and conflating them produces a limiter that
starves or a queue that meters. The recurring loops that *consume* the queue
— drain ticks, promotion sweeps — are hosted by
[background-jobs](../background-jobs/background-jobs.md); this subject
specifies what the tick must decide, not how the tick is scheduled. And a
queue whose entries are *humans deciding* rather than machines executing is
[triage-queues](../triage-queues/triage-queues.md) — same skeleton,
different physics, because a human consumer cannot be scaled by config.

Three facts make this subject harder than it looks:

1. **The queue is invisible until it is the problem.** A system with an
   undisciplined admission layer looks identical to a healthy one at low
   load. Every defect in this subject — unbounded depth, starvation, silent
   refusal, wait time booked as execution time — is a defect that only
   manifests under the exact conditions (saturation, burst, shutdown) where
   diagnosis is hardest and stakes are highest.
2. **"Later" is a promise.** Accepting a request into the queue is a
   commitment: someone now owes that request either an execution or an
   explicit revocation. Systems fail this promise in both directions —
   queues that hold entries forever, and restarts that vaporize them without
   a word to the requester.
3. **Every admission policy is a refusal policy.** A queue that "never
   refuses" has merely chosen the worst refusal policy available: refuse by
   timeout, at maximum latency, after consuming maximum resources, with no
   reason attached.

## The verdict is a closed vocabulary

The admission decision has exactly three outcomes, and a caller must be able
to distinguish them without inference:

- **Admitted** — running now; capacity was available and is now held.
- **Queued** — will run later; the verdict carries *position* (or an honest
  wait estimate), because "waiting" without "behind what" is not information
  a caller can act on.
- **Refused** — will never run from this request; the verdict carries a
  *reason* (queue full, over quota, resource pressure, draining), because
  the correct caller reaction differs per reason: retry later, reduce
  demand, escalate, or give up.

Collapsing any pair of these is a distinct, recognizable outage. Queued
reported as admitted produces the "it says running but nothing is happening"
ticket. Refused reported as queued is a promise the system has already
decided to break — the request waits forever for a turn that was never
coming. Refused collapsed into an exception makes shed — a *designed,
healthy* behavior — indistinguishable from a crash. The
[admission-vocabulary](techniques/admission-vocabulary.md) technique owns the
result set, the reason taxonomy, and the caller contract per outcome.

## Bounded depth is non-negotiable

An unbounded queue is not a safety feature; it is **an outage with latency**.
When arrival rate exceeds service rate, an unbounded queue converts the
overload into three deferred failures: memory growth in the queue itself,
wait times that pass the point where the requester still wants the answer,
and — the cruelest — a backlog of stale work that the system must grind
through *after* the incident, serving no one, before it can serve anyone.
Depth is bounded by design, and what happens at the bound is a **chosen shed
policy**, not an accident: refuse the newest arrival, evict the oldest
waiter, or reject by class — each is correct for a different workload, and
the choice is stated where operators can read it. The
[depth-bounds-and-shed](techniques/depth-bounds-and-shed.md) technique owns
the bound, the shed policies, and the backpressure signal that makes
producers participate instead of retry-hammering.

## Ordering is a policy, and fairness is part of it

First-come-first-served is a legitimate policy; it is not a default that
absolves the designer of choosing. The moment requests have unequal urgency
(interactive versus batch) or unequal origins (many tenants, one machine),
plain arrival order silently implements a *bad* policy: urgent work waits
behind bulk work, and one eager tenant occupies every position while the
gauge reads healthy. Priority levels order by urgency; per-tenant caps bound
any one origin's occupancy; and both create starvation as a side effect,
which **aging** — waiting entries gaining effective priority — repairs. The
[priority-and-fairness](techniques/priority-and-fairness.md) technique owns
the levels, the caps, the starvation analysis, and the identity discipline
that keeps entries traceable while policies reorder them.

There is a second enforcement posture worth naming because it inverts this
subject's default: **eviction-side capacity**. When the newcomer cannot wait
(a user is opening a session *now*) and existing occupants are cheaply
parkable and resumable, the better design admits the newcomer immediately
and reclaims capacity from the longest-idle occupant — a deliberately *soft*
cap that a burst of genuinely busy occupants may exceed. That posture is
[fleet-orchestration](../fleet-orchestration/fleet-orchestration.md)'s
ground, and the contrast is instructive: admission-side queueing assumes the
request can wait and in-flight work is sacred; eviction-side reclaiming
assumes the request cannot wait and *idle* occupancy is the resource to
spend. Choosing between them is a statement about which side of the gate
holds the urgency.

## Admission watches the host

Capacity counted in slots is a model; the machine is the reality. A queue
that admits strictly by count will cheerfully promote work onto a host
already drowning in memory pressure — each admission legal by the ledger,
the sum lethal. Load-aware admission adds a second gate that consults the
host's actual condition and **defers promotion** (never interrupts running
work) while pressure is real. The gate needs three disciplines to avoid
becoming its own incident: **asymmetric thresholds** per signal (the level
that means "stop admitting" and the level that means "resume" are different
numbers, chosen per signal's meaning), **hysteresis** between them (so the
gate does not flap open and shut at a boundary, admitting in stutters), and
honesty about the **probe's own cost and failure** (a gate that cannot read
the host must choose fail-open or fail-closed out loud). The
[load-aware-admission](techniques/load-aware-admission.md) technique owns
the signals, the thresholds, and the flap-proofing.

## Wait is measured, separately

Time in queue and time executing are different numbers with different
owners, and a system that reports only their sum slanders its executor: a
fast executor behind a slow queue reads as a slow executor, and every
optimization that follows attacks the wrong component. The queue therefore
stamps admission-to-promotion time as its own first-class measurement,
reports current depth *with the predicate of what is counted*
([count-carries-predicate](../_laws.md#count-carries-predicate) — entries
waiting, entries held-but-promoting, and entries running are three numbers
that diverge exactly under load), and exposes oldest-wait per class, which
is the number that catches starvation before a user does. The
[wait-telemetry](techniques/wait-telemetry.md) technique owns the
measurements, the split, and the wait-time objectives.

## Drain is designed

Shutdown arrives while the queue holds promises. A design that has not
decided what happens to them decides by accident: entries vanish on restart
(a silent broken promise), or shutdown blocks indefinitely behind a backlog
(a hang wearing a queue's clothes). Drain is an explicit mode with an
explicit disposition for every entry: stop admitting (new arrivals get
*refused: draining*, not queued into a dying process), then for the waiting
entries either **finish** them under a deadline, **park** them durably for
the next incarnation, or **revoke** them with notice — per class, chosen in
advance. The complementary startup question — what does the next incarnation
do with parked entries, and how does it distinguish them from abandoned
ones — is the same design, read in the other direction. The
[drain-and-shutdown](techniques/drain-and-shutdown.md) technique owns the
mode, the dispositions, and the restart recovery.

## The request's admission lifecycle

Every request is in exactly one of these states with respect to admission,
and each transition is owned by named code:

| State | Meaning | The queue's obligations |
| --- | --- | --- |
| **arrived** | verdict pending | decide promptly; the verdict is one of exactly three outcomes |
| **admitted** | running; capacity held | hand off to the execution owner; start execution clock, stop wait clock |
| **queued** | waiting; position known | fair ordering per stated policy; position/wait visible; cancellable at zero cost |
| **refused** | will never run from this request | reason attached, from the closed taxonomy; nothing retained |
| **shed** | was queued, then removed by policy | requester notified with reason; distinct from cancelled-by-requester |
| **parked** | held durably across a shutdown | next incarnation re-admits or revokes, explicitly |

Two rules fall out of the table:

1. **Every entry names its exit.** A queued entry leaves by promotion, by
   requester cancellation, by shed, by drain disposition — never by being
   forgotten ([creation-names-reaper](../_laws.md#creation-names-reaper)
   applied to queue entries: the entry's reaper is named at enqueue).
2. **No state is inferable from silence.** "Still queued" and "lost" must
   be distinguishable by asking the queue, because a requester who cannot
   tell them apart will resubmit — and duplicate admission is the queue
   manufacturing its own overload.
3. **The verdict precedes the durable record.** Any persistent trace that
   says "this work started" is written *after* admission, never before —
   a record written first outlives a refusal in the one state nothing
   sweeps: started-and-never-finished. And the capacity check and the
   capacity *take* are one atomic operation: a separate "is there room?"
   followed by "take the room" is a race whose losers all believe they
   won, and its symptom is a cap exceeded by exactly the number of
   simultaneous arrivals.

## The techniques

- [admission-vocabulary](techniques/admission-vocabulary.md) — the closed
  three-way verdict, refusal reasons as data, the caller contract per
  outcome.
- [depth-bounds-and-shed](techniques/depth-bounds-and-shed.md) — bounded
  depth, shed policy selection, backpressure to producers.
- [priority-and-fairness](techniques/priority-and-fairness.md) — priority
  levels, per-tenant/per-class occupancy caps, starvation and aging.
- [load-aware-admission](techniques/load-aware-admission.md) — host
  pressure gates, asymmetric thresholds, hysteresis, probe honesty.
- [wait-telemetry](techniques/wait-telemetry.md) — queue-time as its own
  measurement, depth with predicates, oldest-wait, wait objectives.
- [drain-and-shutdown](techniques/drain-and-shutdown.md) — drain mode,
  finish/park/revoke dispositions, restart recovery of parked work.
