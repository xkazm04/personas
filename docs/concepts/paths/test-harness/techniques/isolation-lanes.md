---
layer: technique
subject: test-harness
technique: isolation-lanes
status: forged
laws: [creation-names-reaper, gate-sees-target]
shared_with: []
---

# Isolation lanes

Isolation answers one question per suite: **what may this suite's tests
inherit, and from whom?** The answers form lanes — configurations of
environment, parallelism, and reset policy — and the technique is to make
each lane's answer explicit, enforced by the harness, and impossible to
violate by accident.

## The inheritance ledger

Every lane declares what its tests inherit:

- **From the developer's machine**: nothing, ideally. A test that reads the
  developer's real profile, real configuration, or real credentials passes on
  one machine and fails on the next, and — worse — can *mutate* the
  developer's world. The fix is the clean-environment launcher below.
- **From the previous test**: nothing in parallel lanes (each worker owns its
  copy — see [fixture-economics](fixture-economics.md)); in serial lanes, a
  defined reset between tests, because serial tests share the single instance
  by construction.
- **From the previous run**: nothing, and this is the one everyone forgets.
  Scratch state that survives a crashed run poisons the next run with
  yesterday's world. Every temporary profile, port claim, and scratch
  directory names its reaper
  ([_laws: creation-names-reaper_](../../_laws.md#creation-names-reaper)) —
  and because a crashed run's reaper never fired, launchers reap *stale
  leftovers at startup* as well as their own droppings at exit.

## The clean-environment launcher

A launcher is a small program that constructs the world a test process runs
in, then starts it. It creates a fresh profile directory, points every
environment knob the product honors at that directory, seeds it from the
fixture tier the lane requires (or leaves it virgin for first-run tests),
allocates ports, starts the process, and tears the world down afterwards.

Three rules make launchers trustworthy:

1. **The launcher is the only entrance.** If tests can also be started raw —
   inheriting whatever world the invoker happened to have — the lane's
   isolation guarantee is folklore. Wire every path (local convenience
   scripts, the pipeline, documentation) through the launcher.
2. **First-run flows get a virgin profile, not a cleaned one.** Onboarding,
   migration-from-nothing, and default-generation paths behave differently in
   a directory that was scrubbed than in one that never existed. "Fresh"
   means *created empty by the launcher*, and a lane that certifies first-run
   behavior says so in its name.
3. **The launcher asserts its own preconditions.** A launcher that silently
   falls back to the real profile when the environment knob is ignored has
   inverted its purpose — the suite goes green against the wrong world
   ([_laws: gate-sees-target_](../../_laws.md#gate-sees-target)). Verify the
   process actually adopted the constructed world (probe where it wrote its
   startup state) before running a single test.
4. **The launcher names its residual seams.** No launcher isolates
   everything: an embedded browser shell keeps its own storage outside the
   profile directory, a system secret store is machine-global, a graphics or
   font cache persists. The honest launcher documents, at its own front door,
   exactly what it does *not* isolate and where that seam is closed instead
   (a reset step at the test layer, an explicit scrub, or an accepted
   exposure). An isolation guarantee with an undocumented exception is not a
   smaller guarantee — it is a trap for the first test that depends on the
   exception being covered.

## The singleton catalog

Some resources admit exactly one holder per machine: a fixed listening port,
a named data directory, the operating system's secret store, a hardware
device, a global registration. Each such resource forbids a second live
instance of whatever holds it — and therefore forbids parallelism for any
lane that runs the real product.

The technique is to **catalog these singletons explicitly** in the harness
documentation and encode their consequence in lane configuration: the
live-product lane declares serial execution *with the catalog as the stated
reason*. The alternative — leaving parallelism on and letting the second
instance lose the port race — produces the worst diagnostic in testing: an
intermittent failure whose frequency depends on scheduler luck. A constraint
stated is a constraint enforced; a constraint discovered per-flake is
re-discovered forever.

Where parallelism genuinely matters for a singleton-bound product, the
options are structural, not configurational: virtualize the singleton (per-
instance ports and directories, if the product supports parameterizing them),
or containerize per worker. Both are product changes; the harness cannot
conjure isolation the product does not offer.

## Parallelism as declared policy

The composite picture, per lane: pure-logic lanes run **wide** (parallel
workers, no shared state); infrastructure-backed lanes run **per-worker
isolated** (each worker its own copied fixture); live-product lanes run
**serial** (singleton catalog). The declaration lives in each lane's own
configuration — which is one of the standing arguments for one configuration
per suite in [suite-partitioning](suite-partitioning.md) — so the policy is
read where the lane is defined, not inferred from where it flakes.
