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
/// Longest milestone OBJECTIVE. A handful of words — the Ship tab renders it
/// as the milestone's heading, so this is a title bound, not a prose bound.
///
/// It used to be `FLEET_PLAN_OBJECTIVE_MAX` and the grammar asked the model for
/// "one paragraph: what shipping this milestone actually means". The model
/// complied, and the paragraph rendered where a name belonged. The operator
/// ruled on 2026-08-24 that no automation may write descriptive text into this
/// field; the prose moved to `dev_milestones.description`, and this number is
/// what makes the rule enforceable rather than advisory.
///
/// 72 is shared with the `dev_milestones.description` migration, which used the
/// same threshold to decide which existing goals were really prose and moved
/// them. Keep the two in step.
pub(crate) const SHIP_MILESTONE_GOAL_MAX: usize = 72;
/// Longest milestone DESCRIPTION — the paragraph that used to be crammed into
/// the objective. A real brief, never a document.
pub(crate) const SHIP_MILESTONE_DESC_MAX: usize = FLEET_PLAN_OBJECTIVE_MAX;
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
    /// The objective, as a SHORT TITLE (see `SHIP_MILESTONE_GOAL_MAX`).
    pub goal: Option<String>,
    /// What shipping this means, in prose. Where the paragraph goes now.
    pub description: Option<String>,
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
    description: &str,
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
            "`goal` is the milestone's TITLE and is too long at {} characters \
             (max {SHIP_MILESTONE_GOAL_MAX}). It renders as the heading in the \
             Ship tab, so a sentence there reads as a broken layout, not as an \
             explanation. Put a handful of words here and move the prose to \
             `description`.",
            goal.chars().count()
        ));
    }
    let description = description.trim();
    if description.chars().count() > SHIP_MILESTONE_DESC_MAX {
        return Err(format!(
            "`description` is too long (max {SHIP_MILESTONE_DESC_MAX} characters)"
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
        description: (!description.is_empty()).then(|| description.to_string()),
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
        plan.description.as_deref(),
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
    description: Option<String>,
    rows: Vec<serde_json::Value>,
) -> Result<ShipMilestoneCreated, AppError> {
    ipc_auth::require_auth(&state).await?;
    let plan = validate_ship_milestone(
        &state.db,
        &project_slug,
        &name,
        goal.as_deref().unwrap_or(""),
        description.as_deref().unwrap_or(""),
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

// ── show_ship_goals: turning a written BRIEF into trackable work ──────────
//
// `show_ship_milestone` and `set_ship_scope` can only BIND a goal that already
// exists: `resolve_item` refuses an `item_id` that does not resolve, which is
// exactly right for a card whose job is keeping invented ids out of the
// database, and which left Athena with no op at all for the constitution's own
// instruction — "an idea with no home yet is a GOAL bound to the milestone".
// She could be told to file an idea as a goal and had no verb for it.
//
// This is that verb, aimed at the one place the gap actually hurt: a
// milestone's `description` is the operator's brief, free markdown that
// routinely names the deliverables. Until now the only route from that prose
// to trackable work was for him to hand-author each goal and bind it.
//
// Same consent posture as the milestone card, deliberately: auto-fire, no
// approval row, the editable card IS the consent surface, and the confirm
// command re-runs THIS validator over the rows the OPERATOR edited rather than
// the ones Athena proposed.

/// Longest proposed goal title. Borrows [`SHIP_MILESTONE_NAME_MAX`] rather
/// than inventing a number: a goal title and a milestone name are the same
/// kind of thing — the single label the row is filed under, rendered as a
/// heading in the Goals hub and in the Ship tab's goal rail.
pub(crate) const SHIP_GOAL_TITLE_MAX: usize = SHIP_MILESTONE_NAME_MAX;

/// Longest proposed goal description. Borrows the milestone's own prose bound:
/// both are a brief, and neither is a document.
pub(crate) const SHIP_GOAL_DESC_MAX: usize = SHIP_MILESTONE_DESC_MAX;

/// The one `dev_milestone_items.item_kind` this op writes. Named rather than
/// spelled inline at the write so the CHECK-constrained vocabulary keeps a
/// single home in this file; `the_goal_kind_is_a_real_member_kind` pins it to
/// [`SHIP_MILESTONE_ITEM_KINDS`].
pub(crate) const SHIP_GOAL_ITEM_KIND: &str = "goal";

/// One validated proposed goal.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct ShipGoalRow {
    pub title: String,
    pub description: Option<String>,
    /// Resolved `dev_contexts.id`, when the proposal named a context. `None`
    /// means the goal is deliberately unfiled — a legitimate state for an idea
    /// with no home yet, which is the whole reason this op exists.
    pub context_id: Option<String>,
    /// `Some(id)` when a goal with this title ALREADY exists in the project.
    /// Confirming then binds that row instead of creating a second one — see
    /// [`validate_ship_goals`] for how the match is decided.
    pub existing_id: Option<String>,
}

/// A validated decomposition, ready to create and bind.
#[derive(Debug, Clone)]
pub(crate) struct ShipGoalsPlan {
    /// Resolved `dev_milestones.id` — the row that was proved to exist.
    pub milestone_id: String,
    pub milestone_name: String,
    /// The MILESTONE's project. Every goal is created here; the payload never
    /// gets to name a project of its own.
    pub project_id: String,
    pub rows: Vec<ShipGoalRow>,
}

/// Result of a confirmed decomposition. Hand-written on the TS side
/// (`src/api/companion.ts`) like the rest of this module's Tauri-facing types
/// — no ts-rs export, so the bindings tree stays untouched.
///
/// `created` and `bound` are reported separately on purpose: "8 goals" reads
/// the same whether eight rows appeared or eight already existed, and that
/// difference is the entire point of the idempotence rule.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShipGoalsCreated {
    pub milestone_id: String,
    /// Goals that did not exist and were created.
    pub created: usize,
    /// Goals that already existed and were bound to the milestone instead.
    pub bound: usize,
}

/// Resolve whatever the model wrote for a context into a real
/// `dev_contexts.id`, scoped to the milestone's project. Same generosity as
/// [`resolve_project`] — id, exact name, or name substring — and a miss names
/// real candidates rather than scolding, because that rejection is the
/// discovery path.
///
/// A miss REFUSES rather than quietly dropping the hint: silently filing a
/// goal under nothing while the card said otherwise is a difference the
/// operator cannot see. Omitting `context_hint` entirely is how a genuinely
/// unfiled goal is expressed, and the refusal says so.
pub(crate) fn resolve_context(
    conn: &rusqlite::Connection,
    project_id: &str,
    hint: &str,
) -> Result<String, String> {
    // Escaped, with an explicit ESCAPE clause. The hint is model-authored free
    // text, and this SQLite build is compiled without ICU: unescaped, a hint
    // containing `_` matches any single character, so `ship_ops` would resolve
    // `shipXops`. `resolve_project` one function up has the same shape and is
    // NOT escaped — that site is baselined by `unescaped-like-pattern` and
    // fixing it here would be an unrelated change to a Ship approval path.
    let like = format!("%{}%", crate::db::repos::utils::escape_like(hint));
    conn.query_row(
        "SELECT id FROM dev_contexts
         WHERE project_id = ?1
           AND (id = ?2 COLLATE NOCASE OR name = ?2 COLLATE NOCASE
                OR name LIKE ?3 ESCAPE '\\' COLLATE NOCASE)
         ORDER BY CASE WHEN id = ?2 COLLATE NOCASE THEN 0
                       WHEN name = ?2 COLLATE NOCASE THEN 1 ELSE 2 END
         LIMIT 1",
        params![project_id, hint, like],
        |r| r.get::<_, String>(0),
    )
    .map_err(|_| {
        format!(
            "no context matches `{hint}` in this milestone's project. Real contexts here: {}. \
             Use one of those, or omit `context_hint` — a goal with no context is fine.",
            candidates(
                conn,
                "SELECT name, id FROM dev_contexts WHERE project_id = ?1
                 ORDER BY pinned DESC, updated_at DESC LIMIT ?2",
                &[&project_id, &(READ_OP_SUGGESTIONS as i64)],
            )
        )
    })
}

/// Validate a proposed goal decomposition against the REAL registry.
///
/// Rules, in order: a `milestone_id` that resolves (and its project comes from
/// the ROW, never from the payload) · 1..=[`SHIP_MILESTONE_MAX_ROWS`] goals ·
/// per goal a non-empty bounded title, a bounded optional description, an
/// optional `context_hint` that resolves inside that project, and no duplicate
/// title within the card.
///
/// **Idempotence.** Each title is looked up with [`resolve_item`] — the SAME
/// helper `show_ship_milestone` uses to bind an existing member, so "does this
/// goal already exist" is answered exactly once in this file and both ops
/// agree. It matches `id = ?` OR `title = ?` under `COLLATE NOCASE` within the
/// project, so proposing a title that is already there BINDS that goal rather
/// than creating a second row with the same name. A hit is recorded on the row
/// (`existing_id`) so the card can say so before the operator confirms, and it
/// is recomputed here at confirm time because the registry can move while a
/// card sits in the transcript.
///
/// The whole payload is validated before anything is written, for the reason
/// `ship_ingest` states about a partially applied result: a decomposition that
/// created three goals and then refused the fourth leaves a milestone whose
/// scope is neither what Athena proposed nor what the operator agreed to.
pub(crate) fn validate_ship_goals(
    pool: &crate::db::DbPool,
    milestone_id: &str,
    rows: &[serde_json::Value],
) -> Result<ShipGoalsPlan, String> {
    let milestone_id = milestone_id.trim();
    if milestone_id.is_empty() {
        return Err("`milestone_id` is required".into());
    }
    if rows.is_empty() {
        return Err("`goals` is empty — there is nothing to propose".into());
    }
    if rows.len() > SHIP_MILESTONE_MAX_ROWS {
        return Err(format!(
            "{} goals is more than the {SHIP_MILESTONE_MAX_ROWS} an operator can review in one \
             card. A brief that decomposes into more than that is two milestones.",
            rows.len()
        ));
    }
    let conn = pool
        .get()
        .map_err(|e| format!("the project database is not reachable: {e}"))?;

    // The project comes from the MILESTONE ROW. The payload never names one,
    // so a proposal has no way to create goals in a project other than the one
    // the operator is looking at.
    let (project_id, milestone_name): (String, String) = conn
        .query_row(
            "SELECT project_id, name FROM dev_milestones WHERE id = ?1",
            params![milestone_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|_| {
            format!(
                "no milestone `{milestone_id}` — resolve it with `describe_ship_milestone` first"
            )
        })?;

    let mut out: Vec<ShipGoalRow> = Vec::with_capacity(rows.len());
    for (i, row) in rows.iter().enumerate() {
        let n = i + 1;
        let title = row
            .get("title")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .unwrap_or("");
        if title.is_empty() {
            return Err(format!("goal {n}: `title` must be a non-empty goal title"));
        }
        if title.chars().count() > SHIP_GOAL_TITLE_MAX {
            return Err(format!(
                "goal {n}: `title` is too long at {} characters (max {SHIP_GOAL_TITLE_MAX}). It \
                 renders as the goal's heading, so a sentence there reads as a broken layout. \
                 Put a handful of words here and the rest in `description`.",
                title.chars().count()
            ));
        }
        let description = match row
            .get("description")
            .and_then(|v| v.as_str())
            .map(str::trim)
        {
            None | Some("") => None,
            Some(d) => {
                if d.chars().count() > SHIP_GOAL_DESC_MAX {
                    return Err(format!(
                        "goal {n}: `description` is too long (max {SHIP_GOAL_DESC_MAX} characters)"
                    ));
                }
                Some(d.to_string())
            }
        };
        let context_id = match row
            .get("context_hint")
            .and_then(|v| v.as_str())
            .map(str::trim)
        {
            None | Some("") => None,
            Some(hint) => Some(
                resolve_context(&conn, &project_id, hint).map_err(|e| format!("goal {n}: {e}"))?,
            ),
        };

        // Two rows proposing the same goal is a card that contradicts itself;
        // whichever one won would be an accident of ordering.
        // `eq_ignore_ascii_case` rather than a Unicode fold on purpose —
        // SQLite's `COLLATE NOCASE` is ASCII-only, so this is exactly the
        // comparison the lookup below makes.
        if out.iter().any(|r| r.title.eq_ignore_ascii_case(title)) {
            return Err(format!(
                "goal {n}: `{title}` appears twice in this card — one row per goal"
            ));
        }

        // Idempotence. A hit means BIND, not create. `resolve_item`'s Err is
        // its candidate-naming rejection message, which is not a failure here:
        // "no goal with that title" is the ordinary case for a new one.
        let existing_id = resolve_item(&conn, &project_id, SHIP_GOAL_ITEM_KIND, title).ok();

        out.push(ShipGoalRow {
            title: title.to_string(),
            description,
            context_id,
            existing_id,
        });
    }

    Ok(ShipGoalsPlan {
        milestone_id: milestone_id.to_string(),
        milestone_name,
        project_id,
        rows: out,
    })
}

/// Create (or adopt) each goal and bind it to the milestone, through the
/// ordinary repo functions. Separate from the command so the written shape is
/// testable without a Tauri `State`.
///
/// Goals are born with `create_goal`'s default status (`open`) — passing no
/// status at all, because this path has no way to know a goal is further along
/// than that and must not claim it is. Every membership lands in
/// [`SHIP_MILESTONE_BUCKET`] for the same reason the milestone card does: a
/// proposal IS the core cut, and `later` / `never` is a triage the operator
/// performs afterwards in the Ship tab.
///
/// `description` and `rating` on the MEMBERSHIP are passed as `None`, not as
/// the goal's own description: those two columns are the operator's note and
/// his second opinion on the cut, and the repo's nullable-patch convention
/// leaves an omitted field untouched. Re-binding a goal he already annotated
/// must not erase what he wrote — the rule `execute_set_ship_scope` follows.
pub(crate) fn create_ship_goals_inner(
    db: &crate::db::DbPool,
    plan: &ShipGoalsPlan,
) -> Result<ShipGoalsCreated, AppError> {
    let mut created = 0usize;
    let mut bound = 0usize;
    for row in &plan.rows {
        let goal_id = match &row.existing_id {
            Some(id) => {
                bound += 1;
                id.clone()
            }
            None => {
                let goal = repo::create_goal(
                    db,
                    &plan.project_id,
                    &row.title,
                    row.description.as_deref(),
                    row.context_id.as_deref(),
                    None,
                    None,
                    None,
                )?;
                created += 1;
                goal.id
            }
        };
        repo::set_milestone_item(
            db,
            &plan.milestone_id,
            SHIP_GOAL_ITEM_KIND,
            &goal_id,
            SHIP_MILESTONE_BUCKET,
            None,
            None,
        )?;
    }
    Ok(ShipGoalsCreated {
        milestone_id: plan.milestone_id.clone(),
        created,
        bound,
    })
}

/// Confirm-and-create for the editable in-chat goal decomposition.
///
/// The card the operator just edited is the consent surface, so there is no
/// second approval gate — but the whole proposal is re-validated here, because
/// the rows arriving are the USER-EDITED ones. A title he rewrote into one
/// that already exists binds that goal instead of creating a twin, and a row
/// he broke refuses the whole operation with a reason the card shows.
#[tauri::command]
pub async fn companion_create_ship_goals(
    state: State<'_, Arc<AppState>>,
    milestone_id: String,
    goals: Vec<serde_json::Value>,
) -> Result<ShipGoalsCreated, AppError> {
    ipc_auth::require_auth(&state).await?;
    let plan =
        validate_ship_goals(&state.db, &milestone_id, &goals).map_err(AppError::Validation)?;
    tracing::info!(
        milestone_id = %plan.milestone_id,
        project_id = %plan.project_id,
        goals = plan.rows.len(),
        "companion: creating confirmed ship goals"
    );
    create_ship_goals_inner(&state.db, &plan)
}

// ── Scope + lifecycle: acting on a milestone that already exists ──────────
//
// `show_ship_milestone` creates a whole cut from nothing. These two are the
// other half of the toolset the operator asked for on 2026-08-20: Athena
// reads the live milestone (`describe_ship_milestone`, a read op) and can then
// MOVE things in and out of it and advance its lifecycle — the same two verbs
// the Ship tab gives a human.
//
// Both are ordinary approval actions, so under manual mode they wait on a
// click. Under autonomous mode they fire (the allowlist was retired on
// 2026-08-10 — see approval_autopilot's header), which is exactly why the SHIP
// transition below carries a real precondition check instead of leaning on a
// human being there to notice.

/// Scope edits one proposal may carry. Same reviewability ceiling as the plan
/// card and the milestone card — the operator READS these rows before they
/// apply, and this codebase already decided where that stops being true.
pub(crate) const SHIP_SCOPE_MAX_ROWS: usize = FLEET_PLAN_MAX_ROWS;

/// One validated scope edit.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct ShipScopeEdit {
    pub item_kind: String,
    pub item_id: String,
    /// `Some(bucket)` upserts the member there; `None` removes it from the
    /// milestone entirely. Spelled as an Option rather than a fourth bucket
    /// value because `dev_milestone_items.bucket` is CHECK-constrained to the
    /// three real ones and "gone" is not a bucket.
    pub bucket: Option<String>,
}

/// Validate a `set_ship_scope` proposal against the real registry.
///
/// Every id is resolved HERE, before an approval row is written, for the same
/// reason `validate_ship_milestone` does it: a proposal whose ids do not exist
/// should be refused while the model can still read the reason and re-propose,
/// not silently applied as a row pointing at nothing.
pub(crate) fn validate_ship_scope(
    pool: &crate::db::DbPool,
    milestone_id: &str,
    rows: &[serde_json::Value],
) -> Result<(String, Vec<ShipScopeEdit>), String> {
    let milestone_id = milestone_id.trim();
    if milestone_id.is_empty() {
        return Err("`milestone_id` is required".into());
    }
    if rows.is_empty() {
        return Err("`items` is empty — nothing to change".into());
    }
    if rows.len() > SHIP_SCOPE_MAX_ROWS {
        return Err(format!(
            "{} scope edits is more than the {SHIP_SCOPE_MAX_ROWS} an operator can review in one card",
            rows.len()
        ));
    }
    let conn = pool
        .get()
        .map_err(|e| format!("the project database is not reachable: {e}"))?;

    let project_id: String = conn
        .query_row(
            "SELECT project_id FROM dev_milestones WHERE id = ?1",
            params![milestone_id],
            |r| r.get(0),
        )
        .map_err(|_| {
            format!(
                "no milestone `{milestone_id}` — resolve it with `describe_ship_milestone` first"
            )
        })?;

    let mut edits = Vec::with_capacity(rows.len());
    let mut seen: Vec<(String, String)> = Vec::new();
    for (i, row) in rows.iter().enumerate() {
        let n = i + 1;
        let item_kind = row
            .get("item_kind")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .unwrap_or("");
        if !SHIP_MILESTONE_ITEM_KINDS.contains(&item_kind) {
            return Err(format!(
                "item {n}: `item_kind` must be one of {SHIP_MILESTONE_ITEM_KINDS:?} — a milestone's \
                 members are use cases and goals only. A KPI is the outcome layer ABOVE a \
                 milestone; use `calibrate_kpi` / `propose_kpi` for those."
            ));
        }
        let item_id = row
            .get("item_id")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .unwrap_or("");
        if item_id.is_empty() {
            return Err(format!("item {n}: `item_id` is required"));
        }
        // `bucket` absent OR the literal "remove" means drop the membership.
        let raw_bucket = row
            .get("bucket")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .unwrap_or("remove");
        let bucket = match raw_bucket {
            "remove" => None,
            b if ["core", "later", "never"].contains(&b) => Some(b.to_string()),
            other => {
                return Err(format!(
                    "item {n}: `bucket` was `{other}` — use core, later, never, or remove"
                ))
            }
        };

        // The same id twice in one card is a proposal that contradicts itself;
        // whichever row won would be an accident of ordering.
        let key = (item_kind.to_string(), item_id.to_string());
        if seen.contains(&key) {
            return Err(format!(
                "item {n}: `{item_id}` appears twice in this proposal — one row per member"
            ));
        }
        seen.push(key);

        // A REMOVAL only has to name a member that is actually in the
        // milestone; it may legitimately point at a use case that no longer
        // exists (that is exactly the orphan the read op reports, and this is
        // how it gets cleaned up). An ADD has to name a live row.
        if bucket.is_none() {
            let present: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM dev_milestone_items
                      WHERE milestone_id = ?1 AND item_kind = ?2 AND item_id = ?3",
                    params![milestone_id, item_kind, item_id],
                    |r| r.get(0),
                )
                .unwrap_or(0);
            if present == 0 {
                return Err(format!(
                    "item {n}: `{item_id}` is not in this milestone, so there is nothing to remove"
                ));
            }
        } else {
            let table = if item_kind == "goal" {
                "dev_goals"
            } else {
                "dev_use_cases"
            };
            let exists: i64 = conn
                .query_row(
                    &format!("SELECT COUNT(*) FROM {table} WHERE id = ?1 AND project_id = ?2"),
                    params![item_id, project_id],
                    |r| r.get(0),
                )
                .unwrap_or(0);
            if exists == 0 {
                return Err(format!(
                    "item {n}: no {item_kind} `{item_id}` in this milestone's project. Read the \
                     real ids with `describe_ship_milestone` or `describe_context` — never invent one."
                ));
            }
        }

        edits.push(ShipScopeEdit {
            item_kind: item_kind.to_string(),
            item_id: item_id.to_string(),
            bucket,
        });
    }
    Ok((milestone_id.to_string(), edits))
}

/// Apply validated scope edits. Re-validates rather than trusting the stored
/// params: an approval can sit for a long time, and the rows it names can be
/// deleted while it waits.
pub(crate) fn execute_set_ship_scope(
    state: &State<'_, Arc<AppState>>,
    params_json: &serde_json::Value,
) -> Result<ExecuteResult, AppError> {
    let milestone_id = params_json
        .get("milestone_id")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let rows: Vec<serde_json::Value> = params_json
        .get("items")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let (milestone_id, edits) = validate_ship_scope(&state.db, milestone_id, &rows)
        .map_err(|reason| AppError::Validation(format!("set_ship_scope: {reason}")))?;

    let mut moved = 0usize;
    let mut removed = 0usize;
    for e in &edits {
        match &e.bucket {
            Some(bucket) => {
                // `description`/`rating` are the OPERATOR's columns. Passing
                // None for both is deliberate: the repo's nullable-patch
                // convention leaves an omitted field untouched, so re-bucketing
                // a member Athena did not author never erases his note or his
                // rating — see `set_milestone_item`'s own header.
                repo::set_milestone_item(
                    &state.db,
                    &milestone_id,
                    &e.item_kind,
                    &e.item_id,
                    bucket,
                    None,
                    None,
                )?;
                moved += 1;
            }
            None => {
                repo::remove_milestone_item(&state.db, &milestone_id, &e.item_kind, &e.item_id)?;
                removed += 1;
            }
        }
    }
    tracing::info!(
        milestone_id = %milestone_id,
        moved,
        removed,
        "companion: applied ship scope edits"
    );
    Ok(ExecuteResult::message(format!(
        "Scope updated on milestone `{milestone_id}` — {moved} member(s) placed, {removed} removed."
    )))
}

/// Resolve a lifecycle transition to its target status, enforcing every
/// precondition this side of the app can actually check.
///
/// Split out of the executor so the guards are testable against a plain pool:
/// the executor needs a Tauri `State<AppState>`, which no unit test can build,
/// and these preconditions are the whole safety story of the op.
///
/// Returns `(target_status, milestone_name)` or a reason the operator can read.
pub(crate) fn ship_lifecycle_target(
    pool: &crate::db::DbPool,
    milestone_id: &str,
    transition: &str,
) -> Result<(&'static str, String), String> {
    let conn = pool
        .get()
        .map_err(|e| format!("the project database is not reachable: {e}"))?;
    let (name, status): (String, String) = conn
        .query_row(
            "SELECT name, status FROM dev_milestones WHERE id = ?1",
            params![milestone_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|_| {
            format!(
                "no milestone `{milestone_id}` — resolve it with `describe_ship_milestone` first"
            )
        })?;

    let target = match transition {
        "cut" => {
            if status != "planned" {
                return Err(format!(
                    "`{name}` is already {status} — only a planned milestone can be cut"
                ));
            }
            "active"
        }
        "ship" => {
            if status != "active" {
                return Err(format!(
                    "`{name}` is {status} — a milestone must be cut before it can ship"
                ));
            }
            // THE PRECONDITION THIS PATH CANNOT SKIP.
            //
            // In the Ship tab the ship button is gated by `shipVerdict` over the
            // exit-criteria registry, which is derived CLIENT-SIDE from live
            // runtime signals (this week's error counts, which connector
            // credentials are bound). None of that is reachable here, and
            // reimplementing it would give the app two derivations that drift.
            //
            // So this path enforces the subset the database can answer with
            // certainty, and refuses on it. `objective` is the one that matters
            // most: a milestone with no goal bound to it had nothing to be for,
            // and under autonomous mode there is no human in the loop to notice.
            let bound_goals: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM dev_milestone_items
                      WHERE milestone_id = ?1 AND item_kind = 'goal'",
                    params![milestone_id],
                    |r| r.get(0),
                )
                .unwrap_or(0);
            if bound_goals == 0 {
                return Err(format!(
                    "`{name}` has no goal bound to it, so its `objective` exit criterion is \
                     unmet. Bind one with `set_ship_scope` (item_kind: goal) before shipping."
                ));
            }
            "shipped"
        }
        other => return Err(format!("`transition` was `{other}` — use `cut` or `ship`")),
    };
    Ok((target, name))
}

/// Advance a milestone's lifecycle. Two transitions, named by intent rather
/// than by target status, because "cut" and "ship" are what they mean to the
/// operator and `active` is not a word anyone says out loud.
pub(crate) fn execute_ship_milestone_lifecycle(
    state: &State<'_, Arc<AppState>>,
    params_json: &serde_json::Value,
) -> Result<ExecuteResult, AppError> {
    // Through the shared vocabulary rather than an open-coded emptiness test
    // with its own English sentence: `require_non_empty` returns the identical
    // `AppError::Validation` and keeps the FIELD identity, which is what a
    // hand-written message destroys (see command-input-validation.md).
    let milestone_id = params_json
        .get("milestone_id")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    personas_core::validation::require_non_empty("milestone_id", milestone_id)?;
    let milestone_id = milestone_id.trim();
    let transition = params_json
        .get("transition")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .unwrap_or("");

    let (target, name) = ship_lifecycle_target(&state.db, milestone_id, transition)
        .map_err(|reason| AppError::Validation(format!("ship_milestone_lifecycle: {reason}")))?;

    repo::update_milestone(
        &state.db,
        milestone_id,
        None,
        None,
        None,
        Some(target),
        None,
        None,
    )?;
    tracing::info!(milestone_id = %milestone_id, transition, "companion: ship milestone lifecycle");

    Ok(ExecuteResult::message(if target == "active" {
        format!(
            "Cut `{name}` — its scope is frozen now, and anything that joins from here is \
             recorded as scope creep."
        )
    } else {
        format!(
            "Shipped `{name}`. Its `objective` criterion was verified here; the context-health \
             and sensor criteria are live readings this path cannot see, so they were NOT \
             machine-checked."
        )
    }))
}

#[cfg(test)]
mod ship_milestone_tests {
    use super::*;
    use r2d2::Pool;
    use r2d2_sqlite::SqliteConnectionManager;

    /// A system DB carrying just the four tables this path reads and writes.
    ///
    /// `pub(super)` so `ship_scope_tests` can build on it instead of writing a
    /// second copy of the same DDL. Two hand-rolled schemas for one production
    /// structure is the defect `hand-rolled-fixture-ddl` names, and the second
    /// copy is the one that silently drifts.
    pub(super) fn pool_with_fixture() -> crate::db::DbPool {
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
                name TEXT NOT NULL, goal TEXT, description TEXT,
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
            "  what shipping it means  ",
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
        assert_eq!(plan.description.as_deref(), Some("what shipping it means"));
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
        let err =
            validate_ship_milestone(&pool, "proj_1", "M1", "", "", &[row("goal", "uc_1", None)])
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
        let err = validate_ship_milestone(
            &pool,
            "proj_1",
            "M1",
            "",
            "",
            &[row("use_case", "uc_9", None)],
        )
        .expect_err("cross-project membership must be refused");
        assert!(err.contains("uc_9"), "{err}");
    }

    #[test]
    fn rejects_a_kind_that_is_not_a_milestone_member() {
        let pool = pool_with_fixture();
        for kind in ["kpi", "context", ""] {
            let err =
                validate_ship_milestone(&pool, "proj_1", "M1", "", "", &[row(kind, "x", None)])
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
        assert!(validate_ship_milestone(&pool, "proj_1", "M1", "", "", &[]).is_err());
        let many: Vec<serde_json::Value> = (0..SHIP_MILESTONE_MAX_ROWS + 1)
            .map(|_| row("use_case", "uc_1", None))
            .collect();
        let err = validate_ship_milestone(&pool, "proj_1", "M1", "", "", &many)
            .expect_err("the cap must hold");
        assert!(err.contains(&SHIP_MILESTONE_MAX_ROWS.to_string()), "{err}");

        let dup = vec![
            row("use_case", "uc_1", None),
            row("use_case", "Ship tab", None),
        ];
        let err = validate_ship_milestone(&pool, "proj_1", "M1", "", "", &dup)
            .expect_err("the same member twice must be refused");
        assert!(err.contains("already in this milestone"), "{err}");

        let long = "x".repeat(SHIP_MILESTONE_NAME_MAX + 1);
        assert!(validate_ship_milestone(&pool, "proj_1", &long, "", "", &dup[..1]).is_err());
        assert!(validate_ship_milestone(&pool, "proj_1", "  ", "", "", &dup[..1]).is_err());
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
            "first cut",
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
            Some("first cut"),
            "the objective stays a TITLE"
        );
        let description: Option<String> = conn
            .query_row(
                "SELECT description FROM dev_milestones WHERE id = ?1",
                params![created.milestone_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            description.as_deref(),
            Some("everything the Ship tab needs to be believable"),
            "the prose lands in `description`, not in the heading",
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

    /// The caps that are BORROWED are borrowed on purpose, not copied: if the
    /// fleet plan's reviewability ceiling moves, this milestone's moves with it.
    ///
    /// `SHIP_MILESTONE_GOAL_MAX` deliberately does NOT borrow, and this test is
    /// where that decision is pinned. It used to equal the plan's objective
    /// bound, which is a bound on a BRIEF; the objective renders as the Ship
    /// tab's heading and needs a bound on a TITLE. The prose bound moved to
    /// `SHIP_MILESTONE_DESC_MAX`, which still borrows.
    #[test]
    fn caps_mirror_the_plan_card_rather_than_inventing_numbers() {
        assert_eq!(SHIP_MILESTONE_MAX_ROWS, FLEET_PLAN_MAX_ROWS);
        assert_eq!(SHIP_MILESTONE_NAME_MAX, FLEET_PLAN_INTENT_MAX);
        assert_eq!(SHIP_MILESTONE_DESC_MAX, FLEET_PLAN_OBJECTIVE_MAX);
        assert!(
            SHIP_MILESTONE_GOAL_MAX < FLEET_PLAN_OBJECTIVE_MAX,
            "the objective is a title; a brief-sized bound is what let a paragraph become the heading",
        );
    }

    /// The rule the operator actually asked for, as a test rather than a
    /// comment: no automation may put descriptive text in the objective.
    #[test]
    fn a_paragraph_in_the_objective_is_refused_and_told_where_to_put_it() {
        let pool = pool_with_fixture();
        let prose = "Shipping this milestone means the Ship tab is believable end to end:                      the cut is real, the criteria derive from live signals, and the                      operator can certify without reading the code.";
        assert!(prose.chars().count() > SHIP_MILESTONE_GOAL_MAX);
        let err = validate_ship_milestone(
            &pool,
            "proj_1",
            "M1",
            prose,
            "",
            &[row("use_case", "uc_1", None)],
        )
        .expect_err("a paragraph is not a title");
        assert!(err.contains("TITLE"), "{err}");
        assert!(
            err.contains("description"),
            "the refusal names the fix: {err}"
        );

        // The same prose in `description` is fine — it was never the content
        // that was wrong, only the field.
        validate_ship_milestone(
            &pool,
            "proj_1",
            "M1",
            "first cut",
            prose,
            &[row("use_case", "uc_1", None)],
        )
        .expect("prose belongs in description");
    }
}

// ── set_ship_scope / ship_milestone_lifecycle ─────────────────────────────
//
// These cover the two guards that actually protect something: an id Athena
// invented never reaches the database, and a milestone with nothing to have
// been for never reaches `shipped` on the autonomous path.

#[cfg(test)]
mod ship_scope_tests {
    use super::*;
    use r2d2::Pool;
    use r2d2_sqlite::SqliteConnectionManager;

    /// The shared fixture plus the rows this path needs: a SECOND project (so
    /// the cross-project guard is tested against something real rather than
    /// against absence) and three milestones covering each lifecycle state.
    ///
    /// Extends `ship_milestone_tests::pool_with_fixture` rather than restating
    /// its schema. When that fixture gains a column, this one gets it too —
    /// which is the whole reason not to hand-roll a second copy.
    fn pool_with_milestone() -> crate::db::DbPool {
        let pool = super::ship_milestone_tests::pool_with_fixture();
        {
            let conn = pool.get().expect("fixture pool");
            conn.execute_batch(
                "INSERT INTO dev_projects VALUES
                   ('proj_2','Other','C:/other','','active','','2026-08-20','2026-08-20');
                 INSERT INTO dev_use_cases VALUES
                   ('uc_foreign','proj_2','Someone else''s feature','foreign','',0,'2026-08-20');
                 INSERT INTO dev_milestones (id, project_id, name, status, created_at, updated_at)
                   VALUES ('ms_1','proj_1','M1','planned','2026-08-20','2026-08-20'),
                          ('ms_cut','proj_1','M2','active','2026-08-20','2026-08-20'),
                          ('ms_done','proj_1','M0','shipped','2026-08-20','2026-08-20');
                 INSERT INTO dev_milestone_items
                   (milestone_id, item_kind, item_id, bucket, created_at)
                   VALUES ('ms_1','use_case','uc_1','core','2026-08-20'),
                          ('ms_1','use_case','uc_ghost','core','2026-08-20');",
            )
            .expect("scope fixture rows");
        }
        pool
    }

    fn edit(kind: &str, id: &str, bucket: Option<&str>) -> serde_json::Value {
        match bucket {
            Some(b) => serde_json::json!({"item_kind": kind, "item_id": id, "bucket": b}),
            None => serde_json::json!({"item_kind": kind, "item_id": id}),
        }
    }

    #[test]
    fn places_and_removes_in_one_validated_batch() {
        let pool = pool_with_milestone();
        let (ms, edits) = validate_ship_scope(
            &pool,
            "ms_1",
            &[
                edit("use_case", "uc_2", Some("core")),
                edit("goal", "goal_1", Some("core")),
                edit("use_case", "uc_1", Some("later")),
                // An omitted bucket means "drop it" — the ghost row the read op
                // reports as a deleted use case is cleaned up this way.
                edit("use_case", "uc_ghost", None),
            ],
        )
        .expect("validates");
        assert_eq!(ms, "ms_1");
        assert_eq!(edits.len(), 4);
        assert_eq!(edits[2].bucket.as_deref(), Some("later"));
        assert_eq!(edits[3].bucket, None, "no bucket = removal");
    }

    #[test]
    fn refuses_an_id_that_belongs_to_another_project() {
        let pool = pool_with_milestone();
        let err = validate_ship_scope(
            &pool,
            "ms_1",
            &[edit("use_case", "uc_foreign", Some("core"))],
        )
        .expect_err("cross-project add must be refused");
        assert!(err.contains("uc_foreign"), "the reason names the id: {err}");
    }

    #[test]
    fn refuses_an_invented_id_rather_than_writing_a_dangling_row() {
        let pool = pool_with_milestone();
        let err = validate_ship_scope(
            &pool,
            "ms_1",
            &[edit("goal", "goal_that_never_was", Some("core"))],
        )
        .expect_err("invented id must be refused");
        assert!(err.contains("never invent one"), "{err}");
    }

    #[test]
    fn refuses_removing_something_that_is_not_in_the_milestone() {
        let pool = pool_with_milestone();
        let err = validate_ship_scope(&pool, "ms_1", &[edit("use_case", "uc_2", None)])
            .expect_err("removing a non-member must be refused");
        assert!(err.contains("nothing to remove"), "{err}");
    }

    #[test]
    fn refuses_the_same_member_twice_in_one_card() {
        let pool = pool_with_milestone();
        let err = validate_ship_scope(
            &pool,
            "ms_1",
            &[
                edit("use_case", "uc_1", Some("core")),
                edit("use_case", "uc_1", Some("never")),
            ],
        )
        .expect_err("a self-contradicting card must be refused");
        assert!(err.contains("twice"), "{err}");
    }

    #[test]
    fn refuses_a_kpi_as_a_scope_member() {
        let pool = pool_with_milestone();
        let err = validate_ship_scope(&pool, "ms_1", &[edit("kpi", "k_1", Some("core"))])
            .expect_err("a KPI is the layer ABOVE a milestone, never a member");
        assert!(err.contains("use cases and goals only"), "{err}");
    }

    #[test]
    fn refuses_an_unknown_milestone_and_an_empty_batch() {
        let pool = pool_with_milestone();
        assert!(
            validate_ship_scope(&pool, "ms_nope", &[edit("use_case", "uc_1", Some("core"))])
                .expect_err("unknown milestone")
                .contains("describe_ship_milestone")
        );
        assert!(
            validate_ship_scope(&pool, "ms_1", &[]).is_err(),
            "empty batch"
        );
    }

    #[test]
    fn caps_the_batch_at_the_shared_reviewability_ceiling() {
        let pool = pool_with_milestone();
        let many: Vec<_> = (0..SHIP_SCOPE_MAX_ROWS + 1)
            .map(|i| edit("use_case", &format!("uc_{i}"), Some("core")))
            .collect();
        assert!(validate_ship_scope(&pool, "ms_1", &many).is_err());
        assert_eq!(
            SHIP_SCOPE_MAX_ROWS, FLEET_PLAN_MAX_ROWS,
            "borrowed, not copied"
        );
    }

    // ── lifecycle preconditions ───────────────────────────────────────────

    #[test]
    fn a_planned_milestone_cuts_and_an_already_cut_one_refuses() {
        let pool = pool_with_milestone();
        assert_eq!(
            ship_lifecycle_target(&pool, "ms_1", "cut").unwrap().0,
            "active"
        );
        assert!(ship_lifecycle_target(&pool, "ms_cut", "cut")
            .expect_err("already cut")
            .contains("already active"));
    }

    #[test]
    fn shipping_refuses_a_milestone_that_was_never_cut() {
        let pool = pool_with_milestone();
        assert!(ship_lifecycle_target(&pool, "ms_1", "ship")
            .expect_err("never cut")
            .contains("must be cut"));
    }

    /// The guard that earns its keep: under autonomous mode nothing waits on a
    /// click, so a cut with no objective bound to it must be refused HERE.
    #[test]
    fn shipping_refuses_a_cut_with_no_goal_bound_to_it() {
        let pool = pool_with_milestone();
        let err = ship_lifecycle_target(&pool, "ms_cut", "ship").expect_err("no objective bound");
        assert!(err.contains("objective"), "{err}");
        assert!(err.contains("set_ship_scope"), "names the fix: {err}");

        // Bind one, and the same call now passes.
        pool.get()
            .expect("fixture pool")
            .execute(
                // `created_at` is spelled out: the shared fixture mirrors the
                // production table, where it is NOT NULL with no default. The
                // hand-rolled copy this replaced carried a DEFAULT the real
                // table does not have — an INSERT that passed the test and
                // would have failed in production. Reusing the fixture is what
                // surfaced it.
                "INSERT INTO dev_milestone_items
                   (milestone_id, item_kind, item_id, bucket, created_at)
                 VALUES ('ms_cut','goal','goal_1','core','2026-08-20')",
                [],
            )
            .expect("bind a goal");
        assert_eq!(
            ship_lifecycle_target(&pool, "ms_cut", "ship").unwrap().0,
            "shipped"
        );
    }

    #[test]
    fn refuses_a_transition_it_does_not_have_a_verb_for() {
        let pool = pool_with_milestone();
        assert!(ship_lifecycle_target(&pool, "ms_1", "unship")
            .expect_err("unknown transition")
            .contains("use `cut` or `ship`"));
    }
}

// ── show_ship_goals ───────────────────────────────────────────────────────
//
// These run against `init_test_db()` — the REAL migrated schema — rather than
// against the hand-rolled fixture the two modules above share. That is not a
// stylistic preference: this path calls `repo::create_goal`, which writes ten
// columns (`parent_goal_id`, `order_index`, `progress`, …) the hand-rolled
// `dev_goals` does not have, and it must land inside the CHECK constraint the
// migration chain puts on `dev_goals.status`. A fixture that cannot express
// the constraint cannot prove the write satisfies it.

#[cfg(test)]
mod ship_goals_tests {
    use super::*;
    use crate::db::{init_test_db, PoolExt};

    /// Check a connection out through the shared `PoolExt::conn` rather than
    /// `pool.get().unwrap()`. `pool-get-unwrapped` counts test files too, on
    /// the stated grounds that a fixture which panics on acquire hides the
    /// same saturation the product would — and this is the destination that
    /// rule routes callers to.
    fn conn(pool: &crate::db::DbPool) -> impl std::ops::Deref<Target = rusqlite::Connection> {
        pool.conn("ship goals test").expect("pooled connection")
    }

    /// One project, one context, one milestone, one goal that already exists.
    ///
    /// `p_other` and `ctx_other` are a SECOND project, so the cross-project
    /// guards are tested against something real rather than against absence.
    fn pool_with_milestone() -> crate::db::DbPool {
        let pool = init_test_db().expect("test db");
        let conn = conn(&pool);
        conn.execute_batch(
            "INSERT INTO dev_projects (id, name, root_path, status)
               VALUES ('p_1','Personas','C:/repo','active'),
                      ('p_other','Other','C:/other','active');
             INSERT INTO dev_contexts (id, project_id, name)
               VALUES ('ctx_ship','p_1','teams/factory/ship'),
                      ('ctx_other','p_other','somewhere else');
             INSERT INTO dev_milestones (id, project_id, name, status)
               VALUES ('ms_1','p_1','M1','planned');
             INSERT INTO dev_goals (id, project_id, title, status)
               VALUES ('g_existing','p_1','Compose the story','open');",
        )
        .expect("seed");
        drop(conn);
        pool
    }

    fn goal(title: &str) -> serde_json::Value {
        serde_json::json!({ "title": title })
    }

    fn goal_count(pool: &crate::db::DbPool, project_id: &str) -> i64 {
        conn(pool)
            .query_row(
                "SELECT COUNT(*) FROM dev_goals WHERE project_id = ?1",
                params![project_id],
                |r| r.get(0),
            )
            .unwrap()
    }

    /// The happy path, end to end: three proposed goals become three rows in
    /// the milestone's project, each bound `core`, each carrying what the card
    /// said it would.
    #[test]
    fn creates_the_proposed_goals_and_binds_them_to_the_milestone() {
        let pool = pool_with_milestone();
        let plan = validate_ship_goals(
            &pool,
            "  ms_1  ",
            &[
                serde_json::json!({
                    "title": "  Project type: Trailer  ",
                    "description": "  a new project type in the factory  ",
                    "context_hint": "ship",
                }),
                goal("Decompose into scene stories"),
            ],
        )
        .expect("plan validates");
        assert_eq!(plan.project_id, "p_1");
        assert_eq!(plan.milestone_name, "M1");
        assert_eq!(plan.rows[0].title, "Project type: Trailer");
        assert_eq!(
            plan.rows[0].description.as_deref(),
            Some("a new project type in the factory")
        );
        assert_eq!(
            plan.rows[0].context_id.as_deref(),
            Some("ctx_ship"),
            "a substring hint resolves to the real context id"
        );
        assert_eq!(plan.rows[1].context_id, None, "an unfiled goal is fine");

        let created = create_ship_goals_inner(&pool, &plan).expect("create");
        assert_eq!((created.created, created.bound), (2, 0));

        let db = conn(&pool);
        let (kind, bucket): (String, String) = db
            .query_row(
                "SELECT i.item_kind, i.bucket FROM dev_milestone_items i
                 JOIN dev_goals g ON g.id = i.item_id
                 WHERE i.milestone_id = 'ms_1' AND g.title = 'Project type: Trailer'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .expect("the goal is bound to the milestone");
        assert_eq!(kind, SHIP_GOAL_ITEM_KIND);
        assert_eq!(bucket, SHIP_MILESTONE_BUCKET);

        let status: String = db
            .query_row(
                "SELECT status FROM dev_goals WHERE title = 'Decompose into scene stories'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            status, "open",
            "a goal is born open — this path never claims work is under way"
        );
    }

    /// The idempotence rule, which is the whole reason the validator resolves
    /// titles instead of trusting them: proposing a goal that is already there
    /// BINDS it. A second `Compose the story` would make the Goals hub show
    /// the same objective twice with different ids.
    #[test]
    fn an_existing_title_binds_rather_than_creating_a_duplicate() {
        let pool = pool_with_milestone();
        let before = goal_count(&pool, "p_1");
        let plan = validate_ship_goals(
            &pool,
            "ms_1",
            // Different case on purpose: the lookup is `COLLATE NOCASE`, so
            // "compose the story" is the SAME goal.
            &[goal("compose the story"), goal("A genuinely new one")],
        )
        .expect("plan validates");
        assert_eq!(plan.rows[0].existing_id.as_deref(), Some("g_existing"));
        assert_eq!(plan.rows[1].existing_id, None);

        let created = create_ship_goals_inner(&pool, &plan).expect("create");
        assert_eq!((created.created, created.bound), (1, 1));
        assert_eq!(
            goal_count(&pool, "p_1"),
            before + 1,
            "exactly one row appeared, not two"
        );

        let bound: i64 = conn(&pool)
            .query_row(
                "SELECT COUNT(*) FROM dev_milestone_items
                  WHERE milestone_id = 'ms_1' AND item_id = 'g_existing'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(bound, 1, "the EXISTING goal is what got bound");
    }

    /// Re-binding never erases the operator's own note on the membership. The
    /// nullable-patch convention is what makes that true, and this is where it
    /// is pinned — passing the goal's description through as the member note
    /// would silently overwrite his.
    #[test]
    fn re_binding_leaves_the_operators_note_on_the_membership_alone() {
        let pool = pool_with_milestone();
        conn(&pool)
            .execute(
                "INSERT INTO dev_milestone_items
                   (milestone_id, item_kind, item_id, bucket, description)
                 VALUES ('ms_1','goal','g_existing','core','his own reason')",
                [],
            )
            .expect("pre-existing membership");

        let plan = validate_ship_goals(
            &pool,
            "ms_1",
            &[serde_json::json!({
                "title": "Compose the story",
                "description": "Athena's summary, which is NOT his note",
            })],
        )
        .expect("plan validates");
        create_ship_goals_inner(&pool, &plan).expect("create");

        let note: Option<String> = conn(&pool)
            .query_row(
                "SELECT description FROM dev_milestone_items
                  WHERE milestone_id = 'ms_1' AND item_id = 'g_existing'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(note.as_deref(), Some("his own reason"));
    }

    /// One bad row refuses the WHOLE batch, and nothing lands. The row that
    /// fails is deliberately the LAST one, so a validator that wrote as it
    /// went would already have created the first two by the time it noticed.
    #[test]
    fn one_bad_row_refuses_the_whole_batch_and_nothing_is_written() {
        let pool = pool_with_milestone();
        let before = goal_count(&pool, "p_1");
        let err = validate_ship_goals(
            &pool,
            "ms_1",
            &[
                goal("First deliverable"),
                goal("Second deliverable"),
                serde_json::json!({ "title": "   " }),
            ],
        )
        .expect_err("an empty title must refuse the batch");
        assert!(err.contains("goal 3"), "the reason names the row: {err}");
        assert_eq!(
            goal_count(&pool, "p_1"),
            before,
            "validation is separate from writing, so nothing landed"
        );
    }

    /// A context that belongs to ANOTHER project is refused, and the refusal
    /// names the real ones. The payload cannot name a project, so this is the
    /// only door through which a foreign id could have reached the write.
    #[test]
    fn refuses_a_context_from_another_project_and_names_the_real_ones() {
        let pool = pool_with_milestone();
        let err = validate_ship_goals(
            &pool,
            "ms_1",
            &[serde_json::json!({ "title": "Cross-project", "context_hint": "ctx_other" })],
        )
        .expect_err("a foreign context must be refused");
        assert!(err.contains("ctx_other"), "{err}");
        assert!(
            err.contains("teams/factory/ship"),
            "real candidates are named: {err}"
        );
        assert!(
            err.contains("omit `context_hint`"),
            "the refusal names the escape: {err}"
        );
    }

    #[test]
    fn refuses_an_unknown_milestone_and_points_at_the_read_op() {
        let pool = pool_with_milestone();
        let err = validate_ship_goals(&pool, "ms_nope", &[goal("Anything")])
            .expect_err("an unknown milestone must be refused");
        assert!(err.contains("describe_ship_milestone"), "{err}");
        assert!(validate_ship_goals(&pool, "   ", &[goal("Anything")]).is_err());
    }

    #[test]
    fn enforces_the_row_bounds_and_refuses_a_duplicate_title_in_one_card() {
        let pool = pool_with_milestone();
        assert!(validate_ship_goals(&pool, "ms_1", &[]).is_err(), "empty");

        let many: Vec<serde_json::Value> = (0..SHIP_MILESTONE_MAX_ROWS + 1)
            .map(|i| goal(&format!("Deliverable {i}")))
            .collect();
        let err = validate_ship_goals(&pool, "ms_1", &many).expect_err("the cap must hold");
        assert!(err.contains(&SHIP_MILESTONE_MAX_ROWS.to_string()), "{err}");

        let err = validate_ship_goals(&pool, "ms_1", &[goal("Same thing"), goal("SAME THING")])
            .expect_err("a self-contradicting card must be refused");
        assert!(err.contains("twice"), "{err}");

        let long = "x".repeat(SHIP_GOAL_TITLE_MAX + 1);
        let err = validate_ship_goals(&pool, "ms_1", &[goal(&long)]).expect_err("title bound");
        assert!(err.contains("description"), "names the fix: {err}");

        let prose = "x".repeat(SHIP_GOAL_DESC_MAX + 1);
        assert!(validate_ship_goals(
            &pool,
            "ms_1",
            &[serde_json::json!({ "title": "Fine", "description": prose })],
        )
        .is_err());
    }

    /// The caps are BORROWED, not copied, and the one kind this op writes is
    /// one the CHECK constraint admits. Both are one-line assertions that stop
    /// a second vocabulary growing beside the first.
    #[test]
    fn the_goal_kind_is_a_real_member_kind_and_the_caps_are_borrowed() {
        assert!(SHIP_MILESTONE_ITEM_KINDS.contains(&SHIP_GOAL_ITEM_KIND));
        assert_eq!(SHIP_GOAL_TITLE_MAX, SHIP_MILESTONE_NAME_MAX);
        assert_eq!(SHIP_GOAL_DESC_MAX, SHIP_MILESTONE_DESC_MAX);
    }
}
