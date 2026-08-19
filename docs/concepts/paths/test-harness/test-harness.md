---
layer: golden-path
subject: test-harness
status: forged
techniques:
  - suite-partitioning
  - fixture-economics
  - live-app-harness
  - isolation-lanes
  - platform-quirk-absorption
  - long-lane-certification
evidence:
  - vitest.config.ts                          # default lane; one of 6 per-suite runner configs (.cli/.e2e/.evals/.integration + playwright)
  - vitest.integration.config.ts              # per-suite config with its own budgets: forks pool, maxForks 1, 180s timeouts
  - playwright.config.ts                      # the serial law stated in config with its reason attached (singleton companion session, workers: 1)
  - src-tauri/db/src/lib.rs                   # migrated_template(): build-once-copy-per-test, pid-keyed, stale reap, copy proved openable (89s -> 2.9s, 81aba23de)
  - scripts/build/run-rust-tests.mjs          # platform-quirk absorption: pre-main loader death (0xc0000139) fixed post-link, dead ends documented in the header
  - scripts/test/launch-isolated.mjs          # clean-environment launcher: fresh data dir, shifted ports, names its residual seam (webview storage)
  - tests/playwright/companion-bridge.ts      # typed control-surface client; fire-and-forget /eval vs awaited readback; endpoint quirks captured
  - scripts/test/chaos.mjs                    # long lane: two-phase mark/verify chaos around an operator-performed restart
counter_evidence:
  - .github/workflows/e2e-smoke.yml           # the lane that never passed: red 38 of 38 runs since inception, born broken, nobody noticed
deviations:
  - w6-test-harness   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Test harness architecture

A test harness is the machinery between "tests exist" and "tests inform
decisions." The tests themselves assert facts; the harness decides which facts
get checked, when, against what environment, at what cost, and how the answer
reaches a human while it still matters. Most suites that rot do not rot at the
assertion level — they rot at the harness level: everything runs everywhere,
feedback arrives too late to act on, fixtures cost so much that nobody adds
tests, and the one lane that could catch real defects has quietly never worked.

The subject boundary: this standard owns the machinery. How non-deterministic
model behavior gets judged is the eval-harness subject; where in the delivery
pipeline each suite is allowed to block is the quality-gates subject. The
harness builds the machines; quality-gates decides which doors they guard.

## A suite is a machine, not a tag

The foundational mistake is treating "the tests" as one population filtered by
labels inside one configuration. A unit suite, an integration suite, an
end-to-end suite, and a soak lane are **different machines**: they have
different time budgets, different parallelism, different environmental
requirements (nothing / containerized services / the real product), different
failure semantics, and different default schedules. Forcing them through one
configuration means the fastest lane inherits the slowest lane's setup cost and
the question "what exactly runs on commit?" has no answer short of executing
the filter logic in your head.

The correct shape is a **portfolio**: one configuration per suite, membership
decided by location rather than annotation, and a partition so legible that a
directory listing reads as the answer to "what runs where." The
[suite-partitioning](techniques/suite-partitioning.md) technique carries the
full decision table.

## The fidelity ladder — and what each rung buys

Suites arrange on a ladder of fidelity versus cost:

| Rung | Verifies | Budget | Runs |
| --- | --- | --- | --- |
| unit | pure logic in isolation | milliseconds per test, seconds per suite | every save / commit |
| integration | components against real infrastructure (a real store, a real queue) | seconds per test | commit / push |
| end-to-end | assembled flows through the product's own entry points | tens of seconds per test | push / merge |
| live-app | the actual shipped process, driven from outside | minutes, serial | scheduled + on demand |
| long lanes | endurance, load, chaos — behavior over time | hours | nightly / weekly |

Two disciplines make the ladder honest. First, **each defect class is caught at
the cheapest rung that can see it** — a validation bug caught in the live-app
lane is a unit test that was never written, paid for at a thousand times the
price. Second, **the top rungs exist because the bottom rungs see proxies**.
Unit and integration tests exercise the code as the test imports it, not the
product as it ships: wiring, packaging, startup ordering, singleton
initialization, and inter-process boundaries are all invisible below the
live-app rung ([_laws: gate-sees-target_](../_laws.md#gate-sees-target)). A
harness with no lane pointed at the real running product has a permanent blind
spot exactly where integration risk concentrates. The
[live-app-harness](techniques/live-app-harness.md) technique owns that lane.

## Fixtures are an economic asset

The single largest lever on suite speed is rarely the assertions — it is setup.
An expensive environment (a migrated schema, a seeded dataset, a compiled
artifact) must be **built once and copied per test**, never rebuilt per test.
The copy operation is cheap precisely because it does no logic; the build
operation is allowed to be expensive precisely because it amortizes across the
whole suite. Get this backwards and the suite's runtime grows linearly with its
test count until adding a test becomes an act of self-harm — at which point
people stop adding tests, which is the actual failure.

The build-once asset introduces two obligations: the template must name what
rebuilds it and when (a stale fixture validates yesterday's world with today's
green checkmark), and seeded data must be honest about which invariants it
carries. Both live in [fixture-economics](techniques/fixture-economics.md).

## Isolation is a property of the lane, not the test

Whether tests may run in parallel, whether they share state, and what
environment they inherit are decided **per suite** by what that suite touches
— never rediscovered per test through flakes. Pure-logic suites parallelize
freely. Suites touching a shared store need per-worker isolation. And a product
that is structurally a singleton — one port, one data directory, one exclusive
handle on a system resource — **cannot run two live instances**, so its
live-app lane is serial by law of the product, not by timidity of the harness.
Writing that constraint into the lane's configuration converts an intermittent
mystery into a stated property. Clean-environment launchers, fresh-profile
runs, and the singleton catalog live in
[isolation-lanes](techniques/isolation-lanes.md).

## The harness absorbs platform pain — once

Every platform has a class of failure that fires **before the first test
runs**: a loader that rejects the binary, a missing runtime manifest, a
mislabeled cached artifact, a sandbox rule that differs between the developer's
machine and the runner. These failures are maximally confusing — the process
dies with no output, which reads as "zero tests, exit code, nothing" — and
maximally repetitive: every engineer hits the same wall independently.

The standard is absorption: the harness's launcher detects the condition,
repairs or works around it, and **converts silence into a named diagnosis**
([_laws: failure-not-empty-success_](../_laws.md#failure-not-empty-success)).
The fix is written once, in the one wrapper every invocation goes through, and
it carries the story of where it bit — because a quirk fix without its incident
attached is the first thing a future cleanup deletes. See
[platform-quirk-absorption](techniques/platform-quirk-absorption.md).

## Lane health: green must be earned, red must be loud

Two failure modes destroy a harness's authority, and both are silent.

**A lane that has never passed.** A suite can be added, wired into the
pipeline, and fail 100% of its runs from inception — and if nothing
distinguishes "this lane is red because the product broke" from "this lane has
never once been green," the failures become wallpaper and the lane certifies
nothing while appearing to exist. A lane earns trust only after it has been
observed green on a good build **and** observed red on a known-bad one; until
both observations exist it is scaffolding, not a gate. Track first-green as an
explicit event, and treat a lane with a 100% historical failure rate as a
missing feature in the harness, not as a noisy suite.

**A flaky test deleted instead of quarantined.** A test that fails
intermittently is reporting something — about the test, the harness, or the
product — and deleting it converts that report into silence at the exact site
where visibility existed
([_laws: deletion-is-not-repair_](../_laws.md#deletion-is-not-repair)). The
standard is **loud quarantine**: the test moves to an explicitly named
quarantine set that still runs but does not block, with an owner and an entry
date, reviewed on a schedule. Quarantine that grows without review is deletion
with extra steps; the reviewing is the discipline.

Retries deserve the same honesty: an automatic retry that hides the first
failure is flake-masking; a retry that **records** the first failure while
salvaging the run is flake-measurement. The count of retried tests is a health
metric of the harness, and like any count it travels with its predicate
([_laws: count-carries-predicate_](../_laws.md#count-carries-predicate)).

## Long lanes are certifications, not gates

Endurance, load, and chaos runs answer questions no per-change gate can:
does memory grow over hours, does throughput hold at concurrency, does the
system recover from injected failure. They run on their own clock (nightly,
weekly, pre-release), judge against **statistical criteria** (percentiles,
ceilings, survival durations) rather than boolean assertions, and produce
artifacts whose value is the trend line across runs. Blocking a pull request on
a soak run misunderstands both; the design of these lanes is
[long-lane-certification](techniques/long-lane-certification.md).

## The techniques

- [suite-partitioning](techniques/suite-partitioning.md) — one configuration
  per suite, membership by location, the cost-tier table, and what runs at
  commit / push / merge / nightly.
- [fixture-economics](techniques/fixture-economics.md) — build-once-copy-per-
  test, fixture freshness and its rebuild trigger, seeded-data honesty.
- [live-app-harness](techniques/live-app-harness.md) — driving the real
  product through a test-only control surface: serial constraints, readback
  for fire-and-forget operations, the test-identifier contract.
- [isolation-lanes](techniques/isolation-lanes.md) — clean-environment
  launchers, fresh profiles, the singleton catalog, parallelism as per-suite
  policy.
- [platform-quirk-absorption](techniques/platform-quirk-absorption.md) —
  pre-main failures solved once in the runner, silence converted to diagnosis,
  the incident story kept attached.
- [long-lane-certification](techniques/long-lane-certification.md) — chaos /
  load / soak as scheduled lanes with statistical pass criteria, lane-health
  bookkeeping, and quarantine review.
