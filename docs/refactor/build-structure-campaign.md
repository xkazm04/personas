# The app_lib split — a measured campaign

> **Why this document exists.** `docs/concepts/golden-paths/crate-layering.md:176-185`
> records that the 2026-07 crate split "has no completion criterion" and that "no
> artifact records the peak rustc RSS after the split". A refactor with no
> finish line and no instrument is how the repo ended up with three documents
> claiming three different sizes for `app_lib` (265k / 331k / 443k lines). This
> campaign has both: every wave moves a **named number** in
> [`build-ledger.jsonl`](../development/build-ledger.jsonl), and a wave that does
> not move its number is reverted.

## The measurement that sets the target

Taken 2026-09-18 on the reference machine (aarch64-pc-windows-msvc, 12c/63 GB,
rustc 1.96.1, `--features desktop`), after the IPC-shard change:

| scenario | now | what it is |
|---|---|---|
| `rust-check-warm` | **0.7 s** | fingerprint walk, nothing changed |
| `rust-check-touch-leaf` | **23.5 s** | touch ONE `commands/` file |
| `rust-check-touch-lib` | **23.5 s** | touch `lib.rs` |
| `rust-check-cold-applib` | **128 s**, peak rustc 5.3 GB | `cargo clean -p personas-desktop` + check |
| `rust-build-lib-warm` | **37 s**, peak rustc 5.2 GB | touch + dev build of the lib |

**The finding that defines the campaign: a leaf edit and a trunk edit cost the
same.** Touching one 3k-line command file costs exactly what touching the
1,600-command registration file costs, because both invalidate the same
compilation unit. `app_lib` is 755 files / ~443k raw lines — 64% of the
workspace's Rust — and rustc re-expands the whole crate on every run. The 23.5 s
floor is a property of the unit, not of the change.

Nothing tunable moves that floor. Measured and rejected during the spark:
nightly `-Zthreads=8` (0 to −2.4% incremental, +87% cold), `CARGO_INCREMENTAL=0`
(+15% memory, `build-memory.md:44-50`), a shared worktree build-dir (unsafe,
see [build-measurement.md](../development/build-measurement.md)). The IPC-shard
change halved the *cold* check (349 s → 128 s) and moved the incremental floor
by nothing. Only splitting the unit moves it.

## Targets, and how the ratchet works

| ratchet | today | wave target | campaign target |
|---|---|---|---|
| `rust-check-touch-leaf` | 23.5 s | −10% per wave | **< 8 s** |
| `rust-check-cold-applib` peak rustc RSS | 5.3 GB | no regression | **< 3.5 GB** |
| `app_lib` share of workspace Rust | 64% | falling | **< 30%** |

**The rule: a wave records `rust-check-touch-leaf` and the cold peak RSS before
it starts and after it lands. A wave that does not move its number is reverted,
not kept "because the structure is nicer".** Boundaries have a maintenance cost;
an unmeasured one is a cost with no receipt. Both rows go in the wave's commit
message.

**Completion criterion** (the thing `crate-layering.md` says is missing): the
campaign is finished when `rust-check-touch-leaf` is under 8 s and the cold peak
RSS is under 3.5 GB, or when a wave's measured gain falls below 5% — whichever
comes first. The second clause matters: the goal is a cheap iteration loop, not
a maximal number of crates.

## The graph, measured

`scripts/build/crate-split-deps.mjs` parses `crate::` paths into module units
and answers "what must travel together for this cut to be acyclic". It is a
textual approximation — a clean closure means *worth attempting*, and
`cargo check --all-targets` is the real gate.

Two facts make the campaign tractable, both measured 2026-09-18:

- **`engine -> commands` is 0 references, and `commands::core -> lib` is 0.**
  The dependency direction the layering wants already mostly holds.
- **A naive closure collapses to the whole crate.** Seeding
  `ipc_auth,background_job,notifications,logging` with nothing excluded pulls in
  **413,564 lines** — one `crate::engine::SOME_CONST` in a small module drags all
  of `engine` across. Every wave must therefore name its exclusions; the
  resulting "edges that must be broken" list *is* that wave's work plan.

The biggest units (LOC, from the same probe):

| unit | LOC | | unit | LOC |
|---|--:|---|---|--:|
| `commands::infrastructure` | 66,950 | | `commands::design` | 19,777 |
| `commands::companion` | 23,459 | | `commands::credentials` | 15,173 |
| `engine::subscription` | 22,729 | | `engine::build_session` | 13,880 |
| `commands::fleet` | 21,994 | | `engine::runner` | 8,487 |
| `companion::brain` | 21,573 | | `commands::execution` | 7,597 |
| `commands::core` | 20,121 | | `commands::recipes` | 2,365 |

## Wave 1 — `personas-kernel` (the enabler)

Every `commands::*` group reaches into the same four places: `lib` (the Tauri
`AppState`), `ipc_auth`, `background_job`, and small shared utilities. Until
those live below the commands, no command module can leave.

**Measured closure.** Seed `ipc_auth, background_job, logging, keyed_pool,
startup_timing, state`, excluding `engine, commands, companion, lib,
notifications, cloud, boot`:

```
6,615 LOC total — ipc_auth 1,212 · gitlab 1,211 · webbuild 1,231 · logging 699 ·
process_registry 308 · keyed_pool 249 · startup_timing 149 · state 149
Edges that must be broken: 6 references total
  -> lib      2  (1 from ipc_auth, 1 from gitlab)
  -> engine   2  (1 from state, 1 from gitlab)
  -> cloud    1  (1 from state)
  -> commands 1  (1 from state)
```

**Six references stand between this repo and a kernel crate.** That is the
cheapest structural move available, and it is the precondition for every wave
after it. Re-run the probe at wave start — `gitlab` and `webbuild` look like
passengers dragged in by one reference each and may be excludable, which would
shrink the crate further.

Expected effect on its own: small (the kernel is 1.5% of the crate). Its value
is that it unblocks waves 2-4. **If wave 1 alone cannot show a gain, keep it
anyway only if wave 2 lands in the same session** — otherwise the ratchet applies.

## Waves 2-4 — commands leave, smallest first

Order by `LOC ÷ references-to-sever`, cheapest first, re-measured per wave.
`commands::recipes` is the calibration wave: **2,365 LOC, 29 references**
(`commands::credentials` 6, `ipc_auth` 8, `engine` 8, `lib` 7) — small enough to
finish in one session and big enough to move a number.

Then the large groups in cost order, each its own crate, each depending only on
`personas-kernel`, `personas-core`, `personas-db`, `personas-engine`:
`commands::execution` → `commands::credentials` → `commands::design` →
`commands::core` → `commands::fleet` → `commands::companion` →
`commands::infrastructure` (67k lines, last, by then the pattern is routine).

The IPC shards make this cheaper than it was: `src/ipc_shards/shard_N.rs`
already groups commands, so a wave moves a shard's worth of modules and the
shard file follows them.

## Wave 5 — get `tauri` out of `personas-db` and `personas-engine`

`db/Cargo.toml:73` and `engine/Cargo.toml:96` both depend on `tauri` — a
475-package closure inside the two crates that are supposed to be the portable
layer, which is why `npm run test:rust:crates` is a narrower lane rather than a
fast one (`run-rust-tests.mjs:45-51`). The fix named in
`crate-layering.md:192-205` is an outbound trait: the crates emit events through
an interface the app implements, instead of importing `tauri::AppHandle`.
Ratchet for this wave is different — `npm run test:rust:crates` cold wall time.

## What this campaign is not

- **Not a rewrite.** Every wave is a move plus an interface, and master stays
  releasable after each one.
- **Not unbounded.** The 5%-gain stop clause is real.
- **Not a substitute for the cache budget.** More crates mean more artifacts;
  `scripts/hygiene/` reaps them, and `disk-target` is watched per wave.

## Open follow-ups from the 2026-09-18 spark

- **`sccache` as `RUSTC_WRAPPER`, measured.** It cannot cache incremental or
  linking crates, so it will not touch the 23.5 s floor — but a fresh worktree's
  cold start (**490 s**, measured) is almost entirely third-party crates, which it
  can. Measure `rust-build-cold-worktree` with and without it before adopting.
- **Two duplicate-dependency fixes that need API migrations:** `sentry 0.34 ->`
  newer (drops the second `rustls`), `windows 0.58 -> 0.61` (unifies with
  tauri's). Both were left out of the dependency pass deliberately.
- **`clean-ort.mjs` / `ensure-ort-cache.mjs`** look for ort intermediates under
  `src-tauri/target` only; they are silent no-ops in any checkout using a
  build-dir. Harmless today (the build-dir experiment was reverted), a trap if
  one is ever adopted.
