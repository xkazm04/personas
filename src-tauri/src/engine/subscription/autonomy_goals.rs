use super::*;
use crate::db::DbPool;
use crate::engine::ExecutionEngine;
use std::sync::Arc;
use std::time::Duration;
use tauri::AppHandle;

// ---------------------------------------------------------------------------
// Autonomous goal advancement (default-OFF)
// ---------------------------------------------------------------------------

/// Keeps each goal-linked team's active goal moving **unattended** — turns a
/// stalled-but-unworked goal into a running `team_assignment` via
/// [`crate::engine::goal_advance::advance_goal`]. This is the "works for weeks"
/// layer on top of the manual/Athena initiator.
///
/// **Gated OFF by default** (`settings_keys::AUTONOMOUS_GOAL_ADVANCEMENT`): the
/// tick is a no-op until the user opts in, so nothing spends tokens
/// autonomously without consent. Guardrails when ON: one active assignment per
/// goal (enforced in `advance_goal`), a per-goal cooldown after any assignment
/// (so a failed run isn't retried in a tight loop; currently 2h, tuned up from
/// the 30m default for the day-long multi-team soak test), eligible-persona
/// check, and a hard per-tick cap so a large fleet ramps gradually.
pub struct GoalAdvanceSubscription {
    pub pool: DbPool,
    pub app: AppHandle,
    pub engine: Arc<ExecutionEngine>,
}

/// Max goals advanced per tick — bounds the autonomous spend ramp.
const GOAL_ADVANCE_MAX_PER_TICK: usize = 3;

/// G1 — quota-aware backpressure for the autonomous-spend loops. Returns true
/// when the Claude account hit a session/usage/rate limit in the recent window,
/// i.e. we're inside a limit window. While active, the goal-advance and
/// assignment-retry ticks SKIP — so a burst doesn't keep slamming an exhausted
/// quota (the dominant failure mode in the soak: 94% of failures were session
/// limit). Cheap recency probe over recent failed executions; the self-heal
/// still retries the work once the window clears.
const QUOTA_COOLDOWN_LOOKBACK_MINUTES: i64 = 15;
/// ~10 autonomy loops call this independently every tick; a 30s shared memo
/// turns that into at most one probe per window. The datetime(created_at)
/// predicate is deliberate (mixed 'T'/' ' timestamp formats — a raw compare
/// wedged the gate for whole days) and is index-backed since the
/// idx_persona_executions_sync_watermark expression index landed, so the
/// blob LIKEs only touch the last 15 minutes of rows.
const QUOTA_PROBE_TTL: std::time::Duration = std::time::Duration::from_secs(30);
static QUOTA_PROBE_CACHE: std::sync::Mutex<Option<(std::time::Instant, bool)>> =
    std::sync::Mutex::new(None);

pub(crate) fn quota_cooldown_active(pool: &DbPool) -> bool {
    if let Some((at, cached)) = *QUOTA_PROBE_CACHE
        .lock()
        .expect("quota probe cache poisoned")
    {
        if at.elapsed() < QUOTA_PROBE_TTL {
            return cached;
        }
    }
    let Ok(conn) = pool.get() else { return false };
    let n: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM persona_executions
             WHERE status = 'failed'
               -- datetime() normalizes the RFC3339 'T' separator: a raw string
               -- compare made EVERY same-day row count as recent ('T' > ' '),
               -- wedging the quota gate for the whole day after one limit hit.
               AND datetime(created_at) > datetime('now', ?1)
               AND (LOWER(COALESCE(output_data,'')) LIKE '%session limit%'
                    OR LOWER(COALESCE(output_data,'')) LIKE '%usage limit%'
                    OR LOWER(COALESCE(output_data,'')) LIKE '%hit your%limit%'
                    OR LOWER(COALESCE(error_message,'')) LIKE '%rate limit%'
                    OR LOWER(COALESCE(error_message,'')) LIKE '%429%')",
            rusqlite::params![format!("-{QUOTA_COOLDOWN_LOOKBACK_MINUTES} minutes")],
            |r| r.get(0),
        )
        .unwrap_or(0);
    let active = n > 0;
    *QUOTA_PROBE_CACHE
        .lock()
        .expect("quota probe cache poisoned") = Some((std::time::Instant::now(), active));
    active
}

/// Goal-linked teams with an active, unworked goal and no recent assignment.
/// Returns `(team_id, goal_id, project_id)` triples — the project id lets the
/// caller apply each project's autopilot mode. The cooldown via `created_at`
/// (2h for the soak test, default 30m) prevents stampede + failure-retry loops.
///
/// **Cycle goals are not candidates (G55).** A goal whose description opens
/// with the `[cycle:<persona>:<n>]` marker belongs to the attention loop: it
/// claims, runs and closes it through `cycle_goals`. Advancing it here ran a
/// second engine on the same row — 203 opus executions for six App Masters on
/// 2026-09-25 while the attention loop was switched off — and the
/// orchestrator's `mark_goal_in_progress` then blocked `claim_cycle_goal` from
/// re-claiming it. The marker is parsed in Rust by the repo's own parser,
/// never matched with `LIKE`, so the two cannot disagree about what a cycle is.
pub(crate) fn find_goal_advance_candidates(
    pool: &DbPool,
) -> Result<Vec<(String, String, String)>, crate::error::AppError> {
    use crate::db::repos::dev::cycle_goals::parse_cycle_marker;
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT dp.team_id AS team_id, g.id AS goal_id, dp.id AS project_id,
                g.description AS description
         FROM dev_goals g
         JOIN dev_projects dp ON dp.id = g.project_id
         WHERE dp.team_id IS NOT NULL
           -- 'blocked' = shelved (Athena goal_shelve or human) — advancement
           -- stops until the human un-blocks it from the Goals board.
           AND g.status NOT IN ('done', 'completed', 'blocked')
           AND g.progress < 100
           AND NOT EXISTS (
             SELECT 1 FROM team_assignments ta
             WHERE ta.goal_id = g.id
               AND (ta.status IN ('queued', 'running', 'awaiting_review')
                    -- Per-goal cooldown: tuned up 30m -> 2h for the day-long
                    -- multi-team soak test (2h cadence per team). Revert to
                    -- '-30 minutes' to restore the default advancement rate.
                    OR datetime(ta.created_at) > datetime('now', '-120 minutes'))
           )
         ORDER BY g.updated_at ASC",
    )?;
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>("team_id")?,
                r.get::<_, String>("goal_id")?,
                r.get::<_, String>("project_id")?,
                r.get::<_, Option<String>>("description")?,
            ))
        })?
        .filter_map(Result::ok)
        .filter(|(_, _, _, description)| parse_cycle_marker(description.as_deref()).is_none())
        .map(|(team_id, goal_id, project_id, _)| (team_id, goal_id, project_id))
        .collect();
    Ok(rows)
}

/// Once-per-transition flags for the goal-advance tick's holds (G55).
static GOAL_ADVANCE_HELD: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
static GOAL_ADVANCE_MANDATE_REFUSED: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);
static ASSIGNMENT_RESUME_HELD: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

#[async_trait::async_trait]
impl ReactiveSubscription for GoalAdvanceSubscription {
    fn name(&self) -> &'static str {
        "goal_advance"
    }

    fn interval(&self) -> Duration {
        // Advancement is heavy (it spawns persona executions); 5 minutes is
        // plenty of cadence for an unattended loop.
        Duration::from_secs(300)
    }

    fn idle_interval(&self) -> Duration {
        Duration::from_secs(900)
    }

    fn initial_delay(&self) -> Duration {
        // Let the app settle before the first autonomous advance.
        Duration::from_secs(60)
    }

    async fn tick(&self) {
        use crate::engine::autonomy::{self, Action};
        // Default-OFF gate — opt-in only, per-project autopilot overrides it.
        // A project in `full` mode advances even when the global flag is off;
        // when neither is on, the tick is a no-op (as before).
        let global = autonomy::global_enabled(&self.pool, Action::GoalAdvancement);
        let modes = autonomy::load_modes(&self.pool);
        if !global && !autonomy::any_enabled(&modes) {
            return;
        }
        // G1: quota-aware backpressure — don't start NEW team work while the
        // account is inside a session/usage-limit window.
        if quota_cooldown_active(&self.pool) {
            tracing::info!("goal_advance: quota cooldown active — skipping tick");
            return;
        }
        // G55: the operator's switches (quota stop, memory stop) govern this
        // engine too. Checked before any assignment is created; a refused tick
        // creates nothing. Per-persona switches (enabled, codex_mode, the
        // concurrency cap) are held at each step by the orchestrator.
        {
            use super::autonomy_admission as admission;
            let state = admission::app_state(&self.app);
            let verdict = admission::admit_global(&self.pool, state.as_deref()).await;
            admission::log_transition(&GOAL_ADVANCE_HELD, "goal_advance", &verdict);
            if !verdict.is_go() {
                return;
            }
        }

        // Candidate query is sync rusqlite — offload off the async worker.
        let pool = self.pool.clone();
        let candidates =
            match tokio::task::spawn_blocking(move || find_goal_advance_candidates(&pool)).await {
                Ok(Ok(c)) => c,
                Ok(Err(e)) => {
                    tracing::warn!(error = %e, "goal_advance: candidate query failed");
                    return;
                }
                Err(_) => return,
            };

        // The App master mandate is the second gate (`autonomy::mandate_permits`):
        // a mandated project whose rung does not reach goal advancement is not
        // advanced. Unmandated projects pass unchanged. Loaded once per tick.
        let mandates = autonomy::load_mandates(&self.pool);
        let mut mandate_refused = false;

        let mut started = 0usize;
        // X2 fairness: advance AT MOST ONE goal per team per tick (breadth over
        // depth). Candidates are ordered oldest-goal-first; without this, a team
        // with several stale goals consumed the whole per-tick budget while other
        // teams starved (the day-run showed 2 teams hogging ~60% while 3 starved).
        // One-per-team spreads the budget across distinct teams; the 120-min
        // cooldown then rotates which teams advance on subsequent ticks.
        let mut seen_teams: std::collections::HashSet<String> = std::collections::HashSet::new();
        for (team_id, goal_id, project_id) in candidates.into_iter() {
            if started >= GOAL_ADVANCE_MAX_PER_TICK {
                break;
            }
            // Only `full`-mode projects auto-advance (or legacy global-on
            // projects with no explicit mode).
            if !autonomy::is_allowed(&modes, &project_id, global, Action::GoalAdvancement) {
                continue;
            }
            if let Err(refusal) =
                autonomy::mandate_permits(&mandates, &project_id, Action::GoalAdvancement)
            {
                if !mandate_refused
                    && !GOAL_ADVANCE_MANDATE_REFUSED
                        .swap(true, std::sync::atomic::Ordering::Relaxed)
                {
                    tracing::info!(
                        project_id = %project_id,
                        refusal = ?refusal,
                        "goal_advance: the project's App master mandate does not permit goal advancement — skipped"
                    );
                }
                mandate_refused = true;
                continue;
            }
            if !seen_teams.insert(team_id.clone()) {
                continue; // a goal for this team was already attempted this tick
            }
            match crate::engine::goal_advance::advance_goal(
                &self.pool,
                &self.app,
                self.engine.clone(),
                None, // llm_eval match strategy — embedding manager unused
                &team_id,
                &goal_id,
            )
            .await
            {
                Ok(crate::engine::goal_advance::AdvanceResult::Started(id)) => {
                    started += 1;
                    tracing::info!(team_id = %team_id, goal_id = %goal_id, assignment_id = %id, "goal_advance: started autonomous assignment");
                }
                Ok(crate::engine::goal_advance::AdvanceResult::AlreadyAdvancing) => {}
                Err(e) => {
                    tracing::warn!(team_id = %team_id, goal_id = %goal_id, error = %e, "goal_advance: advance failed");
                }
            }
        }
        if !mandate_refused {
            GOAL_ADVANCE_MANDATE_REFUSED.store(false, std::sync::atomic::Ordering::Relaxed);
        }
        if started > 0 {
            tracing::info!(
                count = started,
                "goal_advance: autonomous tick started {started} assignment(s)"
            );
        }
    }
}

// ---------------------------------------------------------------------------
// Autonomous assignment retry (default-OFF) — self-heal quota-failed assignments
// ---------------------------------------------------------------------------

/// Per-step retry cap for the autonomous resume path. Once a step has been
/// auto-retried this many times the failure is almost certainly not a transient
/// quota blip, so the assignment is left paused for a human.
const ASSIGNMENT_RETRY_MAX: i64 = 8;
/// Backoff between auto-retries of a failed step (minutes). Long enough that a
/// Claude session/usage-limit window has a real chance to reset before the next
/// attempt; with the cap this spans several hours of recovery.
const ASSIGNMENT_RETRY_BACKOFF_MINUTES: i64 = 30;
/// Max assignments resumed per tick — bounds the spend ramp (mirrors
/// `GOAL_ADVANCE_MAX_PER_TICK`).
const ASSIGNMENT_AUTO_RESUME_MAX_PER_TICK: usize = 5;

/// Resumes team assignments soft-paused at `awaiting_review` because a step
/// failed for a RETRYABLE reason (Claude session/usage limit, rate limit) —
/// resetting those steps and re-running them once the quota window has likely
/// recovered, so the unattended goal-advance loop self-heals instead of
/// deadlocking. Default-OFF (`AUTONOMOUS_ASSIGNMENT_RETRY`); per-persona opt-out
/// via `design_context.repeat_on_failure`; bounded by a per-step cap + backoff.
pub struct AssignmentAutoResumeSubscription {
    pub pool: DbPool,
    pub app: AppHandle,
    pub engine: Arc<ExecutionEngine>,
}

/// A failed step that passed the SQL-expressible retry filters (assignment
/// `awaiting_review`, step `failed`, under the retry cap, past the backoff).
/// The retryable-error classification + per-persona repeat gate run in Rust.
struct RetryCandidateStep {
    assignment_id: String,
    step_id: String,
    persona_id: Option<String>,
    execution_id: Option<String>,
    step_error: Option<String>,
}

fn find_assignment_retry_candidates(
    pool: &DbPool,
) -> Result<Vec<RetryCandidateStep>, crate::error::AppError> {
    let conn = pool.get()?;
    let backoff = format!("-{ASSIGNMENT_RETRY_BACKOFF_MINUTES} minutes");
    let mut stmt = conn.prepare(
        "SELECT s.assignment_id, s.id, s.assigned_persona_id, s.execution_id, s.error_message
         FROM team_assignment_steps s
         JOIN team_assignments a ON a.id = s.assignment_id
         WHERE a.status = 'awaiting_review'
           AND s.status = 'failed'
           AND COALESCE(s.retry_count, 0) < ?1
           AND (s.completed_at IS NULL OR datetime(s.completed_at) < datetime('now', ?2))
         ORDER BY s.completed_at ASC",
    )?;
    let rows = stmt.query_map(rusqlite::params![ASSIGNMENT_RETRY_MAX, backoff], |r| {
        Ok(RetryCandidateStep {
            assignment_id: r.get(0)?,
            step_id: r.get(1)?,
            persona_id: r.get(2)?,
            execution_id: r.get(3)?,
            step_error: r.get(4)?,
        })
    })?;
    Ok(rows.filter_map(Result::ok).collect())
}

/// Is this failed step's failure TRANSIENT (worth retrying once conditions
/// recover) rather than permanent? Looks at the step's own `error_message` plus
/// its execution's `error_message` and `output_data` (where the CLI's "You've
/// hit your session limit" lands), and classifies via the failover taxonomy.
///
/// Retryable = the transient categories that an overloaded quota burst produces
/// and that waiting/recovery resolves: rate/session limit, timeout, transient
/// process failure, network, and 5xx API errors. NOT retryable: missing binary,
/// credential failure, validation, tool errors, or unknown — waiting won't fix
/// those, so the assignment stays paused for a human (and the per-step retry cap
/// bounds the cost of a step that keeps failing transiently).
fn step_failure_is_retryable(
    pool: &DbPool,
    exec_id: Option<&str>,
    step_error: Option<&str>,
) -> bool {
    use crate::engine::error_taxonomy::ErrorCategory;
    let mut blob = step_error.unwrap_or("").to_string();
    if let Some(eid) = exec_id {
        if let Ok(conn) = pool.get() {
            if let Ok((err, out)) = conn.query_row(
                "SELECT COALESCE(error_message,''), COALESCE(output_data,'') FROM persona_executions WHERE id = ?1",
                rusqlite::params![eid],
                |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
            ) {
                blob.push(' ');
                blob.push_str(&err);
                blob.push(' ');
                blob.push_str(&out);
            }
        }
    }
    matches!(
        crate::engine::failover::classify_error(&blob),
        Some(
            ErrorCategory::RateLimit
                | ErrorCategory::SessionLimit
                | ErrorCategory::Timeout
                | ErrorCategory::TransientProcessFailure
                | ErrorCategory::Network
                | ErrorCategory::ApiError
        )
    )
}

/// Per-persona opt-out: `design_context.repeat_on_failure` — default TRUE when
/// absent/unparseable (repeat is the default; this is an opt-out, not opt-in).
fn persona_repeats_on_failure(pool: &DbPool, persona_id: Option<&str>) -> bool {
    let Some(pid) = persona_id else { return true };
    let Ok(conn) = pool.get() else { return true };
    let dc: Option<String> = conn
        .query_row(
            "SELECT design_context FROM personas WHERE id = ?1",
            rusqlite::params![pid],
            |r| r.get(0),
        )
        .ok()
        .flatten();
    match dc
        .as_deref()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(s).ok())
    {
        Some(v) => v
            .get("repeat_on_failure")
            .and_then(|b| b.as_bool())
            .unwrap_or(true),
        None => true,
    }
}

#[async_trait::async_trait]
impl ReactiveSubscription for AssignmentAutoResumeSubscription {
    fn name(&self) -> &'static str {
        "assignment_auto_resume"
    }
    fn interval(&self) -> Duration {
        Duration::from_secs(300)
    }
    fn idle_interval(&self) -> Duration {
        Duration::from_secs(900)
    }
    fn initial_delay(&self) -> Duration {
        Duration::from_secs(90)
    }

    async fn tick(&self) {
        // Default-OFF gate — opt-in only.
        use crate::engine::autonomy::{self, Action};
        let enabled = autonomy::global_enabled(&self.pool, Action::AssignmentRetry);
        if !enabled {
            return;
        }
        // G1: don't retry into an active limit window — wait for it to clear so
        // the retry actually has a chance to succeed instead of re-failing.
        if quota_cooldown_active(&self.pool) {
            tracing::info!("assignment_auto_resume: quota cooldown active — skipping tick");
            return;
        }
        // G55: the quota stop and the memory stop govern the retry loop too —
        // a retry into a stopped gauge is exactly the spend the operator
        // switched off. Refused → nothing is resumed this tick.
        use super::autonomy_admission as admission;
        let state = admission::app_state(&self.app);
        let global_verdict = admission::admit_global(&self.pool, state.as_deref()).await;
        admission::log_transition(
            &ASSIGNMENT_RESUME_HELD,
            "assignment_auto_resume",
            &global_verdict,
        );
        if !global_verdict.is_go() {
            return;
        }

        // SQL filter + retryable-classification + per-persona gate, all on the
        // blocking pool (sync rusqlite). Result groups retryable step ids by
        // assignment so each assignment is resumed once.
        let pool = self.pool.clone();
        let by_assignment = match tokio::task::spawn_blocking(move || {
            let cands = find_assignment_retry_candidates(&pool)?;
            let mut grouped: std::collections::BTreeMap<String, (Vec<String>, Vec<String>)> =
                std::collections::BTreeMap::new();
            for c in cands {
                if !step_failure_is_retryable(
                    &pool,
                    c.execution_id.as_deref(),
                    c.step_error.as_deref(),
                ) {
                    continue;
                }
                if !persona_repeats_on_failure(&pool, c.persona_id.as_deref()) {
                    continue;
                }
                let entry = grouped.entry(c.assignment_id).or_default();
                entry.0.push(c.step_id);
                if let Some(pid) = c.persona_id {
                    if !entry.1.contains(&pid) {
                        entry.1.push(pid);
                    }
                }
            }
            Ok::<_, crate::error::AppError>(grouped)
        })
        .await
        {
            Ok(Ok(m)) => m,
            Ok(Err(e)) => {
                tracing::warn!(error = %e, "assignment_auto_resume: candidate query failed");
                return;
            }
            Err(_) => return,
        };

        let mut resumed = 0usize;
        'assignments: for (assignment_id, (step_ids, persona_ids)) in by_assignment
            .into_iter()
            .take(ASSIGNMENT_AUTO_RESUME_MAX_PER_TICK)
        {
            // Per-persona half (enabled, codex_mode, concurrency cap): an
            // assignment whose retried step would run a persona the operator
            // has held is left `awaiting_review` — resuming it would only flip
            // it to `running` for the orchestrator to hold, and would spend a
            // retry on nothing.
            for pid in &persona_ids {
                let verdict = admission::admit_autonomous(&self.pool, state.as_deref(), pid).await;
                if let admission::Admission::Defer(reason) = verdict {
                    tracing::debug!(
                        assignment_id = %assignment_id,
                        persona_id = %pid,
                        reason = reason.code(),
                        "assignment_auto_resume: persona held by autonomy admission — not resumed"
                    );
                    continue 'assignments;
                }
            }
            match crate::engine::team_assignment_orchestrator::auto_resume_retryable_steps(
                Arc::new(self.pool.clone()),
                self.app.clone(),
                self.engine.clone(),
                None,
                &assignment_id,
                &step_ids,
            ) {
                Ok(()) => {
                    resumed += 1;
                    tracing::info!(assignment_id = %assignment_id, steps = step_ids.len(), "assignment_auto_resume: resumed retryable-failed assignment");
                }
                Err(e) => {
                    tracing::warn!(assignment_id = %assignment_id, error = %e, "assignment_auto_resume: resume failed");
                }
            }
        }
        if resumed > 0 {
            tracing::info!(
                count = resumed,
                "assignment_auto_resume: resumed {resumed} assignment(s)"
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init_test_db;
    use crate::db::models::{
        CreatePersonaInput, CreateTeamAssignmentInput, CreateTeamAssignmentStepInput,
        CreateTeamInput,
    };
    use crate::db::repos::core::personas as persona_repo;
    use crate::db::repos::dev::{cycle_goals, goals as goal_repo, projects as project_repo};
    use crate::db::repos::orchestration::team_assignments as assignment_repo;
    use crate::db::repos::resources::teams as team_repo;
    use crate::error::AppError;

    fn team_project(pool: &DbPool, name: &str) -> Result<(String, String), AppError> {
        let team = team_repo::create(
            pool,
            CreateTeamInput {
                name: format!("{name} team"),
                project_id: None,
                parent_team_id: None,
                description: None,
                canvas_data: None,
                team_config: None,
                icon: None,
                color: None,
                enabled: Some(true),
            },
        )?;
        let project = project_repo::create_project(
            pool,
            name,
            &format!("C:/tmp/{name}"),
            None,
            None,
            None,
            None,
            Some(&team.id),
        )?;
        Ok((team.id, project.id))
    }

    /// G55: a cycle goal is the attention loop's row. The goal-advance tick
    /// must not pick it up (it did — 203 opus runs on 2026-09-25), while an
    /// ordinary goal in the same project stays a candidate.
    #[test]
    fn goal_advance_candidates_exclude_cycle_goals_and_keep_normal_ones() -> Result<(), AppError> {
        let pool = init_test_db()?;
        let (team_id, project_id) = team_project(&pool, "g55-app")?;

        let normal = goal_repo::create_goal(
            &pool,
            &project_id,
            "Ship the ledger",
            Some("an ordinary goal"),
            None,
            None,
            None,
            None,
        )?;
        let (cycle, _) =
            cycle_goals::claim_cycle_goal(&pool, "persona-a", "Master A", &project_id, "plan")?;
        // A leading-whitespace marker is still a cycle (the parser is lenient
        // about it), so it must be excluded too.
        let spaced = goal_repo::create_goal(
            &pool,
            &project_id,
            "Master B · cycle 1",
            Some("  [cycle:persona-b:1]\nplan"),
            None,
            None,
            None,
            None,
        )?;

        let found = find_goal_advance_candidates(&pool)?;
        let ids: Vec<&str> = found.iter().map(|(_, g, _)| g.as_str()).collect();
        assert!(
            ids.contains(&normal.id.as_str()),
            "the ordinary goal stays a candidate: {ids:?}"
        );
        assert!(
            !ids.contains(&cycle.id.as_str()),
            "a claimed cycle goal is the attention loop's: {ids:?}"
        );
        assert!(
            !ids.contains(&spaced.id.as_str()),
            "a whitespace-led marker is still a cycle: {ids:?}"
        );
        assert!(found
            .iter()
            .all(|(t, _, p)| t == &team_id && p == &project_id));

        // A live (queued/running) assignment whose steps the orchestrator is
        // HOLDING (G55 admission) still owns its goal past the 2h cooldown —
        // a hold must not turn into a duplicate assignment for the same goal.
        let worker = persona_repo::create(
            &pool,
            CreatePersonaInput {
                name: "Worker".into(),
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
                lifecycle: None,
            },
        )?
        .id;
        let assignment = assignment_repo::create(
            &pool,
            CreateTeamAssignmentInput {
                team_id: team_id.clone(),
                title: "Held work".into(),
                goal: "Ship the ledger".into(),
                match_strategy: None,
                max_parallel_steps: None,
                source: None,
                companion_op_id: None,
                goal_id: Some(normal.id.clone()),
                steps: vec![CreateTeamAssignmentStepInput {
                    title: "Build".into(),
                    description: None,
                    assigned_persona_id: Some(worker),
                    assigned_use_case_id: None,
                    depends_on_indices: None,
                }],
            },
        )?;
        // Backdate past the 2h cooldown so only the status keeps it out.
        pool.get()?.execute(
            "UPDATE team_assignments SET created_at = datetime('now', '-1 day') WHERE id = ?1",
            rusqlite::params![assignment.id],
        )?;
        let after = find_goal_advance_candidates(&pool)?;
        assert!(
            !after.iter().any(|(_, g, _)| g == &normal.id),
            "a goal whose held assignment is still live is not re-advanced"
        );
        Ok(())
    }
}
