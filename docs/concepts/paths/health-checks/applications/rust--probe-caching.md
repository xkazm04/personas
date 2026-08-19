---
layer: application
subject: health-checks
technique: probe-caching
stack: rust
---

# Probe caching — the shared TTL cache over executable probes

`src-tauri/src/commands/infrastructure/system/binary_probe.rs` (~100 lines)
is a minimal, correct instance of the technique: one cache, beside the probe,
shared by every caller.

## One cache shared across callers

```rust
/// TTL-based cache for CLI binary probe results.
///
/// Avoids redundant `where`/`which` and `--version` process spawns when
/// multiple call sites (health check, BYOM connection test) probe the same
/// binaries within a short window.
pub struct BinaryProbeCache {
    entries: Mutex<HashMap<String, (Instant, BinaryProbeResult)>>,
    ttl: Duration,
}
```

The cache lives in `AppState` (`state.binary_probe_cache`), so the system
health command (`health.rs::build_local_section`) and the BYOM connection
test hit the *same* entries — the technique's "cost scales with facts, not
surfaces" property. Probe identity is the command name (`"claude"`,
`"node"`, …): the exact key both call sites naturally ask with, so the dedup
cannot drift apart.

## The probe runs outside the lock

`get_or_probe` uses a deliberate compute-then-insert shape, documented
inline: check under lock, release, run the real probe (`where`/`which` +
`--version`, both slow process spawns on Windows with a large PATH), then
re-acquire to insert. Holding a mutex across a blocking spawn would serialize
every concurrent asker behind the slowest probe — the cache would *create*
the latency it exists to remove. (Trade-off accepted: two concurrent misses
on the same key both probe — this cache collapses *repeated* demand via TTL
but not *simultaneous* demand; the technique's in-flight dedup half is not
implemented here, affordable because the probe is idempotent and the window
is tiny.)

## What the probe observes

`command_version` executes the actual tool and parses the answer, skipping
non-version noise lines (update-check warnings) — a real-dependency
observation, not a manifest read. `command_exists_in_path` alone is the
weaker "detected but version probe failed" signal, and
`build_local_section` renders that divergence honestly as `Warn` with its
own detail text rather than as either installed-green or missing-red.

## Consumer-side of the same technique

The frontend twin is `src/features/vault/shared/hooks/health/useCredentialHealth.ts`:
a module-level `ModuleCache<string, HealthResult>` shared by every component
that asks about the same credential, with refcounted loading state, explicit
`invalidate()` as the recomputation path, and preview-mode entries that name
their reaper (deleted on key switch and on unmount, with an `unmountedRef`
guard so an in-flight check cannot resurrect an entry nothing remains
mounted to clear — the poisoned-key failure the technique warns about,
solved at the settlement path).

## Gap worth knowing

`BinaryProbeResult` does not carry its probe timestamp out to consumers —
staleness is bounded by the TTL but not *rendered*; the UI's freshness story
comes from the health panel's own loading/refresh cycle instead. Acceptable
at this TTL scale; it stops being acceptable the day a consumer caches the
result again on its own side.
