use rusqlite::{params, Row};

use crate::db::models::{
    CreateTeamInput, PersonaTeam, PersonaTeamConnection, PersonaTeamMember, PipelineRun,
    UpdateTeamInput,
};
use crate::db::DbPool;
use crate::error::AppError;

// ============================================================================
// Row mappers
// ============================================================================

fn row_to_team(row: &Row) -> rusqlite::Result<PersonaTeam> {
    Ok(PersonaTeam {
        id: row.get("id")?,
        project_id: row.get("project_id")?,
        name: row.get("name")?,
        description: row.get("description")?,
        canvas_data: row.get("canvas_data")?,
        team_config: row.get("team_config")?,
        icon: row.get("icon")?,
        color: row.get("color")?,
        enabled: row.get::<_, i32>("enabled")? != 0,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

fn row_to_member(row: &Row) -> rusqlite::Result<PersonaTeamMember> {
    Ok(PersonaTeamMember {
        id: row.get("id")?,
        team_id: row.get("team_id")?,
        persona_id: row.get("persona_id")?,
        role: row.get("role")?,
        position_x: row.get("position_x")?,
        position_y: row.get("position_y")?,
        config: row.get("config")?,
        created_at: row.get("created_at")?,
    })
}

fn row_to_connection(row: &Row) -> rusqlite::Result<PersonaTeamConnection> {
    Ok(PersonaTeamConnection {
        id: row.get("id")?,
        team_id: row.get("team_id")?,
        source_member_id: row.get("source_member_id")?,
        target_member_id: row.get("target_member_id")?,
        connection_type: row.get("connection_type")?,
        condition: row.get("condition")?,
        label: row.get("label")?,
        created_at: row.get("created_at")?,
    })
}

// ============================================================================
// Team CRUD
// ============================================================================

pub fn get_all(pool: &DbPool) -> Result<Vec<PersonaTeam>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare("SELECT * FROM persona_teams ORDER BY updated_at DESC")?;
    let rows = stmt.query_map([], row_to_team)?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

pub fn get_by_id(pool: &DbPool, id: &str) -> Result<PersonaTeam, AppError> {
    let conn = pool.get()?;
    conn.query_row(
        "SELECT * FROM persona_teams WHERE id = ?1",
        params![id],
        row_to_team,
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => AppError::NotFound(format!("Team {id}")),
        other => AppError::Database(other),
    })
}

pub fn create(pool: &DbPool, input: CreateTeamInput) -> Result<PersonaTeam, AppError> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let color = input.color.unwrap_or_else(|| "#6B7280".into());
    let enabled = input.enabled.unwrap_or(true) as i32;

    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO persona_teams
         (id, project_id, name, description, canvas_data, team_config, icon, color, enabled, created_at, updated_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?10)",
        params![
            id,
            input.project_id,
            input.name,
            input.description,
            input.canvas_data,
            input.team_config,
            input.icon,
            color,
            enabled,
            now,
        ],
    )?;

    get_by_id(pool, &id)
}

pub fn update(pool: &DbPool, id: &str, input: UpdateTeamInput) -> Result<PersonaTeam, AppError> {
    // Verify exists
    get_by_id(pool, id)?;

    let now = chrono::Utc::now().to_rfc3339();
    let conn = pool.get()?;

    // Build dynamic SET clause
    let mut sets: Vec<String> = vec!["updated_at = ?1".into()];
    let mut param_idx = 2u32;

    push_field!(input.name, "name", sets, param_idx);
    push_field!(input.description, "description", sets, param_idx);
    push_field!(input.canvas_data, "canvas_data", sets, param_idx);
    push_field!(input.team_config, "team_config", sets, param_idx);
    push_field!(input.icon, "icon", sets, param_idx);
    push_field!(input.color, "color", sets, param_idx);
    push_field!(input.enabled, "enabled", sets, param_idx);

    let sql = format!(
        "UPDATE persona_teams SET {} WHERE id = ?{}",
        sets.join(", "),
        param_idx
    );

    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(now)];

    if let Some(ref v) = input.name {
        param_values.push(Box::new(v.clone()));
    }
    if let Some(ref v) = input.description {
        param_values.push(Box::new(v.clone()));
    }
    if let Some(ref v) = input.canvas_data {
        param_values.push(Box::new(v.clone()));
    }
    if let Some(ref v) = input.team_config {
        param_values.push(Box::new(v.clone()));
    }
    if let Some(ref v) = input.icon {
        param_values.push(Box::new(v.clone()));
    }
    if let Some(ref v) = input.color {
        param_values.push(Box::new(v.clone()));
    }
    if let Some(v) = input.enabled {
        param_values.push(Box::new(v as i32));
    }
    param_values.push(Box::new(id.to_string()));

    let params_ref: Vec<&dyn rusqlite::types::ToSql> =
        param_values.iter().map(|p| p.as_ref()).collect();
    conn.execute(&sql, params_ref.as_slice())?;

    get_by_id(pool, id)
}

pub fn delete(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    let conn = pool.get()?;
    let rows = conn.execute("DELETE FROM persona_teams WHERE id = ?1", params![id])?;
    Ok(rows > 0)
}

// ============================================================================
// Members
// ============================================================================

pub fn get_members(pool: &DbPool, team_id: &str) -> Result<Vec<PersonaTeamMember>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT * FROM persona_team_members WHERE team_id = ?1 ORDER BY created_at ASC",
    )?;
    let rows = stmt.query_map(params![team_id], row_to_member)?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

pub fn add_member(
    pool: &DbPool,
    team_id: &str,
    persona_id: &str,
    role: Option<String>,
    position_x: Option<f64>,
    position_y: Option<f64>,
    config: Option<String>,
) -> Result<PersonaTeamMember, AppError> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let role = role.unwrap_or_else(|| "worker".into());
    let px = position_x.unwrap_or(0.0);
    let py = position_y.unwrap_or(0.0);

    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO persona_team_members (id, team_id, persona_id, role, position_x, position_y, config, created_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
        params![id, team_id, persona_id, role, px, py, config, now],
    )?;

    Ok(PersonaTeamMember {
        id,
        team_id: team_id.to_string(),
        persona_id: persona_id.to_string(),
        role,
        position_x: px,
        position_y: py,
        config,
        created_at: now,
    })
}

pub fn update_member(
    pool: &DbPool,
    id: &str,
    role: Option<String>,
    position_x: Option<f64>,
    position_y: Option<f64>,
    config: Option<String>,
) -> Result<(), AppError> {
    let conn = pool.get()?;

    let mut sets: Vec<String> = Vec::new();
    let mut param_idx = 1u32;

    push_field!(role, "role", sets, param_idx);
    push_field!(position_x, "position_x", sets, param_idx);
    push_field!(position_y, "position_y", sets, param_idx);
    push_field!(config, "config", sets, param_idx);

    if sets.is_empty() {
        return Ok(());
    }

    let sql = format!(
        "UPDATE persona_team_members SET {} WHERE id = ?{}",
        sets.join(", "),
        param_idx
    );

    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
    if let Some(ref v) = role {
        param_values.push(Box::new(v.clone()));
    }
    if let Some(v) = position_x {
        param_values.push(Box::new(v));
    }
    if let Some(v) = position_y {
        param_values.push(Box::new(v));
    }
    if let Some(ref v) = config {
        param_values.push(Box::new(v.clone()));
    }
    param_values.push(Box::new(id.to_string()));

    let params_ref: Vec<&dyn rusqlite::types::ToSql> =
        param_values.iter().map(|p| p.as_ref()).collect();
    conn.execute(&sql, params_ref.as_slice())?;

    Ok(())
}

pub fn remove_member(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    let conn = pool.get()?;
    // Clean up connections that reference this member
    conn.execute(
        "DELETE FROM persona_team_connections WHERE source_member_id = ?1 OR target_member_id = ?1",
        params![id],
    )?;
    let rows = conn.execute(
        "DELETE FROM persona_team_members WHERE id = ?1",
        params![id],
    )?;
    Ok(rows > 0)
}

// ============================================================================
// Connections
// ============================================================================

pub fn get_connections(
    pool: &DbPool,
    team_id: &str,
) -> Result<Vec<PersonaTeamConnection>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT * FROM persona_team_connections WHERE team_id = ?1 ORDER BY created_at ASC",
    )?;
    let rows = stmt.query_map(params![team_id], row_to_connection)?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

pub fn create_connection(
    pool: &DbPool,
    team_id: &str,
    source_member_id: &str,
    target_member_id: &str,
    connection_type: Option<String>,
    condition: Option<String>,
    label: Option<String>,
) -> Result<PersonaTeamConnection, AppError> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let conn_type = connection_type.unwrap_or_else(|| "sequential".into());

    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO persona_team_connections
         (id, team_id, source_member_id, target_member_id, connection_type, condition, label, created_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
        params![id, team_id, source_member_id, target_member_id, conn_type, condition, label, now],
    )?;

    Ok(PersonaTeamConnection {
        id,
        team_id: team_id.to_string(),
        source_member_id: source_member_id.to_string(),
        target_member_id: target_member_id.to_string(),
        connection_type: conn_type,
        condition,
        label,
        created_at: now,
    })
}

pub fn delete_connection(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    let conn = pool.get()?;
    let rows = conn.execute(
        "DELETE FROM persona_team_connections WHERE id = ?1",
        params![id],
    )?;
    Ok(rows > 0)
}

// ============================================================================
// Pipeline Runs
// ============================================================================

pub fn create_pipeline_run(
    pool: &DbPool,
    team_id: &str,
    input_data: Option<&str>,
) -> Result<String, AppError> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO pipeline_runs (id, team_id, status, node_statuses, input_data, started_at)
         VALUES (?1, ?2, 'running', '[]', ?3, ?4)",
        params![id, team_id, input_data, now],
    )?;
    Ok(id)
}

pub fn update_pipeline_run(
    pool: &DbPool,
    id: &str,
    status: &str,
    node_statuses: &str,
    error_message: Option<&str>,
) -> Result<(), AppError> {
    let conn = pool.get()?;
    let completed_at = if status == "completed" || status == "failed" {
        Some(chrono::Utc::now().to_rfc3339())
    } else {
        None
    };
    conn.execute(
        "UPDATE pipeline_runs SET status = ?1, node_statuses = ?2, error_message = ?3, completed_at = ?4 WHERE id = ?5",
        params![status, node_statuses, error_message, completed_at, id],
    )?;
    Ok(())
}

pub fn get_pipeline_run(pool: &DbPool, id: &str) -> Result<PipelineRun, AppError> {
    let conn = pool.get()?;
    conn.query_row(
        "SELECT * FROM pipeline_runs WHERE id = ?1",
        params![id],
        |row| {
            Ok(PipelineRun {
                id: row.get("id")?,
                team_id: row.get("team_id")?,
                status: row.get("status")?,
                node_statuses: row.get("node_statuses")?,
                input_data: row.get("input_data")?,
                started_at: row.get("started_at")?,
                completed_at: row.get("completed_at")?,
                error_message: row.get("error_message")?,
            })
        },
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => AppError::NotFound(format!("PipelineRun {id}")),
        other => AppError::Database(other),
    })
}

pub fn list_pipeline_runs(pool: &DbPool, team_id: &str) -> Result<Vec<PipelineRun>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT * FROM pipeline_runs WHERE team_id = ?1 ORDER BY started_at DESC LIMIT 50",
    )?;
    let rows = stmt.query_map(params![team_id], |row| {
        Ok(PipelineRun {
            id: row.get("id")?,
            team_id: row.get("team_id")?,
            status: row.get("status")?,
            node_statuses: row.get("node_statuses")?,
            input_data: row.get("input_data")?,
            started_at: row.get("started_at")?,
            completed_at: row.get("completed_at")?,
            error_message: row.get("error_message")?,
        })
    })?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init_test_db;
    use crate::db::models::{CreatePersonaInput, CreateTeamInput, UpdateTeamInput};

    fn create_test_persona(pool: &DbPool, name: &str) -> crate::db::models::Persona {
        crate::db::repos::personas::create(
            pool,
            CreatePersonaInput {
                name: name.into(),
                system_prompt: "You are a test agent.".into(),
                project_id: None,
                description: None,
                structured_prompt: None,
                icon: None,
                color: None,
                enabled: Some(true),
                max_concurrent: None,
                timeout_ms: None,
                model_profile: None,
                max_budget_usd: None,
                max_turns: None,
                design_context: None,
                group_id: None,
            },
        )
        .unwrap()
    }

    #[test]
    fn test_team_crud() {
        let pool = init_test_db().unwrap();

        // Create
        let team = create(
            &pool,
            CreateTeamInput {
                name: "Alpha Squad".into(),
                project_id: None,
                description: Some("The first team".into()),
                canvas_data: None,
                team_config: None,
                icon: None,
                color: Some("#FF6347".into()),
                enabled: Some(true),
            },
        )
        .unwrap();
        assert_eq!(team.name, "Alpha Squad");
        assert!(team.enabled);
        assert_eq!(team.color, "#FF6347");

        // Read
        let fetched = get_by_id(&pool, &team.id).unwrap();
        assert_eq!(fetched.description, Some("The first team".into()));

        // List
        let all = get_all(&pool).unwrap();
        assert_eq!(all.len(), 1);

        // Update
        let updated = update(
            &pool,
            &team.id,
            UpdateTeamInput {
                name: Some("Beta Squad".into()),
                description: None,
                canvas_data: None,
                team_config: None,
                icon: None,
                color: None,
                enabled: Some(false),
            },
        )
        .unwrap();
        assert_eq!(updated.name, "Beta Squad");
        assert!(!updated.enabled);

        // Add members
        let p1 = create_test_persona(&pool, "Agent A");
        let p2 = create_test_persona(&pool, "Agent B");

        let m1 = add_member(&pool, &team.id, &p1.id, Some("orchestrator".into()), Some(100.0), Some(200.0), None).unwrap();
        assert_eq!(m1.role, "orchestrator");
        assert!((m1.position_x - 100.0).abs() < f64::EPSILON);

        let m2 = add_member(&pool, &team.id, &p2.id, None, None, None, None).unwrap();
        assert_eq!(m2.role, "worker");

        let members = get_members(&pool, &team.id).unwrap();
        assert_eq!(members.len(), 2);

        // Update member
        update_member(&pool, &m1.id, Some("reviewer".into()), Some(50.0), None, None).unwrap();

        // Add connection
        let conn = create_connection(
            &pool,
            &team.id,
            &m1.id,
            &m2.id,
            Some("conditional".into()),
            Some("on_success".into()),
            Some("pass to worker".into()),
        )
        .unwrap();
        assert_eq!(conn.connection_type, "conditional");

        let conns = get_connections(&pool, &team.id).unwrap();
        assert_eq!(conns.len(), 1);

        // Remove member should also delete its connections
        let removed = remove_member(&pool, &m1.id).unwrap();
        assert!(removed);

        let members_after = get_members(&pool, &team.id).unwrap();
        assert_eq!(members_after.len(), 1);

        let conns_after = get_connections(&pool, &team.id).unwrap();
        assert_eq!(conns_after.len(), 0);

        // Delete team (CASCADE removes remaining members)
        let deleted = delete(&pool, &team.id).unwrap();
        assert!(deleted);
        assert!(get_by_id(&pool, &team.id).is_err());
    }
}
