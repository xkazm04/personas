---
layer: technique
subject: pipeline-dag
technique: node-execution-model
status: forged
laws:
  - one-authority-per-vocabulary
  - identity-survives-reuse
  - failure-not-empty-success
  - creation-names-reaper
shared_with: []
---

# Node execution model

The executor's whole job reduces to one loop: find the nodes whose
predecessors are settled, dispatch them, record what happened, repeat until
nothing is dispatchable. Everything hard about pipelines lives in making that
loop's *state* durable, its *transitions* observable, and its *restart* a
non-event.

## The status vocabulary

One enumerated set, defined in exactly one place, consumed by dispatcher,
recovery, persistence, and every display surface
([one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary)):

| Status | Meaning | Terminal? |
|---|---|---|
| **pending** | predecessors not yet settled | no |
| **running** | dispatched; an attempt is in flight | no |
| **paused** | suspended on a gate or external wait, durably | no |
| **succeeded** | attempt completed; outputs recorded | yes |
| **failed** | attempts exhausted; error recorded | yes |
| **skipped** | legitimately not on the taken path | yes |
| **blocked** | can never run because an upstream node failed | yes |
| **cancelled** | run was cancelled while this node was unsettled | yes |

The three "did not execute" terminals — skipped, blocked, cancelled — are
deliberately distinct. They answer different questions ("branch not taken" /
"upstream broke" / "human stopped it"), they feed different downstream
policies, and collapsing them makes run history unreadable. Legal transitions
are enumerated and enforced at the single write path; an illegal transition
(succeeded → running) is a bug surfacing, and must throw, not overwrite.

## Readiness is a pure function

A node is **ready** when every incoming edge is *resolved*: its source node
is terminal, and its condition (if any) has an evaluation outcome. The
combination rule at a join is declared per node — *all* resolved-and-firing
(the default: a true join) or *any* (a merge point) — and skip propagates
through it: a node all of whose incoming edges resolved as not-firing or
skip-sourced becomes skipped itself, transitively, without executing. This
function reads only pinned topology + persisted statuses + recorded condition
outcomes. It holds no memory of its own — which is precisely what lets crash
recovery, pause resume, and normal progress share one code path: *recompute
readiness, dispatch the ready set*.

## Every transition is persisted, then broadcast

The write ordering is fixed: persist the status change, then emit the event.
An event emitted before the write can be observed by a consumer that then
reads the old state — the display flickers backwards, or worse, an automation
acts on a transition the store later denies happened. Consumers treat events
as *invalidation hints* and the store as truth; a consumer that missed events
(it was offline, the buffer overflowed) recovers by re-reading, losing
nothing but latency. Each transition record carries: node id, run id, old →
new status, timestamp, attempt number, and for failures the classified error
([failure-not-empty-success](../../_laws.md#failure-not-empty-success) — a
failed node with no recorded error is indistinguishable from a mystery).

## Identity: run, node-in-run, attempt

Three identities, minted at creation, never derived from position or time
([identity-survives-reuse](../../_laws.md#identity-survives-reuse)): the
**run** (this execution of the graph), the **node-execution** (this node
within this run), and the **attempt** (this try of this node-execution,
because retries exist). Outputs key on node-execution; logs and external
idempotency keys carry the attempt; dedup on restart keys on all three.
Deriving any of these from "node name + timestamp" collides the moment a
graph is duplicated, a node renamed, or two runs overlap.

## Output passing

A node's outputs are persisted at success as part of the same transition that
marks it succeeded — never held in memory for the successor to collect. The
successor reads its inputs from the store when dispatched. This costs a
serialization round-trip and buys the entire durability story: a restart
between producer and consumer loses nothing, and "what did this node emit"
is answerable forever, which is what makes branch decisions and downstream
failures auditable. Large payloads store by reference (an artifact id), with
the reference subject to the same rule.

## Restart recovery

On process start, before any new dispatch:

1. **Sweep the orphans.** Every node-execution in `running` whose attempt
   belonged to a previous process incarnation is a leaked claim
   ([creation-names-reaper](../../_laws.md#creation-names-reaper)). Its fate
   is decided by the node's declared class contract (see
   [deterministic-vs-model-nodes](deterministic-vs-model-nodes.md)): safely
   re-runnable classes reset to pending with the attempt recorded as
   interrupted; effectful classes whose completion is unknowable mark failed
   with a distinguishable "interrupted" error, for a human or a healing
   policy to adjudicate. What the sweep may never do is nothing — a node
   stuck in `running` forever deadlocks its entire downstream subtree.
2. **Recompute readiness and resume.** No replay of completed work, no
   special resume mode: the normal loop over recovered state *is* the resume.
3. **Honor pauses.** Paused nodes stay paused — a restart is not an answer
   to a question a human hasn't answered
   (see [pause-and-gate-nodes](pause-and-gate-nodes.md)).

## Decision rules

- Bound parallelism at dispatch (a per-run and a global concurrency budget);
  the ready set is a candidate list, not a command to fork.
- Cancellation is a request flag checked at dispatch boundaries and between
  attempts, plus best-effort interruption of in-flight work; nodes already
  terminal keep their status, unsettled nodes go to cancelled — a cancelled
  run must read as "stopped here", not as a failure storm.
- The dispatch loop's cadence (event-driven, polling, or hybrid) trades
  latency for simplicity; what it may not trade away is the invariant that
  *every* settle eventually triggers a readiness recomputation — a lost
  wakeup is a run frozen in a healthy-looking state.
- Timeouts per node class, always: a node with no deadline names no reaper
  for its own hang.
- A node's deadline counts *execution* time, not queue wait. Under admission
  control a dispatched attempt can legitimately sit queued for a long time
  waiting for a slot; a flat wall-clock timeout fails nodes that never ran —
  which reads as a node defect when it is a capacity signal. Budget running
  seconds against the node's deadline, and bound total wall-clock separately
  (generously) so a permanently stuck queue still cannot hold the run
  hostage.
