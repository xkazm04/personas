# Golden path — Bounded parallel fan-out

> Situation node: `backend-runtime/job-coordination/bounded-parallel-fan-out` ·
> [situation spine](../situation-spine.md) · recurrence 13 · risk **HIGH** ·
> sides: **both** · convergence: **mixed** ·
> dimensions: **function · performance · resilience · cost**
> Composed 2026-08-16 against `master` @ `c81519610`.
>
> **Sweep size.** All **963** `.rs` files under `src-tauri/` and all **4,829** `.ts`/`.tsx` files
> under `src/` (the census engine's own walk agrees at 4,829). Every `join_all`, `try_join_all`,
> `FuturesUnordered`, `buffer_unordered`, `buffered`, `for_each_concurrent`, `JoinSet`,
> `Semaphore::new`, `par_iter` and `tokio::spawn`-inside-a-loop in the Rust tree was enumerated and
> each site opened. Every `Promise.all` / `allSettled` / `race` / `any` call site in `src/` —
> **181** of them — had its argument extracted with a **balanced-paren parser**, not a grep, and was
> classified as a literal tuple (not a fan-out) or a fan-out over a runtime-length collection.
> `src/lib/concurrency.ts`, `src/lib/eventBridge.ts`, `src-tauri/src/engine/cloud_webhook_relay.rs`,
> `src-tauri/src/engine/healthcheck.rs`, `src-tauri/src/engine/build_session/orchestrator.rs`,
> `src-tauri/src/engine/build_session/fanout.rs`, `src-tauri/src/commands/infrastructure/task_executor.rs`,
> `src-tauri/engine/src/test_runner.rs` and `src-tauri/engine/src/queue.rs` read in full.
>
> **Measured by execution, not by reading.** Four fan-out primitives were transcribed **verbatim**
> from this tree and replayed: `mapWithConcurrency`, `useDrive`'s `runBulk`, the raw
> `Promise.all(xs.map(f))`, and `eventBridge`'s chunk loop — counting how many units of work
> actually run, and *when*, on the failure path and at four input sizes. Read-only **copies** of the
> operator's two live SQLite databases (`personas.db` 347 MB, `personas_data.db` 17.5 MB, copied
> 2026-08-16 12:24 UTC+2) were swept with a sweep-line over **2,188** executions, **4,001** provider
> audit rows and **1,771** companion turns to count the concurrency this app has *actually* reached.
> The live files were never opened for write; the app was running (`engine-leader.lock` heartbeat
> was 0 s old at copy time).
>
> **`cargo` was not run.** Every Rust claim is static and traces to a file read during composition.
>
> Convergence oracle run against **`personas-web`, `brainiac`, `personas-cloud`, `vibeman`,
> `ascent`** — all five present, all five opened. It **refuted the brief's central hypothesis**
> (§12) and produced one finding that changed this document's §9.
>
> **Settles:** what bounds N, what happens to the other N−1 when one fails, and which of those two
> questions the type can answer.

---

## 0. The headline

**The concurrency cap in this app is real, and it has held 10-for-10 for three months. What has
never held is the failure half: in 4,001 measured model calls the width never once exceeded its
ceiling, and in 44 measured frontend fan-outs there is no ceiling at all — because the ceiling was
built for the lane a human watches and the fan-outs are everywhere else.**

Executed against the live databases, sweep-line over every interval:

| lane | rows | max simultaneous, ever | what bounds it |
|---|---:|---:|---|
| `persona_executions` | 2,188 | **10** | `MAX_PARALLEL_EXECUTIONS_DEFAULT = 10` via `ConcurrencyTracker::admit` |
| `provider_audit_log` (every model call, 2026-04 → 2026-06) | 4,001 | **10** | the same gate, one lane below |
| `companion_turn` origin=`headless` | 1,636 | **9** | **nothing** — [`headless-model-call`](./headless-model-call.md) §7.B, uncapped |

The cap was **saturated 30 times** (30 executions started with 9 already running) and **never once
exceeded**. `GLOBAL_MAX_CONCURRENT = 4` (`engine/src/queue.rs:10`) has never bound anything in this
install's recorded history — its own docstring calls it *"only the no-pool/test fallback"*
(`settings_keys.rs:576`), and the observed ceiling is 10, not 4, at every scale. The uncapped
headless lane reached **9** — one short of the capped lane — by accident rather than by design.

Then look at the denominator.

| | frontend (`src/`, 4,829 files) | backend (`src-tauri/`, 963 files) |
|---|---|---|
| combinator call sites total | **181** (`Promise.all/allSettled/race/any`) | 18 fan-out sites |
| of which **literal tuples** — `Promise.all([a(), b()])`, not a fan-out | **122** (the 103 `Promise.all` ones span arity 2–10) | n/a |
| of which **fan-outs over a runtime-length collection** | **44** | **18** |
| **bounded** (a width the code chose) | **14** `mapWithConcurrency` sites | **15** |
| **unbounded** (width = `items.length`) | **44** | **3** |
| ratio bounded : unbounded | **14 : 44 (24%)** | **15 : 3 (83%)** |

**The two halves of one app disagree by a factor of three-and-a-half, and the reason is that the
backend has a primitive and the frontend has five.**

Five findings are sharper than the ratio.

### 1 — `Promise.all` does not abandon the rest. It abandons the *results*.

The single most load-bearing belief about this leaf is false, and it took four lines to disprove.
Replayed, 30 items, item #2 rejects:

```
Promise.all(xs.map(f)):     caller saw: boom   started=30  finished=2
                            (all 30 had ALREADY been dispatched before the first await resolved)
                            200ms later:       started=30  finished=29
```

Every item ran. `Promise.all` vs `Promise.allSettled` changes **nothing** about what executes or
what it costs — it changes only whether the caller can see what happened. For a fan-out over N
model calls the two spend **exactly the same money**. The 13 `allSettled` sites in this repo are not
buying safety; they are buying *legibility*, which is worth having and is not what the name
suggests.

**The worker pool is worse than `Promise.all` on the failure path, not better.** Replayed against
`src/lib/concurrency.ts:18` transcribed verbatim, 30 items, width 4, item #2 rejects:

```
mapWithConcurrency(items, 4, fn):
  AT THE MOMENT THE CALLER RESUMED:  started=6   finished=2
  400ms LATER (nobody is watching):  started=30  finished=29   startedAfterTheRejection=24
```

The caller is told "failed" and the pool then goes on to **start 24 more units of work that nobody
will ever read**. With `Promise.all` the money was at least already committed when you found out;
with the pool it is committed *after*. The primitive's own docstring says a rejection *"propagates
immediately"* — true of the promise, false of the process.

### 2 — five copies of one worker pool, and the file that says it is the only one is one of the five

`src/lib/concurrency.ts:1-17` opens with:

> *"Two copies of a concurrency primitive is itself a bug surface (a fix to one silently doesn't
> apply to the other) — **this is the single canonical implementation.** Every per-project (or
> otherwise fleet-scaled) fan-out in the app should route through this instead of inventing another
> `Promise.all(items.map(...))`."*

Measured: **five bodies of the same cursor-sharing worker pool.**

| # | site | name | width | cancellable | `limit` floor |
|---|---|---|---:|:-:|---|
| 1 | `src/lib/concurrency.ts:18` | `mapWithConcurrency` | caller | ❌ | `Math.max(1, Math.min(…))` |
| 2 | `src/features/teams/sub_mastermind/lib/liveState.ts:69` | `boundedForEach` | caller | ❌ | same, **body byte-identical minus the results write** |
| 3 | `src/features/plugins/drive/hooks/useDrive.ts:83` | `runBulk` | `BULK_OP_CONCURRENCY = 8` | ❌ | `Math.min(…)` only |
| 4 | `src/features/vault/shared/playground/useApiTestRunner.ts:64` | `runWithConcurrency` | `CONCURRENCY = 5` | ✅ `cancelled.current` | `Math.min(…)` only |
| 5 | `src/features/agents/sub_executions/libs/useBulkRerun.ts:214` | *(inline, unnamed)* | `MAX_CONCURRENT = 3` | ✅ `cancelledRef.current` | `Math.min(…)` only |

Copy #2 lives **in the same directory** as `sceneStore.ts`, which re-exports the canonical one
(`sceneStore.ts:56`). The consolidation that produced `concurrency.ts` searched for the two copies
it knew about; it never enumerated the places that needed the behaviour. That is the doctrine's
*"fixing every instance of a defect is not the same as covering every place that needs the
behaviour"* — committed by the fix itself.

**And the copies have already diverged on the thing that matters most:** 2 of 5 can be cancelled,
3 cannot. The canonical one is in the group that cannot.

### 3 — the chunk loop that chunks nothing, at the app's cold-start path

`src/lib/eventBridge.ts:1108-1114`:

```ts
const bulkSize = EVENT_BRIDGE_TIMING.INIT_BATCH_SIZE_BULK;   // 16
const bulkBatches: EventRegistration[][] = [];
for (let i = 0; i < normal.length; i += bulkSize) bulkBatches.push(normal.slice(i, i + bulkSize));
await Promise.all(bulkBatches.map(attachBatch));             // <-- fires EVERY batch at once
```

`attachBatch` is itself `await Promise.all(batch.map(tryAttach))`. So the outer `Promise.all` runs
all the batches concurrently and each batch runs all its items concurrently: **actual peak
concurrency = `normal.length`, exactly what it would be with no chunking at all.** Replayed at the
live shape (registry = 31 entries, 3 critical → `normal` = 28, `bulkSize` = 16):

```
eventBridge.ts:1108-1114 shape, normal=28 bulkSize=16 -> { batches: 2, peak: 28 }
  the SAME input with no chunking at all               -> { batches: 1, peak: 28 }
  the one-word fix (for..of + await)                   -> { batches: 2, peak: 16 }

  at normal=60 : peak=60      at normal=120: peak=120      at normal=400: peak=400
```

The cost is one array allocation and the belief that a burst is bounded. The comment three lines
above says *"Modern Tauri 2 IPC handles batches in the 15-20 range without the jank that motivated
the original size-5 cap on Tauri 1"* — a carefully reasoned number that has never been applied.
The **compliant** form of the identical construction is 40 lines away in
`src/lib/icons/autoAssignIcons.ts:88-108`, which puts the `await` *inside* the chunk loop and
measures at `peak: 5` over 78 personas. **The whole difference is where the `await` goes.**

### 4 — the fan-out that spends money has its cap wired to the number of items

`src/features/plugins/dev-tools/sub_lifecycle/competitions/NewCompetitionModal.tsx:60`:

```ts
try { await startBatchExecution(taskIds, taskIds.length); }
```

`dev_tools_start_batch` (`task_executor.rs:652-676`) builds `Semaphore::new(max_parallel)` from
that argument. Passing `taskIds.length` makes the permit count equal the task count: **the
semaphore is present, constructed, and mathematically incapable of blocking.** Each task spawns a
Claude Code CLI child.

Two aggravations in the same file:
- `dev_tools_start_batch` has **no clamp** — `max_parallel.unwrap_or(2)` and nothing else — while
  its sibling `dev_tools_start_auto_run` 800 lines later reads
  `max_parallel.unwrap_or(2).clamp(1, 8)` **and** bounds the *items* too, via
  `list_ready_tasks(&pool, &project_id, max_parallel)` (`:1481`, `:1528`). Same file, same author,
  same concept, one armed.
- The frontend's own constants declare `MIN_PARALLEL = 1; MAX_PARALLEL = 8;` under the comment
  *"Bounds for the concurrency stepper — **mirrors the executor's own clamp**"*
  (`RunDeskControls.tsx:28-29`). That is true of the auto-run door and false of the batch door, and
  the competition modal goes through the false one.

The frontend has the same shape with a comment celebrating it.
`src/features/teams/sub_deliberations/useTeamDeliberations.ts:298-317`:

> *"(`Promise.all` → **true parallelism**: each advance is its own Tauri command), looping until all
> tracks leave the auto-advance set or the user stops."*

`advanceTeamDeliberation` → `advance_one_deliberation` → a model turn, each governed by its own
`DEFAULT_COST_BUDGET_USD = 5.0` **per deliberation** ([`spend-ceilings`](./spend-ceilings.md) §3).
Live: **142 deliberations, 6 tracks under the widest parent, mean $0.97 and max $4.73 each**, and
the fan-out sits inside a `while` loop that re-fans every round. Six concurrent $5 ceilings is a $30
round with no aggregate ceiling — and this app has [never run under a dollar ceiling](./spend-ceilings.md).

### 5 — the best fan-out primitive in the Rust tree has zero reachable call sites

`src-tauri/src/engine/build_session/orchestrator.rs:55` `run_lanes(max_parallel, tasks) ->
Vec<LaneOutcome<T>>` is the answer this document would otherwise have to invent: a semaphore
clamped with `.max(1)`, `catch_unwind` per lane, input-order results, and — the important part —
**a return type in which partial failure is the only representable answer.** The contract's
*"Prefer the primitive that exists"* clause names it by name.

It has **two** call sites outside its own tests, and neither runs:
- `build_session/fanout.rs:288` — the file is `#![allow(dead_code)]` and its own header says
  *"STATUS — first draft, **NOT yet wired**, NOT runtime-verified"*.
- `build_session/tool_tests.rs:995` — gated on `std::env::var("PERSONAS_SCRIPTED_TOOL_TESTS") ==
  Some("1")`, and that string appears in **three** places in the repo, all of them reads. Nothing
  sets it.

Doctrine Q3, exactly: *a type nobody constructs constrains nothing.* Meanwhile the two `try_join_all`
sites that *do* run (`gitlab.rs:259`, `:744`) are byte-identical copies with no width, no item
bound, and a return type — `Result<Vec<T>, E>` — in which "5 of 8 credentials were pushed to
GitLab" cannot be expressed.

---

## Principle (stack-free head)

Per the [portability test](../research/portability-test.md) the head carries no file path, primitive
name or count, so an adopting repo can tell physics from local calibration. Each clause names its
warrant.

> **P1 — physics.** **A fan-out has two bounds, not one: how many run at once, and how many there
> are.** A width limiter with an unbounded item list is bounded in CPU and unbounded in memory,
> in queue depth, and in money. Decide both, in the same breath, and write both down.
> *Warrant: 4 of 5 sibling repos bound items somewhere; only 2 bound both deliberately, and the one
> that does it best keeps them as separate tunables.*
>
> **P2 — physics, and the clause everyone gets backwards.** **Fail-fast does not stop the work; it
> stops the reporting.** By the time the first item rejects, every sibling item is already
> dispatched (an eager fan-out) or will be dispatched by workers that never learned to stop (a
> pool). Choose fail-fast for *legibility*, never for *cost*, and if you need the siblings to
> actually stop, you need cancellation — a different mechanism entirely.
> *Warrant: executed here at three shapes; and 0 of 6 repos, including this one, cancel the
> surviving items when a fan-out gives up.*
>
> **P3 — physics.** **Partial success must be representable in the return type.** A fan-out that
> returns `Result<Vec<T>, E>` has told the caller that "all of them" and "none of them" are the only
> outcomes, which is false the moment N > 1. Return one outcome per item, tagged with which item it
> was.
> *Warrant: the one repo-local primitive that does this needs no per-caller discipline; every site
> that doesn't either loses the partial result or re-invents the tagging by hand.*
>
> **P4 — physics.** **Chunking is not bounding unless you `await` the chunk.** Splitting a list into
> batches and then dispatching all the batches concurrently is arithmetic, not a limit. This is the
> single most common way a fan-out looks bounded in review and is not.
> *Warrant: measured here at 28, 60, 120 and 400 items — peak concurrency equalled the input length
> at every size, against a declared cap of 16.*
>
> **P5 — physics.** **The width must not be derivable from the item count.** A limiter whose limit
> a caller can set to `items.length` is a limiter the caller can switch off without deleting it,
> and reviewers do not read the argument.
> *Warrant: one live call site does exactly this on the path that spawns billable CLI children.*
>
> **P6 — physics.** **Every degenerate limit value must be a decision somebody typed.** Zero, one,
> negative, and not-a-number are four different inputs, and a numeric limit silently accepts all
> four. The dangerous one is not the deadlock — it is the limiter that runs **zero** workers,
> resolves successfully, and returns a full-length array of nothing.
> *Warrant: six codebases contain five different meanings for a limit of 0 — unlimited, serial,
> permanent deadlock, silent no-op, and refuse — and three sibling repos share one silent-no-op bug
> that arrived by copy-paste.*
>
> **P7 — ergonomics.** **A concurrency limit is a claim about a shared resource, so name the
> resource in the same comment.** "4" is not a number, it is a hypothesis about a connection pool,
> an IPC bridge, a rate limit, or a CPU. A limit without its resource cannot be re-tuned by the next
> person and cannot be audited when the resource changes.
> *Warrant: the strongest constants in all six repos are the ones whose comment names what they are
> protecting; the weakest are bare integers, and those are the ones that got copied.*
>
> **P8 — ergonomics.** **One limiter per codebase, or the fix will not reach the copies.** A
> concurrency pool is ~12 lines, which is exactly the size at which re-typing it feels cheaper than
> importing it — and exactly the size at which the divergence is invisible in review.
> *Warrant: physics, 5 of 6 repos. Five copies here, four across the siblings, and one sibling
> contains two copies 260 lines apart.*
>
> **P9 — physics, and the one that decides whether any of the above was real.** **Measure the
> concurrency you actually reached.** A cap nobody ever hit and a cap that does not work look
> identical in the source. The query is a sweep-line over start/end timestamps and it is the only
> evidence that exists.
> *Warrant: it is how the "4 vs 10" question was settled here in one query, and how the uncapped
> lane's real width (9) was learned.*
>
> **Scale condition.** P2, P3 and P6 are correctness on day one. P1 and P4 bite the first time the
> collection is user-sized rather than developer-sized. P5 bites the first time a caller wants it
> faster. P7 and P8 are what make the rest survive a second author.

---

## 1. Trigger

- "These are independent — can't we just do them all at once?"
- "This loop is slow because it awaits each one; let me `Promise.all` it."
- "How many of these should run in parallel?" / "What's a sensible limit here?"
- "What happens if one of them fails — do the others still run?"
- "I chunked it into batches of 20."
- "Fan out one sub-agent per capability / per project / per persona."

**If you are about to type** `Promise.all(` followed by anything that is not a `[`, `join_all`,
`try_join_all`, `FuturesUnordered`, `.buffer_unordered(`, `.for_each_concurrent(`, `JoinSet::new()`,
`Semaphore::new(`, `par_iter()`, `tokio::spawn` inside a `for`, or a `for (let i = 0; i < xs.length;
i += N)` chunk loop — **you are in this situation.**

You are **not** in this situation for `Promise.all([a(), b(), c()])` over a fixed literal tuple of
independent calls. That is parallel-await, its width is a compile-time constant, and 122 of this
repo's 181 combinator call sites are that. Do not "fix" them.

### Boundaries with the adjacent leaves

- [**`job-claim-and-lease`**](./job-claim-and-lease.md) owns **taking one row exclusively and giving
  it back.** This path owns **how many rows you take at once.** Its `InflightGuard` answers "am I
  already doing this one"; this path answers "how many at once", and the two are routinely confused —
  an in-memory set is not a width.
- [**`background-loop`**](./background-loop.md) owns **the tick that calls the fan-out** and its
  cancellation. This path owns **what the tick does with the list it just read.**
  `spawn_subscriptions` (`subscription.rs:1451`) spawns one long-lived loop per subscription — that
  is a loop-lifecycle question, not a burst, and it belongs there.
- [**`cancelling-in-flight-work`**](./cancelling-in-flight-work.md) owns **the deliberate stop.**
  This path owns **the accidental one** — what the N−1 siblings do when the caller stops caring, a
  question no repo in the cohort answers (§6 clause 8).
- [**`spend-ceilings`**](./spend-ceilings.md) owns **the dollar bound.** This path owns **the
  multiplier applied to it.** Its P5 ("a limit checked against completed work cannot see work in
  flight… N concurrent lanes multiply that") is *this leaf, named from the money side*: the
  overshoot it measures at $34.58 is `width × p99 cost`, and width is what this path bounds.
- [**`headless-model-call`**](./headless-model-call.md) owns **one call's envelope.** This path owns
  **how many envelopes leave at once.**
- [**`retry-with-backoff`**](./retry-with-backoff.md) owns **doing the same thing again.** A retry
  inside a fan-out multiplies the width by the attempt budget; neither path owns that product, so
  say it out loud where they meet.

## 2. The one way

**Pick the width and the item bound before you write the call, express partial failure in the
return type, and route through the one limiter your codebase already has.** Concretely: (a) **bound
the items first, at the source** — a `LIMIT` in the query, a `.slice(0, N)`, or an outright refusal
— because a width limiter over an unbounded list still allocates the whole list and still owes every
item its money; `list_ready_tasks(pool, project, max_parallel)` is that move and it is one argument
long. (b) **Choose a width that names the resource it is protecting in the same comment** — a
connection pool, an IPC bridge, a provider rate limit — and never let that width be derived from the
item count, because a limit a caller can set to `items.length` is a limit that can be switched off
without being deleted. (c) **Make failure part of each item's value, not of the combinator's**: on
the backend return `Vec<LaneOutcome<T>>` (one tagged outcome per item) rather than `Result<Vec<T>,
E>`; on the frontend give the mapper an infallible signature by catching inside it, exactly as
`eventBridge`'s `tryAttach` does — *then* `Promise.all` cannot reject and the choice between it and
`allSettled` stops mattering. (d) **Never reach for `try_join_all`** unless you can articulate what
the already-committed side effects of the completed items mean, because it discards them and its
type cannot carry them. (e) **If you chunk, `await` the chunk** — `for (const b of batches) await
run(b)` — since `Promise.all(batches.map(run))` is a no-op limiter, proven at four input sizes in
§0.3. (f) **Acquire the permit before you spawn, not inside the spawned task**, so the loop throttles
at the source and N tasks are not materialised to sleep on a semaphore. (g) **If the fan-out spends
money or spawns processes, the width is a cost decision** — write `width × p99 unit cost` in the
docstring, and check it against whatever ceiling governs the lane. (h) **Assume nothing stops** —
when the caller gives up, the siblings keep running; if that is unacceptable you need a
cancellation token threaded into every item, and you must add it deliberately because no default
gives it to you. Then stop: do not add a second limiter beside the shared one, do not chunk *and*
limit, and do not spawn a task whose only job is to wait for a permit.

If you must get one right first: **(c)**. (a), (b), (e) fail loudly the first time the collection is
big. (c) fails silently and permanently — the caller gets `Err` or an exception and never learns
which three of the eight succeeded, and the side effects are already on disk.

## 3. Mandated primitives

**Exist today — use them:**

| primitive | what it gives you |
| --- | --- |
| `src-tauri/src/engine/healthcheck.rs:686-718` — `stream::iter(targets).map(async …).buffer_unordered(HEALTHCHECK_SWEEP_CONCURRENCY).collect()` | **the one Rust site to copy.** The futures are never materialised (the stream is lazy, so items are bounded by the width, not by the list length); every item catches its own error into a **typed** `HealthProbeState`; the summary reports **three** buckets (`summarize_probe_states`, `:644`) because folding "never probed" into "passed" was a real bug. Nothing can reject. |
| `src-tauri/src/engine/build_session/orchestrator.rs:55` — `run_lanes(max_parallel, tasks) -> Vec<LaneOutcome<T>>` | **the type this leaf wants.** `Semaphore::new(max_parallel.max(1))` so a 0 cannot deadlock, `catch_unwind` per lane, input-order results, and **partial failure is the only representable answer**. Adopt it — but see §7 D6: it has zero reachable call sites, so adopting it means wiring it. |
| `src-tauri/src/engine/cloud_webhook_relay.rs:169-213` | **the three-layer timeout**, and the comment that explains it: a per-item `WEBHOOK_RELAY_ITEM_TIMEOUT` so *"one slow deployment cannot consume the whole round's 30s outer budget"*, plus the outer 30 s as *"a last-resort guard against the whole round hanging, not the per-call bound"*. Also the only place that takes a **fresh semaphore per round** with the reason written down (`:242-245`). |
| `src-tauri/engine/src/test_runner.rs:1613, :1661-1663` | **acquire the permit BEFORE `tokio::spawn`**, with the reason stated: *"so the loop throttles the fan-out at the source; the task holds it for its lifetime."* One semaphore across a **triple-nested** scenario × model × variant loop — the correct answer to nesting. Plus a per-cell `tokio::select!` on a cancellation token whose dropped future relies on `kill_on_drop` (`:1673-1681`). |
| `src-tauri/src/commands/infrastructure/task_executor.rs:1481, :1528, :1544-1555` — `dev_tools_start_auto_run` | **both bounds, in two lines.** `max_parallel.unwrap_or(2).clamp(1, 8)` bounds the width; `list_ready_tasks(&pool, &project_id, max_parallel)` bounds the **items** at the query; a `JoinSet` drained by wave bounds the memory. The compliant sibling of §7 D1. |
| `src/lib/concurrency.ts:18` — `mapWithConcurrency(items, limit, fn)` | the frontend limiter. **13 importing modules, 14 production call sites.** Shared cursor, results in input order regardless of completion order, width clamped to `items.length`. Use it — and read §7 D3 and §8 Gap 2 first, because its `limit` accepts `NaN` and its failure path keeps spending. |
| `src/lib/eventBridge.ts:169-175` — `tryAttach` | **the infallible mapper.** Returns a discriminated `AttachOutcome` (`{ok:true,…} \| {ok:false, reg, reason}`) so the fan-out cannot reject and every failure keeps its identity. Its docstring even argues why this beats `allSettled` here: it *"avoids the `noUncheckedIndexedAccess` traps that come with running `Promise.allSettled` over a parallel registrations array."* This is P3 on the frontend, and it is 6 lines. |
| `src/lib/icons/autoAssignIcons.ts:88-108` | **the correct chunk loop** — `await` inside the `for`, per-item `.catch(silentCatch(…))`, measured peak 5 over 78 personas. Copy this whenever you were about to chunk. |
| `src-tauri/src/commands/companion/approvals/approval_exec_knowledge.rs:464, :690-693` | **bound by refusal, not by queueing** — `if live.len() >= APPLY_MAX_CONCURRENT_PER_REPO { return Err("… wait for one to settle") }`, with the constant's comment naming the resource (*"they share one checkout; four writers on the same files is the 2026-05-09 incident with extra steps"*). The strongest concurrency comment in the tree. |

**Do NOT build:** a sixth copy of the worker pool (§7 D3); a `try_join_all` over anything with side
effects (§7 D2); a chunk loop whose `await` is outside it (§7 D4); a `Semaphore::new(n)` where `n`
came from an IPC parameter without a clamp (§7 D1); a `tokio::spawn` per item whose first statement
is `semaphore.acquire()` (materialises N tasks — `test_runner.rs:1661` shows the fix); a width equal
to `items.length`; a second limiter beside `mapWithConcurrency`.

## 4. Steps

1. **Decide whether this is a fan-out at all.** A fixed literal tuple of 2–10 independent calls is
   not one — 122 of this repo's 181 combinator sites are that, they are correct, and touching them
   is churn. You are in this path only when the width is `someCollection.length`.
2. **Bound the items, at the source.** Put the `LIMIT` in the query
   (`list_ready_tasks(…, max_parallel)`), the `.slice(0, N)` before the map, or an explicit refusal
   at the door. Ask "what is this at 10× the current data?" — the answer for `dev_tools_start_batch`
   is "as many CLI children as there are rows".
3. **Pick the width and name the resource it protects.** One line: *"3 — probing many credentials
   that share an API host doesn't trip provider rate limits"* (`healthcheck.rs:611-613`) is a width
   the next person can re-tune. A bare `4` is not. **The modal choice in this repo is 4 (8
   occurrences); the strongest is the one with the sentence.**
4. **Ask whether the type can make the wrong call impossible — before you write the gate.** On the
   backend it can and the repo has already written it: `Vec<LaneOutcome<T>>` (see *Type over gate*
   below). On the frontend it cannot reach `Promise.all`, which is a language builtin — so the
   frontend gets a gate and the backend gets a type, and §9 says so.
5. **Make the per-item function infallible.** Backend: return a typed outcome, as
   `run_all_healthchecks` does. Frontend: `tryAttach`'s discriminated union, or at minimum a
   `.catch()` **inside** the map. Once the mapper cannot reject, `Promise.all` and `allSettled` are
   the same function and you have stopped guessing.
6. **Route through the shared limiter.** `mapWithConcurrency` on the frontend, `buffer_unordered` /
   `run_lanes` on the backend. If you are typing `let cursor = 0`, stop — that is copy #6.
7. **If you chunk, `await` the chunk.** `for (const b of batches) await run(b)`. Verify by counting:
   instrument the mapper with an in-flight counter and assert the peak. That test is six lines and
   it is the one `eventBridge` does not have (§8 Gap 4).
8. **Acquire the permit before you spawn.** `let permit = sem.clone().acquire_owned().await;` then
   `tokio::spawn(async move { let _permit = permit; … })`.
9. **Write the cost line.** If an item spawns a process or calls a model:
   `// width 4 × p99 $3.96 ≈ $16 in flight` in the docstring, and check it against the lane's
   ceiling. [`spend-ceilings`](./spend-ceilings.md) §4.5 is the other half of this sentence.
10. **Decide what happens when the caller gives up, and write it down even if the answer is
    "nothing".** The default is that every sibling keeps running and keeps spending. If that is
    unacceptable, thread a cancellation token or an `AbortSignal` into each item —
    `test_runner.rs:1673-1681` is the only site in the tree that does.
11. **And then stop.** Do not add a second limiter, do not chunk *and* limit, do not wrap it in a
    transaction, and do not add a retry inside the mapper without multiplying the width by the
    attempt budget in step 9.

### Can the type make the wrong call impossible? — asked before §9

**On the backend, yes, and the repo has already written it once.** The bad state is not "too many at
once" — it is **"the caller cannot express that 5 of 8 worked"**. `try_join_all(...) -> Result<Vec<T>,
E>` makes partial success *unrepresentable*, which is why `gitlab.rs:259` can leave a GitLab project
half-provisioned and report a single error naming one variable. `run_lanes(...) ->
Vec<LaneOutcome<T>>` makes partial success **the only representable answer**: there is no
`Result<Vec<_>>` to unwrap, no early `?`, and the caller must decide per item. Q1 holds (it encodes
exactly per-item outcome and nothing about width); Q3 is the live objection — it has zero reachable
call sites today, so this is a proposal to *wire* a type, not to *write* one.

**On the frontend, no — and that is the finding, not a failure.** The dangerous freedom is
`Promise.all` accepting an array of unbounded length, and `Promise.all` is a language builtin that
cannot be withheld (Q5 has nothing to withhold). What *can* be fixed at the primitive, per the
contract's *"prefer fixing the default over counting the callers"*, is `mapWithConcurrency`'s `limit:
number`, which today accepts four degenerate values with three different behaviours (§8 Gap 2) — one
of which silently returns success having called `fn` zero times. That is a one-line edit at the
primitive and it corrects every present and future call site. The width itself has no type that
reaches it, so **the frontend half is where a census rule genuinely earns its place.**

## 5. Anti-patterns

| Anti-pattern | Failure mode |
|---|---|
| **`Promise.all(xs.map(f))` where `xs` is runtime-length** | The width is whatever the data is. **44 sites.** Executed: at 30 items with a rejection at #2, all 30 had already been dispatched — you did not save the work, you lost the results. |
| **Chunking, then `Promise.all(chunks.map(run))`** | Arithmetic dressed as a limit. Executed at 28/60/120/400 items: peak concurrency **equalled the input length every time**, against a declared cap of 16. §7 D4. |
| **`try_join_all` over anything with a side effect** | The first `Err` short-circuits and drops the rest, and the return type has no room for the ones that already succeeded. `gitlab.rs:259` pushes credentials to GitLab this way, twice, in two byte-identical copies. §7 D2. |
| **A width the caller can set to `items.length`** | The limiter is present, constructed, and cannot block. `NewCompetitionModal.tsx:60` does this on the path that spawns billable CLI children. §7 D1. |
| **`Semaphore::new(n)` where `n` came from an IPC parameter** | `n = 0` gives a semaphore with zero permits that **never** hands one out; every spawned task blocks forever holding a pool handle, and the command has already returned `Ok`. The sibling primitive 600 lines away writes `.max(1)`. §7 D1. |
| **`tokio::spawn` per item with `acquire()` as the first statement inside** | Bounds the *work* and not the *tasks*: N tasks are materialised, each holding its clones, to sleep on a semaphore. `test_runner.rs:1661` shows the one-line inversion. |
| **A per-call semaphore treated as a global cap** | Two concurrent calls get two independent budgets. `dev_tools_start_batch` builds a fresh `Semaphore` per invocation, so "max 8" means "8 per press of the button". |
| **A second copy of the pool because it's only twelve lines** | The fix to one never reaches the others, and they diverge on the thing you would most want fixed. **Five copies here; 2 support cancellation and 3 do not, and the canonical one is in the wrong group.** §7 D3. |
| **A bare integer as the limit** | Not re-tunable and not auditable. Compare `const HEALTHCHECK_SWEEP_CONCURRENCY: usize = 3;` — *"so probing many credentials that share an API host doesn't trip provider rate limits"* — with `.for_each_concurrent(4, …)` (`polling.rs:195`), which is the same decision with the reasoning deleted. |
| **Assuming `allSettled` is the safe choice** | It is the *legible* choice. It does not change what runs, when it runs, or what it costs. Reaching for it to "avoid losing work" is a misunderstanding this document exists to correct. |
| **Nesting two uncapped fan-outs** | Real concurrency is the product and nobody wrote either factor. `centerShared.tsx:106/108` — outer over workspaces, inner over statuses — is the only fully-unbounded product found across six codebases (§6). |
| **A fan-out over a model call with no aggregate ceiling** | Every item carries its own budget and nothing carries the sum. `useTeamDeliberations.ts:311` fans out over open tracks (live max 6), each with a $5.00 floor, inside a `while` loop. |

## 6. Evidence

**The one site to copy: `src-tauri/src/engine/healthcheck.rs:657-729` — `run_all_healthchecks`.**

```rust
let results: Vec<CredentialHealthcheckOutcome> = stream::iter(targets)
    .map(move |(id, name)| async move {
        let (success, state, message) = match run_healthcheck(pool, &id).await {
            Ok(r)  => (r.success, r.state, r.message),
            Err(e) => (false, HealthProbeState::Failed, e.to_string()),   // <- the item owns its failure
        };
        …
        CredentialHealthcheckOutcome { credential_id: id, credential_name: name, success, state, message, duration_ms }
    })
    .buffer_unordered(HEALTHCHECK_SWEEP_CONCURRENCY)     // <- 3, with the resource named at :611-613
    .collect()
    .await;
```

Five decisions worth copying: (1) the stream is **lazy**, so `targets.len()` futures are never
materialised — the only construction in the tree that bounds memory as well as concurrency; (2) the
per-item error is converted into a **typed value**, so the combinator has nothing to short-circuit
on; (3) the summary reports **three** buckets, because `summarize_probe_states` (`:637-655`) exists
to stop "never probed" being counted as "passed"; (4) the width's constant names the resource it
protects; (5) the function's own docstring records **why the fan-out moved to the backend at all**:

> *"Running the loop inside the engine … avoids firing N concurrent **privileged** IPC calls from
> the frontend. That stampede raced the `x-ipc-token` injection (see `ipc_auth.rs`) and produced
> spurious 'degraded' cards even though the stored keys were valid and the probe never ran."*
> — `healthcheck.rs:660-666`

**This repo has already been burned by an unbounded frontend fan-out, in production, and the
incident report is a docstring.** That is the strongest single argument in this document, and it
predates it.

**Also exemplary:**

- **`src-tauri/src/engine/build_session/orchestrator.rs:52-91` — `run_lanes`.** The return type is
  the whole point; `Semaphore::new(max_parallel.max(1))` is pinned by its own test at `:158`
  (`run_lanes(0, …)`), which is the only test in the tree that asserts a degenerate width.
- **`src-tauri/engine/src/test_runner.rs:1601-1699`.** A triple-nested loop with **one** semaphore
  across the whole run, acquired before the spawn, plus a budget-halt check between scenarios
  (`:1634`) that sets `halted_by_budget` so a *disclosed* partial run is distinguishable from cells
  lost to panics. The nesting answer and the money answer in one function.
- **`src-tauri/src/engine/cloud_webhook_relay.rs:169-286`.** Two rounds, a fresh semaphore each with
  the reason written down, a per-item timeout *and* a round timeout with their roles distinguished,
  and per-item results collected as `(index, Result)` tuples so a failed deployment logs and the
  round continues.
- **`src/lib/eventBridge.ts:169-175` + `:1088-1099`.** The infallible mapper, and Wave 1's
  `await attachBatch(critical)` — a sequential await that is the *correct* form of the construction
  Wave 2 gets wrong 25 lines later.
- **`src-tauri/src/commands/infrastructure/task_executor.rs:1471-1558`.** Both bounds, a `JoinSet`
  drained per wave, and `.clamp(1, 200)` on the iteration count so the outer loop is bounded too.

### Convergence — 5 sibling repos

Swept read-only against `../personas-web`, `../brainiac`, `../personas-cloud`, `../vibeman`,
`../ascent`. **All five exist and all five were opened.** The oracle **refuted the brief's central
hypothesis** and **changed this document's §9**.

| # | clause | verdict | evidence |
| --- | --- | --- | --- |
| 1 | **Most fan-out sites are literal tuples, not fan-outs** | **PHYSICS (5/5)** | `personas-web` 13/18, `vibeman` 20/50, `ascent` 49/63, Personas **122/181**. Any audit that greps `Promise.all` and reports the raw count is over-reporting by 2–4×. |
| 2 | **A shared limiter is extracted** | **MINORITY (1/5) — and extracting it makes your repo score WORSE on the obvious metric** | Only `ascent` (`src/lib/pool.ts:14` `mapPool`, 7 call sites, 12-case test file). **Its 7 bounded fan-outs contain no `Promise.all` token at all, so a `Promise.all` census reports ascent as 2:7 — the worst of the four JS repos — when it is the best.** This inverted §9 (see below). |
| 3 | **The limiter gets copy-pasted** | **PHYSICS (4/6) — the same 12-line body, written 9 times across 6 repos** | `ascent` has **two** (`pool.ts:14` and a private `pool` at `github/source.ts:261`, 260 lines apart, one call site); `vibeman` `git/branches/route.ts:21` (named `mapWithConcurrency`, no shared code with ours); `personas-web` `useReviewBulkActions.ts:125` (inline, never extracted). **Personas has five.** All nine share the identical `results` + `cursor` + `Array.from({length: Math.min(limit, n)})` shape. |
| 4 | **The literal number is 4** | **VERIFIED by repo (3/5), REFUTED as the mode by site** | `ascent/src/lib/pool.ts:37 SCAN_CONCURRENCY = 4` (pinned by `pool.test.ts:254`), `ascent .../digest/route.ts:46 DIGEST_CONCURRENCY = 4`, `brainiac/worker.rs:41 DEFAULT_CONCURRENCY = 4`, `vibeman/embeddings.ts:132 CONCURRENCY = 4`. But **5** wins on site count (`vibeman` alone has six). **Personas' modal value is 4 with 8 occurrences** — `queue.rs:10`, `test_runner.rs:37`, `polling.rs:195`, `approval_exec_knowledge.rs:464`, `useImproveActions.ts:106`, `useSkillsRegistry.ts:122`, `llmSpend.ts:23`, plus a doc example. |
| 5 | **⚠ THE BRIEF'S HYPOTHESIS — "outer loop uncapped, inner cap ≈4"** | **REFUTED — 0 of 5** | Call chains were traced, not pattern-matched. `ascent` `rescan/route.ts:77 mapPool(due, 4)` → `scan.ts:221` → `exposure.ts:81 mapPool(sampled, 6)` = **bounded × bounded, 24 peak**. `brainiac` `worker.rs:183 buffer_unordered(4)` → `retrieval.rs:377 try_join!` = bounded × static 2. `vibeman` `regenerate-group/route.ts:66` is a **strictly sequential** `for` over an inner `CONCURRENCY = 5`. `personas-web`, `personas-cloud`: no nests. **The likely source of the original claim is `ascent/rescan/route.ts:53`, an uncapped `Promise.all` that is a sibling *phase* 24 lines above the bounded `mapPool` — adjacent in the file, not nested in the call graph.** |
| 6 | **Personas has the only fully-unbounded nest in the cohort** | **LOCAL — 1 of 6** | `centerShared.tsx:106/108`, uncapped × uncapped. The nearest sibling is `ascent/org/portfolio.ts:77` (uncapped outer × static 2-tuple inner). |
| 7 | **Fail-fast dominates, and the sibling consequence is written down once** | **PHYSICS (35 fail-fast : 13 settle-all across the siblings)** | `ascent` is **100% fail-fast** across all 9 dynamic sites. **Only `brainiac` states what happens to the others** (`worker.rs:156-178`): *"Per-job isolation is total … one job's `Err` → its own `fail()` and never touches another's transaction. Only an *infrastructure* failure propagates out of a job future and aborts the tick."* `ascent/pool.ts:10-12` argues error *ownership* but never says the surviving lanes keep draining the cursor. **Personas: 13 of 44 catch per item; 31 do not.** |
| 8 | **Cancellation reaches the items; and the siblings stop** | **1 of 6 for the first half; SILENCE, 0 of 6, for the second** | `ascent` threads `AbortSignal` into every item (`exposure.ts:81`, rationale at `scan.ts:97-100`) — the only repo that does. **No repo cancels the surviving items when the fan-out gives up**, and `ascent`'s own test file pins *"rejects the whole pool"* and *"no item runs twice"* while asserting nothing about what the survivors do. Personas is ahead on the Rust side only: `test_runner.rs:1673-1681` races each cell against a cancellation token and relies on `kill_on_drop`. |
| 9 | **Items are bounded, not just concurrency** | **PHYSICS (4/5) somewhere; MINORITY (2/5) deliberately** | `brainiac` is best-in-class and keeps them as **separate tunables**: `worker.rs:170 queue::read(…, cfg.batch /*8*/)` bounds items, `:183 buffer_unordered(4)` bounds in-flight. `vibeman` is the only repo that **refuses** rather than truncates (`batch-requirements/route.ts:26` → HTTP 400 above 100 paths). `ascent/exposure.ts:80-83` truncates but adds the overflow back conservatively. Personas does it once (`list_ready_tasks(…, max_parallel)`) and not at all in the fan-out that spawns CLI children. |
| 10 | **`0` means unlimited** | **SILENT (0/5) — this is a Personas-only convention** | No sibling uses 0 for unlimited; no sibling has a `Semaphore::new(0)`. `ascent/pool.ts:22 Math.max(1, Math.min(concurrency, n))` → 0 means **serial**, pinned by `pool.test.ts:186`. `brainiac` floors it **twice** (`worker.rs:73` and `:171`). **Personas' `queue.rs:157` `global_max_concurrent == 0 \|\| …` is the only "0 = unlimited" in six codebases** — and its own `task_executor.rs:663` `Semaphore::new(max_parallel)` would *deadlock* on 0. The literal `0` means five different things across the cohort. |
| 11 | **A limiter can silently run zero workers and report success** | **PHYSICS as a DEFECT (4/6), and it travelled by copy-paste** | `ascent/github/source.ts:269`, `vibeman/git/branches/route.ts:28`, `personas-web/useReviewBulkActions.ts:142` all dropped the `Math.max(1, …)` floor when the body was copied — a limit of 0 yields zero runners, `Promise.all([])` resolves, and **every item is silently skipped with no error**. `ascent` wrote the correct floor in `pool.ts` and omitted it in its own copy. **Personas kept the floor and lost the same property to `NaN` instead** (§8 Gap 2) — same failure, different door. |
| 12 | **`par_iter` is an unaudited fourth primitive** | **noted, 1/5** | `vibeman/src-tauri/src/brain/{correlate.rs:96, decay.rs:37, triage_cmds.rs:174}` use rayon, bounded by `num_cpus` — bounded by the machine rather than by a decision, and no comment anywhere acknowledges it as a concurrency choice. Personas has **zero** `par_iter`. |

**Physics — keep as doctrine:** clauses 1, 3, 7, 9, 11 and 12-as-a-caution.
**Reported as silence:** clause 8's second half (*nobody stops the siblings*) and clause 10
(*nobody else overloads 0*). **Amended by the oracle:** clause 5 — the brief's hypothesis, refuted —
and §9, which was rewritten because of clause 2.

> **The strongest external result is clause 2, and it is a warning about measurement, not about
> code.** `ascent` is the only sibling that extracted a limiter, and extracting it removed the
> `Promise.all` token from all seven of its bounded sites — so the obvious census reports the
> best-behaved repo as the worst. **A rule that counts `Promise.all(xs.map())` measures "did you
> inline your limiter", not "did you bound your fan-out."** §9 is written to survive that, and an
> adopting repo must re-key it. This is the contract's fifth §9 failure mode arriving from a new
> direction: not a gate pointing at a broken destination, but a gate whose metric *punishes* the
> destination.

> **The counter-example that keeps it honest is `personas-cloud`, and it is negative in an
> instructive way.** It contains **zero** `Promise.all` of any kind — its concurrency model is
> slot-based dispatch to a `WorkerPool` registry (`workerPool.ts:88`, `availableSlots` /
> `maxConcurrentSlots` at `:310`), bounded at admission rather than at fan-out. A doctrine written
> only in terms of promise combinators would score it 0/0 and learn nothing. It also carries a
> comment at `dispatcher.ts:563` describing *"error counts … tracked via `Promise.allSettled` in
> CompositeSink"* — for an implementation that no longer exists; `CompositeSink` (`:581`) is a
> synchronous `for` loop with per-sink `try/catch`. **A doc-driven audit would have reported a
> fan-out that isn't there.**

## 7. Deviations

Every entry is live on `master` @ `c81519610` and was verified by reading the file, by replay, or
against a read-only copy of the operator's database.

### D1 — `dev_tools_start_batch`: no clamp, per-call semaphore, and one caller sets the width to N

`src-tauri/src/commands/infrastructure/task_executor.rs:652-676`.

```rust
let max_parallel = max_parallel.unwrap_or(2);            // :662  no clamp
let semaphore = Arc::new(tokio::sync::Semaphore::new(max_parallel));   // :663
for tid in task_ids {                                     // :666  no length bound
    tokio::spawn(async move {                             // :674  spawned first…
        let _permit = sem.acquire().await;                // :676  …permit second
```

Four defects, compounding:
- **The width can be set to the item count.**
  `NewCompetitionModal.tsx:60` — `startBatchExecution(taskIds, taskIds.length)`. The semaphore is
  constructed with as many permits as there are tasks and can never block. Each task spawns a
  Claude Code CLI child.
- **No clamp on an IPC parameter.** The sibling command `dev_tools_start_auto_run` (`:1481`) writes
  `.unwrap_or(2).clamp(1, 8)`; this one writes nothing. `max_parallel = 0` gives
  `Semaphore::new(0)` — **zero permits, never replenished** — so every spawned task blocks forever
  holding an `AppHandle` and a pool clone, while the command has already returned
  `Ok({"task_id": …})`. Not reachable from today's UI (the only caller guards `taskIds.length > 0`)
  but reachable from the IPC surface, whose only gate is `require_auth`. `orchestrator.rs:59`
  writes `.max(1)`; `run_lanes(0, …)` is even unit-tested at `:158`.
- **The permit is acquired inside the spawn**, so N tasks are materialised to sleep. `task_ids` has
  no length bound at any layer.
- **The semaphore is per call.** Two presses of the button give two independent budgets.

**And the frontend's comment says the opposite.** `RunDeskControls.tsx:28-29`:
`MIN_PARALLEL = 1; MAX_PARALLEL = 8;` under */** Bounds for the concurrency stepper — mirrors the
executor's own clamp. */* — true of `dev_tools_start_auto_run`, false of `dev_tools_start_batch`,
and the competition modal goes through the false one.

**Fix:** `let max_parallel = max_parallel.unwrap_or(2).clamp(1, 8);`, reject `task_ids.len() >
BATCH_MAX`, move `acquire_owned()` above the `tokio::spawn` (`test_runner.rs:1661` is the model),
and change `NewCompetitionModal.tsx:60` to `startBatchExecution(taskIds)` so it inherits the default.

### D2 — two byte-identical `try_join_all`s push credentials to GitLab with no width and no partial result

`src-tauri/src/commands/infrastructure/gitlab.rs:259-273` and `:744-758`.

```rust
futures_util::future::try_join_all(resolved.variables.iter().map(|variable| { … client.upsert_variable(project_id, variable) … })).await?;
```

- **No width.** One concurrent HTTPS PUT per resolved credential.
- **No item bound.** `resolved.variables` is whatever `resolve_credentials_for_gitlab` produced.
- **`try_join_all` short-circuits.** The first `Err` drops the remaining futures and propagates.
  Requests already sent are not undone, so a partial failure leaves the GitLab project **partially
  provisioned** — and the error names exactly one variable
  (`"Failed to provision credential '{}'"`), so nothing downstream can learn which others landed.
- **The return type has no room for the answer.** `Result<Vec<()>, AppError>` cannot say "5 of 8".
- **Two copies.** A fix to one is not a fix to the other, which is the same duplication physics
  [`job-claim-and-lease`](./job-claim-and-lease.md) D2 measured on the claim side.

**Fix:** one shared helper, `run_lanes(4, …)` (or `buffer_unordered(4)`), returning per-variable
outcomes; report `provisioned` and `failed` separately instead of `resolved.entries.len()`.

### D3 — five copies of the worker pool, two of which can be cancelled

Enumerated in §0.2. Beyond the duplication itself:

- `liveState.ts:69` `boundedForEach` sits **in the same directory** as `sceneStore.ts:56`, which
  re-exports the canonical one. Its body differs from `concurrency.ts:18` only in that it discards
  the result.
- `useApiTestRunner.ts:64` and `useBulkRerun.ts:214` check a cancellation ref between items;
  `concurrency.ts`, `liveState.ts` and `useDrive.ts` cannot be stopped. The canonical one is in the
  group that cannot — so migrating the two cancellable copies onto it would be a **regression**,
  which is why nobody has.
- `useApiTestRunner.ts:82` uses `Math.min(concurrency, tasks.length)` with no `Math.max(1, …)`
  floor — the identical shape that is a live silent-skip bug in three sibling repos (§6 clause 11).
  Currently fed the constant `5`, so latent.

**Fix:** add an optional `signal?: { aborted: boolean }` (or `AbortSignal`) to `mapWithConcurrency`,
then delete copies 2–5. Deleting them without it loses a behaviour two of them have.

### D4 — two chunk loops that chunk without bounding

- **`src/lib/eventBridge.ts:1108-1114`** — the cold-start listener attach. Executed in §0.3: peak
  concurrency equals the input length at 28, 60, 120 and 400. Live shape is 28 concurrent `listen()`
  registrations (and more actual IPC calls, since *"the `setup` function may register multiple Tauri
  listeners"*, `:180-183`). **Fix:** `for (const b of bulkBatches) await attachBatch(b);` — one word.
- **`src/features/plugins/companion/useTurnSidecars.ts:54-63`** — the same shape, chunking by
  `SIDECAR_BATCH_SIZE = 500` because the backend clamps ids per call, then
  `Promise.all(chunks.map(…))`. Here the chunk size is a *payload* bound, so the concurrency was
  never considered: a full-transcript export of 10,000 episodes fires **20 concurrent IPC calls
  carrying 500 ids each**. **Fix:** `mapWithConcurrency(chunks, 3, companionGetTurnSidecars)`.

The correct form of the identical construction is `autoAssignIcons.ts:88-108`, in the same `src/lib`
tree.

### D5 — the only fully-unbounded nested fan-out in six codebases

`src/features/plugins/dev-tools/sub_workspaces/centerShared.tsx:106-108`:

```ts
void Promise.all(
  wsKey.split(',').map(async (id) => {
    const pages = await Promise.all(statuses.map((status) => listWorkspaceKnowledge(id, status)));
```

Real concurrency is `workspaces × statuses`, and neither factor is bounded or written down. Live N
is small (`dev_workspaces` holds **2** rows) so this is latent, but it is the shape §6 clause 6
found nowhere else — every sibling nest has at least one bounded side.

**Fix:** `mapWithConcurrency(wsKey.split(','), 4, …)` on the outer; the inner is over a small fixed
status set and can stay.

### D6 — the best Rust primitive has zero reachable production call sites

`run_lanes` (`orchestrator.rs:55`) has 2 non-test call sites and neither executes in a default
build: `fanout.rs:288` is `#![allow(dead_code)]` with a header reading *"NOT yet wired"*, and
`tool_tests.rs:995` is behind `PERSONAS_SCRIPTED_TOOL_TESTS=1`, a string that appears three times in
the repo and is read three times and set zero times. The module header still says *"nothing in the
runner fans out yet"*, which was true when written.

This is doctrine Q3. **It is the reason §9's type proposal is "wire it", not "write it".**

**Fix:** route `gitlab.rs` (D2) through `run_lanes` — that is one real caller, in a path that
currently loses data, and it costs nothing to add.

### D7 — 31 of 44 frontend fan-outs have no per-item error handling

Measured over the census population. The 13 that do (`.catch()` or `try` inside the mapper) are
correct *whichever* combinator wraps them. The 31 that do not lose every sibling's result on the
first rejection. Notable members:

- `useTeamDeliberations.ts:311` — **has** a `.catch`, and is listed here anyway because the width is
  the defect: N open tracks × one model turn each, each with a $5.00 floor, inside a `while` loop.
  Live max 6 tracks per parent (`team_deliberations`, 142 rows, max $4.73 spent).
- `i18n/useTranslation.ts:141` — `Promise.all(sections.map(loadSection))` over up to 60 locale
  sections, no catch: one failed chunk load rejects the whole preload.
- `RotationActivePolicy.tsx:145` — `allPolicies.map(p => updateRotationPolicy(…))`, unbounded writes.
- `stores/slices/system/cloudSlice.ts:455/477/499` — pause/resume/undeploy over every deployment id;
  correctly `allSettled`, still unbounded.

**Fix:** per site, make the mapper infallible first (`tryAttach` is the model), then add a width.

### D8 — the app's own fan-out instrument has never recorded a row

`src-tauri/core/src/context_fingerprint.rs:93-105` already counts `promise_all_count`,
`join_all_count` and `spawn_count` per context, with an honest docstring (*"A PROXY, NOT A
VERDICT"*). The `dev_context_fingerprints` table holds **0 rows** on the live database, so the
counter has never measured anything, has no baseline, and fails nothing.

**Fix:** none needed here — it is a density metric, not a gate. Recorded so the next composer does
not mistake it for one, and so §9's rule is not read as a duplicate of it.

## 8. Gaps

1. **`Promise.all` cannot be withheld.** It is a language builtin, always in scope, and the correct
   answer 122 times out of 181 in this repo. No type, lint-restricted-import, or wrapper removes the
   dangerous freedom, which is why the frontend half of §9 is a gate and not a type.
2. **`mapWithConcurrency(items, limit: number, fn)` accepts four degenerate widths with three
   behaviours, and one of them silently succeeds.** Replayed:
   ```
   limit = 0    -> Math.max(1, Math.min(0, n)) = 1        => SERIAL      (safe)
   limit = -1   -> same                                    => SERIAL      (safe)
   limit = NaN  -> Math.max(1, Math.min(NaN, n)) = NaN
                   Array.from({length: NaN}) is EMPTY
                   Promise.all([]) resolves immediately
                -> returns [undefined, undefined], fn NEVER CALLED, NO ERROR
   ```
   Every current call site passes a literal, so this is latent. It is the same silent-zero-lane
   failure that is *live* in three sibling repos through a different door (§6 clause 11).
   **Fix, one line at the primitive:**
   `const width = Number.isFinite(limit) ? Math.max(1, Math.min(limit, items.length)) : 1;`
3. **Nothing in either half cancels the surviving items.** Not a repo limitation — a cohort
   limitation: 0 of 6 codebases do it, and the one that threads an `AbortSignal` into each item
   still lets the survivors drain. `test_runner.rs:1673-1681` is the closest thing in this tree and
   it works only because `kill_on_drop` is set on the child process. Any prescription here would be
   an invention; §2(h) therefore says "assume nothing stops" rather than "stop them".
4. **There is no test in this repo that asserts a peak concurrency.** `concurrency.test.ts` and
   `sceneStore.test.ts` (8 cases between them) assert ordering, emptiness and that the width is
   respected *for `mapWithConcurrency`* — nothing asserts the peak for a hand-rolled site, which is
   why `eventBridge`'s no-op chunking survived. The instrument is six lines (an in-flight counter in
   the mapper) and it is what turned §0.3 from a reading into a measurement.
5. **The census cannot see a bounded fan-out.** `mapWithConcurrency` call sites contain no
   `Promise.all` token, so improvement is invisible to the violation rule and visible only to the
   positive control. This is not a defect of the rule; it is the reason the control is mandatory
   here and the reason §9 must be read as a partition.
6. **No aggregate budget spans lanes.** Each fan-out picks its own width against its own mental
   model of the resource, and nothing sums them: the execution tracker's 10, the lab's 4, the
   knowledge-apply's 4, the relay's 6, the auto-run's 8, and the frontend's fourteen independent
   constants can all be saturated simultaneously. `brainiac` is the only repo in the cohort that
   ties a width to a named shared resource with arithmetic (`worker.rs:26-30`: *"each in-flight job
   holds one pool connection for its chain"*). This is [`spend-ceilings`](./spend-ceilings.md) P6
   on the concurrency axis and it has no owner.

## 9. The missing gate

**The condition:** *a fan-out whose width is whatever the collection's length happens to be.*

**The signal (a proxy, and stated as one):** `Promise.all(` / `Promise.allSettled(` whose first
argument is **not** a literal array and reaches a `.map(` / `.flatMap(`. This keys on the shape the
condition wears **in this repo**, where the limiter is a named function; it does **not** key on the
semantic condition. **An adopting repo must re-derive its own proxy** — see the portability note
below, which is the sharpest thing the oracle produced.

**The mechanism: a census rule.** The runner already exists
(`scripts/census/`) and implements the fail-loud contract, so this path
does not write a script.

**Where it executes:** `npm run census:check` is part of **`npm run check`** (`package.json:52`),
which the agent runs before opening a PR. It is not CI-only — which matters, because `ci.yml` is red
on 10 pre-existing Rust failures and `frontend-checks` is red on a platform-incomplete lockfile, so
**a gate that only runs in CI effectively runs nowhere** right now. This one runs on the developer's
machine, before the branch leaves it.

**Precision, hand-verified at 44/44 after a reconciliation that found a bug in the instrument.**
Two independent implementations — the census regex, and a balanced-paren argument parser that
classifies the extracted argument — reconcile **exactly at 44, with zero disagreement in either
direction.** They did not, at first: the parser reported 43 and missed
`src/lib/icons/autoAssignIcons.ts:91`, because it fed **raw source** to the paren matcher and the
line comment `// Only set color if persona doesn't have one` opened an apostrophe-string that never
closed, so the depth never returned to 0 and the site was silently dropped. The parser
under-reported and made the regex look imprecise. Stripping comments first reconciled them. *A
matcher that composes is not the same as a matcher that counts.*

The one genuinely arguable match is `autoAssignIcons.ts:91`, which is the **compliant** chunk form
(the `await` is inside the loop, measured peak 5). It is reported as a match **on purpose**: the
violating `eventBridge.ts:1114` and the compliant `autoAssignIcons.ts:91` are textually identical
apart from where the `await` sits, and a matcher that told them apart by looking backwards 400
characters produced two false classifications when I tried it. **One knowingly-listed compliant site
is better than a lookbehind that guesses.** Precision on the stated condition — *"the width is the
collection's length unless a human checks"* — is 44/44; precision on *"this is a defect"* is 43/44.

**The positive control partitions the population.** Pointed at the compliant form
(`mapWithConcurrency(`) over the same roots and extensions, it returns **22 matches in 14 files**
(14 matches in 12 files excluding `__tests__`). So the fan-out population is
**44 widthless : 14 bounded**, and the two rules move in opposite directions as the codebase
improves. That coupling is the point: if `widthless-collection-fanout` falls and the control does
**not** rise, someone deleted a fan-out instead of bounding it.

**How it fails loudly if its own precondition is absent:** `floor: 3000` against a live walk of
4,829 files (`src/` is ~4,829 `.ts`/`.tsx`), so a broken glob or a moved root fails rather than
reporting zero; a rule matching zero files anywhere is a structural failure in the runner; and a
**drop** without `--update` is fatal, because a silent drop is a broken matcher more often than it
is fixed code.

**What the gate cannot do, stated so nobody trusts it further than it goes:**
- It cannot see `Promise.all(promises)` where `promises` was accumulated by a `push` loop (8 such
  sites) or a hand-rolled pool's `Promise.all(workers)` (5 sites). Those were classified by hand.
- It cannot see the Rust half at all. The Rust fan-out denominator is **18 sites across 963 files**,
  15 of them bounded — too small a population for a ratchet to be meaningful, and the honest answer
  there is the type, not a count.
- **It counts the wrong thing in a repo that has already solved this.** `ascent` extracted `mapPool`
  and thereby removed the `Promise.all` token from all seven of its bounded fan-outs; a census keyed
  on `Promise.all` scores the cohort's best repo as its worst. The general form: **a signal keyed on
  the syntax a violation happens to wear rewards inlining the fix.** An adopting repo must key on
  *its own* raw form and pair it with *its own* limiter as the control, or the number means nothing.

```json
{
  "id": "widthless-collection-fanout",
  "goldenPath": "docs/concepts/golden-paths/bounded-parallel-fan-out.md",
  "roots": ["src"],
  "extensions": [".ts", ".tsx"],
  "signal": {
    "pattern": "Promise\\s*\\.\\s*all(?:Settled)?\\s*\\(\\s*(?!\\[)[A-Za-z_$][\\w$?.]{0,60}(?:\\((?:[^()\\n]{0,80})\\))?(?:[\\w$?.]{0,40})?\\s*\\.\\s*(?:map|flatMap)\\s*\\(",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "A `Promise.all` / `Promise.allSettled` whose first argument is NOT a literal array and reaches a `.map(`/`.flatMap(` — i.e. a fan-out whose WIDTH IS THE COLLECTION'S LENGTH. PROXY FOR the stack-free condition 'the number of things running at once is whatever the data happened to be, and nobody chose it'. The negative lookahead `(?!\\[)` is load-bearing and is what makes this precise rather than a `Promise.all` grep: 122 of this repo's 181 combinator call sites are literal tuples `Promise.all([a(), b()])` (the 103 `Promise.all` ones span arity 2-10), which are parallel-await, are correct, and MUST NOT be counted — a raw grep over-reports by 2-4x here and in all five sibling repos. WHAT THE MATCH COSTS, executed rather than reasoned: replaying `Promise.all(xs.map(f))` verbatim over 30 items with a rejection at item #2, all 30 items had ALREADY been dispatched before the first await resolved (started=30, finished=2 at the moment the caller saw the error) — so fail-fast does not save the work, it discards the results, and swapping in `allSettled` changes nothing about what runs or what it costs. Replaying the repo's own bounded pool (src/lib/concurrency.ts:18) under the same failure is WORSE: the caller resumed at started=6 and 400ms later 30 of 30 had started, 24 of them AFTER the rejection, unobserved. PRECISION 44/44 on the stated condition, hand-verified, with TWO INDEPENDENT IMPLEMENTATIONS RECONCILING EXACTLY AT 44 (this regex, and a balanced-paren argument extractor that classifies the extracted argument as literal-tuple vs collection-fan-out); they first disagreed 44 vs 43 because the parser fed RAW source to the paren matcher and a line comment containing an apostrophe (\"persona doesn't have one\", autoAssignIcons.ts:102) opened a string that never closed — stripping comments reconciled them, and the disagreement was a bug in the instrument, not in the rule. ONE MATCH IS KNOWINGLY COMPLIANT: src/lib/icons/autoAssignIcons.ts:91 awaits inside a serial chunk loop (measured peak concurrency 5 over 78 personas). It is listed on purpose — it is textually identical to the VIOLATING src/lib/eventBridge.ts:1114 apart from where the `await` sits, and a backwards-looking heuristic that tried to separate them mis-classified two other sites. LEGAL DESTINATIONS the pattern leaves unmatched, by construction: (1) `mapWithConcurrency(items, limit, fn)` from @/lib/concurrency — 14 production call sites, counted by the positive control; (2) a literal tuple of independent calls; (3) a chunk loop whose `Promise.all` argument is a variable. PORTABILITY WARNING, earned from the convergence sweep and NOT optional to restate: this signal keys on the syntax a widthless fan-out wears IN A REPO WHOSE LIMITER IS A NAMED FUNCTION. In `ascent`, which extracted `mapPool` (src/lib/pool.ts:14, 7 call sites), the seven BOUNDED fan-outs contain no `Promise.all` token at all, so this rule reports the cohort's best-behaved repo as its worst — the metric rewards inlining the fix. An adopting repo must re-key on its own raw form and pair it with its own limiter as the control. Do NOT silence a match by hoisting the `.map(` into a variable — that is hiding, not bounding; route it through the shared pool, or bound the items at the source."
  },
  "exclude": [],
  "baseline": { "files": 35, "matches": 44 },
  "floor": 3000
}
```

```json
{
  "id": "widthless-collection-fanout-positive-control",
  "goldenPath": "docs/concepts/golden-paths/bounded-parallel-fan-out.md",
  "roots": ["src"],
  "extensions": [".ts", ".tsx"],
  "signal": {
    "pattern": "\\bmapWithConcurrency\\s*\\(",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "POSITIVE CONTROL — the COMPLIANT form of the same condition, over the same roots and extensions: a collection fan-out routed through the shared bounded pool at src/lib/concurrency.ts:18. Returns 22 matches in 14 files (14 matches in 12 files excluding __tests__), against the violating rule's 44 in 35 — so the fan-out population PARTITIONS 44 widthless : 14 bounded, and the two counts must move in opposite directions as the codebase improves. If `widthless-collection-fanout` falls while this stays flat, a fan-out was DELETED rather than bounded, and the ratchet would otherwise have recorded that as progress. It also proves the violating pattern discriminates on SHAPE and not on a token: this control matches zero of the 44, and the 44 match zero of this. Carries no baseline by construction — a ratchet is monotone-downward and would fail the build every time adoption improved. NOTE it deliberately does NOT match the definition (`export async function mapWithConcurrency<T, R>(`, which has a type parameter list before the paren) or the two re-exports (usePassportData.ts:76, sceneStore.ts:56), so it counts call sites only."
  },
  "exclude": [],
  "floor": 3000
}
```

Validated standalone in a private scratch registry (`--rules`), never against the shared
`rules.json`; **re-extracted from this document and re-run, with identical counts** — 44 matches /
35 files for the rule, 22 / 14 for the control, 4,829 files walked.

### The type, alongside the ratchet

The gate counts the **width**. The **failure** half is a type, and it is already written:

- **Change `run_lanes`'s status from "not wired" to "the way we fan out"**, starting with
  `gitlab.rs` (§7 D2) — one real caller, in a path that currently loses data. `Vec<LaneOutcome<T>>`
  makes "5 of 8 succeeded" the only representable answer, which is the state
  `Result<Vec<T>, AppError>` forbids.
- **Fix `mapWithConcurrency`'s default rather than counting its callers** (§8 Gap 2): one line
  closes the `NaN` hole for every present and future call site, and one added `signal?` parameter
  makes the four surviving copies deletable instead of load-bearing. Per the contract, *a gate on
  reaching a destination is only as good as the destination's defaults* — and today this
  destination silently returns success having done nothing.

## 12. Corrections to the brief

1. **"`Promise.all` rejects on first failure and abandons the rest." — FALSE, and it is the most
   consequential correction here.** Executed: at 30 items with a rejection at #2, **all 30 had
   already been dispatched** before the first `await` resolved. `Promise.all` abandons the
   *results*, never the work. The `all` vs `allSettled` choice is a legibility decision and costs
   exactly the same money. **The worker pool is worse**, not better: 24 of 30 items started *after*
   the caller was told it had failed.
2. **"In 5 of 5 sibling repos the OUTER enumeration loop is uncapped while an inner cap ≈4 exists."
   — REFUTED, 0 of 5.** Call chains were traced rather than pattern-matched. `ascent`'s real nest is
   `mapPool(due, 4)` → `mapPool(sampled, 6)` — **bounded × bounded**; `brainiac`'s is
   `buffer_unordered(4)` → `try_join!` — bounded × static; `vibeman`'s outer is **strictly
   sequential**. The likely origin of the claim is `ascent/rescan/route.ts:53`, an uncapped
   `Promise.all` sitting 24 lines *above* the bounded `mapPool` in the same file — adjacent in the
   text, not nested in the call graph. **The shape does exist — in Personas** (`centerShared.tsx:106/108`,
   uncapped × uncapped), which makes it a local finding rather than physics.
3. **"`GLOBAL_MAX_CONCURRENT = 4` exists on one lane, but the runtime value is
   `MAX_PARALLEL_EXECUTIONS_DEFAULT = 10` — check which actually binds." — settled by execution, and
   the answer is 10 at every scale.** A sweep-line over 2,188 executions, 4,001 provider audit rows
   spanning 2026-04 → 2026-06, and 1,771 companion turns gives max simultaneous = **10 / 10 / 9**,
   with 30 saturations at exactly 10 and **not one observation of 11**. `4` has never bound anything
   in this install's recorded history. [`autonomy-gating`](./autonomy-gating.md) §7.J reached this
   statically; this confirms it empirically and adds that the cap *works*.
4. **"`set_global_max_concurrent(0)` means unlimited — the same self-disabling-default shape
   `spend-ceilings` found in two dollar ceilings and not in 11 of 11 non-money limits." — confirmed,
   and it is stranger than that: `0` means five different things in this cohort.** `queue.rs:157`
   → unlimited. `task_executor.rs:663` `Semaphore::new(0)` → **permanent deadlock**.
   `orchestrator.rs:59` `.max(1)` → serial. `concurrency.ts:25` → serial (but `NaN` → silent no-op
   returning success). `approval_exec_knowledge.rs:690` → refuse. The oracle then found that
   **0 of 5 siblings use "0 = unlimited" at all**, so this is a Personas-local convention, not
   physics — which strengthens `spend-ceilings` P2 rather than generalising it: *unlimited must be a
   value of the type* is right, and the reason is that "0" has no stable meaning even inside one
   binary.
5. **"A fan-out over N personas that each make a model call is a spend multiplier, and this app has
   never run under a dollar ceiling." — confirmed, with the site named.**
   `useTeamDeliberations.ts:311` fans out over open deliberation tracks (live max **6** per parent),
   each carrying its own `DEFAULT_COST_BUDGET_USD = 5.0`, inside a `while` loop that re-fans every
   round — with a comment celebrating the unboundedness (*"true parallelism"*). Live: 142
   deliberations, $138.35, mean $0.97, max $4.73 against the $5.00 floor. Nothing sums them.
6. **A correction to my own instrument, offered because the doctrine asks for it.** The first
   provider-audit sweep reported **147** simultaneous model calls. It was wrong by 14.7×: the
   interval start was computed in SQL as `datetime(julianday(created_at) - duration)`, which emits a
   timezone-less `YYYY-MM-DD HH:MM:SS` that `Date.parse` reads as **local** time, while the interval
   end (`created_at`) carries `+00:00` and parses as UTC — inflating every interval by the host's
   two-hour offset and manufacturing overlap. Redone entirely in JS, the answer is **10**. The
   number was plausible, alarming, and would have been the document's headline. *Two implementations
   are not the safeguard; doing the arithmetic in one coordinate system is.*
7. **A note on `provider_audit_log` that touches a sibling path.**
   [`spend-ceilings`](./spend-ceilings.md) §7.A describes it as *"a finer-grained mirror of the same
   executions incl. failovers/retries"*. Measured: **4,001 rows, 4,001 distinct `execution_id`s,
   1:1** — for matched rows `created_at` equals the execution's `completed_at` to the millisecond
   and `duration_ms` is identical. It is a **1:1** mirror, not a finer-grained one; **1,939 of the
   4,001 (48.5%) are orphans** whose execution row has been pruned, which is why its lifetime total
   exceeds `persona_executions`'. Not a defect in that path's conclusion — its dollar figures are
   unaffected — but the word "finer-grained" would mislead the next reader, and the orphan half is
   the only surviving record of two months this app has otherwise forgotten.
