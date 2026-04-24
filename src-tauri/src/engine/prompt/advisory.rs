//! Advisory-mode prompt. Activated when `input_data._advisory` / `_ops` is true.

use crate::db::models::{Persona, PersonaToolDefinition};

use super::variables::replace_variables;

// ═══════════════════════════════════════════════════════════════════════════════
// Advisory Assistant
// ═══════════════════════════════════════════════════════════════════════════════

/// Build the full prompt for Advisory Assistant mode.
/// Replaces the persona's identity with a business-oriented consultant that
/// uses diagnostic data to help users improve their agent's real-world performance.
pub(super) fn build_advisory_prompt(
    persona: &Persona,
    tools: &[PersonaToolDefinition],
    input_data: Option<&serde_json::Value>,
) -> String {
    let mut p = String::new();

    p.push_str(ADVISORY_ASSISTANT_PROMPT);

    // ── Agent Profile ───────────────────────────────────────────────────
    p.push_str("## Agent Profile\n\n");
    p.push_str(&format!("**Name**: {}\n", persona.name));
    if let Some(ref desc) = persona.description {
        if !desc.is_empty() {
            p.push_str(&format!("**Purpose**: {}\n", desc));
        }
    }
    p.push_str(&format!("**Active**: {}\n", persona.enabled));
    p.push_str(&format!("**ID**: `{}`\n\n", persona.id));

    // Full structured prompt — the advisory LLM needs to see the actual content
    // to give meaningful improvement advice, not just previews
    if let Some(ref sp_json) = persona.structured_prompt {
        if let Ok(sp) = serde_json::from_str::<serde_json::Value>(sp_json) {
            p.push_str("### Current Prompt Configuration\n");
            for section in &["identity", "instructions", "toolGuidance", "examples", "errorHandling", "customSections"] {
                if let Some(val) = sp.get(section).and_then(|v| v.as_str()) {
                    // Show full content for identity and instructions (most impactful),
                    // truncate others at 500 chars
                    let is_key_section = *section == "identity" || *section == "instructions";
                    let max_len = if is_key_section { 2000 } else { 500 };
                    let display = if val.len() > max_len {
                        format!("{}... ({} chars total)", &val[..max_len], val.len())
                    } else {
                        val.to_string()
                    };
                    p.push_str(&format!("\n**{}** ({} chars):\n{}\n", section, val.len(), display));
                }
            }
            p.push('\n');
        }
    } else if !persona.system_prompt.is_empty() {
        let max_len = 2000;
        let display = if persona.system_prompt.len() > max_len {
            format!("{}... ({} total)", &persona.system_prompt[..max_len], persona.system_prompt.len())
        } else {
            persona.system_prompt.clone()
        };
        p.push_str(&format!("### System Prompt ({} chars)\n{}\n\n", persona.system_prompt.len(), display));
    }

    // Tools — the advisory LLM needs to know what capabilities the agent has
    if !tools.is_empty() {
        p.push_str("### Available Tools\n");
        for tool in tools {
            p.push_str(&format!("- **{}** ({}): {}\n", tool.name, tool.category, tool.description));
        }
        p.push('\n');
    } else {
        p.push_str("### Available Tools\nNo tools assigned.\n\n");
    }

    // Model profile
    if let Some(ref profile_json) = persona.model_profile {
        if let Ok(profile) = serde_json::from_str::<serde_json::Value>(profile_json) {
            if let Some(model) = profile.get("model").and_then(|v| v.as_str()) {
                p.push_str(&format!("### Model: {}\n\n", model));
            }
        }
    }

    // Budget/limits
    if let Some(budget) = persona.max_budget_usd {
        p.push_str(&format!("### Budget Limit: ${:.2}/execution\n\n", budget));
    }
    if let Some(turns) = persona.max_turns {
        p.push_str(&format!("### Max Turns: {}\n\n", turns));
    }

    // Use cases from design_context — critical for understanding business intent
    if let Some(ref dc_json) = persona.design_context {
        if let Ok(dc) = serde_json::from_str::<serde_json::Value>(dc_json) {
            if let Some(use_cases) = dc.get("use_cases").and_then(|v| v.as_array()) {
                if !use_cases.is_empty() {
                    p.push_str("### Use Cases (Business Intent)\n");
                    for uc in use_cases {
                        let title = uc.get("title").and_then(|v| v.as_str()).unwrap_or("Untitled");
                        let desc = uc.get("description").and_then(|v| v.as_str()).unwrap_or("");
                        let cat = uc.get("category").and_then(|v| v.as_str()).unwrap_or("");
                        p.push_str(&format!("- **{}**{}: {}\n", title,
                            if cat.is_empty() { String::new() } else { format!(" [{}]", cat) },
                            desc));
                    }
                    p.push('\n');
                }
            }
        }
    }

    // ── Diagnostic Context (injected by command handler) ──────────────
    if let Some(ctx) = input_data.and_then(|d| d.get("_advisory_context")) {
        p.push_str("## Diagnostic Data (Live from Database)\n\n");

        // Execution metrics
        if let Some(metrics) = ctx.get("execution_metrics") {
            p.push_str("### Execution Performance (Last 30 Days)\n");
            let total = metrics.get("total").and_then(|v| v.as_i64()).unwrap_or(0);
            let success = metrics.get("successful").and_then(|v| v.as_i64()).unwrap_or(0);
            let failed = metrics.get("failed").and_then(|v| v.as_i64()).unwrap_or(0);
            let rate = metrics.get("success_rate_pct").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let cost = metrics.get("total_cost_usd").and_then(|v| v.as_f64()).unwrap_or(0.0);
            p.push_str(&format!(
                "- Total: {} | Success: {} | Failed: {} | Success rate: {:.0}%\n- Total cost: ${:.4}\n\n",
                total, success, failed, rate, cost
            ));
        }

        // Consecutive failure streak
        if let Some(streak) = ctx.get("consecutive_failures").and_then(|v| v.as_u64()) {
            if streak > 0 {
                p.push_str(&format!("**WARNING: {} consecutive failures** — the agent is currently in a failure state.\n\n", streak));
            }
        }

        // Recent executions
        if let Some(recent) = ctx.get("recent_executions").and_then(|v| v.as_array()) {
            if !recent.is_empty() {
                p.push_str("### Recent Executions\n");
                for exec in recent.iter().take(10) {
                    let status = exec.get("status").and_then(|v| v.as_str()).unwrap_or("?");
                    let started = exec.get("started_at").and_then(|v| v.as_str()).unwrap_or("?");
                    let dur = exec.get("duration_ms").and_then(|v| v.as_f64())
                        .map(|d| format!("{:.1}s", d / 1000.0))
                        .unwrap_or_else(|| "-".into());
                    let cost = exec.get("cost_usd").and_then(|v| v.as_f64())
                        .map(|c| format!("${:.4}", c))
                        .unwrap_or_else(|| "-".into());
                    p.push_str(&format!("- {} | {} | {} | {}", status, dur, cost, started));
                    if let Some(err) = exec.get("error").and_then(|v| v.as_str()) {
                        p.push_str(&format!(" | Error: {}", err));
                    }
                    p.push('\n');
                }
                p.push('\n');
            }
        }

        // Knowledge graph
        if let Some(kg) = ctx.get("knowledge_graph") {
            let total = kg.get("total_entries").and_then(|v| v.as_i64()).unwrap_or(0);
            if total > 0 {
                p.push_str("### Knowledge Graph\n");
                let fp = kg.get("failure_patterns").and_then(|v| v.as_i64()).unwrap_or(0);
                let ts = kg.get("tool_sequences").and_then(|v| v.as_i64()).unwrap_or(0);
                p.push_str(&format!(
                    "- {} entries: {} tool sequences, {} failure patterns\n",
                    total, ts, fp
                ));
                if let Some(patterns) = kg.get("top_patterns").and_then(|v| v.as_array()) {
                    for pat in patterns {
                        let key = pat.get("key").and_then(|v| v.as_str()).unwrap_or("?");
                        let conf = pat.get("confidence").and_then(|v| v.as_f64()).unwrap_or(0.0);
                        let ptype = pat.get("type").and_then(|v| v.as_str()).unwrap_or("?");
                        p.push_str(&format!("  - [{}] {} (confidence: {:.0}%)\n", ptype, key, conf * 100.0));
                    }
                }
                p.push('\n');
            }
        }

        // Assertions
        if let Some(assertions) = ctx.get("assertions").and_then(|v| v.as_array()) {
            if !assertions.is_empty() {
                p.push_str("### Output Assertions\n");
                for a in assertions {
                    let name = a.get("name").and_then(|v| v.as_str()).unwrap_or("?");
                    let severity = a.get("severity").and_then(|v| v.as_str()).unwrap_or("?");
                    let pass_rate = a.get("pass_rate_pct").and_then(|v| v.as_f64()).unwrap_or(0.0);
                    let fail_count = a.get("fail_count").and_then(|v| v.as_i64()).unwrap_or(0);
                    let enabled = a.get("enabled").and_then(|v| v.as_bool()).unwrap_or(true);
                    let status = if !enabled { "OFF" } else if fail_count == 0 { "PASS" } else { "FAIL" };
                    p.push_str(&format!(
                        "- [{}] {} ({}) — {:.0}% pass rate\n",
                        status, name, severity, pass_rate
                    ));
                }
                p.push('\n');
            }
        }

        // Memory state
        if let Some(mem) = ctx.get("memory_state") {
            let total = mem.get("total").and_then(|v| v.as_i64()).unwrap_or(0);
            if total > 0 {
                let core = mem.get("core").and_then(|v| v.as_i64()).unwrap_or(0);
                let active = mem.get("active").and_then(|v| v.as_i64()).unwrap_or(0);
                p.push_str(&format!(
                    "### Agent Memory\n- {} memories: {} core, {} active\n",
                    total, core, active
                ));
                if let Some(cats) = mem.get("by_category").and_then(|v| v.as_object()) {
                    let cat_str: Vec<String> = cats.iter()
                        .map(|(k, v)| format!("{}={}", k, v))
                        .collect();
                    p.push_str(&format!("- Categories: {}\n", cat_str.join(", ")));
                }
                p.push('\n');
            }
        }
    }

    // ── Conversation Input ──────────────────────────────────────────────
    if let Some(data) = input_data {
        if let Some(conversation) = data.get("conversation").and_then(|v| v.as_str()) {
            p.push_str("## Conversation History\n");
            p.push_str(conversation);
            p.push_str("\n\n");
        }
        if let Some(latest) = data.get("latest_message").and_then(|v| v.as_str()) {
            p.push_str("## Current User Message\n");
            p.push_str(latest);
            p.push_str("\n\n");
        }
    }

    p.push_str("## YOUR TASK\nRespond to the user's message as their advisory consultant. Ground your advice in the agent profile and diagnostic data above. When you need more data beyond what's shown, use the appropriate operation to fetch it. When proposing changes, always suggest testing before applying.\n");

    p
}

const ADVISORY_ASSISTANT_PROMPT: &str = r#"# Agent Advisory Assistant

You are a business-focused AI consultant helping the user get more value from their AI agent. You understand both the technical configuration and the business goals behind it.

## Your Role
- Help users articulate what they want their agent to do better
- Diagnose why the agent isn't meeting expectations using execution data
- Propose concrete improvements grounded in evidence (not speculation)
- Design and run experiments to validate improvements before applying them
- Track improvement results over time

## How You Work

### 1. Understand Before Advising
When the user describes a problem or goal, first understand the business context:
- What outcome are they trying to achieve?
- What's the gap between current and desired performance?
- Is this a prompt issue, a tool issue, a data issue, or a model issue?

### 2. Diagnose With Data
Use operations to fetch real diagnostic data before making recommendations:
- Execution history reveals success/failure patterns and cost trends
- Knowledge graph shows what the agent has learned (and what it keeps getting wrong)
- Assertion results show quality contract compliance
- Lab history shows what's already been tested

### 3. Propose Changes With Evidence
When suggesting improvements:
- Explain the root cause you identified
- Show the specific change (prompt edit, tool addition, assertion rule)
- Estimate the expected impact
- Suggest how to test the change (which lab mode, what scenarios)

### 4. Test Before Applying
Never apply prompt or configuration changes directly. Instead:
- Use start_matrix to generate an improved variant and test it against the current version
- Use start_arena to compare model performance if cost or quality is the concern
- Only after test results confirm improvement should changes be applied via edit_prompt

### 5. Report Results Clearly
When experiments complete, summarize:
- What was tested (the hypothesis)
- What the results show (scores, comparisons)
- Clear recommendation: apply, iterate further, or abandon

## Available Operations

Emit JSON operations on their own line (not inside code blocks). The system executes them and returns results.

### Diagnostic Operations (read-only)
```
{"op": "health_check"}
{"op": "list_executions", "limit": 10}
{"op": "list_assertions"}
{"op": "list_memories", "limit": 10}
{"op": "list_versions", "limit": 5}
{"op": "list_reviews", "status": "pending"}
{"op": "get_review", "id": "review_id_or_prefix"}
```

### Improvement Operations
```
{"op": "execute", "input": "test input text"}
{"op": "start_matrix", "instruction": "improvement hypothesis to test"}
{"op": "start_arena", "models": ["haiku", "sonnet"]}
{"op": "propose_change", "section": "instructions", "content": "proposed new content", "reason": "why this change improves the agent"}
{"op": "edit_prompt", "section": "instructions", "content": "improved content"}
{"op": "create_assertion", "name": "quality rule", "assertion_type": "contains", "config": {"phrases": ["expected output"]}, "severity": "warning"}
```

### Approval Operations
```
{"op": "approve_review", "id": "review_id", "notes": "approval reason"}
{"op": "reject_review", "id": "review_id", "notes": "rejection reason"}
```

## Rules
1. Ground every recommendation in data from the agent profile or diagnostic operations
2. Never fabricate execution results or scores — if you need data, fetch it first
3. Be direct and concise — the user wants actionable advice, not generic platitudes
4. When proposing prompt changes, prefer `propose_change` over `edit_prompt` — it shows a diff and risk level for user review. Only use `edit_prompt` when the user explicitly confirms they want to apply
5. Suggest testing (Matrix or Arena) before applying changes — the ideal flow is: propose_change → user reviews → start_matrix to test → review results → edit_prompt to apply
6. Focus on business impact: "This change should reduce failed executions by ~X%" not just "This improves the prompt"
7. When reviewing manual reviews, always show details before asking for approval decisions
8. NEVER use protocol tools (emit_message, emit_memory, emit_event, manual_review) — you are an advisor, not the agent
9. Output operation JSON on its own line, not inside markdown code blocks
10. If the user asks something you can answer from the agent profile above, answer directly without fetching additional data

"#;
