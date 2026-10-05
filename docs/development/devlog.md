# devlog: the dev server's logs, queryable

`npm run devlog` turns what a dev session wrote into a ranked digest: errors,
repeating warnings, slow IPC, slow DB queries, long tasks and slow commits,
boot phases, toolchain diagnostics, and which producers wrote nothing at all.
The `/devlog` skill reads that digest instead of raw log files.

Code: `scripts/devlog/`. Tests: `npm run test:devlog`
(`node --test scripts/devlog/__tests__/*.test.mjs`).

## What is captured, and where

Everything lands in one directory, the app's logs dir:

| Platform | Logs dir |
| --- | --- |
| `PERSONAS_DATA_DIR` set | `$PERSONAS_DATA_DIR/logs` |
| Windows | `%APPDATA%\com.personas.desktop\logs` |
| macOS | `~/Library/Application Support/com.personas.desktop/logs` |
| Linux | `~/.local/share/com.personas.desktop/logs` |

`--logs <dir>` (CLI) or `DEVLOG_LOGS_DIR` overrides it. Dev and release builds
share the directory, which is why the digest filters by profile.

| File | Writer | Contents |
| --- | --- | --- |
| `personas.YYYY-MM-DD.jsonl` | the app's tracing file layer (Rust) | every Rust event, `boot.start`, `span.close`, `log.suppressed`, and the WebView records forwarded through `devlog_ingest` (`webview::<kind>`) |
| `personas.YYYY-MM-DD.log` | the app, before the JSONL sink | legacy text; read so the first digest has history |
| `toolchain.YYYY-MM-DD.jsonl` | `scripts/devlog/run.mjs`, the Vite plugin, `devlog walk` | cargo/tauri/Vite diagnostics, `cargo.build`, `session.*`, `walk.*` |
| `last_boot.log` | the app | the newest boot's startup timing table |

Daily files use the UTC date. The UUID-named `.log` files in the same dir are
per-execution engine logs; devlog does not read them.

### Toolchain capture

Every `tauri:dev*` script runs through `scripts/devlog/run.mjs`
(`tauri:dev`, `tauri:dev:lite`, `tauri:dev:stable`, `tauri:dev:test` via
`scripts/dev/tauri-dev-test.mjs`, `tauri:dev:test:full`). The script names are
unchanged, so their `pre*` hooks still run. The wrapper:

- spawns the tauri CLI (`node @tauri-apps/cli/tauri.js dev <args>`, no shell)
  with piped output and writes every chunk to the terminal unchanged;
- keeps colour: when the terminal is a TTY the child gets
  `CARGO_TERM_COLOR=always`, `FORCE_COLOR=1`, `CLICOLOR_FORCE=1` unless already
  set (`DEVLOG_COLOR=0` turns this off). The ones it set are listed in
  `PERSONAS_DEVLOG_FORCED_ENV` and the app removes them at the top of
  `main()`, so only the toolchain sees them, never the CLIs the app spawns;
- splits a line at every bare `\r` before parsing, as a terminal renders it:
  cargo's progress bar redraws in place and the next real line (`Finished`,
  `warning:`) arrives on the same `\n` line;
- never switches capture off: a line it cannot parse, or a record it cannot
  build, costs that line and is recorded as `devlog.capture_error` (up to 20
  per session, shown in Toolchain). `DEVLOG_RAW=1` also writes the child's raw
  output, ANSI intact, to `toolchain-raw.<session>.log` in the logs dir;
- sets `PERSONAS_DEVLOG_SESSION=<uuid>`; the app records it in `boot.start`, so
  an app boot and its toolchain session join both ways;
- records cargo `warning:` / `error[E....]:` / `error:` blocks (one record per
  block: `f.code` = lint name or E-code, `f.text` = first line, `file`/`line`
  from the first `-->`), one `cargo.build` per `Finished ... in Xs`
  (`f.duration_s`), tauri CLI `Error`/`Warn` lines, and Vite lines printed
  before Vite reports `ready` (config and port failures). Progress lines
  (`Compiling`, `Checking`, ...) are not recorded;
- writes `session.start` (`f.script`, `f.args`, `f.cwd`, `f.node`,
  `f.git_sha`) and `session.end` (`f.exit_code`, `f.duration_ms`);
- on Ctrl+C waits for tauri to wind down (the console signals the whole tree),
  forwards the signal after 3 s and kills the tree after 8 s; propagates the
  child's exit code;
- keeps 7 `toolchain.*.jsonl` files; a logging failure prints one `[devlog]`
  line to stderr and the dev server carries on.

The Vite plugin (`scripts/devlog/vite-plugin.mjs`, registered in
`vite.config.ts` for `serve` only) owns Vite after `ready`: logger warnings and
errors (`f.plugin`, `f.id`, `file`, `line` from the error's `loc`), HMR error
payloads not already logged, and full-reload storms (more than 5 reloads in a
minute writes one WARN `vite.reload_storm`). It wraps the logger, so Vite's
output does not change. Under plain `npm run dev` it opens a session of its own.

## The envelope

One JSON object per line; an absent value means the key is omitted.

| Key | Meaning |
| --- | --- |
| `ts` | RFC3339 UTC, microseconds, `Z` |
| `lvl` | `ERROR` `WARN` `INFO` `DEBUG` `TRACE` |
| `src` | `rust` `webview` `toolchain` |
| `tgt` | tracing target, `webview::<kind>`, or `cargo` `vite` `tauri` `devlog` |
| `file`, `line` | callsite (Rust paths are relative to `src-tauri/`) |
| `msg` | constant message |
| `fp` | fingerprint, 8 lowercase hex |
| `boot` | app process uuid; toolchain records carry the wrapper's session id |
| `span` | span names, outermost first |
| `f` | named fields |

## The fingerprint

`fp = fnv1a32(lvl + "|" + tgt + "|" + normalize(msg))`, where normalize
replaces UUIDs, paths, quoted strings, hex runs of 8+ and numbers with class
tokens. Toolchain diagnostics (records with `f.code`) use
`fnv1a32(lvl|tgt|code|file)` with forward-slash paths. Reference:
`scripts/devlog/fingerprint.mjs`; the vectors in `fp-vectors.json` are tested
by both the Node suite and the Rust sink.

Perf groups (one IPC command, one table/operation, one route, one span) share
a constant message, so the digest gives each group a derived fp,
`fnv1a32("perf|<section>|<key>")`. `show` and `diff` accept both kinds.

## The CLI

```bash
npm run devlog -- sessions [--all]
npm run devlog -- digest [--session last|<id>] [--since 24h|7d] [--walk <id>] [--budget 120] [--json] [--all-profiles] [--apply-ledger]
npm run devlog -- show --fp <fp> [--n 5] [--session <id>|--since <dur>|--walk <id>]
npm run devlog -- diff --before <walk|session> --after <walk|session>
npm run devlog -- ledger list
npm run devlog -- ledger set <fp> <open|fixed|confirmed|regressed|wontfix> [--sha <sha>] [--note "..."]
npm run devlog -- walk [--port 17320] [--sections all|a,b]
```

- `sessions`: app boots and toolchain sessions, newest first, with record
  counts by level and the joined session. Release boots are hidden unless
  `--all`.
- `digest`: the default selection is `--since 24h`. A session id may be a
  prefix. Records from release boots are dropped unless `--all-profiles`;
  legacy boots have profile `unknown` and count as dev.
- `show`: first/last seen, count, the top 5 values of every field (min, p50,
  p95, max for numeric ones), the sessions it appeared in, and N samples.
- `diff`: per fp and per perf group, count and p95 before vs after, with a
  verdict `regressed`, `new`, `improved`, `gone` or `same` (10% p95 band).

### Digest sections

In order: **Coverage** (each producer's count in the selection; `0 (<source>
live)` when its source - rust, webview or toolchain - was reporting and the
producer had nothing to say; `NOT CAPTURED` only when the whole source was
silent), **Boot phases** (setup total and each phase over 100 ms,
aggregated over the boots that logged their timing table; `last_boot.log`
stands in for the newest boot when its records lack the table), **Errors**,
**Repeating warnings** (fps seen at least twice or rate-limited; suppressed
counts from `log.suppressed` folded in; WebView `swallow_rollup` by tag),
**Slow IPC** (by command), **Slow DB** (by table and operation), **Render**
(long tasks by route, commits by profiler id), **Rust spans** (`span.close`
busy time by span), **Toolchain** (diagnostics by fp, cargo build durations),
**New since previous session** (WARN/ERROR fps in the newest app session of
the selection that the previous comparable session did not produce),
**Ledger** (entries in the window plus derived transitions).

A row is `fp`, `count`, `cost`, section columns, a sample message (first
occurrence, three fields abbreviated), the callsite `file:line` and its
context from `context-map.json` (exact file, else the deepest directory whose
files mostly belong to one context, else `-`).

Cost ranks rows inside a section:

| Kind | Cost |
| --- | --- |
| error | `1000 + count` (count includes suppressed repeats) |
| warning | `count x (1 + suppressed / (count + suppressed))` |
| perf | `sum(max(0, duration - budget))` ms |

Slow IPC: `count` and p50/p95 come from `ipc_window` records when present
(count-weighted p50/p95 across windows, so approximate) and from `ipc_slow`
otherwise; cost is the excess of the `ipc_slow` calls over their budget.

`--budget N` caps the rows printed across all sections except Coverage. Rows
are dealt round-robin so every non-empty section keeps its worst rows, and a
truncated section ends with `(+K rows cut)`. `--json` emits the same
structure.

## Budgets

`scripts/devlog/budgets.json`:

```json
{ "ipc_ms": 300, "db_ms": 100, "long_task_ms": 50, "commit_ms": 50, "span_ms": 200,
  "boot_phase_ms": 1000, "commands": { "<command>": 500 } }
```

`commands` overrides the IPC budget per command. `boot_phase_ms` prices the
Boot phases rows.

## The ledger

`.claude/devlog/ledger.jsonl`, append-only, one line per status change:
`{ts, fp, status, sha?, note?}` with status `open`, `fixed`, `confirmed`,
`regressed` or `wontfix`. The latest line per fp is its status. Each digest
re-judges it:

- `fixed` at T, absent from every dev session that started after T (at least
  one) -> `confirmed` candidate;
- `fixed` or `confirmed` at T, present in a dev session that started after T
  -> `regressed` candidate.

Candidates print in the Ledger section; `--apply-ledger` appends them.

## The walk

`npm run devlog -- walk` drives a running `npm run tauri:dev:test` instance
through the test-automation server (`:17320`, or `PERSONAS_TEST_PORT`). It
visits every `NAV_SECTIONS` id in `src/lib/navigation/registry.ts` whose
reachability is `sidebar` or `nested` (`overlay-only` and `hidden` have no
content route). Per section: `/perf/mark` start, `/navigate`, wait for idle,
`/perf/mark` end. Idle means `/perf/snapshot`'s IPC count unchanged for
600 ms (8 s ceiling); when the snapshot is unavailable a fixed 2.5 s settle is
used, and each `walk.section` record says which (`f.settle`). The walk writes
`walk.start`, `walk.section`, `walk.end` (`f.walk_id`) to the toolchain log;
`digest --walk <id>` reads the window they bracket (plus 2.5 s for the
WebView's flush), and `diff --before <walk> --after <walk>` compares two.
If the server is down it prints the start hint and exits 2.

## Legacy text logs

`personas.YYYY-MM-DD.log` lines are parsed into the same envelope:
`ts LEVEL [spans: ]target: file:line: message k=v k2="v"`, with continuation
lines kept in `f.detail`. Each `File logging enabled at` line (the first line
every boot writes) starts a pseudo-boot `legacy:<timestamp>`. Raw
`[ts] [WebView/level]` lines are skipped: their writer also logged the same
message through tracing (target `webview`), which is kept, re-targeted to
`webview::store_alert`, `webview::freeze` or `webview::error`.

## What is NOT captured

- The engine's per-execution logs (UUID-named `.log` files).
- Per-site `silentCatch` calls (only the 5-minute `swallow_rollup`).
- Async IPC timing on the Rust side: the router cannot see completion; the
  client end-to-end timing (`ipc_slow`, `ipc_window`) is the measurement.
- Vite output printed after `ready` that does not go through Vite's logger or
  HMR channel, and terminal output of processes not started by `tauri dev`.
- `npm run dev` / `tauri dev` started without the wrapper: no toolchain
  session, no `PERSONAS_DEVLOG_SESSION` join (the Vite plugin still records).
- Legacy text logs carry no profile, so dev and release boots there cannot be
  told apart.
