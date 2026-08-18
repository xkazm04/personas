---
layer: golden-path
subject: rate-limiting
status: forged
techniques:
  - algorithm-selection
  - refusal-contract
  - key-design
  - limiter-topology
  - storm-hygiene
  - limit-observability
evidence:
  - src-tauri/engine/src/rate_limiter.rs                     # ONE shared sliding-window limiter: retry-after computed from the oldest in-window event, warn-once latch per rejection streak (reset on admission, both halves regression-tested), periodic prune + high-watermark summary, refusals never recorded into the window
  - src-tauri/src/engine/api_proxy.rs                        # egress per-credential token bucket: lazy refill on monotonic clock, computed retry-after, idle-eviction horizon (600s) ≥ refill horizon (60s) so eviction never grants more than time would, sweep throttled to 1/60s, hard cap 1024 with LRU eviction, live capacity update without token reset
  - src-tauri/src/engine/management_api.rs                   # the complete refusal: 429 + Retry-After header from the shared limiter's computed seconds, key built from a server-assigned row id, audit row recording the 429
  - src-tauri/src/engine/webhook.rs                          # one instance across doors — webhook + management API share AppState's limiter by construction (comment states the intent); per-trigger key from server-side trigger id
  - src-tauri/src/engine/mcp_tools.rs                        # adversarial key derivation written down: credential_id (server-assigned) not caller-influenced prefix, gateway recursion lands in the same bucket
  - src-tauri/src/commands/infrastructure/tier_usage.rs      # usage snapshot as a TTL-cached derived view (3s), near-limit flag at a stated fraction (80%)
counter_evidence:
  - src/features/triggers/sub_speed_limits/RateLimitDashboard.tsx   # renders throttled/queued/concurrent from a store map whose only writer has zero call sites — configuration reported in a surface named like measurement
  - src-tauri/src/engine/smee_relay.rs                       # .is_err() → continue: the refusal's retry-after discarded at the point of production, over-limit events dropped with a log line as the only trace
deviations:
  - w9-rate-limiting   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Rate limiting

Every system exposes doors through which outside actors — users, integrations,
schedulers, other machines — can cause work, and none of those actors is obliged
to be reasonable. Rate limiting is the discipline of **bounding how much work a
key may cause per unit time**: not whether the work is valid (validation's job),
not whether capacity exists right now (admission's job), but whether *this actor*
has already caused *enough* in *this window*. The limiter is the part of the
system that says a calibrated, attributable, time-boxed **no**.

The boundaries matter because three neighboring subjects also say no, and
confusing their refusals produces machinery that enforces none of them well. An
[admission queue](../admission-queue/admission-queue.md) refuses by **capacity** —
"not now, too much in flight" — a statement about the system's instantaneous
load, healed by other work finishing. A rate limit refuses by **time window** —
"not again until" — a statement about one key's recent history, healed only by
the clock. [Cost metering](../cost-metering/cost-metering.md) refuses by
**budget** — money over a billing period, a calendar-scale ledger, not a
per-second regulator. The three compose naturally (a request may pass the rate
limit, then the budget gate, then wait in admission), but each has its own clock,
its own key, and its own refusal contract. What the refused caller *does next*
is the fourth neighbor's territory:
[retry-backoff](../retry-backoff/retry-backoff.md) owns the consuming side of
every refusal this subject emits. One more impostor deserves naming: **"one at
a time" is not a rate limit.** Mutual exclusion — refusing because the same
operation is already in flight — is an exclusivity guard, healed by completion,
not by the clock. Systems that reuse the rate-limit vocabulary for exclusivity
refusals teach their consumers that "you are throttled" and "you double-clicked"
are the same condition, and every automated reaction built on that vocabulary
is then right for one population and nonsense for the other.

## The core stance: the limit is a contract, and the refusal states it

The naive limiter is a counter and a boolean: too many, reject, maybe log. It
fails not at counting but at *communicating*. A rejection that says only "slow
down" without "until when" does not reduce load — it converts one request into a
guessing game of retries, each of which the limiter must also process. The
callers this subject regulates are mostly machines, and machines do exactly what
the refusal tells them; a refusal that tells them nothing gets nothing.

> **A rate limit is a published contract between the system and each key. The
> refusal is where the contract is stated: which limit, over what window, and
> when the next request will succeed.**

The consequences of that stance form the spine of this subject:

1. **Algorithm choice is a precision/memory trade, and burst semantics are the
   real difference.** Fixed windows, sliding windows, and token buckets all
   enforce "N per period" on average; where they differ is what happens when an
   idle key suddenly sends everything at once, and how much state buys how much
   precision at the boundaries (see algorithm-selection). Pick by the burst
   behavior the resource can survive, not by algorithm fashion.
2. **The refusal is structured, machine-readable, and honest.** It carries the
   key, the limit, the window, and a computed retry-after — a promise derived
   from the limiter's actual state, not a constant someone liked (see
   refusal-contract). The caller-side contract — classify as rate-limited,
   honor the stated time — is retry-backoff's half of the same handshake.
3. **Key design decides fairness and cardinality.** Whatever the key is —
   tenant, credential, endpoint, a tuple — that is the unit that competes for
   the resource, and every actor sharing a key shares a fate. And any key
   derived from world-controlled input is an unbounded set: **an unbounded
   per-key state map is a memory leak with a policy name** (see key-design).
4. **One resource, one limiter.** Two independent limiters each enforcing N on
   the same resource through different doors enforce neither's number — the
   resource sees up to the sum. All doors that cause the work share the
   instance, and the doors are enumerable (see limiter-topology).
5. **The limiter's own noise is bounded.** The limiter meets its heaviest
   traffic at the exact moment it is refusing, and a limiter that logs every
   rejection during a storm is a second storm — the defense becoming a
   participant in the attack (see storm-hygiene).
6. **A limit nobody can observe is a limit nobody can operate.** Usage
   snapshots, near-limit warnings before the first refusal, and refusal counts
   that name their limit are what let an operator raise a limit before an
   incident instead of during one (see limit-observability).

## The limiter owns the policy

A corollary of the contract stance that decides an API shape: **the limit's
key, number, and window are the limiter's state, not the caller's arguments.**
A limiter whose check takes the budget as a per-call parameter has externalized
its own policy — nothing can then answer "what is this key's limit?", so the
refusal cannot publish the rule, the dashboard must guess the limit from the
key's spelling (and will be wrong for some key family), and two callers can
pass two different budgets for one key with no arbiter. Policy registered with
the limiter once — per key pattern, per door — is what makes the refusal
contract and the observability surface derivable from the same authority
instead of reconstructed, differently, at every consumer.

## Refusal is a verdict, not a failure

The single most common integration bug downstream of a limiter is treating its
refusal as an error like any other. It is not: nothing is broken, nothing needs
alerting per-occurrence, and the correct response is *scheduled patience*, not
diagnosis. The refusal therefore must be spelled differently from failure at
every layer — a distinct outcome in the limiter's return type, a distinct signal
on the wire, a distinct series in the metrics. A limiter whose "no" is
indistinguishable from a crash teaches its callers to retry crashes and to page
humans about weather.

The same discipline applies in the other direction: a limiter that cannot run —
its state store unreachable, its clock unreadable — has *not* refused anything,
and must not report refusals it never evaluated. Whether it then fails open
(admit unmetered) or fails closed (refuse all) is a policy choice made per
resource, on purpose, in advance: fail open in front of resources that degrade
gracefully, fail closed in front of resources where overload is unrecoverable.
The unacceptable option is the accidental one.

## Two postures: shield and citizen

Every limiter faces one of two directions, and the direction changes what
"correct" means:

- **Ingress (the shield):** protecting this system's own resources from outside
  demand. The limit is ours; we are the authority; the number is whatever the
  resource can sustain. Precision matters at the boundary because we publish the
  contract.
- **Egress (the citizen):** pacing this system's own outbound calls to someone
  else's limit. Here the limiter is a *local model of a remote authority*, and
  the model will drift — the provider changes tiers, other clients share the
  quota. An egress limiter is therefore always advisory-plus-corrective: it
  paces optimistically, and treats the provider's actual refusals as
  corrections to the model, never as surprises to escalate.

Both postures use the same algorithms and the same hygiene; they differ in who
owns the number and what a refusal teaches.

## What "done" looks like for this subject

A rate-limiting layer meets the bar when: every limited resource has exactly one
limiter and its doors are enumerable; every limit is a stated contract — key,
number, window — rather than a constant buried in a condition; every refusal
carries a computed retry-after and is spelled as a verdict, distinct from
failure; per-key state is bounded with a named reaper, so hostile cardinality
costs memory the design already budgeted; a rejection storm produces one
summarizing log line per key per episode, not one line per rejection; and an
operator can see, for any key, how close it is to its limit *before* the first
refusal — because the cheapest rate-limit incident is the one the dashboard
made unnecessary.
