//! Team channel repo (C1). The authoritative store for multi-author channel
//! messages; the read-model (`list_team_channel`) and the orchestrator's
//! step-boundary injection both read through here.

use rusqlite::{params, OptionalExtension, Row};

use crate::models::{CreateChannelMessageInput, TeamChannelMessage};
use crate::DbPool;
use personas_core::error::AppError;

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
    insert(pool, input, None)
}

/// Post a message authored by an EXTERNAL participant — today only the team
/// <-> Slack bridge (`engine/slack_poller.rs`).
///
/// The only difference from [`create`] is `author_label`: an external author has
/// no persona row to resolve a name from, so the bridge resolves it once (Slack
/// `users.info`) and stores it on the message. The read-model surfaces it as
/// `TeamChannelItem.label`. Kept as its own entry point rather than a new field
/// on `CreateChannelMessageInput` so the ~10 internal call sites stay untouched
/// and no internal writer can accidentally set a display name it doesn't own.
pub fn create_external(
    pool: &DbPool,
    input: CreateChannelMessageInput,
    author_label: &str,
) -> Result<TeamChannelMessage, AppError> {
    let label = author_label.trim();
    insert(
        pool,
        input,
        if label.is_empty() { None } else { Some(label) },
    )
}

fn insert(
    pool: &DbPool,
    input: CreateChannelMessageInput,
    author_label: Option<&str>,
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
                 assignment_id, consumer, deliveries, created_at, author_label)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, NULL, datetime('now'), ?10)",
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
                author_label,
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
        // Sargable form: created_at is stored as datetime('now') text
        // (lexically sortable), so compare/order on the RAW column and
        // normalize the RFC3339 cursor on the parameter side. Wrapping the
        // column in strftime()/datetime() defeated idx_team_channel_messages_team
        // and forced a full materialize+sort of the team's whole history.
        let mut stmt = conn.prepare(
            "SELECT * FROM team_channel_messages
             WHERE team_id = ?1
               AND created_at < datetime(?2)
             ORDER BY created_at DESC, id DESC LIMIT ?3",
        )?;
        let rows = stmt.query_map(params![team_id, cursor, limit], |r| row_to_message(r))?;
        Ok(rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)?)
    })
}

/// Oldest-first page of a team's messages strictly after a `(created_at, id)`
/// cursor. The relay cursor for the team -> Slack bridge
/// (`engine/team_slack_relay.rs`); the composite tiebreaker means two messages
/// sharing a `created_at` second (the column is `datetime('now')`, so this is
/// common) can't drop one of the pair.
///
/// Pass `None` for both cursor parts to read from the beginning. Compares on
/// the RAW column for the same sargability reason as `list_for_team`.
pub fn list_for_team_after(
    pool: &DbPool,
    team_id: &str,
    after_created_at: Option<&str>,
    after_id: Option<&str>,
    limit: i64,
) -> Result<Vec<TeamChannelMessage>, AppError> {
    timed_query!("team_channel", "team_channel::list_for_team_after", {
        let conn = pool.get()?;
        let at = after_created_at.unwrap_or("");
        let id = after_id.unwrap_or("");
        let mut stmt = conn.prepare(
            "SELECT * FROM team_channel_messages
             WHERE team_id = ?1
               AND (created_at > ?2 OR (created_at = ?2 AND id > ?3))
             ORDER BY created_at ASC, id ASC LIMIT ?4",
        )?;
        let rows = stmt.query_map(params![team_id, at, id, limit], |r| row_to_message(r))?;
        Ok(rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)?)
    })
}

/// Newest `(created_at, id)` for a team, or `None` when the team has no
/// messages. Used to seed a relay cursor forward so a newly configured bridge
/// mirrors only what happens after it is wired, never the team's whole history.
pub fn newest_cursor_for_team(
    pool: &DbPool,
    team_id: &str,
) -> Result<Option<(String, String)>, AppError> {
    timed_query!("team_channel", "team_channel::newest_cursor_for_team", {
        let conn = pool.get()?;
        let row = conn
            .query_row(
                "SELECT created_at, id FROM team_channel_messages
                 WHERE team_id = ?1
                 ORDER BY created_at DESC, id DESC LIMIT 1",
                params![team_id],
                |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
            )
            .optional()
            .map_err(AppError::Database)?;
        Ok(row)
    })
}

/// Recent turns of a deliberation (Design D) — newest-first. The moderator's +
/// persona-turn context source (turns ride the existing channel via the
/// `deliberation_id` link); reuses this repo's row mapping.
pub fn list_for_deliberation(
    pool: &DbPool,
    deliberation_id: &str,
    limit: i64,
) -> Result<Vec<TeamChannelMessage>, AppError> {
    timed_query!("team_channel", "team_channel::list_for_deliberation", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM team_channel_messages
             WHERE deliberation_id = ?1
             ORDER BY created_at DESC, id DESC LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![deliberation_id, limit], |r| row_to_message(r))?;
        Ok(rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)?)
    })
}

/// Post a persona/system turn INTO a deliberation (Design D, D3). Sets
/// `deliberation_id` (the firebreak boundary — deliberation injection is by that,
/// not by `consumer`) and `consumer='display'` so it never injects into a normal
/// step outside the deliberation. The persona turn primitive writes through here.
pub fn post_deliberation_turn(
    pool: &DbPool,
    deliberation_id: &str,
    team_id: &str,
    author_kind: &str,
    author_id: Option<&str>,
    body: &str,
) -> Result<TeamChannelMessage, AppError> {
    timed_query!("team_channel", "team_channel::post_deliberation_turn", {
        let body = body.trim();
        if body.is_empty() {
            return Err(AppError::Validation("Turn body cannot be empty".into()));
        }
        let id = format!("tcm-{}", uuid::Uuid::new_v4());
        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO team_channel_messages
                (id, team_id, author_kind, author_id, body, addressed_to, reply_to,
                 assignment_id, consumer, deliveries, deliberation_id, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, NULL, NULL, NULL, 'display', NULL, ?6, datetime('now'))",
            params![id, team_id, author_kind, author_id, body, deliberation_id],
        )
        .map_err(AppError::Database)?;
        get(pool, &id)
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
    timed_query!(
        "team_channel",
        "team_channel::list_injectable_for_persona",
        {
            let conn = pool.get()?;
            // addressed_to is a JSON array of persona ids; NULL = whole team.
            // A LIKE on the quoted id is a cheap containment test (ids are uuids,
            // no false-substring risk).
            let needle = format!("%\"{persona_id}\"%");
            let mut stmt = conn.prepare(
                "SELECT * FROM team_channel_messages
             WHERE team_id = ?1
               AND consumer = 'inject'
               AND created_at > datetime('now', '-14 days')
               AND (addressed_to IS NULL OR addressed_to LIKE ?2)
             ORDER BY created_at DESC LIMIT ?3",
            )?;
            let rows = stmt.query_map(params![team_id, needle, limit], |r| row_to_message(r))?;
            Ok(rows
                .collect::<Result<Vec<_>, _>>()
                .map_err(AppError::Database)?)
        }
    )
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
