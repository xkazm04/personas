---
layer: technique
subject: search
technique: ranking-and-excerpts
status: forged
laws: [identity-survives-reuse, count-carries-predicate]
shared_with: []
---

# Ranking and excerpts

A result list is an argument: "these, in this order, for these reasons."
Ranking supplies the order; the excerpt supplies the reasons. An
implementation that gets the order right but cannot show why each result is
present has built a correct oracle that users will not trust — and an
implementation whose order changes between identical queries has built one
they cannot learn.

## Relevance signals, combined on purpose

The base signal for text relevance is the family of term-frequency measures
weighted against document length (BM25 and its relatives): a term counts for
more when it is rare across the corpus, appears often in this document, and
the document is not simply long. Engines provide this for free; the
engineering is in what gets layered on top:

- **Field weighting.** A match in a title outranks the same match in a body;
  a match in a name outranks one in a description. Weights are set per
  indexed field, once, as part of the index schema — they encode the
  product's judgment about where meaning concentrates.
- **Recency.** For operational corpora (runs, events, messages), newer is
  often more relevant at equal text score. Recency enters as an explicit
  score component or as the designated tiebreaker — never as an implicit
  side effect of insertion order.
- **Entity priors.** Some records matter more categorically (active over
  archived, mine over others'). Priors are legitimate but must be small
  relative to text relevance, or the search stops answering the query and
  starts answering the prior.

The combination rule is written down: which signals exist, their relative
weights, and why. A ranking assembled by accretion — each defect patched with
another additive bonus — converges on a formula nobody can predict, which is
indistinguishable from randomness to the person scanning the list.

## Deterministic total order

The same query over the same corpus returns the same order, every time. Score
alone does not guarantee this: scores tie, and float arithmetic ties more
often than intuition suggests. The rule is the one every ordered surface
obeys — **the final sort key ends in a unique, stable identity** (the
identity-survives-reuse law). Score descending, then recency descending, then
identifier: a total order with no ambiguity left for the storage layer to
resolve differently on the next call.

Nondeterminism here is not cosmetic. As-you-type search re-executes on every
keystroke; if equal-scored results swap positions between executions, the
list shimmers under the user's eyes and click targets move as they reach for
them. And any pagination over an ambiguous order duplicates or drops rows at
page boundaries — the same defect the table subject's pagination technique
documents, arriving through the score column instead of the timestamp.

## Excerpts: the justification

An excerpt (snippet) is a window into the matched document, chosen to show
the match in context. Its contract:

- **Show the densest match neighborhood**, not the document head. A snippet
  that always shows the first N characters is a description, not a
  justification; the window should center where the query terms cluster.
- **Mark the matched terms** within the excerpt, with marks derived from what
  the *engine* matched — after folding, stemming, prefix expansion — not from
  a naive re-find of the raw input. The classic defect is a highlighter that
  re-searches the display text for the literal query and misses the inflected
  form the engine actually matched: the user sees a result with no visible
  reason.
- **Be honest about elision.** Leading and trailing ellipses when the window
  is interior; no ellipsis when the excerpt is the whole field. A truncated
  excerpt presented as complete misrepresents the document.
- **Escape then mark.** The excerpt is user or third-party content headed for
  a rendering surface; the match markers are markup. Compose them in the
  order that cannot inject: neutralize the content first, then wrap the match
  spans. A highlighter that interpolates raw content into markup is an
  injection seam in the most-viewed pixel of the feature.

Excerpt computation is per-result-page work, not per-corpus work — compute
snippets only for the rows being returned, never as part of scoring the
candidate set.

## Scores are internal

Raw scores do not render. They are not calibrated across queries (a 4.2 for
one query and a 4.2 for another mean nothing comparable), and exposing them
invites users and downstream code to treat them as a vocabulary they are not.
The interface is the order, the excerpt, and — where sections help — coarse
labeled bands ("best match", "also matched"). If a number must travel (into a
log, a debug view), it travels with its predicate: which query, which corpus
snapshot, which formula version (count-carries-predicate).

## Ranked and filtered, together

Ranking composes with the subject's other predicates: facets and filters
restrict the candidate set *before* scoring, and the counts a surface shows
("34 matches in Projects") are counts under the full parsed predicate, not
the free text alone. Keep one boundary clean: filters decide *membership*,
ranking decides *order*. A filter that also nudges scores, or a ranking bonus
that effectively excludes, blurs the one distinction that lets users predict
what the surface will do.
