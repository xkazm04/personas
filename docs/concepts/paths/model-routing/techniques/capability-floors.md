---
layer: technique
subject: model-routing
technique: capability-floors
status: forged
laws:
  - derivation-names-recomputation
  - failure-not-empty-success
shared_with: []
---

# Capability floors

Cost pressure on a routing table pushes every dial down, and for most calls that
is correct — the whole point of classification is that most calls tolerate a
cheaper tier. But some capabilities do not degrade gracefully. Below a certain
tier, structured extraction stops returning parseable structure; multi-step tool
orchestration stops completing; a judging task stops separating good from bad.
The feature is not *cheaper* below that line — it is *broken*, while still
returning plausible-looking output. A capability floor is the recorded,
enforced statement of where that line sits.

## A floor is a measurement, not a fear

The failure mode of floors is that they get set defensively — "this feels
important, floor it at the frontier tier" — and then function as a permanent
exemption from cost discipline. The discipline:

- **A floor is set by observed breakage.** The record says what was measured:
  the capability, the tier below which it failed, the failure shape (parse
  failures, incomplete orchestration, judge scores collapsing to noise), the
  date. "Floored at mid tier: below it, structured output failed to parse in a
  material share of runs, measured on the capability's real workload" is a
  floor. "Floored because it matters" is a budget hostage.
- **A floor names its recomputation** (law: derivation-names-recomputation). It
  is a derived value — derived from a benchmark against a roster that will
  change. The floor record states how to re-run the measurement, and the
  staleness trigger: on roster change, re-test. A floor set two model
  generations ago may be paying for capability the small tier has since
  acquired; an unrevisited floor converges on pure waste.
- **A floor carries its cost-vs-quality tradeoff in writing.** What the floor
  costs per unit of traffic relative to the class default, and what breaks
  without it. This is the record that lets a future budget conversation be an
  engineering conversation.

## Floors bind everyone — especially failover

The floor's enforcement point is the routing decision itself, which means it
binds every path that produces a decision:

- **Cost pressure routes down to the floor and stops.** A global "degrade
  everything one tier" incident lever must be floor-aware by construction, not
  by the operator remembering which features are fragile.
- **Consumer overrides cannot cross it.** A pin below the floor is refused at
  decision time with the floor named (see consumer-overrides); honoring it
  would let one consumer opt a feature into silent breakage.
- **Failover cannot cross it silently.** This is the seam with the
  [retry-backoff](../../retry-backoff/retry-backoff.md) path: when the selected
  provider fails and failover machinery asks for a substitute, the floor
  constrains the answer. If every provider at or above the floor is
  unavailable, the legitimate outcomes are *wait* (the retry ladder holds the
  work), *fail with the floor named*, or *degrade with an explicit flag* — a
  decision the capability's owner made in advance, recorded in the floor
  itself. What is never legitimate is the failover path quietly substituting
  a below-floor tier because it was the one still standing; that converts an
  outage into silent data corruption, the one failure shape worse than the
  outage (law: failure-not-empty-success).

## The degraded-tier fallback, when it is chosen

Some capabilities legitimately declare a degraded mode: below-floor service is
better than none, *if flagged*. The contract for that choice:

- the degraded output is **marked as degraded** in the result and in the
  decision record — downstream consumers and dashboards can distinguish it;
- the degradation is **bounded in time or volume** — a standing degraded mode
  is a floor set wrong;
- the choice was **made by the capability's owner in advance**, in the floor
  record — not improvised by the routing layer mid-incident.

## Decision rules

- **Floors are per-capability, not per-class.** A class groups calls by product
  role; a floor protects one capability's specific breaking point. Attaching
  floors to classes floors everything in the class, which reintroduces the
  defensive-floor waste.
- **Few floors, strongly held.** If most capabilities have floors, the class
  mapping is set too low and floors have become the real routing table —
  recalibrate the table instead.
- **A floor violation attempt is a signal, not just a refusal.** Repeated
  refused pins or failover requests against a floor mean either the floor is
  stale or the roster is thinner than the policy assumes; count them and
  review.
- **Floors appear in the same governance surface as policy** (see
  policy-governance): adding, raising, or lowering one is a reviewed change
  with the measurement attached, because a floor is the most expensive kind of
  routing rule there is.
