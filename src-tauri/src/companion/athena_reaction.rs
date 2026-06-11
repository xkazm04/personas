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
/// single `{"athena_channel": {...}}` decision object. Lean clone of
/// `idea_scanner::run_idea_scan`'s subprocess handling without the scan-job
/// bookkeeping. Returns `Ok(None)` if no valid decision object was emitted.
async fn cli_decide(prompt_text: String) -> Result<Option<AthenaChannelDecision>, AppError> {
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
    // Subscription-only — never the API account.
    crate::engine::cli_process::force_subscription_auth(&mut cmd);

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

    Ok(parse_athena_decision(&blob))
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
}
