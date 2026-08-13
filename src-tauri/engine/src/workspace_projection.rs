//! Workspace practice projection — the ambient half of the fabric's access
//! layer (pattern-fabric F2, docs/concepts/pattern-fabric.md; historically
//! Arc 3 of docs/plans/workspace-knowledge-center.md §8).
//!
//! Adopting a practice is worth little if it only lives in the app's database.
//! This module projects a workspace's **adopted** canon into each member repo
//! so every future CLI session there carries it at zero dispatch cost.
//!
//! ## v2 — a tiered bundle, not one flat file
//!
//! v1 inlined every practice (statement + evidence excerpt) into a single
//! `workspace-practices.md` that CLAUDE.md imported wholesale. Readable at 185
//! practices; at 455+ it is an ambient tax on every turn of every session.
//! v2 splits by *when a session needs what*:
//!
//!   .claude/patterns/README.md            ambient ROUTER (hard budget ~150
//!                                         lines) — the consult ritual + the
//!                                         active playbooks. The ONLY file
//!                                         CLAUDE.md imports.
//!   .claude/patterns/index.json           machine index — playbooks with
//!                                         phased member ids, the applicable
//!                                         pattern list with this repo's
//!                                         rollout states.
//!   .claude/patterns/playbooks/<slug>.md  phased brief per ACTIVE playbook —
//!                                         read on intent, never ambiently.
//!   .claude/patterns/library.md           the full per-area statements (the
//!                                         v1 body) — offline fallback,
//!                                         linked from the router, not
//!                                         imported.
//!   .claude/skills/patterns/SKILL.md      the consult skill (app-owned,
//!                                         overwritten each projection).
//!
//! Draft playbooks are deliberately NOT projected — activation in the rail is
//! the curation gate that makes a playbook consultable.
//!
//! ## Safety — why this writes owned files, not marker blocks
//!
//! The generated content lives in **fully-owned** files under `.claude/`, and
//! CLAUDE.md only ever gains a single `@import` line (v2 migrates the v1 line
//! in place and removes the v1 file). We never parse, rewrite, or risk
//! clobbering the user's own prose — the worst case is one stale line in a
//! file we otherwise never touch.
//!
//! Every write is best-effort per project: one unwritable repo is reported and
//! skipped, never aborting the rest of the projection.

use std::path::Path;

use personas_db::models::{
    DevProject, WorkspaceKnowledge, WorkspacePlaybook, WorkspacePlaybookPattern,
};
use personas_db::repos::dev_workspaces as repo;
use personas_db::DbPool;
use personas_core::error::AppError;

/// Bundle root under the member repo's `.claude/`. Owned by this module —
/// every file inside is overwritten wholesale on projection.
const PATTERNS_DIR: &str = "patterns";

/// The single line CLAUDE.md ever gains.
const IMPORT_LINE: &str = "@.claude/patterns/README.md";

/// v1 artifacts, migrated away on the first v2 projection.
const LEGACY_IMPORT_LINE: &str = "@.claude/workspace-practices.md";
const LEGACY_FILE: &str = "workspace-practices.md";

/// Per-project outcome of a projection run.
#[derive(Debug, serde::Serialize, ts_rs::TS)]
#[ts(export)]
pub struct ProjectionResult {
    pub project_id: String,
    pub project_name: String,
    /// Practices written into this repo's bundle.
    pub practices: u32,
    /// Active playbooks projected as briefs.
    pub playbooks: u32,
    /// True when CLAUDE.md gained (or migrated) the import line on this run.
    pub linked: bool,
    /// Populated when this project was skipped; the rest still projected.
    pub skipped: Option<String>,
}

/// One active playbook plus its resolved members, ready to render.
struct PlaybookBundle<'a> {
    pb: &'a WorkspacePlaybook,
    /// (membership, pattern) — pattern is the ADOPTED row; memberships whose
    /// pattern left `adopted` are dropped at assembly, not rendered as ghosts.
    members: Vec<(&'a WorkspacePlaybookPattern, &'a WorkspaceKnowledge)>,
}

/// Project a workspace's adopted canon into every member repo.
pub fn project_workspace_practices(
    pool: &DbPool,
    workspace_id: &str,
) -> Result<Vec<ProjectionResult>, AppError> {
    project_practices_impl(pool, workspace_id, None)
}

/// Project into ONE member repo — the "born subscribed" half of fabric F4:
/// called when a project joins a workspace, so a new app carries the bundle,
/// the briefs and the consult skill from its first session, without anyone
/// remembering to press the button.
pub fn project_practices_for_project(
    pool: &DbPool,
    workspace_id: &str,
    project_id: &str,
) -> Result<Vec<ProjectionResult>, AppError> {
    project_practices_impl(pool, workspace_id, Some(project_id))
}

fn project_practices_impl(
    pool: &DbPool,
    workspace_id: &str,
    only_project: Option<&str>,
) -> Result<Vec<ProjectionResult>, AppError> {
    let ws = repo::get_workspace_by_id(pool, workspace_id)?;
    let mut members = repo::list_workspace_projects(pool, workspace_id)?;
    if let Some(pid) = only_project {
        members.retain(|p| p.id == pid);
    }
    let adopted: Vec<WorkspaceKnowledge> = repo::list_knowledge(pool, workspace_id, Some("adopted"))?;
    let adoption = repo::list_adoption(pool, workspace_id)?;
    let playbooks = repo::list_playbooks(pool, workspace_id)?;
    let playbook_members = repo::list_playbook_patterns(pool, workspace_id)?;

    let by_id: std::collections::HashMap<&str, &WorkspaceKnowledge> =
        adopted.iter().map(|k| (k.id.as_str(), k)).collect();
    let active: Vec<PlaybookBundle<'_>> = playbooks
        .iter()
        .filter(|p| p.status == "active")
        .map(|pb| PlaybookBundle {
            pb,
            members: playbook_members
                .iter()
                .filter(|m| m.playbook_id == pb.id)
                .filter_map(|m| by_id.get(m.practice_id.as_str()).map(|k| (m, *k)))
                .collect(),
        })
        .collect();

    let mut out = Vec::new();
    for project in &members {
        // Per-project rollout state, so the bundle can mark what is canon *here*.
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

        match write_project_bundle(project, &ws.name, &applicable, &active, &state_of) {
            Ok(linked) => out.push(ProjectionResult {
                project_id: project.id.clone(),
                project_name: project.name.clone(),
                practices: applicable.len() as u32,
                playbooks: active.len() as u32,
                linked,
                skipped: None,
            }),
            Err(e) => out.push(ProjectionResult {
                project_id: project.id.clone(),
                project_name: project.name.clone(),
                practices: 0,
                playbooks: 0,
                linked: false,
                skipped: Some(e.to_string()),
            }),
        }
    }
    Ok(out)
}

/// Write one repo's bundle + skill + ensure/migrate its import line.
fn write_project_bundle(
    project: &DevProject,
    workspace_name: &str,
    practices: &[(&WorkspaceKnowledge, Option<String>)],
    playbooks: &[PlaybookBundle<'_>],
    state_of: &dyn Fn(&str) -> Option<String>,
) -> Result<bool, AppError> {
    let root = Path::new(&project.root_path);
    if !root.is_dir() {
        return Err(AppError::Validation(format!(
            "Project root is not a directory: {}",
            project.root_path
        )));
    }
    let claude_dir = root.join(".claude");
    let patterns_dir = claude_dir.join(PATTERNS_DIR);
    let briefs_dir = patterns_dir.join("playbooks");
    std::fs::create_dir_all(&briefs_dir)
        .map_err(|e| AppError::Internal(format!("create .claude/patterns/: {e}")))?;

    std::fs::write(
        patterns_dir.join("README.md"),
        render_router_md(workspace_name, practices, playbooks),
    )
    .map_err(|e| AppError::Internal(format!("write patterns/README.md: {e}")))?;

    std::fs::write(
        patterns_dir.join("index.json"),
        render_index_json(workspace_name, practices, playbooks),
    )
    .map_err(|e| AppError::Internal(format!("write patterns/index.json: {e}")))?;

    std::fs::write(
        patterns_dir.join("library.md"),
        render_practices_markdown(workspace_name, practices),
    )
    .map_err(|e| AppError::Internal(format!("write patterns/library.md: {e}")))?;

    // Briefs: one per ACTIVE playbook; stale briefs (retired / renamed /
    // deleted playbooks) are removed so the directory always mirrors the rail.
    let wanted: std::collections::HashSet<String> =
        playbooks.iter().map(|b| format!("{}.md", b.pb.slug)).collect();
    if let Ok(entries) = std::fs::read_dir(&briefs_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.ends_with(".md") && !wanted.contains(&name) {
                let _ = std::fs::remove_file(entry.path());
            }
        }
    }
    for bundle in playbooks {
        std::fs::write(
            briefs_dir.join(format!("{}.md", bundle.pb.slug)),
            render_playbook_brief(bundle, state_of),
        )
        .map_err(|e| AppError::Internal(format!("write brief {}: {e}", bundle.pb.slug)))?;
    }

    // The consult skill — app-owned, overwritten every projection.
    let skill_dir = claude_dir.join("skills").join("patterns");
    std::fs::create_dir_all(&skill_dir)
        .map_err(|e| AppError::Internal(format!("create skills/patterns/: {e}")))?;
    std::fs::write(skill_dir.join("SKILL.md"), render_skill_md(workspace_name))
        .map_err(|e| AppError::Internal(format!("write patterns skill: {e}")))?;

    // v1 migration: the flat file goes; ensure_import_line swaps the line.
    let _ = std::fs::remove_file(claude_dir.join(LEGACY_FILE));

    ensure_import_line(root)
}

/// The ambient router — the ONE file every session pays for. Hard budget:
/// keep it a router (ritual + active playbooks + counts), never a library.
fn render_router_md(
    workspace_name: &str,
    practices: &[(&WorkspaceKnowledge, Option<String>)],
    playbooks: &[PlaybookBundle<'_>],
) -> String {
    let mut out = String::new();
    out.push_str("<!-- Auto-generated by personas workspace_projection (pattern-fabric F2) — do not edit by hand. -->\n\n");
    out.push_str(&format!("# {workspace_name} — pattern fabric\n\n"));
    out.push_str(&format!(
        "This workspace maintains {} adopted engineering patterns that apply to this repo. \
They are conventions to follow here unless this repo has a documented reason to differ — \
if you find such a reason, say so rather than silently diverging.\n\n",
        practices.len()
    ));

    out.push_str("## Before non-trivial development work: consult\n\n");
    out.push_str(
        "1. Name the situation you are about to work on (\"add a table\", \"new IPC command\", …).\n\
         2. Match it against the **playbooks** below (triggers listed per playbook; machine index in `.claude/patterns/index.json`).\n\
         3. Read the matched brief in `.claude/patterns/playbooks/<slug>.md` — apply its *before* items first, its *during* items while building, and do not call the work done until its *verify* items hold.\n\
         4. Cite the pattern ids you applied (or deviated from, and why) in your commit/PR description.\n\
         5. If the Personas app is running, `GET http://127.0.0.1:<port>/dev-tools/patterns/consult?intent=<your situation>&project_id=<id>` returns the same brief with this repo's live adherence per pattern.\n\n",
    );

    if playbooks.is_empty() {
        out.push_str("_No playbooks are active yet — the library is browsable in `.claude/patterns/library.md`._\n\n");
    } else {
        out.push_str("## Active playbooks\n\n");
        for b in playbooks {
            let triggers: Vec<String> =
                serde_json::from_str(&b.pb.triggers).unwrap_or_default();
            out.push_str(&format!(
                "- **{}** (`{}`, {} patterns) — triggers: {}\n",
                b.pb.title,
                b.pb.slug,
                b.members.len(),
                triggers.join(", ")
            ));
        }
        out.push('\n');
    }

    // Area census — orientation, not content.
    let mut by_area: std::collections::BTreeMap<&str, usize> = std::collections::BTreeMap::new();
    for (k, _) in practices {
        let area = k.topic.as_deref().and_then(|t| t.split('/').next()).unwrap_or("general");
        *by_area.entry(area).or_default() += 1;
    }
    out.push_str("## Library shape\n\n");
    let census: Vec<String> = by_area.iter().map(|(a, n)| format!("{a} {n}")).collect();
    out.push_str(&census.join(" · "));
    out.push_str("\n\nFull statements per area: `.claude/patterns/library.md`. To propose an improvement or an extension of a pattern you worked against, use the `patterns` skill.\n");
    out
}

/// Machine index — stable ids for deterministic, citable lookups.
fn render_index_json(
    workspace_name: &str,
    practices: &[(&WorkspaceKnowledge, Option<String>)],
    playbooks: &[PlaybookBundle<'_>],
) -> String {
    let playbooks_json: Vec<serde_json::Value> = playbooks
        .iter()
        .map(|b| {
            let triggers: Vec<String> = serde_json::from_str(&b.pb.triggers).unwrap_or_default();
            let phase = |p: &str| -> Vec<serde_json::Value> {
                b.members
                    .iter()
                    .filter(|(m, _)| m.phase == p)
                    .map(|(m, k)| {
                        serde_json::json!({
                            "id": k.id, "title": k.title, "topic": k.topic,
                            "note": m.note, "ordinal": m.ordinal,
                        })
                    })
                    .collect()
            };
            serde_json::json!({
                "slug": b.pb.slug, "title": b.pb.title, "summary": b.pb.summary,
                "triggers": triggers,
                "before": phase("before"), "during": phase("during"), "verify": phase("verify"),
            })
        })
        .collect();
    let patterns_json: Vec<serde_json::Value> = practices
        .iter()
        .map(|(k, state)| {
            serde_json::json!({
                "id": k.id, "title": k.title, "topic": k.topic, "state_here": state,
            })
        })
        .collect();
    serde_json::to_string_pretty(&serde_json::json!({
        "workspace": workspace_name,
        "playbooks": playbooks_json,
        "patterns": patterns_json,
    }))
    .unwrap_or_else(|_| "{}".to_string())
}

/// One playbook's phased brief — read on intent, so statements are inlined.
fn render_playbook_brief(
    bundle: &PlaybookBundle<'_>,
    state_of: &dyn Fn(&str) -> Option<String>,
) -> String {
    let mut out = String::new();
    out.push_str("<!-- Auto-generated by personas workspace_projection — do not edit by hand. -->\n\n");
    out.push_str(&format!("# Playbook: {}\n\n", bundle.pb.title));
    out.push_str(bundle.pb.summary.trim());
    out.push_str("\n\n");
    for (phase, heading) in [
        ("before", "## Before you start"),
        ("during", "## While building"),
        ("verify", "## Before you call it done"),
    ] {
        let mut members: Vec<&(&WorkspacePlaybookPattern, &WorkspaceKnowledge)> =
            bundle.members.iter().filter(|(m, _)| m.phase == phase).collect();
        if members.is_empty() {
            continue;
        }
        members.sort_by_key(|(m, _)| m.ordinal);
        out.push_str(heading);
        out.push_str("\n\n");
        for (m, k) in members {
            let here = match state_of(&k.id).as_deref() {
                Some("adopted") => " _(already followed in this repo — reuse its own exemplars first)_",
                Some("diverged") => " _(this repo currently diverges)_",
                Some("na") => " _(marked not applicable to this repo)_",
                _ => "",
            };
            out.push_str(&format!("### {}{}\n\n", k.title.trim(), here));
            if let Some(note) = m.note.as_deref() {
                if !note.trim().is_empty() {
                    out.push_str(&format!("_{}_\n\n", note.trim()));
                }
            }
            out.push_str(k.statement.trim());
            out.push_str(&format!("\n\n`id: {}`\n\n", k.id));
        }
    }
    out
}

/// The consult skill — the ritual as an invocable, kept deliberately short.
fn render_skill_md(workspace_name: &str) -> String {
    format!(
        "---\nname: patterns\ndescription: Consult the {workspace_name} pattern fabric before non-trivial development (add a table, new command, new UI surface, …) — match a playbook, apply its phases, verify before done, and propose improvements back.\n---\n\n\
# Patterns — consult the workspace fabric\n\n\
<!-- Auto-generated by personas workspace_projection — do not edit; regenerated on every projection. -->\n\n\
1. **Name the situation** you are about to work on, in a few words.\n\
2. **Match a playbook**: read `.claude/patterns/index.json` (machine) or `.claude/patterns/README.md` (human) and pick the playbook whose triggers cover the situation. No match → browse `.claude/patterns/library.md` by area instead.\n\
3. **Apply the phases**: the brief in `.claude/patterns/playbooks/<slug>.md` is ordered *before / during / verify*. Do not call the work done until the verify items hold. Patterns marked \"already followed in this repo\" have local exemplars — find and reuse them before importing foreign shapes.\n\
4. **Live consult** (richer, optional): when the Personas app is running, `GET http://127.0.0.1:<port>/dev-tools/patterns/consult?intent=<situation>&project_id=<id>` adds this repo's per-pattern adherence. Discover the port via the app (it takes the first free port at or above its preferred one).\n\
5. **Cite ids**: reference the pattern ids you applied — or deviated from, with the reason — in the commit/PR description.\n\
6. **Propose back**: if you improved on a pattern or found a gap, write a normal practice-harvest item (see `.claude/skills/practice-harvest/` if present) referencing the pattern id it extends. Proposals land as `observed` for human adjudication — sessions propose, humans adopt.\n"
    )
}

/// Render the full library (per-area statements) — the offline fallback the
/// router links to. This is v1's body, no longer ambiently imported.
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

/// Ensure `<root>/CLAUDE.md` imports the router. Creates the file with a stub
/// when missing; migrates the v1 import line in place; otherwise appends the
/// line iff absent. Never rewrites existing user content beyond that one line.
fn ensure_import_line(root: &Path) -> Result<bool, AppError> {
    let claude_md = root.join("CLAUDE.md");

    if !claude_md.exists() {
        let body = format!(
            "<!-- Created by personas workspace projection — safe to edit. -->\n\
             <!-- The line below imports the workspace's pattern fabric. -->\n\
             {IMPORT_LINE}\n"
        );
        std::fs::write(&claude_md, body)
            .map_err(|e| AppError::Internal(format!("write CLAUDE.md: {e}")))?;
        return Ok(true);
    }

    let existing = std::fs::read_to_string(&claude_md)
        .map_err(|e| AppError::Internal(format!("read CLAUDE.md: {e}")))?;

    // v1 → v2 migration: swap the legacy line in place, preserving position.
    if existing.contains(LEGACY_IMPORT_LINE) {
        let updated = existing.replacen(LEGACY_IMPORT_LINE, IMPORT_LINE, 1);
        // A repo that somehow carries both lines must not end up with two
        // imports of the router.
        let updated = dedupe_line(&updated, IMPORT_LINE);
        std::fs::write(&claude_md, updated)
            .map_err(|e| AppError::Internal(format!("update CLAUDE.md: {e}")))?;
        return Ok(true);
    }

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

/// Keep only the FIRST occurrence of `line` (as a whole line), dropping later
/// duplicates. Everything else passes through verbatim.
fn dedupe_line(text: &str, line: &str) -> String {
    let mut seen = false;
    let mut out: Vec<&str> = Vec::new();
    for l in text.lines() {
        if l.trim() == line {
            if seen {
                continue;
            }
            seen = true;
        }
        out.push(l);
    }
    let mut joined = out.join("\n");
    if text.ends_with('\n') {
        joined.push('\n');
    }
    joined
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
    fn migrates_the_v1_import_line_in_place() {
        let d = tmpdir("migrate");
        let original = format!(
            "# My project\n\nUser prose stays.\n\n{LEGACY_IMPORT_LINE}\n\nMore prose after.\n"
        );
        std::fs::write(d.join("CLAUDE.md"), &original).unwrap();

        assert!(ensure_import_line(&d).unwrap(), "migration reports a change");
        let body = std::fs::read_to_string(d.join("CLAUDE.md")).unwrap();
        assert!(!body.contains(LEGACY_IMPORT_LINE), "v1 line is gone");
        assert!(body.contains(IMPORT_LINE), "v2 line took its place");
        // Position preserved: the import still sits between the two prose blocks.
        assert!(body.contains("User prose stays.\n\n@.claude/patterns/README.md"));
        assert!(body.contains("More prose after."));
        assert_eq!(body.matches(IMPORT_LINE).count(), 1);

        // And it is idempotent afterwards.
        assert!(!ensure_import_line(&d).unwrap());
    }

    #[test]
    fn migration_never_leaves_two_router_imports() {
        let d = tmpdir("dedupe");
        // Pathological: a repo carrying BOTH lines (e.g. a hand-edit during
        // the transition window).
        let original = format!("{LEGACY_IMPORT_LINE}\n{IMPORT_LINE}\n");
        std::fs::write(d.join("CLAUDE.md"), &original).unwrap();
        ensure_import_line(&d).unwrap();
        let body = std::fs::read_to_string(d.join("CLAUDE.md")).unwrap();
        assert_eq!(body.matches(IMPORT_LINE).count(), 1);
        assert!(!body.contains(LEGACY_IMPORT_LINE));
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
            layer: None,
            created_at: "2026-01-01T00:00:00Z".into(),
            updated_at: "2026-01-01T00:00:00Z".into(),
        }
    }

    fn playbook(slug: &str, title: &str) -> WorkspacePlaybook {
        WorkspacePlaybook {
            id: uuid::Uuid::new_v4().to_string(),
            workspace_id: "ws".into(),
            slug: slug.into(),
            title: title.into(),
            triggers: "[\"create table\",\"new migration\"]".into(),
            summary: "The seam end to end.".into(),
            status: "active".into(),
            created_at: "2026-01-01T00:00:00Z".into(),
            updated_at: "2026-01-01T00:00:00Z".into(),
        }
    }

    fn membership(pb: &WorkspacePlaybook, k: &WorkspaceKnowledge, phase: &str) -> WorkspacePlaybookPattern {
        WorkspacePlaybookPattern {
            playbook_id: pb.id.clone(),
            practice_id: k.id.clone(),
            phase: phase.into(),
            ordinal: 0,
            note: Some("why here".into()),
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
        let md = render_practices_markdown("Core", &entries);

        assert!(md.contains("## architecture"));
        assert!(md.contains("## reliability"));
        assert!(md.contains("(adopted here)"));
        assert!(md.contains("(proposed for this repo)"));
        // The generated file must announce itself as generated.
        assert!(md.contains("do not edit by hand"));
    }

    #[test]
    fn router_stays_a_router() {
        let a = practice("Use one IPC door", "All calls go through the wrapper.", Some("architecture/chokepoints"));
        let pb = playbook("add-db-table", "Add a database table");
        let m = membership(&pb, &a, "before");
        let bundle = PlaybookBundle { pb: &pb, members: vec![(&m, &a)] };
        let entries = vec![(&a, Some("adopted".to_string()))];
        let md = render_router_md("Core", &entries, &[bundle]);

        // Lists the playbook with its triggers…
        assert!(md.contains("add-db-table"));
        assert!(md.contains("create table"));
        // …but inlines NO statements: the router routes, the briefs carry.
        assert!(!md.contains("All calls go through the wrapper."));
        // The ambient budget is structural, not aspirational.
        assert!(
            md.lines().count() < 160,
            "router exceeded its ambient budget: {} lines",
            md.lines().count()
        );
    }

    #[test]
    fn brief_carries_phases_states_and_ids() {
        let a = practice("Use one IPC door", "All calls go through the wrapper.", Some("architecture/chokepoints"));
        let b = practice("Bound every read", "Cap rows and bytes.", Some("data/queries"));
        let pb = playbook("add-db-table", "Add a database table");
        let ma = membership(&pb, &a, "before");
        let mb = membership(&pb, &b, "verify");
        let bundle = PlaybookBundle { pb: &pb, members: vec![(&ma, &a), (&mb, &b)] };
        let states: std::collections::HashMap<String, String> =
            [(a.id.clone(), "adopted".to_string())].into();
        let md = render_playbook_brief(&bundle, &|id| states.get(id).cloned());

        assert!(md.contains("## Before you start"));
        assert!(md.contains("## Before you call it done"));
        assert!(md.contains("reuse its own exemplars first"));
        assert!(md.contains(&format!("`id: {}`", a.id)));
        assert!(md.contains("All calls go through the wrapper."));
    }
}
