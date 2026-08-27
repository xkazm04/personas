# The memory graph nothing reads — and the storage engine we are not adopting

## Why this exists

Two questions arrived together on 2026-08-27: *is an embedded property-graph
database worth considering for us*, and *what would it be for*. Answering the
second one honestly turned up something we did not know about our own tree, and
that is the more useful half of this document.

**We store typed relations in two places. Neither has a reader on the request
path.** Not a bug — nothing is broken, no query returns a wrong answer. But a
schema is the most persuasive possible argument for a decision nobody actually
made, and this is the write-up that keeps "we designed this" from being
mistaken for "we do this."

## What we have

### Retrieval, as it actually runs

`src-tauri/src/companion/brain/retrieval.rs` bundles four lanes into each
turn's working context:

1. **Keyword (BM25)** over `companion_fts` — ungated, runs in every build
   including the non-ml one that ships. This is the lane that made recall
   depend on the question at all.
2. **Vector (vec0 KNN)** — `ml`-gated, layered on the keyword lane rather than
   replacing it.
3. **Always-include tiers** — top facts and procedurals by importance, active
   goals, open backlog. Query-independent on purpose.
4. A **recency tail**, sized from what the other lanes actually returned.

The knowledge-base path is the second realization: reciprocal-rank fusion over
vector and BM25 in `src-tauri/src/commands/credentials/vector_kb.rs`
(`rrf_rerank`, `RRF_K = 60`), with the distance floor applied to the vector pool
*before* fusion so a lexical hit cannot resurrect a floored item — asserted by
`floor_drops_far_seeded_vectors_and_preserves_rrf_ranking`.

This is a careful implementation and it matches the standard we consume, lane
for lane. That is what makes the next part evidence rather than an oversight.

### The two relation stores

**`companion_edge`** (`src-tauri/db/src/lib.rs`). Primary key over
`(source_id, target_id, rel)`, plus `idx_companion_edge_target` on
`(target_id, rel)` — a **reverse** index, the shape you build to walk inbound
edges. The relation vocabulary is fixed in
`src-tauri/src/companion/brain/graph.rs`:
`supports | contradicts | replaces | derives_from | about | blocks`.

That module is eight lines. It declares the markdown `links:` frontmatter the
source of truth and the SQL table "a reindex-able cache for fast traversal",
and it ends:

> `Phase 0: stub. Phase 2: traverse, add_edge, contradict_scan.`

It exports no functions. The table has no writer and no reader in the tree
beyond an entry in the data-portability table list. **Phase 2 did not arrive.**

**`memory_edges`** (dev-memory ledger). This one is live: written by
`memory_ledger.rs`, read by the portability exporter and importer, and read by
the ledger's own markdown render, which joins edges to nodes to emit wikilinks
into the vault. Every one of those readers is an exporter, an importer, or a
rendered link view. `memory_recall.rs` does not mention edges, and there is no
recursive traversal anywhere in the tree.

So: one relation store designed down to the verbs and never built, one
maintained continuously and never queried by the machine that would benefit.

## The assessment: do not adopt, and the reason is not performance

LatticeDB is an embedded single-file property-graph engine (Zig, row-oriented)
with native HNSW vector search, BM25 full-text, durable change streams and one
Cypher dialect over all of it. It is aimed almost exactly at what we assemble
by hand. It is also, per its own documentation, structurally weak on analytical
queries that touch most of the graph — it calls that a property of row
orientation, not a tuning problem — and new enough that its docs say so
plainly, alongside a Cypher subset that lacks `OPTIONAL MATCH`.

We are declining it, for a reason that has nothing to do with its speed:

**We do not have the workload yet.** We have the *data* — typed relations, a
relation vocabulary, a reverse index — and no query on the request path that
traverses any of it. Buying an engine to make a traversal fast when no
traversal exists prices a decision we have not made. The cheap move is the
opposite order: find out whether traversal improves recall at all, in the store
we already run, and only then ask what it should run on.

Two more facts worth recording:

- Our relation volumes are small and live in the same embedded file as
  everything else, which is where this scale belongs. A dedicated relation
  store is not the missing piece.
- Kùzu — the previous reference implementation of this engine class — was
  acquired and archived in October 2025. The live community fork is
  **LadybugDB**, which is columnar and heading toward a lakehouse shape. If we
  ever do want a graph engine, that is a second candidate with the opposite
  storage layout, and the two would need measuring against each other rather
  than either against us.

## The interesting part: `contradicts`

Our four lanes are two similarity matchers, a clock, and a pin. **None of them
can surface an item that disagrees with the top hit.** Similarity is the wrong
instrument for finding an objection — the disputing fact is not lexically or
semantically near the claim it disputes, and may be its opposite.

We named that relation. Somebody chose `contradicts` and `replaces`, built the
reverse index, and wrote down `contradict_scan` as a function to come. Then the
roster we implement had no seat for what it would return, and the work had
nowhere to land.

We already model dispute in recall from the other direction: `decay_score` in
`memory_recall.rs` applies a `dispute_penalty` of `1 − 0.35·tanh(open_claims/2)`,
so a memory with open `wrong`/`outdated` claims sinks and ages out faster. That
is the *count* of disputes suppressing an item. It is not the same as putting
the disputing item in front of the reader, and the second is what a traversal
lane would do.

## Action plan

Ordered by cost. Nothing below requires a new engine, and steps 1–2 are the
whole of what should happen next.

1. **Decide `companion_edge`'s status explicitly.** It is currently a table, an
   index and a stub with no writer. Either (a) start writing it from the
   markdown `links:` frontmatter it already declares as source of truth — cheap,
   since the reindex path is the documented design — or (b) mark the module
   and the schema as deferred with a dated note. Silently keeping an unwritten
   table is the one option that should not survive this document.
2. **Run the cheapest possible test of whether traversal helps recall.** Only
   if step 1 goes to (a). Seed from the lanes we already have, expand **one
   hop** over `contradicts` and `replaces` only, and add the neighbours as a
   tier *beneath* their seed — never fused as a peer. Evaluate on a labeled
   query set. If it does not move a metric, keep the relations as a record,
   write that down here, and stop.
   - **Fuse it as a tier, not a peer, and this is not a style preference.**
     A neighbour surfaced *because* its seed ranked is not independent
     evidence, so summing both contributions into RRF counts one signal twice
     — hardest exactly where the seeding lane was most confident. The visible
     symptom would not be an error; it would be a slice that quietly becomes a
     depth-first tour of one region while the query's other senses vanish.
     Diversity cuts would pass it, because the items genuinely differ.
   - **Re-impose scope after the traversal, on the neighbour's own row.** An
     edge is a pointer written under one scope and followed under another.
     Trusting that the seed was in scope is how a slice acquires an item the
     consumer was never entitled to see.
   - **Ask for the reachable set, not the paths.** Set expansion dedups at each
     level; path enumeration multiplies by degree at each level. We want the
     first.
3. **Do not install anything.** No engine enters the tree for an evaluation.
   If we ever do benchmark one, it goes in an isolated manifest with its own
   lockfile, outside the product dependency tree and CI, so that "we measured
   it and did not adopt it" stays checkable from the outside.
4. **Return conditions for re-opening the engine question.** Any of: a
   user-facing query that must constrain on vector distance *and* text
   relevance *and* traversal at once (the one shape our three-part assembly
   serves worst); relation volumes growing by orders of magnitude with a
   *sparse* topology and deep path queries; or step 2 succeeding well enough
   that traversal moves onto the hot path.

## What this document does not claim

- **That the lane would help.** No traversal runs today, so there is no
  evidence here beyond "the corpus could support it and the roster had no seat
  for it." Step 2 exists to produce that evidence or to close the question.
- **That the stub is dead code.** Eight lines recording a design and the
  vocabulary it chose are cheaper to keep than to reconstruct. Deleting it
  would destroy the only written trace of a decision, which is the opposite of
  what this document is for.
- **That the two memory systems are interchangeable.** The companion brain and
  the dev-memory ledger have different owners, scopes and lifecycles. A lane
  built for one does not transfer without re-deriving the scope predicate.
