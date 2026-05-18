//! 5-tier cognitive memory model (working, episodic, semantic, procedural,
//! identity) plus a typed-relations graph and provenance enforcement.
//!
//! Phase 0: empty submodules. Implementations land in subsequent phases —
//! this file just declares the shape so the rest of the scaffolding
//! compiles cleanly.

pub mod backlog;
pub mod cockpit;
pub mod consolidation;
pub mod dashboard;
pub mod decisions;
pub mod doctrine;
pub mod embeddings;
pub mod episodic;
pub mod fleet;
pub mod fleet_patterns;
pub mod goals;
pub mod graph;
pub mod identity;
pub mod procedural;
pub mod recall_synthesis;
pub mod reflection;
pub mod retrieval;
pub mod rituals;
pub mod semantic;
