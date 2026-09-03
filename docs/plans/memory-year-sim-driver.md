# `personas-memory-sim` — driving Athena's brain on a simulated clock

The `memory-year` harness (`evals/memory-year`) benchmarks memory architectures
by replaying a synthetic *year* of conversation and then probing what each one
can still answer. Athena's brain is one of the architectures under test, and it
is the only one that is not a Python object: it is a Rust module over SQLite
plus an append-only markdown store, living inside a Tauri app that assumes a
window, an `AppHandle` and a hosted model.

This document describes the two pieces that let the harness drive the real
brain anyway — a clock seam, and a stdin/stdout driver binary — and what they
deliberately cannot do. The model engine is not substituted: every call goes
through the Claude Code CLI on the subscription, the same way Athena's own code
already calls it.

---

## 1. The seam: `companion/brain/sim_clock.rs`

```rust
sim_clock::now()      -> DateTime<Utc>   // the override when set, else Utc::now()
sim_clock::now_sql()  -> String          // "YYYY-MM-DD HH:MM:SS", SQLite's datetime('now') shape
sim_clock::days_ago_sql(n) -> String     // the same shape, n days back
sim_clock::set(unix) / clear() / is_simulated()
```

The override is a process global: an `AtomicBool` (is one set?) beside an
`AtomicI64` (unix seconds). **With no override set, `now()` is literally
`Utc::now()`** — same call, same value, one relaxed atomic load in front of it —
so production behaviour is byte-identical: there is no second code path to
diverge, only a load that is `false` on every shipped build. (On this machine
that could not be *demonstrated* by the brain's own test suite — see the note at
the end of this document.)

### Why a global rather than a threaded parameter

The seam has to be *complete* to be useful. One missed site and a compressed
year silently mixes two clocks: the fact is written in 2026 and compared against
a boundary in the simulated 2025, and the resulting benchmark measures nothing.
Threading a `now: DateTime<Utc>` argument through ~50 functions across 20 files
would have rewritten the public surface of a module whose callers include Tauri
commands (wire contracts) — for a property that a global gets right by
construction. It is set only by the sim driver and by `sim_clock`'s own tests.

### The sites

| Where | `Utc::now()` | SQL `now` | Note |
| --- | --- | --- | --- |
| `brain/consolidation.rs` | 10 | 1 | includes the **6h lifecycle latch** and the decay cutoff; the consolidation-item `created_at` default |
| `brain/cycle_report.rs` | 3 | — | `started_at` / `finished_at` — what the cycle's interval floor keys on |
| `brain/daily_goals.rs` | 3 | — | |
| `brain/semantic.rs` | 3 | 1 | fact `last_seen_at`; tombstone `forgotten_at` |
| `brain/profile_synthesis.rs` | 2 | 7 | six `datetime('now','-30 days')` predicates behind one `WINDOW_DAYS`, plus two INSERT defaults |
| `brain/sleep_cycle/admission.rs` | 2 | — | the `MIN_INTERVAL_HOURS` floor and the first-cycle lookback |
| `brain/sleep_cycle/apply.rs` | 1 | — | |
| `brain/sleep_cycle/tests.rs` | 2 | — | |
| `brain/{backlog, goals, identity, procedural, rituals}.rs` | 2 each | — | |
| `brain/{briefing, cockpit, dashboard, decisions, doctrine, episodic, reflection}.rs` | 1 each | — | |
| `brain/taxonomy.rs`, `brain/sync_staging.rs` | — | 1 each | `created_at` / `received_at` defaults |
| **total** | **43** | **11** | **54 sites** |

`companion/prompt/recall.rs` reads no clock at all — it delegates to
`retrieval`, which delegates to the files above — so nothing there needed to
change for the seam.

The two behaviours a compressed year most needs are both on the seam now:

- **`consolidation::maybe_run_lifecycle_sweep`'s 6-hour latch.** It compares
  `sim_clock::now().timestamp()` against the last sweep, so a simulated week
  fires it as a real week would.
- **The sleep cycle's admission floors** — `MIN_INTERVAL_HOURS` (6h) and
  `STALENESS_HOURS` (72h) — measured in `admission::measure` from
  `sim_clock::now()` against the last completed cycle's `finished_at`.

### Column defaults became bound parameters

Where a brain INSERT used to omit a timestamp column and let
`DEFAULT (datetime('now'))` fill it, the statement now names the column and
binds `sim_clock::now_sql()`. A default is evaluated by SQLite, which has no
idea a simulated clock exists; a bound parameter is the only way that column can
follow the seam. The written *text* is identical to what the default produced.

### Probe reads

`retrieval::touch_recalled` is how the production path marks a memory as seen —
it restarts `last_seen_at` / `last_used_at`, which is exactly what
`consolidation::decay_unused_facts` keys off. A benchmark probe must not do
that, or the measurement keeps alive the thing it is measuring. There was no
existing read/probe distinction, so one was added: `retrieval::ProbeRead`, an
RAII guard that suppresses read-marking for its lifetime. Production never
constructs one.

---

## 2. The driver: `personas-memory-sim`

- Logic: `src-tauri/src/companion/brain/memory_sim.rs`
- Entry point: `src-tauri/src/memory_sim_bin.rs`
- Feature: `memory-sim` (pulls `personas-db/test-support`)

```
personas-memory-sim --db <path> --home <dir> [--leg-model <m>] [--turn-model <m>] [--ml]
```

It opens (creating if needed) a throwaway user DB at `--db` with the **full**
`COMPANION_SCHEMA` through the test-support accessor plus the incremental
`ALTER`s `init_user_db` applies after it, points `PERSONAS_HOME` at `--home` so
`disk::brain_root()` resolves inside the sandbox, then reads one JSON request
per line from stdin and writes one JSON reply per line to stdout. stderr is for
logs. Any error answers `{"ok":false,"error":"…"}` and the process keeps
serving.

The protocol is the harness's — the docstring of
`evals/memory-year/memory_year/backends/athena.py` is the spec.

| op | what it actually calls |
| --- | --- |
| `ingest` | `sim_clock::set(at)`, then `episodic::append_episode` — the same writer a chat turn uses. Returns the episode id. |
| `consolidate` | `sim_clock::set(at)`, then `sleep_cycle::admit(pool, force)` and, when admitted, `sleep_cycle::run_admitted_with(pool, &CliLegs, admitted)`. Returns `admitted` + the cycle's own `stats_json` counts + the ledger delta that cycle spent. |
| `recall` | `sim_clock::set(at)`, then `retrieval::retrieve` under a `ProbeRead` guard when `probe:true`, rendered by `prompt::render_memory_block` — the same six `format_*` functions the prompt assembler composes — under `budget_chars`. Returns the text, the item ids and the `RecallTrace`. |
| `turn` | `sim_clock::set(at)`, then Athena's real turn — see below. Returns the reply, the prompt size, the recall ids, the model/effort, tokens and wall time. |
| `cost` | cumulative LLM calls/tokens read out of `companion_turn`, embeddings, and store bytes (db + `-wal` + `-shm` + a recursive walk of the brain root). |
| `quit` | `{"ok":true}`, exit 0. |

### The model engine is the tree's own: Claude Code CLI on the subscription

Athena already implements the Claude Code CLI as her LLM engine across this
app; the driver reuses that rather than reinventing one.

- **Cycle legs** go through `brain::oneshot::call_claude_text(pool, prompt,
  model, leg, timeout)` — the exact call production's `sleep_cycle::MeteredLegs`
  makes. It spawns `claude -p -` with `--output-format stream-json`, strips
  `ANTHROPIC_*` so the CLI uses its OAuth/keychain credentials (never the API
  account), and writes one `companion_turn` row per leg with
  `origin='maintenance'` and the leg name in `trigger_kind`. The driver's
  `CliLegs` **is** `MeteredLegs` with one addition: an optional `--leg-model`
  that pins a different model for a measured run without that override leaking
  into the routing table. Absent the flag, the model is
  `model_routing::ASIDE.model`, which is what `MeteredLegs` passes.
- **Chat turns** (`op: turn`) run at `model_routing::MAIN` — model and effort
  both — with `PERSONAS_ATHENA_MODEL` / `PERSONAS_ATHENA_EFFORT` honoured
  exactly as `session::model` resolves them.

Nothing here picks a model. `companion/model_routing.rs` is bench-calibrated and
stays the single source of truth; the driver only asks it.

### Cost comes out of the ledger, not a private counter

`cost` and the per-cycle deltas are `SELECT COUNT(*), SUM(...) FROM
companion_turn` — the same rows the app's own spend rollup groups by `origin`.
That is the point of routing every call through `call_claude_text` and
`turn_ledger::record_turn`: the harness's numbers and the app's are the same
numbers, and a leg that somehow skipped the ledger shows up as a discrepancy
instead of being quietly counted anyway. `tokens_in` sums fresh input **plus**
both cache columns — a cached read is still input the model was given, and
counting only `input_tokens` would make a long-context architecture look free
beside one that re-sends everything.

**This bit the first run.** `init_test_user_db`'s ALTER list is shorter than
`init_user_db`'s and omits four `companion_turn` columns
(`prompt_blocks_json`, `total_prompt_chars`, `prompt_block_hashes_json`,
`error_reason`). `record_turn` is best-effort by design — a ledger write must
never break a real turn — so the insert failed *silently* and the run reported
zero spend while spending real money, which is the one failure a cost benchmark
must not have. `open_store` now applies the full production ALTER list.

### `op: turn` — Athena's real turn, headless

`session::send_turn` cannot be called here: `send_turn_inner` takes an
`&AppHandle` and `session::cli::run_cli` is `pub(super)`. Rather than refactor
the app for a benchmark, `turn` composes the same four pieces `send_turn_inner`
composes, in its order:

1. the user message lands as an episode (`episodic::append_episode`);
2. `prompt::build_system_prompt(user_db, sys_db, None, session, text, false,
   false, false)` composes the whole system prompt — constitution, identity,
   observability, the six memory blocks from live retrieval, the persona /
   context / skill / scene / device index blocks, the addenda — on the sim
   clock. (This is why the driver opens the **system** database too, lazily:
   that call needs it, and nothing else does.)
3. `claude -p` runs with the argv `run_cli` builds for a chat turn — same
   `base_cli_invocation()` prefix, same `--system-prompt-file` temp file, same
   `--exclude-dynamic-system-prompt-sections`, same subscription-auth stripping,
   same env, same `MAIN` model and effort;
4. the reply lands as an assistant episode and `turn_ledger::record_turn` writes
   the row with the CLI's own usage, the prompt-block sizes and their hashes.

**Skipped, and why none of it shapes the reply.** Every one is a side effect on
a UI or another subsystem:

| Skipped | Why it does not change the answer |
| --- | --- |
| The per-conversation turn lock | One process, one request at a time by construction |
| `companion://stream` emission, `--include-partial-messages` | No UI to stream to; the whole `assistant` messages still carry the full text |
| The `companion://recall` preview event | The preview is returned in the reply instead |
| `--resume` continuity (`read_/upsert_claude_session_id`) | **Deliberate.** The benchmark measures what *memory* carries across a year; borrowing the CLI's own conversation state would measure the wrong thing |
| `dispatcher::dispatch_with_sys` — op extraction, approval rows | Runs *after* the reply text exists; it acts on ops, it does not produce prose |
| The fleet bridge and orb notes, remote-job announcement | Routing of the reply to other surfaces |
| Incremental `PROGRESS:` beat persistence | Splits one reply into more episodes; the final reply is unchanged |
| Autonomous / proactive / external origins | The harness always sends a plain user turn |

The reply text is what the harness judges. Observed on the smoke run below:
a 9,732-char system prompt, `claude-opus-4-8` at effort `low`, 7.7s, and an
answer drawn entirely from the three facts and three procedurals the cycle had
distilled two simulated days earlier.

### Build

```sh
cargo build -p personas-desktop --features desktop,memory-sim --bin personas-memory-sim
# -> src-tauri/target/debug/personas-memory-sim(.exe)
```

`desktop` is needed because the crate's Tauri capability manifest references
desktop-only plugins (a build without it fails on
`Permission updater:default not found`); it is what CI builds with too.

Smoke run — turns on day 1, a forced cycle on day 2, a probe and a real turn on
day 3. It spends **three** subscription calls (two cycle legs on
`claude-sonnet-5`, one turn on `claude-opus-4-8`):

```sh
{
  echo '{"op":"ingest","role":"user","text":"I always use a git worktree.","at":1767225600,"conversation":"sim-year","scope":"preferences"}'
  echo '{"op":"consolidate","at":1767312000,"force":true}'
  echo '{"op":"recall","query":"how should I handle multi-file work?","at":1767398400,"budget_chars":4000,"probe":true}'
  echo '{"op":"turn","text":"What is my rule for multi-file work?","at":1767398400,"conversation":"sim-year"}'
  echo '{"op":"cost"}'
  echo '{"op":"quit"}'
} | ./target/debug/personas-memory-sim \n      --db /tmp/sim/personas_data.db --home /tmp/sim/home
```

`PERSONAS_ALLOW_FALLBACK_KEY=1` is set by the harness for headless auth.

The clock seam is visible in the result: every episode lands at its request's
`at` (`2026-01-01T00:00:00+00:00`, hourly), the cycle's `started_at` /
`finished_at` and both maintenance ledger rows are day 2, the chat ledger row is
day 3 — and because the `recall` probe ran under `ProbeRead`, it left
`last_seen_at` alone. (The `turn` did bump it, which is correct: a real turn is
a real read.)

---

## 3. What it cannot do

**No `AppHandle`, so nothing is emitted.** Every Tauri event the production
paths fire — `companion://recall`, `companion://job`, `companion://stream`, the
cycle's progress — has no emitter here, and `session::send_turn` (which takes
one) cannot be called at all. `turn` composes the same pieces instead; the table
above lists every step of `send_turn_inner` it skips, and each is a side effect
on a UI or another subsystem rather than a step that shapes the reply. But a
*future* behaviour that lives only in an event handler would be invisible to
this harness, and the fix would be to move it into the brain rather than to
teach the driver to fake a window.

**No dispatcher, so Athena cannot act.** `turn` produces prose. The ops she
proposes in it are not extracted, no approval rows are written, and nothing is
executed. A benchmark that scored her *actions* would need the dispatcher, and
the dispatcher needs a system pool it already has here plus an emitter it does
not — that is the next seam, not this one.

**Two ways to use it, and they measure different things.** `recall` hands the
harness the rendered memory block and lets the harness's own consumer answer —
that isolates *memory* from the model. `turn` runs Athena's whole prompt through
her own model and returns her answer — that measures the system as shipped. The
first is cheap and comparable across architectures; the second is the ground
truth the first is a proxy for. Use both.

Two smaller limits worth stating:

- **`--ml` needs an `ml` build.** The flag is accepted and validated, but the
  binary refuses to start if it was compiled without the `ml` feature, because
  there is then no vec0 table and no embedder. Even on an `ml` build the sim
  takes the keyword lane: `EmbeddingManager` is constructed from user settings
  and a downloaded ONNX model, neither of which a headless harness has. Default
  (no `--ml`) is the keyword lane, which is what the shipped desktop build runs,
  and `cost` reports `embeddings: 0` rather than inventing a number.
- **Episodes carry no scope.** `send_turn` does not stamp one and
  `companion_node` has no scope column — scope is a *fact* property the cycle
  assigns when it distils one. The request's `scope` is folded into the FTS tag
  string beside `session:` and `role:` so the keyword lane can reach it; nothing
  in production reads it.

---

## 4. One thing that could not be verified here

`cargo test -p personas-desktop --features desktop --lib companion::brain`
cannot run on this machine: the `app_lib` **test** binary fails to load with
`STATUS_ENTRYPOINT_NOT_FOUND` (0xC0000139) before any test starts. This is
**pre-existing and unrelated to the seam** — it reproduced on the untouched base
commit before a line was changed, three runs in a row — and it is specific to
that one target:

- `personas-db`'s test binary runs (900 passed / 13 failed, all pre-existing).
- `athena-bench-validate` and `personas-memory-sim`, bins from the same crate at
  the same feature set, build and run.
- `dumpbin /IMPORTS` finds the failing exe's imported DLLs *and functions* to be
  identical, set for set, to an older `app_lib` test exe that still runs.
- A build without `--features desktop` fails earlier still, in the Tauri build
  script (`Permission updater:default not found`), so there is no second feature
  set to fall back to.

What was verified instead: both feature shapes
(`--features desktop` and `--features desktop,memory-sim`) compile and clippy
clean, and the end-to-end smoke run above exercises the real episodic writer,
the real sleep cycle (admission, both legs through the production
`oneshot::call_claude_text`, the writers, the report), the real retrieval +
renderer, and one real Athena turn on `claude-opus-4-8` — all against a
simulated year. Someone on a machine where
that test binary loads should run the suite before and after this commit; the
seam's own unit tests (`brain::sim_clock::tests`) pin the property that matters.
