use std::sync::Arc;
use tauri::State;
use crate::db::models::{CrossProjectRelation, DevIdea, PortfolioHealthSummary, RiskMatrixEntry, TechRadarEntry};
use crate::db::repos::dev_tools as repo;
use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::AppState;

// ============================================================================
// Cross-Project (Codebases connector)
// ============================================================================

#[tauri::command]
pub fn dev_tools_list_cross_project_relations(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<CrossProjectRelation>, AppError> {
    require_auth_sync(&state)?;
    repo::list_cross_project_relations(&state.db)
}

#[tauri::command]
pub fn dev_tools_upsert_cross_project_relation(
    state: State<'_, Arc<AppState>>,
    source_project_id: String,
    target_project_id: String,
    relation_type: String,
    details: Option<String>,
) -> Result<CrossProjectRelation, AppError> {
    require_auth_sync(&state)?;
    repo::upsert_cross_project_relation(
        &state.db,
        &source_project_id,
        &target_project_id,
        &relation_type,
        details.as_deref(),
    )
}

/// Get a cross-project dependency map: all projects with their relations.
/// If a rich metadata map has been generated via generate_cross_project_metadata,
/// return that instead so agents get the full metadata layer.
#[tauri::command]
pub fn dev_tools_get_cross_project_map(
    state: State<'_, Arc<AppState>>,
) -> Result<serde_json::Value, AppError> {
    require_auth_sync(&state)?;

    // Prefer the rich cached metadata map if it exists
    if let Some(cached) = crate::db::repos::core::settings::get(
        &state.db,
        crate::db::settings_keys::DEV_TOOLS_CROSS_PROJECT_METADATA,
    )? {
        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&cached) {
            return Ok(parsed);
        }
    }

    let projects = repo::list_projects(&state.db, None)?;
    let relations = repo::list_cross_project_relations(&state.db)?;

    let project_summaries: Vec<serde_json::Value> = projects
        .iter()
        .map(|p| {
            serde_json::json!({
                "id": p.id,
                "name": p.name,
                "root_path": p.root_path,
                "description": p.description,
                "tech_stack": p.tech_stack,
                "github_url": p.github_url,
                "status": p.status,
            })
        })
        .collect();

    let relation_edges: Vec<serde_json::Value> = relations
        .iter()
        .map(|r| {
            serde_json::json!({
                "source": r.source_project_id,
                "target": r.target_project_id,
                "type": r.relation_type,
                "details": r.details,
            })
        })
        .collect();

    Ok(serde_json::json!({
        "projects": project_summaries,
        "relations": relation_edges,
        "generated_at": chrono::Utc::now().to_rfc3339(),
    }))
}

// ============================================================================
// Rich Cross-Project Metadata Map
//
// Aggregates per-project capabilities, keywords, tech layers, and entry points
// from each project's already-generated context map. Caches the result in
// app_settings under crate::db::settings_keys::DEV_TOOLS_CROSS_PROJECT_METADATA so agents connecting via the
// Codebases connector can efficiently evaluate which projects are relevant to
// a business task without re-scanning the filesystem.
// ============================================================================

// Key is defined centrally in `crate::db::settings_keys::DEV_TOOLS_CROSS_PROJECT_METADATA`.

fn parse_json_array(raw: &Option<String>) -> Vec<String> {
    raw.as_deref()
        .and_then(|s| serde_json::from_str::<Vec<String>>(s).ok())
        .unwrap_or_default()
}

fn top_n_by_count(counts: std::collections::HashMap<String, u32>, n: usize) -> Vec<String> {
    let mut pairs: Vec<(String, u32)> = counts.into_iter().collect();
    pairs.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
    pairs.into_iter().take(n).map(|(k, _)| k).collect()
}

fn detect_tech_layers(
    tech_stack_fields: &[Vec<String>],
    declared_tech_stack: &Option<String>,
) -> Vec<String> {
    let mut layers = std::collections::HashSet::new();
    let all: Vec<String> = tech_stack_fields
        .iter()
        .flatten()
        .cloned()
        .chain(
            declared_tech_stack
                .as_deref()
                .map(|s| {
                    s.split(',')
                        .map(|x| x.trim().to_string())
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default(),
        )
        .collect();

    for item in &all {
        let lower = item.to_lowercase();
        if lower.contains("react")
            || lower.contains("next")
            || lower.contains("nuxt")
            || lower.contains("vue")
            || lower.contains("svelte")
            || lower.contains("angular")
        {
            layers.insert("frontend".to_string());
        }
        if lower.contains("rust") || lower.contains("tauri") || lower.contains("actix") {
            layers.insert("rust-backend".to_string());
        }
        if lower.contains("node")
            || lower.contains("express")
            || lower.contains("nest")
            || lower.contains("fastify")
        {
            layers.insert("node-backend".to_string());
        }
        if lower.contains("python")
            || lower.contains("fastapi")
            || lower.contains("django")
            || lower.contains("flask")
        {
            layers.insert("python-backend".to_string());
        }
        if lower.contains("postgres")
            || lower.contains("mysql")
            || lower.contains("sqlite")
            || lower.contains("mongo")
        {
            layers.insert("database".to_string());
        }
        if lower.contains("typescript") || lower.contains("ts") {
            layers.insert("typescript".to_string());
        }
        if lower.contains("docker") || lower.contains("kubernetes") || lower.contains("terraform") {
            layers.insert("devops".to_string());
        }
    }

    let mut result: Vec<String> = layers.into_iter().collect();
    result.sort();
    result
}

fn jaccard_similarity(a: &[String], b: &[String]) -> f64 {
    if a.is_empty() && b.is_empty() {
        return 0.0;
    }
    let set_a: std::collections::HashSet<&String> = a.iter().collect();
    let set_b: std::collections::HashSet<&String> = b.iter().collect();
    let intersection = set_a.intersection(&set_b).count() as f64;
    let union = set_a.union(&set_b).count() as f64;
    if union == 0.0 {
        0.0
    } else {
        intersection / union
    }
}

/// Aggregate metadata for a single project from its existing context map.
fn aggregate_project_metadata(
    pool: &crate::db::DbPool,
    project: &crate::db::models::DevProject,
) -> Result<serde_json::Value, AppError> {
    let contexts = repo::list_contexts_by_project(pool, &project.id, None)?;
    let groups = repo::list_context_groups(pool, &project.id)?;
    let goals = repo::list_goals_by_project(pool, &project.id, None).unwrap_or_default();

    // Capabilities: derived from context groups (one entry per group with count)
    let capabilities: Vec<serde_json::Value> = groups
        .iter()
        .map(|g| {
            let count = contexts
                .iter()
                .filter(|c| c.group_id.as_deref() == Some(&g.id))
                .count();
            serde_json::json!({
                "name": g.name,
                "color": g.color,
                "group_type": g.group_type,
                "context_count": count,
            })
        })
        .collect();

    // Aggregate arrays from every context
    let mut keyword_counts: std::collections::HashMap<String, u32> =
        std::collections::HashMap::new();
    let mut all_entry_points: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut all_db_tables: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut all_api_surface: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut all_cross_refs: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut tech_stack_fields: Vec<Vec<String>> = Vec::new();
    let mut file_path_counts: std::collections::HashMap<String, u32> =
        std::collections::HashMap::new();

    for ctx in &contexts {
        for k in parse_json_array(&Some(ctx.keywords.clone().unwrap_or_default())) {
            let normalized = k.trim().to_lowercase();
            if !normalized.is_empty() && normalized.len() > 2 {
                *keyword_counts.entry(normalized).or_insert(0) += 1;
            }
        }
        for ep in parse_json_array(&ctx.entry_points) {
            if !ep.trim().is_empty() {
                all_entry_points.insert(ep);
            }
        }
        for db in parse_json_array(&ctx.db_tables) {
            if !db.trim().is_empty() {
                all_db_tables.insert(db);
            }
        }
        for api in parse_json_array(&ctx.api_surface) {
            if !api.trim().is_empty() {
                all_api_surface.insert(api);
            }
        }
        for xref in parse_json_array(&ctx.cross_refs) {
            if !xref.trim().is_empty() {
                all_cross_refs.insert(xref);
            }
        }
        tech_stack_fields.push(parse_json_array(&ctx.tech_stack));

        // Extract directory prefixes from file_paths to show hot areas
        for fp in parse_json_array(&Some(ctx.file_paths.clone())) {
            let dir = fp.split(&['/', '\\'][..]).next().unwrap_or(&fp).to_string();
            if !dir.is_empty() {
                *file_path_counts.entry(dir).or_insert(0) += 1;
            }
        }
    }

    let top_keywords = top_n_by_count(keyword_counts, 30);
    let hot_directories = top_n_by_count(file_path_counts, 10);
    let tech_layers = detect_tech_layers(&tech_stack_fields, &project.tech_stack);

    // Summary: human-readable one-liner
    let summary = if contexts.is_empty() {
        format!(
            "No context map generated yet for {}. Run Context Map scan to enable rich metadata.",
            project.name
        )
    } else {
        let capability_list: Vec<String> = groups.iter().take(5).map(|g| g.name.clone()).collect();
        format!(
            "{} — {} contexts across {} groups ({}). Tech: {}. {}",
            project.name,
            contexts.len(),
            groups.len(),
            capability_list.join(", "),
            if tech_layers.is_empty() {
                "unspecified".to_string()
            } else {
                tech_layers.join(", ")
            },
            project.description.as_deref().unwrap_or("No description.")
        )
    };

    Ok(serde_json::json!({
        "project_id": project.id,
        "name": project.name,
        "root_path": project.root_path,
        "description": project.description,
        "github_url": project.github_url,
        "status": project.status,
        "declared_tech_stack": project.tech_stack,
        "summary": summary,
        "capabilities": capabilities,
        "keywords": top_keywords,
        "tech_layers": tech_layers,
        "entry_points": all_entry_points.into_iter().take(20).collect::<Vec<_>>(),
        "db_tables": all_db_tables.into_iter().take(20).collect::<Vec<_>>(),
        "api_surface": all_api_surface.into_iter().take(20).collect::<Vec<_>>(),
        "cross_refs": all_cross_refs.into_iter().collect::<Vec<_>>(),
        "hot_directories": hot_directories,
        "context_count": contexts.len(),
        "group_count": groups.len(),
        "active_goal_count": goals.iter().filter(|g| g.status == "in-progress" || g.status == "open").count(),
    }))
}

/// Generate a rich cross-project metadata map by aggregating each project's
/// existing context map. No filesystem scanning — reuses data already in the DB.
/// `project_id: Some(..)` scopes the re-aggregation to ONE project: every other
/// project's entry is carried over from the cached map (cross-project insights
/// still recompute over the merged set), sparing the full-fleet pass.
#[tauri::command]
pub fn dev_tools_generate_cross_project_metadata(
    state: State<'_, Arc<AppState>>,
    project_id: Option<String>,
) -> Result<serde_json::Value, AppError> {
    require_auth_sync(&state)?;
    let projects = repo::list_projects(&state.db, None)?;
    let relations = repo::list_cross_project_relations(&state.db)?;

    // Scoped rescan: reuse cached entries for every project except the target.
    let cached_projects: Vec<serde_json::Value> = if project_id.is_some() {
        crate::db::repos::core::settings::get(
            &state.db,
            crate::db::settings_keys::DEV_TOOLS_CROSS_PROJECT_METADATA,
        )?
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .and_then(|c| c.get("projects").and_then(|v| v.as_array().cloned()))
        .unwrap_or_default()
    } else {
        Vec::new()
    };

    // Aggregate per project
    let mut project_metadata: Vec<serde_json::Value> = Vec::new();
    for project in &projects {
        let carry_over = match &project_id {
            Some(pid) if pid != &project.id => cached_projects
                .iter()
                .find(|m| m.get("project_id").and_then(|v| v.as_str()) == Some(project.id.as_str()))
                .cloned(),
            _ => None,
        };
        if let Some(existing) = carry_over {
            project_metadata.push(existing);
            continue;
        }
        match aggregate_project_metadata(&state.db, project) {
            Ok(meta) => project_metadata.push(meta),
            Err(e) => {
                tracing::warn!("Failed to aggregate metadata for {}: {}", project.name, e);
            }
        }
    }

    // Cross-project insights
    let project_keyword_sets: Vec<(String, Vec<String>)> = project_metadata
        .iter()
        .map(|p| {
            let name = p
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let keywords: Vec<String> = p
                .get("keywords")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str().map(String::from))
                        .collect()
                })
                .unwrap_or_default();
            (name, keywords)
        })
        .collect();

    // Shared keywords: appearing in 2+ projects
    let mut keyword_project_count: std::collections::HashMap<String, Vec<String>> =
        std::collections::HashMap::new();
    for (name, keywords) in &project_keyword_sets {
        for kw in keywords {
            keyword_project_count
                .entry(kw.clone())
                .or_default()
                .push(name.clone());
        }
    }
    let shared_keywords: Vec<serde_json::Value> = keyword_project_count
        .iter()
        .filter(|(_, projects)| projects.len() >= 2)
        .map(|(kw, projects)| {
            serde_json::json!({ "keyword": kw, "projects": projects, "count": projects.len() })
        })
        .collect();

    // Similarity matrix
    let mut similarity_matrix: Vec<serde_json::Value> = Vec::new();
    for i in 0..project_keyword_sets.len() {
        for j in (i + 1)..project_keyword_sets.len() {
            let sim = jaccard_similarity(&project_keyword_sets[i].1, &project_keyword_sets[j].1);
            if sim > 0.0 {
                similarity_matrix.push(serde_json::json!({
                    "source": project_keyword_sets[i].0,
                    "target": project_keyword_sets[j].0,
                    "similarity": (sim * 100.0).round() / 100.0,
                }));
            }
        }
    }

    // Shared tech layers across projects
    let mut tech_layer_counts: std::collections::HashMap<String, u32> =
        std::collections::HashMap::new();
    for p in &project_metadata {
        if let Some(layers) = p.get("tech_layers").and_then(|v| v.as_array()) {
            for l in layers {
                if let Some(s) = l.as_str() {
                    *tech_layer_counts.entry(s.to_string()).or_insert(0) += 1;
                }
            }
        }
    }
    let tech_distribution: Vec<serde_json::Value> = tech_layer_counts
        .into_iter()
        .map(|(layer, count)| serde_json::json!({ "layer": layer, "project_count": count }))
        .collect();

    let relation_edges: Vec<serde_json::Value> = relations
        .iter()
        .map(|r| {
            serde_json::json!({
                "source": r.source_project_id,
                "target": r.target_project_id,
                "type": r.relation_type,
                "details": r.details,
            })
        })
        .collect();

    let result = serde_json::json!({
        "projects": project_metadata,
        "cross_project": {
            "shared_keywords": shared_keywords,
            "similarity_matrix": similarity_matrix,
            "tech_distribution": tech_distribution,
            "relations": relation_edges,
        },
        "generated_at": chrono::Utc::now().to_rfc3339(),
        "total_projects": projects.len(),
    });

    // Cache result in app_settings
    let json_str = serde_json::to_string(&result)
        .map_err(|e| AppError::Validation(format!("Failed to serialize metadata: {e}")))?;
    crate::db::repos::core::settings::set(
        &state.db,
        crate::db::settings_keys::DEV_TOOLS_CROSS_PROJECT_METADATA,
        &json_str,
    )?;

    Ok(result)
}

/// Get the cached cross-project metadata map. Returns None if never generated.
#[tauri::command]
pub fn dev_tools_get_cross_project_metadata(
    state: State<'_, Arc<AppState>>,
) -> Result<Option<serde_json::Value>, AppError> {
    require_auth_sync(&state)?;
    match crate::db::repos::core::settings::get(
        &state.db,
        crate::db::settings_keys::DEV_TOOLS_CROSS_PROJECT_METADATA,
    )? {
        Some(json_str) => {
            let parsed: serde_json::Value = serde_json::from_str(&json_str)
                .map_err(|e| AppError::Validation(format!("Corrupted metadata cache: {e}")))?;
            Ok(Some(parsed))
        }
        None => Ok(None),
    }
}

/// Bulk create ideas targeting different projects.
#[tauri::command]
pub fn dev_tools_create_idea_batch(
    state: State<'_, Arc<AppState>>,
    ideas: Vec<serde_json::Value>,
) -> Result<Vec<DevIdea>, AppError> {
    require_auth_sync(&state)?;
    let mut tuples = Vec::new();
    for idea in &ideas {
        let project_id = idea.get("project_id").and_then(|v| v.as_str());
        let context_id = idea.get("context_id").and_then(|v| v.as_str());
        let scan_type = idea
            .get("scan_type")
            .and_then(|v| v.as_str())
            .unwrap_or("cross-impact");
        let category = idea
            .get("category")
            .and_then(|v| v.as_str())
            .unwrap_or("technical");
        let title = idea
            .get("title")
            .and_then(|v| v.as_str())
            .unwrap_or("Untitled");
        let description = idea.get("description").and_then(|v| v.as_str());
        let effort = idea
            .get("effort")
            .and_then(|v| v.as_i64())
            .map(|v| v as i32);
        let impact = idea
            .get("impact")
            .and_then(|v| v.as_i64())
            .map(|v| v as i32);
        let risk = idea.get("risk").and_then(|v| v.as_i64()).map(|v| v as i32);
        tuples.push((
            project_id,
            context_id,
            scan_type,
            category,
            title,
            description,
            effort,
            impact,
            risk,
        ));
    }
    repo::bulk_create_ideas_cross_project(&state.db, &tuples)
}

/// Search code across all registered projects using ripgrep.
#[tauri::command]
pub async fn dev_tools_search_across_projects(
    state: State<'_, Arc<AppState>>,
    query: String,
    file_pattern: Option<String>,
    max_results_per_project: Option<i32>,
) -> Result<serde_json::Value, AppError> {
    require_auth_sync(&state)?;
    let projects = repo::list_projects(&state.db, Some("active"))?;
    let limit = max_results_per_project.unwrap_or(20);

    let mut results = Vec::new();
    for project in &projects {
        let mut args = vec![
            "--json".to_string(),
            "--max-count".to_string(),
            limit.to_string(),
            "--no-heading".to_string(),
        ];
        if let Some(ref pat) = file_pattern {
            args.push("--glob".to_string());
            args.push(pat.clone());
        }
        args.push(query.clone());
        args.push(project.root_path.clone());

        let output = tokio::process::Command::new("rg")
            .args(&args)
            .output()
            .await;

        let matches: Vec<serde_json::Value> = match output {
            Ok(out) => {
                let stdout = String::from_utf8_lossy(&out.stdout);
                stdout
                    .lines()
                    .filter_map(|line| serde_json::from_str::<serde_json::Value>(line).ok())
                    .filter(|v| v.get("type").and_then(|t| t.as_str()) == Some("match"))
                    .collect()
            }
            Err(_) => vec![],
        };

        if !matches.is_empty() {
            results.push(serde_json::json!({
                "project_id": project.id,
                "project_name": project.name,
                "root_path": project.root_path,
                "match_count": matches.len(),
                "matches": matches,
            }));
        }
    }

    Ok(serde_json::json!({
        "query": query,
        "projects_searched": projects.len(),
        "projects_with_matches": results.len(),
        "results": results,
    }))
}

// ============================================================================
// Direction 5: Portfolio Intelligence
// ============================================================================

#[tauri::command]
pub fn dev_tools_get_portfolio_health(
    state: State<'_, Arc<AppState>>,
) -> Result<PortfolioHealthSummary, AppError> {
    require_auth_sync(&state)?;
    repo::get_portfolio_health(&state.db)
}

#[tauri::command]
pub fn dev_tools_get_tech_radar(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<TechRadarEntry>, AppError> {
    require_auth_sync(&state)?;
    repo::get_tech_radar(&state.db)
}

#[tauri::command]
pub fn dev_tools_get_risk_matrix(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<RiskMatrixEntry>, AppError> {
    require_auth_sync(&state)?;
    repo::get_risk_matrix(&state.db)
}

/// Get a summary of a single project (used by both Codebase and Codebases connectors).
#[tauri::command]
pub fn dev_tools_get_project_summary(
    state: State<'_, Arc<AppState>>,
    project_id: String,
) -> Result<serde_json::Value, AppError> {
    require_auth_sync(&state)?;
    let project = repo::get_project_by_id(&state.db, &project_id)?;
    let contexts = repo::list_contexts_by_project(&state.db, &project_id, None)?;
    let groups = repo::list_context_groups(&state.db, &project_id)?;
    let ideas = repo::list_ideas(&state.db, Some(&project_id), None, None, None, None)?;
    let tasks = repo::list_tasks(&state.db, Some(&project_id), None)?;
    let goals = repo::list_goals_by_project(&state.db, &project_id, None).unwrap_or_default();

    let pending_ideas = ideas.iter().filter(|i| i.status == "pending").count();
    let accepted_ideas = ideas.iter().filter(|i| i.status == "accepted").count();
    let running_tasks = tasks.iter().filter(|t| t.status == "running").count();
    let active_goals = goals
        .iter()
        .filter(|g| g.status == "in-progress" || g.status == "open")
        .count();

    Ok(serde_json::json!({
        "project": {
            "id": project.id,
            "name": project.name,
            "root_path": project.root_path,
            "description": project.description,
            "tech_stack": project.tech_stack,
            "github_url": project.github_url,
            "status": project.status,
            "created_at": project.created_at,
        },
        "context_map": {
            "groups": groups.len(),
            "contexts": contexts.len(),
            "group_names": groups.iter().map(|g| g.name.clone()).collect::<Vec<_>>(),
        },
        "backlog": {
            "total_ideas": ideas.len(),
            "pending": pending_ideas,
            "accepted": accepted_ideas,
        },
        "tasks": {
            "total": tasks.len(),
            "running": running_tasks,
        },
        "goals": {
            "total": goals.len(),
            "active": active_goals,
            "titles": goals.iter().take(10).map(|g| g.title.clone()).collect::<Vec<_>>(),
        },
    }))
}

/// Analyze dependency manifests across all projects to find shared deps and version drift.
#[tauri::command]
pub async fn dev_tools_get_dependency_graph(
    state: State<'_, Arc<AppState>>,
) -> Result<serde_json::Value, AppError> {
    require_auth_sync(&state)?;
    let projects = repo::list_projects(&state.db, Some("active"))?;

    let mut all_deps: std::collections::HashMap<String, Vec<serde_json::Value>> =
        std::collections::HashMap::new();

    let section_re = regex::Regex::new(r"\[((?:dev-|build-)?dependencies)\]").unwrap();
    let dep_inline_re = regex::Regex::new(r#"^(\w[\w-]*)\s*=\s*"([^"]+)""#).unwrap();
    let dep_table_re =
        regex::Regex::new(r#"^(\w[\w-]*)\s*=\s*\{.*version\s*=\s*"([^"]+)".*\}"#).unwrap();

    for project in &projects {
        let root = std::path::Path::new(&project.root_path);

        // Check package.json
        let pkg_path = root.join("package.json");
        if pkg_path.exists() {
            if let Ok(content) = tokio::fs::read_to_string(&pkg_path).await {
                if let Ok(pkg) = serde_json::from_str::<serde_json::Value>(&content) {
                    for section in ["dependencies", "devDependencies"] {
                        if let Some(deps) = pkg.get(section).and_then(|d| d.as_object()) {
                            for (name, version) in deps {
                                all_deps
                                    .entry(name.clone())
                                    .or_default()
                                    .push(serde_json::json!({
                                        "project_id": project.id,
                                        "project_name": project.name,
                                        "version": version,
                                        "section": section,
                                        "manifest": "package.json",
                                    }));
                            }
                        }
                    }
                }
            }
        }

        // Check Cargo.toml (simple regex parse -- no toml crate needed)
        let cargo_path = root.join("Cargo.toml");
        if cargo_path.exists() {
            if let Ok(content) = tokio::fs::read_to_string(&cargo_path).await {
                let mut current_section: Option<&str> = None;
                for line in content.lines() {
                    let trimmed = line.trim();
                    if let Some(caps) = section_re.captures(trimmed) {
                        current_section = caps.get(1).map(|m| m.as_str());
                        // Leak-free: match on known section strings
                        current_section = match current_section {
                            Some("dependencies") => Some("dependencies"),
                            Some("dev-dependencies") => Some("dev-dependencies"),
                            Some("build-dependencies") => Some("build-dependencies"),
                            _ => None,
                        };
                        continue;
                    }
                    if trimmed.starts_with('[') {
                        current_section = None;
                        continue;
                    }
                    if let Some(section) = current_section {
                        let (name, version) = if let Some(caps) = dep_inline_re.captures(trimmed) {
                            (
                                caps.get(1).map(|m| m.as_str().to_string()),
                                caps.get(2).map(|m| m.as_str().to_string()),
                            )
                        } else if let Some(caps) = dep_table_re.captures(trimmed) {
                            (
                                caps.get(1).map(|m| m.as_str().to_string()),
                                caps.get(2).map(|m| m.as_str().to_string()),
                            )
                        } else {
                            (None, None)
                        };
                        if let (Some(name), Some(version)) = (name, version) {
                            all_deps.entry(name).or_default().push(serde_json::json!({
                                "project_id": project.id,
                                "project_name": project.name,
                                "version": version,
                                "section": section,
                                "manifest": "Cargo.toml",
                            }));
                        }
                    }
                }
            }
        }
    }

    // Find shared deps (used by 2+ projects)
    let shared: Vec<serde_json::Value> = all_deps
        .iter()
        .filter(|(_, usages)| {
            let unique_projects: std::collections::HashSet<&str> = usages
                .iter()
                .filter_map(|u| u.get("project_id").and_then(|p| p.as_str()))
                .collect();
            unique_projects.len() > 1
        })
        .map(|(name, usages)| {
            let versions: Vec<&str> = usages
                .iter()
                .filter_map(|u| u.get("version").and_then(|v| v.as_str()))
                .collect();
            let has_drift = {
                let unique: std::collections::HashSet<&&str> = versions.iter().collect();
                unique.len() > 1
            };
            serde_json::json!({
                "name": name,
                "usages": usages,
                "has_version_drift": has_drift,
            })
        })
        .collect();

    Ok(serde_json::json!({
        "total_unique_deps": all_deps.len(),
        "shared_deps": shared.len(),
        "dependencies": shared,
    }))
}


