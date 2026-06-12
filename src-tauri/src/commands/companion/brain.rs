//! Brain Viewer commands — read-only inspector for what Athena
//! remembers, plus targeted delete for episodes.
//!
//! Generic shape: `(kind, id?)` dispatches to the right backing store.
//! - episode      → `companion_node` rows + on-disk markdown body
//! - doctrine     → `companion_node` rows + on-disk source doc, re-extract
//!                  the matching H2 section by anchor
//! - identity     → `~/.personas/companion-brain/identity.md`
//! - constitution → `~/.personas/companion-brain/constitution.md`
//!
//! Phase 5 will add `semantic`, `procedural`, and `reflection` kinds when
//! those tiers exist; until then the dispatch returns a clear error.

use std::sync::Arc;

use rusqlite::params;
use serde::Serialize;
use tauri::State;

use crate::companion::brain::backlog;
use crate::companion::brain::decisions;
use crate::companion::brain::doctrine;
use crate::companion::brain::goals;
use crate::companion::brain::identity;
use crate::companion::brain::procedural::{self, ProceduralScope};
use crate::companion::brain::reflection;
use crate::companion::brain::rituals;
use crate::companion::brain::semantic::{self, FactScope};
use crate::companion::disk;
use crate::error::AppError;
use crate::ipc_auth;
use crate::AppState;

/// One row in the list view. Keep it small — the detail call fetches
/// full content lazily.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrainListItem {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub preview: String,
    pub meta: String,
    pub deletable: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrainDetail {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub content: String,
    pub meta: String,
    pub deletable: bool,
}

#[tauri::command]
pub fn companion_list_brain_items(
    state: State<'_, Arc<AppState>>,
    kind: String,
) -> Result<Vec<BrainListItem>, AppError> {
    ipc_auth::require_auth_sync(&state)?;
    // Recognize scoped fact kinds: `fact:user`, `fact:project`, `fact:world`,
    // and bare `fact` (= all scopes flattened). The viewer renders one
    // scope per row group, so we keep the dispatch shape generic.
    if let Some(rest) = kind.strip_prefix("fact") {
        let scope = match rest {
            "" => None,
            ":user" => Some(FactScope::User),
            ":project" => Some(FactScope::Project),
            ":world" => Some(FactScope::World),
            other => {
                return Err(AppError::Internal(format!(
                    "brain kind `fact{other}` — unknown scope (use fact, fact:user, fact:project, fact:world)"
                )))
            }
        };
        return list_facts(&state, scope);
    }
    // Phase D scoped kinds.
    if let Some(rest) = kind.strip_prefix("procedural") {
        let scope = match rest {
            "" => None,
            ":chat" => Some(ProceduralScope::Chat),
            ":action" => Some(ProceduralScope::Action),
            ":memory" => Some(ProceduralScope::Memory),
            ":build" => Some(ProceduralScope::Build),
            other => {
                return Err(AppError::Internal(format!(
                    "brain kind `procedural{other}` — unknown scope"
                )))
            }
        };
        return list_procedurals(&state, scope);
    }
    if kind == "goal" || kind.starts_with("goal:") {
        let status_filter = kind.strip_prefix("goal:");
        return list_goals(&state, status_filter);
    }
    if kind == "ritual" || kind.starts_with("ritual:") {
        let kind_filter = kind.strip_prefix("ritual:");
        return list_rituals(&state, kind_filter);
    }
    if kind == "backlog" || kind.starts_with("backlog:") {
        let kind_filter = kind.strip_prefix("backlog:");
        return list_backlog(&state, kind_filter);
    }
    match kind.as_str() {
        "episode" => list_episodes(&state),
        "doctrine" => list_doctrine(&state),
        "reflection" => list_reflections(&state),
        "design_decision" => list_design_decisions(&state),
        "identity" => Ok(single_file_list(
            "identity",
            "Identity",
            "Live self-model — evolves over time",
            disk::brain_root().ok().map(|r| r.join("identity.md")),
        )),
        "constitution" => Ok(single_file_list(
            "constitution",
            "Constitution",
            "Static character — Athena's voice + provenance contract",
            disk::brain_root().ok().map(|r| r.join("constitution.md")),
        )),
        other => Err(AppError::Internal(format!(
            "brain kind `{other}` not yet supported"
        ))),
    }
}

#[tauri::command]
pub fn companion_get_brain_item(
    state: State<'_, Arc<AppState>>,
    kind: String,
    id: String,
) -> Result<BrainDetail, AppError> {
    ipc_auth::require_auth_sync(&state)?;
    if kind == "fact" || kind.starts_with("fact:") {
        return get_fact_detail(&state, &id);
    }
    if kind == "procedural" || kind.starts_with("procedural:") {
        return get_procedural_detail(&state, &id);
    }
    if kind == "goal" || kind.starts_with("goal:") {
        return get_goal_detail(&state, &id);
    }
    if kind == "ritual" || kind.starts_with("ritual:") {
        return get_ritual_detail(&state, &id);
    }
    if kind == "backlog" || kind.starts_with("backlog:") {
        return get_backlog_detail(&state, &id);
    }
    match kind.as_str() {
        "episode" => get_episode(&state, &id),
        "doctrine" => get_doctrine(&state, &id),
        "reflection" => get_reflection(&state, &id),
        "design_decision" => get_design_decision(&state, &id),
        "identity" => read_brain_file("identity", "Identity", "identity.md"),
        "constitution" => read_brain_file("constitution", "Constitution", "constitution.md"),
        other => Err(AppError::Internal(format!(
            "brain kind `{other}` not yet supported"
        ))),
    }
}

#[tauri::command]
pub fn companion_delete_brain_item(
    state: State<'_, Arc<AppState>>,
    kind: String,
    id: String,
) -> Result<(), AppError> {
    ipc_auth::require_auth_sync(&state)?;
    if kind == "fact" || kind.starts_with("fact:") {
        return semantic::delete_fact(&state.user_db, &id);
    }
    if kind == "procedural" || kind.starts_with("procedural:") {
        return procedural::delete_rule(&state.user_db, &id);
    }
    if kind == "goal" || kind.starts_with("goal:") {
        return goals::delete_goal(&state.user_db, &id);
    }
    if kind == "ritual" || kind.starts_with("ritual:") {
        return rituals::delete_ritual(&state.user_db, &id);
    }
    // Backlog items are append-only — `done`/`dropped` is the resolution path.
    // Surface a clear error rather than silently failing on an unsupported kind.
    if kind == "backlog" || kind.starts_with("backlog:") {
        return Err(AppError::Internal(
            "backlog items are append-only — resolve them via `resolve_backlog_item` instead"
                .into(),
        ));
    }
    match kind.as_str() {
        "episode" => delete_episode(&state, &id),
        "doctrine" | "identity" | "constitution" | "design_decision" => Err(AppError::Internal(format!(
            "`{kind}` items are not deletable from the viewer"
        ))),
        other => Err(AppError::Internal(format!(
            "brain kind `{other}` not yet supported"
        ))),
    }
}

/// User-as-editor-of-record (F1): overwrite identity.md with the user's directly
/// edited markdown (BrainViewer Edit affordance). Backs up the prior version and
/// returns the backup file name. Deliberately bypasses the anchored-diff
/// machinery — the user owns this file and may rewrite it wholesale.
#[tauri::command]
pub fn companion_save_identity(
    state: State<'_, Arc<AppState>>,
    content: String,
) -> Result<String, AppError> {
    ipc_auth::require_auth_sync(&state)?;
    identity::write_full(&content)
}

// ── episodes ────────────────────────────────────────────────────────────

fn list_episodes(state: &State<'_, Arc<AppState>>) -> Result<Vec<BrainListItem>, AppError> {
    let conn = state.user_db.get()?;
    let mut stmt = conn.prepare(
        "SELECT id, file_path, body_excerpt, created_at
         FROM companion_node
         WHERE kind = 'episode'
         ORDER BY created_at DESC
         LIMIT 200",
    )?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                row.get::<_, String>(3)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let root = disk::brain_root().ok();
    let mut out = Vec::with_capacity(rows.len());
    for (id, rel_path, excerpt, created_at) in rows {
        // Pull the role from disk frontmatter so the row label is
        // accurate even if older rows pre-date a body_excerpt write.
        let role = root
            .as_ref()
            .and_then(|r| std::fs::read_to_string(r.join(&rel_path)).ok())
            .as_deref()
            .map(role_from_frontmatter)
            .unwrap_or_else(|| "episode".to_string());
        out.push(BrainListItem {
            id,
            kind: "episode".into(),
            title: role.clone(),
            preview: excerpt.lines().take(2).collect::<Vec<_>>().join(" "),
            meta: created_at,
            deletable: true,
        });
    }
    Ok(out)
}

fn get_episode(state: &State<'_, Arc<AppState>>, id: &str) -> Result<BrainDetail, AppError> {
    let conn = state.user_db.get()?;
    let (file_path, created_at): (String, String) = conn.query_row(
        "SELECT file_path, created_at FROM companion_node
         WHERE kind = 'episode' AND id = ?1",
        params![id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    let root = disk::brain_root()?;
    let full = std::fs::read_to_string(root.join(&file_path))
        .unwrap_or_else(|_| format!("(file unreadable: {file_path})"));
    let role = role_from_frontmatter(&full);
    let body = body_after_frontmatter(&full);
    Ok(BrainDetail {
        id: id.to_string(),
        kind: "episode".into(),
        title: role,
        content: body,
        meta: created_at,
        deletable: true,
    })
}

fn delete_episode(state: &State<'_, Arc<AppState>>, id: &str) -> Result<(), AppError> {
    let conn = state.user_db.get()?;
    // Pull file_path so we can also remove the disk markdown — keeps the
    // user's mental model clean ("delete means delete").
    let file_path: Option<String> = conn
        .query_row(
            "SELECT file_path FROM companion_node WHERE kind = 'episode' AND id = ?1",
            params![id],
            |r| r.get::<_, String>(0),
        )
        .ok();

    // Remove the on-disk markdown FIRST. That file holds the full episode body —
    // potentially sensitive conversation content — and erasing it is the entire
    // reason a user deletes an episode. If the file is locked or unwritable we
    // bail *before* touching the DB, so the episode stays fully intact and
    // retryable rather than vanishing from the viewer while an orphaned copy
    // lingers on disk (silently breaking the "delete means delete" contract).
    if let Some(rel) = &file_path {
        let root = disk::brain_root()?;
        match std::fs::remove_file(root.join(rel)) {
            Ok(()) => {}
            // Already gone — the user's goal (no on-disk copy) is satisfied, so
            // treat a missing file as success and continue to drop the DB rows.
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => {
                // Sentry/log breadcrumb so a surviving copy is debuggable. The
                // returned error surfaces to the Brain Viewer so the user learns
                // the episode was NOT deleted (instead of a false success).
                tracing::error!(
                    episode = %id,
                    file = %rel,
                    error = %e,
                    "delete_episode: on-disk markdown could not be removed; aborting delete to avoid orphaning sensitive content"
                );
                return Err(AppError::Internal(format!(
                    "Couldn't delete this episode — its saved file is locked or unwritable ({e}). \
                     Nothing was removed; close anything using it and try again."
                )));
            }
        }
    }

    let _ = conn.execute("DELETE FROM companion_fts WHERE node_id = ?1", params![id]);
    let _ = conn.execute(
        "DELETE FROM companion_embedding WHERE node_id = ?1",
        params![id],
    );
    conn.execute("DELETE FROM companion_node WHERE id = ?1", params![id])?;
    Ok(())
}

// ── doctrine ────────────────────────────────────────────────────────────

fn list_doctrine(state: &State<'_, Arc<AppState>>) -> Result<Vec<BrainListItem>, AppError> {
    let conn = state.user_db.get()?;
    let mut stmt = conn.prepare(
        "SELECT id, file_path, body_excerpt, created_at
         FROM companion_node
         WHERE kind = 'doctrine'
         ORDER BY file_path",
    )?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                row.get::<_, String>(3)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let mut out = Vec::with_capacity(rows.len());
    for (id, file_path, excerpt, created_at) in rows {
        let (path_part, anchor) = file_path
            .split_once('#')
            .map(|(p, a)| (p.to_string(), a.to_string()))
            .unwrap_or_else(|| (file_path.clone(), "intro".into()));
        out.push(BrainListItem {
            id,
            kind: "doctrine".into(),
            title: format!("{path_part}#{anchor}"),
            preview: excerpt.lines().take(2).collect::<Vec<_>>().join(" "),
            meta: created_at,
            deletable: false,
        });
    }
    Ok(out)
}

fn get_doctrine(state: &State<'_, Arc<AppState>>, id: &str) -> Result<BrainDetail, AppError> {
    let conn = state.user_db.get()?;
    let (file_path, body_excerpt, created_at): (String, Option<String>, String) = conn.query_row(
        "SELECT file_path, body_excerpt, created_at FROM companion_node
             WHERE kind = 'doctrine' AND id = ?1",
        params![id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )?;

    // file_path is `<rel>#<anchor>` — re-extract the section content from
    // disk (or from the embedded fallback) so we render the actual chunk
    // content, not just the 500-char excerpt.
    let (rel_path, anchor) = file_path
        .split_once('#')
        .map(|(p, a)| (p, a))
        .unwrap_or((file_path.as_str(), "intro"));

    let docs_root = doctrine::find_docs_root();
    let content = doctrine::read_curated_doc(rel_path, docs_root.as_deref())
        .and_then(|md| extract_section(&md, anchor))
        .unwrap_or_else(|| body_excerpt.unwrap_or_default());

    Ok(BrainDetail {
        id: id.to_string(),
        kind: "doctrine".into(),
        title: file_path,
        content,
        meta: created_at,
        deletable: false,
    })
}

// ── facts ───────────────────────────────────────────────────────────────

fn list_facts(
    state: &State<'_, Arc<AppState>>,
    scope: Option<FactScope>,
) -> Result<Vec<BrainListItem>, AppError> {
    // Include superseded so the user can see history, but the row meta
    // marks them clearly. Cap is generous — facts are small.
    let facts = semantic::list_facts(&state.user_db, scope, true, 500)?;
    let mut out = Vec::with_capacity(facts.len());
    for f in facts {
        let superseded = f.importance == 0;
        let conf_pct = (f.confidence * 100.0).round() as i32;
        let meta = if superseded {
            format!(
                "{scope}/{key} · superseded · conf {conf}% · updated {updated}",
                scope = f.scope,
                key = f.key,
                conf = conf_pct,
                updated = f.updated_at,
            )
        } else {
            format!(
                "{scope}/{key} · imp {imp} · conf {conf}% · {n} source(s) · updated {updated}",
                scope = f.scope,
                key = f.key,
                imp = f.importance,
                conf = conf_pct,
                n = f.sources.len(),
                updated = f.updated_at,
            )
        };
        out.push(BrainListItem {
            id: f.id,
            kind: format!("fact:{}", f.scope),
            title: f.key,
            preview: f.value.lines().take(2).collect::<Vec<_>>().join(" "),
            meta,
            deletable: true,
        });
    }
    Ok(out)
}

fn get_fact_detail(state: &State<'_, Arc<AppState>>, id: &str) -> Result<BrainDetail, AppError> {
    let f = semantic::get_fact(&state.user_db, id)?
        .ok_or_else(|| AppError::Internal(format!("fact `{id}` not found")))?;
    // Render the body to include the typed metadata above the value, so
    // the detail view doubles as an explanation surface — the user sees
    // *why* this fact exists (sources, importance, supersedes-chain).
    let conf_pct = (f.confidence * 100.0).round() as i32;
    let mut content = String::new();
    content.push_str(&format!(
        "**Scope:** {scope} &nbsp;·&nbsp; **Key:** `{key}`\n\n",
        scope = f.scope,
        key = f.key,
    ));
    if f.importance == 0 {
        content.push_str(
            "> _Superseded — kept for historical record but no longer wins retrieval._\n\n",
        );
    }
    content.push_str(&format!(
        "**Importance:** {imp}/5 &nbsp;·&nbsp; **Confidence:** {conf}%\n\n",
        imp = f.importance,
        conf = conf_pct,
    ));
    if !f.sources.is_empty() {
        content.push_str("**Sources:** ");
        let pairs: Vec<String> = f.sources.iter().map(|s| format!("`{s}`")).collect();
        content.push_str(&pairs.join(", "));
        content.push_str("\n\n");
    }
    if let Some(s) = &f.supersedes_id {
        content.push_str(&format!("**Supersedes:** `{s}`\n\n"));
    }
    if let Some(c) = &f.contradicts_id {
        content.push_str(&format!("**Contradicts:** `{c}`\n\n"));
    }
    content.push_str("---\n\n");
    content.push_str(&f.value);
    let conf_pct_meta = (f.confidence * 100.0).round() as i32;
    let meta = format!(
        "{scope}/{key} · imp {imp} · conf {conf}% · {n} source(s)",
        scope = f.scope,
        key = f.key,
        imp = f.importance,
        conf = conf_pct_meta,
        n = f.sources.len(),
    );
    Ok(BrainDetail {
        id: f.id,
        kind: format!("fact:{}", f.scope),
        title: f.key,
        content,
        meta,
        deletable: true,
    })
}

// ── Phase D: procedurals / goals / rituals / backlog ───────────────────

fn list_procedurals(
    state: &State<'_, Arc<AppState>>,
    scope: Option<ProceduralScope>,
) -> Result<Vec<BrainListItem>, AppError> {
    let rules = procedural::list_rules(&state.user_db, scope, true, 500)?;
    Ok(rules
        .into_iter()
        .map(|r| {
            let superseded = r.importance == 0;
            let conf_pct = (r.confidence * 100.0).round() as i32;
            let meta = if superseded {
                format!(
                    "{scope}/{trigger} · superseded · conf {conf}% · updated {updated}",
                    scope = r.scope,
                    trigger = r.trigger,
                    conf = conf_pct,
                    updated = r.updated_at,
                )
            } else {
                format!(
                    "{scope} · imp {imp} · conf {conf}% · {n} source(s) · updated {updated}",
                    scope = r.scope,
                    imp = r.importance,
                    conf = conf_pct,
                    n = r.sources.len(),
                    updated = r.updated_at,
                )
            };
            BrainListItem {
                id: r.id,
                kind: format!("procedural:{}", r.scope),
                title: r.trigger,
                preview: r.behavior.lines().take(2).collect::<Vec<_>>().join(" "),
                meta,
                deletable: true,
            }
        })
        .collect())
}

fn get_procedural_detail(
    state: &State<'_, Arc<AppState>>,
    id: &str,
) -> Result<BrainDetail, AppError> {
    let r = procedural::get_rule(&state.user_db, id)?
        .ok_or_else(|| AppError::Internal(format!("procedural `{id}` not found")))?;
    let conf_pct = (r.confidence * 100.0).round() as i32;
    let mut content = String::new();
    content.push_str(&format!(
        "**Scope:** {scope} &nbsp;·&nbsp; **Importance:** {imp}/5 &nbsp;·&nbsp; **Confidence:** {conf}%\n\n",
        scope = r.scope,
        imp = r.importance,
        conf = conf_pct,
    ));
    if r.importance == 0 {
        content.push_str("> _Superseded — kept for historical record._\n\n");
    }
    if !r.sources.is_empty() {
        content.push_str("**Sources:** ");
        let pairs: Vec<String> = r.sources.iter().map(|s| format!("`{s}`")).collect();
        content.push_str(&pairs.join(", "));
        content.push_str("\n\n");
    }
    if let Some(s) = &r.supersedes_id {
        content.push_str(&format!("**Supersedes:** `{s}`\n\n"));
    }
    content.push_str("---\n\n");
    content.push_str("**When:** ");
    content.push_str(&r.trigger);
    content.push_str("\n\n**Then:**\n\n");
    content.push_str(&r.behavior);
    Ok(BrainDetail {
        id: r.id,
        kind: format!("procedural:{}", r.scope),
        title: r.trigger,
        content,
        meta: format!(
            "{scope} · imp {imp} · conf {conf}%",
            scope = r.scope,
            imp = r.importance,
            conf = conf_pct
        ),
        deletable: true,
    })
}

fn list_goals(
    state: &State<'_, Arc<AppState>>,
    status_filter: Option<&str>,
) -> Result<Vec<BrainListItem>, AppError> {
    let status = match status_filter {
        Some(s) => Some(goals::GoalStatus::parse(s)?),
        None => None,
    };
    let rows = goals::list_goals(&state.user_db, status, 200)?;
    Ok(rows
        .into_iter()
        .map(|g| BrainListItem {
            id: g.id,
            kind: format!("goal:{}", g.status),
            title: g.title,
            preview: g.description.lines().take(2).collect::<Vec<_>>().join(" "),
            meta: format!(
                "{status} · priority {p}{target} · updated {updated}",
                status = g.status,
                p = g.priority,
                target = g
                    .target_date
                    .map(|d| format!(" · target {d}"))
                    .unwrap_or_default(),
                updated = g.updated_at,
            ),
            deletable: true,
        })
        .collect())
}

fn get_goal_detail(state: &State<'_, Arc<AppState>>, id: &str) -> Result<BrainDetail, AppError> {
    let g = goals::get_goal(&state.user_db, id)?
        .ok_or_else(|| AppError::Internal(format!("goal `{id}` not found")))?;
    let mut content = String::new();
    content.push_str(&format!(
        "**Status:** {status} &nbsp;·&nbsp; **Priority:** {p}/5",
        status = g.status,
        p = g.priority,
    ));
    if let Some(td) = &g.target_date {
        content.push_str(&format!(" &nbsp;·&nbsp; **Target:** {td}"));
    }
    content.push_str("\n\n");
    if let Some(c) = &g.completed_at {
        content.push_str(&format!("**Completed:** {c}\n\n"));
    }
    if !g.sources.is_empty() {
        content.push_str("**Sources:** ");
        let pairs: Vec<String> = g.sources.iter().map(|s| format!("`{s}`")).collect();
        content.push_str(&pairs.join(", "));
        content.push_str("\n\n");
    }
    content.push_str("---\n\n");
    content.push_str(&g.description);
    Ok(BrainDetail {
        id: g.id,
        kind: format!("goal:{}", g.status),
        title: g.title,
        content,
        meta: format!("{} · priority {}", g.status, g.priority),
        deletable: true,
    })
}

fn list_rituals(
    state: &State<'_, Arc<AppState>>,
    kind_filter: Option<&str>,
) -> Result<Vec<BrainListItem>, AppError> {
    let kind = match kind_filter {
        Some(s) => Some(rituals::RitualKind::parse(s)?),
        None => None,
    };
    let rows = rituals::list_rituals(&state.user_db, kind, false)?;
    Ok(rows
        .into_iter()
        .map(|r| BrainListItem {
            id: r.id,
            kind: format!("ritual:{}", r.kind),
            title: r.description.lines().next().unwrap_or("Ritual").to_string(),
            preview: r.schedule_json.chars().take(120).collect(),
            meta: format!(
                "{kind} · {state} · updated {updated}",
                kind = r.kind,
                state = if r.active { "active" } else { "paused" },
                updated = r.updated_at,
            ),
            deletable: true,
        })
        .collect())
}

fn get_ritual_detail(state: &State<'_, Arc<AppState>>, id: &str) -> Result<BrainDetail, AppError> {
    let r = rituals::get_ritual(&state.user_db, id)?
        .ok_or_else(|| AppError::Internal(format!("ritual `{id}` not found")))?;
    let mut content = String::new();
    content.push_str(&format!(
        "**Kind:** {kind} &nbsp;·&nbsp; **State:** {state}\n\n",
        kind = r.kind,
        state = if r.active { "active" } else { "paused" },
    ));
    if !r.sources.is_empty() {
        content.push_str("**Sources:** ");
        let pairs: Vec<String> = r.sources.iter().map(|s| format!("`{s}`")).collect();
        content.push_str(&pairs.join(", "));
        content.push_str("\n\n");
    }
    content.push_str("---\n\n");
    content.push_str(&r.description);
    content.push_str("\n\n## Schedule\n\n```json\n");
    content.push_str(&r.schedule_json);
    content.push_str("\n```\n");
    Ok(BrainDetail {
        id: r.id.clone(),
        kind: format!("ritual:{}", r.kind),
        title: r.description.lines().next().unwrap_or("Ritual").to_string(),
        content,
        meta: format!(
            "{} · {}",
            r.kind,
            if r.active { "active" } else { "paused" }
        ),
        deletable: true,
    })
}

fn list_backlog(
    state: &State<'_, Arc<AppState>>,
    kind_filter: Option<&str>,
) -> Result<Vec<BrainListItem>, AppError> {
    let kind = match kind_filter {
        Some(s) => Some(backlog::BacklogKind::parse(s)?),
        None => None,
    };
    // Show resolved + pending; the viewer can sort, and the user wants
    // to audit "what did I drop / what did I finish".
    let rows = backlog::list_items(&state.user_db, kind, false, 200)?;
    Ok(rows
        .into_iter()
        .map(|b| BrainListItem {
            id: b.id,
            kind: format!("backlog:{}", b.kind),
            title: b.summary.lines().next().unwrap_or("Backlog").to_string(),
            preview: b.summary.lines().take(2).collect::<Vec<_>>().join(" "),
            meta: format!(
                "{kind} · {status}{src} · created {created}",
                kind = b.kind,
                status = b.status,
                src = b
                    .source_episode_id
                    .map(|x| format!(" · from {x}"))
                    .unwrap_or_default(),
                created = b.created_at,
            ),
            // Deletion is via resolve_backlog_item, not the generic delete.
            deletable: false,
        })
        .collect())
}

fn get_backlog_detail(state: &State<'_, Arc<AppState>>, id: &str) -> Result<BrainDetail, AppError> {
    let b = backlog::get_item(&state.user_db, id)?
        .ok_or_else(|| AppError::Internal(format!("backlog `{id}` not found")))?;
    let mut content = String::new();
    content.push_str(&format!(
        "**Kind:** {kind} &nbsp;·&nbsp; **Status:** {status}\n\n",
        kind = b.kind,
        status = b.status,
    ));
    if let Some(src) = &b.source_episode_id {
        content.push_str(&format!("**From episode:** `{src}`\n\n"));
    }
    if let Some(resolved) = &b.resolved_at {
        content.push_str(&format!("**Resolved:** {resolved}\n\n"));
    }
    content.push_str("---\n\n");
    content.push_str(&b.summary);
    Ok(BrainDetail {
        id: b.id.clone(),
        kind: format!("backlog:{}", b.kind),
        title: b.summary.lines().next().unwrap_or("Backlog").to_string(),
        content,
        meta: format!("{} · {}", b.kind, b.status),
        deletable: false,
    })
}

// ── reflections ─────────────────────────────────────────────────────────

fn list_reflections(state: &State<'_, Arc<AppState>>) -> Result<Vec<BrainListItem>, AppError> {
    let rows = reflection::list_reflections(&state.user_db, 100)?;
    Ok(rows
        .into_iter()
        .map(|r| BrainListItem {
            id: r.id,
            kind: "reflection".into(),
            title: r
                .preview
                .lines()
                .next()
                .unwrap_or("Reflection")
                .chars()
                .take(80)
                .collect(),
            preview: r.preview.lines().take(3).collect::<Vec<_>>().join(" "),
            meta: r.created_at,
            // Reflections are append-only — they're a journal. Editing
            // would amount to rewriting history. Keep them immutable.
            deletable: false,
        })
        .collect())
}

fn get_reflection(state: &State<'_, Arc<AppState>>, id: &str) -> Result<BrainDetail, AppError> {
    let r = reflection::read_reflection(&state.user_db, id)?;
    Ok(BrainDetail {
        id: r.id,
        kind: "reflection".into(),
        title: r
            .body
            .lines()
            .next()
            .unwrap_or("Reflection")
            .chars()
            .take(80)
            .collect(),
        content: r.body,
        meta: r.created_at,
        deletable: false,
    })
}

// ── identity / constitution (single-file kinds) ─────────────────────────

fn single_file_list(
    kind: &str,
    title: &str,
    preview: &str,
    path: Option<std::path::PathBuf>,
) -> Vec<BrainListItem> {
    let exists = path.as_ref().map(|p| p.exists()).unwrap_or(false);
    if !exists {
        return Vec::new();
    }
    let meta = path
        .as_ref()
        .and_then(|p| p.metadata().ok())
        .and_then(|m| m.modified().ok())
        .and_then(|t| {
            t.duration_since(std::time::UNIX_EPOCH)
                .ok()
                .map(|d| chrono::DateTime::from_timestamp(d.as_secs() as i64, 0))
        })
        .flatten()
        .map(|dt| dt.to_rfc3339())
        .unwrap_or_default();
    vec![BrainListItem {
        id: kind.to_string(),
        kind: kind.to_string(),
        title: title.to_string(),
        preview: preview.to_string(),
        meta,
        deletable: false,
    }]
}

fn read_brain_file(kind: &str, title: &str, filename: &str) -> Result<BrainDetail, AppError> {
    let root = disk::brain_root()?;
    let path = root.join(filename);
    let content = std::fs::read_to_string(&path)
        .map_err(|e| AppError::Internal(format!("read {filename}: {e}")))?;
    let modified = path
        .metadata()
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| {
            t.duration_since(std::time::UNIX_EPOCH)
                .ok()
                .map(|d| chrono::DateTime::from_timestamp(d.as_secs() as i64, 0))
        })
        .flatten()
        .map(|dt| dt.to_rfc3339())
        .unwrap_or_default();
    Ok(BrainDetail {
        id: kind.to_string(),
        kind: kind.to_string(),
        title: title.to_string(),
        content,
        meta: modified,
        deletable: false,
    })
}

// ── helpers ─────────────────────────────────────────────────────────────

fn role_from_frontmatter(md: &str) -> String {
    if let Some(after) = md.strip_prefix("---\n") {
        if let Some(end) = after.find("\n---") {
            for line in after[..end].lines() {
                let line = line.trim();
                if let Some(rest) = line.strip_prefix("role:") {
                    return rest.trim().to_string();
                }
            }
        }
    }
    "episode".to_string()
}

fn body_after_frontmatter(md: &str) -> String {
    if let Some(after) = md.strip_prefix("---\n") {
        if let Some(end) = after.find("\n---") {
            return after[end + 4..].trim_start().to_string();
        }
    }
    md.to_string()
}

fn extract_section(md: &str, anchor: &str) -> Option<String> {
    let mut current_anchor = "intro".to_string();
    let mut buf: Vec<&str> = Vec::new();

    for line in md.lines() {
        if let Some(rest) = line.strip_prefix("## ") {
            if current_anchor == anchor {
                return Some(buf.join("\n"));
            }
            current_anchor = slugify(rest.trim());
            buf.clear();
            buf.push(line);
        } else {
            buf.push(line);
        }
    }
    if current_anchor == anchor {
        return Some(buf.join("\n"));
    }
    None
}

// ── design decisions ────────────────────────────────────────────────────

fn list_design_decisions(
    state: &State<'_, Arc<AppState>>,
) -> Result<Vec<BrainListItem>, AppError> {
    // Reuse the brain::decisions list path — same caps as the
    // standalone Decisions panel (cap-200 for the viewer pane).
    let rows = decisions::list_recent(&state.user_db, 200)?;
    Ok(rows
        .into_iter()
        .map(|d| {
            let preview = if d.choice.chars().count() > 80 {
                let trimmed: String = d.choice.chars().take(79).collect();
                format!("{trimmed}\u{2026}")
            } else {
                d.choice.clone()
            };
            let meta = match (
                d.persona_context.as_deref(),
                d.decision_timestamp.as_deref(),
            ) {
                (Some(ctx), Some(ts)) => format!("{ctx} · {ts}"),
                (Some(ctx), None) => ctx.to_string(),
                (None, Some(ts)) => ts.to_string(),
                (None, None) => d.created_at.clone(),
            };
            BrainListItem {
                id: d.id,
                kind: "design_decision".into(),
                title: d.label,
                preview,
                meta,
                deletable: false,
            }
        })
        .collect())
}

fn get_design_decision(
    state: &State<'_, Arc<AppState>>,
    id: &str,
) -> Result<BrainDetail, AppError> {
    let conn = state.user_db.get()?;
    let row = conn
        .query_row(
            "SELECT id, session_id, persona_context, label, choice, rationale,
                    decision_timestamp, created_at
             FROM companion_design_decision WHERE id = ?1",
            params![id],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, Option<String>>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, String>(4)?,
                    r.get::<_, String>(5)?,
                    r.get::<_, Option<String>>(6)?,
                    r.get::<_, String>(7)?,
                ))
            },
        )
        .map_err(|e| AppError::Internal(format!("design decision `{id}` not found — {e}")))?;
    let (
        row_id,
        session_id,
        persona_context,
        label,
        choice,
        rationale,
        decision_timestamp,
        created_at,
    ) = row;
    let meta = match (persona_context.as_deref(), decision_timestamp.as_deref()) {
        (Some(ctx), Some(ts)) => format!("{ctx} · {ts} · session {session_id}"),
        (Some(ctx), None) => format!("{ctx} · session {session_id}"),
        (None, Some(ts)) => format!("{ts} · session {session_id}"),
        (None, None) => format!("{created_at} · session {session_id}"),
    };
    let content = format!(
        "## Choice\n\n{choice}\n\n## Rationale\n\n{rationale}\n"
    );
    Ok(BrainDetail {
        id: row_id,
        kind: "design_decision".into(),
        title: label,
        content,
        meta,
        deletable: false,
    })
}

fn slugify(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut prev_dash = false;
    for ch in s.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
            prev_dash = false;
        } else if !prev_dash && !out.is_empty() {
            out.push('-');
            prev_dash = true;
        }
    }
    while out.ends_with('-') {
        out.pop();
    }
    if out.is_empty() {
        "section".into()
    } else {
        out
    }
}
