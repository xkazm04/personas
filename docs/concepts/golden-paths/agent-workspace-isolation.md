# Golden path — Agent workspace isolation

> Situation node: `backend-runtime/subprocess-and-io/agent-workspace-isolation` ·
> [situation spine](../situation-spine.md) · recurrence **5** · risk **MEDIUM** ·
> sides: **server** (**upheld, with one qualification** — see [§12.1](#121--sidesserver-upheld-and-the-qualification-is-that-there-is-no-client-half-at-all)) ·
> convergence: **mixed** (**not tested against the sibling cohort** — see [§12.5](#125--what-was-not-done)) ·
> dimensions: **security · function · resilience**
> Composed 2026-08-17 against `master` @ `cc27be561`. **Mode-2 short form** — spine header,
> §0, §2, §7, §9, §12. The quality core is unchanged: two implementations of every count, a
> positive control, hand-verified precision, re-extraction from the finished document.
>
> **Sweep size.** Every `git worktree` construction site in the tree — Rust, Node scripts and
> `.claude/**` markdown. All **14** `CliProcessDriver::spawn_temp` / `spawn_temp_no_stderr`
> construction sites opened and classified by hand. `scripts/worktree-gc.mjs` (289 lines) read in
> full and **run**. `workspace.rs` (the isolation engine), `dev_mode.rs`, `competitions.rs`,
> `cli_process.rs`, `runner/mod.rs` read around every path-construction and cleanup site.
>
> **Measured by execution, not by reading.** `npm run clean:worktrees` was run twice — once with
> the flags `package.json` actually ships and once with `--include-orphans` — and the two runs
> disagree by **19.79 GB**. `%TEMP%` was enumerated in full (**87,149 entries, 79,766
> directories**) and bucketed by creator prefix. `git worktree list --porcelain` was run against
> the checkout that holds three app-created worktree directories. **Nothing was removed**; the GC
> was left in its default dry-run mode and no directory, worktree or branch was deleted.
>
> **Database:** the 2026-08-17 purge backup
> (`%APPDATA%\com.personas.desktop\purge-backup-2026-08-17\personas.db`, 347 MB) copied read-only
> for the schema sweep; copy deleted. `cargo` was not run.

---

## 0 The headline: the repo's worktree GC found 19.79 GB it created and printed "Nothing to remove"

Three directories sit in `.claude/worktrees/` on the operator's machine right now:

```
athena-dev-515e976a   5.34 GB   created 2026-08-06
athena-dev-afc86f6c   5.44 GB   created 2026-08-06
athena-dev-fe5c433a   9.00 GB   created 2026-08-09
                     ────────
                     19.79 GB
```

They were created by **the app**, not by a CLI session — `dev_mode::create_dev_worktree`
(`src-tauri/src/companion/dev_mode.rs:662-673`) runs `git worktree add .claude/worktrees/athena-dev-<id>`
whenever an Athena dev-mode approval is executed with `backend: true`
(`src-tauri/src/commands/companion/approvals/approval_exec_dev.rs:844-851`).

None of them is a worktree any more. `git worktree list --porcelain` reports **one** entry, the
main checkout. None of the three contains a `.git` file. They are 19.79 GB of orphaned checkout,
mostly `node_modules`, with one of them holding a `du.exe.stackdump` — the crash of a tool that
tried to measure it.

The repo ships a garbage collector for exactly this. Run as `package.json` invokes it:

```
$ node scripts/worktree-gc.mjs                     # === npm run clean:worktrees
  keep  athena-dev-515e976a   5.34 GB   not tracked by git — inspect before removing
  keep  athena-dev-afc86f6c   5.44 GB   not tracked by git — inspect before removing
  keep  athena-dev-fe5c433a   9.00 GB   not tracked by git — inspect before removing
  0 removable · reclaims ~0.00 GB
  Nothing to remove.
```

Run with one more flag:

```
$ node scripts/worktree-gc.mjs --include-orphans
  DROP  athena-dev-515e976a   5.34 GB
  DROP  athena-dev-afc86f6c   5.44 GB
  DROP  athena-dev-fe5c433a   9.00 GB
  3 removable · reclaims ~19.79 GB
```

**The GC sees them. It names them. It measures them. And then it declines, because
`removable` requires `INCLUDE_ORPHANS` (`scripts/worktree-gc.mjs:43`, `:188-195`), `package.json:81`
passes no flags, and `.claude/CLAUDE.md:275` — the only place a session is told the script exists —
names it without them.** This is the contract's fifth gate failure mode
([`golden-path-contract.md`](../golden-path-contract.md), "the gate that points at a broken
destination") in a form the contract had not yet recorded: the gate reaches the right destination,
reports the truth on screen, and then its own default flags exclude the entire population it just
found. "Nothing to remove" is printed **directly underneath 19.79 GB of removable data**.

**How they became orphans is mechanical and repeatable.** `prune_worktree`
(`dev_mode.rs:920-928`) removes a finished dev worktree with

```rust
run_git(root, &["worktree", "remove", &workspace.to_string_lossy()])
```

— **no `--force`**, which git refuses for a worktree with untracked files, and every one of these
has `node_modules`. The failure is swallowed (`prune_worktree` is called only on the merge-verified
path and its result is not surfaced). The directory survives. Later, any `git worktree prune` —
`worktree-gc.mjs:283` runs one on every `--force` pass, and `scripts/test/longitudinal.mjs:66` runs
one *unconditionally* — drops the registry entry for a worktree git can no longer validate. The
directory is now an orphan, and the orphan branch of the GC is the branch that is off by default.
The sibling failure path already knows the answer: `approval_exec_dev.rs:861-864` removes a
rejected worktree with `worktree remove --force`, and `workspace.rs:405`, `:422`, `:684` all use
`--force` too. **Four of the five `worktree remove` sites in the tree pass `--force`. The one that
runs on the success path does not.**

And the second finding, from the other workspace mechanism, is the same shape one layer down:

**`CliProcessDriver` takes ownership of a temp workspace and has no `Drop`.** `spawn_temp`
(`src-tauri/engine/src/cli_process.rs:529-547`) creates `%TEMP%/<prefix>-<uuid>` and sets
`owns_exec_dir: true`; the only code that acts on that flag is `cleanup_dir()`
(`:700-705`), reachable only from `finish()` (`:708-712`) or an explicit call. `kill()` does not
call it. A `?` does not call it. **Of the 14 construction sites, 9 reach an early return before any
cleanup** — and one of them, `cli_capabilities.rs:68`, never calls `finish()` or `cleanup_dir()` on
**any** path: it calls `driver.kill().await` at `:72` and `:97` and returns.

The disk agrees, exactly:

| `%TEMP%` prefix | owning site | dirs on disk |
| --- | --- | ---: |
| `personas-capprobe-*` | `cli_capabilities.rs:68` — never cleans, any path | **132** |
| `personas-auto-triage-*` | `auto_triage.rs:280` — cleans on success | 0 |
| `personas-llm-eval-*` | `eval.rs:620` — cleans on success | 0 |
| `personas-test-coord/-exec-*` | `test_runner.rs:1098`, `:1137` | 0 |
| `build-cap/-prose/-clarify/-test-*`, `test-summary-*` | `fanout.rs`, `tool_tests.rs` | 0 |
| `personas-genome-critique-*`, `personas-assignment-*` | `genome_critique.rs`, `team_assignment_matching.rs` | 0 |

**One site out of fourteen leaks, and it leaks on 100% of its runs, because it is the only one that
never calls the cleanup at all.** That is not a discipline problem — twelve sites got it right. It
is a **type** problem: `owns_exec_dir: true` is a promise the type does not keep, and the compiler
has nothing to say about a struct that goes out of scope holding a directory it declared it owned.

---

## 2 The one way

Make the workspace's lifetime a **value's** lifetime, not a caller's obligation, and make its
removal **forced**. Concretely: (a) if a run needs isolation from the checkout, take a
`git worktree`, and remove it with `worktree remove --force` — the non-forced form fails on any
untracked file, which is every real checkout, and the failure is silent; (b) whatever creates a
directory a run will write to must own it through `Drop`, not through a method the error path can
skip — `SessionExecDir` (`src-tauri/src/engine/build_session/runner.rs:109-146`) is the shape to
copy and `CliProcessDriver` is the shape to fix; (c) record the workspace path in the database **at
creation time**, before the process that will fill it starts, because a path you can only
reconstruct from a convention is a path a later sweep cannot enumerate — `companion_dev_op.workspace`
(`src-tauri/db/src/lib.rs:896`) does this and `%TEMP%/personas-exec-wt-<execution_id>` does not;
(d) treat "the workspace still exists at boot" as the reconciliation signal it is — a directory
whose run is not in any live registry is an orphan, and the sweep that finds it must default to
*acting*, because a GC whose destructive branch is behind an opt-out flag will report zero forever;
and (e) never let the workspace be the only containment. Every CLI spawn in this tree passes
`--dangerously-skip-permissions` (16 sites; `cli_args.rs:107`, `:296`, `cli_process.rs:418`,
`pty.rs:324`, `:364`, `headless.rs:132`, `external.rs:169`, and nine more), so the working
directory is not a sandbox — it is a *convention about where output lands*, and the security story
has to be told somewhere else (see [`filesystem-boundary`](./filesystem-boundary.md) §2 for the
anchored-root form this repo already has and does not apply here).

Two decisions the repo already made and should not un-make: keep app-created worktrees **inside the
repo root** (`dev_mode.rs:658-661`) so `validate_fleet_cwd_in_db`'s allowlist still passes, and
**keep the branch** after removing the worktree (`workspace.rs:684`, `docs/features/execution/worktree-isolation.md:62`)
— the directory is disposable, the commit is not.

---

## 7 Deviations

Every entry is a `file:line` in this repo at `cc27be561`, hand-opened during composition.

### 7.1 The success path removes a worktree without `--force`; the failure path uses it

`src-tauri/src/companion/dev_mode.rs:920-928`. `prune_worktree` runs
`git worktree remove <path>`. Git refuses this when the worktree contains untracked files;
`node_modules` guarantees it. The three orphans in §0 are the observed result. Four of the five
`worktree remove` sites in the tree already pass `--force`
(`approval_exec_dev.rs:861-864`, `workspace.rs:405-408`, `:422-426`, `:684-687`); this is the fifth.
**Deferred, not applied** — it changes what a runtime path deletes.

### 7.2 `npm run clean:worktrees` cannot remove the only worktrees it finds

`package.json:81` → `node scripts/worktree-gc.mjs`, no flags. `worktree-gc.mjs:200` computes
`removable = dirty === 0 && merged && age > DAYS`, and an orphan (a directory git does not know
about) has `dirty === null` and `merged === null` — so it is removable only via the separate
`INCLUDE_ORPHANS` branch at `:188-195`, gated on `--include-orphans` (`:43`). Measured: default run
= **0 removable**; with the flag = **3 removable, ~19.79 GB**. The script is also a **dry run
without `--force`** (`:254-261`), so `clean:worktrees` as shipped is a report that can never act.

### 7.3 The GC scans one directory and three of the four workspace mechanisms are not in it

`worktree-gc.mjs:170` — `join(root, ".claude", "worktrees")`, and nothing else. The tree has four
workspace mechanisms:

| | path shape | created by | reaped by |
| --- | --- | --- | --- |
| A | `<repo>/.claude/worktrees/athena-dev-<id>` | `dev_mode.rs:662-673` | `prune_worktree` (§7.1) |
| B | `<project>/.claude/worktrees/comp-<tag>-<i>-<slug>` | the Claude CLI, via `--worktree` (`task_executor.rs:918-924`) | `competitions.rs:706-723` on pick-winner / cancel / delete |
| C | `%TEMP%/personas-exec-wt-<execution_id>` | `workspace.rs:573-585` | `ExecutionWorkspace::finalize` `:626-716` |
| D | `%TEMP%/personas-team-run-<run_id>/…` | `workspace.rs:224-300` | `WorkspaceCoordinator::cleanup` `:393-453` |

Only A and B are under the scanned directory. C and D live in `%TEMP%` and are invisible to the
only GC that exists. `workspace.rs:57-59` says so in its own source: *"If cleanup() is never called
(panic, app crash), worktrees and the temp parent dir leak. Future v2: a startup GC sweep…"*. The
collision guards at `workspace.rs:210-217` and `:561-568` — which hard-error with *"A previous run
with this id may have leaked"* — exist because the leak is expected.

### 7.4 `CliProcessDriver` declares ownership of a directory and has no `Drop`

`src-tauri/engine/src/cli_process.rs:502-547`, `:700-712`. `owns_exec_dir: bool` is honoured only
inside `cleanup_dir()`, and `cleanup_dir()` is reached only from `finish()` or an explicit call.
There is no `Drop` impl on the struct (verified: all 25 `impl Drop for` sites in `src-tauri/` were
enumerated; the child-owning structs — `CliProcessDriver`, `DevServer`, `PooledStdioSession` —
have none). **9 of 14 construction sites reach an early return before any cleanup** (§9's rule; all
nine hand-verified).

### 7.5 `cli_capabilities.rs` leaks its workspace on every single run

`src-tauri/engine/src/cli_capabilities.rs:68` spawns with `owns_exec_dir: true`; `:72` and `:97`
call `driver.kill().await`; the function returns at `:99-101` or `:117-135`. `finish()` and
`cleanup_dir()` appear nowhere in the file. **132 `personas-capprobe-*` directories** on the
operator's machine, one per probe. This is the only one of the fourteen owning sites with a nonzero
count on disk.

### 7.6 The temp workspace path is never recorded, so nothing can enumerate it

There is **no column anywhere** holding a `personas-exec-wt-*` or `personas-team-run-*` path.
`companion_dev_op.workspace` (`db/src/lib.rs:896`) records mechanism A's path;
`dev_competition_slots.worktree_name` (`schema.rs:1338`) records B's name. C and D are
reconstructible only from the execution/run id **by convention**, which is precisely the doctrine's
"a thing that was never declared" — no signature is short a parameter, and only an inventory of what
*should* exist would find the leak. That is why §7.3's missing boot GC cannot be written as a query.

### 7.7 The runner's isolated worktree would fail the app's own containment check

`validate_fleet_cwd_in_db` (`approval_exec_fleet.rs:1052-1083`) canonicalizes a requested `cwd` and
requires it to be under some `dev_projects.root_path`. Mechanism C puts the execution worktree in
`%TEMP%/personas-exec-wt-<id>` (`workspace.rs:573-585`), which is under no project root. The check
is never called on that path (`runner/mod.rs:663-675` builds `exec_dir` and calls
`create_dir_all` directly), so nothing fails — but the two halves of the codebase disagree about
whether a run may have its working directory outside a registered project, and only one of them is
enforced. `dev_mode.rs:658-661` documents choosing the in-repo location *specifically* to satisfy
this check, which shows the constraint was understood at one site and not the other.

### 7.8 The workspace is the only containment, and it is not one

16 spawn sites pass `--dangerously-skip-permissions`; the only `--allowedTools` narrowing anywhere
is `auto_cred_browser.rs:807`, `:820`, and Personas never emits `--add-dir`. `path_safety.rs` — this
repo's good answer, with `resolve_within_root` and a documented argument for why lexical
`starts_with` is not containment (`:486-491`) — has **one consumer**, `desktop_bridges.rs:902`,
`:916` (the Obsidian vault). A worktree bounds where the run's *git* effects land. It bounds
nothing else.

### 7.9 `%TEMP%` on this machine: 87,149 entries, 79,766 directories

Enumerated 2026-08-17. Reported here **with its false findings removed**, because the tempting
version of this number is wrong: `personas_test_*` (4,358) and `personas_user_test_*` (1,161) are
Rust test databases (`db/src/lib.rs:1984`, `:2034`), `personas-fleet-plan-*` (45) is a
`#[cfg(test)]` fixture keyed on `std::process::id()`
(`approval_exec_fleet.rs:2025-2032`), `personas_brain_*` (60) is a test fixture in
`data_portability.rs:11852`, and the 1,700-odd `pumper-*` directories belong to a different repo
entirely. **Of the app's own runtime workspace prefixes, exactly one is nonzero: `personas-capprobe`
at 132.** A composer that reported "6,429 leaked `personas*` workspaces" would have been wrong by
~48× and the error would have looked like diligence.

---

## 9 The gate

### 9.1 First: the type, and it removes the whole class

**`impl Drop for CliProcessDriver { fn drop(&mut self) { self.cleanup_dir(); } }`** —
`src-tauri/engine/src/cli_process.rs:502`. `cleanup_dir()` is already `&self`, already
`owns_exec_dir`-guarded, already idempotent (`remove_dir_all` on a missing path is an ignored
error), and already the exact body `finish()` calls. Adding the impl makes §7.4 and §7.5
**unrepresentable**: every path out of every function — `?`, `return`, panic, unwind, task
cancellation — runs it. The repo has the pattern three doors down: `SessionExecDir`
(`build_session/runner.rs:109-146`) and `SidecarScrubGuard` (`cli_mcp_config.rs:348-351`) are both
RAII directory owners, and neither has ever appeared on disk.

Held against the doctrine's seven qualifications: this is **Q5, withholding beats requiring** — the
caller is not asked to remember anything, and there is nothing to forget. It is *not* Q3 (a type
nobody constructs): 14 construction sites. It is *not* Q4 (a type anyone can construct): the field
is private and only `spawn_temp` sets it true. The one real cost is that `Drop` cannot be `async`,
so a driver dropped while its child still runs cleans a directory the child may still hold open —
on Windows that fails, silently, exactly as it does today. So the type is necessary and not
sufficient, and the ratchet below stays until the child-lifetime half is settled (see
[`cancelling-in-flight-work`](./cancelling-in-flight-work.md) §2 and its `unbound-child-lifetime`
rule, which covers the sibling half of this).

**Deferred, not applied** — `docs/concepts/golden-path-deferred-fixes.md` entries below. A `Drop`
impl changes what runs when a live app's process handles go out of scope, which is squarely inside
the "do not apply" line.

### 9.2 The ratchet

**Signal:** an owned temp workspace reaching an early return with no cleanup between.
**Condition it is a proxy for:** *a directory whose removal is a caller's obligation rather than a
value's lifetime.* An adopting repo re-derives its own proxy — in a language with `defer`, the
proxy is a `defer` missing after an ownership-transferring constructor; in one with RAII, it is a
constructor that sets an ownership flag on a type with no destructor.

**Precision: 9/9, hand-verified — I opened all nine.**
`auto_triage.rs:280` (`.map_err(…)?` at `:302` precedes `finish()` at `:304`);
`cli_capabilities.rs:68` (no cleanup on any path — the strongest of the nine);
`eval.rs:620` (`?` at `:643` precedes `finish()` at `:645`);
`test_runner.rs:1098` (`.await?` at `:1119` precedes `finish()` at `:1121`);
`genome_critique.rs:171` (`.map_err(…)?` at `:193` precedes `finish()` at `:195`);
`team_assignment_matching.rs:346` and `:499` (same shape, both);
`tool_tests.rs:433` and `:1083` (both `driver.kill().await; return Err(…)` on the write-stdin
failure path, cleanup only on success).

**Recall is bounded and I can name where.** The anchor — every `spawn_temp` construction — is **14
sites in 9 files**. The rule matches 9, its control matches 2, and **3 are unclassified**, each for
a known reason: `fanout.rs:143` and `execution/tests.rs:370` write the spawn as
`match CliProcessDriver::spawn_temp(…) { Ok(d) => d, Err(_) => { return <long literal> } }`, whose
first `;` is more than 300 characters past the call, so the `[^;]{0,300};` prefix never completes —
and `fanout.rs:143` is a **true positive the rule misses** (`driver.kill().await; return Err(…)` at
`:157-160`). `test_runner.rs:1137` is genuinely compliant (`driver.cleanup_dir()` at `:1288` runs
unconditionally after both branches) but sits past the 2,500-character window. So: **10 known true
positives, 9 matched, recall 90%**, and the miss is a delimiter problem, not a semantic one.

**Overlap.** Measured at **site level against the final pattern**, per doctrine §4. The nearest
neighbours are `unbound-child-lifetime` (`cancelling-in-flight-work`, `Command::new` … `spawn()`
without `kill_on_drop`, 12 files / 13 matches) and `unswept-job-registry-read`. Site overlap with
`unbound-child-lifetime`: **0** — that rule anchors on `Command::new`, this one on
`CliProcessDriver::spawn_temp`, and `build_and_spawn` sits between them. File overlap: **0** of 7.

**Fail-loud:** `floor: 800` against 963 `.rs` files; the runner fails on a zero-file match, a stale
`exclude`, a rise, and an unratcheted drop. **This rule must be deleted, not baselined at 0, if
§9.1 ever lands** — the census cannot express "must be zero" and a rule pinned at zero is a gate
that can never fail.

```json
{
  "id": "leaked-owned-exec-dir",
  "goldenPath": "docs/concepts/golden-paths/agent-workspace-isolation.md",
  "roots": ["src-tauri"],
  "extensions": [".rs"],
  "signal": {
    "pattern": "CliProcessDriver::spawn_temp(?:_no_stderr)?\\s*\\([^;]{0,300};(?:(?!cleanup_dir|\\.finish\\s*\\()[\\s\\S]){0,2500}?(?:\\?\\s*;|return\\s+Err)",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "A CliProcessDriver that OWNS its temp workspace (spawn_temp sets owns_exec_dir: true) reaching an early return before any cleanup_dir()/finish() — the directory is abandoned. Proxy for: a directory whose removal is a caller's obligation rather than a value's lifetime."
  },
  "baseline": { "files": 7, "matches": 9 },
  "floor": 800
}
```

```json
{
  "id": "leaked-owned-exec-dir-positive-control",
  "goldenPath": "docs/concepts/golden-paths/agent-workspace-isolation.md",
  "roots": ["src-tauri"],
  "extensions": [".rs"],
  "signal": {
    "pattern": "CliProcessDriver::spawn_temp(?:_no_stderr)?\\s*\\([^;]{0,300};(?:(?!\\?\\s*;|return\\s+Err)[\\s\\S]){0,2500}?(?:cleanup_dir\\s*\\(\\s*\\)|\\.finish\\s*\\()",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "CONTROL: the compliant form — an owned temp workspace whose every path reaches its cleanup. Partitions the same 14-site anchor: 9 violating, 2 compliant, 3 out of window (see §9.2)."
  },
  "floor": 800
}
```

Validated standalone in a private registry (`mkB-private-rules.json`, filename unique to this
composer) — `run-census.mjs --check` exits **0** at these baselines. The full registry was **not**
run; that is the orchestrator's step.

### 9.3 What is NOT gateable here, and what instrument would be

The three findings in §0 and §7.2/§7.3 are **absences**, and the census ratchets presences:

- *"`npm run clean:worktrees` removes nothing"* is a property of a flag default, not a count.
- *"no boot GC exists"* is the absence of a function.
- *"three orphan directories are sitting on this machine"* is machine-local state, and per doctrine
  §4 the census cannot ratchet a population whose membership varies by machine — the exact failure
  [`tauri-permissions-and-csp`](./tauri-permissions-and-csp.md) recorded.

The right instrument for the first is a **change to the script, not a check on it**: make
`--include-orphans` the default and add `--exclude-orphans` for the cautious case, so the report the
operator already runs stops lying by omission. The right instrument for the second is a boot step
that enumerates `%TEMP%/personas-{exec-wt,team-run}-*` and `.claude/worktrees/*` against the live
registries and *reports a count* — an instrument that must **exit non-zero when it finds zero
workspace roots to scan**, or it becomes another gate that runs green while checking nothing.
Both are deferred, not applied: the first changes what a destructive script does by default and the
second deletes rows on first run.

---

## 12 Corrections

### 12.1 `sides: server` — upheld, and the qualification is that there is *no* client half at all

The spine's `sides: "server"` label survives, which the doctrine records as having happened only
once before. The mechanism is worth naming, because that is what distinguishes a correct label from
a lucky one: **the workspace is a directory, and the frontend has never seen one.** Every
construction site, every removal site, every containment check and the census rule are Rust or Node.
The single frontend contribution anywhere near this leaf is
`src/features/plugins/fleet/sub_settings/FleetProcessScanner.tsx`, which is about processes, not
workspaces. This is the mirror image of the seventh `sides: "client"` contradiction the doctrine
records: there, the label was inverted; here it is simply right, and right for the same structural
reason the two `client` upholdings were right — one side of the app cannot observe the object.

### 12.2 The brief said "removing one failed with **Filename too long**". I could not reproduce it, and the mechanism is different

The brief reported that removing a worktree failed on Windows because git's deletion walks deep
`node_modules` paths. That may well have happened; it is not what left these three behind. The
observable state is that **git does not know about them at all** — `git worktree list --porcelain`
returns one entry, and none of the three directories has a `.git` file. A "Filename too long"
failure during `git worktree remove` would leave the registry entry **intact** and the directory
partially deleted. What is on disk instead is consistent with the §0 sequence: a non-forced
`worktree remove` refuses (untracked `node_modules`), the entry is later pruned by one of the two
`git worktree prune` calls in the tree, and the directory becomes an orphan. The fix the brief's
version implies (retry the delete) would not have prevented this; the fix §7.1 implies (`--force`,
and surface the failure) would.

### 12.3 The brief asked whether `clean:worktrees` "can see the app-created ones". It can — and that is the worse answer

Both possible answers were bad, but they are bad in different ways and only one of them is fixable
by adding a feature. It sees them, sizes them, prints them, and then reports **"Nothing to remove."**
A GC that could not see 19.79 GB would need a new capability. This one needs a default changed. I
would not have found the distinction by reading the script — the `INCLUDE_ORPHANS` constant reads as
a safety measure until you run both forms and watch the totals move from 0.00 GB to 19.79 GB.

### 12.4 The brief's framing — "a workspace nothing reaps is the leaf" — is right, and the sharpest instance is not a worktree

The three orphan worktrees are the biggest by bytes. The **most reproducible** leak is
`personas-capprobe`: 132 directories, one per capability probe, 100% of runs, from a single missing
`Drop`. A worktree leak needs a specific failure (a non-forced remove against untracked files). The
capprobe leak needs nothing to go wrong at all. When choosing what to fix first, "leaks on every
success" beats "leaks on some failures", and only enumerating `%TEMP%` by creator prefix separates
them — which is also what kept §7.9's 48× overcount out of this document.

### 12.5 What was NOT done

- **The convergence label was not tested.** `convergence: "mixed"` stands untested against
  `../personas-web`, `../brainiac`, `../personas-cloud`, `../vibeman`, `../ascent`. This is a
  short-form leaf and the oracle sweep was the item cut; recorded here rather than quietly implied,
  per doctrine §5. The doctrine's ledger is unchanged by this document: 13 tested, 13 failed.
- **`cargo` was not run** (session constraint). Every Rust claim is from reading, plus the disk and
  database evidence, which is stronger for this leaf than a compile would have been.
- **Nothing was removed.** No worktree, no branch, no directory, no row. `worktree-gc.mjs` was run
  only in its default dry-run mode and once with `--include-orphans` (still a dry run without
  `--force`).
- **Deferred fixes owed to the register** (append at the orchestrator's next free numbers, per the
  standing no-destructive-applies rule): (a) `impl Drop for CliProcessDriver` calling
  `cleanup_dir()`; (b) `--force` on `dev_mode::prune_worktree` plus surfacing its failure;
  (c) `cli_capabilities::probe` calling `driver.cleanup_dir()` after its `kill()`;
  (d) `--include-orphans` becoming the default in `scripts/worktree-gc.mjs`; (e) a boot sweep that
  reports orphaned workspace roots (report first, delete never-by-default).
