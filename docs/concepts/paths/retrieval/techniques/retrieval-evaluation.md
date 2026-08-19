---
layer: technique
subject: retrieval
technique: retrieval-evaluation
status: forged
laws: [gate-sees-target, count-carries-predicate, failure-not-empty-success]
shared_with: []
---

# Retrieval evaluation

Retrieval is uniquely resistant to eyeball QA: every query returns a
plausible-looking slice, quality lives in the *ordering* and in *what was
missed* — and what was missed is invisible by definition. Meanwhile the
system is all knobs: chunk sizing, lane weights, fusion strategy, floors,
overfetch factors, the embedder itself. Each knob changes quality in
directions intuition cannot rank, so an unmeasured retrieval system doesn't
have unknown quality — it has *imaginary* quality, and every change to it is
a coin flip the team has agreed not to watch land. This technique owns the
measurement; the machinery for running gated evaluations repeatedly and
tracking them over time is the eval-harness subject's, and retrieval should
ride that machinery rather than grow a private copy.

## The labeled set: small, curated, versioned

The instrument is a set of **(query → relevant items)** judgments. What makes
it trustworthy is not size but construction:

- **Queries from the real distribution** — drawn from what consumers actually
  ask (logs, transcripts), not from what the corpus makes easy to ask. The
  gap between "queries the corpus phrases well" and "queries users phrase" is
  exactly the gap hybrid retrieval exists to close; sample only the former
  and the eval cannot see the semantic lane's contribution at all.
- **Deliberate strata** — identifier-shaped queries, paraphrase queries,
  recency-dependent queries, and queries whose correct answer is *nothing*.
  The strata map one-to-one onto lane failure modes, which is what lets a
  regression be attributed rather than merely detected. The should-be-empty
  stratum is the only thing that measures
  [floors](relevance-floors.md) — without it, the eval structurally rewards
  never returning empty, per
  [failure-not-empty-success](../../_laws.md#failure-not-empty-success).
- **Judgments recorded against durable identity, versioned with the corpus
  snapshot they were made over.** Relevance judgments are claims about a
  corpus state; corpus drift silently invalidates them, and a decaying gold
  set fails in the worst direction — it keeps producing numbers.

Tens of well-chosen queries beat thousands of scraped ones; the set earns
extension whenever a live retrieval failure is diagnosed — every incident
becomes a permanent regression case.

## Metrics carry their predicate

Each metric answers one narrow question; the discipline of
[count-carries-predicate](../../_laws.md#count-carries-predicate) is what
keeps them from being reused for claims they don't support:

- **Recall at k** — of the known-relevant items, what fraction appeared in
  the top k? The headline for context-packing consumers, where k is the
  budget and a miss is unrecoverable.
- **Rank of first relevant** (reciprocal rank, averaged) — how far down is
  the first good answer? The headline for human consumers who scan from the
  top.
- **Graded, position-discounted gain** — when relevance isn't binary, credit
  results by grade, discounted by depth. The most informative and the most
  expensive to label; earn it after the binary metrics are routine.

A reported number binds the whole predicate: metric, k, gold-set version,
corpus snapshot, configuration under test. "Recall@10 = 0.83" floating free
of those is a rumor with decimals. And singleton comparisons on a small set
are noise — a two-point move on forty queries is a handful of items, worth a
look at *which* queries moved before it is worth a conclusion.

## Leak checks: the eval must not have tuned the system

The eval's authority rests on independence, and retrieval erodes it in two
specific ways:

- **Tuning leak.** Floors, lane weights, and overfetch factors get calibrated
  — correctly — against labeled data. Calibrate them on the *same* queries
  the eval scores, and the score measures memorization: the configuration
  has quietly overfit the instrument that judges it. Split the set (tuning
  vs held-out) and let no knob ever see the held-out half.
- **Corpus leak.** If eval queries were derived from specific corpus items
  (the easy way to generate them), verbatim overlap between query text and
  target text turns a semantic-retrieval eval into a string-matching eval —
  scores dazzle while paraphrase performance goes unmeasured. Check for the
  overlap; rewrite offending queries in vocabulary the target doesn't use.

## The eval exercises the production path

Per [gate-sees-target](../../_laws.md#gate-sees-target): the eval must call
the same retrieval entry point production calls — real chunking, real
indexes, real stamps and guards, real fusion, real floors, real budget cut.
An offline replica ("same algorithm" reimplemented beside the system) scores
the replica; it passes exactly when the replica diverges from the shipped
path, which is the divergence the eval existed to catch. Where the replica is
unavoidable, its scores are labeled as the proxy they are.

Two standing gates make the measurement structural rather than occasional:
**quality regression** — changes to any retrieval knob run the eval, and a
drop beyond the gold set's known noise floor blocks until explained (a
deliberate trade is recorded, not waved through); and **lane ablation** —
each lane off, periodically, proving every lane still earns its seat and the
[fusion](hybrid-lane-fusion.md) beats its best single lane. A hybrid that
ablation can't distinguish from lexical-only is paying the embedding
lifecycle's whole cost for nothing — and only this measurement will ever
say so.
