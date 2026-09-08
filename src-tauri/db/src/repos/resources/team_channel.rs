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
        authority: r.get("authority")?,
    })
}

// ---------------------------------------------------------------------------
// Authority (Grand Simulation G3)
// ---------------------------------------------------------------------------

/// An instruction the addressee must reflect in its own plan.
pub const AUTHORITY_DIRECTIVE: &str = "directive";
/// A question or an ask that deserves an answer.
pub const AUTHORITY_REQUEST: &str = "request";
/// Context. Read it, answer it or don't.
pub const AUTHORITY_NOTE: &str = "note";

/// The whole vocabulary, in the order the prompt states it.
pub const AUTHORITIES: [&str; 3] = [AUTHORITY_DIRECTIVE, AUTHORITY_REQUEST, AUTHORITY_NOTE];

/// The repo door for the `authority` vocabulary.
///
/// `None` stays `None` — "no authority declared" is a real value and the
/// column is nullable precisely so it can be said. Anything else must be one
/// of [`AUTHORITIES`] exactly (trimmed, lowercased); an unknown word is
/// REFUSED rather than coerced to `note`, because a caller that wrote
/// `"urgent"` meant something and silently filing it as context would lose
/// the fact that it did.
fn normalize_authority(authority: Option<&str>) -> Result<Option<String>, AppError> {
    let Some(raw) = authority.map(str::trim).filter(|a| !a.is_empty()) else {
        return Ok(None);
    };
    let lowered = raw.to_ascii_lowercase();
    if AUTHORITIES.contains(&lowered.as_str()) {
        return Ok(Some(lowered));
    }
    Err(AppError::Validation(format!(
        "Unknown channel authority '{raw}' — expected one of {}",
        AUTHORITIES.join(", ")
    )))
}

/// Post a message into a team's channel.
pub fn create(
    pool: &DbPool,
    input: CreateChannelMessageInput,
) -> Result<TeamChannelMessage, AppError> {
    insert(pool, input, None, None)
}

/// Post a message that states how much weight it carries — one of
/// [`AUTHORITIES`], or `None` for "none declared".
///
/// Its own entry point rather than a field on [`CreateChannelMessageInput`],
/// for the reason [`create_external`] documents below: the input struct has
/// ~15 exhaustive literal call sites and none of them has an authority to
/// state. Only the doors that genuinely rank a message reach for this one —
/// the operator's directive and Athena's post today, the Architect's channel
/// tomorrow.
pub fn create_with_authority(
    pool: &DbPool,
    input: CreateChannelMessageInput,
    authority: Option<&str>,
) -> Result<TeamChannelMessage, AppError> {
    let authority = normalize_authority(authority)?;
    insert(pool, input, None, authority.as_deref())
}

/// Post a message a PERSONA authored into a team channel, addressed to the
/// whole team or to named members.
///
/// The write half of the decision lane's `say` (G11) and the door the
/// Architect's charter speaks through (G3). Distinct from [`create`] for the
/// same reason [`create_external`] is: this writer owns three facts no generic
/// caller should be able to set by accident — `author_kind` is always
/// `'persona'`, `author_id` is always the speaking persona, and `consumer` is
/// always `'inject'` so the step-boundary injection
/// ([`list_injectable_for_persona`]) carries the message as well as the
/// arrivals wake.
///
/// `authority` is validated here; a caller may not invent a rank word. Whether
/// this persona is ALLOWED to say `directive` is decided upstream, by the
/// charters it holds — the repo enforces the vocabulary, not the grant.
pub fn create_persona_directed(
    pool: &DbPool,
    from_persona: &str,
    team_id: &str,
    body: &str,
    addressed_to: Option<Vec<String>>,
    authority: Option<&str>,
    reply_to: Option<String>,
) -> Result<TeamChannelMessage, AppError> {
    let authority = normalize_authority(authority)?;
    insert(
        pool,
        CreateChannelMessageInput {
            team_id: team_id.to_string(),
            author_kind: "persona".into(),
            author_id: Some(from_persona.to_string()),
            body: body.to_string(),
            addressed_to,
            reply_to,
            assignment_id: None,
            consumer: Some("inject".into()),
        },
        None,
        authority.as_deref(),
    )
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
        None,
    )
}

fn insert(
    pool: &DbPool,
    input: CreateChannelMessageInput,
    author_label: Option<&str>,
    authority: Option<&str>,
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
                 assignment_id, consumer, deliveries, created_at, author_label, authority)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, NULL, datetime('now'), ?10, ?11)",
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
                authority,
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

/// One message the attention loop's arrivals lane may wake a persona for.
///
/// Carries more than the `(id, body)` pair it replaced because the wake now
/// has two sources with different provenance: the operator's own chat, and a
/// team channel where somebody else — a persona or Athena — spoke. The task
/// text the persona is handed must say WHO spoke and with WHAT AUTHORITY, and
/// neither fact is recoverable from a body.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChannelArrival {
    pub message_id: String,
    pub body: String,
    /// `'user'` | `'persona'` | `'athena'` | `'slack'`.
    pub author_kind: String,
    /// The author's display name — the row's own `author_label` when it has
    /// one, else the author persona's name. `None` for the operator, who has
    /// no row to resolve a name from.
    pub author_label: Option<String>,
    /// `'directive'` | `'request'` | `'note'`, or `None` for "none declared".
    pub authority: Option<String>,
    /// The REAL team this was posted in; `None` when the arrival came from the
    /// persona's own chat channel (whose `team_id` is the `persona:<id>`
    /// sentinel and whose `persona_id` is the real scope key).
    pub team_id: Option<String>,
    /// `addressed_to` names this persona specifically, rather than the message
    /// reaching it because it carries a directive to the whole team.
    pub addressed_to_me: bool,
}

/// The OLDEST message this persona should be woken for and has not answered —
/// the attention loop's arrivals lane (living-agent WP5, widened by G3).
///
/// **Two ways in, one predicate.**
///
/// 1. The persona's OWN channel, from the operator: `persona_id = P` and
///    `author_kind = 'user'`. Unchanged — this is the whole rule the lane had
///    until 2026-09-07, and it is why no persona could ever be woken by
///    another one.
/// 2. A team channel the persona is a MEMBER of, where a persona or Athena
///    spoke, and the message either names it in `addressed_to` (the same JSON
///    `LIKE` containment test [`list_injectable_for_persona`] uses — ids are
///    uuids, so no false-substring risk) or carries
///    [`AUTHORITY_DIRECTIVE`], which every member of the team must reflect.
///
/// **A message never wakes its own author** (`author_id != P`): an Architect
/// directing its team would otherwise be its own first respondent, and would
/// then answer itself forever.
///
/// "Unanswered" keeps its definition exactly:
/// - no non-user row replies to it (`reply_to = message.id` — the reply writer
///   and the failure writer both stamp `reply_to`, so a recorded failure
///   counts as answered), AND
/// - no queued/running execution holds its idempotency key
///   (`channel:{P}:{message_id}`) — a live run's own reply-waiter still owns
///   the answer.
///
/// The reply probe no longer re-scopes by `persona_id`: a team-channel message
/// has none, so that clause would have made every team arrival permanently
/// unanswered. `reply_to` alone is sufficient — it holds a uuid message id,
/// which identifies exactly one row. The execution probe keys on the READING
/// persona rather than `m.persona_id` for the same reason, and is identical
/// for case 1 where the two are equal by construction.
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
) -> Result<Option<ChannelArrival>, AppError> {
    timed_query!("team_channel", "team_channel::oldest_unanswered", {
        let conn = pool.get()?;
        let needle = format!("%\"{persona_id}\"%");
        let mut stmt = conn.prepare_cached(
            "SELECT m.id AS id, m.body AS body, m.author_kind AS author_kind,
                    COALESCE(m.author_label, a.name) AS label,
                    m.authority AS authority,
                    m.team_id AS team_id, m.persona_id AS scope_persona,
                    (m.addressed_to LIKE ?4) AS addressed_to_me
             FROM team_channel_messages m
             LEFT JOIN personas a ON a.id = m.author_id
             WHERE (
                     (m.persona_id = ?1 AND m.author_kind = 'user')
                     OR (
                       m.author_kind IN ('persona', 'athena')
                       AND (m.author_id IS NULL OR m.author_id != ?1)
                       AND m.team_id IN (
                         SELECT tm.team_id FROM persona_team_members tm
                         WHERE tm.persona_id = ?1)
                       AND (m.addressed_to LIKE ?4 OR m.authority = 'directive')
                     )
                   )
               AND datetime(m.created_at) <= datetime('now', ?2)
               AND datetime(m.created_at) >= datetime('now', ?3)
               AND NOT EXISTS (
                 SELECT 1 FROM team_channel_messages r
                 WHERE r.reply_to = m.id
                   AND r.author_kind != 'user')
               AND NOT EXISTS (
                 SELECT 1 FROM persona_executions e
                 WHERE e.idempotency_key = 'channel:' || ?1 || ':' || m.id
                   AND e.status IN ('queued', 'running'))
             ORDER BY m.created_at ASC, m.id ASC
             LIMIT 1",
        )?;
        stmt.query_row(
            params![
                persona_id,
                format!("-{min_age_minutes} minutes"),
                format!("-{lookback_days} days"),
                needle,
            ],
            |r| {
                // A row whose `persona_id` is set came from the persona's own
                // chat lens, whose `team_id` is the `persona:<id>` sentinel —
                // not a team anybody can post back into.
                let scope_persona: Option<String> = r.get("scope_persona")?;
                let team_id: Option<String> = match scope_persona {
                    Some(_) => None,
                    None => r.get("team_id")?,
                };
                Ok(ChannelArrival {
                    message_id: r.get("id")?,
                    body: r.get("body")?,
                    author_kind: r.get("author_kind")?,
                    author_label: r.get("label")?,
                    authority: r.get("authority")?,
                    team_id,
                    addressed_to_me: r
                        .get::<_, Option<bool>>("addressed_to_me")?
                        .unwrap_or(false),
                })
            },
        )
        .optional()
        .map_err(AppError::Database)
    })
}

// ---------------------------------------------------------------------------
// What the channel says (the decision lane's read — G3)
// ---------------------------------------------------------------------------

/// One channel message as the App Master decision sees it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChannelLineRow {
    pub id: String,
    /// `'user'` | `'persona'` | `'athena'` | `'slack'`.
    pub author_kind: String,
    /// The author's persona id, when a persona authored it.
    pub author_id: Option<String>,
    /// Display name, resolved the same way [`ChannelArrival`] resolves it.
    pub author_label: Option<String>,
    pub authority: Option<String>,
    pub body: String,
    pub created_at: String,
    /// `addressed_to` names this persona specifically.
    pub addressed_to_me: bool,
}

/// The newest messages on the teams this persona belongs to, plus any message
/// anywhere that names it in `addressed_to`. Newest-first; the caller bounds
/// the body and reverses if it wants oldest-first.
///
/// Deliberately unfiltered by `authority` and by `consumer`: the decision is
/// being shown the conversation, not a queue, and a `display` row somebody
/// posted for humans is still something the App Master should know was said.
///
/// Deliberation turns are excluded. They ride this same table linked by
/// `deliberation_id` and are firebreaked by that link (see
/// [`post_deliberation_turn`]) — folding a moderated debate into a wake's
/// standing context would put one lane's transcript inside another lane's
/// judgment. Persona-chat rows are excluded for the same reason in reverse:
/// they are the persona's own conversation with the operator, already served
/// by the arrivals lane.
pub fn recent_channel_lines_for_persona(
    pool: &DbPool,
    persona_id: &str,
    limit: i64,
) -> Result<Vec<ChannelLineRow>, AppError> {
    timed_query!("team_channel", "team_channel::recent_channel_lines", {
        let conn = pool.get()?;
        let needle = format!("%\"{persona_id}\"%");
        let mut stmt = conn.prepare(
            "SELECT m.id AS id, m.author_kind AS author_kind, m.author_id AS author_id,
                    COALESCE(m.author_label, a.name) AS label,
                    m.authority AS authority, m.body AS body, m.created_at AS created_at,
                    (m.addressed_to LIKE ?2) AS addressed_to_me
             FROM team_channel_messages m
             LEFT JOIN personas a ON a.id = m.author_id
             WHERE m.persona_id IS NULL
               AND m.deliberation_id IS NULL
               AND (
                 m.team_id IN (
                   SELECT tm.team_id FROM persona_team_members tm
                   WHERE tm.persona_id = ?1)
                 OR m.addressed_to LIKE ?2
               )
             ORDER BY m.created_at DESC, m.id DESC
             LIMIT ?3",
        )?;
        let rows = stmt.query_map(params![persona_id, needle, limit], |r| {
            Ok(ChannelLineRow {
                id: r.get("id")?,
                author_kind: r.get("author_kind")?,
                author_id: r.get("author_id")?,
                author_label: r.get("label")?,
                authority: r.get("authority")?,
                body: r.get("body")?,
                created_at: r.get("created_at")?,
                addressed_to_me: r
                    .get::<_, Option<bool>>("addressed_to_me")?
                    .unwrap_or(false),
            })
        })?;
        Ok(rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)?)
    })
}

/// Every persona this one shares a team with — the set it may address by id.
///
/// The allowlist behind the decision plan's `say`: an id outside it is dropped
/// rather than written, so a model that invents a colleague cannot post into a
/// channel nobody asked it to reach.
pub fn addressable_peers(
    pool: &DbPool,
    persona_id: &str,
) -> Result<Vec<(String, String)>, AppError> {
    timed_query!("team_channel", "team_channel::addressable_peers", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT DISTINCT p.id AS id, p.name AS name
             FROM persona_team_members m
             JOIN persona_team_members me
               ON me.team_id = m.team_id AND me.persona_id = ?1
             JOIN personas p ON p.id = m.persona_id
             WHERE m.persona_id != ?1
             ORDER BY p.name ASC, p.id ASC",
        )?;
        let rows = stmt.query_map(params![persona_id], |r| {
            Ok((r.get::<_, String>("id")?, r.get::<_, String>("name")?))
        })?;
        Ok(rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)?)
    })
}

/// The team ids this persona belongs to, oldest membership first.
///
/// The decision lane's `say` writes into the FIRST of these when the persona's
/// project-bound team cannot be resolved. Oldest-first because membership
/// order is the only stable tiebreak available: a persona on two teams has no
/// declared "primary", and picking by name or by id would change under a
/// rename.
pub fn team_ids_for_persona(pool: &DbPool, persona_id: &str) -> Result<Vec<String>, AppError> {
    timed_query!("team_channel", "team_channel::team_ids_for_persona", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT team_id FROM persona_team_members
             WHERE persona_id = ?1 ORDER BY created_at ASC, id ASC",
        )?;
        let rows = stmt.query_map(params![persona_id], |r| r.get::<_, String>("team_id"))?;
        Ok(rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)?)
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

    fn seed_team(pool: &DbPool, id: &str) -> Result<(), AppError> {
        pool.get()?.execute(
            "INSERT INTO persona_teams (id, name, created_at, updated_at)
             VALUES (?1, ?1, datetime('now'), datetime('now'))",
            params![id],
        )?;
        Ok(())
    }

    fn join_team(pool: &DbPool, team_id: &str, persona_id: &str) -> Result<(), AppError> {
        pool.get()?.execute(
            "INSERT INTO persona_team_members
                (id, team_id, persona_id, role, position_x, position_y, created_at)
             VALUES (?1, ?2, ?3, 'worker', 0, 0, datetime('now'))",
            params![format!("m-{team_id}-{persona_id}"), team_id, persona_id],
        )?;
        Ok(())
    }

    /// The oldest arrival, with its age already outside the min-age window.
    fn arrival(pool: &DbPool, persona_id: &str) -> Option<ChannelArrival> {
        oldest_unanswered_persona_message(pool, persona_id, 10, 7).unwrap()
    }

    #[test]
    fn oldest_unanswered_applies_all_four_filters() -> Result<(), AppError> {
        let pool = init_test_db().unwrap();
        seed_persona(&pool, "p1")?;

        // Too fresh: inside the min-age window → invisible.
        post_user(&pool, "p1", "just arrived");
        assert_eq!(arrival(&pool, "p1"), None);

        // Old enough and unanswered → found; oldest wins over a newer one.
        let older = post_user(&pool, "p1", "lost message");
        backdate(&pool, &older, "-2 hours")?;
        let newer = post_user(&pool, "p1", "also lost");
        backdate(&pool, &newer, "-1 hours")?;
        let hit = arrival(&pool, "p1").expect("older row");
        assert_eq!(hit.message_id, older);
        assert_eq!(hit.body, "lost message");
        assert_eq!(hit.author_kind, "user");
        // The operator has no persona row, so no label and no authority — the
        // arrivals text must say "the operator", not print an empty name.
        assert_eq!(hit.author_label, None);
        assert_eq!(hit.authority, None);
        // A persona-chat row is scoped by persona_id, never by a real team.
        assert_eq!(hit.team_id, None);

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
        let hit = arrival(&pool, "p1").expect("newer row now oldest unanswered");
        assert_eq!(hit.message_id, newer);

        // A queued/running execution holding the idempotency key hides it...
        pool.get()?.execute(
            "INSERT INTO persona_executions
                (id, persona_id, status, idempotency_key, created_at)
             VALUES ('ex1', 'p1', 'running', 'channel:p1:' || ?1, datetime('now'))",
            params![newer],
        )?;
        assert_eq!(arrival(&pool, "p1"), None);
        // ...and a TERMINAL one does not (recovery may re-dispatch: the
        // idempotency key dedupes to this row instead of double-running).
        pool.get()?.execute(
            "UPDATE persona_executions SET status = 'failed' WHERE id = 'ex1'",
            [],
        )?;
        assert_eq!(arrival(&pool, "p1").unwrap().message_id, newer);

        // The lookback bound: ancient messages stay buried.
        backdate(&pool, &newer, "-8 days")?;
        pool.get()?
            .execute("DELETE FROM persona_executions WHERE id = 'ex1'", [])?;
        assert_eq!(arrival(&pool, "p1"), None);

        // Scoped per persona: another persona's silence is not ours.
        seed_persona(&pool, "p2")?;
        let other = post_user(&pool, "p2", "someone else");
        backdate(&pool, &other, "-1 hours")?;
        assert_eq!(arrival(&pool, "p1"), None);
        Ok(())
    }

    // -- G3: authority, and a persona hearing another persona ---------------

    #[test]
    fn authority_vocabulary_is_enforced_at_the_door() -> Result<(), AppError> {
        let pool = init_test_db().unwrap();
        seed_persona(&pool, "architect")?;
        seed_team(&pool, "t1")?;

        // The three words, case-insensitively, normalized to lowercase.
        let m = create_persona_directed(
            &pool,
            "architect",
            "t1",
            "ship the ledger first",
            None,
            Some("DIRECTIVE"),
            None,
        )?;
        assert_eq!(m.authority.as_deref(), Some(AUTHORITY_DIRECTIVE));
        assert_eq!(m.author_kind, "persona");
        assert_eq!(m.author_id.as_deref(), Some("architect"));
        // A directed message is always injectable, so the step-boundary
        // injection carries it as well as the arrivals wake.
        assert_eq!(m.consumer, "inject");

        // No authority declared stays NULL — absent is not `note`.
        let plain = create_persona_directed(&pool, "architect", "t1", "fyi", None, None, None)?;
        assert_eq!(plain.authority, None);

        // An invented rank is refused, not filed as context.
        assert!(matches!(
            create_persona_directed(&pool, "architect", "t1", "b", None, Some("urgent"), None),
            Err(AppError::Validation(_))
        ));
        Ok(())
    }

    #[test]
    fn a_directed_message_wakes_its_addressee_and_nobody_else() -> Result<(), AppError> {
        let pool = init_test_db().unwrap();
        for p in ["architect", "master_a", "master_b", "outsider"] {
            seed_persona(&pool, p)?;
        }
        seed_team(&pool, "t1")?;
        for p in ["architect", "master_a", "master_b"] {
            join_team(&pool, "t1", p)?;
        }

        let directed = create_persona_directed(
            &pool,
            "architect",
            "t1",
            "answer me about the ledger",
            Some(vec!["master_a".into()]),
            Some(AUTHORITY_REQUEST),
            None,
        )?;
        backdate(&pool, &directed.id, "-1 hours")?;

        let hit = arrival(&pool, "master_a").expect("the addressee hears it");
        assert_eq!(hit.message_id, directed.id);
        assert_eq!(hit.author_kind, "persona");
        assert_eq!(hit.author_label.as_deref(), Some("architect"));
        assert_eq!(hit.authority.as_deref(), Some(AUTHORITY_REQUEST));
        assert_eq!(hit.team_id.as_deref(), Some("t1"));
        assert!(hit.addressed_to_me);

        // A teammate the message does not name, and a persona outside the
        // team, both stay asleep — a `request` reaches only its addressees.
        assert_eq!(arrival(&pool, "master_b"), None);
        assert_eq!(arrival(&pool, "outsider"), None);
        // And the author is never its own respondent.
        assert_eq!(arrival(&pool, "architect"), None);
        Ok(())
    }

    #[test]
    fn a_directive_wakes_every_team_member_but_not_its_author() -> Result<(), AppError> {
        let pool = init_test_db().unwrap();
        for p in ["architect", "master_a", "master_b", "outsider"] {
            seed_persona(&pool, p)?;
        }
        seed_team(&pool, "t1")?;
        for p in ["architect", "master_a", "master_b"] {
            join_team(&pool, "t1", p)?;
        }

        let directive = create_persona_directed(
            &pool,
            "architect",
            "t1",
            "every service exposes a health endpoint",
            None, // whole team
            Some(AUTHORITY_DIRECTIVE),
            None,
        )?;
        backdate(&pool, &directive.id, "-1 hours")?;

        for member in ["master_a", "master_b"] {
            let hit = arrival(&pool, member).expect("a directive reaches every member");
            assert_eq!(hit.message_id, directive.id);
            assert_eq!(hit.authority.as_deref(), Some(AUTHORITY_DIRECTIVE));
            // Not addressed to anyone in particular: it reached them by rank.
            assert!(!hit.addressed_to_me);
        }
        assert_eq!(arrival(&pool, "architect"), None, "never its own author");
        assert_eq!(arrival(&pool, "outsider"), None, "not on the team");

        // Unanswered keeps its meaning across the team boundary: a persona
        // reply stamped `reply_to` settles it for everyone, and a live run
        // holding the per-reader idempotency key hides it for that reader
        // alone.
        pool.get()?.execute(
            "INSERT INTO persona_executions
                (id, persona_id, status, idempotency_key, created_at)
             VALUES ('ex1', 'master_a', 'running', 'channel:master_a:' || ?1, datetime('now'))",
            params![directive.id],
        )?;
        assert_eq!(arrival(&pool, "master_a"), None, "its own run owns it");
        assert!(
            arrival(&pool, "master_b").is_some(),
            "another reader's run is not this reader's answer"
        );

        create_persona_directed(
            &pool,
            "master_b",
            "t1",
            "acknowledged",
            None,
            Some(AUTHORITY_NOTE),
            Some(directive.id.clone()),
        )?;
        assert_eq!(arrival(&pool, "master_b"), None, "answered");
        Ok(())
    }

    #[test]
    fn a_note_from_a_teammate_never_wakes_anybody() -> Result<(), AppError> {
        let pool = init_test_db().unwrap();
        for p in ["architect", "master_a"] {
            seed_persona(&pool, p)?;
        }
        seed_team(&pool, "t1")?;
        for p in ["architect", "master_a"] {
            join_team(&pool, "t1", p)?;
        }
        let note =
            create_persona_directed(&pool, "architect", "t1", "thinking aloud", None, None, None)?;
        backdate(&pool, &note.id, "-1 hours")?;
        assert_eq!(arrival(&pool, "master_a"), None);
        Ok(())
    }

    #[test]
    fn the_decision_reads_its_teams_channel_and_its_peers() -> Result<(), AppError> {
        let pool = init_test_db().unwrap();
        for p in ["architect", "master_a", "outsider"] {
            seed_persona(&pool, p)?;
        }
        seed_team(&pool, "t1")?;
        seed_team(&pool, "t2")?;
        join_team(&pool, "t1", "architect")?;
        join_team(&pool, "t1", "master_a")?;
        join_team(&pool, "t2", "outsider")?;

        let d = create_persona_directed(
            &pool,
            "architect",
            "t1",
            "ship the ledger",
            None,
            Some(AUTHORITY_DIRECTIVE),
            None,
        )?;
        // Another team's traffic is not this persona's channel...
        create_persona_directed(&pool, "outsider", "t2", "elsewhere", None, None, None)?;
        // ...unless it names this persona.
        let named = create_persona_directed(
            &pool,
            "outsider",
            "t2",
            "one question for you",
            Some(vec!["master_a".into()]),
            Some(AUTHORITY_REQUEST),
            None,
        )?;
        // The persona's own chat with the operator stays out of it.
        post_user(&pool, "master_a", "operator chat");

        let lines = recent_channel_lines_for_persona(&pool, "master_a", 10)?;
        let ids: Vec<&str> = lines.iter().map(|l| l.id.as_str()).collect();
        assert!(ids.contains(&d.id.as_str()));
        assert!(ids.contains(&named.id.as_str()));
        assert_eq!(ids.len(), 2, "only its own channel and what names it");
        let named_line = lines.iter().find(|l| l.id == named.id).unwrap();
        assert!(named_line.addressed_to_me);
        assert_eq!(named_line.author_label.as_deref(), Some("outsider"));
        assert_eq!(named_line.authority.as_deref(), Some(AUTHORITY_REQUEST));

        // The limit is a limit, newest-first.
        assert_eq!(
            recent_channel_lines_for_persona(&pool, "master_a", 1)?.len(),
            1
        );

        // Peers: shared-team members only, never itself.
        assert_eq!(
            addressable_peers(&pool, "master_a")?,
            vec![("architect".to_string(), "architect".to_string())]
        );
        assert_eq!(team_ids_for_persona(&pool, "master_a")?, vec!["t1"]);
        Ok(())
    }
}
