---
layer: golden-path
subject: agent-chaining
status: forged
techniques:
  - graph-to-wiring-translation
  - handoff-payload-contracts
  - cycle-and-depth-guards
  - run-conditions
  - chain-identity-and-rollup
  - stop-reason-ledgers
evidence:
  - src-tauri/engine/src/team_handoff.rs                              # visual edge → emitter chain trigger + receiver listener, two rows on the target; idempotent skip-if-exists; feedback edges never wired
  - src-tauri/db/src/chain.rs                                         # cascade evaluator: depth-8 / breadth / cost ceilings, visited-set cycle guard, machinery-stamped provenance (_chain_depth/_chain_visited/_chain_trace_id/_chain_cost_usd), 15-token stop vocabulary, mark-before-publish CAS
  - src-tauri/db/src/repos/execution/chain_stop_reasons.rs            # the stop ledger: typed reason + detail + chain coordinates, queryable per chain trace
  - src-tauri/src/engine/mod.rs                                       # chain id minted at root from own trace id, forwarded verbatim; root back-fills its own trace row so it is a member of its own chain
  - src/features/agents/sub_executions/detail/chain/ChainTraceView.tsx  # chain rendered per chain trace id with total cost, explicit `partial` flag, and stop reasons resolved from the token vocabulary
counter_evidence:
  - src-tauri/engine/src/team_handoff.rs                              # wiring is append-only: a deleted drawn edge never de-wires its trigger/listener rows — the orphaned-listener ghost the translation technique exists to prevent
deviations:
  - w10-agent-chaining   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Agent handoff & chaining

A user draws an arrow from one agent to another and means something precise:
*when this one finishes, that one starts, carrying what the first produced.*
This subject owns the discipline of making that sentence reliably true — the
translation of a drawn connection into runtime wiring, the contract governing
what crosses each handoff, the guards that keep a chain from becoming an
unbounded self-replicating process, the identity that threads a multi-link run
together, and the record of why any chain stopped where it did.

The boundary against the nearest neighbor is the load-bearing one. A
[pipeline](../pipeline-dag/pipeline-dag.md) is **orchestrator-driven**: one
engine holds the whole authored graph, pins it at run start, and walks it —
the topology is a read-only program and the engine is its interpreter. A
chain is **event-wired and peer-to-peer**: each link runs to completion,
emits an event, and whoever subscribed to that event fires next. No single
component holds the run; the topology is *implicit* in the standing
subscriptions, assembled link by link at runtime. That difference is not
cosmetic — it changes what can go wrong. A pipeline's cycle is rejected at
the door because the whole graph is in hand; a chain's cycle is two
subscriptions that individually look innocent. A pipeline's run state lives
in one place; a chain's "state" is scattered across the links that already
ran, and only a shared identity reassembles it. Everything below follows
from taking the distributed nature seriously instead of pretending the chain
is a pipeline that lost its conductor.

The other neighbors, for scoping: the bus itself — delivery, subscription
storage, fan-out — belongs to [realtime events](../realtime-events/realtime-events.md);
this subject is a *client* of the bus with unusually strict requirements.
Matching an emitted event against standing subscriptions is
[scheduling](../scheduling/scheduling.md)'s trigger-matching concern; this
subject owns what the match *means* for a chain. Supervising the sessions
that links run inside is [fleet orchestration](../fleet-orchestration/fleet-orchestration.md).
And carrying a trace across the process and link boundaries is
[tracing](../tracing/tracing.md)'s cross-boundary-propagation — this subject
decides *what* must be carried; that one owns *how*.

One boundary rule is earned rather than definitional, and systems that host
both mechanisms learn it expensively: **when an orchestrated graph and an
event-wired chain can drive the same flow, exactly one of them owns any
given step, and the other explicitly stands down.** A completion that is
both "a node the orchestrator will advance past" and "an event a chain
listener reacts to" gets its successor started twice — two agents doing the
same work, producing competing artifacts. And a chain that re-fires its own
handoffs at every hop, alongside an orchestrator that also advances, spirals
into multi-hop churn that burns real money concluding nothing. The stand-down
is machinery, not convention: the handoff decision point detects
orchestrator-driven sources and suppresses the chain edge, *and records the
suppression as a typed stop* — so the arrow that deliberately did not fire
is distinguishable from the arrow that broke.

## The drawn graph and the runtime wiring are two representations of one intent

The user authors a picture: nodes and arrows. The runtime consumes something
entirely different: standing rows that say "agent A, on completion, emits
event E" and "agent B listens for event E and starts when it arrives." An
arrow becomes *at least two* runtime artifacts — an emitter-side rule and a
listener-side rule — usually in different tables, sometimes owned by
different components. This is a **derivation**, and it must be treated with
the full discipline derivations demand
([derivation-names-recomputation](../_laws.md#derivation-names-recomputation)):

- **Re-applying the translation is idempotent.** Saving the same graph twice
  produces the same wiring, not duplicate subscriptions that double-fire the
  downstream agent.
- **Deleting an edge deletes its wiring.** The translation is authoritative
  in both directions: rows that no drawn edge explains are orphans, and
  orphaned listeners are the worst kind of ghost — an agent that starts "by
  itself" because an arrow erased from the picture months ago still exists
  in the wiring ([creation-names-reaper](../_laws.md#creation-names-reaper)).
- **Drift is detectable.** Because the picture and the wiring live in
  different stores, they *will* diverge — a failed partial save, a manual
  edit, a migration. The system needs a way to ask "does the wiring match
  the drawing?" and answer from data, not from faith.

The full discipline is
[graph-to-wiring-translation](techniques/graph-to-wiring-translation.md).
Its failure mode is the subject's signature bug class: the picture says one
thing, the runtime does another, and the user has no way to see which one is
lying.

## A chain without guards is a fork bomb with a UI

The moment agent completion can start agents, the system contains a
self-replicating primitive, and the drawing surface hands it to end users.
Two arrows — A to B, B to A — drawn by someone who meant "these two
collaborate" is an infinite loop that burns real money on every iteration,
because each link is typically a model-backed execution with per-run cost.
The guards are therefore not hardening to add later; they are admission
criteria for the feature existing at all:

- **Feedback edges are detected when the graph is wired**, not discovered
  when the loop spins. A cycle in the drawn graph is either rejected or
  explicitly marked as an intentional feedback edge with its own bounded
  semantics — never silently wired as if it were forward flow.
- **Depth is bounded at runtime** regardless of what wiring says, because
  wiring-time analysis cannot see cycles that route through anything dynamic.
  Every link knows how deep in a chain it is, and the link that would exceed
  the bound does not fire — it records that it declined, and why.

Both halves — static detection and runtime limit — are required; each covers
the other's blind spot. See
[cycle-and-depth-guards](techniques/cycle-and-depth-guards.md).

## The handoff payload is a contract, not a dump

What crosses from one link to the next is declared, bounded, and stamped:
the upstream *output* (the thing the arrow means to forward), optional
*context* the chain accumulates, and *provenance* — which agent produced
this, in which link of which chain. An undeclared payload converges on one
of two failures: it grows without bound as each link appends and forwards
(context snowball, until a mid-chain link fails on size), or it silently
drops the one field the downstream agent needed. Bounding forces the
truncation decision to be made *explicitly and recorded*, instead of
happening wherever the transport happens to choke. The contract lives in
[handoff-payload-contracts](techniques/handoff-payload-contracts.md).

## Continuation is conditional, and the conditions are evaluated honestly

An arrow rarely means "always." It means "on success," "on failure" (the
escalation arrow), "always" (the audit arrow), or "when the output satisfies
a predicate" (the routing arrow). These conditions are data, evaluated by
one evaluator, with the three-outcome honesty that
[pipeline conditional edges](../pipeline-dag/techniques/conditional-edges.md)
established: *fired*, *not fired*, and *unevaluable* — and unevaluable never
impersonates a verdict in either direction. The chain-specific twist: when a
condition resolves to not-fired, the chain **stops**, and a stop is an
event in its own right, not the mere absence of a next link. See
[run-conditions](techniques/run-conditions.md).

## One identity threads the chain

Each link is a complete execution in its own right — it has its own id, its
own logs, its own cost. What makes five executions *a chain* is a shared
chain identity minted at the root link and carried through every handoff
([identity-survives-reuse](../_laws.md#identity-survives-reuse)). Without
it, the chain exists only in the user's memory: cost cannot roll up, a trace
cannot span the handoffs, and "what did this arrow actually cause?" is
answerable only by timestamp archaeology. With it, the chain becomes a
first-class queryable object: links ordered by depth, attributed to the
edges that fired them, with cost and trace rolled up at the chain grain.
The identity and rollup discipline is
[chain-identity-and-rollup](techniques/chain-identity-and-rollup.md).

## A chain that stops says why

Every chain ends. The difference between a trustworthy chaining system and
a haunted one is whether the end is *recorded* or *inferred*. Completion
(no outgoing edges fired because the chain reached its natural end), depth
exhaustion, a condition that resolved false, an upstream failure with no
failure-edge, an operator cancellation — each is a distinct, typed stop
reason, written where queries can reach it
([failure-not-empty-success](../_laws.md#failure-not-empty-success) applied
to control flow: "the chain is over" and "the chain is stuck" must be
spelled differently). The stop ledger is what converts the user's scariest
question — *why didn't the next agent run?* — from a debugging session into
a lookup. See [stop-reason-ledgers](techniques/stop-reason-ledgers.md).

## What "done" looks like for this subject

A chaining system meets the bar when: saving the drawn graph twice wires it
once, and deleting an arrow provably de-wires it — no listener outlives its
edge; a cycle drawn by a user is caught at save time or, failing that,
stopped at a stated depth with the stop recorded, never discovered on an
invoice; every handoff's payload is within declared bounds and stamped with
its origin; every link of a chain carries the chain's identity, so cost,
traces, and history roll up to the chain the user drew; and every chain
that is not currently running has a typed stop reason a query can return —
the answer to "why did it stop?" is data, and the answer to "why did that
agent start?" is the edge, the event, and the condition that fired it,
by name.
