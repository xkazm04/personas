//! Workspace practice projection — the ambient half of Arc 3 distribution
//! (docs/plans/workspace-knowledge-center.md §8).
//!
//! Adopting a practice is worth little if it only lives in the app's database.
//! This module projects a workspace's **adopted** practices into each member
//! repo as a Claude Code memory file, so every future CLI session in that repo
//! carries the workspace's canon at zero dispatch cost. That is the autonomy
//! lever: the library pays back automatically instead of on demand.
//!
//! ## Safety — why this writes an owned file, not a marker block
//!
//! The design sketch called for a `<!-- personas:workspace-practices -->`
//! marker block spliced into CLAUDE.md. This module deliberately follows the
//! precedent already set by [`super::claude_md_projection`] instead: the
//! generated content lives in its own **fully-owned** file under `.claude/`,
//! and CLAUDE.md only ever gains a single `@import` line. That means we never
//! parse, rewrite, or risk clobbering the user's own prose — the worst case is
//! one stale line in a file we otherwise never touch. Splicing into
//! user-authored text is the strictly more dangerous design.
//!
//! Every write is best-effort per project: one unwritable repo is reported and
//! skipped, never aborting the rest of the projection.

use std::path::Path;

use personas_db::models::{DevProject, WorkspaceKnowledge};
use personas_db::repos::dev_workspaces as repo;
use personas_db::DbPool;
use personas_core::error::AppError;

/// Generated file under the member repo's `.claude/`. Owned by this module —
/// overwritten wholesale on every projection.
const PRACTICES_FILE: &str = "workspace-practices.md";

/// The single line appended to CLAUDE.md, ever.
const IMPORT_LINE: &str = "@.claude/workspace-practices.md";

/// Per-project outcome of a projection run.
#[derive(Debug, serde::Serialize, ts_rs::TS)]
#[ts(export)]
pub struct ProjectionResult {
    pub project_id: String,
    pub project_name: String,
    /// Practices written into this repo's memory file.
    pub practices: u32,
    /// True when CLAUDE.md gained the import line on this run (first time).
    pub linked: bool,
    /// Populated when this project was skipped; the rest still projected.
    pub skipped: Option<String>,
}

/// Project a workspace's adopted practices into every member repo.
///
/// Scope: practices with status `adopted`, filtered per project by the
/// applicability envelope, annotated with that project's rollout state from
/// the adoption matrix (so a repo can tell canon it has adopted from canon
/// still proposed for it).
pub fn project_workspace_practices(
    pool: &DbPool,
    workspace_id: &str,
) -> Result<Vec<ProjectionResult>, AppError> {
    let ws = repo::get_workspace_by_id(pool, workspace_id)?;
    let members = repo::list_workspace_projects(pool, workspace_id)?;
    let adopted: Vec<WorkspaceKnowledge> = repo::list_knowledge(pool, workspace_id, Some("adopted"))?;
    let adoption = repo::list_adoption(pool, workspace_id)?;

    let mut out = Vec::new();
    for project in &members {
        // Per-project rollout state, so the file can mark what is canon *here*.
        let state_of = |practice_id: &str| -> Option<String> {
            adoption
                .iter()
                .find(|a| a.practice_id == practice_id && a.project_id == project.id)
                .map(|a| a.state.clone())
        };
        let applicable: Vec<(&WorkspaceKnowledge, Option<String>)> = adopted
            .iter()
            .filter(|k| {
                // An explicit `na` beats the heuristic — the matrix is the
                // stronger signal once a human or the fan-out has set it.
                if state_of(&k.id).as_deref() == Some("na") {
                    return false;
                }
                repo::applicability_matches(k.applicability.as_deref(), project.tech_stack.as_deref())
            })
            .map(|k| (k, state_of(&k.id)))
            .collect();

        match write_project_memory(project, &ws.name, &applicable) {
            Ok(linked) => out.push(ProjectionResult {
                project_id: project.id.clone(),
                project_name: project.name.clone(),
                practices: applicable.len() as u32,
                linked,
                skipped: None,
            }),
            Err(e) => out.push(ProjectionResult {
                project_id: project.id.clone(),
                project_name: project.name.clone(),
                practices: 0,
                linked: false,
                skipped: Some(e.to_string()),
            }),
        }
    }
    Ok(out)
}

/// Write one repo's memory file + ensure its import line. Returns whether the
/// import line was added on this run.
fn write_project_memory(
    project: &DevProject,
    workspace_name: &str,
    practices: &[(&WorkspaceKnowledge, Option<String>)],
) -> Result<bool, AppError> {
    let root = Path::new(&project.root_path);
    if !root.is_dir() {
        return Err(AppError::Validation(format!(
            "Project root is not a directory: {}",
            project.root_path
        )));
    }
    let claude_dir = root.join(".claude");
    std::fs::create_dir_all(&claude_dir)
        .map_err(|e| AppError::Internal(format!("create .claude/: {e}")))?;

    let body = render_practices_markdown(workspace_name, practices);
    std::fs::write(claude_dir.join(PRACTICES_FILE), &body)
        .map_err(|e| AppError::Internal(format!("write {PRACTICES_FILE}: {e}")))?;

    ensure_import_line(root)
}

/// Render the memory file. Written for a *session in that repo* — it states
/// what the workspace has adopted and how binding each item is here, without
/// pretending every practice is a hard rule.
fn render_practices_markdown(
    workspace_name: &str,
    practices: &[(&WorkspaceKnowledge, Option<String>)],
) -> String {
    let mut out = String::new();
    out.push_str("<!-- Auto-generated by personas workspace_projection — do not edit by hand. -->\n");
    out.push_str("<!-- Regenerated whenever the workspace's adopted practices change. -->\n\n");
    out.push_str(&format!("# {workspace_name} — shared practices\n\n"));

    if practices.is_empty() {
        out.push_str(
            "This workspace has not adopted any practices that apply to this project yet.\n",
        );
        return out;
    }

    out.push_str(&format!(
        "Practices the **{workspace_name}** workspace has adopted across its projects and that \
apply to this codebase. They are conventions to follow here unless this repo has a documented \
reason to differ — if you find such a reason, say so rather than silently diverging.\n\n",
    ));

    // Group by top-level topic segment so a long list stays navigable.
    let mut by_area: std::collections::BTreeMap<String, Vec<&(&WorkspaceKnowledge, Option<String>)>> =
        std::collections::BTreeMap::new();
    for entry in practices {
        let area = entry
            .0
            .topic
            .as_deref()
            .and_then(|t| t.split('/').next())
            .unwrap_or("general")
            .to_string();
        by_area.entry(area).or_default().push(entry);
    }

    for (area, items) in by_area {
        out.push_str(&format!("## {area}\n\n"));
        for (k, state) in items {
            let rollout = match state.as_deref() {
                Some("adopted") => " _(adopted here)_",
                Some("dispatched") => " _(rollout in progress here)_",
                Some("diverged") => " _(this repo currently diverges)_",
                Some("proposed") => " _(proposed for this repo)_",
                _ => "",
            };
            out.push_str(&format!("### {}{}\n\n", k.title.trim(), rollout));
            out.push_str(k.statement.trim());
            out.push_str("\n\n");
            if let Some(detail) = k.detail_md.as_deref() {
                let trimmed = detail.trim();
                if !trimmed.is_empty() {
                    // Evidence can be long; the session needs the claim plus a
                    // taste of the proof, not a transplanted essay.
                    let excerpt = personas_core::utils::text::truncate_on_char_boundary(trimmed, 1200);
                    out.push_str(excerpt);
                    if excerpt.len() < trimmed.len() {
                        out.push_str("\n\n_(evidence truncated)_");
                    }
                    out.push_str("\n\n");
                }
            }
        }
    }
    out
}

/// Ensure `<root>/CLAUDE.md` imports the practices file. Creates the file with
/// a stub when missing; otherwise appends the import line iff absent. Never
/// rewrites existing content.
fn ensure_import_line(root: &Path) -> Result<bool, AppError> {
    let claude_md = root.join("CLAUDE.md");

    if !claude_md.exists() {
        let body = format!(
            "<!-- Created by personas workspace projection — safe to edit. -->\n\
             <!-- The line below imports the workspace's adopted practices. -->\n\
             {IMPORT_LINE}\n"
        );
        std::fs::write(&claude_md, body)
            .map_err(|e| AppError::Internal(format!("write CLAUDE.md: {e}")))?;
        return Ok(true);
    }

    let existing = std::fs::read_to_string(&claude_md)
        .map_err(|e| AppError::Internal(format!("read CLAUDE.md: {e}")))?;
    if existing.contains(IMPORT_LINE) {
        return Ok(false);
    }

    let mut updated = existing;
    if !updated.ends_with('\n') {
        updated.push('\n');
    }
    updated.push('\n');
    updated.push_str(IMPORT_LINE);
    updated.push('\n');
    std::fs::write(&claude_md, updated)
        .map_err(|e| AppError::Internal(format!("update CLAUDE.md: {e}")))?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmpdir(tag: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!(
            "ws-projection-{tag}-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn creates_claude_md_when_missing() {
        let d = tmpdir("create");
        let added = ensure_import_line(&d).unwrap();
        assert!(added);
        let body = std::fs::read_to_string(d.join("CLAUDE.md")).unwrap();
        assert!(body.contains(IMPORT_LINE));
    }

    #[test]
    fn appends_once_and_preserves_user_content() {
        let d = tmpdir("append");
        let original = "# My project\n\nSome hand-written guidance the user cares about.\n";
        std::fs::write(d.join("CLAUDE.md"), original).unwrap();

        assert!(ensure_import_line(&d).unwrap(), "first run adds the line");
        let after_first = std::fs::read_to_string(d.join("CLAUDE.md")).unwrap();
        assert!(after_first.starts_with(original), "user content preserved verbatim");
        assert!(after_first.contains(IMPORT_LINE));

        // Idempotent: a second projection must not duplicate the import.
        assert!(!ensure_import_line(&d).unwrap(), "second run is a no-op");
        let after_second = std::fs::read_to_string(d.join("CLAUDE.md")).unwrap();
        assert_eq!(after_first, after_second);
        assert_eq!(after_second.matches(IMPORT_LINE).count(), 1);
    }

    #[test]
    fn handles_missing_trailing_newline() {
        let d = tmpdir("newline");
        std::fs::write(d.join("CLAUDE.md"), "no trailing newline").unwrap();
        ensure_import_line(&d).unwrap();
        let body = std::fs::read_to_string(d.join("CLAUDE.md")).unwrap();
        assert!(body.contains("no trailing newline\n"));
        assert!(body.contains(IMPORT_LINE));
    }

    fn practice(title: &str, statement: &str, topic: Option<&str>) -> WorkspaceKnowledge {
        WorkspaceKnowledge {
            id: uuid::Uuid::new_v4().to_string(),
            workspace_id: "ws".into(),
            kind: "pattern".into(),
            title: title.into(),
            statement: statement.into(),
            detail_md: None,
            topic: topic.map(|t| t.into()),
            abstraction: Some("macro".into()),
            ftype: Some("architecture".into()),
            durability: Some("durable".into()),
            governing_id: None,
            evidence_count: None,
            applicability: None,
            status: "adopted".into(),
            origin_project_id: None,
            provenance: None,
            confidence: None,
            dedup_key: None,
            superseded_by: None,
            valid_from: None,
            valid_to: None,
            decided_at: None,
            harvest_scope: None,
            created_at: "2026-01-01T00:00:00Z".into(),
            updated_at: "2026-01-01T00:00:00Z".into(),
        }
    }

    #[test]
    fn renders_empty_state_without_pretending() {
        let md = render_practices_markdown("Core", &[]);
        assert!(md.contains("has not adopted any practices"));
    }

    #[test]
    fn groups_by_topic_area_and_marks_rollout_state() {
        let a = practice("Use one IPC door", "All calls go through the wrapper.", Some("architecture/chokepoints"));
        let b = practice("Bound every read", "Cap rows and bytes.", Some("reliability/pipelines"));
        let entries = vec![(&a, Some("adopted".to_string())), (&b, Some("proposed".to_string()))];
        let refs: Vec<&(&WorkspaceKnowledge, Option<String>)> = entries.iter().collect();
        let _ = refs; // grouping is exercised through the render below
        let md = render_practices_markdown("Core", &entries);

        assert!(md.contains("## architecture"));
        assert!(md.contains("## reliability"));
        assert!(md.contains("Use one IPC door_(adopted here)_") || md.contains("(adopted here)"));
        assert!(md.contains("(proposed for this repo)"));
        // The generated file must announce itself as generated.
        assert!(md.contains("do not edit by hand"));
    }
}
