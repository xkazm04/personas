//! Docker lifecycle for the managed Langfuse stack.
//!
//! Detection, presence probing, and the long-running compose operations
//! (`pull`, `up`, `down`) all shell out via `tokio::process::Command`. Two
//! things are load-bearing for the Windows experience:
//!
//! - **CREATE_NO_WINDOW.** On Windows, spawning `docker.exe` from a non-console
//!   parent normally opens a transient console window per spawn. With the
//!   polling cadence on `langfuse_stack_get_info` (every 4s while a job is in
//!   flight) plus the per-detect chain of `docker version` / `docker info` /
//!   `docker compose version`, that meant several cmd windows flashing per
//!   second. The `CREATE_NO_WINDOW` flag suppresses them; required at every
//!   `Command` construction site here.
//! - **kill_on_drop + cancellation.** The compose operations are long. Without
//!   cancellation, hitting Stop while a `compose pull` is in flight does
//!   nothing — the docker.exe subprocess keeps running and the start task
//!   completes whatever phase it was on. `pull` / `up` / `down` take a
//!   `CancellationToken` and `tokio::select!` between subprocess exit and
//!   token-fired; when the token fires the child is dropped, which (because
//!   we set `kill_on_drop(true)`) sends `TerminateProcess` to docker.exe.

use std::path::Path;
use std::time::Duration;
use tokio::process::Command;
use tokio_util::sync::CancellationToken;

use crate::error::AppError;
use crate::langfuse::templates::{COMPOSE_FILE, ENV_FILE, PROJECT_NAME};

/// `CREATE_NO_WINDOW` from windows headers — suppresses the console-window
/// popup when a non-console parent spawns a CLI executable. Mirrors what
/// Tauri itself does for tray-icon launches.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Build a `Command` with the per-platform niceties our docker calls need
/// (no console flash on Windows, kill-on-drop so cancellation actually
/// reaches the child process).
fn make_command(program: &str) -> Command {
    let mut cmd = Command::new(program);
    cmd.kill_on_drop(true);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// What we know about the Docker installation on this machine.
#[derive(Debug, Clone)]
pub struct DockerInfo {
    pub installed: bool,
    pub running: bool,
    pub version: Option<String>,
    /// The compose subcommand to use, e.g. `["docker", "compose"]` or
    /// `["docker-compose"]`. None when no compose CLI is available.
    pub compose_cmd: Option<Vec<String>>,
}

/// Probe the local Docker installation. Never fails — missing tools are
/// reflected in the returned struct so the frontend can render the right
/// preflight message.
pub async fn detect() -> DockerInfo {
    let version = match run_silent("docker", &["version", "--format", "{{.Client.Version}}"]).await
    {
        Ok((true, stdout, _)) => Some(stdout.trim().to_string()).filter(|s| !s.is_empty()),
        _ => None,
    };

    if version.is_none() {
        return DockerInfo {
            installed: false,
            running: false,
            version: None,
            compose_cmd: None,
        };
    }

    // `docker info` exits non-zero when the daemon is unreachable, even if the
    // CLI itself is present.
    let running = matches!(
        run_silent("docker", &["info", "--format", "{{.ServerVersion}}"]).await,
        Ok((true, _, _))
    );

    let compose_cmd = if matches!(
        run_silent("docker", &["compose", "version"]).await,
        Ok((true, _, _))
    ) {
        Some(vec!["docker".to_string(), "compose".to_string()])
    } else if matches!(
        run_silent("docker-compose", &["version"]).await,
        Ok((true, _, _))
    ) {
        Some(vec!["docker-compose".to_string()])
    } else {
        None
    };

    DockerInfo {
        installed: true,
        running,
        version,
        compose_cmd,
    }
}

/// Stack-state summary derived from `docker compose ps`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StackPresence {
    /// Compose reports no containers for the project (or compose can't be invoked).
    Absent,
    /// At least one container exists but `langfuse-web` is not running.
    Partial,
    /// `langfuse-web` is running. Whether it's actually serving HTTP is a
    /// separate question — see [`probe_health`].
    Running,
}

/// Inspect the current state of the stack via `compose ps`.
pub async fn presence(stack_dir: &Path, compose_cmd: &[String]) -> Result<StackPresence, AppError> {
    let compose = stack_dir.join(COMPOSE_FILE);
    let env = stack_dir.join(ENV_FILE);
    if !compose.is_file() {
        return Ok(StackPresence::Absent);
    }

    let mut args: Vec<String> = compose_cmd[1..].iter().cloned().collect();
    args.extend([
        "--project-name".into(),
        PROJECT_NAME.into(),
        "--file".into(),
        compose.to_string_lossy().into_owned(),
        "--env-file".into(),
        env.to_string_lossy().into_owned(),
        "ps".into(),
        "--format".into(),
        "json".into(),
    ]);

    let (ok, stdout, stderr) = run_silent(&compose_cmd[0], &args_as_str(&args)).await?;
    if !ok {
        return Err(AppError::Langfuse(format!(
            "compose ps failed: {}",
            stderr.lines().next().unwrap_or("(no stderr)")
        )));
    }

    let mut any = false;
    let mut web_running = false;
    for line in stdout.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        any = true;
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(line) {
            let service = v.get("Service").and_then(|s| s.as_str()).unwrap_or("");
            let state = v.get("State").and_then(|s| s.as_str()).unwrap_or("");
            if service == "langfuse-web" && state == "running" {
                web_running = true;
            }
        }
    }

    Ok(if web_running {
        StackPresence::Running
    } else if any {
        StackPresence::Partial
    } else {
        StackPresence::Absent
    })
}

/// Run `compose pull` to fetch images. Cheap on subsequent runs (cache hit).
/// Cancellable — when `cancel` fires, the docker.exe subprocess is killed
/// via `kill_on_drop` and this function returns `AppError::Langfuse("Cancelled")`.
pub async fn pull(
    stack_dir: &Path,
    compose_cmd: &[String],
    cancel: CancellationToken,
) -> Result<(), AppError> {
    let compose = stack_dir.join(COMPOSE_FILE);
    let env = stack_dir.join(ENV_FILE);

    let mut args: Vec<String> = compose_cmd[1..].iter().cloned().collect();
    args.extend([
        "--project-name".into(),
        PROJECT_NAME.into(),
        "--file".into(),
        compose.to_string_lossy().into_owned(),
        "--env-file".into(),
        env.to_string_lossy().into_owned(),
        "pull".into(),
    ]);

    let (ok, _stdout, stderr) =
        run_cancellable(&compose_cmd[0], &args_as_str(&args), &cancel).await?;
    if !ok {
        return Err(AppError::Langfuse(format!(
            "compose pull failed: {}",
            stderr.lines().last().unwrap_or("(no stderr)")
        )));
    }
    Ok(())
}

/// Run `compose up -d`. Returns when the subprocess exits — does NOT wait
/// for Langfuse to be reachable on HTTP. Pair with [`probe_health`].
pub async fn up(
    stack_dir: &Path,
    compose_cmd: &[String],
    cancel: CancellationToken,
) -> Result<(), AppError> {
    let compose = stack_dir.join(COMPOSE_FILE);
    let env = stack_dir.join(ENV_FILE);

    let mut args: Vec<String> = compose_cmd[1..].iter().cloned().collect();
    args.extend([
        "--project-name".into(),
        PROJECT_NAME.into(),
        "--file".into(),
        compose.to_string_lossy().into_owned(),
        "--env-file".into(),
        env.to_string_lossy().into_owned(),
        "up".into(),
        "-d".into(),
    ]);

    let (ok, _stdout, stderr) =
        run_cancellable(&compose_cmd[0], &args_as_str(&args), &cancel).await?;
    if !ok {
        return Err(AppError::Langfuse(format!(
            "compose up failed: {}",
            stderr.lines().last().unwrap_or("(no stderr)")
        )));
    }
    Ok(())
}

/// Run `compose down` (preserves named volumes — user data survives).
/// Set `wipe_volumes` to also delete the volumes (`down -v`); this is the
/// "reset all data" path that nukes Postgres / ClickHouse / MinIO contents.
///
/// Not cancellable — `down` is the cancellation path; cancelling itself
/// would defeat the purpose.
pub async fn down(
    stack_dir: &Path,
    compose_cmd: &[String],
    wipe_volumes: bool,
) -> Result<(), AppError> {
    let compose = stack_dir.join(COMPOSE_FILE);
    let env = stack_dir.join(ENV_FILE);

    let mut args: Vec<String> = compose_cmd[1..].iter().cloned().collect();
    args.extend([
        "--project-name".into(),
        PROJECT_NAME.into(),
        "--file".into(),
        compose.to_string_lossy().into_owned(),
        "--env-file".into(),
        env.to_string_lossy().into_owned(),
        "down".into(),
    ]);
    if wipe_volumes {
        args.push("-v".into());
    }

    let (ok, _stdout, stderr) = run_silent(&compose_cmd[0], &args_as_str(&args)).await?;
    if !ok {
        return Err(AppError::Langfuse(format!(
            "compose down failed: {}",
            stderr.lines().last().unwrap_or("(no stderr)")
        )));
    }
    Ok(())
}

/// One-shot health probe with a short timeout. Used by `get_info` so the
/// initial render of the plugin page doesn't block on a long retry loop.
pub async fn quick_health(host: &str) -> bool {
    let url = format!("{}/api/public/health", host.trim_end_matches('/'));
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
    {
        Ok(c) => c,
        Err(_) => return false,
    };
    matches!(
        client.get(&url).send().await,
        Ok(r) if r.status().is_success()
    )
}

/// Poll `<host>/api/public/health` until it returns 2xx or `deadline_secs`
/// elapses. Cancellable — `cancel.cancelled()` short-circuits the loop with
/// an `AppError::Langfuse("Cancelled")`.
pub async fn probe_health(
    host: &str,
    deadline_secs: u64,
    cancel: CancellationToken,
) -> Result<(), AppError> {
    let url = format!("{}/api/public/health", host.trim_end_matches('/'));
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .map_err(|e| AppError::Langfuse(format!("HTTP client build failed: {e}")))?;

    let start = std::time::Instant::now();
    let max = Duration::from_secs(deadline_secs);
    loop {
        if cancel.is_cancelled() {
            return Err(AppError::Langfuse("Cancelled".into()));
        }
        tokio::select! {
            biased;
            _ = cancel.cancelled() => {
                return Err(AppError::Langfuse("Cancelled".into()));
            }
            resp = client.get(&url).send() => {
                if let Ok(r) = resp {
                    if r.status().is_success() {
                        return Ok(());
                    }
                }
            }
        }
        if start.elapsed() >= max {
            return Err(AppError::Langfuse(format!(
                "Langfuse did not become reachable at {url} within {deadline_secs}s"
            )));
        }
        tokio::select! {
            biased;
            _ = cancel.cancelled() => {
                return Err(AppError::Langfuse("Cancelled".into()));
            }
            _ = tokio::time::sleep(Duration::from_secs(2)) => {}
        }
    }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

fn args_as_str(args: &[String]) -> Vec<&str> {
    args.iter().map(|s| s.as_str()).collect()
}

/// Spawn a process, capture stdout+stderr, return (success, stdout, stderr).
/// `Err` is reserved for cases where the binary couldn't be invoked at all
/// (e.g. not on PATH); a non-zero exit is `Ok((false, ...))`.
///
/// Not cancellable — for short-lived calls (detect, presence, down) where
/// cancellation isn't useful.
async fn run_silent(program: &str, args: &[&str]) -> Result<(bool, String, String), AppError> {
    let output = make_command(program)
        .args(args)
        .output()
        .await
        .map_err(|e| AppError::Langfuse(format!("Failed to run {program}: {e}")))?;

    Ok((
        output.status.success(),
        String::from_utf8_lossy(&output.stdout).to_string(),
        String::from_utf8_lossy(&output.stderr).to_string(),
    ))
}

/// Like [`run_silent`], but cancellable. When `cancel` fires before the
/// subprocess exits, the child is dropped — `kill_on_drop(true)` then sends
/// `TerminateProcess` (Windows) / `SIGKILL` (Unix) to the docker.exe child.
///
/// Note: the docker CLI is a thin client that talks to dockerd over the
/// platform socket; killing the CLI stops *us* waiting on the operation,
/// but the daemon may keep doing whatever it was doing (e.g. finishing an
/// in-flight image layer). That's fine for our purposes — the next start
/// reuses anything the daemon already pulled.
async fn run_cancellable(
    program: &str,
    args: &[&str],
    cancel: &CancellationToken,
) -> Result<(bool, String, String), AppError> {
    let mut cmd = make_command(program);
    cmd.args(args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    let child = cmd
        .spawn()
        .map_err(|e| AppError::Langfuse(format!("Failed to spawn {program}: {e}")))?;

    let pid = child.id();

    tokio::select! {
        biased;
        _ = cancel.cancelled() => {
            // `child` was moved into the `wait_with_output()` future on
            // the other arm of the select. When this arm wins, that
            // future is dropped, which drops `child`, which (because
            // we set kill_on_drop(true)) sends TerminateProcess to the
            // docker.exe subprocess. No explicit kill needed.
            tracing::info!(program, ?pid, "Cancelling docker subprocess");
            Err(AppError::Langfuse("Cancelled".into()))
        }
        output = child.wait_with_output() => {
            let output = output
                .map_err(|e| AppError::Langfuse(format!("{program} wait failed: {e}")))?;
            Ok((
                output.status.success(),
                String::from_utf8_lossy(&output.stdout).to_string(),
                String::from_utf8_lossy(&output.stderr).to_string(),
            ))
        }
    }
}
