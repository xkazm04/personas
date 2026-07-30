//! External-console dispatch — hand a prepared prompt to a Claude session
//! running in a terminal window the USER owns, instead of an in-app PTY.
//!
//! The third transport alongside Fleet (in-app xterm, app-managed lifecycle)
//! and the headless runner. It exists for work that is *conversational by
//! nature*: the operator answers the session's questions for many turns, keeps
//! it open across app restarts, and wants it in their own terminal with their
//! own scrollback. The first consumer is the passport's "Populate project data"
//! action, whose KPI-triage phase is a long interactive negotiation.
//!
//! **The app does not own the result.** Once spawned, the console is a normal
//! detached process: Fleet cannot observe, steer, hibernate or kill it, and
//! closing Personas leaves it running. That is the point — but it also means
//! this path must not be used for anything the app later needs to reconcile.
//!
//! ## Why a bare `CREATE_NEW_CONSOLE` and not `wt.exe` / `cmd /K`
//!
//! Wrapping the invocation in a shell re-parses the command line, and the
//! prompt is prose: `wt.exe` splits on `;` (pane syntax), `cmd.exe` expands
//! `%VAR%` and reserves `&`, `|`, `<`, `>`, `^`. Any of those inside a prompt
//! silently truncates or mangles it. Spawning `claude.exe` DIRECTLY with
//! `CREATE_NEW_CONSOLE` skips every shell: Rust applies standard
//! `CommandLineToArgvW` quoting, which `claude.exe` parses back verbatim, and
//! Windows still gives the child a fresh visible console. On Windows 11 that
//! console honors the user's default-terminal setting, so operators running
//! Windows Terminal get a WT tab for free without us naming it.
//!
//! The long content a session needs travels as a file rather than an argument:
//! [`fleet_write_dispatch_brief`] drops it under the repo and the prompt just
//! points at that path. That sidesteps the ~32 KB command-line ceiling, and —
//! more importantly for a window the app cannot reopen — it means the operator
//! can re-run the session by hand after closing it. Brief-writing is a separate
//! command from the spawn so a caller can hand the same short prompt to EITHER
//! transport, rather than composing one prompt for Fleet and another here.

use std::path::{Component, PathBuf};
use std::sync::Arc;

use tauri::State;

use crate::error::AppError;
use crate::ipc_auth::require_auth;
use crate::AppState;

use super::pty::CLAUDE_NESTING_ENV;

/// Resolve `relative` against `root`, refusing anything that escapes it.
///
/// `brief_path` crosses the IPC boundary from the frontend, so a `..` segment
/// or an absolute path would otherwise let a renderer bug (or a compromised
/// one) write anywhere the app can reach. Rejecting the components outright is
/// stricter than canonicalizing — the target file does not exist yet, so there
/// is nothing to canonicalize against.
fn resolve_inside(root: &std::path::Path, relative: &str) -> Result<PathBuf, AppError> {
    let rel = PathBuf::from(relative);
    for component in rel.components() {
        match component {
            Component::Normal(_) => {}
            _ => {
                return Err(AppError::Validation(format!(
                    "brief path must be a plain relative path inside the project, got {relative:?}"
                )))
            }
        }
    }
    if rel.as_os_str().is_empty() {
        return Err(AppError::Validation("brief path must not be empty".into()));
    }
    Ok(root.join(rel))
}

/// Write a dispatch brief into a repo, returning its absolute path.
///
/// Separate from the spawn so a caller can prepare the repo once and then hand
/// the SAME short prompt to whichever transport the user picks. `path` is
/// relative to `cwd` and may not escape it.
#[tauri::command]
pub async fn fleet_write_dispatch_brief(
    state: State<'_, Arc<AppState>>,
    cwd: String,
    path: String,
    contents: String,
) -> Result<String, AppError> {
    require_auth(&state).await?;

    let root = PathBuf::from(&cwd);
    if !root.is_dir() {
        return Err(AppError::Validation(format!(
            "project root is not a directory: {cwd}"
        )));
    }
    let target = resolve_inside(&root, &path)?;
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|e| {
            AppError::Internal(format!("failed to create {}: {e}", parent.display()))
        })?;
    }
    std::fs::write(&target, contents)
        .map_err(|e| AppError::Internal(format!("failed to write {}: {e}", target.display())))?;
    Ok(target.display().to_string())
}

/// Spawn an interactive Claude session in a new, user-owned console window.
///
/// `prompt` is passed as the positional argument (the same seed a Fleet
/// session gets), so the session opens mid-conversation and the operator
/// continues it by hand from the second turn on.
///
/// `skip_permissions` mirrors the `--dangerously-skip-permissions` flag Fleet
/// sessions always carry. It is a parameter rather than a constant because the
/// trade-off genuinely differs here: a Fleet session runs unattended, so
/// permission prompts would just freeze it, whereas an external console has
/// the operator sitting in front of it AND is outside the app's kill switch.
/// Callers that dispatch a skill doing broad repo work pass `true` to match
/// the Fleet experience; anything narrower should leave it `false`.
///
/// Returns the console's OS process id — informational only, since the app
/// keeps no handle and will not reap it.
#[tauri::command]
pub async fn fleet_spawn_external_console(
    state: State<'_, Arc<AppState>>,
    cwd: String,
    prompt: String,
    skip_permissions: Option<bool>,
) -> Result<u32, AppError> {
    require_auth(&state).await?;

    let root = PathBuf::from(&cwd);
    if !root.is_dir() {
        return Err(AppError::Validation(format!(
            "project root is not a directory: {cwd}"
        )));
    }
    if prompt.trim().is_empty() {
        return Err(AppError::Validation("prompt must not be empty".into()));
    }

    let pid = spawn_console(&root, &prompt, skip_permissions.unwrap_or(false))?;
    tracing::info!(pid, cwd = %cwd, "external console session launched");
    Ok(pid)
}

#[cfg(windows)]
fn spawn_console(
    root: &std::path::Path,
    prompt: &str,
    skip_permissions: bool,
) -> Result<u32, AppError> {
    use std::os::windows::process::CommandExt;

    /// Give the child its own console window rather than inheriting ours
    /// (a Tauri GUI process has none) or detaching without one.
    const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;

    let (program, leading) = crate::engine::cli_process::claude_cli_invocation();
    let mut cmd = std::process::Command::new(&program);

    if program.eq_ignore_ascii_case("cmd") {
        // Legacy fallback path: `claude.exe` was not found and the resolver
        // handed back `cmd /C claude.cmd`. `/C` would close the window the
        // moment the session ended (and, worse, before the operator could read
        // a spawn error), so swap it for `/K`.
        cmd.args(leading.iter().map(|a| if a == "/C" { "/K" } else { a }));
    } else {
        cmd.args(&leading);
    }

    if skip_permissions {
        cmd.arg("--dangerously-skip-permissions");
    }
    cmd.arg(prompt);
    cmd.current_dir(root);
    cmd.creation_flags(CREATE_NEW_CONSOLE);

    // Same env contract as every other Claude spawn in the app.
    cmd.env("CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC", "1");
    // Strip inherited API-account auth so the session bills the subscription
    // (see `cli_process::CLI_SUBSCRIPTION_RESERVED_ENV`).
    for &key in crate::engine::cli_process::CLI_SUBSCRIPTION_RESERVED_ENV {
        cmd.env_remove(key);
    }
    // Strip Claude Code NESTING markers — without this the session registers
    // as a child of whatever Claude session launched Personas and never
    // persists a transcript (see `pty::CLAUDE_NESTING_ENV`).
    for &key in CLAUDE_NESTING_ENV {
        cmd.env_remove(key);
    }

    // The handle is dropped immediately: this process is the operator's, not
    // ours. `std::process::Command` does not kill on drop, so it survives.
    let child = cmd.spawn().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            AppError::Internal(
                "Claude CLI not found. Install from https://docs.anthropic.com/en/docs/claude-code"
                    .into(),
            )
        } else {
            AppError::Internal(format!("failed to open a console for Claude: {e}"))
        }
    })?;
    Ok(child.id())
}

#[cfg(not(windows))]
fn spawn_console(
    _root: &std::path::Path,
    _prompt: &str,
    _skip_permissions: bool,
) -> Result<u32, AppError> {
    // Every terminal emulator takes a different "run this command" flag and
    // guessing wrong fails silently at the shell layer, so rather than ship an
    // untested guess this path says so and the UI offers Fleet instead.
    Err(AppError::Validation(
        "External console dispatch is Windows-only today. Use the Fleet transport, \
         or run the command yourself in a terminal."
            .into(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_inside_accepts_a_nested_relative_path() {
        let root = std::path::Path::new("C:/repo");
        let got = resolve_inside(root, "project-populate/brief.md").unwrap();
        assert_eq!(got, root.join("project-populate/brief.md"));
    }

    #[test]
    fn resolve_inside_rejects_parent_escapes() {
        let root = std::path::Path::new("C:/repo");
        assert!(resolve_inside(root, "../outside.md").is_err());
        assert!(resolve_inside(root, "nested/../../outside.md").is_err());
    }

    #[test]
    fn resolve_inside_rejects_absolute_paths() {
        let root = std::path::Path::new("C:/repo");
        assert!(resolve_inside(root, "/etc/passwd").is_err());
        assert!(resolve_inside(root, "").is_err());
    }
}
