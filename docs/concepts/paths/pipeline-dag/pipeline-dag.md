---
layer: golden-path
subject: pipeline-dag
status: forged
techniques:
  - graph-validation
  - node-execution-model
  - conditional-edges
  - pause-and-gate-nodes
  - deterministic-vs-model-nodes
  - external-adapter-nodes
evidence:
  - src-tauri/src/engine/pipeline_executor.rs          # predecessor map, conditional edges + transitive skip propagation, per-transition persist+emit, approval gate that waits indefinitely, command nodes beside model nodes, fan-in input merge, per-run budget halt at dispatch
  - src-tauri/src/commands/teams/teams.rs              # run-start topo sort; cycle refusal with the cycle's member ids named; BEGIN IMMEDIATE single-run-per-graph guard
  - src-tauri/src/engine/automation_runner.rs          # external dispatch: SSRF-validated endpoint, auth resolved before the run record exists, run record brackets the wire, typed audit row
  - src-tauri/src/engine/platforms/deploy.rs           # save-on-success-only: local automation row created after the remote confirms; created-but-not-activated recorded honestly
  - src-tauri/src/engine/platforms/n8n.rs              # per-adapter target policy: base endpoint pinned from credential, path ids validated alphanumeric before interpolation
counter_evidence:
  - src-tauri/src/engine/pipeline_executor.rs          # evaluate_condition fails OPEN — a malformed condition or unknown operator silently fires the branch (the unevaluable≠verdict rule violated toward true)
deviations:
  - w8-pipeline-dag   # anchor in docs/concepts/golden-path-deferred-fixes.md
  - w2-hitl-approval    # pipeline approval pending state in-memory; restart sweep fails running/awaiting_approval runs instead of resuming — anchor in docs/concepts/golden-path-deferred-fixes.md
  - w2-retry-backoff    # registered "retryable set omits 429" — 429 since added in code (2026-08-16); the Retry-After hint remains unread, so the residual stands
---

# Pipeline & DAG execution

A user draws a graph: steps, arrows between them, conditions on the arrows, a
few nodes that wait for a human. The system's job is to execute that graph —
every dependency honored, every branch decision explainable, every node's fate
visible while it runs and reconstructable after. This subject owns the
machinery for **executing an explicit, user-authored graph of dependent
steps**: validation of the graph before anything runs, per-node dispatch and
status, conditional branching, durable pauses, and the discipline around nodes
whose effects leave the system.

The boundaries matter because three neighboring subjects look similar from a
distance. [Scheduling](../scheduling/scheduling.md) owns *when a pipeline
starts* — clock rules, event subscriptions, overlap policy; this subject picks
up at the moment a run exists. [Human-in-the-loop
approval](../hitl-approval/hitl-approval.md) owns the *mechanics of the human
gate* — the pending record, the decision surface, the verdict; this subject
owns how a graph suspends around such a gate and resumes after it. And agent
chaining — handoffs wired through events, where the "graph" is implicit in
who subscribes to what — is a different subject entirely: there the topology
emerges from subscriptions and can change under you; here the topology is an
artifact the user authored, and that difference drives every design decision
below.

## The core stance: the graph is data, and the run is a state machine over it

An executable pipeline has two lives. First it is a **document** — nodes and
edges the user edits, with no execution semantics attached. Then, at run
start, it becomes the **read-only program** of a state machine whose mutable
state is *per-node status*. Every mature engine converges on this separation,
and most pipeline defects trace to blurring it: executing a graph while it is
being edited, deriving "what runs next" from code instead of from the stored
topology, or holding node status in process memory where a restart erases it.

Four commitments follow:

1. **The graph is validated when it is authored or accepted, not when it
   runs.** Cycles, unreachable nodes, edges pointing at nothing, malformed
   conditions — all of these are *rejectable at the door*, by static analysis
   of the document, before any run exists. An invalid graph discovered
   mid-run is therefore a design failure twice over: once because the defect
   shipped, and once because it surfaced at the moment of maximum cost —
   halfway through side effects — instead of at the moment of zero cost.
   The full discipline is [graph-validation](techniques/graph-validation.md).
2. **A run pins its graph.** The run executes the version of the graph that
   existed when it started. Edits during a run apply to the *next* run; a
   topology that mutates under an in-flight run makes every completed node's
   status unauditable, because the graph it was true of no longer exists
   ([identity-survives-reuse](../_laws.md#identity-survives-reuse)).
3. **Node status is durable and evented.** Each node's state — waiting,
   running, succeeded, failed, skipped, paused — is persisted at every
   transition and broadcast as it changes. Persistence is what makes restart
   recovery possible: a process that comes back finds the run where it
   stopped, not at the beginning and not lost. Events are what make the run
   observable while alive: a canvas that shows nodes lighting up is reading
   the same transitions the recovery logic replays.
4. **Progress is computed from the data, not remembered by the code.** "Which
   nodes are ready" is a pure function of the pinned topology plus persisted
   statuses plus edge-condition outcomes. Nothing about run progress may live
   only in a call stack. This is the property that makes crash, restart,
   pause, and resume all *the same operation*: recompute readiness from
   state, dispatch what is ready.

## The status vocabulary carries the semantics

The engine's real interface is its per-node status vocabulary, and it needs
one authority ([one-authority-per-vocabulary](../_laws.md#one-authority-per-vocabulary))
because every consumer — dispatch logic, recovery sweep, the canvas, run
history — keys on it. The load-bearing distinctions:

- **Skipped is not failed.** A node on a branch that did not fire is
  *skipped*: the run chose a different path, and that is success-shaped, not
  failure-shaped. Conflating them poisons everything downstream — retry
  logic re-runs nodes that were never meant to run, and operators learn to
  ignore "failed" because half the failures are branches.
- **Paused is not running.** A node waiting on a human gate is in a distinct,
  durable, queryable state. A pause modeled as a long-running node is
  invisible to "what needs attention" queries and dies with the process
  (see [pause-and-gate-nodes](techniques/pause-and-gate-nodes.md)).
- **Unevaluable is not false.** When an edge condition cannot be evaluated —
  missing field, type mismatch, malformed predicate — the honest outcome is
  an error attached to the evaluation, never a silent "condition was false"
  ([failure-not-empty-success](../_laws.md#failure-not-empty-success)). A
  branch that silently doesn't fire because of a typo is the single most
  expensive lie a pipeline engine tells
  (see [conditional-edges](techniques/conditional-edges.md)).

## Nodes are not all alike, and the engine must know it

A graph mixes node classes with different physics. A deterministic command
node can be retried and produces the same effect for the same input; a
model-backed node produces a *new sample* on every attempt, costs money per
attempt, and returns output that must be validated before anything downstream
trusts it; an external adapter node reaches outside the system's boundary,
where retries can double-publish and inputs the user typed become attack
surface. The engine's retry, idempotency, and validation posture is therefore
**declared per node class, not global** — one uniform policy is guaranteed
wrong for at least one class. The contracts live in
[deterministic-vs-model-nodes](techniques/deterministic-vs-model-nodes.md)
and [external-adapter-nodes](techniques/external-adapter-nodes.md); retry
mechanics themselves belong to
[retry-backoff](../retry-backoff/retry-backoff.md), which this subject
consumes rather than reinvents.

## Failure has a propagation policy, chosen on purpose

When a node fails terminally, the graph downstream of it cannot run — but the
graph *beside* it can. The engine must take a stated position: fail the whole
run immediately, or let independent branches complete and report a partially
failed run. Both are defensible; the accident — whichever behavior falls out
of the dispatch loop unexamined — is not, because the user experiences it as
policy either way. Whatever the choice, downstream nodes of a failure are
marked with their own status (blocked or skipped-by-failure, distinguishable
from branch-not-taken), so the post-mortem reads from statuses alone: this
failed, these never got the chance, those were legitimately not on the path.

## What "done" looks like for this subject

A pipeline engine meets the bar when: a malformed graph cannot start — the
authoring surface rejects it with the defect named (the cycle's members, the
orphan's id), not "invalid graph"; a run survives process death and resumes
from persisted node state without re-running completed side effects; every
branch decision is reconstructable — which edges fired, which did not, and
what the predicate saw ([count-carries-predicate](../_laws.md#count-carries-predicate)
applied to control flow); a human gate can hold a run open across days and a
restart, and resolves by explicit verdict or stated timeout policy, never by
default-proceed; and a node that deploys or publishes validates its inputs,
records the attempt durably before and after, and registers artifacts only on
confirmed success. The user who drew the graph should never need to read
engine internals to answer "why did it do that" — the statuses, the branch
records, and the run history *are* the answer.
