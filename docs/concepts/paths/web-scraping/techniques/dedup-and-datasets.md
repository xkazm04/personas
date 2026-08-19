---
layer: technique
subject: web-scraping
technique: dedup-and-datasets
status: forged
laws: [identity-survives-reuse, deletion-is-not-repair, count-carries-predicate]
shared_with: []
---

# Dedup and datasets

A scraper that appends every harvest to a table produces a pile: the same
listing forty times, once per nightly run, with no way to ask the only
questions the data was collected for — what is here *now*, what is *new*,
what *changed*, what *left*. The product of scraping is not harvests; it is
a **dataset** — the deduplicated, current, history-aware picture of the
entities the source publishes. Getting there requires exactly two designs:
an identity model and a reconciliation procedure.

## Identity: key fields, chosen once

Each record needs a key that identifies the **real-world entity**, not the
harvest event and not the page position. Candidates, best first:

1. **The source's own identifier** — an id embedded in the item's address or
   markup. The source already solved entity identity for its own database;
   steal that work. This is the overwhelmingly correct choice when present.
2. **A canonicalized item address** — usable when addresses are stable and
   one-per-entity; canonicalize first (strip tracking parameters, normalize
   host case and trailing separators), because raw addresses vary per visit
   and split one entity into many.
3. **A composite of intrinsic fields** — only when the source exposes no
   identifier: a combination whose collision would genuinely mean "same
   entity" (title alone never qualifies; two listings may share a title).
   Composite keys inherit every member field's extraction fragility, so
   every member is a *required* rule — a key assembled from optional fields
   mints phantom identities whenever one member misses.

Never in the key: row position, page number, harvest timestamp, or any
volatile display field (price, status). Those are the index-based keys of
this domain, and they break under exactly the operations the dataset exists
for — the source reorders its listings, and every record changes "identity"
overnight. Key fields are **normalized before comparison** (case, whitespace,
encoding) with the normalization versioned alongside the rules: a silent
change to normalization is a silent re-keying of the entire dataset.

The key is minted at reconciliation and stored on the record. Downstream —
exports, references, joins — uses the stored key, never re-derives it.

## Reconciliation: the four outcomes

Each harvest reconciles against the dataset per-record, by key. Four
outcomes, each with distinct bookkeeping:

| Outcome | Meaning | Action |
| --- | --- | --- |
| **new** | key not in dataset | insert; stamp first-seen |
| **changed** | key present, compared fields differ | update; stamp last-seen and last-changed; append to change history if the dataset keeps one |
| **unchanged** | key present, fields identical | touch last-seen only — "still there" is information |
| **absent** | dataset key not in this harvest | mark stale / tombstone — see below. **Never hard-delete.** |

Two subtleties that separate a correct reconciler from a plausible one:

- **"Changed" compares normalized values field-by-field**, not serialized
  blobs — otherwise cosmetic churn (reordered attributes, whitespace)
  registers as change and the history becomes noise. What fields
  participate in the comparison is declared, because some extracted fields
  (view counts, relative timestamps) change every fetch and would mark
  every record permanently "changed".
- **Duplicates *within* one harvest** (the same key extracted from page 1
  and page 2, or a listing pinned twice) are collapsed by declared policy —
  first wins, last wins, or fail-on-conflict when the duplicates disagree —
  *before* reconciliation. Feeding intra-harvest duplicates through
  insert-or-update logic makes the outcome depend on iteration order.

## Absence is evidence, not proof

The `absent` outcome is where datasets get destroyed. A key missing from
today's harvest has at least four explanations: the entity is genuinely
gone; the extraction collapsed (page redesign); the harvest was partial
(pagination broke on page 3, block after page 1); or the item merely
rotated off the surface the scraper reads. Only the first justifies
tombstoning — and the harvest itself cannot tell you which one occurred.

So the reconciler takes absence as **evidence accumulating toward
staleness**, gated on harvest health:

- **A suspect harvest never reconciles.** If
  [shape-change-detection](shape-change-detection.md) flags collapse, or
  the run was partial (fetch errors, early termination), the harvest is
  quarantined: no inserts, no updates, and above all no absence
  processing. One redesigned page must not tombstone the whole dataset.
- **Tombstone on policy, not on first miss** — e.g. absent from N
  consecutive *healthy* harvests. The tombstone records when and on which
  run the entity was last seen.
- **Tombstoned, not deleted.** The record and its history remain; the
  entity's disappearance is itself data (and sources resurrect items —
  a returning key revives its tombstone rather than minting a duplicate,
  which is the identity model paying off). Hard deletion of rows that
  witness an inconvenient harvest is the deletion-is-not-repair law wearing
  a dataset costume.

## Counts with predicates

Dataset surfaces traffic in numbers, and every one carries its predicate:
"1,204 records" is meaningless beside "1,182 **current** (excluding 22
tombstoned), 37 **new in last harvest**, harvest of <time> reconciled
**412 seen / 375 unchanged / 30 changed / 7 new / 3 newly absent**". The
per-run reconciliation summary is not a nicety — it is the dataset-side
instrument that [shape-change-detection](shape-change-detection.md) and the
run history in [scrape-scheduling](scrape-scheduling.md) read, and the
number a human checks when deciding whether to trust this morning's data.
