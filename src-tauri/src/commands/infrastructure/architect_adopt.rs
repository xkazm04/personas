//! **Headless Architect adoption** — the cross-project twin of
//! [`super::app_master_adopt`]. One door that turns a `dev_workspaces` row into
//! an **Architect**: a persona bound to the WORKSPACE, holding one charter per
//! chosen recipe, enrolled in the living-agent attention loop.
//!
//! # Why a second door rather than a flag on the first
//!
//! The operation is the same and shares one body (`app_master_adopt::
//! adopt_bound` over [`Binding`]): resolve the recipes before the first write,
//! find the incumbent by pin then by name prefix, create-or-update the persona,
//! sync the charters, seed the manifest law. What differs is the WIRE — a
//! caller names a `workspace`, not a `project`, and gets a workspace id back —
//! and a route that accepted either and quietly decided which one the caller
//! meant is exactly the ambiguity the binding enum exists to remove.
//!
//! # What an Architect is
//!
//! Grand Simulation §2 (`docs/architecture/grand-simulation.md`): the role that
//! designs the enterprise solution, composes the portfolio into projects,
//! adopts an App Master on each, sets goals, speaks in the workspace channel
//! with authority, plans the workforce and reflects on scope. It does not write
//! application code — its five recipes write documents and call doors — and its
//! manifest Mandate says so in those words.
//!
//! Its decision reads the whole workspace: every project with the same snapshot
//! an App Master would get, plus each project's App Master state, the goals
//! across the portfolio and the active-persona count
//! (`subscription::attention::build_workspace_view`).
//!
//! # Idempotency
//!
//! The persona is keyed by `(design_context.workspaceId, name)`; each charter
//! by `(persona_id, spec.recipeRef.slug)`. A second call with the same body
//! updates in place and creates nothing; a slug dropped from the body
//! **suspends** its charter rather than deleting it, so the coverage memory the
//! attention loop wrote survives a re-adoption.

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::State;
use ts_rs::TS;

use crate::commands::infrastructure::app_master_adopt::{
    adopt_bound, resolve_workspace, AdoptedRole, AdoptionOptions, AppMasterCharterOutcome,
    AppMasterOpenAsk, AppMasterRecipeRequest, Binding, ARCHITECT_NAME_PREFIX,
};
use crate::db::models::ResponsibilityStatus;
use crate::db::repos::core::personas as personas_repo;
use crate::db::repos::core::responsibilities as resp_repo;
use crate::db::DbPool;
use crate::engine::persona_brain::manifest;
use crate::error::AppError;
use crate::ipc_auth::require_auth;
use crate::AppState;

// ---------------------------------------------------------------------------
// Wire types
// ---------------------------------------------------------------------------

/// The adoption request. Every field but `workspace` means exactly what the
/// same-named field on `AdoptAppMasterInput` means, and the two doors share the
/// validation.
#[derive(Debug, Clone, Deserialize, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct AdoptArchitectInput {
    /// A `dev_workspaces` id or name — whichever the caller has.
    pub workspace: String,
    /// The recipes this Architect holds. An empty list is accepted and
    /// suspends every recipe charter it currently holds.
    #[serde(default)]
    pub recipes: Vec<AppMasterRecipeRequest>,
    /// A tier slug (`haiku` | `sonnet` | `opus`) or a full `claude-*` model
    /// id. Defaults to `opus`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub model: Option<String>,
    /// `personas.max_concurrent`. Defaults to 2.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub max_concurrent: Option<i32>,
    /// Mandate rung, clamped to the grantable ceiling (2). Defaults to 2.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub scope_rung: Option<u8>,
    /// `personas.enabled`. Defaults to FALSE — adoption prepares the Architect,
    /// a separate act starts it running.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub enabled: Option<bool>,
    /// Persona name. Defaults to `Architect <workspace name>`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub name: Option<String>,
}

/// What the adoption actually did. Every field is a fact; `notes` carries
/// everything that did not happen and why.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ArchitectAdoption {
    pub persona_id: String,
    pub persona_name: String,
    pub workspace_id: String,
    pub workspace_name: String,
    /// True when this call created the persona; false when it updated one.
    pub created: bool,
    pub charters: Vec<AppMasterCharterOutcome>,
    /// Recipe slugs whose charter this call suspended because the request no
    /// longer names them. Suspended, never deleted.
    pub suspended: Vec<String>,
    /// `None` when the manifest could not be seeded — see `notes`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub manifest_path: Option<String>,
    pub notes: Vec<String>,
    /// Questions this Architect has put to the operator that nobody has
    /// answered. Empty on the adopt path — an adoption has not woken yet, so it
    /// cannot have asked anything.
    #[serde(default)]
    pub open_asks: Vec<AppMasterOpenAsk>,
    /// The Architect's own last word: the newest coverage note its decision
    /// lane wrote. `None` when it has never decided.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub last_note: Option<String>,
}

// ---------------------------------------------------------------------------
// The operation
// ---------------------------------------------------------------------------

/// Adopt (or re-adopt) the Architect of one workspace. No Tauri and no HTTP in
/// sight — the command and the bridge route are both adapters over this.
pub fn adopt(pool: &DbPool, input: &AdoptArchitectInput) -> Result<ArchitectAdoption, AppError> {
    let workspace = resolve_workspace(pool, &input.workspace)?;
    let workspace_id = workspace.id.clone();
    let workspace_name = workspace.name.clone();
    let binding = Binding::Workspace(workspace);

    let done = adopt_bound(
        pool,
        AdoptedRole::Architect,
        &binding,
        &AdoptionOptions {
            recipes: &input.recipes,
            model: input.model.as_deref(),
            max_concurrent: input.max_concurrent,
            scope_rung: input.scope_rung,
            enabled: input.enabled,
            name: input.name.as_deref(),
        },
    )?;

    Ok(ArchitectAdoption {
        persona_id: done.persona_id,
        persona_name: done.persona_name,
        workspace_id,
        workspace_name,
        created: done.created,
        charters: done.charters,
        suspended: done.suspended,
        manifest_path: done.manifest_path,
        notes: done.notes,
        open_asks: Vec::new(),
        last_note: None,
    })
}

/// The current adoption state for a workspace: the Architect persona, its
/// recipe charters and their status. `None` when no persona is pinned to the
/// workspace under this door's naming.
pub fn current(pool: &DbPool, workspace: &str) -> Result<Option<ArchitectAdoption>, AppError> {
    let workspace = resolve_workspace(pool, workspace)?;
    let pinned = personas_repo::list_by_dev_workspace(pool, &workspace.id)?;
    let Some(persona) = pinned
        .into_iter()
        .find(|p| p.name.starts_with(ARCHITECT_NAME_PREFIX))
    else {
        return Ok(None);
    };
    let responsibilities = resp_repo::list_by_persona(pool, &persona.id, false)?;
    // From EVERY live charter, not only the recipe-backed ones the list below
    // keeps: the decision lane stamps its note on every charter it considered.
    let last_note = crate::engine::subscription::newest_coverage_note_for(&responsibilities);
    let charters: Vec<AppMasterCharterOutcome> = responsibilities
        .into_iter()
        .filter_map(|r| {
            let slug = r
                .spec
                .recipe_ref
                .as_ref()
                .map(|rr| rr.slug.trim().to_string())
                .filter(|s| !s.is_empty())?;
            Some(AppMasterCharterOutcome {
                id: r.id,
                slug,
                title: r.title,
                priority: r.spec.priority,
                status: r.status,
                created: false,
            })
        })
        .collect();
    let open_asks: Vec<AppMasterOpenAsk> =
        crate::engine::subscription::list_open_asks(pool, &persona.id)
            .into_iter()
            .map(|a| AppMasterOpenAsk {
                review_id: a.review_id,
                kind: a.kind,
                title: a.title,
                created_at: a.created_at,
            })
            .collect();
    let suspended: Vec<String> = charters
        .iter()
        .filter(|c| c.status == ResponsibilityStatus::Suspended.as_str())
        .map(|c| c.slug.clone())
        .collect();
    // Read-only: the path is reported only when the file already exists, so a
    // GET never seeds a manifest as a side effect.
    let manifest_path = manifest::read(&persona.id)
        .and(manifest::manifest_path(&persona.id).ok())
        .map(|p| p.to_string_lossy().to_string());
    Ok(Some(ArchitectAdoption {
        persona_id: persona.id,
        persona_name: persona.name,
        workspace_id: workspace.id,
        workspace_name: workspace.name,
        created: false,
        charters,
        suspended,
        manifest_path,
        notes: Vec::new(),
        open_asks,
        last_note,
    }))
}

// ---------------------------------------------------------------------------
// The Tauri command (adapter)
// ---------------------------------------------------------------------------

/// Adopt an Architect for a registered workspace. The UI door onto the same
/// operation the `/dev-tools/architect/adopt` bridge route exposes.
#[tauri::command]
pub async fn adopt_architect(
    state: State<'_, Arc<AppState>>,
    input: AdoptArchitectInput,
) -> Result<ArchitectAdoption, AppError> {
    require_auth(&state).await?;
    let db = state.db.clone();
    // The handle is bound and awaited, so a panic inside the blocking task
    // reaches the caller as a `JoinError` turned into an `AppError` — not as a
    // task that vanishes while the command reports success.
    let handle = tokio::task::spawn_blocking(move || adopt(&db, &input));
    handle
        .await
        .map_err(|e| AppError::Internal(format!("adopt_architect: task failed: {e}")))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::companion::brain::test_home::TestHome;
    use crate::db::models::{CreateRecipeInput, DevWorkspace};
    use crate::db::repos::dev_workspaces as workspaces_repo;
    use crate::db::repos::resources::recipes as recipes_repo;
    use personas_db::init_test_db;

    /// A minimal but VALID v3 recipe payload, seeded through the recipes repo
    /// so the row is the production shape.
    fn seed_recipe(pool: &DbPool, slug: &str, title: &str) {
        let payload = serde_json::json!({
            "id": format!("rec-{slug}"),
            "slug": slug,
            "title": title,
            "status": "draft",
            "domain": "software_engineering",
            "description": {
                "need": "The portfolio drifts from the design nobody re-read.",
                "input": "The design and the workspace as it stands.",
                "coreAction": "Decide where the seams of the system fall.",
                "output": "A living solution design with a revision history."
            },
            "activities": [
                {"id": "a1", "label": "Read the portfolio", "kind": "observe"},
                {"id": "a2", "label": "Decide the seams", "kind": "decide"},
                {"id": "a3", "label": "Write the design", "kind": "deliver"}
            ],
            "guidance": "Judge what is there, not what you would have drawn.",
            "connectorTypes": ["knowledge_base"],
            "recommendedTrigger": {"kind": "self_paced", "rationale": "No external clock."}
        });
        recipes_repo::create(
            pool,
            CreateRecipeInput {
                credential_id: None,
                use_case_id: None,
                name: title.to_string(),
                description: None,
                category: None,
                prompt_template: payload.to_string(),
                input_schema: None,
                output_contract: None,
                tool_requirements: None,
                credential_requirements: None,
                model_preference: None,
                sample_inputs: None,
                tags: None,
                icon: None,
                color: None,
                source_template_id: None,
                source_use_case_id: None,
                source_use_case_name: None,
                source_version: None,
            },
        )
        .expect("seed recipe");
    }

    fn seed_workspace(pool: &DbPool) -> DevWorkspace {
        workspaces_repo::create_workspace(pool, "Bank", None, Some("The simulation"), false)
            .expect("seed workspace")
    }

    fn request(workspace: &str, slugs: &[&str]) -> AdoptArchitectInput {
        AdoptArchitectInput {
            workspace: workspace.to_string(),
            recipes: slugs
                .iter()
                .map(|s| AppMasterRecipeRequest {
                    slug: (*s).to_string(),
                    priority: None,
                })
                .collect(),
            model: None,
            max_concurrent: None,
            scope_rung: None,
            enabled: None,
            name: None,
        }
    }

    #[test]
    fn adopting_twice_creates_one_architect_bound_to_the_workspace() {
        // `adopt` seeds the persona's manifest on disk, and the brain root is
        // a process-global env var — take the one shared lock.
        let _home = TestHome::new("architect_adopt");
        let pool = init_test_db().expect("test db");
        let ws = seed_workspace(&pool);
        seed_recipe(&pool, "enterprise-solution-design", "Solution design");
        seed_recipe(&pool, "workforce-planning", "Workforce planning");

        let body = request(
            &ws.id,
            &["enterprise-solution-design", "workforce-planning"],
        );
        let first = adopt(&pool, &body).expect("first adoption");
        assert!(first.created);
        assert_eq!(first.workspace_id, ws.id);
        assert_eq!(first.persona_name, "Architect Bank");
        assert_eq!(first.charters.len(), 2);

        let held = resp_repo::list_by_persona(&pool, &first.persona_id, true).expect("charters");
        assert_eq!(held.len(), 2);
        assert!(
            held.iter()
                .all(|r| r.workspace_id.as_deref() == Some(ws.id.as_str())),
            "every charter binds to the workspace"
        );
        assert!(
            held.iter().all(|r| r.project_id.is_none()),
            "and to no project — validate refuses both"
        );
        assert!(
            held.iter().all(|r| r.cadence.attention_enabled),
            "every charter is enrolled in the attention loop"
        );
        // P5: authority on every charter, canHire on workforce-planning only.
        assert!(held.iter().all(|r| r.spec.authority == Some(true)));
        let hiring = held
            .iter()
            .find(|r| {
                r.spec.recipe_ref.as_ref().map(|rr| rr.slug.as_str()) == Some("workforce-planning")
            })
            .expect("the hiring charter");
        assert_eq!(hiring.spec.can_hire, Some(true));
        let designing = held
            .iter()
            .find(|r| {
                r.spec.recipe_ref.as_ref().map(|rr| rr.slug.as_str())
                    == Some("enterprise-solution-design")
            })
            .expect("the design charter");
        assert_eq!(
            designing.spec.can_hire, None,
            "an unadopted grant stays absent, never false"
        );
        // The Architect reaches no `codebase` connector: it has no project pin
        // for that builtin to resolve.
        assert!(
            held.iter()
                .all(|r| !r.connectors.iter().any(|c| c == "codebase")),
            "the Architect binds no codebase connector"
        );

        // Idempotent, and resolvable by workspace NAME as well as id.
        let second = adopt(&pool, &request("Bank", &["enterprise-solution-design"]))
            .expect("second adoption");
        assert!(!second.created);
        assert_eq!(second.persona_id, first.persona_id);
        assert_eq!(second.suspended, vec!["workforce-planning".to_string()]);
        let after = resp_repo::list_by_persona(&pool, &first.persona_id, true).expect("charters");
        assert_eq!(after.len(), 2, "the dropped charter still exists");

        // The state route reads the same persona back.
        let state = current(&pool, &ws.id)
            .expect("state")
            .expect("an Architect");
        assert_eq!(state.persona_id, first.persona_id);
        assert_eq!(state.workspace_name, "Bank");
        assert_eq!(state.charters.len(), 2);
        assert_eq!(state.suspended, vec!["workforce-planning".to_string()]);
    }

    #[test]
    fn an_unknown_workspace_is_refused_and_writes_nothing() {
        let _home = TestHome::new("architect_adopt");
        let pool = init_test_db().expect("test db");
        seed_recipe(&pool, "enterprise-solution-design", "Solution design");

        let err = adopt(
            &pool,
            &request("no-such-workspace", &["enterprise-solution-design"]),
        )
        .expect_err("an unknown workspace is refused");
        assert!(
            matches!(err, AppError::Validation(ref m) if m.contains("no-such-workspace")),
            "the refusal names the workspace: {err}"
        );
        assert!(
            personas_repo::get_all(&pool).expect("personas").is_empty(),
            "nothing was written"
        );
        // And the state route refuses the same way rather than answering `None`.
        assert!(matches!(
            current(&pool, "no-such-workspace"),
            Err(AppError::Validation(_))
        ));
    }

    #[test]
    fn a_workspace_with_no_architect_reads_as_none() {
        let _home = TestHome::new("architect_adopt");
        let pool = init_test_db().expect("test db");
        let ws = seed_workspace(&pool);
        assert!(current(&pool, &ws.id).expect("state").is_none());
    }
}
