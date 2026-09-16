//! Read-side digest for Athena over the skill fleet (which skill, at which
//! version, in which repo). It backs the auto-fire READ_OP `describe_skill_fleet`
//! in `dispatcher.rs` — same posture as `describe_skill` / `list_teams`:
//! read-only, bounded, honest about the empty case, and every answer ends by
//! naming what Athena can DO next (`skill_sync`, a plan row carrying a skill)
//! so the digest is a decision surface rather than trivia.
//!
//! A second digest, `describe_knowledge`, read the in-app Workspace Knowledge
//! library; it was retired with that library.
//!
//! Layering: the DB/filesystem fetch half is thin and untested; everything
//! that formats is a pure function over plain rows, tested below. Filesystem
//! is the truth for skill versions (same doctrine as
//! `skill_registry_export`); the DB contributes usage counts.

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
const MAX_LESSONS: usize = 3;

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
                    drift_verdict(
                        r.library_version.as_ref(),
                        c.version.as_deref(),
                        &c.sync_state
                    ),
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
                let verdict = drift_verdict(
                    r.library_version.as_ref(),
                    c.version.as_deref(),
                    &c.sync_state,
                );
                let uses = if c.invokes_30d > 0 {
                    format!(", {} uses/30d", c.invokes_30d)
                } else {
                    String::new()
                };
                format!(
                    "{} {} ({verdict}{uses})",
                    c.project,
                    ver(c.version.as_deref())
                )
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
        let verdict = drift_verdict(
            row.library_version.as_ref(),
            c.version.as_deref(),
            &c.sync_state,
        );
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
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, Option<String>>(1)?,
                r.get::<_, i64>(2)?,
            ))
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
                descriptions
                    .entry(e.name.clone())
                    .or_insert_with(|| d.clone());
            }
            let row = rows
                .entry(e.name.clone())
                .or_insert_with(|| SkillMatrixRow {
                    name: e.name.clone(),
                    library_version: None,
                    copies: Vec::new(),
                });
            row.copies.push(SkillCopy {
                project: pname.clone(),
                version: e.version.clone(),
                sync_state: e.sync_state.clone(),
                invokes_30d: invokes
                    .get(&(e.name.clone(), pid.clone()))
                    .copied()
                    .unwrap_or(0),
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
        .or_else(|| {
            rows.iter()
                .find(|r| r.name.to_lowercase().contains(&needle))
        });
    let Some(hit) = hit else {
        let names: Vec<&str> = rows.iter().take(12).map(|r| r.name.as_str()).collect();
        return format!(
            "No skill matches `{query}` in the library or any registered project. Known skills \
             include: {}. Do not invent a skill name.",
            if names.is_empty() {
                "none".to_string()
            } else {
                names.join(", ")
            }
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
    render_skill_detail(
        hit,
        descriptions.get(&hit.name).map(String::as_str),
        &lessons,
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
        assert_eq!(
            drift_verdict(Some(&lib), Some("2.1"), "diverged"),
            "customized"
        );
        // Unversioned copies compare as 1.0 (pre-standard skills).
        assert_eq!(drift_verdict(Some(&lib), None, "in_sync"), "behind");
        assert_eq!(drift_verdict(Some(&None), None, "in_sync"), "in sync");
        // A skill the library never carried.
        assert_eq!(
            drift_verdict(None, Some("1.0"), "local_only"),
            "not in library"
        );
    }

    #[test]
    fn matrix_lists_drifted_rows_first_and_names_actions() {
        let rows = vec![
            row(
                "alpha",
                Some(Some("1.0")),
                vec![("personas", Some("1.0"), "in_sync", 3)],
            ),
            row(
                "beta",
                Some(Some("2.0")),
                vec![("personas", Some("1.0"), "in_sync", 0)],
            ),
        ];
        let out = render_skill_matrix(&rows, 1);
        let beta_at = out.find("**beta**").expect("beta listed");
        let alpha_at = out.find("**alpha**").expect("alpha listed");
        assert!(
            beta_at < alpha_at,
            "drifted beta must render before in-sync alpha:\n{out}"
        );
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
        let r = row(
            "gamma",
            None,
            vec![("personas", Some("1.2"), "local_only", 7)],
        );
        let out = render_skill_detail(&r, Some("Does gamma things.\nMore."), &[]);
        assert!(out.contains("NOT in the workspace library"), "{out}");
        assert!(out.contains("7 uses/30d"), "{out}");
        assert!(out.contains("Does gamma things."), "{out}");
    }
}
