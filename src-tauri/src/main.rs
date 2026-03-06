// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Initialize Sentry before anything else so panics during startup are captured.
    // Returns a no-op guard when SENTRY_DSN is absent (local dev).
    let _sentry_guard = sentry::init(sentry_options());

    app_lib::run();
}

fn sentry_options() -> sentry::ClientOptions {
    sentry::ClientOptions {
        dsn: option_env!("SENTRY_DSN").and_then(|s| s.parse().ok()),
        release: Some(env!("CARGO_PKG_VERSION").into()),
        traces_sample_rate: 0.0,
        send_default_pii: false,
        // Track app sessions for Release Health (active user counts per version).
        // Sessions use anonymous device IDs — no PII.
        auto_session_tracking: true,
        session_mode: sentry::SessionMode::Application,
        before_send: Some(std::sync::Arc::new(|mut event| {
            // Strip user fields
            if let Some(ref mut user) = event.user {
                user.email = None;
                user.ip_address = None;
                user.username = None;
            }
            // Strip request body data
            if let Some(ref mut request) = event.request {
                request.data = None;
            }
            // Scrub PII from the event message
            if let Some(ref mut msg) = event.message {
                *msg = pii::scrub(msg);
            }
            // Scrub PII from exception values (the rendered error string)
            for exc in event.exception.values.iter_mut() {
                if let Some(ref mut val) = exc.value {
                    *val = pii::scrub(val);
                }
            }
            // Scrub PII from breadcrumb messages attached to the event
            for breadcrumb in event.breadcrumbs.values.iter_mut() {
                if let Some(ref mut msg) = breadcrumb.message {
                    *msg = pii::scrub(msg);
                }
                // Remove structured data that may contain PII
                breadcrumb.data.retain(|k, _| !pii::is_sensitive_field(k));
            }
            Some(event)
        })),
        before_breadcrumb: Some(std::sync::Arc::new(|mut breadcrumb| {
            // Scrub PII from standalone breadcrumbs (WARN-level logs)
            if let Some(ref mut msg) = breadcrumb.message {
                *msg = pii::scrub(msg);
            }
            breadcrumb.data.retain(|k, _| !pii::is_sensitive_field(k));
            breadcrumb
        })),
        ..Default::default()
    }
}

/// PII scrubbing utilities for Sentry events and breadcrumbs.
///
/// Strips or redacts:
/// - UUIDs (execution_id, persona_id, trigger_id, etc.) → short hash prefix
/// - Quoted names (credential names, persona names) → `[redacted]`
/// - Full URLs → domain-only
mod pii {
    use std::sync::OnceLock;
    use regex::Regex;

    fn uuid_re() -> &'static Regex {
        static RE: OnceLock<Regex> = OnceLock::new();
        RE.get_or_init(|| {
            Regex::new(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}").unwrap()
        })
    }

    fn quoted_re() -> &'static Regex {
        static RE: OnceLock<Regex> = OnceLock::new();
        RE.get_or_init(|| {
            Regex::new(r#"'[^']{1,200}'|"[^"]{1,200}""#).unwrap()
        })
    }

    fn url_re() -> &'static Regex {
        static RE: OnceLock<Regex> = OnceLock::new();
        RE.get_or_init(|| {
            Regex::new(r"https?://[^\s,)}\]]+").unwrap()
        })
    }

    /// Scrub PII from a log message string.
    pub fn scrub(input: &str) -> String {
        // 1. Replace UUIDs with a short prefix for correlation
        let mut result = uuid_re().replace_all(input, |caps: &regex::Captures| {
            let full = caps.get(0).unwrap().as_str();
            format!("[id:{}]", &full[..6])
        }).into_owned();

        // 2. Reduce URLs to scheme + host only
        result = url_re().replace_all(&result, |caps: &regex::Captures| {
            let url = caps.get(0).unwrap().as_str();
            redact_url(url)
        }).into_owned();

        // 3. Redact quoted strings (credential names, persona names, etc.)
        result = quoted_re().replace_all(&result, "[redacted]").into_owned();

        result
    }

    /// Reduce a URL to scheme + host only (strips path, query, fragment, userinfo).
    fn redact_url(url: &str) -> String {
        if let Some(scheme_end) = url.find("://") {
            let after_scheme = &url[scheme_end + 3..];
            let host_end = after_scheme.find('/').unwrap_or(after_scheme.len());
            let host_part = &after_scheme[..host_end];
            // Strip userinfo (user:pass@host)
            let clean_host = if let Some(at_pos) = host_part.find('@') {
                &host_part[at_pos + 1..]
            } else {
                host_part
            };
            format!("{}://{}/…", &url[..scheme_end], clean_host)
        } else {
            "[redacted-url]".to_string()
        }
    }

    /// Fields in breadcrumb `data` map that may contain PII.
    pub fn is_sensitive_field(key: &str) -> bool {
        matches!(
            key,
            "execution_id"
                | "persona_id"
                | "persona_name"
                | "trigger_id"
                | "credential_id"
                | "policy_id"
                | "event_id"
                | "source_persona_id"
                | "tool_name"
                | "api_url"
                | "endpoint"
                | "connector_name"
                | "user_name"
        )
    }
}
