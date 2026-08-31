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
    /// authored by an INTERNAL voice (author_kind != 'slack')
    messages: bool,
    /// team_channel_messages with a deliberation_id
    deliberations: bool,
    /// team_channel_messages authored by an external Slack participant
    /// (`author_kind = 'slack'`, written by the inbound bridge). Its own lens
    /// because a bridged human is not one of the team's internal voices — but
    /// it blends into the unfiltered conversation, because they ARE talking in
    /// the channel.
    slack: bool,
}

impl Lenses {
    fn parse(kinds: Option<&[String]>) -> Self {
        match kinds {
            // No filter → today's blend, minus the deliberation leak. Slack
            // rows are part of the conversation, so they ride the default.
            None => Lenses {
                steps: true,
                events: true,
                memories: true,
                messages: true,
                deliberations: false,
                slack: true,
            },
            Some(k) => Lenses {
                steps: k.iter().any(|s| s == "step"),
                events: k.iter().any(|s| s == "event"),
                memories: k.iter().any(|s| s == "memory"),
                messages: k.iter().any(|s| s == "message"),
                deliberations: k.iter().any(|s| s == "deliberation"),
                slack: k.iter().any(|s| s == "slack"),
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
    read_channel(
        &conn,
        &team_id,
        limit,
        before.as_deref(),
        before_id.as_deref(),
        kinds.as_deref(),
    )
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
                if matches!(
                    kind.as_str(),
                    "status_awaiting_review" | "status_done" | "created"
                ) {
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
        items.extend(
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(AppError::Database)?,
        );
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
                consumers: consumers.map(|c| {
                    c.split(',')
                        .filter(|s| !s.is_empty())
                        .map(String::from)
                        .collect()
                }),
            })
        })?;
        items.extend(
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(AppError::Database)?,
        );
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
                kind: if category == "directive" {
                    "directive".into()
                } else {
                    "memory".into()
                },
                at: r.get(1)?,
                label: category,
                body: Some(if title == content {
                    content
                } else {
                    format!("{title} — {content}")
                }),
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
        items.extend(
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(AppError::Database)?,
        );
    }

    // --- 4. Channel messages (C1 — multi-author table; authoritative store
    //         for new directives and persona/athena/director posts) ---
    //
    // Deliberation turns live in this table too (`deliberation_id` set,
    // `consumer='display'`). They are NOT part of the plain conversation: the
    // query used to have no predicate on the column at all, so every turn leaked
    // into Collab as an ordinary persona/athena post.
    // `plain` = the non-deliberation half of this table, which BOTH the
    // `message` lens (internal voices) and the `slack` lens (external Slack
    // participants) read — they differ only by the author_kind predicate below.
    let plain = lenses.messages || lenses.slack;
    if plain || lenses.deliberations {
        let delib_clause = match (plain, lenses.deliberations) {
            (true, true) => "",
            (true, false) => " AND deliberation_id IS NULL",
            (false, true) => " AND deliberation_id IS NOT NULL",
            (false, false) => unreachable!("guarded by the enclosing if"),
        };
        // Deliberation-only reads carry no author predicate: a deliberation
        // turn is always an internal voice, so splitting them would only cost a
        // scan predicate.
        let author_clause = match (lenses.messages, lenses.slack) {
            (true, false) => " AND author_kind != 'slack'",
            (false, true) => " AND author_kind = 'slack'",
            _ => "",
        };
        let sql = format!(
            "SELECT id,
                    strftime('%Y-%m-%dT%H:%M:%SZ', datetime(created_at)) AS at,
                    author_kind, author_id, body, deliveries, assignment_id, reply_to,
                    deliberation_id, author_label
             FROM team_channel_messages
             WHERE team_id = ?1
               AND (strftime('%Y-%m-%dT%H:%M:%SZ', datetime(created_at)) < ?2
                    OR (strftime('%Y-%m-%dT%H:%M:%SZ', datetime(created_at)) = ?2
                        AND id < ?4)){delib_clause}{author_clause}
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
            // other kinds ('persona' | 'athena' | 'director' | 'slack') render
            // via the multi-author path (C1c).
            let kind = if author_kind == "user" {
                "directive".to_string()
            } else {
                author_kind.clone()
            };
            // `label` for a channel row is otherwise a redundant copy of
            // author_kind, so an EXTERNAL author's resolved display name rides
            // it (the bridge's hard contract with the renderer). NULL for every
            // internal author → byte-identical to the previous behaviour.
            let author_label: Option<String> = r.get(9)?;
            let label = author_label
                .filter(|l| !l.trim().is_empty())
                .unwrap_or_else(|| author_kind.clone());
            Ok(TeamChannelItem {
                id: r.get::<_, String>(0)?,
                kind,
                at: r.get(1)?,
                label,
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
        items.extend(
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(AppError::Database)?,
        );
    }

    // Must mirror the per-query ORDER BY exactly — the composite cursor above
    // pages on (at, id), so the merge has to rank on (at, id) too.
    items.sort_by(|a, b| b.at.cmp(&a.at).then(b.id.cmp(&a.id)));
    items.truncate(limit as usize);
    Ok(items)
}

/// Per-kind row counts for a team's channel.
///
/// The Stream's facet rail cannot count what it did not fetch — and deliberation
/// turns are deliberately absent from the blended read (they used to leak into
/// the conversation), so the rail was showing "Deliberation 0" for teams with
/// hundreds of turns. Counting has to happen where the rows are.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ChannelKindCounts {
    // i64 in SQL, but `number` on the wire: ts-rs maps i64 to `bigint`, which
    // will not do arithmetic with the plain numbers the facet rail sums. A row
    // count cannot approach 2^53, so this is safe — and it keeps the binding
    // usable. (Same trap as memory `importance`, which we hit in P1.)
    #[ts(type = "number")]
    pub step: i64,
    #[ts(type = "number")]
    pub event: i64,
    #[ts(type = "number")]
    pub memory: i64,
    #[ts(type = "number")]
    pub message: i64,
    #[ts(type = "number")]
    pub deliberation: i64,
    /// Channel rows authored by an external Slack participant. Counted
    /// separately from `message` for the same reason the lens splits them: they
    /// are people outside the team talking in it.
    #[ts(type = "number")]
    pub slack: i64,
}

#[tauri::command]
pub fn count_team_channel_kinds(
    state: State<'_, Arc<AppState>>,
    team_id: String,
) -> Result<ChannelKindCounts, AppError> {
    require_auth_sync(&state)?;
    let conn = state.db.get()?;
    count_kinds(&conn, &team_id)
}

/// The counts themselves, over a bare connection — split out for the same
/// reason `read_channel` is: the rail's promise is that a facet's count equals
/// what selecting that lens returns, and that invariant is only testable when
/// both halves can run against one SQLite schema.
pub(crate) fn count_kinds(
    conn: &rusqlite::Connection,
    team_id: &str,
) -> Result<ChannelKindCounts, AppError> {
    let step: i64 = conn.query_row(
        "SELECT count(*) FROM team_assignment_events e
         JOIN team_assignments a ON a.id = e.assignment_id
         WHERE a.team_id = ?1
           AND e.kind IN ('created','step_running','step_done','step_failed','step_skipped',
                          'status_awaiting_review','status_done','qa_changes_requested_rework')",
        params![team_id],
        |r| r.get(0),
    )?;

    let event: i64 = conn.query_row(
        "SELECT count(*) FROM persona_events e
         WHERE e.source_id IN (SELECT persona_id FROM persona_team_members WHERE team_id = ?1)
           AND e.event_type != 'task_completed'
           AND e.event_type NOT LIKE '\\_chain\\_%' ESCAPE '\\'",
        params![team_id],
        |r| r.get(0),
    )?;

    let memory: i64 = conn.query_row(
        "SELECT count(*) FROM team_memories WHERE team_id = ?1 AND category != 'directive'",
        params![team_id],
        |r| r.get(0),
    )?;

    // 'message' = the channel table's non-deliberation rows PLUS the legacy
    // directives still living in team_memories — the same union the read-model's
    // `message` lens serves.
    // Slack rows are excluded here and counted on their own below — the rail's
    // invariant is that a facet's count equals what selecting it returns.
    let msg_rows: i64 = conn.query_row(
        "SELECT count(*) FROM team_channel_messages
         WHERE team_id = ?1 AND deliberation_id IS NULL AND author_kind != 'slack'",
        params![team_id],
        |r| r.get(0),
    )?;
    let legacy_directives: i64 = conn.query_row(
        "SELECT count(*) FROM team_memories WHERE team_id = ?1 AND category = 'directive'",
        params![team_id],
        |r| r.get(0),
    )?;

    let deliberation: i64 = conn.query_row(
        "SELECT count(*) FROM team_channel_messages WHERE team_id = ?1 AND deliberation_id IS NOT NULL",
        params![team_id],
        |r| r.get(0),
    )?;

    let slack: i64 = conn.query_row(
        "SELECT count(*) FROM team_channel_messages
         WHERE team_id = ?1 AND deliberation_id IS NULL AND author_kind = 'slack'",
        params![team_id],
        |r| r.get(0),
    )?;

    Ok(ChannelKindCounts {
        step,
        event,
        memory,
        message: msg_rows + legacy_directives,
        deliberation,
        slack,
    })
}

/// One team <-> Slack bridge, as the UI sees it.
///
/// REQUIRED as its own command because `list_personas` is a lean projection
/// that returns `notification_channels` blank — the frontend physically cannot
/// derive bridges from the personas it holds. The backing config still lives on
/// the persona's channel spec (see `engine/slack_bridge.rs`); this is a
/// read-only projection of it.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct TeamSlackBridgeInfo {
    pub team_id: String,
    /// Persona whose notification channel carries the bridge (and whose
    /// credential the poller reads with).
    pub persona_id: String,
    pub slack_channel_id: String,
    pub credential_id: String,
    pub poll_inbound: bool,
    pub outbound_messages: bool,
    pub outbound_directives: bool,
    pub outbound_steps: bool,
}

/// Every configured team <-> Slack bridge across all enabled personas.
///
/// Cheap: one `personas::get_enabled` read plus a JSON parse per persona, the
/// same scan both bridge loops already do every tick.
#[tauri::command]
pub fn list_team_slack_bridges(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<TeamSlackBridgeInfo>, AppError> {
    require_auth_sync(&state)?;
    Ok(crate::engine::slack_bridge::list_bridges(&state.db)?
        .into_iter()
        .map(|b| TeamSlackBridgeInfo {
            team_id: b.team_id,
            persona_id: b.persona_id,
            slack_channel_id: b.slack_channel_id,
            credential_id: b.credential_id,
            poll_inbound: b.poll_inbound,
            outbound_messages: b.outbound_messages,
            outbound_directives: b.outbound_directives,
            outbound_steps: b.outbound_steps,
        })
        .collect())
}

/// How many prior channel rows a summoned persona sees as conversation context.
const SUMMON_PRIOR_MESSAGES: i64 = 12;
/// At most this many personas answer one directive, however many are mentioned.
const SUMMON_CAP: usize = 3;
const SUMMON_REPLY_DEADLINE_SECS: u64 = 30 * 60;
const SUMMON_REPLY_POLL_SECS: u64 = 2;

/// Post a user directive into the team channel. C1: stored in the
/// authoritative `team_channel_messages` table (`author_kind='user'`).
///
/// Two delivery shapes, decided by `@`-mentions in the content:
///
/// - **No mention** → `consumer='inject'`, `addressed_to=NULL` (whole team):
///   the orchestrator injects the message at each running step boundary and
///   records delivery receipts — the original behavior. If nothing is
///   running, the message waits.
/// - **`@Persona Name` mentioned** → `consumer='mention'` (the documented
///   routes-to-an-actor value, previously unimplemented), `addressed_to` set,
///   and each mentioned team member is *summoned*: a follow-up execution runs
///   with the channel history + a live-context block as input, and the reply
///   lands back in the channel as its own `author_kind='persona'` row —
///   whether or not any assignment is running. Matching is case-insensitive
///   on the member's display name; capped at [`SUMMON_CAP`] personas.
#[tauri::command]
pub async fn post_team_directive(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    team_id: String,
    content: String,
    reply_to: Option<String>,
) -> Result<crate::db::models::TeamChannelMessage, AppError> {
    require_auth_sync(&state)?;

    let mentioned = mentioned_members(&state.db, &team_id, &content)?;
    let consumer = if mentioned.is_empty() {
        "inject"
    } else {
        "mention"
    };
    let addressed_to = if mentioned.is_empty() {
        None // whole team
    } else {
        Some(mentioned.iter().map(|(id, _)| id.clone()).collect())
    };

    let message = channel_repo::create(
        &state.db,
        crate::db::models::CreateChannelMessageInput {
            team_id: team_id.clone(),
            author_kind: "user".into(),
            author_id: None, // NULL author = the user
            body: content.clone(),
            addressed_to,
            reply_to, // threading: the channel message this replies to
            assignment_id: None,
            consumer: Some(consumer.into()),
        },
    )?;

    for (persona_id, persona_name) in mentioned {
        summon_member(
            &state,
            &app,
            &team_id,
            &message.id,
            &content,
            persona_id,
            persona_name,
        );
    }

    Ok(message)
}

/// Resolve the team's members whose display name is `@`-mentioned in `body`,
/// case-insensitively, deduped, capped at [`SUMMON_CAP`].
fn mentioned_members(
    pool: &crate::db::DbPool,
    team_id: &str,
    body: &str,
) -> Result<Vec<(String, String)>, AppError> {
    if !body.contains('@') {
        return Ok(Vec::new());
    }
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT DISTINCT p.id, p.name FROM persona_team_members m
         JOIN personas p ON p.id = m.persona_id
         WHERE m.team_id = ?1",
    )?;
    let members = stmt
        .query_map(params![team_id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::Database)?;

    let haystack = body.to_lowercase();
    let mut matched: Vec<(String, String)> = members
        .into_iter()
        .filter(|(_, name)| {
            let name = name.trim();
            !name.is_empty() && haystack.contains(&format!("@{}", name.to_lowercase()))
        })
        .collect();
    matched.truncate(SUMMON_CAP);
    Ok(matched)
}

/// Spawn the summon follow-up for one mentioned member: execute with channel
/// context, then write the reply (or the failure record) back into the team
/// channel. Fire-and-forget — the directive post returns immediately.
fn summon_member(
    state: &State<'_, Arc<AppState>>,
    app: &tauri::AppHandle,
    team_id: &str,
    message_id: &str,
    content: &str,
    persona_id: String,
    persona_name: String,
) {
    // Conversation context: the last few non-deliberation channel messages
    // BEFORE this one, oldest first — same shape Lane B renders.
    let prior_messages: Vec<serde_json::Value> = (|| -> Result<_, AppError> {
        let conn = state.db.get()?;
        let mut stmt = conn.prepare(
            "SELECT author_kind, body FROM team_channel_messages
             WHERE team_id = ?1 AND id != ?2 AND deliberation_id IS NULL
             ORDER BY created_at DESC, id DESC LIMIT ?3",
        )?;
        let mut rows: Vec<serde_json::Value> = stmt
            .query_map(params![team_id, message_id, SUMMON_PRIOR_MESSAGES], |r| {
                Ok(serde_json::json!({
                    "author": r.get::<_, String>(0)?,
                    "content": r.get::<_, String>(1)?,
                }))
            })?
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)?;
        rows.reverse();
        Ok(rows)
    })()
    .unwrap_or_default();

    // Same envelope as the persona channel's Lane B follow-up (`source:
    // "channel"` also tells dispatch the chat lane is externally owned), plus
    // the live-context block so the reply is situated in the team's state.
    let input_data = serde_json::json!({
        "source": "channel",
        "channelId": team_id,
        "messageId": message_id,
        "author": "user",
        "content": content,
        "priorMessages": prior_messages,
        "liveContext": crate::engine::channel_live_context::build_live_context(
            &state.db,
            &persona_id,
            Some(team_id),
        ),
    });
    // One execution per (message, persona), ever — a retry dedupes.
    let idempotency_key = format!("channel:{team_id}:{message_id}:{persona_id}");

    let state_arc: Arc<AppState> = state.inner().clone();
    let app = app.clone();
    let team_id = team_id.to_string();
    let message_id = message_id.to_string();
    let panic_pool = state_arc.db.clone();
    let panic_team_id = team_id.clone();
    let panic_message_id = message_id.clone();
    let panic_persona_id = persona_id.clone();
    let panic_name = persona_name.clone();
    crate::background_job::spawn_guarded(
        "team_channel_summon",
        persona_id.clone(),
        async move {
            run_summon_followup(
                state_arc,
                app,
                team_id,
                persona_id,
                persona_name,
                message_id,
                input_data.to_string(),
                idempotency_key,
            )
            .await;
        },
        move |panic_msg| async move {
            // Failure is not empty success: even a panic leaves a record.
            insert_summon_reply(
                &panic_pool,
                &panic_team_id,
                &panic_persona_id,
                &panic_name,
                &panic_message_id,
                &format!("_(summon crashed: {panic_msg})_"),
            );
        },
    );
}

/// The spawned half: execute, wait for the terminal state, post the reply
/// into the team channel.
#[allow(clippy::too_many_arguments)]
async fn run_summon_followup(
    state: Arc<AppState>,
    app: tauri::AppHandle,
    team_id: String,
    persona_id: String,
    persona_name: String,
    message_id: String,
    input_data: String,
    idempotency_key: String,
) {
    let execution = crate::commands::execution::executions::execute_persona_inner(
        &state,
        app,
        persona_id.clone(),
        None,
        Some(input_data),
        None,
        None,
        Some(idempotency_key),
        false,
    )
    .await;

    let execution = match execution {
        Ok(exec) => exec,
        Err(e) => {
            insert_summon_reply(
                &state.db,
                &team_id,
                &persona_id,
                &persona_name,
                &message_id,
                &format!("_(summon failed to start: {e})_"),
            );
            return;
        }
    };

    let deadline =
        tokio::time::Instant::now() + tokio::time::Duration::from_secs(SUMMON_REPLY_DEADLINE_SECS);
    loop {
        match crate::engine::channel_reply::build_reply_text(&state.db, &execution.id) {
            Ok(Some(text)) => {
                insert_summon_reply(
                    &state.db,
                    &team_id,
                    &persona_id,
                    &persona_name,
                    &message_id,
                    &text,
                );
                return;
            }
            Ok(None) => {
                if tokio::time::Instant::now() >= deadline {
                    insert_summon_reply(
                        &state.db,
                        &team_id,
                        &persona_id,
                        &persona_name,
                        &message_id,
                        "_(run did not finish within 30 minutes — check the execution log)_",
                    );
                    return;
                }
                tokio::time::sleep(tokio::time::Duration::from_secs(SUMMON_REPLY_POLL_SECS)).await;
            }
            Err(e) => {
                insert_summon_reply(
                    &state.db,
                    &team_id,
                    &persona_id,
                    &persona_name,
                    &message_id,
                    &format!("_(run ended without a reply: {e})_"),
                );
                return;
            }
        }
    }
}

/// Insert the persona's reply as a `consumer='display'` channel row threaded
/// under the summoning directive. The 15s channel poll surfaces it.
fn insert_summon_reply(
    pool: &crate::db::DbPool,
    team_id: &str,
    persona_id: &str,
    _persona_name: &str,
    reply_to: &str,
    body: &str,
) {
    let result = channel_repo::create(
        pool,
        crate::db::models::CreateChannelMessageInput {
            team_id: team_id.to_string(),
            author_kind: "persona".into(),
            author_id: Some(persona_id.to_string()),
            body: body.to_string(),
            addressed_to: None,
            reply_to: Some(reply_to.to_string()),
            assignment_id: None,
            consumer: Some("display".into()),
        },
    );
    if let Err(e) = result {
        tracing::error!(
            team_id = %team_id,
            persona_id = %persona_id,
            error = %e,
            "team channel: failed to persist summon reply row"
        );
    }
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
    fn msg(
        conn: &Connection,
        id: &str,
        at: &str,
        author_kind: &str,
        deliberation_id: Option<&str>,
    ) {
        conn.execute(
            "INSERT INTO team_channel_messages (id, team_id, author_kind, body, consumer, created_at, deliberation_id)
             VALUES (?1, ?2, ?3, 'b', 'inject', ?4, ?5)",
            params![id, TEAM, author_kind, at, deliberation_id],
        )
        .unwrap();
    }

    /// A message that arrived over the team's Slack bridge: `author_kind`
    /// 'slack', the Slack user id in `author_id`, the resolved display name in
    /// `author_label`.
    fn slack_msg(conn: &Connection, id: &str, at: &str, user: &str, name: Option<&str>) {
        conn.execute(
            "INSERT INTO team_channel_messages
                (id, team_id, author_kind, author_id, body, consumer, created_at, author_label)
             VALUES (?1, ?2, 'slack', ?3, 'from slack', 'inject', ?4, ?5)",
            params![id, TEAM, user, at, name],
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
            msg(
                &conn,
                &format!("m{i}"),
                "2026-07-13 10:00:00",
                "persona",
                None,
            );
        }
        msg(&conn, "older", "2026-07-13 09:00:00", "persona", None);

        // Page 1: two rows — both inside the crowded second.
        let p1 = read_channel(&conn, TEAM, Some(2), None, None, None).unwrap();
        assert_eq!(ids(&p1), vec!["m4", "m3"]);

        // Page 2 resumes from the last item's (at, id).
        let last = p1.last().unwrap();
        let p2 = read_channel(&conn, TEAM, Some(2), Some(&last.at), Some(&last.id), None).unwrap();
        assert_eq!(
            ids(&p2),
            vec!["m2", "m1"],
            "siblings in the boundary second must survive"
        );

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

        let page = read_channel(
            &conn,
            TEAM,
            Some(10),
            Some("2026-07-13T10:00:00Z"),
            None,
            None,
        )
        .unwrap();
        assert_eq!(
            ids(&page),
            vec!["old"],
            "strict at < cursor — the same-second siblings are skipped"
        );
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
            msg(
                &conn,
                &format!("chatty{i:02}"),
                "2026-07-13 12:00:00",
                "persona",
                None,
            );
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

    /// The facet counts must AGREE with the lens they describe. A count that
    /// disagrees with what selecting it actually shows is worse than no count —
    /// which is the whole reason this command exists (the rail was reading
    /// "Deliberation 0" for teams with hundreds of turns, because it was
    /// counting rows it had never fetched).
    #[test]
    fn kind_counts_agree_with_the_lens_they_describe() {
        let pool = init_test_db().unwrap();
        let conn = pool.get().unwrap();
        seed_team(&conn);
        conn.execute(
            "INSERT INTO team_deliberations (id, team_id, topic, created_at, updated_at)
             VALUES ('d1', ?1, 't', datetime('now'), datetime('now'))",
            params![TEAM],
        )
        .unwrap();

        for i in 0..3 {
            msg(
                &conn,
                &format!("talk{i}"),
                "2026-07-13 10:00:00",
                "persona",
                None,
            );
        }
        for i in 0..5 {
            msg(
                &conn,
                &format!("turn{i}"),
                "2026-07-13 10:00:00",
                "persona",
                Some("d1"),
            );
        }
        memory(&conn, "m1", "2026-07-13 09:00:00", "observation", 5);
        memory(&conn, "m2", "2026-07-13 09:00:00", "decision", 5);

        // What the lens returns…
        let msgs = read_channel(
            &conn,
            TEAM,
            Some(200),
            None,
            None,
            Some(&["message".into()]),
        )
        .unwrap();
        let turns = read_channel(
            &conn,
            TEAM,
            Some(200),
            None,
            None,
            Some(&["deliberation".into()]),
        )
        .unwrap();
        let mems =
            read_channel(&conn, TEAM, Some(200), None, None, Some(&["memory".into()])).unwrap();

        // …must be what the rail promises.
        assert_eq!(msgs.len(), 3);
        assert_eq!(turns.len(), 5, "the count the old rail rendered as 0");
        assert_eq!(mems.len(), 2);
    }

    /// The bridge's HARD CONTRACT with the renderer: a Slack row surfaces as
    /// `kind = 'slack'` with the resolved display name in `label` (which for a
    /// channel row is otherwise a redundant copy of author_kind). Without the
    /// name the renderer has only a `U…` id to show.
    #[test]
    fn slack_rows_carry_the_resolved_display_name_in_label() {
        let pool = init_test_db().unwrap();
        let conn = pool.get().unwrap();
        seed_team(&conn);
        slack_msg(
            &conn,
            "s1",
            "2026-08-04 10:00:00",
            "U123",
            Some("Ada Lovelace"),
        );
        // Unresolvable name → the column stays NULL and label degrades to the
        // author kind, which is exactly what the renderer's fallback expects.
        slack_msg(&conn, "s0", "2026-08-04 09:00:00", "U456", None);

        let items =
            read_channel(&conn, TEAM, Some(10), None, None, Some(&["slack".into()])).unwrap();
        assert_eq!(ids(&items), vec!["s1", "s0"]);
        assert!(items.iter().all(|i| i.kind == "slack"));
        assert_eq!(items[0].label, "Ada Lovelace");
        assert_eq!(items[0].persona_id.as_deref(), Some("U123"));
        assert_eq!(
            items[1].label, "slack",
            "no name → the raw kind, never NULL"
        );
    }

    /// The `slack` lens exists, blends into the unfiltered conversation (a
    /// bridged human IS talking in the channel), and splits cleanly from
    /// `message` when either is asked for on its own.
    #[test]
    fn slack_is_its_own_lens_but_blends_by_default() {
        let pool = init_test_db().unwrap();
        let conn = pool.get().unwrap();
        seed_team(&conn);
        msg(&conn, "p1", "2026-08-04 10:00:02", "persona", None);
        slack_msg(&conn, "s1", "2026-08-04 10:00:01", "U123", Some("Ada"));
        msg(&conn, "u1", "2026-08-04 10:00:00", "user", None);

        // Default blend: everything, Slack included.
        let all = read_channel(&conn, TEAM, Some(10), None, None, None).unwrap();
        assert_eq!(ids(&all), vec!["p1", "s1", "u1"]);

        // Internal voices only.
        let internal =
            read_channel(&conn, TEAM, Some(10), None, None, Some(&["message".into()])).unwrap();
        assert_eq!(ids(&internal), vec!["p1", "u1"]);

        // External voices only.
        let external =
            read_channel(&conn, TEAM, Some(10), None, None, Some(&["slack".into()])).unwrap();
        assert_eq!(ids(&external), vec!["s1"]);

        // Both, explicitly.
        let both = read_channel(
            &conn,
            TEAM,
            Some(10),
            None,
            None,
            Some(&["message".into(), "slack".into()]),
        )
        .unwrap();
        assert_eq!(ids(&both), vec!["p1", "s1", "u1"]);
    }

    /// Same invariant the deliberation count had to satisfy: the rail's Slack
    /// number must equal what selecting the Slack lens returns, and the message
    /// count must no longer double-count the Slack rows it excludes.
    #[test]
    fn slack_counts_agree_with_the_slack_lens() {
        let pool = init_test_db().unwrap();
        let conn = pool.get().unwrap();
        seed_team(&conn);
        for i in 0..2 {
            msg(
                &conn,
                &format!("p{i}"),
                "2026-08-04 10:00:00",
                "persona",
                None,
            );
        }
        for i in 0..3 {
            slack_msg(
                &conn,
                &format!("s{i}"),
                "2026-08-04 10:00:00",
                "U1",
                Some("Ada"),
            );
        }

        let counts = count_kinds(&conn, TEAM).unwrap();
        let slack_rows =
            read_channel(&conn, TEAM, Some(200), None, None, Some(&["slack".into()])).unwrap();
        let internal = read_channel(
            &conn,
            TEAM,
            Some(200),
            None,
            None,
            Some(&["message".into()]),
        )
        .unwrap();

        assert_eq!(counts.slack, 3);
        assert_eq!(counts.slack as usize, slack_rows.len());
        assert_eq!(counts.message, 2);
        assert_eq!(counts.message as usize, internal.len());
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

    fn seed_member(conn: &Connection, persona_id: &str, name: &str) {
        conn.execute(
            "INSERT INTO personas (id, project_id, name, system_prompt, created_at, updated_at)
             VALUES (?1, 'default', ?2, 'sp', datetime('now'), datetime('now'))",
            params![persona_id, name],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO persona_team_members (id, team_id, persona_id, created_at)
             VALUES (?1, ?2, ?3, datetime('now'))",
            params![format!("m-{persona_id}"), TEAM, persona_id],
        )
        .unwrap();
    }

    /// `@Name` matching is case-insensitive, only hits actual team members,
    /// and a mention-free body resolves to nobody (whole-team inject path).
    #[test]
    fn mentioned_members_matches_case_insensitively_and_only_members() {
        let pool = init_test_db().unwrap();
        {
            let conn = pool.get().unwrap();
            seed_team(&conn);
            seed_member(&conn, "p-rev", "Code Reviewer");
            seed_member(&conn, "p-qa", "QA Guardian");
        }

        let hits =
            mentioned_members(&pool, TEAM, "@code reviewer can you check the diff?").unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].0, "p-rev");

        // Not a member name → no summon; plain text → no summon.
        assert!(mentioned_members(&pool, TEAM, "@Grok is this true?")
            .unwrap()
            .is_empty());
        assert!(mentioned_members(&pool, TEAM, "ship it")
            .unwrap()
            .is_empty());

        // Both members mentioned in one directive.
        let both =
            mentioned_members(&pool, TEAM, "@Code Reviewer + @QA Guardian: thoughts?").unwrap();
        assert_eq!(both.len(), 2);
    }
}
