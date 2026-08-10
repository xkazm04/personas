//! `approval_exec_knowledge` — executors for Athena's operations over the two
//! cross-project knowledge surfaces (docs/skill-standard.md, the workspace
//! knowledge library / pattern fabric). Part of the approval module family;
//! shared imports and the Tauri-facing types live in `mod.rs`.
//!
//! The read side lives in `companion::knowledge_ops` (auto-fire READ_OPS);
//! this file is the ACT side. All of it goes through the one shared executor
//! table (`execute_approval_action`), so manual clicks and autonomous
//! auto-fire are the same code with a different consent surface.

#[allow(unused_imports)]
use super::*;

use crate::commands::infrastructure::skill_files;

/// Longest accepted `targets` fan-out for one `skill_sync`. Workspaces are
/// single-digit small; a longer list is a hallucinated loop.
const SKILL_SYNC_MAX_TARGETS: usize = 12;

/// `skill_sync` — move ONE skill between the workspace library and project
/// copies, in one of three directions:
///
/// - `adopt`:   library → each target that does NOT yet have the skill
///              (existing copies are skipped, never overwritten).
/// - `sync`:    library → each target whose copy is BEHIND the library's
///              declared version. A `diverged` (customized) copy is skipped
///              and reported — autonomous or not, local edits are never
///              clobbered by a sync.
/// - `publish`: `source` project's copy → the library, guarded inside
///              `publish_skill_to_library`: the copy must be a version bump.
///
/// Pure file operations plus a best-effort `.personas/skill-registry.json`
/// refresh per touched repo — no CLI session, no LLM cost. Params:
/// `{skill, action, source?, targets: [project name|id, …]}`.
pub(crate) fn execute_skill_sync(
    state: &State<'_, Arc<AppState>>,
    params: &serde_json::Value,
) -> Result<ExecuteResult, AppError> {
    let skill = params
        .get("skill")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| AppError::Validation("skill_sync: missing `skill`".into()))?;
    let action = params
        .get("action")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .unwrap_or("");
    if !matches!(action, "adopt" | "sync" | "publish") {
        return Err(AppError::Validation(format!(
            "skill_sync: `action` must be adopt | sync | publish (got `{action}`)"
        )));
    }

    let conn = state.db.get()?;
    let resolve = |needle: &str| -> Option<(String, String)> {
        conn.query_row(
            "SELECT id, name FROM dev_projects
             WHERE id = ?1 OR name = ?1 COLLATE NOCASE
             ORDER BY (id = ?1) DESC LIMIT 1",
            rusqlite::params![needle],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .ok()
    };

    if action == "publish" {
        let source = params
            .get("source")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .ok_or_else(|| {
                AppError::Validation(
                    "skill_sync publish: missing `source` (the project whose copy to publish)"
                        .into(),
                )
            })?;
        let (source_id, source_name) = resolve(source).ok_or_else(|| {
            AppError::Validation(format!("skill_sync publish: unknown project `{source}`"))
        })?;
        let (version, files) =
            skill_files::publish_skill_to_library(state, skill, &source_id)?;
        // The library moved — every project carrying the skill now reads as
        // behind. Refresh the registry snapshots so offline sessions see it.
        let carriers: Vec<String> = conn
            .prepare("SELECT id FROM dev_projects")
            .and_then(|mut s| {
                let rows = s.query_map([], |r| r.get::<_, String>(0))?;
                Ok(rows.flatten().collect())
            })
            .unwrap_or_default();
        for pid in &carriers {
            skill_files::refresh_skill_registry_file(state, pid);
        }
        return Ok(ExecuteResult::message(format!(
            "Published `{skill}` {version} from {source_name} to the workspace library \
             ({files} file(s)). Other projects' copies now read as behind — a follow-up \
             `skill_sync` with action `sync` brings them up."
        )));
    }

    // adopt / sync — need targets.
    let raw_targets: Vec<String> = params
        .get("targets")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|x| x.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();
    if raw_targets.is_empty() {
        return Err(AppError::Validation(format!(
            "skill_sync {action}: `targets` must name at least one registered project"
        )));
    }
    if raw_targets.len() > SKILL_SYNC_MAX_TARGETS {
        return Err(AppError::Validation(format!(
            "skill_sync {action}: {} targets is past the cap of {SKILL_SYNC_MAX_TARGETS}",
            raw_targets.len()
        )));
    }

    // Library version, for the sync verdicts. Missing library copy fails
    // adopt/sync early with an honest message instead of N copy errors.
    let library_version: Option<Option<String>> =
        skill_files::global_skills_dir().and_then(|d| {
            let entries = skill_files::scan_skills_dir(&d);
            entries.iter().find(|e| e.name == skill).map(|e| e.version.clone())
        });
    if library_version.is_none() {
        return Err(AppError::Validation(format!(
            "skill_sync {action}: `{skill}` is not in the workspace library. `publish` it \
             from a project first, or check the name with `describe_skill_fleet`."
        )));
    }

    let mut lines: Vec<String> = Vec::new();
    for t in &raw_targets {
        let Some((pid, pname)) = resolve(t) else {
            lines.push(format!("{t}: unknown project — skipped"));
            continue;
        };
        // The target's current copy decides the verdict.
        let root: Result<String, _> = conn.query_row(
            "SELECT root_path FROM dev_projects WHERE id = ?1",
            rusqlite::params![&pid],
            |r| r.get(0),
        );
        let copy = root.ok().and_then(|root| {
            let dir = std::path::PathBuf::from(root).join(".claude").join("skills");
            skill_files::scan_skills_dir(&dir).into_iter().find(|e| e.name == skill)
        });

        match (action, &copy) {
            ("adopt", Some(_)) => {
                lines.push(format!("{pname}: already has `{skill}` — skipped (use `sync` to update)"));
            }
            ("adopt", None) => match skill_files::install_skill_copy(state, skill, None, &pid, false) {
                Ok(r) if r.installed => {
                    lines.push(format!("{pname}: adopted ({} file(s))", r.file_count))
                }
                Ok(_) => lines.push(format!("{pname}: already exists — skipped")),
                Err(e) => lines.push(format!("{pname}: failed — {e}")),
            },
            ("sync", None) => {
                lines.push(format!("{pname}: does not have `{skill}` — use `adopt` instead"));
            }
            ("sync", Some(c)) if c.sync_state == "diverged" => {
                lines.push(format!(
                    "{pname}: copy is CUSTOMIZED (content diverged) — not overwritten; \
                     publish its improvements or reconcile by hand"
                ));
            }
            ("sync", Some(c)) => {
                let lib = skill_files::parse_skill_version(
                    library_version.as_ref().and_then(|v| v.as_deref()),
                );
                let local = skill_files::parse_skill_version(c.version.as_deref());
                if local >= lib {
                    lines.push(format!("{pname}: already at {} — nothing to sync", ver(&c.version)));
                } else {
                    match skill_files::install_skill_copy(state, skill, None, &pid, true) {
                        Ok(r) => lines.push(format!(
                            "{pname}: synced {} → library version ({} file(s))",
                            ver(&c.version),
                            r.file_count
                        )),
                        Err(e) => lines.push(format!("{pname}: failed — {e}")),
                    }
                }
            }
            _ => unreachable!("action validated above"),
        }
    }

    Ok(ExecuteResult::message(format!(
        "skill_sync {action} `{skill}`:\n{}",
        lines.join("\n")
    )))
}

fn ver(v: &Option<String>) -> &str {
    v.as_deref().unwrap_or("1.0")
}
