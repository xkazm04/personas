---
layer: technique
subject: agent-memory
technique: consolidation
status: forged
laws: [derivation-names-recomputation, one-validation-door]
shared_with: []
---

# Consolidation

Consolidation is the judgment pass that turns records into knowledge: it reads
recent episodes and distills them into durable items — facts, preferences,
procedures — each with a confidence, a scope, and a provenance trail back to
the episodes that ground it. It is the only stage in the pipeline where
"happened" becomes "believed", which makes it the stage where all the trust
decisions concentrate. Everything upstream may be generous; this pass is
strict.

## Batched, because judgment needs a horizon

Consolidation runs as a **periodic batch over a window of episodes** — a
sleep cycle — rather than inline at the moment each episode is written. This
is not a throughput optimization; it is what makes the judgment good:

- **Patterns are cross-episode.** "The operator prefers terse reports" is
  visible across five episodes and invisible in any one of them. Inline
  consolidation can only ever extract what a single event proves, which is
  almost nothing worth believing durably.
- **Significance needs hindsight.** At capture time, importance is a guess;
  a day later, the episode that led nowhere is obvious. Batch judgment gets
  to be strict precisely because capture was generous.
- **Deduplication needs the batch.** Ten episodes expressing one fact should
  strengthen one belief, not mint ten. Seen one at a time, each looks new.
- **In-flight heat is a bias.** The moment something feels most important is
  the moment its durability is least assessable. The batch boundary is a
  cooling-off period built into the architecture.

The trigger is **accumulated input, not the clock**. What a pass costs — and
what makes it worth running — is the volume of unconsolidated material, so
the honest trigger is pressure: enough new episodes since the last completed
pass. The clock survives only as a floor (a burst must not cycle twice in an
hour) and as a staleness release (a quiet week still gets compressed
eventually); neither is the trigger. A pure timer runs expensive passes over
empty windows on quiet days and lets heavy days overflow the window on busy
ones.

Three mechanical disciplines keep the batch honest:

- **One boundary, one read.** The measurement that admits a pass and the
  window the pass consumes are the *same* read, not two queries that agree
  today. Two measurements of "what is new since the last pass" will drift,
  and the drift is invisible until material is skipped.
- **Drain forward.** When input caps truncate a heavy window, the pass
  consumes oldest-first and records the exact boundary of what it actually
  read; the residue becomes the *next* pass's oldest material. Taking the
  newest slice of an over-long window silently orphans the middle — material
  no pass will ever reach.
- **Resumable and idempotent over the window.** A crashed pass re-run must
  not double-strengthen beliefs or re-mint items it already produced.

## The outputs are typed

A consolidated item is not free text; it is one of a small closed set of
kinds, because the kinds have different lifecycles:

- **Facts** — claims about the world, the operator, or the agent's
  situation. Have truth values, go stale, get superseded.
- **Preferences** — standing dispositions of the human or the collaboration
  ("wants risks surfaced early"). Softer than facts; strengthen and fade
  with evidence rather than flipping true/false.
- **Procedures** — how-to knowledge distilled from episodes of doing
  ("renewing the credential requires the second approval step"). Validated
  by working, invalidated by failing, and dated by the systems they touch.

Each item carries: the claim at its right altitude (scoped, dated where time
matters), a **confidence** the distiller assigned, and **provenance** — the
episode ids it derives from. The provenance row is not metadata garnish; it
is the [derivation-names-recomputation](../../_laws.md#derivation-names-recomputation)
law applied to belief: a consolidated item is a stored derivation, and the
episodes-plus-pass that produced it are its named recomputation path. A
belief whose grounds cannot be enumerated cannot be audited, re-derived, or
safely forgotten — it can only be taken on faith or deleted.

## Supersedence: contradiction is data

New evidence that conflicts with an existing belief is the most valuable
input consolidation receives, and the one it must never handle by overwrite.
The discipline:

- **Supersede, don't replace.** The new item is written, the old one is
  marked superseded *by* it, and the link is kept. Recall serves the
  successor; audit can still see the lineage. An overwritten belief leaves
  a system that was never wrong, which is a system that cannot be trusted
  about anything.
- **Contradiction lowers confidence before it flips conclusions.** One
  conflicting episode against a many-times-reinforced belief is a reason to
  doubt, not yet a reason to reverse. Weight of evidence decides; recency
  is a tiebreaker, not a trump.
- **Except when the source is the human.** An explicit operator correction
  supersedes immediately regardless of the standing belief's weight — it is
  the highest evidence grade the system knows, and the superseding item's
  provenance says so.
- **The distiller's own output is untrusted input.** When the judgment is
  performed by a fallible reasoner (and it always is), every reference it
  emits — the grounds it cites, the item it claims to supersede — is
  validated against the store before anything acts on it: the cited
  episodes must exist, and the supersede target must be a live item of the
  right kind and scope. A hallucinated reference *drops the candidate*; it
  must never demote an arbitrary belief the distiller happened to name.
  Without this check, the review gate guards the front door while the
  proposal's side effects walk through the back.
- **Reinforcement is the mirror case.** Evidence agreeing with an existing
  belief strengthens it (confidence, freshness) rather than minting a
  duplicate. Duplicated beliefs drift independently — the classic
  two-copies race, one adjudication away from contradicting themselves.

## One door, enumerable writers

The consolidated store has **one validation door** — the consolidation pass
itself — and every path that creates a belief goes through it, per
[one-validation-door](../../_laws.md#one-validation-door). The pressure to
add a second door is constant and always locally reasonable: a direct write
from working memory ("we just learned this, why wait for the cycle"), an
import from another system, a bulk seed at setup time. Each bypass creates
beliefs that skipped the judgment — no dedup against existing items, no
supersedence check, no distiller-assigned confidence — and the store now
holds two grades of belief that look identical at recall time, which is the
worst version of the problem because nothing marks the weaker grade.

The imports and seeds are legitimate needs; the answer is to route them
through the door — as synthetic episodes the pass consolidates, or through
the same validation the pass applies — never around it. Writers to the
belief store should be enumerable on one hand, and the enumeration is worth
keeping literally true.

## What consolidation refuses

The strictness has a shape. The pass declines to mint: claims at transcript
altitude ("the operator said X" — extract the fact or leave it as episode);
one-off circumstances with no forward relevance; anything whose sensitivity
screening should have excluded it upstream (a second screen here is cheap
insurance); and items about the agent's own identity or standing rules,
which are *proposed*, never committed — that lane belongs to
[memory-governance](memory-governance.md).
