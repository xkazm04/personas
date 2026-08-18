---
layer: technique
subject: cost-metering
technique: usage-ledgers
status: forged
laws: [failure-not-empty-success, count-carries-predicate, creation-names-reaper]
shared_with: []
---

# Usage ledgers

The ledger is the subject's ground truth: one row per metered call, written
as part of the call's own contract, durable on the product's transactional
terms. Everything else in the subject is derived from it — budgets enforce
against its sums, dashboards fold it, estimators calibrate against it, and
when a real invoice arrives, the ledger is the only artifact that can
explain the number or dispute it.

## One ledger per spend class

Different kinds of spend answer different questions, and folding them into
one undifferentiated table forces every consumer to re-filter by fragile
convention. The clean structure: **a ledger per spend class** — interactive
conversation spend, unattended/background execution spend, embedding or
batch-processing spend — each with the row shape its class needs, plus a
common core (units, direction split, model identifier, cost, timestamp,
attribution axes). The split is by *who answers for the money*: interactive
spend is explained per conversation to a user; unattended spend is explained
per schedule to an operator; their ceilings, their periods, and their
dashboards differ. What must not differ is the pricing pipeline behind them
— one price table, one costing routine — or the classes drift into
incomparable currencies.

The class taxonomy itself is a closed vocabulary: new spend classes are
added deliberately, and a call that fits no class lands in a counted
catch-all rather than being shoehorned or dropped.

## The row: what write-time must capture

A ledger row is written once, at the only moment the full context exists.
The non-negotiable columns:

- **Raw units, direction-split** — input and output separately, because the
  price table prices them separately and a repricing audit needs them.
- **The concrete model identifier** as served (routing may have substituted;
  record what actually ran — the attribution fact, distinct from the priced
  family per [price-tables](price-tables.md)).
- **Cost and its provenance** — the derived currency amount plus rate or
  table-version, so the derivation survives repricing.
- **Attribution axes** — run, actor, feature, whatever the product will ever
  group by; the write-time-or-never argument is
  [spend-attribution](spend-attribution.md)'s.
- **Outcome** — success, or the failure class and reason. Never omitted.
- **Timestamp of the call**, which drives period assignment — not the
  timestamp of the write, which can lag on retried persistence.

## Failed calls are rows, not gaps

The defining discipline, stated in the golden path and enforced here: **a
call that reached the provider is a row regardless of outcome.** Timeouts
after processing began, malformed responses discarded by validation,
mid-stream cancellations, refusals — all consumed units the provider bills.
Three consequences follow:

- The row carries the **failure reason** as data, because "spend on calls
  that produced nothing" broken down by reason is the cheapest incident
  diagnostic the subject offers: a retry storm, a validation bug, and a
  provider outage each have a distinct signature in failed-call spend.
- Usage figures on a failed call may themselves be missing (the error
  arrived instead of the usage report). The row still exists — with
  estimated units marked as estimated, or null units and a counted
  "unmetered failure" flag. A null that means "failed to measure" must be
  distinguishable from a zero that means "measured nothing", per
  [failure is not empty success](../../_laws.md#failure-not-empty-success).
  And "unknown" must be expressible at **every hop** of the write path: a
  single non-optional money type in the middle of the pipeline converts
  unknown into a definite zero even when the storage on both sides could
  have said null — a killed call then books as *free* forever, and a
  ceiling can be approached but never crossed by exactly the calls that
  get killed.
- **The write path is failure-ordered:** the ledger write sits in the
  call's completion path on *both* branches — a structure like
  finally-semantics, not a success callback. A metering implementation is
  audited by reading its error paths, not its happy path.

## Periods travel with results

Ledger queries are almost always period-scoped — "this month's spend
against this ceiling" — and the period boundary is the subject's most
duplicated computation unless structurally prevented. The contract:

- **One function owns the boundary.** Month start, month end, timezone
  convention, endpoint inclusivity: computed in exactly one place that both
  the enforcement path and every reporting path call.
- **Results carry their window.** A period-scoped total returns period
  start and end *with* the sum. A consumer that receives `{total, from,
  to}` renders the window it was given; a consumer that receives a bare
  total re-derives the window and eventually disagrees with the enforcer —
  the sum without its window is
  [a count without its predicate](../../_laws.md#count-carries-predicate).
- **Assignment by call time.** A call made in the period belongs to the
  period even if its row persisted after the boundary; late writes reopen
  nothing, they land where the call time says.

Folding ledger rows into series and cross-period aggregates beyond the
single enforcement window is
[metrics-rollups](../../metrics-rollups/metrics-rollups.md)' subject; the
ledger's obligation ends at being foldable — raw, attributed, complete.

## Retention is a policy, not an accident

Ledger rows are financial evidence, retained on declared terms — long
enough to reconcile against provider invoices and to answer the "why was
last quarter expensive" question, with the eventual pruning or archival
path [named at creation](../../_laws.md#creation-names-reaper). What the
ledger must never inherit is telemetry retention: a sampling config or a
30-day auto-purge applied to spend rows silently converts the ground truth
into an estimate.

Two deletion rules follow from the ledger's consumers, and both are easy to
violate from outside the metering code entirely:

- **No pruning inside an enforced window.** A budget gate sums ledger rows;
  deleting rows a period-scoped ceiling still enforces over *silently
  refunds the budget* — the spend happened, the money is gone, and the gate
  re-admits new spend against the vacated sum. Retention horizons stay
  strictly longer than the longest enforcement period, with margin for
  reconciliation.
- **Spend records outlive their parents.** When usage rows hang off another
  entity (a run record, a conversation), deleting the parent must not
  delete — or orphan into invisibility — the spend. History cleanup is a
  legitimate product feature; a budget that history cleanup can reset is
  not a budget.

## Smells

- One `usage` table with a free-text `kind` column doing spend-class duty.
- A ledger write inside the success callback only.
- Rows with cost but no units, or units with no direction split.
- Zero-unit rows that might be measured zeros or might be unmeasured
  failures — no flag distinguishes them.
- Two "current month spend" figures on one screen disagreeing (two boundary
  computations).
- A period total returned as a bare number.
- A best-effort ledger write whose failures are swallowed uncounted — the
  availability trade may be right, but an uncounted drop makes the ledger
  claim a completeness it no longer has.
- A cancelled or killed call recorded with cost *zero* rather than cost
  *unknown* — the type had no way to say "unknown", so it lied in the
  cheap direction.
- Deleting run history visibly lowers the month's enforced spend.
