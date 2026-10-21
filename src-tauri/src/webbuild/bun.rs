//! Locating and invoking the Bun runtime sidecar.
//!
//! Bun is the single binary the web-build runtime shells out to for scaffold
//! (`bun x create-next-app`), dependency install, production build, and the
//! long-lived dev server (see [`super::devserver`]). Resolution mirrors the
//! Whisper-STT convention: an env override first, then PATH.

use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;

use crate::error::AppError;

#[cfg(target_os = "windows")]
const BUN_CANDIDATES: &[&str] = &["bun.exe", "bun"];
#[cfg(not(target_os = "windows"))]
const BUN_CANDIDATES: &[&str] = &["bun"];

/// Resolve the Bun binary: `PERSONAS_BUN_BIN` override → PATH lookup.
pub fn resolve_bun() -> Result<PathBuf, AppError> {
    if let Ok(p) = std::env::var("PERSONAS_BUN_BIN") {
        let candidate = PathBuf::from(p);
        if candidate.is_file() {
            return Ok(candidate);
        }
    }
    path_lookup().ok_or_else(|| {
        AppError::Validation(
            "Bun runtime not found. Install Bun (https://bun.sh) or set PERSONAS_BUN_BIN.".into(),
        )
    })
}

#[cfg(feature = "desktop")]
fn path_lookup() -> Option<PathBuf> {
    for name in BUN_CANDIDATES {
        if let Ok(p) = which::which(name) {
            return Some(p);
        }
    }
    None
}

#[cfg(not(feature = "desktop"))]
fn path_lookup() -> Option<PathBuf> {
    None
}

/// Captured result of a one-shot bun invocation.
pub struct BunOutput {
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
}

/// Run a one-shot `bun <args>` in `cwd`, capturing output, bounded by
/// `timeout`. For scaffold / install / build — NOT for the long-lived dev
/// server (that lives in [`super::devserver`]).
pub async fn run(
    args: &[&str],
    cwd: &std::path::Path,
    timeout: Duration,
) -> Result<BunOutput, AppError> {
    let bun = resolve_bun()?;
    run_binary(&bun, args, cwd, timeout).await
}

/// `run` against an explicit binary (the seam the timeout test drives).
async fn run_binary(
    bun: &std::path::Path,
    args: &[&str],
    cwd: &std::path::Path,
    timeout: Duration,
) -> Result<BunOutput, AppError> {
    let mut cmd = tokio::process::Command::new(bun);
    cmd.args(args)
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    hide_window(&mut cmd);
    // A timed-out build must stop, not detach and keep compiling. kill_on_drop
    // reaches only the direct child, so `bun x create-next-app` would leave its
    // own install child writing into the half-made project; the timeout arm
    // below kills the whole tree, and on Unix the child leads its own group so
    // `kill_tree`'s group signal has something to reach.
    cmd.kill_on_drop(true);
    #[cfg(unix)]
    cmd.process_group(0);

    let mut child = cmd
        .spawn()
        .map_err(|e| AppError::Internal(format!("spawn bun {args:?}: {e}")))?;
    let pid = child.id();
    // The child stays OWNED here (not moved into `wait_with_output`) so that on
    // timeout it is still alive when the tree kill runs: dropping it first would
    // kill the root and sever the parent links `taskkill /T` walks.
    let mut stdout_pipe = child.stdout.take();
    let mut stderr_pipe = child.stderr.take();
    let collect = async {
        let (out, err, status) = tokio::join!(
            read_pipe(stdout_pipe.as_mut()),
            read_pipe(stderr_pipe.as_mut()),
            child.wait()
        );
        status.map(|status| (status, out, err))
    };
    let (status, stdout, stderr) = match tokio::time::timeout(timeout, collect).await {
        Ok(waited) => waited.map_err(|e| AppError::Internal(format!("bun wait: {e}")))?,
        Err(_) => {
            if let Some(pid) = pid {
                kill_tree_blocking(pid).await;
            }
            return Err(AppError::Internal(format!(
                "bun {args:?} timed out after {timeout:?}"
            )));
        }
    };

    Ok(BunOutput {
        success: status.success(),
        stdout: String::from_utf8_lossy(&stdout).into_owned(),
        stderr: String::from_utf8_lossy(&stderr).into_owned(),
    })
}

async fn read_pipe<R: tokio::io::AsyncRead + Unpin>(pipe: Option<&mut R>) -> Vec<u8> {
    use tokio::io::AsyncReadExt;
    let mut buf = Vec::new();
    if let Some(pipe) = pipe {
        // A read error ends the capture; the exit status is the real outcome.
        let _ = pipe.read_to_end(&mut buf).await;
    }
    buf
}

/// Kill a timed-out run's whole process tree off the async worker (the kill
/// command is a blocking subprocess). A failed kill is logged, never fatal: the
/// timeout error the caller gets is the real outcome.
async fn kill_tree_blocking(pid: u32) {
    match tokio::task::spawn_blocking(move || super::devserver::kill_tree(pid)).await {
        Ok(Ok(())) => {}
        Ok(Err(e)) => tracing::warn!(pid, error = %e, "bun timeout: tree kill failed"),
        Err(e) => tracing::warn!(pid, error = %e, "bun timeout: tree kill task did not finish"),
    }
}

/// Hide the console window on Windows for a spawned bun process (same rationale
/// as the Whisper/Piper sidecars — no flashing conhost). Shared by the one-shot
/// runner and the dev-server spawn so behaviour is identical.
pub(crate) fn hide_window(cmd: &mut tokio::process::Command) {
    use personas_core::utils::process::NoWindow;
    cmd.no_window();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(windows)]
    #[tokio::test]
    async fn timeout_kills_the_grandchildren_too() {
        // The fake "bun" starts a detached grandchild that writes a marker file
        // 3 s later, then idles. A root-only kill leaves the grandchild to write it.
        let dir = tempfile::tempdir().unwrap();
        let marker = dir.path().join("marker.txt");
        let script = dir.path().join("fakebun.cmd");
        std::fs::write(
            &script,
            format!(
                "@echo off
start /b cmd /c \"ping -n 4 127.0.0.1 >nul & echo x> \"{}\"\"
ping -n 30 127.0.0.1 >nul
",
                marker.display()
            ),
        )
        .unwrap();
        let res = run_binary(&script, &[], dir.path(), Duration::from_millis(1000)).await;
        assert!(res.is_err(), "run must time out");
        tokio::time::sleep(Duration::from_secs(6)).await;
        assert!(
            !marker.exists(),
            "grandchild survived the timeout and kept writing"
        );
    }

    #[test]
    fn resolve_bun_honors_missing_override_gracefully() {
        // A non-existent override path must not resolve to it; it falls through
        // to PATH (which may or may not have bun in the test env — we only
        // assert the override file-check doesn't panic and a bad path is ignored).
        let bogus = if cfg!(windows) {
            "Z:\\no\\such\\bun.exe"
        } else {
            "/no/such/bun"
        };
        std::env::set_var("PERSONAS_BUN_BIN", bogus);
        let resolved = resolve_bun();
        std::env::remove_var("PERSONAS_BUN_BIN");
        // Either PATH has bun (Ok, but never the bogus override) or it errors.
        if let Ok(p) = resolved {
            assert_ne!(p, PathBuf::from(bogus));
        }
    }
}
