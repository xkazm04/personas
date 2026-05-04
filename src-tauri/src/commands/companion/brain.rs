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

use crate::companion::brain::doctrine;
use crate::companion::brain::reflection;
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
    match kind.as_str() {
        "episode" => list_episodes(&state),
        "doctrine" => list_doctrine(&state),
        "reflection" => list_reflections(&state),
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
    match kind.as_str() {
        "episode" => get_episode(&state, &id),
        "doctrine" => get_doctrine(&state, &id),
        "reflection" => get_reflection(&state, &id),
        "identity" => read_brain_file("identity", "Identity", "identity.md"),
        "constitution" => {
            read_brain_file("constitution", "Constitution", "constitution.md")
        }
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
    match kind.as_str() {
        "episode" => delete_episode(&state, &id),
        "doctrine" | "identity" | "constitution" => Err(AppError::Internal(format!(
            "`{kind}` items are not deletable from the viewer"
        ))),
        other => Err(AppError::Internal(format!(
            "brain kind `{other}` not yet supported"
        ))),
    }
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
    let _ = conn.execute(
        "DELETE FROM companion_fts WHERE node_id = ?1",
        params![id],
    );
    let _ = conn.execute(
        "DELETE FROM companion_embedding WHERE node_id = ?1",
        params![id],
    );
    conn.execute(
        "DELETE FROM companion_node WHERE id = ?1",
        params![id],
    )?;
    if let Some(rel) = file_path {
        if let Ok(root) = disk::brain_root() {
            let _ = std::fs::remove_file(root.join(rel));
        }
    }
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
    let (file_path, body_excerpt, created_at): (String, Option<String>, String) =
        conn.query_row(
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

fn get_fact_detail(
    state: &State<'_, Arc<AppState>>,
    id: &str,
) -> Result<BrainDetail, AppError> {
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
        content.push_str("> _Superseded — kept for historical record but no longer wins retrieval._\n\n");
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
