---
layer: technique
subject: settings
technique: read-batching
status: forged
laws: [derivation-names-recomputation]
shared_with: []
---

# Read batching

Settings have the worst read pattern of any store in the application: tiny
values, enormous fan-in, and a demand spike at the single most
latency-sensitive moment — startup, when every component that mounts asks for
its keys at once. If each read is a round trip across a process, storage, or
serialization boundary, boot pays `N` boundary crossings for data that would
fit in one packet. The tax is invisible in development (each read is fast),
grows monotonically (every feature adds reads, none remove them), and is
entirely self-inflicted — the values were all in one table the whole time.

Nobody designs this fan-out; it *accretes*, because the single-key read is
the natural unit for the component author, and each addition is individually
negligible. The fix therefore cannot be a review comment on the 41st read; it
has to be structural: make the batched path the easy path.

## The shape of the fix

- **Bulk read as the primary verb.** The store exposes read-many (a key list,
  a namespace prefix, or simply *all* — a settings space is small enough that
  "all" is usually the right granularity) and the startup path uses it: one
  crossing, one deserialization, done before or alongside first paint.
- **A read-through cache behind the accessors.** Component-level code keeps
  calling the same typed accessor it always called; the accessor consults an
  in-memory map populated by the bulk read. Cache misses fall through to a
  single-key read and populate the map. Crucially the cache sits *behind* the
  typed door, not in front of it — callers never see or manage it, so it can
  be added, tuned, or removed without touching a call site.
- **Single-flight on the bulk load.** Twenty components mounting during boot
  must produce one bulk request, not twenty: the first caller starts the
  load, the rest await the same in-flight promise. Without this, the cache
  merely moves the stampede one layer down.
- **Or: coalesce instead of caching.** A leaner variant skips the long-lived
  cache entirely and batches at the *scheduler* granularity: every single-key
  read requested within one tick of the event loop is collected and flushed
  as one bulk request at the tick's end, with each caller's promise resolved
  from the shared result — and a failure of the underlying bulk call rejected
  out to *every* waiting caller, so none hangs silently. Callers keep the
  ergonomic single-key API; the crossing count scales with the number of
  distinct ticks rather than the number of keys. This trades warm re-reads
  (no cache to hit) for zero staleness surface — there is no copy to
  invalidate — which is often the right trade below a few dozen readers.

## The cache is a derivation, and it names its recomputation

A settings cache is a stored copy of the store — derived state — and derived
state without a named recomputation path is a future discrepancy with no
arbiter ([derivation-names-recomputation](../../_laws.md#derivation-names-recomputation)).
Name the invalidation events explicitly:

- **Own writes**: the setter is write-through — it updates the store and the
  cache in the same operation, and read-your-own-write is a hard guarantee.
  A settings surface where the toggle you just flipped reads back stale is
  broken in the most user-visible way possible.
- **Other writers**: other windows, other processes, sync from another
  device, a restored backup. Each such channel either emits a change event
  the cache subscribes to, or the design explicitly accepts staleness with a
  stated bound ("other windows converge on next focus"). *Deciding* is the
  requirement; the indefensible position is the implicit one, where
  cross-window staleness is whatever the code happens to do. A clean shape
  for the event: the store broadcasts **the key only, never the value** —
  subscribers re-read through the normal typed door. Value-carrying events
  create a second delivery path for settings data that bypasses parsing and
  validation, and (for sensitive keys) sprays values onto a bus that many
  listeners can hear.

The honest failure mode to design for: an invalidation channel that silently
dies leaves the cache confidently serving the past. Prefer coarse, cheap
invalidation (drop the whole map, re-bulk-read on the next access) over
clever per-key patching — the settings space is small, the bulk read is one
crossing, and the coarse path has no partial-update bugs to have.

## What not to build

Skip TTLs, LRU eviction, and size bounds — this is a small, hot, complete
data set; expiry policies borrowed from large-cache practice add staleness
windows and code without freeing anything that matters. And resist the
gravitational pull of turning the settings cache into a general state
manager: it holds mirrored store rows, nothing else. Session-scoped UI state
that was never persisted has its own home and its own subject
([client-state](../../client-state/client-state.md)).
