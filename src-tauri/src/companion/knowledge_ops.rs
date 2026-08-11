//! Read-side digests for Athena over the two cross-project knowledge
//! surfaces: the skill fleet (which skill, at which version, in which repo)
//! and the workspace knowledge library (patterns / playbooks / harvest
//! coverage). Both back auto-fire READ_OPS in `dispatcher.rs`
//! (`describe_skill_fleet`, `describe_knowledge`) — same posture as
//! `describe_skill` / `list_teams`: read-only, bounded, honest about the
//! empty case, and every answer ends by naming what Athena can DO next
//! (`skill_sync`, a plan row carrying a skill, `run_pattern_harvest`, …) so
//! the digest is a decision surface rather than trivia.
//!
//! Layering: the DB/filesystem fetch half is thin and untested; everything
//! that formats is a pure function over plain rows, tested below. Filesystem
//! is the truth for skill versions (same doctrine as
//! `skill_registry_export`); the DB contributes usage counts and the
//! knowledge tables.

use std::collections::BTreeMap;
use std::path::PathBuf;

use crate::commands::infrastructure::skill_files::{
    global_skills_dir, parse_skill_version, scan_skills_dir,
};
use crate::commands::infrastructure::skill_lessons::parse_lessons_entries;
use crate::db::DbPool;

/// Bound every list the digests render — a read op's answer is only cheaper
/// than a fat prompt if it is itself bounded.
const MAX_SKILL_ROWS: usize = 40;
const MAX_PROJECTS: usize = 16;
const MAX_AREA_ROWS: usize = 12;
const MAX_LESSONS: usize = 3;
const MAX_EDGE_ROWS: usize = 10;

// ── skill fleet ─────────────────────────────────────────────────────────

/// One project copy of a skill, as the matrix renders it.
pub(crate) struct SkillCopy {
    pub project: String,
    pub version: Option<String>,
    /// `SkillEntry::sync_state` — "in_sync" | "diverged" | "local_only".
    pub sync_state: String,
    pub invokes_30d: i64,
}

/// One row of the cross-project matrix.
pub(crate) struct SkillMatrixRow {
    pub name: String,
    /// None = the skill is not in the workspace library at all.
    pub library_version: Option<Option<String>>,
    pub copies: Vec<SkillCopy>,
}

/// Verdict for one project copy against the library. Content-hash divergence
/// ("diverged" provenance) beats the version compare — a customized copy at
/// the library's version number is still customized.
pub(crate) fn drift_verdict(
    library: Option<&Option<String>>,
    copy_version: Option<&str>,
    sync_state: &str,
) -> &'static str {
    if sync_state == "diverged" {
        return "customized";
    }
    let Some(lib_version) = library else {
        return "not in library";
    };
    let lib = parse_skill_version(lib_version.as_deref());
    let local = parse_skill_version(copy_version);
    match local.cmp(&lib) {
        std::cmp::Ordering::Less => "behind",
        std::cmp::Ordering::Greater => "ahead",
        std::cmp::Ordering::Equal => "in sync",
    }
}

fn ver(v: Option<&str>) -> &str {
    v.unwrap_or("1.0")
}

/// Render the whole matrix (no-query mode). Pure over rows.
pub(crate) fn render_skill_matrix(rows: &[SkillMatrixRow], project_count: usize) -> String {
    if rows.is_empty() {
        return "No skills found — neither the workspace library (~/.claude/skills) nor any \
                registered project's .claude/skills has entries. Nothing to sync or dispatch."
            .to_string();
    }
    let mut out = format!(
        "**Skill fleet** — {n} skills across {p} registered projects + the workspace library.\n\
         Verdicts compare declared `version:` (major.minor; unversioned = 1.0); \
         `customized` = content diverged from its install source.\n\n",
        n = rows.len(),
        p = project_count,
    );
    // Drifted rows are the decision-relevant ones — list them first.
    let (drifted, clean): (Vec<&SkillMatrixRow>, Vec<&SkillMatrixRow>) =
        rows.iter().partition(|r| {
            r.copies.iter().any(|c| {
                !matches!(
                    drift_verdict(r.library_version.as_ref(), c.version.as_deref(), &c.sync_state),
                    "in sync"
                )
            })
        });
    for r in drifted.iter().chain(clean.iter()).take(MAX_SKILL_ROWS) {
        let lib = match &r.library_version {
            Some(v) => format!("library {}", ver(v.as_deref())),
            None => "not in library".to_string(),
        };
        let copies: Vec<String> = r
            .copies
            .iter()
            .map(|c| {
                let verdict =
                    drift_verdict(r.library_version.as_ref(), c.version.as_deref(), &c.sync_state);
                let uses = if c.invokes_30d > 0 {
                    format!(", {} uses/30d", c.invokes_30d)
                } else {
                    String::new()
                };
                format!("{} {} ({verdict}{uses})", c.project, ver(c.version.as_deref()))
            })
            .collect();
        let copies_txt = if copies.is_empty() {
            "installed nowhere".to_string()
        } else {
            copies.join("; ")
        };
        out.push_str(&format!("- **{}** — {lib}; {copies_txt}\n", r.name));
    }
    if rows.len() > MAX_SKILL_ROWS {
        out.push_str(&format!(
            "\n_{} more skills omitted — query one by name for detail._\n",
            rows.len() - MAX_SKILL_ROWS
        ));
    }
    out.push_str(
        "\nActions: `skill_sync` (adopt into a project / sync a behind copy / publish an ahead \
         copy to the library); run a skill in a repo via a fleet plan row's `skill` field; \
         `describe_skill_fleet` with a skill name for versions, usage and recent lessons.",
    );
    out
}

/// Render one skill's detail (query mode). Pure over the row + lessons text.
pub(crate) fn render_skill_detail(
    row: &SkillMatrixRow,
    description: Option<&str>,
    lessons: &[String],
) -> String {
    let lib = match &row.library_version {
        Some(v) => format!("library {}", ver(v.as_deref())),
        None => "NOT in the workspace library (publish would add it)".to_string(),
    };
    let mut out = format!("**{}** — {lib}\n", row.name);
    if let Some(d) = description {
        let one = d.lines().next().unwrap_or("").trim();
        if !one.is_empty() {
            out.push_str(&format!("- {}\n", &one[..one.len().min(240)]));
        }
    }
    if row.copies.is_empty() {
        out.push_str("- installed in no registered project\n");
    }
    for c in &row.copies {
        let verdict =
            drift_verdict(row.library_version.as_ref(), c.version.as_deref(), &c.sync_state);
        out.push_str(&format!(
            "- {}: {} ({verdict}, {} uses/30d)\n",
            c.project,
            ver(c.version.as_deref()),
            c.invokes_30d
        ));
    }
    if !lessons.is_empty() {
        out.push_str("\nRecent lessons (LESSONS.md):\n");
        for l in lessons.iter().take(MAX_LESSONS) {
            out.push_str(&format!("- {l}\n"));
        }
    }
    out.push_str(
        "\nActions: `skill_sync` to adopt/sync/publish this skill; a fleet plan row with \
         `skill` set runs it in a repo.",
    );
    out
}

/// DB + filesystem fetch for the matrix. `query` empty → whole matrix;
/// otherwise detail for the best-matching skill name.
pub fn describe_skill_fleet(db: &DbPool, query: &str) -> String {
    let Ok(conn) = db.get() else {
        return "Skill fleet unavailable: database not reachable this turn.".to_string();
    };
    // Registered projects (bounded — a workspace is single-digit small).
    let projects: Vec<(String, String, String)> = conn
        .prepare("SELECT id, name, root_path FROM dev_projects ORDER BY name LIMIT ?1")
        .and_then(|mut s| {
            let rows = s.query_map([MAX_PROJECTS as i64], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?))
            })?;
            Ok(rows.flatten().collect())
        })
        .unwrap_or_default();

    // 30-day invokes per (skill, project). Missing telemetry degrades to 0.
    let mut invokes: BTreeMap<(String, String), i64> = BTreeMap::new();
    if let Ok(mut stmt) = conn.prepare(
        "SELECT skill_name, project_id, COUNT(*) FROM skill_usage_events
         WHERE occurred_at >= datetime('now','-30 days')
         GROUP BY skill_name, project_id",
    ) {
        if let Ok(rows) = stmt.query_map([], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?, r.get::<_, i64>(2)?))
        }) {
            for (name, pid, n) in rows.flatten() {
                if let Some(pid) = pid {
                    invokes.insert((name, pid), n);
                }
            }
        }
    }

    // Filesystem truth: library + every project's .claude/skills.
    let library: BTreeMap<String, Option<String>> = global_skills_dir()
        .map(|d| scan_skills_dir(&d))
        .unwrap_or_default()
        .into_iter()
        .map(|e| (e.name.clone(), e.version.clone()))
        .collect();
    let mut rows: BTreeMap<String, SkillMatrixRow> = library
        .iter()
        .map(|(name, v)| {
            (
                name.clone(),
                SkillMatrixRow {
                    name: name.clone(),
                    library_version: Some(v.clone()),
                    copies: Vec::new(),
                },
            )
        })
        .collect();
    let mut descriptions: BTreeMap<String, String> = BTreeMap::new();
    for (pid, pname, root) in &projects {
        let dir = PathBuf::from(root).join(".claude").join("skills");
        for e in scan_skills_dir(&dir) {
            if let Some(d) = &e.description {
                descriptions.entry(e.name.clone()).or_insert_with(|| d.clone());
            }
            let row = rows.entry(e.name.clone()).or_insert_with(|| SkillMatrixRow {
                name: e.name.clone(),
                library_version: None,
                copies: Vec::new(),
            });
            row.copies.push(SkillCopy {
                project: pname.clone(),
                version: e.version.clone(),
                sync_state: e.sync_state.clone(),
                invokes_30d: invokes.get(&(e.name.clone(), pid.clone())).copied().unwrap_or(0),
            });
        }
    }
    let rows: Vec<SkillMatrixRow> = rows.into_values().collect();

    if query.is_empty() {
        return render_skill_matrix(&rows, projects.len());
    }
    let needle = query.to_lowercase();
    let hit = rows
        .iter()
        .find(|r| r.name.to_lowercase() == needle)
        .or_else(|| rows.iter().find(|r| r.name.to_lowercase().contains(&needle)));
    let Some(hit) = hit else {
        let names: Vec<&str> = rows.iter().take(12).map(|r| r.name.as_str()).collect();
        return format!(
            "No skill matches `{query}` in the library or any registered project. Known skills \
             include: {}. Do not invent a skill name.",
            if names.is_empty() { "none".to_string() } else { names.join(", ") }
        );
    };
    // Lessons: library copy first, else the first project copy that has one.
    let lesson_paths: Vec<PathBuf> = global_skills_dir()
        .into_iter()
        .map(|d| d.join(&hit.name).join("LESSONS.md"))
        .chain(projects.iter().map(|(_, _, root)| {
            PathBuf::from(root)
                .join(".claude")
                .join("skills")
                .join(&hit.name)
                .join("LESSONS.md")
        }))
        .collect();
    let lessons: Vec<String> = lesson_paths
        .iter()
        .find_map(|p| std::fs::read_to_string(p).ok())
        .map(|content| {
            let mut entries = parse_lessons_entries(&content);
            entries.reverse(); // newest last on disk → newest first here
            entries
                .into_iter()
                .take(MAX_LESSONS)
                .map(|e| {
                    format!(
                        "{}{}: {}",
                        e.date.unwrap_or_else(|| "undated".into()),
                        e.project.map(|p| format!(" ({p})")).unwrap_or_default(),
                        e.bullets.first().cloned().unwrap_or_default()
                    )
                })
                .collect()
        })
        .unwrap_or_default();
    render_skill_detail(hit, descriptions.get(&hit.name).map(String::as_str), &lessons)
}

// ── knowledge library ───────────────────────────────────────────────────

/// One workspace's digest rows, fetched thin and rendered pure.
pub(crate) struct KnowledgeDigest {
    pub workspace: String,
    pub by_status: BTreeMap<String, i64>,
    /// (top-level area, adopted count), descending.
    pub adopted_by_area: Vec<(String, i64)>,
    pub playbooks_active: Vec<String>,
    pub playbooks_draft: usize,
    /// (project name, total scopes, never-harvested scopes, stale scopes).
    pub coverage: Vec<(String, usize, usize, usize)>,
    /// Campaign lens per project: (name, practices awaiting a first verdict,
    /// violating cells, adopted-with-evidence cells). Only projects with any
    /// signal are listed.
    pub verify: Vec<(String, i64, i64, i64)>,
    /// Top measured-violation hotspots: (pattern title, violating-context
    /// count) across the workspace, descending.
    pub violation_hotspots: Vec<(String, i64)>,
}

pub(crate) fn render_knowledge_digest(digests: &[KnowledgeDigest]) -> String {
    if digests.is_empty() {
        return "No workspaces exist yet — the knowledge library lives inside a workspace \
                (Dev Tools → Workspaces). Nothing to report."
            .to_string();
    }
    let mut out = String::new();
    for d in digests {
        let counts = ["adopted", "observed", "proposed", "rejected", "deprecated"]
            .iter()
            .filter_map(|s| d.by_status.get(*s).map(|n| format!("{n} {s}")))
            .collect::<Vec<_>>()
            .join(", ");
        out.push_str(&format!(
            "**Workspace {}** — knowledge: {}.\n",
            d.workspace,
            if counts.is_empty() { "empty".to_string() } else { counts }
        ));
        let pending = d.by_status.get("observed").copied().unwrap_or(0)
            + d.by_status.get("proposed").copied().unwrap_or(0);
        if pending > 0 {
            out.push_str(&format!(
                "- {pending} items await human review — adoption is the operator's click, never yours.\n"
            ));
        }
        if !d.adopted_by_area.is_empty() {
            let areas: Vec<String> = d
                .adopted_by_area
                .iter()
                .take(MAX_AREA_ROWS)
                .map(|(a, n)| format!("{a} ({n})"))
                .collect();
            out.push_str(&format!("- adopted patterns by area: {}\n", areas.join(", ")));
        }
        if !d.playbooks_active.is_empty() || d.playbooks_draft > 0 {
            out.push_str(&format!(
                "- playbooks: {} active{}{}\n",
                d.playbooks_active.len(),
                if d.playbooks_active.is_empty() {
                    String::new()
                } else {
                    format!(" ({})", d.playbooks_active.join(", "))
                },
                if d.playbooks_draft > 0 {
                    format!(", {} draft awaiting activation", d.playbooks_draft)
                } else {
                    String::new()
                },
            ));
        }
        for (project, total, never, stale) in &d.coverage {
            if *never > 0 || *stale > 0 {
                out.push_str(&format!(
                    "- harvest coverage {project}: {total} territories, {never} never harvested, \
                     {stale} stale — candidates for `run_pattern_harvest`\n",
                ));
            }
        }
        for (project, remaining, violating, adopted) in &d.verify {
            out.push_str(&format!(
                "- verification {project}: {remaining} practices await a first verdict \
                 (`evaluate_pattern`), {violating} violating cells measured, {adopted} \
                 adopted-with-evidence\n",
            ));
        }
        if !d.violation_hotspots.is_empty() {
            let tops: Vec<String> = d
                .violation_hotspots
                .iter()
                .take(6)
                .map(|(t, n)| format!("{t} ({n} contexts)"))
                .collect();
            out.push_str(&format!(
                "- top measured violations — `apply_pattern` targets: {}\n",
                tops.join("; ")
            ));
        }
        out.push('\n');
    }
    out.push_str(
        "Actions: `run_pattern_harvest` scans a project's stale territories into the review \
         queue; `apply_pattern` dispatches a session that implements adopted patterns in a \
         target project; `describe_knowledge` with a pattern title/id or playbook slug for \
         detail. You propose — adoption stays a human decision.",
    );
    out
}

/// A scope counts as stale when its last harvest is older than this.
const STALE_DAYS: i64 = 30;

pub fn describe_knowledge(db: &DbPool, query: &str) -> String {
    let workspaces = match crate::db::repos::dev_workspaces::list_workspaces(db) {
        Ok(w) => w,
        Err(e) => return format!("Knowledge library unavailable: {e}"),
    };
    if !query.is_empty() {
        return describe_knowledge_item(db, &workspaces, query);
    }
    let Ok(conn) = db.get() else {
        return "Knowledge library unavailable: database not reachable this turn.".to_string();
    };
    let stale_cutoff = chrono::Utc::now() - chrono::Duration::days(STALE_DAYS);
    let stale_cutoff = stale_cutoff.to_rfc3339();
    let mut digests = Vec::new();
    for ws in &workspaces {
        let mut by_status: BTreeMap<String, i64> = BTreeMap::new();
        if let Ok(mut stmt) = conn.prepare(
            "SELECT status, COUNT(*) FROM workspace_knowledge WHERE workspace_id = ?1 GROUP BY status",
        ) {
            if let Ok(rows) = stmt.query_map([&ws.id], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
            }) {
                by_status.extend(rows.flatten());
            }
        }
        let mut area_counts: BTreeMap<String, i64> = BTreeMap::new();
        if let Ok(mut stmt) = conn.prepare(
            "SELECT topic FROM workspace_knowledge WHERE workspace_id = ?1 AND status = 'adopted'",
        ) {
            if let Ok(rows) = stmt.query_map([&ws.id], |r| r.get::<_, Option<String>>(0)) {
                for topic in rows.flatten().flatten() {
                    let area = topic.split('/').next().unwrap_or("uncategorized").to_string();
                    *area_counts.entry(area).or_insert(0) += 1;
                }
            }
        }
        let mut adopted_by_area: Vec<(String, i64)> = area_counts.into_iter().collect();
        adopted_by_area.sort_by(|a, b| b.1.cmp(&a.1));

        let playbooks =
            crate::db::repos::dev_workspaces::list_playbooks(db, &ws.id).unwrap_or_default();
        let playbooks_active: Vec<String> = playbooks
            .iter()
            .filter(|p| p.status == "active")
            .map(|p| p.slug.clone())
            .collect();
        let playbooks_draft = playbooks.iter().filter(|p| p.status == "draft").count();

        let members: Vec<(String, String)> = conn
            .prepare("SELECT id, name FROM dev_projects WHERE workspace_id = ?1 ORDER BY name")
            .and_then(|mut s| {
                let rows = s.query_map([&ws.id], |r| Ok((r.get(0)?, r.get(1)?)))?;
                Ok(rows.flatten().collect())
            })
            .unwrap_or_default();
        let mut coverage = Vec::new();
        for (pid, pname) in members.iter().take(MAX_PROJECTS) {
            let rows = crate::db::repos::dev_workspaces::list_harvest_coverage(db, pid)
                .unwrap_or_default();
            if rows.is_empty() {
                continue;
            }
            let never = rows.iter().filter(|c| c.last_harvested_at.is_none()).count();
            let stale = rows
                .iter()
                .filter(|c| {
                    c.last_harvested_at
                        .as_deref()
                        .is_some_and(|at| at < stale_cutoff.as_str())
                })
                .count();
            coverage.push((pname.clone(), rows.len(), never, stale));
        }

        // Campaign lens: verify progress per member + violation hotspots.
        let mut verify = Vec::new();
        for (pid, pname) in members.iter().take(MAX_PROJECTS) {
            let remaining: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM workspace_practice_adoption
                     WHERE project_id = ?1 AND state IN ('proposed', 'to_process')",
                    [pid],
                    |r| r.get(0),
                )
                .unwrap_or(0);
            let (violating, adopted): (i64, i64) = conn
                .query_row(
                    "SELECT
                       COALESCE(SUM(state = 'violating'), 0),
                       COALESCE(SUM(state = 'adopted'), 0)
                     FROM workspace_practice_context_state WHERE project_id = ?1",
                    [pid],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .unwrap_or((0, 0));
            if remaining > 0 || violating > 0 || adopted > 0 {
                verify.push((pname.clone(), remaining, violating, adopted));
            }
        }
        let violation_hotspots: Vec<(String, i64)> = conn
            .prepare(
                "SELECT k.title, COUNT(*) n
                 FROM workspace_practice_context_state s
                 JOIN workspace_knowledge k ON k.id = s.practice_id
                 WHERE s.state = 'violating' AND k.workspace_id = ?1
                 GROUP BY s.practice_id ORDER BY n DESC LIMIT 6",
            )
            .and_then(|mut s| {
                let rows = s.query_map([&ws.id], |r| Ok((r.get(0)?, r.get(1)?)))?;
                Ok(rows.flatten().collect())
            })
            .unwrap_or_default();

        digests.push(KnowledgeDigest {
            workspace: ws.name.clone(),
            by_status,
            adopted_by_area,
            playbooks_active,
            playbooks_draft,
            coverage,
            verify,
            violation_hotspots,
        });
    }
    render_knowledge_digest(&digests)
}

/// Query mode: a pattern (by id or title substring) or a playbook (by slug).
fn describe_knowledge_item(
    db: &DbPool,
    workspaces: &[crate::db::models::DevWorkspace],
    query: &str,
) -> String {
    let needle = query.to_lowercase();
    for ws in workspaces {
        // Playbook slug first — slugs are exact, cheap, and unambiguous.
        if let Ok(playbooks) = crate::db::repos::dev_workspaces::list_playbooks(db, &ws.id) {
            if let Some(pb) = playbooks.iter().find(|p| p.slug.to_lowercase() == needle) {
                let members =
                    crate::db::repos::dev_workspaces::list_playbook_patterns(db, &pb.id)
                        .unwrap_or_default();
                let mut out = format!(
                    "**Playbook {}** ({}) — {}\n{}\n\nMembers by phase:\n",
                    pb.slug, pb.status, pb.title, pb.summary
                );
                for m in members.iter().take(24) {
                    out.push_str(&format!("- [{}] {}\n", m.phase, m.practice_id));
                }
                out.push_str(
                    "\n`apply_pattern` with `playbook` set dispatches a session that works \
                     through the active playbook's members in a target project.",
                );
                return out;
            }
        }
        let all = match crate::db::repos::dev_workspaces::list_knowledge(db, &ws.id, None) {
            Ok(k) => k,
            Err(_) => continue,
        };
        let hit = all
            .iter()
            .find(|k| k.id == query)
            .or_else(|| all.iter().find(|k| k.title.to_lowercase().contains(&needle)));
        if let Some(k) = hit {
            let edges = crate::db::repos::dev_workspaces::list_pattern_edges(db, &ws.id)
                .unwrap_or_default();
            let titles: BTreeMap<&str, &str> =
                all.iter().map(|x| (x.id.as_str(), x.title.as_str())).collect();
            let mut edge_lines = Vec::new();
            for e in &edges {
                if e.from_id == k.id {
                    edge_lines.push(format!(
                        "{} → {}",
                        e.rel,
                        titles.get(e.to_id.as_str()).unwrap_or(&e.to_id.as_str())
                    ));
                } else if e.to_id == k.id {
                    edge_lines.push(format!(
                        "{} ← {}",
                        e.rel,
                        titles.get(e.from_id.as_str()).unwrap_or(&e.from_id.as_str())
                    ));
                }
            }
            edge_lines.truncate(MAX_EDGE_ROWS);
            let detail = k
                .detail_md
                .as_deref()
                .map(|d| {
                    let d = d.trim();
                    if d.chars().count() > 600 {
                        let cut: String = d.chars().take(600).collect();
                        format!("{cut}…")
                    } else {
                        d.to_string()
                    }
                })
                .unwrap_or_default();
            return format!(
                "**{title}** (`{id}`, {kind}, {status}{topic})\n{statement}\n{detail}{edges}\n\n\
                 `apply_pattern` dispatches a session that implements this in a target project; \
                 adoption/adherence cells only move through the verify lane, never by fiat.",
                title = k.title,
                id = k.id,
                kind = k.kind,
                status = k.status,
                topic = k
                    .topic
                    .as_deref()
                    .map(|t| format!(", topic {t}"))
                    .unwrap_or_default(),
                statement = k.statement,
                detail = if detail.is_empty() { String::new() } else { format!("\n{detail}\n") },
                edges = if edge_lines.is_empty() {
                    String::new()
                } else {
                    format!("\nRelations: {}", edge_lines.join("; "))
                },
            );
        }
    }
    format!(
        "Nothing in the knowledge library matches `{query}` (tried pattern ids, title \
         substrings and playbook slugs across {} workspace(s)). Use `describe_knowledge` with \
         no query for the digest; do not invent a pattern id.",
        workspaces.len()
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(
        name: &str,
        lib: Option<Option<&str>>,
        copies: Vec<(&str, Option<&str>, &str, i64)>,
    ) -> SkillMatrixRow {
        SkillMatrixRow {
            name: name.into(),
            library_version: lib.map(|v| v.map(str::to_string)),
            copies: copies
                .into_iter()
                .map(|(p, v, s, n)| SkillCopy {
                    project: p.into(),
                    version: v.map(str::to_string),
                    sync_state: s.into(),
                    invokes_30d: n,
                })
                .collect(),
        }
    }

    #[test]
    fn drift_verdicts_cover_the_matrix() {
        let lib = Some("2.1".to_string());
        assert_eq!(drift_verdict(Some(&lib), Some("2.0"), "in_sync"), "behind");
        assert_eq!(drift_verdict(Some(&lib), Some("2.2"), "in_sync"), "ahead");
        assert_eq!(drift_verdict(Some(&lib), Some("2.1"), "in_sync"), "in sync");
        // Content divergence beats an equal version number.
        assert_eq!(drift_verdict(Some(&lib), Some("2.1"), "diverged"), "customized");
        // Unversioned copies compare as 1.0 (pre-standard skills).
        assert_eq!(drift_verdict(Some(&lib), None, "in_sync"), "behind");
        assert_eq!(drift_verdict(Some(&None), None, "in_sync"), "in sync");
        // A skill the library never carried.
        assert_eq!(drift_verdict(None, Some("1.0"), "local_only"), "not in library");
    }

    #[test]
    fn matrix_lists_drifted_rows_first_and_names_actions() {
        let rows = vec![
            row("alpha", Some(Some("1.0")), vec![("personas", Some("1.0"), "in_sync", 3)]),
            row("beta", Some(Some("2.0")), vec![("personas", Some("1.0"), "in_sync", 0)]),
        ];
        let out = render_skill_matrix(&rows, 1);
        let beta_at = out.find("**beta**").expect("beta listed");
        let alpha_at = out.find("**alpha**").expect("alpha listed");
        assert!(beta_at < alpha_at, "drifted beta must render before in-sync alpha:\n{out}");
        assert!(out.contains("behind"), "{out}");
        assert!(out.contains("skill_sync"), "{out}");
    }

    #[test]
    fn empty_matrix_is_honest() {
        let out = render_skill_matrix(&[], 0);
        assert!(out.contains("No skills found"), "{out}");
    }

    #[test]
    fn skill_detail_names_the_missing_library_case() {
        let r = row("gamma", None, vec![("personas", Some("1.2"), "local_only", 7)]);
        let out = render_skill_detail(&r, Some("Does gamma things.\nMore."), &[]);
        assert!(out.contains("NOT in the workspace library"), "{out}");
        assert!(out.contains("7 uses/30d"), "{out}");
        assert!(out.contains("Does gamma things."), "{out}");
    }

    #[test]
    fn knowledge_digest_reports_pending_and_coverage_debt() {
        let d = KnowledgeDigest {
            workspace: "xprice".into(),
            by_status: BTreeMap::from([("adopted".to_string(), 455), ("observed".to_string(), 12)]),
            adopted_by_area: vec![("backend".into(), 200), ("ui".into(), 100)],
            playbooks_active: vec!["add-db-table".into()],
            playbooks_draft: 7,
            coverage: vec![("brainiac".into(), 12, 3, 2), ("clean".into(), 4, 0, 0)],
            verify: vec![("personas".into(), 140, 37, 12)],
            violation_hotspots: vec![("Wrap IPC in invokeWithTimeout".into(), 9)],
        };
        let out = render_knowledge_digest(&[d]);
        assert!(out.contains("140 practices await a first verdict"), "{out}");
        assert!(out.contains("37 violating cells"), "{out}");
        assert!(out.contains("Wrap IPC in invokeWithTimeout (9 contexts)"), "{out}");
        assert!(out.contains("455 adopted"), "{out}");
        assert!(out.contains("12 items await human review"), "{out}");
        assert!(out.contains("backend (200)"), "{out}");
        assert!(out.contains("7 draft awaiting activation"), "{out}");
        assert!(out.contains("brainiac: 12 territories, 3 never harvested, 2 stale"), "{out}");
        // The clean project owes nothing and must not be listed as debt.
        assert!(!out.contains("clean: 4"), "{out}");
        assert!(out.contains("run_pattern_harvest"), "{out}");
    }

    #[test]
    fn empty_workspace_list_is_honest() {
        let out = render_knowledge_digest(&[]);
        assert!(out.contains("No workspaces exist yet"), "{out}");
    }
}
