//! `.personas/skill-registry.json` — the OFFLINE orchestration surface of the
//! skill standard (docs/skill-standard.md). A CLI/LLM finishing a skill run in
//! a managed repo has no app, no DB and possibly no network; this file tells
//! it, from disk alone: which skills this repo has at which declared version,
//! what the workspace library carries, and which sibling projects run the same
//! skill (with recent usage) — everything the reflection contract's sync
//! ritual needs to decide "bump and publish" vs "record the lesson only".
//!
//! Same posture as `context_map_export::write_backlog_digest`: filesystem
//! truth for versions (the DB may lag a scan), DB only for usage counts;
//! best-effort at call sites (log + swallow); git-tracked by design so the
//! snapshot travels with the repo.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde_json::{json, Value};
use tauri::State;

use crate::db::repos::dev_tools as repo;
use crate::db::DbPool;
use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::AppState;

use super::skill_files::{global_skills_dir, scan_skills_dir, SkillEntry};

/// Forward-slash a path for LLM friendliness (the file is read by CLI agents
/// on every platform; backslash escapes in JSON invite misquoting).
fn fwd(p: &Path) -> String {
    p.to_string_lossy().replace('\\', "/")
}

fn skills_of(root: &str) -> Vec<SkillEntry> {
    scan_skills_dir(&PathBuf::from(root).join(".claude").join("skills"))
}

/// `(id, name, root_path)` of a registered sibling project.
type SiblingRow = (String, String, String);

/// The origin URL of a directory's git working copy, or None when it has none.
/// Read-only and best-effort: a library that is a plain directory is a
/// legitimate case, not a defect to report.
fn git_remote_of(dir: &Path) -> Option<String> {
    let out = std::process::Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(["remote", "get-url", "origin"])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let url = String::from_utf8(out.stdout).ok()?.trim().to_string();
    (!url.is_empty()).then_some(url)
}

/// The commit a directory's git working copy is at. Same contract as above.
fn git_head_of(dir: &Path) -> Option<String> {
    let out = std::process::Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(["rev-parse", "HEAD"])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let sha = String::from_utf8(out.stdout).ok()?.trim().to_string();
    (!sha.is_empty()).then_some(sha)
}

/// Build and write the registry file. Returns the number of skills written.
///
/// `library_root` is the library this snapshot COMPARES AGAINST. When the
/// project's workspace holds a knowledge registry, that registry's `skills/`
/// lane is the library, and the versions in this file are the versions the
/// fleet actually reads — which is the whole point of the comparison. Passing
/// `None` keeps the user-global library (`~/.claude/skills`), which is what
/// every internal caller does and what the app did before registries existed.
///
/// This matters more than it looks: the reflection ritual in
/// `docs/skill-standard.md` decides whether to bump a version, and whether it is
/// BEHIND, by reading this file. Point it at the wrong library and every one of
/// those judgements is made against a library nobody publishes from.
pub fn write_skill_registry(
    pool: &DbPool,
    project_id: &str,
    root_path: &str,
    library_root: Option<&str>,
) -> Result<usize, AppError> {
    let conn = pool.get()?;

    // Workspace + siblings (may both be absent — the file is still useful for
    // the library comparison alone).
    let workspace: Option<(String, String)> = conn
        .query_row(
            "SELECT w.id, w.name FROM dev_workspaces w
             JOIN dev_projects p ON p.workspace_id = w.id
             WHERE p.id = ?1",
            [project_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .ok();
    let project_name: String = conn
        .query_row(
            "SELECT name FROM dev_projects WHERE id = ?1",
            [project_id],
            |r| r.get(0),
        )
        .unwrap_or_else(|_| "unknown".into());
    let siblings: Vec<SiblingRow> = match &workspace {
        None => Vec::new(),
        Some((wid, _)) => {
            let mut stmt = conn.prepare(
                "SELECT id, name, root_path FROM dev_projects
                 WHERE workspace_id = ?1 AND id != ?2 ORDER BY name",
            )?;
            let rows = stmt.query_map([wid.as_str(), project_id], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?))
            })?;
            rows.flatten().collect()
        }
    };

    // Filesystem truth: this project's skills, the library, each sibling's
    // skills (workspaces are single-digit small; the walk is cheap). Siblings
    // on unreadable/disconnected roots simply scan empty and drop out.
    let mine = skills_of(root_path);
    let library_dir: Option<std::path::PathBuf> =
        match library_root.map(str::trim).filter(|r| !r.is_empty()) {
            Some(root) => Some(std::path::PathBuf::from(root)),
            None => global_skills_dir(),
        };
    // A named library that is not on disk scans EMPTY rather than falling back
    // to the home library. Comparing against the wrong library silently is how
    // a skill gets "published" over a newer copy nobody looked at.
    let library: std::collections::HashMap<String, SkillEntry> = library_dir
        .as_deref()
        .filter(|d| d.is_dir())
        .map(scan_skills_dir)
        .unwrap_or_default()
        .into_iter()
        .map(|e| (e.name.clone(), e))
        .collect();
    let sibling_skills: Vec<(&SiblingRow, Vec<SkillEntry>)> =
        siblings.iter().map(|s| (s, skills_of(&s.2))).collect();

    // 30-day invokes per (skill, project) across the workspace — DB's only
    // contribution. Missing telemetry degrades to zeros, never an error.
    let mut invokes: std::collections::HashMap<(String, String), i64> =
        std::collections::HashMap::new();
    {
        let ids: Vec<&str> = siblings
            .iter()
            .map(|(id, _, _)| id.as_str())
            .chain(std::iter::once(project_id))
            .collect();
        let placeholders = ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let sql = format!(
            "SELECT skill_name, project_id, COUNT(*) FROM skill_usage_events
             WHERE project_id IN ({placeholders})
               AND occurred_at >= datetime('now','-30 days')
             GROUP BY skill_name, project_id"
        );
        if let Ok(mut stmt) = conn.prepare(&sql) {
            let params: Vec<&dyn rusqlite::types::ToSql> = ids
                .iter()
                .map(|s| s as &dyn rusqlite::types::ToSql)
                .collect();
            if let Ok(rows) = stmt.query_map(params.as_slice(), |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, Option<String>>(1)?,
                    r.get::<_, i64>(2)?,
                ))
            }) {
                for row in rows.flatten() {
                    if let (name, Some(pid), n) = row {
                        invokes.insert((name, pid), n);
                    }
                }
            }
        }
    }

    let skills_json: Vec<Value> = mine
        .iter()
        .map(|e| {
            let lib = library.get(&e.name);
            let sib_json: Vec<Value> = sibling_skills
                .iter()
                .filter_map(|((sid, sname, sroot), entries)| {
                    let found = entries.iter().find(|se| se.name == e.name)?;
                    Some(json!({
                        "project": sname,
                        "root_path": fwd(Path::new(sroot)),
                        "version": found.version,
                        "invokes_30d": invokes.get(&(e.name.clone(), sid.clone())).copied().unwrap_or(0),
                    }))
                })
                .collect();
            json!({
                "name": e.name,
                "version": e.version,
                "sync_state": e.sync_state,
                "invokes_30d": invokes.get(&(e.name.clone(), project_id.to_string())).copied().unwrap_or(0),
                "library": lib.map(|l| json!({ "version": l.version })),
                "siblings": sib_json,
            })
        })
        .collect();

    let count = skills_json.len();
    let doc = json!({
        "version": 1,
        "generated_at": chrono::Utc::now().to_rfc3339(),
        "workspace": workspace.as_ref().map(|(id, name)| json!({ "id": id, "name": name })),
        "project": {
            "id": project_id,
            "name": project_name,
            "root_path": fwd(Path::new(root_path)),
        },
        "library_path": library_dir.as_deref().map(fwd),
        // Named so the agent can tell which contract it is under: the registry
        // lane uses semver and a closed category set, the home library neither.
        "library_kind": if library_root.is_some() { "registry" } else { "home" },
        // WHERE the library came from and WHICH commit it is at. A path alone is
        // this machine's fact; the remote plus the commit is the one every other
        // consumer shares, and it is what turns "the library moved" into a range
        // someone can actually read.
        "library_remote": library_dir.as_deref().and_then(git_remote_of),
        "library_commit": library_dir.as_deref().and_then(git_head_of),
        "skills": skills_json,
        "note": "Snapshot written by the Personas app; may be up to one scan old. \
                 Compare `version` fields (major.minor; null = unversioned, treat as 1.0) \
                 to judge staleness — not hashes. `library: null` means the skill is not \
                 in the workspace library. See docs/skill-standard.md for the reflection \
                 and sync contract that consumes this file.",
    });

    let dir = Path::new(root_path).join(".personas");
    std::fs::create_dir_all(&dir)
        .map_err(|e| AppError::Internal(format!("create .personas dir: {e}")))?;
    let pretty = serde_json::to_string_pretty(&doc)
        .map_err(|e| AppError::Internal(format!("serialize skill-registry.json: {e}")))?;
    std::fs::write(dir.join("skill-registry.json"), pretty)
        .map_err(|e| AppError::Internal(format!("write skill-registry.json: {e}")))?;
    Ok(count)
}

/// On-demand export — the frontend calls this before dispatching a skill run
/// so the repo's registry snapshot is current when the session's reflection
/// step reads it (mirrors `dev_tools_export_backlog_digest`).
#[tauri::command]
pub fn dev_tools_export_skill_registry(
    state: State<'_, Arc<AppState>>,
    project_id: String,
    library_root: Option<String>,
) -> Result<usize, AppError> {
    require_auth_sync(&state)?;
    let project = repo::get_project_by_id(&state.db, &project_id)?;
    write_skill_registry(
        &state.db,
        &project_id,
        &project.root_path,
        library_root.as_deref(),
    )
}
