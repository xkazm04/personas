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

    fn flat(keys: &[Vec<u8>]) -> String {
        keys.iter()
            .map(|k| match k.as_slice() {
                b" " => "SP".to_string(),
                b"\r" => "CR".to_string(),
                b"\x1b[A" => "UP".to_string(),
                b"\x1b[B" => "DN".to_string(),
                b"\x1b[C" => "RT".to_string(),
                _ => "?".to_string(),
            })
            .collect::<Vec<_>>()
            .join(",")
    }

    #[test]
    fn select_all_four_then_submit_and_confirm() {
        let keys = multiselect_keystrokes(&menu(), "1,2,3,4").expect("a multi-select plan");
        // Per option: SP then DN (last option no trailing DN); DN past option4,
        // DN past 'Type something' to Submit; CR (confirm), CR (finalize).
        assert_eq!(flat(&keys), "SP,DN,SP,DN,SP,DN,SP,DN,DN,CR,CR");
    }

    #[test]
    fn skips_already_checked_options() {
        let mut m = menu();
        m[1] = "❯ 1. [✔] Cheese".to_string(); // Cheese already selected
        let keys = multiselect_keystrokes(&m, "1,2").expect("a plan");
        // Option 1 already checked → no SP (just DN to opt2); option 2
        // wanted+unchecked → SP, DN; opts 3,4 not wanted → DN each; then DN
        // past 'Type something' to Submit; CR, CR.
        assert_eq!(flat(&keys), "DN,SP,DN,DN,DN,DN,CR,CR");
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
        assert_eq!(flat(&keys), "SP,DN,SP,DN,DN,RT,CR");
    }

    #[test]
    fn none_for_non_menu_or_freetext() {
        // No checkbox menu.
        assert!(multiselect_keystrokes(&["just some prose".to_string()], "1,2").is_none());
        // A menu but a free-text (non-numeric) answer.
        assert!(multiselect_keystrokes(&menu(), "throw an error").is_none());
    }
}

pub(crate) fn execute_fleet_send_input(params: &serde_json::Value) -> Result<ExecuteResult, AppError> {
    let session_id = params
        .get("session_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Internal("fleet_send_input: missing `session_id`".into()))?;
    let text = params
        .get("text")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Internal("fleet_send_input: missing `text`".into()))?;
    let press_enter = params
        .get("press_enter")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);

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
            tracing::warn!(
                target: "fleet_multiselect",
                session_id = %sid,
                plan = ?keys.iter().map(|k| String::from_utf8_lossy(k).into_owned()).collect::<Vec<_>>(),
                screen = %lines.join("\n").chars().take(2200).collect::<String>(),
                "driving multi-select — screen + plan (diagnostic)"
            );
            crate::commands::fleet::debug_log::athena(
                &sid,
                "driving multi-select",
                &format!("{count} keystrokes, 200ms pace, submit-confirmed"),
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
        "Typed {} chars into fleet session `{}`{}.",
        text.chars().count(),
        &session_id[..session_id.len().min(8)],
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
    let right: &[u8] = b"\x1b[C";
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

pub(crate) fn execute_fleet_kill(params: &serde_json::Value) -> Result<ExecuteResult, AppError> {
    let session_id = params
        .get("session_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Internal("fleet_kill: missing `session_id`".into()))?;
    // Soft-kill (PTY EOF). Future hard-kill (Child::kill) is a Phase 6
    // enhancement in the fleet module itself.
    let ok = crate::commands::fleet::registry::registry().close_pty_handles(session_id);
    if !ok {
        return Err(AppError::Internal(format!(
            "fleet_kill: session `{session_id}` not found"
        )));
    }
    Ok(ExecuteResult::message(format!(
        "Closed fleet session `{}` (soft kill — PTY EOF sent).",
        &session_id[..session_id.len().min(8)],
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
    let state = app.state::<Arc<AppState>>();
    let projects = crate::db::repos::dev_tools::list_projects(&state.db, None)?;
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

    // Recursion guard sentinel: tag this session with the user-visible
    // name "athena" so it's obvious in the fleet UI which sessions are
    // Athena-spawned. This same sentinel gates the autonomous
    // `fleet_send_input` autoapprove path (see `is_athena_owned` /
    // `fleet_send_input_targets_athena_session`), so it's sourced from the
    // shared `ATHENA_SESSION_NAME_SENTINEL` constant to keep tag + guard in
    // lockstep. Public rename() preserves the optimistic-update path.
    let _ = crate::commands::fleet::registry::registry().rename(
        &id,
        Some(crate::commands::fleet::registry::ATHENA_SESSION_NAME_SENTINEL.to_string()),
    );

    Ok(ExecuteResult::message(format!(
        "Spawned fleet session `{}` in `{}`. Tagged \"athena\" for visibility.",
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

        // Visible-name = "athena-<role>" so the user sees both the
        // recursion-guard sentinel AND the role in the Fleet UI. Sourced from
        // the shared `ATHENA_SESSION_NAME_SENTINEL` so the autonomous
        // `fleet_send_input` guard (`is_athena_owned`) recognizes these
        // dispatched sessions as Athena-owned.
        let _ = crate::commands::fleet::registry::registry().rename(
            &id,
            Some(format!(
                "{}-{role}",
                crate::commands::fleet::registry::ATHENA_SESSION_NAME_SENTINEL
            )),
        );

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
    let session_id = params
        .get("session_id")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| AppError::Internal("fleet_intervene: missing `session_id`".into()))?;
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

