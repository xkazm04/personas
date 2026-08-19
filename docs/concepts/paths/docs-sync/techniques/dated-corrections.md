---
layer: technique
subject: docs-sync
technique: dated-corrections
status: forged
laws: [count-carries-predicate, deletion-is-not-repair]
shared_with: []
---

# Dated corrections

When a documented claim is discovered false, there are three possible moves.
Delete the claim — which removes the information along with the error
([deletion-is-not-repair](../../_laws.md#deletion-is-not-repair): the next
author re-derives the same false belief from the same evidence and writes it
back). Silently rewrite it — which repairs the sentence and destroys the
record: downstream copies of the false claim become uncorrectable, and the
reader loses the ability to date anything else on the page. Or **correct it
in place, dated, with the measurement that earned the correction** — which
is this technique, and the exemplar repository's most valuable habit.

## The anatomy of a correction

A correction that will still be trusted in a year has five parts:

1. **The false claim, kept visible** — quoted, struck through, or restated:
   *"this line said X until [date]."* The false version is data: it tells
   the reader what other documents citing this one may still say, and warns
   the next author off re-deriving it.
2. **The date** — corrections without dates cannot be ordered, and a page
   with mixed-vintage claims and no dates forces the reader to distrust all
   of it equally.
3. **The measured truth, with its predicate**
   ([count-carries-predicate](../../_laws.md#count-carries-predicate)) —
   not "the real number is much lower" but "measured [date] at [ref]:
   0 errors, 1,135 warnings across 246 of 4,829 files," so the next reader
   can re-run the measurement instead of re-trusting the prose.
4. **The instrument** — how it was measured, because the diagnosis of the
   original error is usually *the instrument answered a different question
   than the one asked*, and naming the new instrument is what keeps the
   correction from repeating the mistake.
5. **The blast radius** — which downstream claims inherited the false value.
   The exemplar's sharpest case: a warning count stale by roughly 9× had
   been cited by five downstream documents as the *reason* for a design
   decision. The correction did two things silent rewriting cannot: it
   hunted the citations, and it re-derived the decision's justification on
   grounds that did not depend on the broken number — recording that **the
   conclusion survives on better grounds**, which is itself a finding.

## Corrections of corrections are normal, not embarrassing

The exemplar contains a correction whose own measurement was wrong — a
search truncated by its own display limit reported three citation sites
where four existed, the tool answering a different question than asked and
the answer looking plausible — and the fix was a *second* dated correction
layered on the first, naming the failure mode. This is the practice working,
not failing: a correction is a claim like any other, held to the same
standard, correctable by the same ritual. A culture where amending a
correction is embarrassing is a culture that stops measuring after the first
amendment.

## Corrections expire: the resolved-marker discipline

The subtlest rot in a correction culture is the correction that outlives its
subject. The exemplar's measured case: a warning block describing a
defective catalog entry stood for four days *after* the entry was fixed —
"the stale artifact was this paragraph, which outlived by four days the
defect it named." Standing corrections and warning blocks therefore carry
**verification dates** ("verified still true [date]"), and a resolved
defect's marker is rewritten as a dated resolution — *what* was fixed,
*when*, *where verified* — not silently deleted, and not left standing as a
live warning. A warnings section is a claim about the present; it needs the
same freshness machinery as any other doc
(see [doc-rot-detection](doc-rot-detection.md)).

## Why in place beats a changelog entry

The correction belongs at the exact site of the false claim because that
site is where the next reader would have absorbed it. A changelog entry or
errata page corrects readers who go looking for corrections — a population
of approximately zero. In-place correction also compounds into something no
clean document provides: a **calibration record**. A page carrying its own
correction history teaches the reader the local error rate, the
characteristic failure modes ("stale count," "grep answered a different
question," "measurement of the counter"), and the standing instruction the
exemplar distilled from them — *re-measure before citing*. A pristine page
with the same history scrubbed teaches unwarranted confidence.

## The interplay with enforcement

Dated corrections are the manual complement to the mechanical walls. The
enforcement hook collects debt the author knows about at change time; the
rot scan finds staleness by recency; dated corrections handle the third
class — claims discovered false by *use*, long after any change boundary,
usually by an agent or engineer acting on them and hitting reality. The
ritual's cheapness is load-bearing: correcting in place costs one paragraph,
so it happens in the same session as the discovery; anything heavier gets
deferred, and deferred corrections join the drift they were meant to fix.
