---
layer: application
subject: observability-telemetry
technique: log-architecture
stack: rust
---

# Rust — log architecture in `src-tauri/src/logging.rs`

The technique's four decisions — record shape, level vocabulary, filter
topology, write path — as they land in this repo's `tracing` +
`tracing_subscriber` + `tracing_appender` stack.

## One sink, many taps — the subscriber registry

`logging.rs:55-90` (`init()`) builds exactly the fan-in/fan-out shape the
technique prescribes: one `tracing_subscriber::registry()` receives every
`tracing::*!` call in the process, then fans out to three destinations
with per-destination formatting:

- `stdout_layer` — colored, compact, for the dev console (`:59-64`);
- `file_layer` — same events, `with_ansi(false)`, routed through the
  deferred writer to a rolling daily file (`:66-72`);
- `sentry_layer` — the remote tap, mapping `ERROR` → event and `WARN` →
  breadcrumb, everything else ignored (`:76-80`). This is the
  level→telemetry-class coupling remote-telemetry-economics warns about,
  wired in six lines.

## Per-origin filtering — `EnvFilter`, and a cautionary tale

`EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info,personas_desktop=debug"))`
(`:56-57`) gives global `info` with a per-crate `debug` override, and
`RUST_LOG` as the runtime escape hatch — the technique's "filter at the
origin" in one line.

Two gaps, both instructive:

- **The origin name went stale.** `personas_desktop` is the binary
  crate's old target root; after the workspace extraction the real code
  compiles as `app_lib` / `personas_core` / `personas_db` /
  `personas_engine`, so the `debug` directive matches a crate that emits
  zero `debug!` calls and all ~301 of them are silenced by the global
  `info`. Measured in `docs/concepts/golden-paths/structured-logging.md`
  §7 P2: six days of real logs contain 0 DEBUG lines. This is the
  technique's "origins are stable names" rule, violated and paid for.
- **No runtime reload.** The filter is read once at process start;
  there is no `tracing_subscriber::reload` layer, so "raise module X to
  debug" requires a relaunch with an env var — the machine exhibiting
  the defect can't be opened up live.

## The non-blocking write path

`add_file_layer` (`:96-142`) builds a `RollingFileAppender` (daily,
`max_log_files(TRACING_LOG_RETENTION)`) and wraps it in
`tauri_appender::non_blocking` — emitters append to a bounded channel, a
worker thread drains to disk. The `WorkerGuard` is stashed in a static
`OnceLock` (`FILE_LOG_GUARD`, `:18`) so the buffer flushes on orderly
shutdown — the technique's "flush is explicit at the exits". Crash-path
records deliberately do *not* go through this channel: the panic hook
(`install_crash_hook`, `:228-302`) writes synchronously to its own store,
exactly the split the technique mandates.

Not present: a visible dropped-records counter. `NonBlocking`'s default
policy is drop-on-full and the drop count is not surfaced anywhere — the
"count the drops" half of the overflow prescription is unimplemented.

## Record shape — fields exist; adoption is the battle

The stack supports the structured envelope natively
(`with_target(true).with_file(true).with_line_number(true)`, fields
before message). Adoption is measured, not assumed:
`docs/concepts/golden-paths/structured-logging.md` counts 2,118 of 2,653
call sites carrying structured fields (79.8%) and 288 interpolated-only
sites, with `src-tauri/db/src/backup.rs:107-112` as the shape to copy —
fields first, `%`-Display, constant message naming the consequence.

## The known counter-example

The one-sink rule is broken by `ExecutionLogger`
(`src-tauri/engine/src/logger.rs`) — a second appender with no level, no
fields, no filter, no retention, and no scrub point, measured holding
99.1% of the log bytes on the operator's machine, including live
credentials. It is this subject's strongest evidence that "the writer is
the scrub point" and "no private diaries" are not stylistic preferences.
