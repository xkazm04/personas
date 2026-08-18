---
layer: technique
subject: cost-metering
technique: preflight-estimation
status: forged
laws: [gate-sees-target, count-carries-predicate]
shared_with: []
---

# Preflight estimation

Measured spend arrives after the money is gone. Estimation is the subject's
only forward-looking instrument: predict the units a call will consume
*before* making it, price the prediction, and let gates act on the
prediction. Done honestly, it converts budget enforcement from a post-mortem
into a turnstile. Done dishonestly — an estimator nobody validates — it
converts the turnstile into a prop.

## Estimating consumption from the input

For token-metered inference, the input side is largely knowable before the
call: the prompt exists in hand, and unit counts correlate strongly with
text length. The estimator layers by available fidelity:

- **Exact counting when the provider's tokenizer (or a faithful local
  equivalent) is available** — the input estimate becomes near-perfect.
- **Calibrated ratio otherwise** — characters-per-unit measured from the
  product's own ledger history, not a folk constant. Prose, source code, and
  structured data tokenize at meaningfully different densities; if the
  workload mixes them, either the ratio is calibrated per content class or
  the error bars widen and the gate margins widen with them.
- **The output side is the honest unknown.** Output length is the model's
  choice, bounded above by the configured output ceiling. A conservative
  estimator prices the output at its configured maximum; a calibrated one
  prices at a historical percentile *for that call class* — but either way
  the choice is declared, because "estimated cost" without the output
  assumption is [a count without its
  predicate](../../_laws.md#count-carries-predicate).

And one scoping correction that separates working estimators from decorative
ones: **estimate the call, not the string.** For agentic and multi-round
calls, the text the caller hands over is a fraction of what gets billed —
the provider replays accumulated context (often through cached-input tiers
with their own rates), the call loops internally, and tools inject content
the caller never saw. An estimator that prices the visible prompt of such a
call can understate the real consumption by orders of magnitude while being
perfectly accurate for single-shot calls. The estimator therefore models the
*call class* — single-shot, conversational, agentic-loop — with per-class
historical multipliers, or it declares that it only covers the single-shot
class and the gates on other classes are known to be blind.

The estimate that travels is a structure, not a scalar: input units, assumed
output units, the rate applied, the call class assumed, and the resulting
cost bound. A gate, a log line, and a user-facing "this will cost about…"
all consume the same structure rather than re-deriving their own.

## When estimates gate

The estimate's consumer hierarchy, cheapest honesty first:

- **Advisory** — show the predicted cost, proceed regardless. Right for
  interactive flows where a human is the budget authority and the number
  informs their next prompt.
- **Soft gate** — proceed, but flag when the estimate exceeds a threshold,
  so the anomaly is visible before the pattern repeats a thousand times in
  a batch.
- **Hard gate** — refuse the call when estimated cost exceeds remaining
  budget. Right for unattended execution: scheduled runs, autonomous loops,
  anything that can spend without a human watching. The refusal semantics
  belong to [budget-enforcement](budget-enforcement.md); this technique's
  obligation is that the number the gate reads is the estimate structure
  above, computed against the same price table the ledger will use — a gate
  reading a different table
  [is not seeing its target](../../_laws.md#gate-sees-target).

One asymmetry deserves respect: a hard gate on an *over*-estimate refuses
work that would have fit. That is the correct direction for unattended spend
(the cost of a false refusal is a retry after a human raises the ceiling;
the cost of a false pass is money), but it means gate thresholds carry the
estimator's error margin, and shaving that margin is what the calibration
loop below is *for*.

## The calibration loop: estimate-vs-actual is a monitored number

Every metered call eventually reports measured usage. The technique's
discipline is to close the loop on every call: store the estimate alongside
the actual (or at minimum the signed error), and watch the distribution.

- **Drift is silent by construction.** Nothing fails when the estimator
  degrades — calls still succeed, gates still "work". Only the tracked gap
  reveals that the characters-per-unit ratio slipped when the workload
  shifted, or that a new model tokenizes differently, or that the price
  tables forked (systematic one-model drift is the signature of a stale
  second table — see [price-tables](price-tables.md)).
- **The gap has a budget of its own.** A team decides what estimator error
  is acceptable (say, actuals within some band of estimates at some
  percentile) and alerts when the loop reports worse. An unvalidated
  estimator gating real spend is the subject's version of an untested
  backup.
- **Failed calls calibrate too.** A call that consumed input units and died
  before output still had an input estimate worth scoring — and failure-mode
  spend is exactly where estimation matters most, per the failure rules in
  [usage-ledgers](usage-ledgers.md).

## Smells

- An estimator constant (characters per unit, assumed output length) with no
  measurement behind it and no date on it.
- Estimates computed but never stored — the loop cannot close, so nobody can
  say whether the gate is honest.
- A hard gate consuming a scalar "estimated cost" whose output assumption
  and rate provenance are gone.
- Gate and ledger pricing from different tables.
- Estimation only on the happy path, while retries and continuation calls —
  the volume amplifiers — go ungated.
