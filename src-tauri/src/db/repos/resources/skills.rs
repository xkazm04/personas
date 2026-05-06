use rusqlite::{params, OptionalExtension, Row};

use crate::db::models::{
    CreateSkillComponentInput, CreateSkillInput, PersonaSkill, Skill, SkillComponent,
    SkillComponentType, SkillWithComponents, UpdateSkillInput,
};
use crate::db::DbPool;
use crate::error::AppError;

// ============================================================================
// Row mappers
// ============================================================================

fn row_to_skill(row: &Row) -> rusqlite::Result<Skill> {
    Ok(Skill {
        id: row.get("id")?,
        name: row.get("name")?,
        version: row.get("version")?,
        description: row.get("description")?,
        category: row.get("category")?,
        is_builtin: row.get::<_, i32>("is_builtin")? != 0,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

fn row_to_component(row: &Row) -> rusqlite::Result<SkillComponent> {
    let type_str: String = row.get("component_type")?;
    let component_type =
        SkillComponentType::from_str(&type_str).unwrap_or(SkillComponentType::Tool);
    Ok(SkillComponent {
        id: row.get("id")?,
        skill_id: row.get("skill_id")?,
        component_type,
        component_data: row.get("component_data")?,
        created_at: row.get("created_at")?,
    })
}

fn row_to_persona_skill(row: &Row) -> rusqlite::Result<PersonaSkill> {
    Ok(PersonaSkill {
        id: row.get("id")?,
        persona_id: row.get("persona_id")?,
        skill_id: row.get("skill_id")?,
        enabled: row.get::<_, i32>("enabled")? != 0,
        config: row.get("config")?,
        created_at: row.get("created_at")?,
    })
}

// ============================================================================
// Skill CRUD
// ============================================================================

pub fn create_skill(pool: &DbPool, input: CreateSkillInput) -> Result<Skill, AppError> {
    timed_query!("skills", "skills::create_skill", {
        if input.name.trim().is_empty() {
            return Err(AppError::Validation("Skill name cannot be empty".into()));
        }

        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let version = input.version.unwrap_or_else(|| "1.0.0".to_string());
        let is_builtin = input.is_builtin.unwrap_or(false) as i32;

        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO skills (id, name, version, description, category, is_builtin, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
            params![id, input.name, version, input.description, input.category, is_builtin, now],
        )?;

        get_skill(pool, &id)
    })
}

pub fn get_skill(pool: &DbPool, id: &str) -> Result<Skill, AppError> {
    timed_query!("skills", "skills::get_skill", {
        let conn = pool.get()?;
        conn.query_row(
            "SELECT * FROM skills WHERE id = ?1",
            params![id],
            row_to_skill,
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => AppError::NotFound(format!("Skill {id}")),
            other => AppError::Database(other),
        })
    })
}

pub fn get_skill_with_components(pool: &DbPool, id: &str) -> Result<SkillWithComponents, AppError> {
    timed_query!("skills", "skills::get_skill_with_components", {
        let skill = get_skill(pool, id)?;
        let components = get_components_for_skill(pool, id)?;
        Ok(SkillWithComponents { skill, components })
    })
}

pub fn list_skills(pool: &DbPool) -> Result<Vec<Skill>, AppError> {
    timed_query!("skills", "skills::list_skills", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare("SELECT * FROM skills ORDER BY category, name")?;
        let rows = stmt.query_map([], row_to_skill)?;
        let skills = rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)?;
        Ok(skills)
    })
}

pub fn update_skill(pool: &DbPool, id: &str, input: UpdateSkillInput) -> Result<Skill, AppError> {
    timed_query!("skills", "skills::update_skill", {
        if let Some(ref name) = input.name {
            if name.trim().is_empty() {
                return Err(AppError::Validation("Skill name cannot be empty".into()));
            }
        }

        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;

        let mut sets: Vec<String> = vec!["updated_at = ?1".into()];
        let mut param_idx = 2u32;
        let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(now)];

        push_field_param!(input.name, "name", sets, param_idx, param_values, clone);
        push_field_param!(
            input.version,
            "version",
            sets,
            param_idx,
            param_values,
            clone
        );
        push_field_param!(
            input.description,
            "description",
            sets,
            param_idx,
            param_values,
            clone
        );
        push_field_param!(
            input.category,
            "category",
            sets,
            param_idx,
            param_values,
            clone
        );

        let sql = format!(
            "UPDATE skills SET {} WHERE id = ?{}",
            sets.join(", "),
            param_idx
        );

        param_values.push(Box::new(id.to_string()));

        let params_ref: Vec<&dyn rusqlite::types::ToSql> =
            param_values.iter().map(|p| p.as_ref()).collect();
        let rows_affected = conn.execute(&sql, params_ref.as_slice())?;

        if rows_affected == 0 {
            return Err(AppError::NotFound(format!("Skill {id}")));
        }

        get_skill(pool, id)
    })
}

pub fn delete_skill(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    timed_query!("skills", "skills::delete_skill", {
        let conn = pool.get()?;
        let rows = conn.execute("DELETE FROM skills WHERE id = ?1", params![id])?;
        Ok(rows > 0)
    })
}

// ============================================================================
// Skill Component CRUD
// ============================================================================

fn get_components_for_skill(
    pool: &DbPool,
    skill_id: &str,
) -> Result<Vec<SkillComponent>, AppError> {
    timed_query!("skill_components", "skill_components::get_for_skill", {
        let conn = pool.get()?;
        let mut stmt =
            conn.prepare("SELECT * FROM skill_components WHERE skill_id = ?1 ORDER BY created_at")?;
        let rows = stmt.query_map(params![skill_id], row_to_component)?;
        let components = rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)?;
        Ok(components)
    })
}

pub fn add_component(
    pool: &DbPool,
    skill_id: &str,
    input: CreateSkillComponentInput,
) -> Result<SkillComponent, AppError> {
    timed_query!("skill_components", "skill_components::add_component", {
        // Validate skill exists
        get_skill(pool, skill_id)?;

        // Validate component_data is valid JSON
        serde_json::from_str::<serde_json::Value>(&input.component_data)
            .map_err(|e| AppError::Validation(format!("component_data must be valid JSON: {e}")))?;

        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let type_str = input.component_type.as_str();

        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO skill_components (id, skill_id, component_type, component_data, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![id, skill_id, type_str, input.component_data, now],
        )?;

        Ok(SkillComponent {
            id,
            skill_id: skill_id.to_string(),
            component_type: input.component_type,
            component_data: input.component_data,
            created_at: now,
        })
    })
}

pub fn remove_component(pool: &DbPool, component_id: &str) -> Result<bool, AppError> {
    timed_query!("skill_components", "skill_components::remove_component", {
        let conn = pool.get()?;
        let rows = conn.execute(
            "DELETE FROM skill_components WHERE id = ?1",
            params![component_id],
        )?;
        Ok(rows > 0)
    })
}

// ============================================================================
// Persona Skill (assignment)
// ============================================================================

pub fn assign_skill_to_persona(
    pool: &DbPool,
    persona_id: &str,
    skill_id: &str,
    config: Option<String>,
) -> Result<PersonaSkill, AppError> {
    timed_query!("persona_skills", "persona_skills::assign", {
        // Validate skill exists
        get_skill(pool, skill_id)?;

        // Validate config shape NOW so we get a typed error at assignment
        // instead of a malformed prompt at trigger fire time.
        if let Some(cfg) = config.as_deref() {
            validate_skill_config(cfg)?;
        }

        let conn = pool.get()?;

        // Return existing assignment if already present
        let existing: Option<PersonaSkill> = conn
            .query_row(
                "SELECT id, persona_id, skill_id, enabled, config, created_at
                 FROM persona_skills WHERE persona_id = ?1 AND skill_id = ?2",
                params![persona_id, skill_id],
                row_to_persona_skill,
            )
            .optional()
            .map_err(AppError::Database)?;

        if let Some(ps) = existing {
            return Ok(ps);
        }

        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();

        conn.execute(
            "INSERT INTO persona_skills (id, persona_id, skill_id, enabled, config, created_at)
             VALUES (?1, ?2, ?3, 1, ?4, ?5)",
            params![id, persona_id, skill_id, config, now],
        )?;

        Ok(PersonaSkill {
            id,
            persona_id: persona_id.to_string(),
            skill_id: skill_id.to_string(),
            enabled: true,
            config,
            created_at: now,
        })
    })
}

pub fn remove_skill_from_persona(
    pool: &DbPool,
    persona_id: &str,
    skill_id: &str,
) -> Result<bool, AppError> {
    timed_query!("persona_skills", "persona_skills::remove", {
        let conn = pool.get()?;
        let rows = conn.execute(
            "DELETE FROM persona_skills WHERE persona_id = ?1 AND skill_id = ?2",
            params![persona_id, skill_id],
        )?;
        Ok(rows > 0)
    })
}

pub fn get_persona_skills(
    pool: &DbPool,
    persona_id: &str,
) -> Result<Vec<SkillWithComponents>, AppError> {
    timed_query!("persona_skills", "persona_skills::get_for_persona", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT s.* FROM skills s
             INNER JOIN persona_skills ps ON ps.skill_id = s.id
             WHERE ps.persona_id = ?1 AND ps.enabled = 1
             ORDER BY s.category, s.name",
        )?;
        let rows = stmt.query_map(params![persona_id], row_to_skill)?;
        let skills = rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)?;

        let mut result = Vec::with_capacity(skills.len());
        for skill in skills {
            let components = get_components_for_skill(pool, &skill.id)?;
            result.push(SkillWithComponents { skill, components });
        }
        Ok(result)
    })
}

// ============================================================================
// Template expansion helper
// ============================================================================
//
// CONTRACT (do not relax without a code review):
//
//   1. The skill config is a flat JSON object whose values are strings only.
//      Booleans, numbers, arrays, objects, and null are rejected at validation
//      time — see `validate_skill_config`. Earlier versions silently coerced
//      non-strings via `.to_string()` and produced literal "true"/"false"
//      placeholders inside a webhook config. That class of bug is now an
//      assignment-time error.
//
//   2. Template expansion is a single, non-recursive pass. A replacement that
//      itself contains `{key}` text is left as-is — we will not re-expand it.
//      This bounds the work and prevents accidental recursion bombs.
//
//   3. Any unresolved `{key}` placeholder left in the output is an
//      `AppError::Validation` with prefix "missing placeholder:". Callers
//      must handle this — the previous "leave raw {key} in the output"
//      behavior is gone.
//
//   4. Validation runs at `assign_skill_to_persona` time so problems surface
//      where the user can act on them, not at trigger fire time when the
//      config is a frozen blob.

/// Validate a skill config blob: must be a flat JSON object with string-only
/// values. Returns the parsed map on success.
///
/// This is the typed-error path the contract refers to: any non-string value
/// produces `AppError::Validation` with a precise message identifying the
/// offending key, so the user sees "skill config: field 'enabled' must be a
/// string, got bool" rather than discovering a malformed prompt at fire time.
pub fn validate_skill_config(
    config: &str,
) -> Result<serde_json::Map<String, serde_json::Value>, AppError> {
    let map: serde_json::Map<String, serde_json::Value> = serde_json::from_str(config)
        .map_err(|e| AppError::Validation(format!("skill config must be a JSON object: {e}")))?;

    for (key, value) in &map {
        if !value.is_string() {
            let kind = match value {
                serde_json::Value::Null => "null",
                serde_json::Value::Bool(_) => "bool",
                serde_json::Value::Number(_) => "number",
                serde_json::Value::Array(_) => "array",
                serde_json::Value::Object(_) => "object",
                serde_json::Value::String(_) => unreachable!(),
            };
            return Err(AppError::Validation(format!(
                "skill config: field '{key}' must be a string, got {kind}"
            )));
        }
    }
    Ok(map)
}

/// Regex matching `{identifier}` placeholders. Identifiers are
/// `[A-Za-z_][A-Za-z0-9_]*` to match Rust/JSON-key conventions and avoid
/// matching JSON-object syntax like `{ "foo"`.
static PLACEHOLDER_RE: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
fn placeholder_re() -> &'static regex::Regex {
    PLACEHOLDER_RE
        .get_or_init(|| regex::Regex::new(r"\{([A-Za-z_][A-Za-z0-9_]*)\}").expect("valid regex"))
}

/// Expand placeholders in a trigger template with user-provided config values.
///
/// See the module-level CONTRACT above for guarantees. Briefly: string values
/// only, single pass, no recursion, unresolved placeholders are an error.
pub fn expand_trigger_template(template_data: &str, config: &str) -> Result<String, AppError> {
    let config_map = validate_skill_config(config)?;

    // Single-pass walk: we iterate the template once and substitute each
    // `{key}` we find. This is intentionally not `String::replace` in a loop —
    // doing so could re-expand a substituted value if it happened to contain
    // another `{key}` literal, breaking the no-recursion guarantee.
    let re = placeholder_re();
    let mut out = String::with_capacity(template_data.len());
    let mut last = 0usize;
    for caps in re.captures_iter(template_data) {
        let mat = caps.get(0).expect("group 0 always matches");
        let key = caps.get(1).expect("group 1 captured");
        out.push_str(&template_data[last..mat.start()]);
        let value = config_map.get(key.as_str()).ok_or_else(|| {
            AppError::Validation(format!(
                "missing placeholder: '{}' is not present in skill config",
                key.as_str()
            ))
        })?;
        // validate_skill_config already proved every value is a string.
        let s = value.as_str().expect("validated as string");
        out.push_str(s);
        last = mat.end();
    }
    out.push_str(&template_data[last..]);
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init_test_db;

    #[test]
    fn test_crud_skills() {
        let pool = init_test_db().unwrap();

        // Create
        let skill = create_skill(
            &pool,
            CreateSkillInput {
                name: "GitHub Integration".into(),
                version: Some("1.0.0".into()),
                description: Some("GitHub PR and issue management".into()),
                category: Some("integrations".into()),
                is_builtin: Some(false),
            },
        )
        .unwrap();
        assert_eq!(skill.name, "GitHub Integration");
        assert_eq!(skill.version, "1.0.0");
        assert!(!skill.is_builtin);

        // Get by ID
        let fetched = get_skill(&pool, &skill.id).unwrap();
        assert_eq!(
            fetched.description.as_deref(),
            Some("GitHub PR and issue management")
        );

        // List all
        let all = list_skills(&pool).unwrap();
        assert_eq!(all.len(), 1);

        // Update
        let updated = update_skill(
            &pool,
            &skill.id,
            UpdateSkillInput {
                name: Some("GitHub Integration v2".into()),
                version: None,
                description: None,
                category: None,
            },
        )
        .unwrap();
        assert_eq!(updated.name, "GitHub Integration v2");

        // Delete
        let deleted = delete_skill(&pool, &skill.id).unwrap();
        assert!(deleted);
        assert!(get_skill(&pool, &skill.id).is_err());
    }

    #[test]
    fn test_skill_components() {
        let pool = init_test_db().unwrap();

        let skill = create_skill(
            &pool,
            CreateSkillInput {
                name: "Slack Skill".into(),
                version: None,
                description: None,
                category: Some("messaging".into()),
                is_builtin: None,
            },
        )
        .unwrap();

        // Add component
        let comp = add_component(
            &pool,
            &skill.id,
            CreateSkillComponentInput {
                component_type: SkillComponentType::Tool,
                component_data: r#"{"name":"send_slack_message","description":"Send a message"}"#
                    .into(),
            },
        )
        .unwrap();
        assert_eq!(comp.component_type, SkillComponentType::Tool);

        // Get with components
        let with_comps = get_skill_with_components(&pool, &skill.id).unwrap();
        assert_eq!(with_comps.components.len(), 1);

        // Remove component
        let removed = remove_component(&pool, &comp.id).unwrap();
        assert!(removed);

        let with_comps_after = get_skill_with_components(&pool, &skill.id).unwrap();
        assert_eq!(with_comps_after.components.len(), 0);
    }

    #[test]
    fn test_persona_skill_assignment() {
        let pool = init_test_db().unwrap();

        // Create persona
        use crate::db::models::CreatePersonaInput;
        let persona = crate::db::repos::core::personas::create(
            &pool,
            CreatePersonaInput {
                name: "Skill Test Agent".into(),
                system_prompt: "You test skills.".into(),
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
                group_id: None,
                notification_channels: None,
            },
        )
        .unwrap();

        let skill = create_skill(
            &pool,
            CreateSkillInput {
                name: "Test Skill".into(),
                version: None,
                description: None,
                category: None,
                is_builtin: None,
            },
        )
        .unwrap();

        // Assign
        let assignment = assign_skill_to_persona(&pool, &persona.id, &skill.id, None).unwrap();
        assert_eq!(assignment.persona_id, persona.id);
        assert!(assignment.enabled);

        // Duplicate assign returns existing
        let dup = assign_skill_to_persona(&pool, &persona.id, &skill.id, None).unwrap();
        assert_eq!(assignment.id, dup.id);

        // Get persona skills
        let skills = get_persona_skills(&pool, &persona.id).unwrap();
        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].skill.name, "Test Skill");

        // Remove
        let removed = remove_skill_from_persona(&pool, &persona.id, &skill.id).unwrap();
        assert!(removed);

        let skills_after = get_persona_skills(&pool, &persona.id).unwrap();
        assert_eq!(skills_after.len(), 0);
    }

    #[test]
    fn test_expand_trigger_template() {
        let template = r#"{"cron": "{schedule}", "channel": "{channel_name}"}"#;
        let config = r##"{"schedule": "0 9 * * 1-5", "channel_name": "#general"}"##;
        let result = expand_trigger_template(template, config).unwrap();
        assert!(result.contains("0 9 * * 1-5"));
        assert!(result.contains("#general"));
    }

    #[test]
    fn test_expand_trigger_template_rejects_non_string_values() {
        // Booleans, numbers, arrays, objects, null must be rejected up front
        // rather than coerced into "true"/"false" — see CONTRACT in
        // skills.rs.
        let template = r#"{"enabled": "{enabled}"}"#;
        for cfg in [
            r#"{"enabled": true}"#,
            r#"{"enabled": 42}"#,
            r#"{"enabled": null}"#,
            r#"{"enabled": [1,2]}"#,
            r#"{"enabled": {"nested":"x"}}"#,
        ] {
            let err = expand_trigger_template(template, cfg).unwrap_err();
            let msg = err.to_string();
            assert!(
                msg.contains("must be a string"),
                "expected typed error for non-string config, got: {msg}"
            );
        }
    }

    #[test]
    fn test_expand_trigger_template_missing_placeholder_errors() {
        // Unresolved placeholders are an error, not silently-left-as-text.
        let template = r#"{"cron": "{schedule}", "channel": "{channel_name}"}"#;
        let config = r#"{"schedule": "0 0 * * *"}"#;
        let err = expand_trigger_template(template, config).unwrap_err();
        let msg = err.to_string();
        assert!(
            msg.contains("missing placeholder") && msg.contains("channel_name"),
            "expected MissingPlaceholder error mentioning channel_name, got: {msg}"
        );
    }

    #[test]
    fn test_expand_trigger_template_single_pass_no_recursion() {
        // If a value happens to contain `{key}` text, we do NOT re-expand it.
        let template = r#"{"a": "{a}", "b": "{b}"}"#;
        let config = r#"{"a": "{b}", "b": "literal"}"#;
        let result = expand_trigger_template(template, config).unwrap();
        // The first pass replaces {a} with "{b}" and {b} with "literal";
        // we MUST NOT then re-expand the freshly-substituted "{b}".
        assert!(result.contains(r#""a": "{b}""#));
        assert!(result.contains(r#""b": "literal""#));
    }

    #[test]
    fn test_validate_skill_config_invalid_json() {
        let err = validate_skill_config("not json at all").unwrap_err();
        assert!(err.to_string().contains("must be a JSON object"));
    }

    #[test]
    fn test_validation() {
        let pool = init_test_db().unwrap();
        let result = create_skill(
            &pool,
            CreateSkillInput {
                name: "  ".into(),
                version: None,
                description: None,
                category: None,
                is_builtin: None,
            },
        );
        assert!(result.is_err());
    }
}
