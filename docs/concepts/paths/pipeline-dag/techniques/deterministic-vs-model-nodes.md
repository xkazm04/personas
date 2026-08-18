---
layer: technique
subject: pipeline-dag
technique: deterministic-vs-model-nodes
status: forged
laws:
  - identity-survives-reuse
  - failure-not-empty-success
shared_with: []
---

# Deterministic vs model nodes

A modern pipeline mixes nodes with fundamentally different physics: a
deterministic transform that maps the same input to the same output forever;
a command that touches state and may or may not be repeatable; and a
model-backed node whose every invocation is a fresh sample from a
distribution — nondeterministic by nature, priced per attempt, and capable
of returning output that is fluent, well-formatted, and wrong. An engine
that applies one retry-and-trust policy across these classes is guaranteed
to mistreat at least one of them. The technique: **every node class declares
its determinism and effect contract, and the engine's retry, recovery, and
validation behavior derives from the declaration** — never from a global
default.

## The contract axes

Two independent axes, declared per node class (and refinable per node):

- **Determinism** — same inputs, same output? *Deterministic* (pure
  transforms, template rendering), *environmental* (reads something that
  changes: a query, a fetch), or *sampled* (model calls: a new draw every
  time, even at fixed inputs).
- **Effect** — what does running it change? *Pure* (nothing), *idempotent
  effect* (converges: "ensure state S", keyed upserts), or *non-idempotent
  effect* (accumulates: send, post, charge, deploy — the class where a
  duplicate is an incident, treated fully in
  [external-adapter-nodes](external-adapter-nodes.md)).

These four words per node class replace a thousand lines of special-casing:
the recovery sweep, the retry wrapper, and the output pipeline all branch on
the declaration.

## Retry derives from the contract

Which errors are worth retrying at all is the classification discipline of
[retry-backoff](../../retry-backoff/techniques/error-classification-for-retry.md);
this technique owns what the node class adds on top:

- **Pure/deterministic**: retry freely on transient failure — but a
  *deterministic* failure (same input, same crash) will not improve on
  attempt three; classify and stop early.
- **Idempotent effect**: retry freely by design — that is what the
  idempotency was bought for. The recovery sweep may re-run an interrupted
  attempt without adjudication.
- **Non-idempotent effect**: retry only when the previous attempt's fate is
  *known* to be no-effect (the request never left, the remote refused before
  acting). An attempt that vanished mid-flight — crash, timeout, dropped
  connection — has *unknown* fate, and unknown is not "failed": blind retry
  is how one purchase becomes three. These nodes surface as
  interrupted-needs-adjudication rather than auto-retrying
  ([failure-not-empty-success](../../_laws.md#failure-not-empty-success)
  applied to attempt outcomes: unknown, failed, and succeeded are three
  states, not two).
- **Sampled (model) nodes**: a retry is not a repeat — it is a *new sample*.
  That is sometimes exactly right (a transient provider error, a malformed
  output worth one more draw) and sometimes a silent semantics change (the
  "same" node produced two different answers and downstream consumed the
  second without anyone deciding that). Retries of sampled nodes are
  therefore bounded tightly, budgeted in money as well as count — each
  attempt bills — and *recorded as distinct attempts with distinct outputs*
  ([identity-survives-reuse](../../_laws.md#identity-survives-reuse): the
  attempt identity is what keeps two samples from masquerading as one
  result). The recovery sweep never silently re-runs an interrupted sampled
  node whose attempt may have completed remotely; that is both a double
  charge and a fork in the run's history.

## Model output is untrusted until validated

A deterministic node's output shape is guaranteed by its code. A model
node's output shape is a *request*, honored most of the time. The boundary
between a sampled node and its downstream consumers therefore carries a
validation step as part of the node itself: parse into the declared output
schema, check the invariants that matter, and on failure treat the attempt
as failed-with-recorded-output — eligible for a bounded re-sample with the
defect fed back, then terminal failure. What may never happen is raw model
text flowing into a downstream command node's configuration unparsed; the
graph's type discipline is only as strong as its least validated boundary.
(The full parse-repair-reject loop is the structured-output subject's
territory; a pipeline engine consumes that discipline at every sampled
node's exit.)

## Heterogeneous output passing

Nodes exchange data through persisted, declared-shape outputs (the store-
then-read rule of [node-execution-model](node-execution-model.md)), and the
class boundary adds one rule in each direction. **Into** a sampled node:
inputs are assembled explicitly from named upstream outputs — selected,
bounded, and recorded — not "everything upstream", because context assembled
by accretion is both a cost multiplier and a nondeterminism amplifier.
**Out of** a sampled node: downstream consumers bind to the validated,
schema-shaped projection, never to the raw text, so that re-samples and
model substitutions change only what the schema permits to change.

## Decision rules

- The contract is declared where the node class is registered — one
  authority the executor, recovery sweep, and cost meter all read; a class
  with no declaration is treated as sampled + non-idempotent (the paranoid
  corner), not as pure.
- Per-run spend budget for sampled nodes, enforced at dispatch: a retry
  loop around a model node is a spend loop, and the budget converts a
  pathological graph from a bill into an error.
- Fixed seeds / pinned parameters where the platform offers them make a
  sampled node *more* repeatable, not deterministic; the declaration stays
  sampled, because the guarantee is what recovery relies on.
- When a re-sample succeeds after failed attempts, prior attempts' outputs
  remain in the record — the run's history is what happened, not what
  finally worked.
