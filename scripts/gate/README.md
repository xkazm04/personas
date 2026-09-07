# Gate daemon (warm verification service)

One long-lived process per machine holds the expensive verification state for the
main checkout warm (a TypeScript builder program, an ESLint instance, the census
index) and answers each agent with the delta for its worktree. Design and
rationale: [`docs/architecture/warm-verification-service.md`](../../docs/architecture/warm-verification-service.md).

It is a cache, not a coordinator: when it is not reachable the client runs the
cold commands with the same exit semantics.

## Usage

```bash
npm run gate                                   # tsc + eslint + census for the current checkout
node scripts/gate/gate.mjs --root <worktree>   # verdict for another worktree of the same repo
node scripts/gate/gate.mjs --gates tsc,vitest --files src/a.ts,src/b.ts
node scripts/gate/gate.mjs --json              # raw response
node scripts/gate/gate.mjs --cold              # the underlying commands, no daemon
node scripts/gate/gate.mjs --status [--deep]   # daemon state (deep: ask each worker for its heap/caches)
node scripts/gate/gate.mjs --stop
```

Flags: `--root <path>` (default: the repo top level of cwd), `--gates` (default
`tsc,eslint,census`; `vitest` on request), `--files a,b`, `--json`, `--cold`,
`--status`, `--stop`, `--timeout <ms>` (default 900000).

Exit code is 1 when any gate reports `ok: false`, else 0. The table lists the
gate, its verdict, the key numbers and the time; error lines follow, with paths
relative to `--root`.

For `tsc`, `ok` means **no introduced errors** when the root is a worktree
(`introduced` = errors not present in the base, `resolved` = base errors the
worktree fixes, keyed by file + code + message so moved lines do not count), and
**zero errors** when the root is the base itself.

For `census`, a worktree verdict is the same delta. The worker evaluates the
base once under the worktree's own `scripts/census/rules.json` (cached by the
sha256 of the rules text, dropped on every base invalidation, so a repeated
request pays no second evaluation) and reports per rule: `introduced` = the
worktree's measured `[files, matches]` differs from the base's AND from the
rule's baseline (landing exactly on the baseline is a fix, not drift);
`resolved` = a rule that drifts in the base but not in the worktree;
`baseDrift` = how many rules drift in the base. `ok` for a worktree is no
structural problems and no `introduced`; the full `drift` list stays in the
result and the table prints it as inherited so nobody thinks it vanished. For
the base root the verdict is unchanged `--check` semantics: no structural, no
drift. Structural problems (floor, zero matches, stale exclude) are fatal in
both modes.

## How a request is answered

1. The client computes nothing; it reads the handshake, checks the daemon is
   alive and its fingerprint matches, and POSTs `{ root, gates, files }`.
2. The daemon computes the **overlay**: the files where `root` differs from the
   base checkout. Union of: changed vs the base HEAD in the worktree (committed or
   not), untracked in the worktree, and files dirty or untracked in the *base* by
   sibling sessions (re-read from the worktree, or marked deleted). Build output
   directories (`node_modules`, `target*`, `dist`, ...) are never included.
3. Each requested worker (`workers/*.mjs`, one `worker_thread` each) receives the
   overlay and answers from its warm state. The `tsc` worker keeps one
   `SemanticDiagnosticsBuilderProgram` for the base and serves overlay contents
   through the `CompilerHost`; unchanged files return the same `SourceFile` object,
   so only the changed files and their shape-dependents are rechecked.
4. Workers are FIFOs of depth 32; the 33rd request is refused with HTTP 429 and
   the client falls back cold.

## Handshake and lifecycle

- `~/.personas/gate-daemon.json` = `{ port, token, pid, baseRoot, fingerprint, startedAt }`,
  written after the port (17330..17345 on 127.0.0.1) is bound, removed on exit.
  Every request needs the token (`x-gate-token` header or `?__token=`).
- `~/.personas/gate-daemon.log` is the daemon's stderr.
- The fingerprint hashes `tsconfig.json`, `eslint.config.js`, `eslint-rules/`,
  `scripts/census/rules.json`, `scripts/census/lib/*.mjs`, `scripts/gate/*.mjs`
  and the lockfile(s) **of the base checkout**. A mismatch makes the client stop
  the old daemon and start a new one. Editing the daemon sources in a worktree
  does not change the base's fingerprint; use `--stop` to pick them up.
- The daemon watches the base's `src/`, `src-tauri/src/`, `scripts/`, `docs/` and
  invalidates the workers' caches (debounced 300 ms). The next request then
  refreshes the base diagnostics before overlaying, so a save in the base between
  requests costs one extra incremental build.
- Idle reaper: exit after 45 minutes without a request. RSS cap: 4 GB, checked
  after every request; above it the daemon exits and the next client restarts it.
- Manual start: `node --expose-gc scripts/gate/daemon.mjs --base <main checkout>`
  (`--expose-gc` lets the tsc worker release the previous program after a rebuild).

## Fallback rule

The client prints exactly one line, `gate: daemon unavailable (<reason>), running cold`,
and runs in `--root`: `tsc --noEmit -p tsconfig.json`,
`eslint --cache --cache-location .eslintcache <changed files or src/>`,
`node scripts/census/run-census.mjs --check`, `vitest related <changed> --run`.
It also runs cold any single gate the daemon reports as `unavailable` (worker file
missing, worker crashed). A daemon serving a different base than the requested
root's repository is treated as unavailable.

## Tests

```bash
node --test "scripts/gate/__tests__/*.test.mjs"
```

`overlay` builds a throwaway repo + worktree and asserts the exact file set;
`fingerprint` asserts determinism and sensitivity; `tsc-worker` drives the worker
through base, introduced, fixed, deleted, added, base-dirty and healed states and
asserts the program was reused; `census-worker` drives the census worker through
base, introduced, inherited base drift, resolved, own-registry and structural
states and asserts the base evaluation is cached across requests.

## Measured (2026-09-07, this machine, base at 6,651 program files / 4,683 roots)

| | |
|---|---|
| cold `npx tsc --noEmit` on the base | 65.8 s, 0 errors |
| daemon tsc warm-up (same program in-process) | 55 to 58 s, 0 errors (parity) |
| first worktree request, overlay of 44 files including a base-dirty hub type | 56 to 58 s (its importers are rechecked) |
| repeat request, same overlay | 1.0 to 1.5 s in the worker, 3 s wall (1.6 s of it is git for the overlay) |
| RSS with all four workers warm | 3.4 GB |
