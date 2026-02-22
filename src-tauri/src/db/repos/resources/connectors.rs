use rusqlite::{params, Row};

use crate::db::models::{
    ConnectorDefinition, CreateConnectorDefinitionInput, UpdateConnectorDefinitionInput,
};
use crate::db::DbPool;
use crate::error::AppError;

// ============================================================================
// Row mapper
// ============================================================================

fn row_to_connector(row: &Row) -> rusqlite::Result<ConnectorDefinition> {
    Ok(ConnectorDefinition {
        id: row.get("id")?,
        name: row.get("name")?,
        label: row.get("label")?,
        icon_url: row.get("icon_url")?,
        color: row.get("color")?,
        category: row.get("category")?,
        fields: row.get("fields")?,
        healthcheck_config: row.get("healthcheck_config")?,
        services: row.get("services")?,
        events: row.get("events")?,
        metadata: row.get("metadata")?,
        is_builtin: row.get::<_, i32>("is_builtin")? != 0,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

// ============================================================================
// CRUD
// ============================================================================

pub fn get_all(pool: &DbPool) -> Result<Vec<ConnectorDefinition>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT * FROM connector_definitions ORDER BY is_builtin DESC, name",
    )?;
    let rows = stmt.query_map([], row_to_connector)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
}

pub fn get_by_id(pool: &DbPool, id: &str) -> Result<ConnectorDefinition, AppError> {
    let conn = pool.get()?;
    conn.query_row(
        "SELECT * FROM connector_definitions WHERE id = ?1",
        params![id],
        row_to_connector,
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => {
            AppError::NotFound(format!("Connector definition {id}"))
        }
        other => AppError::Database(other),
    })
}

pub fn get_by_name(pool: &DbPool, name: &str) -> Result<Option<ConnectorDefinition>, AppError> {
    let conn = pool.get()?;
    let result = conn.query_row(
        "SELECT * FROM connector_definitions WHERE name = ?1",
        params![name],
        row_to_connector,
    );

    match result {
        Ok(def) => Ok(Some(def)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(AppError::Database(e)),
    }
}

pub fn get_by_category(
    pool: &DbPool,
    category: &str,
) -> Result<Vec<ConnectorDefinition>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT * FROM connector_definitions WHERE category = ?1 ORDER BY is_builtin DESC, name",
    )?;
    let rows = stmt.query_map(params![category], row_to_connector)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
}

pub fn create(
    pool: &DbPool,
    input: CreateConnectorDefinitionInput,
) -> Result<ConnectorDefinition, AppError> {
    if input.name.trim().is_empty() {
        return Err(AppError::Validation("Name cannot be empty".into()));
    }
    if input.label.trim().is_empty() {
        return Err(AppError::Validation("Label cannot be empty".into()));
    }

    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let color = input.color.unwrap_or_else(|| "#6B7280".into());
    let category = input.category.unwrap_or_else(|| "general".into());
    let services = input.services.unwrap_or_else(|| "[]".into());
    let events = input.events.unwrap_or_else(|| "[]".into());
    let is_builtin = input.is_builtin.unwrap_or(false) as i32;

    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO connector_definitions
         (id, name, label, icon_url, color, category, fields,
          healthcheck_config, services, events, metadata, is_builtin,
          created_at, updated_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?13)",
        params![
            id,
            input.name,
            input.label,
            input.icon_url,
            color,
            category,
            input.fields,
            input.healthcheck_config,
            services,
            events,
            input.metadata,
            is_builtin,
            now,
        ],
    )?;

    get_by_id(pool, &id)
}

pub fn update(
    pool: &DbPool,
    id: &str,
    input: UpdateConnectorDefinitionInput,
) -> Result<ConnectorDefinition, AppError> {
    if let Some(ref name) = input.name {
        if name.trim().is_empty() {
            return Err(AppError::Validation("Name cannot be empty".into()));
        }
    }
    if let Some(ref label) = input.label {
        if label.trim().is_empty() {
            return Err(AppError::Validation("Label cannot be empty".into()));
        }
    }

    // Verify exists
    get_by_id(pool, id)?;

    let now = chrono::Utc::now().to_rfc3339();
    let conn = pool.get()?;

    // Build dynamic SET clause
    let mut sets: Vec<String> = vec!["updated_at = ?1".into()];
    let mut param_idx = 2u32;

    push_field!(input.name, "name", sets, param_idx);
    push_field!(input.label, "label", sets, param_idx);
    push_field!(input.icon_url, "icon_url", sets, param_idx);
    push_field!(input.color, "color", sets, param_idx);
    push_field!(input.category, "category", sets, param_idx);
    push_field!(input.fields, "fields", sets, param_idx);
    push_field!(input.healthcheck_config, "healthcheck_config", sets, param_idx);
    push_field!(input.services, "services", sets, param_idx);
    push_field!(input.events, "events", sets, param_idx);
    push_field!(input.metadata, "metadata", sets, param_idx);

    let sql = format!(
        "UPDATE connector_definitions SET {} WHERE id = ?{}",
        sets.join(", "),
        param_idx
    );

    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(now)];

    if let Some(ref v) = input.name {
        param_values.push(Box::new(v.clone()));
    }
    if let Some(ref v) = input.label {
        param_values.push(Box::new(v.clone()));
    }
    if let Some(ref v) = input.icon_url {
        param_values.push(Box::new(v.clone()));
    }
    if let Some(ref v) = input.color {
        param_values.push(Box::new(v.clone()));
    }
    if let Some(ref v) = input.category {
        param_values.push(Box::new(v.clone()));
    }
    if let Some(ref v) = input.fields {
        param_values.push(Box::new(v.clone()));
    }
    if let Some(ref v) = input.healthcheck_config {
        param_values.push(Box::new(v.clone()));
    }
    if let Some(ref v) = input.services {
        param_values.push(Box::new(v.clone()));
    }
    if let Some(ref v) = input.events {
        param_values.push(Box::new(v.clone()));
    }
    if let Some(ref v) = input.metadata {
        param_values.push(Box::new(v.clone()));
    }
    param_values.push(Box::new(id.to_string()));

    let params_ref: Vec<&dyn rusqlite::types::ToSql> =
        param_values.iter().map(|p| p.as_ref()).collect();
    conn.execute(&sql, params_ref.as_slice())?;

    get_by_id(pool, id)
}

pub fn delete(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    let conn = pool.get()?;
    let rows = conn.execute(
        "DELETE FROM connector_definitions WHERE id = ?1",
        params![id],
    )?;
    Ok(rows > 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init_test_db;
    use crate::db::models::{CreateConnectorDefinitionInput, UpdateConnectorDefinitionInput};

    #[test]
    fn test_connector_crud() {
        let pool = init_test_db().unwrap();

        // Create
        let connector = create(
            &pool,
            CreateConnectorDefinitionInput {
                name: "slack".into(),
                label: "Slack".into(),
                icon_url: Some("https://example.com/slack.png".into()),
                color: Some("#4A154B".into()),
                category: Some("messaging".into()),
                fields: r#"[{"name":"webhook_url","type":"string","required":true}]"#.into(),
                healthcheck_config: None,
                services: Some(r#"["send_message","read_channel"]"#.into()),
                events: Some(r#"["message_received"]"#.into()),
                metadata: None,
                is_builtin: Some(false),
            },
        )
        .unwrap();
        assert_eq!(connector.name, "slack");
        assert_eq!(connector.label, "Slack");
        assert_eq!(connector.color, "#4A154B");
        assert_eq!(connector.category, "messaging");
        assert!(!connector.is_builtin);

        // Get by ID
        let fetched = get_by_id(&pool, &connector.id).unwrap();
        assert_eq!(fetched.name, "slack");

        // Get by name
        let by_name = get_by_name(&pool, "slack").unwrap();
        assert!(by_name.is_some());
        assert_eq!(by_name.unwrap().id, connector.id);

        // Get by name - not found
        let missing = get_by_name(&pool, "nonexistent").unwrap();
        assert!(missing.is_none());

        // Get by category
        let by_cat = get_by_category(&pool, "messaging").unwrap();
        assert_eq!(by_cat.len(), 1);

        // List all (includes the seeded builtin Google Workspace connector)
        let all = get_all(&pool).unwrap();
        assert_eq!(all.len(), 2);

        // Update
        let updated = update(
            &pool,
            &connector.id,
            UpdateConnectorDefinitionInput {
                name: None,
                label: Some("Slack Workspace".into()),
                icon_url: None,
                color: Some("#611F69".into()),
                category: None,
                fields: None,
                healthcheck_config: None,
                services: None,
                events: None,
                metadata: None,
            },
        )
        .unwrap();
        assert_eq!(updated.label, "Slack Workspace");
        assert_eq!(updated.color, "#611F69");
        assert_eq!(updated.name, "slack"); // unchanged

        // Delete
        let deleted = delete(&pool, &connector.id).unwrap();
        assert!(deleted);
        assert!(get_by_id(&pool, &connector.id).is_err());
    }

    #[test]
    fn test_connector_validation() {
        let pool = init_test_db().unwrap();

        // Empty name
        let result = create(
            &pool,
            CreateConnectorDefinitionInput {
                name: "".into(),
                label: "Something".into(),
                icon_url: None,
                color: None,
                category: None,
                fields: "[]".into(),
                healthcheck_config: None,
                services: None,
                events: None,
                metadata: None,
                is_builtin: None,
            },
        );
        assert!(result.is_err());

        // Empty label
        let result = create(
            &pool,
            CreateConnectorDefinitionInput {
                name: "test".into(),
                label: "  ".into(),
                icon_url: None,
                color: None,
                category: None,
                fields: "[]".into(),
                healthcheck_config: None,
                services: None,
                events: None,
                metadata: None,
                is_builtin: None,
            },
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_connector_defaults() {
        let pool = init_test_db().unwrap();

        let connector = create(
            &pool,
            CreateConnectorDefinitionInput {
                name: "minimal".into(),
                label: "Minimal Connector".into(),
                icon_url: None,
                color: None,
                category: None,
                fields: "[]".into(),
                healthcheck_config: None,
                services: None,
                events: None,
                metadata: None,
                is_builtin: None,
            },
        )
        .unwrap();

        assert_eq!(connector.color, "#6B7280");
        assert_eq!(connector.category, "general");
        assert_eq!(connector.services, "[]");
        assert_eq!(connector.events, "[]");
        assert!(!connector.is_builtin);
    }
}
