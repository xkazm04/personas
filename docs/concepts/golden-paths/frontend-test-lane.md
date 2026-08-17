# Golden path — Frontend test lane

> Situation node: `platform-delivery/testing-and-workflow/frontend-test-lane` · [situation spine](../situation-spine.md)
> recurrence **6** · risk **LOW** · sides **server** · convergence **mixed** · `twoSided: true`
> dimensions: **code-quality · cost**
> Leaf definition: *"Which of the runner configurations a new test belongs to."*
> Merged from **Frontend test lane selection**.
> Composed 2026-08-17 against `master` @ `dfd846b3b`. **Short form** (spine header, §0, §2, §7,
> §9, §12) per the runbook's Mode 2 tiering — `risk: low`.
>
> **Sweep.** All five `vitest.*.config.ts` at the repo root, read in full (19 / 17 / 18 / 13 / 22
> lines); `src/test/setup.ts` (47 lines); `lefthook.yml` (91 lines, every job); the vitest wiring
> in `.github/workflows/ci.yml`; `package.json`'s nine test scripts; and a full membership walk
> of the tree against each config's `include` globs.
>
> **Measured by executing.** `npm run test`'s whole default lane was run to completion with
> `--reporter=json`: **402 files claimed, 391 reported, 1,349 suites, 3,738 tests, 533 s wall,
> 1 failure.** Every number in §0 and §7 comes out of that JSON, not out of a config file. The
> eleven files in the gap were then re-run **directly**, four together and one alone, which is
> what produced §7 D0. `vitest.integration.config.ts` and `vitest.cli.config.ts` were each
> executed and their **raw exit codes** captured without a pipe. That execution overturned the
> brief's failure list and produced the headline — reading the configs would have got both wrong,
> and so would trusting the run report's own summary line.
>
> **`cargo` was not available in this session.** The Rust half of the two-sided claim
> (`npm run test:rust`) is reported from source and from `.claude/CLAUDE.md`, and is labelled as
> read, not run.

---

## 0. Headline

**`npm run test` reported `3,737 of 3,738 passed` over a denominator that had silently shrunk.
402 files match the default lane's own `include` glob; the run report accounts for 391. The
missing 11 carry 153 `it`/`test` calls, and the run's stdout named none of them — its entire
error output for the 533-second run was two jsdom canvas warnings. A suite that cannot tell
"everything passed" from "eleven files never started" is not a regression detector, whatever its
pass rate says.**

Run directly, those eleven files explain themselves — and the explanation is the same cost that
produces this leaf's famous "flaky 5-second timeouts":

```
$ npx vitest run <4 of the 11 absent files>          ; echo $?
  Error: [vitest-pool]: Failed to start forks worker for test files
    .../sub_mastermind/__tests__/layoutAuthorship.test.ts
  Caused by: Error: [vitest-pool-runner]: Timeout waiting for worker to respond
  Test Files  no tests      Tests  no tests      Errors  4 errors
  Duration  60.10s
  1

$ npx vitest run src/api/__tests__/events.test.ts    ; echo $?
  Test Files  1 passed (1)      Tests  11 passed (11)
  Duration  67.69s (transform 388ms, setup 12.55s, import 26.79s,
                    tests 3.23s, environment 24.17s)
  0
```

**The tests are 3.23 s of a 67.69 s file. Environment, import and setup are 63.5 s — 94%.** That
fixed per-file cost is what starves a worker into failing to start, and it is what the 5,000 ms
default `testTimeout` is really being spent on:

```
{"numTotalTestSuites":1349,"numTotalTests":3738,"numPassedTests":3737,
 "numFailedTests":1,"success":false,"wallMs":532549}

files with >=2 tests: 385 | first test is the slowest: 246 (63.9%)
median share of a file's test time spent in its FIRST test: 41.1%

  first= 3372ms  rest=   32ms  16 tests  99.1%  src/api/__tests__/credentials.test.ts
  first= 3365ms  rest=   23ms  19 tests  99.3%  src/api/__tests__/triggers.test.ts
  first= 3362ms  rest=  126ms   7 tests  96.4%  src/features/teams/sub_mastermind/__tests__/layoutStore.test.ts
  first= 3361ms  rest=   41ms  18 tests  98.8%  src/api/__tests__/observability.test.ts
  first= 3356ms  rest=   26ms  13 tests  99.2%  src/api/__tests__/memories.test.ts
  first= 3341ms  rest=   21ms   5 tests  99.4%  src/api/__tests__/settings.test.ts
  first= 3331ms  rest=   39ms  15 tests  98.8%  src/api/__tests__/system.test.ts
  first= 3325ms  rest=   45ms  11 tests  98.7%  src/api/__tests__/messages.test.ts

files whose FIRST test exceeds 50% of the 5000ms default timeout: 8
worst margin to timeout: 1628 ms
```

**And the lane carrying all of it is the only one of the five that sets no `testTimeout`.** The
7-test lane and the 6-test lane each declare 30,000 ms; the dead lane declares 180,000 ms; the
3,738-test lane runs on the framework's 5,000 ms default.

`src/api/__tests__/credentials.test.ts` is the clean case. Its sixteen tests are
`mockInvoke(name, value); expect(await fn()).toEqual(value)` — nothing asynchronous beyond a
resolved promise. **Fifteen of them cost 32 ms combined. The first costs 3,372 ms**, because the
first `it()` is where `import { listCredentials } from '@/api/credentials'` actually resolves and
transforms, and vitest charges that to the test rather than to the file.

So there is one cost with three faces. Small load: the first `it()` in a file eats most of the
timeout and everyone calls it a slow test. More load: the first `it()` crosses 5,000 ms and
*whichever file lost the race* reports a timeout — which is why the identity moves and why it
never reproduces. More still: the worker does not come up inside its own 60-second window, the
file is dropped, and **the summary line does not mention it**. They are not three bugs; they are
one fixed per-file cost read at three levels of contention. **In the full run, under concurrent
load from a sibling eslint pass, zero tests timed out — and eleven files vanished instead.**

The actual standing red baseline, among the files that did run, is **one test**, not six:

```
### src/stores/slices/overview/__tests__/personaHealthSlice.bundle.test.ts  (1 failing)
   • personaHealthSlice — health bundle falls back to the labeled fleet proxy when no
     per-persona stats exist
     AssertionError: expected 9200 to be 92
```

`9200` against `92` is the 100× unit bug, and it is the *only* failure in 3,738 tests. It is
also the one this repo already understands: `golden-path-doctrine.md` §1 Q1 cites it as the
earning case for *"a required prop carries only what it actually encodes"* — `successRateSource`
is a correctly-closed `'measured' | 'proxy'` union that could not prevent it, because the unit
lived in the number beside the tag, not in the tag.

And two of the five lanes are not lanes at all. Executed, raw exit codes, no pipe:

```
$ npx vitest run --config vitest.integration.config.ts   ; echo $?
  ...Module not found: './src/test/integration/integration-reporter'
  1
$ npx vitest run --config vitest.cli.config.ts           ; echo $?
  0
```

**`src/test/integration/` does not exist.** `vitest.integration.config.ts` imports a reporter
from inside it, so `npm run test:integration:cli` cannot load its own config — it does not find
zero tests, it fails to start. It is registered in `package.json` and referenced by nothing else.
Meanwhile `vitest.e2e.config.ts`'s five files all match the default lane's `src/**/*.test.{ts,tsx}`
glob as well, so they run twice: once as part of `npm run test` and once under the e2e reporter.

Finally, the coverage question the leaf implies — *which lane will actually run my test?* — has a
worse answer than the choice suggests:

| lane | files | `testTimeout` | pre-commit | pre-push | CI |
| --- | --- | --- | --- | --- | --- |
| `vitest.config.ts` (`npm run test`) | **402 claimed / 391 run / 3,738 tests** | **none — vitest's 5,000 ms default** | no | **no** | yes (`ci.yml:190`) |
| `vitest.cli.config.ts` (`test:cli`) | 7 | 30,000 ms | no | no | **no** |
| `vitest.e2e.config.ts` (`test:e2e:cli`) | 5 (**all 5 also in the default lane**) | none | no | no | **no** |
| `vitest.evals.config.ts` (`test:evals`) | 6 | 30,000 ms | no | **yes** | **no** |
| `vitest.integration.config.ts` (`test:integration:cli`) | **0 — config will not load** | 180,000 ms | no | no | no |

**The only vitest lane on a git hook is the six-file one.** The 3,738-test lane is gated by CI
alone; nothing local stops a red suite from being pushed. And nine `.test.mjs` files under
`scripts/` — five census instrument tests, `check-doc-sync`, `check-golden-path-touch`,
`build-golden-path-index`, and one athena eval — belong to **no lane at all** and are runnable
only by hand.

---

## 2. The one way

**A new frontend test goes in the default lane unless it needs something the default lane
cannot give it, and "needs something" means an environment, a timeout, a reporter or a
concurrency posture — never a taxonomy.** Concretely: (a) **default to `src/**/*.test.{ts,tsx}`**
— jsdom, `src/test/setup.ts`, the `@` alias, and the only lane CI runs; if your test can live
there, it lives there, because a test in any other lane is a test CI does not execute today.
(b) **Reach for a second lane only when a config field forces it** — `environment: 'node'` for
pure-Node code with no DOM, `pool: 'forks' / maxForks: 1 / fileParallelism: false` for anything
that touches a shared resource (a port, a database file, the `:17320` harness), a long
`testTimeout` for work that genuinely waits, or a custom reporter. Each of the four extra
configs here exists for exactly one of those reasons and each says so in a header comment; copy
that discipline — a lane with no field that differs from the default is not a lane, it is a
duplicate. (c) **Make lane membership disjoint by construction.** Give every non-default lane an
`include` glob whose *filename infix* the default lane cannot match, and — because
`src/**/*.test.ts` will always swallow `*.e2e.test.ts` — put non-default lanes' files **outside
`src/`** or add an `exclude` to the default config. Today neither is done and five files run
twice. (d) **Wire every lane you create to something that runs it**, in the same change: a
`package.json` script is not a gate, and a lane nothing invokes rots into
`vitest.integration.config.ts`, which has been unloadable for long enough that its whole source
tree was deleted around it. (e) **Set `testTimeout` explicitly on every lane, including the
default one** — an unset timeout is not "the sensible default", it is 5,000 ms measured against
a window that includes module transform, and this repo's biggest lane is the one running on it.
(f) **Do not fix a transform-bound timeout by raising the timeout.** Move the cost out of the
timed window (import in a `beforeAll`, so it is charged to `hookTimeout`) or pre-bundle the
graph; raising `testTimeout` hides the signal and buys a slower suite. (g) **Do not tolerate a
standing red.** One permanently failing test trains every reader to skim the summary line, and a
suite whose baseline is "3,737 of 3,738" cannot report a regression — the second failure looks
exactly like the first.

> **Read alongside three neighbours.** [`rust-unit-test-harness`](./rust-unit-test-harness.md)
> and [`rust-test-fixtures`](./rust-test-fixtures.md) own the server half of this leaf's
> `twoSided` claim, including why `npm run test:rust` exists at all (see §12.2).
> [`commit-path-gates`](./commit-path-gates.md) owns which hook a check belongs on, and its
> verdict — *put the check where it can still change what happens* — is what §0's coverage
> table is measuring against.

---

## 7. Deviations

Nine. D0-D4 were executed; the rest were measured.

### D0 — eleven files matching the lane's own glob are absent from its report, silently · executed

A membership walk of the tree against `vitest.config.ts:17` claims **402** files. The run report
contains **391**, all resolving to real files, no duplicates, and **zero entries that the glob
did not claim**. The eleven-file difference:

```
CLAIMED but absent from the run report: 11
  src/api/__tests__/events.test.ts                                        (11)
  src/api/__tests__/executions.test.ts                                    (10)
  src/api/__tests__/personas.test.ts                                      (20)
  src/features/agents/components/matrix/__tests__/BuildTemplateSuggestion.test.tsx  (8)
  src/features/agents/quick-answer/triage/__tests__/deckDialog.test.tsx   (13)
  src/features/agents/quick-answer/triage/__tests__/useUnifiedTriage.test.ts (44)
  src/features/overview/sub_manual-review/.../DispatchPanel.test.tsx      (16)
  src/features/plugins/fleet/sub_settings/__tests__/FleetSettingsPage.test.tsx (6)
  src/features/teams/sub_mastermind/__tests__/athenaPanel.test.tsx        (6)
  src/features/teams/sub_mastermind/__tests__/layoutAuthorship.test.ts    (11)
  src/hooks/design/__tests__/useDesignReviews.test.ts                     (8)
  -> it/test calls in absent files: 153
```

**The run's entire stdout for 533 seconds was three lines**: two
`Not implemented: HTMLCanvasElement's getContext()` warnings and `JSON report written to …`. No
error named any of the eleven. The JSON has no `numRuntimeErrorTestSuites` field, and
`numTotalTests: 3738` is computed over the 391 that reported.

Run directly, four of them together produce
`[vitest-pool]: Failed to start forks worker` / `[vitest-pool-runner]: Timeout waiting for worker
to respond`, `Test Files no tests`, `Errors 4`, exit 1 after 60.10 s. Run alone,
`events.test.ts` passes 11/11 in 67.69 s. So they are healthy tests losing a worker-startup race
under contention — which makes this **the same defect as D2 one level further along**, not a
separate one.

The part that is a defect regardless of cause: **`numTotalTests` is a count of what reported, and
nothing compares it to what was claimed.** A file that never starts is indistinguishable in the
summary from a file that does not exist. That is the shape `adding-a-ci-gate` names — a gate
whose green is computed over a population it did not verify — and it is why §9's declined
instrument leads with a claimed-versus-executed reconciliation rather than with a pattern.

### D1 — the biggest lane has no `testTimeout`; the two smallest have 30 s · executed

`vitest.config.ts` sets `environment`, `globals`, `setupFiles` and `include`, and no timeout.
`vitest.cli.config.ts:14` and `vitest.evals.config.ts:11` both set `testTimeout: 30_000` for 7
and 6 files respectively; `vitest.integration.config.ts:15-16` sets `180_000` plus a
`hookTimeout: 60_000` for a lane with no files. **The 3,738-test lane runs on the framework
default of 5,000 ms.** Eight of its files spend over half of that in their first test; the worst
leaves 1,628 ms of headroom on an idle-ish machine.

### D2 — the timeout is charged to the wrong thing, and the numbers are unambiguous · executed

Across the 385 files with two or more tests, **the first test is the slowest in 246 (63.9%)**,
and the **median file spends 41.1% of its total test time in its first test.** In the eight
worst, the first test is **96.4% to 99.4%** of the file. `src/api/__tests__/settings.test.ts` is
the extreme: `first=3341ms`, `rest=21ms`, five tests.

Those files are `mockInvoke` + `expect(await fn()).toEqual(...)`. `src/test/setup.ts` already
mocks `@tauri-apps/api/core` and `@tauri-apps/api/event` globally, so nothing in the test body
touches IPC. The 3.3 s is the module graph under `@/api/...` being transformed on first
reference, inside the timed window. **The cluster is uniform at 3.32-3.37 s across eight
unrelated files, which is the signature of a fixed cost, not of eight slow tests.**

Consequence, and it is the whole of the "flaky timeouts" reputation: this cost scales with
machine load, and the *first test of whichever file loses the race* is what reports a timeout.
It is non-deterministic in identity and deterministic in cause.

### D3 — one lane cannot load its own config; the tree it points at is gone · executed

```
$ npx vitest run --config vitest.integration.config.ts > /dev/null 2>&1 ; echo $?
1
```

`vitest.integration.config.ts:3` is `import IntegrationReporter from './src/test/integration/integration-reporter'`
and `:14` includes `src/test/integration/rounds/*.integration.test.ts`. `find src/test/integration`
returns *"No such file or directory"*. The config, the `IntegrationReporter` import, the 180 s
timeout, the serial forked pool and the `test:integration:cli` script all survive; the tests and
the reporter do not.

This is the failure mode `adding-a-ci-gate` catalogues, in its quietest form: not a gate that
runs green while checking nothing, but a gate that has been **exit 1 for an unknown period with
nobody watching**, because it is on no hook and in no workflow. Deleting the config and the
script is a real fix and it is a behaviour change to `package.json`, so it is recorded, not
applied.

### D4 — the standing red baseline is 1 test, not 6, and there are no timeouts in it · executed

The brief listed six pre-existing failures: five load-flaky 5 s timeouts plus a
`personaHealthSlice` 100× unit bug. The full run produced **1 failing test in 3,738**, and it is
the unit bug. **Zero timeouts.** The slowest twelve tests in the suite are 2,098-3,645 ms, all
under the 5,000 ms ceiling, and ten of the twelve are the first-test cluster from D2.

The correction matters in both directions. The five timeouts are not fixed — D2 shows the
mechanism is fully intact and the margin is 1.6 s — but they are also **not properties of five
identifiable tests**, so a bug list that names them is naming symptoms. The honest statement is
"eight files are within 1.6 s of a timeout under load", and that is actionable where "five flaky
tests" is not.

### D5 — five files are claimed by two lanes and run twice

`vitest.e2e.config.ts:15` includes `src/test/e2e/cli-*.e2e.test.{ts,tsx}` — five files. Every one
of them also matches `vitest.config.ts:17`'s `src/**/*.test.{ts,tsx}`, because
`cli-stream-core.e2e.test.ts` ends in `.test.ts`:

```
vitest.config.ts (npm run test)  x  vitest.e2e.config.ts (test:e2e:cli)  =  5
    src/test/e2e/cli-healing-stream.e2e.test.ts
    src/test/e2e/cli-line-classification.e2e.test.ts
    src/test/e2e/cli-scenario-streams.e2e.test.ts
    src/test/e2e/cli-stream-core.e2e.test.ts
    src/test/e2e/cli-terminal-rendering.e2e.test.tsx
```

The default lane has **no `exclude`**, so vitest's built-in excludes (`node_modules`, `dist`,
`.git`, `.cache`, …) are all that scope it. The five run under both configs with the same jsdom
environment and the same setup file, differing only in reporter. Nothing is wrong with the
result; the cost is that the e2e lane's *purpose* — a distinct reporter for CLI stream
scenarios — is unreachable from the only invocation anyone runs.

### D6 — the 3,738-test lane is on no git hook

`lefthook.yml` declares two hooks and ten jobs.

- `pre-commit`: `eslint-staged`, `gitleaks-staged`, `i18n-no-gaps`, `i18n-no-untranslated`.
- `pre-push`: `typecheck`, `golden-path-census`, `i18n-coverage`, **`evals` (`npm run test:evals`
  — six files)**, `ai-conformance`, `ai-context-freshness`.

`npm run test` appears in neither. `.github/workflows/ci.yml:190` (`npm run test -- --run`) is
the only place it runs. So the suite that would catch a frontend regression is 533 s away from
the developer and behind a network round trip, while the six-file eval lane is on pre-push. The
ordering is defensible on wall-clock grounds — `commit-path-gates` measures pre-push at ~218 s
for typecheck alone — but it should be a decision, and the decision is not written anywhere.

### D7 — `test:cli`, `test:e2e:cli` and `test:integration:cli` are in no gate at all

Grepping the workflows for vitest returns exactly one line — `ci.yml:190`. Three of the five
lanes are therefore invoked only by a human typing the script name. `test:cli` currently exits
0 over 7 files; `test:e2e:cli` is covered incidentally by D5; `test:integration:cli` exits 1
(D3). **A lane's health and a lane's reachability are independent, and only one of them is
visible in CI.**

### D8 — nine test-shaped files belong to no lane

A membership walk of the tree against all five `include` globs leaves nine `.test.mjs` files
unclaimed:

```
scripts/census/lib/instruments/__tests__/{extractFences,extractRustStrings,matchJsxTags,stripCfgTest,stripComments}.test.mjs
scripts/census/__tests__/build-golden-path-index.test.mjs
scripts/docs/__tests__/check-doc-sync.test.mjs
scripts/docs/__tests__/check-golden-path-touch.test.mjs
scripts/test/lib/eval/athena.test.mjs
```

These are deliberate zero-dependency assertion scripts — `check-doc-sync.test.mjs` carries 30
assertions and its own runner, and `.claude/CLAUDE.md` documents running it with plain `node`.
That is a legitimate style. What is not legitimate is that **the instruments the entire
golden-path census depends on have tests that no automated gate executes** — `stripCfgTest`,
`matchJsxTags` and `stripComments` are the three functions whose bugs the doctrine records as
having corrupted published measurements. The 32 `tests/playwright/*.spec.ts` files are correctly
outside every vitest lane and are not counted here.

---

## 9. The gate — declined, with the instrument specified

**No census rule is proposed for this leaf, and the decline is the finding.**

Every condition worth gating here is an **absence or a relation**, and the census ratchets a
count of something present:

| what should be enforced | why the census cannot |
| --- | --- |
| the run executed every file its glob claimed (D0) | a comparison between an inventory and a runtime report; neither side is a text pattern |
| every lane's `include` matches ≥ 1 file | an absence — a rule matching zero files fails structurally, so "this glob matches nothing" is inexpressible |
| every lane loads without throwing | requires *executing* the config, not scanning text |
| the lanes' file sets are pairwise disjoint | a relation between two globs; no single pattern sees both |
| every lane is reachable from a hook or a workflow | a set-covering assertion across `package.json`, `lefthook.yml` and `.github/workflows/**` — the same shape `check-csp-hosts.mjs` had to be written for |
| every lane declares an explicit `testTimeout` | an absence again |
| the suite has no standing failure | requires running 533 s of tests |

Two countable candidates were considered and both refused on numbers. A rule on
`\.e2e\.test\.` (the double-claimed files) has an anchor of **5 files** and would ratchet a
symptom of D5 rather than the glob overlap that causes it. A rule on `testTimeout` counts the
**3** lanes that do it right, which is a compliance count, not a violation count, and the census
fails a rule that drops — so the correct direction is unrepresentable.

**The instrument this leaf actually wants is ~60 lines, and it is an inventory comparison.**
`scripts/check-test-lanes.mjs`:

1. Glob `vitest*.config.ts` at the repo root. **Exit 2 if fewer than 3 are found** — a rename or
   a move must fail loudly, not silently reduce the population to zero. This is the clause D3's
   config has been missing for its entire dead life.
2. `await import()` each one. A config that throws is a **failure**, printed with its module
   error. That alone catches D3 in one run.
3. Resolve each `include` against the tree. **Zero matches is a failure**, naming the lane.
4. Intersect the resolved sets pairwise. **A non-empty intersection is a failure**, listing the
   shared files — D5, with the fix (an `exclude` on the default lane, or moving the files out of
   `src/`) implied by the output.
5. Assert every lane declares `testTimeout`. Report the value; **absent is a failure**, because
   the default is 5,000 ms and D2 shows what that budget is really spent on.
6. Cross-reference each lane's `package.json` script against `lefthook.yml` and
   `.github/workflows/**`. A lane invoked by nothing is a **warning with a named lane**, not a
   failure — D6 shows this can be a deliberate cost decision, and a gate that cannot tell a
   decision from an oversight should say so rather than block.
7. **The one that matters most, and the one nothing in this repo does today:** given a JSON run
   report, assert that every file the lane's glob claims appears in `testResults`. Print the
   difference by name. This is D0 in four lines, it needs no new concept, and it converts a
   silently-shrinking denominator into a named list. It belongs *in CI beside `npm run test`*
   rather than in the structural checker, because it needs a run report as input — which is also
   why the census cannot host it.

It belongs on **pre-push**, beside `golden-path-census`: it is fast (five dynamic imports and a
glob walk), it is about repository structure rather than about the code being committed, and its
verdict can still change what happens. Per the standing rules this is **specified, not
installed** — adding a pre-push job changes what happens when the operator pushes. Registered as
**deferred fix #74**.

**And the one thing that is not a gate at all:** D2's fix is a config change, not a check. The
right move is to stop charging module transform to the first test — hoist the import into a
`beforeAll` (where it lands on `hookTimeout`, default 10,000 ms and separately tunable) or
pre-bundle the graph via `deps.optimizer` — and *then* set an explicit `testTimeout` that means
what it says. Raising the timeout first would delete the only visible symptom of a real cost.

---

## 12. Corrections

### 12.1 — to the brief: six failures, and the five that were not there

The brief stated the suite is *"Known-green except **6 pre-existing failures** — 5 load-flaky 5 s
timeouts and a `personaHealthSlice` 100× unit bug"*, and framed the leaf as *"a suite with a
standing red baseline that everyone steps over."*

Executed: **1 failure in 3,738 tests**, the unit bug. **Zero timeouts**, in a run that was itself
competing with a concurrent eslint pass. The slowest test in the suite is 3,645 ms against a
5,000 ms ceiling.

The brief's framing survives — a standing red is a standing red, and one permanent failure is
enough to train a reader to skim — but its *evidence* was five tests that do not exist as a
stable set. What exists is a **mechanism** (D2): eight files whose first test consumes 66-72% of
the timeout on module setup, from which a load-dependent, identity-shifting timeout is the
expected output. **A bug list naming five tests would have been closed by a re-run; the mechanism
would not.** This is the difference between a symptom inventory and a cause, and only executing
the suite distinguishes them.

**And the brief's premise — "a suite with a standing red baseline that everyone steps over is a
suite that cannot detect a regression" — is right for a reason better than the one it gives.**
The threat is not that a reader habituates to one red line; it is D0, where the suite reports
green-but-for-one over a denominator that dropped eleven files and 153 tests without printing
anything. Habituation is a human failure mode you can train out. A summary computed over an
unverified population is a *structural* one, and it would have looked identical if all eleven
files had been deleted.

I also cannot confirm the "2,400+ tests" figure from `.claude/CLAUDE.md`'s command table: the
measured total is **3,738**. A ledger entry from 2026-08-09 records 3,833. The number moves; the
command table should not carry one.

### 12.2 — the Rust half of the `twoSided` claim, read and not run

`cargo` was unavailable, so this is reported from source and from `.claude/CLAUDE.md`, and
labelled accordingly. `npm run test:rust` (`scripts/build/run-rust-tests.mjs`) exists because
plain `cargo test` exits **127 (`0xc0000139`)** on Windows with no output — a *loader* failure,
not a test failure: the tauri dialog path reaches `rfd`, which imports `TaskDialogIndirect`, and
that symbol lives only in the **comctl32 v6** side-by-side assembly. `tauri-build` embeds the
manifest that requests it into BIN targets, so the app has always worked and the **lib unit-test
binary** carries no manifest and dies before `main()`. The wrapper re-embeds the manifest
post-link with the Windows SDK's `mt.exe`.

It cannot be fixed in `build.rs`, and the reason is a genuine cargo gap worth naming here because
it is the server-side mirror of this leaf's whole subject: **cargo has no directive that targets
the lib unit-test binary.** `rustc-link-arg-tests` reaches only `tests/` integration targets; the
catch-all `rustc-link-arg` also hits the app binary (`CVT1100: duplicate resource`) and the
cdylib (`LNK1327`). So the Rust side has the identical shape as D1-D8 on the frontend — *the
lane you actually run most of your tests in is the one the tooling gives you least control
over* — and it resolved it the same way, by wrapping the invocation in a script.

Two adjacent notes from the ledger, unverified this session: `run-rust-tests.mjs` is **not
concurrency-safe** across sessions sharing one cargo target directory (`mt.exe` collides on the
shared test exe; two concurrent `cargo test` runs hit `LNK1104`), and `cargo test --lib` beats an
exe lock where a full `cargo test` does not.

### 12.3 — my two implementations disagreed on the file count, I guessed at the reason, and the guess was wrong twice

A glob walk resolved the default lane's `include` to **402** files; the run reported **391**. My
first written explanation was that the gap was "vitest resolving the playwright glob differently
plus files registering zero tests". **Both halves were invented.** `tests/playwright/` holds
exactly one `.test.ts` and it ran; no claimed file registers zero tests. The gap is D0 — eleven
files that lost a worker-startup race — and it took running them to find out. A plausible
reconciliation written from the shape of two numbers is not a reconciliation.

Then the instrument that was supposed to settle it produced a **second** wrong answer, and this
one is the doctrine's own trap wearing my name. My relativiser was

```js
p.replace(/\\/g, '/').split('/personas/')[1]
```

which truncates any path containing a second `personas` segment — and this repo has
`src/features/personas/` and `src/lib/personas/`. Two files therefore printed as the bare
directory names `src/features` and `src/lib`, one of them as an entry in a "slowest files" table
(`3489ms  13 tests  src/features`), and the truncated names then collided in a `Set`, turning
391 entries into 387 "unique" ones and inventing a four-file discrepancy that does not exist.
**A measurement truncated by its own display path, reported as a finding** — exactly what the
doctrine records about a grep ending in `head -3`, committed while writing a document that cites
it. Fixed by slicing at the *first* occurrence: 391 entries, 391 unique, all resolving to real
files, zero entries the glob did not claim.

Published figures: **402 claimed, 391 executed, 11 unaccounted (153 `it`/`test` calls)**, with
both numbers kept because D0 and D5 are about claiming and D2 is about executing.

### 12.4 — spine labels

**`sides: "server"` is contradicted, and the direction is inverted.** Every artifact in this
document is frontend or build-tooling: five vitest configs, a jsdom setup file, `lefthook.yml`,
`ci.yml`, and 391 `.ts`/`.tsx` test files under `src/`. The Rust half exists (§12.2) and is
owned by two other leaves. Both the headline defect and the declined gate are client-side.

**`twoSided: true` holds, for a structural reason worth naming.** The two halves are not
mirror images and neither is derivable from the other — the frontend question is *which of five
overlapping globs claims my file*, the Rust question is *why does the default invocation fail to
load at all*. But they rhyme: in both, the lane carrying the overwhelming majority of tests is
the one the tooling under-serves, and both were answered by wrapping the invocation rather than
by fixing the configuration. That is a real two-sidedness, not a bookkeeping one.

**`convergence: mixed` was not tested.** The short-form tier does not include a sibling sweep,
and a per-repo test-lane comparison would have been most of the session's budget. Recorded as
untested rather than silently omitted — an untested `convergence` label is what thirteen
previous leaves were before they failed. One adjacent data point is already on record and is
*not* mine: two published paths cite `personas-web`'s `vitest.config.ts:32` as including only
`src/**/*.test.ts` and excluding `.tsx` — an under-scoped invocation of exactly the D5 family. I
verified those citations are about the **sibling**, not this repo, and this repo's line 17
correctly includes both extensions; no correction is owed to either path.
