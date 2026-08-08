//! `night_plan` background job — composes tonight's bounded night-shift plan
//! and emits it as a `companion_approval` card (`night_shift_execute_plan`).
//!
//! The job is judgment-only: it reads goals + backlog + registered projects
//! + per-project dev memories, makes ONE CLI call, bounds the result
//! (`night_shift::planner::bound_plan`), and persists a `proposed` plan. NO
//! session is spawned here — dispatch happens exclusively in the approval
//! executor after the user confirms the card (no plan runs unapproved).

use crate::companion::brain::{backlog, goals};
use crate::companion::night_shift::{self, planner};
use crate::companion::session::DEFAULT_SESSION_ID;
use crate::db::UserDbPool;
use crate::error::AppError;

pub const KIND: &str = "night_plan";

pub async fn run(
    pool: &UserDbPool,
    sys_db: &crate::db::DbPool,
    _params: &serde_json::Value,
    progress: &super::JobProgress,
) -> Result<String, AppError> {
    progress.report("Reading goals, backlog and project memory…");

    // Re-entrancy guard: if a live plan already exists (double-enqueued tick,
    // retried job), don't stack a second proposal card.
    {
        let conn = pool.get()?;
        let live: Option<i64> = rusqlite::OptionalExtension::optional(conn.query_row(
            "SELECT 1 FROM companion_night_plan
             WHERE status IN ('proposed', 'approved', 'running') LIMIT 1",
            [],
            |r| r.get(0),
        ))?;
        if live.is_some() {
            return Ok("A night plan is already live — not proposing another.".to_string());
        }
    }

    // Allowlist: registered dev projects are the ONLY dispatch targets.
    let projects = crate::db::repos::dev_tools::list_projects(sys_db, None)?;
    if projects.is_empty() {
        return Ok("No registered dev projects — nothing to plan tonight.".to_string());
    }
    let allowed: Vec<planner::AllowedProject> = projects
        .iter()
        .map(|p| (p.name.clone(), p.root_path.clone()))
        .collect();
    let max_sessions = night_shift::max_sessions(sys_db);

    let goals_block = goals::list_goals(pool, Some(goals::GoalStatus::Active), 15)
        .unwrap_or_default()
        .iter()
        .map(|g| format!("- [{}] {} (priority {})", g.status, g.title, g.priority))
        .collect::<Vec<_>>()
        .join("\n");
    let backlog_block = backlog::list_items(pool, None, true, 20)
        .unwrap_or_default()
        .iter()
        .map(|b| format!("- ({}) {}", b.kind, b.summary))
        .collect::<Vec<_>>()
        .join("\n");
    let projects_block = projects
        .iter()
        .map(|p| {
            let memories = crate::db::repos::dev_memories::get_for_injection(sys_db, &p.id, 6)
                .ok()
                .and_then(|m| crate::db::repos::dev_memories::render_for_prompt(&m, 900))
                .unwrap_or_default();
            let mem_suffix = if memories.is_empty() {
                String::new()
            } else {
                format!("\n  memory:\n{}", indent(&memories, "    "))
            };
            format!(
                "- {} — cwd: {}{}{}",
                p.name,
                p.root_path,
                p.description
                    .as_deref()
                    .map(|d| format!(" — {d}"))
                    .unwrap_or_default(),
                mem_suffix
            )
        })
        .collect::<Vec<_>>()
        .join("\n");

    progress.report("Composing tonight's plan…");
    let prompt = planner::build_prompt(&goals_block, &backlog_block, &projects_block, max_sessions);
    // The ledger row is written INSIDE the leg now (`origin='maintenance'`,
    // `trigger_kind='night_planner'`, with the real cost from the CLI's
    // terminal `result` event). This used to be followed by a hand-written
    // `origin='headless'` row carrying no usage at all — attribution without a
    // number, because oneshot did not parse `result`. Keeping it would double
    // count every night plan, once truthfully and once as a costless headless
    // turn. See `brain::oneshot` and docs/plans/athena-longevity.md (L1a).
    let draft = planner::compose_plan(pool, &prompt).await?;

    // The bounded pre-check — refuses out-of-allowlist / oversized work here,
    // before any card exists.
    let plan = planner::bound_plan(draft, &allowed, max_sessions);
    if plan.items.is_empty() {
        return Ok(
            "I looked at the goals and backlog — nothing is worth an unattended session \
             tonight. No plan card issued."
                .to_string(),
        );
    }

    let plan_json = serde_json::to_string(&plan)
        .map_err(|e| AppError::Internal(format!("night plan serialize: {e}")))?;
    let summary = if plan.summary.trim().is_empty() {
        format!("Night shift: {} session(s) proposed", plan.items.len())
    } else {
        plan.summary.clone()
    };
    let row = night_shift::insert_plan(pool, &summary, &plan_json, max_sessions)?;

    // Approval card — the consent surface. Reuses the existing ApprovalCard
    // pipeline (`companion_approve_action` → night executor).
    let mut rationale = format!("{summary}\n\nTonight I would dispatch:");
    for item in &plan.items {
        rationale.push_str(&format!("\n• {} — {}", item.project, item.objective));
    }
    rationale.push_str(
        "\n\nRules: branch-only writes (no default-branch commits, no pushes), destructive \
         requests park for you, everything is reviewed and rolled up in your morning report. \
         Approve to run tonight; reject to skip.",
    );
    let approval = insert_plan_approval(pool, &row.id, &rationale)?;

    // Announce so the card appears without waiting for a refetch.
    if let Some(app) = progress.app_handle() {
        use tauri::Emitter;
        if let Err(e) = app.emit(crate::companion::session::APPROVALS_EVENT, vec![approval]) {
            tracing::warn!(error = %e, "night_plan: approvals event emit failed");
        }
    }

    Ok(format!(
        "Night plan `{}` proposed with {} session(s) — awaiting your approval before \
         anything runs.\n\n{}",
        row.id,
        plan.items.len(),
        summary
    ))
}

fn insert_plan_approval(
    pool: &UserDbPool,
    plan_id: &str,
    rationale: &str,
) -> Result<crate::companion::dispatcher::CreatedApproval, AppError> {
    let id = format!("appr_{}", crate::companion::util::short_id(12));
    let params = serde_json::json!({ "plan_id": plan_id });
    let payload = serde_json::json!({
        "action": "night_shift_execute_plan",
        "params": params,
        "rationale": rationale,
    })
    .to_string();
    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO companion_approval (id, session_id, kind, payload, status, human_review_id, created_at)
         VALUES (?1, ?2, 'op_execute', ?3, 'pending', NULL, datetime('now'))",
        rusqlite::params![id, DEFAULT_SESSION_ID, payload],
    )?;
    Ok(crate::companion::dispatcher::CreatedApproval {
        id,
        action: "night_shift_execute_plan".to_string(),
        params_json: params.to_string(),
        rationale: rationale.to_string(),
    })
}

fn indent(s: &str, prefix: &str) -> String {
    s.lines()
        .map(|l| format!("{prefix}{l}"))
        .collect::<Vec<_>>()
        .join("\n")
}
