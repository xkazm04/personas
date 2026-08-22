//! Persona test runs and the Lab: scenario generation, scenario execution,
//! LLM scoring, and the six run modes the Lab exposes (standard, arena,
//! consensus, A/B, eval, matrix) plus the improvement/draft passes built on
//! top of them.
//!
//! Split out of the former single-file `test_runner.rs` (3,204 lines). The cut
//! follows the pipeline's own stages and moves no logic:
//!
//! - [`types`] — the serde/`ts-rs` wire shapes shared by every mode
//!   ([`TestScenario`], [`TestScores`], [`ScoreResult`], [`ExecutionOutput`],
//!   [`TestModelConfig`] and its parser, [`TestRunStatusEvent`]).
//! - [`scenarios`] — scenario generation: the TTL scenario cache and its
//!   deliberately prompt-free key, the coordinator prompt, and the parser that
//!   reads scenarios back out of CLI output.
//! - [`execution`] — running one scenario against one model: the Claude CLI
//!   and Ollama paths, the mock-tool sandbox section, and the two
//!   `spawn_cli_and_collect*` helpers every other stage reuses.
//! - [`scoring`] — turning an execution into numbers: the LLM judge call, the
//!   renormalized composite, the pass threshold, verdicts, and the
//!   cost-decayed value score.
//! - [`lab`] — the shared lab loop: [`LabVariant`] / [`LabCallbacks`], the
//!   bounded model×variant×scenario fan-out, cancellation, status emission and
//!   the LLM run summary.
//! - [`summaries`] — the per-mode summary builders and the small read helpers
//!   they need (keyed/arena/consensus summaries, common result fields, active
//!   version resolution, agreement rate).
//! - [`modes`] — the public entry points: [`run_test`], [`run_arena_test`],
//!   [`run_consensus_test`], [`run_ab_test`], [`run_eval_test`],
//!   [`run_matrix_test`].
//! - [`improvement`] — the draft-generation and targeted-improvement passes.
//!
//! Everything stays reachable as `personas_engine::test_runner::X` (and so as
//! `crate::engine::test_runner::X` from the app crate); the glob re-exports
//! below preserve the pre-split surface exactly.

mod execution;
mod improvement;
mod lab;
mod modes;
mod scenarios;
mod scoring;
mod summaries;
mod types;

#[cfg(test)]
mod tests;

pub use execution::*;
pub use improvement::*;
pub(crate) use lab::*;
pub use modes::*;
pub use scenarios::*;
pub use scoring::*;
pub(crate) use summaries::*;
pub use types::*;
