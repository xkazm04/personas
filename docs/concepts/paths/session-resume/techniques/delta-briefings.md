---
layer: technique
subject: session-resume
technique: delta-briefings
status: forged
laws: [count-carries-predicate, failure-not-empty-success]
shared_with: []
---

# Delta briefings

A delta briefing is the two-sentence answer to "what happened while I was
gone?" — not a log, not a feed, not a notification center. Its material is
the comparison of current state against the
[last-seen anchor](last-seen-anchors.md); its craft is selection and
restraint. The briefing is judged by a brutal metric: whether the user
still reads it in month three. Everything in this technique serves that
metric.

## Derive from what the boot already loaded

The briefing issues **zero fetches of its own**. Startup already fills
stores — recent activity, notifications, entity summaries — because other
surfaces need them; the briefing is a set of filters over those stores
with the predicate "after the anchor." This rule earns its keep three
ways:

- **Startup cost.** Launch is the most contended moment in the
  application's life; a briefing that adds a request volley to it taxes
  every user on every launch to produce a card most launches won't show.
- **Availability.** Derived-from-loaded means the briefing works exactly
  when the stores do — including offline, where "what changed locally
  while the app was closed" is still answerable.
- **Design pressure.** If a proposed briefing line needs data nothing
  else loads, the line is probably below the briefing's altitude. The
  constraint is a taste enforcer: it keeps the briefing about things the
  application already considers first-class.

The corollary: the briefing computes *after* the stores it reads have
settled, and it must know the difference between "store loaded, no
deltas" and "store not loaded yet" — deriving from an unfilled store
produces a confident, empty, wrong briefing
([failure-not-empty-success](../../_laws.md#failure-not-empty-success)).
Gate the derivation on the stores' readiness, not on a timer.

## Selection: significance, then rank, then cap

Raw deltas are plentiful and mostly boring. The pipeline is three stages:

1. **Significance filter** — each delta class declares a threshold below
   which it never appears. A completed background run matters; the
   forty-seven metric ticks behind it do not. The filter is per-class
   policy, written down, not per-call-site vibes.
2. **Ranking** — what survives is ordered by consequence to the *user*,
   not by recency: failures and things-awaiting-you outrank successes;
   successes outrank ambient change.
3. **The cap** — a briefing has a small fixed budget (a handful of
   lines). Overflow is summarized ("…and N quieter changes"), never
   scrolled. The cap is what distinguishes a briefing from a feed; a
   feed-shaped surface with a briefing's name still costs feed-shaped
   attention. (The feed itself is a different subject with different
   rules — unbounded, chronological, pull-driven.)

## Counts tell the truth or say nothing

Briefings love counts — "3 runs finished, 2 need review" — and counts
travel badly. The law is
[count-carries-predicate](../../_laws.md#count-carries-predicate): every
number the briefing shows is implicitly "N *such-that P, since anchor*,"
and the implementation must actually honor both halves. The standard
failures: counting from epoch instead of from the anchor (the count grows
forever and means nothing); counting a superset ("3 new" where one is the
user's own action, reflected back at them); counts that disagree with
the surface they deep-link to, because the badge and the destination
computed with different predicates; and — the quiet one — **counting by
filtering a bounded sample**. A store that holds "the most recent 500"
makes every derived count `min(truth, what the fetch happened to
include)`, and the briefing renders the ceiling as if it were the total.
The failure is invisible for short absences and certain for long ones —
exactly the absences a briefing exists for. Either ask the source for
the count (a query the authority evaluates over the full population), or
disclose the bound on the pixel: "500+", never "500". A delta's whole
job is to be a count; it cannot afford an undeclared ceiling. A briefing line's count and its
destination's filter must share one predicate — derive both from one
definition or link the line to a pre-filtered view.

## Each line is a door

A briefing line that cannot be acted on is trivia. Every line carries a
destination: "2 runs failed" opens the failures, filtered to the delta;
"a review is waiting" opens the review. This is where the briefing meets
the navigation model (owned by the app-shell subject): the briefing needs
location-as-data to express "that surface, filtered to since-anchor."
The deep link must apply the *same* anchor snapshot the briefing derived
from — a link that recomputes "new" against an anchor that has since
advanced opens an empty view under a line that promised two items.

## Tone and phrasing

- **Deltas, not states — with one earned exception.** "Two runs
  finished" (change) not "you have 14 runs" (inventory). The user can
  read inventories anywhere; the briefing's one job is the derivative.
  The exception is **things awaiting the user**: an approval pending,
  a review blocked on them. Those are current-state by nature — their
  urgency does not care when they arrived — and they earn a line as long
  as they are actionable now. Mixing the two kinds is fine; blurring
  them is not: a since-anchor count and a right-now count sitting in one
  card must each read as what they are.
- **Absence of news is not a line.** "No failures while you were away"
  spends a line to say nothing;
  [first-run-and-quiet-silence](first-run-and-quiet-silence.md) owns the
  discipline of not rendering at all.
- **Aggregate by class, not by event.** Five completions are one line
  with a count, not five lines. The briefing summarizes; its
  destinations itemize.

## Decision rules

- Zero briefing-specific fetches; derive from stores the boot fills, and
  gate derivation on their readiness.
- Distinguish "no deltas" from "couldn't derive"; only the former may
  render silence.
- Per-class significance thresholds, consequence-first ranking, a hard
  line cap with summarized overflow.
- Every count states its predicate and shares it with its destination;
  every line deep-links to the view that proves it.
- Never render a sample-bounded count as a total: query the source, or
  say "N+".
- Exclude the user's own last-session actions from "new."
- Phrase as change since anchor, aggregated by class; current-state
  lines only for items awaiting the user, worded as such.
