//! The database half of confirming a `lifecycle_proposal` card (Lifecycle v2).
//!
//! `companion_apply_lifecycle_proposal` (commands/companion/approvals/
//! approval_exec_lifecycle.rs) is the adapter: auth, [`apply_proposal`] off
//! the IPC thread, the async install dispatch, then [`record_outcome`] and the
//! snapshot. Everything that checks out a connection lives here, not in the
//! command tree. Steps: read the card back BY ID and require `pending`; refuse
//! (and supersede the card) when the project moved past `fromVersion`; apply
//! only the ticked changes, re-validate, claim the card, append the version
//! (author `athena`); report whether the new version asks the repo for more.

use crate::commands::companion::chat_cards;
use crate::companion::brain::episodic::{self, EpisodeRole};
use crate::db::models::{LifecycleAuthor, LifecycleProposalCard};
use crate::db::{DbPool, UserDbPool};
use crate::error::AppError;

/// What the database half of a confirm did.
#[derive(Debug)]
pub struct AppliedLifecycleProposal {
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
pub fn apply_proposal(
    db: &DbPool,
    user_db: &UserDbPool,
    card_id: &str,
    accepted: &[String],
) -> Result<AppliedLifecycleProposal, AppError> {
    let row = chat_cards::get_card(user_db, card_id)?;
    if row.kind != super::LIFECYCLE_PROPOSAL_KIND {
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

    let next = super::apply_accepted(&current, &card.proposed, &card.changes, accepted)
        .map_err(AppError::Validation)?;
    super::validate_doc(&next).map_err(|e| {
        AppError::Validation(format!(
            "the ticked changes do not form a valid lifecycle: {e}"
        ))
    })?;
    let install_wanted = super::repo_bindings_strengthened(&current, &next);

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
pub fn record_outcome(
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

#[cfg(test)]
#[path = "tests_apply.rs"]
mod tests;
