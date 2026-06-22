//! Long-lived Bun dev-server supervision.
//!
//! One `bun run dev` server per project, tracked in a registry so each can be
//! health-checked, stopped, and — critically — **all killed when the app
//! exits**. `bun run dev` spawns a `next`/node child, so a bare parent-kill
//! orphans the real server; [`kill_tree`] takes down the whole tree. The
//! registry lives in `AppState`; `stop_all` runs from the window-close hook.

use std::collections::HashMap;
use std::net::{SocketAddr, TcpStream};
use std::process::Stdio;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use ts_rs::TS;

use crate::error::AppError;

/// A running dev server. `pid` is the root of the process tree we kill.
struct DevServer {
    port: u16,
    pid: u32,
    child: tokio::process::Child,
    started: Instant,
}

/// Live status of a project's dev server, surfaced to the frontend.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DevServerStatus {
    pub project_id: String,
    pub port: u16,
    pub url: String,
    /// True when a TCP connect to the port currently succeeds.
    pub healthy: bool,
    pub uptime_secs: u64,
}

/// In-memory registry of running dev servers, keyed by `project_id`. One server
/// per project; starting again replaces (and kills) the prior one.
#[derive(Default)]
pub struct DevServerRegistry {
    servers: Mutex<HashMap<String, DevServer>>,
}

impl DevServerRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Spawn `bun run dev` for `project_id` on `port`, replacing any prior
    /// server for the same project. Returns immediately (the server is still
    /// booting); the caller polls [`status`](Self::status) until `healthy`.
    pub async fn start(
        &self,
        project_id: &str,
        project_dir: &std::path::Path,
        port: u16,
    ) -> Result<DevServerStatus, AppError> {
        // Tear down any prior server for this project first.
        self.stop(project_id);

        let bun = super::bun::resolve_bun()?;
        let mut cmd = tokio::process::Command::new(&bun);
        cmd.arg("run")
            .arg("dev")
            .current_dir(project_dir)
            .env("PORT", port.to_string())
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        super::bun::hide_window(&mut cmd);

        let child = cmd
            .spawn()
            .map_err(|e| AppError::Internal(format!("spawn `bun run dev`: {e}")))?;
        let pid = child
            .id()
            .ok_or_else(|| AppError::Internal("dev server has no pid".into()))?;

        {
            let mut guard = self.servers.lock().unwrap_or_else(|p| p.into_inner());
            guard.insert(
                project_id.to_string(),
                DevServer {
                    port,
                    pid,
                    child,
                    started: Instant::now(),
                },
            );
        }

        Ok(DevServerStatus {
            project_id: project_id.to_string(),
            port,
            url: format!("http://localhost:{port}"),
            healthy: false, // just spawned; caller polls until healthy
            uptime_secs: 0,
        })
    }

    /// Current status for a project's server, or `None` if not running. The
    /// (blocking) TCP health check runs after the lock is released.
    pub fn status(&self, project_id: &str) -> Option<DevServerStatus> {
        let (port, started) = {
            let guard = self.servers.lock().unwrap_or_else(|p| p.into_inner());
            let s = guard.get(project_id)?;
            (s.port, s.started)
        };
        Some(DevServerStatus {
            project_id: project_id.to_string(),
            port,
            url: format!("http://localhost:{port}"),
            healthy: http_responds(port),
            uptime_secs: started.elapsed().as_secs(),
        })
    }

    /// Status of every running server.
    pub fn list(&self) -> Vec<DevServerStatus> {
        let snapshot: Vec<(String, u16, Instant)> = {
            let guard = self.servers.lock().unwrap_or_else(|p| p.into_inner());
            guard
                .iter()
                .map(|(id, s)| (id.clone(), s.port, s.started))
                .collect()
        };
        snapshot
            .into_iter()
            .map(|(id, port, started)| DevServerStatus {
                project_id: id,
                port,
                url: format!("http://localhost:{port}"),
                healthy: http_responds(port),
                uptime_secs: started.elapsed().as_secs(),
            })
            .collect()
    }

    /// Stop a project's dev server, killing the whole process tree. Idempotent.
    pub fn stop(&self, project_id: &str) {
        let server = {
            let mut guard = self.servers.lock().unwrap_or_else(|p| p.into_inner());
            guard.remove(project_id)
        };
        if let Some(mut s) = server {
            kill_tree(s.pid);
            // Best-effort reap of the direct child handle.
            let _ = s.child.start_kill();
        }
    }

    /// Kill every running dev server. Call from the app's window-close hook so
    /// a closing window never orphans a `bun`/`next` tree.
    pub fn stop_all(&self) {
        let ids: Vec<String> = {
            let guard = self.servers.lock().unwrap_or_else(|p| p.into_inner());
            guard.keys().cloned().collect()
        };
        for id in ids {
            self.stop(&id);
        }
    }
}

/// Allocate a currently-free localhost TCP port for a new dev server. A brief
/// TOCTOU window exists between this and the server binding it — acceptable for
/// the single-user local flow (and the registry replaces a stuck server anyway).
pub fn alloc_port() -> Result<u16, AppError> {
    let listener = std::net::TcpListener::bind(("127.0.0.1", 0))
        .map_err(|e| AppError::Internal(format!("allocate dev-server port: {e}")))?;
    let port = listener
        .local_addr()
        .map_err(|e| AppError::Internal(format!("read allocated port: {e}")))?
        .port();
    Ok(port)
}

/// True if a TCP connect to `127.0.0.1:port` succeeds within a short timeout.
fn port_is_open(port: u16) -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    TcpStream::connect_timeout(&addr, Duration::from_millis(300)).is_ok()
}

/// True if an HTTP GET to `127.0.0.1:port` gets an `HTTP/...` response line.
/// Stronger than a bare TCP connect: a dev server that bound the port but is
/// wedged (compiling forever, or crashed with the socket lingering) still accepts
/// the connection yet never serves — `port_is_open` would call it healthy and the
/// preview would render blank. Requiring a real response makes "healthy" mean
/// "actually serving", so a dead-but-bound server is never adopted.
fn http_responds(port: u16) -> bool {
    use std::io::{Read, Write};
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let mut stream = match TcpStream::connect_timeout(&addr, Duration::from_millis(400)) {
        Ok(s) => s,
        Err(_) => return false,
    };
    let _ = stream.set_write_timeout(Some(Duration::from_millis(400)));
    let _ = stream.set_read_timeout(Some(Duration::from_millis(1200)));
    if stream
        .write_all(b"GET / HTTP/1.0\r\nHost: localhost\r\nConnection: close\r\n\r\n")
        .is_err()
    {
        return false;
    }
    let mut buf = [0u8; 12];
    match stream.read(&mut buf) {
        Ok(n) if n >= 4 => buf.starts_with(b"HTTP"),
        _ => false,
    }
}

/// Kill a process and its children. On Windows `bun` spawns a `next`/node
/// child, so a bare kill orphans the server — use `taskkill /T`. Best-effort;
/// failures (already-dead pid) are ignored.
fn kill_tree(pid: u32) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let _ = std::process::Command::new("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .creation_flags(CREATE_NO_WINDOW)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    #[cfg(not(windows))]
    {
        let _ = std::process::Command::new("kill")
            .args(["-9", &pid.to_string()])
            .status();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_registry_reports_nothing() {
        let reg = DevServerRegistry::new();
        assert!(reg.status("mk").is_none());
        assert!(reg.list().is_empty());
        reg.stop("mk"); // idempotent no-op
        reg.stop_all(); // no-op
    }

    #[test]
    fn port_is_open_false_for_unused_port() {
        // A high, almost-certainly-unbound port should read as closed quickly.
        assert!(!port_is_open(59_137));
    }

    #[test]
    fn http_responds_false_for_unused_port() {
        // No server bound → no HTTP response → not "healthy".
        assert!(!http_responds(59_138));
    }
}
