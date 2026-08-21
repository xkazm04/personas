use super::projects::row_to_project;
use crate::models::{
    CrossProjectRelation, DevIdea, PortfolioHealthSummary, ProjectHealthEntry, RiskMatrixEntry,
    TechRadarEntry,
};
use crate::DbPool;
use personas_core::error::AppError;
use rusqlite::{params, Row};

// ============================================================================
// Cross-Project (Codebases connector)
// ============================================================================

fn row_to_cross_relation(row: &Row) -> rusqlite::Result<CrossProjectRelation> {
    Ok(CrossProjectRelation {
        id: row.get("id")?,
        source_project_id: row.get("source_project_id")?,
        target_project_id: row.get("target_project_id")?,
        relation_type: row.get("relation_type")?,
        details: row.get("details")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

pub fn list_cross_project_relations(pool: &DbPool) -> Result<Vec<CrossProjectRelation>, AppError> {
    timed_query!(
        "cross_project_relations",
        "cross_project_relations::list",
        {
            let conn = pool.get()?;
            let mut stmt =
                conn.prepare("SELECT * FROM cross_project_relations ORDER BY created_at DESC")?;
            let rows = stmt.query_map([], row_to_cross_relation)?;
            rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
        }
    )
}

pub fn upsert_cross_project_relation(
    pool: &DbPool,
    source_project_id: &str,
    target_project_id: &str,
    relation_type: &str,
    details: Option<&str>,
) -> Result<CrossProjectRelation, AppError> {
    timed_query!(
        "cross_project_relations",
        "cross_project_relations::upsert",
        {
            let conn = pool.get()?;
            let id = uuid::Uuid::new_v4().to_string();
            let now = chrono::Utc::now().to_rfc3339();
            conn.execute(
            "INSERT INTO cross_project_relations (id, source_project_id, target_project_id, relation_type, details, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
             ON CONFLICT(source_project_id, target_project_id, relation_type)
             DO UPDATE SET details = ?5, updated_at = ?6",
            params![id, source_project_id, target_project_id, relation_type, details, now],
        )?;
            // Return the upserted row
            conn.query_row(
            "SELECT * FROM cross_project_relations WHERE source_project_id = ?1 AND target_project_id = ?2 AND relation_type = ?3",
            params![source_project_id, target_project_id, relation_type],
            row_to_cross_relation,
        )
        .map_err(AppError::from)
        }
    )
}

pub fn delete_cross_project_relations_for_project(
    pool: &DbPool,
    project_id: &str,
) -> Result<usize, AppError> {
    timed_query!(
        "cross_project_relations",
        "cross_project_relations::delete_for_project",
        {
            let conn = pool.get()?;
            let rows = conn.execute(
            "DELETE FROM cross_project_relations WHERE source_project_id = ?1 OR target_project_id = ?1",
            params![project_id],
        )?;
            Ok(rows)
        }
    )
}

/// Bulk create ideas across multiple projects in a single transaction.
#[allow(clippy::type_complexity)]
pub fn bulk_create_ideas_cross_project(
    pool: &DbPool,
    ideas: &[(
        Option<&str>,
        Option<&str>,
        &str,
        &str,
        &str,
        Option<&str>,
        Option<i32>,
        Option<i32>,
        Option<i32>,
    )],
    // Each tuple: (project_id, context_id, scan_type, category, title, description, effort, impact, risk)
) -> Result<Vec<DevIdea>, AppError> {
    timed_query!("dev_ideas", "dev_ideas::bulk_create_ideas_cross_project", {
        let conn = pool.get()?;
        let now = chrono::Utc::now().to_rfc3339();
        let mut created = Vec::with_capacity(ideas.len());

        for &(
            project_id,
            context_id,
            scan_type,
            category,
            title,
            description,
            effort,
            impact,
            risk,
        ) in ideas
        {
            let id = uuid::Uuid::new_v4().to_string();
            conn.execute(
            "INSERT INTO dev_ideas (id, project_id, context_id, scan_type, category, title, description, status, effort, impact, risk, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'pending', ?8, ?9, ?10, ?11, ?11)",
            params![id, project_id, context_id, scan_type, category, title, description, effort, impact, risk, now],
        )?;
            created.push(DevIdea {
                id,
                project_id: project_id.map(|s| s.to_string()),
                context_id: context_id.map(|s| s.to_string()),
                scan_type: scan_type.to_string(),
                category: category.to_string(),
                title: title.to_string(),
                description: description.map(|s| s.to_string()),
                reasoning: None,
                status: "pending".to_string(),
                effort,
                impact,
                risk,
                priority: None,
                provider: None,
                model: None,
                rejection_reason: None,
                // Scanner batch — not a sensor finding.
                origin: None,
                use_case_id: None,
                evidence: None,
                dedup_key: None,
                verify_state: None,
                verify_checked_at: None,
                verify_evidence: None,
                created_at: now.clone(),
                updated_at: now.clone(),
            });
        }
        Ok(created)
    })
}

/// Build portfolio health summary across all projects.
pub fn get_portfolio_health(pool: &DbPool) -> Result<PortfolioHealthSummary, AppError> {
    timed_query!("dev_projects", "dev_projects::get_portfolio_health", {
        let conn = pool.get()?;

        let total_projects: i32 =
            conn.query_row("SELECT COUNT(*) FROM dev_projects", [], |r| r.get(0))?;
        let active_projects: i32 = conn.query_row(
            "SELECT COUNT(*) FROM dev_projects WHERE status = 'active'",
            [],
            |r| r.get(0),
        )?;
        let total_ideas: i32 =
            conn.query_row("SELECT COUNT(*) FROM dev_ideas", [], |r| r.get(0))?;
        let pending_ideas: i32 = conn.query_row(
            "SELECT COUNT(*) FROM dev_ideas WHERE status = 'pending'",
            [],
            |r| r.get(0),
        )?;
        let total_tasks: i32 =
            conn.query_row("SELECT COUNT(*) FROM dev_tasks", [], |r| r.get(0))?;
        let running_tasks: i32 = conn.query_row(
            "SELECT COUNT(*) FROM dev_tasks WHERE status = 'running'",
            [],
            |r| r.get(0),
        )?;

        let avg_health_score: Option<f64> = conn.query_row(
        "SELECT AVG(overall_score) FROM (
            SELECT project_id, overall_score, ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY scanned_at DESC) AS rn
            FROM context_health_snapshots
         ) WHERE rn = 1",
        [],
        |r| r.get(0),
    ).unwrap_or(None);

        let mut projects = Vec::new();
        let mut stmt = conn.prepare("SELECT * FROM dev_projects ORDER BY name")?;
        let project_rows = stmt.query_map([], row_to_project)?;
        for project_result in project_rows {
            let p = project_result?;
            let context_count: i32 = conn.query_row(
                "SELECT COUNT(*) FROM dev_contexts WHERE project_id = ?1",
                params![p.id],
                |r| r.get(0),
            )?;
            let idea_count: i32 = conn.query_row(
                "SELECT COUNT(*) FROM dev_ideas WHERE project_id = ?1",
                params![p.id],
                |r| r.get(0),
            )?;
            let task_count: i32 = conn.query_row(
                "SELECT COUNT(*) FROM dev_tasks WHERE project_id = ?1",
                params![p.id],
                |r| r.get(0),
            )?;
            let latest_health_score: Option<i32> = conn.query_row(
            "SELECT overall_score FROM context_health_snapshots WHERE project_id = ?1 ORDER BY scanned_at DESC LIMIT 1",
            params![p.id], |r| r.get(0),
        ).ok();
            let open_risk_count: i32 = conn.query_row(
            "SELECT COUNT(*) FROM dev_ideas WHERE project_id = ?1 AND status = 'pending' AND risk >= 7",
            params![p.id], |r| r.get(0),
        )?;

            projects.push(ProjectHealthEntry {
                project_id: p.id,
                project_name: p.name,
                status: p.status,
                tech_stack: p.tech_stack,
                context_count,
                idea_count,
                task_count,
                latest_health_score,
                open_risk_count,
            });
        }

        Ok(PortfolioHealthSummary {
            total_projects,
            active_projects,
            total_ideas,
            pending_ideas,
            total_tasks,
            running_tasks,
            avg_health_score,
            projects,
        })
    })
}

/// Build tech radar by aggregating tech_stack across all projects.
pub fn get_tech_radar(pool: &DbPool) -> Result<Vec<TechRadarEntry>, AppError> {
    timed_query!("dev_projects", "dev_projects::get_tech_radar", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare("SELECT id, name, tech_stack FROM dev_projects WHERE tech_stack IS NOT NULL AND tech_stack != ''")?;
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>("id")?,
                row.get::<_, String>("name")?,
                row.get::<_, String>("tech_stack")?,
            ))
        })?;

        // Accumulate: tech -> list of project names
        let mut tech_map: std::collections::HashMap<String, Vec<String>> =
            std::collections::HashMap::new();
        for row_result in rows {
            let (_id, name, stack) = row_result?;
            for tech in stack
                .split(',')
                .map(|s| s.trim().to_lowercase())
                .filter(|s| !s.is_empty())
            {
                tech_map.entry(tech).or_default().push(name.clone());
            }
        }

        let total_projects: i32 =
            conn.query_row("SELECT COUNT(*) FROM dev_projects", [], |r| r.get(0))?;

        let mut entries: Vec<TechRadarEntry> = tech_map
            .into_iter()
            .map(|(tech, names)| {
                let count = names.len() as i32;
                let category = categorize_tech(&tech);
                let status = if count as f64 / total_projects.max(1) as f64 > 0.6 {
                    "adopt"
                } else if count > 1 {
                    "trial"
                } else {
                    "assess"
                };
                TechRadarEntry {
                    technology: tech,
                    category: category.to_string(),
                    project_count: count,
                    project_names: names,
                    status: status.to_string(),
                }
            })
            .collect();

        entries.sort_by_key(|e| std::cmp::Reverse(e.project_count));
        Ok(entries)
    })
}

/// Simple heuristic to categorize a technology string.
fn categorize_tech(tech: &str) -> &'static str {
    match tech {
        "rust" | "python" | "typescript" | "javascript" | "go" | "java" | "c#" | "ruby"
        | "swift" | "kotlin" => "language",
        "react" | "vue" | "angular" | "svelte" | "next.js" | "nuxt" | "fastapi" | "express"
        | "django" | "rails" | "actix" | "axum" | "tauri" => "framework",
        "postgres" | "postgresql" | "mysql" | "sqlite" | "mongodb" | "redis" | "dynamodb"
        | "supabase" | "neon" | "planetscale" => "database",
        "docker" | "kubernetes" | "terraform" | "github actions" | "circleci" | "vercel"
        | "netlify" | "aws" | "gcp" | "azure" => "tool",
        _ => "library",
    }
}

/// Build risk matrix by analyzing multiple risk dimensions across projects.
pub fn get_risk_matrix(pool: &DbPool) -> Result<Vec<RiskMatrixEntry>, AppError> {
    timed_query!("dev_projects", "dev_projects::get_risk_matrix", {
        let conn = pool.get()?;
        let mut risks = Vec::new();

        let mut stmt =
            conn.prepare("SELECT * FROM dev_projects WHERE status = 'active' ORDER BY name")?;
        let project_rows = stmt.query_map([], row_to_project)?;

        for project_result in project_rows {
            let p = project_result?;

            // Check for high-risk pending ideas
            let high_risk_count: i32 = conn.query_row(
            "SELECT COUNT(*) FROM dev_ideas WHERE project_id = ?1 AND status = 'pending' AND risk >= 8",
            params![p.id], |r| r.get(0),
        )?;
            if high_risk_count > 0 {
                let affected: Vec<String> = {
                    let mut s = conn.prepare(
                    "SELECT DISTINCT c.name FROM dev_ideas i JOIN dev_contexts c ON i.context_id = c.id WHERE i.project_id = ?1 AND i.status = 'pending' AND i.risk >= 8"
                )?;
                    let rows = s.query_map(params![p.id], |r| r.get::<_, String>(0))?;
                    rows.filter_map(|r| r.ok()).collect()
                };
                risks.push(RiskMatrixEntry {
                    project_id: p.id.clone(),
                    project_name: p.name.clone(),
                    risk_category: "security".to_string(),
                    severity: if high_risk_count > 3 {
                        "critical"
                    } else {
                        "high"
                    }
                    .to_string(),
                    description: format!("{} high-risk ideas pending review", high_risk_count),
                    affected_contexts: affected,
                });
            }

            // Check for stale projects (no scans in 30 days)
            let latest_scan: Option<String> = conn
                .query_row(
                    "SELECT MAX(created_at) FROM dev_scans WHERE project_id = ?1",
                    params![p.id],
                    |r| r.get(0),
                )
                .unwrap_or(None);
            let is_stale = match &latest_scan {
                Some(ts) => {
                    if let Ok(parsed) = chrono::DateTime::parse_from_rfc3339(ts) {
                        chrono::Utc::now().signed_duration_since(parsed).num_days() > 30
                    } else {
                        true
                    }
                }
                None => true,
            };
            if is_stale {
                risks.push(RiskMatrixEntry {
                    project_id: p.id.clone(),
                    project_name: p.name.clone(),
                    risk_category: "stale_project".to_string(),
                    severity: "medium".to_string(),
                    description: match &latest_scan {
                        Some(ts) => format!("Last scan: {}", &ts[..10]),
                        None => "Never scanned".to_string(),
                    },
                    affected_contexts: vec![],
                });
            }

            // Check for tech debt accumulation
            let debt_ideas: i32 = conn.query_row(
            "SELECT COUNT(*) FROM dev_ideas WHERE project_id = ?1 AND scan_type = 'tech-debt-tracker' AND status = 'pending'",
            params![p.id], |r| r.get(0),
        )?;
            if debt_ideas > 5 {
                risks.push(RiskMatrixEntry {
                    project_id: p.id.clone(),
                    project_name: p.name.clone(),
                    risk_category: "tech_debt".to_string(),
                    severity: if debt_ideas > 15 { "high" } else { "medium" }.to_string(),
                    description: format!("{} unaddressed tech debt items", debt_ideas),
                    affected_contexts: vec![],
                });
            }
        }

        risks.sort_by(|a, b| {
            let sev_order = |s: &str| match s {
                "critical" => 0,
                "high" => 1,
                "medium" => 2,
                _ => 3,
            };
            sev_order(&a.severity).cmp(&sev_order(&b.severity))
        });

        Ok(risks)
    })
}
