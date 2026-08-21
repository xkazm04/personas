use super::goals::goal_status_is_ongoing;
use crate::models::{AttentionItem, AttentionQueue, AttentionThresholds, UndispatchedIdea};
use crate::DbPool;
use personas_core::error::AppError;
use rusqlite::{params, Row};

/// How long a KPI's last measurement may age before goal derivation refuses to
/// use it, in days — 2× its cadence, with manual/unknown cadences treated as
/// weekly.
///
/// This is a MIRROR of the `CASE k.cadence` window in
/// `engine/kpi_derivation.rs::find_derivation_candidates` (app crate; this one
/// is in `personas-db`, which cannot depend on it). Keep the two in sync: this
/// function exists only to report the consequence of that rule, so if it drifts
/// the attention queue starts claiming derivation stopped when it has not, or
/// stays quiet when it has.
fn kpi_freshness_window_days(cadence: &str) -> i64 {
    match cadence {
        "daily" => 2,
        // weekly → 14; `manual` and any cadence not yet wired into the
        // derivation CASE fall through to the same 14-day arm it uses.
        _ => 14,
    }
}

/// Cross-project "needs you" queue over all three record types, plus the KPIs
/// that feed them.
///
/// Nine kinds, ranked. The four GOAL kinds keep the ranks they always had —
/// awaiting_review team steps (0) → overdue goals (1) → stalled goals (2) →
/// unstaffed goals (3) — the three record-widening kinds follow: undispatched
/// ideas (4) → stuck running tasks (5) → stale queued tasks (6), and the two
/// KPI-supply kinds are appended last: `kpi_gone_dark` (7) → `kpi_never_measured`
/// (8). Appended rather than interleaved so the existing ordering contract
/// holds; within a rank the list sorts by age, worst first.
///
/// The two KPI kinds deliberately carry NO roll-up counter on `AttentionQueue`
/// (unlike the seven above): that struct lives in `personas-core` and the count
/// is derivable from `items` by `kind`. If a summary surface needs them, add
/// `kpi_gone_dark` / `kpi_never_measured` fields there and fill them here the
/// same way the others are filled.
///
/// Every cutoff comes from `thresholds` (pass `AttentionThresholds::default()`
/// for the shipped numbers) instead of the single hard-coded 7-day window that
/// used to serve for everything.
///
/// Timestamps are PARSED, never string-compared. The previous implementation
/// tested `target_date < now_rfc3339` and `updated_at < stale_before` as raw
/// strings, which is wrong in two live ways: a date-only `target_date` is a
/// lexicographic prefix of any same-day RFC3339 stamp (so a goal due TODAY read
/// as overdue), and the SQLite `datetime('now')` column default produces
/// `"2026-08-05 10:00:00"`, which sorts against RFC3339 by luck.
pub fn attention_queue(
    pool: &DbPool,
    thresholds: AttentionThresholds,
) -> Result<AttentionQueue, AppError> {
    let conn = pool.get()?;
    let now = chrono::Utc::now();
    let now_s = now.to_rfc3339();
    let stale_goal_cutoff = now - chrono::Duration::days(i64::from(thresholds.stale_goal_days));
    let idea_cutoff = now - chrono::Duration::days(i64::from(thresholds.idea_dispatch_days));
    let running_cutoff = now - chrono::Duration::hours(i64::from(thresholds.task_running_hours));
    let queued_cutoff = now - chrono::Duration::hours(i64::from(thresholds.task_queued_hours));
    let mut items: Vec<AttentionItem> = Vec::new();

    // 1) Team-assignment steps awaiting review (goal-linked only).
    //
    // FOREIGN TABLE: team_assignment_steps and team_assignments are owned by
    // `repos::orchestration::team_assignments`. Joined directly here because the
    // queue is one ranked read across five tables; left as-is by the W1 split.
    {
        let mut stmt = conn.prepare(
            "SELECT s.id AS step_id, s.title AS step_title, s.started_at AS step_started_at,
                    a.id AS assignment_id,
                    g.id AS goal_id, g.title AS goal_title, g.status AS goal_status,
                    g.progress AS goal_progress, p.id AS project_id, p.name AS project_name
             FROM team_assignment_steps s
             JOIN team_assignments a ON a.id = s.assignment_id
             JOIN dev_goals g ON g.id = a.goal_id
             JOIN dev_projects p ON p.id = g.project_id
             WHERE s.status = 'awaiting_review'
             ORDER BY s.started_at DESC",
        )?;
        let rows = stmt
            .query_map([], |row| {
                let goal_id: String = row.get("goal_id")?;
                let goal_title: String = row.get("goal_title")?;
                let started_at: Option<String> = row.get("step_started_at")?;
                Ok(AttentionItem {
                    kind: "awaiting_review".into(),
                    entity_kind: "goal".into(),
                    entity_id: goal_id.clone(),
                    entity_title: goal_title.clone(),
                    goal_id: Some(goal_id),
                    goal_title: Some(goal_title),
                    project_id: Some(row.get("project_id")?),
                    project_name: Some(row.get("project_name")?),
                    status: row.get("goal_status")?,
                    progress: Some(row.get::<_, Option<i32>>("goal_progress")?.unwrap_or(0)),
                    detail: row.get::<_, String>("step_title")?,
                    assignment_id: Some(row.get("assignment_id")?),
                    step_id: Some(row.get("step_id")?),
                    // How long the step has been waiting on a human.
                    age_hours: started_at
                        .as_deref()
                        .and_then(|s| hours_since(s, now))
                        .map(|h| h.max(0) as u32),
                    rank: 0,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        items.extend(rows);
    }
    let awaiting_review = items.len() as u32;

    // 2) Overdue + 3) stalled — from goals joined to their project.
    let mut overdue = 0u32;
    let mut stalled = 0u32;
    {
        let mut stmt = conn.prepare(
            "SELECT g.id, g.title, g.status, g.progress, g.target_date, g.updated_at,
                    p.id AS project_id, p.name AS project_name
             FROM dev_goals g JOIN dev_projects p ON p.id = g.project_id
             WHERE g.status NOT IN ('done','completed','complete')",
        )?;
        struct OngoingGoal {
            id: String,
            title: String,
            status: String,
            progress: i32,
            target_date: Option<String>,
            updated_at: String,
            project_id: String,
            project_name: String,
        }
        let rows = stmt
            .query_map([], |row| {
                Ok(OngoingGoal {
                    id: row.get("id")?,
                    title: row.get("title")?,
                    status: row.get("status")?,
                    progress: row.get::<_, Option<i32>>("progress")?.unwrap_or(0),
                    target_date: row.get("target_date")?,
                    updated_at: row.get("updated_at")?,
                    project_id: row.get("project_id")?,
                    project_name: row.get("project_name")?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        for g in rows {
            if !goal_status_is_ongoing(&g.status) {
                continue;
            }
            // PARSED comparison, not lexicographic. A date-only target_date
            // means end-of-day, so "due today" is not overdue.
            let deadline = g.target_date.as_deref().and_then(parse_deadline);
            if let (Some(raw), None) = (g.target_date.as_deref(), deadline) {
                tracing::warn!(
                    goal_id = %g.id,
                    target_date = %raw,
                    "attention_queue: unparseable target_date — cannot judge overdue",
                );
            }
            let touched = parse_stamp(&g.updated_at);
            if touched.is_none() {
                tracing::warn!(
                    goal_id = %g.id,
                    updated_at = %g.updated_at,
                    "attention_queue: unparseable updated_at — cannot judge stalled",
                );
            }

            if deadline.is_some_and(|d| d < now) {
                overdue += 1;
                // `days_between` on a date-only deadline measures from midnight,
                // which would round a just-expired deadline to a bare "0d
                // overdue". Say what is true instead of printing a fake number.
                let elapsed = now - deadline.expect("checked Some above");
                let days = elapsed.num_days();
                items.push(AttentionItem {
                    kind: "overdue".into(),
                    entity_kind: "goal".into(),
                    entity_id: g.id.clone(),
                    entity_title: g.title.clone(),
                    goal_id: Some(g.id),
                    goal_title: Some(g.title),
                    project_id: Some(g.project_id),
                    project_name: Some(g.project_name),
                    status: g.status,
                    progress: Some(g.progress),
                    detail: if days >= 1 {
                        format!("{days}d overdue")
                    } else {
                        "overdue (less than a day)".to_string()
                    },
                    assignment_id: None,
                    step_id: None,
                    age_hours: Some(elapsed.num_hours().max(0) as u32),
                    rank: 1,
                });
            } else if touched.is_some_and(|t| t < stale_goal_cutoff) {
                stalled += 1;
                // Unwrap-free: `days_between` returns None only when a stamp
                // fails to parse, and `touched` proved this one parses.
                let days = days_between(&g.updated_at, &now_s).unwrap_or(0);
                let age = now - touched.expect("checked Some above");
                items.push(AttentionItem {
                    kind: "stalled".into(),
                    entity_kind: "goal".into(),
                    entity_id: g.id.clone(),
                    entity_title: g.title.clone(),
                    goal_id: Some(g.id),
                    goal_title: Some(g.title),
                    project_id: Some(g.project_id),
                    project_name: Some(g.project_name),
                    status: g.status,
                    progress: Some(g.progress),
                    detail: format!("stalled {days}d"),
                    assignment_id: None,
                    step_id: None,
                    age_hours: Some(age.num_hours().max(0) as u32),
                    rank: 2,
                });
            }
        }
    }

    // 4) Unstaffed — ongoing goals with no linked team assignment. Goal-only by
    // design; see `AttentionQueue::unstaffed` for why ideas/tasks have no
    // equivalent signal.
    let mut unstaffed = 0u32;
    {
        let mut stmt = conn.prepare(
            "SELECT g.id, g.title, g.status, g.progress, p.id AS project_id, p.name AS project_name
             FROM dev_goals g JOIN dev_projects p ON p.id = g.project_id
             WHERE g.status NOT IN ('done','completed','complete')
               AND NOT EXISTS (SELECT 1 FROM team_assignments a WHERE a.goal_id = g.id)",
            // FOREIGN TABLE: team_assignments is owned by
            // `repos::orchestration::team_assignments`.
        )?;
        let rows = stmt
            .query_map([], |row| {
                let id: String = row.get("id")?;
                let title: String = row.get("title")?;
                Ok(AttentionItem {
                    kind: "unstaffed".into(),
                    entity_kind: "goal".into(),
                    entity_id: id.clone(),
                    entity_title: title.clone(),
                    goal_id: Some(id),
                    goal_title: Some(title),
                    project_id: Some(row.get("project_id")?),
                    project_name: Some(row.get("project_name")?),
                    status: row.get("status")?,
                    progress: Some(row.get::<_, Option<i32>>("progress")?.unwrap_or(0)),
                    detail: String::new(),
                    assignment_id: None,
                    step_id: None,
                    // Not an age signal — the goal is unstaffed regardless of
                    // how long it has been. Reporting one would invent urgency.
                    age_hours: None,
                    rank: 3,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        for it in rows {
            if goal_status_is_ongoing(&it.status) {
                unstaffed += 1;
                items.push(it);
            }
        }
    }

    // 5) Undispatched ideas — `accepted`, no task. See `UndispatchedIdea` for
    // why this had no query at all before.
    let mut undispatched_ideas = 0u32;
    // Not the 200-row default: `undispatched_ideas` counts the items actually
    // emitted (the same rule the goal counts follow), so a low cap would freeze
    // the number at the cap and report a lie. The clamp ceiling is still there
    // as a backstop against a pathological backlog.
    for idea in undispatched_ideas_rows(&conn, None, Some(u32::MAX))? {
        // An unparseable acceptance stamp does NOT hide the idea: the fact that
        // a human accepted it and nothing was ever dispatched is true
        // independent of age. Goals are the opposite — there the AGE is the
        // signal, so an unreadable stamp means "cannot classify" and we skip.
        let past_threshold = match parse_stamp(&idea.accepted_at) {
            Some(t) => t < idea_cutoff,
            None => {
                tracing::warn!(
                    idea_id = %idea.id,
                    accepted_at = %idea.accepted_at,
                    "attention_queue: unparseable idea stamp — reporting without an age",
                );
                true
            }
        };
        if !past_threshold {
            continue;
        }
        undispatched_ideas += 1;
        let detail = match idea.age_hours {
            Some(h) if h >= 24 => format!("accepted {}d ago, no task", h / 24),
            Some(h) => format!("accepted {h}h ago, no task"),
            None => "accepted, no task (age unknown)".to_string(),
        };
        items.push(AttentionItem {
            kind: "undispatched_idea".into(),
            entity_kind: "idea".into(),
            entity_id: idea.id,
            entity_title: idea.title,
            goal_id: None,
            goal_title: None,
            project_id: idea.project_id,
            project_name: idea.project_name,
            status: "accepted".into(),
            // An idea has no progress; 0 would read as "started, got nowhere".
            progress: None,
            detail,
            assignment_id: None,
            step_id: None,
            age_hours: idea.age_hours,
            rank: 4,
        });
    }

    // 6) Stuck running tasks + 7) stale queued tasks.
    let mut stuck_tasks = 0u32;
    let mut stale_queued_tasks = 0u32;
    {
        struct LiveTask {
            id: String,
            title: String,
            status: String,
            progress: i32,
            goal_id: Option<String>,
            goal_title: Option<String>,
            project_id: Option<String>,
            project_name: Option<String>,
            started_at: Option<String>,
            updated_at: Option<String>,
            created_at: String,
        }
        let mut stmt = conn.prepare(
            "SELECT t.id, t.title, t.status, t.progress_pct, t.goal_id,
                    g.title AS goal_title, t.project_id, p.name AS project_name,
                    t.started_at, t.updated_at, t.created_at
             FROM dev_tasks t
             LEFT JOIN dev_projects p ON p.id = t.project_id
             LEFT JOIN dev_goals g ON g.id = t.goal_id
             WHERE t.status IN ('running', 'queued')",
        )?;
        let rows = stmt
            .query_map([], |row| {
                Ok(LiveTask {
                    id: row.get("id")?,
                    title: row.get("title")?,
                    status: row.get("status")?,
                    progress: row.get::<_, Option<i32>>("progress_pct")?.unwrap_or(0),
                    goal_id: row.get("goal_id")?,
                    goal_title: row.get("goal_title")?,
                    project_id: row.get("project_id")?,
                    project_name: row.get("project_name")?,
                    started_at: row.get("started_at")?,
                    updated_at: row.get("updated_at").unwrap_or(None),
                    created_at: row.get("created_at")?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        for t in rows {
            let running = t.status == "running";
            // The heartbeat. `updated_at` is written by every task mutation —
            // task_executor stamps it on each progress milestone — so for a
            // running task this is "when did we last hear anything", not "how
            // long has this been going". `started_at`/`created_at` are the
            // fallbacks for a row that predates the column.
            let last_seen_raw = if running {
                t.updated_at
                    .clone()
                    .or_else(|| t.started_at.clone())
                    .unwrap_or_else(|| t.created_at.clone())
            } else {
                t.updated_at.clone().unwrap_or_else(|| t.created_at.clone())
            };
            let Some(last_seen) = parse_stamp(&last_seen_raw) else {
                tracing::warn!(
                    task_id = %t.id,
                    stamp = %last_seen_raw,
                    "attention_queue: unparseable task stamp — cannot judge staleness",
                );
                continue;
            };
            let cutoff = if running {
                running_cutoff
            } else {
                queued_cutoff
            };
            if last_seen >= cutoff {
                continue;
            }

            let hours = (now - last_seen).num_hours().max(0) as u32;
            let (kind, rank, detail) = if running {
                stuck_tasks += 1;
                (
                    "stuck_task",
                    5,
                    format!("running, no progress for {hours}h"),
                )
            } else {
                stale_queued_tasks += 1;
                (
                    "stale_queued_task",
                    6,
                    format!("queued {hours}h, never started"),
                )
            };
            items.push(AttentionItem {
                kind: kind.into(),
                entity_kind: "task".into(),
                entity_id: t.id,
                entity_title: t.title,
                goal_id: t.goal_id,
                goal_title: t.goal_title,
                project_id: t.project_id,
                project_name: t.project_name,
                status: t.status,
                progress: Some(t.progress),
                detail,
                assignment_id: None,
                step_id: None,
                age_hours: Some(hours),
                rank,
            });
        }
    }

    // 8) KPIs whose measurement has gone dark + 9) active KPIs never measured.
    //
    // Not "this number is old" — the CONSEQUENCE. `kpi_derivation::
    // find_derivation_candidates` refuses to derive a goal from a KPI measured
    // longer ago than 2x its cadence, so past that window the KPI silently
    // stops producing work. A codebase command that started failing and a
    // connector binding that rotted both land here, and both read to the user
    // as "this KPI just isn't generating goals any more" with nothing to click.
    //
    // Cadence-relative (`kpi_freshness_window_days`), not one global cutoff: a
    // daily KPI and a quarterly one do not share a threshold, and the window
    // used here is the same one the derivation gate enforces.
    //
    // Two distinct kinds because they are two different user problems: a KPI
    // that WAS reporting and went dark is a broken measurement to repair; one
    // that was never measured at all was never wired up in the first place.
    //
    // Scoped to keep the signal worth reading:
    //   * `status = 'active'` only. A paused or archived KPI is silent on
    //     purpose and a `proposed` one has not been adopted yet; lighting the
    //     queue up for either is exactly the noise that makes a queue ignored.
    //   * projects with a team only (`p.team_id IS NOT NULL`) — the same join
    //     `find_derivation_candidates` makes. Derivation never ran for a
    //     team-less project, so "derivation has stopped" would not be TRUE of
    //     one, and this row's whole value is that its claim is true.
    //   * a never-measured KPI is not reported until it is older than its own
    //     window, so activating a KPI does not immediately accuse it.
    {
        struct LiveKpi {
            id: String,
            name: String,
            status: String,
            cadence: String,
            last_measured_at: Option<String>,
            created_at: String,
            project_id: String,
            project_name: String,
        }
        let mut stmt = conn.prepare(
            "SELECT k.id, k.name, k.status, k.cadence, k.last_measured_at, k.created_at,
                    p.id AS project_id, p.name AS project_name
             FROM dev_kpis k
             JOIN dev_projects p ON p.id = k.project_id AND p.team_id IS NOT NULL
             WHERE k.status = 'active'",
        )?;
        let rows = stmt
            .query_map([], |row| {
                Ok(LiveKpi {
                    id: row.get("id")?,
                    name: row.get("name")?,
                    status: row.get("status")?,
                    cadence: row.get("cadence")?,
                    last_measured_at: row.get("last_measured_at")?,
                    created_at: row.get("created_at")?,
                    project_id: row.get("project_id")?,
                    project_name: row.get("project_name")?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        for k in rows {
            let window = chrono::Duration::days(kpi_freshness_window_days(&k.cadence));
            let cutoff = now - window;
            let window_days = window.num_days();

            let (kind, rank, since_raw) = match k.last_measured_at.as_deref() {
                // Measured once and then went quiet past its own window.
                Some(stamp) => {
                    let Some(measured) = parse_stamp(stamp) else {
                        tracing::warn!(
                            kpi_id = %k.id,
                            last_measured_at = %stamp,
                            "attention_queue: unparseable KPI last_measured_at — cannot judge staleness",
                        );
                        continue;
                    };
                    if measured >= cutoff {
                        continue;
                    }
                    ("kpi_gone_dark", 7, measured)
                }
                // Never measured — reported only once it has had its own window
                // to produce a first reading.
                None => {
                    let Some(created) = parse_stamp(&k.created_at) else {
                        tracing::warn!(
                            kpi_id = %k.id,
                            created_at = %k.created_at,
                            "attention_queue: unparseable KPI created_at — cannot judge staleness",
                        );
                        continue;
                    };
                    if created >= cutoff {
                        continue;
                    }
                    ("kpi_never_measured", 8, created)
                }
            };

            let elapsed = now - since_raw;
            let days = elapsed.num_days();
            let detail = if rank == 7 {
                format!(
                    "no reading in {days}d (cadence {}, derivation needs one every {window_days}d) — goal derivation has stopped for it",
                    k.cadence
                )
            } else {
                format!("active {days}d, never measured — no goal can be derived from it yet")
            };
            items.push(AttentionItem {
                kind: kind.into(),
                entity_kind: "kpi".into(),
                entity_id: k.id,
                entity_title: k.name,
                // A KPI is upstream of goals, not attached to one: naming any
                // single derived goal here would misdirect the click.
                goal_id: None,
                goal_title: None,
                project_id: Some(k.project_id),
                project_name: Some(k.project_name),
                status: k.status,
                // A KPI has no progress; 0 would read as "measured, at zero",
                // which is a completely different (and much worse) claim.
                progress: None,
                detail,
                assignment_id: None,
                step_id: None,
                age_hours: Some(elapsed.num_hours().max(0) as u32),
                rank,
            });
        }
    }

    // Rank first (the ordering contract), then oldest-first inside a rank so
    // the worst offender leads. `Option` orders `None` below `Some`, so a row
    // with an unknown age sinks rather than pretending to be urgent.
    items.sort_by(|a, b| a.rank.cmp(&b.rank).then(b.age_hours.cmp(&a.age_hours)));
    Ok(AttentionQueue {
        items,
        awaiting_review,
        overdue,
        stalled,
        unstaffed,
        undispatched_ideas,
        stuck_tasks,
        stale_queued_tasks,
        thresholds,
    })
}

/// Every `accepted` idea with no `dev_tasks` row — the query the app could not
/// answer. See `UndispatchedIdea`.
///
/// `limit` caps the result (default 200, so a backlog with thousands of
/// accepted ideas cannot blow up a panel); rows come back OLDEST FIRST because
/// the most-forgotten decision is the one worth surfacing.
pub fn list_undispatched_ideas(
    pool: &DbPool,
    project_id: Option<&str>,
    limit: Option<u32>,
) -> Result<Vec<UndispatchedIdea>, AppError> {
    timed_query!("dev_ideas", "dev_ideas::list_undispatched_ideas", {
        let conn = pool.get()?;
        undispatched_ideas_rows(&conn, project_id, limit)
    })
}

/// Shared body of `list_undispatched_ideas` and the attention queue's idea pass,
/// so the panel and the queue can never disagree about what "undispatched" is.
fn undispatched_ideas_rows(
    conn: &rusqlite::Connection,
    project_id: Option<&str>,
    limit: Option<u32>,
) -> Result<Vec<UndispatchedIdea>, AppError> {
    let now = chrono::Utc::now();
    let limit = limit.unwrap_or(200).clamp(1, 5_000);
    // COALESCE(updated_at, created_at): `updated_at` is the stamp the acceptance
    // write set, so it is when the decision was made. NOT EXISTS mirrors
    // `archive_stale_ideas` — the one existing piece of prior art — but on
    // 'accepted' rather than 'pending'.
    let sql = format!(
        "SELECT i.id, i.title, i.project_id, p.name AS project_name, i.category,
                i.origin, i.priority, i.impact, i.effort,
                COALESCE(i.updated_at, i.created_at) AS accepted_at
         FROM dev_ideas i
         LEFT JOIN dev_projects p ON p.id = i.project_id
         WHERE i.status = 'accepted'
           AND NOT EXISTS (SELECT 1 FROM dev_tasks t WHERE t.source_idea_id = i.id)
           {}
         ORDER BY accepted_at ASC, i.id ASC
         LIMIT {limit}",
        if project_id.is_some() {
            "AND i.project_id = ?1"
        } else {
            ""
        },
    );
    let mut stmt = conn.prepare(&sql)?;
    let map = |row: &Row| -> rusqlite::Result<UndispatchedIdea> {
        let accepted_at: String = row.get("accepted_at")?;
        Ok(UndispatchedIdea {
            id: row.get("id")?,
            title: row.get("title")?,
            project_id: row.get("project_id")?,
            project_name: row.get("project_name")?,
            category: row.get("category")?,
            origin: row.get("origin").unwrap_or(None),
            priority: row.get("priority").unwrap_or(None),
            impact: row.get("impact")?,
            effort: row.get("effort")?,
            age_hours: hours_since(&accepted_at, now).map(|h| h.max(0) as u32),
            accepted_at,
        })
    };
    let rows = match project_id {
        Some(pid) => stmt
            .query_map(params![pid], map)?
            .collect::<Result<Vec<_>, _>>(),
        None => stmt.query_map([], map)?.collect::<Result<Vec<_>, _>>(),
    };
    rows.map_err(AppError::Database)
}

/// Parse a stored timestamp into UTC.
///
/// Three shapes live in this database and all three must work, or the staleness
/// engine silently mis-reads its own rows:
///   - RFC3339 (`2026-08-05T10:00:00+00:00`) — what every Rust writer emits.
///   - `YYYY-MM-DD HH:MM:SS[.f]` — SQLite's `datetime('now')`, the column
///     DEFAULT that applies whenever a writer omits the column (imports, legacy
///     INSERTs). Stored in UTC.
///   - `YYYY-MM-DD` — date-only, used by `dev_goals.target_date`. Start of day.
///
/// `None` for anything else. Callers MUST treat `None` as "unknown" and never
/// as zero — conflating those two is the bug this replaced.
pub(super) fn parse_stamp(s: &str) -> Option<chrono::DateTime<chrono::Utc>> {
    let s = s.trim();
    if s.is_empty() {
        return None;
    }
    if let Ok(d) = chrono::DateTime::parse_from_rfc3339(s) {
        return Some(d.with_timezone(&chrono::Utc));
    }
    for fmt in ["%Y-%m-%d %H:%M:%S%.f", "%Y-%m-%dT%H:%M:%S%.f"] {
        if let Ok(dt) = chrono::NaiveDateTime::parse_from_str(s, fmt) {
            return Some(dt.and_utc());
        }
    }
    chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d")
        .ok()
        .and_then(|d| d.and_hms_opt(0, 0, 0))
        .map(|d| d.and_utc())
}

/// Parse a DEADLINE. Identical to `parse_stamp` except that a date-only value
/// means the END of that day — a goal due today is not overdue until the day is
/// out. The old code compared raw strings, so `"2026-08-05"` sorted before
/// `"2026-08-05T09:00:00+00:00"` (it is a prefix) and a goal due TODAY was
/// reported overdue from midnight onward.
pub(super) fn parse_deadline(s: &str) -> Option<chrono::DateTime<chrono::Utc>> {
    let t = s.trim();
    if let Ok(d) = chrono::NaiveDate::parse_from_str(t, "%Y-%m-%d") {
        return d.and_hms_opt(23, 59, 59).map(|d| d.and_utc());
    }
    parse_stamp(t)
}

/// Whole days between two stored timestamps (`from` → `to`), or `None` when
/// either side is unparseable.
///
/// It used to return `0` on a parse failure. That is why a goal whose
/// `updated_at` was a SQLite `datetime('now')` string rather than RFC3339
/// rendered as "stalled 0d": a malformed input and a freshly-touched one were
/// indistinguishable, and the fabricated 0 looked exactly like a real reading.
pub(super) fn days_between(from: &str, to: &str) -> Option<i64> {
    let a = parse_stamp(from)?;
    let b = parse_stamp(to)?;
    Some((b - a).num_days().abs())
}

/// Whole hours from `at` until `now`, or `None` when `at` is unparseable.
fn hours_since(at: &str, now: chrono::DateTime<chrono::Utc>) -> Option<i64> {
    parse_stamp(at).map(|t| (now - t).num_hours())
}

/// The staleness engine across all three record types. Repo-level (not
/// command-level) because there is no fixture that builds a Tauri `State`.
#[cfg(test)]
mod attention_queue_tests {
    use super::*;
    use crate::models::DevIdea;
    use crate::repos::dev::goals::create_goal;
    use crate::repos::dev::ideas::create_idea;
    use crate::repos::dev::kpis::create_kpi;
    use crate::repos::dev::projects::create_project;
    use crate::repos::dev::tasks::{create_task, get_task_by_id, retry_task, update_task};

    fn ago(days: i64, hours: i64) -> String {
        (chrono::Utc::now() - chrono::Duration::days(days) - chrono::Duration::hours(hours))
            .to_rfc3339()
    }

    fn set(pool: &DbPool, sql: &str, args: &[&dyn rusqlite::types::ToSql]) {
        pool.get().unwrap().execute(sql, args).unwrap();
    }

    fn idea(pool: &DbPool, project: &str, title: &str, status: &str) -> DevIdea {
        create_idea(
            pool,
            Some(project),
            None,
            "scan",
            None,
            title,
            None,
            None,
            Some(status),
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap()
    }

    fn kinds<'a>(q: &'a AttentionQueue, kind: &str) -> Vec<&'a AttentionItem> {
        q.items.iter().filter(|i| i.kind == kind).collect()
    }

    // ---------------------------------------------------------------- C2 ----

    #[test]
    fn an_accepted_idea_is_undispatched_only_while_it_has_no_task() {
        let pool = crate::init_test_db().unwrap();
        let p = create_project(&pool, "P", "/tmp/undisp", None, None, None, None, None).unwrap();

        let dispatched = idea(&pool, &p.id, "has a task", "accepted");
        let forgotten = idea(&pool, &p.id, "never dispatched", "accepted");
        create_task(
            &pool,
            Some(&p.id),
            "work",
            None,
            Some(&dispatched.id),
            None,
            None,
            None,
        )
        .unwrap();

        let rows = list_undispatched_ideas(&pool, None, None).unwrap();
        let ids: Vec<&str> = rows.iter().map(|r| r.id.as_str()).collect();
        assert_eq!(
            ids,
            vec![forgotten.id.as_str()],
            "only the accepted idea with NO dev_tasks row is undispatched",
        );
        assert!(
            rows[0].age_hours.is_some(),
            "a freshly-written stamp must yield a real age, not None",
        );
        assert_eq!(rows[0].project_name.as_deref(), Some("P"));
    }

    #[test]
    fn an_unaccepted_idea_is_never_reported_however_old() {
        let pool = crate::init_test_db().unwrap();
        let p = create_project(&pool, "P", "/tmp/settled", None, None, None, None, None).unwrap();

        // Every non-accepted status, all task-less and all ancient.
        for status in ["pending", "rejected", "archived", "done"] {
            let i = idea(&pool, &p.id, status, status);
            set(
                &pool,
                "UPDATE dev_ideas SET created_at = ?1, updated_at = ?1 WHERE id = ?2",
                &[&ago(90, 0), &i.id],
            );
        }

        assert!(
            list_undispatched_ideas(&pool, None, None)
                .unwrap()
                .is_empty(),
            "undispatched means ACCEPTED-and-unbuilt; a rejected or archived idea owes nobody work",
        );
        let q = attention_queue(&pool, AttentionThresholds::default()).unwrap();
        assert_eq!(q.undispatched_ideas, 0);
    }

    #[test]
    fn undispatched_ideas_come_back_oldest_first_and_scope_to_a_project() {
        let pool = crate::init_test_db().unwrap();
        let a = create_project(&pool, "A", "/tmp/a", None, None, None, None, None).unwrap();
        let b = create_project(&pool, "B", "/tmp/b", None, None, None, None, None).unwrap();

        let recent = idea(&pool, &a.id, "recent", "accepted");
        let ancient = idea(&pool, &a.id, "ancient", "accepted");
        let elsewhere = idea(&pool, &b.id, "other project", "accepted");
        set(
            &pool,
            "UPDATE dev_ideas SET updated_at = ?1 WHERE id = ?2",
            &[&ago(40, 0), &ancient.id],
        );
        set(
            &pool,
            "UPDATE dev_ideas SET updated_at = ?1 WHERE id = ?2",
            &[&ago(1, 0), &recent.id],
        );

        let scoped = list_undispatched_ideas(&pool, Some(&a.id), None).unwrap();
        assert_eq!(
            scoped.iter().map(|r| r.title.as_str()).collect::<Vec<_>>(),
            vec!["ancient", "recent"],
            "the most-forgotten decision leads",
        );
        assert!(scoped[0].age_hours.unwrap() > scoped[1].age_hours.unwrap());
        assert!(
            !scoped.iter().any(|r| r.id == elsewhere.id),
            "project scoping must exclude other projects",
        );
        assert_eq!(list_undispatched_ideas(&pool, None, None).unwrap().len(), 3);
        assert_eq!(
            list_undispatched_ideas(&pool, None, Some(1)).unwrap().len(),
            1,
            "limit caps the list",
        );
    }

    // ---------------------------------------------------------------- C3 ----

    #[test]
    fn the_queue_flags_an_accepted_idea_only_once_it_is_past_the_threshold() {
        let pool = crate::init_test_db().unwrap();
        let p = create_project(&pool, "P", "/tmp/thresh", None, None, None, None, None).unwrap();

        let fresh = idea(&pool, &p.id, "accepted this morning", "accepted");
        let recent = idea(&pool, &p.id, "accepted two days ago", "accepted");
        let stale = idea(&pool, &p.id, "accepted last week", "accepted");
        set(
            &pool,
            "UPDATE dev_ideas SET updated_at = ?1 WHERE id = ?2",
            &[&ago(7, 0), &stale.id],
        );
        set(
            &pool,
            "UPDATE dev_ideas SET updated_at = ?1 WHERE id = ?2",
            &[&ago(2, 0), &recent.id],
        );

        let q = attention_queue(&pool, AttentionThresholds::default()).unwrap();
        let flagged = kinds(&q, "undispatched_idea");
        assert_eq!(q.undispatched_ideas, 1);
        assert_eq!(flagged.len(), 1);
        assert_eq!(flagged[0].entity_id, stale.id);
        assert_eq!(flagged[0].entity_kind, "idea");
        assert_eq!(flagged[0].rank, 4);
        assert!(
            flagged[0].progress.is_none(),
            "an idea has no progress — 0 would read as 'started, got nowhere'",
        );
        assert!(
            flagged[0].detail.contains("no task"),
            "{}",
            flagged[0].detail
        );
        for quiet in [&fresh.id, &recent.id] {
            assert!(
                !q.items.iter().any(|i| &i.entity_id == quiet),
                "a decision younger than the 3-day default is not yet a staleness signal",
            );
        }

        // Thresholds are parameters: a caller with a tighter opinion sees more.
        let tight = attention_queue(
            &pool,
            AttentionThresholds {
                idea_dispatch_days: 1,
                ..AttentionThresholds::default()
            },
        )
        .unwrap();
        assert_eq!(
            tight.undispatched_ideas, 2,
            "a 1-day window catches the 2-day-old decision the 3-day default let through",
        );
        assert!(
            !tight.items.iter().any(|i| i.entity_id == fresh.id),
            "…but not one accepted minutes ago",
        );
        assert_eq!(tight.thresholds.idea_dispatch_days, 1);
        assert_eq!(
            tight.thresholds.stale_goal_days, 7,
            "the goal window keeps its shipped default when only one is overridden",
        );
    }

    #[test]
    fn a_running_task_is_stuck_when_its_heartbeat_goes_quiet_not_when_it_is_merely_long() {
        let pool = crate::init_test_db().unwrap();
        let p = create_project(&pool, "P", "/tmp/stuck", None, None, None, None, None).unwrap();

        let chatty = create_task(
            &pool,
            Some(&p.id),
            "chatty",
            None,
            None,
            None,
            Some("running"),
            None,
        )
        .unwrap();
        let quiet = create_task(
            &pool,
            Some(&p.id),
            "quiet",
            None,
            None,
            None,
            Some("running"),
            None,
        )
        .unwrap();
        // Both started 3 days ago; only `quiet` has stopped reporting.
        set(
            &pool,
            "UPDATE dev_tasks SET started_at = ?1, created_at = ?1 WHERE id IN (?2, ?3)",
            &[&ago(3, 0), &chatty.id, &quiet.id],
        );
        set(
            &pool,
            "UPDATE dev_tasks SET updated_at = ?1 WHERE id = ?2",
            &[&ago(0, 0), &chatty.id],
        );
        set(
            &pool,
            "UPDATE dev_tasks SET updated_at = ?1 WHERE id = ?2",
            &[&ago(0, 9), &quiet.id],
        );

        let q = attention_queue(&pool, AttentionThresholds::default()).unwrap();
        let stuck = kinds(&q, "stuck_task");
        assert_eq!(q.stuck_tasks, 1);
        assert_eq!(stuck.len(), 1);
        assert_eq!(
            stuck[0].entity_id, quiet.id,
            "a 3-day run that reported a minute ago is alive; the silent one is stuck",
        );
        assert_eq!(stuck[0].entity_kind, "task");
        assert_eq!(stuck[0].rank, 5);
        assert!(stuck[0].age_hours.unwrap() >= 9);
    }

    #[test]
    fn a_queued_task_past_its_window_is_reported_and_a_settled_one_never_is() {
        let pool = crate::init_test_db().unwrap();
        let p = create_project(&pool, "P", "/tmp/queued", None, None, None, None, None).unwrap();

        let waiting = create_task(
            &pool,
            Some(&p.id),
            "waiting",
            None,
            None,
            None,
            Some("queued"),
            None,
        )
        .unwrap();
        let just_queued = create_task(
            &pool,
            Some(&p.id),
            "just queued",
            None,
            None,
            None,
            Some("queued"),
            None,
        )
        .unwrap();
        for status in ["completed", "failed", "cancelled"] {
            let t = create_task(
                &pool,
                Some(&p.id),
                status,
                None,
                None,
                None,
                Some(status),
                None,
            )
            .unwrap();
            set(
                &pool,
                "UPDATE dev_tasks SET created_at = ?1, updated_at = ?1, started_at = ?1, completed_at = ?1 WHERE id = ?2",
                &[&ago(30, 0), &t.id],
            );
        }
        set(
            &pool,
            "UPDATE dev_tasks SET created_at = ?1, updated_at = ?1 WHERE id = ?2",
            &[&ago(4, 0), &waiting.id],
        );

        let q = attention_queue(&pool, AttentionThresholds::default()).unwrap();
        let stale = kinds(&q, "stale_queued_task");
        assert_eq!(q.stale_queued_tasks, 1);
        assert_eq!(stale.len(), 1);
        assert_eq!(stale[0].entity_id, waiting.id);
        assert_eq!(stale[0].rank, 6);
        assert!(
            !q.items.iter().any(|i| i.entity_id == just_queued.id),
            "a task queued moments ago is a working queue, not a stalled one",
        );
        assert_eq!(
            q.stuck_tasks, 0,
            "completed / failed / cancelled tasks are settled and must never be reported",
        );
        assert!(
            !q.items.iter().any(|i| i.status == "completed"),
            "a settled row leaked into the queue",
        );
    }

    #[test]
    fn the_four_goal_categories_and_their_ranks_are_unchanged() {
        let pool = crate::init_test_db().unwrap();
        let p = create_project(&pool, "P", "/tmp/goals", None, None, None, None, None).unwrap();
        let day = |n: i64| {
            (chrono::Utc::now() - chrono::Duration::days(n))
                .date_naive()
                .to_string()
        };

        let late =
            create_goal(&pool, &p.id, "late", None, None, None, Some(&day(3)), None).unwrap();
        let due_today = create_goal(
            &pool,
            &p.id,
            "due today",
            None,
            None,
            None,
            Some(&day(0)),
            None,
        )
        .unwrap();
        let quiet = create_goal(&pool, &p.id, "quiet", None, None, None, None, None).unwrap();
        let fresh = create_goal(&pool, &p.id, "fresh", None, None, None, None, None).unwrap();
        let finished = create_goal(
            &pool,
            &p.id,
            "finished",
            None,
            None,
            Some("done"),
            None,
            None,
        )
        .unwrap();
        set(
            &pool,
            "UPDATE dev_goals SET updated_at = ?1 WHERE id IN (?2, ?3)",
            &[&ago(30, 0), &quiet.id, &finished.id],
        );

        let q = attention_queue(&pool, AttentionThresholds::default()).unwrap();

        assert_eq!(q.overdue, 1);
        assert_eq!(kinds(&q, "overdue")[0].entity_id, late.id);
        assert_eq!(kinds(&q, "overdue")[0].rank, 1);
        assert_eq!(
            kinds(&q, "overdue")[0].goal_id.as_deref(),
            Some(late.id.as_str()),
            "a goal row still carries goal_id, not only the generic entity_id",
        );
        assert!(
            !q.items
                .iter()
                .any(|i| i.kind == "overdue" && i.entity_id == due_today.id),
            "a goal due TODAY is not overdue — the raw-string compare said it was",
        );

        assert_eq!(q.stalled, 1);
        assert_eq!(kinds(&q, "stalled")[0].entity_id, quiet.id);
        assert_eq!(kinds(&q, "stalled")[0].rank, 2);

        // Unstaffed stays goal-only and still covers every ongoing goal with no
        // team assignment — including ones already reported as overdue/stalled.
        assert_eq!(q.unstaffed, 4);
        assert!(kinds(&q, "unstaffed").iter().all(|i| i.rank == 3));
        assert!(
            !q.items.iter().any(|i| i.entity_id == finished.id),
            "a done goal is settled — stale timestamps and all",
        );

        assert_eq!(q.awaiting_review, 0);
        let ranks: Vec<i32> = q.items.iter().map(|i| i.rank).collect();
        let mut sorted = ranks.clone();
        sorted.sort_unstable();
        assert_eq!(ranks, sorted, "items must stay ordered by rank");
    }

    #[test]
    fn an_empty_database_yields_an_empty_queue_rather_than_erroring() {
        let pool = crate::init_test_db().unwrap();
        let q = attention_queue(&pool, AttentionThresholds::default()).unwrap();
        assert!(q.items.is_empty());
        assert_eq!(
            q.undispatched_ideas + q.stuck_tasks + q.stale_queued_tasks,
            0
        );
        assert_eq!(q.thresholds.task_running_hours, 4);
    }

    // ------------------------------------------------------- KPI supply ----

    /// A KPI whose measurement stops reporting takes goal derivation down with
    /// it, and nothing used to say so. These pin the four states apart.
    fn kpi(
        pool: &DbPool,
        project: &str,
        name: &str,
        cadence: &str,
        status: &str,
    ) -> crate::models::DevKpi {
        create_kpi(
            pool,
            project,
            name,
            None,
            None,
            "technical",
            "codebase",
            "{}",
            "%",
            "up",
            None,
            None,
            None,
            cadence,
            Some(status),
            "user",
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap()
    }

    fn measured(pool: &DbPool, kpi_id: &str, days_ago: i64) {
        set(
            pool,
            "UPDATE dev_kpis SET current_value = 50.0, last_measured_at = ?1 WHERE id = ?2",
            &[&ago(days_ago, 0), &kpi_id],
        );
    }

    #[test]
    fn a_kpi_that_went_dark_is_reported_and_says_derivation_has_stopped() {
        let pool = crate::init_test_db().unwrap();
        let p = create_project(
            &pool,
            "P",
            "/tmp/kpi-dark",
            None,
            None,
            None,
            None,
            Some("team-1"),
        )
        .unwrap();

        // Weekly window is 14d: 3d ago is fresh, 30d ago is dark.
        let fresh = kpi(&pool, &p.id, "fresh weekly", "weekly", "active");
        measured(&pool, &fresh.id, 3);
        let dark = kpi(&pool, &p.id, "dark weekly", "weekly", "active");
        measured(&pool, &dark.id, 30);

        let q = attention_queue(&pool, AttentionThresholds::default()).unwrap();
        let reported = kinds(&q, "kpi_gone_dark");
        assert_eq!(
            reported.len(),
            1,
            "only the KPI past its own window is reported"
        );
        assert_eq!(reported[0].entity_id, dark.id);
        assert_eq!(reported[0].entity_kind, "kpi");
        assert_eq!(reported[0].rank, 7);
        assert_eq!(
            reported[0].project_name.as_deref(),
            Some("P"),
            "the row must name the project so the queue can route it",
        );
        assert!(
            reported[0].progress.is_none(),
            "a KPI has no progress; 0 would read as 'measured, at zero'",
        );
        assert!(
            reported[0].detail.contains("derivation"),
            "the signal must say WHY it matters, not just that the number is old: {}",
            reported[0].detail,
        );
        assert!(reported[0].age_hours.unwrap() >= 29 * 24);
    }

    #[test]
    fn the_staleness_window_follows_the_kpis_own_cadence() {
        let pool = crate::init_test_db().unwrap();
        let p = create_project(
            &pool,
            "P",
            "/tmp/kpi-cadence",
            None,
            None,
            None,
            None,
            Some("team-1"),
        )
        .unwrap();

        // 5 days without a reading: past a DAILY KPI's 2-day window, well
        // inside a WEEKLY one's 14-day window. One global cutoff cannot say
        // both, which is the whole point.
        let daily = kpi(&pool, &p.id, "daily", "daily", "active");
        measured(&pool, &daily.id, 5);
        let weekly = kpi(&pool, &p.id, "weekly", "weekly", "active");
        measured(&pool, &weekly.id, 5);

        let q = attention_queue(&pool, AttentionThresholds::default()).unwrap();
        let ids: Vec<&str> = kinds(&q, "kpi_gone_dark")
            .iter()
            .map(|i| i.entity_id.as_str())
            .collect();
        assert_eq!(ids, vec![daily.id.as_str()]);
    }

    #[test]
    fn never_measured_is_a_different_signal_from_gone_dark() {
        let pool = crate::init_test_db().unwrap();
        let p = create_project(
            &pool,
            "P",
            "/tmp/kpi-never",
            None,
            None,
            None,
            None,
            Some("team-1"),
        )
        .unwrap();

        let never = kpi(&pool, &p.id, "never wired up", "weekly", "active");
        set(
            &pool,
            "UPDATE dev_kpis SET created_at = ?1 WHERE id = ?2",
            &[&ago(30, 0), &never.id],
        );
        // Activated moments ago and not yet measured: not an accusation, just
        // a KPI that has not had its window.
        let brand_new = kpi(&pool, &p.id, "just activated", "weekly", "active");

        let q = attention_queue(&pool, AttentionThresholds::default()).unwrap();
        let reported = kinds(&q, "kpi_never_measured");
        assert_eq!(reported.len(), 1);
        assert_eq!(reported[0].entity_id, never.id);
        assert_eq!(reported[0].rank, 8, "a different rank from gone-dark");
        assert!(reported[0].detail.contains("never measured"));
        assert!(
            kinds(&q, "kpi_gone_dark").is_empty(),
            "a KPI with no reading at all has not 'gone dark' — it never started",
        );
        assert!(
            !q.items.iter().any(|i| i.entity_id == brand_new.id),
            "a freshly activated KPI is not yet overdue for its first reading",
        );
    }

    #[test]
    fn kpis_that_are_silent_on_purpose_or_unowned_stay_out_of_the_queue() {
        let pool = crate::init_test_db().unwrap();
        let owned = create_project(
            &pool,
            "Owned",
            "/tmp/kpi-owned",
            None,
            None,
            None,
            None,
            Some("team-1"),
        )
        .unwrap();
        let teamless = create_project(
            &pool,
            "Teamless",
            "/tmp/kpi-teamless",
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap();

        for status in ["paused", "archived", "proposed"] {
            let k = kpi(&pool, &owned.id, status, "weekly", status);
            measured(&pool, &k.id, 60);
        }
        // Active + ancient, but nobody derives goals for a team-less project,
        // so claiming derivation stopped would be false.
        let orphan = kpi(&pool, &teamless.id, "orphan", "weekly", "active");
        measured(&pool, &orphan.id, 60);

        let q = attention_queue(&pool, AttentionThresholds::default()).unwrap();
        assert!(
            !q.items.iter().any(|i| i.entity_kind == "kpi"),
            "paused/archived/proposed KPIs are silent on purpose, and a team-less \
             project never derived anything to stop: {:?}",
            q.items.iter().map(|i| &i.entity_title).collect::<Vec<_>>(),
        );
    }

    // ---------------------------------------------------------------- C1 ----

    #[test]
    fn every_task_mutation_stamps_updated_at() {
        let pool = crate::init_test_db().unwrap();
        let p = create_project(&pool, "P", "/tmp/stamp", None, None, None, None, None).unwrap();

        let created = create_task(&pool, Some(&p.id), "t", None, None, None, None, None).unwrap();
        let first = created
            .updated_at
            .clone()
            .expect("create_task must stamp updated_at");
        assert_eq!(first, created.created_at);

        // Backdate, then mutate: the write must move the stamp forward.
        set(
            &pool,
            "UPDATE dev_tasks SET updated_at = ?1 WHERE id = ?2",
            &[&ago(5, 0), &created.id],
        );
        let ran = update_task(
            &pool,
            &created.id,
            None,
            None,
            Some("running"),
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap();
        let after = ran
            .updated_at
            .clone()
            .expect("update_task must stamp updated_at");
        assert!(
            parse_stamp(&after).unwrap() > parse_stamp(&ago(1, 0)).unwrap(),
            "a status write must refresh the heartbeat (got {after})",
        );

        // A no-op update changes nothing, so it must NOT forge a heartbeat.
        set(
            &pool,
            "UPDATE dev_tasks SET updated_at = ?1 WHERE id = ?2",
            &[&ago(5, 0), &created.id],
        );
        let noop = update_task(
            &pool,
            &created.id,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap();
        assert_eq!(
            parse_stamp(&noop.updated_at.unwrap()).unwrap().date_naive(),
            parse_stamp(&ago(5, 0)).unwrap().date_naive(),
            "an all-None update mutates nothing and must not look like activity",
        );

        // A retry is a new row and starts its own clock.
        let retried = retry_task(&pool, &created.id).unwrap();
        assert!(
            retried.updated_at.is_some(),
            "retry_task must stamp updated_at"
        );
    }

    #[test]
    fn the_migration_backfills_updated_at_instead_of_leaving_it_null() {
        // Simulate a pre-migration row: NULL updated_at with real lifecycle
        // stamps. The backfill rule (COALESCE(completed_at, started_at,
        // created_at)) is what readers COALESCE onto, so a legacy row must not
        // read as either "never touched" or "touched now".
        let pool = crate::init_test_db().unwrap();
        let p = create_project(&pool, "P", "/tmp/backfill", None, None, None, None, None).unwrap();
        let t = create_task(
            &pool,
            Some(&p.id),
            "legacy",
            None,
            None,
            None,
            Some("running"),
            None,
        )
        .unwrap();
        set(
            &pool,
            "UPDATE dev_tasks SET updated_at = NULL, started_at = ?1, created_at = ?1 WHERE id = ?2",
            &[&ago(2, 0), &t.id],
        );

        let read = get_task_by_id(&pool, &t.id).unwrap();
        assert!(read.updated_at.is_none(), "the NULL must survive the read");

        // …and the queue still judges it, falling back to started_at.
        let q = attention_queue(&pool, AttentionThresholds::default()).unwrap();
        let stuck = kinds(&q, "stuck_task");
        assert_eq!(
            stuck.len(),
            1,
            "a NULL updated_at must not hide a stuck task"
        );
        assert!(stuck[0].age_hours.unwrap() >= 47);

        let conn = pool.get().unwrap();
        conn.execute(
            "UPDATE dev_tasks SET updated_at = COALESCE(completed_at, started_at, created_at)
             WHERE updated_at IS NULL",
            [],
        )
        .unwrap();
        let filled = get_task_by_id(&pool, &t.id).unwrap();
        assert_eq!(
            filled.updated_at.as_deref(),
            filled.started_at.as_deref(),
            "backfill must take the row's most recent real stamp",
        );
    }
}
