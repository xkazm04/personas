//! Night-plan composition + bounding.
//!
//! One CLI call turns Athena's goals, backlog, registered projects and
//! per-project dev memories into a bounded draft plan. Everything the model
//! returns passes through [`bound_plan`] — the pure pre-check that enforces
//! the autonomy grammar's *bounded* leg: session cap, registered-project
//! allowlist, non-empty objectives, capped text. Anything outside the bounds
//! is refused BEFORE the approval card exists, never after dispatch.

use serde::{Deserialize, Serialize};

use crate::companion::brain::oneshot::{call_claude_text, extract_json_span};
use crate::companion::model_routing;
use crate::error::AppError;

/// Compose budget for the plan call. Evening, not latency-sensitive.
const PLAN_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(120);

const MAX_OBJECTIVE_CHARS: usize = 600;
const MAX_SUMMARY_CHARS: usize = 800;
const MAX_STOP_CONDITIONS: usize = 5;

/// One planned overnight session.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlanItem {
    /// Registered project name (display only; `cwd` is authoritative).
    pub project: String,
    /// Working directory — must resolve inside a registered dev project.
    pub cwd: String,
    /// What this session should accomplish tonight.
    pub objective: String,
    /// Stop conditions the worker must respect (besides the global ones).
    #[serde(default)]
    pub stop_conditions: Vec<String>,
}

/// The bounded plan persisted as `companion_night_plan.plan_json`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DraftPlan {
    pub summary: String,
    pub items: Vec<PlanItem>,
}

/// A registered project the planner may target: `(name, root_path)`.
pub type AllowedProject = (String, String);

/// Build the one-shot planning prompt from gathered context blocks.
pub fn build_prompt(
    goals_block: &str,
    backlog_block: &str,
    projects_block: &str,
    max_sessions: usize,
) -> String {
    format!(
        "You are Athena, planning tonight's unattended night shift over the user's registered \
         dev projects. Propose AT MOST {max_sessions} fleet work session(s) — fewer is better \
         than speculative work. Only propose work that is concrete, scoped to ONE repo each, \
         and safe to run unattended on a branch (no releases, no deletions, no infra changes, \
         no paid external APIs).\n\n\
         ## Active goals\n{goals}\n\n\
         ## Open backlog\n{backlog}\n\n\
         ## Registered projects (ONLY these may be targeted; use the exact `cwd` given)\n{projects}\n\n\
         Reply with ONLY a JSON object, no code fence, shaped exactly:\n\
         {{\"summary\": \"one-paragraph plan pitch for the approval card\",\n\
           \"items\": [{{\"project\": \"name\", \"cwd\": \"exact path from the list\",\n\
                        \"objective\": \"concrete deliverable for the session\",\n\
                        \"stopConditions\": [\"when to stop early\"]}}]}}\n\
         If nothing is worth doing tonight, reply {{\"summary\": \"\", \"items\": []}}.",
        max_sessions = max_sessions,
        goals = if goals_block.trim().is_empty() { "(none)" } else { goals_block },
        backlog = if backlog_block.trim().is_empty() { "(none)" } else { backlog_block },
        projects = projects_block,
    )
}

/// Run the plan call and parse the reply.
pub async fn compose_plan(
    pool: &crate::db::UserDbPool,
    prompt: &str,
) -> Result<DraftPlan, AppError> {
    let text = call_claude_text(
        pool,
        prompt,
        model_routing::ASIDE.model,
        crate::companion::brain::oneshot::leg::NIGHT_PLANNER,
        PLAN_TIMEOUT,
    )
    .await?;
    parse_plan(&text)
}

/// Tolerant parse of the model reply into a [`DraftPlan`].
pub fn parse_plan(text: &str) -> Result<DraftPlan, AppError> {
    let span = extract_json_span(text, "night plan reply")?;
    serde_json::from_str::<DraftPlan>(span)
        .map_err(|e| AppError::Internal(format!("night plan JSON did not parse: {e}")))
}

/// Normalize a path for containment comparison: forward slashes, trimmed,
/// lowercased (SQLite-registered roots on Windows are case-insensitive).
fn norm_path(p: &str) -> String {
    p.trim()
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_ascii_lowercase()
}

fn truncate_chars(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.trim().to_string()
    } else {
        let cut: String = s.chars().take(max).collect();
        format!("{}…", cut.trim())
    }
}

/// The bounded pre-check. Drops items whose `cwd` is not inside a registered
/// project root, drops empty objectives, caps the item count at
/// `max_sessions`, caps text sizes, and de-duplicates repos (one session per
/// repo per night in v1). Pure — the refusals happen here, before any card
/// or dispatch exists.
pub fn bound_plan(draft: DraftPlan, allowed: &[AllowedProject], max_sessions: usize) -> DraftPlan {
    let max_sessions = max_sessions.clamp(1, super::MAX_SESSIONS_CEILING);
    let roots: Vec<(String, String)> = allowed
        .iter()
        .map(|(name, root)| (name.clone(), norm_path(root)))
        .collect();

    let mut seen_roots: Vec<String> = Vec::new();
    let mut items: Vec<PlanItem> = Vec::new();
    for mut item in draft.items {
        if items.len() >= max_sessions {
            break;
        }
        if item.objective.trim().is_empty() || item.cwd.trim().is_empty() {
            continue;
        }
        let cwd_norm = norm_path(&item.cwd);
        let Some((name, root)) = roots
            .iter()
            .find(|(_, root)| cwd_norm == *root || cwd_norm.starts_with(&format!("{root}/")))
        else {
            continue; // outside the allowlist — refused
        };
        if seen_roots.contains(root) {
            continue; // one session per repo per night
        }
        seen_roots.push(root.clone());
        item.project = name.clone();
        item.objective = truncate_chars(&item.objective, MAX_OBJECTIVE_CHARS);
        item.stop_conditions = item
            .stop_conditions
            .into_iter()
            .filter(|s| !s.trim().is_empty())
            .take(MAX_STOP_CONDITIONS)
            .map(|s| truncate_chars(&s, 200))
            .collect();
        items.push(item);
    }
    DraftPlan {
        summary: truncate_chars(&draft.summary, MAX_SUMMARY_CHARS),
        items,
    }
}

/// The prompt handed to each dispatched fleet session. Carries the
/// branch-only invariant, the MCP protocol, and the stop conditions.
pub fn worker_prompt(item: &PlanItem, plan_id: &str, date: &str) -> String {
    let stops = if item.stop_conditions.is_empty() {
        String::from("- none beyond the global rules")
    } else {
        item.stop_conditions
            .iter()
            .map(|s| format!("- {s}"))
            .collect::<Vec<_>>()
            .join("\n")
    };
    format!(
        "You are an unattended night-shift worker (plan {plan_id}) supervised by Athena.\n\
         First call the MCP tool `athena.report_intent` with a one-line intent.\n\n\
         OBJECTIVE: {objective}\n\n\
         HARD RULES (non-negotiable):\n\
         - Work ONLY on a new branch `night/{date}-shift`. NEVER commit to the default \
           branch (main/master) and NEVER push to any remote.\n\
         - Call `athena.checkpoint` at meaningful milestones.\n\
         - If genuinely stuck, call `athena.request_guidance` (blocking) — Athena answers \
           overnight.\n\
         - For ANY destructive or cost-bearing action call `athena.request_approval` first; \
           overnight these are parked, so treat a denial as final and continue safe work.\n\
         - Run the repo's own checks/tests before finishing; leave the working tree clean \
           (everything committed on your branch).\n\
         - When the objective is done (or a stop condition hits), summarize what you did and \
           end the session.\n\n\
         STOP CONDITIONS:\n{stops}\n",
        plan_id = plan_id,
        objective = item.objective,
        date = date,
        stops = stops,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn allowed() -> Vec<AllowedProject> {
        vec![
            ("personas".into(), "C:/Users/x/dolla/personas".into()),
            ("pumper".into(), "C:\\Users\\x\\dolla\\pumper".into()),
        ]
    }

    fn item(cwd: &str, objective: &str) -> PlanItem {
        PlanItem {
            project: "whatever".into(),
            cwd: cwd.into(),
            objective: objective.into(),
            stop_conditions: vec![],
        }
    }

    #[test]
    fn bound_caps_session_count() {
        let draft = DraftPlan {
            summary: "s".into(),
            items: vec![
                item("C:/Users/x/dolla/personas", "a"),
                item("C:/Users/x/dolla/pumper", "b"),
            ],
        };
        let out = bound_plan(draft, &allowed(), 1);
        assert_eq!(out.items.len(), 1);
    }

    #[test]
    fn bound_drops_unregistered_cwd() {
        let draft = DraftPlan {
            summary: "s".into(),
            items: vec![
                item("C:/Windows/System32", "evil"),
                item("C:/Users/x/dolla/personas/src", "fine — subdir of a root"),
            ],
        };
        let out = bound_plan(draft, &allowed(), 4);
        assert_eq!(out.items.len(), 1);
        assert_eq!(out.items[0].project, "personas");
    }

    #[test]
    fn bound_rejects_prefix_sibling_directory() {
        // `personas-evil` shares the string prefix but is NOT inside the root.
        let draft = DraftPlan {
            summary: "s".into(),
            items: vec![item("C:/Users/x/dolla/personas-evil", "nope")],
        };
        let out = bound_plan(draft, &allowed(), 4);
        assert!(out.items.is_empty());
    }

    #[test]
    fn bound_drops_empty_objective_and_dedupes_repo() {
        let draft = DraftPlan {
            summary: "s".into(),
            items: vec![
                item("C:/Users/x/dolla/personas", "   "),
                item("C:/Users/x/dolla/pumper", "one"),
                item(
                    "C:/USERS/X/DOLLA/PUMPER",
                    "duplicate repo, case-insensitive",
                ),
            ],
        };
        let out = bound_plan(draft, &allowed(), 4);
        assert_eq!(out.items.len(), 1);
        assert_eq!(out.items[0].objective, "one");
    }

    #[test]
    fn bound_normalizes_backslash_roots() {
        let draft = DraftPlan {
            summary: "s".into(),
            items: vec![item(
                "C:\\Users\\x\\dolla\\pumper\\crates",
                "backslashes ok",
            )],
        };
        let out = bound_plan(draft, &allowed(), 4);
        assert_eq!(out.items.len(), 1);
        assert_eq!(out.items[0].project, "pumper");
    }

    #[test]
    fn bound_truncates_oversized_text() {
        let long = "x".repeat(2000);
        let draft = DraftPlan {
            summary: long.clone(),
            items: vec![PlanItem {
                project: "p".into(),
                cwd: "C:/Users/x/dolla/personas".into(),
                objective: long.clone(),
                stop_conditions: (0..10).map(|i| format!("s{i}")).collect(),
            }],
        };
        let out = bound_plan(draft, &allowed(), 4);
        assert!(out.summary.chars().count() <= MAX_SUMMARY_CHARS + 1);
        assert!(out.items[0].objective.chars().count() <= MAX_OBJECTIVE_CHARS + 1);
        assert_eq!(out.items[0].stop_conditions.len(), MAX_STOP_CONDITIONS);
    }

    #[test]
    fn parse_plan_tolerates_prose_wrapping() {
        let text = "Here you go:\n{\"summary\":\"plan\",\"items\":[{\"project\":\"p\",\
                    \"cwd\":\"C:/x\",\"objective\":\"do\",\"stopConditions\":[\"tests fail twice\"]}]}\nthanks";
        let plan = parse_plan(text).unwrap();
        assert_eq!(plan.items.len(), 1);
        assert_eq!(plan.items[0].stop_conditions.len(), 1);
    }

    #[test]
    fn worker_prompt_carries_branch_only_invariant() {
        let p = worker_prompt(&item("C:/x", "ship the thing"), "nplan_1", "2026-07-30");
        assert!(p.contains("NEVER commit to the default"));
        assert!(p.contains("NEVER push"));
        assert!(p.contains("night/2026-07-30-shift"));
        assert!(p.contains("athena.request_approval"));
    }
}
