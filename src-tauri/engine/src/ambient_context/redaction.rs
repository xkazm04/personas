// ---------------------------------------------------------------------------
// Capture-time redaction
// ---------------------------------------------------------------------------

/// Maximum length for a captured window title. Long titles often contain
/// pasted error messages, URLs with query strings, or document paths —
/// truncating bounds the per-signal token cost in the rolling window.
pub(crate) const WINDOW_TITLE_MAX_LEN: usize = 120;

/// Maximum length for redacted clipboard content stored in the rolling
/// window. Captures the head of the paste — enough for context, bounded
/// for prompt-token cost. Long clipboard items (code, logs, prose) get
/// truncated with an ellipsis suffix.
pub(crate) const CLIPBOARD_CONTENT_MAX_LEN: usize = 256;

/// Redact a clipboard payload before it enters the rolling window.
///
/// The Sourabh Sharma blueprint and Phase 1 audit both flagged
/// credential-shaped clipboard content as the highest-risk leak surface
/// for an always-listening companion. Pasted secrets routinely include
/// AWS keys, JWTs, Bearer tokens, and provider-prefixed API keys. This
/// function masks each known shape with a typed token (e.g. `[REDACTED:jwt]`)
/// before the content is stored, so the un-redacted secret never reaches
/// the rolling window OR the broadcast channel.
///
/// Strategy:
///   - JWTs (three base64-url-safe segments separated by `.`)
///   - Bearer tokens (literal `Bearer <token>`)
///   - AWS access keys (`AKIA...` + 16 alnum)
///   - Stripe live/test keys (`sk_live_...` / `pk_live_...`)
///   - GitHub fine-grained tokens (`ghp_...`, `github_pat_...`)
///   - Slack bot tokens (`xoxb-...`)
///   - Email addresses → `[email]`
///   - Final length cap at `CLIPBOARD_CONTENT_MAX_LEN`
///
/// Pure (no I/O). Idempotent on already-redacted input.
pub fn redact_clipboard_content(content: &str) -> String {
    use std::sync::OnceLock;
    static PATTERNS: OnceLock<Vec<(regex::Regex, &'static str)>> = OnceLock::new();
    let patterns = PATTERNS.get_or_init(|| {
        vec![
            // JWT: three base64url segments separated by dots, first starts with eyJ.
            (
                regex::Regex::new(r"\beyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\b")
                    .unwrap(),
                "[REDACTED:jwt]",
            ),
            // AWS access key id.
            (
                regex::Regex::new(r"\bAKIA[0-9A-Z]{16}\b").unwrap(),
                "[REDACTED:aws-key]",
            ),
            // Stripe keys (live and test, public and secret).
            (
                regex::Regex::new(r"\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9]{16,}\b").unwrap(),
                "[REDACTED:stripe-key]",
            ),
            // GitHub PATs (classic personal-access tokens + fine-grained).
            (
                regex::Regex::new(r"\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b").unwrap(),
                "[REDACTED:github-token]",
            ),
            (
                regex::Regex::new(r"\bgithub_pat_[A-Za-z0-9_]{20,}\b").unwrap(),
                "[REDACTED:github-token]",
            ),
            // Slack bot/user tokens (xoxb / xoxp).
            (
                regex::Regex::new(r"\bxox[bpoa]-[A-Za-z0-9\-]{10,}\b").unwrap(),
                "[REDACTED:slack-token]",
            ),
            // Bearer header — match literal `Bearer ` plus a token-shape suffix.
            (
                regex::Regex::new(r"\bBearer\s+[A-Za-z0-9_\-\.]{16,}\b").unwrap(),
                "Bearer [REDACTED]",
            ),
            // Email addresses.
            (
                regex::Regex::new(r"\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b").unwrap(),
                "[email]",
            ),
        ]
    });

    let mut out = content.to_string();
    for (re, replacement) in patterns.iter() {
        out = re.replace_all(&out, *replacement).into_owned();
    }

    // Length cap — truncate at char boundary, append ellipsis if cut.
    if out.chars().count() > CLIPBOARD_CONTENT_MAX_LEN {
        let truncated: String = out.chars().take(CLIPBOARD_CONTENT_MAX_LEN).collect();
        format!("{truncated}…")
    } else {
        out
    }
}

/// Redact a window title before it enters the rolling ambient window.
///
/// Window titles routinely leak sensitive content — filenames in editor
/// tabs (`~/Documents/Confidential proposal.docx — Word`), URLs with
/// query parameters in browser tabs (`Google Search — paypal login`),
/// email subject lines (`Re: severance terms — Outlook`). The Sourabh
/// Sharma blueprint and Phase 1 audit both call out window-title
/// redaction as Phase 2's mandatory companion to clipboard redaction.
///
/// Strategy:
///   1. Reduce filesystem paths in the title to basenames only —
///      `C:\Users\foo\secret.docx — Word` becomes `secret.docx — Word`.
///   2. Mask email-shaped patterns with `[email]`.
///   3. Mask URL paths beyond the host (preserve domain for context but
///      drop query strings and path segments).
///   4. Cap total length to `WINDOW_TITLE_MAX_LEN` chars.
///
/// Idempotent: redacting an already-redacted title produces the same
/// string. Pure (no I/O, no allocations beyond the result string).
pub fn redact_window_title(title: &str) -> String {
    let mut out = String::with_capacity(title.len());

    // Step 1: reduce filesystem paths to basenames. Match both Windows
    // (`C:\…`, `D:\…`) and POSIX (`/…`) absolute path tokens. Heuristic:
    // a token containing `/` or `\` and at least one path separator is
    // treated as a path; we keep only the part after the final separator.
    for token in title.split_whitespace() {
        if !out.is_empty() {
            out.push(' ');
        }
        let looks_like_path = token.contains('\\')
            || (token.contains('/')
                && !token.starts_with("http://")
                && !token.starts_with("https://"));
        if looks_like_path {
            // Take the basename — the last component after the rightmost separator.
            let basename = token
                .rsplit(|c| c == '/' || c == '\\')
                .next()
                .unwrap_or(token);
            out.push_str(basename);
        } else if let Some(at_pos) = token.find('@') {
            // Email-shaped token: replace anything that looks like an
            // email with [email]. Conservative: must have `@` and a dot
            // somewhere after.
            if token[at_pos..].contains('.') {
                out.push_str("[email]");
            } else {
                out.push_str(token);
            }
        } else if let Some(rest) = token
            .strip_prefix("https://")
            .or_else(|| token.strip_prefix("http://"))
        {
            // URL: keep scheme+host, drop path/query. Derive the offset
            // from the matched prefix's actual length via strip_prefix
            // rather than a fixed byte constant — "http://" (7 bytes)
            // and "https://" (8 bytes) differ, so a fixed offset both
            // mis-locates the host boundary for the shorter scheme and
            // can land mid-codepoint when an IDN host's first character
            // is multi-byte, panicking on the byte slice.
            let scheme_len = token.len() - rest.len();
            let host_end = rest
                .find('/')
                .map(|i| i + scheme_len)
                .unwrap_or(token.len());
            out.push_str(&token[..host_end]);
        } else {
            out.push_str(token);
        }
    }

    // Step 4: cap length. Truncate at a char boundary (chars iterator)
    // not byte boundary, otherwise we corrupt multi-byte sequences.
    if out.chars().count() > WINDOW_TITLE_MAX_LEN {
        let truncated: String = out.chars().take(WINDOW_TITLE_MAX_LEN).collect();
        format!("{truncated}…")
    } else {
        out
    }
}
