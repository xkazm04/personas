//! Knowledge extraction from completed executions.
//!
//! After each execution completes (success or failure), this module extracts
//! structured intelligence and upserts it into the `execution_knowledge` table.
//! Over time, this creates a knowledge graph that makes future executions smarter.

use serde::Deserialize;
use tracing::warn;

use crate::db::repos::execution::knowledge as knowledge_repo;
use crate::db::DbPool;

/// Tool call step parsed from the execution's tool_steps JSON.
#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct ToolCallStep {
    #[serde(default)]
    tool_name: String,
    #[serde(default)]
    status: String,
}

/// Bundles the common parameters threaded through all knowledge extraction functions.
pub struct ExecutionContext<'a> {
    pub pool: &'a DbPool,
    pub execution_id: &'a str,
    pub persona_id: &'a str,
    pub use_case_id: Option<&'a str>,
    pub success: bool,
    pub cost_usd: f64,
    pub duration_ms: f64,
}

/// Extract knowledge from a completed execution and persist it.
pub fn extract_and_persist(
    pool: &DbPool,
    execution_id: &str,
    persona_id: &str,
    use_case_id: Option<&str>,
    success: bool,
    cost_usd: f64,
    duration_ms: i64,
    model_used: Option<&str>,
    tool_steps_json: Option<&str>,
    error_message: Option<&str>,
) {
    let ctx = ExecutionContext {
        pool,
        execution_id,
        persona_id,
        use_case_id,
        success,
        cost_usd,
        duration_ms: duration_ms as f64,
    };

    // 1. Extract tool sequence pattern
    if let Some(steps_json) = tool_steps_json {
        extract_tool_sequence(&ctx, steps_json);
    }

    // 2. Extract failure pattern
    if !success {
        if let Some(err) = error_message {
            extract_failure_pattern(&ctx, err);
        }
    }

    // 3. Extract model performance
    if let Some(model) = model_used {
        extract_model_performance(&ctx, model);
    }

    // 4. Extract cost-quality tradeoff
    extract_cost_quality(&ctx);
}

/// Extract the tool sequence used in an execution.
/// Pattern key: sorted tool names joined by " -> ".
fn extract_tool_sequence(ctx: &ExecutionContext<'_>, steps_json: &str) {
    let steps: Vec<ToolCallStep> = match serde_json::from_str(steps_json) {
        Ok(s) => s,
        Err(e) => {
            warn!(
                execution_id = ctx.execution_id,
                error = %e,
                "Failed to parse tool sequence steps JSON during knowledge extraction"
            );
            return;
        }
    };

    if steps.is_empty() {
        return;
    }

    let tool_names: Vec<&str> = steps.iter().map(|s| s.tool_name.as_str()).collect();
    let pattern_key = tool_names.join(" -> ");

    let pattern_data = serde_json::json!({
        "tools": tool_names,
        "step_count": steps.len(),
    })
    .to_string();

    if let Err(e) = knowledge_repo::upsert(
        ctx.pool,
        ctx.persona_id,
        ctx.use_case_id,
        "tool_sequence",
        &pattern_key,
        &pattern_data,
        ctx.success,
        ctx.cost_usd,
        ctx.duration_ms,
        ctx.execution_id,
    ) {
        tracing::warn!("Failed to persist tool_sequence knowledge: {}", e);
    }
}

/// Extract a failure pattern from the error message.
/// Groups errors by their normalized prefix (first 100 chars, stripped of IDs).
fn extract_failure_pattern(ctx: &ExecutionContext<'_>, error_message: &str) {
    // Normalize error: take first 100 chars, strip UUIDs and numbers
    let normalized = error_message
        .chars()
        .take(100)
        .collect::<String>();
    let pattern_key = normalize_error_pattern(&normalized);

    let pattern_data = serde_json::json!({
        "sample_error": error_message.chars().take(500).collect::<String>(),
    })
    .to_string();

    if let Err(e) = knowledge_repo::upsert(
        ctx.pool,
        ctx.persona_id,
        ctx.use_case_id,
        "failure_pattern",
        &pattern_key,
        &pattern_data,
        false,
        ctx.cost_usd,
        ctx.duration_ms,
        ctx.execution_id,
    ) {
        tracing::warn!("Failed to persist failure_pattern knowledge: {}", e);
    }
}

/// Extract model performance data.
fn extract_model_performance(ctx: &ExecutionContext<'_>, model: &str) {
    let pattern_data = serde_json::json!({
        "model": model,
    })
    .to_string();

    if let Err(e) = knowledge_repo::upsert(
        ctx.pool,
        ctx.persona_id,
        ctx.use_case_id,
        "model_performance",
        model,
        &pattern_data,
        ctx.success,
        ctx.cost_usd,
        ctx.duration_ms,
        ctx.execution_id,
    ) {
        tracing::warn!("Failed to persist model_performance knowledge: {}", e);
    }
}

/// Extract cost-quality tradeoff data (overall persona performance).
fn extract_cost_quality(ctx: &ExecutionContext<'_>) {
    let key = if let Some(uc) = ctx.use_case_id {
        format!("use_case:{uc}")
    } else {
        "overall".to_string()
    };

    let pattern_data = serde_json::json!({
        "scope": if ctx.use_case_id.is_some() { "use_case" } else { "persona" },
    })
    .to_string();

    if let Err(e) = knowledge_repo::upsert(
        ctx.pool,
        ctx.persona_id,
        ctx.use_case_id,
        "cost_quality",
        &key,
        &pattern_data,
        ctx.success,
        ctx.cost_usd,
        ctx.duration_ms,
        ctx.execution_id,
    ) {
        tracing::warn!("Failed to persist cost_quality knowledge: {}", e);
    }
}

/// Normalize an error message into a pattern key by stripping UUIDs, hex, and numbers.
fn normalize_error_pattern(error: &str) -> String {
    let mut result = String::with_capacity(error.len());
    let mut chars = error.chars().peekable();
    while let Some(c) = chars.next() {
        if c.is_ascii_digit() {
            // Skip consecutive digits
            while chars.peek().is_some_and(|ch| ch.is_ascii_digit() || *ch == '-') {
                chars.next();
            }
            result.push('#');
        } else {
            result.push(c);
        }
    }
    result.truncate(80);
    result
}
