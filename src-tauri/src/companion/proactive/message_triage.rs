//! Autonomous MESSAGE triage — the Overview → Messages counterpart of
//! Athena's human-review resolution.
//!
//! Personas write `persona_messages` rows at the user constantly; at
//! fleet scale most of them are operational confirmations nobody needs
//! to read. With `autonomous_message_triage` on (a distinct opt-in on
//! top of autonomous mode), each proactive tick batches the unread
//! inbox through ONE headless Athena decision (the same `cli_text`
//! pattern as channel reactions / review resolution — zero chat
//! episodes) that classifies every message:
//!
//!   - **done**      — routine, no decision content: marked read, with an
//!                     `athena_triage` audit annotation in the message's
//!                     metadata so "why is this read?" is answerable.
//!   - **digest**    — business value worth knowing but not worth a full
//!                     read: its essence is folded into one aggregated
//!                     `message_digest` proactive card, then marked read
//!                     (same audit annotation).
//!   - **attention** — the user should read this personally (decisions,
//!                     questions, money/security/credentials): stays
//!                     UNREAD, is listed on the card, and fires a desktop
//!                     notification (quiet-hours guarded).
//!
//! Safety floor in code, not just prompt: messages with high/urgent/
//! critical priority are forced to `attention` regardless of the model's
//! verdict — Athena can summarize them but never silently swallow them.
//!
//! Cursor: `companion_msg_triage_cursor` (ISO8601 `created_at`). Unlike
//! the exec-review cursor it advances only past the batch actually
//! processed (oldest-first, `BATCH_LIMIT` per tick), so a backlog drains
//! progressively. First enable seeds the cursor to "now": the historical
//! unread pile stays untouched for the user (no retroactive mass-read).

use crate::db::repos::communication::messages as msg_repo;
use crate::db::settings_keys::{AUTONOMOUS_MESSAGE_TRIAGE, COMPANION_MSG_TRIAGE_CURSOR};
use crate::db::DbPool;
use crate::error::AppError;

/// Proactive-card trigger kind for the aggregated digest.
pub const TRIGGER_KIND: &str = "message_digest";

/// Trigger kind for per-message "needs your personal read" items fed into the
/// hands-free decision queue (C1). One row per attention message, deduped by
/// the message id, no budget cost — these already won triage.
pub const ATTENTION_TRIGGER_KIND: &str = "message_attention";

/// Most unread messages triaged per tick — one CLI decision covers the
/// whole batch. At the 5-min cadence this drains ~240 messages/hour,
/// which outruns any sane persona fleet; a deeper backlog just takes a
/// few ticks longer (the cursor never skips).
const BATCH_LIMIT: i64 = 20;

/// Content excerpt fed to the triage per message. Heads, not tails —
/// persona reports put the lede first.
const CONTENT_EXCERPT_CHARS: usize = 400;

/// Most attention/digest lines rendered onto one card.
const MAX_CARD_LINES: usize = 8;

fn triage_enabled(sys_db: &DbPool) -> bool {
    matches!(
        crate::db::repos::core::settings::get(sys_db, AUTONOMOUS_MESSAGE_TRIAGE),
        Ok(Some(v)) if v == "true"
    )
}

fn read_cursor(sys_db: &DbPool) -> Option<String> {
    crate::db::repos::core::settings::get(sys_db, COMPANION_MSG_TRIAGE_CURSOR)
        .ok()
        .flatten()
}

fn advance_cursor(sys_db: &DbPool, newest: &str) {
    if let Err(e) = crate::db::repos::core::settings::set(sys_db, COMPANION_MSG_TRIAGE_CURSOR, newest)
    {
        tracing::warn!(error = %e, "message_triage: failed to advance cursor");
    }
}

/// Athena's message-triage protocol — the single JSON object she must emit.
#[derive(Debug, serde::Deserialize)]
struct MsgTriageEnvelope {
    athena_messages: MsgTriageDecision,
}

#[derive(Debug, serde::Deserialize)]
struct MsgTriageDecision {
    /// One verdict per message, keyed by the message id she was shown.
    #[serde(default)]
    items: Vec<MsgItemVerdict>,
    /// 1–3 sentence digest of the business-relevant content across the
    /// batch — the card body. Empty when nothing is worth summarizing.
    #[serde(default)]
    summary: String,
}

#[derive(Debug, serde::Deserialize)]
struct MsgItemVerdict {
    id: String,
    /// `done` | `digest` | `attention`
    action: String,
    /// One short clause: for `done`/`digest` the audit rationale, for
    /// `attention` why the user must read it personally.
    #[serde(default)]
    note: String,
}

/// The code-level safety floor: high/urgent/critical priority can never
/// be auto-resolved — whatever the model said, it stays unread for the
/// user. Returns the effective action.
fn effective_action(priority: &str, model_action: &str) -> &'static str {
    let elevated = matches!(priority, "high" | "urgent" | "critical");
    match model_action {
        _ if elevated => "attention",
        "done" => "done",
        "digest" => "digest",
        _ => "attention",
    }
}

fn build_triage_prompt(batch: &[msg_repo::UnreadMessageForTriage]) -> String {
    let mut listing = String::new();
    for m in batch {
        let excerpt: String = {
            let trimmed = m.content.trim();
            if trimmed.chars().count() <= CONTENT_EXCERPT_CHARS {
                trimmed.to_string()
            } else {
                let head: String = trimmed.chars().take(CONTENT_EXCERPT_CHARS).collect();
                format!("{head}…")
            }
        };
        listing.push_str(&format!(
            "- id: {id}\n  from: {persona}\n  title: {title}\n  priority: {priority}\n  created: {created}\n  content: {excerpt}\n",
            id = m.id,
            persona = m.persona_name,
            title = m.title.as_deref().unwrap_or("(untitled)"),
            priority = m.priority,
            created = m.created_at,
            excerpt = excerpt,
        ));
    }

    format!(
        r#"You are **Athena**, the autonomous orchestrator of this Personas workspace, running unattended. Personas send the user messages constantly; at fleet scale most are operational confirmations nobody needs to read. You triage the unread inbox so only real signal reaches the user — exactly the way you already resolve human reviews.

Unread messages (oldest first):
{listing}

YOUR TRIAGE — one verdict per message id:
- "done": routine operational chatter — success confirmations, periodic status with nothing new, restated information the user already has. It is marked READ with your note as the audit trail. THE DEFAULT for fleet noise.
- "digest": carries business value worth knowing, but a one-line summary serves the user better than the full text. It is folded into ONE aggregated card and then marked read. Put the value into `note` (≤140 chars, concrete numbers/names).
- "attention": the user should read this personally — it asks a question, needs a decision, touches money/credentials/security/data-loss, or reports something genuinely new and important. It stays UNREAD and is flagged to the user.
- When unsure between done and digest, pick digest. NEVER "done" anything containing a question to the user, a decision request, or money/security/credential content. High/urgent-priority messages are forced to "attention" by the system regardless of your verdict.
- `summary`: 1–3 sentences distilling the business-relevant content of the whole batch (the card body). Empty string if nothing is worth summarizing.
- `note` on every item: one short clause (audit trail for done/digest; the "why you" for attention).

Respond with the analysis you need, then emit EXACTLY ONE line that is this JSON object and nothing else on that line:
{{"athena_messages": {{"items": [{{"id": "...", "action": "done"|"digest"|"attention", "note": "..."}}], "summary": "..."}}}}
"#,
        listing = listing,
    )
}

/// Extract the `{"athena_messages": {...}}` object (same tolerant
/// brace-matching as the other Athena decision parsers; last wins).
fn parse_message_triage(blob: &str) -> Option<MsgTriageDecision> {
    let marker = "\"athena_messages\"";
    let mut result = None;
    let mut search_from = 0;
    while let Some(rel) = blob[search_from..].find(marker) {
        let marker_pos = search_from + rel;
        search_from = marker_pos + marker.len();
        let Some(open) = blob[..marker_pos].rfind('{') else {
            continue;
        };
        if let Some(close) = crate::companion::athena_reaction::match_braces(&blob[open..]) {
            if let Ok(env) =
                serde_json::from_str::<MsgTriageEnvelope>(&blob[open..open + close + 1])
            {
                result = Some(env.athena_messages);
            }
        }
    }
    result
}

/// Compose the aggregated `message_digest` card body.
fn compose_card(
    summary: &str,
    attention: &[(String, String, String)], // (persona, title, note)
    digested: usize,
    done: usize,
) -> String {
    let mut msg = String::new();
    let summary = summary.trim();
    if !summary.is_empty() {
        msg.push_str(summary);
    }
    if !attention.is_empty() {
        if !msg.is_empty() {
            msg.push('\n');
        }
        msg.push_str("Needs your personal read (left unread in Overview → Messages):");
        for (persona, title, note) in attention.iter().take(MAX_CARD_LINES) {
            let why = if note.trim().is_empty() {
                String::new()
            } else {
                format!(" — {}", note.trim())
            };
            msg.push_str(&format!("\n• {persona}: {title}{why}"));
        }
        if attention.len() > MAX_CARD_LINES {
            msg.push_str(&format!("\n• …and {} more", attention.len() - MAX_CARD_LINES));
        }
    }
    if done + digested > 0 {
        if !msg.is_empty() {
            msg.push('\n');
        }
        msg.push_str(&format!(
            "({done} routine message(s) marked read, {digested} summarized — each carries an audit note)"
        ));
    }
    msg
}

/// Entry point called from the proactive tick (after the exec-review
/// leg). The caller has already confirmed autonomous mode is on; this
/// additionally gates on the `autonomous_message_triage` opt-in. Returns
/// the number of messages triaged (for telemetry).
pub async fn triage_unread_messages(
    user_db: &crate::db::UserDbPool,
    sys_db: &DbPool,
    app: &tauri::AppHandle,
) -> Result<usize, AppError> {
    if !triage_enabled(sys_db) {
        return Ok(0);
    }

    // First enable: seed to "now" — never retroactively mass-read the
    // historical unread pile.
    let cursor = match read_cursor(sys_db) {
        Some(c) => c,
        None => {
            let now = chrono::Utc::now().to_rfc3339();
            advance_cursor(sys_db, &now);
            return Ok(0);
        }
    };

    let batch = msg_repo::list_unread_after(sys_db, &cursor, BATCH_LIMIT)?;
    if batch.is_empty() {
        return Ok(0);
    }
    // Wake window: high/urgent/critical messages bypass the timer (the same
    // priority floor effective_action() enforces on verdicts).
    let has_priority = batch
        .iter()
        .any(|m| matches!(m.priority.as_str(), "high" | "urgent" | "critical"));
    let wake = crate::companion::wake_window::gate(
        sys_db,
        "message_triage",
        batch.len(),
        has_priority,
    );
    if !wake.due {
        return Ok(0); // cursor untouched — the batch keeps accumulating
    }
    let wake_started = std::time::Instant::now();
    let wake_pending = batch.len();
    // Oldest-first: the last row is the newest of this batch — the
    // cursor target once the batch is handled (or skipped).
    let batch_newest = batch
        .last()
        .map(|m| m.created_at.clone())
        .unwrap_or_else(|| cursor.clone());

    tracing::info!(batch = batch.len(), "message_triage: running batched triage decision");
    let prompt = build_triage_prompt(&batch);
    let (blob, turn_id) =
        crate::companion::athena_reaction::cli_text_tracked(prompt, user_db, "msg_triage").await?;
    let Some(decision) = parse_message_triage(&blob) else {
        // Poison-batch guard: skip past it rather than re-running the
        // same undecidable batch every tick. The messages simply stay
        // unread for the user — the safe failure mode.
        tracing::warn!(
            "message_triage: no decision parsed — skipping batch (messages stay unread)"
        );
        if let Some(tid) = &turn_id {
            crate::companion::turn_ledger::update_outcome(
                user_db,
                tid,
                r#"{"parse_failure":true}"#,
            );
        }
        advance_cursor(sys_db, &batch_newest);
        return Ok(0);
    };

    crate::companion::wake_window::log_wake(
        sys_db, "message_triage", wake.reason, wake_pending, 1, decision.items.len(),
        wake_started.elapsed().as_millis() as u64,
    );
    let mut done = 0usize;
    let mut digested = 0usize;
    let mut attention: Vec<(String, String, String)> = Vec::new();
    // (message_id, persona, title, note) for the per-item decision-queue rows (C1).
    let mut attention_refs: Vec<(String, String, String, String)> = Vec::new();
    let mut touched = 0usize;
    for v in &decision.items {
        // Ignore hallucinated ids — only messages from this batch count.
        let Some(m) = batch.iter().find(|m| m.id == v.id) else {
            continue;
        };
        touched += 1;
        let action = effective_action(&m.priority, v.action.as_str());
        if action != v.action {
            tracing::info!(
                id = %m.id,
                priority = %m.priority,
                model_action = %v.action,
                "message_triage: verdict overridden to attention (priority guard)"
            );
        }
        if let Err(e) = msg_repo::annotate_athena_triage(sys_db, &m.id, action, v.note.trim()) {
            tracing::warn!(id = %m.id, error = %e, "message_triage: annotation failed");
        }
        match action {
            "done" => {
                if let Err(e) = msg_repo::mark_as_read(sys_db, &m.id) {
                    tracing::warn!(id = %m.id, error = %e, "message_triage: mark_as_read failed");
                } else {
                    done += 1;
                }
            }
            "digest" => {
                if let Err(e) = msg_repo::mark_as_read(sys_db, &m.id) {
                    tracing::warn!(id = %m.id, error = %e, "message_triage: mark_as_read failed");
                } else {
                    digested += 1;
                }
            }
            _ => {
                let title = m.title.clone().unwrap_or_else(|| "(untitled)".into());
                attention.push((m.persona_name.clone(), title.clone(), v.note.clone()));
                attention_refs.push((
                    m.id.clone(),
                    m.persona_name.clone(),
                    title,
                    v.note.clone(),
                ));
            }
        }
    }
    let untouched = batch.len() - touched;
    if untouched > 0 {
        // Verdict-less messages stay unread with no annotation — the
        // user keeps them; the cursor still moves on (no livelock).
        tracing::info!(untouched, "message_triage: messages left untouched (no verdict)");
    }

    // Record the triage verdict distribution on the ledger row (A4 funnel).
    if let Some(tid) = &turn_id {
        let outcome = serde_json::json!({
            "messages": batch.len(),
            "done": done,
            "digest": digested,
            "attention": attention.len(),
        })
        .to_string();
        crate::companion::turn_ledger::update_outcome(user_db, tid, &outcome);
    }

    advance_cursor(sys_db, &batch_newest);

    // One aggregated card per pass when there's anything to say; hour-
    // bucketed dedupe so a flood collapses instead of stacking cards.
    if !decision.summary.trim().is_empty() || !attention.is_empty() || done + digested > 0 {
        let message = compose_card(&decision.summary, &attention, digested, done);
        let bucket = chrono::Utc::now().format("%Y-%m-%dT%H").to_string();
        let nudge = super::Nudge {
            trigger_kind: TRIGGER_KIND.to_string(),
            trigger_ref: Some(format!("bucket:{bucket}")),
            message,
        };
        match super::enqueue_external(user_db, &nudge) {
            Ok(Some(msg)) => super::deliver_now(user_db, app, msg),
            Ok(None) => tracing::info!(
                "message_triage: digest deduped — an unresolved card for this hour already exists"
            ),
            Err(e) => tracing::warn!(error = %e, "message_triage: digest nudge enqueue failed"),
        }
    }

    // Feed each attention item into the hands-free decision queue as its own
    // `message_attention` proactive (no budget cost — it already won triage;
    // deduped by message id). The digest card aggregates for everyone; this is
    // the per-item "needs your read" decision the orb can hand over one at a
    // time (gated by companionHandsFreeDecisions on the frontend).
    for (id, persona, title, note) in &attention_refs {
        let message = if note.trim().is_empty() {
            format!("{persona}: {title}")
        } else {
            format!("{persona}: {title} — {}", note.trim())
        };
        let nudge = super::Nudge {
            trigger_kind: ATTENTION_TRIGGER_KIND.to_string(),
            trigger_ref: Some(id.clone()),
            message,
        };
        match super::enqueue_external(user_db, &nudge) {
            Ok(Some(m)) => super::deliver_now(user_db, app, m),
            Ok(None) => {} // already surfaced for this message — dedupe
            Err(e) => {
                tracing::warn!(error = %e, id = %id, "message_triage: message_attention enqueue failed")
            }
        }
    }

    // Desktop ping only when something needs the user personally, and
    // never during quiet hours — the unread rows + card already wait.
    if !attention.is_empty() && !super::quiet::is_quiet_now(user_db).unwrap_or(false) {
        crate::notifications::send(
            app,
            "Athena · message inbox",
            &format!("{} message(s) need your personal read", attention.len()),
        );
    }

    Ok(done + digested + attention.len())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_full_decision() {
        let blob = r#"reasoning…
{"athena_messages": {"items": [{"id": "m1", "action": "done", "note": "routine sync confirmation"}, {"id": "m2", "action": "digest", "note": "weekly revenue +12%"}, {"id": "m3", "action": "attention", "note": "asks which pricing tier to ship"}], "summary": "Revenue up 12%; one pricing decision pending."}}
"#;
        let d = parse_message_triage(blob).expect("should parse");
        assert_eq!(d.items.len(), 3);
        assert_eq!(d.items[0].action, "done");
        assert_eq!(d.items[2].action, "attention");
        assert!(d.summary.contains("Revenue"));
    }

    #[test]
    fn parses_minimal_decision() {
        let blob = r#"{"athena_messages": {"items": [{"id": "m1", "action": "done"}]}}"#;
        let d = parse_message_triage(blob).expect("should parse");
        assert_eq!(d.items.len(), 1);
        assert!(d.summary.is_empty());
        assert!(d.items[0].note.is_empty());
    }

    #[test]
    fn message_parser_ignores_other_protocols() {
        let blob = r#"{"athena_exec_triage": {"groups": []}}"#;
        assert!(parse_message_triage(blob).is_none());
    }

    #[test]
    fn priority_guard_forces_attention() {
        assert_eq!(effective_action("high", "done"), "attention");
        assert_eq!(effective_action("urgent", "digest"), "attention");
        assert_eq!(effective_action("critical", "attention"), "attention");
        assert_eq!(effective_action("normal", "done"), "done");
        assert_eq!(effective_action("normal", "digest"), "digest");
        // Unknown verdicts fail safe: stay unread.
        assert_eq!(effective_action("normal", "delete"), "attention");
    }

    #[test]
    fn card_reports_counts_and_attention_lines() {
        let attention = vec![(
            "Revenue Bot".to_string(),
            "Pricing decision".to_string(),
            "asks which tier to ship".to_string(),
        )];
        let card = compose_card("Revenue up 12%.", &attention, 2, 5);
        assert!(card.starts_with("Revenue up 12%."));
        assert!(card.contains("Needs your personal read"));
        assert!(card.contains("Revenue Bot: Pricing decision — asks which tier to ship"));
        assert!(card.contains("(5 routine message(s) marked read, 2 summarized"));
    }
}
