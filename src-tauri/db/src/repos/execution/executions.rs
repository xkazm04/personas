use rusqlite::{params, Row};

use crate::models::{
    ExecutionCounts, ExecutionListItem, ExecutionSearchResult, GlobalExecutionRow,
    PersonaExecution, UpdateExecutionStatus,
};
use crate::DbPool;
use crate::PoolExt;
use personas_core::error::AppError;
use personas_core::types::ExecutionState;

/// Recipe provenance stamped onto an execution at insert time:
/// `(source_recipe_id, source_recipe_version)`.
type RecipeProvenance = (Option<String>, Option<String>);

/// Resolve which recipe (if any) is behind a run, from the persona's existing
/// `design_context.useCases[]` provenance.
///
/// Adopting a capability from the catalog stamps `source_recipe_id` onto the
/// use case (and the promote/Foundry path also pins `source_recipe_version`).
/// That provenance is READ here and copied onto the execution row — there is
/// deliberately no new write path into `design_context`, which is a JSON TEXT
/// column mutated through a queued mutator.
///
/// Denormalizing rather than joining live is the point: detaching a capability
/// deletes the use case, and a live join would then silently rewrite the
/// history of every run it produced. Returns `(None, None)` for any run with no
/// use case, no persona row, unparseable context, or a use case that was not
/// adopted from a recipe. NULL is the honest answer — never a sentinel.
///
/// Best-effort by construction: a failure to resolve provenance must never fail
/// the execution insert.
fn resolve_recipe_provenance(
    conn: &rusqlite::Connection,
    persona_id: &str,
    use_case_id: Option<&str>,
) -> RecipeProvenance {
    let Some(use_case_id) = use_case_id else {
        return (None, None);
    };
    let design_context: Option<String> = conn
        .query_row(
            "SELECT design_context FROM personas WHERE id = ?1",
            params![persona_id],
            |row| row.get("design_context"),
        )
        .ok()
        .flatten();
    let Some(raw) = design_context else {
        return (None, None);
    };
    let Ok(ctx) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return (None, None);
    };
    let Some(use_cases) = ctx.get("useCases").and_then(|v| v.as_array()) else {
        return (None, None);
    };
    let Some(uc) = use_cases
        .iter()
        .find(|uc| uc.get("id").and_then(|v| v.as_str()) == Some(use_case_id))
    else {
        return (None, None);
    };
    let str_field = |key: &str| {
        uc.get(key)
            .and_then(|v| v.as_str())
            .filter(|s| !s.trim().is_empty())
            .map(str::to_string)
    };
    match str_field("source_recipe_id") {
        // Only pin a version alongside a real recipe id — a version with
        // nothing to version is noise.
        Some(recipe_id) => (Some(recipe_id), str_field("source_recipe_version")),
        None => (None, None),
    }
}

/// One projection for every full-row read of `persona_executions`, in the
/// order `row_to_execution` below consumes it.
///
/// Checked against `migrations/schema.rs:109` for the base table and against
/// every `ALTER TABLE persona_executions ADD COLUMN` in `migrations/` for the
/// rest — `thinking_level`, `cache_read_tokens`, `cache_creation_tokens`,
/// `tool_steps`, `retry_of_execution_id`, `retry_count`, `use_case_id`,
/// `is_simulation`, `business_outcome`, `director_score`,
/// `director_review_md`, `execution_config` and `log_truncated` exist ONLY by
/// ALTER, so no single DDL block lists this table's real shape.
///
/// It is deliberately NOT every column: `traceparent`, `idempotency_key`,
/// `last_heartbeat_at`, `claimed_by_instance`, `claim_expires_at`,
/// `source_recipe_id` and `source_recipe_version` are written here and read
/// elsewhere, and a wildcard was fetching all seven on every list page.
const COLUMNS: &str = "id, persona_id, trigger_id, use_case_id, status, input_data, \
     output_data, claude_session_id, log_file_path, execution_flows, model_used, \
     thinking_level, input_tokens, output_tokens, cost_usd, cache_read_tokens, \
     cache_creation_tokens, error_message, duration_ms, tool_steps, \
     retry_of_execution_id, retry_count, started_at, completed_at, created_at, \
     execution_config, log_truncated, is_simulation, business_outcome, \
     director_score, director_review_md";

/// The lighter projection behind `row_to_execution_list_item`. Kept separate
/// on purpose: the list page does not need input_data / output_data / the log
/// paths, and this is the shape whose sixteenth column went missing for three
/// months (see `list_items_projection_covers_every_field_the_mapper_reads`).
const LIST_ITEM_COLUMNS: &str = "id, persona_id, use_case_id, status, input_tokens, \
     output_tokens, cost_usd, error_message, duration_ms, retry_of_execution_id, \
     retry_count, started_at, completed_at, created_at, is_simulation, business_outcome";

/// `COLUMNS` with every name qualified by a table alias, for the joins that
/// used to project `e.*`. Derived from the one const rather than duplicated,
/// so the two can never drift.
fn columns_for(alias: &str) -> String {
    COLUMNS
        .split(',')
        .map(|c| format!("{alias}.{}", c.trim()))
        .collect::<Vec<_>>()
        .join(", ")
}

fn row_to_execution(row: &Row) -> rusqlite::Result<PersonaExecution> {
    Ok(PersonaExecution {
        id: row.get("id")?,
        persona_id: row.get("persona_id")?,
        trigger_id: row.get("trigger_id")?,
        use_case_id: row.get("use_case_id")?,
        status: row.get("status")?,
        input_data: row.get("input_data")?,
        output_data: row.get("output_data")?,
        claude_session_id: row.get("claude_session_id")?,
        log_file_path: row.get("log_file_path")?,
        execution_flows: row.get("execution_flows")?,
        model_used: row.get("model_used")?,
        thinking_level: row.get("thinking_level").unwrap_or(None),
        input_tokens: row.get::<_, Option<i64>>("input_tokens")?.unwrap_or(0),
        output_tokens: row.get::<_, Option<i64>>("output_tokens")?.unwrap_or(0),
        cost_usd: row.get::<_, Option<f64>>("cost_usd")?.unwrap_or(0.0),
        cache_read_tokens: row.get::<_, Option<i64>>("cache_read_tokens")?.unwrap_or(0),
        cache_creation_tokens: row
            .get::<_, Option<i64>>("cache_creation_tokens")?
            .unwrap_or(0),
        error_message: row.get("error_message")?,
        duration_ms: row.get("duration_ms")?,
        tool_steps: row.get("tool_steps")?,
        retry_of_execution_id: row.get("retry_of_execution_id")?,
        retry_count: row.get::<_, Option<i64>>("retry_count")?.unwrap_or(0),
        started_at: row.get("started_at")?,
        completed_at: row.get("completed_at")?,
        created_at: row.get("created_at")?,
        execution_config: row.get("execution_config").unwrap_or(None),
        log_truncated: row
            .get::<_, Option<bool>>("log_truncated")?
            .unwrap_or(false),
        is_simulation: row
            .get::<_, Option<bool>>("is_simulation")?
            .unwrap_or(false),
        business_outcome: row
            .get::<_, Option<String>>("business_outcome")?
            .unwrap_or_else(|| "unknown".to_string()),
        director_score: row.get::<_, Option<i64>>("director_score").unwrap_or(None),
        director_review_md: row
            .get::<_, Option<String>>("director_review_md")
            .unwrap_or(None),
    })
}

fn row_to_execution_list_item(row: &Row) -> rusqlite::Result<ExecutionListItem> {
    Ok(ExecutionListItem {
        id: row.get("id")?,
        persona_id: row.get("persona_id")?,
        use_case_id: row.get("use_case_id")?,
        status: row.get("status")?,
        input_tokens: row.get::<_, Option<i64>>("input_tokens")?.unwrap_or(0),
        output_tokens: row.get::<_, Option<i64>>("output_tokens")?.unwrap_or(0),
        cost_usd: row.get::<_, Option<f64>>("cost_usd")?.unwrap_or(0.0),
        error_message: row.get("error_message")?,
        duration_ms: row.get("duration_ms")?,
        retry_of_execution_id: row.get("retry_of_execution_id")?,
        retry_count: row.get::<_, Option<i64>>("retry_count")?.unwrap_or(0),
        started_at: row.get("started_at")?,
        completed_at: row.get("completed_at")?,
        created_at: row.get("created_at")?,
        is_simulation: row
            .get::<_, Option<bool>>("is_simulation")?
            .unwrap_or(false),
        business_outcome: row
            .get::<_, Option<String>>("business_outcome")?
            .unwrap_or_else(|| "unknown".to_string()),
    })
}

/// Write the Director's review result (0-5 score + rendered markdown) onto an
/// execution row. Called after the Director reviews that execution.
pub fn set_director_review(
    pool: &DbPool,
    execution_id: &str,
    score: i64,
    review_md: &str,
) -> Result<(), AppError> {
    let conn = pool.conn("executions::set_director_review")?;
    conn.execute(
        "UPDATE persona_executions SET director_score = ?1, director_review_md = ?2 WHERE id = ?3",
        rusqlite::params![score, review_md, execution_id],
    )?;
    Ok(())
}

/// Write an *unscored* Director review marker onto an execution row: the rendered
/// markdown is stored but `director_score` is left NULL. Used by the Director's
/// missing-score salvage path when the model omits the mandatory DIRECTOR_SCORE
/// line and a bounded re-prompt still fails to recover it — so the review is
/// visible ("unscored review") rather than silently dropped. Never overwrites an
/// existing score.
pub fn set_director_review_unscored(
    pool: &DbPool,
    execution_id: &str,
    review_md: &str,
) -> Result<(), AppError> {
    let conn = pool.conn("executions::set_director_review_unscored")?;
    conn.execute(
        "UPDATE persona_executions SET director_review_md = ?1 WHERE id = ?2",
        rusqlite::params![review_md, execution_id],
    )?;
    Ok(())
}

fn build_fts5_query(query: &str) -> String {
    query
        .split(|c: char| !c.is_alphanumeric())
        .filter(|token| token.len() >= 2)
        .take(12)
        .map(|token| format!("\"{}\"", token.replace('"', "\"\"")))
        .collect::<Vec<_>>()
        .join(" OR ")
}

pub fn get_by_persona_id(
    pool: &DbPool,
    persona_id: &str,
    limit: Option<i64>,
) -> Result<Vec<PersonaExecution>, AppError> {
    timed_query!(
        "persona_executions",
        "persona_executions::get_by_persona_id",
        {
            let limit = limit.unwrap_or(50);
            let conn = pool.conn("executions::get_by_persona_id")?;
            // Exclude ops chat executions (input_data contains "_ops") — those are
            // conversational queries from the Chat tab, not real agent executions.
            let mut stmt = conn.prepare_cached(&format!(
                "SELECT {COLUMNS} FROM persona_executions
             WHERE persona_id = ?1
               AND (input_data IS NULL OR input_data NOT LIKE '%\"_ops\"%')
             ORDER BY created_at DESC LIMIT ?2",
            ))?;
            let rows = stmt.query_map(params![persona_id, limit], row_to_execution)?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(AppError::Database)
        }
    )
}

pub fn list_items_by_persona_id(
    pool: &DbPool,
    persona_id: &str,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<Vec<ExecutionListItem>, AppError> {
    timed_query!(
        "persona_executions",
        "persona_executions::list_items_by_persona_id",
        {
            let limit = limit.unwrap_or(50);
            // Default offset 0 preserves the original single-page behavior for
            // existing callers that don't paginate.
            let offset = offset.unwrap_or(0).max(0);
            let conn = pool.conn("executions::list_items_by_persona_id")?;
            let mut stmt = conn.prepare_cached(&format!(
                "SELECT {LIST_ITEM_COLUMNS}
             FROM persona_executions
             WHERE persona_id = ?1
               AND (input_data IS NULL OR input_data NOT LIKE '%\"_ops\"%')
             ORDER BY created_at DESC LIMIT ?2 OFFSET ?3",
            ))?;
            let rows = stmt.query_map(
                params![persona_id, limit, offset],
                row_to_execution_list_item,
            )?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(AppError::Database)
        }
    )
}

/// Fetch executions across all personas in a single query with persona metadata.
/// Replaces the N+1 pattern of calling get_by_persona_id once per persona.
///
/// `since` is an optional RFC3339 lower bound on `created_at` (caller-supplied,
/// e.g. a rolling 30-day cutoff). It is a parameter rather than a hardcoded
/// constant because `get_all_global` also backs the management HTTP API
/// (`engine::management_api::list_executions`), which legitimately wants the
/// full unfiltered history — that caller passes `None`.
pub fn get_all_global(
    pool: &DbPool,
    limit: Option<i64>,
    status: Option<&str>,
    persona_id: Option<&str>,
    since: Option<&str>,
) -> Result<Vec<GlobalExecutionRow>, AppError> {
    timed_query!(
        "persona_executions",
        "persona_executions::get_all_global",
        {
            let limit = limit.unwrap_or(200);
            let conn = pool.conn("executions::get_all_global")?;

            // `e.*` fetched every column of the table including the seven
            // this mapper never reads; the qualified list is derived from
            // COLUMNS so it cannot drift from `row_to_execution`.
            let base = format!(
                "SELECT {}, \
                COALESCE(p.name, 'Unknown') as persona_name, \
                p.icon as persona_icon, \
                p.color as persona_color \
             FROM persona_executions e \
             LEFT JOIN personas p ON p.id = e.persona_id",
                columns_for("e")
            );

            let mut qb = crate::query_builder::QueryBuilder::new();

            // Exclude ops chat executions from all execution lists
            qb.where_raw(
                |_| "(e.input_data IS NULL OR e.input_data NOT LIKE '%\"_ops\"%')".to_string(),
                vec![],
            );
            if let Some(s) = status {
                qb.where_eq("e.status", s.to_string());
            }
            if let Some(pid) = persona_id {
                qb.where_eq("e.persona_id", pid.to_string());
            }
            if let Some(cutoff) = since {
                qb.where_gte("e.created_at", cutoff.to_string());
            }
            qb.order_by("e.created_at", "DESC");
            qb.limit(limit);

            let sql = qb.build_select(&base);
            let mut stmt = conn.prepare_cached(&sql)?;

            let row_mapper = |row: &Row| -> rusqlite::Result<GlobalExecutionRow> {
                Ok(GlobalExecutionRow {
                    base: row_to_execution(row)?,
                    persona_name: row.get("persona_name")?,
                    persona_icon: row.get("persona_icon")?,
                    persona_color: row.get("persona_color")?,
                })
            };

            let rows = stmt.query_map(qb.params_ref().as_slice(), row_mapper)?;

            rows.collect::<Result<Vec<_>, _>>()
                .map_err(AppError::Database)
        }
    )
}

/// Aggregate execution counts by high-level status bucket, optionally
/// filtered to a single persona. Returns precise server-side totals so the
/// Activity filter badges do not depend on how many rows have been paged in.
pub fn count_all_global(
    pool: &DbPool,
    persona_id: Option<&str>,
) -> Result<ExecutionCounts, AppError> {
    timed_query!(
        "persona_executions",
        "persona_executions::count_all_global",
        {
            let conn = pool.conn("executions::count_all_global")?;
            let mut sql = String::from(
                "SELECT status, COUNT(*) AS n FROM persona_executions \
             WHERE (input_data IS NULL OR input_data NOT LIKE '%\"_ops\"%')",
            );
            if persona_id.is_some() {
                sql.push_str(" AND persona_id = ?1");
            }
            sql.push_str(" GROUP BY status");

            let mut stmt = conn.prepare_cached(&sql)?;
            let mut counts = ExecutionCounts::default();
            let map_row = |row: &Row| -> rusqlite::Result<(String, i64)> {
                Ok((row.get::<_, String>("status")?, row.get::<_, i64>("n")?))
            };

            let iter: Box<dyn Iterator<Item = rusqlite::Result<(String, i64)>>> =
                if let Some(pid) = persona_id {
                    Box::new(stmt.query_map(params![pid], map_row)?)
                } else {
                    Box::new(stmt.query_map([], map_row)?)
                };

            for row in iter {
                let (status, n) = row.map_err(AppError::Database)?;
                counts.total += n;
                match status.as_str() {
                    // `queued` is the canonical pre-start status every other
                    // query in this repo treats as in-flight (`get_running`,
                    // `has_running_executions`, `get_running_count_for_persona`
                    // all use `IN ('queued','running')`). `pending` is only the
                    // legacy alias kept for old rows (see
                    // `ExecutionState`'s alias table). Omitting `queued` here
                    // made the Activity "Running" badge silently under-count
                    // every execution that had not started yet.
                    "running" | "queued" | "pending" => counts.running += n,
                    "completed" => counts.completed += n,
                    "failed" => counts.failed += n,
                    _ => {}
                }
            }
            Ok(counts)
        }
    )
}

pub fn search(
    pool: &DbPool,
    query: &str,
    limit: Option<i64>,
    persona_id: Option<&str>,
) -> Result<Vec<ExecutionSearchResult>, AppError> {
    timed_query!("persona_executions", "persona_executions::search", {
        let fts_query = build_fts5_query(query);
        if fts_query.is_empty() {
            return Ok(Vec::new());
        }

        let limit = limit.unwrap_or(50).clamp(1, 200);
        let conn = pool.conn("executions::search")?;
        let mut sql = String::from(
            "SELECT e.id,
                    e.persona_id,
                    p.name AS persona_name,
                    p.icon AS persona_icon,
                    p.color AS persona_color,
                    e.use_case_id,
                    e.status,
                    snippet(executions_fts, -1, '<mark>', '</mark>', '...', 18) AS excerpt,
                    e.created_at,
                    e.completed_at
             FROM executions_fts
             JOIN persona_executions e ON e.rowid = executions_fts.rowid
             LEFT JOIN personas p ON p.id = e.persona_id
             WHERE executions_fts MATCH ?1
               AND (e.input_data IS NULL OR e.input_data NOT LIKE '%\"_ops\"%')",
        );
        if persona_id.is_some() {
            sql.push_str(" AND e.persona_id = ?2");
            sql.push_str(" ORDER BY bm25(executions_fts) ASC, e.created_at DESC LIMIT ?3");
        } else {
            sql.push_str(" ORDER BY bm25(executions_fts) ASC, e.created_at DESC LIMIT ?2");
        }

        let mut stmt = conn.prepare_cached(&sql)?;
        let mut rows = if let Some(persona_id) = persona_id {
            stmt.query(params![fts_query, persona_id, limit])?
        } else {
            stmt.query(params![fts_query, limit])?
        };

        let mut results = Vec::new();
        while let Some(row) = rows.next()? {
            results.push(ExecutionSearchResult {
                id: row.get("id")?,
                persona_id: row.get("persona_id")?,
                persona_name: row.get("persona_name")?,
                persona_icon: row.get("persona_icon")?,
                persona_color: row.get("persona_color")?,
                use_case_id: row.get("use_case_id")?,
                status: row.get("status")?,
                excerpt: row.get("excerpt")?,
                created_at: row.get("created_at")?,
                completed_at: row.get("completed_at")?,
            });
        }
        Ok(results)
    })
}

pub fn get_by_id(pool: &DbPool, id: &str) -> Result<PersonaExecution, AppError> {
    timed_query!("persona_executions", "persona_executions::get_by_id", {
        let conn = pool.conn("executions::get_by_id")?;
        let mut stmt = conn.prepare_cached(&format!(
            "SELECT {COLUMNS} FROM persona_executions WHERE id = ?1"
        ))?;
        stmt.query_row(params![id], row_to_execution)
            .map_err(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => {
                    AppError::NotFound(format!("Execution {id}"))
                }
                other => AppError::Database(other),
            })
    })
}

pub fn create(
    pool: &DbPool,
    persona_id: &str,
    trigger_id: Option<String>,
    input_data: Option<String>,
    model_used: Option<String>,
    use_case_id: Option<String>,
) -> Result<PersonaExecution, AppError> {
    timed_query!("persona_executions", "persona_executions::create", {
        create_with_idempotency(
            pool,
            persona_id,
            trigger_id,
            input_data,
            model_used,
            use_case_id,
            None,
            false,
        )
    })
}

/// Create an execution record with an optional idempotency key.
/// If `idempotency_key` is `Some` and an execution with that key already exists,
/// the existing record is returned instead of creating a duplicate.
///
/// `is_simulation` — Phase C3: when `true` the execution is flagged as a
/// simulation. Dispatch skips real notification delivery; activity feeds
/// filter these rows out by default.
pub fn create_with_idempotency(
    pool: &DbPool,
    persona_id: &str,
    trigger_id: Option<String>,
    input_data: Option<String>,
    model_used: Option<String>,
    use_case_id: Option<String>,
    idempotency_key: Option<String>,
    is_simulation: bool,
) -> Result<PersonaExecution, AppError> {
    create_with_idempotency_reporting(
        pool,
        persona_id,
        trigger_id,
        input_data,
        model_used,
        use_case_id,
        idempotency_key,
        is_simulation,
    )
    .map(|(execution, _created)| execution)
}

/// As [`create_with_idempotency`], but reports whether this call CREATED the row
/// (`true`) or deduped onto one that already existed (`false`).
///
/// Added 2026-08-16. The plain version returns only the row, so a caller cannot
/// tell the two apart — and the caller that most needed to tell them apart used
/// `execution.status != "queued"` as a proxy for "this was a dedupe". That proxy
/// is false exactly when the dedupe fires: this function INSERTs with
/// `status = 'queued'`, so a deduped row that has not started yet **is** queued.
/// Both callers therefore passed the guard and both spawned an agent — one
/// request, one returned row, two runs, two bills. The window is the whole queue
/// wait, not a few milliseconds.
///
/// The distinction cannot be recovered downstream from the row alone, which is
/// why it is returned rather than inferred.
pub fn create_with_idempotency_reporting(
    pool: &DbPool,
    persona_id: &str,
    trigger_id: Option<String>,
    input_data: Option<String>,
    model_used: Option<String>,
    use_case_id: Option<String>,
    idempotency_key: Option<String>,
    is_simulation: bool,
) -> Result<(PersonaExecution, bool), AppError> {
    timed_query!(
        "persona_executions",
        "persona_executions::create_with_idempotency",
        {
            // Check for existing execution with this idempotency key
            if let Some(ref key) = idempotency_key {
                if let Some(existing) = get_by_idempotency_key(pool, key)? {
                    tracing::info!(
                        idempotency_key = %key,
                        execution_id = %existing.id,
                        "Returning existing execution for idempotency key (dedup)"
                    );
                    return Ok((existing, false));
                }
            }

            let id = uuid::Uuid::new_v4().to_string();
            let now = chrono::Utc::now().to_rfc3339();

            // Insert-first with conflict handling so a concurrent same-key insert
            // (a lost TOCTOU race against the pre-check above — e.g. a double-
            // delivered webhook or a timeout-retry) dedups instead of hard-
            // erroring on the `idx_pe_idempotency` unique index. The conflict
            // target repeats that partial index's `WHERE idempotency_key IS NOT
            // NULL` clause so SQLite selects it. A NULL `idempotency_key` is not
            // in the partial index, so it can never conflict and always inserts
            // (preserving the no-dedup path's behavior). Scope the connection so
            // it is released before any re-select below.
            let rows_changed = {
                let conn = pool.conn("executions::create_with_idempotency_reporting")?;
                // Stamp which recipe this run came from, if any. Read from the
                // persona's existing use-case provenance; NULL when there is no
                // recipe behind the run.
                let (source_recipe_id, source_recipe_version) =
                    resolve_recipe_provenance(&conn, persona_id, use_case_id.as_deref());
                let mut stmt = conn.prepare_cached(
                "INSERT INTO persona_executions
                 (id, persona_id, trigger_id, status, input_data, model_used, input_tokens, output_tokens, cost_usd, use_case_id, idempotency_key, is_simulation, created_at, source_recipe_id, source_recipe_version)
                 VALUES (?1, ?2, ?3, 'queued', ?4, ?5, 0, 0, 0, ?6, ?7, ?8, ?9, ?10, ?11)
                 ON CONFLICT(idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING",
                )?;
                stmt.execute(params![
                    id,
                    persona_id,
                    trigger_id,
                    input_data,
                    model_used,
                    use_case_id,
                    idempotency_key,
                    is_simulation as i64,
                    now,
                    source_recipe_id,
                    source_recipe_version
                ])?
            };

            // rows_changed == 0 means the INSERT hit ON CONFLICT DO NOTHING:
            // another caller won the race and already inserted a row for this
            // idempotency key. Re-select and return that existing row so the
            // retry is transparently idempotent (same return shape as a fresh
            // insert). For a NULL key this branch is unreachable (no conflict
            // possible), so the no-dedup path still falls through to get_by_id.
            if rows_changed == 0 {
                if let Some(ref key) = idempotency_key {
                    if let Some(existing) = get_by_idempotency_key(pool, key)? {
                        tracing::info!(
                            idempotency_key = %key,
                            execution_id = %existing.id,
                            "Returning existing execution after INSERT conflict (idempotency dedup race)"
                        );
                        return Ok((existing, false));
                    }
                }
            }

            get_by_id(pool, &id).map(|execution| (execution, true))
        }
    )
}

/// Look up an execution by its idempotency key.
pub fn get_by_idempotency_key(
    pool: &DbPool,
    key: &str,
) -> Result<Option<PersonaExecution>, AppError> {
    timed_query!(
        "persona_executions",
        "persona_executions::get_by_idempotency_key",
        {
            let conn = pool.conn("executions::get_by_idempotency_key")?;
            let mut stmt = conn.prepare_cached(&format!(
                "SELECT {COLUMNS} FROM persona_executions WHERE idempotency_key = ?1"
            ))?;
            match stmt.query_row(params![key], row_to_execution) {
                Ok(exec) => Ok(Some(exec)),
                Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
                Err(e) => Err(AppError::Database(e)),
            }
        }
    )
}

pub fn get_by_trigger_id(
    pool: &DbPool,
    trigger_id: &str,
    limit: Option<i64>,
) -> Result<Vec<PersonaExecution>, AppError> {
    timed_query!(
        "persona_executions",
        "persona_executions::get_by_trigger_id",
        {
            let limit = limit.unwrap_or(10);
            let conn = pool.conn("executions::get_by_trigger_id")?;
            let mut stmt = conn.prepare_cached(&format!(
            "SELECT {COLUMNS} FROM persona_executions WHERE trigger_id = ?1 ORDER BY created_at DESC LIMIT ?2",
        ))?;
            let rows = stmt.query_map(params![trigger_id, limit], row_to_execution)?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(AppError::Database)
        }
    )
}

pub fn get_by_use_case_id(
    pool: &DbPool,
    persona_id: &str,
    use_case_id: &str,
    limit: Option<i64>,
) -> Result<Vec<PersonaExecution>, AppError> {
    timed_query!(
        "persona_executions",
        "persona_executions::get_by_use_case_id",
        {
            let limit = limit.unwrap_or(20);
            let conn = pool.conn("executions::get_by_use_case_id")?;
            let mut stmt = conn.prepare_cached(&format!(
            "SELECT {COLUMNS} FROM persona_executions WHERE persona_id = ?1 AND use_case_id = ?2 ORDER BY created_at DESC LIMIT ?3",
        ))?;
            let rows = stmt.query_map(params![persona_id, use_case_id, limit], row_to_execution)?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(AppError::Database)
        }
    )
}

/// Persist the Claude session id WITHOUT touching the status column, guarded to
/// `running`. The session-id capture runs on a detached, retrying task; if the
/// execution already reached a terminal status (completed/cancelled/failed) by
/// the time this fires, a status-writing `update_status` would resurrect the row
/// to `running` and orphan it as a permanent zombie. Column-scoped + status-guard
/// makes that impossible.
/// Stamp the LAUNCH-time model/effort the CLI was actually spawned with
/// (column-scoped; never touches status). `model` is the `--model` flag value
/// when one was passed — when None the CLI ran on its account default and
/// `set_model_used_actual` (stream init) fills the real name moments later.
pub fn set_launch_model_info(
    pool: &DbPool,
    id: &str,
    model: Option<&str>,
    thinking_level: &str,
) -> Result<(), AppError> {
    timed_query!(
        "persona_executions",
        "persona_executions::set_launch_model_info",
        {
            let conn = pool.conn("executions::set_launch_model_info")?;
            if let Some(m) = model {
                conn.execute(
                    "UPDATE persona_executions SET model_used = ?1, thinking_level = ?2
                     WHERE id = ?3 AND status IN ('queued','running')",
                    params![m, thinking_level, id],
                )?;
            } else {
                conn.execute(
                    "UPDATE persona_executions SET thinking_level = ?1
                     WHERE id = ?2 AND status IN ('queued','running')",
                    params![thinking_level, id],
                )?;
            }
            Ok(())
        }
    )
}

/// Stamp the ACTUAL model the CLI reported on its stream init event —
/// authoritative over any configured value (covers account-default runs and
/// provider-side aliasing). Status-guarded like `set_claude_session_id`.
pub fn set_model_used_actual(pool: &DbPool, id: &str, model: &str) -> Result<(), AppError> {
    timed_query!(
        "persona_executions",
        "persona_executions::set_model_used_actual",
        {
            let conn = pool.conn("executions::set_model_used_actual")?;
            conn.execute(
                "UPDATE persona_executions SET model_used = ?1 WHERE id = ?2 AND status = 'running'",
                params![model, id],
            )?;
            Ok(())
        }
    )
}

pub fn set_claude_session_id(pool: &DbPool, id: &str, session_id: &str) -> Result<(), AppError> {
    timed_query!(
        "persona_executions",
        "persona_executions::set_claude_session_id",
        {
            let conn = pool.conn("executions::set_claude_session_id")?;
            conn.execute(
                "UPDATE persona_executions SET claude_session_id = ?1 WHERE id = ?2 AND status = 'running'",
                params![session_id, id],
            )?;
            Ok(())
        }
    )
}

/// Persist the prompt-cache token breakdown for an execution (P1 cache
/// visibility). Column-scoped — touches only the two cache columns and is keyed
/// by id, so the runner's finalize can call it without racing the status write
/// or risking a zombie-status flip.
pub fn set_cache_tokens(
    pool: &DbPool,
    id: &str,
    cache_read_tokens: i64,
    cache_creation_tokens: i64,
) -> Result<(), AppError> {
    timed_query!(
        "persona_executions",
        "persona_executions::set_cache_tokens",
        {
            let conn = pool.conn("executions::set_cache_tokens")?;
            conn.execute(
                "UPDATE persona_executions SET cache_read_tokens = ?1, cache_creation_tokens = ?2 WHERE id = ?3",
                params![cache_read_tokens, cache_creation_tokens, id],
            )?;
            Ok(())
        }
    )
}

/// Scrub credential-shaped secrets from the free-text execution fields before
/// they are persisted (and thereby forwarded to the inspector / exports / Sentry
/// / companion memory). No-op when redaction is disabled. See `engine::redact`.
/// Extended 2026-08-15 from 3 fields to all 6.
///
/// This function covered `output_data`, `error_message` and `business_outcome`.
/// The other three free-text fields of `UpdateExecutionStatus` —
/// `execution_flows` (?6), `tool_steps` (?13) and `execution_config` (?15) —
/// are bound into the SAME `UPDATE` fifty lines below and were never scrubbed.
///
/// The codebase ran the controlled experiment on itself: across the live
/// `persona_executions` table, redacted `output_data` holds 2 credential-shaped
/// values and unredacted `tool_steps` holds 114 — Google API keys, a GitHub
/// PAT, a Bearer header, a PEM private-key header and 104 labelled assignments,
/// spread over at least 72 rows and 26.5 MB, aged 50-73 days, and rendered by
/// nine frontend files.
///
/// Note this only protects rows written from now on. The 114 values already
/// persisted need a backfill, which is not done here.
fn redact_execution_fields(input: &mut UpdateExecutionStatus) {
    use personas_core::redact;
    redact::redact_opt(&mut input.output_data);
    redact::redact_opt(&mut input.error_message);
    redact::redact_opt(&mut input.business_outcome);
    redact::redact_opt(&mut input.execution_config);

    if !redact::enabled() {
        return;
    }

    // `execution_flows` is already a `serde_json::Value`; walk it in place.
    if let Some(crate::models::Json(value)) = &mut input.execution_flows {
        redact_json_value(value);
    }

    // `tool_steps` is `Vec<ToolCallStep>`. Round-trip through `Value` so one
    // walker covers both shapes, and commit only if it parses back — a redaction
    // that corrupts the column would be worse than the leak it prevents.
    if let Some(crate::models::Json(steps)) = &mut input.tool_steps {
        if let Ok(mut value) = serde_json::to_value(&*steps) {
            redact_json_value(&mut value);
            if let Ok(parsed) =
                serde_json::from_value::<Vec<personas_core::types::ToolCallStep>>(value)
            {
                *steps = parsed;
            }
        }
    }
}

/// Redact every string inside a JSON document, in place.
///
/// Keys are deliberately left alone — a key is a field name, and rewriting one
/// changes the document's shape rather than its content.
fn redact_json_value(value: &mut serde_json::Value) {
    use personas_core::redact;
    match value {
        serde_json::Value::String(s) => {
            let cleaned = redact::redact_string(s);
            if cleaned != *s {
                *s = cleaned;
            }
        }
        serde_json::Value::Array(items) => {
            for item in items {
                redact_json_value(item);
            }
        }
        serde_json::Value::Object(map) => {
            for (_key, v) in map.iter_mut() {
                redact_json_value(v);
            }
        }
        _ => {}
    }
}

/// Shared 18-column execution-status `UPDATE`, parameterized only by the
/// trailing `WHERE` predicate. `update_status`, `update_status_if_running`,
/// and `update_status_if_not_final` differ *only* in which rows they're
/// allowed to touch (unguarded / CAS-if-running / CAS-if-not-final) — this
/// owns the shared SET clause + param binding so the three copies can never
/// drift out of sync (see refactor-bughunt-2026-07-10 #7).
fn exec_status_update(
    conn: &rusqlite::Connection,
    id: &str,
    input: &UpdateExecutionStatus,
    where_clause: &str,
) -> Result<usize, AppError> {
    let now = chrono::Utc::now().to_rfc3339();

    let started_at: Option<String> = if input.status == ExecutionState::Running {
        Some(now.clone())
    } else {
        None
    };

    let completed_at: Option<String> = if input.status.is_terminal() {
        Some(now)
    } else {
        None
    };

    // Serialize ExecutionState to its DB string form
    let status_str = input.status.as_str();

    let sql = format!(
        "UPDATE persona_executions SET
            status = ?1,
            output_data = COALESCE(?2, output_data),
            error_message = COALESCE(?3, error_message),
            duration_ms = COALESCE(?4, duration_ms),
            log_file_path = COALESCE(?5, log_file_path),
            execution_flows = COALESCE(?6, execution_flows),
            input_tokens = COALESCE(?7, input_tokens),
            output_tokens = COALESCE(?8, output_tokens),
            cost_usd = COALESCE(?9, cost_usd),
            started_at = COALESCE(?10, started_at),
            completed_at = COALESCE(?11, completed_at),
            tool_steps = COALESCE(?13, tool_steps),
            claude_session_id = COALESCE(?14, claude_session_id),
            execution_config = COALESCE(?15, execution_config),
            log_truncated = ?16,
            business_outcome = COALESCE(?17, business_outcome)
         {where_clause}"
    );
    let mut stmt = conn.prepare_cached(&sql)?;
    let rows_changed = stmt.execute(params![
        status_str,
        input.output_data,
        input.error_message,
        input.duration_ms,
        input.log_file_path,
        input.execution_flows,
        input.input_tokens,
        input.output_tokens,
        input.cost_usd,
        started_at,
        completed_at,
        id,
        input.tool_steps,
        input.claude_session_id,
        input.execution_config,
        input.log_truncated,
        input.business_outcome,
    ])?;
    Ok(rows_changed)
}

pub fn update_status(
    pool: &DbPool,
    id: &str,
    mut input: UpdateExecutionStatus,
) -> Result<(), AppError> {
    redact_execution_fields(&mut input);
    timed_query!("persona_executions", "persona_executions::update_status", {
        let conn = pool.conn("executions::update_status")?;
        exec_status_update(&conn, id, &input, "WHERE id = ?12")?;
        Ok(())
    })
}

/// Compare-and-swap status update: only writes if the current DB status is `running`.
///
/// Returns `true` if the row was updated (status was running), `false` if
/// the execution had already transitioned to a terminal state and was left
/// untouched. This prevents the cancel safety-net from overwriting a final
/// status that the spawned task already wrote.
pub fn update_status_if_running(
    pool: &DbPool,
    id: &str,
    mut input: UpdateExecutionStatus,
) -> Result<bool, AppError> {
    redact_execution_fields(&mut input);
    timed_query!(
        "persona_executions",
        "persona_executions::update_status_if_running",
        {
            let conn = pool.conn("executions::update_status_if_running")?;
            let rows_changed =
                exec_status_update(&conn, id, &input, "WHERE id = ?12 AND status = 'running'")?;
            Ok(rows_changed > 0)
        }
    )
}

/// CAS-claim a queued execution for one instance (multi-driver orchestration,
/// ADR 2026-05-26). Atomically flips `queued` → `running` and stamps
/// `claimed_by_instance` + a `claim_expires_at` TTL, but ONLY if the row is
/// still `queued` AND is either unclaimed or its prior claim's TTL has already
/// expired (crash recovery). Returns `true` iff THIS call won the claim.
///
/// The TTL-in-`WHERE` doubles as the stale-claim sweep: an expired claim is
/// simply re-claimable, so no separate reaper task is needed. Mirrors the
/// `trigger_version` CAS the scheduler already uses for double-fire safety.
///
/// This is the leader-run handoff path for executions a non-leader driver
/// (MCP/REST) enqueues as `queued`. The local-UI path creates executions
/// already `running` in-process and never passes through here, so snappy local
/// runs are unaffected. `claim_expires_at` is written in RFC3339 (chrono), the
/// same format compared in the predicate — keep all writers on RFC3339 so the
/// lexicographic `<` stays chronologically correct.
pub fn claim_for_instance(
    pool: &DbPool,
    id: &str,
    instance_id: &str,
    ttl_secs: i64,
) -> Result<bool, AppError> {
    timed_query!(
        "persona_executions",
        "persona_executions::claim_for_instance",
        {
            let now = chrono::Utc::now();
            let now_str = now.to_rfc3339();
            let expires_at = (now + chrono::Duration::seconds(ttl_secs)).to_rfc3339();
            let conn = pool.conn("executions::claim_for_instance")?;
            let mut stmt = conn.prepare_cached(
                // started_at is stamped UNCONDITIONALLY: a claim IS the start of a
                // run attempt. Previously `COALESCE(started_at, ?4)` preserved the
                // first attempt's timestamp across a running→queued→running re-claim
                // (quota cooldown / crash-recovery re-queue), so `sweep_zombie_executions`
                // — which reads started_at as "when the CURRENT attempt began" — would
                // flag a freshly re-claimed, healthy run as a >30-min zombie and drop
                // its real result via update_status_if_running.
                "UPDATE persona_executions SET
                    status = 'running',
                    claimed_by_instance = ?2,
                    claim_expires_at = ?3,
                    started_at = ?4
                 WHERE id = ?1
                   AND status = 'queued'
                   AND (claimed_by_instance IS NULL
                        OR claim_expires_at IS NULL
                        OR claim_expires_at < ?4)",
            )?;
            let rows = stmt.execute(params![id, instance_id, expires_at, now_str])?;
            Ok(rows > 0)
        }
    )
}

/// Compare-and-swap status update: only writes if the current DB status is
/// still active (`running` or `cancelled`-by-safety-net).
///
/// This allows the spawned task to enrich a bare cancel (written by the
/// safety-net without metrics) with full execution metrics, but prevents
/// overwriting a truly terminal status written by another code path.
pub fn update_status_if_not_final(
    pool: &DbPool,
    id: &str,
    mut input: UpdateExecutionStatus,
) -> Result<bool, AppError> {
    redact_execution_fields(&mut input);
    timed_query!(
        "persona_executions",
        "persona_executions::update_status_if_not_final",
        {
            let conn = pool.conn("executions::update_status_if_not_final")?;
            let status_str = input.status.as_str();

            // Cancellation is a terminal sink: a completion/failure must NEVER
            // overwrite a user cancel. Only the cancel branch may enrich an existing
            // 'cancelled' safety-net row with metrics; every other status may only
            // advance a still-'running' row. Without this split, a result landing in
            // the window just after the user clicks Stop clobbers the freshly-written
            // 'cancelled' row back to 'completed' (lost-cancel + success theater).
            let where_clause = if status_str == "cancelled" {
                "WHERE id = ?12 AND status IN ('running', 'cancelled')"
            } else {
                "WHERE id = ?12 AND status = 'running'"
            };
            let rows_changed = exec_status_update(&conn, id, &input, where_clause)?;

            Ok(rows_changed > 0)
        }
    )
}

pub fn get_recent(pool: &DbPool, limit: Option<i64>) -> Result<Vec<PersonaExecution>, AppError> {
    timed_query!("persona_executions", "persona_executions::get_recent", {
        let limit = limit.unwrap_or(20);
        let conn = pool.conn("executions::get_recent")?;
        let mut stmt = conn.prepare_cached(&format!(
            "SELECT {COLUMNS} FROM persona_executions ORDER BY created_at DESC LIMIT ?1"
        ))?;
        let rows = stmt.query_map(params![limit], row_to_execution)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)
    })
}

pub fn get_recent_failures(
    pool: &DbPool,
    persona_id: &str,
    limit: i64,
) -> Result<Vec<PersonaExecution>, AppError> {
    timed_query!(
        "persona_executions",
        "persona_executions::get_recent_failures",
        {
            let conn = pool.conn("executions::get_recent_failures")?;
            let mut stmt = conn.prepare_cached(&format!(
            "SELECT {COLUMNS} FROM persona_executions WHERE persona_id = ?1 AND status = 'failed' ORDER BY created_at DESC LIMIT ?2",
        ))?;
            let rows = stmt.query_map(params![persona_id, limit], row_to_execution)?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(AppError::Database)
        }
    )
}

/// TRUE consecutive-failure streak for the circuit breaker: failures SINCE the
/// persona's last completed execution (an interleaved success resets the
/// streak — `get_recent_failures(...).len()` counted the last N failed rows
/// regardless, so any persona with >= N lifetime failures permanently read as
/// "N consecutive"), EXCLUDING environmental failures that say nothing about
/// the persona itself: provider session/usage/rate limits and app-restart
/// kills. One quota storm must not trip the breaker.
pub fn count_consecutive_real_failures(pool: &DbPool, persona_id: &str) -> Result<u32, AppError> {
    timed_query!(
        "persona_executions",
        "persona_executions::count_consecutive_real_failures",
        {
            let conn = pool.conn("executions::count_consecutive_real_failures")?;
            let n: i64 = conn.query_row(
                "SELECT COUNT(*) AS n FROM persona_executions
                 WHERE persona_id = ?1 AND status = 'failed'
                   AND datetime(created_at) > COALESCE(
                       (SELECT MAX(datetime(created_at)) FROM persona_executions
                         WHERE persona_id = ?1 AND status = 'completed'),
                       '1970-01-01')
                   AND NOT (
                        LOWER(COALESCE(error_message,'')) LIKE '%rate limit%'
                     OR LOWER(COALESCE(error_message,'')) LIKE '%usage limit%'
                     OR LOWER(COALESCE(error_message,'')) LIKE '%session limit%'
                     OR COALESCE(error_message,'') LIKE '%App restarted%'
                     OR LOWER(COALESCE(output_data,'')) LIKE '%session limit%'
                     OR LOWER(COALESCE(output_data,'')) LIKE '%usage limit%'
                   )",
                params![persona_id],
                |r| r.get("n"),
            )?;
            Ok(n.min(u32::MAX as i64) as u32)
        }
    )
}

/// Storm guard: count this persona's ENVIRONMENTAL provider failures (usage /
/// rate / session limit, and API / server 5xx / overloaded) within a rolling
/// window of `window_minutes`.
///
/// These are exactly the failures the persona circuit breaker EXCLUDES (see
/// [`count_consecutive_real_failures`]) — so during a sustained provider
/// incident nothing else bounds the *cross-chain* retry storm: each newly
/// scheduled run starts a fresh healing chain (retry_count = 0) and schedules
/// its own durable `RetryAt`, and the breaker never trips because it ignores
/// environmental failures. The healing orchestrator reads this count and, past
/// a documented cap, folds the auto-retry into a manual issue instead of piling
/// on another scheduled retry. The window bounds RETRY COUNT, not wait time —
/// a single legitimate usage-window wait (hours) still schedules normally.
///
/// The `LIKE` shapes mirror the environmental exclusion in
/// `count_consecutive_real_failures` plus the API/server-error shapes classified
/// as `ApiError` by `error_taxonomy` (500/502/503/529/overloaded/server error).
pub fn count_environmental_failures_in_window(
    pool: &DbPool,
    persona_id: &str,
    window_minutes: i64,
) -> Result<u32, AppError> {
    timed_query!(
        "persona_executions",
        "persona_executions::count_environmental_failures_in_window",
        {
            let conn = pool.conn("executions::count_environmental_failures_in_window")?;
            let n: i64 = conn.query_row(
                "SELECT COUNT(*) AS n FROM persona_executions
                 WHERE persona_id = ?1 AND status = 'failed'
                   AND datetime(created_at) > datetime('now', ?2)
                   AND (
                        LOWER(COALESCE(error_message,'')) LIKE '%rate limit%'
                     OR LOWER(COALESCE(error_message,'')) LIKE '%usage limit%'
                     OR LOWER(COALESCE(error_message,'')) LIKE '%session limit%'
                     OR COALESCE(error_message,'') LIKE '%429%'
                     OR LOWER(COALESCE(error_message,'')) LIKE '%overloaded%'
                     OR LOWER(COALESCE(error_message,'')) LIKE '%server error%'
                     OR LOWER(COALESCE(error_message,'')) LIKE '%internal server%'
                     OR COALESCE(error_message,'') LIKE '%500%'
                     OR COALESCE(error_message,'') LIKE '%502%'
                     OR COALESCE(error_message,'') LIKE '%503%'
                     OR COALESCE(error_message,'') LIKE '%529%'
                   )",
                params![persona_id, format!("-{window_minutes} minutes")],
                |r| r.get("n"),
            )?;
            Ok(n.min(u32::MAX as i64) as u32)
        }
    )
}

pub fn get_running(pool: &DbPool) -> Result<Vec<PersonaExecution>, AppError> {
    timed_query!("persona_executions", "persona_executions::get_running", {
        let conn = pool.conn("executions::get_running")?;
        let mut stmt = conn.prepare_cached(&format!(
            "SELECT {COLUMNS} FROM persona_executions WHERE status IN ('queued', 'running') ORDER BY created_at ASC",
        ))?;
        let rows = stmt.query_map([], row_to_execution)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)
    })
}

// =============================================================================
// In-flight chain observability (Direction 2)
// =============================================================================

/// A live summary of one chain that currently has in-flight work — the answer
/// to "what chains are running right now?", which was otherwise unanswerable
/// (CascadeMetrics is log-only and the Chain tab is retrospective per-run).
///
/// Grouped from the currently `running`/`queued` executions by the
/// `chain_trace_id` carried in each run's `input_data`.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ActiveChain {
    /// The distributed chain trace id shared by every hop of this chain.
    pub chain_trace_id: String,
    /// How many executions of this chain are in flight right now (running or
    /// queued). This is a LIVE count, not the chain's lifetime hop total.
    #[ts(type = "number")]
    pub in_flight_count: u32,
    /// The deepest hop reached so far (max `_chain_depth` across the in-flight
    /// runs). Bounded by `MAX_CHAIN_DEPTH`.
    #[ts(type = "number")]
    pub max_depth: u32,
    /// USD spent by the chain up to its most recent completed hop — the max of
    /// the accumulated `_chain_cost_usd` propagated in the in-flight runs'
    /// metadata. In-flight runs have not booked their own cost yet, so this is
    /// spend-through-the-latest-hop, not including the running hops themselves.
    pub accumulated_cost_usd: f64,
    /// Distinct personas with in-flight work in this chain (first-seen order).
    pub persona_ids: Vec<String>,
    /// When the oldest in-flight run of this chain began (its `started_at`, or
    /// `created_at` when not yet started) — the chain's live age anchor.
    pub oldest_started_at: String,
}

/// Minimal per-run projection the grouping needs — kept separate from
/// `PersonaExecution` so the grouping is a pure, DB-free unit under test.
pub struct ActiveChainRow {
    pub persona_id: String,
    pub input_data: Option<String>,
    /// `started_at` when present, else `created_at` (a queued run has no start).
    pub started_at: String,
}

/// Extract `(chain_trace_id, chain_depth, chain_cost_usd)` from a run's runtime
/// input, tolerating BOTH on-the-wire shapes: the RAW chain payload with the
/// `_chain_*` fields at the top level, and the event-bus-WRAPPED
/// `{"_event": …, "payload": <raw>}` shape where they live under `payload`.
/// Mirrors `chain::chain_trace_id_from_input`'s dual-shape handling. Returns
/// `None` for a non-chain run (no `_chain_trace_id` in either place).
fn chain_meta_from_input(input: &str) -> Option<(String, u32, f64)> {
    let v: serde_json::Value = serde_json::from_str(input).ok()?;
    let meta = if v.get("_chain_trace_id").is_some() {
        &v
    } else if v
        .get("payload")
        .and_then(|p| p.get("_chain_trace_id"))
        .is_some()
    {
        v.get("payload")?
    } else {
        return None;
    };
    let trace_id = meta.get("_chain_trace_id")?.as_str()?.to_string();
    let depth = meta
        .get("_chain_depth")
        .and_then(|d| d.as_u64())
        .unwrap_or(0) as u32;
    let cost = meta
        .get("_chain_cost_usd")
        .and_then(|c| c.as_f64())
        .filter(|c| c.is_finite() && *c >= 0.0)
        .unwrap_or(0.0);
    Some((trace_id, depth, cost))
}

/// Pure grouping of in-flight runs into per-chain summaries. Non-chain runs
/// (no `chain_trace_id` in their input) are ignored. Ordered oldest-first so
/// the longest-running chain surfaces at the top.
pub fn group_active_chains(rows: &[ActiveChainRow]) -> Vec<ActiveChain> {
    use std::collections::HashMap;

    struct Acc {
        in_flight: u32,
        max_depth: u32,
        cost: f64,
        personas: Vec<String>,
        oldest: String,
    }

    let mut map: HashMap<String, Acc> = HashMap::new();
    for r in rows {
        let Some(input) = r.input_data.as_deref() else {
            continue;
        };
        let Some((ctid, depth, cost)) = chain_meta_from_input(input) else {
            continue;
        };
        let acc = map.entry(ctid).or_insert_with(|| Acc {
            in_flight: 0,
            max_depth: 0,
            cost: 0.0,
            personas: Vec::new(),
            oldest: r.started_at.clone(),
        });
        acc.in_flight += 1;
        acc.max_depth = acc.max_depth.max(depth);
        acc.cost = acc.cost.max(cost);
        if !acc.personas.contains(&r.persona_id) {
            acc.personas.push(r.persona_id.clone());
        }
        if r.started_at < acc.oldest {
            acc.oldest = r.started_at.clone();
        }
    }

    let mut out: Vec<ActiveChain> = map
        .into_iter()
        .map(|(chain_trace_id, a)| ActiveChain {
            chain_trace_id,
            in_flight_count: a.in_flight,
            max_depth: a.max_depth,
            accumulated_cost_usd: a.cost,
            persona_ids: a.personas,
            oldest_started_at: a.oldest,
        })
        .collect();
    out.sort_by(|a, b| {
        a.oldest_started_at
            .cmp(&b.oldest_started_at)
            .then_with(|| a.chain_trace_id.cmp(&b.chain_trace_id))
    });
    out
}

/// List the chains that currently have in-flight (running/queued) executions,
/// grouped by `chain_trace_id`. An empty vec means no chain work is in flight.
pub fn list_active_chains(pool: &DbPool) -> Result<Vec<ActiveChain>, AppError> {
    let running = get_running(pool)?;
    let rows: Vec<ActiveChainRow> = running
        .into_iter()
        .map(|e| ActiveChainRow {
            persona_id: e.persona_id,
            input_data: e.input_data,
            started_at: e.started_at.unwrap_or(e.created_at),
        })
        .collect();
    Ok(group_active_chains(&rows))
}

/// Only executions whose process was mid-RUN at shutdown (`status='running'`).
/// Used by startup recovery to fail orphaned runs WITHOUT touching durable
/// `queued` rows (which are re-admitted instead). See
/// `ExecutionEngine::recover_stale_executions`.
pub fn get_running_only(pool: &DbPool) -> Result<Vec<PersonaExecution>, AppError> {
    timed_query!(
        "persona_executions",
        "persona_executions::get_running_only",
        {
            let conn = pool.conn("executions::get_running_only")?;
            let mut stmt = conn.prepare_cached(&format!(
                "SELECT {COLUMNS} FROM persona_executions WHERE status = 'running' ORDER BY created_at ASC",
            ))?;
            let rows = stmt.query_map([], row_to_execution)?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(AppError::Database)
        }
    )
}

/// Only executions persisted as `queued` (waiting for a slot, never started).
/// The `persona_executions` row is the durable queue; these are re-admitted on
/// startup by `ExecutionEngine::requeue_persisted_executions` so scheduled /
/// event-triggered work is not lost across a restart.
pub fn get_queued_only(pool: &DbPool) -> Result<Vec<PersonaExecution>, AppError> {
    timed_query!(
        "persona_executions",
        "persona_executions::get_queued_only",
        {
            let conn = pool.conn("executions::get_queued_only")?;
            let mut stmt = conn.prepare_cached(&format!(
                "SELECT {COLUMNS} FROM persona_executions WHERE status = 'queued' ORDER BY created_at ASC",
            ))?;
            let rows = stmt.query_map([], row_to_execution)?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(AppError::Database)
        }
    )
}

/// Lightweight check: are any executions currently in-flight?
/// Used by the adaptive polling system to decide between active/idle intervals.
pub fn has_running_executions(pool: &DbPool) -> Result<bool, AppError> {
    timed_query!(
        "persona_executions",
        "persona_executions::has_running_executions",
        {
            let conn = pool.conn("executions::has_running_executions")?;
            let exists: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM persona_executions WHERE status IN ('queued', 'running')) AS present",
            [],
            |row| row.get("present"),
        )?;
            Ok(exists)
        }
    )
}

pub fn get_running_count_for_persona(pool: &DbPool, persona_id: &str) -> Result<i64, AppError> {
    timed_query!(
        "persona_executions",
        "persona_executions::get_running_count_for_persona",
        {
            let conn = pool.conn("executions::get_running_count_for_persona")?;
            let count: i64 = conn.query_row(
            "SELECT COUNT(*) AS n FROM persona_executions WHERE persona_id = ?1 AND status IN ('queued', 'running')",
            params![persona_id],
            |row| row.get("n"),
        )?;
            Ok(count)
        }
    )
}

pub fn count_for_persona_since(
    pool: &DbPool,
    persona_id: &str,
    since_rfc3339: &str,
) -> Result<i64, AppError> {
    timed_query!(
        "persona_executions",
        "persona_executions::count_for_persona_since",
        {
            let conn = pool.conn("executions::count_for_persona_since")?;
            let count: i64 = conn.query_row(
                "SELECT COUNT(*) AS n FROM persona_executions WHERE persona_id = ?1 AND created_at >= ?2",
                params![persona_id, since_rfc3339],
                |row| row.get("n"),
            )?;
            Ok(count)
        }
    )
}

/// Capability-scoped running-count: how many executions are queued/running for
/// this exact (persona_id, use_case_id) pair. Used by the event-bus cascade
/// guard so that a UC1→UC2 chain within the same persona isn't blocked by
/// UC1 still being in-flight when its emitted event lands.
pub fn get_running_count_for_persona_use_case(
    pool: &DbPool,
    persona_id: &str,
    use_case_id: &str,
) -> Result<i64, AppError> {
    timed_query!(
        "persona_executions",
        "persona_executions::get_running_count_for_persona_use_case",
        {
            let conn = pool.conn("executions::get_running_count_for_persona_use_case")?;
            let count: i64 = conn.query_row(
                "SELECT COUNT(*) AS n FROM persona_executions \
             WHERE persona_id = ?1 AND use_case_id = ?2 AND status IN ('queued', 'running')",
                params![persona_id, use_case_id],
                |row| row.get("n"),
            )?;
            Ok(count)
        }
    )
}

pub fn delete(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    timed_query!("persona_executions", "persona_executions::delete", {
        let conn = pool.conn("executions::delete")?;
        let rows = conn.execute("DELETE FROM persona_executions WHERE id = ?1", params![id])?;
        Ok(rows > 0)
    })
}

/// Persist the W3C traceparent header generated for an execution so downstream
/// observability pipelines can correlate personas' trace with the CLI's spans.
/// Called near execution start, after `create()`.
pub fn set_traceparent(
    pool: &DbPool,
    execution_id: &str,
    traceparent: &str,
) -> Result<(), AppError> {
    timed_query!(
        "persona_executions",
        "persona_executions::set_traceparent",
        {
            let conn = pool.conn("executions::set_traceparent")?;
            conn.execute(
                "UPDATE persona_executions SET traceparent = ?1 WHERE id = ?2",
                params![traceparent, execution_id],
            )?;
            Ok(())
        }
    )
}

/// Stamp the supervisory `last_heartbeat_at` column whenever the runner emits
/// a heartbeat tick. Read by the watchdog scan in `engine::healthcheck` to
/// detect long-silent runs without changing the canonical status lifecycle.
/// Errors are non-fatal — heartbeat is best-effort.
pub fn touch_last_heartbeat(pool: &DbPool, execution_id: &str) -> Result<(), AppError> {
    timed_query!(
        "persona_executions",
        "persona_executions::touch_last_heartbeat",
        {
            let conn = pool.conn("executions::touch_last_heartbeat")?;
            let now = chrono::Utc::now().to_rfc3339();
            let mut stmt = conn.prepare_cached(
                "UPDATE persona_executions SET last_heartbeat_at = ?1 WHERE id = ?2",
            )?;
            stmt.execute(params![now, execution_id])?;
            Ok(())
        }
    )
}

/// Find still-running executions whose last heartbeat is older than the given
/// cutoff timestamp (RFC3339). Returns just the IDs — the watchdog only needs
/// to fire a passive event, not surface a typed row. Limited to keep a single
/// scan tick bounded.
pub fn find_silent_running(
    pool: &DbPool,
    cutoff_rfc3339: &str,
    limit: i64,
) -> Result<Vec<String>, AppError> {
    timed_query!(
        "persona_executions",
        "persona_executions::find_silent_running",
        {
            let conn = pool.conn("executions::find_silent_running")?;
            let mut stmt = conn.prepare_cached(
                "SELECT id FROM persona_executions
             WHERE status = 'running'
               AND last_heartbeat_at IS NOT NULL
               AND last_heartbeat_at < ?1
             ORDER BY last_heartbeat_at ASC
             LIMIT ?2",
            )?;
            let rows = stmt.query_map(params![cutoff_rfc3339, limit], |row| {
                row.get::<_, String>("id")
            })?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(AppError::Database)
        }
    )
}

/// Create an execution record that is a healing retry of `original_exec_id`.
pub fn create_retry(
    pool: &DbPool,
    persona_id: &str,
    original_exec_id: &str,
    retry_count: i64,
) -> Result<PersonaExecution, AppError> {
    timed_query!("persona_executions", "persona_executions::create_retry", {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();

        // Copy `input_data` from the original execution so the retry inherits
        // the same task context. Without this the retry's input_data is NULL
        // and a persona that selects its capability based on input shape
        // (e.g. Dev Clone's TEAM MODE detection on a team_handoff payload)
        // silently routes to its standalone default instead — observed in
        // cert-3 #3 where Dev Clone retry ran uc_backlog_scan instead of
        // uc_implementation because the team_handoff payload was lost. A
        // retry by definition re-attempts the same work; it must see the
        // same input. Chain metadata (depth/visited/trace) is also embedded
        // in input_data, which lets the post-retry chain-trigger fix from
        // engine/mod.rs:spawn_delayed_retry read from the retry exec
        // directly instead of falling back to the original.
        let conn = pool.conn("executions::create_retry")?;
        // Recipe provenance is inherited from the original rather than
        // re-resolved: a retry re-attempts the same work, and the capability may
        // since have been detached. Copying keeps the retry attributed to the
        // recipe that actually produced it.
        let mut stmt = conn.prepare_cached(
            "INSERT INTO persona_executions
             (id, persona_id, status, input_tokens, output_tokens, cost_usd, retry_of_execution_id, retry_count, created_at, input_data, source_recipe_id, source_recipe_version)
             VALUES (?1, ?2, 'queued', 0, 0, 0, ?3, ?4, ?5,
                     (SELECT input_data FROM persona_executions WHERE id = ?3),
                     (SELECT source_recipe_id FROM persona_executions WHERE id = ?3),
                     (SELECT source_recipe_version FROM persona_executions WHERE id = ?3))",
        )?;
        stmt.execute(params![id, persona_id, original_exec_id, retry_count, now])?;

        get_by_id(pool, &id)
    })
}

/// Count consecutive recent failures for a persona (unbroken streak of 'failed' status
/// from the most recent execution backwards).
pub fn get_consecutive_failure_count(pool: &DbPool, persona_id: &str) -> Result<u32, AppError> {
    timed_query!(
        "persona_executions",
        "persona_executions::get_consecutive_failure_count",
        {
            let conn = pool.conn("executions::get_consecutive_failure_count")?;
            let mut stmt = conn.prepare_cached(
                "SELECT status FROM persona_executions
             WHERE persona_id = ?1
             ORDER BY created_at DESC
             LIMIT 20",
            )?;
            let statuses: Vec<String> = crate::repos::utils::collect_rows(
                stmt.query_map(params![persona_id], |row| row.get::<_, String>("status"))?,
                "persona_executions::get_consecutive_failure_count",
            );

            let count = statuses
                .iter()
                .take_while(|s| s.as_str() == "failed")
                .count();
            Ok(count as u32)
        }
    )
}

/// Get the retry chain for an execution (all retries linked to the same original).
pub fn get_retry_chain(
    pool: &DbPool,
    execution_id: &str,
) -> Result<Vec<PersonaExecution>, AppError> {
    timed_query!(
        "persona_executions",
        "persona_executions::get_retry_chain",
        {
            // First, find the root execution
            let exec = get_by_id(pool, execution_id)?;
            let root_id = exec
                .retry_of_execution_id
                .as_deref()
                .unwrap_or(execution_id);

            let conn = pool.conn("executions::get_retry_chain")?;
            let mut stmt = conn.prepare_cached(&format!(
                "SELECT {COLUMNS} FROM persona_executions
             WHERE id = ?1 OR retry_of_execution_id = ?1
             ORDER BY retry_count ASC, created_at ASC",
            ))?;
            let rows = stmt.query_map(params![root_id], row_to_execution)?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(AppError::Database)
        }
    )
}

/// Batch-fetch retry chains for multiple execution IDs in a single query.
/// Returns a map from each input execution_id to its retry chain (executions
/// with retry_count > 0). This eliminates the N+1 pattern when building the
/// healing timeline.
pub fn get_retry_chains_batch(
    pool: &DbPool,
    execution_ids: &[&str],
) -> Result<std::collections::HashMap<String, Vec<PersonaExecution>>, AppError> {
    timed_query!(
        "persona_executions",
        "persona_executions::get_retry_chains_batch",
        {
            if execution_ids.is_empty() {
                return Ok(std::collections::HashMap::new());
            }

            let conn = pool.conn("executions::get_retry_chains_batch")?;

            // Step 1: resolve root IDs for all requested execution_ids
            let placeholders: String = crate::repos::utils::in_placeholders(execution_ids.len());

            let root_sql = format!(
        "SELECT id, retry_of_execution_id FROM persona_executions WHERE id IN ({placeholders})"
    );
            let params_boxed: Vec<Box<dyn rusqlite::types::ToSql>> = execution_ids
                .iter()
                .map(|id| Box::new(id.to_string()) as Box<dyn rusqlite::types::ToSql>)
                .collect();
            let params_ref: Vec<&dyn rusqlite::types::ToSql> =
                params_boxed.iter().map(|p| p.as_ref()).collect();

            let mut root_stmt = conn.prepare_cached(&root_sql)?;
            let root_rows = root_stmt.query_map(params_ref.as_slice(), |row| {
                let id: String = row.get("id")?;
                let retry_of: Option<String> = row.get("retry_of_execution_id")?;
                Ok((id, retry_of))
            })?;

            // Map: original exec_id -> root_id
            let mut exec_to_root: std::collections::HashMap<String, String> =
                std::collections::HashMap::new();
            let mut root_ids: std::collections::HashSet<String> = std::collections::HashSet::new();
            for row in root_rows {
                let (id, retry_of) = row.map_err(AppError::Database)?;
                let root = retry_of.unwrap_or_else(|| id.clone());
                root_ids.insert(root.clone());
                exec_to_root.insert(id, root);
            }

            if root_ids.is_empty() {
                return Ok(std::collections::HashMap::new());
            }

            // Step 2: fetch all retry executions for these roots in one query
            let root_list: Vec<&str> = root_ids.iter().map(|s| s.as_str()).collect();
            let root_placeholders: String = crate::repos::utils::in_placeholders(root_list.len());

            // One statement, a single placeholder list bound twice — once for
            // `id IN (...)` (the roots themselves) and once for
            // `retry_of_execution_id IN (...)` (their retries).
            let chain_sql = format!(
                "SELECT {COLUMNS} FROM persona_executions
         WHERE id IN ({placeholders}) OR retry_of_execution_id IN ({placeholders})
         ORDER BY retry_count ASC, created_at ASC",
                placeholders = root_placeholders
            );
            // The placeholders are NUMBERED (`?1, ?2, …`), so repeating the
            // same list in the second `IN` clause reuses the SAME parameters —
            // the statement's parameter_count is `root_list.len()`, not twice
            // that. Binding the list twice made rusqlite reject every call with
            // InvalidParameterCount, so the batch path (healing_timeline.rs)
            // always failed instead of returning chains.
            let chain_params_boxed: Vec<Box<dyn rusqlite::types::ToSql>> = root_list
                .iter()
                .map(|id| Box::new(id.to_string()) as Box<dyn rusqlite::types::ToSql>)
                .collect();
            let chain_params_ref: Vec<&dyn rusqlite::types::ToSql> =
                chain_params_boxed.iter().map(|p| p.as_ref()).collect();

            let mut chain_stmt = conn.prepare_cached(&chain_sql)?;
            let chain_rows = chain_stmt.query_map(chain_params_ref.as_slice(), row_to_execution)?;
            let all_executions: Vec<PersonaExecution> =
                crate::repos::utils::collect_rows(chain_rows, "retry_chains_batch");

            // Step 3: group by root_id, then map back to original exec_ids
            let mut root_to_chain: std::collections::HashMap<String, Vec<PersonaExecution>> =
                std::collections::HashMap::new();
            for exec in all_executions {
                let root = exec
                    .retry_of_execution_id
                    .as_deref()
                    .unwrap_or(&exec.id)
                    .to_string();
                root_to_chain.entry(root).or_default().push(exec);
            }

            // Build result keyed by original execution_id
            let mut result: std::collections::HashMap<String, Vec<PersonaExecution>> =
                std::collections::HashMap::new();
            for (exec_id, root_id) in &exec_to_root {
                if let Some(chain) = root_to_chain.get(root_id) {
                    result.insert(exec_id.clone(), chain.clone());
                }
            }

            Ok(result)
        }
    )
}

/// Spend predicate enforced by the monthly-budget gate, shared VERBATIM by both
/// the per-persona server gate `get_monthly_spend` (which BLOCKS runs) and the
/// all-persona budget UI feed `get_all_monthly_spend_with_conn`
/// (`commands/communication/observability/metrics.rs`). These two MUST stay in
/// lock-step: if they diverge, the UI badge / pause number stops matching what
/// the server actually enforces. See the invariant in `engine/background.rs`
/// (~1498-1510): "the budget UI shows terminal statuses only, ops-chat excluded".
/// Three axes that must match exactly:
///   1. status set — completed/failed/incomplete/cancelled. Cancelled rows may
///      have consumed API credits before the process was killed, so they count
///      toward the budget; in-flight (running/queued) rows do not.
///   2. month boundary — UTC `datetime('now', 'start of month')` (NOT local time).
///   3. ops-chat excluded — conversational `_ops` Chat-tab queries are not
///      billable agent executions.
pub const MONTHLY_SPEND_PREDICATE: &str = "status IN ('completed', 'failed', 'incomplete', 'cancelled') AND created_at >= datetime('now', 'start of month') AND (input_data IS NULL OR input_data NOT LIKE '%\"_ops\"%')";

pub fn get_monthly_spend(pool: &DbPool, persona_id: &str) -> Result<f64, AppError> {
    timed_query!(
        "persona_executions",
        "persona_executions::get_monthly_spend",
        {
            let conn = pool.conn("executions::get_monthly_spend")?;
            // Spend predicate is the shared MONTHLY_SPEND_PREDICATE so this server
            // gate and the budget UI feed (get_all_monthly_spend_with_conn) can
            // never drift on status set, month boundary, or ops-chat exclusion.
            // See its doc comment above + the engine/background.rs invariant.
            let sql = format!(
                "SELECT COALESCE(SUM(cost_usd), 0.0) AS spend FROM persona_executions
             WHERE persona_id = ?1 AND {}",
                MONTHLY_SPEND_PREDICATE
            );
            let spend: f64 = conn.query_row(&sql, params![persona_id], |row| row.get("spend"))?;
            Ok(spend)
        }
    )
}

/// Default zombie threshold for RUNNING executions: 30 minutes.
const DEFAULT_ZOMBIE_THRESHOLD_SECS: i64 = 30 * 60;

/// Zombie threshold for QUEUED executions, judged by `created_at`. More generous
/// than the running threshold because a queue legitimately backs up while it
/// drains — but an execution still queued after this long is stuck (e.g. an
/// indefinite/aligned quota cooldown holding the drain) and must be reaped, or
/// it hangs forever (the sweep previously only handled 'running').
const QUEUED_ZOMBIE_THRESHOLD_SECS: i64 = 60 * 60;

/// Find executions stuck in 'running' state for longer than the zombie threshold
/// and transition them to 'incomplete'. Returns the IDs of transitioned executions
/// that should be SURFACED to the user — i.e. those for which the persona does
/// not already have a newer completed execution. Zombies whose persona already
/// has a newer completed run are still cleaned up (transitioned to incomplete),
/// but their IDs are not returned, so the background sweep doesn't fire a
/// misleading "execution stalled" notification for runs the user has already
/// seen succeed via a later attempt.
pub fn sweep_zombie_executions(pool: &DbPool) -> Result<Vec<String>, AppError> {
    timed_query!(
        "persona_executions",
        "persona_executions::sweep_zombie_executions",
        {
            let conn = pool.conn("executions::sweep_zombie_executions")?;
            let now = chrono::Utc::now();
            let threshold_secs = DEFAULT_ZOMBIE_THRESHOLD_SECS;

            // Find running executions whose started_at is older than the threshold.
            // Pull persona_id + created_at too so we can check "is there a newer
            // completed run for the same persona?" before deciding whether to
            // surface this zombie to the user.
            let mut stmt = conn.prepare_cached(
                "SELECT id, persona_id, status, started_at, created_at FROM persona_executions WHERE status IN ('running', 'queued')",
            )?;
            // A row that fails to map here is a zombie candidate that would
            // never be reaped — log it (collect_rows) instead of dropping it
            // silently.
            let candidates: Vec<(String, String, String, Option<String>, String)> =
                crate::repos::utils::collect_rows(
                    stmt.query_map([], |row| {
                        Ok((
                            row.get::<_, String>("id")?,
                            row.get::<_, String>("persona_id")?,
                            row.get::<_, String>("status")?,
                            row.get::<_, Option<String>>("started_at")?,
                            row.get::<_, String>("created_at")?,
                        ))
                    })?,
                    "persona_executions::sweep_zombie_executions",
                );

            let mut surface_ids = Vec::new();
            for (id, persona_id, status, started_at, created_at) in candidates {
                let is_queued = status == "queued";
                // Running zombies are judged by started_at; queued ones never
                // started, so judge by created_at against the more generous
                // queued threshold.
                let limit_secs = if is_queued {
                    QUEUED_ZOMBIE_THRESHOLD_SECS
                } else {
                    threshold_secs
                };
                let reference_ts: Option<&str> = if is_queued {
                    Some(created_at.as_str())
                } else {
                    started_at.as_deref()
                };
                let is_zombie = match reference_ts {
                    Some(ts) => match chrono::DateTime::parse_from_rfc3339(ts) {
                        Ok(t) => (now - t.with_timezone(&chrono::Utc)).num_seconds() > limit_secs,
                        Err(_) => true, // unparseable timestamp — treat as zombie
                    },
                    // Running with no started_at — shouldn't happen; treat as zombie.
                    None => true,
                };

                if is_zombie {
                    let elapsed_str = reference_ts.unwrap_or("unknown");
                    // CAS on the row's CURRENT status: a queued execution that
                    // started running (or a running one that completed) between
                    // the read and here must not be clobbered.
                    let mut update_stmt = conn.prepare_cached(
                        "UPDATE persona_executions SET
                    status = 'incomplete',
                    error_message = ?1,
                    completed_at = ?2
                 WHERE id = ?3 AND status = ?4",
                    )?;
                    let swapped = update_stmt.execute(params![
                        format!(
                            "Execution stalled: {} since {} (>{} min) — marked as zombie",
                            if is_queued { "queued" } else { "running" },
                            elapsed_str,
                            limit_secs / 60,
                        ),
                        now.to_rfc3339(),
                        id,
                        status,
                    ])?;

                    // The CAS above exists to avoid clobbering a row that moved
                    // between the read and here — but the verdict was discarded,
                    // so the id was pushed onto `surface_ids` regardless. An
                    // execution that COMPLETED in the race window was correctly
                    // left alone and then reported to the user as
                    // "Execution stalled". Losing the CAS means there is nothing
                    // to surface: skip it.
                    if swapped == 0 {
                        tracing::debug!(
                            execution_id = %id,
                            "zombie sweep: row moved between read and swap — not a zombie, not surfaced"
                        );
                        continue;
                    }

                    // Surface to user only if there's no newer completed run for
                    // the same persona. A newer completed run means the user
                    // already saw success — re-notifying about an old stalled
                    // attempt is just noise.
                    let mut superseded_stmt = conn.prepare_cached(
                        "SELECT 1 FROM persona_executions
                         WHERE persona_id = ?1
                           AND status = 'completed'
                           AND created_at > ?2
                         LIMIT 1",
                    )?;
                    let is_superseded: bool = superseded_stmt
                        .query_row(params![persona_id, created_at], |_| Ok(true))
                        .unwrap_or(false);

                    if !is_superseded {
                        surface_ids.push(id);
                    } else {
                        tracing::debug!(
                            execution_id = %id,
                            persona_id = %persona_id,
                            "zombie sweep: silently transitioned superseded execution to incomplete (newer completed run exists)"
                        );
                    }
                }
            }

            Ok(surface_ids)
        }
    )
}

/// Delete old terminal executions beyond the retention period, but always keep
/// at least `min_keep_per_persona` most-recent records for each persona.
///
/// Only deletes executions with terminal status (completed, failed, incomplete,
/// cancelled) -- queued/running executions are never cleaned up.
///
/// Returns the total number of rows deleted.
pub fn cleanup_old_executions(
    pool: &DbPool,
    retention_days: i64,
    min_keep_per_persona: usize,
) -> Result<usize, AppError> {
    timed_query!(
        "persona_executions",
        "persona_executions::cleanup_old_executions",
        {
            let conn = pool.conn("executions::cleanup_old_executions")?;

            // Two-phase approach:
            // 1. Find all persona_ids that have terminal executions older than the cutoff.
            // 2. For each persona, delete old terminal executions while preserving the
            //    most recent `min_keep_per_persona` rows.

            let cutoff = format!("-{retention_days} days");

            // Get distinct persona_ids with old terminal executions
            let mut persona_stmt = conn.prepare_cached(
                "SELECT DISTINCT persona_id FROM persona_executions
         WHERE status IN ('completed', 'failed', 'incomplete', 'cancelled')
           AND created_at < datetime('now', ?1)",
            )?;
            let persona_ids: Vec<String> = crate::repos::utils::collect_rows(
                persona_stmt
                    .query_map(params![cutoff], |row| row.get::<_, String>("persona_id"))?,
                "persona_executions::cleanup_old_executions",
            );

            let mut total_deleted: usize = 0;

            for pid in &persona_ids {
                // Find the created_at threshold: the min_keep_per_persona-th most recent
                // terminal execution for this persona. Anything older AND beyond the
                // retention cutoff gets deleted.
                let keep_threshold: Option<String> = conn
                    .query_row(
                        "SELECT created_at FROM persona_executions
                 WHERE persona_id = ?1
                   AND status IN ('completed', 'failed', 'incomplete', 'cancelled')
                 ORDER BY created_at DESC
                 LIMIT 1 OFFSET ?2",
                        params![pid, min_keep_per_persona as i64],
                        |row| row.get("created_at"),
                    )
                    .ok();

                // If there aren't enough rows to reach the offset, this persona has
                // fewer than min_keep_per_persona terminal executions -- skip it.
                let keep_threshold = match keep_threshold {
                    Some(t) => t,
                    None => continue,
                };

                let deleted = conn.execute(
                    "DELETE FROM persona_executions
             WHERE persona_id = ?1
               AND status IN ('completed', 'failed', 'incomplete', 'cancelled')
               AND created_at < datetime('now', ?2)
               AND created_at <= ?3",
                    params![pid, cutoff, keep_threshold],
                )?;

                total_deleted += deleted;
            }

            Ok(total_deleted)
        }
    )
}

/// One recipe's run tally, from executions stamped with its provenance.
///
/// Raw counts rather than a pre-computed rate: what belongs in the denominator
/// of "success rate" is a product judgement (does a cancelled run count against
/// the recipe?), and baking one in would hide it. `terminal` is the honest
/// denominator — queued/running rows are not outcomes yet.
#[derive(Debug, Clone, PartialEq)]
pub struct RecipeRunTally {
    pub recipe_id: String,
    /// Recipe display name, or `None` if the recipe row has since been deleted
    /// (the runs stay attributed — provenance is a fact about the past).
    pub recipe_name: Option<String>,
    /// Every execution stamped with this recipe, any status.
    pub runs: i64,
    /// Runs that reached a terminal status (completed/failed/incomplete/cancelled).
    pub terminal: i64,
    pub completed: i64,
    pub failed: i64,
    /// Runs whose persona self-assessed that it actually delivered its job.
    /// A stricter, more meaningful bar than `completed`.
    pub value_delivered: i64,
    /// ISO-8601 timestamp of the most recent run, or `None` if never run.
    pub last_run_at: Option<String>,
}

/// Runs-per-recipe and success-rate-per-recipe, over every execution carrying
/// recipe provenance. Ordered by run count descending, so "which recipes do
/// people actually use" reads off the top.
///
/// Recipes that have never been run do not appear — this reports outcomes, and
/// a recipe with no runs has none. Executions predating provenance stamping
/// have a NULL `source_recipe_id` and are excluded, not guessed at.
pub fn recipe_run_tallies(pool: &DbPool, limit: i64) -> Result<Vec<RecipeRunTally>, AppError> {
    timed_query!(
        "persona_executions",
        "persona_executions::recipe_run_tallies",
        {
            let conn = pool.conn("executions::recipe_run_tallies")?;
            let mut stmt = conn.prepare_cached(
            "SELECT e.source_recipe_id                                            AS recipe_id,
                    r.name                                                        AS recipe_name,
                    COUNT(*)                                                      AS runs,
                    SUM(e.status IN ('completed','failed','incomplete','cancelled')) AS terminal,
                    SUM(e.status = 'completed')                                   AS completed,
                    SUM(e.status = 'failed')                                      AS failed,
                    SUM(COALESCE(e.business_outcome,'') = 'value_delivered')      AS value_delivered,
                    MAX(e.created_at)                                             AS last_run_at
             FROM persona_executions e
             LEFT JOIN recipe_definitions r ON r.id = e.source_recipe_id
             WHERE e.source_recipe_id IS NOT NULL
             GROUP BY e.source_recipe_id, r.name
             ORDER BY runs DESC, last_run_at DESC
             LIMIT ?1",
        )?;
            let rows = stmt.query_map(params![limit], |row| {
                Ok(RecipeRunTally {
                    recipe_id: row.get("recipe_id")?,
                    recipe_name: row.get("recipe_name")?,
                    runs: row.get("runs")?,
                    terminal: row.get("terminal")?,
                    completed: row.get("completed")?,
                    failed: row.get("failed")?,
                    value_delivered: row.get("value_delivered")?,
                    last_run_at: row.get("last_run_at")?,
                })
            })?;
            Ok(crate::repos::utils::collect_rows(
                rows,
                "persona_executions::recipe_run_tallies",
            ))
        }
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Both projection consts, and the alias-qualified form of the first, must
    /// prepare against the real migrated schema. A by-name read of a column
    /// the table does not have compiles fine and fails at runtime on the first
    /// row — which is exactly how `list_items_by_persona_id` stayed broken for
    /// three months. This test is the gate that would have caught it.
    #[test]
    fn every_projection_prepares_against_the_real_schema() {
        let pool = init_test_db().unwrap();
        let conn = pool.get().unwrap();
        for columns in [COLUMNS.to_string(), LIST_ITEM_COLUMNS.to_string()] {
            let sql = format!("SELECT {columns} FROM persona_executions LIMIT 0");
            conn.prepare(&sql).unwrap_or_else(|e| {
                panic!("persona_executions projection does not match schema: {e}")
            });
        }
        let sql = format!(
            "SELECT {} FROM persona_executions e LIMIT 0",
            columns_for("e")
        );
        conn.prepare(&sql)
            .unwrap_or_else(|e| panic!("aliased persona_executions projection is wrong: {e}"));
    }

    /// `list_items_by_persona_id` returned
    /// `Err(InvalidColumnName("business_outcome"))` on EVERY call between
    /// 2026-05-11 and this commit: `business_outcome` was added to
    /// `row_to_execution_list_item` and to nothing else, while this function's
    /// hand-written projection was left at fifteen columns. Nothing failed to
    /// compile, no other caller shares the mapper, and the file had no test
    /// that ran the query — so the Tauri command behind the persona execution
    /// list simply always errored. Assert the rows come back, and that the
    /// field the projection forgot has a value.
    #[test]
    fn list_items_projection_covers_every_field_the_mapper_reads() {
        let pool = init_test_db().unwrap();
        let persona_id = make_persona(&pool, "List Items Agent");
        let created = create(&pool, &persona_id, None, None, None, None).unwrap();

        let items = list_items_by_persona_id(&pool, &persona_id, None, None)
            .expect("list_items_by_persona_id must not fail");
        assert_eq!(items.len(), 1);
        let item = &items[0];
        assert_eq!(item.id, created.id);
        assert_eq!(item.persona_id, persona_id);
        assert_eq!(item.business_outcome, "unknown");
    }
    use crate::init_test_db;
    use crate::models::{CreatePersonaInput, Json};
    use crate::repos::core::personas;

    fn make_persona(pool: &DbPool, name: &str) -> String {
        personas::create(
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
                notification_channels: None,
                lifecycle: None,
            },
        )
        .unwrap()
        .id
    }

    #[test]
    fn test_claim_for_instance_cas() {
        let pool = init_test_db().unwrap();
        let persona_id = make_persona(&pool, "Claim Test Agent");
        let exec = create(&pool, &persona_id, None, None, None, None).unwrap();
        assert_eq!(exec.status, "queued");

        // Two instances race for the same queued row; exactly one wins.
        let a = claim_for_instance(&pool, &exec.id, "instance-A", 300).unwrap();
        let b = claim_for_instance(&pool, &exec.id, "instance-B", 300).unwrap();
        assert!(a, "first claimant must win");
        assert!(
            !b,
            "second claimant must lose — row no longer queued + unexpired"
        );

        // The row is now running and stamped with the winner.
        let claimed = get_by_id(&pool, &exec.id).unwrap();
        assert_eq!(claimed.status, "running");

        // A second queued execution can still be claimed independently.
        let exec2 = create(&pool, &persona_id, None, None, None, None).unwrap();
        assert!(claim_for_instance(&pool, &exec2.id, "instance-B", 300).unwrap());
    }

    #[test]
    fn test_claim_expired_is_reclaimable() {
        let pool = init_test_db().unwrap();
        let persona_id = make_persona(&pool, "Expired Claim Agent");
        let exec = create(&pool, &persona_id, None, None, None, None).unwrap();

        // Claim with a NEGATIVE ttl → claim_expires_at is already in the past,
        // and status flips to running. Re-queue it, then a fresh claim must
        // win because the prior claim's TTL has expired (crash-recovery path).
        assert!(claim_for_instance(&pool, &exec.id, "dead-instance", -10).unwrap());
        update_status(
            &pool,
            &exec.id,
            UpdateExecutionStatus {
                status: ExecutionState::Queued,
                ..Default::default()
            },
        )
        .unwrap();
        assert!(
            claim_for_instance(&pool, &exec.id, "live-instance", 300).unwrap(),
            "an expired claim on a re-queued row must be re-claimable"
        );
    }

    #[test]
    fn test_execution_crud() {
        let pool = init_test_db().unwrap();

        // Create a persona first (required by FK)
        let persona = personas::create(
            &pool,
            CreatePersonaInput {
                name: "Exec Test Agent".into(),
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
                notification_channels: None,
                lifecycle: None,
            },
        )
        .unwrap();

        // Create execution
        let exec = create(
            &pool,
            &persona.id,
            None,
            Some("test input".into()),
            Some("claude-sonnet".into()),
            None,
        )
        .unwrap();
        assert_eq!(exec.status, "queued");
        assert_eq!(exec.persona_id, persona.id);
        assert_eq!(exec.input_data, Some("test input".into()));
        assert_eq!(exec.model_used, Some("claude-sonnet".into()));
        assert_eq!(exec.input_tokens, 0);
        assert_eq!(exec.output_tokens, 0);
        assert!(exec.started_at.is_none());

        // Get by id
        let fetched = get_by_id(&pool, &exec.id).unwrap();
        assert_eq!(fetched.id, exec.id);

        // Get by persona id
        let by_persona = get_by_persona_id(&pool, &persona.id, None).unwrap();
        assert_eq!(by_persona.len(), 1);

        // Get running
        let running = get_running(&pool).unwrap();
        assert_eq!(running.len(), 1); // queued counts as running

        // Get running count for persona
        let count = get_running_count_for_persona(&pool, &persona.id).unwrap();
        assert_eq!(count, 1);

        // Update status to running
        update_status(
            &pool,
            &exec.id,
            UpdateExecutionStatus {
                status: ExecutionState::Running,
                ..Default::default()
            },
        )
        .unwrap();
        let updated = get_by_id(&pool, &exec.id).unwrap();
        assert_eq!(updated.status, "running");
        assert!(updated.started_at.is_some());
        assert!(updated.completed_at.is_none());

        // Update status to completed with token data
        update_status(
            &pool,
            &exec.id,
            UpdateExecutionStatus {
                status: ExecutionState::Completed,
                output_data: Some("output result".into()),
                duration_ms: Some(1500),
                log_file_path: Some("/tmp/log.txt".into()),
                execution_flows: Some(Json(serde_json::from_str("{\"flows\": []}").unwrap())),
                input_tokens: Some(100),
                output_tokens: Some(200),
                cost_usd: Some(0.005),
                ..Default::default()
            },
        )
        .unwrap();
        let completed = get_by_id(&pool, &exec.id).unwrap();
        assert_eq!(completed.status, "completed");
        assert_eq!(completed.output_data, Some("output result".into()));
        assert_eq!(completed.duration_ms, Some(1500));
        assert_eq!(completed.input_tokens, 100);
        assert_eq!(completed.output_tokens, 200);
        assert!((completed.cost_usd - 0.005).abs() < f64::EPSILON);
        assert!(completed.completed_at.is_some());

        // Get recent
        let recent = get_recent(&pool, Some(10)).unwrap();
        assert_eq!(recent.len(), 1);

        // After completion, running count should be 0
        let count_after = get_running_count_for_persona(&pool, &persona.id).unwrap();
        assert_eq!(count_after, 0);

        // Delete
        let deleted = delete(&pool, &exec.id).unwrap();
        assert!(deleted);
        assert!(get_by_id(&pool, &exec.id).is_err());
    }

    /// P1 durability invariant: startup recovery must distinguish mid-RUN rows
    /// (to fail) from durable `queued` rows (to re-admit). `get_running_only`
    /// sees only `running`; `get_queued_only` sees only `queued`; the legacy
    /// `get_running` union still sees both.
    #[test]
    fn running_only_and_queued_only_partition_by_status() {
        let pool = init_test_db().unwrap();
        let persona_id = make_persona(&pool, "Partition Agent");

        // One row left queued, one promoted to running (as at shutdown).
        let queued = create(&pool, &persona_id, None, None, None, None).unwrap();
        let running = create(&pool, &persona_id, None, None, None, None).unwrap();
        update_status(
            &pool,
            &running.id,
            UpdateExecutionStatus {
                status: ExecutionState::Running,
                ..Default::default()
            },
        )
        .unwrap();

        let running_only = get_running_only(&pool).unwrap();
        assert_eq!(running_only.len(), 1);
        assert_eq!(running_only[0].id, running.id);

        let queued_only = get_queued_only(&pool).unwrap();
        assert_eq!(queued_only.len(), 1);
        assert_eq!(queued_only[0].id, queued.id);

        // The legacy union still returns both (back-compat).
        assert_eq!(get_running(&pool).unwrap().len(), 2);

        // A completed row is in neither partition.
        update_status(
            &pool,
            &running.id,
            UpdateExecutionStatus {
                status: ExecutionState::Completed,
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(get_running_only(&pool).unwrap().len(), 0);
        assert_eq!(get_queued_only(&pool).unwrap().len(), 1);
    }

    /// `get_retry_chains_batch` bound its numbered placeholder list twice
    /// (once per `IN` clause) while the statement only has `n` parameters, so
    /// every non-empty call failed with InvalidParameterCount and the healing
    /// timeline silently lost its retry chains. Guard: a real root + retry
    /// must come back grouped.
    #[test]
    fn get_retry_chains_batch_returns_the_chain() {
        let pool = init_test_db().unwrap();
        let persona_id = make_persona(&pool, "Retry Chain Agent");

        let root = create(&pool, &persona_id, None, None, None, None).unwrap();
        let retry = create_retry(&pool, &persona_id, &root.id, 1).unwrap();

        let ids = [root.id.as_str()];
        let chains = get_retry_chains_batch(&pool, &ids).unwrap();

        let chain = chains.get(&root.id).expect("root must map to its chain");
        let found: Vec<&str> = chain.iter().map(|e| e.id.as_str()).collect();
        assert!(
            found.contains(&root.id.as_str()),
            "root is part of its chain"
        );
        assert!(
            found.contains(&retry.id.as_str()),
            "retry is part of the chain"
        );
        assert_eq!(chain.len(), 2);

        // Empty input short-circuits without touching the DB.
        assert!(get_retry_chains_batch(&pool, &[]).unwrap().is_empty());
        // An unknown id yields no entry rather than an error.
        assert!(get_retry_chains_batch(&pool, &["nope"]).unwrap().is_empty());
    }

    /// A `queued` execution has not started, but it IS in flight — the
    /// Activity "Running" badge must count it. Regression guard: the bucket
    /// used to match only `running`/`pending`, so every queued row was
    /// invisible in the badge while still counted in `total`.
    #[test]
    fn count_all_global_counts_queued_as_running() {
        let pool = init_test_db().unwrap();
        let persona_id = make_persona(&pool, "Counts Agent");

        // Two queued, one promoted to running, one completed.
        create(&pool, &persona_id, None, None, None, None).unwrap();
        create(&pool, &persona_id, None, None, None, None).unwrap();
        let running = create(&pool, &persona_id, None, None, None, None).unwrap();
        let done = create(&pool, &persona_id, None, None, None, None).unwrap();
        update_status(
            &pool,
            &running.id,
            UpdateExecutionStatus {
                status: ExecutionState::Running,
                ..Default::default()
            },
        )
        .unwrap();
        update_status(
            &pool,
            &done.id,
            UpdateExecutionStatus {
                status: ExecutionState::Completed,
                ..Default::default()
            },
        )
        .unwrap();

        let counts = count_all_global(&pool, None).unwrap();
        assert_eq!(counts.total, 4);
        assert_eq!(counts.running, 3, "2 queued + 1 running are all in flight");
        assert_eq!(counts.completed, 1);
        assert_eq!(counts.failed, 0);

        // The per-persona filter path must agree with the unfiltered one.
        let scoped = count_all_global(&pool, Some(&persona_id)).unwrap();
        assert_eq!(scoped.running, 3);
        assert_eq!(scoped.total, 4);
    }

    // =====================================================================
    // In-flight chain grouping (Direction 2) — pure, DB-free
    // =====================================================================

    fn row(persona: &str, input: Option<&str>, started: &str) -> ActiveChainRow {
        ActiveChainRow {
            persona_id: persona.into(),
            input_data: input.map(String::from),
            started_at: started.into(),
        }
    }

    #[test]
    fn group_active_chains_ignores_non_chain_and_null_input() {
        // No input, and input without a chain trace id, both produce no chain.
        let rows = vec![
            row("p1", None, "2026-07-10T00:00:01Z"),
            row("p2", Some(r#"{"foo":"bar"}"#), "2026-07-10T00:00:02Z"),
        ];
        assert!(group_active_chains(&rows).is_empty());
    }

    #[test]
    fn group_active_chains_groups_by_trace_and_isolates_chains() {
        // chain-A: two in-flight hops (raw + wrapped shapes) across two personas;
        // chain-B: one hop. They must not bleed together.
        let raw_a = r#"{"_chain_trace_id":"chain-A","_chain_depth":1,"_chain_cost_usd":0.20}"#;
        let wrapped_a = r#"{"_event":{"event_type":"chain_triggered"},"payload":{"_chain_trace_id":"chain-A","_chain_depth":3,"_chain_cost_usd":0.50}}"#;
        let raw_b = r#"{"_chain_trace_id":"chain-B","_chain_depth":0,"_chain_cost_usd":0.05}"#;
        let rows = vec![
            row("p-a", Some(raw_a), "2026-07-10T00:00:05Z"),
            row("p-b", Some(wrapped_a), "2026-07-10T00:00:02Z"),
            row("p-c", Some(raw_b), "2026-07-10T00:00:09Z"),
        ];
        let chains = group_active_chains(&rows);
        assert_eq!(chains.len(), 2);
        // Oldest-first ordering: chain-A's oldest hop (00:00:02) precedes chain-B.
        let a = &chains[0];
        assert_eq!(a.chain_trace_id, "chain-A");
        assert_eq!(a.in_flight_count, 2);
        // max depth across the two hops.
        assert_eq!(a.max_depth, 3);
        // Accumulated cost = max propagated _chain_cost_usd (deepest hop).
        assert!((a.accumulated_cost_usd - 0.50).abs() < 1e-9);
        // Both personas, first-seen order (wrapped hop parsed second in vec order
        // but the raw hop for p-a appears first).
        assert_eq!(a.persona_ids, vec!["p-a".to_string(), "p-b".to_string()]);
        // Oldest across the group.
        assert_eq!(a.oldest_started_at, "2026-07-10T00:00:02Z");

        let b = &chains[1];
        assert_eq!(b.chain_trace_id, "chain-B");
        assert_eq!(b.in_flight_count, 1);
        assert_eq!(b.max_depth, 0);
    }

    #[test]
    fn group_active_chains_dedups_personas_within_a_chain() {
        // Same persona twice in one chain → counted once in persona_ids but the
        // in_flight_count still reflects both runs.
        let one = r#"{"_chain_trace_id":"chain-X","_chain_depth":1,"_chain_cost_usd":0.1}"#;
        let rows = vec![
            row("p-dup", Some(one), "2026-07-10T00:00:01Z"),
            row("p-dup", Some(one), "2026-07-10T00:00:02Z"),
        ];
        let chains = group_active_chains(&rows);
        assert_eq!(chains.len(), 1);
        assert_eq!(chains[0].in_flight_count, 2);
        assert_eq!(chains[0].persona_ids, vec!["p-dup".to_string()]);
    }

    #[test]
    fn list_active_chains_empty_when_nothing_running() {
        let pool = init_test_db().unwrap();
        assert!(list_active_chains(&pool).unwrap().is_empty());
    }

    // ---- Recipe outcome attribution ------------------------------------

    /// Persona whose design_context carries one recipe-adopted use case
    /// (`uc-recipe`) and one hand-built one (`uc-manual`).
    fn make_persona_with_adopted_use_case(pool: &DbPool, name: &str) -> String {
        let ctx = serde_json::json!({
            "useCases": [
                {
                    "id": "uc-recipe",
                    "title": "Adopted capability",
                    "source_recipe_id": "recipe-abc",
                    "source_recipe_version": "3",
                },
                { "id": "uc-manual", "title": "Hand-built capability" },
            ]
        })
        .to_string();
        let id = make_persona(pool, name);
        crate::repos::core::personas::update(
            pool,
            &id,
            crate::models::UpdatePersonaInput {
                design_context: Some(Some(ctx)),
                ..Default::default()
            },
        )
        .unwrap();
        id
    }

    fn provenance_of(pool: &DbPool, execution_id: &str) -> (Option<String>, Option<String>) {
        let conn = pool.get().unwrap();
        conn.query_row(
            "SELECT source_recipe_id, source_recipe_version FROM persona_executions WHERE id = ?1",
            params![execution_id],
            |row| {
                Ok((
                    row.get("source_recipe_id")?,
                    row.get("source_recipe_version")?,
                ))
            },
        )
        .unwrap()
    }

    #[test]
    fn run_from_adopted_use_case_stamps_the_recipe() {
        let pool = init_test_db().unwrap();
        let persona_id = make_persona_with_adopted_use_case(&pool, "Recipe Runner");

        let exec = create(
            &pool,
            &persona_id,
            None,
            None,
            None,
            Some("uc-recipe".into()),
        )
        .unwrap();

        assert_eq!(
            provenance_of(&pool, &exec.id),
            (Some("recipe-abc".to_string()), Some("3".to_string())),
            "an execution from an adopted use case must carry its recipe id and pinned version"
        );
    }

    #[test]
    fn run_without_recipe_provenance_stamps_null_not_a_sentinel() {
        let pool = init_test_db().unwrap();
        let persona_id = make_persona_with_adopted_use_case(&pool, "Mixed Runner");

        // A use case that was never adopted from a recipe.
        let manual = create(
            &pool,
            &persona_id,
            None,
            None,
            None,
            Some("uc-manual".into()),
        )
        .unwrap();
        assert_eq!(provenance_of(&pool, &manual.id), (None, None));

        // No use case at all (an ad-hoc / trigger run).
        let adhoc = create(&pool, &persona_id, None, None, None, None).unwrap();
        assert_eq!(provenance_of(&pool, &adhoc.id), (None, None));

        // A use case id that is not in design_context (stale caller).
        let stale = create(&pool, &persona_id, None, None, None, Some("uc-gone".into())).unwrap();
        assert_eq!(provenance_of(&pool, &stale.id), (None, None));
    }

    #[test]
    fn detaching_the_capability_does_not_rewrite_past_runs() {
        // The whole reason provenance is denormalized onto the row: removing a
        // capability must not retroactively un-attribute its history.
        let pool = init_test_db().unwrap();
        let persona_id = make_persona_with_adopted_use_case(&pool, "Detach Test");
        let exec = create(
            &pool,
            &persona_id,
            None,
            None,
            None,
            Some("uc-recipe".into()),
        )
        .unwrap();

        crate::repos::core::personas::update(
            &pool,
            &persona_id,
            crate::models::UpdatePersonaInput {
                design_context: Some(Some(r#"{"useCases":[]}"#.to_string())),
                ..Default::default()
            },
        )
        .unwrap();

        assert_eq!(
            provenance_of(&pool, &exec.id).0,
            Some("recipe-abc".to_string()),
        );
    }

    #[test]
    fn retry_inherits_the_original_runs_recipe() {
        let pool = init_test_db().unwrap();
        let persona_id = make_persona_with_adopted_use_case(&pool, "Retry Test");
        let original = create(
            &pool,
            &persona_id,
            None,
            None,
            None,
            Some("uc-recipe".into()),
        )
        .unwrap();

        let retry = create_retry(&pool, &persona_id, &original.id, 1).unwrap();
        assert_eq!(
            provenance_of(&pool, &retry.id),
            (Some("recipe-abc".to_string()), Some("3".to_string())),
            "a retry re-attempts the same work and must stay attributed to the same recipe"
        );
    }

    #[test]
    fn tallies_answer_runs_and_success_rate_per_recipe() {
        let pool = init_test_db().unwrap();
        let persona_id = make_persona_with_adopted_use_case(&pool, "Tally Test");

        let mk = |status: &str, outcome: Option<&str>| {
            let e = create(
                &pool,
                &persona_id,
                None,
                None,
                None,
                Some("uc-recipe".into()),
            )
            .unwrap();
            let conn = pool.get().unwrap();
            conn.execute(
                "UPDATE persona_executions SET status = ?2, business_outcome = COALESCE(?3, business_outcome) WHERE id = ?1",
                params![e.id, status, outcome],
            )
            .unwrap();
        };
        mk("completed", Some("value_delivered"));
        mk("completed", Some("no_input_available"));
        mk("failed", None);
        mk("running", None);
        // A run with no recipe behind it must not pollute any recipe's tally.
        create(
            &pool,
            &persona_id,
            None,
            None,
            None,
            Some("uc-manual".into()),
        )
        .unwrap();

        let tallies = recipe_run_tallies(&pool, 50).unwrap();
        assert_eq!(tallies.len(), 1, "only recipe-attributed runs are tallied");
        let t = &tallies[0];
        assert_eq!(t.recipe_id, "recipe-abc");
        assert_eq!(t.runs, 4);
        // The still-running row is not an outcome yet, so it stays out of the
        // success-rate denominator.
        assert_eq!(t.terminal, 3);
        assert_eq!(t.completed, 2);
        assert_eq!(t.failed, 1);
        // Stricter than `completed`: one of the two completions delivered nothing.
        assert_eq!(t.value_delivered, 1);
        assert!(t.last_run_at.is_some());
        // No recipe_definitions row was seeded, so the name is honestly absent
        // rather than fabricated.
        assert_eq!(t.recipe_name, None);
    }

    #[test]
    fn tallies_are_empty_before_any_recipe_run() {
        let pool = init_test_db().unwrap();
        assert!(recipe_run_tallies(&pool, 50).unwrap().is_empty());
    }
}
