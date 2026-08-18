---
layer: technique
subject: health-checks
technique: probe-caching
status: forged
laws: [derivation-names-recomputation, creation-names-reaper]
shared_with: []
---

# Probe caching

Once probes are honest (they observe the real dependency) they are also
expensive — a process launch, a handshake, a round-trip. And once they are
useful, everyone asks: the dashboard, the pre-flight gate, the setup wizard,
the background watcher, each on its own rhythm. Without a shared cache the
diagnostic layer scales its cost with the number of *surfaces*, not the
number of *facts* — and the number of facts is small. The cache is what makes
"check honestly" and "check cheaply" compatible.

## One cache, shared across callers

The cache sits **beside the probe, not beside the caller**. Per-caller
caching (each surface remembering its own last answer) recreates the problem
at one remove: N surfaces still produce N probes, just less often, and worse
— they disagree with each other about the current verdict, which no two
surfaces should ever do. One keyed store, addressed by probe identity (see
[probe-design](probe-design.md)), serving every consumer, is the structural
form. Combined with in-flight dedup it yields the full economy: simultaneous
askers share one execution; sequential askers within the TTL share one
result; only genuinely new demand pays for a probe.

## TTL follows the fact's rate of change

The TTL is a claim: *this fact cannot meaningfully change faster than this*.
Size it per target, from that claim:

- an installed tool's presence changes on installs — minutes are fine;
- a service's liveness changes on deploys and crashes — seconds to a minute;
- a network's reachability changes on transitions — short, and better
  handled by event invalidation than by TTL at all.

A single global TTL is a smell: it is either too long for the volatile facts
or too short for the stable ones, and usually both. TTLs also bound the lie
window — a cached green may be up to TTL old at the moment it is rendered,
which is exactly why the stamp travels with it (below).

## The stamp travels with the result

A cache hit returns the verdict **and its timestamp**, and every consumer
receives both. The cache never launders age: no consumer should be able to
tell a fresh probe from a cache hit *except* by reading the stamp — and every
consumer must be able to read the stamp. Surfaces render the age; gates
compare the age against their own freshness requirement and demand a live
probe when the cached one is too old for the stakes. Sufficiency is the
consumer's call, because the cache cannot know whether it is feeding a
curious glance or a launch decision.

This is [derivation-names-recomputation](../../_laws.md#derivation-names-recomputation)
in cache form: a stored verdict is a derivation of a probe, so the store
exposes the recomputation — a force-refresh path that bypasses TTL — from
every surface that shows a cached result. A rendered staleness with no
refresh affordance next to it is a complaint the user cannot act on.

## Invalidation on relevant change

TTL is the passive bound; events are the active one. The cache invalidates —
immediately, not at next expiry — when something happens that *falsifies*
the cached fact:

- an install or uninstall completed → invalidate that tool's verdict;
- a configuration affecting the target was saved → invalidate that target;
- the machine resumed from sleep or the network transitioned → invalidate
  the reachability-shaped entries wholesale;
- a self-applied fix ran (see
  [remediation-affordances](remediation-affordances.md)) → invalidate the
  fixed check, because the fix's own success claim is *the probe running
  green afterward*, never the fix's exit status.

The invalidation list is part of each check's definition — "what events
falsify this verdict" is designed alongside "how do I observe it". A check
whose falsifying events are unknown gets a shorter TTL, honestly, rather
than a long TTL and hope. Negative results are cached too — under a
*shorter* TTL, because red-to-green transitions are precisely the ones a
human just caused (they installed the thing; they fixed the config) and a
long-cached red that outlives the fix reads as "the fix didn't work".

## The cache names its reaper

A probe cache is created infrastructure and obeys
[creation-names-reaper](../../_laws.md#creation-names-reaper): entries have
a bound (count or age) and an eviction rule; a cache keyed by an open-ended
parameter space (per-target × per-flag) without eviction is a slow leak
wearing a performance optimization's badge. Likewise the dedup table of
in-flight probes: every entry is removed on settlement — including on
timeout and on failure of the probe itself — or a single wedged probe
poisons the key forever, serving an eternal "in progress" to every future
asker.
