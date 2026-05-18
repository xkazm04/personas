//! Orchestration layer between Athena (conversational agent) and the
//! Fleet (parallel Claude Code workers).
//!
//! In-process "operative memory" — the working set Athena reasons over
//! during live orchestration. Distinct from `brain/` (episodic +
//! semantic memory, persisted, long-term) by design:
//!
//!   - `brain/` is a permanent record of what *happened* (and why).
//!   - `orchestration/` is a live record of what's *happening now* (and
//!     who's doing what for whom). It evaporates on app restart.
//!
//! Splitting these tiers keeps the long-term memory clean (we don't
//! pollute episodic with every tool-call) while giving Athena a
//! prompt-friendly digest of live work.

pub mod mcp;
pub mod operative_memory;
