//! Structural validation of an incoming bundle.
//!
//! Extracted verbatim from the former single-file `data_portability.rs`.

use super::*;

pub(crate) fn validate_bundle(bundle: &PortabilityBundle) -> Result<(), AppError> {
    // Top-level array caps
    validation::require_max_count("personas", &bundle.personas, MAX_PERSONAS)?;
    validation::require_max_count("tool_definitions", &bundle.tool_definitions, MAX_TOOLS)?;
    validation::require_max_count("teams", &bundle.teams, MAX_TEAMS)?;
    validation::require_max_count("credentials", &bundle.credentials, MAX_CREDENTIALS)?;
    validation::require_max_count("kpis", &bundle.kpis, MAX_KPIS)?;
    validation::require_max_count("dev_projects", &bundle.dev_projects, MAX_DEV_PROJECTS)?;
    validation::require_max_count("twins", &bundle.twins, MAX_TWINS)?;
    validate_twins(bundle)?;
    validate_athena(bundle)?;
    for (i, w) in bundle.workspace_knowledge.iter().enumerate() {
        validation::require_max_count(
            &format!("workspace_knowledge[{i}].knowledge"),
            &w.knowledge,
            MAX_KNOWLEDGE_ENTRIES,
        )?;
    }

    // Validate tool definitions
    for (i, t) in bundle.tool_definitions.iter().enumerate() {
        validation::require_non_empty(&format!("tool[{i}].name"), &t.name)?;
        validation::require_max_len(&format!("tool[{i}].name"), &t.name, MAX_NAME_LEN)?;
        validation::require_max_len(
            &format!("tool[{i}].category"),
            &t.category,
            MAX_SHORT_FIELD_LEN,
        )?;
        validation::require_max_len(
            &format!("tool[{i}].description"),
            &t.description,
            MAX_DESCRIPTION_LEN,
        )?;
        validation::require_optional_max_len(
            &format!("tool[{i}].input_schema"),
            &t.input_schema,
            MAX_SCHEMA_LEN,
        )?;
        validation::require_optional_max_len(
            &format!("tool[{i}].requires_credential_type"),
            &t.requires_credential_type,
            MAX_SHORT_FIELD_LEN,
        )?;
        validation::require_optional_max_len(
            &format!("tool[{i}].implementation_guide"),
            &t.implementation_guide,
            MAX_DESIGN_CONTEXT_LEN,
        )?;
    }

    // Validate credentials
    for (i, c) in bundle.credentials.iter().enumerate() {
        validation::require_non_empty(&format!("credential[{i}].name"), &c.name)?;
        validation::require_max_len(&format!("credential[{i}].name"), &c.name, MAX_NAME_LEN)?;
        validation::require_max_len(
            &format!("credential[{i}].service_type"),
            &c.service_type,
            MAX_NAME_LEN,
        )?;
        validation::require_optional_max_len(
            &format!("credential[{i}].metadata"),
            &c.metadata,
            MAX_SCHEMA_LEN,
        )?;
    }

    // Validate KPI setup
    for (i, k) in bundle.kpis.iter().enumerate() {
        let prefix = format!("kpi[{i}]");
        validation::require_non_empty(&format!("{prefix}.name"), &k.name)?;
        validation::require_max_len(&format!("{prefix}.name"), &k.name, MAX_NAME_LEN)?;
        validation::require_optional_max_len(
            &format!("{prefix}.description"),
            &k.description,
            MAX_DESCRIPTION_LEN,
        )?;
        validation::require_max_len(
            &format!("{prefix}.category"),
            &k.category,
            MAX_SHORT_FIELD_LEN,
        )?;
        validation::require_max_len(
            &format!("{prefix}.measure_kind"),
            &k.measure_kind,
            MAX_SHORT_FIELD_LEN,
        )?;
        validation::require_max_len(
            &format!("{prefix}.measure_config"),
            &k.measure_config,
            MAX_CONFIG_LEN,
        )?;
        validation::require_max_len(&format!("{prefix}.unit"), &k.unit, MAX_SHORT_FIELD_LEN)?;
        validation::require_max_count(
            &format!("{prefix}.measurements"),
            &k.measurements,
            MAX_KPI_MEASUREMENTS,
        )?;
    }

    // Validate personas and their sub-entities
    for (i, p) in bundle.personas.iter().enumerate() {
        let prefix = format!("persona[{i}]");

        // Core persona fields
        validation::require_non_empty(&format!("{prefix}.name"), &p.name)?;
        validation::require_max_len(&format!("{prefix}.name"), &p.name, MAX_NAME_LEN)?;
        validation::require_max_len(
            &format!("{prefix}.system_prompt"),
            &p.system_prompt,
            MAX_SYSTEM_PROMPT_LEN,
        )?;
        validation::require_optional_max_len(
            &format!("{prefix}.description"),
            &p.description,
            MAX_DESCRIPTION_LEN,
        )?;
        validation::require_optional_max_len(
            &format!("{prefix}.structured_prompt"),
            &p.structured_prompt,
            MAX_STRUCTURED_PROMPT_LEN,
        )?;
        validation::require_optional_max_len(
            &format!("{prefix}.icon"),
            &p.icon,
            MAX_SHORT_FIELD_LEN,
        )?;
        validation::require_optional_max_len(
            &format!("{prefix}.color"),
            &p.color,
            MAX_SHORT_FIELD_LEN,
        )?;
        validation::require_optional_max_len(
            &format!("{prefix}.notification_channels"),
            &p.notification_channels,
            MAX_SHORT_FIELD_LEN,
        )?;
        validation::require_optional_max_len(
            &format!("{prefix}.model_profile"),
            &p.model_profile,
            MAX_SHORT_FIELD_LEN,
        )?;
        validation::require_optional_max_len(
            &format!("{prefix}.design_context"),
            &p.design_context,
            MAX_DESIGN_CONTEXT_LEN,
        )?;

        // Sub-entity array caps
        validation::require_max_count(
            &format!("{prefix}.triggers"),
            &p.triggers,
            MAX_TRIGGERS_PER_PERSONA,
        )?;
        validation::require_max_count(
            &format!("{prefix}.subscriptions"),
            &p.subscriptions,
            MAX_SUBSCRIPTIONS_PER_PERSONA,
        )?;
        validation::require_max_count(
            &format!("{prefix}.memories"),
            &p.memories,
            MAX_MEMORIES_PER_PERSONA,
        )?;
        validation::require_max_count(
            &format!("{prefix}.test_suites"),
            &p.test_suites,
            MAX_TEST_SUITES_PER_PERSONA,
        )?;

        // Validate triggers
        for (j, t) in p.triggers.iter().enumerate() {
            validation::require_non_empty(
                &format!("{prefix}.trigger[{j}].trigger_type"),
                &t.trigger_type,
            )?;
            validation::require_max_len(
                &format!("{prefix}.trigger[{j}].trigger_type"),
                &t.trigger_type,
                MAX_SHORT_FIELD_LEN,
            )?;
            validation::require_optional_max_len(
                &format!("{prefix}.trigger[{j}].config"),
                &t.config,
                MAX_CONFIG_LEN,
            )?;
            validation::require_optional_max_len(
                &format!("{prefix}.trigger[{j}].use_case_id"),
                &t.use_case_id,
                MAX_SHORT_FIELD_LEN,
            )?;
        }

        // Validate subscriptions
        for (j, s) in p.subscriptions.iter().enumerate() {
            validation::require_non_empty(
                &format!("{prefix}.subscription[{j}].event_type"),
                &s.event_type,
            )?;
            validation::require_max_len(
                &format!("{prefix}.subscription[{j}].event_type"),
                &s.event_type,
                MAX_SHORT_FIELD_LEN,
            )?;
            validation::require_optional_max_len(
                &format!("{prefix}.subscription[{j}].source_filter"),
                &s.source_filter,
                MAX_SHORT_FIELD_LEN,
            )?;
            validation::require_optional_max_len(
                &format!("{prefix}.subscription[{j}].use_case_id"),
                &s.use_case_id,
                MAX_SHORT_FIELD_LEN,
            )?;
        }

        // Validate memories
        for (j, m) in p.memories.iter().enumerate() {
            validation::require_non_empty(&format!("{prefix}.memory[{j}].title"), &m.title)?;
            validation::require_max_len(
                &format!("{prefix}.memory[{j}].title"),
                &m.title,
                MAX_NAME_LEN,
            )?;
            validation::require_max_len(
                &format!("{prefix}.memory[{j}].content"),
                &m.content,
                MAX_MEMORY_CONTENT_LEN,
            )?;
            validation::require_max_len(
                &format!("{prefix}.memory[{j}].category"),
                &m.category,
                MAX_SHORT_FIELD_LEN,
            )?;
            // Surface tag-serialization failures as a validation error
            // rather than collapsing them into an empty string. See the
            // matching guard in import_export::import_persona for the
            // why — silent unwrap_or_default() lets craft-able tags
            // bypass the length check and reach the DB layer raw.
            let tags_serialized = m
                .tags
                .as_ref()
                .map(|jv| serde_json::to_string(&jv.0))
                .transpose()
                .map_err(|e| {
                    AppError::Validation(format!(
                        "{prefix}.memory[{j}].tags is not serializable JSON: {e}"
                    ))
                })?;
            validation::require_optional_max_len(
                &format!("{prefix}.memory[{j}].tags"),
                &tags_serialized,
                MAX_SHORT_FIELD_LEN,
            )?;
        }

        // Validate test suites
        for (j, s) in p.test_suites.iter().enumerate() {
            validation::require_non_empty(&format!("{prefix}.test_suite[{j}].name"), &s.name)?;
            validation::require_max_len(
                &format!("{prefix}.test_suite[{j}].name"),
                &s.name,
                MAX_NAME_LEN,
            )?;
            validation::require_optional_max_len(
                &format!("{prefix}.test_suite[{j}].description"),
                &s.description,
                MAX_DESCRIPTION_LEN,
            )?;
            validation::require_max_len(
                &format!("{prefix}.test_suite[{j}].scenarios"),
                &s.scenarios,
                MAX_SCENARIOS_LEN,
            )?;
        }
    }

    // Validate teams
    for (i, t) in bundle.teams.iter().enumerate() {
        let prefix = format!("team[{i}]");

        validation::require_non_empty(&format!("{prefix}.name"), &t.name)?;
        validation::require_max_len(&format!("{prefix}.name"), &t.name, MAX_NAME_LEN)?;
        validation::require_optional_max_len(
            &format!("{prefix}.description"),
            &t.description,
            MAX_DESCRIPTION_LEN,
        )?;
        validation::require_optional_max_len(
            &format!("{prefix}.canvas_data"),
            &t.canvas_data,
            MAX_CANVAS_DATA_LEN,
        )?;
        validation::require_optional_max_len(
            &format!("{prefix}.team_config"),
            &t.team_config,
            MAX_CONFIG_LEN,
        )?;
        validation::require_optional_max_len(
            &format!("{prefix}.icon"),
            &t.icon,
            MAX_SHORT_FIELD_LEN,
        )?;

        validation::require_max_count(&format!("{prefix}.members"), &t.members, MAX_TEAM_MEMBERS)?;
        validation::require_max_count(
            &format!("{prefix}.connections"),
            &t.connections,
            MAX_TEAM_CONNECTIONS,
        )?;
        validation::require_max_count(
            &format!("{prefix}.memories"),
            &t.memories,
            MAX_TEAM_MEMORIES_PER_TEAM,
        )?;

        for (j, m) in t.memories.iter().enumerate() {
            validation::require_non_empty(&format!("{prefix}.memory[{j}].title"), &m.title)?;
            validation::require_max_len(
                &format!("{prefix}.memory[{j}].title"),
                &m.title,
                MAX_NAME_LEN,
            )?;
            validation::require_max_len(
                &format!("{prefix}.memory[{j}].content"),
                &m.content,
                MAX_MEMORY_CONTENT_LEN,
            )?;
            validation::require_max_len(
                &format!("{prefix}.memory[{j}].category"),
                &m.category,
                MAX_SHORT_FIELD_LEN,
            )?;
            validation::require_optional_max_len(
                &format!("{prefix}.memory[{j}].tags"),
                &m.tags,
                MAX_SHORT_FIELD_LEN,
            )?;
        }

        for (j, m) in t.members.iter().enumerate() {
            validation::require_optional_max_len(
                &format!("{prefix}.member[{j}].role"),
                &m.role,
                MAX_SHORT_FIELD_LEN,
            )?;
            validation::require_optional_max_len(
                &format!("{prefix}.member[{j}].config"),
                &m.config,
                MAX_CONFIG_LEN,
            )?;
        }

        for (j, c) in t.connections.iter().enumerate() {
            validation::require_optional_max_len(
                &format!("{prefix}.connection[{j}].connection_type"),
                &c.connection_type,
                MAX_SHORT_FIELD_LEN,
            )?;
            validation::require_optional_max_len(
                &format!("{prefix}.connection[{j}].condition"),
                &c.condition,
                MAX_CONFIG_LEN,
            )?;
            validation::require_optional_max_len(
                &format!("{prefix}.connection[{j}].label"),
                &c.label,
                MAX_NAME_LEN,
            )?;
        }
    }

    Ok(())
}
