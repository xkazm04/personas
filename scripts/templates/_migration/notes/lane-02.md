# Notes - lane-02

Software engineering: when things go wrong (errors, events, incidents) (13 recipes)

Append below. Newest last. See ../FIELD_GUIDE.md section 6 for the format.


## 09:22 - GATE - the gate is now red for everyone, and that is not your bug
- Several lanes bulk-scaffolded their whole lane up front, so `check-recipes.mjs` reports
  a dozen `use_cases has 0 entries` failures that are not yours. A global green run is no
  longer available as a signal. Filter to your own topics instead, e.g.
  `node scripts/check-recipes.mjs 2>&1 | grep -E "error-triage|event-routing"`, and
  scaffold one recipe at a time so you are not the lane doing it to the other nine.

## 09:24 - GATE - guidance word count is counted on the JSON, and 90 is a hard ceiling in practice
- `guidance` at 91 words is reported as a note, not a failure, but it is the easiest way
  to leave a blemish in the final review. Write the judgment first and then cut: replacing
  "not by how often it fired, since a rare failure" with "not by how often it fired: a rare
  failure" bought two words and read better. Semicolons and colons are cheaper than clauses.

## 09:52 - RESEARCH - two numbers that make any "report a rate" recipe honest, in any domain
- **The rule of three.** With zero failures in n runs, the 95% upper bound on the failure
  rate is about 3/n. Twenty clean runs establish only that the rate is probably under 15%.
  So "100% reliable" from a small n is never a sentence a recipe should permit.
- **A proportion from a tiny n is not a percentage.** One failure in two runs is not "50%";
  its Wilson interval runs roughly 9% to 91%. Render k/n, never a bare percentage, and
  suppress the percentage below a stated minimum n. Naming the thinness IS the finding.
- Google's SRE low-traffic remedies transfer to any sparse series: lengthen the window to
  a whole number of weeks, aggregate related units into one denominator, or report "how
  many units are inside the bar" instead of a percentage per unit.
- Useful to anyone writing a digest, a scorecard, a KPI recipe or a reliability report.

## 09:54 - RESEARCH - "recording a zero" has a second half nobody writes: measure your own precision
- Alert-fatigue practice gives the band directly: under 10% of surfaced items being acted
  on means the filter is broken; 30 to 50% is healthy. That converts the App Master lesson
  into a checkable success criterion for any recipe that SURFACES things for a human:
  "the share of surfaced items a person acted on is carried forward, so the floor is tuned
  from what the team did rather than from how the list feels."
- The companion number: a learned baseline needs roughly a month of history before it is
  worth trusting. Any recipe that says it learns from history should say the trend is
  provisional until it has that, which is the "a first run establishes a baseline" lesson
  with a quantity attached.

## 10:18 - RESEARCH - "mean time to X" is the most common wrong measure in a draft, and there is a good replacement
- The VOID dataset (roughly 10,000 incidents, just under 600 companies) found incident
  duration is heavily right skewed, and found NO correlation between duration and severity.
  With that distribution a mean describes nobody: an average of 12 minutes over a set where
  half resolve in 5 and half take an hour is a number nobody experienced.
- Several drafts across this corpus say "mean time to resolution". The defensible rewrite is
  a spread (percentiles) or, better for a recipe, **a count of cases past a stated threshold**
  held constant between reports. It needs no distributional assumption and it is countable.
- The same paper's positive recommendation is worth stealing for any "how bad was it" recipe:
  report the **cost of coordination** (how many people and teams were pulled in) rather than
  duration, because that is the strain duration hides.
- Applies to lanes with support, observability, release or ops reporting recipes too.

## 10:20 - PATTERN - name the failure mode the recipe is NOT allowed to have, as a second outcome
- Several of my drafts got much sharper by splitting one outcome into two: what the work
  produces, and the specific dishonesty it must not commit. "A report that could not be
  grounded is recognisably different from one that was, before somebody acts on it" is a
  claim about the world, is checkable, and it is where the App Master lessons (record a
  zero, first run is a baseline, one environment is not a claim about another) actually fit.
- The test that keeps it an outcome rather than guidance: it has to be a state of the world
  a reader could disagree with, not an instruction to the agent.

## 10:44 - DECISION - a knob naming an HOUR is a cadence binding, and it is the hardest one to see
- Adopting lane-10's "drop binding-shaped knobs" and lane-05's "delete a binding, rewrite a
  quantity", there is a third shape neither names: `daily_digest_hour: 9`. It looks like a
  number, so it survives both filters, but it is a schedule and the schedule belongs to the
  charter's trigger. Two of the drafts in this lane carried one and both carried a
  `transformNote` saying so, which is how I found them.
- What worked better than deleting it outright: replace it with the quantity the enriched
  recipe actually needs an adopter to set. Here that was the threshold defining a slow case
  and the minimum attempts before a rate may be shown as a percentage. Same field, real
  judgment in it, and the cadence is gone.

## 11:05 - DECISION - when research CONTRADICTS the draft, the draft is usually the one that is wrong
- The strongest single change in this lane was a reversal. `incident-capture-and-classification`
  said in its guidance "duplicate reports of one event are the normal case, so join rather than
  fork". Incident practice says the opposite where it counts: a **false merge is worse than a
  false fork**, because the second, different problem folded into the first inherits its
  acknowledgement, its status and its resolution, and disappears when the first is closed. A
  false fork costs duplicated triage that a human notices in minutes.
- The rewrite kept the draft's true observation (duplicates ARE normal) and reversed the
  prescription: default to separate records, OFFER the join, keep members individually
  recoverable so a join is reversible. If a draft in your lane prescribes merging, grouping,
  collapsing or deduplicating anything a person will later close, check which direction the
  expensive error runs before you polish the sentence.

## 11:08 - RESEARCH - the acknowledgement trap, for any recipe that chases somebody
- Acknowledging an alert or incident STOPS the escalation policy in every major tool. So an
  acknowledgement is a promise to work on it that the system accepts as proof, and the person
  who acks at 3am and goes back to sleep has silenced the exact mechanism designed for that
  case. The fix is a first-class setting, not a cultural exhortation: an acknowledgement
  timeout that returns the item to escalatable after N minutes and re-notifies whoever holds
  the rotation NOW, not only whoever acked.
- Two companions worth stealing: escalate on a **missed update commitment** rather than on
  elapsed time (a long well-handled incident should not be chased and a short abandoned one
  should); and each rung of a ladder must reach a **different person**, because a repeated
  identical nudge carries no new information and is learned away.
- Applies to any recipe that nudges, chases, follows up or waits on a human: approvals,
  reviews, unanswered mail, stalled work items.

## 11:10 - PATTERN - "what this recipe will NOT act on" belongs in a success criterion
- The sharpest criteria in this lane are refusals, and each came from research rather than
  from the draft: an issue whose premise a later release already overtook is declined **with
  the decline recorded**; a failure whose fix belongs to a dependency or the client is named
  as such rather than given a local fix; a diagnostic that would RUN the suspect work rather
  than describe it is refused; an action item whose verb is "improve" or "review" is rewritten
  or dropped because neither has an end state anybody can check.
- Written as "X is refused, and the reason is recorded", a refusal is a claim about the world
  and satisfies both the outcome contract and the App Master lesson that a result nobody wrote
  down did not happen. Worth a pass over your lane asking what each recipe declines.
