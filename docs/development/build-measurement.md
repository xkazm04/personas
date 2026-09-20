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
| `rust-check-touch-lib` | touch `src-tauri/src/lib.rs` (the crate root; it held the `generate_handler!` list until 2026-09-18), then check — the **trunk** edit |
| `rust-check-touch-leaf` | touch one `commands/` leaf, then check — the **leaf** edit developers actually live in |
| `rust-build-lib-warm` | touch `lib.rs`, then a dev build of the lib — adds codegen, no link of the app exe |
| `fe-codegen` | the `predev` codegen preset |
| `fe-check` | `npm run check`, all gates |
| `fe-tsc` | `npx tsc --noEmit` on the TS 6 compiler. Cold or warm depending on `tsconfig.tsbuildinfo` - delete it first for a cold row and say which in `--note` |
| `fe-tsc-native` | `npm run typecheck:native`, the TS 7 native compiler with its own buildinfo under `node_modules/.cache/tsgo/`. Pairs with `fe-tsc`: a different compiler is a different command, so it is its own scenario rather than a variant |
| `fe-eslint` | `npm run lint` - whole `src/`, whatever cache location the script uses, so a row always measures what the repo really does |
| `fe-vitest` | `npx vitest run`, the default lane, full suite |
| `fe-build` | `vite build` alone |
| `prepush` | the lefthook pre-push jobs |
| `disk-target` | bytes under `src-tauri/target` |
| `disk-build-dir` | bytes under cargo's `build_directory` (equals `target` unless a `build.build-dir` is configured, as it is for worktrees) |
| `rust-check-cold-applib` | `cargo clean -p personas-desktop`, then `cargo check --lib`: the app crate from nothing, dependencies warm, no incremental cache. What CI, a fresh worktree and a first clippy run pay |
| `rust-build-cold-worktree` | first dev build of the lib in an empty build dir. Run once per new build dir; say in `--note` what was already warm |
| `fe-check-tiers` | `npm run check:tiers` — the tier gate, the most expensive single entry in `npm run check` |
| `size-dist` | bytes of `.js` under `dist/` (maps excluded) |
| `size-dist-maps` | bytes of `.map` under `dist/` |
| `size-worker-chunk` | bytes of `dist/**/*.worker-*.js` — the Web Worker bundles |

The three `size-*` scenarios measure the **current** `dist/`; they run no build of
their own, so a row is only readable next to a `--note` saying which build
produced that tree. Each carries `files` and `largest` alongside `bytes`,
because "0 bytes, 0 files matched" (a broken selector, or no `dist`) and "0
bytes, the artefact is gone" are different outcomes and only one of them is a
win. A missing `dist/` is refused rather than recorded as zero.

Rust scenarios use `--lib` on purpose: a running dev app holds
`personas-desktop.exe` open, and a bin link would fail the measurement rather
than measure it. The first four are **warm** scenarios. A cold build is a
different product with a different budget; measure it deliberately, with the two
cold scenarios above, and never by accident.

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

## Rejected: a shared `build.build-dir` across worktrees

Tried 2026-09-18 and **not adopted**; recorded so nobody re-runs it to find out.

The design was one `build.build-dir` for every agent worktree (delivered by an
untracked parent-directory `.cargo/config.toml`), keeping the main checkout
separate. It is **unsafe on cargo 1.96.1**: a workspace member's unit hash does
not include the checkout path (the same `.fingerprint/personas-core-<hash>` name
appears in two checkouts), and freshness is mtime-based. With two copies of a
one-crate workspace sharing one build dir, cargo reported the second copy
`Fresh` and its exe printed the FIRST copy's string. In-tree, reverting a leaf
file byte-exact with its original mtime left cargo reporting `Fresh` over an
rmeta compiled from the edited source. A worktree would silently link another
worktree's code.

The safe variant - `build-dir = ".../{workspace-path-hash}"`, one dir per
worktree under one root - was built and then removed as well: it relocates
intermediates and shares nothing, so a first build in a fresh worktree still
costs **490 s and 7.0 GB** (ledger: `rust-build-cold-worktree`); it silently
moved sibling sessions' builds; and it turned `clean-ort.mjs` /
`ensure-ort-cache.mjs` into no-ops, because they look under `src-tauri/target`.

What would actually share third-party compiles across worktrees is a
content-addressed compiler cache (`sccache` as `RUSTC_WRAPPER`): it cannot help
the incremental loop (it cannot cache incremental or linking crates), but a
fresh worktree's cold start is almost entirely third-party crates, which it can.
That is an unmeasured follow-up, tracked in
[`docs/refactor/build-structure-campaign.md`](../refactor/build-structure-campaign.md).
## Toolchain

`rust-toolchain.toml` pins the compiler (1.96.1 at adoption). Before it, the
channel was whatever the machine had, and no cache key or ledger row could name
the compiler that produced it. Bump it deliberately, with a pair.
