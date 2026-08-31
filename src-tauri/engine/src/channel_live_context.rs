//! Live-context block for channel follow-up executions.
//!
//! A persona summoned into a conversation (the persona channel's Lane B
//! follow-up, or a team-channel mention) answers from chat history alone
//! unless we tell it what is happening in the app *right now*. This module
//! builds a compact, bounded JSON block the caller attaches to the follow-up
//! execution's `input_data` (rendered under `## Input Data` by the prompt
//! assembler), so replies are situated in the persona's live state rather
//! than generic.
//!
//! Everything here is defensive: a failed query drops its section rather than
//! failing the post — a channel message must never bounce because a context
//! read hiccuped. All sections are hard-bounded (few rows, truncated strings)
//! so the block stays at a few hundred tokens.

use rusqlite::params;
use serde_json::{json, Value as JsonValue};

use personas_db::DbPool;

/// Rows per section — the block is orientation, not a log dump.
const RECENT_LIMIT: usize = 5;
const ASSIGNMENT_LIMIT: usize = 3;
/// Cap for free-text fields (error messages, titles) in characters.
const TEXT_CAP: usize = 140;

/// Build the live-context block for a channel follow-up.
///
/// `team_id` scopes the optional assignment section: pass it for team-channel
/// summons, `None` for a basic persona's own channel.
pub fn build_live_context(pool: &DbPool, persona_id: &str, team_id: Option<&str>) -> JsonValue {
    let mut ctx = serde_json::Map::new();

    if let Some(execs) = recent_executions(pool, persona_id) {
        if !execs.is_empty() {
            ctx.insert("recentExecutions".into(), JsonValue::Array(execs));
        }
    }
    if let Some(events) = recent_events(pool, persona_id) {
        if !events.is_empty() {
            ctx.insert("recentEvents".into(), JsonValue::Array(events));
        }
    }
    if let Some(team_id) = team_id {
        if let Some(assignments) = active_assignments(pool, team_id) {
            if !assignments.is_empty() {
                ctx.insert(
                    "activeTeamAssignments".into(),
                    JsonValue::Array(assignments),
                );
            }
        }
    }

    JsonValue::Object(ctx)
}

fn truncate(s: &str) -> String {
    let t: String = s.chars().take(TEXT_CAP).collect();
    t
}

/// The persona's last few runs — status + when + (truncated) error.
fn recent_executions(pool: &DbPool, persona_id: &str) -> Option<Vec<JsonValue>> {
    let conn = pool.get().ok()?;
    let mut stmt = conn
        .prepare(
            "SELECT status, error_message, created_at FROM persona_executions
             WHERE persona_id = ?1 ORDER BY created_at DESC, id DESC LIMIT ?2",
        )
        .ok()?;
    let rows = stmt
        .query_map(params![persona_id, RECENT_LIMIT as i64], |r| {
            let status: String = r.get(0)?;
            let error: Option<String> = r.get(1)?;
            let at: String = r.get(2)?;
            Ok(json!({
                "status": status,
                "error": error.as_deref().map(truncate),
                "at": at,
            }))
        })
        .ok()?
        .filter_map(Result::ok)
        .collect();
    Some(rows)
}

/// Bus traffic the persona emitted or was targeted by.
fn recent_events(pool: &DbPool, persona_id: &str) -> Option<Vec<JsonValue>> {
    let conn = pool.get().ok()?;
    let mut stmt = conn
        .prepare(
            "SELECT event_type, status, created_at FROM persona_events
             WHERE source_id = ?1 OR target_persona_id = ?1
             ORDER BY created_at DESC, id DESC LIMIT ?2",
        )
        .ok()?;
    let rows = stmt
        .query_map(params![persona_id, RECENT_LIMIT as i64], |r| {
            let event_type: String = r.get(0)?;
            let status: String = r.get(1)?;
            let at: String = r.get(2)?;
            Ok(json!({ "eventType": event_type, "status": status, "at": at }))
        })
        .ok()?
        .filter_map(Result::ok)
        .collect();
    Some(rows)
}

/// The team's in-flight work — what the conversation is probably about.
fn active_assignments(pool: &DbPool, team_id: &str) -> Option<Vec<JsonValue>> {
    let conn = pool.get().ok()?;
    let mut stmt = conn
        .prepare(
            "SELECT title, status, created_at FROM team_assignments
             WHERE team_id = ?1 AND status IN ('queued','running','awaiting_review')
             ORDER BY created_at DESC, id DESC LIMIT ?2",
        )
        .ok()?;
    let rows = stmt
        .query_map(params![team_id, ASSIGNMENT_LIMIT as i64], |r| {
            let title: String = r.get(0)?;
            let status: String = r.get(1)?;
            let at: String = r.get(2)?;
            Ok(json!({ "title": truncate(&title), "status": status, "at": at }))
        })
        .ok()?
        .filter_map(Result::ok)
        .collect();
    Some(rows)
}

#[cfg(test)]
mod tests {
    use super::*;
    use personas_db::init_test_db;

    #[test]
    fn empty_db_yields_empty_object() {
        let pool = init_test_db().unwrap();
        let ctx = build_live_context(&pool, "p-none", Some("t-none"));
        assert_eq!(ctx, json!({}));
    }

    #[test]
    fn truncate_caps_long_text() {
        let long = "x".repeat(500);
        assert_eq!(truncate(&long).chars().count(), TEXT_CAP);
    }
}
