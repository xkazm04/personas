# Build cache management

Keeping `src-tauri/target` and agent worktrees from filling the disk.

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

Nothing in the build pipeline capped this. The mechanisms below do.

## Quick reference

```bash
npm run cache:report      # measure main + worktree target/ footprint
npm run clean:cache       # prune the footprint back under budget
npm run clean:worktrees   # GC stale agent worktrees (dry-run by default)
```

The **budget** is `CACHE_BUDGET_GB` (default `80`). Set it in your shell or
`.env` to raise/lower the threshold.

## The mechanisms

### 1. `cache-budget.mjs` — measure and enforce

| Command | Effect |
| --- | --- |
| `node scripts/cache-budget.mjs --report` | Print a per-target breakdown. Never deletes. |
| `node scripts/cache-budget.mjs --enforce` | Prune until under budget (asks to confirm on a TTY). |
| `node scripts/cache-budget.mjs --guard` | Hook mode (the default with no flag). |
| `--json` | Machine-readable output (with `--report`). |
| `--yes` | Skip the `--enforce` confirmation prompt. |

`--enforce` prunes **least-destructive first**, stopping as soon as the
footprint is under budget:

1. Worktree `target/` dirs, oldest mtime first — they regenerate on next build.
2. `incremental/` caches in the main target — only speed up rebuilds.
3. `cargo sweep --time 14`, if [`cargo-sweep`](#optional-cargo-sweep) is installed.
4. If still over: the main target itself is the bulk — it points you at
   `npm run clean:rust` (a full `cargo clean`).

Worktree caches are **only** deleted by an explicit `--enforce` run. `--report`
and `--guard` never delete anything.

### 2. Build-time guard (non-blocking)

`run-codegen.mjs` runs `cache-budget` in `--guard` mode as part of `predev`
and `prebuild`. The guard:

- reads a cached measurement (`.claude/.cache-budget.json`, gitignored),
- prints a one-line warning when the cache is above **80 % of budget**,
- refreshes the measurement in a detached background process if it is stale.

It **always exits 0** — a slow disk scan or a full cache can never block or
fail `npm run dev`. The warning is advisory; you decide when to clean.

### 3. `worktree-gc.mjs` — worktree lifecycle

```bash
npm run clean:worktrees                      # dry-run: report only
node scripts/worktree-gc.mjs --force         # actually remove
node scripts/worktree-gc.mjs --days=30       # age threshold (default 14)
node scripts/worktree-gc.mjs --include-orphans   # also drop untracked dirs
```

A registered worktree is **removable** only when it is *all* of: clean (no
uncommitted changes), merged into `origin/master`, and older than `--days`.
Anything with uncommitted changes is never touched. Removing a worktree drops
its working directory and build cache — the branch and its commits stay in the
repo. Stale git refs (worktree dir already gone) are always pruned.

This automates step 4 of the worktree workflow in
[`.claude/CLAUDE.md`](../../.claude/CLAUDE.md) ("Clean up worktrees after merge").

### Optional: cargo-sweep

`cargo-sweep` prunes artifacts not touched in N days — the surgical middle
ground between "keep everything" and `cargo clean`. The enforcer uses it if
present and degrades gracefully if not:

```bash
cargo install cargo-sweep
```

## Tuning Cargo itself

- **`CARGO_INCREMENTAL=0`** — disables the `incremental/` cache. Worthwhile for
  one-off or CI-style builds (incremental only helps repeated local rebuilds);
  it trades a slower rebuild for a much smaller, bounded `target/`.
- **Shared `CARGO_TARGET_DIR`** — pointing every worktree at one absolute
  target dir deduplicates dependency artifacts across worktrees (the biggest
  single saving). It is **not** enabled by default: a shared target dir
  serializes concurrent builds (Cargo locks it), which slows the parallel
  agent-worktree workflow. Enable it per-machine only if you build worktrees
  one at a time:
  ```bash
  # e.g. in your shell profile
  export CARGO_TARGET_DIR=/c/Users/<you>/.cargo-target/personas
  ```

## Routine

- Day to day: ignore it — the build guard warns you when it matters.
- When warned: `npm run cache:report`, then `npm run clean:cache`.
- After merging worktree branches: `npm run clean:worktrees` (then `--force`).
- Recovering from cache corruption (host-triple drift, ORT mismatch): see
  `clean:ort` / `clean:rust` in [`build.md`](build.md).
