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
//!
//! `cross_refs` is the SEVENTH anchored artifact and the one that describes how
//! contexts relate to each other. It is stored by NAME, not by id, so a merge
//! orphans it two ways: an absorbed context's name stops existing, and a
//! survivor that gets a derived name orphans every inbound reference to its
//! previous name. Both are rewritten in the same transaction ([`rename_map`] +
//! [`remap_cross_refs`]); [`repair_cross_refs`] replays the same remap over
//! damage left by consolidations that ran before this existed, reading the
//! `[Consolidated …: absorbed …]` markers those runs stamped into each
//! survivor's description.
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

use serde::Serialize;
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
    /// Names of the contexts this one points at. Stored by NAME, so a merge
    /// invalidates them unless they are rewritten — see [`remap_cross_refs`].
    cross_refs: Vec<String>,
    /// Canonical dir segments per file — the recursive-refinement input.
    file_segs: Vec<Vec<String>>,
}

fn arr(s: Option<&str>) -> Vec<String> {
    s.and_then(|x| serde_json::from_str::<Vec<String>>(x).ok()).unwrap_or_default()
}

// ---------------------------------------------------------------------------
// cross_refs: the reference layer a merge orphans
// ---------------------------------------------------------------------------

/// The marker a merge stamps into the survivor's description. Written here and
/// read back by [`absorbed_from_description`] — the repair pass is only correct
/// because those two agree, so they stay adjacent.
fn consolidated_marker(absorbed_names: &[String]) -> String {
    format!(
        " [Consolidated {}: absorbed {}]",
        chrono::Utc::now().format("%Y-%m-%d"),
        absorbed_names.join(", ")
    )
}

/// Names absorbed INTO the context whose description this is, recovered from
/// every `[Consolidated <date>: absorbed a, b]` marker in it.
///
/// Descriptions are truncated to 900 chars on write, so the last marker can be
/// cut mid-list. A marker with no closing `]` is unusable and is skipped whole
/// rather than guessed at — the names it would have named simply stay
/// unresolved, which the repair reports.
fn absorbed_from_description(desc: &str) -> Vec<String> {
    const OPEN: &str = "[Consolidated ";
    let mut out: Vec<String> = Vec::new();
    let mut rest = desc;
    while let Some(i) = rest.find(OPEN) {
        let after = &rest[i + OPEN.len()..];
        let Some(close) = after.find(']') else { break };
        if let Some((_date, names)) = after[..close].split_once(": absorbed ") {
            for n in names.split(',') {
                let n = n.trim();
                if !n.is_empty() && !out.iter().any(|e| e == n) {
                    out.push(n.to_string());
                }
            }
        }
        rest = &after[close + 1..];
    }
    out
}

/// Follow a rename map to a fixpoint, so a two-step rename (`a`→`b` in one
/// merge, `b`→`c` in another) still lands on the name that is actually live.
/// Bounded and cycle-guarded: a malformed map returns the last name reached
/// instead of looping.
fn resolve_through<'a>(map: &'a HashMap<String, String>, start: &'a str) -> &'a str {
    let mut cur = start;
    let mut seen: HashSet<&str> = HashSet::new();
    for _ in 0..16 {
        if !seen.insert(cur) {
            break;
        }
        match map.get(cur) {
            Some(next) if next != cur => cur = next.as_str(),
            _ => break,
        }
    }
    cur
}

/// What a remap did to one context's refs — reported, never silent.
#[derive(Debug, Default, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemapStats {
    /// Ref instances re-pointed at a name that still exists.
    pub rewritten: u32,
    /// Refs that, after remapping, named their own owner. A context that
    /// absorbs a sibling it referenced must not end up referencing itself.
    pub self_dropped: u32,
    /// Refs the remap collapsed onto a name already in the list.
    pub deduped: u32,
}

impl RemapStats {
    fn add(&mut self, o: RemapStats) {
        self.rewritten += o.rewritten;
        self.self_dropped += o.self_dropped;
        self.deduped += o.deduped;
    }
}

/// Rewrite one context's `cross_refs` under a rename map.
///
/// - a ref naming a renamed or absorbed context becomes the survivor's current
///   name (following chains to a fixpoint),
/// - a ref that would name its own owner afterwards is dropped,
/// - duplicates the remap collapses onto one name are removed, order preserved,
/// - a ref the map says nothing about is left **exactly** as it was. A name
///   that never existed is not this function's to delete; the audit reports it
///   and [`repair_cross_refs`] names it as unresolved.
fn remap_cross_refs(
    owner: &str,
    refs: &[String],
    map: &HashMap<String, String>,
) -> (Vec<String>, RemapStats) {
    let mut out: Vec<String> = Vec::with_capacity(refs.len());
    let mut stats = RemapStats::default();
    for r in refs {
        let target = resolve_through(map, r.as_str());
        if target != r.as_str() {
            stats.rewritten += 1;
        }
        if target == owner {
            stats.self_dropped += 1;
            continue;
        }
        if out.iter().any(|e| e == target) {
            stats.deduped += 1;
            continue;
        }
        out.push(target.to_string());
    }
    (out, stats)
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
                cross_refs: arr(c.cross_refs.as_deref()),
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
        let merged_note = consolidated_marker(&absorbed_names);
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
            survivor_old_name: ctxs[survivor].name.clone(),
            absorbed_names,
            name: final_name,
            description,
            group_id,
            files,
            keywords,
            entry_points,
        });
    }

    let absorbed_total: usize = ops.iter().map(|o| o.absorbed_ids.len()).sum();
    // Say what the merge would do to the reference layer BEFORE it applies —
    // this is the number that went unreported for two days.
    let effect = project_cross_ref_effect(&ctxs, &ops);
    let mut summary = json!({
        "dryRun": dry_run,
        "before": ctxs.len(),
        "after": ctxs.len() - absorbed_total,
        "mergedClusters": ops.len(),
        "absorbed": absorbed_total,
        "skippedEmpty": skipped,
        "crossRefs": effect,
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
    /// The survivor's name BEFORE this merge. A survivor that takes a derived
    /// unit name orphans every inbound `cross_ref` to its old name even though
    /// the row itself lives — the second ghost path, and the easy one to miss.
    survivor_old_name: String,
    /// Names of the rows this merge deletes. Their inbound refs must land on
    /// the survivor, not on nothing.
    absorbed_names: Vec<String>,
    name: String,
    description: String,
    group_id: Option<String>,
    files: Vec<String>,
    keywords: Vec<String>,
    entry_points: Vec<String>,
}

/// Every context name this consolidation stops honouring, mapped to the name
/// that replaces it. Covers both ghost paths: absorbed rows (deleted) and
/// renamed survivors (alive under a new name).
fn rename_map(ops: &[MergeOp]) -> HashMap<String, String> {
    let mut map: HashMap<String, String> = HashMap::new();
    for op in ops {
        for absorbed in &op.absorbed_names {
            if *absorbed != op.name {
                map.insert(absorbed.clone(), op.name.clone());
            }
        }
        if op.survivor_old_name != op.name {
            map.insert(op.survivor_old_name.clone(), op.name.clone());
        }
    }
    map
}

/// Projected effect of a consolidation on the reference layer. Reported by the
/// dry run so an operator sees what the merge would orphan BEFORE it applies,
/// and by the real run so the rewrite is never silent.
#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct CrossRefEffect {
    /// Refs naming no existing context BEFORE the merge (pre-existing damage).
    dangling_before: u32,
    /// Refs that would name a deleted-or-renamed context if nothing rewrote
    /// them — the orphans this pass prevents.
    would_orphan: u32,
    #[serde(flatten)]
    stats: RemapStats,
    /// Contexts whose `cross_refs` list changes.
    contexts_touched: u32,
    /// Refs still naming no context afterwards. Non-zero means pre-existing
    /// damage the merge neither caused nor can fix — see `repair_cross_refs`.
    dangling_after: u32,
}

/// Compute [`CrossRefEffect`] from the in-memory plan, without touching the DB.
fn project_cross_ref_effect(ctxs: &[Ctx], ops: &[MergeOp]) -> CrossRefEffect {
    let map = rename_map(ops);
    let absorbed_ids: HashSet<&str> = ops
        .iter()
        .flat_map(|o| o.absorbed_ids.iter().map(String::as_str))
        .collect();
    let renamed: HashMap<&str, &str> = ops
        .iter()
        .map(|o| (o.survivor_id.as_str(), o.name.as_str()))
        .collect();

    let before: HashSet<&str> = ctxs.iter().map(|c| c.name.as_str()).collect();
    let after: HashSet<&str> = ctxs
        .iter()
        .filter(|c| !absorbed_ids.contains(c.id.as_str()))
        .map(|c| renamed.get(c.id.as_str()).copied().unwrap_or(c.name.as_str()))
        .collect();

    let mut eff = CrossRefEffect::default();
    for c in ctxs {
        eff.dangling_before += c.cross_refs.iter().filter(|r| !before.contains(r.as_str())).count() as u32;
        if absorbed_ids.contains(c.id.as_str()) {
            continue; // this row goes away; its refs go with it
        }
        let owner = renamed.get(c.id.as_str()).copied().unwrap_or(c.name.as_str());
        eff.would_orphan += c
            .cross_refs
            .iter()
            .filter(|r| before.contains(r.as_str()) && !after.contains(r.as_str()))
            .count() as u32;
        let (next, stats) = remap_cross_refs(owner, &c.cross_refs, &map);
        eff.stats.add(stats);
        if next != c.cross_refs {
            eff.contexts_touched += 1;
        }
        eff.dangling_after += next.iter().filter(|r| !after.contains(r.as_str())).count() as u32;
    }
    eff
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

    // The seventh anchored artifact. `cross_refs` is keyed by NAME, so every
    // absorbed name and every renamed survivor orphans its inbound references —
    // rewrite them here, inside the same transaction, reading the rows back
    // AFTER the merges so the owner names are already final.
    let map = rename_map(ops);
    let mut refs = RemapStats::default();
    let mut refs_touched = 0usize;
    if !map.is_empty() {
        let rows: Vec<(String, String, Option<String>)> = {
            let mut stmt = tx
                .prepare("SELECT id, name, cross_refs FROM dev_contexts WHERE project_id = ?1")
                .map_err(AppError::Database)?;
            let mapped = stmt
                .query_map([project_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
                .map_err(AppError::Database)?;
            mapped.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)?
        };
        for (id, name, raw) in rows {
            let current = arr(raw.as_deref());
            if current.is_empty() {
                continue;
            }
            let (next, stats) = remap_cross_refs(&name, &current, &map);
            if next == current {
                continue;
            }
            let json_refs = serde_json::to_string(&next)
                .map_err(|e| AppError::Internal(format!("serialize cross_refs: {e}")))?;
            tx.execute(
                "UPDATE dev_contexts SET cross_refs = ?1, updated_at = ?2 WHERE id = ?3",
                rusqlite::params![json_refs, now, id],
            )
            .map_err(AppError::Database)?;
            refs.add(stats);
            refs_touched += 1;
        }
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
        "crossRefsRewritten": refs.rewritten,
        "crossRefsSelfDropped": refs.self_dropped,
        "crossRefsDeduped": refs.deduped,
        "crossRefContextsTouched": refs_touched,
    }))
}

// ---------------------------------------------------------------------------
// Repair for damage left by consolidations that ran before the rewrite existed
// ---------------------------------------------------------------------------

/// Cap on the per-rewrite sample so a badly-drifted map can't return a
/// thousand-line plan. Totals are always exact; only the itemised list is cut.
const MAX_REPAIR_SAMPLE: usize = 50;

/// One `context.cross_refs` entry the repair would re-point.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CrossRefRewrite {
    /// The context holding the reference.
    pub context: String,
    /// The ghost name it currently holds.
    pub from: String,
    /// The live context the `[Consolidated]` markers resolve it to, or `null`
    /// when the remap makes it name its own owner (so it is dropped).
    pub to: Option<String>,
}

/// A ghost name that TWO different survivors claim to have absorbed. Never
/// applied: picking one silently rewires the map, and the marker is the only
/// evidence there is.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AmbiguousGhost {
    pub name: String,
    pub claimed_by: Vec<String>,
}

/// What the repair found and (only when explicitly asked) wrote.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CrossRefRepairPlan {
    pub project_id: String,
    /// True unless the caller explicitly passed `apply_changes: true`.
    pub dry_run: bool,
    pub contexts_scanned: u32,
    /// Reference instances naming no existing context, before the repair.
    pub dangling_before: u32,
    /// Distinct ghost names behind `dangling_before`.
    pub ghost_names: u32,
    #[serde(flatten)]
    pub stats: RemapStats,
    pub contexts_touched: u32,
    /// Reference instances no `[Consolidated]` marker explains — hallucinated
    /// by the generator, or absorbed by a survivor that was itself absorbed
    /// before its marker could be read. Reported, never deleted.
    pub unresolved: u32,
    pub unresolved_names: Vec<String>,
    pub ambiguous: Vec<AmbiguousGhost>,
    /// Reference instances still dangling afterwards. Equals `unresolved`.
    pub dangling_after: u32,
    /// Rows actually written. Zero on a dry run, by construction.
    pub contexts_written: u32,
    pub rewrites: Vec<CrossRefRewrite>,
    pub rewrites_omitted: u32,
}

/// Repair `cross_refs` orphaned by past consolidations.
///
/// **Dry run by default** — `apply_changes` must be `true` to write, mirroring
/// [`consolidate_contexts`]'s own `dry_run`. That is not politeness: `dev_contexts`
/// has no version column, no soft-delete and no `absorbed_from`, consolidation
/// hard-deletes, and context scans are never recorded in `dev_scans` — so a bad
/// repair cannot be rolled back from inside the app. It reports a plan; applying
/// is a separate explicit act, and it is never wired into a scan hook.
///
/// Resolution evidence is the `[Consolidated <date>: absorbed …]` marker each
/// merge stamps into the survivor's description. A ghost no marker explains is
/// listed in `unresolved_names` and left exactly as it is.
pub fn repair_cross_refs(
    pool: &DbPool,
    project_id: &str,
    apply_changes: bool,
) -> Result<CrossRefRepairPlan, AppError> {
    let ctxs = repo::list_contexts_by_project(pool, project_id, None)?;
    let live: HashSet<&str> = ctxs.iter().map(|c| c.name.as_str()).collect();

    // ghost name -> the survivors whose description claims to have absorbed it.
    let mut claims: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for c in &ctxs {
        for absorbed in absorbed_from_description(c.description.as_deref().unwrap_or("")) {
            // A name that still exists is not a ghost — a later context took it
            // back, and re-pointing refs away from a live context would be the
            // repair inventing topology.
            if live.contains(absorbed.as_str()) {
                continue;
            }
            let owners = claims.entry(absorbed).or_default();
            if !owners.contains(&c.name) {
                owners.push(c.name.clone());
            }
        }
    }

    let mut map: HashMap<String, String> = HashMap::new();
    let mut ambiguous: Vec<AmbiguousGhost> = Vec::new();
    for (ghost, owners) in claims {
        match owners.len() {
            1 => {
                map.insert(ghost, owners.into_iter().next().unwrap_or_default());
            }
            _ => ambiguous.push(AmbiguousGhost { name: ghost, claimed_by: owners }),
        }
    }

    let mut plan = CrossRefRepairPlan {
        project_id: project_id.to_string(),
        dry_run: !apply_changes,
        contexts_scanned: ctxs.len() as u32,
        dangling_before: 0,
        ghost_names: 0,
        stats: RemapStats::default(),
        contexts_touched: 0,
        unresolved: 0,
        unresolved_names: Vec::new(),
        ambiguous,
        dangling_after: 0,
        contexts_written: 0,
        rewrites: Vec::new(),
        rewrites_omitted: 0,
    };

    let mut ghosts: BTreeSet<String> = BTreeSet::new();
    let mut unresolved_names: BTreeSet<String> = BTreeSet::new();
    // (context_id, new cross_refs JSON) for the write pass.
    let mut writes: Vec<(String, String)> = Vec::new();

    for c in &ctxs {
        let current = arr(c.cross_refs.as_deref());
        if current.is_empty() {
            continue;
        }
        for r in &current {
            if !live.contains(r.as_str()) {
                plan.dangling_before += 1;
                ghosts.insert(r.clone());
                if !map.contains_key(r) {
                    plan.unresolved += 1;
                    unresolved_names.insert(r.clone());
                }
            }
        }
        let (next, stats) = remap_cross_refs(&c.name, &current, &map);
        plan.dangling_after += next.iter().filter(|r| !live.contains(r.as_str())).count() as u32;
        if next == current {
            continue;
        }
        plan.stats.add(stats);
        plan.contexts_touched += 1;
        for r in &current {
            let target = resolve_through(&map, r.as_str());
            if target == r.as_str() {
                continue;
            }
            if plan.rewrites.len() < MAX_REPAIR_SAMPLE {
                plan.rewrites.push(CrossRefRewrite {
                    context: c.name.clone(),
                    from: r.clone(),
                    to: if target == c.name { None } else { Some(target.to_string()) },
                });
            } else {
                plan.rewrites_omitted += 1;
            }
        }
        let json_refs = serde_json::to_string(&next)
            .map_err(|e| AppError::Internal(format!("serialize cross_refs: {e}")))?;
        writes.push((c.id.clone(), json_refs));
    }
    plan.ghost_names = ghosts.len() as u32;
    plan.unresolved_names = unresolved_names.into_iter().collect();

    if apply_changes && !writes.is_empty() {
        let mut conn = pool.get()?;
        let tx = conn.transaction().map_err(AppError::Database)?;
        let now = chrono::Utc::now().to_rfc3339();
        for (id, refs_json) in &writes {
            tx.execute(
                "UPDATE dev_contexts SET cross_refs = ?1, updated_at = ?2 WHERE id = ?3",
                rusqlite::params![refs_json, now, id],
            )
            .map_err(AppError::Database)?;
        }
        tx.commit().map_err(AppError::Database)?;
        plan.contexts_written = writes.len() as u32;
    }

    Ok(plan)
}

/// Tauri command: plan (and only on request, apply) the cross-ref repair.
///
/// `apply` defaults to `false`. The UI calls this twice — once to show the
/// plan, once with `apply: true` after the operator has read it — because the
/// write has no undo inside the app.
#[tauri::command]
pub async fn dev_tools_repair_cross_refs(
    state: tauri::State<'_, std::sync::Arc<crate::AppState>>,
    project_id: String,
    apply: Option<bool>,
) -> Result<CrossRefRepairPlan, AppError> {
    crate::ipc_auth::require_auth(&state).await?;
    let pool = state.db.clone();
    let apply = apply.unwrap_or(false);
    tokio::task::spawn_blocking(move || repair_cross_refs(&pool, &project_id, apply))
        .await
        .map_err(|e| AppError::Internal(format!("repair join error: {e}")))?
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
                cross_refs: vec![],
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

    // -- cross_refs: the reference layer -----------------------------------

    #[test]
    fn absorbed_names_round_trip_through_the_marker() {
        let marker = consolidated_marker(&["alpha".into(), "beta-two".into()]);
        let desc = format!("Some description.{marker}");
        assert_eq!(absorbed_from_description(&desc), vec!["alpha", "beta-two"]);
        // Repeated consolidations stack markers; all of them are readable.
        let twice = format!("{desc}{}", consolidated_marker(&["gamma".into()]));
        assert_eq!(absorbed_from_description(&twice), vec!["alpha", "beta-two", "gamma"]);
        // A marker truncated by the 900-char cap is skipped, not guessed at.
        let cut = "d [Consolidated 2026-08-01: absorbed alpha, be";
        assert!(absorbed_from_description(cut).is_empty());
        assert!(absorbed_from_description("no marker here").is_empty());
    }

    #[test]
    fn remap_drops_self_refs_and_collapses_duplicates() {
        let map: HashMap<String, String> = [
            ("old-a".to_string(), "survivor".to_string()),
            ("old-b".to_string(), "survivor".to_string()),
            ("gone".to_string(), "owner".to_string()),
        ]
        .into_iter()
        .collect();
        let refs: Vec<String> = ["old-a", "old-b", "gone", "untouched", "hallucinated"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        let (out, stats) = remap_cross_refs("owner", &refs, &map);
        assert_eq!(out, vec!["survivor", "untouched", "hallucinated"]);
        assert_eq!(stats.rewritten, 3, "old-a, old-b and gone all re-pointed");
        assert_eq!(stats.self_dropped, 1, "gone -> owner is a self-reference");
        assert_eq!(stats.deduped, 1, "old-b collapsed onto survivor");
    }

    #[test]
    fn remap_follows_a_rename_chain_to_the_live_name() {
        let map: HashMap<String, String> =
            [("a".to_string(), "b".to_string()), ("b".to_string(), "c".to_string())]
                .into_iter()
                .collect();
        let (out, _) = remap_cross_refs("owner", &["a".to_string()], &map);
        assert_eq!(out, vec!["c"]);
        // A cycle terminates instead of hanging.
        let cyclic: HashMap<String, String> =
            [("x".to_string(), "y".to_string()), ("y".to_string(), "x".to_string())]
                .into_iter()
                .collect();
        let (cy, _) = remap_cross_refs("owner", &["x".to_string()], &cyclic);
        assert_eq!(cy.len(), 1);
    }

    // -- DB-backed: the invariant the suite never had ------------------------

    fn seed_project(pool: &DbPool, project_id: &str) {
        let conn = pool.get().unwrap();
        conn.execute(
            "INSERT INTO dev_projects (id, name, root_path) VALUES (?1, ?2, ?3)",
            rusqlite::params![project_id, "t", format!("C:/tmp/{project_id}")],
        )
        .unwrap();
    }

    /// Insert a context with `n` files under `src/features/<dir>/`.
    fn seed_ctx(pool: &DbPool, project_id: &str, name: &str, dir: &str, n: usize, refs: &[&str]) {
        let files: Vec<String> = (0..n).map(|i| format!("src/features/{dir}/f{i}.ts")).collect();
        let conn = pool.get().unwrap();
        conn.execute(
            "INSERT INTO dev_contexts (id, project_id, name, description, file_paths, cross_refs)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![
                format!("id-{name}"),
                project_id,
                name,
                format!("context {name}"),
                serde_json::to_string(&files).unwrap(),
                serde_json::to_string(refs).unwrap(),
            ],
        )
        .unwrap();
    }

    fn read_contexts(pool: &DbPool, project_id: &str) -> Vec<(String, Vec<String>)> {
        let conn = pool.get().unwrap();
        let mut stmt = conn
            .prepare("SELECT name, cross_refs FROM dev_contexts WHERE project_id = ?1 ORDER BY name")
            .unwrap();
        let rows = stmt
            .query_map([project_id], |r| {
                let name: String = r.get(0)?;
                let refs: Option<String> = r.get(1)?;
                Ok((name, arr(refs.as_deref())))
            })
            .unwrap();
        rows.map(|r| r.unwrap()).collect()
    }

    /// THE invariant: after a consolidation, no surviving context references a
    /// name that does not exist. Asserted against a map whose references all
    /// resolve beforehand, so any dangling reference afterwards was created by
    /// the merge — which is exactly the failure that cost the shipped map its
    /// entire topology layer.
    #[test]
    fn consolidation_never_orphans_a_cross_ref() {
        let pool = crate::db::init_test_db().unwrap();
        let pid = "p-invariant";
        seed_project(&pool, pid);
        // `x/a` (two tiny contexts) is under MIN_FILES and absorbs into `x/b`;
        // the survivor is also renamed to the derived unit name.
        seed_ctx(&pool, pid, "alpha-one", "x/a", 4, &["alpha-two", "bravo"]);
        seed_ctx(&pool, pid, "alpha-two", "x/a", 3, &["bravo"]);
        seed_ctx(&pool, pid, "bravo", "x/b", 20, &["alpha-one", "alpha-two"]);
        seed_ctx(&pool, pid, "onlooker", "y/z", 9, &["alpha-one", "bravo"]);

        let before = read_contexts(&pool, pid);
        let live_before: HashSet<String> = before.iter().map(|(n, _)| n.clone()).collect();
        assert!(
            before.iter().all(|(_, refs)| refs.iter().all(|r| live_before.contains(r))),
            "fixture precondition: every reference resolves before the merge"
        );

        let summary = consolidate_contexts(&pool, pid, false).unwrap();
        assert!(summary["absorbed"].as_u64().unwrap() > 0, "the fixture must actually merge");

        let after = read_contexts(&pool, pid);
        let live: HashSet<String> = after.iter().map(|(n, _)| n.clone()).collect();
        for (name, refs) in &after {
            for r in refs {
                assert!(
                    live.contains(r),
                    "context {name} references {r}, which no longer exists (live: {live:?})"
                );
                assert_ne!(r, name, "context {name} references itself");
            }
        }
        // And the rewrite is reported, not silent.
        assert!(
            summary["repoints"]["crossRefsRewritten"].as_u64().unwrap() > 0,
            "summary must report the cross_ref rewrite: {summary}"
        );
    }

    /// The second ghost path: a survivor that KEEPS its row but takes a derived
    /// name orphans every inbound reference to its previous name.
    #[test]
    fn renaming_a_survivor_rewrites_inbound_refs_to_its_old_name() {
        let pool = crate::db::init_test_db().unwrap();
        let pid = "p-rename";
        seed_project(&pool, pid);
        seed_ctx(&pool, pid, "big-one", "x/b", 20, &[]);
        seed_ctx(&pool, pid, "small-one", "x/b", 4, &[]);
        // An unrelated context points at the survivor by its CURRENT name.
        seed_ctx(&pool, pid, "onlooker", "y/z", 9, &["big-one"]);

        consolidate_contexts(&pool, pid, false).unwrap();
        let after = read_contexts(&pool, pid);
        let live: HashSet<String> = after.iter().map(|(n, _)| n.clone()).collect();
        assert!(!live.contains("big-one"), "the survivor took the derived unit name");
        let (_, refs) = after.iter().find(|(n, _)| n == "onlooker").expect("onlooker survives");
        assert_eq!(refs.len(), 1);
        assert!(live.contains(&refs[0]), "inbound ref followed the rename: {refs:?}");
    }

    #[test]
    fn dry_run_reports_the_orphans_it_would_cause_and_writes_nothing() {
        let pool = crate::db::init_test_db().unwrap();
        let pid = "p-dry";
        seed_project(&pool, pid);
        seed_ctx(&pool, pid, "alpha-one", "x/a", 4, &[]);
        seed_ctx(&pool, pid, "alpha-two", "x/a", 3, &[]);
        seed_ctx(&pool, pid, "bravo", "x/b", 20, &[]);
        seed_ctx(&pool, pid, "onlooker", "y/z", 9, &["alpha-one", "alpha-two"]);

        let plan = consolidate_contexts(&pool, pid, true).unwrap();
        assert!(
            plan["crossRefs"]["wouldOrphan"].as_u64().unwrap() >= 2,
            "dry run must say what it would orphan BEFORE applying: {plan}"
        );
        assert_eq!(plan["crossRefs"]["danglingBefore"].as_u64().unwrap(), 0);
        assert_eq!(read_contexts(&pool, pid).len(), 4, "dry run wrote nothing");
    }

    // -- the repair for damage that predates the rewrite ---------------------

    #[test]
    fn repair_resolves_ghosts_via_markers_and_reports_the_rest() {
        let pool = crate::db::init_test_db().unwrap();
        let pid = "p-repair";
        seed_project(&pool, pid);
        seed_ctx(&pool, pid, "survivor", "x/b", 12, &["ghost-a", "hallucination", "onlooker"]);
        seed_ctx(&pool, pid, "onlooker", "y/z", 9, &["ghost-a", "ghost-b"]);
        // Stamp the markers a past consolidation would have written.
        {
            let conn = pool.get().unwrap();
            conn.execute(
                "UPDATE dev_contexts SET description = ?1 WHERE name = 'survivor'",
                [format!("base{}", consolidated_marker(&["ghost-a".into(), "ghost-b".into()]))],
            )
            .unwrap();
        }

        let dry = repair_cross_refs(&pool, pid, false).unwrap();
        assert!(dry.dry_run);
        assert_eq!(dry.dangling_before, 4, "ghost-a x2 + ghost-b + hallucination");
        assert_eq!(dry.ghost_names, 3, "distinct ghosts: ghost-a, ghost-b, hallucination");
        assert_eq!(dry.unresolved, 1);
        assert_eq!(dry.unresolved_names, vec!["hallucination".to_string()]);
        assert_eq!(dry.contexts_written, 0, "dry run is the default and writes nothing");
        assert_eq!(read_contexts(&pool, pid)[1].1.len(), 3, "survivor untouched by the dry run");

        let applied = repair_cross_refs(&pool, pid, true).unwrap();
        assert_eq!(applied.contexts_written, 2);
        assert_eq!(applied.stats.self_dropped, 1, "survivor's ref to ghost-a is now itself");
        let after = read_contexts(&pool, pid);
        let live: HashSet<String> = after.iter().map(|(n, _)| n.clone()).collect();
        for (name, refs) in &after {
            for r in refs {
                assert_ne!(r, name, "{name} references itself");
            }
        }
        // The hallucination is REPORTED, never deleted.
        let (_, survivor_refs) = after.iter().find(|(n, _)| n == "survivor").unwrap();
        assert!(survivor_refs.contains(&"hallucination".to_string()));
        assert!(!live.contains("ghost-a"));
        // ...and re-running finds nothing left to fix beyond that residue.
        let again = repair_cross_refs(&pool, pid, false).unwrap();
        assert_eq!(again.contexts_touched, 0);
        assert_eq!(again.dangling_before, 1);
        assert_eq!(again.unresolved, 1);
    }

    /// Dry-run the repair against a REAL `personas.db`, for verifying a fix
    /// against actual damage rather than a fixture. Ignored by default — it
    /// needs a database this machine may not have. Read-only: `apply_changes`
    /// is hard-coded `false`, so pointing it at a live DB cannot mutate it.
    ///
    /// ```text
    /// PERSONAS_MAP_DB=<path to personas.db> PERSONAS_MAP_PROJECT=<project id> \
    ///   node scripts/build/run-rust-tests.mjs -- --ignored --nocapture repair_dry_run_against_a_real_map
    /// ```
    #[test]
    #[ignore = "needs PERSONAS_MAP_DB + PERSONAS_MAP_PROJECT"]
    fn repair_dry_run_against_a_real_map() {
        let Ok(path) = std::env::var("PERSONAS_MAP_DB") else { return };
        let project_id = std::env::var("PERSONAS_MAP_PROJECT").expect("PERSONAS_MAP_PROJECT");
        let pool = crate::db::open_pool_at(std::path::Path::new(&path)).expect("open db");
        let plan = repair_cross_refs(&pool, &project_id, false).expect("repair");
        println!("{}", serde_json::to_string_pretty(&plan).unwrap());
        assert!(plan.dry_run, "this harness must never write");
        assert_eq!(plan.contexts_written, 0);
    }

    #[test]
    fn repair_refuses_to_guess_an_ambiguous_ghost() {
        let pool = crate::db::init_test_db().unwrap();
        let pid = "p-ambig";
        seed_project(&pool, pid);
        seed_ctx(&pool, pid, "one", "x/a", 9, &["ghost"]);
        seed_ctx(&pool, pid, "two", "x/b", 9, &[]);
        {
            let conn = pool.get().unwrap();
            let marker = consolidated_marker(&["ghost".into()]);
            conn.execute("UPDATE dev_contexts SET description = ?1 WHERE name IN ('one','two')", [marker])
                .unwrap();
        }
        let plan = repair_cross_refs(&pool, pid, true).unwrap();
        assert_eq!(plan.ambiguous.len(), 1);
        assert_eq!(plan.ambiguous[0].claimed_by.len(), 2);
        assert_eq!(plan.contexts_written, 0, "an ambiguous ghost is reported, never guessed");
        assert_eq!(plan.unresolved, 1);
    }
}
