---
layer: technique
subject: agent-chaining
technique: stop-reason-ledgers
status: forged
laws:
  - one-authority-per-vocabulary
  - failure-not-empty-success
  - count-carries-predicate
shared_with: []
---

# Stop-reason ledgers

Every chain ends, and in an event-wired system the end is structurally
invisible: no orchestrator reaches the bottom of a loop; the last event
simply has no consequence. Unless the system writes down *why* nothing
happened next, "the chain finished," "the chain was blocked," and "the
chain is broken" are all rendered identically — as silence. This
technique makes non-continuation a recorded event with a typed cause.

## The stop vocabulary is closed and owned

Stop reasons are a closed vocabulary with one authoritative definition
([one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary)),
because every consumer — the chain view, alerting, the cost rollup's
"final" flag, the user's own queries — keys on it. The load-bearing
distinctions the set must be able to spell:

- **Completed** — the link finished and no outgoing edges exist: the
  natural end of the drawn path. Success-shaped.
- **Condition not met** — outgoing edges exist, were evaluated, and none
  fired. Also success-shaped: the graph *chose* to stop. The verdicts are
  attached (see below).
- **Condition unevaluable** — an edge could not be evaluated; the chain
  fail-closed loudly (run-conditions, this subject). Error-shaped, and
  distinct from condition-not-met — collapsing these two is the ledger
  reproducing the exact lie the evaluator was built to refuse.
- **Guard tripped** — depth, revisit, or budget bound exceeded, with the
  bound and its value named (cycle-and-depth-guards, this subject).
- **Upstream failed, no failure edge** — the link failed and the graph
  drew no escalation path. The chain's failure-handling gap, made visible.
- **Cancelled** — an operator stopped it; neither success nor failure, and
  the escalation edges deliberately did not fire.
- **Handoff rejected** — the envelope failed validation at the receiving
  door (handoff-payload-contracts, this subject).

A mature vocabulary grows a second family the first design never
anticipates: **machinery-side reasons**, distinct from policy reasons.
Continuation can fail because the *relay itself* faltered — the edge lookup
errored before anything was evaluated, the event publish failed after the
edge was claimed, a concurrent evaluator won the race to fire the same edge
(informational: the chain continues via the winner), a repeatedly-failing
edge was quarantined, a guard's stored configuration was found corrupt, or
a deliberate stand-down rule suppressed the edge because another driver
owns the flow. Every one of these is a *reason nothing continued here*, and
folding them into the nearest policy reason destroys the ledger's
diagnostic value: "the graph chose to stop" and "the relay malfunctioned"
demand opposite responses. Budget the vocabulary for both families from the
start, and keep it extensible without a schema change — the reasons arrive
with operational experience, not with the design.

Each entry is either success-shaped or error-shaped, explicitly — that
one bit drives whether dashboards count the chain green or red, and it is
a property of the *vocabulary*, decided once, not re-judged by every
consumer ([failure-not-empty-success](../../_laws.md#failure-not-empty-success)
institutionalized: the spelling difference between "over" and "wrong" is
in the type).

## A stop record carries its evidence

The reason alone is a verdict without operands. Each ledger entry carries
what the decision point saw
([count-carries-predicate](../../_laws.md#count-carries-predicate)):
condition-not-met attaches each evaluated edge and its verdict with the
actual compared values; guard-tripped names the bound, the configured
limit, and the observed value; handoff-rejected names the validation
failure. The entry also carries its coordinates — chain id, link id,
depth — so the ledger joins cleanly to the chain tree
(chain-identity-and-rollup, this subject). The bar: the question "why
didn't the next agent run?" is answered *entirely* from the ledger row,
without re-running anything and without reading logs.

## Stopped versus stuck — the distinction only a ledger can make

The ledger's deepest value is negative space. A chain whose every leaf has
a stop record is **stopped** — the system finished deciding, whatever it
decided. A chain whose last link completed some time ago, with no stop
record and no running successor, is **stuck** — an event was emitted and
nothing concluded, which means the machinery itself lost the thread: a
listener that should exist doesn't (wiring drift), a decision process
died mid-handoff, a queue dropped the event. Without the ledger these two
states are indistinguishable, and both look exactly like "completed."
With it, *stuck is detectable by query*: last link terminal, no stop
record, no successor, older than a grace window. That query is the
chaining system's own health check — worth running on a schedule, because
it detects the failure class (silent non-continuation) that no
participant experiences as an error.

The write rule that makes the query sound: the stop record is written by
the same decision pass that evaluates edges and guards, in the same
transaction as its evidence — so "the decision ran" and "the ledger knows
the outcome" cannot diverge. A stop recorded on a best-effort side channel
re-creates the stuck/stopped ambiguity one layer down.

## Decision rules

- One stop vocabulary, closed, each entry pre-classified success- or
  error-shaped; extending it is a schema change with an owner.
- Every terminal link gets exactly one stop record — including the happy
  path. "Completed" is a written reason, not the absence of one.
- Records carry evidence and coordinates: reason, operands, chain id,
  link id, depth, timestamp.
- Stuck-detection query ships with the ledger: terminal link + no stop
  record + no successor + grace elapsed ⇒ machinery fault, alerted as
  such.
- The ledger is user-facing, not just operational: the chain view renders
  the stop reason at each leaf in the user's own vocabulary, because the
  person who drew the graph is the one asking why it stopped.
