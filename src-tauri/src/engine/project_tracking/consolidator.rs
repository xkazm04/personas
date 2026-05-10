//! Consolidator — turns the raw event log for one project into a
//! stable narrative + named directions + flagged tensions, via a
//! one-shot Sonnet 4.6 CLI call.
//!
//! Pattern mirrors `companion::brain::consolidation::call_claude_oneshot`:
//! ephemeral CLI invocation, no `--resume`, JSON envelope output.
//! The differences are model (`claude-sonnet-4-6` per the locked design
//! decision), shorter timeout (project pulse is much smaller than a
//! brain consolidation), and a different envelope shape.

use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use chrono::{DateTime, Utc};
use rusqlite::params;
use serde::Deserialize;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::time::timeout;
use tracing::{debug, warn};

use crate::companion::brain::episodic::{self, EpisodeRole};
use crate::companion::session::{base_cli_invocation, DEFAULT_SESSION_ID};
use crate::db::UserDbPool;
use crate::engine::project_tracking::events::EventPayload;
use crate::engine::project_tracking::pulse::{
    self, PulseRow, PulseUpdate,
};
use crate::engine::project_tracking::subscription::Subscription;
use crate::error::AppError;

/// Per-tick consolidator timeout. Project pulses are small (one paragraph
/// + 3-5 directions); 90s is generous but not overgenerous given a busy
/// Sonnet endpoint.
const CONSOLIDATOR_TIMEOUT: Duration = Duration::from_secs(90);

/// Locked-design choice: Sonnet 4.6 for the consolidator. The "carry
/// forward / replace / retire" reasoning over directions matters more
/// here than raw speed, and Sonnet handles that materially better than
/// Haiku.
const CONSOLIDATOR_MODEL: &str = "claude-sonnet-4-6";

/// Tauri event emitted after a successful upsert. Companion's brain
/// integration (Phase 5) listens for this to ingest the new pulse into
/// episodic + semantic memory.
const PULSE_UPDATED_EVENT: &str = "project-tracking://pulse-updated";

/// Payload of the JSON envelope Sonnet returns. Tolerant of missing
/// arrays (the model occasionally elides empty `tensions` even when
/// asked for an empty list).
#[derive(Debug, Deserialize, Default)]
struct PulseEnvelope {
    #[serde(default)]
    narrative: String,
    #[serde(default)]
    directions: Vec<String>,
    #[serde(default)]
    tensions: Vec<String>,
}

/// Snapshot of the new events for one tick — partitioned by kind so
/// the prompt can render each section neatly.
pub struct TickSnapshot<'a> {
    pub project_name: String,
    pub commits: Vec<&'a EventPayload>,
    pub runs: Vec<&'a EventPayload>,
    pub notes: Vec<&'a EventPayload>,
}

impl<'a> TickSnapshot<'a> {
    pub fn from_events(project_name: String, events: &'a [EventPayload]) -> Self {
        let mut commits = Vec::new();
        let mut runs = Vec::new();
        let mut notes = Vec::new();
        for ev in events {
            match ev {
                EventPayload::Commit { .. } => commits.push(ev),
                EventPayload::RunStarted { .. } | EventPayload::RunCompleted { .. } => {
                    runs.push(ev)
                }
                EventPayload::Note { .. } => notes.push(ev),
            }
        }
        Self {
            project_name,
            commits,
            runs,
            notes,
        }
    }

    pub fn is_empty(&self) -> bool {
        self.commits.is_empty() && self.runs.is_empty() && self.notes.is_empty()
    }

    pub fn counts(&self) -> (i64, i64, i64) {
        (
            self.commits.len() as i64,
            self.runs.len() as i64,
            self.notes.len() as i64,
        )
    }
}

/// Run a consolidation pass for one project: fetch the prior pulse,
/// build the prompt, call Sonnet, parse the envelope, upsert the pulse,
/// emit `project-tracking://pulse-updated`.
///
/// `app_handle` is optional — if None (e.g. the future once-per-test
/// invocation), the pulse-updated emit is skipped but the upsert still
/// happens.
pub async fn run_for_project(
    pool: &UserDbPool,
    sub: &Subscription,
    snapshot: TickSnapshot<'_>,
    app_handle: Option<&AppHandle>,
) -> Result<(), AppError> {
    if snapshot.is_empty() {
        debug!(
            project_id = %sub.project_id,
            "consolidator: empty snapshot; skipping LLM call",
        );
        return Ok(());
    }

    let prior = pulse::load_today(pool, &sub.project_id)?;
    let project_name = lookup_project_name(pool, &sub.project_id)?;
    let prompt = build_prompt(&project_name, prior.as_ref(), &snapshot);

    let envelope = match call_sonnet_oneshot(&prompt).await {
        Ok(e) => e,
        Err(e) => {
            warn!(
                project_id = %sub.project_id,
                error = %e,
                "consolidator: Sonnet call failed; skipping pulse upsert this tick",
            );
            return Err(e);
        }
    };

    let (commits, runs, notes) = snapshot.counts();
    // Token telemetry: stream-json doesn't surface input/output token
    // counts cheaply; use a coarse estimate (prompt bytes / 4 for input,
    // narrative + directions length / 4 for output). The numbers are
    // cost-tracking, not billing — order-of-magnitude is enough.
    let tokens_in = (prompt.len() / 4) as i64;
    let tokens_out = (envelope.narrative.len()
        + envelope.directions.iter().map(|s| s.len()).sum::<usize>()
        + envelope.tensions.iter().map(|s| s.len()).sum::<usize>())
        as i64
        / 4;

    pulse::upsert_today(
        pool,
        &sub.project_id,
        &PulseUpdate {
            narrative_md: &envelope.narrative,
            directions: &envelope.directions,
            tensions: &envelope.tensions,
            commit_count_delta: commits,
            run_count_delta: runs,
            note_count_delta: notes,
            tokens_in_delta: tokens_in,
            tokens_out_delta: tokens_out,
        },
    )?;

    if let Some(app) = app_handle {
        let _ = app.emit(
            PULSE_UPDATED_EVENT,
            serde_json::json!({
                "projectId": sub.project_id,
                "day": pulse::today_iso(),
            }),
        );
    }

    // Phase 5: append a one-line system episode to companion's episodic
    // memory so the chat-history retrieval path can surface "ran a
    // pulse on X at Y" without reading engine_project_pulse directly.
    // Best-effort — pulse already shipped; episodic write failure
    // shouldn't escalate.
    let directions_summary = if envelope.directions.is_empty() {
        "no active directions".to_string()
    } else {
        envelope
            .directions
            .iter()
            .take(3)
            .cloned()
            .collect::<Vec<_>>()
            .join("; ")
    };
    let episode_body = format!(
        "[project-tracking] {project_name}: pulse refreshed ({commits} commits, {runs} runs). \
         Directions: {directions_summary}.",
        project_name = project_name,
        commits = commits,
        runs = runs,
        directions_summary = directions_summary,
    );
    if let Err(e) = episodic::append_episode(
        pool,
        DEFAULT_SESSION_ID,
        EpisodeRole::System,
        &episode_body,
    ) {
        warn!(
            project_id = %sub.project_id,
            error = %e,
            "consolidator: episodic append failed; pulse upserted but no episode written",
        );
    }

    Ok(())
}

fn lookup_project_name(pool: &UserDbPool, project_id: &str) -> Result<String, AppError> {
    let conn = pool.get()?;
    let name: String = conn.query_row(
        "SELECT name FROM companion_known_project WHERE id = ?1",
        params![project_id],
        |row| row.get(0),
    )?;
    Ok(name)
}

fn build_prompt(
    project_name: &str,
    prior: Option<&PulseRow>,
    snapshot: &TickSnapshot<'_>,
) -> String {
    let mut s = String::new();
    s.push_str(
        "You are tracking a software project. Update your running picture based on the new signals below.\n\n",
    );
    s.push_str(&format!("## Project: {project_name}\n\n"));

    s.push_str("## Prior pulse\n\n");
    match prior {
        Some(p) => {
            s.push_str("NARRATIVE:\n");
            s.push_str(&p.narrative_md);
            s.push_str("\n\nDIRECTIONS:\n");
            for d in &p.directions {
                s.push_str(&format!("- {d}\n"));
            }
            if p.directions.is_empty() {
                s.push_str("(none yet)\n");
            }
            s.push_str("\nTENSIONS:\n");
            for t in &p.tensions {
                s.push_str(&format!("- {t}\n"));
            }
            if p.tensions.is_empty() {
                s.push_str("(none yet)\n");
            }
        }
        None => {
            s.push_str("(no prior pulse — this is the first tick of the day)\n");
        }
    }
    s.push_str("\n");

    let (n_commits, n_runs, n_notes) = snapshot.counts();
    s.push_str("## New signals this tick\n\n");
    s.push_str(&format!("### Commits ({n_commits})\n"));
    for ev in &snapshot.commits {
        if let EventPayload::Commit {
            hash, author, subject, ..
        } = ev
        {
            let short = &hash[..hash.len().min(7)];
            s.push_str(&format!("- `{short}` by {author}: {subject}\n"));
        }
    }
    if n_commits == 0 {
        s.push_str("(none)\n");
    }

    s.push_str(&format!("\n### Runs ({n_runs})\n"));
    for ev in &snapshot.runs {
        match ev {
            EventPayload::RunStarted { slug, timestamp, .. } => {
                s.push_str(&format!("- STARTED at {timestamp}: {slug}\n"));
            }
            EventPayload::RunCompleted {
                slug,
                commit_sha,
                status,
            } => match commit_sha {
                Some(sha) => s.push_str(&format!(
                    "- {} (commit {}): {}\n",
                    status.to_uppercase(),
                    &sha[..sha.len().min(7)],
                    slug
                )),
                None => s.push_str(&format!("- {}: {}\n", status.to_uppercase(), slug)),
            },
            _ => {}
        }
    }
    if n_runs == 0 {
        s.push_str("(none)\n");
    }

    if n_notes > 0 {
        s.push_str(&format!("\n### Notes ({n_notes})\n"));
        for ev in &snapshot.notes {
            if let EventPayload::Note {
                title, summary, ..
            } = ev
            {
                let title_str = title.as_deref().unwrap_or("(untitled)");
                let summary_str = summary.as_deref().unwrap_or("");
                s.push_str(&format!("- {title_str}: {summary_str}\n"));
            }
        }
    }

    s.push_str(
        "\n## Output\n\n\
         Return a single JSON object — no preface, no code fences, no commentary:\n\n\
         {\n  \
           \"narrative\": \"3-5 sentences updating the prior narrative with the new signals. \
                           Don't just append; revise and resolve contradictions.\",\n  \
           \"directions\": [\"3-5 short hypotheses (≤10 words each) about where work is heading. \
                              Carry forward unchanged ones; retire ones contradicted by new signals.\"],\n  \
           \"tensions\": [\"0-3 bullets flagging drift, half-finished work, or contradictions worth surfacing.\"]\n\
         }\n",
    );

    s
}

async fn call_sonnet_oneshot(prompt: &str) -> Result<PulseEnvelope, AppError> {
    let cwd = dirs::home_dir().unwrap_or_else(std::env::temp_dir);
    let (cmd_program, mut argv) = base_cli_invocation();
    argv.extend([
        "-p".into(),
        "-".into(),
        "--output-format".into(),
        "stream-json".into(),
        "--verbose".into(),
        "--dangerously-skip-permissions".into(),
        "--exclude-dynamic-system-prompt-sections".into(),
        "--model".into(),
        CONSOLIDATOR_MODEL.into(),
    ]);

    let mut child = Command::new(&cmd_program)
        .args(&argv)
        .current_dir(&cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC", "1")
        .spawn()
        .map_err(|e| AppError::Internal(format!("spawn claude (project-tracking): {e}")))?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(prompt.as_bytes())
            .await
            .map_err(|e| AppError::Internal(format!("write stdin: {e}")))?;
        drop(stdin);
    }

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::Internal("claude stdout missing".into()))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| AppError::Internal("claude stderr missing".into()))?;

    let stderr_buf = Arc::new(tokio::sync::Mutex::new(String::new()));
    let stderr_handle = {
        let buf = stderr_buf.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let mut g = buf.lock().await;
                if !g.is_empty() {
                    g.push('\n');
                }
                g.push_str(&line);
            }
        })
    };

    let mut assistant_text = String::new();
    let mut reader = BufReader::new(stdout).lines();

    let collect = async {
        while let Some(line) = reader
            .next_line()
            .await
            .map_err(|e| AppError::Internal(format!("read stdout: {e}")))?
        {
            if let Some(delta) = extract_assistant_text(&line) {
                assistant_text.push_str(&delta);
            }
        }
        Ok::<(), AppError>(())
    };

    timeout(CONSOLIDATOR_TIMEOUT, collect)
        .await
        .map_err(|_| {
            AppError::Internal(format!(
                "project-tracking consolidator timed out after {:?}",
                CONSOLIDATOR_TIMEOUT
            ))
        })??;

    let _ = stderr_handle.await;
    let status = child
        .wait()
        .await
        .map_err(|e| AppError::Internal(format!("await claude: {e}")))?;
    if !status.success() {
        let err = stderr_buf.lock().await.clone();
        return Err(AppError::Internal(format!(
            "claude project-tracking exited {}: {}",
            status.code().map(|c| c.to_string()).unwrap_or("?".into()),
            err
        )));
    }

    parse_envelope(&assistant_text)
}

/// Stream-json text-delta extractor. Same shape as the
/// `companion::brain::consolidation::extract_assistant_text` helper.
fn extract_assistant_text(line: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(line).ok()?;
    if v.get("type")?.as_str()? != "assistant" {
        return None;
    }
    let blocks = v.get("message")?.get("content")?.as_array()?;
    let mut out = String::new();
    for b in blocks {
        if b.get("type").and_then(|x| x.as_str()) == Some("text") {
            if let Some(t) = b.get("text").and_then(|x| x.as_str()) {
                out.push_str(t);
            }
        }
    }
    if out.is_empty() {
        None
    } else {
        Some(out)
    }
}

fn parse_envelope(text: &str) -> Result<PulseEnvelope, AppError> {
    let trimmed = text.trim();
    let raw = strip_code_fence(trimmed).unwrap_or(trimmed);
    let start = raw
        .find('{')
        .ok_or_else(|| AppError::Internal("pulse reply missing JSON object".into()))?;
    let end = raw
        .rfind('}')
        .ok_or_else(|| AppError::Internal("pulse reply missing closing brace".into()))?;
    if end <= start {
        return Err(AppError::Internal("pulse reply has no valid JSON span".into()));
    }
    serde_json::from_str(&raw[start..=end]).map_err(|e| {
        AppError::Internal(format!("pulse reply not valid JSON: {e}"))
    })
}

fn strip_code_fence(s: &str) -> Option<&str> {
    let mut s = s;
    if let Some(rest) = s.strip_prefix("```json") {
        s = rest;
    } else if let Some(rest) = s.strip_prefix("```") {
        s = rest;
    } else {
        return None;
    }
    let s = s.trim_start_matches('\n');
    if let Some(end) = s.rfind("```") {
        Some(s[..end].trim())
    } else {
        Some(s.trim())
    }
}

/// Helper used by Phase 5's chat-context preflight: shape a pulse for
/// prompt injection. Returns the rendered Markdown block.
pub fn render_for_prompt(pulse: &PulseRow, project_name: &str) -> String {
    let mut s = String::new();
    s.push_str(&format!("### Project: {project_name} (today)\n\n"));
    if !pulse.narrative_md.is_empty() {
        s.push_str(&pulse.narrative_md);
        s.push_str("\n\n");
    }
    if !pulse.directions.is_empty() {
        s.push_str("**Directions:**\n");
        for d in &pulse.directions {
            s.push_str(&format!("- {d}\n"));
        }
        s.push_str("\n");
    }
    if !pulse.tensions.is_empty() {
        s.push_str("**Tensions:**\n");
        for t in &pulse.tensions {
            s.push_str(&format!("- {t}\n"));
        }
    }
    s
}

/// Placeholder that future code can replace; today's purpose is just
/// to ensure the type is in scope when `chrono` is unused elsewhere.
#[allow(dead_code)]
fn _now() -> DateTime<Utc> {
    Utc::now()
}
