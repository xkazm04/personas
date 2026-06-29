//! Detect running Claude Code CLI processes — including ones the in-memory
//! registry lost across an app restart (orphans otherwise reachable only via
//! Task Manager). Surfaces them so the user can see + kill them from Fleet.
//!
//! Identification is heuristic (process name / command line), so it also picks
//! up externally-launched `claude` sessions and the app's own companion/build
//! `claude -p` invocations — the returned `cmd` snippet lets the user tell
//! them apart, and `tracked` flags PIDs that match a live Fleet session.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, RefreshKind, System};
use tauri::AppHandle;
use ts_rs::TS;

use super::pty;
use super::registry::registry;
use super::transcript_read::latest_session_for_cwd;

/// One detected Claude CLI process.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct FleetDetectedProcess {
    pub pid: u32,
    pub name: String,
    /// Truncated command line, for identifying interactive (Fleet) vs `-p`
    /// (companion/build) invocations.
    pub cmd: String,
    pub cwd: Option<String>,
    /// Resident memory in bytes (i64 → TS bigint).
    pub memory_bytes: i64,
    /// True if the PID matches a session Fleet currently tracks. After a
    /// restart the registry is empty, so detected processes read as untracked
    /// (= orphan / external) — exactly the case worth cleaning up.
    pub tracked: bool,
    /// True if this looks like an interactive session (no `-p` / `--print`) —
    /// a real "terminal", not one of the app's transient `claude -p`
    /// companion/build calls. Orphan detection counts interactive + untracked
    /// so those background `-p` calls don't trip a false alarm.
    pub interactive: bool,
}

/// Heuristic: does this name / joined command line look like Claude Code?
fn is_claude_process(name: &str, cmd_joined: &str) -> bool {
    let name_l = name.to_ascii_lowercase();
    let cmd_l = cmd_joined.to_ascii_lowercase();
    cmd_l.contains("claude-code")
        || cmd_l.contains("@anthropic-ai/claude")
        || name_l == "claude"
        || name_l == "claude.cmd"
        || name_l == "claude.exe"
}

/// Scan the OS process table for Claude CLI processes.
#[tauri::command]
pub async fn fleet_detect_processes() -> Result<Vec<FleetDetectedProcess>, String> {
    tokio::task::spawn_blocking(|| {
        let sys = System::new_with_specifics(
            RefreshKind::nothing().with_processes(ProcessRefreshKind::everything()),
        );

        let tracked_pids: std::collections::HashSet<u32> = registry()
            .list_dto()
            .iter()
            .filter_map(|s| s.child_pid)
            .collect();

        let mut out: Vec<FleetDetectedProcess> = Vec::new();
        for (pid, proc_) in sys.processes() {
            let name = proc_.name().to_string_lossy().to_string();
            let args: Vec<String> = proc_.cmd().iter().map(|s| s.to_string_lossy().into_owned()).collect();
            let cmd_joined = args.join(" ");
            if !is_claude_process(&name, &cmd_joined) {
                continue;
            }
            let interactive = !args.iter().any(|a| a == "-p" || a == "--print");
            let pid_u32 = pid.as_u32();
            out.push(FleetDetectedProcess {
                pid: pid_u32,
                name,
                cmd: cmd_joined.chars().take(200).collect(),
                cwd: proc_.cwd().map(|p| p.to_string_lossy().into_owned()),
                memory_bytes: proc_.memory() as i64,
                tracked: tracked_pids.contains(&pid_u32),
                interactive,
            });
        }
        // Orphans (untracked) first, then by memory desc — the cleanup targets.
        out.sort_by(|a, b| a.tracked.cmp(&b.tracked).then(b.memory_bytes.cmp(&a.memory_bytes)));
        Ok(out)
    })
    .await
    .map_err(|e| format!("process scan task failed: {e}"))?
}

/// Kill a single process by PID (targeted — never a blanket kill). Returns
/// `true` if the process existed and the kill signal was sent.
#[tauri::command]
pub async fn fleet_kill_pid(pid: u32) -> Result<bool, String> {
    tokio::task::spawn_blocking(move || {
        let target = Pid::from_u32(pid);
        let mut sys = System::new();
        sys.refresh_processes(ProcessesToUpdate::Some(&[target]), true);
        Ok(sys.process(target).map(|p| p.kill()).unwrap_or(false))
    })
    .await
    .map_err(|e| format!("kill task failed: {e}"))?
}

/// Re-adopt an orphaned process: derive the conversation recorded for `cwd`,
/// kill the orphan (so we don't run two `claude` processes on one
/// conversation), then spawn a fresh Fleet-tracked session resuming it
/// (`claude --resume <id>`) in the same cwd. Returns the new internal session
/// id. Errors if no transcript matches the cwd (nothing to resume).
#[tauri::command]
pub async fn fleet_resume_orphan(app: AppHandle, pid: u32, cwd: String) -> Result<String, String> {
    // Derive the session id BEFORE killing (the kill is irreversible).
    let lookup_cwd = cwd.clone();
    let session_id = tokio::task::spawn_blocking(move || latest_session_for_cwd(&lookup_cwd))
        .await
        .map_err(|e| format!("transcript lookup task failed: {e}"))?
        .ok_or_else(|| {
            "No transcript recorded for that working directory — nothing to resume.".to_string()
        })?;

    // Free the orphan first (no-op if it already died).
    let _ = fleet_kill_pid(pid).await;

    pty::spawn_session(
        app,
        PathBuf::from(cwd),
        // A bare `claude --resume <id>` exits 1 ("provide a prompt to continue");
        // the continuation prompt is required. See RESUME_CONTINUATION_PROMPT.
        vec![
            "--resume".to_string(),
            session_id,
            pty::RESUME_CONTINUATION_PROMPT.to_string(),
        ],
        120,
        32,
    )
}

#[cfg(test)]
mod tests {
    use super::is_claude_process;

    #[test]
    fn matches_node_running_the_claude_cli() {
        // The common Windows/npm-global shape: node running cli.js.
        assert!(is_claude_process(
            "node.exe",
            r"node C:\Users\x\AppData\Roaming\npm\node_modules\@anthropic-ai\claude-code\cli.js"
        ));
    }

    #[test]
    fn matches_bare_claude_binary() {
        assert!(is_claude_process("claude", "claude --resume abc"));
        assert!(is_claude_process("claude.cmd", "claude.cmd"));
    }

    #[test]
    fn ignores_unrelated_processes() {
        assert!(!is_claude_process("node.exe", "node some-other-app/server.js"));
        assert!(!is_claude_process("chrome.exe", "chrome --profile claude-notes"));
        assert!(!is_claude_process("explorer.exe", ""));
    }
}
