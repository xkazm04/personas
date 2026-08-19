---
layer: technique
subject: agent-memory
technique: decay-and-forgetting
status: forged
laws: [creation-names-reaper, deletion-is-not-repair]
shared_with: []
---

# Decay and forgetting

Forgetting is a feature, not a failure. A memory store that only grows makes
its owner *worse* at remembering: recall precision falls as candidates
multiply, stale beliefs crowd fresh ones, and the injection budget is spent
on items whose relevance expired quietly months ago. Decay is how the system
keeps its promise that what it recalls is what matters — and the entire
discipline can be compressed into one sentence: **demote gradually, delete
rarely, and never lose the audit trail silently.**

## Importance is scored, and the score names its inputs

Decay needs an ordering — which items matter least right now — and that
ordering is a computed score whose inputs are explicit:

- **Recency** — of last *use*, not only of creation. A belief recalled and
  acted on yesterday is alive regardless of its age; this is the retrieval
  loop feeding back into retention (see
  [recall-injection](recall-injection.md)).
- **Reinforcement** — how many independent episodes ground it, and whether
  consolidation has strengthened it since.
- **Source grade** — an operator-issued correction outranks an inferred
  pattern at equal age; identity-adjacent items may be exempt from decay
  entirely (their lifecycle belongs to
  [memory-governance](memory-governance.md)).
- **Category weight** — procedures for systems still in use decay slower
  than observations about a finished project; the categories carry
  deliberate half-lives.

Two disciplines keep the score honest. It is a **derivation** — recomputable
from its named inputs, never hand-poked into individual rows, because a
score adjusted by hand is a ranking with an unmarked exception in it. And it
is **relative, not absolute**: its job is to order candidates for demotion
under pressure, not to declare cosmic importance. A threshold like "prune
below 0.3" invites tuning theater; "the category is over cap, demote the
lowest-ranked" states what actually happens.

## Demotion tiers, not a trapdoor

Between "active" and "gone" the store keeps intermediate states, because the
cost of wrongly forgetting is asymmetric with the cost of briefly
over-remembering:

1. **Active** — eligible for recall, spending injection budget.
2. **Dormant** — excluded from default recall, still present, still
   reachable by explicit search; a use while dormant revives it. Most
   "forgetting" is exactly this and nothing more.
3. **Archived** — off the hot store entirely, retained for audit and
   provenance resolution, retrievable with effort.
4. **Deleted** — actually gone. Reserved for redaction (sensitivity that
   escaped the write-time screen) and for archive horizons declared up
   front — not a routine stage that bulk cleanup reaches for.

The tiering is what makes decay safe to automate. An automated pass that
*demotes* aggressively costs little when wrong; an automated pass that
*deletes* aggressively converts a scoring bug into permanent amnesia.

## Decay runs on a path that actually runs

The quietest failure in this technique is a lifecycle pass that exists,
is correct, and never executes — reachable only from a manual control
nobody remembers to press, or from the tail of another process that itself
stopped running. The store then carries stale items reciting themselves as
current for months, while the design documents describe a decay model that
is, measurably, fiction. **Forgetting that only happens when a human
remembers to press a button is not forgetting.**

The fix is structural: hook the sweep to a path that provably runs — the
recall path is ideal, since a system whose memory is being read is a system
whose maintenance matters — throttled to a minimum interval, best-effort so
a sweep failure never blocks the live operation, and idempotent so a re-run
after restart costs one cheap check. And because a pass that silently stops
is the original failure again, the sweep's activity is observable: when it
last ran, what it touched.

Two rollout disciplines complete this:

- **Ship report-only first.** New automated forgetting starts by *computing*
  its candidates and reporting them, demoting nothing, until the operator
  has watched it choose correctly. Crucially, the report is produced by the
  **same selection the enforcement will use** — one definition of the
  criteria, two callers — or "what we said we would forget" and "what we
  forget" drift apart the first time the policy is tuned.
- **Demotion has one implementation.** Every path that retires an item —
  supersedence, cap enforcement, decay floor — goes through the same
  operation. A second hand-written spelling of "demote" is a second
  forgetting semantics, and a memory model cannot afford two of those.

## Caps are per category, declared at creation

Every class of memory declares its bound when the class is introduced — so
growth has a named reaper from day one, per
[creation-names-reaper](../../_laws.md#creation-names-reaper), instead of a
panic purge scheduled implicitly for the day the store gets slow. Caps are
per category, not global: one global cap means the chattiest category evicts
everything else, and observation volume starves procedure retention. When a
category exceeds its cap, the lowest-importance members demote one tier —
the caps drive the demotion machinery; nothing jumps to deletion because a
counter crossed a line.

## Forgetting never orphans provenance

The structural rule that separates principled decay from data loss: **the
provenance graph stays resolvable, or its breakage is explicit.** Beliefs
cite episodes; supersedence chains cite beliefs. Pruning that severs those
links silently converts grounded knowledge into confabulation — the belief
still asserts, but "why do you believe this?" now dead-ends.

Concretely:

- An episode cited by an active or dormant belief is not deleted; it
  archives, and the citation follows it there.
- Deleting a belief that others supersede or derive from keeps a
  **tombstone** — id, kind, when and why removed — so chains terminate at a
  marked stump, never at a dangling pointer. Audit can tell "forgotten on
  purpose" from "lost".
- Redaction is the hard case, since its whole point is content destruction:
  the content goes, the tombstone stays, and dependent beliefs are
  re-judged — demoted or re-grounded — in the same pass, not left standing
  on evidence that no longer exists.

## Decay removes the stale, not the wrong

A belief discovered to be *false* is not a decay case. Letting refuted
beliefs fade on the importance curve leaves them recallable — asserting
confidently — for their whole remaining half-life. Wrongness is handled by
**supersedence** at the consolidation layer, immediately, with the
contradiction preserved as lineage. Decay handles the other axis: things
that were true and simply stopped mattering.

The same boundary seen from the other side is
[deletion-is-not-repair](../../_laws.md#deletion-is-not-repair): when memory
misbehaves — recall surfacing garbage, beliefs contradicting themselves —
the repair is at the layer that failed (scoring, consolidation judgment,
capture screening), not a purge of the artifacts that made the failure
visible. A store that gets emptied every time it embarrasses its owner
converges on an agent with no past, which is the failure the whole subject
exists to prevent.
