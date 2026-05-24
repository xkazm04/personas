//! Goal-to-Plan — LLM planner brain (idea-ba306c32, Stage 2 backend).
//!
//! Maps a natural-language goal to an ordered plan whose steps draw from the
//! frontend action catalog vocabulary. Mirrors the proven
//! `decompose_team_assignment_goal` flow: one Sonnet call via the Claude CLI
//! (subscription — no API key), JSON parsed from stdout, no DB writes.
//!
//! The frontend's `llmPlanProvider` calls this behind the PlanProvider seam
//! and falls back to its deterministic rule planner if this errors or the CLI
//! is unavailable, so the planner surface keeps working regardless.

use std::sync::Arc;
use std::collections::HashMap;
use tauri::State;

use crate::error::AppError;
use crate::ipc_auth::require_auth;
use crate::AppState;

/// One planned step proposed by the model. `action_id` must be one of
/// `ALLOWED_ACTIONS`; unknown actions are dropped before returning.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct LlmPlanStep {
    pub action_id: String,
    #[serde(default)]
    pub params: HashMap<String, String>,
    #[serde(default = "default_confidence")]
    pub confidence: f64,
}

fn default_confidence() -> f64 {
    0.7
}

/// Wire-format result for `plan_goal_llm`.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct LlmPlanResult {
    pub steps: Vec<LlmPlanStep>,
}

#[derive(Debug, serde::Deserialize)]
struct RawPlanResponse {
    steps: Vec<LlmPlanStep>,
}

/// The action vocabulary — kept in lockstep with the frontend `PlanActionId`
/// union (`src/features/agents/sub_planner/types.ts`).
const ALLOWED_ACTIONS: &[&str] = &[
    "understand_goal",
    "create_persona",
    "connect_service",
    "configure_trigger",
    "configure_schedule",
    "fetch_web",
    "detect_changes",
    "send_notification",
    "review_confirm",
];

const PLAN_TIMEOUT_SECS: u64 = 45;

/// Build the one-shot prompt. Constrains the model to the action catalog and
/// the per-action params the frontend knows how to render.
pub fn build_plan_prompt(goal: &str) -> String {
    format!(
        r#"You map a user's natural-language automation goal into an ordered, reviewable
plan of in-app actions. This is a READ-ONLY preview — nothing will be executed.

## Goal
{goal}

## Allowed actions (use only these actionId values)
- understand_goal     params: {{"goal": "<short goal summary>"}}
- create_persona      params: {{"goal": "<short goal summary>"}}
- connect_service     params: {{"service": "<brand name, e.g. Slack, Email, Notion>"}}
- send_notification   params: {{"service": "<brand name>"}}
- configure_trigger   params: {{"event": "<what arrives that should start it>"}}
- configure_schedule  params: {{"cadence": "<e.g. daily, every morning, weekly>"}}
- fetch_web           params: {{}}
- detect_changes      params: {{}}
- review_confirm      params: {{}}

## Response
Respond with ONLY a JSON object on a single line, no markdown:
{{"steps": [
  {{"actionId": "<one allowed actionId>", "params": {{...}}, "confidence": <0.0-1.0>}}
]}}

Rules:
- Start with understand_goal and create_persona. End with review_confirm.
- Add connect_service + send_notification for each delivery channel named.
- Use configure_schedule for recurring cadences, configure_trigger for event-driven starts.
- Use fetch_web (+ detect_changes) only when the goal monitors a web page.
- Set confidence high for steps you're sure about, lower for inferred ones.
- Aim for 3-8 steps."#
    )
}

/// Generate a plan from a goal via one Sonnet call. Returns the validated
/// step list; the frontend maps it onto its `Plan` shape.
#[tauri::command]
pub async fn plan_goal_llm(
    state: State<'_, Arc<AppState>>,
    goal: String,
) -> Result<LlmPlanResult, AppError> {
    require_auth(&state).await?;
    let goal = goal.trim();
    if goal.is_empty() {
        return Err(AppError::Validation("Goal cannot be empty".into()));
    }

    use crate::engine::cli_process::CliProcessDriver;
    use crate::engine::parser;
    use crate::engine::prompt;
    use crate::engine::types::StreamLineType;

    let prompt_text = build_plan_prompt(goal);
    let mut cli_args = prompt::build_cli_args(None, None);
    cli_args.args.push("--max-turns".to_string());
    cli_args.args.push("1".to_string());

    let mut driver = CliProcessDriver::spawn_temp_no_stderr(&cli_args, "personas-goal-plan")
        .map_err(|e| AppError::Internal(format!("Failed to spawn planner: {e}")))?;
    driver.write_stdin(prompt_text.as_bytes()).await;
    let _ = driver.close_stdin().await;

    let mut assistant_text = String::new();
    let timeout = tokio::time::Duration::from_secs(PLAN_TIMEOUT_SECS);
    driver
        .collect_lines_with_timeout(timeout, |line| {
            let (line_type, _) = parser::parse_stream_line(line);
            if let StreamLineType::AssistantText { text } = line_type {
                assistant_text.push_str(&text);
                assistant_text.push('\n');
            }
        })
        .await
        .map_err(|e| AppError::Internal(format!("Planner timeout/failure: {e}")))?;
    let _ = driver.finish().await;

    let trimmed = assistant_text.trim();
    let parsed: RawPlanResponse = if let Ok(p) = serde_json::from_str::<RawPlanResponse>(trimmed) {
        p
    } else if let (Some(start), Some(end)) = (trimmed.find('{'), trimmed.rfind('}')) {
        serde_json::from_str(&trimmed[start..=end])
            .map_err(|e| AppError::Internal(format!("Planner JSON parse error: {e}")))?
    } else {
        return Err(AppError::Internal(format!(
            "Planner returned unparseable response: {}",
            &trimmed[..trimmed.len().min(300)]
        )));
    };

    // Keep only known actions; clamp confidence into [0, 1].
    let steps: Vec<LlmPlanStep> = parsed
        .steps
        .into_iter()
        .filter(|s| ALLOWED_ACTIONS.contains(&s.action_id.as_str()))
        .map(|mut s| {
            s.confidence = s.confidence.clamp(0.0, 1.0);
            s
        })
        .collect();

    if steps.is_empty() {
        return Err(AppError::Internal(
            "Planner returned no usable steps — refine the goal".into(),
        ));
    }

    Ok(LlmPlanResult { steps })
}
