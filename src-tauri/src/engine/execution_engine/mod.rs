//! ExecutionEngine internals extracted out of `engine/mod.rs`.
//!
//! This module is intentionally introduced behind stable re-exports so the
//! public `crate::engine::*` surface does not churn while the larger engine
//! refactor proceeds in smaller compile-checkable moves.

pub(super) mod persist;
