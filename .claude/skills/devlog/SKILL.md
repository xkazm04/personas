---
name: devlog
memory: none
category: Maintenance
description: Read the dev server's structured logs through the devlog digest, rank the performance problems, errors and lying or repeating warnings a real dev session produced, gate once on the top findings, fix them one commit each, and track every finding by fingerprint until a later session confirms it gone. Invoke with `/devlog` (last dev session), `/devlog 24h`, `/devlog walk` (drive every sidebar section first), or `/devlog ledger`.
argument-hint: "[last|<boot-id>|24h|7d|walk|ledger]"
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, AskUserQuestion
version: 1.0
---

# /devlog - dev-session log doctor

The app writes every record (Rust, WebView, toolchain) as one JSON object per line with a stable
fingerprint (`fp`). `npm run devlog` turns those files into a ranked, budgeted digest. **This skill
reads the digest, never the raw logs.** The raw files are tens of megabytes; the digest is the
measured, grouped, costed view of them, and drilling into one finding is `show --fp <fp>`.

Reference: `docs/development/devlog.md` (what is captured, the envelope, the CLI).
Doctrine: `docs/concepts/golden-paths/structured-logging.md`,
`docs/concepts/golden-paths/query-latency-instrumentation.md`,
`docs/concepts/golden-paths/swallowed-error-telemetry.md`; registry subjects
`observability-telemetry` (log-architecture) and `perf-instrumentation` (probe-cost-budgeting,
in-flight-visibility), resolved through `../ai-registry/knowledge/software-engineering/index.json`.

## Phase 0 - Preflight

1. `git status --short` - classify what is not yours; this repo runs parallel sessions. Repo law
   (`.claude/CLAUDE.md` parallel-safety primitives) applies to every commit below.
2. `npm run devlog -- sessions` - pick the window. Default: the newest **debug-profile** boot
   (dev and prod share one logs dir). `24h`/`7d` -> `--since`. A boot id -> `--session`.
3. `walk` argument: the app must be running under `npm run tauri:dev:test` (test-automation on
   :17320). Run `npm run devlog -- walk`, keep the printed `walk_id`, and digest with `--walk <id>`.
   If :17320 is down, say so and fall back to the last session; never start the app yourself.

## Phase 1 - Digest

`npm run devlog -- digest <window> --budget 120`. Read the **Coverage** section first:

- A producer marked `NOT CAPTURED` means its whole SOURCE (rust, webview or toolchain) sent
  nothing in the window: *nobody looked*. Say which producers were dark, in the report, before any
  finding. (The common causes: the session was not started through a `tauri:dev*` script, so the
  toolchain wrapper never ran; or the boot was a release build, where the WebView sends only
  errors and slow IPC.) `0 (<source> live)` is different: the source was reporting and this
  producer had nothing to say - a real zero.
- A `devlog.capture_error` row in Toolchain means the wrapper failed on a line it could not
  parse; it records up to 20 per session with the line. Re-run with `DEVLOG_RAW=1` to keep the
  child's raw output beside the logs before guessing at the parser.
- Then work through the ranked sections. Each row carries `fp`, count, cost, sample, callsite
  `file:line` and the owning context from `context-map.json`.

For any row you will act on, run `npm run devlog -- show --fp <fp>` once - field value
distributions tell you whether a warning is one stuck persona or every persona, whether a slow
command is slow for one argument or always. Never `cat`, `grep` or `Read` a `*.jsonl`/`*.log` file
directly; if the digest cannot answer a question, the gap is a CLI feature to note in the report.

## Phase 2 - Classify and diagnose

Classify each candidate into exactly one class and read the code at its callsite:

| Class | Signature in the digest | First question |
|---|---|---|
| **error** | Errors section; webview `error` kind | Is it a real failure, and did it reach a door (toast/Sentry)? |
| **lying warn** | WARN that fires every run / every boot | Is anything actually degraded? (log-architecture: a warn on every run is a lie at the vocabulary level) |
| **repeat failure** | high count + `log.suppressed` | Is a loop retrying something that can never succeed (no backoff, no state change)? |
| **slow IPC** | Slow IPC p95 over budget | Is the command sync and touching rusqlite on the IPC thread? Over-fetching? Called in a render loop? |
| **slow DB** | Slow DB (table/op) | `EXPLAIN QUERY PLAN`; missing index; lock contention (`acquire_logged` wait); write inside a long transaction |
| **slow span** | Rust spans busy_ms | Which child work dominates? |
| **render** | long tasks by route; slow commits by profiler id | Which store subscription re-renders the section? Missing `useShallow`, unstable selector, big list without virtualization |
| **boot** | Boot phases | Which phase; is it blocking the window or only the backend? |
| **toolchain** | cargo warnings, vite errors, build time | A warning is a real defect or a lint to fix at the source, never to `#[allow]` without a reason |

Diagnosis rules:
- **A slow command with no Rust attribution gets instrumented before it gets fixed.** Add
  `#[tracing::instrument(skip_all, fields(...))]` to the command and its one engine/repo call; the
  next session's `span.close` records will say where the time goes. That instrumentation is itself
  a legitimate one-commit fix (class `slow IPC`, note `instrumented, awaiting attribution`).
- **A finding read off one session is a hypothesis.** Name the case that provoked it and one
  neighbour that did not (another persona, another section, another command of the same shape);
  check both in `show --fp` before proposing a fix.
- Consult the golden path for the class before proposing; if this repo already records the item as
  a known deviation there, cite it instead of rediscovering it.

## Phase 3 - One gate

Rank by digest cost. Present the top findings (default 8, at most 12) in ONE AskUserQuestion,
`multiSelect: true`, batching into several questions of up to 4 options when needed. Each option:
`[class] <what> - <evidence: count / p95 / file:line> -> <proposed fix in one line>`, and when a fix
has a condition or a risk, name it in the option text. Items not selected are written to the ledger
as `open` (or `wontfix` when the operator says so) so the next run does not re-ask them blindly.

## Phase 4 - Fix

For each approved finding, in cost order:
1. Implement the smallest fix that removes the cause (demote a lying warn to `debug!`; add backoff
   or a state transition to a retry loop and log the transition once; move a sync DB command to
   `spawn_blocking`; add the index through the migration path in `.claude/rules/rust-backend.md`;
   fix the selector). Follow `.claude/rules/rust-backend.md` and `.claude/rules/ui.md` for the
   files you touch.
2. Run the gates for what you touched (`npm run gate -- --cold`; for Rust `npm run test:rust --
   <filter>` and read its output, clippy no new warnings; targeted vitest files only - this repo's
   full vitest run does not terminate).
3. Commit **one finding per commit** with the isolated-index ritual from `.claude/CLAUDE.md`, in ONE
   bash invocation, message `fix(<area>): <finding>` with the fp in the body (`devlog-fp: <fp>`).
   Verify `git log --oneline -1` is yours.
4. `npm run devlog -- ledger set <fp> fixed --sha <sha> --note "<one line>"`.

## Phase 5 - Verify

- **Route-reproducible** findings (render, slow IPC on a section, boot): when the app is up under
  `tauri:dev:test`, re-run `npm run devlog -- walk` after the fix lands in the running build
  (Rust changes need the app rebuilt - say so instead of claiming a verification), then
  `npm run devlog -- diff --before <walk-before> --after <walk-after>`. Quote the verdict rows.
- **Everything else** stays `fixed, unconfirmed`. The ledger promotes it to `confirmed` when a later
  dev session no longer produces the fp, or `regressed` when it does; the digest's Ledger section
  shows those transitions on the next run.
- Never call a finding fixed on a typecheck alone.

## Phase 6 - Report

One short report: window digested, dark producers, findings fixed (fp, sha, verification state),
findings left open, and any digest gap that forced a guess. Then:
`npm run devlog -- ledger list` tail, so the operator sees the ledger state.

## Invariants

- Digest, never raw logs. A question the digest cannot answer is a CLI gap to report.
- Found nothing and looked at nothing are different outcomes; the Coverage section decides which.
- One gate, then autonomous fixing of exactly what was approved. No scope growth beyond the gate.
- Never re-baseline a census rule or `#[allow]` a lint to make a finding disappear.
- Never start, stop or restart the operator's app.
