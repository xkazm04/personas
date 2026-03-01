use std::sync::OnceLock;
use regex::Regex;

static EMAIL_PATTERN: OnceLock<Regex> = OnceLock::new();

fn get_email_pattern() -> &'static Regex {
    EMAIL_PATTERN.get_or_init(|| {
        Regex::new(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b").unwrap()
    })
}

/// Sanitize a string by masking potential secrets (API keys, tokens, emails).
/// Used before storing untrusted API responses or error messages in plaintext columns.
pub fn sanitize_secrets(text: &str) -> String {
    let mut sanitized = text.to_string();

    // 1. Mask identified secrets with labels
    // We use a specific order: longer/more specific patterns first.
    
    // a. Authorization: bearer/basic tokens
    let re_auth = Regex::new(r"(?i)\b(authorization|auth)\b\s*[:=]\s*(bearer|basic)\s+([a-zA-Z0-9\-_.~+/=]+)").unwrap();
    sanitized = re_auth.replace_all(&sanitized, "$1: [secret]").to_string();

    // b. Generic key: value pairs
    let re_pairs = Regex::new(r"(?i)\b(api[-_ ]?key|apikey|secret|token|password|passwd|credential|private[-_ ]?key|client[-_ ]?secret|access[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|dsn|connection[-_ ]?string|cookie|session[-_ ]?id)\b\s*([:= ]|is[: ]?)\s*(\S+)").unwrap();
    sanitized = re_pairs.replace_all(&sanitized, |caps: &regex::Captures| {
        format!("{}: [secret]", &caps[1])
    }).to_string();

    // c. Standalone prefixed tokens (ghp_, sk_live_, etc)
    let re_prefixes = Regex::new(r"\b(PMR?S|gh[pous]|AKIA|sk_live_|xox[baprs]-)[a-zA-Z0-9]{16,}\b").unwrap();
    sanitized = re_prefixes.replace_all(&sanitized, "[secret]").to_string();

    // d. Generic bearer/basic not prefixed by "authorization"
    let re_bearer = Regex::new(r"(?i)\b(bearer|basic)\b\s+([a-zA-Z0-9\-_.~+/=]+)").unwrap();
    sanitized = re_bearer.replace_all(&sanitized, |caps: &regex::Captures| {
        // Only replace if not already next to a [secret] tag to avoid double masking
        let whole = &caps[0];
        if whole.contains("[secret]") {
            whole.to_string()
        } else {
            format!("{}: [secret]", &caps[1])
        }
    }).to_string();

    // 2. Mask email addresses
    sanitized = get_email_pattern().replace_all(&sanitized, "[email]").to_string();

    sanitized
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sanitize_secrets() {
        assert_eq!(sanitize_secrets("Invalid API key: 12345-abcde"), "Invalid API key: [secret]");
        // Match either "authorization: [secret]" or similar based on impl
        let auth_res = sanitize_secrets("Authorization: bearer my-token-123");
        assert!(auth_res.to_lowercase().contains("authorization") && auth_res.contains("[secret]"));
        assert!(!auth_res.contains("my-token-123"));

        assert_eq!(sanitize_secrets("Your password is: P@ssw0rd123"), "Your password: [secret]");
        assert_eq!(sanitize_secrets("Contact support@example.com for help"), "Contact [email] for help");
        assert_eq!(sanitize_secrets("Error in sk_live_abc123xyz789000000"), "Error in [secret]");
    }
}
