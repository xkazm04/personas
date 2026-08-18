---
layer: technique
subject: prompt-assembly
technique: continuation-prompts
status: forged
laws: [identity-survives-reuse]
shared_with: []
---

# Continuation prompts

Work gets interrupted — by a crash, a budget ceiling, an operator pause, a
model limit — and the run must pick up where it stopped. The continuation
prompt is the assembly problem in its hardest configuration: the model that
resumes may have none of the interrupted model's attention state, so
everything the resumed run needs must be *reconstructed into text*, under
the same budget as any other prompt, without replaying the past wholesale
or pretending the interruption did not happen.

## Two regimes: the session survived, or it did not

The first question decides the whole shape of the continuation: **does the
conversation state still exist on the other side?**

- **Preserved session** — the platform can reattach to the prior
  conversation, so the model still holds everything it was told. Re-sending
  the standing layers is pure waste; the continuation is a *delta prompt*:
  the new input, plus re-derivations of the volatile ground (the credential
  hints, the capability roster — which may have shifted while the run was
  down), plus at most compact reminders of material the session already
  carries. Small, cheap, and correct — *if* the staleness check below
  passes; a preserved session is exactly where the stale-fingerprint
  failure lives.
- **Lost session** — crash, expiry, migration to another worker. Nothing
  carries over by itself; the continuation must reconstruct the run into
  text: a distilled digest of what was decided and done, assembled under
  the full standing-layer stack as if the run were new. Everything below is
  about doing that reconstruction honestly.

Systems need both regimes, and the delta prompt must never be sent into a
lost or stale session — "continue the previous work" addressed to a model
that has no previous work is an instruction to confabulate one.

## The resumed run is the same run

Identity comes first, per
[identity-survives-reuse](../../_laws.md#identity-survives-reuse): the
continuation carries the original run's identity — its id, its goal as
originally stated, its budget already consumed, its progress markers — so
that everything downstream (logs, artifacts, dedup, attribution) treats
pre- and post-interruption work as one run. A resume that mints a fresh
identity forks the record: two runs now claim overlapping work, counters
double, and the artifact trail can no longer answer what a single task
actually cost. Restart is precisely one of the operations identity must
survive; the continuation prompt is where that survival is either
implemented or lost.

## Carry over the decided; re-derive the observable

The central design question is what crosses the interruption boundary as
text versus what the resumed run looks up fresh. The split follows one
rule: **carry what cannot be recomputed, re-derive what can.**

Carried — because they exist only in the interrupted run's history:

- the task and its constraints as originally given, plus any mid-run
  amendments the operator made;
- **decisions and their reasons** — approaches chosen, options rejected
  and why; without the why, the resumed model relitigates settled
  questions and sometimes settles them differently;
- **work completed, as facts** — what was produced, where it landed,
  which steps are done;
- open threads: what was in flight, what was next, known blockers.

Re-derived — because the world may have moved while the run was down:

- live state: the current contents of anything the run mutates or reads;
- the capability roster and configuration (via a fresh assembly, which
  also re-stamps the fingerprint);
- fresh context-layer recall — memory is re-queried for the resumed task,
  not carried as a frozen snapshot of what recall returned last time.

Carrying an observable is the subtle failure: a snapshot of live state
rides in as text, the world has since moved, and the model now trusts a
stale observation over the fresh look it would otherwise have taken.

## Distill the past; never replay it

The continuation context is a **synthesis** — a bounded digest of the
carried material, at claim altitude ("chose approach A over B because…",
"steps 1–3 complete") — not the transcript. Replaying raw history fails
twice: it spends the budget linearly in run length, guaranteeing long runs
cannot resume; and it hands the model utterances instead of conclusions,
re-running every drift and dead end at full attention. This is the same
altitude judgment [agent-memory](../../agent-memory/agent-memory.md) makes
between transcripts and memory — the interrupted run's log is *evidence*
for the resume digest, not the digest. Where the run maintained working
state on purpose, the digest is largely already written; synthesizing it
at interruption time (or continuously) beats reconstructing it forensically
from the log after a crash.

Completed side effects get stated bluntly, as idempotence armor: the model
told "the notification was already sent; do not resend" is protected from
re-executing what already happened — the continuation's cheapest and most
valuable lines.

## Check the ground before standing on it

An interruption of any length admits drift, so resume begins with
staleness checks, and their results *enter the prompt* rather than gating
silently: the fingerprint comparison (configuration or capabilities moved
→ rebuild standing layers; note material changes to the model), and
verification of carried facts' anchors (an artifact claimed as produced
should still exist; if it does not, the continuation says so instead of
asserting it). A continuation that pretends seamlessness across a changed
world converts every drifted fact into a confident false belief.

Not every interruption deserves equal trust in its record. A clean pause
wrote its digest deliberately; a crash left whatever survived. The
continuation names the interruption kind, and after a crash it grades
carried claims accordingly — verify before trusting, prefer re-deriving
anything cheap — because the digest itself may be mid-write wrong.
