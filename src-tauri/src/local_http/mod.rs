//! In-app HTTP server bound to 127.0.0.1.
//!
//! Hosts endpoints that need to be reachable by the user's default browser
//! but can't live in any of the integrated services we ship (GitLab, etc).
//!
//! The server is shared infrastructure: register additional routers via
//! [`register_router`] from any module. Routes are mounted under their
//! given prefix (e.g. `register_router("gitlab", ...)` → `/gitlab/...`).
//!
//! Lifecycle: started once during app setup ([`start`]). Bound to a free
//! port at-or-above [`PREFERRED_PORT`]; resolved port is queryable via
//! [`port()`]. The server runs for the lifetime of the process.
//!
//! # Admission control
//!
//! **Every** mounted router sits behind [`auth::guard`] — a `Host` allowlist
//! plus a shared secret — applied once here, over the composed router, so a
//! router added tomorrow is protected without its author doing anything. Read
//! [`auth`] for the attacker model and for the one documented exemption.
//! Out-of-process consumers discover the port *and* the secret through the
//! handshake file written by [`write_handshake`].

use std::net::{Ipv4Addr, SocketAddrV4, TcpListener as StdTcpListener};
use std::path::PathBuf;
use std::sync::{OnceLock, RwLock};

use axum::Router;
use tokio::net::TcpListener;

pub mod auth;

/// Where the server starts scanning for a free port. Picked to be visibly
/// distinct from common dev ports and from the test-automation port (17320).
const PREFERRED_PORT: u16 = 17400;
const PORT_SCAN_LIMIT: u16 = 16;

static PORT: OnceLock<u16> = OnceLock::new();
static PENDING_ROUTERS: OnceLock<RwLock<Vec<(String, Router)>>> = OnceLock::new();

fn pending_routers() -> &'static RwLock<Vec<(String, Router)>> {
    PENDING_ROUTERS.get_or_init(|| RwLock::new(Vec::new()))
}

/// Register a router under `<prefix>`. Must be called before [`start`] —
/// later registrations are ignored with a warning. The server will mount
/// the router at `/<prefix>` so a route like `/auto-login` becomes
/// `/<prefix>/auto-login`.
///
/// The router does NOT need to authenticate its own requests: [`start`] wraps
/// the whole composed tree in [`auth::guard`].
pub fn register_router(prefix: &str, router: Router) {
    let mut guard = match pending_routers().write() {
        Ok(g) => g,
        Err(p) => p.into_inner(),
    };
    if PORT.get().is_some() {
        tracing::warn!(
            prefix,
            "local_http server already running; ignoring late router registration"
        );
        return;
    }
    guard.push((prefix.to_string(), router));
}

/// Compose every registered router into one tree and put the admission layer
/// over all of it.
///
/// Split out of [`start`] so the tests can drive the exact same shape the app
/// serves — a guard that is only exercised through a hand-built test router is
/// evidence about the test router, not about production.
fn build_app(routers: Vec<(String, Router)>) -> (Router, Vec<String>) {
    let mut app = Router::new();
    let mut prefixes: Vec<String> = Vec::with_capacity(routers.len());
    for (prefix, router) in routers {
        let mount = if prefix.starts_with('/') {
            prefix.clone()
        } else {
            format!("/{prefix}")
        };
        app = app.nest(&mount, router);
        prefixes.push(prefix);
    }
    // ONE layer, over the whole tree, applied last so it runs first. Never
    // per-handler: that is the shape that let 36 routes ship unauthenticated.
    let app = app.layer(axum::middleware::from_fn(auth::guard));
    (app, prefixes)
}

/// Bind to 127.0.0.1 on the first free port at-or-above [`PREFERRED_PORT`]
/// and spawn an axum task. Idempotent — repeated calls return the same port.
pub fn start() -> Result<u16, String> {
    if let Some(p) = PORT.get() {
        return Ok(*p);
    }

    let port = pick_free_port()?;

    // Snapshot pending routers and clear the pending list so any further
    // late calls warn instead of silently appending.
    let routers = {
        let mut guard = pending_routers()
            .write()
            .map_err(|e| format!("router lock poisoned: {e}"))?;
        std::mem::take(&mut *guard)
    };

    let (app, prefixes) = build_app(routers);

    PORT.set(port).map_err(|_| "port already set".to_string())?;

    tauri::async_runtime::spawn(async move {
        match TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, port)).await {
            Ok(listener) => {
                tracing::info!(port, prefixes = ?prefixes, "local_http listening");
                // Publish {port, token} only once the socket is actually ours,
                // so a consumer that reads the file never learns a port we
                // failed to bind.
                write_handshake(port);
                if let Err(e) = axum::serve(listener, app).await {
                    tracing::error!(error = %e, "local_http serve loop exited");
                }
            }
            Err(e) => {
                tracing::error!(error = %e, port, "local_http failed to bind");
            }
        }
    });

    Ok(port)
}

/// Live port the server is bound to (after [`start`] has run). None before.
pub fn port() -> Option<u16> {
    PORT.get().copied()
}

// ---------------------------------------------------------------------------
// Handshake file — how out-of-process consumers keep working
// ---------------------------------------------------------------------------

/// Where the `{port, token}` handshake lands.
///
/// `~/.personas/` is an existing convention in this app (`companion-brain/`,
/// `companion-tts/`, `companion-stt/`). A rebound web page cannot read a local
/// file at all, so this location defeats attacker (a) outright.
///
/// Attacker (b) — another principal on the machine — is defeated by the file's
/// DACL, and **that is not inherited, it is set explicitly.** Measured on the
/// operator's machine 2026-08-22: `~/.personas` carries
/// `CodexSandboxUsers:(OI)(CI)(RX)`, so a file created there is born readable
/// by a sandbox group. Trusting the user-profile ACL would have published this
/// token to exactly the principal it excludes. See
/// [`personas_core::fs_private`] for the measurement and the remedy.
///
/// A same-user, non-sandboxed process CAN still read it — but such a process
/// could run the Claude CLI directly, so that residual is not what this file
/// is defending.
pub fn handshake_path() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".personas").join("local-http.json"))
}

/// The exact document [`write_handshake`] serialises.
///
/// Split out so a test can assert the KEY NAMES without writing to the
/// operator's real `~/.personas/local-http.json`. That matters more than it
/// looks: `.claude/skills/project-populate/references/bridge.md` tells a
/// terminal session to read `.port` and `.token` out of this file, and if a
/// rename here ever silently diverged from that document, the skill would
/// report "Personas is not running" — the one failure mode that looks like an
/// environment problem rather than a code change.
fn handshake_body(port: u16) -> serde_json::Value {
    serde_json::json!({
        "port": port,
        "token": auth::local_token(),
        "pid": std::process::id(),
    })
}

/// Write `{port, token, pid}` so the app's own skills (`project-populate`,
/// `kpi-sim`, and anything driving `/dev-tools` from a terminal) can present
/// the credential. Best effort: a failure here degrades those skills, it must
/// never stop the server.
fn write_handshake(port: u16) {
    let Some(path) = handshake_path() else {
        tracing::warn!("local_http: home dir not resolvable; handshake file not written");
        return;
    };
    if let Some(parent) = path.parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            tracing::warn!(error = %e, "local_http: could not create ~/.personas");
            return;
        }
    }
    let serialized = match serde_json::to_string_pretty(&handshake_body(port)) {
        Ok(s) => s,
        Err(e) => {
            tracing::warn!(error = %e, "local_http: handshake serialise failed");
            return;
        }
    };

    // Restrict BEFORE the token is visible at the final path, then rename into
    // place — the same ordering `core/src/crypto.rs` uses for the master-key
    // fallback file, and for the same reason. Writing to the destination and
    // fixing the DACL afterwards leaves a window in which the file exists with
    // the parent's INHERITED permissions, and on this machine those permissions
    // include `CodexSandboxUsers:(RX)`. A narrow race is still a race when what
    // leaks is the credential the whole layer rests on.
    let mut tmp = match tempfile::Builder::new()
        .prefix(".local-http-")
        .suffix(".tmp")
        .tempfile_in(path.parent().unwrap_or_else(|| std::path::Path::new(".")))
    {
        Ok(t) => t,
        Err(e) => {
            tracing::warn!(error = %e, "local_http: handshake temp file failed");
            return;
        }
    };
    if let Err(e) = std::io::Write::write_all(&mut tmp, serialized.as_bytes()) {
        tracing::warn!(error = %e, "local_http: handshake write failed");
        return;
    }
    if let Err(e) = personas_core::fs_private::restrict_file_to_current_user(tmp.path()) {
        // Drop `tmp` (which unlinks it) rather than publish a readable token.
        tracing::error!(
            error = %e,
            "local_http: could not restrict handshake permissions — not writing it. Terminal \
             skills will report the bridge as unreachable; the app itself is unaffected."
        );
        return;
    }
    if let Err(e) = tmp.persist(&path) {
        tracing::warn!(error = %e, path = %path.display(), "local_http: handshake persist failed");
        return;
    }
    tracing::info!(path = %path.display(), "local_http: handshake written");
}

fn pick_free_port() -> Result<u16, String> {
    for offset in 0..PORT_SCAN_LIMIT {
        let candidate = PREFERRED_PORT.saturating_add(offset);
        if candidate == 0 {
            continue;
        }
        if StdTcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, candidate)).is_ok() {
            return Ok(candidate);
        }
    }
    Err(format!(
        "Could not find a free local_http port near {PREFERRED_PORT}"
    ))
}

// ---------------------------------------------------------------------------
// Regression tests for the admission layer
// ---------------------------------------------------------------------------
//
// These drive a REAL axum server over a REAL TCP socket through
// [`build_app`] — the same composition `start` uses — because the property
// under test is "the layer is attached to the composed tree", and a test that
// calls the guard function directly cannot observe that.
#[cfg(test)]
mod tests {
    use super::*;
    use axum::routing::{get, post};
    use axum::Json;

    async fn serve_guarded() -> (u16, tokio::task::JoinHandle<()>) {
        // Stand in for `dev_tools_http::router()` — one GET and one POST under
        // a normal prefix, plus a prefix on the self-authenticating list.
        let devtools = Router::new()
            .route("/projects", get(|| async { "projects" }))
            .route(
                "/scan-codebase",
                post(|Json(_): Json<serde_json::Value>| async { "scan started" }),
            );
        let bridge = Router::new().route("/ws", get(|| async { "bridge" }));
        let (app, _) = build_app(vec![
            ("dev-tools".to_string(), devtools),
            ("browser-bridge".to_string(), bridge),
        ]);

        let listener = TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, 0))
            .await
            .expect("bind ephemeral port");
        let port = listener.local_addr().expect("local addr").port();
        let handle = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        (port, handle)
    }

    fn client() -> reqwest::Client {
        reqwest::Client::builder()
            .no_proxy()
            .build()
            .expect("build client")
    }

    /// The wire contract between this file and
    /// `.claude/skills/project-populate/references/bridge.md`. Those key names
    /// are what a terminal session greps for; renaming one here without
    /// updating that document breaks every skill that drives `/dev-tools`.
    #[test]
    fn handshake_carries_the_keys_the_skills_read() {
        let body = handshake_body(17403);
        assert_eq!(body["port"], 17403, "bridge.md reads .port");
        assert_eq!(
            body["token"],
            *auth::local_token(),
            "bridge.md reads .token and sends it as X-Personas-Local-Token"
        );
        assert!(
            body["pid"].is_number(),
            "pid identifies a stale file's writer"
        );
        // A token the layer would reject is worse than no file at all.
        assert!(
            !body["token"].as_str().unwrap_or_default().is_empty(),
            "an empty token would 401 every consumer"
        );
    }

    #[tokio::test]
    async fn unauthenticated_request_is_rejected() {
        let (port, task) = serve_guarded().await;
        let res = client()
            .get(format!("http://127.0.0.1:{port}/dev-tools/projects"))
            .send()
            .await
            .expect("request");
        assert_eq!(
            res.status(),
            reqwest::StatusCode::UNAUTHORIZED,
            "a request with no local token must not reach the handler"
        );
        task.abort();
    }

    #[tokio::test]
    async fn unauthenticated_mutating_request_is_rejected() {
        // The Vuln-4 shape: POST /dev-tools/scan-codebase with a JSON body.
        let (port, task) = serve_guarded().await;
        let res = client()
            .post(format!("http://127.0.0.1:{port}/dev-tools/scan-codebase"))
            .json(&serde_json::json!({ "project_id": "x", "root_path": "C:/attacker" }))
            .send()
            .await
            .expect("request");
        assert_eq!(res.status(), reqwest::StatusCode::UNAUTHORIZED);
        task.abort();
    }

    #[tokio::test]
    async fn wrong_token_is_rejected() {
        let (port, task) = serve_guarded().await;
        let res = client()
            .get(format!("http://127.0.0.1:{port}/dev-tools/projects"))
            .header(auth::TOKEN_HEADER, "not-the-token")
            .send()
            .await
            .expect("request");
        assert_eq!(res.status(), reqwest::StatusCode::UNAUTHORIZED);
        task.abort();
    }

    #[tokio::test]
    async fn authenticated_request_is_accepted() {
        let (port, task) = serve_guarded().await;
        let res = client()
            .get(format!("http://127.0.0.1:{port}/dev-tools/projects"))
            .header(auth::TOKEN_HEADER, auth::local_token())
            .send()
            .await
            .expect("request");
        assert_eq!(res.status(), reqwest::StatusCode::OK);
        assert_eq!(res.text().await.unwrap_or_default(), "projects");
        task.abort();
    }

    #[tokio::test]
    async fn authenticated_request_via_query_param_is_accepted() {
        let (port, task) = serve_guarded().await;
        let res = client()
            .get(format!(
                "http://127.0.0.1:{port}/dev-tools/projects?{}={}",
                auth::TOKEN_QUERY,
                auth::local_token()
            ))
            .send()
            .await
            .expect("request");
        assert_eq!(res.status(), reqwest::StatusCode::OK);
        task.abort();
    }

    #[tokio::test]
    async fn rebound_host_is_rejected_even_with_a_valid_token() {
        // DNS rebinding: the attacker's page holds a valid-looking connection
        // to our port but the browser still sends its OWN name in `Host`.
        // Presenting a correct token here proves the Host check is an
        // independent gate, not a second spelling of the token check.
        let (port, task) = serve_guarded().await;
        let res = client()
            .get(format!("http://127.0.0.1:{port}/dev-tools/projects"))
            .header("host", format!("evil.example:{port}"))
            .header(auth::TOKEN_HEADER, auth::local_token())
            .send()
            .await
            .expect("request");
        assert_eq!(
            res.status(),
            reqwest::StatusCode::FORBIDDEN,
            "a rebound Host must be refused before the handler runs"
        );
        task.abort();
    }

    #[tokio::test]
    async fn rebound_host_is_rejected_on_self_authenticating_prefixes_too() {
        let (port, task) = serve_guarded().await;
        let res = client()
            .get(format!("http://127.0.0.1:{port}/browser-bridge/ws"))
            .header("host", format!("evil.example:{port}"))
            .send()
            .await
            .expect("request");
        assert_eq!(res.status(), reqwest::StatusCode::FORBIDDEN);
        task.abort();
    }

    #[tokio::test]
    async fn self_authenticating_prefix_still_reaches_its_own_handler() {
        // browser-bridge must NOT need the shared secret — its extension is
        // paired with a different credential and would otherwise break.
        let (port, task) = serve_guarded().await;
        let res = client()
            .get(format!("http://127.0.0.1:{port}/browser-bridge/ws"))
            .send()
            .await
            .expect("request");
        assert_eq!(res.status(), reqwest::StatusCode::OK);
        task.abort();
    }
}
