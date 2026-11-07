//! Standup plan repo and revisioning: `companion_standup` rows, re-open as
//! revision n+1 with items copied, item patches, away-rule edits. WP1 owns.
//!
//! One row per REVISION. The live standup is the newest `draft` or `armed`
//! row ([`current`]). Re-opening an armed plan writes revision n+1 as a draft
//! (`parent_id` = the armed row, items copied with their state); the parent
//! stays armed until the child is armed, then it is `superseded` and its
//! running sessions continue (`arm`).
//!
//! Every write that reads first runs in an IMMEDIATE transaction, so two
//! writers (the page, the proposal job, the terminal door) never lose each
//! other's edit to a stale read.

use std::collections::HashSet;

use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::de::DeserializeOwned;
use serde::Serialize;

use crate::db::UserDbPool;
use crate::error::AppError;

use super::model::{
    AwayRuleClass, AwayRules, Standup, StandupEvent, StandupEventKind, StandupItem,
    StandupItemKind, StandupItemPatch, StandupItemState, StandupPlan, StandupReport, StandupStatus,
    StandupSummary, StandupWindow,
};

const COLUMNS: &str = "id, revision, parent_id, status, device_id, opened_at, armed_at, \
     ended_at, plan_json, away_rules_json, report_json";

const EVENT_COLUMNS: &str = "id, standup_id, at, kind, project_id, summary, detail_json";

/// The `detail.reason` of the `stop` event `arm` writes for an item a live
/// headless App Master holds. Read back here so a re-open retries the item.
pub const REFUSAL_HEADLESS_MASTER: &str = "headless_master";

/// Hard ceiling on a list read (`history`, `events`).
const MAX_LIST: i32 = 500;

struct StandupRow {
    id: String,
    revision: i32,
    parent_id: Option<String>,
    status: String,
    device_id: String,
    opened_at: i64,
    armed_at: Option<i64>,
    ended_at: Option<i64>,
    plan_json: String,
    away_rules_json: String,
    report_json: Option<String>,
}

personas_db::row_mapper!(row_to_standup -> StandupRow {
    id, revision, parent_id, status, device_id, opened_at, armed_at, ended_at, plan_json,
    away_rules_json, report_json,
});

struct EventRow {
    id: String,
    standup_id: String,
    at: i64,
    kind: String,
    project_id: Option<String>,
    summary: String,
    detail_json: Option<String>,
}

personas_db::row_mapper!(row_to_event -> EventRow {
    id, standup_id, at, kind, project_id, summary, detail_json,
});

/// A registered project a fresh standup seeds one `direction` card for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectSeed {
    pub id: String,
    pub name: String,
    /// The registered root path (the import resolves a terminal slug by its
    /// folder name too).
    pub root: String,
}

// ---------------------------------------------------------------------------
// Tokens and JSON columns
// ---------------------------------------------------------------------------

/// The snake_case wire token of a model enum (the same string serde writes and
/// the SQL CHECK sets list).
pub(crate) fn token<T: Serialize>(value: &T) -> Result<String, AppError> {
    match serde_json::to_value(value) {
        Ok(serde_json::Value::String(s)) => Ok(s),
        Ok(other) => Err(AppError::Internal(format!(
            "standup: enum serialised as {other} rather than a token"
        ))),
        Err(e) => Err(AppError::Internal(format!("standup: token serialise: {e}"))),
    }
}

fn parse_token<T: DeserializeOwned>(raw: &str, what: &str) -> Result<T, AppError> {
    serde_json::from_value(serde_json::Value::String(raw.to_string()))
        .map_err(|e| AppError::Internal(format!("standup: unreadable {what} `{raw}`: {e}")))
}

fn to_json<T: Serialize>(value: &T, what: &str) -> Result<String, AppError> {
    serde_json::to_string(value)
        .map_err(|e| AppError::Internal(format!("standup: {what} serialise: {e}")))
}

fn from_json<T: DeserializeOwned>(raw: &str, id: &str, what: &str) -> Result<T, AppError> {
    serde_json::from_str(raw)
        .map_err(|e| AppError::Internal(format!("standup {id}: {what} unreadable: {e}")))
}

fn into_standup(row: StandupRow) -> Result<Standup, AppError> {
    let report = match row.report_json.as_deref() {
        Some(raw) => Some(from_json::<StandupReport>(raw, &row.id, "report_json")?),
        None => None,
    };
    Ok(Standup {
        status: parse_token(&row.status, "status")?,
        plan: from_json(&row.plan_json, &row.id, "plan_json")?,
        away_rules: from_json(&row.away_rules_json, &row.id, "away_rules_json")?,
        report,
        id: row.id,
        revision: row.revision,
        parent_id: row.parent_id,
        device_id: row.device_id,
        opened_at: row.opened_at,
        armed_at: row.armed_at,
        ended_at: row.ended_at,
    })
}

fn into_event(row: EventRow) -> Result<StandupEvent, AppError> {
    let detail = match row.detail_json.as_deref() {
        Some(raw) => Some(from_json::<serde_json::Value>(
            raw,
            &row.standup_id,
            "detail_json",
        )?),
        None => None,
    };
    Ok(StandupEvent {
        kind: parse_token(&row.kind, "event kind")?,
        id: row.id,
        standup_id: row.standup_id,
        at: row.at,
        project_id: row.project_id,
        summary: row.summary,
        detail,
    })
}

// ---------------------------------------------------------------------------
// Fresh shapes
// ---------------------------------------------------------------------------

pub fn new_standup_id() -> String {
    format!("stu_{}", uuid::Uuid::new_v4().simple())
}

pub fn new_item_id() -> String {
    format!("sti_{}", uuid::Uuid::new_v4().simple())
}

/// The away rules a fresh standup starts with (design decision W1/D): Athena
/// may decide reversible things herself; money, data, schema, secrets and
/// every push wait for the operator. No push target until one is named.
pub fn default_away_rules() -> AwayRules {
    AwayRules {
        delegate: vec![
            AwayRuleClass::Scope,
            AwayRuleClass::Goals,
            AwayRuleClass::DependencyBump,
            AwayRuleClass::Retune,
            AwayRuleClass::CreateAgent,
        ],
        park: vec![
            AwayRuleClass::Money,
            AwayRuleClass::Data,
            AwayRuleClass::Schema,
            AwayRuleClass::Secrets,
            AwayRuleClass::Push,
        ],
        push_targets: Vec::new(),
    }
}

/// One undecided `direction` card for a project.
pub fn seed_item(project_id: &str, device_id: &str, priority: i32) -> StandupItem {
    StandupItem {
        id: new_item_id(),
        kind: StandupItemKind::Direction,
        project_id: Some(project_id.to_string()),
        device_id: device_id.to_string(),
        state: StandupItemState::Proposed,
        proposals: Vec::new(),
        chosen: None,
        persona_id: None,
        create_spec: None,
        retune_spec: None,
        window: StandupWindow::Day,
        not_before_ms: None,
        priority,
        evidence: String::new(),
    }
}

// ---------------------------------------------------------------------------
// Connection-level reads and writes
// ---------------------------------------------------------------------------

fn get_in(conn: &Connection, id: &str) -> Result<Option<Standup>, AppError> {
    let row = conn
        .query_row(
            &format!("SELECT {COLUMNS} FROM companion_standup WHERE id = ?1"),
            params![id],
            row_to_standup,
        )
        .optional()?;
    row.map(into_standup).transpose()
}

fn current_in(conn: &Connection) -> Result<Option<Standup>, AppError> {
    let row = conn
        .query_row(
            &format!(
                "SELECT {COLUMNS} FROM companion_standup
                 WHERE status IN ('draft', 'armed')
                 ORDER BY revision DESC, opened_at DESC, id DESC LIMIT 1"
            ),
            [],
            row_to_standup,
        )
        .optional()?;
    row.map(into_standup).transpose()
}

pub(crate) fn insert_in(conn: &Connection, s: &Standup) -> Result<(), AppError> {
    let report = match &s.report {
        Some(r) => Some(to_json(r, "report")?),
        None => None,
    };
    conn.execute(
        &format!(
            "INSERT INTO companion_standup ({COLUMNS})
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)"
        ),
        params![
            s.id,
            s.revision,
            s.parent_id,
            token(&s.status)?,
            s.device_id,
            s.opened_at,
            s.armed_at,
            s.ended_at,
            to_json(&s.plan, "plan")?,
            to_json(&s.away_rules, "away rules")?,
            report,
        ],
    )?;
    Ok(())
}

fn write_plan_in(conn: &Connection, s: &Standup) -> Result<(), AppError> {
    conn.execute(
        "UPDATE companion_standup SET plan_json = ?2, away_rules_json = ?3 WHERE id = ?1",
        params![
            s.id,
            to_json(&s.plan, "plan")?,
            to_json(&s.away_rules, "away rules")?
        ],
    )?;
    Ok(())
}

/// A new draft revision. `parent` is the armed revision it amends (`None` for
/// revision 1).
pub(crate) fn new_revision(
    parent: Option<&Standup>,
    items: Vec<StandupItem>,
    away_rules: AwayRules,
    device_id: &str,
    now_ms: i64,
) -> Standup {
    Standup {
        id: new_standup_id(),
        revision: parent.map_or(1, |p| p.revision + 1),
        parent_id: parent.map(|p| p.id.clone()),
        status: StandupStatus::Draft,
        device_id: device_id.to_string(),
        opened_at: now_ms,
        armed_at: None,
        ended_at: None,
        plan: StandupPlan { items },
        away_rules,
        report: None,
    }
}

// ---------------------------------------------------------------------------
// Pool-level API
// ---------------------------------------------------------------------------

/// One revision, any status.
pub fn get(pool: &UserDbPool, id: &str) -> Result<Option<Standup>, AppError> {
    let conn = pool.get()?;
    get_in(&conn, id)
}

/// One revision, or `NotFound`.
pub fn require(pool: &UserDbPool, id: &str) -> Result<Standup, AppError> {
    get(pool, id)?.ok_or_else(|| AppError::NotFound(format!("Standup {id}")))
}

/// The live standup: the newest `draft` or `armed` revision.
pub fn current(pool: &UserDbPool) -> Result<Option<Standup>, AppError> {
    let conn = pool.get()?;
    current_in(&conn)
}

/// The newest `opened_at` of any revision (the PLAN.json import watermark).
pub fn latest_opened_at(pool: &UserDbPool) -> Result<Option<i64>, AppError> {
    let conn = pool.get()?;
    Ok(conn.query_row(
        "SELECT MAX(opened_at) AS latest FROM companion_standup",
        [],
        |r| r.get("latest"),
    )?)
}

/// Past and present revisions, newest first, at most `limit` (1..=500).
pub fn history(pool: &UserDbPool, limit: i32) -> Result<Vec<StandupSummary>, AppError> {
    let limit = limit.clamp(1, MAX_LIST);
    let conn = pool.get()?;
    let mut stmt = conn.prepare(&format!(
        "SELECT {COLUMNS} FROM companion_standup
         ORDER BY opened_at DESC, revision DESC, id DESC LIMIT ?1"
    ))?;
    let rows = stmt
        .query_map(params![limit], row_to_standup)?
        .collect::<Result<Vec<_>, _>>()?;
    rows.into_iter()
        .map(|row| {
            let s = into_standup(row)?;
            Ok(StandupSummary {
                item_count: i32::try_from(s.plan.items.len()).unwrap_or(i32::MAX),
                id: s.id,
                revision: s.revision,
                status: s.status,
                opened_at: s.opened_at,
                armed_at: s.armed_at,
            })
        })
        .collect()
}

/// Drop every item whose `project_id` names a project that no longer exists.
/// `existing` is EVERY registered project id (any status, enabled or not): a
/// switched-off project still exists and keeps its card; only a deleted one
/// leaves. An item with no project (a project-less agent change) stays.
/// Returns whether anything was removed.
pub fn prune_dead_projects(items: &mut Vec<StandupItem>, existing: &HashSet<String>) -> bool {
    let before = items.len();
    items.retain(|i| {
        i.project_id
            .as_deref()
            .map_or(true, |pid| existing.contains(pid))
    });
    items.len() != before
}

/// Prune the live DRAFT's dead-project cards ([`prune_dead_projects`]) in one
/// immediate transaction, writing only when something was removed. Returns the
/// pruned draft, or `None` when there is no live draft, the live revision is
/// armed (immutable: the page hides its dead rows itself), or nothing was dead.
pub fn prune_live_draft(
    pool: &UserDbPool,
    existing: &HashSet<String>,
) -> Result<Option<Standup>, AppError> {
    let mut conn = pool.get()?;
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let pruned = match current_in(&tx)? {
        Some(mut s) if s.status == StandupStatus::Draft => {
            if prune_dead_projects(&mut s.plan.items, existing) {
                write_plan_in(&tx, &s)?;
                Some(s)
            } else {
                None
            }
        }
        _ => None,
    };
    tx.commit()?;
    Ok(pruned)
}

/// Open a standup. No live revision: a fresh draft revision 1 with one
/// `direction` card per project and the default away rules. A live DRAFT: that
/// draft, unchanged. A live ARMED revision: revision n+1 as a draft, its items
/// copied with their state (ids kept, so the arm can tell a carried item from
/// a changed one), minus the cards of projects that no longer exist (when
/// `existing` names every registered project id; `None` carries every card),
/// plus a card for any project registered since.
///
/// Returns the standup and whether this call created it.
pub fn open(
    pool: &UserDbPool,
    device_id: &str,
    now_ms: i64,
    projects: &[ProjectSeed],
    existing: Option<&HashSet<String>>,
) -> Result<(Standup, bool), AppError> {
    let mut conn = pool.get()?;
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let current = current_in(&tx)?;
    let created = match current {
        Some(s) if s.status == StandupStatus::Draft => {
            tx.commit()?;
            return Ok((s, false));
        }
        Some(armed) => {
            let mut items = armed.plan.items.clone();
            if let Some(existing) = existing {
                prune_dead_projects(&mut items, existing);
            }
            let next_priority = items.iter().map(|i| i.priority).max().unwrap_or(-1) + 1;
            let mut extra = 0;
            for p in projects {
                let present = items.iter().any(|i| {
                    i.kind == StandupItemKind::Direction
                        && i.project_id.as_deref() == Some(p.id.as_str())
                });
                if !present {
                    items.push(seed_item(&p.id, device_id, next_priority + extra));
                    extra += 1;
                }
            }
            new_revision(
                Some(&armed),
                items,
                armed.away_rules.clone(),
                device_id,
                now_ms,
            )
        }
        None => {
            let items = projects
                .iter()
                .enumerate()
                .map(|(i, p)| seed_item(&p.id, device_id, i32::try_from(i).unwrap_or(i32::MAX)))
                .collect();
            new_revision(None, items, default_away_rules(), device_id, now_ms)
        }
    };
    insert_in(&tx, &created)?;
    tx.commit()?;
    Ok((created, true))
}

/// Read-modify-write one DRAFT revision in an immediate transaction. An armed,
/// superseded or ended revision refuses: amend an armed plan by re-opening it.
pub fn mutate_draft(
    pool: &UserDbPool,
    id: &str,
    f: impl FnOnce(&mut Standup) -> Result<(), AppError>,
) -> Result<Standup, AppError> {
    let mut conn = pool.get()?;
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let mut s = get_in(&tx, id)?.ok_or_else(|| AppError::NotFound(format!("Standup {id}")))?;
    if s.status != StandupStatus::Draft {
        return Err(AppError::Validation(format!(
            "standup {id} is {}; only a draft revision can be edited (re-open the standup to amend an armed plan)",
            token(&s.status)?
        )));
    }
    f(&mut s)?;
    write_plan_in(&tx, &s)?;
    tx.commit()?;
    Ok(s)
}

/// Apply one item patch. Absent fields stay. A `chosen` text with no `state`
/// resolves the card: `accepted` when it is one of the proposals verbatim,
/// `edited` otherwise. A blank `chosen` clears it.
pub fn patch_item(
    pool: &UserDbPool,
    id: &str,
    patch: &StandupItemPatch,
) -> Result<Standup, AppError> {
    mutate_draft(pool, id, |s| {
        let item = s
            .plan
            .items
            .iter_mut()
            .find(|i| i.id == patch.id)
            .ok_or_else(|| AppError::NotFound(format!("Standup item {} in {id}", patch.id)))?;
        apply_patch(item, patch);
        Ok(())
    })
}

/// The patch rule, pure.
pub(crate) fn apply_patch(item: &mut StandupItem, patch: &StandupItemPatch) {
    if let Some(chosen) = patch.chosen.as_deref() {
        let chosen = chosen.trim();
        if chosen.is_empty() {
            item.chosen = None;
        } else {
            item.chosen = Some(chosen.to_string());
            if patch.state.is_none() {
                item.state = if item.proposals.iter().any(|p| p.text.trim() == chosen) {
                    StandupItemState::Accepted
                } else {
                    StandupItemState::Edited
                };
            }
        }
    }
    if let Some(state) = patch.state {
        item.state = state;
    }
    if let Some(window) = patch.window {
        item.window = window;
    }
    if let Some(priority) = patch.priority {
        item.priority = priority;
    }
    if let Some(at) = patch.not_before_ms {
        item.not_before_ms = Some(at);
    }
}

/// Replace a draft's away rules.
pub fn set_away_rules(pool: &UserDbPool, id: &str, rules: &AwayRules) -> Result<Standup, AppError> {
    mutate_draft(pool, id, |s| {
        s.away_rules = rules.clone();
        Ok(())
    })
}

/// Claim the go-gate: `draft` -> `armed`, as one compare-and-swap. `false`
/// when the row was not a draft (already armed, or someone else won), which is
/// what makes arming idempotent per revision.
pub fn claim_armed(pool: &UserDbPool, id: &str, now_ms: i64) -> Result<bool, AppError> {
    let conn = pool.get()?;
    let changed = conn.execute(
        "UPDATE companion_standup SET status = 'armed', armed_at = ?2
         WHERE id = ?1 AND status = 'draft'",
        params![id, now_ms],
    )?;
    Ok(changed == 1)
}

/// `armed` -> `superseded` (a later revision was armed). `false` when the row
/// was not armed (already superseded or ended), so nothing changed.
pub fn mark_superseded(pool: &UserDbPool, id: &str) -> Result<bool, AppError> {
    let conn = pool.get()?;
    let changed = conn.execute(
        "UPDATE companion_standup SET status = 'superseded' WHERE id = ?1 AND status = 'armed'",
        params![id],
    )?;
    Ok(changed == 1)
}

/// End a revision (any status but `ended`), storing its final report when one
/// was built. `false` when it was already ended.
pub fn mark_ended(
    pool: &UserDbPool,
    id: &str,
    now_ms: i64,
    report: Option<&StandupReport>,
) -> Result<bool, AppError> {
    let report = match report {
        Some(r) => Some(to_json(r, "report")?),
        None => None,
    };
    let conn = pool.get()?;
    let changed = conn.execute(
        "UPDATE companion_standup
         SET status = 'ended', ended_at = ?2, report_json = COALESCE(?3, report_json)
         WHERE id = ?1 AND status != 'ended'",
        params![id, now_ms, report],
    )?;
    Ok(changed == 1)
}

// ---------------------------------------------------------------------------
// The event ledger (read side; `report::append_event` is the writer)
// ---------------------------------------------------------------------------

/// A revision's away acts, newest first, at most `limit` (1..=500).
pub fn list_events(
    pool: &UserDbPool,
    standup_id: &str,
    limit: i32,
) -> Result<Vec<StandupEvent>, AppError> {
    let limit = limit.clamp(1, MAX_LIST);
    let conn = pool.get()?;
    let mut stmt = conn.prepare(&format!(
        "SELECT {EVENT_COLUMNS} FROM companion_standup_event
         WHERE standup_id = ?1 ORDER BY at DESC, id DESC LIMIT ?2"
    ))?;
    let rows = stmt
        .query_map(params![standup_id, limit], row_to_event)?
        .collect::<Result<Vec<_>, _>>()?;
    rows.into_iter().map(into_event).collect()
}

/// The revision and every ancestor it was copied from, newest first.
fn lineage_in(conn: &Connection, id: &str) -> Result<Vec<Standup>, AppError> {
    let mut out: Vec<Standup> = Vec::new();
    let mut next = Some(id.to_string());
    while let Some(cur) = next {
        if out.iter().any(|s| s.id == cur) {
            break; // a parent cycle is corrupt data; stop rather than spin
        }
        let Some(s) = get_in(conn, &cur)? else { break };
        next = s.parent_id.clone();
        out.push(s);
    }
    Ok(out)
}

/// Item ids named by `detail.itemId` on events of `kinds` across `standup_ids`
/// (optionally only those whose `detail.reason` equals `reason`).
fn item_ids_with_events(
    conn: &Connection,
    standup_ids: &[String],
    kinds: &[StandupEventKind],
    reason: Option<&str>,
) -> Result<HashSet<String>, AppError> {
    let mut out = HashSet::new();
    let mut stmt = conn.prepare(
        "SELECT json_extract(detail_json, '$.itemId') AS item_id,
                json_extract(detail_json, '$.reason') AS reason
         FROM companion_standup_event
         WHERE standup_id = ?1 AND kind = ?2 AND json_valid(detail_json)",
    )?;
    for sid in standup_ids {
        for kind in kinds {
            let rows = stmt
                .query_map(params![sid, token(kind)?], |r| {
                    Ok((
                        r.get::<_, Option<String>>("item_id")?,
                        r.get::<_, Option<String>>("reason")?,
                    ))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            for (item_id, why) in rows {
                let Some(item_id) = item_id else { continue };
                if reason.is_none() || why.as_deref() == reason {
                    out.insert(item_id);
                }
            }
        }
    }
    Ok(out)
}

/// Item ids that already went out (a `dispatch` or `backfill` event) in the
/// revision or any ancestor.
pub fn dispatched_item_ids(
    pool: &UserDbPool,
    standup_id: &str,
) -> Result<HashSet<String>, AppError> {
    let conn = pool.get()?;
    let ids: Vec<String> = lineage_in(&conn, standup_id)?
        .into_iter()
        .map(|s| s.id)
        .collect();
    item_ids_with_events(
        &conn,
        &ids,
        &[StandupEventKind::Dispatch, StandupEventKind::Backfill],
        None,
    )
}

/// Item ids an arm refused because a headless App Master held the project, in
/// the revision or any ancestor. A re-open retries them.
pub fn refused_item_ids(pool: &UserDbPool, standup_id: &str) -> Result<HashSet<String>, AppError> {
    let conn = pool.get()?;
    let ids: Vec<String> = lineage_in(&conn, standup_id)?
        .into_iter()
        .map(|s| s.id)
        .collect();
    item_ids_with_events(
        &conn,
        &ids,
        &[StandupEventKind::Stop],
        Some(REFUSAL_HEADLESS_MASTER),
    )
}

/// Items of the currently ARMED revision that dead-spot backfill may pull
/// early: `accepted`/`edited` items not yet dispatched, plus `filler` items,
/// highest `priority` first. Empty when no revision is armed.
///
/// Cross-package seam frozen by the Director before the WP1-WP3 fan-out:
/// WP1 implements it, WP2 (`engine::resources::dead_spot`) calls it.
///
/// "Dispatched" is read from the event ledger: an item named by
/// `detail.itemId` on a `dispatch` or `backfill` event of the revision or any
/// ancestor (a carried item was dispatched by the revision it came from).
/// Skipped and still-proposed items never qualify; a skipped filler neither.
/// "Highest priority first" is ascending `priority` (lower runs first).
pub fn backfill_candidates(pool: &UserDbPool) -> Result<Vec<StandupItem>, AppError> {
    let armed = {
        let conn = pool.get()?;
        let row = conn
            .query_row(
                &format!(
                    "SELECT {COLUMNS} FROM companion_standup WHERE status = 'armed'
                     ORDER BY revision DESC, opened_at DESC, id DESC LIMIT 1"
                ),
                [],
                row_to_standup,
            )
            .optional()?;
        row.map(into_standup).transpose()?
    };
    let Some(armed) = armed else {
        return Ok(Vec::new());
    };
    let gone = dispatched_item_ids(pool, &armed.id)?;
    let mut out: Vec<StandupItem> = armed
        .plan
        .items
        .into_iter()
        .filter(|i| !gone.contains(&i.id))
        .filter(|i| match i.kind {
            StandupItemKind::Filler => i.state != StandupItemState::Skipped,
            _ => matches!(
                i.state,
                StandupItemState::Accepted | StandupItemState::Edited
            ),
        })
        .collect();
    out.sort_by_key(|i| i.priority);
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::companion::standup::model::DirectionProposal;

    fn projects() -> Vec<ProjectSeed> {
        vec![
            ProjectSeed {
                id: "p1".into(),
                name: "alpha".into(),
                root: "C:/w/alpha".into(),
            },
            ProjectSeed {
                id: "p2".into(),
                name: "beta".into(),
                root: "C:/w/beta".into(),
            },
        ]
    }

    fn insert_event(
        pool: &UserDbPool,
        standup_id: &str,
        kind: &str,
        detail: serde_json::Value,
    ) -> Result<(), AppError> {
        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO companion_standup_event (id, standup_id, at, kind, project_id, summary, detail_json)
             VALUES (?1, ?2, 1, ?3, NULL, 's', ?4)",
            params![new_item_id(), standup_id, kind, detail.to_string()],
        )?;
        Ok(())
    }

    #[test]
    fn open_fresh_seeds_one_direction_per_project_with_default_rules() {
        let pool = crate::db::init_test_user_db().unwrap();
        let (s, created) = open(&pool, "dev-1", 1_000, &projects(), None).unwrap();
        assert!(created);
        assert_eq!(s.revision, 1);
        assert_eq!(s.status, StandupStatus::Draft);
        assert_eq!(s.parent_id, None);
        assert_eq!(s.plan.items.len(), 2);
        assert!(s
            .plan
            .items
            .iter()
            .all(|i| i.kind == StandupItemKind::Direction
                && i.state == StandupItemState::Proposed
                && i.device_id == "dev-1"));
        assert_eq!(s.away_rules, default_away_rules());
        assert!(s.away_rules.push_targets.is_empty());
        assert_eq!(current(&pool).unwrap().unwrap().id, s.id);
    }

    #[test]
    fn open_on_a_draft_returns_that_draft() {
        let pool = crate::db::init_test_user_db().unwrap();
        let (first, _) = open(&pool, "dev-1", 1_000, &projects(), None).unwrap();
        let (again, created) = open(&pool, "dev-1", 2_000, &projects(), None).unwrap();
        assert!(!created);
        assert_eq!(again, first);
        assert_eq!(history(&pool, 10).unwrap().len(), 1);
    }

    #[test]
    fn open_on_armed_writes_revision_n_plus_one_with_items_copied() {
        let pool = crate::db::init_test_user_db().unwrap();
        let (first, _) = open(&pool, "dev-1", 1_000, &projects(), None).unwrap();
        let item_id = first.plan.items[0].id.clone();
        patch_item(
            &pool,
            &first.id,
            &StandupItemPatch {
                id: item_id.clone(),
                state: None,
                chosen: Some("Ship the importer".into()),
                window: Some(StandupWindow::Night),
                priority: None,
                not_before_ms: None,
            },
        )
        .unwrap();
        assert!(claim_armed(&pool, &first.id, 1_500).unwrap());

        let mut more = projects();
        more.push(ProjectSeed {
            id: "p3".into(),
            name: "gamma".into(),
            root: "C:/w/gamma".into(),
        });
        let (second, created) = open(&pool, "dev-1", 2_000, &more, None).unwrap();
        assert!(created);
        assert_eq!(second.revision, 2);
        assert_eq!(second.parent_id.as_deref(), Some(first.id.as_str()));
        assert_eq!(second.status, StandupStatus::Draft);
        let copied = second.plan.items.iter().find(|i| i.id == item_id).unwrap();
        assert_eq!(copied.state, StandupItemState::Edited);
        assert_eq!(copied.chosen.as_deref(), Some("Ship the importer"));
        assert_eq!(copied.window, StandupWindow::Night);
        assert_eq!(second.plan.items.len(), 3, "the new project gets a card");
        // The parent stays armed until the child is armed.
        assert_eq!(
            get(&pool, &first.id).unwrap().unwrap().status,
            StandupStatus::Armed
        );
        // The live standup is the newest revision.
        assert_eq!(current(&pool).unwrap().unwrap().id, second.id);
    }

    #[test]
    fn armed_revision_refuses_edits_and_a_second_claim() {
        let pool = crate::db::init_test_user_db().unwrap();
        let (s, _) = open(&pool, "dev-1", 1_000, &projects(), None).unwrap();
        assert!(claim_armed(&pool, &s.id, 1_100).unwrap());
        assert!(!claim_armed(&pool, &s.id, 1_200).unwrap());
        let err = set_away_rules(&pool, &s.id, &AwayRules::default()).unwrap_err();
        assert!(matches!(err, AppError::Validation(_)));
    }

    #[test]
    fn patch_resolves_accepted_or_edited_from_chosen() {
        let mut item = seed_item("p1", "d", 0);
        item.proposals = vec![DirectionProposal {
            id: "a".into(),
            text: "Fix the flake".into(),
            rationale: "r".into(),
            recommended: true,
        }];
        let mut patch = StandupItemPatch {
            id: item.id.clone(),
            state: None,
            chosen: Some("Fix the flake".into()),
            window: None,
            priority: None,
            not_before_ms: None,
        };
        apply_patch(&mut item, &patch);
        assert_eq!(item.state, StandupItemState::Accepted);
        patch.chosen = Some("Fix the flake, then the docs".into());
        apply_patch(&mut item, &patch);
        assert_eq!(item.state, StandupItemState::Edited);
        patch.chosen = None;
        patch.state = Some(StandupItemState::Skipped);
        apply_patch(&mut item, &patch);
        assert_eq!(item.state, StandupItemState::Skipped);
    }

    #[test]
    fn end_stores_status_and_is_once() {
        let pool = crate::db::init_test_user_db().unwrap();
        let (s, _) = open(&pool, "dev-1", 1_000, &projects(), None).unwrap();
        assert!(mark_ended(&pool, &s.id, 3_000, None).unwrap());
        assert!(!mark_ended(&pool, &s.id, 4_000, None).unwrap());
        let ended = require(&pool, &s.id).unwrap();
        assert_eq!(ended.status, StandupStatus::Ended);
        assert_eq!(ended.ended_at, Some(3_000));
        assert!(current(&pool).unwrap().is_none());
    }

    #[test]
    fn backfill_candidates_skip_dispatched_and_undecided_items() {
        let pool = crate::db::init_test_user_db().unwrap();
        assert!(
            backfill_candidates(&pool).unwrap().is_empty(),
            "nothing armed"
        );
        let (s, _) = open(&pool, "dev-1", 1_000, &projects(), None).unwrap();
        let a = s.plan.items[0].id.clone();
        let b = s.plan.items[1].id.clone();
        let filler_id = mutate_draft(&pool, &s.id, |s| {
            for item in s.plan.items.iter_mut() {
                item.state = StandupItemState::Accepted;
                item.chosen = Some("go".into());
            }
            let mut filler = seed_item("p1", "dev-1", 9);
            filler.kind = StandupItemKind::Filler;
            s.plan.items.push(filler);
            Ok(())
        })
        .unwrap()
        .plan
        .items[2]
            .id
            .clone();
        assert!(claim_armed(&pool, &s.id, 1_100).unwrap());
        insert_event(&pool, &s.id, "dispatch", serde_json::json!({ "itemId": a })).unwrap();
        let ids: Vec<String> = backfill_candidates(&pool)
            .unwrap()
            .into_iter()
            .map(|i| i.id)
            .collect();
        assert_eq!(ids, vec![b, filler_id]);
    }

    #[test]
    fn refused_items_are_read_back_through_the_lineage() {
        let pool = crate::db::init_test_user_db().unwrap();
        let (s, _) = open(&pool, "dev-1", 1_000, &projects(), None).unwrap();
        let a = s.plan.items[0].id.clone();
        assert!(claim_armed(&pool, &s.id, 1_100).unwrap());
        insert_event(
            &pool,
            &s.id,
            "stop",
            serde_json::json!({ "itemId": a, "reason": REFUSAL_HEADLESS_MASTER }),
        )
        .unwrap();
        let (child, _) = open(&pool, "dev-1", 2_000, &projects(), None).unwrap();
        assert!(refused_item_ids(&pool, &child.id).unwrap().contains(&a));
        assert!(dispatched_item_ids(&pool, &child.id).unwrap().is_empty());
    }

    fn ids(names: &[&str]) -> HashSet<String> {
        names.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn prune_drops_only_cards_of_projects_that_no_longer_exist() {
        let mut agent = seed_item("p1", "d", 2);
        agent.kind = StandupItemKind::CreateAgent;
        agent.project_id = None;
        let agent_id = agent.id.clone();
        let mut items = vec![seed_item("p1", "d", 0), seed_item("gone", "d", 1), agent];
        assert!(prune_dead_projects(&mut items, &ids(&["p1", "p2"])));
        let kept: Vec<Option<&str>> = items.iter().map(|i| i.project_id.as_deref()).collect();
        assert_eq!(
            kept,
            vec![Some("p1"), None],
            "the dead card left; the project-less card stayed"
        );
        assert!(items.iter().any(|i| i.id == agent_id));
        assert!(
            !prune_dead_projects(&mut items, &ids(&["p1"])),
            "nothing dead: nothing removed"
        );
        assert_eq!(items.len(), 2);
    }

    #[test]
    fn reopening_an_armed_plan_leaves_a_deleted_projects_card_behind() {
        let pool = crate::db::init_test_user_db().unwrap();
        let (first, _) = open(&pool, "dev-1", 1_000, &projects(), None).unwrap();
        assert!(claim_armed(&pool, &first.id, 1_500).unwrap());
        // p2 was deleted; p3 exists but is switched off (not a seed) and
        // never had a card, so it does not gain one.
        let alive = vec![projects()[0].clone()];
        let (second, created) =
            open(&pool, "dev-1", 2_000, &alive, Some(&ids(&["p1", "p3"]))).unwrap();
        assert!(created);
        let pids: Vec<Option<&str>> = second
            .plan
            .items
            .iter()
            .map(|i| i.project_id.as_deref())
            .collect();
        assert_eq!(pids, vec![Some("p1")]);
        // The armed parent is immutable and still holds both cards.
        assert_eq!(require(&pool, &first.id).unwrap().plan.items.len(), 2);
    }

    #[test]
    fn reopening_keeps_a_switched_off_projects_card() {
        let pool = crate::db::init_test_user_db().unwrap();
        let (first, _) = open(&pool, "dev-1", 1_000, &projects(), None).unwrap();
        assert!(claim_armed(&pool, &first.id, 1_500).unwrap());
        // p2 is no longer a seed (disabled) but still exists.
        let alive = vec![projects()[0].clone()];
        let (second, _) = open(&pool, "dev-1", 2_000, &alive, Some(&ids(&["p1", "p2"]))).unwrap();
        assert_eq!(second.plan.items.len(), 2);
    }

    #[test]
    fn prune_live_draft_writes_only_a_draft_that_held_a_dead_card() {
        let pool = crate::db::init_test_user_db().unwrap();
        assert!(
            prune_live_draft(&pool, &ids(&[])).unwrap().is_none(),
            "no standup"
        );
        let (s, _) = open(&pool, "dev-1", 1_000, &projects(), None).unwrap();
        assert!(
            prune_live_draft(&pool, &ids(&["p1", "p2"]))
                .unwrap()
                .is_none(),
            "nothing dead"
        );
        let pruned = prune_live_draft(&pool, &ids(&["p1"])).unwrap().unwrap();
        assert_eq!(pruned.id, s.id);
        assert_eq!(pruned.plan.items.len(), 1);
        assert_eq!(
            require(&pool, &s.id).unwrap().plan.items.len(),
            1,
            "written"
        );

        // An armed revision is never rewritten.
        assert!(claim_armed(&pool, &s.id, 1_100).unwrap());
        assert!(prune_live_draft(&pool, &ids(&[])).unwrap().is_none());
        assert_eq!(require(&pool, &s.id).unwrap().plan.items.len(), 1);
    }
}
