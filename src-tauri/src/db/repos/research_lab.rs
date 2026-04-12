use rusqlite::params;
use uuid::Uuid;

use crate::db::DbPool;
use crate::db::models::{
    CreateResearchProject, ResearchDashboardStats, ResearchProject, UpdateResearchProject,
    CreateResearchSource, ResearchSource,
    CreateResearchHypothesis, ResearchHypothesis,
    CreateResearchExperiment, ResearchExperiment, ResearchExperimentRun,
    CreateResearchFinding, ResearchFinding,
    CreateResearchReport, ResearchReport,
};
use crate::error::AppError;

// ============================================================================
// Research Projects
// ============================================================================

pub fn list_projects(pool: &DbPool) -> Result<Vec<ResearchProject>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT id, name, description, domain, status, thesis, scope_constraints, team_id, obsidian_vault_path, created_at, updated_at
         FROM research_projects ORDER BY updated_at DESC"
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(ResearchProject {
            id: row.get(0)?,
            name: row.get(1)?,
            description: row.get(2)?,
            domain: row.get(3)?,
            status: row.get(4)?,
            thesis: row.get(5)?,
            scope_constraints: row.get(6)?,
            team_id: row.get(7)?,
            obsidian_vault_path: row.get(8)?,
            created_at: row.get(9)?,
            updated_at: row.get(10)?,
        })
    })?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

pub fn get_project(pool: &DbPool, id: &str) -> Result<ResearchProject, AppError> {
    let conn = pool.get()?;
    conn.query_row(
        "SELECT id, name, description, domain, status, thesis, scope_constraints, team_id, obsidian_vault_path, created_at, updated_at
         FROM research_projects WHERE id = ?1",
        params![id],
        |row| {
            Ok(ResearchProject {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                domain: row.get(3)?,
                status: row.get(4)?,
                thesis: row.get(5)?,
                scope_constraints: row.get(6)?,
                team_id: row.get(7)?,
                obsidian_vault_path: row.get(8)?,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
            })
        },
    )
    .map_err(|_| AppError::NotFound(format!("Research project {id} not found")))
}

pub fn create_project(pool: &DbPool, input: &CreateResearchProject) -> Result<ResearchProject, AppError> {
    let id = Uuid::new_v4().to_string();
    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO research_projects (id, name, description, domain, status, thesis, scope_constraints, team_id, obsidian_vault_path)
         VALUES (?1, ?2, ?3, ?4, 'scoping', ?5, ?6, ?7, ?8)",
        params![id, input.name, input.description, input.domain, input.thesis, input.scope_constraints, input.team_id, input.obsidian_vault_path],
    )?;
    get_project(pool, &id)
}

pub fn update_project(pool: &DbPool, id: &str, input: &UpdateResearchProject) -> Result<ResearchProject, AppError> {
    let existing = get_project(pool, id)?;
    let conn = pool.get()?;
    conn.execute(
        "UPDATE research_projects SET name = ?1, description = ?2, domain = ?3, status = ?4, thesis = ?5, scope_constraints = ?6, team_id = ?7, obsidian_vault_path = ?8, updated_at = datetime('now') WHERE id = ?9",
        params![
            input.name.as_deref().unwrap_or(&existing.name),
            input.description.as_ref().or(existing.description.as_ref()),
            input.domain.as_ref().or(existing.domain.as_ref()),
            input.status.as_deref().unwrap_or(&existing.status),
            input.thesis.as_ref().or(existing.thesis.as_ref()),
            input.scope_constraints.as_ref().or(existing.scope_constraints.as_ref()),
            input.team_id.as_ref().or(existing.team_id.as_ref()),
            input.obsidian_vault_path.as_ref().or(existing.obsidian_vault_path.as_ref()),
            id,
        ],
    )?;
    get_project(pool, id)
}

pub fn delete_project(pool: &DbPool, id: &str) -> Result<(), AppError> {
    let conn = pool.get()?;
    conn.execute("DELETE FROM research_projects WHERE id = ?1", params![id])?;
    Ok(())
}

// ============================================================================
// Research Sources
// ============================================================================

pub fn list_sources(pool: &DbPool, project_id: &str) -> Result<Vec<ResearchSource>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT id, project_id, source_type, title, authors, year, abstract_text, doi, url, pdf_path, citation_count, metadata, relevance_score, knowledge_base_id, status, ingested_at, created_at, updated_at
         FROM research_sources WHERE project_id = ?1 ORDER BY created_at DESC"
    )?;
    let rows = stmt.query_map(params![project_id], |row| {
        Ok(ResearchSource {
            id: row.get(0)?,
            project_id: row.get(1)?,
            source_type: row.get(2)?,
            title: row.get(3)?,
            authors: row.get(4)?,
            year: row.get(5)?,
            abstract_text: row.get(6)?,
            doi: row.get(7)?,
            url: row.get(8)?,
            pdf_path: row.get(9)?,
            citation_count: row.get(10)?,
            metadata: row.get(11)?,
            relevance_score: row.get(12)?,
            knowledge_base_id: row.get(13)?,
            status: row.get(14)?,
            ingested_at: row.get(15)?,
            created_at: row.get(16)?,
            updated_at: row.get(17)?,
        })
    })?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

pub fn create_source(pool: &DbPool, input: &CreateResearchSource) -> Result<ResearchSource, AppError> {
    let id = Uuid::new_v4().to_string();
    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO research_sources (id, project_id, source_type, title, authors, year, abstract_text, doi, url, metadata)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![id, input.project_id, input.source_type, input.title, input.authors, input.year, input.abstract_text, input.doi, input.url, input.metadata],
    )?;
    let conn2 = pool.get()?;
    conn2.query_row(
        "SELECT id, project_id, source_type, title, authors, year, abstract_text, doi, url, pdf_path, citation_count, metadata, relevance_score, knowledge_base_id, status, ingested_at, created_at, updated_at FROM research_sources WHERE id = ?1",
        params![id],
        |row| Ok(ResearchSource {
            id: row.get(0)?, project_id: row.get(1)?, source_type: row.get(2)?, title: row.get(3)?,
            authors: row.get(4)?, year: row.get(5)?, abstract_text: row.get(6)?, doi: row.get(7)?,
            url: row.get(8)?, pdf_path: row.get(9)?, citation_count: row.get(10)?, metadata: row.get(11)?,
            relevance_score: row.get(12)?, knowledge_base_id: row.get(13)?, status: row.get(14)?,
            ingested_at: row.get(15)?, created_at: row.get(16)?, updated_at: row.get(17)?,
        }),
    ).map_err(AppError::from)
}

pub fn delete_source(pool: &DbPool, id: &str) -> Result<(), AppError> {
    let conn = pool.get()?;
    conn.execute("DELETE FROM research_sources WHERE id = ?1", params![id])?;
    Ok(())
}

// ============================================================================
// Research Hypotheses
// ============================================================================

pub fn list_hypotheses(pool: &DbPool, project_id: &str) -> Result<Vec<ResearchHypothesis>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT id, project_id, statement, rationale, status, confidence, parent_hypothesis_id, generated_by, supporting_evidence, counter_evidence, linked_experiments, created_at, updated_at
         FROM research_hypotheses WHERE project_id = ?1 ORDER BY created_at DESC"
    )?;
    let rows = stmt.query_map(params![project_id], |row| {
        Ok(ResearchHypothesis {
            id: row.get(0)?, project_id: row.get(1)?, statement: row.get(2)?,
            rationale: row.get(3)?, status: row.get(4)?, confidence: row.get(5)?,
            parent_hypothesis_id: row.get(6)?, generated_by: row.get(7)?,
            supporting_evidence: row.get(8)?, counter_evidence: row.get(9)?,
            linked_experiments: row.get(10)?, created_at: row.get(11)?, updated_at: row.get(12)?,
        })
    })?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

pub fn create_hypothesis(pool: &DbPool, input: &CreateResearchHypothesis) -> Result<ResearchHypothesis, AppError> {
    let id = Uuid::new_v4().to_string();
    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO research_hypotheses (id, project_id, statement, rationale, generated_by) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![id, input.project_id, input.statement, input.rationale, input.generated_by],
    )?;
    let conn2 = pool.get()?;
    conn2.query_row(
        "SELECT id, project_id, statement, rationale, status, confidence, parent_hypothesis_id, generated_by, supporting_evidence, counter_evidence, linked_experiments, created_at, updated_at FROM research_hypotheses WHERE id = ?1",
        params![id],
        |row| Ok(ResearchHypothesis {
            id: row.get(0)?, project_id: row.get(1)?, statement: row.get(2)?,
            rationale: row.get(3)?, status: row.get(4)?, confidence: row.get(5)?,
            parent_hypothesis_id: row.get(6)?, generated_by: row.get(7)?,
            supporting_evidence: row.get(8)?, counter_evidence: row.get(9)?,
            linked_experiments: row.get(10)?, created_at: row.get(11)?, updated_at: row.get(12)?,
        }),
    ).map_err(AppError::from)
}

pub fn update_hypothesis(pool: &DbPool, id: &str, status: Option<&str>, confidence: Option<f64>, supporting_evidence: Option<&str>, counter_evidence: Option<&str>) -> Result<(), AppError> {
    let conn = pool.get()?;
    let mut parts = vec!["updated_at = datetime('now')".to_string()];
    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(s) = status {
        parts.push(format!("status = ?{}", param_values.len() + 1));
        param_values.push(Box::new(s.to_string()));
    }
    if let Some(c) = confidence {
        parts.push(format!("confidence = ?{}", param_values.len() + 1));
        param_values.push(Box::new(c));
    }
    if let Some(se) = supporting_evidence {
        parts.push(format!("supporting_evidence = ?{}", param_values.len() + 1));
        param_values.push(Box::new(se.to_string()));
    }
    if let Some(ce) = counter_evidence {
        parts.push(format!("counter_evidence = ?{}", param_values.len() + 1));
        param_values.push(Box::new(ce.to_string()));
    }

    param_values.push(Box::new(id.to_string()));
    let sql = format!("UPDATE research_hypotheses SET {} WHERE id = ?{}", parts.join(", "), param_values.len());
    let params: Vec<&dyn rusqlite::types::ToSql> = param_values.iter().map(|p| p.as_ref()).collect();
    conn.execute(&sql, params.as_slice())?;
    Ok(())
}

pub fn delete_hypothesis(pool: &DbPool, id: &str) -> Result<(), AppError> {
    let conn = pool.get()?;
    conn.execute("DELETE FROM research_hypotheses WHERE id = ?1", params![id])?;
    Ok(())
}

// ============================================================================
// Research Experiments
// ============================================================================

pub fn list_experiments(pool: &DbPool, project_id: &str) -> Result<Vec<ResearchExperiment>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT id, project_id, hypothesis_id, name, methodology, input_schema, success_criteria, status, pipeline_id, created_at, updated_at
         FROM research_experiments WHERE project_id = ?1 ORDER BY created_at DESC"
    )?;
    let rows = stmt.query_map(params![project_id], |row| {
        Ok(ResearchExperiment {
            id: row.get(0)?, project_id: row.get(1)?, hypothesis_id: row.get(2)?,
            name: row.get(3)?, methodology: row.get(4)?, input_schema: row.get(5)?,
            success_criteria: row.get(6)?, status: row.get(7)?, pipeline_id: row.get(8)?,
            created_at: row.get(9)?, updated_at: row.get(10)?,
        })
    })?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

pub fn create_experiment(pool: &DbPool, input: &CreateResearchExperiment) -> Result<ResearchExperiment, AppError> {
    let id = Uuid::new_v4().to_string();
    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO research_experiments (id, project_id, hypothesis_id, name, methodology, input_schema, success_criteria) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![id, input.project_id, input.hypothesis_id, input.name, input.methodology, input.input_schema, input.success_criteria],
    )?;
    let conn2 = pool.get()?;
    conn2.query_row(
        "SELECT id, project_id, hypothesis_id, name, methodology, input_schema, success_criteria, status, pipeline_id, created_at, updated_at FROM research_experiments WHERE id = ?1",
        params![id],
        |row| Ok(ResearchExperiment {
            id: row.get(0)?, project_id: row.get(1)?, hypothesis_id: row.get(2)?,
            name: row.get(3)?, methodology: row.get(4)?, input_schema: row.get(5)?,
            success_criteria: row.get(6)?, status: row.get(7)?, pipeline_id: row.get(8)?,
            created_at: row.get(9)?, updated_at: row.get(10)?,
        }),
    ).map_err(AppError::from)
}

pub fn delete_experiment(pool: &DbPool, id: &str) -> Result<(), AppError> {
    let conn = pool.get()?;
    conn.execute("DELETE FROM research_experiments WHERE id = ?1", params![id])?;
    Ok(())
}

// ============================================================================
// Research Findings
// ============================================================================

pub fn list_findings(pool: &DbPool, project_id: &str) -> Result<Vec<ResearchFinding>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT id, project_id, title, description, confidence, category, source_experiment_ids, source_ids, hypothesis_ids, generated_by, status, created_at, updated_at
         FROM research_findings WHERE project_id = ?1 ORDER BY confidence DESC"
    )?;
    let rows = stmt.query_map(params![project_id], |row| {
        Ok(ResearchFinding {
            id: row.get(0)?, project_id: row.get(1)?, title: row.get(2)?,
            description: row.get(3)?, confidence: row.get(4)?, category: row.get(5)?,
            source_experiment_ids: row.get(6)?, source_ids: row.get(7)?,
            hypothesis_ids: row.get(8)?, generated_by: row.get(9)?,
            status: row.get(10)?, created_at: row.get(11)?, updated_at: row.get(12)?,
        })
    })?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

pub fn create_finding(pool: &DbPool, input: &CreateResearchFinding) -> Result<ResearchFinding, AppError> {
    let id = Uuid::new_v4().to_string();
    let confidence = input.confidence.unwrap_or(0.5);
    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO research_findings (id, project_id, title, description, confidence, category, generated_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![id, input.project_id, input.title, input.description, confidence, input.category, input.generated_by],
    )?;
    let conn2 = pool.get()?;
    conn2.query_row(
        "SELECT id, project_id, title, description, confidence, category, source_experiment_ids, source_ids, hypothesis_ids, generated_by, status, created_at, updated_at FROM research_findings WHERE id = ?1",
        params![id],
        |row| Ok(ResearchFinding {
            id: row.get(0)?, project_id: row.get(1)?, title: row.get(2)?,
            description: row.get(3)?, confidence: row.get(4)?, category: row.get(5)?,
            source_experiment_ids: row.get(6)?, source_ids: row.get(7)?,
            hypothesis_ids: row.get(8)?, generated_by: row.get(9)?,
            status: row.get(10)?, created_at: row.get(11)?, updated_at: row.get(12)?,
        }),
    ).map_err(AppError::from)
}

pub fn delete_finding(pool: &DbPool, id: &str) -> Result<(), AppError> {
    let conn = pool.get()?;
    conn.execute("DELETE FROM research_findings WHERE id = ?1", params![id])?;
    Ok(())
}

// ============================================================================
// Research Reports
// ============================================================================

pub fn list_reports(pool: &DbPool, project_id: &str) -> Result<Vec<ResearchReport>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT id, project_id, title, report_type, status, template, format, review_id, created_at, updated_at
         FROM research_reports WHERE project_id = ?1 ORDER BY updated_at DESC"
    )?;
    let rows = stmt.query_map(params![project_id], |row| {
        Ok(ResearchReport {
            id: row.get(0)?, project_id: row.get(1)?, title: row.get(2)?,
            report_type: row.get(3)?, status: row.get(4)?, template: row.get(5)?,
            format: row.get(6)?, review_id: row.get(7)?,
            created_at: row.get(8)?, updated_at: row.get(9)?,
        })
    })?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

pub fn create_report(pool: &DbPool, input: &CreateResearchReport) -> Result<ResearchReport, AppError> {
    let id = Uuid::new_v4().to_string();
    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO research_reports (id, project_id, title, report_type, format, template) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![id, input.project_id, input.title, input.report_type, input.format, input.template],
    )?;
    let conn2 = pool.get()?;
    conn2.query_row(
        "SELECT id, project_id, title, report_type, status, template, format, review_id, created_at, updated_at FROM research_reports WHERE id = ?1",
        params![id],
        |row| Ok(ResearchReport {
            id: row.get(0)?, project_id: row.get(1)?, title: row.get(2)?,
            report_type: row.get(3)?, status: row.get(4)?, template: row.get(5)?,
            format: row.get(6)?, review_id: row.get(7)?,
            created_at: row.get(8)?, updated_at: row.get(9)?,
        }),
    ).map_err(AppError::from)
}

pub fn delete_report(pool: &DbPool, id: &str) -> Result<(), AppError> {
    let conn = pool.get()?;
    conn.execute("DELETE FROM research_reports WHERE id = ?1", params![id])?;
    Ok(())
}

// ============================================================================
// Dashboard Stats
// ============================================================================

pub fn get_dashboard_stats(pool: &DbPool) -> Result<ResearchDashboardStats, AppError> {
    let conn = pool.get()?;
    let total_projects: i32 = conn.query_row("SELECT COUNT(*) FROM research_projects", [], |r| r.get(0))?;
    let active_projects: i32 = conn.query_row("SELECT COUNT(*) FROM research_projects WHERE status NOT IN ('complete')", [], |r| r.get(0))?;
    let total_sources: i32 = conn.query_row("SELECT COUNT(*) FROM research_sources", [], |r| r.get(0))?;
    let total_hypotheses: i32 = conn.query_row("SELECT COUNT(*) FROM research_hypotheses", [], |r| r.get(0))?;
    let total_experiments: i32 = conn.query_row("SELECT COUNT(*) FROM research_experiments", [], |r| r.get(0))?;
    let total_findings: i32 = conn.query_row("SELECT COUNT(*) FROM research_findings", [], |r| r.get(0))?;
    let total_reports: i32 = conn.query_row("SELECT COUNT(*) FROM research_reports", [], |r| r.get(0))?;

    Ok(ResearchDashboardStats {
        total_projects,
        active_projects,
        total_sources,
        total_hypotheses,
        total_experiments,
        total_findings,
        total_reports,
    })
}

// ============================================================================
// Source ingestion status
// ============================================================================

pub fn update_source_status(
    pool: &DbPool,
    id: &str,
    status: &str,
    knowledge_base_id: Option<&str>,
) -> Result<(), AppError> {
    let conn = pool.get()?;
    if knowledge_base_id.is_some() {
        conn.execute(
            "UPDATE research_sources SET status = ?1, knowledge_base_id = ?2, ingested_at = datetime('now'), updated_at = datetime('now') WHERE id = ?3",
            params![status, knowledge_base_id, id],
        )?;
    } else {
        conn.execute(
            "UPDATE research_sources SET status = ?1, updated_at = datetime('now') WHERE id = ?2",
            params![status, id],
        )?;
    }
    Ok(())
}

// ============================================================================
// Experiment Runs
// ============================================================================

pub fn list_experiment_runs(pool: &DbPool, experiment_id: &str) -> Result<Vec<ResearchExperimentRun>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT id, experiment_id, run_number, inputs, outputs, metrics, passed, execution_id, duration_ms, cost_usd, created_at
         FROM research_experiment_runs WHERE experiment_id = ?1 ORDER BY run_number ASC"
    )?;
    let rows = stmt.query_map(params![experiment_id], |row| {
        Ok(ResearchExperimentRun {
            id: row.get(0)?,
            experiment_id: row.get(1)?,
            run_number: row.get(2)?,
            inputs: row.get(3)?,
            outputs: row.get(4)?,
            metrics: row.get(5)?,
            passed: row.get(6)?,
            execution_id: row.get(7)?,
            duration_ms: row.get(8)?,
            cost_usd: row.get(9)?,
            created_at: row.get(10)?,
        })
    })?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

pub fn create_experiment_run(
    pool: &DbPool,
    experiment_id: &str,
    outputs: Option<&str>,
    metrics: Option<&str>,
    passed: bool,
) -> Result<ResearchExperimentRun, AppError> {
    let id = Uuid::new_v4().to_string();
    let conn = pool.get()?;
    let run_number: i32 = conn.query_row(
        "SELECT COALESCE(MAX(run_number), 0) + 1 FROM research_experiment_runs WHERE experiment_id = ?1",
        params![experiment_id],
        |r| r.get(0),
    )?;
    let passed_int: i32 = if passed { 1 } else { 0 };
    conn.execute(
        "INSERT INTO research_experiment_runs (id, experiment_id, run_number, outputs, metrics, passed) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![id, experiment_id, run_number, outputs, metrics, passed_int],
    )?;
    conn.query_row(
        "SELECT id, experiment_id, run_number, inputs, outputs, metrics, passed, execution_id, duration_ms, cost_usd, created_at FROM research_experiment_runs WHERE id = ?1",
        params![id],
        |row| Ok(ResearchExperimentRun {
            id: row.get(0)?, experiment_id: row.get(1)?, run_number: row.get(2)?,
            inputs: row.get(3)?, outputs: row.get(4)?, metrics: row.get(5)?,
            passed: row.get(6)?, execution_id: row.get(7)?, duration_ms: row.get(8)?,
            cost_usd: row.get(9)?, created_at: row.get(10)?,
        }),
    ).map_err(AppError::from)
}
