//! Whether a refused token refresh means the grant itself is dead. Pure, so the
//! rule can be tested against fixtures with no live endpoint.

use serde_json::Value;

/// The refusal's error code. RFC 6749 section 5.2 makes `error` a string, and
/// this endpoint also sends Anthropic-shaped errors, `{"error":{"type":...}}`.
/// Claude Code reads both forms from the same endpoint.
pub(super) fn error_code(body: &Value) -> &str {
    match body.get("error") {
        Some(Value::String(code)) => code,
        Some(error) => error.get("type").and_then(Value::as_str).unwrap_or(""),
        None => "",
    }
}

/// Only `invalid_grant` names a dead grant. Section 5.2 lists `invalid_request`,
/// `invalid_client` and `invalid_scope` as other errors, and they say our request
/// is wrong while the token may be fine, so quarantining on them forces a needless
/// re-login. A 400 or 401 that names nothing stays dead: nothing says otherwise,
/// and the alternative retries a dead token on every poll.
pub(super) fn is_dead_grant(status: u16, code: &str) -> bool {
    code == "invalid_grant" || (code.is_empty() && matches!(status, 400 | 401))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn dead(status: u16, body: Value) -> bool {
        is_dead_grant(status, error_code(&body))
    }

    #[test]
    fn invalid_grant_is_dead_in_either_shape() {
        assert!(dead(400, json!({ "error": "invalid_grant" })));
        assert!(dead(401, json!({ "error": "invalid_grant" })));
        assert!(dead(400, json!({ "error": { "type": "invalid_grant" } })));
    }

    #[test]
    fn a_named_error_that_is_not_invalid_grant_is_not_dead() {
        assert!(!dead(400, json!({ "error": "invalid_request" })));
        assert!(!dead(400, json!({ "error": "invalid_scope" })));
        assert!(!dead(401, json!({ "error": "invalid_client" })));
        assert!(!dead(
            400,
            json!({ "error": { "type": "invalid_request_error", "message": "bad" } })
        ));
    }

    #[test]
    fn a_nameless_refusal_keeps_its_old_reading() {
        assert!(dead(400, json!({})));
        assert!(dead(401, json!({ "error": null })));
        assert!(!dead(500, json!({})));
        assert!(!dead(
            429,
            json!({ "error": { "type": "rate_limit_error", "message": "later" } })
        ));
    }
}
