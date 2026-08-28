//! Ship routes on the management API — the CLI's door into the Ship layer.
//!
//! Two documented paths already ASSUMED these routes existed and neither could
//! ever have worked: `/ship-milestone`'s Phase 1 ("Management HTTP API, if
//! `127.0.0.1:9420` answers. Read the milestone, its items, and the project")
//! and `buildGoalAssistPrompt`'s closing line ("If the Personas management API
//! is reachable, use it to persist the goal updates"). Until 2026-08-28 the
//! router carried no `dev_*` route at all, so a CLI session that followed
//! either instruction fell through to the file fallback or wrote
//! `SHIP_GOAL_REPORT.md` for nobody to ingest. This module is those routes.
//!
//! The write side is deliberately NOT a second implementation of Ship's
//! rules. Every mutation goes through the same validators the companion's
//! chat cards use (`validate_ship_milestone`, `validate_ship_goals`,
//! `validate_ship_scope` in `approval_exec_ship`) and then the ordinary repo
//! functions — so a milestone created from a terminal is refused, bounded and
//! idempotent exactly as one created from Athena's card. What this door adds
//! over the cards is only what a card cannot express: a milestone born with
//! NO members yet (a brief first, the cut later) and a brief-plus-goals
//! creation in one round trip.
//!
//! What it does NOT do, by design:
//! - **No lifecycle.** `status` is not patchable here. Cutting stamps the
//!   scope-creep baseline and shipping certifies against exit criteria this
//!   process cannot see (`ship.md` §5); both stay the operator's, in the Ship
//!   tab or through Athena's approval-gated `ship_milestone_lifecycle`.
//! - **No deletion.** A milestone is an operator decision on the record.
//! - **No KPI members.** The validators refuse `item_kind: "kpi"`; KPIs are the
//!   outcome layer above a milestone (`ship.md` §1).
//!
//! Auth: reads need any valid key; writes need `personas:build` — the same
//! trust tier as `/api/build` and `/api/kp/persona-requests`, because a
//! milestone is work the app will dispatch agents at (see `authorize`).

use std::sync::Arc;

use axum::{
    extract::{Path, State as AxumState},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};

use super::{err_json, ok_json, ManagementState};
use crate::commands::companion::approvals::{
    create_ship_goals_inner, create_ship_milestone_inner, resolve_context, validate_ship_goals,
    validate_ship_milestone, validate_ship_scope, SHIP_MILESTONE_DESCRIPTION_MAX,
    SHIP_MILESTONE_DESC_MAX, SHIP_MILESTONE_GOAL_MAX, SHIP_MILESTONE_NAME_MAX,
};
use crate::db::models::{DevGoal, DevMilestone, DevMilestoneItem, DevProject, DevUseCase};
use crate::db::repos::dev_tools as repo;
use crate::db::DbPool;
use crate::error::AppError;

// ── wire shapes ─────────────────────────────────────────────────────────────

/// `POST /api/dev/projects/{project_id}/milestones`.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct CreateMilestoneBody {
    pub name: String,
    /// The objective as a SHORT TITLE (≤ `SHIP_MILESTONE_GOAL_MAX`).
    #[serde(default)]
    pub goal: Option<String>,
    /// The brief — what shipping this means, in prose.
    #[serde(default)]
    pub description: Option<String>,
    /// Existing use cases / goals to bind as `core`, in the card's row shape
    /// (`{ item_kind, item_id, description? }`). May be empty: a milestone can
    /// be born as a brief and cut later.
    #[serde(default)]
    pub rows: Vec<Value>,
    /// NEW goals to create and bind as `core`, in the `show_ship_goals` row
    /// shape (`{ title, description?, context_hint? }`). Idempotent by title.
    #[serde(default)]
    pub goals: Vec<Value>,
    /// Optional `yyyy-mm-dd`.
    #[serde(default)]
    pub target_date: Option<String>,
}

/// `POST /api/dev/projects/{project_id}/use-cases`.
///
/// The one registry write this door adds beyond the cards. A brief's core
/// path is sometimes a use case the scan never proposed (Adamant's free-channel
/// discovery, 2026-08-28: real module, real LLM call, absent from the
/// inventory) — and a cut cannot bind what the registry does not hold.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct CreateUseCaseBody {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    /// `user_flow` | `capability` | `integration` | `ops`; anything else
    /// folds to `capability` (the repo's own rule).
    #[serde(default)]
    pub kind: Option<String>,
    /// Context ids / names / substrings, resolved against the project.
    #[serde(default)]
    pub context_hints: Vec<String>,
    /// Which sliced context most owns it; must also be in `context_hints`
    /// (or is added to them).
    #[serde(default)]
    pub primary_context_hint: Option<String>,
    #[serde(default)]
    pub rationale: Option<String>,
}

/// `POST /api/dev/milestones/{id}/goals`.
#[derive(Debug, Deserialize)]
pub(super) struct AddGoalsBody {
    pub goals: Vec<Value>,
}

/// `POST /api/dev/milestones/{id}/scope`. Rows in `set_ship_scope`'s shape:
/// `{ item_kind, item_id, bucket: core|later|never|remove, description? }`.
#[derive(Debug, Deserialize)]
pub(super) struct ScopeBody {
    pub items: Vec<Value>,
}

/// `POST /api/dev/milestones/{id}` — the brief, never the lifecycle.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct PatchMilestoneBody {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub goal: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub target_date: Option<String>,
}

/// `POST /api/dev/goals/{id}` — what a goal-assist run persists.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct PatchGoalBody {
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    /// One of the goal statuses `accept_goal_status` knows.
    #[serde(default)]
    pub status: Option<String>,
    /// 0..=100.
    #[serde(default)]
    pub progress: Option<i32>,
}

// ── projections ─────────────────────────────────────────────────────────────

fn project_view(p: &DevProject) -> Value {
    json!({
        "id": p.id,
        "name": p.name,
        "rootPath": p.root_path,
        "status": p.status,
        "description": p.description,
    })
}

fn use_case_view(u: &DevUseCase) -> Value {
    json!({
        "id": u.id,
        "name": u.name,
        "slug": u.slug,
        "kind": u.kind,
        "status": u.status,
        "description": u.description,
        "contextIds": u.context_ids,
    })
}

fn goal_view(g: &DevGoal) -> Value {
    json!({
        "id": g.id,
        "title": g.title,
        "status": g.status,
        "progress": g.progress,
        "description": g.description,
        "contextId": g.context_id,
        "targetDate": g.target_date,
    })
}

/// A membership with its target's display name resolved, so a CLI reading a
/// cut never has to join tables itself (and never learns to).
fn item_view(it: &DevMilestoneItem, use_cases: &[DevUseCase], goals: &[DevGoal]) -> Value {
    let name = match it.item_kind.as_str() {
        "use_case" => use_cases
            .iter()
            .find(|u| u.id == it.item_id)
            .map(|u| u.name.clone()),
        "goal" => goals
            .iter()
            .find(|g| g.id == it.item_id)
            .map(|g| g.title.clone()),
        _ => None,
    };
    json!({
        "itemKind": it.item_kind,
        "itemId": it.item_id,
        "name": name,
        "bucket": it.bucket,
        "description": it.description,
        "rating": it.rating,
        "addedAfterCut": it.added_after_cut,
        "orderIndex": it.order_index,
    })
}

/// A milestone with its members, names resolved.
fn milestone_view(
    pool: &DbPool,
    m: &DevMilestone,
    use_cases: &[DevUseCase],
    goals: &[DevGoal],
) -> Result<Value, AppError> {
    let items = repo::list_milestone_items(pool, &m.id)?;
    let mut v = serde_json::to_value(m).unwrap_or_else(|_| json!({}));
    if let Value::Object(map) = &mut v {
        map.insert(
            "items".into(),
            Value::Array(
                items
                    .iter()
                    .map(|it| item_view(it, use_cases, goals))
                    .collect(),
            ),
        );
    }
    Ok(v)
}

// ── pure cores (testable against a plain pool) ──────────────────────────────

/// Everything a CLI session needs to reason about one project's Ship layer in
/// one read: the project, every milestone with its members, and the two
/// registries a cut is composed from.
pub(super) fn project_ship_snapshot(pool: &DbPool, project_id: &str) -> Result<Value, AppError> {
    let project = repo::get_project_by_id(pool, project_id)?;
    let use_cases = repo::list_use_cases(pool, project_id, None)?;
    let goals = repo::list_goals_by_project(pool, project_id, None)?;
    let milestones = repo::list_milestones_by_project(pool, project_id)?
        .iter()
        .map(|m| milestone_view(pool, m, &use_cases, &goals))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(json!({
        "project": project_view(&project),
        "milestones": milestones,
        "useCases": use_cases.iter().map(use_case_view).collect::<Vec<_>>(),
        "goals": goals.iter().map(goal_view).collect::<Vec<_>>(),
    }))
}

/// One milestone, its project, and its members with names — the exact shape
/// `/ship-milestone` Phase 1 reads.
pub(super) fn milestone_snapshot(pool: &DbPool, milestone_id: &str) -> Result<Value, AppError> {
    let m = repo::get_milestone_by_id(pool, milestone_id)?;
    let project = repo::get_project_by_id(pool, &m.project_id)?;
    let use_cases = repo::list_use_cases(pool, &m.project_id, None)?;
    let goals = repo::list_goals_by_project(pool, &m.project_id, None)?;
    Ok(json!({
        "project": project_view(&project),
        "milestone": milestone_view(pool, &m, &use_cases, &goals)?,
    }))
}

/// Bounds for a milestone born WITHOUT members. `validate_ship_milestone`
/// refuses an empty `rows` (a card with nothing in it is a card that says
/// nothing), so the header-only path re-states its three limits here — the
/// same constants, so the two paths cannot drift apart.
fn validate_header(name: &str, goal: &str, description: &str) -> Result<(), String> {
    personas_core::validation::require_non_empty("name", name).map_err(|e| e.to_string())?;
    if name.trim().chars().count() > SHIP_MILESTONE_NAME_MAX {
        return Err(format!(
            "`name` is too long (max {SHIP_MILESTONE_NAME_MAX} characters)"
        ));
    }
    if goal.trim().chars().count() > SHIP_MILESTONE_GOAL_MAX {
        return Err(format!(
            "`goal` is the milestone's TITLE and is too long at {} characters (max \
             {SHIP_MILESTONE_GOAL_MAX}); put a handful of words here and the prose in `description`",
            goal.trim().chars().count()
        ));
    }
    if description.trim().chars().count() > SHIP_MILESTONE_DESC_MAX {
        return Err(format!(
            "`description` is too long (max {SHIP_MILESTONE_DESC_MAX} characters)"
        ));
    }
    Ok(())
}

/// Create a milestone (brief + optional existing members + optional new
/// goals) through the card validators and the ordinary repo functions.
///
/// Atomic in effect: the goal rows can only be validated against a milestone
/// that exists (the validator reads the project off the milestone row), so
/// when they are refused the just-created milestone is deleted again and the
/// caller sees one 400 and no new row — the rule `ship_ingest` states for a
/// partially applied result.
pub(super) fn create_milestone_for_project(
    pool: &DbPool,
    project_id: &str,
    body: &CreateMilestoneBody,
) -> Result<Value, AppError> {
    // Resolve the project first so a bad id is a 404, not a validator string.
    let project = repo::get_project_by_id(pool, project_id)?;
    let goal = body.goal.as_deref().unwrap_or("");
    let description = body.description.as_deref().unwrap_or("");

    let milestone_id = if body.rows.is_empty() {
        validate_header(&body.name, goal, description).map_err(AppError::Validation)?;
        repo::create_milestone(
            pool,
            &project.id,
            body.name.trim(),
            (!goal.trim().is_empty()).then(|| goal.trim()),
            (!description.trim().is_empty()).then(|| description.trim()),
            None,
            body.target_date.as_deref(),
        )?
        .id
    } else {
        let plan =
            validate_ship_milestone(pool, &project.id, &body.name, goal, description, &body.rows)
                .map_err(AppError::Validation)?;
        let created = create_ship_milestone_inner(pool, &plan)?;
        if let Some(td) = body.target_date.as_deref() {
            repo::update_milestone(
                pool,
                &created.milestone_id,
                None,
                None,
                None,
                None,
                Some(td),
                None,
            )?;
        }
        created.milestone_id
    };

    let (goals_created, goals_bound) = match body.goals.as_slice() {
        [] => (0, 0),
        goals => decompose_or_roll_back(pool, &milestone_id, goals)?,
    };

    tracing::info!(
        project_id = %project.id,
        milestone_id = %milestone_id,
        rows = body.rows.len(),
        goals_created,
        goals_bound,
        "management api: created ship milestone"
    );

    let mut snapshot = milestone_snapshot(pool, &milestone_id)?;
    if let Value::Object(map) = &mut snapshot {
        map.insert(
            "goals".into(),
            json!({ "created": goals_created, "bound": goals_bound }),
        );
    }
    Ok(snapshot)
}

/// Create a use case in the project's registry so a cut can bind it. Born
/// `active` and `pinned`-equivalent in spirit (`created_by = "user"`): an
/// operator-authored core path must not be re-proposed or replaced by the
/// next use-case scan.
pub(super) fn create_use_case_for_project(
    pool: &DbPool,
    project_id: &str,
    body: &CreateUseCaseBody,
) -> Result<Value, AppError> {
    let project = repo::get_project_by_id(pool, project_id)?;
    let name = body.name.trim();
    personas_core::validation::require_non_empty("name", name)?;
    if name.chars().count() > SHIP_MILESTONE_NAME_MAX {
        return Err(AppError::Validation(format!(
            "`name` must be at most {SHIP_MILESTONE_NAME_MAX} characters"
        )));
    }
    if let Some(d) = body.description.as_deref() {
        if d.chars().count() > SHIP_MILESTONE_DESC_MAX {
            return Err(AppError::Validation(format!(
                "`description` is too long (max {SHIP_MILESTONE_DESC_MAX} characters)"
            )));
        }
    }
    let conn = pool.get()?;
    let mut context_ids: Vec<String> = Vec::with_capacity(body.context_hints.len() + 1);
    for hint in body
        .context_hints
        .iter()
        .map(|h| h.trim())
        .filter(|h| !h.is_empty())
    {
        let id = resolve_context(&conn, &project.id, hint).map_err(AppError::Validation)?;
        if !context_ids.contains(&id) {
            context_ids.push(id);
        }
    }
    let primary = match body.primary_context_hint.as_deref().map(str::trim) {
        None | Some("") => None,
        Some(hint) => {
            let id = resolve_context(&conn, &project.id, hint).map_err(AppError::Validation)?;
            if !context_ids.contains(&id) {
                context_ids.push(id.clone());
            }
            Some(id)
        }
    };
    drop(conn);
    let uc = repo::create_use_case(
        pool,
        &project.id,
        name,
        body.description.as_deref().map(str::trim),
        body.kind.as_deref().unwrap_or("user_flow"),
        primary.as_deref(),
        &context_ids,
        Some("active"),
        "user",
        body.rationale.as_deref().map(str::trim),
    )?;
    tracing::info!(project_id = %project.id, use_case_id = %uc.id, "management api: created use case");
    Ok(use_case_view(&uc))
}

/// Decompose the goal rows onto a milestone that was JUST created for them, or
/// delete it again. The brief was accepted, the decomposition was not, and a
/// milestone that is half of what was asked for is worse than none. The
/// cleanup is best-effort — the refusal is the error the caller must see.
fn decompose_or_roll_back(
    pool: &DbPool,
    milestone_id: &str,
    goals: &[Value],
) -> Result<(usize, usize), AppError> {
    let plan = match validate_ship_goals(pool, milestone_id, goals) {
        Ok(plan) => plan,
        Err(reason) => {
            let _ = repo::delete_milestone(pool, milestone_id);
            return Err(AppError::Validation(format!("goals: {reason}")));
        }
    };
    let out = create_ship_goals_inner(pool, &plan)?;
    Ok((out.created, out.bound))
}

/// Decompose more of a brief into goals on an existing milestone.
pub(super) fn add_goals(
    pool: &DbPool,
    milestone_id: &str,
    goals: &[Value],
) -> Result<Value, AppError> {
    let plan = validate_ship_goals(pool, milestone_id, goals).map_err(AppError::Validation)?;
    let out = create_ship_goals_inner(pool, &plan)?;
    tracing::info!(
        milestone_id = %plan.milestone_id,
        created = out.created,
        bound = out.bound,
        "management api: added ship goals"
    );
    Ok(json!({
        "milestoneId": out.milestone_id,
        "created": out.created,
        "bound": out.bound,
    }))
}

/// The optional "why it is in the cut" note on one scope row: bounded like a
/// card description, trimmed, and absent when blank.
fn membership_note(row: &Value) -> Result<Option<&str>, AppError> {
    let note = row
        .get("description")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .unwrap_or("");
    if note.chars().count() > SHIP_MILESTONE_DESCRIPTION_MAX {
        return Err(AppError::Validation(format!(
            "a membership `description` is too long (max {SHIP_MILESTONE_DESCRIPTION_MAX} characters)"
        )));
    }
    Ok(note.chars().next().map(|_| note))
}

/// Place / move / remove members. Same validator as Athena's `set_ship_scope`;
/// this door additionally lets a row carry a membership `description` (the
/// "why it is in the cut" note), which the card op leaves to the operator.
pub(super) fn edit_scope(
    pool: &DbPool,
    milestone_id: &str,
    rows: &[Value],
) -> Result<Value, AppError> {
    let (milestone_id, edits) =
        validate_ship_scope(pool, milestone_id, rows).map_err(AppError::Validation)?;
    // `validate_ship_scope` emits one edit per accepted row, in order; the
    // description rides along by position. Guarded so a future validator
    // that drops rows can never mis-attribute a note.
    let descriptions: Vec<Option<&str>> = if edits.len() == rows.len() {
        rows.iter()
            .map(membership_note)
            .collect::<Result<Vec<_>, _>>()?
    } else {
        vec![None; edits.len()]
    };

    let mut placed = 0usize;
    let mut removed = 0usize;
    for (e, description) in edits.iter().zip(descriptions) {
        match &e.bucket {
            Some(bucket) => {
                // `rating` stays untouched (nullable-patch convention): the
                // operator's second opinion is never rewritten from a terminal.
                repo::set_milestone_item(
                    pool,
                    &milestone_id,
                    &e.item_kind,
                    &e.item_id,
                    bucket,
                    description.map(Some),
                    None,
                )?;
                placed += 1;
            }
            None => {
                repo::remove_milestone_item(pool, &milestone_id, &e.item_kind, &e.item_id)?;
                removed += 1;
            }
        }
    }
    tracing::info!(milestone_id = %milestone_id, placed, removed, "management api: edited ship scope");
    Ok(json!({ "milestoneId": milestone_id, "placed": placed, "removed": removed }))
}

/// Patch the brief. `status` is deliberately absent from the body type.
pub(super) fn patch_milestone(
    pool: &DbPool,
    milestone_id: &str,
    body: &PatchMilestoneBody,
) -> Result<DevMilestone, AppError> {
    if let Some(g) = body.goal.as_deref() {
        if g.trim().chars().count() > SHIP_MILESTONE_GOAL_MAX {
            return Err(AppError::Validation(format!(
                "`goal` is the milestone's TITLE (max {SHIP_MILESTONE_GOAL_MAX} characters)"
            )));
        }
    }
    if let Some(d) = body.description.as_deref() {
        if d.trim().chars().count() > SHIP_MILESTONE_DESC_MAX {
            return Err(AppError::Validation(format!(
                "`description` is too long (max {SHIP_MILESTONE_DESC_MAX} characters)"
            )));
        }
    }
    if let Some(n) = body.name.as_deref() {
        personas_core::validation::require_non_empty("name", n)?;
        if n.trim().chars().count() > SHIP_MILESTONE_NAME_MAX {
            return Err(AppError::Validation(format!(
                "`name` must be at most {SHIP_MILESTONE_NAME_MAX} characters"
            )));
        }
    }
    repo::update_milestone(
        pool,
        milestone_id,
        body.name.as_deref().map(str::trim),
        body.goal.as_deref().map(str::trim),
        body.description.as_deref().map(str::trim),
        None,
        body.target_date.as_deref(),
        None,
    )
}

/// Persist what a goal-assist run learned. Only the four fields an agent has
/// evidence for; links, dates and ownership stay in the Goals hub.
pub(super) fn patch_goal(
    pool: &DbPool,
    goal_id: &str,
    body: &PatchGoalBody,
) -> Result<DevGoal, AppError> {
    if let Some(p) = body.progress {
        if !(0..=100).contains(&p) {
            return Err(AppError::Validation("`progress` must be 0..=100".into()));
        }
    }
    if let Some(t) = body.title.as_deref() {
        personas_core::validation::require_non_empty("title", t)?;
    }
    repo::update_goal(
        pool,
        goal_id,
        body.title.as_deref().map(str::trim),
        body.description.as_deref().map(|d| Some(d.trim())),
        body.status.as_deref(),
        body.progress,
        None,
        None,
        None,
        None,
        None,
    )
}

// ── axum handlers ───────────────────────────────────────────────────────────

fn respond(result: Result<impl serde::Serialize, AppError>) -> Response {
    match result {
        Ok(v) => ok_json(v).into_response(),
        Err(AppError::Validation(msg)) => err_json(StatusCode::BAD_REQUEST, &msg).into_response(),
        Err(AppError::NotFound(msg)) => {
            err_json(StatusCode::NOT_FOUND, &format!("{msg} not found")).into_response()
        }
        Err(e) => err_json(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()).into_response(),
    }
}

pub(super) async fn list_projects(AxumState(state): AxumState<Arc<ManagementState>>) -> Response {
    respond(
        repo::list_projects(&state.pool, None)
            .map(|ps| ps.iter().map(project_view).collect::<Vec<_>>()),
    )
}

pub(super) async fn get_project_ship(
    AxumState(state): AxumState<Arc<ManagementState>>,
    Path(project_id): Path<String>,
) -> Response {
    respond(project_ship_snapshot(&state.pool, &project_id))
}

pub(super) async fn get_milestone(
    AxumState(state): AxumState<Arc<ManagementState>>,
    Path(milestone_id): Path<String>,
) -> Response {
    respond(milestone_snapshot(&state.pool, &milestone_id))
}

pub(super) async fn post_milestone(
    AxumState(state): AxumState<Arc<ManagementState>>,
    Path(project_id): Path<String>,
    Json(body): Json<CreateMilestoneBody>,
) -> Response {
    respond(create_milestone_for_project(
        &state.pool,
        &project_id,
        &body,
    ))
}

pub(super) async fn post_use_case(
    AxumState(state): AxumState<Arc<ManagementState>>,
    Path(project_id): Path<String>,
    Json(body): Json<CreateUseCaseBody>,
) -> Response {
    respond(create_use_case_for_project(&state.pool, &project_id, &body))
}

pub(super) async fn post_milestone_goals(
    AxumState(state): AxumState<Arc<ManagementState>>,
    Path(milestone_id): Path<String>,
    Json(body): Json<AddGoalsBody>,
) -> Response {
    respond(add_goals(&state.pool, &milestone_id, &body.goals))
}

pub(super) async fn post_milestone_scope(
    AxumState(state): AxumState<Arc<ManagementState>>,
    Path(milestone_id): Path<String>,
    Json(body): Json<ScopeBody>,
) -> Response {
    respond(edit_scope(&state.pool, &milestone_id, &body.items))
}

pub(super) async fn post_milestone_patch(
    AxumState(state): AxumState<Arc<ManagementState>>,
    Path(milestone_id): Path<String>,
    Json(body): Json<PatchMilestoneBody>,
) -> Response {
    respond(patch_milestone(&state.pool, &milestone_id, &body))
}

pub(super) async fn post_goal_patch(
    AxumState(state): AxumState<Arc<ManagementState>>,
    Path(goal_id): Path<String>,
    Json(body): Json<PatchGoalBody>,
) -> Response {
    respond(patch_goal(&state.pool, &goal_id, &body))
}

// ── tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    /// Same shape as `ship_ingest`'s pool: the full chain (`run` +
    /// `run_incremental`) on a shared-cache in-memory database, because
    /// `dev_milestones` and the item annotation columns only exist after the
    /// incremental steps.
    fn pool() -> DbPool {
        use std::sync::atomic::{AtomicU64, Ordering};
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let id = COUNTER.fetch_add(1, Ordering::Relaxed);
        let uri = format!("file:ship_api_testdb_{id}?mode=memory&cache=shared");
        let manager = r2d2_sqlite::SqliteConnectionManager::file(&uri);
        let pool = r2d2::Pool::builder()
            .max_size(4)
            .connection_timeout(std::time::Duration::from_secs(5))
            .build(manager)
            .expect("pool");
        {
            let conn = crate::db::acquire_logged(&pool, "ship-api-test").expect("conn");
            conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
            crate::db::migrations::run(&conn).expect("migrations");
            crate::db::migrations::run_incremental(&conn).expect("incremental migrations");
        }
        pool
    }

    fn project(pool: &DbPool) -> DevProject {
        repo::create_project(
            pool,
            "ship-api",
            "C:/tmp/ship-api",
            None,
            None,
            None,
            None,
            None,
        )
        .expect("project")
    }

    fn body(name: &str) -> CreateMilestoneBody {
        CreateMilestoneBody {
            name: name.into(),
            ..Default::default()
        }
    }

    #[test]
    fn a_brief_can_be_born_with_no_members() {
        let pool = pool();
        let p = project(&pool);
        let out = create_milestone_for_project(
            &pool,
            &p.id,
            &CreateMilestoneBody {
                description: Some("what shipping means".into()),
                goal: Some("Core path".into()),
                ..body("v1")
            },
        )
        .expect("created");
        let m = &out["milestone"];
        assert_eq!(m["name"], "v1");
        assert_eq!(m["goal"], "Core path");
        assert_eq!(
            m["status"], "planned",
            "born planned — cutting is the operator's"
        );
        assert!(m["cutAt"].is_null());
        assert_eq!(m["items"].as_array().map(Vec::len), Some(0));
        assert_eq!(out["goals"]["created"], 0);
    }

    #[test]
    fn header_bounds_are_the_card_bounds() {
        let pool = pool();
        let p = project(&pool);
        let long_goal = "x".repeat(SHIP_MILESTONE_GOAL_MAX + 1);
        let err = create_milestone_for_project(
            &pool,
            &p.id,
            &CreateMilestoneBody {
                goal: Some(long_goal),
                ..body("v1")
            },
        )
        .expect_err("goal too long");
        assert!(matches!(err, AppError::Validation(_)), "{err}");
        let err = create_milestone_for_project(&pool, &p.id, &body("   ")).expect_err("empty name");
        assert!(matches!(err, AppError::Validation(_)));
        assert_eq!(
            repo::list_milestones_by_project(&pool, &p.id)
                .unwrap()
                .len(),
            0,
            "a refused brief writes nothing"
        );
    }

    #[test]
    fn unknown_project_is_not_found_not_a_validation_string() {
        let pool = pool();
        let err = create_milestone_for_project(&pool, "nope", &body("v1")).expect_err("404");
        assert!(matches!(err, AppError::NotFound(_)), "{err}");
    }

    #[test]
    fn rows_bind_existing_members_and_goals_are_created_and_bound() {
        let pool = pool();
        let p = project(&pool);
        let uc = repo::create_use_case(
            &pool,
            &p.id,
            "Repo Maturity Scan",
            None,
            "user_flow",
            None,
            &[],
            Some("active"),
            "user",
            None,
        )
        .expect("use case");
        let existing =
            repo::create_goal(&pool, &p.id, "Already there", None, None, None, None, None)
                .expect("goal");
        let out = create_milestone_for_project(
            &pool,
            &p.id,
            &CreateMilestoneBody {
                rows: vec![json!({ "item_kind": "use_case", "item_id": uc.name, "description": "the path" })],
                goals: vec![
                    json!({ "title": "Already there" }),
                    json!({ "title": "Brand new", "description": "d" }),
                ],
                ..body("v1")
            },
        )
        .expect("created");
        assert_eq!(out["goals"]["created"], 1);
        assert_eq!(out["goals"]["bound"], 1);
        let items = out["milestone"]["items"].as_array().unwrap();
        assert_eq!(items.len(), 3, "{items:?}");
        let uc_row = items.iter().find(|i| i["itemKind"] == "use_case").unwrap();
        assert_eq!(uc_row["itemId"], uc.id, "resolved by NAME to the real id");
        assert_eq!(uc_row["name"], "Repo Maturity Scan");
        assert_eq!(uc_row["bucket"], "core");
        assert_eq!(uc_row["description"], "the path");
        assert!(
            items.iter().any(|i| i["itemId"] == existing.id),
            "existing goal bound, not twinned"
        );
        assert_eq!(
            repo::list_goals_by_project(&pool, &p.id, None)
                .unwrap()
                .len(),
            2
        );
    }

    #[test]
    fn a_refused_goal_row_removes_the_milestone_it_was_meant_for() {
        let pool = pool();
        let p = project(&pool);
        let err = create_milestone_for_project(
            &pool,
            &p.id,
            &CreateMilestoneBody {
                goals: vec![json!({ "title": "ok" }), json!({ "title": "" })],
                ..body("v1")
            },
        )
        .expect_err("empty goal title");
        assert!(matches!(err, AppError::Validation(_)), "{err}");
        assert!(
            repo::list_milestones_by_project(&pool, &p.id)
                .unwrap()
                .is_empty(),
            "half a milestone is worse than none"
        );
        assert!(repo::list_goals_by_project(&pool, &p.id, None)
            .unwrap()
            .is_empty());
    }

    #[test]
    fn a_kpi_is_refused_as_a_member() {
        let pool = pool();
        let p = project(&pool);
        let err = create_milestone_for_project(
            &pool,
            &p.id,
            &CreateMilestoneBody {
                rows: vec![json!({ "item_kind": "kpi", "item_id": "whatever" })],
                ..body("v1")
            },
        )
        .expect_err("kpi member");
        assert!(err.to_string().contains("KPI"), "{err}");
    }

    #[test]
    fn scope_edits_place_move_remove_and_carry_a_note() {
        let pool = pool();
        let p = project(&pool);
        let uc = repo::create_use_case(
            &pool,
            &p.id,
            "Org Onboarding",
            None,
            "user_flow",
            None,
            &[],
            Some("active"),
            "user",
            None,
        )
        .unwrap();
        let m = create_milestone_for_project(&pool, &p.id, &body("v1")).unwrap();
        let mid = m["milestone"]["id"].as_str().unwrap().to_string();

        let out = edit_scope(
            &pool,
            &mid,
            &[json!({ "item_kind": "use_case", "item_id": uc.id, "bucket": "later", "description": "not yet" })],
        )
        .unwrap();
        assert_eq!(out["placed"], 1);
        let items = repo::list_milestone_items(&pool, &mid).unwrap();
        assert_eq!(items[0].bucket, "later");
        assert_eq!(items[0].description.as_deref(), Some("not yet"));

        // Re-bucketing without a note keeps the note (nullable-patch).
        edit_scope(
            &pool,
            &mid,
            &[json!({ "item_kind": "use_case", "item_id": uc.id, "bucket": "core" })],
        )
        .unwrap();
        let items = repo::list_milestone_items(&pool, &mid).unwrap();
        assert_eq!(items[0].bucket, "core");
        assert_eq!(items[0].description.as_deref(), Some("not yet"));

        let out = edit_scope(
            &pool,
            &mid,
            &[json!({ "item_kind": "use_case", "item_id": uc.id, "bucket": "remove" })],
        )
        .unwrap();
        assert_eq!(out["removed"], 1);
        assert!(repo::list_milestone_items(&pool, &mid).unwrap().is_empty());
    }

    #[test]
    fn patch_touches_the_brief_never_the_lifecycle() {
        let pool = pool();
        let p = project(&pool);
        let m = create_milestone_for_project(&pool, &p.id, &body("v1")).unwrap();
        let mid = m["milestone"]["id"].as_str().unwrap().to_string();
        let patched = patch_milestone(
            &pool,
            &mid,
            &PatchMilestoneBody {
                description: Some("the brief".into()),
                target_date: Some("2026-09-30".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(patched.description.as_deref(), Some("the brief"));
        assert_eq!(patched.target_date.as_deref(), Some("2026-09-30"));
        assert_eq!(patched.status, "planned");
        assert!(patched.cut_at.is_none());
        // The body type has no `status` field at all — a JSON `status` is ignored.
        let parsed: PatchMilestoneBody =
            serde_json::from_value(json!({ "status": "shipped", "name": "v2" })).unwrap();
        assert_eq!(parsed.name.as_deref(), Some("v2"));
    }

    #[test]
    fn goal_patch_persists_what_an_assist_run_learned() {
        let pool = pool();
        let p = project(&pool);
        let g =
            repo::create_goal(&pool, &p.id, "Close the gap", None, None, None, None, None).unwrap();
        let out = patch_goal(
            &pool,
            &g.id,
            &PatchGoalBody {
                description: Some("touched a/b; next: c".into()),
                progress: Some(40),
                status: Some("in_progress".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(out.description.as_deref(), Some("touched a/b; next: c"));
        assert_eq!(out.progress, 40);
        let err = patch_goal(
            &pool,
            &g.id,
            &PatchGoalBody {
                progress: Some(101),
                ..Default::default()
            },
        )
        .expect_err("out of range");
        assert!(matches!(err, AppError::Validation(_)));
    }

    #[test]
    fn a_use_case_can_be_registered_and_then_bound() {
        let pool = pool();
        let p = project(&pool);
        let uc = create_use_case_for_project(
            &pool,
            &p.id,
            &CreateUseCaseBody {
                name: "Free-Channel Discovery".into(),
                description: Some("URL to ranked free channels".into()),
                kind: Some("user_flow".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(uc["status"], "active");
        assert_eq!(uc["slug"], "free-channel-discovery");
        let out = create_milestone_for_project(
            &pool,
            &p.id,
            &CreateMilestoneBody {
                rows: vec![json!({ "item_kind": "use_case", "item_id": "Free-Channel Discovery" })],
                ..body("v1")
            },
        )
        .unwrap();
        assert_eq!(out["milestone"]["items"][0]["itemId"], uc["id"]);
        // A second registration of the same name is refused, not twinned.
        let err = create_use_case_for_project(
            &pool,
            &p.id,
            &CreateUseCaseBody {
                name: "Free-Channel Discovery".into(),
                ..Default::default()
            },
        )
        .expect_err("duplicate");
        assert!(matches!(err, AppError::Validation(_)), "{err}");
        // An unknown context hint names the miss instead of silently dropping it.
        let err = create_use_case_for_project(
            &pool,
            &p.id,
            &CreateUseCaseBody {
                name: "Other".into(),
                context_hints: vec!["no-such-context".into()],
                ..Default::default()
            },
        )
        .expect_err("bad hint");
        assert!(matches!(err, AppError::Validation(_)), "{err}");
    }

    #[test]
    fn snapshots_resolve_member_names() {
        let pool = pool();
        let p = project(&pool);
        let uc = repo::create_use_case(
            &pool,
            &p.id,
            "PR Maturity Gate",
            None,
            "user_flow",
            None,
            &[],
            Some("active"),
            "user",
            None,
        )
        .unwrap();
        create_milestone_for_project(
            &pool,
            &p.id,
            &CreateMilestoneBody {
                rows: vec![json!({ "item_kind": "use_case", "item_id": uc.id })],
                goals: vec![json!({ "title": "Wire the gate" })],
                ..body("v1")
            },
        )
        .unwrap();
        let snap = project_ship_snapshot(&pool, &p.id).unwrap();
        assert_eq!(snap["project"]["id"], p.id);
        assert_eq!(snap["useCases"].as_array().unwrap().len(), 1);
        assert_eq!(snap["goals"].as_array().unwrap().len(), 1);
        let items = snap["milestones"][0]["items"].as_array().unwrap();
        let names: Vec<&str> = items.iter().filter_map(|i| i["name"].as_str()).collect();
        assert!(names.contains(&"PR Maturity Gate"), "{names:?}");
        assert!(names.contains(&"Wire the gate"), "{names:?}");
    }
}
