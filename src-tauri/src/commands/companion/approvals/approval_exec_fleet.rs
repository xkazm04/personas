//! `approval_exec_fleet` — part of the approval module family (split from the
//! former approvals.rs god file, 2026-07-24). Shared imports, status
//! consts and the Tauri-facing types live in `mod.rs`; siblings are
//! reachable through the parent's glob re-exports.

#[allow(unused_imports)]
use super::*;

/// Spawn a proactive Athena turn that reviews the whole fleet (or one team)
/// against the certification rubric — the post-certification "are the teams on
/// track?" analysis. Athena gathers current state from her observability digest
/// + connectors, recalls her prior per-team note (timeline continuity), writes
/// an updated note, and proposes improvements via her normal approval-gated ops.
pub(crate) async fn execute_analyze_fleet(
    state: &State<'_, Arc<AppState>>,
    app: &tauri::AppHandle,
    params: &serde_json::Value,
) -> Result<ExecuteResult, AppError> {
    let team = params.get("team_id").and_then(|v| v.as_str());
    let days = params
        .get("days")
        .and_then(|v| v.as_i64())
        .unwrap_or(14)
        .clamp(1, 90);
    spawn_fleet_analysis(state, app, team, days);
    let scope = team
        .map(|t| format!("team `{t}`"))
        .unwrap_or_else(|| "the whole fleet".into());
    Ok(ExecuteResult::message(format!(
        "Fleet analysis started — Athena is reviewing {scope} over the last {days}d and will report back here."
    )))
}

/// Compact per-team execution digest from the OPERATIONAL store (state.db),
/// embedded in the directive so the turn reasons over real numbers. Best-effort:
/// any query failure degrades to a short note rather than aborting the turn.
pub(crate) fn gather_fleet_digest(db: &crate::db::DbPool, team: Option<&str>, days: i64) -> String {
    let conn = match db.get() {
        Ok(c) => c,
        Err(e) => return format!("(fleet data unavailable: {e})"),
    };
    // `persona_executions.created_at` is stored as RFC3339 (`chrono::Utc::now().to_rfc3339()`),
    // so a `datetime('now', ?)` string compare mis-orders on the `T`/`Z` separator (see
    // `gather_daily_brief_digest` above for the same trap). Use julianday() math instead.
    let win_days = days as f64;
    let all_teams: Vec<(String, String)> = match conn
        .prepare("SELECT id, name FROM persona_teams WHERE COALESCE(enabled,1)=1 ORDER BY name")
    {
        Ok(mut stmt) => stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .map(|rows| rows.filter_map(Result::ok).collect())
            .unwrap_or_default(),
        Err(_) => Vec::new(),
    };
    let teams: Vec<(String, String)> = all_teams
        .into_iter()
        .filter(|(id, name)| {
            team.map_or(true, |t| {
                t == id || name.to_lowercase().contains(&t.to_lowercase())
            })
        })
        .collect();
    if teams.is_empty() {
        return "(no matching teams in the operational store)".to_string();
    }
    let mut out = format!("## Fleet data — operational store (personas.db), last {days}d\n");
    for (id, name) in teams {
        let short = &id[..id.len().min(8)];
        let agg = conn.query_row(
            "SELECT COUNT(*),
                    SUM(CASE WHEN status IN ('failed','error','timeout') THEN 1 ELSE 0 END),
                    SUM(CASE WHEN business_outcome='value_delivered' THEN 1 ELSE 0 END),
                    SUM(CASE WHEN business_outcome='partial' THEN 1 ELSE 0 END),
                    SUM(CASE WHEN business_outcome='precondition_failed' THEN 1 ELSE 0 END),
                    COALESCE(SUM(cost_usd),0),
                    AVG(director_score)
             FROM persona_executions
             WHERE COALESCE(is_simulation,0)=0
               AND julianday('now') - julianday(created_at) <= ?1
               AND persona_id IN (
                 SELECT id FROM personas WHERE home_team_id = ?2
                 UNION SELECT persona_id FROM persona_team_members WHERE team_id = ?2
               )",
            params![win_days, id],
            |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, i64>(1).unwrap_or(0),
                    r.get::<_, i64>(2).unwrap_or(0),
                    r.get::<_, i64>(3).unwrap_or(0),
                    r.get::<_, i64>(4).unwrap_or(0),
                    r.get::<_, f64>(5).unwrap_or(0.0),
                    r.get::<_, Option<f64>>(6).unwrap_or(None),
                ))
            },
        );
        // Goal-linked via EITHER a team_assignment's goal_id OR a goal on the
        // team's pinned dev_project (the natural association — a team works its
        // repo; goals live on the project, not the assignment).
        let assignment_goals: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM team_assignments ta JOIN dev_goals g ON g.id = ta.goal_id WHERE ta.team_id = ?1",
                params![id],
                |r| r.get(0),
            )
            .unwrap_or(0);
        let project_id: Option<String> = {
            let mut found = None;
            if let Ok(mut stmt) = conn.prepare(
                "SELECT design_context FROM personas WHERE (home_team_id = ?1 OR id IN (SELECT persona_id FROM persona_team_members WHERE team_id = ?1)) AND design_context IS NOT NULL",
            ) {
                if let Ok(rows) = stmt.query_map(params![id], |r| r.get::<_, String>(0)) {
                    for dc in rows.flatten() {
                        if let Ok(j) = serde_json::from_str::<serde_json::Value>(&dc) {
                            if let Some(p) = j
                                .get("dev_project_id")
                                .or_else(|| j.get("devProjectId"))
                                .and_then(|v| v.as_str())
                            {
                                found = Some(p.to_string());
                                break;
                            }
                        }
                    }
                }
            }
            found
        };
        // Goal ENGAGEMENT (extended scope): is a team_assignment actively
        // advancing a goal, and how are the goal's breakdown to-dos progressing?
        let advancing = assignment_goals > 0;
        let mut goal_summ: Vec<String> = Vec::new();
        if let Some(pid) = project_id.as_deref() {
            if let Ok(mut stmt) = conn.prepare(
                "SELECT id, title, status, COALESCE(progress,0) FROM dev_goals WHERE project_id = ?1 ORDER BY created_at DESC LIMIT 5",
            ) {
                if let Ok(rows) = stmt.query_map(params![pid], |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                        r.get::<_, i64>(3)?,
                    ))
                }) {
                    for (gid, title, status, progress) in rows.flatten() {
                        let (td, tt): (i64, i64) = conn
                            .query_row(
                                "SELECT COALESCE(SUM(done),0), COUNT(*) FROM dev_goal_items WHERE goal_id = ?1",
                                params![gid],
                                |r| Ok((r.get(0)?, r.get(1)?)),
                            )
                            .unwrap_or((0, 0));
                        let blk: i64 = conn
                            .query_row(
                                "SELECT COUNT(*) FROM dev_goal_dependencies WHERE goal_id = ?1",
                                params![gid],
                                |r| r.get(0),
                            )
                            .unwrap_or(0);
                        let blk_s = if blk > 0 { format!(", {blk} blocker(s)") } else { String::new() };
                        let t: String = title.chars().take(40).collect();
                        goal_summ.push(format!("\"{t}\" {status} {progress}% (to-dos {td}/{tt}{blk_s})"));
                    }
                }
            }
        }
        let last_signal: Option<String> = project_id.as_deref().and_then(|pid| {
            conn.query_row(
                "SELECT s.signal_type FROM dev_goal_signals s JOIN dev_goals g ON g.id = s.goal_id WHERE g.project_id = ?1 ORDER BY s.created_at DESC LIMIT 1",
                params![pid],
                |r| r.get::<_, String>(0),
            )
            .ok()
        });
        let goal_state = if goal_summ.is_empty() {
            "goal: NONE".to_string()
        } else {
            let mode = if advancing { "ADVANCING" } else { "has-goal/NOT-advancing" };
            let sig = last_signal.map(|s| format!(" · last-goal-signal {s}")).unwrap_or_default();
            format!("goal [{mode}]: {}{sig}", goal_summ.join("; "))
        };
        match agg {
            Ok((total, failed, vd, partial, pf, cost, dir)) => {
                // Director score + band (mirrors the Director command-center banding
                // so the digest carries the same quality semantics, not a bare number).
                let dir_s = dir
                    .map(|d| {
                        let band = if d >= 4.0 {
                            "excellent"
                        } else if d >= 3.0 {
                            "healthy"
                        } else if d >= 2.0 {
                            "at-risk"
                        } else {
                            "broken"
                        };
                        format!("{d:.1}/5 ({band})")
                    })
                    .unwrap_or_else(|| "— (unrated)".into());
                out.push_str(&format!(
                    "- **{name}** (`{short}`): {total} exec · {failed} failed · vd {vd} · partial {partial} · precond {pf} · ${cost:.2} · director {dir_s} · {goal_state}\n",
                ));
            }
            Err(_) => out.push_str(&format!("- **{name}** (`{short}`): (no execution data) · {goal_state}\n")),
        }
    }
    out
}

/// The directive handed to the proactive fleet-analysis turn. The per-team data
/// is pre-gathered (`gather_fleet_digest`) and embedded, so Athena reasons over
/// real numbers instead of trying to fetch them via the wrong-DB connector.
pub(crate) fn build_fleet_directive(team: Option<&str>, days: i64, digest: &str) -> String {
    let scope = match team {
        Some(t) => format!("the team `{t}`"),
        None => "every active team (the whole fleet)".to_string(),
    };
    format!(
        "Run a fleet analysis of {scope} over the last {days} days. You are the \
         post-certification analyst: the user is letting all teams run and needs to not \
         lose control.\n\n\
         The per-team data is ALREADY GATHERED for you below, from the OPERATIONAL store. \
         Reason over THIS — do NOT try to fetch it via a connector (your personas_database \
         connector points at the companion-brain DB, not the execution store):\n\n\
         {digest}\n\n\
         For each team, assess against these certification dimensions: (1) GOAL ENGAGEMENT \
         (the focus this round) — is a team_assignment ACTIVELY ADVANCING the goal, or does \
         the goal just sit on the project ('has-goal/NOT-advancing')? How complete are the \
         goal's breakdown to-dos (the `to-dos X/Y` per goal)? Is it blocked (blocker count)? \
         When did the team last touch it (`last-goal-signal`)? 'has-goal/NOT-advancing', \
         '0 to-dos done', or no recent goal signal are real gaps — call them out and propose \
         a fix. (2) value delivery — value-delivered vs partial / precond-failed; (3) health \
         — failures; (4) cost + outliers; (5) portfolio balance. Then: (a) recall any prior \
         fleet-analysis note \
         from your memory for timeline continuity (did last round's gap get fixed?); \
         (b) write a concise per-team timeline note via write_fact (scope the fact to the \
         team) so the next review builds on this one; (c) propose at most a few concrete \
         improvements (update_dev_goal, a template/roster fix, a persona to add) as your \
         approval-gated ops. Ground every claim in the data above. If a team is healthy and \
         nothing changed since your last note, say so in one line."
    )
}

/// Shared spawn used by both the approval-gated `analyze_fleet` op executor and
/// the direct `companion_analyze_fleet` command (the skill button). Spawns a
/// proactive turn carrying the fleet-analysis directive.
pub(crate) fn spawn_fleet_analysis(
    state: &State<'_, Arc<AppState>>,
    app: &tauri::AppHandle,
    team: Option<&str>,
    days: i64,
) {
    // Pre-gather per-team data from the OPERATIONAL store (state.db) and embed
    // it in the directive. Athena's personas_database connector points at the
    // companion-brain DB, not the execution store, so asking her to fetch it
    // fails — we supply it instead.
    let digest = gather_fleet_digest(&state.db, team, days);
    let directive = build_fleet_directive(team, days, &digest);
    crate::companion::session::spawn_proactive_turn(
        app.clone(),
        std::sync::Arc::new(state.user_db.clone()),
        std::sync::Arc::new(state.db.clone()),
        #[cfg(feature = "ml")]
        state.embedding_manager.clone(),
        "fleet_analysis".to_string(),
        team.map(str::to_string),
        directive,
    );
}

/// Direct, deterministic fleet-analysis trigger for the "Analyze fleet" skill
/// button. Unlike a chat message — which Athena can reasonably shortcut to an
/// inline read from her observability digest — this ALWAYS spawns the
/// rubric-graded proactive turn that writes the per-team timeline note (the
/// continuity that is the whole point). The button click is the consent, so
/// there is no approval gate.
#[tauri::command]
pub fn companion_analyze_fleet(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    team_id: Option<String>,
    days: Option<i64>,
) -> Result<String, AppError> {
    let days = days.unwrap_or(14).clamp(1, 90);
    spawn_fleet_analysis(&state, &app, team_id.as_deref(), days);
    Ok("Fleet analysis started.".to_string())
}

/// Compact digest across the three operational inboxes — Messages
/// (`persona_messages`), Human Review (`persona_manual_reviews`), and Incidents
/// (`audit_incidents`) — pulled from the OPERATIONAL store (`state.db` /
/// personas.db) and embedded in the daily-brief directive. Athena's
/// `personas_database` connector points at the companion-brain DB, not the
/// execution store, so she can't fetch these herself — we supply them (same
/// rationale as `gather_fleet_digest`). Best-effort: any query failure degrades
/// to a short note rather than aborting the turn.
pub(crate) fn gather_daily_brief_digest(db: &crate::db::DbPool, hours: i64) -> String {
    let conn = match db.get() {
        Ok(c) => c,
        Err(e) => return format!("(brief data unavailable: {e})"),
    };
    // Window expressed in fractional days for julianday() math. This is uniform
    // across the three tables despite their mixed `created_at` formats
    // (persona_messages / persona_manual_reviews store RFC3339; audit_incidents
    // stores SQLite datetime-text) — julianday() parses both, and both stored
    // times and `now` are UTC. A plain `created_at >= datetime('now', …)` string
    // compare would be wrong for the RFC3339 columns (the `T`/`Z` break ordering).
    let win_days = (hours as f64) / 24.0;

    let mut out = format!(
        "## Operational inboxes — last {hours}h (operational store, personas.db)\n"
    );

    // 1) Messages — agent output the user reads.
    {
        let agg = conn.query_row(
            "SELECT COUNT(*),
                    SUM(CASE WHEN COALESCE(is_read,0)=0 THEN 1 ELSE 0 END),
                    SUM(CASE WHEN COALESCE(priority,'normal') NOT IN ('low','normal') THEN 1 ELSE 0 END)
             FROM persona_messages
             WHERE julianday('now') - julianday(created_at) <= ?1",
            params![win_days],
            |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, i64>(1).unwrap_or(0),
                    r.get::<_, i64>(2).unwrap_or(0),
                ))
            },
        );
        match agg {
            Ok((total, unread, high)) if total > 0 => {
                out.push_str(&format!(
                    "\n### Messages\n- {total} new ({unread} unread, {high} elevated-priority)\n"
                ));
                if let Ok(mut stmt) = conn.prepare(
                    "SELECT COALESCE(NULLIF(title,''),'(untitled)'), COALESCE(priority,'normal')
                     FROM persona_messages
                     WHERE julianday('now') - julianday(created_at) <= ?1
                     ORDER BY created_at DESC LIMIT 5",
                ) {
                    if let Ok(rows) = stmt.query_map(params![win_days], |r| {
                        Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
                    }) {
                        for (title, prio) in rows.flatten() {
                            let t: String = title.chars().take(70).collect();
                            let tag = if prio != "low" && prio != "normal" {
                                format!(" [{prio}]")
                            } else {
                                String::new()
                            };
                            out.push_str(&format!("  - {t}{tag}\n"));
                        }
                    }
                }
            }
            Ok(_) => out.push_str("\n### Messages\n- none in the window\n"),
            Err(_) => out.push_str("\n### Messages\n- (unavailable)\n"),
        }
    }

    // 2) Human Review — items awaiting the user's decision. Also report the
    // current open backlog regardless of age: a daily brief should flag a review
    // that's been waiting since before the window (those are the overdue ones).
    {
        let agg = conn.query_row(
            "SELECT COUNT(*),
                    SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END)
             FROM persona_manual_reviews
             WHERE julianday('now') - julianday(created_at) <= ?1",
            params![win_days],
            |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1).unwrap_or(0))),
        );
        let open_backlog: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM persona_manual_reviews WHERE status='pending'",
                [],
                |r| r.get(0),
            )
            .unwrap_or(0);
        match agg {
            Ok((total, _pending_in_window)) => {
                out.push_str(&format!(
                    "\n### Human Review\n- {total} new this window · {open_backlog} pending total (all ages)\n"
                ));
                if open_backlog > 0 {
                    if let Ok(mut stmt) = conn.prepare(
                        "SELECT COALESCE(NULLIF(title,''),'(untitled)'), COALESCE(severity,'info')
                         FROM persona_manual_reviews
                         WHERE status='pending' ORDER BY created_at ASC LIMIT 5",
                    ) {
                        if let Ok(rows) = stmt.query_map([], |r| {
                            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
                        }) {
                            for (title, sev) in rows.flatten() {
                                let t: String = title.chars().take(70).collect();
                                out.push_str(&format!("  - {t} ({sev})\n"));
                            }
                        }
                    }
                }
            }
            Err(_) => out.push_str("\n### Human Review\n- (unavailable)\n"),
        }
    }

    // 3) Incidents — failures/alerts triaged into one inbox. Same window-plus-
    // backlog shape: surface what's still OPEN, severity-ordered.
    {
        let agg = conn.query_row(
            "SELECT COUNT(*),
                    SUM(CASE WHEN severity IN ('high','critical') THEN 1 ELSE 0 END)
             FROM audit_incidents
             WHERE julianday('now') - julianday(created_at) <= ?1",
            params![win_days],
            |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1).unwrap_or(0))),
        );
        let (open_total, open_sev): (i64, i64) = conn
            .query_row(
                "SELECT COUNT(*),
                        SUM(CASE WHEN severity IN ('high','critical') THEN 1 ELSE 0 END)
                 FROM audit_incidents WHERE status IN ('open','acknowledged')",
                [],
                |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1).unwrap_or(0))),
            )
            .unwrap_or((0, 0));
        match agg {
            Ok((total, sev)) => {
                out.push_str(&format!(
                    "\n### Incidents\n- {total} new this window ({sev} high/critical) · {open_total} open total ({open_sev} high/critical)\n"
                ));
                if open_total > 0 {
                    if let Ok(mut stmt) = conn.prepare(
                        "SELECT COALESCE(NULLIF(title,''),'(untitled)'), COALESCE(severity,'low'), status
                         FROM audit_incidents
                         WHERE status IN ('open','acknowledged')
                         ORDER BY CASE severity
                                    WHEN 'critical' THEN 0 WHEN 'high' THEN 1
                                    WHEN 'medium' THEN 2 ELSE 3 END,
                                  created_at DESC
                         LIMIT 5",
                    ) {
                        if let Ok(rows) = stmt.query_map([], |r| {
                            Ok((
                                r.get::<_, String>(0)?,
                                r.get::<_, String>(1)?,
                                r.get::<_, String>(2)?,
                            ))
                        }) {
                            for (title, sev, status) in rows.flatten() {
                                let t: String = title.chars().take(70).collect();
                                out.push_str(&format!("  - {t} ({sev}, {status})\n"));
                            }
                        }
                    }
                }
            }
            Err(_) => out.push_str("\n### Incidents\n- (unavailable)\n"),
        }
    }

    out
}

/// The directive handed to the proactive daily-brief turn. The inbox data is
/// pre-gathered (`gather_daily_brief_digest`) and embedded, so Athena reasons
/// over real numbers instead of trying to fetch them via the wrong-DB connector.
pub(crate) fn build_daily_brief_directive(hours: i64, digest: &str) -> String {
    format!(
        "Compose the user's daily brief: a tight, skimmable summary of what happened across \
         their three operational inboxes in the last {hours} hours — Messages (agent output they \
         read), Human Review (items awaiting their decision), and Incidents (failures and alerts).\n\n\
         The data is ALREADY GATHERED for you below, from the OPERATIONAL store. Reason over THIS \
         — do NOT try to fetch it via a connector (your personas_database connector points at the \
         companion-brain DB, not the execution store):\n\n\
         {digest}\n\n\
         Write the brief directly in chat (no approval, no card). Lead with the single most \
         important thing to act on first. Then one or two short lines per inbox: flag unread / \
         elevated-priority messages, anything still PENDING in Human Review (items older than the \
         window are overdue — call those out), and any OPEN high/critical incidents. If a section \
         is quiet, say so in one line and move on — don't pad. Close with one concrete suggested \
         next action only if something clearly needs it. Keep the whole thing readable in under a \
         minute, and ground every number in the data above."
    )
}

/// Direct, deterministic "Daily brief" trigger for the companion sidebar button.
/// Pre-gathers the three operational inboxes (Messages / Human Review /
/// Incidents) over the last `hours` (default 24) from the operational store and
/// spawns a proactive turn that summarizes them in chat. Like
/// `companion_analyze_fleet`, it bypasses the chat round-trip so Athena can't
/// shortcut past the wrong-DB connector; the button click is the consent, so
/// there is no approval gate.
#[tauri::command]
pub fn companion_daily_brief(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    hours: Option<i64>,
) -> Result<String, AppError> {
    let hours = hours.unwrap_or(24).clamp(1, 168);
    let digest = gather_daily_brief_digest(&state.db, hours);
    let directive = build_daily_brief_directive(hours, &digest);
    crate::companion::session::spawn_proactive_turn(
        app.clone(),
        std::sync::Arc::new(state.user_db.clone()),
        std::sync::Arc::new(state.db.clone()),
        #[cfg(feature = "ml")]
        state.embedding_manager.clone(),
        "daily_brief".to_string(),
        None,
        directive,
    );
    Ok("Daily brief started.".to_string())
}

#[cfg(test)]
mod multiselect_tests {
    use super::multiselect_keystrokes;

    fn menu() -> Vec<String> {
        // Mirrors the live AskUserQuestion multi-select layout.
        [
            "Which toppings would you like to add?",
            "❯ 1. [ ] Cheese",
            "  2. [ ] Mushroom",
            "  3. [ ] Pepperoni",
            "  4. [ ] Onion",
            "  5. [ ] Type something",
            "     Submit",
            "  6. Chat about this",
            "Enter to select · ↑/↓ to navigate · Esc to cancel",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect()
    }

    /// Render a plan the SAME way the trace and the debug log do, so a failing
    /// assertion here reads exactly like the artifact you'd inspect in the
    /// field. Previously this was a private `SP,DN,CR` vocabulary that existed
    /// nowhere else — two notations for one concept.
    fn flat(keys: &[Vec<u8>]) -> String {
        crate::commands::fleet::keys::describe_plan(keys)
    }

    #[test]
    fn select_all_four_then_submit_and_confirm() {
        let keys = multiselect_keystrokes(&menu(), "1,2,3,4").expect("a multi-select plan");
        // Per option: SP then DN (last option no trailing DN); DN past option4,
        // DN past 'Type something' to Submit; CR (confirm), CR (finalize).
        assert_eq!(flat(&keys), "<Space><Down><Space><Down><Space><Down><Space><Down><Down><CR><CR>");
    }

    #[test]
    fn skips_already_checked_options() {
        let mut m = menu();
        m[1] = "❯ 1. [✔] Cheese".to_string(); // Cheese already selected
        let keys = multiselect_keystrokes(&m, "1,2").expect("a plan");
        // Option 1 already checked → no SP (just DN to opt2); option 2
        // wanted+unchecked → SP, DN; opts 3,4 not wanted → DN each; then DN
        // past 'Type something' to Submit; CR, CR.
        assert_eq!(flat(&keys), "<Down><Space><Down><Down><Down><Down><CR><CR>");
    }

    /// Tabbed AskUserQuestion layout (Claude Code ≥ mid-2026): a `←  ☐ Question
    /// ✔ Submit  →` tab bar above the options. Submission is the Submit TAB (→
    /// then Enter), not a row below the list. Mirrors the 2026-07-24 live screen.
    fn tabbed_menu() -> Vec<String> {
        [
            "←  ☐ Improvements  ✔ Submit  →",
            "Which improvements should I implement? (pick any combination)",
            "❯ 1. [ ] Highlight + copy UE5 code",
            "  2. [ ] Accessible sliders & buttons",
            "  3. [ ] Plain-language jargon tooltips",
            "  4. [ ] Accessible formation diagram",
            "  5. [ ] Type something",
            "     Submit",
            "  6. Chat about this",
            "Enter to select · ↑/↓ to navigate · Esc to cancel",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect()
    }

    #[test]
    fn tabbed_layout_submits_via_right_arrow() {
        let keys = multiselect_keystrokes(&tabbed_menu(), "1,2").expect("a plan");
        // Toggle 1 and 2 (SP,DN,SP), DN past 3 and 4 keeps cursor deterministic,
        // then RT to the Submit tab and CR on "Submit answers" — no DN-hunt for
        // a Submit row, no double Enter.
        assert_eq!(flat(&keys), "<Space><Down><Space><Down><Down><Right><CR>");
    }

    #[test]
    fn none_for_non_menu_or_freetext() {
        // No checkbox menu.
        assert!(multiselect_keystrokes(&["just some prose".to_string()], "1,2").is_none());
        // A menu but a free-text (non-numeric) answer.
        assert!(multiselect_keystrokes(&menu(), "throw an error").is_none());
    }
}

pub(crate) fn execute_fleet_send_input(
    app: &tauri::AppHandle,
    params: &serde_json::Value,
) -> Result<ExecuteResult, AppError> {
    let raw_id = params
        .get("session_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Internal("fleet_send_input: missing `session_id`".into()))?;
    // Accept either the fleet-session id or the bound claude_session_id —
    // Athena frequently holds the latter (transcript/cc id), and the registry
    // is keyed by the former. Unresolvable ids pass through unchanged so the
    // downstream writers report their normal "session not found".
    let session_id = crate::commands::fleet::registry::registry()
        .resolve_session_id(raw_id)
        .unwrap_or_else(|| raw_id.to_string());
    let session_id = session_id.as_str();
    let text = params
        .get("text")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Internal("fleet_send_input: missing `text`".into()))?;
    let press_enter = params
        .get("press_enter")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);

    // DOZED target — the answer can't be typed (no PTY writer), and even after
    // a wake it would be meaningless: `claude --resume` does NOT re-render the
    // question TUI that was on screen, so the computed answer has nothing to
    // land on. Convert the fire into the recovery playbook proven live on
    // 2026-07-24: wake the session (lineage-adopting resume), then after boot
    // nudge it to RE-ASK its pending question — the re-asked question flows
    // through the normal hook → batch → driver path against a live PTY.
    if crate::commands::fleet::registry::registry().is_dozing(session_id) {
        let app = app.clone();
        let sid = session_id.to_string();
        crate::commands::fleet::debug_log::athena(
            &sid,
            "dozed target — wake + re-ask",
            "answer converted to a wake and a re-ask nudge (resume drops the question TUI)",
        );
        tauri::async_runtime::spawn(async move {
            let new_id = match crate::commands::fleet::commands::fleet_wake_session(
                app.clone(),
                sid.clone(),
                None,
                None,
            )
            .await
            {
                Ok(id) => id,
                Err(e) => {
                    tracing::warn!(session_id = %sid, error = %e, "dozed-target wake failed");
                    return;
                }
            };
            // Let the resumed CLI boot and answer its continuation prompt.
            tokio::time::sleep(std::time::Duration::from_secs(25)).await;
            let _ = crate::commands::fleet::registry::registry().write_text_line(
                &new_id,
                "Resume: if you were waiting on my answer to a question, re-ask it now \
                 using your question tool (same options); otherwise continue with your \
                 current phase.",
            );
        });
        return Ok(ExecuteResult::message(format!(
            "Session `{}` was asleep — woke it and asked it to re-surface its question \
             (the answer will be delivered on the fresh prompt).",
            &session_id[..session_id.len().min(8)],
        )));
    }

    // MULTI-SELECT detection. A Claude Code AskUserQuestion multi-select is a
    // checkbox TUI: a typed string like "1,2,3,4" only toggles the first item and
    // never submits (verified live). Driving it needs ↑/↓ navigation + space to
    // toggle each + Enter on Submit + Enter to confirm — and the keystrokes must
    // be SPACED (~120ms); the TUI drops a rapid burst. We read the reconstructed
    // screen (vt100) to recognize the menu and compute the toggle plan, then fire
    // the keys on a timed task. Single-select / free-text falls through to the
    // plain typed answer below.
    if let Some((_, lines)) = crate::commands::fleet::registry::registry().render_screen_for(session_id) {
        if let Some(keys) = multiselect_keystrokes(&lines, text) {
            let sid = session_id.to_string();
            let count = keys.len();
            // DIAGNOSTIC (16x run, 2026-07-24): all seven driven multi-selects
            // silently failed — plan played, menu never submitted, sessions
            // dozed with the answers lost. Until the failure is reproduced with
            // this trace in hand, every drive logs the screen it saw and the
            // exact plan, and CONFIRMS the submit (session flips Running) with
            // one Enter retry — mirroring write_text_line's contract, which the
            // driver path predated.
            let plan_notation = crate::commands::fleet::keys::describe_plan(&keys);
            tracing::warn!(
                target: "fleet_multiselect",
                session_id = %sid,
                plan = %plan_notation,
                screen = %lines.join("\n").chars().take(2200).collect::<String>(),
                "driving multi-select — screen + plan (diagnostic)"
            );
            // The plan now rides into the SHAREABLE log too. It couldn't before:
            // the only rendering was raw byte chunks. `describe_plan` redacts any
            // text chunk to `text(Nch)`, so this carries the plan's shape without
            // the terminal contents the recorder is contractually forbidden from
            // writing — and "N keystrokes" alone was never enough to tell a
            // correct plan from one that walked onto the wrong row.
            crate::commands::fleet::debug_log::athena(
                &sid,
                "driving multi-select",
                &format!("{count} keystrokes, 200ms pace, submit-confirmed · {plan_notation}"),
            );
            // MUST be the app's long-lived runtime. This executor runs inside a
            // proactive turn's throwaway current-thread runtime — a plain
            // tokio::spawn dies WITH that runtime the moment the turn returns,
            // killing the keystroke task mid-plan. That was the real cause of
            // the 16x run's seven silent multi-select failures (keys partially
            // played, no confirm, sessions dozed with answers lost); the plain
            // text path never hit it because write_text_line already spawns on
            // tauri::async_runtime.
            tauri::async_runtime::spawn(async move {
                for k in keys {
                    if let Err(e) =
                        crate::commands::fleet::registry::registry().write_input(&sid, &k)
                    {
                        tracing::warn!(session_id = %sid, error = %e, "multi-select drive: write failed");
                        return;
                    }
                    // 200ms (was 120): the TUI drops rapid bursts, and a 16-session
                    // load slows its redraw loop further.
                    tokio::time::sleep(std::time::Duration::from_millis(200)).await;
                }
                // Confirm the menu actually resolved: submission puts the session
                // back to work (UserPromptSubmit / tool hooks → Running). If it
                // never flips, send one extra Enter (a confirm screen the plan
                // under-counted), then report loudly either way.
                for attempt in 1..=2u32 {
                    for _ in 0..10 {
                        tokio::time::sleep(std::time::Duration::from_millis(400)).await;
                        if matches!(
                            crate::commands::fleet::registry::registry().session_state(&sid),
                            Some(crate::commands::fleet::types::FleetSessionState::Running) | None
                        ) {
                            crate::commands::fleet::debug_log::athena(
                                &sid,
                                "multi-select submitted",
                                &format!("confirmed running (attempt {attempt})"),
                            );
                            return;
                        }
                    }
                    if attempt == 1 {
                        // Recovery: if the plan left us anywhere in the question
                        // TUI, → jumps to the Submit tab (harmless elsewhere) and
                        // Enter confirms "Submit answers".
                        let _ =
                            crate::commands::fleet::registry::registry().write_input(&sid, b"\x1b[C");
                        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
                        let _ = crate::commands::fleet::registry::registry().write_input(&sid, b"\r");
                    }
                }
                crate::commands::fleet::debug_log::athena(
                    &sid,
                    "multi-select NOT confirmed",
                    "plan played + extra Enter but the session never resumed — see fleet_multiselect trace for the screen",
                );
                if let Some((_, after)) =
                    crate::commands::fleet::registry::registry().render_screen_for(&sid)
                {
                    tracing::warn!(
                        target: "fleet_multiselect",
                        session_id = %sid,
                        screen_after = %after.join("\n").chars().take(2200).collect::<String>(),
                        "multi-select unconfirmed — screen AFTER the plan"
                    );
                }
            });
            return Ok(ExecuteResult::message(format!(
                "Driving multi-select on `{}` ({count} keystrokes, submit-confirmed).",
                &session_id[..session_id.len().min(8)],
            )));
        }
    }

    // Single-select / free-text: deliver via the confirmed-submit primitive —
    // text and Enter as SEPARATE chunks (a trailing `\r` inside one chunk reads
    // as a pasted newline and never submits; the composer held Athena's text
    // while the session dozed, observed live 2026-07-24), with the submit
    // verified against the session flipping Running and one Enter retry.
    if press_enter {
        crate::commands::fleet::registry::registry()
            .write_text_line(session_id, text)
            .map_err(AppError::Internal)?;
    } else {
        crate::commands::fleet::registry::registry()
            .write_input(session_id, text.as_bytes())
            .map_err(AppError::Internal)?;
    }
    Ok(ExecuteResult::message(format!(
        "Typed {} chars into fleet session `{}`{}{}.",
        text.chars().count(),
        &session_id[..session_id.len().min(8)],
        crate::commands::fleet::registry::registry()
            .try_lookup_label(session_id)
            .map(|l| format!(" ({l})"))
            .unwrap_or_default(),
        if press_enter { " (submit confirmed asynchronously)" } else { "" },
    )))
}

/// Recognize a Claude Code AskUserQuestion MULTI-select menu in a reconstructed
/// screen and, if the answer names option numbers, return the keystroke sequence
/// (one entry per key) to toggle the requested options and submit. `None` for a
/// single-select / free-text answer / non-menu screen (caller types the answer).
///
/// Menu shape (verified live): numbered options with `[ ]`/`[✔]` checkboxes, then
/// a `Type something` row and a `Submit` row, with an `↑/↓ to navigate · Enter to
/// select` hint. The cursor starts on option 1 for a freshly-rendered menu (which
/// is when orchestration fires). Plan: for each option top-down, toggle (space)
/// the requested+unchecked ones (↓ between), step down to Submit (past `Type
/// something` when present), Enter to reach the "Ready to submit?" confirm, Enter
/// again to finalize (its cursor defaults to "Submit answers").
pub(crate) fn multiselect_keystrokes(lines: &[String], text: &str) -> Option<Vec<Vec<u8>>> {
    let joined = lines.join("\n");
    let lower = joined.to_lowercase();
    let has_checkbox = lines.iter().any(|l| {
        let t = l.trim_start().trim_start_matches('❯').trim_start();
        t.contains("[ ]") || t.contains("[✔]") || t.contains("[x]") || t.contains("[X]")
    });
    if !has_checkbox || !joined.contains("Submit") || !lower.contains("navigate") {
        return None;
    }
    // Requested option numbers, e.g. "1,2,3,4" or "1 3".
    let wanted: std::collections::BTreeSet<usize> = text
        .split(|c: char| !c.is_ascii_digit())
        .filter_map(|s| s.parse::<usize>().ok())
        .filter(|n| *n >= 1)
        .collect();
    if wanted.is_empty() {
        return None; // a free-text / label answer isn't a numeric toggle plan
    }
    // Parse toggle options in display order ("N. [state] Label"), skipping the
    // `Type something` / `Submit` pseudo-rows.
    let mut options: Vec<(usize, bool)> = Vec::new();
    for l in lines {
        let t = l.trim_start().trim_start_matches('❯').trim_start();
        let Some(dot) = t.find(". ") else { continue };
        let Ok(num) = t[..dot].trim().parse::<usize>() else { continue };
        let rest = &t[dot + 2..];
        let Some(ob) = rest.find('[') else { continue };
        let Some(cb_rel) = rest[ob..].find(']') else { continue };
        let inside = &rest[ob + 1..ob + cb_rel];
        let checked = inside.contains('✔') || inside.to_lowercase().contains('x');
        let label = rest[ob + cb_rel + 1..].trim();
        if label.starts_with("Type something") || label.starts_with("Submit") {
            continue;
        }
        options.push((num, checked));
    }
    if options.is_empty() {
        return None;
    }
    let n = options.len();
    let has_type_something = joined.contains("Type something");
    // Tabbed AskUserQuestion layout (Claude Code ≥ mid-2026): a tab bar like
    // `←  ☐ Improvements  ✔ Submit  →` sits above the checkbox list. Submission
    // is NOT a row below the options — it's the `Submit` TAB, reached with → and
    // confirmed with Enter ("Ready to submit? ❯ 1. Submit answers"). Verified
    // live 2026-07-24 by driving a stuck session key-by-key: the legacy tail
    // (↓…↓ + Enter Enter) lands on `Type something`/`Chat about this` rows and
    // never submits. The ☐/☒ tab markers only appear in this layout.
    let tabbed = joined.contains('☐') || joined.contains('☒');

    let down: &[u8] = b"\x1b[B";
    let right: &[u8] = crate::commands::fleet::keys::RIGHT;
    let space: &[u8] = b" ";
    let enter: &[u8] = b"\r";
    let mut keys: Vec<Vec<u8>> = Vec::new();
    // NOTE: we deliberately do NOT prepend any ↑ to "clamp" the cursor. The menu
    // is freshly rendered when orchestration fires (cursor already on option 1),
    // and Claude Code's list WRAPS on ↑ at the top — so a clamp would move the
    // cursor to the bottom and the whole plan would land on Cancel. Start from
    // option 1 as given.
    for (i, (num, checked)) in options.iter().enumerate() {
        if wanted.contains(num) && !checked {
            keys.push(space.to_vec());
        }
        if i + 1 < n {
            keys.push(down.to_vec());
        }
    }
    if tabbed {
        keys.push(right.to_vec()); // → jumps to the Submit tab ("Ready to submit?")
        keys.push(enter.to_vec()); // confirm (cursor defaults to "Submit answers")
    } else {
        // Legacy flat layout: step from the last option to the Submit row
        // (past `Type something` when shown).
        keys.push(down.to_vec());
        if has_type_something {
            keys.push(down.to_vec());
        }
        keys.push(enter.to_vec()); // Submit -> "Ready to submit?" confirm
        keys.push(enter.to_vec()); // confirm (defaults to "Submit answers")
    }
    Some(keys)
}

pub(crate) fn execute_fleet_broadcast(params: &serde_json::Value) -> Result<ExecuteResult, AppError> {
    let target = params
        .get("target")
        .and_then(|v| v.as_str())
        .unwrap_or("all_waiting");
    let text = params
        .get("text")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Internal("fleet_broadcast: missing `text`".into()))?;
    let press_enter = params
        .get("press_enter")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    let payload = if press_enter {
        format!("{text}\r")
    } else {
        text.to_string()
    };

    let snapshot = crate::commands::fleet::registry::registry().list_dto();
    let mut targets: Vec<String> = match target {
        "all_waiting" => snapshot
            .iter()
            .filter(|s| s.state == crate::commands::fleet::types::FleetSessionState::AwaitingInput)
            .map(|s| s.id.clone())
            .collect(),
        "all" => snapshot
            .iter()
            .filter(|s| s.state != crate::commands::fleet::types::FleetSessionState::Exited)
            .map(|s| s.id.clone())
            .collect(),
        "ids" => params
            .get("ids")
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter().filter_map(|x| x.as_str().map(str::to_string)).collect())
            .unwrap_or_default(),
        other => {
            return Err(AppError::Internal(format!(
                "fleet_broadcast: unknown target `{other}` (use all_waiting | all | ids)"
            )));
        }
    };
    {
        // `Vec::dedup()` only collapses *consecutive* duplicates; non-adjacent
        // repeats (e.g. a model-supplied `ids: ["a","b","a"]`) would otherwise
        // survive and cause the same session to receive the broadcast twice.
        let mut seen = std::collections::HashSet::with_capacity(targets.len());
        targets.retain(|id| seen.insert(id.clone()));
    }
    if targets.is_empty() {
        return Ok(ExecuteResult::message(
            "fleet_broadcast: no sessions matched the target (nothing sent).".into(),
        ));
    }

    let mut ok = 0;
    let mut failed = 0;
    for sid in &targets {
        match crate::commands::fleet::registry::registry().write_input(sid, payload.as_bytes()) {
            Ok(()) => ok += 1,
            Err(_) => failed += 1,
        }
    }
    Ok(ExecuteResult::message(format!(
        "Broadcast delivered to {ok}/{total} fleet session{plural}{fail_note}.",
        total = targets.len(),
        plural = if targets.len() == 1 { "" } else { "s" },
        fail_note = if failed > 0 {
            format!(" ({failed} failed)")
        } else {
            String::new()
        },
    )))
}

pub(crate) fn execute_fleet_kill(
    app: &tauri::AppHandle,
    params: &serde_json::Value,
) -> Result<ExecuteResult, AppError> {
    let raw_id = params
        .get("session_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Internal("fleet_kill: missing `session_id`".into()))?;
    let registry = crate::commands::fleet::registry::registry();
    // Athena often holds the `claude_session_id` (the cc/transcript id) rather
    // than the fleet-session id the registry is keyed by — accept either, so a
    // kill she proposes from a transcript id actually closes the session
    // instead of failing "not found".
    let session_id = registry.resolve_session_id(raw_id).ok_or_else(|| {
        AppError::Internal(format!(
            "fleet_kill: session `{raw_id}` not found (checked fleet + claude session ids)"
        ))
    })?;
    let label = registry.try_lookup_label(&session_id);
    // A dead row (rehydrated tombstone / hibernated-after-exit / dozed) has no
    // process to soft-kill — `close_pty_handles` would null already-null
    // handles, report success, and leave the row parked in the registry AND the
    // durable fleet_sessions table forever. Forget it instead: remove from the
    // in-memory map and let the "removed" registry event prune the durable row
    // so the sidebar actually drops it.
    if registry.forget_dead(&session_id) {
        crate::commands::fleet::pty::emit_registry_changed(app, "removed", &session_id);
        return Ok(ExecuteResult::message(format!(
            "Removed fleet session `{}`{} (no live process — cleared from the registry).",
            &session_id[..session_id.len().min(8)],
            label.map(|l| format!(" ({l})")).unwrap_or_default(),
        )));
    }
    // Soft-kill (PTY EOF). Future hard-kill (Child::kill) is a Phase 6
    // enhancement in the fleet module itself.
    let ok = registry.close_pty_handles(&session_id);
    if !ok {
        return Err(AppError::Internal(format!(
            "fleet_kill: session `{session_id}` not found"
        )));
    }
    Ok(ExecuteResult::message(format!(
        "Closed fleet session `{}`{} (soft kill — PTY EOF sent).",
        &session_id[..session_id.len().min(8)],
        label.map(|l| format!(" ({l})")).unwrap_or_default(),
    )))
}

/// Validate that a fleet session's working directory is one of the user's
/// registered dev projects (or a subdirectory of one).
///
/// Athena-spawned fleet sessions run `claude --dangerously-skip-permissions`
/// in `cwd` (see `fleet::pty::spawn_session`), so an arbitrary cwd would let a
/// single approving click execute a permission-bypassing agent anywhere on
/// disk. The ApprovalCard surfaces Athena's free-text rationale, not the
/// resolved command, so the cwd cannot be trusted from the rationale — it must
/// be constrained to the registered-project allowlist (`dev_projects`).
pub(crate) fn validate_fleet_cwd(app: &tauri::AppHandle, cwd: &str) -> Result<(), AppError> {
    let state = app.state::<Arc<AppState>>();
    validate_fleet_cwd_in_db(&state.db, cwd)
}

/// The containment rule itself, against the system DB that holds `dev_projects`.
///
/// Split out of [`validate_fleet_cwd`] (2026-08-04, WP2) so the *plan* surface can
/// apply the identical boundary at proposal time: `dispatcher::show_fleet_plan`
/// runs inside the companion turn and holds a `DbPool`, not an `AppHandle`. One
/// implementation, two callers — a second hand-written copy of this check is the
/// exact way a containment boundary rots.
pub(crate) fn validate_fleet_cwd_in_db(db: &crate::db::DbPool, cwd: &str) -> Result<(), AppError> {
    let trimmed = cwd.trim();
    if trimmed.is_empty() {
        return Err(AppError::Validation(
            "fleet cwd is required and must be a registered dev project directory".into(),
        ));
    }
    // Canonicalize to resolve `..`/symlinks before the containment check.
    let canon_cwd = std::fs::canonicalize(trimmed).map_err(|e| {
        AppError::Validation(format!(
            "fleet cwd `{trimmed}` is not an accessible directory: {e}"
        ))
    })?;
    if !canon_cwd.is_dir() {
        return Err(AppError::Validation(format!(
            "fleet cwd `{trimmed}` is not a directory"
        )));
    }
    let projects = crate::db::repos::dev_tools::list_projects(db, None)?;
    let allowed = projects.iter().any(|p| {
        std::fs::canonicalize(&p.root_path)
            .map(|root| canon_cwd.starts_with(&root))
            .unwrap_or(false)
    });
    if !allowed {
        return Err(AppError::Validation(format!(
            "fleet cwd `{trimmed}` is not within a registered dev project. \
             Register the project in Dev Tools first, then dispatch into it."
        )));
    }
    Ok(())
}

pub(crate) fn execute_fleet_spawn(
    app: &tauri::AppHandle,
    params: &serde_json::Value,
) -> Result<ExecuteResult, AppError> {
    let cwd = params
        .get("cwd")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Internal("fleet_spawn: missing `cwd`".into()))?;
    // Containment: only spawn into registered dev projects (claude runs with
    // --dangerously-skip-permissions in this cwd).
    validate_fleet_cwd(app, cwd)?;
    let args: Vec<String> = params
        .get("args")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|x| x.as_str().map(str::to_string)).collect())
        .unwrap_or_default();
    let cols = params.get("cols").and_then(|v| v.as_u64()).unwrap_or(120) as u16;
    let rows = params.get("rows").and_then(|v| v.as_u64()).unwrap_or(32) as u16;

    let id = crate::commands::fleet::pty::spawn_session(
        app.clone(),
        std::path::PathBuf::from(cwd),
        args,
        cols,
        rows,
    )
    .map_err(AppError::Internal)?;

    // Recursion guard sentinel: tag this session with a user-visible name
    // that STARTS WITH "athena" so it's obvious in the fleet UI which sessions
    // are Athena-spawned. This same sentinel prefix gates the autonomous
    // `fleet_send_input`/`fleet_kill` autoapprove paths (see `is_athena_owned`),
    // so it's sourced from the shared `ATHENA_SESSION_NAME_SENTINEL` constant
    // to keep tag + guard in lockstep (`is_athena_owned` matches by prefix).
    // The project label (via `try_lookup_label`, which falls back to
    // `project_label` while `name` is unset) is appended so the operator —
    // and Athena, who sees session names in her fleet digest — can tell
    // Athena-spawned sessions apart by what they're working on.
    // A dispatch-provided `label` WINS over the auto-derived project label:
    // the plan's author named this session on purpose, and "athena · personas"
    // eight times over tells the operator nothing about which is which.
    let sentinel = crate::commands::fleet::registry::ATHENA_SESSION_NAME_SENTINEL;
    let explicit = params
        .get("label")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let name = match explicit {
        Some(label) => format!("{sentinel} · {label}"),
        None => match crate::commands::fleet::registry::registry().try_lookup_label(&id) {
            Some(label) => format!("{sentinel} · {label}"),
            None => sentinel.to_string(),
        },
    };
    let _ = crate::commands::fleet::registry::registry().rename(&id, Some(name.clone()));

    Ok(ExecuteResult::message(format!(
        "Spawned fleet session `{}` in `{}`. Named \"{name}\" for visibility.",
        &id[..id.len().min(8)],
        cwd,
    )))
}

/// D5 v2 — `fleet_dispatch`: one ApprovalCard, N sessions under one
/// Operation. Athena creates the Operation upfront, spawns each role
/// as its own claude session (PTY), pre-attaches the SessionRef so the
/// op carries every session even before the first hook fires. The
/// reconciler in `commands::companion::fleet_bridge` synthesizes the
/// cross-session wrap-up once all dispatched sessions have exited.
///
/// `params` shape:
/// ```json
/// {
///   "operation_intent": "add tests for login flow",
///   "role_specs": [
///     { "role": "writer", "cwd": "C:/path/to/project", "args": [] },
///     { "role": "reviewer", "cwd": "C:/path/to/project", "args": [] }
///   ]
/// }
/// ```
/// Test-only public wrapper around `execute_fleet_dispatch` so the
/// real-claude E2E spec can fire a dispatch without going through the
/// approval pipeline. Returns the human-readable message that the
/// approval flow would otherwise surface.
#[cfg(feature = "test-automation")]
pub fn test_only_execute_fleet_dispatch(
    app: &tauri::AppHandle,
    params: &serde_json::Value,
) -> Result<String, AppError> {
    execute_fleet_dispatch(app, params).map(|r| r.message)
}

pub(crate) fn execute_fleet_dispatch(
    app: &tauri::AppHandle,
    params: &serde_json::Value,
) -> Result<ExecuteResult, AppError> {
    let intent = params
        .get("operation_intent")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| AppError::Internal("fleet_dispatch: missing `operation_intent`".into()))?;
    let specs = params
        .get("role_specs")
        .and_then(|v| v.as_array())
        .ok_or_else(|| AppError::Internal("fleet_dispatch: missing `role_specs`".into()))?;
    if specs.is_empty() {
        return Err(AppError::Internal(
            "fleet_dispatch: role_specs must not be empty".into(),
        ));
    }
    if specs.len() > 8 {
        return Err(AppError::Internal(
            "fleet_dispatch: role_specs capped at 8 sessions per operation".into(),
        ));
    }

    // Create the operation in operative memory before spawning any
    // sessions — this way even if a spawn fails partway through, the
    // op exists and the reconciler can finalize from whatever sessions
    // did make it. dispatched_by_athena=true so the proactive evaluator
    // can skip nudging sessions Athena herself spawned.
    let op_id = crate::companion::orchestration::operative_memory::memory()
        .begin_dispatched_operation(intent.to_string());

    let mut spawned: Vec<(String, String)> = Vec::new(); // (session_id_prefix, role)
    let mut failures: Vec<String> = Vec::new();

    for (i, spec) in specs.iter().enumerate() {
        let role = spec
            .get("role")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| format!("role-{i}"));
        let cwd = match spec.get("cwd").and_then(|v| v.as_str()) {
            Some(c) => c,
            None => {
                failures.push(format!("role `{role}`: missing `cwd`"));
                continue;
            }
        };
        // Containment: each dispatched role must target a registered dev
        // project (claude runs with --dangerously-skip-permissions there).
        if let Err(e) = validate_fleet_cwd(app, cwd) {
            failures.push(format!("role `{role}`: {e}"));
            continue;
        }
        let args: Vec<String> = spec
            .get("args")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|x| x.as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default();
        let cols = spec.get("cols").and_then(|v| v.as_u64()).unwrap_or(120) as u16;
        let rows = spec.get("rows").and_then(|v| v.as_u64()).unwrap_or(32) as u16;

        let id = match crate::commands::fleet::pty::spawn_session(
            app.clone(),
            std::path::PathBuf::from(cwd),
            args,
            cols,
            rows,
        ) {
            Ok(id) => id,
            Err(e) => {
                failures.push(format!("role `{role}`: spawn failed: {e}"));
                continue;
            }
        };

        // Pre-attach SessionRef on the op so the reconciler sees this
        // session immediately, even before the SessionStart hook fires.
        let _ = crate::companion::orchestration::operative_memory::memory()
            .attach_session_to_operation(&op_id, &id, &role, cwd);

        // Visible-name = "athena-<role> · <project>" so the user sees the
        // recursion-guard sentinel, the role AND what the session works on in
        // the Fleet UI (the project label comes from `try_lookup_label`, which
        // falls back to `project_label` while `name` is unset). Sourced from
        // the shared `ATHENA_SESSION_NAME_SENTINEL` so the autonomous
        // `fleet_send_input`/`fleet_kill` guard (`is_athena_owned`) recognizes
        // these dispatched sessions as Athena-owned (prefix match).
        let dispatch_name = {
            let base = format!(
                "{}-{role}",
                crate::commands::fleet::registry::ATHENA_SESSION_NAME_SENTINEL
            );
            match crate::commands::fleet::registry::registry().try_lookup_label(&id) {
                Some(label) => format!("{base} · {label}"),
                None => base,
            }
        };
        let _ = crate::commands::fleet::registry::registry().rename(&id, Some(dispatch_name));

        spawned.push((id[..id.len().min(8)].to_string(), role));
    }

    if spawned.is_empty() {
        return Err(AppError::Internal(format!(
            "fleet_dispatch: every spawn failed.\n{}",
            failures.join("\n"),
        )));
    }

    // D7 — fresh dispatched op + attached sessions; nudge the
    // live-ops strip to re-fetch.
    crate::companion::orchestration::emit_digest_changed(app);

    let mut msg = format!(
        "Dispatched operation `{intent}` (op_id `{}`) across {} session(s):",
        &op_id[..op_id.len().min(8)],
        spawned.len(),
    );
    for (id8, role) in &spawned {
        msg.push_str(&format!("\n  - `{id8}` ({role})"));
    }
    if !failures.is_empty() {
        msg.push_str("\nFailures:");
        for f in &failures {
            msg.push_str(&format!("\n  ⚠ {f}"));
        }
    }
    msg.push_str(
        "\n\nThe reconciler will synthesize a wrap-up summary once \
every session in this operation has exited.",
    );

    Ok(ExecuteResult::message(msg))
}

/// D9 — `fleet_intervene`: write a guidance message into a running
/// session's PTY stdin. Capped at one intervention per session via
/// operative_memory tracking — second invocation refuses with a
/// reason. The session sees the message text + a newline (so its
/// REPL processes it as a turn).
///
/// `params`: `{ session_id: string, message: string }`. Used by the
/// proactive evaluator's stuck-session detector — see
/// `proactive/fleet_triggers.rs`. The user approves before this
/// fires; auto-fire would be too aggressive at this maturity.
pub(crate) fn execute_fleet_intervene(
    app: &tauri::AppHandle,
    params: &serde_json::Value,
) -> Result<ExecuteResult, AppError> {
    let raw_id = params
        .get("session_id")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| AppError::Internal("fleet_intervene: missing `session_id`".into()))?;
    // Either id form resolves (fleet id or claude_session_id) — see
    // `FleetRegistry::resolve_session_id`. Unresolvable ids pass through so
    // the write path reports its normal "session not found".
    let session_id = crate::commands::fleet::registry::registry()
        .resolve_session_id(raw_id)
        .unwrap_or_else(|| raw_id.to_string());
    let session_id = session_id.as_str();
    let message = params
        .get("message")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| AppError::Internal("fleet_intervene: missing `message`".into()))?;

    // Cap check + bookkeeping first. If we already intervened, refuse
    // before touching the PTY — easier to debug a clean refusal than
    // a no-op write.
    crate::companion::orchestration::operative_memory::memory()
        .record_intervention(session_id)
        .map_err(|e| AppError::Internal(format!("fleet_intervene: {e}")))?;

    // DOZED target: unlike a TUI answer, an intervention is a plain instruction
    // and stays meaningful after a resume — wake the session and deliver the
    // message once it boots.
    if crate::commands::fleet::registry::registry().is_dozing(session_id) {
        let app = app.clone();
        let sid = session_id.to_string();
        let msg = message.to_string();
        crate::commands::fleet::debug_log::athena(
            &sid,
            "dozed target — wake + deliver",
            "intervention will be typed after the resumed session boots",
        );
        tauri::async_runtime::spawn(async move {
            match crate::commands::fleet::commands::fleet_wake_session(app, sid.clone(), None, None)
                .await
            {
                Ok(new_id) => {
                    tokio::time::sleep(std::time::Duration::from_secs(25)).await;
                    let _ = crate::commands::fleet::registry::registry()
                        .write_text_line(&new_id, &msg);
                }
                Err(e) => {
                    tracing::warn!(session_id = %sid, error = %e, "dozed-target wake failed (intervene)");
                }
            }
        });
        return Ok(ExecuteResult::message(format!(
            "Session `{}` was asleep — woke it; the intervention lands after boot.",
            &session_id[..session_id.len().min(8)],
        )));
    }

    // Confirmed-submit primitive: text and Enter as separate chunks, submit
    // verified (see `write_text_line` — a trailing newline inside one chunk is
    // a pasted line-break, not Enter, and never submits).
    crate::commands::fleet::registry::registry()
        .write_text_line(session_id, message)
        .map_err(|e| AppError::Internal(format!("fleet_intervene: PTY write failed: {e}")))?;

    crate::companion::orchestration::emit_digest_changed(app);

    Ok(ExecuteResult::message(format!(
        "Intervention delivered to session `{}`. Message: {message}",
        &session_id[..session_id.len().min(8)],
    )))
}

/// D9 — `fleet_redirect_op`: update the operation's user_intent +
/// broadcast a redirection message to every active (non-Exited)
/// session in the op. Useful when Athena spots that the whole op is
/// going in a wrong direction (not just one session).
///
/// `params`: `{ op_id: string, new_intent: string, message?: string }`.
/// `message` defaults to a synthesized "New direction: {new_intent}"
/// when omitted. Each broadcast counts as an intervention against its
/// session — the per-session cap still applies, so a session that's
/// already been intervened on is skipped (logged).
pub(crate) fn execute_fleet_redirect_op(
    app: &tauri::AppHandle,
    params: &serde_json::Value,
) -> Result<ExecuteResult, AppError> {
    let op_id = params
        .get("op_id")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| AppError::Internal("fleet_redirect_op: missing `op_id`".into()))?;
    let new_intent = params
        .get("new_intent")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| AppError::Internal("fleet_redirect_op: missing `new_intent`".into()))?;
    let message = params
        .get("message")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| format!("New direction from Athena: {new_intent}"));

    let mem = crate::companion::orchestration::operative_memory::memory();
    if !mem.redirect_operation(op_id, new_intent) {
        return Err(AppError::Internal(format!(
            "fleet_redirect_op: operation `{op_id}` not found in operative memory",
        )));
    }
    let targets = mem.op_active_sessions(op_id);
    if targets.is_empty() {
        crate::companion::orchestration::emit_digest_changed(app);
        return Ok(ExecuteResult::message(format!(
            "Updated op `{op}` intent to \"{new_intent}\". No active sessions to broadcast to.",
            op = &op_id[..op_id.len().min(8)],
        )));
    }

    let mut delivered: Vec<String> = Vec::new();
    let mut skipped: Vec<String> = Vec::new();
    for sid in &targets {
        match mem.record_intervention(sid) {
            Ok(()) => {
                // Confirmed-submit primitive (split text/Enter — see write_text_line).
                if let Err(e) = crate::commands::fleet::registry::registry()
                    .write_text_line(sid, &message)
                {
                    skipped.push(format!("`{}` PTY write failed: {e}", &sid[..sid.len().min(8)]));
                    continue;
                }
                delivered.push(format!("`{}`", &sid[..sid.len().min(8)]));
            }
            Err(reason) => {
                skipped.push(format!("`{}` skipped: {reason}", &sid[..sid.len().min(8)]));
            }
        }
    }

    crate::companion::orchestration::emit_digest_changed(app);

    let mut msg = format!(
        "Redirected op `{op}` to \"{new_intent}\". Broadcast to {} session(s).",
        delivered.len(),
        op = &op_id[..op_id.len().min(8)],
    );
    if !delivered.is_empty() {
        msg.push_str(&format!("\nDelivered: {}", delivered.join(", ")));
    }
    if !skipped.is_empty() {
        msg.push_str("\nSkipped:");
        for s in &skipped {
            msg.push_str(&format!("\n  ⚠ {s}"));
        }
    }
    Ok(ExecuteResult::message(msg))
}

/// Phase 4 — `fleet_wake`: revive a hibernated session. Wraps the
/// `fleet_wake_session` command (resume_target → spawn `claude --resume` in the
/// original cwd → drop the sleeping placeholder). Auto-approvable under the
/// confidence gate; a hallucinated or non-resumable id fails closed — the command
/// returns `Err` unless the session is `Hibernated` with a bound claude_session_id.
///
/// `params`: `{ session_id: string }` (+ optional `confidence`/`decision_class`
/// consumed by the gate, ignored here).
pub(crate) async fn execute_fleet_wake(
    app: &tauri::AppHandle,
    params: &serde_json::Value,
) -> Result<ExecuteResult, AppError> {
    let session_id = params
        .get("session_id")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| AppError::Internal("fleet_wake: missing `session_id`".into()))?;
    let new_id = crate::commands::fleet::commands::fleet_wake_session(
        app.clone(),
        session_id.to_string(),
        None,
        None,
    )
    .await
    .map_err(|e| AppError::Internal(format!("fleet_wake: {e}")))?;
    Ok(ExecuteResult::message(format!(
        "Revived hibernated session `{}` → resumed as `{}`.",
        &session_id[..session_id.len().min(8)],
        &new_id[..new_id.len().min(8)],
    )))
}

/// Phase 4 — `fleet_resume`: adopt an orphaned `claude` process (one the
/// in-memory registry lost, e.g. after an app restart while the CLI kept
/// running). Wraps the `fleet_resume_orphan` command (derive the conversation id
/// from the newest transcript for the cwd → kill the orphan → spawn a fresh
/// tracked `claude --resume`). Auto-approvable under the confidence gate.
///
/// `params`: `{ pid: number, cwd: string }` (+ optional gate fields). Inherits the
/// command's known sharp edge: cwd is not a unique conversation key, so a repo
/// with multiple past sessions may adopt the wrong transcript.
pub(crate) async fn execute_fleet_resume(
    app: &tauri::AppHandle,
    params: &serde_json::Value,
) -> Result<ExecuteResult, AppError> {
    let pid = params
        .get("pid")
        .and_then(|v| v.as_u64().or_else(|| v.as_str().and_then(|s| s.trim().parse::<u64>().ok())))
        .and_then(|n| u32::try_from(n).ok())
        .ok_or_else(|| AppError::Internal("fleet_resume: missing/invalid `pid`".into()))?;
    let cwd = params
        .get("cwd")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| AppError::Internal("fleet_resume: missing `cwd`".into()))?;
    let new_id = crate::commands::fleet::process_scan::fleet_resume_orphan(
        app.clone(),
        pid,
        cwd.to_string(),
    )
    .await
    .map_err(|e| AppError::Internal(format!("fleet_resume: {e}")))?;
    Ok(ExecuteResult::message(format!(
        "Adopted orphaned process {pid} in `{cwd}` → resumed as `{}`.",
        &new_id[..new_id.len().min(8)],
    )))
}

// ── Conversational fleet plan (WP2, 2026-08-04) ─────────────────────────
//
// The chat-first path from "spin up three sessions on X" (typed OR spoken) to
// real terminals. Athena proposes a plan with `show_fleet_plan`; the editable
// chat card is where the user corrects it; confirming calls
// `companion_dispatch_fleet_plan` below, which re-runs the SAME validation the
// proposal passed and then hands off to the existing `fleet_spawn` /
// `fleet_dispatch` executors. Nothing here widens `validate_fleet_cwd`.

/// Sessions one plan may carry. Mirrors the hard cap inside
/// [`execute_fleet_dispatch`] so a plan can never be built that the executor
/// would reject at the end.
pub(crate) const FLEET_PLAN_MAX_ROWS: usize = 8;
/// Longest per-row objective. Long enough for a real brief, short enough that
/// a runaway generation cannot become a command line.
pub(crate) const FLEET_PLAN_OBJECTIVE_MAX: usize = 1200;
/// Longest operation intent (the one-line label the Operation is filed under).
pub(crate) const FLEET_PLAN_INTENT_MAX: usize = 300;
/// Longest skill name. Skills are slugs (`scan-sweep`, `uat`), never prose.
pub(crate) const FLEET_PLAN_SKILL_MAX: usize = 64;

/// One validated row of a fleet plan: where it runs, what it is asked to do,
/// and optionally which installed skill leads the prompt.
#[derive(Debug, Clone)]
pub(crate) struct FleetPlanRow {
    pub cwd: String,
    pub objective: String,
    pub skill: Option<String>,
    /// Operator-facing name for this session. Without it every dispatched
    /// session was `athena-plan-3`, which tells you nothing about what it is
    /// doing when eight of them are on screen. A dispatch-provided label WINS
    /// over the auto-naming — the caller who wrote the plan knows better than
    /// a slug derived from a skill name.
    pub label: Option<String>,
    /// Model id for this session (`--model`). `None` leaves the CLI default.
    pub model: Option<String>,
    /// Reasoning effort for this session (`--effort`). `None` leaves the CLI
    /// default. Same flag names the headless lane already uses
    /// (`engine/prompt/cli_args.rs`), so there is one vocabulary.
    pub effort: Option<String>,
}

/// Effort levels the CLI accepts. A free-text value would become a command
/// line, so the plan validator only lets these through.
pub(crate) const FLEET_PLAN_EFFORTS: &[&str] = &["low", "medium", "high", "xhigh"];
/// Longest session label. Long enough to be descriptive in the grid, short
/// enough that it stays a label.
pub(crate) const FLEET_PLAN_LABEL_MAX: usize = 48;
/// Longest model id.
pub(crate) const FLEET_PLAN_MODEL_MAX: usize = 64;

impl FleetPlanRow {
    /// The positional prompt this row spawns with. A chosen skill LEADS the
    /// prompt as `/skill <objective>` — that is how a skill is injected at
    /// spawn (same shape as `skillCommand` in the Skills Workbench).
    ///
    /// This is the whole argv contribution of a row: exactly one positional
    /// token. `fleet::pty::spawn_session` owns flag ordering and appends
    /// `--mcp-config` LAST, after the caller's args, because that flag is
    /// variadic and would otherwise swallow the prompt. Callers must never
    /// hand-assemble flags here.
    pub fn prompt(&self) -> String {
        match self.skill.as_deref() {
            Some(s) => format!("/{s} {}", self.objective),
            None => self.objective.clone(),
        }
    }

    /// Fleet role label — becomes the visible session name `athena-<role>`.
    /// An explicit `label` wins: it is what the plan's author chose to call
    /// this session, and it beats a slug derived from the skill name.
    pub fn role(&self, index: usize) -> String {
        self.label
            .clone()
            .or_else(|| self.skill.clone())
            .unwrap_or_else(|| format!("plan-{}", index + 1))
    }

    /// This row's full argv contribution: the model/effort flags (when the
    /// plan chose them), then exactly one positional token — the prompt.
    ///
    /// Flag ORDER matters and is why this lives here rather than at the call
    /// site: `fleet::pty::spawn_session` appends the variadic `--mcp-config`
    /// after the caller's args, so the positional prompt must be LAST in what
    /// we hand it, and any value-taking flag must also be listed in
    /// `fleet::naming::VALUE_FLAGS` or its value becomes the session title.
    pub fn args(&self) -> Vec<String> {
        let mut out = Vec::new();
        if let Some(model) = self.model.as_deref() {
            out.push("--model".to_string());
            out.push(model.to_string());
        }
        if let Some(effort) = self.effort.as_deref() {
            out.push("--effort".to_string());
            out.push(effort.to_string());
        }
        out.push(self.prompt());
        out
    }
}

/// Validate a proposed fleet plan against every boundary the executors enforce,
/// at PROPOSAL time rather than at fire time. Returns the trimmed intent plus
/// the validated rows, or a single human-readable reason.
///
/// Rules, in order: non-empty bounded intent · 1..=[`FLEET_PLAN_MAX_ROWS`] rows ·
/// per row a non-empty bounded objective, a bounded slug-shaped optional skill,
/// and a `cwd` inside a registered dev project (the shared
/// [`validate_fleet_cwd_in_db`] — never a second copy of that rule).
/// Read an optional, trimmed, length-bounded string field off a plan row.
/// `Ok(None)` for absent/blank; the error string is a suffix the caller
/// prefixes with the field name.
fn bounded_opt(
    row: &serde_json::Value,
    key: &str,
    max: usize,
) -> Result<Option<String>, String> {
    let Some(raw) = row.get(key) else {
        return Ok(None);
    };
    if raw.is_null() {
        return Ok(None);
    }
    let Some(s) = raw.as_str() else {
        return Err("must be a string".into());
    };
    let s = s.trim();
    if s.is_empty() {
        return Ok(None);
    }
    if s.chars().count() > max {
        return Err(format!("is too long (max {max} characters)"));
    }
    Ok(Some(s.to_string()))
}

pub(crate) fn validate_fleet_plan(
    db: &crate::db::DbPool,
    intent: &str,
    rows: &[serde_json::Value],
) -> Result<(String, Vec<FleetPlanRow>), String> {
    let intent = intent.trim();
    if intent.is_empty() {
        return Err("`operation_intent` must be a non-empty one-line summary".into());
    }
    if intent.chars().count() > FLEET_PLAN_INTENT_MAX {
        return Err(format!(
            "`operation_intent` is too long (max {FLEET_PLAN_INTENT_MAX} characters)"
        ));
    }
    if rows.is_empty() {
        return Err("`rows` must contain at least one session".into());
    }
    if rows.len() > FLEET_PLAN_MAX_ROWS {
        return Err(format!(
            "{} sessions exceeds the fleet cap of {FLEET_PLAN_MAX_ROWS} per operation",
            rows.len()
        ));
    }
    let mut out = Vec::with_capacity(rows.len());
    for (i, row) in rows.iter().enumerate() {
        let n = i + 1;
        let objective = row
            .get("objective")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .unwrap_or("");
        if objective.is_empty() {
            return Err(format!("row {n}: `objective` must not be empty"));
        }
        if objective.chars().count() > FLEET_PLAN_OBJECTIVE_MAX {
            return Err(format!(
                "row {n}: `objective` is too long (max {FLEET_PLAN_OBJECTIVE_MAX} characters)"
            ));
        }
        let cwd = row
            .get("cwd")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .unwrap_or("");
        // Containment — the boundary, not a formatting check. A session spawned
        // from this row runs `claude --dangerously-skip-permissions` in `cwd`.
        validate_fleet_cwd_in_db(db, cwd).map_err(|e| format!("row {n}: {e}"))?;
        let skill = match row.get("skill").and_then(|v| v.as_str()).map(str::trim) {
            None | Some("") => None,
            Some(s) => {
                let s = s.trim_start_matches('/');
                if s.chars().count() > FLEET_PLAN_SKILL_MAX {
                    return Err(format!("row {n}: `skill` name is too long"));
                }
                // Slug charset only: a skill name becomes the leading `/token`
                // of the spawned prompt, so whitespace or shell-ish characters
                // there are always a mistake.
                if s.is_empty()
                    || !s
                        .chars()
                        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == ':')
                {
                    return Err(format!(
                        "row {n}: `skill` must be a skill name like `scan-sweep`, not free text"
                    ));
                }
                Some(s.to_string())
            }
        };
        // Optional presentation/routing fields. Each is bounded and
        // charset-checked here, at PROPOSAL time, for the same reason every
        // other field is: these become command-line tokens.
        let label = match bounded_opt(row, "label", FLEET_PLAN_LABEL_MAX) {
            Ok(v) => v,
            Err(e) => return Err(format!("row {n}: `label` {e}")),
        };
        let model = match bounded_opt(row, "model", FLEET_PLAN_MODEL_MAX) {
            Ok(v) => v,
            Err(e) => return Err(format!("row {n}: `model` {e}")),
        };
        if let Some(m) = model.as_deref() {
            if m.starts_with('-') || m.contains(char::is_whitespace) {
                return Err(format!(
                    "row {n}: `model` must be a model id like `opus`, not free text"
                ));
            }
        }
        let effort = match bounded_opt(row, "effort", 16) {
            Ok(v) => v,
            Err(e) => return Err(format!("row {n}: `effort` {e}")),
        };
        if let Some(e) = effort.as_deref() {
            if !FLEET_PLAN_EFFORTS.contains(&e) {
                return Err(format!(
                    "row {n}: `effort` must be one of {}",
                    FLEET_PLAN_EFFORTS.join(" / ")
                ));
            }
        }
        out.push(FleetPlanRow {
            cwd: cwd.to_string(),
            objective: objective.to_string(),
            skill,
            label,
            model,
            effort,
        });
    }
    Ok((intent.to_string(), out))
}

/// Confirm-and-dispatch for the editable in-chat fleet plan.
///
/// The card the user just edited is the consent surface, so there is no second
/// approval gate — but the plan is re-validated here against the live
/// `dev_projects` registry, because the rows arriving are the USER-EDITED ones,
/// not the ones Athena proposed. One row spawns a single session
/// (`fleet_spawn`); two or more become one Operation with N role sessions
/// (`fleet_dispatch`).
///
/// `card_id` is the durable `companion_chat_card` row backing the card. When
/// present it is CLAIMED (pending → dispatched) before anything spawns, which
/// is the idempotency guard: a double-click, a replayed event, or a re-mounted
/// card after a refresh can no longer start a second fleet of CLI sessions.
/// A claim taken for a dispatch that then failed outright is released.
#[tauri::command]
pub async fn companion_dispatch_fleet_plan(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    operation_intent: String,
    rows: Vec<serde_json::Value>,
    card_id: Option<String>,
) -> Result<String, AppError> {
    ipc_auth::require_auth(&state).await?;
    let (intent, plan) =
        validate_fleet_plan(&state.db, &operation_intent, &rows).map_err(AppError::Validation)?;

    // Claim BEFORE the executors run. Validation errors above are safe to
    // retry, so they must not burn the card.
    let card_id = card_id.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    if let Some(id) = card_id.as_deref() {
        let conn = state.user_db.get()?;
        crate::commands::companion::chat_cards::claim_for_dispatch(&conn, id)?;
    }

    let (action, params) = fleet_plan_dispatch_params(&intent, &plan);
    tracing::info!(
        intent = %intent,
        sessions = plan.len(),
        action = action,
        "companion: dispatching confirmed fleet plan"
    );
    let result = match action {
        "fleet_spawn" => execute_fleet_spawn(&app, &params),
        _ => execute_fleet_dispatch(&app, &params),
    };
    // Durable audit — this is the compensating control, not a nicety. The
    // operator explicitly accepted that a typed or spoken request can start
    // terminals with no click, so "what was started, where, and on whose say-so"
    // has to survive the process: a `tracing::info!` is not auditable after the
    // fact. The ledger already records autopilot auto-fires, so an
    // operator-confirmed plan is written to the SAME table with a distinct
    // `decision_class` — one place to read Athena's whole fleet decision surface,
    // with the two origins told apart. Best-effort, and recorded for the failure
    // path too: a dispatch that blew up half-way still spawned something.
    let outcome = if result.is_ok() {
        FLEET_PLAN_OUTCOME_CONFIRMED
    } else {
        FLEET_PLAN_OUTCOME_CONFIRMED_FAILED
    };
    record_fleet_plan_decision(&state.db, action, &intent, &plan, outcome);

    // Settle the durable card in the same breath as the audit row: a
    // successful dispatch stores its outcome (so a re-hydrated card renders
    // "already dispatched" rather than an editable plan), a failed one hands
    // the claim back so the operator can correct and retry.
    if let Some(id) = card_id.as_deref() {
        if let Ok(conn) = state.user_db.get() {
            match &result {
                Ok(r) => crate::commands::companion::chat_cards::record_dispatch_result(
                    &conn,
                    id,
                    serde_json::json!({
                        "message": r.message,
                        "dispatchedRows": plan
                            .iter()
                            .map(|row| serde_json::json!({
                                "cwd": row.cwd,
                                "objective": row.objective,
                                "skill": row.skill,
                            }))
                            .collect::<Vec<_>>(),
                    })
                    .to_string(),
                ),
                Err(_) => crate::commands::companion::chat_cards::release_claim(&conn, id),
            }
        }
    }
    Ok(result?.message)
}

/// Ledger `outcome` for a plan the operator confirmed and that dispatched.
/// Deliberately distinct from the autopilot's `auto_fired` / `deferred`, so a
/// reader can tell "a human pressed Confirm" from "the boldness dial fired".
pub(crate) const FLEET_PLAN_OUTCOME_CONFIRMED: &str = "operator_confirmed";
/// Same, for a confirmed plan whose executor returned an error.
pub(crate) const FLEET_PLAN_OUTCOME_CONFIRMED_FAILED: &str = "operator_confirmed_failed";
/// Ledger `decision_class` marking the origin as the editable chat plan card.
pub(crate) const FLEET_PLAN_DECISION_CLASS: &str = "operator_confirmed_plan";

/// The audit payload for one confirmed plan: the operation intent, the row
/// count, and per row the cwd plus the RESOLVED PROMPT that session actually
/// received (skill included, since `/skill …` changes what the session does).
///
/// Pure and separate from the write so the recorded shape is testable.
pub(crate) fn fleet_plan_audit_rationale(intent: &str, plan: &[FleetPlanRow]) -> String {
    let rows: Vec<String> = plan
        .iter()
        .enumerate()
        .map(|(i, r)| format!("{}. `{}` :: {}", i + 1, r.cwd, r.prompt()))
        .collect();
    format!(
        "operator-confirmed plan card · intent: {intent} · {} session(s)\n{}",
        plan.len(),
        rows.join("\n"),
    )
}

/// Append one confirmed-plan row to the fleet decision ledger. Routed through
/// [`record_fleet_decision`] so plan confirms and autopilot auto-fires share the
/// one choke point (and its debug-log tap) instead of growing a second writer.
pub(crate) fn record_fleet_plan_decision(
    db: &crate::db::DbPool,
    action: &str,
    intent: &str,
    plan: &[FleetPlanRow],
    outcome: &str,
) {
    let params = serde_json::json!({
        // No `session_id` / `confidence`: nothing existed to decide about and
        // nobody self-reported — a human confirmed a plan.
        "decision_class": FLEET_PLAN_DECISION_CLASS,
        "rationale": fleet_plan_audit_rationale(intent, plan),
    });
    record_fleet_decision(db, action, &params.to_string(), outcome, None);
}

/// Pick the executor for a validated plan and build its params.
///
/// One row is a single session (`fleet_spawn`); two or more are one Operation
/// with N roles (`fleet_dispatch`). Pure so the selection and the assembled
/// argv are testable without an `AppHandle`.
///
/// Each row contributes exactly ONE positional token (`FleetPlanRow::prompt`).
/// No flags are assembled here: `fleet::pty::spawn_session` appends the
/// variadic `--mcp-config` after the caller's args, and anything emitted after
/// it would be swallowed as a config path.
pub(crate) fn fleet_plan_dispatch_params(
    intent: &str,
    plan: &[FleetPlanRow],
) -> (&'static str, serde_json::Value) {
    if plan.len() == 1 {
        let row = &plan[0];
        return (
            "fleet_spawn",
            serde_json::json!({
                "cwd": row.cwd,
                "args": row.args(),
                // A dispatch-provided label wins over the auto-naming.
                "label": row.label,
            }),
        );
    }
    let role_specs: Vec<serde_json::Value> = plan
        .iter()
        .enumerate()
        .map(|(i, row)| {
            serde_json::json!({
                "role": row.role(i),
                "cwd": row.cwd,
                "args": row.args(),
            })
        })
        .collect();
    (
        "fleet_dispatch",
        serde_json::json!({
            "operation_intent": intent,
            "role_specs": role_specs,
        }),
    )
}

#[cfg(test)]
mod fleet_plan_tests {
    use super::*;
    use r2d2::Pool;
    use r2d2_sqlite::SqliteConnectionManager;

    /// A system DB carrying just enough of `dev_projects` for
    /// `list_projects` (the columns it reads with `?`), with `root` registered.
    fn pool_with_project(root: &std::path::Path) -> crate::db::DbPool {
        let manager = SqliteConnectionManager::memory();
        let pool = Pool::builder().max_size(1).build(manager).expect("pool");
        let conn = pool.get().unwrap();
        conn.execute_batch(
            "CREATE TABLE dev_projects (id TEXT PRIMARY KEY, name TEXT NOT NULL,
                root_path TEXT NOT NULL, description TEXT, status TEXT NOT NULL,
                tech_stack TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO dev_projects (id, name, root_path, description, status, tech_stack,
                created_at, updated_at)
             VALUES ('proj_1', 'Fixture', ?1, '', 'active', '', '2026-08-04', '2026-08-04')",
            rusqlite::params![root.to_string_lossy()],
        )
        .unwrap();
        pool
    }

    /// A real directory inside a registered project (canonicalize needs one).
    fn fixture_project() -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "personas-fleet-plan-{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::canonicalize(&dir).unwrap()
    }

    fn row(cwd: &str, objective: &str, skill: Option<&str>) -> serde_json::Value {
        match skill {
            Some(s) => serde_json::json!({ "cwd": cwd, "objective": objective, "skill": s }),
            None => serde_json::json!({ "cwd": cwd, "objective": objective }),
        }
    }

    #[test]
    fn label_model_and_effort_ride_through_validation_into_argv() {
        let root = fixture_project();
        let pool = pool_with_project(&root);
        let cwd = root.to_string_lossy().to_string();
        let rows = vec![serde_json::json!({
            "cwd": cwd,
            "objective": "harden the auth surface",
            "label": "auth hardening",
            "model": "opus",
            "effort": "high",
        })];
        let (_, plan) = validate_fleet_plan(&pool, "intent", &rows).expect("valid");
        assert_eq!(plan[0].label.as_deref(), Some("auth hardening"));
        // The label WINS over the auto-derived role: the plan's author named
        // this session, and `plan-1` tells the operator nothing.
        assert_eq!(plan[0].role(0), "auth hardening");
        // Flags lead, the prompt stays the LAST token (spawn_session appends
        // the variadic --mcp-config after our args).
        assert_eq!(
            plan[0].args(),
            vec![
                "--model".to_string(),
                "opus".to_string(),
                "--effort".to_string(),
                "high".to_string(),
                "harden the auth surface".to_string(),
            ]
        );
        // …and the single-row dispatch carries the label to the executor.
        let (action, params) = fleet_plan_dispatch_params("intent", &plan);
        assert_eq!(action, "fleet_spawn");
        assert_eq!(params["label"], "auth hardening");
    }

    #[test]
    fn a_bad_effort_or_model_is_refused_at_proposal_time() {
        let root = fixture_project();
        let pool = pool_with_project(&root);
        let cwd = root.to_string_lossy().to_string();
        let bad_effort = vec![serde_json::json!({
            "cwd": cwd, "objective": "o", "effort": "ludicrous",
        })];
        assert!(validate_fleet_plan(&pool, "i", &bad_effort)
            .unwrap_err()
            .contains("effort"));
        // A model value that could become a flag never reaches a command line.
        let bad_model = vec![serde_json::json!({
            "cwd": cwd, "objective": "o", "model": "--dangerously-something",
        })];
        assert!(validate_fleet_plan(&pool, "i", &bad_model)
            .unwrap_err()
            .contains("model"));
    }

    #[test]
    fn omitting_the_new_fields_changes_nothing() {
        let root = fixture_project();
        let pool = pool_with_project(&root);
        let cwd = root.to_string_lossy().to_string();
        let rows = vec![row(&cwd, "do the thing", Some("scan-sweep"))];
        let (_, plan) = validate_fleet_plan(&pool, "i", &rows).expect("valid");
        assert!(plan[0].label.is_none() && plan[0].model.is_none() && plan[0].effort.is_none());
        assert_eq!(plan[0].args(), vec!["/scan-sweep do the thing".to_string()]);
        // Without a label the role still falls back to the skill.
        assert_eq!(plan[0].role(0), "scan-sweep");
    }

    #[test]
    fn accepts_a_plan_inside_a_registered_project() {
        let root = fixture_project();
        let pool = pool_with_project(&root);
        let cwd = root.to_string_lossy().to_string();
        let (intent, plan) =
            validate_fleet_plan(&pool, "  tidy the repo  ", &[row(&cwd, " write tests ", None)])
                .expect("plan should validate");
        assert_eq!(intent, "tidy the repo");
        assert_eq!(plan.len(), 1);
        assert_eq!(plan[0].objective, "write tests");
    }

    #[test]
    fn rejects_a_cwd_outside_every_registered_project() {
        let root = fixture_project();
        let pool = pool_with_project(&root);
        // A real, accessible directory that is simply not registered.
        let outside = std::fs::canonicalize(std::env::temp_dir()).unwrap();
        let err = validate_fleet_plan(
            &pool,
            "escape",
            &[row(&outside.to_string_lossy(), "do something", None)],
        )
        .expect_err("an unregistered cwd must not produce a plan");
        assert!(err.contains("registered dev project"), "{err}");
    }

    #[test]
    fn rejects_a_missing_or_nonexistent_cwd() {
        let root = fixture_project();
        let pool = pool_with_project(&root);
        assert!(validate_fleet_plan(&pool, "x", &[row("", "objective", None)]).is_err());
        let ghost = root.join("definitely-not-here");
        assert!(validate_fleet_plan(
            &pool,
            "x",
            &[row(&ghost.to_string_lossy(), "objective", None)]
        )
        .is_err());
    }

    #[test]
    fn rejects_more_rows_than_the_dispatch_cap() {
        let root = fixture_project();
        let pool = pool_with_project(&root);
        let cwd = root.to_string_lossy().to_string();
        let rows: Vec<serde_json::Value> = (0..FLEET_PLAN_MAX_ROWS + 1)
            .map(|i| row(&cwd, &format!("objective {i}"), None))
            .collect();
        let err = validate_fleet_plan(&pool, "too much", &rows).expect_err("cap must hold");
        assert!(err.contains(&FLEET_PLAN_MAX_ROWS.to_string()), "{err}");
        // Exactly at the cap still validates.
        assert!(validate_fleet_plan(&pool, "at the cap", &rows[..FLEET_PLAN_MAX_ROWS]).is_ok());
    }

    #[test]
    fn rejects_an_empty_objective_and_an_empty_intent() {
        let root = fixture_project();
        let pool = pool_with_project(&root);
        let cwd = root.to_string_lossy().to_string();
        let err = validate_fleet_plan(&pool, "intent", &[row(&cwd, "   ", None)])
            .expect_err("a blank objective is not a session brief");
        assert!(err.contains("objective"), "{err}");
        assert!(validate_fleet_plan(&pool, "  ", &[row(&cwd, "real objective", None)]).is_err());
        assert!(validate_fleet_plan(&pool, "intent", &[]).is_err());
    }

    #[test]
    fn rejects_a_skill_that_is_free_text() {
        let root = fixture_project();
        let pool = pool_with_project(&root);
        let cwd = root.to_string_lossy().to_string();
        assert!(
            validate_fleet_plan(&pool, "i", &[row(&cwd, "o", Some("run the scan sweep please"))])
                .is_err()
        );
        // A real slug passes, with or without a leading slash.
        for s in ["scan-sweep", "/scan-sweep"] {
            let (_, plan) =
                validate_fleet_plan(&pool, "i", &[row(&cwd, "o", Some(s))]).expect("slug ok");
            assert_eq!(plan[0].skill.as_deref(), Some("scan-sweep"));
        }
    }

    #[test]
    fn one_row_spawns_and_many_rows_dispatch() {
        let root = fixture_project();
        let pool = pool_with_project(&root);
        let cwd = root.to_string_lossy().to_string();

        let (intent, one) =
            validate_fleet_plan(&pool, "single", &[row(&cwd, "objective one", None)]).unwrap();
        let (action, params) = fleet_plan_dispatch_params(&intent, &one);
        assert_eq!(action, "fleet_spawn");
        assert_eq!(params["cwd"], cwd);
        assert_eq!(params["args"][0], "objective one");
        assert!(params.get("role_specs").is_none());

        let (intent, many) = validate_fleet_plan(
            &pool,
            "an operation",
            &[
                row(&cwd, "objective one", None),
                row(&cwd, "objective two", None),
            ],
        )
        .unwrap();
        let (action, params) = fleet_plan_dispatch_params(&intent, &many);
        assert_eq!(action, "fleet_dispatch");
        assert_eq!(params["operation_intent"], "an operation");
        assert_eq!(params["role_specs"].as_array().unwrap().len(), 2);
        assert_eq!(params["role_specs"][1]["args"][0], "objective two");
    }

    /// The rows arriving at dispatch are the USER-EDITED ones, so what the card
    /// sent is exactly what each session is asked to do — and a chosen skill
    /// LEADS the prompt as its own single positional token, never a flag.
    #[test]
    fn edited_rows_are_what_dispatch_receives() {
        let root = fixture_project();
        let pool = pool_with_project(&root);
        let cwd = root.to_string_lossy().to_string();
        let edited = vec![
            row(&cwd, "the objective the user rewrote", Some("scan-sweep")),
            row(&cwd, "a second, different objective", None),
        ];
        let (intent, plan) = validate_fleet_plan(&pool, "edited plan", &edited).unwrap();
        let (_, params) = fleet_plan_dispatch_params(&intent, &plan);
        let specs = params["role_specs"].as_array().unwrap();
        assert_eq!(
            specs[0]["args"][0],
            "/scan-sweep the objective the user rewrote"
        );
        assert_eq!(specs[0]["role"], "scan-sweep");
        assert_eq!(specs[1]["args"][0], "a second, different objective");
        assert_eq!(specs[1]["role"], "plan-2");
        // Exactly one positional token per session: `spawn_session` appends the
        // variadic `--mcp-config` after these, and anything trailing it would be
        // eaten as a config path.
        for spec in specs {
            assert_eq!(spec["args"].as_array().unwrap().len(), 1);
            assert!(!spec["args"][0].as_str().unwrap().starts_with("--"));
        }
    }
    /// The confirm path's compensating control. The operator accepted that a
    /// typed or spoken request can start terminals with no click, so the durable
    /// ledger row IS the audit — assert it is written, that it carries the
    /// intent, every cwd and every RESOLVED prompt, and that its origin is
    /// distinguishable from an autopilot auto-fire.
    #[test]
    fn a_confirmed_plan_writes_a_ledger_row() {
        let root = fixture_project();
        let pool = pool_with_project(&root);
        pool.get()
            .unwrap()
            .execute_batch(
                "CREATE TABLE fleet_decisions (id TEXT PRIMARY KEY, session_id TEXT NOT NULL,
                    claude_session_id TEXT, screen_hash TEXT NOT NULL, action TEXT NOT NULL,
                    outcome TEXT NOT NULL, confidence TEXT, decision_class TEXT,
                    defer_reason TEXT, rationale TEXT,
                    created_at TEXT NOT NULL DEFAULT (datetime('now')));",
            )
            .unwrap();
        let cwd = root.to_string_lossy().to_string();
        let (intent, plan) = validate_fleet_plan(
            &pool,
            "harden the auth surface",
            &[
                row(&cwd, "write the missing tests", Some("scan-sweep")),
                row(&cwd, "review the token refresh", None),
            ],
        )
        .unwrap();

        record_fleet_plan_decision(
            &pool,
            "fleet_dispatch",
            &intent,
            &plan,
            FLEET_PLAN_OUTCOME_CONFIRMED,
        );

        let conn = pool.get().unwrap();
        let (action, outcome, class, rationale, confidence) = conn
            .query_row(
                "SELECT action, outcome, decision_class, rationale, confidence FROM fleet_decisions",
                [],
                |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, Option<String>>(2)?,
                        r.get::<_, Option<String>>(3)?,
                        r.get::<_, Option<String>>(4)?,
                    ))
                },
            )
            .expect("exactly one ledger row must be written on confirm");

        assert_eq!(action, "fleet_dispatch");
        assert_eq!(outcome, FLEET_PLAN_OUTCOME_CONFIRMED);
        // Origin: an operator pressed Confirm, NOT the boldness dial firing.
        assert_eq!(class.as_deref(), Some(FLEET_PLAN_DECISION_CLASS));
        assert_ne!(outcome, "auto_fired");
        // Nobody self-reported confidence; a human decided.
        assert!(confidence.is_none());

        let rationale = rationale.expect("audit payload");
        assert!(rationale.contains("harden the auth surface"), "{rationale}");
        assert!(rationale.contains("2 session(s)"), "{rationale}");
        assert!(rationale.contains(&cwd), "{rationale}");
        // The RESOLVED prompt, skill included — what the session actually got.
        assert!(
            rationale.contains("/scan-sweep write the missing tests"),
            "{rationale}"
        );
        assert!(rationale.contains("review the token refresh"), "{rationale}");
    }

    #[test]
    fn a_failed_confirm_is_still_recorded_and_told_apart() {
        let root = fixture_project();
        let pool = pool_with_project(&root);
        let cwd = root.to_string_lossy().to_string();
        let (intent, plan) =
            validate_fleet_plan(&pool, "one session", &[row(&cwd, "go", None)]).unwrap();
        // No `fleet_decisions` table here: the ledger write is best-effort and
        // must never turn into a failed dispatch.
        record_fleet_plan_decision(
            &pool,
            "fleet_spawn",
            &intent,
            &plan,
            FLEET_PLAN_OUTCOME_CONFIRMED_FAILED,
        );
        assert_ne!(
            FLEET_PLAN_OUTCOME_CONFIRMED_FAILED,
            FLEET_PLAN_OUTCOME_CONFIRMED
        );
        assert!(fleet_plan_audit_rationale(&intent, &plan).contains("1 session(s)"));
    }
}
