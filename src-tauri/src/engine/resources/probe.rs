//! One tick's measurement of every tracked run: ONE process-table refresh,
//! ONE GPU-engine collection, then a tree walk per run.
//!
//! The `System` and the GPU query live across ticks - sysinfo's per-process
//! CPU% and PDH's utilisation are both rates over the gap since the previous
//! refresh, so a fresh object every tick would read zero forever.

use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System};

use super::gpu::{tree_share, GpuReader};
use super::summary::Reading;
use super::tree::{ProcNode, ProcessTree};

/// What the probe needs to know about one tracked run.
#[derive(Debug, Clone)]
pub struct RunProbe {
    pub root_pid: u32,
    /// The root's start time as first observed (epoch seconds), so a recycled
    /// pid is not mistaken for the run's process.
    pub root_start: Option<u64>,
}

/// One run's result for this tick.
#[derive(Debug, Clone, PartialEq)]
pub enum ProbeResult {
    /// The root process is gone (or its pid now names another process).
    Gone,
    /// Measured; `root_start` is the root's start time for the next tick's
    /// identity check.
    Sampled { reading: Reading, root_start: u64 },
}

pub struct Probe {
    sys: System,
    gpu: GpuReader,
    logical_cores: f64,
    total_ram: f64,
}

impl Probe {
    pub fn new() -> Self {
        let mut sys = System::new();
        sys.refresh_memory();
        let logical_cores = std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(1) as f64;
        let total_ram = sys.total_memory() as f64;
        Self {
            sys,
            gpu: GpuReader::open(),
            logical_cores,
            total_ram,
        }
    }

    /// Measure every probe in one pass. Results are in `runs` order.
    pub fn sample(&mut self, runs: &[RunProbe]) -> Vec<ProbeResult> {
        self.sys.refresh_processes_specifics(
            ProcessesToUpdate::All,
            true,
            ProcessRefreshKind::nothing().with_cpu().with_memory(),
        );
        let nodes: Vec<ProcNode> = self
            .sys
            .processes()
            .iter()
            .map(|(pid, p)| ProcNode {
                pid: pid.as_u32(),
                parent: p.parent().map(|pp| pp.as_u32()),
                start_time: p.start_time(),
            })
            .collect();
        let tree = ProcessTree::build(&nodes);
        let gpu = self.gpu.read();

        runs.iter()
            .map(|run| {
                let root = sysinfo::Pid::from_u32(run.root_pid);
                let Some(root_proc) = self.sys.process(root) else {
                    return ProbeResult::Gone;
                };
                let root_start = root_proc.start_time();
                if run
                    .root_start
                    .is_some_and(|s| s != 0 && root_start != 0 && s != root_start)
                {
                    return ProbeResult::Gone;
                }
                let pids = tree.subtree(run.root_pid);
                let (mut cpu_pct, mut ram_bytes) = (0.0f64, 0u64);
                for pid in &pids {
                    if let Some(p) = self.sys.process(sysinfo::Pid::from_u32(*pid)) {
                        cpu_pct += f64::from(p.cpu_usage());
                        ram_bytes = ram_bytes.saturating_add(p.memory());
                    }
                }
                let cpu = share(cpu_pct, 100.0 * self.logical_cores);
                let ram = share(ram_bytes as f64, self.total_ram);
                ProbeResult::Sampled {
                    reading: Reading {
                        cpu,
                        ram,
                        gpu: tree_share(gpu.as_ref(), &pids),
                    },
                    root_start,
                }
            })
            .collect()
    }
}

/// `part / whole`, clamped to `0..=1`; `0` when the whole is unknown.
fn share(part: f64, whole: f64) -> f64 {
    if whole <= 0.0 || !part.is_finite() {
        return 0.0;
    }
    (part / whole).clamp(0.0, 1.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A real child process, spawned through the SAME chokepoint the runner
    /// spawns a persona execution with (so its root is shaped like a run's).
    /// `kill_on_drop` ends it with the test.
    fn spawn_child() -> crate::engine::cli_process::CliProcessDriver {
        #[cfg(windows)]
        let (command, args) = ("cmd", vec!["/c", "ping", "-n", "4", "127.0.0.1"]);
        #[cfg(not(windows))]
        let (command, args) = ("sleep", vec!["3"]);
        crate::engine::cli_process::CliProcessDriver::spawn_cwd(&crate::engine::types::CliArgs {
            command: command.to_string(),
            args: args.into_iter().map(str::to_string).collect(),
            env_overrides: Vec::new(),
            env_removals: Vec::new(),
            cwd: None,
        })
        .expect("spawn a child process")
    }

    #[tokio::test]
    async fn the_tree_sum_includes_a_spawned_child() {
        let child = spawn_child();
        let child_pid = child.pid().expect("the child has a pid");
        let me = std::process::id();
        let mut probe = Probe::new();

        // The child is found under this test process in the real table.
        probe.sys.refresh_processes_specifics(
            ProcessesToUpdate::All,
            true,
            ProcessRefreshKind::nothing(),
        );
        let nodes: Vec<ProcNode> = probe
            .sys
            .processes()
            .iter()
            .map(|(pid, p)| ProcNode {
                pid: pid.as_u32(),
                parent: p.parent().map(|pp| pp.as_u32()),
                start_time: p.start_time(),
            })
            .collect();
        let subtree = ProcessTree::build(&nodes).subtree(me);
        assert!(subtree.contains(&me));
        assert!(
            subtree.contains(&child_pid),
            "child {child_pid} not under root {me}: {subtree:?}"
        );

        // And the run-level sample charges the tree: the root alone is
        // resident, so the share is real and inside 0..=1.
        let results = probe.sample(&[
            RunProbe {
                root_pid: me,
                root_start: None,
            },
            RunProbe {
                root_pid: u32::MAX - 7,
                root_start: None,
            },
        ]);
        let ProbeResult::Sampled {
            reading,
            root_start,
        } = &results[0]
        else {
            panic!("this process is alive: {results:?}");
        };
        assert!(reading.ram > 0.0 && reading.ram <= 1.0, "{reading:?}");
        assert!((0.0..=1.0).contains(&reading.cpu), "{reading:?}");
        assert_eq!(reading.gpu, None, "the first GPU collection only primes");
        assert!(*root_start > 0 || cfg!(not(windows)));
        assert_eq!(results[1], ProbeResult::Gone, "no such pid");

        // A recycled pid (same number, different start) reads as gone.
        let recycled = probe.sample(&[RunProbe {
            root_pid: me,
            root_start: Some(1),
        }]);
        assert_eq!(recycled[0], ProbeResult::Gone);
    }

    #[test]
    fn shares_clamp_and_tolerate_an_unknown_whole() {
        assert_eq!(share(50.0, 100.0), 0.5);
        assert_eq!(share(250.0, 100.0), 1.0);
        assert_eq!(share(5.0, 0.0), 0.0);
        assert_eq!(share(f64::NAN, 100.0), 0.0);
    }
}
