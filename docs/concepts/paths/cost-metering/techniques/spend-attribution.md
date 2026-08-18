---
layer: technique
subject: cost-metering
technique: spend-attribution
status: forged
laws: [count-carries-predicate, identity-survives-reuse]
shared_with: []
---

# Spend attribution

A total is a fact; an attributed total is a decision input. "We spent 900
units of currency this month" permits exactly one response — concern.
"Two-thirds of it was one feature's retry loop, and interactive chat was
flat" permits engineering. Attribution is what converts the ledger from an
invoice-shaped anxiety into a map of where the money goes, and its whole
difficulty lives in one asymmetry: **the axes are nearly free to capture at
write time and nearly impossible to reconstruct afterward.**

## The axes, decided before the first row

The product will eventually want spend grouped by:

- **Run** — the execution instance that made the call: which job, which
  conversation turn, which loop iteration. The finest audit grain: "why did
  this run cost 3.05 when its siblings cost 0.20" starts here.
- **Actor** — the agent, persona, automation identity, or human on whose
  behalf the call ran. The axis budgets bind to.
- **Feature / spend class** — the product capability that initiated it. The
  axis roadmap decisions read.
- **Model served** — the concrete identifier, which is also the pricing
  join key.
- **Period** — derived from call time via the boundary owner in
  [usage-ledgers](usage-ledgers.md), not stored as a redundant column that
  can disagree with the timestamp.
- **Tenant / customer**, the day the product is multi-tenant — the axis
  that turns metering into billing, and the most expensive one to discover
  missing.

The discipline is not that every product needs every axis; it is that the
set is **decided deliberately, before rows accumulate**, because the
millionth row costs the same to tag as the first and the first million
untagged rows are unattributable forever. When a new axis becomes needed,
its start date is declared and history before it reports as "before
attribution began" — an honest cohort, not a backfilled guess.

Axis values are identities, and
[identity must survive reuse](../../_laws.md#identity-survives-reuse): tag
rows with the run's minted id, not its display name; the actor's stable id,
not its current label. A renamed persona must not orphan its history, and
two actors sharing a display name must not merge theirs.

## Write-time capture, structurally

The context that fills the axes — which run, which actor, which feature —
exists in the call stack at the moment of the call and nowhere else
afterward. Two structures make capture reliable rather than disciplinary:

- **The metering chokepoint demands attribution.** The same single door
  that [budget-enforcement](budget-enforcement.md) gates through takes the
  attribution context as a required parameter — a call that cannot say who
  it is for does not compile, or fails loudly, rather than writing an
  anonymous row.
- **Context flows, it is not re-derived.** The run id is minted where the
  run starts and carried through every layer to the call site — not
  guessed at the bottom from thread-locals, timestamps, or "whatever run
  is probably active". Reconstruction heuristics produce attributions that
  are *mostly* right, which is worse than none: they survive review and
  poison the rollups.

## The unattributed bucket is counted, never hidden

Some spend will defeat attribution anyway — a migration script, a
forgotten maintenance path, a call from before an axis existed. The rule:
**unattributed is a first-class bucket with a visible count, never a
dropped row and never a default value that masquerades as data.** The
distinction between "attributed to the system actor" and "attribution
missing" must survive; folding unknowns into a real category corrupts that
category's trend. A healthy metering system watches the unattributed
percentage the way it watches error rate — rising unattributed spend means
a new call path bypassed the chokepoint, which is also
[budget-enforcement](budget-enforcement.md)'s enumeration alarm ringing
through a different instrument.

## Rollup honesty

Attribution rollups have two failure modes that both produce confident,
wrong charts:

- **Double counting across axes.** Axes overlap — a row belongs to a run
  *and* an actor *and* a feature. A rollup that sums per-feature totals
  and per-actor totals into one "breakdown" counts the money twice. Every
  rollup groups by one axis at a time (or by an explicit combination), and
  its parts sum to the ledger total — including the unattributed bucket.
  When the parts do not reach the total, the gap is *shown*, not
  proportionally redistributed.
- **The label without the predicate.** "Feature X: 214" means nothing
  without the period, the spend classes included, and whether failed-call
  spend is in — [the count carries its
  predicate](../../_laws.md#count-carries-predicate) or it will be quoted
  against a claim it does not support. The cross-check that keeps rollups
  honest is reconciliation downward: any displayed slice can be exploded
  back into the ledger rows that compose it.

Folding attributed rows into time series is
[metrics-rollups](../../metrics-rollups/metrics-rollups.md)' machinery;
this technique's contribution is that the group keys exist, are stable
identities, and sum to the whole.

## Smells

- A ledger schema whose only dimension is the model name.
- Attribution parameters that are optional-with-default at the chokepoint
  (the default becomes the majority category within a quarter).
- A run id column populated by parsing log context after the fact.
- Per-feature totals that sum to more — or mysteriously less — than the
  period total, with no unattributed line item.
- A breakdown chart with no period or spend-class annotation.
- History that silently re-attributes when an actor is renamed or a
  feature is re-mapped.
