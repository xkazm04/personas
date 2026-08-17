# Golden path — Failure recovery strategy

> Situation node: `ai-agents/model-invocation/failure-recovery-strategy` ·
> [situation spine](../situation-spine.md) · recurrence 10 · risk **HIGH** ·
> sides **server** · `twoSided: true` · spine convergence **converged**
> (**refuted — see §12**) ·
> dimensions: **function · resilience · cost · ui** ·
> merged from *Provider failover*, *Healing strategy selection*.
> Composed 2026-08-16 against `master` @ `2a874e692`.
>
> **Sweep size.** All **963** non-generated `.rs` files under `src-tauri/`
> (agrees exactly with `rust.files` in [`shared-facts.json`](../shared-facts.json),
> reached by an independent walk and by the census runner) and all **4,828**
> `.ts`/`.tsx` under `src/`. `#[cfg(test)]` removed by a **brace-matched,
> string/comment-aware range** — never a line threshold; the first draft of the
> verification script used a threshold and misreported `engine/mod.rs:2903`
> (production, inside `evaluate_healing_and_retry`) as a test, because that file
> has a `#[cfg(test)]` at line 121. `core/src/error_taxonomy.rs` (820 lines),
> `core/src/healing.rs` (1,108), `engine/src/healing_orchestrator.rs`,
> `src/engine/failover.rs` (1,074), `src/engine/runner/mod.rs`'s failover block
> and finalizer, `engine/src/parser.rs`'s limit parsers, `src/lib/errorTaxonomy.ts`
> and `src/lib/errors/errorPipeline.ts` read in full.
>
> **Measured by executing, not reading.** Read-only **copies** of the operator's
> live `personas.db` (347 MB, 244 tables) and `personas_data.db` (17.5 MB) were
> queried; the live files were never opened for write. **`classify_error` was
> ported to JavaScript arm-for-arm and replayed against every one of the 260
> non-success executions** — that replay is what found the nanosecond-timestamp
> collision (§0.2) and the 40 misclassified ceiling timeouts (§0.1). Every
> recovery outcome was then joined back to `persona_healing_issues` (205 rows),
> `provider_audit_log` (4,001), `circuit_breaker_state` (0), `healing_knowledge`
> (0) and `scheduled_retries` (0). The §9 rule and its positive control were run
> against the real runner in a private scratch registry, fault-injected five
> ways, and re-extracted from this finished document and re-run.
>
> **`cargo` was not run** (the operator's app is running). Every Rust claim is
> static and traces to a file read during composition. **No secret value appears
> anywhere below.**
>
> **A convergence sweep** ran against `brainiac`, `personas-web`,
> `personas-cloud`, `vibeman` and `ascent`. **5 of 5 reachable, all opened.**
> `personas-web` is a **structural negative control** — zero model calls, no LLM
> SDK in `package.json`, no provider endpoint anywhere in `src/`. The oracle
> **refuted the spine's `converged` label in its positive form and confirmed it
> for one clause as a defect** (§6).
>
> ### Sibling boundaries, settled in prose
>
> [**retry-with-backoff**](./retry-with-backoff.md) owns *how many attempts and
> how long between them*. **This path owns whether a retry is the right answer at
> all** — which failure classes exist, which one a given failure is assigned to,
> and what each assignment triggers. That document's §0 table lists healing as the
> mechanism with all three retry numbers right; this one measures what the healing
> ladder is *fed*, and finds the classification upstream of it wrong for **40 of
> its 43 `Unknown` issues**. Its D6 (30 of 98 "retries" are continuations) is the
> mirror of this path's D2: both are one column carrying two meanings.
>
> [**terminal-state-and-recovery**](./terminal-state-and-recovery.md) owns *what a
> recovery pass writes* — `failed` vs `incomplete`, and whether readers can see
> it. **This path owns what happens BEFORE that write: which recovery was chosen.**
> Its headline (two reapers, two terminal states) has a twin here and §0.5 is the
> crossover: **19 of its 20 `incomplete` rows carry a healing issue that names a
> completely different cause** than the row's own `error_message`. Two subsystems
> recorded two accounts of one run, and neither retried it.
>
> [**headless-model-call**](./headless-model-call.md) owns *whether a call that
> nobody asked for is allowed to happen*. **This path owns what happens when it
> fails.** Its P10 — *"a headless call has no one to press retry; whatever recovery
> it gets, it must bring with it"* — is the clause this document supplies the other
> half of, and its §7.H warning (a fully-built failure taxonomy with zero live
> instances is not evidence) is the trap this path had to walk past: the taxonomy
> here has **11 classes and 5 live ones**, and one of the 5 is an artefact of a
> substring match.
>
> [**typed-error-contract**](./typed-error-contract.md) owns *whether a parser
> keeps the reason it failed*. Its census rule `model-reply-parser-without-a-reason`
> (34/22) counts `Option`-returning reply parsers. **This path owns the consumer
> side**: §0.6 is one such `Option` — `parse_usage_limit` — deciding between
> "retry when the provider's window resets" and "give up permanently", on a
> vocabulary that differs by one phrase from the predicate three lines above it.
>
> The **Deviations** section is a fix backlog. It contains **four live P0/P1
> defects**, three of which have one-line fixes.

---

## 0. The headline: the recovery a failure gets is chosen by which subsystem noticed it, not by what failed

**Eleven failure classes are declared. Five have ever occurred. One of those five
is a substring accident. And the class that produced the most healing issues in
this installation is `Unknown` — 93% of which is a timeout the app printed
itself.**

Replaying `core/src/error_taxonomy.rs::classify_error` arm-for-arm against all
**260** non-success executions in the operator's database:

| class | live rows | `is_auto_fixable` | `is_failover_eligible` | what actually happened next |
|---|---:|---|---|---|
| `TransientProcessFailure` | **172 (66%)** | ✅ | ❌ | 30 retries spawned · **5 completed (16.7%)** |
| `Unknown` | **53 (20%)** | ❌ | ❌ | `CreateIssue`, `suggested_fix: None` · **0 retries** |
| `RateLimit` | 21 | ✅ | ✅ | 20 durable `RetryAt` · 10 completed (50%) |
| `Timeout` | 13 | ✅ | ✅ | 11 `RetryWithTimeout` · **8 completed (72.7%)** |
| `ApiError` | **1** | ❌ | ❌ | nothing — and the 1 is an artefact (§0.2) |
| `SessionLimit` · `ProviderNotFound` · `CredentialError` · `Network` · `Validation` · `ToolError` | **0** | — | — | never observed |

Six classes have never fired. `Network` — the textbook retryable failure — is in
neither retry set and its `diagnose` arm is `CreateIssue` (`healing.rs:438-449`):
**a network failure in this app gets no retry at all.**

### 0.1 — The largest single failure in the fleet is a timeout its own classifier cannot see

`src/engine/mod.rs:414-417` mints this string when the engine's hard ceiling fires:

```rust
error: Some(format!(
    "Engine safety ceiling exceeded ({}m). Execution forcibly terminated.",
    ENGINE_MAX_EXECUTION_SECS / 60,
)),
```

`classify_error`'s `Timeout` arm (`error_taxonomy.rs:170-176`) matches
`timed out | timeout | deadline | etimedout`. **"ceiling exceeded" matches none of
them.** The message falls through nine arms to `Unknown`, and `diagnose`'s
`Unknown` arm is `CreateIssue` with `severity: "medium"` and
`suggested_fix: None` (`healing.rs:573-584`).

**Live: 40 of the 43 `Unknown` healing issues (93%) carry exactly that string.**
The other 3 are `Execution failed (exit code N): `. There is nothing else in the
`Unknown` bucket at all.

And the arithmetic closes on itself. `healing.rs:122`:

```rust
const MAX_TIMEOUT_MS: u64 = crate::limits::ENGINE_MAX_EXECUTION_SECS * 1000;
```

The `Timeout` recovery is `RetryWithTimeout { new_timeout_ms: min(current × 2,
MAX_TIMEOUT_MS) }`. **So the recovery for a timeout escalates the run's timeout
up to exactly the ceiling whose message the classifier then cannot recognise as a
timeout.** A run that is retried twice arrives at 20 minutes, hits the ceiling,
and its third failure is diagnosed `Unknown` — the recovery ladder walks a run
into the one class that has no recovery.

The cost of getting this right is measurable, because the correctly-classified
half of the same physical failure is the **best** recovery in the installation:

| the same failure, differently worded | class | retries | completed | rate |
|---|---|---:|---:|---|
| `Execution timed out after {300,600,900}s` (runner) | `Timeout` | 11 | 8 | **72.7%** |
| `Engine safety ceiling exceeded (20m).` (engine) | `Unknown` | **0** | — | — |

**Fix:** one token. Add `|| lower.contains("ceiling exceeded")` to the `Timeout`
arm, or — better, and it is the §2 prescription — have the ceiling handler
construct a categorised failure instead of a sentence.

### 0.2 — The one `ApiError` in 2,188 executions is a nanosecond field

```
Execution stalled: running since 2026-06-13T02:10:42.946341500+00:00 (>30 min) — marked as zombie
```

`classify_error` tests nine HTTP status codes as **bare substrings of free text**
(`error_taxonomy.rs:156, 185, 201, 202, 243-246, 269`):
`429 · 404 · 401 · 403 · 500 · 502 · 503 · 529 · 413`.

The fractional-seconds field of that timestamp is `946341500`. It contains
`500`. The row is classified `ApiError` — the class whose recovery is a durable
escalating `RetryAt` that **resumes the CLI session** — for a run that was
declared dead by a zombie sweep.

Live incidence today is **1 of the 20 messages that embed a timestamp** — small,
and reported as small. But it is not a fluke of one message: nanosecond-precision
timestamps are 9 digits, and this repo persists them inside error text at 20 of
its 260 failure rows. The structural statement is the finding: **a status-code
match is a numeric test performed on prose, and prose in this repo contains
numbers that are not status codes.**

`src/lib/errorTaxonomy.ts:88-254` mirrors all nine, and
`src/lib/errors/__tests__/errorTaxonomy.parity.test.ts` **pins the two ladders
together**, so neither side can be narrowed alone — a fact the TS file writes
down at `:112-121` about a different arm of the same problem:

> *"this intentionally mirrors the Rust ladder byte-for-byte — including the broad
> `'not found'` substring match, which also catches ordinary domain 404s ("persona
> not found", "credential not found") and over-escalates them to
> `critical`/failover-eligible."*

**The repo already knows two of its classes are conflated and has written down
why it cannot fix one of them in isolation.**

### 0.3 — Every non-zero exit in this installation is a "transient process failure", and that retry is the worst one

The `TransientProcessFailure` arm (`error_taxonomy.rs:274-292`) fires when
`Execution failed (exit code N): <stderr>` has a stderr suffix that is empty or
≤16 characters. Its comment states the assumption the whole discriminator rests
on:

> *"Real errors (auth, network, rate-limit, validation) emit informative stderr
> that gets classified by the earlier matchers above."*

**Measured across all 98 exit-code failures in the database: the stderr suffix is
empty in 98 of 98.** Not short — empty. The runner does pipe and await stderr
(`runner/mod.rs:2612`); the Claude CLI in `stream-json` mode simply reports its
errors on stdout. **The branch that assumption describes has been taken zero
times in 2,188 executions.**

So `TransientProcessFailure` is not a narrow class — it is the destination of
every non-zero exit, 66% of all failures, and its recovery is the least effective
one measured:

| recovery class | retries spawned | completed | success | spend on retries |
|---|---:|---:|---:|---:|
| `Timeout` → `RetryWithTimeout` | 11 | 8 | **72.7%** | $7.91 |
| usage limit → durable `RetryAt` | 20 | 10 | 50.0% | $20.77 |
| `TransientProcessFailure` → `RetryWithBackoff` | **30** | 5 | **16.7%** | $4.34 |

**The most-used recovery is the least likely to work, and it is used most
because it is the fallthrough.** 117 of the 205 healing issues are "Transient
process failure"; 10 were auto-fixed (8.5%).

### 0.4 — Provider failover has never happened, and structurally cannot happen for the failures it was built for

`provider_audit_log`: **4,001 rows, `was_failover = 0` on every single one**
(`model_used` is also NULL on all 4,001 — the BYOM compliance trail cannot say
which model ran).

That is not bad luck. `src/engine/runner/mod.rs:1675-1679`:

```rust
match CliProcessDriver::spawn(&cli_args, exec_dir.clone()) {
    Ok(driver) => {
        // Spawn succeeded -- use this provider
        break 'failover driver;
    }
```

**The failover loop exits on the first successful *spawn*.** The chain is walked
only when `CliProcessDriver::spawn()` returns `Err` — an OS process-creation
failure. Meanwhile `is_failover_eligible` (`error_taxonomy.rs:363-371`) names
`ProviderNotFound | RateLimit | SessionLimit | Timeout`, and **all four are
observable only after a successful spawn**, in the finalizer at
`runner/mod.rs:2857-2878`, which records a breaker failure and returns:

```rust
if let Some(ref err) = error {
    if failover::classify_error(err).is_some() {
        let transitions = circuit_breaker.record_failure(active_engine_kind);
```

No `continue`, no next candidate. The candidate list is dead by then — the loop
it belongs to exited hundreds of lines earlier.

The consequence lands on the model ladder. `CLAUDE_MODEL_CHAIN`
(`failover.rs:639-643`) is `opus-4-8 → sonnet-4-6 → haiku-4-5`, and its doc
comment records a real incident that produced it (*"both retired 2026-06-15 and
now returning 404 — so a healthy opus-4-8 persona whose primary hiccuped was
actively failed over into a guaranteed 404"*). **That ladder is reachable only at
the one moment when changing the model cannot possibly help** — a failure to
create a process. The `alternates` list is `vec![]` (`:725`), so the chain is
Claude-only, and the file says so honestly at `:652-662` (*"a breaker-gated
single-candidate probe… not a bug"*). What the file does not say is that even the
within-provider rungs are unreachable for every failure class the breaker
classifies.

**Two eligibility rules for one breaker, at two sites.** The spawn-error site
(`:1691`) calls `record_failure` unconditionally — every spawn failure counts.
The finalizer (`:2859`) counts only the 4 failover-eligible classes. So
`TransientProcessFailure` — 66% of live failures — never reaches the provider
breaker at all.

### 0.5 — One run, two subsystems, two different recorded causes, no retry

19 of the 20 `incomplete` executions carry a healing issue, and **every one of
those issues says something the execution row does not**:

| what the row's `error_message` says | what the healing issue's description says |
|---|---|
| `Execution stalled: running since 2026-06-16T08:10:04… (>30 min) — marked as zombie` | `Execution failed with an unrecognised error. Error: Engine safety ceiling exceeded (20m). Execution forcibly terminated.` |

Timestamps confirm the order: `sweep_zombie_executions` terminalises at 30 minutes
and writes `incomplete`; the engine ceiling fires later; `handle_execution_result`
runs the recovery decision on the *real* error (the ceiling), files an `Unknown`
issue — and the runner's own guarded status write is then refused because the row
is no longer `running`. **Two recovery subsystems produced two accounts of the
same execution, they disagree about the cause, and neither retried it.** This is
[terminal-state-and-recovery](./terminal-state-and-recovery.md)'s two-reapers
finding seen from the recovery side.

### 0.6 — An `Option` decides between "retry in five hours" and "give up forever"

`engine/src/parser.rs` holds two predicates over the same concept, three lines
apart, with **different vocabularies**:

```rust
pub fn is_session_limit_error(stderr: &str) -> bool {            // :764
    lower.contains("session limit")
        || lower.contains("usage limit")
        || lower.contains("quota exceeded")                       // :768
}

pub fn parse_usage_limit(text: &str) -> Option<UsageLimitInfo> {  // :780
    let mentions_limit = lower.contains("usage limit")
        || lower.contains("weekly limit")
        || lower.contains("hour limit")
        || lower.contains("session limit");                       // :787
    if !mentions_limit { return None; }
```

**`quota exceeded` is in the first and not the second.** Trace a provider whose
message says only "quota exceeded":

1. `parse_usage_limit` → `None` (`runner/mod.rs:2770`)
2. `is_session_limit_error` → `true`, so the error becomes `"Session limit reached"` (`:2791`)
3. `session_limit_reached = true` (`:2851`) → `classify_error` returns `SessionLimit`
4. `healing_orchestrator::evaluate` step 3.5 (`:209`) is **skipped**, because it
   keys on `ctx.usage_limit` — which is the `None` from step 1
5. step 4: `is_auto_fixable(SessionLimit)` is **false** → **`CreateIssue`, no retry, ever**

The same physical failure, phrased the way `parse_usage_limit` recognises, gets
`RetryAt { retry_at: reset + 120s }` — durable, restart-surviving, and measured
live at **50% success across 20 retries**. The difference between a five-hour
durable retry and a permanent give-up is one phrase in one of two hand-written
word lists.

### 0.7 — Two circuit breakers, zero trips; three counters, one has no data

| mechanism | designed | live |
|---|---|---|
| provider circuit breaker (`CIRCUIT_BREAKER_THRESHOLD = 5`, `failover.rs:39`) | open/half-open/closed + persistence | **`circuit_breaker_state`: 0 rows** |
| persona circuit breaker (`healing_orchestrator.rs:198`) | disables the persona | **`is_circuit_breaker = 0` on all 205 healing issues** |
| per-chain budget (`MAX_RETRY_COUNT = 3`) | escalate to `CreateIssue` | **max observed `retry_count` = 2**; the escalation has never fired |
| KB fleet-wide escalation (`KB_ESCALATION_THRESHOLD = 5`) | skip retries, jump to `CreateIssue` | **`healing_knowledge`: 0 rows** — never consulted |
| durable retry queue | `scheduled_retries` | 0 rows now; the 20 usage-limit retries prove it has run |

`healing.rs`'s module doc opens with *"Three counters, three scopes"* and a
decision table built on all three. **One of the three has no data source at all**,
so the KB delay override and the preemptive escalation are unexercised branches,
and the third column of the canonical decision table has never been evaluated.

### 0.8 — Half of all failures never reach the recovery decision

`evaluate_healing_and_retry` is called from **exactly one site** —
`engine/mod.rs:2518`, inside `handle_execution_result`, behind `if !result.success`.
Anything that terminalises a row by another route skips recovery entirely.

**Live: 130 of 258 failed/incomplete executions (50.4%) produced no healing issue
at all.**

| shape | rows | issue? |
|---|---:|---|
| `App restarted while execution was running` (boot recovery) | **74** | **none** |
| `Execution failed (exit code N): ` | 28 of 98 | none |
| `Internal error (panic): state() called before manage()…` | **20** | **none** |
| `Engine safety ceiling exceeded (20m).` | 6 of 12 | none |

The 20 panics are the sharpest case: a Rust panic is the most severe failure the
app can produce, it classifies as `Unknown`, and it reached the recovery engine
zero times.

### 0.9 — The typed answer exists on both sides of the IPC boundary and is used on neither

`core/src/error.rs:213-214` puts the answer on the wire for **every** IPC error:

```rust
s.serialize_field("auto_fixable", &is_auto_fixable(&category))?;
s.serialize_field("failover_eligible", &is_failover_eligible(&category))?;
```

`src/lib/types/tauriError.ts:52` declares `failover_eligible?: boolean`.
`src/lib/errorTaxonomy.ts:74` exports `classifyKind(kind)` — the typed
`TauriErrorKind → ErrorCategory` map.

- **`classifyKind` has zero production call sites in 4,828 frontend files.**
- **`ClassifiedError.failoverEligible` is computed at `errorPipeline.ts:124` and
  read nowhere.** So is `.autoFixable`.
- `errorPipeline.ts:100` re-derives the category from the raw **string** —
  `classifyError(raw)` — for the field the backend already shipped.

The client re-runs a word-list ladder over prose to recover a value that arrived
as a field. And what it renders is neither: `ErrorExplanationCard.tsx:46-53` uses
`classified.explanation` (a **fourth** pattern list) and drops
`classified.category` entirely. **The user is never shown which failure class
occurred, and never told whether a retry is coming.**

### 0.10 — Eight private failure classifiers

`error_taxonomy.rs:4-5` calls itself *"the single source of truth for error
classification. All subsystems import from here instead of maintaining
independent heuristics."* Measured: **14 files / 27 production sites re-decide a
recovery-bearing failure class by substring, against 9 files / 13 sites that ask
the shared taxonomy** (§9).

| classifier | classes | recovery vocabulary |
|---|---|---|
| `core/src/error_taxonomy.rs:141` `classify_error` | 11 | the healing action table |
| `core/src/healthcheck_ledger.rs:50` | 2 (`Transient` / `Permanent`) | **tries `from_status_code(code)` FIRST** — the exemplar |
| `engine/src/tool_outcome.rs:145` `classify_message` | `ToolErrorKind` + `Option<u16>` + a **retryable bool** | tool retry |
| `src/engine/tool_runner.rs:1205` `classify_api_error` | status re-parsed out of `"Curl exited with …"` | `(status_str, Option<u16>)` |
| `src/commands/fleet/stale.rs:924` `screen_shows_limit_error` | limit / not-limit, **by scraping a terminal screen** | a 4-minute retry interval |
| `src/companion/session.rs:520` | 6 turn-failure reasons | telemetry labels |
| `src/commands/credentials/query_debug.rs:144` | 6 DB-error advices | user copy |
| `src/commands/credentials/auto_cred_browser.rs:1176` | 5 setup-failure classes | retryable flag + user copy |

Plus, on the client: `errorTaxonomy.classifyError` (the mirror),
`errorRegistry` (65 patterns), `errorExplanation`, and
`useTranslatedError.ERROR_KEY_MAP` (68 entries). **Four independent word lists
decide what a failure is on the way to one card.**

`stale.rs:922-923` is the one place the cost of a private vocabulary is written
down, and it is worth quoting because it is this whole document in two lines:

> *"…the first signature guess missed it and 8 of 16 sessions sat invisible."*

---

## Principle (stack-free head)

Per the [portability test](../research/portability-test.md), the head is
physically separated and each clause carries its warrant, so an adopting repo can
tell physics from local calibration. No file path, primitive name or count
appears below this line until the head ends.

> **P1 — physics, and it is the whole subject.** *Recovery is a function of the
> failure class, so the class is the artifact you must build first.* Retry,
> fall back, degrade, escalate and give up are five different answers, and which
> one is correct depends entirely on what went wrong. A system that cannot name
> its failures cannot choose between them; it will pick one answer and apply it
> to everything, and the answer it picks will be whichever the fallthrough branch
> happens to hold.
>
> **P2 — physics, and the most-replicated clause in the oracle.** *Classify from
> a structured field, never from a formatted message.* The status code, the error
> `type`, the exit code, the typed variant — read it before any string exists.
> The moment a failure is rendered into prose the class becomes a guess about
> wording, and the guess is made by a word list written by someone who had not
> seen the message.
>
> **P3 — physics, and the sharpest defect in this family.** *A failure your own
> code mints must carry its class by construction.* Foreign text — a vendor's
> stderr, a remote body — has to be classified, and a word list is the honest
> tool for it. But a message your own system formats already knows what it is,
> and routing it back through the classifier converts a certainty into a guess.
> The failure mode is silent and specific: your own message falls into the
> unknown bucket, and the recovery built for that class never runs.
>
> **P4 — physics.** *Two predicates over the same concept will diverge, and the
> divergence is invisible.* Wherever the same question ("is this a rate limit?")
> is answered by two hand-written lists, they will differ by a phrase within a
> year, and nothing will fail. State the question once, in one place, and let
> everything else call it.
>
> **P5 — physics.** *A recovery-eligibility predicate spelled as a subset of the
> failure classes silently defaults every future class to "no recovery".* The
> subset is written when the enum has N members; the enum grows; the predicate
> does not. Derive eligibility from the class, as data on the class, so adding a
> class forces the decision instead of defaulting it.
>
> **P6 — physics.** *Falling back to a different model or provider is only a
> recovery if it fires on the failure it was built for.* A fallback chain walked
> only on connection failure cannot fix a rate limit, an overload, or a bad
> reply — the failures a different model would actually survive. Check which
> failure *reaches* the chain, not which failures the chain lists.
>
> **P7 — physics.** *The fallback's own failure is a different event from the
> primary's and needs its own answer.* Treating step 3 exactly like step 1 means
> the system spends N times the money to learn the same thing once, and reports
> the last error as though it were the only one.
>
> **P8 — ergonomics, and it is the cheapest thing in this document.** *Degrading
> is a legitimate recovery, and a degrade that is not recorded is a lie.*
> Returning a reduced, cached, heuristic or empty result instead of failing is
> often the right answer — and the caller must be able to tell that it happened,
> or a degraded result will be cached, published and trusted as a real one.
>
> **P9 — ergonomics.** *A recovery mechanism that has never been observed to run
> is a claim, not a guarantee.* Breakers, budgets, escalation thresholds and
> dead-letter paths all pass code review by construction. Count the times each
> has fired against real data; a mechanism at zero is untested, and one whose
> input table is empty is unreachable.
>
> **P10 — ergonomics, and it is the half everybody skips.** *The user must be
> able to tell "we are retrying" from "we gave up".* Those are opposite facts
> about what they should do next, and a UI that renders both as "failed" has
> discarded the entire taxonomy at the last inch.
>
> **Scale condition.** P1, P2 and P3 are wrong on the first failure. P4 and P5
> pay the second time someone edits the taxonomy. P6 and P7 bite the first time a
> provider has a bad hour. P8 pays the first time a degraded result is cached.
> P9 pays at the first real incident — which is exactly when you discover the
> mechanism was unreachable. P10 pays continuously and is measured in support
> load, which is why nobody attributes it.

### Warrant evidence — five siblings, censused independently

`brainiac` (Rust, 8 crates), `personas-cloud` (TS monorepo), `vibeman` (Next.js),
`ascent` (Next.js), `personas-web` (**structural negative control — zero model
calls**: no LLM SDK in `package.json`, no provider endpoint in `src/`, so every
answer below is an absence *by construction*, not an omission).

| clause | verdict | evidence |
|---|---|---|
| **P1** — a named failure taxonomy drives recovery | **WEAK (3 of 4 that call models)** | `vibeman` has **three mutually-unaware** ones (`errorClassifier.ts:9-18` 8 members; `retryStrategy.ts:54-107` 8, **zero importers**; `selfHealing/types.ts:9-18` 9). `brainiac` has no enum but a 3-branch structural predicate mapping to 4 outcomes. `ascent`'s LLM path has **none** — `scan.ts:404-410` is `catch (err) { lastErr = err; }` and a 401, a 429, a malformed reply and `"GEMINI_API_KEY is not set."` take the identical branch. `personas-cloud` has **no failure taxonomy at all**: a non-zero exit code is the whole of it (`executor.ts:271`). |
| **P2** — classify from structure, not prose | **PHYSICS — but as a DEFECT (1 of 4 does it right), and the defect is independently reinvented** | `brainiac/crates/brainiac-gateway/src/resilience.rs:209-222` reads `status.is_success()` / `status.as_u16() == 429` / `status.is_server_error()` **before any string is formed**, and has **zero `.contains()` on an error message outside `#[cfg(test)]`**. `vibeman` is the negative: **91 substring predicates vs 18 structured**, and it round-trips the status through prose three times — `openai-client.ts:151-153` formats `` `OpenAI API error (${response.status})` ``, `base-client.ts:113-145` re-derives it with 21 substring tests, `errorClassifier.ts:56-164` re-parses *that*. `ascent` reads `res.status` at exactly two sites (`llm/openai.ts:65-67`, `openrouter.ts:66-68`) and **immediately throws it away into a template string nothing downstream parses.** Personas is the third instance. |
| **P3** — a self-minted message falls through its own classifier | **PHYSICS as a defect, 2 of 4, reinvented with no shared code — and in both the consequence is that the recovery for that class is disabled** | `vibeman/src/lib/llm/base-client.ts:137-142` mints `'Bad Gateway - the API server is temporarily unavailable'` (502) and `'Service unavailable - the API is temporarily down'` (503); neither matches any pattern in its own `errorClassifier.ts:56-164`, so both return `UNKNOWN, isTransient: false` → `circuitBreaker.ts:173-179` logs *"permanent failure (circuit not tripped)"*. **A sustained 502 storm can never open vibeman's breaker.** Personas: `Engine safety ceiling exceeded (20m)` → `Unknown` → no retry, 40 of 43 `Unknown` issues (§0.1). Two codebases, two languages, no contact, the same shape and the same consequence. **This is the strongest oracle result in the sweep.** `ascent` has the vacuous version: it retries `"GEMINI_API_KEY is not set."` (`llm/gemini.ts:36`) once against the same provider, because it classifies nothing. |
| **P4** — one question, one predicate | **SILENCE as a stated principle, 4 of 4; visible as a defect in 3** | Nobody writes it down. `vibeman` has five classifiers over one concept, one of them dead, and its API route re-attaches the status before classifying (`api/llm/generate/route.ts:72-74`) while its breaker does not (`llm-manager.ts:149`) — **the same failure gets two different classifications inside one repo**. Personas' version is §0.6. |
| **P5** — eligibility derived, not spelled | **SILENCE, 4 of 4** | Every repo hand-spells its retryable/transient set at each decision site. Personas spells three disagreeing subsets of one enum (§0 table). Report as silence; the hazard is universal and unsolved. |
| **P6** — the fallback fires on the failure it was built for | **PHYSICS (2 of 2 that have a fallback) — and Personas is the outlier** | `vibeman/src/lib/llm/llm-manager.ts:137-169` walks a 5-provider chain on a **response** failure (both a thrown error and a returned `{success:false}`). `ascent/src/lib/scan.ts:385-411` runs `[primary, primary, fallback]` on a response failure *and* on an unusable-but-parsed reply. **Both fire where it matters. Personas' fires only on `spawn()` returning `Err` (§0.4), and has fired 0 times in 4,001 audited runs.** |
| **P7** — the fallback's failure is its own event | **SILENCE, 0 of 2** | `vibeman` collapses everything into `All LLM providers failed (tried: …)` (`llm-manager.ts:175`) — a string that then matches none of its own 33 self-healing regexes (`selfHealing/errorClassifier.ts:20-102`), so the terminal message of the whole recovery chain is itself unclassifiable. `ascent`'s catch is byte-identical for all three steps. Nobody does this. **Reported as silence — P7 is a proposal, not observed practice.** |
| **P8** — degrade, and record that you degraded | **PHYSICS (3 of 4), and `ascent` is the exemplar** | `ascent/src/lib/scan.ts:416-431` degrades to a deterministic mock and sets `llmFailed`, then `scan-finalize.ts:103,131` computes `degradedToMock` and **refuses to cache or persist the degraded scan as authoritative**. `brainiac/crates/brainiac-pipeline/src/extract.rs:769-773` makes "every pass empty" an explicit success (*"a genuinely contentless chunk must resolve cleanly, never fail the job and clog the queue"*). Personas has one (`engine/src/eval.rs:479-503`) and it records itself via `EvalMethod::{HeuristicFallback, Timeout}`. `vibeman` has none — exhaustion returns a failure object. |
| **P9** — a mechanism nobody has seen fire | **PHYSICS as a defect, and only `brainiac` clears it** | `brainiac`'s breaker has **10 tests, 5 end-to-end against a wiremock upstream**, including `half_open_admits_exactly_one_probe`, `a_failed_probe_reopens_without_waiting_for_threshold` and `send_opens_the_breaker_then_fails_fast_without_touching_upstream` (asserting the fail-fast call never reached the wire). `vibeman`'s breaker has **zero tests** and in-memory-only state. `personas-cloud` has no breaker (`grep -ni circuit` → 0 hits). `ascent` has none. Personas has two and **zero observed trips**. |
| **P10** — the user sees the class | **RARE (1 of 4), and `vibeman` is the only one** | `vibeman/src/app/api/llm/generate/route.ts:76-89` returns `{ userMessage, recoveryActions, isTransient, retryDelay, errorType }`, with 8 class-specific strings (`errorClassifier.ts:66-160`) rendered with class-specific buttons (`components/errors/ErrorBoundary.tsx:43-68`). `ascent` collapses every LLM failure into one sentence. `personas-cloud` into `'Compilation execution ' + exec.status`. `brainiac` shows nothing (the artifact is a page that does not refresh). Personas: §0.9. |

> **The single strongest result is `brainiac`, and it is positive twice.** It is
> the only repo in six that reads the status before the string exists, and the
> only one whose breaker has been observed to trip. It also supplies the clause
> nobody else wrote down — `resilience.rs:8-9`, *"Other 4xx are permanent (bad
> key, bad request) and fail immediately"* — and then **pins it with a test**
> (`:412 send_does_not_retry_a_permanent_4xx`, asserting `hits.len() == 1`).
> The complement of the retryable set is a sentence AND an assertion.
>
> **The second strongest is `vibeman`, and it is negative.** It has the richest
> failure taxonomy and the best user-facing mapping in the family, built on top of
> a classification pipeline that formats the answer into prose and re-parses it
> three times — and the two most common transient gateway failures fall out of it
> as permanent. **A rich taxonomy over a lossy classifier is worse than a poor
> taxonomy over a faithful one**, because it looks like it works.

---

## 1. Trigger

You are in this situation when you are about to type or say:

- "what should happen when the model call fails?" · "just retry it and see"
- "if Claude is down, use a smaller model" · "fall back to sonnet"
- "we should degrade instead of erroring" · "show the cached one"
- "is this error retryable?" · "is this transient or permanent?"
- "the user keeps seeing 'execution failed' and doesn't know why"
- "add a new error category" · "why did this get classified as unknown?"
- **If you are about to write `err.contains("…")`, `error.includes('429')`,
  `classify*(msg: &str)`, `matches!(category, X | Y)`, `isRetryable`,
  `is_transient`, a `RETRYABLE_STATUS` set, a fallback chain, or a
  `format!("… failed: {e}")` that another layer will read back — you are in this
  situation.**
- If you are about to add a variant to a failure enum, you are in this situation
  **and §2(d) is not optional**, because every hand-spelled eligibility subset in
  the tree will silently exclude your new variant.

**Not this path:** *how many attempts and how long between them* is
[retry-with-backoff](./retry-with-backoff.md); *which terminal status a recovery
pass writes and whether readers can see it* is
[terminal-state-and-recovery](./terminal-state-and-recovery.md); *whether a call
that nobody asked for should happen at all* is
[headless-model-call](./headless-model-call.md); *whether a parser keeps the
reason it failed* is [typed-error-contract](./typed-error-contract.md); *the user
pressing Stop* is [cancelling-in-flight-work](./cancelling-in-flight-work.md).

## 2. The one way

**Decide recovery from a failure class the failing code assigned, not from words
in a message someone formatted — and make every recovery a property of the class,
so a new class cannot default to silence.** Concretely: (a) **name the classes in
one closed type** and give that type the recovery decision as data on it
(`retryable`, `failover_eligible`, `degradable`, `user_message`), not as three
hand-spelled `matches!` subsets in three files. (b) **Read the structured
discriminator before any string exists** — `status.as_u16()`, the error `type`
field, the exit code, the typed variant — and classify from that; a word list is
for *foreign* text only, and you must say in a comment which text is foreign.
(c) **Every failure this codebase mints carries its class by construction.** The
handler that kills a run at a ceiling knows it is a timeout; the sweep that
abandons a row knows it is a lost run; the spawner that got `ENOENT` knows the
provider is missing. Constructing a bare sentence there and re-classifying it
downstream converts a certainty into a guess, and the guess loses — **40 of this
repo's 43 `Unknown` diagnoses are one such sentence.** (d) **Derive every
eligibility predicate from the type**, with an exhaustive `match` (no `_ =>`) so
adding a class is a compile error rather than a silent "no recovery"; a
`matches!(c, A | B)` compiles forever and excludes everything you add later.
(e) **State the complement out loud, in one sentence, and pin it with a test** —
*which* failures you decline to recover and why (`brainiac/resilience.rs:8-9`
plus `:412` is the model: a sentence AND an assertion). (f) **If you have a
fallback, check which failures reach it.** A chain walked only on connection
failure is not provider failover; and give the fallback's own failure a distinct
outcome, because "the backup also failed" is a different fact from "the primary
failed". (g) **Degrade deliberately and record it** — a reduced/heuristic/cached
result must carry a field saying so, and downstream must refuse to cache or
publish it as authoritative. (h) **Make the class visible to the user**: what
happened, whether a retry is coming, and what they can do. Then stop: do not add
a second classifier, do not widen a word list to fix a misclassification whose
real cause is that the class was known upstream, and **do not raise a retry
budget for a class whose retries are not working** — measure the class's success
rate first (here it ranges from 72.7% to 16.7%, and the 16.7% class gets the most
retries).

If you must get one right first: **(c)**. (a), (b) and (d) are structure and pay
off over months; (e), (f) and (h) fail visibly the first time someone looks.
**(c) fails silently and permanently — your own system's most severe failure lands
in the bucket that has no recovery, and the only symptom is a healing issue with
`suggested_fix: None`.**

## 3. Mandated primitives

**Exist today — use them:**

| primitive | what it gives you |
| --- | --- |
| `core/src/error_taxonomy.rs:25` `ErrorCategory` | **the closed set of 11 failure classes, and the one place allowed to own the vocabulary.** Its module doc states the contract (*"the single source of truth… All subsystems import from here instead of maintaining independent heuristics"*) and names the TS mirror. Use it; do not write a ninth private classifier (§0.10) |
| `core/src/healthcheck_ledger.rs:36-55` | **the one site to copy for §2(b).** It calls `from_status_code(code)` **first** and only falls back to the message ladder when no status is available. That ordering is the whole of P2, in 20 lines, in this repo, today |
| `engine/src/tool_outcome.rs:145` `classify_message` → `(ToolErrorKind, Option<u16>, bool)` | the only classifier here that returns a **retryability verdict alongside the class**, so the caller cannot re-decide it. The shape to generalise (its `.contains` ladder is the part not to copy) |
| `core/src/healing.rs:294` `diagnose` + `:66` `HealingAction` | the class → action table: `RetryWithBackoff`, `RetryWithTimeout`, `RetryAt`, `AiHealing`, `CreateIssue`. Five outcomes, one `match`, exhaustive over the enum — **this is §2(d) done correctly**, and it is the only exhaustive one in the tree |
| `engine/src/healing_orchestrator.rs:182` `evaluate` | the pure decision tree with documented precedence (breaker → usage-limit → ApiError → auto-fixable → AI healing → issue). It **consumes a category classified once upstream** and says so at `:144-151`. Thread the category in; never re-classify inside |
| `core/src/healing.rs:256` `storm_capped_diagnosis` | the cross-chain terminal state for environmental failures the per-chain budget structurally cannot see, with the reason in the user-facing copy. [retry-with-backoff](./retry-with-backoff.md) calls it the best terminal state in six repositories |
| `core/src/healing.rs:149` `usage_limit_diagnosis` | recovery timed by **the provider's own reset**, not by arithmetic — the closest thing here to reading `Retry-After`. Live: 20 retries, 50% success. Reach it by making `parse_usage_limit` succeed (§7 D3) |
| `engine/src/eval.rs:479-503` + `:48` `EvalMethod` | **the only degrade path in 963 Rust files, and it is correct.** Two attempts, then `fallback_heuristic(input, method)` with `HeuristicFallback` / `Timeout` persisted as strings, so a consumer can tell a real eval from a degraded one. This is P8 |
| `core/src/error.rs:210-214` | the IPC envelope that already ships `category`, `auto_fixable` and `failover_eligible` on **every** error. The client half is `src/lib/types/tauriError.ts:46-52`. **Read these fields instead of re-classifying the string** (§7 D5) |
| `src/lib/errorTaxonomy.ts:74` `classifyKind` | the typed client-side path: `TauriErrorKind → ErrorCategory`, no prose involved. **0 production call sites** — adopt it |
| `src/lib/errors/errorPipeline.ts:97` `classifyErrorFull` | the single client entry point that runs taxonomy + registry + explanation once and memoizes. Use it rather than calling the three layers separately — but pass it the envelope, not the string (§7 D5) |

**Do NOT build:** a ninth private failure classifier (§0.10 lists eight); a
`matches!(category, A | B)` eligibility subset (§2(d)); a `.contains("<status
code>")` test against free text (§0.2); a bare `format!("… failed: {e}")` at a
site that knows the class (§2(c)); a fallback chain you have not traced to the
failure that reaches it (§0.4); a second word list for a question an existing
predicate already answers (§0.6); a degrade whose result is indistinguishable
from a real one.

## 4. Steps

1. **Write down the failure classes before you write the failure handling.** Not
   the errors you can imagine — the ones the thing you are calling actually
   produces. Then check them against real data: here, 6 of 11 declared classes
   have never occurred and 66% of live failures land in one.
2. **For each class, write the recovery in the same table.** Retry / fall back /
   degrade / escalate / give up, plus the user-facing sentence. A class with no
   row is a class whose recovery is "whatever the fallthrough does".
3. **Find the structured discriminator and read it first.** `status.as_u16()`,
   `err.type`, the exit code, the typed variant. `healthcheck_ledger.rs:36-55` is
   the local model; `brainiac/resilience.rs:209-222` is the fleet's.
4. **Mint every failure of your own with its class attached.** Walk your own
   `format!` / `throw new Error` failure strings and ask, for each: does the code
   that wrote this already know the class? If yes, carry it. This step is the one
   this repo skipped, and §7 D1 is the price.
5. **Make eligibility a method on the class, matched exhaustively.** No `_ =>`.
   Adding a variant must be a compile error at every recovery decision.
6. **Ask whether the signature can make the wrong call impossible — now, not at
   §9.** For this leaf the answer is a real type and it is §10.
7. **Trace the fallback to the failure.** Put a breakpoint (or a `tracing::warn!`)
   on the branch that selects candidate 2 and ask which failure classes can
   physically reach it. If the answer excludes the classes the chain was built
   for, the chain is decoration.
8. **Decide the degrade, and give it a field.** `EvalMethod::HeuristicFallback`
   is the local shape; `ascent`'s `degradedToMock` refusing to cache is the
   stronger one.
9. **Count the times each recovery has actually fired, against real data.** Two
   breakers at zero, a retry budget never reached, and an escalation table whose
   third counter has no rows are all things a code review passes.
10. **Render the class.** The user needs to know whether to wait or to act.
11. **And then stop.** Do not add a second classifier. Do not widen a word list
    to patch a misclassification whose real cause is step 4. Do not raise a retry
    budget for a class whose retries are measurably not working.

### Can the type make the wrong call impossible? — asked before §9

**Yes, for the defect that matters most, and it is worth more than the gate.**
See §10.

## 5. Anti-patterns

| Anti-pattern | Failure mode |
|---|---|
| **A failure your own code minted, re-classified from its own message** | The class was known and is now a guess, and the guess loses. **Live: `Engine safety ceiling exceeded (20m)` → `Unknown` → `CreateIssue`, `suggested_fix: None`, 0 retries — 40 of 43 `Unknown` healing issues.** Independently reinvented in `vibeman`, where a 502 becomes UNKNOWN-permanent and the breaker can never trip. §7 D1 |
| **Substring-matching a bare HTTP status against free text** | The text contains numbers that are not status codes. **Live: a 9-digit nanosecond field `946341500` made a zombie-swept run an `ApiError`.** Nine such tokens in the Rust ladder, nine mirrored in TS, pinned together by a parity test. §7 D2 |
| **Two hand-written word lists for one question** | They diverge by a phrase and nothing fails. **`is_session_limit_error` has `quota exceeded`; `parse_usage_limit` does not — the difference is a durable retry at the provider's reset versus a permanent give-up.** §7 D3 |
| **A recovery-eligibility predicate as `matches!(c, A \| B)`** | Every class added later is silently excluded. **Three subsets of one 11-member enum here, all disagreeing: `is_auto_fixable` 3, `is_failover_eligible` 4, `is_technical_failure` 8 — and `ApiError`, which has the most elaborate recovery in the codebase, is "not auto-fixable".** |
| **A fallback chain walked only on connection failure** | It cannot fix the failures a different model would survive. **`break 'failover driver` on the first successful spawn; `was_failover = 0` on 4,001 audited runs; the model ladder is reachable only when changing the model cannot help.** §7 D4 |
| **The classifier's discriminator is a field that is always empty** | The class becomes a constant. **`TransientProcessFailure` keys on "stderr is empty or ≤16 chars"; stderr was empty in 98 of 98 exit-code failures, so every non-zero exit is transient — and that retry succeeds 16.7%.** |
| **Recovery reachable from exactly one call site** | Every other way a row can die skips it. **130 of 258 failed/incomplete executions produced no diagnosis at all, including all 74 boot-recovery rows and all 20 panics.** §0.8 |
| **A structured field shipped over IPC and re-derived from the string on arrival** | Two answers exist and the worse one wins. **`auto_fixable` and `failover_eligible` are serialized on every error envelope; `classifyKind` has 0 production call sites in 4,828 files; `ClassifiedError.failoverEligible` is computed and never read.** §7 D5 |
| **A recovery mechanism with no observed firing** | It is a claim. **`circuit_breaker_state`: 0 rows. `is_circuit_breaker`: 0 of 205. `retry_count` max 2 against a budget of 3. `healing_knowledge`: 0 rows, so one of the three counters the decision table is built on has never been consulted.** |
| **Collapsing every failure class into one UI state** | The user cannot tell "wait" from "act". **The execution detail card renders `explanation` and drops `category` entirely; when no explanation pattern matches it renders nothing.** |
| **A degrade indistinguishable from a real result** | It gets cached and published. Personas avoids this once (`EvalMethod`); `ascent` goes further and refuses to persist a degraded scan; `vibeman` has no degrade at all |

## 6. Evidence

### The one site to copy: `core/src/healthcheck_ledger.rs:36-55`

Twenty lines, and it is the only place in 963 Rust files that gets §2(b) right:

```rust
if let Some(code) = status_code {
    return Self::from_status_code(code);
}
let lower = msg.to_lowercase();
if lower.contains("timeout")
    || lower.contains("timed out")
    || lower.contains("connection refused")
{
    return Self::Transient;
}
if lower.contains("unauthorized")
    || lower.contains("forbidden")
    || lower.contains("revoked")
{
    return Self::Permanent;
}
```

Four decisions worth copying:

1. **The structured discriminator is read first and returns immediately.** The
   word list is unreachable whenever a status exists — which is P2 expressed as
   control flow rather than as a comment.
2. **The word list is scoped to foreign text**, the only text that can arrive
   without a status.
3. **The output is a recovery verdict, not a label.** `Transient | Permanent` is
   two classes because there are two recoveries; it does not carry classes it
   cannot act on.
4. **It appears in both halves of the §9 measurement** — `:50` in the compliant
   control and `:53,:54` in the violating rule — which is exactly right: the
   typed path is the primary and the ladder is the declared fallback. It is the
   only file in the tree that scores in both.

Supporting exemplars, each for one property:

| site | the property to copy |
| --- | --- |
| `core/src/healing.rs:294-586` `diagnose` | an **exhaustive** `match` over all 11 classes with no `_ =>` arm — adding a variant is a compile error at the one place recovery is decided |
| `core/src/healing.rs:8-58` (module doc) | the three-counter table and the full decision matrix written as doctrine **and kept in the file it governs**, with worked examples. Then measure it: one of the three counters has no rows (§0.7) |
| `core/src/healing.rs:113-120` | the escalation ladder with **its reason**: *"The Claude CLI already retries 5xx/overloaded internally, so by the time one surfaces here the provider is mid-incident; an immediate retry is pointless but a delayed, escalating one rides it out."* A recovery justified by a model of the failure |
| `core/src/error_taxonomy.rs:126-140` | a doc comment that ships **the SQL an operator should run** to find messages the ladder still buckets as `Unknown`, and instructs mirroring new shapes into TS + both parity lists. The instrument for §7 D1 is already written down; nobody has run it (running it returns the ceiling message, 40 times) |
| `engine/src/eval.rs:479-503` | the only degrade in the tree, and it **records which degrade happened** (`EvalMethod::Timeout` vs `HeuristicFallback`) rather than silently substituting |
| `src/lib/execution/executionState.ts:75-87` | `parseExecutionState` mapping an unrecognised status to `'unknown'` **and not to `'failed'`**, *"so data corruption is visible in the UI instead of masquerading as a real failure"*. The client half of P3, and the sentence this whole path is about |
| `src/engine/failover.rs:639-643` | a constant whose doc comment records the incident that produced it — a fallback ladder that pointed at two models retired 2026-06-15, *"so a healthy opus-4-8 persona whose primary hiccuped was actively failed over into a guaranteed 404"* |
| `src/engine/failover.rs:652-672` | a doc section titled **"Honest shape today"** that admits the chain degrades to a single-candidate probe. Copy the honesty; §7 D4 is what it still omits |
| `brainiac/crates/brainiac-gateway/src/resilience.rs:8-9,:219,:412` | the complement stated as a sentence **and pinned by a test** — *"Other 4xx are permanent (bad key, bad request) and fail immediately"*, asserted by `send_does_not_retry_a_permanent_4xx` (`hits.len() == 1`) |
| `ascent/src/lib/scan-finalize.ts:103,:131` | `degradedToMock` — a degrade flag that **refuses to cache or persist** the degraded result as authoritative. The strongest P8 in six repos |

### The recovery table, as designed and as executed

Every arm of `diagnose`, with what the live database says happened:

| class | designed recovery | live rows | retries | success | issues filed |
|---|---|---:|---:|---:|---:|
| `RateLimit` | `RetryWithBackoff` `min(30 << consecutive, 300)` | 21 | 20 | 50.0% | 21 (all still `open`) |
| `SessionLimit` (+ parsed usage limit) | `RetryAt(reset + 120s)`, durable | 0 as a class | — | — | 21 titled *"Usage limit reached — retry scheduled"* |
| `Timeout` | `RetryWithTimeout` `min(×2, 20 min)` | 13 | 11 | **72.7%** | 23 (15 auto-fixed) |
| `ApiError` | `RetryAt(10/20/30 min)` + **session resume** | 1 (an artefact) | 0 | — | 0 |
| `TransientProcessFailure` | `RetryWithBackoff` `min(5 << consecutive, 30)` | 172 | 30 | **16.7%** | 117 (10 auto-fixed) |
| `Network` | **`CreateIssue`** | 0 | — | — | 0 |
| `CredentialError` · `ProviderNotFound` · `Validation` · `ToolError` | `CreateIssue` | 0 | — | — | 0 |
| `Unknown` | `CreateIssue`, `suggested_fix: None` | 53 | **0** | — | 43 (**40 of them a misclassified timeout**) |

**Total: 205 healing issues, 26 resolved (12.7%), 179 still open.** The single
`AiHealing` outcome in the whole database is one issue titled *"AI healing applied
2 fixes"*.

### What a failure costs, by whether it was classified

Of $2,036.26 lifetime execution spend, failed runs account for **$53.48** and
retries of them **$33.02**. The interesting split is not the total — it is that
**$4.34 bought 5 successes in the 16.7% class while $7.91 bought 8 in the 72.7%
class.** Classifying better is worth more here than retrying more.

## 7. Deviations found

> **Second pass — what is upstream of all of this.** Every entry below reduces to
> one shape: **a fact that was known at the failure site, discarded into prose,
> and guessed at again downstream.** The status code (D2), the timeout (D1), the
> limit scope (D3), the failover eligibility (D5) and the terminal state (§0.5)
> are all known at the moment they are destroyed. §10 is about not destroying
> them.

### D1 — P0: the engine's own hard timeout is unclassifiable, and it is 93% of the `Unknown` bucket

`src/engine/mod.rs:414-417` · `core/src/error_taxonomy.rs:170-176` ·
`core/src/healing.rs:122,:573-584`.

Full chain in §0.1. **Live: 40 of 43 `Unknown` healing issues carry
`"Engine safety ceiling exceeded (20m). Execution forcibly terminated."`**;
12 executions carry it as their final `error_message` and 19 more carry it only
in the healing issue (their row was already stamped `incomplete` by the zombie
sweep — §0.5). Each got `CreateIssue`, `severity: "medium"`, `suggested_fix:
None`, and **zero retries**, against a 72.7% success rate for the same failure
worded `"Execution timed out after 300s"`.

**Fix, smallest first:** (a) add `|| lower.contains("ceiling exceeded")` to the
`Timeout` arm in `error_taxonomy.rs:170-176` **and** its TS mirror
(`errorTaxonomy.ts:108`) **and** both `PARITY_FIXTURES` lists in the same commit —
the parity test will otherwise fail, which is the gate working. (b) The real fix
is §10: the ceiling handler already knows it is a timeout, so it should construct
`FailureReason { category: Timeout, .. }` and never be re-classified. (c) While
there: `MAX_TIMEOUT_MS = ENGINE_MAX_EXECUTION_SECS * 1000` means the `Timeout`
recovery escalates runs into this exact message — cap the doubling one rung below
the ceiling, or state in a comment that the last rung is expected to produce it.

### D2 — P1: nine HTTP status codes are substring-matched against free text

`core/src/error_taxonomy.rs:156, 185, 201, 202, 243-246, 269` and the nine mirrors
at `src/lib/errorTaxonomy.ts:97, 127, 143, 144, 243-246, 269`.

`429 · 404 · 401 · 403 · 500 · 502 · 503 · 529 · 413` are tested with
`lower.contains(…)` against a message that may contain any digits at all. **Live:
1 of the 20 error messages that embed an ISO timestamp collided** — a `500` in a
nanosecond field turned a zombie-swept run into `ApiError`, the class whose
recovery resumes a CLI session.

Compounding it, `'not found'` catches ordinary domain 404s and escalates them to
`critical` + failover-eligible — **the repo has already written this down** at
`errorTaxonomy.ts:112-121` and explains why it cannot be fixed on one side alone.

**Fix:** read the status from the response before formatting anything
(`brainiac/resilience.rs:209-222`); where only text is available, require a
delimiter — `\b(?:HTTP\s*)?(4\d\d|5\d\d)\b` at minimum, or better, a
`status:\s*(\d{3})` key. Both ladders and both `PARITY_FIXTURES` lists change
together.

### D3 — P1: two limit predicates, one phrase apart, decide retry-vs-give-up

`engine/src/parser.rs:764-769` and `:780-790`.

`is_session_limit_error` accepts `quota exceeded`; `parse_usage_limit`'s
`mentions_limit` does not. Full trace in §0.6: the divergent case yields
`SessionLimit` **without** a `UsageLimitInfo`, so `healing_orchestrator::evaluate`
skips the durable-retry arm (`:209`) and lands on `is_auto_fixable(SessionLimit)
== false` → `CreateIssue`, no retry, permanently.

**Fix:** one token — add `|| lower.contains("quota exceeded")` to
`mentions_limit`. Then make the divergence unrepresentable: define the phrase
list once as a `const LIMIT_PHRASES: &[&str]` and have both predicates read it,
with a unit test asserting `is_session_limit_error(s) == parse_usage_limit(s).is_some()`
for every phrase. **That test is the P4 instrument and it is four lines.**

### D4 — P1: the failover chain is unreachable for every failure it lists

`src/engine/runner/mod.rs:1493-1714` (`break 'failover driver` at `:1678`) ·
`:2857-2878` · `src/engine/failover.rs:363-371, 639-643, 724-726`.

Full analysis in §0.4. **Live: `was_failover = 0` on 4,001 `provider_audit_log`
rows.** The four `is_failover_eligible` classes are all post-spawn; the chain is
walked only on `spawn()` returning `Err`. Both siblings that have a fallback
(`vibeman`, `ascent`) fire theirs on a **response** failure; Personas is the
outlier.

**Fix, as one unit:** (a) hoist the failover chain and `candidate_idx` out of the
spawn block so the finalizer can select the next candidate when
`failover::classify_error(err).is_some()` and the retry budget allows — the
per-candidate spawn loop is already provider-generic, which the file says at
`:717-723`. (b) Give the fallback's own failure a distinct outcome (P7): today
`last_spawn_error` reports only the last one. (c) Fix `model_used` being NULL on
all 4,001 audit rows, or the trail cannot answer "did the fallback model run?"
even after (a) lands.

### D5 — P1: the client re-derives from prose what the backend shipped as a field

`core/src/error.rs:210-214` · `src/lib/types/tauriError.ts:46-52` ·
`src/lib/errorTaxonomy.ts:74` · `src/lib/errors/errorPipeline.ts:100,:124`.

- `classifyKind` — the typed path — has **0 production call sites in 4,828 files**.
- `classifyErrorFull(raw)` (`errorPipeline.ts:100`) runs the string ladder even
  when the envelope carried `category`. `classifyUnknownErrorFull` does read it
  (`errorTaxonomy.ts:256`), and has 2 call sites against `classifyErrorFull`'s 3.
- `ClassifiedError.autoFixable` and `.failoverEligible` are computed at `:123-124`
  and **read nowhere in `src/`**.
- What renders is `classified.explanation` — a **fourth** pattern list — and
  `classified.category` is dropped (`ErrorExplanationCard.tsx:46-53`). When no
  explanation pattern matches, the card renders nothing.

**Fix:** route every IPC error through `classifyUnknownErrorFull(err)` and delete
`classifyErrorFull`'s string path for envelope-shaped inputs; render
`categoryLabel(category)` plus an explicit "retrying / not retrying" line derived
from `autoFixable`. That is P10 and it costs one component.

### D6 — P2: three disagreeing eligibility subsets of one enum

`core/src/error_taxonomy.rs:318-325, 336-348, 363-371`.

`is_auto_fixable` = {RateLimit, Timeout, TransientProcessFailure} (3 of 11);
`is_failover_eligible` = {ProviderNotFound, RateLimit, SessionLimit, Timeout}
(4 of 11); `is_technical_failure` = 8 of 11. All three are `matches!` subsets, so
a twelfth variant joins **none** of them.

Two disagreements are live, not theoretical:
- **`ApiError` is not `auto_fixable`** — yet `diagnose`'s `ApiError` arm is the
  most elaborate recovery in the codebase (a durable escalating `RetryAt` that
  *resumes the session*). It works only because `healing_orchestrator.rs:241`
  special-cases the class **before** reaching the `is_auto_fixable` gate. The
  predicate and the behaviour disagree, and the orchestrator routes around the
  predicate.
- **`SessionLimit` is not `auto_fixable`** for the same reason (step 3.5 at `:209`
  precedes the gate) — which is exactly why D3's fallthrough is fatal.
- **`Network` is in no retry set at all** and its `diagnose` arm is `CreateIssue`.

**Fix:** make eligibility an exhaustive `match` on `ErrorCategory` returning a
`RecoveryPolicy` struct, with no `_` arm, and delete the three `matches!`. Then
`ApiError` and `SessionLimit` state their own truth and the orchestrator's
special cases become redundant rather than load-bearing.

### D7 — P2: half of all failures never reach the recovery decision

`src/engine/mod.rs:2518` is the only caller of `evaluate_healing_and_retry`.
**Live: 130 of 258 failed/incomplete rows produced no healing issue** — 74 boot
recoveries, 28 exit-code failures, **20 panics**, 6 ceiling terminations, 2 others
(§0.8).

**Fix:** the recovery decision should be a function of the terminal write, not of
one code path. Route `recover_stale_executions` and `sweep_zombie_executions`
through the orchestrator with an explicit category (`TransientProcessFailure` for
a restart; a new `Abandoned` for a lost run), which also fixes the two-accounts
problem in §0.5. This composes with
[terminal-state-and-recovery](./terminal-state-and-recovery.md) D1 and should land
with it.

### D8 — P2: both circuit breakers, the retry budget and the knowledge base are unexercised

`circuit_breaker_state` 0 rows · `is_circuit_breaker` 0 of 205 ·
`retry_count` max 2 vs `MAX_RETRY_COUNT = 3` · `healing_knowledge` **0 rows**.

The KB one is the sharpest: `healing.rs:40-47` gives `occurrence_count >=
KB_ESCALATION_THRESHOLD` **first priority** in the precedence order — above the
per-chain budget — and `resolve_service_knowledge_hint` reads a table that has
never held a row. The top-priority rule in the canonical decision table has never
been evaluated.

Reported as a deviation rather than a success because **an unexercised recovery
path is a claim, not a guarantee** — the same status
[retry-with-backoff](./retry-with-backoff.md) D7 gives the never-reached DLQ.
`brainiac` is the counter-example that makes this actionable: 10 tests, 5 of them
end-to-end against a mock upstream, including the half-open probe and the
abandoned-probe cases.

**Fix:** a test that drives one persona through 5 consecutive failures and asserts
the breaker opens, one that writes a `healing_knowledge` row and asserts the delay
override applies, and one that drives a chain to `retry_count = 3` and asserts
`CreateIssue`. Three tests, ~60 lines, and they are the only way anyone will learn
whether `record_failure`'s persistence survives the 15-minute
`PERSIST_TTL_MINUTES` purge.

### D9 — P2: `TransientProcessFailure`'s discriminator is a field that is always empty

`core/src/error_taxonomy.rs:274-292` · `src/engine/runner/mod.rs:2793-2798`.

The arm keys on the stderr suffix being empty or ≤16 chars, and documents the
assumption that real errors emit informative stderr. **Measured: 98 of 98
exit-code failures had an empty suffix.** The `≤16` branch has never fired and
the "informative stderr" branch has never fired.

**Fix:** the CLI reports failures on **stdout** in `stream-json` mode. Parse the
terminal `result` line's error payload (the runner already drains it) and classify
from *that* structured object before falling back to the exit code. Until then,
say so in the comment — an assumption contradicted 98 times out of 98 should not
read as a design rationale.

### D10 — P3: `provider_audit_log.model_used` is NULL on all 4,001 rows

`src/engine/runner/mod.rs:2887` writes `model_used: metrics.model_used.clone()`.
The BYOM compliance trail — whose entire purpose is to record which provider and
model served a request — cannot answer that question for any run. It also makes
D4 unfalsifiable from data alone: even if failover fired, the audit could not show
which model it fell back to.

**Fix:** stamp from the argv at spawn time (the runner already does this for
`persona_executions.model_used` at `:1796-1799`) and let the CLI-reported model
overwrite it, the same precedence `llm_spend::parse_result_line` uses.

## 8. Gaps — what the primitives genuinely cannot do

1. **A word list is unavoidable for foreign text.** The Claude CLI's stderr and a
   remote body are prose this repo does not control; no type reaches them. The
   correct scope of §2(c) is therefore *"everything this codebase mints carries
   its class; only foreign text goes through the ladder"* — which is a boundary,
   not an elimination, and §10 is sized to it.
2. **The parity test that protects the two ladders also freezes them.**
   `errorTaxonomy.parity.test.ts` pins Rust and TS byte-for-byte, so narrowing an
   over-broad arm requires a two-language commit plus two fixture lists. That is
   the right design and it is why D2's `'not found'` over-escalation has survived
   despite being documented in the file itself. Budget for the four-file change.
3. **The census cannot assert this leaf's central condition**, which is an
   absence: *"no error string this repo mints falls through its own classifier"*.
   Per the [doctrine](../golden-path-doctrine.md#4-census-rules) the engine
   ratchets a presence. §9 specifies a **test** for it instead, with an
   assert-the-instrument precondition.
4. **Nothing can tell whether a recovery mechanism is unreachable or merely
   lucky.** Two breakers at zero trips, a budget never reached and an empty
   knowledge table are indistinguishable from a healthy fleet by reading. Only
   execution separates them, and for a breaker that means a test with a fault
   injected — which is why `brainiac`'s 10 tests are the fleet's only real
   evidence that a breaker works.
5. **`ErrorCategory` cannot express confidence.** `Unknown` means both "a genuinely
   novel failure" and "the ladder's word list is incomplete", and these want
   opposite responses (investigate vs. add a phrase). A `Unknown { matched_arms:
   0 }` versus a `LowConfidence` variant would separate them; today the
   `error_taxonomy.rs:126-140` SQL is the only instrument, and it is a manual one.
6. **One column carries two relations.** As in
   [retry-with-backoff](./retry-with-backoff.md) D6, `retry_of_execution_id` means
   both "same work retried" and "different work caused by that work" — so no query
   over recovery outcomes is exact without joining the parent's status. Every
   number in §6 is reported over parents with `status = 'failed'` for that reason.

## 9. The missing gate

### The semantic conditions, stated first

Per the [portability test](../research/portability-test.md), what follows are
**one repo's proxies**. An adopting repo inherits the sentences and re-derives its
own signals.

> **(A)** *A failure class that drives a recovery decision is re-decided by
> substring-matching a message, outside the one module that owns the taxonomy* —
> so N private vocabularies exist, they diverge, and none of them fails when it
> is wrong.
>
> **(B)** *An error string this codebase mints falls through this codebase's own
> classifier into the unknown bucket* — so the recovery built for that class
> never runs.
>
> **(C)** *A recovery-eligibility predicate is a hand-spelled subset of the
> failure classes* — so every class added later defaults to "no recovery".
>
> **(D)** *A fallback chain is unreachable for the failures it lists.*

**(A) is gated below. (B), (C) and (D) are refused as census rules, each with the
number that decided it and the instrument that *can* express it named instead of a
bad regex shipped.**

### What is refused, with numbers

- **(B) is the leaf's central finding and the census cannot express it**, because
  it is a **cross-artifact absence**: it needs the set of strings the repo mints
  at failure sites *and* the classifier's behaviour on each, which is a
  computation, not a count. The right instrument is a **Rust unit test** in
  `core/src/error_taxonomy.rs`'s test module:

  > Enumerate the failure strings this repo formats — start with the eight
  > measured live shapes (`Engine safety ceiling exceeded ({}m). Execution
  > forcibly terminated.`, `Execution timed out after {}s`, `Execution failed
  > (exit code {}): {}`, `App restarted while execution was running`, `Execution
  > stalled: running since {} (>{} min) — marked as zombie`, `Internal error
  > (panic): {}`, `Claude usage limit reached (rolling window){}`, `Session limit
  > reached`) — and assert **none classifies to `ErrorCategory::Unknown`**.
  >
  > **Assert the instrument first**: the fixture list must hold ≥8 entries, and
  > the test must **FAIL today** on the ceiling message and the panic message.
  > A version of this test that passes on first run has been written wrong.

  ~25 lines, runs under `npm run test:rust`, and it is the only thing that would
  have caught 40 of 43 `Unknown` diagnoses. A census count of "how many failure
  strings does this repo format" would ratchet a number that should be allowed to
  grow.

- **(C) was designed, measured and REJECTED on population.** The signal —
  `matches!\s*\(\s*[^,]{1,40},\s*(?:\w+::)?(?:ErrorCategory|FailureCategory)::` —
  scores **3 files / 6 matches**, and **3 of the 6 are inside
  `core/src/error_taxonomy.rs` itself** (the three predicates the rule exists to
  criticise). A gate whose population is 50% the primitive it points at is a gate
  on one file. The right instrument is the **type** (§10, move 2: an exhaustive
  `match` with no `_` arm makes a new variant a compile error), not a matcher.
  Numbers published so the next composer does not re-litigate.

- **(D) is a reachability question over control flow** — "can candidate 2 be
  selected for failure class X?" — which no lexical matcher can answer. It is a
  test: spawn succeeds, the run then fails with a `RateLimit`-classified error,
  assert `active_engine_kind`/model changed or that `was_failover` is written.
  That test does not exist and D4 is why.

- **A broader "error-message substring test" gate was measured and REFUSED at
  ~50% precision.** Anchoring on any `.contains("<error-ish literal>")` with an
  error-shaped receiver scores **42 files / 245 matches**, but hand-classifying
  the top files finds `portfolio.rs` (26), `cost.rs` (16) and
  `credential_fields.rs` (13) are string-processing utilities with no recovery
  decision anywhere near them. Narrowing the *vocabulary* to the recovery classes
  is what recovers precision, and that is the rule below.

### Existing rules checked first, by reading each definition

| rule | why it does not cover this |
| --- | --- |
| `model-reply-parser-without-a-reason` (22/34, `typed-error-contract.md`) | **The nearest neighbour and the exact complement.** It counts `parse_*`/`extract_*` functions over model-reply text returning `Option`, i.e. the *producer* discarding the reason. Mine counts the *consumer* re-deriving a class from prose. Its anchor is a `fn` signature; mine is a `.contains(` call. **Verified: 0 shared file/offset pairs** — its 22 files and my 14 are disjoint sets |
| `partial-terminal-status-set` (6/14, `terminal-state-and-recovery.md`) | Same idea (a hand-written subset of a closed set) on a different axis and in a different language: its anchor is a SQL `status IN ('…')` literal bound to `persona_executions`. Mine is a Rust `.contains(` on an error message. **0 shared positions**; its 6 files are all `db/src/repos` and none of mine is |
| `undiscriminated-credential-rejection` (6/17) | Closest in *spirit*: it counts credentialed calls whose failure path collapses a status into a message. That is the **producer** of the prose my rule counts the **consumer** of. Different root (`src-tauri/src` vs `src-tauri`), different anchor (`.bearer_auth(`/header), disjoint match sets |
| `anonymous-retry-budget` (6/8, `retry-with-backoff.md`) | Gates *how many* attempts. Mine gates *whether a retry is the right answer*. Its anchor is a loop header; **0 shared positions** |
| `unknown-money-as-zero` (21/25) · `read-failure-as-empty-value` (32/68) | Both are "a failure rendered as a benign value". Adjacent family, but they count a *value* substitution (`unwrap_or(0)`, `.catch(() => [])`); mine counts a *classification*. Different roots for the second (`src` vs `src-tauri`); no shared matches with the first |
| `call-site-text-match` (56/121) | Case-folded substring matching in **TypeScript**, about search/filter normalization across 14 locales. Different root, different language, different subject |
| `discarded-guard-verdict` · `unfenced-work-outcome-write` · `process-global-caches-a-failure` · `empty-sample-as-confident-zero` | Checked; all anchor on SQL or on cache/sample shapes. No overlap |

**None of the 113 existing rules keys on where a failure class comes from.
Proposing one.**

### Measurement

**Precision 27/27 — every match opened and read.** The anchor is a
`.contains("<recovery-class vocabulary>")` in a **branch or binding position**
(preceded by `if` / `||` / `&&` / `;` / `{` / `=` / `return`), which is what
excludes `assert!(…)` fixtures — the failure mode the doctrine warns about, and
the reason the untempered version of this rule scored 39 with **10 of 39 (26%)
inside `#[cfg(test)]` modules the census engine cannot exclude**.

```
rule                                                files  matches  walked  floor
privately-reclassified-failure                         14       27     963    900
privately-reclassified-failure-positive-control          9       13     963    900
```

**Two independent implementations, and the disagreement is the finding.** My own
walker (brace-matched `#[cfg(test)]` removal, offset-preserving comment blanking —
the census engine does neither) returns **15 files / 29 matches** for the
production condition; the runner returns **14 / 27**. The two missing matches are
`runner/mod.rs:2854` (`.map(|e| e.contains("Session limit"))`, prefixed by `|`)
and `stale.rs:935` (prefixed by `(`). Both are true positives, both are lost to
the delimiter tempering, and that is the **declared recall gap**: the tempering
that removes 100% of the test contamination costs 2 of 29 real matches. I took the
runner's number because the runner is what ratchets, and the loss is in the
conservative direction.

**The positive control is a compliant-form counterpart, not a partition of one
anchor — and that is stated rather than glossed.** "A failure is classified" has
no shared syntactic token: asking the taxonomy and re-deciding it privately are
different expressions, so no single anchor's matches can be split between them.
What makes the control load-bearing anyway is that **it uses the identical
delimiter-tempering machinery**, so the only difference between the two patterns
is the *operand* — a prose substring versus the shared predicate — and both are
non-trivially populated (27 vs 13). The strongest single piece of evidence is that
**`core/src/healthcheck_ledger.rs` appears in BOTH**: `:50 from_status_code(` in
the control and `:53,:54 .contains("timeout")` in the violating rule. That is one
function doing the typed thing first and the prose thing as its declared fallback
— the exemplar in §6 — which proves the two patterns are measuring the same
decision made two ways, in one place, and not two unrelated shapes.

### The rule

```json
{
  "rules": [
    {
      "id": "privately-reclassified-failure",
      "goldenPath": "docs/concepts/golden-paths/failure-recovery-strategy.md",
      "title": "A recovery-bearing failure class re-decided by substring-matching a message, outside the shared taxonomy",
      "roots": ["src-tauri"],
      "extensions": [".rs"],
      "signal": {
        "pattern": "(?:\\bif\\b|\\|\\||&&|;|\\{|=|\\breturn\\b)[ \\t\\r\\n]{0,40}[A-Za-z_][A-Za-z0-9_.]{0,40}(?:\\(\\))?(?:\\.\\s*to_(?:lower|ascii_lower)case\\(\\))?\\.\\s*contains\\(\\s*\"[^\"\\n]{0,30}(?:timed out|timeout|rate limit|usage limit|session limit|quota exceeded|too many requests|overloaded|service unavailable)[^\"\\n]{0,30}\"\\s*\\)",
        "flags": "gi",
        "ignoreCommentLines": true,
        "description": "In a BRANCH or BINDING position (the match must open with if / || / && / ; / { / = / return), a substring test against one of the failure-class words that core/src/error_taxonomy.rs owns - timed out, timeout, rate limit, usage limit, session limit, quota exceeded, too many requests, overloaded, service unavailable. PROXY FOR the stack-free condition: the class of a failure - which is what decides whether the system retries, falls back, degrades, escalates or gives up - is re-derived from prose at the call site instead of from a structured discriminator or from the one module that owns the taxonomy, so N private vocabularies exist, they diverge, and nothing fails when one of them is wrong. THE BRANCH-POSITION TEMPERING IS THE WHOLE RULE: the untempered form scores 39 matches of which 10 (26%) are assert!(x.contains(\"timed out\")) inside #[cfg(test)] modules the census engine cannot exclude; requiring the match to open with a statement/branch delimiter rather than an open paren or comma removes all 10 and costs 2 true positives (runner/mod.rs:2854 behind a closure pipe, stale.rs:935 behind a paren) - a declared recall gap in the conservative direction. PRECISION 27/27, every match opened. LIVE COST, measured against the operator's database rather than reasoned: error_taxonomy.rs:4 calls itself the single source of truth for error classification and there are EIGHT independent classifiers in the tree; two of them (parser.rs:764 is_session_limit_error and parser.rs:780 parse_usage_limit, three lines apart) already differ by one phrase - 'quota exceeded' is in the first and not the second - and that one phrase is the difference between a durable retry at the provider's reset (50% success across 20 live retries) and a permanent CreateIssue with no retry at all. PRECONDITION (must be re-derived per repo): this repo has ONE module declared as the owner of failure classification, excluded below; a repo with no such module, or one that classifies from a structured status field the way brainiac/crates/brainiac-gateway/src/resilience.rs:209-222 does (zero .contains on an error message outside its tests), scores ZERO here and must re-derive its own proxy for the same condition."
      },
      "exclude": [
        {
          "path": "src-tauri/core/src/error_taxonomy.rs",
          "reason": "the shared taxonomy itself — the one module allowed to own this vocabulary, and the destination every other match should be routed to"
        }
      ],
      "baseline": { "files": 14, "matches": 27 },
      "floor": 900
    },
    {
      "id": "privately-reclassified-failure-positive-control",
      "goldenPath": "docs/concepts/golden-paths/failure-recovery-strategy.md",
      "title": "Positive control — the failure class obtained by asking the shared taxonomy or reading a typed status",
      "roots": ["src-tauri"],
      "extensions": [".rs"],
      "signal": {
        "pattern": "(?:\\bif\\b|\\|\\||&&|;|\\{|=|\\breturn\\b|\\bmatch\\b)[ \\t\\r\\n]{0,40}(?:[A-Za-z_][A-Za-z0-9_]{0,30}::){0,3}(?:classify_error|classify_error_str|is_failover_eligible|is_auto_fixable|is_technical_failure|from_status_code)\\s*\\(",
        "flags": "g",
        "ignoreCommentLines": true,
        "description": "the COMPLIANT counterpart of privately-reclassified-failure: the same branch/binding tempering, the same roots, the same walk - and the operand replaced by a call into the shared taxonomy (classify_error / classify_error_str / is_failover_eligible / is_auto_fixable / is_technical_failure) or into a typed status reader (from_status_code). It is NOT a partition of one anchor, and that is stated in the document rather than glossed: 'a failure is classified' has no shared syntactic token, so asking and re-deciding cannot be split out of one match set. What makes it load-bearing is that the two patterns differ ONLY in the operand, both are non-trivially populated (27 violating vs 13 compliant), and core/src/healthcheck_ledger.rs scores in BOTH - :50 from_status_code() as the primary path and :53,:54 .contains(\"timeout\") as its declared fallback - which proves the two are measuring the same decision made two ways in one function. It carries NO baseline by design: a ratchet is monotone-downward and a control counting compliant code would fail the build every time adoption improved."
      },
      "exclude": [
        {
          "path": "src-tauri/core/src/error_taxonomy.rs",
          "reason": "the shared taxonomy itself — its internal self-calls would inflate the control"
        }
      ],
      "floor": 900
    }
  ]
}
```

### Validation — reproduced, fault-injected, positive-controlled, and re-extracted

Run against a **private** scratch registry with a filename unique to this composer
(never `scripts/census/rules.json`, per the contract's concurrent-writer warning):

```
node scripts/census/run-census.mjs --rules <private>.json --check --verbose
```

| Check | Result |
|---|---|
| Baseline reproduces | `OK` — 14 files / 27 matches / 963 walked / floor 900 · **exit 0** |
| Runtime | **0.55 s** for both rules over 1,926 file-visits. No lookbehind of any kind; every quantifier bounded (`{0,40}`, `{0,30}`) |
| Precision | **27/27** — all opened and read; the full list is in §7/§0.10 |
| Test contamination | **0 of 27.** The untempered form scores 39, of which 10 are `assert!` fixtures inside `#[cfg(test)]`; the branch-position tempering removes all 10 |
| Second implementation | a standalone walker with **brace-matched** `#[cfg(test)]` removal returns **15/29**; the delta is 2 declared-recall-gap true positives, in the conservative direction |
| **Positive control** | **9 files / 13 matches**, one of which (`failover.rs:840`) is a test call — 12 production. `healthcheck_ledger.rs` scores in both rules |
| Fault: baseline `13/26` (a new violation appears) | `[drift] files rose 13 -> 14 (+1)`, `matches rose 26 -> 27 (+1)` · **exit 1** |
| Fault: baseline `15/28` (a silent drop) | `[drift] files dropped 15 -> 14 (-1) without the baseline moving` · **exit 1** |
| Fault: `roots` → a non-existent dir | `[structural] walked 0 files but floor is 900. THE MATCHER IS BROKEN, NOT THE CODEBASE CLEAN` + `matched zero files anywhere` + stale-exclude + both drift codes · **exit 1** |
| Fault: an `exclude` entry matching nothing | `[structural] exclude "…/gone.rs" matched no file. The exemption is stale` · **exit 1** |
| Fault: the positive control given a `baseline` | `rules[1] … a positive control must NOT carry a baseline — it exists to fail` at `validateRule` · **exit 1**, 0 rules scanned |
| **Re-extraction** — rule pulled back out of this document's fenced block and re-run | **identical: 14 files / 27 matches / 13 control matches / exit 0** |

### Where this executes

`npm run census:check` runs in **two** places, and the important one is not CI:

- the **`golden-path-census` pre-push job** in `lefthook.yml:74-75`, added
  2026-08-16 for exactly the reason the brief names — the census had previously
  lived only inside `npm run check`, "which nothing runs";
- and inside `npm run check` (`package.json:52`).

Both run on the developer's machine before the branch leaves it. **This gate does
not depend on `ci.yml`**, which is currently red on 10 pre-existing Rust failures
and therefore effectively enforces nothing.

### How it fails loudly if its own precondition is absent

`floor: 900` against 963 Rust files means a repo whose `roots`/`extensions` no
longer describe it reports **"THE MATCHER IS BROKEN, NOT THE CODEBASE CLEAN"**
rather than a clean run — verified above. The `zero-matches` structural check
means a port to a repo that classifies from a structured status field (which is
what `brainiac` does, and it would score 0 here) **fails immediately rather than
baselining at 0** — the correct outcome, because the condition is present there in
different syntax and this proxy cannot see it. The single `exclude` entry is the
taxonomy module itself, which is load-bearing rather than an exemption: if it is
ever renamed, the run fails with a stale-exemption error instead of silently
counting the primitive as a violation.

### The census cannot express "must be zero"

This condition **should not** reach zero — a word list is the honest tool for
foreign text (Gap 1), so a handful of these sites are legitimate forever. What
should reach zero is the subset that has a structured discriminator available.
When the count stops falling, the remaining sites should each grow a comment
naming the foreign text they classify, and the rule should be **re-scoped** (to
sites in files that also import `error_taxonomy`) rather than deleted. If it ever
does reach zero, delete it — `assertRule` treats a zero-match rule as a structural
failure, and a rule pinned at 0 is a gate that can never fire.

## 10. Type over gate — the answer

**Yes, and the reachable version is narrower than the obvious one.**

The obvious move — "make `ErrorCategory` required everywhere" — fails
[Q2](../golden-path-doctrine.md#1-prefer-a-type-over-a-gate--and-the-seven-qualifications):
requiredness is not closedness, and `ErrorCategory` is *already* closed and
*already* required at `HealingContext.category`. The bad state is not a missing
category; it is a category **derived from the wrong input**.

**Move 1 — withhold the string from the recovery decision.** Replace
`ExecutionResult.error: Option<String>` with:

```rust
pub struct FailureReason {
    pub category: ErrorCategory,   // known at the site that failed
    pub detail: String,            // for humans and logs
    pub source: &'static str,      // "engine_ceiling" | "runner_timeout" | "cli_stderr" | …
}
```

and make `evaluate_healing_and_retry` take a `&FailureReason`. Then
`classify_error(&str)` is reachable **only** from the one constructor that handles
foreign text (`FailureReason::from_cli_stderr`), which is the entire legitimate
domain (Gap 1). The engine-ceiling handler at `mod.rs:412-427` cannot compile
without naming `Timeout`; the zombie sweep cannot compile without naming its
class; the spawn error cannot compile without naming `ProviderNotFound`.

Held against the seven qualifications:

- **Q3 (a type nobody constructs constrains nothing)** — there are **30
  `success: false … error: Some(…)` construction sites across 13 files**, plus the
  boot-recovery and sweep writes. This is a real, countable population, unlike
  `--max-budget-usd`'s single site.
- **Q5 (withholding beats requiring)** — this is the withholding form: the
  recovery path is never handed a bare `&str`, so there is nothing to forget. The
  in-repo precedent is `brain::oneshot::call_claude_text`, whose docstring states
  the same move (*"there is deliberately no unmetered public entry point"*).
- **Q6 (withhold the dangerous freedom, not the answer)** — the dangerous freedom
  is *inventing a class from words*, not carrying a human-readable detail;
  `detail: String` stays.
- **Q1 (a type carries only what it encodes)** — this does **not** fix D2. The
  nanosecond-timestamp collision lives *inside* `classify_error`'s ladder, where a
  `FailureReason` never reaches. That fix is separate and structural: read the
  status before formatting, `brainiac`-style. Saying so is the point of Q1.
- **Q7** — callers supply the prose voluntarily, so relaxing anything is inert;
  the fix is withholding the *construction* of a category-less failure.

**Move 2 — make eligibility exhaustive.** Replace the three `matches!` subsets
with one `match` on `ErrorCategory` returning a `RecoveryPolicy { retryable,
failover_eligible, technical, user_hint }`, with **no `_` arm**. A twelfth variant
then fails to compile at exactly one place instead of silently defaulting to "no
recovery" at three. This is the same move `core/src/types.rs:795-834` already
makes for terminal states (a coverage test that **fails the build** on an
unclassified variant), applied to the error axis — so the repo has the precedent
and the taste for it.

**What the type does not reach, stated plainly:** the CLI's stderr (Gap 1), the
parity-frozen ladders (Gap 2), and the reachability question in D4. The census
rule holds the line on move 1's population until it lands; the test in §9(B) is
what would have caught D1; and D4 needs a test, not a type.

## 11. Backlog

| # | item | where |
|---|---|---|
| 1 | `\|\| lower.contains("ceiling exceeded")` in both ladders + both `PARITY_FIXTURES` | D1 |
| 2 | `\|\| lower.contains("quota exceeded")` in `parse_usage_limit::mentions_limit`, plus the four-line agreement test | D3 |
| 3 | The §9(B) unit test: every self-minted failure string classifies to something other than `Unknown` | §9 |
| 4 | Hoist the failover chain so a post-spawn eligible failure can select the next candidate | D4 |
| 5 | `FailureReason` at the 30 failure-construction sites; `classify_error` reachable only from `from_cli_stderr` | §10 move 1 |
| 6 | One exhaustive `RecoveryPolicy` match replacing the three `matches!` subsets | §10 move 2 |
| 7 | Route boot recovery and the zombie sweep through the orchestrator with an explicit category | D7 (lands with `terminal-state-and-recovery` D1) |
| 8 | Three tests for the unexercised recoveries: breaker opens at 5, KB delay override applies, budget exhaustion escalates | D8 |
| 9 | Render `categoryLabel` + a retry/no-retry line from the envelope's `auto_fixable`; adopt `classifyKind` | D5 |
| 10 | Classify from the CLI's stdout `result` payload instead of an always-empty stderr | D9 |
| 11 | Stamp `provider_audit_log.model_used` from the argv at spawn | D10 |

## 12. Corrections to the brief

**1. The spine's `convergence: converged` label does NOT hold in its positive
form.** Tested clause by clause against four model-calling siblings:

| clause | verdict |
|---|---|
| a named failure taxonomy drives recovery | 3 of 4 — and one repo's three taxonomies are mutually unaware, one of them with zero importers |
| recovery is decided from a structured field | **1 of 4** |
| a fallback exists | 2 of 4 |
| a breaker sits above the retry | 2 of 4; **1 of 3 has ever been observed to trip** |
| a degrade path exists | 3 of 4 |
| the fallback's own failure is handled differently | **0 of 2** |
| the user sees the failure class | **1 of 4** |

**What converges is the failure mode, not the practice** — and it converges hard.
The strongest oracle result is that `vibeman` independently reinvented this leaf's
central defect (a self-minted message its own classifier cannot recognise), with a
*worse* consequence than Personas': its 502 and 503 strings classify as
UNKNOWN-permanent, so its circuit breaker can never trip on the two most common
transient gateway failures. Two codebases, two languages, no shared code, the same
shape. **That is physics, and it is the third `converged` label in this campaign
to hold only as a convergent failure** — the pattern noted in the brief is now
three for three.

**2. "The healing system … likely the best-designed recovery in the tree. Check
it." — Confirmed as a design, refuted as an outcome.** `MAX_RETRY_COUNT = 3`, a
real escalating schedule and a terminal `CreateIssue` are all present and correct,
and `diagnose` is the only exhaustive class→action `match` in the codebase. But
**it has never used any of them**: max live `retry_count` is 2, so the budget
escalation has never fired; `healing_knowledge` has **0 rows**, so the counter the
module's own precedence list ranks **first** has never been consulted; and the
input it is fed is wrong for 40 of its 43 `Unknown` diagnoses. The ladder is good.
It is being handed the wrong rung.

**3. "`circuit_breaker_state`: 0 rows. A breaker that has never tripped may be
well-tuned or may be unreachable." — Neither. It is unexercised, and so is its
sibling.** `record_success` persists too (`failover.rs:523`), so the table should
carry a row after any execution; `PERSIST_TTL_MINUTES = 15` and a boot-time
`purge_expired` make every row transient by design, which is why the table is
empty 51 days after the last execution. The stronger finding is the second
breaker: **`is_circuit_breaker = 0` on all 205 healing issues**, so the
persona-level breaker has not tripped either. And `brainiac` is the proof that
"never tripped" is a *testing* gap rather than a tuning result: its breaker has 10
tests, 5 end-to-end against a mock upstream, including half-open probe admission
and abandoned-probe recovery.

**4. "BYOM/mixed-engine fallback exists. Does a failed primary actually fall
back?" — No, and not for the reason the brief implies.** It is not that failover
is rare; it is **structurally unreachable** for every failure class it lists
(§0.4), because the loop `break`s on the first successful spawn and all four
eligible classes are post-spawn. `was_failover = 0` on 4,001 audit rows.
And the second half of the question — "is the fallback's failure handled
differently?" — is answered by the oracle rather than by this repo: **0 of 2
siblings that have a working fallback treat it differently either.** That clause
is a proposal with no external warrant and is labelled P7 accordingly.

**5. "34 parsers return `Option` and lose the reason." — Not re-derived, and
deliberately not gated.** That count is
[typed-error-contract](./typed-error-contract.md)'s and its rule
(`model-reply-parser-without-a-reason`, 22/34) already ratchets it. What this path
adds is the **consequence at one specific `Option`**: `parse_usage_limit` is one
of the 34, and the `None` it returns for a "quota exceeded" message is the
difference between a durable retry at the provider's reset and a permanent
give-up (§0.6). One `Option`, two recoveries, one phrase apart.

**6. "`failed` vs `incomplete`: … a recovery strategy keyed on the wrong state
recovers the wrong runs." — True, and the live shape is stranger than that.** The
zombie sweep does not merely pick a different terminal state; **19 of its 20
`incomplete` rows carry a healing issue naming a completely different cause**
(`Engine safety ceiling exceeded`) than the row's own `error_message` (`Execution
stalled … marked as zombie`). Two subsystems recorded two accounts of one run.
And **0 retries were ever spawned from an `incomplete` parent** — the recovery
path is reachable from one call site (`engine/mod.rs:2518`) that neither reaper
goes through, which is also why 74 boot-recovery rows and 20 panics produced no
diagnosis at all.

**7. "Two retries in the entire headless model surface, and one has no delay at
all." — Confirmed and located.** The one with a delay is `engine/src/eval.rs:490`
(`sleep(2s)` after attempt 0 only) and it turns out to be **the only degrade path
in 963 Rust files** — `fallback_heuristic(input, EvalMethod::{Timeout,
HeuristicFallback})`, which records *which* degrade happened. That makes it worth
promoting to §3 as a mandated primitive rather than filing it as a thin retry. It
also carries this leaf's defect in miniature: the timeout-vs-other split at `:494`
is `last_err.contains("timed out")`.

**8. A finding the brief did not anticipate: the typed answer already crosses the
IPC boundary in both directions and is used on neither side.** `auto_fixable` and
`failover_eligible` are serialized on every Rust error envelope
(`core/src/error.rs:213-214`) and declared on the TS type
(`tauriError.ts:52`); `classifyKind` has **0 production call sites in 4,828
files**; `ClassifiedError.failoverEligible` is computed and **read nowhere**. The
client re-runs a word-list ladder over prose to recover a value that arrived as a
field — and then renders neither, because the execution detail card uses a fourth
pattern list and drops the category entirely.
