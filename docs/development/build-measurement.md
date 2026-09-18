# Build measurement

> Build optimization without measurement is folklore with a commit history.
> Every build-cost number this repo quotes comes from `npm run bench:build`, and
> every claimed win ships as a **before/after pair** in
> [`build-ledger.jsonl`](./build-ledger.jsonl).

Until 2026-09-18 the repo's build figures lived in prose — `build-memory.md`,
`build-cache.md`, three golden paths — each measured by hand, once, under
conditions nobody can reproduce. Several had already drifted: three documents
disagree on `app_lib`'s size (265k / 331k / 431k lines), and the most valuable
measurement in the tree (one macro is 49% of `cargo check`) was never acted on
because nothing re-ran it. The harness makes a number cheap enough to re-take
that nobody has to trust an old one.

## Run it

```bash
npm run bench:build -- --list
npm run bench:build -- --scenario rust-check-touch-lib --variant baseline
npm run bench:build -- --scenario rust-check-touch-lib --variant handler-shards --note "8 shards"
```

One run appends one row. `--variant` is the label a before/after pair is joined
on; `baseline` is the default.

| Flag | Meaning |
|---|---|
| `--scenario <id>` | required; ids below are wire-level — the ledger, docs and the structure campaign's ratchet key on them |
| `--variant <name>` | what is being measured (default `baseline`) |
| `--features <list>` | cargo features for Rust scenarios (default `desktop`, the daily lite lane) |
| `--warmup` | run the command once first, unrecorded — use it for the first Rust scenario of a session |
| `--root <path>` | measure another checkout (e.g. the main checkout's warm target from inside a worktree); the ledger is still written beside the script |
| `--note <text>` | free text stored on the row |
| `--verbose` | show the measured command's output |

## Scenarios

| id | What it measures |
|---|---|
| `rust-check-warm` | `cargo check --lib`, nothing changed — the fingerprint walk floor |
| `rust-check-touch-lib` | touch `src-tauri/src/lib.rs` (the `generate_handler!` file), then check — the **trunk** edit |
| `rust-check-touch-leaf` | touch one `commands/` leaf, then check — the **leaf** edit developers actually live in |
| `rust-build-lib-warm` | touch `lib.rs`, then a dev build of the lib — adds codegen, no link of the app exe |
| `fe-codegen` | the `predev` codegen preset |
| `fe-check` | `npm run check`, all gates |
| `fe-build` | `vite build` alone |
| `prepush` | the lefthook pre-push jobs |
| `disk-target` | bytes under `src-tauri/target` |

Rust scenarios use `--lib` on purpose: a running dev app holds
`personas-desktop.exe` open, and a bin link would fail the measurement rather
than measure it. They are **warm** scenarios. A cold build is a different
product with a different budget; measure it deliberately (`cargo clean -p` the
four workspace crates first, say so in `--note`) and never by accident.

## What a row carries

```json
{"ts":"…","scenario":"rust-check-touch-lib","variant":"baseline","features":"desktop",
 "host":"NAME/arm64/12c/32G","rustc":"rustc 1.96.1 (…)","commit":"38bd5a02d","root":".",
 "note":"…","wallMs":171000,"peakRssMb":4242,"peakTotalMb":5100,"peakProc":"app_lib"}
```

`peakRssMb` is the single largest `rustc`, sampled at 1 Hz by
`scripts/build/sample-build-memory.ps1`, and `peakProc` is the crate that
process was compiling. One process is what OOMs a machine, and a peak without
attribution says the build is too big while a peak *with* it says where to act.
A spike shorter than the 1 s interval is invisible; for compiler-scale peaks
that is adequate, and it is part of the number's predicate.

## The rules

1. **"Could not measure" is not a number.** If another `cargo`/`rustc` is live
   the harness refuses (exit 2) instead of recording a contended figure. If the
   measured command fails it records nothing (exit 1).
2. **Compare like with like.** Same scenario, same features, same host, same
   toolchain. A pair that differs in more than `variant` is two anecdotes.
3. **A win is a pair.** A change that claims to make the build faster, lighter
   or smaller lands with its `baseline` row and its variant row in the same
   commit. A change without a pair is a hypothesis.
4. **Losses are recorded too.** A probe that did not help keeps its row and gets
   a one-line verdict in the commit message. The next person should not re-run
   it to find out.
5. **Re-measure before citing.** A six-month-old row is a historical document.

## Toolchain

`rust-toolchain.toml` pins the compiler (1.96.1 at adoption). Before it, the
channel was whatever the machine had, and no cache key or ledger row could name
the compiler that produced it. Bump it deliberately, with a pair.
