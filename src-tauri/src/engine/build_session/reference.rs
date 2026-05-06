//! Reference attachment for build clarifying questions (C7 increment 2026-04-27).
//!
//! When the build LLM emits a `clarifying_question` with `accepts_reference:
//! true`, the user can attach either a local file or a URL. The fetched
//! contents are then injected into the answer that the LLM sees on its next
//! `--continue` turn.
//!
//! This module owns:
//!
//!   * **Pure injector** [`inject_reference_into_answer`] — wraps fetched
//!     contents in an unambiguous fence the build LLM can recognise.
//!   * **File reader** [`read_file_reference`] — text-only, size-capped,
//!     extension-allowlisted.
//!   * **URL fetcher** [`fetch_url_reference`] — uses
//!     `engine::url_safety::{validate_url_safety, build_ssrf_safe_client}`
//!     for SSRF-safe resolution + transport, content-type guarded,
//!     size-capped.
//!
//! Wire entry: `commands/design/build_sessions.rs::answer_build_question`
//! consumes the resolved content via [`materialise_reference`] and
//! prepends the injected text to the user's answer before piping it to
//! the CLI subprocess.

use std::path::Path;
use std::time::Duration;

use crate::engine::url_safety::{build_ssrf_safe_client, validate_url_safety};
use crate::error::AppError;

/// 256 KB cap — generous for templates / sample inputs without blowing the
/// prompt cache budget. Bytes-of-content, applied to both file and URL paths.
pub const MAX_REFERENCE_BYTES: usize = 256 * 1024;

/// Fence wrapper that makes the attached reference unambiguous to the LLM.
/// Mentioned in the build prompt rule (`session_prompt.rs`) so the model
/// knows exactly how to find the contents in the user's answer.
const FENCE_OPEN: &str = "--- ATTACHED REFERENCE";
const FENCE_CLOSE: &str = "--- END REFERENCE ---";

/// File extensions we accept as text references. PDF/binary/Office formats
/// would need extraction logic — deferred per slice scope.
const ALLOWED_EXTENSIONS: &[&str] = &[
    "txt", "md", "markdown", "json", "yaml", "yml", "toml", "csv", "tsv", "html", "htm", "xml",
    "log", "ini", "conf", "cfg", "rst", "tex",
    // common source-file extensions a user might attach as a "format example"
    "ts", "tsx", "js", "jsx", "py", "rs", "go", "java", "rb", "php", "sh", "sql", "graphql",
    "proto",
];

/// Content-type prefixes we accept on URL fetch responses. Anything outside
/// these prefixes is rejected with a friendly error.
const ALLOWED_CONTENT_TYPE_PREFIXES: &[&str] = &[
    "text/",
    "application/json",
    "application/xml",
    "application/yaml",
    "application/x-yaml",
    "application/toml",
];

const URL_FETCH_TIMEOUT: Duration = Duration::from_secs(10);

// ---------------------------------------------------------------------------
// Pure injector
// ---------------------------------------------------------------------------

/// Wrap reference contents in the fence so the LLM can identify them inside
/// the user's free-text answer. Pure — no I/O.
///
/// `name` is the source identifier (filename for files, URL for URL refs).
/// `content` is the already-loaded text (caller is responsible for size cap
/// + truncation marker).
pub fn inject_reference_into_answer(answer: &str, name: &str, content: &str) -> String {
    let trimmed_answer = answer.trim_end();
    let separator = if trimmed_answer.is_empty() {
        ""
    } else {
        "\n\n"
    };
    format!("{trimmed_answer}{separator}{FENCE_OPEN}: {name} ---\n{content}\n{FENCE_CLOSE}\n")
}

/// Append a fenced WEBHOOK SOURCE block to the answer text. Mirrors the
/// shape that build prompt rule 24 documents — the LLM looks for this exact
/// fence on the next `--continue` turn and copies the URL onto the relevant
/// webhook trigger's `smee_channel_url` config field. Pure — no I/O.
///
/// `event_filter` is rendered as `(none)` when absent so the LLM can clearly
/// distinguish "user attached a filter" from "user didn't supply one".
pub fn append_webhook_source_fence(
    answer: &str,
    channel_url: &str,
    event_filter: Option<&str>,
) -> String {
    let trimmed_answer = answer.trim_end();
    let separator = if trimmed_answer.is_empty() {
        ""
    } else {
        "\n\n"
    };
    let filter_line = match event_filter.map(str::trim).filter(|s| !s.is_empty()) {
        Some(f) => f.to_string(),
        None => "(none)".to_string(),
    };
    format!(
        "{trimmed_answer}{separator}--- WEBHOOK SOURCE ---\nchannel_url: {channel_url}\nevent_filter: {filter_line}\n--- END WEBHOOK SOURCE ---\n"
    )
}

// ---------------------------------------------------------------------------
// File reader
// ---------------------------------------------------------------------------

/// Read a file reference, enforce extension allowlist + size cap, return the
/// content with a `[…truncated, X bytes elided]` marker when truncated.
///
/// Returns `(name, content)` — `name` is the basename (extracted from the
/// path) so the LLM sees just `invoice-template.json`, not the full path.
pub fn read_file_reference(path: &str) -> Result<(String, String), AppError> {
    let p = Path::new(path);

    let name = p
        .file_name()
        .and_then(|n| n.to_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| "reference".to_string());

    let extension_ok = p
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .map(|e| ALLOWED_EXTENSIONS.contains(&e.as_str()))
        .unwrap_or(false);
    if !extension_ok {
        return Err(AppError::Validation(format!(
            "Reference file '{name}' has an unsupported extension. Allowed: {}",
            ALLOWED_EXTENSIONS.join(", ")
        )));
    }

    let bytes = std::fs::read(p).map_err(|e| {
        AppError::Validation(format!("Failed to read reference file '{name}': {e}"))
    })?;

    let content = decode_with_size_cap(bytes, &name)?;
    Ok((name, content))
}

// ---------------------------------------------------------------------------
// URL fetcher
// ---------------------------------------------------------------------------

/// Fetch a URL reference: SSRF-validated, content-type guarded, size-capped.
/// Returns `(name, content)` where `name` is the URL itself (the LLM may
/// want to cite it in the resulting persona).
pub async fn fetch_url_reference(url: &str) -> Result<(String, String), AppError> {
    validate_url_safety(url)
        .map_err(|e| AppError::Validation(format!("URL reference rejected: {e}")))?;

    let client = build_ssrf_safe_client(URL_FETCH_TIMEOUT);
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| AppError::Validation(format!("URL reference fetch failed: {e}")))?;

    if !resp.status().is_success() {
        return Err(AppError::Validation(format!(
            "URL reference returned non-success status {} for {url}",
            resp.status()
        )));
    }

    // Content-type guard — refuse binary / unknown types.
    let content_type = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_default();
    let content_type_ok = ALLOWED_CONTENT_TYPE_PREFIXES
        .iter()
        .any(|prefix| content_type.starts_with(prefix));
    if !content_type_ok {
        return Err(AppError::Validation(format!(
            "URL reference content-type '{content_type}' not allowed. Accepted: text/*, application/json, application/xml, application/yaml, application/toml"
        )));
    }

    // Pull body — `bytes()` already buffers in memory; we cap below. Reqwest
    // doesn't expose a streaming size cap helper out of the box for our
    // version, so the simplest robust path is: request, take `bytes()`,
    // truncate. The 10s timeout limits transfer size implicitly for slow
    // links; combined with `Content-Length` we get a reasonable upper bound.
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| AppError::Validation(format!("URL reference body read failed: {e}")))?
        .to_vec();

    let content = decode_with_size_cap(bytes, url)?;
    Ok((url.to_string(), content))
}

// ---------------------------------------------------------------------------
// Materialise — caller-facing dispatcher
// ---------------------------------------------------------------------------

/// One of the three forms a reference can take.
#[derive(Debug, Clone)]
pub enum ReferenceSource<'a> {
    /// Local file (already-validated path from the dialog picker).
    File(&'a str),
    /// URL — fetched with SSRF protection + size cap.
    Url(&'a str),
    /// Inline text the user pasted into the composer (no fetch needed).
    /// Caller supplies its own `name` (usually `"pasted reference"`).
    Inline { name: &'a str, content: &'a str },
}

/// Resolve a reference source to `(name, content)` ready for injection.
/// Routes to file/URL fetchers or returns the inline content directly.
pub async fn materialise_reference(
    source: ReferenceSource<'_>,
) -> Result<(String, String), AppError> {
    match source {
        ReferenceSource::File(path) => read_file_reference(path),
        ReferenceSource::Url(url) => fetch_url_reference(url).await,
        ReferenceSource::Inline { name, content } => {
            let name_str = if name.trim().is_empty() {
                "pasted reference".to_string()
            } else {
                name.to_string()
            };
            let content_str = decode_with_size_cap(content.as_bytes().to_vec(), &name_str)?;
            Ok((name_str, content_str))
        }
    }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/// Decode bytes as UTF-8 and apply the size cap with a marker. Pure.
fn decode_with_size_cap(bytes: Vec<u8>, source_label: &str) -> Result<String, AppError> {
    let original_len = bytes.len();
    let (capped_bytes, truncated) = if original_len > MAX_REFERENCE_BYTES {
        (bytes[..MAX_REFERENCE_BYTES].to_vec(), Some(original_len))
    } else {
        (bytes, None)
    };

    let mut text = String::from_utf8(capped_bytes).map_err(|_| {
        AppError::Validation(format!(
            "Reference '{source_label}' is not valid UTF-8 — only text references are supported"
        ))
    })?;

    if let Some(orig) = truncated {
        let elided = orig - MAX_REFERENCE_BYTES;
        text.push_str(&format!(
            "\n[…truncated, {elided} bytes elided of {orig} total — increase the cap or attach a smaller file]"
        ));
    }

    Ok(text)
}

// ---------------------------------------------------------------------------
// Tests — pure paths only. The HTTP fetch path is exercised in integration
// tests (or live verification) since spinning up an HTTP server in unit
// tests is heavyweight.
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn webhook_fence_appends_after_existing_answer_with_separator() {
        let out = append_webhook_source_fence(
            "I'll forward GitHub pushes",
            "https://smee.io/abc123",
            Some("github.push,github.pull_request"),
        );
        assert!(out.contains("I'll forward GitHub pushes"));
        assert!(out.contains("\n\n--- WEBHOOK SOURCE ---"));
        assert!(out.contains("channel_url: https://smee.io/abc123"));
        assert!(out.contains("event_filter: github.push,github.pull_request"));
        assert!(out.ends_with("--- END WEBHOOK SOURCE ---\n"));
    }

    #[test]
    fn webhook_fence_renders_none_filter_marker_when_absent() {
        let out = append_webhook_source_fence("", "https://smee.io/abc123", None);
        assert!(out.contains("event_filter: (none)"));
    }

    #[test]
    fn webhook_fence_treats_blank_filter_as_none() {
        let out = append_webhook_source_fence("", "https://smee.io/abc123", Some("   "));
        assert!(out.contains("event_filter: (none)"));
    }

    #[test]
    fn webhook_fence_skips_separator_when_answer_is_empty() {
        let out = append_webhook_source_fence("", "https://smee.io/x", None);
        assert!(out.starts_with("--- WEBHOOK SOURCE ---"));
    }

    #[test]
    fn webhook_fence_trims_trailing_whitespace_in_answer() {
        let out = append_webhook_source_fence("answer  \n\n", "https://smee.io/x", None);
        // Exactly two newlines separator, not four
        assert!(out.contains("answer\n\n--- WEBHOOK"));
    }

    #[test]
    fn inject_separates_existing_answer_from_reference() {
        let out =
            inject_reference_into_answer("Use the attached invoice", "invoice.json", "{\"a\":1}");
        assert!(out.contains("Use the attached invoice"));
        assert!(out.contains("--- ATTACHED REFERENCE: invoice.json ---"));
        assert!(out.contains("{\"a\":1}"));
        assert!(out.contains("--- END REFERENCE ---"));
        // Two newlines between the user's answer and the fence — easy for the
        // LLM to spot.
        assert!(out.contains("invoice\n\n--- ATTACHED"));
    }

    #[test]
    fn inject_handles_empty_answer() {
        let out = inject_reference_into_answer("", "x.txt", "hello");
        // No leading separator when the answer is empty
        assert!(out.starts_with("--- ATTACHED REFERENCE: x.txt ---"));
        assert!(out.contains("hello"));
    }

    #[test]
    fn inject_trims_trailing_whitespace_in_answer() {
        let out = inject_reference_into_answer("answer  \n\n", "x.txt", "body");
        // No more than two newlines between answer and fence
        assert!(!out.contains("answer  \n\n\n\n"));
        assert!(out.contains("answer\n\n--- ATTACHED"));
    }

    #[test]
    fn decode_under_cap_returns_content_unchanged() {
        let bytes = b"hello world".to_vec();
        let out = decode_with_size_cap(bytes, "src").unwrap();
        assert_eq!(out, "hello world");
        assert!(!out.contains("truncated"));
    }

    #[test]
    fn decode_over_cap_appends_truncation_marker() {
        let huge = vec![b'x'; MAX_REFERENCE_BYTES + 100];
        let out = decode_with_size_cap(huge, "src").unwrap();
        // Capped content + marker
        assert!(out.contains("[…truncated, 100 bytes elided"));
        assert!(out.len() <= MAX_REFERENCE_BYTES + 200);
    }

    #[test]
    fn decode_invalid_utf8_returns_validation_error() {
        // 0xff is invalid UTF-8 leading byte
        let bad = vec![0xff, 0xfe, 0xfd];
        let err = decode_with_size_cap(bad, "src").unwrap_err();
        match err {
            AppError::Validation(msg) => assert!(msg.contains("not valid UTF-8")),
            other => panic!("expected Validation, got {other:?}"),
        }
    }

    #[test]
    fn read_file_reference_rejects_unsupported_extension() {
        // Use a temp file with .exe extension
        let dir = std::env::temp_dir();
        let path = dir.join(format!("personas-test-{}.exe", uuid::Uuid::new_v4()));
        std::fs::write(&path, b"binary").unwrap();
        let err = read_file_reference(path.to_str().unwrap()).unwrap_err();
        std::fs::remove_file(&path).ok();
        match err {
            AppError::Validation(msg) => assert!(msg.contains("unsupported extension")),
            other => panic!("expected Validation, got {other:?}"),
        }
    }

    #[test]
    fn read_file_reference_returns_basename_not_full_path() {
        let dir = std::env::temp_dir();
        let path = dir.join(format!("personas-test-{}.txt", uuid::Uuid::new_v4()));
        std::fs::write(&path, b"hello world").unwrap();
        let (name, content) = read_file_reference(path.to_str().unwrap()).unwrap();
        std::fs::remove_file(&path).ok();
        assert!(name.starts_with("personas-test-"));
        assert!(name.ends_with(".txt"));
        assert!(!name.contains('\\') && !name.contains('/'));
        assert_eq!(content, "hello world");
    }

    #[test]
    fn read_file_reference_returns_validation_error_for_missing_file() {
        let bogus = "C:\\definitely\\does\\not\\exist.txt";
        let err = read_file_reference(bogus).unwrap_err();
        match err {
            AppError::Validation(msg) => assert!(msg.contains("Failed to read")),
            other => panic!("expected Validation, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn materialise_inline_returns_content_with_provided_name() {
        let (name, content) = materialise_reference(ReferenceSource::Inline {
            name: "pasted-spec",
            content: "API spec body",
        })
        .await
        .unwrap();
        assert_eq!(name, "pasted-spec");
        assert_eq!(content, "API spec body");
    }

    #[tokio::test]
    async fn materialise_inline_falls_back_to_default_name_when_blank() {
        let (name, _) = materialise_reference(ReferenceSource::Inline {
            name: "   ",
            content: "x",
        })
        .await
        .unwrap();
        assert_eq!(name, "pasted reference");
    }

    #[tokio::test]
    async fn fetch_url_reference_rejects_loopback() {
        // Pre-flight SSRF check should reject 127.0.0.1
        let err = fetch_url_reference("http://127.0.0.1:9/anything")
            .await
            .unwrap_err();
        match err {
            AppError::Validation(msg) => {
                assert!(msg.contains("rejected") || msg.contains("private"))
            }
            other => panic!("expected Validation, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn fetch_url_reference_rejects_non_http_scheme() {
        let err = fetch_url_reference("file:///etc/passwd").await.unwrap_err();
        match err {
            AppError::Validation(msg) => {
                assert!(
                    msg.to_lowercase().contains("scheme")
                        || msg.to_lowercase().contains("rejected")
                )
            }
            other => panic!("expected Validation, got {other:?}"),
        }
    }
}
