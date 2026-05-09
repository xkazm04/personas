//! Reverse-engineering CLI factory (v1: static-fetch path).
//!
//! See `DESIGN.md` for full rationale and the v1-vs-v2 boundary. Short
//! version: take a URL, fetch the body, regex-extract `<a href>` and
//! `<form action>` patterns, cluster by path stem, emit a
//! `ConnectorManifestDraft`. v2 territory (browser-driven exploration,
//! XHR capture, auth inference) is documented as out-of-scope but
//! reachable from this skeleton.

use std::collections::BTreeMap;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::error::AppError;

const DEFAULT_TIMEOUT_SECS: u64 = 10;
const DEFAULT_MAX_BODY_BYTES: usize = 2 * 1024 * 1024; // 2 MB
const DEFAULT_USER_AGENT: &str =
    "Mozilla/5.0 (compatible; PersonasConnectorExplorer/1.0; +https://personas.dev)";

// ============================================================================
// Public types
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ConnectorManifestDraft {
    /// Slugified hostname; useful as a starter `id` field for the
    /// downstream connector or bridge JSON.
    pub id: String,
    /// Inferred from `<title>` element; falls back to hostname.
    pub label: String,
    /// `https://example.com` form (scheme + host + port). The reviewer
    /// adapts to API-style URLs (e.g. `https://api.example.com`) when
    /// applicable.
    pub base_url: String,
    /// HTTP status code from the initial fetch.
    pub fetched_status: i32,
    /// Final URL after redirect chain.
    pub final_url: String,
    /// Endpoints discovered during the static scan, clustered by stem.
    pub discovered_endpoints: Vec<DiscoveredEndpoint>,
    /// Free-text observations for the human reviewer (e.g. "site uses JS
    /// rendering — static scan likely incomplete").
    pub notes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Eq)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredEndpoint {
    /// Path stem with parameter placeholders, e.g. `/posts/{id}`.
    pub path: String,
    /// HTTP method observed: `GET`, `POST`, etc. `GET` for `<a href>`.
    pub method: String,
    /// Inferred parameter names extracted from the path during clustering.
    pub path_params: Vec<String>,
    /// How many times this stem was observed in the HTML scan.
    pub occurrences: i32,
    /// Sample variants for the human reviewer.
    pub example_paths: Vec<String>,
    /// `<form>` elements record their input names; `<a href>` leaves this
    /// empty.
    pub form_inputs: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct ExplorerOptions {
    pub timeout: Duration,
    pub max_body_bytes: usize,
    pub user_agent: String,
}

impl Default for ExplorerOptions {
    fn default() -> Self {
        Self {
            timeout: Duration::from_secs(DEFAULT_TIMEOUT_SECS),
            max_body_bytes: DEFAULT_MAX_BODY_BYTES,
            user_agent: DEFAULT_USER_AGENT.to_string(),
        }
    }
}

// ============================================================================
// Top-level explore() flow
// ============================================================================

/// Fetch a URL, scan the body, return a draft manifest.
pub async fn explore_url(
    url: &str,
    opts: ExplorerOptions,
) -> Result<ConnectorManifestDraft, AppError> {
    let parsed_url = url::Url::parse(url)
        .map_err(|e| AppError::Validation(format!("invalid URL '{url}': {e}")))?;

    let client = reqwest::Client::builder()
        .timeout(opts.timeout)
        .user_agent(&opts.user_agent)
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|e| AppError::Internal(format!("reqwest client build: {e}")))?;

    let resp = client
        .get(parsed_url.as_str())
        .send()
        .await
        .map_err(|e| AppError::Execution(format!("connector_explorer fetch failed: {e}")))?;
    let status = resp.status().as_u16() as i32;
    let final_url = resp.url().to_string();

    let bytes = resp
        .bytes()
        .await
        .map_err(|e| AppError::Execution(format!("connector_explorer body read failed: {e}")))?;
    let truncated = bytes.len() > opts.max_body_bytes;
    let body_slice = if truncated {
        &bytes[..opts.max_body_bytes]
    } else {
        &bytes[..]
    };
    let body = String::from_utf8_lossy(body_slice).to_string();

    let final_parsed = url::Url::parse(&final_url).unwrap_or(parsed_url);

    let raw_endpoints = extract_endpoints_from_html(&body, &final_parsed);
    let clustered = cluster_endpoints(raw_endpoints);

    let host = final_parsed.host_str().unwrap_or("unknown").to_string();
    let port = final_parsed.port();
    let host_with_port = match port {
        Some(p) => format!("{host}:{p}"),
        None => host.clone(),
    };
    let id = slugify_host(&host_with_port);
    let title = extract_title(&body);
    let label = title.unwrap_or_else(|| host.clone());
    let base_url = format!(
        "{}://{}{}",
        final_parsed.scheme(),
        host,
        match port {
            Some(p) => format!(":{p}"),
            None => String::new(),
        }
    );

    let mut notes = Vec::new();
    if truncated {
        notes.push(format!(
            "Body truncated at {} bytes (total {}); discovery may be incomplete.",
            opts.max_body_bytes,
            bytes.len()
        ));
    }
    if body.trim_start().starts_with("<!DOCTYPE")
        && body.matches("<script").count() > 20
        && clustered.len() < 3
    {
        notes.push(
            "Page appears heavily JS-rendered (many <script> tags, few static endpoints). \
             Static scan is likely missing dynamically-loaded surface. Re-explore once \
             v2 (browser-driven) lands."
                .to_string(),
        );
    }
    if status >= 400 {
        notes.push(format!(
            "Fetched URL returned HTTP {status}; consider auth or a different entry path."
        ));
    }
    if clustered.is_empty() {
        notes.push(
            "No endpoints discovered. The site may require authentication, render its \
             content via JS, or block the User-Agent."
                .to_string(),
        );
    }

    Ok(ConnectorManifestDraft {
        id,
        label,
        base_url,
        fetched_status: status,
        final_url,
        discovered_endpoints: clustered,
        notes,
    })
}

// ============================================================================
// HTML scanning (pure, tested)
// ============================================================================

/// Internal pre-cluster shape.
#[derive(Debug, Clone, PartialEq, Eq)]
struct RawEndpoint {
    pub path: String,
    pub method: String,
    pub form_inputs: Vec<String>,
}

/// Pull `<a href>` and `<form action method>` shapes out of the HTML body
/// and resolve them against `base_url`. Pure function for unit tests.
pub fn extract_endpoints_from_html(body: &str, base_url: &url::Url) -> Vec<RawHttpEndpoint> {
    let mut out: Vec<RawHttpEndpoint> = Vec::new();

    // <a href="...">
    for cap in href_re().captures_iter(body) {
        let raw = cap.get(1).map(|m| m.as_str()).unwrap_or("");
        if let Some(path) = resolve_to_same_host_path(raw, base_url) {
            out.push(RawHttpEndpoint {
                path,
                method: "GET".into(),
                form_inputs: Vec::new(),
            });
        }
    }

    // <form action="..." method="...">
    for cap in form_re().captures_iter(body) {
        let attrs = cap.get(1).map(|m| m.as_str()).unwrap_or("");
        let action = capture_attr(attrs, "action").unwrap_or_default();
        let method = capture_attr(attrs, "method")
            .map(|m| m.to_uppercase())
            .unwrap_or_else(|| "GET".to_string());
        if let Some(path) = resolve_to_same_host_path(&action, base_url) {
            // Walk forward in the body to find input names within this form.
            let after = cap.get(0).map(|m| m.end()).unwrap_or(0);
            let inputs = collect_form_inputs_until_close(body, after);
            out.push(RawHttpEndpoint {
                path,
                method,
                form_inputs: inputs,
            });
        }
    }

    out
}

/// Public alias for [`RawEndpoint`] used by tests and downstream callers.
pub type RawHttpEndpoint = RawEndpoint;

/// Cluster raw endpoints into stems with parameter placeholders.
pub fn cluster_endpoints(raw: Vec<RawHttpEndpoint>) -> Vec<DiscoveredEndpoint> {
    let mut buckets: BTreeMap<(String, String), DiscoveredEndpoint> = BTreeMap::new();

    for r in raw {
        let (stem, params) = parameterise_path(&r.path);
        let key = (r.method.clone(), stem.clone());
        let entry = buckets.entry(key).or_insert(DiscoveredEndpoint {
            path: stem.clone(),
            method: r.method.clone(),
            path_params: params.clone(),
            occurrences: 0,
            example_paths: Vec::new(),
            form_inputs: Vec::new(),
        });
        entry.occurrences += 1;
        if entry.example_paths.len() < 5 && !entry.example_paths.contains(&r.path) {
            entry.example_paths.push(r.path.clone());
        }
        for input in r.form_inputs {
            if !entry.form_inputs.contains(&input) {
                entry.form_inputs.push(input);
            }
        }
    }

    let mut out: Vec<DiscoveredEndpoint> = buckets.into_values().collect();
    out.sort_by(|a, b| {
        b.occurrences
            .cmp(&a.occurrences)
            .then(a.path.cmp(&b.path))
            .then(a.method.cmp(&b.method))
    });
    out
}

/// Collapse numeric and UUID-like segments into `{id}` placeholders. The
/// returned `Vec<String>` lists the placeholder names in the order they
/// appear in the path.
fn parameterise_path(path: &str) -> (String, Vec<String>) {
    let mut params: Vec<String> = Vec::new();
    let stem_segments: Vec<String> = path
        .split('/')
        .map(|seg| {
            if seg.is_empty() {
                seg.to_string()
            } else if is_numeric_segment(seg) {
                let name = next_param_name("id", &params);
                params.push(name.clone());
                format!("{{{name}}}")
            } else if is_uuid_like(seg) {
                let name = next_param_name("uuid", &params);
                params.push(name.clone());
                format!("{{{name}}}")
            } else {
                seg.to_string()
            }
        })
        .collect();
    (stem_segments.join("/"), params)
}

fn is_numeric_segment(s: &str) -> bool {
    !s.is_empty() && s.chars().all(|c| c.is_ascii_digit())
}

fn is_uuid_like(s: &str) -> bool {
    // 8-4-4-4-12 hex with dashes
    let bytes = s.as_bytes();
    if bytes.len() != 36 {
        return false;
    }
    for (i, b) in bytes.iter().enumerate() {
        match i {
            8 | 13 | 18 | 23 => {
                if *b != b'-' {
                    return false;
                }
            }
            _ => {
                let c = *b as char;
                if !c.is_ascii_hexdigit() {
                    return false;
                }
            }
        }
    }
    true
}

fn next_param_name(prefix: &str, taken: &[String]) -> String {
    if !taken.iter().any(|n| n == prefix) {
        return prefix.to_string();
    }
    let mut n = 2;
    loop {
        let candidate = format!("{prefix}{n}");
        if !taken.iter().any(|t| t == &candidate) {
            return candidate;
        }
        n += 1;
    }
}

/// Slugify a hostname (or host:port) for use as a connector id.
pub fn slugify_host(host_with_port: &str) -> String {
    let mut out = String::with_capacity(host_with_port.len());
    for ch in host_with_port.chars() {
        let c = ch.to_ascii_lowercase();
        if c.is_ascii_alphanumeric() {
            out.push(c);
        } else {
            out.push('-');
        }
    }
    let mut prev_dash = false;
    let mut collapsed = String::with_capacity(out.len());
    for ch in out.chars() {
        if ch == '-' {
            if !prev_dash {
                collapsed.push(ch);
            }
            prev_dash = true;
        } else {
            collapsed.push(ch);
            prev_dash = false;
        }
    }
    collapsed.trim_matches('-').to_string()
}

// ============================================================================
// Helpers
// ============================================================================

use std::sync::OnceLock;

use regex::Regex;

fn href_re() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| {
        Regex::new(r#"(?i)href\s*=\s*["']([^"']+)["']"#).expect("href_re compile")
    })
}
fn form_re() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| Regex::new(r#"(?is)<form([^>]*)>"#).expect("form_re compile"))
}
fn form_close_re() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| Regex::new(r#"(?is)</\s*form\s*>"#).expect("form_close_re compile"))
}
fn input_re() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| Regex::new(r#"(?is)<\s*input\b([^>]*)>"#).expect("input_re compile"))
}
fn title_re() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| {
        Regex::new(r#"(?is)<title[^>]*>([^<]*)</title>"#).expect("title_re compile")
    })
}

fn capture_attr(attrs: &str, name: &str) -> Option<String> {
    let pat = format!(r#"(?i){name}\s*=\s*["']([^"']*)["']"#);
    let re = Regex::new(&pat).ok()?;
    re.captures(attrs)?.get(1).map(|m| m.as_str().to_string())
}

fn collect_form_inputs_until_close(body: &str, start: usize) -> Vec<String> {
    let close_at = form_close_re()
        .find_at(body, start)
        .map(|m| m.start())
        .unwrap_or(body.len().min(start + 5000));
    let scope = &body[start..close_at];

    let mut names = Vec::new();
    for cap in input_re().captures_iter(scope) {
        let attrs = cap.get(1).map(|m| m.as_str()).unwrap_or("");
        if let Some(n) = capture_attr(attrs, "name") {
            if !n.is_empty() && !names.contains(&n) {
                names.push(n);
            }
        }
    }
    names
}

/// Resolve a raw href/action into a same-host path string, dropping
/// non-http(s) schemes and cross-host links.
fn resolve_to_same_host_path(raw: &str, base: &url::Url) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    if trimmed.starts_with('#') {
        return None;
    }
    let lower = trimmed.to_ascii_lowercase();
    for prefix in ["mailto:", "tel:", "javascript:", "data:", "sms:"] {
        if lower.starts_with(prefix) {
            return None;
        }
    }
    let resolved = match base.join(trimmed) {
        Ok(u) => u,
        Err(_) => return None,
    };
    if resolved.scheme() != "http" && resolved.scheme() != "https" {
        return None;
    }
    if resolved.host_str() != base.host_str() {
        return None;
    }
    let mut path = resolved.path().to_string();
    if let Some(q) = resolved.query() {
        if !q.is_empty() {
            path.push('?');
            path.push_str(q);
        }
    }
    Some(path)
}

fn extract_title(body: &str) -> Option<String> {
    let cap = title_re().captures(body)?;
    let raw = cap.get(1)?.as_str().trim();
    if raw.is_empty() {
        None
    } else {
        Some(decode_basic_html_entities(raw))
    }
}

fn decode_basic_html_entities(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base() -> url::Url {
        url::Url::parse("https://example.com/").unwrap()
    }

    #[test]
    fn slugify_host_handles_dots_and_ports() {
        assert_eq!(slugify_host("example.com"), "example-com");
        assert_eq!(slugify_host("api.example.com:8080"), "api-example-com-8080");
        assert_eq!(slugify_host("UPPER.case"), "upper-case");
    }

    #[test]
    fn extract_finds_href_links() {
        let html = r##"
            <a href="/posts">All</a>
            <a href='https://example.com/users/42'>User 42</a>
            <a href="https://other.com/away">Away</a>
            <a href="mailto:hi@x.com">Mail</a>
            <a href="#section">Anchor</a>
        "##;
        let endpoints = extract_endpoints_from_html(html, &base());
        let paths: Vec<String> = endpoints.iter().map(|e| e.path.clone()).collect();
        assert!(paths.iter().any(|p| p == "/posts"));
        assert!(paths.iter().any(|p| p == "/users/42"));
        // mailto, anchor, and cross-host all dropped
        assert_eq!(endpoints.len(), 2);
    }

    #[test]
    fn extract_finds_form_with_inputs() {
        let html = r#"
            <form action="/login" method="POST">
                <input name="username" type="text" />
                <input type="password" name="password" />
                <input type="submit" value="Login" />
            </form>
        "#;
        let endpoints = extract_endpoints_from_html(html, &base());
        assert_eq!(endpoints.len(), 1);
        let f = &endpoints[0];
        assert_eq!(f.path, "/login");
        assert_eq!(f.method, "POST");
        assert!(f.form_inputs.contains(&"username".to_string()));
        assert!(f.form_inputs.contains(&"password".to_string()));
        // submit input had no `name=` attr, so it's omitted
        assert_eq!(f.form_inputs.len(), 2);
    }

    #[test]
    fn cluster_collapses_numeric_path_segments() {
        let raws = vec![
            RawEndpoint {
                path: "/posts/123".into(),
                method: "GET".into(),
                form_inputs: vec![],
            },
            RawEndpoint {
                path: "/posts/456".into(),
                method: "GET".into(),
                form_inputs: vec![],
            },
            RawEndpoint {
                path: "/posts/789".into(),
                method: "GET".into(),
                form_inputs: vec![],
            },
        ];
        let clustered = cluster_endpoints(raws);
        assert_eq!(clustered.len(), 1);
        assert_eq!(clustered[0].path, "/posts/{id}");
        assert_eq!(clustered[0].path_params, vec!["id".to_string()]);
        assert_eq!(clustered[0].occurrences, 3);
        assert_eq!(clustered[0].example_paths.len(), 3);
    }

    #[test]
    fn cluster_collapses_uuid_segments() {
        let raws = vec![
            RawEndpoint {
                path: "/users/550e8400-e29b-41d4-a716-446655440000".into(),
                method: "GET".into(),
                form_inputs: vec![],
            },
            RawEndpoint {
                path: "/users/123e4567-e89b-12d3-a456-426614174000/posts".into(),
                method: "GET".into(),
                form_inputs: vec![],
            },
        ];
        let clustered = cluster_endpoints(raws);
        // First → /users/{uuid}; second → /users/{uuid}/posts (different stem)
        let stems: Vec<String> = clustered.iter().map(|e| e.path.clone()).collect();
        assert!(stems.contains(&"/users/{uuid}".to_string()));
        assert!(stems.contains(&"/users/{uuid}/posts".to_string()));
    }

    #[test]
    fn cluster_keeps_distinct_stems_separate() {
        let raws = vec![
            RawEndpoint {
                path: "/posts".into(),
                method: "GET".into(),
                form_inputs: vec![],
            },
            RawEndpoint {
                path: "/users".into(),
                method: "GET".into(),
                form_inputs: vec![],
            },
        ];
        let clustered = cluster_endpoints(raws);
        assert_eq!(clustered.len(), 2);
    }

    #[test]
    fn cluster_keeps_methods_separate() {
        let raws = vec![
            RawEndpoint {
                path: "/login".into(),
                method: "GET".into(),
                form_inputs: vec![],
            },
            RawEndpoint {
                path: "/login".into(),
                method: "POST".into(),
                form_inputs: vec!["username".into()],
            },
        ];
        let clustered = cluster_endpoints(raws);
        assert_eq!(clustered.len(), 2);
    }

    #[test]
    fn extract_resolves_relative_paths_against_base() {
        let html = r#"<a href="foo/bar">Rel</a>"#;
        let base = url::Url::parse("https://example.com/section/").unwrap();
        let endpoints = extract_endpoints_from_html(html, &base);
        assert_eq!(endpoints.len(), 1);
        assert_eq!(endpoints[0].path, "/section/foo/bar");
    }

    #[test]
    fn extract_ignores_non_http_schemes() {
        let html = r#"
            <a href="mailto:x@y.z">M</a>
            <a href="tel:+1234">T</a>
            <a href="javascript:void(0)">JS</a>
            <a href="data:text/plain,hi">D</a>
        "#;
        let endpoints = extract_endpoints_from_html(html, &base());
        assert!(endpoints.is_empty());
    }

    #[test]
    fn extract_title_basic() {
        let html = r#"<html><head><title>Hello &amp; World</title></head><body></body></html>"#;
        assert_eq!(extract_title(html), Some("Hello & World".to_string()));
    }

    #[test]
    fn parameterise_handles_multiple_ids() {
        let (stem, params) = parameterise_path("/users/123/posts/456");
        assert_eq!(stem, "/users/{id}/posts/{id2}");
        assert_eq!(params, vec!["id".to_string(), "id2".to_string()]);
    }
}
