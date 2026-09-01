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

// ---------------------------------------------------------------------------
// Persona channel (channels-v2 W3/W4)
// ---------------------------------------------------------------------------

/// Input for a persona-channel chat row. Distinct from
/// [`CreateChannelMessageInput`] on purpose (mirrors the `create_external`
/// reasoning): a persona-channel writer must set `persona_id` + the sentinel
/// `team_id`, may supply its own row id (the optimistic-echo retire contract:
/// the frontend mints a client id, renders instantly, and retires the ghost
/// when the server row with that id arrives), and never sets team-only fields
/// (`addressed_to`, `assignment_id`). Keeping it separate means no team-side
/// call site can accidentally write a persona-scoped row or vice versa.
pub struct CreatePersonaChannelMessageInput {
    /// Client-minted id (optimistic echo) or None → `tcm-<uuid>`.
    pub id: Option<String>,
    pub persona_id: String,
    /// 'user' | 'persona' (athena posts would ride the same door).
    pub author_kind: String,
    pub author_id: Option<String>,
    /// Display name for persona-authored rows (no join at read time).
    pub author_label: Option<String>,
    pub body: String,
    pub reply_to: Option<String>,
    /// Marks a failure record ("the run died") — stored as
    /// `{"failed":true}` in the `deliveries` column, which the persona
    /// read-model surfaces as `extra`. Safe: delivery receipts are written
    /// only by the team orchestrator, which scopes by REAL team ids and can
    /// never touch a `persona:<id>`-sentinel row.
    pub failed: bool,
}

/// Insert a persona-channel chat row. Returns `(id, at)` with `at` already
/// normalized to `YYYY-MM-DDTHH:MM:SSZ` — the same shape the read-model
/// emits, so the caller can hand it straight back to the frontend.
///
/// `team_id` is the sentinel `persona:<persona_id>`: the column is
/// `TEXT NOT NULL` with no FK, and every team-scoped reader (the team
/// read-model, the orchestrator's injection/delivery machinery, the Slack
/// bridge) filters on real team ids, so sentinel rows are invisible to all
/// of them by construction. The REAL scope key is the `persona_id` column
/// (indexed `(persona_id, created_at DESC)`), which is what
/// `read_persona_channel` filters on — the sentinel is only there to keep
/// NOT NULL honest and to make the row's provenance greppable.
pub fn create_persona_channel_message(
    pool: &DbPool,
    input: CreatePersonaChannelMessageInput,
) -> Result<(String, String), AppError> {
    timed_query!("team_channel", "team_channel::create_persona_channel", {
        let body = input.body.trim();
        if body.is_empty() {
            return Err(AppError::Validation("Message body cannot be empty".into()));
        }
        let id = match input
            .id
            .map(|i| i.trim().to_string())
            .filter(|i| !i.is_empty())
        {
            Some(client_id) => {
                if client_id.len() > 64
                    || !client_id
                        .chars()
                        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
                {
                    return Err(AppError::Validation(
                        "client_id must be <= 64 chars of [A-Za-z0-9_-]".into(),
                    ));
                }
                client_id
            }
            None => format!("tcm-{}", uuid::Uuid::new_v4()),
        };
        let label = input
            .author_label
            .as_deref()
            .map(str::trim)
            .filter(|l| !l.is_empty());
        let deliveries = if input.failed {
            Some("{\"failed\":true}")
        } else {
            None
        };
        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO team_channel_messages
                (id, team_id, author_kind, author_id, body, addressed_to, reply_to,
                 assignment_id, consumer, deliveries, created_at, author_label, persona_id)
             VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6, NULL, 'display', ?7, datetime('now'), ?8, ?9)",
            params![
                id,
                format!("persona:{}", input.persona_id),
                input.author_kind,
                input.author_id,
                body,
                input.reply_to,
                deliveries,
                label,
                input.persona_id,
            ],
        )
        .map_err(AppError::Database)?;
        let at: String = conn.query_row(
            "SELECT strftime('%Y-%m-%dT%H:%M:%SZ', datetime(created_at))
             FROM team_channel_messages WHERE id = ?1",
            params![id],
            |r| r.get(0),
        )?;
        Ok((id, at))
    })
}

/// The OLDEST user message in a persona's channel that never got an answer —
/// the attention loop's arrivals-recovery probe (living-agent WP5).
///
/// "Unanswered" is structural, matching the follow-up machinery in
/// `commands::communication::persona_channel`:
/// - no non-user row replies to it (`reply_to = message.id` — the reply
///   writer and the failure writer both stamp `reply_to`, so a recorded
///   failure counts as answered), AND
/// - no queued/running execution holds its idempotency key
///   (`channel:{persona_id}:{message_id}`) — a live run's own reply-waiter
///   still owns the answer.
///
/// `min_age_minutes` keeps the loop off messages the live post path is still
/// serving; `lookback_days` bounds how far back a recovery can resurrect.
/// `datetime()` normalizes the mixed 'T'/' ' timestamp formats (the quota-gate
/// lesson: a raw string compare misorders RFC-3339 against SQLite datetimes).
pub fn oldest_unanswered_persona_message(
    pool: &DbPool,
    persona_id: &str,
    min_age_minutes: i64,
    lookback_days: i64,
) -> Result<Option<(String, String)>, AppError> {
    timed_query!("team_channel", "team_channel::oldest_unanswered", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare_cached(
            "SELECT m.id AS id, m.body AS body FROM team_channel_messages m
             WHERE m.persona_id = ?1
               AND m.author_kind = 'user'
               AND datetime(m.created_at) <= datetime('now', ?2)
               AND datetime(m.created_at) >= datetime('now', ?3)
               AND NOT EXISTS (
                 SELECT 1 FROM team_channel_messages r
                 WHERE r.persona_id = m.persona_id
                   AND r.reply_to = m.id
                   AND r.author_kind != 'user')
               AND NOT EXISTS (
                 SELECT 1 FROM persona_executions e
                 WHERE e.idempotency_key = 'channel:' || m.persona_id || ':' || m.id
                   AND e.status IN ('queued', 'running'))
             ORDER BY m.created_at ASC, m.id ASC
             LIMIT 1",
        )?;
        stmt.query_row(
            params![
                persona_id,
                format!("-{min_age_minutes} minutes"),
                format!("-{lookback_days} days"),
            ],
            |r| Ok((r.get::<_, String>("id")?, r.get::<_, String>("body")?)),
        )
        .optional()
        .map_err(AppError::Database)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::init_test_db;

    fn seed_persona(pool: &DbPool, id: &str) -> Result<(), AppError> {
        pool.get()?.execute(
            "INSERT INTO personas (id, name, system_prompt, created_at, updated_at)
             VALUES (?1, ?1, 'sp', datetime('now'), datetime('now'))",
            params![id],
        )?;
        Ok(())
    }

    fn post_user(pool: &DbPool, persona_id: &str, body: &str) -> String {
        let (id, _) = create_persona_channel_message(
            pool,
            CreatePersonaChannelMessageInput {
                id: None,
                persona_id: persona_id.into(),
                author_kind: "user".into(),
                author_id: None,
                author_label: None,
                body: body.into(),
                reply_to: None,
                failed: false,
            },
        )
        .unwrap();
        id
    }

    fn backdate(pool: &DbPool, message_id: &str, modifier: &str) -> Result<(), AppError> {
        pool.get()?.execute(
            "UPDATE team_channel_messages
             SET created_at = datetime('now', ?1) WHERE id = ?2",
            params![modifier, message_id],
        )?;
        Ok(())
    }

    #[test]
    fn oldest_unanswered_applies_all_four_filters() -> Result<(), AppError> {
        let pool = init_test_db().unwrap();
        seed_persona(&pool, "p1")?;

        // Too fresh: inside the min-age window → invisible.
        post_user(&pool, "p1", "just arrived");
        assert_eq!(
            oldest_unanswered_persona_message(&pool, "p1", 10, 7).unwrap(),
            None
        );

        // Old enough and unanswered → found; oldest wins over a newer one.
        let older = post_user(&pool, "p1", "lost message");
        backdate(&pool, &older, "-2 hours")?;
        let newer = post_user(&pool, "p1", "also lost");
        backdate(&pool, &newer, "-1 hours")?;
        let hit = oldest_unanswered_persona_message(&pool, "p1", 10, 7)
            .unwrap()
            .expect("older row");
        assert_eq!(hit, (older.clone(), "lost message".into()));

        // A persona reply (even a FAILURE record) answers it.
        create_persona_channel_message(
            &pool,
            CreatePersonaChannelMessageInput {
                id: None,
                persona_id: "p1".into(),
                author_kind: "persona".into(),
                author_id: Some("p1".into()),
                author_label: Some("P1".into()),
                body: "_(persona run failed to start: boom)_".into(),
                reply_to: Some(older.clone()),
                failed: true,
            },
        )
        .unwrap();
        let hit = oldest_unanswered_persona_message(&pool, "p1", 10, 7)
            .unwrap()
            .expect("newer row now oldest unanswered");
        assert_eq!(hit.0, newer);

        // A queued/running execution holding the idempotency key hides it...
        pool.get()?.execute(
            "INSERT INTO persona_executions
                (id, persona_id, status, idempotency_key, created_at)
             VALUES ('ex1', 'p1', 'running', 'channel:p1:' || ?1, datetime('now'))",
            params![newer],
        )?;
        assert_eq!(
            oldest_unanswered_persona_message(&pool, "p1", 10, 7).unwrap(),
            None
        );
        // ...and a TERMINAL one does not (recovery may re-dispatch: the
        // idempotency key dedupes to this row instead of double-running).
        pool.get()?.execute(
            "UPDATE persona_executions SET status = 'failed' WHERE id = 'ex1'",
            [],
        )?;
        assert_eq!(
            oldest_unanswered_persona_message(&pool, "p1", 10, 7)
                .unwrap()
                .unwrap()
                .0,
            newer
        );

        // The lookback bound: ancient messages stay buried.
        backdate(&pool, &newer, "-8 days")?;
        pool.get()?
            .execute("DELETE FROM persona_executions WHERE id = 'ex1'", [])?;
        assert_eq!(
            oldest_unanswered_persona_message(&pool, "p1", 10, 7).unwrap(),
            None
        );

        // Scoped per persona: another persona's silence is not ours.
        seed_persona(&pool, "p2")?;
        let other = post_user(&pool, "p2", "someone else");
        backdate(&pool, &other, "-1 hours")?;
        assert_eq!(
            oldest_unanswered_persona_message(&pool, "p1", 10, 7).unwrap(),
            None
        );
        Ok(())
    }
}
