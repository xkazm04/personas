//! Dev-server supervision: the ONE spawn door for every dev server Personas
//! runs.
//!
//! Two kinds of server go through [`DevServerRegistry::spawn`], told apart by
//! their [`DevServerSpec`]:
//!
//! - **Studio previews** (`bun run dev`, `persistent = false`). One per Studio
//!   project, health-checked by the Studio, and **killed when the app exits**:
//!   `bun run dev` spawns a `next`/node child, so a bare parent-kill orphans the
//!   real server; [`kill_tree`] takes down the whole tree, and `stop_all` runs
//!   from the app-exit hook.
//! - **Server control** (an operator-configured shell command,
//!   `persistent = true`). These must OUTLIVE the app: spawned detached
//!   (`personas_engine::verification_command::spawn_detached`), never killed
//!   at exit, and recorded in `dev_server_runs` so the next boot re-adopts them
//!   ([`DevServerRegistry::adopt_runs`]). A re-adopted server has no `Child`
//!   handle, so its exit is detected by pid liveness instead.
//!
//! Every start writes its `dev_server_runs` row (both kinds; a Studio row is
//! what lets a crash-orphaned preview be found and killed at the next exit) and
//! every stop deletes it. The registry lives in `AppState`.

use std::collections::{HashMap, HashSet};
use std::net::{SocketAddr, TcpStream};
use std::process::Stdio;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};
use tokio_util::sync::CancellationToken;
use ts_rs::TS;

use crate::db::repos::dev::dev_servers::{self as runs_repo, DevServerRun};
use crate::db::DbPool;
use crate::error::AppError;

use super::server_control::ControlState;

/// What a dev server is spawned from. The kind decides its lifetime.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DevServerSpec {
    /// Studio's preview: `bun run dev` with `PORT` set. Killed at app exit.
    StudioBun,
    /// Server control: an operator command line, already validated and with
    /// `{port}` substituted, run through the platform shell with `PORT` set.
    /// Survives app exit.
    Shell(String),
}

impl DevServerSpec {
    /// Whether a server of this kind survives the app exiting.
    pub fn persistent(&self) -> bool {
        matches!(self, Self::Shell(_))
    }
}

/// A server Personas started (or re-adopted). `pid` is the root of the process
/// tree we kill.
struct DevServer {
    port: u16,
    pid: u32,
    /// `None` for a server re-adopted at boot: the process that held the
    /// handle is gone, so liveness is read from the pid.
    child: Option<tokio::process::Child>,
    started: Instant,
    /// Unix epoch seconds.
    started_at: i64,
    persistent: bool,
    /// Answered HTTP at least once since it started.
    healthy_once: bool,
}

/// The read-only facts about one owned server the view derivation needs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct OwnedServer {
    pub pid: u32,
    pub port: u16,
    /// Unix epoch seconds.
    pub started_at: i64,
    pub healthy_once: bool,
    pub persistent: bool,
}

/// A persistent server whose process was found gone by [`DevServerRegistry::reap`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExitedServer {
    pub project_id: String,
    pub pid: u32,
    pub healthy_once: bool,
    /// `None` when the exit was seen by pid liveness (no handle, no status).
    pub exit_code: Option<i32>,
}

/// What the boot re-adopt pass did with `dev_server_runs`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct AdoptOutcome {
    pub adopted: usize,
    pub dropped: usize,
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

/// How far a live process's start time may trail the recorded `started_at`
/// and still be the process we spawned. The recorded stamp is taken right
/// after the spawn returns, so a real match is within a second; anything that
/// started later is a different process that recycled the pid.
const ADOPT_START_SLACK_SECS: u64 = 5;

/// In-memory registry of running dev servers, keyed by `project_id`. One server
/// per project; starting again replaces (and kills) the prior one.
pub struct DevServerRegistry {
    servers: Mutex<HashMap<String, DevServer>>,
    db: DbPool,
    control: ControlState,
    shutdown: CancellationToken,
}

impl DevServerRegistry {
    pub fn new(db: DbPool) -> Self {
        Self {
            servers: Mutex::new(HashMap::new()),
            db,
            control: ControlState::default(),
            shutdown: CancellationToken::new(),
        }
    }

    /// Server control's transient state (scans, stops, failures in flight).
    pub fn control(&self) -> &ControlState {
        &self.control
    }

    /// Cancelled once, at app exit; the server-control supervisor races its
    /// tick against it.
    pub fn shutdown_token(&self) -> CancellationToken {
        self.shutdown.clone()
    }

    /// Stop the supervisor loop. Does not touch any server.
    pub fn shutdown(&self) {
        self.shutdown.cancel();
    }

    /// Studio: spawn `bun run dev` for `project_id` on `port`, replacing any
    /// prior server for the same project. Returns immediately (the server is
    /// still booting); the caller polls [`status`](Self::status) until `healthy`.
    pub async fn start(
        &self,
        project_id: &str,
        project_dir: &std::path::Path,
        port: u16,
    ) -> Result<DevServerStatus, AppError> {
        self.spawn(project_id, project_dir, port, &DevServerSpec::StudioBun)?;
        Ok(DevServerStatus {
            project_id: project_id.to_string(),
            port,
            url: format!("http://localhost:{port}"),
            healthy: false, // just spawned; caller polls until healthy
            uptime_secs: 0,
        })
    }

    /// The one spawn door. Stops any prior server for the project, spawns the
    /// new one from `spec`, registers it and records its `dev_server_runs` row.
    pub fn spawn(
        &self,
        project_id: &str,
        project_dir: &std::path::Path,
        port: u16,
        spec: &DevServerSpec,
    ) -> Result<OwnedServer, AppError> {
        // Tear down any prior server for this project first. A prior server
        // that refuses to die is an error here too: starting another one next
        // to it would leave two servers and track only one.
        self.stop(project_id)?;
        // Next keeps one dev server per project dir; a crash-orphaned `next dev`
        // (the app was force-killed, skipping stop_all) would hold the lock and
        // make every restart fail with "Another next dev server is already
        // running". Clear it so reopening a project after a crash works. Holds
        // for a configured `npm run dev` of a Next app exactly as for Studio.
        clear_stale_next_lock(project_dir);

        let child = match spec {
            DevServerSpec::StudioBun => {
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
                cmd.spawn()
                    .map_err(|e| AppError::Internal(format!("spawn `bun run dev`: {e}")))?
            }
            DevServerSpec::Shell(command) => personas_engine::verification_command::spawn_detached(
                project_dir,
                command,
                &[("PORT", port.to_string())],
            )
            .map_err(|e| AppError::ProcessSpawn(format!("spawn `{command}`: {e}")))?,
        };
        let pid = child
            .id()
            .ok_or_else(|| AppError::Internal("dev server has no pid".into()))?;
        let started_at = chrono::Utc::now().timestamp();
        let persistent = spec.persistent();

        let displaced = {
            let mut guard = self.servers.lock().unwrap_or_else(|p| p.into_inner());
            guard.insert(
                project_id.to_string(),
                DevServer {
                    port,
                    pid,
                    child: Some(child),
                    started: Instant::now(),
                    started_at,
                    persistent,
                    healthy_once: false,
                },
            )
        };
        // Two starts for one project can both pass the `stop` above before
        // either registers (a liveness self-heal racing a manual retry). The
        // insert then replaces the first server's entry and it would run on,
        // untracked, holding its port until the app exits. Kill it now.
        if let Some(old) = displaced {
            if let Err(e) = kill_tree(old.pid) {
                tracing::warn!(project_id, error = %e, "could not stop a displaced dev server");
            }
            if let Some(mut child) = old.child {
                let _ = child.start_kill();
            }
        }

        // The row is what lets this server be found again after a restart. A
        // failed write leaves the server running and tracked for this session;
        // it is only the NEXT session that would lose it, so it is logged, not
        // turned into a failed start of a server that is already up.
        let run = DevServerRun {
            project_id: project_id.to_string(),
            pid: i64::from(pid),
            port: i64::from(port),
            started_at,
            persistent,
        };
        if let Err(e) = runs_repo::upsert_run(&self.db, &run) {
            tracing::warn!(project_id, pid, error = %e, "dev server run was not recorded; it will not be re-adopted after a restart");
        }

        Ok(OwnedServer {
            pid,
            port,
            started_at,
            healthy_once: false,
            persistent,
        })
    }

    /// Studio: current status for a project's preview server, or `None` if not
    /// running. Server-control servers are not Studio previews and are not
    /// reported here. The (blocking) TCP health check runs after the lock is
    /// released.
    pub fn status(&self, project_id: &str) -> Option<DevServerStatus> {
        let (port, started) = {
            let guard = self.servers.lock().unwrap_or_else(|p| p.into_inner());
            let s = guard.get(project_id).filter(|s| !s.persistent)?;
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

    /// Studio: status of every running preview server.
    pub fn list(&self) -> Vec<DevServerStatus> {
        let snapshot: Vec<(String, u16, Instant)> = {
            let guard = self.servers.lock().unwrap_or_else(|p| p.into_inner());
            guard
                .iter()
                .filter(|(_, s)| !s.persistent)
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

    /// Every server Personas owns right now, by project id.
    pub fn owned(&self) -> HashMap<String, OwnedServer> {
        let guard = self.servers.lock().unwrap_or_else(|p| p.into_inner());
        guard
            .iter()
            .map(|(id, s)| {
                (
                    id.clone(),
                    OwnedServer {
                        pid: s.pid,
                        port: s.port,
                        started_at: s.started_at,
                        healthy_once: s.healthy_once,
                        persistent: s.persistent,
                    },
                )
            })
            .collect()
    }

    /// Record that a project's server answered HTTP. From then on a missed
    /// probe (a dev server busy recompiling) does not read as "starting" again.
    pub fn mark_healthy(&self, project_id: &str) {
        let mut guard = self.servers.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(s) = guard.get_mut(project_id) {
            s.healthy_once = true;
        }
    }

    /// Find the persistent servers whose process is gone, unregister them and
    /// delete their run rows. Studio previews are left alone: the Studio polls
    /// its own status and `stop_all` reaps them at exit.
    pub fn reap(&self) -> Vec<ExitedServer> {
        let mut exited = Vec::new();
        let mut handleless: Vec<(String, u32, bool)> = Vec::new();
        {
            let mut guard = self.servers.lock().unwrap_or_else(|p| p.into_inner());
            for (id, s) in guard.iter_mut().filter(|(_, s)| s.persistent) {
                match s.child.as_mut() {
                    Some(child) => match child.try_wait() {
                        Ok(Some(status)) => exited.push(ExitedServer {
                            project_id: id.clone(),
                            pid: s.pid,
                            healthy_once: s.healthy_once,
                            exit_code: status.code(),
                        }),
                        Ok(None) => {}
                        Err(e) => {
                            tracing::warn!(project_id = %id, pid = s.pid, error = %e, "dev server: could not read the exit status");
                        }
                    },
                    None => handleless.push((id.clone(), s.pid, s.healthy_once)),
                }
            }
        }
        if !handleless.is_empty() {
            let pids: Vec<u32> = handleless.iter().map(|(_, pid, _)| *pid).collect();
            let alive = process_start_times(&pids);
            for (project_id, pid, healthy_once) in handleless {
                if !alive.contains_key(&pid) {
                    exited.push(ExitedServer {
                        project_id,
                        pid,
                        healthy_once,
                        exit_code: None,
                    });
                }
            }
        }
        if exited.is_empty() {
            return exited;
        }
        // Unregister only the entry that exited: a restart may have replaced
        // it between the two locks, and that new server is alive.
        {
            let mut guard = self.servers.lock().unwrap_or_else(|p| p.into_inner());
            exited.retain(|e| match guard.get(&e.project_id) {
                Some(s) if s.pid == e.pid => {
                    guard.remove(&e.project_id);
                    true
                }
                _ => false,
            });
        }
        for e in &exited {
            if let Err(err) = runs_repo::delete_run(&self.db, &e.project_id) {
                tracing::warn!(project_id = %e.project_id, error = %err, "dev server: the run row of an exited server was not deleted");
            }
        }
        exited
    }

    /// Boot: re-adopt every `dev_server_runs` row whose process is still the
    /// one we spawned, and delete the rest. A re-adopted server keeps its
    /// recorded kind, so a Studio preview orphaned by a crash is killed at the
    /// next exit like any other.
    pub fn adopt_runs(&self) -> Result<AdoptOutcome, AppError> {
        let runs = runs_repo::list_runs(&self.db)?;
        let pids: Vec<u32> = runs
            .iter()
            .filter_map(|r| u32::try_from(r.pid).ok())
            .collect();
        let alive = process_start_times(&pids);
        let now = chrono::Utc::now().timestamp();
        let mut outcome = AdoptOutcome::default();
        for run in runs {
            let pid = u32::try_from(run.pid).ok();
            let port = u16::try_from(run.port).ok();
            let ours = match (pid, port) {
                (Some(pid), Some(_)) => alive
                    .get(&pid)
                    .is_some_and(|start| started_by_us(*start, run.started_at)),
                _ => false,
            };
            match (ours, pid, port) {
                (true, Some(pid), Some(port)) => {
                    let elapsed = u64::try_from(now.saturating_sub(run.started_at)).unwrap_or(0);
                    let started = Instant::now()
                        .checked_sub(Duration::from_secs(elapsed))
                        .unwrap_or_else(Instant::now);
                    let mut guard = self.servers.lock().unwrap_or_else(|p| p.into_inner());
                    guard.entry(run.project_id.clone()).or_insert(DevServer {
                        port,
                        pid,
                        child: None,
                        started,
                        started_at: run.started_at,
                        persistent: run.persistent,
                        healthy_once: false,
                    });
                    outcome.adopted += 1;
                }
                _ => {
                    runs_repo::delete_run(&self.db, &run.project_id)?;
                    outcome.dropped += 1;
                }
            }
        }
        Ok(outcome)
    }

    /// Stop a project's dev server, killing the whole process tree. Idempotent:
    /// no server, or one already gone, is a successful stop. A kill that fails
    /// is an error and the server stays registered, so it is still listed,
    /// still stopped by `stop_all`, and a second stop can retry it.
    pub fn stop(&self, project_id: &str) -> Result<(), AppError> {
        let server = {
            let mut guard = self.servers.lock().unwrap_or_else(|p| p.into_inner());
            guard.remove(project_id)
        };
        let Some(mut s) = server else { return Ok(()) };
        match kill_tree(s.pid) {
            Ok(()) => {
                // Best-effort reap of the direct child handle; the tree is gone.
                if let Some(child) = s.child.as_mut() {
                    let _ = child.start_kill();
                }
                if let Err(e) = runs_repo::delete_run(&self.db, project_id) {
                    tracing::warn!(project_id, error = %e, "dev server stopped but its run row was not deleted; the next boot drops it");
                }
                Ok(())
            }
            Err(why) => {
                let mut guard = self.servers.lock().unwrap_or_else(|p| p.into_inner());
                // A server started for this project meanwhile keeps its slot.
                guard.entry(project_id.to_string()).or_insert(s);
                Err(AppError::Internal(format!(
                    "could not stop the dev server for {project_id}: {why}"
                )))
            }
        }
    }

    /// Kill every Studio preview server. Call from the app's exit hook so a
    /// closing app never orphans a `bun`/`next` tree. Server-control servers
    /// (`persistent`) are left running on purpose: they outlive the app and
    /// the next boot re-adopts them.
    pub fn stop_all(&self) {
        let ids: Vec<String> = {
            let guard = self.servers.lock().unwrap_or_else(|p| p.into_inner());
            guard
                .iter()
                .filter(|(_, s)| !s.persistent)
                .map(|(id, _)| id.clone())
                .collect()
        };
        for id in ids {
            if let Err(e) = self.stop(&id) {
                tracing::warn!(project_id = %id, error = %e, "dev server did not stop at exit");
            }
        }
    }
}

/// Start time (unix epoch seconds) of each of `pids` that is a live process.
/// A pid missing from the map is not running. One process-table refresh for
/// all of them.
fn process_start_times(pids: &[u32]) -> HashMap<u32, u64> {
    if pids.is_empty() {
        return HashMap::new();
    }
    // Deduplicated BEFORE the refresh: sysinfo's dead-process sweep flips a
    // per-process "updated" flag once per listed pid, so a pid listed twice
    // reads as updated, then as dead, and is dropped from the table.
    let unique: HashSet<Pid> = pids.iter().map(|p| Pid::from_u32(*p)).collect();
    let wanted: Vec<Pid> = unique.into_iter().collect();
    let mut sys = System::new();
    sys.refresh_processes_specifics(
        ProcessesToUpdate::Some(&wanted),
        true,
        ProcessRefreshKind::nothing(),
    );
    wanted
        .into_iter()
        .filter_map(|pid| sys.process(pid).map(|p| (pid.as_u32(), p.start_time())))
        .collect()
}

/// Whether a live process that started at `process_start` (epoch seconds; 0 =
/// unknown) can be the one recorded as started at `recorded_start`.
fn started_by_us(process_start: u64, recorded_start: i64) -> bool {
    if process_start == 0 {
        // The platform would not say; liveness alone is all there is.
        return true;
    }
    let recorded = u64::try_from(recorded_start).unwrap_or(0);
    process_start <= recorded.saturating_add(ADOPT_START_SLACK_SECS)
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

/// True if an HTTP GET to `127.0.0.1:port` gets an `HTTP/...` response line.
/// Stronger than a bare TCP connect: a dev server that bound the port but is
/// wedged (compiling forever, or crashed with the socket lingering) still accepts
/// the connection yet never serves — a bare TCP check would call it healthy and the
/// preview would render blank. Requiring a real response makes "healthy" mean
/// "actually serving", so a dead-but-bound server is never adopted.
pub(crate) fn http_responds(port: u16) -> bool {
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
/// child, so a bare kill orphans the server — use `taskkill /T`. On Unix the
/// process GROUP is signalled as well as the pid: a server-control server is
/// spawned as its own group leader, so `-pid` reaches its whole tree, and for
/// any other process (an external server's owner) the group send finds
/// nothing while the pid send does the work. A process that is already gone
/// counts as killed; anything else the kill command reports (access denied,
/// the command itself missing) is an error, because the server may still be
/// holding its port.
pub(crate) fn kill_tree(pid: u32) -> Result<(), String> {
    #[cfg(windows)]
    let out = {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        std::process::Command::new("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .creation_flags(CREATE_NO_WINDOW)
            .stdin(Stdio::null())
            .output()
            .map_err(|e| format!("run taskkill: {e}"))?
    };
    #[cfg(not(windows))]
    let out = std::process::Command::new("kill")
        .args(["-9", "--", &format!("-{pid}"), &pid.to_string()])
        .stdin(Stdio::null())
        .output()
        .map_err(|e| format!("run kill: {e}"))?;
    if out.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
    if already_gone(out.status.code(), &stderr) {
        return Ok(());
    }
    Err(format!(
        "kill of process {pid} exited with {:?}: {stderr}",
        out.status.code()
    ))
}

/// The kill command's way of saying the process no longer exists: `taskkill`
/// exits 128 ("not found"), `kill` prints "No such process" for EVERY target
/// it could not find (the group and the pid each get a line), so the stop is
/// clean only when every line it printed says exactly that.
fn already_gone(code: Option<i32>, stderr: &str) -> bool {
    if cfg!(windows) {
        code == Some(128)
    } else {
        let mut lines = stderr.lines().filter(|l| !l.trim().is_empty()).peekable();
        lines.peek().is_some() && lines.all(|l| l.contains("No such process"))
    }
}

/// Next records its single-per-dir dev server in `.next/dev/lock`
/// (`{"pid":N,"port":P,...}`). A crash-orphaned `next dev` keeps that lock and
/// blocks every restart. Before spawning, kill a still-live orphan named by the
/// lock and remove the file. Best-effort + safe: only kills a pid that is still a
/// live `node` process, so a recycled pid can't take down an unrelated process.
fn clear_stale_next_lock(project_dir: &std::path::Path) {
    let lock = project_dir.join(".next").join("dev").join("lock");
    if let Ok(body) = std::fs::read_to_string(&lock) {
        if let Some(pid) = parse_lock_pid(&body) {
            if pid_is_node(pid) {
                if let Err(e) = kill_tree(pid) {
                    tracing::warn!(pid, error = %e, "could not kill the orphaned next dev server");
                }
            }
        }
        let _ = std::fs::remove_file(&lock);
    }
}

/// Pull `pid` out of the Next dev lock JSON without a serde dependency here.
fn parse_lock_pid(body: &str) -> Option<u32> {
    let after = body.split_once("\"pid\"")?.1;
    let after = after.trim_start().strip_prefix(':')?.trim_start();
    let digits: String = after.chars().take_while(|c| c.is_ascii_digit()).collect();
    digits.parse().ok()
}

/// True if `pid` is currently a live `node` process. Guards the lock-recovery
/// kill against killing an unrelated process that recycled a dead orphan's pid.
#[cfg(windows)]
fn pid_is_node(pid: u32) -> bool {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    std::process::Command::new("tasklist")
        .args(["/FI", &format!("PID eq {pid}"), "/FO", "CSV", "/NH"])
        .creation_flags(CREATE_NO_WINDOW)
        .stdin(Stdio::null())
        .output()
        .map(|o| {
            String::from_utf8_lossy(&o.stdout)
                .to_lowercase()
                .contains("node.exe")
        })
        .unwrap_or(false)
}

#[cfg(not(windows))]
fn pid_is_node(pid: u32) -> bool {
    std::process::Command::new("ps")
        .args(["-p", &pid.to_string(), "-o", "comm="])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).contains("node"))
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_next_lock_pid() {
        assert_eq!(
            parse_lock_pid(r#"{"pid":12404,"port":52368,"hostname":"localhost"}"#),
            Some(12404)
        );
        assert_eq!(parse_lock_pid(r#"{"port":1,"pid": 7 }"#), Some(7));
        assert_eq!(parse_lock_pid(r#"{"port":1}"#), None);
        assert_eq!(parse_lock_pid("not json"), None);
    }

    #[test]
    fn empty_registry_reports_nothing() {
        let reg = DevServerRegistry::new(crate::db::init_test_db().unwrap());
        assert!(reg.status("mk").is_none());
        assert!(reg.list().is_empty());
        assert!(reg.owned().is_empty());
        assert!(reg.reap().is_empty());
        reg.stop("mk").expect("idempotent no-op");
        reg.stop_all(); // no-op
    }

    #[test]
    fn only_server_control_kinds_are_persistent() {
        assert!(!DevServerSpec::StudioBun.persistent());
        assert!(DevServerSpec::Shell("npm run dev".into()).persistent());
    }

    #[test]
    fn a_recycled_pid_is_not_ours() {
        // Started a second after our record: the process we spawned.
        assert!(started_by_us(1_000_001, 1_000_000));
        // Started long after our record: something else took the pid.
        assert!(!started_by_us(1_000_600, 1_000_000));
        // Started before our record (the shell spawned, then we stamped).
        assert!(started_by_us(999_999, 1_000_000));
        // The platform could not say: liveness is all there is.
        assert!(started_by_us(0, 1_000_000));
    }

    #[test]
    fn boot_adopts_live_runs_and_drops_dead_or_recycled_ones() {
        use crate::db::repos::dev::projects::create_project;
        let pool = crate::db::init_test_db().unwrap();
        let mk = |name: &str| {
            create_project(
                &pool,
                name,
                &format!("C:/r/{name}"),
                None,
                None,
                None,
                None,
                None,
            )
            .unwrap()
            .id
        };
        let (live, dead, recycled) = (mk("live"), mk("dead"), mk("recycled"));
        let me = i64::from(std::process::id());
        let now = chrono::Utc::now().timestamp();
        let run = |project_id: &str, pid: i64, started_at: i64| DevServerRun {
            project_id: project_id.to_string(),
            pid,
            port: 3000,
            started_at,
            persistent: true,
        };
        // This test process stands in for a server that outlived the app: it
        // is alive and it started before the recorded stamp.
        runs_repo::upsert_run(&pool, &run(&live, me, now)).unwrap();
        // No process has this pid.
        runs_repo::upsert_run(&pool, &run(&dead, 4_000_000_000, now)).unwrap();
        // Alive, but it started long after the record: a recycled pid.
        runs_repo::upsert_run(&pool, &run(&recycled, me, 1_000)).unwrap();

        let reg = DevServerRegistry::new(pool.clone());
        let outcome = reg.adopt_runs().unwrap();
        assert_eq!(
            outcome,
            AdoptOutcome {
                adopted: 1,
                dropped: 2
            }
        );
        let owned = reg.owned();
        assert_eq!(owned.len(), 1);
        assert_eq!(owned[&live].pid, std::process::id());
        assert!(owned[&live].persistent);
        let rows: Vec<String> = runs_repo::list_runs(&pool)
            .unwrap()
            .into_iter()
            .map(|r| r.project_id)
            .collect();
        assert_eq!(rows, vec![live.clone()]);
        // Still alive, so a reap leaves it registered. (Never stop it: the
        // "server" is this test process.)
        assert!(reg.reap().is_empty());
        assert!(reg.owned().contains_key(&live));
        // Not a Studio preview, so the Studio surfaces do not report it.
        assert!(reg.status(&live).is_none());
        assert!(reg.list().is_empty());
    }

    #[test]
    fn a_process_that_is_already_gone_is_a_successful_stop() {
        // The common case at close: the server died on its own. That must not
        // be reported to the user as a failed stop. These are the exact
        // answers taskkill and kill give for a pid that no longer exists.
        #[cfg(windows)]
        assert!(already_gone(
            Some(128),
            "ERROR: The process \"4242\" not found."
        ));
        #[cfg(not(windows))]
        assert!(already_gone(Some(1), "kill: (4242) - No such process"));
    }

    #[test]
    fn a_refused_kill_is_not_mistaken_for_a_gone_process() {
        assert!(!already_gone(Some(1), "ERROR: Access is denied."));
        assert!(!already_gone(
            Some(1),
            "kill: (1) - Operation not permitted"
        ));
        // Unix signals the group and the pid; one refusal among them is a
        // refusal, whatever the other line said.
        #[cfg(not(windows))]
        assert!(!already_gone(
            Some(1),
            "kill: (-7) - No such process\nkill: (7) - Operation not permitted"
        ));
        #[cfg(not(windows))]
        assert!(already_gone(
            Some(1),
            "kill: (-7) - No such process\nkill: (7) - No such process"
        ));
    }

    #[test]
    fn http_responds_false_for_unused_port() {
        // No server bound → no HTTP response → not "healthy".
        assert!(!http_responds(59_138));
    }
}
