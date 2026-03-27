//! Token estimation and cost projection for execution preview.
//!
//! Provides approximate token counts and cost estimates before running an
//! execution, enabling budget checks and user-facing cost previews.

use serde::Serialize;
use ts_rs::TS;

/// Approximate tokens per character for English text (GPT/Claude tokenizers).
/// Actual ratios vary by language and content; this is a conservative estimate.
const CHARS_PER_TOKEN: f64 = 3.8;

/// Cost per 1M input tokens by model family (USD).
/// These are approximate list prices — actual pricing may vary by contract.
fn input_cost_per_million(model: &str) -> f64 {
    let lower = model.to_lowercase();
    if lower.contains("opus") { 15.0 }
    else if lower.contains("sonnet") { 3.0 }
    else if lower.contains("haiku") { 0.25 }
    else if lower.contains("gpt-4o") { 2.5 }
    else if lower.contains("gpt-4") { 30.0 }
    else if lower.contains("gpt-3.5") { 0.5 }
    else if lower.contains("gemini-pro") { 1.25 }
    else if lower.contains("gemini") { 0.075 }
    else { 3.0 } // Default to Sonnet-class pricing
}

/// Cost per 1M output tokens by model family (USD).
fn output_cost_per_million(model: &str) -> f64 {
    let lower = model.to_lowercase();
    if lower.contains("opus") { 75.0 }
    else if lower.contains("sonnet") { 15.0 }
    else if lower.contains("haiku") { 1.25 }
    else if lower.contains("gpt-4o") { 10.0 }
    else if lower.contains("gpt-4") { 60.0 }
    else if lower.contains("gpt-3.5") { 1.5 }
    else if lower.contains("gemini-pro") { 5.0 }
    else if lower.contains("gemini") { 0.30 }
    else { 15.0 } // Default to Sonnet-class pricing
}

/// Estimate token count from character count.
pub fn estimate_tokens(text: &str) -> u64 {
    (text.len() as f64 / CHARS_PER_TOKEN).ceil() as u64
}

/// Estimate input cost for a given token count and model.
pub fn estimate_input_cost(tokens: u64, model: &str) -> f64 {
    tokens as f64 * input_cost_per_million(model) / 1_000_000.0
}

/// Estimate output cost for a projected output token count and model.
pub fn estimate_output_cost(tokens: u64, model: &str) -> f64 {
    tokens as f64 * output_cost_per_million(model) / 1_000_000.0
}

/// Result of a pre-flight execution preview.
#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct ExecutionPreview {
    /// Assembled prompt text (for inspection).
    pub prompt_preview: String,
    /// Approximate input token count.
    pub estimated_input_tokens: u64,
    /// Projected output tokens (based on typical response ratio).
    pub estimated_output_tokens: u64,
    /// Estimated input cost (USD).
    pub estimated_input_cost: f64,
    /// Estimated output cost (USD).
    pub estimated_output_cost: f64,
    /// Estimated total cost (USD).
    pub estimated_total_cost: f64,
    /// Model that would be used.
    pub model: String,
    /// Number of memories that would be injected.
    pub memory_count: u32,
    /// Number of tools available.
    pub tool_count: u32,
    /// Current monthly spend for this persona (USD).
    pub monthly_spend: f64,
    /// Monthly budget limit (USD, 0 = unlimited).
    pub budget_limit: f64,
}

/// Build an execution preview without running the execution.
pub fn build_preview(
    prompt_text: &str,
    model: &str,
    memory_count: u32,
    tool_count: u32,
    monthly_spend: f64,
    budget_limit: f64,
) -> ExecutionPreview {
    let input_tokens = estimate_tokens(prompt_text);
    // Estimate output tokens as ~40% of input (typical for task-oriented agents)
    let output_tokens = (input_tokens as f64 * 0.4).ceil() as u64;

    let input_cost = estimate_input_cost(input_tokens, model);
    let output_cost = estimate_output_cost(output_tokens, model);

    ExecutionPreview {
        prompt_preview: if prompt_text.len() > 5000 {
            format!("{}...\n\n[{} characters total]", &prompt_text[..5000], prompt_text.len())
        } else {
            prompt_text.to_string()
        },
        estimated_input_tokens: input_tokens,
        estimated_output_tokens: output_tokens,
        estimated_input_cost: input_cost,
        estimated_output_cost: output_cost,
        estimated_total_cost: input_cost + output_cost,
        model: model.to_string(),
        memory_count,
        tool_count,
        monthly_spend,
        budget_limit,
    }
}
