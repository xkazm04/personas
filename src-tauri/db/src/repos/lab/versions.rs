use crate::models::lab::PersonaVersion;
use crate::DbPool;
use personas_core::error::AppError;

/// One projection for every read of `persona_versions`, so the SELECT and the
/// mapper cannot disagree. Mirrors `CREATE TABLE persona_versions` at
/// `migrations/incremental/e03_p2p_and_telemetry.rs:307`.
const COLUMNS: &str = "id, persona_id, version_number, name, description, system_prompt, \
                       structured_prompt, model_profile, max_budget_usd, max_turns, \
                       timeout_ms, design_context, change_summary, tag, \
                       parent_version_id, created_at";

row_mapper!(row_to_version -> PersonaVersion {
    id,
    persona_id,
    version_number,
    name,
    description,
    system_prompt,
    structured_prompt,
    model_profile,
    max_budget_usd,
    max_turns,
    timeout_ms,
    design_context,
    change_summary,
    tag,
    parent_version_id,
    created_at,
});

/// Snapshot the persona's current state as a new `persona_versions` row.
///
/// The snapshot carries its ANCESTOR. `parent_version_id` is in the table, in
/// `COLUMNS` and in the mapper, and until now nothing in the tree wrote it - a
/// workspace grep found the model, the migration and this mapper and zero
/// writers - so every snapshot was a root and rollback had no lineage to walk.
/// The parent is the persona's current `production` version if it has one,
/// else its latest snapshot; the first version of a persona has none.
///
/// The whole thing runs in one IMMEDIATE transaction because two reads inform
/// the write (the next version number and the parent): a deferred transaction
/// would let a concurrent `create_version` hand both callers the same
/// `version_number` and the same parent.
pub fn create_version(pool: &DbPool, persona_id: &str) -> Result<PersonaVersion, AppError> {
    timed_query!("persona_versions", "persona_versions::create_version", {
        let mut conn = pool.get().map_err(|e| AppError::Internal(e.to_string()))?;
        let tx = conn
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|e| AppError::Internal(e.to_string()))?;

        // Get next version number
        let next_num: i32 = tx
            .query_row(
                "SELECT COALESCE(MAX(version_number), 0) + 1 AS next_version_number
                 FROM persona_versions WHERE persona_id = ?1",
                rusqlite::params![persona_id],
                |row| row.get("next_version_number"),
            )
            .unwrap_or(1);

        // The ancestor this snapshot descends from: the live production
        // version if one is tagged, otherwise the most recent snapshot.
        // `None` for a persona's first version, which is a root by definition.
        let parent_id: Option<String> = tx
            .query_row(
                "SELECT id FROM persona_versions
                 WHERE persona_id = ?1
                 ORDER BY (tag = 'production') DESC, version_number DESC
                 LIMIT 1",
                rusqlite::params![persona_id],
                |row| row.get("id"),
            )
            .ok();

        let id = uuid::Uuid::new_v4().to_string();

        // Snapshot current persona state
        tx.execute(
            // `created_at` is `TEXT` with NO default in the DDL and this INSERT
            // never named it, so every snapshot stored NULL and the read-back
            // below failed with "Invalid column type Null at index 15" - the
            // function could not return a single version. Stamped here.
            "INSERT INTO persona_versions (id, persona_id, version_number, name, description, system_prompt, structured_prompt, model_profile, max_budget_usd, max_turns, timeout_ms, design_context, tag, parent_version_id, created_at)
             SELECT ?1, p.id, ?2, p.name, p.description, p.system_prompt, p.structured_prompt, p.model_profile, p.max_budget_usd, p.max_turns, p.timeout_ms, p.design_context, 'experimental', ?4, ?5
             FROM personas p WHERE p.id = ?3",
            rusqlite::params![
                id,
                next_num,
                persona_id,
                parent_id,
                chrono::Utc::now().to_rfc3339()
            ],
        ).map_err(|e| AppError::Internal(e.to_string()))?;

        // Snapshot current tools (join through persona_tools assignment table)
        tx.execute(
            "INSERT INTO persona_version_tools (id, version_id, tool_id, tool_config)
             SELECT hex(randomblob(16)), ?1, td.id, json_object('name', td.name, 'category', td.category, 'description', td.description)
             FROM persona_tools pt
             JOIN persona_tool_definitions td ON td.id = pt.tool_id
             WHERE pt.persona_id = ?2",
            rusqlite::params![id, persona_id],
        ).map_err(|e| AppError::Internal(e.to_string()))?;

        // Read back
        let version = tx
            .query_row(
                &format!("SELECT {COLUMNS} FROM persona_versions WHERE id = ?1"),
                rusqlite::params![id],
                row_to_version,
            )
            .map_err(|e| AppError::Internal(e.to_string()))?;

        tx.commit().map_err(|e| AppError::Internal(e.to_string()))?;

        Ok(version)
    })
}

pub fn get_versions(
    pool: &DbPool,
    persona_id: &str,
    limit: i32,
) -> Result<Vec<PersonaVersion>, AppError> {
    timed_query!("persona_versions", "persona_versions::get_versions", {
        let conn = pool.get().map_err(|e| AppError::Internal(e.to_string()))?;
        let mut stmt = conn
            .prepare(&format!(
                "SELECT {COLUMNS} FROM persona_versions WHERE persona_id = ?1
             ORDER BY version_number DESC LIMIT ?2"
            ))
            .map_err(|e| AppError::Internal(e.to_string()))?;

        let versions = stmt
            .query_map(rusqlite::params![persona_id, limit], row_to_version)
            .map_err(|e| AppError::Internal(e.to_string()))?
            .filter_map(|r| r.ok())
            .collect();

        Ok(versions)
    })
}

pub fn get_version_tool_count(pool: &DbPool, version_id: &str) -> Result<i32, AppError> {
    timed_query!(
        "persona_versions",
        "persona_versions::get_version_tool_count",
        {
            let conn = pool.get().map_err(|e| AppError::Internal(e.to_string()))?;
            let count: i32 = conn
                .query_row(
                    "SELECT COUNT(*) AS n FROM persona_version_tools WHERE version_id = ?1",
                    rusqlite::params![version_id],
                    |row| row.get("n"),
                )
                .unwrap_or(0);
            Ok(count)
        }
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seed_persona(pool: &DbPool, id: &str) {
        let Ok(conn) = pool.get() else {
            panic!("pool checkout")
        };
        conn.execute(
            "INSERT INTO personas (id, name, system_prompt, created_at, updated_at)
             VALUES (?1, 'T', 'sp', '2026-01-01', '2026-01-01')",
            rusqlite::params![id],
        )
        .expect("seed persona");
    }

    /// A persona's first snapshot has no ancestor - it IS the root.
    #[test]
    fn the_first_version_has_no_parent() {
        let pool = crate::init_test_db().expect("test db");
        seed_persona(&pool, "p1");

        let v1 = create_version(&pool, "p1").expect("v1");
        assert_eq!(v1.version_number, 1);
        assert_eq!(v1.parent_version_id, None);
    }

    /// The second snapshot points at the first, so a lineage query can walk
    /// v3 -> v2 -> v1 instead of guessing which experimental row is the parent.
    #[test]
    fn a_later_version_points_at_its_ancestor() {
        let pool = crate::init_test_db().expect("test db");
        seed_persona(&pool, "p2");

        let v1 = create_version(&pool, "p2").expect("v1");
        let v2 = create_version(&pool, "p2").expect("v2");
        let v3 = create_version(&pool, "p2").expect("v3");

        assert_eq!(v2.parent_version_id.as_deref(), Some(v1.id.as_str()));
        assert_eq!(v3.parent_version_id.as_deref(), Some(v2.id.as_str()));
        assert_eq!(
            v3.version_number, 3,
            "version numbers stay unique per persona"
        );
    }

    /// When a version is tagged `production`, a new snapshot descends from THAT
    /// rather than from whatever experimental row happens to be newest -
    /// rollback follows the line the operator actually shipped.
    #[test]
    fn production_wins_over_the_newest_experiment() {
        let pool = crate::init_test_db().expect("test db");
        seed_persona(&pool, "p3");

        let v1 = create_version(&pool, "p3").expect("v1");
        let _v2 = create_version(&pool, "p3").expect("v2");
        {
            let Ok(conn) = pool.get() else {
                panic!("pool checkout")
            };
            conn.execute(
                "UPDATE persona_versions SET tag = 'production' WHERE id = ?1",
                rusqlite::params![v1.id],
            )
            .expect("tag production");
        }

        let v3 = create_version(&pool, "p3").expect("v3");
        assert_eq!(v3.parent_version_id.as_deref(), Some(v1.id.as_str()));
    }
}
