---
layer: technique
subject: agent-chaining
technique: chain-identity-and-rollup
status: forged
laws:
  - identity-survives-reuse
  - derivation-names-recomputation
shared_with: []
---

# Chain identity and rollup

Five executions ran tonight. Which of them were *one chain*? If the answer
requires timestamp archaeology, the chaining feature shipped without its
spine. This technique owns the identity that threads a chain together and
the rollups that identity makes possible.

## Mint at the root, carry at every handoff

A chain's identity is created exactly once — at the root link, the one
started by something other than a chain handoff — and copied, never
re-derived, into every downstream link's record via the handoff envelope's
provenance compartment
([identity-survives-reuse](../../_laws.md#identity-survives-reuse)). The
two classic mistakes are both re-derivations in disguise:

- **Identity by adjacency** — "these executions are a chain because each
  started right after the previous one finished" — breaks the moment two
  chains interleave, and guarantees false joins on a busy system.
- **Identity by generation at each hop** — each link minting its own
  "chain" id when it notices it was chain-started — produces N chains of
  length one, which is the same as no identity at all.

The simplest honest rule: at the handoff decision point, if the emitting
link carries a chain identity, forward it; if it carries none, this link
*is* the root — mint the identity now and stamp it retroactively on the
root's own record, so the root is a member of its own chain. The root case
is where implementations quietly fail: a chain whose identity starts at
link two cannot answer "what kicked this off?", which is the question the
whole feature exists to answer.

## Per-link attribution: position, parent, and cause

The chain id alone says *membership*; the per-link fields say *structure*.
Each chain-started link records: its **depth** (machinery-stamped — the
cycle guards key on it), its **parent link** (which execution's completion
caused this one), and its **cause** — the edge that fired, with the
trigger mode and predicate verdict that let it fire (run-conditions, this
subject). Parent-plus-cause is what renders the chain as the user drew it:
not just "these five belong together" but "this one ran because that arrow
fired on that outcome." With fan-out — one completion firing several
edges — the chain is a *tree*, and parent links are what keep the tree's
shape; depth alone would flatten it into an ambiguous sequence.

## Rollups are derived, and they say so

Once every link carries the chain id, the chain becomes a queryable grain:
total cost (each link's spend summed to the chain — the number the
runaway-loop budget guard needs), total duration (root start to last-link
end — wall-clock, which under fan-out is *not* the sum of link durations),
link count and outcome census, and the stop reason at each leaf. Two rules
keep the rollups honest:

- **The chain grain is derived from the link grain, and the derivation is
  named and re-runnable**
  ([derivation-names-recomputation](../../_laws.md#derivation-names-recomputation)).
  If a chain-level summary row exists for query speed, the query that
  rebuilds it from link records exists beside it, and a discrepancy has an
  arbiter. The alternative — incrementing chain totals at each handoff —
  drifts on every crash between the link write and the increment.
- **A rollup over a live chain says it is partial.** Chains have no
  orchestrator, so "is it finished?" is itself derived — from leaf stop
  records (stop-reason-ledgers, this subject), not from a status field
  nobody owns the writing of. A cost total labeled "so far" and one
  labeled "final" are different claims; conflating them misleads exactly
  when the user is watching most closely.

## The trace rides the same rails

Cost rolls up on the chain id; traces roll up on trace identity — and the
handoff is a boundary crossing like any other, owned by
[tracing](../../tracing/techniques/cross-boundary-propagation.md)'s
propagation discipline. This technique's obligation is narrow and
non-negotiable: the handoff envelope's provenance compartment is the
designated carrier for trace context, so that the chain view and the trace
view describe the same run without a join on guesswork. What must not
happen is two parallel threading mechanisms — a chain id in the envelope
and a trace id smuggled through some side channel — because the two will
disagree on membership eventually, and every consumer will have to pick a
loyalty.

## Decision rules

- Chain identity is minted once at the root, forwarded verbatim,
  machinery-stamped; a link never invents or edits it mid-chain.
- The root stamps itself: every chain's member set includes its first link.
- Per-link attribution is parent + depth + cause (edge, mode, verdict) —
  enough to redraw the run as a tree over the authored graph.
- Chain-grain aggregates name their recomputation from the link grain;
  live rollups are labeled partial.
- Trace context travels in the same envelope compartment as chain
  identity — one threading mechanism, two consumers.
