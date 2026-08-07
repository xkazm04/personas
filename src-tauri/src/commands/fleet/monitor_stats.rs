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
//! - screen movement → the last delta a render already measured
//!   ([`super::screen_activity`]); read-only, never renders anything itself
//!
//! Deliberately ONE command for ALL sessions: a per-session command would turn
//! a 30-session fleet into 30 IPC round-trips per poll.
//!
//! Lock discipline: the registry snapshot is taken and released *before* the
//! blocking work starts, so a slow process scan can never stall PTY writers.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::process_scan::memory_bytes_for;
use super::registry::registry;
use super::screen_activity::ScreenActivity;
use super::transcript_read::{summary_for_session, FleetTranscriptSummary};
use super::types::FleetSessionState;
use crate::error::AppError;

/// The tool Claude Code invokes to spawn a subagent — counting it in the
/// rollup gives "subagents this session has launched".
const SUBAGENT_TOOL: &str = "Task";

/// Bytes per MB, for the memory conversion.
const BYTES_PER_MB: u64 = 1024 * 1024;

// ── Open-subagent counter ──────────────────────────────────────────────────
// The transcript rollup says how many subagents a session has EVER launched;
// it cannot say how many are running right now, because a `Task` block is
// written when the subagent starts and nothing marks its end. The hook stream
// does have both edges — PreToolUse fires on entry, PostToolUse on return — so
// pairing them per session gives the live count. Kept beside the stats it
// feeds rather than inside `FleetSessionInner`, so the hook path needs no
// registry write and no session-record surgery.

fn open_subagents() -> &'static Mutex<HashMap<String, i32>> {
    static M: OnceLock<Mutex<HashMap<String, i32>>> = OnceLock::new();
    M.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Record one tool edge from the hook receiver. Ignores every tool but
/// [`SUBAGENT_TOOL`]. Clamped at zero: hooks are best-effort (a dropped
/// PostToolUse, a session adopted mid-flight, an app restart with subagents
/// already open), and a negative "currently open" count is worse than a low
/// one.
pub fn note_subagent_edge(session_id: &str, tool_name: &str, is_post: bool) {
    if tool_name != SUBAGENT_TOOL {
        return;
    }
    let mut map = open_subagents().lock().unwrap_or_else(|e| e.into_inner());
    let entry = map.entry(session_id.to_string()).or_insert(0);
    *entry = if is_post {
        entry.saturating_sub(1).max(0)
    } else {
        entry.saturating_add(1)
    };
}

/// Forget a session's open-subagent count. Called when the session starts or
/// resumes (nothing of the previous process survives) and whenever the stats
/// pass finds it without a live process.
pub fn reset_subagents(session_id: &str) {
    let mut map = open_subagents().lock().unwrap_or_else(|e| e.into_inner());
    map.remove(session_id);
}

fn subagents_active(session_id: &str) -> i32 {
    let map = open_subagents().lock().unwrap_or_else(|e| e.into_inner());
    map.get(session_id).copied().unwrap_or(0)
}

/// How much of a session's screen moved between the last two renders it
/// happened to get — the "is it stuck?" signal.
///
/// Read-only by construction: it reports whatever the last render already
/// measured and NEVER schedules one, so a session nobody has rendered simply
/// has no verdict (`null` on the wire) rather than costing work to produce one.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "lowercase")]
pub enum ScreenHealth {
    /// Enough of the grid changed to be real output.
    Working,
    /// Only chrome moved — a spinner frame, an elapsed counter.
    Cosmetic,
    /// Nothing moved at all.
    Silent,
}

impl From<ScreenActivity> for ScreenHealth {
    fn from(a: ScreenActivity) -> Self {
        match a {
            ScreenActivity::Working => ScreenHealth::Working,
            ScreenActivity::Cosmetic => ScreenHealth::Cosmetic,
            ScreenActivity::Silent => ScreenHealth::Silent,
        }
    }
}

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
    /// Subagents open RIGHT NOW — PreToolUse/PostToolUse pairs on `Task`.
    /// Never negative; 0 for a session with no live process.
    pub subagents_active: i32,
    /// Background shells launched over the session's lifetime (`Bash` with
    /// `run_in_background: true`).
    pub bg_procs_launched: i32,
    /// Resident memory of the session's process in MB, or `None` when the
    /// session has no live process (dozing / hibernated / exited).
    pub mem_mb: Option<i64>,
    /// Verdict on the session's most recent screen delta, or `None` when no
    /// render has ever been taken for it. Never an input to any state
    /// decision — a display signal only.
    pub screen_health: Option<ScreenHealth>,
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

/// What one session contributes to the stats pass before the blocking work —
/// everything that has to be read under the registry lock.
struct SessionSeed {
    session_id: String,
    claude_session_id: Option<String>,
    child_pid: Option<u32>,
    state: FleetSessionState,
    screen_health: Option<ScreenHealth>,
}

/// Live stats for every tracked session, in one call.
#[tauri::command]
pub async fn fleet_monitor_stats() -> Result<Vec<FleetMonitorStats>, AppError> {
    // Snapshot first: `list_dto` takes and releases the registry lock, so none
    // of the blocking work below happens while the registry is held.
    let sessions: Vec<SessionSeed> = registry()
        .list_dto()
        .into_iter()
        .map(|s| {
            // Free read of the last render's measurement; never triggers one.
            let screen_health = registry()
                .screen_delta_for(&s.id)
                .map(|d| ScreenHealth::from(d.activity()));
            SessionSeed {
                session_id: s.id,
                claude_session_id: s.claude_session_id,
                child_pid: s.child_pid,
                state: s.state,
                screen_health,
            }
        })
        .collect();

    tokio::task::spawn_blocking(move || {
        let pids: Vec<u32> = sessions.iter().filter_map(|s| s.child_pid).collect();
        let mem = memory_bytes_for(&pids);

        let out = sessions
            .into_iter()
            .map(|seed| {
                let SessionSeed {
                    session_id,
                    claude_session_id,
                    child_pid,
                    state,
                    screen_health,
                } = seed;
                let rollup = claude_session_id.as_deref().and_then(summary_for_session);
                // No process → nothing can still be open. Drop the counter so a
                // session that dozed or died mid-Task doesn't keep a phantom.
                let alive = child_pid.is_some()
                    && !matches!(
                        state,
                        FleetSessionState::Exited | FleetSessionState::Hibernated
                    );
                if !alive {
                    reset_subagents(&session_id);
                }
                let subagents_active = if alive { subagents_active(&session_id) } else { 0 };
                FleetMonitorStats {
                    session_id,
                    claude_session_id,
                    output_tokens: rollup.as_ref().map(|r| r.tokens.output).unwrap_or(0),
                    context_tokens: rollup.as_ref().map(|r| r.last_context_tokens).unwrap_or(0),
                    subagents_total: rollup
                        .as_ref()
                        .map(|r| tool_count(r, SUBAGENT_TOOL))
                        .unwrap_or(0),
                    subagents_active,
                    bg_procs_launched: rollup
                        .as_ref()
                        .map(|r| r.bg_procs_launched)
                        .unwrap_or(0),
                    mem_mb: child_pid
                        .and_then(|p| mem.get(&p))
                        .map(|bytes| (bytes / BYTES_PER_MB) as i64),
                    screen_health,
                }
            })
            .collect();
        Ok(out)
    })
    .await
    .map_err(|e| AppError::Execution(format!("monitor stats task failed: {e}")))?
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

    // The counter map is process-global, so each test uses its own session id.

    #[test]
    fn screen_activity_maps_onto_the_wire_verdict() {
        // The UI column is a straight relabel of the existing classifier — no
        // second opinion about what counts as stuck.
        let cases = [
            (ScreenActivity::Working, "\"working\""),
            (ScreenActivity::Cosmetic, "\"cosmetic\""),
            (ScreenActivity::Silent, "\"silent\""),
        ];
        for (activity, wire) in cases {
            let health = ScreenHealth::from(activity);
            assert_eq!(serde_json::to_string(&health).unwrap(), wire);
        }
    }

    #[test]
    fn pairs_subagent_open_and_close() {
        let sid = "pair-basic";
        reset_subagents(sid);
        note_subagent_edge(sid, "Task", false);
        note_subagent_edge(sid, "Task", false);
        assert_eq!(subagents_active(sid), 2);
        note_subagent_edge(sid, "Task", true);
        assert_eq!(subagents_active(sid), 1);
        note_subagent_edge(sid, "Task", true);
        assert_eq!(subagents_active(sid), 0);
        reset_subagents(sid);
    }

    #[test]
    fn other_tools_never_move_the_counter() {
        let sid = "pair-other-tools";
        reset_subagents(sid);
        note_subagent_edge(sid, "Bash", false);
        note_subagent_edge(sid, "Read", false);
        note_subagent_edge(sid, "Bash", true);
        assert_eq!(subagents_active(sid), 0);
        reset_subagents(sid);
    }

    #[test]
    fn a_missed_post_never_goes_negative() {
        // Hooks are best-effort: a dropped PostToolUse, or a Post arriving for
        // a Pre we never saw (session adopted mid-flight). Floor at zero.
        let sid = "pair-missed-post";
        reset_subagents(sid);
        note_subagent_edge(sid, "Task", true);
        assert_eq!(subagents_active(sid), 0);
        note_subagent_edge(sid, "Task", false);
        note_subagent_edge(sid, "Task", true);
        note_subagent_edge(sid, "Task", true);
        note_subagent_edge(sid, "Task", true);
        assert_eq!(subagents_active(sid), 0);
        reset_subagents(sid);
    }

    #[test]
    fn reset_clears_an_open_count() {
        let sid = "pair-reset";
        reset_subagents(sid);
        note_subagent_edge(sid, "Task", false);
        assert_eq!(subagents_active(sid), 1);
        reset_subagents(sid);
        assert_eq!(subagents_active(sid), 0);
    }

    #[test]
    fn counters_are_per_session() {
        let (a, b) = ("pair-sess-a", "pair-sess-b");
        reset_subagents(a);
        reset_subagents(b);
        note_subagent_edge(a, "Task", false);
        note_subagent_edge(a, "Task", false);
        note_subagent_edge(b, "Task", false);
        assert_eq!(subagents_active(a), 2);
        assert_eq!(subagents_active(b), 1);
        reset_subagents(a);
        reset_subagents(b);
    }
}
