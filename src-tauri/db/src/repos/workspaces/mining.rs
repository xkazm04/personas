use crate::DbPool;
use personas_core::error::AppError;
use std::collections::HashMap;

use super::ingest::KnowledgeCandidate;
use super::practice_ideas::PRACTICE_ORIGIN;

/// Workspace member projects (id + tech_stack), the "siblings" a miner
/// compares across. Empty when the workspace has no members.
fn workspace_members(
    pool: &DbPool,
    workspace_id: &str,
) -> Result<Vec<(String, Option<String>)>, AppError> {
    let conn = pool.get()?;
    let rows = crate::repos::dev::projects::workspace_members_with_tech_stack(&conn, workspace_id)?;
    Ok(rows)
}

/// A live finding row read for cross-project mining.
pub(super) struct MinedFinding {
    pub(super) project_id: String,
    pub(super) origin: String,
    pub(super) dedup_key: Option<String>,
    pub(super) title: String,
}

/// Miner A — cross-project shared findings. Groups the workspace members' live
/// `dev_ideas` (pending/accepted, with an `origin` sensor tag) by a
/// project-agnostic identity and, where a group spans ≥2 distinct members,
/// proposes it as a shared `pitfall`. Identity = `(origin, dedup_key)` for
/// project-agnostic keys, falling back to `(origin, normalized-title)` so
/// repo-local keys (sentry ids, context-scoped scans) still cluster.
pub fn mine_shared_findings(
    pool: &DbPool,
    workspace_id: &str,
) -> Result<Vec<KnowledgeCandidate>, AppError> {
    let members = workspace_members(pool, workspace_id)?;
    if members.len() < 2 {
        return Ok(Vec::new());
    }
    let member_ids: Vec<String> = members.iter().map(|(id, _)| id.clone()).collect();

    let conn = pool.get()?;
    let placeholders = member_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!(
        // LOOP PREVENTION (non-negotiable — plan 1C): a `workspace_practice`
        // idea IS this workspace's own adopted practice, fanned out to every
        // member repo. Mining it back would cluster N copies of one practice
        // into a "shared finding" and re-propose the practice as a new
        // candidate — an echo chamber that grows on every miner run. The
        // sensors mine reality; the library is not reality.
        // FOREIGN TABLE: dev_ideas is owned by `repos::dev::ideas`.
        "SELECT project_id, origin, dedup_key, title FROM dev_ideas
         WHERE project_id IN ({placeholders})
           AND origin IS NOT NULL
           AND origin != '{PRACTICE_ORIGIN}'
           AND status IN ('pending','accepted')"
    );
    let mut stmt = conn.prepare(&sql)?;
    let params_vec: Vec<&dyn rusqlite::types::ToSql> = member_ids
        .iter()
        .map(|s| s as &dyn rusqlite::types::ToSql)
        .collect();
    let findings: Vec<MinedFinding> = stmt
        .query_map(params_vec.as_slice(), |r| {
            Ok(MinedFinding {
                project_id: r.get(0)?,
                origin: r.get(1)?,
                dedup_key: r.get(2)?,
                title: r.get(3)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(cluster_shared_findings(&findings))
}

/// Pure clustering core (testable without a DB): bucket findings by identity,
/// keep buckets spanning ≥2 distinct projects, emit one candidate each.
pub(super) fn cluster_shared_findings(findings: &[MinedFinding]) -> Vec<KnowledgeCandidate> {
    // identity key → (representative title, origin, set of project ids)
    let mut buckets: HashMap<String, (String, String, std::collections::BTreeSet<String>)> =
        HashMap::new();
    for f in findings {
        // Second gate for the same echo the SQL above already blocks. The
        // clustering core is pure and independently callable, so the guard
        // lives here too — a future caller that assembles findings by another
        // route must not be able to reopen the loop.
        if f.origin == PRACTICE_ORIGIN {
            continue;
        }
        let identity = match f.dedup_key.as_deref() {
            Some(k) if is_project_agnostic_key(k) => format!("{}|{}", f.origin, k),
            _ => format!(
                "{}|title:{}",
                f.origin,
                crate::repos::dev_tools::normalize_idea_title(&f.title)
            ),
        };
        let entry = buckets.entry(identity).or_insert_with(|| {
            (
                f.title.clone(),
                f.origin.clone(),
                std::collections::BTreeSet::new(),
            )
        });
        entry.2.insert(f.project_id.clone());
    }

    let mut out: Vec<(String, KnowledgeCandidate)> = Vec::new();
    for (identity, (title, origin, projects)) in buckets {
        if projects.len() < 2 {
            continue;
        }
        let n = projects.len();
        let confidence = (0.5 + 0.15 * (n as f64 - 2.0)).min(0.95);
        out.push((
            identity.clone(),
            KnowledgeCandidate {
                // Not produced by a territory scan (miner / divergence pass).
                harvest_scope: None,
                kind: "pitfall".into(),
                title: format!("Shared finding: {title}"),
                statement: format!(
                    "{n} projects in this workspace raised the same {origin} finding — \"{title}\". A recurring issue across the portfolio is worth a workspace-level practice."
                ),
                detail_md: None,
                topic: Some(finding_topic(&origin)),
                abstraction: Some("meso".into()),
                ftype: Some("data-flow".into()),
                durability: Some("durable".into()),
                governing_id: None,
                evidence_count: Some(n as i64),
                applicability: None,
                origin_project_id: None,
                dedup_key: Some(format!("miner:findings:{identity}")),
                confidence: Some(confidence),
                extends: None,
                layer: None,
                evidence: Vec::new(),
            },
        ));
    }
    // Deterministic order (BTree of projects already sorts members; sort output
    // by dedup_key so the ingest order — and any test — is stable).
    out.sort_by(|a, b| a.0.cmp(&b.0));
    out.into_iter().map(|(_, c)| c).collect()
}

/// Findings whose `dedup_key` is derived from a project-agnostic identifier
/// (standards rule keys, kpi_sim signals, whole-project static scans) carry the
/// SAME key in every repo, so key-equality is a safe cross-project match.
/// Repo-local keys (`sentry:<id>`, context-scoped `scan:<type>:<ctxid>:…`) are
/// matched on normalized title instead.
pub(super) fn is_project_agnostic_key(key: &str) -> bool {
    key.starts_with("standards:")
        || key.starts_with("kpi_sim:")
        || key.starts_with("scan:") && key.contains(":all:")
}

/// Coarse topic path for a finding origin, so shared findings slot into the
/// library tree instead of landing uncategorized.
///
/// These are the miners' contribution to the taxonomy in
/// [`workspace_taxonomy`](super::workspace_taxonomy) and must stay inside it —
/// the miners used to emit a third private vocabulary (`code-quality/…`,
/// `cost/…`, `reliability/…`, `product/…`) that overlapped neither the agents'
/// paths nor each other. An unrecognized origin quarantines rather than guesses.
fn finding_topic(origin: &str) -> String {
    match origin {
        "standards_finding" => "process/enforcement",
        "llm_cost" => "billing/limits",
        "sentry_spike" => "observability/diagnostics",
        "kpi_offtrack" | "kpi_sim" => "process/outcomes",
        "doc_rot" => "process/documentation",
        "skill_dormant" | "memory_disputed" => "process/knowledge",
        "passport_gap" => "process/readiness",
        _ => crate::repos::workspace_taxonomy::UNSORTED,
    }
    .to_string()
}

/// A skill's presence + 30-day usage in one member project.
pub(super) struct MinedSkillUse {
    pub(super) project_id: String,
    pub(super) invokes_30d: i64,
}

/// Miner B — cross-project skill adoption. A skill installed and heavily used
/// (≥ `MIN_INVOKES` in 30 days) in one workspace member but absent from ≥1
/// sibling is proposed as a `howto` adoption candidate.
pub const MIN_SKILL_INVOKES_30D: i64 = 3;

pub fn mine_shared_skills(
    pool: &DbPool,
    workspace_id: &str,
) -> Result<Vec<KnowledgeCandidate>, AppError> {
    let members = workspace_members(pool, workspace_id)?;
    if members.len() < 2 {
        return Ok(Vec::new());
    }
    let member_ids: std::collections::BTreeSet<String> =
        members.iter().map(|(id, _)| id.clone()).collect();

    let conn = pool.get()?;
    // Skills present (on disk) in each member, per the registry.
    let placeholders = member_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let present_sql = format!(
        // FOREIGN TABLE: skill_registry has no repo module - it is written
        // directly from `commands/infrastructure/skill_files.rs` in the app crate.
        "SELECT name, project_id FROM skill_registry
         WHERE scope = 'project' AND missing_since IS NULL AND project_id IN ({placeholders})"
    );
    let params_vec: Vec<&dyn rusqlite::types::ToSql> = member_ids
        .iter()
        .map(|s| s as &dyn rusqlite::types::ToSql)
        .collect();
    let mut present: HashMap<String, std::collections::BTreeSet<String>> = HashMap::new();
    {
        let mut stmt = conn.prepare(&present_sql)?;
        let rows = stmt.query_map(params_vec.as_slice(), |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })?;
        for row in rows {
            let (name, pid) = row?;
            present.entry(name).or_default().insert(pid);
        }
    }

    // 30-day usage per (skill, project).
    let usage_sql = format!(
        // FOREIGN TABLE: skill_usage_events has no repo module - it is written
        // directly from `commands/infrastructure/skill_usage.rs` in the app crate.
        "SELECT skill_name, project_id, COUNT(*) FROM skill_usage_events
         WHERE project_id IN ({placeholders})
           AND occurred_at >= datetime('now','-30 days')
         GROUP BY skill_name, project_id"
    );
    let mut usage: HashMap<String, Vec<MinedSkillUse>> = HashMap::new();
    {
        let mut stmt = conn.prepare(&usage_sql)?;
        let rows = stmt.query_map(params_vec.as_slice(), |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, Option<String>>(1)?,
                r.get::<_, i64>(2)?,
            ))
        })?;
        for row in rows {
            let (name, pid, count) = row?;
            if let Some(pid) = pid {
                usage.entry(name).or_default().push(MinedSkillUse {
                    project_id: pid,
                    invokes_30d: count,
                });
            }
        }
    }

    Ok(cluster_skill_adoption(&member_ids, &present, &usage))
}

/// Pure adoption-candidate core (testable): for each skill with heavy use in
/// some member and absence in ≥1 sibling, emit one candidate.
pub(super) fn cluster_skill_adoption(
    members: &std::collections::BTreeSet<String>,
    present: &HashMap<String, std::collections::BTreeSet<String>>,
    usage: &HashMap<String, Vec<MinedSkillUse>>,
) -> Vec<KnowledgeCandidate> {
    let mut out: Vec<KnowledgeCandidate> = Vec::new();
    let mut names: Vec<&String> = usage.keys().collect();
    names.sort();
    for name in names {
        let uses = &usage[name];
        let heavy = uses
            .iter()
            .filter(|u| u.invokes_30d >= MIN_SKILL_INVOKES_30D)
            .count();
        if heavy == 0 {
            continue;
        }
        let have = present.get(name).cloned().unwrap_or_default();
        let missing: Vec<&String> = members.iter().filter(|m| !have.contains(*m)).collect();
        if missing.is_empty() {
            continue;
        }
        let top = uses.iter().map(|u| u.invokes_30d).max().unwrap_or(0);
        out.push(KnowledgeCandidate {
            // Not produced by a territory scan (miner / divergence pass).
            harvest_scope: None,
            kind: "howto".into(),
            title: format!("Adopt the '{name}' skill workspace-wide"),
            statement: format!(
                "The '{name}' skill is actively used ({top}×/30d at peak) by {heavy} project(s) in this workspace but is missing from {} sibling(s). Consider adopting it across the workspace.",
                missing.len()
            ),
            detail_md: None,
            topic: Some("process/knowledge".into()),
            abstraction: Some("meso".into()),
            ftype: Some("extensibility".into()),
            durability: Some("situational".into()),
            governing_id: None,
            evidence_count: Some(heavy as i64),
            applicability: None,
            origin_project_id: None,
            dedup_key: Some(format!("miner:skill-adopt:{name}")),
            confidence: Some(0.6),
            extends: None,
            layer: None,
            evidence: Vec::new(),
        });
    }
    out
}

// ============================================================================
// Pattern × context traceability (docs/concepts/pattern-context-trace.md)
// ============================================================================
