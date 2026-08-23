# Golden path — Timeout tiering

> Situation node: `backend-runtime/resilience-policies/timeout-tiering` ·
> [situation spine](../situation-spine.md) · recurrence 15 · risk **HIGH** ·
> sides **server** · convergence **diverged** ·
> dimensions: **resilience · function · cost · code-quality**
> Composed 2026-08-16 against `master` @ `46b882a31`.
>
> **Sweep size.** All **963** non-generated `.rs` files under `src-tauri/` (agrees
> exactly with `rust.files` in [`shared-facts.json`](../shared-facts.json), reached
> by an independent walk) and all `.ts`/`.tsx` under `src/`. `#[cfg(test)]` was
> removed by a **brace-matched, string/comment-aware range**, never a line
> threshold. The comment stripper was rewritten mid-composition after it ate
> `https://` and manufactured three phantom "derived constants" — the exact trap
> [the doctrine names](../golden-path-doctrine.md#2-measurement-rules), committed
> and caught. Every headline count was taken twice; where the two disagreed, the
> disagreement is reported and resolved (§6).
>
> **Measured by executing, not reading.**
> 1. The operator's live **`personas.db` (347 MB) and `personas_data.db` were
>    copied and opened `readOnly`** — the live files were never opened for write.
>    2,188 executions, 78 personas, 205 healing issues, 12 build sessions.
> 2. **2,942 real execution traces were parsed and the inner timeout's clock
>    offset measured** — `min = 11 ms`, `p50 = 395 ms`, `max = 15,254 ms`. That
>    single number is what proves which of two nested timeouts fires first, and it
>    cannot be obtained by reading either file.
> 3. **The error classifier was replayed by hand against the exact string the
>    outer timeout writes**, walking all ten arms of
>    `core/src/error_taxonomy.rs:141-300`. It falls through to `Unknown`.
> 4. The census rule and its positive control were **run against the real runner**
>    (`scripts/census/run-census.mjs`) before being written down, then re-extracted
>    from this document and re-run.
>
> **`cargo` was not run** (the operator's app is running). Every Rust claim is
> static and traces to a file read during composition.
>
> **A convergence sweep** ran against `brainiac`, `personas-web`, `personas-cloud`,
> `vibeman` and `ascent`. **5 of 5 reachable, none silent.** It inverted one
> prescription outright and supplied the type answer in §10.
>
> ### Sibling boundaries, settled in prose
>
> [**outbound-http-call**](./outbound-http-call.md) owns *which client you take and
> what it does to a credential*. **This path owns the number you hand it, and every
> other number that answers "how long is too long".** That path's §7 preamble names
> the gap — *"there is no factory that takes a deadline"* — and hands the
> consequence here: this document reports **1 required-deadline factory in 963
> files**, and it is `build_ssrf_safe_client`.
>
> [**job-claim-and-lease**](./job-claim-and-lease.md) owns the claim and its undo.
> **A lease is a timeout**, so this path owns `claim_expires_at` *as a duration* —
> where the number came from and who reads it. Its answer confirms and sharpens
> that document's D1: **0 of 2,188 executions and 0 of 12 build sessions carry the
> lease**, so it is the only timeout in the tree whose expiry no reader consults.
>
> [**terminal-state-and-recovery**](./terminal-state-and-recovery.md) owns *what a
> reaper writes*. This path owns *the threshold the reaper fires on*, and finds
> the two reapers over one table disagree about which column to read.
>
> [**background-loop**](./background-loop.md) and [**polling-loop**](./polling-loop.md)
> own the cadence a tick repeats at. This path owns the deadline a single unit of
> work is given.
>
> [**metric-definition**](./metric-definition.md) owns whether a number means what
> it says. §7 D3 is a live crossover: a duration written as a constant rather than
> measured, wrong by up to 2 h 41 m.
>
> The **Deviations** section is a fix backlog and contains **one closed
> self-defeating loop** (D1) that is live right now on 22 of 78 personas.

---

## 0. The headline: healing's remedy for a timeout is to disable the timeout

Two `tokio::time::timeout` calls wrap every persona execution, and they are both
20 minutes for 28% of this installation's personas.

```
outer   src/engine/mod.rs:246,:364      timeout(ENGINE_MAX_EXECUTION_SECS = 20 min, run_execution(..))
  inner src/engine/runner/mod.rs:2051   timeout_duration = from_millis(persona.timeout_ms || 660_000)
        src/engine/runner/mod.rs:2080   timeout(timeout_duration, <the stdout stream loop>)
```

The inner clock starts later — after validate, credential resolution and process
spawn. **Measured across 2,942 real execution traces: the stream span begins at
minimum 11 ms, median 395 ms, maximum 15,254 ms after the outer clock.** So an
inner deadline of exactly 1,200,000 ms lands at `T0 + 1,200,011` in the most
generous case observed — 11 ms after the outer ceiling has already killed the run.

| live `timeout_ms` | personas | inner deadline | vs outer `T0+1,200,000` | verdict |
|---:|---:|---|---|---|
| 300,000 | 3 | `T0+300,011` | under | inner can fire |
| 600,000 | 23 | `T0+600,011` | under | inner can fire |
| 900,000 | 30 | `T0+900,011` | under | inner can fire |
| **1,200,000** | **21** | `T0+1,200,011` | **over** | **unreachable** |
| **1,800,000** | **1** | `T0+1,800,011` | **over** | **unreachable** |

**22 of 78 personas (28.2%) have a stream timeout that cannot fire.** Live
corroboration, from 2,188 executions: **13** ever recorded the inner message and
the largest is `"Execution timed out after 900s"` — **never 1200s, at any point in
the history of this database**. **12** recorded the outer one.

That would be a tolerable redundancy if the two paths were equivalent. They are
not, and the mechanism that puts personas at 1,200,000 is the app's own
self-healing.

**`core/src/healing.rs:390-391`:**

```rust
let new_timeout = std::cmp::min(current_timeout_ms.saturating_mul(2), MAX_TIMEOUT_MS);
```

`MAX_TIMEOUT_MS` is `ENGINE_MAX_EXECUTION_SECS * 1000` (`healing.rs:122`) — the
identical value as the outer ceiling. **1,200,000 is the fixed point of healing's
own remedy**: 300k → 600k → 1.2M, and it stays there. Live: **23 healing issues
titled "Execution timed out" across 21 distinct personas; 15 are
`auto_fixed = 1`; and 16 of those 21 personas now sit at ≥ 1,200,000.**

Once a persona is at the fixed point, every overrun takes the outer path — and
the outer path is not recognised as a timeout at all:

- `src/engine/mod.rs:414-417` writes `"Engine safety ceiling exceeded (20m).
  Execution forcibly terminated."`
- `src/engine/mod.rs:2903` — `let timed_out = error_str.contains("timed out");`
  → **false**.
- `core/src/error_taxonomy.rs:141-300` — replayed by hand through all ten arms
  (rate-limit, session-limit, timeout, provider-not-found, credential, network,
  tool, api, validation, transient, boot-recovery). The string matches **none**
  of them → **`Unknown`**.
- `core/src/error_taxonomy.rs:318` — `is_auto_fixable(Unknown)` → **false**.

**Live proof, from the join:** all **6** healing issues attached to a
ceiling-terminated execution read `"Execution failed"`, category `external`,
`auto_fixed = 0`, `status = open`. Zero auto-fixes. Same for all **19** on
zombie-reaped runs.

> **The loop closes.** A timeout fires → healing doubles the timeout → the
> timeout reaches the ceiling → the timeout can no longer fire → the ceiling
> fires instead → the ceiling is not a timeout → healing stops. **The remedy
> disables the diagnosis.** Nothing in the type system, the tests, or
> `npm run check` has an opinion about the relation `inner < outer`, because
> neither number knows the other exists.

And the outer path is lossy in three more ways, all live:

- **`duration_ms` is a constant, not a measurement.** `src/engine/mod.rs:418`
  writes `duration_ms: ENGINE_MAX_EXECUTION_SECS * 1000`. All 12 ceiling rows
  report exactly 1,200,000 ms. Real `completed_at − started_at` ranges **1,183 s
  to 10,850 s**. Eleven of twelve disagree; one is wrong by **9,650 s (2 h 41 m)**.
- **Cost and tokens are zero** for all 12 — the file says why (the CLI emits its
  cost summary only on the final `result` line), which is honest and still means
  a 3-hour run bills invisibly.
- **The PID had to be reaped by hand** (`mod.rs:396-403`), because dropping the
  runner future skipped `unregister_pid`.

### The number underneath all of it

**377 named duration-family constants in 963 Rust files. Five reference another
constant. Two of those five are unit conversions of the same value
(`ENGINE_MAX_EXECUTION_MS`, `MAX_TIMEOUT_MS`); two are inside `#[cfg(test)]`.**

**Exactly one production constant in this repository expresses a relationship
between two different durations:**

```rust
// src/commands/credentials/oauth.rs:1232
const OAUTH_STATE_MAX_AGE_SECS: u64 = OAUTH_SESSION_TTL_SECS + 5 * 60;
```

**1 of 377. 0.27%.** Every other threshold in the engine is a number someone
chose, and the relations between them — which one must be larger, which one is
the sum of the others — live in prose, in a comment, or nowhere.

---

## Principle (stack-free head)

Per the [portability test](../research/portability-test.md), the head is
physically separated and each clause carries its warrant, so an adopting repo can
tell physics from local calibration. No file path, primitive name or count
appears below this line until the head ends.

> **P1 — physics.** Every operation that can block needs a bound, because the
> thing you are waiting on has no obligation to finish. *The absence of a bound is
> a decision, and it is always the wrong one.* This clause is settled; it is the
> only one in this document that every surveyed codebase already agrees with.
>
> **P2 — physics, and it is the whole subject.** *A timeout is not a property of
> an operation. It is a relationship between an operation and everything that
> waits on it.* A deadline chosen without naming the thing on the other side of
> the relation is a guess, and it will be wrong in one of exactly two directions:
> too short and it kills healthy work, too long and it is not a bound at all.
>
> **P3 — physics, and the one that surprises people.** *Where two bounds nest,
> only one of them is real.* The outer bound wins whenever it is smaller — and it
> is also smaller when the two are EQUAL, because the inner clock necessarily
> starts later. An inner bound greater than or equal to its outer bound is not
> redundant safety; it is dead configuration that a reader will mistake for a
> live control. Therefore: **the ordering of nested bounds must be a fact the
> build can check, not a fact a comment asserts.**
>
> **P4 — physics, and the highest-value single clause here.** *A retry budget
> multiplies.* N attempts each allowed a full per-attempt deadline, separated by
> backoff, is `N × deadline + Σbackoff` of wall clock. Any bound that sits above
> the retry loop and was sized against the *per-attempt* number will fire in the
> middle of legitimate work. The correct outer bound is derived from the retry
> plan; it is not a constant multiple of the inner one, and *"twice the timeout"*
> is the specific wrong answer people reach for.
>
> **P5 — physics.** *A liveness signal and the threshold that judges it are one
> decision.* "Declare dead after three missed heartbeats" is the durable
> statement; `90` is a value that stops meaning that the moment the heartbeat
> cadence changes. Write the multiple, not the product.
>
> **P6 — physics.** *A bound that does not cancel the work is a bound on the
> caller's patience, not on the work.* Where the transport cannot cancel — an IPC
> bridge, a fire-and-forget RPC, a detached process — expiry means the caller
> stops waiting while the effect continues. Retrying such a call duplicates the
> effect. The expiry must therefore be sized to *exceed* the work, not to bound
> it, and the type must say so.
>
> **P7 — ergonomics, and this is what makes P2–P6 fail in practice.** *A number
> nothing can reference cannot participate in a relationship.* A deadline written
> inline at the site that applies it has no name, so no other bound can be derived
> from it, no test can assert its ordering, and a reader cannot find its
> counterpart. Naming a duration is not style — it is the precondition for every
> other clause in this document.
>
> **P8 — physics.** *A tier must know it is a tier.* Where several thresholds
> judge one lifecycle — a silence warning, a per-attempt deadline, a hard
> ceiling, a reaper sweep — each must be defined in terms of its neighbour, and
> the terminal state each writes must be distinguishable, because the remedy for
> "stalled" is not the remedy for "over budget".
>
> **P9 — physics, and it is where the money is.** *A timeout that fires is a
> measurement.* What the run cost, how long it actually took, why it stopped —
> these are exactly the facts the next decision needs, and the expiry path is the
> one path most likely to synthesise them instead of recording them. A duration
> written as the constant you timed out at, rather than the time that elapsed,
> is a lie the system will later believe.
>
> **P10 — ergonomics.** *Every layer that can time out owes a calibration record.*
> Not a comment restating the unit ("30s timeout"), but where the number came
> from: what was measured, what it must exceed, and what would make it wrong. A
> number with no provenance cannot be safely raised, lowered, or trusted.
>
> **Scale condition.** P1 pays on the first call. P7 pays the second time anyone
> reads the file. P2, P3 and P5 bite the first time two bounds coexist — which is
> immediately, because a client timeout inside a request handler is already two.
> P4 pays the first time a retry loop is added above an existing deadline. P6 pays
> at the first cross-process boundary. P8, P9 and P10 pay when someone has to
> explain a production incident.

### Warrant evidence — five siblings, censused independently

`brainiac` (Rust, 8 crates), `ascent` (Next.js/Prisma), `personas-cloud` (TS
monorepo + Python facade), `vibeman` (Next.js + Tauri), `personas-web` (Next.js).
**All five present, all five opened, none silent.**

- **P1 is the most replicated clause in the fleet and needs no further argument.**
  Every repo bounds its network calls; `brainiac` writes the reason down twice in
  two different crates with no shared helper. Already established by
  [outbound-http-call](./outbound-http-call.md) §6. Not re-derived here.

- **P2 does NOT converge, and Personas is last by an order of magnitude.**
  Counting constants whose initializer or call-site expression is computed from
  another duration:

  | repo | derived | named duration constants | rate |
  |---|---:|---:|---:|
  | `brainiac` | 6 | 22 | **27%** |
  | `ascent` | 8 | 73 | **11%** |
  | `personas-cloud` | 2 | 25 | 8% |
  | `personas-web` | 3 | 43 | 7% |
  | `vibeman` | 1 | 95 | 1% |
  | **Personas** | **1** | **377** | **0.27%** |

  Every repo mostly writes numbers. **But three of them wrote at least one bound
  as a function of the thing it bounds, and Personas' one instance is an OAuth
  state age.** The single best example in the fleet is
  `brainiac/crates/brainiac-gateway/src/providers/vertex.rs:152` — the token-cache
  TTL is the *provider's own returned `expires_in`* minus a 60 s skew, with the
  comment *"Refresh a minute early so an in-flight call never races expiry."* It is
  not a chosen number; it is a function of an upstream fact.

- **P3 is convergent as a DEFECT and Personas is not alone.** `vibeman` has the
  same shape from the other end: `src/lib/scanQueueWorker.ts:19`
  `DEFAULT_SCAN_TIMEOUT_MS = 5 min` wraps `src/lib/llm/base-client.ts:294`+`:289`,
  a 5-minute per-attempt deadline × 3 attempts ≈ **15 minutes**. The outer wins,
  so the inner client's *entire retry configuration is dead configuration inside a
  scan*, and neither file references the other. `ascent` has a documented
  inversion (`llmTotalBudgetMs("claude-cli") = 900_000` under a
  `maxDuration = 300` route) whose safety rests on the prose invariant *"it runs
  on a long-lived server (never serverless)"* — asserted nowhere in code.
  **Three repos, three inversions, zero machine checks.**

- **…except one, and it is the answer.** `brainiac/crates/brainiac-core/src/health.rs:223`:

  ```rust
  const { assert!(LIBRARY_GATE_SLO_SECS > REVIEW_SLO_SECS) };
  ```

  with the reasoning at `:218-222` — *"If this ever inverts, someone has confused
  the two queues. **Checked at compile time — the relationship is a fact about two
  constants, so it should fail the build, not a test run.**"* This is the single
  strongest result in the sweep. A sibling repo, in the same language, with no
  shared document, independently arrived at P3 **and** at the mechanism §10
  recommends. It is nine words of Rust.

- **P4 converges, and the two best statements of it are in two different repos —
  and one of them is in THIS one.** `ascent/src/lib/scan.ts:377-381` names the
  hazard exactly: *"Each attempt enforces its own per-call timeout
  (LLM_TIMEOUT_MS), but the resilience plan (primary + retry + failover)
  MULTIPLIES them — three ~60s attempts can burn ~181s and blow the serverless
  function timeout BEFORE the mock degrade ever runs… Cap the TOTAL time across
  attempts."* And `db/src/repos/resources/automations.rs:548-561` in this repo
  independently rejects the specific wrong answer by name: *"The previous
  heuristic (2× `timeout_ms`) could reap a run that was still legitimately inside
  its retry-backoff budget… A 5-attempt / 30s-timeout automation can therefore
  legitimately run for 5×30s + (1+2+4+8)s = 165s, yet 2×30s = 60s would reap it
  mid-retry."* **Two authors, two languages, no contact, same argument, same
  rejected heuristic. P4 is physics.**

- **P5 converges as a near-miss in three repos at once.** `daemon/lock.rs:52-57`
  here: *"The daemon writes a heartbeat every [`HEARTBEAT_INTERVAL`]; 90s gives
  three missed heartbeats"* — with an intra-doc link to the constant, and the
  value written `Duration::from_secs(90)`. `personas-cloud` splits the identical
  pair across two packages: `orchestrator/src/workerPool.ts:62-63`
  (`HEARTBEAT_INTERVAL_MS = 30_000`, `HEARTBEAT_TIMEOUT_MS = 90_000`) and
  `worker/src/connection.ts:15` (`HEARTBEAT_INTERVAL_MS = 30_000` again) — three
  literals, two packages, an unexpressed 3× contract, **and no comment at all**,
  while `packages/shared/` — which exists for exactly this — holds no timing
  constants. `vibeman/src/lib/claude-terminal/orphanReaper.ts:107-111` is the only
  one that states the relation and it, too, writes the product. **Everyone
  discovers the ratio; nobody encodes it.**

- **P6 is nearly silent, and Personas is ahead.** `src/lib/tauriInvoke.ts:115-136`
  gives the error a field — `readonly backendMayStillBeRunning = true` — and a
  paragraph naming the at-least-once hazard, then routes the fix to a named
  registry rather than to per-call judgement. `personas-cloud` reaches the same
  conclusion from a socket rather than a bridge
  (`orchestrator/src/workerPool.ts:64-74`: *"**Contract**: Worker reconnect always
  means execution loss… There is no execution handoff mechanism"*). The other
  three repos have nothing. **Two of six, and this repo has the better of the two.**

- **P7 has no champion anywhere; the fleet ranges from 1:1 to 16:1.**
  Inline-literal vs named deadlines: `vibeman` **39 inline : 40 named**, and 85 of
  224 timer calls end in a bare number; `personas-web` 6:4; `ascent` 2:7;
  `personas-cloud` **1:16**, the best ratio measured; `brainiac` effectively 100%
  named. **Personas sits at 55 : 46 at the application site** — closer to
  `vibeman` than to `brainiac`. §9 gates this end.

- **P8 is silent, 6 of 6.** No repo has a module that lays out the tiers of one
  lifecycle. **And "put the timeouts in one file" must be reported as a REFUTED
  prescription, not a silent one** — it was actively tried and it failed twice.
  `vibeman` has **four** competing partial centers and **two of them both declare
  themselves the single source of truth for cache TTLs**, with different values;
  `CACHE_TTL_MS` is independently redeclared **six** times. `personas-web` has a
  real `src/lib/timings.ts` that explicitly scopes itself to UX cadences and
  excludes network timeouts, and its own stated rule (*"add a named variant here
  rather than hardcoding ms in the section"*) is already violated in two sections.
  `brainiac` — the repo with the best discipline in the fleet — has **0 of 22** in
  a central module, by design, keeping every constant at its point of authority
  with a justification attached. **Centralisation is not the mechanism; local
  derivation is.** This inverts the prescription I would otherwise have written,
  and §2 states the corrected form.

- **P9 is silent 6 of 6 as a stated principle**, and Personas is the only repo
  measured to violate it in production data (D3, 11 of 12 rows wrong, one by
  2 h 41 m). Treat P9 as strong reasoning with weak external warrant.

- **P10 has exactly one instance in the entire fleet, and it is worth copying
  verbatim.** `ascent/src/components/report/scanEstimate.ts:7-10`: *"CALIBRATION:
  measured across the team's repos (scripts/scan-timing harness…). Clean wall
  times: 272/337/357/367/397/486s (median ≈ 360s, p90 ≈ 490s); one large repo ran
  >11min and degraded to mock. **Re-measure and lower these if the model
  changes.**"* A measured distribution, a named harness, and an instruction for
  the next person. **One of 261 named duration constants across five sibling
  repos.** Personas has zero — until this document, whose 2,942-trace offset
  measurement is the first one (§6).

- **A required-deadline factory is a minority practice that works everywhere it
  is tried.** `brainiac` has three (`queue::read(pool, queue, n, visibility_secs)`
  — you cannot claim a job without naming a visibility window); `ascent` has two
  (`fetchWithTimeout(url, init, ms, signal?)`, positional and required);
  `personas-cloud` makes `ExecAssign.config.timeoutMs` **non-optional on the wire
  protocol** — *and then defaults it at all four producers*, so the type is
  required and never forces a decision, which is [Q3](../golden-path-doctrine.md#1-prefer-a-type-over-a-gate--and-the-seven-qualifications)
  in the wild; `vibeman` 0; `personas-web` 0. **Personas has one:
  `build_ssrf_safe_client(timeout: Duration)`.**

- **The convergent defect that most resembles ours belongs to a port of our own
  engine.** `personas-cloud` has **four disagreeing ceilings for one field**:
  `schemas.ts:97` accepts up to 600,000; `db.ts:244` defaults 300,000;
  `httpApi.ts:2373` `MAX_TIMEOUT_MS = 120_000` clamps on two paths
  (`:1347`, `:1634`) and **`dispatcher.ts:1352` applies no clamp at all**. So the
  same persona's timeout is 120 s, 300 s or 600 s depending on which door the
  execution came through. **Personas has the identical defect with different
  numbers** (§7 D2: 1,200,000 in validation, 1,800,000 in the UI, 1,800,000 in
  `ai_healing`, and the UI's comment claims they match). Two codebases, one
  lineage, the same bug reinvented — which is the best available evidence that a
  ceiling stated in more than one place will drift.

---

## 1. Trigger

You are in this situation when you are about to type or say:

- "how long should we wait for this?" · "give it 30 seconds" · "that should be
  plenty"
- "it timed out, let's bump the timeout"
- "mark it failed if it's been running too long" · "reap the stale ones"
- "how long is the lease / the lock / the claim good for?"
- "the frontend gives up before the backend finishes"
- "add a retry" — *to something that already has a deadline above it*
- **If you are about to type `timeout(`, `Duration::from_secs(`,
  `claim_expires_at`, `datetime('now', '-N minutes')`, `setTimeout`,
  `AbortSignal.timeout(`, or `timeoutMs:` — you are in this situation.**
- If you are about to write a constant whose name contains `TIMEOUT`, `TTL`,
  `STALE`, `DEADLINE`, `GRACE`, `REAP`, `THRESHOLD` or `BACKOFF`, you are in this
  situation, and **§2 says the first thing to write is not the number.**

**Not this path:** *how often a loop repeats* is
[background-loop](./background-loop.md) / [polling-loop](./polling-loop.md);
*which client you take and what it does to a credential* is
[outbound-http-call](./outbound-http-call.md); *the compare-and-set that takes the
work* is [job-claim-and-lease](./job-claim-and-lease.md); *what a recovery pass
writes* is [terminal-state-and-recovery](./terminal-state-and-recovery.md); *the
user pressing Stop* is [cancelling-in-flight-work](./cancelling-in-flight-work.md).

## 2. The one way

**Before you write the number, write down what it must be larger or smaller than —
and then write the number as that expression, in code, next to the constant it
depends on.** Concretely: (a) **name it.** A deadline typed inline at the site
that applies it can never enter a relationship with any other deadline; hoist it
to a `const` with a doc comment. (b) **Find its neighbour.** Every new bound sits
inside or outside an existing one — a per-attempt deadline inside a total budget,
a total budget inside a request ceiling, a heartbeat cadence inside a staleness
threshold. Name the neighbour in the initializer: `STALE = HEARTBEAT * 3`, not
`STALE = 90`. (c) **If the inner one has retries, derive the outer from the retry
plan, not from a multiple of the inner** — `attempts × per_attempt + Σbackoff +
grace`, the way `automations.rs:564-593` computes it per row in SQL; *"twice the
timeout"* is the specific wrong answer and that file rejects it by name. (d)
**Assert the ordering where the compiler can see it.** Two `const`s whose relative
size is load-bearing get `const { assert!(A > B) };` — nine words, no test run,
no reviewer required (`brainiac/crates/brainiac-core/src/health.rs:223`); where a
value is runtime data rather than a constant, clamp it *at the point of
application*, not only where it is recorded. (e) **Do not build a central
`timeouts` module** — that was tried in two sibling repos and produced competing
sources of truth; keep the constant at its point of authority and put the
*relationship* in the initializer. (f) **Write the calibration, not the unit.**
*"30s timeout"* restates the code; *"p90 of 2,942 measured runs is 915 ms; this
must exceed it and must stay under the 20-minute ceiling"* is the sentence that
lets the next person change it safely. (g) **On expiry, record what happened —
elapsed time, cost, tokens, and a message that your own error classifier
recognises.** A synthesised duration is worse than a null one, and a terminal
message that falls through your classifier's ladder silently disables every
remedy keyed on it. (h) **If the bound cannot cancel the work** — an IPC bridge,
a detached process, a fire-and-forget RPC — say so in the error type and size the
bound to *exceed* the work rather than to bound it (`tauriInvoke.ts:115-136`
already does both). Then stop: do not add a third threshold to a lifecycle that
already has four, and do not raise a timeout to fix a timeout without checking
what now sits above it.

If you must get one right first: **(b)**. (a) and (f) are legibility; (c), (d)
and (g) are the specific failures below. **(b) is the one that fails silently and
permanently, and whose absence a comment will happily deny.**

## 3. Mandated primitives

**Exist today — use them:**

| primitive | what it gives you |
| --- | --- |
| `db/src/repos/resources/automations.rs:564-593` `reap_stale_runs` | **the one threshold to copy.** Computed per row, in SQL, from the work's own `attempts × timeout_ms + backoff_sum(attempts) + REAP_SAFETY_GRACE_MS`. Its doc (`:545-561`) states the arithmetic AND names the heuristic it replaced. If you are about to type a number, read this first |
| `db/src/repos/resources/automations.rs:543` `REAP_SAFETY_GRACE_MS` | the additive cushion, separated from the budget so it can be reasoned about alone: *"Guards against clock skew and the small window between a webhook returning and `finalize_run` writing the terminal status"* |
| `src/engine/runner/mod.rs:58` `DEFAULT_EXECUTION_TIMEOUT_MS` + `:3122-3131` | **the only ordering assertion in the tree.** 660,000 ms chosen to sit above the Claude CLI's 10-minute subagent-stall cutoff, with a unit test that fails if it stops doing so, and a handoff document named. Copy the *pattern*; §10 says why the test should be a `const { assert! }` |
| `src/lib/tauriInvoke.ts:305` `invokeWithTimeout` + `:69-81` `BLOCKING_MUTATION_TIMEOUTS` | the frontend's one door. The override table is a **registry with an admission rule** (`:62-64`: blocking + mutating + can exceed 90 s) and names the exception it deliberately excludes and why |
| `src/lib/tauriInvoke.ts:128` `InvokeTimeoutError.backendMayStillBeRunning` | P6 as a field. The one place in the fleet where "this bound does not cancel anything" is in the type rather than in folklore |
| `src/api/director.ts:113-123` `directorBatchTimeoutMs` | **the only derived IPC timeout in 1,459 call sites.** `max(30 min, N × 15 min)`, where 15 min traces to the backend's `2 × DIRECTOR_RUN_TIMEOUT + overhead`, and the comment records the incident that produced it: *"The old 420s ceiling rejected mid-run while the backend kept evaluating and writing verdicts; a user retry then spawned a duplicate concurrent cycle"* |
| `src/daemon/lock.rs:50-60` `STALE_THRESHOLD` / `HEARTBEAT_INTERVAL` | the clearest *statement* of P5 in the tree — three missed heartbeats, with the reasoning for both bounds. **The relation is in the prose, not the code** (§7 D5); fix that and this becomes the exemplar |
| `core/src/limits.rs:15` `ENGINE_MAX_EXECUTION_SECS` + `:1-10` | the ceiling, and a module header explaining why it lives in `core` rather than the engine. The value is right; §7 D1/D2 are about who else knows it |
| `src/engine/mod.rs:387-410` | the ceiling's expiry handler, which correctly reaps a PID the dropped future left behind and says why in nine lines. Everything except `duration_ms` (§7 D3) is right |
| `core/src/url_safety.rs:268` `build_ssrf_safe_client(timeout: Duration)` | **the only door in 963 files that will not construct without a deadline.** Convergent with `brainiac/queue.rs:114` and `ascent/host.ts:70` |
| `db/src/repos/execution/executions.rs:1481` `find_silent_running` | the earliest tier, correctly separated: it emits a passive event and **changes no status** (`background.rs:3237`), so a warning cannot be mistaken for a verdict |

**Do NOT build:** a `timeouts.rs` / `timings.ts` module (§Principle P8 — refuted
in two sibling repos); a second reaper over a table that already has one; a
threshold as `2 × <the inner timeout>` (`automations.rs:548` names why); a
`STALE = 90` beside a `HEARTBEAT = 30`; a frontend `timeoutMs` for a command whose
backend budget you have not read; a bare `Duration::from_secs(N)` inside a
`timeout(...)` call (§9); a retry loop above an existing deadline without
recomputing the bound above *both*.

## 4. Steps

1. **Say out loud what the number bounds, and what waits on it.** If you cannot
   name the thing on the other side of the relation, you are guessing. This is
   the step 322 of 377 constants in this repo skipped.
2. **Search for the neighbour before you pick a value.** Grep the lifecycle for
   `TIMEOUT|TTL|STALE|DEADLINE|CEILING|REAP` and read what already judges this
   work. The persona-execution lifecycle has **five** tiers (90 s silence · 11 min
   default stream · 20 min ceiling · 30 min running reap · 60 min queued reap);
   adding a sixth without reading the other five is how §7 D1 happened.
3. **Write the constant as an expression over its neighbour.**
   `const STALE: Duration = Duration::from_secs(HEARTBEAT_SECS * 3);` — and if the
   relation is a sum of a retry plan, write the sum
   (`automations.rs:572-593` does it in SQL, per row, which is harder and still
   worth it).
4. **Ask the type-over-gate question now, before §9.** For two constants whose
   ordering matters, the answer is `const { assert!(A > B) };` and it costs one
   line. For a runtime value clamped against a constant, the answer is that the
   clamp must be applied where the value is *used*, not only where it is
   *recorded* — §7 D1 has the clamp at `runner/mod.rs:546` writing an
   `ExecutionConfig` field, and the unclamped value at `:2046` driving the actual
   `timeout()`.
5. **If anything retries inside your bound, recompute the bound.**
   `attempts × per_attempt + Σbackoff + grace`. Then check what is above *your*
   bound and repeat. `ascent/src/lib/scan.ts:377-381` and
   `automations.rs:548-561` are the two write-ups worth reading.
6. **Decide what expiry writes, and check it against your own classifier.** Open
   `core/src/error_taxonomy.rs:141` and walk your message through the ladder. If
   it lands in `Unknown`, every remedy keyed on the category is now off for this
   failure — which is §7 D1's second half and was invisible for as long as the
   ceiling has existed.
7. **Record the elapsed time, not the deadline.** `Instant::elapsed()`. A
   constant in the `duration_ms` column is a fabricated measurement that a KPI,
   a cost report and a heatmap will all later believe (§7 D3).
8. **Write the calibration comment.** What you measured, what it must exceed,
   what would make it wrong. Copy the shape of
   `ascent/src/components/report/scanEstimate.ts:7-10`.
9. **On the frontend, read the backend constant before choosing `timeoutMs`.**
   The four installer commands in §7 D4 are on the 90 s default against a
   1,200 s backend budget. If the command blocks, mutates, and can exceed 90 s,
   it belongs in `BLOCKING_MUTATION_TIMEOUTS` — that table's admission rule is
   already written at `tauriInvoke.ts:62-64`.
10. **And then stop.** Do not add a tier. Do not raise a timeout to fix a
    timeout. If a bound keeps firing, the finding is about the work, not the
    number — and `healing.rs:372-388` already knows that, which is why it
    escalates to `CreateIssue` after `MAX_RETRY_COUNT`.

## 5. Anti-patterns

| Anti-pattern | Failure mode |
|---|---|
| **An inner bound ≥ its outer bound** | Not redundancy — *dead configuration that reads as a live control*. The inner clock starts later, so equal means the outer always wins. **Measured: 11 ms is the smallest observed offset over 2,942 traces; 22 of 78 personas are at or above the ceiling.** §7 D1 |
| **Raising a timeout as the remedy for a timeout, capped at the ceiling** | The cap is the value at which the timeout stops existing. **`healing.rs:391` `min(2×current, MAX_TIMEOUT_MS)`; 16 of the 21 personas that ever hit a timeout now sit at ≥ the ceiling.** |
| **A terminal message your own classifier does not recognise** | Every category-keyed remedy silently switches off. **`"Engine safety ceiling exceeded (20m)"` contains no word in the timeout arm; it falls through ten arms to `Unknown`, and `is_auto_fixable(Unknown)` is false. Live: 6 of 6 such runs got a generic un-fixable issue.** |
| **`duration_ms: <the deadline>` on the expiry path** | A synthesised measurement. **Live: 12 rows report 1,200,000 ms; real elapsed 1,183–10,850 s; one wrong by 2 h 41 m.** §7 D3 |
| **A reaper threshold as a constant multiple of the inner timeout** | Reaps runs still inside their legitimate retry-backoff budget. `automations.rs:548-553` computes the exact case: 5×30 s + 15 s = 165 s legitimate, and the old 2×30 s = 60 s heuristic killed it |
| **`STALE = 90` beside `HEARTBEAT = 30`** | The relation is *"three missed beats"*; the product stops meaning that the moment the cadence changes, and nothing fails. **`daemon/lock.rs:52-57` states the relation in prose and links the constant; `personas-cloud` splits the same pair across two packages with no comment at all.** |
| **A ceiling declared in more than one place** | It will drift. **Four declarations here: 1,200,000 (`limits.rs:15`), 1,200,000 (`validation/persona.rs:265`), 1,800,000 (`PersonaDraft.ts:16`, whose comment claims it matches), 1,800,000 (`ai_healing.rs:20`).** `personas-cloud` has the same defect with 600 k / 300 k / 120 k and the clamp missing on one of three doors |
| **A frontend deadline shorter than the backend's** | The caller gives up while the effect continues, and a retry duplicates it — the type says so (`backendMayStillBeRunning`) and the call sites do not. **Four installer commands at 90 s against a 1,200 s `DOWNLOAD_TIMEOUT` — 13.3×.** |
| **A frontend deadline EQUAL to the backend's** | The frontend timer starts before the IPC round trip, so it always wins, and the user sees `InvokeTimeoutError` instead of the backend's specific error. `webbuild_scaffold` 600 s vs `SCAFFOLD_TIMEOUT` 600 s; `artist_transcribe_media` 600 s vs 600 s; `generate_persona_icon` 150 s vs `POLL_DEADLINE` 120 s + `HTTP_TIMEOUT` 30 s |
| **A bare `Duration::from_secs(N)` inside `timeout(...)`** | The bound has no name, so nothing can derive from it, no test can order it, and the next author writes their own. **`notifications.rs` writes `from_secs(10)` nine times in one file — nine copies of one policy.** §9 |
| **Two reapers over one table reading different columns** | `sweep_zombie_executions` judges `started_at` (30 min); `find_silent_running` judges `last_heartbeat_at` (90 s); `claim_for_instance` writes `claim_expires_at` and **nothing reads it** (0 of 2,188 rows). Three clocks, one lifecycle |
| **A total request timeout as the only bound on a download** | 20 minutes at any rate is 20 minutes, and a black-holed TCP connect burns the whole budget. **`connect_timeout`: 1 of 963 files. `read_timeout`, `pool_idle_timeout`, `tcp_keepalive`: 0.** |

## 6. Evidence

### The one site to copy: `db/src/repos/resources/automations.rs:538-597`

It is the only threshold in 963 files derived from the work it judges, and its
doc comment is the best statement of P4 in the fleet:

```
worst_case_ms = max_attempts × timeout_ms + backoff_sum(max_attempts) + REAP_SAFETY_GRACE_MS
                where max_attempts = clamp(retry_count, 1, 5)
                and   backoff_sum  = 0 / 1000 / 3000 / 7000 / 15000
```

Five decisions worth copying: (1) the threshold is **per row**, computed in the
`WHERE` clause from that automation's own configuration, so one number cannot be
wrong for two automations; (2) the **rejected heuristic is named** with its
arithmetic (*"2×30s = 60s would reap it mid-retry"*), so the next author cannot
re-derive it; (3) the safety cushion is a **separate constant** with its own
reason (clock skew + the finalize-write window), not folded into the budget; (4)
there is a **fallback** for a missing automation row (`30000`), stated; (5) the
comment explains the units of the SQL (`julianday` diff × 86,400,000).

> **And it has never run.** Live: `persona_automations` is **empty** and
> `automation_runs` is **empty**. The best-derived threshold in the repository has
> never evaluated a row — the same shape [outbound-http-call](./outbound-http-call.md)
> found for `validate_url_safety`. Correct, and untested by use.

Supporting exemplars, each for one property:

| site | the property to copy |
| --- | --- |
| `src/engine/runner/mod.rs:52-58` + `:3119-3131` | a bound **derived from another system's** bound, with a unit test that fails if the ordering inverts, and the source document named |
| `src/api/director.ts:102-123` | a bound derived from `N × the backend's own budget`, with the **incident it prevents** written down (duplicate concurrent cycle, doubled LLM spend) |
| `src/lib/tauriInvoke.ts:39-81` | an override registry with a stated **admission rule** and a named deliberate exclusion (`execute_persona`, because it has server-side dedup) |
| `src/engine/background.rs:3225-3238` | a warning tier that **changes no status**, with its ordering relative to the next tier stated |
| `src/daemon/lock.rs:50-60` | the clearest P5 *statement* — and §7 D5 for why the statement is not enough |
| `core/src/healing.rs:113-120` | `API_ERROR_BASE_RETRY_MINUTES` — the escalation ladder (10/20/30 min) written out with its 60-minute horizon and its reason (*"the Claude CLI already retries 5xx internally, so by the time one surfaces here the provider is mid-incident"*) |

### The census, exactly — two implementations

Every expression in `src-tauri` that applies a duration as a bound, `#[cfg(test)]`
removed by brace-matched range:

| | n | literal at the site | named constant | expression |
|---|---:|---:|---:|---:|
| reqwest `.timeout(…)` (builder + per-request) | **46** | 27 | 17 | 2 |
| `tokio::time::timeout(…)` | **92** | 28 | 29 | 35 |
| **total** | **138** | **55 (39.9%)** | **46 (33.3%)** | **37 (26.8%)** |

**The disagreement, and what it was.** My first implementation counted **92**
bare-`timeout(` applications; the subagent census counted **93**. Reconciling them
found three of my 138 were matches *inside string literals* my comment stripper
did not blank (`healing.rs:405` `"{new_timeout}ms"`, `session.rs:1047`,
`test_automation.rs:239`), and three of the "expression" rows are in
`commands/execution/tests.rs`. **The real production figure is 132.** Reported
because the doctrine is right that agreement is not soundness — here the two
implementations *nearly* agreed and both carried the same class of false positive,
and only hand-inspecting the argument list found it.

Of the 37 "expression" arguments, most are a variable assigned a literal one to
three lines above. **Genuinely derived at the point of application: five** —
`url_safety.rs:270` (a required parameter), `oauth.rs:231` (`remaining`, the
residual of a session TTL), `automation_runner.rs:538`
(`from_millis(timeout_ms.max(1000))`, the automation's own config),
`healthcheck.rs:262` (`deadline`), `test_automation.rs:231` (the client's value,
floored and slacked).

### Named duration constants — the denominator, and what is derived

**377** `const`/`static` declarations in 963 files whose name matches
`TIMEOUT|TTL|DEADLINE|STALE|STALL|EXPIR|REAP|GRACE|INTERVAL|BACKOFF|COOLDOWN|THRESHOLD|WINDOW|RETENTION|MAX_EXECUTION|_SECS|_MS|_MINUTES|_HOURS|_DAYS`.

```
377  named duration-family constants
 ├─   5  initializer names ANOTHER constant
 │      ├─ core/src/limits.rs:18   ENGINE_MAX_EXECUTION_MS  = ENGINE_MAX_EXECUTION_SECS * 1000   (unit conversion)
 │      ├─ core/src/healing.rs:122 MAX_TIMEOUT_MS           = ENGINE_MAX_EXECUTION_SECS * 1000   (unit conversion)
 │      ├─ commands/fleet/stale.rs:1510  STALL_MS  = STALLED_AFTER_SECS * 1000   (#[cfg(test)])
 │      ├─ commands/fleet/stale.rs:1643  ATTACH_MS = NEVER_ATTACHED_SECS * 1000  (#[cfg(test)])
 │      └─ commands/credentials/oauth.rs:1232
 │            OAUTH_STATE_MAX_AGE_SECS = OAUTH_SESSION_TTL_SECS + 5 * 60   ← THE ONE
 ├─  49  pure numeric arithmetic (20 * 60, 24 * 60 * 60) — still a chosen number
 └─ 323  a bare number
```

**One production constant in 377 relates two different durations.** The 49
arithmetic ones (`Duration::from_secs(20 * 60)`) look like derivation and are not:
`20 * 60` is `1200` with the unit spelled out. That is a legibility win and no
part of P2.

Sibling relations that exist only in prose, not code — the near-misses:
`daemon/lock.rs:57` (`90` = 3 × `HEARTBEAT_INTERVAL`, stated with an intra-doc
link), `background.rs:3226-3228` (*"Set well below the zombie threshold"*),
`runner/mod.rs:54` (above the CLI's 10-minute cutoff — the only one with a test),
`subscription.rs:1014` (*worst-case overshoot is "TTL + 2m"*),
`PersonaDraft.ts:15` (*"matching the engine hard ceiling"* — and it does not).

### The nest, measured — the first calibration record in this repo

From **2,942 real `execution_traces` rows**, the `Stream Processing` span's
`start_ms` — the gap between when the outer clock starts and when the inner one
does:

```
min = 11 ms      p50 = 395 ms     p90 = 915 ms     p99 = 4,875 ms     max = 15,254 ms
```

**Nothing in the repository knew this number before now**, and it is the only
thing that decides which of the two nested timeouts is real. Re-measure it if
credential resolution, ambient injection or the spawn path changes; the inner
timeout stops working the moment `persona.timeout_ms + max(X)` reaches
`ENGINE_MAX_EXECUTION_MS`, and at `p99` that is already a 4.9-second margin at
1,195,000 ms.

### The five tiers of one lifecycle, and what each writes

| tier | threshold | where | judges | writes | derived from |
|---|---|---|---|---|---|
| silence warning | **90 s** | `background.rs:3229` | `last_heartbeat_at` | an event; **no status change** | nothing — *"well below the zombie threshold"*, in prose |
| stream deadline | **11 min** default, else `persona.timeout_ms` | `runner/mod.rs:58`, `:2046` | the stdout stream | `failed` + `"Execution timed out after Ns"` | **the Claude CLI's own 10-min cutoff — tested at `:3126`** |
| engine ceiling | **20 min** | `limits.rs:15` → `mod.rs:246`,`:364` | the whole future | `failed` + `"Engine safety ceiling exceeded"`, **fabricated `duration_ms`**, `Unknown` category | nothing |
| running reap | **30 min** | `executions.rs:1756` | `started_at` | `incomplete` + `"Execution stalled"`, **`duration_ms` NULL** | nothing |
| queued reap | **60 min** | `executions.rs:1763` | `created_at` | same | nothing — *"more generous… because a queue legitimately backs up"* |
| *(the lease)* | *caller-supplied* | `executions.rs:966`,`:984` | `claim_expires_at` | — | **nothing reads it: 0 of 2,188 rows** |

**Five thresholds, three columns, one derivation.** The brief said four; there are
five, plus a sixth that never fires. And their ordering (90 s < 11 min < 20 min <
30 min < 60 min) is correct **by coincidence** — no two of them are expressed in
terms of each other, so nothing would notice if one moved.

Live distribution of 2,188 executions against those tiers:

```
<90s      234      (10.7%)
90s–11m  1,768     (80.8%)   ← the modal run is longer than the silence warning
11m–20m     60      (2.7%)
20m–30m     12      (0.5%)   ← every one of these is a ceiling termination
>30m         0
null       114      (5.2%)
```

**80.8% of runs are longer than the silence threshold**, which is why that tier
correctly changes no status. And the 12 in `20m–30m` are exactly the 12 ceiling
terminations — their `duration_ms` is the constant, so the bucket is an artifact
of D3, not a measurement.

### The frontend half

`invokeWithTimeout` (`src/lib/tauriInvoke.ts:305`), default **90,000 ms**
(`:37`), resolution order `explicit ?? BLOCKING_MUTATION_TIMEOUTS[cmd] ?? DEFAULT`
(`:333`).

```
1,459  direct call sites (65 under the name, 1,394 as `invokeWithTimeout as invoke`) + 78 via safeInvoke
   53  pass an explicit timeoutMs                                              (3.6%)
    3  entries in BLOCKING_MUTATION_TIMEOUTS                                   (0.2%)
    1  derived from anything — directorBatchTimeoutMs(maxPersonas)             (0.07%)
```

Expiry does not cancel: `InvokeTimeoutError.backendMayStillBeRunning = true`
(`:128`), documented three times, and the only retry in the wrapper (`:524-533`)
is gated on IPC-auth failure and explicitly forbidden for timeouts.

**So the frontend has 1,459 places where a 90-second number decides whether the
user is told a still-running operation failed.** That number relates to nothing.

## 7. Deviations found

> **Second pass — what is upstream of all of this.** Every entry below is one
> shape: **a duration that does not know what it is relative to.** Not one of them
> is a wrong number in isolation — 90 s, 20 min, 30 min and 90 s IPC are all
> defensible values. They are wrong *with respect to each other*, and there is no
> place in the codebase where "with respect to each other" can be written down.
> 377 constants, 1 relation. Fix D1 and D5 by making the relation an expression
> and the rest become mechanical.

### D1 — P0: the engine ceiling and the stream timeout are the same number for 28% of personas, and healing put them there

`src/engine/mod.rs:246`,`:364` · `src/engine/runner/mod.rs:2046-2051`,`:2080` ·
`core/src/healing.rs:390-391` · `core/src/error_taxonomy.rs:141-300`.

Full chain in §0. The four discrete defects:

- **The clamp is applied to the record, not to the value.**
  `runner/mod.rs:545-560` clamps `persona.timeout_ms` to `ENGINE_MAX_EXECUTION_MS`
  and logs a warning — **into the `ExecutionConfig` snapshot**. `:2046` then reads
  `persona.timeout_ms` **unclamped** to build the actual `timeout_duration`. For
  the one live persona at 1,800,000 the recorded config says 1,200,000 and the
  applied bound is 1,800,000; both are unreachable, so the discrepancy has never
  been visible.
- **Equality is not safety.** 21 personas sit at exactly 1,200,000. Measured
  minimum offset 11 ms ⇒ the inner bound is unreachable at equality, not merely
  redundant.
- **Healing drives them there.** `min(2 × current, MAX_TIMEOUT_MS)` where
  `MAX_TIMEOUT_MS == ENGINE_MAX_EXECUTION_MS`. Live: 23 issues / 21 personas /
  16 now at ≥ ceiling / 15 auto-fixed.
- **The ceiling's message is not a timeout.** Falls through all ten classifier
  arms to `Unknown`; `is_auto_fixable(Unknown) == false`. Live: 6 of 6 ceiling
  runs produced `"Execution failed"`, `auto_fixed=0`, `status=open`.

**Fix, as one unit:** (a) make the ceiling strictly greater than any admissible
`timeout_ms` — either lower `validate_timeout_ms`'s ceiling to
`ENGINE_MAX_EXECUTION_MS − CEILING_HEADROOM_MS` or raise
`ENGINE_MAX_EXECUTION_SECS` — and assert it:
`const { assert!(ENGINE_MAX_EXECUTION_MS > MAX_PERSONA_TIMEOUT_MS) };`
(b) cap healing at `MAX_PERSONA_TIMEOUT_MS`, not at the engine ceiling, so the
remedy cannot reach the value that disables it; (c) apply the clamp at
`runner/mod.rs:2046` where the duration is built, not only at `:545`; (d) make the
ceiling message contain `"timed out"` (or add an explicit arm to
`error_taxonomy.rs`) so the classifier and every category-keyed remedy still work.

### D2 — P0: four declarations of one ceiling, and the UI's comment claims they agree

| where | value | claim |
|---|---:|---|
| `core/src/limits.rs:15` `ENGINE_MAX_EXECUTION_SECS` | **1,200,000 ms** | *"Hard engine-level ceiling"* — the truth |
| `core/src/validation/persona.rs:264-281` | rejects `> 1,200,000` | agrees |
| `src/features/agents/sub_editor/libs/PersonaDraft.ts:16` `MAX_PERSONA_TIMEOUT_MS` | **1,800,000** | *"Upper UI bound **matching the engine hard ceiling (30 min)**"* — **false on both halves** |
| `src-tauri/engine/src/ai_healing.rs:20` `TIMEOUT_MS_MAX` | **1,800,000** | `// 30 minutes` |

And the floor disagrees too: `validation/persona.rs:11` `TIMEOUT_MS_MIN = 1000` ·
`ai_healing.rs:19` `TIMEOUT_MS_MIN = 1_000` (a duplicate) ·
`PersonaDraft.ts:14` `MIN_PERSONA_TIMEOUT_MS = 10_000` — **10× the backend's**.

**Live: one persona ("T: Release Manager") sits at 1,800,000**, 1.5× a ceiling the
backend validator is supposed to reject. `personas-cloud`, a port of this engine,
has the identical defect with 600 k / 300 k / 120 k and the clamp missing on one
of three doors.

**Fix:** export the ceiling through the ts-rs binding surface or a generated
constant so `PersonaDraft.ts` cannot hold its own copy; delete
`ai_healing.rs:19-20` in favour of `personas_core::validation::persona`; and
correct the comment.

### D3 — P0: the ceiling path writes a duration it did not measure

`src/engine/mod.rs:418` — `duration_ms: ENGINE_MAX_EXECUTION_SECS * 1000`.

**Live, all 12 ceiling-terminated runs:**

```
reported: 1,200,000 ms  (all 12, identical)
real (completed_at − started_at): 1,183s · 1,198s · 1,200s · 1,201s · 1,201s
                                  1,202s · 1,202s · 1,202s · 1,205s · 1,474s
                                  1,487s · 10,850s
```

Eleven of twelve disagree; the worst is wrong by **9,650 s (2 h 41 m)**. Two are
*below* 1,200 s. `start_time` is already in hand (`runner/mod.rs:82`
`Instant::now()`), so this is `start.elapsed().as_millis()`.

Compounding it, the zombie sweep (`executions.rs:1836-1848`) writes
`status`/`error_message`/`completed_at` and **not `duration_ms`** — live, all 20
reaped rows have `duration_ms = NULL` against real elapsed of **3,157–20,525 s**.

**Fix:** measure at `mod.rs:418`; in the sweep, set
`duration_ms = (completed_at − started_at)` in the same `UPDATE`. This is a
crossover into [metric-definition](./metric-definition.md): every consumer of
`duration_ms` — heatmaps, KPIs, the cost report — currently reads a constant.

### D4 — P1: 1,459 IPC call sites, 3.6% with a deadline, and four at 13× under budget

`src/lib/tauriInvoke.ts:37` `DEFAULT_TIMEOUT_MS = 90_000`.

**Frontend budget shorter than the backend's own:**

| command | frontend | backend | ratio |
|---|---:|---:|---:|
| `companion_tts_kokoro_download` (`api/companion.ts:520`) | 90 s | `tts/kokoro_installer.rs:42` **1,200 s** | **13.3×** |
| `companion_tts_pocket_download` (`:564`) | 90 s | `tts/pocket_installer.rs:37` 1,200 s | 13.3× |
| `companion_stt_download_model` (`:671`) | 90 s | `stt/downloader.rs:31` 1,200 s | 13.3× |
| `companion_stt_install_engine` (`:688`) | 90 s | `stt/installer.rs:53` 1,200 s | 13.3× |
| `companion_stt_transcribe` | 90 s | `stt/whisper.rs:32` 120 s | 1.33× |
| `companion_run_consolidation` | 90 s | `brain/consolidation.rs:46` 300 s | 3.3× |
| `companion_run_sleep_cycle` | 90 s | `brain/sleep_cycle.rs:197` 300 s | 3.3× |
| `companion_run_reflection` | 90 s | `brain/reflection.rs:29` 180 s | 2× |
| `webbuild_dev_start` (`api/webbuild.ts:16`) | 90 s | boots Bun + Next cold compile | unbounded |
| `scraper_run_extract` (`api/scraper.ts:89`) | 90 s | headless crawl over N URLs | unbounded |

**Frontend budget EQUAL to the backend's** — the frontend timer starts before the
IPC round-trip, so it always wins and the user gets a generic
`InvokeTimeoutError` instead of the backend's specific error:
`webbuild_scaffold` 600 s vs `webbuild/project.rs:14` 600 s ·
`artist_transcribe_media` 600 s vs `commands/artist/mod.rs:739` 600 s ·
`generate_persona_icon` 150 s vs `persona_icon_gen.rs:60`+`:63` (120 + 30) = 150 s,
exactly zero margin.

`merge_deliberation_tracks` is 180 s (`teamDeliberations.ts:57`) against branches
of 120/240/300 s in `engine/deliberation.rs:839-845` — short on two of three.

**Fix:** for each, `timeoutMs = <backend const> + headroom`, or add to
`BLOCKING_MUTATION_TIMEOUTS` (the admission rule at `tauriInvoke.ts:62-64` already
describes exactly these). The structural fix is §10.

### D5 — P1: the relation is in the doc comment and not in the code

`src/daemon/lock.rs:50-60`:

```rust
/// The daemon writes a heartbeat every [`HEARTBEAT_INTERVAL`]; 90s gives
/// three missed heartbeats before we declare the daemon dead …
pub const STALE_THRESHOLD: Duration = Duration::from_secs(90);
pub const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(30);
```

The comment is excellent, links the constant, and the code does not depend on it.
Change `HEARTBEAT_INTERVAL` to 45 s and `STALE_THRESHOLD` silently becomes "two
missed beats"; nothing fails. Same shape at `background.rs:3226-3228`
(*"Set well below the zombie threshold"* — 90 s vs 1,800 s, unexpressed) and
`subscription.rs:1014` (*"worst-case overshoot is TTL + 2m"*).

`personas-cloud` has the identical pair (30 s / 90 s) split across **two
packages** with **no comment at all**, while `packages/shared/` — which exists for
values both sides must agree on — holds no timing constants.

**Fix:** `const HEARTBEAT_SECS: u64 = 30; const MISSED_BEATS_TO_DEATH: u32 = 3;
const STALE_THRESHOLD: Duration = Duration::from_secs(HEARTBEAT_SECS * MISSED_BEATS_TO_DEATH as u64);`

### D6 — P1: three clocks judge one execution and one of them nobody reads

`db/src/repos/execution/executions.rs` — `sweep_zombie_executions` (`:1773`)
judges `started_at`; `find_silent_running` (`:1481`) judges `last_heartbeat_at`;
`claim_for_instance` (`:966`,`:984`) writes and reads `claim_expires_at`.

**Live: 0 of 2,188 executions and 0 of 12 build sessions carry
`claim_expires_at`.** The one column designed to answer "is this worker still
alive?" is unpopulated, so the reaper is left guessing from wall-clock age — which
is why a run that was healthy 90 seconds ago and one that died 29 minutes ago are
indistinguishable until minute 30.

This confirms [job-claim-and-lease](./job-claim-and-lease.md) D1 from the
duration side and adds the tiering consequence: **the lease is the only threshold
in the tree that could be derived from liveness rather than from age, and it is
the only one nothing reads.** `touch_last_heartbeat` (`:1461`) already runs on the
runner's tick and already stamps a column the sweep could use.

**Fix (with D1 of that path):** extend `claim_expires_at` from
`touch_last_heartbeat`, and make the zombie sweep's predicate
`claim_expires_at < now` for rows that have one, falling back to `started_at` age
for rows that do not.

### D7 — P2: a black-holed connect burns the whole request budget

**963 files: `connect_timeout` 1 · `read_timeout` 0 · `pool_idle_timeout` 0 ·
`tcp_keepalive` 0.** (Confirms the brief's first two and adds the second two.)

The four installer clients set `.timeout(Duration::from_secs(20 * 60))` and
nothing else, so a TCP connect to a black hole consumes twenty minutes before
anything notices — and the frontend gave up 18.5 minutes earlier (D4). Every
sibling that split the two wrote down why: `brainiac/providers/mod.rs:28-35`
(*"a stalled-but-connected upstream … would hang the awaiting future forever"*),
`personas-cloud/facade/main.py:35` (`httpx.Timeout(30.0, connect=5.0)`).

**Fix:** `connect_timeout` on the shared doors, and `read_timeout` on the four
download clients — a resetting idle bound is the correct instrument for a
streaming transfer, and a total bound is not.

### D8 — P2: `notifications.rs` writes one policy nine times

`src/notifications.rs:619,668,711,771,803,831,874,912,967` — nine
`.timeout(Duration::from_secs(10))`, one per delivery channel (Slack ×2, Telegram,
SendGrid, Resend, Discord ×2, Teams, +1). There is no
`NOTIFICATION_DELIVERY_TIMEOUT`, so the tenth channel will be a tenth literal and
raising the policy is a nine-site edit. `engine/src/p2p/connection.rs` does the
same five times with `from_secs(10)`.

**Fix:** one named constant per file. This is the §9 population.

## 8. Gaps — what the primitives genuinely cannot do

1. **Rust cannot express "this runtime value must stay below that constant" in a
   type.** `persona.timeout_ms` is `i32` from the database; no newtype reaches it
   without a validated constructor at every read, and it crosses a `Persona`
   struct field, not a parameter — which is
   [where types cannot reach](../golden-path-doctrine.md#where-types-cannot-reach)
   case 2 in a different costume. The reachable answer is a clamp at the point of
   application (D1c) plus a `const { assert! }` on the constant pair, and that is
   strictly weaker than making it unrepresentable. **Say so; do not pretend the
   type closes it.**
2. **`const { assert!(A > B) }` only works between two constants in one crate's
   dependency graph.** `MAX_PERSONA_TIMEOUT_MS` lives in TypeScript
   (`PersonaDraft.ts:16`), so the D2 inversion cannot be compile-asserted from
   Rust at all. It needs the constant generated into TS from Rust — which is
   exactly what the ts-rs pipeline does for types and does not do for values.
   **There is no `#[derive(TS)]` for a `const`.**
3. **Nothing can bound a `tokio::time::timeout` that the runtime never polls.**
   One ceiling-terminated run shows 10,850 s of real elapsed against a 20-minute
   `timeout` — a machine sleep, a suspended process, or a blocked runtime thread
   defeats it, and no amount of tiering helps. A wall-clock reaper (the 30-minute
   sweep) is the only thing that catches that class, which is a real argument for
   keeping tier 4 even after D1 is fixed.
4. **The census cannot see a nesting inversion**, because the two constants are in
   different files and the relation is arithmetic, not lexical. §9 gates the
   precondition (a bound must have a name) and explicitly does not gate the
   condition. The condition's gate is the compile-time assertion in §10 — which
   is a type, not a count, and is therefore the right answer anyway.
5. **`invokeWithTimeout` cannot know the backend's budget**, and no static check
   can join a `CommandName` string to the Rust constant that bounds it. What
   *could* exist is a generated table — `scripts/generate-command-names.mjs`
   already walks the command surface — emitting each command's declared budget
   from a `#[command(budget_ms = ...)]` attribute. Nothing like it exists in any
   of the six repos.
6. **The 90-second IPC default cannot be lowered or raised safely** because it is
   simultaneously the bound for a 5 ms `get_settings` and for a 20-minute model
   download. The default is doing two incompatible jobs, and the registry
   (`BLOCKING_MUTATION_TIMEOUTS`, 3 entries) is the right shape at 0.2% adoption.

## 9. The missing gate

**The condition this leaf is really about — an inner bound ≥ its outer bound —
cannot be counted**, for the reason in Gap 4. What *can* be counted is its
precondition, and the precondition is load-bearing: **a bound with no name cannot
participate in any relation, cannot be asserted against, and cannot be found by
the next author.** 55 of 138 bounds in this repo are anonymous, and the
39.9%/33.3% split is the difference between a codebase that could adopt §10 and
one that cannot.

**The signal is a proxy for:** *"the deadline for this operation was written as a
literal at the site that applies it, so no other deadline can be expressed in
terms of it."* An adopting repo on another stack should re-derive its own proxy
for that condition — in TypeScript the equivalent shape is
`{ timeoutMs: 120_000 }` or `AbortSignal.timeout(15_000)` at a call site, which
`vibeman` carries 39 times and `personas-web` 6.

**Mechanism: a census rule** (`scripts/census/rules.json`). **It executes in
`npm run check`** — `package.json`'s `check` script runs `npm run census:check`
between `check:doc-map` and `tsc --noEmit` — which is the local pre-push /
PR-self-review gate the agent runs before pushing. **It is deliberately NOT in
`ci.yml`**, and per this leaf's calibration that is the right place for it: `ci.yml`
is currently red on 10 pre-existing Rust failures and a platform-incomplete
lockfile, so a gate added there would run behind an already-failing job and
enforce nothing. The census runner supplies the fail-loud contract itself (a walk
below `floor`, a zero-match rule, a stale `exclude`, a rise, **and a silent drop**
are all fatal), so this rule does not re-derive it.

**Validated against the real runner before being written down**, in a scratchpad
registry with a filename unique to this composer, then re-extracted from this
document and re-run — identical numbers both times:

```
rule                                   files  matches  walked  floor
anonymous-deadline                        38       61     963    900
anonymous-deadline-positive-control       28       40     963    900
```

**The positive control partitions the anchor population**, which is the strongest
form: the same `timeout(` anchor, pointed at the compliant argument shape, returns
**40 matches in 28 files**. So the pattern discriminates on the *argument*, not on
the anchor — 61 violating / 40 compliant out of 101 anchor matches. The remaining
37 (expression arguments) match neither by design; they are neither a literal nor
a name.

**Baseline honesty:** 61 includes **6 matches inside `#[cfg(test)]` bodies**
(`engine/src/test_runner.rs:3046,3058` · `commands/execution/tests.rs:490,499` ·
`src/engine/build_session/runner.rs:2061` · `src/engine/subscription.rs:3421`) —
the census engine matches whole file content and cannot brace-match a `cfg(test)`
range. My own cfg-test-stripped count is **55**, and 55 + 6 = 61 exactly, which is
the two implementations reconciling. The baseline is the runner's number because
the runner is what ratchets.

**This condition should reach zero**, and per the doctrine the census cannot
express that: at that point **delete the rule** rather than baselining it at 0.
The realistic first cut is `notifications.rs` (9) + `p2p/connection.rs` (5) +
`desktop_bridges.rs` (3) + `build_session/fix_pass.rs` (3) = **20 of 61 in four
files**.

**Allowlist:** none. There is no legitimate anonymous deadline — hoisting to a
`const` in the same file is a mechanical fix with no cost, and it is the
precondition for everything in §2.

```json
{
  "id": "anonymous-deadline",
  "goldenPath": "docs/concepts/golden-paths/timeout-tiering.md",
  "title": "A deadline applied as a bare number at the site that applies it",
  "roots": ["src-tauri"],
  "extensions": [".rs"],
  "signal": {
    "pattern": "(?<![A-Za-z0-9_$])(?:tokio::time::)?timeout\\s*\\(\\s*(?:std::time::|tokio::time::|core::time::)?Duration::from_(?:secs|millis|secs_f64|secs_f32)\\s*\\(\\s*[0-9][0-9_]*(?:\\.[0-9]+)?\\s*\\)",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "a timeout application (`tokio::time::timeout(...)` or a reqwest `.timeout(...)`) whose duration is a numeric literal written inline at the application site. PROXY FOR the stack-free condition: the bound on this operation has no name, so nothing else can reference it, no other bound can be derived from it, and no test can assert its ordering against the bound that wraps it. Compliant form: a named `const`, which the positive control counts."
  },
  "baseline": { "files": 35, "matches": 58 },
  "floor": 900
}
```

```json
{
  "id": "anonymous-deadline-positive-control",
  "goldenPath": "docs/concepts/golden-paths/timeout-tiering.md",
  "title": "POSITIVE CONTROL — the same anchor pointed at the compliant form (a NAMED deadline)",
  "roots": ["src-tauri"],
  "extensions": [".rs"],
  "signal": {
    "pattern": "(?<![A-Za-z0-9_$])(?:tokio::time::)?timeout\\s*\\(\\s*(?:[a-z_]+::)*[A-Z][A-Z0-9_]{2,}\\s*[,)]",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "CONTROL: the same anchor, argument is a named constant (measured 40 matches / 28 files). Proves the violating pattern discriminates on the ARGUMENT rather than on the `timeout(` anchor. If this returns ~0 the anchor is doing the work and the violating rule means nothing."
  },
  "floor": 900
}
```

**A second instrument the census cannot host, specified rather than built.** The
condition in D2 — one ceiling declared in four places, in two languages, with a
comment asserting they agree — is an *absence* (`no second declaration of this
value exists`), and the census
[cannot assert an absence](../golden-path-doctrine.md#4-census-rules). The right
instrument is an extension to the existing ts-rs / command-name codegen: emit
`ENGINE_MAX_EXECUTION_MS` (and the `TIMEOUT_MS_MIN`/`MAX` pair) into a generated
TS module, and make `PersonaDraft.ts` import it. That converts a four-way drift
into a compile error and deletes two of the four declarations outright. It is
~20 lines in `src-tauri/build.rs` plus a generated file, and it is the only fix
in this document that closes a defect rather than counting it.

## 10. Prefer a type over a gate — the answer for this leaf

### The candidate the corpus already proposed, held against all seven qualifications

[outbound-http-call](./outbound-http-call.md) §7 proposes dropping `reqwest` from
two crates so `Client::builder()` cannot resolve outside `core`, forcing every
site through a `ClientProfile` that carries deadline + resolver + redirect as one
indivisible choice.

| | verdict for **this** leaf |
|---|---|
| **Q1 — carries only what it encodes** | **Passes, and this is its strength.** The whole point is that a `ClientProfile` cannot encode "30 seconds" without also encoding the resolver — the three decisions become one value. Contrast `successRateSource`, where the unit lived beside the tag |
| **Q2 — requiredness ≠ closedness** | **Passes.** It closes rather than merely requires: `ClientProfile` is a finite enum, not a `Duration` you must supply |
| **Q3 — a type nobody constructs constrains nothing** | **Passes on the HTTP axis** — 44 construction sites, 32 of which would be forced through it. **Fails on THIS leaf's axis.** 46 of 138 bounds in this repo are reqwest timeouts; the other **92 are `tokio::time::timeout`**, and D1 — the P0 — is two of those. A `ClientProfile` does not touch it |
| **Q4 — a type anyone can construct authenticates nothing** | **Passes** if the enum's variants are exhaustive and there is no `Custom(Duration)` escape. **The moment someone adds `ClientProfile::Custom(Duration)` — and the pressure to, from the 5 s probe / 300 s LLM / 20 min download spread, is exactly what created the 32 bypasses — it degenerates to Q3's failure.** That pressure is a fact about this repo and must be designed against, not assumed away |
| **Q5 — withholding beats requiring** | **Passes, strongly.** Deleting the `reqwest` dependency is withholding the construction, not documenting a preference. The corpus's best-evidenced clause |
| **Q6 — withhold the dangerous freedom, not the answer** | **Passes** — the dangerous freedom is *choosing three things independently*, and naming a profile withholds exactly that while still letting you pick a deadline |
| **Q7 — only helps where the requirement forced the bad value** | **Passes for HTTP.** The absence of a deadline-taking factory *is* what forced 31 hand-rolled builders |

**Verdict: adopt it for outbound HTTP — it is well-argued and six of seven
qualifications are clean — but it is not this leaf's answer.** It bounds 46 of
138 sites and zero of D1, D2, D3, D5 and D6. **A gate on reaching the destination
is only as good as the destination**, and a `ClientProfile` whose deadline is
still a number nobody related to anything has relocated the problem into an enum.

### This leaf's answer, and it is nine words

**Make the ordering of two constants a compile error.**

```rust
// core/src/limits.rs — the admissible per-persona ceiling becomes a Rust
// constant (today it exists only in TypeScript, which is D2), and the
// relationship between it and the engine ceiling stops being a coincidence:
pub const MAX_PERSONA_TIMEOUT_MS: i32 = 15 * 60 * 1000;
const { assert!(ENGINE_MAX_EXECUTION_MS > MAX_PERSONA_TIMEOUT_MS) };
const { assert!((DEFAULT_EXECUTION_TIMEOUT_MS as i32) < ENGINE_MAX_EXECUTION_MS) };
```

Nine words per line, no test run, no reviewer required, and the build stops the
day someone raises the persona ceiling to meet the engine one. Held against the
seven:

- **Q1** — it encodes exactly the relation and nothing else. There is no adjacent
  value it can be wrong about.
- **Q2** — it is not a requiredness change at all; it closes the *state space of
  two existing constants*, which is the thing that was open.
- **Q3** — **the decisive one.** It needs zero construction sites. The 22 personas
  in D1 exist because no one ever *called* anything; a type that must be
  constructed could not have helped. This is the rare case where Q3 is satisfied
  vacuously and correctly.
- **Q4** — it cannot be constructed at all, so it cannot be constructed wrongly.
- **Q5** — it withholds the ability to *ship* the inverted pair.
- **Q6** — it withholds the inversion, not the choice of value. Both numbers stay
  freely tunable; only their order is taken away.
- **Q7** — nothing forced the bad value here; the constants drifted apart. The
  assertion is the correct instrument for drift, where withholding a construction
  is not.

**Seven for seven, and it is reinvented in a sibling.**
`brainiac/crates/brainiac-core/src/health.rs:223`, in the same language, with no
shared document, and its comment states the doctrine better than I can: *"the
relationship is a fact about two constants, so it should fail the build, not a
test run."*

**Where it does not reach, and what to do instead** (per
[where types cannot reach](../golden-path-doctrine.md#where-types-cannot-reach)):

- **Across the Rust/TS boundary** (D2). `const { assert! }` cannot see
  `PersonaDraft.ts`. Fix by *generating* the constant into TS — §9's second
  instrument — so there is only one declaration to assert about.
- **Against runtime data** (`persona.timeout_ms` from the database). No type
  reaches a value that arrives through a struct field from SQLite. Fix by
  clamping **at the point of application** (`runner/mod.rs:2046`), not only where
  it is recorded, and by capping healing at the *persona* ceiling rather than the
  *engine* ceiling.
- **Against a bound with no name** (the 55). Nothing can be asserted about a
  literal. That is why §9's gate is the precondition for §10's type, and why it
  is worth shipping first.

**Ship order:** §9's census rule (names the bounds) → the `const { assert! }` pair
(closes D1's constant half) → the clamp at the point of application and the
healing cap (closes D1's runtime half) → generate the ceiling into TS (closes D2)
→ `start.elapsed()` (closes D3). D4–D8 are mechanical once the vocabulary exists.

---

## 11. What this repo already does better than its siblings

Stated because a document that reports only defects mis-sets the reader's priors,
and three of these are genuinely fleet-leading:

- **`automations.rs:564-593` is the best-derived threshold in six repositories.**
  Per-row, computed in SQL from the work's own retry plan, with the rejected
  heuristic named and its arithmetic shown. `ascent` reasons about the same
  hazard in prose; only this repo computes it per row.
- **`runner/mod.rs:3122-3131` is the only ordering assertion in the fleet outside
  `brainiac`** — a unit test that fails if a bound stops exceeding the external
  system's bound, with the handoff document cited.
- **`InvokeTimeoutError.backendMayStillBeRunning` (P6) is better than four of the
  five siblings** and is matched only by `personas-cloud`'s reconnect contract.
  It puts "this bound does not cancel anything" in the type.
- **The tier separation is right even where the numbers are not.** The silence
  watchdog deliberately changes no status (`background.rs:3237`), the queued
  reaper is deliberately more generous than the running one and says why, and the
  ceiling handler reaps the orphaned process tree with nine lines explaining the
  drop semantics. The architecture of the tiering is sound; the arithmetic
  between the tiers is what is missing.

## 12. Corrections to the brief

1. **"Four unrelated definitions of 'too long' for the same execution lifecycle —
   90 s, 11 min, a 20 min ceiling, a 30 min reap."** — **Five**, plus a sixth that
   never fires. The missed one is `QUEUED_ZOMBIE_THRESHOLD_SECS = 60 * 60`
   (`executions.rs:1763`), which judges a different column (`created_at`, not
   `started_at`) and is the only one of the six with a *stated* reason for its
   relative size. The sixth is `claim_expires_at`, live on 0 of 2,188 rows.
2. **"None derived from another."** — **True for the four named, and the brief
   undersells the 11-minute one.** `DEFAULT_EXECUTION_TIMEOUT_MS = 660_000` **is**
   derived — from the Claude Code CLI 2.1.113 subagent-stall cutoff — and it is
   the **only bound in the repository with a test asserting its ordering**
   (`runner/mod.rs:3122-3131`). It is derived from an *external* system rather
   than from a sibling tier, which is why the four still do not relate to each
   other, but the exemplar deserves naming rather than counting as a defect.
3. **"40 of 44 reqwest clients set a timeout … the chokepoint gets 12 uses
   against 32 bypasses — 27% coverage."** — **Confirmed and extended.**
   `connect_timeout` = **1**, `read_timeout` = **0** (both as the brief said), and
   additionally `pool_idle_timeout` = **0** and `tcp_keepalive` = **0** in 963
   files. The reqwest population is 46 `.timeout(` applications (33 builder +
   13 per-request), against the 44 *client constructions* the sibling path counts
   — different denominators, both correct.
4. **"`invokeWithTimeout` … find out what its default is, how often it is
   overridden, and whether any override is derived from anything."** — 90,000 ms;
   **53 of 1,459 (3.6%)**; **exactly one derived**
   (`directorBatchTimeoutMs`, `api/director.ts:120-123`). The brief's framing
   implies the overrides are the interesting population. **They are not — the
   1,406 non-overrides are**, because four of them are 13× under their backend's
   own budget while the wrapper's type says a timeout does not cancel anything.
5. **"A lease is a timeout: `claim_expires_at` exists, is never renewed … and the
   reaper reaps on `started_at` age instead of on the lease."** — **Confirmed and
   worse than stated.** It is not merely un-renewed: **0 of 2,188 executions and
   0 of 12 build sessions have ever carried a value**, so it has never been
   written, not just never extended. The tiering consequence the brief did not
   name: it is the only threshold in the tree that *could* be derived from
   liveness rather than from wall-clock age, and `touch_last_heartbeat` already
   runs on the tick that would extend it.
6. **"Whether any two timeouts in one call chain are ordered wrongly — an inner
   timeout longer than the outer one is a timeout that can never fire."** —
   **Confirmed, and the sharper finding is that EQUAL is also broken.** 21 of the
   22 affected personas are at *exactly* the ceiling, not above it. The 11 ms
   measured minimum offset is what makes equality an inversion, and no reader of
   either file could have known that number. **The brief's phrasing would have
   missed 21 of 22 cases.**
7. **A prescription the oracle inverted.** I intended to prescribe a central
   timeouts module. **Refuted:** `vibeman` has four competing partial centers, two
   of which both declare themselves the single source of truth for cache TTLs with
   different values, and `CACHE_TTL_MS` is independently redeclared six times;
   `personas-web`'s real `timings.ts` scopes itself out of network timeouts and
   its own stated rule is already violated twice; `brainiac`, the best repo in the
   fleet, keeps **0 of 22** in such a module by design. §2(e) states the corrected
   form: keep the constant at its point of authority and put the *relationship* in
   the initializer.
8. **A measurement error I made and caught.** My first "derived constants" pass
   reported **8**, three of which were phantoms produced by a comment stripper
   that ate `https://` — the exact failure
   [the doctrine documents for `check-csp-hosts.mjs`](../golden-path-doctrine.md#2-measurement-rules).
   The corrected string-aware stripper returns **5**. Recorded because the wrong
   number was plausible, the count moved by 60%, and nothing but re-reading the
   five hits would have caught it.
