//! The process tree: which processes belong to a run.
//!
//! A run is charged for its root process AND everything the root spawned - a
//! `cargo build` a session starts is that session's cost. The tree is built
//! once per tick from the parent links of ONE process-table refresh, then
//! walked from each tracked root.
//!
//! Two guards make the walk honest on Windows, where pids are recycled and a
//! process keeps the pid of a parent that died long ago:
//! * a child counts only if it started no earlier than its parent (a stale
//!   parent link to a recycled pid points at a NEWER process, so the claimed
//!   child is older than its "parent" and is refused);
//! * the walk keeps a visited set, so a parent cycle cannot loop it.
//!
//! This is the ONE tree walk in the backend: `commands::fleet::process_scan`
//! scans the table flat and `memory_bytes_for` reads single pids, so there
//! was no existing descendant walk to reuse.

use std::collections::{HashMap, HashSet};

/// One process as the tree needs it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ProcNode {
    pub pid: u32,
    pub parent: Option<u32>,
    /// Start time in epoch seconds; 0 when the platform would not say.
    pub start_time: u64,
}

/// Parent -> children index over one process-table snapshot.
#[derive(Debug, Default)]
pub struct ProcessTree {
    children: HashMap<u32, Vec<u32>>,
    present: HashSet<u32>,
}

impl ProcessTree {
    pub fn build(nodes: &[ProcNode]) -> Self {
        let start: HashMap<u32, u64> = nodes.iter().map(|n| (n.pid, n.start_time)).collect();
        let mut children: HashMap<u32, Vec<u32>> = HashMap::new();
        for n in nodes {
            let Some(parent) = n.parent else { continue };
            if parent == n.pid {
                continue;
            }
            // Refuse a child older than its claimed parent (a recycled pid);
            // an unknown time (0) on either side cannot refuse anything.
            let parent_start = start.get(&parent).copied().unwrap_or(0);
            if n.start_time != 0 && parent_start != 0 && n.start_time < parent_start {
                continue;
            }
            children.entry(parent).or_default().push(n.pid);
        }
        Self {
            children,
            present: nodes.iter().map(|n| n.pid).collect(),
        }
    }

    pub fn contains(&self, pid: u32) -> bool {
        self.present.contains(&pid)
    }

    /// `root` and every live descendant of it. Empty when `root` is not in
    /// the snapshot (the run's process is gone).
    pub fn subtree(&self, root: u32) -> Vec<u32> {
        if !self.contains(root) {
            return Vec::new();
        }
        let mut seen: HashSet<u32> = HashSet::from([root]);
        let mut out = vec![root];
        let mut i = 0;
        while i < out.len() {
            if let Some(kids) = self.children.get(&out[i]) {
                for &k in kids {
                    if seen.insert(k) {
                        out.push(k);
                    }
                }
            }
            i += 1;
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn node(pid: u32, parent: Option<u32>, start_time: u64) -> ProcNode {
        ProcNode {
            pid,
            parent,
            start_time,
        }
    }

    #[test]
    fn subtree_walks_grandchildren_and_skips_strangers() {
        let tree = ProcessTree::build(&[
            node(1, None, 10),
            node(2, Some(1), 11),
            node(3, Some(2), 12),
            node(4, Some(1), 11),
            node(9, None, 5),
            node(10, Some(9), 6),
        ]);
        let mut got = tree.subtree(1);
        got.sort_unstable();
        assert_eq!(got, vec![1, 2, 3, 4]);
        assert_eq!(tree.subtree(9), vec![9, 10]);
        assert!(tree.subtree(77).is_empty(), "a gone root has no tree");
    }

    #[test]
    fn a_recycled_parent_pid_does_not_adopt_an_older_process() {
        // pid 5 was recycled: the live 5 started at 100, but 6 claims it as a
        // parent while having started at 50, so 6 belonged to the dead 5.
        let tree = ProcessTree::build(&[node(5, None, 100), node(6, Some(5), 50)]);
        assert_eq!(tree.subtree(5), vec![5]);
        // Unknown times cannot refuse.
        let tree = ProcessTree::build(&[node(5, None, 0), node(6, Some(5), 50)]);
        assert_eq!(tree.subtree(5), vec![5, 6]);
    }

    #[test]
    fn a_parent_cycle_terminates() {
        let tree = ProcessTree::build(&[node(1, Some(2), 0), node(2, Some(1), 0)]);
        let mut got = tree.subtree(1);
        got.sort_unstable();
        assert_eq!(got, vec![1, 2]);
    }
}
