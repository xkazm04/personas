//! Shared topological graph operations.
//!
//! Provides a single implementation of Kahn's topological sort with cycle
//! detection, eliminating the three independent copies in `teams.rs`,
//! `topology.rs`, and `optimizer.rs`.

use std::collections::{HashMap, VecDeque};

// ---------------------------------------------------------------------------
// Core index-based graph
// ---------------------------------------------------------------------------

/// Result of a topological sort.
pub struct TopoSortResult {
    /// Nodes in valid topological order (acyclic portion).
    pub order: Vec<usize>,
    /// Indices of nodes that are part of cycles.
    pub cycle_nodes: Vec<usize>,
}

impl TopoSortResult {
    /// Returns `true` if the graph contains at least one cycle.
    pub fn has_cycle(&self) -> bool {
        !self.cycle_nodes.is_empty()
    }
}

/// An index-based directed graph supporting topological sort and cycle detection.
pub struct TopologyGraph {
    node_count: usize,
    adjacency: Vec<Vec<usize>>,
}

impl TopologyGraph {
    /// Create an empty graph with `node_count` nodes (indexed `0..node_count`).
    pub fn new(node_count: usize) -> Self {
        Self {
            node_count,
            adjacency: vec![vec![]; node_count],
        }
    }

    /// Construct from a list of `(source, target)` index pairs.
    pub fn from_edges(node_count: usize, edges: &[(usize, usize)]) -> Self {
        let mut g = Self::new(node_count);
        for &(src, tgt) in edges {
            g.add_edge(src, tgt);
        }
        g
    }

    /// Add a directed edge. Out-of-bounds indices are silently ignored.
    pub fn add_edge(&mut self, from: usize, to: usize) {
        if from < self.node_count && to < self.node_count {
            self.adjacency[from].push(to);
        }
    }

    /// Kahn's algorithm: returns a topological ordering plus any cycle nodes.
    pub fn topological_sort(&self) -> TopoSortResult {
        let mut in_degree = vec![0usize; self.node_count];
        for adj in &self.adjacency {
            for &tgt in adj {
                in_degree[tgt] += 1;
            }
        }

        let mut queue: VecDeque<usize> = in_degree
            .iter()
            .enumerate()
            .filter(|(_, &deg)| deg == 0)
            .map(|(i, _)| i)
            .collect();

        let mut order = Vec::with_capacity(self.node_count);
        while let Some(node) = queue.pop_front() {
            order.push(node);
            for &neighbor in &self.adjacency[node] {
                in_degree[neighbor] -= 1;
                if in_degree[neighbor] == 0 {
                    queue.push_back(neighbor);
                }
            }
        }

        let cycle_nodes: Vec<usize> = (0..self.node_count)
            .filter(|i| in_degree[*i] > 0)
            .collect();

        TopoSortResult { order, cycle_nodes }
    }

    /// Assign each node to a layer (longest-path from a root).
    ///
    /// Nodes in cycles are assigned to `max_layer + 1`.
    pub fn layer_assignment(&self) -> Vec<usize> {
        let mut in_degree = vec![0usize; self.node_count];
        for adj in &self.adjacency {
            for &tgt in adj {
                in_degree[tgt] += 1;
            }
        }

        let mut layers = vec![0usize; self.node_count];
        let mut queue: VecDeque<usize> = in_degree
            .iter()
            .enumerate()
            .filter(|(_, &deg)| deg == 0)
            .map(|(i, _)| i)
            .collect();

        // Clone in_degree so we can detect cycle nodes after processing
        let mut remaining_degree = in_degree.clone();

        while let Some(node) = queue.pop_front() {
            for &neighbor in &self.adjacency[node] {
                layers[neighbor] = layers[neighbor].max(layers[node] + 1);
                remaining_degree[neighbor] -= 1;
                if remaining_degree[neighbor] == 0 {
                    queue.push_back(neighbor);
                }
            }
        }

        let max_layer = layers.iter().copied().max().unwrap_or(0);
        for (i, deg) in remaining_degree.iter().enumerate() {
            if *deg > 0 {
                layers[i] = max_layer + 1;
            }
        }

        layers
    }
}

// ---------------------------------------------------------------------------
// String-keyed convenience layer
// ---------------------------------------------------------------------------

/// Result of a named topological sort.
pub struct NamedTopoSortResult {
    /// Node IDs in valid topological order.
    pub order: Vec<String>,
    /// Node IDs that are part of cycles.
    pub cycle_nodes: Vec<String>,
}

impl NamedTopoSortResult {
    pub fn has_cycle(&self) -> bool {
        !self.cycle_nodes.is_empty()
    }
}

/// A string-keyed directed graph built from member/connection ID pairs.
pub struct NamedTopologyGraph {
    graph: TopologyGraph,
    id_to_index: HashMap<String, usize>,
    index_to_id: Vec<String>,
}

impl NamedTopologyGraph {
    /// Build a named graph from node IDs and `(source_id, target_id)` edges.
    pub fn new(node_ids: &[String], edges: &[(&str, &str)]) -> Self {
        let id_to_index: HashMap<String, usize> = node_ids
            .iter()
            .enumerate()
            .map(|(i, id)| (id.clone(), i))
            .collect();
        let index_to_id: Vec<String> = node_ids.to_vec();

        let mut graph = TopologyGraph::new(node_ids.len());
        for &(src, tgt) in edges {
            if let (Some(&si), Some(&ti)) = (id_to_index.get(src), id_to_index.get(tgt)) {
                graph.add_edge(si, ti);
            }
        }

        Self {
            graph,
            id_to_index,
            index_to_id,
        }
    }

    /// Topological sort returning string IDs.
    pub fn topological_sort(&self) -> NamedTopoSortResult {
        let result = self.graph.topological_sort();
        NamedTopoSortResult {
            order: result.order.iter().map(|&i| self.index_to_id[i].clone()).collect(),
            cycle_nodes: result.cycle_nodes.iter().map(|&i| self.index_to_id[i].clone()).collect(),
        }
    }

    #[allow(dead_code)]
    pub fn has_cycle(&self) -> bool {
        self.graph.topological_sort().has_cycle()
    }

    #[allow(dead_code)]
    pub fn index_of(&self, id: &str) -> Option<usize> {
        self.id_to_index.get(id).copied()
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_simple_dag() {
        // 0 → 1 → 2
        let g = TopologyGraph::from_edges(3, &[(0, 1), (1, 2)]);
        let result = g.topological_sort();
        assert!(!result.has_cycle());
        assert_eq!(result.order, vec![0, 1, 2]);
        assert!(result.cycle_nodes.is_empty());
    }

    #[test]
    fn test_diamond_dag() {
        // 0 → 1, 0 → 2, 1 → 3, 2 → 3
        let g = TopologyGraph::from_edges(4, &[(0, 1), (0, 2), (1, 3), (2, 3)]);
        let result = g.topological_sort();
        assert!(!result.has_cycle());
        assert_eq!(result.order.len(), 4);
        assert_eq!(result.order[0], 0);
        assert_eq!(result.order[3], 3);
    }

    #[test]
    fn test_cycle_detection() {
        // 0 → 1 → 2 → 0 (full cycle)
        let g = TopologyGraph::from_edges(3, &[(0, 1), (1, 2), (2, 0)]);
        let result = g.topological_sort();
        assert!(result.has_cycle());
        assert!(result.order.is_empty());
        assert_eq!(result.cycle_nodes.len(), 3);
    }

    #[test]
    fn test_partial_cycle() {
        // 0 → 1, 1 → 2, 2 → 1 (cycle between 1 and 2), 0 is acyclic root
        let g = TopologyGraph::from_edges(3, &[(0, 1), (1, 2), (2, 1)]);
        let result = g.topological_sort();
        assert!(result.has_cycle());
        assert_eq!(result.order, vec![0]);
        assert_eq!(result.cycle_nodes.len(), 2);
    }

    #[test]
    fn test_disconnected_nodes() {
        let g = TopologyGraph::from_edges(3, &[]);
        let result = g.topological_sort();
        assert!(!result.has_cycle());
        assert_eq!(result.order.len(), 3);
    }

    #[test]
    fn test_layer_assignment() {
        // 0 → 1 → 3, 0 → 2 → 3
        let g = TopologyGraph::from_edges(4, &[(0, 1), (0, 2), (1, 3), (2, 3)]);
        let layers = g.layer_assignment();
        assert_eq!(layers[0], 0);
        assert_eq!(layers[1], 1);
        assert_eq!(layers[2], 1);
        assert_eq!(layers[3], 2);
    }

    #[test]
    fn test_layer_assignment_cycle() {
        // 0 → 1, 1 → 2, 2 → 1 (cycle)
        let g = TopologyGraph::from_edges(3, &[(0, 1), (1, 2), (2, 1)]);
        let layers = g.layer_assignment();
        assert_eq!(layers[0], 0);
        // Node 1 gets partial layer 1 from edge 0→1, making max_layer = 1.
        // Cycle nodes then get max_layer + 1 = 2.
        assert_eq!(layers[1], 2);
        assert_eq!(layers[2], 2);
    }

    #[test]
    fn test_named_graph() {
        let ids = vec!["a".into(), "b".into(), "c".into()];
        let edges = vec![("a", "b"), ("b", "c")];
        let g = NamedTopologyGraph::new(&ids, &edges);
        let result = g.topological_sort();
        assert!(!result.has_cycle());
        assert_eq!(result.order, vec!["a", "b", "c"]);
    }

    #[test]
    fn test_named_graph_cycle() {
        let ids = vec!["x".into(), "y".into()];
        let edges = vec![("x", "y"), ("y", "x")];
        let g = NamedTopologyGraph::new(&ids, &edges);
        let result = g.topological_sort();
        assert!(result.has_cycle());
        assert_eq!(result.cycle_nodes.len(), 2);
    }

    #[test]
    fn test_empty_graph() {
        let g = TopologyGraph::new(0);
        let result = g.topological_sort();
        assert!(!result.has_cycle());
        assert!(result.order.is_empty());
    }

    #[test]
    fn test_single_node() {
        let g = TopologyGraph::new(1);
        let result = g.topological_sort();
        assert!(!result.has_cycle());
        assert_eq!(result.order, vec![0]);
    }
}
