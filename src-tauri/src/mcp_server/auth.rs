//! Capability-token authentication for the `personas-mcp` stdio surface.
//!
//! # Why this exists
//!
//! Spawning `personas-mcp --db-path <path>` hands the caller full persona
//! CRUD + execute AND vault-connector reads through the credential bridge. That
//! is a privilege-escalation surface identical in blast radius to the HTTP
//! management API — but until now the stdio transport had **zero** auth. This
//! module closes that gap by validating a `pk_<hex>` capability token against
//! the SAME `external_api_keys` registry the HTTP surface uses
//! ([`crate::db::repos::resources::external_api_keys::find_by_token`]) — no
//! parallel auth system, same hashing / expiry / revocation semantics, same
//! per-key audit trail ([`crate::db::repos::resources::api_key_audit`]).
//!
//! # Policy
//!
//! - `initialize` and `tools/list` are allowed WITHOUT a token so a client can
//!   complete the MCP handshake and render a readable auth error in its tool UI.
//! - `tools/call` requires a valid token that carries the [`MCP_REQUIRED_SCOPE`]
//!   scope (the same `personas:execute` string the management API mints, see
//!   `management_api::SCOPE_EXECUTE`). No grandfathering: a token-less setup is
//!   rejected and told to re-run `personas-mcp install`.
//!
//! Token plaintext is NEVER logged.

use crate::db::repos::resources::api_key_audit as audit_repo;
use crate::db::repos::resources::external_api_keys as api_key_repo;

use super::db::McpDbPool;

/// Scope an MCP token must hold to invoke a tool. Deliberately the same string
/// the management API mints as `SCOPE_EXECUTE` — an MCP token is a persona-
/// execute credential, so it reuses that grant rather than inventing a new one.
pub const MCP_REQUIRED_SCOPE: &str = "personas:execute";

/// Synthetic "path" recorded in the per-key audit trail for MCP tool calls, so
/// an operator can distinguish stdio activity from HTTP `/api/*` activity.
const AUDIT_METHOD: &str = "MCP";

/// Outcome of authorizing a `tools/call`.
pub enum AuthDecision {
    /// Token valid and scoped; proceed. Carries the resolved key id (already
    /// audited as a 200).
    Allow,
    /// Rejected. Carries a human-readable reason for the JSON-RPC error.
    Deny(String),
}

/// The message every rejection ends with — it names the fix explicitly so the
/// operator knows the token is provisioned by re-installing.
fn reinstall_hint() -> &'static str {
    "Re-run `personas-mcp install --target <claude-code|cursor>` to provision a \
     token, or set PERSONAS_MCP_TOKEN in the server's env block."
}

/// Authorize a `tools/call` for `tool_name` given the caller-supplied token.
///
/// Records a best-effort audit row for outcomes that resolve to a real key
/// (a scope denial → 403, a success → 200). An unregistered/empty token cannot
/// be audited per-key (no key row exists) and is simply denied.
pub fn authorize_tool_call(
    pool: &McpDbPool,
    token: Option<&str>,
    tool_name: &str,
) -> AuthDecision {
    let token = match token.map(str::trim).filter(|t| !t.is_empty()) {
        Some(t) => t,
        None => {
            return AuthDecision::Deny(format!(
                "Authentication required: personas-mcp tool calls need a capability token. {}",
                reinstall_hint()
            ));
        }
    };

    let key = match api_key_repo::find_by_token(pool.pool(), token) {
        Ok(Some(k)) => k,
        Ok(None) => {
            // Unknown / revoked / expired token. No key row → nothing to audit.
            return AuthDecision::Deny(format!(
                "Invalid or expired token. {}",
                reinstall_hint()
            ));
        }
        Err(e) => {
            tracing::error!(error = %e, "MCP token lookup failed");
            return AuthDecision::Deny("Internal error validating token".to_string());
        }
    };

    let audit_path = format!("/mcp/tools/call/{tool_name}");

    if !key.parsed_scopes().iter().any(|s| s == MCP_REQUIRED_SCOPE) {
        // Authenticated but under-scoped → audit as a 403 (mirrors the HTTP
        // middleware's scope-denial audit).
        let _ = audit_repo::insert(
            pool.pool(),
            &key.id,
            AUDIT_METHOD,
            &audit_path,
            403,
            None,
            None,
        );
        return AuthDecision::Deny(format!(
            "Token lacks the required `{MCP_REQUIRED_SCOPE}` scope. {}",
            reinstall_hint()
        ));
    }

    let _ = audit_repo::insert(
        pool.pool(),
        &key.id,
        AUDIT_METHOD,
        &audit_path,
        200,
        None,
        None,
    );
    AuthDecision::Allow
}
