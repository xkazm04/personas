---
layer: technique
subject: rate-limiting
technique: limiter-topology
status: forged
laws:
  - one-validation-door
  - gate-sees-target
shared_with: []
---

# Limiter topology

A limit is a number attached to a resource, but enforcement happens at doors —
and most systems have more doors than they remember. This technique is about
the geometry: how many limiter instances exist, which doors they cover, how
layered limits compose, and which direction each limiter faces. Topology
mistakes are the quietest failures in this subject, because every individual
door looks correctly limited while the resource is not.

## One resource, one limiter

Two independent limiters, each enforcing N on the same resource through
different doors, enforce neither's number: the resource sees up to the sum,
delivered with a clear conscience by two components that each pass their unit
tests. The rule is structural, not disciplinary (law: one-validation-door):
**the limit on a resource is owned by one limiter instance, and every door
that can cause the work passes through it.** The doors are enumerable — a
written list, not a hope: the public interface, the automation hooks, the
scheduled jobs, the internal admin paths, the event handlers. New doors get
added to systems constantly, and each addition either routes through the
shared instance or silently raises the effective limit.

The audit is the same as any shared-authority audit: find the resource, list
every path that reaches it, and check each path's limiter *identity* — not its
configuration. Two instances configured identically are still two allowances.

## The gate must sit on the work

A limiter placed on a proxy for the work — the request parser, one particular
client library, a convenience wrapper — passes exactly the traffic that skips
the proxy (law: gate-sees-target). The placement rule: the limiter sits at the
last shared point through which *all* causers of the work flow, as close to
the resource as ownership allows. If no such shared point exists, that is the
finding — create the chokepoint first, then limit it; a limit on 80% of the
doors is a speed bump with a published bypass.

## Layered limits

Real policies stack: a per-key limit inside a global ceiling, a per-endpoint
limit inside a per-tenant one, a burst limit inside a sustained one. Layering
is healthy — the fine layer provides fairness, the coarse layer protects the
resource when the fine keys are numerous or freshly minted (the evasion
backstop from key-design). Two composition rules keep stacks honest:

- **Evaluate all, then commit all.** A request that passes the per-key check,
  consumes per-key allowance, and *then* fails the global check has spent
  fairness budget on work that never ran — and under sustained global pressure
  every key's allowance drains at zero throughput. Check every layer first;
  consume from all of them only when all admit; refuse having consumed
  nothing.
- **The refusal names the layer.** When multiple layers would refuse, report
  the one that binds — with *its* retry-after (the maximum across refusing
  layers, since the request succeeds only when every layer would admit it).
  "You are limited" and "everyone is limited" route to different caller
  behavior and different operator escalation, so a stack that reports only a
  generic refusal has thrown away the diagnosis (see refusal-contract).

## Direction: shields and citizens

Ingress and egress limiters share machinery but not epistemology:

- An **ingress** limiter enforces a number this system owns. It is the
  authority; its arithmetic *is* the contract; precision at the boundary is
  worth paying for because the refusal publishes the rule.
- An **egress** limiter paces outbound calls against *someone else's* number.
  It is a local model of a remote authority, and the model drifts: providers
  change tiers, other clients share the quota, the published number was never
  exact. An egress limiter therefore runs slightly conservative, treats the
  provider's actual refusals as *corrections to the model* — feeding the
  observed reset times back into its pacing — and never treats its own green
  light as proof the provider will agree. The caller-side handling of the
  provider's refusals is [retry-backoff](../../retry-backoff/retry-backoff.md)'s
  territory; the egress limiter's job is making those refusals rare, not
  impossible.

The two directions also fail differently: an unavailable ingress limiter
fails open or closed by resource criticality (a policy chosen in advance —
see the golden path), while an unavailable egress limiter fails *open with
the provider as backstop* — the remote authority still enforces its real
limit; you have only lost politeness.

## One process, or several

Everything above is simplest when one process owns the resource and its
limiter: state is a map, atomicity is a lock, and the door audit is a code
search. Distributing the limiter — multiple nodes sharing one logical limit —
buys horizontal scale at the price of a consistency decision that must be made
*on purpose*: either centralize the counting (exact, adds a dependency and its
failure modes to every admission) or shard/replicate it (each node enforces a
share or a lagged view; the aggregate overshoots by a bounded, computable
factor). Both are legitimate; the illegitimate move is replicating the limiter
casually and believing the stated number still holds exactly. If the deployment
is single-node, say so and enjoy exactness — pre-distributing a limiter for
scale that is not coming trades away its simplest correctness argument for
nothing.

## Decision rules

- **Write the door list down.** The limiter's documentation names the doors it
  covers; reviewing a new door means updating that list. An unenumerated door
  set cannot be audited, only believed.
- **Identity, not configuration.** Sharing a limit means sharing the instance
  (or the backing state), never duplicating the settings. Two limiters with
  the same number are two limits.
- **Consume atomically across layers.** All-or-nothing across the stack;
  partial consumption is a fairness leak that surfaces only under pressure.
- **Keep the model humble on egress.** Conservative pacing, corrections from
  observed refusals, and no alarm when the provider disagrees with the local
  model — disagreement is the expected steady state, at low rate.
- **Choose the distribution posture explicitly.** "Exact and centralized" or
  "approximate by a stated factor" — either, written down. A distributed
  limiter without a stated consistency stance enforces an unknown number.
