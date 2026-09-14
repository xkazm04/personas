//! Record shape for a workspace (a named grouping of dev projects).
//!
//! Extracted verbatim from the former single-file `data_portability.rs`.
//! Until the in-app Workspace Knowledge library was retired this record also
//! carried the workspace's knowledge entries and per-project adoption cells.
//! Bundles written back then still deserialize: serde ignores the two extra
//! arrays, and the workspace row itself imports unchanged.

use super::*;

/// A workspace row. Travels so a bundled project's `workspace_id` can be
/// re-pointed at the same workspace on import.
#[derive(Debug, Serialize, Deserialize)]
pub struct WorkspaceExport {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
    pub description: Option<String>,
}
