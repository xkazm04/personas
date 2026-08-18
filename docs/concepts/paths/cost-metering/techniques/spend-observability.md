---
layer: technique
subject: cost-metering
technique: spend-observability
status: forged
laws: [count-carries-predicate, derivation-names-recomputation]
shared_with: []
---

# Spend observability

The ledger records; observability makes the record *legible while it can
still change behavior*. The bar is concrete: an operator glancing at the
spend surface should notice, within a day, the anomaly that would otherwise
surface as a line item thirty days later — the retry loop that started
burning money on Tuesday, the new model that priced at the conservative
default all week, the one conversation turn that cost seven times the
entire nightly maintenance sweep. Spend anomalies are almost always visible
in the ledger the day they begin; observability's job is making sure
someone was looking.

## The reading order: total → class → axis → row

A spend surface answers questions in descending altitude, and each level
exists to make the next one worth opening:

- **The period total against its ceiling** — the number and its budget,
  with the period window printed beside it (the window travels with the
  total, per [usage-ledgers](usage-ledgers.md); a surface that re-derives
  its own month will eventually contradict the enforcer on the same
  screen).
- **Per-class rollups** — interactive vs unattended vs batch, side by
  side. The classes have different owners and different "normal", so a
  combined curve hides exactly the divergence that matters: unattended
  spend doubling while interactive halves nets to a flat line.
- **Per-axis breakdowns** — by actor, feature, model, from
  [spend-attribution](spend-attribution.md)'s keys, each summing to the
  total with the unattributed bucket shown.
- **Row-level drill-down** — every displayed slice explodes into the
  ledger rows composing it. This is the level that answers "*why* was
  Tuesday expensive", and a surface without it produces investigations
  that end at a bar chart.

Time-series mechanics — bucketing, window echoing, comparison honesty —
are [metrics-rollups](../../metrics-rollups/metrics-rollups.md)'
techniques and apply here unmodified; spend series earn no exemption from
partial-bucket marking just because the units are currency.

## The anomalies the surface must not hide

Averages are where spend anomalies go to die. A mean cost-per-call stays
flat while one call class quietly turns pathological. The surface commits
to showing:

- **Outlier calls, individually.** A most-expensive-calls view for the
  period, because unit economics are learned from extremes: the
  seven-times-the-maintenance-sweep turn is invisible in every aggregate
  and obvious in a top-10 list.
- **Failed-call spend as its own series.** Money spent on calls that
  produced nothing, broken down by failure reason — the incident
  signature detector from [usage-ledgers](usage-ledgers.md), rendered.
  Rising failed-spend with flat total spend is an efficiency fire that a
  total-only view reports as calm.
- **Rate as well as level.** A period total mid-month is on pace or off
  pace; the surface projects the period at current run rate against the
  ceiling, labeled as a projection with its assumption stated —
  [a number carries its predicate](../../_laws.md#count-carries-predicate),
  and "projected" is part of the predicate.
- **Spend that should not exist.** Actors past their ceiling (enforcement
  gap), spend attributed to disabled features, activity in a class that
  is supposed to be off. The dashboard is the audit the gates get for
  free.

## The system watches itself

The metering pipeline has failure modes of its own, and its instruments
belong on the same surface as the spend they qualify — a reader deciding
whether to trust the numbers needs the caveats adjacent, not in a runbook:

- **Default-priced share** — what fraction of the period's cost came from
  the price table's unknown-model default ([price-tables](price-tables.md)).
  High share means the total is an upper bound wearing a number's
  confidence.
- **Estimate-vs-actual drift** — the calibration gap from
  [preflight-estimation](preflight-estimation.md), because gates run on
  estimates and a drifting estimator degrades every gate silently.
- **Unattributed share** — the chokepoint-bypass alarm from
  [spend-attribution](spend-attribution.md).
- **Refusal counts** — blocked calls per scope from
  [budget-enforcement](budget-enforcement.md); the difference between "the
  ceiling is working" and "the ceiling is strangling something" is legible
  only if refusals are drawn.
- **Unmetered windows** — fail-open passes during ledger outages, sized
  and shown, so a suspiciously cheap Tuesday is explicable.

## Derived surfaces name their source

Every number on the spend surface is a derivation over ledger rows, and
[a stored derivation names its recomputation](../../_laws.md#derivation-names-recomputation):
cached rollups, materialized summaries, and the dashboard's own snapshots
all trace to the query that rebuilds them from the ledger. When the
dashboard and the ledger disagree, the ledger wins and the derivation is
rebuilt — a spend surface that can drift from its own ground truth without
an arbiter converts every discrepancy into a credibility argument. The
same discipline covers freshness: a cached spend figure displays its age,
because "current spend" that is forty minutes old is a different claim
from live, and next to a hard ceiling the difference is an overdraft.

## Smells

- A single all-classes spend curve as the only view.
- No way to get from a bar on the chart to the calls underneath it.
- Mean cost-per-call as the headline efficiency metric, no outlier view.
- A dashboard total that disagrees with the enforcement path's total
  (independent period math or a stale derived copy, unnamed).
- Failed-call spend folded invisibly into totals.
- The pipeline's own health — default-priced share, unattributed share,
  estimator drift — reported nowhere the spend reader will see it.
