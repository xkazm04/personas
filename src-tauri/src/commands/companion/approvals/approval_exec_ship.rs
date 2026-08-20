//! `approval_exec_ship` — part of the approval module family (split from the
//! former approvals.rs god file, 2026-07-24). Shared imports, status consts
//! and the Tauri-facing types live in `mod.rs`; siblings are reachable
//! through the parent's glob re-exports.
//!
//! # Conversational ship milestone (WP3, 2026-08-04)
//!
//! The chat-first path from "what should the next milestone be?" to a real
//! `dev_milestones` row. Athena proposes a whole milestone with
//! `show_ship_milestone`; the editable chat card is where the operator
//! corrects the name, the goal, each item's description, and drops the rows
//! that do not belong; confirming calls [`companion_create_ship_milestone`],
//! which re-runs the SAME validation the proposal passed and then goes
//! through the ordinary repo functions (`create_milestone` +
//! `set_milestone_item`) — no privileged write path of its own.
//!
//! Deliberate scope boundary: a milestone's scope members are use cases and
//! goals ONLY (`dev_milestone_items.item_kind` is CHECK-constrained to those
//! two). KPIs are the outcome layer ABOVE a milestone, not members of it, and
//! this file never invents a third kind.

#[allow(unused_imports)]
use super::*;

use crate::db::repos::dev_tools as repo;

/// Scope members one proposed milestone may carry. Mirrors
/// [`FLEET_PLAN_MAX_ROWS`] rather than inventing a second reviewability
/// ceiling: both cards are chat surfaces whose whole value is that the
/// operator READS every row before pressing Confirm, and this codebase
/// already decided eight rows is where that stops being true. A cut with
/// more than eight members is not a milestone, it is a backlog.
pub(crate) const SHIP_MILESTONE_MAX_ROWS: usize = FLEET_PLAN_MAX_ROWS;
/// Longest milestone name. Same bound as the fleet plan's one-line intent —
/// both are the single label the thing is filed under.
pub(crate) const SHIP_MILESTONE_NAME_MAX: usize = FLEET_PLAN_INTENT_MAX;
/// Longest milestone goal (the paragraph naming what shipping this means).
/// Same bound as a plan row's objective: a real brief, never a document.
pub(crate) const SHIP_MILESTONE_GOAL_MAX: usize = FLEET_PLAN_OBJECTIVE_MAX;
/// Longest per-row "why this is in scope" note, stored in
/// `dev_milestone_items.description` (WP1).
pub(crate) const SHIP_MILESTONE_DESCRIPTION_MAX: usize = FLEET_PLAN_OBJECTIVE_MAX;

/// Bucket every proposed member lands in. A proposal IS the core cut; the
/// `later` / `never` buckets are a triage the operator performs afterwards in
/// the Ship tab, not something a chat card should pre-judge.
pub(crate) const SHIP_MILESTONE_BUCKET: &str = "core";

/// The only two member kinds. Mirrors the `dev_milestone_items.item_kind`
/// CHECK constraint and `set_milestone_item`'s own guard, so a bad kind is
/// refused with a readable reason before it ever reaches the repo.
pub(crate) const SHIP_MILESTONE_ITEM_KINDS: &[&str] = &["use_case", "goal"];

/// One validated scope member: which table it lives in, its REAL id (resolved
/// here from whatever the model wrote), and the note explaining the cut.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct ShipMilestoneRow {
    pub item_kind: String,
    pub item_id: String,
    pub description: Option<String>,
}

/// A validated milestone proposal, ready to create.
#[derive(Debug, Clone)]
pub(crate) struct ShipMilestonePlan {
    /// Resolved `dev_projects.id` — never the string the model wrote.
    pub project_id: String,
    pub name: String,
    pub goal: Option<String>,
    pub rows: Vec<ShipMilestoneRow>,
}

/// Result of a confirmed creation. Hand-written on the TS side
/// (`src/api/companion.ts`) like the rest of this module's Tauri-facing
/// types — no ts-rs export, so the bindings tree stays untouched.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShipMilestoneCreated {
    pub milestone_id: String,
    pub name: String,
    pub status: String,
    pub items_created: usize,
}

/// Real candidates offered when a lookup misses, so the next attempt is
/// grounded rather than a second guess. Same count as the read ops'.
use crate::companion::dispatcher::READ_OP_SUGGESTIONS;

/// `name (id)` pairs from one table, for a rejection message.
fn candidates(conn: &rusqlite::Connection, sql: &str, args: &[&dyn rusqlite::ToSql]) -> String {
    let rows: Vec<String> = match conn.prepare(sql) {
        Ok(mut stmt) => stmt
            .query_map(args, |r| {
                Ok(format!(
                    "{} (`{}`)",
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?
                ))
            })
            .map(|rows| rows.filter_map(Result::ok).collect())
            .unwrap_or_default(),
        Err(_) => Vec::new(),
    };
    if rows.is_empty() {
        "none exist yet".to_string()
    } else {
        rows.join(", ")
    }
}

/// Resolve whatever the model wrote for a project into a real
/// `dev_projects.id`. Accepts the id, the exact name, or a name substring —
/// the same generosity `describe_context` shows — and nothing else.
fn resolve_project(conn: &rusqlite::Connection, slug: &str) -> Result<String, String> {
    let like = format!("%{slug}%");
    conn.query_row(
        "SELECT id FROM dev_projects
         WHERE id = ?1 COLLATE NOCASE OR name = ?1 COLLATE NOCASE OR name LIKE ?2 COLLATE NOCASE
         ORDER BY CASE WHEN id = ?1 COLLATE NOCASE THEN 0
                       WHEN name = ?1 COLLATE NOCASE THEN 1 ELSE 2 END
         LIMIT 1",
        params![slug, like],
        |r| r.get::<_, String>(0),
    )
    .map_err(|_| {
        format!(
            "no registered project matches `{slug}`. Registered projects: {}. \
             Ask which one was meant; do not invent a project.",
            candidates(
                conn,
                "SELECT name, id FROM dev_projects ORDER BY updated_at DESC LIMIT ?1",
                &[&(READ_OP_SUGGESTIONS as i64)],
            )
        )
    })
}

/// Resolve one member's `item_id` against the rows that actually exist FOR
/// THAT PROJECT. A use case matches on id, slug or name; a goal on id or
/// title. A miss names real candidates — that rejection is the discovery
/// path, which is why it carries ids rather than a scolding.
fn resolve_item(
    conn: &rusqlite::Connection,
    project_id: &str,
    item_kind: &str,
    item_id: &str,
) -> Result<String, String> {
    let (lookup, candidate_sql, label) = if item_kind == "use_case" {
        (
            "SELECT id FROM dev_use_cases
             WHERE project_id = ?1
               AND (id = ?2 COLLATE NOCASE OR slug = ?2 COLLATE NOCASE OR name = ?2 COLLATE NOCASE)
             LIMIT 1",
            "SELECT name, id FROM dev_use_cases WHERE project_id = ?1
             ORDER BY pinned DESC, updated_at DESC LIMIT ?2",
            "use case",
        )
    } else {
        (
            "SELECT id FROM dev_goals
             WHERE project_id = ?1 AND (id = ?2 COLLATE NOCASE OR title = ?2 COLLATE NOCASE)
             LIMIT 1",
            "SELECT title, id FROM dev_goals WHERE project_id = ?1
             ORDER BY updated_at DESC LIMIT ?2",
            "goal",
        )
    };
    conn.query_row(lookup, params![project_id, item_id], |r| {
        r.get::<_, String>(0)
    })
    .map_err(|_| {
        format!(
            "no {label} `{item_id}` exists in this project. Real {label}s here: {}. \
             Use one of those ids, or leave the item out.",
            candidates(
                conn,
                candidate_sql,
                &[&project_id, &(READ_OP_SUGGESTIONS as i64)],
            )
        )
    })
}

/// Validate a proposed ship milestone against the REAL registry, at PROPOSAL
/// time rather than at create time. Returns the resolved plan, or a single
/// human-readable reason.
///
/// Rules, in order: the project resolves · a non-empty bounded name · a
/// bounded optional goal · 1..=[`SHIP_MILESTONE_MAX_ROWS`] rows · per row a
/// kind in [`SHIP_MILESTONE_ITEM_KINDS`], an `item_id` that resolves to a row
/// of that kind BELONGING TO THIS PROJECT, a bounded optional description,
/// and no duplicate member (the upsert would silently merge two rows).
pub(crate) fn validate_ship_milestone(
    db: &crate::db::DbPool,
    project_slug: &str,
    name: &str,
    goal: &str,
    rows: &[serde_json::Value],
) -> Result<ShipMilestonePlan, String> {
    let conn = db.get().map_err(|e| format!("database unavailable: {e}"))?;
    let project_id = resolve_project(&conn, project_slug.trim())?;

    let name = name.trim();
    if name.is_empty() {
        return Err("`name` must be a non-empty milestone name".into());
    }
    if name.chars().count() > SHIP_MILESTONE_NAME_MAX {
        return Err(format!(
            "`name` is too long (max {SHIP_MILESTONE_NAME_MAX} characters)"
        ));
    }
    let goal = goal.trim();
    if goal.chars().count() > SHIP_MILESTONE_GOAL_MAX {
        return Err(format!(
            "`goal` is too long (max {SHIP_MILESTONE_GOAL_MAX} characters)"
        ));
    }

    if rows.is_empty() {
        return Err("`rows` must contain at least one use case or goal".into());
    }
    if rows.len() > SHIP_MILESTONE_MAX_ROWS {
        return Err(format!(
            "{} items exceeds the milestone cap of {SHIP_MILESTONE_MAX_ROWS} per cut",
            rows.len()
        ));
    }

    let mut out: Vec<ShipMilestoneRow> = Vec::with_capacity(rows.len());
    for (i, row) in rows.iter().enumerate() {
        let n = i + 1;
        let item_kind = row
            .get("item_kind")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .unwrap_or("");
        if !SHIP_MILESTONE_ITEM_KINDS.contains(&item_kind) {
            return Err(format!(
                "row {n}: `item_kind` must be `use_case` or `goal`, not `{item_kind}`. \
                 KPIs are the outcome layer above a milestone, never members of one."
            ));
        }
        let item_id = row
            .get("item_id")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .unwrap_or("");
        if item_id.is_empty() {
            return Err(format!("row {n}: `item_id` must not be empty"));
        }
        let resolved = resolve_item(&conn, &project_id, item_kind, item_id)
            .map_err(|e| format!("row {n}: {e}"))?;
        if out
            .iter()
            .any(|r| r.item_kind == item_kind && r.item_id == resolved)
        {
            return Err(format!(
                "row {n}: `{item_id}` is already in this milestone; a scope member appears once"
            ));
        }
        let description = match row
            .get("description")
            .and_then(|v| v.as_str())
            .map(str::trim)
        {
            None | Some("") => None,
            Some(d) => {
                if d.chars().count() > SHIP_MILESTONE_DESCRIPTION_MAX {
                    return Err(format!(
                        "row {n}: `description` is too long (max {SHIP_MILESTONE_DESCRIPTION_MAX} characters)"
                    ));
                }
                Some(d.to_string())
            }
        };
        out.push(ShipMilestoneRow {
            item_kind: item_kind.to_string(),
            item_id: resolved,
            description,
        });
    }

    Ok(ShipMilestonePlan {
        project_id,
        name: name.to_string(),
        goal: (!goal.is_empty()).then(|| goal.to_string()),
        rows: out,
    })
}

/// Create a validated plan through the ordinary repo functions. Separate from
/// the command so the created shape is testable without a Tauri `State`.
///
/// The milestone is born `planned` — creation passes no status at all, because
/// `create_milestone` refuses `shipped` outright and `active` would stamp
/// `cut_at`, freezing scope the operator has not agreed to yet. Cutting is a
/// transition the Ship tab owns.
pub(crate) fn create_ship_milestone_inner(
    db: &crate::db::DbPool,
    plan: &ShipMilestonePlan,
) -> Result<ShipMilestoneCreated, AppError> {
    let milestone = repo::create_milestone(
        db,
        &plan.project_id,
        &plan.name,
        plan.goal.as_deref(),
        None,
        None,
    )?;
    let mut items_created = 0usize;
    for row in &plan.rows {
        repo::set_milestone_item(
            db,
            &milestone.id,
            &row.item_kind,
            &row.item_id,
            SHIP_MILESTONE_BUCKET,
            Some(row.description.as_deref()),
            None,
        )?;
        items_created += 1;
    }
    Ok(ShipMilestoneCreated {
        milestone_id: milestone.id,
        name: milestone.name,
        status: milestone.status,
        items_created,
    })
}

/// Confirm-and-create for the editable in-chat ship milestone.
///
/// The card the operator just edited is the consent surface, so there is no
/// second approval gate — but the whole proposal is re-validated here against
/// the live registry, because the rows arriving are the USER-EDITED ones, not
/// the ones Athena proposed. A row whose id the operator retyped into
/// something that does not exist is refused here, and the card shows the
/// refusal rather than claiming a milestone appeared.
#[tauri::command]
pub async fn companion_create_ship_milestone(
    state: State<'_, Arc<AppState>>,
    project_slug: String,
    name: String,
    goal: Option<String>,
    rows: Vec<serde_json::Value>,
) -> Result<ShipMilestoneCreated, AppError> {
    ipc_auth::require_auth(&state).await?;
    let plan = validate_ship_milestone(
        &state.db,
        &project_slug,
        &name,
        goal.as_deref().unwrap_or(""),
        &rows,
    )
    .map_err(AppError::Validation)?;
    tracing::info!(
        project_id = %plan.project_id,
        name = %plan.name,
        items = plan.rows.len(),
        "companion: creating confirmed ship milestone"
    );
    create_ship_milestone_inner(&state.db, &plan)
}

#[cfg(test)]
mod ship_milestone_tests {
    use super::*;
    use r2d2::Pool;
    use r2d2_sqlite::SqliteConnectionManager;

    /// A system DB carrying just the four tables this path reads and writes.
    fn pool_with_fixture() -> crate::db::DbPool {
        let manager = SqliteConnectionManager::memory();
        let pool = Pool::builder().max_size(1).build(manager).expect("pool");
        let conn = pool.get().unwrap();
        conn.execute_batch(
            "CREATE TABLE dev_projects (id TEXT PRIMARY KEY, name TEXT NOT NULL,
                root_path TEXT NOT NULL, description TEXT, status TEXT NOT NULL,
                tech_stack TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
             CREATE TABLE dev_use_cases (id TEXT PRIMARY KEY, project_id TEXT NOT NULL,
                name TEXT NOT NULL, slug TEXT NOT NULL, description TEXT,
                pinned INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL);
             CREATE TABLE dev_goals (id TEXT PRIMARY KEY, project_id TEXT NOT NULL,
                title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open',
                updated_at TEXT NOT NULL);
             CREATE TABLE dev_milestones (id TEXT PRIMARY KEY, project_id TEXT NOT NULL,
                name TEXT NOT NULL, goal TEXT,
                status TEXT NOT NULL DEFAULT 'planned'
                    CHECK(status IN ('planned','active','shipped')),
                order_index INTEGER NOT NULL DEFAULT 0, target_date TEXT,
                cut_at TEXT, shipped_at TEXT,
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
             CREATE TABLE dev_milestone_items (milestone_id TEXT NOT NULL,
                item_kind TEXT NOT NULL CHECK(item_kind IN ('use_case','goal')),
                item_id TEXT NOT NULL,
                bucket TEXT NOT NULL DEFAULT 'core'
                    CHECK(bucket IN ('core','later','never')),
                added_after_cut INTEGER NOT NULL DEFAULT 0,
                order_index INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL, description TEXT, rating INTEGER,
                PRIMARY KEY (milestone_id, item_kind, item_id));

             INSERT INTO dev_projects VALUES
               ('proj_1','Personas','C:/repo','','active','','2026-08-04','2026-08-04');
             INSERT INTO dev_use_cases VALUES
               ('uc_1','proj_1','Ship tab','ship-tab','',0,'2026-08-04'),
               ('uc_2','proj_1','Vault catalog','vault-catalog','',0,'2026-08-04');
             INSERT INTO dev_goals VALUES
               ('goal_1','proj_1','Cut the first milestone','open','2026-08-04');",
        )
        .unwrap();
        pool
    }

    fn row(kind: &str, id: &str, description: Option<&str>) -> serde_json::Value {
        match description {
            Some(d) => {
                serde_json::json!({ "item_kind": kind, "item_id": id, "description": d })
            }
            None => serde_json::json!({ "item_kind": kind, "item_id": id }),
        }
    }

    #[test]
    fn accepts_real_ids_and_normalizes_names_to_ids() {
        let pool = pool_with_fixture();
        let plan = validate_ship_milestone(
            &pool,
            "Personas",
            "  M1  ",
            "  first cut  ",
            &[
                row("use_case", "uc_1", Some("  the whole point  ")),
                // A name and a slug both resolve to the real id.
                row("use_case", "Vault catalog", None),
                row("goal", "goal_1", None),
            ],
        )
        .expect("plan should validate");
        assert_eq!(plan.project_id, "proj_1");
        assert_eq!(plan.name, "M1");
        assert_eq!(plan.goal.as_deref(), Some("first cut"));
        assert_eq!(plan.rows[0].description.as_deref(), Some("the whole point"));
        assert_eq!(plan.rows[1].item_id, "uc_2");
        assert_eq!(plan.rows[2].item_kind, "goal");
    }

    /// The whole point of validating at the door: a model that invents an id
    /// gets told which ids are real, so the NEXT turn is grounded.
    #[test]
    fn rejects_a_hallucinated_item_id_and_names_real_candidates() {
        let pool = pool_with_fixture();
        let err = validate_ship_milestone(
            &pool,
            "proj_1",
            "M1",
            "",
            &[row("use_case", "uc_does_not_exist", None)],
        )
        .expect_err("a hallucinated id must be refused");
        assert!(err.contains("uc_does_not_exist"), "{err}");
        assert!(
            err.contains("uc_1"),
            "real candidate ids must be named: {err}"
        );
        assert!(
            err.contains("Ship tab"),
            "candidates carry names too: {err}"
        );
    }

    /// A use case id under `goal` is not "close enough" — the two tables are
    /// different things, and the CHECK constraint would not catch this one.
    #[test]
    fn rejects_an_item_id_from_the_wrong_table() {
        let pool = pool_with_fixture();
        let err = validate_ship_milestone(&pool, "proj_1", "M1", "", &[row("goal", "uc_1", None)])
            .expect_err("a use case is not a goal");
        assert!(err.contains("goal_1"), "{err}");
    }

    #[test]
    fn rejects_an_item_belonging_to_another_project() {
        let pool = pool_with_fixture();
        {
            let conn = pool.get().unwrap();
            conn.execute_batch(
                "INSERT INTO dev_projects VALUES
                   ('proj_2','Other','C:/other','','active','','2026-08-04','2026-08-04');
                 INSERT INTO dev_use_cases VALUES
                   ('uc_9','proj_2','Foreign','foreign','',0,'2026-08-04');",
            )
            .unwrap();
        }
        let err =
            validate_ship_milestone(&pool, "proj_1", "M1", "", &[row("use_case", "uc_9", None)])
                .expect_err("cross-project membership must be refused");
        assert!(err.contains("uc_9"), "{err}");
    }

    #[test]
    fn rejects_a_kind_that_is_not_a_milestone_member() {
        let pool = pool_with_fixture();
        for kind in ["kpi", "context", ""] {
            let err = validate_ship_milestone(&pool, "proj_1", "M1", "", &[row(kind, "x", None)])
                .expect_err("only use_case and goal are members");
            assert!(err.contains("item_kind"), "{err}");
            assert!(
                err.contains("KPI"),
                "the reason must state the KPI rule: {err}"
            );
        }
    }

    #[test]
    fn rejects_an_unknown_project_and_names_the_real_ones() {
        let pool = pool_with_fixture();
        let err = validate_ship_milestone(
            &pool,
            "not-a-project",
            "M1",
            "",
            &[row("goal", "goal_1", None)],
        )
        .expect_err("an unknown project must be refused");
        assert!(err.contains("Personas"), "{err}");
        assert!(err.contains("proj_1"), "{err}");
    }

    #[test]
    fn enforces_the_row_bounds_and_refuses_duplicates() {
        let pool = pool_with_fixture();
        assert!(validate_ship_milestone(&pool, "proj_1", "M1", "", &[]).is_err());
        let many: Vec<serde_json::Value> = (0..SHIP_MILESTONE_MAX_ROWS + 1)
            .map(|_| row("use_case", "uc_1", None))
            .collect();
        let err = validate_ship_milestone(&pool, "proj_1", "M1", "", &many)
            .expect_err("the cap must hold");
        assert!(err.contains(&SHIP_MILESTONE_MAX_ROWS.to_string()), "{err}");

        let dup = vec![
            row("use_case", "uc_1", None),
            row("use_case", "Ship tab", None),
        ];
        let err = validate_ship_milestone(&pool, "proj_1", "M1", "", &dup)
            .expect_err("the same member twice must be refused");
        assert!(err.contains("already in this milestone"), "{err}");

        let long = "x".repeat(SHIP_MILESTONE_NAME_MAX + 1);
        assert!(validate_ship_milestone(&pool, "proj_1", &long, "", &dup[..1]).is_err());
        assert!(validate_ship_milestone(&pool, "proj_1", "  ", "", &dup[..1]).is_err());
    }

    /// The EDITED rows are what gets created: the plan handed to
    /// `create_ship_milestone_inner` is the only thing that reaches the DB,
    /// and every part of it lands — `planned` status, the goal, and each
    /// row's own description.
    #[test]
    fn creates_a_planned_milestone_carrying_the_edited_rows() {
        let pool = pool_with_fixture();
        // The operator dropped Athena's second row and rewrote the first note.
        let plan = validate_ship_milestone(
            &pool,
            "proj_1",
            "M1 — first cut",
            "everything the Ship tab needs to be believable",
            &[
                row("use_case", "uc_1", Some("rewritten by the operator")),
                row("goal", "goal_1", None),
            ],
        )
        .expect("edited plan validates");
        let created = create_ship_milestone_inner(&pool, &plan).expect("create");
        assert_eq!(created.items_created, 2);
        assert_eq!(created.status, "planned");

        let conn = pool.get().unwrap();
        let (goal, status): (Option<String>, String) = conn
            .query_row(
                "SELECT goal, status FROM dev_milestones WHERE id = ?1",
                params![created.milestone_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(
            status, "planned",
            "a milestone is never born shipped or cut"
        );
        assert_eq!(
            goal.as_deref(),
            Some("everything the Ship tab needs to be believable")
        );
        let desc: Option<String> = conn
            .query_row(
                "SELECT description FROM dev_milestone_items
                 WHERE milestone_id = ?1 AND item_id = 'uc_1'",
                params![created.milestone_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(desc.as_deref(), Some("rewritten by the operator"));
        let bucket: String = conn
            .query_row(
                "SELECT bucket FROM dev_milestone_items
                 WHERE milestone_id = ?1 AND item_id = 'goal_1'",
                params![created.milestone_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(bucket, SHIP_MILESTONE_BUCKET);
    }

    /// The caps are borrowed on purpose, not copied. If the fleet plan's
    /// reviewability ceiling ever moves, this milestone's moves with it.
    #[test]
    fn caps_mirror_the_plan_card_rather_than_inventing_numbers() {
        assert_eq!(SHIP_MILESTONE_MAX_ROWS, FLEET_PLAN_MAX_ROWS);
        assert_eq!(SHIP_MILESTONE_NAME_MAX, FLEET_PLAN_INTENT_MAX);
        assert_eq!(SHIP_MILESTONE_GOAL_MAX, FLEET_PLAN_OBJECTIVE_MAX);
    }
}
