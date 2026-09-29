//! `approval_exec_lifecycle` - part of the approval module family. Shared
//! imports, status consts and the Tauri-facing types live in `mod.rs`.
//!
//! # Confirming a lifecycle proposal (Lifecycle v2, WP3)
//!
//! Athena proposes the full next step list with `show_lifecycle_proposal`; the
//! dispatcher validates it, diffs it against the project's current version and
//! persists a durable `lifecycle_proposal` chat card. The operator unticks the
//! changes he does not want and presses Confirm, which lands here:
//!
//! 1. the card is read back BY ID (the client never sends the proposal, so
//!    what is applied is what was validated), and must still be `pending`;
//! 2. the project must still be at the card's `fromVersion`, else the card is
//!    marked `superseded` and the operator is told to ask for a re-proposal;
//! 3. only the ticked changes are applied on top of the current document, the
//!    result is re-validated, the card is claimed, and the version is appended
//!    through `crate::lifecycle::append` (author `athena`);
//! 4. if the new version asks the repo for more (a repo binding added, or a
//!    `claude_md` step reworded), `lifecycle::install::dispatch_install` starts
//!    the Run Desk install task;
//! 5. an episode tells Athena the outcome, and the fresh snapshot is returned.

#[allow(unused_imports)]
use super::*;

use crate::commands::blocking::run_blocking;
use crate::companion::lifecycle_ops;
use crate::db::models::LifecycleSnapshot;

/// Confirm a `lifecycle_proposal` card with the ticked change ids (a step id,
/// or `"preset"` for the preset change). Returns the project's new snapshot.
#[tauri::command]
pub async fn companion_apply_lifecycle_proposal(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    card_id: String,
    accepted_step_ids: Vec<String>,
) -> Result<LifecycleSnapshot, AppError> {
    ipc_auth::require_auth(&state).await?;
    let (db, user_db) = (state.db.clone(), state.user_db.clone());
    let done = run_blocking("companion_apply_lifecycle_proposal", move || {
        lifecycle_ops::apply::apply_proposal(&db, &user_db, &card_id, &accepted_step_ids)
    })
    .await?;
    tracing::info!(
        project_id = %done.project_id,
        version = done.version,
        applied = done.applied,
        install_wanted = done.install_wanted,
        "companion: lifecycle proposal applied"
    );

    let (install_task_id, install_error) = if done.install_wanted {
        match crate::lifecycle::install::dispatch_install(state.inner(), &app, &done.project_id)
            .await
        {
            Ok(id) => (id, None),
            Err(e) => {
                tracing::warn!(project_id = %done.project_id, error = %e, "lifecycle proposal: install dispatch failed");
                (None, Some(e.to_string()))
            }
        }
    } else {
        (None, None)
    };

    let (db, user_db) = (state.db.clone(), state.user_db.clone());
    run_blocking("companion_apply_lifecycle_proposal", move || {
        lifecycle_ops::apply::record_outcome(
            &user_db,
            &done,
            install_task_id.as_deref(),
            install_error.as_deref(),
        );
        crate::lifecycle::snapshot(&db, &done.project_id)
    })
    .await
}
