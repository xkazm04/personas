//! Live per-session stats for the Fleet **Monitor** view — one IPC call for
//! the whole fleet.
//!
//! The monitor renders one dense row per session and wants numbers next to
//! each: tokens spent, context size, subagents, memory. Every one of those
//! already exists somewhere in Fleet — this module only *joins* them:
//!
//! - tokens / context / tool counts → the incremental transcript rollup
//!   ([`super::transcript_read::summary_for_session`], delta-parsed, never a
//!   full re-read)
//! - resident memory → the same `sysinfo` source the orphan scanner uses,
//!   narrowed to the fleet's own PIDs ([`super::process_scan::memory_bytes_for`])
//!
//! Deliberately ONE command for ALL sessions: a per-session command would turn
//! a 30-session fleet into 30 IPC round-trips per poll.
//!
//! Lock discipline: the registry snapshot is taken and released *before* the
//! blocking work starts, so a slow process scan can never stall PTY writers.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::process_scan::memory_bytes_for;
use super::registry::registry;
use super::transcript_read::{summary_for_session, FleetTranscriptSummary};

/// The tool Claude Code invokes to spawn a subagent — counting it in the
/// rollup gives "subagents this session has launched".
const SUBAGENT_TOOL: &str = "Task";

/// Bytes per MB, for the memory conversion.
const BYTES_PER_MB: u64 = 1024 * 1024;

/// One session's live monitor stats. Fields the session has no source for
/// (never bound a `claudeSessionId`, no process) read as 0 / `null` — the
/// frontend decides what to show instead.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct FleetMonitorStats {
    /// Internal Fleet session id — the join key with `FleetSession`.
    pub session_id: String,
    /// Bound Claude session id, or `None` when no hook has bound one yet
    /// (in which case every transcript-derived field below is 0).
    pub claude_session_id: Option<String>,
    /// Output tokens across the whole session — the "effort spent" proxy.
    pub output_tokens: i64,
    /// Approximate current context-window size (last turn's input + cache read).
    pub context_tokens: i64,
    /// Subagents launched over the session's lifetime (`Task` tool uses).
    pub subagents_total: i32,
    /// Resident memory of the session's process in MB, or `None` when the
    /// session has no live process (dozing / hibernated / exited).
    pub mem_mb: Option<i64>,
}

/// How many times `tool` appears in a rollup's tool counts.
fn tool_count(summary: &FleetTranscriptSummary, tool: &str) -> i32 {
    summary
        .tools
        .iter()
        .find(|t| t.name == tool)
        .map(|t| t.count)
        .unwrap_or(0)
}

/// Live stats for every tracked session, in one call.
#[tauri::command]
pub async fn fleet_monitor_stats() -> Result<Vec<FleetMonitorStats>, String> {
    // Snapshot first: `list_dto` takes and releases the registry lock, so none
    // of the blocking work below happens while the registry is held.
    let sessions: Vec<(String, Option<String>, Option<u32>)> = registry()
        .list_dto()
        .into_iter()
        .map(|s| (s.id, s.claude_session_id, s.child_pid))
        .collect();

    tokio::task::spawn_blocking(move || {
        let pids: Vec<u32> = sessions.iter().filter_map(|(_, _, pid)| *pid).collect();
        let mem = memory_bytes_for(&pids);

        let out = sessions
            .into_iter()
            .map(|(session_id, claude_session_id, child_pid)| {
                let rollup = claude_session_id.as_deref().and_then(summary_for_session);
                FleetMonitorStats {
                    session_id,
                    claude_session_id,
                    output_tokens: rollup.as_ref().map(|r| r.tokens.output).unwrap_or(0),
                    context_tokens: rollup.as_ref().map(|r| r.last_context_tokens).unwrap_or(0),
                    subagents_total: rollup
                        .as_ref()
                        .map(|r| tool_count(r, SUBAGENT_TOOL))
                        .unwrap_or(0),
                    mem_mb: child_pid
                        .and_then(|p| mem.get(&p))
                        .map(|bytes| (bytes / BYTES_PER_MB) as i64),
                }
            })
            .collect();
        Ok(out)
    })
    .await
    .map_err(|e| format!("monitor stats task failed: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::fleet::transcript_read::summarize_lines;

    fn task_line(tool: &str) -> String {
        format!(
            r#"{{"type":"assistant","message":{{"model":"m","content":[{{"type":"tool_use","name":"{tool}","input":{{}}}}]}}}}"#
        )
    }

    #[test]
    fn counts_only_the_subagent_tool() {
        let lines = vec![
            task_line("Task"),
            task_line("Task"),
            task_line("Bash"),
            task_line("Read"),
        ];
        let s = summarize_lines("sid", "p", &lines);
        assert_eq!(tool_count(&s, SUBAGENT_TOOL), 2);
        assert_eq!(tool_count(&s, "Bash"), 1);
    }

    #[test]
    fn missing_tool_counts_zero() {
        let s = summarize_lines("sid", "p", &[task_line("Read")]);
        assert_eq!(tool_count(&s, SUBAGENT_TOOL), 0);
    }
}
