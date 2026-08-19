---
layer: application
subject: observability-telemetry
technique: rotation-and-retention
stack: rust
---

# Rust — rotation, retention, and disk accounting in `src-tauri/src/logging.rs`

How the technique's three numbers — unit bound, set bound, reaper — are
implemented for the two record stores this app owns, and where the
accounting drifts from its predicate.

## Rotation: daily rolling with a file cap

`add_file_layer` (`logging.rs:121-127`) builds the rolling appender:

```rust
rolling::RollingFileAppender::builder()
    .rotation(rolling::Rotation::DAILY)
    .filename_prefix("personas")
    .filename_suffix("log")
    .max_log_files(TRACING_LOG_RETENTION)   // 7 (:40)
    .build(&log_dir)
```

Names encode the boundary (`personas.YYYY-MM-DD.log`), so a descending
lexical sort is a chronological sort — both humans and the reaper order
the set without opening files. Graceful degradation is explicit: an
unwritable directory logs a warning and disables file logging rather
than failing boot (`:98-101`, `:138-140`).

Note the technique's named hole is present: rotation is interval-only.
A pathological error loop can grow one day's file without limit — there
is no size cap within the interval and no total-byte cap on the set
(the retention constants are file *counts*).

## Retention: two reapers, both startup-run, both pattern-scoped

- `prune_orphan_personas_logs` (`:194-224`) — belt-and-braces beside
  the appender's own rotation-time enforcement, run at startup before
  the new appender starts writing (`:118`), for the case where the cap
  was reduced between runs. It matches only `personas.*.log` and
  explicitly preserves `last_boot.log`, UUID-named execution logs, and
  freeze-monitor dumps — the technique's "the reaper reaps only what it
  owns", with a unit test pinning exactly that
  (`prune_orphan_personas_logs_ignores_other_files`, `:486-524`).
- `prune_crash_logs` (`:345-373`) — bounds the crash directory to
  `CRASH_LOG_RETENTION` (20, `:34`) before the panic hook is installed
  (`:240`), "so the diagnostics surface starts in a known state".

Deviation from the technique: the crash-store cap is enforced *only* at
startup, not on insert — the panic hook (`:245-299`) writes without
re-pruning, so a crash-looping process can exceed 20 files within one
run; the excess is clawed back on the next boot. And reaping is silent
on success — only failures log (`:220-222`), so a reaper that stopped
running is not distinguishable from one with nothing to do.

## Accounting: measure by walking

`log_directory_stats` (`:413-436`) recomputes the footprint from the
directory itself (`directory_stats`, `:395-409` — a flat walk summing
`metadata().len()`), never from a maintained counter, and reports the
retention caps *alongside* the measured numbers
(`tracing_log_retention`, `crash_log_retention`) so the settings
surface can show promise and reality together. Exposed to the UI via
`get_log_directory_stats`
(`src-tauri/src/commands/infrastructure/system/crash_telemetry.rs:49-59`)
and rendered with retention hints in
`src/features/overview/components/health/LogDiskUsageSection.tsx`.

The predicate drift, measured: `log_bytes` sums **every** file in the
logs directory — including the unbounded per-execution `<uuid>.log`
population that no retention constant governs — while
`tracing_log_retention: 7` prints beside it. On the operator's machine
that read "retention: 7 files" next to a number derived from 2,999
files / 410 MB (`docs/concepts/golden-paths/structured-logging.md` §7
P0). The count traveled without its predicate, and the diagnostics
surface reassured while the directory grew 60× past what the stated cap
could produce.
