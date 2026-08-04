//! Deterministic context consolidation — merge micro-contexts into the
//! 10-30-file granularity band WITHOUT rescanning.
//!
//! The 2026-08 map converged at 769 contexts averaging 5.4 files (the old
//! scan prompt asked for 5-15). A delete-and-rescan would orphan everything
//! anchored to context ids — dev_kpis (FK SET NULL), dev_use_case_contexts
//! (FK CASCADE), dev_ideas / dev_goals / memory_nodes (nulled or dangling).
//! This pass instead MERGES existing contexts in place: contexts are grouped
//! into module-directory units (93% of contexts already sit in exactly one),
//! tiny units are absorbed into siblings, one survivor per unit keeps its id,
//! and every anchored artifact is re-pointed to the survivor before the
//! absorbed rows are deleted. No LLM, one transaction, dry-run first.
//!
//! Pinned contexts are never absorbed (they may still RECEIVE merges).
use std::collections::{BTreeMap, HashMap, HashSet};

use serde_json::{json, Value};

use crate::db::repos::dev_tools as repo;
use crate::db::DbPool;
use crate::error::AppError;

/// Band + merge thresholds (mirror the scan prompts and
/// scripts/context/check-granularity.mjs).
const MAX_FILES: usize = 30;
const MIN_FILES: usize = 8;
/// Absorbing a tiny sibling may overshoot the band a little; that beats
/// leaving crumbs.
const MERGE_CEILING: usize = 34;

/// Module-directory unit for one file path (mirrors the JS simulation that
/// validated the band): `src/features/<f>/<sub>`, `src-tauri` crate/module,
/// `src/<layer>/<dir>`, else the top directory.
fn unit_signature(path: &str) -> String {
    let p = path.replace('\\', "/");
    let mut dirs: Vec<&str> = p.split('/').collect();
    dirs.pop(); // filename
    if dirs.is_empty() {
        return "(root)".into();
    }
    if dirs[0] == "src" && dirs.get(1) == Some(&"features") {
        return match (dirs.get(2), dirs.get(3)) {
            (Some(f), Some(sub)) => format!("features/{f}/{sub}"),
            (Some(f), None) => format!("features/{f}"),
            _ => "src/features".into(),
        };
    }
    if dirs[0] == "src-tauri" {
        let meaningful: Vec<&str> = dirs[1..].iter().filter(|d| **d != "src").copied().collect();
        let take = meaningful.len().min(2);
        if take == 0 {
            return "tauri".into();
        }
        return format!("tauri/{}", meaningful[..take].join("/"));
    }
    if dirs[0] == "src" {
        let take = dirs.len().min(3);
        return dirs[..take].join("/");
    }
    dirs[0].to_string()
}

/// kebab name for a merged context, derived from its unit directory.
fn unit_name(unit: &str) -> String {
    let segs: Vec<String> = unit
        .split('/')
        .skip(1) // drop the "features"/"tauri"/"src" root marker
        .map(|s| s.trim_start_matches("sub_").replace('_', "-").to_lowercase())
        .filter(|s| !s.is_empty())
        .collect();
    if segs.is_empty() {
        unit.replace('/', "-")
    } else {
        segs.join("-")
    }
}

struct Ctx {
    id: String,
    name: String,
    group_id: Option<String>,
    description: Option<String>,
    pinned: bool,
    files: Vec<String>,
    keywords: Vec<String>,
    entry_points: Vec<String>,
    unit: String,
}

fn arr(s: Option<&str>) -> Vec<String> {
    s.and_then(|x| serde_json::from_str::<Vec<String>>(x).ok()).unwrap_or_default()
}

/// Compute the merge clusters. Returns (clusters, skipped_names); each cluster
/// is the indices of contexts that become ONE context (survivor chosen later).
fn plan_clusters(ctxs: &[Ctx]) -> (Vec<Vec<usize>>, Vec<String>) {
    // Pass A — group contexts by their majority unit.
    let mut by_unit: BTreeMap<String, Vec<usize>> = BTreeMap::new();
    let mut skipped: Vec<String> = Vec::new();
    for (i, c) in ctxs.iter().enumerate() {
        if c.files.is_empty() {
            skipped.push(c.name.clone());
            continue;
        }
        by_unit.entry(c.unit.clone()).or_default().push(i);
    }

    // Pass B — absorb units still under MIN_FILES into a sibling unit (same
    // parent directory), preferring the largest sibling that stays under the
    // ceiling. Isolated leaves (no sibling) stay as they are.
    let unit_size = |members: &[usize]| -> usize { members.iter().map(|i| ctxs[*i].files.len()).sum() };
    let units: Vec<String> = by_unit.keys().cloned().collect();
    for unit in units {
        let size = unit_size(&by_unit[&unit]);
        if size >= MIN_FILES {
            continue;
        }
        let Some((parent, _leaf)) = unit.rsplit_once('/') else { continue };
        let target = by_unit
            .iter()
            .filter(|(u, m)| {
                *u != &unit
                    && u.rsplit_once('/').map(|(p, _)| p) == Some(parent)
                    && unit_size(m) + size <= MERGE_CEILING
            })
            .max_by_key(|(_, m)| unit_size(m))
            .map(|(u, _)| u.clone());
        if let Some(t) = target {
            let members = by_unit.remove(&unit).unwrap_or_default();
            by_unit.entry(t).or_default().extend(members);
        }
    }

    (by_unit.into_values().collect(), skipped)
}

/// Run the consolidation. `dry_run` computes and returns the plan without
/// touching the database.
pub fn consolidate_contexts(
    pool: &DbPool,
    project_id: &str,
    dry_run: bool,
) -> Result<Value, AppError> {
    let raw = repo::list_contexts_by_project(pool, project_id, None)?;
    let ctxs: Vec<Ctx> = raw
        .iter()
        .map(|c| {
            let files = arr(Some(c.file_paths.as_str()));
            // Majority unit over the context's files (93% have exactly one).
            let mut counts: HashMap<String, usize> = HashMap::new();
            for f in &files {
                *counts.entry(unit_signature(f)).or_default() += 1;
            }
            let unit = counts
                .into_iter()
                .max_by(|a, b| a.1.cmp(&b.1).then_with(|| b.0.cmp(&a.0)))
                .map(|(u, _)| u)
                .unwrap_or_else(|| "(empty)".into());
            Ctx {
                id: c.id.clone(),
                name: c.name.clone(),
                group_id: c.group_id.clone(),
                description: c.description.clone(),
                pinned: c.pinned,
                files,
                keywords: arr(c.keywords.as_deref()),
                entry_points: arr(c.entry_points.as_deref()),
                unit,
            }
        })
        .collect();

    let (clusters, skipped) = plan_clusters(&ctxs);

    let mut taken_names: HashSet<String> =
        ctxs.iter().map(|c| c.name.to_lowercase()).collect();
    let mut merges: Vec<Value> = Vec::new();
    let mut ops: Vec<MergeOp> = Vec::new();

    for cluster in &clusters {
        if cluster.len() < 2 {
            continue;
        }
        // Survivor: pinned wins, then the most files, then oldest position in
        // the list (stable order from the DB query).
        let survivor = *cluster
            .iter()
            .max_by_key(|i| (ctxs[**i].pinned, ctxs[**i].files.len()))
            .unwrap();
        let absorbed: Vec<usize> = cluster
            .iter()
            .copied()
            .filter(|i| *i != survivor && !ctxs[*i].pinned)
            .collect();
        if absorbed.is_empty() {
            continue;
        }
        let unit = &ctxs[survivor].unit;
        let mut name = unit_name(unit);
        // Keep the survivor's own name when the derived one is taken by an
        // unrelated context.
        let final_name = if taken_names.contains(&name.to_lowercase())
            && !cluster.iter().any(|i| ctxs[*i].name.to_lowercase() == name.to_lowercase())
        {
            name = ctxs[survivor].name.clone();
            name
        } else {
            name
        };
        taken_names.insert(final_name.to_lowercase());

        let mut files: Vec<String> = Vec::new();
        let mut keywords: Vec<String> = Vec::new();
        let mut entry_points: Vec<String> = Vec::new();
        let mut absorbed_names: Vec<String> = Vec::new();
        for &i in std::iter::once(&survivor).chain(absorbed.iter()) {
            for f in &ctxs[i].files {
                if !files.contains(f) {
                    files.push(f.clone());
                }
            }
            for k in &ctxs[i].keywords {
                if keywords.len() < 12 && !keywords.contains(k) {
                    keywords.push(k.clone());
                }
            }
            for e in &ctxs[i].entry_points {
                if entry_points.len() < 3 && !entry_points.contains(e) {
                    entry_points.push(e.clone());
                }
            }
            if i != survivor {
                absorbed_names.push(ctxs[i].name.clone());
            }
        }
        // Majority group across the cluster.
        let mut group_votes: HashMap<Option<String>, usize> = HashMap::new();
        for &i in std::iter::once(&survivor).chain(absorbed.iter()) {
            *group_votes.entry(ctxs[i].group_id.clone()).or_default() += ctxs[i].files.len();
        }
        let group_id = group_votes
            .into_iter()
            .max_by_key(|(_, n)| *n)
            .and_then(|(g, _)| g);

        let base_desc = ctxs[survivor].description.clone().unwrap_or_default();
        let merged_note = format!(
            " [Consolidated {}: absorbed {}]",
            chrono::Utc::now().format("%Y-%m-%d"),
            absorbed_names.join(", ")
        );
        let description: String = {
            let mut d = base_desc;
            d.push_str(&merged_note);
            d.chars().take(900).collect()
        };

        merges.push(json!({
            "unit": unit,
            "name": final_name,
            "survivor": ctxs[survivor].name,
            "absorbed": absorbed_names,
            "files": files.len(),
        }));
        ops.push(MergeOp {
            survivor_id: ctxs[survivor].id.clone(),
            absorbed_ids: absorbed.iter().map(|i| ctxs[*i].id.clone()).collect(),
            name: final_name,
            description,
            group_id,
            files,
            keywords,
            entry_points,
        });
    }

    let absorbed_total: usize = ops.iter().map(|o| o.absorbed_ids.len()).sum();
    let mut summary = json!({
        "dryRun": dry_run,
        "before": ctxs.len(),
        "after": ctxs.len() - absorbed_total,
        "mergedClusters": ops.len(),
        "absorbed": absorbed_total,
        "skippedEmpty": skipped,
        "merges": merges,
    });

    if dry_run {
        return Ok(summary);
    }

    let repoints = apply(pool, project_id, &ops)?;
    summary["repoints"] = repoints;
    Ok(summary)
}

struct MergeOp {
    survivor_id: String,
    absorbed_ids: Vec<String>,
    name: String,
    description: String,
    group_id: Option<String>,
    files: Vec<String>,
    keywords: Vec<String>,
    entry_points: Vec<String>,
}

/// Re-point every anchored artifact, update survivors, delete absorbed rows —
/// one transaction, so a failure leaves the map untouched.
fn apply(pool: &DbPool, project_id: &str, ops: &[MergeOp]) -> Result<Value, AppError> {
    let mut conn = pool.get()?;
    let tx = conn.transaction().map_err(AppError::Database)?;
    let now = chrono::Utc::now().to_rfc3339();
    let mut counts: HashMap<&'static str, usize> = HashMap::new();

    for op in ops {
        let files_json = serde_json::to_string(&op.files)
            .map_err(|e| AppError::Internal(format!("serialize file_paths: {e}")))?;
        let kw_json = serde_json::to_string(&op.keywords)
            .map_err(|e| AppError::Internal(format!("serialize keywords: {e}")))?;
        let ep_json = serde_json::to_string(&op.entry_points)
            .map_err(|e| AppError::Internal(format!("serialize entry_points: {e}")))?;
        tx.execute(
            "UPDATE dev_contexts SET name = ?1, description = ?2, file_paths = ?3,
                    keywords = ?4, entry_points = ?5, group_id = ?6, updated_at = ?7
              WHERE id = ?8",
            rusqlite::params![
                op.name,
                op.description,
                files_json,
                kw_json,
                ep_json,
                op.group_id,
                now,
                op.survivor_id
            ],
        )
        .map_err(AppError::Database)?;

        for old in &op.absorbed_ids {
            let s = &op.survivor_id;
            let mut bump = |key: &'static str, n: usize| *counts.entry(key).or_default() += n;
            bump("kpis", tx.execute("UPDATE dev_kpis SET context_id = ?1 WHERE context_id = ?2", [s, old]).map_err(AppError::Database)?);
            bump("ideas", tx.execute("UPDATE dev_ideas SET context_id = ?1 WHERE context_id = ?2", [s, old]).map_err(AppError::Database)?);
            bump("goals", tx.execute("UPDATE dev_goals SET context_id = ?1 WHERE context_id = ?2", [s, old]).map_err(AppError::Database)?);
            bump("memoryNodes", tx.execute("UPDATE memory_nodes SET context_id = ?1 WHERE context_id = ?2", [s, old]).map_err(AppError::Database)?);
            bump("useCasePrimary", tx.execute("UPDATE dev_use_cases SET primary_context_id = ?1 WHERE primary_context_id = ?2", [s, old]).map_err(AppError::Database)?);
            // Membership: move rows unless the survivor is already a member.
            bump("useCaseSlices", tx.execute(
                "INSERT OR IGNORE INTO dev_use_case_contexts (use_case_id, context_id)
                 SELECT use_case_id, ?1 FROM dev_use_case_contexts WHERE context_id = ?2",
                [s, old],
            ).map_err(AppError::Database)?);
            tx.execute("DELETE FROM dev_use_case_contexts WHERE context_id = ?1", [old]).map_err(AppError::Database)?;
            // Fingerprints are a per-file-list cache — stale either way.
            tx.execute("DELETE FROM dev_context_fingerprints WHERE context_id = ?1", [old]).map_err(AppError::Database)?;
            bump("deleted", tx.execute("DELETE FROM dev_contexts WHERE id = ?1", [old]).map_err(AppError::Database)?);
        }
        // Survivor's fingerprint no longer matches its widened file list.
        tx.execute("DELETE FROM dev_context_fingerprints WHERE context_id = ?1", [&op.survivor_id]).map_err(AppError::Database)?;
    }

    // Groups left empty by the merges disappear.
    let emptied = tx
        .execute(
            "DELETE FROM dev_context_groups WHERE project_id = ?1 AND id NOT IN (
               SELECT DISTINCT group_id FROM dev_contexts
                WHERE project_id = ?1 AND group_id IS NOT NULL)",
            [project_id],
        )
        .map_err(AppError::Database)?;
    tx.commit().map_err(AppError::Database)?;

    Ok(json!({
        "kpis": counts.get("kpis").copied().unwrap_or(0),
        "ideas": counts.get("ideas").copied().unwrap_or(0),
        "goals": counts.get("goals").copied().unwrap_or(0),
        "memoryNodes": counts.get("memoryNodes").copied().unwrap_or(0),
        "useCasePrimary": counts.get("useCasePrimary").copied().unwrap_or(0),
        "useCaseSlices": counts.get("useCaseSlices").copied().unwrap_or(0),
        "contextsDeleted": counts.get("deleted").copied().unwrap_or(0),
        "groupsDeleted": emptied,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unit_signature_maps_the_repo_shapes() {
        assert_eq!(unit_signature("src/features/plugins/artist/Viewer.tsx"), "features/plugins/artist");
        assert_eq!(unit_signature("src/features/vault/VaultPage.tsx"), "features/vault");
        assert_eq!(unit_signature("src-tauri/db/src/repos/dev_tools.rs"), "tauri/db/repos");
        assert_eq!(unit_signature("src-tauri/src/commands/infrastructure/x.rs"), "tauri/commands/infrastructure");
        assert_eq!(unit_signature("src/stores/slices/system/fleetSlice.ts"), "src/stores/slices");
        assert_eq!(unit_signature("scripts/i18n/gen-types.mjs"), "scripts");
    }

    #[test]
    fn unit_name_strips_markers() {
        assert_eq!(unit_name("features/teams/sub_factory"), "teams-factory");
        assert_eq!(unit_name("tauri/db/repos"), "db-repos");
        assert_eq!(unit_name("src/stores/slices"), "stores-slices");
    }

    #[test]
    fn tiny_units_absorb_into_siblings_and_pins_survive() {
        let mk = |name: &str, unit: &str, n: usize, pinned: bool| Ctx {
            id: name.into(),
            name: name.into(),
            group_id: None,
            description: None,
            pinned,
            files: (0..n).map(|i| format!("{unit}/f{i}.ts")).collect(),
            keywords: vec![],
            entry_points: vec![],
            unit: unit.into(),
        };
        let ctxs = vec![
            mk("a1", "features/x/a", 4, false),
            mk("a2", "features/x/a", 3, false),
            mk("b", "features/x/b", 20, false),
            mk("tiny", "features/x/c", 2, true), // pinned tiny: unit merges, pin never absorbed
        ];
        let (clusters, skipped) = plan_clusters(&ctxs);
        assert!(skipped.is_empty());
        // a1+a2 (7 files, under MIN) absorb into the b unit (20 files).
        let big = clusters.iter().find(|c| c.len() >= 3).expect("merged cluster");
        assert!(big.contains(&2), "sibling target present");
        assert!(big.contains(&0) && big.contains(&1), "tiny unit absorbed");
    }
}
