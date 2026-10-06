//! The headless App Master's write doors onto the app-owned tables it has no
//! other way to reach.
//!
//! A headless App Master (`.claude/skills/appmaster`) never writes the app
//! database: every app-owned write is queued in its outbox and replayed through
//! `/dev-tools` when the app is up. Before these doors, five of those writes had
//! no route at all (measured 2026-10-06), so the outbox could hold them but
//! never deliver them. Each function here is the BLOCKING body of one route; the
//! route in `dev_tools_http.rs` is the adapter.
//!
//! None of them owns a rule. Each validates what only an HTTP caller can get
//! wrong (a missing project, a milestone of another project, an ambiguous
//! name), then calls the same repo function the matching Tauri command calls,
//! so a row written here is indistinguishable from one written by a click.
//!
//! [`DoorError`] exists because the bridge's shared mapper (`status_for`) only
//! knows 400 / 404 / 500, and three of these refusals are a CONFLICT: the
//! request is well formed and names things that exist, but they do not belong
//! together. A caller replaying an outbox must be able to tell "fix the payload"
//! from "this will never succeed as asked".

use serde::{Deserialize, Serialize};

use crate::db::repos::dev_tools as repo;
use crate::db::repos::dev_workspaces as ws_repo;
use crate::db::DbPool;
use crate::error::AppError;

/// Why a door refused, in the vocabulary the route turns into a status code.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DoorError {
    /// 400: the payload is malformed or a value is out of its vocabulary.
    BadRequest(String),
    /// 404: an id or name the payload relies on resolves to nothing.
    NotFound(String),
    /// 409: everything named exists, but not in the relation the request needs.
    Conflict(String),
    /// 422: the payload was read and REFUSED by a validating door; the text is
    /// that door's own JSON answer, so the caller sees exactly what it would
    /// have seen on success, with the refusal inside it.
    Unprocessable(String),
    /// 500: a fault on our side.
    Internal(String),
}

impl DoorError {
    pub fn message(&self) -> &str {
        match self {
            DoorError::BadRequest(m)
            | DoorError::NotFound(m)
            | DoorError::Conflict(m)
            | DoorError::Unprocessable(m)
            | DoorError::Internal(m) => m,
        }
    }
}

impl From<AppError> for DoorError {
    fn from(e: AppError) -> Self {
        match e {
            AppError::Validation(m) => DoorError::BadRequest(m),
            AppError::NotFound(m) => DoorError::NotFound(m),
            other => DoorError::Internal(other.to_string()),
        }
    }
}

/// 404 when the project does not exist. Every door starts here, so a mistyped
/// id never reaches a repo function that would answer with a foreign-key error
/// (a 500) or, worse, a row pinned to nothing.
pub(crate) fn require_project(
    pool: &DbPool,
    project_id: &str,
) -> Result<crate::db::models::DevProject, DoorError> {
    repo::get_project_by_id(pool, project_id).map_err(|e| match e {
        AppError::NotFound(_) => {
            DoorError::NotFound(format!("No project registered with id {project_id}"))
        }
        other => other.into(),
    })
}

// ============================================================================
// POST /dev-tools/milestones
// ============================================================================

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateMilestoneInput {
    pub project_id: String,
    pub name: String,
    #[serde(default)]
    pub goal: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub target_date: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MilestoneCreated {
    pub milestone_id: String,
}

/// `dev_tools_create_milestone`'s path. No `status`: a milestone born here is
/// `planned`, and cutting it is the operator's act on the Ship tab.
pub fn create_milestone(
    pool: &DbPool,
    input: &CreateMilestoneInput,
) -> Result<MilestoneCreated, DoorError> {
    require_project(pool, &input.project_id)?;
    let milestone = repo::create_milestone(
        pool,
        &input.project_id,
        &input.name,
        input.goal.as_deref(),
        input.description.as_deref(),
        None,
        input.target_date.as_deref(),
    )?;
    Ok(MilestoneCreated {
        milestone_id: milestone.id,
    })
}

// ============================================================================
// POST /dev-tools/goals
// ============================================================================

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateGoalInput {
    pub project_id: String,
    pub title: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub target_date: Option<String>,
    #[serde(default)]
    pub parent_goal_id: Option<String>,
    /// Bind the new goal into this milestone's core scope in the same call.
    #[serde(default)]
    pub milestone_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalCreated {
    pub goal_id: String,
}

/// The bucket a goal filed with a milestone lands in. `core` is the cut's
/// committed scope: a master that names the milestone is saying the goal is
/// part of what the milestone ships, not a someday item.
const GOAL_MILESTONE_BUCKET: &str = "core";

/// `dev_tools_create_goal`'s path, plus the milestone binding the Ship tab does
/// with `dev_tools_set_milestone_item`.
///
/// Everything the binding depends on is checked BEFORE the goal is written, so
/// a refusal leaves no goal behind. The one write that can still fail after it
/// (the binding itself) undoes the goal: a replayed outbox entry must find
/// either both rows or neither, never a goal the milestone does not know about.
pub fn create_goal(pool: &DbPool, input: &CreateGoalInput) -> Result<GoalCreated, DoorError> {
    require_project(pool, &input.project_id)?;

    if let Some(parent_id) = input.parent_goal_id.as_deref() {
        let parent = repo::get_goal_by_id(pool, parent_id)?;
        if parent.project_id != input.project_id {
            return Err(DoorError::Conflict(format!(
                "parent goal {parent_id} belongs to project {}, not {}",
                parent.project_id, input.project_id
            )));
        }
    }
    if let Some(milestone_id) = input.milestone_id.as_deref() {
        let milestone = repo::get_milestone_by_id(pool, milestone_id)?;
        if milestone.project_id != input.project_id {
            return Err(DoorError::Conflict(format!(
                "milestone {milestone_id} belongs to project {}, not {}",
                milestone.project_id, input.project_id
            )));
        }
    }

    let goal = repo::create_goal(
        pool,
        &input.project_id,
        &input.title,
        input.description.as_deref(),
        None,
        None,
        input.target_date.as_deref(),
        input.parent_goal_id.as_deref(),
    )?;

    if let Some(milestone_id) = input.milestone_id.as_deref() {
        if let Err(e) = repo::set_milestone_item(
            pool,
            milestone_id,
            "goal",
            &goal.id,
            GOAL_MILESTONE_BUCKET,
            None,
            None,
        ) {
            if let Err(undo) = repo::delete_goal(pool, &goal.id) {
                tracing::warn!(
                    goal_id = %goal.id, error = %undo,
                    "headless goal door: binding failed and the goal could not be undone"
                );
            }
            return Err(e.into());
        }
    }

    Ok(GoalCreated { goal_id: goal.id })
}

// ============================================================================
// POST /dev-tools/projects/{projectId}/workspace
// ============================================================================

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssignWorkspaceInput {
    #[serde(default)]
    pub workspace_id: Option<String>,
    /// An EXISTING workspace's exact name. This door never creates one.
    #[serde(default)]
    pub workspace_name: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceAssigned {
    /// `null` when the call cleared the project's workspace.
    pub workspace_id: Option<String>,
}

/// `dev_tools_workspace_assign_project`'s path, with the workspace named by id
/// OR by exact name, or by neither to clear it.
///
/// A blank value is refused rather than read as "neither": clearing is a
/// deliberate act, and a template that rendered an empty name must not move
/// the project out of its workspace.
pub fn assign_workspace(
    pool: &DbPool,
    project_id: &str,
    input: &AssignWorkspaceInput,
) -> Result<WorkspaceAssigned, DoorError> {
    require_project(pool, project_id)?;
    for (field, value) in [
        ("workspaceId", input.workspace_id.as_deref()),
        ("workspaceName", input.workspace_name.as_deref()),
    ] {
        if value.is_some_and(|v| v.trim().is_empty()) {
            return Err(DoorError::BadRequest(format!(
                "`{field}` is blank; omit both keys to clear the workspace"
            )));
        }
    }
    let workspace_id = match (
        input.workspace_id.as_deref(),
        input.workspace_name.as_deref(),
    ) {
        (Some(_), Some(_)) => {
            return Err(DoorError::BadRequest(
                "send `workspaceId` or `workspaceName`, not both".into(),
            ))
        }
        (Some(id), None) => Some(ws_repo::get_workspace_by_id(pool, id.trim())?.id),
        (None, Some(name)) => {
            let matches: Vec<_> = ws_repo::list_workspaces(pool)?
                .into_iter()
                .filter(|w| w.name == name)
                .collect();
            match matches.as_slice() {
                [only] => Some(only.id.clone()),
                [] => {
                    return Err(DoorError::NotFound(format!(
                        "no workspace is named exactly `{name}` (this door never creates one)"
                    )))
                }
                _ => {
                    return Err(DoorError::Conflict(format!(
                        "{} workspaces are named `{name}`; send `workspaceId`",
                        matches.len()
                    )))
                }
            }
        }
        (None, None) => None,
    };
    let project = ws_repo::assign_project(pool, project_id, workspace_id.as_deref())?;
    Ok(WorkspaceAssigned {
        workspace_id: project.workspace_id,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use personas_db::init_test_db;

    fn project(pool: &DbPool, name: &str) -> String {
        crate::db::repos::dev::projects::create_project(
            pool,
            name,
            &std::env::temp_dir()
                .join(format!("personas_doors_{name}_{}", uuid::Uuid::new_v4()))
                .to_string_lossy(),
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap()
        .id
    }

    fn milestone_input(project_id: &str, name: &str) -> CreateMilestoneInput {
        CreateMilestoneInput {
            project_id: project_id.into(),
            name: name.into(),
            goal: Some("ship the door".into()),
            description: None,
            target_date: Some("2026-10-31".into()),
        }
    }

    fn goal_input(project_id: &str, milestone_id: Option<&str>) -> CreateGoalInput {
        CreateGoalInput {
            project_id: project_id.into(),
            title: "Ten masters run unattended".into(),
            description: Some("measured by the outbox draining".into()),
            target_date: None,
            parent_goal_id: None,
            milestone_id: milestone_id.map(str::to_string),
        }
    }

    #[test]
    fn a_milestone_lands_planned_with_the_fields_it_was_given() {
        let pool = init_test_db().unwrap();
        let p = project(&pool, "ascent");
        let out = create_milestone(&pool, &milestone_input(&p, "M1")).unwrap();
        let row = repo::get_milestone_by_id(&pool, &out.milestone_id).unwrap();
        assert_eq!(row.project_id, p);
        assert_eq!(row.status, "planned");
        assert_eq!(row.goal.as_deref(), Some("ship the door"));
        assert_eq!(row.target_date.as_deref(), Some("2026-10-31"));
    }

    #[test]
    fn a_milestone_refuses_an_unknown_project_and_an_empty_name() {
        let pool = init_test_db().unwrap();
        assert!(matches!(
            create_milestone(&pool, &milestone_input("nope", "M1")),
            Err(DoorError::NotFound(_))
        ));
        let p = project(&pool, "ascent");
        assert!(matches!(
            create_milestone(&pool, &milestone_input(&p, "   ")),
            Err(DoorError::BadRequest(_))
        ));
        assert!(repo::list_milestones_by_project(&pool, &p)
            .unwrap()
            .is_empty());
    }

    #[test]
    fn a_goal_with_a_milestone_is_bound_into_its_core_scope() {
        let pool = init_test_db().unwrap();
        let p = project(&pool, "ascent");
        let m = create_milestone(&pool, &milestone_input(&p, "M1"))
            .unwrap()
            .milestone_id;
        let out = create_goal(&pool, &goal_input(&p, Some(&m))).unwrap();

        let goal = repo::get_goal_by_id(&pool, &out.goal_id).unwrap();
        assert_eq!(goal.project_id, p);
        assert_eq!(
            goal.description.as_deref(),
            Some("measured by the outbox draining")
        );
        let items = repo::list_milestone_items(&pool, &m).unwrap();
        assert_eq!(items.len(), 1, "{items:?}");
        assert_eq!(items[0].item_kind, "goal");
        assert_eq!(items[0].item_id, out.goal_id);
        assert_eq!(items[0].bucket, "core");
    }

    #[test]
    fn a_goal_without_a_milestone_binds_nothing() {
        let pool = init_test_db().unwrap();
        let p = project(&pool, "ascent");
        let out = create_goal(&pool, &goal_input(&p, None)).unwrap();
        assert_eq!(
            repo::get_goal_by_id(&pool, &out.goal_id)
                .unwrap()
                .project_id,
            p
        );
    }

    #[test]
    fn a_milestone_of_another_project_is_a_conflict_and_writes_no_goal() {
        let pool = init_test_db().unwrap();
        let mine = project(&pool, "ascent");
        let theirs = project(&pool, "kp");
        let m = create_milestone(&pool, &milestone_input(&theirs, "Their M"))
            .unwrap()
            .milestone_id;
        assert!(matches!(
            create_goal(&pool, &goal_input(&mine, Some(&m))),
            Err(DoorError::Conflict(_))
        ));
        assert!(
            repo::list_goals_by_project(&pool, &mine, None)
                .unwrap()
                .is_empty(),
            "a refused binding must not leave the goal behind"
        );
        assert!(repo::list_milestone_items(&pool, &m).unwrap().is_empty());
    }

    #[test]
    fn a_goal_refuses_an_unknown_project_milestone_and_empty_title() {
        let pool = init_test_db().unwrap();
        assert!(matches!(
            create_goal(&pool, &goal_input("nope", None)),
            Err(DoorError::NotFound(_))
        ));
        let p = project(&pool, "ascent");
        assert!(matches!(
            create_goal(&pool, &goal_input(&p, Some("no-such-milestone"))),
            Err(DoorError::NotFound(_))
        ));
        let mut blank = goal_input(&p, None);
        blank.title = "  ".into();
        assert!(matches!(
            create_goal(&pool, &blank),
            Err(DoorError::BadRequest(_))
        ));
        assert!(repo::list_goals_by_project(&pool, &p, None)
            .unwrap()
            .is_empty());
    }

    #[test]
    fn a_parent_goal_of_another_project_is_a_conflict() {
        let pool = init_test_db().unwrap();
        let mine = project(&pool, "ascent");
        let theirs = project(&pool, "kp");
        let parent = create_goal(&pool, &goal_input(&theirs, None))
            .unwrap()
            .goal_id;
        let mut child = goal_input(&mine, None);
        child.parent_goal_id = Some(parent);
        assert!(matches!(
            create_goal(&pool, &child),
            Err(DoorError::Conflict(_))
        ));
    }

    /// The JSON contract: camelCase in, absent optional keys mean "not set".
    #[test]
    fn the_bodies_are_camel_case_and_optional_keys_may_be_absent() {
        let m: CreateMilestoneInput =
            serde_json::from_str(r#"{"projectId":"p","name":"M1"}"#).unwrap();
        assert!(m.goal.is_none() && m.description.is_none() && m.target_date.is_none());
        let g: CreateGoalInput =
            serde_json::from_str(r#"{"projectId":"p","title":"T","milestoneId":"m"}"#).unwrap();
        assert_eq!(g.milestone_id.as_deref(), Some("m"));
        assert!(g.parent_goal_id.is_none());
        let out = serde_json::to_value(GoalCreated {
            goal_id: "g".into(),
        })
        .unwrap();
        assert_eq!(out, serde_json::json!({ "goalId": "g" }));
        let out = serde_json::to_value(MilestoneCreated {
            milestone_id: "m".into(),
        })
        .unwrap();
        assert_eq!(out, serde_json::json!({ "milestoneId": "m" }));
    }

    fn workspace(pool: &DbPool, name: &str) -> String {
        ws_repo::create_workspace(pool, name, None, None, false)
            .unwrap()
            .id
    }

    fn assign(id: Option<&str>, name: Option<&str>) -> AssignWorkspaceInput {
        AssignWorkspaceInput {
            workspace_id: id.map(str::to_string),
            workspace_name: name.map(str::to_string),
        }
    }

    fn workspace_of(pool: &DbPool, project_id: &str) -> Option<String> {
        repo::get_project_by_id(pool, project_id)
            .unwrap()
            .workspace_id
    }

    #[test]
    fn a_workspace_is_assigned_by_id_by_exact_name_and_cleared_by_neither() {
        let pool = init_test_db().unwrap();
        let p = project(&pool, "ascent");
        let core = workspace(&pool, "Core");
        let hack = workspace(&pool, "Hackathon");

        let out = assign_workspace(&pool, &p, &assign(Some(&core), None)).unwrap();
        assert_eq!(out.workspace_id.as_deref(), Some(core.as_str()));
        assert_eq!(workspace_of(&pool, &p).as_deref(), Some(core.as_str()));

        let out = assign_workspace(&pool, &p, &assign(None, Some("Hackathon"))).unwrap();
        assert_eq!(out.workspace_id.as_deref(), Some(hack.as_str()));

        let out = assign_workspace(&pool, &p, &assign(None, None)).unwrap();
        assert_eq!(out.workspace_id, None);
        assert_eq!(workspace_of(&pool, &p), None);
        assert_eq!(
            serde_json::to_value(&out).unwrap(),
            serde_json::json!({ "workspaceId": null }),
            "a cleared assignment answers an explicit null"
        );
    }

    #[test]
    fn a_workspace_name_resolves_exactly_and_is_never_created() {
        let pool = init_test_db().unwrap();
        let p = project(&pool, "ascent");
        workspace(&pool, "Core");
        let before = ws_repo::list_workspaces(&pool).unwrap().len();

        // Exact: case and surrounding text both matter.
        for name in ["core", "Core ", "Cor"] {
            assert!(
                matches!(
                    assign_workspace(&pool, &p, &assign(None, Some(name))),
                    Err(DoorError::NotFound(_))
                ),
                "{name:?} must not resolve"
            );
        }
        assert_eq!(ws_repo::list_workspaces(&pool).unwrap().len(), before);
        assert_eq!(workspace_of(&pool, &p), None);
    }

    #[test]
    fn a_workspace_refuses_both_keys_blank_values_and_unknown_ids() {
        let pool = init_test_db().unwrap();
        let p = project(&pool, "ascent");
        let core = workspace(&pool, "Core");
        assign_workspace(&pool, &p, &assign(Some(&core), None)).unwrap();

        assert!(matches!(
            assign_workspace(&pool, &p, &assign(Some(&core), Some("Core"))),
            Err(DoorError::BadRequest(_))
        ));
        assert!(matches!(
            assign_workspace(&pool, &p, &assign(None, Some("  "))),
            Err(DoorError::BadRequest(_))
        ));
        assert!(matches!(
            assign_workspace(&pool, &p, &assign(Some(""), None)),
            Err(DoorError::BadRequest(_))
        ));
        assert!(matches!(
            assign_workspace(&pool, &p, &assign(Some("no-such-ws"), None)),
            Err(DoorError::NotFound(_))
        ));
        assert!(matches!(
            assign_workspace(&pool, "no-such-project", &assign(Some(&core), None)),
            Err(DoorError::NotFound(_))
        ));
        assert_eq!(
            workspace_of(&pool, &p).as_deref(),
            Some(core.as_str()),
            "no refusal moved the project"
        );
    }

    #[test]
    fn two_workspaces_with_one_name_are_a_conflict() {
        let pool = init_test_db().unwrap();
        let p = project(&pool, "ascent");
        workspace(&pool, "Core");
        // A second row with the same name. Inserted directly: the point is a
        // store that already holds the ambiguity, however it got there.
        pool.get()
            .unwrap()
            .execute(
                "INSERT INTO dev_workspaces (id, name, adopt_default_skills, created_at, updated_at)
                 VALUES ('ws-dup', 'Core', 0, datetime('now'), datetime('now'))",
                [],
            )
            .unwrap();
        assert!(matches!(
            assign_workspace(&pool, &p, &assign(None, Some("Core"))),
            Err(DoorError::Conflict(_))
        ));
        let body: AssignWorkspaceInput = serde_json::from_str("{}").unwrap();
        assert!(body.workspace_id.is_none() && body.workspace_name.is_none());
    }
}
