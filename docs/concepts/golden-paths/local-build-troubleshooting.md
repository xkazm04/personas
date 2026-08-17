# Local build troubleshooting

> Situation node: `platform-delivery/build-profiles/local-build-troubleshooting` ·
> situation spine `sides: server` · `twoSided: false` · recurrence 10 · risk medium ·
> spine label `convergence: converged`. Dimensions: resilience · performance · cost.
> Spine's own framing: *"The right surgical clean, and which failures are
> loader/toolchain not code."* Merged from two earlier leaves, *"Windows loader and
> toolchain traps"* and *"Build cache hygiene"*.
>
> Composed 2026-08-17 against `master @ f81e2c1df`, on the machine the folk knowledge
> was written on (`rustc 1.96.1`, host `aarch64-pc-windows-msvc`). Sweep: the five
> entries of `.claude/CLAUDE.md` § *"When builds get slow or break"*, read as five
> falsifiable claims; `scripts/ensure-ort-cache.mjs` (438 lines), `scripts/clean-ort.mjs`,
> `scripts/check-build-cache.mjs`, `scripts/run-codegen.mjs`, `scripts/cache-budget.mjs`,
> `scripts/build/run-rust-tests.mjs`, `scripts/build/inspect-pe-imports.mjs`,
> `scripts/build/crate-split-deps.mjs`; `docs/development/build.md` (230 lines) claim by
> claim; `package.json`'s 77 scripts; `src-tauri/Cargo.toml` + the four other workspace
> manifests; `src-tauri/deny.toml`; all 7 GitHub workflows; the live ONNX Runtime cache
> on disk (`%LOCALAPPDATA%\ort.pyke.io`, byte-level COFF parse); **all 23 executables in
> `src-tauri/target/debug/deps`, run through the repo's own `inspect-pe-imports.mjs`**;
> and **the GitHub Actions API — 300 `ci.yml` runs, 23 `audit.yml` runs, and the full
> step-level logs of the Windows and Linux `rust-tests` legs of run `32025966929`
> (2026-08-17)**.
>
> **`cargo` was not available in this session.** Nothing here was compiled. Every Rust
> claim is read off the tree, off a `.lib` file's bytes, or off a CI log — and where a
> claim could only be settled by compiling, it is marked as unsettled rather than
> guessed.

---

## §0 — The headline

**The folk knowledge held. The machinery it points at did not.**

`.claude/CLAUDE.md`'s five build-troubleshooting entries were audited one by one against
the tree. **Four are accurate**, one is unresolvable without compiling, and the two
scripts they name (`ensure-ort-cache.mjs`, `check-build-cache.mjs`) do what they claim,
on this machine, today — the ORT sentinel on disk is dated `2026-05-14T10:24:34.926Z`,
records `verified_machine: "arm64"`, and the library it vouches for really is arm64 when
you read its bytes. That is an unusually good result for a troubleshooting section
nobody had ever checked, and it is worth saying plainly.

**The drift is one layer down, in the gates those entries assume are working.**

1. **`cargo deny check` has never evaluated a dependency in this repository.** There are
   two copies. In `ci.yml:313` it runs and **fails at `deny.toml:19:17`** —
   `unmaintained = "warn"`, a value cargo-deny 0.20 no longer accepts
   (`error[unexpected-value]: expected '["all", "workspace", "transitive", "none"]'`).
   Identical failure on the Linux and Windows legs, verified in both logs. `deny.toml`
   has not been touched since **2026-04-09**; `cargo install cargo-deny --locked` pins the
   *lockfile*, not the *version*, so the config broke when upstream did. In `audit.yml:44`
   the same command has been **`skipped` in all 18 runs where the step exists** — and would
   report success if it ran, because it is piped into `tee` under `/usr/bin/bash -e {0}`
   (**no `pipefail`** — read off the runner's own log for this job), which replaces
   cargo-deny's exit status with `tee`'s. **A gate that cannot fail, standing behind a
   gate that never runs.** `docs/development/build.md:212` lists cargo-deny as a working
   CI gate. *This finding is owned by
   [`supply-chain-policy`](./supply-chain-policy.md) and register #106; it was measured
   here independently, hours apart, and the two agree line-for-line — see §12.7 for the
   one number they do not agree on.*

2. **CI never reaches the crate this repository is.** On the Windows leg of run
   `32025966929` (2026-08-17), `cargo test --workspace --features desktop` ran
   `personas_core` (760/760 ok) and `personas_db` (**808 passed, 10 failed**) and then
   stopped — cargo's default fail-fast. `cargo clippy` on the same commit died at
   `personas-db` with **3 `clippy::sort_by_key` errors**. `personas-desktop (lib test)`
   **compiled** — the log carries its warning summary, *"generated 159 warnings"* — and
   was **never executed**. So the 331,560-line `app_lib` crate is built by CI and tested
   by nothing, linted by nothing, on every platform.

3. **Which is also why the loader trap looked unresolved — and running the repo's own
   diagnostic settles it.** `run-rust-tests.mjs:17-24` carries a correction offering two
   possibilities: *"either that leg is red, or the trap does not reproduce on the runner …
   Not resolvable without compiling."* **Neither, and it was resolvable without
   compiling.** Zero occurrences of `0xc0000139`, `comctl32` or `TaskDialogIndirect` in
   5,809 log lines, because cargo stopped before the only binary that imports it.
   Then `scripts/build/inspect-pe-imports.mjs` was run over all **23 executables** already
   sitting in `target/debug/deps`: **3 import `TaskDialogIndirect`** — the app binary
   (manifest, from tauri-build), one `app_lib` test binary (manifest, patched by the
   harness) and **one `app_lib` test binary with `manifest: NONE`, which would exit
   `0xc0000139` right now if you ran it**. The other **20 — every `personas_core`,
   `personas_db`, `personas_engine` and `render_plan_*` binary — do not import comctl32 at
   all**, which is exactly what `ensureManifest()` asserts at `:113-115` and had never been
   checked. The trap is real, the fixup's surgical scope is **20/20 correct**, and CI is
   blind to both.

4. **The one self-healing script in the set is correct by an assumption it does not
   state.** `sniffLibArchitecture` (`ensure-ort-cache.mjs:144-172`) reads the machine word
   of the **first non-metadata member** of the COFF archive. Parsed byte by byte on the
   live cache: 7 members — 2 linker metadata, **3 long-form objects reporting `0xAA64`,
   and 2 short-form import members whose first word is `0x0000`**. It gets `arm64` because
   `lib.exe` happened to emit the long-form members first. Reverse that ordering and the
   sniffer returns `unknown-0x0000`, which is `!== expectedMachine` at three call sites:
   it invalidates a valid sentinel, wipes and re-downloads a correct 321 MB cache, and then
   **`fatal()`s at `:431-433` on the freshly correct library** — turning the guard that
   protects `npm run tauri:dev` into the thing that blocks it.

And the cheapest finding in the batch: **98.6% of that cache is a debug symbol file
nobody links against.** `copyTree(innerLibDir, …)` copies Microsoft's whole `lib/`
directory, so `onnxruntime.pdb` — **317,247,488 of the 321,758,000 bytes on disk** — is
carried for the sake of a 2,124-byte import library.

---

## §1 — Trigger

You are in this situation when you say, or type, any of:

- *"`lld-link: error: machine type x64 conflicts with arm64`"* — or any link error naming
  two architectures.
- *"`cargo test` exited 127 and printed nothing"* / *"exit code `0xc0000139`"*.
- *"`Port 1420 is already in use`"* after a `tauri dev` that died mid-startup.
- *"Do I need `clean:rust` or is `clean:ort` enough?"* — i.e. **which surgical clean**.
- *"It builds on CI and not here"* / *"it builds here and not on CI"*.
- *"`target/` is 40 GB again."*
- **The "if you are about to write X" test:** if you are about to add a `clean:*` npm
  script, an `rm -rf` over a cache directory outside the repo, a `pre<script>` hook that
  repairs a vendor artifact, or a comment in `CLAUDE.md` beginning *"if you hit …"* — you
  are in this situation, and the rest of this document is the contract that entry must
  meet.

---

## §2 — The one way

**Make the failure name its own recovery, at the moment it fails, in the tool that
failed — and make the repair a precondition of the build rather than a paragraph in a
document.** A build failure on a developer's machine has exactly one expensive property:
the person reading it does not know whether they are looking at their code, their cache,
their toolchain, or an upstream vendor's mistake, and every wrong guess costs a
recompile. So the tool that can distinguish those four must be the one that speaks. In
order: (a) **assert the environment before the build, from a `pre*` hook, and fail loudly
with the command to run** — `check-build-cache.mjs` and `ensure-ort-cache.mjs` are the two
exemplars and between them cover host-triple drift and a mislabeled vendor binary;
(b) **when a repair is deterministic, perform it instead of reporting it** — but make the
repair *idempotent*, *verified by the artifact's own bytes*, and *sentinel-guarded* so the
common case is O(ms); (c) **classify by exit code at the call site**, because a loader
failure and a test failure are the same integer to a shell — `run-rust-tests.mjs:228-233`
special-cases `127`/`0xc0000139` and names the diagnostic to run next; (d) **scope every
clean to the smallest artifact set that can be wrong**, and publish the ladder (evict one
crate's rlibs → evict one vendor cache → `cargo clean`) with its cost, because the
undirected `cargo clean` is 10 minutes and is almost never the right answer; and (e) when
the knowledge genuinely cannot live in a tool — a port collision, a toolchain switch — put
it in the document, **and give the document a test**, because a troubleshooting document is
consulted precisely when its reader is already stuck and has no budget to discover that it
is stale.

**Where two answers are both defensible:** prefer *repair* over *report* only when the
repair is verifiable from bytes you can read without the network. `ensure-ort-cache.mjs`
qualifies (it SHA-256s the download and re-sniffs the result). A hypothetical
"auto-`cargo clean` on host drift" does not, and `check-build-cache.mjs` is right to
refuse it.

---

## §3 — Mandated primitives

| Primitive | What it gives you |
|---|---|
| `scripts/check-build-cache.mjs` (task `host-check` in `run-codegen.mjs:38`) | Host-triple drift detection. Writes `src-tauri/target/.last-build-host`; on mismatch prints both triples, the reason (*"Cached rlibs in `target/debug/deps/` are likely contaminated"*) and `npm run clean:rust`, then exits 1. Exits 0 when `rustc` is absent — a frontend-only contributor is not blocked. |
| `scripts/ensure-ort-cache.mjs` (`pretauri:{dev,dev:stable,dev:test:full,build,build:stable}`) | Pre-populates pyke's cache slot with Microsoft's ORT for the host arch. SHA-256-verifies the download **before** placing a statically-linked artifact (`:398-406`), sniffs the result, writes a sentinel, and evicts cargo's stale `ort`/`ort-sys` artifacts so incremental compilation cannot reuse the wrong-arch rlib. |
| `scripts/build/run-rust-tests.mjs` (`npm run test:rust`, `test:rust:crates`) | The only working local Rust test lane on Windows. Embeds a comctl32 v6 manifest **post-link, into test executables only**, and only into those that actually import `TaskDialogIndirect`. Sets an **absolute** `TS_RS_EXPORT_DIR` so bindings cannot land in a gitignored second tree. |
| `scripts/build/inspect-pe-imports.mjs` | The diagnostic for a binary that dies before `main()`: imported DLLs + symbols, and whether an RT_MANIFEST is embedded. Exported as `inspectPe()` and consumed by the harness above (`run-rust-tests.mjs:61`), so the diagnostic and the fix share one parser. |
| `scripts/clean-ort.mjs` (`npm run clean:ort`) | The middle rung of the cleaning ladder — `ort`/`ort-sys` build outputs and rlibs, plus the vendor download cache. |
| `scripts/cache-budget.mjs` (`npm run cache:report` / `clean:cache` / `clean:incremental`; task `cache-budget`) | Disk pressure, not correctness. Advisory by construction: `:439` — *"guard is advisory: it must never fail the build"* — and refreshes its measurement out of band. |
| `scripts/build/crate-split-deps.mjs` | Answers "what must travel with X" when a build is slow because one crate is too big. `--portable` / `--closure` / `--from…--to`. |
| `scripts/worktree-gc.mjs` (`npm run clean:worktrees`) | The other half of disk pressure: worktrees siblings left behind. |

**Do not invent a sixth `clean:*`.** The ladder is complete; what is missing is that it is
documented in three places with three different orderings (§7 D).

---

## §4 — Steps

1. **Read the exit code before the message.** `127` / `0xc0000139` on Windows is the
   loader, not your code — nothing ran. `101` from cargo is a panic or an aborted build
   script. `1` from a test binary is a real failure. Only the third is about your change.
2. **If it is the loader**, run `node scripts/build/inspect-pe-imports.mjs <exe>`. If it
   imports `TaskDialogIndirect` from `comctl32.dll` and has no embedded manifest, that is
   the v6 side-by-side trap; use `npm run test:rust`, which embeds the manifest post-link.
   **Do not fix it in `build.rs`** — the reasons are recorded at `run-rust-tests.mjs:26-38`
   and each was tried.
3. **If it is a link error naming two architectures**, do not clean anything yet. Run
   `node scripts/check-build-cache.mjs` (or just `npm run dev`, which runs it as
   `host-check`). If the host changed, `npm run clean:rust`. If it did not, the
   contamination is the vendor artifact: `npm run ensure:ort-cache`, which is idempotent
   and will tell you what it found.
4. **If a port is taken**, that is a *loud* failure by design — `vite.config.ts:243` sets
   `strictPort: true`, so a stale dev server makes the next run refuse rather than
   silently move to 1421 and pair a new backend with an old frontend. Kill it
   (`Get-NetTCPConnection -LocalPort 1420` → `Stop-Process -Id <PID> -Force`) and re-run.
5. **Only then clean, smallest first.** `ensure:ort-cache` (repairs one vendor artifact,
   seconds) → `clean:ort` (evicts one crate family + the vendor cache, ~5 min recompile) →
   `clean:cache` / `clean:incremental` (disk, no correctness effect) → `clean:rust`
   (`cargo clean`, 10+ min). **And then stop.** There is no rung below `cargo clean`;
   deleting `~/.cargo` is not a build fix, it is a download.
6. **When you learn something new here, put it in the tool, not in `CLAUDE.md`** — and if
   it genuinely cannot go in the tool, put it in `docs/development/build.md` *and* add the
   claim to §7 of this document so the next audit can falsify it.

---

## §5 — Anti-patterns

| Anti-pattern | Failure mode |
|---|---|
| **A recovery step documented only in prose.** | It is read while the reader is already stuck and already frustrated. Measured here: `build.md:178` states the *inverse* of the condition its script tests, and has done so since the script was written. A wrong instruction costs more than no instruction, because it is followed. |
| **A gate whose configuration is pinned and whose tool is not.** | `cargo install cargo-deny --locked` resolves to the newest version at run time; `deny.toml` has been frozen since 2026-04-09. The gate did not fail when the repo changed — it failed when *nothing* changed. |
| **Piping a checker anywhere.** | `/usr/bin/bash -e {0}` — GitHub's default `run:` shell, verified in this repo's own job log — has **no `pipefail`**, so `cmd \| tee f` exits with `tee`'s status. (`shell: bash` explicitly *does* add `-o pipefail`; the default does not. Do not assume.) |
| **Relying on fail-fast ordering to mean "the suite passed".** | `cargo test --workspace` stops at the first failing binary. A green-looking `personas-core` line and a red `personas-db` line say nothing whatsoever about `app_lib` — whose test binary was *built* on the same run. |
| **A byte-level parser that reads only the first record.** | Correct until the producer reorders. `sniffLibArchitecture` reads member #2 of 7 and is right; the two members it never reaches report `0x0000`. |
| **Deleting a cache you cannot rebuild offline.** | `clean-ort.mjs:46` removes the whole `%LOCALAPPDATA%\ort.pyke.io` tree, including the verified-good Microsoft payload and its sentinel. On a plane, that is unrecoverable until landing — and the fix it is supposed to enable (`ensure-ort-cache`) is a ~55 MB download. |
| **A `pre<script>` hook as the *only* place a repair happens.** | It is one `npx` away from not existing. `release.yml:319` is `tauriScript: npx tauri`, so no `pre*` hook has ever fired on a runner. |
| **Encoding cargo's internal `target/` layout in a new file.** | It is already encoded in five (`check-build-cache.mjs`, `clean-ort.mjs`, `ensure-ort-cache.mjs`, `cache-budget.mjs`, `release.yml`), and two of them carry **byte-identical** eviction regexes with a comment admitting the duplication (`ensure-ort-cache.mjs:260` — *"Mirrors clean-ort.mjs's logic"*). |

---

## §6 — Evidence

**The one site to copy: `scripts/check-build-cache.mjs`** (66 lines, whole file). It is
the smallest complete example of §2 in the repository:

- it detects a condition the compiler will report unintelligibly forty minutes later;
- it degrades to a no-op when its own precondition is missing (`:34-39`, no `rustc`) —
  **explicitly, with a reason**, rather than crashing on a frontend-only checkout;
- it seeds its own marker on first run (`:41-47`), so it is correct on a fresh clone;
- its failure output is four lines: what changed, from what, to what, and **the exact
  command to run**;
- and it costs one `rustc -vV`.

Second: **`ensure-ort-cache.mjs:379-435`** — the repair path. Verify the download's hash
*before* placing it (`:398-406`, with the reason stated: the library is statically linked
into a shipped exe), extract, copy, **re-sniff the result and `fatal()` if it is still
wrong** (`:430-433`), and only then write the sentinel. A repair that does not verify its
own output is a second way to be broken.

Third: **`run-rust-tests.mjs:100-129`** — `ensureManifest()` patches a binary **only if**
it lacks a manifest **and** imports the specific symbol, and says so in a comment
(*"Surgical on purpose: the extracted crates' test binaries do not import comctl32 at all
and must be left untouched"*). **Verified by execution over all 23 binaries in
`target/debug/deps`: 3 import the symbol, 20 do not** (§7.C). This is the shape to copy —
a repair whose precondition is read out of the artifact rather than assumed from its name.

**Live state, this machine, 2026-08-17** (the sweep's ground truth):

```
rustc 1.96.1 (31fca3adb 2026-06-26)   host: aarch64-pc-windows-msvc
src-tauri/target/.last-build-host  ->  aarch64-pc-windows-msvc      (agrees)

%LOCALAPPDATA%\ort.pyke.io\dfbin\aarch64-pc-windows-msvc\C09BFF…27DE\onnxruntime\
  .personas-ort-fix-applied  { source: "microsoft/onnxruntime-v1.20.0",
                               verified_machine: "arm64",
                               verified_at: "2026-05-14T10:24:34.926Z" }
  lib/onnxruntime.lib                 2,124 B      <- import library, arm64
  lib/onnxruntime.dll            11,785,760 B
  lib/onnxruntime.pdb           317,247,488 B      <- 98.6% of the tree (§7 F)
```

COFF archive parse of that 2,124-byte `.lib`, member by member:

```
#  name                size  first word   form
0  /                    248  0x0000       linker metadata (skipped)
1  /                    258  0x0005       linker metadata (skipped)
2  onnxruntime.dll/     509  0xaa64       long-form object   <- what the shipped sniffer reads
3  onnxruntime.dll/     254  0xaa64       long-form object
4  onnxruntime.dll/     294  0xaa64       long-form object
5  onnxruntime.dll/      50  0x0000       SHORT import member (SIG2=0xFFFF, machine=0x0)
6  onnxruntime.dll/      81  0x0000       SHORT import member (SIG2=0xFFFF, machine=0x0)
```

---

## §7 — Deviations

### 7.A — P0: two `cargo deny` gates, zero dependency policies ever evaluated

`src-tauri/deny.toml` declares an advisory policy (`vulnerability = "deny"`), a
14-entry license allowlist, `wildcards = "deny"`, and — the interesting one —
`[sources] unknown-git = "deny"` with `allow-git = []`, while `Cargo.lock:6011` carries
exactly one git source (`pumper-core`, behind the `scraper` feature). **None of that has
ever been checked.**

| Copy | What happens | Evidence |
|---|---|---|
| `.github/workflows/ci.yml:310-313` | `cargo install cargo-deny --locked` (→ **v0.20.2**), then `cd src-tauri && cargo deny check` → `error[unexpected-value]: expected '["all", "workspace", "transitive", "none"]'` at **`deny.toml:19:17`**, i.e. the value of `unmaintained = "warn"`. *"failed to deserialize config"*. | Verbatim in the Linux log of run `31720636200` (2026-08-13) and the Windows log of run `32025966929` (2026-08-17). `Check dependency policies` = `failure` in **9 of 9** sampled runs where the step executed. |
| `.github/workflows/audit.yml:37-44` | Weekly cron. The step is `cargo deny check 2>&1 \| tee security-results/cargo-deny.txt`, and it has **never executed**: `skipped` in **all 18 runs in which the step exists** (2026-04-20 → 2026-08-17), because an earlier step fails and the job has no `if: always()`. The workflow has **23** runs, all `failure`; the 5 oldest (2026-03-16 → 2026-04-13) predate the step entirely — verified by listing their step names. | Actions API sweep over every `audit.yml` run. |

And if it ever did run, it would pass regardless. The step has no `shell:` key, so it gets
GitHub's default `/usr/bin/bash -e {0}` — **without `pipefail`**, verified against the
`shell:` lines in this job's own log, where the repo's plain `run:` steps show
`-e {0}` and only the `dtolnay/rust-toolchain` composite (which sets `shell: bash`) shows
`-e -o pipefail`. `tee`'s status is the pipeline's status.

`deny.toml` last changed **2026-04-09**. The version key that broke is `unmaintained`,
whose *type* changed upstream from a severity to a scope enum. **Nothing in this
repository changed; the gate rotted because its tool was unpinned and its config was
not.** `docs/development/build.md:212` lists cargo-deny among the CI gates.

### 7.B — P0: CI compiles `app_lib` and never runs or lints it

Step-level from run `32025966929`, Windows leg, 2026-08-17:

| Step | Result |
|---|---|
| Run Rust tests (`cargo test --workspace --manifest-path … --features desktop`) | `Finished test profile … in 19m 35s`; **`personas_core-…exe` 760 passed / 0 failed**; **`personas_db-…exe` 808 passed / 10 failed**; `error: test failed, to rerun pass -p personas-db --lib`; **exit 1**. `personas-desktop (lib test) generated 159 warnings` appears in the compile phase — the binary exists. It is never spawned. |
| Run Clippy (`--workspace --features desktop -- -D warnings`) | 3 × `error: consider using sort_by_key`; `error: could not compile personas-db (lib) due to 3 previous errors`. `personas-engine` and `personas-desktop` depend on `personas-db`, so neither is reached. |
| Check dependency policies | 7.A. |

The same shape on Linux. **`app_lib` is 331,560 lines across 564 files** — 63% of the
Rust in the repository — and no CI job has ever executed one of its tests or linted one of
its files while `personas-db` has been failing.

This also inverts the standing read of the job's redness. `adding-a-ci-gate.md` records
the keyring `unwrap()` as the P0 and prescribes `PERSONAS_ALLOW_FALLBACK_KEY: "1"`. **That
fix has landed** — `ci.yml:235` and `:356` — and the job is still red for three
independent reasons, none of them the keyring: ten genuine `personas-db` test failures,
three clippy errors, and an unparseable `deny.toml`. Fixing a CI job whose failures
compose requires enumerating them, not iterating on the first one.

### 7.C — P1: the loader trap is unreached on CI, not absent from it

`run-rust-tests.mjs:17-24` records, in the file itself, an unresolved question:

> *"either that leg is red, or the trap does not reproduce on the runner … Not resolvable
> without compiling, and cargo runs are guarded on this machine — flagged rather than
> guessed."*

Settled from the runner's log: **neither disjunct.** The leg is red, and the trap could not
have fired, because cargo's fail-fast stopped before the only test binary in the workspace
that links tauri's dialog path. Searched: `0xc0000139` — **0 occurrences** in 5,809 lines;
`comctl32` / `TaskDialogIndirect` — **0**. The Windows leg is **no evidence in either
direction.**

And it *was* resolvable without compiling — the repo already ships the instrument, and
running it over the 23 executables in `src-tauri/target/debug/deps` partitions them
exactly:

| Binary | manifest | imports `TaskDialogIndirect` |
|---|---|---|
| `personas_desktop.exe` (the app) | embedded | **yes** — tauri-build put it there |
| `app_lib-44a183ca3221a899.exe` | embedded | **yes** — patched by `ensureManifest()` |
| `app_lib-a6c1208621ddd9ce.exe` | **NONE** | **yes** — *this file, on disk today, exits `0xc0000139` before `main()`* |
| the other 20 (`personas_core` ×2, `personas_db` ×3, `personas_engine` ×2, `render_plan_*` ×5, `*_bindings_gen` ×3, `athena_bench_validate` ×2, `personas_mcp` ×2, `personas_desktop-…` ×1) | mixed | **no** — none imports comctl32 at all |

So three claims are confirmed by execution rather than by reading: **the trap is real**
(an unpatched binary is sitting there); **`ensureManifest()`'s "surgical on purpose" scope
is 20/20 correct** — the extracted crates' test binaries genuinely do not import comctl32,
so patching them would have been gratuitous; and **`cargo:rustc-link-arg-tests` would not
have helped**, because the five `render_plan_*` integration binaries (the only ones that
flag reaches) are not in the affected set either. The reasoning at `:26-38` for keeping
this out of `build.rs` is sound and is now measured.

*This is a correction owed to a comment, not a defect in the fixup.*

### 7.D — P1: `docs/development/build.md` — six claims that do not survive a read

The document is the operational reference the troubleshooting section defers to. Audited
line by line:

| Line | Claim | Measured |
|---|---|---|
| `:178-181` | *"**If the cache is correct for the host or absent**, downloads Microsoft's official ONNX Runtime … and places it into pyke's expected cache slot."* | **Inverted.** The script downloads when the cache is **wrong** or absent; when it is correct it exits 0 at `:356` (fast-path A) or `:373` (fast-path B). As written the document describes a script that re-downloads 55 MB on every successful run. |
| `:197-199` | *"CI builds run on x64 `windows-latest` runners … the fix script is a no-op there — but **it still runs as a guard**."* | It does not run at all. `release.yml:319` is `tauriScript: npx tauri`, which is not an `npm run`, so no `pre*` hook fires (established by [`bundling-native-assets`](./bundling-native-assets.md) B2). And there are **two** Windows legs, not one: `release.yml:214-222` has `x86_64-pc-windows-msvc` **and `aarch64-pc-windows-msvc`** — the arm64 target the mislabeled tarball breaks. The same document says so itself at `:112-116`. |
| `:46` | *"**Three** Tauri configs in `src-tauri/`"*, table of three. | **Five** tracked (`tauri.conf.json`, `.lite`, `.stable`, `.android`, `.tauri-scraper-dev.conf.json`) plus two generated families. `tauri.android.conf.json` is absent from the table. See [`tauri-config-variants`](./tauri-config-variants.md). |
| `:21` | *"`npm run check:tauri-configs` — validates **the three** `tauri.conf.json` files"* | Accurate about the script and wrong about the world; the script reads 3 of 5. |
| `:79-85` | Codegen task list: `commands`, `i18n`, `connectors`, `checksums`, `host-check`. | `run-codegen.mjs`'s `TASKS` has **15** entries; `predev` runs **14**, `prebuild` runs **14**. The document names **5**. |
| `:4`, `:229` | links to `DEVELOPMENT.md` and `ANDROID-BUILD.md` | The files are `docs/development/development.md` and `docs/development/android-build.md`. **Both 404ed on github.com.** Repo-wide there were exactly **5** such case-only broken links and **2 of the 5 were in this file** — see §9 for why no existing instrument sees them. **All 5 fixed in this pass** (documentation only); re-scanned to 0. |

`:212` (*"rust-tests — `cargo test` + clippy + cargo-deny"*) is not wrong about the
configuration; it is wrong about the outcome (7.A, 7.B).

### 7.E — P1: `host-check` runs on the path that cannot produce the error it detects

`run-codegen.mjs:78-79`:

- `predev` → `[…, "host-check", …]` (14 tasks)
- `prebuild` → `[…, "checksums", …]` — **no `host-check`** (14 tasks)

`tauri.conf.json:9-10` wires `beforeDevCommand: "npm run dev"` (→ `predev`) and
`beforeBuildCommand: "npm run build"` (→ `prebuild`). So the detector for
`lld-link: machine type x64 conflicts with arm64` — **a link error, which only happens
during a build** — is absent from every build path: `npm run build`, `npm run tauri:build`,
`tauri:build:lite`, `tauri:build:stable`, and all three tier bundles.

`build.md:84` documents the asymmetry (*"`host-check` (predev only)"*), so this is not
hidden. It is simply the wrong side. The cost of adding it to `prebuild` is one `rustc -vV`.

Related and smaller: `build.md:98-100` says the marker is written *"after each successful
run"* of the build. It is written at the end of `check-build-cache.mjs` itself
(`:66`), which is **before** cargo starts. The guard still holds — a drifting run exits 1
at `:62` without writing — but the marker records *"the last host `predev` saw"*, not
*"the host of the last successful build"*, and a reader debugging a contaminated tree will
reason from the wrong meaning.

### 7.F — P2: 317 MB of debug symbols in a vendored cache, on every developer machine

`ensure-ort-cache.mjs:422` — `copyTree(innerLibDir, libDir(target))` — copies Microsoft's
entire `lib/` directory out of the release zip. Measured on disk:

| File | Bytes | Needed by the build |
|---|---:|---|
| `onnxruntime.pdb` | 317,247,488 | no — MSVC debug symbols for a prebuilt DLL |
| `onnxruntime.dll` | 11,785,760 | yes (copied next to the exe by `ort`'s `copy-dylibs`) |
| `onnxruntime_providers_shared.dll` | 21,024 | yes |
| `onnxruntime_providers_shared.pdb` | 405,504 | no |
| `onnxruntime.lib` | 2,124 | yes (import library) |
| `onnxruntime_providers_shared.lib` | 2,314 | yes |

**98.6% of the cache is two `.pdb` files.** A one-line filter in `copyTree`'s call would
reclaim it, and the leaf's own `cost` dimension is exactly this. *Not applied* — it is
build tooling whose first run touches a cache `npm run tauri:dev` depends on. Registered.

### 7.G — P2: the cleaning ladder is documented three times, three ways

| Source | Ordering it gives |
|---|---|
| `check-build-cache.mjs:52-61` (the failure the user actually sees) | `npm run clean:rust` only. Never mentions `clean:ort`. |
| `.claude/CLAUDE.md` § *"When builds get slow or break"* | `clean:ort` (surgical, ~5 min) **then** `clean:rust` (nuclear, ~10 min). Correct. |
| `docs/development/build.md:103-105` | `clean:rust` **then** `clean:ort`, with `clean:ort` annotated *"(often enough)"* — an unsupported claim, since `clean:ort` evicts only `ort`/`ort-sys` artifacts and the documented contamination (`:92-96`) is over `deps/` generally. |

The one a stuck developer reads first is the failure output, and it names the most
expensive rung.

### 7.H — P3: `clean:ort` is a Windows-only script that reports success everywhere

`clean-ort.mjs:44-47`:

```js
const ortCache = join(homedir(), "AppData", "Local", "ort.pyke.io");
if (process.platform === "win32") rmIfExists(ortCache);
// macOS/Linux ort cache locations vary; ort respects ORT_OUT_DIR env var.
```

On macOS/Linux the script removes only the cargo-side artifacts and prints
`clean-ort: removed N path(s)` — a success message for half a job. The comment is honest;
the output is not. Same shape as the ORT fix itself, which `exit 0`s on any non-Windows-MSVC
host (`ensure-ort-cache.mjs:313-316`). The whole apparatus is a Windows apparatus, which is
correct for this operator and invisible to anyone else.

---

## §8 — Gaps

1. **No instrument can tell a stale artifact from a fresh one when the artifact is a full
   materialization.** The clearest case is next door: `src-tauri/gen/android/**/tauri.conf.json`
   is a merged Tauri config that reads as authoritative and is **161 days and 30 commits
   stale** (`version: 0.1.6` against today's `1.1.0`). See
   [`tauri-config-variants`](./tauri-config-variants.md) §7.A. Nothing in a build cache
   carries its own provenance, which is why the ORT sentinel — a file whose entire purpose
   is to record *when* and *from where* — is the right pattern and the exception.
2. **A cross-architecture repair cannot be expressed by a host-scoped script.**
   `ensure-ort-cache.mjs:318` is `const target = host;`. A cross-compile
   (`--target aarch64-pc-windows-msvc` from an x64 host, which is exactly
   `release.yml:220-222`) needs the *target* slot repaired, and the script has no way to
   learn the target because it runs before cargo and outside it. Established in
   [`bundling-native-assets`](./bundling-native-assets.md) B1; restated here because it is
   the single largest hole in this leaf's machinery and the fix is not a one-liner.
3. **cargo cannot be asked "did every test binary run?"** `cargo test` fail-fast is the
   default and `--no-fail-fast` changes the exit semantics, not the reporting. There is no
   flag that answers *"which targets did you build and not execute?"* — 7.B was findable
   only by reading a log and noticing an absence. A harness that enumerates
   `compiler-artifact` executables and then asserts each one produced a `test result:` line
   would close it; `run-rust-tests.mjs:131-179` already parses exactly that JSON stream and
   is two lines from being able to.
4. **The census cannot express any of this leaf's findings** — see §9. Every one is an
   absence (a step that never ran, a preset that lacks a task, a binary that was not
   executed) or a semantic inversion (a document that states the negation of its script).
   Both are invisible to a pattern that counts occurrences of something present.
5. **Windows exit codes are not distinguishable from shell exit codes.** `run.status === 127`
   and `run.status === 0xc0000139` are both checked at `run-rust-tests.mjs:228` because Node
   surfaces the NTSTATUS differently across spawn paths. There is no portable way to ask
   "did this process fail to load?", which is why the folk knowledge exists at all.

---

## §9 — The missing gate: a decline, with the numbers

**No census rule is proposed for this leaf.** Four candidate signals were built and
measured. Each is reported with the number that killed it, because a refusal without
numbers is an opinion.

| # | Candidate signal | Measured | Verdict |
|---|---|---|---|
| 1 | **A `npm run X` in prose where `X` is not in `package.json`.** | 1,180 mentions across 1,397 markdown files; **1,155 resolve, 25 do not** (2.1%), and the misses are dominated by *proposed* commands inside golden-path §9 sections (`npm run gen:api`, `npm run check:traces`) plus sibling-repo commands. | **Reject.** Precision would be under 30% against the intent, and the population is majority-prescription. |
| 2 | **A `scripts/…` path cited in markdown that does not exist.** | Impl A (fs walk, `fs.existsSync`): **115 dangling / 1,012 citations**. Impl B (git index, backtick-anchored, operational docs only): **3 dangling / 100**. The 38× spread is scope, not error — A counts `_archive/` and golden-path proposals. | **Reject.** The honest operational population is 3 sites; a census rule over 3 matches breaks on the first deletion. |
| 3 | **A CI step that pipes a checker into `tee`/`grep`/`head`.** | **1 site** in 7 workflows + `.gitlab-ci.yml` + `lefthook.yml` (`audit.yml:44`). | **Reject on population.** Kept as a §7 finding — and note the mechanism check that nearly went the other way, below. |
| 4 | **A markdown link whose target exists only under a different case.** | **5 sites repo-wide**, 2 of them in `docs/development/build.md`. | **Reject as a census rule** — and this one is instructive: the condition is *not expressible as a regex over file content at all*, because deciding it requires a case-sensitive filesystem listing. It is a different instrument, specified below. |

**What the fifth failure mode looks like here.** Candidate 3 was very nearly published as
*"a pipe erases the checker's exit code"* — the campaign's own runbook says so. It is
**false on this runner and true elsewhere**: GitHub's default `run:` shell is
`/usr/bin/bash -e {0}` for a step with no `shell:` key, and
`/usr/bin/bash --noprofile --norc -e -o pipefail {0}` when `shell: bash` is set explicitly.
Both strings appear in one job's log. A gate keyed on "there is a pipe" would fire on
correct `shell: bash` steps and would have been justified by a rule that is only sometimes
true. The condition is *"a pipe in a shell without `pipefail`"*, and the shell is not
visible at the pipe.

**The instrument that would work, specified.** Not a counter — an **executable-claims
checker**, `scripts/check-build-claims.mjs`, run from `npm run check`:

1. **Parse the recovery commands out of the operational docs** (`docs/development/build.md`,
   `.claude/CLAUDE.md` § *When builds get slow or break*) — every ` ``npm run X`` ` and
   every backticked `scripts/…` path — and assert each resolves. Fail with the doc's
   `file:line`.
2. **Assert every relative `.md` link resolves against a case-sensitive listing**
   (`git ls-files`, never `fs.existsSync` — see the note below). Catches candidate 4 at
   100% precision by construction: the file provably exists, only the spelling is wrong.
3. **Assert task-preset symmetry**: every `run-codegen.mjs` `TASKS` key appears in at least
   one preset, and every task whose *stated purpose* is a build precondition appears in
   `prebuild` as well as `predev` (7.E). A hardcoded two-name allowlist (`checksums`,
   `host-check`) with a written reason, so a third asymmetry has to be argued for.
4. **Assert the gate configs still parse against the pinned tool** — for `deny.toml` that
   means pinning `cargo install cargo-deny --version <x>` and letting the version bump be
   a reviewed diff, which turns 7.A from an invisible rot into a PR.
5. **Fail loudly on empty input.** Exit **2** if step 1 finds fewer than 20 commands or
   step 2 fewer than 1,000 links — the counts are 1,180 and 4,499 today, so a matcher that
   silently stops matching cannot read as a clean run. This is the precondition
   `scripts/check-csp-hosts.mjs` earned the hard way and `check-corpus-integrity.mjs`
   copied.

**And the instrument-assertion this leaf contributed.** Step 2's oracle is load-bearing
and non-obvious: **`fs.existsSync` on Windows is case-insensitive.** The first
implementation of candidate 4 used it and reported **0** case-only broken links; the same
scan against `git ls-files` reported **5**. Two implementations, one number each, and the
disagreement *was* the finding — the developer machine cannot see the defect that only
manifests on the filesystem the documentation is published to.

**Existing rules checked for overlap** (none proposed, so overlap is informational):
`machine-specific-path-in-tooling` (`adding-a-ci-gate`) already owns absolute host paths in
build scripts; `build-gated-ipc-entrypoint` (`feature-flagged-compilation`) owns
`#[cfg(feature)]` around IPC entry points; `unverifiable-generated-artifact` and
`verifiable-generated-artifact-positive-control` (`codegen-task-registration`) own the
`run-codegen.mjs` registration surface; `gate-without-empty-input-guard`
(`cross-artifact-drift-gate`) owns the empty-input precondition. Candidate 1's site set is
a **superset** of the `scripts/*` citations `check-doc-map-paths.mjs` validates, but that
script reads only `feature-doc-map.json`'s globs (`scripts/docs/check-doc-map-paths.mjs:23`)
and never prose — so there is no overlap, only a gap.

---

## §10 — Convergence

Cohort established for this leaf, at measurement time: `../personas-web`, `../brainiac`,
`../personas-cloud`, `../vibeman`, `../ascent`. **All six repositories, this one included,
have one author** — so agreement is the weakest signal available and is reported as one
engineer's repeated choice, never as physics.

- **Silence, and it is the strong kind.** No sibling has a `pre*` hook that repairs a
  vendored native artifact, because no sibling *has* a vendored native artifact — the
  Node/Next.js siblings' worst build failure is a lockfile, and `brainiac` is Rust without
  an ONNX-class dependency. `ensure-ort-cache.mjs` has no counterpart anywhere in the
  fleet. **This is Personas ahead of the fleet, stated as self-comparison**, and it is
  ahead because it is the only repo with the problem.
- **The spine's `convergence: converged` label fails here**, and it fails in the mode the
  doctrine already catalogued: *the fleet converged on not having the problem.* An oracle
  that counts agreement reads five silences as five confirmations. Ask what the siblings
  agreed *to do*, and the answer is "nothing, because nothing was required of them".
- **`sides: server` holds, for a structural reason.** Every artifact in this leaf — the
  cargo target directory, the COFF archive, the toolchain triple, the workflow log — exists
  before a renderer is started, and the one frontend-adjacent item (`strictPort: true`) is
  a *server* configuration for a dev server. There is no client half to report. That makes
  this one of the small number of leaves whose `sides` label survives testing, and the
  doctrine asks that the mechanism be named when it does: **the browser never sees a link
  error.**
- **Cost, not agreement, is the evidence worth carrying.** `../vibeman` — this repo's
  ancestor, dated on two independent leaves — has no host-drift marker and no vendored-binary
  verification, and it also has no native build. It is not a witness for or against; it is
  a repo that never paid this cost. Report the silence as silence.

---

## §11 — What this costs if ignored

The measured price of the current state, in the units the leaf's dimensions name:

- **resilience** — 300 consecutive `ci.yml` runs with **zero** successes; the supply-chain
  policy has been unevaluated for the entire life of `deny.toml`; 63% of the Rust in the
  repository is untested by any automated lane.
- **performance** — `personas-db`'s 818-test binary takes **1,571 seconds** on the Windows
  runner, and everything downstream of it is blocked behind that wall whether it passes or
  not.
- **cost** — `src-tauri/target` is **26 GB** on this machine (the `cache-budget.mjs` default
  ceiling is 80 GB, and it is advisory: `:439`, *"guard is advisory: it must never fail the
  build"*); 317 MB of unused debug symbols per developer machine in the ORT cache; and a
  `clean:ort` that throws away a 55 MB verified download in order to fix a problem the
  download already fixed.

---

## §12 — Corrections to the brief, and to published paths

**12.1 — To my brief: *"a corpus of hard-won troubleshooting knowledge that has never been
audited against the tree … verify each — a troubleshooting doc that has drifted is worse
than none."*** The premise is right and **the prediction is wrong**. Audited entry by
entry, `.claude/CLAUDE.md`'s five entries are the most accurate prose in this sweep: the
ORT story matches the script and the bytes on disk; the port-1420 advice matches
`strictPort: true`; `clean:ort` and `clean:rust` do what it says and in the order it gives;
the `predev` host-check claim is exact. The drift is in `docs/development/build.md`
(7.D, six defects) and in the CI gates (7.A, 7.B) — **the formal artifacts, not the folk
knowledge.** The brief's own framing predicted the opposite, and so did I when I started.

**12.2 — To my brief's `pretauri:*` hypothesis.** I expected to find missing pre-hooks on
the `:lite` variants and found the coverage **exactly correct**: the five entry points with
a `pretauri:*` hook are the five that compile `ml` (`tauri:build`, `tauri:build:stable`,
`tauri:dev`, `tauri:dev:stable`, `tauri:dev:test:full`); the three without one
(`tauri:build:lite`, `tauri:dev:lite`, `tauri:dev:test`) all resolve to
`--features desktop`, which does not build `ort`. A cleared hypothesis is worth recording
because the obvious finding here is a false positive.
([`bundling-native-assets`](./bundling-native-assets.md) reached the same five
independently.)

**12.3 — To `scripts/build/run-rust-tests.mjs:17-24`.** Its recorded correction offers two
possibilities and the truth is a third: the Windows leg is red **before** the app_lib test
binary is reached. Amend the comment to say *"unreached on the runner"* rather than leaving
a disjunction a future reader will resolve by picking one. (§7.C.)

**12.4 — To [`adding-a-ci-gate`](./adding-a-ci-gate.md), around its P0.** It reads
*"`cargo clippy` and `cargo deny` run `if: always()` and fail alongside it, so the job is
red three ways at once and no single failure is legible"* — attributing all three to the
keyring. Two amendments: (a) `PERSONAS_ALLOW_FALLBACK_KEY: "1"` **is now set**
(`ci.yml:235`, `:356`) and the job is still red; (b) `cargo deny` does not fail *alongside*
anything — it fails at `deny.toml:19:17` for a reason that has nothing to do with this
repository's code and would persist on a perfectly green tree. Its prescription (*"split
clippy and cargo-deny into their own jobs"*) is right and is now supported by a second,
independent argument: **the three failures are not one failure wearing three hats.**

**12.5 — To `docs/development/build.md:178-181`, `:197-199`, `:46`, `:79-85`, `:4`, `:229`.**
Six corrections, listed in 7.D. The inverted condition at `:178` is the one to fix first,
because it is the only one that will actively mislead someone mid-incident. The two
case-broken links are applied fixes (documentation only).

**12.6 — A measurement of my own that had to be re-run.** My first pass at "which features
does each crate declare" used `new RegExp('^\\[' + name + '\\]([\\s\\S]*?)(?=^\\[|$)', 'm')`
and reported **`declared=[]` for all five crates**, which would have made every one of the
701 `#[cfg(feature = …)]` mentions in the tree read as undeclared. The cause is that `$`
under the `m` flag matches an end-of-*line*, so the lazy body matched empty immediately.
The shipped code I was cross-checking (`check-tauri-configs.mjs:54`) uses `(?=^\[|\Z)` —
where `\Z` is a JS identity escape for the literal `Z`, which *looks* like the same bug and
is not, because the `^\[` alternative fires first on this file. **Two implementations
disagreed and the bespoke one was wrong**; the shipped one is correct, verified by
replaying it. Recorded because the doctrine's rule is symmetrical and this is the direction
it is usually not applied in.

**12.7 — Convergent discovery, and the one number two independent sweeps disagreed on.**
A sibling composer in this same wave, working the `supply-chain-policy` leaf, found the
cargo-deny defect independently and hours apart. The two accounts agree on everything that
matters: `deny.toml:19:17`, `unmaintained = "warn"`, cargo-deny **v0.20.2**, `--locked`
pinning the lockfile and not the version, and `audit.yml` never reaching the step. **Two
artifacts arriving at one set of numbers by different routes is what verification looks
like**, and the corpus should say so as loudly as it says a disagreement.

They disagree on one denominator, and the disagreement is worth keeping. Register #106
states the `audit.yml` step is `skipped` on *"23 of 23 lifetime"* runs. Stepping through all
23 by name: the workflow has 23 runs, **all `failure`**, but the cargo-deny step **exists in
only 18** (from 2026-04-20) and is `skipped` in all 18; the 5 runs from 2026-03-16 to
2026-04-13 have no such step — their step lists end at *Run security audit* → *Upload audit
results*. The conclusion survives untouched, because a step that does not exist also renders
no verdict. But *"skipped 23 of 23"* is not what the API says, and a later reader auditing it
finds 5 runs that appear to contradict the entry. Corrected in the register at #89. **Same
conclusion, different denominator: report the disagreement, do not pick the rounder
number.**

**12.8 — A `jq` selector that answered a different question.** Sampling the `audit.yml`
cargo-deny step, `select(.name|contains("cargo-deny"))` matched **two** steps — *Install
cargo-deny* and *Check dependency policies (cargo-deny)* — and printed
`success\nskipped`. Read as one line, that says the gate passed. It says the installer
passed. Same family as the doctrine's `head -3` case: **the selector was wider than the
question and the output did not say so.** The sweep was re-run with `.name == "Check
dependency policies (cargo-deny)"` and returned `skipped` for all 18 runs that have the
step.
