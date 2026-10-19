//! Pure policy for the inbound webhook paths: the local `/webhook/{id}`
//! server, the smee.io SSE relay and the cloud firing relay.
//!
//! The I/O for all three lives in the app crate (`src/engine/webhook.rs`,
//! `smee_relay.rs`, `cloud_webhook_relay.rs`), which cannot run its unit
//! tests on Windows. The decisions they make about bytes, headers and
//! de-duplication do not need an `AppHandle`, so they live here, where a
//! regression is a red `cargo test -p personas-engine webhook_ingest`.

// ---------------------------------------------------------------------------
// Request-log header redaction
// ---------------------------------------------------------------------------

/// Value written to the request log in place of a credential-bearing header.
pub const REDACTED_HEADER_VALUE: &str = "[redacted]";

/// Substrings that mark a header as credential-bearing. `x-gitlab-token`
/// carries GitLab's webhook secret in plaintext, `authorization` /
/// `cookie` / `x-api-key` carry bearer credentials, and a signature header
/// paired with the stored payload is enough to replay a delivery.
const SENSITIVE_HEADER_MARKERS: &[&str] = &[
    "authorization",
    "cookie",
    "token",
    "secret",
    "signature",
    "password",
    "api-key",
    "apikey",
    "auth",
];

/// True when a header's value must never reach the plaintext request log.
pub fn is_sensitive_header(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    SENSITIVE_HEADER_MARKERS.iter().any(|m| lower.contains(m))
}

/// Serialize request headers for the request log, keeping every header NAME
/// (so the inspector still shows which signature scheme a sender used) and
/// replacing credential-bearing VALUES with [`REDACTED_HEADER_VALUE`]. A value
/// that is not visible ASCII is logged as `<binary>`.
pub fn headers_for_log<'a, I>(headers: I) -> String
where
    I: IntoIterator<Item = (&'a str, Option<&'a str>)>,
{
    let map: serde_json::Map<String, serde_json::Value> = headers
        .into_iter()
        .map(|(name, value)| {
            let logged = if is_sensitive_header(name) {
                REDACTED_HEADER_VALUE
            } else {
                value.unwrap_or("<binary>")
            };
            (
                name.to_string(),
                serde_json::Value::String(logged.to_string()),
            )
        })
        .collect();
    serde_json::Value::Object(map).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn credential_headers_are_redacted_and_routing_headers_kept() {
        let logged = headers_for_log([
            ("x-gitlab-token", Some("glsecret-123")),
            ("authorization", Some("Bearer abc")),
            ("Cookie", Some("sid=1")),
            ("x-api-key", Some("k-1")),
            ("x-hub-signature-256", Some("sha256=00ff")),
            ("x-webhook-signature", Some("00ff")),
            ("proxy-authorization", Some("Basic x")),
            ("content-type", Some("application/json")),
            ("user-agent", Some("GitHub-Hookshot/1")),
            ("x-github-event", Some("push")),
            ("x-github-delivery", Some("d-1")),
            ("x-odd", None),
        ]);
        let v: serde_json::Value = serde_json::from_str(&logged).unwrap();
        for leaked in [
            "glsecret-123",
            "Bearer abc",
            "sid=1",
            "k-1",
            "sha256=00ff",
            "Basic x",
        ] {
            assert!(
                !logged.contains(leaked),
                "{leaked} reached the log: {logged}"
            );
        }
        assert_eq!(v["x-gitlab-token"], REDACTED_HEADER_VALUE);
        assert_eq!(v["x-webhook-signature"], REDACTED_HEADER_VALUE);
        assert_eq!(v["content-type"], "application/json");
        assert_eq!(v["x-github-event"], "push");
        assert_eq!(v["x-github-delivery"], "d-1");
        assert_eq!(v["x-odd"], "<binary>");
    }
}
