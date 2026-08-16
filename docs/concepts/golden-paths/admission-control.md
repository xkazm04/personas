# Golden path — Admission control

> Situation node: `backend-runtime/job-coordination/admission-control` ·
> [situation spine](../situation-spine.md) · recurrence 7 · risk **HIGH** ·
> sides: **server** · convergence: **mixed** ·
> dimensions: **function · resilience · performance · cost · code-quality**
> Composed 2026-08-16 against `master` @ `95555f875`.
>
> **Sweep size.** All **963** `.rs` files under `src-tauri/` (the census engine's own walk agrees at
> 963), enumerated three ways by two independent scanners: every `Semaphore::new`, every
> `insert_running` / `try_add_running` / `try_start_healing` / `.admit(`, every non-atomic capacity
> pre-check, every `RateLimiter::check`, and every `<count> >= <CAP>` refusal in the tree (177 raw
> matches, hand-classified down to the 12 that bound *work* rather than *payload size*).
> `engine/src/queue.rs`, `engine/src/rate_limiter.rs`, `engine/src/tier.rs`, `src/background_job.rs`,
> `src/engine/resource_governor.rs`, `src/commands/fleet/stale.rs`,
> `src/commands/infrastructure/task_executor.rs`, `src/commands/execution/executions.rs`,
> `src/commands/infrastructure/{idea_scanner,kpi_scan,use_case_scan,tier_usage}.rs`,
> `engine/src/p2p/connection.rs` and `core/src/error.rs` read in full.
>
> **Measured by execution, not by reading.** `ConcurrencyTracker::has_capacity` and
> `has_global_capacity` (`queue.rs:156-158`, `:214-220`) were **transcribed verbatim** into JS and
> replayed as a sweep-line over **2,188** executions taken from a **read-only copy** of the
> operator's `personas.db` (347 MB) and `personas_data.db` (17.5 MB), copied 2026-08-16 17:14 UTC+2
> with the app running (`engine-leader.lock` heartbeat 0 s old). The live files were never opened for
> write. The four backlog-saturation gates were replayed with their own verbatim SQL against all
> **14** live projects, and **two of them are refusing right now**.
>
> **`cargo` was not run.** Every Rust claim is static and traces to a file read during composition.
>
> Convergence oracle run against **`personas-web`, `brainiac`, `personas-cloud`, `vibeman`,
> `ascent`** — all five present, all five opened. It produced the document's second headline (§0.2)
> and one silence worth reporting as silence.
>
> **Settles:** where the decision to let work in is taken, what type the answer has, whether it is
> taken before or after the work leaves a trace, and what a refused caller is told.

---

## 0. The headline

**This binary has eight admission lanes and seven different ways of saying no, and exactly one of
them is a classification. The other six collapse "there is no room, come back" into a value that
already means something else — and the app's own error taxonomy then declares ten of its eleven
capacity refusals `retryable = false`.**

### 0.1 — eight lanes, seven verdicts, one type

| lane | the door | verdict type | what it actually bounds |
|---|---|---|---|
| persona executions | `ConcurrencyTracker::admit` (`engine/src/queue.rs:253`) | **`AdmitResult { Running, Queued{position}, QueueFull{max_depth} }`** | per-persona `max_concurrent` **AND** global 10 **AND** provider quota cooldown **AND** host CPU/RAM |
| background jobs — every scan, adopt, twin, verify, compose | `BackgroundJobManager::insert_running` (`src/background_job.rs:230`) | `Result<(), AppError>` — and `Err` *also* means the mutex was poisoned | mutual exclusion **by job id**. No capacity bound of any kind. 22 call sites |
| dev-runner batch | `Semaphore::new(max_parallel)` (`task_executor.rs:663`) | a permit (no verdict) | a width the **caller supplies, unclamped** |
| Fleet `claude` sessions | `free_slot_for_spawn` (`fleet/stale.rs:1393`) | `()` | a soft cap that **evicts instead of refusing**, default 0 = off |
| events / webhooks | `RateLimiter::check` (`engine/src/rate_limiter.rs:50`) | `Result<(), u64>` — the `Err` is a retry-after | 30 events/min/source, 5 webhooks/min/trigger |
| AI healing | `try_start_healing` (`engine/mod.rs:638`) | `bool` | one healing session per persona |
| P2P peers | the insert under the write lock (`p2p/connection.rs:323`) | `Result<bool, AppError>` **+ a counter** | `max_peers` |
| backlog producers | `pending >= CAP` (`idea_scanner.rs:434`, `kpi_scan.rs:496`, `use_case_scan.rs:238`, `dispatch.rs:912`) | `Result<_, AppError::Validation>` | the **downstream review queue**: 15 / 10 / 12 |

`AdmitResult` is the answer this leaf wants and it exists, fully formed, with a queue, priority
ordering, backpressure and four independent gates behind it. **It has one call site**
(`engine/mod.rs:886`), it governs the one lane that has produced nothing for 51 days, and no other
lane in the app can express the three outcomes it names.

### 0.2 — ten of eleven capacity refusals are typed as the caller's mistake

`core/src/error.rs` and `engine/src/tool_outcome.rs` are the app's own taxonomy, one classifier
shared across the FFI:

```rust
AppError::RateLimited(_) => (ToolErrorKind::RateLimited,   None, /* retryable */ true )  // tool_outcome.rs:108
AppError::Validation(_)  => (ToolErrorKind::Misconfigured, None, /* retryable */ false)  // tool_outcome.rs:113
```

`Validation` also serialises `category: "validation"`, `kind: "validation"` and
`failover_eligible: false` into every IPC envelope (`core/src/error.rs:123-125, :186`).

Now read what the doors return. Queue full (`engine/mod.rs:969`):

> `"Persona '{}' execution queue is full ({} queued, {} running). Try again later."` — an
> **`AppError::Validation`**.

The sentence says *try again later*. The type says *this is not retryable and the caller
misconfigured something*. The same inversion holds at `approval_exec_knowledge.rs:691` (*"wait for
one to settle"*), `share_link.rs:122` (*"Wait for existing links to expire"*), `connection.rs:332`
(*"Disconnect a peer first"*), `idea_scanner.rs:435`, `use_case_scan.rs:239` and `kpi_scan.rs:497`
— **seven refusals whose English is an instruction to retry, inside a type that forbids it.**

`AppError::RateLimited(String)` exists, is classified `retryable = true`, carries the token
`"rate_limited"`, is mirrored on the frontend by `errorRegistry.ts:172`, and has **9 construction
sites** — the event limiter (`events.rs:77, :211`), the API proxy (`api_proxy.rs:314`), MCP tool
routing (`mcp_tools.rs:794`), GitHub (`github.rs:566`), the team-preset adopter
(`team_preset_adopter.rs:235, :631`), and the P2P messaging lane (`messaging.rs:153, :179`).
**Eight of the nine front somebody else's rate limit. Exactly one — `messaging.rs:179`, the inbox
persona-key cap — is a capacity gate on this app's own resource, and it is on the lane nobody
looks at.** The right type is in the tree, correctly wired end to end, and reaches one of this
app's ten capacity doors.

One lane is worse: `companion/session.rs:771` refuses a wake with
`AppError::Internal("fleet turn queue full; wake skipped")`, which routes through the *string*
classifier (`core/src/error.rs:135`) — so a capacity refusal's category is decided by whether the
words "queue full" happen to match a rate-limit regex. They do not.

### 0.3 — the durable record says "running" and the door has not been asked yet

Seven sites write the work's durable start-marker **before** calling the admission door.
`task_executor.rs:551-568` is the shortest:

```rust
// Mark task as running
let _ = repo::update_task(&state.db, &task_id, …, Some("running"), …, Some(Some(&now)), None);  // :553
let cancel_token = CancellationToken::new();
TASK_EXEC_JOBS.insert_running(task_id.clone(), cancel_token.clone(), TaskExecExtra)?;             // :568
```

If the door refuses, the `?` returns and **the row stays `running` with a `started_at` and a NULL
`completed_at`, forever.** The batch twin (`:735` write → `:750` door → `:754` bare `return`) and
the auto-run twin (`:1412` write → `:1427` door → `:1431` `return "failed"` without touching the
row) do the same thing with less recourse.

Measured on the live database:

| table | rows stranded `running` | since | age at composition |
|---|---:|---|---:|
| `dev_scans` | **4** | 2026-06-08 … 2026-06-11 | 66–69 days |
| `dev_tasks` | **2** | 2026-04-09 | **129 days** |

`idea_scanner.rs:441` carries the comment *"Resolve agents before creating any DB records to avoid
orphaned 'running' scans"* — the author reasoned about exactly this hazard, hoisted one thing above
the DB write, and left the admission door below it. Eighteen lines later
(`:459` → `:464`) the scan row is `running` and the door has still not been asked.

### 0.4 — the gates that work, and the honest caveat

Replayed as a sweep-line over every `[started_at, completed_at]` interval in `persona_executions`:

```
depth-at-start histogram   1:620  2:551  3:407  4:298  5:134  6:61  7:42  8:22  9:23  10:30
observed maximum simultaneous execution                                                = 10
personas with runs 59 · reached their own max_concurrent 50 · EXCEEDED it 0
persona max_concurrent values present: 1, 2, 4  (three distinct caps, none <= 0)
```

**Three different per-persona caps, 59 personas, 2,188 executions, zero violations, and a global
ceiling reached exactly 30 times and crossed never.** The persona lane's admission is real and it
holds. `GLOBAL_MAX_CONCURRENT = 4` (`queue.rs:10`) is not what holds it — `app_settings` contains 32
rows and **no `max_parallel_executions`**, so the runtime value is
`MAX_PARALLEL_EXECUTIONS_DEFAULT = 10`, and the const is what its own docstring calls *"only the
no-pool/test fallback"* (`settings_keys.rs:576`). Replaying `has_global_capacity` verbatim at each
arrival: at **10** the global gate holds **0 of 2,188**; at **4** it would have held **312 (14.3%)**;
at **1**, 1,568 (71.7%).

**The caveat, stated because the measurement invites the wrong reading:** the observed timeline is
the *output* of the gate, so it cannot prove by itself that the gate ever held anything. The
independent evidence that it did is the queue wait, which is only visible by subtracting two
columns:

```
created_at -> started_at   n=2188  p50 1.4s  p90 185s  p99 3,459s (58 min)  max 39,534s (11.0 h)
                           >60s: 362 arrivals (16.5%)
```

**362 executions waited more than a minute for a slot and one waited eleven hours.** The tracker
computes that number itself — `wait_ms` at `queue.rs:367-368` — logs it once, asserts it in a unit
test at `:686`, and **hands it to zero production consumers.** `persona_executions` has no
queue-wait column and `QueueStatusEvent` has no wait field (`engine/mod.rs:1762-1771`). The queue's
only performance number never leaves the module.

And the whole lane has admitted nothing since **2026-06-26**, 51 days ago — see
[`stall-watchdog`](./stall-watchdog.md), which owns that.

### 0.5 — three caps that are declared and never reach a decision

- **`TierConfig.max_queue_depth`** — `free: 5 / pro: 25 / enterprise: usize::MAX`
  (`engine/src/tier.rs:25,34,43`), exported to TypeScript via ts-rs, unit-tested at `:73,:81`, and
  rendered in the tier dashboard (`tier_usage.rs:106`). **`ConcurrencyTracker::set_max_queue_depth`
  (`queue.rs:129`) has zero callers in 963 files.** The tracker is always
  `DEFAULT_MAX_QUEUE_DEPTH = 10`. The free tier's declared cap of 5 is really 10; pro's 25 is really
  10. Its two siblings on the same struct — `event_source_max`, `webhook_trigger_max` — *are* wired
  into `RateLimiter::check` at four sites. **One struct, three limits, two enforced.**
- **`MAX_LIVE_SESSIONS`** — `AtomicU64::new(0)` and 0 means off (`fleet/stale.rs:151`). The default
  is not merely 0 at startup: `fleetSlice.ts:210-211` defaults `fleetLiveSlotsEnabled: false`, and
  `fleetSlice.ts:228` pushes `setLiveSlots(0)` **on every Fleet refresh**. The cap on the lane that
  spawns full `claude` processes with `--dangerously-skip-permissions` is switched off by a frontend
  boolean, and its only writer — `fleet_set_live_slots` (`fleet/commands.rs:254`) — takes a raw
  `u32` with **no clamp and no `require_auth`**, in a file whose neighbouring setter documents
  *"clamped server-side"*.
- **`has_capacity`'s "unlimited" branch** — `if max_concurrent <= 0 { return true }`
  (`queue.rs:215`). `core/src/validation/persona.rs:9-10` bounds the column to `1..=50`, and the
  live database holds only 1, 2 and 4. The branch is unreachable through a validated write and has
  never been taken.

### 0.6 — the four best gates in the app are the ones nobody calls a gate

Refusing to *produce* work because the review queue downstream is full. Replayed with each gate's
own SQL against all 14 live projects:

| project | pending ideas / cap 15 | proposed KPIs / cap 10 | proposed use cases / cap 12 |
|---|---:|---:|---:|
| `personas` | **22 → REFUSED** | 0 | 0 |
| `brainiac` | 0 | 0 | **12 → REFUSED** |
| `Medical Bill Negotiator` | 9 | 4 | 0 |
| the other 11 | ≤ 8 | ≤ 7 | ≤ 9 |

**Two of fourteen projects are behind a shut door right now**, and `brainiac` sits at exactly the
cap. These four gates (`idea_scanner.rs:434`, `kpi_scan.rs:496`, `use_case_scan.rs:238`,
`dispatch.rs:912`) refuse **before any row is written**, name the observed count, the cap and the
remedy — and are the only admission in the cohort of six repos that bounds the *backlog* rather than
the *concurrency*. Only `personas-cloud` has anything comparable.

---

## Principle (stack-free head)

Per the [portability test](../research/portability-test.md) the head carries no file path, primitive
name or count, so an adopting repo can tell physics from local calibration. Each clause names its
warrant.

> **P1 — physics, and the clause the rest depend on.** **An admission verdict is a classification,
> not a boolean and not an error.** Admit, defer, and refuse are three different outcomes and the
> caller must do three different things with them. A `bool` cannot carry the deferral; an error type
> cannot carry the position; and a door that returns nothing at all has decided on the caller's
> behalf without telling them.
> *Warrant: three of six codebases independently invented a closed enum for exactly this, and in all
> three it is the strongest code on the path.*
>
> **P2 — physics, and the most commonly inverted.** **"No room, come back" is a retryable
> condition and must not share a type with "your input was wrong."** Every caller that decides
> whether to retry, fail over, alert or degrade reads the type, not the sentence. If the type says
> the caller made a mistake, a perfectly-worded "try again later" changes nothing, because nothing
> downstream reads English.
> *Warrant: every repo that answers over HTTP separates 429 from 400 and gets this right; every repo
> that answers with an in-process error type gets it wrong somewhere. Two of the six have a typed
> retryable-refusal variant and use it exclusively for **other people's** rate limits.*
>
> **P3 — physics.** **The admission decision comes before the first durable trace of the work.**
> A record written before the door has been asked is a record that can outlive a refusal, and it
> outlives it in the one state nothing sweeps: *started*. Reversing the two lines costs nothing and
> is the entire fix.
> *Warrant: a convergent failure — three of six write the record first, and the one repo that is
> uniform about check-then-create is the one whose admission code the others' resembles least.*
>
> **P4 — physics.** **A refusal must carry the number that lets the caller come back**: seconds
> until retry, position in the queue, or remaining capacity. Otherwise "refused" and "broken" are
> the same event to everything downstream, and the caller's only strategy is to poll.
> *Warrant: four of six emit a retry-after somewhere and zero of six emit it everywhere; in two
> repos the door that emits it and the door that does not are in the same file.*
>
> **P5 — physics.** **The capacity check and the registration it protects are one operation.**
> A separate "is there room" followed by "take the room" is a race whose losers all believe they
> won, and its symptom is a cap that is exceeded by exactly the number of concurrent arrivals.
> *Warrant: two repos wrote the TOCTOU fix down in a comment beside the atomic version, and both
> wrote it after being bitten; both comments are the clearest admission code in their repo.*
>
> **P6 — physics.** **"Unlimited" and "off" are values of the type, never a degenerate number.**
> The moment zero means something, every reader re-spells the convention, they spell it differently,
> and the disagreement is invisible because each spelling is locally reasonable.
> *Warrant: zero of five sibling repos overload a degenerate integer for a capacity limit — they
> floor it (`max(1)`), validate it (`min(1)`), or make unlimited a variant. The one codebase that
> does overload it reads the same zero three incompatible ways in one binary.*
>
> **P7 — physics, and the one most systems never build.** **Bound the backlog you produce, not
> only the work you run.** A width limiter caps how fast you make work; nothing caps how much
> un-consumed work has piled up behind it. The most valuable refusal in an autonomous system is
> *"there are already more results waiting for a human than a human will read."*
> *Warrant: one of five siblings has it; a second has built every signal it would need and reads
> them from no gate; and the repo that has four such gates is the only one whose doors are observed
> shut on real data.*
>
> **P8 — ergonomics.** **A bound the caller supplies is not a bound.** If the parameter arrives from
> outside, clamp it at the door and say what the clamp is; a caller who can pass the item count has
> switched the limiter off without deleting it, and reviewers do not read arguments.
> *Warrant: two sibling commands in one file, same author, same concept, one clamped.*
>
> **P9 — ergonomics.** **Count the refusals durably, and record how long the admitted work waited.**
> A cap nobody ever hit and a cap that does not work look identical in the source; an in-memory
> counter that resets on restart is the same as no counter. And the queue wait is the only number
> that distinguishes "the limit is right" from "the limit is strangling you".
> *Warrant: two of five persist refusals — one as a counted row keyed by reason, one as both a
> metric and an audit row — and both are the repos whose operators can answer "is the cap too
> tight?" The others cannot, and neither can this one.*
>
> **P10 — product.** **A declared cap that no admission decision reads is not a cap.** Plan limits,
> tier limits and per-entity limits accumulate as *data* far faster than as *enforcement*, because
> declaring one is a schema change and enforcing one is a code change in someone else's module.
> *Warrant: three of six carry a concurrency limit that is stored, typed, rendered and never read by
> a gate; in one of them the gate lives in a different repository.*
>
> **Scale condition.** P1, P2, P3 and P6 are correctness on day one — they are wrong before any
> load. P5 bites the first time two requests arrive together. P4 and P8 bite the first time a
> caller other than your own UI exists. P7 bites the first time production outruns consumption,
> which for an autonomous system is immediately. P9 and P10 are what make the rest auditable, and P9
> is what makes them tunable.

---

## 1. Trigger

- "Should we let this run right now, or make it wait?"
- "What happens if the user hits Run twice?" / "Is this already running?"
- "How many of these can be in flight at once?" / "Add a concurrency limit."
- "The queue is backing up — we should stop accepting."
- "Free tier gets 5, pro gets 25."
- "Rate-limit this endpoint." / "Back off when the provider 429s."
- "Don't scan again, there are already thirty untriaged results."

**If you are about to write** `Semaphore::new(`, `if <live count> >= <CAP>`, an `AtomicU64` holding a
maximum, a `HashSet` of in-progress ids, `RateLimiter::check(`, `insert_running(`, `.admit(`, a
`max_*` parameter on an IPC command, or the words *"already running"* / *"try again later"* / *"at
capacity"* in an error string — **you are in this situation.**

You are **not** in this situation for a payload-size or string-length validation
(`value.len() > MAX_CONTENT_BYTES`) — that is [`command-input-validation`](./command-input-validation.md),
and 165 of the 177 `<count> >= <CAP>` sites in this tree are that. Do not "fix" them.

### Boundaries with the adjacent leaves

- [**`bounded-parallel-fan-out`**](./bounded-parallel-fan-out.md) owns **how wide one caller's burst
  is**. This path owns **whether that caller gets in at all**. The seam is
  `dev_tools_start_batch`: its `Semaphore` is that path's D1 (a width the caller can set to N); its
  `insert_running` 74 lines later is *this* path's D1 (an admission door behind a durable write).
  Two bounds, one function, neither aware of the other.
- [**`spend-ceilings`**](./spend-ceilings.md) owns **the dollar bound**. This path owns **the
  count bound**, and the two are the same decision taken twice: `executions.rs:353-365` (money) and
  `engine/mod.rs:884-887` (slots) are 530 lines apart in the same request. Its P1 — *"a limit's
  unconfigured value is a policy"* — is this path's P6 on the concurrency axis, and this repo
  answers the two questions in opposite directions (money: 0 = no ceiling; slots: 0 = also no
  ceiling, but the validator rejects 0 claiming it deadlocks — §7.C).
- [**`agent-dispatch`**](./agent-dispatch.md) owns **the surface that starts an agent and what it
  keeps**. Its D4 is the Fleet lane's missing admission, named from the dispatch side; this path
  measures the same lane from the gate side and adds who actually writes the zero (§7.E).
- [**`job-claim-and-lease`**](./job-claim-and-lease.md) owns **taking one row exclusively**. This
  path owns **whether a row should have been offered at all**. An `InflightGuard` answers "is this
  one mine"; `insert_running` answers "is anyone doing this one"; neither answers "is there room".
- [**`idempotent-invocation`**](./idempotent-invocation.md) owns **recognising the same request
  twice**. This path owns **refusing the second one when there is no room for it**. They are
  routinely confused: `insert_running`'s key is a job id, which makes it a de-duplicator that
  happens to be the only thing resembling a capacity gate on 23 lanes.
- [**`tier-and-capability-gating`**](./tier-and-capability-gating.md) owns **whether the plan
  includes the feature**. This path owns **how much of it the plan includes**, and §0.5 is what
  happens when the second question is answered in a struct nobody reads.
- [**`long-running-job-progress`**](./long-running-job-progress.md) owns **what the job reports once
  it is in**. Its `unswept-job-registry-read` rule and this path's rule land in three of the same
  four files and share zero lines: it counts a *read* that skips the stale sweep, this counts a
  *write* that precedes the door.
- [**`error-surfacing-policy`**](./error-surfacing-policy.md) owns **how a refusal is shown**. This
  path owns **what type it is**, which is upstream of that and is where §0.2 goes wrong.

## 2. The one way

**Ask the door before you write anything, make the answer a closed three-way classification, and
make "no room" a distinct, retryable error kind.** Concretely: (a) **the admission call is the first
statement that can fail after argument validation** — before the row, before the job registration,
before the warm session is taken out of the pool, before the prompt is assembled; a refusal must be
able to leave the system exactly as it found it, and the only way to guarantee that is to have
touched nothing yet. (b) **Return `Admitted | Deferred{position} | Refused{reason, retry_after}`,
never `bool` and never a bare `Result<(), Error>`** — the caller does three different things with
three different answers, and the deferral is the one that gets lost when the type has two states.
(c) **The check and the registration are one operation under one lock**: `try_add_running`, not
`has_capacity` then `add_running`; the insert under the write lock, not the early peek. The
non-atomic checker may exist for display, and must never be the gate. (d) **Make the refusal a
retryable kind** — in this repo, `AppError::RateLimited`, which the taxonomy already classifies
`retryable = true`; a capacity refusal shipped as `AppError::Validation` tells every automated
consumer that a human misconfigured something. (e) **Put the number in the refusal**: the seconds
until a slot frees, the position in the queue, or the remaining allowance — the webhook path
(`webhook.rs:341-358`) already does all three and it is 18 lines. (f) **Bound the backlog, not only
the width**: before producing more work, ask how much un-consumed output is already waiting, and
refuse with the count, the cap and the remedy — `idea_scanner.rs:434` is six lines. (g) **Never
accept the bound from the caller unclamped**; `.clamp(MIN, MAX)` at the door, and spell "unlimited"
as a variant of the type rather than as a zero. (h) **Persist the refusal and the wait**: one row or
one counter per refusal reason, and the milliseconds each admitted unit spent waiting — without them
you cannot answer "is this cap too tight", which is the only question anyone will ever ask about it.
Then stop: do not add a second cap beside the tracker's, do not queue what you could refuse, and do
not put the word "later" in a message whose type says never.

If you must get one right first: **(a)**. (b), (d) and (e) degrade the caller's experience; (a)
degrades the *database*, permanently, in a state nothing sweeps — six rows in this install have been
`running` for between 66 and 129 days because of it.

## 3. Mandated primitives

**Exist today — use them:**

| primitive | what it gives you |
| --- | --- |
| **`engine/src/queue.rs:253-309` — `ConcurrencyTracker::admit(persona, exec, max_concurrent, priority) -> AdmitResult`** | **The type this leaf wants, already written.** Four independent gates evaluated together (`:264-267`: per-entity capacity, global capacity, provider quota cooldown, host resource pressure), a closed three-variant answer, priority-ordered insertion (`:302-306`), and backpressure at a declared depth. Copy the **shape** even when you cannot reuse the struct. |
| **`engine/src/queue.rs:235-246` — `try_add_running`** | **P5 in eleven lines**, with the reason in the docstring: *"This prevents TOCTOU races between `has_capacity` and `add_running`."* The non-atomic `has_capacity` (`:214`) is kept for display only. When you have both, the atomic one is the gate. |
| **`engine/src/p2p/connection.rs:268-340`** | **The best admission site in the tree.** The capacity test is *inside* the write lock with the reason stated (*"Net-new insert under the write lock — enforce max_peers atomically so concurrent connects can't all pass the early check and overshoot"*, `:324-325`), it increments a **durable counter** (`connections_rejected_capacity`, `:326-328`), it closes the transport with a reason code, and the refusal names the cap **and the remedy** (*"Disconnect a peer first"*). Atomic + counted + actionable, in one function. |
| **`engine/src/rate_limiter.rs:50-130` — `RateLimiter::check(key, max, window) -> Result<(), u64>`** | **The refusal that carries its own answer**: the `Err` is the seconds until the oldest entry in the window expires, computed from the real bucket (`:68-72`), never a flat constant. Also the only door in the tree that logs the **crossing** rather than the level (`bucket.warned`, `:78-88`) and that reserves the token *at* the check, so there is no window between deciding and consuming. |
| **`src/engine/webhook.rs:330-360`** | **What a refused caller should be told**, in 18 lines: HTTP **429**, the cap, the window and the retry-after, all in the body. The one path in this app that answers a capacity refusal the way the whole cohort answers it. |
| **`src/commands/infrastructure/idea_scanner.rs:410-440`** | **P7, implemented.** Archive what has gone stale, count what is pending, and refuse the whole round above the cap with the count, the cap and the remedy — *"Triage / promote the existing backlog first"* — **before any row is created**. Its siblings `kpi_scan.rs:471-500` (per-project **and** per-context caps, so one untriaged context cannot block a sweep across 200) and `use_case_scan.rs:230-244` are the same move. |
| **`src/engine/resource_governor.rs`** | **Admission driven by the host, with hysteresis and the asymmetry argued** (`:12-16`: 70% CPU pauses, 55% resumes; 85% RAM pauses, 70% resumes, *"because the OOM kill happens near ~95%"*). Running work is never interrupted; only new admissions defer. Pair it with `ConcurrencyTracker::set_resource_throttled`. |
| **`src/background_job.rs:230-255` — `insert_running`** | The atomic *mutual-exclusion* door for a named job: evicts stale entries, then refuses a duplicate under one lock. Use it — and read §7.A and §8.2 first, because its `Err` also means "the mutex was poisoned" and its refusal is typed non-retryable. |
| **`src/commands/companion/approvals/approval_exec_knowledge.rs:464, :690-694`** | **Bound by refusal, not by queueing**, with the constant's comment naming the resource: *"they share one checkout; four writers on the same files is the 2026-05-09 incident with extra steps."* The strongest concurrency comment in the tree. |
| **`core/src/error.rs:115` + `engine/src/tool_outcome.rs:108` — `AppError::RateLimited`** | **The retryable refusal kind, already wired end to end**: `ErrorCategory::RateLimit`, `kind: "rate_limited"`, `retryable = true`, mirrored on the TypeScript side by `errorRegistry.ts:172`. Every capacity refusal in this app should be this and eight of them are not. |

**Explicitly NOT primitives.** `ConcurrencyTracker::set_max_queue_depth` (`queue.rs:129`) has zero
callers, so `TierConfig.max_queue_depth` is inert (§7.D). `free_slot_for_spawn`
(`fleet/stale.rs:1393`) is an **eviction**, not an admission — it returns `()` and the spawn proceeds
whether or not it freed anything. `has_capacity` / `has_global_capacity` / `quota_available` /
`resource_available` are display accessors; reaching for one of them as a gate is the TOCTOU
`try_add_running` exists to prevent.

## 4. Steps

1. **Name the resource you are protecting, and write it in the constant's comment.** A concurrency
   cap is a hypothesis about a connection pool, a checkout, an API rate limit or a machine.
   `APPLY_MAX_CONCURRENT_PER_REPO = 4` with *"they share one checkout"* can be re-tuned by the next
   person; `= 4` alone cannot.
2. **Decide what you are bounding: in-flight work, or the backlog it produces.** They are different
   caps with different failure modes and an autonomous system needs both. Ask "what happens if
   nobody consumes the output?" — if the answer is "we keep producing", you need P7.
3. **Write the door as a function returning a closed classification.** Three variants minimum —
   admitted, deferred (with a position or an ETA), refused (with a reason and a retry-after). Do
   this before you write the caller; a `bool` written first is never widened later.
4. **Make the check and the registration one operation.** One lock, one transaction, or one
   conditional write. If you find yourself writing `if has_room() { take_room() }`, you have written
   a race; the fix is a single `try_take() -> bool`-shaped call at minimum, and a classification at
   best.
5. **Call the door before anything else that persists.** Before `create_*`, before
   `update(status='running')`, before taking a warm session out of a pool, before assembling the
   prompt. A refusal must be a no-op on the world. **This is the step the census rule in §9 counts.**
6. **Clamp anything the caller supplied.** `.clamp(MIN, MAX)`, and reject rather than silently
   substitute when the value is nonsense. Zero is not a clamp target — see step 7.
7. **Spell "unlimited" and "off" as variants, not as zero.** `enum Cap { Unlimited, Max(NonZeroUsize) }`
   or, if that is too much, a `usize::MAX` sentinel that cannot be confused with "off"
   (`tier.rs:43` already does this and it is the safest spelling in the repo). Then delete the
   `== 0` branches; there is nothing left for them to mean.
8. **Type the refusal as retryable.** In this repo: `AppError::RateLimited`. Everything downstream —
   the failover decision, the tool-outcome audit row, the frontend's suggestion text — reads the
   type. Then put the number in the message: seconds, position, or remaining.
9. **Record the refusal and the wait.** One durable counter or row per refusal *reason*, and the
   milliseconds each admitted unit waited. `wait_ms` is already computed at `queue.rs:367`; give it
   a column.
10. **Write the query that counts refusals, and run it.** If the answer is zero and the feature has
    shipped, either the cap is unreachable (fix the branch) or it is switched off (fix the default).
    Both are true here.
11. **And then stop.** Do not add a second cap beside the tracker's, do not queue what you can
    refuse, do not evict when you meant to refuse, and do not re-derive the money bound —
    [`spend-ceilings`](./spend-ceilings.md) owns it.

### Can the type make the wrong call impossible? — asked before §9

**On the verdict, yes, and the repo has already written it once.** `AdmitResult` makes
*"admitted", "deferred" and "refused"* the only representable answers, and a caller cannot
accidentally treat a deferral as a start — there is no `bool` to misread. Held against the seven
qualifications: **Q1** holds (it encodes exactly the outcome and nothing about *why*, which is why
`QueueFull` carries `max_depth`). **Q3** is the live objection and it is severe: **one call site in
963 files.** So this is a proposal to *lift* a type, not to write one — and the lift is real work,
because `insert_running`'s 22 callers each want a different second variant.

**On the refusal's kind, yes, and it is a one-line change per site.** `AppError::RateLimited` is the
existing retryable variant; eight capacity refusals use `AppError::Validation` instead. Nothing has
to be designed. Per the contract's *"prefer fixing the default over counting the callers"*, the
sharper move is at `background_job.rs:222,:240`: change the two `AppError::Validation("Job is
already running")` literals to `AppError::RateLimited`, and **22 call sites become correctly
retryable in one edit**, with no caller touched. That single edit is worth more than the gate.

**On the ordering — no, and that is the finding.** The bad state is *"a durable row says the work
started and the door has not answered"*, and no signature reaches it: the row write and the door are
two independent calls in one function body, and Rust has no way to say "this call must precede that
one". **Q7 applies exactly** — the caller supplies the bad ordering voluntarily; there is no
dangerous argument to withhold. Withholding the *construction* would mean a combinator
(`admit_then(|| create_scan(…))`) that owns both halves, which is a real design and a large one.
Until it exists, **the ordering is where a census rule genuinely earns its place**, and §9 gates it.

**On the degenerate zero — partly.** `NonZeroUsize` would make `Semaphore::new(0)` unrepresentable
and is free at three of the seven `Semaphore::new` sites. It does **not** reach
`MAX_LIVE_SESSIONS`, which is an `AtomicU64` (no atomic `NonZero`), nor `global_max_concurrent`,
which is a plain field mutated by a `pub fn`. Doctrine's *"where types cannot reach"* case 2 —
through a global — applies verbatim.

## 5. Anti-patterns

| Anti-pattern | Failure mode |
|---|---|
| **A durable `status='running'` write before the admission door** | A refusal strands the row in the one state nothing sweeps. **7 sites; 6 live rows stranded 66–129 days.** §7.B. |
| **A capacity refusal typed as a validation error** | Every automated consumer reads it as "the caller misconfigured something, do not retry" — including this app's own `classify_app_error`, which returns `retryable = false`. **10 of the app's 11 capacity refusals, seven of which say some form of "try again later" in English.** §7.A. |
| **`-> bool` for an admission door** | The deferral has nowhere to go, so it becomes a refusal or a silent start. `try_start_healing` returns `bool`; `free_slot_for_spawn` returns `()` and the spawn proceeds either way. |
| **`Err` that means both "no room" and "the mutex was poisoned"** | `insert_running` returns `AppError::Validation` for the first and `AppError::Internal` for the second, and 19 of 22 callers write `?`. A poisoned lock and a duplicate press are one outcome to every one of them. |
| **`has_capacity()` then `add_running()`** | The classic TOCTOU: every concurrent arrival sees room and takes it. The repo's own `try_add_running` docstring names this, and `connection.rs:324` names it again — both were written after the fact. |
| **A cap whose "off" value is `0`** | Zero already means five things in this binary and this leaf adds two more readings on one axis: the tracker says *unlimited* (`queue.rs:157`), the settings validator says *deadlock* (`settings_keys.rs:583`), and the overnight engine says *substitute 4* (`overnight.rs:143`). §7.C. |
| **A tier limit with no consumer** | `TierConfig.max_queue_depth` is declared, typed, exported to TS, unit-tested, rendered — and `set_max_queue_depth` has **zero callers**. The free tier's "5" is 10. §7.D. |
| **Evicting instead of refusing, and calling it a cap** | `free_slot_for_spawn` hibernates one idle session if it can, then lets the spawn through regardless. That is a *preference*, not a limit — and the lane it governs starts CLI agents with permissions suppressed. §7.E. |
| **A refusal with no retry-after and no position** | "Try again later" is a poll instruction. The webhook path 200 lines away returns 429 + the exact seconds. |
| **A refusal counter in memory** | `SchedulerState.queue_rejections` is an `AtomicU64` that resets on every restart, is exported to TypeScript as `SchedulerStats.queueRejections`, and has **0 render sites in 4,829 files**. §7.F. |
| **Emitting the refusal on an unregistered event name** | `app.emit("queue-backpressure", …)` (`engine/mod.rs:960`) is a raw string, absent from `core/src/events.rs` and from `src/lib/eventRegistry.ts`, with **zero listeners**. The one broadcast of a refusal reaches nobody. |
| **Measuring the queue wait and discarding it** | `wait_ms` is computed at `queue.rs:367`, logged once, asserted in a test, and consumed nowhere. The longest real wait in this install is **11.0 hours** and it is recoverable only by subtracting two columns. |
| **Taking the bound from the caller** | `dev_tools_start_batch(max_parallel)` has no clamp; `fleet_set_live_slots(max_live)` has no clamp and no `require_auth`. Their clamped siblings are in the same files. |

## 6. Evidence

**The one site to copy: `src-tauri/engine/src/p2p/connection.rs:268-340` — the net-new insert.**

```rust
} else if conns.len() >= self.max_peers {
    // Net-new insert under the write lock — enforce max_peers atomically
    // so concurrent connects can't all pass the early check and overshoot.
    self.metrics.connections_rejected_capacity.fetch_add(1, Ordering::Relaxed);
    new_conn.quinn_conn.close(quinn::VarInt::from_u32(1), b"capacity exceeded");
    return Err(AppError::Validation(format!(
        "Connection limit reached ({} peers). Disconnect a peer first.",
        self.max_peers
    )));
}
conns.insert(peer_id.to_string(), new_conn);
```

Five decisions worth copying: (1) the capacity test is **inside the write lock that performs the
insert**, so there is no window — and the comment says why, which is how you know it was earned;
(2) the refusal **increments a durable counter**, so "we refused" is a number and not a log line;
(3) the transport is closed with a reason code, so the *other side* also learns why; (4) the message
names the cap **and the remedy**; (5) there is a deliberate non-atomic peek (`:201`) kept for
display, and it is never the gate. The one thing to change when you copy it: the error kind
should be `AppError::RateLimited` (§0.2).

**Also exemplary:**

- **`engine/src/queue.rs:253-309` — `admit`.** Four gates in one expression, a closed three-way
  answer, priority insertion, and — the part usually missing — a `tracing::debug!` at `:274-280`
  that distinguishes *held by quota* from *held by resource pressure*, so a deferral is diagnosable.
  Its `drain_next_global` (`:393-443`) then re-asks all four gates before promoting anything, which
  is the half most queue implementations forget.
- **`engine/src/rate_limiter.rs:50-130`.** Reserve-at-check (the timestamp is pushed in the same
  lock that decided), a retry-after computed from the oldest live entry, a warn latch that signals
  the crossing rather than the level, and an auto-prune that keeps the bucket map bounded. Its
  degenerate case is even tested: `test_zero_max_events_does_not_panic` (`:236`).
- **`src/commands/infrastructure/idea_scanner.rs:410-440` + `kpi_scan.rs:471-500` +
  `use_case_scan.rs:230-244`.** Backlog admission, refusing before any write, naming count / cap /
  remedy. `kpi_scan` goes furthest with a per-context cap *and* a per-project cap so one untriaged
  context cannot block a sweep across the rest — the only two-scope admission in the tree.
- **`src/commands/infrastructure/task_executor.rs:1481, :1495-1502`.** The **one** site in 963 files
  where the admission door comes first and the durable ledger row second, with the comment saying
  why the ordering is safe (*"Best-effort: bookkeeping must never abort the run"*). It is also the
  only one of the three `max_parallel` doors that clamps (`.clamp(1, 8)`).
- **`src/engine/webhook.rs:330-360`.** 429 + cap + window + retry-after. Copy this whenever a
  refusal crosses a process boundary.

### Convergence — 5 sibling repos

Swept read-only against `../personas-web` (`7d0c81d`), `../brainiac` (`990f09a`),
`../personas-cloud` (`6ac8775`), `../vibeman` (`68bc5a28`), `../ascent` (`ec2891d`). **All five
exist and all five were opened.**

| # | clause | verdict | evidence |
| --- | --- | --- | --- |
| 1 | **The verdict is a closed classification (P1)** | **PHYSICS (3/6), independently invented** | `ascent` `plans.ts:117` `type ScanCharge = "unlimited" \| "allowance" \| "credit" \| "denied"` — admission *and* how it is paid for, in one type; plus `QuotaResult{enforced, allowed, remaining, retryAfterSec, resetAt}` (`public-scan-quota.ts:171-185`) whose `enforced` is a **third state** meaning "the gate is not active", deliberately not folded into `allowed`. `personas-cloud` `eventProcessor.ts:470-476` `DispatchResult = dispatched \| duplicate \| concurrency_blocked{running,maxConcurrent} \| persona_not_found \| queue_full \| error` — **the only type in the cohort that separates defer from refuse and carries the numbers that caused it.** Personas' `AdmitResult` is the third. In all three it is the best code on the path. |
| 2 | **…and the same repo also has a bool/`()` door** | **PHYSICS (4/5) as a FAILURE** | `personas-cloud` `Dispatcher.submit(): boolean` (`dispatcher.ts:1196`) sits above the typed `DispatchResult`. `vibeman` is the extreme: `cli-service.ts:1063-1074` gates a spawn with an `if` whose **both branches return the same `executionId`**, so the caller cannot tell whether the work started or was deferred. `personas-web` `isRateLimited(): boolean` (`rate-limit.ts:31`) holds `resetAt` in the bucket and returns none of it. `brainiac`'s breaker is `fn check(&self) -> Result<()>` whose two distinct refusals — open vs half-open-probe-taken — are separable **only by matching message text** (`resilience.rs:134, :142`). |
| 3 | **Admission before the first durable write (P3)** | **CONVERGENT FAILURE (3/6)** | `ascent` is the counter-example and is uniform: rate limit → entitlement → atomic reservation → work → `cacheAndPersistScan` **last** (`api/scan/route.ts:145,168,179,265`). `personas-cloud`'s event path writes `db.recordEventDispatch` at `eventProcessor.ts:536` **before** `dispatcher.submit` at `:542`, so a `queue_full` leaves a dispatch row for an execution that never ran — **the same defect as §7.B, in a different language.** `vibeman` registers the execution in `activeExecutions` (`cli-service.ts:610`) before the gate at `:1063`. |
| 4 | **The refusal carries a retry-after / position / remaining (P4)** | **PHYSICS (4/6), and NOBODY does it everywhere** | `ascent` is best: 429 + `retry-after` + `x-ascent-quota-remaining` + `-scope` + `-reset`, with the limit **derived from the scope that actually tripped** (`public-scan-quota.ts:375-400`), and 402 + `INSUFFICIENT_CREDITS` + balance (`entitlement.ts:71-80`). But **every repo has a door next to it that omits it**: `personas-cloud` sets `Retry-After` on the IP limiter (`httpApi.ts:1134`) and not on the four queue-full 429s one screen away (`:1352,1639,1847,1905`), *while `getQueueLength()` exists*; `brainiac`'s breaker holds `until` at `resilience.rs:129` and never emits it; `personas-web` sends a **flat 60 s** on three routes and nothing on three others. Personas matches exactly: `webhook.rs:356` emits it, `engine/mod.rs:969` does not. |
| 5 | **Degenerate `0`/`null` overloaded for a capacity limit (P6)** | **SILENT (0/5) — Personas-only, second sighting** | `brainiac` floors everywhere (`worker.rs:73,:171` `.max(1)`, `resilience.rs:108,:111`). `vibeman` `Math.max(1, readInt(…) ?? 1)` (`envConfig.ts:336`). `personas-cloud` `.int().min(1).max(100)` (`schemas.ts:114`). `personas-web` uses positive literals only. `ascent` uses `null` **inside the type** and branches `allowance == null` (`entitlement.ts:63`), and treats a non-positive env value as *"use the default, never 0"* (`rate-limit.ts:118-121`). **In four of the five, "unlimited" is not expressible at all — and that is presented as a feature.** [`bounded-parallel-fan-out`](./bounded-parallel-fan-out.md) §6 clause 10 found the same silence on the fan-out axis; this is the independent confirmation on the admission axis, with a wider vocabulary. |
| 6 | **The check and the registration are atomic (P5)** | **MINORITY (2/5), and both wrote the reason down** | `ascent` runs the read-decide-write in **one interactive transaction at `Serializable`** with an explicitly documented fail-open policy (`public-scan-quota.ts:40-44, :215, :253`). `vibeman` re-decides **inside the insert** via `createIfNoActiveScan` and 409s if it returns null (`api/group-health-scan/route.ts:137-146`) — an explicit TOCTOU fix. `personas-cloud` reads and writes separately; `brainiac` and `personas-web` have nothing to race. Personas has **two** atomic doors (`try_add_running`, `connection.rs:323`) and one comment explaining each, which puts it at the top of this clause. |
| 7 | **Backlog-saturation admission (P7)** | **MINORITY (1/5) — and Personas is AHEAD of the cohort** | `personas-cloud` `MAX_QUEUE_DEPTH = 500` refuses new submissions because the *un-dispatched* queue is full (`dispatcher.ts:28, :1202-1210`), genuinely distinct from its worker-slot bound. `brainiac` is the instructive near-miss: `QueueHealth{ready, in_flight}` (`queue.rs:251-254`), `depth()` (`:238`), `dead_letters_count()` (`:358`) — **every signal built, read by no gate.** `ascent`, `vibeman`, `personas-web`: absent. **Personas has four such gates and two are observed shut on live data.** |
| 8 | **Refusals counted durably (P9)** | **MINORITY (2/5), with strong exemplars** | `ascent` upserts a `QuotaEvent` row keyed `(kind, scope)` with `count` + `lastSeen`, kinds `"quota_deny" \| "rate_limit"`, read back on the public usage view (`db/quota-events.ts:10-22, :34`). `personas-cloud` does **both**: a Prometheus `orchestrator_executions_rejected_total` (`metrics.ts:147,312`) and a durable audit row `action:'dispatch_concurrency_blocked'` with `detail:{reason, running, maxConcurrent}` (`eventProcessor.ts:236-242`). `vibeman` logs only and explicitly sets `logError: false` on its 429 (`rateLimiter.ts:191`). `personas-web` does nothing. **Personas has one in-memory counter with zero readers and one uncounted metric on the P2P lane — worse than the median.** |
| 9 | **A declared per-entity/tier cap that no gate reads (P10)** | **CONVERGENT FAILURE (3/6)** | `personas-web` is the textbook case: `maxConcurrent` typed (`types.ts:15`), mapped from Postgres (`supabaseApi.ts:133`), **rendered read-only** (`AgentMetrics.tsx:47`), and read by no gate — the gate is in a *different repository*. It is even marketed: the mock dashboard ships the copy *"Raise maxConcurrent for CodeReviewer"* (`mock-dashboard-data.ts:1461`). `personas-cloud` is half-wired: `persona.maxConcurrent` is enforced on the event path (`eventProcessor.ts:505`) and **bypassed by all four direct HTTP execute routes**, which call `submit()` and check only the queue depth. Personas' `TierConfig.max_queue_depth` is the third. |
| 10 | **Reserve-then-settle (a lease over the admitted unit)** | **MINORITY (1/5), and it is that repo's doctrine** | `ascent` `claimRepoScan`/`releaseRepoScan` with the release in a `finally` (`api/org/scan/route.ts:10,122,181-183`), and a **value-keyed refund**: `QuotaResult.chargedAt` is handed back to `refundPublicScanQuota(…, chargedAt)` which removes *that exact* slot, with the doc explaining that the old "drop the newest hit" fallback let two concurrent refunds each peel a different sibling's live slot (`public-scan-quota.ts:180-184, :312, :328-335`). Nothing in Personas reserves. Adopt as a proposal, not doctrine. |
| 11 | **Admission decisions are unit-tested as pure functions** | **MINORITY (2/5) — worth codifying** | `ascent`'s `decideQuota` / `windowState` / `decideScanCharge` are DB-free and tested, including a contract-driven `it.each(unlimitedPlans)` (`credits.test.ts:417`). `brainiac` pins `half_open_admits_exactly_one_probe` (`resilience.rs:290`). `vibeman` asserts its gate against the constant (`cli-service.concurrency.test.ts:62-68`). Personas' `queue.rs` has 25 admission tests including `QueueFull` and priority ordering — top of the cohort — **and zero for the ordering condition in §7.B.** |

**Physics — keep as doctrine:** clauses 1, 2-as-a-failure, 3, 4, 6, 8, 9.
**Reported as silence:** clause 5 (**nobody else overloads a degenerate integer for a capacity
limit** — this is Personas-local calibration, and the second independent sighting of the same
silence). **Personas ahead of the cohort:** clause 7 (backlog admission, 4 gates vs the cohort's 1)
and clause 6 (two atomic doors, both with the reasoning written down).

> **The strongest external result is clause 3, and it is a warning about *where* not *what*.**
> `personas-cloud` commits the identical create-then-check defect on its event path in TypeScript
> against Postgres, with an idempotency row instead of a status column. Two teams, two stacks, one
> ordering mistake — and in both cases the *other* path in the same repo gets it right. That is the
> signature of a condition no reviewer sees: both orderings read as correct in isolation, and only
> the refusal branch, which nobody exercises, tells them apart.

> **And one counter-example that keeps the head honest.** `brainiac` has **no work-start admission
> door at all** — `queue::send` (`queue.rs:64`) enqueues unconditionally, and the budget is applied
> at *claim* time via `queue::read(…, cfg.batch)` + `.buffer_unordered(concurrency)`
> (`worker.rs:170,183`). That is a legitimate architecture: admission moves from the producer to the
> consumer, and the durable queue absorbs the difference. A doctrine written only in terms of
> producer-side gates would score it 0/0 and learn nothing — while its `SkillProposeOutcome`
> (`skills.rs:285`) is one of the two best verdict types in the cohort, and its
> size-check-before-charging-the-hour (`:341-363`, *"an oversized proposal is refused, not charged
> against the author's hour"*) is a P3 refinement nobody else has.

## 7. Deviations

Every entry is live on `master` @ `95555f875` and was verified by reading the file, by replay, or
against a read-only copy of the operator's database.

### 7.A — Ten of the app's eleven capacity refusals are typed as the caller's mistake

`AppError::Validation` → `(ToolErrorKind::Misconfigured, None, retryable = false)`
(`engine/src/tool_outcome.rs:113`) and `ErrorCategory::Validation` (`core/src/error.rs:123`).
`AppError::RateLimited` → `retryable = true` (`tool_outcome.rs:108`).

| refusal | site | type today | English |
|---|---|---|---|
| execution queue full | `engine/mod.rs:969` | `Validation` | *"Try again later."* |
| a background job is already running | `background_job.rs:222, :240` (**22 call sites**) | `Validation` | *"Job is already running"* |
| apply sessions at cap for this repo | `approval_exec_knowledge.rs:691` | `Validation` | *"wait for one to settle"* |
| share-link store full | `share_link.rs:122` | `Validation` | *"Wait for existing links to expire"* |
| peer limit reached (outgoing / incoming) | `p2p/connection.rs:332` · `:543` | `Validation` | *"Disconnect a peer first"* |
| idea / KPI / use-case backlog saturated | `idea_scanner.rs:435`, `kpi_scan.rs:497`, `use_case_scan.rs:239` | `Validation` | *"Triage / promote… first"* |
| fleet turn queue full | `companion/session.rs:771` | **`Internal`** | *"wake skipped"* |
| intervention cap | `operative_memory.rs:839` | **`String`** | *"cap reached"* |
| **inbox persona-key cap** | **`p2p/messaging.rs:179`** | **`RateLimited`** ✓ | *"Inbox persona-key capacity exceeded"* |

**Eleven capacity refusals, four type families, and exactly one correct** — and the correct one is
on the P2P lane, three lines below a *payload-size* check in the same function that is correctly
`Validation`. Whoever wrote `messaging.rs` distinguished "your message is too big" from "we are
full" at the type level, in one function, and no other file in the tree does.

`session.rs:771` is the worst: `Internal` runs through the *string* classifier
(`core/src/error.rs:135`), so a capacity refusal's category is decided by whether the words "queue
full" match a rate-limit regex. They do not, so it resolves through a fallback ladder.

**Fix:** change the two literals in `background_job.rs:222,:240` to `AppError::RateLimited` — 22 call
sites become correct with no caller touched — then the nine remaining sites, one line each.

### 7.B — Seven sites write the durable start-marker before asking the door

Gated by the census rule in §9; all seven opened and confirmed.

| site | the write | the door | what a refusal leaves behind |
|---|---|---|---|
| `task_executor.rs:553` → `:568` | `update_task(status='running', started_at=now)` | `insert_running(…)?` | a `dev_tasks` row `running` forever |
| `task_executor.rs:735` → `:750` | same | `if …insert_running(…).is_err() { return }` | same, and the batch reports nothing |
| `task_executor.rs:1412` → `:1427` | same | `… .is_err() { return "failed" }` | same; the string is not written to the row |
| `idea_scanner.rs:459` → `:464` | `create_scan(…, Some("running"))?` | `insert_running(…)?` | a `dev_scans` row `running` forever |
| `idea_scanner.rs:1297` → `:1300` | same | same | same |
| `kpi_scan.rs:528` → `:531` | same | same | same |
| `use_case_scan.rs:252` → `:255` | same | same | same |

**Live consequence, from the read-only copy:** `dev_scans` holds **4** rows `running` since
2026-06-08…06-11 (66–69 days); `dev_tasks` holds **2** since 2026-04-09 (**129 days**). The
`dev_tasks` pair is also [`agent-dispatch`](./agent-dispatch.md) D6, which attributed them to the
settle paths; this is a **second, independent** mechanism that produces the same rows, and it is the
one that produces them without the work ever having started.

The compliant ordering exists once, in the same file:
`dev_tools_start_auto_run` (`task_executor.rs:1495` door → `:1500` durable ledger row), with the
reasoning in a comment. **Same file, same author, same concept, one ordered correctly.**

**Fix:** move the door above the write at all seven sites. Zero-line-count change; the diff is two
statements swapping places.

### 7.C — `0` means four incompatible things on this one axis, and the validator is wrong about the code it guards

| site | reads a `0` global/live cap as |
|---|---|
| `engine/src/queue.rs:157` | **unlimited** — `global_max_concurrent == 0 \|\| total_running() < …` |
| `db/src/settings_keys.rs:583-584` | **deadlock** — *"0 would deadlock the queue (nothing could ever admit), so the floor is 1"*, and `validate_value(MAX_PARALLEL_EXECUTIONS, "0")` is `Err` (tested at `:1344`) |
| `src/commands/infrastructure/overnight.rs:143` | **substitute 4** — `if live_slot_cap == 0 { FALLBACK_NIGHT_LIVE_CAP }` |
| `src/commands/fleet/stale.rs:1395` | **off** — `if cap == 0 { return; }` |

The settings docstring is simply wrong about the code it guards: at `global_max_concurrent == 0`,
`has_global_capacity` returns `true` unconditionally, so nothing deadlocks and everything admits.
**The validator refuses the value that means "unlimited" in order to prevent a deadlock that cannot
occur** — and the field is also settable at runtime through `set_global_max_concurrent`
(`engine/mod.rs:577`), which does not go through the validator.

This extends [`bounded-parallel-fan-out`](./bounded-parallel-fan-out.md) §12.4's five meanings of
zero to **seven**, and the oracle (clause 5) confirms that **no sibling repo overloads a degenerate
integer for a capacity limit at all**.

**Fix:** `enum Cap { Unlimited, Max(NonZeroUsize) }` on the tracker, and delete the `== 0` branches.
Correct the `settings_keys.rs` docstring in the same change whichever way you go.

### 7.D — `TierConfig.max_queue_depth` reaches no decision

`engine/src/tier.rs` declares `max_queue_depth` at `:16` and sets it to `5 / 25 / usize::MAX` at
`:25, :34, :43`. It is `#[derive(TS)] #[ts(export)]`, unit-tested (`:73, :81`), surfaced through
`get_tier_usage` (`tier_usage.rs:106`) — and **`ConcurrencyTracker::set_max_queue_depth`
(`queue.rs:129`) has zero callers in 963 files.** The tracker is always `DEFAULT_MAX_QUEUE_DEPTH = 10`.

So the free tier's declared 5 is really 10 (2× looser) and pro's 25 is really 10 (2.5× tighter).
The struct's two other limits *are* wired: `event_source_max` at `events.rs:75, :209` and
`smee_relay.rs:529`, `webhook_trigger_max` at `webhook.rs:341`. **One struct, three limits, two
enforced** — and `TierConfig::from_plan` has zero call sites outside its own tests
(`lib.rs:1135` constructs `default()` = `free()`), which [`spend-ceilings`](./spend-ceilings.md)
§7.D already recorded from the money side.

`tier_usage.rs:106` reports `tracker.max_queue_depth()` — the *real* 10 — beside `tier` — the
*declared* 5. The dashboard shows both numbers and does not reconcile them.

**Fix:** call `set_max_queue_depth(tier.max_queue_depth)` wherever `tier_config` is set, or delete
the field. Either is honest; shipping both numbers is not.

### 7.E — The Fleet cap is an eviction, its default is pushed from the frontend, and its setter is unguarded

`fleet/stale.rs:151` `static MAX_LIVE_SESSIONS: AtomicU64 = AtomicU64::new(0)`, where 0 = off.
[`agent-dispatch`](./agent-dispatch.md) D4 established that `free_slot_for_spawn`
(`stale.rs:1393-1415`) hibernates one idle candidate and *"the spawn proceeds anyway — soft cap"*.
Three things that path did not have:

1. **The zero is not merely the startup default — it is written continuously.** `fleetSlice.ts:210`
   defaults `fleetLiveSlotsEnabled: false`, and `fleetSlice.ts:228` calls
   `setLiveSlots(enabled ? max : 0)` **on every Fleet refresh**. The cap is re-zeroed by the UI on a
   schedule. When enabled, the frontend's default is 10.
2. **The setter takes an unclamped `u32` and has no `require_auth`** (`fleet/commands.rs:254`), and
   returns `Result<(), String>`. Its neighbour `fleet_set_state_cutoffs` documents *"clamped
   server-side"*; this one is not. It is the only writer of the only cap on the lane that spawns
   `claude` with `--dangerously-skip-permissions`.
3. **It is an eviction, not an admission.** It returns `()`. There is no verdict, so no caller can
   distinguish "there was room", "we made room" and "we could not make room and let you in anyway" —
   three outcomes, zero bits.

`overnight.rs:143` is the one consumer that treats the zero as a *number* rather than as *off*
(`FALLBACK_NIGHT_LIVE_CAP = 4`), which is the correct instinct applied in the one place that is not
the gate.

**Fix:** a non-zero default; `.clamp(1, N)` on the setter; and a `-> SlotVerdict` so the spawn path
can tell the three cases apart.

### 7.F — The refusal counter has no reader, and the refusal event has no listener

- `SchedulerState.queue_rejections` — an `AtomicU64` (`background.rs:106, :163`), incremented at
  `engine/mod.rs:958`, surfaced through `SchedulerStats.queueRejections`
  (`background.rs:426`, bound in `src/lib/bindings/SchedulerStats.ts`). **Render sites in 4,829
  `.ts`/`.tsx` files: 0.** It also resets to zero on every app start.
- `app.emit("queue-backpressure", …)` (`engine/mod.rs:960`) is a **raw string**, absent from
  `core/src/events.rs`'s `event_name` table and from `src/lib/eventRegistry.ts`. **Listeners: 0.**
  Its payload additionally mislabels its own data: the field named `"running"` is
  `persona.max_concurrent` — the *cap*, not the count.
- The same mislabelling reaches the user: `"…({} queued, {} running)"` is formatted with
  `max_depth` and `persona.max_concurrent`, **both of which are limits**. A persona with one
  execution running is told "1 running" only because its cap happens to be 1.

`p2p/connection.rs:326` is the counter-example: `connections_rejected_capacity` is a real per-reason
counter on the one lane nobody looks at.

**Fix:** a `queue_rejections` panel row (the data already crosses the FFI), the event name in the
registry, and `running` replaced with `tracker.running_count(&persona.id)`.

### 7.G — `wait_ms` is computed and discarded

`queue.rs:367-368` computes the exact milliseconds each promoted execution spent queued, logs it at
`:370-376`, and asserts it in a unit test at `:686`. **Production consumers outside `queue.rs`:
zero.** `persona_executions` has no queue-wait column; `QueueStatusEvent` (`engine/mod.rs:1762`) has
no wait field on either the `queued` or the `promoted` emission.

Measured by subtracting `created_at` from `started_at` over 2,188 rows: p90 **185 s**, p99
**3,459 s**, max **39,534 s (11.0 hours)**, and **362 arrivals (16.5%) waited over a minute**. The
number that answers "is this cap too tight" exists, has existed for the life of the queue, and has
never been stored.

**Fix:** a `queued_ms INTEGER` column set at promotion, and the field on `QueueStatusEvent`.

### 7.H — Four doors that skip, peek, or leak

- `engine/mod.rs:826` `ExecutionEngine::has_capacity` is a `pub async fn` wrapper around the
  display-only checker, with no registration — and it has **zero callers in 963 files**; the only
  other occurrence of the name in `src-tauri/src/` is its own body at `:830`. Its would-be caller
  declined it in writing: `background.rs:1666` reads *"(no separate has_capacity check to avoid
  TOCTOU gap)"* and goes straight to `start_execution`. **The wrapper is dead, and what it is is a
  public, ergonomic, correctly-named invitation to the exact race `try_add_running`'s docstring
  exists to prevent.** Delete it.
- **The exemplary file has two admission paths and only one of them is atomic.**
  `p2p/connection.rs:323` (net-new outgoing insert) tests capacity *inside* the write lock, with the
  reason written down. `p2p/connection.rs:538` (incoming connection) calls
  `self.is_at_capacity().await` — the read-lock peek at `:201` — and then accepts, with the lock
  released in between. Same file, same cap, same author, same two lines of English above each
  (*"Enforce max_peers limit…"*), one racy. This is P5's exact failure mode surviving twenty lines
  from its own fix, and it is why §4.4 says the non-atomic checker may exist for display and must
  never be the gate.
- `fleet_resume_orphan` (`fleet/process_scan.rs:145-171`) does not call `free_slot_for_spawn` at
  all, so the one lane with a soft cap has a door that skips even that.
- `execute_persona_inner` takes a **warm session out of the pool** (`executions.rs:477`) before the
  admission door at `:491`. On `QueueFull` the `?` at `:500` propagates and the session taken from
  the pool is dropped — a leak on the refusal path only, which is why it has never been noticed.

## 8. Gaps

1. **Nothing reserves.** Admission here is check-and-register on an *in-memory* structure; there is
   no durable reservation, so a crash between admission and the first status write leaves the slot
   accounted for in a `HashMap` that no longer exists. `requeue_persisted_executions`
   (`engine/mod.rs:748-823`) rebuilds from `status='queued'` rows, which is the right idea and is
   also why §7.B's stranded `running` rows are invisible to it: the recovery sweep reads `queued`,
   and a refused-after-write row is `running`. The cohort has exactly one reserve-then-settle
   implementation (`ascent`, oracle clause 10) and adopting it is a design, not a fix.
2. **`insert_running`'s `Err` is two conditions.** `Err(AppError::Internal(lock_error_msg))` on a
   poisoned mutex and `Err(AppError::Validation("Job is already running"))` on a refusal, and 19 of
   22 callers write `?`. There is no way for a caller to distinguish them without matching strings.
   Splitting the return into `Result<Admitted, JobBusy>` is the fix and it touches 22 sites; typing
   the refusal as `RateLimited` (§7.A) is the one-line 80% and does not.
3. **The census cannot see an unreachable cap.** `TierConfig.max_queue_depth` (§7.D) is an
   *absence* — "no call site sets this" — and the runner ratchets presence. The instrument is the
   dead-export check [`agent-dispatch`](./agent-dispatch.md) §9 specified for orphan settings keys,
   widened to `pub fn` setters on config structs. It would have caught this and
   `EnclavePolicy.max_cost_usd` and `budget_alert_rules.threshold_usd` on the day each became an
   orphan.
4. **There is no test in this repo that asserts the ORDER of a durable write and an admission
   door.** `queue.rs` has 25 admission tests — the richest in the cohort — and every one of them
   tests the tracker in isolation, where there is no database to strand. The instrument is a
   `#[test]` that calls each of the seven doors with the registry pre-poisoned and asserts the
   durable row is untouched; it is ~15 lines per site and it is what §9's rule is a proxy for.
5. **No lane can express "admitted, but degraded".** The tracker's four gates are all binary. When
   the resource governor pauses admission (`resource_governor.rs`), a caller's only options are wait
   or fail; there is no "run it at lower parallelism" or "run it on the cheaper model", which is the
   move [`spend-ceilings`](./spend-ceilings.md) P8 prescribes on the money axis and which
   `overnight.rs:406-427` implements exactly once.
6. **Admission and cost are decided 530 lines apart in the same request and neither knows about the
   other.** `executions.rs:353` asks "is there budget", `engine/mod.rs:886` asks "is there room",
   and no lane asks "is there room *for what this will cost*". [`bounded-parallel-fan-out`](./bounded-parallel-fan-out.md)
   §8.6 records the same orphan from the width side. Three paths now name it; none owns it.

## 9. The missing gate

**The condition, stated stack-free:** *a unit of work is recorded in a durable store as having
started, and the admission decision that can still refuse it is taken afterwards — so a refusal
leaves a permanent record of work that never ran.*

**An adopting repo must re-derive its own proxy.** In this repo the condition wears one costume: a
Rust `Some("running")` status argument reaching a `insert_running(` call in the same function body.
Elsewhere it is `await db.job.create({status:'running'})` above a `queue.tryAcquire()`, an
`INSERT … 'running'` above a `SELECT count(*) FROM active`, or — as `personas-cloud` actually spells
it (§6 clause 3) — `db.recordEventDispatch(...)` six lines above `dispatcher.submit(...)`. **This
pattern scores a structural zero on all of them.** The portable half is the head, §2(a) and §4.5.

**Where this gate executes.** `npm run census:check`, which is inside **`npm run check`**
(`package.json:52`) and, more importantly, is the **`golden-path-census` pre-push job**
(`lefthook.yml:74-75`) — added 2026-08-16 because the census had been *"enforced NOWHERE"*.
Deliberately **not** `ci.yml`: that workflow runs its Rust tests but is red on 10 pre-existing
`personas-db` failures, and per this batch's calibration a gate that only runs in CI runs nowhere.
This one runs on every push from the machine that made the change.

### Existing rules checked first, by reading each definition rather than its title

| rule | what it covers | why it does not cover this |
| --- | --- | --- |
| **`unswept-job-registry-read`** (6/9, `long-running-job-progress`) | `X_JOBS.lock()` + `jobs.get(` — a read that skips `sweep_stale_running` | **Nearest neighbour by file, disjoint by line.** Same root, same extension, and **3 of my 4 files** — because these are the job-manager files. Measured, not assumed: its hits are `kpi_scan.rs:634,650`, `idea_scanner.rs:707`, `use_case_scan.rs:365`, `context_generation.rs:841,858`, `workspace_verify.rs:322,333`, `workspace_divergence.rs:324`; mine are `kpi_scan.rs:528`, `idea_scanner.rs:459,1297`, `use_case_scan.rs:252`, `task_executor.rs:558,740,1417`. **Zero shared lines.** Its subject is a *read accessor*; mine is *write ordering around the door*. |
| `unfenced-work-outcome-write` (6/11, `job-claim-and-lease`) | an `UPDATE` recording a **terminal** status + completion timestamp, `WHERE id = ?N` alone | Terminal, not initial; SQL literal, not a Rust argument. **File intersection 0.** The complement is instructive: it gates how work *ends* unfenced, this gates how work *begins* unasked. |
| `discarded-guard-verdict` (7/11, `conditional-write`) | `execute("UPDATE … WHERE id=?N AND …");` whose affected-row count is dropped | A compare-and-set whose verdict is discarded. Mine is a verdict that is *consulted too late*. **File intersection 0.** |
| `unkeyed-billable-spawn` (11/13, `idempotent-invocation`) | `execute_persona_inner` / `create_with_idempotency` with `None` in the idempotency slot | The nearest in *spirit* (both are about a door that should have said no). Its anchor is two function names and a positional `None`; mine is a status literal and a third function. **File intersection 0.** |
| `hand-rolled-emptiness-refusal` (135/305, `command-input-validation`) | `.is_empty()` whose consequent builds `AppError::Validation` | Shares the `AppError::Validation` token with my **control** and nothing with the rule. Its left anchor is `.is_empty()`; mine is `<count> >= <CAP>`. Violating-set intersection **0**; control intersection 1 file (`approval_exec_knowledge.rs`), different lines. |
| `self-disabling-money-ceiling` (8/8, `spend-ceilings`) | `budget > 0.0` — the *money* limit's positivity test | Explicitly scoped to currency. My control matches `monthly_spend >= budget` at `executions.rs:357`, three lines below its `executions.rs:354`; the rule sets do not intersect at all. |
| `unraced-loop-wait` (12/13) · `outcomeless-tick` (8/45) | loop shapes and tick signatures | The loop that *calls* the gate. **File intersection 0 each.** |
| `autonomy-verdict-outside-the-front-door` (4/5) · `undeclared-tier-branch` (13/13) · `unfalsifiable-tier-guard` (34/105) | permission and tier decisions | *May* this act, not *is there room*. §7.D's finding is an absence (below). **File intersection 0 each.** |
| `module-scope-install-latch` (13/13) · `widthless-collection-fanout` (35/43) · `unaddressable-agent-spawn` (6/6) | frontend `src/`, `.ts/.tsx` | Disjoint by root and extension; zero possible overlap. |

**None of the 122 existing rules keys on the ORDER of a durable write and an admission decision.
Proposing one.**

### Conditions deliberately NOT gated, each with the number that decided it

- **A capacity refusal typed as non-retryable (§7.A) — designed, measured, declined on precision.**
  The signal would be `AppError::Validation` within N characters of a `>=`-against-a-cap. Anchor:
  the control's 12 matches. Of those, **6 use `Validation` and are wrong, 1 uses `RateLimited` and
  is right, 2 use non-`AppError` types, and 3 are not capacity refusals at all** (a recursion depth,
  a budget, an intervention cap). A gate at 6/12 fires on correct content half the time. **The right
  instrument is a `#[test]` in `core/src/error.rs`** asserting that every message containing
  "try again later" / "wait for" / "already running" / "at capacity" resolves to
  `retryable = true` — one assertion over a vocabulary, not a matcher over a shape. And per the
  contract's *"prefer fixing the default"*, the two-literal edit in `background_job.rs` corrects 23
  sites and no ratchet would move one of them.
- **A cap declared and read by no gate (§7.D) — not gateable.** "This `pub fn` setter has no
  callers" is a whole-program reachability question, not a regex. Same instrument as
  [`agent-dispatch`](./agent-dispatch.md) §9's orphan-key check, widened to config-struct setters.
- **`0` overloaded as unlimited/off (§7.C) — population is 4.** Four readings of one zero across
  four files is a hand-countable list, not a ratchet. The instrument is a `#[test]` in `queue.rs`
  asserting `has_global_capacity` at 0 agrees with `MAX_PARALLEL_EXECUTIONS_MIN`'s docstring — which
  it does not, which is the finding.
- **A refusal with no retry-after (P4) — an absence.** The census ratchets presence and cannot
  assert that a `format!` *omits* a number.
- **The Fleet lane's missing admission (§7.E) — a single site**, already carried by
  [`agent-dispatch`](./agent-dispatch.md) D4.

### Measurement

**Precision 7/7 violating, 12/12 control — every match opened and read.** Two independent
implementations: a standalone Node scanner over 963 files that strips `#[cfg(test)]` as
brace-matched ranges and strips line comments, and the census engine, which does neither.

**They disagreed, and the disagreement was the finding.** On the *control* the scanner returned
**10** and the engine **8**. Cause: my scanner stripped comments before applying a 260-character
window, so at `rate_limiter.rs:60` and `p2p/connection.rs:323` — where a multi-line explanatory
comment sits between the capacity test and the refusal — the engine's window ran out inside the
comment. **The comment stripping was the instrument's own convenience and the engine is the
authority**, so the window was widened to 650 with a tempered `(?!\bfn\s)` fill, at which point the
engine returns **12** and picks up two further genuine sites (`p2p/messaging.rs:171`,
`companion/session.rs:771`) that both implementations had missed. Doctrine's *"a matcher that
composes is not the same as a matcher that counts"*, arriving through comment handling rather than
through string handling.

On the *violating* rule the two implementations agreed at **7 matches / 4 files with identical line
numbers** on the first run, including the three `task_executor.rs` sites where seven inline `//`
comments sit inside the 900-character window — which is the check that the tempered fill tolerates
comments the way the engine sees them.

**Contamination: zero.** `commentMatchesSkipped` is 0 for both rules. No test module matches: the
seven violating sites are all in `#[tauri::command]` bodies or `tokio::spawn` closures, and
`insert_running` appears in no `#[cfg(test)]` block in the tree (verified by the brace-matched
scanner, which strips them, returning the same 7).

**Backtracking:** the only multi-token fill is `(?:(?!\bfn\s)[\s\S]){0,900}?` — one bounded lazy
quantifier over a tempered class, no nesting. Full 963-file run of both rules: **0.58 s**, measured
three times.

**Fault-injected six ways, all six fire** (`census FAILED`, exit 1): floor → 99999 gives *"THE
MATCHER IS BROKEN, NOT THE CODEBASE CLEAN"*; pattern → a non-matching literal gives both the
zero-match structural failure and the silent-drop drift; baseline → 3 gives a rise; baseline → 40
gives a silent drop; a `baseline` added to the control is rejected *before any file is walked*
(*"a positive control must NOT carry a baseline"*); a stale `exclude` path gives *"the exemption is
stale"*.

**Validated standalone** in a composer-private registry
(`registry-admission-control-composer.json` — a filename unique to this composer, because sibling
composers share the scratchpad directory and have overwritten each other's files), then
**re-extracted from this finished document and re-run: `files 4 / matches 7` and `files 12 /
matches 12`, identical both times.** The full registry was not run.

**On the partition, stated honestly.** The rule and the control **do not share a lexical anchor**,
and that is the nature of this condition — the compliant form's whole point is that no durable write
precedes the door, and "the absence of a preceding token" is not expressible in a regex without a
900-character variable-length lookbehind, which the doctrine forbids on performance grounds. This is
the same shape `self-disabling-money-ceiling`'s control took, and it is declared for the same
reason. The two therefore measure **the same axis from opposite ends**: 7 sites take the admission
decision after committing state, 12 take it before committing anything. What the control guarantees
is that the repo *has* a refuse-before-you-write vocabulary and where it lives; if the control
collapses toward zero, the violating rule's premise — that there is a right way here — is gone and
both numbers stop meaning anything. Note that fixing a violating site by hoisting the door will drop
the rule without moving the control; that drop is legitimate, and the runner's fatal-on-drop
behaviour is what makes it visible and deliberate rather than silent.

### The rule

```json
{
  "rules": [
    {
      "id": "start-marker-before-admission",
      "goldenPath": "docs/concepts/golden-paths/admission-control.md",
      "title": "The durable record says the work started, and the admission door that can still refuse it is called afterwards",
      "roots": ["src-tauri"],
      "extensions": [".rs"],
      "signal": {
        "pattern": "(?:Some\\(\\s*\"running\"\\s*\\)|status\\s*=\\s*'running')(?:(?!\\bfn\\s)[\\s\\S]){0,900}?\\b[A-Za-z_][\\w:]*\\s*(?:\\r?\\n\\s*)?\\.\\s*insert_running\\s*\\(",
        "flags": "g",
        "ignoreCommentLines": true,
        "$measured": "2026-08-16 @ 95555f875 — 963 .rs files walked, floor 900, rule+control run in 0.58s (3 runs); two independent implementations (a comment- and #[cfg(test)]-stripping Node scanner, and the census engine, which strips neither) returned identical membership at 7/4 on the first attempt; all 7 matches and all 12 control matches hand-read; commentMatchesSkipped 0; live consequence measured on read-only copies of personas.db (347 MB) and personas_data.db (17.5 MB) copied 2026-08-16 17:14 UTC+2 with the app running.",
        "description": "A durable START-MARKER write — the Rust argument `Some(\"running\")` handed to a repo update/create, or a `status = 'running'` SQL literal — followed within 900 characters, WITHOUT crossing a `fn ` boundary, by a call to BackgroundJobManager::insert_running, the admission door that can still refuse the work. PROXY FOR the stack-free condition: a unit of work is recorded in a durable store as having started, and the decision that can still refuse it is taken afterwards, so a refusal leaves a permanent record of work that never ran — in the one state nothing sweeps. MEASURED 2026-08-16 at 95555f875: 7 matches across 4 of 963 .rs files, ALL SEVEN OPENED AND READ (precision 7/7). THE SEVEN, each with its refusal path: task_executor.rs:553->:568 (dev_tools_execute_task — `?` propagates and the dev_tasks row stays 'running'), :735->:750 (dev_tools_start_batch's spawned closure — a BARE `return`, so the batch reports nothing at all), :1412->:1427 (run_one_task_for_auto — returns the string \"failed\" to a JoinSet that discards it, and never touches the row); idea_scanner.rs:459->:464 and :1297->:1300, kpi_scan.rs:528->:531, use_case_scan.rs:252->:255 (all four: `repo::create_scan(.., Some(\"running\"))?` then `X_JOBS.insert_running(..)?`, so a refusal strands a dev_scans row). LIVE CONSEQUENCE, from read-only copies of the operator's databases rather than from reading: dev_scans holds 4 rows stuck at 'running' since 2026-06-08..06-11 (66-69 days) and dev_tasks holds 2 since 2026-04-09 (129 days). THE AUTHOR ALREADY REASONED ABOUT THIS HAZARD AND STOPPED ONE LINE SHORT: idea_scanner.rs:441 carries the comment 'Resolve agents before creating any DB records to avoid orphaned \"running\" scans', 18 lines above the create-then-admit it does not prevent. THE COMPLIANT ORDERING EXISTS ONCE, IN ONE OF THE SAME FILES: dev_tools_start_auto_run (task_executor.rs:1495 door, :1500 durable ledger row) puts the door first and says why in a comment — same file, same author, same concept, one ordered correctly. LEGAL FIX, two statements swapping places: call the door before the write. Do NOT silence a match by hoisting the status write into a helper, by spelling it `Some(status_str)`, or by moving the door into a spawned task — all three preserve the defect exactly and merely hide it from this signal. TOLERANCES: the fill is tempered with (?!\\bfn\\s) so a match cannot span two function bodies; it tolerates the seven inline `//` comments that sit between the write and the door at task_executor.rs:553-568, which is why the engine (which does not strip comments) and a comment-stripping scanner agree exactly. DOES NOT OVERLAP unswept-job-registry-read, its nearest neighbour, which shares 3 of these 4 FILES and ZERO of these 7 LINES — measured by running both in one private registry: that rule's hits are kpi_scan.rs:634,650 / idea_scanner.rs:707 / use_case_scan.rs:365 / context_generation.rs:841,858 / workspace_verify.rs:322,333 / workspace_divergence.rs:324, and its subject is a READ accessor that skips the stale sweep, not a WRITE that precedes the door. Nor unfenced-work-outcome-write (a TERMINAL status + completion timestamp in SQL; this is an INITIAL status as a Rust argument — file intersection 0). Nor discarded-guard-verdict (a compare-and-set whose row count is dropped — file intersection 0). Nor unkeyed-billable-spawn (the idempotency slot on the persona lane — file intersection 0). Nor hand-rolled-emptiness-refusal / self-disabling-money-ceiling, which intersect only this rule's POSITIVE CONTROL and at different lines. PRECONDITION (must be re-derived per repo, do NOT port): this repo marks work started by passing the Rust literal Some(\"running\") to a repository function, and admits through one named door called insert_running. A Node/Prisma repo spells the identical condition `await db.job.create({data:{status:'running'}})` above a `queue.tryAcquire()`; personas-cloud spells it `db.recordEventDispatch(...)` six lines above `dispatcher.submit(...)` (eventProcessor.ts:536,542) and commits the same defect with an idempotency row instead of a status column. This pattern scores a STRUCTURAL ZERO on both. END OF LIFE: this rule is designed to reach zero — all seven are two-statement swaps — and section 4 proposes an admit_then(...) combinator that owns both halves and makes the ordering unrepresentable. When the count reaches 0 the runner fails structurally on zero matches, BY DESIGN: DELETE the rule then, do not baseline it at 0."
      },
      "exclude": [],
      "baseline": { "files": 4, "matches": 7 },
      "floor": 900
    }
  ]
}
```

### Positive control (evidence, NOT merged as a gate — carries no baseline)

```json
{
  "id": "start-marker-before-admission-positive-control",
  "goldenPath": "docs/concepts/golden-paths/admission-control.md",
  "title": "POSITIVE CONTROL — a capacity refusal taken on an observed count against a named cap, before anything is created",
  "roots": ["src-tauri"],
  "extensions": [".rs"],
  "signal": {
    "pattern": "\\b[A-Za-z_]\\w*(?:\\s*\\.\\s*(?:len|count)\\s*\\(\\s*\\))?\\s*>=\\s*(?:crate::)?(?:[a-z_]\\w*::)*(?:self\\s*\\.\\s*)?[A-Za-z_][A-Za-z0-9_]{3,}\\s*\\{(?:(?!\\bfn\\s)[\\s\\S]){0,650}?(?:AppError::Validation\\s*\\(|AdmitResult::QueueFull|return\\s+Err\\s*\\()",
    "flags": "g",
    "ignoreCommentLines": true,
    "$measured": "2026-08-16 @ 95555f875 — validated standalone in a composer-private scratch registry, then re-extracted from this document and re-run; 12 files / 12 matches both times.",
    "description": "CONTROL, not a gate. The COMPLIANT form of the same axis: an admission decision taken on an OBSERVED count against a named cap, whose consequent REFUSES before anything has been created. MEASURED 2026-08-16 at 95555f875: 12 matches across 12 files, ALL TWELVE OPENED AND READ (precision 12/12 on the stated condition). THE TWELVE: engine/src/queue.rs:285 (queue.len() >= self.max_queue_depth -> AdmitResult::QueueFull, the only refusal in the tree that is a VARIANT rather than an error); engine/src/p2p/connection.rs:323 (the best admission site in the repo — the capacity test is INSIDE the write lock that performs the insert, with the reason written down at :324-325, it increments a durable connections_rejected_capacity counter, it closes the transport with a reason code, and the message names the cap AND the remedy); engine/src/rate_limiter.rs:60 (the refusal carries its own answer — Err(retry_after_secs) computed from the oldest live entry, not a flat window); engine/src/p2p/messaging.rs:171 (the ONE capacity refusal in 963 files typed AppError::RateLimited, which the repo's own taxonomy classifies retryable=true, plus a messages_dropped_buffer_full counter); idea_scanner.rs:434 and use_case_scan.rs:238 — the backlog-saturation family, refusing to PRODUCE more work because the human review queue downstream is full, naming count / cap / remedy before any row exists; approval_exec_knowledge.rs:690 (live.len() >= APPLY_MAX_CONCURRENT_PER_REPO, whose constant comment names the shared resource); companion/session.rs:771 (queued >= MAX_QUEUED_FLEET_TURNS after a try_lock, the only try-then-refuse in the tree — and the only capacity refusal typed AppError::Internal, so its category is decided by a string ladder); share_link.rs:121; executions.rs:357 (the monthly budget gate — spend-ceilings' territory, correctly placed here and disarmed at the data layer since max_budget_usd is NULL on 78/78 personas); operative_memory.rs:838; mcp_tools.rs:811 (a gateway recursion depth — the one arguable member, carried on purpose so the count is a population rather than an opinion: precision is 12/12 on 'refuses before creating' and 11/12 on 'bounds concurrent work'). ONE RECALL GAP, NAMED: kpi_scan.rs:496 is the third member of the backlog family and is INVISIBLE here, because it resolves its cap into a lowercase local binding (`pending >= cap`) and the pattern requires an identifier of 4+ characters to keep `>= n`, `>= i` and other loop-index comparisons out. A compliant site whose cap has a short name scores zero — the same vocabulary-bounded recall the doctrine warns about, and the miss landed on the most sophisticated member of the family (it is the only two-scope gate in the tree, per-context AND per-project). WHAT THE TWELVE DEMONSTRATE IS THE DOCTRINE, NOT MERELY COMPLIANCE: four of them refuse on a DOWNSTREAM backlog rather than on in-flight width, which only one of five sibling repos does at all, and two of those four are OBSERVED SHUT on the operator's live data (the `personas` project sits at 22 pending ideas against a cap of 15; `brainiac` sits at exactly 12 proposed use cases against a cap of 12). THE PARTITION IS SEMANTIC, NOT LEXICAL, AND THAT IS THE NATURE OF THIS CONDITION — the compliant form's whole point is that no durable write precedes the door, and 'the absence of a preceding token' cannot be expressed without a 900-character variable-length lookbehind, which the corpus forbids on performance grounds (one rule took 73 seconds because of one). The same reasoning produced self-disabling-money-ceiling's control. So the two rules measure ONE AXIS FROM OPPOSITE ENDS: 7 sites decide after committing state, 12 decide before committing anything. If this control collapses toward zero the repo has lost its refuse-before-you-write vocabulary and the violating rule's premise is gone, which is the failure this control exists to make visible. TWO INDEPENDENT IMPLEMENTATIONS DISAGREED HERE AND THE DISAGREEMENT WAS THE FINDING: a comment-stripping Node scanner returned 10 and the census engine 8, because the scanner's convenience let a 260-character window reach past the multi-line explanatory comments at rate_limiter.rs:60 and connection.rs:323 that the engine must traverse; widening the window to 650 with a tempered (?!\\bfn\\s) fill reconciled them AND surfaced two further genuine sites (messaging.rs:171, session.rs:771) that BOTH implementations had missed. Deliberately carries NO baseline: a ratchet is monotone-downward, so a rule counting COMPLIANT code would fail the build every time adoption improved; the census engine rejects a `-positive-control` id that carries one (verified by injection) and the registry merge skips it by construction."
  },
  "floor": 900
}
```

## 12. Corrections to the brief

1. **"`GLOBAL_MAX_CONCURRENT = 4` has never bound anything; the runtime value is 10 and the observed
   maximum is exactly 10, saturated 30 times and never 11." — CONFIRMED, and the replay makes it
   quantitative.** `app_settings` holds 32 rows and **no `max_parallel_executions`**, so the runtime
   value is `MAX_PARALLEL_EXECUTIONS_DEFAULT = 10`. Replaying `has_global_capacity` verbatim at each
   of the 2,188 arrivals: at **4** it would have held **312 (14.3%)**; at **1**, 1,568 (71.7%); at
   10, 20 and 0, **zero**.
   **But the brief's framing invites a wrong inference and I nearly published it.** A sweep over
   observed start times cannot prove the gate held anything, because a held arrival's `started_at`
   *is* the post-promotion time — the timeline is the gate's output. The independent proof is
   elsewhere and is stronger: **three distinct per-persona caps (1, 2, 4) across 59 personas and
   2,188 executions, 50 personas reaching their cap and ZERO exceeding it**, plus the queue wait —
   **362 arrivals waited over a minute and one waited 11.0 hours.** My first replay simulated queue
   dynamics and reported 797 "queue full" events that never happened; it was discarded and replaced
   with the observation above. *A counterfactual over a timeline the mechanism produced is not a
   measurement of the mechanism.*
2. **"`MAX_LIVE_SESSIONS = AtomicU64::new(0)` — 0 means off, and that is the default… Four bounded
   lanes in this repo, one unbounded." — CONFIRMED, and it is worse than a default.** The zero is
   **written continuously**: `fleetSlice.ts:210` defaults `fleetLiveSlotsEnabled: false` and
   `fleetSlice.ts:228` pushes `setLiveSlots(0)` **on every Fleet refresh**. The setter
   (`fleet/commands.rs:254`) takes an unclamped `u32` with **no `require_auth`**, in a file whose
   neighbouring setter documents *"clamped server-side"*. **And "four bounded lanes" undercounts:
   there are eight lanes (§0.1), of which the Fleet lane is not merely unbounded but bounded by an
   *eviction that returns `()`*** — three outcomes, zero bits, which is a different and more
   interesting defect than "no cap".
3. **"`set_global_max_concurrent(0)` means unlimited. Zero means five different things in this
   binary… and 0 of 5 siblings use '0 = unlimited'." — CONFIRMED, extended to SEVEN, and the
   sharpest instance is a contradiction inside one repo about one field.**
   `settings_keys.rs:583-584` documents `0` as *"would deadlock the queue (nothing could ever
   admit)"* and the validator rejects it — while `queue.rs:157` returns `true` unconditionally at 0,
   so nothing deadlocks and everything admits. **The validator refuses the value that means
   "unlimited" in order to prevent a deadlock that cannot occur**, and the field is separately
   settable at runtime through a `pub fn` that does not go through the validator. Add
   `overnight.rs:143` (*substitute 4*) and `stale.rs:1395` (*off*) and this one axis carries four
   readings. The oracle independently confirms the silence: **0 of 5 siblings overload a degenerate
   integer for a capacity limit; four of the five cannot express "unlimited" at all, and present
   that as a feature.**
4. **"Zero executions have ever run under a dollar ceiling. Admission by cost does not exist." —
   PARTLY WRONG, and the correction matters for §2.** Admission by cost **does** exist and is
   correctly placed: `executions.rs:353-365` refuses on `monthly_spend >= budget` **before the
   execution row is created** — it is one of the 12 compliant refuse-before-you-write sites in the
   positive control, and the only one that predates this document. What does not exist is the
   *data*: `max_budget_usd` is NULL on 78 of 78 personas, per
   [`spend-ceilings`](./spend-ceilings.md) §0. "The mechanism is absent" and "the mechanism is
   disarmed at the data layer" are different findings with different fixes, and this leaf's fix list
   would have been wrong under the first.
5. **"A semaphore was configured with permits equal to the task count." — CONFIRMED, still live,
   and NOT re-derived here.** `NewCompetitionModal.tsx:60` → `task_executor.rs:663`. It is
   [`bounded-parallel-fan-out`](./bounded-parallel-fan-out.md) D1 and belongs there.
6. **"`task_executor.rs:674` spawns before acquiring, materialising N tasks to sleep." — CONFIRMED,
   with a fact that path did not have.** The permit is acquired at `:676` — but the *admission* door
   (`insert_running`) is at `:750`, **74 lines and one durable `status='running'` write later.** The
   width bound and the mutual-exclusion bound are in the same function, 74 lines apart, with the
   defect of this leaf sitting between them. Neither bound knows the other exists.
7. **New — the brief did not ask, and it is the largest structural finding: seven verdict types.**
   Eight admission lanes; `AdmitResult` is the only closed classification and it has **one call
   site**. The other seven are `Result<(), AppError>` (whose `Err` also means a poisoned mutex,
   across 22 call sites), `bool`, `Result<(), u64>`, `()`, `Result<bool, AppError>`,
   `Result<(), String>`, and a bare semaphore permit.
8. **New — every capacity refusal in this app is typed non-retryable (§0.2, §7.A).** `AppError::Validation`
   → `retryable = false` in the app's own taxonomy, on ten refusals whose English says "try again
   later" / "wait for one to settle" / "disconnect a peer first". `AppError::RateLimited` exists,
   is `retryable = true`, is mirrored on the frontend, and is used by exactly **one** capacity gate
   (`p2p/messaging.rs:171`). This is a two-literal fix at `background_job.rs:222,:240` that corrects
   22 call sites.
9. **New — the tier's one capacity field reaches no decision (§7.D).**
   `ConcurrencyTracker::set_max_queue_depth` has **zero callers in 963 files**, so
   `TierConfig.max_queue_depth` (5 / 25 / `usize::MAX`) is inert and every install runs at
   `DEFAULT_MAX_QUEUE_DEPTH = 10`. Its two sibling fields on the same struct **are** wired. The
   dashboard renders the declared 5 and the real 10 side by side without reconciling them.
10. **New — the refusal is unobservable and the wait is discarded (§7.F, §7.G).**
    `queueRejections` crosses the FFI and has **0 render sites in 4,829 files**; `"queue-backpressure"`
    is an unregistered raw-string event with **0 listeners**, whose payload field named `running`
    holds `persona.max_concurrent` — a cap, not a count, the same mislabelling the user-facing
    sentence makes. And `wait_ms`, computed at `queue.rs:367` and asserted in a unit test, has zero
    production consumers, so the 11-hour wait in this install is recoverable only by subtracting two
    columns by hand.
11. **New — Personas is AHEAD of all five siblings on one clause, and it should be said out loud.**
    Backlog-saturation admission (P7): four gates here against the cohort's one, **and two of the
    four are observed shut on live data right now**. `brainiac` has built every signal such a gate
    would need (`QueueHealth`, `depth()`, `dead_letters_count()`) and reads them from no gate — the
    clearest "the instrument exists, the decision does not" in the sweep.
