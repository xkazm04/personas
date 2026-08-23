use super::kpis::row_to_kpi;
use crate::models::{DevKpi, DevMilestone, DevMilestoneItem, DevProjectWallSummary};
use crate::DbPool;
use personas_core::error::AppError;
use rusqlite::{params, Row};
use std::collections::HashMap;

// ============================================================================
// Milestones (Ship layer — convergence cuts; see dev_milestones migration)
// ============================================================================

fn row_to_milestone(row: &Row) -> rusqlite::Result<DevMilestone> {
    Ok(DevMilestone {
        id: row.get("id")?,
        project_id: row.get("project_id")?,
        name: row.get("name")?,
        goal: row.get("goal")?,
        status: row.get("status")?,
        order_index: row.get("order_index")?,
        target_date: row.get("target_date")?,
        cut_at: row.get("cut_at")?,
        shipped_at: row.get("shipped_at")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

fn row_to_milestone_item(row: &Row) -> rusqlite::Result<DevMilestoneItem> {
    Ok(DevMilestoneItem {
        milestone_id: row.get("milestone_id")?,
        item_kind: row.get("item_kind")?,
        item_id: row.get("item_id")?,
        bucket: row.get("bucket")?,
        added_after_cut: row.get::<_, i64>("added_after_cut")? != 0,
        order_index: row.get("order_index")?,
        created_at: row.get("created_at")?,
        description: row.get("description")?,
        rating: row.get("rating")?,
    })
}

pub fn list_milestones_by_project(
    pool: &DbPool,
    project_id: &str,
) -> Result<Vec<DevMilestone>, AppError> {
    timed_query!("dev_milestones", "dev_milestones::list_by_project", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM dev_milestones WHERE project_id = ?1 ORDER BY order_index, created_at",
        )?;
        let rows = stmt.query_map(params![project_id], row_to_milestone)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)
    })
}

pub fn create_milestone(
    pool: &DbPool,
    project_id: &str,
    name: &str,
    goal: Option<&str>,
    status: Option<&str>,
    target_date: Option<&str>,
) -> Result<DevMilestone, AppError> {
    if name.trim().is_empty() {
        return Err(AppError::Validation(
            "Milestone name cannot be empty".into(),
        ));
    }
    let status = status.unwrap_or("planned");
    if !["planned", "active", "shipped"].contains(&status) {
        return Err(AppError::Validation(format!(
            "Invalid milestone status `{status}`"
        )));
    }
    // A milestone cannot be BORN shipped. `update_milestone` already refuses
    // the planned → shipped jump, but creation was only checking enum
    // membership — so the management HTTP API, a Fleet dispatch or the A2A
    // gateway could mint a 'shipped' row with `cut_at` NULL (the INSERT's CASE
    // only stamps for 'active') and `shipped_at` never set. That row is
    // invisible to velocity, which reads `shipped_at`, and reports 'setup' on
    // scope-frozen because it has no cut. Ship is a TRANSITION, not a state
    // you can start in.
    if status == "shipped" {
        return Err(AppError::Validation(
            "A milestone cannot be created shipped; create it active (cut) and then ship it".into(),
        ));
    }

    timed_query!("dev_milestones", "dev_milestones::create", {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;
        let order_index: i32 = conn
            .query_row(
                "SELECT COALESCE(MAX(order_index), -1) + 1 FROM dev_milestones WHERE project_id = ?1",
                params![project_id],
                |row| row.get(0),
            )
            .unwrap_or(0);
        // `cut_at` is stamped in the SAME insert when the milestone is born
        // 'active'. It is the scope-creep baseline, and a milestone created
        // directly active (the seeded "Onboard to Personas" one, and any
        // milestone the management API / a Fleet dispatch creates active)
        // never passes through `update_milestone`'s → 'active' transition —
        // so without this its `cut_at` would stay NULL forever and every item
        // added later would report `added_after_cut = false`.
        conn.execute(
            "INSERT INTO dev_milestones (id, project_id, name, goal, status, order_index, target_date, cut_at, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, CASE WHEN ?5 = 'active' THEN ?8 ELSE NULL END, ?8, ?8)",
            params![id, project_id, name.trim(), goal, status, order_index, target_date, now],
        )?;
        drop(conn);
        get_milestone_by_id(pool, &id)
    })
}

pub fn get_milestone_by_id(pool: &DbPool, id: &str) -> Result<DevMilestone, AppError> {
    let conn = pool.get()?;
    conn.query_row(
        "SELECT * FROM dev_milestones WHERE id = ?1",
        params![id],
        row_to_milestone,
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => AppError::NotFound(format!("Milestone {id}")),
        other => AppError::Database(other),
    })
}

/// Patch-style update. Status transitions stamp their timestamps: → 'active'
/// stamps `cut_at` (first time only — the scope-creep baseline), → 'shipped'
/// stamps `shipped_at`.
#[allow(clippy::too_many_arguments)]
pub fn update_milestone(
    pool: &DbPool,
    id: &str,
    name: Option<&str>,
    goal: Option<&str>,
    status: Option<&str>,
    target_date: Option<&str>,
    order_index: Option<i32>,
) -> Result<DevMilestone, AppError> {
    timed_query!("dev_milestones", "dev_milestones::update", {
        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;
        if let Some(name) = name {
            if name.trim().is_empty() {
                return Err(AppError::Validation(
                    "Milestone name cannot be empty".into(),
                ));
            }
            conn.execute(
                "UPDATE dev_milestones SET name = ?2, updated_at = ?3 WHERE id = ?1",
                params![id, name.trim(), now],
            )?;
        }
        if let Some(goal) = goal {
            conn.execute(
                "UPDATE dev_milestones SET goal = ?2, updated_at = ?3 WHERE id = ?1",
                params![id, goal, now],
            )?;
        }
        if let Some(status) = status {
            if !["planned", "active", "shipped"].contains(&status) {
                return Err(AppError::Validation(format!(
                    "Invalid milestone status `{status}`"
                )));
            }
            // A milestone must be CUT before it can ship. The exit-criteria
            // check lives client-side (a `disabled` attribute), which means
            // the management HTTP API, a Fleet dispatch or the A2A gateway
            // could otherwise mark a never-cut milestone shipped. Read the
            // current status on the same connection and refuse the jump.
            let current: String = conn
                .query_row(
                    "SELECT status FROM dev_milestones WHERE id = ?1",
                    params![id],
                    |row| row.get(0),
                )
                .map_err(|e| match e {
                    rusqlite::Error::QueryReturnedNoRows => {
                        AppError::NotFound(format!("Milestone {id}"))
                    }
                    other => AppError::Database(other),
                })?;
            if status == "shipped" && current == "planned" {
                return Err(AppError::Validation(
                    "A milestone must be cut (set active) before it can be shipped".into(),
                ));
            }
            conn.execute(
                "UPDATE dev_milestones SET status = ?2, updated_at = ?3,
                    cut_at = CASE WHEN ?2 = 'active' AND cut_at IS NULL THEN ?3 ELSE cut_at END,
                    shipped_at = CASE WHEN ?2 = 'shipped' THEN ?3 ELSE shipped_at END
                 WHERE id = ?1",
                params![id, status, now],
            )?;
        }
        if let Some(target_date) = target_date {
            conn.execute(
                "UPDATE dev_milestones SET target_date = ?2, updated_at = ?3 WHERE id = ?1",
                params![id, target_date, now],
            )?;
        }
        if let Some(order_index) = order_index {
            conn.execute(
                "UPDATE dev_milestones SET order_index = ?2, updated_at = ?3 WHERE id = ?1",
                params![id, order_index, now],
            )?;
        }
        drop(conn);
        get_milestone_by_id(pool, id)
    })
}

/// ONE grouped read for the WHOLE L1 passport wall.
///
/// The wall used to fan three per-project calls out (`list_contexts_by_project`
/// + `list_kpis` + `list_milestones_by_project`), so drawing N covers cost 3N
/// IPC round trips and 3N queries. This is one query per table with a single
/// `WHERE project_id IN (…)`, then a client-side regroup — 1 IPC call and 3
/// queries regardless of N.
///
/// Projects with no contexts / no active KPIs / no milestones still get a row
/// (zeroed / empty), and rows come back in the caller's `project_ids` order so
/// the wall never has to reconcile ordering. Unknown ids yield an empty row
/// rather than an error — the wall must not fail because one project was
/// deregistered mid-session.
pub fn project_wall_summaries(
    pool: &DbPool,
    project_ids: &[String],
) -> Result<Vec<DevProjectWallSummary>, AppError> {
    if project_ids.is_empty() {
        return Ok(Vec::new());
    }
    // SQLite's default SQLITE_MAX_VARIABLE_NUMBER is 32766; a wall of that many
    // projects is not a real shape, but refuse rather than emit invalid SQL.
    if project_ids.len() > 5_000 {
        return Err(AppError::Validation(
            "Too many projects in one wall-summary request (max 5000)".into(),
        ));
    }

    timed_query!("dev_projects", "dev_projects::wall_summaries", {
        let conn = pool.get()?;
        let placeholders = vec!["?"; project_ids.len()].join(",");
        let binds: Vec<&dyn rusqlite::ToSql> = project_ids
            .iter()
            .map(|s| s as &dyn rusqlite::ToSql)
            .collect();

        let mut contexts_count: HashMap<String, i32> = HashMap::new();
        {
            let mut stmt = conn.prepare(&format!(
                "SELECT project_id, COUNT(*) FROM dev_contexts
                 WHERE project_id IN ({placeholders}) GROUP BY project_id",
            ))?;
            let rows = stmt.query_map(binds.as_slice(), |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i32>(1)?))
            })?;
            for row in rows {
                let (project_id, count) = row.map_err(AppError::Database)?;
                contexts_count.insert(project_id, count);
            }
        }

        let mut active_kpis: HashMap<String, Vec<DevKpi>> = HashMap::new();
        {
            // Same ordering as `list_kpis` for the active slice (created_at
            // DESC) so a cover's KPI set is identical to the detail view's.
            let mut stmt = conn.prepare(&format!(
                "SELECT * FROM dev_kpis
                 WHERE project_id IN ({placeholders}) AND status = 'active'
                 ORDER BY created_at DESC",
            ))?;
            let rows = stmt.query_map(binds.as_slice(), row_to_kpi)?;
            for row in rows {
                let kpi = row.map_err(AppError::Database)?;
                active_kpis
                    .entry(kpi.project_id.clone())
                    .or_default()
                    .push(kpi);
            }
        }

        let mut milestones: HashMap<String, Vec<DevMilestone>> = HashMap::new();
        {
            // Mirrors `list_milestones_by_project`'s ORDER BY exactly — the
            // roadmap strip is positional, so a different order is a different
            // picture.
            let mut stmt = conn.prepare(&format!(
                "SELECT * FROM dev_milestones
                 WHERE project_id IN ({placeholders})
                 ORDER BY order_index, created_at",
            ))?;
            let rows = stmt.query_map(binds.as_slice(), row_to_milestone)?;
            for row in rows {
                let m = row.map_err(AppError::Database)?;
                milestones.entry(m.project_id.clone()).or_default().push(m);
            }
        }

        Ok(project_ids
            .iter()
            .map(|project_id| DevProjectWallSummary {
                project_id: project_id.clone(),
                contexts_count: contexts_count.get(project_id).copied().unwrap_or(0),
                // `cloned`, not `remove`: a duplicated id in the request must
                // still answer both slots rather than silently emptying one.
                active_kpis: active_kpis.get(project_id).cloned().unwrap_or_default(),
                milestones: milestones.get(project_id).cloned().unwrap_or_default(),
            })
            .collect())
    })
}

pub fn delete_milestone(pool: &DbPool, id: &str) -> Result<(), AppError> {
    let conn = pool.get()?;
    let affected = conn.execute("DELETE FROM dev_milestones WHERE id = ?1", params![id])?;
    if affected == 0 {
        return Err(AppError::NotFound(format!("Milestone {id}")));
    }
    Ok(())
}

pub fn list_milestone_items(
    pool: &DbPool,
    milestone_id: &str,
) -> Result<Vec<DevMilestoneItem>, AppError> {
    timed_query!("dev_milestones", "dev_milestones::list_items", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM dev_milestone_items WHERE milestone_id = ?1
             ORDER BY bucket, order_index, created_at",
        )?;
        let rows = stmt.query_map(params![milestone_id], row_to_milestone_item)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)
    })
}

/// Upsert a scope member. `added_after_cut` is derived here, not passed in:
/// a NEW membership created while the milestone is already 'active' (cut) is
/// scope creep by definition; re-bucketing an existing member keeps its flag.
///
/// `description` and `rating` follow this file's nullable-patch convention
/// (`update_kpi` / `update_goal`): the outer `Option` is "was this field sent
/// at all" and the inner one is the value, so `None` leaves the column
/// untouched and `Some(None)` clears it. That distinction matters most for
/// `rating` — NULL is UNRATED, which is not the same judgement as a 1.
#[allow(clippy::too_many_arguments)]
pub fn set_milestone_item(
    pool: &DbPool,
    milestone_id: &str,
    item_kind: &str,
    item_id: &str,
    bucket: &str,
    description: Option<Option<&str>>,
    rating: Option<Option<i32>>,
) -> Result<DevMilestoneItem, AppError> {
    if !["use_case", "goal"].contains(&item_kind) {
        return Err(AppError::Validation(format!(
            "Invalid milestone item kind `{item_kind}`"
        )));
    }
    if !["core", "later", "never"].contains(&bucket) {
        return Err(AppError::Validation(format!(
            "Invalid milestone bucket `{bucket}`"
        )));
    }
    // Guard in the repo as well as the column CHECK: the CHECK protects the
    // file, this returns a message the caller can show.
    if let Some(Some(r)) = rating {
        if !(1..=5).contains(&r) {
            return Err(AppError::Validation(format!(
                "Milestone item rating must be between 1 and 5, got {r}"
            )));
        }
    }

    timed_query!("dev_milestones", "dev_milestones::set_item", {
        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;
        let after_cut: bool = conn
            .query_row(
                "SELECT cut_at IS NOT NULL FROM dev_milestones WHERE id = ?1",
                params![milestone_id],
                |row| row.get(0),
            )
            .map_err(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => {
                    AppError::NotFound(format!("Milestone {milestone_id}"))
                }
                other => AppError::Database(other),
            })?;
        // The conflict arm updates `bucket` unconditionally and the two new
        // columns ONLY when the caller sent them — an omitted field must not
        // be written back as NULL. `added_after_cut` is never in the SET, so
        // re-bucketing or annotating an existing member keeps the flag it was
        // born with.
        let mut sets: Vec<&str> = vec!["bucket = excluded.bucket"];
        if description.is_some() {
            sets.push("description = excluded.description");
        }
        if rating.is_some() {
            sets.push("rating = excluded.rating");
        }
        let sql = format!(
            "INSERT INTO dev_milestone_items (milestone_id, item_kind, item_id, bucket, added_after_cut, created_at, description, rating)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(milestone_id, item_kind, item_id)
             DO UPDATE SET {}",
            sets.join(", ")
        );
        conn.execute(
            &sql,
            params![
                milestone_id,
                item_kind,
                item_id,
                bucket,
                after_cut as i64,
                now,
                description.flatten(),
                rating.flatten(),
            ],
        )?;
        conn.query_row(
            "SELECT * FROM dev_milestone_items
             WHERE milestone_id = ?1 AND item_kind = ?2 AND item_id = ?3",
            params![milestone_id, item_kind, item_id],
            row_to_milestone_item,
        )
        .map_err(AppError::Database)
    })
}

pub fn remove_milestone_item(
    pool: &DbPool,
    milestone_id: &str,
    item_kind: &str,
    item_id: &str,
) -> Result<(), AppError> {
    let conn = pool.get()?;
    conn.execute(
        "DELETE FROM dev_milestone_items
         WHERE milestone_id = ?1 AND item_kind = ?2 AND item_id = ?3",
        params![milestone_id, item_kind, item_id],
    )?;
    Ok(())
}

#[cfg(test)]
mod milestone_tests {
    use super::*;
    use crate::repos::dev::contexts::create_context;
    use crate::repos::dev::kpis::create_kpi;
    use crate::repos::dev::projects::create_project;

    #[test]
    fn milestone_lifecycle_and_scope_creep_flag() {
        let pool = crate::init_test_db().unwrap();
        let project = create_project(&pool, "P", "/tmp/mp", None, None, None, None, None).unwrap();

        let m = create_milestone(
            &pool,
            &project.id,
            "v1 — First Ship",
            Some("Core value"),
            None,
            Some("2026-08-15"),
        )
        .unwrap();
        assert_eq!(m.status, "planned");
        assert!(m.cut_at.is_none());

        // Members added before the cut are not creep.
        let a = set_milestone_item(&pool, &m.id, "use_case", "uc-a", "core", None, None).unwrap();
        assert!(!a.added_after_cut);

        // Activating stamps cut_at once.
        let m = update_milestone(&pool, &m.id, None, None, Some("active"), None, None).unwrap();
        assert!(m.cut_at.is_some());

        // New membership after the cut IS creep; re-bucketing an old one isn't.
        let b = set_milestone_item(&pool, &m.id, "use_case", "uc-b", "later", None, None).unwrap();
        assert!(b.added_after_cut);
        let a2 = set_milestone_item(&pool, &m.id, "use_case", "uc-a", "later", None, None).unwrap();
        assert!(!a2.added_after_cut, "re-bucketing keeps the original flag");

        // Goals bind through the same table.
        set_milestone_item(&pool, &m.id, "goal", "g-1", "core", None, None).unwrap();
        let items = list_milestone_items(&pool, &m.id).unwrap();
        assert_eq!(items.len(), 3);

        // Shipping stamps shipped_at; delete cascades members.
        let m = update_milestone(&pool, &m.id, None, None, Some("shipped"), None, None).unwrap();
        assert!(m.shipped_at.is_some());
        delete_milestone(&pool, &m.id).unwrap();
        assert!(list_milestone_items(&pool, &m.id).unwrap().is_empty());
    }

    #[test]
    fn milestone_validation_rejects_bad_enums() {
        let pool = crate::init_test_db().unwrap();
        let project = create_project(&pool, "P", "/tmp/mp2", None, None, None, None, None).unwrap();
        assert!(create_milestone(&pool, &project.id, "  ", None, None, None).is_err());
        assert!(create_milestone(&pool, &project.id, "M", None, Some("bogus"), None).is_err());
        let m = create_milestone(&pool, &project.id, "M", None, None, None).unwrap();
        assert!(
            set_milestone_item(&pool, &m.id, "context", "c-1", "core", None, None).is_err(),
            "contexts are never members"
        );
        assert!(
            set_milestone_item(&pool, &m.id, "use_case", "u-1", "someday", None, None).is_err()
        );
    }

    /// The batched wall read must answer EVERY requested project — including
    /// ones with nothing to report and ids that no longer exist — in the
    /// caller's order, and must return full milestone rows (the roadmap
    /// builder consumes `DevMilestone[]`, not a projection).
    #[test]
    fn wall_summaries_answer_every_requested_project_in_order() {
        let pool = crate::init_test_db().unwrap();
        let a = create_project(&pool, "A", "/tmp/wa", None, None, None, None, None).unwrap();
        let b = create_project(&pool, "B", "/tmp/wb", None, None, None, None, None).unwrap();

        create_context(
            &pool,
            &a.id,
            "ctx-1",
            None,
            None,
            Some(r#"["a.ts"]"#),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap();
        create_context(
            &pool,
            &a.id,
            "ctx-2",
            None,
            None,
            Some(r#"["b.ts"]"#),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap();
        create_milestone(&pool, &a.id, "v1", None, Some("active"), None).unwrap();
        create_milestone(&pool, &a.id, "v2", None, None, None).unwrap();

        let mk_kpi = |name: &str, status: &str| {
            create_kpi(
                &pool,
                &a.id,
                name,
                None,
                None,
                "quality",
                "manual",
                "{}",
                "%",
                "up",
                Some(0.0),
                Some(100.0),
                None,
                "weekly",
                Some(status),
                "user",
                None,
                None,
                None,
                None,
                None,
            )
            .unwrap()
        };
        mk_kpi("live", "active");
        mk_kpi("shelved", "paused");

        // b has nothing; "ghost" was never registered at all.
        let rows =
            project_wall_summaries(&pool, &[b.id.clone(), a.id.clone(), "ghost".to_string()])
                .unwrap();

        assert_eq!(rows.len(), 3, "every requested id gets a row");
        assert_eq!(rows[0].project_id, b.id, "order mirrors the request");
        assert_eq!(rows[0].contexts_count, 0);
        assert!(rows[0].milestones.is_empty());

        assert_eq!(rows[1].project_id, a.id);
        assert_eq!(rows[1].contexts_count, 2);
        assert_eq!(rows[1].milestones.len(), 2);
        assert_eq!(rows[1].active_kpis.len(), 1, "only ACTIVE KPIs count");
        assert_eq!(rows[1].active_kpis[0].name, "live");
        // Full rows, ordered exactly like list_milestones_by_project.
        let listed = list_milestones_by_project(&pool, &a.id).unwrap();
        assert_eq!(
            rows[1].milestones.iter().map(|m| &m.id).collect::<Vec<_>>(),
            listed.iter().map(|m| &m.id).collect::<Vec<_>>(),
        );
        assert!(
            rows[1].milestones[0].cut_at.is_some(),
            "cut_at survives the batch read"
        );

        assert_eq!(
            rows[2].project_id, "ghost",
            "an unknown id is empty, not an error"
        );
        assert_eq!(rows[2].contexts_count, 0);

        assert!(project_wall_summaries(&pool, &[]).unwrap().is_empty());
    }

    /// A milestone created directly 'active' — the shape `seedOnboarding.ts`
    /// writes for every project — must carry a `cut_at` from birth, otherwise
    /// the scope-creep baseline never exists on the one milestone most
    /// projects will ever have.
    #[test]
    fn milestone_created_active_is_cut_at_birth() {
        let pool = crate::init_test_db().unwrap();
        let project = create_project(&pool, "P", "/tmp/mp3", None, None, None, None, None).unwrap();

        let m = create_milestone(
            &pool,
            &project.id,
            "Onboard to Personas",
            None,
            Some("active"),
            None,
        )
        .unwrap();
        assert_eq!(m.status, "active");
        assert!(m.cut_at.is_some(), "a milestone born active must be cut");

        // …and the creep flag therefore fires on anything joined afterwards.
        let item =
            set_milestone_item(&pool, &m.id, "use_case", "uc-late", "core", None, None).unwrap();
        assert!(item.added_after_cut, "items added after the cut are creep");

        // A milestone born 'planned' is still uncut.
        let p = create_milestone(&pool, &project.id, "Later", None, Some("planned"), None).unwrap();
        assert!(p.cut_at.is_none());
    }

    /// Shipping is a server-side gated transition: a milestone must pass
    /// through 'active' (be cut) first. The client's exit-criteria check is a
    /// `disabled` attribute — it does not bind the management API, Fleet
    /// dispatch, or the A2A gateway.
    #[test]
    fn milestone_cannot_ship_without_being_cut() {
        let pool = crate::init_test_db().unwrap();
        let project = create_project(&pool, "P", "/tmp/mp4", None, None, None, None, None).unwrap();

        let m = create_milestone(&pool, &project.id, "v1", None, None, None).unwrap();
        assert_eq!(m.status, "planned");
        let err = update_milestone(&pool, &m.id, None, None, Some("shipped"), None, None);
        assert!(
            matches!(err, Err(AppError::Validation(_))),
            "planned → shipped must be rejected, got {err:?}"
        );
        // Rejected means UNCHANGED, not partially applied.
        let still = get_milestone_by_id(&pool, &m.id).unwrap();
        assert_eq!(still.status, "planned");
        assert!(still.shipped_at.is_none());

        // The legal path stamps both timestamps.
        let m = update_milestone(&pool, &m.id, None, None, Some("active"), None, None).unwrap();
        assert!(m.cut_at.is_some());
        let m = update_milestone(&pool, &m.id, None, None, Some("shipped"), None, None).unwrap();
        assert!(m.cut_at.is_some(), "cut_at survives the ship transition");
        assert!(m.shipped_at.is_some());
    }

    /// Ship is a transition, not a birth state. A milestone created 'shipped'
    /// would carry `cut_at` NULL (the INSERT's CASE only stamps for 'active')
    /// and `shipped_at` NULL, so it would be invisible to velocity and read
    /// 'setup' on scope-frozen. Refuse it, and leave NO row behind.
    #[test]
    fn milestone_cannot_be_created_shipped() {
        let pool = crate::init_test_db().unwrap();
        let project = create_project(&pool, "P", "/tmp/mp5", None, None, None, None, None).unwrap();

        let err = create_milestone(&pool, &project.id, "v1", None, Some("shipped"), None);
        assert!(
            matches!(err, Err(AppError::Validation(_))),
            "creating shipped must be rejected, got {err:?}"
        );
        // Rejected means nothing was written, not a half-created row.
        assert!(
            list_milestones_by_project(&pool, &project.id)
                .unwrap()
                .is_empty(),
            "a refused creation must leave no row"
        );

        // The legal shapes still work.
        let planned = create_milestone(&pool, &project.id, "v1", None, None, None).unwrap();
        assert_eq!(planned.status, "planned");
        let active =
            create_milestone(&pool, &project.id, "v2", None, Some("active"), None).unwrap();
        assert_eq!(active.status, "active");
        assert!(active.shipped_at.is_none());
    }

    /// `description` / `rating` round-trip through the upsert, follow the
    /// absent-vs-explicit-null patch convention, and never disturb the
    /// scope-creep flag an existing member was born with.
    #[test]
    fn milestone_item_description_and_rating_round_trip() {
        let pool = crate::init_test_db().unwrap();
        let project = create_project(&pool, "P", "/tmp/mp6", None, None, None, None, None).unwrap();
        let m = create_milestone(&pool, &project.id, "v1", None, None, None).unwrap();

        // Born before the cut, with both annotations.
        let a = set_milestone_item(
            &pool,
            &m.id,
            "use_case",
            "uc-a",
            "core",
            Some(Some("The one flow that proves the product")),
            Some(Some(5)),
        )
        .unwrap();
        assert_eq!(
            a.description.as_deref(),
            Some("The one flow that proves the product")
        );
        assert_eq!(a.rating, Some(5));
        assert!(!a.added_after_cut);

        // Cut the milestone, then re-bucket WITHOUT sending either field:
        // both must survive untouched, and so must the creep flag.
        update_milestone(&pool, &m.id, None, None, Some("active"), None, None).unwrap();
        let a = set_milestone_item(&pool, &m.id, "use_case", "uc-a", "later", None, None).unwrap();
        assert_eq!(a.bucket, "later");
        assert_eq!(
            a.description.as_deref(),
            Some("The one flow that proves the product")
        );
        assert_eq!(a.rating, Some(5), "an omitted field is left unchanged");
        assert!(
            !a.added_after_cut,
            "annotating never rewrites the creep flag"
        );

        // Patch only the rating; the description stays.
        let a = set_milestone_item(
            &pool,
            &m.id,
            "use_case",
            "uc-a",
            "later",
            None,
            Some(Some(2)),
        )
        .unwrap();
        assert_eq!(a.rating, Some(2));
        assert!(a.description.is_some());

        // Explicit null CLEARS — and unrated is not rated-1.
        let a = set_milestone_item(
            &pool,
            &m.id,
            "use_case",
            "uc-a",
            "later",
            Some(None),
            Some(None),
        )
        .unwrap();
        assert!(a.description.is_none());
        assert!(a.rating.is_none(), "cleared means unrated, not 1");
        assert!(!a.added_after_cut);

        // A member created after the cut is still creep, annotations or not.
        let b = set_milestone_item(
            &pool,
            &m.id,
            "use_case",
            "uc-b",
            "core",
            Some(Some("late idea")),
            Some(Some(3)),
        )
        .unwrap();
        assert!(b.added_after_cut);
        assert_eq!(b.rating, Some(3));

        // The list read carries them too (it is a `SELECT *` → row mapper).
        let items = list_milestone_items(&pool, &m.id).unwrap();
        let listed_b = items.iter().find(|i| i.item_id == "uc-b").unwrap();
        assert_eq!(listed_b.description.as_deref(), Some("late idea"));
        assert_eq!(listed_b.rating, Some(3));
    }

    /// Rating bounds are enforced twice: the repo returns a Validation error
    /// with a message, and the column CHECK is the backstop for any writer
    /// that bypasses the repo.
    #[test]
    fn milestone_item_rating_bounds_are_enforced() {
        let pool = crate::init_test_db().unwrap();
        let project = create_project(&pool, "P", "/tmp/mp7", None, None, None, None, None).unwrap();
        let m = create_milestone(&pool, &project.id, "v1", None, None, None).unwrap();

        for bad in [0, 6, -1, 99] {
            let err = set_milestone_item(
                &pool,
                &m.id,
                "use_case",
                "uc-a",
                "core",
                None,
                Some(Some(bad)),
            );
            assert!(
                matches!(err, Err(AppError::Validation(_))),
                "rating {bad} must be rejected, got {err:?}"
            );
        }
        // A rejected write leaves no row.
        assert!(list_milestone_items(&pool, &m.id).unwrap().is_empty());

        // Bounds are inclusive.
        for good in 1..=5 {
            let it = set_milestone_item(
                &pool,
                &m.id,
                "use_case",
                "uc-a",
                "core",
                None,
                Some(Some(good)),
            )
            .unwrap();
            assert_eq!(it.rating, Some(good));
        }

        // The DB CHECK itself refuses an out-of-range write that skips the repo.
        set_milestone_item(&pool, &m.id, "use_case", "uc-b", "core", None, None).unwrap();
        let conn = pool.get().unwrap();
        let direct = conn.execute(
            "UPDATE dev_milestone_items SET rating = 9
             WHERE milestone_id = ?1 AND item_kind = 'use_case' AND item_id = 'uc-b'",
            params![m.id],
        );
        assert!(direct.is_err(), "the column CHECK must reject rating 9");
        // …but NULL is always legal: unrated is a real state.
        conn.execute(
            "UPDATE dev_milestone_items SET rating = NULL
             WHERE milestone_id = ?1 AND item_kind = 'use_case' AND item_id = 'uc-b'",
            params![m.id],
        )
        .unwrap();
    }
}
