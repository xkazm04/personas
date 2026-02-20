use rusqlite::{params, Row};

use crate::db::models::{CreatePersonaGroupInput, PersonaGroup, UpdatePersonaGroupInput};
use crate::db::DbPool;
use crate::error::AppError;

fn row_to_group(row: &Row) -> rusqlite::Result<PersonaGroup> {
    Ok(PersonaGroup {
        id: row.get("id")?,
        name: row.get("name")?,
        color: row.get("color")?,
        sort_order: row.get("sort_order")?,
        collapsed: row.get::<_, i32>("collapsed")? != 0,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

pub fn get_all(pool: &DbPool) -> Result<Vec<PersonaGroup>, AppError> {
    let conn = pool.get()?;
    let mut stmt =
        conn.prepare("SELECT * FROM persona_groups ORDER BY sort_order, created_at")?;
    let rows = stmt.query_map([], row_to_group)?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

pub fn get_by_id(pool: &DbPool, id: &str) -> Result<PersonaGroup, AppError> {
    let conn = pool.get()?;
    conn.query_row(
        "SELECT * FROM persona_groups WHERE id = ?1",
        params![id],
        row_to_group,
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => {
            AppError::NotFound(format!("PersonaGroup {id}"))
        }
        other => AppError::Database(other),
    })
}

pub fn create(pool: &DbPool, input: CreatePersonaGroupInput) -> Result<PersonaGroup, AppError> {
    if input.name.trim().is_empty() {
        return Err(AppError::Validation("Name cannot be empty".into()));
    }

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
        "INSERT INTO persona_groups (id, name, color, sort_order, collapsed, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, 0, ?5, ?5)",
        params![id, input.name, color, sort_order, now],
    )?;

    get_by_id(pool, &id)
}

pub fn update(
    pool: &DbPool,
    id: &str,
    input: UpdatePersonaGroupInput,
) -> Result<PersonaGroup, AppError> {
    // Verify exists
    get_by_id(pool, id)?;

    let now = chrono::Utc::now().to_rfc3339();
    let conn = pool.get()?;

    // Build dynamic SET clause
    let mut sets: Vec<String> = vec!["updated_at = ?1".into()];
    let mut param_idx = 2u32;

    push_field!(input.name, "name", sets, param_idx);
    push_field!(input.color, "color", sets, param_idx);
    push_field!(input.sort_order, "sort_order", sets, param_idx);
    push_field!(input.collapsed, "collapsed", sets, param_idx);

    let sql = format!(
        "UPDATE persona_groups SET {} WHERE id = ?{}",
        sets.join(", "),
        param_idx
    );

    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(now)];

    if let Some(ref v) = input.name {
        param_values.push(Box::new(v.clone()));
    }
    if let Some(ref v) = input.color {
        param_values.push(Box::new(v.clone()));
    }
    if let Some(v) = input.sort_order {
        param_values.push(Box::new(v));
    }
    if let Some(v) = input.collapsed {
        param_values.push(Box::new(v as i32));
    }
    param_values.push(Box::new(id.to_string()));

    let params_ref: Vec<&dyn rusqlite::types::ToSql> =
        param_values.iter().map(|p| p.as_ref()).collect();
    conn.execute(&sql, params_ref.as_slice())?;

    get_by_id(pool, id)
}

pub fn delete(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    let conn = pool.get()?;
    let rows = conn.execute("DELETE FROM persona_groups WHERE id = ?1", params![id])?;
    Ok(rows > 0)
}

pub fn reorder(pool: &DbPool, ordered_ids: &[String]) -> Result<(), AppError> {
    let conn = pool.get()?;
    let mut stmt =
        conn.prepare("UPDATE persona_groups SET sort_order = ?1, updated_at = ?2 WHERE id = ?3")?;
    let now = chrono::Utc::now().to_rfc3339();

    for (idx, id) in ordered_ids.iter().enumerate() {
        let affected = stmt.execute(params![idx as i32, now, id])?;
        if affected == 0 {
            return Err(AppError::NotFound(format!("PersonaGroup {id}")));
        }
    }

    Ok(())
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
            },
        )
        .unwrap();
        assert_eq!(g1.name, "Alpha");
        assert_eq!(g1.color, "#ff0000");
        assert_eq!(g1.sort_order, 0);
        assert!(!g1.collapsed);

        // Create second group (auto sort_order = 1)
        let g2 = create(
            &pool,
            CreatePersonaGroupInput {
                name: "Beta".into(),
                color: None,
                sort_order: None,
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

        // Update
        let updated = update(
            &pool,
            &g1.id,
            UpdatePersonaGroupInput {
                name: Some("Alpha Prime".into()),
                color: None,
                sort_order: None,
                collapsed: Some(true),
            },
        )
        .unwrap();
        assert_eq!(updated.name, "Alpha Prime");
        assert!(updated.collapsed);

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
