//! Repository for `charter_acts` (migration `e67_mandate_envelope`): the
//! append-only log of every decision a mandate's steward, the router or the
//! operator took, and every change to a mandate's envelope.
//!
//! Append-only means it: after insert, only `reverted_at` / `revert_act_id`
//! are ever written, and only once ([`mark_reverted_in`]). The envelope doors
//! that write an act in the same transaction as the envelope change live in
//! [`super::mandates`]; this module is the row shape, the insert and the reads.
//!
//! The emit half (`charter-act-recorded`) is the app layer's: this crate has
//! no event channel, so every caller that appends must emit after it commits.

use rusqlite::{params, Connection, OptionalExtension, Row};
use uuid::Uuid;

use crate::models::{CharterAct, CharterActFilter, CharterActor, EnvelopeChange, NewCharterAct};
use crate::query_builder::QueryBuilder;
use crate::repos::utils::collect_rows;
use crate::DbPool;
use crate::PoolExt;
use personas_core::error::AppError;

/// Every column [`row_to_act`] reads, in table order.
pub(crate) const COLUMNS: &str = "id, charter_id, envelope_version, item_kind, item_id, verdict, \
     actor, scope, reversible, cost_usd, shown_json, env_change_json, reverted_at, \
     revert_act_id, origin_device, created_at";

/// Newest-first page size when the filter names none, and the hard cap.
pub const DEFAULT_LIST_LIMIT: u32 = 100;
pub const MAX_LIST_LIMIT: u32 = 500;

/// The raw row; `actor` and `env_change_json` still text.
struct ActRow {
    id: String,
    charter_id: String,
    envelope_version: i64,
    item_kind: String,
    item_id: String,
    verdict: String,
    actor: String,
    scope: Option<String>,
    reversible: bool,
    cost_usd: Option<f64>,
    shown_json: Option<String>,
    env_change_json: Option<String>,
    reverted_at: Option<String>,
    revert_act_id: Option<String>,
    origin_device: Option<String>,
    created_at: String,
}

row_mapper!(row_to_act_raw -> ActRow {
    id, charter_id, envelope_version, item_kind, item_id, verdict, actor, scope,
    reversible [bool], cost_usd, shown_json, env_change_json, reverted_at, revert_act_id,
    origin_device, created_at,
});

fn row_to_act(row: &Row) -> rusqlite::Result<CharterAct> {
    let raw = row_to_act_raw(row)?;
    // The CHECK admits exactly three actors, so an unknown one is a row this
    // code did not write. It reads as `operator` - the actor whose acts are
    // never silently trusted - and says so.
    let actor = CharterActor::parse(&raw.actor).unwrap_or_else(|| {
        tracing::warn!(act_id = %raw.id, actor = %raw.actor,
            "charter_acts: unknown actor, read as operator");
        CharterActor::Operator
    });
    let env_change = raw.env_change_json.as_deref().and_then(|j| {
        match serde_json::from_str::<EnvelopeChange>(j) {
            Ok(c) => Some(c),
            Err(e) => {
                tracing::warn!(act_id = %raw.id, error = %e,
                    "charter_acts: unparsable env_change_json, shown as absent");
                None
            }
        }
    });
    Ok(CharterAct {
        id: raw.id,
        charter_id: raw.charter_id,
        envelope_version: raw.envelope_version,
        item_kind: raw.item_kind,
        item_id: raw.item_id,
        verdict: raw.verdict,
        actor,
        scope: raw.scope,
        reversible: raw.reversible,
        cost_usd: raw.cost_usd,
        shown_json: raw.shown_json,
        env_change,
        reverted_at: raw.reverted_at,
        revert_act_id: raw.revert_act_id,
        origin_device: raw.origin_device,
        created_at: raw.created_at,
    })
}

fn require(field: &str, value: &str) -> Result<(), AppError> {
    personas_core::validation::require_non_empty(field, value)
}

/// Insert one act on an open connection (the caller owns the transaction).
/// `envelope_version` is the version the act is recorded under.
pub(crate) fn insert_in(
    conn: &Connection,
    act: &NewCharterAct,
    envelope_version: i64,
    env_change: Option<&EnvelopeChange>,
) -> Result<CharterAct, AppError> {
    require("charterId", &act.charter_id)?;
    require("itemKind", &act.item_kind)?;
    require("itemId", &act.item_id)?;
    require("verdict", &act.verdict)?;
    if let Some(c) = act.cost_usd {
        if !c.is_finite() || c < 0.0 {
            return Err(AppError::Validation(format!(
                "charter act cost must be a finite non-negative amount, got {c}"
            )));
        }
    }
    if let Some(shown) = act.shown_json.as_deref() {
        serde_json::from_str::<serde_json::Value>(shown).map_err(|e| {
            AppError::Validation(format!("charter act shownJson is not valid JSON: {e}"))
        })?;
    }
    let env_json = env_change.map(serde_json::to_string).transpose()?;
    let id = format!("act_{}", Uuid::new_v4().simple());
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        &format!(
            "INSERT INTO charter_acts ({COLUMNS})
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, NULL, NULL, ?13, ?14)"
        ),
        params![
            id,
            act.charter_id,
            envelope_version,
            act.item_kind,
            act.item_id,
            act.verdict,
            act.actor.as_str(),
            act.scope.map(|s| s.as_str()),
            i64::from(act.reversible),
            act.cost_usd,
            act.shown_json,
            env_json,
            act.origin_device,
            now,
        ],
    )?;
    get_in(conn, &id)?
        .ok_or_else(|| AppError::Internal(format!("charter act {id} vanished after insert")))
}

/// Append a decision act. The envelope version is read from the charter row
/// inside the same transaction, so the act carries the envelope it was
/// actually taken under. `NotFound` when the charter does not exist.
pub fn append(pool: &DbPool, act: &NewCharterAct) -> Result<CharterAct, AppError> {
    timed_query!("charter_acts", "charter_acts::append", {
        let mut conn = pool.conn("charter_acts::append")?;
        let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let version: Option<i64> = tx
            .query_row(
                "SELECT envelope_version FROM persona_responsibilities WHERE id = ?1",
                [&act.charter_id],
                |r| r.get("envelope_version"),
            )
            .optional()?;
        let Some(version) = version else {
            return Err(AppError::NotFound(format!("Charter {}", act.charter_id)));
        };
        let created = insert_in(&tx, act, version, None)?;
        tx.commit()?;
        Ok(created)
    })
}

pub(crate) fn get_in(conn: &Connection, id: &str) -> Result<Option<CharterAct>, AppError> {
    let mut stmt =
        conn.prepare_cached(&format!("SELECT {COLUMNS} FROM charter_acts WHERE id = ?1"))?;
    Ok(stmt.query_row([id], row_to_act).optional()?)
}

pub fn get(pool: &DbPool, id: &str) -> Result<Option<CharterAct>, AppError> {
    timed_query!("charter_acts", "charter_acts::get", {
        let conn = pool.conn("charter_acts::get")?;
        get_in(&conn, id)
    })
}

/// Acts matching every set field of `filter`, newest first.
pub fn list(pool: &DbPool, filter: &CharterActFilter) -> Result<Vec<CharterAct>, AppError> {
    let limit = filter
        .limit
        .unwrap_or(DEFAULT_LIST_LIMIT)
        .clamp(1, MAX_LIST_LIMIT);
    let mut qb = QueryBuilder::new();
    if let Some(c) = &filter.charter_id {
        qb.where_eq("charter_id", c.clone());
    }
    if let Some(a) = filter.actor {
        qb.where_eq("actor", a.as_str().to_string());
    }
    if let Some(r) = filter.reversible {
        qb.where_eq("reversible", i64::from(r));
    }
    match filter.reverted {
        Some(true) => {
            qb.where_raw(|_| "reverted_at IS NOT NULL".to_string(), Vec::new());
        }
        Some(false) => {
            qb.where_raw(|_| "reverted_at IS NULL".to_string(), Vec::new());
        }
        None => {}
    }
    if let Some(k) = &filter.item_kind {
        qb.where_eq("item_kind", k.clone());
    }
    if let Some(i) = &filter.item_id {
        qb.where_eq("item_id", i.clone());
    }
    qb.order_by_multiple(&[("created_at", "DESC"), ("rowid", "DESC")]);
    qb.limit(i64::from(limit));
    let sql = qb.build_select(&format!("SELECT {COLUMNS} FROM charter_acts"));
    timed_query!("charter_acts", "charter_acts::list", {
        let conn = pool.conn("charter_acts::list")?;
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(qb.params_ref().as_slice(), row_to_act)?;
        Ok(collect_rows(rows, "charter_acts::list"))
    })
}

/// How many acts a charter has, all time.
pub(crate) fn count_for_charter_in(conn: &Connection, charter_id: &str) -> Result<i64, AppError> {
    Ok(conn.query_row(
        "SELECT COUNT(*) AS n FROM charter_acts WHERE charter_id = ?1",
        [charter_id],
        |r| r.get("n"),
    )?)
}

/// Stamp an act reverted, once. Returns whether a row changed: `false` when it
/// was already reverted (the guard is in the WHERE, so two concurrent reverts
/// cannot both win).
pub(crate) fn mark_reverted_in(
    conn: &Connection,
    act_id: &str,
    revert_act_id: &str,
    at: &str,
) -> Result<bool, AppError> {
    let n = conn.execute(
        "UPDATE charter_acts SET reverted_at = ?1, revert_act_id = ?2
         WHERE id = ?3 AND reverted_at IS NULL",
        params![at, revert_act_id, act_id],
    )?;
    Ok(n > 0)
}
