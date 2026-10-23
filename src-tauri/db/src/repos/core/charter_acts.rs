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

/// Whether `charter_id` already holds an act on this item (any actor, any
/// verdict, reverted or not). The cheap pre-check before work that would
/// only produce a duplicate.
pub fn has_item_act(
    pool: &DbPool,
    charter_id: &str,
    item_kind: &str,
    item_id: &str,
) -> Result<bool, AppError> {
    timed_query!("charter_acts", "charter_acts::has_item_act", {
        let conn = pool.conn("charter_acts::has_item_act")?;
        Ok(item_act_exists_in(&conn, charter_id, item_kind, item_id)?)
    })
}

fn item_act_exists_in(
    conn: &Connection,
    charter_id: &str,
    item_kind: &str,
    item_id: &str,
) -> rusqlite::Result<bool> {
    Ok(conn
        .query_row(
            "SELECT 1 AS one FROM charter_acts
             WHERE charter_id = ?1 AND item_kind = ?2 AND item_id = ?3 LIMIT 1",
            params![charter_id, item_kind, item_id],
            |_| Ok(true),
        )
        .optional()?
        .unwrap_or(false))
}

/// [`append`], at most once per `(charter_id, item_kind, item_id)`: `Ok(None)`
/// when the charter already holds an act on that item, decided inside the same
/// immediate transaction as the insert, so two detections racing write one row.
/// `NotFound` when no such charter exists.
pub fn append_once(pool: &DbPool, act: &NewCharterAct) -> Result<Option<CharterAct>, AppError> {
    timed_query!("charter_acts", "charter_acts::append_once", {
        let mut conn = pool.conn("charter_acts::append_once")?;
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
        if item_act_exists_in(&tx, &act.charter_id, &act.item_kind, &act.item_id)? {
            return Ok(None);
        }
        let created = insert_in(&tx, act, version, None)?;
        tx.commit()?;
        Ok(Some(created))
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

/// The `verdict` of the envelope acts that count as the operator READING the
/// mandate: a signature (first or re-signed) and a re-read kept as signed.
pub const READ_VERDICTS: [&str; 2] = ["signed", "kept"];

/// Standing decision acts (by the router or a steward, on an item: not an
/// envelope act, not a revert) of one charter.
pub(crate) fn decision_count_in(conn: &Connection, charter_id: &str) -> Result<i64, AppError> {
    Ok(conn.query_row(
        "SELECT COUNT(*) AS n FROM charter_acts
         WHERE charter_id = ?1 AND actor != 'operator' AND reverted_at IS NULL
           AND item_kind NOT IN ('mandate', 'act.revert')",
        [charter_id],
        |r| r.get("n"),
    )?)
}

/// What the re-read law and the Scopes section count on one charter.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct CharterTally {
    /// Standing decision acts (router or steward, on an item).
    pub decisions: i64,
    /// Those acts by the scope they were taken under (`None` scope is not counted here).
    pub by_scope: std::collections::HashMap<String, i64>,
    /// Standing router or steward acts on `merge` items since the mandate was
    /// last read (signed or kept); all time when it never was.
    pub merges_since_read: i64,
    /// The newest signature or keep, when there is one.
    pub last_read_at: Option<String>,
}

/// Every charter's tally, in three grouped reads.
pub fn tallies(pool: &DbPool) -> Result<std::collections::HashMap<String, CharterTally>, AppError> {
    let read_in = format!("'{}', '{}'", READ_VERDICTS[0], READ_VERDICTS[1]);
    timed_query!("charter_acts", "charter_acts::tallies", {
        let conn = pool.conn("charter_acts::tallies")?;
        let mut out: std::collections::HashMap<String, CharterTally> =
            std::collections::HashMap::new();
        {
            let mut stmt = conn.prepare(&format!(
                "SELECT charter_id, MAX(created_at) AS at FROM charter_acts
                 WHERE item_kind = 'mandate' AND verdict IN ({read_in})
                 GROUP BY charter_id"
            ))?;
            let rows = stmt.query_map([], |r| {
                Ok((r.get::<_, String>("charter_id")?, r.get::<_, String>("at")?))
            })?;
            for (c, at) in collect_rows(rows, "charter_acts::tallies(read)") {
                out.entry(c).or_default().last_read_at = Some(at);
            }
        }
        {
            let mut stmt = conn.prepare(
                "SELECT charter_id, scope, COUNT(*) AS n FROM charter_acts
                 WHERE actor != 'operator' AND reverted_at IS NULL
                   AND item_kind NOT IN ('mandate', 'act.revert')
                 GROUP BY charter_id, scope",
            )?;
            let rows = stmt.query_map([], |r| {
                Ok((
                    r.get::<_, String>("charter_id")?,
                    r.get::<_, Option<String>>("scope")?,
                    r.get::<_, i64>("n")?,
                ))
            })?;
            for (c, scope, n) in collect_rows(rows, "charter_acts::tallies(scope)") {
                let t = out.entry(c).or_default();
                t.decisions += n;
                if let Some(s) = scope {
                    *t.by_scope.entry(s).or_default() += n;
                }
            }
        }
        {
            let mut stmt = conn.prepare(&format!(
                "SELECT a.charter_id, COUNT(*) AS n FROM charter_acts a
                 WHERE a.item_kind = 'merge' AND a.actor != 'operator' AND a.reverted_at IS NULL
                   AND a.created_at > COALESCE((
                       SELECT MAX(k.created_at) FROM charter_acts k
                       WHERE k.charter_id = a.charter_id AND k.item_kind = 'mandate'
                         AND k.verdict IN ({read_in})), '')
                 GROUP BY a.charter_id"
            ))?;
            let rows = stmt.query_map([], |r| {
                Ok((r.get::<_, String>("charter_id")?, r.get::<_, i64>("n")?))
            })?;
            for (c, n) in collect_rows(rows, "charter_acts::tallies(merge)") {
                out.entry(c).or_default().merges_since_read = n;
            }
        }
        Ok(out)
    })
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

/// Whether an item has been acted on, as the router's idempotency reads it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ItemActState {
    /// At least one act on the item still stands; the newest standing one.
    Standing { act_id: String },
    /// Every act on the item was reverted: the operator took it back, so the
    /// router must not act on it again.
    Reverted,
}

/// Bound on one `IN (...)` list, well under SQLite's 999 host parameters.
const IN_CHUNK: usize = 400;

/// For every id in `item_ids` that has ANY act of `item_kind`, whether one of
/// those acts still stands. An id missing from the map was never acted on.
/// Envelope acts (`mandate`) and revert acts (`act.revert`) are separate
/// kinds, so they never answer for a decision item.
pub fn item_act_states(
    pool: &DbPool,
    item_kind: &str,
    item_ids: &[String],
) -> Result<std::collections::HashMap<String, ItemActState>, AppError> {
    let mut out = std::collections::HashMap::new();
    if item_ids.is_empty() {
        return Ok(out);
    }
    timed_query!("charter_acts", "charter_acts::item_act_states", {
        let conn = pool.conn("charter_acts::item_act_states")?;
        for chunk in item_ids.chunks(IN_CHUNK) {
            let marks = vec!["?"; chunk.len()].join(", ");
            let sql = format!(
                "SELECT item_id, id, reverted_at FROM charter_acts
                 WHERE item_kind = ? AND item_id IN ({marks})
                 ORDER BY created_at ASC, rowid ASC"
            );
            let mut binds: Vec<&dyn rusqlite::ToSql> = Vec::with_capacity(chunk.len() + 1);
            binds.push(&item_kind);
            for id in chunk {
                binds.push(id);
            }
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt.query_map(binds.as_slice(), |r| {
                Ok((
                    r.get::<_, String>("item_id")?,
                    r.get::<_, String>("id")?,
                    r.get::<_, Option<String>>("reverted_at")?,
                ))
            })?;
            for (item_id, act_id, reverted_at) in
                collect_rows(rows, "charter_acts::item_act_states")
            {
                match reverted_at {
                    // Oldest first, so the last standing act written wins.
                    None => {
                        out.insert(item_id, ItemActState::Standing { act_id });
                    }
                    Some(_) => {
                        out.entry(item_id).or_insert(ItemActState::Reverted);
                    }
                }
            }
        }
        Ok(out)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::init_test_db;
    use crate::models::DecideScope;

    fn seed(pool: &DbPool) {
        pool.conn("charter_acts test")
            .unwrap()
            .execute_batch(
                "INSERT INTO personas (id, name, system_prompt, enabled, created_at, updated_at)
                    VALUES ('steward','Steward','sp',1,datetime('now'),datetime('now'));
                 INSERT INTO persona_responsibilities
                    (id, persona_id, title, domain, scope_rung, status, project_id, source,
                     created_at, updated_at)
                 VALUES ('c1','steward','App master','software_engineering',2,'active','proj',
                         'kp-hire',datetime('now'),datetime('now'));",
            )
            .unwrap();
    }

    fn act(item: &str) -> NewCharterAct {
        NewCharterAct {
            charter_id: "c1".into(),
            item_kind: "report".into(),
            item_id: item.into(),
            verdict: "filed as evidence".into(),
            actor: CharterActor::Router,
            scope: Some(DecideScope::ReportRead),
            reversible: true,
            cost_usd: None,
            shown_json: None,
            origin_device: None,
        }
    }

    #[test]
    fn item_states_tell_standing_from_reverted_from_never_acted() {
        let pool = init_test_db().unwrap();
        seed(&pool);
        let standing = append(&pool, &act("r1")).unwrap();
        let gone = append(&pool, &act("r2")).unwrap();
        crate::repos::core::mandates::revert(&pool, &gone.id, None).unwrap();

        let ids: Vec<String> = ["r1", "r2", "r3"].iter().map(|s| s.to_string()).collect();
        let states = item_act_states(&pool, "report", &ids).unwrap();
        assert_eq!(
            states.get("r1"),
            Some(&ItemActState::Standing {
                act_id: standing.id
            })
        );
        assert_eq!(states.get("r2"), Some(&ItemActState::Reverted));
        assert_eq!(states.get("r3"), None, "never acted");
        // Another kind never answers for a report.
        assert!(item_act_states(&pool, "review", &ids).unwrap().is_empty());
        assert!(item_act_states(&pool, "report", &[]).unwrap().is_empty());
    }

    #[test]
    fn item_states_survive_more_ids_than_one_in_list_holds() {
        let pool = init_test_db().unwrap();
        seed(&pool);
        append(&pool, &act("r-999")).unwrap();
        let ids: Vec<String> = (0..1000).map(|i| format!("r-{i}")).collect();
        let states = item_act_states(&pool, "report", &ids).unwrap();
        assert_eq!(states.len(), 1);
        assert!(matches!(
            states.get("r-999"),
            Some(ItemActState::Standing { .. })
        ));
    }
}
