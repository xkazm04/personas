//! The bench's door to the PRODUCTION prompt composer.
//!
//! `mod companion` is private, so the `athena-bench-validate` binary cannot
//! reach `companion::prompt` directly; this module is the one public path,
//! the same way [`super::athena_validate`] is the door to the dispatcher. It
//! exists so the bench scores the prompt family Athena actually gets, not a
//! distilled fixture that can drift from it.

pub use crate::companion::prompt::{render_bench_prompt, BenchPromptContext, PromptClass};
