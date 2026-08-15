# Golden path — process-global command state

> Situation node: `backend-runtime/command-definition/process-global-command-state` · [situation spine](../situation-spine.md)
> Composed 2026-08-15 against the `master` **working tree** (HEAD moved `2a874e692` -> `85528c35b`
> under parallel composers during the sweep; every count below was read from files, not git objects,
> and the census rule was re-validated at `85528c35b`), from a brace-matched statement walk over all
> **945** production `.rs` files under `src-tauri/{src,core,db,engine,macros}` (`#[cfg(test)]` items
> removed by **range**, never by line threshold), classifying every `static` item by kind and
> mutability; a second, independent scope-resolving pass over the same corpus for lock lifetimes and
> lock ordering; a census-engine regex as the third implementation; plus ~40 files opened directly
> and two sibling-repo convergence oracles.
> Command and file totals cited from [`shared-facts.json`](../shared-facts.json)
> (`rust.tauriCommands` 1,661 · `rust.files` 963).
> Dimensions: **resilience · security · code-quality · function · performance**.
> The **Deviations** section is a fix backlog; it migrates to `violating` cells in
> `workspace_practice_context_state` when this path is ingested.

**Boundary with [`repository-crud-surface`](./repository-crud-surface.md) and
[`command-naming-placement`](./command-naming-placement.md).** Those paths own the database handle:
that a repository should exist, and that `state.db.get()` does not belong in a command module (gated
by `persistence-handle-in-command-tree`, 46 files / 134 matches). **This path does not re-raise
that.** What is this path's is the *why*: `db` is one of **39 fields on `AppState`, all 39 of them
`pub`**, and the struct has **zero methods**. Nothing about `db` is special — every field has the
same visibility, and the same argument applies to all 39.

**Boundary with [`background-loop`](./background-loop.md).** That path owns loop *shape* — the
`ReactiveSubscription` trait, the stop path, `unraced-loop-wait`. This path owns what those loops
*reach into*: **73 of the 74 `app.state::<T>()` / `try_state::<T>()` reach-ins in `src-tauri/src` sit
outside any `#[tauri::command]`**, which is how a loop obtains an `Arc<AppState>` at all.

**Boundary with [`hmr-safe-singletons`](./hmr-safe-singletons.md).** That is the frontend mirror: 25
`globalThis` keys, 13 of them state, across 8 owners. **The prose boundary is: that path's problem is
one process re-evaluating a module; this path's problem is one module serving 1,661 commands
concurrently.** They share a conclusion (§Prefer a type over a gate) and nothing else — a
`globalThis` slot survives HMR and dies on reload; a Rust `static` lives exactly as long as the
process and is visible to every thread in it from the instant it is initialised.

**Boundary with [`environment-variable-configuration`](./environment-variable-configuration.md).**
`std::env` is process-global state, and that path owns *reading* it (`option_env!`, defaulting,
`config-value-frozen-at-compile-time`). This path owns *writing* it — §Deviations D, where **one env
var is guarded by three different private mutexes and by nothing in three other files**.

---

## Trigger

- "Where do I put this so every command can see it?" / "does this go on `AppState`?"
- "I need a cache / registry / in-flight map that survives between calls"
- "I'll just make it a `static` so I don't have to thread it through"
- "Two commands are stepping on each other" / "this works alone and breaks under load"
- "It worked once and now it always fails until I restart the app"
- "This passes alone and fails when the whole test suite runs"

If you are about to type `static X: OnceLock<…>`, `static X: LazyLock<Mutex<…>>`, add a field to
`AppState`, write `app.state::<…>()`, call `std::env::set_var`, or hold a `.lock().await` guard
while you `await` something else — you are in this situation.

## The one way

**Default to *no* process-global state: pass the handle. Reach for a process-global only when the
resource is genuinely one-per-process — a pool, a keychain-derived key, a log writer, an OS port —
and then treat the single overriding hazard, which is that a process-global converts a *transient*
failure into a *permanent* one.** Every defect this sweep found is that one sentence: a
`OnceLock<Result<..>>` freezes the first attempt's failure for the life of the process
(§Deviations A); `.lock().unwrap()` on a `static` mutex makes one panicking command poison that
global for every later command (§Deviations E); a guard held across an `.await` turns one slow HTTP
call into a stalled surface (§Deviations C); `env::set_var` turns one test's temp directory into
every concurrent test's temp directory (§Deviations D). So: **(1)** if the value can be a parameter,
make it a parameter — this needs no further reasoning and it is where most state belongs;
**(2)** if it must outlive the call, put it on `AppState` where it is at least enumerable, and reach
it through the extractor, never `app.state::<T>()`; **(3)** if it must be a `static`, cache **only
the success** — `OnceLock<T>` with a `get()`-then-retry, never `OnceLock<Result<T, E>>` — take
poisoning as recoverable (`unwrap_or_else(|e| e.into_inner())`), and never hold its guard across an
`.await`; **(4)** if it is a keyed map with a lifecycle, use
[`KeyedResourcePool`](../../../src-tauri/src/keyed_pool.rs), which already exists and has **3
adopters against 54 hand-rolled equivalents**. And **write down which invariant the lock protects**,
because this repo's most consequential concurrency defect is a lock that correctly protects its
cache while the invariant it was believed to protect lives in the database (§Deviations B).

## Mandated primitives

- **`AppState` — `src-tauri/src/lib.rs:369`.** The sanctioned home. **39 fields, 9 of them
  `#[cfg]`-gated.** Reached as `state: State<'_, Arc<AppState>>` by **1,554 of the 1,661** commands.
  Its value is that it is *enumerable*: one struct, one file, one `.manage()` call
  (`lib.rs:1181`). Its cost is §Deviations F.
- **`state: State<'_, Arc<AppState>>` named exactly `state`** — the extractor, and the only
  supported way for a command to reach shared state.
  [`new-ipc-command`](./new-ipc-command.md) §Steps 4 already mandates the name; **this path adds
  that the *type* matters just as much and is unchecked** (§Deviations G).
- **`#[requires(privileged)]` / `#[requires(cloud)]` / `#[requires(auth)]` —
  `src-tauri/macros/src/lib.rs:57`.** **261 commands** carry it. Its documented job
  is authorization; its *undocumented* job is that it expands to
  `require_privileged(&state, "…")`, whose parameter is `&Arc<AppState>` — so applying it makes the
  wrong state type a **compile error**. Every one of the 258 is protected from §Deviations G by
  accident. The 1,400 without it are not.
- **`OnceLock<T>` with a `get()`-then-retry — `src-tauri/core/src/crypto.rs:497-556`. Copy this
  one.** The comment at `:498-503` is the single best statement of this leaf's hazard anywhere in
  the tree, because it is a post-mortem: a previous `OnceLock<Result<..>>` *"recorded the first
  outcome, so a single early failure returned the stale `Err` on every later call and bricked all
  credential encrypt/decrypt for the whole process, recoverable only by restart. Storing only on
  success lets a later call retry and succeed."*
- **`get_or_init` over `.set()` for boot-order independence.** **89 `get_or_init` call sites vs 19
  `.set()`.** The lazy form makes "which arrives first" unanswerable, which is why boot ordering is
  almost entirely a non-issue here (§Evidence, cleared).
- **`unwrap_or_else(|e| e.into_inner())` for a `static` lock — 271 call sites.** Poisoning on a
  process-global is not a bug to propagate; it is a prior panic you cannot undo. Taking the inner
  value keeps one bad command from bricking a global for the process.
- **`KeyedResourcePool<K, V>` — `src-tauri/src/keyed_pool.rs:46`.** RAII handles, active-count
  tracking, automatic pruning. Its own doc names the three implementations it replaces. **Use it for
  any keyed process-global map** — but pass real prune arguments (§Gaps 4).
- **`tokio::task_local!` for ambient state scoped to a request —
  `src-tauri/db/src/attribution.rs:34-90`. Copy this one too**, and never `thread_local!`. Its
  module doc states the reason precisely: task-local storage *"is visible from any synchronous code
  executed while that future is being polled — on whatever worker thread"*. It also ships the
  correct sync fallback: `ThreadAttributionGuard` (`:68-86`), an RAII guard that **restores the
  previous value on drop** so guards nest.

**Do NOT reach for:**

- **`static mut`** — **zero uses in 945 files.** Keep it that way.
- **`app.state::<T>()`** from anything that could have taken `State<'_, …>` — it panics when `T` is
  unmanaged, and **40 of the 74 reach-ins use the panicking form** rather than `try_state`.
- **`thread_local!` for anything an async command reads.** The repo has two, and the one carrying a
  security decision (`ipc_auth.rs:84`) is the one that broke (§Deviations H).
- **A new bespoke `OnceLock<Mutex<HashMap<…>>>`** when `KeyedResourcePool` exists.

## Steps

1. **Try to pass it.** Function parameter, struct field, `Arc` clone into the spawned task. The
   overwhelming majority of state does not need to be reachable from *any* command; it needs to be
   reachable from *this* call chain. This step is the whole path; the rest is for what survives it.
2. **Ask what the process actually owns.** A process-global is correct when the resource is
   one-per-process by nature: an OS handle, a bound port, a keychain-derived key, a connection pool,
   a log writer, a compiled regex. It is *not* correct because threading a parameter was tedious.
3. **If it survives the call but not the process, put it on `AppState`.** Then it is enumerable, it
   is constructed in one place with an explicit order, and it dies with the app.
4. **Reach it through the extractor.** `state: State<'_, Arc<AppState>>`, named `state`. Never
   `app.state::<T>()` from inside a command. If your code is *not* a command (a background tick, an
   HTTP route, a PTY hook) use **`try_state`**, not `state`, and handle `None` — a spawned task that
   panics is silent.
5. **If it must be a `static`, cache only the success.** `OnceLock<T>` plus
   `if let Some(v) = X.get() { return v }` and a retry, exactly as `crypto.rs:504-556` does. **Never
   `OnceLock<Result<T, E>>`** — see §The missing gate. If the value can legitimately change, you do
   not want a `OnceLock` at all; you want `Mutex<Option<T>>`.
6. **Prefer `get_or_init` to `.set()`.** `.set()` makes boot order load-bearing, and **13 of the 19
   `.set()` sites discard the result** (`let _ =` / `.ok()`), so a second initialiser is silently
   ignored and the first value wins forever.
7. **Name the invariant the lock protects, in a comment, before you write the lock.** If the
   invariant is "this cache has one entry", a mutex around the cache is sufficient. If the invariant
   is "there is exactly one enabled `system` API key row", **a mutex around the cache is not
   sufficient and never will be** — that invariant lives in the database and only the database can
   hold it (§Deviations B; the sibling repos reached this independently, §Convergence 2).
8. **Take poisoning as recoverable.** `unwrap_or_else(|e| e.into_inner())`. A `static` outlives the
   panic that poisoned it; `.unwrap()` propagates one command's bug to every later command.
9. **Never bind a lock guard you will still hold at an `.await`.** Clone the value out, or `drop()`
   the guard explicitly. A `tokio::sync::MutexGuard` is `Send`, so this **compiles**, and
   `clippy::await_holding_lock` does not see it (§Gaps 2).
10. **If the static is keyed, use `KeyedResourcePool` and pass non-zero prune arguments.**
    `KeyedResourcePool::new(0, 0)` disables pruning — which is what 2 of its 3 call sites pass.
11. **Ship the reset hatch in the same edit.** `cargo test` runs a crate's tests in parallel threads
    of **one** process; a `static` is shared by all of them. **12 of the 86 lock-bearing globals
    have any reset/clear function.** If yours cannot be reset, your tests are order-dependent and
    nobody will find out until one fails on CI only.
12. **Stop.** No `static mut`. No second global for the same concern. No `app.state::<T>()` inside a
    command.

## Anti-patterns

- **`static X: OnceLock<Result<T, E>>`.** The defining defect of this leaf. It looks like caching
  and it is actually *latching* — the first attempt's outcome, success or failure, becomes the
  answer for the life of the process. The repo has already shipped this bug once at the master-key
  layer, diagnosed it in writing, fixed it, and left the identical construct **786 lines below the
  post-mortem in the same file** (§Deviations A).
- **A mutex that protects the cache while the invariant lives elsewhere.**
  `management_api.rs:570` holds a `Mutex<Option<String>>`, releases it, revokes every existing
  `system` API key, mints a new one, then re-locks and defers to whoever won. The *cache* is
  race-free. The *key table* is not: two concurrent callers each revoke the other's key
  (§Deviations B). A doc comment claims the opposite.
- **Holding a lock guard across `.await`.** In async Rust the guard is not a fast critical section;
  it is a lease held for as long as the awaited work takes. `notifications.rs:1260` holds the
  process-global rate-limit map across a loop of Slack/Telegram/Email deliveries, so the thing that
  bounds outbound traffic is serialised *by* outbound traffic (§Deviations C). Nothing warns:
  `clippy::await_holding_lock` is armed in CI and does not cover `tokio` guards (§Gaps 2).
- **`.lock().unwrap()` on a `static`.** 52 sites. On a function-local mutex a poison is a local
  failure; on a process-global it is a permanent one, and the panic that caused it may have been in
  a completely unrelated command.
- **`std::env::set_var` for anything but a value you set once, at boot, before any thread exists.**
  `std::env` is the oldest process-global there is and it has no lock. **36 test call sites and 5
  production call sites** write it here; one production site runs inside `spawn_blocking` on a live
  runtime (§Deviations D), and its comment — *"edition 2021 → `set_var` is safe"* — confuses "not
  marked `unsafe`" with "not a data race".
- **N private mutexes guarding one global.** `PERSONAS_HOME` is written from **6 files**; three of
  them guard it, each with its own module-private `Mutex<()>` that the other two cannot see, and
  three guard it with nothing. Mutual exclusion over a shared resource requires *one* lock; three
  locks provide it for zero of them.
- **`thread_local!` for state an async command must read.** A future migrates between worker
  threads; a thread-local does not follow it. `ipc_auth.rs`'s validation flag is set and cleared
  around `inner(invoke)`, which for an async command returns when the future is *spawned*, so the
  async guard cannot read it and was reduced to a boot check (§Deviations H).
- **Setting a flag around a call instead of holding an RAII guard.**
  `set_ipc_validated(true); let r = inner(invoke); set_ipc_validated(false);` — `panic = "unwind"` is
  set explicitly in `[profile.release]` (`Cargo.toml:291`), so a panic inside a command skips the
  clear and leaks a `true` on that thread. The same file already contains the correct shape, ~590 lines above, in
  `IpcInFlightGuard` (`ipc_auth.rs:61-74`), and `attribution.rs:80-86` gets it right too.
- **`app.state::<T>()` where `T` is not exactly what `.manage()` was given.** Tauri resolves state
  by `TypeId`; `AppState` and `Arc<AppState>` are different types. rustc cannot see it, clippy
  cannot see it, CI cannot see it (§Deviations G).
- **Adding a 40th field to `AppState` because the extractor is already there.** 27 of the current
  39 fields together account for **5.7%** of all field reads, and 6 are never read through `state.`
  at all. The struct grows because the marginal cost of one more field is zero and the marginal cost
  of threading a parameter is not.

## Evidence

**Population — process-global `static` items, production only** (brace-matched `#[cfg(test)]`
removal; `tests/` dirs excluded; 945 files):

| Kind | Count | Notes |
|---|---:|---|
| `OnceLock` / `OnceCell` | **105** | 44 of them wrap a `Mutex`/`RwLock` |
| `LazyLock` / `Lazy` | **70** | 28 of them wrap a `Mutex`/`RwLock` |
| `AtomicBool/I64/U64/Usize/U8/U32` | **38** | |
| `BackgroundJobManager<T>` | **19** | one per async job family |
| bare `static Mutex<…>` | **12** | |
| bare `static RwLock<…>` | **2** | both in `engine/src/identity.rs` |
| other (`&[…]` tables, metrics structs, `Once`) | **8** | |
| **`static mut`** | **0** | |
| **Total** | **254** | |

*(A naive `static` grep returns 257. Three of those are `thread_local!` / `tokio::task_local!`
bodies — `ipc_auth.rs:84`, `db/src/attribution.rs:36,:41` — which are **not** process-global and are
excluded above. Counting them would have inflated the population and, worse, put the one correct
answer in the tree into the wrong bucket.)*

**The ratio that frames the whole leaf: `AppState` holds 39 slots; 86 more lock-bearing
process-globals live outside it, in 58 files.** `src/commands/companion/fleet_bridge.rs` alone
declares 8 of them (`:172, :182, :248, :295, :303, :804, :1547, :2098`), named `T`, `S`, `Q`, `Q`,
`P`, `SIGS`, `P`, `NOTIFIED` — process-lifetime registries named like loop variables. Nine of the 86
have a one- or two-letter name.

*(This corrects `docs/concepts/discovery/discovery-server-commands.json:683`, which reports
*"~25 fields"* and *"~40 module-local `OnceLock<Mutex<HashMap>>`/`LazyLock` statics"*. Measured:
**39** and **86**. The undercount has a mechanical cause worth knowing — see §Gaps 6.)*

**`AppState` shape** (`src/lib.rs:369-505`):

- **39 fields. 39 `pub`. 0 private.** 9 are `#[cfg]`-gated (5 `desktop`, 3 `ml`, 1 `p2p`).
- **Zero `impl AppState` blocks anywhere in the tree.** No constructor method, no accessor, no
  invariant. It is a bag of handles, and its only contract is its field list.
- Lock flavours are **mixed and unlabelled**: 9 fields are `tokio::sync::Mutex`, 1 is
  `tokio::sync::RwLock`, 2 are `tokio::sync::Semaphore`, and **3 are `std::sync::Mutex`**
  (`tier_config`, `tier_usage_cache`, `system_metrics` — `use std::sync::…Mutex` at `lib.rs:58`),
  reachable from async commands where they block a worker thread. Nothing on the struct says which
  is which except the presence or absence of a path prefix.
- Access is extremely skewed: **2,525 `state.<field>` reads**, of which `db` is **1,987 (78.7%)** and
  `user_db` **254 (10.1%)**. The remaining 27 read fields share **145 reads (5.7%)**, and 6 fields
  (`tier_usage_cache`, `system_metrics`, `network`, `clipboard_watcher_enabled`,
  `companion_tts_semaphore`, `companion_stt_semaphore`) are never read through `state.` at all.

**Command surface**, measured per `#[tauri::command]` function by brace-matched scan of
`src-tauri/src` with `#[cfg(test)]` items removed — **1,661 commands, exactly matching
[`shared-facts.json`](../shared-facts.json) `rust.tauriCommands`** (a raw attribute grep returns
1,666; the extra 5 are inside test modules):

| State extracted | Commands |
|---|---:|
| `State<'_, Arc<AppState>>` (five spellings, incl. `std::sync::Arc` and `crate::AppState` paths) | **1,554** |
| no `State<…>` parameter at all | 94 |
| `State<'_, RadioServiceHandle>` | 11 |
| `State<'_, PendingResponses>` | 1 |
| **`State<'_, crate::AppState>` — a type nobody manages** | **1** (§Deviations G) |

**261** of the 1,661 carry `#[requires(privileged|cloud|auth)]`; **1,400** do not.

**Reach-ins past the extractor.** 74 `app.state::<T>()` / `try_state::<T>()` call sites in
`src-tauri/src`. **73 are outside any `#[tauri::command]`** — background ticks, HTTP routes, PTY
hooks, night-shift passes, which have no extractor available — and exactly **1** is inside a
command, where the extractor was the supported path. **40 of the 74 use the panicking `state::<T>()`
form** rather than `try_state`; in a spawned task, that panic is silent.

**Sites to copy:**

- **`src-tauri/core/src/crypto.rs:497-556` — the one to copy for a fallible process-global.** The
  post-mortem comment plus the shape it prescribes: `static KEY_STORE: OnceLock<ProtectedKey>`,
  `if let Some(p) = KEY_STORE.get() { return … }`, derive, `let _ = KEY_STORE.set(protected)` with an
  explicit note that a racing thread's value is equally valid. Success is cached; failure is not.
- **`src-tauri/db/src/attribution.rs:1-90` — the one to copy for request-scoped ambient state.**
  `tokio::task_local!` for the async scope, `thread_local!` + an RAII `ThreadAttributionGuard` for
  the sync fallback, and a module doc that explains *why* task-local rather than thread-local. It is
  the only place in the tree that gets async-scoped ambient state right, and §Deviations H is what
  the other attempt cost.
- **`src-tauri/src/keyed_pool.rs:46-…` — the primitive that already exists.** RAII `PoolHandle`,
  active-count tracking, automatic pruning, 248 lines, 2 unit tests, and a doc that names the three
  hand-rolled maps it replaces. **3 adopters** (`lib.rs:122` `ActiveProcessRegistry`,
  `engine/composite.rs:86,:88`, `engine/runner/env.rs:120`) — exactly the three it names, and
  nothing since.
- **`src-tauri/src/ipc_auth.rs:61-74` — `IpcInFlightGuard`.** Fourteen lines of RAII done right, in
  the same file as the flag that is not (§Deviations H).
- **`src-tauri/src/engine/oauth_refresh_lock.rs:20` and `engine/runner/env.rs:120-121`** — per-key
  locks (`HashMap<String, Arc<AsyncMutex<()>>>`) instead of one global lock for a per-resource
  invariant. The right granularity, and `env.rs` is the only `KeyedResourcePool` caller that passes
  real prune arguments (`new(32, 8)`).

**Cleared, not defects** *(checked and found sound — do not raise these)*:

- **Lock ordering: 11 nested lock pairs, ZERO inversions.** Every place a guard is still held when
  a second lock is taken was extracted and the ordered pairs compared. The pairs are
  `state.refresh_lock > state.auth` (×4, `auth.rs:719,:836,:998`),
  `active_tasks > state` (×3, `smee_relay.rs:630`),
  `self.running > {self.cancel, self.app_handle, self.config, app_h}` (×4, `p2p/mod.rs:122`),
  `tracker > healing_personas`, `stdout > stdin`, `model > last_used`,
  `self.results > self.results_order`. **No pair appears in both orders.** *(Caveat, stated so the
  clearance is not over-trusted: the analysis is intra-procedural. It cannot see a lock taken inside
  a function called while a guard is held.)*
- **Boot ordering is not a hazard here, structurally.** `init_session_token` (`lib.rs:583`) and
  `app.manage(state_arc)` (`lib.rs:1181`) both run inside Tauri's `setup()`, before the webview
  exists to invoke anything, and **89 of the 108 initialisation sites use `get_or_init`**, which is
  order-free by construction. There is no window in which a command can arrive before its state is
  ready. **Both sibling repos reached the same arrangement independently** (§Convergence 1) — which
  makes `require_privileged`'s boot check a check for a condition ordering already guarantees
  (§Deviations H).
- **Unbounded growth in process-global maps — HYPOTHESIS TESTED AND WITHDRAWN.** 54 of the 86
  lock-bearing globals hold a `HashMap`/`HashSet`/`VecDeque`/`Vec`, and a first pass reported 35 of
  them with no eviction anywhere in their file. **That measurement is wrong and the claim is
  withdrawn.** Spot-checking `commands/fleet/stale.rs` — three of the alleged 35 — found
  `g.retain(…)` at `:438`, `base.remove(…)` at `:453,:473,:533,:542`, `silent.remove(…)` at
  `:508,:584,:606`, and `retain` again at `:641,:644`. The detector keyed on the *static's
  identifier*, and the dominant idiom (`fn growth_map() -> &'static Mutex<…> { TRANSCRIPT_GROWTH
  .get_or_init(…) }`) means that identifier appears exactly once per file — at its declaration. See
  §Gaps 6; the same blindness explains the discovery corpus's 2× undercount.
- **`static mut`: 0.** **Lock-poisoning discipline: 271 of 323 production lock acquisitions are
  poison-tolerant (84%)** — the majority convention is the correct one, and the minority is
  §Deviations E.

## Deviations found

### A — a process-lifetime cache that stores a *failure* (4 sites / 3 files)

| Path | Payload | Consequence of a first-call failure |
|---|---|---|
| **`core/src/crypto.rs:1290`** | `OnceLock<Result<Aes256Gcm, String>>` | **every** `encrypt_for_db` / `decrypt_from_db` fails for the process |
| `src/commands/infrastructure/auth.rs:155` | `OnceLock<Result<String, String>>` (Supabase URL) | Supabase auth is unavailable for the process |
| `src/commands/infrastructure/auth.rs:175` | `OnceLock<Result<String, String>>` (anon key) | as above |
| `db/src/lib.rs:1902` | `OnceLock<Result<PathBuf, String>>` (test-DB template) | every subsequent test in the binary fails to get a DB |

**`crypto.rs:1290` is the live one, and it is a controlled experiment inside a single file.** At
`:498-503` the same file records, in prose, that a `OnceLock<Result<..>>` for the master key once
*"bricked all credential encrypt/decrypt for the whole process, recoverable only by restart"*, and
`:504` shows the fix — `OnceLock<ProtectedKey>`, success-only, retried on every call. 786 lines
later, `get_cipher()` calls `get_master_key()` **and caches its `Result`**. The fix at the key layer
is defeated by the cache one layer above it: if the very first credential operation in the process
happens while the OS keychain is unavailable (locked session, service not yet up, or
`PERSONAS_ALLOW_FALLBACK_KEY` unset), `CIPHER` latches `Err` and the retry logic at `:506-511` is
never reached again. Same file, same concern, same author, two opposite answers — and the one with
the post-mortem attached is the one that got fixed.

`db/src/lib.rs:1902` is the mildest: a template build failure is close to deterministic, and the
`#[cfg(any(test, feature = "test-support"))]` gate keeps it out of the app. It is listed so the count
is auditable, not as a bug.

### B — a lock that protects the cache while the invariant lives in the database (1 site, high value)

`src/engine/management_api.rs:570` `get_or_create_system_api_key`:

```
let guard = cache.lock()…;  if let Some(t) = guard.as_ref() { return Ok(t.clone()); }
                            // ← guard dropped here, deliberately
for key in existing.iter().filter(|k| k.name == "system" && k.enabled) { api_key_repo::revoke(…); }
let resp = api_key_repo::create(pool, "system", […SCOPE_PROXY…])?;
let mut guard = cache.lock()…;  if let Some(e) = guard.as_ref() { return Ok(e.clone()); }
```

The double-checked cache is correct. **The side effects between the two critical sections are not.**
Interleave two callers: A checks (empty), revokes, creates `K_A`, caches `K_A`. B checks (still
empty, before A's second lock), revokes **including `K_A`**, creates `K_B`, then finds `K_A` in the
cache and returns it. The process now holds and publishes a **revoked** key, and a surplus enabled
`system` key with the broad `proxy` scope is left in the table. The doc comment at `:568-569` states
the opposite — *"Concurrent callers race the lock; only the first one through actually mints a fresh
key"* — which is true of the cache and false of the mint.

Reachable: three callers, one of which is the boot path
(`lib.rs:1719`, inside `spawn_blocking`), one a Tauri command
(`credentials/external_api_keys.rs:116`), one per-run (`engine/runner/mod.rs:1162`). Boot overlapping
with a command is exactly the window where the UI is coming up. **The invariant — "exactly one
enabled `system` key" — is a database invariant and no in-process mutex can hold it**; the fix is a
transaction or a unique partial index, not a wider critical section.

### C — lock guards held across `.await` (23 sites / 12 files; 17 are data guards)

Measured by scope resolution, distinguishing the three Rust temporary-lifetime shapes: a bound guard
(`let g = m.lock().await;` — lives to end of scope), a `match`/`if let` scrutinee (lives for the
whole arm body), and a method-call temporary (`let n = m.lock().await.len();` — dropped at the `;`,
**not** a violation). Of **333** async lock acquisitions, 184 bind a guard, 124 are temporaries, 20
are assignment targets, 4 are scrutinees.

**Six are deliberate serialisation** — `Mutex<()>` critical sections whose whole purpose is to be
held across the awaited work, and all six name themselves with a leading underscore
(`auth.rs:719,:836,:998` `_refresh_guard`/`_guard`, `build_simulate.rs:212` `_sim_lock`,
`doctrine.rs:292` `_ingest_guard`, `runner/credentials.rs:755` `_guard`). Not defects.

**Seventeen are data guards.** The worst:

| Path | Guard | Awaits held across | Span |
|---|---|---|---:|
| `engine/src/p2p/mod.rs:122` | `self.running.write()` | 15 | 197 L |
| `src/engine/smee_relay.rs:630` | `active_tasks.lock()` | 4 | 198 L |
| `src/notifications.rs:1260` | `TEST_DELIVERY_RATE_LIMIT.lock()` | 2 | 57 L |
| `src/commands/infrastructure/auth.rs:687, :772, :973` | `*state.cloud_client.lock().await` as an `if let` scrutinee | 1 each | 2–4 L |
| `db/src/embedder.rs:120` | `self.model.write()` | 1 | 56 L |
| `engine/src/desktop_runtime.rs:110` | `self.results.write()` | 1 | 18 L |

**`notifications.rs:1260` is the sharpest, and it is worth reading the code before believing any
summary of it.** `let mut rate_map = TEST_DELIVERY_RATE_LIMIT.lock().await;` is taken *before* the
per-channel loop and released only after it, and the loop body awaits
`test_deliver_external(…)` (`:1308`) — Slack, Telegram, Email, Discord, Teams, all real network
round-trips — and `test_deliver_built_in(…)` (`:1276`), a database write. So a second caller's
*rate-limit check* queues behind the first caller's outbound HTTP. The process-global that exists to
bound outbound traffic is itself serialised by outbound traffic.

**The `auth.rs` trio is a weaker finding than it looks, and the overclaim is corrected here.** The
guard is an **`AppState` field** (`state.cloud_client`) held across `client.set_user_token(…).await`
— but `set_user_token` is `*self.user_token.write().await = token` (`src/cloud/client.rs:399-401`)
and performs **no I/O**. The real shape is a *nested* lock acquisition (`cloud_client` mutex →
`user_token` rwlock) with a bounded hold, not a stall. It is listed because it is the only place a
shared `AppState` field is held across an await at all, and because the same three lines would become
a genuine stall the day anyone puts a network call behind that method.

The remaining data guards that hold across real work are `p2p/mod.rs:122` (`running.write()` across
QUIC listener bind and mDNS start) and `db/src/embedder.rs:120` (`model.write()` across a model
load) — both are start-up serialisation that is arguably intended, but neither says so.

**Nothing warns.** `clippy::await_holding_lock` is warn-by-default and CI runs `-D warnings`, but it
covers only `std::sync` and `parking_lot` guards; all 23 sites are `tokio::sync`, which clippy
deliberately excludes (§Gaps 2).

### D — one process-global env var, three private locks, three unguarded writers

**15 files write `std::env`; 6 hold a lock; 9 do not; the 6 use 6 *different* locks.**

`PERSONAS_HOME` decides where the companion brain lives on disk and is written from six files:

| File | Guard |
|---|---|
| `src/commands/core/data_portability.rs:11812` | `static BRAIN_HOME_LOCK: Mutex<()>` (module-private) |
| `src/companion/brain/cycle_report.rs:430` | `static HOME_LOCK: Mutex<()>` (module-private, different lock) |
| `src/companion/brain/sleep_cycle.rs:2140` | `static HOME_LOCK: Mutex<()>` (module-private, third lock) |
| `src/companion/stt/downloader.rs:260,:277` | **none** |
| `src/companion/stt/whisper.rs:236,:246` | **none** |
| `src/companion/tts/kokoro.rs:303,:316,:329` | **none** |

All six are in the `personas-desktop` crate, so all six run in **one** `cargo test` process, in
parallel threads. Three of the comments correctly identify the hazard — `data_portability.rs:11804`
says *"`PERSONAS_HOME` is process-global, and…"* — and then each module solves it privately. Three
independent mutexes over one resource provide mutual exclusion for none of them across module
boundaries. `SIDECAR_ENV` has the same shape one crate over: `engine/src/hooks_sidecar.rs:290` holds
`ENV_LOCK`; `engine/src/skills_sidecar/mod.rs` writes the same variable unguarded. There are three
distinct `ENV_LOCK` statics in three crates.

**Production side, confirming the inherited finding without duplicating its gate:**
`src/lib.rs:1726-1727` calls `std::env::set_var("PERSONAS_API_KEY", &key)` and
`set_var("PERSONAS_BRIDGE_URL", …)` inside `tauri::async_runtime::spawn_blocking` on a live runtime.
The comment says *"Set once at startup; edition 2021 → `set_var` is safe."* Edition 2021 means it is
not *marked* `unsafe`; it does not make it sound. `spawn_blocking` guarantees other threads are
running, and any of them calling `getenv` concurrently is a data race by definition. `set_var` became
`unsafe` in Rust 2024 for exactly this reason, so this comment is a countdown to a compile error.

### E — poisoning taken as fatal on process-global locks (52 of 323 acquisitions)

Production only, `#[cfg(test)]` stripped by range. **271** acquisitions use
`unwrap_or_else(|e| e.into_inner())`; **52** do not (24 `.lock().unwrap()`, 19 `.lock().expect(…)`,
9 `.read()/.write().unwrap|expect()`). **29 of the 52 name a SCREAMING-case `static` receiver
directly** — 10 distinct globals across 9 files: `FFMPEG_PATH_CACHE`
(`artist/ffmpeg.rs:111,:115,:419`), `PLAYWRIGHT_PROBE` (`auto_cred_browser.rs:1501,:1514`),
`DEV_SERVERS` (`dev_tools/competitions.rs:1051,:1161`), `AUTONOMOUS_GENS`
(`companion/session.rs:199,:209,:219`), `PREVIEW_CACHE` (`engine/bundle.rs:41,:57`), `SHARE_STORE`
(`engine/share_link.rs:118,:220`), `QUOTA_PROBE_CACHE` (`engine/subscription.rs:1503,:1527`),
`CACHE` (`engine/src/cli_capabilities.rs:55,:60`), `IDENTITY_CACHE` / `SIGNING_KEY_CACHE`
(`engine/src/identity.rs:109,:117,:129,:133,:159,:262,:296,:343,:344` — 9 sites, the worst
concentration), `TRUSTED_PEER_CACHE` (`engine/src/p2p/mdns.rs:89,:123`).

The two idioms sit side by side with no stated rule: `dev_tools.rs:274` writes
`ACTIVE_PROJECT_ID.lock().unwrap_or_else(|e| e.into_inner())` while `competitions.rs:1051` in the
same feature writes `DEV_SERVERS.lock().unwrap()`.

The consequence is specific to this leaf: on a process-global, a poison is permanent and
cross-command. One panic inside `ffmpeg_path()` makes every later media export panic, with a
stack trace pointing at the *victim*.

### F — `AppState` is 39 public fields with no behaviour (1 struct, 1,554 dependents)

`src/lib.rs:369`. **39 fields, all `pub`, zero private, zero `impl` blocks.** Every command that
takes `State<'_, Arc<AppState>>` — 1,554 of 1,661 — can read and mutate all 39, whether it needs one
or all of them. There is no method through which a field could acquire a precondition, no accessor
that could log or rate-limit, and no place to put an invariant that spans two fields.

The access distribution shows how little of it is load-bearing: `db` is **78.7%** of all reads,
`user_db` 10.1%, and the other 37 fields together are 11.2%. Six fields are never read through
`state.` at all. The struct is not a shared-state design; it is an accumulation.

*(This is the general form of what [`repository-crud-surface`](./repository-crud-surface.md) §Gaps 4
observes for `db` alone. **Report honestly: making the fields private would not, on this evidence,
have prevented the leak** — both sibling repos keep their DB handle out of module scope and both
still reach it from every call site through one named accessor, §Convergence 2. What holds is not
visibility; it is a type the wrong caller cannot construct.)*

### G — one command asks Tauri for a state type nobody manages (1 site, runtime-fatal)

`src/notifications.rs:1250-1252`:

```rust
#[tauri::command]
pub async fn test_channel_delivery(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::AppState>,   // ← not Arc<AppState>
```

`lib.rs:1181` manages `Arc<AppState>` and nothing manages a bare `AppState`. Tauri resolves `State<T>`
by `TypeId`, so this command's argument extraction fails at **runtime** with *"state not managed for
field `state` on command `test_channel_delivery`"*. It is registered (`lib.rs:3505`), it has a wired
API function (`src/api/agents/channelDelivery.ts:20`), and it type-checks, lints and compiles
cleanly. The helper at `:1320` repeats the mistake.

**The repo already knows this trap and wrote it down — at a different site.**
`src/commands/companion/fleet_bridge.rs:1274` carries the comment *"The app manages `Arc<AppState>`,
not `AppState` — `app.state::<AppState>()` would panic ('state not managed')"* and correctly uses
`try_state::<Arc<AppState>>`. Knowledge in a comment does not travel.

**Honest severity.** `testChannelDelivery` currently has **no UI caller** —
`MessagingPickerShared.tsx:12` lists wiring the Test button as an open step. So this is latent, not
a user-visible outage today; it fires the first time anyone connects the button. Its value here is
diagnostic: it is the only defect in this sweep that no gate in the repository — rustc, clippy,
`npm run check`, CI — can see, and §Prefer a type over a gate explains exactly why the 261 commands
carrying `#[requires(…)]` are immune to it and the 1,400 without it are not.

### H — a security decision held in a `thread_local!` that async cannot read (1 site + 1 leak)

`src/ipc_auth.rs:84` — `thread_local! { static IPC_VALIDATED: Cell<bool> }`, set by the invoke
wrapper and read by `require_privileged_sync` (`:457`). Two consequences, both measured:

1. **The async gate degenerated to a boot check.** `wrap_invoke_handler` (`:657-659`) does
   `set_ipc_validated(true); let result = inner(invoke); set_ipc_validated(false);`. For an async
   command `inner()` returns when the future is *spawned*; the future later polls on a worker thread
   where the flag was never set. `require_privileged` (`:547`) therefore cannot read it, and what it
   checks instead is `IPC_SESSION_TOKEN.get().is_none()` — **whether boot finished**. Its two
   possible answers are "boot is done" and "boot is not done"; there is no path on which it denies an
   authorized-but-not-permitted caller. *"Not ready yet"* and *"not allowed"* are the same
   answer because they are the same check. **The upstream cause is the storage class, not laziness**
   — and `db/src/attribution.rs` shows the correct one (`tokio::task_local!`) solving the identical
   "ambient context readable from arbitrary sync code under async" problem in the same repository.
2. **The flag leaks on panic.** `panic = "unwind"` is set explicitly in `[profile.release]`
   (`Cargo.toml:289-291`, for ORT DLL reasons). A panic inside a privileged sync command unwinds past
   `set_ipc_validated(false)`, leaving `true` on that thread for whatever runs next. `IpcInFlightGuard`
   in the same file (`:61-74`) and `ThreadAttributionGuard` in `attribution.rs:80-86` are both
   correct RAII; the one flag carrying a security decision is the one written as a bare pair of
   calls. *(Defense-in-depth only — the token comparison at `:626-644` runs first and still gates —
   so this degrades a second line, it does not open the first.)*

### I — `KeyedResourcePool` exists and has 3 adopters against 54 hand-rolled equivalents

`src/keyed_pool.rs` (248 lines, 2 unit tests) is a keyed map with RAII handles, active-count
tracking and automatic pruning. Its own doc lists the three implementations it replaces, and those
three are its only callers: `ActiveProcessRegistry` (`lib.rs:122`), `CompositeState`
(`engine/composite.rs:86,:88`), `CREDENTIAL_REFRESH_LOCKS` (`engine/runner/env.rs:120`). Meanwhile
**54** lock-bearing process-globals hold a keyed collection.

**And the primitive is not correct by default.** `KeyedResourcePool::new(prune_interval,
prune_threshold)` treats `0` as "disable pruning" (`keyed_pool.rs:62-63`), and **2 of its 3 callers
pass `new(0, 0)`**. The single feature that distinguishes it from a hand-rolled `Mutex<HashMap>` is
off in two thirds of its adoption — a textbook instance of the
[golden-path contract's fifth failure mode](../golden-path-contract.md): routing callers to a
primitive is only worth as much as the primitive's defaults.

### J — 13 of 19 write-once initialisations discard the "already set" result

`.set()` returns `Err(value)` when the cell is already occupied. **13 of the 19 call sites write
`let _ = X.set(v)` or `X.set(v).ok()`** — `logging.rs:103,:130,:134,:135,:242`,
`startup_timing.rs:41,:102,:118`, `crypto.rs:513,:539,:551`, `db/src/lib.rs:287`,
`engine/mod.rs:212`, `project_tracking/push.rs:66`. Three propagate (`fleet/companion_api.rs:95`,
`local_http/mod.rs:81`, `engine/mod.rs:2059`) and `ipc_auth.rs:48` panics deliberately.

For most this is correct and even required (`crypto.rs:551` documents that a racing thread's value is
equivalent). The one worth flagging is **`db/src/lib.rs:287`**: `PRIMARY_DB_PATH.set(db_path)` inside
`init_db_with_journal`. Whoever opens a pool *first* defines "the primary database" for the process,
and `primary_db_path()` (`:150`) is what points MCP sidecars and test-automation children at the
file. In a test binary that opens a temp database first, every later reader of `primary_db_path()`
gets the temp path, silently.

## Gaps in the primitive

1. **There is no way to say "this is a process-global and here is why".** 254 statics, no
   registry, no naming convention (`T`, `S`, `Q`, `P`, `M`, `SIGS`, `NOTIFIED`, `MAP`, `CACHE`,
   `LOCK` all appear as top-level names), no attribute, no module that owns them. A reader cannot
   distinguish a deliberate one-per-process resource from a parameter someone did not want to
   thread. `AppState` at least enumerates its 39; the other 86 lock-bearing globals are enumerable
   only by a filesystem walk.
2. **`clippy::await_holding_lock` cannot see the 23 real sites.** It is warn-by-default and CI runs
   `cargo clippy -- -D warnings`, so the gate *is* armed — and it lints only `std::sync` and
   `parking_lot` guards, deliberately, because holding a `tokio` guard across `.await` is legal.
   Every one of this repo's 23 sites is a `tokio` guard. **A `std::sync` guard could not reach an
   await here anyway**: Tauri's async commands require a `Send` future and `MutexGuard` is not
   `Send`, so rustc rejects it. The result is that the only guard type that *can* commit this
   defect is precisely the one no lint covers. This is a real toolchain gap, not laziness.
3. **`#[requires(…)]` is welded to `AppState`, so narrowing your state removes your ability to
   auth-gate.** The macro expands to `require_privileged(&state, …)` / `require_cloud_auth(&state,
   …)`, both taking `&Arc<AppState>`. Applying it to a command whose `state` is
   `State<'_, RadioServiceHandle>` is a compile error. Measured: **all 12 commands using a narrower
   managed handle carry no `#[requires]` at all** (11 in `commands/radio.rs`, 1 in
   `test_automation.rs`). The repo's one type-level guard therefore *penalises* the correct move,
   which is a structural reason `AppState` keeps growing.
4. **`KeyedResourcePool::new(0, 0)` is expressible.** Unbounded growth is what you get by passing
   zeros, and 2 of 3 callers did. A constructor that cannot express "never prune" without saying so
   by name would have retired that whole class.
5. **There is no test-isolation story for process-global state at all.** `serial_test` is not a
   dependency; `#[serial]` appears **0 times** across **4,227 `#[test]` + 134 `#[tokio::test]`** in
   478 `#[cfg(test)]` blocks over 421 files. The repo's answer is six independently hand-rolled
   `Mutex<()>` statics (§Deviations D), and **12 of the 86 lock-bearing globals have any reset or
   clear function**. [`rust-test-fixtures`](./rust-test-fixtures.md)'s shared `init_test_db()` gives
   each test its own *database*; nothing gives it its own *statics*.
6. **The accessor idiom makes process-globals invisible to name-based analysis — including the
   analysis in this document.** The dominant shape is `static X: OnceLock<Mutex<T>> =
   OnceLock::new(); fn x() -> &'static Mutex<T> { X.get_or_init(…) }`, so the static's identifier
   occurs exactly **once** per file and every mutation goes through a locally-bound guard. **41 of
   the 86 are reached this way.** A first pass here concluded 35 process-global maps had no eviction
   path; spot-checking one file found ten. The claim was withdrawn (§Evidence, cleared) and the same
   blindness is the most likely cause of `discovery-server-commands.json:683` reporting ~40 statics
   where there are 86. **If you measure process-global state, resolve the accessor first.**
7. **Nothing asserts the state map's contents match the state extractors' types.** §Deviations G is
   invisible to every gate in the repository because Tauri's `State<T>` is generic over any `Send +
   Sync + 'static` type and resolution happens at runtime. The information needed to check it —
   which types are `.manage()`d, which types are extracted — is fully present at compile time and
   nothing looks at it.

## Prefer a type over a gate — answered

**Yes for two of the three problems, and the split is worth stating precisely, because the third is
where a sibling repo contradicted the obvious answer.**

**(1) The extractor type: a type can make it unrepresentable, and the repo has already proved the
mechanism by accident.** Be precise about which move actually works, because the obvious one does
not: `pub type AppStateRef<'a> = tauri::State<'a, Arc<AppState>>` is only an **alias**, so
`State<'_, crate::AppState>` stays perfectly writable and you are back to policing a convention. The
type answer is a **newtype that implements `tauri::command::CommandArg` itself** and resolves
`Arc<AppState>` internally — then the only way a command can name shared state is a type whose sole
constructor already looked it up correctly, and §Deviations G stops being expressible. The evidence
that this shape holds is already in the tree, by accident: `#[requires(…)]` expands to a call taking
`&Arc<AppState>`, so **0 of the 261 commands carrying it can express the wrong state type, and the 1
defect sits in the 1,400 that do not.** *(Sample size 1 — reported as a mechanism, not a rate.)*
Fixing §Gaps 3 in the same edit is what makes it adoptable: while `#[requires]` is welded to
`AppState`, the correct move (a narrower state handle) still costs you the ability to auth-gate.

**(2) The failure-caching: a type can make it unrepresentable, and the correct shape is already
hand-rolled.** `crypto.rs:497-556` is `once_success` in longhand. Extract it:
`OnceSuccess<T>::get_or_try_init(|| -> Result<T, E>)` that stores `T` on `Ok` and stores **nothing**
on `Err`, so a later call retries. With that primitive available, `OnceLock<Result<_, _>>` has no
reason to be typed and the four §Deviations A sites collapse to one-line migrations. Heeding the
contract's warning about gates pointing at broken destinations: the primitive must be
retry-by-default, not `OnceSuccess::new(retry: bool)` — the `KeyedResourcePool::new(0, 0)` result
(§Deviations I) is what a forgettable argument costs, measured in the same repository, at 2 of 3
call sites.

**(3) Whether a thing should be process-global at all: no type can decide this, and — the honest
part — neither can visibility.** The obvious prescription for §Deviations F is "make the fields
private and add accessors". **Both convergence oracles refute it.** `brainiac` keeps `Store.pool`
private behind a `pool()` accessor and has **47 call sites** reaching it against a doc that says the
accessor is for the job queue; `personas-cloud` never exposes a module-level `db` binding at all —
`initDb()` returns a value threaded through 12 positional parameters — and `rc.database!` still
reaches all 54 routes. **Encapsulation slowed neither.** What actually held in both siblings was what
the *database* refuses to violate: Postgres RLS and `scoped_tx` in brainiac, `BEGIN IMMEDIATE` and
`INSERT OR IGNORE` in personas-cloud. That is the same conclusion §Deviations B reaches from the
opposite direction here — the mutex protected the cache, and the invariant that broke was in the key
table.

So the order is: **(a)** ship `AppStateRef` and `OnceSuccess`, which retire Deviations G and A
permanently; **(b)** fix `KeyedResourcePool`'s default and migrate the largest hand-rolled maps;
**(c)** move §Deviations B's invariant into a database constraint, where it can be held; **(d)** keep
the census rule below as the ratchet that stops new failure-caches appearing while (a) lands. The
gate is the least of the four.

## The missing gate

**The condition being proxied** (stack-free, so an adopting repo can re-derive its own signal):
*a process-lifetime cache whose stored value can be a failure.* Whatever transient condition made
the first attempt fail — a locked keychain, an env var not yet exported, a directory not yet created,
a service not yet up — becomes permanent, and the only recovery is a process restart. In Rust it
wears `static X: OnceLock<Result<T, E>>`. In Python it is an `@lru_cache`/`@cache` on a function that
returns an error object instead of raising. In TypeScript it is a module-scope
`let promise ??= fetchThing()` that is never cleared on rejection — the memoised **rejected** promise
is returned forever. In Go it is a `sync.Once` whose closure assigns to a package-level `err`.
**Re-derive the signal for your idiom; do not port the regex.**

**Not already covered.** All 75 rules in `scripts/census/rules.json` were checked. Two mention
`OnceLock` incidentally (`hand-rolled-fixture-ddl` matches `CREATE TABLE` strings;
`config-value-frozen-at-compile-time` matches `option_env!`) and neither touches process-global
state, initialisation, locking or caching. The nearest neighbours are
`persistence-handle-in-command-tree` (a *handle in the wrong module* — that is
[`command-naming-placement`](./command-naming-placement.md)'s and is deliberately not duplicated)
and `unraced-loop-wait` (loop shape). Nothing in the registry gates a `static`, a lock, `std::env`
mutation, or a cache's failure mode.

**Signal.** A `static` whose type is a write-once cell (`OnceLock`, `OnceCell`, `LazyLock`, `Lazy`)
parameterised over a `Result`. The write-once cell is what makes it permanent; the `Result` is what
makes the stored value possibly a failure. Both halves are required — that is what §Positive
controls prove.

```json
{
  "rules": [
    {
      "id": "process-global-caches-a-failure",
      "goldenPath": "docs/concepts/golden-paths/process-global-command-state.md",
      "title": "Process-lifetime cache whose stored value can be a failure",
      "roots": ["src-tauri/src", "src-tauri/core/src", "src-tauri/db/src", "src-tauri/engine/src"],
      "extensions": [".rs"],
      "signal": {
        "pattern": "\\bstatic\\s+[A-Z][A-Z_0-9]*\\s*:\\s*(?:std::sync::|once_cell::sync::|core::cell::)?(?:OnceLock|OnceCell|LazyLock|Lazy)\\s*<\\s*Result\\s*<",
        "flags": "g",
        "ignoreCommentLines": true,
        "description": "A write-once process-global whose payload is a Result, so the FIRST attempt's outcome is frozen for the life of the process — including a failure. PROXY FOR the stack-free condition: a process-lifetime cache that stores a failure. Whatever transient condition made the first call fail (a locked keychain, an env var not yet exported, a directory not yet created) is then permanent, and the only recovery is a restart. This repo has already shipped that bug and fixed it once: core/src/crypto.rs:497-503 records that a previous `OnceLock<Result<..>>` for the master key 'bricked all credential encrypt/decrypt for the whole process, recoverable only by restart', and the fix was to store ONLY the success (`OnceLock<ProtectedKey>` at :504, re-derived on every call until one succeeds). Fix: cache the success, not the outcome — `OnceLock<T>` with a `get()`-then-retry, or `Mutex<Option<T>>` if the value can legitimately change."
      },
      "baseline": { "files": 3, "matches": 4 },
      "floor": 900
    },
    {
      "id": "process-global-caches-a-failure-positive-control",
      "goldenPath": "docs/concepts/golden-paths/process-global-command-state.md",
      "title": "POSITIVE CONTROL — the compliant form of the same construct",
      "roots": ["src-tauri/src", "src-tauri/core/src", "src-tauri/db/src", "src-tauri/engine/src"],
      "extensions": [".rs"],
      "signal": {
        "pattern": "\\bstatic\\s+[A-Z][A-Z_0-9]*\\s*:\\s*(?:std::sync::|once_cell::sync::|core::cell::)?(?:OnceLock|OnceCell|LazyLock|Lazy)\\s*<\\s*(?!Result\\s*<)",
        "flags": "g",
        "ignoreCommentLines": true,
        "description": "POSITIVE CONTROL for `process-global-caches-a-failure`. Same anchors (`static NAME: OnceLock<...>`), pointed at the COMPLIANT payload — anything that is not a Result. It exists to be run, never to ratchet, and therefore carries no baseline. Its job is to prove the rule discriminates on FAILURE-STORING rather than on the token `OnceLock`: applying the prescribed fix to a violation must move exactly one match OUT of the rule and INTO this control. If the two ever move in the same direction, the rule is keying on the wrong thing."
      },
      "floor": 900
    }
  ]
}
```

**Mechanism.** The shared census runner (`npm run census` / `census:check`). No new script.

**Allowlist — empty, deliberately.** All four matches are genuine instances of the stated condition.
`db/src/lib.rs:1902` is the mildest (test-support only, near-deterministic initialiser) and could be
argued for exemption; it is not exempted, because the runner fails a rule whose `exclude` matches
nothing, and because "this particular failure is unlikely" is the reasoning that produced
`crypto.rs:1290`. The count is the count; §Deviations A does the triage.

**Validation performed.** The pattern was held **in a file** and passed to the engine through
`JSON.parse`, never through bash argv. Fault injection ran against an **isolated copy** of
`src-tauri/{src,core/src,db/src,engine/src}` in a scratch directory (950 `.rs` files); the repo
working tree was never modified.

| Case | rule | control | Exit |
|---|---|---|---|
| Baseline scan of the repo, 950 files walked | **3 files / 4 matches** | 100 files / 172 matches | — |
| Control: untouched isolated copy vs baseline | reproduces exactly | reproduces exactly | **0** |
| Fault A: one new `OnceLock<Result<..>>` added | `drift/rose` 4 → **5** | unchanged 172 | **1** |
| **Positive control 1:** `CIPHER` → `OnceLock<Aes256Gcm>` (the prescribed fix) | `drift/dropped` 4 → **3** | **172 → 173** | **1** |
| **Positive control 2:** the cache deleted entirely (also compliant) | `drift/dropped` 4 → **3** | unchanged **172** | **1** |
| Comment prose containing the exact violating line | unchanged 4 | unchanged 172 | **0** |
| Control re-run after every fixture restored | reproduces exactly | reproduces exactly | **0** |
| Fault B: roots narrowed → 0 files walked | `structural/floor` — *"THE MATCHER IS BROKEN, NOT THE CODEBASE CLEAN"* | — | **1** |
| Fault C: signal matches zero files anywhere | `structural/zero-matches` | — | **1** |

**The two positive-control rows are the load-bearing ones, and they discriminate in *opposite*
directions on purpose.** Control 1 applies the prescribed fix: a match moves **out of the rule and
into the control** (4→3, 172→**173**). Control 2 removes the cache altogether: the match leaves the
rule and **does not** appear in the control (4→3, 172→172). A matcher keyed on the token `OnceLock`
rather than on the `Result` payload would show 173 in *both* rows and would be indistinguishable from
this one on any single test. Both compliant rewrites fail until the baseline is ratcheted, which is
what proves the ratchet is monotone in the right direction.

**Populations and overlap.** The census signal finds **4 matches / 3 files**. A second, independent
implementation — the brace-matched statement walker that produced this document's static census,
written first and without reference to the regex, which strips `#[cfg(test)]` by range and classifies
each declaration's type separately — finds **4 / 3**. A third (`grep -rnE` over the same roots) finds
**4 / 3**. **Overlap 4. Precision 1.00, recall 1.00, zero disagreement across three implementations.**

**How it fails loudly when its own precondition is absent.** Inherited from the census runner and
verified above **by injection, not assumed**: `floor: 900` against 950 walked files makes a moved
root or a changed extension list a **structural** failure rather than a clean report (Fault B); a
signal matching nothing anywhere is structural with an explicit *"delete the rule rather than
baseline it at zero"* message (Fault C); and a **drop** without a baseline update fails as loudly as
a rise (both positive controls). Surviving counts print on success.

**What this gate does NOT catch, stated so the next reader does not over-trust it.** It is blind to a
failure cached in a `Mutex<Option<Result<..>>>`, to one cached in a struct field rather than a
`static`, to §Deviations B (an invariant outside the lock), to §Deviations C, D, E, G and H
entirely, and to the *judgment* question of whether the state should be process-global at all. It
reports 4 where the sweep found roughly 40 real defects. **If `OnceSuccess<T>` lands and the four
sites migrate, this rule should be DELETED, not baselined at zero** — a rule pinned at 0 is a gate
that can never fail.

**Refusing to gate — the lock-across-await condition, with the measurement that justifies the
refusal.** §Deviations C is the highest-volume finding in this document (23 sites) and I attempted a
census rule for it. **It should not ship, and here is the number.** Against the 23 sites found by
scope resolution, four regex variants were run through the real engine:

| Variant | Gap between guard and `.await` | files / matches | Recall vs 23 | Precision |
|---|---|---:|---:|---|
| v1 | `[^{}]*?` (no nested block) | 3 / 3 | 13% | 1.00 |
| v2 | one nesting level allowed | 4 / 9 | 39% | 1.00 |
| v3 | two nesting levels allowed | 6 / 12 | 48% | **0.83** — false-positives `p2p/mod.rs:136`, which has `drop(config)` two lines later |
| v4 | `if let` / `match` scrutinee form | 1 / 3 | 13% | 1.00 |

Recall tops out below half, and the first variant that reaches it starts firing on **correctly
released guards**, because a regex cannot see `drop(guard)` without a backreference tempered across
an unbounded span. Per the contract, *a gate that fires on correct content is worse than no gate*, so
the honest answer is to ship none and record why. The right mechanism is an **AST rule**, and it
almost exists: `clippy::await_holding_lock` is already armed in CI and covers exactly this condition
for `std::sync` and `parking_lot` guards — it simply excludes `tokio::sync` by design (§Gaps 2).
A repo-local clippy lint, or a focused test over the twelve affected files, is the correct home.
Recording the population (23 / 12 files / 17 data guards) so it is auditable *is* the deliverable.

**One condition here is must-never-happen and the census engine cannot express it.** A rule that
reaches zero fails `structural/zero-matches` by design, so "this must always be 0" has no
representation. §Deviations G — *a command extracting a state type nobody manages* — is exactly that
shape, and it needs a **test**: a ~30-line Rust test that collects every `.manage(…)` type from
`lib.rs` and every `State<'_, T>` in the command tree and asserts the second set is a subset of the
first. It would have caught `notifications.rs:1250` the day it was written, and it is the only check
in this document that would have. `brainiac/console/src/design/focus-contract.test.ts` is the working
precedent for the shape.

## Convergence — the portability oracle

Two siblings were read in full: `brainiac` (Rust workspace + Next.js console) and `personas-cloud`
(TypeScript npm workspaces + an untracked Python FastAPI facade). **The result splits, and the half
that contradicts the obvious prescription is reported first.**

**1. Boot ordering is a structural property, not a guard — three codebases, independently.** Both
siblings bind their listener **last**: `brainiac/src/main.rs:509` after `http::router(…).await?`;
`personas-cloud/packages/orchestrator/src/index.ts:117` after all twelve dependencies are
constructed. Neither wrote a readiness check, because ordering makes the question unanswerable.
Personas arrived at the same arrangement (`app.manage` and `init_session_token` both inside
`setup()`, plus 89 `get_or_init` sites). **That is convergence, and it indicts §Deviations H
directly**: `require_privileged`'s only check is *"has boot finished?"* — a condition the structure
already guarantees — which is why it has no path on which it denies anything.

**2. Encapsulating the DB handle does not hold the line — and this REFUTES the obvious fix for
§Deviations F.** brainiac keeps `Store.pool` **private** behind a `pool()` accessor and has **47**
call sites reaching through it, against a written rule that the accessor is for the job queue only.
personas-cloud never creates a module-level `db` binding at all — `initDb()` returns a value threaded
by hand through a 12-parameter `createHttpApi(…)` — and `rc.database!` still reaches all 54 routes.
**Two independent repos, two different languages, two different encapsulation strategies, same
outcome.** Personas' 39-public-field `AppState` is worse *ergonomically*, but the evidence says
private fields would not have prevented the leak. **What held in both siblings is what the database
refuses to violate**: Postgres RLS + `scoped_tx` in brainiac; `BEGIN IMMEDIATE` claiming and
`INSERT OR IGNORE` in personas-cloud, the latter commented *"acquires a write lock before reading, so
concurrent callers block"*. That is the same lesson §Deviations B teaches from the other side.

**3. The most concurrent component holds the least shared memory — in all three.**
`brainiac-pipeline` is 14 files of async worker chain with **0 statics and 0 locks**, coordinating
entirely through `FOR UPDATE SKIP LOCKED`. `personas-cloud`'s worker has **0 module-scope mutable
bindings** while its orchestrator has 3 (and every shared-state defect in that repo is in the
orchestrator). Personas' own `engine/` crate is the mirror image, and that asymmetry is a finding
about *this* repo, not the siblings.

**4. The mutable-global count is where Personas is the outlier, by more than an order of
magnitude.** brainiac: **1** mutable static (a test harness). personas-cloud: **5** mutable
module-scope bindings, **0 of them exported** — all module-private, reachable only through
functions. Personas: **86** lock-bearing process-globals, **all reachable by name from anywhere in
the crate**. Two siblings independently converged on "almost none, and none exported"; this repo did
not. **That is the strongest single result in this section**, and it is what makes §The one way's
"default to no process-global state" doctrine rather than local taste.

**5. Set-once global config has a measured, quotable test cost — and a sibling paid it in a form
this repo has not yet noticed.** `brainiac/tests/activation_funnel_pg.rs:85-88` records that
`src/analytics.rs` resolves its configuration once into a `OnceLock`, and adds: *"**That is also why
this is the only test in this binary.**"* One `OnceLock` of config cost an entire test binary's
worth of parallelism. Personas' equivalent is §Gaps 5 and §Deviations D — 4,361 tests, **0
`#[serial]`**, and six hand-rolled `Mutex<()>` statics of which three guard one variable. **Same
mechanism, opposite discovery: brainiac's test suite found the cost and paid it explicitly;
Personas' has not surfaced it yet, and three unguarded `PERSONAS_HOME` writers are where it will.**

**6. The unbounded-cache decision converges too, and both repos have exactly one that skipped it.**
`personas-cloud/packages/orchestrator/src/db.ts:887` `subscriptionCache` has a 60 s TTL and **no
size cap**, while **three sibling caches in the same repo independently implement a 500-entry FIFO**.
brainiac avoided the class by putting its LLM cache in a table (`extract.rs:531-598`). The pattern —
an unwritten convention applied correctly N times and silently skipped once — is exactly
`KeyedResourcePool::new(0, 0)` at 2 of 3 call sites (§Deviations I).

**7. The divergence is the sharpest lesson, and it is about documentation.** brainiac has **four
written rules** about its one DB escape hatch and **none matches the code**; `git log -S` shows the
strictest (`.claude/memory/rls-role-split.md`, 2026-07-30) was written **15 days after** the code
already violated it twice. It was authored from a module header, not from call sites.
personas-cloud has **no** written rule and an unwritten one (the 500-entry cap) applied correctly
three times and skipped once. **Prose written from headers drifts; a convention visible at the call
site mostly holds — until the one time nobody looks. Neither is enforcement.** Personas has the
same disease in miniature: `fleet_bridge.rs:1274` documents the `Arc<AppState>` trap in a comment
and `notifications.rs:1250` commits it anyway. In all three repos, **the only invariants that never
drifted are the ones a machine checks** — brainiac's `clippy::unwrap_used` + `-D warnings` and
Postgres RLS; personas-cloud's, by its own admission, none, and it has one hand-rolled test file and
zero test runners.

**Where convergence found nothing, marked honestly as house convention rather than doctrine:** the
`#[requires(…)]`-as-accidental-type-check mechanism (§Prefer a type over a gate #1) has no analogue
in either sibling — neither has an auth attribute macro at all. It is a genuinely local, and
genuinely lucky, property of this repo. Treat the prescription that follows from it as a proposal to
test, not as physics.

## Severity note

The census rule is a **ratchet, not a lint rule**, and this path does not argue for `"error"`
anywhere. Per `.claude/CLAUDE.md`, `npm run check` runs `eslint src/` with no `--max-warnings` and
the pre-commit hook runs `--quiet`, so a warn-level rule enforces nothing at either gate at any
warning count — an argument about how the gates are built, not about volume. The 1,135-warning
baseline ([`shared-facts.json`](../shared-facts.json) `lint.warnings`) is evidence for neither side,
and in any case does not reach `src-tauri/` at all. `npm run census:check` is a separate exit-1 gate
and is where this belongs. The one must-never-happen condition (§Deviations G) belongs in the Rust
test suite, which `cargo test` already fails on.
