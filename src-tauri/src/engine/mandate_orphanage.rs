//! **The orphanage** (spark `mandate-lanes`, WP6): pending items no mandate
//! holds, grouped by project, measured against the fleet's flow
//! (`personas_engine::mandate_orphans`), and the three ways out - draft a
//! mandate for the project, adopt it into an existing mandate, or archive the
//! items (archived, not deleted).
//!
//! **Drafting is deterministic and idempotent, with no model call.** On the
//! steward sweep's tick, a cluster whose law fires and that has a steward
//! candidate gets ONE draft (`mandates::draft_for_orphans`, which refuses a
//! project holding any live mandate, so a second draft can never open while
//! one is). A draft the operator dropped is not drafted again until new
//! orphans arrive after the drop. The draft reaches the operator as a Sign
//! card through the existing `mandate:` entry.
//!
//! **Steward candidate.** A charter needs a persona. The candidate is the
//! project's own App Master persona (pinned to the project, App Master
//! prefix), else the persona that raised the most of the cluster's items.
//! When neither exists the cluster is not drafted on its own; the operator
//! can draft it naming a steward, adopt it, or archive it.

use std::collections::{BTreeMap, HashMap};

use personas_engine::mandate_orphans::{
    per_card, why, OrphanCluster, OrphanClusters, OrphanKindCount, OrphanSteward, StewardSource,
    MIN_ITEMS,
};
use personas_engine::mandate_router::Lane;

use crate::db::models::CharterAct;
use crate::db::repos::core::mandates::{self, OrphanDraft};
use crate::db::repos::core::orphan_archive::{self, ArchiveItem};
use crate::db::repos::core::personas as personas_repo;
use crate::db::{DbPool, PoolExt, UserDbPool};
use crate::engine::mandate_lanes::{routed, Routed, RoutedItem};
use crate::error::AppError;

/// Drafts one sweep may open, at most.
pub(crate) const MAX_DRAFTS_PER_SWEEP: usize = 3;

/// A timestamp as the sources store it (RFC 3339 or SQLite's `datetime()`),
/// in milliseconds; `None` when it is neither.
fn ms_of(s: &str) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(s)
        .map(|d| d.timestamp_millis())
        .ok()
        .or_else(|| {
            chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S")
                .map(|d| d.and_utc().timestamp_millis())
                .ok()
        })
}

/// Items one card releases today: operator-lane items over their cards.
fn fleet_per_card(r: &Routed) -> f64 {
    let ops: Vec<&RoutedItem> = r
        .items
        .iter()
        .filter(|i| matches!(i.route.lane, Lane::Breach | Lane::Sign | Lane::Accept))
        .collect();
    let cards = ops
        .iter()
        .map(|i| i.route.coalesce_key.as_str())
        .collect::<std::collections::HashSet<_>>()
        .len();
    per_card(ops.len() as u32, cards as u32)
}

/// The median pending item's time, the line between "recent" and not.
fn median_ms(r: &Routed) -> Option<i64> {
    let mut all: Vec<i64> = r
        .items
        .iter()
        .filter_map(|i| i.created_at.as_deref().and_then(ms_of))
        .collect();
    all.sort_unstable();
    all.get(all.len() / 2).copied()
}

fn steward_for(pool: &DbPool, project_id: &str, items: &[&RoutedItem]) -> Option<OrphanSteward> {
    match crate::commands::infrastructure::app_master_adopt::app_master_persona(pool, project_id) {
        Ok(Some(p)) => {
            return Some(OrphanSteward {
                persona_id: p.id,
                name: p.name,
                source: StewardSource::AppMaster,
            })
        }
        Ok(None) => {}
        Err(e) => tracing::warn!(project_id, error = %e, "orphanage: App Master lookup failed"),
    }
    let mut by: HashMap<&str, u32> = HashMap::new();
    for i in items {
        if let Some(p) = i.persona_id.as_deref() {
            *by.entry(p).or_default() += 1;
        }
    }
    let (persona_id, _) = by
        .into_iter()
        .max_by(|a, b| a.1.cmp(&b.1).then(b.0.cmp(a.0)))?;
    let persona = personas_repo::get_by_id(pool, persona_id).ok()?;
    Some(OrphanSteward {
        persona_id: persona.id,
        name: persona.name,
        source: StewardSource::Producer,
    })
}

fn project_names(pool: &DbPool) -> HashMap<String, String> {
    let read = || -> Result<HashMap<String, String>, AppError> {
        let conn = pool.conn("orphanage::project_names")?;
        let mut stmt = conn.prepare("SELECT id, name FROM dev_projects")?;
        let rows = stmt.query_map([], |r| {
            Ok((r.get::<_, String>("id")?, r.get::<_, String>("name")?))
        })?;
        Ok(rows.filter_map(Result::ok).collect())
    };
    read().unwrap_or_else(|e| {
        tracing::warn!(error = %e, "orphanage: project names unreadable");
        HashMap::new()
    })
}

/// The orphanage from items already routed.
pub(crate) fn clusters_of(pool: &DbPool, r: &Routed) -> OrphanClusters {
    let per = fleet_per_card(r);
    let median = median_ms(r);
    let names = project_names(pool);
    let mut failed = r.failed.clone();
    let archived = orphan_archive::counts_by_project(pool).unwrap_or_else(|e| {
        tracing::warn!(error = %e, "orphanage: archive counts unreadable");
        failed.push("archive".to_string());
        HashMap::new()
    });
    let mut by: BTreeMap<String, Vec<&RoutedItem>> = BTreeMap::new();
    let mut unassigned = 0u32;
    for i in r.items.iter().filter(|i| i.route.lane == Lane::Orphan) {
        match &i.input.project_id {
            Some(p) => by.entry(p.clone()).or_default().push(i),
            None => unassigned += 1,
        }
    }
    let mut clusters: Vec<OrphanCluster> = by
        .into_iter()
        .map(|(project_id, mut items)| {
            items.sort_by_key(|i| (i.created_at.as_deref().and_then(ms_of), i.id.clone()));
            let recent = items
                .iter()
                .filter(|i| {
                    matches!((i.created_at.as_deref().and_then(ms_of), median), (Some(t), Some(m)) if t > m)
                })
                .count() as u32;
            let mut kinds: BTreeMap<&str, u32> = BTreeMap::new();
            for i in &items {
                *kinds.entry(i.input.kind.wire()).or_default() += 1;
            }
            let mut kinds: Vec<OrphanKindCount> = kinds
                .into_iter()
                .map(|(kind, count)| OrphanKindCount {
                    kind: kind.to_string(),
                    count,
                })
                .collect();
            kinds.sort_by(|a, b| b.count.cmp(&a.count).then(a.kind.cmp(&b.kind)));
            let n = items.len() as u32;
            OrphanCluster {
                project_name: names.get(&project_id).cloned(),
                items: n,
                recent,
                kinds,
                item_ids: items.iter().map(|i| i.id.clone()).collect(),
                oldest_at: items.first().and_then(|i| i.created_at.clone()),
                newest_at: items.last().and_then(|i| i.created_at.clone()),
                why: why(n, recent, per),
                steward: steward_for(pool, &project_id, &items),
                archived: archived.get(&project_id).copied().unwrap_or(0),
                project_id,
            }
        })
        .collect();
    clusters.sort_by(|a, b| b.items.cmp(&a.items).then(a.project_id.cmp(&b.project_id)));
    OrphanClusters {
        clusters,
        unassigned,
        per_card: per,
        failed_sources: failed,
    }
}

/// The orphanage, read fresh.
pub(crate) fn clusters(pool: &DbPool, user_db: &UserDbPool) -> Result<OrphanClusters, AppError> {
    let r = routed(pool, user_db)?;
    Ok(clusters_of(pool, &r))
}

fn cluster(
    pool: &DbPool,
    user_db: &UserDbPool,
    project_id: &str,
) -> Result<OrphanCluster, AppError> {
    clusters(pool, user_db)?
        .clusters
        .into_iter()
        .find(|c| c.project_id == project_id)
        .ok_or_else(|| AppError::Validation(format!("Project {project_id} holds no orphans")))
}

/// The law's wire code (`large` | `growing`) as stored on the draft's origin.
fn why_code(w: personas_engine::mandate_orphans::OrphanWhy) -> Option<String> {
    serde_json::to_value(w)
        .ok()
        .and_then(|v| v.as_str().map(str::to_string))
}

fn draft_title(c: &OrphanCluster) -> String {
    // The charter-title convention of every App Master mandate.
    format!(
        "App Master {}",
        c.project_name.as_deref().unwrap_or(&c.project_id)
    )
}

/// Draft a mandate for one cluster, by the operator. `steward` overrides the
/// candidate; without either the draft is refused (a charter needs a persona).
pub(crate) fn draft(
    pool: &DbPool,
    user_db: &UserDbPool,
    project_id: &str,
    steward: Option<&str>,
) -> Result<CharterAct, AppError> {
    let c = cluster(pool, user_db, project_id)?;
    let steward_id = steward
        .map(str::to_string)
        .or_else(|| c.steward.as_ref().map(|s| s.persona_id.clone()))
        .ok_or_else(|| {
            AppError::Validation(format!(
                "No persona works on project {project_id}; name a steward to draft its mandate"
            ))
        })?;
    mandates::draft_for_orphans(
        pool,
        &OrphanDraft {
            project_id: project_id.to_string(),
            steward_persona_id: steward_id,
            title: draft_title(&c),
            orphans: c.items,
            why: c.why.and_then(why_code),
            automatic: false,
        },
        None,
    )
}

/// Adopt one cluster's project into an existing mandate.
pub(crate) fn adopt(
    pool: &DbPool,
    user_db: &UserDbPool,
    project_id: &str,
    charter_id: &str,
) -> Result<CharterAct, AppError> {
    let c = cluster(pool, user_db, project_id)?;
    mandates::adopt_project(pool, project_id, charter_id, c.items, None)
}

/// Archive every item of one cluster from the Orphans lane. Returns how many
/// were newly archived.
pub(crate) fn archive(
    pool: &DbPool,
    user_db: &UserDbPool,
    project_id: &str,
) -> Result<u32, AppError> {
    let r = routed(pool, user_db)?;
    let items: Vec<ArchiveItem> = r
        .items
        .iter()
        .filter(|i| {
            i.route.lane == Lane::Orphan && i.input.project_id.as_deref() == Some(project_id)
        })
        .map(|i| ArchiveItem {
            item_id: i.id.clone(),
            project_id: project_id.to_string(),
            item_kind: i.input.kind.wire().to_string(),
        })
        .collect();
    if items.is_empty() {
        return Err(AppError::Validation(format!(
            "Project {project_id} holds no orphans"
        )));
    }
    orphan_archive::archive(pool, &items, None)
}

/// When the operator last dropped an orphan draft of the project.
fn dropped_at(pool: &DbPool, project_id: &str) -> Option<i64> {
    let conn = pool.conn("orphanage::dropped_at").ok()?;
    let at: Option<String> = conn
        .query_row(
            "SELECT MAX(updated_at) AS at FROM persona_responsibilities
             WHERE project_id = ?1 AND source = 'athena' AND status = 'retired'",
            [project_id],
            |r| r.get("at"),
        )
        .ok()
        .flatten();
    at.as_deref().and_then(ms_of)
}

/// The sweep's half: draft one mandate per firing cluster that has a steward
/// candidate and no drop newer than its newest orphan. Bounded by
/// [`MAX_DRAFTS_PER_SWEEP`]; a refusal (the project gained a mandate since the
/// read) is not an error.
pub(crate) fn draft_sweep(pool: &DbPool, user_db: &UserDbPool) -> Vec<CharterAct> {
    let all = match clusters(pool, user_db) {
        Ok(c) => c,
        Err(e) => {
            tracing::warn!(error = %e, "orphanage: clusters unreadable; nothing drafted");
            return Vec::new();
        }
    };
    let mut out = Vec::new();
    for c in all.clusters {
        if out.len() >= MAX_DRAFTS_PER_SWEEP {
            break;
        }
        let (Some(w), Some(steward)) = (c.why, c.steward.as_ref()) else {
            continue;
        };
        if c.items < MIN_ITEMS {
            continue;
        }
        let newest = c.newest_at.as_deref().and_then(ms_of);
        if let Some(dropped) = dropped_at(pool, &c.project_id) {
            if !matches!(newest, Some(n) if n > dropped) {
                continue;
            }
        }
        let d = OrphanDraft {
            project_id: c.project_id.clone(),
            steward_persona_id: steward.persona_id.clone(),
            title: draft_title(&c),
            orphans: c.items,
            why: why_code(w),
            automatic: true,
        };
        match mandates::draft_for_orphans(pool, &d, None) {
            Ok(act) => out.push(act),
            Err(AppError::Validation(m)) => {
                tracing::debug!(project_id = %c.project_id, reason = %m, "orphanage: not drafted")
            }
            Err(e) => {
                tracing::warn!(project_id = %c.project_id, error = %e, "orphanage: draft failed")
            }
        }
    }
    out
}

#[cfg(test)]
mod tests;
