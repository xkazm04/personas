//! Repository for the mandate mirror (migration `e69_charter_mirror`, spark
//! `mandate-lanes` WP9): a paired peer's read-only copy of the mandates whose
//! home is another device. The home rule and the two streams are documented
//! on `personas_core::models::charter_mirror`.
//!
//! [`apply`] is the ONE writer and the only door a mirror job reaches. It is
//! idempotent: the summary is latest-wins on the home's send time, an act is
//! keyed by the id the home minted (a re-delivered act changes nothing), and
//! the only change an act may carry is the one-way `reverted` transition.
//! Every reader hides the mirrors of a device that is no longer paired:
//! unpairing withdraws its mandates here at once.

use rusqlite::{params, OptionalExtension, TransactionBehavior};

use crate::models::{
    CharterAct, CharterActFilter, CharterMirrorPayload, MandateMirror, MandateSummary,
    MIRROR_ACTS_KEPT,
};
use crate::repos::utils::collect_rows;
use crate::DbPool;
use crate::PoolExt;
use personas_core::error::AppError;

/// What one [`apply`] changed. All zero / false for a re-delivery.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct MirrorApplied {
    /// The stored summary was replaced by a newer one.
    pub summary_updated: bool,
    /// Acts this device had not seen before, in the order the home sent them.
    pub new_acts: Vec<CharterAct>,
    /// Acts already stored that the home has since reverted.
    pub newly_reverted: u32,
}

impl MirrorApplied {
    pub fn changed(&self) -> bool {
        self.summary_updated || !self.new_acts.is_empty() || self.newly_reverted > 0
    }
}

/// The rows of a device still in `owned_devices`; the mirror of an unpaired
/// device reads as absent.
const PAIRED: &str = "home_peer_id IN (SELECT peer_id FROM owned_devices)";

/// Is this device the home of `charter_id` (it holds the charter's
/// `persona_responsibilities` row)?
pub fn is_home_here(pool: &DbPool, charter_id: &str) -> Result<bool, AppError> {
    timed_query!(
        "persona_responsibilities",
        "charter_mirror::is_home_here",
        {
            let conn = pool.conn("charter_mirror::is_home_here")?;
            Ok(conn
                .query_row(
                    "SELECT 1 FROM persona_responsibilities WHERE id = ?1",
                    [charter_id],
                    |_| Ok(true),
                )
                .optional()?
                .unwrap_or(false))
        }
    )
}

/// Store one mirror job from `home_peer_id`. Refused (`Validation`, nothing
/// written) when the charter's home is THIS device, or when another device
/// already mirrors a charter of that id.
pub fn apply(
    pool: &DbPool,
    home_peer_id: &str,
    home_name: &str,
    payload: &CharterMirrorPayload,
) -> Result<MirrorApplied, AppError> {
    if let Some(problem) = payload.problem() {
        return Err(AppError::Validation(problem));
    }
    let charter_id = payload.charter.charter_id.as_str();
    timed_query!("mirrored_charters", "charter_mirror::apply", {
        let mut conn = pool.conn("charter_mirror::apply")?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let home_here: bool = tx
            .query_row(
                "SELECT 1 FROM persona_responsibilities WHERE id = ?1",
                [charter_id],
                |_| Ok(true),
            )
            .optional()?
            .unwrap_or(false);
        if home_here {
            return Err(AppError::Validation(format!(
                "Mandate {charter_id} lives on this device; it is not mirrored from another one."
            )));
        }
        let held_by: Option<String> = tx
            .query_row(
                "SELECT home_peer_id FROM mirrored_charters WHERE charter_id = ?1",
                [charter_id],
                |r| r.get("home_peer_id"),
            )
            .optional()?;
        if held_by.as_deref().is_some_and(|h| h != home_peer_id) {
            return Err(AppError::Validation(format!(
                "Mandate {charter_id} is already mirrored from another device."
            )));
        }

        // The stored summary is the home's own view: no mirror marker.
        let mut summary = payload.charter.clone();
        summary.mirror = None;
        let now = chrono::Utc::now().to_rfc3339();
        let summary_updated = tx.execute(
            "INSERT INTO mirrored_charters
                (charter_id, home_peer_id, home_name, summary_json, home_sent_at_ms, mirrored_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(charter_id) DO UPDATE SET
                home_name = excluded.home_name,
                summary_json = excluded.summary_json,
                home_sent_at_ms = excluded.home_sent_at_ms,
                mirrored_at = excluded.mirrored_at
             WHERE excluded.home_sent_at_ms > mirrored_charters.home_sent_at_ms",
            params![
                charter_id,
                home_peer_id,
                home_name,
                serde_json::to_string(&summary)?,
                payload.sent_at_ms,
                now
            ],
        )? > 0;

        let mut out = MirrorApplied {
            summary_updated,
            ..Default::default()
        };
        {
            let mut insert = tx.prepare_cached(
                "INSERT INTO mirrored_charter_acts
                    (id, charter_id, home_peer_id, act_json, created_at, reverted)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                 ON CONFLICT(id) DO NOTHING",
            )?;
            let mut revert = tx.prepare_cached(
                "UPDATE mirrored_charter_acts SET act_json = ?2, reverted = 1
                  WHERE id = ?1 AND reverted = 0 AND charter_id = ?3",
            )?;
            for act in &payload.acts {
                let json = serde_json::to_string(act)?;
                let reverted = act.reverted_at.is_some();
                if insert.execute(params![
                    act.id,
                    charter_id,
                    home_peer_id,
                    json,
                    act.created_at,
                    reverted
                ])? > 0
                {
                    out.new_acts.push(act.clone());
                } else if reverted {
                    out.newly_reverted += revert.execute(params![act.id, json, charter_id])? as u32;
                }
            }
        }
        // Retention: the newest MIRROR_ACTS_KEPT per charter.
        tx.execute(
            "DELETE FROM mirrored_charter_acts
              WHERE charter_id = ?1 AND id NOT IN (
                SELECT id FROM mirrored_charter_acts WHERE charter_id = ?1
                 ORDER BY created_at DESC, id DESC LIMIT ?2)",
            params![charter_id, MIRROR_ACTS_KEPT as i64],
        )?;
        tx.commit()?;
        Ok(out)
    })
}

fn mirrored_summary(
    summary_json: &str,
    home_peer_id: String,
    home_name: String,
    mirrored_at: String,
) -> Option<MandateSummary> {
    let mut summary: MandateSummary = serde_json::from_str(summary_json)
        .map_err(|e| tracing::warn!(error = %e, "charter_mirror: unreadable mirrored summary"))
        .ok()?;
    summary.mirror = Some(MandateMirror {
        home_peer_id,
        home_name,
        mirrored_at,
    });
    Some(summary)
}

fn read_summaries(
    pool: &DbPool,
    where_sql: &str,
    arg: Option<&str>,
) -> Result<Vec<MandateSummary>, AppError> {
    let conn = pool.conn("charter_mirror::read")?;
    let sql = format!(
        "SELECT summary_json, home_peer_id, home_name, mirrored_at FROM mirrored_charters
          WHERE {PAIRED} {where_sql}"
    );
    let mut stmt = conn.prepare(&sql)?;
    let map = |r: &rusqlite::Row<'_>| {
        Ok((
            r.get::<_, String>("summary_json")?,
            r.get::<_, String>("home_peer_id")?,
            r.get::<_, String>("home_name")?,
            r.get::<_, String>("mirrored_at")?,
        ))
    };
    let rows = match arg {
        Some(a) => collect_rows(stmt.query_map([a], map)?, "charter_mirror::read"),
        None => collect_rows(stmt.query_map([], map)?, "charter_mirror::read"),
    };
    Ok(rows
        .into_iter()
        .filter_map(|(json, peer, name, at)| mirrored_summary(&json, peer, name, at))
        .collect())
}

/// Every mirrored mandate that is not retired, marked with its home, by
/// project name. Absent when its home is no longer paired.
pub fn list(pool: &DbPool) -> Result<Vec<MandateSummary>, AppError> {
    timed_query!("mirrored_charters", "charter_mirror::list", {
        let mut out: Vec<MandateSummary> = read_summaries(pool, "", None)?
            .into_iter()
            .filter(|m| m.status != "retired")
            .collect();
        out.sort_by(|a, b| {
            let name = |m: &MandateSummary| {
                m.project_name
                    .clone()
                    .unwrap_or_else(|| m.project_id.clone())
                    .to_lowercase()
            };
            name(a).cmp(&name(b))
        });
        Ok(out)
    })
}

/// One mirrored mandate, any status, or `None` when this device does not
/// mirror it (or its home is no longer paired).
pub fn get(pool: &DbPool, charter_id: &str) -> Result<Option<MandateSummary>, AppError> {
    timed_query!("mirrored_charters", "charter_mirror::get", {
        Ok(
            read_summaries(pool, "AND charter_id = ?1", Some(charter_id))?
                .into_iter()
                .next(),
        )
    })
}

/// Where a mirrored mandate lives, or `None` when this device does not
/// mirror it.
pub fn home_of(pool: &DbPool, charter_id: &str) -> Result<Option<MandateMirror>, AppError> {
    Ok(get(pool, charter_id)?.and_then(|m| m.mirror))
}

/// One mirrored act, or `None`.
pub fn get_act(pool: &DbPool, act_id: &str) -> Result<Option<CharterAct>, AppError> {
    timed_query!("mirrored_charter_acts", "charter_mirror::get_act", {
        let conn = pool.conn("charter_mirror::get_act")?;
        let json: Option<String> = conn
            .query_row(
                &format!("SELECT act_json FROM mirrored_charter_acts WHERE id = ?1 AND {PAIRED}"),
                [act_id],
                |r| r.get("act_json"),
            )
            .optional()?;
        Ok(json.and_then(|j| serde_json::from_str(&j).ok()))
    })
}

/// Mirrored acts matching the filter, newest first, with the same semantics
/// and page limits as `charter_acts::list`.
pub fn list_acts(pool: &DbPool, filter: &CharterActFilter) -> Result<Vec<CharterAct>, AppError> {
    timed_query!("mirrored_charter_acts", "charter_mirror::list_acts", {
        let conn = pool.conn("charter_mirror::list_acts")?;
        let (sql, arg) = match filter.charter_id.as_deref() {
            Some(id) => (
                format!(
                    "SELECT act_json FROM mirrored_charter_acts WHERE {PAIRED} AND charter_id = ?1
                      ORDER BY created_at DESC, id DESC"
                ),
                Some(id),
            ),
            None => (
                format!(
                    "SELECT act_json FROM mirrored_charter_acts WHERE {PAIRED}
                      ORDER BY created_at DESC, id DESC"
                ),
                None,
            ),
        };
        let mut stmt = conn.prepare(&sql)?;
        let map = |r: &rusqlite::Row<'_>| r.get::<_, String>("act_json");
        let rows = match arg {
            Some(a) => collect_rows(stmt.query_map([a], map)?, "charter_mirror::list_acts"),
            None => collect_rows(stmt.query_map([], map)?, "charter_mirror::list_acts"),
        };
        let limit = filter.limit.unwrap_or(100).min(500) as usize;
        Ok(rows
            .iter()
            .filter_map(|j| serde_json::from_str::<CharterAct>(j).ok())
            .filter(|a| act_matches(filter, a))
            .take(limit)
            .collect())
    })
}

fn act_matches(f: &CharterActFilter, a: &CharterAct) -> bool {
    f.actor.is_none_or(|x| x == a.actor)
        && f.reversible.is_none_or(|x| x == a.reversible)
        && f.reverted.is_none_or(|x| x == a.reverted_at.is_some())
        && f.item_kind.as_deref().is_none_or(|x| x == a.item_kind)
        && f.item_id.as_deref().is_none_or(|x| x == a.item_id)
}

#[cfg(test)]
mod tests;
