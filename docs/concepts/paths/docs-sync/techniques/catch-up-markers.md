---
layer: technique
subject: docs-sync
technique: catch-up-markers
status: forged
laws: [failure-not-empty-success, count-carries-predicate]
shared_with: []
---

# Catch-up markers

Every per-change enforcement system needs a recovery lane. Dismissals
accumulate, hooks die (this subject's own counter-example was dead for
fifteen months), whole surfaces get imported from before the discipline
existed — and the repair for accumulated drift is a **batch pass**: read the
current source truth, rewrite the affected documentation wholesale. The
difference between a bounded repair and an open-ended rewrite-everything
campaign is a small recorded artifact: the **marker** — the ledger entry the
last full pass left behind so the next pass knows exactly what it owes.

## What the marker records

A marker is a tiny structured file, versioned next to the surfaces it
describes, holding four things:

1. **The anchor** — the commit (and date) the last full pass was measured
   against. This is the marker's reason to exist: the next pass scans the
   range *anchor..now* instead of re-reading all history or, worse,
   guessing. A pass without an anchor either re-does everything (expensive,
   so it gets skipped) or under-does the tail (silent, so it gets trusted).
2. **What was covered** — the topics/documents actually rewritten, listed
   explicitly. "Full pass" is a claim; the list is the predicate
   ([count-carries-predicate](../../_laws.md#count-carries-predicate)) —
   the exemplar's marker names all 84 rewritten topics, which is what lets
   a later reader distinguish "this topic was current as of the anchor"
   from "this topic was never in scope."
3. **What was consciously skipped** — first-class, not a footnote. The
   exemplar's `missingCoverage` list names three product surfaces that had
   no guide topics at all: known gaps, recorded as gaps, carried forward
   until someone writes them. A marker that records only successes reports
   its own blind spots in the voice of completeness
   ([failure-not-empty-success](../../_laws.md#failure-not-empty-success)
   applied to bookkeeping) — the skip list is what makes the next pass's
   scope *anchor..now plus the standing debts*, not just the range.
4. **The baseline note** — a short prose statement of what state the pass
   left the surface in and what product truths it incorporated, so the next
   operator can judge whether the world has shifted enough to warrant going
   wider than the range.

## The marker records what was done — never what is hoped

The exemplar's marker carries a cautionary sentence at the end of its note:
*"the per-session hook now prevents this kind of drift; bulk rewrites should
not be needed again"* — written on the very day the never-fired hook landed
(see [same-change-enforcement](same-change-enforcement.md)). A hope,
recorded as a fact, in exactly the artifact the next repair pass reads to
decide how suspicious to be. The next operator, trusting it, would scope
narrow; the truth (zero enforcement, fifteen months of unimpeded drift)
demanded scoping wide. The rule: a marker states **what this pass did and
against what** — claims about the future belong to the enforcement's own
liveness evidence, which is measured, not predicted. When the mechanisms
around the marker change, the marker gains a dated note *that* they changed,
never an assertion that they work.

## Marker discipline

- **One marker per surface family**, not one global — the reference docs,
  the tour content, and the cross-repo guides drift at different rates and
  are repaired by different passes; a shared marker forces the narrowest
  pass to lie about the widest surface.
- **The pass updates the marker as its final act**, in the same change as
  the repairs — a repair committed without its marker update recreates the
  ambiguity the marker exists to remove.
- **Markers are read, so gate them lightly**: the pass should refuse to run
  against a missing or unparseable marker with a loud "cannot determine
  range" rather than silently defaulting to either extreme — full rewrite
  (expensive surprise) or empty range (silent no-op).
- **Cross-repo surfaces get their obligations *delivered* through the
  marker**: where the same-change check cannot gate a sibling repository
  (see [coupled-surface-inventory](coupled-surface-inventory.md)), flagged
  modules accumulate in the marker's queue (`topicsFlagged`), and the batch
  pass drains it — the marker is the honest interface between "we cannot
  enforce this per-change" and "we did not forget it."

## The economics

The marker is the cheapest artifact in this subject — a few dozen lines,
updated once per pass — and it converts the batch pass from a campaign
someone must *decide* to run into a mechanical question: *how big is
anchor..now, and how long is the skip list?* When that range is small, the
pass is cheap and runs; when the marker shows fifteen months and a dead
hook, the size of the repair is at least *known* before it is scheduled.
Unbounded repair debt is not the drift itself; it is not knowing how much
drift there is — and the marker is what keeps that number computable.
