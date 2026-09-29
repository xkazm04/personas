//! The twin setup plan's tables (migration `e47_twin_setup_plan`).
//!
//! WP0 of spark `twin-setup-plan`: the reads the snapshot needs plus the plan
//! upsert. The engine (planner, reconciler, answer/steer writes) builds on
//! these. Rules this door holds:
//!
//! - **JSON columns are parsed here**, through `Json<T>`, into the wire models;
//!   a malformed column is a row-mapping error, never a silently empty list.
//! - **Timestamps are SQLite `datetime('now')` text** (`YYYY-MM-DD HH:MM:SS`,
//!   UTC) in every one of these tables, because the snapshot compares them as
//!   strings (`resolved_at >= asked_at`). A writer that stamps RFC 3339 instead
//!   breaks that comparison — stamp in SQL.
//! - **[`snapshot`] reads on ONE connection inside one transaction**, so the
//!   client never sees a live step from one moment and its offers from another.

use rusqlite::{params, Connection, OptionalExtension};

use crate::models::{
    Json, SetupGoal, SetupKindStat, SetupObservation, SetupOffer, SetupReadiness,
    SetupSessionSnapshot, SetupStep, SetupSuggestion,
};
use crate::query_builder::QueryBuilder;
use crate::DbPool;
use personas_core::error::AppError;

/// How many queued steps the snapshot shows as `upcoming`.
pub const SNAPSHOT_UPCOMING: i64 = 5;
/// How many answered/skipped steps the snapshot shows as `transcript`.
pub const SNAPSHOT_TRANSCRIPT: i64 = 50;

// ============================================================================
// Projections
// ============================================================================

const PLAN_COLUMNS: &str = "twin_id, status, version, stage, topic_preset, focus_slot, locale, \
     readiness_json, answers_since_deep, change_note, error, lease_at, created_at, updated_at, \
     last_deep_at";

const GOAL_COLUMNS: &str =
    "id, slot, title, intent, criteria_json, state, pinned, coverage, position, answered";

const STEP_COLUMNS: &str = "id, goal_id, stage, origin, kind, question, answer_mode, incoming, \
     tone_channel, suggestions_json, status, answer, position, asked_at, answered_at, reconciled";

const OFFER_COLUMNS: &str =
    "id, step_id, origin, kind, part, channel, value, length_hint, reason, status";

const OBSERVATION_COLUMNS: &str = "id, text, evidence, updated_at";

// ============================================================================
// Rows
// ============================================================================

/// One `twin_setup_plans` row, JSON already parsed. Vocabularies are the
/// migration's CHECK lists: `status` building|ready|failed, `stage`
/// setup|training.
#[derive(Debug, Clone)]
pub struct PlanRow {
    pub twin_id: String,
    pub status: String,
    pub version: i64,
    pub stage: String,
    pub topic_preset: Option<String>,
    pub focus_slot: Option<String>,
    pub locale: Option<String>,
    /// `readiness_json`, parsed.
    pub readiness: Option<SetupReadiness>,
    pub answers_since_deep: i64,
    pub change_note: Option<String>,
    pub error: Option<String>,
    pub lease_at: Option<String>,
    /// Read-only: [`upsert_plan`] stamps both timestamps itself.
    pub created_at: String,
    pub updated_at: String,
    pub last_deep_at: Option<String>,
}

impl PlanRow {
    /// A plan that does not exist yet: `building`, version 0, stage `setup`.
    /// The timestamps are empty until [`upsert_plan`] writes the row.
    pub fn fresh(twin_id: &str) -> Self {
        Self {
            twin_id: twin_id.to_string(),
            status: "building".to_string(),
            version: 0,
            stage: "setup".to_string(),
            topic_preset: None,
            focus_slot: None,
            locale: None,
            readiness: None,
            answers_since_deep: 0,
            change_note: None,
            error: None,
            lease_at: None,
            created_at: String::new(),
            updated_at: String::new(),
            last_deep_at: None,
        }
    }
}

/// The plan row as SQLite hands it over; [`row_to_plan`] unwraps the JSON.
struct PlanRowRaw {
    twin_id: String,
    status: String,
    version: i64,
    stage: String,
    topic_preset: Option<String>,
    focus_slot: Option<String>,
    locale: Option<String>,
    readiness_json: Option<Json<SetupReadiness>>,
    answers_since_deep: i64,
    change_note: Option<String>,
    error: Option<String>,
    lease_at: Option<String>,
    created_at: String,
    updated_at: String,
    last_deep_at: Option<String>,
}

row_mapper!(row_to_plan_raw -> PlanRowRaw {
    twin_id, status, version, stage, topic_preset, focus_slot, locale, readiness_json,
    answers_since_deep, change_note, error, lease_at, created_at, updated_at, last_deep_at,
});

fn row_to_plan(row: &rusqlite::Row) -> rusqlite::Result<PlanRow> {
    let raw = row_to_plan_raw(row)?;
    Ok(PlanRow {
        twin_id: raw.twin_id,
        status: raw.status,
        version: raw.version,
        stage: raw.stage,
        topic_preset: raw.topic_preset,
        focus_slot: raw.focus_slot,
        locale: raw.locale,
        readiness: raw.readiness_json.map(Json::into_inner),
        answers_since_deep: raw.answers_since_deep,
        change_note: raw.change_note,
        error: raw.error,
        lease_at: raw.lease_at,
        created_at: raw.created_at,
        updated_at: raw.updated_at,
        last_deep_at: raw.last_deep_at,
    })
}

struct GoalRow {
    id: String,
    slot: String,
    title: String,
    intent: String,
    criteria_json: Json<Vec<String>>,
    state: String,
    pinned: bool,
    coverage: f64,
    position: i64,
    answered: i64,
}

row_mapper!(row_to_goal_raw -> GoalRow {
    id, slot, title, intent, criteria_json, state, pinned[bool], coverage, position, answered,
});

fn row_to_goal(row: &rusqlite::Row) -> rusqlite::Result<SetupGoal> {
    let raw = row_to_goal_raw(row)?;
    Ok(SetupGoal {
        id: raw.id,
        slot: raw.slot,
        title: raw.title,
        intent: raw.intent,
        criteria: raw.criteria_json.into_inner(),
        state: raw.state,
        pinned: raw.pinned,
        coverage: raw.coverage,
        position: raw.position,
        answered: raw.answered,
    })
}

struct StepRow {
    id: String,
    goal_id: Option<String>,
    stage: String,
    origin: String,
    kind: String,
    question: String,
    answer_mode: String,
    incoming: Option<String>,
    tone_channel: Option<String>,
    suggestions_json: Json<Vec<SetupSuggestion>>,
    status: String,
    answer: Option<String>,
    position: i64,
    asked_at: Option<String>,
    answered_at: Option<String>,
    reconciled: bool,
}

row_mapper!(row_to_step_raw -> StepRow {
    id, goal_id, stage, origin, kind, question, answer_mode, incoming, tone_channel,
    suggestions_json, status, answer, position, asked_at, answered_at, reconciled[bool],
});

fn row_to_step(row: &rusqlite::Row) -> rusqlite::Result<SetupStep> {
    let raw = row_to_step_raw(row)?;
    Ok(SetupStep {
        id: raw.id,
        goal_id: raw.goal_id,
        stage: raw.stage,
        origin: raw.origin,
        kind: raw.kind,
        question: raw.question,
        answer_mode: raw.answer_mode,
        incoming: raw.incoming,
        tone_channel: raw.tone_channel,
        suggestions: raw.suggestions_json.into_inner(),
        status: raw.status,
        answer: raw.answer,
        position: raw.position,
        asked_at: raw.asked_at,
        answered_at: raw.answered_at,
        reconciled: raw.reconciled,
    })
}

row_mapper!(row_to_offer -> SetupOffer {
    id, step_id, origin, kind, part, channel, value, length_hint, reason, status,
});

row_mapper!(row_to_observation -> SetupObservation { id, text, evidence, updated_at });

row_mapper!(row_to_kind_stat -> SetupKindStat {
    kind, asked, skipped, offers_made, offers_accepted, mean_gain,
});

// ============================================================================
// Plan
// ============================================================================

pub fn get_plan_on(conn: &Connection, twin_id: &str) -> Result<Option<PlanRow>, AppError> {
    timed_query!("twin_setup_plans", "twin_setup_plans::get_plan_on", {
        Ok(conn
            .query_row(
                &format!("SELECT {PLAN_COLUMNS} FROM twin_setup_plans WHERE twin_id = ?1"),
                params![twin_id],
                row_to_plan,
            )
            .optional()?)
    })
}

/// The twin's plan row, `None` before the first plan was started.
pub fn get_plan(pool: &DbPool, twin_id: &str) -> Result<Option<PlanRow>, AppError> {
    timed_query!("twin_setup_plans", "twin_setup_plans::get", {
        let conn = pool.get()?;
        get_plan_on(&conn, twin_id)
    })
}

/// Insert or replace the twin's plan row. `created_at` is stamped on insert
/// and kept on update; `updated_at` is stamped on every write. The row's own
/// timestamp fields are ignored.
pub fn upsert_plan(pool: &DbPool, plan: &PlanRow) -> Result<(), AppError> {
    timed_query!("twin_setup_plans", "twin_setup_plans::upsert", {
        let conn = pool.get()?;
        upsert_plan_on(&conn, plan)
    })
}

/// [`upsert_plan`] on a caller's connection (or transaction). Note `lease_at`
/// is written from the row verbatim; stamp a lease with [`take_lease_on`].
pub fn upsert_plan_on(conn: &Connection, plan: &PlanRow) -> Result<(), AppError> {
    timed_query!("twin_setup_plans", "twin_setup_plans::upsert_plan_on", {
        conn.execute(
            "INSERT INTO twin_setup_plans
                (twin_id, status, version, stage, topic_preset, focus_slot, locale,
                 readiness_json, answers_since_deep, change_note, error, lease_at, last_deep_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
             ON CONFLICT(twin_id) DO UPDATE SET
                status = excluded.status,
                version = excluded.version,
                stage = excluded.stage,
                topic_preset = excluded.topic_preset,
                focus_slot = excluded.focus_slot,
                locale = excluded.locale,
                readiness_json = excluded.readiness_json,
                answers_since_deep = excluded.answers_since_deep,
                change_note = excluded.change_note,
                error = excluded.error,
                lease_at = excluded.lease_at,
                last_deep_at = excluded.last_deep_at,
                updated_at = datetime('now')",
            params![
                plan.twin_id,
                plan.status,
                plan.version,
                plan.stage,
                plan.topic_preset,
                plan.focus_slot,
                plan.locale,
                plan.readiness.clone().map(Json),
                plan.answers_since_deep,
                plan.change_note,
                plan.error,
                plan.lease_at,
                plan.last_deep_at,
            ],
        )?;
        Ok(())
    })
}

// ============================================================================
// Goals
// ============================================================================

pub fn list_goals_on(conn: &Connection, twin_id: &str) -> Result<Vec<SetupGoal>, AppError> {
    timed_query!("twin_setup_goals", "twin_setup_goals::list_goals_on", {
        let mut stmt = conn.prepare(&format!(
            "SELECT {GOAL_COLUMNS} FROM twin_setup_goals WHERE twin_id = ?1 \
             ORDER BY position ASC, rowid ASC"
        ))?;
        let rows = stmt.query_map(params![twin_id], row_to_goal)?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    })
}

/// Every goal of the twin's plan (dropped ones included), by position.
pub fn list_goals(pool: &DbPool, twin_id: &str) -> Result<Vec<SetupGoal>, AppError> {
    timed_query!("twin_setup_goals", "twin_setup_goals::list", {
        let conn = pool.get()?;
        list_goals_on(&conn, twin_id)
    })
}

// ============================================================================
// Steps
// ============================================================================

/// Which end of the step list [`list_steps`] reads.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StepOrder {
    /// The queue: lowest `position` first, the first `limit` of them.
    Position,
    /// History: the `limit` most recently answered (`answered_at`, falling
    /// back to `asked_at` then `created_at` for a skip that stamped none),
    /// returned OLDEST FIRST — the order a transcript is read in.
    Recent,
}

pub fn list_steps_on(
    conn: &Connection,
    twin_id: &str,
    statuses: &[&str],
    order: StepOrder,
    limit: i64,
) -> Result<Vec<SetupStep>, AppError> {
    timed_query!("twin_setup_steps", "twin_setup_steps::list_steps_on", {
        let mut qb = QueryBuilder::new();
        qb.where_eq("twin_id", twin_id.to_string());
        qb.where_in(
            "status",
            statuses
                .iter()
                .map(|s| (*s).to_string())
                .collect::<Vec<_>>(),
        );
        match order {
            StepOrder::Position => qb.order_by_multiple(&[("position", "ASC"), ("rowid", "ASC")]),
            StepOrder::Recent => qb.order_by_multiple(&[
                ("COALESCE(answered_at, asked_at, created_at)", "DESC"),
                ("rowid", "DESC"),
            ]),
        };
        qb.limit(limit);
        let sql = qb.build_select(&format!("SELECT {STEP_COLUMNS} FROM twin_setup_steps"));
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(qb.params_ref().as_slice(), row_to_step)?;
        let mut out = rows.collect::<Result<Vec<_>, _>>()?;
        if order == StepOrder::Recent {
            out.reverse();
        }
        Ok(out)
    })
}

/// The twin's steps whose status is one of `statuses`, at most `limit`, in
/// `order`. The queue is `(&["queued"], StepOrder::Position, n)`; the
/// transcript is `(&["answered", "skipped"], StepOrder::Recent, n)`. An empty
/// `statuses` matches nothing.
pub fn list_steps(
    pool: &DbPool,
    twin_id: &str,
    statuses: &[&str],
    order: StepOrder,
    limit: i64,
) -> Result<Vec<SetupStep>, AppError> {
    timed_query!("twin_setup_steps", "twin_setup_steps::list", {
        let conn = pool.get()?;
        list_steps_on(&conn, twin_id, statuses, order, limit)
    })
}

pub fn live_step_on(conn: &Connection, twin_id: &str) -> Result<Option<SetupStep>, AppError> {
    timed_query!("twin_setup_steps", "twin_setup_steps::live_step_on", {
        Ok(conn
            .query_row(
                &format!(
                    "SELECT {STEP_COLUMNS} FROM twin_setup_steps \
                     WHERE twin_id = ?1 AND status = 'live'"
                ),
                params![twin_id],
                row_to_step,
            )
            .optional()?)
    })
}

/// The one live step (the partial unique index guarantees at most one).
pub fn live_step(pool: &DbPool, twin_id: &str) -> Result<Option<SetupStep>, AppError> {
    timed_query!("twin_setup_steps", "twin_setup_steps::live", {
        let conn = pool.get()?;
        live_step_on(&conn, twin_id)
    })
}

// ============================================================================
// Offers
// ============================================================================

fn list_offers_on(
    conn: &Connection,
    twin_id: &str,
    since_step: Option<&str>,
) -> Result<Vec<SetupOffer>, AppError> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {OFFER_COLUMNS} FROM twin_setup_offers
          WHERE twin_id = ?1
            AND (status = 'open'
                 OR (?2 IS NOT NULL AND resolved_at IS NOT NULL
                     AND resolved_at >= (SELECT asked_at FROM twin_setup_steps WHERE id = ?2)))
          ORDER BY created_at ASC, rowid ASC"
    ))?;
    let rows = stmt.query_map(params![twin_id, since_step], row_to_offer)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// The twin's open offers, plus — when `since_step` names a step — every offer
/// resolved at or after that step's `asked_at` (so a verdict the operator just
/// gave stays visible while they are on the step it came after). A step that
/// was never asked contributes no resolved offers.
pub fn list_offers(
    pool: &DbPool,
    twin_id: &str,
    since_step: Option<&str>,
) -> Result<Vec<SetupOffer>, AppError> {
    timed_query!("twin_setup_offers", "twin_setup_offers::list", {
        let conn = pool.get()?;
        list_offers_on(&conn, twin_id, since_step)
    })
}

fn last_answer_offer_ids_on(conn: &Connection, twin_id: &str) -> Result<Vec<String>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id FROM twin_setup_offers
          WHERE step_id = (SELECT id FROM twin_setup_steps
                            WHERE twin_id = ?1 AND status = 'answered'
                            ORDER BY COALESCE(answered_at, created_at) DESC, rowid DESC
                            LIMIT 1)
          ORDER BY created_at ASC, rowid ASC",
    )?;
    let rows = stmt.query_map(params![twin_id], |row| row.get::<_, String>("id"))?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

// ============================================================================
// Observations
// ============================================================================

pub fn list_observations_on(
    conn: &Connection,
    twin_id: &str,
) -> Result<Vec<SetupObservation>, AppError> {
    timed_query!(
        "twin_setup_observations",
        "twin_setup_observations::list_observations_on",
        {
            let mut stmt = conn.prepare(&format!(
                "SELECT {OBSERVATION_COLUMNS} FROM twin_setup_observations WHERE twin_id = ?1 \
             ORDER BY evidence DESC, updated_at DESC, rowid ASC"
            ))?;
            let rows = stmt.query_map(params![twin_id], row_to_observation)?;
            Ok(rows.collect::<Result<Vec<_>, _>>()?)
        }
    )
}

/// What the engine has observed about the person, best-supported first.
pub fn list_observations(pool: &DbPool, twin_id: &str) -> Result<Vec<SetupObservation>, AppError> {
    timed_query!(
        "twin_setup_observations",
        "twin_setup_observations::list",
        {
            let conn = pool.get()?;
            list_observations_on(&conn, twin_id)
        }
    )
}

// ============================================================================
// Kind stats (global)
// ============================================================================

/// How each step kind has performed across ALL twins, over the steps that
/// were actually asked (answered or skipped). `offers_accepted` counts both
/// `accepted` and `edited` verdicts — an edit is an acceptance with a fix.
/// `mean_gain` averages `coverage_gain` ignoring NULL, 0 when none recorded.
/// Kinds never asked are absent.
pub fn kind_stats(pool: &DbPool) -> Result<Vec<SetupKindStat>, AppError> {
    timed_query!("twin_setup_steps", "twin_setup_steps::kind_stats", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT s.kind AS kind,
                    COUNT(s.id) AS asked,
                    SUM(CASE WHEN s.status = 'skipped' THEN 1 ELSE 0 END) AS skipped,
                    COALESCE(SUM(o.made), 0) AS offers_made,
                    COALESCE(SUM(o.accepted), 0) AS offers_accepted,
                    COALESCE(AVG(s.coverage_gain), 0.0) AS mean_gain
               FROM twin_setup_steps s
               LEFT JOIN (SELECT step_id,
                                 COUNT(id) AS made,
                                 SUM(CASE WHEN status IN ('accepted','edited') THEN 1 ELSE 0 END)
                                     AS accepted
                            FROM twin_setup_offers
                           GROUP BY step_id) o ON o.step_id = s.id
              WHERE s.status IN ('answered','skipped')
              GROUP BY s.kind
              ORDER BY s.kind ASC",
        )?;
        let rows = stmt.query_map([], row_to_kind_stat)?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    })
}

// ============================================================================
// Engine writers (WP1) — connection-level, so the engine composes them inside
// ONE transaction per operation. Every timestamp is stamped in SQL.
// ============================================================================

/// Take the planner lease: `building`, error cleared, `lease_at = now`.
pub fn take_lease_on(conn: &Connection, twin_id: &str) -> Result<(), AppError> {
    timed_query!("twin_setup_plans", "twin_setup_plans::take_lease_on", {
        conn.execute(
            "UPDATE twin_setup_plans
                SET status = 'building', error = NULL, lease_at = datetime('now'),
                    updated_at = datetime('now')
              WHERE twin_id = ?1",
            params![twin_id],
        )?;
        Ok(())
    })
}

/// Whether the plan's lease is absent or older than `max_age_secs`.
pub fn lease_is_stale_on(
    conn: &Connection,
    twin_id: &str,
    max_age_secs: i64,
) -> Result<bool, AppError> {
    timed_query!("twin_setup_plans", "twin_setup_plans::lease_is_stale_on", {
        let stale: Option<bool> = conn
            .query_row(
                "SELECT (lease_at IS NULL OR lease_at < datetime('now', ?2)) AS stale
                   FROM twin_setup_plans WHERE twin_id = ?1",
                params![twin_id, format!("-{max_age_secs} seconds")],
                |row| row.get("stale"),
            )
            .optional()?;
        Ok(stale.unwrap_or(true))
    })
}

/// A deep pass landed: `ready`, `version + 1`, counters reset, lease and error
/// cleared, `change_note` stored. Returns the new version.
pub fn finish_plan_on(
    conn: &Connection,
    twin_id: &str,
    change_note: Option<&str>,
) -> Result<i64, AppError> {
    timed_query!("twin_setup_plans", "twin_setup_plans::finish_plan_on", {
        conn.execute(
            "UPDATE twin_setup_plans
                SET status = 'ready', version = version + 1, answers_since_deep = 0,
                    last_deep_at = datetime('now'), error = NULL, lease_at = NULL,
                    change_note = ?2, updated_at = datetime('now')
              WHERE twin_id = ?1",
            params![twin_id, change_note],
        )?;
        let version: i64 = conn.query_row(
            "SELECT version FROM twin_setup_plans WHERE twin_id = ?1",
            params![twin_id],
            |row| row.get("version"),
        )?;
        Ok(version)
    })
}

/// A deep pass failed: `failed` with a short reason, lease cleared.
pub fn fail_plan_on(conn: &Connection, twin_id: &str, error: &str) -> Result<(), AppError> {
    timed_query!("twin_setup_plans", "twin_setup_plans::fail_plan_on", {
        conn.execute(
            "UPDATE twin_setup_plans
                SET status = 'failed', error = ?2, lease_at = NULL, updated_at = datetime('now')
              WHERE twin_id = ?1",
            params![twin_id, error],
        )?;
        Ok(())
    })
}

/// A goal to insert. Appended at the twin's next free position.
#[derive(Debug, Clone)]
pub struct NewGoal<'a> {
    pub slot: &'a str,
    pub title: &'a str,
    pub intent: &'a str,
    pub criteria: &'a [String],
}

pub fn insert_goal_on(
    conn: &Connection,
    twin_id: &str,
    goal: &NewGoal,
) -> Result<String, AppError> {
    timed_query!("twin_setup_goals", "twin_setup_goals::insert_goal_on", {
        let id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO twin_setup_goals (id, twin_id, slot, title, intent, criteria_json, position)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6,
                     (SELECT COALESCE(MAX(position), -1) + 1 FROM twin_setup_goals WHERE twin_id = ?2))",
            params![id, twin_id, goal.slot, goal.title, goal.intent, Json(goal.criteria)],
        )?;
        Ok(id)
    })
}

/// Rewrite a goal's content (title, intent, criteria). Coverage, state,
/// pinned and counters are untouched. `false` when no such goal.
pub fn update_goal_text_on(
    conn: &Connection,
    twin_id: &str,
    goal_id: &str,
    title: &str,
    intent: &str,
    criteria: &[String],
) -> Result<bool, AppError> {
    timed_query!(
        "twin_setup_goals",
        "twin_setup_goals::update_goal_text_on",
        {
            Ok(conn.execute(
                "UPDATE twin_setup_goals
                SET title = ?3, intent = ?4, criteria_json = ?5, updated_at = datetime('now')
              WHERE twin_id = ?1 AND id = ?2",
                params![twin_id, goal_id, title, intent, Json(criteria)],
            )? > 0)
        }
    )
}

/// `state` is `open` | `covered` | `dropped` (CHECKed).
pub fn set_goal_state_on(
    conn: &Connection,
    twin_id: &str,
    goal_id: &str,
    state: &str,
) -> Result<bool, AppError> {
    timed_query!("twin_setup_goals", "twin_setup_goals::set_goal_state_on", {
        Ok(conn.execute(
            "UPDATE twin_setup_goals SET state = ?3, updated_at = datetime('now')
              WHERE twin_id = ?1 AND id = ?2",
            params![twin_id, goal_id, state],
        )? > 0)
    })
}

pub fn set_goal_pinned_on(
    conn: &Connection,
    twin_id: &str,
    goal_id: &str,
    pinned: bool,
) -> Result<bool, AppError> {
    timed_query!(
        "twin_setup_goals",
        "twin_setup_goals::set_goal_pinned_on",
        {
            Ok(conn.execute(
                "UPDATE twin_setup_goals SET pinned = ?3, updated_at = datetime('now')
              WHERE twin_id = ?1 AND id = ?2",
                params![twin_id, goal_id, pinned as i64],
            )? > 0)
        }
    )
}

/// The assessor's reading of one goal: coverage, state, stall counter.
pub fn set_goal_progress_on(
    conn: &Connection,
    twin_id: &str,
    goal_id: &str,
    coverage: f64,
    state: &str,
    stall: i64,
) -> Result<bool, AppError> {
    timed_query!(
        "twin_setup_goals",
        "twin_setup_goals::set_goal_progress_on",
        {
            Ok(conn.execute(
                "UPDATE twin_setup_goals
                SET coverage = ?3, state = ?4, stall = ?5, updated_at = datetime('now')
              WHERE twin_id = ?1 AND id = ?2",
                params![twin_id, goal_id, coverage, state, stall],
            )? > 0)
        }
    )
}

/// One more step answered against the goal.
pub fn bump_goal_answered_on(
    conn: &Connection,
    twin_id: &str,
    goal_id: &str,
) -> Result<(), AppError> {
    timed_query!(
        "twin_setup_goals",
        "twin_setup_goals::bump_goal_answered_on",
        {
            conn.execute(
                "UPDATE twin_setup_goals SET answered = answered + 1, updated_at = datetime('now')
              WHERE twin_id = ?1 AND id = ?2",
                params![twin_id, goal_id],
            )?;
            Ok(())
        }
    )
}

/// Each goal's `stall` counter (not on the wire type), keyed by goal id.
pub fn goal_stalls_on(
    conn: &Connection,
    twin_id: &str,
) -> Result<std::collections::HashMap<String, i64>, AppError> {
    timed_query!("twin_setup_goals", "twin_setup_goals::goal_stalls_on", {
        let mut stmt = conn.prepare("SELECT id, stall FROM twin_setup_goals WHERE twin_id = ?1")?;
        let rows = stmt.query_map(params![twin_id], |row| {
            Ok((row.get::<_, String>("id")?, row.get::<_, i64>("stall")?))
        })?;
        Ok(rows.collect::<Result<_, _>>()?)
    })
}

/// Where [`insert_step_on`] puts a step in the twin's order.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Placement {
    /// After every existing row (`MAX(position) + 1`).
    Tail,
    /// Before every existing row (`MIN(position) - 1`) — the next one asked.
    Head,
}

/// A step to insert.
#[derive(Debug, Clone)]
pub struct NewStep<'a> {
    pub goal_id: Option<&'a str>,
    /// `setup` | `training`.
    pub stage: &'a str,
    /// `opener` | `plan` | `follow_up` | `handoff`.
    pub origin: &'a str,
    pub kind: &'a str,
    pub question: &'a str,
    /// `pick` | `write`.
    pub answer_mode: &'a str,
    pub incoming: Option<&'a str>,
    pub tone_channel: Option<&'a str>,
    pub suggestions: &'a [SetupSuggestion],
    pub plan_version: i64,
}

/// Insert a step as `queued` or `live` (a live step is stamped `asked_at`).
/// The position is allocated inside the INSERT over ALL the twin's rows, so
/// it can never collide with an answered or obsolete step.
pub fn insert_step_on(
    conn: &Connection,
    twin_id: &str,
    step: &NewStep,
    status: &str,
    placement: Placement,
) -> Result<String, AppError> {
    timed_query!("twin_setup_steps", "twin_setup_steps::insert_step_on", {
        let id = uuid::Uuid::new_v4().to_string();
        let position = match placement {
            Placement::Tail => {
                "(SELECT COALESCE(MAX(position), -1) + 1 FROM twin_setup_steps WHERE twin_id = ?2)"
            }
            Placement::Head => {
                "(SELECT COALESCE(MIN(position), 1) - 1 FROM twin_setup_steps WHERE twin_id = ?2)"
            }
        };
        conn.execute(
            &format!(
                "INSERT INTO twin_setup_steps
                    (id, twin_id, goal_id, stage, origin, kind, question, answer_mode, incoming,
                     tone_channel, suggestions_json, status, position, plan_version, asked_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, {position}, ?13,
                         CASE WHEN ?12 = 'live' THEN datetime('now') END)"
            ),
            params![
                id,
                twin_id,
                step.goal_id,
                step.stage,
                step.origin,
                step.kind,
                step.question,
                step.answer_mode,
                step.incoming,
                step.tone_channel,
                Json(step.suggestions),
                status,
                step.plan_version,
            ],
        )?;
        Ok(id)
    })
}

/// One step of the twin, any status.
pub fn step_on(
    conn: &Connection,
    twin_id: &str,
    step_id: &str,
) -> Result<Option<SetupStep>, AppError> {
    timed_query!("twin_setup_steps", "twin_setup_steps::step_on", {
        Ok(conn
            .query_row(
                &format!(
                    "SELECT {STEP_COLUMNS} FROM twin_setup_steps WHERE twin_id = ?1 AND id = ?2"
                ),
                params![twin_id, step_id],
                row_to_step,
            )
            .optional()?)
    })
}

/// `queued` → `live`, stamping `asked_at`. `false` when the step was not queued.
pub fn make_live_on(conn: &Connection, twin_id: &str, step_id: &str) -> Result<bool, AppError> {
    timed_query!("twin_setup_steps", "twin_setup_steps::make_live_on", {
        Ok(conn.execute(
            "UPDATE twin_setup_steps SET status = 'live', asked_at = datetime('now')
              WHERE twin_id = ?1 AND id = ?2 AND status = 'queued'",
            params![twin_id, step_id],
        )? > 0)
    })
}

/// `live` → `queued` at the HEAD of the queue (`MIN(position) - 1`), its
/// `asked_at` cleared. `false` when the step was not live.
pub fn requeue_at_head_on(
    conn: &Connection,
    twin_id: &str,
    step_id: &str,
) -> Result<bool, AppError> {
    timed_query!(
        "twin_setup_steps",
        "twin_setup_steps::requeue_at_head_on",
        {
            Ok(conn.execute(
                "UPDATE twin_setup_steps
                SET status = 'queued', asked_at = NULL,
                    position = (SELECT MIN(position) - 1 FROM twin_setup_steps WHERE twin_id = ?1)
              WHERE twin_id = ?1 AND id = ?2 AND status = 'live'",
                params![twin_id, step_id],
            )? > 0)
        }
    )
}

/// Close the live step: `answered` with the text, or `skipped` (`answer ==
/// None`, and the answer column stays NULL — a skip is never a value).
/// `false` when the step was not live.
pub fn finish_step_on(
    conn: &Connection,
    twin_id: &str,
    step_id: &str,
    answer: Option<&str>,
) -> Result<bool, AppError> {
    timed_query!("twin_setup_steps", "twin_setup_steps::finish_step_on", {
        Ok(conn.execute(
            "UPDATE twin_setup_steps
                SET status = CASE WHEN ?3 IS NULL THEN 'skipped' ELSE 'answered' END,
                    answer = ?3, answered_at = datetime('now')
              WHERE twin_id = ?1 AND id = ?2 AND status = 'live'",
            params![twin_id, step_id, answer],
        )? > 0)
    })
}

/// Retire one queued or live step (a redeal throws the live one away).
pub fn obsolete_step_on(conn: &Connection, twin_id: &str, step_id: &str) -> Result<bool, AppError> {
    timed_query!("twin_setup_steps", "twin_setup_steps::obsolete_step_on", {
        Ok(conn.execute(
            "UPDATE twin_setup_steps SET status = 'obsolete'
              WHERE twin_id = ?1 AND id = ?2 AND status IN ('queued','live')",
            params![twin_id, step_id],
        )? > 0)
    })
}

/// Retire QUEUED steps — all of them, or only one goal's — never the live
/// step. Handed-over questions (`origin = 'handoff'`) are kept unless
/// `include_handoffs`: they were asked for verbatim, a re-plan does not own them.
pub fn obsolete_queued_on(
    conn: &Connection,
    twin_id: &str,
    goal_id: Option<&str>,
    include_handoffs: bool,
) -> Result<usize, AppError> {
    timed_query!(
        "twin_setup_steps",
        "twin_setup_steps::obsolete_queued_on",
        {
            Ok(conn.execute(
                "UPDATE twin_setup_steps SET status = 'obsolete'
              WHERE twin_id = ?1 AND status = 'queued'
                AND (?2 IS NULL OR goal_id = ?2)
                AND (?3 = 1 OR origin != 'handoff')",
                params![twin_id, goal_id, include_handoffs as i64],
            )?)
        }
    )
}

/// Queued steps in `stage`.
pub fn count_queued_on(conn: &Connection, twin_id: &str, stage: &str) -> Result<i64, AppError> {
    timed_query!("twin_setup_steps", "twin_setup_steps::count_queued_on", {
        Ok(conn.query_row(
            "SELECT COUNT(id) AS n FROM twin_setup_steps
              WHERE twin_id = ?1 AND status = 'queued' AND stage = ?2",
            params![twin_id, stage],
            |row| row.get("n"),
        )?)
    })
}

/// Whether any step (queued, live, answered or skipped) already asks `question`.
pub fn question_seen_on(
    conn: &Connection,
    twin_id: &str,
    question: &str,
) -> Result<bool, AppError> {
    timed_query!("twin_setup_steps", "twin_setup_steps::question_seen_on", {
        Ok(conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM twin_setup_steps
                            WHERE twin_id = ?1 AND status != 'obsolete'
                              AND lower(trim(question)) = lower(trim(?2))) AS found",
            params![twin_id, question],
            |row| row.get("found"),
        )?)
    })
}

/// Answered or skipped steps not yet reconciled, oldest first, each with its
/// `reconcile_attempts`.
pub fn unreconciled_on(
    conn: &Connection,
    twin_id: &str,
) -> Result<Vec<(SetupStep, i64)>, AppError> {
    timed_query!("twin_setup_steps", "twin_setup_steps::unreconciled_on", {
        let mut stmt = conn.prepare(&format!(
            "SELECT {STEP_COLUMNS}, reconcile_attempts FROM twin_setup_steps
              WHERE twin_id = ?1 AND status IN ('answered','skipped') AND reconciled = 0
              ORDER BY COALESCE(answered_at, created_at) ASC, rowid ASC"
        ))?;
        let rows = stmt.query_map(params![twin_id], |row| {
            Ok((row_to_step(row)?, row.get::<_, i64>("reconcile_attempts")?))
        })?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    })
}

/// Fold done: `reconciled = 1`, with the step's goal-coverage delta (NULL when
/// none was measured, e.g. a skip or a failed assessment). `false` when no
/// such step exists.
pub fn mark_reconciled_on(
    conn: &Connection,
    step_id: &str,
    coverage_gain: Option<f64>,
) -> Result<bool, AppError> {
    timed_query!(
        "twin_setup_steps",
        "twin_setup_steps::mark_reconciled_on",
        {
            let rows = conn.execute(
                "UPDATE twin_setup_steps SET reconciled = 1, coverage_gain = ?2 WHERE id = ?1",
                params![step_id, coverage_gain],
            )?;
            Ok(rows > 0)
        }
    )
}

/// One more failed reconcile attempt; returns the new count.
pub fn bump_reconcile_attempts_on(conn: &Connection, step_id: &str) -> Result<i64, AppError> {
    timed_query!(
        "twin_setup_steps",
        "twin_setup_steps::bump_reconcile_attempts_on",
        {
            conn.execute(
            "UPDATE twin_setup_steps SET reconcile_attempts = reconcile_attempts + 1 WHERE id = ?1",
            params![step_id],
        )?;
            Ok(conn.query_row(
                "SELECT reconcile_attempts FROM twin_setup_steps WHERE id = ?1",
                params![step_id],
                |row| row.get("reconcile_attempts"),
            )?)
        }
    )
}

/// Whether any answered or skipped step still waits to be reconciled.
pub fn has_unreconciled_on(conn: &Connection, twin_id: &str) -> Result<bool, AppError> {
    timed_query!(
        "twin_setup_steps",
        "twin_setup_steps::has_unreconciled_on",
        {
            Ok(conn.query_row(
                "SELECT EXISTS(SELECT 1 FROM twin_setup_steps
                            WHERE twin_id = ?1 AND status IN ('answered','skipped')
                              AND reconciled = 0) AS found",
                params![twin_id],
                |row| row.get("found"),
            )?)
        }
    )
}

/// An offer to insert (`status = 'open'`).
#[derive(Debug, Clone)]
pub struct NewOffer<'a> {
    pub step_id: &'a str,
    /// `reconcile` | `sample`.
    pub origin: &'a str,
    /// `bio` | `role` | `tone`.
    pub kind: &'a str,
    pub part: Option<&'a str>,
    pub channel: Option<&'a str>,
    pub value: &'a str,
    pub length_hint: Option<&'a str>,
    pub reason: &'a str,
}

pub fn insert_offer_on(
    conn: &Connection,
    twin_id: &str,
    offer: &NewOffer,
) -> Result<String, AppError> {
    timed_query!("twin_setup_offers", "twin_setup_offers::insert_offer_on", {
        let id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO twin_setup_offers
                (id, twin_id, step_id, origin, kind, part, channel, value, length_hint, reason)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                id,
                twin_id,
                offer.step_id,
                offer.origin,
                offer.kind,
                offer.part,
                offer.channel,
                offer.value,
                offer.length_hint,
                offer.reason,
            ],
        )?;
        Ok(id)
    })
}

/// Flip an OPEN offer to `verdict` once, stamping `resolved_at`. `false` when
/// it was not open (already resolved, or no such offer).
pub fn resolve_offer_on(
    conn: &Connection,
    twin_id: &str,
    offer_id: &str,
    verdict: &str,
) -> Result<bool, AppError> {
    timed_query!(
        "twin_setup_offers",
        "twin_setup_offers::resolve_offer_on",
        {
            Ok(conn.execute(
                "UPDATE twin_setup_offers SET status = ?3, resolved_at = datetime('now')
              WHERE twin_id = ?1 AND id = ?2 AND status = 'open'",
                params![twin_id, offer_id, verdict],
            )? > 0)
        }
    )
}

/// Replace the twin's observations with `texts` (evidence 1 each).
pub fn replace_observations_on(
    conn: &Connection,
    twin_id: &str,
    texts: &[String],
) -> Result<(), AppError> {
    timed_query!(
        "twin_setup_observations",
        "twin_setup_observations::replace_observations_on",
        {
            conn.execute(
                "DELETE FROM twin_setup_observations WHERE twin_id = ?1",
                params![twin_id],
            )?;
            for text in texts {
                conn.execute(
                    "INSERT INTO twin_setup_observations (id, twin_id, text) VALUES (?1, ?2, ?3)",
                    params![uuid::Uuid::new_v4().to_string(), twin_id, text],
                )?;
            }
            Ok(())
        }
    )
}

/// Record one observation: bump `evidence` on an existing one with the same
/// text (case-insensitive), else append it while the twin has fewer than
/// `cap`. Returns whether anything changed.
pub fn note_observation_on(
    conn: &Connection,
    twin_id: &str,
    text: &str,
    cap: i64,
) -> Result<bool, AppError> {
    timed_query!(
        "twin_setup_observations",
        "twin_setup_observations::note_observation_on",
        {
            let bumped = conn.execute(
                "UPDATE twin_setup_observations
                SET evidence = evidence + 1, updated_at = datetime('now')
              WHERE twin_id = ?1 AND lower(trim(text)) = lower(trim(?2))",
                params![twin_id, text],
            )?;
            if bumped > 0 {
                return Ok(true);
            }
            let count: i64 = conn.query_row(
                "SELECT COUNT(id) AS n FROM twin_setup_observations WHERE twin_id = ?1",
                params![twin_id],
                |row| row.get("n"),
            )?;
            if count >= cap {
                return Ok(false);
            }
            conn.execute(
                "INSERT INTO twin_setup_observations (id, twin_id, text) VALUES (?1, ?2, ?3)",
                params![uuid::Uuid::new_v4().to_string(), twin_id, text.trim()],
            )?;
            Ok(true)
        }
    )
}

// ============================================================================
// Snapshot
// ============================================================================

/// The snapshot of a twin that has no plan yet.
fn empty_snapshot(twin_id: &str) -> SetupSessionSnapshot {
    SetupSessionSnapshot {
        twin_id: twin_id.to_string(),
        stage: "setup".to_string(),
        topic_preset: None,
        focus_slot: None,
        plan_status: "building".to_string(),
        plan_version: 0,
        plan_error: None,
        change_note: None,
        goals: Vec::new(),
        live: None,
        upcoming: Vec::new(),
        transcript: Vec::new(),
        offers: Vec::new(),
        last_answer_offer_ids: Vec::new(),
        observations: Vec::new(),
        planning: false,
        reconciling: false,
    }
}

pub fn snapshot_on(conn: &Connection, twin_id: &str) -> Result<SetupSessionSnapshot, AppError> {
    timed_query!("twin_setup_plans", "twin_setup_plans::snapshot_on", {
        let Some(plan) = get_plan_on(conn, twin_id)? else {
            return Ok(empty_snapshot(twin_id));
        };
        let live = live_step_on(conn, twin_id)?;
        let offers = list_offers_on(conn, twin_id, live.as_ref().map(|s| s.id.as_str()))?;
        let reconciling: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM twin_setup_steps
                            WHERE twin_id = ?1 AND status = 'answered' AND reconciled = 0) AS found",
            params![twin_id],
            |row| row.get("found"),
        )?;
        Ok(SetupSessionSnapshot {
            twin_id: twin_id.to_string(),
            planning: plan.status == "building",
            stage: plan.stage,
            topic_preset: plan.topic_preset,
            focus_slot: plan.focus_slot,
            plan_status: plan.status,
            plan_version: plan.version,
            plan_error: plan.error,
            change_note: plan.change_note,
            goals: list_goals_on(conn, twin_id)?,
            upcoming: list_steps_on(
                conn,
                twin_id,
                &["queued"],
                StepOrder::Position,
                SNAPSHOT_UPCOMING,
            )?,
            transcript: list_steps_on(
                conn,
                twin_id,
                &["answered", "skipped"],
                StepOrder::Recent,
                SNAPSHOT_TRANSCRIPT,
            )?,
            live,
            offers,
            last_answer_offer_ids: last_answer_offer_ids_on(conn, twin_id)?,
            observations: list_observations_on(conn, twin_id)?,
            reconciling,
        })
    })
}

/// The whole setup session for `twin_id`, read on one connection inside one
/// transaction. A twin with no plan row reads as an empty `building` plan
/// (version 0, stage `setup`, `planning == false`).
pub fn snapshot(pool: &DbPool, twin_id: &str) -> Result<SetupSessionSnapshot, AppError> {
    timed_query!("twin_setup_plans", "twin_setup_plans::snapshot", {
        let mut conn = pool.get()?;
        let tx = conn.transaction()?;
        let snap = snapshot_on(&tx, twin_id)?;
        tx.commit()?;
        Ok(snap)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seed(pool: &DbPool) -> Result<(), AppError> {
        let conn = pool.get()?;
        conn.execute_batch(
            "INSERT INTO twin_profiles (id, name, slug, obsidian_subpath)
                VALUES ('t1', 't1', 't1', 't1'), ('t2', 't2', 't2', 't2');
             INSERT INTO twin_setup_goals (id, twin_id, slot, title, criteria_json, position)
                VALUES ('g2', 't1', 'tone', 'Tone', '[\"warm\"]', 1),
                       ('g1', 't1', 'identity', 'Who', '[\"role\",\"bio\"]', 0);
             INSERT INTO twin_setup_steps
                (id, twin_id, goal_id, stage, origin, kind, question, status, answer, position,
                 coverage_gain, reconciled, suggestions_json, asked_at, answered_at)
             VALUES
                ('a1', 't1', 'g1', 'setup', 'opener', 'fact', 'q1', 'answered', 'x', 0,
                 0.4, 1, '[]', '2026-09-24 10:00:00', '2026-09-24 10:01:00'),
                ('a2', 't1', 'g1', 'setup', 'plan', 'fact', 'q2', 'skipped', NULL, 1,
                 NULL, 0, '[]', '2026-09-24 10:02:00', '2026-09-24 10:03:00'),
                ('a3', 't1', 'g2', 'setup', 'plan', 'opinion', 'q3', 'answered', 'y', 2,
                 0.2, 0, '[{\"text\":\"Hi\",\"reason\":\"short\"}]',
                 '2026-09-24 10:04:00', '2026-09-24 10:05:00'),
                ('l1', 't1', 'g2', 'setup', 'plan', 'scene', 'q4', 'live', NULL, 3,
                 NULL, 0, '[]', '2026-09-24 10:06:00', NULL),
                ('q7', 't1', 'g2', 'setup', 'plan', 'rule', 'q7', 'queued', NULL, 7,
                 NULL, 0, '[]', NULL, NULL),
                ('q5', 't1', 'g2', 'setup', 'plan', 'rule', 'q5', 'queued', NULL, 5,
                 NULL, 0, '[]', NULL, NULL),
                ('b1', 't2', NULL, 'training', 'plan', 'fact', 'z', 'answered', 'z', 0,
                 0.6, 1, '[]', '2026-09-24 09:00:00', '2026-09-24 09:01:00');
             INSERT INTO twin_setup_offers
                (id, twin_id, step_id, origin, kind, value, status, created_at, resolved_at)
             VALUES
                ('o1', 't1', 'a1', 'reconcile', 'bio', 'b', 'accepted',
                 '2026-09-24 10:01:30', '2026-09-24 10:02:00'),
                ('o2', 't1', 'a3', 'reconcile', 'role', 'r', 'open', '2026-09-24 10:05:30', NULL),
                ('o3', 't1', 'a3', 'sample', 'tone', 't', 'edited',
                 '2026-09-24 10:05:31', '2026-09-24 10:07:00'),
                ('o4', 't2', 'b1', 'reconcile', 'bio', 'b', 'dismissed',
                 '2026-09-24 09:02:00', '2026-09-24 09:03:00');
             INSERT INTO twin_setup_observations (id, twin_id, text, evidence)
                VALUES ('ob1', 't1', 'short replies', 1), ('ob2', 't1', 'dry humour', 3);",
        )?;
        Ok(())
    }

    #[test]
    fn twin_setup_snapshot_without_a_plan_is_empty_building() -> Result<(), AppError> {
        let pool = crate::init_test_db()?;
        seed(&pool)?;
        let snap = snapshot(&pool, "t1")?;
        assert_eq!(snap.plan_status, "building");
        assert_eq!(snap.plan_version, 0);
        assert_eq!(snap.stage, "setup");
        assert!(!snap.planning && !snap.reconciling);
        assert!(snap.goals.is_empty() && snap.transcript.is_empty() && snap.live.is_none());
        Ok(())
    }

    #[test]
    fn twin_setup_snapshot_assembles_every_part() -> Result<(), AppError> {
        let pool = crate::init_test_db()?;
        seed(&pool)?;
        let mut plan = PlanRow::fresh("t1");
        plan.status = "ready".into();
        plan.version = 3;
        plan.change_note = Some("added tone".into());
        plan.readiness = Some(SetupReadiness {
            identity: "partial".into(),
            tone: "empty".into(),
            channels: "empty".into(),
            memories: "set".into(),
        });
        upsert_plan(&pool, &plan)?;

        let snap = snapshot(&pool, "t1")?;
        assert_eq!(snap.plan_status, "ready");
        assert_eq!(snap.plan_version, 3);
        assert!(!snap.planning);
        assert_eq!(snap.change_note.as_deref(), Some("added tone"));

        let goals: Vec<&str> = snap.goals.iter().map(|g| g.id.as_str()).collect();
        assert_eq!(goals, ["g1", "g2"], "goals by position");
        assert_eq!(snap.goals[0].criteria, ["role", "bio"]);

        assert_eq!(snap.live.as_ref().map(|s| s.id.as_str()), Some("l1"));
        let upcoming: Vec<&str> = snap.upcoming.iter().map(|s| s.id.as_str()).collect();
        assert_eq!(upcoming, ["q5", "q7"], "queued by position");
        let transcript: Vec<&str> = snap.transcript.iter().map(|s| s.id.as_str()).collect();
        assert_eq!(transcript, ["a1", "a2", "a3"], "history oldest first");
        assert_eq!(snap.transcript[2].suggestions[0].text, "Hi");

        // o1 was resolved before the live step was asked; o3 after it.
        let offers: Vec<&str> = snap.offers.iter().map(|o| o.id.as_str()).collect();
        assert_eq!(offers, ["o2", "o3"]);
        assert_eq!(snap.last_answer_offer_ids, ["o2", "o3"]);

        let obs: Vec<&str> = snap.observations.iter().map(|o| o.id.as_str()).collect();
        assert_eq!(obs, ["ob2", "ob1"], "best-supported first");
        assert!(snap.reconciling, "a3 is answered and unreconciled");

        let stored = get_plan(&pool, "t1")?.ok_or_else(|| AppError::NotFound("plan".into()))?;
        assert_eq!(stored.readiness.map(|r| r.memories), Some("set".into()));
        assert!(!stored.created_at.is_empty());

        plan.status = "building".into();
        upsert_plan(&pool, &plan)?;
        assert!(snapshot(&pool, "t1")?.planning);
        Ok(())
    }

    #[test]
    fn twin_setup_list_steps_honours_limit_and_order() -> Result<(), AppError> {
        let pool = crate::init_test_db()?;
        seed(&pool)?;
        let first = list_steps(&pool, "t1", &["queued"], StepOrder::Position, 1)?;
        assert_eq!(first.len(), 1);
        assert_eq!(first[0].id, "q5");
        let last_two = list_steps(&pool, "t1", &["answered", "skipped"], StepOrder::Recent, 2)?;
        let ids: Vec<&str> = last_two.iter().map(|s| s.id.as_str()).collect();
        assert_eq!(ids, ["a2", "a3"]);
        assert!(list_steps(&pool, "t1", &[], StepOrder::Position, 10)?.is_empty());
        Ok(())
    }

    #[test]
    fn twin_setup_kind_stats_aggregate_across_twins() -> Result<(), AppError> {
        let pool = crate::init_test_db()?;
        seed(&pool)?;
        let stats = kind_stats(&pool)?;
        let kinds: Vec<&str> = stats.iter().map(|s| s.kind.as_str()).collect();
        assert_eq!(
            kinds,
            ["fact", "opinion"],
            "live/queued kinds are not asked yet"
        );

        let fact = &stats[0];
        assert_eq!(fact.asked, 3, "a1 + a2 (t1) + b1 (t2)");
        assert_eq!(fact.skipped, 1);
        assert_eq!(fact.offers_made, 2, "o1 + o4");
        assert_eq!(fact.offers_accepted, 1, "o1 accepted, o4 dismissed");
        assert!(
            (fact.mean_gain - 0.5).abs() < 1e-9,
            "mean of 0.4 and 0.6, NULL ignored"
        );

        let opinion = &stats[1];
        assert_eq!(opinion.asked, 1);
        assert_eq!(opinion.offers_made, 2);
        assert_eq!(opinion.offers_accepted, 1, "edited counts as accepted");
        Ok(())
    }
}
