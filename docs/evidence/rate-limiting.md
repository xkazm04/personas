---
subject: rate-limiting
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

# Rate Limiting - evidence

How this codebase measures against the [`rate-limiting`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
