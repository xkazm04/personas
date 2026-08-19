---
layer: technique
subject: retrieval
technique: relevance-floors
status: forged
laws: [failure-not-empty-success, gate-sees-target]
shared_with: []
---

# Relevance floors

Nearest-neighbor retrieval answers a different question than the one asked.
Asked "what is relevant?", it answers "what is *nearest*?" — and nearest is
defined even when nothing is close. Point it at a corpus of cooking notes,
query it about compiler internals, and it returns k results, ranked,
confident, useless. Lexical lanes fail more honestly (no term overlap, no
results) but have their own version: one incidental term match dressing an
irrelevant document as an answer. The floor is the stage that converts
"nearest" back into "relevant": a threshold below which the honest output is
fewer results, or none.

## Least-bad k is a lie with compounding interest

Returning the best k available regardless of quality feels harmless — the
consumer can judge, surely. But presence in the slice **is** the judgment;
that is what retrieval is for. A human reads the top result as "the system's
best answer", not "the system's nearest miss". An agent packing context
treats every injected chunk as evidence and reasons on it — irrelevant
recall does not merely waste budget, it actively steers generation wrong,
and the error compounds downstream where its origin is no longer visible.
An empty slice, by contrast, tells the exact truth: *the corpus does not
speak to this query*. Systems that never return empty have chosen to never
say that — which means every slice they return carries less information.

## Floors are per-lane, per-model, and calibrated

A floor is a threshold in a lane's own score space, and score spaces don't
transfer:

- **Per-lane** — a vector-distance cutoff says nothing about lexical scores;
  each lane thresholds in its own units, *before* fusion (a fused blend of
  one strong signal and one garbage signal launders the garbage).
- **Per-model** — distance distributions are a property of the embedding
  geometry. Swap the embedder and yesterday's floor is silently too strict
  or too loose; the floor is calibration state owed a revisit on every model
  change, one more entry in the
  [embedding-lifecycle](embedding-lifecycle.md) reindex checklist.
- **Calibrated, not felt** — set floors from a labeled query set (the
  [retrieval-evaluation](retrieval-evaluation.md) machinery): the operating
  point where relevant results overwhelmingly pass and irrelevant ones
  overwhelmingly don't, chosen for the consumer's cost asymmetry. A
  context-packing consumer tolerates a false empty far better than injected
  noise (floor high); an exploring human tolerates weak candidates better
  than a dead end (floor low, weak tail labeled). One knob, two different
  right answers.

A useful refinement between hard-pass and hard-fail: a **gray band**. Results
above the confident floor pass; results in the band pass only with degraded
standing ("weak match" — provenance the consumer can discount); results below
fail. This keeps the honesty of the floor without the brittleness of a
single cliff.

## Empty has three spellings

The zero-and-low-result regime is where retrieval tells the truth or doesn't,
and the [failure-not-empty-success](../../_laws.md#failure-not-empty-success)
law names the discipline. Three outcomes that must not share a spelling:

- **Honest empty** — every lane ran, nothing cleared its floor. The correct
  answer is nothing, delivered as nothing, distinguishable from error.
- **Degraded slice** — a lane could not run (embedder absent, index
  rebuilding) and the others carried the query. Real results, weaker
  warrant: the slice must say which lanes it came from, or the consumer
  prices lexical-only output as full-hybrid output. This is the labeled
  fallback mode [embedding-lifecycle](embedding-lifecycle.md) requires when
  the embedder is missing — a fallback lane is a *substitute answering
  path*, and an unlabeled substitute is an impersonation.
- **Failure** — the engine itself errored. Never presentable as an empty:
  "nothing matched" invites the consumer to conclude the corpus lacks the
  answer, which is precisely the wrong lesson when the truth is "nothing
  was searched".

The gate that distinguishes them must see its target, per
[gate-sees-target](../../_laws.md#gate-sees-target): the degraded-mode label
derives from *which lanes actually executed on this query*, not from a config
flag saying which lanes are enabled. A flag-derived label passes exactly when
a lane silently failed — the case the label exists for.

## The floor is a contract, not a courtesy

Downstream stages are entitled to assume flooring happened: fusion assumes
per-lane candidates are genuine, [budgets](ranking-budgets.md) assume every
admitted item earned admission, consumers assume presence means relevance.
That makes the floor part of each lane's output contract — enforced where
the lane emits candidates, at one door, not re-checked defensively at every
stage after. A system where downstream stages each re-floor "just in case"
has admitted it doesn't know where the contract lives.
