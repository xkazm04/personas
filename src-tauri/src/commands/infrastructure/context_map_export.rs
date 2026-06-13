//! Harness-doc export: project-side, server-free context map.
//!
//! Personas owns the contexts in its own SQLite DB. But projects *managed by*
//! Personas don't have Personas running alongside them at edit time — a CLI
//! opened directly in the managed project root is blind to the context map.
//!
//! This module mirrors Vibeman's "always-present context" mechanism: after a
//! scan, it writes two artifacts into the managed project root so any CLI
//! working there sees the map with zero server dependency:
//!
//!   1. `context-map.json` — the full machine-readable map (groups + contexts
//!      + taxonomy), regenerated from the DB on every scan.
//!   2. a managed `<!-- personas:context-map -->` section in `CLAUDE.md` —
//!      a human/agent-readable summary + a pointer to the JSON, injected
//!      idempotently (never clobbers the rest of the file).
//!
//! Best-effort: every failure is surfaced as an `AppError` the caller logs and
//! swallows. A missing harness doc must never fail a scan that already
//! committed contexts to the DB.

use serde_json::{json, Value};

use crate::db::repos::dev_tools as repo;
use crate::db::DbPool;
use crate::error::AppError;

// Canonical taxonomy embedded in the exported map so a project-side CLI can
// validate/extend categories without reaching back into Personas.
use super::context_generation::{CONTEXT_CATEGORIES, GROUP_DOMAINS};

const SECTION_START: &str = "<!-- personas:context-map:start -->";
const SECTION_END: &str = "<!-- personas:context-map:end -->";

/// Build `context-map.json` from the DB and write it + the CLAUDE.md section
/// into `root_path`. Returns the number of contexts written on success.
pub fn write_context_map_artifacts(
    pool: &DbPool,
    project_id: &str,
    root_path: &str,
) -> Result<usize, AppError> {
    let groups = repo::list_context_groups(pool, project_id)?;
    let contexts = repo::list_contexts_by_project(pool, project_id, None)?;
    let project_name = repo::get_project_by_id(pool, project_id)
        .ok()
        .map(|p| p.name);

    let map = build_map(project_id, project_name.as_deref(), root_path, &groups, &contexts);

    let root = std::path::Path::new(root_path);
    let json_path = root.join("context-map.json");
    let pretty = serde_json::to_string_pretty(&map)
        .map_err(|e| AppError::Internal(format!("serialize context-map.json: {e}")))?;
    std::fs::write(&json_path, pretty)
        .map_err(|e| AppError::Internal(format!("write context-map.json: {e}")))?;

    ensure_claude_md_section(root, &groups, &contexts)?;

    Ok(contexts.len())
}

/// Assemble the full `context-map.json` value.
fn build_map(
    project_id: &str,
    project_name: Option<&str>,
    root_path: &str,
    groups: &[crate::db::models::DevContextGroup],
    contexts: &[crate::db::models::DevContext],
) -> Value {
    let mut file_total = 0usize;

    let groups_json: Vec<Value> = groups
        .iter()
        .map(|g| {
            let context_count = contexts
                .iter()
                .filter(|c| c.group_id.as_deref() == Some(g.id.as_str()))
                .count();
            json!({
                "id": g.id,
                "name": g.name,
                "color": g.color,
                "domain": g.domain,
                "context_count": context_count,
            })
        })
        .collect();

    let contexts_json: Vec<Value> = contexts
        .iter()
        .map(|c| {
            let file_paths = parse_json_array(Some(c.file_paths.as_str()));
            if let Value::Array(a) = &file_paths {
                file_total += a.len();
            }
            let group_name = groups
                .iter()
                .find(|g| Some(g.id.as_str()) == c.group_id.as_deref())
                .map(|g| g.name.clone());
            json!({
                "id": c.id,
                "name": c.name,
                "group": group_name,
                "group_id": c.group_id,
                "category": c.category,
                "business_feature": c.business_feature,
                "description": c.description,
                "file_paths": file_paths,
                "entry_points": parse_json_array(c.entry_points.as_deref()),
                "db_tables": parse_json_array(c.db_tables.as_deref()),
                "keywords": parse_json_array(c.keywords.as_deref()),
                "api_surface": c.api_surface,
                "cross_refs": parse_json_array(c.cross_refs.as_deref()),
                "tech_stack": parse_json_array(c.tech_stack.as_deref()),
            })
        })
        .collect();

    json!({
        "version": 2,
        "generated_at": chrono::Utc::now().to_rfc3339(),
        "generator": "personas-context-scan",
        "project": {
            "id": project_id,
            "name": project_name,
            "root": root_path,
        },
        "taxonomy": {
            "context_categories": CONTEXT_CATEGORIES,
            "group_domains": GROUP_DOMAINS,
        },
        "stats": {
            "groups": groups.len(),
            "contexts": contexts.len(),
            "files": file_total,
        },
        "groups": groups_json,
        "contexts": contexts_json,
    })
}

/// Parse a stored JSON-array string field into a `Value::Array`, falling back
/// to an empty array on null/invalid input.
fn parse_json_array(s: Option<&str>) -> Value {
    s.and_then(|x| serde_json::from_str::<Value>(x).ok())
        .filter(Value::is_array)
        .unwrap_or_else(|| Value::Array(vec![]))
}

/// Inject or refresh the managed context-map section in `<root>/CLAUDE.md`.
/// Everything outside the START/END markers is preserved verbatim.
fn ensure_claude_md_section(
    root: &std::path::Path,
    groups: &[crate::db::models::DevContextGroup],
    contexts: &[crate::db::models::DevContext],
) -> Result<(), AppError> {
    let section = render_section(groups, contexts);
    let claude_md = root.join("CLAUDE.md");

    let new_contents = match std::fs::read_to_string(&claude_md) {
        Ok(existing) => splice_section(&existing, &section),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            format!("# Project Guidance\n\n{section}\n")
        }
        Err(e) => return Err(AppError::Internal(format!("read CLAUDE.md: {e}"))),
    };

    std::fs::write(&claude_md, new_contents)
        .map_err(|e| AppError::Internal(format!("write CLAUDE.md: {e}")))
}

/// Replace the existing managed block (if present) or append a fresh one.
fn splice_section(existing: &str, section: &str) -> String {
    if let (Some(start), Some(end_idx)) = (existing.find(SECTION_START), existing.find(SECTION_END))
    {
        let end = end_idx + SECTION_END.len();
        let mut out = String::with_capacity(existing.len() + section.len());
        out.push_str(&existing[..start]);
        out.push_str(section);
        out.push_str(&existing[end..]);
        out
    } else {
        let mut out = existing.to_string();
        if !out.ends_with('\n') {
            out.push('\n');
        }
        out.push('\n');
        out.push_str(section);
        out.push('\n');
        out
    }
}

/// Render the managed CLAUDE.md block. Kept concise — the JSON file is the
/// source of truth; this is the always-loaded pointer + a scannable index.
fn render_section(
    groups: &[crate::db::models::DevContextGroup],
    contexts: &[crate::db::models::DevContext],
) -> String {
    let mut out = String::new();
    out.push_str(SECTION_START);
    out.push('\n');
    out.push_str("## Project Context Map\n\n");
    out.push_str(&format!(
        "This project is organized into **{} contexts** across **{} groups**. \
The full machine-readable map lives in `context-map.json` at the project root — \
read it at task start to scope your edits to the relevant context's files.\n\n",
        contexts.len(),
        groups.len()
    ));

    out.push_str(
        "Taxonomy: each context has a `category` (ui · api · lib · data · test · config); \
each group has a `domain` (feature · infrastructure · shared · integration · data).\n\n",
    );

    if !groups.is_empty() {
        out.push_str("### Groups\n\n");
        for g in groups {
            let count = contexts
                .iter()
                .filter(|c| c.group_id.as_deref() == Some(g.id.as_str()))
                .count();
            let domain = g.domain.as_deref().unwrap_or("—");
            out.push_str(&format!(
                "- **{}** _(domain: {} · {} contexts)_\n",
                g.name, domain, count
            ));
        }
        out.push('\n');
    }

    out.push_str(
        "> Auto-generated by Personas on each context scan. Edits between the \
markers are overwritten on the next scan; edit `context-map.json` or rescan instead.\n",
    );
    out.push_str(SECTION_END);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splice_inserts_when_absent_and_replaces_when_present() {
        let body = "# My Project\n\nUse 2-space indent.\n";
        let v1 = splice_section(body, "<!-- personas:context-map:start -->\nA\n<!-- personas:context-map:end -->");
        assert!(v1.contains("Use 2-space indent"), "user content preserved");
        assert!(v1.contains("\nA\n"));

        // Second pass replaces the block, does not duplicate it.
        let v2 = splice_section(&v1, "<!-- personas:context-map:start -->\nB\n<!-- personas:context-map:end -->");
        assert!(v2.contains("Use 2-space indent"));
        assert!(v2.contains("\nB\n"));
        assert!(!v2.contains("\nA\n"), "old block replaced");
        assert_eq!(v2.matches(SECTION_START).count(), 1, "no duplicate markers");
    }

    #[test]
    fn parse_json_array_tolerates_garbage() {
        assert_eq!(parse_json_array(None), json!([]));
        assert_eq!(parse_json_array(Some("not json")), json!([]));
        assert_eq!(parse_json_array(Some("{\"a\":1}")), json!([]), "object → empty");
        assert_eq!(parse_json_array(Some("[\"a\",\"b\"]")), json!(["a", "b"]));
    }
}
