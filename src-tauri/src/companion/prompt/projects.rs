//! Project-level direction: the dev projects' goals, their KPIs, and today's
//! project-tracking pulses.
//!
//! Moved verbatim out of the former single-file `prompt.rs`.

use super::memory::first_paragraph;
use crate::db::{DbPool, UserDbPool};

/// is aware of project-level direction and can reference a goal by id when she
/// proposes an `update_dev_goal`. Reads the main app DB (sys_db). Ungated so it
/// runs in both ml and non-ml prompt builds. Capped to keep the prompt lean.
pub(super) fn format_project_goals(sys_db: &DbPool) -> String {
    use crate::db::repos::dev_tools as dt;
    let projects = match dt::list_projects(sys_db, None) {
        Ok(p) => p,
        Err(_) => return String::new(),
    };
    let mut body = String::new();
    let mut shown = 0usize;
    for proj in &projects {
        if shown >= 12 {
            break;
        }
        let goals = dt::list_goals_by_project(sys_db, &proj.id, None).unwrap_or_default();
        let active: Vec<_> = goals
            .iter()
            .filter(|g| g.status != "done" && g.status != "completed")
            .collect();
        if active.is_empty() {
            continue;
        }
        body.push_str(&format!("\n**{}**\n", proj.name.trim()));
        for g in active.iter().take(6) {
            if shown >= 12 {
                break;
            }
            let latest = dt::list_goal_signals(sys_db, &g.id, Some(1))
                .ok()
                .and_then(|v| v.into_iter().next())
                .map(|s| {
                    let m = s.message.unwrap_or(s.signal_type);
                    format!(" · latest: {}", first_paragraph(&m, 80))
                })
                .unwrap_or_default();
            body.push_str(&format!(
                "- {title} (id {id}) — {prog}% [{status}]{latest}\n",
                title = g.title.trim(),
                id = g.id,
                prog = g.progress,
                status = g.status,
                latest = latest,
            ));
            shown += 1;
        }
    }
    if body.is_empty() {
        return String::new();
    }
    format!(
        "\n\n# Project goals (dev direction + progress)\n\nProject-level goals you can track. To propose a change, use `update_dev_goal` with the goal's id.{body}"
    )
}

/// KPI layer: inject each dev project's ACTIVE KPIs (the outcome layer above
/// goals) so Athena can reference one by id and propose `calibrate_kpi` /
/// `evaluate_kpi` / `scan_kpis`. Reads the main app DB (sys_db). Off-track
/// status uses the SAME rule the derivation loop obeys
/// (`kpi_derivation::kpi_is_off_track`), so what Athena sees as "OFF TRACK" is
/// exactly what will derive a goal. Capped to keep the prompt lean.
pub(super) fn format_project_kpis(sys_db: &DbPool) -> String {
    use crate::db::repos::dev_tools as dt;
    use crate::engine::kpi_derivation::kpi_is_off_track;
    let projects = match dt::list_projects(sys_db, None) {
        Ok(p) => p,
        Err(_) => return String::new(),
    };
    let mut body = String::new();
    let mut shown = 0usize;
    for proj in &projects {
        if shown >= 12 {
            break;
        }
        let kpis = dt::list_kpis(sys_db, &proj.id, Some("active")).unwrap_or_default();
        if kpis.is_empty() {
            continue;
        }
        body.push_str(&format!("\n**{}**\n", proj.name.trim()));
        for k in kpis.iter().take(6) {
            if shown >= 12 {
                break;
            }
            let cur = k
                .current_value
                .map(|v| v.to_string())
                .unwrap_or_else(|| "—".into());
            let tgt = k
                .target_value
                .map(|v| v.to_string())
                .unwrap_or_else(|| "—".into());
            let state_label = if k.current_value.is_none() {
                "unmeasured"
            } else if kpi_is_off_track(k) {
                "OFF TRACK"
            } else {
                "on track"
            };
            body.push_str(&format!(
                "- {name} (id {id}) — {cur}/{tgt} {unit} · {tier} · {state}\n",
                name = k.name.trim(),
                id = k.id,
                cur = cur,
                tgt = tgt,
                unit = k.unit,
                tier = k.tier,
                state = state_label,
            ));
            shown += 1;
        }
    }
    if body.is_empty() {
        return String::new();
    }
    format!(
        "\n\n# Project KPIs (the outcome layer above goals)\n\nMeasurable success metrics per project. To steer an existing one, propose `calibrate_kpi` (adjust its target / due date / tier / cadence / status, or draw the warn + critical lines) or `evaluate_kpi` (measure it now). To add KPIs: `scan_kpis` proposes a batch from the context map; `propose_kpi` configures ONE specific KPI the user describes.\n\nWhen the user asks to set up / configure / add a KPI, GUIDE them: ask what they want to measure, whether higher or lower is better, a rough target, how often, and whether it's measured by hand or automatically (a repo command / a vault connector / an orchestrator metric). Then emit `propose_kpi` with what you gathered and tell them to verify it in Teams › KPIs — it lands as a proposal (the codebase measurement sets itself up in the background). A KPI going OFF TRACK is what derives goals for the team — managing KPIs is how you steer development by outcomes, not activity.{body}"
    )
}

// ─────────────────────────────────────────────────────────────────────────
// Fleet index blocks — the bounded "what exists, by id" layer
//
// Athena's ops take UUIDs (`run_persona`, `run_arena`,
// `companion_breed_personas`, `companion_evolve_persona`, `assign_team`)
// but until these blocks existed the only persona signal in the prompt was
// a names-only list in the observability digest, so she invented ids. The
// three blocks below give her a *bounded index* (name + id + one line) and
// the four `describe_*` / `list_teams` read ops give her detail on demand.
//
// Budget: the three blocks TOGETHER are capped at ~1200 tokens. The cap is
// enforced in characters (4 chars ≈ 1 token, the same rough ratio
// `recall_synthesis::estimate_recall_tokens` uses) and every block reports
// its true total, so a truncated list never reads as a complete one.
// ─────────────────────────────────────────────────────────────────────────

/// Render today's project_tracking pulses as a Markdown block. Returns
/// empty when:
/// - `dev_tools` plugin is not in the enabled set (the user hasn't
///   asked Athena to lead lifecycle), OR
/// - no enabled subscriptions have a pulse for today.
///
/// Each project gets: name + narrative paragraph + 3-5 directions +
/// 0-3 tensions. Per the locked design decision (Phase 5 token budget),
/// soft cap at 5 projects — beyond that, summarize the tail to one
/// line each.
pub(super) fn format_project_tracking_pulses(
    user_db: &UserDbPool,
    plugin_names: &[String],
) -> String {
    if !plugin_names.iter().any(|n| n == "dev_tools") {
        return String::new();
    }

    let subs = match crate::engine::project_tracking::subscription::list_enabled(user_db) {
        Ok(s) => s,
        Err(e) => {
            tracing::warn!(error = %e, "project_tracking: list_enabled failed for prompt");
            return String::new();
        }
    };
    if subs.is_empty() {
        return String::new();
    }

    let mut blocks: Vec<(String, crate::engine::project_tracking::pulse::PulseRow)> = Vec::new();
    for sub in &subs {
        match crate::engine::project_tracking::pulse::load_today(user_db, &sub.project_id) {
            Ok(Some(pulse_row)) => {
                let project_name = sub
                    .project_path
                    .rsplit(['/', '\\'])
                    .next()
                    .unwrap_or(&sub.project_path)
                    .to_string();
                blocks.push((project_name, pulse_row));
            }
            Ok(None) => {} // no pulse for today yet
            Err(e) => {
                tracing::warn!(
                    project_id = %sub.project_id,
                    error = %e,
                    "project_tracking: pulse load failed for prompt",
                );
            }
        }
    }

    if blocks.is_empty() {
        return String::new();
    }

    let mut out = String::new();
    let cap = 5usize;
    for (project_name, pulse_row) in blocks.iter().take(cap) {
        out.push_str(
            &crate::engine::project_tracking::consolidator::render_for_prompt(
                pulse_row,
                project_name,
            ),
        );
        out.push('\n');
    }
    if blocks.len() > cap {
        out.push_str(&format!(
            "_…and {} more tracked project(s) — ask for them by name._\n\n",
            blocks.len() - cap
        ));
    }
    out
}
