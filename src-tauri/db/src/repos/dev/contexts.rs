use crate::models::{
    ContextHealthSnapshot, DevContext, DevContextFingerprint, DevContextGroup,
    DevContextGroupRelationship,
};
use crate::DbPool;
use personas_core::error::AppError;
use rusqlite::{params, Row};
use std::collections::HashMap;

fn row_to_context_group(row: &Row) -> rusqlite::Result<DevContextGroup> {
    Ok(DevContextGroup {
        id: row.get("id")?,
        project_id: row.get("project_id")?,
        name: row.get("name")?,
        color: row.get("color")?,
        icon: row.get("icon")?,
        group_type: row.get("group_type")?,
        domain: row.get("domain").unwrap_or(None),
        position: row.get("position")?,
        health_score: row.get("health_score")?,
        last_scan_at: row.get("last_scan_at")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

fn row_to_context(row: &Row) -> rusqlite::Result<DevContext> {
    Ok(DevContext {
        id: row.get("id")?,
        project_id: row.get("project_id")?,
        group_id: row.get("group_id")?,
        name: row.get("name")?,
        description: row.get("description")?,
        file_paths: row.get("file_paths")?,
        entry_points: row.get("entry_points")?,
        db_tables: row.get("db_tables")?,
        keywords: row.get("keywords")?,
        api_surface: row.get("api_surface")?,
        cross_refs: row.get("cross_refs")?,
        tech_stack: row.get("tech_stack")?,
        category: row.get("category").unwrap_or(None),
        business_feature: row.get("business_feature").unwrap_or(None),
        pinned: row.get::<_, i64>("pinned").map(|v| v != 0).unwrap_or(false),
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

fn row_to_context_group_relationship(row: &Row) -> rusqlite::Result<DevContextGroupRelationship> {
    Ok(DevContextGroupRelationship {
        id: row.get("id")?,
        project_id: row.get("project_id")?,
        source_group_id: row.get("source_group_id")?,
        target_group_id: row.get("target_group_id")?,
        created_at: row.get("created_at")?,
    })
}

// ============================================================================
// Context Groups
// ============================================================================

pub fn list_context_groups(
    pool: &DbPool,
    project_id: &str,
) -> Result<Vec<DevContextGroup>, AppError> {
    timed_query!(
        "dev_context_groups",
        "dev_context_groups::list_context_groups",
        {
            let conn = pool.get()?;
            let mut stmt = conn.prepare(
                "SELECT * FROM dev_context_groups WHERE project_id = ?1 ORDER BY position",
            )?;
            let rows = stmt.query_map(params![project_id], row_to_context_group)?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(AppError::Database)
        }
    )
}

pub fn create_context_group(
    pool: &DbPool,
    project_id: &str,
    name: &str,
    color: Option<&str>,
    icon: Option<&str>,
    group_type: Option<&str>,
    domain: Option<&str>,
) -> Result<DevContextGroup, AppError> {
    if name.trim().is_empty() {
        return Err(AppError::Validation("Name cannot be empty".into()));
    }

    timed_query!(
        "dev_context_groups",
        "dev_context_groups::create_context_group",
        {
            let id = uuid::Uuid::new_v4().to_string();
            let now = chrono::Utc::now().to_rfc3339();
            let color = color.unwrap_or("#6366f1");

            let conn = pool.get()?;
            let max_pos: i32 = conn
            .query_row(
                "SELECT COALESCE(MAX(position), -1) FROM dev_context_groups WHERE project_id = ?1",
                params![project_id],
                |row| row.get(0),
            )
            .unwrap_or(-1);
            let position = max_pos + 1;

            conn.execute(
            "INSERT INTO dev_context_groups (id, project_id, name, color, icon, group_type, domain, position, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)",
            params![id, project_id, name, color, icon, group_type, domain, position, now],
        )?;

            conn.query_row(
                "SELECT * FROM dev_context_groups WHERE id = ?1",
                params![id],
                row_to_context_group,
            )
            .map_err(AppError::Database)
        }
    )
}

#[allow(clippy::too_many_arguments)]
pub fn update_context_group(
    pool: &DbPool,
    id: &str,
    name: Option<&str>,
    color: Option<&str>,
    icon: Option<Option<&str>>,
    group_type: Option<Option<&str>>,
    health_score: Option<Option<i32>>,
    last_scan_at: Option<Option<&str>>,
    domain: Option<Option<&str>>,
) -> Result<DevContextGroup, AppError> {
    timed_query!(
        "dev_context_groups",
        "dev_context_groups::update_context_group",
        {
            let now = chrono::Utc::now().to_rfc3339();
            let conn = pool.get()?;

            let mut sets: Vec<String> = vec!["updated_at = ?1".into()];
            let mut param_idx = 2u32;

            push_field!(name, "name", sets, param_idx);
            push_field!(color, "color", sets, param_idx);
            push_field!(icon, "icon", sets, param_idx);
            push_field!(group_type, "group_type", sets, param_idx);
            push_field!(health_score, "health_score", sets, param_idx);
            push_field!(last_scan_at, "last_scan_at", sets, param_idx);
            push_field!(domain, "domain", sets, param_idx);

            let sql = format!(
                "UPDATE dev_context_groups SET {} WHERE id = ?{}",
                sets.join(", "),
                param_idx
            );

            let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(now)];
            if let Some(v) = name {
                param_values.push(Box::new(v.to_string()));
            }
            if let Some(v) = color {
                param_values.push(Box::new(v.to_string()));
            }
            if let Some(v) = icon {
                param_values.push(Box::new(v.map(|s| s.to_string())));
            }
            if let Some(v) = group_type {
                param_values.push(Box::new(v.map(|s| s.to_string())));
            }
            if let Some(v) = health_score {
                param_values.push(Box::new(v));
            }
            if let Some(v) = last_scan_at {
                param_values.push(Box::new(v.map(|s| s.to_string())));
            }
            if let Some(v) = domain {
                param_values.push(Box::new(v.map(|s| s.to_string())));
            }
            param_values.push(Box::new(id.to_string()));

            let params_ref: Vec<&dyn rusqlite::types::ToSql> =
                param_values.iter().map(|p| p.as_ref()).collect();
            conn.execute(&sql, params_ref.as_slice())?;

            conn.query_row(
                "SELECT * FROM dev_context_groups WHERE id = ?1",
                params![id],
                row_to_context_group,
            )
            .map_err(AppError::Database)
        }
    )
}

pub fn delete_context_group(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    timed_query!(
        "dev_context_groups",
        "dev_context_groups::delete_context_group",
        {
            let conn = pool.get()?;
            let rows = conn.execute("DELETE FROM dev_context_groups WHERE id = ?1", params![id])?;
            Ok(rows > 0)
        }
    )
}

/// Delete all contexts, groups, and group relationships for a project.
/// Used before a rescan to start with a clean slate.
pub fn clear_project_context_map(
    pool: &DbPool,
    project_id: &str,
) -> Result<(usize, usize), AppError> {
    timed_query!(
        "dev_context_groups",
        "dev_context_groups::clear_project_context_map",
        {
            let conn = pool.get()?;
            // Canonical pins survive a full rescan: delete only unpinned
            // contexts. This is the fix for the documented near-miss where a
            // full rescan destroyed a hand-curated map.
            let ctx_rows = conn.execute(
                "DELETE FROM dev_contexts WHERE project_id = ?1 AND pinned = 0",
                params![project_id],
            )?;
            let rel_rows = conn.execute(
                "DELETE FROM dev_context_group_relationships WHERE project_id = ?1",
                params![project_id],
            );
            let _ = rel_rows; // ok if table is empty
                              // Delete only groups that no longer own any (surviving/pinned)
                              // context, so a pinned context keeps its group.
            let grp_rows = conn.execute(
                "DELETE FROM dev_context_groups WHERE project_id = ?1 \
                 AND id NOT IN (\
                   SELECT DISTINCT group_id FROM dev_contexts \
                   WHERE project_id = ?1 AND group_id IS NOT NULL\
                 )",
                params![project_id],
            )?;
            // The rescan recreates contexts under FRESH ids. dev_use_case_contexts
            // gets a name-based reconcile afterwards, but dev_ideas.context_id and
            // dev_goals.context_id have no FK and no reconcile — null the refs we
            // just made dangling instead of leaving them pointing at deleted rows.
            conn.execute(
                "UPDATE dev_ideas SET context_id = NULL
                  WHERE project_id = ?1 AND context_id IS NOT NULL
                    AND context_id NOT IN (SELECT id FROM dev_contexts WHERE project_id = ?1)",
                params![project_id],
            )?;
            conn.execute(
                "UPDATE dev_goals SET context_id = NULL
                  WHERE project_id = ?1 AND context_id IS NOT NULL
                    AND context_id NOT IN (SELECT id FROM dev_contexts WHERE project_id = ?1)",
                params![project_id],
            )?;
            Ok((grp_rows, ctx_rows))
        }
    )
}

/// Set (or clear) the canonical-pin flag on a single context. A pinned context
/// survives a full rescan's DELETE-and-recreate. Returns the updated row.
pub fn set_context_pinned(pool: &DbPool, id: &str, pinned: bool) -> Result<DevContext, AppError> {
    timed_query!("dev_contexts", "dev_contexts::set_context_pinned", {
        let conn = pool.get()?;
        let n = conn.execute(
            "UPDATE dev_contexts SET pinned = ?1, updated_at = ?2 WHERE id = ?3",
            params![pinned as i64, chrono::Utc::now().to_rfc3339(), id],
        )?;
        if n == 0 {
            return Err(AppError::NotFound(format!("Dev context {id}")));
        }
        get_context_by_id(pool, id)
    })
}

pub fn reorder_context_groups(pool: &DbPool, ids: &[String]) -> Result<(), AppError> {
    timed_query!(
        "dev_context_groups",
        "dev_context_groups::reorder_context_groups",
        {
            let conn = pool.get()?;
            for (i, id) in ids.iter().enumerate() {
                conn.execute(
                    "UPDATE dev_context_groups SET position = ?1, updated_at = ?2 WHERE id = ?3",
                    params![i as i32, chrono::Utc::now().to_rfc3339(), id],
                )?;
            }
            Ok(())
        }
    )
}

// ============================================================================
// Per-file content-hash cache (incremental rescan)
// ============================================================================

/// Return all cached file hashes for a project as a `{file_path: sha256}` map.
/// Populated by `commands/infrastructure/context_generation.rs` after a successful
/// scan; consumed by `commands/infrastructure/incremental_scan.rs` to compute
/// the delta {added, modified, deleted} against the live filesystem.
pub fn get_file_hashes(
    pool: &DbPool,
    project_id: &str,
) -> Result<HashMap<String, String>, AppError> {
    timed_query!(
        "dev_context_file_hashes",
        "dev_context_file_hashes::get_file_hashes",
        {
            let conn = pool.get()?;
            let mut stmt = conn.prepare(
                "SELECT file_path, sha256 FROM dev_context_file_hashes WHERE project_id = ?1",
            )?;
            let rows = stmt.query_map(params![project_id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?;
            let mut map = HashMap::new();
            for row in rows {
                let (path, sha) = row.map_err(AppError::Database)?;
                map.insert(path, sha);
            }
            Ok(map)
        }
    )
}

/// Replace the entire file-hash cache for a project in a single transaction.
/// Called after a successful scan so the next scan can compute a delta. The
/// caller passes the full live snapshot — anything not present is removed
/// (deleted files won't accumulate as stale rows).
pub fn replace_file_hashes(
    pool: &DbPool,
    project_id: &str,
    entries: &[(String, String, i64)], // (file_path, sha256, size_bytes)
) -> Result<usize, AppError> {
    timed_query!(
        "dev_context_file_hashes",
        "dev_context_file_hashes::replace_file_hashes",
        {
            let mut conn = pool.get()?;
            let tx = conn.transaction()?;
            tx.execute(
                "DELETE FROM dev_context_file_hashes WHERE project_id = ?1",
                params![project_id],
            )?;
            let now = chrono::Utc::now().to_rfc3339();
            let mut written = 0usize;
            {
                let mut stmt = tx.prepare(
                "INSERT INTO dev_context_file_hashes (project_id, file_path, sha256, size_bytes, last_extracted_at)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
            )?;
                for (path, sha, size) in entries {
                    stmt.execute(params![project_id, path, sha, size, now])?;
                    written += 1;
                }
            }
            tx.commit()?;
            Ok(written)
        }
    )
}

/// Drop all cached file hashes for a project (e.g. on project delete or a
/// "force full rescan" user action). Returns the number of rows removed.
pub fn clear_file_hashes(pool: &DbPool, project_id: &str) -> Result<usize, AppError> {
    timed_query!(
        "dev_context_file_hashes",
        "dev_context_file_hashes::clear_file_hashes",
        {
            let conn = pool.get()?;
            let n = conn.execute(
                "DELETE FROM dev_context_file_hashes WHERE project_id = ?1",
                params![project_id],
            )?;
            Ok(n)
        }
    )
}

// ============================================================================
// Per-context structural fingerprints (derived cache)
// ============================================================================
//
// A DERIVED cache alongside the context map — never a source of truth. Rows are
// keyed by `content_hash` (a hash over a context's file list plus each file's
// sha256), so a refresh can skip every context whose files are unchanged and
// answer later structural questions with SQL instead of file reads. See
// `personas_core::context_fingerprint` for what the counters do and don't mean.

fn row_to_context_fingerprint(row: &Row) -> rusqlite::Result<DevContextFingerprint> {
    Ok(DevContextFingerprint {
        project_id: row.get("project_id")?,
        context_id: row.get("context_id")?,
        content_hash: row.get("content_hash")?,
        file_count: row.get("file_count")?,
        missing_file_count: row.get("missing_file_count")?,
        imports: row.get("imports").unwrap_or(None),
        primitives: row.get("primitives").unwrap_or(None),
        promise_all_count: row.get("promise_all_count")?,
        join_all_count: row.get("join_all_count")?,
        await_count: row.get("await_count")?,
        sql_write_count: row.get("sql_write_count")?,
        spawn_count: row.get("spawn_count")?,
        use_effect_count: row.get("use_effect_count")?,
        set_state_after_await_count: row.get("set_state_after_await_count")?,
        exports_components: row.get::<_, i64>("exports_components")? != 0,
        exports_hooks: row.get::<_, i64>("exports_hooks")? != 0,
        exports_commands: row.get::<_, i64>("exports_commands")? != 0,
        exports_repo_fns: row.get::<_, i64>("exports_repo_fns")? != 0,
        computed_at: row.get("computed_at")?,
    })
}

/// Write (or replace) one context's fingerprint. Upsert on the
/// `(project_id, context_id)` primary key so a re-refresh overwrites in place
/// and the table can never accumulate duplicate rows per context.
pub fn upsert_context_fingerprint(
    pool: &DbPool,
    fp: &DevContextFingerprint,
) -> Result<(), AppError> {
    timed_query!(
        "dev_context_fingerprints",
        "dev_context_fingerprints::upsert_context_fingerprint",
        {
            let conn = pool.get()?;
            conn.execute(
                "INSERT INTO dev_context_fingerprints (
                    project_id, context_id, content_hash, file_count, missing_file_count,
                    imports, primitives,
                    promise_all_count, join_all_count, await_count, sql_write_count,
                    spawn_count, use_effect_count, set_state_after_await_count,
                    exports_components, exports_hooks, exports_commands, exports_repo_fns,
                    computed_at
                 ) VALUES (
                    ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14,
                    ?15, ?16, ?17, ?18, ?19
                 )
                 ON CONFLICT(project_id, context_id) DO UPDATE SET
                    content_hash = excluded.content_hash,
                    file_count = excluded.file_count,
                    missing_file_count = excluded.missing_file_count,
                    imports = excluded.imports,
                    primitives = excluded.primitives,
                    promise_all_count = excluded.promise_all_count,
                    join_all_count = excluded.join_all_count,
                    await_count = excluded.await_count,
                    sql_write_count = excluded.sql_write_count,
                    spawn_count = excluded.spawn_count,
                    use_effect_count = excluded.use_effect_count,
                    set_state_after_await_count = excluded.set_state_after_await_count,
                    exports_components = excluded.exports_components,
                    exports_hooks = excluded.exports_hooks,
                    exports_commands = excluded.exports_commands,
                    exports_repo_fns = excluded.exports_repo_fns,
                    computed_at = excluded.computed_at",
                params![
                    fp.project_id,
                    fp.context_id,
                    fp.content_hash,
                    fp.file_count,
                    fp.missing_file_count,
                    fp.imports,
                    fp.primitives,
                    fp.promise_all_count,
                    fp.join_all_count,
                    fp.await_count,
                    fp.sql_write_count,
                    fp.spawn_count,
                    fp.use_effect_count,
                    fp.set_state_after_await_count,
                    fp.exports_components as i32,
                    fp.exports_hooks as i32,
                    fp.exports_commands as i32,
                    fp.exports_repo_fns as i32,
                    fp.computed_at,
                ],
            )?;
            Ok(())
        }
    )
}

/// All cached fingerprints for a project, ordered by `context_id` so callers
/// get a stable listing.
pub fn list_context_fingerprints(
    pool: &DbPool,
    project_id: &str,
) -> Result<Vec<DevContextFingerprint>, AppError> {
    timed_query!(
        "dev_context_fingerprints",
        "dev_context_fingerprints::list_context_fingerprints",
        {
            let conn = pool.get()?;
            let mut stmt = conn.prepare(
                "SELECT * FROM dev_context_fingerprints WHERE project_id = ?1 ORDER BY context_id",
            )?;
            let rows = stmt.query_map(params![project_id], row_to_context_fingerprint)?;
            let mut out = Vec::new();
            for row in rows {
                out.push(row.map_err(AppError::Database)?);
            }
            Ok(out)
        }
    )
}

/// `{context_id: content_hash}` for a project — the skip-logic input. Reads only
/// the two columns it needs so a refresh can decide what is dirty without
/// materializing every fingerprint.
pub fn get_context_fingerprint_hashes(
    pool: &DbPool,
    project_id: &str,
) -> Result<HashMap<String, String>, AppError> {
    timed_query!(
        "dev_context_fingerprints",
        "dev_context_fingerprints::get_context_fingerprint_hashes",
        {
            let conn = pool.get()?;
            let mut stmt = conn.prepare(
                "SELECT context_id, content_hash FROM dev_context_fingerprints
                 WHERE project_id = ?1",
            )?;
            let rows = stmt.query_map(params![project_id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?;
            let mut map = HashMap::new();
            for row in rows {
                let (context_id, hash) = row.map_err(AppError::Database)?;
                map.insert(context_id, hash);
            }
            Ok(map)
        }
    )
}

// ============================================================================
// Contexts
// ============================================================================

pub fn list_contexts_by_project(
    pool: &DbPool,
    project_id: &str,
    group_id: Option<&str>,
) -> Result<Vec<DevContext>, AppError> {
    timed_query!("dev_contexts", "dev_contexts::list_contexts_by_project", {
        let conn = pool.get()?;
        if let Some(group_id) = group_id {
            let mut stmt = conn.prepare(
                "SELECT * FROM dev_contexts WHERE project_id = ?1 AND group_id = ?2 ORDER BY name",
            )?;
            let rows = stmt.query_map(params![project_id, group_id], row_to_context)?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(AppError::Database)
        } else {
            let mut stmt =
                conn.prepare("SELECT * FROM dev_contexts WHERE project_id = ?1 ORDER BY name")?;
            let rows = stmt.query_map(params![project_id], row_to_context)?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(AppError::Database)
        }
    })
}

pub fn get_context_by_id(pool: &DbPool, id: &str) -> Result<DevContext, AppError> {
    timed_query!("dev_contexts", "dev_contexts::get_context_by_id", {
        let conn = pool.get()?;
        conn.query_row(
            "SELECT * FROM dev_contexts WHERE id = ?1",
            params![id],
            row_to_context,
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => AppError::NotFound(format!("Dev context {id}")),
            other => AppError::Database(other),
        })
    })
}

#[allow(clippy::too_many_arguments)]
pub fn create_context(
    pool: &DbPool,
    project_id: &str,
    name: &str,
    group_id: Option<&str>,
    description: Option<&str>,
    file_paths: Option<&str>,
    entry_points: Option<&str>,
    db_tables: Option<&str>,
    keywords: Option<&str>,
    api_surface: Option<&str>,
    cross_refs: Option<&str>,
    tech_stack: Option<&str>,
    category: Option<&str>,
    business_feature: Option<&str>,
) -> Result<DevContext, AppError> {
    if name.trim().is_empty() {
        return Err(AppError::Validation("Name cannot be empty".into()));
    }

    timed_query!("dev_contexts", "dev_contexts::create_context", {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let file_paths = file_paths.unwrap_or("[]");

        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO dev_contexts (id, project_id, group_id, name, description, file_paths, entry_points, db_tables, keywords, api_surface, cross_refs, tech_stack, category, business_feature, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?15)",
            params![id, project_id, group_id, name, description, file_paths, entry_points, db_tables, keywords, api_surface, cross_refs, tech_stack, category, business_feature, now],
        )?;

        get_context_by_id(pool, &id)
    })
}

#[allow(clippy::too_many_arguments)]
pub fn update_context(
    pool: &DbPool,
    id: &str,
    name: Option<&str>,
    description: Option<Option<&str>>,
    file_paths: Option<&str>,
    entry_points: Option<Option<&str>>,
    db_tables: Option<Option<&str>>,
    keywords: Option<Option<&str>>,
    api_surface: Option<Option<&str>>,
    cross_refs: Option<Option<&str>>,
    tech_stack: Option<Option<&str>>,
    category: Option<Option<&str>>,
    business_feature: Option<Option<&str>>,
) -> Result<DevContext, AppError> {
    timed_query!("dev_contexts", "dev_contexts::update_context", {
        get_context_by_id(pool, id)?;
        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;

        let mut sets: Vec<String> = vec!["updated_at = ?1".into()];
        let mut param_idx = 2u32;

        push_field!(name, "name", sets, param_idx);
        push_field!(description, "description", sets, param_idx);
        push_field!(file_paths, "file_paths", sets, param_idx);
        push_field!(entry_points, "entry_points", sets, param_idx);
        push_field!(db_tables, "db_tables", sets, param_idx);
        push_field!(keywords, "keywords", sets, param_idx);
        push_field!(api_surface, "api_surface", sets, param_idx);
        push_field!(cross_refs, "cross_refs", sets, param_idx);
        push_field!(tech_stack, "tech_stack", sets, param_idx);
        push_field!(category, "category", sets, param_idx);
        push_field!(business_feature, "business_feature", sets, param_idx);

        let sql = format!(
            "UPDATE dev_contexts SET {} WHERE id = ?{}",
            sets.join(", "),
            param_idx
        );

        let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(now)];
        if let Some(v) = name {
            param_values.push(Box::new(v.to_string()));
        }
        if let Some(v) = description {
            param_values.push(Box::new(v.map(|s| s.to_string())));
        }
        if let Some(v) = file_paths {
            param_values.push(Box::new(v.to_string()));
        }
        if let Some(v) = entry_points {
            param_values.push(Box::new(v.map(|s| s.to_string())));
        }
        if let Some(v) = db_tables {
            param_values.push(Box::new(v.map(|s| s.to_string())));
        }
        if let Some(v) = keywords {
            param_values.push(Box::new(v.map(|s| s.to_string())));
        }
        if let Some(v) = api_surface {
            param_values.push(Box::new(v.map(|s| s.to_string())));
        }
        if let Some(v) = cross_refs {
            param_values.push(Box::new(v.map(|s| s.to_string())));
        }
        if let Some(v) = tech_stack {
            param_values.push(Box::new(v.map(|s| s.to_string())));
        }
        if let Some(v) = category {
            param_values.push(Box::new(v.map(|s| s.to_string())));
        }
        if let Some(v) = business_feature {
            param_values.push(Box::new(v.map(|s| s.to_string())));
        }
        param_values.push(Box::new(id.to_string()));

        let params_ref: Vec<&dyn rusqlite::types::ToSql> =
            param_values.iter().map(|p| p.as_ref()).collect();
        conn.execute(&sql, params_ref.as_slice())?;

        get_context_by_id(pool, id)
    })
}

pub fn delete_context(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    timed_query!("dev_contexts", "dev_contexts::delete_context", {
        let conn = pool.get()?;
        let rows = conn.execute("DELETE FROM dev_contexts WHERE id = ?1", params![id])?;
        Ok(rows > 0)
    })
}

pub fn move_context_to_group(
    pool: &DbPool,
    id: &str,
    group_id: Option<&str>,
) -> Result<DevContext, AppError> {
    timed_query!("dev_contexts", "dev_contexts::move_context_to_group", {
        // Fetch the context first so a non-existent id fails loudly (NotFound)
        // rather than the UPDATE silently affecting 0 rows and reporting success.
        let ctx = get_context_by_id(pool, id)?;

        let conn = pool.get()?;
        // Validate the target group exists AND belongs to the same project. The
        // group_id FK (ON DELETE SET NULL) doesn't guarantee per-connection FK
        // enforcement is enabled, and never enforces same-project — so without
        // this a context could be silently moved into a non-existent group or a
        // group from another project, orphaning its grouping.
        if let Some(gid) = group_id {
            let ok: bool = conn
                .query_row(
                    "SELECT COUNT(*) FROM dev_context_groups WHERE id = ?1 AND project_id = ?2",
                    params![gid, ctx.project_id],
                    |r| r.get::<_, i64>(0),
                )
                .map(|c| c > 0)
                .unwrap_or(false);
            if !ok {
                return Err(AppError::Validation(format!(
                    "Group {gid} does not exist in project {}",
                    ctx.project_id
                )));
            }
        }

        let now = chrono::Utc::now().to_rfc3339();
        let rows = conn.execute(
            "UPDATE dev_contexts SET group_id = ?1, updated_at = ?2 WHERE id = ?3",
            params![group_id, now, id],
        )?;
        if rows == 0 {
            // Context vanished between the fetch and the UPDATE (concurrent delete).
            return Err(AppError::NotFound(format!("Dev context {id}")));
        }
        get_context_by_id(pool, id)
    })
}

/// Walk `root_path`, discover top-level directories containing source files,
/// and create one `DevContext` per directory.  Returns all newly-created contexts.
pub fn scan_codebase(
    pool: &DbPool,
    project_id: &str,
    root_path: &str,
) -> Result<Vec<DevContext>, AppError> {
    timed_query!("dev_contexts", "dev_contexts::scan_codebase", {
        use std::collections::BTreeMap;
        use std::path::Path;

        let root = Path::new(root_path).canonicalize().map_err(|e| {
            AppError::Validation(format!("Cannot resolve root path '{}': {}", root_path, e))
        })?;

        // Collect files grouped by their first sub-directory under root.
        let mut groups: BTreeMap<String, Vec<String>> = BTreeMap::new();

        let source_exts: &[&str] = &[
            "rs", "ts", "tsx", "js", "jsx", "py", "go", "java", "rb", "css", "scss", "html", "vue",
            "svelte", "json", "toml", "yaml", "yml", "sql", "sh",
        ];

        fn visit_dir(
            dir: &Path,
            root: &Path,
            source_exts: &[&str],
            groups: &mut BTreeMap<String, Vec<String>>,
        ) {
            let entries = match std::fs::read_dir(dir) {
                Ok(e) => e,
                Err(_) => return,
            };

            for entry in entries.flatten() {
                let path = entry.path();
                let name = entry.file_name().to_string_lossy().to_string();

                // Skip hidden dirs and common non-source directories.
                if name.starts_with('.')
                    || name == "node_modules"
                    || name == "target"
                    || name == "dist"
                    || name == "build"
                {
                    continue;
                }

                if path.is_dir() {
                    visit_dir(&path, root, source_exts, groups);
                } else if path.is_file() {
                    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
                    if source_exts.contains(&ext) {
                        // Key = first sub-directory under root, or "_root" for files directly in root.
                        let rel = path.strip_prefix(root).unwrap_or(&path);
                        let key = rel
                            .components()
                            .next()
                            .and_then(|c| {
                                let s = c.as_os_str().to_string_lossy().to_string();
                                // If the first component IS the file itself, it's a root-level file.
                                if rel.components().count() <= 1 {
                                    None
                                } else {
                                    Some(s)
                                }
                            })
                            .unwrap_or_else(|| "_root".to_string());

                        let rel_str = rel.to_string_lossy().replace('\\', "/");
                        groups.entry(key).or_default().push(rel_str);
                    }
                }
            }
        }

        visit_dir(&root, &root, source_exts, &mut groups);

        let mut created: Vec<DevContext> = Vec::new();
        for (dir_name, files) in &groups {
            let context_name = if dir_name == "_root" {
                "Root Files".to_string()
            } else {
                dir_name.clone()
            };

            let file_paths_json = serde_json::to_string(files).unwrap_or_else(|_| "[]".into());
            let description = Some(format!("{} source files", files.len()));

            let ctx = create_context(
                pool,
                project_id,
                &context_name,
                None,
                description.as_deref(),
                Some(&file_paths_json),
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                None,
            )?;
            created.push(ctx);
        }

        Ok(created)
    })
}

// ============================================================================
// Context Group Relationships
// ============================================================================

pub fn list_context_group_relationships(
    pool: &DbPool,
    project_id: &str,
) -> Result<Vec<DevContextGroupRelationship>, AppError> {
    timed_query!(
        "dev_context_group_relationships",
        "dev_context_group_relationships::list",
        {
            let conn = pool.get()?;
            let mut stmt = conn.prepare(
            "SELECT * FROM dev_context_group_relationships WHERE project_id = ?1 ORDER BY created_at",
        )?;
            let rows = stmt.query_map(params![project_id], row_to_context_group_relationship)?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(AppError::Database)
        }
    )
}

pub fn create_context_group_relationship(
    pool: &DbPool,
    project_id: &str,
    source_group_id: &str,
    target_group_id: &str,
) -> Result<DevContextGroupRelationship, AppError> {
    timed_query!(
        "dev_context_group_relationships",
        "dev_context_group_relationships::create",
        {
            let id = uuid::Uuid::new_v4().to_string();
            let now = chrono::Utc::now().to_rfc3339();

            let conn = pool.get()?;
            conn.execute(
            "INSERT INTO dev_context_group_relationships (id, project_id, source_group_id, target_group_id, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![id, project_id, source_group_id, target_group_id, now],
        )?;

            conn.query_row(
                "SELECT * FROM dev_context_group_relationships WHERE id = ?1",
                params![id],
                row_to_context_group_relationship,
            )
            .map_err(AppError::Database)
        }
    )
}

pub fn delete_context_group_relationship(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    timed_query!(
        "dev_context_group_relationships",
        "dev_context_group_relationships::delete",
        {
            let conn = pool.get()?;
            let rows = conn.execute(
                "DELETE FROM dev_context_group_relationships WHERE id = ?1",
                params![id],
            )?;
            Ok(rows > 0)
        }
    )
}

// ============================================================================
// Context Health Snapshots
// ============================================================================

fn row_to_health_snapshot(row: &Row) -> rusqlite::Result<ContextHealthSnapshot> {
    Ok(ContextHealthSnapshot {
        id: row.get("id")?,
        project_id: row.get("project_id")?,
        group_id: row.get("group_id")?,
        group_name: row.get("group_name")?,
        overall_score: row.get("overall_score")?,
        security_score: row.get("security_score")?,
        quality_score: row.get("quality_score")?,
        coverage_score: row.get("coverage_score")?,
        debt_score: row.get("debt_score")?,
        issues_found: row.get("issues_found")?,
        issues_json: row.get("issues_json")?,
        recommendations: row.get("recommendations")?,
        scanned_at: row.get("scanned_at")?,
    })
}

pub fn insert_health_snapshot(
    pool: &DbPool,
    snap: &ContextHealthSnapshot,
) -> Result<ContextHealthSnapshot, AppError> {
    timed_query!(
        "context_health_snapshots",
        "context_health_snapshots::insert",
        {
            let conn = pool.get()?;
            conn.execute(
            "INSERT INTO context_health_snapshots (id, project_id, group_id, group_name, overall_score, security_score, quality_score, coverage_score, debt_score, issues_found, issues_json, recommendations, scanned_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            params![
                snap.id, snap.project_id, snap.group_id, snap.group_name,
                snap.overall_score, snap.security_score, snap.quality_score,
                snap.coverage_score, snap.debt_score, snap.issues_found,
                snap.issues_json, snap.recommendations, snap.scanned_at,
            ],
        )?;
            get_health_snapshot_by_id(pool, &snap.id)
        }
    )
}

pub fn get_health_snapshot_by_id(
    pool: &DbPool,
    id: &str,
) -> Result<ContextHealthSnapshot, AppError> {
    timed_query!(
        "context_health_snapshots",
        "context_health_snapshots::get_by_id",
        {
            let conn = pool.get()?;
            conn.query_row(
                "SELECT * FROM context_health_snapshots WHERE id = ?1",
                params![id],
                row_to_health_snapshot,
            )
            .map_err(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => {
                    AppError::NotFound(format!("Health snapshot not found: {id}"))
                }
                other => AppError::from(other),
            })
        }
    )
}

pub fn list_health_snapshots(
    pool: &DbPool,
    project_id: &str,
    limit: Option<i32>,
) -> Result<Vec<ContextHealthSnapshot>, AppError> {
    timed_query!(
        "context_health_snapshots",
        "context_health_snapshots::list",
        {
            let conn = pool.get()?;
            let lim = limit.unwrap_or(50);
            let mut stmt = conn.prepare(
            "SELECT * FROM context_health_snapshots WHERE project_id = ?1 ORDER BY scanned_at DESC LIMIT ?2"
        )?;
            let rows = stmt.query_map(params![project_id, lim], row_to_health_snapshot)?;
            rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
        }
    )
}
