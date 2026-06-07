//! Team channel repo (C1). The authoritative store for multi-author channel
//! messages; the read-model (`list_team_channel`) and the orchestrator's
//! step-boundary injection both read through here.

use rusqlite::{params, Row};

use crate::db::models::{CreateChannelMessageInput, TeamChannelMessage};
use crate::db::DbPool;
use crate::error::AppError;

fn row_to_message(r: &Row) -> rusqlite::Result<TeamChannelMessage> {
    Ok(TeamChannelMessage {
        id: r.get("id")?,
        team_id: r.get("team_id")?,
        author_kind: r.get("author_kind")?,
        author_id: r.get("author_id")?,
        body: r.get("body")?,
        addressed_to: r.get("addressed_to")?,
        reply_to: r.get("reply_to")?,
        assignment_id: r.get("assignment_id")?,
        consumer: r.get("consumer")?,
        deliveries: r.get("deliveries")?,
        created_at: r.get("created_at")?,
    })
}

/// Post a message into a team's channel.
pub fn create(
    pool: &DbPool,
    input: CreateChannelMessageInput,
) -> Result<TeamChannelMessage, AppError> {
    timed_query!("team_channel", "team_channel::create", {
        let body = input.body.trim();
        if body.is_empty() {
            return Err(AppError::Validation("Message body cannot be empty".into()));
        }
        let id = format!("tcm-{}", uuid::Uuid::new_v4());
        let addressed = input
            .addressed_to
            .as_ref()
            .filter(|v| !v.is_empty())
            .map(|v| serde_json::to_string(v).unwrap_or_default());
        let consumer = input.consumer.unwrap_or_else(|| "inject".into());
        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO team_channel_messages
                (id, team_id, author_kind, author_id, body, addressed_to, reply_to,
                 assignment_id, consumer, deliveries, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, NULL, datetime('now'))",
            params![
                id,
                input.team_id,
                input.author_kind,
                input.author_id,
                body,
                addressed,
                input.reply_to,
                input.assignment_id,
                consumer,
            ],
        )
        .map_err(AppError::Database)?;
        get(pool, &id)
    })
}

pub fn get(pool: &DbPool, id: &str) -> Result<TeamChannelMessage, AppError> {
    let conn = pool.get()?;
    conn.query_row(
        "SELECT * FROM team_channel_messages WHERE id = ?1",
        params![id],
        row_to_message,
    )
    .map_err(AppError::Database)
}

/// Newest messages for a team, optional keyset cursor (`before` = exclusive
/// RFC3339). Used by the channel read-model.
pub fn list_for_team(
    pool: &DbPool,
    team_id: &str,
    limit: i64,
    before: Option<&str>,
) -> Result<Vec<TeamChannelMessage>, AppError> {
    timed_query!("team_channel", "team_channel::list_for_team", {
        let cursor = before.unwrap_or("9999-12-31T23:59:59Z");
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM team_channel_messages
             WHERE team_id = ?1
               AND strftime('%Y-%m-%dT%H:%M:%SZ', datetime(created_at)) < ?2
             ORDER BY datetime(created_at) DESC, id DESC LIMIT ?3",
        )?;
        let rows = stmt.query_map(params![team_id, cursor, limit], |r| row_to_message(r))?;
        Ok(rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)?)
    })
}

/// Injectable messages addressed to a persona (or the whole team) since a
/// cutoff — the step-boundary injection source. `consumer='inject'` only;
/// recency-capped by the caller's `limit`. Returns newest-first.
pub fn list_injectable_for_persona(
    pool: &DbPool,
    team_id: &str,
    persona_id: &str,
    limit: i64,
) -> Result<Vec<TeamChannelMessage>, AppError> {
    timed_query!("team_channel", "team_channel::list_injectable_for_persona", {
        let conn = pool.get()?;
        // addressed_to is a JSON array of persona ids; NULL = whole team.
        // A LIKE on the quoted id is a cheap containment test (ids are uuids,
        // no false-substring risk).
        let needle = format!("%\"{persona_id}\"%");
        let mut stmt = conn.prepare(
            "SELECT * FROM team_channel_messages
             WHERE team_id = ?1
               AND consumer = 'inject'
               AND datetime(created_at) > datetime('now', '-14 days')
               AND (addressed_to IS NULL OR addressed_to LIKE ?2)
             ORDER BY datetime(created_at) DESC LIMIT ?3",
        )?;
        let rows = stmt.query_map(params![team_id, needle, limit], |r| row_to_message(r))?;
        Ok(rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)?)
    })
}

/// Record a step-boundary delivery receipt on a message (idempotent per
/// step+persona). Deliveries live in the `deliveries` JSON column as
/// `[{step_id, persona_id, at}]`.
pub fn record_delivery(
    pool: &DbPool,
    message_id: &str,
    step_id: &str,
    persona_id: &str,
) -> Result<(), AppError> {
    timed_query!("team_channel", "team_channel::record_delivery", {
        let conn = pool.get()?;
        let existing: Option<String> = conn
            .query_row(
                "SELECT deliveries FROM team_channel_messages WHERE id = ?1",
                params![message_id],
                |r| r.get(0),
            )
            .map_err(AppError::Database)?;
        let mut arr: Vec<serde_json::Value> = existing
            .as_deref()
            .and_then(|t| serde_json::from_str(t).ok())
            .unwrap_or_default();
        let dup = arr.iter().any(|d| {
            d.get("step_id").and_then(|v| v.as_str()) == Some(step_id)
                && d.get("persona_id").and_then(|v| v.as_str()) == Some(persona_id)
        });
        if dup {
            return Ok(());
        }
        arr.push(serde_json::json!({
            "step_id": step_id,
            "persona_id": persona_id,
            "at": chrono::Utc::now().to_rfc3339(),
        }));
        conn.execute(
            "UPDATE team_channel_messages SET deliveries = ?1 WHERE id = ?2",
            params![serde_json::Value::Array(arr).to_string(), message_id],
        )
        .map_err(AppError::Database)?;
        Ok(())
    })
}
