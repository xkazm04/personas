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
            "Bun runtime not found. Install Bun (https://bun.sh) or set PERSONAS_BUN_BIN."
                .into(),
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
    let mut cmd = tokio::process::Command::new(&bun);
    cmd.args(args)
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    hide_window(&mut cmd);

    let child = cmd
        .spawn()
        .map_err(|e| AppError::Internal(format!("spawn bun {args:?}: {e}")))?;
    let output = tokio::time::timeout(timeout, child.wait_with_output())
        .await
        .map_err(|_| AppError::Internal(format!("bun {args:?} timed out after {timeout:?}")))?
        .map_err(|e| AppError::Internal(format!("bun wait: {e}")))?;

    Ok(BunOutput {
        success: output.status.success(),
        stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
    })
}

/// Hide the console window on Windows for a spawned bun process (same rationale
/// as the Whisper/Piper sidecars — no flashing conhost). Shared by the one-shot
/// runner and the dev-server spawn so behaviour is identical.
pub(crate) fn hide_window(cmd: &mut tokio::process::Command) {
    #[cfg(windows)]
    {
        // `creation_flags` is an inherent method on tokio's Command (no
        // `CommandExt` import needed, unlike std::process::Command).
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    {
        let _ = cmd;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_bun_honors_missing_override_gracefully() {
        // A non-existent override path must not resolve to it; it falls through
        // to PATH (which may or may not have bun in the test env — we only
        // assert the override file-check doesn't panic and a bad path is ignored).
        let bogus = if cfg!(windows) { "Z:\\no\\such\\bun.exe" } else { "/no/such/bun" };
        std::env::set_var("PERSONAS_BUN_BIN", bogus);
        let resolved = resolve_bun();
        std::env::remove_var("PERSONAS_BUN_BIN");
        // Either PATH has bun (Ok, but never the bogus override) or it errors.
        if let Ok(p) = resolved {
            assert_ne!(p, PathBuf::from(bogus));
        }
    }
}
