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
use crate::commands::companion::chat_cards;
use crate::companion::lifecycle_ops;
use crate::db::models::{LifecycleAuthor, LifecycleProposalCard, LifecycleSnapshot};
use crate::db::{DbPool, UserDbPool};

/// What the database half of a confirm did.
#[derive(Debug)]
pub(crate) struct AppliedLifecycleProposal {
    pub card_id: String,
    pub project_id: String,
    /// The conversation the card lives in (where the outcome episode goes).
    pub conversation_id: String,
    /// The version just appended.
    pub version: i64,
    /// How many changes were applied.
    pub applied: usize,
    /// Whether the new version asks the repo for more than the old one did.
    pub install_wanted: bool,
}

/// Steps 1-3 above, synchronous so it runs off the IPC thread and is testable
/// without an `AppHandle`.
pub(crate) fn apply_lifecycle_proposal_inner(
    db: &DbPool,
    user_db: &UserDbPool,
    card_id: &str,
    accepted: &[String],
) -> Result<AppliedLifecycleProposal, AppError> {
    let row = chat_cards::get_card(user_db, card_id)?;
    if row.kind != lifecycle_ops::LIFECYCLE_PROPOSAL_KIND {
        return Err(AppError::Validation(format!(
            "chat card `{}` is a `{}` card, not a lifecycle proposal",
            row.id, row.kind
        )));
    }
    if row.status != "pending" {
        return Err(AppError::Validation(format!(
            "This proposal is no longer actionable (status: {}).",
            row.status
        )));
    }
    let card: LifecycleProposalCard = serde_json::from_str(&row.config_json)
        .map_err(|e| AppError::Validation(format!("the proposal card is unreadable: {e}")))?;

    let (current, version, _) = crate::lifecycle::current_doc(db, &card.project_id)?;
    if version != card.from_version {
        let result = serde_json::json!({
            "reason": "stale",
            "fromVersion": card.from_version,
            "currentVersion": version,
        });
        if let Err(e) =
            chat_cards::resolve_card(user_db, &row.id, "superseded", Some(result.to_string()))
        {
            tracing::warn!(card_id = %row.id, error = %e, "lifecycle proposal: could not mark stale card superseded");
        }
        return Err(AppError::Validation(format!(
            "The lifecycle changed since this proposal (it was drafted against v{}, the project \
             is now at v{version}); ask Athena to re-propose.",
            card.from_version
        )));
    }

    let next = lifecycle_ops::apply_accepted(&current, &card.proposed, &card.changes, accepted)
        .map_err(AppError::Validation)?;
    lifecycle_ops::validate_doc(&next).map_err(|e| {
        AppError::Validation(format!(
            "the ticked changes do not form a valid lifecycle: {e}"
        ))
    })?;
    let install_wanted = lifecycle_ops::repo_bindings_strengthened(&current, &next);

    // Claim only after everything that can be corrected and retried passed.
    {
        let conn = user_db.get()?;
        chat_cards::claim_for_dispatch(&conn, &row.id)?;
    }
    let saved = match crate::lifecycle::append(
        db,
        &card.project_id,
        &next,
        Some(&card.change_note),
        LifecycleAuthor::Athena,
    ) {
        Ok(saved) => saved,
        Err(e) => {
            if let Ok(conn) = user_db.get() {
                chat_cards::release_claim(&conn, &row.id);
            }
            return Err(e);
        }
    };
    let applied = accepted
        .iter()
        .map(|s| s.trim())
        .collect::<std::collections::HashSet<_>>()
        .len();
    Ok(AppliedLifecycleProposal {
        card_id: row.id,
        project_id: card.project_id,
        conversation_id: row.conversation_id,
        version: saved.version,
        applied,
        install_wanted,
    })
}

/// Settle the claimed card with its outcome and tell Athena, both best-effort:
/// the version is already saved, so neither may fail the confirm.
fn record_outcome(
    user_db: &UserDbPool,
    done: &AppliedLifecycleProposal,
    install_task_id: Option<&str>,
    install_error: Option<&str>,
) {
    if let Ok(conn) = user_db.get() {
        chat_cards::record_dispatch_result(
            &conn,
            &done.card_id,
            serde_json::json!({
                "version": done.version,
                "applied": done.applied,
                "installTaskId": install_task_id,
                "installError": install_error,
            })
            .to_string(),
        );
    }
    let mut body = format!(
        "[Lifecycle] v{} saved ({} changes), install task {}",
        done.version,
        done.applied,
        install_task_id.unwrap_or("none")
    );
    if let Some(err) = install_error {
        body.push_str(&format!(
            ". The install could not be dispatched ({err}); the repo bindings stay missing until \
             \"Install into repo\" runs from the Lifecycle page. Say so."
        ));
    }
    if let Err(e) =
        episodic::append_episode(user_db, &done.conversation_id, EpisodeRole::System, &body)
    {
        tracing::warn!(card_id = %done.card_id, error = %e, "lifecycle proposal: outcome episode not written");
    }
}

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
        apply_lifecycle_proposal_inner(&db, &user_db, &card_id, &accepted_step_ids)
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
        record_outcome(
            &user_db,
            &done,
            install_task_id.as_deref(),
            install_error.as_deref(),
        );
        crate::lifecycle::snapshot(&db, &done.project_id)
    })
    .await
}

#[cfg(test)]
#[path = "approval_exec_lifecycle_tests.rs"]
mod tests;
