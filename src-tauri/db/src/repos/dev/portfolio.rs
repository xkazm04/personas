use super::goals::{
    create_goal_signal, get_goal_by_id, goal_status_is_ongoing, normalize_goal_status, row_to_goal,
    row_to_goal_item, update_goal,
};
use super::projects::list_projects;
use crate::models::{
    DevGoal, DevGoalDependency, DevGoalItem, PortfolioProjectSummary, PortfolioSummary,
};
use crate::DbPool;
use personas_core::error::AppError;
use rusqlite::params;
use std::collections::HashMap;

// ============================================================================
// Goals v2 — cross-project queries (Portfolio / Attention / Timeline / Map)
// ============================================================================

/// Every goal across all projects (project → order_index). Backs the Portfolio
/// + Timeline surfaces; the frontend joins with the project list it already holds.
pub fn list_all_goals(pool: &DbPool) -> Result<Vec<DevGoal>, AppError> {
    list_all_goals_filtered(pool, true, None)
}

/// Cross-project goal list with an optional completed-history window.
///
/// `include_completed = false` drops terminal statuses (`done` and aliases).
/// When completed are included, `completed_within_days` keeps only those whose
/// `completed_at` is inside that many days (ongoing rows always stay). `None`
/// means the full history — the previous unbounded behaviour.
pub fn list_all_goals_filtered(
    pool: &DbPool,
    include_completed: bool,
    completed_within_days: Option<i64>,
) -> Result<Vec<DevGoal>, AppError> {
    timed_query!("dev_goals", "dev_goals::list_all_goals", {
        let conn = pool.get()?;
        // Terminal aliases match `normalize_goal_status` / `goalStatus.ts`.
        const DONE: &str = "lower(trim(status)) IN ('done','completed','complete','skipped')";
        if !include_completed {
            let mut stmt = conn.prepare(&format!(
                "SELECT * FROM dev_goals WHERE NOT ({DONE}) ORDER BY project_id, order_index"
            ))?;
            let rows = stmt.query_map([], row_to_goal)?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(AppError::Database)
        } else if let Some(days) = completed_within_days.filter(|d| *d >= 0) {
            let window = format!("-{days} days");
            let mut stmt = conn.prepare(&format!(
                "SELECT * FROM dev_goals
                 WHERE NOT ({DONE})
                    OR (completed_at IS NOT NULL
                        AND datetime(completed_at) >= datetime('now', ?1))
                 ORDER BY project_id, order_index"
            ))?;
            let rows = stmt.query_map(params![window], row_to_goal)?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(AppError::Database)
        } else {
            let mut stmt =
                conn.prepare("SELECT * FROM dev_goals ORDER BY project_id, order_index")?;
            let rows = stmt.query_map([], row_to_goal)?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(AppError::Database)
        }
    })
}

/// First paragraph of a goal description, with the autonomous-provenance footer
/// (`\n\n---\n*Derived from KPI ...*`) stripped — the human-readable summary the
/// acceptance view shows under each goal title.
fn goal_summary(description: Option<String>) -> Option<String> {
    let d = description?;
    let head = d.split("\n---").next().unwrap_or(&d);
    let head = head.split("\n\n").next().unwrap_or(head);
    let s: String = head.trim().chars().take(200).collect();
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}

/// Enriched list of goals in `awaiting_acceptance` (the human-acceptance queue),
/// joined to project + the project's owning team + the KPI each serves. Backs
/// the Goal Acceptance view; flat so the frontend groups it by project → KPI.
pub fn list_pending_acceptance(
    pool: &DbPool,
) -> Result<Vec<crate::models::PendingAcceptanceGoal>, AppError> {
    timed_query!("dev_goals", "dev_goals::list_pending_acceptance", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT g.id, g.title, g.description, g.project_id, g.completed_at, g.kpi_id,
                    dp.name, dp.team_id, pt.name,
                    k.name, k.unit, k.current_value, k.target_value, k.baseline_value, k.direction
             FROM dev_goals g
             JOIN dev_projects dp ON dp.id = g.project_id
             LEFT JOIN persona_teams pt ON pt.id = dp.team_id
             LEFT JOIN dev_kpis k ON k.id = g.kpi_id
             WHERE g.status = 'awaiting_acceptance'
             ORDER BY dp.name, datetime(g.completed_at) DESC",
        )?;
        let rows = stmt.query_map([], |r| {
            let description: Option<String> = r.get(2)?;
            Ok(crate::models::PendingAcceptanceGoal {
                goal_id: r.get(0)?,
                title: r.get(1)?,
                summary: goal_summary(description),
                project_id: r.get(3)?,
                completed_at: r.get(4)?,
                kpi_id: r.get(5)?,
                project_name: r.get(6)?,
                team_id: r.get(7)?,
                team_name: r.get(8)?,
                kpi_name: r.get(9)?,
                kpi_unit: r.get(10)?,
                kpi_current: r.get(11)?,
                kpi_target: r.get(12)?,
                kpi_baseline: r.get(13)?,
                kpi_direction: r.get(14)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)
    })
}

/// Cheap count of goals awaiting acceptance — backs the TitleBar pending badge.
pub fn count_pending_acceptance(pool: &DbPool) -> Result<i64, AppError> {
    timed_query!("dev_goals", "dev_goals::count_pending_acceptance", {
        let conn = pool.get()?;
        let n: i64 = conn.query_row(
            "SELECT COUNT(*) FROM dev_goals WHERE status = 'awaiting_acceptance'",
            [],
            |r| r.get(0),
        )?;
        Ok(n)
    })
}

/// Every "a human must decide this" queue's pending count, in one round-trip.
///
/// The title-bar badge used to be `pending reviews + build questions` while the
/// deck it opens deals SEVEN kinds, so a reviewer with 26 pending ideas and
/// nothing else saw `0`. A number that is confidently wrong is worse than an
/// absent one, and six per-source round-trips on a poll is not a trade a badge
/// should make — hence one connection, six counts.
///
/// Build questions are deliberately absent: they live in the frontend's
/// `buildSessions` state (a halted CLI awaiting input), not in a table, so the
/// caller adds them. There is nothing here to query for them.
///
/// `u32`, not `i64`, and that is load-bearing: ts-rs maps `i64` to TypeScript
/// `bigint`, which the badge cannot add to the frontend-derived question count
/// without a conversion nothing else in the tray does. `TriageCounts` above made
/// the same choice for the same reason. A count is non-negative and will not
/// reach four billion.
#[derive(Debug, Clone, Default, serde::Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PendingCounts {
    pub goal_acceptance: u32,
    pub manual_reviews: u32,
    pub ideas: u32,
    pub policy_proposals: u32,
    pub promotion_proposals: u32,
    /// Open audit incidents: status `open` | `acknowledged` | `in_progress` -
    /// every non-terminal `IncidentStatus` (only `resolved` and `dismissed`
    /// are settled).
    pub open_incidents: u32,
    /// The subset of `open_incidents` at severity `critical` or `high`
    /// (decision tier 1). A subset, so it is never added to a total.
    pub blocking_incidents: u32,
    /// Persona reports with `is_read = 0` - the reports repo's own unread count.
    pub unread_reports: u32,
    /// Athena companion approvals awaiting a human: exactly what
    /// `companion_list_pending_approvals` returns (pending, inside the consent
    /// freshness window, well-formed, capped at its list limit). Filled in by
    /// the command layer, because the approvals live in the companion database.
    pub companion_approvals: u32,
    /// Council subjects a person can decide: derived state `ready` AND (tier
    /// `major` OR kind `architecture`), the frontend's `decidable()` rule over
    /// the council store's own `derive_council_state`.
    pub council_decidable: u32,
    /// `total` + open_incidents + unread_reports + companion_approvals +
    /// council_decidable (blocking_incidents is a subset, not added). Build
    /// questions and chat are added client-side.
    pub decision_total: u32,
    /// The five above. The caller adds build questions on top.
    pub total: u32,
}

impl PendingCounts {
    /// Fold in the companion-approval count, which only the command layer can
    /// read (it lives in the companion database, not this pool), and keep
    /// `decision_total` honest about it.
    pub fn with_companion_approvals(mut self, companion_approvals: u32) -> Self {
        self.companion_approvals = companion_approvals;
        self.decision_total = self.sum_decisions();
        self
    }

    /// The one place `decision_total` is computed, so the repo and the command
    /// layer cannot disagree about which sources it adds.
    fn sum_decisions(&self) -> u32 {
        self.total
            + self.open_incidents
            + self.unread_reports
            + self.companion_approvals
            + self.council_decidable
    }
}

/// THE council rule, mirrored from `councilRules.ts` `decidable()`: only a
/// `ready` subject that is a MAJOR feature or an architecture redesign reaches
/// a person. `machine_pass` is not waiting on anybody.
fn council_subject_is_decidable(state: &str, tier: Option<&str>, kind: &str) -> bool {
    state == "ready" && (tier == Some("major") || kind == "architecture")
}

/// Council subjects waiting on a person, with each state derived by the council
/// store's own [`council::derive_council_state`] over the same readers
/// [`council::list_subject_states`] feeds it (`latest_run`,
/// `standing_decision`). Not `list_subject_states` itself: that also reads
/// every run's verdicts and resolves registry subjects from disk per subject,
/// none of which a count needs.
fn count_council_decidable(pool: &DbPool) -> Result<u32, AppError> {
    use super::council;
    timed_query!(
        "dev_council_subjects",
        "pending_counts::council_decidable",
        {
            let subjects: Vec<(String, String, Option<String>, String)> = {
                let conn = pool.get()?;
                let mut stmt =
                    conn.prepare("SELECT id, kind, use_case_id, drift FROM dev_council_subjects")?;
                let rows = stmt.query_map([], |r| {
                    Ok((
                        r.get::<_, String>("id")?,
                        r.get::<_, String>("kind")?,
                        r.get::<_, Option<String>>("use_case_id")?,
                        r.get::<_, String>("drift")?,
                    ))
                })?;
                rows.collect::<Result<Vec<_>, _>>()?
            };

            let mut decidable = 0u32;
            for (id, kind, use_case_id, drift) in subjects {
                let Some(run) = council::latest_run(pool, &id)? else {
                    continue; // never councilled: state `none`, nobody to ask
                };
                let decision = council::standing_decision(pool, &id)?;
                // Same lookup as the council store's private `use_case_tier`: `None`
                // for an architecture subject (no feature, no tier) or a missing row.
                let tier: Option<String> = match use_case_id.as_deref() {
                    Some(uc) => pool
                        .get()?
                        .query_row(
                            "SELECT tier FROM dev_use_cases WHERE id = ?1",
                            params![uc],
                            |r| r.get::<_, String>("tier"),
                        )
                        .ok(),
                    None => None,
                };
                let state = council::derive_council_state(&council::CouncilStateInputs {
                    latest_outcome: Some(run.outcome.as_str()),
                    latest_run_id: Some(run.id.as_str()),
                    decision: decision.as_ref().map(|d| d.decision.as_str()),
                    decision_run_id: decision.as_ref().map(|d| d.run_id.as_str()),
                    tier: tier.as_deref(),
                    drift: &drift,
                });
                if council_subject_is_decidable(&state, tier.as_deref(), &kind) {
                    decidable += 1;
                }
            }
            Ok(decidable)
        }
    )
}

/// See {@link PendingCounts}. One pooled connection for the SQL counts; the
/// unread-report count is the reports repo's own function and the council count
/// is derived (see [`count_council_decidable`]). `companion_approvals` is 0 here;
/// the command layer folds it in via [`PendingCounts::with_companion_approvals`].
pub fn pending_counts(pool: &DbPool) -> Result<PendingCounts, AppError> {
    timed_query!("pending_counts", "pending_counts::all", {
        let mut counts = sql_pending_counts(pool)?;
        // After the pooled connection above is released: both of these take
        // their own, and the test pool holds only two.
        let unread = crate::repos::communication::reports::get_unread_count(pool)?;
        counts.unread_reports = u32::try_from(unread).unwrap_or(u32::MAX);
        counts.council_decidable = count_council_decidable(pool)?;
        counts.decision_total = counts.sum_decisions();
        Ok(counts)
    })
}

/// The plain-SQL counts, on one pooled connection.
fn sql_pending_counts(pool: &DbPool) -> Result<PendingCounts, AppError> {
    let conn = pool.get()?;
    let one = |sql: &str| -> Result<u32, AppError> { Ok(conn.query_row(sql, [], |r| r.get(0))?) };

    let goal_acceptance =
        one("SELECT COUNT(*) FROM dev_goals WHERE status = 'awaiting_acceptance'")?;
    // FOREIGN TABLE: persona_manual_reviews is owned by
    // `repos::communication::manual_reviews`. Read directly here so the badge is
    // one query; left as-is by the W1 split, to be routed through the owner later.
    let manual_reviews =
        one("SELECT COUNT(*) FROM persona_manual_reviews WHERE status = 'pending'")?;
    let ideas = one("SELECT COUNT(*) FROM dev_ideas WHERE status = 'pending'")?;
    // FOREIGN TABLE: policy_proposals is owned by
    // `repos::execution::policy_proposals`.
    let policy_proposals = one("SELECT COUNT(*) FROM policy_proposals WHERE status = 'pending'")?;
    // FOREIGN TABLE: evolution_promotion_proposals is owned by
    // `repos::lab::evolution_proposals`.
    let promotion_proposals =
        one("SELECT COUNT(*) FROM evolution_promotion_proposals WHERE status = 'pending'")?;
    // FOREIGN TABLE: audit_incidents is owned by
    // `repos::execution::audit_incidents`. "Open" is every non-terminal
    // `IncidentStatus` (open | acknowledged | in_progress) - wider than that
    // repo's `summary().open` chip, which counts the literal `open` status
    // only. Severity is stored normalized (`normalize_severity`); LOWER()
    // keeps a hand-written row from slipping past. `idx_ai_status` serves
    // the status filter.
    let (open_incidents, blocking_incidents): (u32, u32) = conn.query_row(
        "SELECT COUNT(*) AS open_n,
                    COALESCE(SUM(CASE WHEN LOWER(severity) IN ('critical', 'high')
                                      THEN 1 ELSE 0 END), 0) AS blocking_n
               FROM audit_incidents
              WHERE status IN ('open', 'acknowledged', 'in_progress')",
        [],
        |r| Ok((r.get("open_n")?, r.get("blocking_n")?)),
    )?;

    Ok(PendingCounts {
        total: goal_acceptance + manual_reviews + ideas + policy_proposals + promotion_proposals,
        goal_acceptance,
        manual_reviews,
        ideas,
        policy_proposals,
        promotion_proposals,
        open_incidents,
        blocking_incidents,
        ..PendingCounts::default()
    })
}

/// Resolve a pending-acceptance goal. `accept` → `done` (off-board, completion
/// stamp kept) + a `goal_accepted` signal. Reject → `in-progress` (back to the
/// team's lane) with the completion stamp cleared + a `goal_rejected` signal
/// carrying the user's comment (the feedback the team reworks against).
pub fn resolve_goal_acceptance(
    pool: &DbPool,
    goal_id: &str,
    accept: bool,
    comment: Option<&str>,
) -> Result<DevGoal, AppError> {
    let goal = get_goal_by_id(pool, goal_id)?;
    if normalize_goal_status(&goal.status) != "awaiting_acceptance" {
        return Err(AppError::Validation(format!(
            "goal {goal_id} is not awaiting acceptance (status: {})",
            goal.status
        )));
    }
    if accept {
        let updated = update_goal(
            pool,
            goal_id,
            None,
            None,
            Some("done"),
            None,
            None,
            None,
            None,
            None,
            None,
        )?;
        let _ = create_goal_signal(
            pool,
            goal_id,
            "goal_accepted",
            None,
            None,
            Some("Accepted by the user."),
        );
        Ok(updated)
    } else {
        // Reject → back to the team; clear the completion stamp.
        let updated = update_goal(
            pool,
            goal_id,
            None,
            None,
            Some("in-progress"),
            None,
            None,
            None,
            None,
            Some(None),
            None,
        )?;
        let msg = comment
            .map(|c| format!("Sent back: {c}"))
            .unwrap_or_else(|| "Sent back to the team.".into());
        let _ = create_goal_signal(pool, goal_id, "goal_rejected", None, None, Some(&msg));
        Ok(updated)
    }
}

/// All dependency edges whose goal lives in the given project — one query
/// instead of the per-goal fan-out the Map used in v1.
pub fn list_goal_dependencies_for_project(
    pool: &DbPool,
    project_id: &str,
) -> Result<Vec<DevGoalDependency>, AppError> {
    timed_query!(
        "dev_goal_dependencies",
        "dev_goal_dependencies::list_for_project",
        {
            let conn = pool.get()?;
            let mut stmt = conn.prepare(
                "SELECT d.id, d.goal_id, d.depends_on_id, d.dependency_type, d.created_at
                 FROM dev_goal_dependencies d
                 JOIN dev_goals g ON g.id = d.goal_id
                 WHERE g.project_id = ?1",
            )?;
            let rows = stmt
                .query_map(params![project_id], |row| {
                    Ok(DevGoalDependency {
                        id: row.get("id")?,
                        goal_id: row.get("goal_id")?,
                        depends_on_id: row.get("depends_on_id")?,
                        dependency_type: row.get("dependency_type")?,
                        created_at: row.get("created_at")?,
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(rows)
        }
    )
}

/// Every checklist item across one project's goals — one query instead of the
/// per-goal fan-out the Board would otherwise do for ~100 cards. Ordered by
/// goal then order_index so the frontend can group by `goal_id` in a single pass.
pub fn list_goal_items_for_project(
    pool: &DbPool,
    project_id: &str,
) -> Result<Vec<DevGoalItem>, AppError> {
    timed_query!("dev_goal_items", "dev_goal_items::list_for_project", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT i.id, i.goal_id, i.title, i.done, i.order_index, i.created_at, i.updated_at
             FROM dev_goal_items i
             JOIN dev_goals g ON g.id = i.goal_id
             WHERE g.project_id = ?1
             ORDER BY i.goal_id, i.order_index",
        )?;
        let rows = stmt.query_map(params![project_id], row_to_goal_item)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)
    })
}

/// Cross-project health rollup. One pass over all goals + projects — no N+1.
/// `at_risk` = ongoing goals that are overdue (target_date past) or stalled
/// (untouched ≥ 7 days, by `updated_at`, and not already overdue).
pub fn portfolio_summary(pool: &DbPool) -> Result<PortfolioSummary, AppError> {
    let projects = list_projects(pool, None)?;
    let goals = list_all_goals(pool)?;
    let now = chrono::Utc::now();
    let today_date = now.date_naive();
    let stale_before = (now - chrono::Duration::days(7)).to_rfc3339();

    // Accumulator per project, seeded so projects with zero goals still appear.
    struct Acc {
        name: String,
        team_id: Option<String>,
        total: i32,
        open: i32,
        in_progress: i32,
        blocked: i32,
        done: i32,
        overdue: i32,
        stalled: i32,
        progress_sum: i64,
    }
    let mut acc: HashMap<String, Acc> = HashMap::new();
    for p in &projects {
        acc.insert(
            p.id.clone(),
            Acc {
                name: p.name.clone(),
                team_id: p.team_id.clone(),
                total: 0,
                open: 0,
                in_progress: 0,
                blocked: 0,
                done: 0,
                overdue: 0,
                stalled: 0,
                progress_sum: 0,
            },
        );
    }

    for g in &goals {
        let Some(a) = acc.get_mut(&g.project_id) else {
            continue;
        };
        a.total += 1;
        a.progress_sum += g.progress as i64;
        match normalize_goal_status(&g.status) {
            "in-progress" => a.in_progress += 1,
            "blocked" => a.blocked += 1,
            "done" => a.done += 1,
            _ => a.open += 1,
        }
        if goal_status_is_ongoing(&g.status) {
            // `target_date` is an opaque caller-supplied string -- commonly a
            // date-only "2026-07-10" from a date picker, but a lexicographic
            // compare against a full RFC3339 `now_s` flags "due today" as
            // already overdue from 00:00 (refactor-bughunt-2026-07-10 repos#5).
            // Compare on the date portion only (the first 10 chars of either
            // shape are always YYYY-MM-DD) against today's date.
            let overdue = g.target_date.as_deref().is_some_and(|d| {
                let date_part = d.get(0..10).unwrap_or(d);
                chrono::NaiveDate::parse_from_str(date_part, "%Y-%m-%d")
                    .map(|target| target < today_date)
                    .unwrap_or(false)
            });
            if overdue {
                a.overdue += 1;
            } else if g.updated_at.as_str() < stale_before.as_str() {
                a.stalled += 1;
            }
        }
    }

    let mut summaries: Vec<PortfolioProjectSummary> = acc
        .into_iter()
        .map(|(id, a)| PortfolioProjectSummary {
            project_id: id,
            project_name: a.name,
            team_id: a.team_id,
            total: a.total,
            open: a.open,
            in_progress: a.in_progress,
            blocked: a.blocked,
            done: a.done,
            at_risk: a.overdue + a.stalled,
            overdue: a.overdue,
            avg_progress: if a.total > 0 {
                (a.progress_sum / a.total as i64) as i32
            } else {
                0
            },
        })
        .collect();
    // Busiest projects first; at-risk breaks ties so trouble floats up.
    summaries.sort_by(|x, y| {
        y.total
            .cmp(&x.total)
            .then(y.at_risk.cmp(&x.at_risk))
            .then(x.project_name.cmp(&y.project_name))
    });

    let total_goals: i32 = summaries.iter().map(|s| s.total).sum();
    let progress_total: i64 = goals.iter().map(|g| g.progress as i64).sum();
    Ok(PortfolioSummary {
        total_open: summaries.iter().map(|s| s.open).sum(),
        total_in_progress: summaries.iter().map(|s| s.in_progress).sum(),
        total_blocked: summaries.iter().map(|s| s.blocked).sum(),
        total_done: summaries.iter().map(|s| s.done).sum(),
        total_at_risk: summaries.iter().map(|s| s.at_risk).sum(),
        avg_progress: if total_goals > 0 {
            (progress_total / total_goals as i64) as i32
        } else {
            0
        },
        total_goals,
        projects: summaries,
    })
}

#[cfg(test)]
mod pending_counts_tests {
    use super::*;
    use crate::repos::dev::goals::create_goal;
    use crate::repos::dev::projects::create_project;

    /// The badge's whole purpose is that the number equals what the deck will
    /// deal. These assert the two ways that can silently stop being true: a
    /// source counting a settled row, and `total` drifting from its parts.
    #[test]
    fn counts_only_rows_that_still_owe_a_human_a_decision() {
        let pool = crate::init_test_db().unwrap();
        let project = create_project(&pool, "P", "/tmp/pc", None, None, None, None, None).unwrap();

        // Two awaiting acceptance, one already settled.
        create_goal(
            &pool,
            &project.id,
            "A",
            None,
            None,
            Some("awaiting_acceptance"),
            None,
            None,
        )
        .unwrap();
        create_goal(
            &pool,
            &project.id,
            "B",
            None,
            None,
            Some("awaiting_acceptance"),
            None,
            None,
        )
        .unwrap();
        create_goal(
            &pool,
            &project.id,
            "C",
            None,
            None,
            Some("done"),
            None,
            None,
        )
        .unwrap();

        let counts = pending_counts(&pool).unwrap();
        assert_eq!(
            counts.goal_acceptance, 2,
            "a done goal is not awaiting anyone"
        );
        assert_eq!(
            counts.total,
            counts.goal_acceptance
                + counts.manual_reviews
                + counts.ideas
                + counts.policy_proposals
                + counts.promotion_proposals,
            "total must be the sum of its parts, or the badge lies about which queue is full",
        );
    }

    #[test]
    fn an_empty_database_counts_zero_rather_than_erroring() {
        // Every source is queried unconditionally, so a fresh install must not
        // fail the badge on a table that happens to be empty.
        let pool = crate::init_test_db().unwrap();
        let counts = pending_counts(&pool).unwrap();
        assert_eq!(counts.total, 0);
        assert_eq!(counts.promotion_proposals, 0);
        assert_eq!(counts.open_incidents, 0);
        assert_eq!(counts.unread_reports, 0);
        assert_eq!(counts.council_decidable, 0);
        assert_eq!(counts.decision_total, 0);
    }

    fn incident(pool: &DbPool, source_id: &str, severity: &str, title: &str) -> String {
        use crate::models::CreateAuditIncidentInput;
        crate::repos::execution::audit_incidents::promote(
            pool,
            CreateAuditIncidentInput {
                source_table: "fired_alerts".into(),
                source_id: source_id.into(),
                persona_id: None,
                persona_name: None,
                execution_id: None,
                severity: severity.into(),
                kind: "test".into(),
                title: title.into(),
                detail: None,
            },
        )
        .unwrap()
        .unwrap()
    }

    /// Every non-terminal incident is open; only critical/high are blocking,
    /// and blocking is a subset that `decision_total` does not add twice.
    #[test]
    fn open_incidents_are_the_non_terminal_ones_and_blocking_is_their_high_subset() {
        use crate::repos::execution::audit_incidents as incidents;
        let pool = crate::init_test_db().unwrap();

        incident(&pool, "a-1", "critical", "Critical open");
        let high = incident(&pool, "a-2", "high", "High acknowledged");
        incidents::acknowledge(&pool, &high).unwrap();
        let medium = incident(&pool, "a-3", "medium", "Medium in progress");
        incidents::start_progress(&pool, &medium).unwrap();
        let resolved = incident(&pool, "a-4", "high", "High resolved");
        incidents::resolve(&pool, &resolved, None).unwrap();
        let dismissed = incident(&pool, "a-5", "critical", "Critical dismissed");
        incidents::dismiss(&pool, &dismissed, None).unwrap();

        let counts = pending_counts(&pool).unwrap();
        assert_eq!(
            counts.open_incidents, 3,
            "open + acknowledged + in_progress; resolved and dismissed are settled"
        );
        assert_eq!(
            counts.blocking_incidents, 2,
            "a high incident counts in both open and blocking; medium is not blocking"
        );
        assert_eq!(counts.decision_total, counts.total + 3);
    }

    #[test]
    fn a_read_report_is_not_counted() {
        use crate::models::CreateReportInput;
        use crate::repos::communication::reports;
        let pool = crate::init_test_db().unwrap();
        let persona_id = crate::repos::test_fixtures::create_test_persona_id(
            &pool,
            "Pending Counts Persona",
            "You are a test persona.",
        );
        let report = |title: &str| {
            reports::create(
                &pool,
                CreateReportInput {
                    persona_id: persona_id.clone(),
                    execution_id: None,
                    title: Some(title.into()),
                    content: format!("{title} body"),
                    content_type: None,
                    priority: None,
                    metadata: None,
                    thread_id: None,
                    use_case_id: None,
                },
            )
            .unwrap()
        };
        report("Unread one");
        report("Unread two");
        let read = report("Already read");
        reports::mark_as_read(&pool, &read.id).unwrap();

        let counts = pending_counts(&pool).unwrap();
        assert_eq!(counts.unread_reports, 2);
        assert_eq!(counts.decision_total, counts.total + 2);
    }

    fn council_run(subject_id: &str, round: i32, outcome: &str) -> super::super::council::NewRun {
        super::super::council::NewRun {
            subject_id: subject_id.to_string(),
            round_no: round,
            supersedes_run_id: None,
            rubric_version: "feature-v1".into(),
            trust_state: "uncalibrated".into(),
            outcome: outcome.into(),
            overall: Some(0.7),
            coverage: 1.0,
            head_sha: "abc".into(),
            span_digest: "dig".into(),
            spanned_paths_json: "[]".into(),
            hard_failures_json: "[]".into(),
            must_address_json: "[]".into(),
            summary: "s".into(),
            run_dir: format!("/runs/{subject_id}/{round}"),
            started_at: None,
            finished_at: Some("2026-10-01T00:00:00Z".into()),
        }
    }

    /// Decidable = derived `ready` AND (major OR architecture). Each excluded
    /// subject below is excluded for a different reason.
    #[test]
    fn council_decidable_matches_the_derived_rule() -> Result<(), AppError> {
        use super::super::council;
        use crate::repos::dev::use_cases::create_use_case;
        let pool = crate::init_test_db().unwrap();
        let project = create_project(&pool, "P", "/tmp/pcc", None, None, None, None, None).unwrap();
        let use_case = |name: &str, tier: &str| -> Result<String, AppError> {
            let uc = create_use_case(
                &pool,
                &project.id,
                name,
                None,
                "capability",
                None,
                &[],
                Some("active"),
                "scan",
                None,
            )?;
            pool.get()?.execute(
                "UPDATE dev_use_cases SET tier = ?1 WHERE id = ?2",
                params![tier, uc.id],
            )?;
            Ok(uc.id)
        };
        let subject = |kind: &str, slug: &str, uc: Option<&str>| {
            council::upsert_subject(&pool, &project.id, kind, slug, slug, uc)
                .unwrap()
                .0
                .id
        };

        // 1. Major feature, ready -> decidable.
        let major = use_case("Major ready", "major")?;
        let s = subject("use_case", "major-ready", Some(&major));
        council::insert_run(&pool, &council_run(&s, 1, "ready"), &[]).unwrap();

        // 2. Architecture, ready -> decidable (no tier at all).
        let s = subject("architecture", "arch-ready", None);
        council::insert_run(&pool, &council_run(&s, 1, "ready"), &[]).unwrap();

        // 3. Standard feature, ready -> machine_pass, nobody's decision.
        let standard = use_case("Standard ready", "standard")?;
        let s = subject("use_case", "standard-ready", Some(&standard));
        council::insert_run(&pool, &council_run(&s, 1, "ready"), &[]).unwrap();

        // 4. Major feature, ready, but rejected on that same run -> decided.
        let major2 = use_case("Major rejected", "major")?;
        let s = subject("use_case", "major-rejected", Some(&major2));
        let run = council::insert_run(&pool, &council_run(&s, 1, "ready"), &[]).unwrap();
        council::insert_decision(&pool, &s, &run.id, "rejected", Some("no"), "dig").unwrap();

        // 5. Never councilled -> `none`.
        subject("architecture", "never-run", None);

        let counts = pending_counts(&pool).unwrap();
        assert_eq!(counts.council_decidable, 2);
        assert_eq!(counts.decision_total, counts.total + 2);
        Ok(())
    }

    #[test]
    fn companion_approvals_fold_into_the_decision_total() {
        let pool = crate::init_test_db().unwrap();
        let counts = pending_counts(&pool).unwrap();
        assert_eq!(counts.companion_approvals, 0, "the repo cannot see them");
        let with = counts.with_companion_approvals(4);
        assert_eq!(with.companion_approvals, 4);
        assert_eq!(with.decision_total, with.total + 4);
    }
}
