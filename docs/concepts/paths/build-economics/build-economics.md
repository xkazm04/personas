---
layer: golden-path
subject: build-economics
status: forged
techniques:
  - compilation-unit-splitting
  - capability-feature-gating
  - cache-budgeting
  - build-measurement
  - dev-variant-design
  - debug-artifact-economics
evidence:
  - src-tauri/Cargo.toml                          # workspace split members + feature tiers (desktop/desktop-full/ml/p2p) + per-profile debuginfo dials ([profile.test] debug=0, dev line-tables-only)
  - scripts/build/sample-build-memory.ps1         # peak-RSS sampler; header records the 8.9 GB → 6.2 GB split win and the honest one-variable comparison
  - scripts/build/crate-split-deps.mjs            # dependency-graph closure probe that planned the crate split
  - scripts/cache-budget.mjs                      # byte-budgeted target-dir cache with prune order + hard-ceiling self-healing backstop
  - scripts/check-build-cache.mjs                 # toolchain host-triple drift detector (stale-rlib contamination)
  - scripts/ensure-ort-cache.mjs                  # cached native artifact verified by machine-type inspection, not label
  - scripts/build/guard-concurrent-cargo.mjs      # refuses a second concurrent heavy build on one checkout
  - .claude/CLAUDE.md                             # the lite-vs-full dev-variant routing table ("Picking dev variants")
counter_evidence:
  - docs/development/build.md                     # the cleaning ladder + build claims documented in parallel with the entry-point docs — the multi-copy drift the one-authority posture warns about
deviations:
  - w6-build-economics   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Build performance & economics

The build is the loop everything else runs inside. Every edit, every test run,
every "does it still start" check is priced in build time, and that price is
paid at the highest possible frequency — per iteration, per developer, per day.
A feature costs its build tax once per change forever after; nothing else in
the engineering budget compounds at that rate. This subject treats the build as
an economic system with three scarce resources — **wall-clock, peak memory,
disk** — and holds one central claim: the day-to-day build cost curve is a
designed artifact, not weather.

The boundary: the release pipeline and packaging (a sibling subject) own what
it costs to *ship* — installers, signing, distribution, release-shaped
optimization. This subject owns what it costs to *iterate*: the build a
developer runs between two thoughts. The two pull in opposite directions
(release builds trade time for runtime quality; dev builds trade runtime
quality for time), and most build-cost defects come from letting one side's
settings leak into the other's loop.

## The tax compounds into behavior

Build cost is not just lost minutes; past a threshold it changes what
developers *do*, and the behavioral damage dwarfs the arithmetic:

- **They stop running the real thing.** When the full application takes too
  long to start, people iterate against a fragment — a test harness, a
  storybook, a unit in isolation — and integration defects arrive later, in
  batches, where they are most expensive.
- **They batch changes.** A ten-minute rebuild teaches everyone to make five
  changes per build. Batched changes mean batched failures, and bisecting a
  batch costs more builds — the tax raises itself.
- **They stop verifying.** The gap between "I think this works" and "I watched
  it work" widens exactly as the cost of watching rises. Slow builds are a
  direct input to unverified claims of completion.
- **They fear the clean build.** When cold builds are catastrophic, developers
  nurse stale incremental state long past the point of trusting it, and lose
  hours to phantom defects that a rebuild would have dissolved.

Because the damage is behavioral, the budget must be set where behavior breaks,
not where hardware complains. The binding constraint is the *weakest machine a
developer actually uses* — a build that fits comfortably on the strongest
workstation and swaps to death on the median laptop has failed its budget, and
the failure is invisible to whoever set it.

## Three budgets, one binding constraint

- **Wall-clock** is the iteration tax itself. It splits into cold (nothing
  reusable), warm (dependencies built, own code rebuilt), and incremental (one
  change propagated) — three different products with different budgets. The
  incremental figure is the one developers live in; the cold figure is the one
  new machines, fresh checkouts, and cache disasters live in. Optimizing one
  can worsen another; report them separately or the numbers lie.
- **Peak memory** is a cliff, not a slope. Averages are irrelevant: one link
  step or one oversized compilation unit sets the peak, and the peak decides
  whether the build *completes at all* on the median machine, whether it can
  run alongside an editor and the application under test, and whether two
  builds can coexist. Peak memory is a per-moment property — sampled, not
  inferred from totals.
- **Disk** is the slow leak. Build directories, per-variant artifacts, and
  download caches grow monotonically unless something is charged with pruning
  them; multiply by worktrees and concurrent sessions and "the build works"
  becomes "the disk is full" on a schedule. Everything the build creates must
  name its reaper.

At any moment one of the three binds. Find which — by measurement, on the
weakest supported machine — before spending effort, because work on a
non-binding axis is invisible: halving wall-clock does nothing for the
developer whose build dies at the memory peak.

## The dependency graph is the cost model

What a change costs to rebuild is decided by the shape of the dependency
graph, not by the size of the change. A one-line edit in a unit that everything
depends on rebuilds the world; the same edit in a leaf rebuilds the leaf. Two
graph properties price every build:

- **The invalidation frontier**: from the touched unit, everything downstream
  rebuilds. Wide, flat graphs with heavy roots have enormous frontiers; deep
  edits into stable, rarely-touched roots should be rare by design, and
  frequently-edited code should live in leaves.
- **The parallelism frontier**: independent units build concurrently; a chain
  builds serially. The longest dependency chain is the floor on cold-build
  wall-clock no matter how many cores are available — and one giant unit is a
  chain of length one that also owns the memory peak.

This is why splitting compilation units is the structural move of the whole
subject: it buys parallelism and shrinks invalidation frontiers at the cost of
maintaining interface boundaries — and the boundaries are usually an
architectural improvement someone should have demanded anyway. The technique
covers where to cut and how to prove the win.

## Defaults decide the daily cost

Whatever the default build variant includes, every developer pays for on every
iteration — a heavy capability in the default is a tax on people who never use
it. The remedy is structural: heavy optional capability (an inference runtime,
a transport stack, an embedded database engine with large native dependencies)
lives behind a build-time gate, the default variant excludes it, and the full
variant exists for the minority of work that needs it. The switch cost — one
recompile of the gated units when you cross over — is paid occasionally by the
few instead of always by everyone.

Two disciplines keep this honest. The gated code must still be compiled
somewhere routinely (a gate nobody builds behind is where rot accumulates
unseen), and the variant map — which work needs which variant, what the cheap
variant cannot exercise — is written down in one authoritative place, because a
developer who cannot tell whether their task needs the full build will either
pay for it unnecessarily or lose an afternoon to a capability that was
compiled out. The feature-gating and variant-design techniques split this
between mechanism and product.

## Caches are budgeted, not hoarded

Every cache in the build system — incremental state, downloaded dependencies,
per-variant artifacts — is a bet that a future build will reuse the entry. A
bet has a price (bytes, and the risk of staleness) and a payoff (rebuild time
saved, times the probability of a hit). Treat it that way:

- a cache has a **byte budget** and a pruner that enforces it, not a directory
  that grows until the disk intervenes;
- a cache has a **measured hit rate** — an entry that is never hit is pure
  cost, and only measurement distinguishes the caches that earn their bytes
  from the ones that merely occupy them;
- a cache **keys on everything that changes the answer** — toolchain identity,
  target platform, build settings. A cache keyed too narrowly serves poisoned
  artifacts across a toolchain change, and those failures surface far from
  their cause. Verify the artifact's measured properties, not its label.

## Measurement precedes optimization

Every claim in this subject is quantitative, and build folklore is wrong often
enough that unmeasured optimization is negative-expected-value work. The
discipline is small and non-negotiable: wall-clock and peak memory are sampled
by scripts (not recalled from impressions), each number names its scenario —
cold or incremental, which variant, which machine — and any claimed
improvement ships as a before/after pair measured under identical conditions.
A build change that arrives without numbers is a hypothesis, not a win. The
measurement technique defines the instruments; every other technique in this
subject depends on them for its proof obligations.

## The techniques

- [compilation-unit-splitting](techniques/compilation-unit-splitting.md) —
  cutting the graph for parallelism, invalidation locality, and a lower memory
  peak; where to cut and how to prove the win.
- [capability-feature-gating](techniques/capability-feature-gating.md) — the
  mechanism for compiling heavy optional capability out of the default
  variant, and the switch-cost economics that justify it.
- [cache-budgeting](techniques/cache-budgeting.md) — caches under a byte
  budget with measured hit rates, and invalidation keyed on toolchain
  identity so drift cannot serve poison.
- [build-measurement](techniques/build-measurement.md) — wall-clock and
  peak-memory sampling as scripts, scenario-labeled numbers, and the
  before/after discipline behind any claimed win.
- [dev-variant-design](techniques/dev-variant-design.md) — the cheap daily
  driver as a product: choosing the default, routing work to variants, and
  keeping the lite build's blind spots documented rather than discovered.
- [debug-artifact-economics](techniques/debug-artifact-economics.md) — debug
  information and link-time choices as line items, and the hazards of build
  directories shared across concurrent sessions.
