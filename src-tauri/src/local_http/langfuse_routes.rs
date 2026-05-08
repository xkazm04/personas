//! Langfuse-specific routes hosted by [`crate::local_http`].
//!
//! `GET /langfuse/auto-login?nonce=…&return_to=…`:
//!   1. Validates and consumes the nonce (single-use, 60 s).
//!   2. Reads the saved Langfuse host + admin credentials from the keyring.
//!   3. Server-side `GET <host>/api/auth/csrf` to capture both the body
//!      `csrfToken` and the full `next-auth.csrf-token` cookie value.
//!   4. Renders a self-submitting HTML form that POSTs the credentials to
//!      `<host>/api/auth/callback/credentials`. The HTML response also
//!      sets the csrf-token cookie with `Domain=localhost` so the browser
//!      sends it on the cross-port form POST (same site, different origin).
//!   5. Browser auto-submits, NextAuth verifies, sets the session cookie
//!      for `localhost:<langfuse-port>`, redirects to `return_to` (or `/`).
//!
//! The whole song-and-dance runs in the user's default browser — no
//! embedded webview required, no manual sign-in form.

use std::time::Duration;

use axum::{
    extract::Query,
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
    Router,
};
use serde::Deserialize;

use crate::langfuse::config;
use crate::local_http::consume_nonce;

pub fn router() -> Router {
    Router::new().route("/auto-login", get(auto_login))
}

#[derive(Debug, Deserialize)]
struct AutoLoginQuery {
    nonce: String,
    /// Path or absolute URL to land on after sign-in. Default: `/`.
    /// Relative paths are resolved against the configured Langfuse host;
    /// absolute URLs are passed through unchanged so the deep-link
    /// `<host>/project/<id>/traces/<trace>` works.
    #[serde(default)]
    return_to: Option<String>,
}

async fn auto_login(Query(q): Query<AutoLoginQuery>) -> Response {
    if !consume_nonce(&q.nonce) {
        return error_html(
            StatusCode::FORBIDDEN,
            "Login link is invalid or expired",
            "Re-open Langfuse from inside Personas to mint a fresh link.",
        );
    }

    let host = match config::load_host().filter(|h| !h.is_empty()) {
        Some(h) => h,
        None => {
            return error_html(
                StatusCode::PRECONDITION_FAILED,
                "Langfuse isn't configured",
                "Open the Langfuse plugin in Personas and Start the local stack first.",
            );
        }
    };

    let (admin_email, admin_password) = match config::load_admin_credentials() {
        Some(p) => p,
        None => {
            return error_html(
                StatusCode::PRECONDITION_FAILED,
                "Admin credentials missing",
                "Stop and Start the Langfuse stack from the plugin to regenerate credentials.",
            );
        }
    };

    let (csrf_token, csrf_cookie) = match fetch_csrf(&host).await {
        Ok(pair) => pair,
        Err(msg) => {
            return error_html(
                StatusCode::BAD_GATEWAY,
                "Couldn't reach Langfuse",
                &format!(
                    "We tried to fetch a CSRF token from {host} but the request failed: {msg}. \
                     Check that the local stack is running."
                ),
            );
        }
    };

    let host_no_slash = host.trim_end_matches('/').to_string();
    let return_to = q
        .return_to
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("/");
    let callback_url = if return_to.starts_with("http://") || return_to.starts_with("https://") {
        return_to.to_string()
    } else if return_to.starts_with('/') {
        format!("{host_no_slash}{return_to}")
    } else {
        format!("{host_no_slash}/{return_to}")
    };

    let credentials_url = format!("{host_no_slash}/api/auth/callback/credentials");
    let html = render_login_html(
        &credentials_url,
        &csrf_token,
        &admin_email,
        &admin_password,
        &callback_url,
    );

    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("text/html; charset=utf-8"),
    );
    // Re-set the CSRF cookie with Domain=localhost so it's sent on the
    // cross-port form POST. Without Domain, the cookie is scoped to our
    // server's origin and the browser drops it on the way to Langfuse.
    let cookie_header =
        format!("next-auth.csrf-token={csrf_cookie}; Domain=localhost; Path=/; SameSite=Lax");
    if let Ok(v) = HeaderValue::from_str(&cookie_header) {
        headers.append(header::SET_COOKIE, v);
    } else {
        tracing::warn!("Skipping csrf-token cookie — value contains invalid header characters");
    }

    (StatusCode::OK, headers, html).into_response()
}

// ---------------------------------------------------------------------------
// CSRF fetch
// ---------------------------------------------------------------------------

/// Server-side `GET /api/auth/csrf`. Returns `(csrfToken, full cookie value)`.
/// The cookie value is what NextAuth expects on the verification side
/// (`token|hmac`) — we re-emit it on our HTML response so the browser stores
/// the same value and includes it on the form POST.
async fn fetch_csrf(host: &str) -> Result<(String, String), String> {
    let url = format!("{}/api/auth/csrf", host.trim_end_matches('/'));
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| format!("HTTP client build failed: {e}"))?;

    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("CSRF GET failed: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("Langfuse returned HTTP {}", resp.status()));
    }

    // Capture the cookie header value before we consume the response into JSON.
    let cookie_value = resp
        .headers()
        .get_all(header::SET_COOKIE)
        .iter()
        .filter_map(|h| h.to_str().ok())
        .find_map(extract_csrf_cookie)
        .ok_or_else(|| "Langfuse did not set the csrf-token cookie".to_string())?;

    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("CSRF body parse failed: {e}"))?;
    let token = body
        .get("csrfToken")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "csrfToken missing in CSRF response body".to_string())?
        .to_string();

    Ok((token, cookie_value))
}

/// Pull the `next-auth.csrf-token` (or `__Host-…` variant for HTTPS hosts)
/// value out of a Set-Cookie header. We want only the value, not the full
/// `name=value; Path=…; HttpOnly; …` string.
fn extract_csrf_cookie(raw: &str) -> Option<String> {
    let head = raw.split(';').next()?.trim();
    let (name, value) = head.split_once('=')?;
    let name = name.trim();
    if name == "next-auth.csrf-token" || name == "__Host-next-auth.csrf-token" {
        Some(value.to_string())
    } else {
        None
    }
}

// ---------------------------------------------------------------------------
// HTML templating
// ---------------------------------------------------------------------------

fn render_login_html(
    credentials_url: &str,
    csrf_token: &str,
    email: &str,
    password: &str,
    callback_url: &str,
) -> String {
    format!(
        r#"<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="robots" content="noindex,nofollow">
<title>Signing in to Langfuse…</title>
<style>
  html, body {{ margin: 0; padding: 0; }}
  body {{
    min-height: 100vh;
    display: flex; align-items: center; justify-content: center;
    font: 14px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    color: #333; background: #fafafa;
  }}
  .card {{
    text-align: center; padding: 32px 40px; border-radius: 12px;
    background: white; box-shadow: 0 4px 24px rgba(0,0,0,0.04);
  }}
  .spin {{
    width: 28px; height: 28px;
    border: 3px solid #e5e7eb; border-top-color: #6366f1;
    border-radius: 50%; margin: 0 auto 16px;
    animation: spin 1s linear infinite;
  }}
  @keyframes spin {{ to {{ transform: rotate(360deg); }} }}
  .muted {{ color: #888; font-size: 12px; margin-top: 12px; }}
  a {{ color: #6366f1; }}
</style>
</head>
<body>
  <div class="card">
    <div class="spin"></div>
    <p>Signing in to Langfuse…</p>
    <p class="muted">If this page doesn't redirect within a few seconds, <a href="{callback_url_attr}">click here</a>.</p>
    <noscript>
      <p style="color:#b91c1c">JavaScript is required to sign you in automatically. Please enable JS or visit Langfuse directly.</p>
    </noscript>
  </div>
  <form id="lf-signin" method="POST" action="{credentials_url_attr}">
    <input type="hidden" name="csrfToken" value="{csrf_attr}">
    <input type="hidden" name="email" value="{email_attr}">
    <input type="hidden" name="password" value="{password_attr}">
    <input type="hidden" name="callbackUrl" value="{callback_url_attr}">
    <input type="hidden" name="json" value="false">
  </form>
  <script>
    (function () {{
      var f = document.getElementById('lf-signin');
      // Defer one tick so the browser can store the csrf cookie we set in the
      // response headers BEFORE issuing the form POST.
      setTimeout(function () {{ f.submit(); }}, 50);
    }})();
  </script>
</body>
</html>"#,
        credentials_url_attr = html_attr(credentials_url),
        csrf_attr = html_attr(csrf_token),
        email_attr = html_attr(email),
        password_attr = html_attr(password),
        callback_url_attr = html_attr(callback_url),
    )
}

fn error_html(status: StatusCode, title: &str, body: &str) -> Response {
    let html = format!(
        r#"<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>{title_attr}</title>
<style>
  body {{ font: 14px/1.5 system-ui, sans-serif; color: #333; background: #fafafa; padding: 60px; max-width: 560px; margin: 0 auto; }}
  h1 {{ font-size: 18px; color: #b91c1c; }}
  p {{ color: #555; }}
</style>
</head>
<body>
  <h1>{title_html}</h1>
  <p>{body_html}</p>
</body>
</html>"#,
        title_attr = html_attr(title),
        title_html = html_text(title),
        body_html = html_text(body),
    );

    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("text/html; charset=utf-8"),
    );
    (status, headers, html).into_response()
}

/// Escape user-supplied data for use inside a double-quoted HTML attribute.
/// We only need a small subset because our inputs are tightly typed
/// (URL, email, password, csrf token) but better to be conservative.
fn html_attr(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('"', "&quot;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

/// Escape for HTML text content (between tags).
fn html_text(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_lower_case_csrf_cookie_value() {
        let raw = "next-auth.csrf-token=abc%7Cdef; Path=/; HttpOnly; SameSite=Lax";
        assert_eq!(extract_csrf_cookie(raw).as_deref(), Some("abc%7Cdef"));
    }

    #[test]
    fn extracts_secure_prefix_variant() {
        let raw = "__Host-next-auth.csrf-token=xyz; Secure; Path=/";
        assert_eq!(extract_csrf_cookie(raw).as_deref(), Some("xyz"));
    }

    #[test]
    fn ignores_unrelated_cookies() {
        let raw = "next-auth.callback-url=foo; Path=/";
        assert!(extract_csrf_cookie(raw).is_none());
    }

    #[test]
    fn html_attr_escapes_quotes_and_angle_brackets() {
        let escaped = html_attr(r#"a"<b>&'c"#);
        assert_eq!(escaped, r#"a&quot;&lt;b&gt;&amp;'c"#);
    }
}
