---
layer: application
subject: build-economics
technique: cache-budgeting
stack: node
---

# The target-dir budget: 324 GB of unmanaged cache brought under an enforced ceiling

`scripts/cache-budget.mjs` is the repo's cache-budgeting implementation, and
its header is the whole economic argument in miniature: Cargo never
garbage-collects `target/`; five profiles × multiple target triples each
write a full artifact set; every agent worktree under `.claude/worktrees/`
keeps its own independent `target/` — and "left unattended, `src-tauri/target`
reached **324 GB**" (`cache-budget.mjs:4-11`).

## Budget, prune order, and the reaper

- **The budget**: `CACHE_BUDGET_GB`, default 80 (`:61-62`), warning at 80%
  (`:63`).
- **The eviction order** (`:41-49`) is exactly rebuild-economics ranking,
  least-destructive first: (1) worktree `target/` dirs, oldest mtime first —
  regenerate on next build; (2) `incremental/` caches in the main target —
  "only speed up rebuilds"; (3) `cargo sweep --time 14` for stale artifacts;
  (4) nothing safely cuttable → report and point at the nuclear
  `npm run clean:rust`. Dependency artifacts are **never auto-pruned**
  (`:24-25`) — they are the highest rebuild-seconds-per-megabyte class, so
  they go last, manually.
- **The trigger**: default mode is `--guard` (`:36`), spawned arglessly by
  the codegen runner on every dev/build — a routine hook, not a remembered
  chore.

## The lesson the hard ceiling encodes

The guard's design history is the technique's "a warning is not a budget"
clause, measured: an advisory-only warning "warned all the way to 293 GB
once" (`:26`). The fix is the two-regime split — below the hard ceiling
(`CACHE_HARD_CEILING_GB`, default 150, `:20-29,:68-76`) the guard is
non-blocking and merely warns; above it, it self-heals by synchronously
pruning the incremental caches **only when no compiler is running** — and
idleness is judged by the incremental caches' mtime rather than process
enumeration, because `tasklist` crawls under this repo's process count
(`:27-29`). Opt-out is explicit (`CACHE_AUTO_PRUNE=0`), and `--guard` /
`--report` never delete anything (`:48-49`).

## Invalidation keyed on toolchain identity

Two sibling scripts carry the drift half of the technique:

- `scripts/check-build-cache.mjs:1-13` — the flat `target/debug/deps/`
  directory is *not segregated by target triple*, so switching hosts
  (x86_64 ↔ aarch64) lets a build pull stale rlibs from the other
  architecture, surfacing as `lld-link: machine type x64 conflicts with
  arm64`. The script records the host triple in a marker
  (`target/.last-build-host`) on each run and fails loud on mismatch —
  wholesale invalidation on toolchain drift, checked unconditionally in
  `predev` before the error can manifest.
- `scripts/ensure-ort-cache.mjs:1-18` — verify-by-inspection, born from a
  real poisoned artifact: an upstream prebuilt native-library tarball for
  aarch64 *hashes correctly* yet contains x64 bytes ("the upstream tarball
  is mislabeled"). Hash verification passed because the hash pins the wrong
  bytes faithfully — the label lied, not the transport. The script sniffs
  the cached library's actual machine type from its headers and replaces
  the cache contents from a trusted source on mismatch, idempotently
  (sentinel-gated), as part of the routine pre-build path.

## Named recomputation

Every layer of this cache names its rebuild path: worktree targets
"regenerate on next build", incremental prunes cost only rebuild speed,
`clean:ort` re-populates via `ensure-ort-cache` on the next dev run, and the
documented last resort is the bounded full `cargo clean`. Aggressive pruning
is safe here precisely because the worst case of any eviction is one cold
build — known, bounded, and cheaper than the disk it buys back.
