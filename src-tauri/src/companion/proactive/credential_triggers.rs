//! Revoked-credential → proactive trigger evaluator.
//!
//! When an OAuth grant is revoked or expires, `engine::oauth_refresh` does two
//! things: it emits `credential-reauth-required` (the live event the Vault
//! banner listens to) and it marks `needs_reauth` on the credential's ledger.
//! The event is the fast door and the ledger flag is the durable one — an event
//! fired while the app was closed, or while the user was on another page, is
//! gone, but the flag is still there on the next pass.
//!
//! This evaluator reads the flag, so Athena raises it on the orb whether or not
//! anyone was watching when the grant died. It mirrors `incident_triggers`
//! exactly: `sys_db` (the main app pool) in, `Nudge`s out, threaded as `extra`
//! candidates into `super::evaluate_with_extra_candidates` so quiet hours,
//! budget and dedupe all still apply. Dedupe is what makes a standing flag safe
//! to scan on every tick — the `(trigger_kind, trigger_ref)` pair is anchored
//! on the credential id, so one revoked credential nudges once, not once per
//! tick.
//!
//! Engaging the nudge lands the user in the Vault with the credential focused
//! and its reconnect armed — the same screen state `reconnect_credential`'s
//! `ClientAction::ReconnectCredential` produces, because there is one right
//! answer to "show me this credential" and both doors owe it.

use personas_core::models::{CredentialLedger, PersonaCredential};

use crate::db::DbPool;

use super::Nudge;

/// The `trigger_kind` this evaluator emits. The frontend decision queue
/// branches on it to build the "Reconnect now" / "Later" bubble.
pub const CREDENTIAL_REAUTH_TRIGGER_KIND: &str = "credential_reauth";

/// One credential, reduced to what a nudge needs. Keeping the pure core over
/// this rather than over `PersonaCredential` is what lets a test state a case
/// in one line instead of building a full row.
#[derive(Debug, Clone)]
pub struct FlaggedCredential {
    pub id: String,
    pub name: String,
    pub service_type: String,
    pub account_email: Option<String>,
}

/// Project a credential row into a `FlaggedCredential`, or `None` when its
/// ledger does not carry the `needs_reauth` flag.
pub fn flagged_from(cred: &PersonaCredential) -> Option<FlaggedCredential> {
    let ledger = CredentialLedger::parse(cred.metadata.as_deref());
    if ledger.needs_reauth != Some(true) {
        return None;
    }
    // Read through the serialized ledger so this keeps working whether
    // `account_email` is a typed field or still lives in the `custom`
    // catch-all — see `approval_exec_credentials::bound_account_email`.
    let account_email = ledger
        .to_value()
        .get("account_email")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned);
    Some(FlaggedCredential {
        id: cred.id.clone(),
        name: cred.name.clone(),
        service_type: cred.service_type.clone(),
        account_email,
    })
}

/// Pure core: one nudge per flagged credential.
///
/// Deliberately NOT count-aware the way `build_incident_nudge` is. An incident
/// inbox is a place you go once and work through; a revoked credential is a
/// specific thing the operator reconnects one at a time, in a specific
/// provider's browser flow, as a specific account. A "3 credentials need
/// attention" roll-up would collapse exactly the information that makes the
/// decision actionable — and the per-kind budget cap already bounds how many
/// of these reach him.
pub fn build_credential_reauth_nudges(flagged: &[FlaggedCredential]) -> Vec<Nudge> {
    flagged
        .iter()
        .map(|c| {
            let account = match c.account_email.as_deref() {
                Some(email) => format!(" (your {email} account)"),
                None => String::new(),
            };
            Nudge {
                trigger_kind: CREDENTIAL_REAUTH_TRIGGER_KIND.into(),
                trigger_ref: Some(c.id.clone()),
                message: format!(
                    "Your {} credential \"{}\"{account} was revoked, so anything using it is \
                     failing until you sign in again. Want to reconnect it now?",
                    c.service_type, c.name
                ),
            }
        })
        .collect()
}

/// DB shell around [`build_credential_reauth_nudges`]. A read failure degrades
/// to no nudge, consistent with every other extra-candidate source.
pub fn credential_reauth_nudges(sys_db: &DbPool) -> Vec<Nudge> {
    let creds = match crate::db::repos::resources::credentials::get_all(sys_db) {
        Ok(c) => c,
        Err(e) => {
            tracing::warn!(error = %e, "proactive: credential read failed; no re-auth nudges");
            return Vec::new();
        }
    };
    let flagged: Vec<FlaggedCredential> = creds.iter().filter_map(flagged_from).collect();
    build_credential_reauth_nudges(&flagged)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mk(id: &str, name: &str, service: &str, email: Option<&str>) -> FlaggedCredential {
        FlaggedCredential {
            id: id.into(),
            name: name.into(),
            service_type: service.into(),
            account_email: email.map(str::to_owned),
        }
    }

    /// Build a credential's metadata the way production writes it: through the
    /// typed ledger, never by spelling its field names as JSON text. A fixture
    /// that hand-writes the keys is a second, unrelated writer of the same
    /// record — exactly the drift `ledger-field-addressed-by-string-key` is
    /// about — and it would keep passing after the real field was renamed.
    fn ledger_meta(needs_reauth: bool, account_email: Option<&str>) -> String {
        let mut l = CredentialLedger::default();
        if needs_reauth {
            l.mark_needs_reauth();
        } else {
            l.clear_needs_reauth();
        }
        if let Some(email) = account_email {
            // Still the catch-all today; a typed field tomorrow. Either way it
            // serializes to the same top-level key, which is the property the
            // reader under test depends on.
            l.custom.insert(
                "account_email".to_string(),
                serde_json::Value::String(email.to_string()),
            );
        }
        l.to_json_string().expect("ledger json")
    }

    /// A ledger that says `false` rather than omitting the flag.
    /// `clear_needs_reauth` writes `None` and `skip_serializing_if` then drops
    /// the key entirely, so an explicit `false` only ever arrives from an older
    /// writer — and it must read the same as absent. Set through the typed
    /// field rather than hand-written JSON, for the reason on `ledger_meta`.
    fn ledger_meta_flag_explicitly_false() -> String {
        let mut l = CredentialLedger::default();
        l.needs_reauth = Some(false);
        l.to_json_string().expect("ledger json")
    }

    fn cred(id: &str, metadata: Option<&str>) -> PersonaCredential {
        PersonaCredential {
            id: id.into(),
            name: "Google Drive".into(),
            service_type: "google".into(),
            encrypted_data: String::new(),
            iv: String::new(),
            metadata: metadata.map(str::to_owned),
            last_used_at: None,
            scoped_resources: None,
            created_at: "2026-01-01T00:00:00Z".into(),
            updated_at: "2026-01-01T00:00:00Z".into(),
        }
    }

    #[test]
    fn nothing_flagged_is_no_nudge() {
        assert!(build_credential_reauth_nudges(&[]).is_empty());
    }

    #[test]
    fn a_flagged_credential_names_its_account_and_anchors_on_its_id() {
        let n = build_credential_reauth_nudges(&[mk(
            "cred_1",
            "Google Drive",
            "google",
            Some("michal@example.com"),
        )]);
        assert_eq!(n.len(), 1);
        assert_eq!(n[0].trigger_kind, "credential_reauth");
        // The id is the dedupe anchor AND what the orb hands to the reconnect.
        assert_eq!(n[0].trigger_ref.as_deref(), Some("cred_1"));
        assert!(
            n[0].message.contains("michal@example.com"),
            "{}",
            n[0].message
        );
        assert!(n[0].message.contains("Google Drive"), "{}", n[0].message);
    }

    #[test]
    fn a_missing_account_does_not_render_an_empty_parenthetical() {
        let n = build_credential_reauth_nudges(&[mk("cred_2", "Slack", "slack", None)]);
        assert!(!n[0].message.contains("()"), "{}", n[0].message);
        assert!(!n[0].message.contains("your  account"), "{}", n[0].message);
    }

    #[test]
    fn each_flagged_credential_gets_its_own_nudge() {
        let n = build_credential_reauth_nudges(&[
            mk("a", "Drive", "google", None),
            mk("b", "Calendar", "google", None),
        ]);
        assert_eq!(n.len(), 2);
        assert_eq!(n[0].trigger_ref.as_deref(), Some("a"));
        assert_eq!(n[1].trigger_ref.as_deref(), Some("b"));
    }

    #[test]
    fn only_the_needs_reauth_flag_qualifies_a_row() {
        assert!(flagged_from(&cred("c1", None)).is_none());
        assert!(flagged_from(&cred("c2", Some("{}"))).is_none());
        assert!(flagged_from(&cred("c3", Some(&ledger_meta_flag_explicitly_false()))).is_none());
        assert!(flagged_from(&cred("c4", Some(&ledger_meta(false, None)))).is_none());
        assert!(flagged_from(&cred("c5", Some(&ledger_meta(true, None)))).is_some());
    }

    /// The field may be a typed ledger field or a `custom` catch-all key
    /// depending on when this runs relative to the credential-binding work.
    /// Both serialize to the same top-level key, and the reader must not care.
    #[test]
    fn the_bound_account_is_read_through_the_serialized_ledger() {
        let f =
            flagged_from(&cred("c6", Some(&ledger_meta(true, Some("a@b.com"))))).expect("flagged");
        assert_eq!(f.account_email.as_deref(), Some("a@b.com"));
        // A blank value is the same as absent — never render "bound to ".
        let g = flagged_from(&cred("c7", Some(&ledger_meta(true, Some("  "))))).expect("flagged");
        assert!(g.account_email.is_none());
    }
}
