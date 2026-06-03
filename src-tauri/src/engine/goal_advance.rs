//! Goal advancement — turn a team's linked `dev_goal` into a running,
//! goal-linked `team_assignment` so the team actually *works* its goal.
//!
//! This is the initiator that closes the "has-goal / NOT-advancing" gap: it
//! builds an assignment **with `goal_id` set** (so step completions flow back as
//! `dev_goal_signals`, light the ▶ advancing badge, and feed the progress
//! resolver) and runs it on the orchestrator. The orchestrator's terminal hook
//! then checks off the worked to-dos + writes the goal's progress.
//!
//! **Step source is hybrid** (the user's call): if the goal has open to-dos
//! (`dev_goal_items`) we build the steps from them — one step per to-do, title
//! verbatim so the orchestrator's close-loop can check each off — honoring the
//! authored breakdown. If it has none, we fall back to LLM-decomposing the goal.
//!
//! Three callers share this: the `advance_team_goal` command (button/manual),
//! Athena (via the team path), and the default-OFF autonomous tick
//! (`GoalAdvanceSubscription`). The one-active-assignment-per-goal guard here
//! protects all three from double-spawning.

use std::sync::Arc;

use tauri::AppHandle;

use crate::db::models::{CreateTeamAssignmentInput, CreateTeamAssignmentStepInput, Persona, PersonaTrustLevel};
use crate::db::repos::core::personas as persona_repo;
use crate::db::repos::dev_tools as dev_tools_repo;
use crate::db::repos::orchestration::team_assignments as assignment_repo;
use crate::db::repos::resources::teams as team_repo;
use crate::db::DbPool;
use crate::engine::team_assignment_matching as matching;
use crate::engine::team_assignment_orchestrator as orchestrator;
use crate::engine::ExecutionEngine;
use crate::error::AppError;

#[cfg(feature = "ml")]
use crate::engine::embedder::EmbeddingManager;
#[cfg(not(feature = "ml"))]
use crate::engine::team_assignment_matching::EmbeddingManager;

/// Decompose timeout (mirror of the composer's). One Sonnet call.
const DECOMPOSE_TIMEOUT_SECS: u64 = 120;

/// Outcome of an advance attempt.
pub enum AdvanceResult {
    /// A new goal-linked assignment was created + started.
    Started(String),
    /// An active assignment already advances this goal — left as-is.
    AlreadyAdvancing,
}

/// Build + run a goal-linked assignment for `goal_id` on `team_id`.
///
/// Returns `AlreadyAdvancing` (no-op) when a queued/running/awaiting-review
/// assignment for this goal already exists. Errors on: goal not found, no
/// eligible personas, or an empty decomposition.
pub async fn advance_goal(
    pool: &DbPool,
    app: &AppHandle,
    engine: Arc<ExecutionEngine>,
    embedding_manager: Option<Arc<EmbeddingManager>>,
    team_id: &str,
    goal_id: &str,
) -> Result<AdvanceResult, AppError> {
    let goal = dev_tools_repo::get_goal_by_id(pool, goal_id)?;

    // Guard: never double-advance a goal that's already being worked.
    let existing = assignment_repo::list_for_goal(pool, goal_id)?;
    if existing
        .iter()
        .any(|a| matches!(a.status.as_str(), "queued" | "running" | "awaiting_review"))
    {
        return Ok(AdvanceResult::AlreadyAdvancing);
    }

    // Eligible personas (same filter the orchestrator applies at run time).
    let members = team_repo::get_members(pool, team_id)?;
    let mut personas: Vec<Persona> = Vec::with_capacity(members.len());
    for m in &members {
        if let Ok(p) = persona_repo::get_by_id(pool, &m.persona_id) {
            if p.enabled
                && p.setup_status == "ready"
                && !matches!(p.trust_level, PersonaTrustLevel::Revoked)
            {
                personas.push(p);
            }
        }
    }
    if personas.is_empty() {
        return Err(AppError::Validation(
            "Team has no eligible personas to advance the goal".into(),
        ));
    }

    let goal_text = match goal.description.as_deref().map(str::trim).filter(|d| !d.is_empty()) {
        Some(d) => format!("{}\n{}", goal.title, d),
        None => goal.title.clone(),
    };

    // Hybrid step source: open to-dos first (honor the authored breakdown),
    // else LLM-decompose the goal.
    let open_items: Vec<_> = dev_tools_repo::list_goal_items(pool, goal_id)?
        .into_iter()
        .filter(|i| !i.done)
        .collect();

    // Both step sources chain LINEARLY: each step `depends_on` the previous
    // one. The SDLC pipeline a goal decomposes into is inherently ordered
    // (scope → implement → review → security → docs); without dependencies the
    // orchestrator launched every step at once, so reviewers/security/docs ran
    // before — or instead of — the implementation and concluded
    // `precondition_failed` against work that did not exist yet. A forward-only
    // chain makes the orchestrator gate each step on its predecessor.
    let chain_dep = |idx: usize| -> Option<Vec<i32>> {
        if idx == 0 {
            None
        } else {
            Some(vec![idx as i32 - 1])
        }
    };

    let steps: Vec<CreateTeamAssignmentStepInput> = if !open_items.is_empty() {
        open_items
            .iter()
            .enumerate()
            .map(|(idx, it)| CreateTeamAssignmentStepInput {
                // Title verbatim — the orchestrator's close-loop matches it to
                // check the to-do off when the step completes.
                title: it.title.clone(),
                description: Some(format!(
                    "Work toward the goal \"{}\": {}",
                    goal.title, it.title
                )),
                assigned_persona_id: None,
                assigned_use_case_id: None,
                depends_on_indices: chain_dep(idx),
            })
            .collect()
    } else {
        let candidates = matching::extract_candidates(&personas);
        let proposed = matching::decompose_goal(&goal_text, &candidates, DECOMPOSE_TIMEOUT_SECS).await?;
        if proposed.is_empty() {
            return Err(AppError::Internal(
                "Goal decomposition returned zero steps".into(),
            ));
        }
        proposed
            .into_iter()
            .enumerate()
            .map(|(idx, p)| CreateTeamAssignmentStepInput {
                title: p.title,
                description: if p.description.trim().is_empty() {
                    None
                } else {
                    Some(p.description)
                },
                assigned_persona_id: p.suggested_persona_id,
                assigned_use_case_id: p.suggested_use_case_id,
                depends_on_indices: chain_dep(idx),
            })
            .collect()
    };

    let input = CreateTeamAssignmentInput {
        team_id: team_id.to_string(),
        title: derive_advance_title(&goal.title),
        goal: goal_text,
        match_strategy: Some("llm_eval".into()),
        max_parallel_steps: Some(3),
        // `source` is CHECK-constrained to team_ui|athena|api — this initiator
        // (manual command + autonomous tick) is programmatic, so "api".
        source: Some("api".into()),
        companion_op_id: None,
        goal_id: Some(goal_id.to_string()),
        steps,
    };
    let assignment = assignment_repo::create(pool, input)?;

    orchestrator::run_assignment(
        Arc::new(pool.clone()),
        app.clone(),
        engine,
        embedding_manager,
        assignment.id.clone(),
    );

    Ok(AdvanceResult::Started(assignment.id))
}

/// "Advance: <goal title>" trimmed to a readable assignment-row length.
fn derive_advance_title(goal_title: &str) -> String {
    let base = format!("Advance: {}", goal_title.trim());
    if base.chars().count() <= 70 {
        base
    } else {
        let truncated: String = base.chars().take(67).collect();
        format!("{truncated}…")
    }
}
