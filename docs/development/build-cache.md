# Build cache management

Keeping every cargo target this project grows — `src-tauri/target`, the alternate
targets, agent worktrees and targets left in `%TEMP%` — under a **60 GiB budget
that is enforced**, not announced.

## Why this exists

Cargo **never garbage-collects `target/`**. This crate compiles under four
profiles (`dev`, `test`, `release`, `stable`) and more than one
target triple (x64, ARM64, Android), each writing a full artifact set, on top
of an `incremental/` cache that only ever grows. Left unattended the main
`src-tauri/target` reached **324 GB**.

There is a second multiplier: every agent worktree under `.claude/worktrees/`
is a full git checkout, and Cargo defaults the target dir to the worktree
root — so each worktree compiles its own independent `target/` (5–20 GB
apiece). Eighteen worktrees added another **~74 GB**.

### A warning is not a budget (why v2, 2026-09-18)

v1 had an 80 GB "budget" that nothing enforced. Its only automatic lever was a
self-heal in the build guard that fired at a **150 GB hard ceiling** and pruned
only `incremental/`. Between 80 and 150 GB sat a dead band in which the guard
printed a line and deleted nothing. That is how it **warned all the way to
293 GB** once before anyone ran `--enforce`, and how one real **ENOSPC truncated
a source file**.

Measured 2026-09-18, the day v2 was written:

| | |
|---|---|
| `src-tauri/target/debug` | 94.85 GB = 88.3 GiB = **110 % of the 80 GiB budget**; bytes ever evicted automatically: **0** |
| `deps/` | 41 GB — **1,766 hash-sets of `personas_db`, 1,659 of `personas_engine`**. Cargo never reaps a superseded hash |
| `incremental/` | 46 GB across 116 session dirs, oldest 13 d |
| `build/` | 6.5 GB, no reaper at any tier |
| the guard's snapshot | 12 h old, reading 99 % while reality was 110 % |
| targets the budget could not see | `src-tauri/target-clippy`, `src-tauri/target-bindings`, `.personas-e2e-target`, `.rp-check-target`, and cargo targets unattended workers leave in `%TEMP%` (9 GB measured 2026-09-14) |

v2: the budget is **60 GiB across every discovered target combined**, it is
enforced **at the budget**, eviction is **age-first**, it is triggered by the
predev/prebuild guard **and** a daily scheduled task, and **every eviction is
logged with bytes and reason**.

## Quick reference

```bash
npm run cache:report        # every discovered target: label, kind, bytes. Never deletes.
npm run clean:cache         # enforce the budget now (asks on a TTY; --yes / --dry-run)
npm run clean:incremental   # drop the main target's incremental/ caches
npm run hygiene:run         # the daily job, now (-- --dry-run to preview)
npm run hygiene:log         # last 20 evictions + bytes freed in the last 30 days (-- 100 for more)
npm run hygiene:install     # register the daily Windows task   (hygiene:uninstall removes it)
npm run clean:worktrees     # GC stale agent worktrees (dry-run by default)
npm run clean:temp          # sweep %TEMP% (dry-run by default)

npm run build:disk          # every build cache by SIZE AND AGE, incl. ones the budget cannot see.
                            #   -- --json | --verify (measure twice) | --only <substr> | --reap
npm run ensure:sccache      # provision the shared, 20 GiB-capped compilation cache
                            #   -- --restart (re-cap a server started without the budget)
```

`CACHE_BUDGET_GB` (default `60`, GiB) changes the budget. `CACHE_AUTO_PRUNE=0`
makes the build guard advisory-only. `CACHE_HARD_CEILING_GB` (default `150`)
survives only as a second-line **alarm**: past it the guard's line turns red and
says enforcement is failing to hold the budget. It no longer gates anything —
the dead band is gone.

## What is counted — `scripts/hygiene/targets.mjs`

One discovery module feeds the enforcer, the daily task and `cache:report`.

| kind | where |
|---|---|
| `main` | `src-tauri/target` |
| `alternate` | `src-tauri/target-clippy`, `src-tauri/target-bindings`, `.personas-e2e-target`, `.rp-check-target` |
| `worktree` | `.claude/worktrees/*/src-tauri/target` and each worktree's own alternates |
| `worktree-shared-build` | `.claude/worktrees/.cargo-build` — nothing creates it today (the shared build-dir was rejected); counted if it ever appears. See [Sharing build output](#sharing-build-output-across-worktrees) |
| `temp` | any directory at depth ≤ 2 under the temp dir holding **both** `CACHEDIR.TAG` and `.rustc_info.json` (recognised by content, not by name) |

The `%TEMP%` walk is bounded (depth 2, **50,000** directories — `%TEMP%` here has
held ~70,000 entries, and the first real v2 measurement stopped at an earlier
20,000 cap). Hitting the bound prints one line: a capped walk is "could not
check", and silence would dress it as "clean".

### Targets the list still cannot see — measured 2026-10-07

`ALTERNATE_TARGETS` is a **name list**, so a target under a name nobody added is
counted by nothing and reaped by nothing. Measured with `npm run build:disk`
(robocopy `/L`; see [build-disk](#build-diskmjs--disk-forensics-and-the-orphan-worktree-reaper)):

| cache | size | age | counted by the budget? |
|---|---|---|---|
| `src-tauri/target` | **49.43 GiB** | 0 h (building) | yes — `main` |
| `.claude/worktrees/prototype-contact-sheet/src-tauri/target-wt1` | **16.01 GiB** | 12 d | **no** |
| `src-tauri/target-wt` | **14.10 GiB** | 12 d | **no** |
| `.claude/worktrees/prototype-athena-chat/src-tauri/target-wt` | **14.06 GiB** | 13 d | **no** |
| sccache store (`%LOCALAPPDATA%/Mozilla/sccache/cache`) | 0 B, not created yet | — | no, and correctly so — it caps itself |
| | **93.60 GiB total** | | of which the budget can see **49.43 GiB** |

So the enforced "60 GiB across every discovered target" is, today, a budget over
**53 %** of the build disk. **44.17 GiB sits under three `target-wt*` names the
discovery module has never heard of**, and no worktree in this checkout has a
plain `src-tauri/target` at all — the two prototype worktrees' build output lives
entirely under those unknown names.

`build-disk.mjs` finds them **by content**: any `src-tauri/target*` directory
holding both `CACHEDIR.TAG` and `.rustc_info.json`, which is `targets.mjs`'s own
`isCargoTargetRoot` predicate applied over a glob instead of a list. It marks each
such row `NOT COUNTED BY THE BUDGET` and does nothing else about it — teaching
`targets.mjs` the glob is a change to the enforcer, and the enforcer deletes
things. That is a deliberate, separate decision, and it is not this script's to
make.

## Eviction order — and why

Ordered by **rebuild-seconds-saved per MB**: stale variant state first, hot
third-party dependency artifacts **last**. It stops the moment the footprint is
under budget, and inside every stage the oldest goes first.

| | category | what | why it is cheap to lose |
|---|---|---|---|
| a | `deps-superseded` | Old `<crate>-<hash>` sets of **this workspace's own crates** in `<profile>/deps/` (`.d .rmeta .rlib .o .pdb .lib .dll .exe`, with and without the `lib` prefix) plus their `.fingerprint/<package>-<hash>` dirs. Keeps the newest **3** sets per crate **per shape** (check / lib / bin) — `KEEP_HASH_SETS` in `cache-budget.mjs`. | Workspace crates are recompiled on every edit and each compile leaves a set nothing removes; only the newest is ever reused. Crate names are **derived from `src-tauri/Cargo.toml`** (members → package, `[lib]`, `[[bin]]` names), so a third-party crate can never match. |
| b | `incremental` | `incremental/` session dirs. | A pure rebuild accelerator. |
| | | (a) and (b) run for artifacts **> 3 days** old, then **> 1 day**, then (a) at any age. | |
| c | `cargo-sweep` | `cargo sweep --time 7`, when [`cargo-sweep`](#optional-cargo-sweep) is installed. | The first stage allowed to touch third-party artifacts — and only ones unused for a week. |
| d | `build-orphan` | `build/<name>-<hash>` out-dirs with no `.fingerprint/<name>-<hash>`. | Cargo can no longer reach them. |
| e | `worktree-target` | **Manual `clean:cache` only:** whole worktree target dirs, oldest first. | Regenerates on that worktree's next build. Never automatic: it costs an agent a cold build. |
| f | — | Nothing safe is left: it says a stale profile dir or `npm run clean:rust` is needed. **`cargo clean` is never run automatically.** | |

**Why 3, and why per shape.** "Newest by mtime" only approximates "current":
cargo never bumps an artifact's mtime when it *reuses* it. Verified read-only on
the real tree, 2026-09-18: a build at 19:33 re-validated `personas-core` and
`personas-db` as fresh, and every file in their `.fingerprint` dirs kept its
19:06–19:08 build time — so neither `deps/` nor `.fingerprint/` mtimes say "in
use", and no fingerprint-recency rule was added on top. The keep count therefore
has to cover every hash that is legitimately live at once: the repo has three
lanes (`desktop`, `desktop-full`, `+test-automation`), each with its own valid
hash per crate — hence **3**. And it is counted **per shape**, because a
`cargo check` set (`.rmeta` only) and a `cargo build` set of the same crate are
both current; a plain newest-N would let fresh build sets evict the live check
set. Too shallow a window is not hypothetical — see
[the incident](#incident-2026-09-18).

**Recovery from any eviction is one warm rebuild.** Third-party deps survive
stages a, b and d entirely, so that rebuild recompiles workspace crates only.

## What it refuses

The reaper checks that no build is live **before every stage and every deletion
batch**, per profile dir:

1. **Lock probe.** Cargo holds an exclusive byte-range lock on
   `<profile>/.cargo-lock` (also `.cargo-build-lock`, `.cargo-artifact-lock`) for
   the whole build. Those files always *exist*, and a locked file still *opens*
   for write on Windows, so neither is a signal. Measured 2026-09-18: a 1-byte
   **read** at offset 0 fails with `EBUSY` while the lock is held and returns 0
   bytes when free, and mutates nothing. That read is the probe. (POSIX `flock`
   is invisible to it; there only check 2 applies.)
2. **Incremental mtime.** Any incremental *session* dir touched in the last 90 s.
   Deliberately not process enumeration — `tasklist`/`Get-Process` crawl or hang
   under this repo's thousands of node processes. (v1 also stat'ed `incremental/`
   itself; deleting a session bumps that parent's mtime, so the reaper's own
   first eviction made it refuse itself for 90 s. v2 stats session dirs only.)

A probe that fails in any way it does not understand counts as **live**. Each
refusal prints its reason (`refused main — .cargo-lock is locked by a running
cargo (EBUSY)`).

**"Could not check" is never "clean".** A target that exists but cannot be
listed is `UNMEASURED`, not 0 bytes (v1 returned 0 — an unreadable 95 GB tree
read as an empty one). The total is then a *lower bound*: `clean:cache` exits
**non-zero**, the daily task exits 2, and the guard prints an advisory **with the
reason** and exits 0. None of them ever print "under budget" about something
they did not measure.

## The three triggers

### 1. Build-time guard — `node scripts/cache-budget.mjs` (argless)

`run-codegen.mjs` runs it in `predev` and `prebuild`. It **never fails or blocks
a build**.

- Common path: read `.claude/.cache-budget.json`; if the snapshot is fresh
  (< 6 h), complete, and **under 80 % of budget → exit silently.** No directory
  walk, no child process, no `git`: ~65–105 ms over node startup (measured
  2026-09-18; the `git rev-parse` v1 used for the repo root cost 500–900 ms on a
  loaded host and is now only a fallback).
- Otherwise — snapshot ≥ 80 %, stale, incomplete, missing, or written by v1 — it
  hands a **fresh measurement + enforcement** to a detached background process,
  prints **one line** saying so, and exits 0. A fresh walk of this tree takes
  minutes; predev does not wait for it.
- The background half is single-instance (`.claude/.cache-budget.lock`), logs
  with trigger `guard`, and while a build holds the target it re-tries every 60 s
  for up to `CACHE_GUARD_WAIT_MIN` (default 20) minutes — `tauri dev` takes the
  cargo lock seconds after predev, and releases it once the app is running.
- **A worktree's copy of the guard only advises** — enforcement comes only from
  the main checkout's guard, the daily task, or an explicit `clean:cache`. See
  [the incident](#incident-2026-09-18) for why.

### 2. Daily task — `scripts/hygiene/run-daily.mjs`

The lever that fires when nothing goes through npm (agents calling cargo
directly; days with no dev server). One run, in order:

1. `temp-target`: cargo targets in `%TEMP%` whose **newest file** is older than
   24 h and that **no running process names** — `temp-gc.mjs`'s predicate,
   imported, not copied. If processes cannot be listed, nothing is removed. This
   runs **first**, so the enforcer's discovery walks and budgets only what
   survived.
2. Budget enforcement over **all** discovered targets (trigger `daily`) — stages
   a–d above.
3. `worktree-target`: worktree GC with `worktree-gc.mjs`'s existing predicate
   only — **clean + merged + older than 14 d**. `worktree-orphan`: a directory
   under `.claude/worktrees/` that `git worktree list` does not know **and that
   is completely empty** is removed (`rmdir`, non-recursive). An orphan with
   **any** content is reported and never removed.
4. `root-residue`: `build-*.log`, `*.stackdump`, `response*.txt` at the repo
   root, older than 14 d and **verified untracked** per file
   (`git ls-files --error-unmatch`). A tracked file, or one whose tracked-ness
   could not be checked, is never deleted. Skipped while the main target builds.

Install / inspect / remove:

```bash
npm run hygiene:install                                   # schtasks /Create /F — idempotent
node scripts/hygiene/install-task.mjs --install --time 04:30      # override the 12:30 default
node scripts/hygiene/install-task.mjs --status            # schtasks /Query /TN PersonasBuildHygiene /V
npm run hygiene:uninstall
```

The task is **`PersonasBuildHygiene`**: daily at **12:30**, current user, limited
run level (no elevation, no stored password), repo root as working directory.

Why mid-day: a task created with `schtasks /Create /SC DAILY` that is **missed
while the machine is asleep does not run late** — it is simply skipped, so a
small-hours trigger on a laptop may never fire. The reaper refuses live targets,
so running during work is safe. Run-when-missed needs the XML form
(`StartWhenAvailable`); it was **not built**, because it could not be tested
without registering a task in the real scheduler, and an untested installer for
an unattended deleter is worse than a documented limit. `--time HH:MM` overrides.
On other platforms the installer prints a cron line and exits 0.

### 3. Manual — `npm run clean:cache`

The same engine with trigger `manual`, plus stage e. `--dry-run` prints the plan
and deletes nothing.

### Incident 2026-09-18

While v2 was still unreviewed in its development worktree, a codegen benchmark
ran `predev` there. The worktree's copy of the guard read the snapshot (≥ 80 %),
spawned its background enforcer, and that enforcer pruned the **main checkout's
real target**: **9.77 GB** — 370 superseded hash-sets of 8 workspace crates —
plus 3 incremental sessions, all older than 3 days. It refused correctly while
builds were live, and it cost **one real 110 s `app_lib` recompile**.

*Why it could reach the main target at all:* the script resolves its root with
`git rev-parse --git-common-dir` (now by path, same result), which from **any**
worktree is the primary checkout — deliberately, since that is where
`.claude/worktrees/` lives. So every worktree's copy of the script sees, and
would police, the one shared target, with whatever code that branch contains.

*Why a rebuild:* the code that ran kept the newest **2** sets per crate + shape
(its own log row says so). With three live lanes each owning a valid hash, and
mtimes that record *built*, not *used*, two was one too few: a still-current
`app_lib` set fell outside the window.

The two rules it produced:

1. **A worktree's copy of the guard never enforces** (`guardMayEnforce()`); it
   advises with the number and the reason.
2. **Keep is 3 deep, per crate + shape** — one per live lane, and never a plain
   newest-N across shapes. See [Eviction order](#eviction-order--and-why).

## The eviction log

`~/.personas/build-hygiene.jsonl` (override `PERSONAS_HYGIENE_LOG`), one row per
eviction:

```json
{"ts":"2026-09-18T17:19:56.598Z","trigger":"guard","target":"main/debug","category":"deps-superseded","bytesFreed":9767511959,"reason":"370 superseded hash-set(s) of 8 workspace crate(s), older than 3 d; newest 2 per crate+shape kept; footprint over the 60 GiB budget"}
```

(That row is real — the first eviction v2 ever made, from the
[incident](#incident-2026-09-18), when the keep count was still 2.)

`trigger` is `guard | daily | manual`; `category` is one of `deps-superseded`,
`incremental`, `cargo-sweep`, `build-orphan`, `worktree-target`, `temp-target`,
`worktree-orphan`, `root-residue`. Every eviction also prints one line — what,
bytes, why. An under-budget guard prints nothing. Self-healing that leaves no
trace reads as "the cache keeps going cold for no reason", and the first response
to that is to switch the reaper off; `npm run hygiene:log` is the answer to
"what deleted my artifacts?".

## `worktree-gc.mjs` — worktree lifecycle

```bash
npm run clean:worktrees                      # dry-run: report only
node scripts/worktree-gc.mjs --force         # actually remove
node scripts/worktree-gc.mjs --days=30       # age threshold (default 14)
node scripts/worktree-gc.mjs --include-orphans   # also drop untracked dirs (a human's call)
```

A registered worktree is **removable** only when it is *all* of: clean (no
uncommitted changes), merged into `origin/master`, and older than `--days`.
Anything with uncommitted changes is never touched. Removing a worktree drops
its working directory and build cache — the branch and its commits stay in the
repo. Stale git refs (worktree dir already gone) are always pruned. The daily
task applies this same predicate; it never passes `--include-orphans`.

This automates step 4 of the worktree workflow in
[`.claude/CLAUDE.md`](../../.claude/CLAUDE.md) ("Clean up worktrees after merge").

### Optional: cargo-sweep

`cargo-sweep` prunes artifacts not touched in N days — the surgical middle
ground between "keep everything" and `cargo clean`. The enforcer uses it as
stage c if present and says so in a note if not:

```bash
cargo install cargo-sweep
```

## Tuning Cargo itself

- **`CARGO_INCREMENTAL=0`** — disables the `incremental/` cache. Worthwhile for
  one-off or CI-style builds (incremental only helps repeated local rebuilds);
  it trades a slower rebuild for a much smaller, bounded `target/`.

### Sharing build output across worktrees

A shared worktree **`build.build-dir`** was tried during the 2026-09-18
build-process upgrade and **rejected as unsafe**: cargo's unit hash for a workspace
member does not include the checkout path and freshness is mtime-based, so one
worktree can be reported `Fresh` against another worktree's code (reproduced; see
[build-measurement.md](./build-measurement.md#rejected-a-shared-buildbuild-dir-across-worktrees)).
Each worktree therefore keeps its own `src-tauri/target`, which discovery counts
against the budget and the daily task reaps once the worktree is merged. Discovery
still recognises `.claude/worktrees/.cargo-build` (kind `worktree-shared-build`)
so that a directory left behind by that experiment, or by a future one, cannot
become a second unbounded tree.

The sanctioned way to stop every worktree recompiling the same dependencies is
[sccache](#sccache--a-compilation-cache-that-survives-a-wiped-target-dir), below.

A machine-wide `CARGO_TARGET_DIR` remains available per-machine if you build
worktrees one at a time:

```bash
export CARGO_TARGET_DIR=/c/Users/<you>/.cargo-target/personas
```

Note that a target outside the repo is **not** discovered, so it is not counted
against the budget.

## sccache — a compilation cache that survives a wiped target dir

`npm run ensure:sccache` (`scripts/build/ensure-sccache.mjs`) provisions
**sccache 0.18.0**, pinned, SHA-256-verified against both a committed digest and
the release's published `.sha256` sidecar, into `~/.cargo/bin/`. It then exports
`RUSTC_WRAPPER`. `scripts/build/cargo-run.mjs` reads that and never clobbers it.

sccache has no `Fresh`-against-the-wrong-code hole, because it keys on the
preprocessed input, the compiler binary and the full flag set rather than on an
mtime.

### It does NOT share across worktrees — measured, 2026-10-07, same day it landed

This was adopted to solve the problem a shared
[`build.build-dir`](#sharing-build-output-across-worktrees) was rejected for: a
fresh worktree's first `cargo build --lib` measured **490 s and 7.0 GB**
([build-measurement.md](./build-measurement.md)), nearly all of it dependency
crates an adjacent worktree had compiled minutes earlier. **It does not solve
that.** Three runs of `cargo check -p personas-macros` on this host, reading
`sccache --show-stats` between each:

| second cold build of the identical crates | hits | wall |
|---|---|---|
| a **different** `CARGO_TARGET_DIR` path | **0** of 12 | 5.74 s |
| the **same** path, contents deleted | **6**, 25% | 6.05 s → **2.94 s** |

**sccache's Rust cache key includes the absolute `--extern` paths to the
dependency rlibs**, so a build in a different target directory misses every
object. Every worktree here uses its own path (`target-wt`, `target-wt1`, under
its own parent), which is exactly the case that misses — and the only way to make
the paths identical is the shared build-dir that was rejected as unsafe.

So what it actually buys, and the claim to make instead: **recovery from a wiped
or cleaned target dir within one checkout, measured at ~2x on this sample.** That
is worth having — `clean:ort` is a ~5 min recompile and `clean:rust` ~10 min, and
this repo reaches for both routinely — but it is not cross-worktree sharing, and
the 490 s figure above is NOT the number it improves. A cache with a measured 0%
hit rate is pure cost; that is why this table is here rather than a claim.

### The budget: 20 GiB, and what prunes it

`SCCACHE_CACHE_SIZE=20G`. **sccache prunes itself** — it evicts least-recently-used
objects to stay under the cap. That is the whole reason it is the right shape for
this problem and a target dir is not: a cache with a budget needs no reaper, and
`target/` has needed every line of this document.

**The cap is owned by the SERVER and fixed when the server starts.** Measured
2026-10-07 on 0.18.0, and it is a trap worth knowing:

- A client asking `--show-stats` with `SCCACHE_CACHE_SIZE=5G` against a 20 GiB
  server is told **20 GiB**. The client's value is ignored.
- Therefore a probe that passes the cap it *wants* reads back its own wish. It can
  never detect a wrong cap. `ensure-sccache.mjs` **deletes `SCCACHE_CACHE_SIZE`
  from the stats probe's environment** so the number it reports is a measurement.
- `sccache --show-stats` **auto-starts a server** when none is running, using
  whatever the asking client's environment carries — so the ordinary way to end up
  capped at sccache's **10 GiB default** is for any tool to ask for stats first.
  The script starts the server itself, with the cap, before asking anything.
- The server is started **detached and unref'd**. A server spawned as a tracked
  child of a node process did not reliably outlive it here: the first version
  started a 20 GiB server, node exited, the next client found none and installed
  its own 10 GiB one. An unenforced byte budget that reports itself as enforced is
  exactly the failure mode this document was written about.
- If a server is already up with the wrong cap, the script **says so and leaves it
  alone** — it may be serving another session's build, and a 10 GiB cache is a
  working cache. `npm run ensure:sccache -- --restart` re-caps it; that is an
  explicit act.

### What it caches, and what it does not

- **It caches non-incremental compilation units** — the ~683 third-party
  dependency crates. That is where the 490 s mostly goes, and it is the win.
- **It does not cache this repo's own crates.** Cargo passes `-C incremental` for
  workspace members in the dev profile and rustc invocations with incremental
  compilation enabled are not cacheable; sccache counts them `Non-cacheable
  compilations` and forwards them untouched. A large non-cacheable count in
  `--show-stats` is the expected, healthy reading, not a fault.
- **So a fresh worktree still pays for `app_lib`, `personas-db`,
  `personas-engine` and `personas-core`.** Do not quote this as "worktree builds
  become instant". `CARGO_INCREMENTAL=0` would make them cacheable too, at the
  cost of every warm rebuild — a separate trade, not enabled here.
- **Adopting it costs one full rebuild, once.** Cargo folds the rustc wrapper into
  its fingerprints, so the first build after sccache is switched on (or off)
  recompiles everything. Turn it on and leave it on; toggling per session is worse
  than not having it. `PERSONAS_SCCACHE=off` exists for a deliberate comparison
  run, in the shape of `CARGO_GUARD=off`.

### It fails open, loudly

Absent or unservable binary → **one line, nothing exported, exit 0**, and the build
proceeds unwrapped. That follows `guard-concurrent-cargo.mjs`'s reasoning, and CI
has already paid for the alternative: `RUSTC_WRAPPER` was job-level and
un-overridable there, so the 2026-07-27 GitHub Actions cache outage took the whole
Rust gate down for weeks. `.github/workflows/ci.yml:722-738` now writes the wrapper
only after sccache proves it can serve, and this script holds the same line —
**nothing is exported until the server answers `--show-stats`.**

### A cache with no measured hit rate is pure cost

`npm run build:disk` reports `sccache --show-stats` including the hit rate, because
only the measurement distinguishes a cache that is helping from a directory that is
being paid for. A fresh install reads:

```
hit rate: NO COMPILE REQUESTS YET — 0 hits of 0; a true starting measurement, not a failure.
```

Measured 2026-10-07 immediately after provisioning: **0 hits, 0 misses, 0 requests
— hit rate undefined, printed as such rather than as 0 %.** "No requests yet" and
"0 % of 4,000 requests" are different facts; sccache's own `Cache hits rate` field
agrees and prints `-`. Re-read it after the first wrapped build; the number to
watch is the hit rate on a *second* worktree's cold build, which is the one this
whole mechanism exists to make cheap.

### The one thing it cannot do

**A child process cannot write its parent's environment.** So an npm `pre*` script
cannot hand `RUSTC_WRAPPER` to the `npm run tauri:dev` that follows it — each runs
in its own process. The three real paths, in order of preference:

1. **Import it.** `await ensureSccache()` inside the process that spawns cargo.
   `cargo-run.mjs` spawns with `{ ...process.env }`, so one line there wraps every
   cargo this repo launches. This is the intended wiring.
2. **`node scripts/build/ensure-sccache.mjs --env`** prints `KEY=VALUE` lines for a
   shell to eval.
3. **`.claude/.sccache-env.json`** — the resolved values, written on every
   successful run, for a later process that would rather read than re-probe.

It deliberately does **not** write `~/.cargo/config.toml` or call `setx`. Either
would wrap every cargo invocation on the machine for every project, and break them
all on the day the binary is removed — the same single point of failure CI already
paid for.

## `build-disk.mjs` — disk forensics and the orphan-worktree reaper

`npm run build:disk`. Prefer **`npm run cache:report`** for the budget: that is the
budget's own view and the authority on it. This is the forensics view beside it,
and it adds age next to size, the sccache store, [the targets the budget cannot
see](#targets-the-list-still-cannot-see--measured-2026-10-07), and one deletion.

### The deletion rule

> **Delete only a target directory whose worktree no longer exists.**

`git worktree list` says who is live. A target dir under a path that is not a live
worktree belongs to nobody: no checkout can use it, no session can be mid-build in
it, and there is no cold build to pay for again. That is what makes it *provable*
rather than probable.

Everything else is **reported with its exact `rm -rf` command and never touched** —
stale-but-live worktrees, the main checkout's `target` and `target-wt`,
`incremental/`, `target-clippy`, `target-bindings`, `.personas-e2e-target`,
`.rp-check-target`, `%TEMP%` targets, the sccache store.

**Why this narrow.** An aggressive 7-day-stale auto-reaper was offered and the
operator chose this rule instead. Do not widen it: no `--force` for stale-but-live
dirs, no prompt that nudges toward deleting more. A stale-looking worktree target
is somebody's next warm build, and this repo has lost work to an over-eager cleaner
twice — the 2026-05-09 `git stash` incident, and [the 2026-09-18
incident](#incident-2026-09-18) where a worktree's copy of the budget guard pruned
the **main** checkout's target and cost a real 110 s recompile. The cost of keeping
10 GB too long is 10 GB; the cost of deleting the wrong thing is somebody's work.

Four further brakes inside the rule:

1. **`--reap` is required.** The default run deletes nothing and prints the
   candidates.
2. **The candidate must be a cargo target root** — both `CACHEDIR.TAG` and
   `.rustc_info.json` present. A stray directory under an orphaned worktree path is
   not ours to remove.
3. **An `UNMEASURED` row is never a candidate.** An unreadable tree is not a proven
   one.
4. **Re-checked immediately before removal** with `targetLiveReason()` from
   `cache-budget.mjs` — the EBUSY `.cargo-lock` read probe plus the
   incremental-mtime window, [documented above](#what-it-refuses). Nothing is
   re-derived.

And `git worktree list` failing yields **zero** candidates, never "everything looks
orphaned". "Could not check" is never "nobody's".

Verified 2026-10-07 in a throwaway temp tree (never against a real target dir): an
orphan-worktree target is the only thing removed, while a live worktree's target,
the main checkout's target, a non-cargo directory and an unmeasured one are each
kept with a stated reason — and with `git` unreadable, nothing at all is a
candidate. With all six worktrees of this checkout live, the real run reports
**candidates: NONE** and deletes nothing.

### Measurement

`robocopy /L` (list-only; it copies nothing and `/XJ` keeps it out of the
`node_modules` junctions worktrees carry), the mechanism `bench.mjs` already
settled on because `du` hangs on this host. It walked 93.60 GiB in **7.9 s**. No
process enumeration at all — a bare `tasklist` hangs here, and the liveness
question is answered by the lock probe.

**A size that could not be computed prints `UNMEASURED`, never 0**, the total says
it is a lower bound, and such a row is never reaped.

`--verify` measures every row a second way (`measureDirStrict`, a node
`readdirSync` walk) and prints both. Cross-checked 2026-10-07 on
`prototype-athena-chat/src-tauri/target-wt` with three independent mechanisms:

| mechanism | bytes |
|---|---|
| `robocopy /L /BYTES` | 15,098,328,309 |
| node `readdirSync({recursive:true})` + `statSync` | 15,062,907,957 |
| PowerShell `Get-ChildItem -Recurse -File \| Measure-Object -Sum Length` | 15,062,907,957 |

The two file walks agree **byte for byte**; robocopy reports **35,420,352 bytes
(0.23 %) more**, with zero files skipped by the node walk, and the reason is **not
established** — it is not a per-directory cluster rounding (the delta is not a
multiple of the 2,897 directories). Recorded rather than explained: robocopy stays
the primary because it is the faster walk and the larger, more conservative figure
for a disk report, and `--verify` exists so nobody has to take one walk's word.

## Routine

- Day to day: nothing. The guard and the daily task hold the budget; read
  `npm run hygiene:log` if a build was unexpectedly cold.
- Once per machine: `npm run ensure:sccache`, then leave it on. Re-running it is a
  no-op and says so.
- If the guard's line turns red (alarm) or `clean:cache` ends "still over
  budget": a build was live every time, or the hot set alone exceeds 60 GiB —
  `npm run cache:report`, then `npm run clean:cache` when idle; `clean:rust` is
  the last resort.
- After merging worktree branches: `npm run clean:worktrees` (then `--force`),
  or let the daily task take them at 14 d. Then `npm run build:disk` — a worktree
  removed without its target dir leaves exactly the one thing `--reap` is allowed
  to delete.
- "Where did 90 GB go?": `npm run build:disk`. It is the only view that includes
  the `target-wt*` trees and the sccache store.
- Recovering from cache corruption (host-triple drift, ORT mismatch): see
  `clean:ort` / `clean:rust` in [`build.md`](build.md).
