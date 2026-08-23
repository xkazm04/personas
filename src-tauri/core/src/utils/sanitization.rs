use regex::Regex;
use std::sync::OnceLock;

static EMAIL_PATTERN: OnceLock<Regex> = OnceLock::new();

fn get_email_pattern() -> &'static Regex {
    EMAIL_PATTERN
        .get_or_init(|| Regex::new(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b").unwrap())
}

// Compiled once like EMAIL_PATTERN above: sanitize_secrets runs on every
// audit-log write and engine error path (some in loops), and recompiling
// these four patterns per call — NFA construction, dominated by the big
// re_pairs alternation — dwarfed the actual matching on short log strings.
static AUTH_PATTERN: OnceLock<Regex> = OnceLock::new();
static PAIRS_PATTERN: OnceLock<Regex> = OnceLock::new();
static PREFIXES_PATTERN: OnceLock<Regex> = OnceLock::new();
static BEARER_PATTERN: OnceLock<Regex> = OnceLock::new();

/// Sanitize a string by masking potential secrets (API keys, tokens, emails).
/// Used before storing untrusted API responses or error messages in plaintext columns.
pub fn sanitize_secrets(text: &str) -> String {
    let mut sanitized = text.to_string();

    // 1. Mask identified secrets with labels
    // We use a specific order: longer/more specific patterns first.

    // a. Authorization: bearer/basic tokens
    let re_auth = AUTH_PATTERN.get_or_init(|| {
        Regex::new(r"(?i)\b(authorization|auth)\b\s*[:=]\s*(bearer|basic)\s+([a-zA-Z0-9\-_.~+/=]+)")
            .unwrap()
    });
    sanitized = re_auth.replace_all(&sanitized, "$1: [secret]").to_string();

    // b. Generic key: value pairs. The key/value quotes are optional so this
    // matches both plain-text log lines ("api key: 12345") AND JSON-quoted
    // pairs ("token":"sk-...") — settings audit-log values are JSON blobs,
    // and a JSON key is never adjacent to `:` without an intervening `"`.
    let re_pairs = PAIRS_PATTERN.get_or_init(|| Regex::new(r#"(?i)\b(api[-_ ]?key|apikey|secret|token|password|passwd|credential|private[-_ ]?key|client[-_ ]?secret|access[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|dsn|connection[-_ ]?string|cookie|session[-_ ]?id)\b"?\s*([:= ]|is[: ]?)\s*"?([^"\s,}]+)"#).unwrap());
    sanitized = re_pairs
        .replace_all(&sanitized, |caps: &regex::Captures| {
            format!("{}: [secret]", &caps[1])
        })
        .to_string();

    // c. Standalone prefixed tokens (ghp_, sk_live_, etc)
    //
    // Corrected 2026-08-15. The previous form was
    //   r"\b(PMR?S|gh[pous]|AKIA|sk_live_|xox[baprs]-)[a-zA-Z0-9]{16,}\b"
    // which COULD NOT MATCH ANY TOKEN GITHUB ISSUES: `gh[pous]` has no `_`, and
    // `_` is not in `[a-zA-Z0-9]`, so `ghp_…` fails at the underscore. It
    // matched a shape GitHub has never issued and omitted `ghr_`. Verified in
    // both Node's engine and the `regex` crate this binary links; they agree.
    //
    // Replayed against 20 real token shapes the old form masked 7 and leaked
    // 13 — and the 7 were caught by the labelled key:value rule above (pass b),
    // not by this one. No Google `AIza`, no Anthropic `sk-ant-`, no JWT.
    //
    // The per-class forms below come from `core/src/redact.rs`, which has been
    // correct since it was written. The fix was already in this crate, in a
    // different module — which is why the defect survived: a reader of either
    // file sees a plausible credential regex. `sk-ant-` precedes `sk-` because
    // the regex crate's alternation is leftmost-first.
    let re_prefixes = PREFIXES_PATTERN.get_or_init(|| {
        Regex::new(
            r"(?:PMR?S[a-zA-Z0-9]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|sk-ant-[A-Za-z0-9_\-]{20,}|sk-[A-Za-z0-9]{20,}|sk_live_[a-zA-Z0-9]{16,}|xox[baprs]-[A-Za-z0-9\-]{10,}|AIza[0-9A-Za-z_\-]{35}|eyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+)",
        )
        .unwrap()
    });
    sanitized = re_prefixes.replace_all(&sanitized, "[secret]").to_string();

    // d. Generic bearer/basic not prefixed by "authorization"
    let re_bearer = BEARER_PATTERN
        .get_or_init(|| Regex::new(r"(?i)\b(bearer|basic)\b\s+([a-zA-Z0-9\-_.~+/=]+)").unwrap());
    sanitized = re_bearer
        .replace_all(&sanitized, |caps: &regex::Captures| {
            // Only replace if not already next to a [secret] tag to avoid double masking
            let whole = &caps[0];
            if whole.contains("[secret]") {
                whole.to_string()
            } else {
                format!("{}: [secret]", &caps[1])
            }
        })
        .to_string();

    // 2. Mask email addresses
    sanitized = get_email_pattern()
        .replace_all(&sanitized, "[email]")
        .to_string();

    sanitized
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sanitize_secrets() {
        assert_eq!(
            sanitize_secrets("Invalid API key: 12345-abcde"),
            "Invalid API key: [secret]"
        );
        // Match either "authorization: [secret]" or similar based on impl
        let auth_res = sanitize_secrets("Authorization: bearer my-token-123");
        assert!(auth_res.to_lowercase().contains("authorization") && auth_res.contains("[secret]"));
        assert!(!auth_res.contains("my-token-123"));

        assert_eq!(
            sanitize_secrets("Your password is: P@ssw0rd123"),
            "Your password: [secret]"
        );
        assert_eq!(
            sanitize_secrets("Contact support@example.com for help"),
            "Contact [email] for help"
        );
        assert_eq!(
            sanitize_secrets("Error in sk_live_abc123xyz789000000"),
            "Error in [secret]"
        );
    }
}
