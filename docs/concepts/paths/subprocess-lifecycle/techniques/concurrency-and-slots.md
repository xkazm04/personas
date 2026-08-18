---
layer: technique
subject: subprocess-lifecycle
technique: concurrency-and-slots
status: forged
laws: [gate-sees-target, creation-names-reaper, count-carries-predicate]
shared_with: []
---

# Concurrency and slots

The production shape of this subject is not one child — it is **many
children at once on one shared machine**, spawned by a host that must keep
the machine, the siblings, and itself healthy while doing it. Concurrency
here is not "the same thing, several times": it introduces admission,
fairness, and ownership problems that simply do not exist at N=1, and a
design that treats parallelism as a loop around the single-child path will
rediscover each of them as an outage.

## Admission: the slot precedes the process

A spawn commits real machine resources the moment it succeeds. The host
therefore acquires a **slot** — a unit of a bounded scheduler — *before*
creating the process, and the request that cannot get a slot **queues or is
refused**, explicitly and visibly. The inverted design (spawn freely,
notice pressure later) discovers the cap by symptom: swap, descriptor
exhaustion, a machine so loaded the host cannot even run its own
termination ladder.

Slot mechanics that matter:

- **A queued request is cancellable.** The user who triggered it can
  withdraw before a slot arrives, and withdrawal must cost nothing — no
  process was created, so no ladder runs.
- **The slot is released by the reap**, not by the happy path. Every exit
  route — completion, kill, spawn failure, orphan sweep — converges on the
  release ([creation-names-reaper](../../_laws.md#creation-names-reaper):
  the slot's reaper is the reap). A slot leaked on an error path shrinks
  the cap by one, permanently, with no alarm — the host just gets slower
  at concurrency until someone counts.
- **Queue order is a policy, stated.** Plain arrival order is legitimate;
  so is priority by class. Undocumented reordering is how "my run has been
  queued for an hour" becomes undiagnosable.
- **The queue itself is bounded.** Admission control that accepts an
  unbounded backlog has only moved the resource exhaustion from processes
  to queue entries — and hidden it from the user, whose request silently
  joined position four hundred. Past a stated depth, enqueue *refuses*,
  visibly, as backpressure the caller can act on.

**The cap has a second enforcement posture: eviction.** Admission-side
enforcement — queue the new request until a slot frees — assumes the new
request can wait. When the spawn is imperative (the user is opening a
session *now*) and the existing children are cheaply **resumable** (their
state persists; a parked child can be revived later), the better posture
inverts: admit the newcomer and reclaim a slot by parking the
longest-idle reclaimable child. Two rules keep eviction honest: only
demonstrably idle children are reclaimable — actively working children
are never evicted to make room, because destroying in-flight work to
start speculative work is a strictly losing trade — and that makes the
cap deliberately *soft*: a burst of genuinely busy children may exceed it
until some go idle, which the design states out loud rather than
pretending the bound is hard.

## Caps are layered, because they protect different things

One number is not enough:

- **The global cap** protects the machine: the maximum concurrent children
  the host will host, chosen against cores and memory, not aspiration.
- **Per-class caps** protect the mix: heavyweight runs (builds, agent
  sessions) get a small sub-cap so a burst of them cannot occupy every
  global slot that lightweight quick tools also need.
- **Per-tenant caps** protect fairness: whoever "tenants" are — users,
  projects, requesting features — one of them queueing fifty requests must
  not starve the rest while the global gauge reads healthy.

A cap is a **count with a predicate**
([count-carries-predicate](../../_laws.md#count-carries-predicate)): "eight"
means nothing until it says eight *of what, counted how* — live processes,
held slots, or queued intents are three different numbers that diverge
exactly when the system is in trouble. And the counter must observe the real
population ([gate-sees-target](../../_laws.md#gate-sees-target)): a ledger
of slots-we-believe-are-held drifts from processes-that-exist whenever a
release path is missed, and an admission gate reading the drifted ledger
either over-admits onto a loaded machine or refuses admission to an idle
one. Periodic reconciliation between ledger and actual process table is the
gate's own health check.

## Disjoint mutable ownership

The deepest correctness rule of parallel children: **two concurrent
children never share a mutable resource unless that resource was designed
for concurrent writers.** Most resources were not. The standard ownership
matrix:

| Resource | Concurrent posture |
| --- | --- |
| scratch/working directory | per-child private; created by the door, deleted by the reap |
| shared input data | read-only during any child's lifetime; mutations happen between runs |
| tool caches | only if the tool guarantees concurrent safety; otherwise exclusive (below) |
| ports / named endpoints | allocated per child from a managed range, or owned by exactly one |
| session/state files | owned by exactly one live child; enforced, not assumed |
| the output channel | per-run, keyed by run identity — never a shared sink that interleaves |

"Enforced, not assumed" is the operative phrase. Disjointness by convention
survives until two features are developed independently; disjointness by
construction — the door *allocates* the private directory, the port, the
identity — cannot be forgotten at a call site.

## Exclusion across host instances

The host's slot scheduler governs the children **it** spawned — and nothing
else on the machine. Parallel host instances, sibling tools, and manual
sessions spawn their own children against the same machine and, critically,
against the same *globally exclusive* resources: a build cache that corrupts
under concurrent writers, a device, a migration lock. For those, in-process
caps are structurally blind, and the exclusion must live **at machine
scope**: an advisory lock artifact in a shared location, carrying the
holder's identity and a liveness stamp, checked before entering the
exclusive section.

Machine-scoped locks inherit every classic lease problem: the holder dies
without releasing (hence the liveness stamp and a staleness threshold with
slack), the id in the lock is recycled (verify identity, not just
existence), and two candidates race the takeover (the acquire must be
atomic where the platform allows, verify-after-write where it does not).
The reward is the only guarantee in-process schedulers cannot give: *no
writer of this resource exists anywhere on the machine but me.*

When the exclusive condition is itself "no sibling process of class X is
running", a **stateless check beats a lock artifact**: enumerate the live
process population directly at the decision point instead of maintaining
a lock that mirrors it. The lock artifact needs a release path, and a
crashed holder leaves a stale lock that blocks everyone; the population
*is* the ground truth, so observing it cannot go stale
([gate-sees-target](../../_laws.md#gate-sees-target), applied to
exclusion). The trade: enumeration can fail, and the design must choose
its failure direction explicitly — fail-open with a loud warning when a
false block would halt all work and a false allow merely risks the
contention the check mitigates, fail-closed when the protected resource
corrupts. Either way, the degraded state is *announced*, never silent.

## Bursts, staggering, and the stampede

Parallel spawns arrive in bursts — a fan-out of N analysis children, a
startup that re-launches everything at once. Even under the cap, launching
a full batch in the same instant serializes the machine through N
simultaneous cold starts (process creation, runtime init, first-touch I/O
are the expensive phase). A small **stagger** between launches, or a
ramp-up of the effective cap, converts the stampede into a pipeline: the
first children reach their steady, cheaper phase before the last ones pay
their expensive one. The stagger belongs in the scheduler, where it is
uniform and visible — not as ad-hoc sleeps in call sites.

## What the scheduler reports

Because admission is centralized, observability is nearly free, and it
should be taken: current live count against each cap, queue depth and
oldest-wait per class, slot-hold duration distribution, and — the number
that catches leaks — slots held with no corresponding live process. A slot
scheduler that cannot answer "why is this queued?" in one lookup has
centralized the control but not the explanation.
