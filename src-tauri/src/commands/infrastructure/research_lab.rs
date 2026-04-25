use std::path::Path;
use std::sync::Arc;

use tauri::State;

use crate::db::models::{
    CreateResearchExperiment, CreateResearchFinding, CreateResearchHypothesis,
    CreateResearchProject, CreateResearchReport, CreateResearchSource,
    ResearchDashboardStats, ResearchExperiment, ResearchExperimentRun, ResearchFinding,
    ResearchHypothesis, ResearchProject, ResearchReport, ResearchSource, UpdateResearchProject,
};
use crate::db::repos::research_lab as repo;
use crate::error::AppError;
use crate::AppState;

// ============================================================================
// Projects
// ============================================================================

#[tauri::command]
pub fn research_lab_list_projects(state: State<'_, Arc<AppState>>) -> Result<Vec<ResearchProject>, AppError> {
    repo::list_projects(&state.db)
}

#[tauri::command]
pub fn research_lab_get_project(state: State<'_, Arc<AppState>>, id: String) -> Result<ResearchProject, AppError> {
    repo::get_project(&state.db, &id)
}

#[tauri::command]
pub fn research_lab_create_project(state: State<'_, Arc<AppState>>, input: CreateResearchProject) -> Result<ResearchProject, AppError> {
    repo::create_project(&state.db, &input)
}

#[tauri::command]
pub fn research_lab_update_project(state: State<'_, Arc<AppState>>, id: String, input: UpdateResearchProject) -> Result<ResearchProject, AppError> {
    repo::update_project(&state.db, &id, &input)
}

#[tauri::command]
pub fn research_lab_delete_project(state: State<'_, Arc<AppState>>, id: String) -> Result<(), AppError> {
    repo::delete_project(&state.db, &id)
}

// ============================================================================
// Sources
// ============================================================================

#[tauri::command]
pub fn research_lab_list_sources(state: State<'_, Arc<AppState>>, project_id: String) -> Result<Vec<ResearchSource>, AppError> {
    repo::list_sources(&state.db, &project_id)
}

#[tauri::command]
pub fn research_lab_create_source(state: State<'_, Arc<AppState>>, input: CreateResearchSource) -> Result<ResearchSource, AppError> {
    repo::create_source(&state.db, &input)
}

#[tauri::command]
pub fn research_lab_delete_source(state: State<'_, Arc<AppState>>, id: String) -> Result<(), AppError> {
    repo::delete_source(&state.db, &id)
}

// ============================================================================
// Hypotheses
// ============================================================================

#[tauri::command]
pub fn research_lab_list_hypotheses(state: State<'_, Arc<AppState>>, project_id: String) -> Result<Vec<ResearchHypothesis>, AppError> {
    repo::list_hypotheses(&state.db, &project_id)
}

#[tauri::command]
pub fn research_lab_create_hypothesis(state: State<'_, Arc<AppState>>, input: CreateResearchHypothesis) -> Result<ResearchHypothesis, AppError> {
    repo::create_hypothesis(&state.db, &input)
}

#[tauri::command]
pub fn research_lab_update_hypothesis(
    state: State<'_, Arc<AppState>>,
    id: String,
    status: Option<String>,
    confidence: Option<f64>,
    supporting_evidence: Option<String>,
    counter_evidence: Option<String>,
) -> Result<(), AppError> {
    repo::update_hypothesis(
        &state.db,
        &id,
        status.as_deref(),
        confidence,
        supporting_evidence.as_deref(),
        counter_evidence.as_deref(),
    )
}

#[tauri::command]
pub fn research_lab_delete_hypothesis(state: State<'_, Arc<AppState>>, id: String) -> Result<(), AppError> {
    repo::delete_hypothesis(&state.db, &id)
}

// ============================================================================
// Experiments
// ============================================================================

#[tauri::command]
pub fn research_lab_list_experiments(state: State<'_, Arc<AppState>>, project_id: String) -> Result<Vec<ResearchExperiment>, AppError> {
    repo::list_experiments(&state.db, &project_id)
}

#[tauri::command]
pub fn research_lab_create_experiment(state: State<'_, Arc<AppState>>, input: CreateResearchExperiment) -> Result<ResearchExperiment, AppError> {
    repo::create_experiment(&state.db, &input)
}

#[tauri::command]
pub fn research_lab_delete_experiment(state: State<'_, Arc<AppState>>, id: String) -> Result<(), AppError> {
    repo::delete_experiment(&state.db, &id)
}

// ============================================================================
// Findings
// ============================================================================

#[tauri::command]
pub fn research_lab_list_findings(state: State<'_, Arc<AppState>>, project_id: String) -> Result<Vec<ResearchFinding>, AppError> {
    repo::list_findings(&state.db, &project_id)
}

#[tauri::command]
pub fn research_lab_create_finding(state: State<'_, Arc<AppState>>, input: CreateResearchFinding) -> Result<ResearchFinding, AppError> {
    repo::create_finding(&state.db, &input)
}

#[tauri::command]
pub fn research_lab_delete_finding(state: State<'_, Arc<AppState>>, id: String) -> Result<(), AppError> {
    repo::delete_finding(&state.db, &id)
}

// ============================================================================
// Reports
// ============================================================================

#[tauri::command]
pub fn research_lab_list_reports(state: State<'_, Arc<AppState>>, project_id: String) -> Result<Vec<ResearchReport>, AppError> {
    repo::list_reports(&state.db, &project_id)
}

#[tauri::command]
pub fn research_lab_create_report(state: State<'_, Arc<AppState>>, input: CreateResearchReport) -> Result<ResearchReport, AppError> {
    repo::create_report(&state.db, &input)
}

#[tauri::command]
pub fn research_lab_delete_report(state: State<'_, Arc<AppState>>, id: String) -> Result<(), AppError> {
    repo::delete_report(&state.db, &id)
}

// ============================================================================
// Dashboard
// ============================================================================

#[tauri::command]
pub fn research_lab_get_dashboard_stats(state: State<'_, Arc<AppState>>) -> Result<ResearchDashboardStats, AppError> {
    repo::get_dashboard_stats(&state.db)
}

// ============================================================================
// Source ingestion status
// ============================================================================

#[tauri::command]
pub fn research_lab_update_source_status(
    state: State<'_, Arc<AppState>>,
    id: String,
    status: String,
    knowledge_base_id: Option<String>,
) -> Result<(), AppError> {
    repo::update_source_status(&state.db, &id, &status, knowledge_base_id.as_deref())
}

// ============================================================================
// Obsidian sync — write experiments as structured markdown notes
// ============================================================================

#[tauri::command]
pub fn research_lab_sync_to_obsidian(
    state: State<'_, Arc<AppState>>,
    project_id: String,
) -> Result<u32, AppError> {
    let project = repo::get_project(&state.db, &project_id)?;
    let vault_path = project
        .obsidian_vault_path
        .as_deref()
        .filter(|p| !p.is_empty())
        .ok_or_else(|| AppError::Validation("No Obsidian vault linked to this project".into()))?;

    let experiments = repo::list_experiments(&state.db, &project_id)?;
    let hypotheses = repo::list_hypotheses(&state.db, &project_id)?;

    let research_dir = Path::new(vault_path).join("Research").join(&project.name);
    std::fs::create_dir_all(&research_dir)
        .map_err(|e| AppError::Internal(format!("Failed to create research dir: {e}")))?;

    let mut written = 0u32;
    for exp in &experiments {
        let filename = format!("{}.md", slug(&exp.name));
        let filepath = research_dir.join(&filename);

        let hypothesis_stmt = exp
            .hypothesis_id
            .as_ref()
            .and_then(|hid| hypotheses.iter().find(|h| &h.id == hid))
            .map(|h| h.statement.as_str())
            .unwrap_or("—");

        let runs = repo::list_experiment_runs(&state.db, &exp.id)?;

        let mut md = format!(
            "---\ntype: experiment\nstatus: {status}\nproject: {proj}\nhypothesis: \"{hyp}\"\ncreated: {created}\n---\n\n# {name}\n\n",
            status = exp.status,
            proj = project.name,
            hyp = hypothesis_stmt.replace('"', "'"),
            created = &exp.created_at[..10],
            name = exp.name,
        );

        if let Some(m) = &exp.methodology {
            md.push_str(&format!("## Protocol\n\n{m}\n\n"));
        }
        if let Some(sc) = &exp.success_criteria {
            md.push_str(&format!("## Success Criteria\n\n{sc}\n\n"));
        }

        md.push_str("## Observations\n\n");
        if runs.is_empty() {
            md.push_str("_No observations yet._\n");
        } else {
            for run in &runs {
                md.push_str(&format!(
                    "### Run {n} — {date}\n- **Passed:** {passed}\n",
                    n = run.run_number,
                    date = &run.created_at[..10],
                    passed = if run.passed != 0 { "yes" } else { "no" },
                ));
                if let Some(o) = &run.outputs {
                    md.push_str(&format!("- **Notes:** {o}\n"));
                }
                if let Some(m) = &run.metrics {
                    md.push_str(&format!("- **Metrics:** {m}\n"));
                }
                md.push('\n');
            }
        }

        std::fs::write(&filepath, &md)
            .map_err(|e| AppError::Internal(format!("Failed to write {}: {e}", filepath.display())))?;
        written += 1;
    }

    Ok(written)
}

// ============================================================================
// Daily note sync — append active experiment check-ins to today's daily note
// ============================================================================

#[tauri::command]
pub fn research_lab_sync_daily_note(
    state: State<'_, Arc<AppState>>,
    project_id: String,
) -> Result<String, AppError> {
    let project = repo::get_project(&state.db, &project_id)?;
    let vault_path = project
        .obsidian_vault_path
        .as_deref()
        .filter(|p| !p.is_empty())
        .ok_or_else(|| AppError::Validation("No Obsidian vault linked to this project".into()))?;

    let experiments = repo::list_experiments(&state.db, &project_id)?;
    let active: Vec<_> = experiments
        .iter()
        .filter(|e| e.status != "completed" && e.status != "cancelled")
        .collect();

    if active.is_empty() {
        return Ok("No active experiments".into());
    }

    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let daily_dir = Path::new(vault_path).join("Daily");
    std::fs::create_dir_all(&daily_dir)
        .map_err(|e| AppError::Internal(format!("Failed to create daily dir: {e}")))?;

    let daily_path = daily_dir.join(format!("{today}.md"));
    let existing = std::fs::read_to_string(&daily_path).unwrap_or_default();

    let marker = format!("## Research Check-in: {}", project.name);
    if existing.contains(&marker) {
        return Ok("Daily note already has today's check-in".into());
    }

    let mut section = format!("\n{marker}\n\n");
    for exp in &active {
        section.push_str(&format!(
            "- [ ] **{}** ({})\n",
            exp.name, exp.status
        ));
        if let Some(sc) = &exp.success_criteria {
            section.push_str(&format!("  - Criteria: {sc}\n"));
        }
        section.push_str("  - Observations: \n");
    }

    let content = if existing.is_empty() {
        format!("---\ndate: {today}\n---\n{section}")
    } else {
        format!("{existing}\n{section}")
    };

    std::fs::write(&daily_path, &content)
        .map_err(|e| AppError::Internal(format!("Failed to write daily note: {e}")))?;

    Ok(format!("Wrote {} experiments to {today}.md", active.len()))
}

// ============================================================================
// Experiment runs
// ============================================================================

#[tauri::command]
pub fn research_lab_list_experiment_runs(
    state: State<'_, Arc<AppState>>,
    experiment_id: String,
) -> Result<Vec<ResearchExperimentRun>, AppError> {
    repo::list_experiment_runs(&state.db, &experiment_id)
}

#[tauri::command]
pub fn research_lab_create_experiment_run(
    state: State<'_, Arc<AppState>>,
    experiment_id: String,
    outputs: Option<String>,
    metrics: Option<String>,
    passed: bool,
) -> Result<ResearchExperimentRun, AppError> {
    repo::create_experiment_run(&state.db, &experiment_id, outputs.as_deref(), metrics.as_deref(), passed)
}

// ============================================================================
// Helpers
// ============================================================================

fn slug(name: &str) -> String {
    name.chars()
        .map(|c| if c.is_alphanumeric() || c == '-' { c.to_ascii_lowercase() } else { '-' })
        .collect::<String>()
        .trim_matches('-')
        .to_string()
}
