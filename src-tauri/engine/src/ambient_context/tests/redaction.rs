use super::super::*;

// ── Window-title redaction ────────────────────────────────────────────

#[test]
fn redact_title_strips_filesystem_paths_to_basename() {
    // Editor tabs typically render as `<full path> — <app>`. The
    // basename is the visible part the user expects to see; the
    // directory chain is the leak.
    assert_eq!(
        redact_window_title("C:\\Users\\foo\\Documents\\secret.docx — Word"),
        "secret.docx — Word"
    );
    assert_eq!(
        redact_window_title("/home/user/projects/personas/main.rs - Code"),
        "main.rs - Code"
    );
}

#[test]
fn redact_title_masks_emails() {
    assert_eq!(
        redact_window_title("Re: design review john.doe@example.com — Outlook"),
        "Re: design review [email] — Outlook"
    );
}

#[test]
fn redact_title_strips_url_path_and_query() {
    // Browser titles often expose the full URL in the tab. Keeping
    // host but dropping path+query reduces leak surface while
    // preserving "user is on github.com" context.
    let out =
        redact_window_title("Issue #42 — https://github.com/owner/repo/issues/42?token=secret");
    assert!(out.contains("https://github.com"));
    assert!(!out.contains("token=secret"));
    assert!(!out.contains("/owner/repo"));
}

#[test]
fn redact_title_truncates_long_input() {
    let long = "x".repeat(500);
    let out = redact_window_title(&long);
    // Truncated to the cap with an ellipsis suffix.
    assert!(out.chars().count() <= WINDOW_TITLE_MAX_LEN + 1);
    assert!(out.ends_with('…'));
}

#[test]
fn redact_title_idempotent_on_clean_input() {
    let clean = "main.rs - Code";
    assert_eq!(redact_window_title(clean), clean);
}

#[test]
fn redact_title_handles_idn_host_after_http_scheme() {
    // Regression: the old code sliced `token[8..]` unconditionally,
    // which is one byte too many for the 7-byte "http://" prefix and
    // panics ("not a char boundary") when the host's first character
    // is multi-byte, as in an IDN domain. Must not panic, and must
    // keep the scheme+host intact.
    let out = redact_window_title("Tab — http://café.example/path?x=1");
    assert!(out.contains("http://café.example"));
    assert!(!out.contains("/path"));
}

#[test]
fn redact_title_keeps_full_ascii_host_after_http_scheme() {
    // Same off-by-one bug, ASCII case: the fixed offset of 8 chopped
    // the first byte of the host for plain "http://" URLs.
    let out = redact_window_title("http://example.com/path");
    assert!(out.contains("http://example.com"));
    assert!(!out.contains("/path"));
}

// ── Clipboard content capture + redaction (Phase 3 v1) ────────────────

#[test]
fn redact_clipboard_masks_jwt() {
    let raw = "Authorization: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0In0.SflKxwRJSMeKKF2QT4f";
    let out = redact_clipboard_content(raw);
    assert!(!out.contains("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"));
    assert!(out.contains("[REDACTED:jwt]"));
}

#[test]
fn redact_clipboard_masks_aws_key() {
    let raw = "export AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE";
    let out = redact_clipboard_content(raw);
    assert!(!out.contains("AKIAIOSFODNN7EXAMPLE"));
    assert!(out.contains("[REDACTED:aws-key]"));
}

#[test]
fn redact_clipboard_masks_stripe_keys() {
    let raw = "stripe.api_key = sk_live_4eC39HqLyjWDarjtT1zdp7dc";
    let out = redact_clipboard_content(raw);
    assert!(!out.contains("sk_live_4eC39HqLyjWDarjtT1zdp7dc"));
    assert!(out.contains("[REDACTED:stripe-key]"));
}

#[test]
fn redact_clipboard_masks_github_pat() {
    let raw = "git remote set-url origin https://oauth2:ghp_AbCdEfGhIjKlMnOpQrStUvWxYz0123456@github.com/owner/repo";
    let out = redact_clipboard_content(raw);
    assert!(!out.contains("ghp_AbCdEfGhIjKlMnOpQrStUvWxYz0123456"));
    assert!(out.contains("[REDACTED:github-token]"));
}

#[test]
fn redact_clipboard_masks_slack_token() {
    let raw = "slack_bot_token=xoxb-1234567890-1234567890-AbCdEfGhIjKlMnOpQrStUvWx";
    let out = redact_clipboard_content(raw);
    assert!(!out.contains("xoxb-1234567890-1234567890-AbCdEfGhIjKlMnOpQrStUvWx"));
    assert!(out.contains("[REDACTED:slack-token]"));
}

#[test]
fn redact_clipboard_masks_bearer_token() {
    let raw =
        "curl -H 'Authorization: Bearer abc123def456ghi789jklmnopqr_-.xyz' https://api.example.com";
    let out = redact_clipboard_content(raw);
    assert!(!out.contains("abc123def456ghi789jklmnopqr"));
    assert!(out.contains("Bearer [REDACTED]"));
}

#[test]
fn redact_clipboard_masks_emails() {
    let raw = "Send the report to alice@example.com and bob.smith@company.co.uk by Friday.";
    let out = redact_clipboard_content(raw);
    assert!(!out.contains("alice@example.com"));
    assert!(!out.contains("bob.smith@company.co.uk"));
    assert!(out.matches("[email]").count() == 2);
}

#[test]
fn redact_clipboard_truncates_long_input() {
    let raw = "x".repeat(2000);
    let out = redact_clipboard_content(&raw);
    // Cap at CLIPBOARD_CONTENT_MAX_LEN with ellipsis suffix.
    assert!(out.chars().count() <= CLIPBOARD_CONTENT_MAX_LEN + 1);
    assert!(out.ends_with('…'));
}

#[test]
fn redact_clipboard_idempotent_on_clean_text() {
    let clean = "TODO: refactor the cache eviction logic in dedupedStorage.ts";
    assert_eq!(redact_clipboard_content(clean), clean);
}

#[test]
fn redact_clipboard_handles_multiple_secrets() {
    let raw = "key=AKIAIOSFODNN7EXAMPLE jwt=eyJhbGc.payload.sig and email=foo@bar.com";
    let out = redact_clipboard_content(raw);
    assert!(out.contains("[REDACTED:aws-key]"));
    assert!(out.contains("[REDACTED:jwt]"));
    assert!(out.contains("[email]"));
    assert!(!out.contains("AKIAIOSFODNN7EXAMPLE"));
    assert!(!out.contains("foo@bar.com"));
}
