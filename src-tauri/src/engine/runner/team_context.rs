//! Team-alignment "pre-ritual" — the block injected once into every team
//! member's execution prompt so each persona acts with awareness of (1) who it
//! is and what it can do, (2) which team wraps it and who its teammates are, and
//! (3) the team's active goals — then DECIDES, from its own capabilities, whether
//! and how the work aligns.
//!
//! The relevance call is **LLM-driven, not pre-computed**: we inject the team's
//! goals and let the persona self-filter against its own stated capabilities (the
//! "## Active Capabilities" section already in the prompt), exactly as a real
//! teammate reads the standup board and decides what's theirs. This is cheaper on
//! the hot path than an embedding/LLM match per execution, and it is "driven
//! inner from persona design" — the alignment lives in the persona's judgment,
//! wrapped identically around every member.
//!
//! Cost guardrail (the run-10 memory-bloat finding): the block is hard-bounded —
//! roster capped at [`MAX_ROSTER`], goals capped at [`MAX_GOALS`], every line
//! collapsed to one sentence and truncated — so it stays compact (~1.5–2k chars)
//! as team and goal state compound.
//!
//! See `docs/features/pipeline/team-orchestration.md` (the execution-time
//! awareness section) and `docs/plans/team-engagement.md` (spec 3a).

use crate::db::models::Persona;
use crate::db::repos::dev_tools as dt_repo;
use crate::db::DbPool;
use rusqlite::params;

/// Max teammates listed in the roster (excludes the executing persona).
const MAX_ROSTER: usize = 8;
/// Max active goals listed.
const MAX_GOALS: usize = 6;
/// Max chars for any single rendered line (capability / goal description).
const CAP_LINE_CHARS: usize = 140;

/// One teammate row for the roster section.
struct Teammate {
    name: String,
    role: String,
    capability: String,
}

/// One active-goal row for the goals section.
struct GoalLine {
    status: String,
    progress: i32,
    title: String,
    desc: String,
    /// `true` when a `team_assignment` for this team is actively advancing the
    /// goal (the canonical `team_assignments.goal_id` link).
    advancing: bool,
}

/// Build the team-alignment block for `persona` executing under `team_id`.
///
/// Returns `None` when there's nothing meaningful to inject (the persona has no
/// teammates AND the team has no active goals), so the caller can skip the
/// section entirely.
pub fn build_team_alignment_block(
    pool: &DbPool,
    persona: &Persona,
    team_name: &str,
    team_id: &str,
) -> Option<String> {
    // --- 1. Roster + each member's headline capability (one join query) ---
    // (id, name, role, design_context, description)
    let roster_rows: Vec<(String, String, String, Option<String>, Option<String>)> = {
        let conn = pool.get().ok()?;
        let mut stmt = conn
            .prepare(
                "SELECT p.id, p.name, ptm.role, p.design_context, p.description
                 FROM persona_team_members ptm
                 JOIN personas p ON p.id = ptm.persona_id
                 WHERE ptm.team_id = ?1
                 ORDER BY ptm.created_at ASC",
            )
            .ok()?;
        let rows = stmt
            .query_map(params![team_id], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, Option<String>>(3)?,
                    r.get::<_, Option<String>>(4)?,
                ))
            })
            .ok()?;
        rows.filter_map(Result::ok).collect()
    };

    // The executing persona's own role on the team (for the intro line).
    let self_role: Option<String> = roster_rows
        .iter()
        .find(|(id, ..)| *id == persona.id)
        .map(|(_, _, role, ..)| role.clone());

    let teammates: Vec<Teammate> = roster_rows
        .iter()
        .filter(|(id, ..)| *id != persona.id)
        .take(MAX_ROSTER)
        .map(|(_, name, role, dc, desc)| Teammate {
            name: name.clone(),
            role: role.clone(),
            capability: top_capability(dc.as_deref(), desc.as_deref()),
        })
        .collect();

    // --- 2. Active team goals ---
    let goals = gather_active_goals(pool, persona, team_id);

    render_alignment_block(
        &persona.name,
        self_role.as_deref(),
        team_name,
        &teammates,
        &goals,
    )
}

/// Resolve the team's active (non-done) goals, flagging which ones a team
/// assignment is actively advancing. Goals come from the persona's pinned
/// project (`design_context.dev_project_id`), falling back to the project the
/// team is pinned to (`dev_projects.team_id`). If neither resolves, we fall back
/// to whatever goals the team is directly advancing via `team_assignments`.
fn gather_active_goals(pool: &DbPool, persona: &Persona, team_id: &str) -> Vec<GoalLine> {
    // Canonical "this team is advancing goal X" set (team_assignments.goal_id).
    let advancing: std::collections::HashSet<String> = {
        match pool.get() {
            Ok(conn) => conn
                .prepare(
                    "SELECT DISTINCT goal_id FROM team_assignments
                     WHERE team_id = ?1 AND goal_id IS NOT NULL",
                )
                .and_then(|mut stmt| {
                    let rows = stmt.query_map(params![team_id], |r| r.get::<_, String>(0))?;
                    Ok(rows.filter_map(Result::ok).collect::<Vec<_>>())
                })
                .map(|v| v.into_iter().collect())
                .unwrap_or_default(),
            Err(_) => std::collections::HashSet::new(),
        }
    };

    // Resolve the project whose goals describe this team's direction.
    let project_id = persona
        .parsed_design_context()
        .dev_project_id
        .filter(|p| !p.is_empty())
        .or_else(|| {
            pool.get().ok().and_then(|conn| {
                conn.query_row(
                    "SELECT id FROM dev_projects WHERE team_id = ?1 LIMIT 1",
                    params![team_id],
                    |r| r.get::<_, String>(0),
                )
                .ok()
            })
        });

    let mut goals: Vec<GoalLine> = Vec::new();

    if let Some(pid) = project_id {
        if let Ok(rows) = dt_repo::list_goals_by_project(pool, &pid, None) {
            for g in rows {
                if is_done_status(&g.status) {
                    continue;
                }
                goals.push(GoalLine {
                    advancing: advancing.contains(&g.id),
                    status: normalized_status(&g.status),
                    progress: g.progress,
                    title: g.title,
                    desc: truncate_line(g.description.as_deref().unwrap_or(""), CAP_LINE_CHARS),
                });
            }
        }
    }

    // Fallback: no project resolved but the team is advancing goals directly —
    // surface those goal rows so awareness isn't empty.
    if goals.is_empty() && !advancing.is_empty() {
        for gid in &advancing {
            if let Ok(g) = dt_repo::get_goal_by_id(pool, gid) {
                if is_done_status(&g.status) {
                    continue;
                }
                goals.push(GoalLine {
                    advancing: true,
                    status: normalized_status(&g.status),
                    progress: g.progress,
                    title: g.title,
                    desc: truncate_line(g.description.as_deref().unwrap_or(""), CAP_LINE_CHARS),
                });
            }
        }
    }

    // Order: in-progress first, then blocked, then open; advancing wins ties;
    // higher progress first. Then cap.
    goals.sort_by(|a, b| {
        status_rank(&a.status)
            .cmp(&status_rank(&b.status))
            .then(b.advancing.cmp(&a.advancing))
            .then(b.progress.cmp(&a.progress))
    });
    goals.truncate(MAX_GOALS);
    goals
}

/// Pure renderer — assembles the markdown block from already-gathered data.
/// Kept DB-free so it's unit-testable. Returns `None` when there is neither a
/// teammate nor a goal to show.
fn render_alignment_block(
    persona_name: &str,
    self_role: Option<&str>,
    team_name: &str,
    teammates: &[Teammate],
    goals: &[GoalLine],
) -> Option<String> {
    if teammates.is_empty() && goals.is_empty() {
        return None;
    }

    let mut out = String::new();
    out.push_str(&format!("\n\n## Team Alignment — {team_name}\n\n"));

    // Intro / doctrine — the self-filter rule lives here.
    let role_clause = match self_role {
        Some(r) if !r.trim().is_empty() && r != "worker" => format!(" — the team's **{r}**"),
        _ => String::new(),
    };
    out.push_str(&format!(
        "You're **{persona_name}**{role_clause} on the **{team_name}** team. \
         Before you act, read the team's active goals below and judge — from your own \
         capabilities — whether and how this work advances them. Align where it genuinely \
         relates to what you do; don't force-fit your output onto a goal it doesn't serve, \
         and don't take over a teammate's lane. When your work meaningfully moves a goal \
         forward, record it (write a team memory or emit the goal-progress signal) so the \
         team sees the advance.\n\n"
    ));

    if !teammates.is_empty() {
        out.push_str("**Your teammates** (who owns what — coordinate, don't duplicate)\n");
        for tm in teammates {
            let cap = if tm.capability.is_empty() {
                String::new()
            } else {
                format!(" — {}", tm.capability)
            };
            out.push_str(&format!("- **{}** ({}){}\n", tm.name, tm.role, cap));
        }
        out.push('\n');
    }

    if goals.is_empty() {
        out.push_str(
            "**Active team goals**: none set yet. Focus on your task; if you see a direction \
             question, flag it to the team rather than inventing a goal.\n",
        );
    } else {
        out.push_str("**Active team goals**\n");
        let any_advancing = goals.iter().any(|g| g.advancing);
        for g in goals {
            let marker = if g.advancing { "▶ " } else { "" };
            let desc = if g.desc.is_empty() {
                String::new()
            } else {
                format!(" — {}", g.desc)
            };
            out.push_str(&format!(
                "- {marker}[{} · {}%] **{}**{desc}\n",
                g.status, g.progress, g.title
            ));
        }
        if any_advancing {
            out.push_str("\n_▶ = a team assignment is actively advancing this goal._\n");
        }
    }

    Some(out)
}

/// Extract a one-line "what this member does" headline from a persona's
/// `design_context` (first enabled use case's `capability_summary` ||
/// `description`), falling back to the persona's own `description`. Always one
/// line, truncated to [`CAP_LINE_CHARS`].
fn top_capability(design_context: Option<&str>, fallback_desc: Option<&str>) -> String {
    if let Some(dc_json) = design_context {
        if let Ok(dc) = serde_json::from_str::<serde_json::Value>(dc_json) {
            if let Some(use_cases) = crate::engine::design_context::pick_use_cases_array(&dc) {
                for uc in use_cases {
                    if uc.get("enabled").and_then(|v| v.as_bool()) == Some(false) {
                        continue;
                    }
                    let summary = uc
                        .get("capability_summary")
                        .and_then(|v| v.as_str())
                        .filter(|s| !s.trim().is_empty())
                        .or_else(|| uc.get("description").and_then(|v| v.as_str()));
                    if let Some(s) = summary {
                        return truncate_line(s, CAP_LINE_CHARS);
                    }
                }
            }
        }
    }
    truncate_line(fallback_desc.unwrap_or(""), CAP_LINE_CHARS)
}

/// Collapse whitespace/newlines to single spaces and truncate to `max` chars
/// (on a char boundary), appending an ellipsis when cut.
fn truncate_line(s: &str, max: usize) -> String {
    let collapsed: String = s.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.chars().count() <= max {
        return collapsed;
    }
    let mut truncated: String = collapsed.chars().take(max.saturating_sub(1)).collect();
    truncated.push('…');
    truncated
}

/// Normalize a raw goal status into the canonical display bucket, mirroring the
/// frontend `normalizeGoalStatus` / Rust `normalize_goal_status`.
fn normalized_status(status: &str) -> String {
    match status.trim().to_ascii_lowercase().as_str() {
        "in-progress" | "in_progress" | "running" | "active" | "matching" => "in-progress".into(),
        "blocked" | "review" | "awaiting_review" => "blocked".into(),
        "done" | "completed" | "complete" | "skipped" => "done".into(),
        _ => "open".into(),
    }
}

/// `true` for any status that normalizes to "done".
fn is_done_status(status: &str) -> bool {
    normalized_status(status) == "done"
}

/// Sort weight: in-progress goals first, then blocked, then open.
fn status_rank(normalized: &str) -> u8 {
    match normalized {
        "in-progress" => 0,
        "blocked" => 1,
        "open" => 2,
        _ => 3,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tm(name: &str, role: &str, cap: &str) -> Teammate {
        Teammate {
            name: name.into(),
            role: role.into(),
            capability: cap.into(),
        }
    }
    fn goal(status: &str, progress: i32, title: &str, advancing: bool) -> GoalLine {
        GoalLine {
            status: status.into(),
            progress,
            title: title.into(),
            desc: String::new(),
            advancing,
        }
    }

    #[test]
    fn empty_when_no_roster_and_no_goals() {
        assert!(render_alignment_block("Solo", None, "Team", &[], &[]).is_none());
    }

    #[test]
    fn renders_roster_goals_and_doctrine() {
        let teammates = vec![
            tm("QA Guardian", "reviewer", "Reviews PRs and gates merges"),
            tm("Doc Steward", "worker", "Keeps docs in sync"),
        ];
        let goals = vec![
            goal("in-progress", 40, "Ship the bookkeeper", true),
            goal("open", 0, "Backfill 2024 ledgers", false),
        ];
        let block = render_alignment_block(
            "Account Classifier",
            Some("worker"),
            "AI Bookkeeper",
            &teammates,
            &goals,
        )
        .expect("should render");

        // Identity + team
        assert!(block.contains("Account Classifier"));
        assert!(block.contains("AI Bookkeeper"));
        // Self-filter doctrine
        assert!(block.contains("from your own"));
        assert!(block.contains("don't force-fit"));
        // Roster (teammates, not self)
        assert!(block.contains("QA Guardian"));
        assert!(block.contains("Reviews PRs"));
        // Goals + advancing marker
        assert!(block.contains("Ship the bookkeeper"));
        assert!(block.contains("▶ "));
        assert!(block.contains("40%"));
    }

    #[test]
    fn renders_with_goals_but_no_teammates() {
        let goals = vec![goal("open", 10, "Lone goal", false)];
        let block = render_alignment_block("Solo", None, "Team", &[], &goals).expect("renders");
        assert!(block.contains("Lone goal"));
        assert!(!block.contains("Your teammates"));
    }

    #[test]
    fn renders_no_active_goals_note_when_roster_present() {
        let teammates = vec![tm("Peer", "worker", "Does things")];
        let block = render_alignment_block("Me", None, "Team", &teammates, &[]).expect("renders");
        assert!(block.contains("none set yet"));
        assert!(block.contains("Peer"));
    }

    #[test]
    fn role_clause_omitted_for_plain_worker() {
        let goals = vec![goal("open", 0, "G", false)];
        let block = render_alignment_block("W", Some("worker"), "T", &[], &goals).unwrap();
        // The doctrine text says "read the team's active goals", so the role
        // clause is identified by the bolded-role pattern, not the bare phrase.
        assert!(!block.contains("the team's **"));
    }

    #[test]
    fn role_clause_present_for_named_role() {
        let goals = vec![goal("open", 0, "G", false)];
        let block = render_alignment_block("O", Some("orchestrator"), "T", &[], &goals).unwrap();
        assert!(block.contains("the team's **orchestrator**"));
    }

    #[test]
    fn truncate_line_collapses_and_caps() {
        assert_eq!(truncate_line("  a\n  b   c ", 140), "a b c");
        let long = "x".repeat(200);
        let out = truncate_line(&long, 140);
        assert_eq!(out.chars().count(), 140);
        assert!(out.ends_with('…'));
    }

    #[test]
    fn top_capability_prefers_enabled_use_case_summary() {
        let dc = r#"{"use_cases":[
            {"enabled":false,"capability_summary":"disabled one"},
            {"capability_summary":"Classifies transactions into accounts"}
        ]}"#;
        assert_eq!(
            top_capability(Some(dc), Some("fallback")),
            "Classifies transactions into accounts"
        );
    }

    #[test]
    fn top_capability_falls_back_to_description() {
        assert_eq!(top_capability(None, Some("a worker bee")), "a worker bee");
        assert_eq!(top_capability(Some("{}"), Some("desc")), "desc");
    }

    #[test]
    fn status_normalization_buckets() {
        assert_eq!(normalized_status("in_progress"), "in-progress");
        assert_eq!(normalized_status("awaiting_review"), "blocked");
        assert!(is_done_status("completed"));
        assert!(!is_done_status("open"));
        assert!(status_rank("in-progress") < status_rank("open"));
    }
}
