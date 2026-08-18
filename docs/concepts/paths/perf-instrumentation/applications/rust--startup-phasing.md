---
layer: application
subject: perf-instrumentation
technique: startup-phasing
stack: rust
---

# Startup phasing — the boot pipeline report

`src-tauri/src/startup_timing.rs` plus the `setup()` closure in
`src-tauri/src/lib.rs` implement the technique across the full pipeline,
including its defining move: the finish line in the other process.

## Owned phases, marks from inside

`StartupTimer::checkpoint(name)` is called ~35 times inline through
`lib.rs`'s setup — `"db_init"`, `"credential_migrations"`,
`"stale_execution_recovery"`, `"local_http"`, `"alert_evaluator"`, … —
each mark emitted immediately after the code that owns the phase, not by
an observer timing from outside. Each `StartupPhase` records both
`duration_ms` (since the previous checkpoint) and `elapsed_ms` against
the shared origin:

```rust
static PROCESS_START: OnceLock<Instant> = OnceLock::new();
```

set once at the top of `run()` — one time origin for every backend mark.
`finalize()` freezes the report into a `OnceLock` and `format_boot_log`
writes the phase table into the boot log, one aligned line per phase
with both duration and at-time.

## The cross-process report-back

```rust
pub struct StartupTimingReport {
    pub total_setup_ms: u64,
    pub phases: Vec<StartupPhase>,
    /// None until the frontend calls `report_frontend_ready`.
    pub frontend_tti_ms: Option<f64>,
}
```

The WebView measures its own time-to-interactive in `src/App.tsx`
(`performance.now() - window.__BOOT_TIME__`, the origin planted by a
one-line script at the top of `index.html` before any bundle loads) and
invokes `report_frontend_ready`, which lands in a second `OnceLock`
(`FRONTEND_TTI`) and is merged on read by `get_full_report()`. One
launch, one record, both processes — and `frontend_tti_ms: Option` is
missing-not-zero made structural: until the report-back arrives, the
field says *not reported*, never `0`.

## Where it bends the standard

Two honest gaps against the technique, worth knowing before citing this
as a complete instance:

- **Two time bases in one record.** Backend `elapsed_ms` counts from
  `PROCESS_START`; `frontend_tti_ms` counts from the WebView's document
  boot. The gap between process start and WebView boot (window creation,
  WebView spin-up) belongs to neither series, so backend total plus TTI
  does not equal wall-clock launch-to-interactive — an unattributed gap
  the technique says to render, and this record cannot.
- **Retention is one launch.** The report lives in process-static
  `OnceLock`s and the boot log line; there is no persisted history, so
  "did the update change the shape?" is answerable only by diffing logs
  by hand — the compare stage of
  [perf-data-lifecycle](../techniques/perf-data-lifecycle.md) is not yet
  built here.
