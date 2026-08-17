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

use crate::DbPool;
use personas_core::error::AppError;

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
    /// Last recorded healthcheck state of the member credential
    /// (`"verified"` / `"failed"` / `"unverifiable"`), read from the member
    /// credential's metadata ring buffer. `None` = never probed yet. Written by
    /// the periodic `McpHealthcheckSubscription` sweep; lets the members modal
    /// show a live ok/failed badge instead of only surfacing a dead member as
    /// silently-missing tools.
    pub last_health_state: Option<String>,
    /// RFC3339 timestamp of the last healthcheck probe of this member, or `None`
    /// if never probed.
    pub last_checked_at: Option<String>,
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
    // The member health columns (`last_health_state` / `last_checked_at`) are
    // read from the member credential's metadata ring buffer, populated by the
    // periodic MCP gateway healthcheck sweep. `healthcheck_last_state` is a
    // top-level key (written via patch_metadata_atomic) and
    // `healthcheck_last_tested_at` is flattened from the ledger `custom` map, so
    // both resolve via json_extract at the top level.
    let mut stmt = conn.prepare(
        "SELECT m.id, m.gateway_credential_id, m.member_credential_id,
                c.service_type, c.name,
                m.display_name, m.enabled, m.sort_order, m.created_at,
                json_extract(c.metadata, '$.healthcheck_last_state'),
                json_extract(c.metadata, '$.healthcheck_last_tested_at')
         FROM mcp_gateway_members m
         INNER JOIN persona_credentials c ON c.id = m.member_credential_id
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
                last_health_state: row.get(9)?,
                last_checked_at: row.get(10)?,
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::init_test_db;

    fn credential(pool: &DbPool, id: &str, name: &str, service_type: &str) {
        pool.get()
            .unwrap()
            .execute(
                "INSERT INTO persona_credentials
                    (id, name, service_type, encrypted_data, iv, created_at, updated_at)
                 VALUES (?1, ?2, ?3, 'x', 'y', '2026-01-01', '2026-01-01')",
                params![id, name, service_type],
            )
            .unwrap();
    }

    /// The whole feature chain — `GatewayMembersModal` -> `mcpGateways.ts` ->
    /// `commands::credentials::mcp_gateways` -> here — shipped 2026-04-08 and
    /// never once worked. Two independent phantom references to a `credentials`
    /// table that does not exist (the real one is `persona_credentials`) broke
    /// it at both ends: the FK on `mcp_gateway_members` failed every INSERT with
    /// `no such table: main.credentials`, and `list_members`' JOIN failed to
    /// prepare. This test drives add -> list -> toggle -> remove end to end.
    #[test]
    fn add_list_and_remove_a_gateway_member() {
        let pool = init_test_db().unwrap();
        credential(&pool, "gw", "My Gateway", "mcp_gateway");
        credential(&pool, "mem", "Linear MCP", "linear");

        let id = add_member(&pool, "gw", "mem", "Linear", 0).expect("add_member must succeed");
        assert!(!id.is_empty());

        let members = list_members(&pool, "gw").expect("list_members must succeed");
        assert_eq!(members.len(), 1);
        assert_eq!(members[0].member_credential_id, "mem");
        assert_eq!(members[0].member_label, "Linear MCP");
        assert_eq!(members[0].member_service_type, "linear");
        assert!(members[0].enabled);

        set_member_enabled(&pool, "gw", "mem", false).unwrap();
        assert!(!list_members(&pool, "gw").unwrap()[0].enabled);

        assert_eq!(list_gateways_containing(&pool, "mem").unwrap(), vec!["gw"]);

        remove_member(&pool, "gw", "mem").unwrap();
        assert!(list_members(&pool, "gw").unwrap().is_empty());
    }

    /// The UNIQUE constraint carries the idempotency `add_member` documents.
    #[test]
    fn add_member_is_idempotent_on_the_same_pair() {
        let pool = init_test_db().unwrap();
        credential(&pool, "gw", "My Gateway", "mcp_gateway");
        credential(&pool, "mem", "Linear MCP", "linear");

        add_member(&pool, "gw", "mem", "Linear", 0).unwrap();
        add_member(&pool, "gw", "mem", "Linear", 0).unwrap();
        assert_eq!(list_members(&pool, "gw").unwrap().len(), 1);
    }

    /// Deleting a credential must take its membership rows with it — the
    /// `ON DELETE CASCADE` that the phantom FK target made inoperative.
    #[test]
    fn deleting_a_member_credential_cascades() {
        let pool = init_test_db().unwrap();
        credential(&pool, "gw", "My Gateway", "mcp_gateway");
        credential(&pool, "mem", "Linear MCP", "linear");
        add_member(&pool, "gw", "mem", "Linear", 0).unwrap();

        pool.get()
            .unwrap()
            .execute("DELETE FROM persona_credentials WHERE id = 'mem'", [])
            .unwrap();
        assert!(list_members(&pool, "gw").unwrap().is_empty());
    }
}
