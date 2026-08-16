# Golden path — Retry with backoff

> Situation node: `backend-runtime/resilience-policies/retry-with-backoff` ·
> [situation spine](../situation-spine.md) · recurrence 10 · risk **HIGH** ·
> sides **server** · convergence **diverged** ·
> dimensions: **resilience · function · cost · code-quality**
> Composed 2026-08-16 against `master` @ `d74fae3c9`.
>
> **Sweep size.** All **963** non-generated `.rs` files under `src-tauri/` (agrees
> exactly with `rust.files` in [`shared-facts.json`](../shared-facts.json), reached
> by an independent walk) and all **4,824** `.ts`/`.tsx` under `src/` (**4,423**
> after removing tests). `#[cfg(test)]` was removed by a **brace-matched,
> string/comment-aware range**, never a line threshold; string literals were
> blanked offset-preserving so a `//` inside a URL cannot be mistaken for a
> comment. Every headline count was taken twice — once structurally
> (brace-matched loop bodies), once by regex through the census runner — and where
> the two disagreed the disagreement is reported and resolved (§9).
>
> **Measured by executing, not reading.**
> 1. **Every backoff schedule in the repository was replayed** and its delay
>    sequence and total wall clock published (§6). That is what shows the
>    `automation_runner` loop's live schedule is `[1s, 2s, 4s, 8s]` and matches the
>    reaper's SQL to the millisecond — and that the OAuth ladder's fourth step
>    repeats **forever**.
> 2. **The operator's live `personas.db` (347 MB, 244 tables) and
>    `personas_data.db` were copied and opened `readOnly`** — the live files were
>    never opened for write. 2,188 executions, 98 retry rows, 4,972 events,
>    25 credentials, 205 healing issues.
> 3. **`count_consecutive_real_failures` was replayed verbatim** (the exact SQL
>    from `db/src/repos/execution/executions.rs:1116-1129`) against all 78 live
>    personas, because that COUNT is the *exponent* in the healing backoff and
>    nothing bounds it. Live max: **2**. Structural max: `u32::MAX`.
> 4. The census rule and its positive control were **run against the real runner**
>    (`scripts/census/run-census.mjs`) in a private scratch registry, then
>    re-extracted from this document and re-run — identical numbers both times.
>
> **`cargo` was not run** (the operator's app is running). Every Rust claim is
> static and traces to a file read during composition. **No secret value appears
> anywhere below**; the two OAuth credentials named in §0 are identified by
> service type and ledger counters only.
>
> **A convergence sweep** ran against `brainiac`, `personas-web`, `personas-cloud`,
> `vibeman` and `ascent`. **5 of 5 reachable, none silent** — every one of them
> retries something. It inverted one clause outright, and it supplied the two
> halves of §2(g) from two different repos, neither of which has both.
>
> ### Sibling boundaries, settled in prose
>
> [**timeout-tiering**](./timeout-tiering.md) owns *how long one attempt gets* and
> *the bound above it*. **This path owns how many attempts there are and how long
> the gaps between them are.** Its **P4** — *"a retry budget multiplies;
> `N × deadline + Σbackoff`; the outer bound is derived from the retry plan"* — is
> the clause this document supplies the other half of: **P4 tells you to derive
> the ceiling from the plan; this path is about the plan.** That document reports
> `automations.rs:564-593` as the best-derived threshold in six repositories. This
> one reports the arithmetic it is derived *from*, replayed, and finds it exact.
>
> [**idempotent-invocation**](./idempotent-invocation.md) owns *whether the system
> can recognise the same request arriving twice*. **This path owns whether it
> arrives twice.** They are the same question asked from opposite ends and §7 D3
> is the crossover: the one real HTTP retry loop in the tree retries **on
> timeout**, on **any method including POST**, with **no key** — and a timeout is
> exactly the failure where the first attempt may have succeeded. That path's
> `unkeyed-billable-spawn` counts spawn sites; this defect is in a webhook and its
> rule cannot see it.
>
> [**outbound-http-call**](./outbound-http-call.md) §7.G named the narrow defect
> (*"the one retry loop omits 429"*) and handed the subject here. This document
> confirms it, and finds the wider shape: **the repo never reads `Retry-After`,
> anywhere, in either language — while shipping connector metadata that instructs
> its own agents to honour it.**
>
> [**background-loop**](./background-loop.md) and [**polling-loop**](./polling-loop.md)
> own *a repeating unit of work*. **A retry is not a poll**, and the distinction is
> load-bearing rather than pedantic: 3 of the 5 candidate matches for a
> "flat backoff" gate turned out to be polls, which is why §9 refuses that gate
> with numbers.
>
> [**terminal-state-and-recovery**](./terminal-state-and-recovery.md) owns what a
> recovery pass writes. **This path owns what happens when the budget runs out** —
> and §7 D2 is a retry with no terminal state of its own, stopped only by a
> threshold in a different subsystem, by accident.
>
> The **Deviations** section is a fix backlog. It contains **one unbounded retry
> that has been running against a dead credential for 67 days** (D2), **one
> at-least-once webhook** (D3), and **one latent shift overflow** (D5).

---

## 0. The headline: this repo has three retry mechanisms, and the durable one has no terminal state

**Zero of the ~20 retry paths in 963 Rust files and 4,423 TypeScript files add
jitter. Zero read `Retry-After`. Exactly one persists its backoff — and that one
cannot stop.**

`persona_credentials.metadata` carries a typed retry ledger:
`oauth_refresh_fail_count`, `oauth_refresh_backoff_until`, written through
`increment_refresh_backoff_atomic` inside a transaction so two ticks cannot
clobber each other's count. It is the only backoff in the tree that survives a
process restart, and it is genuinely well built. Its schedule
(`src/engine/oauth_refresh.rs:53`):

```rust
/// 15 min → 1 hr → 4 hr → 24 hr (capped).
const REFRESH_BACKOFF_STEPS: &[i64] = &[900, 3600, 14400, 86400];
```

and the index that reads it (`core/src/models/credential_ledger.rs:237-239`):

```rust
let backoff_secs = match backoff_steps.len().checked_sub(1) {
    Some(max_idx) => backoff_steps[(fail_count as usize).min(max_idx)],
    None => 0, // no backoff schedule configured — retry immediately
};
```

**The index saturates. The attempt count does not.** There is no `MAX_ATTEMPTS`,
no escalation to a terminal state, no `CreateIssue`. Step four repeats forever.

**Live, from the operator's database — two credentials, both flagged
`needs_reauth: true`:**

| service | `oauth_refresh_count` | `oauth_refresh_fail_count` | `oauth_refresh_backoff_until` | stale for |
|---|---:|---:|---|---:|
| `gmail` | 279 | **49** | `2026-06-10T13:55:57Z` | **67 days** |
| `google_calendar` | 75 | **21** | `2026-05-18T12:19:11Z` | **90 days** |

The ladder has **four** rungs. One credential is on failure **49**. Forty-five of
those attempts waited exactly 24 hours and learned nothing, because after rung
four the schedule stops being a function of the evidence.

**And what actually stopped the retry is not in this subsystem.**
`oauth_refresh.rs:169-177` computes `needs_refresh` and requires
`remaining.num_seconds() >= -STALENESS_CEILING_SECS` — a **7-day** ceiling
(`:49`). Both tokens expired more than 7 days ago, so the loop no longer selects
them at all. The retry did not stop because it decided to stop; it stopped
because a *timeout* threshold in a neighbouring concern silently excluded its
input. `mark_needs_reauth` sets a perfectly good terminal flag at `:236`, and
**the refresh loop never reads it.** Change `STALENESS_CEILING_SECS` and the
unbounded retry resumes.

> **The general shape, and it is this leaf's whole subject.** A retry needs three
> numbers — *how many*, *how long between*, and *what happens when it stops* —
> and this repository's three retry mechanisms each own a different subset:
>
> | mechanism | how many | how long between | terminal state |
> |---|---|---|---|
> | **healing** (`spawn_delayed_retry` + `scheduled_retries`) | `MAX_RETRY_COUNT = 3` ✅ | 5 s fixed / 30–300 s / 10–30 min ✅ | `CreateIssue` ✅ |
> | **in-process loops** (18 of them) | 12 named, **8 anonymous** | 7 grow, 5 flat, **6 none at all** | ad-hoc |
> | **OAuth refresh ledger** (persisted) | ❌ **unbounded** | ✅ 15 m → 24 h, durable | ❌ **none** |
>
> The one that survives a restart is the one with no budget and no exit. That is
> not a coincidence: **durability and boundedness are the same design step, and
> everyone who builds the first one forgets the second.** `brainiac`'s
> `0021_compose_backoff.sql:6-9` is the sibling that wrote this down after paying
> for it — *"the compose path had no attempt counter, no backoff and no terminal
> state, so one poison page was an unbounded money/quota drain."*

### The three retry mechanisms, and where each is real

**1. Healing — the principal one, and it is not a loop.**
`src/engine/mod.rs:3915` `spawn_delayed_retry` spawns a task that sleeps, then
creates a *new execution row* via `exec_repo::create_retry`. There is no `for`,
no `while`, no `loop`; the "iteration" is a fresh row in the database with
`retry_of_execution_id` pointing back. **Any signal that keys on loop syntax is
blind to the most important retry in this codebase** — a fact §9 has to design
around. Its ladder (`core/src/healing.rs`) is the best-reasoned thing in the
territory and is replayed in full in §6.

**2. Eighteen in-process retry loops.** Structurally enumerated by brace-matching
every loop in 963 files and classifying its body:

```
18  retry constructs (19 structural candidates − 1 hand-verified false positive)
 ├─  7  the delay GROWS      (persist.rs ×3, automation_runner, oauth_refresh ×2, cloud.rs)
 ├─  5  the delay is FLAT    (eval, test_automation, build_sessions ×2, approval_exec_fleet)
 └─  6  there is NO delay    (query_debug, registry, gitlab, oneshot, kpi_binding, test_automation:1419)
```

**3. Three persisted retry counters, of which two have never incremented.**

| column | rows | non-default | verdict |
|---|---:|---:|---|
| `persona_executions.retry_count` | 2,188 | **98** | live; max observed **2** against `MAX_RETRY_COUNT = 3` |
| `team_assignment_steps.retry_count` | 1,488 | **172** | live; the QA fix loop |
| `persona_events.retry_count` | 4,972 | **0** | the DLQ has **never fired**; 0 `dead_letter` rows |
| `scheduled_retries` (the durable queue) | **0** | — | empty right now; 20 live usage-limit retries prove it has run |
| `persona_automations.retry_count` | **0** | — | the best-built retry loop in the tree **has never run** |

**The money, measured.** Of `$2,036.26` lifetime execution spend, **`$76.66`
(3.76%) was spent on retries** — 98 retry executions, of which **52 failed**
and 45 completed. A retry in this app costs, on average, `$0.78`, and has a
**46% success rate**.

**The live delay distribution, and it corroborates the replay exactly.**
91 retries have a measurable gap between the parent's `completed_at` and the
retry's `created_at`:

| parent failure | n | measured gap | the code says |
|---|---:|---|---|
| `Execution timed out after Ns` | 11 | **2–6 s** | `spawn_delayed_retry(5, …)` — `mod.rs:3384` |
| `Execution failed (exit code 1)` | 29 | **2–20 s** | `min(5 × 2^c, 30)` — `healing.rs:555`, and c ≤ 2 live |
| `Claude usage limit reached` | 20 | **18,134–49,355 s** (5.0–13.7 h) | `RetryAt(reset)`, durable via `scheduled_retries` |
| *(parent `completed`, no error)* | 30 | 11,495–580,771 s | **not a retry at all** — see D6 |

---

## Principle (stack-free head)

Per the [portability test](../research/portability-test.md), the head is
physically separated and each clause carries its warrant, so an adopting repo can
tell physics from local calibration. No file path, primitive name or count
appears below this line until the head ends.

> **P1 — physics, and it is the whole subject.** *A retry is a bet that the world
> changed.* If nothing between attempt N and attempt N+1 could plausibly have
> changed — not the remote system's load, not a token, not a lock, not the input —
> the retry is not resilience, it is the same call twice. **The delay is the
> mechanism by which the world is given a chance to change**, which is why "retry"
> and "backoff" are one decision and not two.
>
> **P2 — physics.** *Retry only what a retry can fix.* A transport failure, a
> timeout, a rate limit and a server error are statements about the world;
> everything else in the client-error family is a statement about your request,
> and it will be equally true next time. A retryable set that is too wide burns
> quota on a permanent failure; one that is too narrow gives up on a recovery that
> was one second away. **State the set explicitly and say why the complement is
> excluded** — the sentence is the artifact, not the list.
>
> **P3 — physics, and the least-implemented clause in the fleet.** *When the
> remote system tells you when to come back, that instruction outranks your
> arithmetic.* Your exponential curve is a guess about a system you cannot see;
> the server's own hint is a measurement from inside it. Prefer the hint, bound it
> so a hostile or broken value cannot wedge you, and fall back to the curve.
>
> **P4 — physics, and it is the one people skip.** *Identical backoff schedules
> synchronise.* N clients that failed on the same upstream event will all wake at
> the same instant, because they all computed the same delay from the same
> attempt number. The recovering system then receives its entire load in one
> spike, fails again, and the herd re-forms — tighter each round, because the
> failures are now perfectly correlated. **Randomise the delay.** This costs one
> line and is the difference between a backoff that spreads load and one that
> concentrates it.
>
> **P5 — physics.** *A retry needs three numbers, not one: how many, how long
> between, and what happens when it stops.* An implementation missing the third is
> not "still trying" — it is a failure the system has decided never to report. The
> terminal state must be a distinct, observable outcome (a dead-letter row, an
> issue, a raised error), because "retrying forever" and "succeeded" look
> identical from every dashboard.
>
> **P6 — physics, and it is where the money is.** *An unbounded retry is a
> resource commitment of unknown size.* Where each attempt costs money, a token
> quota, or a rate-limit slot, "retry until it works" is a blank cheque written
> against a system that may never work. Boundedness is not tidiness; it is the
> only thing that makes the cost of a failure finite.
>
> **P7 — physics, and it is the same question as idempotency.** *A retry after a
> timeout is a second execution of an operation that may already have succeeded.*
> The timeout told you nothing about the remote system's state — only about your
> patience. So retrying a non-idempotent effect is a decision to possibly perform
> it twice, and it must be made deliberately, per call, with a key that lets the
> far side collapse the duplicate. Inheriting it from a generic helper is how a
> customer gets billed twice.
>
> **P8 — physics.** *A retry plan and the deadline above it are one arithmetic.*
> `attempts × per_attempt_deadline + Σbackoff` is the real wall clock, and it is
> the number every enclosing bound must be sized against — the reaper that
> declares the work stale, the request timeout, the function's own execution
> ceiling. Deriving either from the other is correct; deriving neither means one
> of them will fire in the middle of legitimate work.
>
> **P9 — physics, corollary of P8.** *Retrying past your own deadline is work
> nobody will read.* Before sleeping, check whether the answer can still arrive in
> time. A retry scheduled after the caller has given up costs a full attempt and
> produces a result with no consumer.
>
> **P10 — ergonomics, and it is the precondition for P8.** *A retry budget that
> is a literal at the loop that spends it cannot participate in any relationship.*
> No enclosing bound can be derived from it, no test can assert it, no operator
> can tune it, and the next author will write a different one three lines away.
> Naming the budget is not style; it is what makes the arithmetic in P8
> expressible at all.
>
> **P11 — ergonomics.** *A backoff that dies with the process is a backoff that a
> restart deletes.* Where the wait is longer than a plausible restart interval —
> minutes, hours, a provider's rate-limit window — the schedule belongs in
> durable storage, not in a sleeping task. **And the moment you persist it you
> owe P5 and P6 in the same commit**, because a durable retry with no budget is
> the only kind that can run for months.
>
> **Scale condition.** P1, P2 and P5 pay on the first failure. P7 pays the first
> time a retried call has a side effect. P10 pays the second time anyone reads the
> file. P8 and P9 bite the first time a retry sits under a deadline — which is
> immediately, because a client timeout inside a request handler already is one.
> P4 pays only at fleet scale and is invisible until then, which is why it is the
> clause everyone skips and the one that turns an outage into a longer outage.
> P3 and P11 pay at the first real provider incident.

### Warrant evidence — five siblings, censused independently

`brainiac` (Rust, 8 crates), `ascent` (Next.js/Prisma), `personas-cloud` (TS
monorepo + Python facade), `vibeman` (Next.js + Tauri), `personas-web` (Next.js).
**All five present, all five opened, none silent — every repo retries something.**

| repo | retry impls | bounded | jitter | reads `Retry-After` | persisted | deadline-aware |
|---|---:|---:|---:|---|---|---|
| `personas-web` | 2 | 0/2 | 0 | 1 (a script) | no | no |
| `personas-cloud` | 3 | 2/3 | 0 | **write-only** | **yes** | no |
| `brainiac` | 5 | 2/5 | **1/5** | **zero occurrences** | **yes** | no |
| `vibeman` | ≥21 | 19/21 | 2/21 | **yes, the real header** | **no** | no |
| `ascent` | 7 | 6/7 | **1/7 (full jitter)** | read ×2, slept-on ×1 (dead) | **yes** | **yes** |
| **Personas** | **~20** | 19/20 | **0** | **0** | **yes** | **half** |

- **P1/P2 converge hardest, and the *prose* converges more than the code.**
  Four repos independently wrote a retryable-set literal and four independently
  wrote a sentence justifying the exclusion:
  `brainiac/crates/brainiac-gateway/src/resilience.rs:219-221` — *"Permanent
  (auth, validation) — do not retry."*;
  `ascent/src/lib/github/checks.ts:16-19` — *"retrying a permission error just
  burns quota forever."*; `vibeman/src/lib/llm/base-client.ts:201-203` — *"Other
  4xx are deterministic (bad key, bad request) and must NOT be retried."*;
  `ascent/src/lib/auth.ts:519-525`. **Three of the four sets contain `429`.**
  Personas' set (`automation_runner.rs:350-359`) is
  `{timeout, connect-failure, 5xx, 401}` and is the only one that omits it.
  **Physics, and Personas is the outlier.**

- **P3 is the clause the fleet has almost failed to build, and one sibling is the
  proof it is buildable.** `vibeman/src/lib/llm/base-client.ts:238-252` parses the
  header in *both* legal forms (delta-seconds and HTTP-date), clamps it with
  `MAX_RETRY_AFTER_MS = 60_000` (`:208`), and **prefers it over the computed
  backoff** (`:318 const delay = retryAfter ?? baseDelayMs * Math.pow(2, attempt)`).
  `ascent` reads it at two sites and plumbs it onto two error classes — and the one
  consumer that would *sleep* on it reads a field nothing sets, honestly labelled
  at `checks.ts:33-36`. `personas-cloud` and `personas-web` only **emit** it.
  `brainiac` has **zero occurrences of the string** while shipping demo fixtures
  that are literally standards documents about retry policy. **Personas: zero.**
  One repo of six does it; that one repo does it completely; and this repo's own
  `db/src/builtin_connectors.rs:929` tells its agents, in the Jira gotchas,
  *"429 responses include a Retry-After header you must honor."* **The knowledge
  is in this repository's data and absent from its code.**

- **P4 is the clause the corpus disagrees with itself about — and one repo
  disagrees with itself internally, deliberately, in two files.**
  `ascent/src/lib/db/client.ts:281-283` argues full jitter is mandatory:
  *"delay ∈ [0, min(maxDelayMs, baseDelayMs·2^n)) — **so a herd of conflicting
  retriers spreads out instead of re-colliding in lockstep**."*
  `ascent/src/lib/scan.ts:40` argues the opposite for a different call path:
  *"fixed (no jitter) to keep the scan path deterministic-friendly."* Both are
  written down with reasons. Across the fleet there are **four different widths**
  — full jitter (ascent), equal jitter (`brainiac/resilience.rs:229-234`,
  `backoff + U[0, backoff/2)`, hand-rolled from `SystemTime` nanos to avoid a
  `rand` dependency), ±10% (`vibeman/retryStrategy.ts:127`), ±25%
  (`vibeman/useSSEStreamWithBackoff.ts:30`) — **and two repos with none at all.**
  Of five reconnect loops across four repos, exactly one has jitter. **P4 is
  physics with weak fleet adoption**, which is why §2 states it as a default with
  a named, legitimate exception rather than as an absolute.

- **P5 converges in three vocabularies and the sharpest is a two-outcome split.**
  `personas-cloud` writes `dead_letter` (`eventProcessor.ts:428`);
  `ascent/src/lib/github/checks.ts:42-44` rethrows loudly *"so the caller can
  react … rather than lose the required status silently"*; and
  `brainiac/crates/brainiac-store/src/queue.rs:196-208` distinguishes **`failed`**
  (adjudicated: the work was tried and lost) from **`dead`** (poison: the worker
  died mid-attempt), reaped at claim time. Personas has all three shapes
  (`CreateIssue`, `dead_letter`, the persist dead-letter at
  `persist.rs:97-105`) — and the one retry that needs a terminal state most has
  none (§0).

- **P6/P11 — Personas is in the top group on durability and the bottom group on
  bounding it.** Three siblings persist the next attempt time
  (`persona_events.next_retry_at`; `queue.jobs.visible_at` +
  `documents.compose_next_at`; `Repository.nextScanAt`), and all three arrived
  independently at *"the database row is the timer."* **`vibeman` is the negative
  control and it is stark: ≥21 retry loops, 100+ migrations, and not one
  `retry_count` / `backoff_until` / `next_attempt_at` column anywhere.** The repo
  with the most retry code has the least durable retry. Personas persists three
  counters and one backoff — and the backoff is the unbounded one.

- **P7 is convergent as an unguarded defect with exactly one guardian, and that
  guardian is worth copying verbatim.** `vibeman`'s
  `src/components/cli/store/cliExecutionManager.ts:605-608`:
  > *"On hard refresh, the server-side CLI processes keep running. Recovery must
  > **NOT** blindly re-queue and restart tasks — that would create duplicate
  > processes and hit the concurrent execution limit, causing immediate failure."*

  It then checks server-side liveness before re-queueing. Against that:
  `personas-web/scripts/setup-discord.mjs:52-57` recurses a **POST** on `429`
  with no attempt cap and no cap on the slept value, across 11 mutating call
  sites; `personas-cloud/dispatcher.ts:1406` re-queues an execution spawn five
  times with no comment either way — **while the same repo owns a complete
  `Idempotency-Key` cache at `httpApi.ts:349-390` that is wired only to inbound
  HTTP and not to either retry path.** Personas' equivalent is §7 D3.

- **P8/P9 do NOT converge, and the two halves live in two different repos.**
  `ascent/src/lib/scan.ts:367-379` is the only place in six codebases that
  computes the product and caps it:
  > *"Each attempt enforces its own per-call timeout (LLM_TIMEOUT_MS), but the
  > resilience plan (primary + retry + failover) **MULTIPLIES** them — three ~60s
  > attempts can burn ~181s and blow the serverless function timeout BEFORE the
  > mock degrade ever runs… Cap the TOTAL time across attempts."*

  with `if (llmDeadline.signal.aborted) break;` at `:396` — *"budget spent, don't
  sleep before a doomed retry."* That is **P9, and it exists exactly once in the
  fleet.** The mirror image is in **this** repo:
  `db/src/repos/resources/automations.rs:548-561` derives the **reaper threshold**
  from the retry plan and rejects the constant-multiple heuristic by name. **Two
  authors, two languages, no contact, the same arithmetic used in opposite
  directions — ascent bounds the retry by the deadline, Personas bounds the
  deadline by the retry — and neither repo has both.** `vibeman` is the near-miss
  that makes it legible: `retryStrategy.ts:159,188,207` *accumulates*
  `totalDelayMs` and returns it in `RetryResult`, and never compares it to
  anything. The arithmetic exists and is discarded.

- **P10 is silent as a stated principle in 6 of 6 and visible as a defect in all
  of them.** No repo names it. Personas measures 8 anonymous budgets against 12
  named (§9), which is the best ratio measurable in the fleet and still a
  40% deviation from its own convention.

- **A convergent structure worth importing: a circuit breaker ABOVE the retry,
  for the same stated reason, in two repos with no shared code.**
  `brainiac/resilience.rs:10-13` — *"so a dead upstream doesn't burn the retry
  budget of every queued job"* — and `vibeman/src/lib/llm/circuitBreaker.ts:38`.
  Personas has `engine/failover.rs` (`CIRCUIT_BREAKER_THRESHOLD`) and a
  **storm cap** (`healing.rs:257-275`) that is a better statement of the same
  idea than either sibling's, quoted in §6.

---

## 1. Trigger

You are in this situation when you are about to type or say:

- "just retry it" · "add a retry" · "try it three times"
- "it fails intermittently" · "it's flaky, wrap it in a loop"
- "wait a bit and try again" · "back off and retry"
- "the provider rate-limited us" · "we got a 429 / a 503"
- "what if the token expired — refresh and retry?"
- "how long should we keep trying before giving up?"
- **If you are about to type `for attempt in`, `while attempt <`, `retry_count`,
  `max_attempts`, `backoff`, `sleep(` *inside* a failure branch,
  `2u32.pow(attempt)`, `Math.pow(2, n)`, `catch { … return fn() }`, or
  `setTimeout(retry, …)` — you are in this situation.**
- If you are about to *persist* an attempt counter or a "next attempt" timestamp
  to a database column, you are in this situation **and §2(f) and §2(g) are not
  optional**, because a durable retry is the only kind that can run for months.

**Not this path:** *how long one attempt gets, and the bound above the whole
plan*, is [timeout-tiering](./timeout-tiering.md); *whether the far side can tell
two arrivals apart* is [idempotent-invocation](./idempotent-invocation.md);
*which client you take and what it does to a credential* is
[outbound-http-call](./outbound-http-call.md); *a loop that repeats work on a
cadence regardless of failure* is [background-loop](./background-loop.md) /
[polling-loop](./polling-loop.md) — **re-reading a row until a value appears is a
poll, not a retry**; *what a sweep writes to an abandoned row* is
[terminal-state-and-recovery](./terminal-state-and-recovery.md).

## 2. The one way

**Write the three numbers before you write the loop — how many attempts, the
delay schedule, and what happens when it stops — give all three names, and put
the randomness in.** Concretely: (a) **name the budget.** `const MAX_ATTEMPTS`,
never `for attempt in 0..3u8`; a literal at the loop cannot be related to
anything, and P8's arithmetic needs it. (b) **State the retryable set as data and
write down why the complement is excluded** — transport failure, timeout, `429`
and `5xx` are about the world; the rest of `4xx` is about your request. **`429`
belongs in the set** (§7 D4 is the one place here it is missing) and `401` belongs
only if you re-resolve the credential before the next attempt, which
`automation_runner.rs:78-88` does correctly. (c) **Grow the delay and cap it** —
`min(base × 2^(n-1), cap)` — and **add jitter**: `delay = random() × ceiling` (full
jitter) or `base + random(base/2)` (equal jitter). A fixed delay is legitimate for
exactly one case, and you must say so in a comment: a *deterministic* path with a
single client, where the reproducibility is worth more than the spreading
(`ascent/src/lib/scan.ts:40` is the model). (d) **If the response says when to come
back, obey it** — read `Retry-After`, clamp it against a ceiling so a hostile or
mis-parsed value cannot wedge the caller, and fall back to (c) when absent. (e)
**Decide, out loud, whether repeating this effect is safe** — one sentence in a
comment. If the operation is not idempotent, carry a key derived from the request
so the far side collapses the duplicate ([idempotent-invocation](./idempotent-invocation.md)
§2(a)), and remember that **a timeout is the failure mode where the first attempt
most likely succeeded.** (f) **Give it a terminal state that is observable** —
a dead-letter row, a healing issue, a raised error — never "keep going". (g) **Do
the deadline arithmetic in both directions**: your plan costs
`attempts × per_attempt + Σbackoff`, so size every enclosing bound against that
number (`automations.rs:564-593` computes it per row in SQL), *and* check the
remaining deadline before you sleep, because a retry scheduled past it is work
nobody will read (`ascent/src/lib/scan.ts:396`). (h) **If the wait is longer than
a plausible restart — minutes, hours, a provider window — persist it**, and ship
(a) and (f) in the same commit; the one persisted backoff here has neither and has
been running for 67 days. Then stop: do not wrap a retry around a loop that
already retries, do not retry a permanent error to be safe, and **do not raise the
attempt count to fix a failure the attempts are not addressing** — that is the same
mistake as raising a timeout to fix a timeout, and `healing.rs:372-388` already
knows it, which is why it escalates to `CreateIssue` after `MAX_RETRY_COUNT`.

If you must get one right first: **(f)**. (a) and (c) are legibility and load
shape; (b), (e) and (g) fail loudly the first time you look at the data. **(f) is
the one that fails silently and permanently — a retry with no terminal state is a
failure the system has decided never to report, and its own dashboard will show
you nothing at all.**

## 3. Mandated primitives

**Exist today — use them:**

| primitive | what it gives you |
| --- | --- |
| `db/src/repos/resources/automations.rs:538-597` `reap_stale_runs` | **the P8 arithmetic, and the one site to copy for it.** Computes `max_attempts × timeout_ms + backoff_sum(max_attempts) + REAP_SAFETY_GRACE_MS` per row, in SQL, and **names the heuristic it replaced with its arithmetic**. Replayed in §6: its `0/1000/3000/7000/15000` matches `automation_runner.rs:89` to the millisecond |
| `src/engine/automation_runner.rs:60-107` | **the one real HTTP retry loop, and the shape to copy.** Budget from the work's own config (`retry_count.clamp(1,5)`), exponential with a named `MAX_BACKOFF_MS` cap, a typed retryable predicate, an auth re-resolve on `401` *before* the next attempt, and per-attempt warnings recorded on the run. Fix the set (§7 D4) and the key (§7 D3); copy everything else |
| `engine/src/execution_engine/persist.rs:10-105` | **the best-documented small retry in the tree.** `PERSIST_MAX_RETRIES = 3` and `PERSIST_INITIAL_BACKOFF_MS = 200` are both named, the doc comment states the resulting sequence (*"doubles each retry: 200ms → 400ms → 800ms"*), and exhaustion **dead-letters**: it force-marks the execution failed *"so it doesn't stay stuck in running forever"* and emits a healing event so the loss is visible. P5 and P10 in one 100-line function |
| `core/src/healing.rs:236-275` `storm_capped_diagnosis` | **the best terminal state in six repositories.** A cross-chain cap that stops scheduling durable retries when a persona hits N environmental failures in a window, with the reason in the user-facing text: *"Automatic retries are paused so the fleet stops hammering an ongoing provider incident."* It exists because the per-chain budget and the persona circuit breaker both structurally miss this case, and it says so |
| `core/src/healing.rs:113-120` `API_ERROR_BASE_RETRY_MINUTES` | the escalation ladder written out with its horizon *and its reason*: *"The Claude CLI already retries 5xx/overloaded internally, so by the time one surfaces here the provider is mid-incident; an immediate retry is pointless but a delayed, escalating one rides it out."* This is P1 stated better than the head states it |
| `db/src/repos/execution/scheduled_retries.rs` + `src/engine/mod.rs:1589-1655` | **the durable-retry queue, and its claim discipline.** `drain_due_scheduled_retries` **deletes the row before dispatching** — *"a retry that fails to spawn must not re-fire on every subsequent tick"* — re-reads the current `retry_count` and drops the retry if the budget is exhausted, and chooses resume-vs-fresh from the reason tag |
| `db/src/repos/resources/credentials.rs:764-815` `increment_refresh_backoff_atomic` | the read-modify-write of a persisted attempt counter **inside one transaction**, so two ticks cannot clobber each other's count (`:793-794` says exactly that). The mechanism is right; §7 D2 is about the schedule it drives |
| `core/src/models/credential_ledger.rs:224-253` | the typed ledger: `is_in_refresh_backoff()`, `increment_refresh_backoff(steps)`, `clear_refresh_backoff()`. **Clearing on success is P-physics and 5 of 5 siblings do it**; this is where it lives here |
| `db/src/repos/communication/events.rs:961-990` `reap_stuck_processing` | the DLQ transition as one statement: `retry_count = retry_count + 1, status = CASE WHEN retry_count + 1 >= ?1 THEN 'dead_letter' ELSE 'pending' END`. The counter and the terminal state move together and cannot disagree. **Zero live rows have ever used it** (§7 D7) |
| `src/lib/utils/apiError.ts:157-172` `withRetry` | the frontend's one retry helper: classify, retry once if transient, rethrow the classified error otherwise. Its 5 call sites are all **reads**, which is why it needs no key. `TRANSIENT_PATTERNS` (`:43-61`) **includes `429`** — the frontend's set is better than the backend's |
| `src/lib/lazyRetry.ts:20-33` | one retry, 1.5 s, for a chunk import, with a 20-line docstring explaining why a *second* retry and a fresh `React.lazy` were tried and made it worse (an infinite loading skeleton). **A worked example of P6 at N=1** |
| `src/stores/slices/system/cloudSlice.ts:46` `CLOUD_BACKOFF_STEPS` · `src/App.tsx:79` `BACKOFF_MS` · `src/lib/eventBridge.ts:104` `LISTENER_RETRY_DELAYS_MS` | the three named TS step tables. Two of the three also name their attempt cap; the third does not, and that is §7 D1 |

**Do NOT build:** a second generic retry helper (`vibeman` has three and its
highest-value call path uses none of them); a retry whose delay is `sleep(2)` at
the site (§9); an attempt budget as a literal in the loop header (§9); a retryable
predicate that substring-matches a formatted message (`automation_runner.rs:353`
must, because the layer below threw the status away — see
[typed-error-contract](./typed-error-contract.md)); a retry around a mutation you
have no key for; a persisted backoff without a bound and a terminal state in the
same commit; a `1 << runtime_counter` (§7 D5).

## 4. Steps

1. **Say out loud what could change between attempt N and N+1.** A queue drains, a
   token refreshes, a lock releases, a deploy finishes, a provider's incident ends.
   If you cannot name it, you do not have a retry — you have the same call twice,
   and the honest fix is elsewhere.
2. **Write the three numbers as named constants before the loop.** How many, the
   base and cap of the delay, and the terminal state. `PERSIST_MAX_RETRIES` +
   `PERSIST_INITIAL_BACKOFF_MS` + the dead-letter write, in one file, is the model.
3. **Write the retryable set as an explicit predicate, and a comment saying why
   the complement is out.** Include `429`. Include `401` **only** if you
   re-resolve the credential first.
4. **Compute the delay: `min(base × 2^(n-1), cap)`, then randomise it.** If you
   deliberately want a fixed delay, write the sentence justifying it — one
   sibling has that sentence and it is legitimate.
5. **Read the server's hint if there is one.** `Retry-After`, clamped. Zero sites
   in this repo do; one sibling does it completely and is 15 lines
   (`vibeman/src/lib/llm/base-client.ts:238-252`).
6. **Do the P8 arithmetic in both directions, now.** `attempts × per_attempt +
   Σbackoff` — write the number down, check what bound sits above it
   (`timeout-tiering` §4 step 5 is the other half of this step), and add a
   remaining-deadline check before the sleep.
7. **Ask the type-over-gate question before §9.** For a retry the answer is
   usually not a newtype — see §10; it is a signature that will not run without a
   policy value.
8. **Decide about the side effect and write one sentence.** If it is not
   idempotent, thread a request-derived key and follow
   [idempotent-invocation](./idempotent-invocation.md) §2(a).
9. **Give exhaustion a row somebody reads.** A healing issue, a `dead_letter`, a
   raised error. Then check you can *find* it: `persona_events` has a perfect DLQ
   and 0 rows in 4,972 have ever reached it.
10. **If the wait can outlive the process, persist it — and bound it in the same
    commit.** `scheduled_retries` is the shape; `oauth_refresh_backoff_until` is
    the warning.
11. **And then stop.** Do not add a second retry layer above one that already
    retries. Do not widen the retryable set to be safe. Do not raise the attempt
    count to fix a failure the attempts are not addressing.

## 5. Anti-patterns

| Anti-pattern | Failure mode |
|---|---|
| **A persisted backoff with no attempt cap and no terminal state** | It runs until something unrelated stops it, and nothing reports it. **Live: `oauth_refresh_fail_count` 49 and 21 against a 4-rung ladder; `backoff_until` 67 and 90 days stale; halted by a 7-day staleness ceiling in a different subsystem while `needs_reauth: true` sat unread.** §7 D2 |
| **An unbounded retry written as a saturating index** | `Math.min(nextAttempt, STEPS.length - 1)` reads like a bound and is not one — the *index* saturates, the *attempt* does not. **`useCloudHealthMonitor.ts:121-122`: 63 attempts in the first hour, ~1,443 in the first day, forever.** §7 D1 |
| **A retry set that omits `429`** | The one transient failure that tells you *exactly* what to do is the one you decline to act on. **`automation_runner.rs:350-359` is `{timeout, connect-failure, 5xx, 401}`; three of four sibling repos include `429` and each wrote a comment about it.** §7 D4 |
| **Never reading `Retry-After`** | You replace a measurement from inside the remote system with a guess from outside it. **Zero reads in 963 + 4,423 files — while `builtin_connectors.rs:929` instructs this app's own agents that a Jira 429 *"includes a Retry-After header you must honor."*** §7 D8 |
| **An identical backoff curve on every client** | Everyone that failed on one upstream event wakes at the same instant and re-forms the herd. **Zero jitter in either language here; 1 of 5 reconnect loops across four sibling repos has any.** §7 D9 |
| **Retrying a POST after a timeout with no idempotency key** | The timeout said nothing about the far side. **`automation_runner.rs:99` re-sends any method — POST/PUT/PATCH/DELETE — on `msg.contains("timed out")`, with no `Idempotency-Key` anywhere in the file.** §7 D3 |
| **A retry budget as a literal in the loop header** | Nothing can be derived from it, asserted against it, or tuned. **8 of 20 budgets here; and `test_automation.rs:160`+`:163` write the same budget twice, as `0..3u8` and `attempt < 2`, which must agree and nothing checks.** §9 |
| **A delay that does not grow** | Attempt N+1 gives the world exactly as long as attempt N did, so the retry is a repetition rather than a bet. **5 of 18 loops; `spawn_delayed_retry(5, …)` is the timeout ladder's whole schedule and live data shows all 11 timeout retries at 2–6 s.** |
| **`1 << runtime_counter`** | The counter is a `COUNT(*)` with no cap. At 64 it is a **panic in a debug build** and a **schedule reset in release** (`1u64 << 64` masks to `1 << 0`). **`healing.rs:330` and `:555`; live max is 2, structural max is `u32::MAX`.** §7 D5 |
| **Reusing the retry lineage for something that is not a retry** | Every retry metric silently includes it. **30 of 98 `retry_of_execution_id` rows point at a parent that *completed successfully* — `incident_continuation.rs:266` calls `create_retry` for a continuation, and says so in a comment.** §7 D6 |
| **A retry with no delay at all inside a hot path** | Re-attempts into the identical conditions that just failed. `kpi_binding.rs:480` retries a CLI spawn immediately on a flake; the other five zero-delay loops are correct content, which is why §9 refuses to gate this |
| **A dead-letter queue nobody has ever reached** | It is a mechanism, not a guarantee, until a row goes through it. **`persona_events`: 4,972 rows, `retry_count = 0` on every one, 0 `dead_letter`.** §7 D7 |

## 6. Evidence

### Every backoff schedule in the repository, replayed

Transcribed verbatim from source and executed. This is the table that does not
exist anywhere in the codebase.

| # | site | attempts | delay sequence | Σ backoff | grows? | jitter |
|---|---|---:|---|---:|---|---|
| 1 | `engine/automation_runner.rs:60,:89` (`retry_count = 5`) | 5 | `1s, 2s, 4s, 8s` | **15 s** | ✅ ×2, cap 30 s | ❌ |
| 2 | `engine/execution_engine/persist.rs:30,:116,:147` | 4 | `200ms, 400ms, 800ms` | **1.4 s** | ✅ ×2 | ❌ |
| 3 | `src/engine/oauth_refresh.rs:319-323`, `:626-630` | 3 | `150ms, 300ms` | **450 ms** | ✅ **linear** (`150 × attempt`) | ❌ |
| 4 | `src/engine/oauth_refresh.rs:53` `REFRESH_BACKOFF_STEPS` | **∞** | `15m, 1h, 4h, 24h, 24h, 24h…` | **unbounded** | ✅ then flat forever | ❌ |
| 5 | `core/src/healing.rs:330` RateLimit/External | ≤4 | `30s, 1m, 2m, 4m, 5m…` (cap 300 s) | ≤ **7 m** | ✅ `1 << c` | ❌ |
| 6 | `core/src/healing.rs:555` Transient | ≤4 | `5s, 10s, 20s, 30s` (cap 30 s) | ≤ **35 s** | ✅ `1 << c` | ❌ |
| 7 | `core/src/healing.rs:116` ApiError (durable) | 4 | `10m, 20m, 30m` | **1 h** | ✅ linear | ❌ |
| 8 | `src/engine/mod.rs:3384` Timeout retry | 4 | `5s, 5s, 5s` | **15 s** | ❌ **flat** | ❌ |
| 9 | `src/commands/infrastructure/cloud.rs:681` | 4 | `1s, 2s, 4s` | **7 s** | ✅ step array | ❌ |
| 10 | `src/cloud/runner.rs:33-35,:60-62` poll errors | 10 | `800ms … 30s` (6 doublings, then flat) | **2 m 50 s** | ✅ ×2, cap 30 s | ❌ |
| 11 | `engine/src/eval.rs:480` | 2 | `2s` | **2 s** | ❌ flat | ❌ |
| 12 | `src/engine/kpi_binding.rs:480` | 2 | *(none)* | **0** | ❌ | ❌ |
| 13 | `src/test_automation.rs:160` | 3 | `500ms, 500ms` | **1 s** | ❌ flat | ❌ |
| 14 | `src/App.tsx:79` `BACKOFF_MS` | 4 | `5s, 15s, 45s` | **65 s** | ✅ ×3 step array | ❌ |
| 15 | `src/lib/eventBridge.ts:104` | 4 | `500ms, 1.5s, 4.5s` | **6.5 s** | ✅ ×3 step array | ❌ |
| 16 | `src/lib/lazyRetry.ts:29` | 2 | `1.5s` | **1.5 s** | n/a | ❌ |
| 17 | `src/lib/utils/apiError.ts:159` `withRetry` | 2 | `2s` (`5s` if `rate_limited`) | **≤5 s** | n/a | ❌ |
| 18 | `useCloudHealthMonitor.ts:121` + `cloudSlice.ts:46` | **∞** | `5s, 10s, 20s, 60s, 60s…` | **unbounded** | ✅ then flat forever | ❌ |
| 19 | `src/hooks/utility/timing/usePolling.ts:76-80` | n/a | `interval×2`, `interval×4` (cap) | — | ✅ but **2 rungs** | ❌ |

**Nineteen schedules. Zero jitter. Two unbounded. Seven flat or effectively flat.**

Two of these deserve their arithmetic spelled out:

- **#1 is exactly right and provably so.** Replayed for `retry_count ∈ 1..5`, the
  cumulative backoff is `0 / 1000 / 3000 / 7000 / 15000` ms — **character-for-
  character the `CASE` in `automations.rs:583-589`**. The reaper and the retry are
  the same arithmetic in two languages, and the doc comment computes the worked
  example (`5×30s + (1+2+4+8)s = 165s`) that makes `2 × timeout_ms` visibly wrong.
  The 30 s cap never binds inside the 1..5 clamp — it would first bind at attempt
  6 — which is the sort of dead branch a replay finds and a reading does not.
- **#19 has two rungs, not five.** `interval * Math.pow(2, errorCount)` with
  `errorCount` starting at **1** and `maxBackoff` defaulting to `interval * 4`
  means the cap binds on the *second* error. A reader sees an exponential; the
  execution is `2×, 4×, 4×, 4×…`.

### The one site to copy: `src/engine/automation_runner.rs:60-107`

Six decisions worth copying, five of which no other retry here makes:

1. **The budget comes from the work's own configuration**, per row
   (`automation.retry_count.clamp(1,5)`), so one number cannot be wrong for two
   automations — the same property that makes `reap_stale_runs` computable.
2. **The clamp is at the read, not at the write**, so a bad stored value cannot
   produce an unbounded loop.
3. **The cap is a named constant** at the top of the block
   (`const MAX_BACKOFF_MS: u64 = 30_000`).
4. **`401` triggers a credential re-resolve *before* the next attempt**
   (`:78-88`) — the retry changes the world rather than repeating into it, which
   is P1 in nine lines.
5. **Every attempt is recorded on the run** (`"Succeeded on attempt 2/5"` /
   `"Failed after 5/5 attempts"`), so the retry is visible in the artifact rather
   than only in a log.
6. **The predicate is a named function with a doc comment stating the
   complement** (`:346-349`).

> **And it has never run.** `persona_automations` is **empty** and
> `automation_runs` is **empty** in the operator's database. The best-built retry
> in the repository, and the threshold derived from it that
> [timeout-tiering](./timeout-tiering.md) calls the best in six repos, have
> together evaluated **zero rows**. Correct, and untested by use — the same shape
> that path found for `validate_url_safety`.

Supporting exemplars, each for one property:

| site | the property to copy |
| --- | --- |
| `engine/src/execution_engine/persist.rs:10-105` | the three numbers all named, the sequence stated in prose, and **exhaustion dead-letters with a user-visible healing event** |
| `core/src/healing.rs:236-275` | a **storm cap** — a cross-chain terminal state for a failure class the per-chain budget structurally cannot see, with the reason in the user-facing copy |
| `src/engine/mod.rs:1598-1608` | **claim-by-delete before dispatch**: *"a retry that fails to spawn must not re-fire on every subsequent tick"* |
| `src/engine/mod.rs:1612-1620` | the durable path **re-reads the current `retry_count`** at drain time rather than trusting what was persisted with the schedule |
| `src/engine/mod.rs:1536-1554` | a retry deliberately **declined** because another subsystem owns that unit's lifecycle — *"two executions, duplicate PR attempts on one branch"* |
| `db/src/repos/communication/events.rs:973-975` | counter and terminal state in **one `UPDATE`**, so they cannot disagree |
| `src/lib/lazyRetry.ts:44-60` | a docstring recording the two *stronger* retry designs that were tried and made it worse |
| `src/engine/api_proxy.rs:899-923` | a single conditional retry after `401` + forced refresh, with the lock hand-off spelled out — **and it is safe on a POST precisely because a `401` proves the effect did not land** |

### The retry census, exactly — two implementations

Every loop in `src-tauri`, brace-matched, `#[cfg(test)]` removed as a
brace-matched range, classified by body:

```
19  structural candidates
 −1  hand-verified false positive  (commands/execution/healing.rs:62 — `for retry in &retries`
                                    iterates a Vec named `retries`; it is a dispatch loop, not a retry)
────
18  retry constructs
 ├─  7  delay GROWS   persist.rs:30,:116,:147 · automation_runner.rs:77 · oauth_refresh.rs:321,:626 · cloud.rs:682
 ├─  5  delay FLAT    eval.rs:480 · test_automation.rs:160 · build_sessions.rs:725,:2640 · approval_exec_fleet.rs:737
 └─  6  NO delay      query_debug.rs:359 · registry.rs:767 · gitlab.rs:843 · oneshot.rs:118 · kpi_binding.rs:480 · test_automation.rs:1419
```

**Plus one that is not a loop at all and matters more than any of them:**
`spawn_delayed_retry` (`mod.rs:3915`) → `create_retry` → a new `persona_executions`
row. **The principal retry mechanism in this codebase has no loop syntax**, which
is why §9's signal is honest about what it can and cannot see.

Context for the delay classes: **87 `sleep(` call sites in 963 files (48 files) —
53 with a literal duration, 17 with a named constant, 17 with an expression.**
Most are pacing, not backoff, which is exactly why §9 refuses to gate on the
sleep.

### The exponent nothing bounds

`core/src/healing.rs:330` and `:555` both compute the delay as
`N.saturating_mul(1 << consecutive_failures)`. `saturating_mul` protects the
multiply. **Nothing protects the shift.** And the module's own decision table
says so at `healing.rs:20`:

> `| consecutive_failures | Per persona (recent) | `_no hard cap_` | Feeds the exponential backoff: 30s << consecutive |`

The value comes from `count_consecutive_real_failures`
(`db/src/repos/execution/executions.rs:1106-1136`) — a `COUNT(*)` of failures
since the persona's last completed run, clamped only to `u32::MAX` at `:1133`.
**Replayed verbatim against all 78 live personas:** max streak **2**
(`Dev Clone (3)`), then 1, 1, and 75 personas at 0. Zero personas at ≥5.

So the defect is latent, not live — and it is exactly reachable by one persona
that never succeeds again:

```
c = 0..4   → 30s, 60s, 2m, 4m, 5m           (min(.., 300) binds at c=4)
c = 5..63  → 300s                            (saturating_mul → u64::MAX → 300)
c = 64     → DEBUG:   panic "attempt to shift left with overflow"
             RELEASE: 1u64 << (64 & 63) = 1  → 30s   ← the ladder RESETS
c = 65,66  → 60s, 120s …
```

`src-tauri/Cargo.toml:284-291` sets no `overflow-checks` override, so
`[profile.dev]` panics and `[profile.release]` masks. **A persona at 64
consecutive failures crashes a dev build and silently restarts its own backoff in
a shipped one.**

### The retries that actually happened — live data

Read-only copies of `personas.db` (347 MB, 244 tables) and `personas_data.db`.

```
2,188  executions
   98  carry retry_of_execution_id
   ├─  68  a genuine healing retry of a FAILED parent
   └─  30  a continuation of a COMPLETED parent   ← incident_continuation.rs:266, §7 D6
   95  at retry_count = 1        3  at retry_count = 2        0  at 3   (MAX_RETRY_COUNT = 3)
```

| | value |
|---|---|
| retry spend | **$76.66** of **$2,036.26** lifetime = **3.76%** |
| retry outcomes | 45 completed · **52 failed** · 1 incomplete → **46% success** |
| measured gap, all 91 | min **2 s** · p50 **18,841 s** · p90 **345,139 s** · max **580,771 s** |
| healing issues | Transient **117** (10 auto-fixed) · Execution failed **43** (0) · Timeout **23** (15) · Usage limit **21** (0) |

The timeout and transient gaps reproduce the replayed schedules exactly (2–6 s
against `spawn_delayed_retry(5)`; 2–20 s against `min(5 × 2^c, 30)` with the
measured `c ≤ 2`). The usage-limit gaps (5.0–13.7 h) are the durable path
computing `retry_at` from the **provider's own parsed reset timestamp** — which
is the only place in this codebase where a delay comes from the remote system
rather than from arithmetic, and it is the closest thing here to P3.

**The 117 "Transient process failure" issues with 10 auto-fixes** are the modal
retry in this installation, and they are `exit code 1` with no diagnostic output.
The category's own comment (`healing.rs:552-554`) is honest about what the backoff
is for — *"the failure is process-level, no benefit to long exponential delay… a
small grow factor to ride out very brief environmental hiccups"* — and the 8.5%
auto-fix rate is the measurement that comment predicts.

## 7. Deviations found

> **Second pass — what is upstream of all of this.** Every entry reduces to one
> shape: **a retry that answers fewer than three of the four questions.** *How
> many* is answered 19 times of 20; *how long between* is answered well 7 times of
> 18; *what stops it* is answered by the healing path and almost nowhere else; and
> *what the remote system said* is answered **zero** times. Nothing in the
> codebase can express a retry **policy** as one value, so each site re-decides
> the subset it happens to be thinking about — and the subsets differ. §10 is
> about giving the policy a name.

### D1 — P0: the cloud reconnect retries forever, and the bound is an index that saturates

`src/features/agents/sub_deployment/hooks/useCloudHealthMonitor.ts:118-127` ·
`src/stores/slices/system/cloudSlice.ts:46`.

```ts
const backoffIndex = Math.min(nextAttempt, CLOUD_BACKOFF_STEPS.length - 1);
const delay = CLOUD_BACKOFF_STEPS[backoffIndex]!;
timerRef.current = setTimeout(() => void attemptReconnectRef.current(nextAttempt, gen), delay);
```

`Math.min` reads as a bound. It bounds the **index**, not the attempt. There is no
`maxAttempts` anywhere in the file. Replayed: **5 s, 10 s, 20 s, then 60 s
forever** — 63 attempts in the first hour, ~1,443 in the first day, indefinitely,
each one a `cloudReconnectFromKeyring()` + `cloudGetConfig()` pair against an
endpoint that is not answering.

The only exits are success and `isAuthError(err)` (`:106-113`) — so an auth
failure terminates correctly and **every other permanent failure does not**. The
UI shows `isReconnecting: true` and a `nextRetryAt` forever, which is P5's exact
failure: retrying-forever and about-to-succeed render identically.

**Fix:** add `CLOUD_MAX_RECONNECT_ATTEMPTS` beside `CLOUD_BACKOFF_STEPS`, stop at
it, and set a terminal `cloudError` the way the auth branch already does. Six
lines, and the terminal copy already exists at `:110-112`.

### D2 — P0: the only persisted backoff in the tree cannot stop, and something unrelated stopped it

`src/engine/oauth_refresh.rs:53`, `:195-208`, `:243-246` ·
`core/src/models/credential_ledger.rs:234-247`.

Full chain in §0. Four discrete defects:

- **No attempt cap.** `backoff_steps[(fail_count as usize).min(max_idx)]` saturates
  the index; `fail_count` keeps incrementing. Live: **49** and **21** against a
  4-rung ladder.
- **No terminal state.** There is no `MAX_REFRESH_ATTEMPTS`, no `CreateIssue`, no
  dead-letter. `mark_needs_reauth` (`:236`) writes `needs_reauth: true` — a
  perfect terminal flag — and the loop's own eligibility test (`:169-190`) **never
  reads it**.
- **The retry is halted by a neighbouring subsystem's threshold, by accident.**
  `STALENESS_CEILING_SECS = 604800` (7 days) excludes a token expired longer than
  that. Both live credentials are 67 and 90 days past expiry, so they are silently
  dropped from the candidate set — which is why `backoff_until` has not moved
  since June. **Raise that ceiling for an unrelated reason and the unbounded retry
  resumes on two dead credentials.**
- **The backoff and the ceiling are unrelated numbers that must interlock.** Rung
  four is 24 h; the ceiling is 7 days; so after **7 attempts** the credential is
  outside the window forever. Nothing expresses that — this is
  [timeout-tiering](./timeout-tiering.md) P2 on the retry axis.

**Fix, as one unit:** (a) `if ledger.needs_reauth == Some(true) { continue; }` in
the eligibility test — one line, and it is the terminal state the codebase
already writes; (b) a `MAX_REFRESH_FAIL_COUNT` beside `REFRESH_BACKOFF_STEPS`,
after which `set_refresh_backoff` routes to healing instead of re-arming (
`route_revocation_to_healing` at `:235` is already the destination); (c) derive
the relationship — `const_assert!(REFRESH_BACKOFF_STEPS.iter().sum::<i64>() <
STALENESS_CEILING_SECS)` in spirit — or state it in the doc comment as a
calibration record.

### D3 — P0: the one HTTP retry re-sends any method on a timeout, with no key

`src/engine/automation_runner.rs:99`, `:346-359`, `:509-535`.

`is_retryable_error` returns true for `msg.contains("timed out")`. The retry then
calls `invoke_webhook(webhook_url, method, body, …)` again — where `method` is
`automation.webhook_method`, mapped at `:518-523` to `GET | POST | PUT | PATCH |
DELETE` with **POST as the fallback for anything unrecognised** (`:527-530`).

**A timeout is the one failure where the far side may already have committed the
effect.** There is no `Idempotency-Key` anywhere in the file, and none of the
`auth_headers` shapes carries one. So a slow-but-successful webhook is delivered
up to five times, 1/2/4/8 seconds apart.

This is the crossover with [idempotent-invocation](./idempotent-invocation.md),
and its census rule (`unkeyed-billable-spawn`) structurally cannot see it: that
rule anchors on `execute_persona_inner` / `create_with_idempotency` argument
lists, and this is a `reqwest` send. `ascent/src/lib/db/credits.ts:330-332` is
the sibling that paid for this exact shape — *"a commit-ambiguity blip… re-ran
the whole closure… the org charged twice for one scan."*

**Fix:** attach `Idempotency-Key: <automation_run.id>` in `invoke_webhook` — the
run id is a perfect per-invocation key and is already in hand at `:57` — and
document that a receiver which ignores it gets at-least-once. Then split the
predicate: retry a timeout only for `GET`/`HEAD`, or only when the key is
present. `automation_runner.rs:346-349`'s doc comment is the right place for the
sentence §2(e) asks for, and it currently discusses only which *errors* are
transient, never which *methods* are safe.

### D4 — P1: the retryable set omits the one status that tells you what to do

`src/engine/automation_runner.rs:350-359`:

```rust
msg.contains("timed out")
    || msg.contains("Failed to connect")
    || extract_http_status(msg).is_some_and(|s| s / 100 == 5 || s == 401)
```

`429` is absent. Confirmed and extended from
[outbound-http-call](./outbound-http-call.md) §7.G: **three of the four sibling
sets contain it, and each of those three wrote a comment justifying the
complement** (`resilience.rs:216-221`, `checks.ts:16-19`, `base-client.ts:201-203`).
A rate-limited webhook is the textbook transient failure and this is the one it
declines to retry.

Compounding it, the predicate **recovers the status by substring-matching a
formatted message** (`extract_http_status` strips the literal prefix
`"Webhook returned HTTP "`). The number was known at `invoke_webhook` and thrown
into `AppError::Execution(String)`. See
[typed-error-contract](./typed-error-contract.md).

**Fix:** `|| s == 429` (one token) — and while you are there, `s == 408`, which
`vibeman`'s set has and nobody else's does.

### D5 — P1: `1 << consecutive_failures`, where the counter is an uncapped `COUNT(*)`

`core/src/healing.rs:330` and `:555` · `db/src/repos/execution/executions.rs:1133`.

Full arithmetic in §6. Debug → panic; release → the backoff ladder **resets** to
its first rung at `c = 64` and climbs again. Live max is 2, so this is latent —
but the module's own decision table advertises the counter as having *"no hard
cap"*, and the exponent is the one place where that is not safe.

**Fix:** `1u64.checked_shl(consecutive_failures).unwrap_or(u64::MAX)`, or clamp at
the source: `Ok(n.min(u32::MAX as i64).min(BACKOFF_EXPONENT_CEILING) as u32)`.
One expression, and it converts a panic into the saturation the surrounding code
already assumes.

### D6 — P1: 30 of 98 "retries" are not retries, and every retry metric includes them

`src/engine/incident_continuation.rs:264-274` calls `exec_repo::create_retry`, and
says why in a comment — *"a NEW execution row, healing-…"*. The row lands with
`retry_of_execution_id` set and `retry_count = 1`.

**Live: 30 of the 98 rows carrying `retry_of_execution_id` have a parent whose
status is `completed` with a NULL `error_message`.** Their measured gaps are
11,495 s to 580,771 s (up to **6.7 days**), which is what produced the p90 of
345,139 s in §6 — a number that reads as "the backoff is enormous" and means
"a third of the population is not a backoff at all".

The lineage column is doing two jobs: *this is the same work, attempted again*
and *this is different work, caused by that work*. Anything counting retries —
the healing timeline, `retry_count` in the UI, this document's own first pass —
sees one population.

**Fix:** a `lineage_kind` column (`'retry' | 'continuation'`), or a separate
`continuation_of_execution_id`. Until then, every query over
`retry_of_execution_id` needs `AND p.status = 'failed'`, and this document's
numbers are reported split for exactly that reason.

### D7 — P2: a correct dead-letter queue that no row has ever reached

`db/src/repos/communication/events.rs:961-990` is the best-shaped terminal
transition in the tree: one `UPDATE`, `retry_count = retry_count + 1`, and a
`CASE` that flips to `dead_letter` at `DEFAULT_MAX_RETRIES` so the counter and the
status cannot disagree.

**Live: `persona_events` has 4,972 rows, `retry_count = 0` on every single one,
and 0 rows in `dead_letter`.** 4,941 `delivered`, 31 `skipped`. The reaper that
increments it (`reap_stuck_processing`) is only reachable from a stuck
`processing` row, and no event has ever been stuck.

Reported as a deviation rather than a success because **an untested terminal path
is a claim, not a guarantee** — the same status this document gives
`automation_runner`. It is 40 lines from being verified: the repo already has the
fixture helpers.

**Fix:** a test that drives one event through `processing` → reap → `pending` →
reap → `dead_letter` and asserts `count_dead_letter() == 1`. That is also the only
way anyone will notice that the reaped event goes **straight back to `pending`
with no delay** — a persisted retry counter with a zero backoff, which is the
inverse of D2.

### D8 — P2: `Retry-After` is read zero times, and this repo tells its own agents to read it

**Zero occurrences** of `retry-after` / `retryAfter` / `retry_after` as a *response
header read* in 963 `.rs` + 4,423 `.ts`/`.tsx` files. The near-matches are all
something else: `engine/src/rate_limiter.rs:69-89` computes a `retry_after_secs`
this app hands to **its own** callers, and `ApiError.retryAfterMs`
(`src/lib/utils/apiError.ts:19`) is a locally-chosen constant (5,000 for
`rate_limited`, 2,000 otherwise) that never touches a header.

And `db/src/builtin_connectors.rs:929`, in the Jira connector's `llm_usage_hint`
gotchas, ships this instruction to every agent that uses it:

> *"Rate limit is dynamic; 429 responses include a Retry-After header you must
> honor."*

**The doctrine and its absence are in the same repository**, one shipped as data
to the model and the other missing from the code that would act on it.

**Fix:** in `api_proxy.rs`'s response handling and in `invoke_webhook`, read
`resp.headers().get(reqwest::header::RETRY_AFTER)`, parse both legal forms, clamp
to a `MAX_RETRY_AFTER_MS`, and prefer it over the computed backoff.
`vibeman/src/lib/llm/base-client.ts:238-252,:318` is 15 lines and is the reference.

### D9 — P2: nineteen backoff schedules, zero jitter

No `rand`, `thread_rng`, `gen_range` or `Math.random()` appears within any backoff
computation in either language. (The 30 `rand` uses in `src-tauri` are nonces,
OAuth state, PKCE, genome mutation, trace ids and a radio shuffle — every one
hand-checked.)

For a local-first desktop app this is **defensible today and will not stay
defensible**: the cloud orchestrator (`src/cloud/runner.rs`), the P2P fleet, and
the shared Supabase endpoint (`cloud/sync/client.rs`) are all N-client surfaces
where every installation that failed on one upstream event computes the identical
delay from the identical attempt number.

**Fix, narrowly scoped:** jitter the three schedules that face a shared endpoint —
`cloud/runner.rs:60-62`, `useCloudHealthMonitor.ts:121`, and
`oauth_refresh.rs`'s ladder (a fleet of installations refreshing Google tokens on
the same 15 m / 1 h / 4 h / 24 h grid is a thundering herd by construction).
`brainiac/crates/brainiac-gateway/src/resilience.rs:58-69` shows how to do it in
Rust with **no `rand` dependency at all** — `SystemTime` subsec-nanos XOR pid,
under the comment *"Cheap jitter without a rand dependency."*

### D10 — P2: eight retry budgets are literals, and one construct writes the same budget twice

`engine/src/eval.rs:480` `0..2u8` · `kpi_binding.rs:480` `0..2u8` ·
`approval_exec_fleet.rs:737` `1..=2u32` · `registry.rs:767` `1..=2u32` ·
`build_sessions.rs:725` `1..=6u32` · `build_sessions.rs:2640` `1..=20u32` ·
`test_automation.rs:160` `0..3u8` **and `:163` `attempt < 2`**.

The last one is the argument for the whole gate: the same budget is written twice,
three lines apart, as two different literals that must agree (`0..3` and `< 2`),
and nothing checks that they do. Against 12 named budgets — `PERSIST_MAX_RETRIES`,
`MAX_RETRIES`, `MAX_PERSIST_ATTEMPTS`, `FALLBACK_PORT_ATTEMPTS`, `max_attempts`,
`max_tag_attempts` — so this is a 40% minority deviation from an existing in-repo
convention, not a migration with no destination.

**Fix:** hoist each to a `const` in the same file, with a one-line reason. This is
§9's population.

## 8. Gaps — what the primitives genuinely cannot do

1. **There is no retry primitive.** Not one shared helper, in either language,
   that takes a policy and a closure. Nineteen schedules, nineteen hand-rolls.
   That is upstream of D1, D4, D8, D9 and D10 — every one is a decision an author
   had to remember to make because nothing asked them for it. **The fix is §10 and
   it is one function per language**, and the reason to say it here is that
   `vibeman` built *three* generic helpers and its highest-value call path uses
   none of them: **a helper nobody is obliged to call constrains nothing.**
2. **The census cannot see the repo's most important retry**, because
   `spawn_delayed_retry` → `create_retry` is not a loop. Any signal keyed on
   iteration syntax reports the healing path as clean forever. §9 states this as a
   declared recall gap rather than pretending otherwise.
3. **The census cannot assert any of this leaf's three biggest findings**, because
   all three are *absences*: "no schedule anywhere adds jitter" (D9), "no code
   reads `Retry-After`" (D8), "this retry has no terminal state" (D2). Per the
   [doctrine](../golden-path-doctrine.md#4-census-rules) the engine ratchets a
   presence. Two of the three are gateable by a *different* instrument and §9
   specifies it.
4. **Rust cannot express "this runtime counter must stay below 64" in a type.**
   `consecutive_failures` arrives from a `COUNT(*)` through a struct field, which
   is [where types cannot reach](../golden-path-doctrine.md#where-types-cannot-reach)
   case 2. The reachable answer is `checked_shl` at the point of use plus a clamp
   at the query — strictly weaker than unrepresentable, and worth saying rather
   than pretending the type closes it.
5. **Nothing can join a retry plan to the deadline above it across a process
   boundary.** `automations.rs` gets the P8 arithmetic only because the retry and
   the reaper read the same `persona_automations` row. Where the plan is in Rust
   and the deadline is in `tauriInvoke.ts`, or the plan is local and the ceiling
   is a serverless function's, there is no shared value — the same limitation
   [timeout-tiering](./timeout-tiering.md) Gap 5 names from the other side, and
   the same one `ascent` solved only by putting both numbers in one module.
6. **A `Retry-After` you obey is a delay a remote host chooses.** Honouring it
   means letting an attacker-controlled reply set your sleep duration, which is
   why every implementation that reads it clamps it — and why "just read the
   header" is two decisions, not one.
7. **`persona_executions` has one lineage column for two relations** (D6), so no
   query can separate a retry from a continuation without joining the parent's
   status. That is a schema gap, not a laziness gap.

## 9. The missing gate

### The semantic conditions, stated first

Per the [portability test](../research/portability-test.md), what follows are
**one repo's proxies**. An adopting repo inherits the sentences and re-derives
its own signals.

> **(A)** *The number of attempts an operation gets is a literal written at the
> loop that spends them* — so no enclosing bound can be derived from it, no test
> can assert it, and the next author writes a different one nearby.
>
> **(B)** *A retry schedule advances without any randomness*, so every client
> that failed on the same upstream event wakes at the same instant.
>
> **(C)** *A retry has no terminal state* — no attempt cap and no observable
> exhaustion outcome — so "still retrying" and "succeeded" are indistinguishable
> from outside.
>
> **(D)** *A retry ignores the remote system's own instruction about when to
> return.*

**(A) is gated below. (B), (C) and (D) are refused, each with the reason and the
instrument that *can* express it named instead of a bad regex shipped.**

### What is refused, with numbers

- **(B) and (D) are ABSENCES and the census cannot express them.** There are zero
  jittered schedules and zero `Retry-After` reads, so a compliant partition does
  not exist — and a positive control returning 0 **fails the runner
  structurally**, which is the correct behaviour and the correct answer here. The
  right instrument is a **unit test on the policy type §10 proposes**: assert that
  `RetryPolicy::delay_for(attempt)` returns two different values for the same
  attempt across two calls (jitter is present) and that a `Retry-After` hint
  overrides the curve. That test is ~15 lines, runs under `npm run test:rust`, and
  fails loudly on a policy that has neither.
- **(C) is refused as a count and specified as a script.** "This retry has no
  terminal state" needs the *absence* of a reachable exhaustion branch, which is a
  reachability question over a loop body, not a lexical one. What *is* cheaply
  checkable is the narrow, high-value case that produced D1 and D2: **a persisted
  attempt counter with no cap**. Specify it as a ~40-line script — enumerate every
  DB column matching `retry_count|fail_count|attempt`, and for each, find the code
  that increments it and require a comparison against a named ceiling in the same
  function. Run today it fails on `oauth_refresh_fail_count` (incremented at
  `credential_ledger.rs:236`, compared to nothing) and passes on
  `persona_events.retry_count` (compared to `?1` in the same `UPDATE`). **Assert
  the instrument first**: it must find ≥3 counters and must PASS
  `persona_events.retry_count` and FAIL `oauth_refresh_fail_count`, or exit
  non-zero as broken rather than green as clean.
- **A "flat backoff" gate was measured and REFUSED at 40% precision.** The signal
  — a literal-duration `sleep` inside a retry loop — returns **5** matches, and
  hand-classifying them gives **2 violating / 3 correct content**:
  `build_sessions.rs:725` and `:2640` poll a database column for a value another
  task is writing, and `approval_exec_fleet.rs:737` polls a TUI session's state
  every 400 ms. **Those are polls, not backoffs** — the delay is a sampling
  interval and growing it would be wrong. A gate that fires on them would report
  correct code as broken. Declined; the numbers are published so the next composer
  does not re-litigate.
- **A "zero-delay retry" gate was measured and REFUSED at 17% precision.** 6
  matches, **1 violating** (`kpi_binding.rs:480` re-spawns a CLI immediately on a
  flake). The other five are correct: `gitlab.rs:843` retries with an *incremented
  tag version*, `test_automation.rs:1419` with a *different port*,
  `query_debug.rs:359` and `oneshot.rs:118` each run a full LLM pass per
  iteration, and `registry.rs:767` waits event-driven on a screen change. **A
  retry that changes its input needs no backoff** — that is P1 satisfied, not
  violated.

### Existing rules checked first, by reading each definition

| rule | why it does not cover this |
| --- | --- |
| `anonymous-deadline` (38/61) | **The nearest neighbour and the exact complement.** It gates *the bound on one attempt*; this gates *how many attempts there are*. Its anchor is `timeout(`, mine is a loop header. **Verified: 0 shared character positions** out of 2,843 vs 225. Together they are timeout-tiering P4's two operands |
| `unraced-loop-wait` (12/13) | `loop {` whose FIRST statement is a bare time wait — a cadence that no stop can reach. Mine fires on a retry header. **0 shared positions** |
| `unkeyed-billable-spawn` (11/13) | the `None` in an idempotency-key slot. Sibling subject (§7 D3 is the crossover) and structurally disjoint — its matches are call expressions, mine are loop headers. **0 shared positions** |
| `unverified-effect-dispatch` (60/162) · `silent-row-skip` (64/148) · `hand-rolled-emptiness-refusal` (135/305) · `untimed-repo-query` (36/245) · `process-global-caches-a-failure` (3/4) | all measured against mine: **0 shared positions each** |
| `undiscriminated-credential-rejection` (6/17) | closest in *spirit* to D4 — it counts credentialed calls that collapse a status into a message, which is why `automation_runner.rs:353` must substring-match. Different root (`src-tauri/src`), different anchor, disjoint |
| `config-value-frozen-at-compile-time`, `self-disabling-money-ceiling` | different subjects entirely |

**None of the 104 existing rules keys on the size of a retry budget. Proposing
one.**

### Measurement

**Precision 8/8 — every match opened and read.** The anchor is a retry-shaped
loop header or attempt comparison; it partitions the population by whether the
budget is a **literal** or a **name**.

```
rule                                          files  matches  walked  floor
anonymous-retry-budget                            6        8     963    900
anonymous-retry-budget-positive-control           7       13     963    900
```

**The positive control partitions the anchor's raw matches**, which is the
strongest form: **8 violating / 13 compliant out of 21 anchor matches**, so the
pattern discriminates on the *operand*, not on the presence of the word
`attempt`.

**Two independent implementations, and the disagreement is the finding.** My own
walker (brace-matched `#[cfg(test)]` removal, offset-preserving comment *and
string* blanking, plus a `*_tests.rs` filename rule — the census engine does none
of these) returns **8/6 for the violating rule, identical**, and **12/6 for the
control, one lower**. The extra one is
`db/src/repos/communication/events.rs:3139`, `for attempt in 1..DEFAULT_MAX_RETRIES`,
which sits inside the `#[cfg(test)]` module that opens at line 1821. **12 + 1 = 13
exactly.** The baseline is the runner's number because the runner is what
ratchets; the contamination is one match, in the control, in the conservative
direction.

**A prior draft of this pattern scored 7/13 and is recorded because the failure
was instructive.** It admitted `(?:while|if)\s+…(attempt|retry)…\s*[<>]=?\s*<literal>`,
and **6 of its 13 matches were the same shape**: `if attempt > 0 {` and
`if max_attempts > 1 {` — log guards and display guards, not budgets
(`automation_runner.rs:75,:102,:420,:610`, `cloud.rs:694`, and
`db/…/healing.rs:918` where the identifier is `attempted`). Restricting the
comparison to `<` / `<=` removed all six and cost nothing. **A vocabulary that
matches an identifier substring will find the word in places that are not the
concept**, and here the word was in a `tracing::info!` guard six times.

**Declared recall gaps, because a gate that hides its blind spots manufactures
confidence:**
- **The healing retry is invisible to it.** `spawn_delayed_retry` has no loop.
  Its budget *is* named (`MAX_RETRY_COUNT`), so it would be compliant anyway —
  but a repo adopting this signal must know the shape exists.
- **TypeScript is not covered.** D1's unbounded reconnect and D10's TS siblings
  need a second rule against `for (let attempt` / `attempt < N` idioms; it is not
  proposed here because the TS population is 3 sites and a 3-match rule is
  noise.
- **`while attempt < 3` with a compound left operand** beyond 60 characters
  escapes the optional prefix group.

**Where it runs:** `npm run census` / `npm run census:check` — and
`package.json`'s `check` script runs `census:check` between `check:doc-map` and
`tsc --noEmit`, so **it executes in `npm run check`, the local pre-push /
PR-self-review gate.** It is deliberately **not** in `ci.yml`: per this leaf's
calibration, `ci.yml` is red on 10 pre-existing Rust failures and its
`frontend-checks` job is red on a platform-incomplete lockfile, so a gate added
there would run behind an already-failing job and enforce nothing. The census
runner supplies the fail-loud contract itself (a walk below `floor`, a zero-match
rule, a stale `exclude`, a rise, **and a silent drop** are all fatal), so this
rule does not re-derive it. Full 963-file run: **0.58 s**; the only broad fill is
a bounded negated character class with no nested quantifier.

**This condition should reach zero** — all 8 are one-line hoists — and per the
doctrine the census cannot express that: at that point **delete the rule** rather
than baselining it at 0.

**Allowlist:** none. There is no legitimate anonymous retry budget; hoisting to a
`const` in the same file is mechanical and is the precondition for §2(g).

```json
{
  "id": "anonymous-retry-budget",
  "goldenPath": "docs/concepts/golden-paths/retry-with-backoff.md",
  "title": "The number of attempts an operation gets is a bare literal at the loop that spends them, so no enclosing bound can be derived from it and nothing can assert it",
  "roots": ["src-tauri"],
  "extensions": [".rs"],
  "signal": {
    "pattern": "\\b(?:for\\s+(?:_?attempt|_?retry|_?tries|_?try_n)\\s+in\\s+[0-9][0-9_]*\\s*\\.\\.=?\\s*[0-9][0-9_]*(?:u(?:8|16|32|64)|i(?:8|16|32|64)|usize)?\\s*\\{|(?:while|if)\\s+(?:[A-Za-z_.()0-9]+\\s*[=!<>]=\\s*[^\\n&|]{0,60}&&\\s*)?(?:_?attempt|_?retry|_?tries|_?try_n)\\s*<=?\\s*[0-9][0-9_]*(?:u(?:8|16|32|64)|i(?:8|16|32|64)|usize)?\\s*(?:\\{|&&|=>))",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "A retry budget spelled as a numeric LITERAL at the site that spends it: either a `for <attempt-ish> in <lit>..<lit> {` loop header, or a `while`/`if` guard comparing an attempt counter to a literal with `<` / `<=` (the guard form is restricted to `<`/`<=` deliberately — an earlier draft admitted `>` and `>=` and 6 of its 13 matches were `if attempt > 0 {` logging guards and `if max_attempts > 1 {` display guards; restricting the operator removed all six at no cost to recall). PROXY FOR the stack-free condition: the number of attempts this operation gets cannot participate in any relationship — no enclosing deadline or reaper threshold can be derived from it (the `attempts x per_attempt + sum(backoff)` arithmetic that db/src/repos/resources/automations.rs:564-593 performs is only expressible because that budget is a NAMED per-row value), no test can assert it, no operator can tune it, and the next author writes a different literal nearby. MEASURED 2026-08-16 at d74fae3c9: 8 matches across 6 of 963 .rs files, PRECISION 8/8, every match opened. THE EIGHT: engine/src/eval.rs:480 (0..2u8, LLM eval); src/engine/kpi_binding.rs:480 (0..2u8, KPI CLI call); src/commands/companion/approvals/approval_exec_fleet.rs:737 (1..=2u32); src/commands/fleet/registry.rs:767 (1..=2u32); src/commands/design/build_sessions.rs:725 (1..=6u32) and :2640 (1..=20u32); src/test_automation.rs:160 (0..3u8) AND :163 (attempt < 2) — the same construct writing its budget TWICE, three lines apart, as two different literals that must agree while nothing checks that they do, which is the single clearest argument for this rule. THE COMPLIANT DESTINATION EXISTS AND IS THE IN-REPO MAJORITY (see the paired positive control, 13 matches / 7 files): PERSIST_MAX_RETRIES (engine/src/execution_engine/persist.rs:11, used 6 times), MAX_RETRIES (commands/credentials/query_debug.rs:174), MAX_PERSIST_ATTEMPTS (engine/oauth_refresh.rs, twice), FALLBACK_PORT_ATTEMPTS, max_attempts (automation_runner.rs:60, derived from the automation's own retry_count), max_tag_attempts. So this is a 40% minority deviation from a convention the repo already keeps, not a migration with no destination. TWO INDEPENDENT IMPLEMENTATIONS AGREE EXACTLY ON THE VIOLATING COUNT (8/6) and differ by ONE on the control: a walker with brace-matched #[cfg(test)] removal returns 12 rather than 13, the extra being db/src/repos/communication/events.rs:3139 inside the cfg(test) module opening at line 1821 — 12 + 1 = 13, reconciled; the census engine matches whole file content and cannot brace-match a cfg(test) range. DECLARED RECALL GAP, stated so the gate cannot manufacture confidence: this repository's PRINCIPAL retry mechanism is not a loop at all — src/engine/mod.rs:3915 spawn_delayed_retry sleeps and then calls exec_repo::create_retry to insert a NEW persona_executions row, so the 'iteration' is a database row and no loop-shaped signal can see it. Its budget happens to be named (healing::MAX_RETRY_COUNT) so it would be compliant regardless, but an adopting repo must know the shape exists. Also not covered: TypeScript (src/features/agents/sub_deployment/hooks/useCloudHealthMonitor.ts:121 is an UNBOUNDED retry whose Math.min bounds the step INDEX rather than the attempt — a separate rule, not proposed here because the TS population is 3 sites). BACKTRACKING: the only broad fill is `[^\\n&|]{0,60}`, one bounded negated character class, no nested quantifier, no same-span alternation; full 963-file run 0.58s. ZERO MATCH-POSITION OVERLAP, verified character-by-character against anonymous-deadline (its 2,843 positions vs these 225 — it gates the bound on ONE attempt, this gates how many attempts there are; together they are the two operands of timeout-tiering's P4), unraced-loop-wait, unkeyed-billable-spawn, unverified-effect-dispatch, silent-row-skip, hand-rolled-emptiness-refusal, untimed-repo-query and process-global-caches-a-failure. LEGAL FIX, one line each: hoist to a `const MAX_*_ATTEMPTS` in the same file with a one-line reason, the way persist.rs:11-13 does. Do NOT silence a match by moving the literal into a `let` immediately above the loop — that is the same defect one line higher; the value must be a named constant a sibling bound can reference. END OF LIFE: designed to reach zero; when it does, DELETE the rule rather than baselining it at 0. PRECONDITION (must be re-derived per repo): this repo spells a retry budget as a Rust range or comparison against an integer literal. A repo on a retry library (`p-retry({retries: 3})`, tenacity's `@retry(stop=stop_after_attempt(3))`, Polly) expresses the identical condition as an inline option-object field and scores a structural ZERO here while the condition is present at full scale."
  },
  "baseline": { "files": 6, "matches": 8 },
  "floor": 900
}
```

```json
{
  "id": "anonymous-retry-budget-positive-control",
  "goldenPath": "docs/concepts/golden-paths/retry-with-backoff.md",
  "title": "POSITIVE CONTROL — the same anchor pointed at the compliant form (a NAMED attempt budget)",
  "roots": ["src-tauri"],
  "extensions": [".rs"],
  "signal": {
    "pattern": "\\b(?:for\\s+(?:_?attempt|_?retry|_?tries|_?try_n)\\s+in\\s+[0-9][0-9_]*\\s*\\.\\.=?\\s*(?:[A-Z][A-Z0-9_]{2,}|[a-z_]*max[a-z_0-9]*)\\s*\\{|(?:while|if)\\s+(?:[A-Za-z_.()0-9]+\\s*[=!<>]=\\s*[^\\n&|]{0,60}&&\\s*)?(?:_?attempt|_?retry|_?tries|_?try_n)\\s*<=?\\s*(?:[A-Z][A-Z0-9_]{2,}|[a-z_]*max[a-z_0-9]*)\\s*(?:\\{|&&|=>))",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "CONTROL: the identical anchor with the budget operand pointed at a NAMED value — a SCREAMING_SNAKE constant or a `max_*` binding. Measured 13 matches / 7 files (an independent cfg(test)-stripping implementation returns 12; the difference is one match inside a test module, reconciled in the golden path's section 9). Proves the violating rule discriminates on the OPERAND rather than on the `attempt` vocabulary: 8 violating / 13 compliant partitions 21 raw anchor matches with no residual. If this control ever returns ~0 the anchor is doing the work and the violating rule means nothing."
  },
  "floor": 900
}
```

### A second instrument the census cannot host, specified rather than built

D2's condition — *a persisted attempt counter that is incremented and never
compared to a ceiling* — is a join between a schema column and the code that
writes it, and the census matches text in one file at a time. **~40 lines**:
enumerate every column matching `retry_count|fail_count|attempt|attempts` via
`sqlite_master` + `pragma_table_info`, grep for the increment site, and require a
comparison against a named ceiling in the same function body. **Assert the
instrument before the result**: it must discover ≥3 counters, must PASS
`persona_events.retry_count` (compared to `?1` inside the same `UPDATE` at
`events.rs:974`) and must FAIL `oauth_refresh_fail_count` (incremented at
`credential_ledger.rs:236`, compared to nothing anywhere), or exit non-zero as
broken. That is the same assert-the-instrument shape `check-csp-hosts.mjs` and
`check-corpus-integrity.mjs` already use, and run today it finds the P0 in §0.

## 10. Prefer a type over a gate — the answer for this leaf

### The candidate the reader reaches for first, and why it is wrong

**A `Retryable` marker trait, or a `RetryableError` newtype**, so only errors that
are safe to retry can enter a retry loop. Held against the seven:

- **Q1** — it encodes "this error class is transient" and nothing else. **It does
  not touch D1 (unbounded), D2 (no terminal state), D9 (no jitter), D10
  (anonymous budget) or D3 (the effect's idempotency).** Five of eight deviations
  untouched.
- **Q3 — decisive.** Every retryable decision in this repo is made by
  substring-matching a `String` (`automation_runner.rs:350-359`) or by a
  `FailureCategory` that already exists (`core/src/error_taxonomy.rs`). A new
  trait would have **2 implementors** on the day it shipped, and the categories it
  duplicates already have 10 arms.
- **Q7** — nobody was *forced* to omit `429`; the author wrote a list and left one
  out. Relaxing or tightening an error type is inert against a voluntary omission.

**Refused.** The error type is not where this leaf's decisions live.

### This leaf's answer: the policy is the value, and the loop is not

**There is no retry primitive in this repository — nineteen schedules, nineteen
hand-rolls (Gap 1).** The type answer is to make the *policy* a value that cannot
be constructed incompletely, and to make the only way to run a retry a function
that takes one:

```rust
// core/src/retry.rs — the four decisions as ONE value. No Default, no builder
// with optional fields, no public struct literal: the only constructors are the
// three named policies, so a retry cannot exist without all four answers.
pub struct RetryPolicy {
    max_attempts: NonZeroU32,          // P6 — a budget, not an option
    schedule: Schedule,                 // P1/P4 — base, cap, and jitter width
    retryable: fn(&AppError) -> bool,   // P2 — the set, as data
    exhausted: Exhausted,               // P5 — what a caller MUST do at the end
}

pub enum Exhausted { DeadLetter, CreateHealingIssue, Propagate }

impl RetryPolicy {
    pub fn transient_io() -> Self { … }        // 3 attempts, 200ms x2 cap 5s, full jitter
    pub fn remote_provider() -> Self { … }     // 5 attempts, 1s x2 cap 30s, honours Retry-After
    pub fn local_write() -> Self { … }         // 4 attempts, 200ms x2 cap 2s, dead-letters
}

/// The ONLY way to retry. Takes the policy first so it cannot be an afterthought,
/// and the remaining deadline so P9 is not optional.
pub async fn with_retry<T, F, Fut>(
    policy: &RetryPolicy,
    deadline: Instant,
    op: F,
) -> Result<T, Exhaustion<AppError>> { … }
```

Held against all seven qualifications:

| | verdict |
|---|---|
| **Q1 — carries only what it encodes** | **Passes, and it is the point.** `RetryPolicy` cannot encode "3 attempts" without also encoding the schedule, the set and the exhaustion outcome. The four decisions become one value, so the subsets that differ site-to-site today (§7's preamble) become unrepresentable. Contrast `successRateSource`, where the unit lived beside the tag |
| **Q2 — requiredness ≠ closedness** | **Passes.** `Exhausted` is a closed enum, not a callback you may forget to write; `NonZeroU32` closes "zero attempts"; `Schedule` closes "no cap". It closes rather than merely requiring |
| **Q3 — a type nobody constructs constrains nothing** | **The honest weakness, and it is survivable here.** 18 loops would migrate on day one, plus the 3 TS sites through a mirrored helper. But **`spawn_delayed_retry` would not** — its "loop" is a database row, and a policy value does not naturally fit a task that returns immediately. That is 1 of 19 and it is the most important one. Mitigation: pass the same `RetryPolicy` into `spawn_delayed_retry` and let it read `max_attempts` and `schedule.delay_for(n)` instead of taking a `delay_secs: u64` — the type reaches the *decision* even where it cannot reach the *loop* |
| **Q4 — a type anyone can construct authenticates nothing** | **Passes only if the fields stay private and there is no `RetryPolicy::custom(...)`.** The pressure to add one — from an 18-loop spread that runs from 100 ms to 24 h — is real and is exactly the pressure that produced [outbound-http-call](./outbound-http-call.md)'s 32 bypasses. **Design against it: `Schedule` may be freely parameterised; the *shape* (bounded, capped, jittered) may not.** That is Q6's line |
| **Q5 — withholding beats requiring** | **Passes.** The win is not "you must pass a policy"; it is that `with_retry` is the only thing in `core` that sleeps between attempts, so a hand-rolled loop is visibly a hand-rolled loop. Weaker than deleting a dependency (which is not available here — `tokio::time::sleep` cannot be withheld), which is why §9's ratchet stays until adoption is real |
| **Q6 — withhold the dangerous freedom, not the answer** | **Passes.** The dangerous freedom is *choosing the four decisions independently and silently defaulting three of them*. Callers keep every legitimate value — any base, any cap, any set, any of three exhaustion outcomes. What is withheld is answering only the one you happened to be thinking about |
| **Q7 — only helps where the requirement forced the bad value** | **Passes, and it rules out the alternative.** Nothing forced `useCloudHealthMonitor` to omit an attempt cap or `automation_runner` to omit `429`; those are voluntary omissions from a list. Widening or narrowing any existing signature is inert. **The construction that must be withheld is "a retry assembled from four independent decisions"**, and the only thing that reaches a voluntary omission is not offering the pieces separately |

**Seven for seven with one declared weakness at Q3, and the strongest external
warrant in the sweep is a cost measurement rather than an agreement.** `vibeman`
built **three** generic retry helpers (`retryStrategy.retryAsync`,
`cache-config.createSmartRetry`, `ErrorContext.executeWithRetry`) and its
highest-value call path — `src/lib/llm/base-client.ts`, the one that reads
`Retry-After` and is the best retry in that repo — **uses none of them**, alongside
21 hand-rolls. *A helper nobody is obliged to call constrains nothing.* So the
type must be the only door that sleeps, and §9's ratchet must hold the budget line
until it is.

**Where it does not reach** (per
[where types cannot reach](../golden-path-doctrine.md#where-types-cannot-reach)):

- **Into the exponent.** `1 << consecutive_failures` (D5) is arithmetic on a value
  that arrives from a `COUNT(*)` through a struct field. `Schedule::delay_for`
  would own that arithmetic and use `checked_shl` — which is a fix by
  *relocation*, not by the type.
- **Across the Rust/TS boundary.** D1 is in TypeScript; a Rust policy cannot see
  it. The mirrored helper is a separate, parallel edit, and nothing will keep the
  two schedules honest with each other.
- **Into the persisted ledger.** `oauth_refresh_fail_count` lives in a JSON blob
  in a SQLite column (D2). No parameter-level type reaches it; §9's second
  instrument is the reachable answer.

**Ship order:** §9's census rule (names the budgets — the precondition for
everything else) → D2's `needs_reauth` check and fail-count cap, and D1's attempt
cap, which are the two live unbounded retries and are six lines between them →
D4's `429` and D3's idempotency key → `RetryPolicy` + `with_retry`, migrating the
7 growing loops first because they already have the shape → D9's jitter, which the
policy makes a one-line default → D5, D6, D7, D8.

## 11. What this repo already does better than its siblings

Stated because a document that reports only defects mis-sets the reader's priors,
and three of these are fleet-leading:

- **`automations.rs:538-597` computes the P8 arithmetic per row, in SQL, and names
  the heuristic it rejected.** Replayed here against the retry loop it judges: the
  two agree to the millisecond. `ascent` reasons about the same hazard in prose
  from the other direction; **nobody else in six repositories does the arithmetic
  at all.**
- **`healing.rs:236-275`'s storm cap is the best terminal state in the fleet.** It
  exists specifically because the per-chain budget and the persona circuit breaker
  both structurally miss a cross-chain provider incident, it says so in the code,
  and it puts the reason in the user-facing copy. `brainiac` and `vibeman` have
  circuit breakers; neither has a cap that knows *why* the other two mechanisms
  cannot see this case.
- **The durable retry queue's claim discipline is right.** `drain_due_scheduled_retries`
  deletes before dispatching, re-reads the *current* `retry_count` rather than
  trusting what was persisted, chooses resume-vs-restart from a reason tag, and
  declines outright for work another subsystem owns. `personas-cloud`'s equivalent
  persists `retryCount` best-effort and does none of the other three.
- **The frontend's retryable set is better than the backend's.**
  `apiError.ts:43-61` includes `429`, `503`, `502`, `408`-adjacent phrasings and
  `deadline exceeded`, with a matching permanent list — the backend's one
  predicate omits `429`.
- **Three persisted retry counters against `vibeman`'s zero**, in a repo with a
  fifth of `vibeman`'s retry code.

## 12. Corrections to the brief

1. **"`automation_runner.rs:76-107` … its defect is narrow: the retryable set
   omits 429."** — **Confirmed, and the narrower defect is not the important one.**
   The same loop retries **on timeout**, for **any HTTP method** (POST is the
   fallback for anything unrecognised, `:527-530`), with **no idempotency key in
   the file** — the at-least-once webhook in §7 D3. The 429 omission costs a
   retry that should have happened; the timeout retry costs an effect that
   happened twice. Both are one-line fixes and the brief named the cheaper one.
2. **"One retry loop in the entire headless model-call surface."** — **Two, and
   the second is worse.** `src/engine/kpi_binding.rs:480` (`for attempt in
   0..2u8`, retrying `cli_text_with_usage`) **and** `engine/src/eval.rs:480`
   (`for attempt in 0..2u8`, retrying `run_llm_eval`, which spawns its own CLI at
   `:620`). The kpi one has **no delay between attempts at all**, and it records
   spend per attempt (`:485-500`), so a flake bills twice inside one second. The
   eval one waits 2 s and then falls back to a heuristic — a **degrade** rather
   than a failure, which is the better design of the two and the one to copy.
3. **"`reap_stale_runs` … may be the best-designed thing in this territory — check."**
   — **Confirmed, and now proven rather than admired.** Replaying
   `automation_runner.rs:89` for `retry_count ∈ 1..5` produces cumulative backoffs
   of `0 / 1000 / 3000 / 7000 / 15000` ms — **identical to the `CASE` in
   `automations.rs:583-589`**. The two are the same arithmetic in two languages
   and they agree exactly. The replay also found something admiration would not:
   the 30 s cap in the retry loop **never binds** inside the 1..5 clamp (it would
   first bind at attempt 6), so `MAX_BACKOFF_MS` is currently dead configuration
   that the SQL correctly does not model. And the brief's "one file from four
   unrelated hardcoded thresholds" understates it: **both the loop and the reaper
   have never run — `persona_automations` and `automation_runs` are empty.**
4. **"`oauth_refresh_backoff_until` … find out whether anything else persists one,
   or whether every other backoff dies with the process."** — **Three other things
   persist an attempt counter; none persists a delay; and the OAuth one is a P0.**
   Persisted counters: `persona_executions.retry_count` (98 non-zero),
   `team_assignment_steps.retry_count` (172 of 1,488),
   `persona_events.retry_count` (**0** of 4,972 — the DLQ has never fired).
   Persisted *schedules*: `scheduled_retries.retry_at` (0 rows now; 20 live
   usage-limit retries prove it works) and the OAuth ledger. **The finding the
   brief did not anticipate: the OAuth backoff has no attempt cap and no terminal
   state, its live `fail_count` is 49 and 21, its `backoff_until` is 67 and 90 days
   stale, and what actually stopped it is a 7-day staleness ceiling in a different
   subsystem while `needs_reauth: true` sat unread by the retry loop.** §0 and D2.
5. **"whether any retry is unbounded."** — **Two.** `useCloudHealthMonitor.ts:121`
   (the `Math.min` bounds the step *index*, not the attempt — 63 attempts in the
   first hour, forever) and the OAuth ledger. Both wear a bound that is not one.
6. **"jitter (present anywhere?)."** — **Zero, in both languages, across 19
   replayed schedules.** Every `rand` call site in `src-tauri` was checked by hand;
   all 30 are nonces, PKCE, OAuth state, genome mutation, trace ids or a radio
   shuffle. And the convergence oracle says this is a *weak* deviation, not a
   clear one: 4 of 5 siblings also have zero-jitter paths, `ascent` deliberately
   disables jitter on one path while mandating it on another **in the same repo,
   both with reasons**, and the fleet uses four different widths. §2(c) states it
   as a default with a named legitimate exception rather than as an absolute —
   which is not how I would have written it before the sweep.
7. **"whether a retry budget is ever coordinated with the caller's timeout."** —
   **Once, in the reverse direction, and the forward direction is absent — here
   and in four of five siblings.** `reap_stale_runs` derives the *outer bound from
   the retry plan*. **Zero retries in this codebase check the remaining deadline
   before sleeping.** `ascent/src/lib/scan.ts:367-379,:396` is the only place in
   six repositories that does the forward direction, and it does not do the
   reverse. **The two halves of P8 exist in two repos and neither repo has both.**
8. **A defect in my own first pass, recorded because the number was plausible.**
   My first retry-lineage query reported 98 retries with a p90 inter-attempt gap
   of 345,139 s (4 days), which reads as "the backoff is enormous". **30 of those
   98 are not retries**: `incident_continuation.rs:266` reuses `create_retry` for a
   *continuation*, and every one of those parents `completed` successfully. The
   corrected retry population is **68**, and every number in this document is
   reported split. A single overloaded column made a third of the population
   invisible to a query that looked correct — §7 D6.
