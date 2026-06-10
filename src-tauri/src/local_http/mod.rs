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

use std::net::{Ipv4Addr, SocketAddrV4, TcpListener as StdTcpListener};
use std::sync::{OnceLock, RwLock};

use axum::Router;
use tokio::net::TcpListener;

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

    PORT.set(port).map_err(|_| "port already set".to_string())?;

    tauri::async_runtime::spawn(async move {
        match TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, port)).await {
            Ok(listener) => {
                tracing::info!(port, prefixes = ?prefixes, "local_http listening");
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

