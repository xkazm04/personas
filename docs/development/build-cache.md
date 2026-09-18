# Build cache management

Keeping every cargo target this project grows — `src-tauri/target`, the alternate
targets, agent worktrees and targets left in `%TEMP%` — under a **60 GiB budget
that is enforced**, not announced.

## Why this exists

Cargo **never garbage-collects `target/`**. This crate compiles under five
profiles (`dev`, `dev-release`, `release`, `ci`, `stable`) and more than one
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
| `worktree-shared-build` | `.claude/worktrees/.cargo-build` — see [Sharing build output](#sharing-build-output-across-worktrees) |
| `temp` | any directory at depth ≤ 2 under the temp dir holding **both** `CACHEDIR.TAG` and `.rustc_info.json` (recognised by content, not by name) |

The `%TEMP%` walk is bounded (depth 2, **50,000** directories — `%TEMP%` here has
held ~70,000 entries, and the first real v2 measurement stopped at an earlier
20,000 cap). Hitting the bound prints one line: a capped walk is "could not
check", and silence would dress it as "clean".

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

This page used to say a shared `CARGO_TARGET_DIR` was the only way to share
artifacts between worktrees, and that it was off by default because a shared
target dir serializes concurrent builds (Cargo locks it). Both halves are still
true of `CARGO_TARGET_DIR`, but it is **not the only option**: a later package of
the build-process upgrade introduces a shared worktree **`build.build-dir`** at
`.claude/worktrees/.cargo-build`, which shares intermediate build output while
each worktree keeps its own final artifacts. Discovery already counts that
directory (kind `worktree-shared-build`) against the budget and the reapers
already apply to it, so it cannot become a second unbounded tree.

A machine-wide `CARGO_TARGET_DIR` remains available per-machine if you build
worktrees one at a time:

```bash
export CARGO_TARGET_DIR=/c/Users/<you>/.cargo-target/personas
```

Note that a target outside the repo is **not** discovered, so it is not counted
against the budget.

## Routine

- Day to day: nothing. The guard and the daily task hold the budget; read
  `npm run hygiene:log` if a build was unexpectedly cold.
- If the guard's line turns red (alarm) or `clean:cache` ends "still over
  budget": a build was live every time, or the hot set alone exceeds 60 GiB —
  `npm run cache:report`, then `npm run clean:cache` when idle; `clean:rust` is
  the last resort.
- After merging worktree branches: `npm run clean:worktrees` (then `--force`),
  or let the daily task take them at 14 d.
- Recovering from cache corruption (host-triple drift, ORT mismatch): see
  `clean:ort` / `clean:rust` in [`build.md`](build.md).
