//! Persona benchmarking framework.
//!
//! Runs the same persona + input across Opus / Sonnet / Haiku / Gemma
//! and captures full output bundles (messages, events, memories, reviews)
//! for quality judging. Separate DB from `personas.db` — bench is a
//! test harness, not a business process.
//!
//! Default DB location: `.planning/bench/personas_bench.db` (gitignored).
//! The `personas-bench` binary (added in a later phase) consumes this.

pub mod db;
