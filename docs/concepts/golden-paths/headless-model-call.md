# Golden path — the headless model call

> Situation node: `ai-agents/model-invocation/headless-model-call` · [situation spine](../situation-spine.md)
> Composed 2026-08-15 against `master` @ `f2e002f7b`. **Recurrence 28 · risk HIGH · sides: server · convergence: diverged.**
> Sweep: all **963** non-generated Rust files under `src-tauri/` walked by the census engine and
> re-walked by two independent scanners written for this path. Every `Command::new` in the tree
> (129 non-test) classified; `engine/src/prompt/cli_args.rs`, `engine/src/cli_process.rs`,
> `src/companion/brain/oneshot.rs`, `src/companion/athena_reaction.rs`,
> `src/companion/turn_ledger.rs`, `src/companion/model_routing.rs`, `engine/src/queue.rs`,
> `core/src/run_budget.rs` and `src/engine/deliberation.rs` read in full. A **read-only copy of the
> operator's two live SQLite files** (`personas.db` 347 MB, `personas_data.db` 17.5 MB, copied
> 2026-08-15 20:04) queried for ledger shapes: **1,779 `companion_turn` rows, 88 `dev_llm_spend`
> rows, 2,188 `persona_executions` rows**. The census rule in §9 was built, fault-injected five ways,
> and re-extracted from this document and re-run.
> Convergence oracle run against **`brainiac`, `personas-cloud`, `ascent`, `vibeman`, `personas-web`**.
> Dimensions: **cost · resilience · security · function · code-quality**.
> **Settles:** what must be true before this app spends money with nobody watching.

---

## 0. The headline, before anything else

**Every per-call bound this application is capable of applying lives inside one `if let Some(persona)`
block, and 35 of the 39 non-test call sites pass `None`.**

`engine/src/prompt/cli_args.rs::build_cli_args_inner` is the single place a Claude CLI invocation is
assembled. Four safety bounds are emitted there, and all four are gated on the persona argument:

| Bound | Line | Guard |
|---|---|---|
| `--max-budget-usd` | `cli_args.rs:134` | `if let Some(persona)` → `if budget > 0.0` |
| `--max-turns` | `cli_args.rs:142` | `if let Some(persona)` → `if turns > 0` |
| `--forward-subagent-text` | `cli_args.rs:160` | `if let Some(persona)` |
| `API_TIMEOUT_MS` env | `cli_args.rs:247` | `if let Some(p) = persona` |

Measured at `f2e002f7b`, excluding `#[cfg(test)]` modules by brace-matched range:
**`build_cli_args(None, …)` — 35 sites across 26 files. `build_cli_args(Some(persona), …)` — 4 sites**
(`design/analysis.rs:151,212,298` and `execution/tests.rs:330`).

So the calls with a human watching are the bounded ones, and the calls with nobody watching are
unbounded — by construction, from one `Option`. `--max-budget-usd` has exactly **one construction
site in 963 files**, and **zero headless calls reach it**.

The same asymmetry repeats at every other control:

- The **monthly spend gate** is `get_monthly_spend(pool, persona_id)`
  (`db/src/repos/execution/executions.rs:1667`) — keyed by persona. Consulted at 2 sites, both
  persona executions. No headless call consults it.
- The **concurrency ceiling** is `ConcurrencyTracker` with `GLOBAL_MAX_CONCURRENT = 4`
  (`engine/src/queue.rs:10`). `admit()` is called at **exactly one site**, `engine/mod.rs:886`, and
  its first argument is `&persona.id`. No headless call enters the tracker.
- The **prompt-size instrument** (`companion_turn.total_prompt_chars`) is written at **exactly one
  site**, `session.rs:1270`, on the interactive chat turn. In the live ledger it is populated for
  127 of 1,779 rows and **NULL for all 1,636 headless rows and all 14 maintenance rows**.

The live data makes the shape concrete. Of 1,779 recorded companion turns, **1,636 (92%) are
`origin='headless'`** — 88 are chat. Headless is 92% of the calls and 16% of the dollars ($58.34 vs
$246.27), which is exactly why it is easy to leave uncontrolled and exactly why a fan-out changes
that overnight: on 2026-06-26 the deliberation lane alone ran **770 headless legs in one day**.

**Nothing in this document is about the model being wrong. It is about the fact that when a person
is watching, they are the ceiling — and this app has no other one.**

---

## Principle (stack-free head)

Per the [portability test](../research/portability-test.md), the head is physically separated and every
clause carries its warrant, so an adopting repo can tell physics from local calibration. No file path,
primitive name or count appears below this line until the head ends.

> **P1 — physics.** A human in the loop is a control. They notice a call taking too long, they abandon
> a tab, they stop pressing the button. Remove them and *every* bound that was implicitly theirs must
> be re-supplied explicitly. The failure is not that headless calls are riskier; it is that a system
> grows its bounds around the interactive path first, and the headless path inherits the code without
> inheriting the control.
>
> **P2 — physics, and the sharpest clause here.** Every ceiling a call can carry must be a **required
> field of the type that describes the call**. If the ceiling is optional, the forgotten case is the
> unbounded case, and forgetting is the default because the compiler is silent about it. Optionality
> on a safety parameter is not flexibility; it is a policy that says *unbounded* and says it quietly.
>
> **P3 — physics.** *Which identity pays* is part of the call, not part of the environment. A process
> that inherits its billing credential from whatever the ambient environment happens to hold is not
> making a choice; it is accepting one. The correct place to state the payer is the same place you
> state the model and the prompt.
>
> **P4 — physics.** A call that names no model does not get a cheap model. It gets whichever default
> the vendor or the runtime picked, and vendors default toward their newest and most capable — which
> is their most expensive. "Unspecified" resolves upward.
>
> **P5 — physics.** The authoritative cost of a call exists only in its terminal event, so *every way a
> call can end early is a way to spend real money and record zero.* A recorder that only fires on
> success is a recorder that under-reports exactly the calls worth investigating. A killed call must
> still produce a row; the row may say the cost is unknown, and unknown is a fact, not a gap.
>
> **P6 — physics.** Metering must be **unreachable-around**, not merely available. If there is a code
> path from "start a call" to "the network" that does not pass through the meter, that path will be
> taken — not maliciously, but by the next person adding the eleventh caller under time pressure.
> Withholding the unmetered door beats documenting that it should not be used.
>
> **P7 — physics, stated as a failure mode because that is how it appears in every codebase examined.**
> A spend gate gets built for the door a human knocked on. The door nothing knocks on — the cron, the
> webhook, the queue — is added later and gets no gate, because at the time it was added it was cheap.
> Audit the *ungated* launch paths, not the gated one.
>
> **P8 — physics, and the most replicated observation in this document.** Concurrency gets capped on
> the first lane and never on the second. A system with two ways to start work will bound the one it
> shipped first and leave the newer one unbounded, and the newer one is almost always the headless one.
>
> **P9 — ergonomics.** A prompt assembled from data the system does not control has no natural size.
> Truncation is therefore inevitable and correct — but a truncation nobody records converts a
> capability question ("did the scan see all 500 rows or the first 5?") into an unanswerable one.
>
> **P10 — ergonomics.** A headless call has no one to press retry. Whatever recovery it gets, it must
> bring with it.
>
> **Scale condition.** P2, P3 and P5 are correctness at any scale — they are wrong on the first call.
> P6, P7 and P8 begin to bite the moment a second launch path exists. P4 and P9 pay the first time
> someone asks why the bill moved. P1 is the frame for all of them.

### Warrant evidence — the sibling repos, censused independently

`brainiac` (Rust workspace, 8 chat + 2 embedding call sites, 100% headless), `personas-cloud`
(Node orchestrator + worker, **one** spawn, 6 launch sites), `ascent` (Next.js, 6 provider transports,
10 pipeline entry points), `vibeman` (Next.js, 27 call sites across three non-interoperating lanes),
`personas-web` (**the negative control — zero model calls**: no LLM SDK in `package.json`, zero
matches for any provider endpoint across `src/`, all ten API routes are Supabase CRUD).

- **P2 is convergent and it is the single strongest finding of the oracle.** `brainiac` makes the
  ceiling a required field: `ChatRequest { …, max_tokens: u32, temperature: f32 }`
  (`crates/brainiac-gateway/src/lib.rs:41-54`) — not `Option`, no `Default` impl, no builder. Result:
  **8 of 8** call sites carry a token ceiling. `personas-cloud` did the same thing on a different axis:
  `ExecAssign.config` is a required object with `timeoutMs: number`
  (`packages/shared/src/protocol.ts:133-149`), so **1 of 1** spawns arms a timeout unconditionally
  (`executor.ts:145-151`). Two teams, two languages, two different knobs, the same move. Meanwhile
  `vibeman` made every knob optional (`src/lib/llm/types.ts:3-30`) and got a **40,096-token** default
  for anything that forgets (`providers/anthropic-client.ts:89`) and — worse — **no `signal` field
  exists at all**, so the `AbortController` built at `scanQueueWorker.ts:455` *explicitly to "cancel
  zombie LLM requests on timeout"* aborts a `fetch` while the server-side `messages.create()` runs to
  completion, fully billed, result discarded. **P2 is physics, and its absence is measurable as money.**
- **P3 does NOT converge, and that is the correct reading.** No sibling strips a billing credential
  per call, because none of them spawns a CLI that authenticates from ambient environment variables.
  `brainiac` builds one `reqwest::Client` in a private factory with an explicit key; `ascent` and
  `vibeman` pass SDK clients. **The per-spawn credential strip is this repo's local calibration** — but
  the *principle* generalises exactly, and `personas-cloud` proves it: it spawns the same CLI and
  passes provider auth as environment variables (`dispatcher.ts:733-751`) with **no strip at all**,
  which is the same hazard with the guard missing. Adopt P3; do not adopt the mechanism.
- **P4 is convergent as a defect.** `personas-cloud` never passes `--model` at all
  (`executor.ts:96-101` emits no model flag) — the effective model is whatever the CLI defaults to
  inside the container. This repo has the same hole at 5 sites, and has already paid for it: the
  comment at `engine/src/prompt/capabilities.rs:20-24` records that a profile-less persona "silently
  rides the CLI ACCOUNT default — observed live as **opus-4-8[1m]** on every team step, the dominant
  fleet cost driver (2026-06-12 cost review)". `vibeman` shows the third variant: three *disagreeing*
  defaults (`llm-manager.ts:307-316` says `claude-opus-4-7`, `anthropic-client.ts:8` actually sends
  `claude-haiku-4-5-20251001`, `getAvailableModels()` returns a third list). `brainiac` is the only
  repo with a canonical table (`gateway/src/lib.rs:122`) and **zero model literals at any call site**.
- **P5 is convergent, and this repo is one of only two that solved it.** `personas-cloud` writes
  `costUsd: msg.totalCostUsd ?? 0` (`dispatcher.ts:461`) and its SIGKILL'd sessions never emit the
  `result` line — a timed-out expensive run bills **$0** in the ledger *and* $0 against the monthly
  budget. `ascent` commits usage only on success — `scan.ts:337` `capturedUsage = attemptUsage; //
  commit only on success` — so a failed attempt's tokens are dropped from both the report and the DB.
  `brainiac` solved it (`providers/mod.rs:104-105`: *"A failed call meters as 0 tokens with
  `status=error`, preserving the 'cost unknown ≠ cost zero' contract"*), and so did this repo, with a
  `timed_out: bool` on the recorder that synthesises a usage block so the row exists even when the
  cost does not (`turn_ledger.rs:283-291`). **Two independent solutions, three independent failures.
  Physics.**
- **P6 is convergent, and `brainiac` is the reference.** Its `providers` module is **private**
  (`lib.rs:30 mod providers;`) and `meter` / `build_http_client` / the `Metered` trait are all
  `pub(crate)`. Downstream crates receive only `Arc<dyn ChatProvider>` whose sole method routes through
  `meter_op`. There is no unmetered surface to reach, so metering is 8/8 and unforgettable. Where the
  meter is *optional* it leaks: `ascent`'s `AssessOptions.onUsage?` (`provider.ts:60-65`) leaves 3 real
  billable calls unmetered including `bedrock.ts:196 testBedrockConnection`; `vibeman` gates all event
  logging on an optional `projectId` and **exactly one site in the whole repo persists token counts**
  (`goalGenerator.ts:181`). This repo has both doctrines side by side and knows it — see §6.
- **P7 is convergent across three repos and it is always the same door.** `ascent` gates 4 of its 5
  headless real-model paths with fail-closed credit reservation — and the **push-webhook rescan**
  (`app/webhook/route.ts:396`) has no entitlement check, no credit reservation, and no rate limit,
  deduping only *after* the model was paid for. `personas-cloud` has a monthly USD gate on exactly one
  of six launch sites (`httpApi.ts:1293-1304`) and **none on the cron or Kafka paths**, which are the
  purely-headless ones. This repo gates persona executions and nothing else. `brainiac` and `vibeman`
  have no spend gate at all. **Three teams independently built the gate for the interactive door and
  skipped the automatic one.**
- **P8 is the most replicated clause in the entire oracle: 5 of 5 repos, and four of them picked the
  same number.** `brainiac`: worker lane `DEFAULT_CONCURRENCY = 4` (`worker.rs:41`), sweep lane
  **unbounded** (`sweeps.rs:257-261` spawns every due sweep with no semaphore). `vibeman`: CLI lane
  `MAX_CONCURRENT_EXECUTIONS = 4` (`types.ts:15`), scan lane 1, Agent-SDK and direct-Ollama lanes
  **unbounded**. `ascent`: `SCAN_CONCURRENCY = 4` (`pool.ts:37`) applied at 4 sites, webhook push path
  **unbounded across repos**. `personas-cloud`: 1 per worker, no global cap, scales with worker count.
  This repo: `GLOBAL_MAX_CONCURRENT = 4` for persona executions, **unbounded for headless**. Five
  systems, five second lanes, five times uncapped.
- **P9 does NOT converge and must be labelled an invention.** Truncation sites that record the fact
  they truncated: `brainiac` 1 of 6 (and only a marker in the text), `ascent` **0 of 11**,
  `personas-cloud` **0 of 3** (no marker either — `prompt.ts:120` silently discards an entire subtree
  deeper than 10), `vibeman` **0 of ~30**, this repo **36 of 202**. Nobody records truncation. Either
  it is a real gap five teams share, or the payoff is smaller than it looks; the honest reading is
  that P9 is a **proposal with no external warrant**, not doctrine. It is retained because §7.F shows
  what it costs here, but an adopting repo should treat it as untested.
- **P10 does not converge either, and the numbers are stark.** Retry loops around a model call:
  `brainiac` has a proper one (3 attempts, 500 ms base, 8 s cap, `resilience.rs:31-37`, retrying only
  transport/429/5xx); `ascent` has a retry→failover→mock plan (`scan.ts:385-411`); `vibeman` has one in
  `base-client.ts:291-345` **that the Anthropic path never reaches** because that client bypasses
  `makeRequest`; `personas-cloud` retries *assignment*, not a failed model run. **This repo has one
  retry loop in the entire headless surface** (`engine/kpi_binding.rs:480`, `for attempt in 0..2u8`).
  So P10 is reinvented in two of four — call it strong, not settled.

**The negative control.** `personas-web` makes no model calls at all: no `@anthropic-ai/*`, no
`openai`, no `ai`/`@ai-sdk` in `package.json`; zero matches for any provider endpoint across `src/`;
its two `fetch` calls target its own `/api`. Its absence of every control above is *structural*, which
is what makes it a control rather than a counterexample.

---

## 1. Trigger

You are in this situation when you are about to type any of:

- "run this in the background", "add a nightly pass", "scan the repo and summarise"
- "call Claude from the scheduler / the healing loop / the night shift / the consolidator"
- "just spawn the CLI here and read stdout"
- "generate the tour / the KPI / the context map / the digest automatically"
- "this doesn't need a UI, it's just a backend computation"
- **If you are about to write `build_cli_args(None, None)`, `Command::new(&cli_args.command)`,
  `claude_cli_invocation()`, `base_cli_invocation()`, or any `spawn` whose child is the Claude CLI —
  you are in this situation.**
- If you are about to add a caller to `spawn_headless_claude`, `call_claude_text`, `cli_text_tracked`
  or `cli_decision_with_model`, you are in this situation and most of it is already handled.

You are **not** in this situation for: the Athena chat turn (`companion/session.rs:2132` — a human is
watching the tokens arrive), the Fleet PTY and external-console transports (`fleet/pty.rs`,
`fleet/external.rs:144` — the operator owns that terminal), or a persona execution launched from the
Executions UI (that path has an owner, a budget, a queue slot and a cancel button; it is
[`llm-spend-accounting`](./llm-spend-accounting.md)'s and
[`cancelling-in-flight-work`](./cancelling-in-flight-work.md)'s territory).

### Boundaries with the four adjacent paths

- **[`llm-spend-accounting.md`](./llm-spend-accounting.md)** owns *whether the number the app reports
  as spend is correct* — the price table, the nullable column, the re-aggregation, the monthly
  predicate. This path owns *whether a call that nobody asked for is allowed to happen at all, and
  under what ceiling*. Non-overlap test: a headless scan whose cost is captured perfectly from the
  terminal event, stored nullable, re-aggregated correctly, and which ran with no budget, no turn cap,
  no timeout and no concurrency slot is **100% compliant with that path and 0% compliant with this one**.
- **[`background-loop.md`](./background-loop.md)** owns the *loop* — its tick, its backoff, its
  overlap guard, its cancellation. This path owns *the model call the loop makes*. A perfectly
  select!-raced, backoff-correct, non-overlapping loop that fires an unmetered, unbounded, unpinned
  CLI spawn on every tick satisfies that path completely.
- **[`spawning-a-cli-subprocess.md`](./spawning-a-cli-subprocess.md)** and
  **[`cancelling-in-flight-work.md`](./cancelling-in-flight-work.md)** own the *child-process
  mechanics* — `kill_on_drop`, the reap, the pipe-deadlock, `CREATE_NO_WINDOW`. This path deliberately
  does **not** add a second counter for missing `kill_on_drop`: `unbound-child-lifetime`
  (12 files / 13 matches) already owns it, and §9 states the overlap explicitly.
- **[`model-composed-ui.md`](./model-composed-ui.md)** owns what happens to the model's *output* —
  the envelope parse, the validation, the anchor manifest. It begins where this path ends.

---

## 2. The one way

**Give the call an owner, a ceiling, a payer, a named model and a meter — as arguments, not as
ambient facts — and spawn it through the one helper that cannot be talked out of any of them.**
Concretely: reach for `cli_process::spawn_headless_claude(prompt, model, extra_args, exec_dir,
capture_stderr)`, which takes the model as a **required parameter** and folds the subscription-auth
strip in with no opt-out; never re-derive the spawn envelope by hand, because every hand-rolled copy
in this repo is missing at least one of the four guarantees the helper makes. Pass the model from a
**named tier** (`companion::model_routing::{MAIN, ASIDE, MICRO}`) rather than a fresh string literal,
because a call that names no model rides the CLI account default and this repo has already measured
that default as its single largest cost driver. Bound the call twice — a `tokio::time::timeout` you
own around the drain, and a step ceiling (`--max-turns`) in the argv — and record which one fired,
because a timeout that returns `Ok` with a partial blob is invisible to an error-shaped check. Take
the terminal `result` event on **every** line you drain and hand it to a recorder that runs on the
failure path too: a killed leg must still write a row, with `NULL` cost and a reason, because
"we never learned" and "it was free" are different facts and only one of them deserves silence.
Before the *next* leg of a multi-leg operation, re-read the aggregate and refuse — a ceiling checked
after the money is gone is a report, not a ceiling. And when you add a new headless caller, **do not
add a new unmetered entry point for it**: `brain::oneshot` is right that "there is deliberately no
unmetered public entry point", and that withholding is worth more than every convention in this
document.

---

## 3. Mandated primitives

| Primitive | What it gives you |
| --- | --- |
| **`engine/src/cli_process.rs:318` — `spawn_headless_claude(prompt_text, model, extra_args, exec_dir, capture_stderr)`** | **The spawn envelope, once.** `model: &str` is a **required positional parameter** — you cannot construct a headless spawn without naming a model. `force_subscription_auth` is folded in unconditionally at `:359` ("Mandatory — see doc comment above. No caller may opt out."), `kill_on_drop(true)` at `:332`, `CREATE_NO_WINDOW` at `:350`, the env loops, the spawn-error mapping, and a **detached stdin writer task** at `:377-383` that removes the classic pipe deadlock. **9 callers.** Its docstring names the exact regression this path exists to prevent: *"some call sites called it explicitly … and some forgot to — meaning idea scans, task executions, and twin generations could silently fall back to pay-as-you-go API billing."* |
| **`src/companion/brain/oneshot.rs:122` — `call_claude_text(pool, prompt, model, leg, call_timeout)`** | **The metered leg, and the best type in this document.** Takes a `&UserDbPool` and a `leg` label as required arguments, writes exactly one `companion_turn` row per invocation on **both** the success and the failure path, and states the reason it is shaped that way: *"There is deliberately **no unmetered public entry point**: a future leg cannot be added without a pool, which is the structural version of the rule rather than a comment asking for it."* 8 callers. Copy this shape. |
| **`src/companion/turn_ledger.rs:213` — `record_cli_leg(pool, origin, trigger_kind, model, usage, timed_out)`** · **`:249` — `record_failed_leg(pool, origin, trigger_kind, model, &e)`** | **The recorder that survives the failure.** `timed_out: bool` is a required argument, and `flag_timeout` (`:283`) *synthesises* a usage block when the CLI emitted no `result` event, so a killed leg still books a row: *"the row must exist even when the cost does not."* `record_failed_leg` exists because *"every `?` in the tracked wrappers returned before their `record_turn` call, so the ~94% of `companion_turn` rows that are headless were structurally incapable of reporting a failure."* This is P5 solved, and only `brainiac` solved it independently. |
| **`db/src/repos/llm_spend.rs:74` — `observe_line(pool, ctx, line)`** | The other meter, for the `dev_llm_spend` (main-DB) side. Safe to call on every stdout line; no-ops on non-`result` lines; `parse_result_line` (`:83`) **prefers the CLI-reported model over the caller's pin**, which is the correct precedence and the one two call sites bypass (§7.D). |
| **`src/companion/model_routing.rs:25,33,45` — `MAIN` / `ASIDE` / `MICRO`** | **The model decision, made once, with its evidence attached.** Three `TurnTier { model, effort }` constants, each carrying the bench number that justified it (*"Opus@low matched Opus@default accuracy exactly (93.9% over 114 runs per cell) at 16% lower p50 latency"*). This is the only model table in the repo that is a *decision* rather than a *default*. |
| **`engine/src/prompt/capabilities.rs:9` — `tier_slug_to_model_id(slug)` + `DEFAULT_CAPABILITY_MODEL`** | The other half of model resolution, for capability executions, with the cost incident that produced it written into the docstring (`:20-24`). |
| **`src/engine/deliberation.rs:162` — `floor_breach(cost_spent_usd, cost_budget_usd, idle_deadline, now)`** | **The only working aggregate ceiling on a headless operation in this repo.** A pure function, checked before each round, falling back to `DEFAULT_COST_BUDGET_USD = 5.0` (`:48`) when the deliberation declared none — so the default is a *number*, not "unlimited". It also carries an **idle deadline**, which is the bound a purely-cost ceiling misses. Copy this for any multi-leg headless operation. |
| **`core/src/run_budget.rs` — `RunBudgetLedger` (`register` → `record` → `should_halt` → `finish`)** | The generalised run-level ceiling for multi-spawn operations, with per-kind defaults (`DEFAULT_EVOLUTION_CEILING_USD = 2.0`, lab 3.0, pipeline 5.0) and a `persist` path (`db/src/repos/run_budget.rs`). Mandated as the shape to extend — see §7.G for what it does not yet do. |
| **`engine/src/inflight_guard.rs:28` — `InflightGuard::acquire(key)` / `guard(key)`** | Per-key exclusivity so a headless job cannot be launched twice concurrently for the same subject. RAII handle releases on drop, so early returns cannot leak. 7 users, 4 of them model-calling. This is dedupe, **not** a concurrency ceiling — do not mistake it for one. |
| **`src/engine/build_session/orchestrator.rs:55` — `run_lanes(max_parallel, tasks)`** | The bounded fan-out primitive. Use it (or `tokio::sync::Semaphore`) whenever a headless operation spawns N model calls; do not `tokio::spawn` in a loop. |

**Explicitly NOT primitives.**
`engine/src/cli_process.rs:409 run_claude_cli` is a *second* shared spawner with a different contract
(plain text out, `--max-turns 1`, no stream parsing) — legitimate, but do not add a third.
`athena_reaction::cli_text` (`athena_reaction.rs:419`) is the **unmetered** variant kept "for engine
callers that don't carry a user-db handle"; it has **zero callers** and should be deleted (§7.E).
`build_cli_args(None, None)` is not a headless-call primitive — it is an argv builder that silently
declines every bound (§0).

---

## 4. Steps

1. **Name the owner before you name the model.** Is there a persona, a project, a workspace, a
   deliberation? If yes, thread its id through and stamp it on the spend row — 60% of this repo's
   recorded dollars are currently unattributable
   ([`llm-spend-accounting`](./llm-spend-accounting.md) §7.F). If genuinely nobody owns it, the
   `trigger_kind` label *is* the owner and must be a low-cardinality constant, not an inline string.
2. **Spawn through `spawn_headless_claude`.** Do not write `Command::new`. If you believe you need a
   different envelope, read §7.A first: five sites believed that, and five sites are missing a
   guarantee the helper makes.
3. **Pass the model from a named tier**, never a fresh literal. If your call needs a tier that does not
   exist, add it to `model_routing.rs` with the reason — that is one edit and one review, versus a
   78th string literal in a 59th file.
4. **Arm two bounds and know which is which.** A wall-clock `tokio::time::timeout` around the drain
   bounds *how long you wait*; `--max-turns` in the argv bounds *how much work the agent does*. They
   are not substitutes. Today 26 of 79 headless call functions have the first and 20 have the second.
5. **Read the terminal `result` event on every line you drain.** `CliUsage::from_line(&line)` or
   `llm_spend::observe_line(pool, &ctx, &line)` — one call in the loop body. Draining stdout without
   reading it is what made seven maintenance legs free-looking for 77 days (`oneshot.rs:8-16`).
6. **Record on the failure path too, and record the timeout as a timeout.** `record_failed_leg` on the
   `Err` arm; `record_cli_leg(…, timed_out)` on the `Ok` arm with the flag actually threaded. A
   timeout that resolves to `Ok` with a partial blob is invisible to an error-shaped check
   (`athena_reaction.rs:537-542` says so in its own docstring) — pass the bool.
7. **If the operation makes more than one call, gate the next one on the aggregate.** `floor_breach`
   or `RunBudgetLedger::should_halt` before each leg. A ceiling checked afterwards is a report.
8. **Bound the fan-out.** `run_lanes(n, tasks)` or a `Semaphore`. Never `for x in xs { tokio::spawn(…) }`
   around a model call — that is exactly the shape `brainiac`'s sweep lane and `vibeman`'s SDK lane
   both took, and both are unbounded today.
9. **Cap the prompt where the data enters, and record that you capped it.** A `.chars().take(N)` with
   no adjacent field or log line is a silent capability change (§7.F).
10. **And then stop.** Cancellation semantics, `kill_on_drop`, the reap and the Windows console flag
    are the helper's job and [`cancelling-in-flight-work`](./cancelling-in-flight-work.md)'s territory;
    re-implementing them at the call site is how five sites diverged.

### Can the type make the wrong call impossible? — asked before §9

**Yes, and it is worth more than the gate.** See "Type over gate", below.

---

## 5. Anti-patterns

| Anti-pattern | Failure mode |
|---|---|
| **`build_cli_args(None, None)` and then spawn** | Silently declines `--max-budget-usd`, `--max-turns`, `API_TIMEOUT_MS` and `--forward-subagent-text` in one expression. `None` here means "no owner" *and* "no ceilings", and nothing distinguishes the two. **35 sites.** |
| **Re-deriving the spawn envelope** (`claude_cli_invocation()` / `base_cli_invocation()` + a hand-written argv + `Command::new`) | Every copy must independently remember the billing strip, `kill_on_drop`, the no-console flag, and the detached stdin writer. Measured: **5 of the hand-rolled sites are missing the billing strip** and 7 are missing `kill_on_drop`. The repo has already regressed on this once and fixed it by folding the strip into the shared spawner — for the 9 callers that use it. |
| **A fresh `"claude-…"` string literal at the call site** | 77 model-id literals across 58 files. One is `claude-opus-4-6` (`engine/mod.rs:3499`) and appears nowhere else; one is a dated pin `claude-sonnet-4-5-20250514` (`design/reviews.rs:1686`); one is bare `claude-haiku` with no version (`core/src/models/team.rs:111`). Nothing reconciles them and no test asserts any of them exists. |
| **No `--model` at all** | Rides the CLI *account* default. Not theoretical: `capabilities.rs:20-24` records this as "observed live as opus-4-8[1m] on every team step, the dominant fleet cost driver". **5 sites.** |
| **Hardcoding the model in the spend row instead of passing the one you called** | `kpi_binding.rs:487` and `kpi_derivation.rs:325` both write `model: Some("claude-sonnet-4-6")` for a call that runs on `MICRO.model` = `"claude-sonnet-5"`. The ledger is not wrong about the cost; it is wrong about *what the cost was for*, which is the only thing that makes it actionable (P7 of the spend path). |
| **`if let Some(u) = &usage { record(…) }`** | The `None` case *is* the interesting case — it means the CLI never emitted a terminal event, i.e. the call was killed or crashed. Guarding the recorder on the presence of usage records exactly the calls that went fine. Both kpi sites do this. |
| **Discarding `timed_out`** | `HeadlessRun` carries `text`, `usage` **and** `timed_out` precisely because a 180 s timeout returns `Ok` with a partial blob. `cli_text_with_usage` (`athena_reaction.rs:433`) returns `(run.text, run.usage)` and drops the third field, so its two callers cannot tell a clean leg from a killed one. The struct knows; the accessor forgets. |
| **`tokio::spawn` in a loop around a model call** | Unbounded fan-out. This is the shape `brainiac`'s sweep lane (`sweeps.rs:257-261`) and `vibeman`'s SDK lane both have today; the only reason it has not hurt here yet is that the headless lanes that *do* fan out (`task_executor`, `build_session/fanout`) happened to use a semaphore. |
| **Treating `InflightGuard` as a concurrency cap** | It is per-key exclusivity. Ten different keys give you ten concurrent model calls. |
| **A truncation with no adjacent record** | The scan that saw 5 of 500 rows and the scan that saw all 5 produce identical output shapes and identical logs. **166 of 202 truncation sites.** |
| **`while let Ok(Some(line)) = reader.next_line().await`** | An `Err` from the reader is indistinguishable from EOF, so a broken pipe mid-stream reads as "the model finished". Present at `athena_reaction.rs:617` and `oneshot.rs:235` (stderr). |

---

## 6. Evidence

**The one site to copy: `src/companion/brain/oneshot.rs:122-158` — `call_claude_text`.**
It is the only headless entry point in 963 Rust files where *every* obligation in §2 is discharged by
the signature rather than by the caller's discipline: the pool is required (so the ledger row cannot
be skipped), the leg label is required (so the row is attributable), the model is required (so nothing
rides the account default), the timeout is required (so the call is bounded), and both the success and
the failure arm write exactly one row. Its module docstring is the design note this whole path is
trying to generalise:

> *"There is deliberately **no unmetered public entry point**: a future leg cannot be added without a
> pool, which is the structural version of the rule rather than a comment asking for it."*

Also exemplary:

- **`engine/src/cli_process.rs:318-386` — `spawn_headless_claude`.** Nine callers get four guarantees
  they cannot decline. Its `force_subscription_auth(&mut cmd)` at `:359` is annotated *"Mandatory —
  see doc comment above. No caller may opt out."*, and the docstring names the billing regression that
  produced it. The detached stdin writer at `:377-383` is the correct fix for the pipe deadlock every
  hand-rolled copy re-derives.
- **`src/companion/turn_ledger.rs:283-291` — `flag_timeout`.** Synthesises a usage block for a killed
  child so the ledger row exists even when the cost does not. `personas-cloud` has the identical
  situation and writes `?? 0`; this is the better answer and it is four lines.
- **`src/companion/model_routing.rs:19-46`.** Three tiers, each with the measurement that chose it.
  The `MICRO` docstring even records a *negative* result (*"reinforcement at low effort regressed
  awareness 94→78%"*), which is why the tier is defensible against the next person who wants to
  "just use Opus".
- **`src/engine/deliberation.rs:150-176` — `floor_breach`.** A pure, testable, two-axis ceiling (cost
  **and** idle deadline) consulted before each round, with a real default rather than "unlimited".
  This governs the largest headless population in the live ledger (1,488 of 1,636 headless rows).
- **`engine/src/prompt/capabilities.rs:18-24` — `DEFAULT_CAPABILITY_MODEL`.** A constant whose
  docstring contains the incident report that justifies its existence. This is what a defensible
  default looks like.
- **`src/engine/build_session/events.rs:157-196` — `build_spend_entry` / `record_build_spend`.**
  Books the leg even when the CLI exited non-zero (*"a failed turn still costs money"*), and uses
  `parse_result_line` so the **CLI-reported** model wins over the caller's pin.
- **`db/src/repos/llm_spend.rs:28-30` — `record`.** *"Best-effort insert. Logs + swallows on failure —
  never propagates to the caller, so spend recording can't break a real LLM call."* The right
  failure posture for a meter.

---

## 7. Deviations found

### 7.A Five headless spawns do not state who pays — and `env_removals` looks like it handles it

`cli_process.rs:36-40` declares the invariant: `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` and
`ANTHROPIC_BASE_URL` authenticate the CLI against a **pay-as-you-go API account** instead of the
monthly subscription, "so these are stripped from EVERY spawned CLI's environment … Leaving any of
them set silently bills the API account and surfaces as 'Credit balance is too low.' (User directive
2026-06-11.)"

`force_subscription_auth(&mut cmd)` is the only thing that strips them. Measured across the 18
resolved-binary Claude spawns in 16 files: **13 strip, 5 do not.**

| Site | Function | What it does |
|---|---|---|
| `src/commands/artist/mod.rs:676` | `run_creative_cli` | headless creative job, `--model claude-sonnet-4-6` |
| `src/commands/infrastructure/standards_scan.rs:225` | `run_standards_scan` | headless repo scan (and it *does* meter, so the ledger will attribute API-account spend to the subscription lane) |
| `src/commands/obsidian_brain/revitalize.rs:249` | `run_claude_in_vault` | headless vault pass |
| `src/commands/ocr/mod.rs:596` (+ the Windows arm at `:579`) | `run_claude_ocr` | headless OCR; **also** no `kill_on_drop`, no timeout, and no `--model` |
| `src/engine/project_tracking/consolidator.rs:354` | `call_sonnet_oneshot` | headless consolidation; **also** no `kill_on_drop` |

**The trap that makes this easy to get wrong, and which is the real finding.** Four of these five
sites *do* iterate an env-removal list:

```rust
for key in &cli_args.env_removals { cmd.env_remove(key); }
```

That reads as billing hygiene. It is not. `build_cli_args_inner` populates `env_removals` with exactly
`CLAUDECODE`, `CLAUDE_CODE`, `DISABLE_PROMPT_CACHING`, `DISABLE_PROMPT_CACHING_1H`,
`DISABLE_PROMPT_CACHING_5M` (`cli_args.rs:184-199`) — **none of the three auth variables**. The loop
that looks like the guard is not the guard, and a reviewer scanning for "does this strip env" sees a
loop and moves on. This is why §9 keys on `force_subscription_auth` by name rather than on
`env_remove`.

`fleet/external.rs:179-181` shows the third state: it strips them **inline**, by iterating
`CLI_SUBSCRIPTION_RESERVED_ENV` itself, with a comment saying "Same env contract as every other Claude
spawn in the app." Correct behaviour, hand-copied — one more place to forget.

### 7.B Nothing bounds a headless call's spend, and nothing bounds how many run at once

**Per-call.** `--max-budget-usd` has one construction site (`cli_args.rs:134`) inside
`if let Some(persona)`. **Zero of 79 headless call functions emit it.** `--max-turns` reaches 20 of 79,
and always by the call site pushing it manually after the fact:

```rust
let mut cli_args = prompt::build_cli_args(None, None);
cli_args.args.push("--max-turns".to_string());
cli_args.args.push("1".to_string());
```

— which appears, near-identically, at 20 sites. That the bound is *re-typed* 20 times rather than
being a parameter is the deviation; the sites that do it are the compliant ones.

`API_TIMEOUT_MS` (`cli_args.rs:240-253`), which aligns the CLI's own inner request timeout with the
outer process deadline, is likewise persona-only. So a headless call has no inner API timeout either —
whatever the CLI defaults to.

**Aggregate.** `get_monthly_spend(pool, persona_id)` is consulted at `commands/execution/executions.rs:356`
and `:884` and mirrored at `engine/background.rs:2479`; all three are persona executions. Headless
scans, night-shift legs, consolidation, tours, KPI derivation and reflection consult **nothing**.
The two aggregate ceilings that do exist are scoped:
`deliberation::floor_breach` (one subsystem) and `RunBudgetLedger` (evolution / lab / pipeline).

**Concurrency.** `ConcurrencyTracker::admit` — one call site, keyed by `persona_id`. Headless calls
never enter it, so `GLOBAL_MAX_CONCURRENT = 4` does not describe them. The only caps on headless
fan-out are per-subsystem and hand-rolled: `Semaphore::new(max_parallel)` with a default of **2** in
`task_executor.rs:663`, and `run_lanes(max_parallel, …)` in `build_session/fanout.rs:288`. Everything
else is whatever the caller happens to launch. The live ledger shows **4 headless legs completing
within the same second** on 2026-06-26 (a lower bound, since completion timestamps are not start
times) during a day that ran 770 of them.

### 7.C 24 of the 60 files that launch a headless model call contain no spend record at all

Two independent scans agree on the population: **79 headless model-call functions across 60 files**
(anchor 1 = `build_cli_args(None, …)`; anchor 2 = `Command::new(&<resolved binary>)`; anchor 3 =
callers of the four shared wrappers; `#[cfg(test)]` excluded by brace-matched range). Testing each
file for **any** of the three recording spellings this repo uses — `llm_spend::observe_line` /
`llm_spend::record`, `turn_ledger::record_cli_leg` / `record_failed_leg` / `record_turn`, and
`build_session::events::record_build_spend` — gives **36 metered / 24 not**.

**24 is an upper bound and this document does not claim it.** Six were hand-audited and refuted:

- `engine/src/cli_process.rs` — the spawner itself; 8 of its 9 callers meter (`twin.rs:1701` is the one
  that does not).
- `credentials/shared.rs:10` and `engine/ai_helpers.rs:174` — pure argv builders, no spawn.
- `engine/src/bridge_manifest/mod.rs:298` — **not a model call at all**; a generic desktop-bridge
  binary spawn caught by the resolved-binary anchor. A true anchor false-positive, named here because
  §9's rule shares that anchor.
- `fleet/external.rs:156` — the operator's own console session; out of scope by §1.
- `engine/src/cli_capabilities.rs:67` — a capability probe that sends the literal prompt
  `"capability probe"` and kills the child at the `init` event; arguably ~free.

So the honest figure is **≈18 files that launch a real headless model call and keep no record of it**,
including `n8n_transform/cli_runner.rs` (three sites, zero occurrences of the substrings `cost`,
`usage` or `spend` in the whole file), `design/reviews.rs`, `design/template_adopt.rs`,
`obsidian_brain/{revitalize,semantic_lint}.rs`, `teams/teams.rs`, `infrastructure/scraper.rs`,
`fleet/naming.rs`, `engine/kb_extract.rs`, `engine/memory_reflection.rs`,
`engine/project_tracking/consolidator.rs`, `engine/team_assignment_matching.rs` (two sites), and
`engine/build_session/{mod,fix_pass}.rs`'s session-start path.

**Three front doors, two tables.** `dev_llm_spend` (main DB) is reachable through
`llm_spend::observe_line`, `llm_spend::record` **and** `build_session::events::record_build_spend`;
`companion_turn` (user DB) through `turn_ledger::record_cli_leg` / `record_failed_leg` / `record_turn`.
Three spellings for one concept is why a scan for "does this file meter" has to know all of them —
and why an author adding the nineteenth headless call has three plausible-looking answers and no
obvious one.

### 7.D The two kpi legs record the wrong model, and drop the timeout

`engine/kpi_binding.rs:482` and `engine/kpi_derivation.rs:318` both call
`athena_reaction::cli_text_with_usage(prompt)`, which runs on `model_routing::MICRO.model` =
`"claude-sonnet-5"` (`model_routing.rs:44`). Both then build the spend row by hand:

```rust
crate::db::repos::llm_spend::record(pool, &LlmSpendInsert {
    source: "kpi".to_string(),
    trigger_kind: "kpi_derivation".to_string(),
    model: Some("claude-sonnet-4-6".to_string()),   // ← kpi_derivation.rs:325, kpi_binding.rs:487
    …
});
```

**The ledger's `model` column is wrong at both sites.** `CliUsage` (`turn_ledger.rs:107-116`) carries
cost, tokens, duration, turns and `is_error` — but **not the model**, so the caller cannot recover it
from the usage block and must pass what it called. `llm_spend::parse_result_line` exists precisely to
prefer the CLI-reported model over a caller's pin (`llm_spend.rs:83`), and these two sites bypass it by
constructing the insert directly. This is a one-line fix at each site (`model_routing::MICRO.model`)
and a better fix on the primitive (add `model` to `CliUsage`).

Compounding it: both sites guard the recorder with `if let Some(u) = &usage`, so a leg that produced
no terminal event — killed, crashed, timed out — records **nothing**; and `cli_text_with_usage`
discards `HeadlessRun.timed_out` entirely, so neither caller can distinguish a clean leg from one the
180 s cap killed. `athena_reaction.rs:537-542` documents this hazard in its own docstring for the
tracked wrappers; the untracked one re-introduces it.

### 7.E The unmetered escape hatch has zero callers

`athena_reaction::cli_text` (`athena_reaction.rs:419`) is documented as the "Untracked variant — kept
for engine callers (`kpi_binding` / `kpi_derivation`) that don't carry a user-db handle." Grep across
963 Rust files for `cli_text(` outside its own module: **zero call sites.** The two engine callers it
was kept for use `cli_text_with_usage` instead — which *hands back* the usage rather than withholding
the unmetered path.

That is a useful natural experiment for the type-over-gate question below. The repo has three
positions on the same axis, in the same crate:

| Door | Posture | Callers | Outcome |
|---|---|---|---|
| `call_claude_text` (`oneshot.rs:122`) | **withholds** — no unmetered entry point exists | 8 | 8/8 metered, unavoidably |
| `cli_text_with_usage` (`athena_reaction.rs:433`) | **hands back** the usage; recording is the caller's | 2 | 2/2 record — but **both record the wrong model** (§7.D) |
| `cli_text` (`athena_reaction.rs:419`) | **permits** an unmetered call | **0** | dead code |

Withholding scores 8/8 on correctness. Handing back scores 2/2 on *presence* and 0/2 on *accuracy* —
the caller that must re-state a fact will re-state it wrong. Permitting scores nothing because nobody
took it. **Delete `cli_text`.**

### 7.F The prompt-size instrument covers 7% of the ledger and 0% of the headless legs

`companion_turn` carries `prompt_blocks_json`, `prompt_block_hashes_json` and `total_prompt_chars`.
They are written at **one** site — `session.rs:1268-1270`, the interactive chat turn. In the live
ledger:

| origin | rows | rows with `total_prompt_chars` | max chars | mean chars |
|---|---:|---:|---:|---:|
| headless | 1,636 | **0** | — | — |
| maintenance | 14 | **0** | — | — |
| cli | 2 | **0** | — | — |
| chat | 88 | 87 | 181,265 | 160,361 |
| proactive | 38 | 37 | 177,353 | 154,847 |
| autonomous | 1 | 1 | 150,142 | 150,142 |

So the one surface with a human watching a spinner is the one whose prompt size is measured, and the
1,650 calls with nobody watching are the ones flying blind. The chat figures also establish that this
is not a small number: a mean of **160 KB** of assembled prompt, which is roughly 40 K tokens before
the conversation begins.

**Truncation.** Across the tree, `.chars().take(N)`, `.truncate(CONST)`, `.iter().take(N)`, `[..CONST]`
and `const MAX_*_{CHARS,BYTES,LEN,LINES,ITEMS,ROWS}` give **427 raw occurrences**; narrowing to the two
forms that actually cut prompt text (`.chars().take(` and `.truncate(CONST)`) gives **202 sites, of
which 166 (82%) have no `tracing::` line, no `truncated`/`elided`/`omitted` token, and no marker within
±400 characters.** That figure is a superset of prompt assembly — it includes UI previews and log
clipping — and this document does not claim all 166 are prompt truncations. What it does claim is the
shape: a scan that saw five of five hundred rows and a scan that saw all five produce identical
telemetry, and there is no field anywhere in either ledger that could tell them apart.

Per the convergence check, **no sibling repo records truncation either** (0/11 in `ascent`, 0/30 in
`vibeman`, 0/3 in `personas-cloud`, 1/6 in `brainiac` and that one only as a marker the model sees).
This is the one clause in this document with no external warrant at all.

### 7.G The aggregate ledger persists a table that has never held a row, and enforcement is env-gated off

`core/src/run_budget.rs` is the general run-level ceiling. Since
[`llm-spend-accounting`](./llm-spend-accounting.md) §7.G was written, a persistence path **has** landed
(`db/src/repos/run_budget.rs::persist`, called from `engine/src/test_runner.rs:344` and
`commands/execution/genome.rs:459`) — so that path's "has never persisted a row" is now a claim about
the code that is no longer true.

It is still true about the data. In the operator's live database the `run_budgets` table exists and
holds **0 rows**. And enforcement remains opt-in through an environment variable:

```rust
pub fn enforce_enabled() -> bool {           // core/src/run_budget.rs:77
    matches!(std::env::var("PERSONAS_RUN_BUDGET_ENFORCE").ok().as_deref(),
             Some("1") | Some("true") | Some("yes") | Some("on"))
}
```

Unset in every shipped configuration, so crossing the ceiling sets a flag, emits one `tracing::warn!`
and does not abort. A ceiling whose enforcement is off by default and whose ledger is empty is a
measurement instrument, not a control — which is exactly what its own module docstring says
(`run_budget.rs:20-27`), and the honest reading is that the design is right and the rollout is
incomplete.

### 7.H The failure taxonomy is fully built and has zero live instances — and that is not evidence

`companion_turn` carries `is_error` and `error_reason`. In 1,779 live rows: **`is_error = 0` for all
1,779, `error_reason` NULL for all 1,779.** Not one failed leg has ever been recorded.

**This is not a defect and this document declines to report it as one.** The last headless row is
dated 2026-07-26; `record_failed_leg` and `flag_timeout` were added later, and `turn_ledger.rs:236-240`
explains that before them "every `?` in the tracked wrappers returned before their `record_turn` call,
so the ~94% of `companion_turn` rows that are headless were structurally incapable of reporting a
failure." So the zeros describe the era the data comes from, not the code that ships today. The
correct statement is: **the taxonomy is unexercised, and the first failed headless leg after this
change is the test.** Cited here because a naive read of the live ledger would report "0% failure rate
across 1,779 headless model calls", which would be a beautiful and completely false number.

### 7.I Five headless sites name no model at all

`build_cli_args(None, None)` emits `--model` only when a `ModelProfile` supplies one. Five headless
sites pass neither and never push the flag themselves:

| Site | Function |
|---|---|
| `engine/src/cli_capabilities.rs:67` | `probe` |
| `src/commands/design/reviews.rs:331` | `start_design_review_run` |
| `src/commands/design/reviews.rs:814` | `rebuild_design_review` |
| `src/engine/team_assignment_matching.rs:342` | `match_via_llm_eval` |
| `src/engine/team_assignment_matching.rs:495` | `decompose_goal` |

All five ride the CLI account default. `capabilities.rs:20-24` already records what that costs.
Two of the five (`team_assignment_matching`) additionally comment that "Sonnet sometimes hallucinates
an id that wasn't on the list" (`:369`) — a model-specific claim about a call that does not pin a
model.

### 7.J The model vocabulary is 77 literals in 58 files, and three of them are singletons

Excluding the 9 `"claude-code"` engine-name literals and one `"claude-code-cli"` source tag, the tree
holds **77 model-id string literals across 58 non-test files**. Distribution:
`claude-sonnet-4-6` × 50, `claude-haiku-4-5-20251001` × 11, `claude-opus-4-8` × 8,
`claude-sonnet-5` × 4, and four singletons — `claude-haiku-4-5` (`core/src/models/agent_ir.rs:364`),
`claude-haiku` with no version (`core/src/models/team.rs:111`), `claude-sonnet-4-5-20250514`
(`design/reviews.rs:1686`), `claude-opus-4-6` (`engine/mod.rs:3499`).

Three of the 77 are inside `model_routing.rs`. Everything else is a literal at or near a call site.
There is no test, no census rule and no schema that asserts any of these ids is one the vendor
recognises, and no single list to diff against a release note.

### 7.K One retry loop in the whole headless surface

`engine/kpi_binding.rs:480` — `for attempt in 0..2u8` — with a comment explaining that an explicit
decline is an answer rather than a flake and therefore does not retry. That is the correct design.
It is also the only one. Every other headless leg gets one attempt: a transient CLI spawn failure, a
429, a dropped pipe, or a 180 s timeout ends the job, and there is no human present to press anything.

### 7.L What this path CLEARED

Four things the brief or the obvious reading would predict, which the measurement refutes:

- **"Headless calls are unmetered."** No — 36 of 60 files record, and the two ledgers between them
  hold 1,867 rows. The problem is concentrated in a named ≈18 files, not diffuse.
- **"`compose_tour` pays for a Claude call before it fails on a missing table."** True when written,
  **fixed 2026-08-15** — `db/src/lib.rs:1492-1512` moved the `companion_tours` DDL to the user DB and
  documents the whole incident. The *class* survives (§8.4) but this instance does not, and the brief's
  example should not be re-reported as live. Both databases hold 0 tour rows, so the fix is also
  unexercised.
- **"Nobody kills the child on timeout."** No — of the 18 resolved-binary spawns, 10 set
  `kill_on_drop(true)` and 8 additionally call `child.kill()` explicitly on the timeout branch;
  `oneshot.rs:50-59` explains the belt-and-suspenders reasoning in detail. The remaining gap is
  already counted by `unbound-child-lifetime` and is not re-counted here.
- **"The model choice is arbitrary."** No — where a tier table is used it is *better* evidenced than
  anything in the four sibling repos (`model_routing.rs` cites a 1,026-turn bench with per-cell
  accuracy and latency). The defect is coverage, not quality: three constants against 77 literals.

---

## 8. Gaps in the primitives

### 8.1 `build_cli_args`'s first parameter conflates "no owner" with "no ceilings"

```rust
pub fn build_cli_args(persona: Option<&Persona>, model_profile: Option<&ModelProfile>) -> CliArgs
```

`None` is a legal, load-bearing value that silently withdraws four bounds. There is no way to say
"this call has no persona **but** here is its budget, its turn cap and its API timeout" — the
parameter that carries the identity is the same parameter that carries the safety envelope. **This is
the root cause of §7.B and, transitively, of most of §0.** Until the envelope is separable from the
owner, every headless call is unbounded by default and the only remedy is 20 hand-typed `--max-turns`
pushes.

### 8.2 `spawn_headless_claude` requires the model and nothing else

It made the right move once — `model: &str` is positional and required, which is why all 9 of its
callers pin a model. It stops there: `extra_args: &[String]` is where a budget, a turn cap and a
timeout would go, and being an opaque slice it can hold all of them or none, indistinguishably. The
helper also returns a bare `tokio::process::Child`, so *draining and metering are the caller's job*
— which is why 1 of its 9 callers (`twin.rs:1701`) does not meter. Compare `call_claude_text`, which
returns a `String` and has already written the row.

### 8.3 `CliUsage` carries the cost but not the model

`turn_ledger.rs:107-116` has cost, four token counts, duration, turns and `is_error`. It does not have
`model`, so any caller recording spend from a usage block must re-state the model from memory —
which is exactly how §7.D happened, twice. Adding one `Option<String>` (populated from the `result`
event, which reports it) would make the wrong row unconstructible.

### 8.4 There is no "cheap preconditions first" convention, and one instance already cost money

`compose_tour` (now fixed) paid for a Claude call and *then* discovered its table lived in the wrong
database. The general shape — an expensive irreversible call placed before a cheap fallible check —
has no primitive and no gate. A `preflight()` convention (validate the destination, the credential,
the config, the disk, before the spawn) would be one line per site; today each site orders its own
`?`s by whatever read naturally. This is genuinely ungatable statically — "could this check have run
first" requires knowing that the check does not depend on the model's output — and it belongs in
review, not in a matcher.

### 8.5 There is no global headless admission point

`ConcurrencyTracker` exists, works, is unit-tested, and takes a `persona_id`. Every headless call
would need a synthetic persona id to use it, which nobody has done. The result is that the app's one
real admission control is inapplicable to 92% of its model calls. The fix is a wider key
(`enum CallOwner { Persona(String), Headless(&'static str) }`) rather than a second tracker — a second
tracker is how `run_budget` and `deliberation` already ended up with two aggregate ceilings that do not
know about each other.

### 8.6 Three recording front doors, two tables, and no reconciliation

`companion_turn` (user DB) and `dev_llm_spend` (main DB) both hold headless spend, keyed differently
(`origin`/`trigger_kind` vs `source`/`trigger_kind`), reached through three helpers, and nothing sums
them. "What did the app spend on headless work this month" currently requires knowing which of two
databases each subsystem chose, and the choice tracks which module the author happened to be editing.

### 8.7 A timeout that returns `Ok` is invisible to `?`

`athena_reaction::cli_text_inner` returns `Ok(HeadlessRun { timed_out: true, … })` on its 180 s cap,
deliberately, so callers get their partial blob. The cost is that the *only* signal is a bool a caller
must remember to read, and `cli_text_with_usage` proves callers do not (§7.D). A `Result<T, Timeout>`
or a `#[must_use]` newtype would make the omission a compile error.

---

## Convergence — what the five sibling repos say

Run against `brainiac` (Rust/Postgres, 8 chat + 2 embedding sites), `personas-cloud` (Node
orchestrator/worker, 1 spawn / 6 launch sites), `ascent` (Next.js, 6 transports / 10 entry points),
`vibeman` (Next.js, 27 sites / 3 lanes), `personas-web` (**negative control — 0 model calls**).

| Clause | brainiac | personas-cloud | ascent | vibeman | Verdict |
|---|---|---|---|---|---|
| One chokepoint owning the spawn/request envelope | **8/8**, private module, 0 bypass | **6/6**, 0 bypass | 2/2 in-app, 3 script bypasses | 20/27, **7 bypass** across 3 lanes | **Physics — 4/4 reinvented.** This repo is the weakest of the five: 3 partial spawners + ~10 hand-rolled |
| The ceiling is a **required field** of the request type | `max_tokens: u32` required → 8/8 | `config.timeoutMs: number` required → 1/1 | optional → 3 unmetered calls | optional → 40,096 default, **no `signal` field at all** | **Physics — reinvented twice on two different knobs; its absence is measurable as money in the other two** |
| Metering unreachable-around | **structural** (private module) → 8/8 | 1/1 (single path) | `onUsage?` optional → 3 real calls unmetered | call-site + optional `projectId` → **1 site persists tokens** | **Physics on the principle; only brainiac implements withholding.** This repo has all three postures at once (§7.E) |
| Cost survives a kill / a failure | `Err(_) => (0,0,false)` with `status=error`, *"cost unknown ≠ cost zero"* | `?? 0`; SIGKILL'd run bills **$0** | usage committed **only on success** | Lane C/D good, Lane A loses it | **Physics — 2/5 solved. This repo is one of the two** (`flag_timeout`) |
| A spend gate **before** a headless call | absent | 1 of 6 launch sites; **absent on cron + Kafka**; fail-open 4 ways | 4 of 5 paths, fail-closed; **absent on push-webhook** | absent | **Physics, as a failure mode: the gate is always built for the interactive door and missing from the automatic one** |
| A concurrency ceiling on the second lane | worker **4**, sweeps **unbounded** | 1/worker, no global cap | **4**, webhook path **unbounded** | CLI **4**, scan 1, SDK + Ollama **unbounded** | **Physics — 5/5, and four picked the number 4** |
| One canonical model table, zero literals at call sites | **yes** (`gateway/src/lib.rs:122`), 11 literals all in the provider layer | **no model is ever passed** → container default | 5 env defaults, no single table, 40 literals / 8 lists | no table, 20 literals, **3 disagreeing defaults** | **1/4. A canonical table is rare; the *failure* (unspecified → most expensive default) is reinvented in 2** |
| Truncation is recorded | 1/6 (marker only) | **0/3**, no marker | **0/11** | **0/~30** | **Silence. 0/4 — this clause is an invention, not doctrine** |
| Retry around the model call | 3 attempts + breaker | assignment only | retry→failover→mock | exists but Anthropic path bypasses it | **2/4 — strong, not settled.** This repo: **1 loop total** |
| Kill/abort plumbed to the model | process-level SIGTERM drain; no per-call cancel | SIGTERM drain + explicit cancel | AbortController end-to-end; **no SIGTERM handler at all** | Lane C/D good; **Lane A's signal dies at the HTTP boundary → billed zombie calls** | Mixed; every repo has exactly one lane where it does not reach |

**The sharpest external finding, and the one that most directly validates this path's prescription:**
`vibeman`'s `LLMRequest` has no `signal` field (`src/lib/llm/types.ts:3-30`), so the `AbortController`
constructed at `scanQueueWorker.ts:455` — with the comment *"to cancel zombie LLM requests on
timeout"* — cannot reach the model call. It tears down a `fetch` while the server-side
`messages.create()` runs to completion, is fully billed, and its result is discarded. The bug is not
at a call site; **no call site could pass a signal.** That is a type-level absence producing a
recurring cash cost, and it is the clearest available argument for P2.

**Two silences worth naming as silences.** (1) **Nobody records truncation** — five codebases,
~50 truncation sites, one marker. (2) **Nobody strips a billing credential per call** — because
nobody else spawns a CLI that authenticates from ambient environment. §9's rule is therefore a
manifestation-layer artifact in the strongest sense: the *condition* (state who pays) travels, and
the *proxy* does not travel anywhere.

---

## Type over gate — the answer

**Yes, and there are three moves, in value order. All three are cheaper than the gate and none of them
is the gate.**

Held against the six earned qualifications:

**1. Separate the safety envelope from the owner — and make it required.**
`build_cli_args(persona: Option<&Persona>, …)` uses one `Option` to encode two facts: *who owns this*
and *what may it spend*. **Qualification 1 says a required parameter carries only what it actually
encodes** — so do not make `persona` required (most headless calls genuinely have no persona; that
would be a lie the compiler enforces). Instead add a second, required parameter that encodes only the
envelope:

```rust
pub struct CallCeiling { pub max_budget_usd: Option<f64>, pub max_turns: Option<u32>, pub api_timeout: Duration }
pub fn build_cli_args(owner: CallOwner, ceiling: CallCeiling, profile: Option<&ModelProfile>) -> CliArgs
```

39 call sites change; each one must then *state* its ceiling, including by stating `None` explicitly,
which is the difference between a decision and an omission. **Qualification 2 — requiredness is
orthogonal to closedness — applies and limits the claim**: making `ceiling` required does not stop
anyone writing `CallCeiling::unlimited()`. What it does is move the unbounded case from *the default
you get by typing less* to *a thing you typed*, which is the whole of the win and is exactly what
`brainiac`'s `max_tokens: u32` and `personas-cloud`'s `config.timeoutMs: number` buy — 8/8 and 1/1
respectively, against `vibeman`'s optional knob and its 40,096-token fallback.

**2. Withhold the unmetered door — and this repo has already run the experiment.**
**Qualification 5, withholding beats requiring, is not a hypothesis here; it is measured on three
sibling doors in one crate** (§7.E): withholding → 8 callers, 8 correct; handing the usage back →
2 callers, 2 present-but-wrong; permitting → 0 callers. `brainiac` reached the identical design from
scratch by making its `providers` module private, so `meter` is `pub(crate)` and downstream code
receives only `Arc<dyn ChatProvider>` — there is no unmetered surface to reach, and metering is 8/8
without a single convention. **Qualification 6 is what makes this the right kind of withholding: the
dangerous freedom being withheld is "spend without recording", not "make a model call".** Callers
still get their text; they simply cannot get it without a pool. The concrete move here is to make
`spawn_headless_claude` return a metered handle rather than a bare `Child` — or, minimally, to delete
`athena_reaction::cli_text`, which withholds nothing today because nobody uses it, and to add `model`
to `CliUsage` so §7.D's wrong-model row becomes unconstructible.

**3. Make the model a tier, not a string.**
`spawn_headless_claude(prompt, model: &str, …)` already requires a model, which is why 9/9 of its
callers pin one — a real, already-banked win. But `&str` accepts any of 77 literals including four
that appear once. Narrowing it to `&'static TurnTier` (or a `ModelTier` enum resolved through
`model_routing`) makes the singleton typo unrepresentable. **Qualification 4 bounds this one honestly:
a type anyone can construct authenticates nothing** — a `ModelTier::Custom(String)` variant would
restore the whole hazard, so the enum must be closed and additions must go through
`model_routing.rs`. And **qualification 3 — a type nobody constructs constrains nothing** — is the
reason `CallCeiling` must be threaded through `build_cli_args` (39 sites, unavoidable) rather than
offered as an optional convenience next to it; an opt-in ceiling type would be constructed by the same
people who already push `--max-turns` by hand, and by nobody else.

**What the gate is for.** None of the three is a substitute for §9's census rule, and §9 is not a
substitute for them. The rule counts one narrow, high-severity condition (does this spawn say who
pays) that no type change above addresses, because the billing strip is a property of the *process
environment*, not of the request — and it holds the line at 5 while moves 1–3 land.

---

## 9. The missing gate

**Manifestation layer** ([`golden-path-contract.md:34-60`](../golden-path-contract.md)). The warning
must be loud: **no sibling repo gates anything in this document.** `brainiac` ships a workspace-wide
clippy gate aimed at panics; `ascent` and `vibeman` ship ESLint configs that say nothing about model
calls; `personas-cloud` has no custom lint at all. Nobody has independently invented gating headless
model calls. The conditions below travel; the signal does not.

### Checked first — the existing 87 census rules

| Rule | Overlaps? |
|---|---|
| `unbound-child-lifetime` (12 files / 13 matches, `cancelling-in-flight-work.md`) | **Yes, partially — and this path adds no second counter.** It counts a piped child spawned with no `kill_on_drop` between `Command::new` and `.spawn()`. Four of its twelve files are also model-call sites (`ocr/mod.rs`, `cli_process.rs`, `fix_pass.rs`, `consolidator.rs`), and its remaining eight are `ffmpeg`, `git_ops`, `bun`, `auth_detect`, `cli_capture`, `connector_readiness` — not model calls. The two rules are orthogonal: `oneshot.rs` and `memory_reflection.rs` are violations of §9's rule and compliant with that one; `artist/ffmpeg.rs:950` is the reverse. |
| `unknown-money-as-zero` (21 / 25, `llm-spend-accounting.md`) | Covers `cost.unwrap_or(0)` — the *recording* defect. This path's §7.D "record nothing when usage is `None`" is a related but distinct shape and is **not** given a second counter; it goes to the backlog as two named fixes. |
| `handrolled-llm-envelope-scan` (9 / 15, `model-composed-ui.md`) | Covers what happens to the model's **output**. No overlap. |
| `shell-vehicle-nonliteral-arg` (5 / 8) | Covers `cmd`/`sh` interpreters with non-literal command slots. The Windows arm of `run_claude_ocr` (`ocr/mod.rs:579`) spawns through `Command::new("cmd")` but with a literal argv, so it does not match — and it is invisible to this path's anchor too (stated as a recall gap below). |
| `optional-store-handle` (5 / 17) | Counts `Option<[&]DbPool>` parameters — the *weakened* form of the very handle `call_claude_text` requires. Adjacent and complementary: that rule counts the pool being made optional, this one counts the payer not being named. |
| `config-value-frozen-at-compile-time`, `unraced-loop-wait`, `process-global-caches-a-failure`, `env-default-conflates-unset-with-empty` | Checked; no overlap with any condition here. |

### The semantic conditions, stated stack-free

**C1 — a model call is launched without stating which billing identity pays for it.** The process
inherits its credential from ambient environment rather than from the call. *Gated below.*

**C2 — a model call is launched with no ceiling of any kind.** *Designed, measured, and REJECTED —
see below.*

**C3 — a call site re-derives the launch envelope instead of using the shared one.** *Rejected as a
duplicate; see below.*

**C4 — a headless call records no spend.** *Not gated; see below.*

**C5 — the prompt is truncated and the truncation is not recorded.** *Not gated; see below.*

### Conditions deliberately NOT gated, each with the number that decided it

- **C2 (no ceiling) — designed, built, run, and rejected on precision.** The signal was
  `build_cli_args(None, None)` reaching a spawn with neither `"--max-turns"` nor `"--max-budget-usd"`
  in between (negative-tempered, fn-boundary-guarded, 2,600-char window). It scores **7 files / 8
  matches**. The same anchors with the middle inverted to *require* a bound — the compliant control —
  score **14 files / 18 matches**, a separation of only **2.25×**. Worse, 2 of the 7 violating files
  are false positives: `engine/src/cli_process.rs:325` is `spawn_headless_claude` itself (the
  primitive), and `engine/src/cli_capabilities.rs:67` is a capability probe that sends a four-word
  prompt and kills the child at `init`. That is **≤71% precision against a 2.25× control**, and the
  contract forbids a gate that fires on correct content. **Refusing is the finding**, and the reason
  it fails is instructive: "has a ceiling" is not one syntactic fact — a wall-clock timeout, a turn
  cap and a per-call budget are three different bounds and several compliant sites choose exactly one.
  The right instrument is the **type** (Type-over-gate move 1), not a matcher.
- **C3 (hand-rolled envelope) — measured, and declined as a near-duplicate.** Anchoring on
  `"-p", "-"` assembled by hand and reaching a `Command::new` scores **6 files / 6 matches** with 100%
  precision after excluding `cli_process.rs` — but **4 of those 6 files are already counted by
  `unbound-child-lifetime`.** An 83%-overlapping second counter buys a different *reason* for the same
  files and no new coverage. Declined; the condition is prosecuted in §2 and §5 instead.
- **C4 (unmetered headless call) — not gated, because the metering can legally live one stack frame
  up.** `auto_triage.rs` is the worked counter-example: `run_evaluator_cli` (`:273`) builds and spawns,
  and `observe_line` is called by its caller `run_and_finalize` (`:372`). A function-scoped matcher
  calls that a violation; a file-scoped matcher calls it compliant; neither is right, because in
  `twin.rs` the same shape genuinely is a miss. Precision at function granularity would be ~50%.
  §7.C's ≈18 files go to the backlog as **named fixes, not a ratchet**.
- **C5 (silent truncation) — not gated, on both precision and warrant.** The 202-site population is a
  superset spanning prompt assembly, log clipping and UI preview, and separating them needs to know
  what the string is *for*. And the convergence oracle found **0 of 4** sibling repos recording
  truncation, so gating it here would ratchet a practice with no external evidence that it pays. It
  stays a §7 finding and a backlog item.
- **Model-id drift (§7.J) — not gated here.** A count of `"claude-*"` literals would be a ratchet on
  a number that should go *down* only through a migration nobody has scheduled, and the real
  instrument is a **test** asserting every literal resolves through `model_routing` /
  `tier_slug_to_model_id`. That is one `#[test]`, not a census rule.

### The rule — validated

```json
{
  "rules": [
    {
      "id": "unpinned-billing-account-spawn",
      "goldenPath": "docs/concepts/golden-paths/headless-model-call.md",
      "title": "A model-invoking child process launched without pinning which account pays",
      "roots": ["src-tauri"],
      "extensions": [".rs"],
      "signal": {
        "pattern": "Command::new\\s*\\(\\s*&(?:cli_args\\.command|cmd_program|command|program|binary)\\s*\\)(?:(?!force_subscription_auth|CLI_SUBSCRIPTION_RESERVED_ENV|Command::new)[\\s\\S]){0,2000}?\\.\\s*spawn\\s*\\(\\s*\\)(?:(?!Command::new)[\\s\\S]){0,400}?[Cc]laude",
        "flags": "g",
        "ignoreCommentLines": true,
        "description": "a resolved-binary child process that identifies itself as the Claude CLI on its own spawn-error path, launched with NEITHER force_subscription_auth() NOR an inline CLI_SUBSCRIPTION_RESERVED_ENV loop anywhere between Command::new and .spawn(). PROXY FOR the stack-free condition: a model call is launched without stating which billing identity pays for it, so it inherits whatever credential happens to be in the process environment. PRECISION 5/5, every match opened and confirmed. The negative-tempered middle is what makes this a fact rather than a taste judgement: the SAME anchor with the middle inverted to REQUIRE the strip scores 12 matches across 10 files, and the two halves partition 17 of the anchor's 18 raw matches (the 18th, bridge_manifest/mod.rs:298, is a generic desktop-bridge binary that reaches .output() rather than .spawn()) - so the count measures the STRIP, not 'how many CLI spawns exist'. The trap this rule exists to see through: four of the five violating sites DO run `for key in &cli_args.env_removals { cmd.env_remove(key) }`, which reads like billing hygiene and is not - build_cli_args populates env_removals with CLAUDECODE / CLAUDE_CODE / DISABLE_PROMPT_CACHING* only (cli_args.rs:184-199) and never the three auth vars, so the loop that looks like the guard is not the guard. RECALL is deliberately partial: ocr/mod.rs:579 spawns the same call through Command::new(\"cmd\") on Windows and is invisible to a resolved-binary anchor; a site whose strip arrives more than 2000 chars after Command::new would read as compliant. PRECONDITION (must be re-derived per repo): this repo bills a Claude CLI subprocess against either an OAuth subscription or a pay-as-you-go API account, and the API path is selected by three INHERITED env vars (ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN / ANTHROPIC_BASE_URL, cli_process.rs:36-40) that must be stripped per spawn. A repo that calls a hosted SDK with an explicit client object has the SAME condition wearing different syntax and scores ZERO here - which is what all four sibling repos audited for this path do, and why none of them has this rule."
      },
      "exclude": [],
      "baseline": { "files": 5, "matches": 5 },
      "floor": 900
    },
    {
      "id": "unpinned-billing-account-spawn-positive-control",
      "goldenPath": "docs/concepts/golden-paths/headless-model-call.md",
      "title": "Positive control — the identical anchor with the account strip PRESENT",
      "roots": ["src-tauri"],
      "extensions": [".rs"],
      "signal": {
        "pattern": "Command::new\\s*\\(\\s*&(?:cli_args\\.command|cmd_program|command|program|binary)\\s*\\)(?:(?!Command::new)[\\s\\S]){0,2000}?(?:force_subscription_auth|CLI_SUBSCRIPTION_RESERVED_ENV)",
        "flags": "g",
        "ignoreCommentLines": true,
        "description": "the COMPLIANT half of unpinned-billing-account-spawn: same anchor, same window, middle inverted from 'no strip' to 'strip present'. Scores 12 matches across 10 files against the violating rule's 5/5. It must be materially non-zero, must not overlap the violating set, and the two together must account for the anchor population (17 of 18) - otherwise the violating rule is measuring 'is this a spawn' rather than 'is the payer named'. It carries NO baseline by design: a ratchet is monotone-downward and a control counting compliant code would fail the build every time adoption improved."
      },
      "floor": 900
    }
  ]
}
```

### Validation — reproduced, fault-injected, positive-controlled, and re-extracted

Run against a private registry (never `scripts/census/rules.json`, per the contract's
concurrent-writer warning):

```
node scripts/census/run-census.mjs --rules <private>.json --check --verbose
```

| Check | Result |
|---|---|
| Baseline reproduces | `OK` — 5 files / 5 matches / 963 walked / floor 900 · **exit 0** |
| Runtime | **0.81 s** for both rules. No lookbehind of any kind; both anchors forward-chained with bounded `{0,2000}` / `{0,400}` quantifiers |
| Precision | **5/5** — all opened: `artist/mod.rs:676`, `standards_scan.rs:225`, `revitalize.rs:249`, `ocr/mod.rs:596`, `consolidator.rs:354` |
| **Positive control** — same anchor, strip required | **12 matches / 10 files** vs 5/5. The two rules partition **17 of the anchor's 18** raw matches |
| Fault: baseline `4/4` (a new violation appears) | `[drift] files rose 4 -> 5 (+1)`, `matches rose 4 -> 5 (+1)` · **exit 1** |
| Fault: baseline `6/6` (a silent drop) | `[drift] files dropped 6 -> 5 (-1) without the baseline moving` · **exit 1** |
| Fault: `roots` → a non-existent dir | `[structural] walked 0 files but floor is 900. THE MATCHER IS BROKEN, NOT THE CODEBASE CLEAN` + `zero-matches` + both drift codes · **exit 1** |
| Fault: an `exclude` entry matching nothing | `[structural] exclude "…/gone.rs" matched no file. The exemption is stale` · **exit 1** |
| Fault: the positive control given a `baseline` | `rules[1] … a positive control must NOT carry a baseline` at `validateRule` · **exit 1**, 0 rules scanned |
| **Re-extraction** — rule pulled back out of this document's fenced block and re-run | **identical: 5 files / 5 matches / 12 control matches / exit 0** |

The positive control is the load-bearing check. The anchor alone matches 18; adding the
*absence* of the strip gives 5; adding the *presence* of the strip gives 12; 5 + 12 = 17 of 18, and
the missing one is a non-model binary that reaches `.output()` instead of `.spawn()`. A clean
partition of the anchor population is stronger evidence than a ratio: it proves the rule discriminates
on the strip rather than on "is this a spawn at all".

### How it fails loudly if its own precondition is absent

`floor: 900` against 963 Rust files means a repo whose `roots`/`extensions` no longer describe it
reports **"THE MATCHER IS BROKEN, NOT THE CODEBASE CLEAN"** rather than a clean run. The
`zero-matches` structural check means a port to a repo that calls a hosted SDK instead of spawning a
CLI fails immediately rather than baselining at 0 — which is the correct outcome, because the
condition is present there in different syntax and this proxy cannot see it. `exclude` is empty by
design, so there is no stale-exemption surface at all.

### The census cannot express "must be zero"

This condition **should** be zero: there is no legitimate reason to spawn the Claude CLI without
saying who pays. The runner cannot express that — `assertRule` treats a zero-match rule as a
structural failure (*"a rule pinned at 0 is a gate that can never fail"*), so a rule that reaches 0
must be **deleted**, not baselined. The correct sequence is therefore: fix all five sites, ratchet
5→4→3→2→1, and when the last one lands, **delete the rule and this section** and rely on
`spawn_headless_claude`'s unconditional `force_subscription_auth` to keep it there — which is the
type doing the work the gate was renting.

---

## 12. Corrections to the brief

**1. "`compose_tour` pays for a Claude call BEFORE it fails on a missing table" — true when written,
fixed one day before composition, and the fix is itself unexercised.** `db/src/lib.rs:1492-1512` moved
the `companion_tours` DDL out of `migrations/incremental.rs` and into the user-DB schema on
2026-08-15, documenting the whole incident (the table existed in `personas.db` with 0 rows while all
four statements executed on `&UserDbPool`; `SELECT count(*) FROM companion_tours` against
`personas_data.db` returned "no such table"; the feature shipped 2026-07-30 and never wrote a row).
Verified on the operator's live copies today: **0 rows in `companion_tours` in *both* databases**, so
the repair has not yet been proven by a write either. The generalisable shape — expensive
irreversible work ordered before a cheap fallible precondition — survives as §8.4, but the named
instance must not be re-reported as live.

**2. "Who pays, and does anything cap it?" — the brief's framing assumes one question; it is two, and
they have opposite answers.** *Which account pays* is answered — badly, at 5 of 18 sites (§7.A), and
that is the gateable half. *What caps it* is answered nowhere: **zero of 79 headless call functions
carry a dollar ceiling**, and the reason is a single `Option` parameter, not a scattering of
oversights. Treating them as one question produces a gate on the wrong half; §9 gates the first and
Type-over-gate fixes the second, and the document is arranged that way deliberately.

**3. "Is the model chosen, defaulted, or inherited?" — the brief's three options are missing the
expensive one.** The fourth state is **inherited from the vendor's account default**, which is not
"defaulted" in any sense the code controls: `capabilities.rs:20-24` records it resolving live to
`opus-4-8[1m]` and names it "the dominant fleet cost driver". Five sites are in that state today
(§7.I), and `personas-cloud` is in it for *every* call. An audit that asks "is a model chosen?" and
accepts "there's a sensible default" as a yes will miss this entirely.

**4. "convergence = diverged" (the leaf's own metadata) is right about this repo and wrong about the
practice.** The oracle found the opposite of divergence on the two clauses that matter most:
**5 of 5 repos cap one concurrency lane and leave the second uncapped, and four of them chose the
number 4**; **3 of 4 repos with a spend gate are missing it on precisely the most-headless launch
path**. Those are not divergent practices, they are a convergent *failure mode* — which is a stronger
and more actionable result than divergence, because it says the mistake is structural rather than
cultural.

**5. "Is anything truncated, and does truncation get recorded?" — this turned out to be the one
question with a unanimous answer, and the answer is nobody.** 0/11 in `ascent`, 0/~30 in `vibeman`,
0/3 in `personas-cloud`, 1/6 in `brainiac` (a marker the model sees, not a field an operator can
query), 36/202 here. The brief treats "record the truncation" as an obvious best practice; five
independent codebases disagree by omission. It is retained as P9 and explicitly labelled an
**invention with no external warrant**, per the contract's rule that a clause found nowhere else must
be marked as such rather than quietly promoted.

**6. A correction to a sibling path, offered because this sweep re-measured it.**
[`llm-spend-accounting.md`](./llm-spend-accounting.md) §7.G says `run_budget` "is warn-only by default
and has never persisted a row". The first half still holds (`enforce_enabled()` reads
`PERSONAS_RUN_BUDGET_ENFORCE`, unset everywhere). The second half is now a claim about *code* that has
been overtaken: `db/src/repos/run_budget.rs::persist` exists and is called from `test_runner.rs:344`
and `genome.rs:459`. The *data* claim survives — the `run_budgets` table in the live database holds
**0 rows** — so the accurate statement is "the persistence path landed; nothing has exercised it".
Recorded here rather than edited there, per the parallel-composition rules.

**7. What the brief did not ask and should have.** The highest-value single measurement in this sweep
was not any of the six listed questions; it was **counting the same primitive's three sibling doors and
comparing their outcomes** (§7.E): withhold → 8/8 correct, hand back → 2/2 present but wrong, permit →
0 callers. A brief that asks "does the type prevent this?" gets a yes/no. A brief that asks "does this
codebase contain the same decision made three different ways, and what did each way score?" gets a
controlled experiment. Recommend adding that question to future briefs.

---

## Backlog

| # | Item | Where | Size |
|---|---|---|---|
| 1 | Five spawns state no payer — route through `spawn_headless_claude` or add `force_subscription_auth` | `artist/mod.rs:676`, `standards_scan.rs:225`, `revitalize.rs:249`, `ocr/mod.rs:579,596`, `consolidator.rs:354` | S |
| 2 | `kpi_binding.rs:487` / `kpi_derivation.rs:325` record `claude-sonnet-4-6` for a call that runs on `MICRO` (`claude-sonnet-5`) | 2 sites | S |
| 3 | Delete `athena_reaction::cli_text` — the unmetered door with zero callers | `athena_reaction.rs:419` | S |
| 4 | Add `model: Option<String>` to `CliUsage` so a wrong-model spend row is unconstructible | `turn_ledger.rs:107` | S |
| 5 | `cli_text_with_usage` returns `timed_out` (or a `Result<_, Timeout>`) so its callers can see a killed leg | `athena_reaction.rs:433` + 2 callers | S |
| 6 | Five headless sites pin no model → CLI account default | `cli_capabilities.rs:67`, `reviews.rs:331,814`, `team_assignment_matching.rs:342,495` | S |
| 7 | **`CallCeiling` as a required second parameter of `build_cli_args`** (Type-over-gate move 1) | `cli_args.rs:61` + 39 sites | L |
| 8 | ≈18 files launching a headless model call with no spend record | §7.C list | M |
| 9 | Global headless admission: widen `ConcurrencyTracker`'s key to `CallOwner` | `queue.rs`, `engine/mod.rs:886` | M |
| 10 | Flip `PERSONAS_RUN_BUDGET_ENFORCE` on by default, or replace the env gate with a setting | `core/src/run_budget.rs:77` | S |
| 11 | Populate `total_prompt_chars` for headless + maintenance legs (one site writes it today) | `turn_ledger.rs`, `oneshot.rs`, `athena_reaction.rs` | M |
| 12 | Reconcile the two spend ledgers behind one query; collapse three recording front doors to one | `llm_spend.rs`, `turn_ledger.rs`, `build_session/events.rs` | M |
| 13 | A `#[test]` asserting every `"claude-*"` literal resolves through `model_routing` / `tier_slug_to_model_id` | new | S |
| 14 | Narrow `spawn_headless_claude`'s `model: &str` to a closed `ModelTier` | `cli_process.rs:318` + 9 callers | M |
| 15 | Record truncation at prompt-assembly sites (labelled: no external warrant — see §12.5) | §7.F | M |
