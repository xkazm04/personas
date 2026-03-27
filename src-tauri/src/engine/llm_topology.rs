use std::collections::HashMap;

use serde::Deserialize;

use crate::db::models::{Persona, PersonaDesignReview};

use super::topology_types::{BlueprintConnection, BlueprintMember, TopologyBlueprint, compute_dag_layout};

// ============================================================================
// LLM response types (internal -- parsed from Claude output)
// ============================================================================

#[derive(Debug, Deserialize)]
struct LlmTopologyResponse {
    members: Vec<LlmMember>,
    connections: Vec<LlmConnection>,
    description: String,
    suggested_pattern: Option<String>,
}

#[derive(Debug, Deserialize)]
struct LlmMember {
    persona_id: String,
    role: String,
}

#[derive(Debug, Deserialize)]
struct LlmConnection {
    source_index: usize,
    target_index: usize,
    connection_type: String,
}

// ============================================================================
// Prompt builder
// ============================================================================

pub fn build_llm_topology_prompt(
    query: &str,
    personas: &[Persona],
    templates: &[PersonaDesignReview],
    existing_member_ids: &[String],
) -> String {
    let existing_set: std::collections::HashSet<&str> =
        existing_member_ids.iter().map(|s| s.as_str()).collect();

    // Build persona catalog (compact)
    let persona_catalog: Vec<serde_json::Value> = personas
        .iter()
        .filter(|p| p.enabled && !existing_set.contains(p.id.as_str()))
        .map(|p| {
            let prompt_snippet = if p.system_prompt.len() > 200 {
                format!("{}...", &p.system_prompt[..200])
            } else {
                p.system_prompt.clone()
            };
            serde_json::json!({
                "id": p.id,
                "name": p.name,
                "description": p.description,
                "system_prompt_snippet": prompt_snippet,
            })
        })
        .collect();

    // Build template catalog (compact, up to 50)
    let template_catalog: Vec<serde_json::Value> = templates
        .iter()
        .take(50)
        .map(|t| {
            let snippet = if t.instruction.len() > 150 {
                format!("{}...", &t.instruction[..150])
            } else {
                t.instruction.clone()
            };
            serde_json::json!({
                "id": t.id,
                "name": t.test_case_name,
                "instruction_snippet": snippet,
                "category": t.category,
                "connectors": t.connectors_used,
            })
        })
        .collect();

    let persona_catalog_json =
        serde_json::to_string_pretty(&persona_catalog).unwrap_or_else(|_| "[]".into());
    let template_catalog_json =
        serde_json::to_string_pretty(&template_catalog).unwrap_or_else(|_| "[]".into());

    format!(
        r#"You are a team composition architect for an agentic automation platform.

## User Request
{query}

## Available Personas (agents the user has created)
{persona_catalog_json}

## Available Template Gallery (pre-built agent templates for context)
{template_catalog_json}

## Available Pipeline Patterns
1. "code-review-chain" -- Linear: coder -> reviewer -> merger (with feedback)
2. "content-pipeline" -- Linear: researcher -> writer -> editor -> publisher (with feedback)
3. "support-triage" -- Router with conditional paths to specialists
4. "etl-pipeline" -- Linear: collector -> transformer -> validator -> loader
5. "orchestrated-team" -- Central orchestrator with parallel workers
6. "quality-gate" -- Build-test-review-deploy with feedback loop
7. "research-synthesis" -- Parallel researchers -> analyst -> reviewer (with feedback)
8. "creative-studio" -- Ideation -> design -> critique -> refine (with feedback)
9. "approval-workflow" -- Multi-level approval with escalation
10. "custom" -- Custom topology not matching any pattern

## Task
Based on the user's request, compose an optimal team:

1. **Select agents**: Pick from "Available Personas" that best fit the user's needs. Select 2-6 agents.
2. **Assign roles**: Each agent gets exactly one role: "orchestrator", "worker", "reviewer", or "router". At most one orchestrator.
3. **Design connections**: Define how agents connect. Use connection types:
   - "sequential" -- output of source feeds input of target
   - "conditional" -- route based on conditions
   - "parallel" -- source fans out to multiple targets simultaneously
   - "feedback" -- target sends review/corrections back to source
4. **Suggest pattern**: Which of the 10 pipeline patterns best fits, or "custom".

Return ONLY a JSON object:
{{
  "members": [
    {{"persona_id": "actual-id-from-catalog", "role": "worker"}}
  ],
  "connections": [
    {{"source_index": 0, "target_index": 1, "connection_type": "sequential"}}
  ],
  "description": "Explanation of the team composition and why these agents were selected",
  "suggested_pattern": "pattern-id-or-custom"
}}

Rules:
- source_index and target_index are 0-based indices into the members array
- Only use persona_ids that exist in the Available Personas catalog
- If no personas match at all, return empty members array with a helpful description
- Keep connections sensible (no self-loops, connection types appropriate for the roles)
- Return ONLY the JSON object, no other text"#
    )
}

// ============================================================================
// Response parser
// ============================================================================

pub fn parse_llm_topology_response(
    output: &str,
    personas: &[Persona],
) -> Option<TopologyBlueprint> {
    use crate::commands::design::n8n_transform::cli_runner::extract_first_json_object_matching;

    let json_str = extract_first_json_object_matching(output, |val| {
        val.get("members").is_some() && val.get("connections").is_some()
    })?;

    let response: LlmTopologyResponse = serde_json::from_str(&json_str).ok()?;

    // Map persona IDs to names for resolution
    let persona_map: HashMap<&str, &str> = personas
        .iter()
        .map(|p| (p.id.as_str(), p.name.as_str()))
        .collect();

    // Build members, resolving persona names
    let mut members: Vec<BlueprintMember> = response
        .members
        .iter()
        .filter(|m| persona_map.contains_key(m.persona_id.as_str()))
        .map(|m| {
            let name = persona_map
                .get(m.persona_id.as_str())
                .copied()
                .unwrap_or("Unknown Agent");
            BlueprintMember {
                persona_id: m.persona_id.clone(),
                persona_name: name.to_string(),
                role: m.role.clone(),
                position_x: 0.0,
                position_y: 0.0,
            }
        })
        .collect();

    if members.is_empty() {
        return None;
    }

    // Validate connection indices and filter invalid ones
    let connections: Vec<BlueprintConnection> = response
        .connections
        .into_iter()
        .filter(|c| {
            c.source_index < members.len()
                && c.target_index < members.len()
                && c.source_index != c.target_index
        })
        .map(|c| BlueprintConnection {
            source_index: c.source_index,
            target_index: c.target_index,
            connection_type: c.connection_type,
        })
        .collect();

    // Compute DAG layout positions
    let edge_pairs: Vec<(usize, usize)> = connections
        .iter()
        .map(|c| (c.source_index, c.target_index))
        .collect();
    let positions = compute_dag_layout(members.len(), &edge_pairs, 180.0, 70.0, 60.0, 100.0);
    for (i, member) in members.iter_mut().enumerate() {
        member.position_x = positions[i].0;
        member.position_y = positions[i].1;
    }

    // Build description with pattern hint
    let description = match response.suggested_pattern.as_deref() {
        Some(pattern) if pattern != "custom" => {
            format!("{} (Pattern: {})", response.description, pattern)
        }
        _ => response.description,
    };

    Some(TopologyBlueprint {
        members,
        connections,
        description,
    })
}
