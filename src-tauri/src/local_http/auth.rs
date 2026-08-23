//! Admission control for the in-app HTTP server.
//!
//! # Why this exists
//!
//! `local_http` binds `127.0.0.1` and mounts five routers on it — including
//! `/dev-tools` (34 routes that register projects, launch Claude-CLI scans and
//! rewrite `context-map.json` + `CLAUDE.md` on disk) and
//! `/project-tracking/cli-event` (whose caller-supplied text is interpolated
//! into a prompt for a CLI spawned with `--dangerously-skip-permissions`).
//! Until this module existed the whole server carried **no `.layer(...)`, no
//! token check and no `Host` validation**, and `dev_tools_http` was mounted
//! unconditionally in release builds.
//!
//! # The attacker model this closes — stated precisely
//!
//! Two reachability paths, neither of them "plain drive-by CSRF":
//!
//! 1. **DNS rebinding.** A page the user visits resolves its own hostname to
//!    `127.0.0.1` after the document loads. The browser then treats
//!    `http://evil.example:<port>/…` as same-origin with the rebound address,
//!    so the page can send `application/json` **and read the response** — and
//!    can walk 17400-17415 to find the live port. The `Host` allowlist in
//!    [`host_allowed`] is what defeats this: a rebound request still carries
//!    `Host: evil.example:<port>`, which is not in the allowlist.
//! 2. **Any other principal on the machine.** `127.0.0.1` is machine-scoped,
//!    not user-scoped: a second OS account, or a sandboxed/containerised
//!    process, can connect. The shared secret is what stops that one — it is
//!    readable only through the handshake file in the app user's home
//!    directory (see `super::write_handshake`).
//!
//! **What was already blocked and is NOT claimed here:** ordinary
//! form/`<img>` CSRF from a non-rebound page. Every mutating route takes
//! `Json<T>`, which requires `Content-Type: application/json`, which forces a
//! CORS preflight that this router answers with 405. That was true before this
//! module and stays true.
//!
//! # Design
//!
//! One `tower` layer over the **whole** router rather than a check per
//! handler, because a per-handler check reproduces the original bug the next
//! time somebody adds a route. Every current and future mount is covered by
//! construction; the only way out is the explicit, reviewed
//! [`SELF_AUTHENTICATED_PREFIXES`] list.
//!
//! The token primitive is deliberately the same one `browser_bridge` already
//! uses on this very server (`browser_bridge::pairing_token`, checked at
//! `relay.rs:77`): a random secret minted at first run, stable across
//! restarts, overridable from the environment for QA harnesses. It differs in
//! WHERE it persists — see [`token_slot`].

use std::sync::{OnceLock, RwLock};

use axum::extract::Request;
use axum::http::{header, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};

/// Header carrying the shared secret. Mirrors `X-Browser-Bridge-Token`.
pub const TOKEN_HEADER: &str = "x-personas-local-token";

/// Query-string fallback for callers that cannot set a header (the same
/// affordance `browser_bridge`'s WS handshake offers).
pub const TOKEN_QUERY: &str = "__token";

/// Environment override, for QA harnesses and the isolated-instance launcher.
const TOKEN_ENV: &str = "PERSONAS_LOCAL_HTTP_TOKEN";

/// Mount prefixes exempt from the shared-secret check because they already
/// authenticate every request themselves with a *narrower* credential, and
/// because their client is configured out-of-band with that credential only.
///
/// This list is a deliberate opt-OUT of a default-deny layer. Adding to it is
/// a security decision: the prefix must reject an unauthenticated request in
/// **every** handler it mounts, and that must stay true of handlers added
/// later.
///
/// - `browser-bridge`: both handlers gate on a credential before doing any
///   work — the pairing token (`relay.rs:77`, held only by the extension's
///   service worker) and the per-test session token (`mcp.rs:130`). The user
///   pastes `{port, token}` into the extension by hand; requiring a *second*
///   secret there would break every existing pairing for no gain, since the
///   pairing token is already the thing an attacker would have to steal.
///
/// The `Host` allowlist below applies to these prefixes too — exemption is
/// from the token check only, never from the rebinding defence.
pub const SELF_AUTHENTICATED_PREFIXES: &[&str] = &["browser-bridge"];

// ---------------------------------------------------------------------------
// Token store
// ---------------------------------------------------------------------------

/// Resolution order, resolved once per process:
///
/// 1. `PERSONAS_LOCAL_HTTP_TOKEN` — QA harnesses and the isolated-instance
///    launcher, which passes env through.
/// 2. The token in the previous run's handshake file, so the value is **stable
///    across restarts**. That is load-bearing, not tidiness: the Fleet hook
///    commands in `~/.claude/settings.json` and each session's `mcp.json` bake
///    the credential in at install time, exactly as they already bake the
///    port. A per-boot token would 401 every hook in every Claude Code session
///    on the machine until the next reinstall.
/// 3. A fresh random UUID (first run, or the file was deleted). The Fleet hook
///    self-heal catches up on the next launch — `check_hooks_inner` treats a
///    hook command missing the CURRENT token as drifted, which is the same
///    signal a port change raises.
///
/// The handshake file rather than `app_settings` deliberately: the token has
/// to reach same-user out-of-process consumers as plaintext on disk anyway, so
/// a second plaintext copy in the settings table would widen the exposure
/// (`getAppSetting` hands raw values to the renderer) for no gain — and would
/// add a fourth row to the credential-in-settings debt the
/// `settings-key-holding-secret` census rule exists to stop growing.
fn token_slot() -> &'static RwLock<String> {
    static TOKEN: OnceLock<RwLock<String>> = OnceLock::new();
    TOKEN.get_or_init(|| {
        RwLock::new(
            env_token()
                .or_else(persisted_token)
                .unwrap_or_else(|| uuid::Uuid::new_v4().simple().to_string()),
        )
    })
}

/// Read the token out of the last handshake file, if one is readable and
/// carries a non-empty one. Never fails loudly: an unreadable or malformed
/// file just means "mint a fresh token", which is a recoverable state.
fn persisted_token() -> Option<String> {
    let path = super::handshake_path()?;
    let raw = std::fs::read_to_string(path).ok()?;
    let parsed: serde_json::Value = serde_json::from_str(&raw).ok()?;
    parsed
        .get("token")
        .and_then(|v| v.as_str())
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
}

fn env_token() -> Option<String> {
    std::env::var(TOKEN_ENV)
        .ok()
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
}

/// The secret every non-exempt request must present.
pub fn local_token() -> String {
    token_slot()
        .read()
        .unwrap_or_else(|p| p.into_inner())
        .clone()
}

/// Compare two secrets without an early return on the first differing byte.
fn ct_eq(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    // Length is not secret (the token is a fixed-width UUID), but folding it
    // in keeps the loop bound independent of the *presented* value.
    let mut diff = (a.len() ^ b.len()) as u8;
    for i in 0..a.len().max(b.len()) {
        let x = a.get(i).copied().unwrap_or(0);
        let y = b.get(i).copied().unwrap_or(0);
        diff |= x ^ y;
    }
    diff == 0
}

// ---------------------------------------------------------------------------
// Host allowlist
// ---------------------------------------------------------------------------

/// Host names a loopback client legitimately sends. Anything else is a
/// rebound name and is refused.
const ALLOWED_HOSTS: &[&str] = &["127.0.0.1", "localhost", "::1"];

/// Split `host:port`, tolerating a bracketed IPv6 literal.
fn split_host_port(raw: &str) -> (&str, Option<&str>) {
    if let Some(rest) = raw.strip_prefix('[') {
        return match rest.split_once(']') {
            Some((h, tail)) => (h, tail.strip_prefix(':')),
            None => (raw, None),
        };
    }
    match raw.rsplit_once(':') {
        // An unbracketed bare IPv6 literal has several colons — no port there.
        Some((h, p)) if !h.contains(':') => (h, Some(p)),
        _ => (raw, None),
    }
}

/// Is this `Host` value one a loopback client would send to `bound_port`?
///
/// `bound_port` is `None` before the server has bound (and in unit tests), in
/// which case the port half is not compared — the host NAME is what carries
/// the rebinding defence.
pub fn host_allowed(raw_host: &str, bound_port: Option<u16>) -> bool {
    let host = raw_host.trim();
    if host.is_empty() {
        return false;
    }
    let (name, port) = split_host_port(host);
    let name = name.to_ascii_lowercase();
    if !ALLOWED_HOSTS.contains(&name.as_str()) {
        return false;
    }
    match (port, bound_port) {
        (Some(p), Some(expected)) => p.parse::<u16>().map(|p| p == expected).unwrap_or(false),
        _ => true,
    }
}

// ---------------------------------------------------------------------------
// The layer
// ---------------------------------------------------------------------------

/// First path segment of `/dev-tools/projects` → `dev-tools`.
fn first_segment(path: &str) -> &str {
    path.trim_start_matches('/')
        .split('/')
        .next()
        .unwrap_or_default()
}

fn presented_token(req: &Request) -> Option<String> {
    if let Some(v) = req
        .headers()
        .get(TOKEN_HEADER)
        .and_then(|v| v.to_str().ok())
    {
        return Some(v.trim().to_string());
    }
    let q = req.uri().query()?;
    q.split('&')
        .filter_map(|kv| kv.split_once('='))
        .find(|(k, _)| *k == TOKEN_QUERY)
        .map(|(_, v)| v.trim().to_string())
}

/// The admission layer. Applied once, over the composed router, in
/// [`super::start`].
pub async fn guard(req: Request, next: Next) -> Response {
    // --- 1. Host allowlist (applies to EVERY prefix, exempt ones included) ---
    // HTTP/1.1 carries the name in `Host`; an HTTP/2 client puts it in the
    // request URI's authority. Absent from both = refuse rather than guess.
    let host = req
        .headers()
        .get(header::HOST)
        .and_then(|v| v.to_str().ok())
        .map(str::to_string)
        .or_else(|| req.uri().authority().map(|a| a.as_str().to_string()));

    let Some(host) = host else {
        tracing::warn!(path = %req.uri().path(), "local_http: refused request with no Host");
        return (StatusCode::FORBIDDEN, "missing Host header").into_response();
    };
    if !host_allowed(&host, super::port()) {
        tracing::warn!(
            host = %host,
            path = %req.uri().path(),
            "local_http: refused request with non-loopback Host (DNS rebinding defence)"
        );
        return (StatusCode::FORBIDDEN, "host not allowed").into_response();
    }

    // --- 2. Shared secret, unless the prefix authenticates itself ---
    let prefix = first_segment(req.uri().path()).to_string();
    if SELF_AUTHENTICATED_PREFIXES.contains(&prefix.as_str()) {
        return next.run(req).await;
    }

    let expected = local_token();
    match presented_token(&req) {
        Some(p) if ct_eq(&p, &expected) => next.run(req).await,
        _ => {
            tracing::warn!(
                path = %req.uri().path(),
                "local_http: refused request with bad or missing local token"
            );
            (
                StatusCode::UNAUTHORIZED,
                "missing or invalid local token; see ~/.personas/local-http.json",
            )
                .into_response()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ct_eq_matches_std_equality() {
        assert!(ct_eq("abc", "abc"));
        assert!(!ct_eq("abc", "abd"));
        assert!(!ct_eq("abc", "abcd"));
        assert!(!ct_eq("", "a"));
        assert!(ct_eq("", ""));
    }

    #[test]
    fn host_allowlist_accepts_loopback_spellings() {
        assert!(host_allowed("127.0.0.1", None));
        assert!(host_allowed("127.0.0.1:17400", None));
        assert!(host_allowed("localhost:17400", None));
        assert!(host_allowed("LOCALHOST:17400", None));
        assert!(host_allowed("[::1]:17400", None));
    }

    #[test]
    fn host_allowlist_rejects_rebound_names() {
        // The DNS-rebinding shape: attacker hostname, our port.
        assert!(!host_allowed("evil.example:17400", None));
        assert!(!host_allowed("evil.example", None));
        // A name that merely CONTAINS an allowed one must not pass.
        assert!(!host_allowed("localhost.evil.example:17400", None));
        assert!(!host_allowed("127.0.0.1.evil.example:17400", None));
        assert!(!host_allowed("", None));
    }

    #[test]
    fn host_allowlist_checks_port_when_bound() {
        assert!(host_allowed("127.0.0.1:17400", Some(17400)));
        assert!(!host_allowed("127.0.0.1:17401", Some(17400)));
        // No port in the Host is not something a browser sends to a non-80
        // port, but it is legal HTTP — accept it on an allowed name.
        assert!(host_allowed("127.0.0.1", Some(17400)));
    }

    #[test]
    fn first_segment_extracts_mount_prefix() {
        assert_eq!(first_segment("/dev-tools/projects"), "dev-tools");
        assert_eq!(first_segment("/browser-bridge/ws"), "browser-bridge");
        assert_eq!(first_segment("/"), "");
    }
}
