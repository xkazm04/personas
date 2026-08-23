use rusqlite::params;

use crate::models::GitLabDeploymentRecord;
use crate::DbPool;
use personas_core::error::AppError;

/// One projection for every read in this module, so the SELECT and the mapper
/// cannot drift apart. Column order here is cosmetic — `row_to_record` binds by
/// NAME — but it is kept in `CREATE TABLE` order (`migrations/initial.rs:107`)
/// so the two read alike.
const COLUMNS: &str = "id, persona_id, persona_name, project_id, method,                        credentials_provisioned, deploy_result, agent_id, web_url,                        snapshot_prompt, rolled_back_from, target, created_at";

row_mapper!(row_to_record -> GitLabDeploymentRecord {
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
    target,
    created_at,
});

/// Insert a deployment history record.
#[allow(clippy::too_many_arguments)]
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
    target: &str,
) -> Result<String, AppError> {
    timed_query!("deployment_history", "deployment_history::insert", {
        let conn = pool.get()?;
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();

        conn.execute(
            "INSERT INTO deployment_history
                (id, persona_id, persona_name, project_id, method, credentials_provisioned,
                 deploy_result, agent_id, web_url, snapshot_prompt, rolled_back_from, target, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
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
                target,
                now,
            ],
        )?;
        Ok(id)
    })
}

/// List deployment history for a (persona_id, project_id) pair, newest first.
pub fn list_by_persona_project(
    pool: &DbPool,
    persona_id: &str,
    project_id: i64,
    limit: u32,
) -> Result<Vec<GitLabDeploymentRecord>, AppError> {
    timed_query!(
        "deployment_history",
        "deployment_history::list_by_persona_project",
        {
            let conn = pool.get()?;
            let mut stmt = conn.prepare(&format!(
                "SELECT {COLUMNS} FROM deployment_history
             WHERE persona_id = ?1 AND project_id = ?2
             ORDER BY created_at DESC
             LIMIT ?3",
            ))?;
            let rows = stmt
                .query_map(params![persona_id, project_id, limit], row_to_record)?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(rows)
        }
    )
}

/// List all deployment history for a project, newest first.
pub fn list_by_project(
    pool: &DbPool,
    project_id: i64,
    limit: u32,
) -> Result<Vec<GitLabDeploymentRecord>, AppError> {
    timed_query!(
        "deployment_history",
        "deployment_history::list_by_project",
        {
            let conn = pool.get()?;
            let mut stmt = conn.prepare(&format!(
                "SELECT {COLUMNS} FROM deployment_history
             WHERE project_id = ?1
             ORDER BY created_at DESC
             LIMIT ?2",
            ))?;
            let rows = stmt
                .query_map(params![project_id, limit], row_to_record)?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(rows)
        }
    )
}

/// Get the most recent successful deployment for a persona+project (for rollback).
pub fn get_previous_deployment(
    pool: &DbPool,
    persona_id: &str,
    project_id: i64,
    exclude_id: &str,
) -> Result<Option<GitLabDeploymentRecord>, AppError> {
    timed_query!(
        "deployment_history",
        "deployment_history::get_previous_deployment",
        {
            let conn = pool.get()?;
            let mut stmt = conn.prepare(&format!(
                "SELECT {COLUMNS} FROM deployment_history
             WHERE persona_id = ?1 AND project_id = ?2 AND id != ?3
                   AND deploy_result = 'success'
             ORDER BY created_at DESC
             LIMIT 1",
            ))?;
            let mut rows =
                stmt.query_map(params![persona_id, project_id, exclude_id], row_to_record)?;
            match rows.next() {
                Some(Ok(record)) => Ok(Some(record)),
                Some(Err(e)) => Err(AppError::Database(e)),
                None => Ok(None),
            }
        }
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::init_test_db;

    #[test]
    fn cloud_deploy_lands_history_row_with_snapshot_and_target() {
        let pool = init_test_db().unwrap();

        // A cloud deploy: no GitLab project (0 sentinel), method + target "cloud",
        // and the assembled prompt captured as the snapshot.
        let cloud_id = insert(
            &pool,
            "persona-1",
            "Cloud Persona",
            0,
            "cloud",
            0,
            "success",
            Some("cloud-deploy-123"),
            None,
            Some("ASSEMBLED PROMPT SNAPSHOT"),
            None,
            "cloud",
        )
        .unwrap();

        // A GitLab deploy alongside it — target defaults to "gitlab".
        let _gitlab_id = insert(
            &pool,
            "persona-2",
            "GitLab Persona",
            42,
            "api",
            0,
            "success",
            Some("agent-9"),
            None,
            Some("gitlab prompt"),
            None,
            "gitlab",
        )
        .unwrap();

        // The unified audit trail shows BOTH targets.
        let all = list_all(&pool, 50).unwrap();
        assert_eq!(all.len(), 2, "both cloud and gitlab rows present");

        let cloud = all.iter().find(|r| r.id == cloud_id).expect("cloud row");
        assert_eq!(cloud.target, "cloud");
        assert_eq!(cloud.method, "cloud");
        assert_eq!(cloud.project_id, 0);
        assert_eq!(
            cloud.snapshot_prompt.as_deref(),
            Some("ASSEMBLED PROMPT SNAPSHOT"),
            "prompt snapshot is persisted for cloud deploys"
        );

        // Targets do not bleed across the unified query.
        let gitlab = all
            .iter()
            .find(|r| r.persona_id == "persona-2")
            .expect("gitlab row");
        assert_eq!(gitlab.target, "gitlab");
    }
}

/// List deployment history across ALL projects and targets (GitLab + cloud),
/// newest first. Backs the unified deployment audit trail.
pub fn list_all(pool: &DbPool, limit: u32) -> Result<Vec<GitLabDeploymentRecord>, AppError> {
    timed_query!("deployment_history", "deployment_history::list_all", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(&format!(
            "SELECT {COLUMNS} FROM deployment_history
             ORDER BY created_at DESC
             LIMIT ?1",
        ))?;
        let rows = stmt
            .query_map(params![limit], row_to_record)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    })
}
