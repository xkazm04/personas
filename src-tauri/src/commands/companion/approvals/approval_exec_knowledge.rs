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

/// One workspace territory as it comes out of the database: the group's id
/// and name, then its contexts as `(context id, context name, paths)`.
type OwnedTerritory = (String, String, Vec<(String, String, Vec<String>)>);

/// A territory reduced to what a digest renderer needs — the group name and
/// its contexts as `(context name, paths)` — owning the context list.
type TerritoryDigest<'a> = (&'a str, Vec<(String, Vec<String>)>);

/// The same digest as a prompt-builder argument, borrowing the context list.
type TerritoryArg<'a> = (&'a str, &'a [(String, Vec<String>)]);

/// Longest accepted `targets` fan-out for one `skill_sync`. Workspaces are
/// single-digit small; a longer list is a hallucinated loop.
const SKILL_SYNC_MAX_TARGETS: usize = 12;

/// `skill_sync` — move ONE skill between the workspace library and project
/// copies, in one of three directions:
///
/// - `adopt`:   library → each target that does NOT yet have the skill
///   (existing copies are skipped, never overwritten).
/// - `sync`:    library → each target whose copy is BEHIND the library's
///   declared version. A `diverged` (customized) copy is skipped
///   and reported — autonomous or not, local edits are never
///   clobbered by a sync.
/// - `publish`: `source` project's copy → the library, guarded inside
///   `publish_skill_to_library`: the copy must be a version bump.
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
        let (version, files) = skill_files::publish_skill_to_library(state, skill, &source_id)?;
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
    let library_version: Option<Option<String>> = skill_files::global_skills_dir().and_then(|d| {
        let entries = skill_files::scan_skills_dir(&d);
        entries
            .iter()
            .find(|e| e.name == skill)
            .map(|e| e.version.clone())
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
            let dir = std::path::PathBuf::from(root)
                .join(".claude")
                .join("skills");
            skill_files::scan_skills_dir(&dir)
                .into_iter()
                .find(|e| e.name == skill)
        });

        match (action, &copy) {
            ("adopt", Some(_)) => {
                lines.push(format!(
                    "{pname}: already has `{skill}` — skipped (use `sync` to update)"
                ));
            }
            ("adopt", None) => {
                match skill_files::install_skill_copy(state, skill, None, &pid, false) {
                    Ok(r) if r.installed => {
                        lines.push(format!("{pname}: adopted ({} file(s))", r.file_count))
                    }
                    Ok(_) => lines.push(format!("{pname}: already exists — skipped")),
                    Err(e) => lines.push(format!("{pname}: failed — {e}")),
                }
            }
            ("sync", None) => {
                lines.push(format!(
                    "{pname}: does not have `{skill}` — use `adopt` instead"
                ));
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
                    lines.push(format!(
                        "{pname}: already at {} — nothing to sync",
                        ver(&c.version)
                    ));
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
                                                             // Depth class of a territory: 0 = never harvested, 1 = harvested but depth
                                                             // unknown (pre-depth-report runs), 2 = below the depth target, 3 = read.
                                                             // The deep-re-scan ladder only auto-selects classes 0-2 — once everything
                                                             // reads >= HARVEST_DEPTH_TARGET_PCT, the ladder has nothing to pick and
                                                             // stops honestly. Explicit scope ids bypass the class filter (the operator
                                                             // or Athena may deliberately re-read a "read" territory).
    type ScopeRow = (String, String, i64, Option<String>, Option<i64>);
    fn depth_class(s: &ScopeRow) -> u8 {
        use crate::commands::infrastructure::workspace_harvest::HARVEST_DEPTH_TARGET_PCT;
        match (&s.3, s.4) {
            (None, _) => 0,
            (Some(_), None) => 1,
            (Some(_), Some(p)) if p < HARVEST_DEPTH_TARGET_PCT => 2,
            _ => 3,
        }
    }
    match explicit {
        Some(ids) => {
            for id in ids {
                match core.scopes.iter().find(|(sid, ..)| *sid == id) {
                    Some((sid, label, files, _, _)) => {
                        chosen.push((sid.clone(), label.clone(), *files))
                    }
                    None => skipped.push(format!("`{id}`: not a territory of this repo")),
                }
            }
        }
        None => {
            let mut ranked: Vec<&ScopeRow> =
                core.scopes.iter().filter(|s| depth_class(s) < 3).collect();
            ranked.sort_by(|a, b| {
                depth_class(a)
                    .cmp(&depth_class(b))
                    .then_with(|| match depth_class(a) {
                        // Never harvested: biggest territory first (most unread ground).
                        0 => b.2.cmp(&a.2),
                        // Depth unknown: oldest pass first.
                        1 => a.3.cmp(&b.3),
                        // Below target: shallowest first.
                        _ => a.4.unwrap_or(0).cmp(&b.4.unwrap_or(0)),
                    })
            });
            chosen = ranked
                .into_iter()
                .map(|(id, label, files, _, _)| (id.clone(), label.clone(), *files))
                .collect();
            if chosen.is_empty() {
                return Err(AppError::Validation(format!(
                    "run_pattern_harvest: every territory of {} already reads at or above                      {}% depth — the extraction ladder is done here. Name explicit `scopes`                      if you deliberately want a re-read.",
                    core.project_name,
                    harvest::HARVEST_DEPTH_TARGET_PCT
                )));
            }
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
            skipped.push(format!(
                "{label}: a harvest session is already working here"
            ));
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
        chosen
            .iter()
            .map(|(_, l, _)| l.as_str())
            .collect::<Vec<_>>()
            .join(", "),
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

// ── apply_pattern ───────────────────────────────────────────────────────

/// Adopted patterns one apply session may carry. More than this is not one
/// session's brief, it is a migration — split it across waves.
const APPLY_MAX_PATTERNS: usize = 8;

/// Concurrent apply sessions per repo (campaign doctrine, operator's call
/// 2026-08-11: "aggressive 4"). Sessions must target DISJOINT context groups
/// — the group token in the session name is how overlap is refused — because
/// they share one checkout; four writers on the same files is the 2026-05-09
/// incident with extra steps.
const APPLY_MAX_CONCURRENT_PER_REPO: usize = 4;

/// One pattern's violation evidence inside the target repo, read from the
/// pattern×context adherence cells: `(context names, evidence file paths)`.
pub(crate) struct ViolationBrief {
    pub contexts: Vec<String>,
    pub files: Vec<String>,
}

/// Build the apply session's brief. Pure so the shape is testable: the
/// consent doctrine (never write adoption records; commit atomically; honest
/// report) must survive any rewrite. `territory` scopes the session to one
/// context group's contexts/paths (None = whole repo); `violations` carries
/// the verify lane's evidence per pattern id when verdicts exist.
pub(crate) fn build_apply_prompt(
    project_name: &str,
    objective: Option<&str>,
    patterns: &[(String, String, String, Option<String>)], // (id, title, statement, detail)
    territory: Option<TerritoryArg<'_>>,
    violations: &std::collections::BTreeMap<String, ViolationBrief>,
) -> String {
    let mut cards = String::new();
    for (id, title, statement, detail) in patterns {
        cards.push_str(&format!("\n### {title} (`{id}`)\n{statement}\n"));
        if let Some(d) = detail {
            let d = d.trim();
            let clipped: String = d.chars().take(1200).collect();
            cards.push_str(&clipped);
            if d.chars().count() > 1200 {
                cards.push('…');
            }
            cards.push('\n');
        }
        // The verify lane's evidence, when it exists, is the session's work
        // list — measured violations beat a fresh survey.
        if let Some(v) = violations.get(id) {
            cards.push_str(&format!(
                "KNOWN VIOLATIONS (from the verify lane — start here): contexts {}{}\n",
                v.contexts.join(", "),
                if v.files.is_empty() {
                    String::new()
                } else {
                    format!("; cited files: {}", v.files.join(", "))
                }
            ));
        } else if !violations.is_empty() {
            cards.push_str(
                "No measured violation in scope for this one — verify before changing \
                 anything, and prefer an honest no-op.\n",
            );
        }
    }
    let objective_line = objective
        .map(|o| format!("\nOPERATOR OBJECTIVE — {o}\n"))
        .unwrap_or_default();
    let territory_block = match territory {
        None => String::new(),
        Some((group, contexts)) => {
            let mut b = format!(
                "\nYOUR TERRITORY — the `{group}` context group. Concurrent sessions own OTHER \
                 groups of this repo; writing outside your territory collides with them.\n"
            );
            for (name, paths) in contexts.iter().take(24) {
                b.push_str(&format!("- {name}: {}\n", paths.join(", ")));
            }
            b.push_str(
                "Stay inside these paths for every EDIT. Reading anywhere is fine; \
                 shared/generated files (lockfiles, generated bindings, i18n catalogs) are \
                 OFF LIMITS — if a change genuinely needs one, report it instead of editing.\n",
            );
            b
        }
    };
    format!(
        "You are implementing ADOPTED workspace practices in the \"{project_name}\" repository.\n\
         {objective_line}{territory_block}\
         \nTHE PRACTICES — each is canon this workspace already adopted; your job is to make \
         this repo actually follow them where it currently does not:\n{cards}\n\
         METHOD:\n\
         - If `.claude/patterns/` exists in this repo, read its README router first — it \
         carries the full library, this repo's adoption state and per-playbook briefs; prefer \
         its exemplars over inventing your own shape.\n\
         - For each practice: start from the KNOWN VIOLATIONS above when given (they are \
         measured, with cited files); otherwise find where this repo violates or lacks it \
         (search broadly, cite real files). Apply the minimal faithful change, and run the \
         repo's own gates (typecheck / lint / tests as the repo defines them) before moving on.\n\
         - Commit atomically — one practice (or one coherent site) per commit, message naming \
         the practice. Stage files by explicit path, NEVER `git add -A` — other sessions may \
         be working in this checkout.\n\
         - A practice this repo genuinely already follows, or that does not apply to this \
         stack: SAY SO in your summary and touch nothing — an honest no-op beats a cosmetic \
         change.\n\
         \nHARD RULES:\n\
         - You are changing code, not records: never write adoption/adherence/verification \
         state anywhere — the verify lane measures adherence AFTER your work, from evidence.\n\
         - Stay inside this repository{}.\n\
         - End with a short summary: per practice — applied (where) / already-followed / \
         not-applicable (why).",
        if territory.is_some() {
            " and inside your territory for edits"
        } else {
            ""
        }
    )
}

/// `apply_pattern` — dispatch ONE Fleet session that implements adopted
/// workspace patterns (or an active playbook's members) in a target project.
/// The session changes code and commits; it never writes adoption or
/// adherence records — those only move through the verify lane, from
/// evidence.
///
/// Params: `{target_project, pattern_ids?: [id…], playbook?: slug,
/// context_group?: <group name>, objective?}` — at least one of
/// `pattern_ids` / `playbook`. `context_group` scopes the session's WRITE
/// territory to one context group, which is what makes concurrent waves safe:
/// up to [`APPLY_MAX_CONCURRENT_PER_REPO`] live apply sessions per repo, each
/// on a DISJOINT group (same-group overlap is refused; a second un-scoped
/// whole-repo session is refused outright).
pub(crate) fn execute_apply_pattern(
    state: &State<'_, Arc<AppState>>,
    app: &tauri::AppHandle,
    params: &serde_json::Value,
) -> Result<ExecuteResult, AppError> {
    let target_q = params
        .get("target_project")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| {
            AppError::Validation("apply_pattern: missing `target_project` (name or id)".into())
        })?;
    let conn = state.db.get()?;
    let (project_id, workspace_id, root_path, project_name): (
        String,
        Option<String>,
        String,
        String,
    ) = conn
        .query_row(
            "SELECT id, workspace_id, root_path, name FROM dev_projects
             WHERE id = ?1 OR name = ?1 COLLATE NOCASE
             ORDER BY (id = ?1) DESC LIMIT 1",
            rusqlite::params![target_q],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .map_err(|_| {
            AppError::Validation(format!("apply_pattern: unknown project `{target_q}`"))
        })?;
    let Some(workspace_id) = workspace_id else {
        return Err(AppError::Validation(format!(
            "apply_pattern: `{project_name}` is not in a workspace — there is no adopted \
             library to apply from"
        )));
    };
    validate_fleet_cwd(app, &root_path)?;

    // Territory: an optional context group scopes the session's write set.
    let group_q = params
        .get("context_group")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let territory: Option<OwnedTerritory> = match group_q {
        None => None,
        Some(g) => {
            let (gid, gname): (String, String) = conn
                .query_row(
                    "SELECT id, name FROM dev_context_groups
                     WHERE project_id = ?1 AND (id = ?2 OR name = ?2 COLLATE NOCASE)
                     LIMIT 1",
                    rusqlite::params![&project_id, g],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .map_err(|_| {
                    AppError::Validation(format!(
                        "apply_pattern: `{g}` is not a context group of {project_name} — \
                         describe_context lists them"
                    ))
                })?;
            let mut stmt = conn.prepare(
                "SELECT id, name, file_paths FROM dev_contexts
                 WHERE project_id = ?1 AND group_id = ?2 ORDER BY name",
            )?;
            let contexts: Vec<(String, String, Vec<String>)> = stmt
                .query_map(rusqlite::params![&project_id, &gid], |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                    ))
                })?
                .flatten()
                .map(|(id, name, paths)| {
                    let paths: Vec<String> = serde_json::from_str(&paths).unwrap_or_default();
                    (id, name, paths)
                })
                .collect();
            if contexts.is_empty() {
                return Err(AppError::Validation(format!(
                    "apply_pattern: group `{gname}` has no contexts — nothing to scope to"
                )));
            }
            Some((gid, gname, contexts))
        }
    };

    // Concurrency guard (campaign doctrine): ≤4 live apply sessions per repo,
    // each on a DISJOINT group. The group token in the session name is the
    // overlap detector; a whole-repo session (no group) is only allowed alone.
    let group_token = territory
        .as_ref()
        .map(|(gid, ..)| gid.clone())
        .unwrap_or_else(|| "all".to_string());
    let name_prefix = format!("apply:{project_id}:");
    let live: Vec<String> = crate::commands::fleet::registry::registry()
        .list_dto()
        .into_iter()
        .filter(|s| {
            matches!(
                s.state,
                crate::commands::fleet::types::FleetSessionState::Spawning
                    | crate::commands::fleet::types::FleetSessionState::Running
                    | crate::commands::fleet::types::FleetSessionState::AwaitingInput
            )
        })
        .filter_map(|s| s.name)
        .filter(|n| n.contains(&name_prefix))
        .collect();
    if live.len() >= APPLY_MAX_CONCURRENT_PER_REPO {
        return Err(AppError::Validation(format!(
            "apply_pattern: {} apply sessions are already live in {project_name} (cap \
             {APPLY_MAX_CONCURRENT_PER_REPO}) — wait for one to settle",
            live.len()
        )));
    }
    let overlap = live.iter().any(|n| {
        n.contains(&format!("{name_prefix}{group_token}"))
            || n.contains(&format!("{name_prefix}all"))
    });
    if overlap || (group_token == "all" && !live.is_empty()) {
        return Err(AppError::Validation(format!(
            "apply_pattern: a live apply session already covers this territory of \
             {project_name} — concurrent sessions must target disjoint context groups \
             (live: {})",
            live.join("; ")
        )));
    }

    // Resolve the pattern set: explicit ids, or an ACTIVE playbook's members.
    // Only ADOPTED knowledge is applicable — observed/proposed items are
    // proposals under review, and applying them would make Athena the adopter.
    let all = crate::db::repos::dev_workspaces::list_knowledge(&state.db, &workspace_id, None)?;
    let mut wanted_ids: Vec<String> = Vec::new();
    let mut label = String::new();
    if let Some(slug) = params
        .get("playbook")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        let playbooks = crate::db::repos::dev_workspaces::list_playbooks(&state.db, &workspace_id)?;
        let pb = playbooks
            .iter()
            .find(|p| p.slug.eq_ignore_ascii_case(slug))
            .ok_or_else(|| {
                AppError::Validation(format!("apply_pattern: no playbook with slug `{slug}`"))
            })?;
        if pb.status != "active" {
            return Err(AppError::Validation(format!(
                "apply_pattern: playbook `{slug}` is `{}` — only ACTIVE playbooks are \
                 applicable (activation is the curator's call, like every adoption)",
                pb.status
            )));
        }
        let members = crate::db::repos::dev_workspaces::list_playbook_patterns(&state.db, &pb.id)?;
        wanted_ids.extend(members.iter().map(|m| m.practice_id.clone()));
        label = format!("playbook {slug}");
    }
    if let Some(ids) = params.get("pattern_ids").and_then(|v| v.as_array()) {
        wanted_ids.extend(
            ids.iter()
                .filter_map(|x| x.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string),
        );
    }
    if wanted_ids.is_empty() {
        return Err(AppError::Validation(
            "apply_pattern: name `pattern_ids` and/or an active `playbook` — use \
             describe_knowledge to find them"
                .into(),
        ));
    }
    wanted_ids.dedup();

    let mut skipped: Vec<String> = Vec::new();
    let mut patterns: Vec<(String, String, String, Option<String>)> = Vec::new();
    for id in &wanted_ids {
        match all.iter().find(|k| &k.id == id) {
            None => skipped.push(format!("`{id}`: not in the library")),
            Some(k) if k.status != "adopted" => {
                skipped.push(format!(
                    "`{}`: status is `{}` — only ADOPTED patterns are applied",
                    k.title, k.status
                ));
            }
            Some(k) => patterns.push((
                k.id.clone(),
                k.title.clone(),
                k.statement.clone(),
                k.detail_md.clone(),
            )),
        }
    }
    if patterns.is_empty() {
        return Err(AppError::Validation(format!(
            "apply_pattern: nothing applicable.{}",
            if skipped.is_empty() {
                String::new()
            } else {
                format!(" {}", skipped.join("; "))
            }
        )));
    }
    if patterns.len() > APPLY_MAX_PATTERNS {
        return Err(AppError::Validation(format!(
            "apply_pattern: {} patterns is past the per-session cap of {APPLY_MAX_PATTERNS} — \
             split the work across waves",
            patterns.len()
        )));
    }
    if label.is_empty() {
        label = format!("{} pattern(s)", patterns.len());
    }

    // Verify-lane evidence: violating cells for these patterns in this repo
    // (restricted to the territory when one is set). Measured violations are
    // the session's work list; their absence is stated rather than implied.
    let mut violations: std::collections::BTreeMap<String, ViolationBrief> =
        std::collections::BTreeMap::new();
    {
        let ctx_filter: Option<std::collections::HashSet<String>> = territory
            .as_ref()
            .map(|(_, _, cs)| cs.iter().map(|(id, ..)| id.clone()).collect());
        let mut stmt = conn.prepare(
            "SELECT practice_id, context_id, context_name, evidence
             FROM workspace_practice_context_state
             WHERE project_id = ?1 AND state = 'violating'",
        )?;
        let rows = stmt
            .query_map(rusqlite::params![&project_id], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, Option<String>>(3)?,
                ))
            })?
            .flatten();
        for (practice_id, context_id, context_name, evidence) in rows {
            if !patterns.iter().any(|(id, ..)| id == &practice_id) {
                continue;
            }
            if let Some(f) = &ctx_filter {
                if !f.contains(&context_id) {
                    continue;
                }
            }
            let entry = violations
                .entry(practice_id)
                .or_insert_with(|| ViolationBrief {
                    contexts: Vec::new(),
                    files: Vec::new(),
                });
            entry.contexts.push(context_name);
            if let Some(ev) = evidence {
                if let Ok(paths) = serde_json::from_str::<Vec<String>>(&ev) {
                    for p in paths.into_iter().take(6) {
                        if !entry.files.contains(&p) {
                            entry.files.push(p);
                        }
                    }
                }
            }
        }
    }

    let objective = params
        .get("objective")
        .and_then(|v| v.as_str())
        .map(str::trim);
    let territory_ref: Option<TerritoryDigest<'_>> = territory.as_ref().map(|(_, gname, cs)| {
        (
            gname.as_str(),
            cs.iter().map(|(_, n, p)| (n.clone(), p.clone())).collect(),
        )
    });
    let prompt = build_apply_prompt(
        &project_name,
        objective,
        &patterns,
        territory_ref.as_ref().map(|(g, cs)| (*g, cs.as_slice())),
        &violations,
    );

    let intent = format!(
        "[apply-pattern] {project_name}{}: {label}",
        territory
            .as_ref()
            .map(|(_, g, _)| format!(" · {g}"))
            .unwrap_or_default()
    );
    let op_id = crate::companion::orchestration::operative_memory::memory()
        .begin_dispatched_operation(intent.clone());
    let id = crate::commands::fleet::pty::spawn_session(
        app.clone(),
        std::path::PathBuf::from(&root_path),
        vec![prompt],
        120,
        32,
    )
    .map_err(AppError::Internal)?;
    let _ = crate::companion::orchestration::operative_memory::memory()
        .attach_session_to_operation(&op_id, &id, "apply", &root_path);
    let sentinel = crate::commands::fleet::registry::ATHENA_SESSION_NAME_SENTINEL;
    let _ = crate::commands::fleet::registry::registry().rename(
        &id,
        Some(format!("{sentinel} · apply:{project_id}:{group_token}")),
    );
    crate::companion::orchestration::emit_digest_changed(app);

    let mut msg = format!(
        "Applying {label} in {project_name}{} — session `{}` with {} adopted pattern(s): {}.",
        territory
            .as_ref()
            .map(|(_, g, _)| format!(" (territory: {g})"))
            .unwrap_or_default(),
        &id[..id.len().min(8)],
        patterns.len(),
        patterns
            .iter()
            .map(|(_, t, ..)| t.as_str())
            .collect::<Vec<_>>()
            .join("; "),
    );
    if !violations.is_empty() {
        msg.push_str(&format!(
            "\nBriefed with measured violations for {} pattern(s) from the verify lane.",
            violations.len()
        ));
    }
    if !skipped.is_empty() {
        msg.push_str(&format!("\nSkipped: {}", skipped.join("; ")));
    }
    msg.push_str(
        "\nThe session changes code and commits; adherence is only re-measured by the verify \
         lane afterwards.",
    );
    Ok(ExecuteResult::message(msg))
}

#[cfg(test)]
mod apply_prompt_tests {
    use super::{build_apply_prompt, ViolationBrief};
    use std::collections::BTreeMap;

    fn patterns() -> Vec<(String, String, String, Option<String>)> {
        vec![
            (
                "wk_1".to_string(),
                "Wrap IPC in invokeWithTimeout".to_string(),
                "Never call raw invoke.".to_string(),
                Some("Evidence: …".to_string()),
            ),
            (
                "wk_2".to_string(),
                "Use silentCatch for background errors".to_string(),
                "No empty catch blocks.".to_string(),
                None,
            ),
        ]
    }

    #[test]
    fn apply_brief_carries_doctrine_and_patterns() {
        let p = build_apply_prompt(
            "brainiac",
            Some("harden IPC"),
            &patterns(),
            None,
            &BTreeMap::new(),
        );
        assert!(p.contains("Wrap IPC in invokeWithTimeout"), "{p}");
        assert!(p.contains("`wk_1`"), "{p}");
        assert!(p.contains("OPERATOR OBJECTIVE — harden IPC"), "{p}");
        // The doctrine lines that must never be edited away.
        assert!(
            p.contains("never write adoption/adherence/verification"),
            "{p}"
        );
        assert!(p.contains("Commit atomically"), "{p}");
        assert!(p.contains("NEVER `git add -A`"), "{p}");
        // Repo-projected bundle is preferred over invention.
        assert!(p.contains(".claude/patterns/"), "{p}");
    }

    #[test]
    fn territory_scopes_edits_and_names_the_group() {
        let contexts = vec![(
            "Agent Editor".to_string(),
            vec!["src/features/agents/editor".to_string()],
        )];
        let p = build_apply_prompt(
            "personas",
            None,
            &patterns(),
            Some(("Agent Platform", contexts.as_slice())),
            &BTreeMap::new(),
        );
        assert!(
            p.contains("YOUR TERRITORY — the `Agent Platform` context group"),
            "{p}"
        );
        assert!(p.contains("src/features/agents/editor"), "{p}");
        assert!(p.contains("OFF LIMITS"), "shared-file rule gone: {p}");
        assert!(p.contains("inside your territory for edits"), "{p}");
    }

    #[test]
    fn measured_violations_lead_and_unmeasured_patterns_say_so() {
        let mut v: BTreeMap<String, ViolationBrief> = BTreeMap::new();
        v.insert(
            "wk_1".to_string(),
            ViolationBrief {
                contexts: vec!["Vault Catalog".to_string()],
                files: vec!["src/features/vault/x.ts".to_string()],
            },
        );
        let p = build_apply_prompt("personas", None, &patterns(), None, &v);
        assert!(p.contains("KNOWN VIOLATIONS"), "{p}");
        assert!(p.contains("Vault Catalog"), "{p}");
        assert!(p.contains("src/features/vault/x.ts"), "{p}");
        // wk_2 has no measured violation while verdicts exist — it must be
        // told to verify-first rather than invent work.
        assert!(p.contains("No measured violation in scope"), "{p}");
    }
}

// ── evaluate_pattern ────────────────────────────────────────────────────

/// `evaluate_pattern` — run the adoption-verification pass over a target
/// project: a headless session reads the repo and returns per-practice
/// verdicts whose file citations become per-context adopted/violating cells
/// through the verify lane's own evidence door
/// (`apply_verified_context_evidence`). This wraps the EXISTING
/// `dev_tools_workspace_verify_adoptions` pipeline unchanged — same model,
/// same caps, same "surface, never auto-un-adopt" rule: a failed verdict
/// flips a matrix cell to `diverged` for a human to read, it never changes
/// workspace-level adoption. Params: `{target_project}`. The pass picks its
/// own practice batch (actionable kinds first, never-verified before
/// re-checks, capped) — a per-pattern subset is deliberately not exposed
/// until the underlying lane grows one, so there is no second selection
/// policy to drift.
pub(crate) async fn execute_evaluate_pattern(
    state: &State<'_, Arc<AppState>>,
    app: &tauri::AppHandle,
    params: &serde_json::Value,
) -> Result<ExecuteResult, AppError> {
    let target_q = params
        .get("target_project")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| {
            AppError::Validation("evaluate_pattern: missing `target_project` (name or id)".into())
        })?;
    let (project_id, workspace_id, project_name): (String, Option<String>, String) = {
        let conn = state.db.get()?;
        conn.query_row(
            "SELECT id, workspace_id, name FROM dev_projects
             WHERE id = ?1 OR name = ?1 COLLATE NOCASE
             ORDER BY (id = ?1) DESC LIMIT 1",
            rusqlite::params![target_q],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .map_err(|_| {
            AppError::Validation(format!("evaluate_pattern: unknown project `{target_q}`"))
        })?
    };
    let Some(workspace_id) = workspace_id else {
        return Err(AppError::Validation(format!(
            "evaluate_pattern: `{project_name}` is not in a workspace — there are no \
             adoptions to verify"
        )));
    };
    let job_id =
        crate::commands::infrastructure::workspace_verify::dev_tools_workspace_verify_adoptions(
            app.clone(),
            state.clone(),
            workspace_id.clone(),
            project_id.clone(),
        )
        .await?;

    // Campaign chaining: a verify pass is one rung of a ladder (~25 practices
    // per pass over a backlog of hundreds), and with autonomous mode on the
    // whole ladder should climb itself. Watch the job to its terminal state,
    // then wake Athena with the pass outcome + the honest remainder so her
    // next turn proposes the next pass (which auto-fires) — or, when the
    // remainder hits zero, moves to planning apply waves. Poll cadence is
    // lazy (30s) against a bounded lifetime; a vanished job (evicted) is
    // treated as terminal so the watcher can never spin forever.
    {
        let app_bg = app.clone();
        let user_db = std::sync::Arc::new(state.user_db.clone());
        let sys_db = std::sync::Arc::new(state.db.clone());
        #[cfg(feature = "ml")]
        let embedder = state.embedding_manager.clone();
        let jid = job_id.clone();
        let pname = project_name.clone();
        let pid = project_id;
        tauri::async_runtime::spawn(async move {
            use crate::commands::infrastructure::workspace_verify::verify_job_probe;
            let mut outcome: Option<(String, u32, u32)> = None;
            // 30s × 120 = a 60-minute ceiling, comfortably past the verify
            // lane's own 20-minute session timeout.
            for _ in 0..120 {
                tokio::time::sleep(std::time::Duration::from_secs(30)).await;
                match verify_job_probe(&jid) {
                    Some((status, checked, diverged)) if status != "running" => {
                        outcome = Some((status, checked, diverged));
                        break;
                    }
                    Some(_) => continue,
                    None => break, // evicted/unknown — terminal for our purposes
                }
            }
            let (status, checked, diverged) = outcome.unwrap_or_else(|| ("unknown".into(), 0, 0));
            // The honest remainder: practices still awaiting a first verdict.
            let remaining: i64 = sys_db
                .get()
                .ok()
                .and_then(|conn| {
                    conn.query_row(
                        "SELECT COUNT(*) FROM workspace_practice_adoption
                         WHERE project_id = ?1 AND state IN ('proposed', 'to_process')",
                        rusqlite::params![&pid],
                        |r| r.get(0),
                    )
                    .ok()
                })
                .unwrap_or(-1);
            let directive = format!(
                "The verification pass you started on `{pname}` just finished \
                 (status: {status}; {checked} practices ruled, {diverged} need work). \
                 Practices still awaiting a first verdict in this project: {remaining}.\n\
                 If the remainder is greater than zero and this campaign should continue, \
                 propose the next `evaluate_pattern` pass for the same project now. If the \
                 remainder is zero, verification is complete — read `describe_knowledge` and \
                 propose targeted `apply_pattern` waves for the measured violations instead \
                 (disjoint context groups, and say what you chose and why). If the pass \
                 FAILED, say so and stop chaining rather than retrying blindly."
            );
            crate::companion::session::spawn_proactive_turn_in(
                app_bg,
                user_db,
                sys_db,
                #[cfg(feature = "ml")]
                embedder,
                "verify_pass_done".to_string(),
                Some(jid),
                directive,
                crate::companion::session::DEFAULT_SESSION_ID.to_string(),
            );
        });
    }

    Ok(ExecuteResult::message(format!(
        "Verification pass started for {project_name} (job `{job_id}`). A headless session is \
         reading the repo against its applicable practices; verdicts land on the adoption \
         matrix (drifted cells flip to `diverged` — surfaced for a human, never auto-un-adopted) \
         and file citations become per-context adherence evidence. I'll report back here when \
         the pass settles."
    )))
}
