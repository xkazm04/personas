# Warm Verification Service — the gate daemon

> **Status:** Plan 1 of the fleet-CPU pair (this doc, executed 2026-09-07) and
> [`linux-fleet-filesystem.md`](linux-fleet-filesystem.md) (Plan 2, deferred until a
> measured bottleneck). Operator directive 2026-09-07: "prepare separate plans for
> points 1 and 2, with aim to execute 1 in this session, 2 later after we hit
> bottlenecks in the future".
> **Last updated:** 2026-09-07

---

## Why

A dozen Claude Code sessions on one 16-thread box do not spend their CPU in
Claude. Measured 2026-09-07 on the operator's machine, over a ten-day Windows
Terminal uptime:

| Consumer | Evidence |
|---|---|
| 16 interactive `claude.exe` sessions, idle | 37% of one core combined |
| Windows Terminal (renderer for 17 panes) | 26,635 CPU-seconds, more than every session combined |
| Vite dev server watching agent worktrees | half a core sustained (fixed in `2262c5090`) |
| The gates the agents run | the whole bill under load |

Under load the cost is the verification chain each agent runs before each atomic
commit. The repo has measured it twice
([`adding-a-ci-gate.md:198-209`](../concepts/golden-paths/adding-a-ci-gate.md),
[`commit-path-gates.md:547-559`](../concepts/golden-paths/commit-path-gates.md)):

| Gate | Cold, one machine | Shape |
|---|---|---|
| `check:tiers` (three `vite build`s) | 216 to 398 s | bundling, never fails on a type error |
| `tsc --noEmit` | 218 to 290 s | whole `src/`, **no `incremental`, no tsBuildInfo** |
| `census:check` | 178 s | **205 rules, each re-walking and re-reading the same tree**: 518,843 file visits over ~6,500 files |
| `eslint src/` | 99 s | file-scopable (pre-commit already does it), **no `--cache`** |
| everything else in `npm run check` | 1 to 5 s each | fixed small file sets |

Thirty agents each paying this cold, per item, is thirty cold `tsc` programs of
5,249 files and thirty census walks of the same ~6,500 files. Nothing about the
model or the CLI is involved. The lever is to run the work once, keep it warm,
and answer each agent with the delta.

Two recorded defects make the shape of the answer concrete:

- [`scan-sweep/SKILL.md:591-599`](../../.claude/skills/scan-sweep/SKILL.md): "Under a
  concurrent session, a whole-tree gate says nothing about your change." A gate that
  answers for a **named worktree against a base** is the missing primitive.
- [`.claude/perfect/config.md:118`](../../.claude/perfect/config.md): "a truncated
  gate output is not a gate result." A Director read `tail -25` of a census run and
  reported 4 drifted rules when the real number was 10. A structured JSON verdict
  removes that failure class.

## Approaches considered

1. **A Rust router inside the app's `local_http` chassis** (`src-tauri/src/local_http/`,
   port 17400+, one auth layer, restart-stable token). It is the repo's preferred home
   for a local HTTP surface, and a Claude Code session already reads its handshake
   file. **Rejected for v1:** every warm object (a `ts.Program`, an `ESLint`
   instance, the census index) is a JavaScript object, so the Rust side would only
   proxy to a Node child, and the app is not running when most agents work in
   worktrees overnight. A `/verify` proxy router can be mounted later so the app's
   own workers reach the same daemon; the daemon's handshake mirrors `local_http`'s
   so that is a small change.
2. **Per-worktree warm state** (one `tsc --watch` per checkout). Simple, but thirty
   worktrees means thirty cold programs and one to two gigabytes each, and an LRU
   across them thrashes exactly when the fleet is busiest. **Rejected** as the
   primary model; kept as the fallback for a root whose base is not the main
   checkout.
3. **One warm base, per-request overlay. Chosen.** The daemon holds one warm
   program built from the main checkout. A request for a worktree computes the set
   of files where that worktree differs from the base (git knows: files changed
   against the base commit in the worktree, plus files dirty in the main checkout,
   plus untracked on either side), overlays those contents through the compiler
   host, and rebuilds incrementally. The builder program re-checks only the
   affected files. The answer is the full diagnostic list **and** the delta against
   the base's own diagnostics (`introduced` / `resolved`), so a red base does not
   make every worktree red. The same overlay feeds the census index, so a census
   verdict for a worktree is 205 regexes over an in-memory tree, not a walk.
4. **A queue/dispatcher daemon for sessions** was rejected in
   [`cli-coordination.md:54-56`](cli-coordination.md) because it "defeats
   parallelism" and is a single point of failure. That rejection was about
   coordinating *agents*. This daemon is a **cache**, not a coordinator: agents
   never wait on each other except inside one bounded FIFO per heavy worker, and
   when the daemon is down the client falls back to the cold commands with the
   same exit semantics. It changes latency, never authority.
5. **Warming `check:tiers`.** Three Vite builds cannot be made incremental
   honestly. **Decision:** it leaves the per-item lane. `npm run check` keeps it for
   push and CI; the fast lane (`npm run gate`) does not run it.

The daemon is an application of two registry techniques and should be judged
against them by `/conform`:
[`session-reuse.md`](../concepts/paths/subprocess-lifecycle/techniques/session-reuse.md)
(warm state keyed by a configuration fingerprint, idle warmth still names its
reaper) and
[`concurrency-and-slots.md`](../concepts/paths/subprocess-lifecycle/techniques/concurrency-and-slots.md)
(a bounded queue that refuses past a stated depth; the slot is released by the
reap, not the happy path).

## Implementation v1

### Layout

```
scripts/gate/
├── gate.mjs            client CLI: `npm run gate` (auto-starts the daemon, falls back cold)
├── daemon.mjs          HTTP front + scheduler; spawns one worker_thread per engine
├── handshake.mjs       ~/.personas/gate-daemon.json {port, token, pid, fingerprint}
├── overlay.mjs         computes the worktree-vs-base file set via git, reads contents
├── fingerprint.mjs     hash of tsconfig, eslint config + rules, census rules, lockfile, daemon sources
├── workers/
│   ├── tsc.mjs         warm SemanticDiagnosticsBuilderProgram + overlay CompilerHost
│   ├── eslint.mjs      warm ESLint instance per root, --cache, changed files only
│   ├── census.mjs      in-memory index (walk once, read once) + engine.mjs assertions
│   └── vitest.mjs      `vitest related <changed>` in the root (not warm in v1)
└── __tests__/          parity tests: daemon verdict == cold command verdict
```

### Contract

`POST /gate` with `{root, gates: ["tsc","eslint","census","vitest"], files?: [...]}`
returns:

```json
{
  "root": "C:/.../.claude/worktrees/x",
  "base": {"root": "C:/.../personas", "head": "db58d4b00"},
  "overlay": {"changed": 7, "deleted": 0, "untracked": 2},
  "tsc":    {"ok": false, "errors": [...], "introduced": [...], "resolved": [...], "ms": 3100},
  "eslint": {"ok": true,  "files": 7, "errors": 0, "warnings": 3, "ms": 900},
  "census": {"ok": false, "structural": [], "drift": [{"rule": "...", "files": [12, 11], "matches": [13, 12]}], "ms": 2400},
  "vitest": {"ok": true,  "related": 4, "passed": 4, "failed": 0, "ms": 21000}
}
```

`ok` for `tsc` means **no introduced errors** when a base exists, and no errors at
all when the root is the base. The client prints a table and exits non-zero on any
`ok: false`, exactly like the cold chain. `--json` prints the object. `--cold` runs
the underlying commands instead, which is also what happens when the daemon cannot
be reached, with a one-line notice so a log never mistakes one for the other.

### Scheduling and lifecycle

- One daemon per machine, port scan from 17330, token in the handshake file, host
  allowlist `127.0.0.1`. Pattern copied from `local_http/auth.rs`.
- One `worker_thread` per engine so a rebuild never blocks the HTTP loop. Each worker
  is a FIFO with depth 32; the 33rd request is refused with 429 and the client
  falls back cold. A request's slot is released in `finally`, never on the happy
  path only.
- Warm state is keyed by the fingerprint. A fingerprint change (someone edits
  `tsconfig.json`, `rules.json`, an eslint rule, the lockfile, or the daemon itself)
  makes the client restart the daemon before sending.
- Base freshness: a chokidar watch on the main checkout's `src/`, `src-tauri/src`,
  `docs/`, `scripts/` (the census roots) marks files dirty; the next request
  re-reads only dirty files before overlaying. No watch on worktrees at all.
- Idle reaper: the daemon exits after 45 minutes without a request. The client
  restarts it on demand, cold-build cost once.
- Memory budget: one warm program (about 1.5 GB) plus the census index (about
  150 MB) plus per-root ESLint instances. Stated cap: 4 GB; the daemon logs RSS on
  every request and restarts itself above the cap.

### Cold-path wins that need no daemon (shipped in the same change)

- `tsconfig.json`: `incremental: true`, `tsBuildInfoFile` under `node_modules/.cache/`.
  Every cold `tsc --noEmit` after the first reuses the build info.
- `eslint --cache --cache-location node_modules/.cache/eslint/` in `npm run check`
  and the pre-commit job.
- `npm run gate` and `npm run check:fast` in `package.json`; `check:tiers` stays in
  `check` only.
- `scripts/census/lib/engine.mjs` walks once and reads once, then runs every rule
  over the shared index. Per-rule `walked` / `files` / `matches` are computed from
  the index with the rule's own roots, extensions and excludes, so every number and
  every fail-loud assertion is unchanged. `scripts/census/self-test.mjs` proves it.

### Adoption order (by caller frequency, from the 2026-09-07 caller map)

1. `.claude/perfect/config.md` and `.claude/spark/config.md` builder gates:
   `npm run gate` replaces `npx tsc --noEmit | npm run lint | targeted vitest`.
2. `CLAUDE.md` "PR self-review": `npm run gate` is the per-item lane, `npm run check`
   the pre-push lane.
3. lefthook pre-push `typecheck` and `golden-path-census` jobs: routed through the
   client **only after** the parity tests in `scripts/gate/__tests__/` have run
   against a real dirty tree and matched the cold verdicts. Until then pre-push
   stays cold.
4. Fleet charters (`feed_impact.rs:175`): the "run this repo's own gates" instruction
   names `npm run gate` first.

### Rust (outside the daemon)

`sccache` as `RUSTC_WRAPPER` locally (CI already has it,
`.github/workflows/ci.yml:273-291`) and restoring `lld-link` for x86_64 in
`src-tauri/.cargo/config.toml` once `winget install LLVM.LLVM` is done. Do **not**
unify `CARGO_TARGET_DIR` across agents: the separate `target-clippy` /
`target-bindings` / `.personas-e2e-target` scheme exists so concurrent sessions do
not evict each other's artifacts, and sccache gives the sharing without the
eviction.

## What "done" means for this session

- `npm run gate` answers for the main checkout and for a worktree, with the
  overlay delta visible in the output.
- Parity: for the main checkout, the daemon's `tsc` error count equals
  `npx tsc --noEmit`'s and the census verdict equals `npm run census:check`'s.
- Measured before/after on this machine, recorded in the "Measured" section below.
- Two builders' overlays and `CLAUDE.md` point at the fast lane.

## Measured (2026-09-07, this machine, master at `bd621adac`, 16 sessions live)

All numbers from `node scripts/gate/gate.mjs --root <worktree> --gates tsc,eslint,census`
run from the `gate-daemon` worktree whose overlay against master was 21 changed,
19 added, 9 deleted. The base was dirty with a sibling's regenerated
`src/lib/commandNames.generated.ts`, a hub type imported nearly everywhere.

| Request | Wall | tsc | eslint | census |
|---|---|---|---|---|
| Cold: daemon start + first worktree verdict | 112 s | 56.6 s, rechecked 6,592 of 6,651 files | 0.3 s, 19 files | 15.0 s (worktree eval + first base eval) |
| Warm: same worktree again | 16 s | 0.65 s, rechecked 0 | 4 ms | 14.7 s (base re-evaluated after sibling edits invalidated it) |
| Warm: the main checkout itself | 8 s | 0.70 s, rechecked 1 | 0.67 s, 3 dirty files | 7.4 s, full `--check` verdict |

Reference cold costs on the same box the same day: `npx tsc --noEmit` 65.8 s
(0 errors, the same count the daemon's warm base reports), `census:check` 43.7 s
before the walk-once engine and 7.6 s after, and a warm incremental
`tsc --noEmit` 6 s once `tsconfig.json` carries `incremental`.

What the table says:

- **The first worktree verdict is not cheap when the base is dirty on a hub
  file.** TypeScript rechecked 6,592 files because the base's generated command
  list differed from the worktree's. That is incremental compilation doing its
  job, not a cache miss (`reuse: completely`). A clean base makes the first
  worktree request the size of its own diff.
- **A repeated verdict is seconds, and tsc is no longer the cost.** The census's
  regex pass over 9,177 in-memory files is now the floor at about 7 s, doubled
  when sibling edits to the main checkout invalidate the cached base evaluation
  between requests. Splitting the 205 rules across worker threads is the next
  lever if that floor matters.
- **Memory:** 3.47 GB RSS with all four workers warm, under the 6 GB cap.
- **Semantics held:** the base request fails on the three census drifts master
  really carries; the worktree request passes with those three shown as
  inherited and none introduced.

Done against the session's definition: `npm run gate` answers for the main
checkout and for a worktree with the overlay visible; tsc parity with the cold
command (0 errors both) and census parity (same three drifts) are recorded above;
`.claude/perfect/config.md` and `CLAUDE.md` point at the fast lane. Not done, by
decision: routing lefthook pre-push through the daemon waits for a parity run on a
tree with real type errors, and `.claude/spark/config.md` does not exist in this
checkout.
