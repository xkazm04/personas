//! Credential executors — the one op Athena has for a credential, and it is a
//! hand-off rather than an action.
//!
//! A credential whose OAuth grant was revoked or expired cannot be repaired by
//! anything running inside this process: re-consent happens in the operator's
//! own browser, at the provider, as the operator. So `reconnect_credential`
//! performs no backend write at all — it validates that the credential exists
//! and is genuinely in the state it claims to be in, then returns a
//! `ClientAction::ReconnectCredential` that opens the Vault with that
//! credential focused and its one-click reconnect armed.
//!
//! The refusal half matters as much as the action: a proposal aimed at a
//! healthy credential, or at a credential with no OAuth shape at all, is an
//! error rather than a no-op, so the model reads why instead of watching a
//! card succeed and nothing happen.

use std::sync::Arc;

use tauri::State;

use crate::db::repos::resources::credentials as cred_repo;
use crate::error::AppError;
use crate::AppState;

use super::approval_autopilot::record_fleet_decision;
use super::{ClientAction, ExecuteResult};

/// Whether the ledger says this credential authenticates via OAuth — i.e. that
/// a re-authorization is a thing that can be performed on it at all.
///
/// Any one signal is enough: a grant that has never been refreshed still has an
/// expiry, and one captured out-of-band may carry only the refresh counter.
/// Read through the typed record rather than by string key, because a field
/// spelled as data is a field two writers can disagree about
/// (`ledger-field-addressed-by-string-key`).
fn is_oauth_shaped(ledger: &personas_core::models::CredentialLedger) -> bool {
    ledger.oauth_token_expires_at.is_some()
        || ledger.oauth_refresh_count.is_some()
        || ledger.oauth_last_refresh_at.is_some()
        || ledger.oauth_predicted_lifetime_secs.is_some()
}

/// The account the credential is bound to, as recorded on the ledger.
///
/// Read through the ledger's serialized form rather than a named field on
/// purpose: `account_email` is owned by the credential-binding work landing
/// beside this one, and until it is a typed field it lives in the ledger's
/// `#[serde(flatten)] custom` catch-all. Both spellings serialize to the same
/// top-level key, so going through `to_value()` reads it correctly BEFORE and
/// AFTER that field is promoted — which is the whole point: this executor must
/// not break either way round.
fn bound_account_email(ledger: &personas_core::models::CredentialLedger) -> Option<String> {
    ledger
        .to_value()
        .get("account_email")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
}

/// `reconnect_credential` — hand a flagged credential back to the operator.
///
/// Validates: the credential id resolves to a real row, and that row is either
/// flagged `needs_reauth` (the ledger state `oauth_refresh` writes when a grant
/// is revoked) or at least OAuth-shaped (so a re-auth is a thing that can be
/// performed on it at all). Returns the client action; writes nothing.
pub(crate) fn execute_reconnect_credential(
    state: &State<'_, Arc<AppState>>,
    params: &serde_json::Value,
) -> Result<ExecuteResult, AppError> {
    // Accept the id top-level or nested under `params`, matching how every
    // other executor in this family tolerates Athena's two envelope shapes.
    let credential_id = params
        .get("credential_id")
        .or_else(|| params.get("params").and_then(|p| p.get("credential_id")))
        .and_then(|v| v.as_str())
        .map(str::trim)
        .unwrap_or_default()
        .to_string();
    personas_core::validation::require_non_empty(
        "reconnect_credential.credential_id",
        &credential_id,
    )?;

    // `get_by_id` errors NotFound for an id that does not resolve, which is the
    // honest answer for a hallucinated or since-deleted credential.
    let cred = cred_repo::get_by_id(&state.db, &credential_id)?;
    let ledger = personas_core::models::CredentialLedger::parse(cred.metadata.as_deref());

    let flagged = ledger.needs_reauth == Some(true);
    if !flagged && !is_oauth_shaped(&ledger) {
        return Err(AppError::Validation(format!(
            "reconnect_credential: \"{}\" ({}) is not an OAuth credential and is not flagged as \
             needing re-authorization, so there is nothing to reconnect. Only propose this for a \
             credential the app has reported as revoked or expired.",
            cred.name, cred.service_type
        )));
    }

    let account_email = bound_account_email(&ledger);

    // Same ledger every other consent-bearing executor writes to, so Athena's
    // whole decision surface stays readable from one place.
    record_fleet_decision(
        &state.db,
        "reconnect_credential",
        &params.to_string(),
        "approved",
        None,
    );

    let account_note = match account_email.as_deref() {
        Some(email) => format!(" Sign back in as **{email}**."),
        None => String::new(),
    };
    let state_note = if flagged {
        "access was revoked"
    } else {
        "its OAuth grant needs re-consent"
    };
    Ok(ExecuteResult {
        message: format!(
            "Opening the Vault at **{}** ({}): {state_note}, so the reconnect has to happen in \
             your browser.{account_note}",
            cred.name, cred.service_type
        ),
        client_action: Some(ClientAction::ReconnectCredential {
            credential_id,
            account_email,
        }),
    })
}
