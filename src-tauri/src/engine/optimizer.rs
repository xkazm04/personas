use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::db::models::{PersonaTeamConnection, PersonaTeamMember, PipelineRun};

// ============================================================================
// Analytics types
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct NodeAnalytics {
    pub member_id: String,
    pub persona_id: String,
    pub total_runs: i64,
    pub successes: i64,
    pub failures: i64,
    pub success_rate: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TopologySuggestion {
    pub id: String,
    pub suggestion_type: String,
    pub title: String,
    pub description: String,
    pub confidence: f64,
    pub impact: String,
    pub affected_member_ids: Vec<String>,
    pub suggested_source: Option<String>,
    pub suggested_target: Option<String>,
    pub suggested_connection_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PipelineAnalytics {
    pub team_id: String,
    pub total_runs: i64,
    pub completed_runs: i64,
    pub failed_runs: i64,
    pub success_rate: f64,
    pub avg_duration_secs: f64,
    pub node_analytics: Vec<NodeAnalytics>,
    pub suggestions: Vec<TopologySuggestion>,
}

// ============================================================================
// Node status as stored in pipeline_runs.node_statuses JSON
// ============================================================================

#[derive(Debug, Deserialize)]
struct NodeStatusEntry {
    member_id: String,
    #[allow(dead_code)]
    persona_id: Option<String>,
    status: String,
}

// ============================================================================
// Analyzer
// ============================================================================

pub fn analyze_pipeline(
    team_id: &str,
    runs: &[PipelineRun],
    members: &[PersonaTeamMember],
    connections: &[PersonaTeamConnection],
) -> PipelineAnalytics {
    let total_runs = runs.len() as i64;
    let completed_runs = runs.iter().filter(|r| r.status == "completed").count() as i64;
    let failed_runs = runs.iter().filter(|r| r.status == "failed").count() as i64;
    let success_rate = if total_runs > 0 {
        completed_runs as f64 / total_runs as f64
    } else {
        0.0
    };

    // Average pipeline duration
    let avg_duration_secs = compute_avg_duration(runs);

    // Per-node analytics
    let node_analytics = compute_node_analytics(runs, members);

    // Generate suggestions
    let suggestions = generate_suggestions(
        team_id,
        &node_analytics,
        members,
        connections,
        total_runs,
        success_rate,
    );

    PipelineAnalytics {
        team_id: team_id.to_string(),
        total_runs,
        completed_runs,
        failed_runs,
        success_rate,
        avg_duration_secs,
        node_analytics,
        suggestions,
    }
}

/// Parse "YYYY-MM-DD HH:MM:SS" to seconds since midnight (only for duration diff).
fn parse_timestamp_secs(s: &str) -> Option<i64> {
    // Format: "2024-01-15 10:30:45"
    let parts: Vec<&str> = s.split(' ').collect();
    if parts.len() < 2 {
        return None;
    }
    let date_parts: Vec<i64> = parts[0].split('-').filter_map(|p| p.parse().ok()).collect();
    let time_parts: Vec<i64> = parts[1].split(':').filter_map(|p| p.parse().ok()).collect();
    if date_parts.len() < 3 || time_parts.len() < 3 {
        return None;
    }
    // Approximate: days since epoch * 86400 + time-of-day seconds
    let days = date_parts[0] * 365 + date_parts[1] * 30 + date_parts[2];
    Some(days * 86400 + time_parts[0] * 3600 + time_parts[1] * 60 + time_parts[2])
}

fn compute_avg_duration(runs: &[PipelineRun]) -> f64 {
    let durations: Vec<f64> = runs
        .iter()
        .filter_map(|r| {
            let started = parse_timestamp_secs(&r.started_at)?;
            let completed = r.completed_at.as_ref().and_then(|c| parse_timestamp_secs(c))?;
            let diff = completed - started;
            if diff >= 0 { Some(diff as f64) } else { None }
        })
        .collect();

    if durations.is_empty() {
        0.0
    } else {
        durations.iter().sum::<f64>() / durations.len() as f64
    }
}

fn compute_node_analytics(
    runs: &[PipelineRun],
    members: &[PersonaTeamMember],
) -> Vec<NodeAnalytics> {
    let mut member_stats: HashMap<String, (i64, i64, i64, String)> = HashMap::new();

    for member in members {
        member_stats.insert(
            member.id.clone(),
            (0, 0, 0, member.persona_id.clone()),
        );
    }

    for run in runs {
        let entries: Vec<NodeStatusEntry> =
            serde_json::from_str(&run.node_statuses).unwrap_or_default();

        for entry in entries {
            if let Some(stats) = member_stats.get_mut(&entry.member_id) {
                stats.0 += 1; // total
                match entry.status.as_str() {
                    "completed" => stats.1 += 1,
                    "failed" => stats.2 += 1,
                    _ => {}
                }
            }
        }
    }

    member_stats
        .into_iter()
        .map(|(member_id, (total, successes, failures, persona_id))| {
            let success_rate = if total > 0 {
                successes as f64 / total as f64
            } else {
                0.0
            };
            NodeAnalytics {
                member_id,
                persona_id,
                total_runs: total,
                successes,
                failures,
                success_rate,
            }
        })
        .collect()
}

fn generate_suggestions(
    team_id: &str,
    node_analytics: &[NodeAnalytics],
    members: &[PersonaTeamMember],
    connections: &[PersonaTeamConnection],
    total_runs: i64,
    _pipeline_success_rate: f64,
) -> Vec<TopologySuggestion> {
    let mut suggestions = Vec::new();
    let mut suggestion_idx = 0u32;

    // Need at least 2 runs to make meaningful suggestions
    if total_runs < 2 {
        return suggestions;
    }

    // === Suggestion 1: Flag underperforming agents ===
    for na in node_analytics {
        if na.total_runs >= 2 && na.success_rate < 0.5 {
            let member_name = members
                .iter()
                .find(|m| m.id == na.member_id)
                .map(|m| m.persona_id.clone())
                .unwrap_or_else(|| na.member_id.clone());

            suggestions.push(TopologySuggestion {
                id: format!("{team_id}-suggestion-{suggestion_idx}"),
                suggestion_type: "remove_underperformer".into(),
                title: "Underperforming Agent".into(),
                description: format!(
                    "Agent {} has a {:.0}% success rate across {} runs. Consider removing or replacing it.",
                    member_name,
                    na.success_rate * 100.0,
                    na.total_runs,
                ),
                confidence: (1.0 - na.success_rate).min(0.95),
                impact: if na.success_rate < 0.25 { "high" } else { "medium" }.into(),
                affected_member_ids: vec![na.member_id.clone()],
                suggested_source: None,
                suggested_target: None,
                suggested_connection_type: None,
            });
            suggestion_idx += 1;
        }
    }

    // === Suggestion 2: Parallelization opportunities ===
    // Find nodes that have no dependency between them (neither is ancestor of the other)
    let parallel_opportunities = find_parallelizable_nodes(members, connections);
    for (source_id, target_id) in &parallel_opportunities {
        suggestions.push(TopologySuggestion {
            id: format!("{team_id}-suggestion-{suggestion_idx}"),
            suggestion_type: "parallelize".into(),
            title: "Parallel Execution".into(),
            description: "These agents have no data dependency. Running them in parallel could reduce total pipeline duration.".into(),
            confidence: 0.75,
            impact: "high".into(),
            affected_member_ids: vec![source_id.clone(), target_id.clone()],
            suggested_source: Some(source_id.clone()),
            suggested_target: Some(target_id.clone()),
            suggested_connection_type: Some("parallel".into()),
        });
        suggestion_idx += 1;
    }

    // === Suggestion 3: Add feedback loop for reviewer agents ===
    for member in members {
        if member.role == "reviewer" {
            let has_feedback_output = connections
                .iter()
                .any(|c| c.source_member_id == member.id && c.connection_type == "feedback");

            if !has_feedback_output {
                // Find the node(s) that feed into this reviewer
                let upstream: Vec<&str> = connections
                    .iter()
                    .filter(|c| c.target_member_id == member.id)
                    .map(|c| c.source_member_id.as_str())
                    .collect();

                if let Some(upstream_id) = upstream.first() {
                    suggestions.push(TopologySuggestion {
                        id: format!("{team_id}-suggestion-{suggestion_idx}"),
                        suggestion_type: "add_feedback".into(),
                        title: "Add Feedback Loop".into(),
                        description: "This reviewer agent has no feedback connection back to its source. Adding one enables iterative refinement.".into(),
                        confidence: 0.6,
                        impact: "medium".into(),
                        affected_member_ids: vec![member.id.clone(), upstream_id.to_string()],
                        suggested_source: Some(member.id.clone()),
                        suggested_target: Some(upstream_id.to_string()),
                        suggested_connection_type: Some("feedback".into()),
                    });
                    suggestion_idx += 1;
                }
            }
        }
    }

    // === Suggestion 4: Disconnected nodes ===
    let connected_ids: HashSet<&str> = connections
        .iter()
        .flat_map(|c| vec![c.source_member_id.as_str(), c.target_member_id.as_str()])
        .collect();

    for member in members {
        if members.len() > 1 && !connected_ids.contains(member.id.as_str()) {
            suggestions.push(TopologySuggestion {
                id: format!("{team_id}-suggestion-{suggestion_idx}"),
                suggestion_type: "connect_isolated".into(),
                title: "Isolated Agent".into(),
                description: "This agent has no connections. Connect it to receive input from another agent or feed output downstream.".into(),
                confidence: 0.9,
                impact: "high".into(),
                affected_member_ids: vec![member.id.clone()],
                suggested_source: None,
                suggested_target: None,
                suggested_connection_type: None,
            });
            suggestion_idx += 1;
        }
    }

    // === Suggestion 5: Reorder suggestion for sequential chains ===
    // If a high-failure node is early in the chain, suggest moving it later
    // so other nodes can succeed first
    let execution_order = topological_order(members, connections);
    for (idx, member_id) in execution_order.iter().enumerate() {
        if idx >= execution_order.len() / 2 {
            break; // Only look at the first half
        }
        if let Some(na) = node_analytics.iter().find(|n| n.member_id == *member_id) {
            if na.total_runs >= 3 && na.success_rate < 0.6 {
                suggestions.push(TopologySuggestion {
                    id: format!("{team_id}-suggestion-{suggestion_idx}"),
                    suggestion_type: "reorder".into(),
                    title: "Reorder Pipeline".into(),
                    description: format!(
                        "This agent fails {:.0}% of the time and runs early in the pipeline, blocking downstream agents. Consider moving it later or adding conditional branching.",
                        (1.0 - na.success_rate) * 100.0,
                    ),
                    confidence: 0.55,
                    impact: "medium".into(),
                    affected_member_ids: vec![member_id.clone()],
                    suggested_source: None,
                    suggested_target: None,
                    suggested_connection_type: None,
                });
                suggestion_idx += 1;
            }
        }
    }

    // Sort by confidence descending
    suggestions.sort_by(|a, b| b.confidence.partial_cmp(&a.confidence).unwrap_or(std::cmp::Ordering::Equal));

    suggestions
}

/// Find pairs of nodes that are currently in a sequential chain but have no
/// data dependency (no shared ancestor/descendant relationship through non-sequential edges).
fn find_parallelizable_nodes(
    members: &[PersonaTeamMember],
    connections: &[PersonaTeamConnection],
) -> Vec<(String, String)> {
    if members.len() < 2 {
        return vec![];
    }

    // Build adjacency for reachability
    let mut adjacency: HashMap<&str, Vec<&str>> = HashMap::new();
    for m in members {
        adjacency.insert(&m.id, vec![]);
    }
    for c in connections {
        if let Some(adj) = adjacency.get_mut(c.source_member_id.as_str()) {
            adj.push(&c.target_member_id);
        }
    }

    // Compute reachability from each node using BFS
    let mut reachable: HashMap<&str, HashSet<&str>> = HashMap::new();
    for m in members {
        let mut visited = HashSet::new();
        let mut queue = std::collections::VecDeque::new();
        queue.push_back(m.id.as_str());
        while let Some(node) = queue.pop_front() {
            if !visited.insert(node) {
                continue;
            }
            if let Some(neighbors) = adjacency.get(node) {
                for &n in neighbors {
                    queue.push_back(n);
                }
            }
        }
        visited.remove(m.id.as_str());
        reachable.insert(&m.id, visited);
    }

    // Find nodes sharing the same parent with no dependency between them
    let mut candidates = Vec::new();
    let mut seen_pairs: HashSet<(String, String)> = HashSet::new();

    // Group nodes by their predecessor
    let mut children_of: HashMap<&str, Vec<&str>> = HashMap::new();
    for c in connections {
        children_of
            .entry(&c.source_member_id)
            .or_default()
            .push(&c.target_member_id);
    }

    for (_parent, children) in &children_of {
        if children.len() < 2 {
            continue;
        }
        for i in 0..children.len() {
            for j in (i + 1)..children.len() {
                let a = children[i];
                let b = children[j];
                let a_reaches_b = reachable.get(a).map(|r| r.contains(b)).unwrap_or(false);
                let b_reaches_a = reachable.get(b).map(|r| r.contains(a)).unwrap_or(false);
                if !a_reaches_b && !b_reaches_a {
                    let pair = if a < b {
                        (a.to_string(), b.to_string())
                    } else {
                        (b.to_string(), a.to_string())
                    };
                    if seen_pairs.insert(pair.clone()) {
                        candidates.push(pair);
                    }
                }
            }
        }
    }

    candidates
}

fn topological_order(
    members: &[PersonaTeamMember],
    connections: &[PersonaTeamConnection],
) -> Vec<String> {
    let member_ids: Vec<String> = members.iter().map(|m| m.id.clone()).collect();
    let mut in_degree: HashMap<String, usize> = member_ids.iter().map(|id| (id.clone(), 0)).collect();
    let mut adjacency: HashMap<String, Vec<String>> = member_ids.iter().map(|id| (id.clone(), vec![])).collect();

    for conn in connections {
        if let Some(deg) = in_degree.get_mut(&conn.target_member_id) {
            *deg += 1;
        }
        if let Some(adj) = adjacency.get_mut(&conn.source_member_id) {
            adj.push(conn.target_member_id.clone());
        }
    }

    let mut queue: std::collections::VecDeque<String> = in_degree
        .iter()
        .filter(|(_, &deg)| deg == 0)
        .map(|(id, _)| id.clone())
        .collect();

    let mut order = Vec::new();
    while let Some(node) = queue.pop_front() {
        order.push(node.clone());
        if let Some(neighbors) = adjacency.get(&node) {
            for neighbor in neighbors {
                if let Some(deg) = in_degree.get_mut(neighbor) {
                    *deg -= 1;
                    if *deg == 0 {
                        queue.push_back(neighbor.clone());
                    }
                }
            }
        }
    }

    // Add any remaining (cycles)
    for id in &member_ids {
        if !order.contains(id) {
            order.push(id.clone());
        }
    }

    order
}
