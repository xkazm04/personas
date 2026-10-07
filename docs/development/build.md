# Building Personas Desktop

End-to-end reference for building, packaging, and releasing Personas Desktop.
For day-to-day development workflow, see [development.md](./development.md).

## Quick reference

```bash
# Develop
npm run tauri:dev              # DEFAULT: lite — 683 crates, no ML/P2P
npm run tauri:dev:lite         # the same thing, kept as an alias
npm run tauri:dev:full         # 846 crates: adds ml (ORT/fastembed) + p2p
npm run tauri:dev:test         # lite + test-automation HTTP server on :17320

# Build
npm run tauri:build            # canonical: all targets, desktop-full features
npm run tauri:build:lite       # lite: nsis-only, desktop features
npm run tauri:build:stable     # stable: nsis + msi, full LTO

# Frontend-only tier checks
npm run check:tiers            # builds starter + team + builder bundles
npm run check:tauri-configs    # validates 3 of the 5 tauri*.conf.json files
```

## The two dimensions

A "build" is two independent choices: **frontend tier** × **backend variant**.

### Frontend tier (`VITE_APP_TIER`)

Tiers control which UI features are gated in the React bundle. The default
build (`npm run build`) produces the **builder** tier (everything visible).
For tier-specific builds:

```bash
npm run build:starter          # starter-tier UI gates only
npm run build:team             # adds team-tier features
npm run build:builder          # all features (default)
```

Tier compile failures don't show up in `npm run build` — run
`npm run check:tiers` locally before pushing if you've touched tier-gated
imports. CI also enforces this in `frontend-checks` (see `.github/workflows/ci.yml`).

### Backend variant (Cargo features × Tauri config)

**Five** tracked Tauri configs in `src-tauri/` (plus two generated at launch — see
below). A variant must be an *overlay*: the smallest possible delta over the canonical
config, never a fork.

| File | Features | Bundle | Use | Read by `check:tauri-configs` |
|------|----------|--------|-----|---|
| `tauri.conf.json`        | `desktop-full` (= desktop + ml + p2p) | all targets       | canonical full build | ✅ canonical |
| `tauri.lite.conf.json`   | `desktop`                              | nsis only         | fast Windows iteration | ✅ overlay |
| `tauri.stable.conf.json` | `desktop-full`                         | nsis + msi        | Windows release | ✅ overlay |
| `tauri.android.conf.json`| `[]` (none)                            | all targets       | `tauri android build` | ❌ |
| `.tauri-scraper-dev.conf.json` | `desktop,scraper,test-automation` | — | **no consumer** — referenced by no npm script, doc, hook or CI job | ❌ |

Two more configurations are written at launch and merged in as a second `--config`:
`scripts/dev/tauri-dev-test.mjs` (`.tauri-devtest.gen.conf.json`, gitignored) and
`scripts/test/launch-isolated.mjs` (a `devurl.config.json` in a throwaway data dir), both
because `devUrl` is hardcoded in the canonical config and has no environment-variable form.

`--config` is a **deep merge with whole-array replacement**, and Tauri then materializes
its own defaults into the result. So `tauri.android.conf.json`'s `"features": []`
*replaces* `["desktop-full"]` rather than adding to it. Anything under `src-tauri/gen/` is
build output with no provenance — never read a claim off it.
See [`docs/concepts/golden-paths/tauri-config-variants.md`](../concepts/golden-paths/tauri-config-variants.md).

The canonical config's `security.csp` is documented per-domain in
[`csp-inventory.md`](csp-inventory.md) — update that file in the same change
when you add or remove a network-using feature.

Cargo features in `src-tauri/Cargo.toml`:

| Feature | Implies | What it adds |
|---------|---------|--------------|
| `desktop`         | —                          | tray, clipboard, notifications, keyring, screen capture, window state, updater |
| `ml`              | —                          | sqlite-vec + fastembed + ort (ONNX Runtime) |
| `p2p`             | —                          | ed25519, mdns-sd, quinn, rcgen |
| `desktop-full`    | desktop + ml + p2p         | full production set |
| `test-automation` | (xcap + image)             | HTTP server on :17320 for MCP-driven UI testing |
| `daemon`          | desktop-full *             | headless daemon binary (`personas-daemon`) |

\* `daemon` implies `desktop-full` because of unresolved `#[cfg(feature="desktop")]`
gaps in four backend modules — see the comment on the `daemon` feature in
`Cargo.toml` for the cleanup plan.

### The dev variant map — what the cheap default cannot see

**`npm run tauri:dev` is the LITE build.** It was `desktop-full` until this map was
written, which contradicted `.claude/CLAUDE.md`'s own standing advice ("default to lite
for daily work") — the advice was right and the default command was wrong. Today's
`desktop-full` dev build is **`npm run tauri:dev:full`**; `tauri:dev:lite` stays as an
alias so anything that already types it keeps working.

The release path is untouched: `tauri.conf.json` still declares `desktop-full`, and
`tauri build` / `tauri:build:stable` still ship ml + p2p. **Do not "simplify" this by
editing `tauri.conf.json`** — it is the config `tauri build` reads, so a lite value
there would ship an installer with no vector knowledge base and no P2P, silently.

**The size of the choice, reproducible in seconds (metadata only — compiles nothing):**

```bash
cd src-tauri
cargo tree -e normal --no-default-features --features desktop      --prefix none | sort -u | wc -l   # 683
cargo tree -e normal --no-default-features --features desktop-full --prefix none | sort -u | wc -l   # 846
```

Measured 2026-10-07: **683 lite / 846 full**, and lite is a strict subset — `comm` over
the two sorted sets gives **163 entries only in full and 0 only in lite**. The 163 are
headed by `ort` + `ort-sys` + `fastembed` + `tokenizers` + `ndarray` + `hf-hub` +
`sqlite-vec` (the `ml` half) and `quinn` + `rcgen` + `ed25519` + `mdns-sd` (the `p2p`
half). ORT is the expensive one; `clean:ort` exists because of it.

**Which work needs `npm run tauri:dev:full`:**

| Work | Gate | Why lite cannot do it |
|---|---|---|
| Vector knowledge base, semantic search | `ml` | sqlite-vec is not linked |
| Embeddings, fastembed, model download/cache | `ml` | fastembed + hf-hub + tokenizers are absent |
| ONNX inference, anything touching ORT | `ml` | `ort`/`ort-sys` are absent |
| P2P pairing, mDNS discovery, QUIC transport | `p2p` | quinn + mdns-sd + rcgen + ed25519 are absent |

**What lite literally cannot exercise — absent, not broken.** Everything behind
`#[cfg(feature = "ml")]` / `#[cfg(feature = "p2p")]` is *compiled out* of a lite build.
It cannot throw at runtime, cannot fail a test, and cannot show up in a log: there is no
code there. So a green lite session is **not evidence about those paths**, and "it works
on my machine" from a lite build says nothing about the vector KB. Two consequences worth
knowing:

- A compile error that exists only under `desktop-full` is invisible to every local lite
  gate. This has already happened: a 2026-08-21 wave deleted ~23 symbols whose only
  consumers sat behind `ml`, verified under `--features desktop`, and produced **56
  compile errors under `desktop-full`** with every gate green.
- `PeriodicTask`, the better of this repo's two background-loop harnesses, lives behind
  `p2p` — so the best primitive does not compile in the variant most development uses.
  See [`background-loop.md`](../concepts/golden-paths/background-loop.md).

**CI is the other half of this trade, and it is what keeps the gated code from rotting.**
The `rust-features` job (`.github/workflows/ci.yml:1000`) is a compile matrix that runs
`cargo check --workspace --features <shape>` for **`desktop-full`**, `desktop,scraper` and
`desktop,test-automation` on every push that touches Rust (`push: master` is this
workflow's primary trigger — development lands directly on master). The three-OS
`rust-tests` job additionally runs `cargo test --workspace --features desktop`. So the
code lite skips is still compiled on every Rust push; what CI does **not** do is *run*
the `ml`/`p2p` paths, which is why a change to the vector KB still deserves one local
`tauri:dev:full` before it lands.

### Editing a template relinks the binary. That is correct.

Touch any `scripts/templates/<category>/*.json` and the next cargo run recompiles the app
crate and relinks a **143 MB** debug binary (`personas-desktop.exe`, measured
143,516,672 bytes). Nothing is wrong: `src-tauri/build.rs` declares
`cargo:rerun-if-changed=../scripts/templates` (`build.rs:99`) because
`embed_template_index()` aggregates the catalog into `$OUT_DIR/template_index.json`, which
`engine::build_session::templates` pulls in with `include_str!`. The catalog has to travel
*inside* the binary — `tauri.conf.json` bundles only `resources/skills`, so a shipped
installer carries no `scripts/` directory at all and an on-disk read would find nothing.

**Do not "fix" this** by dropping the `rerun-if-changed` or by reading the catalog off
disk at runtime. The first makes an edited template silently absent from the running app;
the second is the defect the embedding was introduced to undo.

### The cargo throttle

Every cargo this repository launches goes through **`scripts/build/cargo-run.mjs`** — the
sidecar build (`scripts/dev/ensure-mcp-sidecar.mjs`), the Rust test suite
(`scripts/build/run-rust-tests.mjs`), and anything added later. It lowers this node
process to **below-normal priority** (Windows children inherit the class at creation, so
cargo and every rustc under it come up throttled without chasing pids) and caps the build
at **`max(2, cores - 2)` jobs** — 10 of 12 on this host — then queues: it waits for any
live `cargo.exe`/`rustc.exe` rather than refusing, because two concurrent cargo runs on
this machine is the memory failure this repo keeps measuring.

`tauri dev` is the exception, and only because it spawns cargo *itself* three processes
down (`node` → tauri CLI → cargo), so there is no command line to wrap.
`scripts/devlog/run.mjs` therefore sets the same two things by the only mechanisms that
reach a grandchild: `os.setPriority` on itself, and **`CARGO_BUILD_JOBS`** in the child
environment (cargo's documented env form of `--jobs`). It prints one line saying what it
set, and it does not restore the priority afterwards — the whole dev session, Vite
included, should stay below-normal.

| Env | Effect |
|---|---|
| `CARGO_FULL_SEND=1` | no throttle, no queue — unattended full speed |
| `CARGO_GUARD=off` | skip the queue only, keep priority + job cap |
| `PERSONAS_CARGO_JOBS=<n>` | explicit job count instead of `cores - 2` |
| `CARGO_BUILD_JOBS=<n>` | honoured as-is by the `tauri dev` path if you export it |

An empty string counts as unset for all of them. **CI does not come through here**: runners
are dedicated, `.github/workflows/*.yml` calls cargo directly, and that is deliberate —
throttling a runner would slow every pipeline to protect a desktop that does not exist.

### What a test build gives the frontend

`boot::test_bridge` opens the automation HTTP server on **two** independent
conditions: `PERSONAS_TEST_PORT` naming a port (any debug build), or the
`test-automation` compile feature (`npm run tauri:dev:test`, where nothing sets
that env var). `lib.rs` injects `window.__PERSONAS_TEST_MODE__ = true` before
page JS on the same two conditions — it followed only the first until
2026-09-07, so the build made *for* driving the UI was the one whose frontend
could not tell it was bridged.

Two things read that flag:

- `src/test/automation/perfInstrument.ts` — the perf bridge (also loaded in any
  `import.meta.env.DEV` build).
- **The Activity board's Simulation toggle** — a gold button in the Monitor's
  Activity header that fills the whole surface with a deterministic mock fleet:
  20 projects × 3 agents, live sessions under half the columns plus two the
  board cannot place, five Claude plans covering every usage-strip card branch,
  and rail rows on all three tabs. Click again to return to the real fleet.
  The fixtures live in `src/features/fleet/monitor/grid/simulation/`; they
  substitute at the board's *input* boundary, so grouping, scoping, paging and
  virtualization all run their real code against them.
  `setSimulation` refuses to turn on when the flag is absent, and the button
  renders `null` there — a shipped installer has no path to either.

## Codegen pipeline

`predev` and `prebuild` run codegen before Vite. Both go through
`scripts/run-codegen.mjs`, which runs each task **in parallel** with a per-task
60s timeout (override via `CODEGEN_TIMEOUT_MS`). Tasks:

`TASKS` has **15** entries; `predev` runs 14 and `prebuild` runs 14 (they differ by
exactly two, below). `scripts/run-codegen.mjs` is the authoritative list — the highlights:

- `commands` — extracts Tauri command names from `src-tauri/src/lib.rs` →
  `src/lib/commandNames.generated.ts`
- `i18n` / `i18n-split` — generated types from `src/i18n/locales/en.json`, plus the
  per-section locale chunks
- `connectors` / `shared-events` / `n8n-limits` / `sprites` / `catalog` /
  `scan-match` / `guidance-anchors` / `gp-index` / `system-skills` — the rest.
  `gp-index` writes three artifacts, not one: the manifest
  `docs/concepts/golden-paths/index.json`, one self-contained
  `docs/concepts/golden-paths/index/<leaf>.json` per published path, and
  `router.json`. It also **deletes** leaf files whose document has left the
  corpus — the generator owns that directory, so never hand-edit it
- `checksums` (**prebuild only**) — template integrity hashes
- `host-check` (**predev only**) — detects Rust host-triple drift (see below). Note the
  asymmetry: the error it detects is a *link* error, which only happens during a build.
- `cache-budget` — advisory disk-pressure warning; exits 0 unconditionally by design

ts-rs binding generation is **not** part of this pipeline — it runs via
`cargo test export_bindings`. The `binding-drift` job in CI catches forgotten
regenerations.

## React Compiler (experimental, flag-gated)

`scripts/babel/react-compiler-vite-plugin.mjs` wires `babel-plugin-react-compiler`
into the Vite build as a **dark-launched, build-only** experiment (ADR
"react-compiler-build-only"). It is **off by default**: set
`PERSONAS_REACT_COMPILER=1` to opt a build in.

```bash
PERSONAS_REACT_COMPILER=1 npx vite build   # or npm run build, tauri:build*, etc.
```

- **Build-only** — the plugin's `apply: 'build'` means it never touches `vite
  dev` / `tauri dev`; dev-loop speed for the repo's ~4,800 source files is
  unaffected either way.
- **Standalone Babel pass, not `react({ babel })`** — under rolldown-vite,
  `@vitejs/plugin-react`'s `babel` option is a silent no-op because JSX is
  lowered by oxc. The plugin runs its own `enforce: 'pre'` Babel transform
  before oxc, the same pattern already used by
  `scripts/babel/dev-source-loc-vite-plugin.mjs` for DevInspector.
- **Nothing is removed** — the repo's 1,356 `useMemo` + 2,114 `useCallback` +
  98 `memo()` sites are untouched by this change; the compiler's memoization
  runs alongside them until individual sites are deliberately migrated.

**Measurement protocol before ever flipping the default to on:**
1. Build twice (flag unset, then `PERSONAS_REACT_COMPILER=1`) and diff
   `dist/assets/*.js` chunk sizes.
2. Run the `<Profiler id="app-root">` instrumentation (`src/App.tsx` →
   `window.__PERF__.recordRender`) against both builds via the
   `perf-nav-walk` harness (`tests/playwright/perf-nav-walk.spec.ts`,
   `scripts/perf/render-perf-report.mjs`) for a real render-cost comparison.
3. Only promote the default from opt-in to opt-out after both show a
   measured win, with `npm run test -- --run` and the golden-path census
   still green.

## ARM64 vs x64 Windows

Both architectures share `src-tauri/target/debug/deps/` — Cargo doesn't
segregate the deps directory by triple. Switching default targets between
runs (e.g. via toolchain change, or restoring from another machine's cache)
poisons the cache: rlibs from arch A get linked into a build for arch B,
producing `lld-link: error: machine type x64 conflicts with arm64`.

Detection: the `host-check` codegen task writes `src-tauri/target/.last-build-host` at
the end of its own run — i.e. *before* cargo starts, so it records the host the last
`predev` saw, not the host of the last successful build. The next `predev` compares it to
`rustc -vV`'s host and fails loud on mismatch (without updating the marker) with the
recovery command:

```bash
npm run ensure:ort-cache       # repairs one vendor artifact; seconds, idempotent
npm run clean:ort              # surgical: ort + ort-sys artifacts + the vendor cache (~5 min)
npm run clean:rust             # nuclear: full cargo clean (~10 min rebuild)
```

For *size* management — `target/` is uncapped and balloons across profiles,
triples, and per-worktree caches — see [build-cache.md](build-cache.md)
(`npm run cache:report` / `clean:cache` / `clean:worktrees`). `clean:rust`
above is for *correctness* recovery; the cache budget is for disk pressure.

CI was vulnerable to the same trap — `release.yml`'s build job has matrix
entries for `windows-x64` and `windows-arm64` both on `windows-latest`,
sharing a single GitHub Actions cache. The rust-cache action is now keyed
by `matrix.rust_target` (since 2026-05-02), so each arch has an isolated
cache.

## Linker

LLD-link is configured for both Windows targets in `src-tauri/.cargo/config.toml`
(2-5x faster link than MSVC's link.exe, no measurable codegen difference).
Stack size is bumped to 8 MB on both targets to match Linux/macOS defaults
— sync Tauri commands deserialize on the main thread, and the default 1 MB
stack overflows on deeply-nested payloads.

## The crate split — why `app_lib` is the whole memory story

`app_lib` is the crate that sets the memory ceiling for every build in this repo.
One rustc process chews the whole thing, so the peak follows its size and **no flag
reaches it** — not `-j`, not `debug`, not the linker settings below. Measured
2026-10-07 on a 12-core Windows ARM host, `cargo build --lib --features desktop`:

| date | app_lib LOC | peak single rustc |
|---|---|---|
| 2026-07-26 | 431k, one crate | 8,872 MB |
| 2026-07-27 | after `core`/`db`/`engine` were split out | 6,201 MB |
| 2026-10-07 **before** step 6 | 522,110 | **9,816 MB** |
| 2026-10-07 **after** step 6 | 502,542 | **9,206 MB** |

The third row is the one to notice: the crate grew back past its pre-split peak, and
a `cargo check --lib` had reached 6,059 MB — a *check* now costs what a full *build*
cost in July. On a 16 GB machine it does not finish. **The split is not a one-time
fix; it is maintenance**, and the only lever that moves the peak is making `app_lib`
smaller.

Step 6 moved **39 files / 19,594 LOC** into `personas-engine` (96,489 → 116,161 LOC).

### The leverage ratio — use this to price the next move

19,568 LOC is **3.75%** of `app_lib` and bought **6.2%** of the peak (−610 MB).
Roughly **1.65× superlinear**, because rustc's cost per unit grows with the size of
the unit. Before planning further extraction, that ratio is the estimate to use —
and the thing to re-measure, since there is no reason to expect it constant.

Do **not** compare wall-clock across a split like this unless both runs had the same
cache state. The step-6 pair read 1,298s → 476s and that number is meaningless: the
first run compiled cold dependencies and the second did not.

### How a module moves, and why no call site changes

`src/engine/mod.rs` ends in `pub use personas_engine::*;`. A module that moves out
keeps resolving under its old path, so `crate::engine::<name>` is unchanged for every
consumer — **dropping the local `mod` decl is the whole app_lib edit.** A 20k-LOC move
touched no callers.

That glob does **not** reach a module whose parent stayed behind, because the parent's
own `mod <dir>;` shadows it. Nine directories are split that way (`background`,
`build_session`, `http_engine`, `platforms`, `project_tracking`, `runner`,
`subscription`, `twin_sample`, `twin_setup`): the engine crate gets a synthesized
`mod.rs` naming the children that moved, and app_lib's copy re-exports each one
explicitly.

### What decides whether a module can move

Not what it looks like. Three rules, each learned by getting it wrong:

1. **Most `crate::`-looking paths are already extracted.** `crate::db` is
   `personas_db`; `crate::error`, `crate::utils` are `personas_core`; and twenty more
   names are re-exported at `src/engine/mod.rs` lines 24/38/42/44/48/66 — `types`,
   `url_safety`, `embedder`, `chain`, `run_budget`, `scheduler`, `error_taxonomy`
   among them. All renames, no work. Counting them as blockers under-measures what is
   movable by more than half.
2. **A file moves only if every ENGINE module it names also moves.** This transitive
   closure, iterated to a fixpoint, is the real constraint — and dropping one file can
   strand another, including a parent whose child has just been dropped.
3. **`pub(crate)` is the trap.** It means "visible to app_lib" before the move and
   "visible to personas-engine" after, so every app_lib call site on such an item
   breaks with E0603. Step 6 promoted 138 occurrences to `pub`. Widening visibility on an
   unpublished internal crate changes no behaviour, which keeps the commit code motion.

Two more that cost a compile round each: a build-script artifact (`include!` of
something in app_lib's `OUT_DIR`) pins a file in place, and a crate used only through
an inline-qualified path (`urlencoding::encode(...)`, never `use urlencoding`) is
invisible to a dependency scan anchored on `use`.

### Deleting a `mod` decl: take its attributes with it

`#[cfg(test)] mod circuit_breakers_integration_tests;` — delete only the `mod` line
and the `#[cfg(test)]` lands on **whatever item comes next**. In step 6 that was
`mod healing_retry;`, and a live module silently vanished from every non-test build.
The attributes must also travel *with* the module to the new crate: re-declaring that
one unconditionally would compile an integration-test module into production builds.
Neither failure produces a warning.

### Moving code can silently remove it from a census rule

**22 census rules have `roots` narrower than `src-tauri`.** Moving a file from
`src-tauri/src/` to `src-tauri/engine/src/` takes it out of their scan, and the
violations it held stop being counted — which the census reports as a **drop**, the
shape that looks like a fix.

Step 6 hit exactly this: `undiscriminated-credential-rejection` is rooted at
`src-tauri/src` only, and moving `db_query.rs` took 8 of its 17 matches out of scope
(17→9 matches, 6→5 files). `npm run census -- --update` would have made it green by
writing the lost coverage into the ratchet — manufacturing one more of the "gates
that ran green while checking nothing" this repo keeps finding. **Fix the rule's
`roots`, not the baseline.** Several rules already name `src-tauri/engine/src`
because step 5 updated them; check the rest before re-baselining anything. After the
root fix the census was byte-identical to its pre-move state: 212 rules, 20,599
violations across 7,940 files, no baseline edits.

### What is left, and the one thing blocking it

142,530 LOC of `src/engine/` is still in `app_lib`, in 155 files. The blockers:

| blocked on | files |
|---|---|
| `crate::commands::*` | 63 |
| `crate::companion::*` | 32 |
| `AppState` | 31 |
| `crate::lifecycle` | 24 |
| `crate::notifications` | 18 |
| `crate::cloud` | 18 |

Every frontier module was checked individually; **none is blocked by anything except
these.** `commands` is the one that matters and the one worth inverting — an engine
that calls into the command layer has its dependency arrow backwards. 11 files are
blocked by `AppState` alone, so a host-context trait would release those immediately.

### The "portable half" is not portable yet

`engine/src/lib.rs` describes itself as "the portable half … without pulling in a
windowed `AppHandle`". `engine/Cargo.toml` depends on `tauri`, and
`engine/src/events.rs` imports `tauri::{AppHandle, Emitter}` unconditionally. The
crate is **extracted, not portable** — treat the header as intent.

The abstraction that would close it already exists in that same file:
`ExecutionEventEmitter`, with `TauriEmitter` and `NoOpEmitter` impls and an
`emit_json` dyn-compatible method. The remaining work is to adopt it at the call
sites that still take an `AppHandle` only to call `.emit()` on it, then make `tauri`
an optional dependency. Build a new trait for this and you have duplicated a working
one — see `.claude/rules/rust-backend.md` on unadopted abstractions.

### Verifying a move: `cargo check` is not enough, and `super::` is a trap

**`cargo check` compiles no `#[cfg(test)]` code.** Both crates reported 0 errors and
0 warnings on a version of step 6 whose *test* build failed with 377 errors. Use
`--all-targets` on every crate you touched, every time, before believing a move.

The 377 had one cause, and it is the trap: a blanket `super::` -> `crate::` rewrite
also rewrites `super::` inside `mod tests { use super::*; }`, where `super` is the
file's **own** module and not its parent. Every one of those errors was a test
referring to an item its own file defines. And the rewrite was never needed — in
`engine/src/foo.rs` a top-level `super::` already means the engine crate root, which
holds the same modules the app_lib `engine` module did. **Leave `super::` alone;
rewrite only the names that were re-exports.**

Two more measurement notes from the same pass:

- **The movability closure is mutually recursive.** Dropping a child can strand a
  parent (`platforms/mod.rs` losing `deploy.rs`) and un-moving a parent can strand a
  child (`observers.rs` needing `super::ObservationPoint` from `hooks/mod.rs`). Run
  both conditions to a *joint* fixpoint, and remember that a capitalised `super::X`
  is an item owned by the parent's `mod.rs`, not a sibling module — filtering those
  out as "not a module" is how a file survives a check it should fail.
- **Know which clippy form is gated.** CI runs
  `cargo clippy --workspace --manifest-path src-tauri/Cargo.toml --features desktop -- -D warnings`
  — no `--all-targets`, so lib targets only. The `--all-targets` form is gated
  nowhere and is red in both crates independently of this work (10 errors in step-5
  engine files, 77 in app_lib `src/commands/**`). Measure against the form that
  actually gates before concluding you broke or fixed anything.

## Profiles

Defined in `src-tauri/Cargo.toml`:

| Profile | Inherits | LTO | codegen-units | Use |
|---------|----------|-----|---------------|-----|
| `dev`         | —          | off          | default | local development |
| `dev-release` | dev        | thin         | default | perf testing — ~3x faster than release |
| `release`     | —          | thin         | 2       | daily releases (default `cargo tauri build`) |
| `ci`          | release    | thin         | 4       | CI tests + clippy (faster, debug symbols kept) |
| `stable`      | release    | full         | 1       | milestone releases (`cargo tauri build --profile stable`) |

`panic = "unwind"` on release because `ort` panics on ONNX Runtime DLL
version mismatches; we want `catch_unwind` to handle them.

## ONNX Runtime bundling

`ort = { version = "2.0.0-rc.9" }` ships in `desktop-full` builds via the `ml`
feature. fastembed's default `ort-download-binaries` feature is the only path
placing `onnxruntime.dll` next to the exe — **do not enable** ort's
`load-dynamic` feature, which flips to runtime DLL lookup and panics at boot.

`scripts/verify-onnxruntime-bundling.mjs` runs in `release.yml` after each
Windows build and fails the release if the DLL is missing.

### Pyke `ort-sys 2.0.0-rc.9` aarch64-windows tarball is mislabeled (auto-fixed)

The pre-built ONNX Runtime tarball pyke ships for `aarch64-pc-windows-msvc`
in `ort-sys 2.0.0-rc.9` is named correctly but **contains x64 binaries
inside**. Verified via `dumpbin /HEADERS`:

```
File: %LOCALAPPDATA%\ort.pyke.io\dfbin\aarch64-pc-windows-msvc\C09BFF…27DE\onnxruntime\lib\onnxruntime.lib
File Type: LIBRARY
FILE HEADER VALUES
            8664 machine (x64)        ← should be AA64 / ARM64
```

The SHA256 of the tarball matches `dist.txt` so the download-time hash
check passes; the defect is the contents, not the integrity. Linking arm64
Rust code against it produces `lld-link: error: machine type x64 conflicts
with arm64`. `fastembed 4.9.1` pins ort to exactly `=2.0.0-rc.9`, so we
can't escape via a version bump without a major dep upgrade.

**Auto-fix (default):** `scripts/ensure-ort-cache.mjs` runs from the
`pretauri:dev` / `pretauri:build` npm lifecycle hooks before cargo starts.
It:

1. Reads `rustc -vV` to detect the host triple. Exits clean if not a known
   Windows MSVC target.
2. Sniffs the cached `onnxruntime.lib`'s first object member to read its
   actual COFF machine field (bypassing labels).
3. If the cache is **already correct** for the host it exits immediately (and
   writes a sentinel if one was missing). **If it is wrong or absent**, it
   downloads Microsoft's official ONNX Runtime 1.20.0 release for the host
   arch, SHA-256-verifies it, and places it into pyke's expected cache slot.
   The `ort-sys` build script's `if !lib_dir.exists()` check then
   short-circuits the broken download.
4. Tracks state in a sentinel (`.personas-ort-fix-applied`) so subsequent
   runs are O(ms).
5. Detects stale cargo artifacts: if `target/<profile>/deps/libort_sys-*.rlib`
   was built before the sentinel was last written, the rlib was linked
   against the previous arch's lib and is evicted so cargo rebuilds.

This switches ORT from STATIC linkage (pyke's 290 MB onnxruntime.lib) to
DYNAMIC linkage (Microsoft's small import lib + onnxruntime.dll, ~12 MB).
The `ort` crate's `copy-dylibs` feature (on by default) ensures the DLL is
placed next to the exe in dev and release builds; tauri-bundler picks it up
from `target/release/` for installers.

**Manual recovery:** `npm run ensure:ort-cache` runs the fix on demand.
`npm run clean:ort` wipes the cache and forces a re-fix on next dev/build.

**Production releases: the fix does NOT run on CI.** `release.yml` builds through
`tauri-apps/tauri-action` with `tauriScript: npx tauri` — not an `npm run`, so no
`pre*` lifecycle hook fires on any runner. And the matrix has **two** Windows legs
(`x86_64-pc-windows-msvc` **and `aarch64-pc-windows-msvc`**, both on `windows-latest`),
so the arm64 leg cross-compiles against whatever pyke ships. `ensure-ort-cache.mjs` is
host-scoped (`const target = host;`) and could not repair a cross-compile's target slot
even if it did run. See
[`docs/concepts/golden-paths/bundling-native-assets.md`](../concepts/golden-paths/bundling-native-assets.md).

If `pretauri:dev` is bypassed (e.g. running `cargo run` directly), the
broken binary will be re-downloaded and you'll see the link error.
Always go through the npm script entrypoints, or call
`npm run ensure:ort-cache` first.

## CI gates

See `.github/workflows/ci.yml`:

- **commit-lint** — Conventional Commits format
- **frontend-checks** — typecheck + lint + i18n parity + tier validation + bundle budget + tests
- **rust-tests** — `cargo test` + clippy + cargo-deny on Windows / macOS / Linux.
  ⚠ Measured 2026-08-17: all three steps currently fail. `cargo test` and `cargo clippy`
  stop at `personas-db` (fail-fast), so `app_lib` is compiled and never run or linted;
  `cargo deny check` dies deserializing `deny.toml`. See deferred-fixes #89 and #99.
- **command-name-drift** — regenerates `commandNames.generated.ts`, fails on diff
- **binding-drift** — runs `cargo test export_bindings`, fails on diff in `src/lib/bindings/`

`release.yml` runs on merged PRs to `master` and produces NSIS / MSI / .app /
AppImage artifacts plus the `latest.json` updater manifest. Per-target rust
cache key prevents x64/arm64 cross-contamination.

`installer-test.yml` (manual dispatch, or after `release.yml` completes) runs
installer acceptance smoke tests: Windows NSIS (blocking), plus macOS DMG and
Linux deb/AppImage (both `continue-on-error: true` during their soak period —
see the workflow file for the promotion bar). All three exercise the same
`--health-check` binary flag (`src-tauri/src/main.rs`).

## Android

Hardcoded NDK linker paths were removed from `src-tauri/.cargo/config.toml`
to keep the project portable across machines. See [android-build.md](./android-build.md)
for setup.
