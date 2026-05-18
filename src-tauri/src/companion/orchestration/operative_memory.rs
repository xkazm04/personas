//! Operative memory — short-term, in-process working set of Athena's
//! orchestration over the Fleet.
//!
//! Data model:
//!   Operation (id, user_intent, status, sessions[], summary?)
//!     └─ SessionRef (fleet_session_id, role?, last_state,
//!                    current_tool?, files_touched, recent_failure?,
//!                    summary?)
//!
//! Lifecycle:
//!  1. Fleet emits a SessionStart hook → `record_session_event` finds
//!     no operation owning this session → auto-creates an *ad-hoc*
//!     Operation tagged with the project label and the spawn time. The
//!     ad-hoc tag is what makes user-initiated spawns first-class
//!     citizens in operative memory without requiring the user to
//!     declare an intent upfront.
//!  2. PreToolUse hook → `record_tool_event(.., is_post=false)` sets
//!     SessionRef.current_tool and inserts the touched file (for Edit /
//!     Write / Read tools).
//!  3. PostToolUse hook → clears current_tool, stashes failure tail
//!     if the tool result has a non-zero exit code.
//!  4. SessionEnd / Exited → `synthesize_session_summary` builds a
//!     human-readable summary from accumulated state and writes it
//!     onto SessionRef.summary. The brain bridge picks this up and
//!     uses it as the episode body instead of the bare lifecycle
//!     marker (Direction 4 — replaces the UUID-only episodes).
//!  5. When every session in an Operation has reached Exited, the
//!     Operation is marked Completed and stays in memory for a TTL
//!     so Athena can still reference it in the next few turns.
//!
//! Concurrency: a single `RwLock` over the whole `HashMap<OpId, Op>`.
//! Operations are small structs (10-20 fields, ~100 bytes); the lock
//! is held only for the duration of a single record_* call (no I/O,
//! no async). For 5-10 parallel sessions firing tool events at sub-
//! second cadence this is well below the threshold where lock
//! granularity matters.
//!
//! Cap: operations older than `STALE_OP_TTL_MS` AND with all sessions
//! Exited are dropped on every digest call. Keeps the working set
//! bounded without a separate reaper task.

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::{OnceLock, RwLock};

use crate::commands::fleet::types::FleetSessionState;

/// Operations that are Completed AND haven't been touched in this long
/// are pruned on the next `digest_for_prompt` call.
const STALE_OP_TTL_MS: i64 = 60 * 60 * 1000; // 1h

/// How many active operations we render in the prompt digest. The full
/// list still lives in memory; this just caps prompt bloat when the
/// user has a lot of parallel work going on.
const DIGEST_MAX_OPS: usize = 6;

/// How many sessions per operation we render. Same rationale.
const DIGEST_MAX_SESSIONS_PER_OP: usize = 6;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OperationStatus {
    Active,
    Completed,
    Failed,
}

impl OperationStatus {
    fn label(self) -> &'static str {
        match self {
            OperationStatus::Active => "active",
            OperationStatus::Completed => "completed",
            OperationStatus::Failed => "failed",
        }
    }
}

#[derive(Debug, Clone)]
pub struct SessionRef {
    pub fleet_session_id: String,
    pub claude_session_id: Option<String>,
    pub cwd: String,
    pub role: Option<String>,
    pub last_state: FleetSessionState,
    /// Set on PreToolUse, cleared on PostToolUse. "Edit src/foo.rs",
    /// "Bash: npm test", etc. Length-capped at ~80 chars for the
    /// prompt digest.
    pub current_tool: Option<String>,
    /// Files this session has read/written/edited so far this run.
    /// Bounded to prevent unbounded growth (Athena only sees the
    /// first N in the digest anyway).
    pub files_touched: HashSet<PathBuf>,
    /// Tail of the most recent failing tool result (stderr or
    /// error_message), truncated to ~400 chars so the prompt stays
    /// reasonable. Cleared when a subsequent tool succeeds.
    pub recent_failure: Option<String>,
    /// Set once at session end by `synthesize_session_summary`. The
    /// brain bridge uses this as the episode body in place of the bare
    /// lifecycle marker.
    pub summary: Option<String>,
    pub started_at_ms: i64,
    pub last_event_at_ms: i64,
}

impl SessionRef {
    fn new(fleet_session_id: &str, cwd: &str, started_at_ms: i64) -> Self {
        Self {
            fleet_session_id: fleet_session_id.to_string(),
            claude_session_id: None,
            cwd: cwd.to_string(),
            role: None,
            last_state: FleetSessionState::Spawning,
            current_tool: None,
            files_touched: HashSet::new(),
            recent_failure: None,
            summary: None,
            started_at_ms,
            last_event_at_ms: started_at_ms,
        }
    }
}

#[derive(Debug, Clone)]
pub struct Operation {
    pub id: String,
    pub user_intent: String,
    pub sessions: Vec<SessionRef>,
    pub status: OperationStatus,
    pub started_at_ms: i64,
    pub ended_at_ms: Option<i64>,
    /// Final wrap-up across the whole operation (filled by Athena's
    /// reconciliation in Direction 5). v1 leaves this `None`.
    pub completion_summary: Option<String>,
}

#[derive(Default)]
pub struct OperativeMemory {
    operations: RwLock<HashMap<String, Operation>>,
}

static MEMORY: OnceLock<OperativeMemory> = OnceLock::new();

pub fn memory() -> &'static OperativeMemory {
    MEMORY.get_or_init(OperativeMemory::default)
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn fresh_op_id() -> String {
    format!("op_{}", uuid::Uuid::new_v4().simple().to_string().get(..8).unwrap_or("xxxxxxxx"))
}

impl OperativeMemory {
    /// Test-only escape hatch — clears all state. Production code
    /// should never need to call this.
    #[cfg(test)]
    pub fn reset(&self) {
        let mut ops = self.operations.write().unwrap_or_else(|e| e.into_inner());
        ops.clear();
    }

    /// Begin a new operation with an explicit user intent. Returns the
    /// new operation id. This is the path Direction 5 will use; for
    /// v1 (Direction 1) all sessions get assigned to ad-hoc operations
    /// via [`Self::record_session_event`].
    pub fn begin_operation(&self, user_intent: String) -> String {
        let id = fresh_op_id();
        let now = now_ms();
        let mut ops = self.operations.write().unwrap_or_else(|e| e.into_inner());
        ops.insert(
            id.clone(),
            Operation {
                id: id.clone(),
                user_intent,
                sessions: Vec::new(),
                status: OperationStatus::Active,
                started_at_ms: now,
                ended_at_ms: None,
                completion_summary: None,
            },
        );
        id
    }

    /// Find or create the operation that owns this session.
    ///
    /// First-time-seen sessions (no operation tracks them yet) attach
    /// to a fresh ad-hoc operation labeled by project. We deliberately
    /// don't reuse a project-level ad-hoc op because two unrelated
    /// user spawns in the same project shouldn't be lumped together —
    /// the user thinks of them as independent tasks even if they share
    /// a cwd.
    fn ensure_op_for_session(
        &self,
        ops: &mut HashMap<String, Operation>,
        fleet_session_id: &str,
        project_label: &str,
        cwd: &str,
    ) -> String {
        // Existing?
        for op in ops.values() {
            if op
                .sessions
                .iter()
                .any(|s| s.fleet_session_id == fleet_session_id)
            {
                return op.id.clone();
            }
        }
        // Create ad-hoc.
        let id = fresh_op_id();
        let now = now_ms();
        ops.insert(
            id.clone(),
            Operation {
                id: id.clone(),
                user_intent: format!("user spawn in {project_label}"),
                sessions: vec![SessionRef::new(fleet_session_id, cwd, now)],
                status: OperationStatus::Active,
                started_at_ms: now,
                ended_at_ms: None,
                completion_summary: None,
            },
        );
        id
    }

    /// Record a session-level event (state change / first-seen / exit).
    /// Called from the brain bridge after each fleet lifecycle hook.
    /// Idempotent — repeated events for the same state are absorbed.
    pub fn record_session_event(
        &self,
        fleet_session_id: &str,
        claude_session_id: Option<&str>,
        project_label: &str,
        cwd: &str,
        state: FleetSessionState,
    ) {
        let mut ops = self.operations.write().unwrap_or_else(|e| e.into_inner());
        let op_id = self.ensure_op_for_session(&mut ops, fleet_session_id, project_label, cwd);
        let op = ops.get_mut(&op_id).expect("ensure_op_for_session just inserted");

        // Upsert SessionRef.
        if let Some(s) = op
            .sessions
            .iter_mut()
            .find(|s| s.fleet_session_id == fleet_session_id)
        {
            s.last_state = state;
            s.last_event_at_ms = now_ms();
            if let Some(csid) = claude_session_id {
                if s.claude_session_id.is_none() {
                    s.claude_session_id = Some(csid.to_string());
                }
            }
        } else {
            // ensure_op_for_session created an ad-hoc op with this
            // session already in it, so this branch only fires when
            // the op pre-existed without a SessionRef yet (rare —
            // Direction 5 spawn-with-intent path).
            let mut sref = SessionRef::new(fleet_session_id, cwd, now_ms());
            sref.last_state = state;
            sref.claude_session_id = claude_session_id.map(str::to_string);
            op.sessions.push(sref);
        }

        // If every session is Exited, mark the operation Completed.
        // Failed status escalation happens when synthesize_session_summary
        // detects a non-zero exit; we don't do it here.
        if op
            .sessions
            .iter()
            .all(|s| matches!(s.last_state, FleetSessionState::Exited))
            && matches!(op.status, OperationStatus::Active)
        {
            op.status = OperationStatus::Completed;
            op.ended_at_ms = Some(now_ms());
        }
    }

    /// Record a tool-use event from a PreToolUse / PostToolUse hook.
    /// `is_post` differentiates the two paths so we can clear
    /// current_tool on completion and capture failure tails.
    pub fn record_tool_event(
        &self,
        fleet_session_id: &str,
        tool_name: &str,
        tool_input: &serde_json::Value,
        is_post: bool,
        tool_result: Option<&serde_json::Value>,
    ) {
        let mut ops = self.operations.write().unwrap_or_else(|e| e.into_inner());
        let Some(op_id) = ops
            .iter()
            .find(|(_, op)| {
                op.sessions
                    .iter()
                    .any(|s| s.fleet_session_id == fleet_session_id)
            })
            .map(|(id, _)| id.clone())
        else {
            // Tool event arrived for an unknown session (race: hook
            // fired before SessionStart was processed). Silently drop —
            // the next lifecycle event will register the session.
            return;
        };
        let op = ops.get_mut(&op_id).unwrap();
        let Some(session) = op
            .sessions
            .iter_mut()
            .find(|s| s.fleet_session_id == fleet_session_id)
        else {
            return;
        };
        session.last_event_at_ms = now_ms();

        if is_post {
            session.current_tool = None;
            if let Some(result) = tool_result {
                // Failure detection: non-zero exit_code on the result
                // OR a top-level error_message field. Captures both
                // Bash (exit code) and Edit/Write (error string) shapes.
                let exit_code = result.get("exit_code").and_then(|v| v.as_i64());
                let err_msg = result
                    .get("error_message")
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.is_empty());
                let bad = matches!(exit_code, Some(c) if c != 0) || err_msg.is_some();
                if bad {
                    let tail = err_msg
                        .map(str::to_string)
                        .or_else(|| extract_stderr_tail(result))
                        .unwrap_or_default();
                    session.recent_failure = Some(truncate(tail, 400));
                } else {
                    // Successful tool clears prior failure stamp.
                    session.recent_failure = None;
                }
            }
        } else {
            session.current_tool = Some(format_tool_summary(tool_name, tool_input));
            if let Some(file) = extract_file_path(tool_name, tool_input) {
                session.files_touched.insert(PathBuf::from(file));
            }
        }
    }

    /// Build the session-end summary string from accumulated state.
    /// Returns None if the session is unknown (race / already cleaned
    /// up). Updates SessionRef.summary in-place and returns a clone.
    ///
    /// v1 synthesizes from operative memory data only (files touched,
    /// last tool, last failure, duration). A future iteration can spawn
    /// a one-shot `claude --print` against the JSONL transcript for a
    /// richer narrative summary; v1 already gives Athena far more than
    /// the bare lifecycle marker.
    pub fn synthesize_session_summary(
        &self,
        fleet_session_id: &str,
        exit_code: Option<i32>,
    ) -> Option<String> {
        let mut ops = self.operations.write().unwrap_or_else(|e| e.into_inner());
        let (op_id, _) = ops
            .iter()
            .find(|(_, op)| {
                op.sessions
                    .iter()
                    .any(|s| s.fleet_session_id == fleet_session_id)
            })
            .map(|(id, op)| (id.clone(), op.user_intent.clone()))?;
        let op = ops.get_mut(&op_id)?;
        let session = op
            .sessions
            .iter_mut()
            .find(|s| s.fleet_session_id == fleet_session_id)?;

        let duration_ms = session.last_event_at_ms - session.started_at_ms;
        let duration = format_duration(duration_ms.max(0));

        let mut parts: Vec<String> = Vec::new();
        let outcome = match exit_code {
            Some(0) => "completed cleanly",
            Some(_) => "ended with a non-zero exit",
            None => "ended unexpectedly (signal or crash)",
        };
        parts.push(format!("Ran for {duration} — {outcome}."));

        if !session.files_touched.is_empty() {
            let mut files: Vec<&PathBuf> = session.files_touched.iter().collect();
            files.sort();
            let preview: Vec<String> = files
                .iter()
                .take(8)
                .map(|p| p.to_string_lossy().into_owned())
                .collect();
            let more = if files.len() > 8 {
                format!(" (+{} more)", files.len() - 8)
            } else {
                String::new()
            };
            parts.push(format!("Files touched: {}{}", preview.join(", "), more));
        }

        if let Some(failure) = &session.recent_failure {
            parts.push(format!("Last failure tail: {failure}"));
        }

        if let Some(role) = &session.role {
            parts.insert(0, format!("Role: {role}."));
        }

        let summary = parts.join(" ");
        session.summary = Some(summary.clone());

        // If the operation has Failed because of this session's bad exit,
        // escalate its status.
        if matches!(exit_code, Some(c) if c != 0) || exit_code.is_none() {
            op.status = OperationStatus::Failed;
            if op.ended_at_ms.is_none() {
                op.ended_at_ms = Some(now_ms());
            }
        }

        Some(summary)
    }

    /// Format the active operations for Athena's prompt. Empty string
    /// if nothing is in flight. Replaces the old fleet-state digest.
    pub fn digest_for_prompt(&self) -> String {
        self.prune_stale();
        let ops = self.operations.read().unwrap_or_else(|e| e.into_inner());
        let mut active: Vec<&Operation> = ops
            .values()
            .filter(|op| !matches!(op.status, OperationStatus::Completed) || keep_recent(op))
            .collect();
        if active.is_empty() {
            return String::new();
        }
        active.sort_by_key(|op| -op.started_at_ms);

        let mut s = String::from("\n## Active orchestration (operative memory)\n");
        for op in active.iter().take(DIGEST_MAX_OPS) {
            s.push_str(&format!(
                "- **{intent}** (`{id}`, {status}",
                intent = op.user_intent,
                id = &op.id[..op.id.len().min(8)],
                status = op.status.label(),
            ));
            if let Some(ended) = op.ended_at_ms {
                s.push_str(&format!(", finished {} ago", format_duration(now_ms() - ended)));
            } else {
                s.push_str(&format!(", started {} ago", format_duration(now_ms() - op.started_at_ms)));
            }
            s.push_str(")\n");

            for sess in op.sessions.iter().take(DIGEST_MAX_SESSIONS_PER_OP) {
                let id8 = &sess.fleet_session_id[..sess.fleet_session_id.len().min(8)];
                let role = sess
                    .role
                    .as_deref()
                    .map(|r| format!(" \"{r}\""))
                    .unwrap_or_default();
                let state = state_label(sess.last_state);
                let tool = sess
                    .current_tool
                    .as_deref()
                    .map(|t| format!(" → {t}"))
                    .unwrap_or_default();
                s.push_str(&format!("  - `{id8}`{role}: {state}{tool}\n"));
                if !sess.files_touched.is_empty() {
                    let files: Vec<String> = sess
                        .files_touched
                        .iter()
                        .take(5)
                        .map(|p| p.to_string_lossy().into_owned())
                        .collect();
                    let more = if sess.files_touched.len() > 5 {
                        format!(" (+{} more)", sess.files_touched.len() - 5)
                    } else {
                        String::new()
                    };
                    s.push_str(&format!("    files: {}{}\n", files.join(", "), more));
                }
                if let Some(failure) = &sess.recent_failure {
                    s.push_str(&format!("    ⚠ recent failure: {}\n", truncate_one_line(failure, 160)));
                }
                if let Some(summary) = &sess.summary {
                    s.push_str(&format!("    summary: {}\n", truncate_one_line(summary, 220)));
                }
            }
            if op.sessions.len() > DIGEST_MAX_SESSIONS_PER_OP {
                s.push_str(&format!(
                    "  - … {} more session(s) not shown\n",
                    op.sessions.len() - DIGEST_MAX_SESSIONS_PER_OP
                ));
            }
        }
        if active.len() > DIGEST_MAX_OPS {
            s.push_str(&format!(
                "(plus {} older operation(s) not shown)\n",
                active.len() - DIGEST_MAX_OPS,
            ));
        }
        s.push_str(
            "\nReference operations by their id (`op_xxx`) or session id prefix. \
The current_tool line tells you what each session is doing **right now**; the \
files line is what they've touched so far this run.\n",
        );
        s
    }

    fn prune_stale(&self) {
        let mut ops = self.operations.write().unwrap_or_else(|e| e.into_inner());
        let cutoff = now_ms() - STALE_OP_TTL_MS;
        ops.retain(|_, op| {
            let terminal = matches!(op.status, OperationStatus::Completed | OperationStatus::Failed);
            let too_old = op.ended_at_ms.map(|t| t < cutoff).unwrap_or(false);
            !(terminal && too_old)
        });
    }
}

// ── Helpers ─────────────────────────────────────────────────────────

/// Render a tool invocation into one short user-facing line. We choose
/// per-tool whether to show the input (Bash command, file path) or
/// just the tool name. Keep these terse — they're prompt-displayed.
fn format_tool_summary(tool_name: &str, tool_input: &serde_json::Value) -> String {
    match tool_name {
        "Bash" => {
            let cmd = tool_input
                .get("command")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            format!("Bash: {}", truncate(cmd.to_string(), 60))
        }
        "Edit" | "Write" | "Read" | "NotebookEdit" => {
            let path = tool_input
                .get("file_path")
                .and_then(|v| v.as_str())
                .unwrap_or("?");
            format!("{tool_name} {}", short_path(path))
        }
        "Grep" => {
            let pattern = tool_input.get("pattern").and_then(|v| v.as_str()).unwrap_or("?");
            format!("Grep \"{}\"", truncate(pattern.to_string(), 40))
        }
        "Glob" => {
            let pattern = tool_input.get("pattern").and_then(|v| v.as_str()).unwrap_or("?");
            format!("Glob {pattern}")
        }
        other => other.to_string(),
    }
}

fn extract_file_path(tool_name: &str, tool_input: &serde_json::Value) -> Option<String> {
    match tool_name {
        "Edit" | "Write" | "Read" | "NotebookEdit" => tool_input
            .get("file_path")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        _ => None,
    }
}

fn extract_stderr_tail(result: &serde_json::Value) -> Option<String> {
    let stderr = result.get("stderr").and_then(|v| v.as_str())?;
    if stderr.is_empty() {
        return None;
    }
    let tail: String = stderr.lines().rev().take(5).collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>().join(" / ");
    Some(tail)
}

fn truncate(s: String, max: usize) -> String {
    if s.chars().count() <= max {
        s
    } else {
        let mut out: String = s.chars().take(max).collect();
        out.push('…');
        out
    }
}

fn truncate_one_line(s: &str, max: usize) -> String {
    let one_line = s.replace('\n', " / ").replace('\r', "");
    truncate(one_line, max)
}

fn short_path(path: &str) -> String {
    // Keep last 2-3 path segments so "C:\Users\kazda\kiro\personas\src\foo\bar.rs"
    // becomes "src/foo/bar.rs" for prompt brevity.
    let normalised = path.replace('\\', "/");
    let segs: Vec<&str> = normalised.split('/').filter(|s| !s.is_empty()).collect();
    if segs.len() <= 3 {
        segs.join("/")
    } else {
        let tail = &segs[segs.len() - 3..];
        tail.join("/")
    }
}

fn format_duration(ms: i64) -> String {
    if ms < 1000 {
        return "<1s".to_string();
    }
    let secs = ms / 1000;
    if secs < 60 {
        format!("{secs}s")
    } else if secs < 3600 {
        format!("{}m", secs / 60)
    } else {
        format!("{}h{}m", secs / 3600, (secs % 3600) / 60)
    }
}

fn state_label(s: FleetSessionState) -> &'static str {
    match s {
        FleetSessionState::Spawning => "spawning",
        FleetSessionState::Running => "working",
        FleetSessionState::AwaitingInput => "awaiting input",
        FleetSessionState::Idle => "idle",
        FleetSessionState::Stale => "stale",
        FleetSessionState::Exited => "exited",
    }
}

/// Recently-completed ops stay in the digest for a short window so
/// Athena can talk about what just finished without immediate erasure.
fn keep_recent(op: &Operation) -> bool {
    let cutoff = now_ms() - 5 * 60 * 1000; // 5m
    op.ended_at_ms.map(|t| t >= cutoff).unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::Mutex;

    // Force test serialisation — `memory()` is a process-wide singleton
    // so concurrent tests would stomp on each other's state. Each test
    // acquires this lock as its first act, then resets memory.
    static TEST_LOCK: Mutex<()> = Mutex::new(());

    fn lock_and_reset() -> std::sync::MutexGuard<'static, ()> {
        let g = TEST_LOCK.lock().unwrap_or_else(|p| p.into_inner());
        let _g = lock_and_reset();
        g
    }

    #[test]
    fn first_seen_session_creates_ad_hoc_operation() {
        let _g = lock_and_reset();
        memory().record_session_event(
            "fs-1",
            Some("cc-1"),
            "personas",
            "/tmp/p",
            FleetSessionState::Spawning,
        );
        let ops = memory().operations.read().unwrap();
        assert_eq!(ops.len(), 1);
        let op = ops.values().next().unwrap();
        assert_eq!(op.sessions.len(), 1);
        assert_eq!(op.sessions[0].fleet_session_id, "fs-1");
        assert_eq!(op.sessions[0].claude_session_id.as_deref(), Some("cc-1"));
        assert_eq!(op.user_intent, "user spawn in personas");
        assert!(matches!(op.status, OperationStatus::Active));
    }

    #[test]
    fn repeated_state_changes_dont_duplicate_sessions() {
        let _g = lock_and_reset();
        for st in [FleetSessionState::Spawning, FleetSessionState::Running, FleetSessionState::Idle] {
            memory().record_session_event("fs-2", None, "personas", "/tmp/p", st);
        }
        let ops = memory().operations.read().unwrap();
        assert_eq!(ops.len(), 1);
        let op = ops.values().next().unwrap();
        assert_eq!(op.sessions.len(), 1);
        assert!(matches!(op.sessions[0].last_state, FleetSessionState::Idle));
    }

    #[test]
    fn exited_session_marks_operation_completed() {
        let _g = lock_and_reset();
        memory().record_session_event("fs-3", None, "personas", "/tmp/p", FleetSessionState::Spawning);
        memory().record_session_event("fs-3", None, "personas", "/tmp/p", FleetSessionState::Exited);
        let ops = memory().operations.read().unwrap();
        let op = ops.values().next().unwrap();
        assert!(matches!(op.status, OperationStatus::Completed));
        assert!(op.ended_at_ms.is_some());
    }

    #[test]
    fn tool_event_sets_current_tool_and_files_touched() {
        let _g = lock_and_reset();
        memory().record_session_event("fs-4", None, "personas", "/tmp/p", FleetSessionState::Running);
        memory().record_tool_event(
            "fs-4",
            "Edit",
            &json!({"file_path": "C:/Users/x/proj/src/foo.rs"}),
            false,
            None,
        );
        let ops = memory().operations.read().unwrap();
        let op = ops.values().next().unwrap();
        let s = &op.sessions[0];
        assert!(s.current_tool.as_deref().unwrap_or("").starts_with("Edit "));
        assert_eq!(s.files_touched.len(), 1);
    }

    #[test]
    fn post_tool_failure_records_tail() {
        let _g = lock_and_reset();
        memory().record_session_event("fs-5", None, "personas", "/tmp/p", FleetSessionState::Running);
        memory().record_tool_event(
            "fs-5",
            "Bash",
            &json!({"command": "npm test"}),
            false,
            None,
        );
        memory().record_tool_event(
            "fs-5",
            "Bash",
            &json!({"command": "npm test"}),
            true,
            Some(&json!({"exit_code": 1, "stderr": "Error at line 42\nstack..."})),
        );
        let ops = memory().operations.read().unwrap();
        let s = &ops.values().next().unwrap().sessions[0];
        assert!(s.current_tool.is_none()); // cleared on post
        assert!(s.recent_failure.is_some());
    }

    #[test]
    fn synthesize_summary_includes_files_and_duration_and_failure() {
        let _g = lock_and_reset();
        memory().record_session_event("fs-6", None, "personas", "/tmp/p", FleetSessionState::Running);
        memory().record_tool_event("fs-6", "Edit", &json!({"file_path": "src/a.rs"}), false, None);
        memory().record_tool_event("fs-6", "Edit", &json!({"file_path": "src/a.rs"}), true, Some(&json!({})));
        memory().record_tool_event("fs-6", "Bash", &json!({"command": "npm test"}), false, None);
        memory().record_tool_event(
            "fs-6",
            "Bash",
            &json!({"command": "npm test"}),
            true,
            Some(&json!({"exit_code": 1, "stderr": "compile error"})),
        );
        let summary = memory().synthesize_session_summary("fs-6", Some(1));
        assert!(summary.is_some());
        let s = summary.unwrap();
        assert!(s.contains("Files touched"));
        assert!(s.contains("non-zero"));
        assert!(s.contains("Last failure"));
    }

    #[test]
    fn digest_for_prompt_is_empty_when_no_ops() {
        let _g = lock_and_reset();
        assert_eq!(memory().digest_for_prompt(), "");
    }

    #[test]
    fn digest_for_prompt_includes_op_and_session() {
        let _g = lock_and_reset();
        memory().record_session_event("fs-7", Some("cc-7"), "personas", "/tmp/p", FleetSessionState::Running);
        memory().record_tool_event("fs-7", "Edit", &json!({"file_path": "src/foo.rs"}), false, None);
        let d = memory().digest_for_prompt();
        assert!(d.contains("Active orchestration"));
        assert!(d.contains("user spawn in personas"));
        assert!(d.contains("Edit"));
    }
}
