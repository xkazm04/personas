# Worker brief - the hygiene a night worker is held to

Paste this under the claim-specific lines. Every rule here cost the 2026-10-14 night something.

- **Registry:** edit ONLY your worktree `$WT_ROOT/cn<k>` (branch `cur/n<k>` off the integration branch). Never push the
  registry, never touch the registry's main checkout or another worker's worktree. The driver merges.
- **Project work happens in a plain CLONE, never a git worktree** (`$WT_ROOT/cn<k>-<proj>`). `git worktree remove --force`
  follows a `node_modules` junction and empties the sibling checkout's dependencies (it did, to systedo-case). Never
  recursive-delete a directory that holds a junction.
- **Clone hygiene:** `core.autocrlf=false` then re-checkout to LF; a REAL install (`npm ci`; politicas needs it for
  `@sentry/node`; grant's lockfile is stale, so `npm install --no-package-lock --ignore-scripts`) so the repo's hooks run.
  Do not `cp` node_modules or junction it in.
- **A clone's build is one-shot:** `export CARGO_INCREMENTAL=0` before any cargo command in it (an incremental cache
  only pays for a tree you rebuild; one 2026-10-14 clone target carried 3.8 GB of it). If you need a separate
  `CARGO_TARGET_DIR`, name it `$WT_ROOT/cn<k>-target` so it is reaped with the clone.
- **Your clone is deleted when the claim settles** (`fin.sh` runs the registry's disk lane on `$WT_ROOT/cn<k>-*`). It goes
  only if every commit is on its remote and nothing but install noise (`next-env.d.ts`, generated files, hook shims) is
  dirty. So push before you report: unpushed or uncommitted work keeps the clone and puts it on the operator's list.
- **Name the destination explicitly:** `git remote get-url origin` must be GitHub, not the local checkout (a clone's origin
  pointing at `~/kiro/<proj>` made one push create a stray `master` there), and push `git push origin HEAD:<default-branch>`
  where the default branch comes from `git ls-remote --symref origin HEAD`. Three workers created stray branches by guessing.
- **Personas is the exception:** its local master is dirty and shared. Push only to a named branch
  `curator/n<k>-<slug>`; the driver merges it from a clean clone at the end.
- **Non-fast-forward is normal** (siblings push to the same repos): `git pull --rebase`, re-run the touched tests, push. The
  only expected textual conflicts are append-only ledgers (`.ai/applied.jsonl`, `librarian/applied.md`, SCORECARD): keep both.
- **A red pre-push gate is read, not bypassed.** Flaky timeouts (gravitone `probes`, systedo `check:ci` on a shared %TEMP% DB)
  get one clean re-run; a gate red for an unrelated reason after a clean install means: push a named branch and report.
- **Registry derived files** (`catalog.json`, `*/index.json`, `rules/*`) are regenerated with `build-index`, `build-catalog`,
  then `check-bundles`; never hand-merge, and do not commit rules-file drift that is not yours.
- **check-bundles refuses** a `verified_against` line on a process-type application and a stack missing from the bundle's
  `stacks:` list; fix the doc, or add the stack deliberately and say so in the report.
- **Commits** end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`; explicit-path `git add`; no `git stash`.
- **Result honesty:** a registry-only or idled result is a valid outcome; report what was NOT measured.
