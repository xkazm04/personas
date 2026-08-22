use crate::models::WorkspaceKnowledge;
use crate::DbPool;
use personas_core::error::AppError;
use rusqlite::params;
use std::collections::HashMap;

use super::adoption::{is_actionable_kind, set_adoption};
use super::knowledge::get_knowledge_by_id;

/// The finding origin every materialized practice idea carries. Also its
/// `scan_type`, so the Sensor Scoreboard groups them like any other sensor.
pub const PRACTICE_ORIGIN: &str = "workspace_practice";

/// How much of a practice's `detail_md` is carried into the idea description.
/// The idea seeds a task prompt, not an archive — the full record stays in the
/// library, one click away.
const PRACTICE_DETAIL_BUDGET: usize = 2_000;

/// Stable, project-agnostic dedup key for a practice's materialized ideas.
/// `create_finding` dedups per `(project_id, dedup_key)`, so the SAME key in
/// every member repo is exactly right: one idea per project, and re-adopting
/// (or re-joining) never stacks a second.
pub fn practice_dedup_key(practice_id: &str) -> String {
    format!("workspace_practice:{practice_id}")
}

/// Truncate on a char boundary, appending an ellipsis when anything was cut.
pub(super) fn truncate_chars(s: &str, budget: usize) -> String {
    if s.chars().count() <= budget {
        return s.to_string();
    }
    let mut out: String = s.chars().take(budget).collect();
    out.push('…');
    out
}

/// Turn one adopted practice into the work each named project owes: one
/// `dev_idea` per project, through the idempotent `create_finding` door
/// (project-scoped `(project_id, dedup_key)` dedup), so this is safe to call
/// on every adopt, every join, and from the startup backfill.
///
/// MUST be called POST-COMMIT — `create_finding` takes its own pooled
/// connection and publishes `signal.raised` on the bus; calling it inside an
/// open transaction would deadlock the pool on a single-connection build and
/// announce work that a rollback could still erase.
///
/// Returns how many ideas were actually inserted (already-present ones count 0).
pub fn materialize_practice_ideas(
    pool: &DbPool,
    practice: &WorkspaceKnowledge,
    project_ids: &[String],
) -> Result<u32, AppError> {
    if !is_actionable_kind(&practice.kind) || project_ids.is_empty() {
        return Ok(0);
    }

    let title = match practice.kind.as_str() {
        "pitfall" => format!("Fix workspace pitfall: {}", practice.title),
        _ => format!("Adopt workspace practice: {}", practice.title),
    };
    let description = match practice.detail_md.as_deref().map(str::trim) {
        Some(d) if !d.is_empty() => format!(
            "{}\n\n{}",
            practice.statement.trim(),
            truncate_chars(d, PRACTICE_DETAIL_BUDGET)
        ),
        _ => practice.statement.trim().to_string(),
    };
    let category = crate::models::IdeaCategory::from_token(&practice.kind)
        .unwrap_or(crate::models::DEFAULT_IDEA_CATEGORY);
    let evidence = serde_json::json!({
        "practice_id": practice.id,
        "workspace_id": practice.workspace_id,
        "kind": practice.kind,
        "topic": practice.topic,
        "adopted_at": practice.decided_at.clone().unwrap_or_else(|| practice.updated_at.clone()),
    })
    .to_string();
    // Confidence is the only signal the library carries about how strongly the
    // practice is believed; effort and risk are unknown until someone looks at
    // the repo, and inventing them would poison the triage value score.
    let impact = practice
        .confidence
        .map(|c| ((c * 5.0).round() as i32).clamp(1, 5));
    let dedup_key = practice_dedup_key(&practice.id);

    let mut created = 0u32;
    for project_id in project_ids {
        match crate::repos::dev_tools::create_finding(
            pool,
            project_id,
            PRACTICE_ORIGIN,
            &title,
            Some(&description),
            Some(category.as_str()),
            None,
            None,
            Some(&evidence),
            &dedup_key,
            None,
            impact,
            None,
        ) {
            Ok(Some(_)) => created += 1,
            Ok(None) => {}
            // Best-effort per project: one unwritable repo row must not abort
            // the fan-out to its siblings.
            Err(e) => tracing::warn!(
                practice_id = %practice.id,
                project_id = %project_id,
                error = %e,
                "workspace practice materialization failed for one project"
            ),
        }
    }
    Ok(created)
}

/// Projects whose adoption cell for this practice sits in the execution queue
/// (`to_process`) — i.e. exactly the ones that owe the work. `na` (doesn't
/// apply), `dispatched`/`adopted` (already handled) and `diverged` (a human
/// said no) are all deliberately excluded.
pub fn to_process_projects(pool: &DbPool, practice_id: &str) -> Result<Vec<String>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT project_id FROM workspace_practice_adoption
         WHERE practice_id = ?1 AND state = 'to_process'",
    )?;
    let rows = stmt.query_map(params![practice_id], |r| r.get::<_, String>(0))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(AppError::Database)
}

/// Materialize every `to_process` cell of one practice. The single entry point
/// the adopt branch, the join branch and the backfill all share.
pub fn materialize_pending_for_practice(pool: &DbPool, practice_id: &str) -> Result<u32, AppError> {
    let practice = get_knowledge_by_id(pool, practice_id)?;
    if practice.status != "adopted" || !is_actionable_kind(&practice.kind) {
        return Ok(0);
    }
    let projects = to_process_projects(pool, practice_id)?;
    materialize_practice_ideas(pool, &practice, &projects)
}

/// Retire the ideas a practice put into member backlogs when the practice
/// itself is deprecated or rejected. Only `pending` rows are touched: work a
/// human already accepted (or rejected) keeps its own verdict, and the
/// `archived` row retains the dedup key so re-adoption cannot stack a second
/// copy (documented consequence — plan §"Open questions").
pub fn archive_practice_ideas(pool: &DbPool, practice_id: &str) -> Result<u32, AppError> {
    let now = chrono::Utc::now().to_rfc3339();
    let conn = pool.get()?;
    let rows = crate::repos::dev::ideas::archive_pending_by_origin_and_dedup_key(
        &conn,
        &now,
        PRACTICE_ORIGIN,
        &practice_dedup_key(practice_id),
    )?;
    Ok(rows as u32)
}

/// Startup / on-demand reconciler: every `to_process` cell joined to an adopted
/// actionable practice gets its idea. Idempotent and cheap when there is
/// nothing to do (one indexed join, then the `create_finding` dedup gate), so
/// it is safe to run on every boot. This is what heals a cell seeded before
/// materialization existed, or one whose post-commit fan-out lost a race.
pub fn backfill_practice_ideas(pool: &DbPool) -> Result<u32, AppError> {
    let pairs: Vec<(String, String)> = {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT a.practice_id, a.project_id
             FROM workspace_practice_adoption a
             JOIN workspace_knowledge k ON k.id = a.practice_id
             WHERE a.state = 'to_process' AND k.status = 'adopted'
               AND k.kind IN ('pitfall','pattern')
             ORDER BY a.practice_id",
        )?;
        let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
        rows.collect::<Result<Vec<_>, _>>()?
    };
    if pairs.is_empty() {
        return Ok(0);
    }

    let mut by_practice: HashMap<String, Vec<String>> = HashMap::new();
    for (practice_id, project_id) in pairs {
        by_practice.entry(practice_id).or_default().push(project_id);
    }

    let mut created = 0u32;
    for (practice_id, project_ids) in by_practice {
        match get_knowledge_by_id(pool, &practice_id) {
            Ok(practice) => created += materialize_practice_ideas(pool, &practice, &project_ids)?,
            Err(e) => {
                tracing::warn!(practice_id = %practice_id, error = %e, "backfill: practice unreadable")
            }
        }
    }
    Ok(created)
}

// ============================================================================
// Lifecycle sync — idea verdict / task outcome → adoption cell
// ============================================================================

/// Read the `practice_id` back out of a materialized idea's evidence blob.
/// Returns None for any idea that is not a practice materialization, so
/// callers can treat "not ours" and "malformed" identically.
pub fn practice_id_from_evidence(origin: Option<&str>, evidence: Option<&str>) -> Option<String> {
    if origin != Some(PRACTICE_ORIGIN) {
        return None;
    }
    let parsed: serde_json::Value = serde_json::from_str(evidence?).ok()?;
    parsed
        .get("practice_id")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

/// Keep the adoption matrix honest when a materialized idea gets a verdict.
///
/// Rejecting the idea IS the project saying "we're not doing this" — the cell
/// becomes `diverged` (with the rejection reason as its note), which is the
/// state the library already renders as an explicit, reviewable exception.
/// Accepting changes nothing: the cell moves on `dispatched` (task created)
/// and `adopted` (task completed), which are facts about work, not intent.
///
/// Best-effort — mirrors `record_idea_decision`'s posture: the verdict is the
/// source of truth, the matrix is a projection, and a projection failure must
/// never fail the verdict.
pub fn sync_practice_adoption(pool: &DbPool, idea: &crate::models::DevIdea) {
    if idea.status != "rejected" {
        return;
    }
    let (Some(practice_id), Some(project_id)) = (
        practice_id_from_evidence(idea.origin.as_deref(), idea.evidence.as_deref()),
        idea.project_id.as_deref(),
    ) else {
        return;
    };
    let note = idea
        .rejection_reason
        .as_deref()
        .filter(|r| !r.trim().is_empty())
        .map(|r| format!("backlog rejected: {r}"))
        .unwrap_or_else(|| "backlog rejected".to_string());
    if let Err(e) = set_adoption(
        pool,
        &practice_id,
        project_id,
        "diverged",
        Some(&note),
        None,
    ) {
        tracing::warn!(
            idea_id = %idea.id,
            practice_id = %practice_id,
            error = %e,
            "workspace adoption sync failed (idea rejected)"
        );
    }
}

/// Move a materialized idea's adoption cell in response to a TASK lifecycle
/// event (`dispatched` on creation, `adopted` on success, back to `to_process`
/// on failure). Best-effort, same posture as [`sync_practice_adoption`].
pub fn sync_practice_adoption_for_task(
    pool: &DbPool,
    idea: &crate::models::DevIdea,
    state: &str,
    note: &str,
) {
    let (Some(practice_id), Some(project_id)) = (
        practice_id_from_evidence(idea.origin.as_deref(), idea.evidence.as_deref()),
        idea.project_id.as_deref(),
    ) else {
        return;
    };
    if let Err(e) = set_adoption(pool, &practice_id, project_id, state, Some(note), None) {
        tracing::warn!(
            idea_id = %idea.id,
            practice_id = %practice_id,
            state,
            error = %e,
            "workspace adoption sync failed (task lifecycle)"
        );
    }
}

// ============================================================================
// Ingest (machine-harvested candidates → observed) — Arc 2
// ============================================================================
