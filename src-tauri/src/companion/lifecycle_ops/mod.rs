//! Athena's lifecycle toolset (Lifecycle v2, WP3).
//!
//! A project's lifecycle (its development practice, `crate::lifecycle`) is never
//! edited by the user directly: he asks Athena, she reads it with
//! `describe_lifecycle` (Read op, [`describe_lifecycle`]) and proposes the full
//! next step list with `show_lifecycle_proposal` (Card op,
//! [`build_proposal_card`]). The card is durable (kind
//! [`LIFECYCLE_PROPOSAL_KIND`] is in `chat_cards::ACTIONABLE_KINDS`); confirming
//! it calls `companion_apply_lifecycle_proposal`, which appends a version
//! authored `athena` with only the ticked changes.
//!
//! - [`apply`] - the database half of confirming a card (the command is
//!   `companion_apply_lifecycle_proposal`).
//! - [`describe`] - the read op's answer.
//! - [`proposal`] - parse / resolve / diff / apply, pure over documents.
//! - [`validate`] - the rules a document must satisfy, run at proposal time
//!   AND at confirm.

pub mod apply;
pub mod describe;
pub mod proposal;
pub mod validate;

pub use describe::describe_lifecycle;
pub use proposal::{apply_accepted, diff, repo_bindings_strengthened};
pub use validate::validate_doc;

use rusqlite::OptionalExtension;

use crate::db::models::{LifecycleBindingKind, LifecycleProposalCard};
use crate::db::DbPool;

/// The chat-card kind of a lifecycle proposal. Listed in
/// `commands::companion::chat_cards::ACTIONABLE_KINDS`.
pub const LIFECYCLE_PROPOSAL_KIND: &str = "lifecycle_proposal";

/// How many project names a "no such project" answer lists.
const PROJECT_SUGGESTIONS: usize = 12;

/// The wire spelling of a binding kind (`claude_md`, not `ClaudeMd`).
pub fn binding_str(kind: LifecycleBindingKind) -> &'static str {
    match kind {
        LifecycleBindingKind::App => "app",
        LifecycleBindingKind::ClaudeMd => "claude_md",
        LifecycleBindingKind::Hook => "hook",
        LifecycleBindingKind::Ci => "ci",
        LifecycleBindingKind::Advisory => "advisory",
    }
}

/// Resolve `query` (a registered project's id, name or root path) to `(id,
/// name)`. Uses the shared `resolve_dev_project`, but FAILS CLOSED where it
/// would fall back to the most recent project: a lifecycle change aimed at
/// the wrong project is worse than a refusal. The error lists real names.
pub fn resolve_project(db: &DbPool, query: &str) -> Result<(String, String), String> {
    let q = query.trim();
    if q.is_empty() {
        return Err("`project` is required: a registered project's id or name.".into());
    }
    let conn = db
        .get()
        .map_err(|e| format!("the project registry is unavailable: {e}"))?;
    let (id, matched) = crate::commands::companion::approvals::resolve_dev_project(
        &conn,
        &serde_json::json!({ "project_id": q }),
    )
    .map_err(|e| e.to_string())?;
    let name: Option<String> = conn
        .query_row(
            "SELECT name FROM dev_projects WHERE id = ?1",
            rusqlite::params![id],
            |r| r.get("name"),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    match name {
        Some(name) if matched => Ok((id, name)),
        _ => {
            let names: Vec<String> = conn
                .prepare("SELECT name FROM dev_projects ORDER BY name COLLATE NOCASE LIMIT ?1")
                .and_then(|mut stmt| {
                    let rows = stmt
                        .query_map(rusqlite::params![PROJECT_SUGGESTIONS as i64], |r| {
                            r.get::<_, String>("name")
                        })?
                        .collect::<Result<Vec<String>, _>>();
                    rows
                })
                .unwrap_or_default();
            Err(format!(
                "no registered project matches `{q}`. Registered projects: {}.",
                if names.is_empty() {
                    "none".to_string()
                } else {
                    names.join(", ")
                }
            ))
        }
    }
}

/// Validate a `show_lifecycle_proposal` op and build its card: resolve the
/// project, fill omitted fields from the current document, validate the whole
/// proposed document, and diff it. A proposal that changes nothing is refused.
pub fn build_proposal_card(
    db: &DbPool,
    params: &serde_json::Value,
) -> Result<LifecycleProposalCard, String> {
    let input = proposal::parse_input(params)?;
    let (project_id, project_name) = resolve_project(db, &input.project)?;
    let (current, version, _) = crate::lifecycle::current_doc(db, &project_id)
        .map_err(|e| format!("the current lifecycle of {project_name} could not be read: {e}"))?;
    let proposed = proposal::resolve_doc(&current, input.preset, input.steps)?;
    validate_doc(&proposed)?;
    let changes = diff(&current, &proposed);
    if changes.is_empty() {
        return Err(format!(
            "the proposal is identical to v{version} of {project_name} (a reorder alone is not \
             a change); nothing to show."
        ));
    }
    Ok(LifecycleProposalCard {
        project_id,
        project_name,
        from_version: version,
        preset: proposed.preset,
        change_note: input.change_note,
        proposed,
        changes,
    })
}

#[cfg(test)]
#[path = "tests.rs"]
mod tests;
