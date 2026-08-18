---
layer: golden-path
subject: retrieval
status: forged
techniques:
  - chunking-and-indexing
  - embedding-lifecycle
  - hybrid-lane-fusion
  - ranking-budgets
  - relevance-floors
  - retrieval-evaluation
evidence:
  - src-tauri/src/companion/brain/retrieval.rs        # lane fusion: keyword + vector + recency, always-include tiers, shared recall window (budget not quota), overfetch-then-split
  - src-tauri/core/src/retrieval/mod.rs               # shared pure primitives: distance floor (1.30 w/ geometry rationale), model filter, lane ranking, one sanitization door
  - src-tauri/src/companion/brain/embeddings.rs       # embedding-model stamping on every vector + guard on read (counted, warned) + idempotent reindex/backfill
  - src-tauri/src/engine/kb_ingest.rs                 # content-hash idempotent re-ingest: skip unchanged, supersede changed (cascade delete, no orphaned vectors)
  - src-tauri/engine/src/chunker.rs                   # sentence-aware chunking, per-page provenance, extraction confidence, empty-page honesty
  - src-tauri/engine/src/kb_index.rs                  # the browse-not-retrieve complement: auto-maintained navigable index for small corpora
  - src-tauri/src/commands/credentials/vector_kb.rs   # KB search: model/dims guard, floor before RRF fusion, floor_filtered count returned, filter-then-cut
  - src-tauri/db/src/memory_recall.rs                 # decay×similarity blended scoring, character-budget packing (budget in consumer units)
  - src-tauri/db/src/vector_store.rs                  # per-corpus vector index provisioning, KNN query surface, transactional batch writes
counter_evidence: []
deviations:
  - w8-retrieval   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Retrieval & vector search

Retrieval is the machinery that, given a query and a corpus too large to hand
over whole, assembles the **small slice most worth the consumer's attention** —
ranked, deduplicated, and honest about its own confidence. The consumer varies:
a person scanning a results pane (the [search](../search/search.md) subject
owns that surface), an agent whose finite context is being packed
([recall-injection](../agent-memory/techniques/recall-injection.md) consumes
the ranked slice this subject produces), a downstream summarizer or ranker.
The engine underneath is the same, and so are its failure modes.

The boundary matters because the neighboring subjects own the ends of the
pipe: [agent-memory](../agent-memory/agent-memory.md) decides what gets
*stored* and how beliefs consolidate and decay; [search](../search/search.md)
owns the user-facing query grammar and presentation. Retrieval owns everything
between: how the corpus is cut and indexed, which lanes answer a query, how
their incomparable scores fuse into one order, where the honesty thresholds
sit, and how any of it is known to work.

## No single lane suffices

The founding fact of this subject is that the two dominant matching families
fail in *different* places, and each one's blind spot is the other's strength:

- **Lexical matching** (term and token overlap against an inverted index) is
  precise, cheap, explainable — and blind to vocabulary mismatch. The user
  says "sign-in", the document says "authentication", and the strongest
  possible answer scores zero. It also cannot see paraphrase, translation, or
  description-of-a-thing-by-its-effects.
- **Semantic matching** (embedding vectors, nearest-neighbor distance) sees
  through vocabulary to meaning — and is blind exactly where lexical is sharp:
  exact identifiers, error codes, rare proper nouns, negation, and short
  queries whose embedding is mostly noise. It is also unexplainable at the
  single-result level: "cosine distance 0.31" justifies nothing to a reader.

Because the failures are complementary, **hybrid fusion is the default
posture, not the upgrade path**. A system that ships vector-only retrieval has
chosen to fail on every query containing an identifier; a system that ships
lexical-only has chosen to fail on every query phrased in the user's words
instead of the corpus's. Additional lanes earn seats the same way: a recency
lane covers "what just happened", which both matchers systematically
under-rank; a pinned always-include tier covers items whose relevance is
constitutional rather than query-dependent. And a new lane must be a strict
*addition*: run alongside the existing lanes and unioned in, so the richer
configuration is a superset of the leaner one — never a replacement whose own
blind spot silently costs recall the old path had. The craft of combining
them — normalization, deduplication, tiering — is
[hybrid-lane-fusion](techniques/hybrid-lane-fusion.md).

One scale-honesty check before any of this machinery is bought: **below a
certain corpus size, retrieval is the wrong tool entirely.** A few hundred
documents fit in an auto-maintained, human-readable index the consumer can
*browse* — deterministic, explainable, and free of every lifecycle cost this
subject describes. Retrieval earns its complexity when the corpus outgrows
navigation, not before; a system that reaches for embeddings at fifty
documents has bought the mixed-model failure mode for nothing.

## The embedding is a derivation with a lifecycle

A stored vector is not data; it is a **derivation** of four inputs — the
content, the model that embedded it, that model's version, and the
preprocessing applied — and it is valid only while all four are known. Two
vectors are comparable only if they came from the same model; a distance
computed across models is a number-shaped lie, and a corpus with mixed-model
vectors is *silently* broken: every query still returns k results, ordered by
noise, with no error anywhere. This is the subject's most dangerous defect
class precisely because nothing fails.

The discipline that prevents it is lifecycle management, not care: stamp model
identity on every vector at write time, guard every read against the active
model's stamp, and treat a model change as a **reindex event with a named
backfill path** — the
[derivation-names-recomputation](../_laws.md#derivation-names-recomputation)
law applied to geometry. The
full discipline, including dimension changes and what to do while a backfill
is in flight, is [embedding-lifecycle](techniques/embedding-lifecycle.md).

## Budgets, not quotas

The consumer grants retrieval a bounded allocation — rows in a pane, tokens in
a context window. The wrong way to spend it is fixed per-lane quotas ("five
lexical, five vector, three recent"): quotas waste seats when a lane is dry
and starve the best lane when it is rich, and the waste is invisible because
the total always looks full. The right shape is a **shared budget allocated by
relevance across lanes**: each lane overfetches candidates, fusion produces
one honest order, and the budget is cut once, at the end, in the consumer's
own units. Guaranteed minimums exist only for tiers whose value is
non-comparable (the always-include tier), and even those spend from the same
budget. The mechanics — overfetch factors, cross-lane dedup, size-aware
cutting — are [ranking-budgets](techniques/ranking-budgets.md).

## The floor: honest emptiness beats confident irrelevance

Nearest-neighbor retrieval has a property lexical retrieval does not: it
**always returns k results**, no matter how irrelevant, because "nearest" is
defined even in an empty neighborhood. Returning the least-bad k when nothing
is relevant is a lie with a compounding cost — the consumer (human or agent)
treats presence in the slice as evidence of relevance, and downstream
reasoning builds on noise. Every lane therefore carries a **relevance floor**:
a threshold below which the honest answer is fewer results, or none. And an
empty answer must be distinguishable from a broken lane — "nothing qualified"
and "the embedder was unavailable, so only lexical lanes ran" are different
claims the consumer needs told apart. Floors, degraded modes, and the
three-way empty are [relevance-floors](techniques/relevance-floors.md).

## Measured or imaginary

Retrieval quality cannot be assessed by looking at output. Any query returns
*something*; plausible-looking slices are the failure mode, not the exception,
and every tuning knob (chunk size, lane weights, floors, overfetch factors)
changes quality in directions intuition cannot rank. A retrieval system
without a labeled query set and ranking metrics run against the production
path **has an imaginary quality level** — the team knows how it feels, not how
it performs, and every refactor is a coin flip. The evaluation discipline —
labeled sets, metrics with predicates, leak checks between tuning and
measurement, regression gates on quality — is
[retrieval-evaluation](techniques/retrieval-evaluation.md); the surrounding
machinery for running such gates repeatedly belongs to the eval-harness
subject.

## The pipeline: two planes

Everything above arranges into two planes that meet at the index:

**Ingest time** — source → structure-aware chunks → per-chunk identity
(content-addressed, so re-ingest is an idempotent upsert, not a duplicate) →
per-lane index writes (tokens to the inverted index, stamped vectors to the
vector index) → maintenance obligations (deletions reach every index; drift
between source and index is detectable and has a named rebuild). This plane is
[chunking-and-indexing](techniques/chunking-and-indexing.md).

**Query time** — query → per-lane execution with overfetch → per-lane floors →
fusion into one order with cross-lane dedup → budget cut in consumer units →
the slice, each item carrying provenance (which source, which lanes matched,
what standing). Provenance is not decoration: it is what lets the consumer of
the slice justify, verify, or discount each item — the same discipline the
memory subject demands when it labels recalled beliefs before injection.

## The techniques

- [chunking-and-indexing](techniques/chunking-and-indexing.md) — boundaries by
  structure, content-hash identity, idempotent re-ingest, index maintenance
  and drift repair.
- [embedding-lifecycle](techniques/embedding-lifecycle.md) — model stamping,
  read guards, reindex/backfill flows, dimension changes, life without an
  embedder.
- [hybrid-lane-fusion](techniques/hybrid-lane-fusion.md) — lane roster, score
  normalization across incomparable scales, fusion strategies, tiers, dedup.
- [ranking-budgets](techniques/ranking-budgets.md) — shared budget vs per-lane
  quotas, overfetch-then-select, size-aware cuts, diversity.
- [relevance-floors](techniques/relevance-floors.md) — thresholds, honest
  empties, degraded modes, fallback lanes.
- [retrieval-evaluation](techniques/retrieval-evaluation.md) — labeled query
  sets, ranking metrics, leak checks, regression gates.
