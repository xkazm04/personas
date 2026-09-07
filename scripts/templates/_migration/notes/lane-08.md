# Notes - lane-08

Finance and accounting, plus operations and logistics (10 recipes)

Append below. Newest last. See ../FIELD_GUIDE.md section 6 for the format.


## 10:20 - RESEARCH - "definition drift" is the failure mode behind most recurring-report recipes
- Cloud providers serve several different cost figures (what was invoiced, versus what a
  commitment actually covers spread over the hours it covers). Both are defensible; the
  damage is a series that silently switches between them, because then every delta measures
  the definition changing rather than the world. The fix that made three of my recipes
  sharper: the report NAMES the basis it was built on, and a change of basis is stated in
  the first report that uses the new one.
- This generalizes past cloud cost to anything a recurring recipe reports: a metric with
  two defensible definitions, a percentile over a changed window, a "user" that got
  redefined. If your recipe compares periods, add a criterion that the two periods measured
  the same thing.

## 10:22 - RESEARCH - attribution has a ceiling, and reporting the ceiling is the finding
- FinOps practice: untagged resources are 20-40% of the bill in immature environments, and
  coverage above 90% is the bar before anyone charges costs back. So a report claiming "every
  rise is attributable" over a bill that is a third unlabelled is claiming more than it knows.
- The rewrite: the share that could NOT be attributed is reported as a figure every period,
  and a growing share is itself a finding. This turns a wish into a measurement and it is the
  same move for any recipe that says it explains, categorises or routes: report the residual.
- Also useful: a growing bill is only an anomaly against the business volume behind it (FinOps
  unit economics). A threshold on a total alerts on growth. Ask the adopter for a volume unit,
  and say plainly what the recipe can and cannot claim when they have none.

## 10:24 - DECISION - two recipes, one connector, two DIFFERENT examples files
- Three of my recipes bind the same connector type and two of them name the same two
  connectors. Writing one examples file and copying it would have satisfied the gate and been
  exactly the "file that restates the recipe" the field guide warns about.
- What worked: each examples/<connector>.md is written about THAT RECIPE'S concern on that
  connector. The alerting recipe's file is the provider's failure modes; the reporting
  recipe's file is the provider's cost-basis and grouping decisions. Same connector, no
  overlapping sentences, and each still stops applying if you swap the connector.

## 11:05 - RESEARCH - "calibration" and "accuracy" are different things, and drafts confuse them
- Any recipe that scores, ranks or predicts and then claims to improve itself is probably
  measuring the wrong thing. Accuracy, precision and recall ask how many calls were right.
  Calibration asks whether things scored at 40 percent happen about 40 percent of the time,
  and a model can be accurate and badly calibrated or the reverse. The practice has proper
  names (Brier score, expected calibration error, a reliability plot by score band) but a
  recipe only needs the shape: group by the score that was given, compare against what
  actually happened in that group.
- Two consequences worth stealing. **A prediction has to be written down with a horizon
  before its outcome is known**, or "how did we do" is unanswerable and every score is
  eventually right. **Where the thing being predicted is rare and the population is small,
  one period's hit rate is noise**, so the recipe should refuse to retune below a stated
  number of resolved outcomes and say it refused. "Recording a zero is the work" applied to
  a learning loop.

## 11:07 - RESEARCH - agreement between correlated measurements is not confirmation
- From technical-analysis practice, but it is a general reasoning trap: when several
  indicators are computed from the same underlying series, their agreement restates one
  number several times, and the reader experiences the redundancy as conviction. That is
  worse than a single reading, because it carries false weight.
- Useful anywhere a recipe combines signals into a composite: a health score, a lead score,
  a risk score, a "three sources agree" rule. The enrichment that worked was to make the
  recipe hold an explicit list of which inputs share a source, count them once, and say in
  the output when the apparent confluence was redundant. Nothing else in the recipe changes.

## 11:09 - PATTERN - the advice boundary belongs in ONE outcome and ONE guidance clause
- Concurring with lane-09, with the criteria shape that worked on three finance recipes.
  The outcome statement is a claim about the world ("The reader is never left believing this
  report gave them a head start it cannot give"), and its criteria are checkable properties
  of the output rather than warnings: every item carries how old the information was when it
  became available; nothing states a position size, a price target or a timing judgment;
  the work is described as surfacing a record rather than recommending an action.
- Then exactly one guidance clause, six words at the end: "This surfaces a public record; it
  does not advise." A recipe that repeats the boundary in four places reads as a disclaimer
  and stops being craft knowledge.

## 11:11 - TRAP - the full id-collision census: 5 ids shared by 11 recipes
- Lanes 04 and 10 each found one collision. Walking all 102 recipe.json files now on disk
  gives the complete list, since the gate does not check id uniqueness and these will land:
  `uc_daily_digest` (support-escalation-pattern-review, support-issue-disposition-account),
  `uc_weekly_digest` (data-assistant-quality-review-from-real-traffic, database-activity-digest),
  `uc_weekly_report` (conversion-experiment-program-digest, web-content-performance-review),
  `uc_intake` (form-lead-intake-and-scoring, incident-capture-and-classification),
  `uc_triage` (harvested-idea-triage, scouted-opportunity-triage, work-candidate-triage-gate).
- 96 distinct ids across 102 recipes. Nobody should invent replacements; this is a director
  decision. Re-run the walk at the end, since six recipes are still outstanding.
