//! The backlog items about one step, for its step screen.
//!
//! Three producers file items a step owns, each recognisable by its own key:
//! - [`super::slow`] files `lifecycle:slow:<command_id>` for a command of the
//!   step that is over budget or regressing;
//! - [`super::overseer`] files `lifecycle:goal:<goal_id>:step:<step_id>` for a
//!   step it was sent to turn green;
//! - the doc-rot sensor files `origin = doc_rot` items, one per doc (the
//!   `docs` step only).

use std::collections::BTreeSet;
use std::path::Path;

use crate::db::models::{BacklogSource, DevIdea, LifecycleRelatedItem, LifecycleRelatedSource};
use crate::db::repos::dev::ideas::{list_ideas_matching, IdeaMatch};
use crate::db::repos::dev::projects as project_repo;
use crate::db::repos::utils::escape_like;
use crate::db::DbPool;
use crate::error::AppError;

use super::detect_commands::kinds_of;

/// Most related items a step detail carries.
pub const RELATED_LIMIT: usize = 20;

const SLOW_PREFIX: &str = "lifecycle:slow:";
const GOAL_PREFIX: &str = "lifecycle:goal:";

/// What selects `step_id`'s items. `command_ids` are the commands the step
/// runs or has run (slow-gate keys are per command).
pub fn related_match(step_id: &str, command_ids: &BTreeSet<String>) -> IdeaMatch {
    IdeaMatch {
        dedup_keys: command_ids
            .iter()
            .map(|id| format!("{SLOW_PREFIX}{id}"))
            .collect(),
        dedup_key_like: vec![format!("{GOAL_PREFIX}%:step:{}", escape_like(step_id))],
        origins: if step_id == "docs" {
            vec![BacklogSource::DocRot.as_str().to_string()]
        } else {
            Vec::new()
        },
    }
}

/// One idea as a related item; `None` for an idea no producer above filed.
pub fn related_item(idea: DevIdea) -> Option<LifecycleRelatedItem> {
    let key = idea.dedup_key.as_deref().unwrap_or("");
    let (source, command_id) = if let Some(cmd) = key.strip_prefix(SLOW_PREFIX) {
        (LifecycleRelatedSource::SlowGate, Some(cmd.to_string()))
    } else if key.starts_with(GOAL_PREFIX) {
        (LifecycleRelatedSource::Overseer, None)
    } else if idea.origin.as_deref() == Some(BacklogSource::DocRot.as_str()) {
        (LifecycleRelatedSource::DocRot, None)
    } else {
        return None;
    };
    Some(LifecycleRelatedItem {
        id: idea.id,
        title: idea.title,
        status: idea.status,
        verify_state: idea.verify_state,
        source,
        command_id,
        created_at: idea.created_at,
    })
}

/// The step's related items: open before closed, newest first, at most
/// [`RELATED_LIMIT`]. `run_command_ids` are the commands the step's loaded
/// runs carry; the step's planned commands are added here. Reads the
/// project's manifests when the step's commands are detected: call it off
/// the IPC thread.
pub fn related_items(
    pool: &DbPool,
    project_id: &str,
    step_id: &str,
    run_command_ids: impl IntoIterator<Item = String>,
) -> Result<Vec<LifecycleRelatedItem>, AppError> {
    let mut command_ids: BTreeSet<String> = run_command_ids.into_iter().collect();
    let kinds = kinds_of(step_id);
    if !kinds.is_empty() {
        let project = project_repo::get_project_by_id(pool, project_id)?;
        let (doc, _, _) = super::current_doc(pool, project_id)?;
        command_ids.extend(
            super::measure::commands_for(&doc, Path::new(&project.root_path))
                .into_iter()
                .filter(|c| kinds.contains(&c.kind))
                .map(|c| c.id),
        );
    }
    Ok(list_ideas_matching(
        pool,
        project_id,
        &related_match(step_id, &command_ids),
        RELATED_LIMIT,
    )?
    .into_iter()
    .filter_map(related_item)
    .collect())
}

#[cfg(test)]
#[path = "related_tests.rs"]
mod tests;
