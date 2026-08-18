---
layer: technique
subject: pipeline-dag
technique: pause-and-gate-nodes
status: forged
laws:
  - gate-sees-target
  - creation-names-reaper
  - failure-not-empty-success
shared_with: []
---

# Pause and gate nodes

Some nodes exist to *not run yet*: an approval gate waiting for a human, a
wait-until-timestamp, a wait-for-external-signal. They put the graph into a
state the rest of the engine never produces — alive but intentionally inert,
possibly for days — and the design question is whether that state is a
first-class citizen or an emergent behavior of a blocked thread. The answer
decides whether the engine survives contact with real human response times.

The *mechanics* of the human decision — pending records, decision surfaces,
verdict records, fatigue budgets — are owned entirely by
[human-in-the-loop approval](../../hitl-approval/hitl-approval.md), and a
gate node should be a thin adapter over that machinery, in particular its
[gate-state-machines](../../hitl-approval/techniques/gate-state-machines.md)
discipline. What this technique owns is the *graph side*: how a pipeline
suspends around the gate, what the suspension costs, and what resuming means.

## Pause is a durable node status, not a blocked executor

The moment a gate node dispatches, it writes the question (a pending decision
record, owned by the approval subsystem) and transitions itself to **paused**
— a persisted, queryable, evented status like any other. It holds no thread,
no connection, no in-memory continuation. The run's other branches continue;
the paused subtree waits in data.

The degenerate form — a gate node implemented as a running task that polls
or blocks awaiting the verdict — deserves explicit treatment because it is
the natural first implementation and it *appears* to work. Its defects
arrive in order of increasing cost: it consumes an executor slot for the
full human latency (a handful of pending approvals exhaust a bounded worker
pool — the pipeline engine is now down because people went home); it makes
the pause invisible to status queries (the node reads as "running", so
"what needs my attention" surfaces nothing); and terminally, **the question
dies with the process** — a restart finds a `running` node whose waiting
loop no longer exists, and the recovery sweep either re-runs it (re-asking,
duplicate pending records) or fails it (an overnight deploy just rejected
every pending approval). A pause held in process memory is a question the
next restart answers with whatever the recovery code does — and that is
never a decision anyone made. If a polling waiter is nonetheless used as a
stopgap, it must at minimum wait without a self-imposed deadline shorter
than real human latency and re-derive the pending question from durable
state on restart — but these are patches on the wrong shape.

## Resume is a fresh readiness evaluation, not a continuation

When the verdict lands, the approval subsystem's record flips and the engine
is nudged (event preferred, poll acceptable) to re-evaluate. Resume then goes
through the standard machinery of
[node-execution-model](node-execution-model.md): the gate node transitions
paused → succeeded (approved) or paused → failed-or-skipped per the graph's
rejected-branch policy, and readiness recomputation dispatches whatever that
unblocks. There is no special "resume mode" — which is exactly what makes
resume-after-restart free: the paused status and the pending record are both
durable, so a process that died mid-wait recovers by reading them.

Two staleness checks belong at the resume boundary, both inherited from the
approval subject's
[resume-after-decision](../../hitl-approval/techniques/resume-after-decision.md)
discipline: the verdict must bind to the *version* of the question the gate
posed (an approval of content that has since regenerated is void), and the
executor must verify the *recorded* verdict rather than trust the resuming
caller's claim of one ([gate-sees-target](../../_laws.md#gate-sees-target) —
the gate inspects the decision record, not a message about it).

## The forgotten gate names its reaper

A paused node with no timeout is an immortal question
([creation-names-reaper](../../_laws.md#creation-names-reaper)). Every gate
declares, at authoring time, what bounded patience means for it and what
expiry resolves to — and the safe resolutions are **deny** (treat as
rejected, with the expiry recorded as the reason, distinguishable from a
human rejection: [failure-not-empty-success](../../_laws.md#failure-not-empty-success))
or **escalate/re-notify and keep holding** under a broader run-level
deadline. Timeout-means-proceed is listed only to be banned: it converts
"nobody looked" into authorization, which is the exact outcome the gate
exists to prevent.

The reaper needs calibration honesty: a timeout tuned for machine latencies
(minutes, an hour) applied to a human question is itself a defect — it
force-resolves every approval that spans a night or a weekend. Human gates
get human-scale patience or an explicit escalation ladder; the number is a
product decision, made visible at authoring time, never an engine constant
the user discovers by autopsy.

## Non-human waits are the same shape

Wait-until-timestamp and wait-for-external-signal nodes reuse the whole
structure: durable paused status, a persisted record of what would wake them
(a due time; a signal subscription), wake-by-nudge, resume through normal
readiness. The due-time case is a hand-off to the
[scheduling](../../scheduling/scheduling.md) machinery — the pipeline parks
and the scheduler owns the wake — rather than a second timer system grown
inside the executor.

## Decision rules

- **Arm the gate before announcing it.** The pending record (or whatever
  state the verdict will land in) exists *before* the decision surface is
  told a decision is needed. Announce first and a fast human answers into a
  slot that does not exist yet — the verdict no-ops, the gate then arms
  fresh, and the run hangs forever waiting for a decision that was already
  made. The race window is one event wide and it happens in production.
- One pending question per gate activation: re-dispatch after restart must
  find and re-attach to the existing pending record, not mint a duplicate.
- Rejection's blast radius is declared in the graph: rejected gate → fail
  the run, or skip the gated subtree and continue — either is legitimate;
  silence about which is not.
- Cancelling a run with a paused gate withdraws the pending question
  (the decision surface must not offer decisions that no longer connect to
  anything).
- The paused state is first-class in every surface: run views show *what*
  is being waited on, *since when*, and *who can act* — a pause that looks
  like a hang converts patience into support tickets.
