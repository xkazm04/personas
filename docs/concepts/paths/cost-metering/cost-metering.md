---
layer: golden-path
subject: cost-metering
status: forged
techniques:
  - price-tables
  - preflight-estimation
  - usage-ledgers
  - budget-enforcement
  - spend-attribution
  - spend-observability
evidence:
  - src-tauri/src/companion/turn_ledger.rs                              # per-turn ledger incl. FAILED turns: is_error = CLI-reported OR died-before-report, low-cardinality error_reason taxonomy, one construction site for failure rows, unknown cost stays NULL rather than blocking the row
  - src-tauri/db/src/repos/llm_spend.rs                                 # second spend class (headless dev_llm_spend), same wire parsing; write-time SpendCtx carries source/trigger/model/persona/project axes; group-by COALESCEs NULL model into a visible '(unknown)' bucket
  - src-tauri/db/src/repos/execution/executions.rs                      # MONTHLY_SPEND_PREDICATE — ONE shared verbatim predicate (status set, UTC start-of-month, ops-chat exclusion) for the gate that blocks runs AND the budget UI feed; cancelled rows count because they may have consumed credits
  - src-tauri/src/commands/communication/observability/metrics.rs       # MonthlySpendResult returns period_start_utc WITH the items — the period travels with the totals; boundary deliberately UTC to match the gate's predicate, caller's utc offset intentionally ignored
  - src-tauri/src/engine/background.rs                                  # scheduled-trigger budget gate mirrors the manual gate's exact semantics (0.0 = unlimited); a budget skip advances the pointer but preserves the fired-watermark
  - src-tauri/src/commands/execution/executions.rs                      # manual/API enforcement point: same get_monthly_spend, refusal names persona, spend, and limit
  - src-tauri/engine/src/cost.rs                                        # preflight estimation: chars-per-token ratio, per-family direction-split rates, documented non-zero default for unknown models; preview returns estimate + monthly spend + ceiling in one structure
  - src-tauri/core/src/run_budget.rs                                    # run-scope aggregate ceiling across fan-out spawns; launch-gate (not mid-flight kill) semantics stated in the header; enforce-mode explicit and captured at persist time
  - src-tauri/db/src/repos/run_budget.rs                                # run budget persisted at finalize so cost trends survive restarts, keyed by run identity
  - src/stores/slices/agents/budgetEnforcementSlice.ts                  # ceilings client-side: fail-closed on stale/missing data, TTL declared, invalidation marks stale until refetch lands, explicit session-scoped user overrides
  - src-tauri/src/commands/infrastructure/tier_usage.rs                 # tier config as limit authority; TTL-cached snapshot (3s) with approaching-limit flag
  - src/features/overview/sub_activity/libs/useLlmSpend.ts              # spend-class dashboard consumer keyed to the shared day-range filter
counter_evidence:
  - src-tauri/engine/src/cost.rs                                        # same file, other face: the table is undated/unversioned, has no cached-input unit classes, and its unknown-model default is silently mid-tier and uncounted — documented, but neither conservative nor observable
deviations:
  - w8-cost-metering   # anchor in docs/concepts/golden-path-deferred-fixes.md
  - w1-streaming-output   # token counts structurally zero on execution rows — fixture-certified dead field; the attribution axes exist but the units never arrive
  - w4-prompt-assembly    # input_tokens never persisted for persona prompts while the companion class persists per-block sizes + hashes — two spend classes, unequal evidentiary standards
---

# Cost metering & budgets

Somewhere in the product, some calls cost money. Not "cost" in the engineering
sense of latency or compute — cost in the invoice sense: a metered external
service charges per unit consumed, the units accumulate silently, and at the
end of the month somebody real pays a number that the product either predicted
or did not. Token-metered model inference is the canonical case and the
expensive one, but the subject is the same for any per-unit metered
dependency: transcription minutes, image generations, message deliveries,
storage egress.

This subject owns the money: the **price table** that converts usage units
into currency, the **ledger** that records what was actually consumed, the
**attribution** that says who consumed it and why, and the **budget** that
stops consumption before it exceeds what anyone agreed to pay. Adjacent
subjects own adjacent things: model-routing owns *which* provider or model
serves a call — this subject prices whatever routing chose, and hands routing
the per-unit price signal it needs to choose well;
[scoring-rubrics](../scoring-rubrics/scoring-rubrics.md) owns composite
scoring math; [metrics-rollups](../metrics-rollups/metrics-rollups.md) owns
folding spend rows into time series — but the *billing-period boundary* is
ours, because "what month is this charge in" is a money predicate, not an
aggregation convenience.

The failure mode that defines the subject: **spend is invisible by default.**
A metered call returns its result identically whether it cost a rounding
error or a week of budget. Nothing in the call path forces anyone to look at
the price. Every discipline below exists to defeat that one property —
because the natural state of a product that never built this subject is a
surprising invoice, no ability to say which feature caused it, and a
retroactive attribution project that cannot succeed (the data needed was
never written).

## A ledger, not a log

The first structural decision: usage records are **ledger rows, not log
lines**. The distinction is contractual, not aesthetic. Telemetry is
best-effort — sampled, droppable, truncatable, deletable on a retention
schedule — because its consumers tolerate gaps. A spend record's consumers
are budget enforcement and an eventual reconciliation against a real invoice,
and neither tolerates gaps: a dropped row is unmetered spend, which means a
budget that enforces against an undercount and an invoice that cannot be
explained. So the write is part of the call path's contract: it sits in the
call's completion path on every branch, and rows live on the product's
transactional retention terms, not telemetry's.

One policy question inside that contract is legitimately two-sided: does a
*failed ledger write* fail the call? Blocking says no call goes unmetered;
best-effort says accounting must never break the thing it accounts for, and
accepts that the ledger becomes a known lower bound. Both stances are
principled. What is never acceptable is the third, accidental stance: a
write failure that is swallowed uncounted, leaving a ledger that *claims*
completeness it no longer has. Choose per spend class, say which you chose,
and count every dropped write. Ledger structure — one ledger per spend
class, per-call rows, what a row must carry — is the
[usage-ledgers](techniques/usage-ledgers.md) technique.

## Failures are spend

The single most common metering defect: recording usage only on success. A
call that timed out after the provider processed the input, a call that
returned malformed output and was discarded, a call that was cancelled
mid-stream — all of these **consumed metered units**, and the provider will
bill them. A ledger that only records successes systematically underbills
reality, and it underbills worst exactly when things go wrong: an incident
that produces a retry storm is an incident whose cost the ledger cannot see.
The rule is absolute: **every call that reached the provider gets a row**,
success or failure, with the failure reason on the row — because "we spent
this much on calls that returned nothing" is one of the most actionable
numbers the subject produces. This is
[failure spelled differently from empty success](../_laws.md#failure-not-empty-success)
applied to money: a period with no spend and a period whose spend failed to
record must be distinguishable.

## The price table is versioned data with a loud default

Converting units to currency requires a price table: per-model, per-provider,
per-direction rates (input units and output units are almost always priced
differently, often by an order of magnitude). Three properties are
non-negotiable, and all three are violated constantly in the wild:

- **It is data, not scattered constants.** One authoritative table, consulted
  by everything that prices — the estimator, the ledger writer, the
  dashboard. Two price tables are
  [two authorities for one vocabulary](../_laws.md#one-authority-per-vocabulary),
  and they drift the day a provider changes a rate.
- **It is versioned.** Providers reprice. A ledger row costed at write time
  must remain explicable after the table changes, which means the row records
  what it was costed *with* — or the stored cost
  [names no recomputation](../_laws.md#derivation-names-recomputation) and
  becomes an orphan number the next repricing strands.
- **An unknown model costs something declared, never zero.** New models
  appear faster than tables update. A lookup miss that prices at zero makes
  the newest — typically the most expensive — model invisible to budgets and
  dashboards alike. The default is documented, deliberately conservative,
  and its use is *counted*, so table staleness is a visible metric rather
  than silent undercounting.

One authority question sits above the table itself: **when the provider's
own meter reports a per-call cost, that figure is the bill, and the ledger
records it verbatim.** Metered services increasingly price by unit classes
a local table cannot see — cached-context tiers, batch discounts,
multi-round internal turns — and a local units-times-rate reconstruction of
such a call can miss the real figure by an order of magnitude while looking
perfectly reasonable. The table's jobs are estimation before the call and
sanity-bounding after it; it is not a substitute for the meter's reading.
Rates, versioning, unit classes, and the default discipline are the
[price-tables](techniques/price-tables.md) technique.

## Estimate before, measure after, track the gap

A budget that can only react to spend already incurred is a smoke alarm that
rings after the house has burned. Metered calls have a useful property:
consumption is roughly predictable from the input — unit counts can be
estimated before the call is made. That enables **preflight gating**: compute
an estimate, check it against the remaining budget, and refuse the call
*before* the money is spent. The estimate is honest about being an estimate —
it is compared against the measured actual on every call, and the running
estimate-vs-actual gap is itself a monitored number, because an estimator
that drifts silently turns the preflight gate into theater. Estimation
mechanics and gating semantics are the
[preflight-estimation](techniques/preflight-estimation.md) technique.

## Attribution is decided at write time

Every spend question that matters is an attribution question: which run,
which actor, which feature, which customer, which period. The structural
fact that shapes the whole subject: **attribution axes are captured when the
row is written or never.** A ledger row that recorded only "a call happened,
it cost this much" cannot be joined to the run that made it after the fact —
the context existed only in the call stack, and the call stack is gone. So
the row carries every axis anyone will ever group by, written from live
context at call time. What the axes are, how unattributable spend is handled
(a counted bucket, never a dropped row), and what rollup honesty requires
are the [spend-attribution](techniques/spend-attribution.md) technique.

## A ceiling nothing checks is a wish

Budgets are the subject's enforcement arm, and the test of a budget is
mechanical: **enumerate the enforcement points.** For every place the product
can initiate metered spend, name the line that consults the budget before the
call proceeds. If the enumeration has a gap — a background job, a retry path,
a secondary feature that calls the provider directly — the budget is a
dashboard number wearing a ceiling's clothes, and the gap is where the
overrun will come from, per
[a gate must see its target](../_laws.md#gate-sees-target). Enforcement
scopes (per run, per actor, per period), what a blocked call reports back,
cache invalidation when a ceiling changes, and the fail-open/fail-closed
decision when the ledger itself is unavailable are the
[budget-enforcement](techniques/budget-enforcement.md) technique.

## Periods have one owner

"This month's spend" sounds unambiguous and is not: calendar month or rolling
30 days, which timezone's midnight, inclusive of which endpoint. Any product
that computes the boundary in more than one place will eventually show two
surfaces disagreeing about what month it is — a budget that says the ceiling
is hit and a dashboard that says it is not, on the same screen. The
discipline: **the period boundary is computed in exactly one place, and every
result that is scoped to a period returns the boundary it used** — period
start and end travel *with* the totals, so a consumer renders the window it
was actually given instead of re-deriving its own. This is the money-side
instance of the effective-window contract that
[metrics-rollups](../metrics-rollups/metrics-rollups.md) enforces for
aggregation generally; here it additionally decides when ceilings reset,
which makes disagreement not just confusing but financially enforceable in
the wrong direction.

## Spend is a product surface, not a forensic archive

A ledger that is only ever read during an invoice dispute has failed at its
cheapest job: making cost anomalies visible while they are still small.
The observability layer — per-class rollups, per-feature breakdowns, the
"one interactive turn cost seven times the entire maintenance sweep" class
of insight — is what converts the ledger from a record of regret into an
input for decisions: routing cheaper, capping harder, caching more. What the
surfaces show and which anomalies they must make visible is the
[spend-observability](techniques/spend-observability.md) technique.

## What this subject refuses

- **Success-only metering.** A ledger without failed-call rows undercounts
  reality precisely when reality is most expensive.
- **A zero-cost default for unknown models.** Lookup misses price at the
  declared conservative default and increment a staleness counter — never at
  zero, never by dropping the row.
- **Retroactive attribution.** If the axis was not on the row at write time,
  the honest answer is "unattributed", not a heuristic join that manufactures
  confidence.
- **Advisory ceilings.** A budget whose enforcement points cannot be
  enumerated is a report, and gets labeled as one.
- **Per-consumer period math.** Any surface computing its own month boundary
  instead of consuming the one returned with the data.
- **Spend rows on telemetry retention.** Ledger rows live on the product's
  transactional retention terms; they are evidence, not exhaust.

## The techniques

- [price-tables](techniques/price-tables.md) — per-model, per-direction
  rates as versioned data; the loud conservative default for unknowns;
  repricing without stranding history.
- [preflight-estimation](techniques/preflight-estimation.md) — estimating
  consumption before the call, gating on the estimate, and monitoring
  estimate-vs-actual drift.
- [usage-ledgers](techniques/usage-ledgers.md) — one ledger per spend class;
  per-call rows including failures with reasons; the write as part of the
  call contract; period boundaries returned with results.
- [budget-enforcement](techniques/budget-enforcement.md) — ceilings per
  scope; enumerable enforcement points; what a blocked call reports;
  invalidation on ceiling change; fail-open vs fail-closed.
- [spend-attribution](techniques/spend-attribution.md) — multi-axis tagging
  at write time; the unattributed bucket as a counted first-class citizen;
  rollup honesty.
- [spend-observability](techniques/spend-observability.md) — per-class and
  per-axis surfaces; anomaly visibility; estimate-drift and
  table-staleness as monitored numbers.
