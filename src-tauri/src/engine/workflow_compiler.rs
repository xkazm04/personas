//! Workflow Compiler — translates a natural-language workflow description into a
//! deployable pipeline topology.
//!
//! The compiler is the missing higher-order glue between the topology builder
//! (which selects and arranges personas) and the persistence layer (teams,
//! members, connections).  Given prose like:
//!
//!   "When a PR is opened, have a security reviewer check for vulnerabilities,
//!    a code quality reviewer check style, and a technical writer draft
//!    changelog entries, then aggregate results and post a summary comment"
//!
//! the compiler:
//!   1. Calls [`build_llm_topology_prompt`] to produce a [`TopologyBlueprint`]
//!   2. Persists the blueprint as a new [`PersonaTeam`] with members &
//!      connections in the database
//!   3. Optionally generates chain-trigger configurations and JSONPath
//!      predicates for each connection so the pipeline is immediately
//!      deployable
//!   4. Returns a [`CompiledWorkflow`] that the frontend can visualise on the
//!      composition canvas

use std::time::Instant;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::db::models::{PersonaTeam, PersonaTeamConnection, PersonaTeamMember};
use crate::db::DbPool;
use crate::engine::topology::TopologyBlueprint;
use crate::error::AppError;

// ============================================================================
// Public result type (returned to frontend)
// ============================================================================

/// The output of the workflow compilation pipeline — a team plus its full
/// topology, ready for canvas rendering.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CompiledWorkflow {
    pub team: PersonaTeam,
    pub members: Vec<PersonaTeamMember>,
    pub connections: Vec<PersonaTeamConnection>,
    pub blueprint: TopologyBlueprint,
    /// The original user description, preserved for provenance.
    pub source_description: String,
    /// Warnings produced during compilation (e.g. skipped invalid connections).
    #[serde(default)]
    pub warnings: Vec<String>,
    /// Number of blueprint connections that were dropped due to invalid indices.
    #[serde(default)]
    pub dropped_connections: usize,
}

// ============================================================================
// Blueprint → Team persistence
// ============================================================================

/// Persist a [`TopologyBlueprint`] as a brand-new team, creating members and
/// connections atomically inside a single SQLite transaction.
///
/// If any member or connection insert fails the entire operation is rolled back,
/// preventing partial teams from polluting the database.
pub fn persist_blueprint(
    pool: &DbPool,
    blueprint: &TopologyBlueprint,
    description: &str,
) -> Result<CompiledWorkflow, AppError> {
    let overall_start = Instant::now();
    let member_count = blueprint.members.len();
    let connection_count = blueprint.connections.len();

    tracing::info!(
        member_count,
        connection_count,
        "persist_blueprint: starting compilation"
    );

    // 1. Validate ALL connection indices BEFORE any DB writes.
    for (i, bc) in blueprint.connections.iter().enumerate() {
        if bc.source_index >= member_count || bc.target_index >= member_count {
            tracing::warn!(
                connection_index = i,
                source_index = bc.source_index,
                target_index = bc.target_index,
                member_count,
                "persist_blueprint: connection has out-of-bounds indices"
            );
            return Err(AppError::Validation(format!(
                "Blueprint connection[{}] has out-of-bounds indices: \
                 source_index={}, target_index={}, member_count={}",
                i, bc.source_index, bc.target_index, member_count,
            )));
        }
        if bc.source_index == bc.target_index {
            return Err(AppError::Validation(format!(
                "Blueprint connection[{}] is a self-loop (index {})",
                i, bc.source_index,
            )));
        }
    }

    // --- Single connection + transaction for the entire persistence ---
    let mut conn = pool.get()?;
    let tx = conn.transaction().map_err(AppError::Database)?;

    // 2. Create the team
    let team_start = Instant::now();
    let team_id = uuid::Uuid::new_v4().to_string();
    let team_now = chrono::Utc::now().to_rfc3339();
    let team_name = derive_team_name(description);

    tx.execute(
        "INSERT INTO persona_teams
         (id, project_id, parent_team_id, name, description, canvas_data, team_config, icon, color, enabled, created_at, updated_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?11)",
        rusqlite::params![
            team_id,
            Option::<String>::None, // project_id
            Option::<String>::None, // parent_team_id
            team_name,
            blueprint.description,
            Option::<String>::None, // canvas_data
            Option::<String>::None, // team_config
            Option::<String>::None, // icon
            "#6B7280",              // color
            1i32,                   // enabled
            team_now,
        ],
    )?;

    let team = PersonaTeam {
        id: team_id.clone(),
        project_id: None,
        parent_team_id: None,
        name: team_name,
        description: Some(blueprint.description.clone()),
        canvas_data: None,
        team_config: None,
        icon: None,
        color: "#6B7280".into(),
        enabled: true,
        created_at: team_now.clone(),
        updated_at: team_now,
    };

    let team_ms = team_start.elapsed().as_millis();
    tracing::info!(
        team_id = %team.id,
        duration_ms = team_ms,
        "persist_blueprint: team created"
    );

    // 3. Add members — collect generated IDs so we can map blueprint
    //    connection indices to actual member IDs.
    let members_start = Instant::now();
    let mut member_ids: Vec<String> = Vec::with_capacity(member_count);
    let mut persisted_members: Vec<PersonaTeamMember> =
        Vec::with_capacity(member_count);

    for bm in &blueprint.members {
        let mid = uuid::Uuid::new_v4().to_string();
        let mnow = chrono::Utc::now().to_rfc3339();
        let role = bm.role.clone();

        tx.execute(
            "INSERT INTO persona_team_members (id, team_id, persona_id, role, position_x, position_y, config, created_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
            rusqlite::params![mid, team_id, bm.persona_id, role, bm.position_x, bm.position_y, Option::<String>::None, mnow],
        )?;

        member_ids.push(mid.clone());
        persisted_members.push(PersonaTeamMember {
            id: mid,
            team_id: team_id.clone(),
            persona_id: bm.persona_id.clone(),
            role,
            position_x: bm.position_x,
            position_y: bm.position_y,
            config: None,
            created_at: mnow,
        });
    }
    let members_ms = members_start.elapsed().as_millis();
    tracing::info!(
        team_id = %team.id,
        count = member_count,
        duration_ms = members_ms,
        "persist_blueprint: members inserted"
    );

    // 4. Create connections, resolving indices → member IDs.
    //    Indices are already validated so indexing is safe.
    let conns_start = Instant::now();
    let mut persisted_connections: Vec<PersonaTeamConnection> =
        Vec::with_capacity(connection_count);

    for bc in &blueprint.connections {
        let source_id = &member_ids[bc.source_index];
        let target_id = &member_ids[bc.target_index];
        let conn_type = bc.connection_type.clone();
        let cid = uuid::Uuid::new_v4().to_string();
        let cnow = chrono::Utc::now().to_rfc3339();

        tx.execute(
            "INSERT INTO persona_team_connections
             (id, team_id, source_member_id, target_member_id, connection_type, condition, label, created_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
            rusqlite::params![cid, team_id, source_id, target_id, conn_type, Option::<String>::None, Option::<String>::None, cnow],
        )?;

        persisted_connections.push(PersonaTeamConnection {
            id: cid,
            team_id: team_id.clone(),
            source_member_id: source_id.clone(),
            target_member_id: target_id.clone(),
            connection_type: conn_type,
            condition: None,
            label: None,
            created_at: cnow,
        });
    }
    let conns_ms = conns_start.elapsed().as_millis();
    tracing::info!(
        team_id = %team.id,
        count = connection_count,
        duration_ms = conns_ms,
        "persist_blueprint: connections inserted"
    );

    // --- Commit the transaction; on failure everything is rolled back ---
    tx.commit().map_err(AppError::Database)?;

    let total_ms = overall_start.elapsed().as_millis();
    tracing::info!(
        team_id = %team.id,
        member_count,
        connection_count,
        total_duration_ms = total_ms,
        team_write_ms = team_ms,
        members_write_ms = members_ms,
        connections_write_ms = conns_ms,
        "persist_blueprint: compilation complete"
    );

    Ok(CompiledWorkflow {
        team,
        members: persisted_members,
        connections: persisted_connections,
        blueprint: blueprint.clone(),
        source_description: description.to_string(),
        warnings: Vec::new(),
        dropped_connections: 0,
    })
}

// ============================================================================
// Helpers
// ============================================================================

/// Derive a concise team name from the first clause of the user's description.
fn derive_team_name(description: &str) -> String {
    let trimmed = description.trim();
    if trimmed.len() <= 60 {
        return trimmed.to_string();
    }
    // Find the last char boundary at or before byte 60
    let end = trimmed
        .char_indices()
        .map(|(i, _)| i)
        .take_while(|&i| i <= 60)
        .last()
        .unwrap_or(0);
    let truncated = &trimmed[..end];
    match truncated.rfind(' ') {
        Some(pos) => format!("{}…", &truncated[..pos]),
        None => format!("{}…", truncated),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derive_team_name_short() {
        assert_eq!(derive_team_name("Hello world"), "Hello world");
    }

    #[test]
    fn derive_team_name_truncates_at_word_boundary() {
        let long = "When a PR is opened, have a security reviewer check for vulnerabilities and report findings";
        let name = derive_team_name(long);
        assert!(name.len() <= 64); // 60 + 3 for ellipsis char
        assert!(name.ends_with('…'));
    }

    #[test]
    fn derive_team_name_multibyte_no_panic() {
        // 20 CJK chars = 60 bytes; the 21st would start at byte 60
        let cjk = "日本語テスト文字列を書く練習日本語テスト文あ";
        let name = derive_team_name(cjk);
        // Should not panic, and result must be valid UTF-8
        assert!(!name.is_empty());
    }
}
