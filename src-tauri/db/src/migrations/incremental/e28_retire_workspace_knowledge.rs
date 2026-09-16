//! Retire the in-app Workspace Knowledge library and DELETE its data.
//!
//! Decided 2026-09-14: "Workspace knowledge should be deleted as we use
//! external registry for the knowledge." The org's ai-registry is the knowledge
//! authority; the app reads it (Overview → Patterns) and never ingests it. The
//! DB-backed practice library was dead weight — on the operator's machine
//! ~112 MB of a 347 MB `personas.db`, almost all of it
//! `workspace_practice_context_state` (256,080 rows) and its two indexes.
//!
//! Nine tables go, children before parents:
//!
//! | table | parent(s) |
//! |---|---|
//! | `workspace_practice_context_state` | `workspace_knowledge` |
//! | `workspace_practice_adoption` | `workspace_knowledge` |
//! | `workspace_pattern_edges` | `workspace_knowledge` (×2) |
//! | `workspace_playbook_patterns` | `workspace_playbooks`, `workspace_knowledge` |
//! | `workspace_knowledge_evidence` | `workspace_knowledge` |
//! | `workspace_playbooks` | `dev_workspaces` |
//! | `workspace_consult_log` | `dev_workspaces` |
//! | `workspace_harvest_coverage` | `dev_projects` |
//! | `workspace_knowledge` | `dev_workspaces` |
//!
//! Their indexes go with them (`DROP TABLE` takes a table's indexes); none of
//! them ever had a trigger or an FTS shadow.
//!
//! ## Why the ORDER matters and the FK guard does not
//!
//! With `foreign_keys=ON`, `DROP TABLE` first runs an implicit `DELETE FROM`,
//! and that delete enforces the constraints in which the table is the PARENT.
//! Dropping every child first leaves `workspace_knowledge` and
//! `workspace_playbooks` with no referencing table in the schema, so their
//! implicit deletes check nothing and cascade nothing. None of the nine is a
//! parent of any table that survives — `dev_workspaces`, `dev_projects` and
//! `dev_contexts` are only ever parents here — so no surviving row is touched.
//!
//! ## Why this is unconditional, unlike `retire_db_skills_system`
//!
//! That precedent (e08) drops a table only when it is empty, because nothing
//! had decided those rows were disposable. Here the operator decided exactly
//! that, and the size of the data is the reason for the change: a guard that
//! keeps a non-empty table would keep all 112 MB.
//!
//! ## Why the older CREATEs are gone too
//!
//! The whole chain replays on every boot and each step probes its own
//! postcondition. A `CREATE TABLE IF NOT EXISTS workspace_knowledge` left in
//! c03 would re-create the table on the next launch, one step after this one
//! dropped it, so the c03 / c04 / support steps that created, altered or
//! backfilled these tables were removed in the same change. This step
//! therefore only ever does work on a database that predates the change.
//!
//! The freed pages go to SQLite's freelist; the file shrinks on the next
//! `VACUUM`, which this step deliberately does not run (it would rewrite the
//! whole database inside boot).

use rusqlite::Connection;

use personas_core::error::AppError;

use super::support::*;

/// Children before parents — see the module doc for why the order is the
/// whole safety argument.
pub(super) const RETIRED_KNOWLEDGE_TABLES: [&str; 9] = [
    "workspace_practice_context_state",
    "workspace_practice_adoption",
    "workspace_pattern_edges",
    "workspace_playbook_patterns",
    "workspace_knowledge_evidence",
    "workspace_playbooks",
    "workspace_consult_log",
    "workspace_harvest_coverage",
    "workspace_knowledge",
];

pub(super) fn run(conn: &Connection) -> Result<(), AppError> {
    run_step(
        conn,
        IncrementalMigration {
            id: "retire_workspace_knowledge",
            description: "Drop the retired Workspace Knowledge library and all its data (nine workspace_* knowledge tables); the ai-registry is the knowledge authority",
            already_applied: |conn| {
                for table in RETIRED_KNOWLEDGE_TABLES {
                    if has_table(conn, table)? {
                        return Ok(false);
                    }
                }
                Ok(true)
            },
            apply: |conn| {
                let mut batch = String::new();
                for table in RETIRED_KNOWLEDGE_TABLES {
                    batch.push_str(&format!("DROP TABLE IF EXISTS {table};\n"));
                }
                ddl_step(conn, &batch)
            },
        },
    )
}
