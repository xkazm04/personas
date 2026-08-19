---
layer: technique
subject: web-scraping
technique: shape-change-detection
status: forged
laws: [failure-not-empty-success, count-carries-predicate, gate-sees-target]
shared_with: []
---

# Shape-change detection

The defining catastrophe of scraping is quiet: the target redesigns, every
selector matches nothing, and the pipeline — fetch succeeded, parse
succeeded, extraction ran to completion — reports a successful run with
zero records. The dataset stops growing, or worse, absence processing
begins tombstoning entities that are still there. Nothing is red. This
technique is the instrument panel that makes that event **loud, named, and
actionable**: a scrape that got a page-shape change must report extraction
collapse, never zero-rows-success.

## Why detection must be engineered

"The site has no items today" and "the site redesigned" produce identical
raw output: a success status and an empty record set. No amount of
downstream care distinguishes them; the discrimination has to happen where
the evidence still exists — inside the extraction run, with access to
per-rule outcomes and historical expectation. A pipeline that keeps only
"how many records came out" has already discarded the signal.

## The signals, cheapest first

1. **Required-rule miss.** The rule DSL's declared failure semantics are the
   first tripwire: a *required* field missing across every item on a page
   is not a data condition, it is a shape condition. This signal is free —
   it falls out of executing the rules — and it fires on the very first
   post-redesign run.
2. **Per-rule hit-rate against baseline.** Each run records, per rule, how
   many matches occurred. The baseline — seeded by the authoring-time
   [dry-run-preview](dry-run-preview.md), refined by the trailing window of
   healthy runs — gives each rule an expected range. A rule that matched
   ~40 times per page for a month and matches 0 today indicts itself by
   name; that name is exactly what the alert and the re-authoring session
   need. This is count-carries-predicate as telemetry: "0 matches" means
   nothing alone, everything against "expected 35–45".
3. **Record-count and null-rate against history.** Total records per run,
   and per-field null rates, each against their trailing distribution. This
   catches the subtler failure the per-rule counts can miss: selectors that
   still match (the element survived the redesign) but now capture the
   *wrong* content — hit counts hold steady while parse-failure and null
   rates spike, or while every value in a field goes identical.
4. **Partial-shape drift.** Not every redesign is total. One field
   collapsing while others thrive (the price markup changed; titles are
   fine) must degrade that field — and fail records where it was required —
   without the healthy fields masking it in a records-per-run aggregate.
   Detection granularity is per rule, aggregated up, never aggregate-only.

A structural fingerprint of the page (a digest over element structure) is
sometimes proposed as a fifth signal; it is cheap but fires on cosmetic
churn and sleeps through semantic changes inside a stable skeleton. Treat
it as advisory context, never as the verdict — the rules themselves,
measured, are the real fingerprint.

## Thresholds without theatrics

The thresholds need engineering judgment, not machine learning: legitimate
variance exists (a marketplace genuinely has fewer listings on holidays),
and an oversensitive detector that cries collapse weekly trains its humans
to click past it — at which point the real collapse sails through a
detector everyone has learned to ignore. Practical posture: hard-fail on
required-rule misses (signal 1) and near-zero hit rates on high-volume
rules (signal 2); flag-as-suspect on distribution drift (signals 3–4);
and let *suspect* be a real state — reconciliation-blocking, human-visible
— distinct from both success and hard failure.

## The response: quarantine, alarm, re-author

Detection without a wired response is a dashboard nobody checks. On
collapse or suspicion:

1. **Quarantine the harvest.** It does not reconcile — no inserts of
   half-extracted wreckage, no updates from wrong-capture values, and
   *above all no absence processing*: a collapsed extraction "misses"
   every entity, and letting it tombstone the dataset converts a page
   redesign into data loss (the reconciler's own law — see
   [dedup-and-datasets](dedup-and-datasets.md)). Keep the raw fetched pages
   of the quarantined run; they are the corpse for the autopsy and the
   grounding material for re-authoring.
2. **Surface a run outcome of `collapsed`, not `succeeded(0)`,** into the
   schedule's run history — the vocabulary distinction
   [scrape-scheduling](scrape-scheduling.md) requires — with the failed
   rules named and their expected-vs-actual counts attached. Consecutive
   collapses escalate to pause-plus-page per the scheduling policy.
3. **Route into re-authoring.** The named failed rules plus the fresh
   fetched page are exactly the inputs
   [llm-assisted-rule-authoring](llm-assisted-rule-authoring.md) wants; a
   mature pipeline pre-stages that session — "these 3 rules died against
   this page; here is a grounded proposal awaiting your review" — so a
   redesign costs a review, not a rebuild. Repaired rules pass the
   [dry-run-preview](dry-run-preview.md) gate, the baseline re-seeds from
   the new shape, and the quarantined run may then be re-extracted rather
   than re-fetched.

## Tell collapse apart from block and outage

Zero records has three families of cause, and the remediation differs
per family, so the detector must read the *acquire* stage's evidence, not
just extraction counts: fetch failed or timed out → **outage**, retry with
backoff; fetch returned denial statuses, challenge pages, interstitials →
**blocked**, stop and involve a human (see the scheduling technique's
`blocked` outcome); fetch returned plausible full-size markup and rules
missed → **collapse**, this technique. Misclassification is expensive in
both directions — re-authoring rules against a challenge page produces
rules that extract the challenge page, and backoff-retrying a redesign
retries forever. The gate must see its target: each verdict reads the
evidence of the stage it judges.
