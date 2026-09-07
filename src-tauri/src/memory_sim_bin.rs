//! `personas-memory-sim` — headless driver for Athena's memory.
//!
//! stdin:  one JSON request per line (`ingest` | `consolidate` | `recall` |
//!         `cost` | `quit`).
//! stdout: one JSON reply per line.
//! stderr: logs.
//!
//! The protocol is the harness's, not ours — see
//! `evals/memory-year/memory_year/backends/athena.py`. Everything else lives in
//! `app_lib::memory_sim`; this file is the entry point and nothing more, the
//! same shape as `athena_bench_bin.rs`.

// See `memory_sim`'s own note: this binary talks to a harness over stdout.
#![allow(clippy::print_stdout, clippy::print_stderr)]

fn main() {
    std::process::exit(app_lib::memory_sim::main());
}
