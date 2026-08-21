//! Workspace Knowledge Center repositories, split by table family.
//!
//! This tree replaces the single 4,518-line `repos::dev_workspaces` module
//! (docs/plans/workspace-knowledge-center.md). Each child owns one coherent set
//! of tables (see the module-level notes below); nothing here is a rewrite — the
//! functions are the same ones `dev_workspaces.rs` held, moved verbatim to the
//! module that owns the tables they touch.
//!
//! `repos::dev_workspaces` survives as a re-export shim so existing call sites
//! keep resolving while they are migrated wave by wave.

/// `workspace_practice_adoption` — per-project adoption state and the state
/// machine (`initial_adoption_state` / `adoption_state_after_verdict`) that
/// drives it.
pub mod adoption;
/// `workspace_consult_log` — playbook consult telemetry and its roll-up.
pub mod consults;
/// `workspace_practice_context_state` — per-context adoption cells, plus the
/// file→context attribution that fills them.
pub mod context_state;
/// `workspace_knowledge_evidence` — citations hanging off a knowledge row.
pub mod evidence;
/// `workspace_harvest_coverage` — which scopes of a member repo were harvested,
/// how deeply, and when.
pub mod harvest;
/// The candidate-ingest pipeline: dedup verdicts and the one write path that
/// lands mined candidates into `workspace_knowledge` (+ evidence and edges).
pub mod ingest;
/// `workspace_knowledge` — the governed cross-project practice library: its
/// closed taxonomies, CRUD, the CAS decision path and the doctrine roll-up.
pub mod knowledge;
/// Read models that mine candidates out of member repos — `dev_ideas` findings
/// and `skill_registry` / `skill_usage_events` adoption gaps.
pub mod mining;
/// `dev_workspaces` — the workspace row itself (the "org") and which projects
/// belong to it via `dev_projects.workspace_id`.
pub mod org;
/// `workspace_pattern_edges` — the typed graph between knowledge rows.
pub mod pattern_edges;
/// `workspace_playbooks` and `workspace_playbook_patterns`.
pub mod playbooks;
/// The bridge from an adopted practice to real backlog work in `dev_ideas`, and
/// back again as adoption state.
pub mod practice_ideas;

// The pre-split module carried one `mod tests` block spanning five domains
// (knowledge taxonomies, applicability, the adoption state machine, mining and
// practice-idea materialisation). It is kept whole rather than shredded across
// the children — only its `use super::*` was rewritten into the sibling globs
// the same names now live behind.
#[cfg(test)]
mod cross_domain_tests;
