---
layer: application
subject: rate-limiting
technique: storm-hygiene
stack: rust
---

# Storm hygiene in the shared ingress limiter

The shared sliding-window limiter at `src-tauri/engine/src/rate_limiter.rs` is
this repo's best storm-hygiene exhibit: all three disciplines — hot refusal
path, warn-once latching, a named reaper — are present in 160 lines, and two of
them carry regression tests that pin the doctrine in their test names.

## Warn-once latching per rejection streak

Each key's `Bucket` carries a `warned: bool` beside its timestamps
(`rate_limiter.rs:12-19`). The refusing branch logs `tracing::warn!` only when
the latch is unset, then sets it (`:78-88`); the admitting branch clears it
(`:92`). The comment at `:73-77` states the technique's exact rationale —
"Signal the crossing, not the level … a caller hammering a limit would
otherwise flood the log with one warning per request." Both halves of the
episode boundary are pinned by tests:

- `test_warn_latch_sets_on_first_rejection_and_stays_set` (`:256`) — the
  middle of a streak stays silent;
- `test_warn_latch_resets_after_admission_so_next_streak_warns_again`
  (`:285`) — warn-once does not decay into warn-once-ever.

The first warn line carries the full refusal context as structured fields
(`rate_key`, `retry_after_secs`, `bucket_depth`, `max_events`, `window_secs`),
so the one line per episode is the informative one.

**Deviation from the technique's full shape:** the latch is a flag only — no
suppressed-count accumulates, and the streak's *end* (first admission after
refusals) logs nothing. "Recovered after N suppressed refusals over M minutes"
cannot be written from this state. The periodic high-watermark summary
(`:98-121`: `active_buckets` + deepest bucket every 100th check) is a partial
substitute — it reports pressure on a cadence, not episodes with counts.

## The reaper: amortized, named, cheap

Pruning is a named activity with two entry points: an explicit `prune()`
(`:152-159`) and an automatic pass every `AUTO_PRUNE_INTERVAL = 100` calls to
`check` (`:7`, `:97-127`), run while already holding the lock the call
acquired — no second acquisition, no background ticker per key. Buckets whose
timestamps have all aged out are dropped entirely, so idle keys cost nothing
between sweeps and zero after one. `test_auto_prune_on_check_interval`
(`:311`) pins that expired buckets actually leave the map.

The egress-side registry in `src-tauri/src/engine/api_proxy.rs` shows the same
discipline with harder bounds: an idle sweep (`sweep_stale`, `:235-244`)
throttled to at most once per 60 s, idle eviction at 600 s, and a hard cap of
1024 entries with least-recently-used eviction when a new credential arrives at
capacity (`:286-296`). Cap, cadence, and staleness horizon all sit as named
constants at the top of the module (`:166-175`) — the bound shipped with the
map.

## The refusal path stays O(1)

The refusing branch of `check` (`:60-89`) reads the already-retained timestamp
vector, computes `retry_after` from the oldest entry, optionally emits the one
latched warn, and returns. No allocation proportional to the storm, nothing
remote, and — because the `return Err` at `:89` precedes the `push` at `:93` —
**a refused attempt is never recorded into the window**, so a storm cannot
extend its own lockout (the self-perpetuation bug a sibling repo's limiter
documents having shipped and fixed; this one never had it).

## What transplants

The pattern to carry: latch-per-key **with reset on admission**, both
directions regression-tested; pruning amortized into the operation that
already holds the lock, at a named interval; refusal branch that touches only
state already in hand. The gap to close when transplanting: give the latch a
counter and log the episode's end, so suppression preserves the information
and not just the quiet.
