# Notes - lane-03

Software engineering: codebase health, work intake, engineering records (13 recipes)

Append below. Newest last. See ../FIELD_GUIDE.md section 6 for the format.

## 09:35 - RESEARCH - where a finding is delivered beats how good the finding is
- Facebook's Infer: the same analysis at the same false-positive rate got roughly 0% fix
  rate when 20-30 issues were handed over as a standalone list, and over 70% when the
  identical findings appeared at the moment a diff was reviewed. Useful in any recipe that
  produces findings, candidates or proposals for a person: the delivery point is a design
  decision the recipe owns, not an adoption detail. Source: O'Hearn, "Scaling Static
  Analyses at Facebook", CACM 2019.
- The companion rule from Google's Tricorder: an "effective false positive" is any finding
  the reader took no action on, even a correct one, and they retire an analyzer above
  roughly a 10% not-useful rate. That makes "measure your own rejection rate and narrow or
  stop the category" a checkable success criterion rather than a platitude.

## 09:36 - PATTERN - three outcomes: the claim, the honest negative, the resume
- A shape that fits every scan/monitor/audit recipe I have hit so far and reads well:
  outcome 1 is the thing the work is for; outcome 2 is "a pass that found nothing says so,
  a first pass declares a baseline instead of a trend, and what was not looked at is named";
  outcome 3 is "the next pass resumes from what this one recorded". Two and three are where
  the App Master lessons in FIELD_GUIDE 3b land naturally, and they stop outcome 1 from
  having to carry six criteria.

## 09:37 - DECISION - examples/ for a builtin connector: write about the connector CLASS
- Several drafts carry examples naming the consuming app's builtins (codebase, codebases)
  with notes that list the builtin's internal function names. The registry cannot see that
  catalog and those names will drift. I am writing examples/<connector>.md about the
  connector class instead: what a local checkout can and cannot supply (history yes, runtime
  usage no, "not found" is a real claim, no pull request to attach to), which is genuine
  mapping knowledge that stops applying the moment you swap to a hosted forge. Same file
  name, same gate satisfaction, longer shelf life.

## 09:38 - GATE - check-recipes reports the whole corpus, so grep for your own topic
- `node scripts/check-recipes.mjs` fails on every other lane's in-progress recipe (empty
  use_cases), so a bare run is never green mid-migration and tells you nothing. Run it and
  grep your own topic directory: `node scripts/check-recipes.mjs 2>&1 | grep -i <your-topic>`.
  Silence there means your recipes are clean, including the examples/<connector>.md notes.

## 10:20 - DECISION - when a lane has three near-identical gates, split them on the SHAPE OF THE SUPPLY
- My lane carries three triage gates whose drafts were almost the same recipe, and two of
  them literally said "same job as the other gates in this family". Splitting them on what
  feeds them made all three distinct and none of them poorer:
  the general gate owns CAPACITY (declare how many decisions fit, judge the gate on closes
  divided by arrivals, an accept must have a carrier); the harvest-fed gate owns STALENESS
  (the premise is months old, re-read it against the code before putting it to anyone,
  decline as overtaken and name what is really left underneath); the outside-in gate owns
  DEMAND (nothing scouted has anyone who asked for it, so an accept must name a person and
  an occasion, and the accept rate is the measure of whether it screens at all).
- The general test: ask what goes wrong with THIS supply that would not go wrong with the
  others. If the answer is nothing, you have one recipe written twice.

## 10:22 - RESEARCH - the intake and triage numbers, reusable by any lane with a queue
- Reinertsen: raising utilization from 80% to 90% roughly doubles queue size, and 90% to
  95% doubles it again. A reviewer booked solid is the cause of the backlog, not the cure.
  Design any gate around 70 to 80% of the reviewer's available time.
- Mozilla's health metric is a RATIO, not a depth: maintenance effectiveness above 100%
  over a rolling 12 weeks, i.e. closing faster than opening. It is the only measure I found
  that fails loudly in both directions (queue nobody drains AND gate that accepts
  everything), so it makes a much better success criterion than "the queue stays short".
- Auto-close is not free and the cost is invisible on count metrics: a 20-project study of
  stale bots found +15% issues closed in month one, and by year one 10% fewer closed, 24%
  fewer merged and 14% fewer active contributors per month. Any recipe that ages items out
  should report what stopped being SUBMITTED, not just what stopped being queued.
- Duplicate rates run about 6.6% to 26% across large trackers, and over half of duplicates
  are spotted within half a day: dedupe belongs at intake, where it is nearly free.
- Roughly 22% of filed reports are invalid and about a third of the ones labelled valid are
  misclassified, so argue for a decline that is CHEAP TO REVERSE rather than one that is
  accurate.
- Screening funnel: about 3,000 raw ideas per commercial success, with roughly 10% surviving
  the first screen. A gate accepting much more than that at first pass is not screening.
- Typed decline reasons are learnable: a study of 600 wontfix reports produced a 12-category
  taxonomy predictable at 90 to 93%. That is the evidence for "a reason from a small closed
  set can suppress a category, and free text cannot", which I used as a success criterion in
  all three gates.

## 10:24 - PATTERN - inventory-shaped beats diff-shaped, and it is the fix for a whole class of draft
- Several drafts (mine: opportunity research, skill audit, backlog scan) were written purely
  as "report what changed since last time". The dangerous case is always the thing that did
  NOT change: a dependency whose maintainers stopped is behind by nothing and passes every
  freshness check, so it looks best exactly when it is worst. The rewrite is to enumerate the
  whole population every pass and compare against the state the last pass recorded, then
  report silence as a finding in its own right.
- This is the same distinction the migration's own gate makes between "found nothing" and
  "looked at nothing". If your recipe watches anything, check whether it can see absence.

## 10:25 - TRAP - three recipes in MY lane share `id: uc_triage`, confirming lanes 04 and 10
- Adding a third data point to what lane-04 and lane-10 already reported: `work-candidate-
  triage-gate`, `harvested-idea-triage` and `scouted-opportunity-triage` all carry
  `"id": "uc_triage"`, and one more (`idea-architecture-verdict`) carries a non-uuid too.
  The gate does not check id uniqueness. I left them exactly as scaffolded rather than
  inventing uuids, but this is now three lanes reporting it, so the director should assume
  `id` is NOT a key across the corpus.

## 10:26 - DECISION - a gate that must re-validate needs a connector its draft did not declare
- `harvested-idea-triage` had `connector_types: []`, which was right for a pure queue and
  wrong once the App Master lesson (re-validate the premise before acting, with authority to
  decline) is taken seriously: checking a premise means reading the code. I added
  `source_control` and said in the trigger rationale that the check is a cheap read at
  arrival rather than the analysis it stands in front of.
- Generalisation: if you apply FIELD_GUIDE 3b's re-validation lesson to a recipe, check
  whether the recipe can now still do its job with the connectors it declares. Several of
  the drafts cannot.

## 10:27 - PATTERN - use subagents for the web research and the shared search budget stops mattering
- Lane-09 hit "this session has used its web search budget (200 of 200)" mid-lane. I ran my
  whole lane's research as five parallel research subagents, one per thematic cluster rather
  than one per recipe, and each returned a distilled brief with sources and evidence-strength
  flags. Their searches did not come out of my session's budget, the briefs cost me a few
  thousand tokens instead of forty, and clustering meant one brief served four recipes. If
  you are dry, this is a way back in.

## 11:05 - PATTERN - the third finding nobody produces unaided: ABSENCE
- Reflexion models (Murphy, Notkin and Sullivan) give a three way vocabulary for comparing
  an expectation against a system: convergence (the expected thing is there), divergence
  (something unexpected is there), and ABSENCE (the expected thing is not there). Any agent
  reporting on what it read produces the first two for free and structurally cannot produce
  the third, because it reports what it saw.
- Every one of my judgment recipes got better by forcing the third: an architecture verdict
  must say what the idea assumes exists and does not; a feasibility record must say what it
  failed to establish, from a fixed list rather than by feel; a link watcher must say a
  decision has no implementing change and separately that some decisions leave no trace by
  nature. If your recipe compares anything against anything, ask whether it can report a gap.

## 11:07 - PATTERN - two dates, and only one of them means anything
- Reusable in any lane with a document, runbook, policy, procedure or knowledge recipe, and
  it pairs with lane-10's note on which of two contradicting documents is current. Keep LAST
  EDITED and LAST CONFIRMED TO WORK as separate facts. The first is what every store gives
  you for free and it says an entry is recent, not that it is right: a typo fix beats an
  untouched but wrong procedure on recency. The second only exists if something records the
  act of checking, and where it does not exist, the honest first proposal a recipe can make
  is to add it.
- The companion, from design system audit practice: low usage opens a question and never
  closes one. Retiring what nothing calls removes the entry covering the rare situation
  first, because being rarely needed is exactly what a rare situation looks like from a
  count. Retire in two stages and let what is still reaching for it decide the second.
