//! Repository for `persona_responsibilities` — the standing charters a
//! persona holds (living-agent spine, migration `e16_living_agent`).
//!
//! The JSON columns (`outcomes`, `objectives`, `refusal_classes`,
//! `approval_gates`, `cadence`, `tenure`) parse LENIENTLY: bad JSON degrades
//! to the type's default with a `tracing::warn!`, never an error — a corrupt
//! charter must not make the roster unreadable. Writes always serialize from
//! the typed shapes, so leniency only ever repairs foreign/legacy rows.

use rusqlite::{params, OptionalExtension, Row};
use uuid::Uuid;

use crate::models::{
    PersonaResponsibility, ResponsibilityCadence, ResponsibilityObjective, ResponsibilityOutcome,
    ResponsibilityStatus, ResponsibilityTenure,
};
use crate::repos::utils::collect_rows;
use crate::DbPool;
use crate::PoolExt;
use personas_core::error::AppError;

/// Every full-row read goes through this projection — exactly the columns
/// `row_to_responsibility` consumes, nothing else.
const COLUMNS: &str = "id, persona_id, title, domain, outcomes, objectives, \
     scope_rung, refusal_classes, approval_gates, owner, cadence, \
     budget_monthly_usd, tenure, status, project_id, source, created_at, updated_at";

/// `COLUMNS` with every column qualified by `alias` — for joined queries
/// where unqualified `id`/`created_at` would be ambiguous.
fn qualified_columns(alias: &str) -> String {
    COLUMNS
        .split(',')
        .map(|c| format!("{alias}.{}", c.trim()))
        .collect::<Vec<_>>()
        .join(", ")
}

/// Lenient JSON-column parse: bad JSON -> default + warn (see module doc).
fn parse_lenient<T: serde::de::DeserializeOwned + Default>(raw: &str, id: &str, col: &str) -> T {
    match serde_json::from_str(raw) {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!(
                responsibility_id = %id,
                column = %col,
                error = %e,
                "persona_responsibilities: unparsable JSON column — using default",
            );
            T::default()
        }
    }
}

/// Hand-written (not `row_mapper!`) because six columns need the lenient JSON
/// decode above — same reason `row_to_persona_with_mode` is hand-written.
/// Reads strictly by name.
fn row_to_responsibility(row: &Row) -> rusqlite::Result<PersonaResponsibility> {
    let id: String = row.get("id")?;
    let outcomes_raw: String = row.get("outcomes")?;
    let objectives_raw: String = row.get("objectives")?;
    let refusal_raw: String = row.get("refusal_classes")?;
    let gates_raw: String = row.get("approval_gates")?;
    let cadence_raw: String = row.get("cadence")?;
    let tenure_raw: String = row.get("tenure")?;
    Ok(PersonaResponsibility {
        outcomes: parse_lenient::<Vec<ResponsibilityOutcome>>(&outcomes_raw, &id, "outcomes"),
        objectives: parse_lenient::<Vec<ResponsibilityObjective>>(
            &objectives_raw,
            &id,
            "objectives",
        ),
        refusal_classes: parse_lenient::<Vec<String>>(&refusal_raw, &id, "refusal_classes"),
        approval_gates: parse_lenient::<Vec<String>>(&gates_raw, &id, "approval_gates"),
        cadence: parse_lenient::<ResponsibilityCadence>(&cadence_raw, &id, "cadence"),
        tenure: parse_lenient::<ResponsibilityTenure>(&tenure_raw, &id, "tenure"),
        id,
        persona_id: row.get("persona_id")?,
        title: row.get("title")?,
        domain: row.get("domain")?,
        scope_rung: row.get::<_, i64>("scope_rung")?.clamp(0, u8::MAX as i64) as u8,
        owner: row.get("owner")?,
        budget_monthly_usd: row.get("budget_monthly_usd")?,
        status: row.get("status")?,
        project_id: row.get("project_id")?,
        source: row.get("source")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

fn to_json<T: serde::Serialize>(value: &T, what: &str) -> Result<String, AppError> {
    serde_json::to_string(value)
        .map_err(|e| AppError::Internal(format!("serialize responsibility {what}: {e}")))
}

/// Everything a new charter needs; the repo supplies id + timestamps.
pub struct CreateResponsibilityInput<'a> {
    pub persona_id: &'a str,
    pub title: &'a str,
    pub domain: &'a str,
    pub outcomes: &'a [ResponsibilityOutcome],
    pub objectives: &'a [ResponsibilityObjective],
    pub scope_rung: u8,
    pub refusal_classes: &'a [String],
    pub approval_gates: &'a [String],
    pub owner: &'a str,
    pub cadence: &'a ResponsibilityCadence,
    pub budget_monthly_usd: Option<f64>,
    pub tenure: &'a ResponsibilityTenure,
    /// 'draft' | 'active' | 'suspended' | 'retired' (DB CHECK-enforced).
    pub status: &'a str,
    pub project_id: Option<&'a str>,
    pub source: &'a str,
}

pub fn create(
    pool: &DbPool,
    input: CreateResponsibilityInput<'_>,
) -> Result<PersonaResponsibility, AppError> {
    timed_query!("persona_responsibilities", "responsibilities::create", {
        let id = format!("resp_{}", Uuid::new_v4().simple());
        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.conn("responsibilities::create")?;
        conn.execute(
            "INSERT INTO persona_responsibilities
                (id, persona_id, title, domain, outcomes, objectives, scope_rung,
                 refusal_classes, approval_gates, owner, cadence, budget_monthly_usd,
                 tenure, status, project_id, source, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14,
                     ?15, ?16, ?17, ?17)",
            params![
                id,
                input.persona_id,
                input.title,
                input.domain,
                to_json(&input.outcomes, "outcomes")?,
                to_json(&input.objectives, "objectives")?,
                input.scope_rung as i64,
                to_json(&input.refusal_classes, "refusal_classes")?,
                to_json(&input.approval_gates, "approval_gates")?,
                input.owner,
                to_json(input.cadence, "cadence")?,
                input.budget_monthly_usd,
                to_json(input.tenure, "tenure")?,
                input.status,
                input.project_id,
                input.source,
                now,
            ],
        )?;
        let mut stmt = conn.prepare_cached(&format!(
            "SELECT {COLUMNS} FROM persona_responsibilities WHERE id = ?1"
        ))?;
        stmt.query_row(params![id], row_to_responsibility)
            .map_err(AppError::Database)
    })
}

pub fn get_by_id(pool: &DbPool, id: &str) -> Result<Option<PersonaResponsibility>, AppError> {
    timed_query!("persona_responsibilities", "responsibilities::get_by_id", {
        let conn = pool.conn("responsibilities::get_by_id")?;
        let mut stmt = conn.prepare_cached(&format!(
            "SELECT {COLUMNS} FROM persona_responsibilities WHERE id = ?1"
        ))?;
        stmt.query_row(params![id], row_to_responsibility)
            .optional()
            .map_err(AppError::Database)
    })
}

/// A persona's charters, newest first. Retired ones hidden unless asked for.
pub fn list_by_persona(
    pool: &DbPool,
    persona_id: &str,
    include_retired: bool,
) -> Result<Vec<PersonaResponsibility>, AppError> {
    timed_query!(
        "persona_responsibilities",
        "responsibilities::list_by_persona",
        {
            let conn = pool.conn("responsibilities::list_by_persona")?;
            let filter = if include_retired {
                ""
            } else {
                " AND status != 'retired'"
            };
            let sql = format!(
                "SELECT {COLUMNS} FROM persona_responsibilities
                 WHERE persona_id = ?1{filter}
                 ORDER BY created_at DESC, id DESC"
            );
            let mut stmt = conn.prepare_cached(&sql)?;
            let rows = stmt.query_map(params![persona_id], row_to_responsibility)?;
            Ok(collect_rows(rows, "responsibilities::list_by_persona"))
        }
    )
}

/// Every ACTIVE charter on an ENABLED persona whose cadence has the attention
/// loop switched on. This is the attention scheduler's work list; the
/// `attentionEnabled` key is extracted in SQL so the scan never deserializes
/// charters it is going to skip. (`cadence` is camelCase JSON — serialized
/// from `ResponsibilityCadence` with `rename_all = "camelCase"`.)
pub fn list_active_with_attention(pool: &DbPool) -> Result<Vec<PersonaResponsibility>, AppError> {
    timed_query!(
        "persona_responsibilities",
        "responsibilities::list_active_with_attention",
        {
            let conn = pool.conn("responsibilities::list_active_with_attention")?;
            let cols = qualified_columns("r");
            let sql = format!(
                "SELECT {cols} FROM persona_responsibilities r
                 INNER JOIN personas p ON p.id = r.persona_id
                 WHERE p.enabled = 1
                   AND r.status = 'active'
                   AND json_extract(r.cadence, '$.attentionEnabled') = 1
                 ORDER BY r.created_at ASC, r.id ASC"
            );
            let mut stmt = conn.prepare_cached(&sql)?;
            let rows = stmt.query_map([], row_to_responsibility)?;
            Ok(collect_rows(
                rows,
                "responsibilities::list_active_with_attention",
            ))
        }
    )
}

/// A project's charters in one domain, newest first. `only_active` narrows to
/// `status = 'active'` — the filter the mandate accessor
/// (`personas-engine::responsibility`) reads through: a suspended or retired
/// charter grants nothing.
pub fn list_by_project_domain(
    pool: &DbPool,
    project_id: &str,
    domain: &str,
    only_active: bool,
) -> Result<Vec<PersonaResponsibility>, AppError> {
    timed_query!(
        "persona_responsibilities",
        "responsibilities::list_by_project_domain",
        {
            let conn = pool.conn("responsibilities::list_by_project_domain")?;
            let filter = if only_active {
                " AND status = 'active'"
            } else {
                ""
            };
            let sql = format!(
                "SELECT {COLUMNS} FROM persona_responsibilities
                 WHERE project_id = ?1 AND domain = ?2{filter}
                 ORDER BY created_at DESC, id DESC"
            );
            let mut stmt = conn.prepare_cached(&sql)?;
            let rows = stmt.query_map(params![project_id, domain], row_to_responsibility)?;
            Ok(collect_rows(
                rows,
                "responsibilities::list_by_project_domain",
            ))
        }
    )
}

/// Every ACTIVE, project-bound charter in one domain — the mandate accessor's
/// "load them all for this tick" read (rows with no `project_id` cannot be a
/// mandate, so they are filtered in SQL rather than after the decode).
pub fn list_active_project_bound(
    pool: &DbPool,
    domain: &str,
) -> Result<Vec<PersonaResponsibility>, AppError> {
    timed_query!(
        "persona_responsibilities",
        "responsibilities::list_active_project_bound",
        {
            let conn = pool.conn("responsibilities::list_active_project_bound")?;
            let sql = format!(
                "SELECT {COLUMNS} FROM persona_responsibilities
                 WHERE domain = ?1 AND status = 'active' AND project_id IS NOT NULL
                 ORDER BY created_at ASC, id ASC"
            );
            let mut stmt = conn.prepare_cached(&sql)?;
            let rows = stmt.query_map(params![domain], row_to_responsibility)?;
            Ok(collect_rows(
                rows,
                "responsibilities::list_active_project_bound",
            ))
        }
    )
}

/// Whether ANY charter (any status, any domain) exists for this persona on
/// this project — the legacy-mandate migration's idempotency guard.
pub fn exists_for_persona_project(
    pool: &DbPool,
    persona_id: &str,
    project_id: &str,
) -> Result<bool, AppError> {
    timed_query!(
        "persona_responsibilities",
        "responsibilities::exists_for_persona_project",
        {
            let conn = pool.conn("responsibilities::exists_for_persona_project")?;
            let n: i64 = conn.query_row(
                "SELECT COUNT(*) AS n FROM persona_responsibilities
                 WHERE persona_id = ?1 AND project_id = ?2",
                params![persona_id, project_id],
                |r| r.get("n"),
            )?;
            Ok(n > 0)
        }
    )
}

/// Partial update. `None` = leave unchanged; the double-`Option` fields
/// (`budget_monthly_usd`, `project_id`) clear with `Some(None)`. Status moves
/// through [`set_status`], never here.
#[derive(Default)]
pub struct UpdateResponsibilityInput {
    pub title: Option<String>,
    pub domain: Option<String>,
    pub outcomes: Option<Vec<ResponsibilityOutcome>>,
    pub objectives: Option<Vec<ResponsibilityObjective>>,
    pub scope_rung: Option<u8>,
    pub refusal_classes: Option<Vec<String>>,
    pub approval_gates: Option<Vec<String>>,
    pub owner: Option<String>,
    pub cadence: Option<ResponsibilityCadence>,
    pub budget_monthly_usd: Option<Option<f64>>,
    pub tenure: Option<ResponsibilityTenure>,
    pub project_id: Option<Option<String>>,
}

pub fn update(
    pool: &DbPool,
    id: &str,
    input: UpdateResponsibilityInput,
) -> Result<PersonaResponsibility, AppError> {
    timed_query!("persona_responsibilities", "responsibilities::update", {
        // Pre-serialize the typed JSON fields into Option<String>s so the
        // macro arms below stay uniform.
        let outcomes_json = input
            .outcomes
            .as_ref()
            .map(|v| to_json(v, "outcomes"))
            .transpose()?;
        let objectives_json = input
            .objectives
            .as_ref()
            .map(|v| to_json(v, "objectives"))
            .transpose()?;
        let refusal_json = input
            .refusal_classes
            .as_ref()
            .map(|v| to_json(v, "refusal_classes"))
            .transpose()?;
        let gates_json = input
            .approval_gates
            .as_ref()
            .map(|v| to_json(v, "approval_gates"))
            .transpose()?;
        let cadence_json = input
            .cadence
            .as_ref()
            .map(|v| to_json(v, "cadence"))
            .transpose()?;
        let tenure_json = input
            .tenure
            .as_ref()
            .map(|v| to_json(v, "tenure"))
            .transpose()?;
        let scope_rung = input.scope_rung.map(|v| v as i64);

        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.conn("responsibilities::update")?;

        let mut sets: Vec<String> = vec!["updated_at = ?1".into()];
        let mut param_idx = 2u32;
        let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(now)];

        push_field_param!(input.title, "title", sets, param_idx, param_values, clone);
        push_field_param!(input.domain, "domain", sets, param_idx, param_values, clone);
        push_field_param!(
            outcomes_json,
            "outcomes",
            sets,
            param_idx,
            param_values,
            clone
        );
        push_field_param!(
            objectives_json,
            "objectives",
            sets,
            param_idx,
            param_values,
            clone
        );
        push_field_param!(
            scope_rung,
            "scope_rung",
            sets,
            param_idx,
            param_values,
            copy
        );
        push_field_param!(
            refusal_json,
            "refusal_classes",
            sets,
            param_idx,
            param_values,
            clone
        );
        push_field_param!(
            gates_json,
            "approval_gates",
            sets,
            param_idx,
            param_values,
            clone
        );
        push_field_param!(input.owner, "owner", sets, param_idx, param_values, clone);
        push_field_param!(
            cadence_json,
            "cadence",
            sets,
            param_idx,
            param_values,
            clone
        );
        push_field_param!(
            input.budget_monthly_usd,
            "budget_monthly_usd",
            sets,
            param_idx,
            param_values,
            clone
        );
        push_field_param!(tenure_json, "tenure", sets, param_idx, param_values, clone);
        push_field_param!(
            input.project_id,
            "project_id",
            sets,
            param_idx,
            param_values,
            clone
        );

        let sql = format!(
            "UPDATE persona_responsibilities SET {} WHERE id = ?{}",
            sets.join(", "),
            param_idx
        );
        param_values.push(Box::new(id.to_string()));
        let params_ref: Vec<&dyn rusqlite::types::ToSql> =
            param_values.iter().map(|p| p.as_ref()).collect();
        let updated = conn.execute(&sql, params_ref.as_slice())?;
        if updated == 0 {
            return Err(AppError::NotFound(format!("Responsibility {id}")));
        }
        let mut stmt = conn.prepare_cached(&format!(
            "SELECT {COLUMNS} FROM persona_responsibilities WHERE id = ?1"
        ))?;
        stmt.query_row(params![id], row_to_responsibility)
            .map_err(AppError::Database)
    })
}

/// Move a charter through its lifecycle. Takes the TYPED status — the enum,
/// not a string — so an illegal state cannot reach the write at all (callers
/// parse untrusted input via `ResponsibilityStatus::from_str`, which returns
/// a `Validation` error). Returns whether a row changed.
pub fn set_status(pool: &DbPool, id: &str, status: ResponsibilityStatus) -> Result<bool, AppError> {
    timed_query!(
        "persona_responsibilities",
        "responsibilities::set_status",
        {
            let conn = pool.conn("responsibilities::set_status")?;
            let updated = conn.execute(
                "UPDATE persona_responsibilities
             SET status = ?1, updated_at = ?2 WHERE id = ?3",
                params![status.as_str(), chrono::Utc::now().to_rfc3339(), id],
            )?;
            Ok(updated > 0)
        }
    )
}

/// Bump `updated_at` without changing anything else (attention passes touch
/// the charter they just served so staleness ordering stays honest). Touching
/// a charter that does not exist is an error, not a silent no-op.
pub fn touch_updated_at(pool: &DbPool, id: &str) -> Result<(), AppError> {
    timed_query!(
        "persona_responsibilities",
        "responsibilities::touch_updated_at",
        {
            let conn = pool.conn("responsibilities::touch_updated_at")?;
            let updated = conn.execute(
                "UPDATE persona_responsibilities SET updated_at = ?1 WHERE id = ?2",
                params![chrono::Utc::now().to_rfc3339(), id],
            )?;
            if updated == 0 {
                return Err(AppError::NotFound(format!("Responsibility {id}")));
            }
            Ok(())
        }
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::init_test_db;

    fn insert_persona(pool: &DbPool, id: &str, enabled: bool) -> Result<(), AppError> {
        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO personas (id, name, system_prompt, enabled, created_at, updated_at)
             VALUES (?1, ?1, 'sp', ?2, datetime('now'), datetime('now'))",
            params![id, enabled as i32],
        )?;
        Ok(())
    }

    static DEFAULT_CADENCE: std::sync::LazyLock<ResponsibilityCadence> =
        std::sync::LazyLock::new(ResponsibilityCadence::default);
    static DEFAULT_TENURE: std::sync::LazyLock<ResponsibilityTenure> =
        std::sync::LazyLock::new(ResponsibilityTenure::default);

    fn base_input(persona_id: &str) -> CreateResponsibilityInput<'_> {
        CreateResponsibilityInput {
            persona_id,
            title: "Keep the docs honest",
            domain: "docs",
            outcomes: &[],
            objectives: &[],
            scope_rung: 1,
            refusal_classes: &[],
            approval_gates: &[],
            owner: "",
            cadence: &DEFAULT_CADENCE,
            budget_monthly_usd: None,
            tenure: &DEFAULT_TENURE,
            status: "active",
            project_id: None,
            source: "operator",
        }
    }

    #[test]
    fn create_and_get_round_trip_typed_json_columns() -> Result<(), AppError> {
        let pool = init_test_db()?;
        insert_persona(&pool, "p1", true)?;
        let outcomes = vec![ResponsibilityOutcome {
            id: "o1".into(),
            statement: "Docs match shipped behavior".into(),
            success_criteria: vec!["zero stale pages".into()],
        }];
        let cadence = ResponsibilityCadence {
            attention_enabled: true,
            interval_minutes: Some(60),
            quiet_hours: Some("22:00-07:00".into()),
            max_runs_per_day: Some(4),
        };
        let created = create(
            &pool,
            CreateResponsibilityInput {
                outcomes: &outcomes,
                cadence: &cadence,
                budget_monthly_usd: Some(12.5),
                ..base_input("p1")
            },
        )?;
        assert!(created.id.starts_with("resp_"));

        let fetched = get_by_id(&pool, &created.id)?.expect("row");
        assert_eq!(fetched.title, "Keep the docs honest");
        assert_eq!(fetched.outcomes.len(), 1);
        assert_eq!(
            fetched.outcomes[0].success_criteria,
            vec!["zero stale pages"]
        );
        assert!(fetched.cadence.attention_enabled);
        assert_eq!(fetched.cadence.interval_minutes, Some(60));
        assert_eq!(fetched.budget_monthly_usd, Some(12.5));
        assert_eq!(fetched.scope_rung, 1);
        assert!(get_by_id(&pool, "resp_missing")?.is_none());
        Ok(())
    }

    #[test]
    fn corrupt_json_column_degrades_to_default_not_error() -> Result<(), AppError> {
        let pool = init_test_db()?;
        insert_persona(&pool, "p1", true)?;
        let created = create(&pool, base_input("p1"))?;
        pool.get()?.execute(
            "UPDATE persona_responsibilities SET cadence = 'not json', outcomes = '{broken'
             WHERE id = ?1",
            params![created.id],
        )?;
        let fetched = get_by_id(&pool, &created.id)?.expect("row");
        assert!(!fetched.cadence.attention_enabled, "default cadence");
        assert!(fetched.outcomes.is_empty(), "default outcomes");
        Ok(())
    }

    #[test]
    fn list_by_persona_hides_retired_unless_asked() -> Result<(), AppError> {
        let pool = init_test_db()?;
        insert_persona(&pool, "p1", true)?;
        let live = create(&pool, base_input("p1"))?;
        let dead = create(
            &pool,
            CreateResponsibilityInput {
                title: "Old charter",
                ..base_input("p1")
            },
        )?;
        assert!(set_status(&pool, &dead.id, ResponsibilityStatus::Retired)?);

        let visible = list_by_persona(&pool, "p1", false)?;
        assert_eq!(visible.len(), 1);
        assert_eq!(visible[0].id, live.id);
        let all = list_by_persona(&pool, "p1", true)?;
        assert_eq!(all.len(), 2);
        Ok(())
    }

    #[test]
    fn status_parse_rejects_values_outside_the_check_set() -> Result<(), AppError> {
        // The transition door is typed — an illegal state is refused at the
        // parse boundary, before any repo call exists to make.
        let err = "zombie".parse::<ResponsibilityStatus>().unwrap_err();
        assert!(matches!(err, AppError::Validation(_)));
        assert_eq!(
            "retired".parse::<ResponsibilityStatus>()?,
            ResponsibilityStatus::Retired
        );

        let pool = init_test_db()?;
        assert!(!set_status(
            &pool,
            "resp_missing",
            ResponsibilityStatus::Retired
        )?);
        Ok(())
    }

    #[test]
    fn list_active_with_attention_filters_on_all_three_axes() -> Result<(), AppError> {
        let pool = init_test_db()?;
        insert_persona(&pool, "p-on", true)?;
        insert_persona(&pool, "p-off", false)?;
        let attention_on = ResponsibilityCadence {
            attention_enabled: true,
            ..Default::default()
        };

        // Qualifies: enabled persona + active + attentionEnabled.
        let hit = create(
            &pool,
            CreateResponsibilityInput {
                cadence: &attention_on,
                ..base_input("p-on")
            },
        )?;
        // Filtered: attention disabled (default cadence).
        create(&pool, base_input("p-on"))?;
        // Filtered: suspended status.
        let suspended = create(
            &pool,
            CreateResponsibilityInput {
                cadence: &attention_on,
                ..base_input("p-on")
            },
        )?;
        set_status(&pool, &suspended.id, ResponsibilityStatus::Suspended)?;
        // Filtered: disabled persona.
        create(
            &pool,
            CreateResponsibilityInput {
                cadence: &attention_on,
                ..base_input("p-off")
            },
        )?;

        let work_list = list_active_with_attention(&pool)?;
        assert_eq!(work_list.len(), 1);
        assert_eq!(work_list[0].id, hit.id);
        Ok(())
    }

    #[test]
    fn project_domain_reads_filter_on_status_binding_and_domain() -> Result<(), AppError> {
        let pool = init_test_db()?;
        insert_persona(&pool, "p1", true)?;

        // Active software charter on proj-a — the one every read should find.
        let live = create(
            &pool,
            CreateResponsibilityInput {
                domain: "software_engineering",
                project_id: Some("proj-a"),
                ..base_input("p1")
            },
        )?;
        // Retired charter on the same project: visible only when asked for.
        let dead = create(
            &pool,
            CreateResponsibilityInput {
                domain: "software_engineering",
                project_id: Some("proj-a"),
                title: "Old charter",
                ..base_input("p1")
            },
        )?;
        set_status(&pool, &dead.id, ResponsibilityStatus::Retired)?;
        // Same project, different domain: never a software mandate.
        create(
            &pool,
            CreateResponsibilityInput {
                project_id: Some("proj-a"),
                ..base_input("p1") // domain "docs"
            },
        )?;
        // Software domain but unbound: filtered out of the project-bound scan.
        create(
            &pool,
            CreateResponsibilityInput {
                domain: "software_engineering",
                ..base_input("p1")
            },
        )?;

        let active = list_by_project_domain(&pool, "proj-a", "software_engineering", true)?;
        assert_eq!(active.len(), 1);
        assert_eq!(active[0].id, live.id);
        let all = list_by_project_domain(&pool, "proj-a", "software_engineering", false)?;
        assert_eq!(all.len(), 2, "retired shows up when only_active = false");

        let bound = list_active_project_bound(&pool, "software_engineering")?;
        assert_eq!(bound.len(), 1);
        assert_eq!(bound[0].id, live.id);

        assert!(exists_for_persona_project(&pool, "p1", "proj-a")?);
        assert!(!exists_for_persona_project(&pool, "p1", "proj-b")?);
        assert!(!exists_for_persona_project(&pool, "p2", "proj-a")?);
        Ok(())
    }

    #[test]
    fn update_is_partial_and_touch_bumps_updated_at() -> Result<(), AppError> {
        let pool = init_test_db()?;
        insert_persona(&pool, "p1", true)?;
        let r = create(
            &pool,
            CreateResponsibilityInput {
                budget_monthly_usd: Some(5.0),
                ..base_input("p1")
            },
        )?;

        let updated = update(
            &pool,
            &r.id,
            UpdateResponsibilityInput {
                title: Some("Renamed charter".into()),
                budget_monthly_usd: Some(None), // explicit clear
                ..Default::default()
            },
        )?;
        assert_eq!(updated.title, "Renamed charter");
        assert_eq!(updated.budget_monthly_usd, None);
        assert_eq!(updated.domain, "docs", "unmentioned fields untouched");

        pool.get()?.execute(
            "UPDATE persona_responsibilities SET updated_at = '2020-01-01T00:00:00Z'
             WHERE id = ?1",
            params![r.id],
        )?;
        touch_updated_at(&pool, &r.id)?;
        let touched = get_by_id(&pool, &r.id)?.unwrap();
        assert!(touched.updated_at.as_str() > "2020-01-01T00:00:00Z");

        let missing = update(&pool, "resp_missing", UpdateResponsibilityInput::default());
        assert!(matches!(missing, Err(AppError::NotFound(_))));
        assert!(matches!(
            touch_updated_at(&pool, "resp_missing"),
            Err(AppError::NotFound(_))
        ));
        Ok(())
    }
}
