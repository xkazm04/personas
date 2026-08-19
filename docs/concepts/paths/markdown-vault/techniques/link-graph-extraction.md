---
layer: technique
subject: markdown-vault
technique: link-graph-extraction
status: forged
laws: [one-authority-per-vocabulary, derivation-names-recomputation, count-carries-predicate]
shared_with: []
---

# Link graph extraction

Inline references between notes — the double-bracket link a human types
while writing — are the vault's relational layer. Extracting them into an
explicit structure (edges, a backlink index, per-note degree) turns prose
into a graph the application can navigate, rank, and audit. The technique is
one part parsing and three parts discipline about what the parsed result
*is*: a derived view of a store other programs mutate.

## One extractor, one resolution semantics

A raw link carries decorations: an alias (display text that differs from
the target), a section fragment (a pointer into the target's headings), an
embed marker. Extraction and normalization — pull the payload, strip alias
then section, trim, case-fold — look trivial, which is exactly why every
feature that needs links grows its own copy, and the copies drift.

The drift is not cosmetic. Link resolution is a **vocabulary** in the
[one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary)
sense: the linter's definition of "resolves", the navigation's definition,
and the graph view's definition must be the same definition, or the system
disagrees with itself about which links are broken — the integrity report
flags a link the navigation happily follows, and trust in both dies. One
shared extractor and one shared normalizer, consumed by every feature, is
the structural fix; when consumers genuinely need different slices (per-line
extraction for line-number reporting, whole-body extraction for a target
set), they share the core scan and differ only in how they feed it.

Resolution itself follows the human's authoring convention: links name
targets by note title, resolved case-insensitively against an index of every
note's basename. That convention has a known ambiguity — duplicate titles in
different folders — and the resolver picks a deterministic winner rather
than pretending the case cannot arise.

## Edges are data in both directions

- **Outgoing links** are cheap: they are literally in the note.
- **Backlinks** — "what points here" — are the inverted index, and they are
  the graph's navigational payoff: the reader standing on a note sees every
  place that cites it, which is how a vault is browsed *against* the grain
  of authorship.
- **Degree is structure.** A note with many outgoing links is functioning as
  a table of contents — a hub worth surfacing as an entry point. A note with
  no incoming links is unreachable by navigation — the orphan signal the
  integrity lint consumes.
- **Unresolved links are still edges.** A link whose target does not exist
  points at a note somebody intended to write. Surfacing these serves two
  masters: the lint reads them as broken references; the authoring surface
  reads them as an invitation. Same data, two consumers, one predicate each.

## The graph is a derivation, and it says so

The extracted graph is a cached computation over files a human edits in
another program. Per
[derivation-names-recomputation](../../_laws.md#derivation-names-recomputation),
it must name how it is rebuilt — a fresh walk and re-extraction — and be
honest about staleness in between. Two invalidation mechanisms, layered on
purpose:

- **Event-driven:** a filesystem watcher drops the cache the moment a note
  changes. Precise, but only alive while the watcher runs.
- **Time-bounded:** a short TTL caps how stale the cache can be when changes
  happened while nobody was watching.

Neither alone is sufficient — the watcher misses edits made while the
application was closed; the TTL alone makes every read a coin-flip on
freshness. Together they bound staleness from both sides. And the cache is
an *optimization* of the walk, never a second authority: any consumer that
cannot tolerate the staleness bound recomputes.

## Counts over the graph carry their predicate

Per [count-carries-predicate](../../_laws.md#count-carries-predicate):
"orphan count" is not one number. Counting notes with zero incoming edges
gives one figure; counting them after exempting deliberate entry points
(indexes, top-level overview notes) gives another. Both are legitimate —
for different consumers — but a dashboard stat and an integrity report that
compute "orphans" with different exemption policies, without saying so, will
eventually be compared to each other, and the discrepancy will be read as a
bug in whichever surface the reader trusts less. Every count that leaves the
graph names its predicate and its exemptions.
