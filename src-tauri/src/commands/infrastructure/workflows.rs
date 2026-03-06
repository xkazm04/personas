use serde::Serialize;

use crate::error::AppError;

use crate::commands::design::n8n_transform::job_state::list_n8n_transform_jobs;
use crate::commands::design::template_adopt::{list_adopt_jobs, list_generate_jobs};
use crate::commands::credentials::query_debug::list_query_debug_jobs;

// ── Types ──────────────────────────────────────────────────────────────

#[derive(Clone, Serialize)]
pub struct WorkflowJob {
    pub job_id: String,
    pub job_type: String,
    pub status: String,
    pub error: Option<String>,
    pub output_tail: Vec<String>,
    pub line_count: usize,
    pub elapsed_secs: u64,
}

#[derive(Clone, Serialize)]
pub struct WorkflowsOverview {
    pub jobs: Vec<WorkflowJob>,
    pub running_count: usize,
    pub completed_count: usize,
    pub failed_count: usize,
    pub total_count: usize,
}

// ── Commands ───────────────────────────────────────────────────────────

/// List all background jobs across every manager, aggregated into a
/// unified workflows overview.
#[tauri::command]
pub fn get_workflows_overview() -> Result<WorkflowsOverview, AppError> {
    let mut jobs: Vec<WorkflowJob> = Vec::new();

    // Collect from all four managers
    for snap in list_n8n_transform_jobs() {
        jobs.push(WorkflowJob {
            job_id: snap.job_id,
            job_type: "n8n_transform".into(),
            status: snap.status,
            error: snap.error,
            line_count: snap.lines.len(),
            output_tail: snap.lines.into_iter().rev().take(20).collect::<Vec<_>>().into_iter().rev().collect(),
            elapsed_secs: snap.elapsed_secs,
        });
    }

    for snap in list_adopt_jobs() {
        jobs.push(WorkflowJob {
            job_id: snap.job_id,
            job_type: "template_adopt".into(),
            status: snap.status,
            error: snap.error,
            line_count: snap.lines.len(),
            output_tail: snap.lines.into_iter().rev().take(20).collect::<Vec<_>>().into_iter().rev().collect(),
            elapsed_secs: snap.elapsed_secs,
        });
    }

    for snap in list_generate_jobs() {
        jobs.push(WorkflowJob {
            job_id: snap.job_id,
            job_type: "template_generate".into(),
            status: snap.status,
            error: snap.error,
            line_count: snap.lines.len(),
            output_tail: snap.lines.into_iter().rev().take(20).collect::<Vec<_>>().into_iter().rev().collect(),
            elapsed_secs: snap.elapsed_secs,
        });
    }

    for snap in list_query_debug_jobs() {
        jobs.push(WorkflowJob {
            job_id: snap.job_id,
            job_type: "query_debug".into(),
            status: snap.status,
            error: snap.error,
            line_count: snap.lines.len(),
            output_tail: snap.lines.into_iter().rev().take(20).collect::<Vec<_>>().into_iter().rev().collect(),
            elapsed_secs: snap.elapsed_secs,
        });
    }

    // Sort: running first, then by elapsed (most recent first)
    jobs.sort_by(|a, b| {
        let a_running = a.status == "running";
        let b_running = b.status == "running";
        b_running.cmp(&a_running).then(a.elapsed_secs.cmp(&b.elapsed_secs))
    });

    let running_count = jobs.iter().filter(|j| j.status == "running").count();
    let completed_count = jobs.iter().filter(|j| j.status == "completed").count();
    let failed_count = jobs.iter().filter(|j| j.status == "failed").count();
    let total_count = jobs.len();

    Ok(WorkflowsOverview {
        jobs,
        running_count,
        completed_count,
        failed_count,
        total_count,
    })
}

/// Get full output lines for a specific job by type and ID.
#[tauri::command]
pub fn get_workflow_job_output(job_type: String, job_id: String) -> Result<Vec<String>, AppError> {
    let snapshots = match job_type.as_str() {
        "n8n_transform" => list_n8n_transform_jobs(),
        "template_adopt" => list_adopt_jobs(),
        "template_generate" => list_generate_jobs(),
        "query_debug" => list_query_debug_jobs(),
        _ => return Err(AppError::Validation(format!("Unknown job type: {}", job_type))),
    };

    snapshots
        .into_iter()
        .find(|s| s.job_id == job_id)
        .map(|s| s.lines)
        .ok_or_else(|| AppError::NotFound(format!("Job {} not found", job_id)))
}

/// Cancel a running job by type and ID.
#[tauri::command]
pub fn cancel_workflow_job(
    app: tauri::AppHandle,
    job_type: String,
    job_id: String,
) -> Result<(), AppError> {
    match job_type.as_str() {
        "n8n_transform" => {
            use crate::commands::design::n8n_transform::job_state::manager;
            manager().cancel(&app, &job_id)
        }
        "template_adopt" => {
            use crate::commands::design::template_adopt::cancel_adopt_job;
            cancel_adopt_job(&app, &job_id)
        }
        "template_generate" => {
            use crate::commands::design::template_adopt::cancel_generate_job;
            cancel_generate_job(&app, &job_id)
        }
        "query_debug" => {
            use crate::commands::credentials::query_debug::cancel_query_debug_job;
            cancel_query_debug_job(&app, &job_id)
        }
        _ => Err(AppError::Validation(format!("Unknown job type: {}", job_type))),
    }
}
