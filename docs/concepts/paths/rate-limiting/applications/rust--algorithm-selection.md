---
layer: application
subject: rate-limiting
technique: algorithm-selection
stack: rust
---

# Two families in one binary: sliding-window log and token bucket

This repo runs both workhorse families side by side, each matched to its
traffic shape, both on the monotonic clock — a live worked example of choosing
by burst semantic and paying in state.

## Sliding-window log for ingress (`src-tauri/engine/src/rate_limiter.rs`)

`RateLimiter` keeps a `Vec<Instant>` per key (`:12-13`) and counts events
younger than the window: the exact family, no boundary artifact.
`check(key, max_events, window)` retains live timestamps (`:58`), refuses when
the count meets the budget, and computes retry-after from the *oldest*
in-window event (`:67-72`) — the O(1) answer to "when would this succeed"
that the family gives you for free. The choice fits the traffic: keys are
server-assigned (trigger ids, API-key row ids, credential+tool tuples), limits
are tens-per-minute, so per-key state is bounded by `max_events` timestamps —
exactness is cheap here. Two guards worth copying: the empty-bucket degenerate
arm (`:64-66`, `max_events == 0` must not panic and falls back to the full
window), and the refusing branch returning *before* the `push` (`:89` vs
`:93`) so refusals never consume window space.

Deviation, structural: the policy is a **parameter of every `check` call**,
stored nowhere — which is why `tier_usage.rs:83-87` must guess a bucket's
limit from its key prefix (`key.starts_with("webhook:")`), and guesses wrong
for the `apikey:`/`mcp_tool:`/`tool:` families whose budgets are constants,
not tier values. The golden path's policy-ownership stance is the missing
piece, not a different algorithm.

## Token bucket for egress (`src-tauri/src/engine/api_proxy.rs`)

The per-credential outbound limiter is a continuous-refill token bucket
(`TokenBucket`, `:178-217`): `tokens` refills lazily on access at
`max / RATE_LIMIT_WINDOW_SECS` per second (`:203-206`), capped at
`max_tokens`, and a refusal computes retry-after as
`(1.0 - tokens) / refill_rate` (`:213-214`) — again from the same arithmetic
that refused. The family fits the posture: this is the *citizen* side, pacing
outbound connector calls against providers' own limits, where smooth sustained
rate matters more than window exactness and per-key state must be O(1)
(`RATE_LIMITERS` is one registry across all credentials, hard-capped at 1024
entries, `:175`).

Clock discipline holds in both: all interval arithmetic runs on `Instant`
(monotonic); refill is clamped by `.min(self.max_tokens)` (`:204`) so no
elapsed-time surprise can mint more than one bucketful. Capacity changes apply
to a live bucket without resetting its tokens (`:303-310`) — a limit raise is
not a free refill.

Deviation, egress-model staleness: `parse_rate_limit_from_metadata` (`:251`)
reads `rate_limit_rpm` from connector metadata, but zero of the seeded
connectors declare it, so every credential gets `DEFAULT_RATE_LIMIT = 60`/min —
including providers whose documented limit is lower (arXiv: 20/min, stated
only in prose shipped to the model). The local model of the remote authority
exists and is never fed; the technique's "run conservative, correct from
observed refusals" is the standard this pacing does not yet meet.

## The sentinel to avoid

`TierConfig`'s unlimited tier expresses "no limit" as `usize::MAX`, so `check`
never refuses but still pushes and retains every admitted timestamp over a
60-second window on every call — full bookkeeping for a limit that cannot
trip. The technique's rule applies verbatim: unlimited is a short-circuit
before the machinery, not a large number inside it.

## What transplants

Match the family to the posture: exact sliding-window log where keys are
system-assigned and budgets small (ingress fairness), O(1) lazy token bucket
where sustained pacing and bounded registries matter (egress citizenship).
Keep every clock monotonic, clamp every refill, refuse before recording — and
store the policy with the limiter, which is the one thing neither
implementation here got right.
