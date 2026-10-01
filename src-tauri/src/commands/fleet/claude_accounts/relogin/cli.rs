//! The `claude auth login` child of a re-login run.
//!
//! The CLI is given an isolated `CLAUDE_CONFIG_DIR` (so the live `~/.claude`
//! login is never read or written) and a `BROWSER` shim that, instead of
//! opening the system browser, writes the authorize URL it was handed to a file
//! in that directory. The account's Chrome profile is then pointed at that URL,
//! and the CLI completes on its own `localhost` callback listener.
//!
//! The authorize URL carries OAuth state and a PKCE challenge: it is held in
//! memory only, never logged, never placed in an event, error or audit row.

use std::path::{Path, PathBuf};
use std::time::Duration;

use personas_core::types::CliArgs;
use tokio::task::JoinHandle;
use tokio::time::{sleep, Instant};

use crate::engine::cli_process::{self, CliProcessDriver};
use crate::engine::login_lane::LaneError;

use super::ReloginReason;

const URL_FILE: &str = "url.txt";
const POLL: Duration = Duration::from_millis(100);

/// The claude program and the arguments that precede its own.
#[derive(Debug, Clone)]
pub struct ClaudeCli {
    pub program: String,
    pub leading: Vec<String>,
}

impl ClaudeCli {
    /// The same resolution every other CLI spawn in the app uses.
    pub fn resolve() -> Self {
        let (program, leading) = cli_process::claude_cli_invocation();
        Self { program, leading }
    }
}

fn fail(reason: ReloginReason, detail: &str) -> LaneError {
    LaneError::new(reason, detail)
}

/// Write the `BROWSER` shim into `dir` and return its path. The shim receives
/// the URL as its single argument and writes it to `url.txt` beside itself.
pub fn write_browser_shim(dir: &Path) -> Result<PathBuf, LaneError> {
    let out = dir.join(URL_FILE);
    #[cfg(windows)]
    let (path, body) = (
        dir.join("open-url.cmd"),
        format!("@echo %* > \"{}\"\r\n", out.display()),
    );
    #[cfg(not(windows))]
    let (path, body) = (
        dir.join("open-url.sh"),
        format!("#!/bin/sh\nprintf '%s' \"$1\" > '{}'\n", out.display()),
    );
    std::fs::write(&path, body).map_err(|_| fail(ReloginReason::Other, "write url shim"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700))
            .map_err(|_| fail(ReloginReason::Other, "chmod url shim"))?;
    }
    Ok(path)
}

/// A running `claude auth login`. Dropping it kills the process.
pub struct LoginProcess {
    driver: CliProcessDriver,
    drain: Option<JoinHandle<()>>,
}

impl Drop for LoginProcess {
    fn drop(&mut self) {
        if let Some(h) = self.drain.take() {
            h.abort();
        }
    }
}

/// Spawn `claude auth login --email <email>` through the CLI chokepoint with
/// the isolated config dir and the URL shim.
pub fn spawn_login(
    cli: &ClaudeCli,
    email: &str,
    config_dir: &Path,
    shim: &Path,
) -> Result<LoginProcess, LaneError> {
    let mut args = cli.leading.clone();
    args.extend(["auth", "login", "--email", email].map(str::to_string));
    let cli_args = CliArgs {
        command: cli.program.clone(),
        args,
        env_overrides: vec![
            (
                "CLAUDE_CONFIG_DIR".to_string(),
                config_dir.display().to_string(),
            ),
            ("BROWSER".to_string(), shim.display().to_string()),
        ],
        env_removals: crate::commands::fleet::pty::CLAUDE_NESTING_ENV
            .iter()
            .map(|s| s.to_string())
            .collect(),
        cwd: None,
    };
    let mut driver = CliProcessDriver::spawn(&cli_args, config_dir.to_path_buf()).map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            fail(ReloginReason::CliFailed, "claude CLI not found")
        } else {
            fail(ReloginReason::CliFailed, "claude CLI did not start")
        }
    })?;
    // Nothing is ever typed to the CLI; and stdout is read away so a chatty
    // child cannot block on a full pipe. The reader is aborted on drop.
    let drain = driver.take_stdout_reader().map(|mut r| {
        tokio::spawn(async move {
            let mut sink = tokio::io::sink();
            let _ = tokio::io::copy(&mut r, &mut sink).await;
        })
    });
    Ok(LoginProcess { driver, drain })
}

impl LoginProcess {
    /// `Some(success)` once the child has exited.
    pub fn try_exit(&mut self) -> Option<bool> {
        match self.driver.child.try_wait() {
            Ok(Some(status)) => Some(status.success()),
            Ok(None) => None,
            Err(_) => Some(false),
        }
    }

    /// Wait up to `within` for the child to exit. `None` = still running.
    pub async fn wait_exit(&mut self, within: Duration) -> Option<bool> {
        let end = Instant::now() + within;
        loop {
            if let Some(ok) = self.try_exit() {
                return Some(ok);
            }
            if Instant::now() >= end {
                return None;
            }
            sleep(POLL).await;
        }
    }

    pub async fn kill(&mut self) {
        self.driver.kill().await;
    }
}

/// Wait for the shim to hand over the authorize URL.
pub async fn wait_for_url(
    dir: &Path,
    proc: &mut LoginProcess,
    within: Duration,
) -> Result<String, LaneError> {
    let file = dir.join(URL_FILE);
    let end = Instant::now() + within;
    loop {
        if let Ok(raw) = std::fs::read_to_string(&file) {
            let url = raw.trim().trim_matches('"').to_string();
            if url::Url::parse(&url).is_ok() {
                return Ok(url);
            }
        }
        if proc.try_exit() == Some(false) {
            return Err(fail(ReloginReason::CliFailed, "claude CLI exited early"));
        }
        if Instant::now() >= end {
            return Err(fail(
                ReloginReason::Timeout,
                "no authorize URL from the CLI",
            ));
        }
        sleep(POLL).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shim_is_written_beside_the_url_file() {
        let dir = tempfile::tempdir().expect("tempdir");
        let shim = write_browser_shim(dir.path()).expect("shim");
        assert!(shim.exists());
        let body = std::fs::read_to_string(&shim).expect("read shim");
        assert!(body.contains(URL_FILE), "shim names the url file: {body}");
    }
}
