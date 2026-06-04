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
use crate::db::repos::execution::audit_incidents as incident_repo;
use crate::db::DbPool;
use rusqlite::params;

/// Max teammates listed in the roster (excludes the executing persona).
const MAX_ROSTER: usize = 8;
/// Max active goals listed.
const MAX_GOALS: usize = 6;
/// Max open incidents surfaced (hard cap — run-10 prompt-bloat guardrail).
const MAX_INCIDENTS: usize = 5;
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

/// One open-incident row for the "known incidents to avoid" section. Flat,
/// pre-stringified shape so the renderer stays DB-free / unit-testable
/// (mirrors `GoalLine`). `desc` carries the incident's `detail`, one-lined.
struct IncidentLine {
    severity: String,
    title: String,
    desc: String,
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

    // --- 3. Open incidents seen by the team's personas (avoid repeat failures) ---
    // `audit_incidents` has no project/team FK, so scope by the roster's persona
    // ids (whole team incl. self — a failure any member hit is worth every
    // member avoiding). roster_rows is already fetched above; no extra query.
    let roster_ids: Vec<String> = roster_rows.iter().map(|(id, ..)| id.clone()).collect();
    let incidents = gather_open_incidents(pool, &roster_ids);

    let alignment = render_alignment_block(
        &persona.name,
        self_role.as_deref(),
        team_name,
        &teammates,
        &goals,
        &incidents,
    );

    // Append the project's standards & branching policy (Pipeline Stage 3) so
    // team personas (Dev Clone, QA Guardian) implement, commit, and open/merge
    // PRs in line with it. Resolved from the same project as the goals.
    let standards = resolve_standards_policy(pool, persona, team_id);
    match (alignment, standards) {
        (Some(a), Some(s)) => Some(format!("{a}{s}")),
        (Some(a), None) => Some(a),
        (None, Some(s)) => Some(s),
        (None, None) => None,
    }
}

/// Render the bound project's standards & branching policy as a prompt block,
/// resolved from `standards_config` (Pipeline Stage 3). `None` when no project
/// resolves or no policy is configured. Branch selectors resolve to the
/// project's `main_branch` / `test_env_branch`.
fn resolve_standards_policy(pool: &DbPool, persona: &Persona, team_id: &str) -> Option<String> {
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
        })?;
    let project = dt_repo::get_project_by_id(pool, &project_id).ok()?;
    let cfg: serde_json::Value = serde_json::from_str(project.standards_config.as_deref()?).ok()?;

    let main_b = project.main_branch.as_deref().unwrap_or("main");
    let test_b = project.test_env_branch.as_deref().unwrap_or("");
    let resolve_branch = |sel: &str| if sel == "test" { test_b } else { main_b };

    let branching = cfg.get("branching");
    let pr_base = resolve_branch(
        branching
            .and_then(|b| b.get("pr_base"))
            .and_then(|v| v.as_str())
            .unwrap_or("main"),
    );
    let automerge = branching.and_then(|b| b.get("automerge"));
    let am_enabled = automerge
        .and_then(|a| a.get("enabled"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let am_target = resolve_branch(
        automerge
            .and_then(|a| a.get("target"))
            .and_then(|v| v.as_str())
            .unwrap_or("main"),
    );

    let pc = cfg.get("precommit");
    let pc_flag = |k: &str| {
        pc.and_then(|p| p.get(k))
            .and_then(|v| v.as_bool())
            .unwrap_or(false)
    };
    let mut gates: Vec<&str> = Vec::new();
    if pc_flag("lint") {
        gates.push("lint");
    }
    if pc_flag("docs_required") {
        gates.push("docs-updated");
    }
    if pc_flag("code_quality") {
        gates.push("code-quality");
    }
    let gates_str = if gates.is_empty() {
        "none".to_string()
    } else {
        gates.join(", ")
    };
    let automerge_str = if am_enabled {
        format!("ENABLED — but the QA GUARDIAN performs the merge, NOT the implementer. After QA's tests pass in its isolated worktree, QA enables GitHub native auto-merge into `{am_target}` (or, if the repo enforces no required status checks, merges directly via `gh pr merge`). The implementer (Dev Clone) MUST NOT merge or enable auto-merge — it opens the PR and hands off")
    } else {
        "disabled — do not auto-merge (QA tests a PR and approves it for a human to merge; the implementer never merges)".to_string()
    };

    Some(format!(
        "\n\n## STANDARDS & BRANCHING POLICY — project \"{}\"\nThis project's team must respect the following when implementing, committing, and opening/merging PRs:\n- Open pull requests against the branch `{}`.\n- Pre-commit gates that must pass before you commit: {}.\n- Gate scope: run the gates on YOUR increment (the changed files / PR diff), NOT the whole repository. Pre-existing repo-wide lint/test debt that you did not introduce (stray files, baseline errors on untouched code) is a WARN to record, NOT a commit/release blocker — do not HOLD the team's deliverable on baseline debt you didn't create. Only block on gate failures your own change introduced.\n- Architect / scoping: size each increment to fit ONE Dev Clone pass — the engine HARD-CAPS any single execution at 20 minutes, so an increment that needs more WILL time out before it can open a PR. Decompose a larger feature into multiple INDEPENDENT, vertically-sliced increments (each its own implement → PR → QA → merge step). The team runs SEVERAL of these IN PARALLEL, so each increment MUST be truly non-overlapping — touch different files/modules so concurrent increments never edit the same code or step on each other.\n- Implementer (Dev Clone) in TEAM MODE: ISOLATE your work in a DEDICATED git worktree off the base branch (`git worktree add <scratch-path> -b dev-clone/<slug>`), NEVER the team's shared checkout, so increments running IN PARALLEL never collide on the working tree; make every change there, and `git worktree remove` it once your PR is open. Once your increment is green there, OPEN A PR against `{}` via `gh pr create` and emit `dev-clone.pr.created` (PR url + branch + repo) so QA Guardian tests it in an isolated worktree and merges-or-returns it — do NOT commit straight to the base branch; the PR + QA test gate is the point of this team's flow. You (the implementer) MUST NOT merge or enable auto-merge — even when automerge is enabled for this project; performing the merge is the QA Guardian's exclusive job, done only AFTER its tests pass. Your job ends at opening the PR + emitting dev-clone.pr.created. ALSO emit implementation.completed so the Code Reviewer reviews.\n- Merge authority (CODE changes): the QA GUARDIAN is the SOLE merge authority for IMPLEMENTATION/code PRs — it merges (or enables native auto-merge on) a code PR ONLY after its own tests pass in an isolated worktree off the PR head, and requests changes (qa.pr.changes_requested) if they fail. Neither the implementer nor any other role may merge or enable auto-merge on a CODE PR. Because the repo may not enforce branch protection, this hand-off IS the gate; an implementer that self-merges its own PR defeats the entire QA gate.\n- Mechanical lanes (Release Manager + Docs Steward): version bumps, CHANGELOG entries, tags, and documentation syncs (README / docs/**) are MECHANICAL changes that do NOT go through the PR+QA gate — commit them DIRECTLY to the base branch as small atomic commits touching ONLY those files (never source code). Do NOT open PRs in these lanes: unowned release/docs PRs pile up unmerged and supersede each other. If a stale PR already exists in your own lane, you may merge or close it yourself. Anything that touches source code still goes through implement → PR → QA.\n- Automerge: {}.\n- Deployment is FULLY AUTOMATIC: the platform's CI/CD (e.g. Vercel) deploys from the configured branch when a branch/PR is pushed or merged. NEVER run manual deployment commands (`vercel`, `vercel deploy`, `npm run deploy`, build-and-publish scripts, etc.) — they are redundant with the auto-deploy and cause duplicate/incorrect deployments. The team's job ends at the PR (Dev Clone), the QA verdict (QA Guardian), and the version bump + changelog (Release Manager); the platform performs the deploy itself.\n- Output routing — keep the USER's surfaces clean and business-level: (1) MESSAGES = ONE business-level summary per increment (what shipped + why it matters to the business), NOT a step-by-step log of each role's action. (2) HUMAN REVIEW = only genuine business/policy decisions that need a human (pricing, compliance/PHI, production config, an irreversible or destructive change) — technical status (a red build, a missing dependency, a code-review change-request, a mis-sequenced handoff) is NOT a Human Review item; resolve it within the team or report it in the increment result. (3) MEMORIES = only durable lessons useful to FUTURE runs (a decision, a gotcha, a convention), never raw step logs or per-execution telemetry.\n",
        project.name, pr_base, gates_str, pr_base, automerge_str
    ))
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

/// Resolve open high/critical incidents for the team's personas so members
/// avoid repeating known failures. DB access is confined here; the renderer
/// stays pure (mirrors `gather_active_goals`). Scope is by `persona_id` because
/// `audit_incidents` carries no project/team FK and no `last_seen_at`.
fn gather_open_incidents(pool: &DbPool, roster_ids: &[String]) -> Vec<IncidentLine> {
    if roster_ids.is_empty() {
        return Vec::new();
    }
    // Over-fetch (newest-first) so the high/critical filter can still fill
    // MAX_INCIDENTS even when lower-severity rows lead the recent list.
    let fetch = (MAX_INCIDENTS as i64) * 8;
    let mut rows = match incident_repo::list_open_by_personas(pool, roster_ids, fetch) {
        Ok(r) => r,
        Err(_) => return Vec::new(),
    };

    // Keep only high/critical, then rank critical-before-high. Within a severity
    // the repo already returned newest-first (created_at DESC), and Rust's sort
    // is stable, so that recency tiebreak is preserved.
    rows.retain(|i| severity_rank(&i.severity) <= 1);
    rows.sort_by_key(|i| severity_rank(&i.severity));

    rows.into_iter()
        .take(MAX_INCIDENTS)
        .map(|i| IncidentLine {
            severity: normalized_severity(&i.severity),
            title: truncate_line(&i.title, CAP_LINE_CHARS),
            desc: truncate_line(i.detail.as_deref().unwrap_or(""), CAP_LINE_CHARS),
        })
        .collect()
}

/// Sort/filter weight for an incident severity. Lower = more urgent. high/
/// critical are rank 0–1 (surfaced); medium/low and unknown are >=2 (dropped).
fn severity_rank(severity: &str) -> u8 {
    match severity.trim().to_ascii_lowercase().as_str() {
        "critical" => 0,
        "high" => 1,
        "medium" => 2,
        "low" => 3,
        _ => 4,
    }
}

/// Normalize a severity token to a stable lowercase display bucket.
fn normalized_severity(severity: &str) -> String {
    severity.trim().to_ascii_lowercase()
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
    incidents: &[IncidentLine],
) -> Option<String> {
    if teammates.is_empty() && goals.is_empty() && incidents.is_empty() {
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

    if !incidents.is_empty() {
        out.push_str(
            "\n**Known incidents to avoid** (open issues seen by this team — don't reintroduce these)\n",
        );
        for inc in incidents {
            let desc = if inc.desc.is_empty() {
                String::new()
            } else {
                format!(" — {}", inc.desc)
            };
            out.push_str(&format!("- [{}] **{}**{desc}\n", inc.severity, inc.title));
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

    fn inc(severity: &str, title: &str, desc: &str) -> IncidentLine {
        IncidentLine {
            severity: severity.into(),
            title: title.into(),
            desc: desc.into(),
        }
    }

    #[test]
    fn renders_incidents_only() {
        let incidents = vec![
            inc("critical", "OAuth refresh storms 401s", "Daily token expiry under GCP testing mode"),
            inc("high", "Adoption modal freeze", ""),
        ];
        let block = render_alignment_block("Solo", None, "AI Bookkeeper", &[], &[], &incidents)
            .expect("incidents-only should still render the block");
        assert!(block.contains("Known incidents to avoid"));
        assert!(block.contains("[critical]"));
        assert!(block.contains("OAuth refresh storms 401s"));
        assert!(block.contains("Daily token expiry"));
        // High incident with empty detail renders title without a trailing desc.
        assert!(block.contains("[high] **Adoption modal freeze**"));
        assert!(!block.contains("Adoption modal freeze** —"));
    }

    #[test]
    fn incidents_appended_after_goals_and_roster() {
        let teammates = vec![tm("QA Guardian", "reviewer", "Reviews PRs")];
        let goals = vec![goal("in-progress", 40, "Ship the bookkeeper", true)];
        let incidents = vec![inc("critical", "Race in goal-advance", "Double-counted progress")];
        let block = render_alignment_block(
            "Account Classifier",
            Some("worker"),
            "AI Bookkeeper",
            &teammates,
            &goals,
            &incidents,
        )
        .expect("renders");
        let goals_at = block.find("Active team goals").expect("has goals header");
        let inc_at = block.find("Known incidents to avoid").expect("has incidents header");
        assert!(inc_at > goals_at, "incidents section must come after goals");
        assert!(block.contains("Race in goal-advance"));
    }

    #[test]
    fn severity_rank_orders_and_filters() {
        // Ranking: critical < high < medium < low < unknown.
        assert!(severity_rank("CRITICAL") < severity_rank("high"));
        assert!(severity_rank("high") < severity_rank("medium"));
        assert!(severity_rank("medium") < severity_rank("low"));
        // Filter contract used by gather_open_incidents: rank <= 1 == high/critical.
        assert!(severity_rank("critical") <= 1);
        assert!(severity_rank("high") <= 1);
        assert!(severity_rank("medium") > 1);
        assert!(severity_rank("low") > 1);
        assert!(severity_rank("weird") > 1);
        // Display normalization trims + lowercases.
        assert_eq!(normalized_severity("  Critical "), "critical");
        assert_eq!(normalized_severity("HIGH"), "high");
    }

    #[test]
    fn empty_when_no_roster_and_no_goals() {
        assert!(render_alignment_block("Solo", None, "Team", &[], &[], &[]).is_none());
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
            &[],
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
        let block = render_alignment_block("Solo", None, "Team", &[], &goals, &[]).expect("renders");
        assert!(block.contains("Lone goal"));
        assert!(!block.contains("Your teammates"));
    }

    #[test]
    fn renders_no_active_goals_note_when_roster_present() {
        let teammates = vec![tm("Peer", "worker", "Does things")];
        let block = render_alignment_block("Me", None, "Team", &teammates, &[], &[]).expect("renders");
        assert!(block.contains("none set yet"));
        assert!(block.contains("Peer"));
    }

    #[test]
    fn role_clause_omitted_for_plain_worker() {
        let goals = vec![goal("open", 0, "G", false)];
        let block = render_alignment_block("W", Some("worker"), "T", &[], &goals, &[]).unwrap();
        // The doctrine text says "read the team's active goals", so the role
        // clause is identified by the bolded-role pattern, not the bare phrase.
        assert!(!block.contains("the team's **"));
    }

    #[test]
    fn role_clause_present_for_named_role() {
        let goals = vec![goal("open", 0, "G", false)];
        let block = render_alignment_block("O", Some("orchestrator"), "T", &[], &goals, &[]).unwrap();
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
