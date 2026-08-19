---
layer: technique
subject: build-economics
technique: cache-budgeting
status: forged
laws: [creation-names-reaper, derivation-names-recomputation, gate-sees-target, failure-not-empty-success]
shared_with: []
---

# Cache budgeting

A build cache is a derived artifact with a price. Incremental state,
downloaded dependency archives, per-variant object files, prebuilt native
libraries — each entry costs bytes now against the chance of saving a rebuild
later. Unmanaged, every one of these grows monotonically: the build only ever
adds, nothing subtracts, and the failure arrives as a full disk on whatever
machine has the least headroom, weeks after any individual decision that
caused it. The technique is to run caches the way one runs any budgeted
resource: a byte ceiling, a pruner that enforces it, a hit-rate measurement
that justifies it, and invalidation keys honest enough that a hit is always
safe.

## The economics of an entry

An entry earns its bytes when

> P(hit) × rebuild-cost-saved > byte-cost × storage-pressure

Neither side is guessable. Hit probability differs wildly by entry class:
third-party dependency artifacts are hit constantly (dependencies change
rarely, appear in every build, and are shared across variants and worktrees);
per-variant incremental state for a variant nobody has built in a month is
hit never. Rebuild cost differs too — a native library that takes forty
minutes to compile from source is worth caching at almost any byte price; a
file that regenerates in two seconds is worth almost none. Rank entry classes
by *rebuild-seconds saved per megabyte retained* and the pruning order writes
itself: stale variant state goes first, hot dependency artifacts go last.

## The reaper is part of the cache

A cache without a pruner is not a cache; it is a leak with good intentions.
The pruner is designed at the same time as the cache, with three decisions
made explicit:

- **The budget** — a byte ceiling per cache, sized to the machine class that
  hosts it, not to the biggest disk on the team.
- **The eviction order** — by the economics above, with recency as the
  default proxy where measurement is missing (an entry untouched for N days
  has revealed its hit rate).
- **The trigger** — pruning runs on a routine hook, never only "when someone
  notices". A pruner that must be remembered is a pruner that runs the day
  after the disk fills. And a **warning is not a budget**: an advisory that
  prints "over budget" on every build will be scrolled past indefinitely
  while the footprint triples past the ceiling — measured behavior, not
  cynicism. The budget needs an *enforcing backstop*: above a hard ceiling,
  the hook prunes the safest category automatically (checking first that no
  build is live, so it never yanks state from under a running compile) while
  staying fast and non-blocking in the common under-budget case. Advisory
  below the ceiling, automatic above it — that split preserves both trust
  and the bound.

Multiply the stakes by every checkout: worktrees and concurrent sessions each
carry their own build directories unless artifact sharing is deliberate, and
a per-checkout leak scales by the number of checkouts. Whoever creates a
build directory names what deletes it.

## Invalidation: key on everything that changes the answer

A cache hit is only a win if the entry is *correct for this build*. The key
must therefore include every input that changes the output: source content,
build settings, target platform, and — the one that gets missed —
**toolchain identity**. The host compiler's version and native architecture
are inputs; when they drift (a toolchain upgrade, a machine migration, an
emulation layer changing which architecture "native" means), a cache keyed
without them serves artifacts built for a world that no longer exists, and
the failure surfaces as baffling link errors or wrong-architecture binaries
far downstream of the cause.

Two hard rules fall out:

1. **Detect drift and invalidate wholesale.** A cheap routine check compares
   the recorded toolchain identity against the live one and clears (or
   partitions) the cache on mismatch. The check runs automatically before
   builds — drift arrives unannounced, so only an unconditional check
   catches it.
2. **Verify artifacts by inspection, not by label.** A cached binary artifact
   claims an architecture and format by its filename and origin; the bytes
   are the truth. Where a poisoned artifact has bitten once — a mislabeled
   upstream archive, a cache shared across architectures — the fix is a
   verifier that reads the artifact's actual machine type from its headers
   and repairs or replaces on mismatch, idempotently, as part of the routine
   build path. A gate that trusts the label passes exactly when the label
   lies, which is the case it exists for.

## Repair is loud, rebuild is the fallback

Every cache names its recomputation: the from-scratch path that produces the
same artifacts with no cache at all. This is the safety property that makes
aggressive pruning safe — the worst case of any eviction or invalidation is
one cold build, bounded and known. Two disciplines protect it:

- **Self-healing is idempotent and observable.** A verifier that silently
  swaps a poisoned artifact should still say so; a cache clear that falls
  back to rebuild should report "cache invalidated: <reason>" — a build that
  is mysteriously slow today because something silently went cold teaches
  developers the build is capricious, when it was actually correct.
- **"Could not check" is not "clean".** A cache verifier that fails to run —
  missing tool, unreadable metadata — must fail loudly or degrade to the
  safe action (invalidate), never report success. An unverified cache
  reported as verified is the most expensive kind of green.

## Measure the hit rate or stop claiming the cache works

The only evidence a cache earns its budget is a measured hit rate under real
workload: builds served warm versus cold, seconds saved versus the byte
ceiling paid. The number carries its scenario like every build number does —
which cache, which variant mix, which period. Caches that measure well get
bigger budgets; caches that never hit get deleted, which is also a valid
outcome of the audit. An unmeasured cache is indistinguishable from a
superstition with a directory.
