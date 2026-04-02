use rusqlite::params;

use crate::db::models::{CreatePersonaGroupInput, PersonaGroup, UpdatePersonaGroupInput};
use crate::db::DbPool;
use crate::error::AppError;

row_mapper!(row_to_group -> PersonaGroup {
    id, name, color, sort_order,
    collapsed [bool],
    description [opt],
    default_model_profile [opt],
    default_max_budget_usd [opt],
    default_max_turns [opt],
    shared_instructions [opt],
    created_at, updated_at,
});

crud_get_by_id!(PersonaGroup, "persona_groups", "PersonaGroup", row_to_group);
crud_get_all!(PersonaGroup, "persona_groups", row_to_group, "sort_order, created_at");

crud_update! {
    model: PersonaGroup,
    table: "persona_groups",
    input: UpdatePersonaGroupInput,
    fields: {
        name: clone,
        color: clone,
        sort_order: copy,
        collapsed: bool,
        description: clone,
        default_model_profile: clone,
        default_max_budget_usd: copy,
        default_max_turns: copy,
        shared_instructions: clone,
    }
}

const MAX_GROUP_NAME_LEN: usize = 200;

pub fn create(pool: &DbPool, input: CreatePersonaGroupInput) -> Result<PersonaGroup, AppError> {
    let name = crate::validation::strip_html_tags(input.name.trim());
    if name.is_empty() {
        return Err(AppError::Validation("Name cannot be empty".into()));
    }
    if name.len() > MAX_GROUP_NAME_LEN {
        return Err(AppError::Validation(format!(
            "Group name exceeds maximum length of {MAX_GROUP_NAME_LEN} characters"
        )));
    }
    let description = input.description.map(|d| crate::validation::strip_html_tags(&d));

    timed_query!("persona_groups", "persona_groups::create", {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let color = input.color.unwrap_or_else(|| "#6B7280".into());

        let conn = pool.get()?;

        // Auto-compute sort_order from MAX(sort_order) + 1 if not provided
        let sort_order = match input.sort_order {
            Some(order) => order,
            None => {
                let max: i32 = conn
                    .query_row(
                        "SELECT COALESCE(MAX(sort_order), -1) FROM persona_groups",
                        [],
                        |row| row.get(0),
                    )
                    .unwrap_or(-1);
                max + 1
            }
        };

        conn.execute(
            "INSERT INTO persona_groups (id, name, color, sort_order, collapsed, description, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, 0, ?5, ?6, ?6)",
            params![id, name, color, sort_order, description, now],
        )?;

        get_by_id(pool, &id)
    })
}

pub fn delete(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    timed_query!("persona_groups", "persona_groups::delete", {
        let mut conn = pool.get()?;
        let tx = conn.transaction()?;

        tx.execute("UPDATE personas SET group_id = NULL WHERE group_id = ?1", params![id])?;
        let rows = tx.execute("DELETE FROM persona_groups WHERE id = ?1", params![id])?;

        tx.commit()?;
        Ok(rows > 0)
    })
}

pub fn reorder(pool: &DbPool, ordered_ids: &[String]) -> Result<(), AppError> {
    timed_query!("persona_groups", "persona_groups::reorder", {
        let mut conn = pool.get()?;
        let tx = conn.transaction()?;
        let mut stmt =
            tx.prepare("UPDATE persona_groups SET sort_order = ?1, updated_at = ?2 WHERE id = ?3")?;
        let now = chrono::Utc::now().to_rfc3339();

        for (idx, id) in ordered_ids.iter().enumerate() {
            let affected = stmt.execute(params![idx as i32, now, id])?;
            if affected == 0 {
                return Err(AppError::NotFound(format!("PersonaGroup {id}")));
            }
        }

        drop(stmt);
        tx.commit()?;

        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init_test_db;
    use crate::db::models::CreatePersonaGroupInput;

    #[test]
    fn test_group_crud_and_reorder() {
        let pool = init_test_db().unwrap();

        // Create first group
        let g1 = create(
            &pool,
            CreatePersonaGroupInput {
                name: "Alpha".into(),
                color: Some("#ff0000".into()),
                sort_order: None,
                description: Some("Alpha workspace".into()),
            },
        )
        .unwrap();
        assert_eq!(g1.name, "Alpha");
        assert_eq!(g1.color, "#ff0000");
        assert_eq!(g1.sort_order, 0);
        assert!(!g1.collapsed);
        assert_eq!(g1.description.as_deref(), Some("Alpha workspace"));

        // Create second group (auto sort_order = 1)
        let g2 = create(
            &pool,
            CreatePersonaGroupInput {
                name: "Beta".into(),
                color: None,
                sort_order: None,
                description: None,
            },
        )
        .unwrap();
        assert_eq!(g2.sort_order, 1);
        assert_eq!(g2.color, "#6B7280"); // default

        // Create third group
        let g3 = create(
            &pool,
            CreatePersonaGroupInput {
                name: "Gamma".into(),
                color: Some("#00ff00".into()),
                sort_order: None,
                description: None,
            },
        )
        .unwrap();
        assert_eq!(g3.sort_order, 2);

        // Read by id
        let fetched = get_by_id(&pool, &g1.id).unwrap();
        assert_eq!(fetched.name, "Alpha");

        // List all
        let all = get_all(&pool).unwrap();
        assert_eq!(all.len(), 3);
        assert_eq!(all[0].name, "Alpha");
        assert_eq!(all[1].name, "Beta");
        assert_eq!(all[2].name, "Gamma");

        // Update with workspace fields
        let updated = update(
            &pool,
            &g1.id,
            UpdatePersonaGroupInput {
                name: Some("Alpha Prime".into()),
                color: None,
                sort_order: None,
                collapsed: Some(true),
                description: Some("Updated workspace".into()),
                default_model_profile: Some(r#"{"model":"claude-sonnet-4-20250514"}"#.into()),
                default_max_budget_usd: Some(2.5),
                default_max_turns: Some(15),
                shared_instructions: Some("Always be concise.".into()),
            },
        )
        .unwrap();
        assert_eq!(updated.name, "Alpha Prime");
        assert!(updated.collapsed);
        assert_eq!(updated.description.as_deref(), Some("Updated workspace"));
        assert!(updated.default_model_profile.is_some());
        assert_eq!(updated.default_max_budget_usd, Some(2.5));
        assert_eq!(updated.default_max_turns, Some(15));
        assert_eq!(updated.shared_instructions.as_deref(), Some("Always be concise."));

        // Reorder: Gamma, Beta, Alpha Prime
        reorder(&pool, &[g3.id.clone(), g2.id.clone(), g1.id.clone()]).unwrap();

        let reordered = get_all(&pool).unwrap();
        assert_eq!(reordered[0].name, "Gamma");
        assert_eq!(reordered[0].sort_order, 0);
        assert_eq!(reordered[1].name, "Beta");
        assert_eq!(reordered[1].sort_order, 1);
        assert_eq!(reordered[2].name, "Alpha Prime");
        assert_eq!(reordered[2].sort_order, 2);

        // Delete
        let deleted = delete(&pool, &g2.id).unwrap();
        assert!(deleted);
        assert!(get_by_id(&pool, &g2.id).is_err());

        let remaining = get_all(&pool).unwrap();
        assert_eq!(remaining.len(), 2);
    }
}
