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

// ── run_pattern_harvest ─────────────────────────────────────────────────

/// Sessions one `run_pattern_harvest` may start. Deliberately below the
/// fleet-dispatch cap of 8: harvest sessions are read-heavy and the canvas
/// work proved parallel spawning stalls the machine — and a second wave can
/// always follow once coverage says what is still owed.
const HARVEST_MAX_SESSIONS: usize = 4;

/// `run_pattern_harvest` — Athena's door into the practice-harvest pipeline
/// (docs/plans/workspace-knowledge-center.md §7): prepare the grounding
/// snapshot (same writer as the Workspaces UI), pick territories stale-first,
/// dispatch one Fleet session per scope under one Operation, and register the
/// (workspace, project) with the harvest watcher so results ingest through
/// the ONE governed door when the sessions settle — no UI required, no second
/// write path, items land `observed` for human review exactly as ever.
///
/// Params: `{project, scopes?: [scope_id, …], max_sessions?: 1..4}`. Without
/// `scopes`, territories are chosen never-harvested-first, then oldest.
pub(crate) fn execute_run_pattern_harvest(
    state: &State<'_, Arc<AppState>>,
    app: &tauri::AppHandle,
    params: &serde_json::Value,
) -> Result<ExecuteResult, AppError> {
    use crate::commands::infrastructure::workspace_harvest as harvest;

    let project_q = params
        .get("project")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| {
            AppError::Validation("run_pattern_harvest: missing `project` (name or id)".into())
        })?;
    let conn = state.db.get()?;
    let (project_id, workspace_id, root_path): (String, Option<String>, String) = conn
        .query_row(
            "SELECT id, workspace_id, root_path FROM dev_projects
             WHERE id = ?1 OR name = ?1 COLLATE NOCASE
             ORDER BY (id = ?1) DESC LIMIT 1",
            rusqlite::params![project_q],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .map_err(|_| {
            AppError::Validation(format!(
                "run_pattern_harvest: unknown project `{project_q}` — use describe_knowledge \
                 for the roster"
            ))
        })?;
    let Some(workspace_id) = workspace_id else {
        return Err(AppError::Validation(format!(
            "run_pattern_harvest: `{project_q}` is not a member of any workspace — the \
             knowledge library is workspace-scoped, so there is nowhere to harvest into"
        )));
    };
    // Containment: harvest sessions run `claude` in this cwd. The project is
    // registered by construction, but the fleet boundary check is THE
    // boundary — go through it like every other spawn.
    validate_fleet_cwd(app, &root_path)?;

    let max_sessions = params
        .get("max_sessions")
        .and_then(|v| v.as_u64())
        .map(|n| n as usize)
        .unwrap_or(3)
        .clamp(1, HARVEST_MAX_SESSIONS);
    let explicit: Option<Vec<String>> = params.get("scopes").and_then(|v| v.as_array()).map(|a| {
        a.iter()
            .filter_map(|x| x.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .collect()
    });

    // Prepare writes snapshot.json into the repo and returns the territory
    // ledger (coverage-joined) this selection reads.
    let core = harvest::prepare_harvest_core(state, &workspace_id, &project_id)?;

    // Choose territories. Explicit ids are honored (unknown ones reported);
    // otherwise stale-first: never harvested, then oldest `last_harvested_at`.
    let mut skipped: Vec<String> = Vec::new();
    let mut chosen: Vec<(String, String, i64)> = Vec::new(); // (id, label, files)
    match explicit {
        Some(ids) => {
            for id in ids {
                match core.scopes.iter().find(|(sid, ..)| *sid == id) {
                    Some((sid, label, files, _)) => {
                        chosen.push((sid.clone(), label.clone(), *files))
                    }
                    None => skipped.push(format!("`{id}`: not a territory of this repo")),
                }
            }
        }
        None => {
            let mut ranked: Vec<&(String, String, i64, Option<String>)> =
                core.scopes.iter().collect();
            ranked.sort_by(|a, b| match (&a.3, &b.3) {
                (None, None) => b.2.cmp(&a.2), // both never harvested → bigger first
                (None, Some(_)) => std::cmp::Ordering::Less,
                (Some(_), None) => std::cmp::Ordering::Greater,
                (Some(x), Some(y)) => x.cmp(y), // oldest first
            });
            chosen = ranked
                .into_iter()
                .map(|(id, label, files, _)| (id.clone(), label.clone(), *files))
                .collect();
        }
    }
    // Skip territories already being harvested right now (live session under
    // the same dedup key), then cap.
    let sessions = crate::commands::fleet::registry::registry().list_dto();
    chosen.retain(|(sid, label, _)| {
        let key = harvest::harvest_dispatch_key(&workspace_id, &project_id, sid);
        let live = sessions.iter().any(|s| {
            s.name.as_deref().is_some_and(|n| n.contains(&key))
                && matches!(
                    s.state,
                    crate::commands::fleet::types::FleetSessionState::Spawning
                        | crate::commands::fleet::types::FleetSessionState::Running
                        | crate::commands::fleet::types::FleetSessionState::AwaitingInput
                )
        });
        if live {
            skipped.push(format!("{label}: a harvest session is already working here"));
        }
        !live
    });
    chosen.truncate(max_sessions);
    if chosen.is_empty() {
        return Err(AppError::Validation(format!(
            "run_pattern_harvest: no dispatchable territory.{}",
            if skipped.is_empty() {
                " The repo derived no scopes — is the root path readable?".to_string()
            } else {
                format!(" Skipped: {}", skipped.join("; "))
            }
        )));
    }

    // One Operation for the wave — the reconciler + live-ops strip see it the
    // same way a fleet_dispatch is seen.
    let intent = format!(
        "[practice-harvest] {}: {} territor{} ({})",
        core.project_name,
        chosen.len(),
        if chosen.len() == 1 { "y" } else { "ies" },
        chosen.iter().map(|(_, l, _)| l.as_str()).collect::<Vec<_>>().join(", "),
    );
    let op_id = crate::companion::orchestration::operative_memory::memory()
        .begin_dispatched_operation(intent.clone());

    let sentinel = crate::commands::fleet::registry::ATHENA_SESSION_NAME_SENTINEL;
    let mut spawned: Vec<String> = Vec::new();
    let mut failures: Vec<String> = Vec::new();
    for (sid, label, files) in &chosen {
        let prompt = harvest::build_harvest_prompt(
            &core.workspace_name,
            &core.project_name,
            (sid, label, *files),
        );
        match crate::commands::fleet::pty::spawn_session(
            app.clone(),
            std::path::PathBuf::from(&root_path),
            vec![prompt],
            120,
            32,
        ) {
            Ok(id) => {
                let _ = crate::companion::orchestration::operative_memory::memory()
                    .attach_session_to_operation(&op_id, &id, label, &root_path);
                // The name must carry BOTH the Athena sentinel (ownership
                // guards) and the dedup key (both harvest watchers find
                // sessions by this substring).
                let key = harvest::harvest_dispatch_key(&workspace_id, &project_id, sid);
                let _ = crate::commands::fleet::registry::registry()
                    .rename(&id, Some(format!("{sentinel} · {key}")));
                spawned.push(label.clone());
            }
            Err(e) => failures.push(format!("{label}: spawn failed: {e}")),
        }
    }
    if spawned.is_empty() {
        return Err(AppError::Internal(format!(
            "run_pattern_harvest: every spawn failed.\n{}",
            failures.join("\n")
        )));
    }
    // Register with the watcher — results ingest on the fleet ticker once the
    // sessions settle, UI open or not.
    harvest::note_pending_harvest(&workspace_id, &project_id);
    crate::companion::orchestration::emit_digest_changed(app);

    let mut msg = format!(
        "Harvesting {} — {} session(s) dispatched: {}.",
        core.project_name,
        spawned.len(),
        spawned.join(", "),
    );
    if !skipped.is_empty() {
        msg.push_str(&format!("\nSkipped: {}", skipped.join("; ")));
    }
    if !failures.is_empty() {
        msg.push_str(&format!("\nFailures: {}", failures.join("; ")));
    }
    msg.push_str(
        "\nResults land as `observed` items in the knowledge review queue once the sessions \
         finish — adoption stays a human decision.",
    );
    Ok(ExecuteResult::message(msg))
}
