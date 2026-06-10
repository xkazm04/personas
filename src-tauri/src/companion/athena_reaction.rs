//! Athena autonomous CHANNEL REACTIONS (cert: "decision capability + visible
//! reaction throughout development").
//!
//! When the `autonomous_athena_reactions` setting is on, a reactive
//! subscription ([`crate::engine::subscription::AthenaChannelReactionSubscription`])
//! detects reaction-worthy moments in each goal-managed team's development
//! stream — a PR/assignment landing in `awaiting_review` (the QA fix-loop
//! capped out and the team can't self-resolve), a goal-linked assignment
//! shipping, a QA Guardian bounce — and asks **Athena herself** (a headless
//! Claude decision, the same CLI-decision pattern as `run_backlog_triage`)
//! whether and how to react in the team channel.
//!
//! This is a genuine *decision*, not a template: Athena may choose `react:false`
//! (restraint — most routine progress warrants silence), post a plain
//! observation (`consumer='display'`, visible in the Collab channel UI but not
//! injected into any persona's prompt), address a directive to a specific
//! persona (`consumer='inject'`, reaches their next step), and/or escalate to
//! the user. Every reaction she posts carries a one-line rationale footer so the
//! decision trail is auditable from the channel alone. Declines are logged.
//!
//! Why a dedicated path rather than the `proactive/` companion layer: the
//! proactive pipeline targets the *companion surface* (nudges to the user),
//! whereas these reactions belong *in the team channel* (`author_kind='athena'`,
//! the C2 surface). Reusing `channel_repo::create` keeps a single channel-write
//! path shared with `companion_post_team_message`.

use tauri::Manager;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;

use crate::commands::design::analysis::extract_display_text;
use crate::db::models::CreateChannelMessageInput;
use crate::db::repos::resources::team_channel as channel_repo;
use crate::error::AppError;

/// A reaction-worthy development moment Athena may react to. Detected
/// deterministically from the team's assignment stream; the *decision* about
/// whether/how to react is Athena's (the LLM call), not this struct's.
#[derive(Debug, Clone)]
pub struct ReactionSignal {
    pub team_id: String,
    pub team_name: String,
    /// `awaiting_review` | `goal_done` | `qa_bounce`
    pub kind: String,
    pub assignment_id: String,
    pub title: String,
    /// Free-text context (error message / goal text / bounce payload), trimmed.
    pub detail: String,
}

impl ReactionSignal {
    /// Human-readable one-liner describing the moment, for the prompt + logs.
    fn headline(&self) -> &'static str {
        match self.kind.as_str() {
            "awaiting_review" => {
                "A code change is parked in AWAITING-REVIEW — the QA fix-loop reached its \
                 cap without a clean pass, so the team cannot exit this state on its own."
            }
            "goal_done" => "A goal-linked assignment just SHIPPED (status → done).",
            "qa_bounce" => {
                "QA Guardian BOUNCED a PR back to the implementer (changes requested) — \
                 a rework round is now in flight."
            }
            _ => "A development event occurred on the team.",
        }
    }
}

/// Athena's decision protocol — the single JSON object she must emit.
#[derive(Debug, serde::Deserialize)]
struct AthenaChannelEnvelope {
    athena_channel: AthenaChannelDecision,
}

#[derive(Debug, serde::Deserialize)]
struct AthenaChannelDecision {
    /// Whether to post anything at all. Restraint default is `false`.
    react: bool,
    /// The channel message body (omitted/empty when `react=false`).
    #[serde(default)]
    message: String,
    /// One-line justification recorded as the message's auditable footer.
    #[serde(default)]
    rationale: String,
    /// Whether this warrants surfacing to the user (desktop notification).
    #[serde(default)]
    escalate_to_user: bool,
    /// Persona ids to address directly; when non-empty the message is INJECTED
    /// into their next step (`consumer='inject'`), otherwise it is a `display`
    /// observation for the human.
    #[serde(default)]
    addressed_to: Vec<String>,
}

/// Detect the single most recent reaction-worthy moment per goal-managed team
/// that is NEWER than Athena's last channel post in that team (the cursor that
/// gives natural debounce/restraint) and within a 12h lookback (so first-enable
/// doesn't react to ancient backlog). Returns at most one signal per team.
pub fn find_athena_reaction_signals(
    pool: &crate::db::DbPool,
) -> Result<Vec<ReactionSignal>, AppError> {
    let conn = pool.get()?;
    // UNION of the three signal sources, each carrying an `occurred_at` and a
    // priority (lower = more important on a same-timestamp tie). LEFT JOIN the
    // per-team last-athena-post cursor; a team with no prior post uses the 12h
    // floor. Per-team dedupe (latest, then priority) happens in Rust below.
    let mut stmt = conn.prepare(
        "WITH last_athena AS (
             SELECT team_id, MAX(datetime(created_at)) AS last_at
             FROM team_channel_messages WHERE author_kind = 'athena' GROUP BY team_id
         ),
         signals AS (
             SELECT a.team_id AS team_id, 'awaiting_review' AS kind, 0 AS prio,
                    a.id AS aid, a.title AS title,
                    COALESCE(a.error_message, '') AS detail,
                    COALESCE((SELECT MAX(datetime(e.created_at)) FROM team_assignment_events e
                                WHERE e.assignment_id = a.id),
                             datetime(a.created_at)) AS occurred_at
             FROM team_assignments a
             WHERE a.status = 'awaiting_review' AND a.team_id IS NOT NULL
             UNION ALL
             SELECT a.team_id, 'qa_bounce', 1, a.id, a.title,
                    COALESCE(e.payload, ''), datetime(e.created_at)
             FROM team_assignment_events e
             JOIN team_assignments a ON a.id = e.assignment_id
             WHERE e.kind = 'qa_changes_requested_rework' AND a.team_id IS NOT NULL
               AND datetime(e.created_at) > datetime('now', '-12 hours')
             UNION ALL
             SELECT a.team_id, 'goal_done', 2, a.id, a.title,
                    COALESCE(a.goal, ''), datetime(COALESCE(a.completed_at, a.created_at))
             FROM team_assignments a
             WHERE a.status = 'done' AND a.goal_id IS NOT NULL AND a.team_id IS NOT NULL
               AND datetime(COALESCE(a.completed_at, a.created_at)) > datetime('now', '-12 hours')
         )
         SELECT s.team_id, t.name, s.kind, s.aid, s.title, s.detail, s.occurred_at, s.prio
         FROM signals s
         JOIN persona_teams t ON t.id = s.team_id
         LEFT JOIN last_athena la ON la.team_id = s.team_id
         WHERE s.occurred_at > COALESCE(la.last_at, datetime('now', '-12 hours'))
         ORDER BY s.team_id, s.occurred_at DESC, s.prio ASC",
    )?;
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?, // team_id
                r.get::<_, String>(1)?, // team name
                r.get::<_, String>(2)?, // kind
                r.get::<_, String>(3)?, // aid
                r.get::<_, String>(4)?, // title
                r.get::<_, String>(5)?, // detail
            ))
        })?
        .filter_map(Result::ok);

    // Rows are ordered (team_id, occurred_at DESC, prio ASC) → the FIRST row per
    // team is its most-recent, highest-priority unreacted signal. Keep one each.
    let mut out: Vec<ReactionSignal> = Vec::new();
    let mut seen_teams: std::collections::HashSet<String> = std::collections::HashSet::new();
    for (team_id, team_name, kind, aid, title, detail) in rows {
        if !seen_teams.insert(team_id.clone()) {
            continue;
        }
        out.push(ReactionSignal {
            team_id,
            team_name,
            kind,
            assignment_id: aid,
            title,
            detail: crate::utils::text::truncate_on_char_boundary(detail.trim(), 600).to_string(),
        });
    }
    Ok(out)
}

/// Recent channel history (newest last) for continuity in the prompt.
fn recent_channel_history(pool: &crate::db::DbPool, team_id: &str) -> String {
    let Ok(conn) = pool.get() else {
        return String::new();
    };
    let mut stmt = match conn.prepare(
        "SELECT author_kind, body FROM team_channel_messages
         WHERE team_id = ?1 ORDER BY datetime(created_at) DESC LIMIT 8",
    ) {
        Ok(s) => s,
        Err(_) => return String::new(),
    };
    let mut lines: Vec<String> = stmt
        .query_map([team_id], |r| {
            Ok(format!(
                "- {}: {}",
                r.get::<_, String>(0)?,
                crate::utils::text::truncate_on_char_boundary(r.get::<_, String>(1)?.trim(), 200)
            ))
        })
        .map(|rows| rows.filter_map(Result::ok).collect::<Vec<_>>())
        .unwrap_or_default();
    lines.reverse(); // chronological
    lines.join("\n")
}

/// Build Athena's decision prompt. Frames her as the team's orchestrator,
/// gives the moment + recent context, demands restraint, and pins the exact
/// single-line output protocol.
fn build_reaction_prompt(signal: &ReactionSignal, history: &str, ledger: Option<&str>) -> String {
    let history_block = if history.trim().is_empty() {
        "(no recent channel messages)".to_string()
    } else {
        history.to_string()
    };
    let ledger_block = ledger
        .filter(|s| !s.trim().is_empty())
        .map(|s| format!("\n\nTeam ledger (settled decisions/constraints):\n{s}"))
        .unwrap_or_default();

    format!(
        r#"You are **Athena**, the autonomous orchestrator overseeing the team "{team}". You are running unattended. You watch the team's software-delivery stream and decide whether to step into the team channel — the same channel the personas (Dev Clone, QA Guardian, Reviewer, Security, Release, Docs) and the Director use to coordinate.

A development moment just occurred:
- Moment: {headline}
- Kind: `{kind}`
- Artifact: {title}
- Detail: {detail}

Recent channel activity (oldest → newest):
{history}{ledger}

YOUR DECISION
Decide whether to react, and if so, how. Be disciplined — you are judged on RESTRAINT as much as on coverage:
- The DEFAULT is `react: false`. Routine progress does not need narration. Do not congratulate every shipped goal or echo every bounce.
- React when it is genuinely useful to the human or the team:
  • AWAITING-REVIEW cap-out → almost always react AND `escalate_to_user: true`: the team is stuck and only a human can unblock it. Say concisely what's blocked and what call is needed.
  • A QA bounce → usually stay silent (it's normal SDLC); react only if you see a repeating pattern in the history that the team isn't self-correcting, optionally addressing the implementer with one concrete steer.
  • A shipped goal → react only if it's a meaningful milestone worth recording for momentum; otherwise silent.
- If you address a specific persona, put their persona id in `addressed_to` (it will be injected into their next step). Otherwise leave it empty (the message is a visible observation for the human).
- Keep `message` to 1–3 sentences, plain and specific. No filler. `rationale` is one short clause explaining WHY you made this call (it is recorded as an audit footer).

Respond with the analysis you need, then emit EXACTLY ONE line that is this JSON object and nothing else on that line:
{{"athena_channel": {{"react": true|false, "message": "...", "rationale": "...", "escalate_to_user": true|false, "addressed_to": []}}}}
"#,
        team = signal.team_name,
        headline = signal.headline(),
        kind = signal.kind,
        title = signal.title,
        detail = if signal.detail.is_empty() { "(none)" } else { &signal.detail },
        history = history_block,
        ledger = ledger_block,
    )
}

/// Run one Athena reaction decision end-to-end: build context → ask Athena
/// (headless Claude) → parse her decision → post to the channel (or log a
/// decline). Returns `Ok(true)` if she posted, `Ok(false)` if she declined.
pub async fn run_athena_reaction(
    app: &tauri::AppHandle,
    pool: &crate::db::DbPool,
    signal: ReactionSignal,
) -> Result<bool, AppError> {
    let history = recent_channel_history(pool, &signal.team_id);
    let ledger: Option<String> =
        crate::db::repos::resources::team_memories::get_for_injection(pool, &signal.team_id, 8)
            .ok()
            .filter(|m| !m.is_empty())
            .map(|m| {
                m.iter()
                    .map(|tm| format!("- [{}] {}: {}", tm.category, tm.title, tm.content))
                    .collect::<Vec<_>>()
                    .join("\n")
            });
    let prompt = build_reaction_prompt(&signal, &history, ledger.as_deref());

    let decision = cli_decide(prompt).await?;
    let Some(decision) = decision else {
        tracing::warn!(team = %signal.team_name, kind = %signal.kind, "athena_reaction: no decision parsed from CLI output");
        return Ok(false);
    };

    if !decision.react || decision.message.trim().is_empty() {
        // Restraint is a first-class outcome — record it so the cert can score
        // the no-spam axis from the decision trail.
        tracing::info!(
            team = %signal.team_name,
            kind = %signal.kind,
            rationale = %decision.rationale,
            "athena_reaction: declined (react=false) — restraint"
        );
        return Ok(false);
    }

    // Compose the channel body: the message, plus a subtle one-line rationale
    // footer so the decision trail is auditable from the channel alone.
    let escalate_prefix = if decision.escalate_to_user { "⚠️ " } else { "" };
    let body = if decision.rationale.trim().is_empty() {
        format!("{escalate_prefix}{}", decision.message.trim())
    } else {
        format!(
            "{escalate_prefix}{}\n\n› {}",
            decision.message.trim(),
            decision.rationale.trim()
        )
    };

    let addressed_to: Option<Vec<String>> = {
        let cleaned: Vec<String> = decision
            .addressed_to
            .into_iter()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        if cleaned.is_empty() {
            None
        } else {
            Some(cleaned)
        }
    };
    // Injected only when addressed to a persona (reaches their next step);
    // otherwise a visible observation for the human in the Collab UI.
    let consumer = if addressed_to.is_some() { "inject" } else { "display" };

    let posted = channel_repo::create(
        pool,
        CreateChannelMessageInput {
            team_id: signal.team_id.clone(),
            author_kind: "athena".into(),
            author_id: None,
            body: body.clone(),
            addressed_to,
            reply_to: None,
            assignment_id: Some(signal.assignment_id.clone()),
            consumer: Some(consumer.into()),
        },
    )?;

    tracing::info!(
        team = %signal.team_name,
        kind = %signal.kind,
        msg_id = %posted.id,
        escalate = decision.escalate_to_user,
        consumer = %consumer,
        "athena_reaction: posted to team channel"
    );

    if decision.escalate_to_user {
        crate::notifications::send(
            app,
            &format!("Athena · {}", signal.team_name),
            decision.message.trim(),
        );
    }

    Ok(true)
}

/// Spawn the Claude CLI with the prompt on stdin, stream stdout, and parse the
/// single `{"athena_channel": {...}}` decision object. Returns `Ok(None)` if
/// no valid decision object was emitted.
async fn cli_decide(prompt_text: String) -> Result<Option<AthenaChannelDecision>, AppError> {
    let blob = cli_text(prompt_text).await?;
    Ok(parse_athena_decision(&blob))
}

/// Spawn the Claude CLI with the prompt on stdin and return the accumulated
/// display text. Lean clone of `idea_scanner::run_idea_scan`'s subprocess
/// handling without the scan-job bookkeeping; shared by the channel-reaction
/// and review-resolution decisions (each parses its own protocol object).
async fn cli_text(prompt_text: String) -> Result<String, AppError> {
    let mut cli_args = crate::engine::prompt::build_cli_args(None, None);
    cli_args.args.push("--model".to_string());
    cli_args.args.push("claude-sonnet-4-6".to_string());

    // No repo access needed for a channel decision — run in a scratch cwd so we
    // never touch a project working tree.
    let exec_dir = std::env::temp_dir();
    let mut cmd = Command::new(&cli_args.command);
    cmd.args(&cli_args.args)
        .current_dir(&exec_dir)
        .kill_on_drop(true)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    #[cfg(windows)]
    {
        #[allow(unused_imports)]
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    for key in &cli_args.env_removals {
        cmd.env_remove(key);
    }
    for (key, val) in &cli_args.env_overrides {
        cmd.env(key, val);
    }

    let mut child = cmd.spawn().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            AppError::Internal(
                "Claude CLI not found. Install from https://docs.anthropic.com/en/docs/claude-code"
                    .into(),
            )
        } else {
            AppError::Internal(format!("Failed to spawn Claude CLI: {e}"))
        }
    })?;

    if let Some(mut stdin) = child.stdin.take() {
        let bytes = prompt_text.into_bytes();
        tokio::spawn(async move {
            let _ = stdin.write_all(&bytes).await;
            let _ = stdin.shutdown().await;
        });
    }
    // Drain stderr so the pipe never fills and deadlocks the child.
    if let Some(stderr) = child.stderr.take() {
        tokio::spawn(async move {
            let mut reader = BufReader::new(stderr).lines();
            while let Ok(Some(_)) = reader.next_line().await {}
        });
    }

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::Internal("Missing stdout pipe".into()))?;
    let mut reader = BufReader::new(stdout).lines();

    let mut blob = String::new();
    let timeout = std::time::Duration::from_secs(180);
    let stream = tokio::time::timeout(timeout, async {
        while let Ok(Some(line)) = reader.next_line().await {
            if let Some(text) = extract_display_text(&line) {
                blob.push_str(&text);
                blob.push('\n');
            }
        }
    })
    .await;

    if stream.is_err() {
        let _ = child.kill().await;
        let _ = tokio::time::timeout(std::time::Duration::from_secs(5), child.wait()).await;
    } else {
        let _ = child.wait().await;
    }

    Ok(blob)
}

/// Extract the `{"athena_channel": {...}}` object from the model's free-text
/// output: find the marker, walk back to its enclosing `{`, brace-match
/// forward, and deserialize. Tolerant of prose before/after the JSON line.
fn parse_athena_decision(blob: &str) -> Option<AthenaChannelDecision> {
    let marker = "\"athena_channel\"";
    // Scan every occurrence (last one wins if the model restated it).
    let mut result = None;
    let mut search_from = 0;
    while let Some(rel) = blob[search_from..].find(marker) {
        let marker_pos = search_from + rel;
        search_from = marker_pos + marker.len();
        // Walk back to the nearest preceding '{' (the envelope's opening brace).
        let Some(open) = blob[..marker_pos].rfind('{') else {
            continue;
        };
        // Brace-match forward from `open`, respecting string literals.
        if let Some(close) = match_braces(&blob[open..]) {
            let candidate = &blob[open..open + close + 1];
            if let Ok(env) = serde_json::from_str::<AthenaChannelEnvelope>(candidate) {
                result = Some(env.athena_channel);
            }
        }
    }
    result
}

/// Given a slice that starts with `{`, return the byte offset of the matching
/// closing `}` (relative to the slice start), or `None` if unbalanced.
fn match_braces(s: &str) -> Option<usize> {
    let bytes = s.as_bytes();
    let mut depth = 0i32;
    let mut in_str = false;
    let mut escaped = false;
    for (i, &b) in bytes.iter().enumerate() {
        if in_str {
            if escaped {
                escaped = false;
            } else if b == b'\\' {
                escaped = true;
            } else if b == b'"' {
                in_str = false;
            }
            continue;
        }
        match b {
            b'"' => in_str = true,
            b'{' => depth += 1,
            b'}' => {
                depth -= 1;
                if depth == 0 {
                    return Some(i);
                }
            }
            _ => {}
        }
    }
    None
}

// ---------------------------------------------------------------------------
// Review resolution (B) — Athena RESOLVES parked awaiting_review cap-outs
// ---------------------------------------------------------------------------
//
// A QA fix-loop cap-out parks the assignment in `awaiting_review` — and the
// 06-09 fleet deadlock showed a parked review starves the whole pipeline
// (goal-slot held → re-advance blocked → backlog promotion starved). With
// `autonomous_athena_review_resolution` ON, Athena doesn't just react: she
// makes a three-way RESOLUTION decision per parked assignment:
//
//   APPROVE  — the QA objections are resolved/stale/acceptable. She posts her
//              assessment as an inject-directive addressed to the QA persona
//              and grants exactly ONE extra QA round (reset failed step →
//              pending via the auto-resume machinery). QA keeps sole merge
//              authority — Athena never merges, she un-parks the loop.
//   INCIDENT — the blocker is access/credential/external-shaped (missing PAT,
//              401, permission denied, env not provisioned). Not a review
//              decision — transformed into an `audit_incidents` row so it gets
//              the Incidents lifecycle + escalation-close machinery.
//   ESCALATE — a genuine product/business call only the human can make.
//              Channel post + notification (the reactions-only behavior).
//
// One resolution per assignment, ever: the `athena_review_resolution`
// assignment event is the guard (a re-parked assignment after her approve
// round is the human's, not hers — prevents approve ping-pong).

/// A parked assignment Athena may resolve, with the context her decision needs.
pub struct ReviewResolutionCandidate {
    pub assignment_id: String,
    pub team_id: String,
    pub team_name: String,
    pub title: String,
    /// The failed (cap-out / blocking) steps: (step_id, title, error_message,
    /// output_tail, assigned_persona_id, retry_count).
    pub failed_steps: Vec<FailedStepContext>,
}

pub struct FailedStepContext {
    pub step_id: String,
    pub title: String,
    pub error_message: String,
    pub output_tail: String,
    pub assigned_persona_id: Option<String>,
    pub retry_count: i32,
}

/// Parked `awaiting_review` assignments on goal-managed teams that Athena has
/// NEVER resolved (the once-per-assignment guard). No recency cursor — parked
/// work stays a candidate until resolved, however old.
pub fn find_review_resolution_candidates(
    pool: &crate::db::DbPool,
    limit: usize,
) -> Result<Vec<ReviewResolutionCandidate>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT a.id, a.team_id, t.name, a.title
         FROM team_assignments a
         JOIN persona_teams t ON t.id = a.team_id
         WHERE a.status = 'awaiting_review' AND a.team_id IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM team_assignment_events e
                             WHERE e.assignment_id = a.id
                               AND e.kind = 'athena_review_resolution')
         ORDER BY datetime(a.created_at) ASC
         LIMIT ?1",
    )?;
    let heads: Vec<(String, String, String, String)> = stmt
        .query_map([limit as i64], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
        })?
        .filter_map(Result::ok)
        .collect();

    let mut out = Vec::new();
    for (assignment_id, team_id, team_name, title) in heads {
        let mut step_stmt = conn.prepare(
            "SELECT id, title, COALESCE(error_message,''), COALESCE(output_summary,''),
                    assigned_persona_id, retry_count
             FROM team_assignment_steps
             WHERE assignment_id = ?1 AND status = 'failed'
             ORDER BY step_order ASC",
        )?;
        let failed_steps: Vec<FailedStepContext> = step_stmt
            .query_map([&assignment_id], |r| {
                Ok(FailedStepContext {
                    step_id: r.get(0)?,
                    title: r.get(1)?,
                    error_message: r.get(2)?,
                    output_tail: r.get(3)?,
                    assigned_persona_id: r.get(4)?,
                    retry_count: r.get(5)?,
                })
            })?
            .filter_map(Result::ok)
            .map(|mut s| {
                s.error_message =
                    crate::utils::text::truncate_on_char_boundary(s.error_message.trim(), 400)
                        .to_string();
                s.output_tail = {
                    // tail, not head — the verdict lands at the end
                    let t = s.output_tail.trim();
                    let chars: Vec<char> = t.chars().collect();
                    let start = chars.len().saturating_sub(900);
                    chars[start..].iter().collect::<String>()
                };
                s
            })
            .collect();
        if failed_steps.is_empty() {
            continue; // nothing actionable (shouldn't happen for a cap-out)
        }
        out.push(ReviewResolutionCandidate {
            assignment_id,
            team_id,
            team_name,
            title,
            failed_steps,
        });
    }
    Ok(out)
}

/// Athena's review-resolution protocol object.
#[derive(Debug, serde::Deserialize)]
struct AthenaReviewEnvelope {
    athena_review: AthenaReviewDecision,
}

#[derive(Debug, serde::Deserialize)]
struct AthenaReviewDecision {
    /// `approve` | `incident` | `escalate`
    resolution: String,
    /// Channel message body (her assessment / escalation text).
    #[serde(default)]
    message: String,
    /// One-line justification — the auditable footer.
    #[serde(default)]
    rationale: String,
    /// Incident title when resolution = incident.
    #[serde(default)]
    incident_title: String,
}

fn build_review_resolution_prompt(c: &ReviewResolutionCandidate, history: &str) -> String {
    let steps_block = c
        .failed_steps
        .iter()
        .map(|s| {
            format!(
                "- Step \"{}\" (QA rounds used: {})\n  Error: {}\n  Last output (tail): {}",
                s.title,
                s.retry_count,
                if s.error_message.is_empty() { "(none)" } else { &s.error_message },
                if s.output_tail.is_empty() { "(none)" } else { &s.output_tail },
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    let history_block = if history.trim().is_empty() {
        "(no recent channel messages)".to_string()
    } else {
        history.to_string()
    };

    format!(
        r#"You are **Athena**, the autonomous orchestrator for the team "{team}". You are running unattended; the human is away. An assignment is PARKED in awaiting-review — the QA fix-loop reached its cap without a clean pass, and the team cannot exit this state on its own. You are the resolution authority of last resort before the human.

Assignment: {title}

Blocking step(s):
{steps}

Recent channel activity (oldest → newest):
{history}

YOUR RESOLUTION — pick exactly one:
- "approve": Use when the QA objections look RESOLVED, STALE, or ACCEPTABLE on the evidence (e.g. the PR already merged and the loop gated a closed PR; the remaining findings are nits; the failure is a flaky gate, not the work). This grants the team exactly ONE extra QA round: your message is delivered to the QA persona as a direct instruction, and QA re-verifies and keeps SOLE merge authority — you are not merging, you are un-parking the loop with your assessment. Write `message` as the instruction to QA: what you assessed, what to re-verify, and that they should merge if it passes.
- "incident": Use when the real blocker is access/credential/environment-shaped — missing or invalid credential/PAT, 401/403/permission denied, unprovisioned environment, an external service the team cannot reach. That is not a review decision; it becomes a tracked INCIDENT for the human to fix. Set `incident_title` to a crisp one-liner naming the missing access.
- "escalate": Use when this is a genuine product/business/policy call only the human can make, or the evidence is too ambiguous to approve safely. Write `message` as the concise brief to the human: what's blocked, what call is needed.

Be honest and conservative: approve only what you can defend from the evidence above. `rationale` is one short clause explaining WHY (recorded as the audit footer).

Respond with the analysis you need, then emit EXACTLY ONE line that is this JSON object and nothing else on that line:
{{"athena_review": {{"resolution": "approve"|"incident"|"escalate", "message": "...", "rationale": "...", "incident_title": ""}}}}
"#,
        team = c.team_name,
        title = c.title,
        steps = steps_block,
        history = history_block,
    )
}

/// cfg-gated accessor for the optional ml-feature EmbeddingManager off
/// AppState (mirrors `commands::teams::assignments::embedding_manager_for_state`,
/// which needs a tauri `State<>` wrapper we don't have here).
#[cfg(feature = "ml")]
fn embedding_manager_of(
    state: &std::sync::Arc<crate::AppState>,
) -> Option<std::sync::Arc<crate::engine::embedder::EmbeddingManager>> {
    state.embedding_manager.clone()
}
#[cfg(not(feature = "ml"))]
fn embedding_manager_of(
    _state: &std::sync::Arc<crate::AppState>,
) -> Option<std::sync::Arc<crate::engine::team_assignment_matching::EmbeddingManager>> {
    None
}

/// Run one review resolution end-to-end. Returns the outcome label
/// (`approve` / `incident` / `escalate` / `none`).
pub async fn run_athena_review_resolution(
    app: &tauri::AppHandle,
    pool: &crate::db::DbPool,
    candidate: ReviewResolutionCandidate,
) -> Result<&'static str, AppError> {
    let history = recent_channel_history(pool, &candidate.team_id);
    let prompt = build_review_resolution_prompt(&candidate, &history);
    let blob = cli_text(prompt).await?;
    let Some(decision) = parse_athena_review(&blob) else {
        tracing::warn!(team = %candidate.team_name, assignment = %candidate.assignment_id,
            "athena_review_resolution: no decision parsed");
        return Ok("none");
    };

    let outcome: &'static str = match decision.resolution.as_str() {
        "approve" => "approve",
        "incident" => "incident",
        _ => "escalate",
    };

    // The once-per-assignment guard — recorded FIRST so even a partially
    // failed action never lets Athena re-decide this assignment.
    let payload = serde_json::json!({
        "outcome": outcome,
        "rationale": decision.rationale,
    })
    .to_string();
    crate::db::repos::orchestration::team_assignments::insert_event(
        pool,
        &candidate.assignment_id,
        None,
        "athena_review_resolution",
        Some(&payload),
    )?;

    let rationale_footer = if decision.rationale.trim().is_empty() {
        String::new()
    } else {
        format!("\n\n› {}", decision.rationale.trim())
    };

    match outcome {
        "approve" => {
            // 1) Her assessment goes to the QA persona as an inject-directive
            //    (reaches their next step via the channel-injection machinery).
            let qa_ids: Vec<String> = candidate
                .failed_steps
                .iter()
                .filter_map(|s| s.assigned_persona_id.clone())
                .collect();
            let body = format!(
                "✅ Review resolution — one more QA round granted.\n{}{}",
                decision.message.trim(),
                rationale_footer
            );
            let _ = channel_repo::create(
                pool,
                CreateChannelMessageInput {
                    team_id: candidate.team_id.clone(),
                    author_kind: "athena".into(),
                    author_id: None,
                    body,
                    addressed_to: if qa_ids.is_empty() { None } else { Some(qa_ids) },
                    reply_to: None,
                    assignment_id: Some(candidate.assignment_id.clone()),
                    consumer: Some("inject".into()),
                },
            );
            // 2) Reset the failed step(s) → pending + restore cascade-skipped
            //    dependents + resume the tick (the existing auto-resume path).
            let Some(state) = app.try_state::<std::sync::Arc<crate::AppState>>() else {
                return Err(AppError::Internal("AppState unavailable".into()));
            };
            let state = state.inner().clone();
            let step_ids: Vec<String> = candidate
                .failed_steps
                .iter()
                .map(|s| s.step_id.clone())
                .collect();
            crate::engine::team_assignment_orchestrator::auto_resume_retryable_steps(
                std::sync::Arc::new(pool.clone()),
                app.clone(),
                state.engine.clone(),
                embedding_manager_of(&state),
                &candidate.assignment_id,
                &step_ids,
            )?;
            tracing::info!(team = %candidate.team_name, assignment = %candidate.assignment_id,
                "athena_review_resolution: APPROVED — one extra QA round granted");
        }
        "incident" => {
            let title = if decision.incident_title.trim().is_empty() {
                format!("Access blocker: {}", candidate.title)
            } else {
                decision.incident_title.trim().to_string()
            };
            let _ = crate::db::repos::execution::audit_incidents::promote(
                pool,
                crate::db::models::CreateAuditIncidentInput {
                    source_table: "team_assignments".to_string(),
                    source_id: candidate.assignment_id.clone(),
                    persona_id: None,
                    persona_name: Some("Athena".to_string()),
                    execution_id: None,
                    severity: "high".to_string(),
                    kind: "review_blocker".to_string(),
                    title,
                    detail: Some(format!(
                        "{}\n\nRationale: {}\n\nParked assignment: {} (team {}). Resolve the \
                         access/credential issue, then resume the assignment from the review modal.",
                        decision.message.trim(),
                        decision.rationale.trim(),
                        candidate.title,
                        candidate.team_name
                    )),
                },
            );
            let body = format!(
                "🔐 {}\n{}{}",
                "This review is blocked on missing access — transformed into an incident for you.",
                decision.message.trim(),
                rationale_footer
            );
            let _ = channel_repo::create(
                pool,
                CreateChannelMessageInput {
                    team_id: candidate.team_id.clone(),
                    author_kind: "athena".into(),
                    author_id: None,
                    body,
                    addressed_to: None,
                    reply_to: None,
                    assignment_id: Some(candidate.assignment_id.clone()),
                    consumer: Some("display".into()),
                },
            );
            crate::notifications::send(
                app,
                &format!("Athena · {} — access blocker", candidate.team_name),
                decision.message.trim(),
            );
            tracing::info!(team = %candidate.team_name, assignment = %candidate.assignment_id,
                "athena_review_resolution: INCIDENT raised (access blocker)");
        }
        _ => {
            let body = format!("⚠️ {}{}", decision.message.trim(), rationale_footer);
            let _ = channel_repo::create(
                pool,
                CreateChannelMessageInput {
                    team_id: candidate.team_id.clone(),
                    author_kind: "athena".into(),
                    author_id: None,
                    body,
                    addressed_to: None,
                    reply_to: None,
                    assignment_id: Some(candidate.assignment_id.clone()),
                    consumer: Some("display".into()),
                },
            );
            crate::notifications::send(
                app,
                &format!("Athena · {} — needs your call", candidate.team_name),
                decision.message.trim(),
            );
            tracing::info!(team = %candidate.team_name, assignment = %candidate.assignment_id,
                "athena_review_resolution: ESCALATED to human");
        }
    }
    Ok(outcome)
}

/// Extract the `{"athena_review": {...}}` object (same tolerant brace-matching
/// as `parse_athena_decision`).
fn parse_athena_review(blob: &str) -> Option<AthenaReviewDecision> {
    let marker = "\"athena_review\"";
    let mut result = None;
    let mut search_from = 0;
    while let Some(rel) = blob[search_from..].find(marker) {
        let marker_pos = search_from + rel;
        search_from = marker_pos + marker.len();
        let Some(open) = blob[..marker_pos].rfind('{') else {
            continue;
        };
        if let Some(close) = match_braces(&blob[open..]) {
            if let Ok(env) =
                serde_json::from_str::<AthenaReviewEnvelope>(&blob[open..open + close + 1])
            {
                result = Some(env.athena_review);
            }
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_clean_decision_line() {
        let blob = r#"Some reasoning here.
{"athena_channel": {"react": true, "message": "PR #4 is blocked on a migration.", "rationale": "cap-out needs a human", "escalate_to_user": true, "addressed_to": []}}
trailing text"#;
        let d = parse_athena_decision(blob).expect("should parse");
        assert!(d.react);
        assert!(d.escalate_to_user);
        assert!(d.message.contains("blocked"));
        assert_eq!(d.rationale, "cap-out needs a human");
        assert!(d.addressed_to.is_empty());
    }

    #[test]
    fn parses_decline_with_minimal_fields() {
        let blob = r#"{"athena_channel": {"react": false}}"#;
        let d = parse_athena_decision(blob).expect("should parse");
        assert!(!d.react);
        assert!(d.message.is_empty());
        assert!(!d.escalate_to_user);
    }

    #[test]
    fn parses_addressed_directive() {
        let blob = r#"prose {"athena_channel":{"react":true,"message":"Dev Clone, stabilize the flaky test.","rationale":"repeating bounce pattern","escalate_to_user":false,"addressed_to":["persona-123"]}} more"#;
        let d = parse_athena_decision(blob).expect("should parse");
        assert!(d.react);
        assert_eq!(d.addressed_to, vec!["persona-123".to_string()]);
    }

    #[test]
    fn last_occurrence_wins() {
        let blob = r#"{"athena_channel":{"react":false}}
later corrected: {"athena_channel":{"react":true,"message":"final","rationale":"r"}}"#;
        let d = parse_athena_decision(blob).expect("should parse");
        assert!(d.react);
        assert_eq!(d.message, "final");
    }

    #[test]
    fn returns_none_without_marker() {
        assert!(parse_athena_decision("no decision here {\"foo\": 1}").is_none());
    }

    #[test]
    fn match_braces_respects_strings() {
        // A `}` inside a string literal must not close the object early.
        let s = r#"{"a": "x}y", "b": 1}"#;
        let close = match_braces(s).unwrap();
        assert_eq!(&s[..close + 1], s);
    }

    #[test]
    fn parses_review_approve() {
        let blob = r#"analysis...
{"athena_review": {"resolution": "approve", "message": "QA: PR #17 already merged — re-verify and close the loop.", "rationale": "loop gated a closed PR", "incident_title": ""}}"#;
        let d = parse_athena_review(blob).expect("should parse");
        assert_eq!(d.resolution, "approve");
        assert!(d.message.contains("re-verify"));
        assert_eq!(d.rationale, "loop gated a closed PR");
    }

    #[test]
    fn parses_review_incident_with_title() {
        let blob = r#"{"athena_review":{"resolution":"incident","message":"Push rejected 403 — the team PAT lacks write access.","rationale":"credential-shaped","incident_title":"GitHub PAT missing write scope"}}"#;
        let d = parse_athena_review(blob).expect("should parse");
        assert_eq!(d.resolution, "incident");
        assert_eq!(d.incident_title, "GitHub PAT missing write scope");
    }

    #[test]
    fn review_parser_ignores_channel_protocol() {
        // The review parser must not match the reaction protocol's envelope.
        let blob = r#"{"athena_channel": {"react": true, "message": "x"}}"#;
        assert!(parse_athena_review(blob).is_none());
    }
}
