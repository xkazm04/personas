use rusqlite::{params, OptionalExtension};

use crate::db::models::{
    CreateManualReviewInput, CreatePersonaMemoryInput, CreateReviewMessageInput,
    CreateTeamMemoryInput, Json, LearnedMemoryRef, ManualReviewCounts, ManualReviewStatus,
    PersonaManualReview, ReviewMessage,
};
use crate::db::repos::core::memories;
use crate::db::repos::resources::team_memories;
use crate::db::repos::utils::collect_rows;
use crate::db::DbPool;
use crate::error::AppError;

fn row_to_review(row: &rusqlite::Row) -> rusqlite::Result<PersonaManualReview> {
    Ok(PersonaManualReview {
        id: row.get("id")?,
        execution_id: row.get("execution_id")?,
        persona_id: row.get("persona_id")?,
        title: row.get("title")?,
        description: row.get("description")?,
        severity: row.get("severity")?,
        context_data: row.get("context_data")?,
        suggested_actions: row.get("suggested_actions")?,
        status: ManualReviewStatus::from_db(&row.get::<_, String>("status")?),
        reviewer_notes: row.get("reviewer_notes")?,
        resolved_at: row.get("resolved_at")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
        use_case_id: row.get::<_, Option<String>>("use_case_id").unwrap_or(None),
        assignment_id: row.get::<_, Option<String>>("assignment_id").unwrap_or(None),
        step_id: row.get::<_, Option<String>>("step_id").unwrap_or(None),
    })
}

row_mapper!(row_to_message -> ReviewMessage {
    id, review_id, role, content, metadata, created_at,
});

crud_get_by_id!(
    PersonaManualReview,
    "persona_manual_reviews",
    "Manual review",
    row_to_review
);

pub fn create(
    pool: &DbPool,
    input: CreateManualReviewInput,
) -> Result<PersonaManualReview, AppError> {
    timed_query!("manual_reviews", "manual_reviews::create", {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let severity = input.severity.unwrap_or_else(|| "info".to_string());

        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO persona_manual_reviews
             (id, execution_id, persona_id, title, description, severity, status,
              context_data, suggested_actions, created_at, updated_at, use_case_id,
              assignment_id, step_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending', ?7, ?8, ?9, ?9, ?10, ?11, ?12)",
            params![
                id,
                input.execution_id,
                input.persona_id,
                input.title,
                input.description,
                severity,
                input.context_data,
                input.suggested_actions,
                now,
                input.use_case_id,
                input.assignment_id,
                input.step_id,
            ],
        )?;

        get_by_id(pool, &id)
    })
}

/// Resolve the team step `(assignment_id, step_id)` an execution belongs to, if
/// any (Phase 1 resume loop). Returns `None` for standalone (non-team) runs.
pub fn get_team_step_by_execution(
    pool: &DbPool,
    execution_id: &str,
) -> Result<Option<(String, String)>, AppError> {
    let conn = pool.get()?;
    let row = conn
        .query_row(
            "SELECT assignment_id, id FROM team_assignment_steps
             WHERE execution_id = ?1 LIMIT 1",
            params![execution_id],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
        )
        .optional()?;
    Ok(row)
}

pub fn get_by_persona(
    pool: &DbPool,
    persona_id: &str,
    status: Option<&str>,
) -> Result<Vec<PersonaManualReview>, AppError> {
    timed_query!("manual_reviews", "manual_reviews::get_by_persona", {
        let conn = pool.get()?;

        if let Some(status_filter) = status {
            let mut stmt = conn.prepare(
                "SELECT * FROM persona_manual_reviews
                 WHERE persona_id = ?1 AND status = ?2
                 ORDER BY created_at DESC",
            )?;
            let rows = stmt.query_map(params![persona_id, status_filter], row_to_review)?;
            Ok(collect_rows(
                rows,
                "manual_reviews::get_by_persona(filtered)",
            ))
        } else {
            let mut stmt = conn.prepare(
                "SELECT * FROM persona_manual_reviews
                 WHERE persona_id = ?1
                 ORDER BY created_at DESC",
            )?;
            let rows = stmt.query_map(params![persona_id], row_to_review)?;
            Ok(collect_rows(rows, "manual_reviews::get_by_persona"))
        }
    })
}

pub fn get_all(pool: &DbPool, status: Option<&str>) -> Result<Vec<PersonaManualReview>, AppError> {
    timed_query!("manual_reviews", "manual_reviews::get_all", {
        let conn = pool.get()?;

        if let Some(status_filter) = status {
            let mut stmt = conn.prepare(
                "SELECT * FROM persona_manual_reviews
                 WHERE status = ?1
                 ORDER BY created_at DESC",
            )?;
            let rows = stmt.query_map(params![status_filter], row_to_review)?;
            Ok(collect_rows(rows, "manual_reviews::get_all(filtered)"))
        } else {
            let mut stmt = conn.prepare(
                "SELECT * FROM persona_manual_reviews
                 ORDER BY created_at DESC",
            )?;
            let rows = stmt.query_map([], row_to_review)?;
            Ok(collect_rows(rows, "manual_reviews::get_all"))
        }
    })
}

/// Fetch recently resolved (approved/rejected/resolved) reviews for a persona.
///
/// Used by the runner to inject prior review decisions into the next execution
/// so the agent can learn from past human feedback.
///
/// The lookback window is measured against `resolved_at` — the moment the human
/// actually acted — not `created_at`. A review opened 30 days ago and approved
/// yesterday is *fresh* feedback and must reach the learning loop; windowing on
/// `created_at` would silently drop exactly the long-lived reviews a human
/// finally got around to. `COALESCE(resolved_at, created_at)` keeps any legacy
/// rows that were marked terminal before `resolved_at` was populated.
///
/// - `days`: lookback window in days
/// - `limit`: max number of reviews to return
pub fn get_recent_resolved(
    pool: &DbPool,
    persona_id: &str,
    days: i64,
    limit: i64,
) -> Result<Vec<PersonaManualReview>, AppError> {
    timed_query!("manual_reviews", "manual_reviews::get_recent_resolved", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM persona_manual_reviews
             WHERE persona_id = ?1
               AND status IN ('approved', 'rejected', 'resolved')
               AND (julianday('now') - julianday(COALESCE(resolved_at, created_at))) <= ?2
             ORDER BY COALESCE(resolved_at, created_at) DESC
             LIMIT ?3",
        )?;
        let rows = stmt.query_map(params![persona_id, days, limit], row_to_review)?;
        Ok(collect_rows(rows, "manual_reviews::get_recent_resolved"))
    })
}

/// Fetch reviews attributed to a specific capability (use case) on a persona.
/// Phase C5 — capability-scoped review queue.
pub fn get_by_use_case_id(
    pool: &DbPool,
    persona_id: &str,
    use_case_id: &str,
    status: Option<&str>,
) -> Result<Vec<PersonaManualReview>, AppError> {
    timed_query!("manual_reviews", "manual_reviews::get_by_use_case_id", {
        let conn = pool.get()?;

        if let Some(status_filter) = status {
            let mut stmt = conn.prepare(
                "SELECT * FROM persona_manual_reviews
                 WHERE persona_id = ?1 AND use_case_id = ?2 AND status = ?3
                 ORDER BY created_at DESC",
            )?;
            let rows = stmt.query_map(
                params![persona_id, use_case_id, status_filter],
                row_to_review,
            )?;
            Ok(collect_rows(
                rows,
                "manual_reviews::get_by_use_case_id(filtered)",
            ))
        } else {
            let mut stmt = conn.prepare(
                "SELECT * FROM persona_manual_reviews
                 WHERE persona_id = ?1 AND use_case_id = ?2
                 ORDER BY created_at DESC",
            )?;
            let rows = stmt.query_map(params![persona_id, use_case_id], row_to_review)?;
            Ok(collect_rows(rows, "manual_reviews::get_by_use_case_id"))
        }
    })
}

/// Delete every review attached to an execution. Phase C5b — used by the
/// engine to cleanse reviews that were emitted by the LLM before a technical
/// failure (auth/network/provider/timeout) cut the run short. Returns the
/// number of rows deleted.
pub fn delete_for_execution(pool: &DbPool, execution_id: &str) -> Result<usize, AppError> {
    timed_query!("manual_reviews", "manual_reviews::delete_for_execution", {
        let conn = pool.get()?;
        let count = conn.execute(
            "DELETE FROM persona_manual_reviews WHERE execution_id = ?1",
            params![execution_id],
        )? as usize;
        Ok(count)
    })
}

/// Hard-delete ALL manual reviews. FK child `review_messages` cascades.
/// Returns the number of rows deleted.
pub fn delete_all(pool: &DbPool) -> Result<usize, AppError> {
    timed_query!("manual_reviews", "manual_reviews::delete_all", {
        let conn = pool.get()?;
        let count = conn.execute("DELETE FROM persona_manual_reviews", [])? as usize;
        Ok(count)
    })
}

pub fn get_by_execution(
    pool: &DbPool,
    execution_id: &str,
) -> Result<Vec<PersonaManualReview>, AppError> {
    timed_query!("manual_reviews", "manual_reviews::get_by_execution", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM persona_manual_reviews
             WHERE execution_id = ?1
             ORDER BY created_at DESC",
        )?;
        let rows = stmt.query_map(params![execution_id], row_to_review)?;
        Ok(collect_rows(rows, "manual_reviews::get_by_execution"))
    })
}

pub fn update_status(
    pool: &DbPool,
    id: &str,
    status: ManualReviewStatus,
    reviewer_notes: Option<String>,
) -> Result<Option<LearnedMemoryRef>, AppError> {
    timed_query!("manual_reviews", "manual_reviews::update_status", {
        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;

        // Fetch current status and validate the transition
        let current = get_by_id(pool, id)?;
        current
            .status
            .validate_transition(status)
            .map_err(AppError::Validation)?;

        let resolved_at = match status {
            ManualReviewStatus::Approved
            | ManualReviewStatus::Rejected
            | ManualReviewStatus::Resolved => Some(now.clone()),
            ManualReviewStatus::Pending => None,
        };

        // Atomic + idempotent flip: the `AND status = ?6` predicate makes the
        // transition a single-winner compare-and-swap. Two callers that both read
        // `Pending` (user vs. Athena, double-click, two windows) interleave between
        // the get_by_id above and this UPDATE; without the predicate both report 1
        // row affected and BOTH re-fire react_to_review_decision (re-resume the held
        // step, re-dispatch the follow-up run). With it only the first commits; the
        // loser gets 0 rows and its error short-circuits the duplicate side effects.
        let expected = current.status.as_str();
        let rows = conn.execute(
            "UPDATE persona_manual_reviews
             SET status = ?1,
                 reviewer_notes = COALESCE(?2, reviewer_notes),
                 resolved_at = COALESCE(?3, resolved_at),
                 updated_at = ?4
             WHERE id = ?5 AND status = ?6",
            params![status.as_str(), reviewer_notes, resolved_at, now, id, expected],
        )?;

        if rows == 0 {
            // get_by_id above succeeded, so the row exists — a 0-row flip means a
            // concurrent caller already resolved it. Surface a benign error that the
            // command layer's `?` turns into "someone else won; don't re-fire".
            return Err(AppError::Validation(format!(
                "Manual review {id} was already resolved by a concurrent action"
            )));
        }

        // Surfaced reference to whatever the learning loop wrote (Phase 2).
        let mut learned: Option<LearnedMemoryRef> = None;

        // Learning loop: a resolved (approved/rejected) review IS human feedback.
        // Phase-1 structured shared memory (docs/tests/autonomy-eval/structured-shared-memory-design.md):
        // when the persona belongs to a team, route the feedback to the SHARED,
        // bounded, evictable team ledger (L2) as a typed decision/constraint —
        // approved → `decision`, rejected → `constraint` — so it's one shared record
        // the whole team reads, not N per-persona dupes (the measured bloat). Dedup
        // by (team_id, title) to avoid repeats. When the persona has no team, fall
        // back to the per-persona `learned` memory (L1). Best-effort throughout.
        if matches!(
            status,
            ManualReviewStatus::Approved | ManualReviewStatus::Rejected
        ) {
            let verdict = status.as_str();
            let notes = reviewer_notes
                .as_deref()
                .map(str::trim)
                .filter(|n| !n.is_empty());
            let content = format!(
                "Human {verdict} the review \"{}\"{}.{} Apply this decision to future work.",
                current.title,
                current
                    .description
                    .as_deref()
                    .map(|d| format!(": {d}"))
                    .unwrap_or_default(),
                notes
                    .map(|n| format!(" Reviewer notes: {n}."))
                    .unwrap_or_default(),
            );
            // Resolve the persona's team (home_team_id) for shared routing.
            let home_team_id: Option<String> = conn
                .query_row(
                    "SELECT home_team_id FROM personas WHERE id = ?1",
                    params![current.persona_id],
                    |r| r.get::<_, Option<String>>(0),
                )
                .unwrap_or(None);

            if let Some(team_id) = home_team_id.filter(|s| !s.is_empty()) {
                let title = format!("Human {verdict}: {}", current.title);
                // Dedup by (team_id, title) — don't pile up repeats in the ledger.
                let exists: bool = conn
                    .query_row(
                        "SELECT 1 FROM team_memories WHERE team_id = ?1 AND title = ?2 LIMIT 1",
                        params![team_id, title],
                        |_| Ok(true),
                    )
                    .unwrap_or(false);
                if !exists {
                    // approved → settled decision; rejected → guardrail constraint
                    let (category, importance) = match status {
                        ManualReviewStatus::Rejected => ("constraint", 8),
                        _ => ("decision", 7),
                    };
                    let learned_title = title.clone();
                    let learned_team_id = team_id.clone();
                    let tm = CreateTeamMemoryInput {
                        team_id,
                        run_id: None,
                        member_id: None,
                        persona_id: Some(current.persona_id.clone()),
                        title,
                        content,
                        category: Some(category.to_string()),
                        importance: Some(importance),
                        tags: Some(format!("human-review,{verdict}")),
                    };
                    match team_memories::create(pool, tm) {
                        Ok(m) => {
                            learned = Some(LearnedMemoryRef {
                                id: m.id,
                                scope: "team".into(),
                                category: category.to_string(),
                                title: learned_title,
                                team_id: Some(learned_team_id),
                                persona_id: current.persona_id.clone(),
                            });
                        }
                        Err(e) => {
                            tracing::warn!(review_id = %id, error = %e, "learning loop: failed to write shared team decision/constraint");
                        }
                    }
                }
            } else {
                // Solo persona (no team) — keep the per-persona learned memory.
                let learned_title = format!("Human {verdict}: {}", current.title);
                let mem = CreatePersonaMemoryInput {
                    persona_id: current.persona_id.clone(),
                    title: learned_title.clone(),
                    content,
                    category: Some("learned".to_string()),
                    source_execution_id: Some(current.execution_id.clone()),
                    importance: Some(5),
                    tags: Some(Json(vec!["human-review".to_string(), verdict.to_string()])),
                    use_case_id: current.use_case_id.clone(),
                };
                match memories::create(pool, mem) {
                    Ok(m) => {
                        learned = Some(LearnedMemoryRef {
                            id: m.id,
                            scope: "persona".into(),
                            category: "learned".into(),
                            title: learned_title,
                            team_id: None,
                            persona_id: current.persona_id.clone(),
                        });
                    }
                    Err(e) => {
                        tracing::warn!(review_id = %id, error = %e, "learning loop: failed to synthesize learned memory from resolved review");
                    }
                }
            }
        }

        Ok(learned)
    })
}

/// A-grade Phase 8 (2026-05-04) — GC-resolved row representation.
///
/// Returned from [`gc_stale_pending`] so the caller can write one
/// `policy_events` audit row per resolution. Carries just enough fields
/// to build the audit entry; we don't use the full `PersonaManualReview`
/// to keep the SQL tight (SELECT id+execution_id+persona_id+use_case_id
/// only).
pub struct StaleReviewResolution {
    pub id: String,
    pub execution_id: String,
    pub persona_id: String,
    pub use_case_id: Option<String>,
    pub created_at: String,
}

/// A-grade Phase 8 — auto-resolve `pending` reviews older than `cutoff`.
///
/// Returns the rows that were resolved so callers can emit audit
/// entries. Idempotent: re-running with the same cutoff returns 0
/// rows the second time. Single-transaction: either every match is
/// flipped or none are. Caller is responsible for the audit-log fan-out
/// (we don't do it inline so the repo stays free of policy_events
/// dependency — that's a higher-level concern).
///
/// Reviewer notes are set to a sentinel string the UI can detect to
/// label the row as auto-resolved rather than user-actioned.
pub fn gc_stale_pending(
    pool: &DbPool,
    cutoff_iso: &str,
) -> Result<Vec<StaleReviewResolution>, AppError> {
    timed_query!("manual_reviews", "manual_reviews::gc_stale_pending", {
        let now = chrono::Utc::now().to_rfc3339();
        let mut conn = pool.get()?;
        let tx = conn.transaction()?;

        let resolved: Vec<StaleReviewResolution> = {
            let mut stmt = tx.prepare(
                "SELECT id, execution_id, persona_id, use_case_id, created_at
                 FROM persona_manual_reviews
                 WHERE status = 'pending' AND created_at < ?1",
            )?;
            let rows = stmt.query_map(params![cutoff_iso], |row| {
                Ok(StaleReviewResolution {
                    id: row.get("id")?,
                    execution_id: row.get("execution_id")?,
                    persona_id: row.get("persona_id")?,
                    use_case_id: row.get::<_, Option<String>>("use_case_id").unwrap_or(None),
                    created_at: row.get("created_at")?,
                })
            })?;
            collect_rows(rows, "manual_reviews::gc_stale_pending")
        };

        if resolved.is_empty() {
            tx.commit()?;
            return Ok(resolved);
        }

        // Flip every match in a single statement so the count matches
        // the SELECT above (no concurrent writer can sneak in between).
        // The reviewer_notes sentinel is matched by the frontend to
        // tag the row visually as "auto-aged-out".
        tx.execute(
            "UPDATE persona_manual_reviews
             SET status = 'resolved',
                 reviewer_notes = COALESCE(reviewer_notes, '') ||
                                  CASE WHEN COALESCE(reviewer_notes, '') = ''
                                       THEN 'Auto-resolved: stale > GC threshold'
                                       ELSE ' (auto-resolved: stale > GC threshold)'
                                  END,
                 resolved_at = ?1,
                 updated_at = ?1
             WHERE status = 'pending' AND created_at < ?2",
            params![now, cutoff_iso],
        )?;

        tx.commit()?;
        tracing::info!(
            count = resolved.len(),
            cutoff = %cutoff_iso,
            "Auto-resolved stale pending reviews"
        );
        Ok(resolved)
    })
}

pub fn get_pending_count(pool: &DbPool, persona_id: Option<&str>) -> Result<i64, AppError> {
    timed_query!("manual_reviews", "manual_reviews::get_pending_count", {
        let conn = pool.get()?;

        if let Some(pid) = persona_id {
            let count: i64 = conn.query_row(
                "SELECT COUNT(*) FROM persona_manual_reviews
                 WHERE status = 'pending' AND persona_id = ?1",
                params![pid],
                |row| row.get(0),
            )?;
            Ok(count)
        } else {
            let count: i64 = conn.query_row(
                "SELECT COUNT(*) FROM persona_manual_reviews WHERE status = 'pending'",
                [],
                |row| row.get(0),
            )?;
            Ok(count)
        }
    })
}

/// Keyset-paginated manual reviews, newest-first.
///
/// `cursor` is the `(created_at, id)` of the last row of the previous page.
/// Pages cost O(`limit`) regardless of scroll depth and stay stable under
/// concurrent inserts — the scalability backbone for the reviews queue,
/// replacing the unbounded `get_all` fetch. Returns the page rows plus
/// whether more rows exist beyond them.
pub fn list_page(
    pool: &DbPool,
    persona_id: Option<&str>,
    status: Option<&str>,
    cursor: Option<(&str, &str)>,
    limit: i64,
) -> Result<(Vec<PersonaManualReview>, bool), AppError> {
    timed_query!("manual_reviews", "manual_reviews::list_page", {
        let conn = pool.get()?;
        // Fetch one extra row to detect whether a further page exists.
        let fetch = limit.max(1) + 1;

        let mut sql = String::from("SELECT * FROM persona_manual_reviews WHERE 1 = 1");
        let mut binds: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
        if let Some(pid) = persona_id {
            sql.push_str(" AND persona_id = ?");
            binds.push(Box::new(pid.to_string()));
        }
        if let Some(st) = status {
            sql.push_str(" AND status = ?");
            binds.push(Box::new(st.to_string()));
        }
        if let Some((c_created, c_id)) = cursor {
            // Newest-first keyset: rows strictly "older" than the cursor,
            // with `id` as the tie-break for rows sharing a `created_at`.
            sql.push_str(" AND (created_at < ? OR (created_at = ? AND id < ?))");
            binds.push(Box::new(c_created.to_string()));
            binds.push(Box::new(c_created.to_string()));
            binds.push(Box::new(c_id.to_string()));
        }
        sql.push_str(" ORDER BY created_at DESC, id DESC LIMIT ?");
        binds.push(Box::new(fetch));

        let mut stmt = conn.prepare(&sql)?;
        let param_refs: Vec<&dyn rusqlite::ToSql> = binds.iter().map(|b| b.as_ref()).collect();
        let rows = stmt.query_map(rusqlite::params_from_iter(param_refs), row_to_review)?;
        let mut collected = collect_rows(rows, "manual_reviews::list_page");

        let has_more = collected.len() as i64 > limit;
        if has_more {
            collected.truncate(limit as usize);
        }
        Ok((collected, has_more))
    })
}

/// Status-bucketed review counts via a single `GROUP BY` query — the L0
/// (skeleton) layer. Cheap regardless of table size; never loads row data.
pub fn counts(pool: &DbPool, persona_id: Option<&str>) -> Result<ManualReviewCounts, AppError> {
    timed_query!("manual_reviews", "manual_reviews::counts", {
        let conn = pool.get()?;
        let mut counts = ManualReviewCounts {
            total: 0,
            pending: 0,
            approved: 0,
            rejected: 0,
            resolved: 0,
        };
        let mut apply = |status: &str, n: i64| {
            counts.total += n;
            match status {
                "pending" => counts.pending = n,
                "approved" => counts.approved = n,
                "rejected" => counts.rejected = n,
                "resolved" => counts.resolved = n,
                _ => {}
            }
        };
        if let Some(pid) = persona_id {
            let mut stmt = conn.prepare(
                "SELECT status, COUNT(*) FROM persona_manual_reviews
                 WHERE persona_id = ?1 GROUP BY status",
            )?;
            let rows =
                stmt.query_map(params![pid], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?;
            for row in rows {
                let (status, n) = row?;
                apply(&status, n);
            }
        } else {
            let mut stmt = conn
                .prepare("SELECT status, COUNT(*) FROM persona_manual_reviews GROUP BY status")?;
            let rows =
                stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?;
            for row in rows {
                let (status, n) = row?;
                apply(&status, n);
            }
        }
        drop(apply);
        Ok(counts)
    })
}

// -- Review Messages ---------------------------------------------

pub fn create_message(
    pool: &DbPool,
    input: CreateReviewMessageInput,
) -> Result<ReviewMessage, AppError> {
    timed_query!("manual_reviews", "manual_reviews::create_message", {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO review_messages (id, review_id, role, content, metadata, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                id,
                input.review_id,
                input.role,
                input.content,
                input.metadata,
                now
            ],
        )?;

        conn.query_row(
            "SELECT * FROM review_messages WHERE id = ?1",
            params![id],
            row_to_message,
        )
        .map_err(AppError::Database)
    })
}

pub fn list_messages(pool: &DbPool, review_id: &str) -> Result<Vec<ReviewMessage>, AppError> {
    timed_query!("manual_reviews", "manual_reviews::list_messages", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM review_messages WHERE review_id = ?1 ORDER BY created_at ASC",
        )?;
        let rows = stmt.query_map(params![review_id], row_to_message)?;
        Ok(collect_rows(rows, "review_messages::list"))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init_test_db;
    use crate::db::models::CreatePersonaInput;
    use crate::db::repos::{core::personas, execution::executions};

    fn setup_persona_and_execution(pool: &DbPool) -> (String, String) {
        let persona = personas::create(
            pool,
            CreatePersonaInput {
                name: "Review Test Agent".into(),
                system_prompt: "You are a test agent.".into(),
                project_id: None,
                description: None,
                structured_prompt: None,
                icon: None,
                color: None,
                enabled: Some(true),
                max_concurrent: None,
                timeout_ms: None,
                model_profile: None,
                max_budget_usd: None,
                max_turns: None,
                design_context: None,
                notification_channels: None,
            },
        )
        .unwrap();

        let exec = executions::create(pool, &persona.id, None, None, None, None).unwrap();
        (persona.id, exec.id)
    }

    #[test]
    fn test_manual_review_crud() {
        let pool = init_test_db().unwrap();
        let (persona_id, execution_id) = setup_persona_and_execution(&pool);

        // Create review
        let review = create(
            &pool,
            CreateManualReviewInput {
                execution_id: execution_id.clone(),
                persona_id: persona_id.clone(),
                title: "Check output quality".into(),
                description: Some("Review the generated output".into()),
                severity: Some("warning".into()),
                context_data: Some(r#"{"key":"value"}"#.into()),
                suggested_actions: Some("Verify manually".into()),
                use_case_id: None,
            },
        )
        .unwrap();
        assert_eq!(review.status, ManualReviewStatus::Pending);
        assert_eq!(review.severity, "warning");
        assert_eq!(review.title, "Check output quality");
        assert_eq!(review.persona_id, persona_id);
        assert_eq!(review.execution_id, execution_id);

        // Get by id
        let fetched = get_by_id(&pool, &review.id).unwrap();
        assert_eq!(fetched.id, review.id);

        // Get by persona
        let by_persona = get_by_persona(&pool, &persona_id, None).unwrap();
        assert_eq!(by_persona.len(), 1);

        // Get by persona with status filter
        let pending = get_by_persona(&pool, &persona_id, Some("pending")).unwrap();
        assert_eq!(pending.len(), 1);
        let resolved = get_by_persona(&pool, &persona_id, Some("resolved")).unwrap();
        assert_eq!(resolved.len(), 0);

        // Get by execution
        let by_exec = get_by_execution(&pool, &execution_id).unwrap();
        assert_eq!(by_exec.len(), 1);

        // Get pending count
        let count = get_pending_count(&pool, Some(&persona_id)).unwrap();
        assert_eq!(count, 1);
        let count_all = get_pending_count(&pool, None).unwrap();
        assert_eq!(count_all, 1);

        // Update status
        update_status(
            &pool,
            &review.id,
            ManualReviewStatus::Approved,
            Some("Looks good".into()),
        )
        .unwrap();
        let updated = get_by_id(&pool, &review.id).unwrap();
        assert_eq!(updated.status, ManualReviewStatus::Approved);
        assert_eq!(updated.reviewer_notes, Some("Looks good".into()));
        assert!(
            updated.resolved_at.is_some(),
            "resolved_at should be set when status is resolved"
        );

        // Pending count should now be 0
        let count_after = get_pending_count(&pool, Some(&persona_id)).unwrap();
        assert_eq!(count_after, 0);
    }

    #[test]
    fn test_manual_review_default_severity() {
        let pool = init_test_db().unwrap();
        let (persona_id, execution_id) = setup_persona_and_execution(&pool);

        let review = create(
            &pool,
            CreateManualReviewInput {
                execution_id,
                persona_id,
                title: "Simple review".into(),
                description: None,
                severity: None,
                context_data: None,
                suggested_actions: None,
                use_case_id: None,
            },
        )
        .unwrap();
        assert_eq!(review.severity, "info");
    }

    #[test]
    fn test_manual_review_not_found() {
        let pool = init_test_db().unwrap();
        let result = get_by_id(&pool, "nonexistent");
        assert!(result.is_err());
    }

    /// Backdate a review's `created_at` (and optionally `resolved_at`) and mark
    /// it `approved` so it qualifies for `get_recent_resolved`. Lets us exercise
    /// the lookback window without waiting real days.
    fn set_review_timestamps(
        pool: &DbPool,
        review_id: &str,
        created_at: &str,
        resolved_at: Option<&str>,
    ) {
        let conn = pool.get().unwrap();
        conn.execute(
            "UPDATE persona_manual_reviews
             SET status = 'approved', created_at = ?1, resolved_at = ?2
             WHERE id = ?3",
            params![created_at, resolved_at, review_id],
        )
        .unwrap();
    }

    fn create_pending_review(pool: &DbPool, persona_id: &str, execution_id: &str) -> String {
        create(
            pool,
            CreateManualReviewInput {
                execution_id: execution_id.to_string(),
                persona_id: persona_id.to_string(),
                title: "Lookback review".into(),
                description: None,
                severity: None,
                context_data: None,
                suggested_actions: None,
                use_case_id: None,
            },
        )
        .unwrap()
        .id
    }

    /// An RFC3339 timestamp `days_ago` before the real current time. Relative to
    /// `now()` so the lookback assertions stay stable whenever the test is run
    /// (the query measures against `julianday('now')`).
    fn days_ago(days: i64) -> String {
        (chrono::Utc::now() - chrono::Duration::days(days)).to_rfc3339()
    }

    /// A review opened long ago but resolved *recently* is fresh human feedback
    /// and must fall inside the lookback window. Before the fix the window keyed
    /// off `created_at`, so these long-lived-then-just-resolved reviews — exactly
    /// the ones a human finally acted on — never reached the learning loop.
    #[test]
    fn test_recent_resolved_windows_on_resolved_at() {
        let pool = init_test_db().unwrap();
        let (persona_id, execution_id) = setup_persona_and_execution(&pool);

        // Created 30 days ago, resolved 1 day ago.
        let id = create_pending_review(&pool, &persona_id, &execution_id);
        set_review_timestamps(&pool, &id, &days_ago(30), Some(&days_ago(1)));

        // 7-day window: excluded if filtering on created_at, included on resolved_at.
        let within = get_recent_resolved(&pool, &persona_id, 7, 5).unwrap();
        assert_eq!(
            within.len(),
            1,
            "review resolved yesterday must be inside a 7-day window even though it was created 30 days ago"
        );
        assert_eq!(within[0].id, id);
    }

    /// A review both created and resolved long ago stays outside the window.
    #[test]
    fn test_recent_resolved_excludes_old_resolution() {
        let pool = init_test_db().unwrap();
        let (persona_id, execution_id) = setup_persona_and_execution(&pool);

        let id = create_pending_review(&pool, &persona_id, &execution_id);
        set_review_timestamps(&pool, &id, &days_ago(60), Some(&days_ago(50)));

        let within = get_recent_resolved(&pool, &persona_id, 7, 5).unwrap();
        assert!(
            within.is_empty(),
            "review resolved 50 days ago must be outside a 7-day window"
        );
    }

    /// Legacy rows that reached a terminal status before `resolved_at` was
    /// populated fall back to `created_at` via COALESCE rather than vanishing.
    #[test]
    fn test_recent_resolved_coalesce_fallback_to_created_at() {
        let pool = init_test_db().unwrap();
        let (persona_id, execution_id) = setup_persona_and_execution(&pool);

        let id = create_pending_review(&pool, &persona_id, &execution_id);
        // Move to a terminal status, then null out resolved_at to simulate a
        // legacy row, keeping a recent created_at.
        update_status(&pool, &id, ManualReviewStatus::Resolved, None).unwrap();
        set_review_timestamps(&pool, &id, &days_ago(1), None);

        let within = get_recent_resolved(&pool, &persona_id, 7, 5).unwrap();
        assert_eq!(
            within.len(),
            1,
            "terminal row with NULL resolved_at should fall back to created_at"
        );
        assert_eq!(within[0].id, id);
    }

    #[test]
    fn test_delete_all_reviews() {
        let pool = init_test_db().unwrap();
        let (persona_id, execution_id) = setup_persona_and_execution(&pool);

        for i in 0..2 {
            create(
                &pool,
                CreateManualReviewInput {
                    execution_id: execution_id.clone(),
                    persona_id: persona_id.clone(),
                    title: format!("Review {i}"),
                    description: None,
                    severity: None,
                    context_data: None,
                    suggested_actions: None,
                    use_case_id: None,
                },
            )
            .unwrap();
        }
        assert_eq!(get_pending_count(&pool, None).unwrap(), 2);

        let n = delete_all(&pool).unwrap();
        assert_eq!(n, 2);
        assert_eq!(get_pending_count(&pool, None).unwrap(), 0);
    }
}
