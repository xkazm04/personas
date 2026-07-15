//! One tool-result contract shared across the two out-of-band tool surfaces.
//!
//! Persona LLM tool calls do NOT flow through here — those run the Claude Code
//! CLI with per-execution MCP sidecars. This module serves the *direct* path
//! ([`super::tool_runner`], the UI "run this tool" button + build-time tool
//! tests) and the *MCP playground* path ([`super::mcp_tools`], the vault MCP
//! tool tester). Historically each surface encoded failure differently
//! (`success:false` + a stringified `AppError`; `McpToolResult.is_error`; a
//! typed `AppError::AuthorizationRequired`) and the incidents inbox inherited
//! whatever opaque string bubbled up.
//!
//! [`ToolErrorKind`] is the shared, typed failure category both surfaces map
//! into so the `tool_execution_audit_log` (and the incidents it promotes)
//! carry structure instead of prose. [`classify_app_error`] is the single
//! mapping from an [`AppError`] to `(kind, http_status, retryable)`.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::error::AppError;

/// Maximum bytes of raw tool output the direct path injects to a caller / the
/// audit trail. Chosen at 256 KiB: generous for any real API/script response a
/// human reads in the tool-runner card, while bounding worst-case memory for a
/// runaway script that streams megabytes to stdout. The MCP transport keeps its
/// own, larger 10 MiB wire cap (`mcp_tools::MAX_MCP_PAYLOAD_BYTES`);
/// this cap is about what we *retain and surface*, not what we accept on the
/// wire. Truncation is always surfaced via a `truncated` flag — never silent.
pub const DIRECT_TOOL_OUTPUT_CAP_BYTES: usize = 256 * 1024;

/// Typed category for a tool failure. Both the direct and MCP surfaces classify
/// into this enum so audit rows and the incidents inbox carry a machine token
/// instead of an opaque stringified error.
///
/// Serialized `snake_case` so the wire value doubles as the DB `error_kind`
/// column value (see [`ToolErrorKind::as_str`]).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum ToolErrorKind {
    /// 401/403, OAuth/authorization-required, revoked or missing credentials.
    Auth,
    /// The request or the child process exceeded its time budget.
    Timeout,
    /// A non-2xx HTTP status that is not an auth failure (4xx/5xx).
    Http,
    /// Connection refused, DNS failure, process spawn failure, or an I/O error
    /// reading the child — the call never produced a tool-level result.
    Transport,
    /// The tool itself ran and reported failure (non-zero script exit with
    /// tool semantics, or an MCP `isError` result).
    ToolError,
    /// The local per-tool rate limiter tripped before the call went out.
    RateLimited,
    /// The tool definition / arguments are invalid (missing guide, bad ID,
    /// schema-validation failure) — a configuration problem, not a runtime one.
    Misconfigured,
    /// Failure that does not map cleanly to a more specific kind.
    Unknown,
}

impl ToolErrorKind {
    /// Stable machine token stored in `tool_execution_audit_log.error_kind`.
    pub fn as_str(&self) -> &'static str {
        match self {
            ToolErrorKind::Auth => "auth",
            ToolErrorKind::Timeout => "timeout",
            ToolErrorKind::Http => "http",
            ToolErrorKind::Transport => "transport",
            ToolErrorKind::ToolError => "tool_error",
            ToolErrorKind::RateLimited => "rate_limited",
            ToolErrorKind::Misconfigured => "misconfigured",
            ToolErrorKind::Unknown => "unknown",
        }
    }
}

/// Cap raw tool output at [`DIRECT_TOOL_OUTPUT_CAP_BYTES`] on a UTF-8 char
/// boundary. Returns `(capped, was_truncated)` — the caller surfaces the flag
/// so truncation is never silent.
pub fn cap_output(output: String) -> (String, bool) {
    if output.len() <= DIRECT_TOOL_OUTPUT_CAP_BYTES {
        return (output, false);
    }
    let capped =
        crate::utils::text::truncate_on_char_boundary(&output, DIRECT_TOOL_OUTPUT_CAP_BYTES)
            .to_string();
    (capped, true)
}

/// Classify an [`AppError`] into the shared contract's failure fields:
/// `(error_kind, http_status, retryable)`.
///
/// The direct path's inner functions produce `AppError` (or, once typed,
/// override the classification with a known HTTP status — see
/// [`super::tool_runner`]). This central mapping keeps the two surfaces and the
/// audit trail consistent. `http_status` is only inferred here when the message
/// carries an unambiguous code; the API path sets it explicitly via the shared
/// classifier so it does not depend on string sniffing.
pub fn classify_app_error(err: &AppError) -> (ToolErrorKind, Option<u16>, bool) {
    match err {
        AppError::RateLimited(_) => (ToolErrorKind::RateLimited, None, true),
        AppError::AuthorizationRequired { .. }
        | AppError::OAuthRevoked(_)
        | AppError::Auth(_)
        | AppError::Forbidden(_) => (ToolErrorKind::Auth, None, false),
        AppError::Validation(_) | AppError::NotFound(_) => (ToolErrorKind::Misconfigured, None, false),
        AppError::NetworkOffline(_) => (ToolErrorKind::Transport, None, true),
        AppError::ProcessSpawn(_) => (ToolErrorKind::Transport, None, false),
        AppError::RetryExhausted(_) => (ToolErrorKind::Transport, None, true),
        AppError::Io(_) => (ToolErrorKind::Transport, None, true),
        // Execution / Internal / External carry free-form messages — sniff the
        // well-known shapes the direct + automation paths emit.
        AppError::Execution(msg) | AppError::Internal(msg) | AppError::External(msg) => {
            classify_message(msg)
        }
        _ => (ToolErrorKind::Unknown, None, false),
    }
}

/// Classify a concrete, numerically-known HTTP status into `(kind, retryable)`.
/// Used by the API paths where the status came from `-w '%{http_code}'` (typed)
/// rather than being sniffed from a message. Only call for non-2xx codes.
///
/// - 401/403 → auth (terminal — needs fresh credentials/consent).
/// - 429 and 5xx → http, retryable (rate-limit / server-side, may clear).
/// - other 4xx → http, terminal (bad request / not found won't fix on retry).
pub fn classify_http_status(code: u16) -> (ToolErrorKind, bool) {
    match code {
        401 | 403 => (ToolErrorKind::Auth, false),
        429 => (ToolErrorKind::Http, true),
        500..=599 => (ToolErrorKind::Http, true),
        _ => (ToolErrorKind::Http, false),
    }
}

/// Heuristic classification for the free-form message variants. Kept in one
/// place so `tool_runner`, `mcp_tools`, and `automation_runner` agree on how a
/// timeout / connection failure / HTTP status reads.
fn classify_message(msg: &str) -> (ToolErrorKind, Option<u16>, bool) {
    let lower = msg.to_ascii_lowercase();

    if lower.contains("timed out") || lower.contains("timeout") {
        return (ToolErrorKind::Timeout, None, true);
    }
    // Auth signals (OAuth token expiry, 401/403).
    if lower.contains("401")
        || lower.contains("unauthorized")
        || lower.contains("403")
        || lower.contains("forbidden")
        || lower.contains("expired_token")
        || lower.contains("invalid_token")
    {
        let code = if lower.contains("403") || lower.contains("forbidden") {
            Some(403)
        } else {
            Some(401)
        };
        return (ToolErrorKind::Auth, code, false);
    }
    if lower.contains("failed to connect")
        || lower.contains("failed to spawn")
        || lower.contains("failed to execute")
        || lower.contains("connection refused")
    {
        return (ToolErrorKind::Transport, None, true);
    }
    // Explicit HTTP status shapes ("HTTP 500", "returned 429", etc.).
    if let Some(code) = extract_http_status(&lower) {
        let retryable = code >= 500 || code == 429;
        return (ToolErrorKind::Http, Some(code), retryable);
    }
    if lower.contains("http 5") || lower.contains("server error") {
        return (ToolErrorKind::Http, None, true);
    }
    // A script/tool that exited non-zero with a message ran but failed on its
    // own terms — that is a tool error, not a transport/config problem.
    if lower.contains("exited with") {
        return (ToolErrorKind::ToolError, None, false);
    }
    (ToolErrorKind::Unknown, None, false)
}

/// Best-effort extraction of a 3-digit HTTP status token from a lowercased
/// message. Only matches a standalone `[1-5]xx` code to avoid false positives.
fn extract_http_status(lower: &str) -> Option<u16> {
    for kw in ["http ", "status ", "returned ", "code "] {
        if let Some(idx) = lower.find(kw) {
            let rest = &lower[idx + kw.len()..];
            let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
            if digits.len() == 3 {
                if let Ok(code) = digits.parse::<u16>() {
                    if (100..=599).contains(&code) {
                        return Some(code);
                    }
                }
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_kind_tokens_are_stable_snake_case() {
        assert_eq!(ToolErrorKind::Auth.as_str(), "auth");
        assert_eq!(ToolErrorKind::RateLimited.as_str(), "rate_limited");
        assert_eq!(ToolErrorKind::ToolError.as_str(), "tool_error");
        // The serialized wire form must equal the DB token.
        let json = serde_json::to_string(&ToolErrorKind::Misconfigured).unwrap();
        assert_eq!(json, "\"misconfigured\"");
    }

    #[test]
    fn rate_limited_is_retryable_auth_is_not() {
        let (k, _, retry) = classify_app_error(&AppError::RateLimited("x".into()));
        assert_eq!(k, ToolErrorKind::RateLimited);
        assert!(retry);
        let (k, _, retry) = classify_app_error(&AppError::Auth("x".into()));
        assert_eq!(k, ToolErrorKind::Auth);
        assert!(!retry);
    }

    #[test]
    fn validation_is_misconfigured_not_retryable() {
        let (k, _, retry) = classify_app_error(&AppError::Validation("bad guide".into()));
        assert_eq!(k, ToolErrorKind::Misconfigured);
        assert!(!retry);
    }

    #[test]
    fn message_timeout_and_transport_are_retryable() {
        let (k, _, retry) =
            classify_app_error(&AppError::Execution("Tool 'x' timed out after 120s".into()));
        assert_eq!(k, ToolErrorKind::Timeout);
        assert!(retry);
        let (k, _, retry) =
            classify_app_error(&AppError::Execution("Failed to connect to webhook: http://x".into()));
        assert_eq!(k, ToolErrorKind::Transport);
        assert!(retry);
    }

    #[test]
    fn message_auth_and_http_status_classify() {
        let (k, code, _) =
            classify_app_error(&AppError::Execution("Webhook returned HTTP 401: nope".into()));
        assert_eq!(k, ToolErrorKind::Auth);
        assert_eq!(code, Some(401));
        let (k, code, retry) =
            classify_app_error(&AppError::Execution("Webhook returned HTTP 503: down".into()));
        assert_eq!(k, ToolErrorKind::Http);
        assert_eq!(code, Some(503));
        assert!(retry);
    }

    #[test]
    fn script_nonzero_exit_is_tool_error() {
        let (k, _, retry) =
            classify_app_error(&AppError::Execution("Script exited with exit status: 1: boom".into()));
        assert_eq!(k, ToolErrorKind::ToolError);
        assert!(!retry);
    }

    #[test]
    fn http_status_classification() {
        assert_eq!(classify_http_status(401), (ToolErrorKind::Auth, false));
        assert_eq!(classify_http_status(403), (ToolErrorKind::Auth, false));
        assert_eq!(classify_http_status(429), (ToolErrorKind::Http, true));
        assert_eq!(classify_http_status(500), (ToolErrorKind::Http, true));
        assert_eq!(classify_http_status(503), (ToolErrorKind::Http, true));
        assert_eq!(classify_http_status(404), (ToolErrorKind::Http, false));
    }

    #[test]
    fn cap_output_flags_truncation() {
        let small = "hello".to_string();
        let (out, truncated) = cap_output(small.clone());
        assert_eq!(out, small);
        assert!(!truncated);

        let big = "x".repeat(DIRECT_TOOL_OUTPUT_CAP_BYTES + 100);
        let (out, truncated) = cap_output(big);
        assert_eq!(out.len(), DIRECT_TOOL_OUTPUT_CAP_BYTES);
        assert!(truncated);
    }
}
