use rusqlite::params;

use crate::db::DbPool;
use crate::error::AppError;
use crate::gitlab::types::GitLabDeploymentRecord;

/// Insert a deployment history record.
pub fn insert(
    pool: &DbPool,
    persona_id: &str,
    persona_name: &str,
    project_id: i64,
    method: &str,
    credentials_provisioned: u32,
    deploy_result: &str,
    agent_id: Option<&str>,
    web_url: Option<&str>,
    snapshot_prompt: Option<&str>,
    rolled_back_from: Option<&str>,
) -> Result<String, AppError> {
    let conn = pool.get()?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    conn.execute(
        "INSERT INTO deployment_history
            (id, persona_id, persona_name, project_id, method, credentials_provisioned,
             deploy_result, agent_id, web_url, snapshot_prompt, rolled_back_from, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        params![
            id,
            persona_id,
            persona_name,
            project_id,
            method,
            credentials_provisioned,
            deploy_result,
            agent_id,
            web_url,
            snapshot_prompt,
            rolled_back_from,
            now,
        ],
    )?;
    Ok(id)
}

/// List deployment history for a (persona_id, project_id) pair, newest first.
pub fn list_by_persona_project(
    pool: &DbPool,
    persona_id: &str,
    project_id: i64,
    limit: u32,
) -> Result<Vec<GitLabDeploymentRecord>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT id, persona_id, persona_name, project_id, method,
                credentials_provisioned, deploy_result, agent_id, web_url,
                snapshot_prompt, rolled_back_from, created_at
         FROM deployment_history
         WHERE persona_id = ?1 AND project_id = ?2
         ORDER BY created_at DESC
         LIMIT ?3",
    )?;
    let rows = stmt
        .query_map(params![persona_id, project_id, limit], |row| {
            Ok(GitLabDeploymentRecord {
                id: row.get(0)?,
                persona_id: row.get(1)?,
                persona_name: row.get(2)?,
                project_id: row.get(3)?,
                method: row.get(4)?,
                credentials_provisioned: row.get(5)?,
                deploy_result: row.get(6)?,
                agent_id: row.get(7)?,
                web_url: row.get(8)?,
                snapshot_prompt: row.get(9)?,
                rolled_back_from: row.get(10)?,
                created_at: row.get(11)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// List all deployment history for a project, newest first.
pub fn list_by_project(
    pool: &DbPool,
    project_id: i64,
    limit: u32,
) -> Result<Vec<GitLabDeploymentRecord>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT id, persona_id, persona_name, project_id, method,
                credentials_provisioned, deploy_result, agent_id, web_url,
                snapshot_prompt, rolled_back_from, created_at
         FROM deployment_history
         WHERE project_id = ?1
         ORDER BY created_at DESC
         LIMIT ?2",
    )?;
    let rows = stmt
        .query_map(params![project_id, limit], |row| {
            Ok(GitLabDeploymentRecord {
                id: row.get(0)?,
                persona_id: row.get(1)?,
                persona_name: row.get(2)?,
                project_id: row.get(3)?,
                method: row.get(4)?,
                credentials_provisioned: row.get(5)?,
                deploy_result: row.get(6)?,
                agent_id: row.get(7)?,
                web_url: row.get(8)?,
                snapshot_prompt: row.get(9)?,
                rolled_back_from: row.get(10)?,
                created_at: row.get(11)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Get the most recent successful deployment for a persona+project (for rollback).
pub fn get_previous_deployment(
    pool: &DbPool,
    persona_id: &str,
    project_id: i64,
    exclude_id: &str,
) -> Result<Option<GitLabDeploymentRecord>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT id, persona_id, persona_name, project_id, method,
                credentials_provisioned, deploy_result, agent_id, web_url,
                snapshot_prompt, rolled_back_from, created_at
         FROM deployment_history
         WHERE persona_id = ?1 AND project_id = ?2 AND id != ?3
               AND deploy_result = 'success'
         ORDER BY created_at DESC
         LIMIT 1",
    )?;
    let mut rows = stmt.query_map(params![persona_id, project_id, exclude_id], |row| {
        Ok(GitLabDeploymentRecord {
            id: row.get(0)?,
            persona_id: row.get(1)?,
            persona_name: row.get(2)?,
            project_id: row.get(3)?,
            method: row.get(4)?,
            credentials_provisioned: row.get(5)?,
            deploy_result: row.get(6)?,
            agent_id: row.get(7)?,
            web_url: row.get(8)?,
            snapshot_prompt: row.get(9)?,
            rolled_back_from: row.get(10)?,
            created_at: row.get(11)?,
        })
    })?;
    match rows.next() {
        Some(Ok(record)) => Ok(Some(record)),
        Some(Err(e)) => Err(AppError::Database(e)),
        None => Ok(None),
    }
}
