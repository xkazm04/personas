use rusqlite::{params, Row};
use tracing::instrument;

use crate::db::models::{
    CreateExposedResourceInput, CreateProvenanceInput, ExposedResource, ResourceProvenance,
    UpdateExposedResourceInput,
};
use crate::db::DbPool;
use crate::error::AppError;

// -- Row mappers ---------------------------------------------------------

fn row_to_exposed_resource(row: &Row) -> rusqlite::Result<ExposedResource> {
    let rt_str: String = row.get("resource_type")?;
    let al_str: String = row.get("access_level")?;
    Ok(ExposedResource {
        id: row.get("id")?,
        resource_type: rt_str.parse().map_err(|e: AppError| {
            rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(e))
        })?,
        resource_id: row.get("resource_id")?,
        display_name: row.get("display_name")?,
        description: row.get("description")?,
        fields_exposed: row.get("fields_exposed")?,
        access_level: al_str.parse().map_err(|e: AppError| {
            rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(e))
        })?,
        requires_auth: row.get::<_, i32>("requires_auth")? != 0,
        tags: row.get("tags")?,
        created_at: row.get("created_at")?,
        expires_at: row.get("expires_at")?,
    })
}

fn row_to_provenance(row: &Row) -> rusqlite::Result<ResourceProvenance> {
    Ok(ResourceProvenance {
        resource_type: row.get("resource_type")?,
        resource_id: row.get("resource_id")?,
        source_peer_id: row.get("source_peer_id")?,
        source_display_name: row.get("source_display_name")?,
        imported_at: row.get("imported_at")?,
        bundle_hash: row.get("bundle_hash")?,
        signature_verified: row.get::<_, i32>("signature_verified")? != 0,
    })
}

// -- Exposed Resources ---------------------------------------------------

#[instrument(skip(pool))]
pub fn list_exposed_resources(pool: &DbPool) -> Result<Vec<ExposedResource>, AppError> {
    timed_query!("exposure_scans", "exposure_scans::list_exposed_resources", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM exposed_resources
             WHERE expires_at IS NULL OR expires_at > datetime('now')
             ORDER BY created_at DESC",
        )?;
        let rows = stmt.query_map([], row_to_exposed_resource)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)

    })
}

/// Remove all exposed resources whose expiration time has passed.
#[instrument(skip(pool))]
pub fn cleanup_expired_exposures(pool: &DbPool) -> Result<u64, AppError> {
    timed_query!("exposure_scans", "exposure_scans::cleanup_expired_exposures", {
        let conn = pool.get()?;
        let deleted = conn.execute(
            "DELETE FROM exposed_resources WHERE expires_at IS NOT NULL AND expires_at <= datetime('now')",
            [],
        )?;
        Ok(deleted as u64)

    })
}

#[instrument(skip(pool))]
pub fn get_exposed_resource(pool: &DbPool, id: &str) -> Result<ExposedResource, AppError> {
    timed_query!("exposure_scans", "exposure_scans::get_exposed_resource", {
        let conn = pool.get()?;
        conn.query_row(
            "SELECT * FROM exposed_resources WHERE id = ?1",
            params![id],
            row_to_exposed_resource,
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => {
                AppError::NotFound(format!("Exposed resource {id}"))
            }
            other => AppError::Database(other),
        })

    })
}

#[instrument(skip(pool))]
pub fn get_by_resource(
    pool: &DbPool,
    resource_type: &str,
    resource_id: &str,
) -> Result<Option<ExposedResource>, AppError> {
    timed_query!("exposure_scans", "exposure_scans::get_by_resource", {
        let conn = pool.get()?;
        conn.query_row(
            "SELECT * FROM exposed_resources WHERE resource_type = ?1 AND resource_id = ?2",
            params![resource_type, resource_id],
            row_to_exposed_resource,
        )
        .optional()
        .map_err(AppError::Database)

    })
}

#[instrument(skip(pool, input), fields(resource_type = %input.resource_type, resource_id = %input.resource_id))]
pub fn create_exposed_resource(
    pool: &DbPool,
    input: CreateExposedResourceInput,
) -> Result<ExposedResource, AppError> {
    timed_query!("exposure_scans", "exposure_scans::create_exposed_resource", {
        let id = uuid::Uuid::new_v4().to_string();
        let fields_json = serde_json::to_string(&input.fields_exposed)?;
        let tags_json = serde_json::to_string(&input.tags)?;
        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO exposed_resources (id, resource_type, resource_id, display_name, description,
             fields_exposed, access_level, requires_auth, tags, expires_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                id,
                input.resource_type.to_string(),
                input.resource_id,
                input.display_name,
                input.description,
                fields_json,
                input.access_level.to_string(),
                input.requires_auth as i32,
                tags_json,
                input.expires_at,
            ],
        )?;
        get_exposed_resource(pool, &id)

    })
}

#[instrument(skip(pool, input))]
pub fn update_exposed_resource(
    pool: &DbPool,
    id: &str,
    input: UpdateExposedResourceInput,
) -> Result<ExposedResource, AppError> {
    timed_query!("exposure_scans", "exposure_scans::update_exposed_resource", {
        let conn = pool.get()?;

        // Serialize JSON fields upfront so errors surface before any SQL runs.
        let fields_json = input
            .fields_exposed
            .as_ref()
            .map(serde_json::to_string)
            .transpose()?;
        let tags_json = input
            .tags
            .as_ref()
            .map(serde_json::to_string)
            .transpose()?;

        // Build a single UPDATE with only the supplied columns to ensure atomicity.
        let mut clauses: Vec<&str> = Vec::new();
        let mut values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

        if let Some(ref name) = input.display_name {
            clauses.push("display_name = ?");
            values.push(Box::new(name.clone()));
        }
        if let Some(ref desc) = input.description {
            clauses.push("description = ?");
            values.push(Box::new(desc.clone()));
        }
        if let Some(ref json) = fields_json {
            clauses.push("fields_exposed = ?");
            values.push(Box::new(json.clone()));
        }
        if let Some(ref level) = input.access_level {
            clauses.push("access_level = ?");
            values.push(Box::new(level.to_string()));
        }
        if let Some(auth) = input.requires_auth {
            clauses.push("requires_auth = ?");
            values.push(Box::new(auth as i32));
        }
        if let Some(ref json) = tags_json {
            clauses.push("tags = ?");
            values.push(Box::new(json.clone()));
        }
        if let Some(ref exp) = input.expires_at {
            clauses.push("expires_at = ?");
            values.push(Box::new(exp.clone()));
        }

        if !clauses.is_empty() {
            values.push(Box::new(id.to_string()));
            let sql = format!(
                "UPDATE exposed_resources SET {} WHERE id = ?",
                clauses.join(", ")
            );
            conn.execute(&sql, rusqlite::params_from_iter(values.iter().map(|v| v.as_ref())))?;
        }

        get_exposed_resource(pool, id)

    })
}

#[instrument(skip(pool))]
pub fn delete_exposed_resource(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    timed_query!("exposure_scans", "exposure_scans::delete_exposed_resource", {
        let conn = pool.get()?;
        let changed = conn.execute(
            "DELETE FROM exposed_resources WHERE id = ?1",
            params![id],
        )?;
        Ok(changed > 0)

    })
}

#[instrument(skip(pool))]
pub fn delete_by_resource(
    pool: &DbPool,
    resource_type: &str,
    resource_id: &str,
) -> Result<bool, AppError> {
    timed_query!("exposure_scans", "exposure_scans::delete_by_resource", {
        let conn = pool.get()?;
        let changed = conn.execute(
            "DELETE FROM exposed_resources WHERE resource_type = ?1 AND resource_id = ?2",
            params![resource_type, resource_id],
        )?;
        Ok(changed > 0)

    })
}

// -- Provenance ----------------------------------------------------------

#[instrument(skip(pool))]
pub fn list_provenance(pool: &DbPool) -> Result<Vec<ResourceProvenance>, AppError> {
    timed_query!("exposure_scans", "exposure_scans::list_provenance", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM resource_provenance ORDER BY imported_at DESC",
        )?;
        let rows = stmt.query_map([], row_to_provenance)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)

    })
}

#[instrument(skip(pool))]
pub fn get_provenance(
    pool: &DbPool,
    resource_type: &str,
    resource_id: &str,
) -> Result<Option<ResourceProvenance>, AppError> {
    timed_query!("exposure_scans", "exposure_scans::get_provenance", {
        let conn = pool.get()?;
        conn.query_row(
            "SELECT * FROM resource_provenance WHERE resource_type = ?1 AND resource_id = ?2",
            params![resource_type, resource_id],
            row_to_provenance,
        )
        .optional()
        .map_err(AppError::Database)

    })
}

#[instrument(skip(pool, input), fields(resource_type = %input.resource_type, resource_id = %input.resource_id))]
pub fn upsert_provenance(
    pool: &DbPool,
    input: CreateProvenanceInput,
) -> Result<ResourceProvenance, AppError> {
    timed_query!("exposure_scans", "exposure_scans::upsert_provenance", {
        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO resource_provenance (resource_type, resource_id, source_peer_id,
             source_display_name, bundle_hash, signature_verified)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(resource_type, resource_id) DO UPDATE SET
                source_peer_id = excluded.source_peer_id,
                source_display_name = excluded.source_display_name,
                bundle_hash = excluded.bundle_hash,
                signature_verified = excluded.signature_verified,
                imported_at = datetime('now')",
            params![
                input.resource_type,
                input.resource_id,
                input.source_peer_id,
                input.source_display_name,
                input.bundle_hash,
                input.signature_verified as i32,
            ],
        )?;
        get_provenance(pool, &input.resource_type, &input.resource_id)?
            .ok_or_else(|| AppError::Internal("Provenance upsert failed".into()))

    })
}

// -- Helpers -------------------------------------------------------------

use rusqlite::OptionalExtension;
