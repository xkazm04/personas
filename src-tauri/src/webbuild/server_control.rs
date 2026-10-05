//! Server control: the operator's dev projects as runnable dev servers.
//!
//! A project is in the Server control view when its `dev_port` is set
//! (`e59_dev_servers`). Personas can start, stop and restart its dev server,
//! adopts one started elsewhere as `external`, and keeps the ones it started
//! alive across an app restart (`dev_server_runs`, re-adopted on boot).
//!
//! Every spawn goes through [`super::devserver::DevServerRegistry`], the one
//! spawn door Studio's previews also use. The contract is frozen in the spark
//! brief (`server-control`); the wire names below are part of it.
//!
//! Layout:
//! - this file: the wire types, the transient [`ControlState`], the command
//!   validator and the service functions the IPC commands adapt;
//! - [`derive`]: the state table, as one pure function;
//! - [`ports`]: the LISTEN-socket table (`netstat` / `lsof`) and the free-port
//!   suggestion;
//! - [`scan`]: the one-shot repository scan (headless Claude CLI);
//! - [`supervise`]: the 3 s tick that re-derives the view and emits on change.

mod derive;
mod ports;
mod scan;
mod supervise;

pub use supervise::start as start_supervisor;

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, EventTarget};
use ts_rs::TS;

use super::devserver::{http_responds, kill_tree, DevServerRegistry, DevServerSpec};
use crate::db::repos::dev::dev_servers::{self as repo, DevServerConfig};
use crate::db::DbPool;
use crate::error::AppError;

/// Where a project's dev server stands. Derived by the supervisor on every
/// tick; the frontend only reads it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "lowercase")]
pub enum DevServerState {
    /// In the view (`dev_port` set) but no `dev_command` yet.
    Unconfigured,
    Stopped,
    /// The one-shot repo scan is running.
    Scanning,
    /// Spawned by Personas, not yet answering HTTP (at most 120 s).
    Starting,
    Running,
    Stopping,
    /// The port is held by a process Personas did not start.
    External,
    /// Spawn error, early exit, no HTTP within 120 s, or a failed scan.
    Failed,
}

/// One row of the Server control view: a dev project plus its live server.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DevServerView {
    pub project_id: String,
    pub project_name: String,
    pub root_path: String,
    pub workspace_id: Option<String>,
    /// Comma-separated, the `DevProject.tech_stack` convention.
    pub tech_stack: Option<String>,
    pub dev_command: Option<String>,
    pub dev_port: u16,
    pub state: DevServerState,
    /// Root pid of a server Personas started or re-adopted.
    pub pid: Option<u32>,
    /// Owner of the LISTEN socket on `dev_port` when it is not ours.
    pub external_pid: Option<u32>,
    /// Unix epoch seconds the server started. A stamp, not an uptime, so an
    /// idle server never changes the view and never emits an event.
    #[ts(type = "number | null")]
    pub started_at: Option<i64>,
    /// `http://localhost:<dev_port>`.
    pub url: String,
    /// Why the state is `failed`; `None` otherwise.
    pub error: Option<String>,
}

// ----------------------------------------------------------------------------
// Transient state
// ----------------------------------------------------------------------------

/// Server control's in-memory state: what is in flight and what failed. Held
/// by the registry (so by `AppState`), never persisted: a scan or a stop does
/// not survive a restart, and a failure is a fact about this session's attempt.
#[derive(Default)]
pub struct ControlState {
    inner: Mutex<ControlInner>,
}

#[derive(Default)]
struct ControlInner {
    scanning: HashSet<String>,
    stopping: HashSet<String>,
    /// Sticky until the next start or stop of that project.
    failures: HashMap<String, String>,
    /// What the last `dev-servers-changed` carried; the supervisor emits only
    /// when the new list differs.
    last_emitted: Option<Vec<DevServerView>>,
}

/// A copy of the flags, taken once per derivation so a view is internally
/// consistent.
#[derive(Debug, Clone, Default)]
pub(crate) struct ControlFlags {
    pub scanning: HashSet<String>,
    pub stopping: HashSet<String>,
    pub failures: HashMap<String, String>,
}

impl ControlState {
    fn lock(&self) -> MutexGuard<'_, ControlInner> {
        // Every field is a cache of in-flight facts; a poisoned guard still
        // holds the last consistent set, so recovering it is safe.
        self.inner.lock().unwrap_or_else(|p| p.into_inner())
    }

    /// Mark a scan in flight. `false` when one already is.
    pub(crate) fn begin_scan(&self, project_id: &str) -> bool {
        self.lock().scanning.insert(project_id.to_string())
    }

    pub(crate) fn end_scan(&self, project_id: &str) {
        self.lock().scanning.remove(project_id);
    }

    pub(crate) fn is_scanning(&self, project_id: &str) -> bool {
        self.lock().scanning.contains(project_id)
    }

    fn set_stopping(&self, project_id: &str, on: bool) {
        let mut inner = self.lock();
        if on {
            inner.stopping.insert(project_id.to_string());
        } else {
            inner.stopping.remove(project_id);
        }
    }

    pub(crate) fn fail(&self, project_id: &str, reason: String) {
        self.lock().failures.insert(project_id.to_string(), reason);
    }

    pub(crate) fn clear_failure(&self, project_id: &str) {
        self.lock().failures.remove(project_id);
    }

    pub(crate) fn flags(&self) -> ControlFlags {
        let inner = self.lock();
        ControlFlags {
            scanning: inner.scanning.clone(),
            stopping: inner.stopping.clone(),
            failures: inner.failures.clone(),
        }
    }

    /// Remember `views` as emitted.
    fn record_emitted(&self, views: &[DevServerView]) {
        self.lock().last_emitted = Some(views.to_vec());
    }

    /// Remember `views` and say whether they differ from the last emission.
    fn record_if_changed(&self, views: &[DevServerView]) -> bool {
        let mut inner = self.lock();
        if inner.last_emitted.as_deref() == Some(views) {
            return false;
        }
        inner.last_emitted = Some(views.to_vec());
        true
    }
}

// ----------------------------------------------------------------------------
// The command validator
// ----------------------------------------------------------------------------

/// The longest dev command accepted.
pub const COMMAND_MAX_CHARS: usize = 200;

/// The one placeholder a dev command may carry.
pub const PORT_PLACEHOLDER: &str = "{port}";

/// Characters that would let the shell run anything but one simple command:
/// chaining, pipes, redirection, substitution, subshells, and (cmd.exe)
/// `%VAR%` expansion, which would read this app's own environment.
const FORBIDDEN_CHARS: &[char] = &['&', '|', ';', '<', '>', '`', '$', '(', ')', '%', '\n', '\r'];

/// Validate a dev command (configure, and every scan result) and return it
/// trimmed. `AppError::Validation` names the first rule it breaks.
pub fn validate_command(raw: &str) -> Result<String, AppError> {
    personas_core::validation::require_non_empty("dev command", raw)?;
    let command = raw.trim();
    let chars = command.chars().count();
    if chars > COMMAND_MAX_CHARS {
        return Err(AppError::Validation(format!(
            "the dev command is {chars} characters; the limit is {COMMAND_MAX_CHARS}"
        )));
    }
    if let Some(bad) = command.chars().find(|c| FORBIDDEN_CHARS.contains(c)) {
        let shown = match bad {
            '\n' | '\r' => "a line break".to_string(),
            c => format!("`{c}`"),
        };
        return Err(AppError::Validation(format!(
            "the dev command may not contain {shown}: it must be one command, not a shell chain"
        )));
    }
    let rest = command.replace(PORT_PLACEHOLDER, "");
    if rest.contains('{') || rest.contains('}') {
        return Err(AppError::Validation(format!(
            "`{PORT_PLACEHOLDER}` is the only placeholder a dev command may use"
        )));
    }
    Ok(command.to_string())
}

/// Substitute the port into a validated command.
pub fn render_command(command: &str, port: u16) -> String {
    command.replace(PORT_PLACEHOLDER, &port.to_string())
}

// ----------------------------------------------------------------------------
// Deriving and publishing the view
// ----------------------------------------------------------------------------

fn now_secs() -> i64 {
    chrono::Utc::now().timestamp()
}

/// Run blocking work (rusqlite, process probes, HTTP probes) on the blocking
/// pool and wait for it. The handle is kept and a panic becomes this call's
/// error, named, rather than a flattened join failure.
async fn blocking<T, F>(what: &'static str, work: F) -> Result<T, AppError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, AppError> + Send + 'static,
{
    let handle = tokio::task::spawn_blocking(work);
    match handle.await {
        Ok(result) => result,
        Err(e) if e.is_panic() => Err(AppError::Internal(format!(
            "server control: {what} panicked: {}",
            personas_core::utils::extract_panic_message(e.into_panic())
        ))),
        Err(e) => Err(AppError::Internal(format!(
            "server control: {what} was cancelled: {e}"
        ))),
    }
}

/// The LISTEN table, or an empty one (with a warning) when the platform tool
/// could not be read: external servers are then invisible for one pass, which
/// is better than a view that fails as a whole.
async fn listen_table_or_empty() -> ports::ListenTable {
    match ports::listen_table().await {
        Ok(table) => table,
        Err(e) => {
            tracing::warn!(error = %e, "server control: could not read the listening sockets; external servers are invisible this pass");
            ports::ListenTable::new()
        }
    }
}

/// Compute the whole view: reap exited servers, read the configured projects,
/// probe our own servers, derive every row.
pub(crate) async fn compute_views(
    pool: &DbPool,
    reg: &Arc<DevServerRegistry>,
) -> Result<Vec<DevServerView>, AppError> {
    let (p, r) = (pool.clone(), reg.clone());
    let configs = blocking("view read", move || {
        reap_exited(&r);
        repo::list_configured(&p)
    })
    .await?;
    if configs.is_empty() {
        return Ok(Vec::new());
    }
    let listening = listen_table_or_empty().await;
    let r = reg.clone();
    blocking("view probe", move || {
        Ok(derive_all(&configs, &r, &listening, now_secs()))
    })
    .await
}

/// Unregister the persistent servers whose process is gone, and remember a
/// failure for the ones that died before ever answering.
fn reap_exited(reg: &DevServerRegistry) {
    for exited in reg.reap() {
        if !exited.healthy_once {
            let reason = match exited.exit_code {
                Some(code) => format!("the server exited with code {code} before answering HTTP"),
                None => "the server process exited before answering HTTP".to_string(),
            };
            reg.control().fail(&exited.project_id, reason);
        }
    }
}

/// Probe each `(project_id, port)` for HTTP in parallel (a wedged server costs
/// up to ~1.6 s; probed one after another, a few of them would stall the tick)
/// and return the ids that answered.
fn probe_parallel(targets: &[(String, u16)]) -> HashSet<String> {
    std::thread::scope(|scope| {
        let probes: Vec<_> = targets
            .iter()
            .map(|(id, port)| {
                let port = *port;
                (id, scope.spawn(move || http_responds(port)))
            })
            .collect();
        probes
            .into_iter()
            .filter_map(|(id, probe)| match probe.join() {
                Ok(true) => Some(id.clone()),
                _ => None,
            })
            .collect()
    })
}

/// Derive every row. Blocking: HTTP probes.
fn derive_all(
    configs: &[DevServerConfig],
    reg: &DevServerRegistry,
    listening: &ports::ListenTable,
    now: i64,
) -> Vec<DevServerView> {
    let owned = reg.owned();
    // Probe ours only: an external server's state does not depend on whether
    // it answers, and a stopped project has nothing to probe.
    let targets: Vec<(String, u16)> = configs
        .iter()
        .filter_map(|c| owned.get(&c.id).map(|o| (c.id.clone(), o.port)))
        .collect();
    let responding = probe_parallel(&targets);
    for id in &responding {
        reg.mark_healthy(id);
    }
    let flags = reg.control().flags();
    configs
        .iter()
        .filter_map(|cfg| {
            // A port outside u16 can only come from a hand-edited row.
            let port = u16::try_from(cfg.dev_port?).ok()?;
            let ours = owned.get(&cfg.id).copied();
            let responds = responding.contains(&cfg.id);
            let observed = derive::Observed {
                scanning: flags.scanning.contains(&cfg.id),
                stopping: flags.stopping.contains(&cfg.id),
                failure: flags.failures.get(&cfg.id).map(String::as_str),
                ours,
                responds,
                listener_pid: listening.get(&port).copied(),
                now,
            };
            Some(derive::derive_view(cfg, port, &observed))
        })
        .collect()
}

/// Emit the whole list to the main window. Same target rule as `BROWSER_TABS`:
/// never `app.emit`, which would also reach the page webviews.
fn emit_views(app: &AppHandle, views: &[DevServerView]) {
    if let Err(e) = app.emit_to(
        EventTarget::AnyLabel {
            label: crate::browser_bridge::webview::layout::MAIN_WINDOW.to_string(),
        },
        personas_core::events::event_name::DEV_SERVERS_CHANGED,
        views,
    ) {
        tracing::warn!(error = %e, "server control: the dev-servers-changed event was not delivered");
    }
}

/// Compute the view and emit it unconditionally. Every mutating command ends
/// here, so the page moves the moment the command lands.
pub(crate) async fn publish(
    app: &AppHandle,
    pool: &DbPool,
    reg: &Arc<DevServerRegistry>,
) -> Result<Vec<DevServerView>, AppError> {
    let views = compute_views(pool, reg).await?;
    reg.control().record_emitted(&views);
    emit_views(app, &views);
    Ok(views)
}

/// The supervisor's emission: only when the list changed.
pub(crate) async fn publish_if_changed(
    app: &AppHandle,
    pool: &DbPool,
    reg: &Arc<DevServerRegistry>,
) -> Result<bool, AppError> {
    let views = compute_views(pool, reg).await?;
    if !reg.control().record_if_changed(&views) {
        return Ok(false);
    }
    emit_views(app, &views);
    Ok(true)
}

fn row_of(views: Vec<DevServerView>, project_id: &str) -> Result<DevServerView, AppError> {
    views
        .into_iter()
        .find(|v| v.project_id == project_id)
        .ok_or_else(|| {
            AppError::NotFound(format!(
                "server control: project {project_id} is not in the view"
            ))
        })
}

/// Read one project's config. NotFound when the project does not exist;
/// Validation when it exists but is not in the view.
async fn load_config(pool: &DbPool, project_id: &str) -> Result<(DevServerConfig, u16), AppError> {
    let (p, id) = (pool.clone(), project_id.to_string());
    let cfg = blocking("config read", move || repo::get_config(&p, &id))
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Dev project {project_id}")))?;
    let port = cfg
        .dev_port
        .and_then(|p| u16::try_from(p).ok())
        .ok_or_else(|| AppError::Validation(format!("{} is not in server control", cfg.name)))?;
    Ok((cfg, port))
}

// ----------------------------------------------------------------------------
// Services (the IPC commands are adapters over these)
// ----------------------------------------------------------------------------

/// `dev_servers_list`.
pub(crate) async fn list(
    pool: &DbPool,
    reg: &Arc<DevServerRegistry>,
) -> Result<Vec<DevServerView>, AppError> {
    compute_views(pool, reg).await
}

/// `dev_server_start`. Refuses when the port already has a listener (no
/// double start); a project whose server is already ours is returned as is.
pub(crate) async fn start(
    app: &AppHandle,
    pool: &DbPool,
    reg: &Arc<DevServerRegistry>,
    project_id: &str,
) -> Result<DevServerView, AppError> {
    let (cfg, port) = load_config(pool, project_id).await?;
    if reg.owned().contains_key(project_id) {
        let current = row_of(compute_views(pool, reg).await?, project_id)?;
        if current.state != DevServerState::Failed {
            return row_of(publish(app, pool, reg).await?, project_id);
        }
        // Ours, but it never answered within the grace: Start replaces it
        // rather than reporting the dead end back.
        let (r, id) = (reg.clone(), project_id.to_string());
        blocking("stop", move || r.stop(&id)).await?;
        wait_for_port_release(port).await;
    }
    if reg.control().is_scanning(project_id) {
        return Err(AppError::Validation(format!(
            "{} is still being scanned; start it when the scan finishes",
            cfg.name
        )));
    }
    let command = validate_command(cfg.dev_command.as_deref().ok_or_else(|| {
        AppError::Validation(format!("{} has no dev command configured yet", cfg.name))
    })?)?;
    let dir = PathBuf::from(&cfg.root_path);
    if !dir.is_dir() {
        return Err(AppError::Validation(format!(
            "the project folder does not exist: {}",
            cfg.root_path
        )));
    }
    if let Some(pid) = listen_table_or_empty().await.get(&port) {
        return Err(AppError::Validation(format!(
            "port {port} is already in use by process {pid}; stop it before starting {}",
            cfg.name
        )));
    }

    reg.control().clear_failure(project_id);
    let spec = DevServerSpec::Shell(render_command(&command, port));
    let (r, id) = (reg.clone(), project_id.to_string());
    let spawned = blocking("spawn", move || r.spawn(&id, &dir, port, &spec)).await;
    if let Err(e) = spawned {
        // The row shows the failure until the next start or stop; the caller
        // also gets the error itself.
        reg.control()
            .fail(project_id, format!("could not start: {e}"));
        if let Err(pe) = publish(app, pool, reg).await {
            tracing::warn!(error = %pe, "server control: the failed start was not published");
        }
        return Err(e);
    }
    row_of(publish(app, pool, reg).await?, project_id)
}

/// `dev_server_stop`: kills our tree, or the external owner's tree when the
/// port is held by a process Personas did not start. Clears a failure either
/// way.
pub(crate) async fn stop(
    app: &AppHandle,
    pool: &DbPool,
    reg: &Arc<DevServerRegistry>,
    project_id: &str,
) -> Result<DevServerView, AppError> {
    let (cfg, port) = load_config(pool, project_id).await?;
    reg.control().clear_failure(project_id);
    let ours = reg.owned().contains_key(project_id);
    let target = if ours {
        None
    } else {
        listen_table_or_empty().await.get(&port).copied()
    };
    if !ours && target.is_none() {
        return row_of(publish(app, pool, reg).await?, project_id);
    }
    if target == Some(std::process::id()) {
        return Err(AppError::Validation(format!(
            "port {port} is held by Personas itself; it cannot be stopped from here"
        )));
    }

    reg.control().set_stopping(project_id, true);
    if let Err(e) = publish(app, pool, reg).await {
        tracing::warn!(error = %e, "server control: the stopping state was not published");
    }
    let (r, id) = (reg.clone(), project_id.to_string());
    let killed = blocking("stop", move || match target {
        None => r.stop(&id),
        Some(pid) => kill_tree(pid).map_err(|why| {
            AppError::Internal(format!(
                "could not stop process {pid} on port {port}: {why}"
            ))
        }),
    })
    .await;
    reg.control().set_stopping(project_id, false);
    let views = publish(app, pool, reg).await?;
    killed?;
    tracing::info!(project = %cfg.name, port, external = target.is_some(), "server control: server stopped");
    row_of(views, project_id)
}

/// How long a restart waits for the old server to release its port.
const RESTART_PORT_WAIT: Duration = Duration::from_secs(5);
/// How often that wait looks.
const RESTART_PORT_POLL: Duration = Duration::from_millis(250);

/// `dev_server_restart`: stop (ours or external), wait for the port to free,
/// start ours.
pub(crate) async fn restart(
    app: &AppHandle,
    pool: &DbPool,
    reg: &Arc<DevServerRegistry>,
    project_id: &str,
) -> Result<DevServerView, AppError> {
    let (_, port) = load_config(pool, project_id).await?;
    stop(app, pool, reg, project_id).await?;
    wait_for_port_release(port).await;
    start(app, pool, reg, project_id).await
}

/// Wait (bounded) until nothing listens on `port` any more: a killed server's
/// socket can outlive the kill by a moment, and the start that follows
/// refuses a port with a listener.
async fn wait_for_port_release(port: u16) {
    let deadline = Instant::now() + RESTART_PORT_WAIT;
    while listen_table_or_empty().await.contains_key(&port) && Instant::now() < deadline {
        tokio::time::sleep(RESTART_PORT_POLL).await;
    }
}

/// `dev_server_configure`: validate, refuse a port another project holds,
/// write, and auto-whitelist `http://localhost:<port>` so Open in Webview works.
pub(crate) async fn configure(
    app: &AppHandle,
    pool: &DbPool,
    reg: &Arc<DevServerRegistry>,
    project_id: &str,
    dev_command: Option<String>,
    dev_port: u16,
) -> Result<DevServerView, AppError> {
    if dev_port == 0 {
        return Err(AppError::Validation(
            "the port must be between 1 and 65535".into(),
        ));
    }
    let command = dev_command.as_deref().map(validate_command).transpose()?;
    let (p, id) = (pool.clone(), project_id.to_string());
    blocking("configure", move || {
        let cfg = repo::get_config(&p, &id)?
            .ok_or_else(|| AppError::NotFound(format!("Dev project {id}")))?;
        if let Some(holder) = repo::port_holder(&p, dev_port, &id)? {
            return Err(AppError::Validation(format!(
                "port {dev_port} is already configured for {holder}"
            )));
        }
        repo::set_config(&p, &id, command.as_deref(), dev_port)?;
        ensure_whitelisted(&p, &cfg.name, dev_port)
    })
    .await?;
    row_of(publish(app, pool, reg).await?, project_id)
}

/// Add `http://localhost:<port>` to the browser whitelist, enabled, unless a
/// row for it already exists (an existing row, paused or not, is the
/// operator's decision and is left alone).
fn ensure_whitelisted(pool: &DbPool, label: &str, port: u16) -> Result<(), AppError> {
    use crate::db::repos::browser::sites;
    let origin = format!("http://localhost:{port}");
    if sites::get(pool, &origin)?.is_some() {
        return Ok(());
    }
    sites::upsert(
        pool,
        personas_core::models::UpsertBrowserSiteInput {
            origin,
            label: Some(label.to_string()),
            enabled: Some(true),
            budget: None,
            created_by: Some("server-control".to_string()),
        },
    )?;
    Ok(())
}

/// `dev_server_remove`: take the project out of the view. Refused while its
/// server is live or a scan is running; the project itself is never deleted.
pub(crate) async fn remove(
    app: &AppHandle,
    pool: &DbPool,
    reg: &Arc<DevServerRegistry>,
    project_id: &str,
) -> Result<(), AppError> {
    let (cfg, _) = load_config(pool, project_id).await?;
    let current = row_of(compute_views(pool, reg).await?, project_id)?;
    if matches!(
        current.state,
        DevServerState::Running
            | DevServerState::Starting
            | DevServerState::External
            | DevServerState::Stopping
            | DevServerState::Scanning
    ) {
        return Err(AppError::Validation(format!(
            "{} is {}; stop it before removing it from server control",
            cfg.name,
            state_word(current.state)
        )));
    }
    let (p, id) = (pool.clone(), project_id.to_string());
    blocking("remove", move || repo::clear_port(&p, &id)).await?;
    reg.control().clear_failure(project_id);
    publish(app, pool, reg).await?;
    Ok(())
}

fn state_word(state: DevServerState) -> &'static str {
    match state {
        DevServerState::Unconfigured => "unconfigured",
        DevServerState::Stopped => "stopped",
        DevServerState::Scanning => "being scanned",
        DevServerState::Starting => "starting",
        DevServerState::Running => "running",
        DevServerState::Stopping => "stopping",
        DevServerState::External => "running outside Personas",
        DevServerState::Failed => "failed",
    }
}

/// `dev_server_add_app`: get-or-create the dev project for a folder, put it in
/// the view on a free port (keeping one it already has), and start the scan.
pub(crate) async fn add_app(
    app: &AppHandle,
    pool: &DbPool,
    reg: &Arc<DevServerRegistry>,
    root_path: &str,
    workspace_id: Option<String>,
) -> Result<DevServerView, AppError> {
    personas_core::validation::require_non_empty("root path", root_path)?;
    let root = normalize_root(root_path);
    if !Path::new(&root).is_dir() {
        return Err(AppError::Validation(format!("not a folder: {root}")));
    }
    let listening = listen_table_or_empty().await;
    let (p, r) = (pool.clone(), root.clone());
    let project_id = blocking("add app", move || {
        use crate::db::repos::dev::projects;
        let project = match projects::get_project_by_path(&p, &r)? {
            Some(project) => project,
            None => {
                let name = folder_name(&r);
                projects::create_project(&p, &name, &r, None, None, None, None, None)?
            }
        };
        if let Some(ws) = workspace_id.as_deref() {
            crate::db::repos::workspaces::org::assign_project(&p, &project.id, Some(ws))?;
        }
        let cfg = repo::get_config(&p, &project.id)?
            .ok_or_else(|| AppError::NotFound(format!("Dev project {}", project.id)))?;
        if cfg.dev_port.is_none() {
            let configured: HashSet<u16> = repo::configured_ports(&p)?.into_iter().collect();
            let port = ports::suggest_port(&configured, &listening).ok_or_else(|| {
                AppError::Validation("no free port at or above 3000 is left to suggest".into())
            })?;
            repo::set_port(&p, &project.id, port)?;
            ensure_whitelisted(&p, &project.name, port)?;
        }
        Ok(project.id)
    })
    .await?;

    spawn_scan(app, pool, reg, &project_id, &root);
    row_of(publish(app, pool, reg).await?, &project_id)
}

/// `dev_server_rescan`.
pub(crate) async fn rescan(
    app: &AppHandle,
    pool: &DbPool,
    reg: &Arc<DevServerRegistry>,
    project_id: &str,
) -> Result<DevServerView, AppError> {
    let (cfg, _) = load_config(pool, project_id).await?;
    if reg.control().is_scanning(project_id) {
        return Err(AppError::Validation(format!(
            "{} is already being scanned",
            cfg.name
        )));
    }
    if !Path::new(&cfg.root_path).is_dir() {
        return Err(AppError::Validation(format!(
            "the project folder does not exist: {}",
            cfg.root_path
        )));
    }
    spawn_scan(app, pool, reg, project_id, &cfg.root_path);
    row_of(publish(app, pool, reg).await?, project_id)
}

/// A root path as the project row should hold it: trimmed, without a trailing
/// separator (unless the separator IS the root, `C:\` or `/`).
fn normalize_root(raw: &str) -> String {
    let trimmed = raw.trim();
    let stripped = trimmed.trim_end_matches(['/', '\\']);
    if stripped.is_empty() || stripped.ends_with(':') {
        trimmed.to_string()
    } else {
        stripped.to_string()
    }
}

/// The project name for a folder: its last component.
fn folder_name(root: &str) -> String {
    Path::new(root)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .filter(|n| !n.trim().is_empty())
        .unwrap_or_else(|| root.to_string())
}

/// Start the scan for a project in the background. A scan already in flight
/// for it is left to finish (no second one). Every exit, including a panic,
/// ends in [`finish_scan`], so `scanning` can never stick.
fn spawn_scan(
    app: &AppHandle,
    pool: &DbPool,
    reg: &Arc<DevServerRegistry>,
    project_id: &str,
    root: &str,
) {
    if !reg.control().begin_scan(project_id) {
        return;
    }
    reg.control().clear_failure(project_id);
    let (a, p, r, id, dir) = (
        app.clone(),
        pool.clone(),
        reg.clone(),
        project_id.to_string(),
        PathBuf::from(root),
    );
    let (pa, pp, pr, pid) = (
        app.clone(),
        pool.clone(),
        reg.clone(),
        project_id.to_string(),
    );
    crate::background_job::spawn_guarded(
        "dev server scan",
        project_id.to_string(),
        async move {
            let outcome = scan::run(&p, &id, &dir).await;
            finish_scan(&a, &p, &r, &id, outcome).await;
        },
        move |msg| async move {
            finish_scan(
                &pa,
                &pp,
                &pr,
                &pid,
                Err(format!("the scan task panicked: {msg}")),
            )
            .await;
        },
    );
}

/// Land a scan's outcome: write what it found (the port only when free), or
/// record `scan failed: ...`; then end the scan and publish.
async fn finish_scan(
    app: &AppHandle,
    pool: &DbPool,
    reg: &Arc<DevServerRegistry>,
    project_id: &str,
    outcome: Result<scan::ScanFinding, String>,
) {
    let landed = match outcome {
        Ok(finding) => {
            let listening = listen_table_or_empty().await;
            let (p, id) = (pool.clone(), project_id.to_string());
            blocking("scan write", move || {
                apply_finding(&p, &id, finding, &listening)
            })
            .await
            .map_err(|e| e.to_string())
        }
        Err(reason) => Err(reason),
    };
    if let Err(reason) = landed {
        tracing::warn!(project_id, %reason, "server control: scan failed");
        reg.control()
            .fail(project_id, format!("scan failed: {reason}"));
    }
    reg.control().end_scan(project_id);
    if let Err(e) = publish(app, pool, reg).await {
        tracing::warn!(project_id, error = %e, "server control: the scan outcome was not published");
    }
}

/// Validate and write a scan finding. The port is written only when it is
/// free: not configured for another project and not listening.
fn apply_finding(
    pool: &DbPool,
    project_id: &str,
    finding: scan::ScanFinding,
    listening: &ports::ListenTable,
) -> Result<(), AppError> {
    let command = validate_command(&finding.dev_command)?;
    let port = match finding.port {
        Some(port)
            if port != 0
                && !listening.contains_key(&port)
                && repo::port_holder(pool, port, project_id)?.is_none() =>
        {
            Some(port)
        }
        _ => None,
    };
    let tech = finding.tech_stack.join(",");
    let tech = (!tech.is_empty()).then_some(tech);
    if !repo::apply_scan(pool, project_id, &command, tech.as_deref(), port)? {
        return Err(AppError::NotFound(format!("Dev project {project_id}")));
    }
    if let Some(port) = port {
        let name = repo::get_config(pool, project_id)?
            .map(|c| c.name)
            .unwrap_or_default();
        ensure_whitelisted(pool, &name, port)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests;
