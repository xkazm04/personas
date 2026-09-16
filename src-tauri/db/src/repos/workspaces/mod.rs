//! Workspace repositories, split by table family.
//!
//! This tree replaced the single 4,518-line `repos::dev_workspaces` module.
//! `repos::dev_workspaces` survives as a re-export shim so existing call sites
//! keep resolving.
//!
//! The Workspace Knowledge Center's table families (knowledge, evidence,
//! adoption, context state, pattern edges, playbooks, consult log, harvest
//! coverage, the ingest pipeline, the miners and the practice→idea bridge)
//! lived here too. They were retired together with their tables — see the
//! `retire_workspace_knowledge` step in `migrations::incremental`.

/// `dev_workspaces` — the workspace row itself (the "org") and which projects
/// belong to it via `dev_projects.workspace_id`.
pub mod org;
/// The `last_working_version` never-delete tag and the guards every delete
/// door that could reach a protected workspace's data calls.
pub mod protection;
