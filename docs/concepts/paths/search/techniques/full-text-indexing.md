---
layer: technique
subject: search
technique: full-text-indexing
status: forged
laws: [derivation-names-recomputation, gate-sees-target, creation-names-reaper]
shared_with: []
---

# Full-text indexing

An index trades write-time work and storage for query-time speed. That trade
is the whole subject: everything else in this technique is either deciding
whether the trade is worth making, deciding what the tokenizer throws away
(because an index is also a *lossy summary*, and what it discards can never be
matched), or keeping the derived artifact honest against the source of truth
it summarizes.

## Index or scan

A linear scan — walk the rows, substring-match each — is not a failure of
sophistication; below certain thresholds it is the correct engineering. The
decision has three inputs:

- **Corpus size.** A scan's query cost grows with the corpus; an index's
  query cost grows roughly with the result set. Personal-tool corpora in the
  thousands of short records scan in well under the perception budget;
  archives in the hundreds of thousands of documents do not.
- **Query frequency.** As-you-type search multiplies query volume by the
  length of every query typed. A scan that is fine for a submit-button search
  can saturate under per-keystroke issuance.
- **Match semantics.** A scan gives substring matching and nothing else. The
  moment the product needs word-boundary matching, multi-term queries with
  independent term positions, relevance ranking, or phrase search, the index
  is buying capability, not just speed.

The honest failure mode runs in both directions: indexing a corpus of two
hundred names is complexity with no payer, and scanning a million-row archive
is a latency cliff scheduled for the customer who succeeds hardest.

## Tokenization: the decisions that cannot be unmade at query time

An index stores tokens, and only tokens can be matched. Every tokenizer
decision is therefore a *product* decision about what users can find:

- **Word splitting.** Whitespace and punctuation boundaries are the easy
  part; the hard cases are identifiers — compound technical names, dotted
  paths, hyphenated terms — where users expect to search by fragment. If the
  corpus is code-adjacent, decide explicitly whether internal humps and
  separators produce sub-tokens.
- **Case and diacritic folding.** Almost always yes for both: users do not
  reproduce capitalization or accents when searching. Folding at index time
  requires the identical folding at query time — the two sides of the match
  must pass through the same normalization, or the index quietly stops
  matching classes of input.
- **Stemming.** Conflating inflections (run/running/ran) raises recall and
  costs precision, and its worth is corpus-dependent: high for prose,
  negative for identifiers and codes where "runner" and "run" are different
  things. If stemming is on, excerpt highlighting must be stem-aware or the
  marks will not line up with the matched words.
- **Prefix support.** As-you-type search matches half-typed words, which
  requires prefix-capable indexing (or an explicit prefix rung in the query
  ladder). Retrofitting prefix support usually means reindexing — decide
  before the corpus is large.

Because these choices are baked into the stored tokens, **changing any of them
means rebuilding the index**. That is the segue to maintenance.

## The index is a derivation — name its recomputation

An index is a stored derived value, and the derivation-names-recomputation law
applies with full force: there must be a documented, invokable path that
rebuilds the index from the source of truth, and it must be cheap enough to
actually run. The rebuild is not an emergency procedure — it is the arbiter
every drift dispute appeals to, the migration path every tokenizer change
requires, and the recovery path for every corruption. An index without a
rebuild path is a cache with no eviction story wearing a database's clothes.

Ongoing maintenance picks one of three postures:

- **Synchronous with the write.** Every insert, update, and delete on the
  source updates the index in the same transaction. Zero staleness; write
  cost on every mutation; the strongly preferred posture when source and
  index live in the same store, because the transaction boundary makes drift
  structurally impossible rather than operationally unlikely.
- **Asynchronous queue.** Mutations enqueue index work applied with a lag.
  Buys write throughput; costs staleness the surface must disclose (a created
  record that isn't findable yet is a bug report waiting to be typed), and
  requires the queue itself to be drainable, monitorable, and idempotent.
- **Periodic rebuild.** The index is recomputed wholesale on a schedule.
  Simplest to reason about, staleest in steady state; appropriate for
  slow-moving corpora and for indexes that are advisory rather than
  authoritative.

The postures compose: the strongest arrangement seen in practice is
synchronous maintenance *plus* a cheap startup reconciliation — count the
source, count the index, and invoke the rebuild only when they disagree. The
synchronous path keeps steady state exact; the reconciliation catches the
histories the triggers never saw (rows written before the index existed,
maintenance hooks dropped by a migration) — and the comparison is *not equal*,
not *less than*, because an index carrying entries for deleted rows is the
same drift wearing the other sign.

## The index is a proxy — searching it is not searching the data

The gate-sees-target law names the standing risk: a query answered from the
index is answered from a *proxy*, and it is correct exactly as long as the
proxy tracks the target. Design consequences:

- **Deletions must reach the index.** A tombstoned or hard-deleted source row
  whose tokens linger produces ghost results — matches that resolve to
  nothing. Whatever creates index entries names what removes them
  (creation-names-reaper); "the index only ever grows" is a leak with a
  search box in front of it.
- **Join back to the source for presentation.** Store the searchable text in
  the index but treat the source row as authoritative for everything shown —
  titles, statuses, permissions. An index that answers presentation questions
  is a second authority for vocabularies it doesn't own.
- **Verify reachability, not just presence.** Access control evaluated at
  index time is stale the moment permissions change; evaluate visibility
  against current rules when results are served, or accept and document the
  disclosure risk.
- **Measure the index through its own storage.** Index designs that store
  only tokens and answer non-search reads by delegating to the source table
  have a trap: counting the index through its query interface counts the
  *source*, so a drift check built that way compares the source against
  itself and can never fire. A health check on a derived artifact must read
  the artifact's own storage — the gate must see its target, not a view that
  silently answers from the thing being checked against.

## Scope is part of the schema

Decide — and record — which fields of which entities are indexed, with what
weight. This is the "what was searched" contract the parent surface must be
able to state. Adding a field to the index later is a rebuild; more
importantly, it is a *change in what "no results" means*, which is a
user-facing semantic shift, not an internal optimization.
