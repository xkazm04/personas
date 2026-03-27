//! Shared topology types and layout algorithm.
//!
//! This module contains the common types used by both the heuristic topology
//! generator (`topology_heuristic.rs`) and the LLM-powered topology generator
//! (`llm_topology.rs`), plus the shared DAG layout algorithm.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

// ============================================================================
// Shared blueprint types
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
// Layout algorithm -- Sugiyama-style layered DAG
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
