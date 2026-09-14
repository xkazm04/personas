# Notes - lane-04

Sales and marketing: web analytics and conversion optimization (10 recipes)

Append below. Newest last. See ../FIELD_GUIDE.md section 6 for the format.


## 09:01 - GATE - the gate is red for everyone all migration long; grep your own paths
- `check-recipes.mjs` checks the WHOLE lane, so every other agent's freshly scaffolded
  `use_cases: []` shows up as a FAILED line in your run. Do not chase them.
  Filter to your own topics: `... | grep -E "<your-topic-1>|<your-topic-2>|^recipes lane"`.
  If that prints only the two summary lines, your work is green.

## 09:02 - TRAP - two recipes in the bundle share one `id`
- `web-content-performance-review` and `conversion-experiment-program-digest` both carry
  `"id": "uc_weekly_report"`, and neither is a uuid despite the spec calling the field
  "stable uuid, unchanged from v2". The gate does not check id uniqueness. I left both
  as they are (do not invent an id), but if a lane later builds anything keyed on `id`,
  it will collide. Worth the director knowing.

## 09:03 - DECISION - drop an `examples[]` entry you cannot say anything specific about
- Several drafts carry two example connectors where only one is a connector you can write
  real mapping knowledge for. The field guide is explicit that a file restating the recipe
  is worse than no file. I dropped the second entry and moved its one real insight (which
  side of the pairing is the harder binding) into `personalization_needs`, where it is
  connector-independent and therefore actually belongs.

## 09:04 - PATTERN - the draft knobs often encode the failure the recipe is about
- Three of my drafts carried `anomaly_threshold_percent: 25` or `significance_threshold:
  0.05` in `input_schema`, i.e. the exact statistical mistake the enriched recipe now
  argues against. `input_schema` is authored, not sacred. Reshape a knob when the
  research says the quantity it exposes is the wrong quantity, and say why in its
  `description` so an adopter reading only the knob still gets the judgment.

## 09:17 - RESEARCH - peeking numbers, usable by ANY recipe that watches a metric to a threshold
- Evan Miller, "How Not To Run An A/B Test": monitoring continuously and stopping the
  first time a nominal 5% test goes significant gives an actual false positive rate around
  **26%**. Peek ten times and what you read as 1% is really 5%. The remedies are a horizon
  fixed before the data is seen, predetermined checkpoints with spent alpha, or a statistic
  that stays valid under repeated looking.
- Why this is not just my lane: **`self_paced` means "look whenever data arrives", which is
  peeking by construction.** Any recipe whose trigger is self_paced AND whose verdict is
  "value crossed threshold" has this bug. The honest fix that fits a recipe: a look before
  the horizon reports progress and says nothing about the effect, or the statistic used is
  one that survives looking, and the recipe says which.
- The companion arithmetic, worth quoting because it decides feasibility: n is about
  16 x sigma^2 / delta^2 per arm. At a 3% baseline chasing a 10% relative lift that is
  ~52,000 exposures per arm; halving the target effect quadruples it. Most small sites
  cannot reach a horizon at all, and saying so early IS the verdict.

## 09:17 - DECISION - visibility takes `time`; a finding takes `self_paced`
- `conversion-experiment-program-digest` shipped a draft whose outcome was "the briefing
  goes out even when there is nothing to report" and whose trigger was `self_paced` with
  the rationale "worth composing when the program has moved". Those contradict: pace a
  digest on eventfulness and a quiet period produces nothing, so silence means both a calm
  program and a dead one. I changed it to `time`.
- The discriminator, which I think holds corpus-wide: if the recipe's value is that
  somebody can rely on hearing from it, the trigger is `time`. If the value is that it only
  speaks when it found something, the trigger is `self_paced` and the recipe owes a durable
  record of the quiet runs instead. Check your digests and reports against this.

## 09:17 - PATTERN - when the number the operator wants is unobservable, report the observable one and name the test
- My cannibalization draft promised "the money each overlapping keyword is wasting". That
  number is a counterfactual: two large studies on the same question disagree across the
  whole range (Google's paused-account modelling puts 89% of paid clicks as incremental;
  eBay's randomized field experiment found brand-keyword ads had no measurable benefit at
  all). Nothing in either dashboard can settle it, because both listings compete for the
  same session and whichever was clicked takes the credit.
- The rewrite that worked and generalizes: report the quantity that IS observable (spend at
  risk, read from the source), refuse to state the one that is not, and make the deliverable
  a ranked set of candidates each naming the test that would settle it. It turns a plausible
  fiction into a work queue. Reusable anywhere a draft promises a saving, an impact or an
  attribution that only an experiment could produce.

## 09:17 - DECISION - a URL list in `input_schema` is a binding, same as a channel
- Extending lane-10's "drop binding-shaped knobs": three of my drafts carry `target_pages`
  ("comma-separated URL paths"), `target_url` and `competitor_urls`. A URL names one
  installation's property exactly as much as `digest_channel: "#alerts"` does. I moved them
  into `personalization_needs`, which is the field whose definition is literally "what
  adoption must learn from the adopter, and why", and kept only judgment knobs (a cap, a
  window, a detectable effect).
- The tell: if two adopters of the same recipe must put different text in the box, and the
  box takes a name rather than a number, it is a binding.

## 09:20 - RESEARCH - Core Web Vitals, verified, and the general rule it gives you for free
- Fetched from web.dev/articles/vitals, so these figures are checked: LCP good at 2.5s or
  less, INP at 200ms or less, CLS at 0.1 or less. All three are **field** metrics assessed
  **at the 75th percentile of page loads, segmented across mobile and desktop**. INP
  replaced FID (stable in 2024) and **cannot be measured in a lab at all**, because it needs
  a real interaction; TBT is only a proxy for it.
- The reusable part, which is field guide 3b's "a reading in one environment is not a claim
  about another" with a concrete anchor: the threshold is defined over a distribution of
  real visits, so a single synthetic fetch cannot be compared to it even when the number
  looks the same. Any recipe that audits, scores or gates on a performance number should
  say which of its readings are claims about users and which are not.

## 09:20 - PATTERN - a program digest should report the program's own base rate, not only its results
- `conversion-experiment-program-digest` reported wins, in-flight items and inconclusive
  archives. What it could not do was notice that a program reporting a win almost every time
  is reporting its stopping rule rather than its ideas: large published experimentation
  programs land somewhere between roughly one in ten and one in three experiments producing a
  real positive, so a much higher rate is a defect signal.
- Generalizes to any digest, scorecard or review recipe: alongside the items, carry **the
  rates the process runs at** (how many reached a verdict, how many were abandoned, what
  share were called successes) and make an implausible rate a reportable finding. It is the
  cheapest self-check a reporting recipe can carry, and it costs one criterion.
