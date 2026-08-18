---
layer: technique
subject: hitl-approval
technique: gate-state-machines
status: forged
laws: [gate-sees-target, identity-survives-reuse, one-validation-door, failure-not-empty-success]
shared_with: []
---

# Gate state machines

A gate is real when it is a **state machine on durable storage** whose
transitions are enumerated, whose approval transitions only a human-
authenticated path can drive, and whose executor refuses to act on anything
but the recorded state. Everything else — a flag in a prompt, a convention in
an instruction file, a promise in the machine's own output — is a request to
be gated, honored exactly until the first time it matters
([gate-sees-target](../../_laws.md#gate-sees-target)).

## The state set

The minimal honest gate has four states; most real gates need exactly these:

| State | Meaning |
| --- | --- |
| **closed** | the gated step is not yet reachable — prerequisites unmet, or nothing pending |
| **pending** | the machine has arrived at the boundary and asked; a durable question exists |
| **open** | a human verdict authorized the step; the continuation may proceed once |
| **rejected** | a human verdict refused the step; cleanup semantics apply |

Two structural rules govern the set:

1. **Every state is written down.** The current state lives in the system of
   record, keyed to the gated entity's identity — never inferred from the
   presence of a work product, the absence of an error, or the machine's
   account of where it is. Inference-based gate state is how "it produced
   output, so it must have been approved" enters a codebase.
2. **Pending survives restart.** The question is a row, not a blocked thread.
   A process crash, deploy, or reboot while pending must resume as pending —
   the human's answer arrives on human time, and the system's uptime between
   question and answer is not part of the contract.

## Transitions are the security boundary

Enumerate the transitions and who may drive each:

- `closed → pending` — the *machine*, on reaching the trigger predicate. This
  is the one transition the gated party drives, and it only ever makes the
  gate more closed, never less.
- `pending → open` and `pending → rejected` — the *human decision path only*.
  The write is authenticated as the decision surface acting for a person, and
  it carries the verdict record. No output of the gated process — no message,
  no tool call, no self-report — can produce this write. If the machine can
  emit anything that flips its own gate open, the gate is a formality wearing
  a state machine's clothes.
- `open → consumed/closed` — the *executor*, exactly once, when the approved
  continuation runs. An open gate authorizes one traversal, not a standing
  permission; leaving gates open after use converts an approval into an
  ambient capability.
- Any state `→ closed` on **target change** — see invalidation below.

Illegal transitions are conflicts, not merges. Approve-after-reject,
double-approve, and a verdict landing on an entity whose state already moved
are rejected loudly with the current state returned — last-write-wins on a
gate silently discards a human judgment, which is the exact asset the
mechanism exists to preserve
([failure-not-empty-success](../../_laws.md#failure-not-empty-success)).

## One door for the check

The state machine is only as strong as the executor's discipline in consulting
it, so make consultation structural: **every path that performs the gated
action passes through one checkpoint** that reads the state and refuses
anything but `open`
([one-validation-door](../../_laws.md#one-validation-door)). If three call
sites each remember to check, the fourth — added next quarter, in a hurry —
will not. The checkpoint pattern also makes the exemptions auditable: the
read-only bypass (actions that cannot mutate anything skip the gate by design)
is a documented property of the door, not a scattering of special cases.

## Approval binds to a version

The entity under the gate has identity, and the *content* under review has a
version; the verdict records both
([identity-survives-reuse](../../_laws.md#identity-survives-reuse)). If the
content changes after approval — the draft is edited, the plan regenerated,
the parameters rebound — the gate **re-closes automatically**. This is not
bureaucracy; it is the only defense against the trivial laundering attack
where innocuous content is submitted, approved, and then swapped before
execution. The cheap implementation is a content hash or monotonic revision
captured at `pending` and re-verified at the door; a mismatch at execution
time is a re-closed gate, not a warning.

## Per-phase gates in multi-step work

Long-running work with several consequence boundaries gets a gate *per
boundary*, not one gate at the start. A single up-front approval of a
multi-step plan quietly authorizes every future step against a prediction of
what those steps would be — and predictions drift. Structure it as a ladder:
each phase's gate closes behind the previous phase's completion, arms on
arrival, and holds its own pending state. The ladder also gives rejection a
natural blast radius: refusing phase four does not un-approve phases one
through three, which already ran and are already recorded.

## What the machine may do while pending

Nothing that the gate guards — but "wait silently" is not the only option.
Well-behaved pending states allow:

- **work on unrelated items** — the gate blocks a step, not the worker;
- **preparation without effect** — assembling, validating, and staging the
  gated action so that approval resumes instantly (the staged form is what
  the human reviews, which strengthens the gate);
- **withdrawal** — the machine may retract its own question (`pending →
  closed`) when the plan changes, which is the one further transition the
  gated party may drive, again in the closing direction only.

The asymmetry is the design: the machine may close, ask, and wait; only a
person may open.

## Batch the questions

When several gates on one entity are closed at the same moment, ask about
them **together**, in one deterministic order — not one per round-trip.
Serialized asking is a fatigue generator with no safety payoff: the human
answers question one, waits through a full machine turn, answers question
two, and correctly concludes the mechanism wastes their time. The state
machine makes batching safe — each gate marks pending independently, each
answer flips exactly its own gate — so a batch of questions never blurs into
a batch of approvals. Batching the *asks* is the machine's courtesy; batching
the *verdicts* stays governed by the homogeneity rule on the review surface.
