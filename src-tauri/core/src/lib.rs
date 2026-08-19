//! `personas-core` — the foundation layer shared by every Personas desktop crate.
//!
//! **Why this crate exists.** `app_lib` was a single 431k-LOC crate. One crate is
//! one `rustc` process, so a test build peaked at **8.9 GB in a single process**
//! (measured 2026-07-26; the linker peaked at 1.3 GB, so codegen — not linking —
//! was the ceiling). No `-j` flag helps: there is nothing to parallelize inside
//! one crate. Splitting the monolith is the only fix, and everything else has to
//! sit on top of a dependency-free base.
//!
//! **The rule for this crate: it may not depend on any other Personas crate.**
//! It is the bottom of the graph. If something here needs `db`, `engine`, or
//! `commands`, it does not belong here — that is the layering violation this
//! crate exists to make visible.
//!
//! **Extraction technique.** Callers keep using `crate::utils::…` unchanged: the
//! desktop crate re-exports these modules (`pub use personas_core::utils;`), so
//! moving a module here touches ~3 files instead of the ~849 that reference it.
//! Prefer that over rewriting call sites — it keeps each step reviewable and
//! trivially revertible.
//!
//! Migration order and rationale live in the crate-split plan; the short version
//! is core → db → engine, because the back-edges (db→engine, db→commands) are
//! only 3-8% of the forward edges and are mostly pure types.

// Lint posture for code that arrived here by `git mv`.
//
// `models/`, `validation/`, and the six engine modules were moved verbatim —
// only module paths were rewritten, no logic touched. Clippy flags a handful of
// long-standing style issues in them, and a code-motion commit is the wrong
// place to fix those: `large_enum_variant` and `should_implement_trait` would
// change a public API, and the doc lints want hand-aligned doc tables
// de-aligned. Allowed here, tracked as separate cleanup. Do NOT extend this
// list for newly written code.
#![allow(clippy::doc_lazy_continuation)]
#![allow(clippy::doc_overindented_list_items)]
#![allow(clippy::large_enum_variant)]
#![allow(clippy::should_implement_trait)]

pub mod context_fingerprint;
pub mod cron;
pub mod crypto;
pub mod digest_config;
pub mod engine_kind;
pub mod drive_root;
pub mod error;
pub mod events;
pub mod evolution_status;
pub mod error_taxonomy;
pub mod harvest_scopes;
pub mod healing;
pub mod http_clients;
pub mod healthcheck_ledger;
pub mod ipc_gauge;
pub mod lifecycle;
pub mod limits;
pub mod mcp_config;
pub mod models;
pub mod pool;
pub mod redact;
pub mod retrieval;
pub mod score_weights;
pub mod run_budget;
pub mod scheduler;
pub mod topology_graph;
pub mod trace;
pub mod types;
pub mod url_safety;
pub mod utils;
pub mod validation;
