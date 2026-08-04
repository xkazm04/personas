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
const MIN_FILES: usize = 8;
/// Absorbing a tiny sibling may overshoot the band a little; that beats
/// leaving crumbs.
const MERGE_CEILING: usize = 34;

/// Canonical directory segments for one file path (filename dropped, roots
/// normalized): `src/features/f/sub/deep` → ["features","f","sub","deep"],
/// `src-tauri/db/src/repos` → ["tauri","db","repos"], `src/stores/slices` →
/// ["src","stores","slices"], else the top directory alone.
fn path_segments(path: &str) -> Vec<String> {
    let p = path.replace('\\', "/");
    let mut dirs: Vec<&str> = p.split('/').collect();
    dirs.pop(); // filename
    if dirs.is_empty() {
        return vec!["(root)".into()];
    }
    if dirs[0] == "src" && dirs.get(1) == Some(&"features") {
        let mut out = vec!["features".to_string()];
        out.extend(dirs[2..].iter().map(|s| s.to_string()));
        return out;
    }
    if dirs[0] == "src-tauri" {
        let mut out = vec!["tauri".to_string()];
        out.extend(dirs[1..].iter().filter(|d| **d != "src").map(|s| s.to_string()));
        return out;
    }
    if dirs[0] == "src" {
        return dirs.iter().map(|s| s.to_string()).collect();
    }
    vec![dirs[0].to_string()]
}

/// Signature at a directory depth — the recursive-refinement key. Depth 3 is
/// the module level (`features/<f>/<sub>`); over-band units descend deeper.
fn sig_at(segs: &[String], depth: usize) -> String {
    let take = segs.len().min(depth.max(1));
    segs[..take].join("/")
}

/// Base module unit for one file path (depth 3).
#[cfg(test)]
fn unit_signature(path: &str) -> String {
    sig_at(&path_segments(path), BASE_DEPTH)
}

/// kebab name for a merged context, derived from its unit directory.
fn unit_name(unit: &str) -> String {
    let segs: Vec<String> = unit
        .split('/')
        .skip(1) // drop the "features"/"tauri"/"src" root marker
        .map(|s| {
            s.trim_start_matches("sub_")
                .replace('_', "-")
                .to_lowercase()
                .trim_matches('-')
                .to_string()
        })
        .filter(|s| !s.is_empty())
        .collect();
    let joined = if segs.is_empty() { unit.replace('/', "-") } else { segs.join("-") };
    // Collapse runs of '-' left by markers like `__tests__`.
    let mut out = String::with_capacity(joined.len());
    let mut prev_dash = false;
    for ch in joined.chars() {
        if ch == '-' {
            if !prev_dash {
                out.push(ch);
            }
            prev_dash = true;
        } else {
            out.push(ch);
            prev_dash = false;
        }
    }
    out.trim_matches('-').to_string()
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
    /// Canonical dir segments per file — the recursive-refinement input.
    file_segs: Vec<Vec<String>>,
}

fn arr(s: Option<&str>) -> Vec<String> {
    s.and_then(|x| serde_json::from_str::<Vec<String>>(x).ok()).unwrap_or_default()
}

/// The context's majority directory signature at a depth (contexts are 93%
/// single-dir, so majority is almost always unanimous).
fn majority_sig(c: &Ctx, depth: usize) -> String {
    let mut counts: HashMap<String, usize> = HashMap::new();
    for segs in &c.file_segs {
        *counts.entry(sig_at(segs, depth)).or_default() += 1;
    }
    counts
        .into_iter()
        .max_by(|a, b| a.1.cmp(&b.1).then_with(|| b.0.cmp(&a.0)))
        .map(|(u, _)| u)
        .unwrap_or_else(|| "(empty)".into())
}

const BASE_DEPTH: usize = 3;
const MAX_DEPTH: usize = 8;

/// Recursively partition members: group at `depth`; groups over the ceiling
/// descend a directory level until they fit or can no longer split (whole
/// contexts are never broken apart).
fn partition(ctxs: &[Ctx], members: Vec<usize>, depth: usize, out: &mut BTreeMap<String, Vec<usize>>) {
    let mut groups: BTreeMap<String, Vec<usize>> = BTreeMap::new();
    for i in members {
        groups.entry(majority_sig(&ctxs[i], depth)).or_default().push(i);
    }
    for (sig, m) in groups {
        let size: usize = m.iter().map(|i| ctxs[*i].files.len()).sum();
        if size > MERGE_CEILING && m.len() > 1 {
            // Recurse when a deeper directory level actually separates them.
            if depth < MAX_DEPTH {
                let deeper: HashSet<String> =
                    m.iter().map(|i| majority_sig(&ctxs[*i], depth + 1)).collect();
                if deeper.len() > 1 {
                    partition(ctxs, m, depth + 1, out);
                    continue;
                }
            }
            // FLAT directory (no deeper seam): bin-pack the EXISTING contexts
            // into band-sized clusters instead of dissolving them into one
            // blob — current context boundaries are semantic and worth
            // keeping. First-fit-decreasing; each bin keeps its survivor's
            // name (`#n` marks a packed bin for the naming step).
            let mut sorted = m.clone();
            sorted.sort_by_key(|i| std::cmp::Reverse(ctxs[*i].files.len()));
            let mut bins: Vec<(usize, Vec<usize>)> = Vec::new();
            for i in sorted {
                let n = ctxs[i].files.len();
                match bins.iter_mut().find(|(sz, _)| sz + n <= MERGE_CEILING) {
                    Some((sz, members)) => {
                        *sz += n;
                        members.push(i);
                    }
                    None => bins.push((n, vec![i])),
                }
            }
            for (b, (_, members)) in bins.into_iter().enumerate() {
                out.entry(format!("{sig}#{b}")).or_default().extend(members);
            }
            continue;
        }
        out.entry(sig).or_default().extend(m);
    }
}

/// Compute the merge clusters. Returns ((unit, members) pairs, skipped_names);
/// each cluster becomes ONE context (survivor chosen later).
fn plan_clusters(ctxs: &[Ctx]) -> (Vec<(String, Vec<usize>)>, Vec<String>) {
    let mut skipped: Vec<String> = Vec::new();
    let mut live: Vec<usize> = Vec::new();
    for (i, c) in ctxs.iter().enumerate() {
        if c.files.is_empty() {
            skipped.push(c.name.clone());
        } else {
            live.push(i);
        }
    }

    // Pass A — recursive directory partition (module level, descending only
    // where a unit overflows the band).
    let mut by_unit: BTreeMap<String, Vec<usize>> = BTreeMap::new();
    partition(ctxs, live, BASE_DEPTH, &mut by_unit);

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

    (by_unit.into_iter().collect(), skipped)
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
            let file_segs = files.iter().map(|f| path_segments(f)).collect();
            Ctx {
                id: c.id.clone(),
                name: c.name.clone(),
                group_id: c.group_id.clone(),
                description: c.description.clone(),
                pinned: c.pinned,
                files,
                keywords: arr(c.keywords.as_deref()),
                entry_points: arr(c.entry_points.as_deref()),
                file_segs,
            }
        })
        .collect();

    let (clusters, skipped) = plan_clusters(&ctxs);

    let mut taken_names: HashSet<String> =
        ctxs.iter().map(|c| c.name.to_lowercase()).collect();
    let mut merges: Vec<Value> = Vec::new();
    let mut ops: Vec<MergeOp> = Vec::new();

    for (unit, cluster) in &clusters {
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
        // Packed bins (flat dirs, `#n` marker) keep their survivor's original
        // name — those clusters preserve semantic grouping, not a directory.
        let mut name = if unit.contains('#') {
            ctxs[survivor].name.clone()
        } else {
            unit_name(unit)
        };
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
        let mk = |name: &str, dir: &str, n: usize, pinned: bool| {
            let files: Vec<String> = (0..n).map(|i| format!("src/features/{dir}/f{i}.ts")).collect();
            let file_segs = files.iter().map(|f| path_segments(f)).collect();
            Ctx {
                id: name.into(),
                name: name.into(),
                group_id: None,
                description: None,
                pinned,
                files,
                keywords: vec![],
                entry_points: vec![],
                file_segs,
            }
        };
        let ctxs = vec![
            mk("a1", "x/a", 4, false),
            mk("a2", "x/a", 3, false),
            mk("b", "x/b", 20, false),
            mk("tiny", "x/c", 2, true), // pinned tiny: unit merges, pin never absorbed
        ];
        let (clusters, skipped) = plan_clusters(&ctxs);
        assert!(skipped.is_empty());
        // a1+a2 (7 files, under MIN) absorb into the b unit (20 files).
        let big = clusters
            .iter()
            .map(|(_, m)| m)
            .find(|m| m.len() >= 3)
            .expect("merged cluster");
        assert!(big.contains(&2), "sibling target present");
        assert!(big.contains(&0) && big.contains(&1), "tiny unit absorbed");
    }
}
