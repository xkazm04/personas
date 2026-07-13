//! Team channel — Design B read-model for the Collab living chat.
//!
//! Unions the team's communication sources server-side into one chronological
//! feed with keyset pagination:
//!
//!   1. `team_assignment_events` — the AUTHORITATIVE step layer (handoffs,
//!      rework, review gates), scoped via the assignment's team and joined to
//!      steps for the speaking persona + step title. Noisy machine kinds
//!      (matching/pending) are filtered out at the SQL level.
//!   2. `persona_events` — bus traffic emitted by team members (artifacts,
//!      PR lifecycle, handshakes). `task_completed` is excluded as telemetry.
//!   3. `team_memories` — shared knowledge (legacy directives included for
//!      back-compat).
//!   4. `team_channel_messages` — the C1 multi-author table: the user's
//!      directives plus (later) persona/athena/director posts, with delivery
//!      receipts in `deliveries`.
//!
//! All timestamps are normalized to `YYYY-MM-DDTHH:MM:SSZ` in SQL (the three
//! tables mix RFC3339 and SQLite-naive formats — the repo-wide clash).

use std::sync::Arc;

use rusqlite::params;
use serde::Serialize;
use tauri::State;
use ts_rs::TS;

use crate::db::repos::resources::team_channel as channel_repo;
use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::AppState;

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct TeamChannelItem {
    pub id: String,
    /// 'step' | 'event' | 'memory' | 'directive' | 'persona' | 'athena' | 'director'
    pub kind: String,
    /// Normalized RFC3339 UTC (second resolution) — sortable everywhere.
    pub at: String,
    pub persona_id: Option<String>,
    /// step kind / event type / memory category — the row's machine label.
    /// For `event` rows this IS the raw `event_type` (the Red Room family lens
    /// derives its 8 families from it client-side).
    pub label: String,
    /// Human line: step title, payload summary, or memory title+content.
    pub body: Option<String>,
    pub assignment_id: Option<String>,
    pub step_id: Option<String>,
    /// Raw JSON payload (events) or tags (memories — carries `deliveries`).
    pub extra: Option<String>,
    /// Channel messages only: the message id this one replies to (threading).
    pub reply_to: Option<String>,
    /// Channel messages only: the deliberation this turn belongs to. Non-null
    /// rows are deliberation turns and are EXCLUDED from the plain conversation
    /// unless `deliberation` is in `kinds` (they used to leak in as ordinary
    /// persona/athena posts — the column wasn't even exposed, so the frontend
    /// could not filter them out).
    pub deliberation_id: Option<String>,
    /// Memory rows only: 1-10 backing scale (the UI renders it as 5 dots).
    /// i32, not i64 — ts-rs maps i64 to `bigint`, and every other importance in
    /// the app (TeamMemory, PersonaMemory) is a plain `number`.
    pub importance: Option<i32>,
    /// Event rows only: team personas subscribed to this `event_type` — the
    /// Red Room's "Heard by". A server-side join; the old client fused this
    /// from an N-per-member subscription fan-out.
    pub consumers: Option<Vec<String>>,
}

const DEFAULT_LIMIT: i64 = 60;
const MAX_LIMIT: i64 = 200;

/// The lenses a caller can ask for. Each maps to the source queries that can
/// produce it — asking for one runs ONLY its queries, so `limit` is spent on
/// rows the caller actually wants.
struct Lenses {
    steps: bool,
    events: bool,
    /// team_memories, category != 'directive'
    memories: bool,
    /// team_memories, category = 'directive' (legacy) + team_channel_messages
    messages: bool,
    /// team_channel_messages with a deliberation_id
    deliberations: bool,
}

impl Lenses {
    fn parse(kinds: Option<&[String]>) -> Self {
        match kinds {
            // No filter → today's blend, minus the deliberation leak.
            None => Lenses { steps: true, events: true, memories: true, messages: true, deliberations: false },
            Some(k) => Lenses {
                steps: k.iter().any(|s| s == "step"),
                events: k.iter().any(|s| s == "event"),
                memories: k.iter().any(|s| s == "memory"),
                messages: k.iter().any(|s| s == "message"),
                deliberations: k.iter().any(|s| s == "deliberation"),
            },
        }
    }
}

/// One page of the team's channel, newest first.
///
/// Cursor: `before` + `before_id` are an exclusive COMPOSITE keyset cursor —
/// pass the last item's `at` AND `id`. `at` is only second-resolution, so a
/// burst of rows sharing one second that straddles a page boundary was being
/// dropped (or duplicated) by the old timestamp-only `at < ?` cursor. The
/// predicate now mirrors the sort exactly: `at < c OR (at = c AND id < c_id)`.
/// Omitting `before_id` keeps the old strict-`at` semantics.
///
/// `kinds`: which lenses to include ('step' | 'event' | 'memory' | 'message' |
/// 'deliberation'). Each source query is limited independently, so filtering to
/// one lens no longer starves it — previously all four ran with `LIMIT n` and
/// the union was truncated to `n` TOTAL, so a chatty step layer could push every
/// memory out of the page and a memory-only view would render empty.
#[tauri::command]
pub fn list_team_channel(
    state: State<'_, Arc<AppState>>,
    team_id: String,
    limit: Option<i64>,
    before: Option<String>,
    before_id: Option<String>,
    kinds: Option<Vec<String>>,
) -> Result<Vec<TeamChannelItem>, AppError> {
    require_auth_sync(&state)?;
    let conn = state.db.get()?;
    read_channel(&conn, &team_id, limit, before.as_deref(), before_id.as_deref(), kinds.as_deref())
}

/// The read-model itself, over a bare connection — the command is auth + this.
/// Split out so the cursor and lens behaviour can be tested against a real
/// SQLite schema without standing up an AppState.
pub(crate) fn read_channel(
    conn: &rusqlite::Connection,
    team_id: &str,
    limit: Option<i64>,
    before: Option<&str>,
    before_id: Option<&str>,
    kinds: Option<&[String]>,
) -> Result<Vec<TeamChannelItem>, AppError> {
    let limit = limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);
    let cursor = before.unwrap_or("9999-12-31T23:59:59Z");
    // Empty string sorts below every real id, so `at = cursor AND id < ''` is
    // never true — which is exactly the old behaviour when no id is supplied.
    let cursor_id = before_id.unwrap_or("");
    let lenses = Lenses::parse(kinds);
    let mut items: Vec<TeamChannelItem> = Vec::new();

    // --- 1. Step layer (authoritative) ---
    if lenses.steps {
        let mut stmt = conn.prepare(
            "SELECT e.id,
                    strftime('%Y-%m-%dT%H:%M:%SZ', datetime(e.created_at)) AS at,
                    e.kind, e.payload, e.assignment_id, e.step_id,
                    s.assigned_persona_id, s.title,
                    a.title AS asg_title, a.goal AS asg_goal, a.error_message AS asg_error
             FROM team_assignment_events e
             JOIN team_assignments a ON a.id = e.assignment_id
             LEFT JOIN team_assignment_steps s ON s.id = e.step_id
             WHERE a.team_id = ?1
               AND e.kind IN ('created','step_running','step_done','step_failed','step_skipped',
                              'status_awaiting_review','status_done','qa_changes_requested_rework')
               AND (strftime('%Y-%m-%dT%H:%M:%SZ', datetime(e.created_at)) < ?2
                    OR (strftime('%Y-%m-%dT%H:%M:%SZ', datetime(e.created_at)) = ?2
                        AND ('tae-' || e.id) < ?4))
             ORDER BY at DESC, e.id DESC LIMIT ?3",
        )?;
        let rows = stmt.query_map(params![team_id, cursor, limit, cursor_id], |r| {
            let kind: String = r.get(2)?;
            let raw_payload: Option<String> = r.get(3)?;
            let step_title: Option<String> = r.get(7)?;
            let asg_title: Option<String> = r.get(8)?;
            let asg_goal: Option<String> = r.get(9)?;
            let asg_error: Option<String> = r.get(10)?;
            // Body: the step title when the event names a step, else the
            // assignment title — assignment-level events (created /
            // status_awaiting_review / status_done) carry no step_id, so
            // without this fallback they render with an empty body.
            let body = step_title.or_else(|| asg_title.clone());
            // Extra: keep the step payload when present; for the assignment-level
            // review/done gates (payload is NULL) synthesize the review context
            // from the assignment so the detail modal isn't empty.
            let extra = raw_payload.or_else(|| {
                if matches!(kind.as_str(), "status_awaiting_review" | "status_done" | "created") {
                    Some(
                        serde_json::json!({
                            "task": asg_goal.clone().or_else(|| asg_title.clone()),
                            "error": asg_error.clone(),
                        })
                        .to_string(),
                    )
                } else {
                    None
                }
            });
            Ok(TeamChannelItem {
                id: format!("tae-{}", r.get::<_, String>(0)?),
                kind: "step".into(),
                at: r.get(1)?,
                label: kind,
                extra,
                assignment_id: r.get(4)?,
                step_id: r.get(5)?,
                persona_id: r.get(6)?,
                body,
                reply_to: None,
                deliberation_id: None,
                importance: None,
                consumers: None,
            })
        })?;
        items.extend(rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)?);
    }

    // --- 2. Bus traffic from team members ---
    if lenses.events {
        let mut stmt = conn.prepare(
            "SELECT e.id,
                    strftime('%Y-%m-%dT%H:%M:%SZ', datetime(e.created_at)) AS at,
                    e.event_type, e.payload, e.source_id, e.payload_iv,
                    (SELECT group_concat(sub.persona_id)
                       FROM persona_event_subscriptions sub
                      WHERE sub.event_type = e.event_type
                        AND sub.enabled = 1
                        AND sub.persona_id IN (SELECT persona_id FROM persona_team_members WHERE team_id = ?1)
                    ) AS consumers
             FROM persona_events e
             WHERE e.source_id IN (SELECT persona_id FROM persona_team_members WHERE team_id = ?1)
               AND e.event_type != 'task_completed'
               AND e.event_type NOT LIKE '\\_chain\\_%' ESCAPE '\\'
               AND (strftime('%Y-%m-%dT%H:%M:%SZ', datetime(e.created_at)) < ?2
                    OR (strftime('%Y-%m-%dT%H:%M:%SZ', datetime(e.created_at)) = ?2
                        AND ('pe-' || e.id) < ?4))
             ORDER BY at DESC, e.id DESC LIMIT ?3",
        )?;
        let rows = stmt.query_map(params![team_id, cursor, limit, cursor_id], |r| {
            // `persona_events.payload` is AES-encrypted at rest when `payload_iv`
            // is set (mirrors events::row_to_event). Decrypt here — reading the
            // raw column would surface ciphertext as a "hashed" message body.
            let raw_payload: Option<String> = r.get(3)?;
            let payload_iv: Option<String> = r.get(5).unwrap_or(None);
            let extra = match (raw_payload, payload_iv) {
                (Some(ct), Some(ref iv)) if !iv.is_empty() => {
                    crate::engine::crypto::decrypt_from_db(&ct, iv).ok()
                }
                (p, _) => p, // plaintext or none
            };
            let consumers: Option<String> = r.get(6)?;
            Ok(TeamChannelItem {
                id: format!("pe-{}", r.get::<_, String>(0)?),
                kind: "event".into(),
                at: r.get(1)?,
                label: r.get(2)?,
                extra,
                persona_id: r.get(4)?,
                body: None,
                assignment_id: None,
                step_id: None,
                reply_to: None,
                deliberation_id: None,
                importance: None,
                consumers: consumers
                    .map(|c| c.split(',').filter(|s| !s.is_empty()).map(String::from).collect()),
            })
        })?;
        items.extend(rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)?);
    }

    // --- 3. Shared memory (directives now live in the channel table; legacy
    //         category='directive' rows are still read for back-compat) ---
    //
    // One table, two lenses: `memory` wants the knowledge rows, `message` wants
    // the legacy directives. Asking for only one must not spend the page budget
    // on the other, so the category predicate follows the requested lenses.
    if lenses.memories || lenses.messages {
        let category_clause = match (lenses.memories, lenses.messages) {
            (true, true) => "",
            (true, false) => " AND category != 'directive'",
            (false, true) => " AND category = 'directive'",
            (false, false) => unreachable!("guarded by the enclosing if"),
        };
        let sql = format!(
            "SELECT id,
                    strftime('%Y-%m-%dT%H:%M:%SZ', datetime(created_at)) AS at,
                    category, title, content, persona_id, tags, importance
             FROM team_memories
             WHERE team_id = ?1
               AND (strftime('%Y-%m-%dT%H:%M:%SZ', datetime(created_at)) < ?2
                    OR (strftime('%Y-%m-%dT%H:%M:%SZ', datetime(created_at)) = ?2
                        AND ('tm-' || id) < ?4)){category_clause}
             ORDER BY at DESC, id DESC LIMIT ?3"
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params![team_id, cursor, limit, cursor_id], |r| {
            let category: String = r.get(2)?;
            let title: String = r.get(3)?;
            let content: String = r.get(4)?;
            Ok(TeamChannelItem {
                id: format!("tm-{}", r.get::<_, String>(0)?),
                kind: if category == "directive" { "directive".into() } else { "memory".into() },
                at: r.get(1)?,
                label: category,
                body: Some(if title == content { content } else { format!("{title} — {content}") }),
                persona_id: r.get(5)?,
                extra: r.get(6)?,
                assignment_id: None,
                step_id: None,
                reply_to: None,
                deliberation_id: None,
                importance: r.get(7)?,
                consumers: None,
            })
        })?;
        items.extend(rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)?);
    }

    // --- 4. Channel messages (C1 — multi-author table; authoritative store
    //         for new directives and persona/athena/director posts) ---
    //
    // Deliberation turns live in this table too (`deliberation_id` set,
    // `consumer='display'`). They are NOT part of the plain conversation: the
    // query used to have no predicate on the column at all, so every turn leaked
    // into Collab as an ordinary persona/athena post.
    if lenses.messages || lenses.deliberations {
        let delib_clause = match (lenses.messages, lenses.deliberations) {
            (true, true) => "",
            (true, false) => " AND deliberation_id IS NULL",
            (false, true) => " AND deliberation_id IS NOT NULL",
            (false, false) => unreachable!("guarded by the enclosing if"),
        };
        let sql = format!(
            "SELECT id,
                    strftime('%Y-%m-%dT%H:%M:%SZ', datetime(created_at)) AS at,
                    author_kind, author_id, body, deliveries, assignment_id, reply_to,
                    deliberation_id
             FROM team_channel_messages
             WHERE team_id = ?1
               AND (strftime('%Y-%m-%dT%H:%M:%SZ', datetime(created_at)) < ?2
                    OR (strftime('%Y-%m-%dT%H:%M:%SZ', datetime(created_at)) = ?2
                        AND id < ?4)){delib_clause}
             ORDER BY at DESC, id DESC LIMIT ?3"
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params![team_id, cursor, limit, cursor_id], |r| {
            let author_kind: String = r.get(2)?;
            let deliveries: Option<String> = r.get(5)?;
            // The frontend's receipt parser expects a `{"deliveries":[…]}`
            // wrapper (it shares the team_memories tags shape); wrap the bare
            // column array so directives render their seen-by chips unchanged.
            let extra = deliveries.map(|d| format!("{{\"deliveries\":{d}}}"));
            // author_kind → the UI's item kind. 'user' is a directive; the
            // other kinds render via the multi-author path (C1c).
            let kind = if author_kind == "user" { "directive".to_string() } else { author_kind.clone() };
            Ok(TeamChannelItem {
                id: r.get::<_, String>(0)?,
                kind,
                at: r.get(1)?,
                label: author_kind,
                body: r.get(4)?,
                persona_id: r.get(3)?,
                extra,
                assignment_id: r.get(6)?,
                step_id: None,
                reply_to: r.get(7)?,
                deliberation_id: r.get(8)?,
                importance: None,
                consumers: None,
            })
        })?;
        items.extend(rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)?);
    }

    // Must mirror the per-query ORDER BY exactly — the composite cursor above
    // pages on (at, id), so the merge has to rank on (at, id) too.
    items.sort_by(|a, b| b.at.cmp(&a.at).then(b.id.cmp(&a.id)));
    items.truncate(limit as usize);
    Ok(items)
}

/// Post a user directive into the team channel. C1: stored in the
/// authoritative `team_channel_messages` table (`author_kind='user'`,
/// `consumer='inject'`). The orchestrator injects recent channel messages
/// addressed to a persona at each step boundary and records delivery receipts
/// on the message (see the orchestrator hook).
#[tauri::command]
pub fn post_team_directive(
    state: State<'_, Arc<AppState>>,
    team_id: String,
    content: String,
    reply_to: Option<String>,
) -> Result<crate::db::models::TeamChannelMessage, AppError> {
    require_auth_sync(&state)?;
    channel_repo::create(
        &state.db,
        crate::db::models::CreateChannelMessageInput {
            team_id,
            author_kind: "user".into(),
            author_id: None, // NULL author = the user
            body: content,
            addressed_to: None, // whole team
            reply_to, // threading: the channel message this replies to
            assignment_id: None,
            consumer: Some("inject".into()),
        },
    )
}

/// Athena (the companion) posts a message into a team channel (C2).
/// `author_kind='athena'`, `consumer='inject'` so it reaches the addressed
/// persona's next step (whole-team when `addressed_to` is None). Used both
/// interactively (Athena posts directly when the user asks) and, under
/// autonomous mode, via the approval executor's `post_team_message` op (which
/// is on the autoapprove allowlist → free when autonomous, gated otherwise).
#[tauri::command]
pub fn companion_post_team_message(
    state: State<'_, Arc<AppState>>,
    team_id: String,
    body: String,
    addressed_to: Option<Vec<String>>,
) -> Result<crate::db::models::TeamChannelMessage, AppError> {
    require_auth_sync(&state)?;
    channel_repo::create(
        &state.db,
        crate::db::models::CreateChannelMessageInput {
            team_id,
            author_kind: "athena".into(),
            author_id: None,
            body,
            addressed_to,
            reply_to: None,
            assignment_id: None,
            consumer: Some("inject".into()),
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init_test_db;
    use rusqlite::Connection;

    const TEAM: &str = "team-1";

    fn seed_team(conn: &Connection) {
        conn.execute(
            "INSERT INTO persona_teams (id, name, created_at, updated_at)
             VALUES (?1, 'T', datetime('now'), datetime('now'))",
            params![TEAM],
        )
        .unwrap();
    }

    /// One channel message at an exact second.
    fn msg(conn: &Connection, id: &str, at: &str, author_kind: &str, deliberation_id: Option<&str>) {
        conn.execute(
            "INSERT INTO team_channel_messages (id, team_id, author_kind, body, consumer, created_at, deliberation_id)
             VALUES (?1, ?2, ?3, 'b', 'inject', ?4, ?5)",
            params![id, TEAM, author_kind, at, deliberation_id],
        )
        .unwrap();
    }

    fn memory(conn: &Connection, id: &str, at: &str, category: &str, importance: i32) {
        conn.execute(
            "INSERT INTO team_memories (id, team_id, title, content, category, importance, created_at, updated_at)
             VALUES (?1, ?2, 't', 'c', ?3, ?4, ?5, ?5)",
            params![id, TEAM, category, importance, at],
        )
        .unwrap();
    }

    fn ids(items: &[TeamChannelItem]) -> Vec<String> {
        items.iter().map(|i| i.id.clone()).collect()
    }

    /// THE regression this phase exists for. `at` is second-resolution, so a
    /// burst of messages inside one second used to straddle the page boundary:
    /// paging with the old `at < cursor` predicate skipped every sibling that
    /// shared the last item's second. The composite (at, id) cursor keeps them.
    #[test]
    fn composite_cursor_does_not_drop_rows_sharing_the_boundary_second() {
        let pool = init_test_db().unwrap();
        let conn = pool.get().unwrap();
        seed_team(&conn);

        // Five messages in the SAME second, plus one older.
        for i in 0..5 {
            msg(&conn, &format!("m{i}"), "2026-07-13 10:00:00", "persona", None);
        }
        msg(&conn, "older", "2026-07-13 09:00:00", "persona", None);

        // Page 1: two rows — both inside the crowded second.
        let p1 = read_channel(&conn, TEAM, Some(2), None, None, None).unwrap();
        assert_eq!(ids(&p1), vec!["m4", "m3"]);

        // Page 2 resumes from the last item's (at, id).
        let last = p1.last().unwrap();
        let p2 = read_channel(&conn, TEAM, Some(2), Some(&last.at), Some(&last.id), None).unwrap();
        assert_eq!(ids(&p2), vec!["m2", "m1"], "siblings in the boundary second must survive");

        let last = p2.last().unwrap();
        let p3 = read_channel(&conn, TEAM, Some(2), Some(&last.at), Some(&last.id), None).unwrap();
        assert_eq!(ids(&p3), vec!["m0", "older"]);

        // Nothing was lost and nothing was served twice.
        let mut all = [ids(&p1), ids(&p2), ids(&p3)].concat();
        all.sort();
        assert_eq!(all, vec!["m0", "m1", "m2", "m3", "m4", "older"]);
    }

    /// Omitting `before_id` keeps the old strict-`at` semantics, so existing
    /// callers that page on the timestamp alone are unaffected.
    #[test]
    fn omitting_before_id_keeps_legacy_strict_at_paging() {
        let pool = init_test_db().unwrap();
        let conn = pool.get().unwrap();
        seed_team(&conn);
        msg(&conn, "a", "2026-07-13 10:00:00", "persona", None);
        msg(&conn, "b", "2026-07-13 10:00:00", "persona", None);
        msg(&conn, "old", "2026-07-13 09:00:00", "persona", None);

        let page = read_channel(&conn, TEAM, Some(10), Some("2026-07-13T10:00:00Z"), None, None).unwrap();
        assert_eq!(ids(&page), vec!["old"], "strict at < cursor — the same-second siblings are skipped");
    }

    /// The starvation fix: filtering to one lens must spend the page budget on
    /// THAT lens. Before the push-down, all four sources ran with LIMIT n and
    /// the union was truncated to n total — so a chatty source could push every
    /// memory out of the page and a memory-only view rendered empty.
    #[test]
    fn kind_filter_is_pushed_down_so_a_lens_cannot_be_starved() {
        let pool = init_test_db().unwrap();
        let conn = pool.get().unwrap();
        seed_team(&conn);

        // 30 newer messages that would otherwise crowd out the memories.
        for i in 0..30 {
            msg(&conn, &format!("chatty{i:02}"), "2026-07-13 12:00:00", "persona", None);
        }
        memory(&conn, "mem1", "2026-07-13 08:00:00", "observation", 7);
        memory(&conn, "mem2", "2026-07-13 07:00:00", "decision", 2);

        // Unfiltered, limit 5: the chatty messages legitimately win the page.
        let blended = read_channel(&conn, TEAM, Some(5), None, None, None).unwrap();
        assert!(blended.iter().all(|i| i.kind == "persona"));

        // Memory lens: the same limit now returns memories, not nothing.
        let kinds = vec!["memory".to_string()];
        let mem = read_channel(&conn, TEAM, Some(5), None, None, Some(&kinds)).unwrap();
        assert_eq!(ids(&mem), vec!["tm-mem1", "tm-mem2"]);
        assert!(mem.iter().all(|i| i.kind == "memory"));
    }

    /// Memory rows carry their 1-10 importance so the lens can sort/filter and
    /// render the dot editor — it used to be dropped by the read-model.
    #[test]
    fn memory_rows_carry_importance() {
        let pool = init_test_db().unwrap();
        let conn = pool.get().unwrap();
        seed_team(&conn);
        memory(&conn, "m", "2026-07-13 08:00:00", "learning", 9);

        let kinds = vec!["memory".to_string()];
        let items = read_channel(&conn, TEAM, Some(5), None, None, Some(&kinds)).unwrap();
        assert_eq!(items[0].importance, Some(9));
        assert_eq!(items[0].label, "learning");
    }

    /// THE LEAK. Deliberation turns are rows in team_channel_messages; the
    /// query had no predicate on deliberation_id, so every turn surfaced in the
    /// plain conversation as an ordinary persona/athena post — and the column
    /// wasn't exposed, so the frontend couldn't filter them out either.
    #[test]
    fn deliberation_turns_are_excluded_from_the_conversation_and_opt_in_only() {
        let pool = init_test_db().unwrap();
        let conn = pool.get().unwrap();
        seed_team(&conn);
        conn.execute(
            "INSERT INTO team_deliberations (id, team_id, topic, created_at, updated_at)
             VALUES ('d1', ?1, 'topic', datetime('now'), datetime('now'))",
            params![TEAM],
        )
        .unwrap();

        msg(&conn, "talk", "2026-07-13 10:00:00", "persona", None);
        msg(&conn, "turn", "2026-07-13 10:00:01", "persona", Some("d1"));

        // Default read: the turn must NOT leak into the conversation.
        let convo = read_channel(&conn, TEAM, Some(10), None, None, None).unwrap();
        assert_eq!(ids(&convo), vec!["talk"]);

        // Opt in explicitly to render the deliberation's turns.
        let kinds = vec!["deliberation".to_string()];
        let turns = read_channel(&conn, TEAM, Some(10), None, None, Some(&kinds)).unwrap();
        assert_eq!(ids(&turns), vec!["turn"]);
        assert_eq!(turns[0].deliberation_id.as_deref(), Some("d1"));
    }
}
