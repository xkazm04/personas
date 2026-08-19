---
layer: technique
subject: retrieval
technique: chunking-and-indexing
status: forged
laws: [identity-survives-reuse, derivation-names-recomputation, creation-names-reaper]
shared_with: []
---

# Chunking and indexing

The ingest plane decides, before any query exists, what the retrievable units
of the corpus *are*. Every downstream stage inherits those decisions: fusion
ranks chunks, floors threshold chunks, budgets are spent on chunks, and the
consumer reads chunks. A retrieval system cannot out-rank a bad chunking — if
the unit boundaries split every answer in half, no fusion strategy reassembles
them.

## Boundaries follow structure, not arithmetic

The naive cut — fixed-size windows every N units — is indifferent to meaning
by construction: it splits sentences mid-clause, tables mid-row, procedures
between step two and step three. The resulting chunks are individually
incoherent, which damages both matchers at once: the lexical index scores
fragments, and the embedding of half a thought is a vector pointing nowhere in
particular.

Chunk along the seams the author already provided: headings, paragraphs, list
items, code blocks, record boundaries — whatever structural units the source
format declares. Then apply size discipline *within* structure:

- **A floor**, because tiny chunks (a heading alone, a one-line row) embed as
  noise and win lexical matches they cannot substantiate — merge runts into
  their neighbors.
- **A ceiling**, because oversized chunks blur into "about several things",
  which drags their embedding toward the corpus centroid and makes every
  match a weak match — split at the strongest interior seam, not at a
  character count.
- **Overlap is a tax, not a default.** Overlapping windows hedge against bad
  boundaries by duplicating content into adjacent chunks; with structural
  boundaries the hedge is mostly unnecessary, and the cost is real — inflated
  index size and near-duplicate results that the fusion stage must then
  deduplicate. Buy overlap only where structure is genuinely weak.

Every chunk keeps **provenance**: which source, which position within it, and
enough context (its heading trail, its ordinal, its page for paginated
sources) to be presented honestly and joined back to the original. A chunk
that cannot say where it came from cannot justify its presence in a result
slice. Provenance includes **extraction fidelity** when the source needed
conversion to text: a page whose text layer yields only a scrap is almost
certainly a scanned image with a caption — the text is real, but it is *not
the page*, and a chunk built from it should carry a low confidence mark that
downstream answers surface rather than sound certain over.

## Identity by content, so re-ingest is a no-op

Ingest runs more than once — sources get re-saved, re-synced, re-imported —
and the identity scheme decides whether that is safe. Positional identity
(source + ordinal) breaks the moment an insertion shifts every subsequent
chunk; timestamp identity duplicates the corpus on every run. The scheme that
survives is **content-addressed**: a chunk's key derives from a hash of its
content plus its source identity, per
[identity-survives-reuse](../../_laws.md#identity-survives-reuse).

Content addressing makes re-ingest an **idempotent upsert**: unchanged chunks
hash to their existing keys and are skipped (along with their expensive
embeddings — the hash check is the cache key that makes re-ingest cheap);
changed chunks hash fresh and replace their predecessors; chunks whose keys
no longer appear in the new ingest are the deletions. Without this, every
re-sync grows the corpus with stale near-duplicates that then *outvote* the
current version in retrieval — the corpus rots in the direction of its own
history.

## The index is a derivation, and it drifts

Each lane's index — token postings, vectors — is derived state standing beside
the source of truth, and everything the
[derivation-names-recomputation](../../_laws.md#derivation-names-recomputation)
law says about derived state applies:

- **Writes reach every index or none.** A chunk stored but not indexed is
  invisible; indexed but not stored is a phantom hit. Couple the writes —
  same transaction where the store allows it, a reconciling sweep where it
  does not.
- **Deletions are index events too**, per
  [creation-names-reaper](../../_laws.md#creation-names-reaper). The commonest
  index defect is deletion that removes the row and orphans the postings and
  the vector: the item keeps matching, and the join back to source produces a
  hole. Whoever creates index entries owns the code path that removes them.
- **Drift is detected, not assumed away.** Source and index diverge through
  crashes mid-ingest, skipped triggers, restored backups. A cheap standing
  comparison — counts by predicate, checksums by partition — plus a **named,
  invokable rebuild** turns drift from a silent quality decay into a
  maintenance event. The check must read the index's own storage, not a view
  the source answers on the index's behalf.

## Ingest is a job with a visible status

Indexing large sources takes real time and fails in real ways, so it is a
background job with the obligations of one: progress observable per source
(queued, chunking, embedding, indexed, failed — with counts that carry their
predicate), failures attributed to the source and step that failed, and
partial completion recorded honestly rather than rounded up to done. The
sharpest case is **zero yield**: a source that produced no chunks at all (a
scanned document with no text layer, an empty export) "ingests successfully"
into permanent unsearchability, and the user's first symptom is queries that
mysteriously return nothing weeks later. Count and report the units that
yielded nothing at ingest time — that is the moment the cause is still
attached to the effect. The
consumer-facing corollary belongs to this subject: a query answered while
ingest is in flight is answered over a *partial corpus*, and surfaces that can
say so, should — the same staleness honesty the
[search](../../search/search.md) subject demands of its index-backed results.
