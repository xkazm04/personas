---
layer: technique
subject: docs-sync
technique: doc-rot-detection
status: forged
laws: [failure-not-empty-success, derivation-names-recomputation]
shared_with: []
---

# Doc-rot detection

Per-change enforcement collects the debt it can see; some drift always
ships anyway — dismissed nags, unmapped areas, dead hooks, documentation
inherited from before the discipline existed. Doc-rot detection is the
scan that finds it: for each document, discover what source it is coupled
to, and judge whether the document is still a plausible description of that
source. It is a sensor in the sense of
[codebase-scanning](../../codebase-scanning/codebase-scanning.md) — that
subject owns the pipeline it plugs into (isolation, finding lifecycle,
triage delivery); this technique owns what the sensor measures and, above
all, its verdict vocabulary.

## Coupling discovery: declared first, convention second, honesty third

The scanner resolves each document's coupled sources through a ladder:

1. **the declared map** (see [source-doc-mapping](source-doc-mapping.md)) —
   the entry's source globs are the coupling, authoritative where present;
2. **colocation convention** — a document living inside a source area is
   coupled to that area by position;
3. **neither** — and this is the rung that separates honest scanners from
   flattering ones.

## Unverifiable is a verdict, not an absence

A document whose coupling cannot be discovered **cannot be judged fresh**.
The tempting implementation folds it into "clean" — no coupled sources
found, therefore no stale sources found, therefore no finding — and the
exemplar implementation's own comment records the temptation's price:
rendering unverifiable documents as clean *"was this detector's biggest
lie."* The sound vocabulary has three rungs, strictly ordered:

- **stale** — coupled sources are newer than the document (or contradict
  it); actionable, with the triggering sources named;
- **unverifiable** — no coupling could be established; tracked as its own
  population, reported with its own count, never eligible for "clean";
- **fresh** — coupling established, and nothing in it postdates the doc.

This is [failure-not-empty-success](../../_laws.md#failure-not-empty-success)
applied inside a single verdict: "I checked and found nothing" and "I could
not check" are different answers, and a scanner that conflates them converts
its blind spot into a health claim. The unverifiable count is also the
scan's own quality metric — it measures the coupling ladder's coverage, and
a rising unverifiable population is the map rotting, detected from the doc
side.

## Staleness signals beyond timestamps

Source-newer-than-doc is the cheapest signal and the weakest: it fires on
every comment typo fix and misses every claim that was false at birth. A
mature rot scan layers stronger signals:

- **dead references** — the document names files, commands, identifiers, or
  anchors that no longer resolve; mechanically checkable and near-perfect
  precision;
- **expired claims** — dated statements ("as of [date]", "measured [date]")
  older than a staleness horizon; the date the
  [dated-corrections](dated-corrections.md) ritual embeds is exactly what
  makes this check possible — a predicate-carrying claim is a re-runnable
  claim ([derivation-names-recomputation](../../_laws.md#derivation-names-recomputation):
  the stated instrument is the recomputation path);
- **counts that no longer reproduce** — where a claim states both number
  and predicate, re-run the predicate and compare;
- **description-shape drift** — the document enumerates N of something the
  source now has M of (tabs, steps, options); catchable wherever the
  enumeration is mechanically extractable.

## Bounded, prioritized, stably truncated

Documentation populations are large and rot scanning is not free, so the
scan runs a **bounded budget in priority order** — most-read documents
first, most-coupled first — with **stable truncation**: the same budget over
the same tree examines the same documents, so consecutive scans are
comparable and "checked 400 of 900, priority-ordered, cutoff stable" is an
honest coverage claim. An unstable cutoff makes every scan a different
sample and every trend line a fiction. Per the parent pipeline's law, the
truncation is disclosed — a rot report that silently examined a third of
the tree is itself a rotting document about the scan.

## What the scan feeds

Findings flow into the standard scanning lifecycle — verified, deduplicated,
triaged — not directly into edits: a stale-doc finding is a *claim* that the
doc and source disagree, and which of the two is wrong is a human judgment
(sometimes the doc is right and the source regressed). Two consumers are
specific to this subject: the [catch-up pass](catch-up-markers.md) uses rot
findings to scope its range, and the unverifiable population feeds the
map-coverage gate — each document that cannot be coupled is a candidate map
entry, which closes the loop between the scan and the artifact it depends
on.
