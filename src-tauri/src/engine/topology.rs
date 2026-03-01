use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::db::models::Persona;

// ============================================================================
// Types
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TopologyBlueprint {
    pub members: Vec<BlueprintMember>,
    pub connections: Vec<BlueprintConnection>,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct BlueprintMember {
    pub persona_id: String,
    pub persona_name: String,
    pub role: String,
    pub position_x: f64,
    pub position_y: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct BlueprintConnection {
    pub source_index: usize,
    pub target_index: usize,
    pub connection_type: String,
}

// ============================================================================
// Keyword extraction + persona scoring
// ============================================================================

/// Role-related keywords that hint at what role a persona should fill.
const ORCHESTRATOR_KEYWORDS: &[&str] = &[
    "orchestrat", "coordinat", "manag", "plan", "direct", "lead",
];
const REVIEWER_KEYWORDS: &[&str] = &[
    "review", "check", "audit", "qualit", "inspect", "validat", "verify", "approv",
];
const ROUTER_KEYWORDS: &[&str] = &[
    "rout", "dispatch", "triag", "classif", "sort", "filter",
];

/// Domain keywords for matching personas to user intent.
const DOMAIN_KEYWORDS: &[(&str, &[&str])] = &[
    ("code", &["code", "program", "develop", "software", "engineer", "implement"]),
    ("test", &["test", "qa", "quality", "assert", "spec", "unit test"]),
    ("review", &["review", "critique", "feedback", "check", "audit"]),
    ("write", &["write", "draft", "author", "content", "copy", "document"]),
    ("research", &["research", "investigat", "analyz", "study", "explor"]),
    ("design", &["design", "architect", "plan", "blueprint", "structure"]),
    ("data", &["data", "analyt", "etl", "transform", "pipeline", "process"]),
    ("deploy", &["deploy", "release", "publish", "ship", "ci/cd"]),
    ("support", &["support", "help", "assist", "troubleshoot", "debug"]),
    ("translate", &["translat", "locali", "i18n", "language"]),
    ("summarize", &["summari", "digest", "condense", "tldr", "brief"]),
    ("edit", &["edit", "proofread", "polish", "refine", "rewrite"]),
];

fn score_persona(persona: &Persona, query_lower: &str) -> f64 {
    let name_lower = persona.name.to_lowercase();
    let desc_lower = persona
        .description
        .as_deref()
        .unwrap_or("")
        .to_lowercase();
    let prompt_lower = persona.system_prompt.to_lowercase();

    let searchable = format!("{name_lower} {desc_lower} {prompt_lower}");

    let mut score = 0.0;

    // Direct name match in query
    let name_words: Vec<&str> = name_lower.split_whitespace().collect();
    for word in &name_words {
        if word.len() >= 3 && query_lower.contains(word) {
            score += 5.0;
        }
    }

    // Domain keyword matching
    for (_domain, keywords) in DOMAIN_KEYWORDS {
        let query_has_domain = keywords.iter().any(|kw| query_lower.contains(kw));
        let persona_has_domain = keywords.iter().any(|kw| searchable.contains(kw));
        if query_has_domain && persona_has_domain {
            score += 3.0;
            // Extra boost for name match
            if keywords.iter().any(|kw| name_lower.contains(kw)) {
                score += 2.0;
            }
        }
    }

    // Query word overlap
    let query_words: Vec<&str> = query_lower.split_whitespace().collect();
    for qw in &query_words {
        if qw.len() >= 3 && searchable.contains(qw) {
            score += 1.0;
        }
    }

    score
}

fn infer_role(persona: &Persona) -> &'static str {
    let searchable = format!(
        "{} {} {}",
        persona.name.to_lowercase(),
        persona.description.as_deref().unwrap_or("").to_lowercase(),
        persona.system_prompt.to_lowercase(),
    );

    if ORCHESTRATOR_KEYWORDS.iter().any(|kw| searchable.contains(kw)) {
        return "orchestrator";
    }
    if REVIEWER_KEYWORDS.iter().any(|kw| searchable.contains(kw)) {
        return "reviewer";
    }
    if ROUTER_KEYWORDS.iter().any(|kw| searchable.contains(kw)) {
        return "router";
    }
    "worker"
}

// ============================================================================
// Layout algorithm — Sugiyama-style layered DAG
// ============================================================================

pub fn compute_dag_layout(
    node_count: usize,
    edges: &[(usize, usize)],
    node_width: f64,
    node_height: f64,
    x_gap: f64,
    y_gap: f64,
) -> Vec<(f64, f64)> {
    if node_count == 0 {
        return vec![];
    }
    if node_count == 1 {
        return vec![(200.0, 120.0)];
    }

    // Layer assignment via shared topology graph (handles cycles)
    let graph = super::topology_graph::TopologyGraph::from_edges(node_count, edges);
    let layers = graph.layer_assignment();

    // Group nodes by layer
    let total_layers = layers.iter().copied().max().unwrap_or(0) + 1;
    let mut layer_nodes: Vec<Vec<usize>> = vec![vec![]; total_layers];
    for (i, &layer) in layers.iter().enumerate() {
        layer_nodes[layer].push(i);
    }

    // Assign positions: top-to-bottom, centered per layer
    let mut positions = vec![(0.0, 0.0); node_count];
    let max_per_layer = layer_nodes.iter().map(|l| l.len()).max().unwrap_or(1);
    let total_width = max_per_layer as f64 * (node_width + x_gap);

    for (layer_idx, nodes_in_layer) in layer_nodes.iter().enumerate() {
        let count = nodes_in_layer.len();
        let layer_width = count as f64 * (node_width + x_gap) - x_gap;
        let start_x = (total_width - layer_width) / 2.0 + 80.0;
        let y = 80.0 + layer_idx as f64 * (node_height + y_gap);

        for (pos_in_layer, &node_idx) in nodes_in_layer.iter().enumerate() {
            let x = start_x + pos_in_layer as f64 * (node_width + x_gap);
            positions[node_idx] = (x, y);
        }
    }

    positions
}

// ============================================================================
// Blueprint generator
// ============================================================================

pub fn suggest_topology(
    query: &str,
    personas: &[Persona],
    existing_member_ids: &[String],
) -> TopologyBlueprint {
    let query_lower = query.to_lowercase();

    // Score all available personas (not already in team)
    let existing_set: std::collections::HashSet<&str> =
        existing_member_ids.iter().map(|s| s.as_str()).collect();

    let mut scored: Vec<(usize, f64)> = personas
        .iter()
        .enumerate()
        .filter(|(_, p)| !existing_set.contains(p.id.as_str()) && p.enabled)
        .map(|(i, p)| (i, score_persona(p, &query_lower)))
        .collect();

    // Sort by score descending
    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

    // Select top personas (up to 5, at least those with score > 0)
    let selected: Vec<usize> = scored
        .iter()
        .filter(|(_, score)| *score > 0.0)
        .take(5)
        .map(|(idx, _)| *idx)
        .collect();

    if selected.is_empty() {
        // Fall back: use up to 3 enabled personas with highest ID order
        let fallback: Vec<usize> = personas
            .iter()
            .enumerate()
            .filter(|(_, p)| !existing_set.contains(p.id.as_str()) && p.enabled)
            .take(3)
            .map(|(i, _)| i)
            .collect();

        return build_blueprint(&query_lower, personas, &fallback);
    }

    build_blueprint(&query_lower, personas, &selected)
}

fn build_blueprint(
    _query_lower: &str,
    personas: &[Persona],
    selected_indices: &[usize],
) -> TopologyBlueprint {
    if selected_indices.is_empty() {
        return TopologyBlueprint {
            members: vec![],
            connections: vec![],
            description: "No matching agents found. Create some agents first, then try again.".into(),
        };
    }

    // Assign roles
    let mut members: Vec<BlueprintMember> = Vec::new();
    let mut role_counts: HashMap<&str, usize> = HashMap::new();

    for &idx in selected_indices {
        let persona = &personas[idx];
        let mut role = infer_role(persona);

        // Ensure at most one orchestrator
        if role == "orchestrator" && *role_counts.get("orchestrator").unwrap_or(&0) > 0 {
            role = "worker";
        }

        *role_counts.entry(role).or_insert(0) += 1;

        members.push(BlueprintMember {
            persona_id: persona.id.clone(),
            persona_name: persona.name.clone(),
            role: role.to_string(),
            position_x: 0.0, // Will be computed by layout
            position_y: 0.0,
        });
    }

    // Determine connection topology based on roles
    let mut connections = Vec::new();
    let member_count = members.len();

    if member_count == 1 {
        // Single node, no connections
    } else {
        // Find orchestrator, workers, reviewers, routers
        let orchestrators: Vec<usize> = members.iter().enumerate()
            .filter(|(_, m)| m.role == "orchestrator")
            .map(|(i, _)| i)
            .collect();
        let reviewers: Vec<usize> = members.iter().enumerate()
            .filter(|(_, m)| m.role == "reviewer")
            .map(|(i, _)| i)
            .collect();
        let workers: Vec<usize> = members.iter().enumerate()
            .filter(|(_, m)| m.role == "worker")
            .map(|(i, _)| i)
            .collect();
        let routers: Vec<usize> = members.iter().enumerate()
            .filter(|(_, m)| m.role == "router")
            .map(|(i, _)| i)
            .collect();

        if !orchestrators.is_empty() {
            let orch = orchestrators[0];
            // Orchestrator → each worker
            for &w in &workers {
                connections.push(BlueprintConnection {
                    source_index: orch,
                    target_index: w,
                    connection_type: "sequential".into(),
                });
            }
            // Orchestrator → router
            for &r in &routers {
                connections.push(BlueprintConnection {
                    source_index: orch,
                    target_index: r,
                    connection_type: "sequential".into(),
                });
            }
            // Workers → reviewer
            for &w in &workers {
                for &rev in &reviewers {
                    connections.push(BlueprintConnection {
                        source_index: w,
                        target_index: rev,
                        connection_type: "sequential".into(),
                    });
                }
            }
            // Reviewer → orchestrator feedback
            for &rev in &reviewers {
                connections.push(BlueprintConnection {
                    source_index: rev,
                    target_index: orch,
                    connection_type: "feedback".into(),
                });
            }
        } else {
            // No orchestrator: build a simple sequential chain
            // workers first, then reviewers, then routers
            let mut chain: Vec<usize> = Vec::new();
            chain.extend(&routers);
            chain.extend(&workers);
            chain.extend(&reviewers);

            if chain.is_empty() {
                // All same role — just chain them
                for i in 0..member_count {
                    chain.push(i);
                }
            }

            for window in chain.windows(2) {
                connections.push(BlueprintConnection {
                    source_index: window[0],
                    target_index: window[1],
                    connection_type: "sequential".into(),
                });
            }

            // Add feedback from last reviewer back to first worker
            if !reviewers.is_empty() && !workers.is_empty() {
                connections.push(BlueprintConnection {
                    source_index: *reviewers.last().unwrap(),
                    target_index: workers[0],
                    connection_type: "feedback".into(),
                });
            }
        }
    }

    // Compute layout positions
    let edge_pairs: Vec<(usize, usize)> = connections
        .iter()
        .map(|c| (c.source_index, c.target_index))
        .collect();

    let positions = compute_dag_layout(
        member_count,
        &edge_pairs,
        180.0, // node_width
        70.0,  // node_height
        60.0,  // x_gap
        100.0, // y_gap
    );

    for (i, member) in members.iter_mut().enumerate() {
        member.position_x = positions[i].0;
        member.position_y = positions[i].1;
    }

    // Build description
    let agent_names: Vec<&str> = members.iter().map(|m| m.persona_name.as_str()).collect();
    let description = format!(
        "Suggested pipeline with {} agents: {}. Connections auto-wired based on agent roles.",
        members.len(),
        agent_names.join(", "),
    );

    TopologyBlueprint {
        members,
        connections,
        description,
    }
}
