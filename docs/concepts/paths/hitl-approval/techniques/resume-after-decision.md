---
layer: technique
subject: hitl-approval
technique: resume-after-decision
status: forged
laws: [identity-survives-reuse, creation-names-reaper, failure-not-empty-success]
shared_with: []
---

# Resume after decision

The pause is half the gate; the continuation is the other half, and it is the
half that decides whether the mechanism survives contact with its users. A
gate that pauses cleanly but resumes badly — losing work, re-doing work,
executing something other than what was approved, or leaving rejected work
rotting in place — teaches operators that gates are where work goes to die,
and operators respond by widening unattended grants until nothing pauses.
The resume path is therefore designed *with* the gate, not discovered after
it.

## The pause must contain everything the resume needs

Decisions arrive on human time — minutes, days, sometimes never. The paused
work is a **durable, self-sufficient record**: the staged action or produced
content, its bound parameters, its position in any larger plan, and the
identity that ties it to the verdict
([identity-survives-reuse](../../_laws.md#identity-survives-reuse)). Nothing
about the resume may depend on the process that asked still being alive, on
in-memory state, or on a conversation context that has since been evicted. A
system that can only resume if the original worker survived the wait has a
gate that works in demos and loses work in production, because production is
where the deploy happens between ask and answer.

The strongest form stages the exact artifact: what the human reviewed is the
staged thing, and what runs on approval is *that thing*, byte for byte. This
closes the most subtle resume defect — **re-generation after approval** —
where the machine, having won a yes, re-derives the action "the same way" and
executes the re-derivation. Whatever runs that was not what was shown is
unapproved by definition, however similar; a nondeterministic producer makes
"similar" a gamble precisely where the stakes justified a gate.

## Approve → one deterministic continuation

On approval, the continuation:

- **runs the staged action exactly once** — the open gate authorizes one
  traversal, and the resume is idempotent against double-delivery of the
  verdict: a duplicate of the *same* verdict (double-click, retry, two
  windows) finds the work already done and reports success, while a
  *conflicting* verdict arriving late is a loud conflict — the two cases must
  not share a code path, because one is the human's decision echoing and the
  other is the human's decision being overwritten;
- **re-validates the world before acting.** The verdict pinned the *content*;
  it could not pin the *world*, which kept moving while the human slept. The
  resume checks that preconditions still hold — the target exists, the
  budget window still covers the spend, the grant or credential is still
  live. A stale-world resume asks again or fails loudly; it never shrugs and
  fires;
- **reports completion back to the decision trail**, so the record chain
  ends in "executed at T" rather than trailing off at "approved". An
  approval whose execution failed must be visibly distinct from one that
  succeeded ([failure-not-empty-success](../../_laws.md#failure-not-empty-success))
  — the human believes they made something happen, and the system owes them
  the truth about whether it did.

When the gated step sits inside a multi-step plan, approval resumes *the
plan*, from the boundary, with prior phases' results intact. Re-running
completed phases because the resume path only knew how to start from the top
is the "loses work" defect wearing process clothes.

## Reject → cleanup, not abandonment

Rejection is not the absence of approval; it is an instruction with its own
semantics. The rejected path:

- **disposes of the staged work** — archived for the record or deleted per
  policy, but removed from every "pending" and "in progress" view. A
  rejected item that continues to look in-flight is a zombie: it blocks
  dependents, pollutes counts, and eventually someone "fixes" it by
  approving it;
- **releases what the pause held** — reservations, locks, budget holds,
  queue slots. Held resources are created state whose reaper is the verdict
  ([creation-names-reaper](../../_laws.md#creation-names-reaper)); a
  rejection that releases nothing turns every "no" into a slow leak;
- **notifies the dependents.** Work waiting on the gated step learns the
  step is not coming — and fails, reroutes, or re-plans explicitly — rather
  than waiting forever on a verdict that already happened;
- **carries the reason forward** to whatever re-attempts. A machine that
  retries a rejected action without incorporating the rejection reason is
  re-asking the same question with a fresh coat of paint, and the queue
  should treat it as such.

**Edit-then-approve** is the third verdict and the most valuable: the human
corrects the staged content and approves the correction. The record binds to
the edited version, the continuation runs the edited version, and the diff
between proposed and approved is the highest-grade feedback the producing
machine will ever receive. Supporting it well — edit in the decision surface,
re-fingerprint, approve atomically — removes the fatigue-generating detour
where a nearly-right item must be rejected outright and regenerated from
scratch.

## Timeout → the safe verdict, visibly

Expiry resolves the gate to deny-or-hold, never proceed, and the resolution
is a recorded outcome ("expired unanswered"), not a silent disappearance.
The cleanup obligations are rejection's: dispose, release, notify. What
expiry adds is the *renewal question* — expired items that keep being
renewed and eventually approved are evidence the timeout is shorter than the
operator's real cadence, and the fix is the timeout, not faster humans.
