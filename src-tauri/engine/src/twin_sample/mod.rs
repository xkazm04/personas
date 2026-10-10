//! Partially-extracted `twin_sample` module.
//!
//! app_lib still owns this module's parent and the siblings that reach
//! `AppState` or a `commands::*` entry point; the children below depend only
//! on `personas-core` and `personas-db`, so they moved here. app_lib's
//! `src/engine/twin_sample/mod.rs` re-exports each one by name — the crate-root glob
//! cannot reach them, because the parent's own `mod` decl shadows it.

pub mod guard;
