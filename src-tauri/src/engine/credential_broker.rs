//! Zero-Plaintext Credential Broker — consumer authorization + derived handles.
//!
//! External processes never see credential secrets: they hold revocable
//! `external_api_keys` handles and route real API calls through the audited
//! `/api/proxy/{credential_id}` route on the management server. This module is
//! the enforcement kernel for that flow:
//!
//! - [`authorize_credential_use`] — the pure, default-deny scope-intersection
//!   check between a caller key's scopes and the target credential. A consumer
//!   may use a credential only through an explicit grant: the broad `proxy`
//!   scope (system key), a per-credential `proxy:credential:<id>` grant, or a
//!   per-connector `cred:<connector>:use` grant.
//! - [`mint_derived_handle`] — mints a short-lived, narrowly-scoped consumer
//!   key ("handle") for one credential. The plaintext handle is returned once;
//!   the credential's secret is never part of the response.
//!
//! The credential's own `scoped_resources` (sub-resource pins) are enforced
//! downstream in `engine::api_proxy` via `scope_enforcement::evaluate`, so the
//! effective permission is caller-key grants ∩ credential scoped_resources.
//!
//! v1 honestly covers Bearer/API-key connectors only: SDKs that do SigV4
//! request signing or need raw websockets cannot be proxied by this route
//! (the UI copy states this exclusion).

use crate::db::models::CreateApiKeyResponse;
use crate::db::repos::resources::audit_log;
use crate::db::repos::resources::credentials as cred_repo;
use crate::db::repos::resources::external_api_keys as api_key_repo;
use crate::db::DbPool;
use crate::error::AppError;

/// Broad proxy scope (system key + explicitly trusted keys).
pub const SCOPE_PROXY: &str = "proxy";
/// Per-credential grant prefix: `proxy:credential:<credential_id>`.
pub const SCOPE_PROXY_CREDENTIAL_PREFIX: &str = "proxy:credential:";
/// Per-connector grant shape: `cred:<connector>:use`.
pub const CRED_SCOPE_PREFIX: &str = "cred:";
pub const CRED_SCOPE_SUFFIX: &str = ":use";

/// Default lifetime of a minted derived handle (minutes).
pub const DEFAULT_HANDLE_TTL_MINUTES: u32 = 60;
/// Hard cap on a derived handle's lifetime — 24 hours. "Short-lived" is a
/// security property, not a suggestion; the mint path clamps, never trusts.
pub const MAX_HANDLE_TTL_MINUTES: u32 = 24 * 60;
/// Floor so a mis-typed ttl of 0 doesn't mint an instantly-dead handle.
pub const MIN_HANDLE_TTL_MINUTES: u32 = 5;

/// Which grant authorized a credential use — recorded in the audit detail so
/// "who could do what, and why" is reconstructible from the ledger.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BrokerGrant {
    /// Broad `proxy` scope.
    Broad,
    /// Exact `proxy:credential:<id>` grant.
    PerCredential,
    /// `cred:<connector>:use` grant matching the credential's connector.
    PerConnector,
}

impl BrokerGrant {
    pub fn as_str(&self) -> &'static str {
        match self {
            BrokerGrant::Broad => "proxy",
            BrokerGrant::PerCredential => "per_credential",
            BrokerGrant::PerConnector => "per_connector",
        }
    }
}

/// Build the per-connector use scope for a connector name.
pub fn cred_use_scope(connector: &str) -> String {
    format!("{CRED_SCOPE_PREFIX}{connector}{CRED_SCOPE_SUFFIX}")
}

/// True when a scope string is ANY per-connector credential grant
/// (`cred:<something>:use`). Used by the management-API middleware as a
/// coarse pre-filter; the exact connector match happens in
/// [`authorize_credential_use`] once the credential row is loaded.
pub fn is_cred_use_scope(scope: &str) -> bool {
    scope
        .strip_prefix(CRED_SCOPE_PREFIX)
        .and_then(|rest| rest.strip_suffix(CRED_SCOPE_SUFFIX))
        .is_some_and(|connector| !connector.is_empty())
}

/// Default-deny scope intersection: may a caller key with `scopes` use the
/// credential `credential_id` (connector `service_type`) through the proxy?
///
/// Grants are matched exactly (no substring, no case folding — scopes are
/// minted lowercase by this codebase and a mismatch must deny). Empty scope
/// lists — including the fail-closed empty vec that `parsed_scopes` returns
/// for a corrupt column — authorize nothing.
pub fn authorize_credential_use(
    scopes: &[String],
    credential_id: &str,
    service_type: &str,
) -> Result<BrokerGrant, String> {
    if scopes.iter().any(|s| s == SCOPE_PROXY) {
        return Ok(BrokerGrant::Broad);
    }
    let per_credential = format!("{SCOPE_PROXY_CREDENTIAL_PREFIX}{credential_id}");
    if scopes.iter().any(|s| s == &per_credential) {
        return Ok(BrokerGrant::PerCredential);
    }
    // Guard against degenerate grants matching an empty connector name.
    if !service_type.is_empty() {
        let per_connector = cred_use_scope(service_type);
        if scopes.iter().any(|s| s == &per_connector) {
            return Ok(BrokerGrant::PerConnector);
        }
    }
    Err(format!(
        "caller key holds no grant for this credential (need `{SCOPE_PROXY}`, \
         `{SCOPE_PROXY_CREDENTIAL_PREFIX}{credential_id}`, or `cred:{service_type}:use`)"
    ))
}

/// Clamp a requested handle ttl into the allowed window.
pub fn clamp_handle_ttl(requested_minutes: Option<u32>) -> u32 {
    requested_minutes
        .unwrap_or(DEFAULT_HANDLE_TTL_MINUTES)
        .clamp(MIN_HANDLE_TTL_MINUTES, MAX_HANDLE_TTL_MINUTES)
}

/// Mint a short-lived derived handle for one credential: a fresh
/// `external_api_keys` row scoped to exactly that credential and its
/// connector, with a hard expiry. The response carries the handle plaintext
/// ONCE — never the credential's secret. Every mint is audit-logged against
/// the credential so the ledger shows which consumer identities exist.
pub fn mint_derived_handle(
    pool: &DbPool,
    credential_id: &str,
    consumer_name: &str,
    ttl_minutes: Option<u32>,
) -> Result<CreateApiKeyResponse, AppError> {
    let consumer = consumer_name.trim();
    if consumer.is_empty() {
        return Err(AppError::Validation(
            "Consumer name cannot be empty — every handle must name its consumer".into(),
        ));
    }
    // Credential must exist; also gives us the connector for the scope grant.
    let credential = cred_repo::get_by_id(pool, credential_id)?;

    let ttl = clamp_handle_ttl(ttl_minutes);
    let expires_at = (chrono::Utc::now() + chrono::Duration::minutes(ttl as i64)).to_rfc3339();

    let scopes = vec![
        format!("{SCOPE_PROXY_CREDENTIAL_PREFIX}{}", credential.id),
        cred_use_scope(&credential.service_type),
    ];
    let label = format!(
        "Broker handle · {} · {} — proxies calls, never reveals the secret",
        credential.service_type, credential.name
    );
    let resp = api_key_repo::create(
        pool,
        &format!("handle:{consumer}"),
        scopes,
        Some(expires_at),
        None,
        Some(label),
    )?;

    audit_log::insert_warn(
        pool,
        &credential.id,
        &credential.name,
        "broker_handle_minted",
        Some(&format!(
            "consumer={consumer} key_prefix={} ttl_minutes={ttl}",
            resp.record.key_prefix
        )),
    );
    tracing::info!(
        credential_id = %credential.id,
        consumer = %consumer,
        prefix = %resp.record.key_prefix,
        ttl_minutes = ttl,
        "broker: derived handle minted"
    );
    Ok(resp)
}

// ============================================================================
// Tests — the scope-intersection kernel is pure logic; cover it hard.
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    fn scopes(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn empty_scopes_deny() {
        assert!(authorize_credential_use(&[], "cred-1", "github").is_err());
    }

    #[test]
    fn unrelated_scopes_deny() {
        let s = scopes(&["personas:read", "personas:execute", "personas:build"]);
        assert!(authorize_credential_use(&s, "cred-1", "github").is_err());
    }

    #[test]
    fn broad_proxy_allows_any_credential() {
        let s = scopes(&["proxy"]);
        assert_eq!(
            authorize_credential_use(&s, "cred-1", "github").unwrap(),
            BrokerGrant::Broad
        );
        assert_eq!(
            authorize_credential_use(&s, "cred-2", "sentry").unwrap(),
            BrokerGrant::Broad
        );
    }

    #[test]
    fn per_credential_grant_is_exact() {
        let s = scopes(&["proxy:credential:cred-1"]);
        assert_eq!(
            authorize_credential_use(&s, "cred-1", "github").unwrap(),
            BrokerGrant::PerCredential
        );
        assert!(authorize_credential_use(&s, "cred-2", "github").is_err());
        // Prefix of a longer id must not match.
        assert!(authorize_credential_use(&s, "cred-10", "github").is_err());
    }

    #[test]
    fn per_connector_grant_matches_service_type_only() {
        let s = scopes(&["cred:github:use"]);
        assert_eq!(
            authorize_credential_use(&s, "any-cred", "github").unwrap(),
            BrokerGrant::PerConnector
        );
        assert!(authorize_credential_use(&s, "any-cred", "sentry").is_err());
        // Case-sensitive by design: minted scopes are lowercase.
        assert!(authorize_credential_use(&s, "any-cred", "GitHub").is_err());
    }

    #[test]
    fn malformed_cred_scopes_deny() {
        for bad in ["cred::use", "cred:github", "github:use", "cred:github:read"] {
            let s = scopes(&[bad]);
            assert!(
                authorize_credential_use(&s, "c", "github").is_err(),
                "scope {bad:?} must not authorize"
            );
        }
    }

    #[test]
    fn empty_service_type_never_matches_connector_grants() {
        // A credential row with an empty service_type must not be usable via
        // a degenerate `cred::use` grant.
        let s = scopes(&["cred::use"]);
        assert!(authorize_credential_use(&s, "c", "").is_err());
    }

    #[test]
    fn is_cred_use_scope_shapes() {
        assert!(is_cred_use_scope("cred:github:use"));
        assert!(is_cred_use_scope("cred:google_sheets:use"));
        assert!(!is_cred_use_scope("cred::use"));
        assert!(!is_cred_use_scope("cred:github:read"));
        assert!(!is_cred_use_scope("proxy"));
        assert!(!is_cred_use_scope("proxy:credential:x"));
    }

    #[test]
    fn ttl_clamps_into_window() {
        assert_eq!(clamp_handle_ttl(None), DEFAULT_HANDLE_TTL_MINUTES);
        assert_eq!(clamp_handle_ttl(Some(0)), MIN_HANDLE_TTL_MINUTES);
        assert_eq!(clamp_handle_ttl(Some(30)), 30);
        assert_eq!(clamp_handle_ttl(Some(999_999)), MAX_HANDLE_TTL_MINUTES);
    }
}
