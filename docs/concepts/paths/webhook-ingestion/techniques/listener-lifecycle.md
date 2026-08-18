---
layer: technique
subject: webhook-ingestion
technique: listener-lifecycle
status: forged
laws: [creation-names-reaper, failure-not-empty-success]
shared_with: []
---

# Listener lifecycle

The ingress is not just a handler — it is a long-lived resource: a bound
port, an accept loop, worker tasks, and (in relay topologies) a held-open
outbound subscription. Resources have lifecycles, and this one's lifecycle
has a property that makes negligence expensive: **a dead listener produces
the same observable output as a quiet one — nothing.** No traffic arrives
either way. Every discipline in this technique exists to break that
symmetry ([failure-not-empty-success](../../_laws.md#failure-not-empty-success)).

## Startup: bind loudly or not at all

Port binding fails routinely — the port is held by a previous instance that
never released it, by an unrelated process, or by a second copy of the
application. The bind failure must be **loud and terminal for the feature**:
surfaced to the operator with the port number and, where discoverable, the
holder — never swallowed into a log line while the application continues as
if ingestion were up. The worst spelling is the silent fallback: "port taken,
so skip the listener" produces a healthy-looking application whose senders
are all connecting to whatever process actually holds the port.

Decisions that belong to startup, made once and stated:

- **Fixed port vs ephemeral.** Webhook subscriptions embed a URL; an
  ephemeral port invalidates every registered subscription on restart. The
  ingress port is configuration, stable across restarts, and a change to it
  is a migration (re-register the subscriptions), not a restart detail.
- **Bind scope is a security decision.** Loopback-only, a specific
  interface, or all interfaces — each widens the set of possible callers.
  The default is the narrowest scope that the chosen topology requires;
  widening is explicit configuration, because "listen everywhere" chosen by
  default is an exposure nobody decided.
- **Single instance.** Two copies of the application must not both believe
  they own the ingress. The bind itself is a serviceable mutual-exclusion
  primitive — the second instance's bind fails, and *how that failure is
  reported* is the difference between a clean "already running elsewhere"
  and a mystery.

## Shutdown: stop accepting, drain, release

Graceful shutdown is a three-step contract, in order
([creation-names-reaper](../../_laws.md#creation-names-reaper) — the code
that binds the port is the code that states how it is released):

1. **Stop accepting.** New connections are refused with a retryable status
   or a closed port — the sender's retry machinery handles the gap; that is
   what it is for.
2. **Drain in-flight deliveries**, bounded by a deadline. A delivery that
   was mid-verification when shutdown began either completes its admission
   (and its record) or is dropped *before acknowledgment* — in which case
   the sender retries it later and dedup makes the retry safe. What must
   never happen: acknowledge, then die before the mint durably lands —
   that manufactures the one loss the sender's contract cannot repair.
3. **Release the resources**: the port, the worker tasks, the relay
   subscription. A port released only by process death is a port that stays
   bound through every in-process restart and hands the next startup its
   bind failure.

Restart-on-configuration-change (new port, new bind scope) is a shutdown
followed by a startup, using the same three steps — not an in-place mutation
that skips the drain.

## Health: the ingress answers for itself

"Is the ingress up?" must be answerable without waiting for a sender to
call. The listener exposes its own liveness — bound, accepting, and in relay
topologies, subscription connected with the time of last contact — through
the application's standing health surface
([health-checks](../../health-checks/health-checks.md)). The one fact worth
computing there rather than anywhere else: **time since last delivery, per
source, compared against that source's expected cadence.** The listener
being up and the traffic being absent is the signature of every external
misconfiguration — the sender disabled the subscription, the URL changed,
the relay silently dropped its channel — and only the receiving side is in a
position to notice the silence.

The relay subscription deserves its own vigilance: a held-open channel dies
quietly (idle timeouts, network path changes), and a client that does not
detect the death via heartbeats or read deadlines simply waits forever,
connected to nothing. Reconnect runs with backoff and *counts its
reconnections* — a channel that reconnects every ninety seconds is degraded,
and only the counter makes ninety-second degradation visible.
