---
layer: technique
subject: structured-output
technique: extraction-observability
status: forged
laws: [count-carries-predicate, failure-not-empty-success]
shared_with: []
---

# Extraction observability

An extraction pipeline degrades without crashing. Every failure is handled
"gracefully" — a retry here, a fallback there, an empty state rendered — so
the user experience decays from crisp to mushy with no stack trace marking
the day it started. The causes are all silent drifts: the prompt was edited,
the producer model was upgraded or re-tuned, the schema grew a field, a
strategy rung's assumption stopped holding. Observability is the pipeline's
own instrumentation for noticing, and it is **part of the pipeline's
contract, emitted at the pipeline's chokepoints** — the strategy ladder, the
validation door, the repair loop, the dispatcher — not a logging afterthought
sprinkled where someone remembered.

## The counters that matter

Per flow (the numbers mean nothing pooled across flows with different
prompts and schemas), each carrying its predicate
([count-carries-predicate](../../_laws.md#count-carries-predicate)):

- **Outcome distribution** — artifact / validated-empty / extraction-failed /
  turn-failed, per the golden path's closed outcome set. The single most
  important ratio is extraction-failed over attempts; the single most
  common instrumentation bug is a bucket that conflates extraction-failed
  with validated-empty, which hides exactly the drift this exists to catch
  ([failure-not-empty-success](../../_laws.md#failure-not-empty-success)).
- **Strategy fired** — which rung of the extraction ladder produced the
  candidate. This is the leading indicator, and its power is that it moves
  *before* the failure rate does: a flow that historically parsed clean at
  rung 1 and now routinely needs balanced-span detection at rung 3 has a
  producer or prompt that changed, weeks before rung 3 starts missing too.
- **Repair-loop depth** — the distribution of attempts-to-success (0, 1, 2,
  exhausted) and the top validation-error paths that triggered repair. The
  error paths are the diagnosis: one field path dominating the rejections
  is a sentence-sized prompt fix; a uniform spread is schema-prompt drift.
- **Unknown-op rate** — for op-grammar flows, proposals naming operations
  outside the allowlist, with samples. The menu and the model's beliefs
  have diverged, or something is injecting.
- **Candidate anomalies** — multi-candidate turns, recovered-partial
  acceptances, over-cap rejections. Each is a low-frequency event whose
  trend is the signal.

And on each: enough context to act — flow, schema version, prompt version,
producer identifier. A failure rate that cannot be split by "before or
after Tuesday's prompt edit" answers no question anyone will actually ask.

## Baselines and boundaries

The numbers only speak against a baseline, and the baseline resets at every
declared change: prompt edit, schema version, producer upgrade. Mark the
boundaries in the data (version tags on every event) so a step change is
attributable in one query. The two on-call questions this must answer
cheaply: *"did the upgrade change extraction behavior"* (compare
strategy-fired and outcome distributions across the boundary) and *"when
did this start"* (find the step in the time series and read the version
tags at the step).

Alerting is on **drift, not incidents**: a threshold on the failure ratio
over a rolling window, and — cheaper to keep honest — on the strategy
distribution shifting. There is rarely a page-worthy moment in extraction;
there is a Tuesday review where the chart bends.

## Samples, size-capped, on failure

Counters locate the problem in time; samples make it fixable. On
extraction-failed: retain the raw settled text (head and tail under a size
cap), the strategy trace, and the final error list — enough to replay the
candidate through the ladder in a test without re-running the producer.
Every retained failure is a fixture candidate for the ladder's regression
corpus; the observability store is the museum's acquisition pipeline.
Retention here respects the same trust posture as the rest of the system:
raw model output may embed user content, so failure samples inherit the
data-handling rules of the conversation they came from — capped, scoped,
and expiring, with the expiry named at write time.

## The meta-rule: instrument the door, not the callers

Every number above is emitted at a chokepoint that already exists because
the architecture demanded it — one ladder, one validation door, one
dispatch door, one finalization. That is not a coincidence; it is half the
argument *for* those chokepoints. Instrumentation spread across N call
sites undercounts by whichever sites forgot, and an undercount is worse
than no count — it is a confident wrong answer. If a number is hard to
collect, the pipeline has a door missing, and the fix is structural.
