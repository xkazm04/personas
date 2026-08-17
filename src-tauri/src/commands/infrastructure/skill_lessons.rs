//! Skill LESSONS.md — the on-disk lane for skill-METHODIC reflection
//! (docs/skill-standard.md). Each skill directory may carry an append-only
//! `LESSONS.md` whose entries record what a real run taught about the METHOD
//! (not the project — project learnings go through the memory outbox). The
//! file is deliberately excluded from the skill content hash (`skill_files`),
//! so appending a lesson never reads as method drift; it still travels with
//! every install copy.
//!
//! Entry grammar (tolerant parse; the reflection contract writes it):
//!
//! ```markdown
//! ## <version-used> — <YYYY-MM-DD> — <project>
//! - bullet
//! ### Redesign proposal
//! - bullet flagged as a major-bump candidate
//! ```
//!
//! This module owns: the pure parser, the `skill_lessons_list` command (Trace
//! tab's lessons panel), and the workspace miner that surfaces lessons as
//! `observed` knowledge candidates through the same governed ladder as the
//! other deterministic miners (`dev_tools_workspace_run_miners`).

use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::State;

use crate::db::repos::dev_workspaces::KnowledgeCandidate;
use crate::db::DbPool;
use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::AppState;

use super::skill_files::global_skills_dir;

/// Hard caps — a hand-edited or runaway lessons file must never dominate a
/// scan. Entries beyond the cap are silently dropped (newest are at the
/// bottom, so the tail — the most recent lessons — is what survives).
const MAX_ENTRIES_PER_FILE: usize = 100;
const MAX_BULLETS_PER_ENTRY: usize = 12;
const MAX_BULLET_CHARS: usize = 500;
const MAX_ROWS_PER_LIST: usize = 500;

/// One parsed `## …` entry of a LESSONS.md file.
#[derive(Debug, Clone, PartialEq)]
pub struct LessonEntry {
    /// Version the run USED (not a bump target); None when the header carried
    /// no parseable version segment.
    pub version: Option<String>,
    /// `YYYY-MM-DD` when present in the header.
    pub date: Option<String>,
    /// Project name segment of the header, when present.
    pub project: Option<String>,
    pub bullets: Vec<String>,
    /// True when the entry contains a `### Redesign proposal` block — a
    /// major-bump candidate the reviewer should prioritize.
    pub is_redesign: bool,
}

/// Parse a LESSONS.md body. Tolerant: unknown lines are ignored, header
/// segments may be separated by em dashes or hyphens, missing segments parse
/// to None. Returns entries in file order (chronological by convention).
pub(crate) fn parse_lessons_entries(content: &str) -> Vec<LessonEntry> {
    let mut out: Vec<LessonEntry> = Vec::new();
    let mut current: Option<LessonEntry> = None;

    for line in content.lines() {
        let t = line.trim();
        if let Some(header) = t.strip_prefix("## ") {
            if let Some(done) = current.take() {
                if !done.bullets.is_empty() {
                    out.push(done);
                }
            }
            current = Some(parse_entry_header(header));
            continue;
        }
        let Some(entry) = current.as_mut() else { continue };
        if t.starts_with("### ") {
            if t.to_ascii_lowercase().contains("redesign") {
                entry.is_redesign = true;
            }
            continue;
        }
        if let Some(bullet) = t.strip_prefix("- ") {
            if entry.bullets.len() < MAX_BULLETS_PER_ENTRY && !bullet.trim().is_empty() {
                entry.bullets.push(bullet.trim().chars().take(MAX_BULLET_CHARS).collect());
            }
        }
    }
    if let Some(done) = current.take() {
        if !done.bullets.is_empty() {
            out.push(done);
        }
    }
    if out.len() > MAX_ENTRIES_PER_FILE {
        // Keep the newest tail (file is append-only, newest at the bottom).
        out.drain(0..out.len() - MAX_ENTRIES_PER_FILE);
    }
    out
}

/// Split `<version> — <date> — <project>` on em-dash or ` - ` separators.
fn parse_entry_header(header: &str) -> LessonEntry {
    let normalized = header.replace('\u{2014}', "\u{1F}").replace(" - ", "\u{1F}");
    let segs: Vec<&str> = normalized.split('\u{1F}').map(str::trim).collect();

    let looks_version =
        |s: &str| !s.is_empty() && s.chars().all(|c| c.is_ascii_digit() || c == '.');
    let looks_date = |s: &str| {
        s.len() == 10 && s.bytes().enumerate().all(|(i, b)| match i {
            4 | 7 => b == b'-',
            _ => b.is_ascii_digit(),
        })
    };

    let mut entry = LessonEntry {
        version: None,
        date: None,
        project: None,
        bullets: Vec::new(),
        is_redesign: false,
    };
    for seg in segs {
        if entry.version.is_none() && looks_version(seg) {
            entry.version = Some(seg.to_string());
        } else if entry.date.is_none() && looks_date(seg) {
            entry.date = Some(seg.to_string());
        } else if entry.project.is_none() && !seg.is_empty() {
            entry.project = Some(seg.chars().take(80).collect());
        }
    }
    entry
}

/// Locate a skill dir's lessons file, tolerating either casing (the repo's
/// SKILL.md/skill.md precedent).
fn lessons_path(skill_dir: &Path) -> Option<PathBuf> {
    for name in ["LESSONS.md", "lessons.md"] {
        let p = skill_dir.join(name);
        if p.is_file() {
            return Some(p);
        }
    }
    None
}

/// One lesson row over IPC — a parsed entry plus where it was found.
#[derive(Debug, Serialize)]
pub struct SkillLessonRow {
    pub skill: String,
    /// 'global' | 'project' — which copy of the skill carried the lesson.
    pub scope: String,
    pub project_id: Option<String>,
    /// Registered project name for project rows (display convenience).
    pub project_name: Option<String>,
    /// Version the lesson's run used (from the entry header).
    pub version: Option<String>,
    pub date: Option<String>,
    /// Bullets joined with newlines.
    pub lesson: String,
    pub is_redesign: bool,
}

fn rows_from_dir(
    skills_dir: &Path,
    only_skill: Option<&str>,
    scope: &str,
    project: Option<(&str, &str)>,
    out: &mut Vec<SkillLessonRow>,
) {
    let Ok(read_dir) = std::fs::read_dir(skills_dir) else { return };
    for entry in read_dir.flatten() {
        let dir = entry.path();
        if !dir.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if only_skill.is_some_and(|s| s != name) {
            continue;
        }
        let Some(lessons) = lessons_path(&dir) else { continue };
        let Ok(content) = std::fs::read_to_string(&lessons) else { continue };
        for e in parse_lessons_entries(&content) {
            if out.len() >= MAX_ROWS_PER_LIST {
                return;
            }
            out.push(SkillLessonRow {
                skill: name.clone(),
                scope: scope.to_string(),
                project_id: project.map(|(id, _)| id.to_string()),
                project_name: project.map(|(_, n)| n.to_string()),
                version: e.version,
                date: e.date,
                lesson: e.bullets.join("\n"),
                is_redesign: e.is_redesign,
            });
        }
    }
}

/// List parsed lessons across the workspace library and every registered
/// project's installed copies. `skill_name = None` lists all skills (bounded).
/// Filesystem truth — no DB rows involved beyond the project list.
#[tauri::command]
pub fn skill_lessons_list(
    state: State<'_, Arc<AppState>>,
    skill_name: Option<String>,
) -> Result<Vec<SkillLessonRow>, AppError> {
    require_auth_sync(&state)?;
    let mut out = Vec::new();

    if let Some(dir) = global_skills_dir() {
        rows_from_dir(&dir, skill_name.as_deref(), "global", None, &mut out);
    }

    let conn = state
        .db
        .get()
        .map_err(|e| AppError::Internal(format!("db connection failed: {e}")))?;
    let projects: Vec<(String, String, String)> = {
        let mut stmt = conn
            .prepare("SELECT id, name, root_path FROM dev_projects")
            .map_err(|e| AppError::Internal(format!("prepare failed: {e}")))?;
        let rows = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .map_err(|e| AppError::Internal(format!("query failed: {e}")))?;
        rows.flatten().collect()
    };
    for (pid, pname, root) in &projects {
        let dir = PathBuf::from(root).join(".claude").join("skills");
        rows_from_dir(&dir, skill_name.as_deref(), "project", Some((pid, pname)), &mut out);
    }

    Ok(out)
}

/// Miner C — skill-methodic lessons into the workspace knowledge ladder.
/// Walks each member project's installed skills (and the global library once)
/// on disk and emits one `observed` candidate per lessons entry. Dedup rides
/// the ladder's key gate: the key hashes the entry content, so re-runs are
/// idempotent and an edited entry re-proposes.
pub fn mine_skill_lessons(pool: &DbPool, workspace_id: &str) -> Result<Vec<KnowledgeCandidate>, AppError> {
    let conn = pool.get()?;
    let members: Vec<(String, String, String)> = {
        let mut stmt =
            conn.prepare("SELECT id, name, root_path FROM dev_projects WHERE workspace_id = ?1")?;
        let rows = stmt.query_map([workspace_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?;
        rows.flatten().collect()
    };
    if members.is_empty() {
        return Ok(Vec::new());
    }

    let mut rows: Vec<SkillLessonRow> = Vec::new();
    if let Some(dir) = global_skills_dir() {
        rows_from_dir(&dir, None, "global", None, &mut rows);
    }
    for (pid, pname, root) in &members {
        let dir = PathBuf::from(root).join(".claude").join("skills");
        rows_from_dir(&dir, None, "project", Some((pid, pname)), &mut rows);
    }

    let mut out = Vec::new();
    for row in rows {
        if row.lesson.is_empty() {
            continue;
        }
        let mut h = Sha256::new();
        h.update(row.skill.as_bytes());
        h.update([0u8]);
        h.update(row.lesson.as_bytes());
        let digest = hex::encode(h.finalize());
        let key = &digest[..16];

        let first = row.lesson.lines().next().unwrap_or_default();
        let first_short: String = first.chars().take(120).collect();
        let version = row.version.as_deref().unwrap_or("1.0");
        let prefix = if row.is_redesign { "[redesign] " } else { "" };
        let origin = row
            .project_name
            .clone()
            .unwrap_or_else(|| "the workspace library".to_string());

        out.push(KnowledgeCandidate {
            harvest_scope: None,
            kind: "howto".into(),
            title: format!("{prefix}Skill {} {version}: {first_short}", row.skill),
            statement: format!(
                "A run of the '{}' skill (v{version}) in {origin} recorded a method lesson:\n{}",
                row.skill, row.lesson
            ),
            detail_md: None,
            topic: Some("process/knowledge".into()),
            abstraction: Some("meso".into()),
            ftype: Some("extensibility".into()),
            durability: Some("durable".into()),
            governing_id: None,
            evidence_count: Some(row.lesson.lines().count() as i64),
            applicability: None,
            origin_project_id: row.project_id.clone(),
            dedup_key: Some(format!("miner:skill-lesson:{}:{key}", row.skill)),
            confidence: Some(if row.is_redesign { 0.7 } else { 0.55 }),
            extends: None,
            layer: None,
            evidence: Vec::new(),
        });
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "# Lessons \u{2014} scan-sweep\n\nMethodic lessons from real runs.\n\n## 1.1 \u{2014} 2026-08-07 \u{2014} personas\n- Step 3's grep pattern misses TS decorators; anchor on the export keyword.\n\n## 1.1 \u{2014} 2026-08-09 \u{2014} nuda-web\n### Redesign proposal\n- The scan/fix split fights itself on monorepos; per-package passes instead.\n";

    #[test]
    fn parses_entries_with_versions_dates_projects() {
        let entries = parse_lessons_entries(SAMPLE);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].version.as_deref(), Some("1.1"));
        assert_eq!(entries[0].date.as_deref(), Some("2026-08-07"));
        assert_eq!(entries[0].project.as_deref(), Some("personas"));
        assert_eq!(entries[0].bullets.len(), 1);
        assert!(!entries[0].is_redesign);
        assert!(entries[1].is_redesign, "### Redesign proposal flags the entry");
    }

    #[test]
    fn tolerates_hyphen_separators_and_partial_headers() {
        let md = "## 2.0 - 2026-01-02 - my-app\n- a\n\n## just-a-project\n- b\n";
        let entries = parse_lessons_entries(md);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].version.as_deref(), Some("2.0"));
        assert_eq!(entries[0].project.as_deref(), Some("my-app"));
        // Second header has no version/date — the segment lands in project.
        assert_eq!(entries[1].version, None);
        assert_eq!(entries[1].project.as_deref(), Some("just-a-project"));
    }

    #[test]
    fn drops_bulletless_entries_and_ignores_prose() {
        let md = "prose line\n## 1.0 \u{2014} 2026-01-01 \u{2014} p\nno bullets here\n## 1.1 \u{2014} 2026-01-02 \u{2014} p\n- real\n";
        let entries = parse_lessons_entries(md);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].version.as_deref(), Some("1.1"));
    }

    #[test]
    fn empty_and_garbage_inputs_parse_to_nothing() {
        assert!(parse_lessons_entries("").is_empty());
        assert!(parse_lessons_entries("# heading only\ntext\n").is_empty());
    }
}
