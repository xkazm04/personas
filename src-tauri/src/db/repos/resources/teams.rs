use rusqlite::params;

use crate::db::models::{
    CreateTeamInput, PersonaTeam, PersonaTeamConnection, PersonaTeamMember, PipelineRun,
    TeamCounts, UpdateTeamInput,
};
use crate::db::DbPool;
use crate::error::AppError;

// ============================================================================
// Row mappers
// ============================================================================

row_mapper!(row_to_team -> PersonaTeam {
    id, project_id, parent_team_id, name, description,
    canvas_data, team_config, icon, color,
    enabled [bool],
    created_at, updated_at,
});

row_mapper!(row_to_member -> PersonaTeamMember {
    id, team_id, persona_id, role,
    position_x, position_y, config, created_at,
});

row_mapper!(row_to_connection -> PersonaTeamConnection {
    id, team_id, source_member_id, target_member_id,
    connection_type, condition, label, created_at,
});

row_mapper!(row_to_pipeline_run -> PipelineRun {
    id, team_id, status, node_statuses,
    input_data, started_at, completed_at, error_message,
});

// ============================================================================
// Team CRUD
// ============================================================================

crud_get_by_id!(PersonaTeam, "persona_teams", "Team", row_to_team);
crud_get_all!(PersonaTeam, "persona_teams", row_to_team, "updated_at DESC");

crud_update! {
    model: PersonaTeam,
    table: "persona_teams",
    input: UpdateTeamInput,
    fields: {
        name: clone,
        description: clone,
        canvas_data: clone,
        team_config: clone,
        icon: clone,
        color: clone,
        enabled: bool,
    }
}

/// Fetch member and connection counts for all teams in a single query.
pub fn get_all_team_counts(pool: &DbPool) -> Result<Vec<TeamCounts>, AppError> {
    timed_query!("teams", "teams::get_all_team_counts", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT
                 t.id AS team_id,
                 COALESCE(m.cnt, 0) AS member_count,
                 COALESCE(c.cnt, 0) AS connection_count
             FROM persona_teams t
             LEFT JOIN (
                 SELECT team_id, COUNT(*) AS cnt FROM persona_team_members GROUP BY team_id
             ) m ON m.team_id = t.id
             LEFT JOIN (
                 SELECT team_id, COUNT(*) AS cnt FROM persona_team_connections GROUP BY team_id
             ) c ON c.team_id = t.id",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(TeamCounts {
                team_id: row.get("team_id")?,
                member_count: row.get("member_count")?,
                connection_count: row.get("connection_count")?,
            })
        })?;
        let counts = rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)?;
        Ok(counts)

    })
}

pub fn create(pool: &DbPool, input: CreateTeamInput) -> Result<PersonaTeam, AppError> {
    timed_query!("teams", "teams::create", {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let color = input.color.unwrap_or_else(|| "#6B7280".into());
        let enabled = input.enabled.unwrap_or(true) as i32;

        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO persona_teams
             (id, project_id, parent_team_id, name, description, canvas_data, team_config, icon, color, enabled, created_at, updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?11)",
            params![
                id,
                input.project_id,
                input.parent_team_id,
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

    })
}

/// Deep-clone a team: copies the team row, all members, all connections (with
/// remapped member IDs), and all team memories. Returns the new team.
pub fn clone_team(pool: &DbPool, source_team_id: &str) -> Result<PersonaTeam, AppError> {
    timed_query!("teams", "teams::clone_team", {
        let source = get_by_id(pool, source_team_id)?;
        let members = get_members(pool, source_team_id)?;
        let connections = get_connections(pool, source_team_id)?;

        let new_team_id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();

        let mut conn = pool.get()?;
        let tx = conn.transaction().map_err(AppError::Database)?;

        // 1. Insert cloned team with parent_team_id pointing to source
        tx.execute(
            "INSERT INTO persona_teams
             (id, project_id, parent_team_id, name, description, canvas_data, team_config, icon, color, enabled, created_at, updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?11)",
            params![
                new_team_id,
                source.project_id,
                source_team_id,
                format!("{} (fork)", source.name),
                source.description,
                source.canvas_data,
                source.team_config,
                source.icon,
                source.color,
                source.enabled as i32,
                now,
            ],
        )?;

        // 2. Clone members, building old_id -> new_id map for connection remapping
        let mut member_id_map = std::collections::HashMap::new();
        for m in &members {
            let new_member_id = uuid::Uuid::new_v4().to_string();
            let member_now = chrono::Utc::now().to_rfc3339();
            tx.execute(
                "INSERT INTO persona_team_members (id, team_id, persona_id, role, position_x, position_y, config, created_at)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
                params![
                    new_member_id,
                    new_team_id,
                    m.persona_id,
                    m.role,
                    m.position_x,
                    m.position_y,
                    m.config,
                    member_now,
                ],
            )?;
            member_id_map.insert(m.id.clone(), new_member_id);
        }

        // 3. Clone connections with remapped member IDs
        for c in &connections {
            let new_source = member_id_map.get(&c.source_member_id);
            let new_target = member_id_map.get(&c.target_member_id);
            if let (Some(src), Some(tgt)) = (new_source, new_target) {
                let new_conn_id = uuid::Uuid::new_v4().to_string();
                let conn_now = chrono::Utc::now().to_rfc3339();
                tx.execute(
                    "INSERT INTO persona_team_connections
                     (id, team_id, source_member_id, target_member_id, connection_type, condition, label, created_at)
                     VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
                    params![new_conn_id, new_team_id, src, tgt, c.connection_type, c.condition, c.label, conn_now],
                )?;
            }
        }

        // 4. Clone team memories (remap member_id through member_id_map)
        {
            let mut mem_stmt = tx.prepare(
                "SELECT run_id, member_id, persona_id, title, content, category, importance, tags
                 FROM team_memories WHERE team_id = ?1",
            )?;
            #[allow(clippy::type_complexity)]
            let mem_rows: Vec<(
                Option<String>,
                Option<String>,
                Option<String>,
                String,
                String,
                String,
                i32,
                Option<String>,
            )> = mem_stmt
                .query_map(params![source_team_id], |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                        row.get(6)?,
                        row.get(7)?,
                    ))
                })?
                .collect::<Result<Vec<_>, _>>()
                .map_err(AppError::Database)?;
            drop(mem_stmt);

            for (run_id, old_member_id, persona_id, title, content, category, importance, tags) in
                &mem_rows
            {
                let new_mem_id = uuid::Uuid::new_v4().to_string();
                let remapped_member_id = old_member_id
                    .as_ref()
                    .and_then(|old| member_id_map.get(old).cloned())
                    .or_else(|| old_member_id.clone());
                tx.execute(
                    "INSERT INTO team_memories (id, team_id, run_id, member_id, persona_id, title, content, category, importance, tags, created_at, updated_at)
                     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?11)",
                    params![
                        new_mem_id,
                        new_team_id,
                        run_id,
                        remapped_member_id,
                        persona_id,
                        title,
                        content,
                        category,
                        importance,
                        tags,
                        now,
                    ],
                )?;
            }
        }

        tx.commit().map_err(AppError::Database)?;

        get_by_id(pool, &new_team_id)

    })
}

pub fn delete(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    timed_query!("teams", "teams::delete", {
        let mut conn = pool.get()?;
        let tx = conn.transaction().map_err(AppError::Database)?;
        // Clean up related rows which have no FK CASCADE on team_id
        tx.execute("DELETE FROM pipeline_runs WHERE team_id = ?1", params![id])?;
        tx.execute("DELETE FROM team_memories WHERE team_id = ?1", params![id])?;
        let rows = tx.execute("DELETE FROM persona_teams WHERE id = ?1", params![id])?;
        tx.commit().map_err(AppError::Database)?;
        Ok(rows > 0)

    })
}

// ============================================================================
// Members
// ============================================================================

pub fn get_members(pool: &DbPool, team_id: &str) -> Result<Vec<PersonaTeamMember>, AppError> {
    timed_query!("teams", "teams::get_members", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM persona_team_members WHERE team_id = ?1 ORDER BY created_at ASC",
        )?;
        let rows = stmt.query_map(params![team_id], row_to_member)?;
        let members = rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)?;
        Ok(members)

    })
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
    timed_query!("teams", "teams::add_member", {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let role = role.unwrap_or_else(|| "worker".into());
        let px = position_x.unwrap_or(0.0);
        let py = position_y.unwrap_or(0.0);

        let conn = pool.get()?;

        // Prevent duplicate persona in the same team
        let exists: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM persona_team_members WHERE team_id = ?1 AND persona_id = ?2)",
            params![team_id, persona_id],
            |row| row.get(0),
        )?;
        if exists {
            return Err(AppError::Validation(format!(
                "Persona {} is already a member of team {}",
                persona_id, team_id
            )));
        }

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
    timed_query!("teams", "teams::update_member", {
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

    })
}

pub fn remove_member(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    timed_query!("teams", "teams::remove_member", {
        let mut conn = pool.get()?;
        let tx = conn.transaction().map_err(AppError::Database)?;
        tx.execute(
            "DELETE FROM persona_team_connections WHERE source_member_id = ?1 OR target_member_id = ?1",
            params![id],
        )?;
        let rows = tx.execute(
            "DELETE FROM persona_team_members WHERE id = ?1",
            params![id],
        )?;
        tx.commit().map_err(AppError::Database)?;
        Ok(rows > 0)

    })
}

// ============================================================================
// Connections
// ============================================================================

pub fn get_connections(
    pool: &DbPool,
    team_id: &str,
) -> Result<Vec<PersonaTeamConnection>, AppError> {
    timed_query!("teams", "teams::get_connections", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM persona_team_connections WHERE team_id = ?1 ORDER BY created_at ASC",
        )?;
        let rows = stmt.query_map(params![team_id], row_to_connection)?;
        let connections = rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)?;
        Ok(connections)

    })
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
    timed_query!("teams", "teams::create_connection", {
        // Reject self-loops -- they break topological sort and are never valid in a DAG.
        if source_member_id == target_member_id {
            return Err(AppError::Validation(
                "Self-loop not allowed: source and target must be different members".into(),
            ));
        }

        let conn_type = connection_type.unwrap_or_else(|| "sequential".into());
        let conn = pool.get()?;

        // Validate both member IDs belong to the specified team
        let source_belongs: bool = conn
            .query_row(
                "SELECT COUNT(*) FROM persona_team_members WHERE id = ?1 AND team_id = ?2",
                params![source_member_id, team_id],
                |row| row.get::<_, i64>(0),
            )
            .map(|c| c > 0)
            .unwrap_or(false);

        if !source_belongs {
            return Err(AppError::Validation(
                "Source member does not belong to the specified team".into(),
            ));
        }

        let target_belongs: bool = conn
            .query_row(
                "SELECT COUNT(*) FROM persona_team_members WHERE id = ?1 AND team_id = ?2",
                params![target_member_id, team_id],
                |row| row.get::<_, i64>(0),
            )
            .map(|c| c > 0)
            .unwrap_or(false);

        if !target_belongs {
            return Err(AppError::Validation(
                "Target member does not belong to the specified team".into(),
            ));
        }

        // Check for duplicate edge
        let exists: bool = conn
            .query_row(
                "SELECT COUNT(*) FROM persona_team_connections
                 WHERE team_id = ?1 AND source_member_id = ?2 AND target_member_id = ?3",
                params![team_id, source_member_id, target_member_id],
                |row| row.get::<_, i64>(0),
            )
            .map(|c| c > 0)
            .unwrap_or(false);

        if exists {
            return Err(AppError::Validation(
                "Duplicate connection: an edge between these members already exists".into(),
            ));
        }

        // Cycle detection: reject non-feedback edges that would create a cycle.
        if conn_type != "feedback" {
            let existing = get_connections(pool, team_id)?;
            let mut member_set = std::collections::HashSet::new();
            for e in &existing {
                member_set.insert(e.source_member_id.clone());
                member_set.insert(e.target_member_id.clone());
            }
            member_set.insert(source_member_id.to_string());
            member_set.insert(target_member_id.to_string());
            let member_ids: Vec<String> = member_set.into_iter().collect();

            let mut edges: Vec<(&str, &str)> = existing
                .iter()
                .filter(|e| e.connection_type != "feedback")
                .map(|e| (e.source_member_id.as_str(), e.target_member_id.as_str()))
                .collect();
            edges.push((source_member_id, target_member_id));

            let graph = crate::engine::topology_graph::NamedTopologyGraph::new(&member_ids, &edges);
            if graph.has_cycle() {
                return Err(AppError::Validation(
                    "This connection would create a cycle. Use connection_type \"feedback\" for intentional back-edges.".into(),
                ));
            }
        }

        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();

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

    })
}

pub fn update_connection_type(
    pool: &DbPool,
    id: &str,
    connection_type: &str,
) -> Result<(), AppError> {
    timed_query!("teams", "teams::update_connection_type", {
        let conn = pool.get()?;

        // Fetch the existing connection so we can validate the type change.
        let existing: PersonaTeamConnection = conn
            .query_row(
                "SELECT * FROM persona_team_connections WHERE id = ?1",
                params![id],
                row_to_connection,
            )
            .map_err(|_| {
                AppError::Validation(format!("Connection '{}' not found", id))
            })?;

        // If changing to a non-feedback type, run cycle detection to prevent
        // silently introducing a cycle (e.g. feedback → sequential).
        if connection_type != "feedback" && existing.connection_type == "feedback" {
            let all_connections = get_connections(pool, &existing.team_id)?;

            let mut member_set = std::collections::HashSet::new();
            for e in &all_connections {
                member_set.insert(e.source_member_id.clone());
                member_set.insert(e.target_member_id.clone());
            }
            let member_ids: Vec<String> = member_set.into_iter().collect();

            // Build edge list: include all non-feedback edges PLUS this connection
            // (which is currently feedback but would become non-feedback).
            let edges: Vec<(&str, &str)> = all_connections
                .iter()
                .filter(|e| {
                    if e.id == existing.id {
                        true // include this edge as if it were already non-feedback
                    } else {
                        e.connection_type != "feedback"
                    }
                })
                .map(|e| (e.source_member_id.as_str(), e.target_member_id.as_str()))
                .collect();

            let graph =
                crate::engine::topology_graph::NamedTopologyGraph::new(&member_ids, &edges);
            if graph.has_cycle() {
                return Err(AppError::Validation(
                    "Changing this connection type would create a cycle. Keep it as \"feedback\" for intentional back-edges.".into(),
                ));
            }
        }

        conn.execute(
            "UPDATE persona_team_connections SET connection_type = ?1 WHERE id = ?2",
            params![connection_type, id],
        )?;
        Ok(())

    })
}

pub fn delete_connection(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    timed_query!("teams", "teams::delete_connection", {
        let conn = pool.get()?;
        let rows = conn.execute(
            "DELETE FROM persona_team_connections WHERE id = ?1",
            params![id],
        )?;
        Ok(rows > 0)

    })
}

// ============================================================================
// Pipeline Runs
// ============================================================================

/// Returns `true` if the team has any pipeline run currently in "running" status.
pub fn has_running_pipeline(pool: &DbPool, team_id: &str) -> Result<bool, AppError> {
    timed_query!("teams", "teams::has_running_pipeline", {
        let conn = pool.get()?;
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM pipeline_runs WHERE team_id = ?1 AND status = 'running'",
            params![team_id],
            |row| row.get(0),
        )?;
        Ok(count > 0)

    })
}

pub fn create_pipeline_run(
    pool: &DbPool,
    team_id: &str,
    input_data: Option<&str>,
) -> Result<String, AppError> {
    timed_query!("teams", "teams::create_pipeline_run", {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO pipeline_runs (id, team_id, status, node_statuses, input_data, started_at)
             VALUES (?1, ?2, 'running', '[]', ?3, ?4)",
            params![id, team_id, input_data, now],
        )?;
        Ok(id)

    })
}

pub fn update_pipeline_run(
    pool: &DbPool,
    id: &str,
    status: &str,
    node_statuses: &str,
    error_message: Option<&str>,
) -> Result<(), AppError> {
    timed_query!("teams", "teams::update_pipeline_run", {
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

    })
}

pub fn get_pipeline_run(pool: &DbPool, id: &str) -> Result<PipelineRun, AppError> {
    timed_query!("teams", "teams::get_pipeline_run", {
        let conn = pool.get()?;
        conn.query_row(
            "SELECT * FROM pipeline_runs WHERE id = ?1",
            params![id],
            row_to_pipeline_run,
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => AppError::NotFound(format!("PipelineRun {id}")),
            other => AppError::Database(other),
        })

    })
}

pub fn list_pipeline_runs(pool: &DbPool, team_id: &str) -> Result<Vec<PipelineRun>, AppError> {
    timed_query!("teams", "teams::list_pipeline_runs", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM pipeline_runs WHERE team_id = ?1 ORDER BY started_at DESC LIMIT 50",
        )?;
        let rows = stmt.query_map(params![team_id], row_to_pipeline_run)?;
        let runs = rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)?;
        Ok(runs)

    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init_test_db;
    use crate::db::models::{CreateTeamInput, UpdateTeamInput};
    use crate::db::repos::test_fixtures;

    fn create_test_persona(pool: &DbPool, name: &str) -> crate::db::models::Persona {
        test_fixtures::create_test_persona(pool, name, "You are a test agent.")
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
                parent_team_id: None,
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
