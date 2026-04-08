//! MCP Gateway membership repository.
//!
//! A "gateway" credential (connector_name = "mcp_gateway") aggregates one or
//! more underlying MCP-speaking credentials. Attaching the gateway to a persona
//! inherits every enabled member's tools without requiring per-persona wiring.
//!
//! Added 2026-04-08 as part of the LangSmith/Arcade MCP gateway pattern
//! (finding #1 from the /research run on the same date).

use rusqlite::params;
use serde::{Deserialize, Serialize};
use ts_rs::TS;
use uuid::Uuid;

use crate::db::DbPool;
use crate::error::AppError;

/// A single member of an MCP gateway -- joins the `mcp_gateway_members` row
/// with enough credential metadata for the UI and the engine resolver.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct GatewayMember {
    pub id: String,
    pub gateway_credential_id: String,
    pub member_credential_id: String,
    pub member_service_type: String,
    pub member_label: String,
    pub display_name: String,
    pub enabled: bool,
    pub sort_order: i32,
    pub created_at: String,
}

/// Add a credential as a member of a gateway. Idempotent on the
/// (gateway_credential_id, member_credential_id) UNIQUE constraint: calling it
/// twice with the same pair is a no-op.
pub fn add_member(
    pool: &DbPool,
    gateway_credential_id: &str,
    member_credential_id: &str,
    display_name: &str,
    sort_order: i32,
) -> Result<String, AppError> {
    if gateway_credential_id == member_credential_id {
        return Err(AppError::Validation(
            "A gateway cannot contain itself as a member".into(),
        ));
    }
    let conn = pool.get()?;
    let id = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT OR IGNORE INTO mcp_gateway_members
            (id, gateway_credential_id, member_credential_id, display_name, enabled, sort_order)
         VALUES (?1, ?2, ?3, ?4, 1, ?5)",
        params![
            id,
            gateway_credential_id,
            member_credential_id,
            display_name,
            sort_order
        ],
    )?;
    Ok(id)
}

/// Remove a member from a gateway.
pub fn remove_member(
    pool: &DbPool,
    gateway_credential_id: &str,
    member_credential_id: &str,
) -> Result<(), AppError> {
    let conn = pool.get()?;
    conn.execute(
        "DELETE FROM mcp_gateway_members
         WHERE gateway_credential_id = ?1 AND member_credential_id = ?2",
        params![gateway_credential_id, member_credential_id],
    )?;
    Ok(())
}

/// List all members of a gateway, enriched with credential metadata via JOIN.
/// Returns members ordered by `sort_order` then by creation time.
pub fn list_members(
    pool: &DbPool,
    gateway_credential_id: &str,
) -> Result<Vec<GatewayMember>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT m.id, m.gateway_credential_id, m.member_credential_id,
                c.service_type, c.name,
                m.display_name, m.enabled, m.sort_order, m.created_at
         FROM mcp_gateway_members m
         INNER JOIN credentials c ON c.id = m.member_credential_id
         WHERE m.gateway_credential_id = ?1
         ORDER BY m.sort_order ASC, m.created_at ASC",
    )?;

    let rows = stmt
        .query_map(params![gateway_credential_id], |row| {
            Ok(GatewayMember {
                id: row.get(0)?,
                gateway_credential_id: row.get(1)?,
                member_credential_id: row.get(2)?,
                member_service_type: row.get(3)?,
                member_label: row.get(4)?,
                display_name: row.get(5)?,
                enabled: row.get::<_, i64>(6)? != 0,
                sort_order: row.get(7)?,
                created_at: row.get(8)?,
            })
        })?
        .collect::<Result<Vec<_>, rusqlite::Error>>()?;

    Ok(rows)
}

/// List the gateway credential IDs that contain a given member. Used by the
/// credential delete flow to warn before unlinking a credential that belongs
/// to one or more gateways. (ON DELETE CASCADE handles the actual cleanup,
/// this is purely for informational confirmation.)
#[allow(dead_code)]
pub fn list_gateways_containing(
    pool: &DbPool,
    member_credential_id: &str,
) -> Result<Vec<String>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT DISTINCT gateway_credential_id
         FROM mcp_gateway_members
         WHERE member_credential_id = ?1",
    )?;
    let rows = stmt
        .query_map(params![member_credential_id], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, rusqlite::Error>>()?;
    Ok(rows)
}

/// Toggle the enabled flag on a gateway member without removing it from the
/// bundle. Used by the UI "temporarily disable this member" action.
#[allow(dead_code)]
pub fn set_member_enabled(
    pool: &DbPool,
    gateway_credential_id: &str,
    member_credential_id: &str,
    enabled: bool,
) -> Result<(), AppError> {
    let conn = pool.get()?;
    conn.execute(
        "UPDATE mcp_gateway_members
         SET enabled = ?3
         WHERE gateway_credential_id = ?1 AND member_credential_id = ?2",
        params![
            gateway_credential_id,
            member_credential_id,
            if enabled { 1 } else { 0 }
        ],
    )?;
    Ok(())
}
