/// Build a dynamic SQL SET clause field-by-field.
///
/// Checks if an `Option` value is `Some`, and if so, appends
/// `"column = ?N"` to `sets` and increments `param_idx`.
///
/// # Usage
///
/// ```ignore
/// // With an `input` struct whose fields are Option<T>:
/// push_field!(input.name, "name", sets, param_idx);
///
/// // With a local Option variable:
/// push_field!(my_var, "column_name", sets, param_idx);
/// ```
#[macro_export]
macro_rules! push_field {
    ($field:expr, $col:expr, $sets:expr, $param_idx:expr) => {
        if $field.is_some() {
            $sets.push(format!("{} = ?{}", $col, $param_idx));
            $param_idx += 1;
        }
    };
}

/// Build a dynamic SET clause AND collect the parameter in a single call.
///
/// Combines `push_field!` with parameter collection, eliminating the need
/// for a mirrored if-let chain. The kind annotation controls how the value
/// is boxed:
///
/// - `clone` — `Box::new(v.clone())`        (String, Option<String>)
/// - `copy`  — `Box::new(*v)`               (i32, f64 — Copy types)
/// - `bool`  — `Box::new(*v as i32)`        (bool stored as integer)
/// - `as_str` — `Box::new(v.as_str().to_string())` (enums with as_str())
///
/// # Usage
///
/// ```ignore
/// push_field_param!(input.name, "name", sets, param_idx, params, clone);
/// push_field_param!(input.timeout_ms, "timeout_ms", sets, param_idx, params, copy);
/// push_field_param!(input.deployment_status, "deployment_status", sets, param_idx, params, as_str);
/// ```
#[macro_export]
macro_rules! push_field_param {
    ($field:expr, $col:expr, $sets:expr, $param_idx:expr, $params:expr, clone) => {
        if let Some(ref v) = $field {
            $sets.push(format!("{} = ?{}", $col, $param_idx));
            $param_idx += 1;
            $params.push(Box::new(v.clone()) as Box<dyn rusqlite::types::ToSql>);
        }
    };
    ($field:expr, $col:expr, $sets:expr, $param_idx:expr, $params:expr, copy) => {
        if let Some(ref v) = $field {
            $sets.push(format!("{} = ?{}", $col, $param_idx));
            $param_idx += 1;
            $params.push(Box::new(*v) as Box<dyn rusqlite::types::ToSql>);
        }
    };
    ($field:expr, $col:expr, $sets:expr, $param_idx:expr, $params:expr, bool) => {
        if let Some(ref v) = $field {
            $sets.push(format!("{} = ?{}", $col, $param_idx));
            $param_idx += 1;
            $params.push(Box::new(*v as i32) as Box<dyn rusqlite::types::ToSql>);
        }
    };
    ($field:expr, $col:expr, $sets:expr, $param_idx:expr, $params:expr, as_str) => {
        if let Some(ref v) = $field {
            $sets.push(format!("{} = ?{}", $col, $param_idx));
            $param_idx += 1;
            $params.push(Box::new(v.as_str().to_string()) as Box<dyn rusqlite::types::ToSql>);
        }
    };
}

// ============================================================================
// CRUD Repository Macros
//
// Composable macros that generate standard repository functions.
// Each repo module picks the macros it needs; custom methods coexist freely.
// ============================================================================

/// Generate a `row_to_<name>` mapper function from field specifications.
///
/// Field annotations:
/// - *(none)* — `row.get("col")?`  (String, Option<String>, i32, f64, etc.)
/// - `[bool]` — `row.get::<_, i32>("col")? != 0`  (bool stored as integer)
/// - `[opt]`  — `row.get("col").ok().flatten()`  (column may not exist in schema)
///
/// # Example
///
/// ```ignore
/// row_mapper!(row_to_group -> PersonaGroup {
///     id, name, color, sort_order,
///     collapsed [bool],
///     description [opt],
///     created_at, updated_at,
/// });
/// ```
#[macro_export]
macro_rules! row_mapper {
    ($fn_name:ident -> $model:ident {
        $( $field:ident $( [ $kind:ident ] )? ),* $(,)?
    }) => {
        fn $fn_name(row: &rusqlite::Row) -> rusqlite::Result<$model> {
            Ok($model {
                $( $field: row_mapper!(@get row, $field $(, $kind )? ), )*
            })
        }
    };
    (@get $row:ident, $field:ident) => {
        $row.get(stringify!($field))?
    };
    (@get $row:ident, $field:ident, bool) => {
        $row.get::<_, i32>(stringify!($field))? != 0
    };
    (@get $row:ident, $field:ident, opt) => {
        $row.get(stringify!($field)).ok().flatten()
    };
    // Column may not exist yet (migration pending); fall back to a String default.
    (@get $row:ident, $field:ident, opt_str) => {
        $row.get::<_, String>(stringify!($field))
            .unwrap_or_else(|_| "working".to_string())
    };
    // Column may not exist yet; fall back to 0i32.
    (@get $row:ident, $field:ident, opt_i32) => {
        $row.get::<_, i32>(stringify!($field)).unwrap_or(0)
    };
}

/// Generate a standard `get_by_id` function.
///
/// Looks up a single row by primary key `id` and maps `QueryReturnedNoRows`
/// to `AppError::NotFound` with the given entity label.
///
/// # Example
///
/// ```ignore
/// crud_get_by_id!(PersonaGroup, "persona_groups", "PersonaGroup", row_to_group);
/// ```
#[macro_export]
macro_rules! crud_get_by_id {
    ($model:ty, $table:literal, $entity:literal, $mapper:ident) => {
        pub fn get_by_id(
            pool: &$crate::db::DbPool,
            id: &str,
        ) -> Result<$model, $crate::error::AppError> {
            let _start = std::time::Instant::now();
            let conn = pool.get()?;
            let result = conn.query_row(
                concat!("SELECT * FROM ", $table, " WHERE id = ?1"),
                rusqlite::params![id],
                $mapper,
            )
            .map_err(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => {
                    $crate::error::AppError::NotFound(format!(concat!($entity, " {}"), id))
                }
                other => $crate::error::AppError::Database(other),
            });
            $crate::db::perf::record_query($table, concat!($table, "::get_by_id"), _start.elapsed());
            result
        }
    };
}

/// Generate a standard `get_all` function (unfiltered, ordered).
///
/// Returns all rows from the table using `collect_rows` for resilience.
///
/// # Example
///
/// ```ignore
/// crud_get_all!(PersonaGroup, "persona_groups", row_to_group, "sort_order, created_at");
/// ```
#[macro_export]
macro_rules! crud_get_all {
    ($model:ty, $table:literal, $mapper:ident, $order:literal) => {
        pub fn get_all(
            pool: &$crate::db::DbPool,
        ) -> Result<Vec<$model>, $crate::error::AppError> {
            let _start = std::time::Instant::now();
            let conn = pool.get()?;
            let mut stmt =
                conn.prepare(concat!("SELECT * FROM ", $table, " ORDER BY ", $order))?;
            let rows = stmt.query_map([], $mapper)?;
            let result = Ok($crate::db::repos::utils::collect_rows(
                rows,
                concat!($table, "::get_all"),
            ));
            $crate::db::perf::record_query($table, concat!($table, "::get_all"), _start.elapsed());
            result
        }
    };
}

/// Generate a standard `delete` function.
///
/// Deletes a single row by `id` and returns whether a row was affected.
///
/// # Example
///
/// ```ignore
/// crud_delete!("persona_groups");
/// ```
#[macro_export]
macro_rules! crud_delete {
    ($table:literal) => {
        pub fn delete(
            pool: &$crate::db::DbPool,
            id: &str,
        ) -> Result<bool, $crate::error::AppError> {
            let _start = std::time::Instant::now();
            let conn = pool.get()?;
            let rows = conn.execute(
                concat!("DELETE FROM ", $table, " WHERE id = ?1"),
                rusqlite::params![id],
            )?;
            $crate::db::perf::record_query($table, concat!($table, "::delete"), _start.elapsed());
            Ok(rows > 0)
        }
    };
}

/// Generate a standard `update` function with a dynamic SET clause.
///
/// Verifies the row exists via `get_by_id`, builds a partial UPDATE from
/// non-`None` fields, executes it, and returns the refreshed row.
///
/// Field kinds control how values are boxed for the parameter vector:
/// - `clone` — `Box::new(v.clone())`  (String, Option<String>)
/// - `copy`  — `Box::new(v)`          (i32, f64 — Copy types)
/// - `bool`  — `Box::new(v as i32)`   (bool stored as integer)
///
/// # Example
///
/// ```ignore
/// crud_update! {
///     model: PersonaGroup,
///     table: "persona_groups",
///     input: UpdatePersonaGroupInput,
///     fields: {
///         name: clone,
///         color: clone,
///         sort_order: copy,
///         collapsed: bool,
///         description: clone,
///     }
/// }
/// ```
#[macro_export]
macro_rules! crud_update {
    (
        model: $model:ty,
        table: $table:literal,
        input: $input_type:ty,
        fields: {
            $( $field:ident : $kind:ident ),* $(,)?
        }
    ) => {
        pub fn update(
            pool: &$crate::db::DbPool,
            id: &str,
            input: $input_type,
        ) -> Result<$model, $crate::error::AppError> {
            let _start = std::time::Instant::now();
            get_by_id(pool, id)?;

            let now = chrono::Utc::now().to_rfc3339();
            let conn = pool.get()?;

            let mut sets: Vec<String> = vec!["updated_at = ?1".into()];
            let mut param_idx = 2u32;

            $( push_field!(input.$field, stringify!($field), sets, param_idx); )*

            let sql = format!(
                concat!("UPDATE ", $table, " SET {} WHERE id = ?{}"),
                sets.join(", "),
                param_idx
            );

            let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(now)];
            $( crud_update!(@push input.$field, param_values, $kind); )*
            param_values.push(Box::new(id.to_string()));

            let params_ref: Vec<&dyn rusqlite::types::ToSql> =
                param_values.iter().map(|p| p.as_ref()).collect();
            conn.execute(&sql, params_ref.as_slice())?;

            let result = get_by_id(pool, id);
            $crate::db::perf::record_query($table, concat!($table, "::update"), _start.elapsed());
            result
        }
    };

    (@push $field:expr, $params:expr, clone) => {
        if let Some(ref v) = $field {
            $params.push(Box::new(v.clone()));
        }
    };
    (@push $field:expr, $params:expr, copy) => {
        if let Some(v) = $field {
            $params.push(Box::new(v));
        }
    };
    (@push $field:expr, $params:expr, bool) => {
        if let Some(v) = $field {
            $params.push(Box::new(v as i32));
        }
    };
}

/// Wrap a block of DB code with query timing instrumentation.
///
/// Records the duration to the perf ring buffer and emits a `tracing::warn`
/// if the query exceeds the 100ms slow-query threshold.
///
/// # Usage
///
/// ```ignore
/// pub fn get_by_persona(pool: &DbPool, persona_id: &str) -> Result<Vec<Item>, AppError> {
///     timed_query!("my_table", "my_table::get_by_persona", {
///         let conn = pool.get()?;
///         let mut stmt = conn.prepare("SELECT * FROM my_table WHERE persona_id = ?1")?;
///         // ...
///         Ok(results)
///     })
/// }
/// ```
#[macro_export]
macro_rules! timed_query {
    ($table:expr, $operation:expr, $body:expr) => {{
        let _tq_start = std::time::Instant::now();
        let _tq_result = $body;
        $crate::db::perf::record_query($table, $operation, _tq_start.elapsed());
        _tq_result
    }};
}

/// Generate the 7 common CRUD functions shared across lab repo modules.
///
/// Each lab mode (arena, ab, eval, matrix) shares identical implementations
/// for run lookup/status/progress/delete and result lookup. This macro
/// generates all of them from table names, type names, and row mappers.
///
/// The mode-specific functions (`create_run`, `create_result`, row mappers,
/// and any unique helpers like `update_run_draft`) remain hand-written in
/// each module file.
///
/// # Generated functions
///
/// - `get_run_by_id(pool, id)`
/// - `get_runs_by_persona(pool, persona_id, limit)`
/// - `update_run_status(pool, id, status, scenarios_count, summary, error, completed_at)`
/// - `update_progress(pool, run_id, progress_json)`
/// - `delete_run(pool, id)`
/// - `get_result_by_id(pool, id)`
/// - `get_results_by_run(pool, run_id)`
///
/// # Example
///
/// ```ignore
/// lab_crud! {
///     run_table: "lab_arena_runs",
///     result_table: "lab_arena_results",
///     run_type: LabArenaRun,
///     result_type: LabArenaResult,
///     run_entity: "LabArenaRun",
///     result_entity: "LabArenaResult",
///     result_order: "scenario_name, model_id",
///     run_mapper: row_to_run,
///     result_mapper: row_to_result,
/// }
/// ```
#[macro_export]
macro_rules! lab_crud {
    (
        run_table: $run_table:literal,
        result_table: $result_table:literal,
        run_type: $run_type:ty,
        result_type: $result_type:ty,
        run_entity: $run_entity:literal,
        result_entity: $result_entity:literal,
        result_order: $result_order:literal,
        run_mapper: $run_mapper:ident,
        result_mapper: $result_mapper:ident $(,)?
    ) => {
        pub fn get_run_by_id(
            pool: &$crate::db::DbPool,
            id: &str,
        ) -> Result<$run_type, $crate::error::AppError> {
            timed_query!($run_table, concat!($run_table, "::get_run_by_id"), {
                let conn = pool.get()?;
                conn.query_row(
                    concat!("SELECT * FROM ", $run_table, " WHERE id = ?1"),
                    rusqlite::params![id],
                    $run_mapper,
                )
                .map_err(|e| match e {
                    rusqlite::Error::QueryReturnedNoRows => {
                        $crate::error::AppError::NotFound(format!(concat!($run_entity, " {}"), id))
                    }
                    other => $crate::error::AppError::Database(other),
                })
            })
        }

        pub fn get_runs_by_persona(
            pool: &$crate::db::DbPool,
            persona_id: &str,
            limit: Option<i64>,
        ) -> Result<Vec<$run_type>, $crate::error::AppError> {
            timed_query!($run_table, concat!($run_table, "::get_runs_by_persona"), {
                let limit = limit.unwrap_or(20);
                let conn = pool.get()?;
                let mut stmt = conn.prepare(
                    concat!(
                        "SELECT * FROM ", $run_table,
                        " WHERE persona_id = ?1 ORDER BY created_at DESC LIMIT ?2"
                    ),
                )?;
                let rows = stmt.query_map(rusqlite::params![persona_id, limit], $run_mapper)?;
                rows.collect::<Result<Vec<_>, _>>()
                    .map_err($crate::error::AppError::Database)
            })
        }

        pub fn update_run_status(
            pool: &$crate::db::DbPool,
            id: &str,
            status: $crate::db::models::LabRunStatus,
            scenarios_count: Option<i32>,
            summary: Option<&str>,
            error: Option<&str>,
            completed_at: Option<&str>,
        ) -> Result<(), $crate::error::AppError> {
            timed_query!($run_table, concat!($run_table, "::update_run_status"), {
                let conn = pool.get()?;
                let current: String = conn
                    .query_row(
                        concat!("SELECT status FROM ", $run_table, " WHERE id = ?1"),
                        rusqlite::params![id],
                        |row| row.get(0),
                    )
                    .map_err(|e| match e {
                        rusqlite::Error::QueryReturnedNoRows => {
                            $crate::error::AppError::NotFound(format!(concat!($run_entity, " {}"), id))
                        }
                        other => $crate::error::AppError::Database(other),
                    })?;
                let current_status = $crate::db::models::LabRunStatus::from_db(&current);
                current_status
                    .validate_transition(status)
                    .map_err($crate::error::AppError::Validation)?;
                conn.execute(
                    concat!(
                        "UPDATE ", $run_table, " SET",
                        " status = ?1,",
                        " scenarios_count = COALESCE(?2, scenarios_count),",
                        " summary = COALESCE(?3, summary),",
                        " error = COALESCE(?4, error),",
                        " completed_at = COALESCE(?5, completed_at)",
                        " WHERE id = ?6"
                    ),
                    rusqlite::params![status.as_str(), scenarios_count, summary, error, completed_at, id],
                )?;
                Ok(())
            })
        }

        pub fn update_progress(
            pool: &$crate::db::DbPool,
            run_id: &str,
            progress_json: &str,
        ) -> Result<(), $crate::error::AppError> {
            timed_query!($run_table, concat!($run_table, "::update_progress"), {
                let conn = pool.get().map_err(|e| $crate::error::AppError::Internal(e.to_string()))?;
                conn.execute(
                    concat!("UPDATE ", $run_table, " SET progress_json = ?1 WHERE id = ?2"),
                    rusqlite::params![progress_json, run_id],
                )
                .map_err(|e| $crate::error::AppError::Internal(e.to_string()))?;
                Ok(())
            })
        }

        pub fn delete_run(
            pool: &$crate::db::DbPool,
            id: &str,
        ) -> Result<bool, $crate::error::AppError> {
            timed_query!($run_table, concat!($run_table, "::delete_run"), {
                let conn = pool.get()?;
                let rows = conn.execute(
                    concat!("DELETE FROM ", $run_table, " WHERE id = ?1"),
                    rusqlite::params![id],
                )?;
                Ok(rows > 0)
            })
        }

        pub fn get_result_by_id(
            pool: &$crate::db::DbPool,
            id: &str,
        ) -> Result<$result_type, $crate::error::AppError> {
            timed_query!($result_table, concat!($result_table, "::get_result_by_id"), {
                let conn = pool.get()?;
                conn.query_row(
                    concat!("SELECT * FROM ", $result_table, " WHERE id = ?1"),
                    rusqlite::params![id],
                    $result_mapper,
                )
                .map_err(|e| match e {
                    rusqlite::Error::QueryReturnedNoRows => {
                        $crate::error::AppError::NotFound(format!(concat!($result_entity, " {}"), id))
                    }
                    other => $crate::error::AppError::Database(other),
                })
            })
        }

        pub fn get_results_by_run(
            pool: &$crate::db::DbPool,
            run_id: &str,
        ) -> Result<Vec<$result_type>, $crate::error::AppError> {
            timed_query!($result_table, concat!($result_table, "::get_results_by_run"), {
                let conn = pool.get()?;
                let mut stmt = conn.prepare(
                    concat!(
                        "SELECT * FROM ", $result_table,
                        " WHERE run_id = ?1 ORDER BY ", $result_order
                    ),
                )?;
                let rows = stmt.query_map(rusqlite::params![run_id], $result_mapper)?;
                rows.collect::<Result<Vec<_>, _>>()
                    .map_err($crate::error::AppError::Database)
            })
        }
    };
}
